import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {DouyinOfficial,commentRoute,officialComment,officialWorkUrl} from '../douyin-official.js';
import {establishBaseline,ingestComments,identity} from '../comment-state.js';

const env={DOUYIN_CLIENT_KEY:'fixture-client',DOUYIN_CLIENT_SECRET:'fixture-secret',DOUYIN_REDIRECT_URI:'https://fixture.example/callback'};
const response=(data,status=200)=>({ok:status===200,status,headers:new Headers(),json:async()=>({data:{error_code:0,...data}})});
test('official legacy share links normalize without trusting arbitrary hosts',()=>{assert.deepEqual(officialWorkUrl('https://www.iesdouyin.com/share/video/123/?region=CN'),{id:'123',url:'https://www.douyin.com/video/123'});assert.equal(officialWorkUrl('https://evil.example/share/video/123/'),null);});
function fixture(handler){const db=new DatabaseSync(':memory:'),requests=[];const client=new DouyinOfficial(db,{env,crypt:async(v,mode)=>mode==='unprotect'?Buffer.from(v,'base64').toString():Buffer.from(v).toString('base64'),fetcher:async(url,options)=>{requests.push({url,options});assert.equal(url.origin,'https://open.douyin.com');return handler(url,options);}});return {client,db,requests};}
function token(client,scope='item.comment'){client.token={access_token:'fixture-access',refresh_token:'fixture-refresh',open_id:'owner',scope,expiresAt:Date.now()+3600000};}
test('route follows actual granted scopes, never inferred account identity',()=>{assert.equal(commentRoute('user_info,item.comment'),'item');assert.equal(commentRoute('video.comment'),'video');assert.equal(commentRoute('video.comment,item.comment'),'item');assert.throws(()=>commentRoute('ma.item.comment'));});
test('OAuth state validation, one-time code exchange and encrypted persistence',async()=>{
  const {client,db,requests}=fixture(url=>{if(url.pathname==='/oauth/access_token/')return response({access_token:'fixture-access',refresh_token:'fixture-refresh',open_id:'owner',scope:'user_info,item.comment',expires_in:3600});return response({nickname:'作者',e_account_role:null});});
  const url=new URL(client.authorize().url),state=url.searchParams.get('state');
  await assert.rejects(()=>client.accept({code:'code',state:'wrong'}),/校验/);assert.equal(requests.length,0);
  await client.accept({code:'code',state});assert.equal(client.status().accountType,'unknown');assert.equal(client.status().nickname,'作者');
  assert.equal(db.prepare('SELECT encrypted FROM douyin_official_account').get().encrypted.includes('fixture-access'),false);
  client.token=null;await client.load();assert.equal(client.token.open_id,'owner');
  await assert.rejects(()=>client.accept({code:'code',state}),/校验/);assert.equal(requests.length,2);
  assert.equal(JSON.stringify(client.status()).includes('fixture-access'),false);db.close();
});
test('official item ID mapping, pagination, opaque comments and reply contract',async()=>{
  const {client,db,requests}=fixture((url,options)=>{
    if(url.pathname==='/video/list/')return response({list:[{share_url:'https://www.douyin.com/video/123',item_id:'@item+/==',title:'作品正文'}],has_more:false});
    if(url.pathname.endsWith('/list/'))return response({list:[{comment_id:'@opaque+/==',comment_user_id:'fan',content:'请问？',create_time:1800000000}],has_more:false});
    const body=JSON.parse(options.body);assert.equal(body.item_id,'@item+/==');assert.equal(body.comment_id,'@opaque+/==');assert.equal(url.searchParams.get('open_id'),'owner');return response({comment_id:'@reply'});
  });token(client);await assert.rejects(()=>client.work('123'),/作品列表/);await client.works();const comments=await client.comments('123');assert.equal(comments[0].text,'请问？');assert.equal(await client.reply('123',comments[0],'谢谢'),'@reply');
  assert.equal(requests[1].url.searchParams.get('item_id'),'@item+/==');
  await assert.rejects(()=>client.reply('123',{commentId:'123'},'text'),/官方通道/);db.close();
});
test('official opaque IDs remain distinct and only post-baseline fan comments queue',()=>{
  const records=[],video='https://douyin.com/video/123',since='2026-10-19T00:00:00.000Z';
  const session=establishBaseline(records,[],{video,target:'123',now:since});
  const rows=[officialComment({comment_id:'@1',comment_user_id:'fan',content:'同文',create_time:Date.parse(since)/1000+2},'owner'),officialComment({comment_id:'@2',comment_user_id:'fan',content:'同文',create_time:Date.parse(since)/1000+2},'owner'),officialComment({comment_id:'@3',comment_user_id:'owner',content:'自己',create_time:Date.parse(since)/1000+2},'owner'),officialComment({comment_id:'@4',comment_user_id:'fan',content:'旧',create_time:Date.parse(since)/1000-2},'owner')];
  const opts={video,target:'123',ownName:'',session,now:'2026-10-19T00:00:10Z'};
  const result=ingestComments(records,rows,opts);assert.equal(result.added,2);assert.equal(result.own,1);assert.equal(result.history,1);assert.notEqual(identity(rows[0],'123'),identity(rows[1],'123'));assert.equal(ingestComments(records,rows,opts).added,0);
});
test('pagination rejects incomplete results and repeated cursors instead of looping',async()=>{
  const {client,db,requests}=fixture(()=>response({list:[],has_more:true,cursor:1}));token(client);await assert.rejects(()=>client.paginate('/video/list/'),/游标/);assert.equal(requests.length,2);db.close();
});
test('refresh replaces access token and retains scope; platform errors never leak response descriptions',async()=>{
  const {client,db}=fixture(url=>url.pathname==='/oauth/refresh_token/'?response({access_token:'new-fixture',expires_in:3600}):response({error_code:2190008,description:'sensitive fixture-access'}));token(client);client.token.expiresAt=0;await client.ready();assert.equal(client.token.scope,'item.comment');assert.equal(client.token.access_token,'new-fixture');await assert.rejects(()=>client.request('/video/list/'),e=>e.message.includes('2190008')&&!e.message.includes('sensitive'));db.close();
});
test('rate limit cools down; write timeout is never automatically retried',async()=>{
  const f=fixture(()=>response({},429));token(f.client);await assert.rejects(()=>f.client.request('/video/list/'),/限流/);await assert.rejects(()=>f.client.request('/video/list/'),/冷却/);assert.equal(f.requests.length,1);f.db.close();
  const g=fixture(()=>{throw Error('network secret');});token(g.client);await assert.rejects(()=>g.client.request('/item/comment/reply/',{body:{content:'x'}}),/不会自动重试/);assert.equal(g.requests.length,1);g.db.close();
});
