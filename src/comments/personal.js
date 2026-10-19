import {createHash,randomUUID} from 'node:crypto';
export function parsePersonal(input){
  let rows=input.rows;
  if(!rows){const text=String(input.text||'');if(text.length>500000)throw Error('一次导入文本不能超过50万字符');rows=text.split(/\r?\n/).filter(s=>s.trim()).map(line=>{const parts=line.split('\t');return parts.length>=2?{author:parts.shift(),text:parts.join('\t')}:{text:line};});}
  if(!Array.isArray(rows)||!rows.length||rows.length>200)throw Error('一次导入1～200条评论');
  return rows.map(row=>{if(!row||typeof row!=='object')throw Error('评论格式无效');const author=String(row.author||'未填写昵称').trim(),text=String(row.text||'').trim(),commentId=String(row.commentId||'').trim();if(!text||text.length>2000||author.length>100||commentId.length>200)throw Error('评论正文应为1～2000字，昵称最多100字');return {author,text,commentId};});
}
export function importPersonal(records,rows,{workId,video}){
  const result={added:0,duplicates:0};
  for(const row of rows){const signature=createHash('sha256').update(JSON.stringify([workId,row.commentId?['id',row.commentId]:['text',row.author,row.text]])).digest('hex');
    if(records.some(r=>r.source==='manual-import'&&r.manualSignature===signature)){result.duplicates++;continue;}
    records.unshift({...row,commentId:null,externalCommentId:row.commentId||null,key:'manual:'+randomUUID(),source:'manual-import',manualSignature:signature,workId,video,status:'new',reply:'',created:new Date().toISOString(),manualEvents:[]});result.added++;
  }return result;
}
export function personalRecord(records,key,workId){const r=records.find(r=>r.key===key&&r.workId===workId&&r.source==='manual-import');if(!r)throw Error('请选择当前作品手动导入的评论');return r;}
export function personalEvent(r,action){
  if(!['copied','published'].includes(action))throw Error('无效操作');if(!r.reply?.trim()||!['draft','manual_published'].includes(r.status))throw Error('请先生成或保存草稿');
  const at=new Date().toISOString();r.manualEvents||=[];
  if(action==='copied'){r.copiedAt=at;r.copiedText=r.reply;r.copyCount=(r.copyCount||0)+1;}
  else {if(r.status==='manual_published')return;r.status='manual_published';r.manualPublishedAt=at;r.manualPublishedText=r.reply;}
  r.manualEvents.push({action,at,text:r.reply});r.manualEvents=r.manualEvents.slice(-50);
}
