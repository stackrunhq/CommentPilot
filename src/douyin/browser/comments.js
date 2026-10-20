export async function readComments(page,selectors,limit=100){
  const rows=page.locator(selectors.row);const result=[];
  for(let i=0;i<Math.min(await rows.count(),limit);i++){
    const row=rows.nth(i);if(!await row.isVisible())continue;
    const author=(await row.locator(selectors.author).first().innerText({timeout:1500})).trim();
    const text=(await row.locator(selectors.text).first().innerText({timeout:1500})).trim();
    if(author&&text){const marker=row.locator('[id^="tooltip_"]').first();const id=await marker.count()?await marker.getAttribute('id'):null;
      const publishedLabel=await row.locator(selectors.text).first().evaluate(e=>(e.nextElementSibling?.textContent||'').trim());
      result.push({author,text,publishedLabel,...(id?{commentId:id.replace('tooltip_','')}:{})});}
  }
  return result;
}
export async function uniqueComment(page,selectors,comment){
  const rows=page.locator(comment.rootCommentId?'[data-e2e="comment-list"] [data-e2e="comment-item"]':selectors.row);const matches=[];
  if(comment.commentId&&/^\d+$/.test(comment.commentId)){await rows.filter({has:page.locator(`[id="tooltip_${comment.commentId}"]`)}).first().waitFor({state:'visible',timeout:10000}).catch(()=>{});}
  for(let i=0;i<await rows.count();i++){
    const row=rows.nth(i);if(!await row.isVisible())continue;
    if(comment.commentId){const marker=row.locator('[id^="tooltip_"]').first();if(!await marker.count()||(await marker.getAttribute('id'))!==`tooltip_${comment.commentId}`)continue;}
    if((await row.locator(selectors.author).first().innerText({timeout:1500})).trim()===comment.author&&
       (await row.locator(selectors.text).first().innerText({timeout:1500})).trim()===comment.text)matches.push(row);
  }
  if(matches.length!==1){const error=Error('评论未显示或存在同名同文评论，请在浏览器定位后重试');if(matches.length===0)error.code='COMMENT_NOT_VISIBLE';throw error;}
  return matches[0];
}
export async function expandConversations(page,records,target){
  const roots=[...new Set(records.filter(r=>r.workId===target&&r.status==='sent'&&r.source!=='manual-import').map(r=>r.rootCommentId||r.commentId))].slice(0,20);
  for(const id of roots){if(!/^\d+$/.test(id||''))continue;const roots=page.locator('[data-e2e="comment-list"] [data-e2e="comment-item"]').filter({has:page.locator(`[id="tooltip_${id}"]`)});if(await roots.count()!==1)continue;
    const button=roots.getByText(/^(?:展开|查看|共).*\d+.*回复|^展开更多回复$/).filter({visible:true});if(await button.count()===1)await button.click({timeout:1500});
  }
}
export async function waitForNewReply(locator,before,timeout=10000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const count=await locator.count();if(count>before&&await locator.nth(count-1).isVisible())return;await new Promise(resolve=>setTimeout(resolve,200));}
  throw Error('未检测到新增回复');
}
export async function openComments(page){
  const existing=page.locator('[data-e2e="comment-list"]').filter({visible:true});
  if(await existing.count())return;
  const active=page.locator('[data-e2e="feed-active-video"]');
  const button=active.locator('[data-e2e="feed-comment-icon"]').filter({visible:true});
  await button.waitFor({state:'visible',timeout:15000});
  if(await button.count()!==1)throw Error('未能唯一定位当前作品评论入口，请手动展开评论区');
  await button.click({timeout:12000});
  await page.locator('[data-e2e="comment-list"]').filter({visible:true}).waitFor({state:'visible',timeout:20000});
}
export async function waitForCommentData(page){
  // The panel shell can be visible before its asynchronous comment request finishes.
  const header=page.getByText(/^全部评论\s*[（(][\d,.万]+[)）]$/).filter({visible:true});
  const text=await header.count()===1?(await header.innerText()):'';
  const count=Number(text.match(/[（(]([\d,]+)[)）]/)?.[1]?.replaceAll(',',''));
  if(Number.isFinite(count)&&count>0){
    await page.locator('[data-e2e="comment-list"] [data-e2e="comment-item"]').first().waitFor({state:'visible',timeout:20000});
  }else if(!await page.locator('[data-e2e="comment-list"] [data-e2e="comment-item"]').count()){
    await page.waitForFunction(()=>{
      const list=[...document.querySelectorAll('[data-e2e="comment-list"]')].find(e=>e.getClientRects().length);
      if(!list)return false;if(list.querySelector('[data-e2e="comment-item"]'))return true;
      const empty=/暂无评论|还没有评论|暂无更多评论|暂时没有更多评论/.test(list.textContent||'');
      const headers=[...document.querySelectorAll('div,span')].filter(e=>e.getClientRects().length&&/^全部评论\s*[（(]0[)）]$/.test(e.textContent?.trim()||''));
      return empty&&headers.length>0;
    },null,{timeout:20000});
  }
}
export const douyinSelectors={row:'[data-e2e="comment-list"] > div > [data-e2e="comment-item"]',author:'[data-click-from="title"]',text:'.comment-item-info-wrap + div',reply:'text="回复"',editor:'[contenteditable="true"]',send:'.comment-input-inner-container .commentInput-right-ct > div > span:last-child',sent:'@exact-reply-text'};
export async function adaptComments(page,current){await openComments(page);await waitForCommentData(page);const comments=await readComments(page,douyinSelectors);return {selectors:{...current,...douyinSelectors},comments};}
export async function activateReply(page,row,selectors){
  if(!await row.getByText('回复中',{exact:true}).count())await row.locator(selectors.reply).first().click({timeout:5000});
  const editor=page.locator(selectors.editor).filter({visible:true});
  try{await editor.waitFor({state:'visible',timeout:1500});}catch{
    const placeholder=page.getByText('留下你的精彩评论吧',{exact:true}).filter({visible:true});
    if(await placeholder.count()===1){try{await placeholder.click({timeout:1000});}catch{if(!await editor.count())throw Error('回复输入框未就绪，请检查登录状态');}}
  }
  await editor.waitFor({state:'visible',timeout:5000});
  if(await editor.count()!==1)throw Error('无法唯一定位回复输入框');
  return editor;
}
export async function fillReplyEditor(editor,text){
  if(await editor.evaluate(e=>e.classList.contains('public-DraftEditor-content'))){await editor.click();await editor.press('ControlOrMeta+A');await editor.press('Backspace');await editor.pressSequentially(text,{delay:10});}
  else await editor.fill(text);
  if((await editor.innerText()).trim()!==text.trim())throw Error('输入框内容未正确同步，未提交回复');
}
export async function assertReplyTarget(row,commentId){
 const active=row.getByText('回复中',{exact:true}).filter({visible:true});if(await active.count()!==1)throw Error('未确认原评论处于回复中，禁止发布为一级评论');
 const id=await active.evaluate(e=>e.closest('[data-e2e="comment-item"]')?.querySelector('[id^="tooltip_"]')?.id);if(id!==`tooltip_${commentId}`)throw Error('回复目标已变化，未提交');
}
