import {createWorker} from 'tesseract.js';
import chi from '@tesseract.js-data/chi_sim';
import eng from '@tesseract.js-data/eng';
import {mkdir,copyFile,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const run=promisify(execFile);
export async function windowsRecognize(bytes,folder,index){
  if(process.platform!=='win32')return null;
  const image=path.join(folder,`windows-${index}.png`),output=path.join(folder,`windows-${index}.json`);
  await writeFile(image,bytes);
  await run('powershell.exe',['-NoProfile','-File',fileURLToPath(new URL('./windows-ocr.ps1',import.meta.url)),'-ImagePath',image,'-OutputPath',output],{windowsHide:true,timeout:45000,maxBuffer:100000});
  return JSON.parse(await readFile(output,'utf8'));
}
export function validImageUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&['douyinpic.com','douyinstatic.com','byteimg.com','ibytedtos.com','pstatp.com'].some(host=>u.hostname===host||u.hostname.endsWith('.'+host));}catch{return false;}}
export async function recognizeImages(images,folder,onProgress=()=>{},{signal}={}){
  if(!images.length)throw Error('没有可识别的作品图片');
  await mkdir(folder,{recursive:true});
  for(const language of [chi,eng])await copyFile(path.join(language.langPath,`${language.code}.traineddata.gz`),path.join(folder,`${language.code}.traineddata.gz`));
  const worker=await createWorker(['chi_sim','eng'],1,{langPath:folder,cachePath:folder,gzip:true,logger:event=>onProgress({phase:event.status,progress:event.progress})});
  const pages=[];
  try{for(let i=0;i<images.length;i++){
    if(signal?.aborted)throw Error('任务已取消');
    onProgress({image:i+1,total:images.length});const input=sharp(images[i],{limitInputPixels:50000000});const meta=await input.metadata();
    const normalized=await input.resize({width:Math.min((meta.width||1000)*2,4000)}).greyscale().normalise().sharpen().png().toBuffer();
    await writeFile(path.join(folder,`source-${i+1}.png`),await sharp(images[i]).png().toBuffer());
    const {data}=await worker.recognize(normalized);const clean=text=>text.trim().replace(/(?<=[\u3400-\u9fff]) +(?=[\u3400-\u9fff])/g,'');
    const alternatives=[{engine:'Tesseract 中英模型',text:clean(data.text),confidence:data.confidence}];
    try{
      const windowsInput=await sharp(images[i]).resize({width:Math.min((meta.width||1000)*3,2400),height:2400,fit:'inside'}).normalise().sharpen().png().toBuffer();
      const result=await windowsRecognize(windowsInput,folder,i+1);
      if(result?.text?.trim())alternatives.push({engine:'Windows 系统 OCR',text:clean(result.text),confidence:null});
    }catch(error){onProgress({systemOcr:'不可用，使用 Tesseract'});}
    const win=alternatives.find(a=>a.engine==='Windows 系统 OCR');
    const chinese=text=>(text.match(/[\u3400-\u9fff]/g)||[]).length;
    const selected=win&&chinese(win.text)>=Math.max(5,chinese(alternatives[0].text)*0.6)?win:alternatives[0];
    pages.push({index:i+1,...selected,alternatives});
  }}
  finally{await worker.terminate();}
  return {status:'done',accepted:false,pages,text:pages.map(p=>`[图片 ${p.index}]\n${p.text||'未识别到文字'}`).join('\n\n'),completedAt:new Date().toISOString()};
}
