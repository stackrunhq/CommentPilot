const browserPersonalPanel=document.createElement('div');browserPersonalPanel.className='panel';browserPersonalPanel.id='browserPersonalPanel';
browserPersonalPanel.innerHTML='<h2>个人浏览器自动回复</h2><p>扫码登录后，通过浏览器读取当前作品的新评论、生成并发送回复，无需复制粘贴。该方式不是官方接口授权，可能受平台规则、验证和页面变化影响；出现验证或发送不明会暂停。</p><button type="button" id="enablePersonalBrowser">启用浏览器自动模式</button><button type="button" id="disablePersonalBrowser" class="secondary">关闭浏览器模式</button><div class="project-grid"><div><label>当前登录账号的准确昵称</label><input id="browserOwnName" maxlength="100"><label>检查间隔（秒）</label><input id="browserInterval" type="number" min="10" value="10"><label>每日发送上限（1～200）</label><input id="browserDailyLimit" type="number" min="1" max="200" value="20"><label>回复方式</label><select id="browserReplyMode"><option value="auto">生成后自动发送</option><option value="draft">只生成草稿</option></select><button type="button" id="saveBrowserPersonalConfig">保存自动设置</button></div><div><p>先保存上方作品与资料，再启用此模式、保存账号设置、打开浏览器扫码登录。核对浏览器中是自己的账号和目标作品，展开评论区后确认。</p><button type="button" id="launchPersonalBrowser">打开登录浏览器</button><label><input id="confirmPersonalBrowserOwner" type="checkbox">我已确认登录的是本人账号，当前作品属于自己</label><button type="button" id="verifyPersonalBrowser">确认账号和当前作品</button><button type="button" id="collectPersonalBrowser" class="secondary">读取评论</button><button type="button" id="startPersonalBrowser">启动监听回复</button><button type="button" id="stopPersonalBrowser" class="danger">暂停</button><p id="personalBrowserStatus"></p><p class="small">启动时已有评论跳过，只处理起点之后能确认发布时间的新评论；本版一次监听一个浏览器作品。重新打开浏览器或重新确认账号后需建立新起点，不自动补发旧任务。</p></div></div><div id="personalBrowserRecords"></div>';
personalView.querySelector('p').after(browserPersonalPanel);
personalView.querySelector('p').textContent='个人模式可选择浏览器自动回复，也可继续手动导入、复制发布。浏览器方式不需要开放平台应用，但不等于取得了官方接口授权。';
async function personalBrowserPost(action,body={}){if(!['stop','browser-personal-enable'].includes(action))ensurePersonalWork();const r=await post(action,body);await refresh();return r;}
$('enablePersonalBrowser').onclick=()=>run(()=>personalBrowserPost('browser-personal-enable',{enabled:true}));
$('disablePersonalBrowser').onclick=()=>run(()=>personalBrowserPost('browser-personal-enable',{enabled:false}));
$('saveBrowserPersonalConfig').onclick=()=>run(async()=>{await personalBrowserPost('browser-personal-config',{ownName:$('browserOwnName').value,interval:Number($('browserInterval').value),dailyLimit:Number($('browserDailyLimit').value),autoSend:$('browserReplyMode').value==='auto'});message('浏览器自动设置已保存。');});
$('launchPersonalBrowser').onclick=()=>run(()=>personalBrowserPost('browser'));
$('verifyPersonalBrowser').onclick=()=>run(async()=>{if(!$('confirmPersonalBrowserOwner').checked)throw Error('请先核对并勾选本人账号及作品归属');await personalBrowserPost('verify',{confirmed:true});message('已确认当前浏览器和作品，请启动监听。');});
$('collectPersonalBrowser').onclick=()=>run(()=>personalBrowserPost('collect'));
$('startPersonalBrowser').onclick=()=>run(async()=>{await personalBrowserPost('start');message('已建立新评论起点，启动前的评论不会补发。');});
$('stopPersonalBrowser').onclick=()=>run(()=>personalBrowserPost('stop'));
let browserPersonalFormLoaded=false,lastPersonalBrowserWork=null;
const refreshBeforeBrowserPersonal=refresh;refresh=async function(...args){await refreshBeforeBrowserPersonal(...args);const enabled=state.transport==='personal-browser',id=displayedWorkId(state.config.video);
  if(!browserPersonalFormLoaded||lastPersonalBrowserWork!==id){browserPersonalFormLoaded=true;lastPersonalBrowserWork=id;$('browserOwnName').value=state.config.ownName||'';$('browserInterval').value=state.config.interval||10;$('browserDailyLimit').value=state.config.dailyLimit||20;$('browserReplyMode').value=state.config.autoSend?'auto':'draft';$('confirmPersonalBrowserOwner').checked=false;}
  $('enablePersonalBrowser').disabled=enabled||state.anyMonitoring||state.busy;$('disablePersonalBrowser').disabled=!enabled||state.anyMonitoring||state.busy;
  for(const name of ['saveBrowserPersonalConfig','launchPersonalBrowser','verifyPersonalBrowser','collectPersonalBrowser','startPersonalBrowser'])$(name).disabled=!enabled||state.busy||state.anyMonitoring;
  $('stopPersonalBrowser').disabled=!state.anyMonitoring;
  $('personalBrowserStatus').textContent=!enabled?'尚未启用浏览器模式。':state.running?'正在监听 · '+(state.config.autoSend?'自动发送':'仅草稿')+' · '+state.config.interval+'秒检查':state.busy?'正在处理，请等待':'已暂停 · 浏览器'+(state.browserOpen?'已打开':'未打开')+' · 已确认作品 '+(state.confirmedWorkId||'无');
  if($('personalBrowserRecords').querySelector('textarea:focus'))return;$('personalBrowserRecords').replaceChildren();
  for(const r of state.records.filter(r=>!r.simulated&&r.source!=='manual-import'&&r.source!=='douyin-official').slice(0,100)){const row=document.createElement('div');row.className='entity-card';const p=document.createElement('p');p.textContent=r.author+'：'+r.text;const detail=document.createElement('p');detail.className='small';detail.textContent=(names[r.status]||r.status)+(r.lastError?' · '+r.lastError:'');row.append(p,detail);if(r.reply){const reply=document.createElement('textarea');reply.readOnly=true;reply.value=r.reply;row.append(reply);if(r.status==='draft'){const sendButton=button('发送此草稿',async()=>{await personalBrowserPost('send',{key:r.key});});sendButton.disabled=!enabled||state.busy||state.anyMonitoring;row.append(sendButton);}}$('personalBrowserRecords').append(row);}
};
run(()=>refresh());

