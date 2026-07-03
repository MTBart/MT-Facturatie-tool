/* ============================================================================
 * mt-toggl.js — de Toggl-/Uren-tab van de cockpit (v2.html)
 * ----------------------------------------------------------------------------
 * Afgesplitst uit v2.html (audit 2026-07-02, actie S3). PURE VERPLAATSING:
 * dezelfde functies, hetzelfde gedrag, alleen uit het monster-script geknipt
 * zodat v2.html krimpt en Toggl-edits niet meer in een bestand van 12k regels
 * hoeven. Bevat de Focus-aansturing (focus*), de Track+Focus-tab (tg*), de
 * timeline, timer, projecten, taken, board, reports en clients/tags-beheer.
 *
 * GEEN build-pipeline en BEWUST GEEN IIFE-wrapper: dit is een klassiek
 * <script src="mt-toggl.js?v=..."> dat VÓÓR het inline monster-script van
 * v2.html laadt (na mt-core.js). De top-level `const`/`let`/`function`-
 * declaraties komen zo in dezelfde gedeelde globale (lexicale) scope als de
 * rest van v2.html — precies waar ze eerst stonden. Een IIFE zou TG_WS /
 * _tgCache / tgStore verbergen voor het monster-script, dat er wél naar
 * verwijst (o.a. _tgCache in de projecten/taken-code). Daarom bewust plat.
 *
 * AFHANKELIJKHEDEN op globals die elders in v2.html blijven wonen (allemaal
 * runtime-resolve — dit bestand voert bij load NIETS uit, dus de volgorde
 * t.o.v. het monster-script maakt niet uit zolang niets vóór page-init draait):
 *   - uit mt-core.js : esc, authHeader
 *   - Worker/util    : WORKER
 *   - agenda-laag    : agMaandag, agFmt, agEntries, agUur, agProjChip,
 *                      agBlokkenHtml, AG_START, AG_EIND, AG_UURPX,
 *                      agSyncEigen, agNamen, agNames
 *   - admin/audit    : admCfg, mtIsAdmin, auditLog, getAdmin
 *   - projecten-laag : PROJECT_CODES, huidigProject, resolveKlantNaam,
 *                      resolveMbContact, gekoppeldeMailsHtml, slaProjectenOp,
 *                      _tgProjectIdVoorMt, openModal, tbDoTab,
 *                      renderProjectLijst, selecteerProject, renderProjectDetail
 *   - tracking       : window.track (optioneel, altijd achter een guard)
 *
 * OMGEKEERD gebruikt v2.html deze symbolen uit dit bestand: focusOpen,
 * focusLaadTaken, focusZetStatus, focusMaakEntry, tgOpen, tgMaakProjectVoorCode,
 * tgTrack, TG_WS, tgStore, _tgCache (+ alle onclick-handlers in de HTML).
 * ========================================================================== */

// ═══ TOGGL FOCUS — 1-op-1 aansturen (Fase 3) ═══
// Live writes via de Worker (target=toggl_focus, Bearer server-side). Org+ws vast.
const FOCUS_ORG=21259253, FOCUS_WS=21258443;
const FOCUS_BASE_PATH=`organizations/${FOCUS_ORG}/workspaces/${FOCUS_WS}/`;
async function focusFetch(path,method='GET',body=null){
  const h=await authHeader();
  if(!h['X-Auth-Token']) throw new Error('Microsoft-login vereist (log in via de tool)');
  const opts={method,headers:{...h,'Content-Type':'application/json'}};
  if(body) opts.body=JSON.stringify(body);
  const res=await fetch(`${WORKER}?target=toggl_focus&path=${encodeURIComponent(FOCUS_BASE_PATH+path)}`,opts);
  if(res.status===204) return true;
  const txt=await res.text();
  if(!res.ok) throw new Error('Focus HTTP '+res.status+(txt?(' — '+txt.slice(0,120)):''));
  try{return JSON.parse(txt);}catch(e){return txt;}
}
function focusStatus(msg,kleur){const el=document.getElementById('focus-status');if(el){el.textContent=msg;el.style.color=kleur||'var(--text-faint)';}}
function focusOpen(){
  const dt=document.getElementById('focus-datum'); if(dt&&!dt.value) dt.value=new Date().toISOString().slice(0,10);
  document.getElementById('focus-modal').classList.remove('hidden');
  focusStatus('');
}
async function focusLaadTaken(){
  focusStatus('Taken laden…');
  try{
    let alle=[],page=1;
    while(page<=10){
      const r=await focusFetch(`tasks?page=${page}`);
      const data=Array.isArray(r)?r:(r&&r.data)||[];
      if(!data.length) break;
      alle=alle.concat(data); page++;
      if(data.length<20) break;
    }
    const sel=document.getElementById('focus-taak');
    if(!alle.length){sel.innerHTML='<option value="">— geen taken gevonden —</option>';focusStatus('Geen taken.');return;}
    sel.innerHTML=alle.map(t=>`<option value="${t.id}">${(t.name||'taak '+t.id).replace(/</g,'&lt;')}</option>`).join('');
    focusStatus(`✓ ${alle.length} taken geladen`,'var(--text-faint)');
  }catch(e){focusStatus('❌ '+e.message,'#c0392b');}
}
async function focusZetStatus(statusId){
  const sel=document.getElementById('focus-taak'); const taskId=sel&&sel.value;
  if(!taskId){focusStatus('⚠ Kies eerst een taak.','#b8962e');return;}
  const naam=sel.options[sel.selectedIndex].text;
  const labels={300785:'Todo',300788:'In Progress',300786:'Done'};
  if(!confirm(`Taak "${naam}" → status ${labels[statusId]||statusId} in Toggl Focus?`)) return;
  focusStatus('Status zetten…');
  try{ await focusFetch(`tasks/${taskId}`,'PATCH',{status_id:statusId});
    focusStatus(`✓ "${naam}" → ${labels[statusId]||statusId}`,'#2A4A38');
  }catch(e){focusStatus('❌ '+e.message,'#c0392b');}
}
async function focusMaakEntry(){
  const sel=document.getElementById('focus-taak'); const taskId=sel&&sel.value;
  if(!taskId){focusStatus('⚠ Kies eerst een taak.','#b8962e');return;}
  const datum=document.getElementById('focus-datum').value;
  const tijd=document.getElementById('focus-start').value||'09:00';
  const min=parseInt(document.getElementById('focus-duur').value)||0;
  const oms=document.getElementById('focus-oms').value||'';
  if(!datum||min<=0){focusStatus('⚠ Datum + duur (min) invullen.','#b8962e');return;}
  const startLocal=new Date(`${datum}T${tijd}:00`);
  const startISO=startLocal.toISOString().replace(/\.\d{3}Z$/,'Z');
  const dur=min*60; const naam=sel.options[sel.selectedIndex].text;
  if(!confirm(`Entry van ${min} min op "${naam}" (${datum} ${tijd}) aanmaken in Toggl Focus?`)) return;
  focusStatus('Entry aanmaken…');
  try{
    // POST dropt task_id silently → daarna PATCH om te koppelen.
    const made=await focusFetch('time-entries','POST',{start:startISO,duration:dur,description:oms,type:'activity'});
    const id=made&&(made.id||(made.data&&made.data.id));
    if(id){ try{await focusFetch(`time-entries/${id}`,'PATCH',{task_id:parseInt(taskId)});}catch(e){} }
    focusStatus(`✓ Entry aangemaakt${id?' (id '+id+')':''}. Undo: verwijder 'm in Focus of klik hieronder.`,'#2A4A38');
    if(id){ const el=document.getElementById('focus-status');
      const b=document.createElement('button'); b.className='btn btn-sm btn-secondary'; b.style.marginLeft='8px'; b.textContent='↩ Verwijder deze entry';
      b.onclick=async()=>{ if(!confirm('Deze zojuist gemaakte entry verwijderen?'))return; try{await focusFetch(`time-entries/${id}`,'DELETE');focusStatus('✓ Entry verwijderd (undo).','var(--text-faint)');}catch(e){focusStatus('❌ '+e.message,'#c0392b');} };
      el.appendChild(b);
    }
  }catch(e){focusStatus('❌ '+e.message,'#c0392b');}
}

