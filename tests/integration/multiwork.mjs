import {fork} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(path.join(tmpdir(),'commentpilot-multi-')),base='http://127.0.0.1:3283',control=path.join(dir,'fixture.json'),models=path.join(dir,'models.log'),sends=path.join(dir,'sends.log');let child;
const post=async(action,body={})=>{const r=await fetch(base+'/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','x-local-app':'douyin-reply'},body:JSON.stringify(body)}),d=await r.json();assert.ok(r.ok,d.error);return d;};
async function start(){child=fork('src/app/server.js',[],{execArgv:['--import',new URL('../fixtures/official-fetch.mjs',import.meta.url).href],env:{...process.env,APP_PORT:'3283',APP_DATA_DIR:dir,APP_BROWSER_FIXTURE:'',DEEPSEEK_API_KEY:'',DOUYIN_CLIENT_KEY:'fixture-client',DOUYIN_CLIENT_SECRET:'fixture-secret',DOUYIN_REDIRECT_URI:'https://fixture.example/callback',OFFICIAL_FIXTURE_STATE:control,OFFICIAL_FIXTURE_SENDS:sends,OFFICIAL_FIXTURE_MODELS:models},silent:true});let errors='';child.stderr.on('data',b=>errors+=b);for(let n=0;n<100;n++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}if(child.exitCode!==null)throw Error(errors);await new Promise(r=>setTimeout(r,100));}throw Error('startup timeout');}
async function stop(){if(!child||child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.send({type:'shutdown'});setTimeout(()=>child.kill(),5000).unref();});}
const state=async()=> (await fetch(base+'/api/state')).json();
async function until(fn){for(let n=0;n<500;n++){const s=await state();if(fn(s))return s;await new Promise(r=>setTimeout(r,100));}throw Error('condition timeout');}
const fixture={works:['123','456'].map(id=>({item_id:'@work-'+id,share_url:'https://www.douyin.com/video/'+id,title:'Title '+id})),byWork:{'@work-123':[],'@work-456':[]}};
try{
  await writeFile(control,JSON.stringify(fixture));await start();
  const url=new URL((await post('official-authorize')).url);await post('official-callback',{code:'fixture',state:url.searchParams.get('state')});await post('official-works');
  for(const id of ['123','456']){const connection=await post('connections-save',{provider:'custom',name:'fixture-'+id,baseUrl:'http://127.0.0.1:19999/v1',auth:'none',protocol:'chat',model:'model-'+id});const kb=await post('knowledge-save',{name:'KB '+id,content:'Exclusive facts '+id});await post('works-save',{url:'https://www.douyin.com/video/'+id,title:'Work '+id,context:'Context '+id,connectionId:connection.id,knowledgeBaseId:kb.id,autoSend:true,interval:10,dailyLimit:20});}
  await post('monitor-start',{id:'123'});await until(s=>!s.busy);await post('monitor-start',{id:'456'});
  assert.equal((await state()).multiMonitors.filter(r=>r.running).length,2);
  const selected=(await state()).config.video;
  const blocked=await fetch(base+'/api/works-select',{method:'POST',headers:{'Content-Type':'application/json','x-local-app':'douyin-reply'},body:JSON.stringify({id:'123'})});assert.equal(blocked.status,400,'editing active shared state requires pause');
  // Existing comments are absent from both baselines; only comments published after startup enter tasks.
  await new Promise(r=>setTimeout(r,1100));const now=Math.floor(Date.now()/1000);
  fixture.byWork['@work-123']=Array.from({length:8},(_,n)=>({comment_id:'@a'+n,comment_user_id:'fan-a',content:'Question A '+n,create_time:now}));
  fixture.byWork['@work-456']=[{comment_id:'@b',comment_user_id:'fan-b',content:'Question B',create_time:now}];await writeFile(control,JSON.stringify(fixture));
  await until(s=>s.multiMonitors.length===2&&s.multiMonitors.every(rt=>rt.queue.some(q=>q.status==='done')));
  assert.equal((await state()).config.video,selected,'background workers never switch UI selection');
  await post('monitor-stop',{id:'123'});assert.equal((await state()).multiMonitors.find(r=>r.workId==='456').running,true,'stopping busy work leaves other work active');
  await post('stop');await until(s=>!s.busy);
  const calls=(await readFile(models,'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(calls.some(c=>c.model==='model-123'));assert.ok(calls.some(c=>c.model==='model-456'));
  for(const c of calls){const text=JSON.stringify(c.messages);assert.ok(text.includes('Exclusive facts '+c.model.slice(-3)));assert.ok(!text.includes('Exclusive facts '+(c.model==='model-123'?'456':'123')));}
  const posted=(await readFile(sends,'utf8')).trim().split('\n').map(JSON.parse);assert.ok(posted.some(p=>p.item_id==='@work-123'));assert.ok(posted.some(p=>p.item_id==='@work-456'));
  const smallIndex=posted.findIndex(p=>p.item_id==='@work-456');assert.ok(smallIndex<8,'busy work must not drain before quiet work');
  assert.equal(new Set(posted.map(p=>p.comment_id)).size,posted.length);
  assert.ok((await state()).multiMonitors.find(r=>r.workId==='123').backlog.count>0);
  await stop();await start();assert.equal((await state()).anyMonitoring,false,'restart never resumes sends silently');
  await post('monitor-start',{id:'456',resume:true});await until(s=>!s.busy);await post('stop');
  assert.equal((await readFile(sends,'utf8')).trim().split('\n').length,posted.length,'resume does not resend');
  console.log('Multiwork passed: two independent models/KBs, fair scheduling under uneven load, per-work sends, backlog, stop/restart/resume dedup. No real platform requests.');
}finally{await stop();await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
