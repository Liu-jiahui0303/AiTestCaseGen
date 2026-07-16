// ── 配置 ──
const CFG_KEY='tcgen_config',PROMPT_STORE_KEY='tcgen_prompts',STORE_KEY='tcgen_sessions';
const MODEL_PRESETS={
  dp:{baseUrl:'https://api.deepseek.com/anthropic',model:'deepseek-v4-pro[1M]',apiKey:'',label:'DeepSeek V4 Pro'},
  qwen:{baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen3.7-plus',apiKey:'',label:'Qwen3.7-Plus（图文）'}
};
let allPrompts=[],modalMode='add',editingPromptId=null;

function loadConfig(){
  try{
    let c=JSON.parse(localStorage.getItem(CFG_KEY))||{};
    // 迁移旧格式
    if(!c.dp&&c.baseUrl){c={activeModel:'dp',dp:{baseUrl:c.baseUrl,model:c.model||'deepseek-v4-pro[1M]',apiKey:c.apiKey||''},qwen:{...MODEL_PRESETS.qwen},activePrompt:c.activePrompt};}
    if(!c.dp)c.dp={...MODEL_PRESETS.dp};
    if(!c.qwen)c.qwen={...MODEL_PRESETS.qwen};
    if(!c.activeModel)c.activeModel='dp';
    return c;
  }catch(e){console.error('loadConfig:',e);return{activeModel:'dp',dp:{...MODEL_PRESETS.dp},qwen:{...MODEL_PRESETS.qwen}};}
}
function getActiveModel(){const c=loadConfig();return c.activeModel||'dp';}
function applyConfig(){
  const c=loadConfig(),am=getActiveModel(),m=c[am]||c.dp;
  document.getElementById('modelSelect').value=am;
  document.getElementById('baseUrl').value=m.baseUrl||'';
  document.getElementById('apiKey').value=m.apiKey||'';
  document.getElementById('toolbarModel').textContent=(MODEL_PRESETS[am]||MODEL_PRESETS.dp).label;
  document.getElementById('imageArea').style.display=am==='qwen'?'':'none';
  refreshPromptSelect();
}
function saveConfig(){
  const c=loadConfig(),am=getActiveModel();
  c[am].baseUrl=document.getElementById('baseUrl').value.trim();
  c[am].apiKey=document.getElementById('apiKey').value.trim();
  localStorage.setItem(CFG_KEY,JSON.stringify(c));applyConfig();toast('配置已保存');
}
function onModelChange(){
  const c=loadConfig(),am=document.getElementById('modelSelect').value;
  c.activeModel=am;
  if(!c[am])c[am]={...MODEL_PRESETS[am]};
  localStorage.setItem(CFG_KEY,JSON.stringify(c));
  document.getElementById('baseUrl').value=c[am].baseUrl||'';
  document.getElementById('apiKey').value=c[am].apiKey||'';
  document.getElementById('toolbarModel').textContent=(MODEL_PRESETS[am]||{}).label||'';
  document.getElementById('imageArea').style.display=am==='qwen'?'':'none';
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
function toastPersist(m,t){const e=document.createElement('div');e.className='toast-item persist '+(t||'');const s=document.createElement('span');s.textContent=m;const x=document.createElement('button');x.className='toast-close';x.textContent='✕';x.title='关闭';x.onclick=()=>{e.style.opacity='0';e.style.transition='opacity .3s';setTimeout(()=>e.remove(),300);};e.appendChild(s);e.appendChild(x);document.getElementById('toastWrap').appendChild(e);}

// ── 提示词 ──
async function fetchPrompts(){
  try{
    const r=await fetch('/api/prompts?_='+Date.now());const d=await r.json();
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
function saveSessions(){localStorage.setItem(STORE_KEY,JSON.stringify(sessions));localStorage.setItem('tcgen_active_sid',activeSessionId);}
function getSession(){return sessions.find(s=>s.id===activeSessionId)||sessions[0];}
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
}
function addSession(){
  if(currentStreamAbort){toast('请等待生成完成或手动停止后再新增会话','error');return;}
  const id='s'+Date.now(),n='会话 '+(sessions.length+1);
  sessions.push({id,name:n,messages:[],testCases:[]});
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
  bar.innerHTML=sessions.map(s=>
    `<div class="session-tab${s.id===activeSessionId?' active':''}" data-sid="${s.id}" onclick="switchSession('${s.id}')" ondblclick="renameSession('${s.id}',prompt('新名称:','${s.name}')||'${s.name}')">${escHtml(s.name)}${sessions.length>1?`<span class="close-btn" onclick="event.stopPropagation();closeSession('${s.id}')">×</span>`:''}</div>`
  ).join('')+'<div class="add-tab" onclick="addSession()" title="新建会话">＋</div>';
}

// ── 生成（流式） ──
let currentStreamAbort=null,fullText='',fullThinking='',kbMatchCount=-1,contentBlockType='';
async function generate(){
  const prd=document.getElementById('prdInput').value.trim();
  const cfg=loadConfig(),am=getActiveModel(),m=cfg[am]||cfg.dp;
  const ak=m.apiKey||'',bu=m.baseUrl||'',md=m.model||'';
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
  // 初始 loading 状态，第一条内容到达后会被覆盖
  block.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:12px 0;color:var(--text-dim);font-size:12px;"><span class="stream-spinner"></span> 正在连接 AI 服务...</div>';
  area.appendChild(block);
  // 知识库引用 badge —— 独立 DOM 元素，不依赖 RAF
  const badge=document.createElement('div');
  badge.style.display='none';
  area.appendChild(badge);
  area.scrollTop=area.scrollHeight;
  fullText='';fullThinking='';kbMatchCount=-1;

  let ctrl=null,aborted=false;
  try{
    if(currentStreamAbort)currentStreamAbort.abort();
    ctrl=new AbortController();currentStreamAbort=ctrl;
    const isQwen=am==='qwen';
    const endpoint=isQwen?'/api/generate/stream/multimodal':'/api/generate/stream';
    const body=isQwen
      ?{prd,api_key:ak,base_url:bu,model:md,system_prompt:prompt?prompt.system:'',user_template:prompt?prompt.user:'',messages:session.messages.slice(-10),use_knowledge:getKbUseEnabled(),images:_pastedImages.map(img=>img.dataUrl)}
      :{prd,api_key:ak,base_url:bu,model:md,system_prompt:prompt?prompt.system:'',user_template:prompt?prompt.user:'',messages:session.messages.slice(-10),use_knowledge:getKbUseEnabled()};
    const resp=await fetch(endpoint,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body),
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
  }catch(e){if(e.name!=='AbortError'){console.error('generate:',e);block.innerHTML='<div style="color:var(--danger)">错误: '+escHtml(e.message)+'</div>';}else{aborted=true;}}
  finally{
    document.getElementById('generateBtn').disabled=false;document.getElementById('generateBtn').textContent='▶ 生成测试用例';
    document.getElementById('stopBtn').style.display='none';if(currentStreamAbort===ctrl)currentStreamAbort=null;
    // 保存流式内容到会话（切标签时恢复）
    session._streamHTML=document.getElementById('streamArea').innerHTML;
    // 保存到会话历史
    const um=(prompt&&prompt.user?prompt.user:'请根据以下 PRD 文档，生成完整的测试用例：\n\n{prd_text}').replace('{prd_text}',prd);
    session.messages.push({role:'user',content:um});session.messages.push({role:'assistant',content:fullText});
    if(document.getElementById('chatModal').style.display!=='none')rebuildChatHistory();
    // 解析 JSON → 表格 (用户手动停止时跳过)
    if(!aborted){try{
      const jsonStr=extractJson(fullText);if(!jsonStr||jsonStr.length<10){block.innerHTML=_renderStreamHTML();saveSessions();toastPersist('AI 未返回有效的 JSON 格式，请重新生成','error');return;}
      const data=JSON.parse(jsonStr),tc=data.test_cases||[];
      if(tc.length>0){
        session.testCases=tc;saveSessions();block.innerHTML+=`<div style="color:var(--accent);font-weight:600;margin-top:8px;">✅ 已生成 ${tc.length} 条测试用例（下方表格）</div>`;
        document.getElementById('resultCard').style.display='flex';renderTable(tc);renderStats(tc,null);
        // 存入知识库
        if(getKbSaveEnabled()){
          if(prd&&prd.length>4&&session.testCases.length)saveToKnowledgeBase(session,prd);
        }
      }else{block.innerHTML=_renderStreamHTML();saveSessions();}
    }catch(e){console.warn('JSON 解析失败 (AI 输出格式异常，已展示原始结果):',e.message);block.innerHTML=_renderStreamHTML()+'<div style="color:var(--danger);margin-top:6px;">⚠️ AI 返回的 JSON 格式有误，请检查上方原始结果或重试</div>';saveSessions();toastPersist('AI 返回的 JSON 格式有误，请重新生成','error');}}
  }
}

let _streamRAF=null;
function updateStream(ev,area,block){
  if(ev.type==='error'){block.innerHTML='<div style="color:var(--danger)">'+escHtml(ev.message||'流式错误')+'</div>';return;}
  if(ev.type==='knowledge'){
    kbMatchCount=ev.matched||0;
    console.log('[KB] 收到知识库事件, matched='+kbMatchCount);
    const badge=block.nextElementSibling;
    if(badge){
      if(kbMatchCount>0){
        badge.innerHTML='REF: '+kbMatchCount+' <span style="font-size:10px;">▶</span>';
        badge.className='kb-badge matched';
        badge.title='点击查看引用详情';
        badge._records=ev.records||[];
        badge._expanded=false;
        badge.onclick=function(){
          const detail=badge.nextElementSibling;
          if(badge._expanded){
            if(detail&&detail.classList.contains('kb-detail'))detail.remove();
            badge.querySelector('span').textContent='▶';
            badge._expanded=false;
          }else{
            let html='<table class="kb-detail-table">';
            html+='<thead><tr><th>编号</th><th>标题</th><th>步骤</th><th>预期结果</th></tr></thead><tbody>';
            for(const rec of badge._records){
              html+='<tr class="kb-module-header"><td colspan="4">'+escHtml((rec.modules||[]).join(' / '))+' · '+rec.case_count+'条用例 · ID:'+rec.id+'</td></tr>';
              for(const tc of rec.samples||[]){
                html+='<tr>';
                html+='<td><code>'+escHtml(tc.id)+'</code></td>';
                html+='<td>'+escHtml(tc.title)+'</td>';
                html+='<td style="white-space:pre-wrap;">'+escHtml(tc.steps)+'</td>';
                html+='<td style="white-space:pre-wrap;">'+escHtml(tc.expected)+'</td>';
                html+='</tr>';
              }
            }
            html+='</tbody></table>';
            const div=document.createElement('div');
            div.className='kb-detail kb-detail-panel';
            div.innerHTML=html;
            badge.after(div);
            badge.querySelector('span').textContent='▼';
            badge._expanded=true;
          }
        };
      }else{
        badge.textContent='REF: 0';
        badge.className='kb-badge none';
      }
    }
    return;
  }
  if(ev.type==='thinking'){fullThinking+=ev.thinking||'';}
  else if(ev.type==='text'){fullText+=ev.text||'';}
  // 节流：最多 60fps 更新 DOM（无实际内容时不覆盖 loading 动画）
  if(!_streamRAF)_streamRAF=requestAnimationFrame(()=>{
    _streamRAF=null;
    if(!block.isConnected)return;
    if(!fullThinking&&!fullText)return; // 保持 loading 状态
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
  // pywebview 桌面模式：走原生保存对话框
  if(window.pywebview&&window.pywebview.api){
    try{
      const r=await window.pywebview.api.save_excel(JSON.stringify(s.testCases));
      if(r==='ok')toast('已下载');
      else if(r!=='cancel')toast('导出失败: '+r,'error');
    }catch(e){console.error('exportExcel:',e);toast('失败: '+e.message,'error');}
    return;
  }
  // 浏览器模式：blob 下载
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

  // 目录树：按模块分组，每个节点加复选框
  const byModule={};cases.forEach((tc,i)=>{const m=tc.module||'未分类';if(!byModule[m])byModule[m]=[];byModule[m].push({...tc,_idx:i});});
  const tree=document.getElementById('rpTree');
  tree.innerHTML=Object.entries(byModule).map(([mod,list])=>
    `<div class="rp-module" onclick="toggleModule(this)"><input type="checkbox" class="rp-check" onclick="event.stopPropagation();toggleModuleCheck(this)" data-module="${escHtml(mod)}"><span class="arrow">▶</span> ${escHtml(mod)} (${list.length})</div>`+
    list.map(c=>`<div class="rp-case" style="display:none;" onclick="selectCase(${c._idx})" data-idx="${c._idx}" data-module="${escHtml(mod)}"><input type="checkbox" class="rp-check" onclick="event.stopPropagation();onCaseCheck(this)" data-idx="${c._idx}">${escHtml(c.title)}</div>`).join('')
  ).join('');
  document.getElementById('rpDelBtn').style.display='none';
}

function toggleModule(el){
  el.classList.toggle('open');
  let sib=el.nextElementSibling;
  while(sib&&sib.classList.contains('rp-case')){sib.style.display=el.classList.contains('open')?'flex':'none';sib=sib.nextElementSibling;}
}

function toggleModuleCheck(cb){
  const mod=cb.dataset.module,checked=cb.checked;
  document.querySelectorAll('.rp-case').forEach(e=>{
    if(e.dataset.module===mod){e.querySelector('.rp-check').checked=checked;e.style.background=checked?'var(--btn-hover)':'';}
  });
  document.getElementById('rpDelBtn').style.display=getCheckedCases().length?'':'none';
}

function onCaseCheck(cb){
  const idx=parseInt(cb.dataset.idx),mod=cb.closest('.rp-case').dataset.module;
  cb.closest('.rp-case').style.background=cb.checked?'var(--btn-hover)':'';
  // 更新模块复选框状态
  const cases=document.querySelectorAll(`.rp-case[data-module="${CSS.escape(mod)}"]`);
  let all=0,chk=0;
  cases.forEach(e=>{all++;if(e.querySelector('.rp-check').checked)chk++;});
  const mcb=document.querySelector(`.rp-check[data-module="${CSS.escape(mod)}"]`);
  if(mcb){mcb.checked=chk===all;mcb.indeterminate=chk>0&&chk<all;}
  document.getElementById('rpDelBtn').style.display=getCheckedCases().length?'':'none';
}

function getCheckedCases(){
  const ids=new Set();
  // 模块级选中：该模块下全部用例
  document.querySelectorAll('.rp-check[data-module]').forEach(cb=>{
    if(cb.checked&&!cb.dataset.idx){
      const mod=cb.dataset.module;
      document.querySelectorAll(`.rp-case[data-module="${CSS.escape(mod)}"]`).forEach(e=>ids.add(parseInt(e.dataset.idx)));
    }
  });
  // 单个用例选中
  document.querySelectorAll('.rp-check[data-idx]').forEach(cb=>{if(cb.checked)ids.add(parseInt(cb.dataset.idx));});
  return [...ids];
}

function deleteSelectedCases(){
  const ids=getCheckedCases();
  if(!ids.length)return toast('请先勾选用例','error');
  if(!confirm(`确定删除 ${ids.length} 条用例吗？此操作不可撤销。`))return;
  const s=getSession();if(!s)return;
  // 保留未被删除的用例
  s.testCases=s.testCases.filter((_,i)=>!ids.includes(i));
  saveSessions();
  renderTable(s.testCases);renderStats(s.testCases,null);
  buildRightPanel(s.testCases);
  if(!s.testCases.length){hideResult();showEmpty();}
  toast(`已删除 ${ids.length} 条用例`);
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
      while(sib&&sib.classList.contains('rp-case')){sib.style.display='flex';sib=sib.nextElementSibling;}
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

// ── 右侧面板拖拽缩放 ──
(function(){
  const rp=document.getElementById('rightPanel'),handle=document.getElementById('rpResizeHandle');
  if(!rp||!handle)return;
  const MIN=140,MAX=500;
  let saved=parseInt(localStorage.getItem('tcgen_rp_width'));
  if(saved&&saved>=MIN&&saved<=MAX)rp.style.width=saved+'px';
  let dragging=false,startX=0,startW=0;
  handle.addEventListener('mousedown',function(e){
    e.preventDefault();dragging=true;startX=e.clientX;startW=rp.offsetWidth;
    handle.classList.add('active');document.body.style.cursor='col-resize';document.body.style.userSelect='none';
  });
  document.addEventListener('mousemove',function(e){
    if(!dragging)return;const w=Math.min(MAX,Math.max(MIN,startW+startX-e.clientX));
    rp.style.width=w+'px';
  });
  document.addEventListener('mouseup',function(){
    if(!dragging)return;dragging=false;handle.classList.remove('active');
    document.body.style.cursor='';document.body.style.userSelect='';
    localStorage.setItem('tcgen_rp_width',rp.offsetWidth);
  });
})();

// ── 知识库 ──
function getKbUseEnabled(){return document.getElementById('kbUseToggle').checked;}
function getKbSaveEnabled(){return document.getElementById('kbSaveToggle').checked;}
function onKbToggle(){
  localStorage.setItem('tcgen_kb_use',document.getElementById('kbUseToggle').checked);
  localStorage.setItem('tcgen_kb_save',document.getElementById('kbSaveToggle').checked);
}
async function saveToKnowledgeBase(session,kbPrd){
  console.log('[KB] saveToKnowledgeBase, _kbRecordId='+session._kbRecordId+', testCases='+session.testCases.length);
  if(session._kbRecordId){
    // 已有记录：取回现有用例，标题去重后合并更新
    console.log('[KB] 走更新路径, recordId='+session._kbRecordId);
    let updated=false;
    try{
      const r=await fetch('/api/knowledge/detail/'+session._kbRecordId);
      if(r.ok){
        const d=await r.json();
        const existingTitles=new Set((d.test_cases||[]).map(tc=>(tc.title||'').trim()).filter(Boolean));
        const merged=[...(d.test_cases||[])];
        let added=0;
        for(const tc of session.testCases){
          const title=(tc.title||'').trim();
          if(title&&!existingTitles.has(title)){
            merged.push(tc);existingTitles.add(title);added++;
          }
        }
        if(added>0){
          const ur=await fetch('/api/knowledge/'+session._kbRecordId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({prd:kbPrd,test_cases:merged})});
          if(ur.ok){fetchKbStats();console.log('kb updated: +'+added+' cases, total='+merged.length);updated=true;}
        }else{updated=true;} // 无新用例，也算成功
      }else{
        // 记录已被手动删除，清除 ID 降级为新建
        session._kbRecordId=null;saveSessions();
      }
    }catch(e){console.error('kb update:',e);session._kbRecordId=null;saveSessions();}
    if(updated)return;
  }
  // 首次存入 / 更新失败降级：POST 新建
  console.log('[KB] 走新建路径');
  try{
    const r=await fetch('/api/knowledge/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prd:kbPrd,test_cases:session.testCases})});
    if(r.ok){const d=await r.json();session._kbRecordId=d.id;console.log('[KB] 新建成功, 新ID='+d.id);saveSessions();fetchKbStats();}
    else{console.error('[KB] 新建失败: '+r.status);}
  }catch(e){console.error('kb save:',e);}
}
async function fetchKbStats(){
  try{const r=await fetch('/api/knowledge/stats');const d=await r.json();
    document.getElementById('kbStat').textContent='已积累 '+d.count+' 份参考';}catch(e){}
}
async function openKbBrowser(){
  document.getElementById('kbModal').style.display='';
  try{const r=await fetch('/api/knowledge/list');const d=await r.json();
    document.getElementById('kbModalCount').textContent=d.total+' 条记录';
    const list=document.getElementById('kbList');
    if(!d.items.length){list.innerHTML='<div style=\"text-align:center;color:var(--empty-color);padding:30px 0;font-size:12px;\">暂无历史记录</div>';return;}
    list.innerHTML=d.items.map(i=>{
      const mods=(i.modules||[]).join(' / ')||'未知模块';
      return '<div class=\"kb-row\" style=\"border-bottom:1px solid var(--section-border);padding:8px 0;display:flex;align-items:flex-start;gap:10px;cursor:pointer;\" onclick=\"toggleKbDetail(event,'+i.id+')\"><div style=\"flex:1;min-width:0;\"><div style=\"font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;\" title=\"'+escHtml(i.prd_summary||'')+'\">'+escHtml(i.prd_summary||'').substring(0,50)+'</div><div style=\"font-size:10px;color:var(--text-dim);margin-top:2px;\">'+escHtml(mods)+' · '+i.case_count+'条用例 · '+i.created_at+'</div></div><button class=\"btn btn-sm btn-danger\" onclick=\"event.stopPropagation();deleteFromKb('+i.id+')\" style=\"flex-shrink:0;\">🗑</button><div class=\"kb-detail-panel\" style=\"display:none;\"></div></div>';
    }).join('');
  }catch(e){console.error('kb list:',e);}
}
async function toggleKbDetail(event,id){
  event.stopPropagation();
  const row=event.currentTarget;
  const panel=row.querySelector('.kb-detail-panel');
  if(panel.style.display==='block'){panel.style.display='none';return;}
  // 已有内容则直接展开
  if(panel._loaded){panel.style.display='block';return;}
  // 首次加载
  panel.innerHTML='<div style=\"text-align:center;padding:12px 0;color:var(--text-dim);\">加载中...</div>';
  panel.style.display='block';
  try{
    const r=await fetch('/api/knowledge/detail/'+id);
    if(!r.ok){panel.innerHTML='<div style=\"color:var(--danger);\">加载失败</div>';return;}
    const d=await r.json();
    const tcs=d.test_cases||[];
    if(!tcs.length){panel.innerHTML='<div style=\"color:var(--text-dim);text-align:center;padding:8px 0;\">无用例数据</div>';return;}
    let html='<table class="kb-detail-table" style="margin-top:6px;">';
    html+='<thead><tr><th>编号</th><th>标题</th><th>步骤</th><th>预期结果</th><th>类型</th><th>优先级</th></tr></thead><tbody>';
    for(const tc of tcs){
      html+='<tr>';
      html+='<td><code>'+escHtml(tc.id)+'</code></td>';
      html+='<td>'+escHtml(tc.title)+'</td>';
      html+='<td style="white-space:pre-wrap;">'+escHtml(tc.steps)+'</td>';
      html+='<td style="white-space:pre-wrap;">'+escHtml(tc.expected)+'</td>';
      html+='<td>'+escHtml(tc.type)+'</td>';
      html+='<td>'+escHtml(tc.priority)+'</td>';
      html+='</tr>';
    }
    html+='</tbody></table>';
    panel.innerHTML=html;
    panel._loaded=true;
  }catch(e){console.error('kb detail:',e);panel.innerHTML='<div style=\"color:var(--danger);\">加载失败</div>';}
}
function closeKbModal(){document.getElementById('kbModal').style.display='none';}
async function deleteFromKb(id){
  if(!confirm('删除这条知识库记录？'))return;
  try{await fetch('/api/knowledge/'+id,{method:'DELETE'});openKbBrowser();fetchKbStats();toast('已删除');}catch(e){toast('删除失败','error');}
}
async function clearKnowledge(){
  if(!confirm('确定清空全部知识库记录？此操作不可撤销。'))return;
  try{await fetch('/api/knowledge/clear',{method:'DELETE'});openKbBrowser();fetchKbStats();toast('已清空');}catch(e){toast('清空失败','error');}
}

let _dedupGroups=null;
async function openDedupPreview(){
  document.getElementById('dedupModal').style.display='';
  document.getElementById('dedupLoading').style.display='';
  document.getElementById('dedupResult').style.display='none';
  document.getElementById('dedupFooter').style.display='none';
  _dedupGroups=null;
  try{
    const r=await fetch('/api/knowledge/dedup/preview',{method:'POST'});
    const d=await r.json();
    document.getElementById('dedupLoading').style.display='none';
    if(!d.groups||!d.groups.length){
      document.getElementById('dedupResult').style.display='';
      document.getElementById('dedupResult').innerHTML='<div style="text-align:center;padding:30px 0;color:var(--text-dim);font-size:13px;">✅ 未发现重复记录，无需去重</div>';
      document.getElementById('dedupFooter').style.display='flex';
      document.getElementById('dedupSummary').textContent='';
      document.getElementById('dedupExecBtn').style.display='none';
      return;
    }
    _dedupGroups=d.groups;
    let html='';
    html+='<div style="margin-bottom:12px;font-size:12px;color:var(--text-dim);">共检测到 <b style="color:var(--danger);">'+d.groups.length+'</b> 组重复，涉及 <b>'+d.total_delete+'</b> 条可合并记录</div>';
    d.groups.forEach((g,i)=>{
      html+='<div class="dedup-group">';
      html+='<div style="font-weight:700;font-size:13px;margin-bottom:8px;">GROUP '+(i+1)+': <span style="color:var(--accent);">'+escHtml(g.module)+'</span></div>';
      // 保留记录
      html+='<div class="dedup-keep">';
      html+='<div class="dedup-keep-label">KEEP: ID '+g.keep_id+' ('+g.keep_count+' cases)</div>';
      html+='<div class="dedup-keep-titles">'+(g.keep_titles||[]).map(t=>'· '+escHtml(t)).join('<br>')+'</div>';
      html+='</div>';
      // 合并来源
      for(let j=0;j<g.merge_items.length;j++){
        const m=g.merge_items[j];
        html+='<div class="dedup-merge">';
        html+='<div class="dedup-merge-label">MERGE: ID '+m.id+' ('+m.count+' cases)</div>';
        if(m.overlap&&m.overlap.length){
          html+='<div class="dedup-merge-overlap">重复标题: '+(m.overlap).map(t=>escHtml(t)).join(', ')+'</div>';
        }
        html+='<div class="dedup-merge-titles">'+(m.titles||[]).map(t=>'· '+escHtml(t)).join('<br>')+'</div>';
        html+='</div>';
      }
      // 汇总
      html+='<div class="dedup-summary">';
      if(g.keep_only&&g.keep_only.length)html+='<span class="keep">保留独有: '+g.keep_only.map(t=>escHtml(t)).join(', ')+'</span><br>';
      if(g.new_only&&g.new_only.length)html+='<span class="merge">合并新增: '+g.new_only.map(t=>escHtml(t)).join(', ')+'</span><br>';
      html+='→ 去重后预计 <b style="color:var(--accent);">'+g.final_count+'</b> 条唯一用例';
      html+='</div>';
      html+='</div>';
    });
    document.getElementById('dedupResult').innerHTML=html;
    document.getElementById('dedupResult').style.display='';
    document.getElementById('dedupFooter').style.display='flex';
    document.getElementById('dedupSummary').textContent='将删除 '+d.total_delete+' 条重复记录，合并后保留 '+d.groups.length+' 条';
    document.getElementById('dedupExecBtn').style.display='';
  }catch(e){
    console.error('dedup preview:',e);
    document.getElementById('dedupLoading').style.display='none';
    document.getElementById('dedupResult').style.display='';
    document.getElementById('dedupResult').innerHTML='<div style="text-align:center;padding:30px 0;color:var(--danger);">分析失败: '+escHtml(e.message)+'</div>';
  }
}
function closeDedupModal(){document.getElementById('dedupModal').style.display='none';_dedupGroups=null;}
async function executeDedup(){
  if(!_dedupGroups||!_dedupGroups.length)return;
  const btn=document.getElementById('dedupExecBtn');
  btn.disabled=true;btn.textContent='执行中...';
  try{
    const r=await fetch('/api/knowledge/dedup/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({groups:_dedupGroups})});
    const d=await r.json();
    toast('去重完成：删除 '+d.deleted+' 条，更新 '+d.updated+' 条');
    closeDedupModal();
    openKbBrowser();fetchKbStats();
  }catch(e){toast('去重失败: '+e.message,'error');btn.disabled=false;btn.textContent='确认去重';}
}

// ── 图片粘贴（千问多模态） ──
// ── 图片粘贴 & 拖拽（千问多模态） ──
let _pastedImages=[],_previewIndex=-1;
function handleImagePaste(e){
  const cd=e.clipboardData||(e.originalEvent&&e.originalEvent.clipboardData);
  if(!cd||!cd.files||!cd.files.length)return;
  const f=cd.files[0];
  if(!f.type.startsWith('image/'))return;
  e.preventDefault();
  const reader=new FileReader();
  reader.onload=function(ev){_pastedImages.push({dataUrl:ev.target.result,name:f.name||'paste.png'});renderImageThumbnails();};
  reader.readAsDataURL(f);
}
function handleImageDragOver(e){e.preventDefault();}
function handleImageDrop(e){
  e.preventDefault();
  if(!e.dataTransfer||!e.dataTransfer.files||!e.dataTransfer.files.length)return;
  const files=Array.from(e.dataTransfer.files).filter(f=>f.type.startsWith('image/'));
  if(!files.length)return;
  let loaded=0;
  files.forEach(f=>{
    const reader=new FileReader();
    reader.onload=function(ev){_pastedImages.push({dataUrl:ev.target.result,name:f.name||'drop.png'});loaded++;if(loaded===files.length)renderImageThumbnails();};
    reader.readAsDataURL(f);
  });
}
function removeImage(index){_pastedImages.splice(index,1);renderImageThumbnails();}
function renderImageThumbnails(){
  const scroll=document.getElementById('imageScroll'),ph=document.getElementById('imagePlaceholder');
  document.getElementById('imageCount').textContent=_pastedImages.length;
  ph.style.display=_pastedImages.length?'none':'';
  scroll.querySelectorAll('.img-thumb').forEach(el=>el.remove());
  _pastedImages.forEach((img,i)=>{
    const div=document.createElement('div');
    div.className='img-thumb';
    div.innerHTML='<button class="img-thumb-del" onclick="event.stopPropagation();removeImage('+i+')">✕</button><img src="'+img.dataUrl+'" alt="图片'+(i+1)+'" onclick="openImgPreview('+i+')">';
    scroll.appendChild(div);
  });
}
function openImgPreview(index){_previewIndex=index;updateImgPreview();document.getElementById('imgPreviewModal').style.display='';}
function closeImgPreview(){document.getElementById('imgPreviewModal').style.display='none';_previewIndex=-1;}
function navigateImage(dir){const n=_previewIndex+dir;if(n>=0&&n<_pastedImages.length){_previewIndex=n;updateImgPreview();}}
function updateImgPreview(){
  if(_previewIndex<0||_previewIndex>=_pastedImages.length)return;
  document.getElementById('imgPreviewImg').src=_pastedImages[_previewIndex].dataUrl;
  document.getElementById('imgPreviewCounter').textContent=(_previewIndex+1)+' / '+_pastedImages.length;
  document.getElementById('imgPreviewPrev').style.display=_previewIndex>0?'':'none';
  document.getElementById('imgPreviewNext').style.display=_previewIndex<_pastedImages.length-1?'':'none';
}

(async function init(){
  loadSessions();renderSessionTabs();switchSession(activeSessionId,true);
  await fetchPrompts();applyConfig();
  fetchKbStats();
  document.getElementById('kbUseToggle').checked=localStorage.getItem('tcgen_kb_use')==='true';
  document.getElementById('kbSaveToggle').checked=localStorage.getItem('tcgen_kb_save')==='true';
})();
