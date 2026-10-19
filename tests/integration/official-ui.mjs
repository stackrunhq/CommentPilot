import {fork} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const dir=await mkdtemp(path.join(tmpdir(),'commentpilot-official-')),base='http://127.0.0.1:3278';
const child=fork('src/app/server.js',[],{env:{...process.env,APP_PORT:'3278',APP_DATA_DIR:dir,DEEPSEEK_API_KEY:'',APP_BROWSER_FIXTURE:'',DOUYIN_CLIENT_KEY:'',DOUYIN_CLIENT_SECRET:'',DOUYIN_REDIRECT_URI:''},silent:true});
let browser;
try{
  let started=false;for(let i=0;i<100;i++){try{started=(await fetch(base+'/api/health')).ok;if(started)break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(started,'isolated backend startup');
  const state=await (await fetch(base+'/api/state')).json();assert.equal(state.transport,'official');assert.equal(state.official.configured,false);
  const post=async(name,body={})=>{const r=await fetch(base+'/api/'+name,{method:'POST',headers:{'Content-Type':'application/json','x-local-app':'douyin-reply'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  for(const name of ['browser','connect','official-authorize','official-works']){const result=await post(name);assert.equal(result.status,400);assert.ok(result.body.error);}
  browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
  await page.waitForFunction(()=>document.querySelector('#officialStatus')?.textContent.includes('等待管理员'));
  assert.equal(await page.locator('#officialPanel').isVisible(),true);assert.equal(await page.locator('[data-action="browser"]').isVisible(),false);
  await page.getByRole('button',{name:'抖音授权',exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes('Client Key'));
  assert.deepEqual(errors,[]);console.log('Official default backend/UI smoke passed; no browser transport or Douyin network request used.');
}finally{if(browser)await browser.close();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.send({type:'shutdown'});setTimeout(()=>child.kill(),5000).unref();});await rm(dir,{recursive:true,force:true});}
