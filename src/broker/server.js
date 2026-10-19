// Deploy separately behind HTTPS. OAuth secrets and tokens never enter the desktop package.
import http from 'node:http';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
import {DouyinOfficial} from '../douyin/official.js';
import {WebhookInbox} from './webhooks.js';
const env=process.env,key=Buffer.from(env.BROKER_ENCRYPTION_KEY||'','hex');if(key.length!==32)throw Error('BROKER_ENCRYPTION_KEY must be 32 random bytes in hex');
const devices=JSON.parse(env.BROKER_DEVICES||'{}');if(!Object.keys(devices).length||Object.values(devices).some(t=>typeof t!=='string'||t.length<32))throw Error('Provision device tokens of at least 32 characters');
const root=path.resolve(env.BROKER_DATA_DIR||'broker-data');await mkdir(root,{recursive:true});const clients=new Map(),states=new Map();
const crypt=async(value,mode)=>{if(mode==='unprotect'){const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8');}const nonce=randomBytes(12),c=createCipheriv('aes-256-gcm',key,nonce),out=Buffer.concat([c.update(value,'utf8'),c.final()]);return Buffer.concat([nonce,c.getAuthTag(),out]).toString('base64');};
async function client(device,slot){const id=device+':'+slot;if(clients.has(id))return clients.get(id);const promise=(async()=>{const db=new DatabaseSync(path.join(root,createHash('sha256').update(id).digest('hex')+'.sqlite'));const c=new DouyinOfficial(db,{crypt,slot});await c.load();return c;})();clients.set(id,promise);try{return await promise;}catch(e){clients.delete(id);throw e;}}
function authenticate(header){const actual=Buffer.from(String(header||'').replace(/^Bearer /,''));for(const [device,token]of Object.entries(devices)){const expected=Buffer.from(token);if(actual.length===expected.length&&timingSafeEqual(actual,expected))return device;}return null;}
const eventsDb=new DatabaseSync(path.join(root,'events.sqlite')),inbox=new WebhookInbox(eventsDb,{secret:env.DOUYIN_CLIENT_SECRET,clientKey:env.DOUYIN_CLIENT_KEY});
const metadata=c=>({...c.status(),fingerprint:c.accountFingerprint(),ownerId:c.token?.open_id||null});
const server=http.createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Type','application/json');try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/oauth/douyin/callback'){
    const state=url.searchParams.get('state'),pending=states.get(state);if(!pending||pending.expires<Date.now())throw Error('Invalid OAuth state');states.delete(state);await (await client(pending.device,pending.slot)).accept({state,code:url.searchParams.get('code')});res.setHeader('Content-Type','text/plain; charset=utf-8');return res.end('授权完成，请返回CommentPilot并刷新授权状态。');
  }
  if(req.method!=='POST')throw Error('Unsupported method');let bytes=0;const chunks=[];for await(const b of req){bytes+=b.length;if(bytes>262144)throw Error('Request too large');chunks.push(b);}const raw=Buffer.concat(chunks);
  if(url.pathname==='/webhooks/douyin'){const result=inbox.accept(raw,req.headers);return res.end(JSON.stringify(result));}
  const device=authenticate(req.headers.authorization);if(!device){res.writeHead(401);return res.end('{}');}
  const match=url.pathname.match(/^\/v1\/([a-zA-Z0-9-]{1,80})\/(status|authorize|works|work|commentPage|replies|reply|disconnect|events)$/);if(!match)throw Error('Unsupported action');const [,slot,action]=match;
  const c=await client(device,slot),b=JSON.parse(raw.toString()||'{}');let result;
  if(action==='status')result=metadata(c);
  if(action==='authorize'){for(const [state,p]of states)if(p.expires<Date.now()||p.device===device&&p.slot===slot)states.delete(state);result=c.authorize();states.set(new URL(result.url).searchParams.get('state'),{device,slot,expires:Date.now()+600000});}
  if(action==='works')result={works:await c.works()};
  if(action==='work')result={work:await c.work(String(b.id))};
  if(action==='commentPage')result={page:await c.commentPage(String(b.id),b.cursor??0)};
  if(action==='replies')result={replies:await c.replies(String(b.id),String(b.commentId))};
  if(action==='reply'){if(typeof b.text!=='string'||!b.text.trim()||b.text.length>200)throw Error('Invalid reply');result={replyId:await c.reply(String(b.id),b.comment,b.text)};}
  if(action==='disconnect'){await c.disconnect();result={};}
  if(action==='events')result={events:inbox.list(c.token?.open_id,Number(b.after)||0)};
  res.end(JSON.stringify(action==='status'?result:{...result,status:metadata(c)}));
}catch(error){const upstream=Number(error.upstreamStatus);res.statusCode=upstream>=400&&upstream<=599?upstream:(/连接失败|超时/.test(error.message)?503:400);res.end(JSON.stringify({error:'Broker request failed; inspect configuration and granted permissions',retryAt:error.retryAt||null}));}});
server.requestTimeout=35000;server.listen(Number(env.BROKER_PORT||4321),'127.0.0.1');
