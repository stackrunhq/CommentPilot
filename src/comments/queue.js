import {randomUUID} from 'node:crypto';
import {redactText} from '../security/redaction.js';
import {errorCode} from '../observability/logger.js';

export function retryable(error){const status=Number(error?.upstreamStatus);if([401,403,404].includes(status))return false;if(status===429||status===408||status>=500)return true;return /超时|连接失败|冷却|限流|ECONN|ETIMEDOUT/i.test(String(error?.message||''));}
export function retryDelay(attempt){return Math.min(300000,15000*2**Math.max(0,attempt-1));}
export class CommentQueue{
  constructor(db,{now=()=>Date.now()}={}){this.db=db;this.now=now;db.exec('CREATE TABLE IF NOT EXISTS comment_tasks(id TEXT PRIMARY KEY,account TEXT NOT NULL,work_id TEXT NOT NULL,session_id TEXT NOT NULL,comment_key TEXT NOT NULL,stage TEXT NOT NULL,status TEXT NOT NULL,next_at INTEGER NOT NULL,created INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(account,work_id,session_id,comment_key)); CREATE INDEX IF NOT EXISTS task_due ON comment_tasks(account,work_id,status,next_at);');}
  list(account,work){return this.db.prepare('SELECT data FROM comment_tasks WHERE account=? AND work_id=? ORDER BY created,id').all(account||'',work||'').map(r=>JSON.parse(r.data));}
  save(t){t.updatedAt=this.now();this.db.prepare('INSERT INTO comment_tasks VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET stage=excluded.stage,status=excluded.status,next_at=excluded.next_at,data=excluded.data').run(t.id,t.account,t.workId,t.sessionId,t.commentKey,t.stage,t.status,t.nextAt,t.created,JSON.stringify(t));return t;}
  ensure({account,workId,sessionId,commentKey,stage='generate'}){const row=this.db.prepare('SELECT data FROM comment_tasks WHERE account=? AND work_id=? AND session_id=? AND comment_key=?').get(account,workId,sessionId,commentKey);if(row)return JSON.parse(row.data);return this.save({id:randomUUID(),account,workId,sessionId,commentKey,stage,status:'ready',attempts:0,nextAt:0,created:this.now()});}
  claim(account,work,session,{verifyOnly=false,stage}={}){
    if(stage&&!['generate','send'].includes(stage))throw Error('Invalid task stage');
    const row=this.db.prepare(`SELECT data FROM comment_tasks WHERE account=? AND work_id=? AND status IN ('ready','retry_wait') AND next_at<=? AND ${verifyOnly?"stage='verify'":`${stage?'stage=?':"stage!='verify'"} AND session_id=?`} ORDER BY created,id LIMIT 1`).get(...[account,work,this.now(),...(verifyOnly?[]:[...(stage?[stage]:[]),session])]);if(!row)return null;
    const t=JSON.parse(row.data);const changed=this.db.prepare("UPDATE comment_tasks SET status='running' WHERE id=? AND status IN ('ready','retry_wait')").run(t.id);if(!changed.changes)return null;t.status='running';t.attempts++;return this.save(t);
  }
  advance(t,stage,status='ready'){return this.save({...t,stage,status,attempts:0,nextAt:0,lastError:'',errorCode:''});}
  fail(t,error,{retry=false,limit=3}={}){return this.save({...t,status:retry&&t.attempts<limit?'retry_wait':t.stage==='verify'?'review':'blocked',nextAt:Math.max(this.now()+retryDelay(t.attempts),Number(error.retryAt)||0),lastError:redactText(error.message),errorCode:errorCode(error)});}
  recover(){for(const row of this.db.prepare("SELECT data FROM comment_tasks WHERE status='running'").all()){const t=JSON.parse(row.data);this.save({...t,status:t.stage==='send'||t.stage==='verify'&&t.attempts>=3?'review':t.attempts>=3?'blocked':'retry_wait',nextAt:0,lastError:'上次任务被程序退出中断；发送任务不能直接重发'});}}
  cancelOtherSessions(account,work,session){for(const t of this.list(account,work))if(t.sessionId!==session&&t.stage!=='verify'&&!['done','cancelled'].includes(t.status))this.save({...t,status:'cancelled'});}
  summaries(account,work){return this.db.prepare('SELECT data FROM comment_tasks WHERE account=? AND work_id=? ORDER BY created DESC,id DESC LIMIT 200').all(account||'',work||'').reverse().map(row=>{const {id,commentKey,stage,status,attempts,nextAt,errorCode}=JSON.parse(row.data);return {id,commentKey,stage,status,attempts,nextAt,errorCode};});}
  stats(account,work){return this.db.prepare('SELECT status,count(*) count FROM comment_tasks WHERE account=? AND work_id=? GROUP BY status').all(account||'',work||'');}
  backlog(account,work){const row=this.db.prepare("SELECT count(*) count,min(created) oldest FROM comment_tasks WHERE account=? AND work_id=? AND status IN ('ready','retry_wait','running') AND stage!='verify'").get(account||'',work||'');return {count:row.count,oldestAgeSeconds:row.oldest===null?0:Math.max(0,Math.floor((this.now()-row.oldest)/1000))};}
  verificationDue(account,work){return !!this.db.prepare("SELECT 1 FROM comment_tasks WHERE account=? AND work_id=? AND stage='verify' AND status IN ('ready','retry_wait') AND next_at<=? LIMIT 1").get(account||'',work||'',this.now());}
}
