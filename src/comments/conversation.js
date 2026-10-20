export function conversationLimit(value=3){const n=Number(value);if(!Number.isInteger(n)||n<1||n>10)throw Error('最多回复轮数需为1～10的整数');return n;}
export function threadRecords(records,workId,rootId){return records.filter(r=>r.workId===workId&&(r.rootCommentId||r.commentId)===rootId&&!r.simulated&&r.source!=='manual-import');}
export function threadCount(records,workId,rootId){return threadRecords(records,workId,rootId).filter(r=>['sent','sending','uncertain','manual_confirmed'].includes(r.status)).length;}
export function followups(comments,records,{workId,ownName,maxRounds=3}){
  return comments.filter(c=>c.author!==ownName).map(c=>{const thread=threadRecords(records,workId,c.rootCommentId);const parent=comments.filter(p=>p.commentId===c.replyToCommentId&&p.author===ownName);const matched=parent.length===1?thread.filter(r=>r.status==='sent'&&r.reply===parent[0].text):[];
    const linked=matched.filter(r=>r.commentId===parent[0]?.replyToCommentId);
    const eligible=linked.length===1&&threadCount(records,workId,c.rootCommentId)<maxRounds;
    return {...c,conversationBlocked:!eligible,conversationReason:linked.length!==1?'无法唯一确认追问针对本程序的已发送回复':'已达到本条对话回复上限',conversationHistory:eligible?thread.filter(r=>r.status==='sent').sort((a,b)=>String(a.sentAt).localeCompare(String(b.sentAt))).slice(-10).map(r=>({author:r.author,comment:r.text,reply:r.reply})):[]};
  });
}
