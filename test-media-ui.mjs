import {fork} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import sharp from 'sharp';
const dir=await mkdtemp(path.join(tmpdir(),'commentpilot-media-ui-')),base='http://127.0.0.1:3280';
const child=fork('server.js',[],{env:{...process.env,APP_PORT:'3280',APP_DATA_DIR:dir,DEEPSEEK_API_KEY:'',APP_BROWSER_FIXTURE:''},silent:true});let browser;let errors='';child.stderr.on('data',b=>errors+=b);
const post=async(name,body={})=>{const r=await fetch(base+'/api/'+name,{method:'POST',headers:{'Content-Type':'application/json','x-local-app':'douyin-reply'},body:JSON.stringify(body)}),data=await r.json();assert.ok(r.ok,data.error);return data;};
try{
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(base+'/api/health')).ok;if(ready)break;}catch{}if(child.exitCode!==null)throw Error(errors);await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
  await post('works-save',{url:'https://www.douyin.com/video/123',title:'作品A'});await post('works-save',{url:'https://www.douyin.com/video/456',title:'作品B'});await post('works-select',{id:'123'});
  const image=path.join(dir,'source.png');await sharp(Buffer.from('<svg width="1000" height="240"><rect width="100%" height="100%" fill="white"/><text x="60" y="150" font-size="100" font-family="Arial" fill="black">TEST 123</text></svg>')).png().toFile(image);
  browser=await chromium.launch({headless:true});const page=await browser.newPage();const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));await page.goto(base);await page.locator('nav [data-view="media"]').click();await page.waitForSelector('#mediaPanel');
  await page.locator('#mediaCaption').fill('本作品完整文案：已确认的信息。');await page.locator('#saveMediaCaption').click();await page.waitForFunction(()=>document.body.textContent.includes('已保存本作品文案'));
  await page.locator('#mediaFiles').setInputFiles(image);await page.waitForFunction(()=>document.querySelector('#mediaAssetList').textContent.includes('source.png'));
  await page.locator('#mediaStart').click();await page.waitForFunction(()=>document.querySelector('#mediaJobStatus').textContent.includes('识别完成'),{},{timeout:120000});
  assert.match(await page.locator('#mediaResult').inputValue(),/TEST\s*123/i);assert.match(await page.locator('#mediaAdopted').textContent(),/未采用/);
  await page.locator('#mediaAccept').click();await page.waitForFunction(()=>document.querySelector('#mediaAdopted').textContent.includes('当前已核对采用'));
  let state=await (await fetch(base+'/api/state')).json();assert.equal(state.workContent.caption.text,'本作品完整文案：已确认的信息。');assert.equal(state.workContent.media.accepted,true);
  await post('works-select',{id:'456'});await page.reload();await page.waitForFunction(()=>document.querySelector('#mediaCaption')?.value==='');assert.equal(await page.locator('#mediaResult').inputValue(),'');assert.equal((await (await fetch(base+'/api/state')).json()).mediaAssets.length,0);
  await post('works-select',{id:'123'});await page.reload();await page.locator('nav [data-view="media"]').click();await page.waitForFunction(()=>document.querySelector('#mediaAdopted')?.textContent.includes('当前已核对采用'));
  await page.locator('#mediaUnaccept').click();await page.waitForFunction(()=>document.querySelector('#mediaAdopted').textContent.includes('未采用'));
  await page.locator('nav [data-view="models"]').click();assert.equal(await page.locator('#mediaPanel').isVisible(),false);
  assert.deepEqual(pageErrors,[]);await page.locator('nav [data-view="media"]').click();await page.screenshot({path:path.resolve('data/media-ui-preview.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'mobile layout should not overflow horizontally');
  state=await (await fetch(base+'/api/state')).json();assert.equal(state.workContent.media.accepted,false);console.log('Media UI passed with real image OCR: caption, binary upload, async recognition, review gate, work isolation, disable, navigation.');
}finally{if(browser)await browser.close();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.send({type:'shutdown'});setTimeout(()=>child.kill(),5000).unref();});await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
