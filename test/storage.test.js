import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Storage} from '../storage.js';
import {DatabaseSync} from 'node:sqlite';
test('JSON 迁移、幂等启动、历史过滤、唯一评论与一致性备份',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'commentpilot-db-'));const original={config:{model:'old-model'},records:[{key:'a',workId:'123',commentId:'11',author:'甲',text:'hello',status:'sent',created:'2026-10-01T00:00:00Z'},{key:'b',workId:'456',commentId:'22',text:'world',status:'draft'}],workContents:{123:{body:'正文'}},monitors:{123:{since:'2026-10-01'}}};
  writeFileSync(path.join(dir,'state.json'),JSON.stringify(original));let db=new Storage(dir);
  assert.equal(db.state().records.length,2);assert.equal(db.state().workContents['123'].body,'正文');assert.equal(db.history({workId:'123'}).total,1);assert.equal(db.history({search:'world'}).records[0].key,'b');assert.equal(db.history({status:'sent'}).total,1);
  assert.equal(JSON.parse(readFileSync(path.join(dir,'state.pre-commentpilot.json'))).records.length,2);
  assert.throws(()=>db.save({...original,records:[...original.records,{key:'other',workId:'123',commentId:'11',status:'new'}]}));assert.equal(db.state().records.length,2);
  db.attempt('model_calls',{commentKey:'a',status:'succeeded',model:'local-model',provider:'ollama'});assert.equal(db.history({model:'ollama'}).total,1);assert.equal(db.details('a').calls.length,1);
  const file=await db.backup();const copied=new DatabaseSync(file);assert.equal(copied.prepare('SELECT count(*) n FROM comments').get().n,2);copied.close();db.close();
  db=new Storage(dir);assert.equal(db.state().records.length,2);assert.equal(db.connections()[0].model,'old-model');db.close();
});
