// ── 配置 ──
const CFG_KEY='tcgen_config',PROMPT_STORE_KEY='tcgen_prompts',STORE_KEY='tcgen_sessions';
let allPrompts=[],modalMode='add',editingPromptId=null;

function loadConfig(){try{return JSON.parse(localStorage.getItem(CFG_KEY))||{};}catch(e){console.error('loadConfig:',e);return{};}}
function applyConfig(){
  const c=loadConfig();
  document.getElementById('baseUrl').value=c.baseUrl||'https://api.deepseek.com/anthropic';
  document.getElementById('model').value=c.model||'deepseek-v4-pro[1M]';
  document.getElementById('apiKey').value=c.apiKey||'';
  document.getElementById('toolbarModel').textContent=c.model||'deepseek-v4-pro[1M]';
  refreshPromptSelect();
}
function saveConfig(){
  const c=loadConfig();
  c.baseUrl=document.getElementById('baseUrl').value.trim();
  c.model=document.getElementById('model').value.trim();
  c.apiKey=document.getElementById('apiKey').value.trim();
  localStorage.setItem(CFG_KEY,JSON.stringify(c));applyConfig();toast('配置已保存');
}

// ── 主题 ──
function toggleTheme(){
  const h=document.documentElement,n=h.getAttribute('data-theme')==='light'?'dark':'light';
  h.setAttribute('data-theme',n);document.getElementById('themeToggle').textContent=n==='light'?'☾':'☀';
  localStorage.setItem('tcgen_theme',n);
}
(function(){const s=localStorage.getItem('tcgen_theme')||'light';document.documentElement.setAttribute('data-theme',s);document.getElementById('themeToggle').textContent=s==='light'?'☾':'☀';})();

function toggleSection(h){h.classList.toggle('collapsed');h.nextElementSibling.classList.toggle('collapsed');}
function toast(m,t){const e=document.createElement('div');e.className='toast-item '+(t||'');e.textContent=m;document.getElementById('toastWrap').appendChild(e);setTimeout(()=>{e.style.opacity='0';e.style.transition='opacity .3s';},2200);setTimeout(()=>e.remove(),2600);}

