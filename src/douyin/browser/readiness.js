export async function assertBrowserReady(page){
  if(!page||page.isClosed())throw Error('登录浏览器已关闭，请重新登录并确认作品');
  for(const selector of ['[id*="captcha"]','[class*="captcha"]','[data-e2e="login-modal"]'])if(await page.locator(selector).filter({visible:true}).count())throw Error('页面出现登录或安全验证，请手动完成后重新确认；程序不会绕过验证');
  for(const text of ['请先登录','扫码登录','请完成安全验证'])if(await page.getByText(text,{exact:true}).filter({visible:true}).count())throw Error('需要手动登录或安全验证，已暂停');
}
