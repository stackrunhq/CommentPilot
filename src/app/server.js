import {approveDraft,assertApproved} from '../comments/approval.js';
import {monitorFailure} from '../comments/failure-scope.js';
import {readRetry,navigationInterrupted} from '../douyin/browser/read-retry.js';
import {waitForPublicationOrReply,matchesPublishRequest} from '../douyin/browser/publication.js';
import {fillReplyEditor,assertReplyTarget} from '../douyin/browser/comments.js';
import {ServiceControls} from '../comments/service-controls.js';
import {lockDataDirectory} from '../security/data-lock.js';
import {conversationLimit,followups,threadCount} from '../comments/conversation.js';
import {expandConversations} from '../douyin/browser/comments.js';
import {Storage} from '../storage/database.js';
import {CommentQueue,retryable,retryDelay} from '../comments/queue.js';
import {WorkScheduler} from '../comments/scheduler.js';
import {CommentWorker} from '../comments/worker.js';
import {parsePersonal,importPersonal,personalRecord,personalEvent} from '../comments/personal.js';
import {reconcileReply} from '../comments/reconciliation.js';
import {Logger,traceRun,traceContext,errorCode,errorMetadata} from '../observability/logger.js';
import {diagnosticReport} from '../observability/diagnostics.js';
import {installConsoleRedaction,redactText,registerSecret} from '../security/redaction.js';
import {DouyinOfficial} from '../douyin/official.js';
import {AccountRegistry} from '../douyin/accounts.js';
import {BrokerSettings} from '../douyin/broker-settings.js';
import {validatePolicy,reviewTasks,workStatistics} from '../comments/operations.js';
import {fullBackup,verifyBackup,restoreBackup} from '../storage/full-backup.js';
import {importKnowledge} from '../knowledge/import.js';
import {MediaManager,maxUpload} from '../media/service.js';
import {providerPresets,discoverModels} from '../models/providers.js';
import {groundedContext} from '../knowledge/context.js';
import http from 'node:http';
import net from 'node:net';
import {readFile,mkdir,readdir} from 'node:fs/promises';
import {projectRoot,uiRoot} from './paths.js';
import path from 'node:path';
import {chromium} from 'playwright';
import {validateConfig} from './config.js';
import {validVideo,workId,sameWork,extractVideo} from '../works/identity.js';
import {generateReply} from '../models/reply.js';
import {openTarget} from '../douyin/browser/navigation.js';
import {assertBrowserReady} from '../douyin/browser/readiness.js';
import {readComments,uniqueComment,waitForNewReply,openComments,adaptComments,activateReply,waitForCommentData,douyinSelectors} from '../douyin/browser/comments.js';
import {extractWorkContent,replyContext} from '../works/content.js';
import {recognizeImages,validImageUrl} from '../media/ocr.js';
import {establishBaseline,ingestComments,identity,recordBelongsToWork} from '../comments/state.js';
import {pollDelay} from '../comments/polling.js';
import {trackCommentTimes,waitForCommentSnapshot} from '../douyin/browser/network.js';
import sharp from 'sharp';

installConsoleRedaction();
const root=projectRoot;
const appVersion=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
const dir=process.env.APP_DATA_DIR?path.resolve(process.env.APP_DATA_DIR):path.join(root,'data'); await mkdir(dir,{recursive:true});
const port=Number(process.env.APP_PORT||3210);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('APP_PORT must be an integer from 1024 to 65535');
// Refuse an occupied dev port before migrating data used by a still-running old service.
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(Error(`${port} 端口已占用，请先检查已运行的工作台`)));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
const allowedOrigins=[`http://127.0.0.1:${port}`,`http://localhost:${port}`];
const defaults={video:'',model:'deepseek-chat',context:'',tone:'自然、友好、简短',ownName:'',interval:10,dailyLimit:20,autoSend:false,selectors:{...douyinSelectors}};
lockDataDirectory(dir);
const storage=new Storage(dir);
const controls=new ServiceControls(storage);
const logger=new Logger(dir,{db:storage.db});storage.logger=logger;

const fatal=error=>{logger.write('process.failed',{errorCode:errorCode(error)},'error');console.error('程序发生未处理异常，请查看脱敏诊断记录。');process.exit(1);};
process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);
const brokerSettings=new BrokerSettings(storage.db);
const accounts=await new AccountRegistry(storage.db,{env:await brokerSettings.env()}).load();
let official=accounts.get(storage.load().config?.accountSlot||'default');
const selectedOfficial=()=>official;
const media=new MediaManager(storage);
const queue=new CommentQueue(storage.db);queue.recover();
// Personal browser mode is an explicit product setting, separate from regression fixtures.
let officialMode=process.env.APP_BROWSER_FIXTURE!=='1'&&!storage.load().config?.personalBrowserEnabled;
const transport=()=>officialMode?'official':process.env.APP_BROWSER_FIXTURE==='1'?'browser-fixture':'personal-browser';
logger.write('process.started',{transport:transport()});
let browserBinding=null,lastBrowserSubmission=0;
let saved=storage.state();
let config={...defaults,...saved.config,selectors:{...defaults.selectors,...saved.config?.selectors}};
let records=saved.records||[], logs=[], apiKey=process.env.DEEPSEEK_API_KEY||'', browser,page,boundUrl='',diagnostics=null,modelCheck=null,running=false,busy=false,timer;
config.connectionId ||= 'legacy-deepseek';
if(apiKey){const c=storage.connections().find(c=>c.id===config.connectionId);if(c?.provider==='deepseek'&&!c.keyConfigured)await storage.saveConnection({...c,apiKey});}
try{apiKey=(await storage.connection(config.connectionId)).key;}catch(error){apiKey='';logger.write('credentials.load_failed',{connectionId:config.connectionId,outcome:'failed',...errorMetadata(error)},'error');}
let workContents=saved.workContents||{},contentStatus='等待打开配置作品',ocrProgress=null;
const monitors=saved.monitors||{};let collectStats=null;
const worker=new CommentWorker({queue,official,records:()=>records,target:targetId,session:()=>monitors[targetId()],config:()=>config,running:()=>running,draft,send:sendOfficial,reconcile:reconcileRecord,logger,stop:()=>{running=false;clearTimeout(timer);}});
const scheduler=new WorkScheduler({gap:1000});
const generators=new WorkScheduler({gap:0,concurrency:Math.max(1,Math.min(4,Number(process.env.APP_MODEL_CONCURRENCY)||config.modelConcurrency||2))});
const deliveries=new WorkScheduler({gap:3000});
const pipelineBusy=()=>scheduler.busy||generators.busy||deliveries.busy;
function stopWork(id){scheduler.stop(id);generators.stop(id);deliveries.stop(id);}
function stopAllWorks(){scheduler.stopAll();generators.stopAll();deliveries.stopAll();}
let lastOfficialSubmission=0;
let monitorStartEpoch=0;
const runtimes=new Map();
const monitoring=()=>running||scheduler.jobs.size>0;
function runtimeState(){return [...runtimes.values()].map(rt=>({workId:rt.id,title:rt.title,accountSlot:rt.official.slot,running:scheduler.active(rt.id),error:rt.error||'',lastCheckedAt:rt.lastCheckedAt||null,queue:queue.stats(rt.official.accountFingerprint(),rt.id),backlog:queue.backlog(rt.official.accountFingerprint(),rt.id),scan:monitors[rt.id]?.scanStatus||null}));}
let pendingScan=null;
let commentTimes=new Map();
let navigationStartedAt=0;
function targetId(){return workId(config.video)||workId(boundUrl);}
function currentContent(){return workContents[workId(config.video)]||null;}
function currentGrounding(cfg=config,query=''){const profile=storage.work(workId(cfg.video));return groundedContext(cfg,workContents[workId(cfg.video)]||null,profile,profile?.knowledgeBaseId?storage.knowledge(profile.knowledgeBaseId):null,query);}
const groundingFor=(cfg,query)=>currentGrounding(cfg,query);
function rememberWork(){const id=workId(config.video);if(!id)return;const previous=storage.work(id);storage.saveWork({...previous,id,url:config.video,title:previous?.title||currentContent()?.body?.slice(0,60)||`作品 ${id}`,context:config.context,connectionId:config.connectionId,tone:config.tone,ownName:config.ownName,interval:config.interval,dailyLimit:config.dailyLimit,autoSend:config.autoSend,maxReplyRounds:config.maxReplyRounds??3,accountSlot:previous?.accountSlot||config.accountSlot||official.slot});}
async function chooseWork(id){const w=storage.work(id);if(!w)throw Error('作品不存在');if(w.accountSlot){official=accounts.get(w.accountSlot);worker.official=official;}const connectionId=w.connectionId||config.connectionId,c=await storage.connection(connectionId);config={...config,accountSlot:w.accountSlot||official.slot,video:w.url,context:w.context||'',connectionId,model:c.model,tone:w.tone||defaults.tone,ownName:w.ownName||config.ownName,interval:w.interval||10,dailyLimit:w.dailyLimit||20,autoSend:w.autoSend??false,maxReplyRounds:w.maxReplyRounds??3};apiKey=c.key;boundUrl='';diagnostics=null;modelCheck=null;collectStats=null;contentStatus='已切换作品，请连接浏览器读取内容';await persist();return w;}
async function syncWork(){if(officialMode){
  const w=await official.work(targetId());const content={...workContents[w.id],id:w.id,body:w.title,source:'抖音官方发布文案（title 字段，可能不完整）',imageUrls:[],notice:'官方发布文案与媒体内容分开处理。请导入作品原图、动图或原视频进行识别，核对后再用于回复。',extractedAt:new Date().toISOString()};
  workContents[w.id]=content;boundUrl=w.url;contentStatus='已读取官方发布文案；导入素材可补充画面和语音';await persist();return content;
}selectWorkPage();if(!page||page.isClosed())throw Error('请先打开登录浏览器');const content=await extractWorkContent(page,config.video);const previous=currentContent();if(previous?.body===content.body)content.ocr=previous.ocr;workContents[content.id]=content;boundUrl=page.url();contentStatus='已提取作品正文';if(!config.ownName&&new URL(page.url()).pathname==='/user/self'){const info=page.locator('[data-e2e="user-info"]').filter({visible:true});if(await info.count()===1)config.ownName=(await info.innerText()).split('\n')[0].trim();}if(!previous||previous.body!==content.body||JSON.stringify(previous.imageUrls)!==JSON.stringify(content.imageUrls)){log(`已提取作品 ${content.id} 正文（${content.body.length} 字）`);await persist();}return content;}
async function prepareComments(){
  checkPage();await assertBrowserReady(page);await openComments(page);
  const response=await waitForCommentSnapshot(commentTimes,targetId(),navigationStartedAt);
  if(response)return response.comments;
  await waitForCommentData(page);try{const comments=await readComments(page,config.selectors);if(comments.length)return comments;}catch{}
  const adapted=await adaptComments(page,config.selectors);if(adapted){config.selectors=adapted.selectors;await persist();log(`真实页面适配成功：读取 ${adapted.comments.length} 条评论`);return adapted.comments;}return [];
}
// A crash during submission leaves an uncertain result: never retry automatically.
for(const r of records){if(r.status==='sending')r.status='uncertain';if(r.status==='generating'){r.status='error';r.lastError='上次生成因程序退出而中断';}}
storage.db.exec("UPDATE model_calls SET status='interrupted' WHERE status='running'; UPDATE reply_attempts SET status='uncertain' WHERE status='sending';");
function log(message,details={}){const entry=logger.message(message,{workId:targetId(),...details});logs.unshift(entry);logs=logs.slice(0,100);storage.event(entry);logger.write('application.event',{workId:targetId(),...details});}
function persist(){storage.save({config,records,workContents,monitors});rememberWork();return Promise.resolve();}
async function activeConnection(){return storage.connection(config.connectionId);}
async function saveKey(key){if(!key?.trim())return;const c=storage.connections().find(c=>c.id===config.connectionId);await storage.saveConnection({...c,apiKey:key.trim()});apiKey=key.trim();}
async function testConnection(c){
  controls.checkBudget();
  const call={created:new Date().toISOString(),status:'running',kind:'connection_test',connectionId:c.id,connectionName:c.name,provider:c.provider,model:c.model};call.id=storage.attempt('model_calls',call);const began=Date.now();
  try{const reply=await generateReply({...config,connection:c,context:'连接测试，无需业务资料'},c.key,{author:'测试',text:'请简短打个招呼。'},result=>Object.assign(call,result));call.response=reply;call.status='succeeded';return {reply};}
  catch(e){call.status='failed';call.error=e.message;throw e;}
  finally{call.durationMs=Date.now()-began;call.finishedAt=new Date().toISOString();storage.attempt('model_calls',call);}
}

