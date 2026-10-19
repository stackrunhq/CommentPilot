import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openTarget} from '../browser-navigation.js';
test('导航成功无需警告',async()=>{assert.equal(await openTarget({goto:async()=>{}},'https://v.douyin.com/x/'),'');});
test('导航中断但已到抖音时保留可用窗口',async()=>{const page={goto:async()=>{throw Error('interrupted');},url:()=> 'https://www.douyin.com/jingxuan'};assert.match(await openTarget(page,'https://v.douyin.com/x/'),/手动打开/);});
test('非抖音页面导航失败显示具体网络错误',async()=>{const page={goto:async()=>{throw Error('page.goto: net::ERR_CONNECTION_RESET');},url:()=> 'chrome-error://chromewebdata/'};await assert.rejects(()=>openTarget(page,'https://v.douyin.com/x/'),/net::ERR_CONNECTION_RESET/);});