// ═══ TOGGL-TAB — volledige Track + Focus aansturing via de Worker ═══
// Data-laag tgStore: nu backend 'toggl' (Track api/v9 + Reports v3 + Focus),
// later 'lokaal' (SharePoint/localStorage) als config-switch (tgLokaal = stub).
// Geen Toggl-tokens in de browser: alles loopt via de Worker (MS-login volstaat).
const TG_WS=21258443, TG_ORG=21259253;
const TG_STATUS=[ // Focus-statussen (id→label+kleur); volgorde = board-kolommen
  {id:300785,label:'Todo',kleur:'#6b7280'},
  {id:314194,label:'Backlog',kleur:'#9ca3af'},
  {id:300788,label:'In Progress',kleur:'#2563eb'},
  {id:300787,label:'Blocked',kleur:'#c0392b'},
  {id:309790,label:'Klaar voor levering',kleur:'#B8962E'},
  {id:300786,label:'Done',kleur:'#2A4A38'}
];
// Focus-prioriteit: API-veld = string (P1/P2/P3 in de UI). null/'' = geen.
const TG_PRIO=[
  {v:'',label:'—',kort:'',kleur:'#c8c8c8'},
  {v:'low',label:'P3 Laag',kort:'P3',kleur:'#6b7280'},
  {v:'medium',label:'P2 Middel',kort:'P2',kleur:'#B8962E'},
  {v:'high',label:'P1 Hoog',kort:'P1',kleur:'#c0392b'}
];
function tgPrioById(v){return TG_PRIO.find(p=>p.v===(v||''))||{label:String(v),kort:String(v),kleur:'#6b7280'};}
let _tgTimer={entry:null,tick:null};      // lopende Track-timer
let _tgCache={projecten:null,taken:null}; // licht sessie-cachen
let _tgRecent=[];                          // laatst geladen eigen entries (voor "hervat")
let _tgDrag=null;                          // board drag-state

