import {fork} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const dir=await mkdtemp(path.join(tmpdir(),'commentpilot-diagnostics-ui-')),base='http://127.0.0.1:3281',secret='fixture-credential-SENTINEL';let child,browser;
async function start(){child=fork('src/app/server.js',[],{env:{...process.env,APP_PORT:'3281',APP_DATA_DIR:dir,APP_BROWSER_FIXTURE:'',DEEPSEEK_API_KEY:''},silent:true});let errors='';child.stderr.on('data',b=>errors+=b);for(let n=0;n<100;n++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}if(child.exitCode!==null)throw Error(errors);await new Promise(r=>setTimeout(r,100));}throw Error('startup timeout');}
async function stop(){if(!child||child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.send({type:'shutdown'});setTimeout(()=>child.kill(),5000).unref();});}
const post=async(action,body={})=>{const res=await fetch(base+'/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','x-local-app':'douyin-reply'},body:JSON.stringify(body)});return {res,data:await res.json()};};
try{
  await start();await post('works-save',{url:'https://douyin.com/video/123',title:'private-title-SENTINEL',context:'private-background-SENTINEL'});await post('works-select',{id:'123'});await post('knowledge-save',{name:'private-name-SENTINEL',content:'private-knowledge-SENTINEL'});await post('sample',{text:'private-comment-SENTINEL'});
  // This request fails validation before any key is persisted, yet secret registration still protects errors.
  await post('connections-save',{name:'fixture',model:secret,apiKey:secret,provider:'custom',baseUrl:'invalid-base'});
  const failed=await post('official-works');assert.equal(failed.res.status,400);assert.equal(failed.data.traceId,failed.res.headers.get('x-trace-id'));assert.ok(failed.data.errorCode);
  const invalid=await fetch(base+'/api/config',{method:'POST',headers:{'Content-Type':'application/json','x-local-app':'douyin-reply'},body:'private-invalid-json-SENTINEL'});const invalidBody=await invalid.json();assert.ok(!JSON.stringify(invalidBody).includes('private-invalid-json-SENTINEL'));
  const before=(await post('diagnostics-export')).data;const json=JSON.stringify(before);for(const value of [secret,'private-title-SENTINEL','private-background-SENTINEL','private-name-SENTINEL','private-knowledge-SENTINEL','private-comment-SENTINEL',dir])assert.ok(!json.includes(value),value);
  const trace=before.operations.find(o=>o.traceId===failed.data.traceId);assert.equal(trace.operation,'official-works');assert.equal(trace.outcome,'failed');
  await stop();await start();const after=(await post('diagnostics-export')).data;assert.ok(after.operations.some(o=>o.traceId===failed.data.traceId),'traces survive restart');
  browser=await chromium.launch({headless:true});const page=await browser.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));await page.goto(base);await page.locator('nav [data-view="settings"]').click();
  const downloadPromise=page.waitForEvent('download');await page.locator('#diagnosticExport').click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/^CommentPilot-Diagnostics-.*\.json$/);const exported=await readFile(await download.path(),'utf8');assert.ok(JSON.parse(exported).events.length>0);for(const value of [secret,'private-comment-SENTINEL','private-knowledge-SENTINEL'])assert.ok(!exported.includes(value));await page.waitForFunction(()=>document.querySelector('#diagnosticSummary').textContent.includes('报告包含'));assert.deepEqual(pageErrors,[]);
  const log=await readFile(path.join(dir,'logs/application.jsonl'),'utf8');assert.ok(!log.includes(secret));assert.ok(!log.includes('private-comment-SENTINEL'));console.log('Diagnostic flow passed: request trace/error, privacy allowlist, restart persistence, settings download, clean log file. No actual external API calls.');
}finally{if(browser)await browser.close();await stop();await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
