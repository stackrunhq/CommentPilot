import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationLimit,followups,threadCount} from '../../src/comments/conversation.js';
import {parseReplySnapshot} from '../../src/douyin/browser/network.js';
test('thread limit includes initial, uncertain and sibling replies and survives JSON reload',()=>{
 const rows=[{workId:'1',commentId:'10',status:'sent',reply:'你好'},{workId:'1',commentId:'11',rootCommentId:'10',status:'uncertain'},{workId:'1',commentId:'12',rootCommentId:'10',status:'sending'},{workId:'2',commentId:'10',status:'sent'}];
 assert.equal(threadCount(JSON.parse(JSON.stringify(rows)),'1','10'),3);assert.equal(conversationLimit(),3);for(const v of [0,11,1.1,'bad'])assert.throws(()=>conversationLimit(v));
});
test('only identifiable followups to our successful reply get bounded conversation history',()=>{
 const rows=[{workId:'1',commentId:'10',status:'sent',author:'fan',text:'问',reply:'你好',sentAt:'2026-01-01'}];const comments=[{commentId:'20',rootCommentId:'10',replyToCommentId:'10',author:'Owner',text:'你好'},{commentId:'21',rootCommentId:'10',replyToCommentId:'20',author:'fan',text:'再问'}];
 const opts={workId:'1',ownName:'Owner',maxRounds:3};const [r]=followups(comments,rows,opts);assert.equal(r.conversationBlocked,false);assert.equal(r.conversationHistory.length,1);assert.equal(followups(comments,rows,{...opts,maxRounds:1})[0].conversationBlocked,true);assert.equal(followups([{...comments[1],replyToCommentId:'99'}],rows,opts)[0].conversationBlocked,true);
});
test('reply snapshots preserve parent and root ids without accepting other hosts',()=>{
 const url='https://www.douyin.com/aweme/v1/web/comment/list/reply/?item_id=1&comment_id=10';const body={comments:[{cid:'21',reply_to_reply_id:'20',reply_id:'10',user:{nickname:'fan'},text:'追问',create_time:1792390000}]};
 const c=parseReplySnapshot(url,body).comments[0];assert.equal(c.rootCommentId,'10');assert.equal(c.replyToCommentId,'20');assert.equal(parseReplySnapshot(url.replace('www.douyin.com','example.com'),body),null);
});
