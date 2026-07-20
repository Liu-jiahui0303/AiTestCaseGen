(async function init(){
  loadSessions();renderSessionTabs();switchSession(activeSessionId,true);
  await fetchPrompts();applyConfig();
  fetchKbStats();
  document.getElementById('kbUseToggle').checked=localStorage.getItem('tcgen_kb_use')==='true';
  document.getElementById('kbSaveToggle').checked=localStorage.getItem('tcgen_kb_save')==='true';
})();
