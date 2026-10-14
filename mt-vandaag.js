/* ============================================================================
 * mt-vandaag.js — "Vandaag" (Mijn werk) op de telefoon (planning stap 2a/2b)
 * ----------------------------------------------------------------------------
 * Eén scherm voor wie in de werkplaats staat: bovenaan "Deze week Xu gepland / Yu vrij", daaronder mijn taken in groepen
 * (Nieuw voor mij · Te laat · Vandaag · Deze week · Later · Zonder datum, plus ingeklapt "Nog niet vrijgegeven"), een taakkaart
 * met de status en de timer, en de grote + om iets te melden.
 *
 * De rekenregels staan in mt-planning.js (MTPlanning.mijnWerk, takenSchrijf, …), dezelfde als de cockpit gebruikt; dit bestand
 * tekent alleen (met DOM-calls, nooit met opgebouwde HTML-tekst) en regelt de volgorde van de acties. Alles komt van buiten via init(deps), zodat
 * het zonder de hele app te testen is.
 *
 * Alleen lezen of schrijven? De takenlijst (mt_project_taken_v2) is alleen bewerkbaar als de Beheer-overstap van de cockpit gedaan is,
 * de lijst goed geladen is, de schemaversie van de app niet te oud is (GET /teller/status → schema_min) en de rol het toestaat.
 * Anders toont dit scherm alles alleen-lezen met een duidelijke melding. Het maakt het bestand NOOIT aan.
 * ========================================================================== */
