import {fork} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {chromium} from 'playwright';
const dir=await mkdtemp(path.join(tmpdir(),'cp-operations-')),base='http://127.0.0.1:3284',control=path.join(dir,'fixture.json');let child,browser;
const post=async(action,body={})=>{const r=await fetch(base+'/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','x-local-app':'douyin-reply'},body:JSON.stringify(body)}),d=await r.json();assert.ok(r.ok,d.error);return d;};
const state=async()=> (await fetch(base+'/api/state')).json();
async function until(fn){for(let n=0;n<400;n++){const s=await state();if(fn(s))return s;await new Promise(r=>setTimeout(r,100));}throw Error('condition timeout');}
try{
  await writeFile(control,JSON.stringify({comments:[]}));child=fork('src/app/server.js',[],{execArgv:['--import',new URL('../fixtures/official-fetch.mjs',import.meta.url).href],env:{...process.env,APP_PORT:'3284',APP_DATA_DIR:dir,APP_BROWSER_FIXTURE:'',COMMENTPILOT_BROKER_URL:'',DEEPSEEK_API_KEY:'',DOUYIN_CLIENT_KEY:'fixture-client',DOUYIN_CLIENT_SECRET:'fixture-secret',DOUYIN_REDIRECT_URI:'https://fixture.example/callback',OFFICIAL_FIXTURE_STATE:control,OFFICIAL_FIXTURE_SENDS:path.join(dir,'sends')},silent:true});let errors='';child.stderr.on('data',b=>errors+=b);let ready=false;for(let n=0;n<100;n++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error(errors);await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
  const auth=new URL((await post('official-authorize')).url);await post('official-callback',{code:'fixture',state:auth.searchParams.get('state')});await post('official-works');
  await post('connections-save',{provider:'custom',name:'fixture',baseUrl:'http://127.0.0.1:19999/v1',auth:'none',protocol:'chat',model:'fixture',makeDefault:true});await post('config',{video:'https://www.douyin.com/video/123',context:'Confirmed facts',autoSend:false});await post('start');
  await writeFile(control,JSON.stringify({comments:[{comment_id:'@review',comment_user_id:'fan',content:'Question',create_time:Math.ceil(Date.now()/1000)+1}]}));await until(s=>s.records.some(r=>r.status==='draft'));await post('stop');await until(s=>!s.busy);
  const reviews=await post('queue-review-list',{workId:'123'});assert.equal(reviews.tasks.length,1);assert.equal(reviews.tasks[0].stage,'send');assert.equal((await post('queue-review',{workId:'123',ids:[reviews.tasks[0].id],decision:'approve'})).changed,1);
  await post('resume');await until(s=>s.records.some(r=>r.status==='sent'));await post('stop');await until(s=>!s.busy);
  await post('pipeline-config',{modelConcurrency:3});assert.equal((await state()).pipeline.modelConcurrency,3);
  const upload=await fetch(base+'/api/media-upload?workId=123&name=facts.txt',{method:'POST',headers:{'x-local-app':'douyin-reply'},body:'approved media'});assert.ok(upload.ok);
  const full=await post('backup-full');assert.ok(full.files>=2);assert.equal((await post('backup-verify',{folder:full.folder})).valid,true);
  const bytes=zipSync({'word/document.xml':strToU8('<w:document xmlns:w="test"><w:body><w:p><w:r><w:t>Imported confirmed facts</w:t></w:r></w:p></w:body></w:document>')});const parsed=await fetch(base+'/api/knowledge-import?name=facts.docx',{method:'POST',headers:{'x-local-app':'douyin-reply'},body:bytes});assert.match((await parsed.json()).text,/Imported confirmed facts/);
  const stats=await post('operations-status');assert.equal(stats.works[0].sent,1);assert.equal(stats.works[0].models.calls,1);
  const second=await post('accounts-create',{name:'Second'});await post('accounts-select',{id:second.id});assert.equal((await state()).official.authorized,false);await post('accounts-select',{id:'default'});assert.equal((await state()).official.authorized,true);
  browser=await chromium.launch({headless:true});const page=await browser.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));await page.goto(base);await page.waitForSelector('#pipelineSummary');await page.locator('#operationsRefresh').click();await page.waitForFunction(()=>document.querySelector('#operationStats').textContent.includes('123'));assert.equal(await page.locator('#officialAccountSelect option').count(),2);assert.deepEqual(pageErrors,[]);
  console.log('Operations flow passed: draft review/explicit approval sends with autoSend off, concurrency setting, full backup integrity, DOCX import, statistics, account switching and UI. Mock upstream only.');
}finally{if(browser)await browser.close();if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.send({type:'shutdown'});setTimeout(()=>child.kill(),5000).unref();});await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
