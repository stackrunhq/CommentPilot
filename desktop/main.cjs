const {app,BrowserWindow,dialog}=require('electron');
const {fork}=require('node:child_process');
const net=require('node:net');
const path=require('node:path');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const smoke=process.argv.includes('--smoke-test');
if(smoke&&process.env.WORKBENCH_TEST_DATA_DIR){const isolated=path.join(process.env.WORKBENCH_TEST_DATA_DIR,'shell');fs.mkdirSync(isolated,{recursive:true});app.setPath('userData',isolated);}
let backend,window,quitting=false;
if(!app.requestSingleInstanceLock()){app.quit();}else{
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
  app.whenReady().then(launch).catch(error=>{if(smoke)fs.writeFileSync(path.join(process.env.WORKBENCH_TEST_DATA_DIR,'smoke-result.json'),JSON.stringify({ok:false,error:error.message}));else dialog.showErrorBox('启动失败',error.message);app.quit();});
}
async function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}
async function launch(){
  const root=app.isPackaged?path.join(process.resourcesPath,'backend'):path.resolve(__dirname,'..');
  const legacy=path.join(app.getPath('appData'),'DouyinReplyWorkbench');
  const data=process.env.WORKBENCH_TEST_DATA_DIR||(fs.existsSync(legacy)?legacy:path.join(app.getPath('appData'),'CommentPilot'));
  fs.mkdirSync(data,{recursive:true});
  const port=await freePort(),instanceId=randomUUID(),base=`http://127.0.0.1:${port}`;
  const env={...process.env,ELECTRON_RUN_AS_NODE:'1',APP_PORT:String(port),APP_INSTANCE_ID:instanceId,APP_DATA_DIR:data};
  if(process.argv.includes('--smoke-test')){env.APP_SMOKE_TEST='1';env.DEEPSEEK_API_KEY='';}
  if(app.isPackaged)env.PLAYWRIGHT_BROWSERS_PATH=path.join(process.resourcesPath,'browsers');
  backend=fork(path.join(root,'server.js'),[],{cwd:root,execPath:process.execPath,env,silent:true,windowsHide:true});
  const log=fs.createWriteStream(path.join(data,'backend.log'),{flags:'a'});
  backend.stdout.pipe(log,{end:false});backend.stderr.pipe(log,{end:false});
  let exited=false;backend.on('exit',()=>{exited=true;if(!quitting){if(!smoke)dialog.showErrorBox('后台服务已停止','请重新打开应用。诊断日志位于：\n'+path.join(data,'backend.log'));app.quit();}});
  const deadline=Date.now()+30000;let ready=false;
  while(Date.now()<deadline&&!exited){try{const response=await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)});const health=await response.json();if(health.instanceId===instanceId){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}
  if(!ready)throw Error('本地后台未能启动，请检查 '+path.join(data,'backend.log'));
  window=new BrowserWindow({width:1380,height:960,minWidth:850,minHeight:650,title:'CommentPilot',icon:path.join(__dirname,'..','build','icon.png'),show:false,autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==base)event.preventDefault();});
  await window.loadURL(base);window.show();
  // Isolated release verification: no model requests, logins, or posting.
  if(process.argv.includes('--smoke-test')){
    try{
      const state=await(await fetch(base+'/api/state')).json();
      if(state.keyConfigured||state.records.length||state.config.video)throw Error('Release contains private configuration');
      const cdp=window.webContents.debugger;cdp.attach('1.3');
      const target=await cdp.sendCommand('Runtime.evaluate',{expression:'document.title',returnByValue:true});
      if(target.result.value!=='CommentPilot')throw Error('UI did not load');
      const check=await fetch(base+'/api/connect',{method:'POST',headers:{'Content-Type':'application/json','X-Local-App':'douyin-reply'},body:'{}'});
      // Empty release configuration must reject navigation rather than touch an account.
      if(check.status!==400)throw Error('Empty video validation failed');
      const browserState=await(await fetch(base+'/api/state')).json();if(!browserState.browserOpen)throw Error('Bundled Chromium did not launch');
      const runtime=await fetch(base+'/api/runtime-test',{method:'POST',headers:{'Content-Type':'application/json','X-Local-App':'douyin-reply'},body:'{}'});const runtimeResult=await runtime.json();if(!runtime.ok||!runtimeResult.ocrOk||!runtimeResult.databaseOk||!runtimeResult.encryptionOk)throw Error('Packaged runtime failed: '+JSON.stringify(runtimeResult));
      fs.writeFileSync(path.join(data,'smoke-result.json'),JSON.stringify({ok:true,port,version:app.getVersion(),records:state.records.length,chromium:true,ocr:true,database:true,encryption:true}));
    }catch(error){fs.writeFileSync(path.join(data,'smoke-result.json'),JSON.stringify({ok:false,error:error.message}));}
    app.quit();
  }
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
  if(quitting||!backend||backend.exitCode!==null)return;
  event.preventDefault();quitting=true;
  const timer=setTimeout(()=>{backend.kill();app.quit();},5000);
  backend.once('exit',()=>{clearTimeout(timer);app.quit();});
  if(backend.connected)backend.send({type:'shutdown'});else backend.kill();
});
