const reliabilityPanel=document.createElement('div');reliabilityPanel.className='panel wide-panel';reliabilityPanel.id='reliabilityPanel';
reliabilityPanel.innerHTML='<h2>监听进度与任务恢复</h2><p id="scanSummary" class="small"></p><p id="queueSummary"></p><p class="small">任务保存在本机。重启后点击“继续上次监听”恢复本次会话；点击“启动监听”会建立新起点并取消旧会话未发送任务。发送结果不明只做查询核验，未查到不会自动重发。</p><button type="button" id="verifyPending" class="secondary">核验未确认回复</button><button type="button" id="resetScan" class="secondary">重置扫描进度（保留监听起点）</button><div id="queueList"></div>';
$('comments').closest('.panel').before(reliabilityPanel);
names.uncertain='结果不明，请查看核验任务';
const beforeReliabilityRefresh=refresh;refresh=async function(...args){await beforeReliabilityRefresh(...args);reliabilityPanel.hidden=state.transport!=='official';if(state.transport!=='official')return;
  const scan=state.scanStatus;$('scanSummary').textContent=scan?`本轮读取${scan.pagesRead}页 · ${scan.complete?'本次历史巡检已完成，下轮重新检查首页':'后续页将在下一轮继续扫描'} · 本轮略过历史评论${scan.historySkipped}条`:'尚未开始扫描；启动时仅预览首页，其他历史评论依据发布时间跳过。';
  if(state.scanRetry?.nextAt)$('scanSummary').textContent+=' · 读取重试时间：'+new Date(state.scanRetry.nextAt).toLocaleTimeString();
  const labels={ready:'待处理',running:'处理中',retry_wait:'等待重试',review:'待人工确认',blocked:'已阻塞',done:'已完成',cancelled:'已取消'},stages={generate:'生成回复',send:'发送前检查',verify:'只读核验'};
  $('queueSummary').textContent=(state.queueStats||[]).map(s=>(labels[s.status]||s.status)+' '+s.count).join(' · ')||'尚无任务';
  $('verifyPending').disabled=state.running||state.busy||!state.official?.authorized;$('resetScan').disabled=state.running||state.busy||!state.monitor;
  $('queueList').replaceChildren();for(const t of (state.queueTasks||[]).filter(t=>!['done','cancelled'].includes(t.status))){const row=document.createElement('div');row.className='entity-card';const info=document.createElement('p');info.className='small';info.textContent=`${stages[t.stage]} · ${labels[t.status]} · 已尝试${t.attempts}次${t.status==='retry_wait'?' · 下次 '+new Date(t.nextAt).toLocaleTimeString():''}`;row.append(info);if(t.stage==='generate'&&t.status==='blocked')row.append(button('重新安排生成',async()=>{await post('retry-task',{id:t.id});await refresh();message('已重新安排，继续监听后执行。');}));$('queueList').append(row);}
};
$('verifyPending').onclick=()=>run(async()=>{await post('verify-pending');await refresh();message('已执行只读核验；如仍未确认，将保留结果不明状态，不会重发。');});
$('resetScan').onclick=()=>run(async()=>{await post('reset-scan');await refresh();message('已重置分页进度，监听起点保持不变；点击继续上次监听恢复。');});
run(()=>refresh());
