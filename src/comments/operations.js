export function validatePolicy(input={}){const p={maxAgeMinutes:Number(input.maxAgeMinutes||0),maxBacklog:Number(input.maxBacklog||0),pauseGeneration:!!input.pauseGeneration};if(!Number.isInteger(p.maxAgeMinutes)||p.maxAgeMinutes<0||p.maxAgeMinutes>10080||!Number.isInteger(p.maxBacklog)||p.maxBacklog<0||p.maxBacklog>10000)throw Error('等待期限应为0～10080分钟，积压上限应为0～10000；0表示不限');return p;}
export function reviewTasks(queue,records,scope,{ids,decision}){
  if(!Array.isArray(ids)||ids.length<1||ids.length>100||!['approve','reject','regenerate'].includes(decision))throw Error('一次选择1～100个任务，操作无效');let changed=0;
  for(const id of new Set(ids)){const task=queue.list(scope.account,scope.workId).find(t=>t.id===id),r=records.find(r=>r.key===task?.commentKey);
    if(!task||task.sessionId!==scope.sessionId||task.stage==='verify'||task.status!=='review'||!r||r.submission||!['new','draft','error'].includes(r.status))continue;
    if(decision==='approve'&&(task.stage!=='send'||r.status!=='draft'||!r.reply?.trim()))continue;
    if(decision==='reject'){queue.save({...task,status:'cancelled',reviewReason:'user-rejected'});r.status='ignored_manual';}
    else if(decision==='regenerate'){r.status='new';queue.advance({...task,approved:false,created:Date.now()},'generate');}
    else queue.save({...task,status:'ready',approved:true,approvedAt:Date.now(),nextAt:0});changed++;
  }return {changed,skipped:new Set(ids).size-changed};
}
export function workStatistics(db){return db.prepare("SELECT work_id,count(*) comments,sum(status='sent') sent,sum(status='uncertain') uncertain,sum(status='error') errors FROM comments GROUP BY work_id").all().map(row=>({...row,models:db.prepare("SELECT count(*) calls,round(avg(json_extract(data,'$.durationMs'))) averageMs,sum(status='failed') failed FROM model_calls WHERE json_extract(data,'$.references.workId')=?").get(row.work_id)}));}
