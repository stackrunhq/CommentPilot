import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {zipSync,strToU8} from 'fflate';
import {WorkScheduler} from '../../src/comments/scheduler.js';
import {CommentQueue} from '../../src/comments/queue.js';
import {CommentWorker} from '../../src/comments/worker.js';
import {validatePolicy,reviewTasks} from '../../src/comments/operations.js';
import {retrieve} from '../../src/knowledge/retrieval.js';
import {importKnowledge} from '../../src/knowledge/import.js';
import {AccountRegistry} from '../../src/douyin/accounts.js';
import {WebhookInbox} from '../../src/broker/webhooks.js';
import {createHash} from 'node:crypto';
import {Storage} from '../../src/storage/database.js';
import {fullBackup,verifyBackup,restoreBackup} from '../../src/storage/full-backup.js';
test('generation concurrency does not block scan pool, one work cannot run twice',async()=>{
  const scan=new WorkScheduler({gap:0}),models=new WorkScheduler({gap:0,concurrency:2});let releaseA,releaseB,scans=0;
  models.add('a',()=>new Promise(r=>releaseA=r));models.add('b',()=>new Promise(r=>releaseB=r));scan.add('a',async()=>scans++);
  const a=models.tick(),b=models.tick();await models.tick();await scan.tick();assert.equal(models.inflight.size,2);assert.equal(scans,1);releaseA();releaseB();await Promise.all([a,b]);
});
test('review cannot approve uncertain writes, another session or another work',()=>{
  const db=new DatabaseSync(':memory:'),q=new CommentQueue(db),scope={account:'a',workId:'1',sessionId:'s'};
  const r={key:'r',status:'draft',reply:'answer'},t=q.ensure({...scope,commentKey:'r',stage:'send'});q.save({...t,status:'review'});
  assert.equal(reviewTasks(q,[r],{...scope,workId:'2'},{ids:[t.id],decision:'approve'}).changed,0);
  r.submission={};assert.equal(reviewTasks(q,[r],scope,{ids:[t.id],decision:'approve'}).changed,0);r.submission=null;
  assert.equal(reviewTasks(q,[r],scope,{ids:[t.id],decision:'approve'}).changed,1);assert.equal(q.list('a','1')[0].approved,true);
  assert.throws(()=>validatePolicy({maxAgeMinutes:-1}));db.close();
});
test('expired queue tasks become review without generating/sending; pausing does not consume retries',async()=>{
  const db=new DatabaseSync(':memory:'),q=new CommentQueue(db),r={key:'r',workId:'1',sessionId:'s',source:'douyin-official',status:'new'},session={sessionId:'s',account:'a'},config={autoSend:true,queuePolicy:{pauseGeneration:true,maxAgeMinutes:1}};
  let calls=0;const w=new CommentWorker({queue:q,official:{accountFingerprint:()=> 'a'},records:()=>[r],target:()=> '1',session:()=>session,config:()=>config,running:()=>true,maxSteps:1,draft:async()=>calls++,send:async()=>calls++,logger:{write(){}},stop(){}});
  await w.process('generate');assert.equal(q.list('a','1')[0].attempts,0);let t=q.list('a','1')[0];q.save({...t,created:Date.now()-120000});config.queuePolicy.pauseGeneration=false;await w.process('generate');assert.equal(q.list('a','1')[0].status,'review');assert.equal(q.list('a','1')[0].reviewReason,'expired');assert.equal(calls,0);assert.equal(r.status,'new');db.close();
});
test('Chinese retrieval returns relevant passages and never synthesizes missing facts',()=>{
  const text=('无关介绍。'.repeat(600))+'退款规则：收到商品后七天内可申请退款。'+('普通说明。'.repeat(600));
  assert.ok(retrieve(text,'退款怎么申请？').some(c=>c.text.includes('退款规则')));assert.deepEqual(retrieve(text,'宇宙飞船发射'),[]);
});
test('DOCX/TXT imports produce plain text, XML entities and unknown formats rejected',async()=>{
  const bytes=zipSync({'word/document.xml':strToU8('<w:document xmlns:w="test"><w:body><w:p><w:r><w:t>退款规则 &amp; 说明</w:t></w:r></w:p></w:body></w:document>')});
  assert.match((await importKnowledge(bytes,'facts.docx')).text,/退款规则 & 说明/);
  assert.equal((await importKnowledge(Buffer.from('确认资料'),'facts.txt')).text,'确认资料');
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];const stream='BT /F1 12 Tf 30 700 Td (Verified refund rules) Tj ET';objects.push('<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream');let pdf='%PDF-1.4\n',offsets=[0];for(let n=0;n<objects.length;n++){offsets.push(Buffer.byteLength(pdf));pdf+=(n+1)+' 0 obj\n'+objects[n]+'\nendobj\n';}const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';assert.match((await importKnowledge(Buffer.from(pdf),'facts.pdf')).text,/Verified refund rules/);
  await assert.rejects(importKnowledge(Buffer.from('x'),'x.exe'));
  await assert.rejects(importKnowledge(zipSync({'word/document.xml':strToU8('<!DOCTYPE w [<!ENTITY x SYSTEM "file:///secret">]><w>&x;</w>')}),'x.docx'));
});
test('multiple account encrypted slots load independently and disconnect only one',async()=>{
  const db=new DatabaseSync(':memory:'),crypt=async(value,mode)=>mode==='unprotect'?Buffer.from(value,'base64').toString():Buffer.from(value).toString('base64'),registry=await new AccountRegistry(db,{crypt,env:{}}).load();
  const second=await registry.create('second');for(const [slot,owner]of [['default','owner-a'],[second.id,'owner-b']]){registry.get(slot).token={open_id:owner,access_token:owner+'-secret'};await registry.get(slot).save();}
  const restored=await new AccountRegistry(db,{crypt,env:{}}).load();assert.notEqual(restored.get().accountFingerprint(),restored.get(second.id).accountFingerprint());await restored.get(second.id).disconnect();assert.ok(restored.get().token);assert.equal(restored.get(second.id).token,null);db.close();
});
test('webhooks verify exact raw bytes/application and deduplicate without storing content',()=>{
  const db=new DatabaseSync(':memory:'),inbox=new WebhookInbox(db,{secret:'secret',clientKey:'app'}),raw=Buffer.from(JSON.stringify({event:'authorize',client_key:'app',from_user_id:'owner',content:{private:'not retained'}})),headers={'x-douyin-signature':createHash('sha1').update('secret').update(raw).digest('hex'),'msg-id':'m'};
  inbox.accept(raw,headers);inbox.accept(raw,headers);assert.equal(inbox.list('owner').length,1);assert.equal(JSON.stringify(inbox.list('owner')).includes('not retained'),false);assert.throws(()=>inbox.accept(Buffer.concat([raw,Buffer.from(' ')]),headers));assert.equal(inbox.list('another').length,0);db.close();
});
test('full backup restores database and media into new directory, detects tampering, refuses overwrite',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'cp-backup-'));let storage;
  try{storage=new Storage(path.join(dir,'source'));await mkdir(path.join(storage.dir,'media','123'),{recursive:true});await writeFile(path.join(storage.dir,'media','123','a.txt'),'asset');const b=await fullBackup(storage);assert.ok((await verifyBackup(b.folder)).entries.length>=2);const destination=path.join(dir,'restored');await restoreBackup(b.folder,destination);assert.equal(await readFile(path.join(destination,'media','123','a.txt'),'utf8'),'asset');await assert.rejects(restoreBackup(b.folder,destination));await writeFile(path.join(b.folder,'media','123','a.txt'),'tamper');await assert.rejects(verifyBackup(b.folder));}finally{storage?.close();await rm(dir,{recursive:true,force:true});}
});
