/* ============================================================================
 * mt-inbox.js — de Smart-Inbox-tab van de cockpit (v2.html)
 * ----------------------------------------------------------------------------
 * Afgesplitst uit v2.html (audit 2026-07-02, actie S3). PURE VERPLAATSING:
 * dezelfde functies, hetzelfde gedrag, alleen uit het inline-script geknipt
 * zodat v2.html krimpt. Bevat de live 2-weg info@-mailbox (Graph), de mail-
 * lijst/thread-weergave, verplaatsen+undo, de inbox-agenda en -taken (To Do),
 * de mail↔project-koppeling (localStorage), bijlagen→SharePoint en de per-mail
 * Larry-chat. De GLOBALE topbalk-chat (tbChat*) blijft BEWUST in v2.html — dat
 * is een aparte, tab-overstijgende module, geen onderdeel van de inbox-tab.
 *
 * GEEN build-pipeline en BEWUST GEEN IIFE-wrapper: klassiek
 * <script src="mt-inbox.js?v=..."> dat na mt-core.js/mt-toggl.js laadt (vóór het
 * grote inline-script). De top-level `const`/`let`/`function`-declaraties komen
 * zo in dezelfde gedeelde globale (lexicale) scope als de rest van v2.html —
 * precies waar ze eerst stonden. `function`-declaraties belanden op window
 * (de onclick-handlers in de HTML blijven werken); `const/let` (_inbox,
 * INBOX_DEFAULT, TODO_BASE, _todo, …) zijn cross-script zichtbaar via de
 * gedeelde global-lexical-env. Een IIFE zou die verbergen voor v2.html, dat er
 * wél naar verwijst (o.a. `typeof _inbox` en `mailLinksVoor` in de projecten-
 * en export-code). Daarom bewust plat. Dit bestand voert bij load NIETS uit.
 *
 * AFHANKELIJKHEDEN op globals die elders in v2.html blijven wonen (runtime):
 *   - uit mt-core.js : esc
 *   - Graph/util     : window.getGraphToken, WORKER, claudeCall,
 *                      window.spUploadProjectBytes, window.track, window._LOG
 *   - projecten-laag : PROJECT_CODES, resolveKlantNaam, getAdmin, tbDoTab
 *   - agenda-laag     : (inbox-agenda gebruikt eigen _agMaandag/_ibAg, staat hier)
 *
 * OMGEKEERD gebruikt v2.html deze symbolen uit dit bestand: inboxOpen,
 * inboxSub, inboxReload, inboxReloadBadges, mailLinksVoor, mailLinkInfo,
 * openGekoppeldeMail, _inbox (+ alle onclick-handlers in de inbox-HTML).
 * ========================================================================== */

// ═══════════════════════════════════════════════════════════════════════════
// SMART-INBOX (Fase A) — live 2-weg op de gedeelde info@-mailbox via Graph.
// Bron van waarheid = de live mailbox (geen lokale kopie). Verplaatsen muteert
// direct in Outlook; undo-stack maakt elke move omkeerbaar. NOOIT verwijderen.
// PUBLIC repo: geen mailinhoud/PII wordt opgeslagen of gecommit — alles runtime.
// ═══════════════════════════════════════════════════════════════════════════
const INBOX_DEFAULT='info@mortiseandtenon.nl';
let _inbox={mbx:INBOX_DEFAULT,folderId:null,folderName:'',folders:[],msgs:[],cur:null,undo:null,loaded:false,q:'',nextLink:null,loadingMore:false,threadMode:false,curThread:null};

function ibEsc(s){return esc(s);}   // alias van de canonieke esc() bovenin (was identieke kopie)
function ibBase(){return _inbox.mbx==='me'?'https://graph.microsoft.com/v1.0/me':`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(_inbox.mbx)}`;}
async function ibFetch(path,opts){
  const token=await window.getGraphToken();
  if(!token) throw new Error('niet ingelogd bij Microsoft');
  const o=opts||{};
  const url=/^https?:\/\//.test(path)?path:ibBase()+path;
  const r=await fetch(url,{...o,headers:{'Authorization':`Bearer ${token}`,...(o.headers||{})}});
  if(!r.ok){const t=await r.text().catch(()=>'');const e=new Error('HTTP '+r.status+(t?' '+t.slice(0,160):''));e.status=r.status;throw e;}
  return r.status===204?null:r.json();
}
function ibStatus(m,kleur){const s=document.getElementById('inbox-status');if(s){s.textContent=m;s.style.color=kleur||'var(--text-faint)';}}
function ibFlat(fs){const out=[];(fs||[]).forEach(f=>{out.push(f);(f.children||[]).forEach(c=>out.push(c));});return out;}
function ibFolderName(id){const f=ibFlat(_inbox.folders).find(x=>x.id===id);return f?f.displayName:'';}

function inboxOpen(){ if(!_inbox.loaded) inboxReload(); }

// ── Sub-tabs binnen Inbox: Mail / Agenda / Taken ──
let _ibSub='mail';
function inboxSub(name){
  _ibSub=name;
  document.querySelectorAll('#tab-inbox .inbox-subtab').forEach(b=>b.classList.toggle('actief',b.dataset.sub===name));
  document.querySelectorAll('#tab-inbox .inbox-pane').forEach(p=>p.classList.remove('actief'));
  const pane=document.getElementById('inbox-pane-'+name); if(pane)pane.classList.add('actief');
  if(name==='mail'&&!_inbox.loaded)inboxReload();
  if(name==='agenda')inboxLoadAgenda();
  if(name==='taken')inboxLoadTaken();
}