// ── 提示词 ──
async function fetchPrompts(){
  try{
    const r=await fetch('/api/prompts');const d=await r.json();
    allPrompts=d.prompts||[];
  }catch(e){
    console.error('fetchPrompts:',e);
    if(!allPrompts.length)allPrompts=[{id:'comprehensive',name:'默认',system:'',user:'请根据以下 PRD 文档，生成测试用例：\n\n{prd_text}'}];
  }
}
async function syncPrompts(){try{await fetch('/api/prompts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompts:allPrompts})});}catch(e){console.error('syncPrompts:',e);toast('同步失败','error');}}
function getActivePromptId(){
  const c=loadConfig();
  const id=c.activePrompt||'comprehensive';
  // 如果保存的 id 不在提示词列表中，回退到第一个
  if(allPrompts.length&&!allPrompts.find(p=>p.id===id)){
    c.activePrompt=allPrompts[0].id;localStorage.setItem(CFG_KEY,JSON.stringify(c));
    return allPrompts[0].id;
  }
  return id;
}
function getActivePrompt(){const id=getActivePromptId();return allPrompts.find(p=>p.id===id)||allPrompts[0]||null;}
function refreshPromptSelect(){
  if(!allPrompts.length)return;
  const aid=getActivePromptId(),sel=document.getElementById('promptSelect');
  sel.innerHTML=allPrompts.map(p=>`<option value="${p.id}" ${p.id===aid?'selected':''}>${escHtml(p.name)}</option>`).join('');
  const a=getActivePrompt();if(a)document.getElementById('toolbarPrompt').textContent=a.name;
}
function onPromptSelect(){const c=loadConfig();c.activePrompt=document.getElementById('promptSelect').value;localStorage.setItem(CFG_KEY,JSON.stringify(c));document.getElementById('toolbarPrompt').textContent=getActivePrompt().name;}
function viewPrompt(){openPromptModal('view');}
function editPrompt(){openPromptModal('edit');}
function addPrompt(){openPromptModal('add');}
function openPromptModal(mode){
  modalMode=mode;const p=mode==='add'?{id:null,name:'',system:'',user:'请根据以下 PRD 文档，生成完整的测试用例：\n\n{prd_text}'}:getActivePrompt();
  editingPromptId=mode==='add'?null:p.id;const ro=mode==='view';
  document.getElementById('modalTitle').textContent={view:'查看提示词',edit:'编辑提示词',add:'新增提示词'}[mode];
  document.getElementById('editName').value=p.name;document.getElementById('editName').disabled=ro;
  document.getElementById('editSystem').value=p.system;document.getElementById('editSystem').disabled=ro;
  document.getElementById('editUser').value=p.user;document.getElementById('editUser').disabled=ro;
  document.getElementById('modalDeleteBtn').style.display=mode==='edit'?'':'none';
  document.querySelector('#promptModal .btn-primary').style.display=ro?'none':'';
  document.getElementById('promptModal').style.display='';
}
function closeModal(){document.getElementById('promptModal').style.display='none';document.getElementById('editName').disabled=false;document.getElementById('editSystem').disabled=false;document.getElementById('editUser').disabled=false;document.getElementById('modalDeleteBtn').style.display='none';document.querySelector('#promptModal .btn-primary').style.display='';}
async function savePrompt(){
  const name=document.getElementById('editName').value.trim(),system=document.getElementById('editSystem').value.trim();
  let user=document.getElementById('editUser').value.trim();
  if(!name){toast('请输入名称','error');return;}if(!system){toast('请输入 System Prompt','error');return;}
  if(!user)user='请根据以下 PRD 文档，生成完整的测试用例：\n\n{prd_text}';
  if(modalMode==='add'){const id='custom_'+Date.now();allPrompts.push({id,name,system,user});const c=loadConfig();c.activePrompt=id;localStorage.setItem(CFG_KEY,JSON.stringify(c));}
  else{const i=allPrompts.findIndex(p=>p.id===editingPromptId);if(i>=0)allPrompts[i]={...allPrompts[i],name,system,user};}
  await syncPrompts();refreshPromptSelect();closeModal();toast(modalMode==='add'?'已创建':'已保存');
}
async function deletePrompt(){
  if(allPrompts.length<=1){toast('至少保留一个','error');return;}const p=getActivePrompt();if(!confirm('删除「'+p.name+'」？'))return;
  allPrompts=allPrompts.filter(pr=>pr.id!==p.id);const c=loadConfig();c.activePrompt=allPrompts[0].id;localStorage.setItem(CFG_KEY,JSON.stringify(c));
  await syncPrompts();refreshPromptSelect();toast('已删除');
}
async function deleteCurrentPrompt(){
  if(allPrompts.length<=1){toast('至少保留一个','error');return;}if(!confirm('删除此提示词？'))return;
  allPrompts=allPrompts.filter(p=>p.id!==editingPromptId);const c=loadConfig();c.activePrompt=allPrompts[0].id;localStorage.setItem(CFG_KEY,JSON.stringify(c));
  await syncPrompts();refreshPromptSelect();closeModal();toast('已删除');
}

// ── 会话管理 ──
let sessions=[{id:'s1',name:'会话 1',messages:[],testCases:[]}],activeSessionId='s1';
function loadSessions(){try{const s=localStorage.getItem(STORE_KEY);if(s){const d=JSON.parse(s);if(d.length){sessions=d;const aid=localStorage.getItem('tcgen_active_sid');if(aid&&sessions.find(s=>s.id===aid))activeSessionId=aid;else activeSessionId=sessions[0].id;}}}catch(e){console.error('loadSessions:',e);}}
function saveSessions(){localStorage.setItem(STORE_KEY,JSON.stringify(sessions.map(s=>{const{_streamHTML,...r}=s;return r;})));localStorage.setItem('tcgen_active_sid',activeSessionId);}
function getSession(){return sessions.find(s=>s.id===activeSessionId)||sessions[0];}
function switchSession(sid){
  // 同会话不处理
  if(sid===activeSessionId)return;
  // 保存当前会话的流式区域内容
  const cur=getSession();if(cur)cur._streamHTML=document.getElementById('streamArea').innerHTML;
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
}
function addSession(){
  const id='s'+Date.now(),n='会话 '+(sessions.length+1);
  sessions.push({id,name:n,messages:[],testCases:[]});
  saveSessions();renderSessionTabs();switchSession(id);
}
function renameSession(sid,name){
  const s=sessions.find(s=>s.id===sid);if(s){s.name=name;saveSessions();renderSessionTabs();}
}
function closeSession(sid){
  if(sessions.length<=1)return;
  sessions=sessions.filter(s=>s.id!==sid);
  if(activeSessionId===sid)activeSessionId=sessions[0].id;
  saveSessions();renderSessionTabs();switchSession(activeSessionId);
}
function renderSessionTabs(){
  const bar=document.getElementById('sessionTabs');
  bar.innerHTML=sessions.map(s=>
    `<div class="session-tab${s.id===activeSessionId?' active':''}" data-sid="${s.id}" onclick="switchSession('${s.id}')" ondblclick="renameSession('${s.id}',prompt('新名称:','${s.name}')||'${s.name}')">${escHtml(s.name)}${sessions.length>1?`<span class="close-btn" onclick="event.stopPropagation();closeSession('${s.id}')">×</span>`:''}</div>`
  ).join('')+'<div class="add-tab" onclick="addSession()" title="新建会话">＋</div>';
}

// ── 生成（流式） ──
let currentStreamAbort=null,fullText='',fullThinking='',contentBlockType='';
async function generate(){
  const prd=document.getElementById('prdInput').value.trim();
  const cfg=loadConfig();const ak=cfg.apiKey||'',bu=cfg.baseUrl||'https://api.deepseek.com/anthropic',md=cfg.model||'deepseek-v4-pro[1M]';
  const prompt=getActivePrompt();
  if(!prd){toast('请输入 PRD 内容','error');return;}if(!ak){toast('请配置 API Key','error');return;}

  const session=getSession();
  if(!session){toast('会话异常','error');return;}

  const btn=document.getElementById('generateBtn');btn.disabled=true;btn.textContent='⏳ 生成中...';
  document.getElementById('stopBtn').style.display='';
  hideResult();hideEmpty();
  document.getElementById('resultCard').style.display='none';

  // 流式输出区域：始终可见，每次生成追加一个新 block
  const area=document.getElementById('streamArea');
  area.style.display='';
  if(area.childNodes.length>0){
    const sep=document.createElement('hr');sep.style.cssText='border-color:var(--border);margin:12px 0;';
    area.appendChild(sep);
  }
  const block=document.createElement('div');
  area.appendChild(block);
  area.scrollTop=area.scrollHeight;
  fullText='';fullThinking='';

  let ctrl=null;
  try{
    if(currentStreamAbort)currentStreamAbort.abort();
    ctrl=new AbortController();currentStreamAbort=ctrl;
    const resp=await fetch('/api/generate/stream',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({prd,api_key:ak,base_url:bu,model:md,system_prompt:prompt?prompt.system:'',user_template:prompt?prompt.user:'',messages:session.messages.slice(-10)}),
      signal:ctrl.signal,
    });
    if(!resp.ok){block.innerHTML='<div style="color:var(--danger)">请求失败: '+resp.status+'</div>';return;}
    const reader=resp.body.getReader(),decoder=new TextDecoder();
    let buf='';
    while(true){const{value,done}=await reader.read();if(done)break;
      buf+=decoder.decode(value,{stream:true});
      while(buf.includes('\n\n')){
        const idx=buf.indexOf('\n\n'),line=buf.substring(0,idx);buf=buf.substring(idx+2);
        if(line.startsWith('data: '))try{const ev=JSON.parse(line.substring(6));updateStream(ev,area,block);}catch(e){console.error('SSE parse:',e);}
      }
    }
  }catch(e){if(e.name!=='AbortError'){console.error('generate:',e);block.innerHTML='<div style="color:var(--danger)">错误: '+escHtml(e.message)+'</div>';}}
  finally{
    document.getElementById('generateBtn').disabled=false;document.getElementById('generateBtn').textContent='▶ 生成测试用例';
    document.getElementById('stopBtn').style.display='none';if(currentStreamAbort===ctrl)currentStreamAbort=null;
    // 保存流式内容到会话（切标签时恢复）
    session._streamHTML=document.getElementById('streamArea').innerHTML;
    // 保存到会话历史
    const um=(prompt&&prompt.user?prompt.user:'请根据以下 PRD 文档，生成完整的测试用例：\n\n{prd_text}').replace('{prd_text}',prd);
    session.messages.push({role:'user',content:um});session.messages.push({role:'assistant',content:fullText});saveSessions();
    if(document.getElementById('chatModal').style.display!=='none')rebuildChatHistory();
    // 解析 JSON → 表格
    try{
      const jsonStr=extractJson(fullText),data=JSON.parse(jsonStr),tc=data.test_cases||[];
      if(tc.length>0){
        session.testCases=tc;block.innerHTML+=`<div style="color:var(--accent);font-weight:600;margin-top:8px;">✅ 已生成 ${tc.length} 条测试用例（下方表格）</div>`;
        document.getElementById('resultCard').style.display='flex';renderTable(tc);renderStats(tc,null);
      }else{block.innerHTML=_renderStreamHTML();}
    }catch(e){console.error('JSON parse:',e);block.innerHTML=_renderStreamHTML();}
  }
}

let _streamRAF=null;
function updateStream(ev,area,block){
  if(ev.type==='error'){block.innerHTML='<div style="color:var(--danger)">'+escHtml(ev.message||'流式错误')+'</div>';return;}
  if(ev.type==='thinking'){fullThinking+=ev.thinking||'';}
  else if(ev.type==='text'){fullText+=ev.text||'';}
  // 节流：最多 60fps 更新 DOM
  if(!_streamRAF)_streamRAF=requestAnimationFrame(()=>{
    _streamRAF=null;
    if(!block.isConnected)return;
    let h='';
    if(fullThinking)h+='<div class="stream-label">💭 思考过程</div><div class="stream-thinking">'+escHtml(fullThinking)+'</div>';
    h+='<div class="stream-label">📄 生成结果</div><div class="stream-text">'+escHtml(fullText)+'</div>';
    if(ev.type!=='done')h=h.replace('</div></div>','<span class="stream-cursor"></span></div></div>');
    block.innerHTML=h;
    if(area.scrollHeight-area.scrollTop-area.clientHeight<60)area.scrollTop=area.scrollHeight;
  });
}

function _renderStreamHTML(){let h='';if(fullThinking)h+='<div class="stream-label">💭 思考过程</div><div class="stream-thinking">'+escHtml(fullThinking)+'</div>';h+='<div class="stream-label">📄 生成结果</div><div class="stream-text">'+escHtml(fullText)+'</div>';return h;}
function extractJson(t){
  t=t.trim();const m=t.match(/```(?:json)?\s*([\s\S]*?)```/);if(m)return m[1].trim();
  const s=t.indexOf('{'),e=t.lastIndexOf('}');if(s!==-1&&e!==-1)return t.substring(s,e+1);return t;
}

function stopGenerate(){
  if(currentStreamAbort){currentStreamAbort.abort();currentStreamAbort=null;}
  document.getElementById('generateBtn').disabled=false;document.getElementById('generateBtn').textContent='▶ 生成测试用例';
  document.getElementById('stopBtn').style.display='none';
  toast('已停止生成');
}

// ── 聊天 ──
function openChat(){
  const cfg=loadConfig();if(!cfg.apiKey){toast('请先配置 API Key','error');return;}
  document.getElementById('chatModelLabel').textContent='模型: '+(cfg.model||'deepseek-v4-pro[1M]');
  document.getElementById('chatModal').style.display='';document.getElementById('chatInput').focus();
  rebuildChatHistory();
}
function rebuildChatHistory(){
  const area=document.getElementById('chatArea'),s=getSession();
  area.innerHTML='';
  if(s&&s.messages.length){
    s.messages.forEach(m=>appendChatMsg(m.role,m.content,null));
  }else{
    area.innerHTML='<div style="text-align:center;color:var(--empty-color);padding:40px 0;font-size:12px;">发送消息开始对话</div>';
  }
}
function closeChat(){document.getElementById('chatModal').style.display='none';}
function clearChat(){const s=getSession();s.messages=[];saveSessions();document.getElementById('chatArea').innerHTML='<div style="text-align:center;color:var(--empty-color);padding:40px 0;font-size:12px;">对话已清空</div>';}
function appendChatMsg(role,content,reasoning){
  const area=document.getElementById('chatArea'),ph=area.querySelector('div[style]');if(ph)ph.remove();
  const cls=role==='user'?'user':'ai',div=document.createElement('div');div.className='chat-msg '+cls;
  div.innerHTML='<div class="chat-bubble">'+escHtml(content)+'</div>';
  if(reasoning){const tid='ct_'+Date.now();div.innerHTML+='<span class="chat-thinking-toggle" onclick="toggleChatThink(\''+tid+'\')">💭 查看思考</span><div class="chat-thinking-content" id="'+tid+'">'+escHtml(reasoning)+'</div>';}
  area.appendChild(div);area.scrollTop=area.scrollHeight;
}
function toggleChatThink(id){const e=document.getElementById(id),t=e.previousElementSibling;if(e.style.display==='block'){e.style.display='none';t.textContent='💭 查看思考';}else{e.style.display='block';t.textContent='💭 收起思考';}}
async function sendChat(){
  const input=document.getElementById('chatInput'),msg=input.value.trim();if(!msg)return;
  const cfg=loadConfig(),ak=cfg.apiKey||'',bu=cfg.baseUrl||'https://api.deepseek.com/anthropic',md=cfg.model||'deepseek-v4-pro[1M]';
  if(!ak){toast('请配置 API Key','error');return;}
  input.value='';input.focus();
  const session=getSession();
  flog('info','[chat] session='+session.id+' msgs_before='+session.messages.length);
  appendChatMsg('user',msg);session.messages.push({role:'user',content:msg});saveSessions();
  flog('info','[chat] sending '+session.messages.length+' messages to API');

  document.getElementById('chatInput').disabled=true;document.getElementById('chatSendBtn').disabled=true;document.getElementById('chatSendBtn').textContent='...';
  const typingEl=document.createElement('div');typingEl.className='chat-msg ai';typingEl.innerHTML='<div class="chat-typing"><span></span><span></span><span></span></div>';
  document.getElementById('chatArea').appendChild(typingEl);document.getElementById('chatArea').scrollTop=document.getElementById('chatArea').scrollHeight;

  try{
    const resp=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:ak,base_url:bu,model:md,messages:session.messages})});
    const data=await resp.json();typingEl.remove();
    if(!resp.ok){appendChatMsg('ai','❌ '+(data.error||'失败'));return;}
    appendChatMsg('ai',data.content||'(空)',data.reasoning);
    session.messages.push({role:'assistant',content:data.content||''});saveSessions();
  }catch(e){typingEl.remove();appendChatMsg('ai','❌ 网络错误: '+e.message);}
  finally{document.getElementById('chatInput').disabled=false;document.getElementById('chatSendBtn').disabled=false;document.getElementById('chatSendBtn').textContent='发送';document.getElementById('chatInput').focus();}
}

