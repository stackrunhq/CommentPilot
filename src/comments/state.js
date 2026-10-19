import {randomUUID} from 'node:crypto';
import {workId} from '../works/identity.js';
import {commentKey} from './identity.js';

export function publishedRange(label,observedAt){
  const now=new Date(observedAt).getTime();if(!Number.isFinite(now))return null;
  const text=String(label||'').trim();
  if(text==='刚刚'||text.startsWith('刚刚·'))return {earliest:now-60000,latest:now};
  const relative=text.match(/^(\d+)\s*(秒|分钟|小时|天)前/);
  if(relative){const unit={'秒':1000,'分钟':60000,'小时':3600000,'天':86400000}[relative[2]],value=Number(relative[1]);return {earliest:now-(value+1)*unit,latest:now-value*unit};}
  return null;
}
export function identity(comment,target){if(comment.source==='douyin-official'&&comment.commentId)return `${target}:official:${commentKey(target,'official-id',comment.commentId)}`;return comment.commentId&&/^\d+$/.test(comment.commentId)?`${target}:${comment.commentId}`:commentKey(target,comment.author,comment.text);}
export function recordBelongsToWork(record,video,target){return (target&&record.workId===target)||(target&&workId(record.video)===target)||record.video===video;}
const belongs=recordBelongsToWork;
function locate(records,comment,video,target){return records.find(r=>{
  if(r.simulated||r.source==='manual-import'||!belongs(r,video,target))return false;
  if((comment.source==='douyin-official')!==(r.source==='douyin-official'))return false;
  if(comment.commentId&&r.commentId)return r.commentId===comment.commentId;
  if(comment.commentId&&!r.commentId&&!['sent','sending','uncertain','ignored_history','observed'].includes(r.status))return false;
  if(!comment.commentId&&r.commentId)return false;
  return r.author===comment.author&&r.text===comment.text;
});}
function append(records,comment,video,target,status,reason,sessionId,now){
  const record={...comment,key:identity(comment,target),video,workId:target,status,reason,sessionId,reply:'',created:now};records.unshift(record);return record;
}
export function establishBaseline(records,comments,{video,target,now=new Date().toISOString()}){
  const session={sessionId:randomUUID(),since:now,baselineCount:comments.length,target};
  for(const record of records)if(!record.simulated&&record.source!=='manual-import'&&belongs(record,video,target)&&['new','generating','draft','error','pending_time','observed'].includes(record.status)){record.status='ignored_history';record.reason='启动前的未发送任务不补发';}
  for(const comment of comments){const existing=locate(records,comment,video,target);if(!existing)append(records,comment,video,target,'ignored_history','启动时已存在',session.sessionId,now);}
  return session;
}
export function ingestComments(records,comments,{video,target,ownName,session,now=new Date().toISOString()}){
  const stats={visible:comments.length,added:0,own:0,history:0,unverified:0,duplicate:0};
  for(const comment of comments){
    let record=locate(records,comment,video,target);
    if(record&&record.status!=='pending_time'){stats.duplicate++;continue;}
    let status,reason;
    if(!session){status='observed';reason='尚未启动监听，不加入自动队列';}
    else if(comment.isOwn||(comment.source!=='douyin-official'&&comment.author.trim()===ownName.trim())){status='ignored_own';reason='自己的评论';stats.own++;}
    else if(!comment.commentId||(comment.source!=='douyin-official'&&!/^\d+$/.test(comment.commentId))){status='ignored_unverified';reason='缺少稳定评论 ID，避免误认历史评论';stats.unverified++;}
    else{
      const exact=Date.parse(comment.publishedAt),observed=Date.parse(now);
      const range=Number.isFinite(exact)&&exact<=observed+5000?{earliest:exact,latest:exact}:publishedRange(comment.publishedLabel,now),since=new Date(session.since).getTime();
      if(!range){status='ignored_unverified';reason='无法确定发布时间，保守跳过';stats.unverified++;}
      else if(range.latest<since){status='ignored_history';reason='发布时间早于本次监听';stats.history++;}
      else if(range.earliest<since){status='pending_time';reason='发布时间跨越启动边界，等待进一步确认';stats.unverified++;}
      else{status='new';reason='本次监听启动后发布的新评论';stats.added++;}
    }
    if(record){Object.assign(record,{publishedLabel:comment.publishedLabel,publishedAt:comment.publishedAt,status,reason,sessionId:session?.sessionId});}
    else append(records,comment,video,target,status,reason,session?.sessionId,now);
  }
  return stats;
}
