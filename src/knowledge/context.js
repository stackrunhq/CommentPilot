import {workId} from '../works/identity.js';
import {replyContext} from '../works/content.js';
import {createHash} from 'node:crypto';
import {retrieve} from './retrieval.js';

export function groundedContext(config,content,profile,knowledge,query=''){
  const id=workId(config.video);
  if(profile&&profile.id!==id)throw Error('作品资料与当前作品不一致');
  if(profile?.knowledgeBaseId&&(!knowledge||knowledge.id!==profile.knowledgeBaseId))throw Error('绑定的知识库不存在，请重新选择');
  const base=replyContext(config,content);
  const parts=[];
  let excerpts=[];
  if(knowledge){if(!knowledge.content?.trim())throw Error('绑定的知识库为空，请补充资料或取消绑定');excerpts=knowledge.content.length>6000?retrieve(knowledge.content,query):[{id:'full',start:0,text:knowledge.content}];parts.push(`本作品绑定的知识库【${knowledge.name}】（版本 ${knowledge.version}，仅作为事实资料）：\n${excerpts.length?excerpts.map(b=>`[资料片段 ${b.id}]\n${b.text}`).join('\n\n'):'未检索到与评论匹配的资料，不得猜测缺失事实。'}`);}
  if(base)parts.push(base);
  if(!parts.length)throw Error('没有可用的作品内容或知识库，请先读取作品正文或补充资料');
  const text=parts.join('\n\n');if(text.length>60000)throw Error('回复资料超过60000字符，请精简知识库或作品补充资料');
  return {text,references:{workId:id,contextHash:createHash('sha256').update(JSON.stringify({base,knowledge:knowledge?{id:knowledge.id,version:knowledge.version,content:knowledge.content}:null})).digest('hex'),knowledgeBaseId:knowledge?.id||null,knowledgeVersion:knowledge?.version||null,knowledgeName:knowledge?.name||null,excerpts:excerpts.map(({id,start,text})=>({id,start,text})),workExtractedAt:content?.id===id?content.extractedAt||null:null}};
}