// ── 表格渲染 ──
function renderTable(cases){document.getElementById('tableBody').innerHTML=cases.map((tc,i)=>`<tr onclick="selectCase(${i})" style="cursor:pointer;"><td><code>${esc(tc.id)}</code></td><td>${esc(tc.module)}</td><td><strong>${esc(tc.title)}</strong></td><td>${esc(tc.precondition)}</td><td style="white-space:pre-wrap">${esc(tc.steps)}</td><td style="white-space:pre-wrap">${esc(tc.expected)}</td><td><span class="tag tag-type">${esc(tc.type)}</span></td><td><span class="tag ${priTag(tc.priority)}">${esc(tc.priority)}</span></td></tr>`).join('');buildRightPanel(cases);}
function priTag(p){if(p==='高')return'tag-high';if(p==='中')return'tag-mid';return'tag-low';}
function renderStats(cases,usage){
  const bp={},bt={};cases.forEach(tc=>{bp[tc.priority]=(bp[tc.priority]||0)+1;bt[tc.type]=(bt[tc.type]||0)+1;});
  let h=`<span>共 <b>${cases.length}</b> 条</span><span class="sep"></span>`;
  Object.entries(bp).forEach(([k,v])=>{h+=`<span>${k}优先级 <b>${v}</b></span>`;});
  h+='<span class="sep"></span>';
  Object.entries(bt).forEach(([k,v])=>{h+=`<span>${k} <b>${v}</b></span>`;});
  if(usage)h+=`<span class="sep"></span><span>Tokens: ${usage.total_tokens} (入${usage.prompt_tokens}+出${usage.completion_tokens})</span>`;
  document.getElementById('statsBar').innerHTML=h;
}
function hideResult(){document.getElementById('resultCard').style.display='none';}
function hideEmpty(){document.getElementById('emptyState').style.display='none';}
function showEmpty(){document.getElementById('emptyState').style.display='flex';}