// ── Agenda — spiegel van de Outlook-kalender (Graph /calendarView, week-overzicht) ──
let _ibAg={weekOffset:0};
function _agMaandag(offset){const d=new Date();const wd=(d.getDay()+6)%7;d.setHours(0,0,0,0);d.setDate(d.getDate()-wd+offset*7);return d;}
function inboxAgendaWeek(delta){_ibAg.weekOffset+=delta;inboxLoadAgenda();}
async function inboxLoadAgenda(){
  const grid=document.getElementById('agenda-grid');if(!grid)return;
  const ma=_agMaandag(_ibAg.weekOffset);
  const zo=new Date(ma);zo.setDate(zo.getDate()+7);
  const lbl=document.getElementById('agenda-weeklabel');
  if(lbl)lbl.textContent=ma.toLocaleDateString('nl-NL',{day:'numeric',month:'short'})+' – '+new Date(zo.getTime()-1).toLocaleDateString('nl-NL',{day:'numeric',month:'short',year:'numeric'});
  grid.innerHTML='<div class="inbox-empty" style="grid-column:1/-1">laden…</div>';
  try{
    const u=`/calendarView?startDateTime=${ma.toISOString()}&endDateTime=${zo.toISOString()}`
      +`&$select=subject,start,end,location,isAllDay&$orderby=start/dateTime&$top=200`;
    const d=await ibFetch(u,{headers:{Prefer:'outlook.timezone="W. Europe Standard Time"'}});
    inboxRenderAgenda(ma,(d&&d.value)||[]);
  }catch(e){grid.innerHTML=`<div class="inbox-empty" style="grid-column:1/-1">agenda laden mislukt: ${ibEsc(e.message)}</div>`;}
}
function inboxRenderAgenda(maandag,evs){
  const grid=document.getElementById('agenda-grid');
  const dagen=['ma','di','wo','do','vr','za','zo'];
  const vandaag=new Date();vandaag.setHours(0,0,0,0);
  const perDag={};
  evs.forEach(ev=>{const s=new Date((ev.start&&ev.start.dateTime)||ev.start);const k=s.toDateString();(perDag[k]=perDag[k]||[]).push(ev);});
  let html='';
  for(let i=0;i<7;i++){
    const d=new Date(maandag);d.setDate(d.getDate()+i);
    const isVandaag=d.getTime()===vandaag.getTime();
    const lijst=(perDag[d.toDateString()]||[]).map(ev=>{
      const s=new Date((ev.start&&ev.start.dateTime)||ev.start);
      const t=ev.isAllDay?'hele dag':s.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'});
      const loc=(ev.location&&ev.location.displayName)?' · '+ibEsc(ev.location.displayName):'';
      return `<div class="agenda-ev${ev.isAllDay?' allday':''}"><div class="t">${t}${loc}</div>${ibEsc(ev.subject||'(geen titel)')}</div>`;
    }).join('')||'<div style="font-size:10px;color:#bbb;padding:6px 8px">—</div>';
    html+=`<div class="agenda-day${isVandaag?' vandaag':''}"><div class="dhdr">${dagen[i]} ${d.getDate()}/${d.getMonth()+1}</div>${lijst}</div>`;
  }
  grid.innerHTML=html;
}

// ── Taken — Microsoft To Do (Graph /me/todo) + 1-op-1 Toggl-taak ──
// To Do is altijd persoonlijk → /me, ongeacht de gekozen mailbox.
const TODO_BASE='https://graph.microsoft.com/v1.0/me/todo';
let _todo={lists:[],listId:null,tasks:[],loaded:false};
async function inboxLoadTaken(){
  const wrap=document.getElementById('taken-body');if(!wrap)return;
  if(!_todo.loaded){
    wrap.innerHTML='<div class="inbox-empty" style="font-size:12px">To Do laden… (eerste keer vraagt Microsoft om toestemming)</div>';
    try{
      const d=await ibFetch(TODO_BASE+'/lists?$top=50');
      _todo.lists=(d&&d.value)||[];
      _todo.loaded=true;
      const def=_todo.lists.find(l=>l.wellknownListName==='defaultList')||_todo.lists[0];
      _todo.listId=def?def.id:null;
    }catch(e){
      wrap.innerHTML=`<div class="inbox-empty" style="font-size:12.5px;line-height:1.5">To Do laden mislukt: ${ibEsc(e.message)}`
        +`${e.status===403?'<br><br>Toestemming nog niet verleend — herlaad de pagina (Ctrl+Shift+R) en log opnieuw in; klik dan op "Toestaan".':''}</div>`;
      return;
    }
  }
  inboxRenderTakenShell();
  inboxLoadTodoTasks();
}
function inboxRenderTakenShell(){
  const wrap=document.getElementById('taken-body');if(!wrap)return;
  const opts=_todo.lists.map(l=>`<option value="${l.id}"${l.id===_todo.listId?' selected':''}>${ibEsc(l.displayName)}</option>`).join('');
  wrap.innerHTML=`
    <div class="agenda-toolbar">
      <select id="todo-list" onchange="todoSwitchList(this.value)" style="font-size:13px;padding:5px 8px;border:1px solid var(--border,#ddd);border-radius:6px;background:#fff">${opts||'<option>geen lijsten</option>'}</select>
      <button class="btn btn-sm btn-secondary" onclick="inboxLoadTodoTasks()" title="Vernieuwen">⟳</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:12px;align-items:center;flex-wrap:wrap">
      <input id="todo-new" type="text" placeholder="Nieuwe taak…" style="flex:1;min-width:170px;height:32px;padding:0 10px;border:1px solid var(--border,#ddd);border-radius:7px;font-size:13px" onkeydown="if(event.key==='Enter')todoAdd()">
      <label style="font-size:12px;display:flex;align-items:center;gap:4px;white-space:nowrap"><input type="checkbox" id="todo-toggl" checked> ook in Toggl</label>
      <button class="btn btn-sm btn-gold" onclick="todoAdd()">+ Taak</button>
    </div>
    <div id="todo-list-body"></div>`;
}
function todoSwitchList(id){_todo.listId=id;inboxLoadTodoTasks();}
async function inboxLoadTodoTasks(){
  const body=document.getElementById('todo-list-body');if(!body)return;
  if(!_todo.listId){body.innerHTML='<div class="inbox-empty" style="font-size:12px">geen lijst gekozen</div>';return;}
  body.innerHTML='<div class="inbox-empty" style="font-size:12px">laden…</div>';
  try{
    const d=await ibFetch(`${TODO_BASE}/lists/${_todo.listId}/tasks?$top=100&$orderby=createdDateTime desc`);
    _todo.tasks=(d&&d.value)||[];
    // openstaand bovenaan, afgevinkt onderaan
    _todo.tasks.sort((a,b)=>(a.status==='completed'?1:0)-(b.status==='completed'?1:0));
    body.innerHTML=_todo.tasks.length?_todo.tasks.map(todoRow).join(''):'<div class="inbox-empty" style="font-size:12px">geen taken</div>';
  }catch(e){body.innerHTML=`<div class="inbox-empty" style="font-size:12px">fout: ${ibEsc(e.message)}</div>`;}
}
function todoRow(t){
  const done=t.status==='completed';
  const due=(t.dueDateTime&&t.dueDateTime.dateTime)?new Date(t.dueDateTime.dateTime).toLocaleDateString('nl-NL',{day:'numeric',month:'short'}):'';
  const imp=t.importance==='high'?'<span title="hoog" style="color:#c0392b">‼</span> ':'';
  return `<div style="display:flex;align-items:center;gap:10px;padding:8px 6px;border-bottom:1px solid #f0f0f0">
    <input type="checkbox" ${done?'checked':''} onchange="todoToggle('${t.id}',this.checked)" style="width:17px;height:17px;cursor:pointer;flex:0 0 auto">
    <span style="flex:1;font-size:13px;${done?'text-decoration:line-through;color:#aaa':''}">${imp}${ibEsc(t.title||'(geen titel)')}</span>
    ${due?`<span style="font-size:11px;color:var(--text-faint,#999);white-space:nowrap">📅 ${due}</span>`:''}
  </div>`;
}
async function todoToggle(id,checked){
  try{
    await ibFetch(`${TODO_BASE}/lists/${_todo.listId}/tasks/${id}`,
      {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:checked?'completed':'notStarted'})});
    inboxToast(checked?'Taak afgevinkt':'Taak heropend');
  }catch(e){alert('Lukt niet: '+e.message);inboxLoadTodoTasks();}
}
async function todoAdd(){
  const inp=document.getElementById('todo-new');if(!inp)return;
  const titel=(inp.value||'').trim();if(!titel)return;
  if(!_todo.listId){alert('Geen To Do-lijst gevonden.');return;}
  const ookToggl=document.getElementById('todo-toggl').checked;
  inp.disabled=true;
  try{
    await ibFetch(`${TODO_BASE}/lists/${_todo.listId}/tasks`,
      {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:titel})});
    let extra='';
    if(ookToggl){
      try{ const made=await focusFetch('tasks','POST',{name:titel,status_id:300785});
        const tid=made&&(made.id||(made.data&&made.data.id));
        extra=' + Toggl'+(tid?(' (#'+tid+')'):''); }
      catch(e){ extra=' — Toggl mislukt: '+e.message; }
    }
    inp.value='';
    inboxToast('Taak toegevoegd'+extra);
    inboxLoadTodoTasks();
  }catch(e){alert('Taak aanmaken mislukt: '+e.message);}
  finally{inp.disabled=false;}
}