// — laag-niveau transports (alle via Worker) —
async function tgTrack(path,method='GET',body=null){
  const h=await authHeader();
  if(!h['X-Auth-Token']) throw new Error('Microsoft-login vereist (log in via de tool)');
  const opts={method,headers:{...h}};
  if(body){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}
  const res=await fetch(`${WORKER}?target=toggl&path=${encodeURIComponent(path)}`,opts);
  if(res.status===204) return true;
  const txt=await res.text();
  if(!res.ok) throw new Error('Track HTTP '+res.status+(txt?(' — '+txt.slice(0,140)):''));
  try{return JSON.parse(txt);}catch(e){return txt;}
}
async function tgReports(body){
  const h=await authHeader();
  if(!h['X-Auth-Token']) throw new Error('Microsoft-login vereist');
  const res=await fetch(`${WORKER}?target=toggl_reports&path=${encodeURIComponent(`workspace/${TG_WS}/search/time_entries`)}`,
    {method:'POST',headers:{...h,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!res.ok) throw new Error('Reports HTTP '+res.status);
  return res.json();
}
async function tgFocusPaged(resource){
  let alle=[],page=1;
  while(page<=30){
    const r=await focusFetch(`${resource}?page=${page}`);
    const data=(r&&r.data)||(Array.isArray(r)?r:[]);
    if(!data.length) break;
    alle=alle.concat(data);
    if(data.length<20) break;
    page++;
  }
  return alle;
}
// — tgStore: hoog-niveau, backend-onafhankelijk —
const tgStore={
  backend:'toggl',
  async projecten(){ return this.backend==='lokaal'?tgLokaal.projecten():tgFocusPaged('projects'); },
  async taken(){ return this.backend==='lokaal'?tgLokaal.taken():tgFocusPaged('tasks'); },
  async clients(){ return this.backend==='lokaal'?tgLokaal.clients():((await tgTrack(`workspaces/${TG_WS}/clients`))||[]); },
  async tags(){ return this.backend==='lokaal'?tgLokaal.tags():((await tgTrack(`workspaces/${TG_WS}/tags`))||[]); },
  async lopendeTimer(){ return this.backend==='lokaal'?tgLokaal.lopendeTimer():tgTrack('me/time_entries/current'); },
  async eigenEntries(since,tot){ return this.backend==='lokaal'?tgLokaal.eigenEntries(since,tot):((await tgTrack(`me/time_entries?start_date=${since}&end_date=${tot}`))||[]); }
};
// stub voor latere standalone-modus (Toggl wordt dan optionele sync i.p.v. bron)
const tgLokaal={
  projecten(){return [];}, taken(){return [];}, clients(){return [];}, tags(){return [];},
  lopendeTimer(){return null;}, eigenEntries(){return [];}
  /* TODO standalone: lees/schrijf SharePoint-privé of localStorage; sync-laag naar Toggl. */
};

// — helpers —
function tgStatus(msg,kleur){const el=document.getElementById('tg-status');if(el){el.textContent=msg||'';el.style.color=kleur||'var(--text-faint)';}}
function tgEsc(s){return esc(s);}   // alias van de canonieke esc() bovenin — zelfde map, veel bestaande callers
function tgSec2hms(sec){sec=Math.max(0,Math.round(sec));const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');}
function tgSec2u(sec){return (sec/3600).toFixed(1).replace('.',',')+'u';}
function tgStatusById(id){return TG_STATUS.find(s=>s.id===id)||{label:'?',kleur:'#9a9a9a'};}

function tgOpen(){
  tgSub('timer',document.querySelector('#tab-toggl .tg-subtab'));
  const van=document.getElementById('tg-rep-van'), tot=document.getElementById('tg-rep-tot');
  if(van&&!van.value) van.value=new Date(Date.now()-30*864e5).toISOString().slice(0,10);
  if(tot&&!tot.value) tot.value=new Date().toISOString().slice(0,10);
  tgVulProjectSelect();
  tgTimerSync();
  tgLaadRecent();
}
function tgSub(name,btn){
  document.querySelectorAll('#tab-toggl .tg-subcontent').forEach(c=>c.classList.remove('active'));
  document.querySelectorAll('#tab-toggl .tg-navitem').forEach(b=>b.classList.remove('active'));
  const c=document.getElementById('tg-sub-'+name); if(c) c.classList.add('active');
  if(btn) btn.classList.add('active');
  if(name==='timeline') tgTimeline();
  if(name==='projecten' && !_tgCache.projecten) tgLaadProjecten();
  if(name==='taken' && !_tgCache.taken) tgLaadTaken();
  if(name==='board') tgLaadBoard();
  if(name==='beheer') tgLaadBeheer();
}

// ── TIMELINE (Toggl-2.0 kalender in de Uren-tab; hergebruikt de agenda-bouwstenen) ──
let _tgTl={weekStart:null};
function tgTimeline(){
  if(!_tgTl.weekStart) _tgTl.weekStart=agMaandag(new Date());
  tgTlRender();
  try{ if(window.track) track('toggl','timeline_open',{detail:agFmt(_tgTl.weekStart)}); }catch(e){}
  // Nog nooit gesynct? Haal stil de zichtbare week op.
  if(!localStorage.getItem('mt_toggl_last_sync')) tgTlSync();
}
function tgTlWeek(delta){ _tgTl.weekStart=new Date((_tgTl.weekStart||agMaandag(new Date())).getTime()+delta*7*864e5); tgTlRender(); }
function tgTlVandaag(){ _tgTl.weekStart=agMaandag(new Date()); tgTlRender(); }
async function tgTlSync(){
  const st=document.getElementById('tg-tl-status'); if(st){st.style.color='';st.textContent='Sync…';}
  const ws=_tgTl.weekStart||agMaandag(new Date());
  const since=new Date(ws.getTime()-864e5).toISOString().slice(0,10);
  const tot=new Date(ws.getTime()+8*864e5).toISOString().slice(0,10);
  try{ const r=await agSyncEigen(since,tot); if(st) st.textContent=`✓ ${r.nieuw} nieuw`; tgTlRender();
    try{ if(window.track) track('toggl','timeline_sync',{ok:true}); }catch(e){} }
  catch(e){ if(st){st.textContent='❌ '+e.message;st.style.color='#c0392b';}
    try{ if(window.track) track('toggl','timeline_sync',{ok:false,detail:e.message}); }catch(_){}
  }
}
function tgTlRender(){
  const ws=_tgTl.weekStart||agMaandag(new Date()), we=new Date(ws.getTime()+7*864e5);
  const lbl=document.getElementById('tg-tl-weeklabel'); if(lbl) lbl.textContent=`${agFmt(ws)} – ${agFmt(new Date(we.getTime()-864e5))}`;
  const dagen=['Ma','Di','Wo','Do','Vr','Za','Zo'];
  const wk=agEntries().filter(e=>{ if(!e.start||!e.duur||e.duur<0) return false; const t=new Date(e.start).getTime(); return t>=ws.getTime()&&t<we.getTime(); });
  const perDag=[[],[],[],[],[],[],[]];
  wk.forEach(e=>{const di=(new Date(e.start).getDay()+6)%7;perDag[di].push(e);});
  const hoogte=(AG_EIND-AG_START)*AG_UURPX;
  let html='<div class="ag-grid">';
  html+='<div class="ag-hcell"></div>';
  for(let i=0;i<7;i++){ const dd=new Date(ws.getTime()+i*864e5); const isV=dd.toDateString()===new Date().toDateString(); html+=`<div class="ag-hcell${isV?' vandaag':''}">${dagen[i]} ${dd.getDate()}</div>`; }
  html+='<div class="ag-gutter">';
  for(let u=AG_START;u<AG_EIND;u++) html+=`<div class="gh" style="--aguur:${AG_UURPX}px">${String(u).padStart(2,'0')}:00</div>`;
  html+='</div>';
  const lijn=`repeating-linear-gradient(to bottom,transparent,transparent ${AG_UURPX-1}px,#eee ${AG_UURPX-1}px,#eee ${AG_UURPX}px)`;
  for(let i=0;i<7;i++){ html+=`<div class="ag-daycol" style="height:${hoogte}px;background:${lijn}">`+agBlokkenHtml(perDag[i])+'</div>'; }
  html+='</div>';
  const g=document.getElementById('tg-tl-grid');
  if(g) g.innerHTML=(wk.length||localStorage.getItem('mt_toggl_last_sync'))?html:'<div class="tg-leeg">Nog geen uren in beeld — klik “↻ Sync week”.</div>';
  const perProj={}; wk.forEach(e=>{perProj[e.project_code]=(perProj[e.project_code]||0)+e.duur;});
  const tot=document.getElementById('tg-tl-totalen');
  if(tot){ const totaal=wk.reduce((s,e)=>s+e.duur,0);
    tot.innerHTML=(wk.length?`<span class="ag-tot"><b>Week: ${agUur(totaal)}u</b></span>`:'')
      +Object.entries(perProj).sort((a,b)=>b[1]-a[1]).map(([c,s])=>agProjChip(c,s)).join(''); }
  const st=document.getElementById('tg-tl-status');
  if(st&&st.textContent.indexOf('Sync')<0&&st.textContent.indexOf('❌')<0){ const ls=localStorage.getItem('mt_toggl_last_sync'); st.style.color=''; st.textContent=`${wk.length} entries${ls?' · sync '+new Date(ls).toLocaleString('nl-NL'):''}`; }
}

// ── TIMER (Track) ──
async function tgVulProjectSelect(){
  try{
    const ps=await tgStore.projecten();
    const sel=document.getElementById('tg-proj-select'); if(!sel)return;
    const huidig=sel.value;
    sel.innerHTML='<option value="">— project —</option>'+ps.filter(p=>p.active!==false&&!p.archived_at)
      .sort((a,b)=>(a.name||'').localeCompare(b.name||''))
      .map(p=>`<option value="${p.id}">${tgEsc(p.name||('project '+p.id))}</option>`).join('');
    if(huidig) sel.value=huidig;
  }catch(e){/* stil; select blijft leeg */}
}
async function tgTimerSync(){
  try{ const cur=await tgStore.lopendeTimer(); _tgTimer.entry=(cur&&cur.id)?cur:null; tgTimerPaint(); }
  catch(e){ tgStatus('Timer-status: '+e.message,'#c0392b'); }
}
function tgTimerPaint(){
  const btn=document.getElementById('tg-startstop'), clk=document.getElementById('tg-clock');
  if(!btn||!clk) return;
  if(_tgTimer.tick){clearInterval(_tgTimer.tick);_tgTimer.tick=null;}
  if(_tgTimer.entry){
    const desc=document.getElementById('tg-desc'); if(desc&&document.activeElement!==desc) desc.value=_tgTimer.entry.description||'';
    const sel=document.getElementById('tg-proj-select'); if(sel&&_tgTimer.entry.project_id) sel.value=_tgTimer.entry.project_id;
    btn.classList.remove('tg-start'); btn.classList.add('tg-stop'); btn.textContent='■';
    const start=new Date(_tgTimer.entry.start).getTime();
    const upd=()=>{ clk.textContent=tgSec2hms((Date.now()-start)/1000); };
    upd(); _tgTimer.tick=setInterval(upd,1000);
  }else{
    btn.classList.remove('tg-stop'); btn.classList.add('tg-start'); btn.textContent='▶'; clk.textContent='0:00:00';
  }
}
async function tgTimerToggle(){
  if(_tgTimer.entry){
    if(!confirm('Lopende timer stoppen?')) return;
    tgStatus('Timer stoppen…');
    try{ await tgTrack(`workspaces/${TG_WS}/time_entries/${_tgTimer.entry.id}/stop`,'PATCH');
      _tgTimer.entry=null; tgTimerPaint(); tgStatus('✓ Timer gestopt.','#2A4A38'); tgLaadRecent();
    }catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
  }else{
    const desc=document.getElementById('tg-desc').value.trim();
    const pid=document.getElementById('tg-proj-select').value;
    if(!confirm(`Nieuwe timer starten${desc?(' voor "'+desc+'"'):''}?`)) return;
    tgStatus('Timer starten…');
    const body={created_with:'MT-cockpit',description:desc,workspace_id:TG_WS,
      start:new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),duration:-1};
    if(pid) body.project_id=parseInt(pid);
    try{ const made=await tgTrack(`workspaces/${TG_WS}/time_entries`,'POST',body);
      _tgTimer.entry=(made&&made.id)?made:null; tgTimerPaint(); tgStatus('✓ Timer loopt.','#2A4A38');
    }catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
  }
}
async function tgLaadRecent(){
  const box=document.getElementById('tg-timer-recent'); if(box) box.innerHTML='<div class="tg-leeg">Laden…</div>';
  const sumClr=document.getElementById('tg-timer-summary'); if(sumClr) sumClr.innerHTML='';
  try{
    const since=new Date(Date.now()-14*864e5).toISOString().slice(0,10);
    const tot=new Date(Date.now()+864e5).toISOString().slice(0,10);
    const es=await tgStore.eigenEntries(since,tot);
    const ps=await tgStore.projecten(); const pmap={}; ps.forEach(p=>pmap[p.id]=p);
    _tgRecent=es.filter(e=>e.stop).sort((a,b)=>new Date(b.start)-new Date(a.start)).slice(0,80);
    if(!_tgRecent.length){ box.innerHTML='<div class="tg-leeg">Geen entries in de laatste 14 dagen.</div>'; return; }
    const durOf=e=>e.duration>0?e.duration:((new Date(e.stop)-new Date(e.start))/1000);
    const dagKey=d=>d.toISOString().slice(0,10);
    // week-grens (maandag) voor "deze week"-totaal
    const nu=new Date(); const wkStart=new Date(nu); const wd=(nu.getDay()+6)%7;
    wkStart.setHours(0,0,0,0); wkStart.setDate(wkStart.getDate()-wd);
    const vandaagKey=dagKey(new Date()); const gisteren=new Date(); gisteren.setDate(gisteren.getDate()-1);
    const gisterenKey=dagKey(gisteren);
    let totVandaag=0, totWeek=0;
    _tgRecent.forEach(e=>{ const d=new Date(e.start); const s=durOf(e);
      if(dagKey(d)===vandaagKey) totVandaag+=s; if(d>=wkStart) totWeek+=s; });
    // groepeer op kalenderdag (behoud platte index i voor de actie-handlers)
    const groepen=[]; const idx={};
    _tgRecent.forEach((e,i)=>{ const k=dagKey(new Date(e.start));
      if(!(k in idx)){ idx[k]=groepen.length; groepen.push({k,items:[],tot:0}); }
      const g=groepen[idx[k]]; g.items.push({e,i}); g.tot+=durOf(e); });
    const hero=`<div class="tg-daysum">
      <div class="tg-stat hero"><div class="lbl">Vandaag</div><div class="val">${tgSec2hms(totVandaag)}</div><div class="sub2">geboekte tijd</div></div>
      <div class="tg-stat"><div class="lbl">Deze week</div><div class="val">${tgSec2hms(totWeek)}</div><div class="sub2">sinds maandag</div></div>
      <div class="tg-stat"><div class="lbl">Entries</div><div class="val">${_tgRecent.length}</div><div class="sub2">laatste 14 dagen</div></div>
    </div>`;
    const dagRender=g=>{
      const d=new Date(g.k+'T00:00:00');
      let naam=d.toLocaleDateString('nl-NL',{weekday:'long'});
      if(g.k===vandaagKey) naam='Vandaag'; else if(g.k===gisterenKey) naam='Gisteren';
      const datum=d.toLocaleDateString('nl-NL',{day:'numeric',month:'long'});
      const rijen=g.items.map(({e,i})=>{
        const p=pmap[e.project_id]; const kl=p?(p.color||'#9a9a9a'):'#cfcfcf';
        const dur=durOf(e); const ds=new Date(e.start); const de=new Date(e.stop);
        const tijd=ds.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})+'–'+de.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'});
        const code=p?`<span class="tg-code">${tgEsc(p.name)}</span>`:'<span class="tg-sub">geen project</span>';
        const bill=e.billable?'<span class="tg-bill" title="Facturabel">€</span>':'';
        return `<div class="tg-row"><span class="tg-dot" style="background:${kl}"></span>
          <span style="flex:1;min-width:0;display:flex;align-items:center;gap:8px;overflow:hidden">
            <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${tgEsc(e.description||'(geen omschrijving)')}</span>
            ${code}${bill}</span>
          <span class="tg-time">${tijd}</span>
          <span class="tg-dur">${tgSec2hms(dur)}</span>
          <span class="tg-rowacts">
          <button class="tg-ib tg-resume" title="Opnieuw starten" onclick="tgHervat(${i})">▶</button>
          <button class="tg-ib" title="Bewerken" onclick="tgEditEntry(${i})">✎</button>
          <button class="tg-ib" title="Verwijderen" onclick="tgDelEntry(${i})">🗑</button></span></div>`;
      }).join('');
      return `<div class="tg-daygroup"><div class="tg-dayhdr">
        <span class="dname">${naam}<small>${datum}</small></span>
        <span class="dtot">${tgSec2hms(g.tot)}</span></div>${rijen}</div>`;
    };
    const sumBox=document.getElementById('tg-timer-summary'); if(sumBox) sumBox.innerHTML=hero;
    box.innerHTML=groepen.map(dagRender).join('');
  }catch(e){ if(box) box.innerHTML='<div class="tg-leeg">❌ '+tgEsc(e.message)+'</div>'; }
}
function tgHervat(i){
  const e=_tgRecent[i]; if(!e) return;
  document.getElementById('tg-desc').value=e.description||'';
  const sel=document.getElementById('tg-proj-select'); if(sel&&e.project_id) sel.value=e.project_id;
  tgTimerToggle();
}
// ── Uren-lock helper ──
function urenLock(startIso){
  const cfg=admCfg(); const lockDagen=cfg.lockDagen??14;
  if(!startIso) return {locked:false,dagen:lockDagen};
  const start=new Date(startIso);
  const nu=new Date(); const diffDagen=(nu-start)/(1000*3600*24);
  return {locked:diffDagen>lockDagen,dagen:lockDagen,diffDagen:Math.floor(diffDagen)};
}

