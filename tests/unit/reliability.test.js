import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {CommentQueue,retryable} from '../../src/comments/queue.js';
import {scanComments} from '../../src/comments/scanner.js';
import {reconcileReply} from '../../src/comments/reconciliation.js';
import {CommentWorker} from '../../src/comments/worker.js';

test('bounded incremental scanner revisits head and resumes tail, without early stopping at old timestamps',async()=>{
  const calls=[],pages={0:{list:[{comment_id:'pinned-old',create_time:1}],has_more:true,cursor:1},1:{list:[{comment_id:'middle-new',create_time:100}],has_more:true,cursor:2},2:{list:[{comment_id:'tail-new',create_time:101}],has_more:true,cursor:3},3:{list:[{comment_id:'last-new',create_time:102}],has_more:false}};
  const fetch=async cursor=>{calls.push(cursor);return pages[cursor];};
  const first=await scanComments(fetch);assert.equal(first.pages,3);assert.equal(first.complete,false);assert.equal(first.checkpoint.cursor,3);assert.ok(first.comments.some(c=>c.comment_id==='tail-new'));
  const second=await scanComments(fetch,first.checkpoint);assert.deepEqual(calls,[0,1,2,0,3]);assert.equal(second.complete,true);assert.equal(second.checkpoint.cursor,0);
});
test('scan errors leave original checkpoint unchanged and repeated cursors stop',async()=>{
  const checkpoint={cursor:3,recentCursors:['0','1','2']};await assert.rejects(()=>scanComments(async cursor=>cursor===0?{list:[],has_more:true,cursor:1}:Promise.reject(Error('offline')),checkpoint));assert.equal(checkpoint.cursor,3);
  await assert.rejects(()=>scanComments(async()=>({list:[],has_more:true,cursor:1})),/重复/);
});
test('reconciliation requires same owner/text/time and excludes pre-existing replies, never treats absence as safe resend',()=>{
  const submission={text:'谢谢',submittedAt:'2026-10-19T00:00:05Z',beforeIds:['old']},row={comment_id:'new',content:'谢谢',comment_user_id:'owner',create_time:Date.parse('2026-10-19T00:00:06Z')/1000},now=Date.parse('2026-10-19T00:00:10Z');
  assert.equal(reconcileReply([row],submission,'owner',now).status,'confirmed');
  for(const rows of [[],[{...row,comment_user_id:'fan'}],[{...row,comment_id:'old'}],[{...row,content:'不同回复'}],[{...row,create_time:1}],[row,{...row,comment_id:'another'}]])assert.equal(reconcileReply(rows,submission,'owner',now).status,'unconfirmed');
  assert.equal(reconcileReply([row],{...submission,beforeIds:null},'owner',now).status,'unconfirmed');
});
test('queue deduplicates, persists retry deadlines and only recovers generation automatically',()=>{
  const db=new DatabaseSync(':memory:');let now=1000;const q=new CommentQueue(db,{now:()=>now}),scope={account:'a',workId:'1',sessionId:'s',commentKey:'c'};
  try{const t=q.ensure(scope);assert.equal(q.ensure(scope).id,t.id);let claimed=q.claim('a','1','s');assert.equal(claimed.attempts,1);assert.equal(q.claim('a','1','s'),null);q.fail(claimed,Error('连接失败'),{retry:true});assert.equal(q.claim('a','1','s'),null);now+=15000;claimed=q.claim('a','1','s');q.recover();assert.equal(q.list('a','1')[0].status,'retry_wait');claimed=q.claim('a','1','s');q.advance(claimed,'send');q.claim('a','1','s');q.recover();assert.equal(q.list('a','1')[0].status,'review');assert.equal(q.claim('b','1','s'),null);
    q.advance(q.list('a','1')[0],'verify');q.cancelOtherSessions('a','1','new-session');assert.equal(q.list('a','1')[0].stage,'verify');assert.notEqual(q.list('a','1')[0].status,'cancelled');
  }finally{db.close();}
});
test('only transient failures retry, never invalid auth/grounding or blind submission',()=>{assert.equal(retryable({upstreamStatus:503}),true);assert.equal(retryable({upstreamStatus:401,message:'连接失败'}),false);assert.equal(retryable(Error('资料发生变化')),false);assert.equal(retryable(Error('模型连接失败')),true);});
test('retry deadlines honor upstream cooldown instead of exhausting attempts during rate limiting',()=>{const db=new DatabaseSync(':memory:'),q=new CommentQueue(db,{now:()=>1000});try{q.ensure({account:'a',workId:'1',sessionId:'s',commentKey:'c'});const t=q.claim('a','1','s');q.fail(t,Object.assign(Error('限流'),{retryAt:90000}),{retry:true});assert.equal(q.list('a','1')[0].nextAt,90000);}finally{db.close();}});
test('worker resumes a stored draft without regenerating and verifies uncertain writes without sending again',async()=>{
  const db=new DatabaseSync(':memory:'),queue=new CommentQueue(db);let generates=0,sends=0,verifications=0,running=true;const r={key:'c',workId:'1',sessionId:'s',source:'douyin-official',status:'draft'};
  const worker=new CommentWorker({queue,official:{accountFingerprint:()=> 'a'},records:()=>[r],target:()=> '1',session:()=>({sessionId:'s',account:'a'}),config:()=>({autoSend:true}),running:()=>running,draft:async()=>{generates++;},send:async()=>{sends++;r.status='uncertain';r.submission={account:'a'};running=false;},reconcile:async()=>{verifications++;r.status='sent';return true;},logger:{write(){}},stop:()=>{running=false;}});
  try{queue.ensure({account:'a',workId:'1',sessionId:'s',commentKey:'c'});await worker.process();assert.equal(generates,0);assert.equal(sends,1);assert.equal(queue.list('a','1')[0].stage,'verify');await worker.verify();assert.equal(verifications,1);assert.equal(sends,1);assert.equal(queue.list('a','1')[0].status,'done');}finally{db.close();}
});
test('worker retries transient generation only when persisted deadline is due, then submits once',async()=>{
  const db=new DatabaseSync(':memory:');let now=1000,calls=0,sends=0;const r={key:'c',workId:'1',sessionId:'s',source:'douyin-official',status:'new'};
  const options={official:{accountFingerprint:()=> 'a'},records:()=>[r],target:()=> '1',session:()=>({sessionId:'s',account:'a'}),config:()=>({autoSend:true}),running:()=>true,draft:async()=>{calls++;if(calls===1){r.status='error';throw Object.assign(Error('temporary'),{upstreamStatus:503});}r.status='draft';},send:async()=>{sends++;r.status='sent';},logger:{write(){}},stop:()=>{throw Error('transient generation must not stop monitor');}};
  try{let queue=new CommentQueue(db,{now:()=>now});await new CommentWorker({...options,queue}).process();assert.equal(calls,1);assert.equal(queue.list('a','1')[0].status,'retry_wait');
    queue=new CommentQueue(db,{now:()=>now});await new CommentWorker({...options,queue}).process();assert.equal(calls,1);now=16000;await new CommentWorker({...options,queue}).process();assert.equal(calls,2);assert.equal(sends,1);assert.equal(queue.list('a','1')[0].status,'done');
  }finally{db.close();}
});
