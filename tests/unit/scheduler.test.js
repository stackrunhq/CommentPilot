import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkScheduler} from '../../src/comments/scheduler.js';
test('scheduler rotates works, bounds concurrency and respects interval/global gap',async()=>{
  let now=0,release;const calls=[],s=new WorkScheduler({now:()=>now,gap:1000});
  s.add('a',async()=>{calls.push('a');await new Promise(r=>release=r);},10000);s.add('b',async()=>calls.push('b'),10000);
  const first=s.tick();await s.tick();assert.deepEqual(calls,['a']);release();await first;
  await s.tick();assert.deepEqual(calls,['a']);now=1000;await s.tick();assert.deepEqual(calls,['a','b']);
  now=9999;await s.tick();assert.equal(calls.length,2);s.stop('a');assert.equal(s.active('a'),false);s.stopAll();assert.equal(s.jobs.size,0);
});
test('stopping an in-flight work revokes its send guard; errors release lock',async()=>{
  const s=new WorkScheduler({gap:0});let release,guard;
  s.add('a',async()=>{await new Promise(r=>release=r);guard=s.active('a');throw Error('failed');});
  const turn=s.tick();s.stop('a');release();await assert.rejects(turn);assert.equal(guard,false);assert.equal(s.busy,false);
  let ran=false;s.add('b',async()=>ran=true);await s.tick();assert.equal(ran,true);
});