// Entry bewerken: omschrijving + project (Track PUT). Tijden bewerken kan via
// handmatige-entry-route; hier de twee meest-gebruikte velden.
async function tgEditEntry(i){
  const e=_tgRecent[i]; if(!e) return;
  const lock=urenLock(e.start);
  if(lock.locked){
    if(!mtIsAdmin()){
      alert(`🔒 Vergrendeld: entries ouder dan ${lock.dagen} dagen kunnen alleen door een admin worden aangepast.`);
      auditLog('edit-geweigerd',e.description||e.id,null,null,`entry ouder dan ${lock.dagen}d`);
      return;
    }
    const reden=prompt(`Admin: reden voor wijziging van vergrendelde entry (${lock.diffDagen}d oud):`,'');
    if(reden===null||reden.trim()==='') return;
    const desc=prompt('Omschrijving:',e.description||''); if(desc===null) return;
    const ps=await tgStore.projecten(); const act=ps.filter(p=>!p.archived_at);
    const huidig=act.find(p=>p.id===e.project_id);
    const lijst=act.map((p,n)=>`${n+1}. ${p.name}`).join('\n');
    const keuze=prompt(`Projectnummer (leeg = ongewijzigd${huidig?', "0" = geen project':''}):\nHuidig: ${huidig?huidig.name:'geen'}\n\n${lijst}`);
    let project_id=e.project_id;
    if(keuze==='0') project_id=null;
    else if(keuze&&act[parseInt(keuze)-1]) project_id=act[parseInt(keuze)-1].id;
    if(!confirm('Entry opslaan in Toggl Track?')) return;
    tgStatus('Entry opslaan…');
    try{
      await tgTrack(`workspaces/${TG_WS}/time_entries/${e.id}`,'PUT',{description:desc,project_id:project_id,workspace_id:TG_WS});
      auditLog('unlock-edit',e.description||e.id,e.description,desc,reden);
      tgStatus('✓ Entry bijgewerkt.','#2A4A38'); tgLaadRecent();
    }catch(err){ tgStatus('❌ '+err.message,'#c0392b'); }
    return;
  }
  // Niet vergrendeld — normaal flow
  const desc=prompt('Omschrijving:',e.description||''); if(desc===null) return;
  const ps=await tgStore.projecten(); const act=ps.filter(p=>!p.archived_at);
  const huidig=act.find(p=>p.id===e.project_id);
  const lijst=act.map((p,n)=>`${n+1}. ${p.name}`).join('\n');
  const keuze=prompt(`Projectnummer (leeg = ongewijzigd${huidig?', "0" = geen project':''}):\nHuidig: ${huidig?huidig.name:'geen'}\n\n${lijst}`);
  let project_id=e.project_id;
  if(keuze==='0') project_id=null;
  else if(keuze&&act[parseInt(keuze)-1]) project_id=act[parseInt(keuze)-1].id;
  if(!confirm('Entry opslaan in Toggl Track?')) return;
  tgStatus('Entry opslaan…');
  try{ await tgTrack(`workspaces/${TG_WS}/time_entries/${e.id}`,'PUT',{description:desc,project_id:project_id,workspace_id:TG_WS});
    auditLog('uren-edit',e.description||e.id,e.description,desc,'');
    tgStatus('✓ Entry bijgewerkt.','#2A4A38'); tgLaadRecent();
  }catch(err){ tgStatus('❌ '+err.message,'#c0392b'); }
}
async function tgDelEntry(i){
  const e=_tgRecent[i]; if(!e) return;
  const lock=urenLock(e.start);
  if(lock.locked){
    if(!mtIsAdmin()){
      alert(`🔒 Vergrendeld: entries ouder dan ${lock.dagen} dagen kunnen alleen door een admin worden aangepast.`);
      auditLog('edit-geweigerd',e.description||e.id,null,null,`delete geweigerd, ouder dan ${lock.dagen}d`);
      return;
    }
    const reden=prompt(`Admin: reden voor verwijdering van vergrendelde entry (${lock.diffDagen}d oud):`,'');
    if(reden===null||reden.trim()==='') return;
    if(!confirm(`Entry verwijderen?\n"${e.description||'(geen omschrijving)'}"`)) return;
    tgStatus('Entry verwijderen…');
    try{ await tgTrack(`workspaces/${TG_WS}/time_entries/${e.id}`,'DELETE');
      auditLog('unlock-delete',e.description||e.id,e.description,null,reden);
      tgStatus('✓ Entry verwijderd.','#2A4A38'); tgLaadRecent();
    }catch(err){ tgStatus('❌ '+err.message,'#c0392b'); }
    return;
  }
  if(!confirm(`Entry verwijderen?\n"${e.description||'(geen omschrijving)'}"`)) return;
  tgStatus('Entry verwijderen…');
  try{ await tgTrack(`workspaces/${TG_WS}/time_entries/${e.id}`,'DELETE');
    auditLog('uren-delete',e.description||e.id,e.description,null,'');
    tgStatus('✓ Entry verwijderd.','#2A4A38'); tgLaadRecent();
  }catch(err){ tgStatus('❌ '+err.message,'#c0392b'); }
}
// Handmatige entry: datum + start + duur (minuten) + omschrijving + project.
async function tgHandmatig(){
  const datum=prompt('Datum (JJJJ-MM-DD):',new Date().toISOString().slice(0,10)); if(!datum) return;
  const start=prompt('Starttijd (UU:MM):','09:00'); if(!start) return;
  const min=prompt('Duur in minuten:','60'); if(!min) return;
  const duurMin=parseInt(min); if(!(duurMin>0)){ tgStatus('Ongeldige duur.','#c0392b'); return; }
  const desc=prompt('Omschrijving:',''); if(desc===null) return;
  const ps=await tgStore.projecten(); const act=ps.filter(p=>!p.archived_at);
  const lijst=act.map((p,n)=>`${n+1}. ${p.name}`).join('\n');
  const keuze=prompt(`Projectnummer (leeg = geen):\n${lijst}`);
  let project_id=null; if(keuze&&act[parseInt(keuze)-1]) project_id=act[parseInt(keuze)-1].id;
  const startISO=new Date(`${datum}T${start.length===5?start+':00':start}`).toISOString().replace(/\.\d{3}Z$/,'Z');
  if(startISO==='Invalid Date'||isNaN(new Date(startISO))){ tgStatus('Ongeldige datum/tijd.','#c0392b'); return; }
  if(!confirm(`Handmatige entry aanmaken?\n${datum} ${start} · ${duurMin} min${desc?(' · '+desc):''}`)) return;
  tgStatus('Entry aanmaken…');
  const body={created_with:'MT-cockpit',description:desc,workspace_id:TG_WS,start:startISO,duration:duurMin*60};
  if(project_id) body.project_id=project_id;
  try{ await tgTrack(`workspaces/${TG_WS}/time_entries`,'POST',body);
    tgStatus('✓ Handmatige entry aangemaakt.','#2A4A38'); tgLaadRecent();
  }catch(err){ tgStatus('❌ '+err.message,'#c0392b'); }
}