async function exportExcel(){
  const s=getSession();if(!s.testCases.length)return toast('无可用例','error');
  try{
    const r=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({test_cases:s.testCases})});
    if(!r.ok){const d=await r.json();return toast(d.error||'失败','error');}
    const b=await r.blob(),url=URL.createObjectURL(b);const a=document.createElement('a');a.href=url;a.download='测试用例.xlsx';a.click();URL.revokeObjectURL(url);toast('已下载');
  }catch(e){console.error('exportExcel:',e);toast('失败: '+e.message,'error');}
}
async function copyJSON(){
  const s=getSession();try{await navigator.clipboard.writeText(JSON.stringify(s.testCases,null,2));toast('已复制');}catch(e){console.error('copyJSON:',e);toast('失败','error');}
}

// ── 快速模板 ──
const DEMO_TEMPLATES={login:'## 登录功能需求\n\n### 功能概述\n用户通过账号密码登录系统，支持记住密码和忘记密码功能。\n\n### 详细需求\n1. 登录页面包含：账号输入框、密码输入框、记住密码复选框、登录按钮、忘记密码链接\n2. 账号支持手机号（11位）或邮箱格式\n3. 密码要求6-20位，支持字母数字和特殊字符\n4. 连续输错5次密码后账号锁定30分钟\n5. 登录成功后跳转到首页\n6. 勾选"记住密码"后7天内免登录\n7. 点击"忘记密码"跳转到密码重置页面\n\n### 界面要求\n- 登录表单居中显示\n- 输入框下方显示格式校验提示\n- 登录失败时显示错误信息',shopcart:'## 购物车功能需求\n\n### 功能概述\n用户可以将商品加入购物车，支持修改数量、删除、全选、结算等操作。\n\n### 详细需求\n1. 商品详情页点击"加入购物车"，加入成功提示\n2. 购物车页面展示：商品图片、名称、单价、数量（可加减）、小计、全选复选框\n3. 数量最少1，最多为库存量，加减按钮做上下限控制\n4. 支持单个删除和批量删除选中商品\n5. 全选/取消全选，显示已选商品总价\n6. 点击"结算"跳转到订单确认页\n7. 未登录时点击加入购物车弹出登录提示\n\n### 边界条件\n- 库存为0时显示"已售罄"\n- 购物车最多50种不同商品',usermgmt:'## 用户管理功能需求\n\n### 功能概述\n管理员对系统用户进行增删改查操作，支持角色分配和状态管理。\n\n### 详细需求\n1. 用户列表页分页展示，每页20条\n2. 列表包含：用户名、手机号、角色、状态、创建时间、操作\n3. 搜索功能：按用户名/手机号模糊搜索\n4. 新增用户：用户名、手机号、密码、角色\n5. 编辑用户：修改角色和状态\n6. 删除用户：二次确认弹窗\n7. 状态切换：启用/禁用\n8. 用户名唯一性校验\n\n### 权限控制\n- 仅管理员可访问\n- 普通用户提示"权限不足"',order:'## 订单管理功能需求\n\n### 功能概述\n用户查看订单列表、详情，支持取消订单、申请退款。\n\n### 详细需求\n1. 订单列表按时间倒序，支持按状态筛选\n2. 每个订单显示：订单号、商品、金额、状态、时间\n3. 点击进入详情，展示完整商品列表、地址、物流\n4. 待付款支持取消和去支付\n5. 待发货支持申请退款\n6. 已发货支持确认收货\n7. 状态流转：待付款→待发货→已发货→已完成\n\n### 异常场景\n- 支付超时30分钟自动取消\n- 库存不足时支付失败并退款'};
function loadTemplate(k){const t=DEMO_TEMPLATES[k];if(!t)return;document.getElementById('prdInput').value=t;toast('已加载模板');}

