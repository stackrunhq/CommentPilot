// Explicit preload for isolated tests only: render a synthetic page and capture its posts.
import {chromium} from 'playwright';
import {readFile,appendFile,writeFile} from 'node:fs/promises';
const launch=chromium.launchPersistentContext.bind(chromium);
chromium.launchPersistentContext=async(dir,options)=>{
  const context=await launch(dir,{...options,headless:true});
  function inject(page){const reload=page.reload.bind(page);page.reload=async(...args)=>{const state=JSON.parse(await readFile(process.env.PERSONAL_BROWSER_TEST_STATE,'utf8'));if(state.readFailures>0){state.readFailures--;await writeFile(process.env.PERSONAL_BROWSER_TEST_STATE,JSON.stringify(state));throw Object.assign(Error(state.navigationAbort?'page.reload: net::ERR_ABORTED; interrupted by another navigation':'page.reload: Timeout 30000ms exceeded'),{name:state.navigationAbort?'Error':'TimeoutError'});}return reload(...args);};}for(const page of context.pages())inject(page);context.on('page',inject);
  await context.route('https://www.douyin.com/**',async route=>{
    const url=new URL(route.request().url()),state=JSON.parse(await readFile(process.env.PERSONAL_BROWSER_TEST_STATE,'utf8'));
    if(url.pathname==='/fixture/send'){await appendFile(process.env.PERSONAL_BROWSER_TEST_SENDS,route.request().postData()+'\n');return route.fulfill({json:{ok:true}});}
    if(url.pathname.includes('/comment/list/reply/'))return route.fulfill({json:{comments:state.replies||[],status_code:0}});
    if(url.pathname.includes('/comment/list/'))return route.fulfill({json:{comments:state.comments,total:state.comments.length,status_code:0}});
    return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div data-e2e="video-desc">已确认资料：参考作品说明办理。</div>${state.challenge?'<div id="captcha">请完成安全验证</div>':''}<div data-e2e="comment-list"><div id="rows"></div></div><div contenteditable="true"></div><div class="comment-input-inner-container"><div class="commentInput-right-ct"><div><span id="send">发送</span></div></div></div><script>
let active;fetch('/aweme/v1/web/comment/list/?aweme_id=123&cursor=0').then(r=>r.json()).then(async data=>{const replies=await fetch('/aweme/v1/web/comment/list/reply/?item_id=123&comment_id=101').then(r=>r.json());for(const c of [...data.comments,...replies.comments]){const row=document.createElement('div');row.dataset.e2e='comment-item';const info=document.createElement('div');info.className='comment-item-info-wrap';const author=document.createElement('span');author.dataset.clickFrom='title';author.textContent=c.user.nickname;info.append(author);const text=document.createElement('div');text.textContent=c.text;const time=document.createElement('span');time.textContent='刚刚';const marker=document.createElement('i');marker.id='tooltip_'+c.cid;const reply=document.createElement('button');reply.textContent='回复';reply.onclick=()=>active={row,id:c.cid};row.append(info,text,time,marker,reply);document.querySelector('#rows').append(row);}});
document.querySelector('#send').onclick=async()=>{if(!active)return;const text=document.querySelector('[contenteditable]').textContent;await fetch('/fixture/send',{method:'POST',body:JSON.stringify({id:active.id,text})});const p=document.createElement('p');p.textContent=text;active.row.append(p);};</script>`});
  });return context;
};
