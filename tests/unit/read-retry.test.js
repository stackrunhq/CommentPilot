import test from 'node:test';
import assert from 'node:assert/strict';
import {readRetry} from '../../src/douyin/browser/read-retry.js';
test('only transient read failures get bounded retries; security and ambiguity stop',()=>{const error=Object.assign(Error('locator.click: Timeout 12000ms exceeded'),{name:'TimeoutError'});assert.equal(readRetry(error).attempts,1);assert.equal(readRetry(error,1).attempts,2);assert.equal(readRetry(error,2),null);for(const message of ['请完成安全验证','请先登录','Target page closed','未能唯一定位当前作品评论入口'])assert.equal(readRetry({name:'TimeoutError',message}),null);assert.equal(readRetry(Error('资料缺失')),null);});
