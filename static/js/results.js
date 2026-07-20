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

