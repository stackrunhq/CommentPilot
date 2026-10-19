import {createHash} from 'node:crypto';
export function chunks(text,size=800){const result=[];for(let start=0;start<text.length;start+=size-80){const value=text.slice(start,start+size);result.push({id:createHash('sha256').update(start+':'+value).digest('hex').slice(0,16),start,text:value});if(start+size>=text.length)break;}return result;}
function terms(text){const normalized=String(text).toLowerCase();return [...new Set([...(normalized.match(/[a-z0-9]{2,}/g)||[]),...[...normalized.matchAll(/[\u3400-\u9fff]{2,}/g)].flatMap(m=>Array.from({length:m[0].length-1},(_,i)=>m[0].slice(i,i+2)))])];}
export function retrieve(text,query,limit=6){
  const blocks=chunks(text),tokens=terms(query);if(!tokens.length)return blocks.slice(0,limit).map(b=>({...b,score:0}));
  const df=new Map(tokens.map(t=>[t,blocks.filter(b=>b.text.toLowerCase().includes(t)).length]));
  return blocks.map(b=>({...b,score:tokens.reduce((n,t)=>n+(b.text.toLowerCase().includes(t)?Math.log(1+blocks.length/(1+df.get(t))):0),0)})).filter(b=>b.score>0).sort((a,b)=>b.score-a.score||a.start-b.start).slice(0,limit);
}
