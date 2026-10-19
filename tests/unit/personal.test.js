import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePersonal,importPersonal,personalRecord,personalEvent} from '../../src/comments/personal.js';
import {establishBaseline} from '../../src/comments/state.js';
test('personal import validates batch format without guessing author delimiters',()=>{
  assert.deepEqual(parsePersonal({text:'昵称\t正文\n普通评论'}),[{author:'昵称',text:'正文',commentId:''},{author:'未填写昵称',text:'普通评论',commentId:''}]);
  assert.throws(()=>parsePersonal({rows:Array(201).fill({text:'a'})}));assert.throws(()=>parsePersonal({rows:[{text:''}]}));
});
test('manual records deduplicate per work, external IDs distinguish identical text and cannot be official records',()=>{
  const records=[],rows=parsePersonal({rows:[{author:'a',text:'same',commentId:'1'},{author:'a',text:'same',commentId:'2'}]});assert.equal(importPersonal(records,rows,{workId:'123',video:'v'}).added,2);assert.equal(importPersonal(records,rows,{workId:'123',video:'v'}).duplicates,2);assert.equal(importPersonal(records,rows,{workId:'456',video:'v2'}).added,2);assert.equal(records.every(r=>r.commentId===null&&r.source==='manual-import'),true);assert.throws(()=>personalRecord(records,records[0].key,'123'));
});
test('copying never marks sent; manual confirmation has its own immutable publication snapshot',()=>{
  const r={status:'draft',reply:'answer'};personalEvent(r,'copied');assert.equal(r.status,'draft');assert.equal(r.copiedText,'answer');personalEvent(r,'published');assert.equal(r.status,'manual_published');assert.equal(r.manualPublishedText,'answer');const count=r.manualEvents.length;personalEvent(r,'published');assert.equal(r.manualEvents.length,count);assert.equal(r.sentAt,undefined);
});
test('starting an official session never rewrites personal drafts as history',()=>{const r={source:'manual-import',workId:'123',video:'https://www.douyin.com/video/123',status:'draft'};establishBaseline([r],[],{video:r.video,target:'123'});assert.equal(r.status,'draft');});
