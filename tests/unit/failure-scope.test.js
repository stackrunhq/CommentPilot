import test from 'node:test';
import assert from 'node:assert/strict';
import {monitorFailure} from '../../src/comments/failure-scope.js';
test('individual reply errors isolate but authentication quota and work mismatch stop',()=>{for(const message of ['未检测到新增回复','评论未显示或存在同名同文评论','未确认原评论处于回复中','输入框内容未正确同步'])assert.equal(monitorFailure(Error(message)),false);for(const message of ['请先登录','请完成安全验证','模型请求失败 HTTP 401','已达到每日发送上限','请先核对作品并点击“确认当前作品”','账号确认已失效'])assert.equal(monitorFailure(Error(message)),true);});
