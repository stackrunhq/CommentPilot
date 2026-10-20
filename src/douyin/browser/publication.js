export function publishPayload(payload){try{return typeof payload==='string'?(payload.trim().startsWith('{')?JSON.parse(payload):Object.fromEntries(new URLSearchParams(payload))):payload;}catch{return null;}}
export function matchesPublishRequest(payload,expected){const p=publishPayload(payload);if(!p)return false;const parent=String(p.reply_to_reply_id&&p.reply_to_reply_id!=='0'?p.reply_to_reply_id:p.reply_id||'');return String(p.aweme_id)===expected.workId&&parent===expected.parentId&&p.text===expected.text;}
export function parsePublication(url,payload,body,startedAt){
 let u;try{u=new URL(url);}catch{return null;}if(!u.hostname.endsWith('.douyin.com')||!u.pathname.endsWith('/comment/publish/')||body.status_code!==0)return null;
 const p=publishPayload(payload);
 const c=body.comment;if(!p||typeof c?.cid!=='string'||!/^\d+$/.test(c.cid)||typeof c.text!=='string'||c.text!==p.text||!/^\d+$/.test(String(p.aweme_id||'')))return null;
 const parent=String(p.reply_to_reply_id&&p.reply_to_reply_id!=='0'?p.reply_to_reply_id:p.reply_id||'');if(!/^\d+$/.test(parent))return null;
 return {workId:String(p.aweme_id),parentId:parent,text:c.text,replyId:c.cid,author:c.user?.nickname,startedAt};
}
export function confirmedPublication(entries,{workId,parentId,text,ownName,since}){return entries.find(p=>p.startedAt>=since&&p.workId===workId&&p.parentId===parentId&&p.text===text&&(!p.author||p.author===ownName));}
export async function waitForPublicationOrReply(locator,before,entries,expected,timeout=15000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const hit=confirmedPublication(entries,expected);if(hit)return {method:'browser-publish-response',replyId:hit.replyId};try{const count=await locator.count();if(count>before&&await locator.nth(count-1).isVisible())return {method:'dom-exact-new-reply'};}catch{/* Navigation may remove the old DOM; a correlated publish response can still confirm. */}await new Promise(r=>setTimeout(r,200));}throw Error('未检测到关联发布成功响应或原评论新增回复');}
