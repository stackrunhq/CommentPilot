import {fork} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const dir=await mkdtemp(path.join(tmpdir(),'cp-browser-auto-')),control=path.join(dir,'state.json'),sends=path.join(dir,'sends.jsonl'),base='http://127.0.0.1:3286';let child;
const model=http.createServer(async(req,res)=>{for await(const _ of req){}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'请参考作品说明办理。'}}]}));});await new Promise(r=>model.listen(19997,'127.0.0.1',r));
async function post(name,body={},ok=true){const r=await fetch(base+'/api/'+name,{method:'POST',headers:{'x-local-app':'douyin-reply','Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json();assert.equal(r.ok,ok,d.error);return d;}
const state=async()=> (await fetch(base+'/api/state')).json();
async function until(fn){for(let n=0;n<500;n++){const s=await state();if(fn(s))return s;await new Promise(r=>setTimeout(r,100));}throw Error('condition timeout');}
async function start(){child=fork('src/app/server.js',[],{execArgv:['--import',new URL('../fixtures/personal-browser-launch.mjs',import.meta.url).href],env:{...process.env,APP_PORT:'3286',APP_DATA_DIR:dir,APP_BROWSER_FIXTURE:'',COMMENTPILOT_BROKER_URL:'',DEEPSEEK_API_KEY:'',DOUYIN_CLIENT_KEY:'',DOUYIN_CLIENT_SECRET:'',PERSONAL_BROWSER_TEST_STATE:control,PERSONAL_BROWSER_TEST_SENDS:sends},silent:true});let errors='';child.stderr.on('data',b=>errors+=b);for(let n=0;n<100;n++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}if(child.exitCode!==null)throw Error(errors);await new Promise(r=>setTimeout(r,100));}throw Error('startup timeout');}
async function stop(){const c=child;if(!c||c.exitCode!==null)return;await new Promise(r=>{const timer=setTimeout(()=>c.kill(),7000);c.once('exit',()=>{clearTimeout(timer);r();});if(c.connected)c.send({type:'shutdown'});else c.kill();});}
try{
  const old={cid:'100',text:'历史评论',create_time:Math.floor(Date.now()/1000)-3600,user:{nickname:'fan'}};const fixture={comments:[old],responseOnly:true};await writeFile(control,JSON.stringify(fixture));await writeFile(sends,'');await start();
  const c=await post('connections-save',{provider:'custom',name:'local',protocol:'chat',auth:'none',baseUrl:'http://127.0.0.1:19997/v1',model:'fixture',makeDefault:true});await post('personal-work',{url:'https://www.douyin.com/video/123',title:'test',context:'作品说明：参考说明办理',connectionId:c.id});await post('browser-personal-enable',{enabled:true});assert.equal((await state()).transport,'personal-browser');
  await post('browser-personal-config',{ownName:'Owner',interval:10,dailyLimit:2,autoSend:true});await post('browser');await post('verify',{},false);await post('verify',{confirmed:true});await post('start');assert.equal((await state()).monitor.baselineCount,1);
  const ui=await chromium.launch({headless:true});try{const tab=await ui.newPage();const original=(await state()).monitor.sessionId;await tab.goto(base);await tab.waitForSelector('#servicePanel');await tab.reload();await tab.waitForSelector('#servicePanel');assert.equal((await state()).running,true,'workbench refresh must not stop backend');assert.equal((await state()).monitor.sessionId,original,'workbench refresh must retain baseline');}finally{await ui.close();}
  fixture.navigationAbort=true;fixture.readFailures=1;fixture.comments.push({cid:'101',text:'新评论',create_time:Math.ceil(Date.now()/1000)+1,user:{nickname:'fan'}},{cid:'102',text:'自己的评论',create_time:Math.ceil(Date.now()/1000)+1,user:{nickname:'Owner'}});await writeFile(control,JSON.stringify(fixture));
  await until(s=>s.running&&s.monitor?.readRetry?.attempts===1);fixture.readFailures=0;
  await until(s=>s.records.some(r=>r.commentId==='101'&&r.status==='sent'));assert.equal((await state()).records.find(r=>r.commentId==='101').browserConfirmation.method,'browser-publish-response');await post('stop');await until(s=>!s.busy);let lines=(await readFile(sends,'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(lines.map(x=>x.id),['101']);assert.equal((await state()).records.find(r=>r.commentId==='100').status,'ignored_history');assert.equal((await state()).records.find(r=>r.commentId==='102').status,'ignored_own');
  await post('browser-personal-config',{ownName:'Owner',interval:10,dailyLimit:20,autoSend:true,maxReplyRounds:3});
  await post('browser-personal-config',{ownName:'Owner',maxReplyRounds:0},false);
  fixture.replies=[];
  for(const [ownId,parent,fanId] of [['201','101','202'],['203','202','204'],['205','204','206']]){
    fixture.replies.push({cid:ownId,text:'请参考作品说明办理。',reply_id:'101',reply_to_reply_id:parent,create_time:Math.floor(Date.now()/1000),user:{nickname:'Owner'}},{cid:fanId,text:'继续追问'+fanId,reply_id:'101',reply_to_reply_id:ownId,create_time:Math.ceil(Date.now()/1000)+1,user:{nickname:'fan'}});await writeFile(control,JSON.stringify(fixture));await post('resume');
    await until(s=>s.records.some(r=>r.commentId===fanId&&r.status===(fanId==='206'?'ignored_conversation':'sent')));await post('stop');await until(s=>!s.busy);
  }
  lines=(await readFile(sends,'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(lines.map(x=>x.id),['101','202','204']);assert.equal((await state()).records.find(r=>r.commentId==='204').conversationHistory.length,2);
  fixture.wrongPublish=true;fixture.comments.push({cid:'107',text:'测试错误回复目标',create_time:Math.ceil(Date.now()/1000)+1,user:{nickname:'fan'}});await writeFile(control,JSON.stringify(fixture));await post('resume');await until(s=>!s.running&&!s.busy&&s.records.some(r=>r.commentId==='107'&&r.status==='review'));assert.equal((await readFile(sends,'utf8')).trim().split('\n').length,3,'wrong parent must be blocked before publish');fixture.wrongPublish=false;
  fixture.challenge=true;await writeFile(control,JSON.stringify(fixture));await post('resume');await until(s=>!s.running&&!s.busy);assert.equal((await readFile(sends,'utf8')).trim().split('\n').length,3,'challenge must not send');
  await stop();await start();assert.equal((await state()).transport,'personal-browser');await post('resume',{},false);assert.equal((await state()).records.find(r=>r.commentId==='101').status,'sent');console.log('Personal browser flow passed: production mode without fixture switch, owner confirmation, old/own comment skip, fresh comment auto-generated and posted via DOM, three-round followups and fourth-turn stop with history, challenge pause, restart no automatic resend. Synthetic Douyin page only.');
}finally{await stop();await new Promise(r=>model.close(r));await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