// ── 右侧面板 ──
function buildRightPanel(cases){
  // 统计
  const bp={},bt={};cases.forEach(tc=>{bp[tc.priority]=(bp[tc.priority]||0)+1;bt[tc.type]=(bt[tc.type]||0)+1;});
  let st=`<b>${cases.length}</b> 条用例 · `;
  Object.entries(bp).forEach(([k,v])=>{st+=`<span style="margin-right:6px;">${k}优先级 <b>${v}</b></span>`;});
  document.getElementById('rpStats').innerHTML=st;

  // 目录树：按模块分组
  const byModule={};cases.forEach((tc,i)=>{const m=tc.module||'未分类';if(!byModule[m])byModule[m]=[];byModule[m].push({...tc,_idx:i});});
  const tree=document.getElementById('rpTree');
  tree.innerHTML=Object.entries(byModule).map(([mod,list])=>`<div class="rp-module" onclick="toggleModule(this)"><span class="arrow">▶</span> ${escHtml(mod)} (${list.length})</div>${list.map(c=>`<div class="rp-case" style="display:none;" onclick="selectCase(${c._idx})" data-idx="${c._idx}">${escHtml(c.title)}</div>`).join('')}`).join('');
}

function toggleModule(el){
  el.classList.toggle('open');
  let sib=el.nextElementSibling;
  while(sib&&sib.classList.contains('rp-case')){sib.style.display=el.classList.contains('open')?'block':'none';sib=sib.nextElementSibling;}
}

