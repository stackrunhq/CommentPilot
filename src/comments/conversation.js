export function conversationLimit(value=3){const n=Number(value);if(!Number.isInteger(n)||n<1||n>10)throw Error('最多回复轮数需为1～10的整数');return n;}
export function threadRecords(records,workId,rootId){return records.filter(r=>r.workId===workId&&(r.rootCommentId||r.commentId)===rootId&&!r.simulated&&r.source!=='manual-import');}
export function threadCount(records,workId,rootId){return threadRecords(records,workId,rootId).filter(r=>['sent','sending','uncertain','manual_confirmed'].includes(r.status)).length;}
export function followups(comments,records,{workId,ownName,maxRounds=3}){
  return comments.filter(c=>c.author!==ownName).map(c=>{const thread=threadRecords(records,workId,c.rootCommentId);const parent=comments.filter(p=>p.commentId===c.replyToCommentId&&p.author===ownName);const matched=parent.length===1?thread.filter(r=>r.status==='sent'&&r.reply===parent[0].text):[];
    const linked=matched.filter(r=>r.commentId===parent[0]?.replyToCommentId);
    const chain=[];let cursor=linked[0];const visited=new Set();while(cursor&&!visited.has(cursor.commentId)){visited.add(cursor.commentId);chain.unshift(cursor);cursor=thread.find(r=>r.commentId===cursor.parentRecordId);}
    const sameParticipant=linked.length===1&&((linked[0].authorId||c.authorId)?!!linked[0].authorId&&linked[0].authorId===c.authorId:linked[0].author===c.author);
    const eligible=sameParticipant&&threadCount(records,workId,c.rootCommentId)<maxRounds;
    return {...c,parentRecordId:linked[0]?.commentId,conversationReview:linked.length===1&&!sameParticipant,conversationPending:linked.length!==1,conversationBlocked:!eligible,conversationReason:linked.length!==1?'回复关系尚未加载，等待重查':!sameParticipant?'追问来自其他参与者，转人工避免串话':'已达到本条对话回复上限',conversationHistory:eligible?chain.filter(r=>r.status==='sent').slice(-10).map(r=>({author:r.author,comment:r.text,reply:r.reply})):[]};
  });
}