(function (root) {
  'use strict';
  const BESTAND = 'mt_project_taken_v2.json', LS_TAKEN = 'mt_project_taken_v2', LS_AFH = 'mt_mobiel_afhank', LS_GEZIEN = 'mt_vandaag_gezien';
  const V = {};
  let D = null, P = null;
  const S = { staat: 'laden', vormFout: '', schemaMin: null, taken: {}, afhank: {}, mw: null, laadtijd: 0, bezigLaden: null, open: null, bezig: false };

  // ── kleine bouwstenen ──
  function el(tag, props, ...kids) {
    const e = D.doc.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'klass') e.className = v; else if (k === 'tekst') e.textContent = v; else if (k === 'klik') e.addEventListener('click', v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    kids.flat(2).forEach(x => { if (x === null || x === undefined || x === false) return; e.appendChild(typeof x === 'string' ? D.doc.createTextNode(x) : x); });
    return e;
  }
  const DAG = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'], MND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  function fmtDatum(ymd) {
    if (!P.isYmd(ymd)) return '';
    const [y, m, d] = ymd.split('-').map(Number), w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return DAG[w] + ' ' + d + ' ' + MND[m - 1];
  }
  function plusDag(ymd, n) { const [y, m, d] = ymd.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d + n)); return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0'); }
  function dagWoord(ymd, vandaag) { return ymd === vandaag ? 'vandaag' : ymd === plusDag(vandaag, 1) ? 'morgen' : fmtDatum(ymd); }
  const eindTijd = (start, min) => { const m = /^(\d{2}):(\d{2})$/.exec(start || ''); if (!m) return ''; const t = Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2]) + Math.max(0, Math.round(Number(min) || 0))); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
  function projInfo(code) { try { return (D.project && D.project(code)) || null; } catch (e) { return null; } }
  function projLabel(code) { const i = projInfo(code); if (!i) return String(code || ''); return [i.nr, i.naam].filter(Boolean).join(' ') || String(code || ''); }
  const kleur = code => P.projectKleur(code);

  // ── wat mag er? ──
  // '' = mag; anders de reden in gewone taal (de knoppen gaan dan uit en de reden staat erbij).
  function schrijfBlok(spec) {
    if (D.demo()) return 'Demomodus: wijzigen kan alleen in de echte app.';
    if (S.staat !== 'klaar') return P.lijstStatusTekst('taken', S.staat, S.vormFout) + ' Je kijkt alleen mee.';
    if (spec && !D.rol.mag(spec)) return 'Dit mag je niet met jouw rol.';
    return '';
  }
  V.schrijfBlok = schrijfBlok;

  // ── laden ──
  function leesJson(sleutel) { try { const o = JSON.parse(D.storage.getItem(sleutel) || 'null'); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch (e) { return null; } }
  async function schemaCheck() {
    try { const n = await D.schemaMin(); if (n !== null && n !== undefined && Number.isFinite(Number(n))) S.schemaMin = Number(n); } catch (e) { /* onbekend blijft onbekend; een eerder gevonden "te oud" blijft staan */ }
    return !P.schemaGeblokkeerd(S.schemaMin);
  }
  async function laadIntern() {
    if (D.demo()) { S.staat = 'demo'; S.taken = {}; S.mw = null; teken(); return; }
    if (!D.account()) { S.staat = 'laden'; teken(); return; }
    if (S.staat !== 'klaar' && !S.mw) { S.staat = 'laden'; teken(); }
    const schemaOk = await schemaCheck();
    let raw;
    try { raw = await D.sp.read(BESTAND); }
    catch (e) { S.staat = 'geblokkeerd'; S.vormFout = ''; S.taken = leesJson(LS_TAKEN) || S.taken || {}; await vervolg(); return; }
    if (raw === null || raw === undefined) {      // de Beheer-overstap is nog niet gedaan (of het bestand is weg): niets gebruiken, een lokale kopie wordt een back-up
      const vw = P.verweesdOpruimen(D.storage, LS_TAKEN, D.nu());
      S.staat = vw.actie === 'verweesd' ? 'verweesd' : vw.actie === 'backup-mislukt' ? 'backup-mislukt' : 'overzetten'; S.vormFout = ''; S.taken = {};
      await vervolg(); return;
    }
    const vorm = P.takenBestandVorm(raw);
    if (vorm) { S.staat = 'geblokkeerd'; S.vormFout = vorm; S.taken = leesJson(LS_TAKEN) || {}; await vervolg(); return; }
    let samen, alleen; const lokaalRaw = D.storage.getItem(LS_TAKEN);
    try { samen = P.takenSamen(lokaalRaw, raw); alleen = P.takenSamen(null, raw); }
    catch (e) { S.staat = 'geblokkeerd'; S.vormFout = String((e && e.message) || e); S.taken = {}; await vervolg(); return; }
    S.taken = samen; S.vormFout = ''; S.staat = schemaOk ? 'klaar' : 'schema';
    try { D.storage.setItem(LS_TAKEN, JSON.stringify(samen)); } catch (e) { /* opslag vol: de lijst blijft in het geheugen */ }
    if (schemaOk && JSON.stringify(samen) !== JSON.stringify(alleen)) {   // wijzigingen die eerder niet gedeeld konden worden: nu alsnog (zelfde samenvoeging als de cockpit)
      const p = await P.takenPush(D.sp, { remote: raw, lokaal: lokaalRaw, voorWrite: schemaCheck });
      if (p && p.ok === false) S.nogNietGedeeld = true; else S.nogNietGedeeld = false;
    }
    await vervolg();
  }
  async function vervolg() {
    try {
      const r = await D.sp.read('mt_project_afhank.json');
      if (r && typeof r === 'object' && !Array.isArray(r)) { S.afhank = r; try { D.storage.setItem(LS_AFH, JSON.stringify(r)); } catch (e) {} } else if (r === null) S.afhank = {};
    } catch (e) { S.afhank = leesJson(LS_AFH) || S.afhank || {}; }
    try { await D.pvLees(); } catch (e) {}
    S.laadtijd = D.nu(); teken();
  }
  // Laden (of opnieuw laden) — één tegelijk.
  V.laad = function () {
    if (S.bezigLaden) return S.bezigLaden;
    S.bezigLaden = laadIntern().catch(e => { console.warn('Vandaag laden mislukt:', e && e.message); if (S.staat === 'laden') { S.staat = 'geblokkeerd'; teken(); } }).finally(() => { S.bezigLaden = null; });
    return S.bezigLaden;
  };
  // Het tabblad komt in beeld: tekenen, en opnieuw laden als de stand ouder is dan een minuut.
  V.toon = function () { teken(); if (!S.laadtijd || D.nu() - S.laadtijd > 60000) V.laad(); };

  // ── "gezien": welke toewijzingen ik al zag (voor "Nieuw voor mij") ──
  function leesGezien() { return leesJson(LS_GEZIEN) || {}; }
  function markeerGezien(item) {
    if (!item || !item.nieuw) return;
    const g = leesGezien(); g[item.id] = item.stempelToegewezen;
    const sl = Object.keys(g); if (sl.length > 500) sl.sort((a, b) => g[a] - g[b]).slice(0, sl.length - 500).forEach(k => { delete g[k]; });
    try { D.storage.setItem(LS_GEZIEN, JSON.stringify(g)); } catch (e) {}
  }

  // ── berekenen en tekenen ──
  function bereken() {
    const w = D.wie();
    S.mw = P.mijnWerk(S.taken, S.afhank, D.pvBlokken(), { mijn: w.slug, vandaag: P.vandaagYmd(), nu: D.nu(), gezien: leesGezien() });
    return S.mw;
  }
  const alleItems = mw => Object.keys(mw.groepen).reduce((a, k) => a.concat(mw.groepen[k]), []);
  const zoekItem = id => (S.mw ? alleItems(S.mw).find(i => i.id === id) || null : null);
  const uren = min => P.fmtUurMin(min);
  const DAGNAAM = ['Ma', 'Di', 'Wo', 'Do', 'Vr'];

  function weekKaart(mw) {
    const w = mw.week;
    const dagen = w.dagen.map((d, i) => el('div', { klass: 'vd-dag' + (d.datum === mw.vandaag ? ' nu' : '') + (d.werkdag ? '' : ' vrij'), title: fmtDatum(d.datum) + ': ' + uren(d.gepland_min) + ' gepland' },
      el('div', { klass: 'vd-dag-naam', tekst: DAGNAAM[i] }),
      el('div', { klass: 'vd-dagdelen' }, [0, 1].map(n => el('span', { klass: 'vd-deel' + (n < d.dagdelen ? ' vol' : '') })))));
    return el('div', { klass: 'card vd-week' },
      el('div', { klass: 'vd-week-tekst', tekst: 'Deze week ' + uren(w.gepland_min) + ' gepland / ' + uren(w.vrij_min) + ' vrij' + (w.over_min > 0 ? ' · ' + uren(w.over_min) + ' te veel' : '') }),
      el('div', { klass: 'vd-week-sub', tekst: w.dagdelen + ' van ' + w.dagdelenTotaal + ' dagdelen gepland (8 uur per werkdag, in dagdelen)' }),
      el('div', { klass: 'vd-dagen' }, dagen));
  }
  function meldingBalk() {
    if (S.staat === 'klaar') return null;
    let tekst;
    if (S.staat === 'demo') tekst = 'Demomodus: hier staat je echte werk zodra je ingelogd bent.';
    else if (S.staat === 'laden') tekst = 'Taken laden…';
    else tekst = P.lijstStatusTekst('taken', S.staat, S.vormFout) + (S.staat === 'overzetten' || S.staat === 'laden' ? '' : ' Je ziet de laatst opgehaalde stand; wijzigen kan niet.');
    const nogOpen = S.staat !== 'demo' && S.staat !== 'laden';
    return el('div', { klass: 'vd-melding', role: 'status' }, el('div', { tekst }), nogOpen ? el('button', { klass: 'timer-mini-btn', type: 'button', klik: () => V.laad(), tekst: 'Opnieuw proberen' }) : null);
  }
  function itemKaart(item) {
    const taak = item.soort === 'taak', t = item.taak;
    const naam = taak ? t.naam : item.naam, vandaag = S.mw.vandaag;
    let datum = '';
    if (taak) {
      if (item.blokken.length) { const b = item.blokken.filter(x => x.datum >= vandaag)[0] || item.blokken[0]; datum = dagWoord(b.datum, vandaag) + (b.start ? ' ' + b.start + '–' + eindTijd(b.start, b.duurMin) : '') + (item.blokken.length > 1 ? ' (+' + (item.blokken.length - 1) + ')' : ''); }
      else if (item.start && item.eind && item.start !== item.eind) datum = fmtDatum(item.start) + ' – ' + fmtDatum(item.eind);
      else if (item.start || item.eind) datum = dagWoord(item.start || item.eind, vandaag);
    } else datum = dagWoord(item.datum, vandaag) + (item.start ? ' ' + item.start + '–' + eindTijd(item.start, item.duurMin) : '');
    const regels = [el('div', { klass: 'vd-naam', tekst: naam }), el('div', { klass: 'vd-sub', tekst: [projLabel(item.code), datum, taak && item.gepland_min ? uren(item.gepland_min) + ' gepland' : ''].filter(Boolean).join(' · ') })];
    if (taak && item.status === 'wacht') regels.push(el('div', { klass: 'vd-wacht', tekst: 'Wacht: ' + (t.wacht_reden || 'geen reden opgegeven') }));
    else if (taak && item.wacht && item.wacht.wacht) regels.push(el('div', { klass: 'vd-wacht', tekst: 'Wacht op: ' + item.wachtTekst }));
    const chips = [];
    if (taak && item.status !== 'todo') chips.push(el('span', { klass: 'vd-chip vd-st-' + item.status, tekst: P.TAAK_STATUS_LABEL[item.status] || item.status }));
    if (!taak) chips.push(el('span', { klass: 'vd-chip', tekst: item.voorstel ? 'Planblok (voorstel)' : 'Planblok' }));
    if (taak && t.voorstel) chips.push(el('span', { klass: 'vd-chip', tekst: 'Voorstel' }));
    return el('button', { klass: 'vd-kaart', type: 'button', klik: () => toonKaart(item.id) },
      el('span', { klass: 'vd-strook', style: 'background:' + kleur(item.code) }), el('span', { klass: 'vd-kaart-tekst' }, regels), chips.length ? el('span', { klass: 'vd-chips' }, chips) : null);
  }
  const GROEPEN = [['nieuw', 'Nieuw voor mij'], ['teLaat', 'Te laat'], ['vandaag', 'Vandaag'], ['week', 'Deze week'], ['later', 'Later'], ['zonderDatum', 'Zonder datum']];
  function teken() {
    const wortel = D && D.doc.getElementById('vandaag-inhoud'); if (!wortel) return;
    const mw = bereken(); wortel.textContent = '';
    wortel.appendChild(weekKaart(mw));
    const mb = meldingBalk(); if (mb) wortel.appendChild(mb);
    if (S.nogNietGedeeld && S.staat === 'klaar') wortel.appendChild(el('div', { klass: 'vd-melding', role: 'status', tekst: 'Een eerdere wijziging is nog niet gedeeld; die wordt opnieuw geprobeerd zodra je weer verbinding hebt.' }));
    let leeg = true;
    GROEPEN.forEach(([k, titel]) => {
      const items = mw.groepen[k]; if (!items.length) return; leeg = false;
      wortel.appendChild(el('div', { klass: 'section-head vd-kop' + (k === 'teLaat' ? ' alarm' : ''), tekst: titel + ' (' + items.length + ')' }));
      items.forEach(i => wortel.appendChild(itemKaart(i)));
    });
    if (mw.groepen.nietVrij.length) {
      leeg = false;
      wortel.appendChild(el('details', { klass: 'vd-niet-vrij' }, el('summary', { tekst: 'Nog niet vrijgegeven (' + mw.groepen.nietVrij.length + ')' }), mw.groepen.nietVrij.map(itemKaart)));
    }
    if (leeg && S.staat === 'klaar') wortel.appendChild(el('div', { klass: 'empty-state' }, el('div', { klass: 'empty-text', tekst: 'Niets voor jou op dit moment.' })));
    if (S.open) { const it = zoekItem(S.open.id); if (it) vulKaart(it); else sluitKaart(); }   // de taak is er niet meer (klaar, anders toegewezen): de kaart sluit
  }
  V.teken = teken;

  // ── de taakkaart (sheet) ──
  function sheet() {
    if (S.sheet) return S.sheet;
    const titel = el('div', { klass: 'sheet-title' }), sub = el('div', { klass: 'sheet-sub' }), body = el('div', { klass: 'sheet-body' }), acties = el('div', { klass: 'sheet-actions' });
    const overlay = el('div', { klass: 'sheet-overlay', id: 'vandaagSheet', klik: ev => { if (ev.target === overlay) sluitKaart(); } },
      el('div', { klass: 'sheet', role: 'dialog', 'aria-modal': 'true' }, el('div', { klass: 'sheet-handle' }),
        el('div', { klass: 'sheet-head', style: 'position:relative' }, el('button', { klass: 'sheet-close', type: 'button', 'aria-label': 'Sluiten', klik: () => sluitKaart(), tekst: '×' }), titel, sub), body, acties));
    D.doc.body.appendChild(overlay);
    S.sheet = { overlay, titel, sub, body, acties };
    return S.sheet;
  }
  function sluitKaart() { S.open = null; if (S.sheet) S.sheet.overlay.classList.remove('visible'); }
  V.sluitKaart = sluitKaart;
  function toonKaart(id) {
    const item = zoekItem(id); if (!item) return;
    S.open = { id }; markeerGezien(item);
    vulKaart(item); sheet().overlay.classList.add('visible');
  }
  V.toonKaart = toonKaart;
  const rij = (...k) => el('div', { klass: 'vd-rij' }, k);
  function vulKaart(item) {
    const sh = sheet(), taak = item.soort === 'taak', t = item.taak, vandaag = S.mw.vandaag;
    sh.titel.textContent = taak ? t.naam : item.naam;
    sh.sub.textContent = projLabel(item.code);
    const b = sh.body; b.textContent = '';
    b.appendChild(rij(el('span', { klass: 'vd-punt', style: 'background:' + kleur(item.code) }), el('span', { tekst: projLabel(item.code) })));
    if (taak) {
      b.appendChild(rij(el('span', { klass: 'vd-chip vd-st-' + item.status, tekst: P.TAAK_STATUS_LABEL[item.status] || item.status }), item.status === 'wacht' ? el('span', { tekst: ' ' + (t.wacht_reden || 'geen reden opgegeven') }) : null));
      if (item.wacht && item.wacht.wacht) b.appendChild(rij(el('span', { klass: 'vd-wacht', tekst: 'Wacht op: ' + item.wachtTekst + (item.groep === 'nietVrij' ? ' — nog niet vrijgegeven' : '') })));
      if (item.start || item.eind) b.appendChild(rij(el('span', { tekst: 'Gepland: ' + (item.start && item.eind && item.start !== item.eind ? fmtDatum(item.start) + ' – ' + fmtDatum(item.eind) : dagWoord(item.start || item.eind, vandaag)) })));
      item.blokken.forEach(x => b.appendChild(rij(el('span', { tekst: 'Planblok ' + dagWoord(x.datum, vandaag) + (x.start ? ' ' + x.start + '–' + eindTijd(x.start, x.duurMin) : '') + (x.voorstel ? ' (voorstel)' : '') }))));
      const geklokt = el('span', { klass: 'vd-geklokt', tekst: '' });
      b.appendChild(rij(el('span', { tekst: item.gepland_min ? 'Gepland ' + uren(item.gepland_min) + ' · ' : 'Geen uren gepland · ' }), geklokt));
      vulGeklokt(item, geklokt);
      if (t.omschrijving) b.appendChild(el('div', { klass: 'vd-omschrijving', tekst: t.omschrijving }));
      if (t.voorstel) b.appendChild(rij(el('span', { klass: 'vd-sub', tekst: 'Voorstel' + (t.voorstel.doorNaam ? ' van ' + t.voorstel.doorNaam : '') + (t.voorstel.rol === 'werkplaats' ? ' (werkplaats)' : '') + ' — kantoor beslist.' })));
    } else {
      b.appendChild(rij(el('span', { tekst: 'Planblok ' + dagWoord(item.datum, vandaag) + (item.start ? ' ' + item.start + '–' + eindTijd(item.start, item.duurMin) : '') + (item.voorstel ? ' (voorstel)' : '') })));
    }
    kaartKnoppen(item);
  }
  // Wat geklokt is op deze taak (alleen jouw eigen uren uit Toggl; de taak moet aan een Toggl-taak gekoppeld zijn).
  async function vulGeklokt(item, doel) {
    const t = item.taak;
    if (!t.tg_task_id) { doel.textContent = 'geklokt: niet aan een Toggl-taak gekoppeld'; return; }
    doel.textContent = 'geklokt: laden…';
    let min = null; try { min = await geklokteMin(t.tg_task_id); } catch (e) { min = null; }
    if (S.open && S.open.id === item.id && doel.isConnected !== false) doel.textContent = min === null ? 'geklokt: nu niet op te halen' : 'door jou geklokt ' + uren(min);
  }
  async function geklokteMin(tgId) {
    if (!D.toggl || typeof D.toggl.geklokt !== 'function') return null;
    const l = await D.toggl.geklokt(); if (!Array.isArray(l)) return null;
    return Math.round(l.filter(g => String(g.taak) === String(tgId)).reduce((s, g) => s + (Number(g.min) || 0), 0));
  }
  V.geklokteMin = geklokteMin;

  // ── knoppen onderaan de kaart: de status (Bezig · Wacht · Klaar), de timer en het project ──
  function knop(tekst, klik, opt) { const o = opt || {}; return el('button', { klass: 'btn ' + (o.klass || 'btn-secondary') + ' btn-full', type: 'button', disabled: o.uit ? true : null, title: o.titel || null, klik, tekst }); }
  function statusKnop(tekst, status, item, uit) {
    const actief = item.status === status;
    return el('button', { klass: 'btn ' + (actief ? 'btn-primary' : 'btn-secondary'), type: 'button', disabled: uit ? true : null, 'aria-pressed': actief ? 'true' : 'false', klik: () => zetStatus(item.id, status), tekst });
  }
  function kaartKnoppen(item) {
    const a = sheet().acties; a.textContent = '';
    if (item.soort === 'taak') {
      const blok = schrijfBlok(P.ROL.TAAK_STATUS), uit = !!blok || S.bezig;
      a.appendChild(el('div', { klass: 'vd-status-rij' }, [statusKnop('Bezig', 'bezig', item, uit), statusKnop('Wacht', 'wacht', item, uit), statusKnop('Klaar', 'klaar', item, uit)]));
      if (blok) a.appendChild(el('div', { klass: 'vd-sub', tekst: blok }));
      const uitTimer = D.demo() ? 'Demomodus.' : (D.rol.mag(P.ROL.UREN_BOEKEN) ? '' : 'Dit mag je niet met jouw rol.');
      a.appendChild(knop('▶ Start timer', () => startTimer(item), { klass: 'btn-primary', uit: !!uitTimer, titel: uitTimer }));
    }
    a.appendChild(knop('Open project', () => openProject(item)));
  }
  function openProject(item) {
    const p = projInfo(item.code);
    if (!p || !p.mobielId) { D.toast('Dit project staat niet in je projectenlijst.'); return; }
    sluitKaart(); D.openProject(p.mobielId);
  }
  // De bestaande timerroute (Toggl via de worker): het project kiezen en starten; loopt er al een timer, dan eerst vragen.
  async function startTimer(item) {
    const taak = item.taak, p = projInfo(item.code);
    if (D.demo() || !D.rol.mag(P.ROL.UREN_BOEKEN)) return;
    if (!p || !p.mobielId || !p.togglProjectId) { D.toast('Dit project heeft nog geen Toggl-project: de timer kan hier niet starten.'); return; }
    const lopend = D.timer.lopend();
    if (lopend && lopend.mobielId === p.mobielId) { D.toast('De timer loopt al op dit project.'); return; }
    if (lopend) {
      const ja = await D.dialog().confirm({ title: 'Timer loopt al', message: 'De timer loopt op "' + (lopend.naam || 'een ander project') + '". Stoppen en starten op "' + projLabel(item.code) + '"?', okLabel: 'Stoppen en starten' });
      if (!ja) return;
      if (D.timer.lopend() && D.timer.lopend().mobielId === p.mobielId) return;   // intussen al gestart
      D.timer.stop();
    }
    if (!D.rol.mag(P.ROL.UREN_BOEKEN)) return;   // het recht opnieuw na de dialoog
    D.timer.start(p.mobielId, taak.naam);
    sluitKaart(); D.toast('Timer gestart op ' + projLabel(item.code));
  }

  // ── schrijven: de status van een taak (Bezig · Wacht · Klaar) ──
  // Volgorde, zoals in de cockpit: eerst kijken of het mag (lijst klaar, schema, rol), dan de vragen (reden, "deze taak wacht"), daarna opnieuw kijken, en dan pas schrijven.
  // Het schrijven zelf (P.takenSchrijf) leest vers van SharePoint, voegt samen, stempelt per veld en controleert vlak voor het PUT nog eens recht en schema.
  // Is er niet opgeslagen, dan verandert er niets en blijft de kaart zoals hij was (probeer opnieuw).
  async function voorWrite() {
    if (D.demo()) return false;
    if (!(await schemaCheck())) { S.staat = 'schema'; return false; }
    return S.staat === 'klaar';
  }
  function bewaarLokaal(data) { S.taken = data; try { D.storage.setItem(LS_TAKEN, JSON.stringify(data)); } catch (e) { /* de stand staat op SharePoint; lokaal alleen een kopie */ } }
  // Uitkomst van een schrijfpoging in gewone taal. → true als het is opgeslagen.
  async function afhandelen(res, wat) {
    if (res && res.ok) { bewaarLokaal(res.data); return true; }
    const reden = res && res.reden;
    if (reden === 'recht') D.toast('⛔ ' + wat + ' mag je niet met jouw rol. Er is niets gewijzigd.');
    else if (reden === 'ontbreekt') {
      const vw = P.verweesdOpruimen(D.storage, LS_TAKEN, D.nu());
      S.staat = vw.actie === 'verweesd' ? 'verweesd' : vw.actie === 'backup-mislukt' ? 'backup-mislukt' : 'overzetten'; S.taken = {};
      D.toast(P.lijstStatusTekst('taken', S.staat)); teken();
    } else if (reden === 'vorm') { S.staat = 'geblokkeerd'; S.vormFout = res.fout || ''; D.toast(P.lijstStatusTekst('taken', S.staat, S.vormFout)); teken(); }
    else if (reden === 'lezen') D.toast('Geen verbinding met SharePoint — er is niets gewijzigd. Probeer het zo opnieuw.');
    else if (reden === 'weigering') D.toast(res.fout || 'Dit kon niet.');
    else if (reden === 'geblokkeerd') { D.toast(S.staat === 'schema' ? P.SCHEMA_TEKST : (schrijfBlok() || 'Wijzigen kan nu niet.')); teken(); }
    else D.toast('Opslaan is niet gelukt — er is niets gewijzigd. Probeer het zo opnieuw.');
    return false;
  }
  // Een herstelkopie van de taak vóór de wijziging (zoals het taken-journaal van de cockpit); mislukt dat, dan blijft de wijziging gewoon staan.
  function journaalTaak(actie, code, taak) {
    const regel = { id: 'j' + D.nu().toString(36) + Math.random().toString(36).slice(2, 6), tijd: new Date(D.nu()).toISOString(), actie, code, taak: taak ? JSON.parse(JSON.stringify(taak)) : null, via: 'mobiel' };
    return P.journaalSchrijf(D.sp, 'mt_taken_journaal.json', regel, 1000).catch(() => false);
  }
  async function vraagReden(item) {
    for (let i = 0; i < 3; i++) {
      const r = await D.dialog().prompt({ title: 'Waarom wacht deze taak?', message: '"' + item.taak.naam + '"', placeholder: 'Bijvoorbeeld: wacht op plaatmateriaal', defaultValue: i === 0 ? (item.taak.wacht_reden || '') : '', okLabel: 'Zet op Wacht' });
      if (r === null || r === undefined) return null;
      if (String(r).replace(/\s+/g, ' ').trim().length >= 2) return String(r).replace(/\s+/g, ' ').trim();
      D.toast('Een reden is verplicht bij Wacht.');
    }
    return null;
  }
  async function zetStatus(id, nieuw) {
    if (S.bezig) return;
    let item = zoekItem(id); if (!item || item.soort !== 'taak') return;
    const huidig = item.status, t = item.taak;
    if (huidig === nieuw && nieuw !== 'wacht') return;
    let blok = schrijfBlok(P.ROL.TAAK_STATUS); if (blok) { D.toast(blok); return; }
    let reden = '';
    if (nieuw === 'wacht') { reden = await vraagReden(item); if (reden === null) return; }
    if (item.wacht && item.wacht.wacht && huidig === 'todo' && nieuw !== 'todo' && nieuw !== 'wacht') {   // een taak die op een voorganger wacht start pas na een bevestiging
      const ja = await D.dialog().confirm({ title: 'Deze taak wacht', message: '"' + t.naam + '" wacht op: ' + item.wachtTekst + '.\nToch ' + (nieuw === 'klaar' ? 'op klaar zetten' : 'starten') + '?', okLabel: 'Toch doorgaan' });
      if (!ja) return;
    }
    blok = schrijfBlok(P.ROL.TAAK_STATUS); if (blok) { D.toast(blok); return; }   // opnieuw na de dialogen: de lijst, het schema of het recht kan intussen veranderd zijn
    item = zoekItem(id) || item;
    S.bezig = true; vulKaart(item);
    let res, gelukt = false;
    try {
      const w = D.wie(), p = projInfo(item.code);
      res = await P.takenSchrijf(D.sp, {
        code: item.code, projectId: (p && p.projectId) || '', lokaal: D.storage.getItem(LS_TAKEN), door: w.email, dev: D.dev(), nu: D.nu(),
        muteer: lijst => { const x = lijst.find(y => y.id === id); if (!x) return { fout: 'Deze taak bestaat niet meer.' }; const r = P.statusZet(x, nieuw, { reden }); return r.ok ? lijst : { fout: r.fout }; },
        mag: spec => D.rol.mag(spec), voorWrite
      });
      gelukt = await afhandelen(res, 'De status van een taak wijzigen');
    } finally { S.bezig = false; }
    if (!gelukt) { teken(); return; }
    journaalTaak('status', item.code, (res.oud || []).find(x => x.id === id));
    D.toast('Taak op ' + P.TAAK_STATUS_LABEL[nieuw] + ' gezet.');
    if (nieuw === 'klaar') sluitKaart();
    teken();
  }
  V.zetStatus = zetStatus;

  V.init = function (deps) { D = deps; P = deps.planning || root.MTPlanning; S.staat = 'laden'; return V; };
  V._S = S;
  root.MTVandaag = V;
  if (typeof module !== 'undefined' && module.exports) module.exports = V;
})(typeof window !== 'undefined' ? window : globalThis);
