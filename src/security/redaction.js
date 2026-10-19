import {format} from 'node:util';

const secrets=new Set();
export function registerSecret(value){if(typeof value==='string'&&value.length>=6)secrets.add(value);}
for(const [name,value]of Object.entries(process.env))if(/key|secret|token|password/i.test(name))registerSecret(value);
export function redactText(value){
  let text=String(value??'');
  for(const secret of [...secrets].sort((a,b)=>b.length-a.length))text=text.split(secret).join('[REDACTED]');
  return text
    .replace(/\b(?:Bearer|Basic)\s+[^\s,"'}]+/gi,'[AUTH REDACTED]')
    .replace(/\b(?:sk-[\w-]+|act\.[\w.\/+==-]+|rft\.[\w.\/+==-]+)\b/g,'[TOKEN REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization|cookie|set-cookie|code|state)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi,'$1[REDACTED]')
    .replace(/https?:\/\/[^\s<>"']+/gi,url=>{try{const u=new URL(url);return u.origin+u.pathname+(u.search?'?[QUERY REDACTED]':'');}catch{return '[URL REDACTED]';}})
    .replace(/\b[A-Za-z]:[\\/][^\r\n<>"']+/g,'[LOCAL PATH REDACTED]')
    .replace(/\/(?:home|Users|tmp|var\/folders)\/[^\s"']+/g,'[LOCAL PATH REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[EMAIL REDACTED]')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g,'[PHONE REDACTED]')
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g,'[ID REDACTED]')
    .slice(0,4000);
}
const privateField=/^(?:.*(?:secret|token|password|cookie|authorization|apikey|api_key|api-key).*|key|code|state|headers|body|payload|raw|data|text|content|prompt|messages|response|reply|background|knowledge|caption|author|nickname|name|filename|file|path|url|uri)$/i;
export function redact(value,depth=0){
  if(depth>8)return '[DEPTH LIMIT]';if(value instanceof Error)return {name:value.name,message:redactText(value.message)};
  if(typeof value==='string')return redactText(value);if(Array.isArray(value))return value.slice(0,100).map(v=>redact(v,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,100).map(([k,v])=>[k,privateField.test(k)?'[REDACTED]':redact(v,depth+1)]));return value;
}
export function installConsoleRedaction(){for(const name of ['log','info','warn','error','debug']){const original=console[name].bind(console);console[name]=(...args)=>original(redactText(format(...args.map(v=>typeof v==='object'?redact(v):v))));}}
