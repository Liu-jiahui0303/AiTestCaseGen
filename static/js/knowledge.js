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
      return '<div class=\"kb-row\" style=\"border-bottom:1px solid var(--section-border);padding:8px 0;display:flex;align-items:flex-start;gap:10px;cursor:pointer;\" onclick=\"toggleKbDetail(event,'+i.id+')\"><div style=\"flex:1;min-width:0;\"><div style=\"font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;\" title=\"'+escHtml(i.prd_summary||'')+'\">'+escHtml(i.prd_summary||'').substring(0,50)+'</div><div style=\"font-size:10px;color:var(--text-dim);margin-top:2px;\">'+escHtml(mods)+' · '+i.case_count+'条用例 · '+i.created_at+'</div></div><button class=\"btn btn-sm btn-danger\" onclick=\"event.stopPropagation();deleteFromKb('+i.id+')\" style=\"flex-shrink:0;\">🗑</button><div class=\"kb-detail-panel\" style=\"display:none;\" onclick=\"event.stopPropagation()\"></div></div>';
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
    let html='<table class="kb-detail-table kb-browser-table">';
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
