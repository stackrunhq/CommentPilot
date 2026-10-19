import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validImageUrl} from '../../src/media/ocr.js';
test('OCR 仅允许抖音图片 CDN 地址',()=>{assert.ok(validImageUrl('https://p3-sign.douyinpic.com/img/a'));for(const url of ['http://p3.douyinpic.com/a','https://douyinpic.com.evil.test/a','http://127.0.0.1/x','file:///a'])assert.equal(validImageUrl(url),false);});
