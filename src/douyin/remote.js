import {registerSecret} from '../security/redaction.js';
import {scanComments} from '../comments/scanner.js';
import {officialComment} from './official.js';
export class RemoteOfficial{
  constructor(_db,{env=process.env,slot='default'}={}){this.slot=slot;this.env=env;this.cooldown=0;this.info={configured:true,authorized:false};this.token=null;registerSecret(env.COMMENTPILOT_BROKER_TOKEN);const u=new URL(env.COMMENTPILOT_BROKER_URL);if(u.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(u.hostname))throw Error('授权服务必须使用HTTPS');this.base=u.origin;}
  async rpc(action,body={}){let response;try{response=await fetch(this.base+'/v1/'+encodeURIComponent(this.slot)+'/'+action,{method:'POST',headers:{Authorization:'Bearer '+this.env.COMMENTPILOT_BROKER_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(35000),redirect:'error'});}catch{throw Error('授权服务连接失败或超时，提交类请求不能自动重发');}let result;try{result=await response.json();}catch{throw Error('授权服务响应无效');}if(!response.ok)throw Object.assign(Error('授权服务请求失败，请检查授权、权限或服务状态'),{upstreamStatus:response.status,retryAt:result.retryAt});if(result.status)this.update(result.status);return result;}
  update(status){const {ownerId,fingerprint,...info}=status;this.info=info;this.fingerprint=fingerprint;this.token=ownerId?{open_id:ownerId}:null;this.cooldown=info.cooldownUntil||0;}
  async load(){try{this.update(await this.rpc('status'));}catch{this.info={configured:true,authorized:false,connectionError:true};}return this;}
  status(){return {...this.info,remote:true};}
  accountFingerprint(){return this.fingerprint||null;}
  async authorize(){return this.rpc('authorize');}
  async accept(){await this.load();if(!this.info.authorized)throw Error('请先在浏览器完成服务端授权，再刷新状态');return this.status();}
  async ready(){const status=await this.rpc('status');this.update(status);if(!status.authorized)throw Error('请先通过授权服务完成抖音授权');}
  async disconnect(){await this.rpc('disconnect');this.info.authorized=false;this.token=null;this.fingerprint=null;}
  async works(){return (await this.rpc('works')).works;}
  async work(id){return (await this.rpc('work',{id})).work;}
  async commentPage(id,cursor=0){return (await this.rpc('commentPage',{id,cursor})).page;}
  async preview(id){await this.ready();return (await this.commentPage(id)).list.map(c=>officialComment(c,this.token.open_id));}
  async scan(id,checkpoint){await this.ready();const scan=await scanComments(cursor=>this.commentPage(id,cursor),checkpoint);return {...scan,comments:scan.comments.map(c=>officialComment(c,this.token.open_id))};}
  async replies(id,commentId){return (await this.rpc('replies',{id,commentId})).replies;}
  async events(after=0){return (await this.rpc('events',{after})).events;}
  async reply(id,comment,text,{guard=()=>true}={}){if(!guard())throw Object.assign(Error('已暂停，未提交'),{code:'NOT_SUBMITTED'});return (await this.rpc('reply',{id,comment,text})).replyId;}
}
