// Explicit --import preload, used only by the isolated end-to-end test.
import {readFile,appendFile} from 'node:fs/promises';
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{
  const u=new URL(input);if(u.origin!=='https://open.douyin.com'&&u.origin!=='http://127.0.0.1:19999')return originalFetch(input,options);
  const state=JSON.parse(await readFile(process.env.OFFICIAL_FIXTURE_STATE,'utf8'));
  if(u.pathname==='/item/comment/list/'&&process.env.OFFICIAL_FIXTURE_PAGES)await appendFile(process.env.OFFICIAL_FIXTURE_PAGES,String(u.searchParams.get('cursor'))+'\n');
  if(u.origin==='http://127.0.0.1:19999'){if(process.env.OFFICIAL_FIXTURE_MODELS)await appendFile(process.env.OFFICIAL_FIXTURE_MODELS,options.body+'\n');return Response.json({choices:[{message:{content:'请参考作品已确认的说明。'}}]});}
  let data;
  if(u.pathname==='/oauth/access_token/')data={access_token:'fixture-access',refresh_token:'fixture-refresh',scope:'user_info,video.list,item.comment',open_id:'fixture-owner',expires_in:3600};
  else if(u.pathname==='/oauth/userinfo/')data={nickname:'测试作者',e_account_role:null};
  else if(u.pathname==='/video/list/')data={list:state.works||[{item_id:'@official-item',share_url:'https://www.douyin.com/video/123',title:'已确认作品标题'}],has_more:false};
  else if(u.pathname==='/item/comment/list/')data=state.pages?.[u.searchParams.get('cursor')]||{list:state.byWork?.[u.searchParams.get('item_id')]||state.comments,has_more:false};
  else if(u.pathname==='/item/comment/reply/list/')data={list:state.replies||[],has_more:false};
  else if(u.pathname==='/item/comment/reply/'){
    await appendFile(process.env.OFFICIAL_FIXTURE_SENDS,JSON.stringify(JSON.parse(options.body))+'\n');
    if(state.failSend)throw Error('fixture write timeout');
    data={comment_id:'@reply-'+JSON.parse(options.body).comment_id};
  }else throw Error('Unexpected fixture API path');
  return Response.json({data:{error_code:0,...data}});
};
