import {fork} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(path.join(tmpdir(),'commentpilot-official-flow-')),base='http://127.0.0.1:3279',control=path.join(dir,'fixture.json'),sends=path.join(dir,'sends.jsonl');
let child;
const post=async(name,body={})=>{const r=await fetch(base+'/api/'+name,{method:'POST',headers:{'Content-Type':'application/json','x-local-app':'douyin-reply'},body:JSON.stringify(body)}),result=await r.json();if(!r.ok)throw Error(name+': '+result.error);return result;};
const state=async()=> (await fetch(base+'/api/state')).json();
const until=async(fn)=>{for(let n=0;n<250;n++){const s=await state();if(fn(s))return s;await new Promise(r=>setTimeout(r,100));}throw Error('condition timed out');};
async function start(){child=fork('src/app/server.js',[],{execArgv:['--import',new URL('../fixtures/official-fetch.mjs',import.meta.url).href],env:{...process.env,APP_PORT:'3279',APP_DATA_DIR:dir,APP_BROWSER_FIXTURE:'',DEEPSEEK_API_KEY:'',DOUYIN_CLIENT_KEY:'fixture-client',DOUYIN_CLIENT_SECRET:'fixture-secret',DOUYIN_REDIRECT_URI:'https://fixture.example/callback',OFFICIAL_FIXTURE_STATE:control,OFFICIAL_FIXTURE_SENDS:sends},silent:true});let error='';child.stderr.on('data',b=>error+=b);for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}if(child.exitCode!==null)throw Error(error);await new Promise(r=>setTimeout(r,100));}throw Error('backend startup timed out');}
async function stop(){const current=child;if(!current||current.exitCode!==null)return;await new Promise(resolve=>{const timer=setTimeout(()=>current.kill(),5000);timer.unref();current.once('exit',()=>{clearTimeout(timer);resolve();});if(current.connected)current.send({type:'shutdown'},error=>{if(error)current.kill();});else current.kill();});}
try{
  const old={comment_id:'@old',comment_user_id:'fan',content:'历史评论',create_time:Math.floor(Date.now()/1000)-3600};await writeFile(control,JSON.stringify({comments:[old]}));await writeFile(sends,'');await start();
  const auth=new URL((await post('official-authorize')).url);await post('official-callback',{code:'fixture-code',state:auth.searchParams.get('state')});
  const works=await post('official-works');assert.equal(works.works[0].id,'123');await post('works-save',{url:works.works[0].url,title:'测试作品',context:'请参考作品已确认的说明。'});await post('works-select',{id:'123'});
  const connection=await post('connections-save',{provider:'custom',name:'Fixture model',baseUrl:'http://127.0.0.1:19999/v1',protocol:'chat',auth:'none',model:'fixture-model',makeDefault:true});assert.ok(connection.id);
  await post('config',{video:works.works[0].url,interval:10,autoSend:true});await post('start');assert.equal((await state()).monitor.baselineCount,1);
  const fresh={comment_id:'@new',comment_user_id:'fan',content:'新评论',create_time:Math.ceil(Date.now()/1000)+1};await writeFile(control,JSON.stringify({comments:[old,fresh]}));
  await until(s=>s.records.some(r=>r.commentId==='@new'&&r.status==='sent'));await post('stop');assert.equal((await readFile(sends,'utf8')).trim().split('\n').length,1);
  await stop();await start();assert.equal((await state()).official.authorized,true);await post('resume');await until(s=>!s.busy);await new Promise(r=>setTimeout(r,500));await post('stop');assert.equal((await readFile(sends,'utf8')).trim().split('\n').length,1);
  const uncertain={comment_id:'@uncertain',comment_user_id:'fan',content:'超时评论',create_time:Math.ceil(Date.now()/1000)+1};await writeFile(control,JSON.stringify({comments:[old,fresh,uncertain],failSend:true}));await post('resume');const failed=await until(s=>s.records.some(r=>r.commentId==='@uncertain'&&r.status==='uncertain'));assert.equal(failed.running,false);
  assert.equal((await readFile(sends,'utf8')).trim().split('\n').length,2);
  const pending=failed.records.find(r=>r.commentId==='@uncertain');assert.ok(pending.submission);assert.ok(failed.queueTasks.some(t=>t.commentKey===pending.key&&t.stage==='verify'));
  await writeFile(control,JSON.stringify({comments:[old,fresh,uncertain],failSend:true,replies:[{comment_id:'@confirmed-after-timeout',comment_user_id:'fixture-owner',content:pending.submission.text,create_time:Math.floor(Date.now()/1000)}]}));
  await post('verify-pending');const reconciled=await until(s=>s.records.some(r=>r.commentId==='@uncertain'&&r.status==='sent'));assert.equal(reconciled.running,false);assert.equal((await readFile(sends,'utf8')).trim().split('\n').length,2,'verification never resends');
  const detail=await post('history-detail',{key:pending.key});assert.ok(detail.attempts.some(a=>a.verification==='official-reply-list'&&a.status==='sent'));
  await stop();await start();assert.ok((await state()).records.some(r=>r.key===pending.key&&r.status==='sent'));assert.equal((await readFile(sends,'utf8')).trim().split('\n').length,2);
  console.log('Official isolated full flow passed: OAuth/DPAPI, works, baseline, queue generation/reply, restart dedup, timeout pause, read-only reconciliation and persisted confirmation. No real Douyin/model requests.');
}finally{await stop();await rm(dir,{recursive:true,force:true});}
