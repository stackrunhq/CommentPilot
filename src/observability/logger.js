import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,existsSync,statSync,renameSync,appendFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {redact,redactText} from '../security/redaction.js';

const context=new AsyncLocalStorage();
export function traceContext(){return context.getStore()||{};}
export function traceRun(operation,fn){return context.run({traceId:randomUUID(),operation},fn);}
export function errorCode(error){const m=String(error?.message||'');if(error?.code&&/^[A-Z_]{2,40}$/.test(error.code))return error.code;if(/401|Key 无效/.test(m))return 'AUTH_FAILED';if(/429|限流|冷却/.test(m))return 'RATE_LIMITED';if(/权限|授权|403/.test(m))return 'AUTHORIZATION_REQUIRED';if(/超时|timeout/i.test(m))return 'TIMEOUT';if(/连接失败|ECONN/i.test(m))return 'CONNECTION_FAILED';if(/资料|知识库|背景/.test(m))return 'GROUNDING_INVALID';if(/取消/.test(m))return 'CANCELLED';return 'OPERATION_FAILED';}
export function errorMetadata(error){return {errorCode:errorCode(error),...(Number.isFinite(error?.upstreamCode)?{upstreamCode:error.upstreamCode}:{}),...(Number.isFinite(error?.upstreamStatus)?{upstreamStatus:error.upstreamStatus}:{}),...(error?.upstreamRequestId?{requestId:String(error.upstreamRequestId)}:{})};}
const fields=['operation','outcome','status','durationMs','errorCode','traceId','sessionId','workId','commentId','commentKey','connectionId','mediaJobId','requestId','count','added','duplicate','history','own','unverified','baselineCount','autoSend','interval','transport','httpStatus','upstreamCode','upstreamStatus'];
export function safeMetadata(value){const out={};for(const key of fields){const v=value?.[key];if(typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean')out[key]=v;else if(typeof v==='string')out[key]=['workId','commentId','commentKey','connectionId','mediaJobId','requestId'].includes(key)?(/^ref_[a-f0-9]{20}$/.test(v)?v:'ref_'+createHash('sha256').update(v).digest('hex').slice(0,20)):redactText(v).slice(0,160);}return out;}
export class Logger{
  constructor(dir,{db,sessionId=randomUUID(),maxBytes=2*1024*1024,backups=3,retentionDays=30}={}){
    this.dir=path.join(dir,'logs');mkdirSync(this.dir,{recursive:true});this.file=path.join(this.dir,'application.jsonl');this.db=db;this.sessionId=sessionId;this.maxBytes=maxBytes;this.backups=backups;this.retentionDays=retentionDays;this.writes=0;this.failed=false;
    db?.exec('CREATE TABLE IF NOT EXISTS diagnostic_events(id INTEGER PRIMARY KEY,time TEXT NOT NULL,event TEXT NOT NULL,data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS diagnostic_time ON diagnostic_events(time);');this.prune();
  }
  prune(){if(!this.db)return;const before=new Date(Date.now()-this.retentionDays*86400000).toISOString();this.db.prepare('DELETE FROM diagnostic_events WHERE time<?').run(before);this.db.exec('DELETE FROM diagnostic_events WHERE id NOT IN (SELECT id FROM diagnostic_events ORDER BY id DESC LIMIT 10000)');}
  write(event,details={},level='info'){
    const entry={time:new Date().toISOString(),level:['info','warn','error'].includes(level)?level:'info',event:/^[a-z][a-z0-9_.-]{0,79}$/.test(event)?event:'application.event',...safeMetadata({...traceContext(),...details,sessionId:this.sessionId})};
    try{const line=JSON.stringify(entry)+'\n';if(existsSync(this.file)&&statSync(this.file).size+Buffer.byteLength(line)>this.maxBytes){for(let n=this.backups;n>=1;n--){const src=n===1?this.file:this.file+'.'+(n-1),dest=this.file+'.'+n;if(existsSync(dest))rmSync(dest);if(existsSync(src))renameSync(src,dest);}}appendFileSync(this.file,line,'utf8');this.db?.prepare('INSERT INTO diagnostic_events(time,event,data) VALUES(?,?,?)').run(entry.time,entry.event,JSON.stringify(entry));if(++this.writes%100===0)this.prune();}catch{this.failed=true;/* Logging failure must not fail a submitted reply. */}return entry;
  }
  message(message,details={}){return {time:new Date().toISOString(),message:redactText(message),...redact(details),...(details.workId?{workId:details.workId}:{}),...safeMetadata(traceContext())};}
  async operation(name,fn,metadata={}){return traceRun(name,async()=>{const began=Date.now();this.write('operation.started',{...metadata,operation:name});try{const result=await fn();this.write('operation.finished',{...metadata,operation:name,outcome:'succeeded',durationMs:Date.now()-began});return result;}catch(error){this.write('operation.finished',{...metadata,operation:name,outcome:'failed',durationMs:Date.now()-began,...errorMetadata(error)},'error');throw error;}});}
}
