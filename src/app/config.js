import {validVideo} from '../works/identity.js';
export function validateConfig(c) {
  if (!validVideo(c.video)) throw Error('请输入 https 抖音作品链接');
  if (!Number.isFinite(c.interval) || c.interval < 10) throw Error('检查间隔至少 10 秒');
  if (!Number.isInteger(c.dailyLimit) || c.dailyLimit < 1 || c.dailyLimit > 200) throw Error('每日上限应为 1–200');
  if (!c.model.trim()) throw Error('请填写 模型名称');
  if (!c.selectors.row || !c.selectors.author || !c.selectors.text) throw Error('请填写评论选择器');
  return c;
}
