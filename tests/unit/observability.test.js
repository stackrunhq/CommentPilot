import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {redact,redactText,registerSecret} from '../../src/security/redaction.js';
import {Logger,traceContext} from '../../src/observability/logger.js';
import {diagnosticReport} from '../../src/observability/diagnostics.js';
import {Storage} from '../../src/storage/database.js';

test('redacts credentials, auth headers, OAuth query, PII and local paths recursively',()=>{
  registerSecret('fixture-registry-secret');const source={apiKey:'secret-a',headers:{cookie:'session-secret'},comment:{author:'私人昵称',text:'私人评论'},reply:'私人回复',background:'私人知识',message:'fixture-registry-secret Bearer bearer-value access_token=query-value https://example.test/callback?code=oauth-value&state=state-value 联系13812345678 person@example.test C:\\Users\\private-user\\secret.txt'};
  const output=JSON.stringify(redact(source));for(const secret of ['secret-a','session-secret','私人昵称','私人评论','私人回复','私人知识','fixture-registry-secret','bearer-value','query-value','oauth-value','state-value','13812345678','person@example.test','private-user'])assert.ok(!output.includes(secret),secret);assert.ok(output.includes('REDACTED'));assert.equal(redactText('无敏感内容'),'无敏感内容');
});
test('concurrent operations retain independent trace IDs, whitelist fields, rotate and retain logs',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'commentpilot-log-')),storage=new Storage(dir),logger=new Logger(dir,{db:storage.db,maxBytes:700,backups:2});storage.logger=logger;
  try{const refs=await Promise.all(['config','works-select'].map((name,i)=>logger.operation(name,async()=>{await new Promise(r=>setTimeout(r,10-i));const traceId=traceContext().traceId;logger.write('step.test',{workId:'7697085629427793785',text:'never-write-private',apiKey:'never-write-key'});return traceId;})));assert.notEqual(refs[0],refs[1]);
    assert.equal(logger.message('已完成',{workId:'7697085629427793785'}).workId,'7697085629427793785','local UI retains work filter; exported identifiers are separately pseudonymized');
    for(let n=0;n<10;n++)logger.write('rotation.test',{count:n});const files=await readdir(path.join(dir,'logs'));assert.ok(files.length<=3);const logs=(await Promise.all(files.map(f=>readFile(path.join(dir,'logs',f),'utf8')))).join('');assert.ok(!logs.includes('never-write'));assert.ok(!logs.includes('7697085629427793785'));
    storage.db.prepare('INSERT INTO diagnostic_events(time,event,data) VALUES(?,?,?)').run('2000-01-01','expired','{}');logger.prune();assert.equal(storage.db.prepare("SELECT count(*) n FROM diagnostic_events WHERE event='expired'").get().n,0);
  }finally{storage.close();await rm(dir,{recursive:true,force:true});}
});
test('diagnostic export never copies business records, old logs, unknown keys or raw errors',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'commentpilot-diag-')),storage=new Storage(dir),logger=new Logger(dir,{db:storage.db});storage.logger=logger;
  try{storage.event({message:'legacy-private-sentinel'});storage.saveKnowledge({name:'private-knowledge-title',content:'private-knowledge-sentinel'});storage.attempt('model_calls',{status:'failed',response:'private-response-sentinel',background:'private-background-sentinel'});
    await assert.rejects(()=>logger.operation('model-test',async()=>{logger.write('model.start',{workId:'123',commentId:'@private-comment'});throw Error('private-error-sentinel');}));
    const a=diagnosticReport(storage,logger,{version:'fixture',official:{authorized:true}}),b=diagnosticReport(storage,logger,{version:'fixture'}),json=JSON.stringify(a);for(const value of ['legacy-private-sentinel','private-knowledge-title','private-knowledge-sentinel','private-response-sentinel','private-background-sentinel','private-error-sentinel','@private-comment'])assert.ok(!json.includes(value),value);
    assert.ok(a.operations.some(o=>o.operation==='model-test'&&o.outcome==='failed'));assert.notEqual(a.events.find(e=>e.workId)?.workId,b.events.find(e=>e.workId)?.workId);
    assert.equal(a.privacy.mode,'allowlist');assert.ok(!('database' in a));
  }finally{storage.close();await rm(dir,{recursive:true,force:true});}
});
test('logging sink failure is observable and cannot trigger a duplicate business operation',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'commentpilot-log-failure-')),logger=new Logger(dir);logger.file=path.join(dir,'missing','file.jsonl');let calls=0;
  try{await logger.operation('send',async()=>{calls++;return 'sent';});assert.equal(calls,1);assert.equal(logger.failed,true);}finally{await rm(dir,{recursive:true,force:true});}
});
