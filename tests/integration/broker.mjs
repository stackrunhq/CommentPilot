import {fork} from 'node:child_process';
import {mkdtemp,writeFile,readdir,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {RemoteOfficial} from '../../src/douyin/remote.js';
const dir=await mkdtemp(path.join(tmpdir(),'cp-broker-')),control=path.join(dir,'fixture.json'),base='http://127.0.0.1:4323',token=randomBytes(32).toString('hex'),otherToken=randomBytes(32).toString('hex');let child;
try{
  await writeFile(control,JSON.stringify({comments:[]}));child=fork('src/broker/server.js',[],{execArgv:['--import',new URL('../fixtures/official-fetch.mjs',import.meta.url).href],env:{...process.env,BROKER_PORT:'4323',BROKER_DATA_DIR:dir,BROKER_ENCRYPTION_KEY:randomBytes(32).toString('hex'),BROKER_DEVICES:JSON.stringify({first:token,second:otherToken}),DOUYIN_CLIENT_KEY:'fixture-client',DOUYIN_CLIENT_SECRET:'fixture-secret',DOUYIN_REDIRECT_URI:'https://fixture.example/oauth/douyin/callback',OFFICIAL_FIXTURE_STATE:control,OFFICIAL_FIXTURE_SENDS:path.join(dir,'sends')},silent:true});let errors='';child.stderr.on('data',b=>errors+=b);
  let ready=false;for(let n=0;n<100;n++){try{const r=await fetch(base+'/v1/default/status',{method:'POST'});if(r.status===401){ready=true;break;}}catch{}if(child.exitCode!==null)throw Error(errors);await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
  const client=new RemoteOfficial(null,{env:{COMMENTPILOT_BROKER_URL:base,COMMENTPILOT_BROKER_TOKEN:token}});await client.load();assert.equal(client.status().authorized,false);
  const url=new URL((await client.authorize()).url),state=url.searchParams.get('state');
  assert.equal((await fetch(base+'/oauth/douyin/callback?code=fixture&state=wrong')).status,400);
  assert.equal((await fetch(base+'/oauth/douyin/callback?code=fixture&state='+state)).status,200);
  assert.equal((await fetch(base+'/oauth/douyin/callback?code=fixture&state='+state)).status,400,'callback one use');
  await client.accept();assert.equal(client.status().authorized,true);assert.equal(client.token.access_token,undefined);assert.equal((await client.works()).length,1);
  assert.equal((await client.preview('123')).length,0);assert.equal(await client.reply('123',{source:'douyin-official',commentId:'@new'},'reply'),'@reply-@new');
  const second=new RemoteOfficial(null,{env:{COMMENTPILOT_BROKER_URL:base,COMMENTPILOT_BROKER_TOKEN:otherToken}});await second.load();assert.equal(second.status().authorized,false,'device cannot inherit another device token');await assert.rejects(second.works());
  const response=await client.rpc('status');assert.equal(JSON.stringify(response).includes('fixture-access'),false);
  for(const name of await readdir(dir))if(name.endsWith('.sqlite'))assert.equal((await readFile(path.join(dir,name))).includes(Buffer.from('fixture-access')),false,'tokens encrypted on server');
  console.log('Broker passed: authenticated device isolation, one-time OAuth callback, encrypted server tokens, remote read/reply without returning credentials. Mock upstream only.');
}finally{if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