// Keep existing controls and handlers, present one primary setup flow.
personalNav.textContent='自动回复';
personalView.querySelector('h2').textContent='自动回复工作台';
personalView.querySelector('p').textContent='选择作品 → 准备回复资料 → 登录账号 → 启动。首次配置后，下次可直接选择已保存作品。';
const setupFlow=document.createElement('div');setupFlow.className='setup-flow';
const setupOverview=document.createElement('div');setupOverview.className='setup-overview';setupOverview.setAttribute('aria-live','polite');
personalView.querySelector('p').after(setupOverview,setupFlow);
function setupStep(title,description){const section=document.createElement('section');section.className='setup-step';const heading=document.createElement('h3');heading.textContent=title;const hint=document.createElement('p');hint.className='small';hint.textContent=description;section.append(heading,hint);setupFlow.append(section);return section;}
const workStep=setupStep('1. 选择作品与回复资料','必填项已标注。作品资料与知识库至少准备一项，模型才有依据回复。');
workStep.append($('personalWorkForm'));$('personalWorkForm').querySelector('h3').remove();
function markField(id,text,required=false){const field=$(id),label=field.previousElementSibling;label.textContent=text+' ';const tag=document.createElement('span');tag.className=required?'field-required':'field-optional';tag.textContent=required?'必填':'选填';label.append(tag);label.htmlFor=id;field.setAttribute('aria-required',String(required));}
markField('personalWorkSelect','已保存作品');markField('personalTitle','作品名称',true);markField('personalUrl','抖音作品完整链接',true);markField('personalModel','回复模型',true);markField('personalKnowledge','关联知识库');markField('personalContext','作品文案 / 已确认事实');
$('personalContext').rows=4;
const modelLink=button('配置模型连接',async()=>{nav.querySelector('[data-view="models"]').click();});$('personalModel').after(modelLink);
const accountStep=setupStep('2. 登录并确认账号','使用程序打开的浏览器扫码登录，然后核对本人账号、目标作品和评论区。');
const replyStep=setupStep('3. 启动自动回复','启动前已有评论跳过；只处理启动后确认发布的新评论。遇到验证或发送结果不明会暂停。');
for(const id of ['enablePersonalBrowser','disablePersonalBrowser'])accountStep.append($(id));
for(const id of ['browserOwnName']){const input=$(id);accountStep.append(input.previousElementSibling,input);}
markField('browserOwnName','登录账号的准确昵称',true);
for(const id of ['launchPersonalBrowser','confirmPersonalBrowserOwner','verifyPersonalBrowser'])accountStep.append(id==='confirmPersonalBrowserOwner'?$(id).closest('label'):$(id));
const policy=document.createElement('div');policy.className='reply-policy';replyStep.append(policy);
for(const id of ['browserReplyMode','browserDailyLimit']){const input=$(id);const field=document.createElement('div');field.append(input.previousElementSibling,input);policy.append(field);}
markField('browserReplyMode','回复方式',true);markField('browserDailyLimit','每日发送上限',true);
const advancedBrowser=document.createElement('details');advancedBrowser.innerHTML='<summary>高级设置 · 检查频率与手动读取</summary>';
advancedBrowser.append($('browserInterval').previousElementSibling,$('browserInterval'),$('collectPersonalBrowser'));replyStep.append(advancedBrowser);
replyStep.append($('saveBrowserPersonalConfig'),$('startPersonalBrowser'),$('stopPersonalBrowser'),$('personalBrowserStatus'));
const results=document.createElement('section');results.className='setup-results';results.innerHTML='<h3>评论与回复</h3><p class="small">这里展示当前作品的浏览器处理记录。完整记录可在“历史记录”中查询。</p>';results.append($('personalBrowserRecords'));personalView.append(results);
const manualFallback=document.createElement('details');manualFallback.className='manual-fallback';manualFallback.innerHTML='<summary>手动处理评论（备用方式）</summary>';
const manualGrid=personalView.querySelector(':scope > .project-grid');manualFallback.append(manualGrid,$('personalRecords'));personalView.append(manualFallback);
const browserNotice=document.createElement('details');browserNotice.innerHTML='<summary>使用范围与平台说明</summary><p class="small">浏览器方式不代表官方接口授权，可能受平台规则、验证和页面变化影响。目前一次监听一个作品；高评论量下不保证全部读取。程序不会绕过验证码。重新登录或确认账号后需要重新启动监听。</p>';personalView.append(browserNotice);browserPersonalPanel.remove();
$('personalWorkForm').addEventListener('input',()=>{setupOverview.textContent='作品资料有未保存的修改，请先保存。';});
const refreshBeforeSetupFlow=refresh;refresh=async function(...args){await refreshBeforeSetupFlow(...args);const connection=state.connections.find(c=>c.id===$('personalModel').value),modelReady=!!connection&&(connection.auth==='none'||connection.keyConfigured);const pending=[];if(!personalWorkSaved)pending.push('保存作品');if(!personalContext.value.trim()&&!personalKnowledge.value&&!state.workContent?.body)pending.push('补充作品资料或知识库');if(!modelReady)pending.push('配置模型');if(state.transport!=='personal-browser')pending.push('启用浏览器模式');if(!state.config.ownName)pending.push('保存账号昵称');if(!state.browserOpen||!state.confirmedWorkId)pending.push('登录并确认作品');setupOverview.textContent=state.running?'正在监听 · '+(state.config.autoSend?'自动发送回复':'仅生成草稿'):pending.length?'待完成：'+pending.join(' → '):'准备就绪，请保存回复设置后启动监听。';setupOverview.dataset.ready=String(!pending.length);$('personalReadiness').textContent=!modelReady?'当前模型不可用：请先配置模型 Key 或连接本地模型。':personalWorkSaved?'作品已保存。可继续登录与启动；云模型将接收评论和所选资料。':'请保存当前作品与资料。';if(!$('personalBrowserRecords').children.length)$('personalBrowserRecords').textContent='暂无浏览器评论记录。完成配置并启动后，让其他账号发表一条新评论进行测试。';};
run(()=>refresh());
