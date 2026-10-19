import {protectSecret} from '../security/credentials.js';
export class BrokerSettings{
  constructor(db){this.db=db;db.exec('CREATE TABLE IF NOT EXISTS broker_settings(id INTEGER PRIMARY KEY CHECK(id=1),url TEXT NOT NULL,secret TEXT NOT NULL);');}
  status(){const row=this.db.prepare('SELECT url,secret FROM broker_settings WHERE id=1').get();return {url:row?.url||'',keyConfigured:!!row?.secret};}
  async env(){const row=this.db.prepare('SELECT * FROM broker_settings WHERE id=1').get();return row?{...process.env,COMMENTPILOT_BROKER_URL:row.url,COMMENTPILOT_BROKER_TOKEN:await protectSecret(row.secret,'unprotect')}:process.env;}
  async save({url,token,clear}){if(clear){this.db.prepare('DELETE FROM broker_settings').run();return;}const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('请填写HTTPS授权服务域名，不含路径或凭据');const previous=this.db.prepare('SELECT * FROM broker_settings WHERE id=1').get();let secret;if(token){if(typeof token!=='string'||token.length<32||token.length>512)throw Error('设备凭证应为32～512字符');secret=await protectSecret(token);}else {if(previous?.url!==u.origin||!previous.secret)throw Error('新服务需要填写设备凭证');secret=previous.secret;}this.db.prepare('INSERT OR REPLACE INTO broker_settings VALUES(1,?,?)').run(u.origin,secret);}
}
