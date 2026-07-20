// ── 会话管理 ──
let sessions=[{id:'s1',name:'会话 1',messages:[],testCases:[],modelKey:null,draftModelKey:null}],activeSessionId='s1';
function loadSessions(){try{const s=localStorage.getItem(STORE_KEY);if(s){const d=JSON.parse(s);if(d.length){sessions=d;const aid=localStorage.getItem('tcgen_active_sid');if(aid&&sessions.find(s=>s.id===aid))activeSessionId=aid;else activeSessionId=sessions[0].id;}}}catch(e){console.error('loadSessions:',e);}}
function saveSessions(){localStorage.setItem(STORE_KEY,JSON.stringify(sessions));localStorage.setItem('tcgen_active_sid',activeSessionId);}
function getSession(){return sessions.find(s=>s.id===activeSessionId)||sessions[0];}
function updateModelLockUI(){
  const s=getSession(),sel=document.getElementById('modelSelect'),hint=document.getElementById('modelLockHint');
  if(!sel||!hint)return;
  const locked=!!(s&&s.modelKey),key=locked?s.modelKey:getActiveModel();
  sel.disabled=locked;
  if(locked){
    const label=(MODEL_PRESETS[key]||MODEL_PRESETS.dp).label;
    const message='本会话已绑定 '+label+'，如需切换模型，请新建会话。';
    hint.textContent='🔒 '+message;hint.style.display='block';sel.title=message;
  }else{
    hint.textContent='';hint.style.display='none';sel.title='选择当前会话使用的模型';
  }
}
function lockSessionModel(session,modelKey){
  if(!session||session.modelKey)return;
  session.modelKey=modelKey;delete session.draftModelKey;saveSessions();
  if(session.id===activeSessionId)applyConfig();
}
function autoRenameSession(thinking, sid){
  if(!thinking||!thinking.trim())return;
  const cfg=loadConfig(),am=getActiveModel(),m=cfg[am]||cfg.dp;
  const ak=m.apiKey||'',bu=m.baseUrl||'',md=m.model||'';
  if(!ak)return;
  fetch('/api/summarize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:ak,base_url:bu,model:md,thinking})})
    .then(r=>r.json())
    .then(d=>{
      if(!d.title)return;
      const s=sessions.find(s=>s.id===sid);if(!s)return;
      const name=d.title.trim();if(!name||s.name===name)return;
      s.name=name;saveSessions();renderSessionTabs();
    })
    .catch(e=>console.error('autoRenameSession:',e));
}
function switchSession(sid, force){
  // 同会话不处理（除非强制刷新）
  if(!force && sid===activeSessionId)return;
  if(!force && currentStreamAbort){toast('请等待生成完成或手动停止后再切换会话','error');return;}
  // 保存当前会话的流式区域内容（非空才存，避免初始化时覆盖已保存数据）
  const cur=getSession();if(cur){const h=document.getElementById('streamArea').innerHTML.trim();if(h)cur._streamHTML=h;}
  activeSessionId=sid;const s=getSession();saveSessions();
  document.querySelectorAll('.session-tab').forEach(t=>t.classList.toggle('active',t.dataset.sid===sid));
  // 恢复目标会话的流式内容
  const sa=document.getElementById('streamArea');
  sa.innerHTML=s&&s._streamHTML?s._streamHTML:'';
  sa.style.display=(s&&s._streamHTML)?'':'none';
  document.getElementById('rpTree').innerHTML='<div class="rp-empty">生成用例后自动展示</div>';
  document.getElementById('rpStats').textContent='暂无数据';
  document.getElementById('rpDetailSection').style.display='none';
  if(s.testCases.length){
    hideEmpty();document.getElementById('resultCard').style.display='flex';
    renderTable(s.testCases);renderStats(s.testCases,null);
  }else{
    hideResult();showEmpty();
    if(s.messages.length)document.getElementById('emptyState').querySelector('.sub').textContent='此会话有 '+s.messages.length+' 条对话记录，但无测试用例';
  }
  applyConfig();
}
function addSession(){
  if(currentStreamAbort){toast('请等待生成完成或手动停止后再新增会话','error');return;}
  const id='s'+Date.now(),n='会话 '+(sessions.length+1),draftModelKey=getActiveModel();
  sessions.push({id,name:n,messages:[],testCases:[],modelKey:null,draftModelKey});
  saveSessions();renderSessionTabs();switchSession(id);
}
function renameSession(sid,name){
  const s=sessions.find(s=>s.id===sid);if(s){s.name=name;saveSessions();renderSessionTabs();}
}
function closeSession(sid){
  if(sessions.length<=1)return;
  const cur=getSession();if(cur)cur._streamHTML=document.getElementById('streamArea').innerHTML;
  sessions=sessions.filter(s=>s.id!==sid);
  if(activeSessionId===sid)activeSessionId=sessions[0].id;
  saveSessions();renderSessionTabs();switchSession(activeSessionId, true);
}
function renderSessionTabs(){
  const bar=document.getElementById('sessionTabs');
  bar.innerHTML=sessions.map(s=>{
    const full=s.name||'',display=full.length>14?full.substring(0,13)+'…':full;
    return `<div class="session-tab${s.id===activeSessionId?' active':''}" data-sid="${s.id}" onclick="switchSession('${s.id}')" ondblclick="renameSession('${s.id}',prompt('新名称:','${s.name}')||'${s.name}')" title="${escHtml(full)}">${escHtml(display)}${sessions.length>1?`<span class="close-btn" onclick="event.stopPropagation();closeSession('${s.id}')">×</span>`:''}</div>`;
  }).join('')+'<div class="add-tab" onclick="addSession()" title="新建会话">＋</div>';
}

