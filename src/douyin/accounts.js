import {randomUUID} from 'node:crypto';
import {DouyinOfficial} from './official.js';
import {RemoteOfficial} from './remote.js';
export class AccountRegistry{
  constructor(db,options={}){this.db=db;this.options=options;this.Client=(options.env||process.env).COMMENTPILOT_BROKER_URL?RemoteOfficial:DouyinOfficial;this.clients=new Map();db.exec('CREATE TABLE IF NOT EXISTS account_profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL);');db.prepare('INSERT OR IGNORE INTO account_profiles VALUES(?,?)').run('default','默认账号');}
  async load(){for(const p of this.db.prepare('SELECT * FROM account_profiles').all()){const client=new this.Client(this.db,{...this.options,slot:p.id});await client.load();this.clients.set(p.id,client);}return this;}
  get(id='default'){const c=this.clients.get(id);if(!c)throw Error('账号不存在');return c;}
  list(){return this.db.prepare('SELECT * FROM account_profiles').all().map(p=>({...p,...this.get(p.id).status()}));}
  async create(name){const id=randomUUID();name=String(name||'新账号').trim().slice(0,80);if(this.clients.size>=20)throw Error('最多保存20个账号');this.db.prepare('INSERT INTO account_profiles VALUES(?,?)').run(id,name);const c=new this.Client(this.db,{...this.options,slot:id});await c.load();this.clients.set(id,c);return {id,name};}
  byFingerprint(fingerprint){return [...this.clients.values()].find(c=>c.accountFingerprint()===fingerprint);}
}
