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
  const S = { staat: 'laden', vormFout: '', schemaMin: null, taken: {}, afhank: {}, mw: null, vrij: null, verlof: null, werktijden: null, laadtijd: 0, bezigLaden: null, open: null, bezig: false };

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
  const fmtDatum = ymd => P.datumKort(ymd);   // "vr 16 okt" (gedeeld in mt-planning.js)
  function plusDag(ymd, n) { const [y, m, d] = ymd.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d + n)); return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0'); }
  function dagWoord(ymd, vandaag) { return ymd === vandaag ? 'vandaag' : ymd === plusDag(vandaag, 1) ? 'morgen' : fmtDatum(ymd); }
  const eindTijd = (start, min) => { const m = /^(\d{2}):(\d{2})$/.exec(start || ''); if (!m) return ''; const t = Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2]) + Math.max(0, Math.round(Number(min) || 0))); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
  function projInfo(code) { try { return (D.project && D.project(code)) || null; } catch (e) { return null; } }
  function projLabel(code) { const i = projInfo(code); if (!i) return String(code || ''); return [i.nr, i.naam].filter(Boolean).join(' ') || String(code || ''); }
  const kleur = code => P.projectKleur(code);

  // ── wat mag er? ──
  // '' = mag; anders de reden in gewone taal (de knoppen gaan dan uit en de reden staat erbij).
  // soort 'bestel': een bestelvoorstel hangt niet aan de takenlijst (en niet aan het projectschema) maar aan de bestellijst; die controleert de schrijfkern zelf.
  function schrijfBlok(spec, soort) {
    if (D.demo()) return 'Demomodus: wijzigen kan alleen in de echte app.';
    if (soort !== 'bestel' && S.staat !== 'klaar') return P.lijstStatusTekst('taken', S.staat, S.vormFout) + ' Je kijkt alleen mee.';
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
    // De vrije dagen en het verlof uit Beheer (dezelfde bestanden als de cockpit): ze tellen mee in de weekbalk en in "wacht op een wachttijd". Niet te lezen = zoals voorheen (alleen weekenden).
    try { const r = await D.sp.read('mt_vrijedagen.json'); if (Array.isArray(r)) S.vrij = P.vrijeDagenLijst(r); } catch (e) {}
    try { const r = await D.sp.read('mt_verlof.json'); if (Array.isArray(r)) S.verlof = r; } catch (e) {}
    await werktijdenLaad();
    S.laadtijd = D.nu(); teken();
  }
  // De werktijden (mt_werktijden.json, alleen lezen; de telefoon schrijft ze nooit) tellen alleen mee onder de nieuwe stijl (D.werktijdenAan). Niet te lezen of een onverwachte vorm = zoals voorheen (8 uur per werkdag).
  async function werktijdenLaad() {
    if (!(D.werktijdenAan && D.werktijdenAan())) { S.werktijden = null; return; }
    try { const r = await D.sp.read('mt_werktijden.json'); S.werktijden = Array.isArray(r) ? P.werktijdenSamen(null, r) : null; } catch (e) { /* niet te lezen: de laatst bekende stand (of geen) blijft */ }   // een onverwachte vorm (of geen bestand) = geen werktijden = 8 uur per dag; de vorige stand wordt niet vastgehouden
  }
  // De stijl is gewisseld: werktijden erbij (nieuw) of weg (oud) en opnieuw tekenen.
  V.stijlGewijzigd = async function () { await werktijdenLaad(); teken(); };
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
    const g = leesGezien(); g[item.code + ':' + item.id] = item.stempelToegewezen;
    const sl = Object.keys(g); if (sl.length > 500) sl.sort((a, b) => g[a] - g[b]).slice(0, sl.length - 500).forEach(k => { delete g[k]; });
    try { D.storage.setItem(LS_GEZIEN, JSON.stringify(g)); } catch (e) {}
  }

  // ── berekenen en tekenen ──
  function bereken() {
    const w = D.wie();
    const opt = { mijn: w.slug, vandaag: P.vandaagYmd(), nu: D.nu(), gezien: leesGezien(), vrij: S.vrij, verlof: S.verlof };
    if (D.werktijdenAan && D.werktijdenAan() && S.werktijden) { opt.capPerDag = P.capPerDagVoor(w.slug, S.werktijden); opt.werktijden = S.werktijden; }   // de beschikbare uren per dag volgen jouw werktijden (zonder record: 8 uur per dag, zoals altijd)
    const mw = P.mijnWerk(S.taken, S.afhank, D.pvBlokken(), opt);
    // Zonder datum, Nieuw voor mij en Nog niet vrijgegeven tonen dezelfde taken als "Nog in te plannen" op de desktop: een taak met een open voorstel (zonder plek) telt pas na akkoord en blijft er dus uit
    ['nieuw', 'nietVrij', 'zonderDatum'].forEach(k => { mw.groepen[k] = mw.groepen[k].filter(it => !P.zonderPlek(it) || P.nogInTePlannen(it)); });
    mw.aantal = Object.keys(mw.groepen).reduce((s, k) => s + mw.groepen[k].length, 0);
    S.mw = mw;
    return S.mw;
  }
  // Voor het startvenster (mt-startvenster.js): mijn werk zonder "nieuw voor mij" (alles staat dan in zijn datumgroep); alleen als de takenlijst goed geladen is.
  V.mijnOpen = function () { const w = D.wie(); return P.mijnWerk(S.taken, S.afhank, D.pvBlokken(), { mijn: w.slug, vandaag: P.vandaagYmd(), nu: D.nu(), nieuw: false, vrij: S.vrij, verlof: S.verlof }); };
  V.takenKlaar = () => S.staat === 'klaar';
  const alleItems = mw =>Object.keys(mw.groepen).reduce((a, k) => a.concat(mw.groepen[k]), []);
  // Een taak van iemand anders (of van niemand), geopend via een deep link van de tv: dezelfde berekening als Mijn werk, maar voor iedereen.
  function losItem(code, id) {
    const mw = P.mijnWerk(S.taken, S.afhank, D.pvBlokken(), { iedereen: true, nieuw: false, project: code, vandaag: P.vandaagYmd(), nu: D.nu() });
    return alleItems(mw).find(i => i.soort === 'taak' && i.id === id) || null;
  }
  // Een taak zoeken op projectcode + taak_id. Zonder code (een oude deeplink) alleen als het taak_id uniek is; bij twee projecten met hetzelfde taak_id geen gok.
  const zCode = (a, b) => String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();
  const zoekItem = (id, code) => {
    if (S.mw) { const c = alleItems(S.mw).filter(i => i.id === id && (!code || zCode(i.code, code))); if (c.length === 1) return c[0]; if (c.length > 1) return null; }
    return S.open && S.open.id === id && S.open.code && (!code || zCode(S.open.code, code)) ? losItem(S.open.code, id) : null;
  };
  const uren = min => P.fmtUurMin(min);
  const wachtTekst = item => P.wachtOpTekst(item.wacht, fmtDatum);   // "Zagen (wachttijd 2 werkdagen, tot do 22 okt)"
  const DAGNAAM = ['Ma', 'Di', 'Wo', 'Do', 'Vr'];

  function weekKaart(mw) {
    const w = mw.week;
    const dagen = w.dagen.map((d, i) => el('div', { klass: 'vd-dag' + (d.datum === mw.vandaag ? ' nu' : '') + (d.werkdag ? '' : ' vrij'), title: fmtDatum(d.datum) + ': ' + uren(d.gepland_min) + ' gepland' },
      el('div', { klass: 'vd-dag-naam', tekst: DAGNAAM[i] }),
      el('div', { klass: 'vd-dagdelen' }, [0, 1].map(n => el('span', { klass: 'vd-deel' + (n < d.dagdelen ? ' vol' : '') })))));
    return el('div', { klass: 'card vd-week' },
      el('div', { klass: 'vd-week-tekst', tekst: 'Deze week ' + uren(w.gepland_min) + ' gepland / ' + uren(w.vrij_min) + ' vrij' + (w.over_min > 0 ? ' · ' + uren(w.over_min) + ' te veel' : '') }),
      el('div', { klass: 'vd-week-sub', tekst: w.dagdelen + ' van ' + w.dagdelenTotaal + (D.werktijdenAan && D.werktijdenAan() && S.werktijden && P.werktijdenMap(S.werktijden)[String((D.wie() || {}).slug || '').toLowerCase()] ? ' dagdelen gepland (volgens jouw werktijden, in dagdelen)' : ' dagdelen gepland (8 uur per werkdag, in dagdelen)') }),
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
    else if (taak && item.wacht && item.wacht.wacht) regels.push(el('div', { klass: 'vd-wacht', tekst: 'Wacht op: ' + wachtTekst(item) }));
    const chips = [];
    if (taak && item.status !== 'todo') chips.push(el('span', { klass: 'vd-chip vd-st-' + item.status, tekst: P.TAAK_STATUS_LABEL[item.status] || item.status }));
    if (!taak) chips.push(el('span', { klass: 'vd-chip', tekst: item.voorstel ? 'Planblok (voorstel)' : 'Planblok' }));
    if (taak && t.voorstel) chips.push(el('span', { klass: 'vd-chip', tekst: 'Voorstel' }));
    return el('button', { klass: 'vd-kaart', type: 'button', klik: () => toonKaart(item.id, item.code) },
      el('span', { klass: 'vd-strook', style: 'background:' + kleur(item.code) }), el('span', { klass: 'vd-kaart-tekst' }, regels), chips.length ? el('span', { klass: 'vd-chips' }, chips) : null);
  }
  const GROEPEN = [['nieuw', 'Nieuw voor mij'], ['teLaat', 'Te laat'], ['vandaag', 'Vandaag'], ['week', 'Deze week'], ['later', 'Later'], ['zonderDatum', 'Zonder datum']];
  function teken() {
    const wortel = D && D.doc.getElementById('vandaag-inhoud'); if (!wortel) return;
    const mw = bereken(); wortel.textContent = '';
    const plus = D.doc.getElementById('vandaagPlus');   // de grote +: weg voor wie niets mag melden (een rol zonder taak- en bestelrecht)
    if (plus) plus.classList.toggle('mt-rol-verborgen', !(D.rol.mag(P.ROL.TAAK_STATUS) || D.rol.mag(P.ROL.BESTEL_TOEV)));
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
    if (S.open) { const it = zoekItem(S.open.id, S.open.code); if (it) vulKaart(it); else sluitKaart(); }   // de taak is er niet meer (klaar, anders toegewezen): de kaart sluit
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
  function sluitKaart() { S.open = null; S.form = null; if (S.sheet) S.sheet.overlay.classList.remove('visible'); }
  V.sluitKaart = sluitKaart;
  function toonKaart(id, code) {
    let item = zoekItem(id, code); if (!item && code) item = losItem(code, id);
    if (!item) return false;
    S.open = { id, code: item.code }; markeerGezien(item);
    vulKaart(item); sheet().overlay.classList.add('visible'); return true;
  }
  V.toonKaart = toonKaart;
  // Een deep link van de tv: mobiel.html#taak/<projectcode>/<taak-id> opent de taakkaart, #project/<projectcode> het project. De taak mag ook van een ander zijn.
  V.openDeeplink = async function (hash) {
    const l = P.deepLinkLees(hash); if (!l) return false;
    if (!S.laadtijd) await V.laad();
    if (l.soort === 'project') {
      const p = projInfo(l.code);
      if (p && p.mobielId) { D.openProject(p.mobielId); return true; }
      D.toast('Dit project staat niet in je projectenlijst.'); return false;
    }
    if (!toonKaart(l.id, l.code)) { D.toast('Deze taak is niet meer te vinden (misschien klaar of verwijderd).'); return false; }
    return true;
  };
  const rij = (...k) => el('div', { klass: 'vd-rij' }, k);
  function vulKaart(item) {
    const sh = sheet(), taak = item.soort === 'taak', t = item.taak, vandaag = S.mw.vandaag;
    sh.titel.textContent = taak ? t.naam : item.naam;
    sh.sub.textContent = projLabel(item.code);
    const b = sh.body; b.textContent = '';
    b.appendChild(rij(el('span', { klass: 'vd-punt', style: 'background:' + kleur(item.code) }), el('span', { tekst: projLabel(item.code) })));
    if (taak) {
      b.appendChild(rij(el('span', { klass: 'vd-chip vd-st-' + item.status, tekst: P.TAAK_STATUS_LABEL[item.status] || item.status }), item.status === 'wacht' ? el('span', { tekst: ' ' + (t.wacht_reden || 'geen reden opgegeven') }) : null));
      if (item.wacht && item.wacht.wacht) b.appendChild(rij(el('span', { klass: 'vd-wacht', tekst: 'Wacht op: ' + wachtTekst(item) + (item.groep === 'nietVrij' ? ' — nog niet vrijgegeven' : '') })));
      if (item.start || item.eind) b.appendChild(rij(el('span', { tekst: 'Wanneer: ' + (item.start && item.eind && item.start !== item.eind ? fmtDatum(item.start) + ' – ' + fmtDatum(item.eind) : dagWoord(item.start || item.eind, vandaag)) })));
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
    if (S.open && S.open.id === item.id && zCode(S.open.code, item.code) && doel.isConnected !== false) doel.textContent = min === null ? 'geklokt: nu niet op te halen' : 'door jou geklokt ' + uren(min);
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
    return el('button', { klass: 'btn ' + (actief ? 'btn-primary' : 'btn-secondary'), type: 'button', disabled: uit ? true : null, 'aria-pressed': actief ? 'true' : 'false', klik: () => zetStatus(item.id, status, item.code), tekst });
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
    else D.toast('Opslaan is niet gelukt of niet bevestigd — kijk na of de wijziging er staat en probeer het anders opnieuw.');
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
  // Het materiaal van een taak: vers uit de bestellijst op SharePoint (de lokale kopie op de telefoon kan oud zijn). Lukt het lezen niet, dan geen bevestiging (het is een hulp, geen slot).
  async function materiaalVoor(item) {
    try {
      const raw = await D.sp.read('mt_bestellijst_v2.json'); if (!Array.isArray(raw)) return null;
      const p = projInfo(item.code);
      return P.taakMateriaal(item.taak, P.bestelVanTaak(raw, item.taak.id, { code: item.code, project_id: (p && p.projectId) || '' }), { vandaag: P.vandaagYmd() });
    } catch (e) { return null; }
  }
  async function zetStatus(id, nieuw, code) {
    if (S.bezig) return;
    let item = zoekItem(id, code); if (!item || item.soort !== 'taak') return;
    const huidig = item.status, t = item.taak;
    if (huidig === nieuw && nieuw !== 'wacht') return;
    let blok = schrijfBlok(P.ROL.TAAK_STATUS); if (blok) { D.toast(blok); return; }
    let reden = '';
    if (nieuw === 'wacht') { reden = await vraagReden(item); if (reden === null) return; }
    if (item.wacht && item.wacht.wacht && huidig === 'todo' && nieuw !== 'todo' && nieuw !== 'wacht') {   // een taak die op een voorganger wacht start pas na een bevestiging
      const ja = await D.dialog().confirm({ title: 'Deze taak wacht', message: '"' + t.naam + '" wacht op: ' + wachtTekst(item) + '.\nToch ' + (nieuw === 'klaar' ? 'op klaar zetten' : 'starten') + '?', okLabel: 'Toch doorgaan' });
      if (!ja) return;
    }
    if (nieuw !== 'wacht' && huidig !== 'bezig' && huidig !== 'klaar') {   // een taak met open materiaal (bestelregels die aan de taak hangen) gaat niet stil naar Bezig of Klaar (P5)
      const mat = await materiaalVoor(item);
      if (mat && P.materiaalVraagBevestiging(t, mat, nieuw)) {
        const ja = await D.dialog().confirm({ title: 'Het materiaal is nog niet binnen', message: P.materiaalBevestigTekst(t.naam, mat, nieuw, P.datumKort), okLabel: 'Toch doorgaan' });
        if (!ja) return;
      }
    }
    blok = schrijfBlok(P.ROL.TAAK_STATUS); if (blok) { D.toast(blok); return; }   // opnieuw na de dialogen: de lijst, het schema of het recht kan intussen veranderd zijn
    item = zoekItem(id, code) || item;
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
    if (nieuw === 'klaar') await naKlaar(item);
  }
  V.zetStatus = zetStatus;

  // ── Klaar zonder lopende timer: "Tijd boeken: 2u30?" ──
  // De taak staat dan al op Klaar. De vraag komt alleen als er geen timer op dit project loopt, het project een Toggl-project heeft, de rol uren mag boeken en er geplande uren
  // over zijn (gepland min wat al geklokt is). Pas na een bevestiging gaat er één time-entry naar Toggl (de bestaande route van de telefoon): nooit stil boeken, en annuleren of
  // "alleen klaar melden" boekt niets. Faalt het boeken, dan zegt de app dat en probeert hij niets opnieuw: de taak blijft Klaar.
  const GEBOEKT = 'mt_vandaag_geboekt', GEBOEKT_UREN = 12;
  const leesGeboekt = () => leesJson(GEBOEKT) || {};
  async function naKlaar(item) {
    const t = item.taak, p = projInfo(item.code);
    if (D.demo() || !p) return;
    const lopend = D.timer.lopend();
    if (lopend && p.mobielId && lopend.mobielId === p.mobielId) { D.toast('Klaar gemeld. Je timer loopt nog: stop hem als je klaar bent.'); return; }
    if (!p.mobielId || !p.togglProjectId || !D.rol.mag(P.ROL.UREN_BOEKEN) || !(item.gepland_min > 0)) return;
    let geklokt = null; if (t.tg_task_id) { try { geklokt = await geklokteMin(t.tg_task_id); } catch (e) { geklokt = null; } }
    const rest = Math.max(0, item.gepland_min - (geklokt || 0)); if (rest <= 0) return;
    const eerder = leesGeboekt()[t.id], eerderNog = !!(eerder && D.nu() - Number(eerder.t) < GEBOEKT_UREN * 3600000);
    const regels = ['"' + t.naam + '" is klaar gemeld.',
      geklokt === null ? 'Gepland ' + uren(item.gepland_min) + '. De geklokte uren op deze taak zijn nog niet bekend, dus dit is het geplande totaal.' : 'Gepland ' + uren(item.gepland_min) + ', al geklokt ' + uren(geklokt) + ': nog ' + uren(rest) + ' over.',
      eerderNog ? 'Let op: je boekte hier eerder vandaag al ' + uren(eerder.min) + ' op.' : '', 'Er wordt niets geboekt zonder jouw keuze.'].filter(Boolean);
    const keuze = await D.dialog().choose({ title: 'Tijd boeken: ' + uren(rest) + '?', message: regels.join('\n'),
      choices: [{ label: 'Boek ' + uren(rest), sublabel: 'Eén time-entry op ' + projLabel(item.code) }, { label: 'Ander aantal…', sublabel: 'Bijvoorbeeld 1,5 of 2u30' }, { label: 'Alleen klaar melden', sublabel: 'Er wordt niets geboekt' }] });
    if (keuze !== 0 && keuze !== 1) return;   // annuleren of "alleen klaar melden"
    let min = rest;
    if (keuze === 1) {
      const invoer = await D.dialog().prompt({ title: 'Hoeveel tijd boeken?', message: '"' + t.naam + '"', placeholder: 'Bijvoorbeeld 1,5 of 2u30', defaultValue: String(Math.round(rest / 60 * 100) / 100).replace('.', ','), okLabel: 'Boek' });
      if (invoer === null || invoer === undefined) return;
      min = P.duurNaarMin(invoer);
      if (min === null) { D.toast('Geen geldig aantal uren — er is niets geboekt.'); return; }
    }
    if (D.demo() || !D.rol.mag(P.ROL.UREN_BOEKEN)) { D.toast('⛔ Tijd boeken mag je niet met jouw rol. Er is niets geboekt.'); return; }   // opnieuw na de dialogen
    const nu = D.timer.lopend(); if (nu && nu.mobielId === p.mobielId) { D.toast('De timer loopt nu op dit project — er is niets geboekt.'); return; }
    try {
      const r = await D.toggl.boek({ mobielId: p.mobielId, minuten: min, omschrijving: t.naam, taskId: t.tg_task_id || null });
      const g = leesGeboekt(), nu2 = D.nu(); g[t.id] = { t: nu2, min: (eerderNog ? Number(eerder.min) || 0 : 0) + min };
      Object.keys(g).forEach(k => { if (nu2 - Number(g[k].t) > 48 * 3600000) delete g[k]; });
      try { D.storage.setItem(GEBOEKT, JSON.stringify(g)); } catch (e) {}
      D.toast('Geboekt: ' + uren(min) + ' op ' + projLabel(item.code) + '.' + (r && r.gekoppeld === false && t.tg_task_id ? ' Toggl nam de koppeling met de taak niet aan: de uren staan op het project.' : ''));
    } catch (e) { D.toast('Boeken mislukt: ' + String((e && e.message) || e) + '. De taak staat wel op Klaar.'); }
  }

  // ── de grote +: Taak melden · Probleem melden · Bestelvoorstel ──
  // Komt meteen in het project, gemarkeerd als voorstel (met wie en welke rol); kantoor ziet het en beslist. Een taak of probleem gaat in de takenlijst (dezelfde schrijfkern als
  // de status), een bestelvoorstel op de bestellijst (mt_bestellijst_v2: eerst het herstelspoor in het journaal, dan de regel; dezelfde samenvoeging als de cockpit).
  // Lukt het opslaan niet, dan blijft het formulier open met wat je typte; opnieuw versturen maakt nooit een tweede taak (het formulier houdt zijn id).
  const LS_BESTEL = 'mt_bestellijst_v2', LS_LAATSTE = 'mt_vandaag_laatste_project';
  const EENHEDEN = ['stuks', 'platen', 'm', 'm²', 'set', 'paar', 'doos', 'rol', 'liter', 'kg'];
  function menuKnop(icoon, titel, sub, uitleg, klik) {
    return el('button', { klass: 'sheet-action-btn', type: 'button', disabled: uitleg ? true : null, klik },
      el('span', { klass: 'sheet-action-icon', tekst: icoon }),
      el('span', { klass: 'sheet-action-label' }, el('div', { klass: 'sheet-action-title', tekst: titel }), el('div', { klass: 'sheet-action-sub', tekst: uitleg || sub })),
      el('span', { klass: 'sheet-action-arrow', tekst: '›' }));
  }
  V.menu = function () {
    const sh = sheet(); S.open = null; S.form = null;
    sh.titel.textContent = 'Melden'; sh.sub.textContent = 'Komt meteen in het project, als voorstel';
    sh.body.textContent = ''; sh.acties.textContent = '';
    const bT = schrijfBlok(P.ROL.TAAK_STATUS), bB = schrijfBlok(P.ROL.BESTEL_TOEV, 'bestel');
    sh.acties.appendChild(menuKnop('✚', 'Taak melden', 'Iets dat gedaan moet worden', bT, () => toonForm('taak')));
    sh.acties.appendChild(menuKnop('⚠', 'Probleem melden', 'Er klopt iets niet; kantoor ziet het meteen', bT, () => toonForm('probleem')));
    sh.acties.appendChild(menuKnop('🛒', 'Bestelvoorstel', 'Materiaal dat besteld moet worden', bB, () => toonForm('bestel')));
    sh.overlay.classList.add('visible');
  };
  const veld = (label, control, id) => el('div', { klass: 'vd-veld' }, el('label', { for: id, tekst: label }), control);
  const waarde = id => { const e = D.doc.getElementById(id); return e ? String(e.value == null ? '' : e.value) : ''; };
  function projectKeuze() {
    let l = []; try { l = (D.projectLijst && D.projectLijst()) || []; } catch (e) { l = []; }
    let laatste = ''; try { laatste = D.storage.getItem(LS_LAATSTE) || ''; } catch (e) {}
    return el('select', { id: 'vd-f-project' }, el('option', { value: '', tekst: 'Kies een project…' }),
      l.filter(Boolean).map(p => el('option', { value: p.code, selected: p.code === laatste ? true : null, tekst: [p.nr, p.naam].filter(Boolean).join(' ') || p.code })));
  }
  function formUit(uit) { if (S.sheet) S.sheet.acties.querySelectorAll('button').forEach(b => { b.disabled = !!uit; }); }
  function toonForm(soort) {
    const sh = sheet(), bestel = soort === 'bestel'; S.open = null;
    const f = S.form = { soort, id: bestel ? 'bl_' + D.nu().toString(36) + Math.random().toString(36).slice(2, 6) : P.taakId(), bezig: false };
    sh.titel.textContent = bestel ? 'Bestelvoorstel' : soort === 'probleem' ? 'Probleem melden' : 'Taak melden';
    sh.sub.textContent = 'Komt meteen in het project, als voorstel';
    const b = sh.body; b.textContent = ''; sh.acties.textContent = '';
    b.appendChild(veld('Project', projectKeuze(), 'vd-f-project'));
    b.appendChild(veld(bestel ? 'Materiaal' : soort === 'probleem' ? 'Wat is het probleem?' : 'Wat moet er gebeuren?', el('input', { id: 'vd-f-tekst', type: 'text', autocomplete: 'off', maxlength: '160' }), 'vd-f-tekst'));
    if (bestel) {
      b.appendChild(el('div', { klass: 'vd-status-rij' },
        veld('Aantal', el('input', { id: 'vd-f-aantal', type: 'number', inputmode: 'decimal', min: '0', step: 'any', value: '1' }), 'vd-f-aantal'),
        veld('Eenheid', el('select', { id: 'vd-f-eenheid' }, EENHEDEN.map(e => el('option', { value: e, tekst: e }))), 'vd-f-eenheid')));
      b.appendChild(veld('Opmerking (niet verplicht)', el('input', { id: 'vd-f-opm', type: 'text', autocomplete: 'off', maxlength: '300' }), 'vd-f-opm'));
    } else b.appendChild(veld('Toelichting (niet verplicht)', el('textarea', { id: 'vd-f-toelichting', maxlength: '1000' }), 'vd-f-toelichting'));
    sh.acties.appendChild(knop('Melden', () => verstuurForm(), { klass: 'btn-primary' }));
    sh.acties.appendChild(knop('Annuleren', () => sluitKaart(), { klass: 'btn-ghost' }));
    sh.overlay.classList.add('visible');
  }
  async function verstuurForm() {
    const f = S.form; if (!f || f.bezig) return;
    const v = { project: waarde('vd-f-project'), tekst: waarde('vd-f-tekst'), toelichting: waarde('vd-f-toelichting'), aantal: waarde('vd-f-aantal'), eenheid: waarde('vd-f-eenheid'), opmerking: waarde('vd-f-opm'), id: f.id };
    f.bezig = true; formUit(true);
    let ok = false;
    try { ok = await V.melden(f.soort, v); } finally { f.bezig = false; if (S.form === f) formUit(false); }
    if (ok && S.form === f) sluitKaart();
  }
  // Uitkomst van het toevoegen van een bestelregel in gewone taal. → true als de regel er staat.
  function afhandelenBestel(res) {
    if (res.ok || res.reden === 'bestaat') { D.toast('Bestelvoorstel staat op de bestellijst, als voorstel.'); return true; }
    if (res.reden === 'recht') D.toast('⛔ Een bestelregel toevoegen mag je niet met jouw rol. Er is niets toegevoegd.');
    else if (res.reden === 'ontbreekt') {
      const vw = P.verweesdOpruimen(D.storage, LS_BESTEL, D.nu());   // een lokale kopie zonder bestand op SharePoint wordt een back-up (zoals in de cockpit)
      D.toast(P.lijstStatusTekst('bestel', vw.actie === 'verweesd' ? 'verweesd' : vw.actie === 'backup-mislukt' ? 'backup-mislukt' : 'overzetten'));
    } else if (res.reden === 'vorm') D.toast(P.lijstStatusTekst('bestel', 'geblokkeerd', res.fout || ''));
    else if (res.reden === 'journaal') D.toast('Het herstelspoor (journaal) kon niet worden bewaard — er is niets toegevoegd. Probeer het zo opnieuw.');
    else if (res.reden === 'lezen') D.toast('Geen verbinding met SharePoint — er is niets toegevoegd. Probeer het zo opnieuw.');
    else if (res.reden === 'geblokkeerd') D.toast(schrijfBlok(P.ROL.BESTEL_TOEV, 'bestel') || 'Toevoegen kan nu niet.');
    else D.toast('Opslaan is niet gelukt of niet bevestigd — kijk na of het op de bestellijst staat en probeer het anders opnieuw (dezelfde melding krijgt dezelfde id, dus nooit dubbel).');
    return false;
  }
  // soort: 'taak' | 'probleem' | 'bestel'; v: { project (code), tekst, toelichting, aantal, eenheid, opmerking, id }. → true als het is opgeslagen.
  V.melden = async function (soort, v) {
    v = v || {}; const bestel = soort === 'bestel';
    const blok = schrijfBlok(bestel ? P.ROL.BESTEL_TOEV : P.ROL.TAAK_STATUS, bestel ? 'bestel' : '');
    if (blok) { D.toast(blok); return false; }
    const p = projInfo(v.project); if (!p) { D.toast('Kies eerst een project.'); return false; }
    const tekst = String(v.tekst == null ? '' : v.tekst).replace(/\s+/g, ' ').trim();
    if (!tekst) { D.toast(bestel ? 'Vul in welk materiaal je nodig hebt.' : 'Vul in wat er moet gebeuren.'); return false; }
    try { D.storage.setItem(LS_LAATSTE, p.code); } catch (e) {}
    const w = D.wie(), rol = D.rol.naam ? D.rol.naam() : '', nu = D.nu();
    if (bestel) {
      const regel = P.meldingBestel({ omschrijving: tekst, aantal: String(v.aantal == null ? '1' : v.aantal).replace(',', '.'), eenheid: v.eenheid, project: p.code, project_id: p.projectId || '', opmerking: v.opmerking, door: w.email, doorNaam: w.naam, rol, nu, id: v.id || '' });
      const res = await P.bestelNieuwSchrijf(D.sp, {
        regel, lokaal: D.storage.getItem(LS_BESTEL), mag: s => D.rol.mag(s), door: w.email, dev: D.dev(), nu, voorWrite,   // dezelfde schemacontrole als bij de taken en de cockpit
        journaal: r => P.journaalSchrijf(D.sp, 'mt_bestellijst_journaal.json', { id: 'j' + nu.toString(36) + Math.random().toString(36).slice(2, 6), tijd: new Date(nu).toISOString(), actie: 'nieuw (bestelvoorstel telefoon)', door: w.email, voor: null, na: JSON.parse(JSON.stringify(r)), via: 'mobiel' }, 1000)
      });
      return afhandelenBestel(res);
    }
    const nieuw = P.meldingTaak({ naam: tekst, omschrijving: v.toelichting, soort: soort === 'probleem' ? 'probleem' : 'taak', door: w.email, doorNaam: w.naam, rol, nu, id: v.id || '' });
    const res = await P.takenSchrijf(D.sp, {
      code: p.code, projectId: p.projectId || '', lokaal: D.storage.getItem(LS_TAKEN), door: w.email, dev: D.dev(), nu,
      muteer: lijst => lijst.some(x => x.id === nieuw.id) ? lijst : lijst.concat([nieuw]),   // dezelfde id staat er al (een eerdere poging kwam wel aan): niets dubbel
      mag: s => D.rol.mag(s), voorWrite
    });
    const ok = await afhandelen(res, 'Een taak toevoegen');
    if (ok) { D.toast((soort === 'probleem' ? 'Probleem gemeld' : 'Taak gemeld') + ': kantoor ziet het nu als voorstel in het project.'); teken(); }
    return ok;
  };

  V.init = function (deps) { D = deps; P = deps.planning || root.MTPlanning; S.staat = 'laden'; return V; };
  V._S = S; V._bereken = bereken;
  root.MTVandaag = V;
  if (typeof module !== 'undefined' && module.exports) module.exports = V;
})(typeof window !== 'undefined' ? window : globalThis);
