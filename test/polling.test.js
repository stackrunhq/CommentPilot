import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pollDelay} from '../polling.js';
test('10秒周期扣除本轮耗时，耗时超出时串行继续',()=>{assert.equal(pollDelay(10,1000,4000),7000);assert.equal(pollDelay(10,1000,13000),0);});
