import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Storage} from '../../src/storage/database.js';
import {ServiceControls} from '../../src/comments/service-controls.js';
import {lockDataDirectory} from '../../src/security/data-lock.js';
test('service budgets count failed calls and known tokens; cleanup retains dedup records',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cp-controls-')),s=new Storage(dir);try{const c=new ServiceControls(s);c.save({dailyModelCalls:1});s.attempt('model_calls',{status:'failed',usage:{prompt_tokens:12,completion_tokens:3}});assert.equal(c.usage().tokens,15);assert.throws(()=>c.checkBudget(),/调用上限/);s.save({records:[{key:'x',workId:'1',commentId:'1',status:'sent',created:'2000-01-01',text:'保留',reply:'保留'}]});s.attempt('model_calls',{created:'2000-01-01',status:'succeeded'});const result=await c.cleanup();assert.equal(result.calls,1);assert.equal(s.state().records.length,1);assert.ok(result.backup);assert.throws(()=>c.save({retentionDays:0}));}finally{s.close();await rm(dir,{recursive:true,force:true});}
});
test('manual takeover, sensitive review and backlog limits are persistent and isolated',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cp-controls-')),s=new Storage(dir);try{const c=new ServiceControls(s),r={key:'x',workId:'1',commentId:'10',text:'我要退款',author:'fan',reply:'好的'};assert.throws(()=>c.assertSend(r,[]),/审核/);r.reviewApproved=true;c.assertSend(r,[]);c.setControl('1','10','manual');assert.throws(()=>c.assertSend(r,[]),/转人工/);assert.equal(new ServiceControls(s).control('1','10').mode,'manual');assert.equal(c.control('2','10').mode,'auto');c.save({maxPending:1});const rows=[{...r,status:'new'},{...r,key:'y',status:'new'}];c.limitPending(rows,'1');assert.equal(rows[1].status,'review');}finally{s.close();await rm(dir,{recursive:true,force:true});}
});
test('data directory cannot be opened by two active backends',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'cp-lock-'));let release;try{release=lockDataDirectory(dir);assert.throws(()=>lockDataDirectory(dir),/已有后端/);release();release=lockDataDirectory(dir);}finally{release?.();await rm(dir,{recursive:true,force:true});}});
