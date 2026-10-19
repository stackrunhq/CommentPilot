export const providerPresets={
  deepseek:{name:'DeepSeek',baseUrl:'https://api.deepseek.com',protocol:'chat',model:'deepseek-chat',auth:'bearer'},
  aliyun:{name:'阿里百炼',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',protocol:'chat',model:'qwen-plus',auth:'bearer'},
  zhipu:{name:'智谱 GLM',baseUrl:'https://open.bigmodel.cn/api/paas/v4',protocol:'chat',model:'',auth:'bearer'},
  openai:{name:'OpenAI / Codex API',baseUrl:'https://api.openai.com/v1',protocol:'responses',model:'',auth:'bearer'},
  ollama:{name:'Ollama 本地',baseUrl:'http://127.0.0.1:11434',protocol:'ollama',model:'',auth:'none'},
  lmstudio:{name:'LM Studio',baseUrl:'http://127.0.0.1:1234/v1',protocol:'chat',model:'',auth:'none'},
  vllm:{name:'vLLM',baseUrl:'http://127.0.0.1:8000/v1',protocol:'chat',model:'',auth:'none'},
  custom:{name:'自定义兼容接口',baseUrl:'',protocol:'chat',model:'',auth:'bearer'}
};
export function validateConnection(input){
  const provider=String(input.provider||'custom');if(!providerPresets[provider])throw Error('未知供应商');
  const c={...providerPresets[provider],...input,provider};
  const url=new URL(String(c.baseUrl).trim());
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('接口地址必须是无凭据和查询参数的 HTTP(S) 地址');
  if(url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('远程模型接口请使用 HTTPS；本机服务可使用 HTTP');
  c.baseUrl=url.href.replace(/\/$/,'');c.model=String(c.model||'').trim();c.name=String(c.name||'').trim().slice(0,100);
  if(!c.model||!c.name)throw Error('请填写连接名称和模型名称');
  if(!['chat','responses','ollama'].includes(c.protocol)||!['bearer','none'].includes(c.auth))throw Error('不支持的协议或认证方式');
  c.timeout=Number(c.timeout??60);c.maxTokens=Number(c.maxTokens??2048);
  if(!Number.isInteger(c.timeout)||c.timeout<5||c.timeout>600)throw Error('超时应为 5–600 秒');
  if(!Number.isInteger(c.maxTokens)||c.maxTokens<128||c.maxTokens>32768)throw Error('输出 token 上限应为 128–32768');
  return Object.fromEntries(['name','provider','baseUrl','protocol','model','auth','timeout','maxTokens'].map(k=>[k,c[k]]));
}
export function endpoint(c){const suffix={chat:'/chat/completions',responses:'/responses',ollama:'/api/chat'}[c.protocol];return c.baseUrl.endsWith(suffix)?c.baseUrl:c.baseUrl+suffix;}
export async function discoverModels(input={},key=''){
  const provider=input.provider||'ollama';
  const c=validateConnection({...providerPresets[provider],...input,provider,name:'discovery',model:'discovery'});
  const url=c.baseUrl.replace(/\/(?:api\/chat|chat\/completions|responses)$/,'')+(c.protocol==='ollama'?'/api/tags':'/models');
  try{
    const res=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(5000),headers:c.auth==='bearer'&&key?{Authorization:`Bearer ${key}`}:{}});
    if(!res.ok)throw Error(`读取模型列表失败 HTTP ${res.status}`);
    const data=await res.json();const list=c.protocol==='ollama'?data.models:data.data;
    if(!Array.isArray(list))throw Error('服务未返回有效模型列表');
    const modelId=m=>c.protocol==='ollama'?m.name||m.model:m.id||m.name;
    const models=[...new Map(list.filter(m=>typeof modelId(m)==='string').map(m=>[modelId(m),{name:modelId(m),displayName:m.name||modelId(m),size:typeof m.size==='number'?m.size:null,parameters:m.details?.parameter_size||'',quantization:m.details?.quantization_level||''}])).values()];
    if(c.protocol==='ollama'){
      const signal=AbortSignal.timeout(5000);let cursor=0;
      await Promise.all(Array.from({length:Math.min(4,models.length)},async()=>{while(cursor<models.length&&!signal.aborted){const model=models[cursor++];try{const info=await fetch(c.baseUrl.replace(/\/api\/chat$/,'')+'/api/show',{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json',...(c.auth==='bearer'&&key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify({model:model.name})});if(info.ok){const detail=await info.json();if(Array.isArray(detail.capabilities))model.capabilities=detail.capabilities;}}catch{/* Older services may not expose capabilities; preserve manual compatibility. */}}}));
    }
    const excluded=models.filter(m=>m.capabilities?.length&&!m.capabilities.includes('completion'));
    return {models:models.filter(m=>!excluded.includes(m)),excluded,baseUrl:c.baseUrl,provider};
  }catch(e){if(e.message.startsWith('读取模型')||e.message==='服务未返回有效模型列表')throw e;throw Error(provider==='ollama'?'未连接到 Ollama。请确认 Ollama 已运行，再点击重新检测；如果修改过端口，可在高级设置中填写地址。':'无法读取模型列表，请检查服务地址及认证');}
}
export async function callModel(c,key,messages,{maxChars=200,signal}={}){
  if(c.auth!=='none'&&!key)throw Error('请先填写 API Key');
  const body=c.protocol==='responses'?{model:c.model,input:messages,max_output_tokens:c.maxTokens,store:false}:c.protocol==='ollama'?{model:c.model,messages,stream:false,options:{num_predict:c.maxTokens}}:{model:c.model,messages,max_tokens:c.maxTokens,stream:false};
  let res;try{res=await fetch(endpoint(c),{method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(c.timeout*1000)]):AbortSignal.timeout(c.timeout*1000),headers:{'Content-Type':'application/json',...(c.auth!=='none'?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify(body)});}catch(e){if(signal?.aborted)throw Error('任务已取消');throw Error(e.name==='TimeoutError'?'模型请求超时':'模型连接失败，请检查地址、网络或本地服务');}
  if(!res.ok){const reasons={401:'Key 无效或地域不匹配',403:'账户无权限',404:'接口地址或模型不存在',429:'触发限流或额度不足'};throw Object.assign(Error(`模型请求失败 HTTP ${res.status}：${reasons[res.status]||'供应商服务异常'}`),{upstreamStatus:res.status,upstreamRequestId:res.headers?.get?.('x-request-id')||res.headers?.get?.('request-id')});}
  let data;try{data=await res.json();}catch{throw Error('模型返回无效 JSON，请检查服务地址和响应格式');}
  if(c.protocol==='responses'&&data.status&&data.status!=='completed')throw Error('模型输出未完成，请提高 token 上限或检查模型状态');
  if(c.protocol==='chat'&&data.choices?.[0]?.finish_reason==='length')throw Error('模型输出被截断，请提高 token 上限');
  const text=(c.protocol==='responses'?data.output?.flatMap(x=>x.type==='message'?x.content||[]:[]).filter(x=>x.type==='output_text').map(x=>x.text).join(''):c.protocol==='ollama'?data.message?.content:data.choices?.[0]?.message?.content)?.trim();
  if(!text||text.length>maxChars)throw Error('模型未返回有效长度的内容，请人工检查');
  return {text,model:data.model||c.model,usage:data.usage??(c.protocol==='ollama'?{input_tokens:data.prompt_eval_count,output_tokens:data.eval_count}:null),requestId:data.id||null};
}
