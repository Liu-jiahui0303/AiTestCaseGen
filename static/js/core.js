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
function getActiveModel(){
  const c=loadConfig(),s=getSession();
  return (s&&(s.modelKey||s.draftModelKey))||c.activeModel||'dp';
}
function applyConfig(){
  const c=loadConfig(),am=getActiveModel(),m=c[am]||c.dp;
  document.getElementById('modelSelect').value=am;
  document.getElementById('baseUrl').value=m.baseUrl||'';
  document.getElementById('apiKey').value=m.apiKey||'';
  document.getElementById('toolbarModel').textContent=(MODEL_PRESETS[am]||MODEL_PRESETS.dp).label;
  document.getElementById('imageArea').style.display=am==='qwen'?'':'none';
  updateModelLockUI();
  refreshPromptSelect();
}
function saveConfig(){
  const c=loadConfig(),am=getActiveModel();
  c[am].baseUrl=document.getElementById('baseUrl').value.trim();
  c[am].apiKey=document.getElementById('apiKey').value.trim();
  localStorage.setItem(CFG_KEY,JSON.stringify(c));applyConfig();toast('配置已保存');
}
function onModelChange(){
  const c=loadConfig(),s=getSession(),am=document.getElementById('modelSelect').value;
  if(s&&s.modelKey){applyConfig();toast('本会话已绑定模型，如需切换请新建会话','error');return;}
  c.activeModel=am;
  if(!c[am])c[am]={...MODEL_PRESETS[am]};
  if(s)s.draftModelKey=am;
  localStorage.setItem(CFG_KEY,JSON.stringify(c));
  saveSessions();
  document.getElementById('baseUrl').value=c[am].baseUrl||'';
  document.getElementById('apiKey').value=c[am].apiKey||'';
  document.getElementById('toolbarModel').textContent=(MODEL_PRESETS[am]||{}).label||'';
  document.getElementById('imageArea').style.display=am==='qwen'?'':'none';
  updateModelLockUI();
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

