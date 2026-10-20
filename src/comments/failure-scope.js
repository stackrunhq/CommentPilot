export function monitorFailure(error){
 const message=String(error?.message||'');
 return /登录|验证码|安全验证|captcha|账号.*失效|账号.*变化|作品.*不一致|确认当前作品|不在抖音|浏览器已关闭|Target.*closed|请先打开浏览器|每日.*上限|Token预算|模型调用上限|API Key|Key 无效|401|403|账户无权限|限流|429|资料.*变更|知识库.*变更/i.test(message);
}
