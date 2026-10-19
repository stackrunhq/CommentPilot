import {fork} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const dir=await mkdtemp(path.join(tmpdir(),'cp-personal-')),base='http://127.0.0.1:3285';let child,browser,calls=0;
const model=http.createServer(async(req,res)=>{for await(const _ of req){}calls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'请按作品说明办理。'}}]}));});await new Promise(r=>model.listen(19998,'127.0.0.1',r));
async function post(name,body={},ok=true){const response=await fetch(base+'/api/'+name,{method:'POST',headers:{'x-local-app':'douyin-reply','Content-Type':'application/json'},body:JSON.stringify(body)}),data=await response.json();assert.equal(response.ok,ok,data.error);return data;}
const state=async()=> (await fetch(base+'/api/state')).json();
async function start(){child=fork('src/app/server.js',[],{env:{...process.env,APP_PORT:'3285',APP_DATA_DIR:dir,COMMENTPILOT_BROKER_URL:'',DEEPSEEK_API_KEY:'',DOUYIN_CLIENT_KEY:'',DOUYIN_CLIENT_SECRET:'',DOUYIN_REDIRECT_URI:'',APP_BROWSER_FIXTURE:''},silent:true});let error='';child.stderr.on('data',b=>error+=b);for(let n=0;n<100;n++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}if(child.exitCode!==null)throw Error(error);await new Promise(r=>setTimeout(r,100));}throw Error('startup timeout');}
async function stop(){const c=child;if(!c||c.exitCode!==null)return;await new Promise(r=>{const t=setTimeout(()=>c.kill(),5000);c.once('exit',()=>{clearTimeout(t);r();});if(c.connected)c.send({type:'shutdown'});else c.kill();});}
try{
  await start();const connection=await post('connections-save',{provider:'custom',name:'local fixture',protocol:'chat',auth:'none',baseUrl:'http://127.0.0.1:19998/v1',model:'fixture',makeDefault:true});
  const work={url:'https://www.douyin.com/video/123',title:'作品A',connectionId:connection.id,context:''};await post('personal-work',work);
  assert.deepEqual(await post('personal-import',{text:'用户A\t怎么办\n用户A\t怎么办\n用户B\t谢谢'}),{added:2,duplicates:1});let s=await state();const first=s.records.find(r=>r.author==='用户A'),second=s.records.find(r=>r.author==='用户B');
  assert.equal((await post('personal-generate',{keys:[first.key]})).results[0].ok,false);assert.equal(calls,0,'missing context never calls model');
  await post('personal-work',{...work,context:'已确认事实：请按作品说明办理。'});await post('personal-generate',{keys:[first.key]});assert.equal(calls,1);await post('personal-edit',{key:first.key,reply:'人工修改后的回复'});await post('personal-copied',{key:first.key});s=await state();assert.equal(s.records.find(r=>r.key===first.key).status,'draft');
  await post('personal-published',{key:first.key},false);await post('personal-published',{key:first.key,confirmed:true});await post('send',{key:second.key},false);assert.equal((await post('history-detail',{key:first.key})).attempts.length,0);
  await post('personal-work',{...work,url:'https://www.douyin.com/video/456',title:'作品B',context:'作品B资料'});await post('personal-import',{text:'用户A\t怎么办'});await post('personal-generate',{keys:[first.key]},false);assert.equal((await state()).records.length,1);await post('works-select',{id:'123'});
  await stop();await start();s=await state();assert.equal(s.config.assistantMode,'personal');assert.equal(s.records.find(r=>r.key===first.key).status,'manual_published');assert.equal(s.records.find(r=>r.key===first.key).copyCount,1);assert.equal(s.official.authorized,false);
  browser=await chromium.launch({headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.testClipboard=text;}}}));await page.goto(base);await page.waitForFunction(()=>document.querySelector('#personalView')&&!document.querySelector('#personalView').hidden);assert.equal(await page.locator('#officialPanel').isVisible(),false);await page.getByRole('button',{name:'复制已保存回复',exact:true}).click();assert.equal(await page.evaluate(()=>window.testClipboard),'人工修改后的回复');await page.waitForTimeout(200);assert.equal((await state()).records.find(r=>r.key===first.key).copyCount,2);assert.deepEqual(errors,[]);
  console.log('Personal flow passed: no Douyin authorization, missing-context refusal, work-scoped import/dedup, real local model draft/edit, clipboard-only action, distinct manual publication, API send rejection, history and restart persistence.');
}finally{if(browser)await browser.close();await stop();await new Promise(r=>model.close(r));await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
