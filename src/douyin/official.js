import {randomBytes,createHash} from 'node:crypto';
import {protectSecret} from '../security/credentials.js';
import {workId} from '../works/identity.js';
import {registerSecret} from '../security/redaction.js';
import {scanComments} from '../comments/scanner.js';

const origin='https://open.douyin.com';
export function officialWorkUrl(value){
  try{const u=new URL(value);const id=workId(value);if(id)return {id,url:value};
    if(u.protocol!=='https:'||!['iesdouyin.com','www.iesdouyin.com','douyin.com','www.douyin.com'].includes(u.hostname))return null;
    const m=u.pathname.match(/^\/share\/(video|note)\/(\d+)\/?$/);return m?{id:m[2],url:`https://www.douyin.com/${m[1]}/${m[2]}`}:null;
  }catch{return null;}
}
export function commentRoute(scope){
  const scopes=new Set(String(scope||'').split(/[,\s]+/));
  if(scopes.has('item.comment'))return 'item';
  if(scopes.has('video.comment'))return 'video';
  throw Error('尚未授权 item.comment 或 video.comment 评论权限；小程序权限不能混用');
}
export function officialComment(c,openId){
  const id=String(c.comment_id||'');
  if(!id)throw Error('官方响应缺少评论 ID');
  const time=Number(c.create_time);
  return {source:'douyin-official',commentId:id,author:String(c.nickname||c.comment_user_id||'抖音用户'),authorId:String(c.comment_user_id||''),isOwn:!!openId&&c.comment_user_id===openId,text:String(c.content||''),publishedAt:Number.isFinite(time)&&time>0?new Date(time*1000).toISOString():null};
}

