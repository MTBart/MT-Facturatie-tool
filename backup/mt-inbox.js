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
 * inboxSub, inboxReload, inboxReloadBadges, openGekoppeldeMail, _inbox (+ alle
 * onclick-handlers in de inbox-HTML). Mail↔project-koppelen zit sinds B4 in
 * mt-koppel.js (MTKoppel + de oude namen mailLinksAll/mailLinksVoor/mailLinkInfo…).
 * ========================================================================== */

// ═══════════════════════════════════════════════════════════════════════════
// SMART-INBOX (Fase A) — live 2-weg op de gedeelde info@-mailbox via Graph.
// Bron van waarheid = de live mailbox (geen lokale kopie). Verplaatsen muteert
// direct in Outlook; undo-stack maakt elke move omkeerbaar. NOOIT verwijderen.
// PUBLIC repo: geen mailinhoud/PII wordt opgeslagen of gecommit — alles runtime.
// ═══════════════════════════════════════════════════════════════════════════
const INBOX_DEFAULT='info@mortiseandtenon.nl';
const IB_FILTERS={ongelezen:'Ongelezen',nietGekoppeld:'Niet gekoppeld',bijlage:'Met bijlage'};
let _inbox={mbx:INBOX_DEFAULT,folderId:null,folderName:'',folders:[],msgs:[],cur:null,undo:null,loaded:false,q:'',nextLink:null,loadingMore:false,threadMode:false,curThread:null};

