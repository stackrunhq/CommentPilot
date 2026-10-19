export function parseCommentTimes(url,body){
  let request;try{request=new URL(url);}catch{return [];}
  if(!request.hostname.endsWith('.douyin.com')||!request.pathname.includes('/comment/list/')||request.pathname.includes('/reply/'))return [];
  const target=request.searchParams.get('aweme_id');if(!/^\d+$/.test(target||''))return [];
  const comments=body.comments||body.data?.comments;if(!Array.isArray(comments))return [];
  return comments.flatMap(comment=>{
    const id=comment.cid??comment.comment_id,seconds=comment.create_time;
    if(typeof id!=='string'||!/^\d+$/.test(id)||!Number.isSafeInteger(seconds)||seconds<1000000000||seconds>5000000000)return [];
    return [{target,commentId:id,publishedAt:new Date(seconds*1000).toISOString()}];
  });
}
export function trackCommentTimes(browser){
  const cache=new Map();
  cache.snapshots=new Map();
  browser.on('response',async response=>{
    if(!response.url().includes('/comment/list/'))return;
    try{const body=await response.json();for(const item of parseCommentTimes(response.url(),body))cache.set(`${item.target}:${item.commentId}`,item.publishedAt);const snapshot=parseCommentSnapshot(response.url(),body);if(snapshot)cache.snapshots.set(snapshot.target,{...snapshot,receivedAt:Date.now()});if(cache.size>10000)for(const key of [...cache.keys()].slice(0,1000))cache.delete(key);}catch{}
  });
  return cache;
}
export function parseCommentSnapshot(url,body){
  let request;try{request=new URL(url);}catch{return null;}
  if(!request.hostname.endsWith('.douyin.com')||!request.pathname.includes('/comment/list/')||request.pathname.includes('/reply/'))return null;
  const target=request.searchParams.get('aweme_id');if(!/^\d+$/.test(target||'')||Number(request.searchParams.get('cursor')||0)!==0)return null;
  if(body.status_code!==undefined&&body.status_code!==0)return null;
  const raw=body.comments||body.data?.comments;if(!Array.isArray(raw))return null;
  const times=new Map(parseCommentTimes(url,body).map(c=>[c.commentId,c.publishedAt]));
  const comments=raw.flatMap(c=>{
    const id=c.cid??c.comment_id,author=c.user?.nickname,text=c.text;
    if(typeof id!=='string'||!/^\d+$/.test(id)||!author||typeof text!=='string'||!text.trim()||(c.reply_id&&String(c.reply_id)!=='0'))return [];
    return [{commentId:id,author:String(author),text:text.trim(),publishedAt:times.get(id),source:'浏览器评论列表响应'}];
  });
  return {target,comments,total:body.total??raw.length};
}
export async function waitForCommentSnapshot(cache,target,since,timeout=10000){
  const deadline=Date.now()+timeout;
  do{const snapshot=cache.snapshots?.get(target);if(snapshot&&snapshot.receivedAt>=since)return snapshot;if(Date.now()>=deadline)break;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<deadline);
  return null;
}