function selectCase(idx){
  // 树节点：展开父模块 + 高亮 + 滚动到可见
  document.querySelectorAll('.rp-case').forEach(e=>{
    const match=parseInt(e.dataset.idx)===idx;
    e.classList.toggle('active',match);
    if(match){
      // 展开父模块
      let mod=e.previousElementSibling;
      while(mod&&!mod.classList.contains('rp-module'))mod=mod.previousElementSibling;
      if(mod&&!mod.classList.contains('open'))mod.classList.add('open');
      // 展开所有同级 case
      let sib=mod?mod.nextElementSibling:null;
      while(sib&&sib.classList.contains('rp-case')){sib.style.display='block';sib=sib.nextElementSibling;}
      e.scrollIntoView({behavior:'smooth',block:'nearest'});
    }
  });
  // 高亮表格行
  document.querySelectorAll('#tableBody tr').forEach((tr,i)=>{tr.classList.toggle('selected',i===idx);if(i===idx)tr.scrollIntoView({behavior:'smooth',block:'center'});});
  // 显示详情
  const tc=getSession().testCases[idx];if(!tc)return;
  const sec=document.getElementById('rpDetailSection');sec.style.display='';
  document.getElementById('rpDetail').innerHTML=`
    <div class="rp-detail-label">编号</div><div class="rp-detail-value">${escHtml(tc.id)}</div>
    <div class="rp-detail-label">标题</div><div class="rp-detail-value">${escHtml(tc.title)}</div>
    <div class="rp-detail-label">模块</div><div class="rp-detail-value">${escHtml(tc.module)}</div>
    <div class="rp-detail-label">类型 / 优先级</div><div class="rp-detail-value">${escHtml(tc.type)} · <span class="tag ${priTag(tc.priority)}">${escHtml(tc.priority)}</span></div>
    <div class="rp-detail-label">前置条件</div><div class="rp-detail-value">${escHtml(tc.precondition)}</div>
    <div class="rp-detail-label">测试步骤</div><div class="rp-detail-value">${escHtml(tc.steps)}</div>
    <div class="rp-detail-label">预期结果</div><div class="rp-detail-value">${escHtml(tc.expected)}</div>`;
}

// ── 前端日志（上报到后端） ──
function flog(level,msg){
  console.log('[frontend]',msg);
  fetch('/api/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({level,message:msg})}).catch(e=>console.error('flog:',e));
}

function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function escHtml(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

(async function init(){
  loadSessions();renderSessionTabs();
  await fetchPrompts();applyConfig();
})();
