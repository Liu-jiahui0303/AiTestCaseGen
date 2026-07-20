// ── 聊天 ──
function openChat(){
  const cfg=loadConfig(),am=getActiveModel(),m=cfg[am]||cfg.dp;if(!m.apiKey){toast('请先配置 API Key','error');return;}
  document.getElementById('chatModelLabel').textContent='模型: '+((MODEL_PRESETS[am]||MODEL_PRESETS.dp).label);
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
  const cfg=loadConfig(),am=getActiveModel(),m=cfg[am]||cfg.dp,ak=m.apiKey||'',bu=m.baseUrl||'',md=m.model||'';
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
    const resp=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:am,api_key:ak,base_url:bu,model:md,messages:session.messages})});
    const data=await resp.json();typingEl.remove();
    if(!resp.ok){appendChatMsg('ai','❌ '+(data.error||'失败'));return;}
    appendChatMsg('ai',data.content||'(空)',data.reasoning);
    session.messages.push({role:'assistant',content:data.content||''});lockSessionModel(session,am);saveSessions();
  }catch(e){typingEl.remove();appendChatMsg('ai','❌ 网络错误: '+e.message);}
  finally{document.getElementById('chatInput').disabled=false;document.getElementById('chatSendBtn').disabled=false;document.getElementById('chatSendBtn').textContent='发送';document.getElementById('chatInput').focus();}
}