// No cookies, private APIs, or arbitrary URL forwarding. Secrets stay in DPAPI-encrypted SQLite.
export class DouyinOfficial{
  constructor(db,{fetcher=fetch,crypt=protectSecret,env=process.env}={}){
    this.db=db;this.fetcher=fetcher;this.crypt=crypt;this.env=env;this.pending=null;this.token=null;this.cooldown=0;
    db.exec('CREATE TABLE IF NOT EXISTS douyin_official_account (id INTEGER PRIMARY KEY CHECK(id=1), encrypted TEXT NOT NULL); CREATE TABLE IF NOT EXISTS douyin_official_works (account TEXT NOT NULL, work_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(account,work_id));');
  }
  async load(){const row=this.db.prepare('SELECT encrypted FROM douyin_official_account WHERE id=1').get();if(row)this.token=JSON.parse(await this.crypt(row.encrypted,'unprotect'));registerSecret(this.token?.access_token);registerSecret(this.token?.refresh_token);}
  status(){let route=null;try{route=commentRoute(this.token?.scope);}catch{}return {configured:!!(this.env.DOUYIN_CLIENT_KEY&&this.env.DOUYIN_CLIENT_SECRET&&this.env.DOUYIN_REDIRECT_URI),authorized:!!this.token,accountType:'unknown',accountTypeLabel:'官方未返回可可靠分类的身份信息',nickname:this.token?.nickname||'',route,scope:this.token?.scope||'',expiresAt:this.token?.expiresAt||null,cooldownUntil:this.cooldown||null};}
  async save(){registerSecret(this.token?.access_token);registerSecret(this.token?.refresh_token);const encrypted=await this.crypt(JSON.stringify(this.token));this.db.prepare('INSERT OR REPLACE INTO douyin_official_account VALUES(1,?)').run(encrypted);}
  async disconnect(){this.token=null;this.pending=null;this.db.prepare('DELETE FROM douyin_official_account').run();return {};}
  authorize(){
    if(!this.status().configured)throw Error('请先由应用管理员配置抖音 Client Key、Client Secret 和平台批准的回调地址');
    const redirect=new URL(this.env.DOUYIN_REDIRECT_URI);if(redirect.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(redirect.hostname))throw Error('授权回调必须使用 HTTPS');
    const state=randomBytes(32).toString('hex');this.pending={state,expires:Date.now()+600000};
    const url=new URL('/platform/oauth/connect/',origin);
    for(const [k,v]of Object.entries({client_key:this.env.DOUYIN_CLIENT_KEY,response_type:'code',scope:this.env.DOUYIN_SCOPES||'user_info,video.list,item.comment',redirect_uri:redirect.href,state}))url.searchParams.set(k,v);
    return {url:url.href};
  }
  async raw(endpoint,{params={},body,form=false,token}={}){
    if(Date.now()<this.cooldown)throw Object.assign(Error('抖音接口处于限流冷却期，请稍后继续'),{retryAt:this.cooldown,upstreamStatus:429});
    const url=new URL(endpoint,origin);for(const [k,v]of Object.entries(params))url.searchParams.set(k,String(v));
    let response;try{response=await this.fetcher(url,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(30000),headers:{...(token?{'access-token':token}:{}),...(body?{'Content-Type':form?'application/x-www-form-urlencoded':'application/json'}:{})},...(body?{body:form?new URLSearchParams(body):JSON.stringify(body)}:{})});}catch{throw Error('抖音官方接口连接失败或超时；提交类请求不会自动重试');}
    if(response.status===429){this.cooldown=Date.now()+Math.max(60,Math.min(3600,Number(response.headers.get('retry-after'))||60))*1000;throw Object.assign(Error('抖音接口限流，已停止请求并进入冷却期'),{retryAt:this.cooldown,upstreamStatus:429});}
    if(!response.ok)throw Object.assign(Error(`抖音官方接口 HTTP ${response.status}`),{upstreamStatus:response.status});
    let json;try{json=await response.json();}catch{throw Error('抖音官方接口返回无效 JSON');}
    const data=json.data;if(!data||typeof data!=='object')throw Error('抖音官方响应缺少 data');
    const code=Number(data.error_code??json.extra?.error_code??0);
    if(code!==0||Number(json.extra?.error_code||0)!==0)throw Object.assign(Error(`抖音官方接口错误 ${code||Number(json.extra.error_code)}；请核对授权、接口权限、作品支持情况或额度`),{upstreamCode:code||Number(json.extra.error_code),upstreamStatus:response.status,upstreamRequestId:json.extra?.logid||json.extra?.log_id});
    return data;
  }
  async accept({code,state}){
    if(!code||!this.pending||this.pending.expires<Date.now()||state!==this.pending.state)throw Error('授权状态校验失败或已过期，请重新授权');
    this.pending=null;
    const data=await this.raw('/oauth/access_token/',{form:true,body:{client_key:this.env.DOUYIN_CLIENT_KEY,client_secret:this.env.DOUYIN_CLIENT_SECRET,grant_type:'authorization_code',code}});
    if(!data.access_token||!data.open_id)throw Error('官方授权响应缺少令牌或用户 ID');
    // Do not carry a previous account’s token/profile across account changes.
    this.token={...data,expiresAt:Date.now()+Number(data.expires_in||0)*1000};await this.save();
    if(String(data.scope).split(/[,\s]+/).includes('user_info')){const info=await this.request('/oauth/userinfo/',{body:{access_token:data.access_token,open_id:data.open_id}});this.token.nickname=info.nickname||'';this.token.accountRole=info.e_account_role??null;await this.save();}
    return this.status();
  }
  async ready(){
    registerSecret(this.token?.access_token);registerSecret(this.token?.refresh_token);
    if(!this.token)throw Error('请先完成抖音官方授权；原浏览器登录不能替代官方授权');
    if(this.token.expiresAt>Date.now()+60000)return;
    if(!this.token.refresh_token)throw Error('抖音授权已过期，请重新授权');
    const old=this.token,data=await this.raw('/oauth/refresh_token/',{form:true,body:{client_key:this.env.DOUYIN_CLIENT_KEY,grant_type:'refresh_token',refresh_token:old.refresh_token}});
    if(!data.access_token||data.open_id&&data.open_id!==old.open_id)throw Error('刷新令牌响应异常，请重新授权');
    this.token={...old,...data,expiresAt:Date.now()+Number(data.expires_in||0)*1000};await this.save();
  }
  async request(endpoint,options={}){await this.ready();return this.raw(endpoint,{...options,params:{open_id:this.token.open_id,...options.params},token:this.token.access_token});}
  async paginate(endpoint,params={},maxPages=50){
    const list=[],seen=new Set();let cursor=0;
    for(let n=0;n<maxPages;n++){
      const d=await this.request(endpoint,{params:{...params,cursor,count:20}});
      if(!Array.isArray(d.list))throw Error('官方列表结构异常，未建立评论基线');
      list.push(...d.list);if(!d.has_more)return list;
      if(d.cursor==null||seen.has(String(d.cursor))||String(d.cursor)===String(cursor))throw Error('官方分页游标重复，已停止，避免死循环');
      seen.add(String(cursor));cursor=d.cursor;
    }
    throw Error('官方列表超过单轮分页上限，已停止；不会将不完整数据作为历史基线');
  }
  async works(){
    await this.ready();const items=await this.paginate('/video/list/');
    const result=[];for(const item of items){const mapped=officialWorkUrl(item.share_url);if(!mapped||!item.item_id)continue;const value={...mapped,title:item.title||'',itemId:String(item.item_id),cover:item.cover||'',source:'douyin-official'};this.db.prepare('INSERT OR REPLACE INTO douyin_official_works VALUES(?,?,?)').run(this.token.open_id,mapped.id,JSON.stringify(value));result.push(value);}return result;
  }
  async work(id){await this.ready();const row=this.db.prepare('SELECT payload FROM douyin_official_works WHERE account=? AND work_id=?').get(this.token.open_id,id);if(!row)throw Error('请先读取官方作品列表并选择已授权账号的作品；网页数字 ID 不能代替官方 item_id');return JSON.parse(row.payload);}
  async comments(id){const w=await this.work(id),route=commentRoute(this.token.scope);const rows=await this.paginate(`/${route}/comment/list/`,{item_id:w.itemId,sort_type:'time'});return rows.map(c=>officialComment(c,this.token.open_id));}
  async commentPage(id,cursor=0){const w=await this.work(id),route=commentRoute(this.token.scope);return this.request(`/${route}/comment/list/`,{params:{item_id:w.itemId,sort_type:'time',cursor,count:20}});}
  async preview(id){const page=await this.commentPage(id);if(!Array.isArray(page.list))throw Error('官方评论分页格式异常');return page.list.map(c=>officialComment(c,this.token.open_id));}
  async scan(id,checkpoint){const result=await scanComments(cursor=>this.commentPage(id,cursor),checkpoint);return {...result,comments:result.comments.map(c=>officialComment(c,this.token.open_id))};}
  async replies(id,commentId){const w=await this.work(id),route=commentRoute(this.token.scope);return this.paginate(`/${route}/comment/reply/list/`,{item_id:w.itemId,comment_id:commentId,sort_type:'time'});}
  async reply(id,comment,text,{guard=()=>true}={}){
    const w=await this.work(id),route=commentRoute(this.token.scope);
    if(comment.source!=='douyin-official'||!comment.commentId)throw Error('只能通过官方通道回复官方读取的评论，请重新建立监听');
    await this.ready();if(!guard())throw Object.assign(Error('已暂停，未提交回复'),{code:'NOT_SUBMITTED'});
    const result=await this.raw(`/${route}/comment/reply/`,{params:{open_id:this.token.open_id},token:this.token.access_token,body:{item_id:w.itemId,comment_id:comment.commentId,content:text}});
    if(!result.comment_id)throw Error('官方未返回回复 ID，结果不明，请人工核实');
    return String(result.comment_id);
  }
  accountFingerprint(){return this.token?createHash('sha256').update(this.token.open_id).digest('hex'):null;}
}
