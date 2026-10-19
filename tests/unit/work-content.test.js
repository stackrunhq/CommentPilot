import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findWorkContent,replyContext} from '../../src/works/content.js';
test('只提取指定作品正文，不混用推荐作品和主页信息',()=>{
 const tree={items:[{aweme_id:'111',desc:'别的作品'},{detail:{aweme_id:'7697085629427793785',desc:'服务恢复说明',author:{nickname:'作者'},images:[{}]}}]};
 assert.equal(findWorkContent(tree,'7697085629427793785').body,'服务恢复说明');
 assert.equal(findWorkContent(tree,'222'),null);
});
test('缺失正文不得用标题或评论补齐',()=>{assert.equal(findWorkContent({aweme_id:'111',title:'主页',comments:['评论']},'111'),null);});
test('切换作品后旧背景不可参与模型上下文',()=>{
 const config={video:'https://www.douyin.com/note/222',context:'人工资料'};
 assert.equal(replyContext(config,{id:'111',body:'旧作品'}),'人工补充资料：\n人工资料');
 assert.match(replyContext(config,{id:'222',body:'新作品'}),/新作品/);
});
test('未核对低置信度 OCR 不进入模型上下文',()=>{const config={video:'https://www.douyin.com/note/222',context:''};const content={id:'222',body:'原文',ocr:{status:'done',accepted:false,text:'可疑金额'}};assert.doesNotMatch(replyContext(config,content),/可疑金额/);content.ocr.accepted=true;assert.match(replyContext(config,content),/可疑金额/);});
