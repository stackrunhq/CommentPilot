import {test} from 'node:test';
import assert from 'node:assert/strict';
import {callModel,validateConnection,endpoint,providerPresets,discoverModels} from '../providers.js';
test('连接验证和 endpoint 不重复拼接',()=>{
  const c=validateConnection({...providerPresets.ollama,provider:'ollama',model:'local'});assert.equal(c.auth,'none');assert.equal(endpoint(c),'http://127.0.0.1:11434/api/chat');assert.equal(endpoint({...c,baseUrl:'http://localhost:11434/api/chat'}),'http://localhost:11434/api/chat');
  for(const baseUrl of ['https://x.test/?key=secret','https://user:pass@x.test','http://remote.test','file:///a'])assert.throws(()=>validateConnection({...c,baseUrl}));
});
test('枚举 Ollama 模型：去重、排除向量模型，并清楚报告服务失败',async()=>{
  const previous=globalThis.fetch;const requested=[];globalThis.fetch=async(url,options)=>{requested.push(url);return {ok:true,json:async()=>url.endsWith('/api/show')?{capabilities:JSON.parse(options.body).model==='local:b'?['embedding']:['completion']}:{models:[{name:'local:a',details:{parameter_size:'7B'}},{name:'local:a'},{name:'local:b'},{}]}};};try{const r=await discoverModels();assert.equal(requested[0],'http://127.0.0.1:11434/api/tags');assert.equal(r.models.length,1);assert.equal(r.excluded[0].name,'local:b');globalThis.fetch=async()=>{throw Error('refused');};await assert.rejects(()=>discoverModels(),/请确认 Ollama 已运行/);globalThis.fetch=async()=>({ok:true,json:async()=>({})});await assert.rejects(()=>discoverModels(),/有效模型列表/);}finally{globalThis.fetch=previous;}
});
test('Responses 和 Ollama 适配；拒绝截断、空输出、无凭据',async()=>{
  const previous=globalThis.fetch;let body,headers;globalThis.fetch=async(url,o)=>{body=JSON.parse(o.body);headers=o.headers;return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'你好'}]}],usage:{input_tokens:10},model:'actual'})};};
  try{const c=validateConnection({...providerPresets.openai,provider:'openai',model:'api-model'});const result=await callModel(c,'test-key',[{role:'user',content:'hello'}]);assert.equal(result.text,'你好');assert.equal(result.model,'actual');assert.equal(body.store,false);assert.ok(body.input);assert.equal(headers.Authorization,'Bearer test-key');await assert.rejects(()=>callModel(c,'',[]),/API Key/);
    globalThis.fetch=async(url,o)=>{body=JSON.parse(o.body);headers=o.headers;return {ok:true,json:async()=>({message:{content:'本地回复'},eval_count:5})};};const local=validateConnection({...providerPresets.ollama,provider:'ollama',model:'local'});assert.equal((await callModel(local,'',[])).text,'本地回复');assert.equal(body.stream,false);assert.equal(headers.Authorization,undefined);
    globalThis.fetch=async()=>({ok:true,json:async()=>({status:'incomplete',output:[]})});await assert.rejects(()=>callModel(c,'test',[]),/未完成/);
  }finally{globalThis.fetch=previous;}
});
