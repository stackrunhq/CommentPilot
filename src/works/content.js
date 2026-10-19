import {workId} from './identity.js';
import {mediaContext} from '../media/context.js';
export function findWorkContent(tree,id){
  const stack=[tree];let visited=0;
  while(stack.length&&visited++<100000){const value=stack.pop();if(!value||typeof value!=='object')continue;
    const key=value.aweme_id??value.awemeId;
    if(String(key)===id){const body=value.desc??value.description;
      if(typeof body==='string'&&body.trim()){
        const images=value.images||value.image_post_info?.images||[];
        const imageUrls=images.map(image=>(image.url_list||image.urlList||image.display_image?.url_list||image.origin_image?.url_list||[]).find(url=>typeof url==='string'&&url.startsWith('https://'))).filter(Boolean);
        return {body:body.trim().slice(0,20000),author:String(value.author?.nickname||''),source:'作品结构化正文',imagesPresent:!!images.length,imageUrls};
      }
    }
    for(const child of Object.values(value))if(child&&typeof child==='object')stack.push(child);
  }return null;
}
export async function extractWorkContent(page,target){
  const id=workId(page.url());if(!id||workId(target)!==id)throw Error('当前页面与配置作品不一致，无法提取背景');
  const documents=await page.locator('script[type="application/json"], script#RENDER_DATA, script#__NEXT_DATA__').allTextContents();
  let content;
  for(const raw of documents){if(raw.length>10000000)continue;try{content=findWorkContent(JSON.parse(raw),id);}catch{try{content=findWorkContent(JSON.parse(decodeURIComponent(raw)),id);}catch{}}if(content)break;}
  if(!content){
    for(const selector of ['[data-e2e="video-desc"]','[data-e2e="detail-video-desc"]','[data-e2e="aweme-desc"]']){
      const rows=page.locator(selector);const texts=[];
      for(let i=0;i<Math.min(await rows.count(),30);i++)if(await rows.nth(i).isVisible()){const text=(await rows.nth(i).innerText()).trim();if(text&&!texts.includes(text))texts.push(text);}
      if(texts.length===1){content={body:texts[0].slice(0,20000),author:'',source:'当前页面可见作品描述',imagesPresent:true};break;}
    }
  }
  if(workId(page.url())!==id)throw Error('提取过程中作品发生切换，请重试');
  if(!content)throw Error('尚未找到作品正文。请等待作品加载或展开描述；不会用主页内容或评论代替作品正文。');
  return {...content,id,url:page.url(),extractedAt:new Date().toISOString(),notice:'仅提取页面提供的文字；图片文字、视频语音及未展开内容可能缺失，尚未执行 OCR 或转写。'};
}
export function replyContext(config,content){const parts=[];if(content&&content.id===workId(config.video)){if(content.body?.trim())parts.push(`作品发布文案（${content.source||'页面提取'}，可能不完整）：\n${content.body}`);if(content.caption?.accepted&&content.caption.text.trim())parts.push(`用户已核对的作品文案：\n${content.caption.text}`);if(content.ocr?.status==='done'&&content.ocr.accepted)parts.push(`图片 OCR（已经人工核对，识别仍可能有误）：\n${content.ocr.text}`);const text=mediaContext(content.media);if(text)parts.push(text);}if(config.context.trim())parts.push(`人工补充资料：\n${config.context.trim()}`);return parts.join('\n\n');}
