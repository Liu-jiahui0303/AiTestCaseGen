// ── 生成（流式） ──
let currentStreamAbort=null,fullText='',fullThinking='',kbMatchCount=-1,contentBlockType='';
function showTableLoading(){
  if(document.getElementById('_tableLoading'))return;
  const card=document.getElementById('resultCard');
  card.style.display='flex';
  const ov=document.createElement('div');
  ov.id='_tableLoading';
  ov.style.cssText='position:absolute;inset:0;z-index:10;background:var(--bg);display:flex;align-items:center;justify-content:center;';
  ov.innerHTML='<div style="background:var(--panel-bg);border:2px solid var(--accent);padding:20px 36px;display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;color:var(--text);"><span class="stream-spinner"></span> 正在生成表格...</div>';
  card.appendChild(ov);
}
function hideTableLoading(){
  const ov=document.getElementById('_tableLoading');
  if(ov)ov.remove();
}
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
    try{
      while(true){const{value,done}=await reader.read();if(done)break;
        buf+=decoder.decode(value,{stream:true});
        while(buf.includes('\n\n')){
          const idx=buf.indexOf('\n\n'),line=buf.substring(0,idx);buf=buf.substring(idx+2);
          if(line.startsWith('data: '))try{const ev=JSON.parse(line.substring(6));updateStream(ev,area,block);}catch(e){console.error('SSE parse:',e);}
        }
      }
    }finally{reader.releaseLock();}
  }catch(e){if(e.name!=='AbortError'){console.error('generate:',e);block.innerHTML='<div style="color:var(--danger)">错误: '+escHtml(e.message)+'</div>';}else{aborted=true;}}
  finally{
    document.getElementById('generateBtn').disabled=false;document.getElementById('generateBtn').textContent='▶ 生成测试用例';
    document.getElementById('stopBtn').style.display='none';if(currentStreamAbort===ctrl)currentStreamAbort=null;
    // 保存流式内容到会话（切标签时恢复）
    session._streamHTML=document.getElementById('streamArea').innerHTML;
    // 保存到会话历史
    const um=(prompt&&prompt.user?prompt.user:'请根据以下 PRD 文档，生成完整的测试用例：\n\n{prd_text}').replace('{prd_text}',prd);
    session.messages.push({role:'user',content:um});session.messages.push({role:'assistant',content:fullText});
    if(fullText.trim())lockSessionModel(session,am);
    if(document.getElementById('chatModal').style.display!=='none')rebuildChatHistory();
    // 解析 JSON → 表格 (用户手动停止时跳过)
    if(!aborted){try{
      const jsonStr=extractJson(fullText);
      if(!jsonStr||jsonStr.length<10){hideTableLoading();block.innerHTML=_renderStreamHTML();saveSessions();toastPersist('AI 未返回有效的 JSON 格式，请重新生成','error');return;}
      const data=JSON.parse(jsonStr),tc=data.test_cases||[];
      if(tc.length>0){
        session.testCases=tc;saveSessions();
        document.getElementById('resultCard').style.display='flex';renderTable(tc);renderStats(tc,null);
        hideTableLoading();
        block.innerHTML=_renderStreamHTML()+'<div style="color:var(--accent);font-weight:600;margin-top:8px;">✅ 已生成 '+tc.length+' 条测试用例（下方表格）</div>';
        if(getKbSaveEnabled()&&prd&&prd.length>4){
          setTimeout(()=>saveToKnowledgeBase(session,prd),0);
        }
      }else{hideTableLoading();block.innerHTML=_renderStreamHTML();saveSessions();}
    }catch(e){console.warn('JSON 解析失败:',e.message);hideTableLoading();block.innerHTML=_renderStreamHTML()+'<div style="color:var(--danger);margin-top:6px;">⚠️ AI 返回的 JSON 格式有误，请检查上方原始结果或重试</div>';saveSessions();toastPersist('AI 返回的 JSON 格式有误，请重新生成','error');}}
    else hideTableLoading();
  }
}

let _streamRAF=null;
function updateStream(ev,area,block){
  if(ev.type==='done'){showTableLoading();return;}
  if(ev.type==='session_title'&&ev.title){
    const s=getSession();if(s&&!s._autoRenamed){s.name=ev.title;s._autoRenamed=true;saveSessions();renderSessionTabs();}
    return;
  }
  if(ev.type==='error'){block.innerHTML='<div style="color:var(--danger)">'+escHtml(ev.message||'流式错误')+'</div>';return;}
  if(ev.type==='knowledge'){
    kbMatchCount=ev.matched||0;
    console.log('[KB] 收到知识库事件, matched='+kbMatchCount);
    const badge=block.nextElementSibling;
    if(badge){
      badge.style.display='';
      if(kbMatchCount>0){
        badge.innerHTML='已引用 '+kbMatchCount+' 条历史范例 <span style="font-size:10px;">▶</span>';
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
        badge.textContent='未引用历史范例';
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
    // 必须在改写 DOM 前判断。快速大分片会瞬间增加 scrollHeight，
    // 若更新后再判断，会把原本位于底部误判为用户主动向上滚动。
    const shouldAutoScroll=area.scrollHeight-area.scrollTop-area.clientHeight<60;
    let h='';
    if(fullThinking)h+='<div class="stream-label">💭 思考过程</div><div class="stream-thinking">'+escHtml(fullThinking)+'</div>';
    h+='<div class="stream-label">📄 生成结果</div><div class="stream-text">'+escHtml(fullText)+'</div>';
    if(ev.type!=='done')h=h.replace('</div></div>','<span class="stream-cursor"></span></div></div>');
    block.innerHTML=h;
    if(shouldAutoScroll)area.scrollTop=area.scrollHeight;
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
