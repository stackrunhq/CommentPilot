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
export async function recognizeImages(images,folder,onProgress=()=>{},{signal,quality='balanced'}={}){
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
    if(quality==='accurate'||data.confidence<75){
      if(signal?.aborted)throw Error('任务已取消');
      await worker.setParameters({tessedit_pageseg_mode:'11'});
      const enhanced=await sharp(images[i],{limitInputPixels:50000000}).rotate().resize({width:Math.min((meta.width||1000)*3,4000)}).greyscale().normalise().threshold(175).png().toBuffer();
      const retry=await worker.recognize(enhanced);alternatives.push({engine:'Tesseract 稀疏文字增强',text:clean(retry.data.text),confidence:retry.data.confidence});await worker.setParameters({tessedit_pageseg_mode:'3'});
    }
    try{
      const windowsInput=await sharp(images[i]).resize({width:Math.min((meta.width||1000)*3,2400),height:2400,fit:'inside'}).normalise().sharpen().png().toBuffer();
      const result=await windowsRecognize(windowsInput,folder,i+1);
      if(result?.text?.trim())alternatives.push({engine:'Windows 系统 OCR',text:clean(result.text),confidence:null});
    }catch(error){onProgress({systemOcr:'不可用，使用 Tesseract'});}
    const win=alternatives.find(a=>a.engine==='Windows 系统 OCR');
    const chinese=text=>(text.match(/[\u3400-\u9fff]/g)||[]).length;
    const best=alternatives.filter(a=>a.confidence!==null&&a.text).reverse().sort((a,b)=>b.confidence-a.confidence)[0]||alternatives[0];
    const selected=win&&(best.confidence<80||chinese(best.text)<5)&&chinese(win.text)>=Math.max(5,chinese(best.text)*0.6)?win:best;
    const normalize=text=>new Set(text.replace(/\s|[\p{P}\p{S}]/gu,'').toLowerCase());const sets=alternatives.filter(a=>a.text).map(a=>normalize(a.text)),agreement=sets.length>1?Math.min(...sets.slice(1).map(set=>[...sets[0]].filter(c=>set.has(c)).length/Math.max(1,new Set([...sets[0],...set]).size))):null;
    pages.push({index:i+1,...selected,alternatives,agreement,needsReview:selected.confidence===null||selected.confidence<80||agreement!==null&&agreement<0.7});
  }}
  finally{await worker.terminate();}
  return {status:'done',accepted:false,pages,text:pages.map(p=>`[图片 ${p.index}]\n${p.text||'未识别到文字'}`).join('\n\n'),completedAt:new Date().toISOString()};
}
