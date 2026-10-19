const multiPanel=document.createElement('div');multiPanel.className='panel wide-panel';multiPanel.id='multiworkPanel';
multiPanel.innerHTML='<h2>多作品后台监听</h2><p class="small">先在作品管理中为每个作品保存模型、知识库及自动发送设置。各作品独立建立新评论起点，轮流扫描和处理；模型并发1，发送间隔至少3秒。评论积压会保留，不会静默丢弃。暂停全部后可修改配置或切换工作台作品。</p><div id="multiworkList"></div><button type="button" id="multiStop" class="secondary">暂停全部作品</button>';
reliabilityPanel.before(multiPanel);
let multiWorks=[],multiLoadedAt=0;
const refreshBeforeMulti=refresh;
refresh=async function(...args){await refreshBeforeMulti(...args);multiPanel.hidden=state.transport!=='official';if(multiPanel.hidden)return;
  if(state.anyMonitoring&&!state.running)$('status').textContent=`多作品监听中（${state.multiMonitors.filter(r=>r.running).length}个）`;
  if(Date.now()-multiLoadedAt>5000){multiWorks=(await post('works')).works;multiLoadedAt=Date.now();}
  $('multiworkList').replaceChildren();
  for(const w of multiWorks){const rt=(state.multiMonitors||[]).find(r=>r.workId===w.id),row=document.createElement('div');row.className='entity-card';const title=document.createElement('strong');title.textContent=w.title;row.append(title);
    const p=document.createElement('p');p.className='small';p.textContent=(rt?.running?'监听中':'已暂停')+' · '+(w.autoSend?'自动发送':'仅生成草稿')+(rt?` · 积压${rt.backlog.count}条 · 最久等待${rt.backlog.oldestAgeSeconds}秒`:'')+(rt?.error?' · '+rt.error:'');row.append(p);
    if(rt?.backlog.count>=100||rt?.backlog.oldestAgeSeconds>=300){const warn=document.createElement('p');warn.textContent='处理速度低于评论增长速度，请关注积压；轮询无法保证每条评论实时发现。';row.append(warn);}
    const b=button(rt?.running?'暂停该作品':'启动新监听',async()=>{await post(rt?.running?'monitor-stop':'monitor-start',{id:w.id});await refresh();});b.disabled=state.busy||state.running||!state.official?.authorized;row.append(b);
    if(!rt?.running){const resume=button('继续上次监听',async()=>{await post('monitor-start',{id:w.id,resume:true});await refresh();});resume.disabled=b.disabled;row.append(resume);}
    $('multiworkList').append(row);
  }
  $('multiStop').disabled=!state.anyMonitoring&&!state.busy;
};
$('multiStop').onclick=()=>run(async()=>{await post('stop');await refresh();message('已暂停全部作品，已提交的请求仍可能完成。');});
run(()=>refresh());
