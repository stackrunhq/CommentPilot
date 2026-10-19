import {parentPort,workerData} from 'node:worker_threads';
try{
  const bytes=Buffer.from(workerData.bytes),extension=workerData.extension;let text='',warnings=[];
  if(extension==='docx'){
    const {unzipSync}=await import('fflate'),{SaxesParser}=await import('saxes');let count=0;
    const zip=unzipSync(bytes,{filter:entry=>{if(++count>10000)throw Error('DOCX文件过多');if(entry.name!=='word/document.xml')return false;if(entry.originalSize>8000000)throw Error('DOCX正文过大');return true;}});
    if(!zip['word/document.xml'])throw Error('缺少DOCX正文');const xml=new TextDecoder('utf-8',{fatal:true}).decode(zip['word/document.xml']);if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('不接受XML实体');
    const parser=new SaxesParser();let inText=false;parser.on('opentag',node=>{if(node.name==='w:t')inText=true;if(['w:tab','w:br'].includes(node.name))text+='\n';});parser.on('text',value=>{if(inText)text+=value;});parser.on('closetag',node=>{if(node.name==='w:t')inText=false;if(node.name==='w:p')text+='\n';});parser.write(xml).close();warnings=['仅提取Word正文文本；图片、页眉页脚和复杂排版请另行核对'];
  }
  else if(extension==='pdf'){
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,verbosity:0});const doc=await task.promise;
    try{if(doc.numPages>200)throw Error('PDF最多200页');for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i),content=await page.getTextContent();text+=`\n[PDF第${i}页]\n`+content.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('');if(text.length>300000)throw Error('知识库最多300000字符');}if(text.replace(/\[PDF第\d+页\]/g,'').trim().length<10)throw Error('该PDF没有可提取文本，请先对扫描件做OCR');}finally{await task.destroy();}
  }else text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(!text.trim()||text.length>300000)throw Error('导入文字应为1～300000字符');parentPort.postMessage({text,warnings});
}catch{parentPort.postMessage({error:'文档解析失败：仅支持UTF-8文本、未加密PDF文本和DOCX，最多200页/300000字符；扫描PDF需先OCR。'});}
