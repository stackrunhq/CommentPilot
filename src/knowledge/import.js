import {Worker} from 'node:worker_threads';
export async function importKnowledge(bytes,name){
  if(bytes.length>20*1024*1024)throw Error('知识文档不能超过20MB');const extension=String(name).split('.').at(-1).toLowerCase();if(!['txt','md','pdf','docx'].includes(extension))throw Error('请选择TXT、Markdown、PDF或DOCX');
  return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./import-worker.js',import.meta.url),{workerData:{bytes,extension},resourceLimits:{maxOldGenerationSizeMb:256}});const timer=setTimeout(()=>{void worker.terminate();reject(Error('文档解析超时'));},30000);const finish=(error,data)=>{clearTimeout(timer);void worker.terminate();error?reject(error):resolve(data);};worker.once('message',data=>finish(data.error?Error(data.error):null,data));worker.once('error',()=>finish(Error('文档解析失败')));worker.once('exit',code=>{if(code)finish(Error('文档解析中断'));});});
}
