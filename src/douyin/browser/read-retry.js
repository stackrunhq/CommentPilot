export function navigationInterrupted(error){return /ERR_ABORTED|interrupted by another navigation|Execution context was destroyed|Cannot find context with specified id|most likely because of a navigation/i.test(String(error?.message||''));}
export function readRetry(error,previous=0){
 const message=String(error?.message||'');
 if(/登录|验证|captcha|closed|已关闭|作品不一致|唯一定位|确认当前作品/i.test(message))return null;
 const transient=navigationInterrupted(error)||error?.name==='TimeoutError'||/Timeout \d+ms exceeded|ERR_(?:NETWORK_CHANGED|CONNECTION_RESET|CONNECTION_TIMED_OUT|INTERNET_DISCONNECTED)/.test(message);
 const attempts=previous+1;return transient&&attempts<3?{attempts,nextAt:Date.now()+10000}:null;
}
