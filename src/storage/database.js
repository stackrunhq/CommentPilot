import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,readFileSync,copyFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {protectSecret} from '../security/credentials.js';
import {validateConnection,providerPresets} from '../models/providers.js';
import {workId} from '../works/identity.js';
import {redact,redactText} from '../security/redaction.js';
import {traceContext,errorMetadata} from '../observability/logger.js';

export class Storage{
  constructor(dir){
    this.dir=dir;this.recordCache=new Map();mkdirSync(dir,{recursive:true});this.db=new DatabaseSync(path.join(dir,'commentpilot.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS app_state(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_connections(id TEXT PRIMARY KEY,data TEXT NOT NULL,secret TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS comments(key TEXT PRIMARY KEY,work_id TEXT,comment_id TEXT,status TEXT,created TEXT,data TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS comment_identity ON comments(work_id,comment_id) WHERE comment_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS comment_history ON comments(work_id,status,created);
      CREATE INDEX IF NOT EXISTS comment_work_latest ON comments(work_id);
      CREATE TABLE IF NOT EXISTS works(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS work_content_versions(id INTEGER PRIMARY KEY,work_id TEXT,created TEXT,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS monitor_sessions(work_id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS monitor_session_history(id TEXT PRIMARY KEY,work_id TEXT,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_calls(id TEXT PRIMARY KEY,comment_key TEXT,created TEXT,status TEXT,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS model_call_date ON model_calls(created);
      CREATE TABLE IF NOT EXISTS reply_attempts(id TEXT PRIMARY KEY,comment_key TEXT,created TEXT,status TEXT,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,time TEXT,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS managed_works(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS knowledge_bases(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS knowledge_versions(id TEXT,version INTEGER,data TEXT NOT NULL,PRIMARY KEY(id,version));
      INSERT OR IGNORE INTO schema_migrations VALUES(1);`);
    if(!this.db.prepare('SELECT 1 FROM app_state').get()){
      const legacy=path.join(dir,'state.json');let initial={};
      if(existsSync(legacy)){initial=JSON.parse(readFileSync(legacy,'utf8'));copyFileSync(legacy,path.join(dir,'state.pre-commentpilot.json'));}
      // Old builds never persisted keys. Drop any unexpected plaintext credential fields.
      if(initial.config){delete initial.config.apiKey;delete initial.config.key;}
      this.save(initial);
    }
    this.ensureDefault();
    // Idempotently register already-known works, without mixing their supplemental facts.
    const old=this.state();const ids=new Set([...Object.keys(old.workContents),...old.records.map(r=>r.workId||workId(r.video)).filter(Boolean)]);
    const current=workId(old.config?.video);if(current)ids.add(current);
    this.transaction(()=>{for(const id of ids)if(!this.work(id)){const content=old.workContents[id];this.saveWork({id,url:id===current?old.config.video:content?.url||`https://www.douyin.com/video/${id}`,title:content?.body?.slice(0,60)||`作品 ${id}`,context:id===current?old.config.context||'':'',connectionId:id===current?old.config.connectionId||'legacy-deepseek':'',knowledgeBaseId:''});}this.db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(2)').run();});
  }
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  load(){return JSON.parse(this.db.prepare('SELECT data FROM app_state WHERE id=1').get().data);}
  save(state){const changes=[];this.transaction(()=>{
    const {records=[],workContents={},monitors={},...rest}=state;
    this.db.prepare('INSERT OR REPLACE INTO app_state VALUES(1,?)').run(JSON.stringify(rest));
    const record=this.db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET work_id=excluded.work_id,comment_id=excluded.comment_id,status=excluded.status,created=excluded.created,data=excluded.data');
    for(const r of records){const serialized=JSON.stringify(r);if(this.recordCache.get(r.key)===serialized)continue;record.run(r.key,r.workId||workId(r.video)||null,r.simulated?null:r.commentId||null,r.status,r.created||'',serialized);changes.push([r.key,serialized]);}
    for(const [id,data]of Object.entries(workContents)){
      const serialized=JSON.stringify(data),old=this.db.prepare('SELECT data FROM works WHERE id=?').get(id);
      // Extraction timestamps change on every scan; version only meaningful context changes.
      const context=x=>JSON.stringify({body:x.body,ocr:x.ocr,images:x.imageUrls,caption:x.caption,media:x.media});
      if(!old||context(JSON.parse(old.data))!==context(data))this.db.prepare('INSERT INTO work_content_versions(work_id,created,data) VALUES(?,?,?)').run(id,new Date().toISOString(),serialized);
      this.db.prepare('INSERT OR REPLACE INTO works VALUES(?,?)').run(id,serialized);
    }
    for(const [id,data]of Object.entries(monitors)){this.db.prepare('INSERT OR REPLACE INTO monitor_sessions VALUES(?,?)').run(id,JSON.stringify(data));if(data.sessionId)this.db.prepare('INSERT OR REPLACE INTO monitor_session_history VALUES(?,?,?)').run(data.sessionId,id,JSON.stringify(data));}
  });for(const [key,data]of changes)this.recordCache.set(key,data);}
  state(){const state=this.load();state.records=this.db.prepare('SELECT data FROM comments ORDER BY rowid').all().map(x=>JSON.parse(x.data));state.workContents=Object.fromEntries(this.db.prepare('SELECT * FROM works').all().map(x=>[x.id,JSON.parse(x.data)]));state.monitors=Object.fromEntries(this.db.prepare('SELECT * FROM monitor_sessions').all().map(x=>[x.work_id,JSON.parse(x.data)]));return state;}
  ensureDefault(){if(this.connections().length)return;const state=this.load();const c={id:'legacy-deepseek',...validateConnection({...providerPresets.deepseek,provider:'deepseek',model:state.config?.model||'deepseek-chat'})};this.db.prepare('INSERT INTO model_connections VALUES(?,?,?)').run(c.id,JSON.stringify(c),'');}
  connections(){return this.db.prepare('SELECT * FROM model_connections').all().map(r=>({...JSON.parse(r.data),keyConfigured:!!r.secret}));}
  async connection(id){const r=this.db.prepare('SELECT * FROM model_connections WHERE id=?').get(id);if(!r)throw Error('模型连接不存在');return {...JSON.parse(r.data),key:r.secret?await protectSecret(r.secret,'unprotect'):''};}
  async saveConnection(input){const c={...validateConnection(input),id:input.id||randomUUID()};const old=this.db.prepare('SELECT secret FROM model_connections WHERE id=?').get(c.id);let inherited='';if(input.copyFromId){const source=this.db.prepare('SELECT data,secret FROM model_connections WHERE id=?').get(input.copyFromId);if(!source)throw Error('原模型连接不存在');const original=JSON.parse(source.data);if(original.provider!==c.provider||original.baseUrl!==c.baseUrl||original.auth!==c.auth)throw Error('仅允许同厂家、同地址的模型复用 Key');inherited=source.secret;}const secret=input.clearKey?'':input.apiKey?await protectSecret(String(input.apiKey).trim()):old?.secret||inherited;this.db.prepare('INSERT OR REPLACE INTO model_connections VALUES(?,?,?)').run(c.id,JSON.stringify(c),secret);return c;}
  deleteConnection(id){if(this.works().some(w=>w.connectionId===id))throw Error('该模型已绑定作品，请先为作品选择其他模型');this.db.prepare('DELETE FROM model_connections WHERE id=?').run(id);}
  works(){return this.db.prepare('SELECT data FROM managed_works ORDER BY rowid DESC').all().map(r=>{const w=JSON.parse(r.data);const counts=this.db.prepare("SELECT count(*) total,sum(CASE WHEN status='sent' THEN 1 ELSE 0 END) sent FROM comments WHERE work_id=?").get(w.id);return {...w,commentCount:counts.total,sentCount:counts.sent||0};});}
  work(id){const r=this.db.prepare('SELECT data FROM managed_works WHERE id=?').get(id);return r?JSON.parse(r.data):null;}
  saveWork(input){const id=workId(input.url)||input.id;if(!id||!/^\d+$/.test(id)||workId(input.url)!==id)throw Error('请填写具体作品链接，短链接请先在浏览器打开后复制完整地址');const old=this.work(id);const w={...old,...input,id,title:String(input.title||old?.title||`作品 ${id}`).trim().slice(0,120),context:String(input.context??old?.context??'').slice(0,20000),knowledgeBaseId:String(input.knowledgeBaseId??old?.knowledgeBaseId??''),connectionId:String(input.connectionId??old?.connectionId??''),updatedAt:new Date().toISOString()};delete w.commentCount;delete w.sentCount;if(w.knowledgeBaseId&&!this.knowledge(w.knowledgeBaseId))throw Error('知识库不存在');if(w.connectionId&&!this.connections().some(c=>c.id===w.connectionId))throw Error('模型连接不存在');this.db.prepare('INSERT OR REPLACE INTO managed_works VALUES(?,?)').run(id,JSON.stringify(w));return w;}
  knowledgeList(){return this.db.prepare('SELECT data FROM knowledge_bases ORDER BY rowid DESC').all().map(r=>JSON.parse(r.data));}
  knowledge(id){const r=this.db.prepare('SELECT data FROM knowledge_bases WHERE id=?').get(id);return r?JSON.parse(r.data):null;}
  saveKnowledge(input){const id=input.id||randomUUID(),old=this.knowledge(id),name=String(input.name||'').trim(),content=String(input.content||'').trim();if(!name||!content)throw Error('请填写知识库名称和内容');if(name.length>100||content.length>300000)throw Error('名称最多100字，知识库正文最多300000字符');const data={id,name,content,version:(old?.version||0)+1,updatedAt:new Date().toISOString()};this.transaction(()=>{this.db.prepare('INSERT OR REPLACE INTO knowledge_bases VALUES(?,?)').run(id,JSON.stringify(data));this.db.prepare('INSERT INTO knowledge_versions VALUES(?,?,?)').run(id,data.version,JSON.stringify(data));});return data;}
  deleteKnowledge(id){if(this.works().some(w=>w.knowledgeBaseId===id))throw Error('该知识库已绑定作品，请先解除绑定');this.db.prepare('DELETE FROM knowledge_bases WHERE id=?').run(id);}
  event(data){this.db.prepare('INSERT INTO events(time,data) VALUES(?,?)').run(new Date().toISOString(),JSON.stringify({...redact(data),...traceContext()}));}
  attempt(table,data){if(!['model_calls','reply_attempts'].includes(table))throw Error('Invalid table');const id=data.id||randomUUID();const record={...traceContext(),...data,id,...(data.error?{error:redactText(data.error)}:{})};this.db.prepare(`INSERT OR REPLACE INTO ${table} VALUES(?,?,?,?,?)`).run(id,data.commentKey||null,data.created||new Date().toISOString(),data.status,JSON.stringify(record));this.logger?.write(table==='model_calls'?'model.call':'reply.attempt',{...record,...(record.error?errorMetadata({message:record.error}):{}),durationMs:record.durationMs,outcome:['succeeded','sent'].includes(record.status)?'succeeded':['failed','uncertain','interrupted'].includes(record.status)?'failed':'running'});return id;}
  details(key){const read=table=>this.db.prepare(`SELECT data,status FROM ${table} WHERE comment_key=? ORDER BY created DESC`).all(key).map(x=>({...JSON.parse(x.data),status:x.status}));return {calls:read('model_calls'),attempts:read('reply_attempts')};}
  history(query={}){
    const clauses=[],args=[];for(const [field,column]of [['workId','work_id'],['status','status']])if(query[field]){clauses.push(`${column}=?`);args.push(String(query[field]));}
    if(query.search){clauses.push('data LIKE ?');args.push('%'+String(query.search).slice(0,200)+'%');}
    if(query.from){clauses.push('created>=?');args.push(String(query.from));}if(query.to){clauses.push('created<=?');args.push(String(query.to));}
    if(query.model){clauses.push('key IN (SELECT comment_key FROM model_calls WHERE data LIKE ?)');args.push('%'+String(query.model).slice(0,100)+'%');}
    const where=clauses.length?' WHERE '+clauses.join(' AND '):'';const total=this.db.prepare('SELECT count(*) AS n FROM comments'+where).get(...args).n;
    const page=Math.max(1,Number(query.page)||1),size=Math.max(1,Math.min(200,Number(query.size)||25));
    return {total,page,size,records:this.db.prepare('SELECT data FROM comments'+where+' ORDER BY rowid DESC LIMIT ? OFFSET ?').all(...args,size,(page-1)*size).map(x=>JSON.parse(x.data)),stats:this.db.prepare('SELECT status,count(*) AS count FROM comments'+where+' GROUP BY status').all(...args)};
  }
  async backup(){const folder=path.join(this.dir,'backups');mkdirSync(folder,{recursive:true});const file=path.join(folder,`CommentPilot-${Date.now()}.sqlite`);await backup(this.db,file);return file;}
  close(){this.db.close();}
}