function ibEsc(s){return esc(s);}   // alias van de canonieke esc() bovenin (was identieke kopie)
function ibBase(){return _inbox.mbx==='me'?'https://graph.microsoft.com/v1.0/me':`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(_inbox.mbx)}`;}
// Mail-calls (berichten/mappen) vragen immutable ids: die blijven gelijk als een mail
// verplaatst wordt, zodat koppelingen en chips blijven kloppen (brok B5). Een eigen Prefer
// van de aanroeper (bv. outlook.timezone of body-content-type) wordt samengevoegd tot één
// komma-lijst — getest 2026-10-06: Graph past dan beide toe (Preference-Applied toont beide).
const IB_PREFER_IMMUTABLE='IdType="ImmutableId"';
function ibPreferSamen(...waarden){
  const uit=[];
  waarden.forEach(w=>String(w||'').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(x=>x.trim()).filter(Boolean)
    .forEach(x=>{ if(!uit.some(u=>u.toLowerCase()===x.toLowerCase())) uit.push(x); }));
  return uit.join(', ');
}
function ibIsMailUrl(url){ return /\/(messages|mailFolders)(\/|\?|$)/i.test(String(url||'').split('#')[0]); }
function ibHeaders(url,eigen){
  const h={...(eigen||{})};
  if(!ibIsMailUrl(url)) return h;
  const k=Object.keys(h).find(x=>x.toLowerCase()==='prefer');
  const samen=ibPreferSamen(k?h[k]:'',IB_PREFER_IMMUTABLE);
  if(k) delete h[k];
  h.Prefer=samen;
  return h;
}
async function ibFetch(path,opts){
  const token=await window.getGraphToken();
  if(!token) throw new Error('niet ingelogd bij Microsoft');
  const o=opts||{};
  const url=/^https?:\/\//.test(path)?path:ibBase()+path;
  let r;
  for(let poging=0;;poging++){
    r=await fetch(url,{...o,headers:{'Authorization':`Bearer ${token}`,...ibHeaders(url,o.headers)}});
    // Te veel verzoeken (429) of tijdelijk niet beschikbaar (503): wachten zoals Graph vraagt, max 2 keer.
    if((r.status===429||r.status===503)&&poging<2){
      const sec=Math.min(30,Math.max(1,parseInt((r.headers&&r.headers.get&&r.headers.get('Retry-After'))||'',10)||(poging+1)*2));
      ibStatus(`Even wachten (${sec}s) — Microsoft vraagt om rustiger aan te doen…`);
      await new Promise(res=>setTimeout(res,sec*1000)); continue;
    }
    break;
  }
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
    <div id="todo-list-body"></div>
    <div style="margin-top:16px;padding-top:10px;border-top:1px solid var(--border,#eee)">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <b style="font-size:13px">Toggl → To Do</b> <span class="badge" style="font-size:10px">proef</span>
        <span style="font-size:11px;color:var(--text-faint)">jouw open Toggl-taken in de lijst "${TDS_LIJST}" · één richting · er wordt nooit iets verwijderd</span>
        <button class="btn btn-sm btn-secondary" onclick="tdsDroogloop()">🔍 Droogloop</button>
      </div>
      <div id="tds-uit"></div>
    </div>`;
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

// ── To Do-pilot (brok 6): Toggl 2.0 → Microsoft To Do, ÉÉN richting ─────────────
// Alleen voor de ingelogde gebruiker (gedelegeerd Graph, eigen Toggl-sleutel via de
// worker), in een eigen lijst "MT test taken". Regels:
//  - open Toggl-taken die aan jou zijn toegewezen → To Do-taak "[project] taak";
//  - correlatie: linkedResource (applicationName "MT tool", externalId = Toggl-taak-id)
//    + koppeltabel mt_todo_sync (gesynct, eigen samenvoeger). Eerst zoeken, dan maken;
//  - Toggl op Done → To Do voltooid; titel/deadline gewijzigd in Toggl → bijgewerkt,
//    MAAR niet als je die in To Do zelf al had aangepast (dat wordt gemeld);
//  - NOOIT verwijderen: weg of niet meer toegewezen in Toggl = alleen melden;
//  - altijd eerst een droogloop met de lijst van wat er zou gebeuren.
const TDS_LIJST='MT test taken';
function tdsMijnEmail(){ try{ const a=window._msal&&_msal.getAllAccounts(); return (a&&a[0]&&a[0].username||'').toLowerCase(); }catch(e){ return ''; } }
function tdsMapAll(){ try{ const v=JSON.parse(localStorage.getItem('mt_todo_sync')||'[]'); return Array.isArray(v)?v:[]; }catch(e){ return []; } }
function tdsMapZet(rec){
  const all=tdsMapAll(), i=all.findIndex(x=>x.id===rec.id);
  const r=Object.assign({},i>=0?all[i]:{},rec,{tijd:new Date().toISOString()});
  if(i>=0) all[i]=r; else all.push(r);
  localStorage.setItem('mt_todo_sync',JSON.stringify(all));
  return r;
}
async function tdsGraphAlle(url){
  const uit=[]; let next=url, n=0;
  while(next&&n<50){ const d=await ibFetch(next); uit.push(...((d&&d.value)||[])); next=d&&d['@odata.nextLink']; n++; }
  return uit;
}
function tdsTitel(t){ const p=(t.project&&t.project.name)?'['+t.project.name+'] ':''; return (p+(t.name||'(zonder naam)')).slice(0,255); }
function tdsDue(t){ return t.end_date?String(t.end_date).slice(0,10):''; }
function tdsTodoDue(td){ return (td&&td.dueDateTime&&td.dueDateTime.dateTime)?String(td.dueDateTime.dateTime).slice(0,10):''; }

// Bepaalt wat er zou gebeuren. Schrijft niets.
async function tdsPlan(){
  const email=tdsMijnEmail(); if(!email) throw new Error('niet ingelogd bij Microsoft 365');
  const users=await focusFetchOrg('users');
  const ik=(Array.isArray(users)?users:[]).find(u=>String(u.email||'').toLowerCase()===email);
  if(!ik) throw new Error('je e-mailadres ('+email+') staat niet als gebruiker in Toggl');
  const mijnId=ik.user_account_id;
  const stream=await focusFetch('tasks/stream');
  const taken=(Array.isArray(stream)?stream:((stream&&stream.data)||[])).filter(t=>!t.is_template&&!t.archived_at);
  const mijn=taken.filter(t=>(t.assignee_user_ids||[]).map(String).includes(String(mijnId)));
  const lijsten=await tdsGraphAlle(TODO_BASE+'/lists?$top=100');
  const lijst=lijsten.find(l=>l.displayName===TDS_LIJST)||null;
  const todo=lijst?await tdsGraphAlle(`${TODO_BASE}/lists/${lijst.id}/tasks?$top=100&$expand=linkedResources`):[];
  const perExt=new Map();
  todo.forEach(td=>(td.linkedResources||[]).forEach(lr=>{ if(lr.applicationName==='MT tool'&&lr.externalId) perExt.set(String(lr.externalId),td); }));
  const map=tdsMapAll();
  const acties=[];
  for(const t of mijn){
    const klaar=(t.status&&t.status.type)==='done', id=email+'|'+t.id, rec=map.find(x=>x.id===id);
    const td=perExt.get(String(t.id))||(rec&&rec.todo_task_id&&todo.find(x=>x.id===rec.todo_task_id))||null;
    const titel=tdsTitel(t), due=tdsDue(t);
    if(!td){ if(!klaar) acties.push({soort:'maken',t,id,titel,due}); continue; }
    const tdKlaar=td.status==='completed';
    if(klaar&&!tdKlaar){ acties.push({soort:'voltooien',t,td,id,titel}); continue; }
    const vorig=(rec&&rec.laatst)||{};
    const wijzig={};
    if(titel!==td.title){ if(vorig.titel&&td.title!==vorig.titel) acties.push({soort:'conflict',t,td,id,titel,reden:'titel in To Do zelf aangepast — niet overschreven'}); else wijzig.title=titel; }
    if(due!==tdsTodoDue(td)){ if(vorig.due!==undefined&&tdsTodoDue(td)!==vorig.due) acties.push({soort:'conflict',t,td,id,titel,reden:'deadline in To Do zelf aangepast — niet overschreven'}); else wijzig.due=due; }
    if(Object.keys(wijzig).length) acties.push({soort:'bijwerken',t,td,id,titel,wijzig});
    else if(!rec||!rec.todo_task_id) acties.push({soort:'koppelen',t,td,id,titel});   // bestond al (bv. na crash) → alleen vastleggen
    if(tdKlaar&&!klaar) acties.push({soort:'melding',t,td,id,titel,reden:'in To Do afgevinkt, maar in Toggl nog open (tweerichting komt later)'});
  }
  // Niet meer van jou of verdwenen in Toggl: alleen melden, nooit verwijderen.
  const mijnIds=new Set(mijn.map(t=>String(t.id)));
  perExt.forEach((td,ext)=>{ if(!mijnIds.has(ext)&&td.status!=='completed') acties.push({soort:'melding',td,id:email+'|'+ext,titel:td.title,reden:'staat niet (meer) op jouw naam in Toggl — To Do-taak blijft staan'}); });
  return {email,lijst,acties,aantalMijn:mijn.length};
}

// Voert het plan uit. Outbox: koppeltabel vóór de create ('voorbereid'), daarna 'gekoppeld'.
async function tdsUitvoeren(plan){
  let lijst=plan.lijst;
  if(!lijst){
    lijst=await ibFetch(TODO_BASE+'/lists',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:TDS_LIJST})});
  }
  const res={ok:0,fout:0,fouten:[]};
  for(const a of plan.acties){
    try{
      if(a.soort==='maken'){
        tdsMapZet({id:a.id,email:plan.email,tg_task_id:a.t.id,todo_list_id:lijst.id,status:'voorbereid'});
        const body={title:a.titel,
          body:{contentType:'text',content:'Toggl-taak '+a.t.id+(a.t.project&&a.t.project.name?(' · project '+a.t.project.name):'')+'\nAangemaakt door de MT tool (proef Toggl → To Do).'},
          linkedResources:[{applicationName:'MT tool',displayName:'Toggl-taak '+a.t.id,externalId:String(a.t.id),webUrl:'https://focus.toggl.com/'}]};
        if(a.due) body.dueDateTime={dateTime:a.due+'T12:00:00',timeZone:'Europe/Amsterdam'};
        const td=await ibFetch(`${TODO_BASE}/lists/${lijst.id}/tasks`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        tdsMapZet({id:a.id,todo_task_id:td.id,status:'gekoppeld',laatst:{titel:a.titel,due:a.due}});
      } else if(a.soort==='voltooien'){
        await ibFetch(`${TODO_BASE}/lists/${lijst.id}/tasks/${a.td.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'completed'})});
        tdsMapZet({id:a.id,email:plan.email,tg_task_id:a.t.id,todo_task_id:a.td.id,todo_list_id:lijst.id,status:'gekoppeld'});
      } else if(a.soort==='bijwerken'){
        const b={}; if(a.wijzig.title!==undefined) b.title=a.wijzig.title;
        if(a.wijzig.due!==undefined) b.dueDateTime=a.wijzig.due?{dateTime:a.wijzig.due+'T12:00:00',timeZone:'Europe/Amsterdam'}:null;
        await ibFetch(`${TODO_BASE}/lists/${lijst.id}/tasks/${a.td.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
        tdsMapZet({id:a.id,email:plan.email,tg_task_id:a.t.id,todo_task_id:a.td.id,todo_list_id:lijst.id,status:'gekoppeld',laatst:{titel:a.titel,due:tdsDue(a.t)}});
      } else if(a.soort==='koppelen'){
        tdsMapZet({id:a.id,email:plan.email,tg_task_id:a.t.id,todo_task_id:a.td.id,todo_list_id:lijst.id,status:'gekoppeld',laatst:{titel:a.td.title,due:tdsTodoDue(a.td)}});
      } else continue;   // conflict/melding: niets doen
      res.ok++;
    }catch(e){ res.fout++; res.fouten.push((a.titel||'?')+': '+(e.message||e)); }
  }
  return res;
}

let _tdsPlan=null;
function tdsActieHtml(a){
  const ic={maken:'➕',voltooien:'✅',bijwerken:'✏️',koppelen:'🔗',conflict:'⚠️',melding:'ℹ️'}[a.soort]||'·';
  const txt={maken:'nieuw in To Do',voltooien:'afvinken in To Do',bijwerken:'bijwerken in To Do',koppelen:'bestaande To Do-taak koppelen',conflict:a.reden,melding:a.reden}[a.soort]||'';
  return `<div style="font-size:12px;padding:3px 0;border-bottom:1px solid #f2f2f2">${ic} ${ibEsc(a.titel||'')} <span style="color:var(--text-faint)">— ${ibEsc(txt)}</span></div>`;
}
async function tdsDroogloop(){
  const el=document.getElementById('tds-uit'); if(!el) return;
  el.innerHTML='<div class="inbox-empty" style="font-size:12px">Toggl en To Do lezen… (er wordt niets gewijzigd)</div>';
  try{
    _tdsPlan=await tdsPlan();
    const n=s=>_tdsPlan.acties.filter(a=>a.soort===s).length, doen=['maken','voltooien','bijwerken','koppelen'].reduce((x,s)=>x+n(s),0);
    el.innerHTML=`<div style="font-size:12px;margin-bottom:6px">${_tdsPlan.aantalMijn} Toggl-taken op jouw naam · lijst "${TDS_LIJST}" ${_tdsPlan.lijst?'bestaat':'<b>wordt aangemaakt</b>'}<br>
      ➕ ${n('maken')} nieuw · ✅ ${n('voltooien')} afvinken · ✏️ ${n('bijwerken')} bijwerken · 🔗 ${n('koppelen')} koppelen · ⚠️ ${n('conflict')} niet overschreven · ℹ️ ${n('melding')} meldingen</div>
      <div style="max-height:260px;overflow:auto;border:1px solid var(--border,#eee);border-radius:6px;padding:4px 8px">${_tdsPlan.acties.map(tdsActieHtml).join('')||'<div style="font-size:12px;color:var(--text-faint)">Alles is al bij.</div>'}</div>
      ${doen?`<button class="btn btn-sm btn-primary" style="margin-top:8px" onclick="tdsUitvoerenKnop()">Uitvoeren (${doen} wijziging${doen===1?'':'en'} in jouw To Do)</button>`:''}`;
  }catch(e){ el.innerHTML=`<div class="inbox-empty" style="font-size:12px">Droogloop mislukt: ${ibEsc(e.message)}${e.status===403?' — log opnieuw in en sta To Do-toegang toe':''}</div>`; }
}
async function tdsUitvoerenKnop(){
  if(!_tdsPlan) return;
  const el=document.getElementById('tds-uit');
  if(!await mtDialog.confirm({title:'Toggl → To Do',message:'De wijzigingen uit de droogloop uitvoeren in jouw To Do-lijst "'+TDS_LIJST+'"?\nEr wordt niets verwijderd, en in Toggl verandert niets.',okLabel:'Uitvoeren'})) return;
  try{
    const r=await tdsUitvoeren(_tdsPlan); _tdsPlan=null;
    if(el) el.innerHTML=`<div style="font-size:12px">${r.fout?'⚠':'✓'} ${r.ok} uitgevoerd${r.fout?`, ${r.fout} mislukt:<br>${r.fouten.map(ibEsc).join('<br>')}`:''}. Klik opnieuw op Droogloop om te controleren.</div>`;
    if(typeof inboxLoadTaken==='function'){ _todo.loaded=false; }
  }catch(e){ if(el) el.innerHTML=`<div class="inbox-empty" style="font-size:12px">Uitvoeren mislukt: ${ibEsc(e.message)}</div>`; }
}

function inboxSwitchMbx(v){
  _inbox.mbx=v;_inbox.loaded=false;_inbox.folderId=null;_inbox.cur=null;_inbox.serverFilterUit=false;
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
    return `<div class="inbox-fold${kind?' kind':''}${act}" data-fid="${ibEsc(f.id)}" data-fnaam="${ibEsc(f.displayName)}"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ibEsc(f.displayName)}</span>${b}</div>`;
  };
  el.innerHTML=_inbox.folders.map(f=>row(f,false)+(f.children||[]).map(c=>row(c,true)).join('')).join('')||'<div class="inbox-empty" style="font-size:12px">geen mappen</div>';
  el.onclick=e=>{ const d=e.target.closest('[data-fid]'); if(d) inboxOpenFolder(d.dataset.fid,d.dataset.fnaam); };   // F7: geen waarden in onclick
}

function inboxOpenFolder(id,name){
  _inbox.folderId=id;_inbox.folderName=name;_inbox.q='';_inbox.curThread=null;_inbox.serverFilterUit=false;
  const sb=document.getElementById('inbox-search');if(sb)sb.value='';
  document.getElementById('inbox-listtitle').textContent=name;
  inboxRenderTree();
  inboxLoadMessages();
}
function inboxMsgUrl(){
  // internetMessageId mee: koppel-chips matchen daarop, ook als het Graph-id ooit wijzigt.
  const sel='id,internetMessageId,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview,parentFolderId,conversationId';
  // Zoeken = HELE postbus (alle mappen, ook body) net als Outlook-zoeken.
  // Geen zoekterm = alleen de geopende map, op datum gesorteerd.
  if(_inbox.q){
    return `/messages?$top=50&$select=${sel}&$search=`+encodeURIComponent('"'+_inbox.q.replace(/"/g,'')+'"');
  }
  // Ongelezen / met bijlage via $filter (Graph eist dan dat receivedDateTime ook in $filter staat);
  // lukt dat niet (_inbox.serverFilterUit), dan filtert inboxRenderList het client-side.
  const f=_inbox.filter||{}, delen=[];
  if(!_inbox.serverFilterUit){ if(f.ongelezen) delen.push('isRead eq false'); if(f.bijlage) delen.push('hasAttachments eq true'); }
  const flt=delen.length?'&$filter='+encodeURIComponent('receivedDateTime ge 1900-01-01T00:00:00Z and '+delen.join(' and ')):'';
  return `/mailFolders/${_inbox.folderId}/messages?$top=50&$select=${sel}${flt}&$orderby=receivedDateTime desc`;
}
async function inboxLoadMessages(){
  const cont=document.getElementById('inbox-messages');
  cont.innerHTML='<div class="inbox-empty" style="font-size:12px">laden…</div>';
  _inbox.nextLink=null;_inbox.msgs=[];_inbox.loadingMore=false;
  const titel=document.getElementById('inbox-listtitle');
  if(titel)titel.textContent=_inbox.q?`🔍 "${_inbox.q}" · hele postbus`:_inbox.folderName;
  try{
    let d;
    try{ d=await ibFetch(inboxMsgUrl()); }
    catch(e){
      // Graph weigert de filtercombinatie? Dan zonder server-filter laden en client-side filteren.
      if(e.status===400&&/\$filter=/.test(inboxMsgUrl())&&!_inbox.serverFilterUit){ _inbox.serverFilterUit=true; d=await ibFetch(inboxMsgUrl()); }
      else throw e;
    }
    _inbox.msgs=(d&&d.value)||[];
    _inbox.nextLink=(d&&d['@odata.nextLink'])||null;
    inboxRenderList();
  }catch(e){cont.innerHTML=`<div class="inbox-empty" style="font-size:12px">fout: ${ibEsc(e.message)}</div>`;}
}
// Eén render-pad voor de berichtenlijst — respecteert de gespreksmodus (threadMode).
// READ-ONLY: groepeert alleen wat al geladen is op conversationId; geen mutaties.
function inboxRenderList(){
  const cont=document.getElementById('inbox-messages');if(!cont)return;
  _ibVoorstelIx=null;                        // index opnieuw opbouwen (koppelingen kunnen gewijzigd zijn)
  inboxFilterChipsTekenen();
  const msgs=ibFilterToepassen(_inbox.msgs);
  if(!msgs.length){
    const filterAan=Object.values(_inbox.filter||{}).some(Boolean);
    cont.innerHTML=`<div class="inbox-empty" style="font-size:12px">${filterAan?'niets met deze filters op de geladen pagina':(_inbox.q?'geen resultaten':'geen berichten')}</div>`;return;
  }
  if(_inbox.threadMode){
    cont.innerHTML=inboxGroupThreads(msgs).map(inboxThreadRow).join('');
  }else{
    cont.innerHTML=msgs.map(inboxMsgRow).join('');
  }
  // F7: één handler op de lijst (id's via data-attributen, niet in onclick-strings)
  cont.onclick=e=>{ const r=e.target.closest('.inbox-msg[data-mail]'); if(!r||!cont.contains(r)) return;
    if(r.dataset.cid!=null) inboxOpenThread(r.dataset.cid,r.dataset.mail); else inboxOpenMail(r.dataset.mail); };
}
// Client-side filters (altijd; server-side is alleen een versnelling).
function ibFilterToepassen(msgs){
  const f=_inbox.filter||{};
  return (msgs||[]).filter(m=>(!f.ongelezen||!m.isRead)&&(!f.bijlage||m.hasAttachments)&&(!f.nietGekoppeld||!ibProjecten(m).length));
}
function inboxFilterChipsTekenen(){
  const el=document.getElementById('inbox-filters'); if(!el) return;
  const f=_inbox.filter||{};
  el.innerHTML=Object.entries(IB_FILTERS).map(([k,l])=>`<button type="button" class="ib-fchip${f[k]?' actief':''}" aria-pressed="${!!f[k]}" onclick="inboxFilterToggle('${k}')">${l}</button>`).join('');
}
function inboxFilterToggle(k){
  _inbox.filter=Object.assign({},_inbox.filter||{}); _inbox.filter[k]=!_inbox.filter[k];
  // Ongelezen/bijlage wijzigt de server-query (behalve bij zoeken); "niet gekoppeld" is alleen client-side.
  if((k==='ongelezen'||k==='bijlage')&&!_inbox.q&&!_inbox.serverFilterUit&&_inbox.folderId) inboxLoadMessages(); else inboxRenderList();
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
      else cont.insertAdjacentHTML('beforeend',ibFilterToepassen(more).map(inboxMsgRow).join(''));   // filters gelden ook voor nageladen mails
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
// Voorstelindex: één keer per lijst-render opbouwen.
let _ibVoorstelIx=null;
function ibVoorstel(m){
  if(!window.MTKoppel||!MTKoppel.koppelVoorstel||!m) return [];
  if(!_ibVoorstelIx) _ibVoorstelIx=MTKoppel.voorstelIndex();
  return MTKoppel.koppelVoorstel(m,{index:_ibVoorstelIx,gesprek:_inbox.msgs});
}
function inboxMsgRow(m){
  const van=(m.from&&m.from.emailAddress&&(m.from.emailAddress.name||m.from.emailAddress.address))||'(onbekend)';
  const dt=m.receivedDateTime?new Date(m.receivedDateTime).toLocaleString('nl-NL',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
  const clip=m.hasAttachments?' 📎':'';
  const act=m.id===(_inbox.cur&&_inbox.cur.id)?' actief':'';
  const fnaam=(_inbox.q&&m.parentFolderId)?ibFolderName(m.parentFolderId):'';
  const fchip=fnaam?`<span style="font-size:10px;color:#777;background:rgba(0,0,0,.06);border-radius:3px;padding:0 4px;margin-left:6px;white-space:nowrap">${ibEsc(fnaam)}</span>`:'';
  const kp=ibKoppelChips(m);
  const kpcls=kp.codes.length?' gekoppeld':'';
  const kpchip=kp.html;
  return `<div class="inbox-msg${m.isRead?'':' ongelezen'}${kpcls}${act}" data-mail="${ibEsc(m.id)}">
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
  const kp=ibKoppelChips(m);
  const kpcls=kp.codes.length?' gekoppeld':'';
  const kpchip=kp.html;
  const onderw=_ibOnderwerpSchoon(m.subject||'')||'(geen onderwerp)';
  return `<div class="inbox-msg${anyUnread?' ongelezen':''}${kpcls}${act}" data-cid="${ibEsc(g.cid)}" data-mail="${ibEsc(m.id)}">
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
      const sel='id,internetMessageId,subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments,isRead,webLink,conversationId';
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
    inboxGesprekKoppelTekenen();
  }catch(e){
    rb.classList.add('inbox-empty');rb.textContent='Gesprek laden mislukt: '+e.message;
  }
}
function inboxRenderThread(items){
  const rb=document.getElementById('inbox-readbody');
  rb.classList.remove('inbox-empty');
  const titel=_ibOnderwerpSchoon(items[items.length-1].subject||'')||'(geen onderwerp)';
  _inbox.curThreadItems=items;
  const head=`<div class="inbox-rhdr"><h3>💬 ${ibEsc(titel)}</h3>
    <div class="inbox-rmeta"><span>${items.length} berichten in dit gesprek</span></div>
    <div class="inbox-ract" id="inbox-gesprek-koppel"></div></div>`;
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

// Geeft het geopende bericht terug, of null bij een fout (fout staat dan ook in het
// leesvenster en in _inbox.laatsteFout) — zodat openGekoppeldeMail kan terugvallen.
async function inboxOpenMail(id){
  const rb=document.getElementById('inbox-readbody');
  rb.classList.add('inbox-empty');rb.textContent='laden…';
  try{
    const m=await ibFetch(`/messages/${id}?$select=id,subject,from,toRecipients,receivedDateTime,body,bodyPreview,hasAttachments,webLink,internetMessageId,conversationId`);
    _inbox.cur=m;_inbox.curThread=null;
    inboxRenderMsgListActief();
    let att=[];
    if(m.hasAttachments){try{const a=await ibFetch(`/messages/${id}/attachments?$select=id,name,size,contentType`);att=(a&&a.value)||[];}catch(e){}}
    const van=(m.from&&m.from.emailAddress)?`${m.from.emailAddress.name||''} <${m.from.emailAddress.address||''}>`:'(onbekend)';
    const dt=m.receivedDateTime?new Date(m.receivedDateTime).toLocaleString('nl-NL'):'';
    const folderOpts=ibFlat(_inbox.folders).filter(f=>f.id!==_inbox.folderId)
      .map(f=>`<option value="${f.id}">${ibEsc(f.displayName)}</option>`).join('');
    const attHtml=att.length?('<div style="margin-top:8px">'+att.map(a=>`<span class="inbox-att" data-att="${ibEsc(a.id)}" data-attnaam="${ibEsc(a.name)}">📎 ${ibEsc(a.name)} <span style="color:#999">(${Math.round((a.size||0)/1024)} kB)</span></span>`).join('')+'</div>'):'';
    rb.classList.remove('inbox-empty');
    rb.innerHTML=`<div class="inbox-rhdr">
        <h3>${ibEsc(m.subject||'(geen onderwerp)')}</h3>
        <div class="inbox-rmeta"><span><b>Van:</b> ${ibEsc(van)}</span><span>${dt}</span></div>
        ${attHtml}
        <div id="inbox-voorstel"></div>
        <div id="inbox-contactwrap"></div>
        <div class="inbox-ract">
          <button class="btn btn-sm btn-gold" onclick="inboxMaakProject()">📁 Maak project</button>
          <button class="btn btn-sm btn-primary" onclick="inboxMaakOfferte()" title="Maak een offerte-calculatie met deze mail als context (klant voor-ingevuld als herkend)">📄 Maak offerte</button>
          <span id="inbox-koppelwrap">${inboxKoppelKnopHtml(m)}</span>
          <button class="btn btn-sm btn-secondary" onclick="inboxBijlagenNaarMap()" title="Bijlagen van deze mail als kopie naar de projectmap — per bijlage kies je de submap; er wordt niets overschreven">⬇ Bijlagen → projectmap</button>
        </div>
        <div class="inbox-ract" style="margin-top:6px">
          <label style="font-size:11px;color:var(--text-dim)">Verplaats in Outlook:</label>
          <select id="inbox-moveto"><option value="">— kies map —</option>${folderOpts}</select>
          <button class="btn btn-sm btn-secondary" onclick="inboxMove(document.getElementById('inbox-moveto').value)">Verplaats</button>
          ${veiligeUrl(m.webLink,{hosts:['office.com','office365.com','outlook.com','microsoft.com']})?`<a href="${ibEsc(veiligeUrl(m.webLink,{hosts:['office.com','office365.com','outlook.com','microsoft.com']}))}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary" style="text-decoration:none">↗ Outlook</a>`:''}
        </div>
      </div>
      <iframe class="inbox-body" id="inbox-bodyframe" sandbox="" referrerpolicy="no-referrer"></iframe>`;
    rb.querySelectorAll('[data-att]').forEach(x=>x.addEventListener('click',()=>inboxAtt(m.id,x.dataset.att,x.dataset.attnaam)));   // F7
    const frame=document.getElementById('inbox-bodyframe');
    const isHtml=m.body&&m.body.contentType&&/html/i.test(m.body.contentType);
    const content=(m.body&&m.body.content)||m.bodyPreview||'';
    frame.srcdoc=isHtml?content:`<pre style="white-space:pre-wrap;font-family:system-ui,sans-serif;font-size:13px;padding:10px">${ibEsc(content)}</pre>`;
    inboxChatReset();
    // Contactenregister: handtekening van een gekoppelde mail → alleen voorstellen (mt-contacten.js)
    try{ if(window.MTContactenUI) MTContactenUI.inboxHandtekening(m,document.getElementById('inbox-contactwrap')); }catch(e){ console.warn('contacten (handtekening):',e); }
    _inbox.laatsteFout=null;
    return m;
  }catch(e){
    rb.classList.add('inbox-empty');rb.textContent='Mail laden mislukt: '+e.message;
    _inbox.laatsteFout=e;
    return null;
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
  if(u.soort==='koppel'){
    // Precies de net gemaakte koppelingen weer ontkoppelen (tombstone + journaal), niets anders.
    let n=0; (u.links||[]).forEach(l=>{ n+=MTKoppel.ontkoppelMail(l.code,l.sleutel,{id:l.id,bron:'ongedaan'}); });
    inboxRefreshKoppelKnop(); if(Array.isArray(_inbox.msgs)&&_inbox.msgs.length) inboxRenderList();
    if(_inbox.curThread&&_inbox.curThreadItems) inboxGesprekKoppelTekenen();
    ibStatus(n+' koppeling'+(n===1?'':'en')+' ongedaan gemaakt'); return;
  }
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
  if(!_inbox.cur){ibMelding('Open eerst een mail.');return;}
  const m=_inbox.cur;
  const kv=_ibKlantUitMail(m);
  const onderw=_ibOnderwerpSchoon(m.subject||'');
  tbDoTab&&tbDoTab('projecten');
  openModal();   // wist de velden + _ibProjBron
  // Onthoud de bron-mail zodat het project er straks aan gekoppeld wordt.
  _ibProjBron={id:m.id,internetMessageId:m.internetMessageId||'',subject:m.subject||'',
    from:(m.from&&m.from.emailAddress)?(m.from.emailAddress.name||m.from.emailAddress.address):'',
    date:m.receivedDateTime||'',webLink:m.webLink||'',mbx:_inbox.mbx,hasAttachments:!!m.hasAttachments,idType:'immutable'};
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
// ── Mail ↔ project-koppeling: de opslag en logica zitten in mt-koppel.js (MTKoppel). ──
// Hier alleen de inbox-UI. Dialogen via mtDialog (terugval: browser-dialoog).
function ibMelding(msg){ return (typeof mtDialog!=='undefined')?mtDialog.alert({message:msg}):Promise.resolve(alert(msg)); }
function ibBevestig(opts){ return (typeof mtDialog!=='undefined')?mtDialog.confirm(opts):Promise.resolve(confirm((opts.title?opts.title+'\n\n':'')+opts.message)); }
function ibProjecten(m){ return (window.MTKoppel&&m)?MTKoppel.mailProjecten(m):[]; }
// Chips voor alle projecten van een mail (lijst-rij). Klik = naar het project, niet de mail openen.
// Koppel-badge (B11, Moneybird-stijl) voor één mail: groen dicht = gekoppeld, geel open = niet
// gekoppeld (met "Koppel? CODE" bij een sterk voorstel). Klik = popover met voorstellen of details.
function ibKoppelBadge(m,{klein=false}={}){
  const codes=ibProjecten(m), id=ibEsc(m.id).replace(/'/g,''), klik=`event.stopPropagation();event.preventDefault();inboxKoppelPop(this,'${id}')`;
  if(!window.MTKoppelUI) return '';
  if(codes.length) return MTKoppelUI.badge({status:'gekoppeld',klein,label:(typeof projKort==='function'?projKort(codes[0]):codes[0])+(codes.length>1?' +'+(codes.length-1):''),titel:'Gekoppeld aan '+codes.map(c=>typeof projKort==='function'?projKort(c):c).join(', ')+' — klik voor details of ontkoppelen',onclick:klik});
  const v=ibVoorstel(m)[0];
  if(v&&v.score>=MTKoppel.VOORSTEL_STERK) return MTKoppelUI.badge({status:'voorstel',klein,label:(typeof projKort==='function'?projKort(v.code):v.code),titel:'Voorstel: '+(typeof projKort==='function'?projKort(v.code):v.code)+' — '+v.redenen.join('; ')+'. Klik om te koppelen.',onclick:klik});
  return MTKoppelUI.badge({status:'open',klein,icoon:klein,titel:'Niet gekoppeld — klik voor koppelvoorstellen',onclick:klik});
}
function ibKoppelChips(m){
  const codes=ibProjecten(m);
  return {codes,html:ibKoppelBadge(m,{klein:true})};
}
// Knoppen in het leesvenster: per gekoppeld project een groene knop (→ project) met ✕
// (ontkoppelen, met waarschuwing), plus koppelen aan (nog) een project.
// Leesvenster: één koppel-badge (B11). Voorstellen, ontkoppelen en "+ nog een" zitten in de popover.
function inboxKoppelKnopHtml(m){ return `<span id="inbox-koppelknop">${ibKoppelBadge(m)}</span>`; }
// Popover-inhoud voor één mail (lijst of leesvenster).
function _ibMailVia(id){ return (_inbox.cur&&_inbox.cur.id===id&&_inbox.cur)||(_inbox.msgs||[]).find(x=>x.id===id)||(_inbox.curThreadItems||[]).find(x=>x.id===id)||null; }
function inboxKoppelPop(el,id){
  const m=_ibMailVia(id); if(!m||!window.MTKoppelUI) return;
  const codes=ibProjecten(m), mid=ibEsc(id).replace(/'/g,'');
  const proj=c=>(typeof PROJECT_CODES!=='undefined'&&(typeof projVind==='function'?projVind(c):PROJECT_CODES.find(x=>x.code===c)))||null;
  const naam=c=>{ const p=proj(c)||{}; const n=typeof projNaamVol==='function'?(p.code?projNaamVol(p):''):p.naam; return n?' '+ibEsc(n):''; };
  const nr=c=>(typeof projLabelCode==='function'?projLabelCode(proj(c)):c);
  let html='';
  if(codes.length){
    html+=codes.map(c=>{ const cc=ibEsc(c).replace(/'/g,''); return `<div class="kb-pop-rij">${MTKoppelUI.badge({status:'gekoppeld',klein:true,label:(typeof projKort==='function'?projKort(c):c)})}<span class="kb-pop-n">${nr(c)?naam(c):''}</span>
      <button class="btn btn-xs btn-secondary" onclick="MTKoppelUI.sluit();inboxNaarProject('${cc}')">Open</button>
      <button class="btn btn-xs btn-danger" onclick="MTKoppelUI.sluit();ibOntkoppelVia('${mid}','${cc}')">Ontkoppelen</button></div>`; }).join('');
    html+=`<div class="kb-pop-acties"><button class="btn btn-xs btn-secondary" onclick="MTKoppelUI.sluit();ibAnderVia('${mid}')">+ nog een koppeling</button></div>`;
  } else {
    const v=ibVoorstel(m);
    html+=v.length?v.map((o,i)=>{ const cc=ibEsc(o.code).replace(/'/g,''); return `<div class="kb-pop-rij"><div class="kb-pop-n"><b>${naam(o.code)||ibEsc((typeof projKort==='function'?projKort(o.code):o.code))}</b>${nr(o.code)?' <span class="code">'+ibEsc(nr(o.code))+'</span>':''}<div class="dos-meta">${ibEsc(o.redenen.join('; '))}</div></div>
      <button class="btn btn-xs ${i===0&&o.score>=MTKoppel.VOORSTEL_STERK?'btn-primary':'btn-secondary'}" onclick="MTKoppelUI.sluit();ibKoppelVia('${mid}','${cc}','voorstel')">✓ Koppel</button></div>`; }).join('')
      :'<div class="dos-meta" style="margin-bottom:6px">Geen voorstel gevonden.</div>';
    if(v.length&&m.conversationId) html+=`<div class="kb-pop-acties"><button class="btn btn-xs btn-secondary" onclick="MTKoppelUI.sluit();inboxKoppelGesprek('${ibEsc(v[0].code).replace(/'/g,'')}','${ibEsc(m.conversationId).replace(/'/g,'')}')">✓ Koppel hele gesprek aan ${ibEsc(v[0].code)}</button></div>`;
    html+=`<div class="kb-pop-acties"><button class="btn btn-xs btn-secondary" onclick="MTKoppelUI.sluit();ibAnderVia('${mid}')">🔍 Ander project…</button>${_inbox.cur&&_inbox.cur.id===id?` <button class="btn btn-xs btn-secondary" onclick="MTKoppelUI.sluit();inboxMaakProject()">📁 Nieuw project van deze mail</button>`:''}</div>`;
  }
  MTKoppelUI.popover(el,html,{titel:codes.length?'Gekoppeld':'Niet gekoppeld — voorstellen'});
}
// Koppelen/ontkoppelen van een mail op id (ook vanuit de lijst, zonder de mail te openen).
function ibKoppelVia(id,code,bron){
  const m=_ibMailVia(id); if(!m) return;
  const r=MTKoppel.koppelMail(code,m,{bron:bron||'hand',mbx:_inbox.mbx,idType:'immutable'});
  if(r.status==='al'){ inboxToast('Deze mail was al gekoppeld aan '+code); return; }
  if(r.status==='fout'){ inboxToast('Koppelen mislukt: deze mail heeft geen id'); return; }
  _ibUndoKoppel([{code,sleutel:m.internetMessageId||m.id,id:m.id}],'✓ Gekoppeld aan '+code);
  inboxRefreshKoppelKnop(); if(Array.isArray(_inbox.msgs)&&_inbox.msgs.length) inboxRenderList();
  if(typeof huidigProject!=='undefined'&&huidigProject&&huidigProject.code===code&&typeof renderProjectDetail==='function')renderProjectDetail(huidigProject);
  if(m.hasAttachments&&_inbox.cur&&_inbox.cur.id===id&&typeof inboxBijlagenVraag==='function') inboxBijlagenVraag(m.id,code);
}
async function ibOntkoppelVia(id,code){
  const m=_ibMailVia(id); if(!m) return;
  const ok=await ibBevestig({title:'Mail ontkoppelen',message:'⚠️ Let op — deze mail is gekoppeld aan project '+code+'.\nKoppeling verbreken?\n\n(De mail zelf blijft gewoon in Outlook staan.)',okLabel:'Ontkoppelen',danger:true});
  if(!ok) return;
  const n=MTKoppel.ontkoppelMail(code,m.internetMessageId||m.id,{id:m.id});
  inboxToast(n?'Koppeling met '+code+' verbroken':'Deze mail was niet (meer) gekoppeld aan '+code);
  inboxRefreshKoppelKnop(); if(Array.isArray(_inbox.msgs)&&_inbox.msgs.length) inboxRenderList();
  if(typeof huidigProject!=='undefined'&&huidigProject&&huidigProject.code===code&&typeof renderProjectDetail==='function')renderProjectDetail(huidigProject);
}
function ibAnderVia(id){ const m=_ibMailVia(id); if(!m) return; _inbox.koppelModus={mail:m}; inboxKoppelProject(); }
// ── "Nog te koppelen" (B9): recente mails (30 dagen, info@ + eigen postbus) van de klantdomeinen
// die nog aan geen project hangen. Eén $search per postbus, pas bij openklappen, 10 min gecachet.
// Alles blijft in de browser (Graph → scherm); er gaat niets naar een externe dienst.
const _ntk={};
function ntkPlek(key,codes,domeinen){
  domeinen=[...new Set((domeinen||[]).filter(Boolean))];
  if(!domeinen.length||!codes||!codes.length) return '';
  const st=_ntk[key]=Object.assign(_ntk[key]||{},{codes,domeinen});
  return `<details class="ntk" data-key="${ibEsc(key)}" ontoggle="if(this.open)ntkLaad(this.dataset.key)"${st.open?' open':''}>
    <summary>📥 Nog te koppelen <span class="dos-n">${st.mails?st.mails.length:''}</span> <span class="ntk-dom">${ibEsc(domeinen.join(', '))}</span></summary>
    <div class="ntk-inhoud">${st.mails?ntkLijst(key):'<span class="dos-meta">Klap open om te zoeken…</span>'}</div></details>`;
}
function ntkLijst(key){
  const st=_ntk[key]; if(!st) return '';
  if(st.fout) return `<p style="color:#c0392b;font-size:12px">${ibEsc(st.fout)}</p>`;
  const open=(st.mails||[]).filter(m=>!MTKoppel.mailProjecten(m).length);
  if(!open.length) return '<p class="dos-leeg">Alles van de laatste 30 dagen is gekoppeld 👍</p>';
  const projOpt=(m)=>{ const v=(MTKoppel.koppelVoorstel(m,{})||[]).find(x=>st.codes.includes(x.code));
    return st.codes.map(c=>`<option value="${ibEsc(c)}"${v&&v.code===c?' selected':''}>${ibEsc(typeof projKeuzeLabel==='function'?projKeuzeLabel(c):c)}</option>`).join(''); };
  return open.map(m=>{ const i=st.mails.indexOf(m);
    const van=(m.from&&m.from.emailAddress&&(m.from.emailAddress.name||m.from.emailAddress.address))||'';
    return `<div class="ntk-rij"><div class="dos-hoofd"><div class="dos-titel">${m.hasAttachments?'📎 ':''}${ibEsc(m.subject||'(geen onderwerp)')}</div>
      <div class="dos-meta">${ibEsc(van)} · ${m.receivedDateTime?ibEsc(m.receivedDateTime.slice(0,10)):''} · ${ibEsc(m.mbxLabel||m.mbx||'')}</div></div>
      <div class="dos-acties">${st.codes.length>1?`<select class="dos-sel" aria-label="Project" id="ntk-sel-${ibEsc(key).replace(/[^A-Za-z0-9]/g,'')}-${i}">${projOpt(m)}</select>`:''}
        ${window.MTKoppelUI?MTKoppelUI.badge(st.codes.length===1?{status:'voorstel',label:(typeof projKort==='function'?projKort(st.codes[0]):st.codes[0]),titel:'Voorstel: koppel aan '+(typeof projKort==='function'?projKort(st.codes[0]):st.codes[0])+' — klik om te koppelen',onclick:`ntkKoppel('${ibEsc(key)}',${i})`}:{status:'open',label:'project',titel:'Niet gekoppeld — klik om een project te kiezen',onclick:`ntkKoppel('${ibEsc(key)}',${i})`}):`<button class="btn btn-xs btn-primary" onclick="ntkKoppel('${ibEsc(key)}',${i})">✓ koppel</button>`}</div></div>`; }).join('');
}
async function ntkLaad(key,{forceer=false}={}){
  const st=_ntk[key]; if(!st) return;
  st.open=true;
  if(!forceer&&st.mails&&Date.now()-(st.ts||0)<600000){ ntkTeken(key); return; }
  const sinds=new Date(Date.now()-30*864e5).toISOString().slice(0,10);
  const q='('+st.domeinen.map(d=>'from:'+d).join(' OR ')+') AND received>='+sinds;
  const sel='id,internetMessageId,subject,from,receivedDateTime,hasAttachments,webLink,conversationId,bodyPreview';
  const bussen=[['info@mortiseandtenon.nl','https://graph.microsoft.com/v1.0/users/'+encodeURIComponent('info@mortiseandtenon.nl'),'info@'],
    [(typeof mtMijEmail==='function'&&mtMijEmail())||'me','https://graph.microsoft.com/v1.0/me','eigen postbus']];
  try{
    const lijsten=await Promise.all(bussen.map(async([mbx,base,label])=>{
      const d=await ibFetch(base+'/messages?$search='+encodeURIComponent('"'+q.replace(/"/g,'')+'"')+'&$top=25&$select='+sel);
      return ((d&&d.value)||[]).map(m=>Object.assign(m,{mbx:mbx==='me'?'me':mbx,mbxLabel:label}));
    }));
    const gezien=new Set(), alle=[];
    lijsten.flat().sort((a,b)=>String(b.receivedDateTime||'').localeCompare(String(a.receivedDateTime||''))).forEach(m=>{ const k=m.internetMessageId||m.id; if(!gezien.has(k)){ gezien.add(k); alle.push(m); } });
    st.mails=alle.slice(0,25); st.ts=Date.now(); st.fout=null;
  }catch(e){ st.fout='Zoeken mislukt: '+(e.message||e); st.mails=st.mails||[]; }
  ntkTeken(key);
}
function ntkTeken(key){
  const el=[...document.querySelectorAll('details.ntk')].find(d=>d.dataset.key===key); if(!el) return;
  const st=_ntk[key]; const n=el.querySelector('summary .dos-n'); if(n) n.textContent=st&&st.mails?String(st.mails.filter(m=>!MTKoppel.mailProjecten(m).length).length):'';
  const inh=el.querySelector('.ntk-inhoud'); if(inh) inh.innerHTML=ntkLijst(key);
}
function ntkKoppel(key,i){
  const st=_ntk[key]; const m=st&&st.mails&&st.mails[i]; if(!m) return;
  const sel=document.getElementById('ntk-sel-'+String(key).replace(/[^A-Za-z0-9]/g,'')+'-'+i);
  const code=sel?sel.value:st.codes[0]; if(!code) return;
  const r=MTKoppel.koppelMail(code,m,{bron:'voorstel',mbx:m.mbx,idType:'immutable'});
  if(typeof planToast==='function') planToast(r.status==='al'?'Was al gekoppeld aan '+code:'✓ Gekoppeld aan '+code);
  ntkTeken(key);
}
// Vanuit de geopende mail door naar het gekoppelde project (Projecten-tab, als link #projecten/<CODE>).
function inboxNaarProject(code){
  try{ if(window.track) track('inbox','naar_project',{detail:code}); }catch(e){}
  if(typeof mtRoute!=='undefined'){ mtRoute.go({tab:'projecten',code},{push:true}); return; }
  if(typeof tgNaarVolledigProject==='function'){ tgNaarVolledigProject(code); return; }
  if(typeof tbDoTab==='function') tbDoTab('projecten');
  if(typeof openProject==='function') openProject(code);
}

// ── Koppelvoorstellen (B9): staan sinds B11 in de popover van de koppel-badge (inboxKoppelPop) ──
function _ibUndoKoppel(links,tekst){
  _inbox.undo={soort:'koppel',links};
  inboxToast(tekst);
}
// Hele gesprek koppelen: alle mails met deze conversationId (uit de hele postbus), na bevestiging.
async function inboxKoppelGesprek(code,cid){
  if(!cid) return;
  let items=[];
  try{
    const sel='id,internetMessageId,subject,from,receivedDateTime,hasAttachments,webLink,conversationId,bodyPreview';
    let volgende=`/messages?$filter=`+encodeURIComponent("conversationId eq '"+cid.replace(/'/g,"''")+"'")+`&$select=${sel}&$top=50`, pag=0;
    while(volgende&&pag<10){ const d=await ibFetch(volgende); items=items.concat((d&&d.value)||[]); volgende=d&&d['@odata.nextLink']; pag++; }
    if(volgende){ ibMelding('Dit gesprek heeft meer dan '+items.length+' mails; alleen de eerste '+items.length+' worden gekoppeld.'); }
  }catch(e){ ibMelding('Gesprek ophalen mislukt: '+(e.message||e)); return; }
  const nieuw=items.filter(m=>!MTKoppel.mailProjecten(m).includes(code));
  if(!nieuw.length){ inboxToast('Alle mails van dit gesprek zijn al gekoppeld aan '+code); return; }
  const ok=await ibBevestig({title:'Hele gesprek koppelen',message:nieuw.length+' mail'+(nieuw.length>1?'s':'')+' van dit gesprek koppelen aan '+code+'?'+(items.length>nieuw.length?'\n('+(items.length-nieuw.length)+' waren al gekoppeld.)':''),okLabel:'Koppel '+nieuw.length});
  if(!ok) return;
  const gedaan=[];
  nieuw.forEach(m=>{ const r=MTKoppel.koppelMail(code,m,{bron:'voorstel',mbx:_inbox.mbx,idType:'immutable'}); if(r.status==='nieuw'||r.status==='herkoppeld') gedaan.push({code,sleutel:m.internetMessageId||m.id,id:m.id}); });
  _ibUndoKoppel(gedaan,'✓ '+gedaan.length+' mail'+(gedaan.length>1?'s':'')+' gekoppeld aan '+code);
  inboxRefreshKoppelKnop(); if(Array.isArray(_inbox.msgs)&&_inbox.msgs.length) inboxRenderList();
  if(_inbox.curThread&&_inbox.curThreadItems) inboxGesprekKoppelTekenen();
  if(typeof huidigProject!=='undefined'&&huidigProject&&huidigProject.code===code&&typeof renderProjectDetail==='function')renderProjectDetail(huidigProject);
}
// Gespreksweergave: gekoppelde projecten + voorstel + "gesprek koppelen…".
function inboxGesprekKoppelTekenen(){
  const el=document.getElementById('inbox-gesprek-koppel'); const items=_inbox.curThreadItems||[]; if(!el||!items.length) return;
  const codes=[...new Set(items.flatMap(m=>ibProjecten(m)))];
  const nieuwste=items[items.length-1], cid=nieuwste.conversationId||'';
  if(!_ibVoorstelIx&&window.MTKoppel) _ibVoorstelIx=MTKoppel.voorstelIndex();
  const v=(window.MTKoppel&&cid)?MTKoppel.koppelVoorstel(nieuwste,{index:_ibVoorstelIx,gesprek:items}).filter(x=>!codes.includes(x.code)):[];
  const st=codes.length?{status:'gekoppeld',label:(typeof projKort==='function'?projKort(codes[0]):codes[0])+(codes.length>1?' +'+(codes.length-1):''),titel:'Gesprek gekoppeld aan '+codes.map(c=>typeof projKort==='function'?projKort(c):c).join(', ')}
    :(v[0]?{status:'voorstel',label:(typeof projKort==='function'?projKort(v[0].code):v[0].code),titel:'Voorstel: '+v[0].redenen.join('; ')}:{status:'open',label:'gesprek'});
  el.innerHTML=(window.MTKoppelUI?MTKoppelUI.badge(Object.assign(st,{onclick:'inboxGesprekPop(this)'})):'')
    +(v[0]&&!codes.length?` <span class="ib-waarom">${items.length} mails · waarom: ${ibEsc(v[0].redenen.join('; '))}</span>`:'');
}
function inboxGesprekPop(el){
  const items=_inbox.curThreadItems||[]; if(!items.length||!window.MTKoppelUI) return;
  const codes=[...new Set(items.flatMap(m=>ibProjecten(m)))], nieuwste=items[items.length-1], cid=ibEsc(nieuwste.conversationId||'').replace(/'/g,'');
  if(!_ibVoorstelIx) _ibVoorstelIx=MTKoppel.voorstelIndex();
  const v=nieuwste.conversationId?MTKoppel.koppelVoorstel(nieuwste,{index:_ibVoorstelIx,gesprek:items}).filter(x=>!codes.includes(x.code)):[];
  let html=codes.map(c=>`<div class="kb-pop-rij">${MTKoppelUI.badge({status:'gekoppeld',klein:true,label:c})}<span class="kb-pop-n">${items.filter(m=>ibProjecten(m).includes(c)).length} van ${items.length} mails</span>
    <button class="btn btn-xs btn-secondary" onclick="MTKoppelUI.sluit();inboxNaarProject('${ibEsc(c).replace(/'/g,'')}')">Open</button>
    ${cid?`<button class="btn btn-xs btn-secondary" onclick="MTKoppelUI.sluit();inboxKoppelGesprek('${ibEsc(c).replace(/'/g,'')}','${cid}')">Rest ook koppelen</button>`:''}</div>`).join('');
  html+=v.map(o=>`<div class="kb-pop-rij"><div class="kb-pop-n"><b>${ibEsc((typeof projKort==='function'?projKort(o.code):o.code))}</b><div class="dos-meta">${ibEsc(o.redenen.join('; '))}</div></div>
    <button class="btn btn-xs btn-primary" onclick="MTKoppelUI.sluit();inboxKoppelGesprek('${ibEsc(o.code).replace(/'/g,'')}','${cid}')">✓ Koppel hele gesprek</button></div>`).join('');
  if(cid) html+=`<div class="kb-pop-acties"><button class="btn btn-xs btn-secondary" onclick="MTKoppelUI.sluit();inboxKoppelGesprekKies('${cid}')">🔍 Gesprek koppelen aan ander project…</button></div>`;
  MTKoppelUI.popover(el,html||'<div class="dos-meta">Geen gesprek-id; koppel de mails los.</div>',{titel:'Gesprek ('+items.length+' mails)'});
}
function inboxKoppelGesprekKies(cid){ _inbox.koppelModus={gesprek:cid}; inboxKoppelProject(); }
// Ververst alleen de koppel-knop in de geopende mail (na (ont)koppelen).
function inboxRefreshKoppelKnop(){
  _ibVoorstelIx=null;
  if(window.MTKoppelUI) MTKoppelUI.sluit();
  const w=document.getElementById('inbox-koppelwrap');
  if(w&&_inbox.cur){w.innerHTML=inboxKoppelKnopHtml(_inbox.cur);}
  else{const b=document.getElementById('inbox-koppelknop');if(b&&_inbox.cur)b.outerHTML=inboxKoppelKnopHtml(_inbox.cur);}
  // Lijst-rij(en) opnieuw tekenen zodat de 🔗-chip + tint meteen kloppen.
  // Via het centrale render-pad zodat ook de gespreksmodus correct blijft.
  if(Array.isArray(_inbox.msgs)&&_inbox.msgs.length){ inboxRenderList(); }
}

// Ontkoppelen — altijd eerst waarschuwen. Tombstone + journaal via MTKoppel.
async function inboxOntkoppel(code){
  const m=_inbox.cur; if(!m||!code) return;
  return ibOntkoppelVia(m.id,code);
  const ok=await ibBevestig({title:'Mail ontkoppelen',message:'⚠️ Let op — deze mail is gekoppeld aan project '+code+'.\n'
    +'Koppeling verbreken?\n\n(De mail zelf blijft gewoon in Outlook staan.)',okLabel:'Ontkoppelen',danger:true});
  if(!ok) return;
  const n=MTKoppel.ontkoppelMail(code,m.internetMessageId||m.id,{id:m.id});
  inboxToast(n?'Koppeling met '+code+' verbroken':'Deze mail was niet (meer) gekoppeld aan '+code);
  inboxRefreshKoppelKnop();
  if(typeof huidigProject!=='undefined'&&huidigProject&&huidigProject.code===code&&typeof renderProjectDetail==='function')renderProjectDetail(huidigProject);
}
// Oude ingang: bij meerdere projecten eerst kiezen welke koppeling weg moet.
async function inboxOntkoppelHuidige(){
  const m=_inbox.cur; if(!m) return;
  const codes=ibProjecten(m); if(!codes.length){ inboxKoppelProject(); return; }
  if(codes.length===1) return inboxOntkoppel(codes[0]);
  const i=(typeof mtDialog!=='undefined')?await mtDialog.choose({title:'Welke koppeling verbreken?',message:'Deze mail hangt aan '+codes.length+' projecten.',choices:codes.map(c=>({label:c}))}):null;
  if(i!==null&&i!==undefined&&codes[i]) return inboxOntkoppel(codes[i]);
}

function inboxKoppelProject(){
  const gesprek=_inbox.koppelModus&&_inbox.koppelModus.gesprek, losseMail=_inbox.koppelModus&&_inbox.koppelModus.mail;
  if(!_inbox.cur&&!gesprek&&!losseMail){ibMelding('Open eerst een mail.');return;}
  if(!PROJECT_CODES.length){_inbox.koppelModus=null;ibMelding('Er zijn nog geen projecten om aan te koppelen.');return;}
  const items=gesprek?(_inbox.curThreadItems||[]):[losseMail||_inbox.cur];
  const al=new Set(items.flatMap(m=>ibProjecten(m)));
  const oud=document.getElementById('koppel-overlay');if(oud)oud.remove();
  const ov=document.createElement('div');ov.id='koppel-overlay';
  ov.style.cssText='position:fixed;inset:0;background:rgba(28,26,22,.45);z-index:10000;display:flex;align-items:center;justify-content:center';
  ov.onclick=e=>{if(e.target===ov){ov.remove();_inbox.koppelModus=null;}};
  const lijst=PROJECT_CODES.map(p=>`<div class="kp-row" data-zoek="${ibEsc((p.code+' '+(p.naam||'')+' '+(p.klant||'')).toLowerCase())}" onclick="inboxKoppelProjectDo('${ibEsc(p.code).replace(/'/g,'')}')" style="padding:8px 10px;border-radius:var(--radius-sm);cursor:pointer">
      <div style="font-weight:600;font-size:13px">${ibEsc(typeof projNaamVol==='function'?projNaamVol(p):(p.naam||p.code))}</div>
      <div style="font-size:11px;color:var(--text-dim)">${typeof projLabelCode==='function'?(projLabelCode(p)?`<span style="font-family:var(--mono)">${ibEsc(projLabelCode(p))}</span> · `:''):`<span style="font-family:var(--mono)">${ibEsc(p.code)}</span> · `}${ibEsc((typeof projKlantNaam==='function'&&projKlantNaam(p))||'')}${al.has(p.code)&&window.MTKoppelUI?' '+MTKoppelUI.badge({status:'gekoppeld',klein:true}):''}</div>
    </div>`).join('');
  ov.innerHTML=`<div style="background:var(--surface-overlay,#fff);border-radius:var(--radius-lg);box-shadow:var(--shadow-pop);width:440px;max-width:calc(100vw - 32px);max-height:80vh;display:flex;flex-direction:column;overflow:hidden">
    <div style="padding:14px 16px;border-bottom:1px solid var(--border)">
      <div style="font-weight:700;font-size:15px;margin-bottom:2px">🔗 ${gesprek?'Gesprek ('+items.length+' mails)':'Mail'} koppelen aan project</div>
      <div style="font-size:11.5px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ibEsc(((items[items.length-1]||{}).subject)||'(geen onderwerp)')}</div>
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
  if(_inbox.koppelModus&&_inbox.koppelModus.gesprek){
    const cid=_inbox.koppelModus.gesprek; _inbox.koppelModus=null;
    const ov=document.getElementById('koppel-overlay');if(ov)ov.remove();
    return inboxKoppelGesprek(code,cid);
  }
  if(_inbox.koppelModus&&_inbox.koppelModus.mail){
    const lm=_inbox.koppelModus.mail; _inbox.koppelModus=null;
    const ov=document.getElementById('koppel-overlay');if(ov)ov.remove();
    if(!(_inbox.cur&&_inbox.cur.id===lm.id)) return ibKoppelVia(lm.id,code,'hand');
  }
  const m=_inbox.cur;if(!m)return;
  const r=MTKoppel.koppelMail(code,m,{bron:'hand',mbx:_inbox.mbx,idType:'immutable'});   // eerder ontkoppeld → zelfde record weer actief
  if(r.status==='nieuw'||r.status==='herkoppeld') _inbox.undo={soort:'koppel',links:[{code,sleutel:m.internetMessageId||m.id,id:m.id}]};
  if(r.status==='al'){inboxToast('Deze mail was al gekoppeld aan '+code);}
  else if(r.status==='fout'){inboxToast('Koppelen mislukt: deze mail heeft geen id');}
  else{
    const nAct=mailLinksVoor(code).length;
    inboxToast('✓ Mail gekoppeld aan '+code+' ('+nAct+' mail'+(nAct>1?'s':'')+')');
    inboxRefreshKoppelKnop();
    if(typeof huidigProject!=='undefined'&&huidigProject&&huidigProject.code===code&&typeof renderProjectDetail==='function')renderProjectDetail(huidigProject);
    // Bijlagen: NIET meer stil. Eerst vragen; opslaan overschrijft nooit iets
    // (zelfde inhoud = overslaan, zelfde naam/andere inhoud = nieuwe naam).
    if(m.hasAttachments) inboxBijlagenVraag(m.id,code);
  }
  const ov=document.getElementById('koppel-overlay');if(ov)ov.remove();
}
// Vanuit het project terug naar de gekoppelde mail in de inbox.
async function openGekoppeldeMail(code,idx){
  const x=mailLinksVoor(code)[idx];if(!x)return;
  tbDoTab('inbox');
  const mbx=x.mbx||INBOX_DEFAULT;   // oude koppeling zonder mailbox = info@ (zelfde regel als MTKoppel)
  if(_inbox.mbx!==mbx){const sel=document.getElementById('inbox-mailbox');if(sel)sel.value=mbx;_inbox.mbx=mbx;_inbox.loaded=false;}
  if(!_inbox.loaded){await inboxReload();}
  // 1) immutable id (blijft gelijk na verplaatsen), 2) het oorspronkelijke id,
  // 3) terugval: zoeken op internetMessageId. Gevonden via 3 → iid bijschrijven (oud id blijft).
  let m=null;
  if(x.iid) m=await inboxOpenMail(x.iid);
  if(!m&&x.id&&x.id!==x.iid) m=await inboxOpenMail(x.id);
  if(!m&&x.internetMessageId){
    try{
      const d=await ibFetch('/messages?$filter='+encodeURIComponent("internetMessageId eq '"+String(x.internetMessageId).replace(/'/g,"''")+"'")+'&$select=id&$top=2');
      const hits=(d&&d.value)||[];
      if(hits.length){
        // Meerdere treffers = kopieën van dezelfde mail (zelfde Message-ID) in meerdere mappen:
        // wel tonen, maar dan geen iid vastleggen (niet eenduidig).
        m=await inboxOpenMail(hits[0].id);
        if(m&&hits.length===1&&window.MTKoppel) MTKoppel.idBijwerken(mailLinkIdent(x),hits[0].id,{code,mbx});
        else if(m&&hits.length>1) inboxToast('Let op: deze mail staat meerdere keren in de mailbox — de eerste kopie is geopend.');
      }
    }catch(e2){}
  }
  if(!m) inboxToast('Mail niet te openen (verplaatst/verwijderd?) — gebruik ↗ Outlook.');
}
// Bijlagen van de geopende mail naar de map van het gekoppelde project.
async function inboxBijlagenNaarMap(){
  const m=_inbox.cur; if(!m){ibMelding('Open eerst een mail.');return;}
  const codes=ibProjecten(m);
  if(!codes.length){ibMelding('Koppel deze mail eerst aan een project (🔗) — dan weet ik in welke klantmap de bijlagen horen.');return;}
  if(!m.hasAttachments){inboxToast('Deze mail heeft geen bijlagen.');return;}
  let code=codes[0];
  if(codes.length>1&&typeof mtDialog!=='undefined'){
    const i=await mtDialog.choose({title:'Bijlagen naar welk project?',message:'Deze mail hangt aan meerdere projecten.',choices:codes.map(c=>({label:c}))});
    if(i===null||i===undefined) return; code=codes[i];
  }
  inboxBijlagenDialoog(m.id,code);
}

// ── Bijlagen → projectmap (brok 4): per bijlage een voorgestelde submap, de mens
// bevestigt per bijlage. Opslaan = KOPIE (mail blijft in Outlook), nooit
// overschrijven (spUploadProjectBytes: zelfde inhoud overslaan, anders rename).
// Bijlage-index (mt_bijlage_index, gesynct, eigen samenvoeger) onthoudt wat al is
// opgeslagen: identiteit = mailbox + mail + bijlage-id (+ sha256 van de inhoud).
const IB_SUBMAPPEN=['01_Offerte','02_Ontwerp','03_Vectorworks','04_Holzher','05_Aangeleverd',
  '06_Fotos','07_Administratie','08_Archief','09_Werktekeningen','10_CNC'];
// Voorstel op bestandstype en naam. Bij twijfel: 05_Aangeleverd (zoals vroeger).
function ibSubmapVoorstel(naam,type){
  const n=String(naam||'').toLowerCase(), ext=(n.match(/\.([a-z0-9]+)$/)||[])[1]||'', t=String(type||'').toLowerCase();
  if(/^(vwx|vwxp|vwxw|mcd)$/.test(ext)) return '03_Vectorworks';
  if(/^(hop|hops|hhos)$/.test(ext)) return '04_Holzher';
  if(/^(ncr|mpr|mprx|pgmx|nc|cnc|xcs|bpp)$/.test(ext)) return '10_CNC';
  if(/offerte|prijsopgave|quotation|\bquote\b|aanbieding/.test(n)) return '01_Offerte';
  if(/factuur|invoice|pakbon|orderbevestiging|order confirmation|bestelbevestiging/.test(n)) return '07_Administratie';
  if(/werktekening|productietekening|shop ?drawing/.test(n)) return '09_Werktekeningen';
  if(/schets|ontwerp|render|impressie|moodboard|sketch/.test(n)||/^(skp|3dm)$/.test(ext)) return '02_Ontwerp';
  if(/^image\//.test(t)||/^(jpe?g|png|heic|heif|webp|gif|tiff?)$/.test(ext)) return '06_Fotos';
  return '05_Aangeleverd';
}
function ibBijlageIndexAll(){ try{ const v=JSON.parse(localStorage.getItem('mt_bijlage_index')||'[]'); return Array.isArray(v)?v:[]; }catch(e){ return []; } }
function ibBijlageIndexZet(rec){
  const all=ibBijlageIndexAll(), i=all.findIndex(x=>x.id===rec.id);
  if(i>=0) all[i]=Object.assign({},all[i],rec); else all.push(rec);
  localStorage.setItem('mt_bijlage_index',JSON.stringify(all));
}
async function ibSha256(bytes){
  try{ const h=await crypto.subtle.digest('SHA-256',bytes); return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join(''); }
  catch(e){ return ''; }
}
// Na koppelen (en via de knop 📎): het bijlagen-venster openen. Niets gebeurt zonder klik.
async function inboxBijlagenVraag(mailId,code){ return inboxBijlagenDialoog(mailId,code); }
async function inboxBijlagenNaarProject(mailId,code){ return inboxBijlagenDialoog(mailId,code); }   // oude naam, zelfde veilige route

let _ibBijl=null;   // {mailId, code, mbx, imid, items:[…]}
async function inboxBijlagenDialoog(mailId,code){
  const proj=(typeof projVind==='function'?projVind(code):PROJECT_CODES.find(p=>p.code===code));
  if(!proj){ inboxToast('Project '+code+' niet gevonden.'); return; }
  if(typeof window.spUploadProjectBytes!=='function'){ inboxToast('SharePoint-upload niet beschikbaar (ingelogd op M365?).'); return; }
  try{
    ibStatus('Bijlagen ophalen…');
    // Bewust zonder $select: dan komt @odata.type gegarandeerd mee (file vs. doorgestuurde mail/link).
    const a=await ibFetch(`/messages/${mailId}/attachments`);
    ibStatus('');
    const alle=(a&&a.value)||[];
    const items=alle.filter(x=>{ const t=String(x['@odata.type']||''); return !x.isInline && !t.includes('itemAttachment') && !t.includes('referenceAttachment'); });
    const overig=alle.length-items.length-alle.filter(x=>x.isInline).length;   // bv. doorgestuurde mail / OneDrive-link
    if(!items.length){ inboxToast(alle.length?'Alleen ingesloten bijlagen (bv. handtekeninglogo\'s) — niets op te slaan.':'Deze mail heeft geen bijlagen.'); return; }
    const m=_inbox.cur&&_inbox.cur.id===mailId?_inbox.cur:null;
    const imid=(m&&m.internetMessageId)||mailId, idx=ibBijlageIndexAll();
    _ibBijl={mailId,code,mbx:_inbox.mbx,imid,items:items.map(x=>{
      const id=_inbox.mbx+'|'+imid+'|'+x.id, naam=x.name||'bijlage';
      // Terugval op naam (bijlage-id's wisselen met de id-vorm van de mail): alleen als die naam
      // uniek is in deze mail, en de grootte klopt wanneer die bekend is.
      const uniek=items.filter(y=>(y.name||'bijlage')===naam).length===1;
      const al=idx.find(r=>r.id===id&&r.status==='opgeslagen'&&r.code===code)
        ||(uniek?idx.find(r=>r.status==='opgeslagen'&&r.code===code&&r.mbx===_inbox.mbx&&r.imid===imid&&r.naam===naam&&(r.grootte==null||r.grootte===x.size)):null);
      return {attId:x.id,naam:x.name||'bijlage',type:x.contentType||'',grootte:x.size||0,id,sub:al?al.sub:ibSubmapVoorstel(x.name,x.contentType),aan:!al,al};
    })};
    const rij=(it,i)=>`<tr>
      <td style="padding:4px 6px"><input type="checkbox" ${it.aan?'checked':''} onchange="_ibBijl.items[${i}].aan=this.checked"></td>
      <td style="padding:4px 6px;font-size:12px;word-break:break-all">${ibEsc(it.naam)} <span style="color:var(--text-faint)">(${Math.max(1,Math.round(it.grootte/1024))} kB)</span>
        ${it.al?`<div style="font-size:10px">${window.MTKoppelUI?MTKoppelUI.badge({status:'gekoppeld',klein:true,label:it.al.sub,titel:'Al opgeslagen in de projectmap ('+it.al.sub+')'}):'✓ al opgeslagen in '+ibEsc(it.al.sub)}${it.al.webUrl?` · <a href="${ibEsc(it.al.webUrl)}" target="_blank">openen</a>`:''}</div>`:''}</td>
      <td style="padding:4px 6px"><select onchange="_ibBijl.items[${i}].sub=this.value" style="font-size:12px">${IB_SUBMAPPEN.map(s=>`<option${s===it.sub?' selected':''}>${s}</option>`).join('')}</select></td>
    </tr>`;
    const oud=document.getElementById('bijl-overlay'); if(oud) oud.remove();
    const ov=document.createElement('div'); ov.id='bijl-overlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(28,26,22,.45);z-index:10000;display:flex;align-items:center;justify-content:center';
    ov.onclick=e=>{ if(e.target===ov) ov.remove(); };
    ov.innerHTML=`<div style="background:var(--surface-overlay,#fff);border-radius:var(--radius-lg);box-shadow:var(--shadow-pop);width:620px;max-width:calc(100vw - 32px);max-height:85vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid var(--border)">
        <div style="font-weight:700;font-size:15px">📎 Bijlagen opslaan in ${ibEsc((typeof projKort==='function'?projKort(code):code))}</div>
        <div style="font-size:11.5px;color:var(--text-dim);margin-top:2px">Kopie in de projectmap — de mail blijft in Outlook. Er wordt niets overschreven: staat een bestand er al precies zo, dan wordt het overgeslagen; heet er al een ánder bestand zo, dan krijgt het nieuwe een eigen naam.</div>
      </div>
      <div style="overflow:auto;padding:6px 10px"><table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:10px;text-transform:uppercase;color:var(--text-faint)"><th></th><th style="text-align:left">Bijlage</th><th style="text-align:left">Submap (voorstel)</th></tr></thead><tbody>${_ibBijl.items.map(rij).join('')}</tbody></table>
      ${overig>0?`<p style="font-size:11px;color:var(--gold-text,#8a6d1f);margin:6px 2px">⚠ ${overig} bijlage(n) zijn een doorgestuurde mail of een link en kunnen niet als bestand worden opgeslagen — open ze in Outlook.</p>`:''}</div>
      <div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-sm btn-secondary" onclick="document.getElementById('bijl-overlay').remove()">Annuleren</button>
        <button class="btn btn-sm btn-primary" onclick="inboxBijlagenOpslaan()">Aangevinkte opslaan</button>
      </div></div>`;
    document.body.appendChild(ov);
  }catch(e){ ibStatus(''); inboxToast('⚠ Bijlagen ophalen mislukt: '+e.message); }
}
async function inboxBijlagenOpslaan(){
  const st=_ibBijl; if(!st) return;
  const proj=(typeof projVind==='function'?projVind(st.code):PROJECT_CODES.find(p=>p.code===st.code)); if(!proj) return;
  const ov=document.getElementById('bijl-overlay'); if(ov) ov.remove();
  const gekozen=st.items.filter(it=>it.aan);
  if(!gekozen.length){ inboxToast('Niets aangevinkt — niets opgeslagen.'); return; }
  let ok=0,fout=0,laatsteFout=''; const al=[],hernoemd=[];
  for(const it of gekozen){
    try{
      ibStatus(`Opslaan ${ok+fout+al.length+1}/${gekozen.length}: ${it.naam}…`);
      const one=await ibFetch(`/messages/${st.mailId}/attachments/${it.attId}`);
      const b64=one&&one.contentBytes; if(!b64) throw new Error('geen inhoud ontvangen');
      const bin=atob(b64), arr=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
      const hash=await ibSha256(arr);
      // outbox-stap 1: voorbereid (bij een crash hierna dedupliceert de upload op inhoud)
      ibBijlageIndexZet({id:it.id,mbx:st.mbx,imid:st.imid,mailId:st.mailId,attId:it.attId,naam:it.naam,grootte:it.grootte,hash,code:st.code,sub:it.sub,status:'voorbereid',tijd:new Date().toISOString()});
      const res=await window.spUploadProjectBytes(proj,it.naam,arr,it.type,it.sub);
      ibBijlageIndexZet({id:it.id,status:'opgeslagen',itemId:res.id,webUrl:res.webUrl,opgeslagenAls:res.naam,uitkomst:res.status,tijd:new Date().toISOString()});
      if(res.status==='al-aanwezig') al.push(it.naam);
      else { ok++; if(res.status==='hernoemd') hernoemd.push(it.naam+' → '+res.naam); }
    }catch(e){ fout++; laatsteFout=e.message; ibBijlageIndexZet({id:it.id,status:'mislukt',fout:String(e.message||e).slice(0,160),tijd:new Date().toISOString()}); console.warn('bijlage opslaan mislukt:',it.naam,e.message); }
  }
  ibStatus('');
  try{ if(window.track) track('inbox','bijlagen_naar_map',{detail:st.code+' · '+ok+'/'+gekozen.length,ok:fout===0}); }catch(e){}
  const delen=[];
  if(ok) delen.push(`${ok} opgeslagen`);
  if(al.length) delen.push(`${al.length} stond${al.length===1?'':'en'} er al (overgeslagen)`);
  if(hernoemd.length) delen.push(`nieuwe naam omdat er al een ander bestand zo heette: ${hernoemd.join(', ')}`);
  if(fout) delen.push(`${fout} mislukt${laatsteFout?' ('+laatsteFout+')':''} — probeer opnieuw via 📎`);
  inboxToast((fout?'⚠ ':'📎 ')+'Bijlagen '+st.code+': '+delen.join(' · '));
  if(typeof huidigProject!=='undefined'&&huidigProject&&huidigProject.code===st.code&&window._dossierMap) delete window._dossierMap[st.code];
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