// ── PROJECTEN (Focus, met totalen) ──
async function tgLaadProjecten(){
  const box=document.getElementById('tg-proj-lijst'); box.innerHTML='<div class="tg-leeg">Laden…</div>';
  try{
    const ps=await tgStore.projecten(); _tgCache.projecten=ps;
    const act=ps.filter(p=>!p.archived_at);
    document.getElementById('tg-proj-tel').textContent=`${act.length} actieve projecten`;
    const maxSec=Math.max(1,...act.map(p=>p.total_tracked_secs||0));
    box.innerHTML='<div class="tg-cards">'+act.sort((a,b)=>(b.total_tracked_secs||0)-(a.total_tracked_secs||0)).map(p=>{
      const sec=p.total_tracked_secs||0, kl=p.color||'#9a9a9a';
      const est=p.estimated_mins?(' / '+tgSec2u(p.estimated_mins*60)+' geraamd'):'';
      const pct=Math.round(sec/maxSec*100);
      const mt=_mtProjVoorToggl(p);
      const mtbadge=mt?` <span class="tg-mtbadge" title="Gekoppeld M&T-project ${tgEsc(mt.code)}">M&amp;T</span>`:'';
      return `<div class="tg-card">
        <h4 style="cursor:pointer" title="Project openen" onclick="tgOpenProject(${p.id})"><span class="tg-dot" style="background:${kl}"></span>${tgEsc(p.name||('project '+p.id))}${mtbadge}</h4>
        <div class="tg-sub">${p.total_tasks||0} taken · ${p.billable?'billable':'niet-billable'}</div>
        <div class="tg-bar"><span style="width:${pct}%;background:${kl}"></span></div>
        <div class="tg-sub"><b>${tgSec2u(sec)}</b>${est}</div>
        ${(p.tags||[]).slice(0,6).map(t=>`<span class="tg-pill">${tgEsc(t.name||t)}</span>`).join('')}
        <div class="tg-cardacts">
          <button class="btn btn-sm btn-gold" title="Openen" onclick="tgOpenProject(${p.id})">📂 Openen</button>
          <button class="btn btn-sm btn-secondary" title="Bewerken" onclick="tgEditProject(${p.id})">✎</button>
          <button class="btn btn-sm btn-secondary" title="Archiveren" onclick="tgArchiveProject(${p.id})">📦</button>
        </div>
      </div>`;
    }).join('')+'</div>';
  }catch(e){ box.innerHTML='<div class="tg-leeg">❌ '+tgEsc(e.message)+'</div>'; }
}
function tgNieuwProject(){
  // M&T-verweving: i.p.v. een kale Toggl-prompt openen we de volwaardige
  // M&T-projectaanmaker (genereert KLANT-LOC-PROD-code, maakt SharePoint-mappen,
  // koppelt het Moneybird-contact) en die maakt aan het eind óók het Toggl-project
  // aan met de projectcode als naam — zo is de code de sleutel, ook in Toggl.
  try{ if(window.track) track('toggl','project_aanmaker_open',{detail:'vanuit_toggl'}); }catch(e){}
  if(window.openModal){ openModal(); tgStatus('M&T-projectaanmaker geopend — de code wordt straks ook het Toggl-project.','#7A6010'); }
  else { tgStatus('Projectaanmaker niet gevonden.','#c0392b'); }
}
// Maakt het Toggl-project bij een verse M&T-projectcode (best-effort, niet-blokkerend).
// Genoemd vanuit maakProjectAan(); geeft het Toggl-project-id terug of null.
// Zoekt een bestaande Toggl-client op naam (case-insensitief) of maakt 'm aan.
// Geeft het client-id terug of null. Best-effort.
async function tgVindOfMaakClient(naam){
  naam=String(naam||'').trim(); if(!naam||naam==='—') return null;
  if(typeof tgTrack!=='function'||typeof TG_WS==='undefined'||!TG_WS) return null;
  try{
    const lijst=(await tgTrack(`workspaces/${TG_WS}/clients`))||[];
    const best=(Array.isArray(lijst)?lijst:[]).find(c=>(c.name||'').trim().toLowerCase()===naam.toLowerCase());
    if(best) return best.id;
    const r=await tgTrack(`workspaces/${TG_WS}/clients`,'POST',{name:naam,wid:TG_WS});
    return (r&&(r.id||(r.data&&r.data.id)))||null;
  }catch(e){ console.warn('Toggl-client',naam,'aanmaken faalde:',e); return null; }
}
// Maakt het Toggl-project bij een M&T-projectcode (best-effort, niet-blokkerend).
// Projectnaam = leesbare naam + code; klant wordt als Toggl-CLIENT gekoppeld
// (apart veld in Toggl). Geeft het Toggl-project-id terug of null.
async function tgMaakProjectVoorCode(code, billable){
  if(typeof tgTrack!=='function'||typeof TG_WS==='undefined'||!TG_WS) return null;
  let pid=null;
  try{
    const mt=PROJECT_CODES.find(x=>(x.code||'').toUpperCase()===String(code).toUpperCase());
    // Projectnaam = de PROJECTCODE zelf (Bart 2026-06-15). De code is de sleutel
    // door sticker/Toggl/mail/MB/mappen heen. De klant ("Kobalt 5013") hoort als
    // Toggl-CLIENT, niet in de projectnaam.
    const projNaam=code;
    // 1) Project éérst aanmaken — gegarandeerd, zonder dat klant-gedoe dit blokkeert.
    const r=await tgTrack(`workspaces/${TG_WS}/projects`,'POST',
      {name:projNaam,active:true,billable:billable!==false,workspace_id:TG_WS});
    pid=(r&&(r.id||(r.data&&r.data.id)))||null;
    _tgCache.projecten=null;
    if(typeof tgVulProjectSelect==='function') tgVulProjectSelect();
    // 2) Klant als Toggl-CLIENT koppelen (best-effort, mag niet falen → niet-fataal).
    if(pid){
      // Client = de klant zoals ingevuld (bv. "Kobalt 5013"); klant_naam vóór de
      // registry-resolve zodat exact staat wat Bart typte.
      const klantNaam=(mt&&(mt.klant_naam||(typeof resolveKlantNaam==='function'?resolveKlantNaam(mt):mt.klant)))||'';
      const clientId=await tgVindOfMaakClient(klantNaam);
      if(clientId){
        try{ await tgTrack(`workspaces/${TG_WS}/projects/${pid}`,'PUT',{client_id:clientId,workspace_id:TG_WS}); _tgCache.projecten=null; }
        catch(e){ console.warn('Toggl-client koppelen aan',code,'faalde:',e); }
      }
    }
    return pid||true;
  }catch(e){ console.warn('Toggl-project voor',code,'aanmaken faalde:',e); return pid; }
}
// Zorgt dat er één Toggl-project bestaat voor deze code — STIL (geen dialogen).
// Geeft het project-id terug (of null). Schrijft tg_project_id op het M&T-record.
async function _tgZorgProjectVoorCode(code){
  const mt=PROJECT_CODES.find(x=>(x.code||'').toUpperCase()===String(code).toUpperCase());
  if(!mt) return null;
  let pid=await _tgProjectIdVoorMt(mt);
  if(pid) return pid;
  const made=await tgMaakProjectVoorCode(code,true);
  if(made&&made!==true){ mt.tg_project_id=made; if(typeof slaProjectenOp==='function') slaProjectenOp(); return made; }
  return await _tgProjectIdVoorMt(mt);
}
function _tgProjById(id){return (_tgCache.projecten||[]).find(p=>p.id===id);}
async function tgEditProject(id){
  const p=_tgProjById(id); if(!p) return;
  const naam=prompt('Projectnaam:',p.name||''); if(naam===null) return;
  const kleur=prompt('Kleur (hex, bv. #e36a00):',p.color||'#888888'); if(kleur===null) return;
  if(!/^#?[0-9a-fA-F]{6}$/.test(kleur.trim())){ tgStatus('Ongeldige hex-kleur.','#c0392b'); return; }
  const hex=kleur.trim().startsWith('#')?kleur.trim():'#'+kleur.trim();
  if(!confirm(`Project "${naam}" opslaan in Toggl Track?`)) return;
  tgStatus('Project opslaan…');
  try{ await tgTrack(`workspaces/${TG_WS}/projects/${id}`,'PUT',{name:naam,color:hex,workspace_id:TG_WS});
    _tgCache.projecten=null; tgStatus('✓ Project bijgewerkt.','#2A4A38'); tgLaadProjecten(); tgVulProjectSelect();
  }catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
}
async function tgArchiveProject(id){
  const p=_tgProjById(id); if(!p) return;
  if(!confirm(`Project "${p.name}" archiveren?\n(Het verdwijnt uit de actieve lijst; in Toggl terug te halen.)`)) return;
  tgStatus('Project archiveren…');
  try{ await tgTrack(`workspaces/${TG_WS}/projects/${id}`,'PUT',{active:false,workspace_id:TG_WS});
    _tgCache.projecten=null; tgStatus('✓ Project gearchiveerd.','#2A4A38'); tgLaadProjecten(); tgVulProjectSelect();
  }catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
}

// Trekt de projectcode uit een Toggl-projectnaam, tolerant voor BEIDE conventies:
//  • app-stijl  "naam [KOBALT-5013-KEUKEN]"  → bracket-suffix (dezelfde regex als de app, mobiel.html)
//  • cockpit-stijl "KOBALT-5013-KEUKEN"       → kale code (hele naam is een geldige code)
// Geeft de code in UPPERCASE terug, of '' als er geen code in zit. Puur lezen, geen mutatie.
function codeUitTogglNaam(name){
  const s=String(name||'').trim();
  const m=s.match(/\[([A-Z0-9\-]+)\]$/);
  if(m) return m[1].toUpperCase();
  // Geen brackets → is de hele naam zelf een kale projectcode (hoofdletters/cijfers/streepjes)?
  if(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(s.toUpperCase())) return s.toUpperCase();
  return '';
}
// ── M&T-verweving: koppel een Toggl-project aan een M&T-projectcode ──
// Match-volgorde: 1) opgeslagen tg_project_id, 2) code uit Toggl-naam (kale code óf [CODE]),
// 3) naam-match. De code-uit-naam-tak herkent zowel cockpit- (kale code) als app-projecten
// ("naam [CODE]") zonder iets te hernoemen — puur tolerant lezen.
function _mtProjVoorToggl(p){
  if(!p||typeof PROJECT_CODES==='undefined') return null;
  const byId=PROJECT_CODES.find(x=>x.tg_project_id&&String(x.tg_project_id)===String(p.id));
  if(byId) return byId;
  const code=codeUitTogglNaam(p.name);
  if(code){
    const byCode=PROJECT_CODES.find(x=>(x.code||'').toUpperCase()===code);
    if(byCode) return byCode;
  }
  const nm=(p.name||'').trim().toUpperCase();
  return PROJECT_CODES.find(x=>(x.code||'').toUpperCase()===nm)
       ||PROJECT_CODES.find(x=>(x.naam||'').trim().toUpperCase()===nm)||null;
}
// Toggl-2.0-achtige project-detailweergave binnen de Uren-tab — Toggl-stijl maar
// uitgebreid met de M&T-data die we al hebben (klant, Moneybird, gekoppelde mails).
function tgOpenProject(id){
  const p=_tgProjById(id); if(!p) return;
  const box=document.getElementById('tg-proj-lijst'); if(!box) return;
  const mt=_mtProjVoorToggl(p), kl=p.color||'#9a9a9a', sec=p.total_tracked_secs||0;
  try{ if(window.track) track('toggl','project_open',{detail:mt?'gekoppeld':'ongekoppeld'}); }catch(e){}
  let mtBlok;
  if(mt){
    const klantNaam=(typeof resolveKlantNaam==='function')?resolveKlantNaam(mt):(mt.klant_naam||'');
    const autoMb=(typeof resolveMbContact==='function')?resolveMbContact(mt):null;
    const effMb=mt.mb_nr||autoMb;
    const mbChip=effMb
      ? `<a href="https://moneybird.com/${getAdmin()}/contacts/${effMb}" target="_blank" style="color:var(--green);text-decoration:none;font-family:var(--mono)">${effMb} ↗</a>`
      : '<span style="color:var(--text-faint)">geen MB-contact</span>';
    const mails=(typeof gekoppeldeMailsHtml==='function')?gekoppeldeMailsHtml(mt):'';
    mtBlok=`
      <div class="tg-daysum" style="margin-bottom:12px">
        <div class="tg-stat"><div class="lbl">Projectcode</div><div class="val"><span class="tg-code">${tgEsc(mt.code)}</span></div></div>
        <div class="tg-stat"><div class="lbl">Klant</div><div class="val" style="font-size:14px">${tgEsc(klantNaam)||'—'}</div></div>
        <div class="tg-stat"><div class="lbl">Moneybird</div><div class="val" style="font-size:14px">${mbChip}</div></div>
      </div>
      <div class="card">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div class="card-title" style="margin:0">Gekoppelde mails</div>
          <span class="tg-mtbadge">M&amp;T</span>
        </div>
        ${mails}
      </div>
      <div style="margin-top:12px">
        <button class="btn btn-sm btn-gold" onclick="tgNaarVolledigProject('${tgEsc(mt.code)}')">→ Volledig project openen</button>
      </div>`;
  } else {
    mtBlok=`<div class="card">
      <p style="color:var(--text-dim);font-size:13px;margin:0 0 .6rem">
        Dit Toggl-project is nog niet gekoppeld aan een M&amp;T-project (geen projectcode, mappen of Moneybird-koppeling).</p>
      <button class="btn btn-sm btn-gold" onclick="tgNieuwProject()">📁 M&amp;T-project aanmaken</button>
      <span class="tg-mtnote"><span class="tg-mtbadge">M&amp;T</span> code · mappen · Moneybird in één stap</span>
    </div>`;
  }
  box.innerHTML=`
    <div style="margin-bottom:12px">
      <button class="btn btn-sm btn-secondary" onclick="tgLaadProjecten()">← Projecten</button>
    </div>
    <h3 style="display:flex;align-items:center;gap:8px;margin:0 0 12px;font-family:var(--serif)">
      <span class="tg-dot" style="background:${kl};width:12px;height:12px"></span>${tgEsc(p.name||('project '+p.id))}
      <span class="tg-sub" style="font-weight:400">· ${tgSec2u(sec)} geboekt · ${p.billable?'billable':'niet-billable'}</span>
    </h3>
    ${mtBlok}`;
}
function tgNaarVolledigProject(code){
  if(typeof PROJECT_CODES==='undefined') return;
  const mt=PROJECT_CODES.find(x=>x.code===code); if(!mt) return;
  try{ if(window.track) track('toggl','naar_volledig_project',{detail:code}); }catch(e){}
  if(typeof tbDoTab==='function') tbDoTab('projecten');
  // Even wachten tot de Projecten-tab gerenderd is, dan het project selecteren
  // via de bestaande lijst-flow (zet huidigProject + renderProjectDetail).
  setTimeout(()=>{
    if(typeof renderProjectLijst==='function') renderProjectLijst();
    const el=document.querySelector(`#project-lijst .factuur-item[onclick*="selecteerProject('${code}'"]`);
    if(el&&typeof selecteerProject==='function'){ selecteerProject(code,el); el.scrollIntoView({block:'center'}); }
    else if(typeof renderProjectDetail==='function'){ huidigProject=mt; renderProjectDetail(mt); }
  },120);
}

// ── TAKEN (Focus) ──
async function tgLaadTaken(){
  const box=document.getElementById('tg-taken-lijst'); box.innerHTML='<div class="tg-leeg">Laden…</div>';
  try{
    await agNamen();                       // medewerker-namen cachen (assignee-resolve, PII uit runtime)
    const ts=await tgStore.taken(); _tgCache.taken=ts;
    document.getElementById('tg-taken-tel').textContent=`${ts.length} taken`;
    if(!ts.length){ box.innerHTML='<div class="tg-leeg">Geen taken.</div>'; return; }
    const {un}=agNames();
    box.innerHTML=ts.map(t=>{
      const st=tgStatusById(t.status_id), kl=(t.project&&t.project.color)||'#9a9a9a', sec=t.total_tracked_time||0;
      const pr=tgPrioById(t.priority);
      const asg=(t.assignee_user_ids||[]).map(id=>un[String(id)]||('#'+id));
      const sub=t.sub_task_total_count?` <span class="tg-sub">(${t.sub_task_done_count||0}/${t.sub_task_total_count} sub)</span>`:'';
      return `<div class="tg-row">
        <span class="tg-dot" style="background:${kl}"></span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${tgEsc(t.name||('taak '+t.id))}
        <span class="tg-sub"> · ${t.project?tgEsc(t.project.name):'geen project'}${t.client?(' · '+tgEsc(t.client.name)):''}</span>${sub}</span>
        <span class="tg-prio" title="Prioriteit wijzigen" style="background:${pr.kleur}22;color:${pr.kleur}" onclick="tgZetPriority(${t.id})">${pr.kort||'—'}</span>
        <span class="tg-asg" title="Toewijzing wijzigen" onclick="tgZetAssignee(${t.id})">👤 ${asg.length?tgEsc(asg.join(', ')):'—'}</span>
        <span class="tg-pill" style="background:${st.kleur}22;color:${st.kleur}">${st.label}</span>
        <span class="tg-dur">${tgSec2u(sec)}</span>
        <select class="zoek-input" style="width:auto;font-size:11px" onchange="tgZetTaakStatus(${t.id},this.value)">
          ${TG_STATUS.map(s=>`<option value="${s.id}"${s.id===t.status_id?' selected':''}>${s.label}</option>`).join('')}
        </select>
        <span class="tg-rowacts">
          <button class="tg-ib" title="Subtaak toevoegen" onclick="tgNieuweSubtaak(${t.id})">＋</button>
          <button class="tg-ib" title="Hernoemen" onclick="tgHernoemTaak(${t.id})">✎</button>
          <button class="tg-ib" title="Verwijderen" onclick="tgVerwijderTaak(${t.id})">🗑</button>
        </span></div>`;
    }).join('');
  }catch(e){ box.innerHTML='<div class="tg-leeg">❌ '+tgEsc(e.message)+'</div>'; }
}
async function tgZetPriority(taskId){
  const t=(_tgCache.taken||[]).find(x=>x.id===taskId);
  const huidig=t?tgPrioById(t.priority).label:'?';
  const keuze=prompt(`Prioriteit (nu: ${huidig})\n`+TG_PRIO.map((p,i)=>`${i}. ${p.label}`).join('\n'));
  if(keuze===null||keuze.trim()==='') return;
  const p=TG_PRIO[parseInt(keuze)]; if(!p){ tgStatus('Ongeldige keuze.','#c0392b'); return; }
  if(!confirm(`Prioriteit → ${p.label} (Focus)?`)) return;
  tgStatus('Prioriteit zetten…');
  try{ await focusFetch(`tasks/${taskId}`,'PATCH',{priority:p.v||null});
    _tgCache.taken=null; tgStatus('✓ Prioriteit → '+p.label,'#2A4A38'); tgLaadTaken();
  }catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
}
async function tgZetAssignee(taskId){
  await agNamen(); const {un}=agNames(); const ids=Object.keys(un);
  if(!ids.length){ tgStatus('Geen medewerkerslijst — open eerst de Agenda (laadt namen).','#c0392b'); return; }
  const t=(_tgCache.taken||[]).find(x=>x.id===taskId);
  const huidig=((t&&t.assignee_user_ids)||[]).map(id=>un[String(id)]||('#'+id)).join(', ')||'—';
  const keuze=prompt(`Toewijzen aan (nu: ${huidig})\nNummers met komma, leeg = niemand:\n`+ids.map((id,i)=>`${i+1}. ${un[id]}`).join('\n'));
  if(keuze===null) return;
  const sel=keuze.split(',').map(s=>parseInt(s.trim())-1).filter(i=>i>=0&&ids[i]).map(i=>parseInt(ids[i]));
  const namen=sel.map(id=>un[String(id)]).join(', ')||'niemand';
  if(!confirm(`Taak toewijzen aan ${namen} (Focus)?`)) return;
  tgStatus('Toewijzen…');
  try{ await focusFetch(`tasks/${taskId}`,'PATCH',{assignee_user_ids:sel});
    _tgCache.taken=null; tgStatus('✓ Toegewezen aan '+namen,'#2A4A38'); tgLaadTaken();
  }catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
}
async function tgNieuweSubtaak(parentId){
  const naam=prompt('Naam van de subtaak (Focus):'); if(!naam) return;
  if(!confirm(`Subtaak "${naam}" toevoegen onder deze taak (Focus)?`)) return;
  tgStatus('Subtaak aanmaken…');
  try{ await focusFetch('tasks','POST',{name:naam,status_id:300785,parent_task_id:parentId});
    _tgCache.taken=null; tgStatus('✓ Subtaak aangemaakt.','#2A4A38'); tgLaadTaken();
  }catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
}
async function tgHernoemTaak(taskId){
  const t=(_tgCache.taken||[]).find(x=>x.id===taskId);
  const naam=prompt('Nieuwe naam:',t?t.name:''); if(!naam||naam===(t&&t.name)) return;
  if(!confirm(`Taak hernoemen naar "${naam}" (Focus)?`)) return;
  tgStatus('Hernoemen…');
  try{ await focusFetch(`tasks/${taskId}`,'PATCH',{name:naam});
    _tgCache.taken=null; tgStatus('✓ Hernoemd.','#2A4A38'); tgLaadTaken();
  }catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
}
async function tgVerwijderTaak(taskId){
  const t=(_tgCache.taken||[]).find(x=>x.id===taskId);
  if(!confirm(`Taak "${t?t.name:taskId}" definitief verwijderen uit Toggl Focus?\nDit kan niet ongedaan worden.`)) return;
  tgStatus('Verwijderen…');
  try{ await focusFetch(`tasks/${taskId}`,'DELETE');
    _tgCache.taken=null; tgStatus('✓ Taak verwijderd.','#2A4A38'); tgLaadTaken();
  }catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
}
async function tgZetTaakStatus(taskId,statusId){
  if(!statusId) return;
  const lbl=tgStatusById(parseInt(statusId)).label;
  if(!confirm(`Taak-status → ${lbl} in Toggl Focus?`)){ tgLaadTaken(); return; }
  tgStatus('Status zetten…');
  try{ await focusFetch(`tasks/${taskId}`,'PATCH',{status_id:parseInt(statusId)});
    _tgCache.taken=null; tgStatus(`✓ Status → ${lbl}`,'#2A4A38'); tgLaadTaken();
  }catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
}
async function tgNieuweTaak(){
  const naam=prompt('Naam van de nieuwe taak (Focus):'); if(!naam) return;
  const ps=_tgCache.projecten||await tgStore.projecten(); const act=ps.filter(p=>!p.archived_at);
  const lijst=act.map((p,i)=>`${i+1}. ${p.name}`).join('\n');
  const keuze=prompt(`Projectnummer voor de taak (leeg = geen):\n${lijst}`);
  let project_id=null;
  if(keuze){ const idx=parseInt(keuze)-1; if(act[idx]) project_id=act[idx].id; }
  if(!confirm(`Taak "${naam}" aanmaken${project_id?' in gekozen project':''} (Focus)?`)) return;
  tgStatus('Taak aanmaken…');
  try{ const body=project_id?{name:naam,project_id}:{name:naam,status_id:300785};
    await focusFetch('tasks','POST',body);
    _tgCache.taken=null; tgStatus('✓ Taak aangemaakt.','#2A4A38'); tgLaadTaken();
  }catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
}

// ── BOARD (Focus kanban) ──
async function tgLaadBoard(){
  const box=document.getElementById('tg-board'); box.innerHTML='<div class="tg-leeg">Laden…</div>';
  try{
    await agNamen(); const {un}=agNames();
    const ts=_tgCache.taken||await tgStore.taken(); _tgCache.taken=ts;
    const cols=TG_STATUS.map(s=>{
      const taken=ts.filter(t=>t.status_id===s.id);
      const tiles=taken.map(t=>{
        const kl=(t.project&&t.project.color)||'#9a9a9a';
        const pr=tgPrioById(t.priority);
        const prB=pr.kort?`<span class="tg-prio" style="background:${pr.kleur}22;color:${pr.kleur}">${pr.kort}</span> `:'';
        const asg=(t.assignee_user_ids||[]).map(id=>un[String(id)]||('#'+id));
        const asgB=asg.length?`<span class="tg-sub" style="display:block">👤 ${tgEsc(asg.join(', '))}</span>`:'';
        const subB=t.sub_task_total_count?`<span class="tg-sub"> · ${t.sub_task_done_count||0}/${t.sub_task_total_count} sub</span>`:'';
        return `<div class="tg-tile" draggable="true" data-id="${t.id}" data-naam="${tgEsc(t.name)}"
          ondragstart="tgDragStart(event)" ondragend="tgDragEnd(event)">
          <span class="tg-dot" style="background:${kl}"></span> ${prB}${tgEsc(t.name||('taak '+t.id))}
          ${t.project?`<div class="tg-sub">${tgEsc(t.project.name)}${subB}</div>`:subB}${asgB}</div>`;
      }).join('')||'<div class="tg-sub" style="padding:6px">—</div>';
      return `<div class="tg-col" data-status="${s.id}" ondragover="tgDragOver(event)" ondragleave="tgDragLeave(event)" ondrop="tgDrop(event)">
        <h5><span>${s.label}</span><span>${taken.length}</span></h5>${tiles}</div>`;
    }).join('');
    box.innerHTML='<div class="tg-board">'+cols+'</div>';
  }catch(e){ box.innerHTML='<div class="tg-leeg">❌ '+tgEsc(e.message)+'</div>'; }
}
function tgDragStart(ev){_tgDrag={id:ev.target.dataset.id,naam:ev.target.dataset.naam};ev.target.classList.add('drag');}
function tgDragEnd(ev){ev.target.classList.remove('drag');}
function tgDragOver(ev){ev.preventDefault();ev.currentTarget.classList.add('over');}
function tgDragLeave(ev){ev.currentTarget.classList.remove('over');}
async function tgDrop(ev){
  ev.preventDefault(); ev.currentTarget.classList.remove('over');
  if(!_tgDrag) return;
  const statusId=parseInt(ev.currentTarget.dataset.status), lbl=tgStatusById(statusId).label;
  const d=_tgDrag; _tgDrag=null;
  if(!confirm(`Taak "${d.naam}" → ${lbl}?`)) return;
  tgStatus('Status zetten…');
  try{ await focusFetch(`tasks/${d.id}`,'PATCH',{status_id:statusId});
    _tgCache.taken=null; tgStatus(`✓ "${d.naam}" → ${lbl}`,'#2A4A38'); tgLaadBoard();
  }catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
}

// ── REPORTS (Reports v3, alle medewerkers) ──
async function tgLaadReport(){
  const van=document.getElementById('tg-rep-van').value, tot=document.getElementById('tg-rep-tot').value;
  const group=document.getElementById('tg-rep-group').value, box=document.getElementById('tg-report');
  if(!van||!tot){ box.innerHTML='<div class="tg-leeg">Kies begin- en einddatum.</div>'; return; }
  box.innerHTML='<div class="tg-leeg">Laden…</div>';
  try{
    const PAGE=1000; let rows=[]; let firstRow=1;
    for(let p=0;p<20;p++){
      const chunk=await tgReports({start_date:van,end_date:tot,page_size:PAGE,first_row_number:firstRow});
      if(!Array.isArray(chunk)) break;
      rows=rows.concat(chunk);
      if(chunk.length<PAGE) break;
      firstRow+=PAGE;
    }
    const ps=await tgStore.projecten(); const pmap={}; ps.forEach(p=>pmap[p.id]=p);
    const {un}=agNames();
    const agg={}; let totaal=0;
    rows.forEach(r=>{
      const tes=Array.isArray(r.time_entries)?r.time_entries:[r];
      tes.forEach(te=>{
        const sec=te.seconds!=null?te.seconds:(te.duration||0); if(sec<0) return;
        let key,kl='#9a9a9a';
        if(group==='project'){ const p=pmap[r.project_id]; key=p?p.name:(r.project_id?('project '+r.project_id):'(geen project)'); kl=p?(p.color||kl):kl; }
        else if(group==='user'){ key=un[r.user_id]||('user '+r.user_id); }
        else { key=(te.start||'').slice(0,10); }
        agg[key]=agg[key]||{sec:0,kl}; agg[key].sec+=sec; totaal+=sec;
      });
    });
    const items=Object.entries(agg).sort((a,b)=> group==='dag'?a[0].localeCompare(b[0]):b[1].sec-a[1].sec);
    const maxSec=Math.max(1,...items.map(([,v])=>v.sec));
    box.innerHTML=`<div class="card" style="padding:14px">
      <div style="font-weight:600;margin-bottom:10px">Totaal: ${tgSec2u(totaal)} · ${rows.length} regels</div>
      <table class="tg-tbl"><thead><tr><th>${group==='project'?'Project':group==='user'?'Persoon':'Dag'}</th><th class="num">Uren</th><th style="width:40%">&nbsp;</th></tr></thead><tbody>
      ${items.map(([k,v])=>`<tr><td><span class="tg-dot" style="background:${v.kl};margin-right:6px"></span>${tgEsc(k)}</td>
        <td class="num">${tgSec2u(v.sec)}</td>
        <td><div class="tg-bar" style="margin:0"><span style="width:${Math.round(v.sec/maxSec*100)}%;background:${v.kl}"></span></div></td></tr>`).join('')}
      </tbody></table></div>`;
  }catch(e){ box.innerHTML='<div class="tg-leeg">❌ '+tgEsc(e.message)+'</div>'; }
}

// ── CLIENTS & TAGS (Track) ──
async function tgLaadBeheer(){
  const cb=document.getElementById('tg-clients'), tb=document.getElementById('tg-tags');
  cb.innerHTML='<div class="tg-leeg">Laden…</div>'; tb.innerHTML='<div class="tg-leeg">Laden…</div>';
  try{ const cs=await tgStore.clients();
    cb.innerHTML=cs.length?cs.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(c=>`<div class="tg-row"><span style="flex:1">${tgEsc(c.name)}</span><button class="btn btn-sm btn-secondary" title="Hernoemen" onclick="tgRenameClient(${c.id},this.parentNode.querySelector('span').textContent)">✎</button><button class="btn btn-sm btn-secondary" title="Verwijderen" onclick="tgVerwijderClient(${c.id},'${tgEsc(c.name).replace(/'/g,"\\'")}')">🗑</button></div>`).join(''):'<div class="tg-leeg">Geen clients.</div>';
  }catch(e){ cb.innerHTML='<div class="tg-leeg">❌ '+tgEsc(e.message)+'</div>'; }
  try{ const ts=await tgStore.tags();
    tb.innerHTML=ts.length?ts.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(t=>`<span class="tg-pill" style="font-size:12px"><span style="cursor:pointer" title="Klik om te hernoemen" onclick="tgRenameTag(${t.id},'${tgEsc(t.name).replace(/'/g,"\\'")}')">${tgEsc(t.name)} ✎</span> <span style="cursor:pointer;color:#c0392b" title="Verwijderen" onclick="tgVerwijderTag(${t.id},'${tgEsc(t.name).replace(/'/g,"\\'")}')">✕</span></span>`).join(' '):'<div class="tg-leeg">Geen tags.</div>';
  }catch(e){ tb.innerHTML='<div class="tg-leeg">❌ '+tgEsc(e.message)+'</div>'; }
}
async function tgVerwijderClient(id,naam){
  if(!confirm(`Client "${naam}" verwijderen uit Toggl Track?\nProjecten verliezen hun client-koppeling.`)) return;
  tgStatus('Client verwijderen…');
  try{ await tgTrack(`workspaces/${TG_WS}/clients/${id}`,'DELETE'); tgStatus('✓ Client verwijderd.','#2A4A38'); tgLaadBeheer(); }
  catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
}
async function tgVerwijderTag(id,naam){
  if(!confirm(`Tag "${naam}" verwijderen uit Toggl Track?\nDe tag verdwijnt van alle entries.`)) return;
  tgStatus('Tag verwijderen…');
  try{ await tgTrack(`workspaces/${TG_WS}/tags/${id}`,'DELETE'); tgStatus('✓ Tag verwijderd.','#2A4A38'); tgLaadBeheer(); }
  catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
}
async function tgRenameClient(id,huidig){
  const naam=prompt('Nieuwe clientnaam:',huidig||''); if(naam===null||!naam.trim()) return;
  if(!confirm(`Client hernoemen naar "${naam}"?`)) return;
  tgStatus('Client hernoemen…');
  try{ await tgTrack(`workspaces/${TG_WS}/clients/${id}`,'PUT',{name:naam.trim(),wid:TG_WS}); tgStatus('✓ Client hernoemd.','#2A4A38'); tgLaadBeheer(); }
  catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
}
async function tgRenameTag(id,huidig){
  const naam=prompt('Nieuwe tagnaam:',huidig||''); if(naam===null||!naam.trim()) return;
  if(!confirm(`Tag hernoemen naar "${naam}"?`)) return;
  tgStatus('Tag hernoemen…');
  try{ await tgTrack(`workspaces/${TG_WS}/tags/${id}`,'PUT',{name:naam.trim(),workspace_id:TG_WS}); tgStatus('✓ Tag hernoemd.','#2A4A38'); tgLaadBeheer(); }
  catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
}
async function tgNieuweClient(){
  const naam=prompt('Naam van de nieuwe client (Track):'); if(!naam) return;
  if(!confirm(`Client "${naam}" aanmaken in Toggl Track?`)) return;
  tgStatus('Client aanmaken…');
  try{ await tgTrack(`workspaces/${TG_WS}/clients`,'POST',{name:naam,wid:TG_WS}); tgStatus('✓ Client aangemaakt.','#2A4A38'); tgLaadBeheer(); }
  catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
}
async function tgNieuweTag(){
  const naam=prompt('Naam van de nieuwe tag (Track):'); if(!naam) return;
  if(!confirm(`Tag "${naam}" aanmaken in Toggl Track?`)) return;
  tgStatus('Tag aanmaken…');
  try{ await tgTrack(`workspaces/${TG_WS}/tags`,'POST',{name:naam,workspace_id:TG_WS}); tgStatus('✓ Tag aangemaakt.','#2A4A38'); tgLaadBeheer(); }
  catch(e){ tgStatus('❌ '+e.message,'#c0392b'); }
}
