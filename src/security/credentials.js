import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {registerSecret} from './redaction.js';

// Pass secrets over stdin, never command arguments or environment variables.
export function protectSecret(value,mode='protect'){
  if(mode==='protect')registerSecret(value);
  if(!value)return Promise.resolve('');
  if(process.platform!=='win32')throw Error('凭据持久化需要 Windows 用户级加密');
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./credentials.ps1',import.meta.url)),mode],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='';const timer=setTimeout(()=>child.kill(),15000);
    child.stdout.on('data',b=>output+=b);child.stderr.resume();
    child.on('error',()=>{clearTimeout(timer);reject(Error('无法启动 Windows 凭据加密'));});
    child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(Error('Windows 凭据加解密失败，请在原 Windows 用户下运行或重新填写 Key'));else resolve(output.trim());});
    child.stdin.on('error',()=>{});child.stdin.end(Buffer.from(value,'utf8').toString('base64'));
  }).then(output=>{const result=mode==='unprotect'?Buffer.from(output,'base64').toString('utf8'):output;if(mode==='unprotect')registerSecret(result);return result;});
}