function inboxSwitchMbx(v){
  _inbox.mbx=v;_inbox.loaded=false;_inbox.folderId=null;_inbox.cur=null;
  document.getElementById('inbox-messages').innerHTML='';
  document.getElementById('inbox-readbody').innerHTML='<div class="inbox-empty">Kies links een mail om te lezen.</div>';
  document.getElementById('inbox-chatwrap').style.display='none';
  inboxReload();
}

async function inboxReload(){
  ibStatus('Mappen laden…');
  const tree=document.getElementById('inbox-foldertree');
  try{
    const data=await ibFetch('/mailFolders?$top=100&$select=id,displayName,childFolderCount,unreadItemCount,totalItemCount');
    let folders=(data&&data.value)||[];
    for(const f of folders.filter(x=>x.childFolderCount>0)){
      try{const c=await ibFetch(`/mailFolders/${f.id}/childFolders?$top=100&$select=id,displayName,unreadItemCount`);f.children=(c&&c.value)||[];}catch(e){f.children=[];}
    }
    _inbox.folders=folders;_inbox.loaded=true;
    inboxRenderTree();
    const inbox=ibFlat(folders).find(f=>/^(inbox|postvak in)$/i.test(f.displayName))||folders[0];
    if(inbox) inboxOpenFolder(inbox.id,inbox.displayName);
    ibStatus(`${_inbox.mbx} · ${ibFlat(folders).length} mappen`);
  }catch(e){
    _inbox.loaded=false;
    let hint='';
    if(e.status===403){hint=_inbox.mbx==='me'?'Geen toegang tot je postbus.':'Geen toegang tot info@. Je account heeft "Volledige toegang" op info@ nodig in Exchange — of kies rechtsboven je eigen postbus.';}
    else if(/niet ingelogd/.test(e.message)) hint='Log eerst in bij Microsoft.';
    else if(e.status===401) hint='Sessie verlopen — herlaad de pagina en log opnieuw in.';
    tree.innerHTML=`<div class="inbox-empty" style="padding:1rem;font-size:12px">⚠ Mappen laden mislukt.<br>${ibEsc(e.message)}<br><br>${ibEsc(hint)}</div>`;
    ibStatus('Fout: '+e.message,'#c0392b');
  }
}

function inboxRenderTree(){
  const el=document.getElementById('inbox-foldertree');
  const row=(f,kind)=>{
    const act=f.id===_inbox.folderId?' actief':'';
    const b=f.unreadItemCount?`<span class="badge">${f.unreadItemCount}</span>`:'';
    return `<div class="inbox-fold${kind?' kind':''}${act}" onclick="inboxOpenFolder('${f.id}','${ibEsc(f.displayName).replace(/'/g,'')}')"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ibEsc(f.displayName)}</span>${b}</div>`;
  };
  el.innerHTML=_inbox.folders.map(f=>row(f,false)+(f.children||[]).map(c=>row(c,true)).join('')).join('')||'<div class="inbox-empty" style="font-size:12px">geen mappen</div>';
}