await persist();
function selectWorkPage(){if(!browser)return;const pages=browser.pages().filter(p=>!p.isClosed());const target=workId(boundUrl)||workId(config.video);const matches=pages.filter(p=>target&&workId(p.url())===target);if(matches.length===1)page=matches[0];}
function checkPage(){if(officialMode){if(!official.status().authorized)throw Error('请先完成抖音官方授权');if(!targetId())throw Error('请先选择官方作品');return;}selectWorkPage();if(!page||page.isClosed())throw Error('请先打开浏览器并扫码登录');if(!validVideo(page.url()))throw Error('当前浏览器不在抖音页面');if(!boundUrl||!sameWork(page.url(),boundUrl))throw Error('请先核对作品并点击“确认当前作品”，切换作品后需重新确认');}
async function diagnose(){selectWorkPage();if(!page||page.isClosed())throw Error('请先打开登录浏览器');
  const result={url:page.url(),workId:workId(page.url()),configuredWorkId:workId(config.video),confirmed:!!boundUrl&&sameWork(page.url(),boundUrl),title:await page.title(),counts:{},preview:[],notes:[]};
  for(const [name,selector]of Object.entries(config.selectors)){if(!selector){result.counts[name]=0;continue;}if(selector==='@exact-reply-text'){result.counts[name]='内置检测：原评论下新增的精确回复正文';continue;}try{result.counts[name]=await page.locator(selector).count();}catch{result.counts[name]='选择器无效';}}
  const rows=page.locator(config.selectors.row);for(let i=0;i<Math.min(await rows.count(),3);i++){try{const row=rows.nth(i);result.preview.push({author:(await row.locator(config.selectors.author).first().innerText({timeout:1500})).trim(),text:(await row.locator(config.selectors.text).first().innerText({timeout:1500})).trim()});}catch{result.notes.push(`第 ${i+1} 个评论容器未匹配到作者或正文`);}}
  if(!result.workId)result.notes.push('当前是主页或推荐页，请进入具体作品；支持 modal_id 弹窗地址');
  if(!result.counts.row)result.notes.push('未找到评论容器，请展开评论区或校准评论选择器');
  result.commentElements=await page.locator('[data-e2e*="comment"]').evaluateAll(elements=>elements.slice(0,60).map(el=>({tag:el.tagName,marker:el.getAttribute('data-e2e'),visible:!!el.getClientRects().length,children:[...el.children].slice(0,6).map(child=>({tag:child.tagName,marker:child.getAttribute('data-e2e'),className:typeof child.className==='string'?child.className:''})),text:(el.textContent||'').trim().slice(0,180)})));
  diagnostics=result;return result;
}
async function snapshot(){
  pendingScan=null;
  if(officialMode){
    const session=running?monitors[targetId()]:null;if(!session)return official.preview(targetId());
    const result=await official.scan(targetId(),session.scan);const since=Date.parse(session.since);
    const comments=result.comments.filter(c=>!Number.isFinite(Date.parse(c.publishedAt))||Date.parse(c.publishedAt)>=since);
    pendingScan={result,sessionId:session.sessionId,historySkipped:result.comments.length-comments.length};return comments;
  }
  const top=(await prepareComments()).map(c=>({...c,key:identity(c,targetId()),publishedAt:commentTimes.get(`${targetId()}:${c.commentId}`)}));
  await expandConversations(page,records,targetId());
  await page.waitForTimeout(300);
  const replies=[...(commentTimes.threads?.values()||[])].filter(t=>t.target===targetId()&&t.receivedAt>=navigationStartedAt).flatMap(t=>t.comments);
  return [...top,...followups(replies,records,{workId:targetId(),ownName:config.ownName,maxRounds:conversationLimit(config.maxReplyRounds??3)})];
}
async function collect(){const list=await snapshot();collectStats=ingestComments(records,list,{video:config.video,target:targetId(),ownName:config.ownName,session:running?monitors[targetId()]:null});
  if(!officialMode)controls.limitPending(records,targetId());
  if(pendingScan&&monitors[targetId()]?.sessionId===pendingScan.sessionId){monitors[targetId()].scan=pendingScan.result.checkpoint;monitors[targetId()].scanStatus={pagesRead:pendingScan.result.pages,complete:pendingScan.result.complete,historySkipped:pendingScan.historySkipped};collectStats.history+=pendingScan.historySkipped;collectStats.visible+=pendingScan.historySkipped;}
  await persist();if(officialMode&&running)worker.synchronize();logger.write('comments.collected',{workId:targetId(),count:collectStats.visible,...collectStats});log('评论检查完成：读取 '+collectStats.visible+' 条，新评论 '+collectStats.added+'，历史 '+collectStats.history+'，重复 '+collectStats.duplicate);return collectStats.added;
}
async function draft(r,cfg=config){
  controls.checkBudget();
  const config=cfg,targetId=()=>workId(cfg.video),currentGrounding=()=>groundingFor(cfg,r.text);
  if(!recordBelongsToWork(r,config.video,targetId()))throw Error('请先切换到这条评论所属作品');
  const connection=await storage.connection(cfg.connectionId);const grounding=currentGrounding(),background=grounding.text;const call={commentKey:r.key,created:new Date().toISOString(),status:'running',connectionId:connection.id,connectionName:connection.name,provider:connection.provider,model:connection.model,background,references:grounding.references,comment:{author:r.author,text:r.text}};controls.checkBudget();call.id=storage.attempt('model_calls',call);
  const began=Date.now();r.status='generating';r.lastError='';r.generation={model:connection.model,connectionId:connection.id,provider:connection.provider,references:grounding.references,startedAt:new Date().toISOString(),status:'running'};
  log(`开始调用 模型服务：评论 ${r.commentId||r.key}，模型 ${config.model}`,{workId:targetId(),event:'model_start',commentId:r.commentId});await persist();
  try{r.reply=await generateReply({...config,model:connection.model,connection,context:background},connection.key,r,result=>Object.assign(r.generation,result));r.status='draft';r.generation.status='succeeded';log(`模型服务 已生成回复：评论 ${r.commentId||r.key}，耗时 ${((Date.now()-began)/1000).toFixed(1)} 秒`,{workId:targetId(),event:'model_success',commentId:r.commentId});}
  catch(error){r.status='error';r.lastError=error.message;r.generation.status='failed';log(`模型服务 生成失败：${error.message}`,{workId:targetId(),event:'model_error',commentId:r.commentId});throw error;}
  finally{r.generation.finishedAt=new Date().toISOString();r.generation.durationMs=Date.now()-began;storage.attempt('model_calls',{...call,...r.generation,status:r.generation.status,response:r.generation.status==='succeeded'?r.reply:'',error:r.lastError});await persist();}
}
async function send(r,guard=()=>true,options={}){if(officialMode)return sendOfficial(r,guard);checkPage();if(r.status!=='draft')throw Error('只有草稿可以发送');if(!recordBelongsToWork(r,config.video,targetId()))throw Error('该评论不属于当前目标作品');if(!config.ownName)throw Error('先填写当前登录账号昵称，用于排除自己的评论');if(!r.reply.trim())throw Error('回复不能为空');
  if(r.source==='manual-import'||r.source==='douyin-official')throw Error('浏览器只能发送本次浏览器读取的评论');
  await assertBrowserReady(page);
  if(config.personalBrowserEnabled&&(!browserBinding||monitors[targetId()]?.browserBinding!==browserBinding.id||browserBinding.ownName!==config.ownName))throw Error('浏览器账号确认已失效，请重新确认并建立监听起点');
  if(threadCount(records,targetId(),r.rootCommentId||r.commentId)>=conversationLimit(config.maxReplyRounds??3)){r.status='ignored_conversation';r.reason='已达到本条对话回复上限';await persist();return false;}
  const grounding=currentGrounding();if((r.generation?.references?.contextHash&&r.generation.references.contextHash!==grounding.references.contextHash)||(!r.generation?.references&&grounding.references.knowledgeBaseId))throw Error('作品资料或知识库已变更，请重新生成后发送');
  if(!config.selectors.sent)throw Error('请先配置发送成功标记并诊断页面，再发送回复');
  controls.assertSend(r,records,options);
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});const total=records.filter(x=>x.attemptDay===today&&['sent','sending','uncertain','manual_confirmed'].includes(x.status)).length;if(total>=config.dailyLimit)throw Error('已达到每日发送上限（包含结果不明的提交）');
  // Match the currently visible author and text again; duplicates are ambiguous.
  let row;try{row=await uniqueComment(page,config.selectors,r);}catch(error){
    if(error.code!=='COMMENT_NOT_VISIBLE')throw error;
    r.deliveryState='waiting_dom';r.domWaitAttempts=(r.domWaitAttempts||0)+1;r.lastError='已生成回复，等待原评论在页面加载';log(r.lastError,{commentId:r.commentId,event:'send_waiting_dom'});await persist();if(r.domWaitAttempts>=3)throw Error('连续3次无法定位原评论，本条转人工，请检查浏览器页面');return false;
  }
  const sentMatches=config.selectors.sent==='@exact-reply-text'?row.getByText(r.reply,{exact:true}):row.locator(config.selectors.sent).filter({hasText:r.reply});const previousCount=await sentMatches.count();
  const editor=await activateReply(page,row,config.selectors);await assertReplyTarget(row,r.commentId);await fillReplyEditor(editor,r.reply);
  const button=page.locator(config.selectors.send).filter({visible:true});if(await button.count()!==1)throw Error('无法唯一定位发送按钮，请调整选择器');
  const delay=Math.max(0,lastBrowserSubmission+3000-Date.now());if(delay)await new Promise(resolve=>setTimeout(resolve,delay));await assertBrowserReady(page);checkPage();
  if(!guard())throw Error('任务已暂停，未提交');
  await assertReplyTarget(row,r.commentId);
  const attempt={commentKey:r.key,created:new Date().toISOString(),status:'sending',text:r.reply,workId:targetId()};attempt.id=storage.attempt('reply_attempts',attempt);r.status='sending';r.attemptDay=today;log(`正在提交回复到抖音：评论 ${r.commentId||r.key}`,{event:'send_start',commentId:r.commentId});await persist();
  let blockedPublication=false;const publishPattern=/\/comment\/publish\//;const publishGuard=async route=>{if(!matchesPublishRequest(route.request().postData(),{workId:targetId(),parentId:r.commentId,text:r.reply})){blockedPublication=true;await route.abort();return;}await route.fallback();};await page.route(publishPattern,publishGuard);
  try{lastBrowserSubmission=Date.now();await button.click({timeout:5000});if(blockedPublication)throw Error('已拦截回复目标不匹配的请求，未发布');
    const confirmation=await waitForPublicationOrReply(sentMatches,previousCount,commentTimes.publications||[],{workId:targetId(),parentId:r.commentId,text:r.reply,ownName:config.ownName,since:lastBrowserSubmission});r.browserConfirmation=confirmation;if(confirmation.replyId)r.browserReplyId=confirmation.replyId;r.status='sent';r.deliveryState='done';r.lastError='';r.sentAt=new Date().toISOString();log(`已确认回复：评论 ${r.commentId||r.key}（${confirmation.method}）`,{event:'send_success',commentId:r.commentId});
  }catch(error){r.status=blockedPublication?'review':'uncertain';if(blockedPublication)r.reviewRequired=true;r.lastError=blockedPublication?'已阻止发往错误评论或一级评论的请求，未发布':'提交后未确认新增回复：'+redactText(error.message).split('\n')[0];controls.audit('reply.isolated',{key:r.key,reason:r.lastError});log(r.lastError+'；本条不自动重发，继续监听其他新评论');}finally{await page.unroute(publishPattern,publishGuard).catch(()=>{});}
  storage.attempt('reply_attempts',{...attempt,status:r.status,finishedAt:new Date().toISOString(),sentAt:r.sentAt});await persist();
}
async function sendOfficial(r,guard=()=>true,rt=null){assertApproved(r);
  const official=rt?.official||selectedOfficial();
  const cfg=rt?.config||config, targetId=()=>workId(cfg.video), currentGrounding=()=>groundingFor(cfg), workerFor=rt?.worker||worker;
  const stop=()=>{if(rt)stopWork(rt.id);else {running=false;clearTimeout(timer);}};
  if(!official.status().authorized)throw Error('请先完成抖音官方授权');if(r.status!=='draft'||!recordBelongsToWork(r,cfg.video,targetId()))throw Error('请选择当前作品的草稿');
  if(r.source!=='douyin-official'||!r.reply?.trim())throw Error('官方回复需要官方评论及非空草稿');
  const fingerprint=official.accountFingerprint();
  if(monitors[targetId()]?.account!==fingerprint)throw Error('授权账号已变化，请重新启动监听建立基线');
  if(r.generation?.references?.contextHash!==currentGrounding().references.contextHash)throw Error('作品资料已变更，请重新生成');
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
  if(records.filter(x=>x.workId===targetId()&&x.attemptDay===today&&['sent','sending','uncertain','manual_confirmed'].includes(x.status)).length>=cfg.dailyLimit)throw Error('已达到每日发送上限');
  if(records.filter(x=>x.submission?.account===fingerprint&&x.attemptDay===today&&['sent','sending','uncertain','manual_confirmed'].includes(x.status)).length>=200)throw Error('已达到当前账号每日200条提交总上限');
  if(!guard())throw Error('已暂停，未提交');
  const wait=Math.max(0,lastOfficialSubmission+3000-Date.now());if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  const before=await official.replies(targetId(),r.commentId);if(!guard())throw Object.assign(Error('已暂停，未提交回复'),{code:'NOT_SUBMITTED'});
  const attempt={commentKey:r.key,created:new Date().toISOString(),status:'sending',text:r.reply,workId:targetId(),transport:'official'};attempt.id=storage.attempt('reply_attempts',attempt);
  r.status='sending';r.attemptDay=today;r.submission={account:fingerprint,workId:targetId(),commentId:r.commentId,text:r.reply,submittedAt:new Date().toISOString(),beforeIds:before.map(x=>String(x.comment_id)),attemptId:attempt.id};await persist();
  try{lastOfficialSubmission=Date.now();r.officialReplyId=await official.reply(targetId(),r,r.reply,{guard});r.status='sent';r.sentAt=new Date().toISOString();r.lastError='';log('抖音官方接口已确认回复 ID',{workId:targetId(),event:'send_success',commentId:r.commentId});}
  catch(error){
    if(error.code==='NOT_SUBMITTED'){r.status='draft';r.submission=null;}
    else {r.status='uncertain';r.lastError=redactText(error.message);const task=workerFor.ensure(r,'verify');queue.advance(task,'verify');if(rt)rt.error='发送结果未确认，正在只读核验';stop();log('官方发送结果未确认，已暂停发送并安排只读核验；不会自动重发');}
  }
  storage.attempt('reply_attempts',{...attempt,status:r.status,replyId:r.officialReplyId,finishedAt:new Date().toISOString()});if(r.status==='sent'){const task=workerFor.ensure(r,'send');queue.save({...task,status:'done'});}await persist();return r.status==='sent';
}
async function cycle(){return logger.operation('monitor.cycle',runCycle,{workId:targetId()});}
async function runBrowserCycle(){if(!running||busy)return;const began=Date.now();busy=true;try{
  try{checkPage();navigationStartedAt=Date.now();await page.reload({waitUntil:'domcontentloaded',timeout:30000});if(!running)return;await collect();if(monitors[targetId()])monitors[targetId()].readRetry=null;}
  catch(error){const session=monitors[targetId()],retry=readRetry(error,session?.readRetry?.attempts||0);if(!session||!retry)throw error;session.readRetry=retry;log(`评论页面暂未稳定，正在进行第${retry.attempts}次读取重试（最多2次），不会重新发送已提交回复`);await persist();return;}
  for(let processed=0;running&&processed<5;processed++){
    const r=[...records].reverse().find(x=>!x.simulated&&(x.status==='new'||(config.autoSend&&x.status==='draft'&&x.deliveryState==='waiting_dom'))&&x.workId===targetId()&&x.sessionId===monitors[targetId()]?.sessionId);if(!r)break;
    if(controls.control(r.workId,r.rootCommentId||r.commentId).mode!=='auto'||(!r.reviewApproved&&controls.reviewReason(r))){r.status='review';r.reviewRequired=true;r.reason=controls.reviewReason(r)||'对话已转人工或关闭';await persist();continue;}
    try{if(r.status==='new')await draft(r);if(running&&config.autoSend){try{if(await send(r,()=>running)===false)continue;}catch(error){if(r.status!=='draft'||!navigationInterrupted(error)||(r.navigationRetries||0)>=2)throw error;r.navigationRetries=(r.navigationRetries||0)+1;r.deliveryState='waiting_dom';r.lastError='页面刷新打断定位，尚未提交，等待页面恢复后定位原评论';log(r.lastError);await persist();break;}}}
    catch(error){if(monitorFailure(error))throw error;if(['sending','uncertain'].includes(r.status)){r.status='uncertain';}else{r.status=r.reply?'review':'error';if(r.reply)r.reviewRequired=true;}r.lastError=redactText(error.message).split('\n')[0];r.deliveryState='isolated';controls.audit('reply.isolated',{key:r.key,reason:r.lastError});log('单条评论已隔离，继续处理其他新评论：'+r.lastError);await persist();}
  }
}catch(e){logger.write('monitor.failed',{workId:targetId(),outcome:'failed',...errorMetadata(e)},'error');log(redactText(e.message));controls.audit('monitor.paused',{reason:redactText(e.message)});running=false;}finally{busy=false;if(running)timer=setTimeout(cycle,Math.max(pollDelay(config.interval,began),(monitors[targetId()]?.readRetry?.nextAt||0)-Date.now()));}}
async function runCycle(){return officialMode?runOfficialCycle():runBrowserCycle();}
async function runOfficialCycle(){if(!running||busy)return;const began=Date.now();busy=true;try{
  checkPage();const session=monitors[targetId()];if(session?.account!==official.accountFingerprint())throw Error('授权账号已变化，请重新建立监听');
  if(!session.scanRetry?.nextAt||session.scanRetry.nextAt<=Date.now()){
    try{await collect();session.scanRetry=null;await persist();}
    catch(error){const attempts=(session.scanRetry?.attempts||0)+1;if(!retryable(error)||attempts>=5)throw error;session.scanRetry={attempts,nextAt:Math.max(Date.now()+retryDelay(attempts),official.cooldown||0),errorCode:errorCode(error)};await persist();logger.write('scan.retry',{workId:targetId(),outcome:'failed',...errorMetadata(error)});}
  }
  if(running)await worker.process();
}catch(error){logger.write('monitor.failed',{workId:targetId(),outcome:'failed',...errorMetadata(error)},'error');log(redactText(error.message));running=false;}
finally{busy=false;if(running)timer=setTimeout(cycle,Math.max(pollDelay(config.interval,began),(monitors[targetId()]?.readRetry?.nextAt||0)-Date.now()));}}
async function reconcileRecord(r,id=targetId(),client=official){
  const official=client;
  const targetId=()=>id;
  if(r.status!=='uncertain'||!r.submission||r.submission.account!==official.accountFingerprint()||r.submission.workId!==targetId())throw Error('该回复缺少当前账号/作品的发送快照，需人工核实');
  const result=reconcileReply(await official.replies(targetId(),r.submission.commentId),r.submission,official.token.open_id);
  r.reconciliation={...result,checkedAt:new Date().toISOString()};
  if(result.status==='confirmed'){r.status='sent';r.officialReplyId=result.replyId;r.sentAt=result.publishedAt;r.lastError='';storage.attempt('reply_attempts',{id:r.submission.attemptId,commentKey:r.key,workId:targetId(),created:r.submission.submittedAt,status:'sent',replyId:result.replyId,text:r.submission.text,transport:'official',verification:'official-reply-list',finishedAt:new Date().toISOString()});log('官方回复列表已核验成功，未重复提交回复',{event:'send_verified',commentId:r.commentId});}
  await persist();logger.write('reply.verified',{workId:targetId(),commentKey:r.key,status:result.status,outcome:result.status==='confirmed'?'succeeded':'running'});return result.status==='confirmed';
}
async function action(name,body){
  for(const key of ['apiKey','code','state'])registerSecret(body?.[key]);
  if(name==='service-status')return {...controls.status(records,targetId()),runtime:{running:monitoring(),busy:busy||pipelineBusy(),browserOpen:!!browser,scan:collectStats,monitorSince:monitors[targetId()]?.since||null,lastErrors:records.filter(r=>r.workId===targetId()&&(r.lastError||r.status==='uncertain')).slice(0,5).map(r=>({key:r.key,status:r.status,message:r.lastError||'提交结果不明；先在抖音核对，不要重发'}))}};
  if(name==='work-export'){const work=storage.work(targetId());if(!work)throw Error('请先选择作品');return {format:'commentpilot-work-export-v1',createdAt:new Date().toISOString(),work,records:records.filter(r=>r.workId===targetId()).map(r=>({...r,...storage.details(r.key)})),notice:'包含评论、回复和模型资料正文，请保管好导出文件；不含API Key或登录凭据'};}
  if(name==='preflight'){
    const checks=[];const add=(id,label,ok,fix)=>checks.push({id,label,ok:!!ok,fix});
    add('work','作品已保存',!!storage.work(targetId()),'保存作品与资料');const c=await activeConnection();add('model','模型凭据已配置',c.auth==='none'||!!c.key,'在模型连接中保存Key，或使用本地模型');
    try{currentGrounding();add('facts','回复资料可用',true,'');}catch{add('facts','回复资料可用',false,'补充已核对的文案或绑定知识库');}
    add('browser','账号与作品已确认',officialMode?official.status().authorized:!!browserBinding&&browserBinding.workId===targetId()&&browserBinding.ownName===config.ownName,'打开浏览器登录并确认本人账号及目标作品');
    try{controls.checkBudget();add('budget','今日调用预算可用',true,'');}catch(e){add('budget','今日调用预算可用',false,e.message);}
    return {ready:checks.every(c=>c.ok),checks,scope:officialMode?'官方接口，权限以实际获批能力为准':'单作品，当前页面可加载评论；楼中楼最多展开20条对话，不保证全量'};
  }
  if(name==='diagnostics-export'){logger.write('diagnostics.exported');return diagnosticReport(storage,logger,{version:appVersion,running:monitoring(),busy,transport:transport(),mediaActive:media.active,official:official.status(),limit:body.limit});}
  if(name==='diagnostics-status')return {healthy:!logger.failed,retentionDays:logger.retentionDays,maxEvents:10000,fileBytes:logger.maxBytes,fileBackups:logger.backups};
  if(name==='models-discover'){
    if(body.connectionId){const c=await storage.connection(body.connectionId);return discoverModels(c,c.key);}
    // Default auto-discovery only contacts the normal local Ollama service.
    const provider=body.provider||'ollama';return discoverModels({provider,baseUrl:body.baseUrl||providerPresets[provider]?.baseUrl,protocol:body.protocol||providerPresets[provider]?.protocol,auth:providerPresets[provider]?.auth},String(body.apiKey||''));
  }
  if(name==='monitor-status')return {works:runtimeState(),modelConcurrency:1,sendConcurrency:1};
  if(name==='monitor-stop'){monitorStartEpoch++;stopWork(String(body.id));return {};}
  if(name==='works')return {works:storage.works()};
  if(name==='operations-status')return {works:workStatistics(storage.db),pipeline:{scan:scheduler.inflight.size,generate:generators.inflight.size,send:deliveries.inflight.size,modelConcurrency:generators.concurrency}};
  if(name==='knowledge-list')return {knowledge:storage.knowledgeList()};
  if(name==='history')return storage.history(body);
  if(name==='history-detail')return storage.details(body.key);
  if(name==='queue-status')return {tasks:queue.summaries(official.accountFingerprint(),targetId()),scan:monitors[targetId()]?.scanStatus||null};
  if(name==='queue-review-list'){const id=String(body.workId||targetId()),account=monitors[id]?.account;return {tasks:queue.list(account,id).filter(t=>t.status==='review'&&t.stage!=='verify').slice(0,100).map(t=>({...t,record:records.find(r=>r.key===t.commentKey)}))};}
  if(name==='backup')return {file:await storage.backup()};
  if(name==='media-cancel'){media.cancel();return {};}
  if(name==='stop'){controls.audit('monitor.stopped');monitorStartEpoch++;stopAllWorks();running=false;clearTimeout(timer);log('已暂停，已提交的请求可能仍在完成');return {};}
  if(name==='monitor-start'){if(!officialMode)throw Error('多作品监听仅支持官方接口');if(running||busy||scheduler.busy||media.active)throw Error('正在处理，请稍后重试');busy=true;try{return await startWorkMonitor(String(body.id),!!body.resume);}finally{busy=false;}}
  if(monitoring())throw Error('请先暂停全部监听，再执行其他操作');
  if(busy||pipelineBusy())throw Error('正在处理，请稍后操作');
  busy=true;try{
    if(name==='work-redact'){
      const id=targetId();if(!id||String(body.confirmWorkId)!==id)throw Error('请输入当前作品ID确认清除文本');if(media.active)throw Error('请先等待素材任务结束');
      const backup=await fullBackup(storage);if(browser){await browser.close();browser=null;page=null;browserBinding=null;boundUrl='';}const selected=records.filter(r=>r.workId===id);
      for(const r of selected){controls.setControl(id,r.rootCommentId||r.commentId,'closed');const keep=Object.fromEntries(['key','workId','commentId','rootCommentId','replyToCommentId','video','source','created','sentAt','attemptDay','status','sessionId','simulated'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));Object.keys(r).forEach(k=>delete r[k]);Object.assign(r,keep,{author:'已清除',text:'正文已清除',reply:'',redactedBody:true});if(!['sent','sending','uncertain','manual_confirmed'].includes(r.status))r.status='rejected';
        for(const table of ['model_calls','reply_attempts'])for(const row of storage.db.prepare(`SELECT id,data FROM ${table} WHERE comment_key=?`).all(r.key)){const data=JSON.parse(row.data),minimal=Object.fromEntries(['id','commentKey','created','status','usage','model','provider','connectionId','durationMs','finishedAt','sentAt','replyId'].filter(k=>data[k]!==undefined).map(k=>[k,data[k]]));storage.db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(JSON.stringify({...minimal,redactedBody:true}),row.id);}
      }
      config.context='';delete workContents[id];storage.db.prepare('DELETE FROM works WHERE id=?').run(id);storage.db.prepare('DELETE FROM work_content_versions WHERE work_id=?').run(id);const w=storage.work(id);if(w)storage.saveWork({...w,context:'',knowledgeBaseId:''});await persist();controls.audit('work.text_cleared',{work:id,count:selected.length});return {backup:backup.folder,count:selected.length,notice:'当前作品文本已清除，去重标识和轮数保留，对话已关闭。原媒体、共享知识库及历史备份仍保留，需另行管理。'};
    }
    if(name==='service-backups'){const folder=path.join(dir,'backups');await mkdir(folder,{recursive:true});return {backups:(await readdir(folder,{withFileTypes:true})).filter(e=>e.isDirectory()&&e.name.startsWith('Full-')).map(e=>e.name).sort().reverse().slice(0,50)};}
    if(name==='service-restore'){const name=String(body.name||'');if(!/^Full-[\w-]+$/.test(name))throw Error('请选择完整备份');const destination=path.join(dir,'restores','Restore-'+Date.now());await mkdir(path.dirname(destination),{recursive:true});const result=await restoreBackup(path.join(dir,'backups',name),destination);controls.audit('backup.restored',{files:result.files});return {...result,notice:'已恢复至独立目录，当前数据未切换。关闭程序后按部署说明使用恢复目录。'};}
    if(name==='service-policy')return controls.save(body);
    if(name==='service-cleanup'){if(body.confirmed!==true)throw Error('请先查看清理范围并确认');return controls.cleanup();}
    if(name==='conversation-control'){if(officialMode)throw Error('此入口仅管理个人浏览器对话');if(!records.some(r=>r.workId===targetId()&&(r.rootCommentId||r.commentId)===body.root))throw Error('当前作品未找到该对话');return controls.setControl(targetId(),String(body.root),body.mode);}
    if(name==='review-personal'){if(officialMode)throw Error('请使用官方审核入口');const r=records.find(r=>r.key===body.key&&r.workId===targetId());if(!r||!['review','draft'].includes(r.status))throw Error('请选择待审核评论或草稿');if(body.reject){r.status='rejected';r.reason='人工跳过';}else{if(!r.reply){await draft(r);r.status='review';r.reviewApproved=false;}else{approveDraft(r);r.status='draft';}}controls.audit('review.completed',{key:r.key,rejected:!!body.reject});await persist();return {};}
    if(name==='browser-outcome'){const r=records.find(r=>r.key===body.key&&r.workId===targetId()&&r.status==='uncertain'&&r.source!=='douyin-official');if(!r||body.confirmed!==true)throw Error('只能人工确认当前作品结果不明的浏览器记录');r.status='manual_confirmed';r.reason='用户在平台核对后确认已发布，未经程序核验';r.manualVerifiedAt=new Date().toISOString();controls.audit('reply.manually_confirmed',{key:r.key});await persist();return {};}
    if(name==='browser-personal-enable'){
      if(typeof body.enabled!=='boolean')throw Error('模式设置无效');
      if(browser){await browser.close();browser=null;page=null;}browserBinding=null;boundUrl='';
      config.personalBrowserEnabled=body.enabled;config.assistantMode='personal';officialMode=!body.enabled&&process.env.APP_BROWSER_FIXTURE!=='1';await persist();return {transport:transport()};
    }
    if(name==='browser-personal-config'){
      if(!config.personalBrowserEnabled)throw Error('请先启用个人浏览器模式');
      const ownName=String(body.ownName||'').trim();if(!ownName||ownName.length>100)throw Error('请填写当前登录账号的准确昵称');
      const next=validateConfig({...config,ownName,interval:Number(body.interval??10),dailyLimit:Number(body.dailyLimit??20),autoSend:body.autoSend===true,maxReplyRounds:conversationLimit(body.maxReplyRounds??3)});
      if(next.ownName!==config.ownName)browserBinding=null;config=next;await persist();return {};
    }
    if(name==='personal-mode'){if(!['personal','official'].includes(body.mode))throw Error('模式无效');config.assistantMode=body.mode;await persist();return {};}
    if(name==='personal-work'){
      const url=extractVideo(body.url),id=workId(url);if(!id)throw Error('请粘贴具体作品的完整链接，用于本机归档，不会自动访问抖音');
      const existing=storage.work(id),connectionId=String(body.connectionId||existing?.connectionId||config.connectionId);await storage.connection(connectionId);
      const context=String(body.context||'').trim();if(context.length>20000)throw Error('作品资料最多20000字');
      rememberWork();storage.saveWork({...existing,id,url,title:String(body.title||'').trim()||existing?.title||'我的作品',context,connectionId,knowledgeBaseId:String(body.knowledgeBaseId||''),autoSend:false});await chooseWork(id);config.assistantMode='personal';await persist();return {id};
    }
    if(name==='personal-import'){if(!targetId()||!storage.work(targetId()))throw Error('请先保存作品');const result=importPersonal(records,parsePersonal(body),{workId:targetId(),video:config.video});await persist();return result;}
    if(name==='personal-generate'){
      if(!Array.isArray(body.keys)||!body.keys.length||body.keys.length>20)throw Error('一次选择1～20条评论');
      const selected=[...new Set(body.keys)].map(key=>personalRecord(records,key,targetId()));if(selected.some(r=>!['new','draft','error'].includes(r.status)))throw Error('已人工确认发布的记录不能重新生成');
      const result=[];for(const r of selected){try{await draft(r);result.push({key:r.key,ok:true});}catch{result.push({key:r.key,ok:false});}}return {results:result};
    }
    if(name==='personal-edit'){const r=personalRecord(records,body.key,targetId());if(!['new','draft','error'].includes(r.status))throw Error('已确认发布的记录不可修改');const reply=String(body.reply||'').trim();if(!reply||reply.length>200)throw Error('回复应为1～200字');r.reply=reply;r.status='draft';r.editedAt=new Date().toISOString();await persist();return {};}
    if(name==='personal-copied'||name==='personal-published'){const r=personalRecord(records,body.key,targetId());if(name==='personal-published'&&body.confirmed!==true)throw Error('请先确认已经在抖音手动发布');personalEvent(r,name==='personal-copied'?'copied':'published');await persist();return {};}
    if(name==='broker-settings'){registerSecret(body.token);await brokerSettings.save(body);return {restartRequired:true};}
    if(name==='backup-full'){if(media.active)throw Error('请先等待素材解析结束');return fullBackup(storage);}
    if(name==='backup-verify'){const folder=path.resolve(String(body.folder||'')),base=path.resolve(dir,'backups')+path.sep;if(!folder.startsWith(base))throw Error('请选择本机备份目录');const m=await verifyBackup(folder);return {valid:true,files:m.entries.length};}
    if(name==='queue-review'){const id=String(body.workId||targetId()),session=monitors[id];if(!session)throw Error('没有监听会话');const result=reviewTasks(queue,records,{workId:id,account:session.account,sessionId:session.sessionId},body);await persist();return result;}
    if(name==='pipeline-config'){const n=Number(body.modelConcurrency);if(!Number.isInteger(n)||n<1||n>4)throw Error('模型并发应为1～4');generators.concurrency=n;config.modelConcurrency=n;await persist();return {};}
    if(name==='accounts-create')return accounts.create(body.name);
    if(name==='official-refresh'){await official.load();return official.status();}
    if(name==='accounts-select'){rememberWork();official=accounts.get(String(body.id));worker.official=official;config.accountSlot=official.slot;config.video='';boundUrl='';await persist();return {};}
    if(name==='reset-scan'){const session=monitors[targetId()];if(!session||session.account!==official.accountFingerprint())throw Error('No matching monitor session');session.scan=null;session.scanRetry=null;session.scanStatus=null;await persist();return {};}
    if(name==='verify-pending'){worker.synchronize();for(const task of queue.list(official.accountFingerprint(),targetId()).filter(t=>t.stage==='verify'&&['review','retry_wait','ready'].includes(t.status)))queue.save({...task,status:'ready',attempts:0,nextAt:0});await worker.verify();return {};}
    if(name==='retry-task'){const task=queue.list(official.accountFingerprint(),targetId()).find(t=>t.id===body.id);if(!task||task.stage!=='generate'||task.sessionId!==monitors[targetId()]?.sessionId)throw Error('只能重试当前会话未发送的生成任务');const r=records.find(r=>r.key===task.commentKey);if(!r||r.status!=='error'||r.submission)throw Error('该任务不能自动重试');r.status='new';queue.advance(task,'generate');await persist();return {};}
    if(name==='caption-save'){
      media.validateWork(targetId());const text=String(body.text||'').trim();if(text.length>20000)throw Error('作品文案最多20000字符');
      const content=workContents[targetId()]||{id:targetId(),body:'',source:'用户补充资料'};content.caption={text,accepted:true,source:'用户录入或核对',updatedAt:new Date().toISOString()};workContents[targetId()]=content;await persist();return {};
    }
    if(name==='media-delete'){await media.remove(targetId(),body.id);if(currentContent()?.media?.assetIds.includes(body.id)){currentContent().media.accepted=false;await persist();}return {};}
    if(name==='media-start')return media.start(targetId(),body,async job=>{const content=workContents[job.workId]||{id:job.workId,body:'',source:'用户导入素材'};content.media=job;workContents[job.workId]=content;await persist();});
    if(name==='media-accept'){
      const job=media.job(body.id);if(!job||job.workId!==targetId()||job.status!=='done')throw Error('请选择当前作品已完成的识别结果');
      if(media.active)throw Error('请等待解析结束后核对');const ids=media.assets(targetId()).map(a=>a.id);if(ids.length!==job.assetIds.length||job.assetIds.some(id=>!ids.includes(id)))throw Error('素材列表已变化，请重新识别');
      const text=String(body.text??job.text).trim();if(!text||text.length>50000)throw Error('核对后的识别文字应为1–50000字符');job.text=text;job.accepted=true;job.acceptedAt=new Date().toISOString();media.saveJob(job);
      const content=currentContent()||{id:targetId(),body:'',source:'用户导入素材'};content.media=job;workContents[targetId()]=content;await persist();return {};
    }
    if(name==='media-unaccept'){if(currentContent()?.media){currentContent().media.accepted=false;media.saveJob(currentContent().media);await persist();}return {};}
    if(name==='official-authorize')return official.authorize();
    if(name==='official-callback')return official.accept(body);
    if(name==='official-disconnect'){await official.disconnect();boundUrl='';return {};}
    if(name==='official-works')return {works:await official.works()};
    if(officialMode&&['browser','connect','navigate','verify','diagnose','adapt-comments','reply-inspect','open-comments','browser-inspect'].includes(name))throw Error('已改为官方接口，请使用“抖音授权”和“读取官方作品”');
    if(officialMode&&name==='ocr')throw Error('官方作品列表没有提供完整媒体素材；当前不能对视频或图集执行完整 OCR。请先提供已核对的知识库或作品补充资料');
    if(name==='works-save'){
      if(body.accountSlot)accounts.get(String(body.accountSlot));
      if(body.queuePolicy)body.queuePolicy=validatePolicy(body.queuePolicy);
      if(body.interval!==undefined&&(!Number.isFinite(body.interval)||body.interval<10))throw Error('检查间隔至少10秒');
      if(body.dailyLimit!==undefined&&(!Number.isInteger(body.dailyLimit)||body.dailyLimit<1||body.dailyLimit>200))throw Error('每日上限应为1～200');
      if(body.autoSend!==undefined&&typeof body.autoSend!=='boolean')throw Error('自动发送设置无效');
      const w=storage.saveWork({...body,accountSlot:body.accountSlot||official.slot});if(w.id===workId(config.video)){config.context=w.context;config.autoSend=w.autoSend??false;config.interval=w.interval||10;config.dailyLimit=w.dailyLimit||20;if(w.connectionId){const c=await storage.connection(w.connectionId);config.connectionId=c.id;config.model=c.model;apiKey=c.key;}await persist();}return w;
    }
    if(name==='works-select'){rememberWork();return chooseWork(body.id);}
    if(name==='knowledge-save')return storage.saveKnowledge(body);
    if(name==='knowledge-delete'){storage.deleteKnowledge(body.id);return {};}
    if(name==='runtime-test'&&process.env.APP_SMOKE_TEST==='1'){
      const image=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200"><rect width="800" height="200" fill="white"/><text x="50" y="130" font-family="Arial" font-size="80" fill="black">TEST 123</text></svg>')).png().toBuffer();
      const result=await recognizeImages([image],path.join(dir,'ocr'));
      const c=await storage.saveConnection({provider:'custom',name:'Packaged encryption test',baseUrl:'http://127.0.0.1:11434/v1',protocol:'chat',model:'fixture',apiKey:'packaged-fixture-secret'});
      const encryptionOk=(await storage.connection(c.id)).key==='packaged-fixture-secret';storage.deleteConnection(c.id);
      return {ocrOk:/TEST\s*123/i.test(result.text),engine:result.pages[0].engine,databaseOk:storage.history().total===0,encryptionOk};
    }
    if(name==='connections-save'){const c=await storage.saveConnection(body);if(body.makeDefault||!config.connectionId||config.connectionId===c.id){config.connectionId=c.id;config.model=c.model;apiKey=(await storage.connection(c.id)).key;modelCheck=null;await persist();}return {id:c.id};}
    if(name==='connections-select'){const c=await storage.connection(body.id);config.connectionId=c.id;config.model=c.model;apiKey=c.key;modelCheck=null;await persist();return {};}
    if(name==='connections-delete'){if(body.id===config.connectionId)throw Error('请先选择其他默认连接');storage.deleteConnection(body.id);return {};}
    if(name==='connections-test'){controls.checkBudget();return testConnection(await storage.connection(body.id));}
    if(name==='credentials'){
      if(config.connectionId!=='legacy-deepseek'){await saveKey(body.apiKey);return {keyConfigured:!!apiKey};}

      const key=String(body.apiKey||'').trim();const model=String(body.model||config.model).trim();
      if(!model)throw Error('请填写 模型服务 模型名称');
      if(key||model!==config.model)modelCheck=null;
      if(key)await saveKey(key);
      config.model=model;await storage.saveConnection({...storage.connections().find(c=>c.id===config.connectionId),model});await persist();return {keyConfigured:!!apiKey};
    }
    if(name==='config'){
      const video=extractVideo(body.video??config.video),changed=workId(video)!==workId(config.video);let base=config;
      if(changed){rememberWork();const w=storage.work(workId(video));base={...config,context:w?.context||'',tone:w?.tone||defaults.tone,autoSend:w?.autoSend??false,interval:w?.interval||10,dailyLimit:w?.dailyLimit||20};if(w?.connectionId){const c=await storage.connection(w.connectionId);base.connectionId=c.id;base.model=c.model;apiKey=c.key;}}
      const next=validateConfig({...base,...body,video,selectors:{...config.selectors,...body.selectors}});delete next.apiKey;
      if(next.video!==config.video){boundUrl='';diagnostics=null;collectStats=null;contentStatus='等待加载新作品';}if(next.model!==config.model||body.apiKey?.trim())modelCheck=null;config=next;if(body.apiKey?.trim())await saveKey(body.apiKey);await persist();return {};
    }
    if(name==='model-test'){const {reply}=await testConnection(await activeConnection());modelCheck={time:new Date().toISOString(),model:config.model,reply};log('模型服务实际调用成功');return modelCheck;}
    if(name==='extract'){return await syncWork();}
    if(name==='ocr'){
      const content=await syncWork();const urls=[...new Set(content.imageUrls||[])];
      if(!urls.length)throw Error('未从目标作品中提取到原图地址，暂不能执行 OCR');
      if(urls.length>20)throw Error('本版最多识别20张作品图片');
      const images=[];ocrProgress={phase:'下载作品原图',total:urls.length,image:0};
      try{
        for(const url of urls){checkPage();if(!validImageUrl(url))throw Error('图片地址不在抖音图片域名范围');const response=await page.request.get(url,{timeout:30000,maxRedirects:0});if(!response.ok())throw Error(`原图下载失败 HTTP ${response.status()}`);if(!response.headers()['content-type']?.startsWith('image/'))throw Error('原图响应不是图片');if(Number(response.headers()['content-length'])>20000000)throw Error('单张图片超过20MB限制');const bytes=await response.body();if(bytes.length>20000000)throw Error('单张图片超过20MB限制');images.push(bytes);}
        const result=await recognizeImages(images,path.join(dir,'ocr'),progress=>{ocrProgress={...ocrProgress,...progress};});checkPage();
        result.accepted=result.pages.every(p=>!p.needsReview&&typeof p.confidence==='number'&&p.confidence>=80&&p.text.trim());
        content.ocr=result;workContents[content.id]=content;await persist();log(`OCR 完成：${result.pages.length} 张图片，${result.accepted?'已用于回复背景':'低置信度，等待核对'}`);return result;
      }finally{ocrProgress=null;}
    }
    if(name==='ocr-accept'){const content=currentContent();if(!content?.ocr)throw Error('请先执行 OCR');content.ocr.text=String(body.text??content.ocr.text).slice(0,50000);content.ocr.accepted=true;await persist();return {};}
    if(name==='adapt-comments'){await syncWork();const comments=await snapshot();return {count:comments.length,comments,selectors:config.selectors};}
    if(name==='reply-inspect'){
      await prepareComments();const rows=page.locator(config.selectors.row).filter({visible:true});if(!await rows.count())throw Error('没有评论可检查');
      const editor=await activateReply(page,rows.first(),config.selectors);
      try{await fillReplyEditor(editor,'回复链路测试（未发送）');await editor.press('End');return {editors:await editor.evaluateAll(els=>els.map(e=>e.outerHTML.slice(0,2000))),shell:await editor.evaluate(e=>{const shells=[];for(let p=e.parentElement,n=0;p&&n<5;p=p.parentElement,n++)shells.push(p.outerHTML.slice(0,24000));return shells;}),buttons:await page.getByText('发送',{exact:true}).evaluateAll(els=>els.filter(e=>e.getClientRects().length).map(e=>e.outerHTML)),text:(await page.locator('body').innerText()).slice(-1500)};}
      finally{await fillReplyEditor(editor,'');}
    }
    if(name==='open-comments'){checkPage();await openComments(page);return {};}
    if(name==='browser-inspect'){
      selectWorkPage();if(!page||page.isClosed())throw Error('请先打开登录浏览器');
      await page.screenshot({path:path.join(dir,'browser-inspect.png')});
      return {url:page.url(),title:await page.title(),text:(await page.locator('body').innerText()).slice(-14000),commentHtml:(await page.locator('[data-e2e*="comment"]').evaluateAll(els=>els.filter(e=>e.getClientRects().length).slice(0,12).map(e=>e.outerHTML.slice(0,15000)))),frames:page.frames().map(f=>f.url()),controls:await page.locator('button, [role="button"], [data-e2e]').evaluateAll(els=>els.filter(e=>e.getClientRects().length).slice(0,200).map(e=>({tag:e.tagName,role:e.getAttribute('role'),marker:e.getAttribute('data-e2e'),label:e.getAttribute('aria-label'),text:(e.innerText||'').slice(0,100)})))};
    }
    if(name==='diagnose'){const result=await diagnose();log(`诊断完成：作品 ${result.workId||'未识别'}，评论容器 ${result.counts.row}`);return result;}
    if(name==='verify'){selectWorkPage();if(!page||page.isClosed()||!workId(page.url()))throw Error('请打开具体作品；支持 video、note 及带 modal_id 的弹窗链接');if(workId(config.video)&&!sameWork(config.video,page.url()))throw Error('浏览器中的作品与配置不一致，请先打开目标作品');await assertBrowserReady(page);if(config.personalBrowserEnabled){if(body.confirmed!==true||!config.ownName)throw Error('请先保存账号昵称，并确认已登录本人账号且作品属于自己');browserBinding={id:crypto.randomUUID(),ownName:config.ownName,workId:targetId()};}boundUrl=page.url();log(`已确认作品 ${workId(boundUrl)}`);return {};}
    if(name==='browser'||name==='connect'){
      if(!targetId())throw Error('请先保存要监听的具体作品');
      if(browser&&page&&!page.isClosed()){
        await page.bringToFront();
        if(!validVideo(page.url())||(name==='connect'&&!sameWork(page.url(),config.video))){boundUrl='';const warning=await openTarget(page,config.video);log(warning||'已重新打开目标作品');}
        else log('已切回现有登录浏览器，不重复跳转作品链接');return {};
      }
      if(!browser){browserBinding=null;browser=await chromium.launchPersistentContext(path.join(dir,'browser'),{headless:false,channel:process.env.BROWSER_CHANNEL||undefined,viewport:null});commentTimes=trackCommentTimes(browser);browser.on('close',()=>{browser=null;page=null;browserBinding=null;boundUrl='';running=false;clearTimeout(timer);});}
      page=browser.pages()[0]||await browser.newPage();boundUrl='';
      const warning=await openTarget(page,config.video);
      log(warning||'浏览器已打开，请扫码登录，打开评论区并核对目标作品');return {};
    }
    if(name==='navigate'){if(!browser)throw Error('请先打开登录浏览器');selectWorkPage();if(!page||page.isClosed())page=await browser.newPage();boundUrl='';diagnostics=null;const warning=await openTarget(page,config.video);log(warning||'已打开配置作品，请核对后确认');return {};}
    if(name==='collect'){await collect();return {};}
    if(name==='sample'){const text=String(body.text||'').trim();if(!text)throw Error('请输入模拟评论');records.unshift({key:crypto.randomUUID(),author:'模拟用户',text,video:config.video,simulated:true,status:'new',reply:'',created:new Date().toISOString()});await persist();return {};}
    if((name==='start'||name==='resume')&&officialMode){await persist();return startWorkMonitor(targetId(),name==='resume');}
    if(name==='start'||name==='resume'){
      controls.checkBudget();
      if(media.active)throw Error('请等待或取消素材解析任务，再启动监听');
      if((await activeConnection()).auth!=='none'&&!apiKey)throw Error('请配置当前模型连接的 API Key');
      try{await syncWork();}catch(error){contentStatus=error.message;currentGrounding();}
      checkPage();currentGrounding();
      if(!officialMode)await assertBrowserReady(page);
      if(config.personalBrowserEnabled&&(!browserBinding||browserBinding.ownName!==config.ownName||browserBinding.workId!==targetId()))throw Error('请先确认登录账号及作品归属');
      if(officialMode){commentRouteGuard();}else if(!config.ownName.trim())throw Error('请填写登录账号昵称');
      if(name==='resume'){
        const previous=monitors[targetId()];if(officialMode&&previous?.account!==official.accountFingerprint())throw Error('请重新启动监听，不能恢复旧账号或浏览器基线');if(!previous?.sessionId||!Number.isFinite(Date.parse(previous.since)))throw Error('该作品没有可恢复的监听，请使用启动监听建立历史基线');
        if(config.personalBrowserEnabled&&previous.browserBinding!==browserBinding.id)throw Error('浏览器已重新打开或账号重新确认，请启动新监听，不能沿用旧账号会话');
        if(!officialMode&&config.autoSend&&!config.selectors.sent)throw Error('自动发送前必须配置发送成功标记');
        log(`继续上次监听：保留起点 ${previous.since}，检查间隔 ${config.interval} 秒`);controls.audit('monitor.started',{work:targetId(),resume:name==='resume'});running=true;timer=setTimeout(cycle,0);return {};
      }
      const baseline=await snapshot();
      if(!officialMode&&!baseline.length&&await page.locator('[data-e2e="comment-list"]').filter({visible:true}).count()!==1)throw Error('评论区尚未加载，无法建立历史边界');
      if(!officialMode&&config.autoSend&&!config.selectors.sent)throw Error('自动发送前必须配置发送成功标记');
      monitors[targetId()]=establishBaseline(records,baseline,{video:config.video,target:targetId()});
      if(config.personalBrowserEnabled)monitors[targetId()].browserBinding=browserBinding.id;
      if(officialMode){monitors[targetId()].account=official.accountFingerprint();queue.cancelOtherSessions(official.accountFingerprint(),targetId(),monitors[targetId()].sessionId);}logger.write('monitor.baseline',{workId:targetId(),baselineCount:baseline.length,autoSend:config.autoSend,interval:config.interval});
      await persist();log(`仅回复新评论：已记录 ${baseline.length} 条现有评论，本次启动前的评论和未发送任务不补发`);
      running=true;timer=setTimeout(cycle,config.interval*1000);return {};
    }
    const r=records.find(x=>x.key===body.key);if(!r)throw Error('评论不存在');
    if(name==='draft'){if(!['new','draft','error'].includes(r.status))throw Error('该状态不能重新生成');await draft(r);return {};}
    if(name==='edit'){if(r.status!=='draft')throw Error('只能修改草稿');r.reply=String(body.reply||'').slice(0,200);r.reviewApproved=false;controls.audit('draft.edited',{key:r.key});await persist();return {};}
    if(name==='send'){if(r.source==='manual-import')throw Error('手动导入评论只能复制后自行发布，不能通过官方接口自动发送');if(r.simulated)throw Error('模拟评论不能发送到抖音');await send(r,()=>true,{manual:true});return {};}
    throw Error('未知操作');
  }finally{busy=false;}
}
function commentRouteGuard(){const status=official.status();if(!status.route)throw Error('未获普通或企业评论权限，请重新授权已批准的权限');}
const actionNames=new Set(["work-redact","work-export","preflight","service-backups","service-restore","service-status","service-policy","service-cleanup","conversation-control","review-personal","browser-outcome","browser-personal-enable","browser-personal-config","personal-mode","personal-work","personal-import","personal-generate","personal-edit","personal-copied","personal-published","broker-settings","official-refresh","queue-review-list","operations-status","queue-review","pipeline-config","backup-full","backup-verify","accounts-create","accounts-select","monitor-start","monitor-stop","monitor-status","reset-scan","queue-status","verify-pending","retry-task","diagnostics-export","diagnostics-status","models-discover","works","knowledge-list","history","history-detail","backup","media-cancel","stop","caption-save","media-delete","media-start","media-accept","media-unaccept","official-authorize","official-callback","official-disconnect","official-works","ocr","works-save","works-select","knowledge-save","knowledge-delete","runtime-test","connections-save","connections-select","connections-delete","connections-test","credentials","config","model-test","extract","ocr-accept","adapt-comments","reply-inspect","open-comments","browser-inspect","diagnose","verify","browser","connect","navigate","collect","sample","start","resume","draft","edit","send"]);
function requestOperation(req){if(req.method==='POST'&&req.url.startsWith('/api/media-upload?'))return 'media-upload';if(req.method==='GET'&&req.url.startsWith('/oauth/douyin/callback?'))return 'oauth-callback';if(req.method==='POST'&&req.url.startsWith('/api/')){const name=req.url.slice(5);return actionNames.has(name)?name:'unknown-action';}return null;}
const server=http.createServer((req,res)=>traceRun(requestOperation(req)||'http',async()=>{const operation=requestOperation(req),began=Date.now();let failure,failureDetails={};res.setHeader('X-Trace-Id',traceContext().traceId);if(operation)logger.write('operation.started',{operation,workId:targetId()});try{
  if(req.method==='GET'&&req.url==='/service.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(await readFile(path.join(uiRoot,'scripts/service.js')));}
  if(req.method==='GET'&&req.url==='/personal-browser.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(await readFile(path.join(uiRoot,'scripts/personal-browser.js')));}
  if(req.method==='GET'&&req.url==='/personal.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(await readFile(path.join(uiRoot,'scripts/personal.js')));}
  if(req.method==='GET'&&req.url==='/diagnostics.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(await readFile(path.join(uiRoot,'scripts/diagnostics.js')));}
  const host=req.headers.host;if(host!==`127.0.0.1:${port}`&&host!==`localhost:${port}`){res.writeHead(403);return res.end();}
  if(req.method==='POST'&&req.url.startsWith('/api/knowledge-import?')){
    if(req.headers['x-local-app']!=='douyin-reply'||(req.headers.origin&&!allowedOrigins.includes(req.headers.origin)))throw Error('非法请求来源');
    if(monitoring()||busy||pipelineBusy())throw Error('请先暂停监听并等待任务结束');busy=true;try{let total=0;const chunks=[];for await(const chunk of req){total+=chunk.length;if(total>20*1024*1024)throw Error('文档不能超过20MB');chunks.push(chunk);}const result=await importKnowledge(Buffer.concat(chunks),new URL(req.url,'http://localhost').searchParams.get('name'));res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(result));}finally{busy=false;}
  }
  if(req.method==='POST'&&req.url.startsWith('/api/media-upload?')){
    if(req.headers['x-local-app']!=='douyin-reply'||(req.headers.origin&&!allowedOrigins.includes(req.headers.origin)))throw Error('非法请求来源');
    if(monitoring()||busy)throw Error('请先暂停监听并等待当前操作结束');if(Number(req.headers['content-length'])>maxUpload)throw Error('单个素材不能超过512MB');
    busy=true;try{const u=new URL(req.url,'http://127.0.0.1'),id=u.searchParams.get('workId');const asset=await media.upload(id,u.searchParams.get('name'),req);
      if(workContents[id]?.media){workContents[id].media.accepted=false;await persist();}
      res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(asset));
    }finally{busy=false;}
  }
  if(req.method==='GET'&&req.url==='/multiwork.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(await readFile(path.join(uiRoot,'scripts/multiwork.js')));}
  if(req.method==='GET'&&req.url==='/operations.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(await readFile(path.join(uiRoot,'scripts/operations.js')));}
  if(req.method==='GET'&&req.url==='/reliability.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(await readFile(path.join(uiRoot,'scripts/reliability.js')));}
  if(req.method==='GET'&&req.url==='/media-ui.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(await readFile(path.join(uiRoot,'scripts/media-ui.js')));}
  if(req.method==='GET'&&req.url.startsWith('/oauth/douyin/callback?')){if(monitoring()||busy||pipelineBusy())throw Error('请先暂停监听再授权');busy=true;try{const url=new URL(req.url,'http://127.0.0.1');registerSecret(url.searchParams.get('code'));registerSecret(url.searchParams.get('state'));await official.accept({code:url.searchParams.get('code'),state:url.searchParams.get('state')});res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Cache-Control','no-store');return res.end('抖音官方授权完成，请返回 CommentPilot。');}finally{busy=false;}}
  if(req.method==='GET'&&req.url==='/official.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(await readFile(path.join(uiRoot,'scripts/official.js')));}
  if(req.method==='GET'&&req.url==='/api/health'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({app:'commentpilot',version:appVersion,instanceId:process.env.APP_INSTANCE_ID||''}));}
  if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(await readFile(path.join(uiRoot,'index.html')));}
  if(req.method==='GET'&&req.url==='/management.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(await readFile(path.join(uiRoot,'scripts/management.js')));}
  if(req.method==='GET'&&req.url==='/app.css'){res.setHeader('Content-Type','text/css; charset=utf-8');return res.end(await readFile(path.join(uiRoot,'app.css')));}
  if(req.method==='GET'&&req.url==='/projects.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(await readFile(path.join(uiRoot,'scripts/projects.js')));}
  if(req.method==='GET'&&req.url==='/api/state'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({brokerSettings:brokerSettings.status(),accounts:accounts.list(),multiMonitors:runtimeState(),anyMonitoring:monitoring(),queueStats:queue.stats(official.accountFingerprint(),targetId()),queueTasks:queue.summaries(official.accountFingerprint(),targetId()),scanStatus:monitors[targetId()]?.scanStatus||null,scanRetry:monitors[targetId()]?.scanRetry||null,mediaAssets:media.assets(targetId()||''),mediaJob:media.latest(targetId()||''),mediaActive:media.active?{workId:media.active.job.workId,phase:media.active.job.phase}:null,transport:transport(),official:official.status(),connections:storage.connections(),providerPresets,config,records:targetId()?storage.history({workId:targetId(),size:200}).records:[],recordsTotal:targetId()?storage.db.prepare('SELECT count(*) n FROM comments WHERE work_id=?').get(targetId()).n:0,logs,running,busy:busy||pipelineBusy(),pipeline:{scan:scheduler.inflight.size,generate:generators.inflight.size,send:deliveries.inflight.size,modelConcurrency:generators.concurrency},keyConfigured:!!apiKey,browserOpen:!!browser,browserUrl:page&&!page.isClosed()?page.url():null,confirmedWorkId:workId(boundUrl),diagnostics,modelCheck,workContent:currentContent(),contentStatus,ocrProgress,monitor:monitors[targetId()]||null,collectStats}));}
  if(req.method==='POST'&&req.url.startsWith('/api/')){
    if(req.headers['x-local-app']!=='douyin-reply'||(req.headers.origin&&!allowedOrigins.includes(req.headers.origin)))throw Error('非法请求来源');
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2000000)throw Error('请求过大');}let body;try{body=JSON.parse(raw||'{}');}catch{throw Error('Invalid JSON request');}const result=await action(req.url.slice(5),body);res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(result));}
  res.writeHead(404);res.end();
 }catch(e){failure=errorCode(e);failureDetails=errorMetadata(e);log(redactText(e.message));res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:redactText(e.message),errorCode:failure,traceId:traceContext().traceId}));}finally{if(operation)logger.write('operation.finished',{operation,workId:targetId(),outcome:res.statusCode>=400?'failed':'succeeded',httpStatus:res.statusCode,autoSend:config.autoSend,interval:config.interval,transport:transport(),durationMs:Date.now()-began,...failureDetails},res.statusCode>=400?'error':'info');}}));
server.on('error',error=>{
  if(error.code==='EADDRINUSE'){
    console.error(`${port} 端口已被占用。若工作台已经运行，请直接打开 http://127.0.0.1:${port}，无需重复启动。`);
    console.error('如需重启，请在原服务终端按 Ctrl+C 后再执行 npm start。');
  }else console.error(`启动失败：${error.message}`);
  process.exitCode=1;
});
server.listen(port,'127.0.0.1',()=>console.log(`本地管理页面：http://127.0.0.1:${port}`));
// Read only: after login the target page may finish loading without another click.

const maintenanceWatcher=setInterval(async()=>{if(!controls.policy().autoMaintenance||monitoring()||busy||pipelineBusy()||media.active||!controls.reserveMaintenance())return;busy=true;try{const backup=await fullBackup(storage);await controls.cleanup();controls.finishMaintenance('completed');controls.audit('maintenance.completed',{files:backup.files});log('自动维护完成：已完整备份并清理过期明细');}catch(error){controls.finishMaintenance('failed');logger.write('maintenance.failed',{outcome:'failed',...errorMetadata(error)});log('自动维护失败，请在设置中手动备份并检查磁盘空间');}finally{busy=false;}},60000);maintenanceWatcher.unref();
const contentWatcher=setInterval(async()=>{if(busy||monitoring()||!browser)return;selectWorkPage();if(!page||page.isClosed()||!sameWork(config.video,page.url()))return;busy=true;try{await syncWork();}catch(error){contentStatus=error.message;}finally{busy=false;}},5000);contentWatcher.unref();
let verificationCursor=0;
const verificationWatcher=setInterval(async()=>{if(!officialMode||busy||deliveries.busy||media.active)return;
  const ids=Object.keys(monitors).filter(id=>accounts.byFingerprint(monitors[id].account));
  for(let n=0;n<ids.length;n++){const index=(verificationCursor+n)%ids.length,id=ids[index];
    const official=accounts.byFingerprint(monitors[id].account);
    const verifier=new CommentWorker({queue,official,records:()=>records,target:()=>id,session:()=>monitors[id],reconcile:r=>reconcileRecord(r,id,official)});verifier.synchronize();
    if(!queue.verificationDue(official.accountFingerprint(),id))continue;verificationCursor=(index+1)%ids.length;busy=true;
    try{await logger.operation('reply.reconcile',()=>verifier.verify(),{workId:id});}catch(error){logger.write('reply.verify_failed',{...errorMetadata(error)},'error');}finally{busy=false;}break;
  }
},10000);verificationWatcher.unref();

async function startWorkMonitor(id,resume){
  const epoch=monitorStartEpoch;
  if(scheduler.active(id))throw Error('该作品已在监听');
  if(scheduler.jobs.size>=20)throw Error('第一版最多同时监听20个作品');
  const profile=storage.work(id);if(!profile)throw Error('作品不存在');
  const official=accounts.get(profile.accountSlot||selectedOfficial().slot);
  const connection=await storage.connection(profile.connectionId||config.connectionId);
  if(connection.auth!=='none'&&!connection.key)throw Error('该作品模型未配置 API Key');
  const cfg=validateConfig({...defaults,...profile,connectionId:connection.id,video:profile.url,model:connection.model,selectors:defaults.selectors});
  if(!official.status().route)throw Error('作品绑定账号未获评论权限');const w=await official.work(id);
  workContents[id]={...workContents[id],id,body:w.title,source:'抖音官方发布文案',extractedAt:new Date().toISOString()};
  groundingFor(cfg);
  if(resume){if(monitors[id]?.account!==official.accountFingerprint()||!monitors[id]?.sessionId)throw Error('无可恢复的当前账号会话，请启动新监听');}
  else {const baseline=await official.preview(id);monitors[id]=establishBaseline(records,baseline,{video:cfg.video,target:id});monitors[id].account=official.accountFingerprint();queue.cancelOtherSessions(official.accountFingerprint(),id,monitors[id].sessionId);}
  const rt={id,title:profile.title,official,config:structuredClone(cfg),error:''};
  rt.worker=new CommentWorker({queue,official,maxSteps:1,records:()=>records,target:()=>id,session:()=>monitors[id],config:()=>rt.config,running:()=>scheduler.active(id),draft:r=>draft(r,rt.config),send:(r,guard)=>sendOfficial(r,guard,rt),reconcile:r=>reconcileRecord(r,id,official),logger,stop:()=>{rt.error='任务已阻塞，请查看评论错误和队列后处理';stopWork(id);}});
  runtimes.set(id,rt);await persist();
  if(epoch!==monitorStartEpoch)throw Error('启动已取消，作品保持暂停');
  scheduler.add(id,()=>runWorkTurn(rt),cfg.interval*1000);
  generators.add(id,()=>runTaskTurn(rt,'generate'),250);
  deliveries.add(id,()=>runTaskTurn(rt,'send'),1000);return {workId:id};
}
async function runWorkTurn(rt){
  const official=rt.official;
  if(busy||running||!scheduler.active(rt.id))return;
  try{await logger.operation('monitor.cycle',async()=>{
    const session=monitors[rt.id];if(session.account!==official.accountFingerprint())throw Error('授权账号变化，请重新建立基线');
    if(!session.scanRetry?.nextAt||session.scanRetry.nextAt<=Date.now()){
      try{const scan=await official.scan(rt.id,session.scan);if(!scheduler.active(rt.id))return;
        const since=Date.parse(session.since),fresh=scan.comments.filter(c=>!Number.isFinite(Date.parse(c.publishedAt))||Date.parse(c.publishedAt)>=since);
        ingestComments(records,fresh,{video:rt.config.video,target:rt.id,ownName:rt.config.ownName,session});
        session.scan=scan.checkpoint;session.scanStatus={pagesRead:scan.pages,complete:scan.complete,historySkipped:scan.comments.length-fresh.length};session.scanRetry=null;rt.lastCheckedAt=new Date().toISOString();await persist();
      }catch(error){const attempts=(session.scanRetry?.attempts||0)+1;if(!retryable(error)||attempts>=5)throw error;session.scanRetry={attempts,nextAt:Math.max(Date.now()+retryDelay(attempts),official.cooldown||0),errorCode:errorCode(error)};await persist();}
    }
    if(scheduler.active(rt.id))rt.worker.synchronize();
  },{workId:rt.id});}
  catch(error){rt.error=redactText(error.message);stopWork(rt.id);logger.write('monitor.failed',{workId:rt.id,...errorMetadata(error)},'error');}
}
const localModels=new Set();
async function runTaskTurn(rt,stage){if(busy||running||!scheduler.active(rt.id))return;const c=storage.connections().find(c=>c.id===rt.config.connectionId),local=stage==='generate'&&['ollama','lmstudio','vllm'].includes(c?.provider)?c.baseUrl:null;if(local&&localModels.has(local))return;if(local)localModels.add(local);try{await logger.operation('queue.'+stage,()=>rt.worker.process(stage),{workId:rt.id});}catch(error){rt.error=redactText(error.message);stopWork(rt.id);logger.write('queue.failed',{workId:rt.id,...errorMetadata(error)},'error');}finally{if(local)localModels.delete(local);}}
const multiWatcher=setInterval(()=>{if(busy||running||media.active)return;for(const pool of [scheduler,generators,deliveries])void pool.tick().catch(error=>logger.write('monitor.failed',errorMetadata(error),'error'));},250);multiWatcher.unref();
storage.db.exec('CREATE TABLE IF NOT EXISTS broker_event_cursors(slot TEXT PRIMARY KEY,seq INTEGER NOT NULL);');
let eventsBusy=false;
const eventWatcher=setInterval(async()=>{if(eventsBusy||busy)return;eventsBusy=true;try{
  for(const client of accounts.clients.values()){
    if(!client.events||![...runtimes.values()].some(rt=>rt.official===client&&scheduler.active(rt.id)))continue;
    const cursor=storage.db.prepare('SELECT seq FROM broker_event_cursors WHERE slot=?').get(client.slot)?.seq||0;
    const events=await client.events(cursor);if(!events.length)continue;
    for(const rt of runtimes.values())if(rt.official===client){const job=scheduler.jobs.get(rt.id);if(job)job.nextAt=Math.min(job.nextAt,Date.now());}
    storage.db.prepare('INSERT OR REPLACE INTO broker_event_cursors VALUES(?,?)').run(client.slot,events.at(-1).id);
  }
}catch(error){logger.write('events.failed',errorMetadata(error),'error');}finally{eventsBusy=false;}},10000);eventWatcher.unref();

async function shutdown(){clearInterval(maintenanceWatcher);clearInterval(eventWatcher);clearInterval(multiWatcher);stopAllWorks();clearInterval(verificationWatcher);logger.write('process.stopping');media.cancel();if(media.active)await media.active.completion;running=false;clearTimeout(timer);clearInterval(contentWatcher);while(pipelineBusy())await new Promise(resolve=>setTimeout(resolve,100));try{if(browser)await browser.close();await persist();}finally{server.close();process.exit(0);}}
process.on('message',message=>{if(message?.type==='shutdown')void shutdown();});
