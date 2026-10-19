import {createHash,timingSafeEqual} from 'node:crypto';
export class WebhookInbox{
  constructor(db,{secret,clientKey,now=()=>Date.now()}){this.db=db;this.secret=secret;this.clientKey=clientKey;this.now=now;db.exec('CREATE TABLE IF NOT EXISTS webhook_events(id INTEGER PRIMARY KEY AUTOINCREMENT,digest TEXT UNIQUE NOT NULL,owner TEXT NOT NULL,event TEXT NOT NULL,created INTEGER NOT NULL);');}
  accept(raw,headers){
    if(!this.secret||!this.clientKey||raw.length>262144)throw Error('Webhook unavailable');const actual=String(headers['x-douyin-signature']||'');if(!/^[a-f0-9]{40}$/i.test(actual))throw Error('Invalid signature');const expected=createHash('sha1').update(this.secret).update(raw).digest();if(!timingSafeEqual(expected,Buffer.from(actual,'hex')))throw Error('Invalid signature');
    const body=JSON.parse(raw.toString('utf8'));if(body.client_key!==this.clientKey)throw Error('Invalid application');
    if(body.event==='verify_webhook')return {challenge:body.content?.challenge};
    // Notifications only wake a bounded official scan; untrusted event content never becomes a reply task.
    const owner=String(body.from_user_id||body.open_id||body.content?.open_id||'');if(!owner||owner.length>200)return {accepted:true};const digest=createHash('sha256').update(headers['msg-id']?this.clientKey+':'+String(headers['msg-id']):raw).digest('hex');
    this.db.prepare('INSERT OR IGNORE INTO webhook_events(digest,owner,event,created) VALUES(?,?,?,?)').run(digest,owner,String(body.event||'').slice(0,100),this.now());this.db.prepare('DELETE FROM webhook_events WHERE created<?').run(this.now()-7*86400000);return {accepted:true};
  }
  list(owner,after=0){if(!owner)return [];return this.db.prepare('SELECT id,event,created FROM webhook_events WHERE owner=? AND id>? ORDER BY id LIMIT 100').all(owner,after);}
}