function inboxOpenFolder(id,name){
  _inbox.folderId=id;_inbox.folderName=name;_inbox.q='';_inbox.curThread=null;
  const sb=document.getElementById('inbox-search');if(sb)sb.value='';
  document.getElementById('inbox-listtitle').textContent=name;
  inboxRenderTree();
  inboxLoadMessages();
}
function inboxMsgUrl(){
  const sel='id,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview,parentFolderId,conversationId';
  // Zoeken = HELE postbus (alle mappen, ook body) net als Outlook-zoeken.
  // Geen zoekterm = alleen de geopende map, op datum gesorteerd.
  if(_inbox.q){
    return `/messages?$top=50&$select=${sel}&$search=`+encodeURIComponent('"'+_inbox.q.replace(/"/g,'')+'"');
  }
  return `/mailFolders/${_inbox.folderId}/messages?$top=50&$select=${sel}&$orderby=receivedDateTime desc`;
}
async function inboxLoadMessages(){
  const cont=document.getElementById('inbox-messages');
  cont.innerHTML='<div class="inbox-empty" style="font-size:12px">laden…</div>';
  _inbox.nextLink=null;_inbox.msgs=[];_inbox.loadingMore=false;
  const titel=document.getElementById('inbox-listtitle');
  if(titel)titel.textContent=_inbox.q?`🔍 "${_inbox.q}" · hele postbus`:_inbox.folderName;
  try{
    const d=await ibFetch(inboxMsgUrl());
    _inbox.msgs=(d&&d.value)||[];
    _inbox.nextLink=(d&&d['@odata.nextLink'])||null;
    inboxRenderList();
  }catch(e){cont.innerHTML=`<div class="inbox-empty" style="font-size:12px">fout: ${ibEsc(e.message)}</div>`;}
}
// Eén render-pad voor de berichtenlijst — respecteert de gespreksmodus (threadMode).
// READ-ONLY: groepeert alleen wat al geladen is op conversationId; geen mutaties.
function inboxRenderList(){
  const cont=document.getElementById('inbox-messages');if(!cont)return;
  if(!_inbox.msgs.length){
    cont.innerHTML=`<div class="inbox-empty" style="font-size:12px">${_inbox.q?'geen resultaten':'geen berichten'}</div>`;return;
  }
  if(_inbox.threadMode){
    cont.innerHTML=inboxGroupThreads(_inbox.msgs).map(inboxThreadRow).join('');
  }else{
    cont.innerHTML=_inbox.msgs.map(inboxMsgRow).join('');
  }
}
// Groepeer geladen berichten op conversationId; nieuwste per gesprek bovenaan.
// Berichten zonder conversationId vallen terug op hun eigen id (één-bericht-thread).
function inboxGroupThreads(msgs){
  const map=new Map();
  for(const m of msgs){
    const cid=m.conversationId||('solo:'+m.id);
    let g=map.get(cid);
    if(!g){g={cid,items:[],newest:m};map.set(cid,g);}
    g.items.push(m);
    if(new Date(m.receivedDateTime||0)>new Date(g.newest.receivedDateTime||0))g.newest=m;
  }
  const groups=[...map.values()];
  groups.sort((a,b)=>new Date(b.newest.receivedDateTime||0)-new Date(a.newest.receivedDateTime||0));
  return groups;
}
async function inboxMaybeMore(){
  if(!_inbox.nextLink||_inbox.loadingMore)return;
  const col=document.getElementById('inbox-listcol');
  if(!col||col.scrollTop+col.clientHeight<col.scrollHeight-140)return;
  _inbox.loadingMore=true;
  const cont=document.getElementById('inbox-messages');
  const ld=document.createElement('div');ld.className='inbox-empty';ld.style.cssText='font-size:11px;padding:10px';ld.textContent='meer laden…';
  cont.appendChild(ld);
  try{
    const d=await ibFetch(_inbox.nextLink);
    const more=(d&&d.value)||[];
    _inbox.nextLink=(d&&d['@odata.nextLink'])||null;
    _inbox.msgs=_inbox.msgs.concat(more);
    ld.remove();
    if(more.length){
      // In gespreksmodus kan een nieuw bericht bij een bestaand gesprek horen →
      // hele lijst opnieuw groeperen i.p.v. los appenden. Anders gewoon appenden.
      if(_inbox.threadMode){inboxRenderList();}
      else cont.insertAdjacentHTML('beforeend',more.map(inboxMsgRow).join(''));
    }
  }catch(e){ld.textContent='meer laden mislukt: '+e.message;}
  _inbox.loadingMore=false;
  // ketting: vul de viewport als er nog ruimte is
  if(_inbox.nextLink){const col2=document.getElementById('inbox-listcol');if(col2&&col2.scrollHeight<=col2.clientHeight+140)inboxMaybeMore();}
}
let _ibSearchT=null;
function inboxSearchInput(){
  const sb=document.getElementById('inbox-search');if(!sb)return;
  const v=(sb.value||'').trim();
  clearTimeout(_ibSearchT);
  _ibSearchT=setTimeout(()=>{if(v===_inbox.q)return;_inbox.q=v;inboxLoadMessages();},350);
}
function inboxMsgRow(m){
  const van=(m.from&&m.from.emailAddress&&(m.from.emailAddress.name||m.from.emailAddress.address))||'(onbekend)';
  const dt=m.receivedDateTime?new Date(m.receivedDateTime).toLocaleString('nl-NL',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
  const clip=m.hasAttachments?' 📎':'';
  const act=m.id===(_inbox.cur&&_inbox.cur.id)?' actief':'';
  const fnaam=(_inbox.q&&m.parentFolderId)?ibFolderName(m.parentFolderId):'';
  const fchip=fnaam?`<span style="font-size:10px;color:#777;background:rgba(0,0,0,.06);border-radius:3px;padding:0 4px;margin-left:6px;white-space:nowrap">${ibEsc(fnaam)}</span>`:'';
  const link=(typeof mailLinkInfo==='function')?mailLinkInfo(m):null;
  const kpcls=link?' gekoppeld':'';
  const kpchip=link?`<span class="kpchip" title="Gekoppeld aan project ${ibEsc(link.code)}">🔗 ${ibEsc(link.code)}</span>`:'';
  return `<div class="inbox-msg${m.isRead?'':' ongelezen'}${kpcls}${act}" onclick="inboxOpenMail('${m.id}')">
    <div class="van"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ibEsc(van)}</span><span class="dt">${dt}</span></div>
    <div class="onderw">${ibEsc(m.subject||'(geen onderwerp)')}${clip}${kpchip}${fchip}</div>
    <div class="prev">${ibEsc(m.bodyPreview||'')}</div></div>`;
}

// ── Gespreksmodus (conversation-threading), READ-ONLY ──────────────────────
function inboxToggleThread(on){
  _inbox.threadMode=!!on;
  inboxRenderList();
  try{ if(window.track) track('action','inbox_threadmode',{detail:on?'on':'off',ok:true}); }catch(e){}
}
// Rij voor één gesprek: toont het nieuwste bericht + een teller (#berichten).
// Klik opent de hele gesprekweergave in het leesvenster.
function inboxThreadRow(g){
  const m=g.newest;
  const van=(m.from&&m.from.emailAddress&&(m.from.emailAddress.name||m.from.emailAddress.address))||'(onbekend)';
  const dt=m.receivedDateTime?new Date(m.receivedDateTime).toLocaleString('nl-NL',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
  const anyClip=g.items.some(x=>x.hasAttachments)?' 📎':'';
  const anyUnread=g.items.some(x=>!x.isRead);
  const act=(_inbox.curThread&&_inbox.curThread===g.cid)?' actief':'';
  const count=g.items.length>1?`<span class="thrcount" title="${g.items.length} berichten in dit gesprek">${g.items.length}</span>`:'';
  const link=(typeof mailLinkInfo==='function')?mailLinkInfo(m):null;
  const kpcls=link?' gekoppeld':'';
  const kpchip=link?`<span class="kpchip" title="Gekoppeld aan project ${ibEsc(link.code)}">🔗 ${ibEsc(link.code)}</span>`:'';
  const onderw=_ibOnderwerpSchoon(m.subject||'')||'(geen onderwerp)';
  return `<div class="inbox-msg${anyUnread?' ongelezen':''}${kpcls}${act}" onclick="inboxOpenThread('${ibEsc(g.cid).replace(/'/g,"\\'")}','${m.id}')">
    <div class="van"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ibEsc(van)}</span><span class="dt">${dt}</span></div>
    <div class="onderw">${ibEsc(onderw)}${anyClip}${count}${kpchip}</div>
    <div class="prev">${ibEsc(m.bodyPreview||'')}</div></div>`;
}
// Open de volledige gesprekweergave. Haalt alle berichten van het gesprek op
// over de héle postbus ($filter op conversationId) — read-only, Mail.Read.
async function inboxOpenThread(cid,fallbackId){
  _inbox.curThread=cid;_inbox.cur=null;
  const rb=document.getElementById('inbox-readbody');
  rb.classList.add('inbox-empty');rb.textContent='gesprek laden…';
  document.getElementById('inbox-chatwrap').style.display='none';
  inboxRenderList();
  try{
    let items=[];
    if(cid&&cid.indexOf('solo:')!==0){
      const sel='id,subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments,isRead,webLink';
      const d=await ibFetch(`/messages?$filter=`+encodeURIComponent("conversationId eq '"+cid.replace(/'/g,"''")+"'")+`&$select=${sel}&$top=50`);
      items=(d&&d.value)||[];
    }
    if(!items.length){
      // Geen treffer via filter (of solo-thread) → val terug op het ene bericht.
      return inboxOpenMail(fallbackId);
    }
    // Oudste → nieuwste, zoals Outlook een gesprek toont.
    items.sort((a,b)=>new Date(a.receivedDateTime||0)-new Date(b.receivedDateTime||0));
    inboxRenderThread(items);
  }catch(e){
    rb.classList.add('inbox-empty');rb.textContent='Gesprek laden mislukt: '+e.message;
  }
}
function inboxRenderThread(items){
  const rb=document.getElementById('inbox-readbody');
  rb.classList.remove('inbox-empty');
  const titel=_ibOnderwerpSchoon(items[items.length-1].subject||'')||'(geen onderwerp)';
  const head=`<div class="inbox-rhdr"><h3>💬 ${ibEsc(titel)}</h3>
    <div class="inbox-rmeta"><span>${items.length} berichten in dit gesprek</span></div></div>`;
  const blocks=items.map((m,i)=>{
    const van=(m.from&&m.from.emailAddress)?`${m.from.emailAddress.name||''} <${m.from.emailAddress.address||''}>`:'(onbekend)';
    const dt=m.receivedDateTime?new Date(m.receivedDateTime).toLocaleString('nl-NL'):'';
    const clip=m.hasAttachments?' 📎':'';
    const fid=`ibthr-${i}`;
    return `<div class="inbox-thread-item">
      <div class="inbox-thread-hdr"><span><b>${ibEsc(van)}</b>${clip}</span><span>${dt}</span></div>
      <div class="inbox-thread-body"><button class="btn btn-sm btn-secondary" style="margin:8px 11px" onclick="inboxThreadExpand('${m.id}','${fid}')">📖 Volledig bericht openen</button>
        <div style="padding:0 11px 10px;font-size:12.5px;color:var(--text-dim,#666)">${ibEsc(m.bodyPreview||'')}</div>
        <div id="${fid}"></div></div>
    </div>`;
  }).join('');
  rb.innerHTML=head+`<div style="padding:10px 0">${blocks}</div>`;
}
// Lazy-load de volledige HTML-body van één bericht binnen de gesprekweergave.
async function inboxThreadExpand(id,slot){
  const host=document.getElementById(slot);if(!host)return;
  if(host.dataset.loaded){host.innerHTML='';host.dataset.loaded='';return;}
  host.innerHTML='<div style="padding:0 11px 8px;font-size:12px;color:#999">laden…</div>';
  try{
    const m=await ibFetch(`/messages/${id}?$select=id,body,bodyPreview`);
    const isHtml=m.body&&m.body.contentType&&/html/i.test(m.body.contentType);
    const content=(m.body&&m.body.content)||m.bodyPreview||'';
    const frame=document.createElement('iframe');
    frame.setAttribute('sandbox','');frame.setAttribute('referrerpolicy','no-referrer');
    host.innerHTML='';host.appendChild(frame);
    frame.srcdoc=isHtml?content:`<pre style="white-space:pre-wrap;font-family:system-ui,sans-serif;font-size:13px;padding:10px">${ibEsc(content)}</pre>`;
    host.dataset.loaded='1';
  }catch(e){host.innerHTML=`<div style="padding:0 11px 8px;font-size:12px;color:#c0392b">openen mislukt: ${ibEsc(e.message)}</div>`;}
}

async function inboxOpenMail(id){
  const rb=document.getElementById('inbox-readbody');
  rb.classList.add('inbox-empty');rb.textContent='laden…';
  try{
    const m=await ibFetch(`/messages/${id}?$select=id,subject,from,toRecipients,receivedDateTime,body,bodyPreview,hasAttachments,webLink,internetMessageId`);
    _inbox.cur=m;_inbox.curThread=null;
    inboxRenderMsgListActief();
    let att=[];
    if(m.hasAttachments){try{const a=await ibFetch(`/messages/${id}/attachments?$select=id,name,size,contentType`);att=(a&&a.value)||[];}catch(e){}}
    const van=(m.from&&m.from.emailAddress)?`${m.from.emailAddress.name||''} <${m.from.emailAddress.address||''}>`:'(onbekend)';
    const dt=m.receivedDateTime?new Date(m.receivedDateTime).toLocaleString('nl-NL'):'';
    const folderOpts=ibFlat(_inbox.folders).filter(f=>f.id!==_inbox.folderId)
      .map(f=>`<option value="${f.id}">${ibEsc(f.displayName)}</option>`).join('');
    const attHtml=att.length?('<div style="margin-top:8px">'+att.map(a=>`<span class="inbox-att" onclick="inboxAtt('${m.id}','${a.id}','${ibEsc(a.name).replace(/'/g,'')}')">📎 ${ibEsc(a.name)} <span style="color:#999">(${Math.round((a.size||0)/1024)} kB)</span></span>`).join('')+'</div>'):'';
    rb.classList.remove('inbox-empty');
    rb.innerHTML=`<div class="inbox-rhdr">
        <h3>${ibEsc(m.subject||'(geen onderwerp)')}</h3>
        <div class="inbox-rmeta"><span><b>Van:</b> ${ibEsc(van)}</span><span>${dt}</span></div>
        ${attHtml}
        <div class="inbox-ract">
          <button class="btn btn-sm btn-gold" onclick="inboxMaakProject()">📁 Maak project</button>
          <button class="btn btn-sm btn-primary" onclick="inboxMaakOfferte()" title="Maak een offerte-calculatie met deze mail als context (klant voor-ingevuld als herkend)">📄 Maak offerte</button>
          <span id="inbox-koppelwrap">${inboxKoppelKnopHtml(m)}</span>
          <button class="btn btn-sm btn-secondary" onclick="inboxBijlagenNaarMap()" title="Bijlagen van deze mail naar de map van het gekoppelde project (05_Aangeleverd)">⬇ Bijlagen → projectmap</button>
        </div>
        <div class="inbox-ract" style="margin-top:6px">
          <label style="font-size:11px;color:var(--text-dim)">Verplaats in Outlook:</label>
          <select id="inbox-moveto"><option value="">— kies map —</option>${folderOpts}</select>
          <button class="btn btn-sm btn-secondary" onclick="inboxMove(document.getElementById('inbox-moveto').value)">Verplaats</button>
          <a href="${ibEsc(m.webLink||'#')}" target="_blank" class="btn btn-sm btn-secondary" style="text-decoration:none">↗ Outlook</a>
        </div>
      </div>
      <iframe class="inbox-body" id="inbox-bodyframe" sandbox="" referrerpolicy="no-referrer"></iframe>`;
    const frame=document.getElementById('inbox-bodyframe');
    const isHtml=m.body&&m.body.contentType&&/html/i.test(m.body.contentType);
    const content=(m.body&&m.body.content)||m.bodyPreview||'';
    frame.srcdoc=isHtml?content:`<pre style="white-space:pre-wrap;font-family:system-ui,sans-serif;font-size:13px;padding:10px">${ibEsc(content)}</pre>`;
    inboxChatReset();
  }catch(e){
    rb.classList.add('inbox-empty');rb.textContent='Mail laden mislukt: '+e.message;
  }
}
function inboxRenderMsgListActief(){
  document.querySelectorAll('#inbox-messages .inbox-msg').forEach(el=>el.classList.remove('actief'));
  // hermarkeren gebeurt bij volgende render; lichte aanpak: niets zwaars nodig
}

async function inboxAtt(mailId,attId,naam){
  try{
    ibStatus('Bijlage ophalen…');
    const a=await ibFetch(`/messages/${mailId}/attachments/${attId}`);
    if(a&&a.contentBytes){
      const bin=atob(a.contentBytes);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
      const blob=new Blob([arr],{type:a.contentType||'application/octet-stream'});
      const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=naam||a.name||'bijlage';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),4000);
      ibStatus('Bijlage gedownload');
    }else ibStatus('Bijlage heeft geen inhoud','#c0392b');
  }catch(e){ibStatus('Bijlage-fout: '+e.message,'#c0392b');}
}

// ── Verplaatsen (mutatie) — confirm-gated, met undo. Eén mail per keer, geen bulk.
async function inboxMove(targetId){
  if(!_inbox.cur||!targetId){if(!targetId)alert('Kies eerst een doelmap.');return;}
  const m=_inbox.cur,from=_inbox.folderId;
  const naar=ibFlat(_inbox.folders).find(f=>f.id===targetId);
  if(!confirm(`Mail "${m.subject||'(geen onderwerp)'}" verplaatsen naar "${naar?naar.displayName:'?'}"?`)) return;
  try{
    const moved=await ibFetch(`/messages/${m.id}/move`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({destinationId:targetId})});
    _inbox.undo={id:(moved&&moved.id)||m.id,to:from,subject:m.subject};
    _inbox.cur=null;
    document.getElementById('inbox-readbody').className='inbox-empty';
    document.getElementById('inbox-readbody').innerHTML='<div class="inbox-empty">Mail verplaatst.</div>';
    document.getElementById('inbox-chatwrap').style.display='none';
    inboxLoadMessages();inboxReloadBadges();
    inboxToast(`Verplaatst naar ${naar?naar.displayName:'map'}`);
    try{ if(window.track) track('action','inbox_move',{ok:true}); }catch(e){}
  }catch(e){alert('Verplaatsen mislukt: '+e.message+(e.status===403?'\n\n(Mail.ReadWrite-toestemming nog niet verleend? Log opnieuw in.)':''));
    try{ if(window.track) track('action','inbox_move',{detail:'status_'+(e.status||'?'),ok:false}); }catch(_){}
  }
}
async function inboxUndo(){
  if(!_inbox.undo)return;const u=_inbox.undo;_inbox.undo=null;
  document.getElementById('inbox-toast').style.display='none';
  try{await ibFetch(`/messages/${u.id}/move`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({destinationId:u.to})});
    inboxLoadMessages();ibStatus('Verplaatsing ongedaan gemaakt');}
  catch(e){alert('Ongedaan maken mislukt: '+e.message);}
}
let _ibToastT=null;
function inboxToast(msg){
  const t=document.getElementById('inbox-toast');document.getElementById('inbox-toast-msg').textContent=msg;
  t.style.display='flex';clearTimeout(_ibToastT);_ibToastT=setTimeout(()=>{t.style.display='none';},9000);
}
async function inboxReloadBadges(){
  try{const data=await ibFetch('/mailFolders?$top=100&$select=id,displayName,childFolderCount,unreadItemCount');
    const map={};((data&&data.value)||[]).forEach(f=>map[f.id]=f.unreadItemCount);
    _inbox.folders.forEach(f=>{if(map[f.id]!=null)f.unreadItemCount=map[f.id];});inboxRenderTree();}catch(e){}
}

function ibAutoGrow(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px';}

// ── Knoppen die de inbox "smart" maken — volle uitwerking in ultra-vervolg.
//    (mail→project-tag, namen-generator+map-gen, bijlagen→klantmap). Nu stubs
//    die de affordance tonen en niets breken; spec in tool-restyle-en-features-OPDRACHT.md
// Bron-mail waaruit het huidige open project-modal is voorgevuld (device-lokaal,
// geen PII in repo). Wordt na aanmaken automatisch aan het project gekoppeld.
let _ibProjBron=null;
// Klant herkennen uit het afzender-domein: match tegen de verrijkte registry
// (655 records met e-mail). Leveranciers uitgesloten. null = geen treffer.
function _ibKlantUitMail(m){
  const adr=((m&&m.from&&m.from.emailAddress&&m.from.emailAddress.address)||'').toLowerCase();
  const dom=adr.split('@')[1]||''; if(!dom) return null;
  return KLANTEN_VOL.find(k=>k.soort!=='leverancier'&&k.email&&k.email.toLowerCase().split('@')[1]===dom)||null;
}
// Onderwerp opschonen: Re:/Fw:-prefixen weg (max 2 lagen), trimmen.
function _ibOnderwerpSchoon(s){
  return (s||'')
    .replace(/^\s*(re|fw|fwd|antw|aw)\s*:\s*/gi,'')
    .replace(/^\s*(re|fw|fwd|antw|aw)\s*:\s*/gi,'')
    .trim();
}
function inboxMaakProject(){
  if(!_inbox.cur){alert('Open eerst een mail.');return;}
  const m=_inbox.cur;
  const kv=_ibKlantUitMail(m);
  const onderw=_ibOnderwerpSchoon(m.subject||'');
  tbDoTab&&tbDoTab('projecten');
  openModal();   // wist de velden + _ibProjBron
  // Onthoud de bron-mail zodat het project er straks aan gekoppeld wordt.
  _ibProjBron={id:m.id,internetMessageId:m.internetMessageId||'',subject:m.subject||'',
    from:(m.from&&m.from.emailAddress)?(m.from.emailAddress.name||m.from.emailAddress.address):'',
    date:m.receivedDateTime||'',webLink:m.webLink||'',mbx:_inbox.mbx};
  const nk=document.getElementById('modal-naam-klant'); if(nk) nk.value=kv?kv.naam:'';
  const np=document.getElementById('modal-naam-product'); if(np) np.value=onderw.slice(0,60);
  autoCode(true);   // leidt code-segmenten af (registry-klant → vaste code)
  const st=document.getElementById('modal-status');
  if(st){
    st.style.color='var(--text-dim)';
    st.textContent=kv
      ? `Klant herkend uit ${m.from.emailAddress.address}: ${kv.naam}. Vul de locatie aan en controleer de code.`
      : `Afzender niet in klant-registry — vul de klantnaam zelf in.`;
  }
}
// ── Mail ↔ project-koppeling (localStorage, device-lokaal; géén PII in repo) ──
function mailLinksAll(){try{return JSON.parse(localStorage.getItem('mt_mail_links')||'{}');}catch(e){return {};}}
function mailLinksSave(o){localStorage.setItem('mt_mail_links',JSON.stringify(o));}
function mailLinksVoor(code){return mailLinksAll()[code]||[];}

// Is deze mail al aan een project gekoppeld? → {code, entry} of null.
function mailLinkInfo(m){
  if(!m) return null;
  const imid=m.internetMessageId||m.id;
  const all=mailLinksAll();
  for(const code in all){
    const hit=(all[code]||[]).find(x=>(x.internetMessageId||x.id)===imid || x.id===m.id);
    if(hit) return {code, entry:hit};
  }
  return null;
}

// Knop-HTML afhankelijk van koppel-status. Gekoppeld = groen ("schakel dicht"),
// klik = ontkoppelen (met waarschuwing). Niet gekoppeld = grijs, klik = koppelen.
function inboxKoppelKnopHtml(m){
  const info=mailLinkInfo(m);
  if(info){
    const c=ibEsc(info.code).replace(/'/g,'');
    return `<button class="btn btn-sm" id="inbox-naarproject" onclick="inboxNaarProject('${c}')"`
      +` style="background:var(--green,#2e7d32);color:#fff;border-color:transparent"`
      +` title="Open project ${ibEsc(info.code)}">📁 ${ibEsc(info.code)} →</button>`
      +` <button class="btn btn-sm btn-secondary" id="inbox-koppelknop" onclick="inboxOntkoppelHuidige()"`
      +` title="Ontkoppelen of wijzigen">🔗 ✕</button>`;
  }
  return `<button class="btn btn-sm btn-secondary" id="inbox-koppelknop" onclick="inboxKoppelProject()">🔗 Koppel aan project</button>`;
}
// Vanuit de geopende mail door naar het gekoppelde project (Projecten-tab).
function inboxNaarProject(code){
  try{ if(window.track) track('inbox','naar_project',{detail:code}); }catch(e){}
  if(typeof tgNaarVolledigProject==='function'){ tgNaarVolledigProject(code); return; }
  if(typeof tbDoTab==='function') tbDoTab('projecten');
}

// Ververst alleen de koppel-knop in de geopende mail (na (ont)koppelen).
function inboxRefreshKoppelKnop(){
  const w=document.getElementById('inbox-koppelwrap');
  if(w&&_inbox.cur){w.innerHTML=inboxKoppelKnopHtml(_inbox.cur);}
  else{const b=document.getElementById('inbox-koppelknop');if(b&&_inbox.cur)b.outerHTML=inboxKoppelKnopHtml(_inbox.cur);}
  // Lijst-rij(en) opnieuw tekenen zodat de 🔗-chip + tint meteen kloppen.
  // Via het centrale render-pad zodat ook de gespreksmodus correct blijft.
  if(Array.isArray(_inbox.msgs)&&_inbox.msgs.length){ inboxRenderList(); }
}

// Ontkoppelen of wijzigen — altijd eerst waarschuwen.
function inboxOntkoppelHuidige(){
  const m=_inbox.cur; if(!m) return;
  const info=mailLinkInfo(m); if(!info){ inboxKoppelProject(); return; }
  const keuze=confirm('⚠️ Let op — deze mail is gekoppeld aan project '+info.code+'.\n\n'
    +'OK = koppeling verbreken (ontkoppelen).\n'
    +'Annuleren = laten zoals het is.\n\n'
    +'(De mail zelf blijft gewoon in Outlook staan.)');
  if(!keuze) return;
  const all=mailLinksAll();
  const imid=m.internetMessageId||m.id;
  all[info.code]=(all[info.code]||[]).filter(x=>!((x.internetMessageId||x.id)===imid || x.id===m.id));
  if(!all[info.code].length) delete all[info.code];
  mailLinksSave(all);
  inboxToast('Koppeling met '+info.code+' verbroken');
  inboxRefreshKoppelKnop();
  if(typeof huidigProject!=='undefined'&&huidigProject&&huidigProject.code===info.code&&typeof renderProjectDetail==='function')renderProjectDetail(huidigProject);
}

function inboxKoppelProject(){
  if(!_inbox.cur){alert('Open eerst een mail.');return;}
  if(!PROJECT_CODES.length){alert('Er zijn nog geen projecten om aan te koppelen.');return;}
  const oud=document.getElementById('koppel-overlay');if(oud)oud.remove();
  const ov=document.createElement('div');ov.id='koppel-overlay';
  ov.style.cssText='position:fixed;inset:0;background:rgba(28,26,22,.45);z-index:10000;display:flex;align-items:center;justify-content:center';
  ov.onclick=e=>{if(e.target===ov)ov.remove();};
  const lijst=PROJECT_CODES.map(p=>`<div class="kp-row" data-zoek="${ibEsc((p.code+' '+(p.naam||'')+' '+(p.klant||'')).toLowerCase())}" onclick="inboxKoppelProjectDo('${ibEsc(p.code).replace(/'/g,'')}')" style="padding:8px 10px;border-radius:var(--radius-sm);cursor:pointer">
      <div style="font-weight:600;font-size:13px">${ibEsc(p.naam||p.code)}</div>
      <div style="font-size:11px;color:var(--text-dim)"><span style="font-family:var(--mono)">${ibEsc(p.code)}</span>${p.klant?' · '+ibEsc(p.klant):''}</div>
    </div>`).join('');
  ov.innerHTML=`<div style="background:var(--surface-overlay,#fff);border-radius:var(--radius-lg);box-shadow:var(--shadow-pop);width:440px;max-width:calc(100vw - 32px);max-height:80vh;display:flex;flex-direction:column;overflow:hidden">
    <div style="padding:14px 16px;border-bottom:1px solid var(--border)">
      <div style="font-weight:700;font-size:15px;margin-bottom:2px">🔗 Mail koppelen aan project</div>
      <div style="font-size:11.5px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ibEsc(_inbox.cur.subject||'(geen onderwerp)')}</div>
      <input id="kp-zoek" type="search" placeholder="Zoek project op naam, code of klant…" oninput="inboxKoppelFilter()" style="margin-top:10px;width:100%;height:34px">
    </div>
    <div id="kp-lijst" style="overflow:auto;padding:6px">${lijst}</div>
  </div>`;
  document.body.appendChild(ov);
  const z=document.getElementById('kp-zoek');if(z)setTimeout(()=>z.focus(),30);
}
function inboxKoppelFilter(){
  const q=(document.getElementById('kp-zoek').value||'').toLowerCase().trim();
  document.querySelectorAll('#kp-lijst .kp-row').forEach(r=>{r.style.display=(!q||r.dataset.zoek.includes(q))?'':'none';});
}
function inboxKoppelProjectDo(code){
  const m=_inbox.cur;if(!m)return;
  const all=mailLinksAll();const arr=all[code]||[];
  const imid=m.internetMessageId||m.id;
  if(arr.some(x=>(x.internetMessageId||x.id)===imid)){inboxToast('Deze mail was al gekoppeld aan '+code);}
  else{
    arr.push({id:m.id,internetMessageId:m.internetMessageId||'',subject:m.subject||'',
      from:(m.from&&m.from.emailAddress&&(m.from.emailAddress.name||m.from.emailAddress.address))||'',
      date:m.receivedDateTime||'',webLink:m.webLink||'',mbx:_inbox.mbx,ts:Date.now()});
    all[code]=arr;mailLinksSave(all);
    inboxToast('✓ Mail gekoppeld aan '+code+' ('+arr.length+' mail'+(arr.length>1?'s':'')+')');
    inboxRefreshKoppelKnop();
    if(typeof huidigProject!=='undefined'&&huidigProject&&huidigProject.code===code&&typeof renderProjectDetail==='function')renderProjectDetail(huidigProject);
    // Bijlagen automatisch naar de klantmap (05_Aangeleverd) — stil, best-effort.
    if(m.hasAttachments) inboxBijlagenNaarProject(m.id,code,true);
  }
  const ov=document.getElementById('koppel-overlay');if(ov)ov.remove();
}
// Vanuit het project terug naar de gekoppelde mail in de inbox.
async function openGekoppeldeMail(code,idx){
  const x=mailLinksVoor(code)[idx];if(!x)return;
  tbDoTab('inbox');
  if(_inbox.mbx!==x.mbx){const sel=document.getElementById('inbox-mailbox');if(sel)sel.value=x.mbx;_inbox.mbx=x.mbx;_inbox.loaded=false;}
  if(!_inbox.loaded){await inboxReload();}
  try{await inboxOpenMail(x.id);}
  catch(e){
    if(x.internetMessageId){try{
      const d=await ibFetch('/messages?$filter='+encodeURIComponent("internetMessageId eq '"+x.internetMessageId+"'")+'&$select=id&$top=1');
      const hit=d&&d.value&&d.value[0];
      if(hit){await inboxOpenMail(hit.id);return;}
    }catch(e2){}}
    inboxToast('Mail niet te openen (verplaatst/verwijderd?) — gebruik ↗ Outlook.');
  }
}
// Bijlagen van de geopende mail naar de map van het gekoppelde project.
function inboxBijlagenNaarMap(){
  const m=_inbox.cur; if(!m){alert('Open eerst een mail.');return;}
  const info=mailLinkInfo(m);
  if(!info){alert('Koppel deze mail eerst aan een project (🔗) — dan weet ik in welke klantmap de bijlagen horen.');return;}
  if(!m.hasAttachments){inboxToast('Deze mail heeft geen bijlagen.');return;}
  inboxBijlagenNaarProject(m.id,info.code,false);
}

// Kern: haal file-bijlagen op en upload ze naar 05_Aangeleverd van het project.
// stil=true → geen toasts behalve fouten (gebruikt bij auto-koppel).
async function inboxBijlagenNaarProject(mailId,code,stil){
  const proj=PROJECT_CODES.find(p=>p.code===code);
  if(!proj){if(!stil)inboxToast('Project '+code+' niet gevonden.');return;}
  if(typeof window.spUploadProjectBytes!=='function'){inboxToast('SharePoint-upload niet beschikbaar (ingelogd op M365?).');return;}
  try{
    if(!stil)ibStatus('Bijlagen ophalen…');
    // Lijst zonder $select → @odata.type + contentBytes komen standaard mee.
    const a=await ibFetch(`/messages/${mailId}/attachments`);
    const all=(a&&a.value)||[];
    // file-bijlagen = niet inline, en geen item-/reference-attachment. We leunen
    // op de aanwezigheid van contentBytes i.p.v. alleen op @odata.type (dat soms
    // ontbreekt). reference-attachments (OneDrive-links) hebben geen bytes → skip.
    const items=all.filter(x=>{
      const t=String(x['@odata.type']||'');
      if(x.isInline) return false;
      if(t.includes('itemAttachment')||t.includes('referenceAttachment')) return false;
      return true; // contentBytes halen we zo nodig per stuk op
    });
    if(!items.length){if(!stil)inboxToast(all.length?'Alleen inline/embedded bijlagen — niets op te slaan.':'Deze mail heeft geen bijlagen.');else ibStatus&&ibStatus('');return;}
    let ok=0,fout=0,laatsteFout='';
    for(const x of items){
      try{
        let b64=x.contentBytes;
        if(!b64){ // grote bijlage of $select-projectie: per stuk ophalen
          const one=await ibFetch(`/messages/${mailId}/attachments/${x.id}`);
          b64=one&&one.contentBytes;
        }
        if(!b64){ fout++; laatsteFout='geen bytes ('+(x.name||'?')+')'; continue; }
        const bin=atob(b64);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
        await window.spUploadProjectBytes(proj,x.name,arr,x.contentType,'05_Aangeleverd');
        ok++;
      }catch(e){fout++;laatsteFout=e.message;console.warn('bijlage-upload mislukt:',x.name,e.message);}
    }
    try{ if(window.track) track('inbox','bijlagen_naar_map',{detail:code+' · '+ok+'/'+items.length,ok:fout===0}); }catch(e){}
    if(ok){
      const msg=`📎 ${ok} bijlage${ok===1?'':'s'} → ${code}/05_Aangeleverd`+(fout?` (${fout} mislukt)`:'');
      inboxToast(msg);
    } else if(fout){
      inboxToast('⚠ Bijlagen niet opgeslagen: '+(laatsteFout||'onbekende fout'));
    }
    if(!stil)ibStatus('');
  }catch(e){ ibStatus&&ibStatus(''); inboxToast('⚠ Bijlagen-fout: '+e.message); console.warn('auto-bijlagen mislukt:',e.message); }
}

// ── Larry-chat per mail (via Worker target=claude). Mailcontext alleen runtime.
function inboxChatReset(){
  const w=document.getElementById('inbox-chatwrap'),log=document.getElementById('inbox-chatlog');
  w.style.display='flex';log.innerHTML='';log.classList.remove('actief');
  const q=document.getElementById('inbox-chatq');if(q){q.value='';q.style.height='auto';}
}
async function inboxChat(){
  const inp=document.getElementById('inbox-chatq');const q=(inp.value||'').trim();if(!q||!_inbox.cur)return;
  const log=document.getElementById('inbox-chatlog');log.classList.add('actief');
  log.innerHTML+=`<div class="u">${ibEsc(q)}</div>`;inp.value='';inp.style.height='auto';log.scrollTop=log.scrollHeight;
  const m=_inbox.cur;
  const van=(m.from&&m.from.emailAddress)?`${m.from.emailAddress.name||''} <${m.from.emailAddress.address||''}>`:'';
  const ctx=`Mail in de M&T info@-inbox.\nVan: ${van}\nOnderwerp: ${m.subject||''}\nInhoud (preview):\n${(m.bodyPreview||'').slice(0,1500)}`;
  const tmp=document.createElement('div');tmp.className='b';tmp.textContent='…';log.appendChild(tmp);log.scrollTop=log.scrollHeight;
  try{
    const r=await claudeCall([
      {role:'user',content:`Je bent Larry, de M&T-assistent. Antwoord kort en concreet in het Nederlands.\n\n${ctx}\n\nVraag: ${q}`}
    ],700);
    const txt=(r&&r.content&&r.content[0]&&r.content[0].text)||(r&&r.error&&('fout: '+(r.error.message||r.error)))||'(geen antwoord)';
    tmp.textContent=txt;
    if(window._LOG)_LOG.add('inbox-chat','inbox',`[${m.subject||''}] ${q}`,txt);
  }catch(e){tmp.textContent='fout: '+e.message;}
  log.scrollTop=log.scrollHeight;
}
