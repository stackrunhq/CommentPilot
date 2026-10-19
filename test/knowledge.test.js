import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groundedContext} from '../knowledge.js';
import {Storage} from '../storage.js';
import {mkdtempSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
test('知识库严格按作品绑定，缺资料拒绝生成，未核对OCR和其他作品内容不混入',()=>{
  const config={video:'https://www.douyin.com/video/123',context:''};const profile={id:'123',knowledgeBaseId:'kb'};const knowledge={id:'kb',name:'A规则',version:2,content:'已确认的规则'};
  assert.throws(()=>groundedContext(config,null,null,null),/没有可用/);assert.throws(()=>groundedContext(config,null,{id:'456'},null),/不一致/);assert.throws(()=>groundedContext(config,null,profile,null),/不存在/);
  const result=groundedContext(config,{id:'456',body:'其他作品'},profile,knowledge);assert.ok(result.text.includes('已确认的规则'));assert.ok(!result.text.includes('其他作品'));assert.equal(result.references.knowledgeVersion,2);
  const fallback=groundedContext(config,{id:'123',body:'本作品',ocr:{status:'done',accepted:false,text:'未核对'}},null,null);assert.ok(fallback.text.includes('本作品'));assert.ok(!fallback.text.includes('未核对'));
});
test('作品和知识库持久化、版本保护、跨作品历史及绑定删除保护',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'commentpilot-knowledge-'));let db=new Storage(dir);const k=db.saveKnowledge({name:'退款规则',content:'以订单实际条款为准'});const a=db.saveWork({url:'https://www.douyin.com/video/123',title:'作品A',knowledgeBaseId:k.id,context:'A'});db.saveWork({url:'https://www.douyin.com/note/456',title:'作品B',context:'B'});assert.equal(db.work(a.id).context,'A');assert.equal(db.work('456').knowledgeBaseId,'');assert.throws(()=>db.deleteKnowledge(k.id),/解除绑定/);const revised=db.saveKnowledge({...k,content:'更新后规则'});assert.equal(revised.version,2);assert.equal(db.db.prepare('SELECT count(*) n FROM knowledge_versions').get().n,2);db.close();db=new Storage(dir);assert.equal(db.knowledge(k.id).version,2);assert.equal(db.work('123').knowledgeBaseId,k.id);assert.equal(db.work('456').context,'B');db.close();
});
