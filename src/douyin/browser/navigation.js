import {validVideo} from '../../works/identity.js';
export async function openTarget(page,url){
  try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});return '';}
  catch(error){
    const code=String(error.message||'').match(/net::ERR_[A-Z_]+/)?.[0];
    const detail=code||error.name||'导航错误';
    // Douyin can redirect or interrupt the navigation while displaying a usable page.
    if(validVideo(page.url()))return '浏览器已打开，但作品跳转未完成。请在该窗口手动打开作品独立页面，再确认当前作品。';
    throw Error(`浏览器已启动，但作品页面加载失败（${detail}）。这不是 DeepSeek Key 错误。请检查该浏览器能否手动访问 https://www.douyin.com/；若可访问，再打开目标作品。`);
  }
}
