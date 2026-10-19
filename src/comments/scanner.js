// Always revisit the head; advance a separate audit cursor in bounded batches.
// No early cutoff assumes that timestamps or pinned/recommended comments are ordered.
export async function scanComments(fetchPage,checkpoint={}, {budget=3,now=Date.now()}={}){
  const state=structuredClone(checkpoint||{}),comments=[],cursors=new Set(state.recentCursors||[]);let pages=0;
  const head=await fetchPage(0);pages++;validate(head);comments.push(...head.list);
  if(!head.has_more)return {comments,checkpoint:{cursor:0,pages:0,lastCompletedAt:now,lastHeadAt:now,recentCursors:[]},pages,complete:true};
  let cursor=state.cursor||head.cursor;
  if(String(head.cursor)==='0'||head.cursor==null)throw Error('官方分页游标异常，已停止扫描');
  if(!state.cursor)cursors.add('0');
  let total=Number(state.pages)||1;
  while(pages<budget){
    const marker=String(cursor);if(cursors.has(marker))throw Error('官方分页游标重复，已停止增量扫描');
    const page=await fetchPage(cursor);validate(page);pages++;total++;comments.push(...page.list);cursors.add(marker);
    if(!page.has_more)return {comments,checkpoint:{cursor:0,pages:0,lastCompletedAt:now,lastHeadAt:now,recentCursors:[]},pages,complete:true};
    if(page.cursor==null||String(page.cursor)===marker||cursors.has(String(page.cursor)))throw Error('官方分页游标重复，已停止增量扫描');cursor=page.cursor;
    if(total>200000)throw Error('扫描轮次过大，请暂停后重新启动监听');
  }
  return {comments,checkpoint:{cursor,pages:total,lastCompletedAt:state.lastCompletedAt||null,lastHeadAt:now,recentCursors:[...cursors].slice(-2048)},pages,complete:false};
}
function validate(page){if(!page||!Array.isArray(page.list))throw Error('官方评论分页格式异常');}
