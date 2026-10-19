// A negative query is never proof that a write did not happen.
export function reconcileReply(rows,submission,owner,now=Date.now()){
  if(!submission?.submittedAt||!Array.isArray(submission.beforeIds)||!owner)return {status:'unconfirmed',reason:'缺少发送快照或作者信息'};
  const start=Math.floor(Date.parse(submission.submittedAt)/1000)-2,end=Math.floor(now/1000)+5;
  const candidates=rows.filter(r=>r.comment_id&&r.comment_user_id===owner&&r.content===submission.text&&!submission.beforeIds.includes(String(r.comment_id))&&Number(r.create_time)>=start&&Number(r.create_time)<=end);
  const unique=[...new Map(candidates.map(r=>[String(r.comment_id),r])).values()];
  if(unique.length===1)return {status:'confirmed',replyId:String(unique[0].comment_id),publishedAt:new Date(Number(unique[0].create_time)*1000).toISOString()};
  return {status:'unconfirmed',reason:unique.length?'存在多个匹配回复，需人工核实':'尚未找到可确认回复；不会自动重发'};
}
