export function validVideo(value) { try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname === 'douyin.com' || u.hostname.endsWith('.douyin.com')); } catch { return false; } }
export function workId(value){
  if(!validVideo(value))return null;
  const u=new URL(value);const modal=u.searchParams.get('modal_id');
  if(modal&&/^\d+$/.test(modal))return modal;
  return u.pathname.match(/^\/(?:video|note)\/(\d+)\/?$/)?.[1]||null;
}
export function sameWork(a,b){const id=workId(a);return !!id&&id===workId(b);}
export function extractVideo(value){const match=String(value).match(/https:\/\/(?:[\w-]+\.)*douyin\.com\/[^\s<>]*/);return match?match[0]:String(value).trim();}
