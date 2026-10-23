/* ============================================================================
 * mt-capaciteit-nieuw.js: Planning ▸ Capaciteit in de nieuwe stijl (restyling fase 1, brok 6 en 7)
 * ----------------------------------------------------------------------------
 * Het canvas (Planning-capaciteit.dc.html): het team als rijen, getinte blokken per project, de Ongepland-kolom, volle breedte, en vijf zooms
 * (kwartaal · maand · week · 3 dagen · dag). Alleen lezen: slepen komt in brok 8. Alle uren komen uit dezelfde rekenregels als de oude Capaciteit-weergave
 * (MTPlanning.teamCapaciteit en weekRooster, mt-planning.js): per persoon per dag gepland tegenover beschikbaar, met vrije dagen en verlof uit Beheer.
 * De zoom verandert alleen het venster en de manier van tekenen, nooit de getallen. Filter (wie, project) en datum blijven bij het wisselen van zoom.
 * Wordt alleen gebruikt als html[data-stijl="nieuw"] (mt-capaciteit.js geeft het tekenen dan aan dit bestand); tekent met DOM-calls, nooit met opgebouwde HTML.
 * Alles komt van buiten via init(deps), zodat het zonder de hele cockpit te testen is; model() is rekenwerk zonder DOM.
 * ========================================================================== */
(function (root) {
  'use strict';
  const N = {};
  let D = null, P = null;
  const LS_ZOOM = 'mt-cap-zoom';
  const ZOOM_UI = true;    // de zoomknoppen: kwartaal, maand, week, 3 dagen, dag (brok 7)
  const ZOOMS = [['kwartaal', 'Kwartaal'], ['maand', 'Maand'], ['week', 'Week'], ['3d', '3 dagen'], ['dag', 'Dag']];
  const S = { zoom: 'week', anker: null, persoon: '', project: '', ongDicht: false, fRev: -1 };
  // De gedeelde filterbalk (mt-planfilter.js): project, persoon en periode (begindatum en zoom) komen daar vandaan en staan in de link. Zonder die module (losse tests) werkt alles als voorheen.
  const FF = () => root.MTPlanFilter || null;
  function trekFilter() {   // de gedeelde stand overnemen zodra die veranderd is (de balk, een link, een andere weergave)
    const f = FF(); if (!f || f.rev() === S.fRev) return;
    const g = f.get();
    S.project = g.project; S.persoon = f.persoonSlug('iedereen');
    if (f.ZOOMS.includes(g.zoom)) S.zoom = g.zoom;
    if (f.isYmd(g.van)) { S.anker = g.van; S.exactDag = false; } else if (S.fRev >= 0) S.anker = null;   // een link zonder datum = deze periode
    S.fRev = f.rev();
  }
  function duwPeriode() {   // een eigen keuze van de periode (bladeren, zoom) naar de gedeelde stand en de link
    const f = FF(); if (!f) return;
    const nu = P.vandaagYmd();
    f.zet({ van: S.anker && S.anker !== nu ? S.anker : '', zoom: S.zoom }); S.fRev = f.rev();
  }
  function duwFilter(patch) { const f = FF(); if (!f) return; f.zet(patch); S.fRev = f.rev(); }   // een sprong naar een taak of persoon zet de filters zelf
  const LS_ONG = 'mt-cap-ong';   // 'dicht' = de Ongepland-kolom is ingeklapt (per computer onthouden)
  const U0 = 420, U1 = 1020, KOL = 20;   // 07:00 tot 17:00 in halve uren (20 kolommen per dag)

  // ── datums ──
  const nr = ymd => { const [y, m, d] = ymd.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const ymd = n => { const t = new Date(n * 864e5); return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0'); };
  const wd = n => ((n + 4) % 7 + 7) % 7;                 // 0 = zondag
  const monday = s => { const n = nr(s); return ymd(n - ((wd(n) + 6) % 7)); };
  const plusDagen = (s, k) => ymd(nr(s) + k);
  const isWeekend = s => { const w = wd(nr(s)); return w === 0 || w === 6; };
  function volgendeWerkdag(s, richting) { let n = nr(s); while (wd(n) === 0 || wd(n) === 6) n += richting; return ymd(n); }
  function plusWerkdagen(s, k) { let n = nr(volgendeWerkdag(s, k >= 0 ? 1 : -1)); const stap = k >= 0 ? 1 : -1; for (let i = 0; i < Math.abs(k); i++) { n += stap; while (wd(n) === 0 || wd(n) === 6) n += stap; } return ymd(n); }
  function isoWeek(s) { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))), dag = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - dag); return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); }
  const MND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'], MNDLANG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const DAGLANG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'], DAGKORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  const dagMnd = s => Number(s.slice(8)) + ' ' + MND[Number(s.slice(5, 7)) - 1];
  const uren = min => P.fmtUurMin(min);
  const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const tijdMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

  // ── rekenwerk (geen DOM) ──
  // Een venster van `weken` weken vanaf de maandag `van`, in stukken van maximaal 6 weken (zo veel rekent weekRooster in één keer) samengevoegd.
  function rooster(van, weken, o) {
    const delen = [];
    for (let w = 0; w < weken; w += 6) {
      const n = Math.min(6, weken - w), opt = Object.assign({}, o, { vandaag: plusDagen(van, w * 7), weken: n });
      delen.push({ cap: P.teamCapaciteit(D.taken(), D.afhank(), D.blokken(), opt), rr: P.weekRooster(D.taken(), D.afhank(), D.blokken(), opt), n });
    }
    const dagen = [], rijen = [];
    delen.forEach((dl, di) => {
      dl.cap.dagen.forEach(d => dagen.push(Object.assign({}, d, { week: di * 6 + d.week })));
      dl.cap.rijen.forEach((r, i) => {
        let t = rijen.find(x => x.slug === r.slug && x.naam === r.naam); if (!t) { t = { slug: r.slug, naam: r.naam, heeftCap: r.heeftCap, dagen: [], weken: [], slots: [] }; rijen.push(t); }
        // rijen die in een eerder stuk nog niet bestonden (de "Niet toegewezen"-rij verschijnt alleen als er iets staat) worden aangevuld met lege dagen en weken
        while (t.dagen.length < dagen.length - dl.cap.dagen.length) { t.dagen.push(null); t.slots.push([[], []]); }
        while (t.weken.length < di * 6) t.weken.push({ cap_min: 0, gepland_min: 0, vrij_min: 0, over_min: 0 });
        r.dagen.forEach(c => t.dagen.push(c)); r.weken.forEach(w => t.weken.push(w));
        const rr = dl.rr.rijen.find(x => x.slug === r.slug && x.naam === r.naam); (rr ? rr.cellen : r.dagen.map(() => [[], []])).forEach(c => t.slots.push(c));
      });
    });
    const totWeken = delen.reduce((s, dl) => s + dl.n, 0);
    rijen.forEach(t => { while (t.weken.length < totWeken) t.weken.push({ cap_min: 0, gepland_min: 0, vrij_min: 0, over_min: 0 }); while (t.dagen.length < dagen.length) { t.dagen.push(null); t.slots.push([[], []]); } t.dagen =t.dagen.map((c, i) => c || { datum: dagen[i].datum, werkdag: dagen[i].werkdag, verlof: false, cap_min: 0, gepland_min: 0, dagdelen: 0, vrij_min: 0, over_min: 0, items: [] }); });
    return { dagen, rijen };
  }

  // Ongepland: taken zonder datum en zonder planblok, en de voorstellen van de werkplaats (mijnWerk met iedereen: dezelfde indeling als Mijn werk)
  function ongepland(o) {
    const mw = P.mijnWerk(D.taken(), D.afhank(), D.blokken(), Object.assign({}, o, { iedereen: true, nieuw: false, voorstellen: true, vandaag: P.vandaagYmd(), nu: D.nu() }));
    const lijst = [];
    const neem = (it, soort) => { if (it.soort === 'taak' && !lijst.some(x => x.id === it.id && String(x.code).toLowerCase() === String(it.code).toLowerCase())) lijst.push({ id: it.id, code: it.code, naam: it.taak.naam, min: it.gepland_min || 0, voorstel: !!it.taak.voorstel, soort, tekst: it.taak.voorstel ? P.voorstelTekst(it.taak.voorstel) : '' }); };
    mw.groepen.voorstel.forEach(it => neem(it, 'voorstel'));
    mw.groepen.zonderDatum.forEach(it => neem(it, 'zonder'));
    mw.groepen.nietVrij.filter(it => !it.start && !it.eind && !(it.blokken && it.blokken.length)).forEach(it => neem(it, 'zonder'));
    lijst.sort((a, b) => (b.voorstel - a.voorstel) || (String(a.code).toLowerCase() < String(b.code).toLowerCase() ? -1 : String(a.code).toLowerCase() > String(b.code).toLowerCase() ? 1 : 0) || (a.naam < b.naam ? -1 : 1));
    return { items: lijst, min: lijst.reduce((s, x) => s + x.min, 0) };
  }

  N.model = function (st) {
    st = Object.assign({}, S, st || {});
    const today = P.vandaagYmd(), zoom = st.zoom, anker = st.anker || today;
    const team = D.team() || [], o = { team, vrij: D.vrij ? D.vrij() : null, verlof: D.verlof ? D.verlof() : null, werkuren: D.werkuren ? D.werkuren() : null, werktijden: D.werktijden ? D.werktijden() : null, project: st.project || '' };
    let van, weken, zichtbaar;
    const weekendDag = zoom === 'dag' && st.exactDag && P.isYmd(anker) && ((wd(nr(anker)) + 6) % 7) > 4;   // alleen na "Naar de dag" (exactDag) op een zaterdag of zondag (Afwijkingen: iemand werkte toch): precies die dag, als extra kolom. Gewoon bladeren of Vandaag op een weekend springt nog naar de maandag.   // zichtbaar = de datums die getekend worden
    if (zoom === 'week') { van = monday(anker); weken = 1; }
    else if (zoom === 'maand') { van = monday(anker); weken = 4; }
    else if (zoom === 'kwartaal') { van = monday(anker); weken = 13; }
    else {
      const s0 = weekendDag ? anker : volgendeWerkdag(anker, 1); van = monday(s0); zichtbaar = [s0]; weken = 1; if (weekendDag) o.extra = [anker];
      if (zoom === '3d') { let d = s0; for (let i = 0; i < 2; i++) { d = plusWerkdagen(d, 1); zichtbaar.push(d); } weken = Math.ceil((nr(zichtbaar[2]) - nr(van) + 1) / 7); }
    }
    const r = rooster(van, weken, o);
    const dagIdx = zichtbaar ? zichtbaar.map(d => r.dagen.findIndex(x => x.datum === d)) : null;
    let rijen = r.rijen; if (st.persoon) rijen = rijen.filter(x => x.slug === st.persoon);
    const m = { zoom, today, anker, van, weken, dagen: r.dagen.map(d => Object.assign({}, d, { nu: d.datum === today })), dagIdx, rijen, project: st.project, persoon: st.persoon };
    m.ongepland = ongepland({ team, vrij: o.vrij, verlof: o.verlof, project: st.project || '' });
    if (st.persoon) { m.ongepland.items = m.ongepland.items.filter(x => { const sl = Object.keys(D.taken() || {}).find(c => String(c).toLowerCase() === String(x.code).toLowerCase()); const t = sl ? (D.taken()[sl] || []).find(y => y && y.id === x.id) : null; return t && P.taakMensen(t).some(p => P.zelfdePersoon(p, st.persoon, team)); }); m.ongepland.min = m.ongepland.items.reduce((s, x) => s + x.min, 0); }
    // periodetitel
    const eerste = m.dagen[0].datum, laatste = m.dagen[m.dagen.length - 1].datum;
    if (zoom === 'week') { m.titel = 'Week ' + isoWeek(van); m.sub = dagMnd(van) + ' – ' + dagMnd(plusDagen(van, 4)); }
    else if (zoom === 'maand') { const a = Number(eerste.slice(5, 7)) - 1, b = Number(laatste.slice(5, 7)) - 1; m.titel = a === b ? MNDLANG[a].charAt(0).toUpperCase() + MNDLANG[a].slice(1) : MNDLANG[a].charAt(0).toUpperCase() + MNDLANG[a].slice(1) + ' – ' + MNDLANG[b]; m.sub = 'week ' + isoWeek(van) + '–' + isoWeek(plusDagen(van, 21)); }
    else if (zoom === 'kwartaal') { m.titel = '13 weken'; m.sub = 'week ' + isoWeek(van) + '–' + isoWeek(plusDagen(van, 84)) + ' · ' + dagMnd(van) + ' – ' + dagMnd(plusDagen(van, 88)); }
    else if (zoom === '3d') { const z = zichtbaar; m.titel = DAGKORT[wd(nr(z[0]))] + ' ' + dagMnd(z[0]) + ' – ' + DAGKORT[wd(nr(z[2]))] + ' ' + dagMnd(z[2]); m.sub = 'week ' + isoWeek(z[0]) + ' · 07:00–17:00'; }
    else { const z = zichtbaar[0]; m.titel = DAGLANG[wd(nr(z))].charAt(0).toUpperCase() + DAGLANG[wd(nr(z))].slice(1) + ' ' + dagMnd(z); m.sub = 'week ' + isoWeek(z) + ' · 07:00–17:00'; }
    return m;
  };
  // Eén cel in dezelfde teksten als de oude Capaciteit-weergave (MTCapaciteit.celTekst): gepland (in dagdelen) tegenover beschikbaar, en vrij of over.
  N.celSom = function (c) {
    if (c.verlof) return { staat: 'vrij', sum: 'verlof', over: '' };
    if (!c.werkdag) return { staat: 'vrij', sum: 'vrije dag', over: '' };
    if (c.werktNiet && !c.gepland_min) return { staat: 'vrij', sum: 'werkt niet', over: '' };   // alleen met ingevulde werktijden
    if (c.werktNiet) return { staat: 'over', sum: uren(c.gepland_min) + ' / 0u', over: '+' + uren(c.gepland_min) };   // gepland op een dag dat deze persoon niet werkt
    if (c.cap_min <= 0) return { staat: '', sum: c.gepland_min ? uren(c.gepland_min) : '—', over: '' };
    const gedeeld = c.dagdelen * (c.cap_min / 2);
    return { staat: c.over_min > 0 ? 'over' : (c.gepland_min / c.cap_min >= 0.9 ? 'vol' : ''), sum: uren(gedeeld) + ' / ' + uren(c.cap_min), over: c.over_min > 0 ? '+' + uren(c.over_min) : '' };
  };
  N.weekTekst = function (rij, wi) { const w = rij.weken[wi || 0]; if (!w) return ''; return w.over_min > 0 ? '+' + uren(w.over_min) + ' over' : (w.cap_min > 0 && w.vrij_min === 0 ? 'vol · ' + uren(w.gepland_min) : uren(w.vrij_min) + ' vrij'); };
  // Uren-zoom: de items van één persoon op één dag als blokken van 07:00 tot 17:00 in banen. Items zonder starttijd komen achter elkaar vanaf 08:00 (of na het laatste blok met tijd).
  N.urenBlokken = function (items) {
    const lijst = (items || []).map(it => { const s = tijdMin(it.start), min = Math.max(15, Math.round(it.min || 0)); return { it, s, min }; });
    const metTijd = lijst.filter(x => x.s !== null), zonder = lijst.filter(x => x.s === null);
    let cursor = Math.max(480, metTijd.reduce((m, x) => Math.max(m, x.s + x.min), 0));
    if (!metTijd.length) cursor = 480;
    zonder.forEach(x => { x.s = cursor; cursor += x.min; x.bij = true; });
    const uit = lijst.map(x => ({ it: x.it, start: Math.max(U0, x.s), eind: Math.min(U1, Math.max(Math.max(U0, x.s) + 15, x.s + x.min)), bij: !!x.bij, lane: 0 })).filter(x => x.start < U1);
    uit.sort((a, b) => a.start - b.start || a.eind - b.eind);
    const eindeLane = [];
    uit.forEach(b => { let l = eindeLane.findIndex(e => e <= b.start); if (l < 0) { l = eindeLane.length; eindeLane.push(0); } eindeLane[l] = b.eind; b.lane = l; });
    return { blokken: uit, banen: Math.max(1, eindeLane.length), dubbel: eindeLane.length > 1 && uit.some((b, i) => uit.some((c, j) => j !== i && b.lane !== c.lane && b.start < c.eind && c.start < b.eind)) };
  };

  // ── tekenen ──
  function el(tag, props, ...kids) {
    const e = D.doc.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'klass') e.className = v; else if (k === 'tekst') e.textContent = v; else if (k === 'klik') e.addEventListener('click', v); else if (k === 'wijzig') e.addEventListener('change', v); else e.setAttribute(k, v === true ? '' : v);
    });
    kids.flat(2).forEach(x => { if (x === null || x === undefined || x === false) return; e.appendChild(typeof x === 'string' ? D.doc.createTextNode(x) : x); });
    return e;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function icoon(d) { const s = D.doc.createElementNS(NS, 'svg'), p = D.doc.createElementNS(NS, 'path'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'cn-ic'); p.setAttribute('d', d); s.appendChild(p); return s; }
  const ini = n => String(n || '').slice(0, 2).toUpperCase();
  const projInfo = code => { try { return (D.project && D.project(code)) || null; } catch (e) { return null; } };
  const projNaam = code => { const p = projInfo(code); return p ? (p.naam || '') : ''; };
  const projNr = code => { try { return (D.nummer && D.nummer(code)) || String(code || ''); } catch (e) { return String(code || ''); } };
  const open = code => { if (code) D.openProject(code); };
  // Klikken op een taak opent het taakpaneel (mt-taakpaneel.js); zonder taak (een los planblok) of zonder paneel: het project. Een klik telt alleen als de muis minder dan 4 px bewoog
  // (slepen en uittrekken blijven precies zoals ze waren: de browser stuurt na een echte sleep geen klik, en een greep of knop op de balk opent niets).
  const openItem = (it, bron) => { if (D.openTaak && it && it.soort === 'taak' && it.id != null && it.code) D.openTaak(it.code, it.id, bron); else open(it && it.code); };
  function klikOpen(node, it) {
    let p0 = null;
    node.addEventListener('pointerdown', ev => { p0 = [ev.clientX, ev.clientY]; });
    node.addEventListener('click', ev => {
      if (ev.target && ev.target.closest && ev.target.closest('.cn-greep,button')) return;
      if (p0 && ev.detail && Math.hypot(ev.clientX - p0[0], ev.clientY - p0[1]) >= 4) return;
      openItem(it, node);
    });
  }

  // Een open voorstel: een planblok met status voorstel (ook als het aan een taak hangt: dan heeft het item een blokId) of een taak met een voorstel-markering.
  N.isVoorstel = function (it) { if (!it) return false; if (it.planvoorstel || it.voorstel) return true; if (it.blokId == null) return false; return (D.blokken() || []).some(b => b && String(b.id) === String(it.blokId) && b.status === 'voorstel' && !b._vervallen); };

  // ── slepen en verplaatsen (brok 8) ──
  // Alleen als de cockpit zegt dat het mag (D.magSlepen: recht om te plannen, rol geladen; niet voor "lezen", de werkplaats of de tv).
  // Sleepbaar zijn planblokken (ook als ze aan een taak hangen) en de taken in Ongepland; een open voorstel en een taak met alleen een datum niet.
  const blokIdVan = it => it.blokId != null ? String(it.blokId) : (it.soort === 'blok' && /^blok:/.test(String(it.id)) ? String(it.id).slice(5) : null);
  N.mag = () => !!(D.magSlepen && D.magSlepen());
  N.sleepbaar = it => N.mag() && !!blokIdVan(it) && !N.isVoorstel(it);
  // T4: een taakbalk (een taak met datums zonder planblok) sleep je naar een andere persoon: alleen de persoon verandert, de datums blijven (verschuiven en uittrekken komt later)
  N.taakSleepbaar = it => N.mag() && (!D.magTaken || !!D.magTaken()) && !!it && it.soort === 'taak' && it.blokId == null && !N.isVoorstel(it) && it.status !== 'klaar';   // T5: ook met het recht om taken te wijzigen; zonder dat geen balk en geen grepen
  const geenZone = () => { D.doc.querySelectorAll('.cn-slot.drop,.cn-uren-raster.drop').forEach(z => z.classList.remove('drop')); D.doc.querySelectorAll('.cn-dropmarker').forEach(z => { z.hidden = true; }); };
  function sleepBron(bron, node, tekst) {
    node.setAttribute('draggable', 'true');
    node.addEventListener('dragstart', ev => { S.sleep = bron; node.classList.add('sleept'); try { ev.dataTransfer.setData('text/plain', tekst || ''); ev.dataTransfer.effectAllowed = 'move'; } catch (e) {} });
    node.addEventListener('dragend', () => { S.sleep = null; node.classList.remove('sleept'); geenZone(); });
  }
  // Eén plek waar je kunt loslaten; `geef(ev)` geeft de doelspec (persoon, datum, dagdeel of start) of null
  function doelZone(node, geef, markeer) {
    if (!N.mag()) return;
    node.addEventListener('dragover', ev => {
      if (!S.sleep) return;
      const d = geef(ev); if (!d) return;
      const reden = D.controleer ? D.controleer(Object.assign({}, S.sleep, d)) : '';
      try { ev.dataTransfer.dropEffect = reden ? 'none' : 'move'; } catch (e) {}
      if (reden) { node.classList.remove('drop'); if (markeer) markeer(null); return; }
      ev.preventDefault(); node.classList.add('drop'); if (markeer) markeer(d);
    });
    node.addEventListener('dragleave', ev => { if (!node.contains(ev.relatedTarget)) { node.classList.remove('drop'); if (markeer) markeer(null); } });
    node.addEventListener('drop', ev => { ev.preventDefault(); node.classList.remove('drop'); if (markeer) markeer(null); const d = geef(ev), b = S.sleep; S.sleep = null; geenZone(); if (d && b) N.drop(Object.assign({}, b, d)); });
  }
  // Loslaten op een tijdbalk: de dag volgt uit de plek op de balk, de tijd uit de plek binnen de dag (stappen van 15 minuten)
  function urenDoel(raster, dagen, ev) {
    const r = raster.getBoundingClientRect(); if (!r.width) return null;
    const x = Math.max(0, Math.min(0.9999, (ev.clientX - r.left) / r.width)) * dagen.length, k = Math.floor(x);
    const min = Math.max(U0, Math.min(U1 - 15, U0 + Math.round((x - k) * (U1 - U0) / 15) * 15));
    return { datum: dagen[k], start: hhmm(min), minuut: min, kolom: k };
  }

  // Eén planblok (getint per project; een open voorstel is gestippeld met een chip; een wachtende taak toont dat)
  function blok(it, uur, stijl) {
    const voorstel = N.isVoorstel(it), wacht = !!(it.wacht && it.status !== 'klaar'), sleep = N.sleepbaar(it), bid = blokIdVan(it), taakSleep = !sleep && N.taakSleepbaar(it), taakBron = { soort: 'taakbalk', taak: { code: it.code, id: it.id, naam: it.naam, voorstel: false }, van: it.persoon || '', vanDatum: it.datum || '' }, mijlpaal = !!(it.taak && it.taak.soort === 'mijlpaal');
    const sub = el('span', { klass: 'cn-blok-sub' }, el('span', { klass: 'cn-code', tekst: projNr(it.code) }), ' ' + projNaam(it.code), it.min && !uur ? ' · ' + uren(it.min) : '');
    const b = el('div', { role: 'button', tabindex: '0', klass: 'cn-blok' + (voorstel ? ' voorstel' : '') + (wacht ? ' wacht' : '') + (sleep || taakSleep ? ' sleepbaar' : ''), 'data-taak': taakSleep ? String(it.id) : null, 'data-code': taakSleep ? String(it.code) : null, 'data-pf-taak': it.soort === 'taak' ? String(it.id) : null, 'data-pf-code': it.soort === 'taak' ? String(it.code) : null, 'aria-keyshortcuts': taakSleep ? 'ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight Alt+Shift+ArrowLeft Alt+Shift+ArrowRight' : null, style: '--block-color:' + P.projectKleur(it.code), title: [it.naam, projNr(it.code) + ' ' + projNaam(it.code), it.min ? uren(it.min) : '', voorstel ? 'voorstel' : '', wacht ? ('wacht' + (it.wachtTekst ? ': ' + it.wachtTekst : '')) : '', it.waarschuwing || '', it.nietEenduidig ? 'niet eenduidig aan een taak gekoppeld (hetzelfde taak-id staat in meer dan één project)' : ''].filter(Boolean).join(' · ') },
      el('span', { klass: 'cn-blok-kop' }, el('span', { klass: 'cn-blok-titel', tekst: it.naam }), voorstel ? el('span', { klass: 'cn-chipje', tekst: 'voorstel' }) : null, wacht && !voorstel ? el('span', { klass: 'cn-chipje wacht', tekst: 'wacht' }) : null, D.taakBezig && it.soort === 'taak' && D.taakBezig(it.code, it.id) ? el('span', { klass: 'cn-chipje wacht', tekst: 'opslaan hangt', title: 'Opslaan hangt: wacht even of herlaad de pagina om opnieuw te proberen' }) : null, it.waarschuwing ? el('span', { klass: 'cn-chipje wacht', tekst: 'let op', title: it.waarschuwing }) : null), uur ? el('span', { klass: 'cn-blok-sub' }, el('span', { klass: 'cn-tijd', tekst: uur }), ' · ', el('span', { klass: 'cn-code', tekst: projNr(it.code) }), ' ' + projNaam(it.code)) : sub);
    if (S.toon && it.soort === 'taak' && String(it.id) === S.toon.id && String(it.code).toLowerCase() === S.toon.code && D.nu() < S.toon.tot) b.classList.add('tp-gemarkeerd');   // "Toon in tijdlijn" vanuit het taakpaneel
    klikOpen(b, it);
    b.addEventListener('keydown', ev => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === b) { ev.preventDefault(); openItem(it, b); } });
    if (sleep) sleepBron({ soort: 'verplaats', blokId: bid }, b, it.naam); else if (taakSleep) sleepBron(taakBron, b, it.naam);
    if (taakSleep) {
      // T5: de randen van een taakbalk (week): links de start, rechts het eind; de balk zelf horizontaal slepen schuift beide randen mee. Een mijlpaal kan alleen schuiven.
      if (S.zoom === 'week' && !mijlpaal) [['start', it.eerste, 'l', 'start'], ['eind', it.laatste, 'r', 'eind']].forEach(([kant, tonen, kl, woord]) => {
        if (!tonen) return;
        const g = el('span', { klass: 'cn-greep ' + kl, 'aria-hidden': 'true', title: 'Sleep om de ' + woord + ' te verplaatsen' });
        sleepBron({ soort: 'taakrand', kant, taak: taakBron.taak, van: it.persoon || '' }, g, it.naam); g.addEventListener('dragstart', ev => ev.stopPropagation());   // de greep sleept alleen de rand, niet de hele balk
        b.appendChild(g);
      });
      // het toetsenbord: pijltje = de balk een bedrijfswerkdag schuiven, Shift+pijltje = het eind, Alt+Shift+pijltje = de start
      b.addEventListener('keydown', ev => {
        const pijl = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0; if (!pijl || ev.target !== b || ev.ctrlKey || ev.metaKey || N.mag() !== true) return;
        if (ev.altKey && !ev.shiftKey) return;
        ev.preventDefault();
        let spec;
        if (ev.shiftKey) { if (mijlpaal) { N.toast('Een mijlpaal kun je alleen verschuiven.'); return; } spec = { soort: 'taakrand', kant: ev.altKey ? 'start' : 'eind', taak: taakBron.taak, van: taakBron.van, delta: pijl }; }
        else spec = { soort: 'taakbalk', taak: taakBron.taak, van: taakBron.van, persoon: taakBron.van, delta: pijl };
        S.focusTaak = String(it.id); S.focusCode = String(it.code); N.drop(spec);
      });
    }
    const w = el('div', { klass: 'cn-bw', style: stijl || '' }, b);
    if (taakSleep && D.dialoog && (S.zoom === 'week' || S.zoom === '3d' || S.zoom === 'dag')) w.appendChild(el('button', { type: 'button', klass: 'cn-vpl', 'aria-label': 'Zet ' + it.naam + ' bij een andere persoon', title: 'Naar een andere persoon…', klik: ev => { ev.stopPropagation(); N.menu(Object.assign({ naam: it.naam }, taakBron)); } }, icoon('M7 7h11l-3-3M17 17H6l3 3')));
    if (taakSleep && D.dialoog && (S.zoom === 'week' || S.zoom === '3d' || S.zoom === 'dag')) w.appendChild(el('button', { type: 'button', klass: 'cn-vpl dat', 'aria-label': 'Wijzig de datums van ' + it.naam, title: 'Datums wijzigen…', klik: async ev => {
      ev.stopPropagation(); if (S.bezig || S.menuBezig) return;
      S.menuBezig = true; let d; try { d = await N.datumsDialoog(it); } finally { S.menuBezig = false; }
      if (d) { S.focusTaak = String(it.id); S.focusCode = String(it.code); N.drop({ soort: 'taakdatums', taak: taakBron.taak, startDatum: d.start, eindDatum: d.eind }); }
    } }, icoon('M7 4v3M17 4v3M5 9h14M6 6h12a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z')));
    if (N.omzetbaar(it) && (S.zoom === 'week' || S.zoom === '3d' || S.zoom === 'dag')) w.appendChild(el('button', { type: 'button', klass: 'cn-vpl omz', 'aria-label': 'Zet ' + it.naam + ' om naar een taakbalk', title: 'Omzetten naar taakbalk…', klik: ev => { ev.stopPropagation(); N.omzetten(it); } }, icoon('M4 8h16M4 16h16M13 4l4 4-4 4M11 12l-4 4 4 4')));
    if (sleep && D.dialoog && (S.zoom === 'week' || S.zoom === '3d' || S.zoom === 'dag')) w.appendChild(el('button', { type: 'button', klass: 'cn-vpl', 'aria-label': 'Verplaats ' + it.naam + ' naar…', title: 'Verplaats naar…', klik: ev => { ev.stopPropagation(); N.menu({ soort: 'verplaats', blokId: bid, naam: it.naam }); } }, icoon('M7 7h11l-3-3M17 17H6l3 3')));
    return w;
  }  const persoonKop = (r, tekst, over, balk) => el('div', { klass: 'cn-persoon' },
    el('div', { klass: 'cn-pkop' }, el('span', { klass: 'cn-avatar', tekst: ini(r.naam) }), el('span', { klass: 'cn-pnaam' }, el('b', { tekst: r.naam }), r.heeftCap ? null : el('span', { klass: 'cn-sub', tekst: 'zonder eigenaar of niet in het team' }))),
    tekst ? el('span', { klass: 'cn-vrij' + (over ? ' over' : ''), tekst }) : null, balk || null);
  const laadBalk = (gepl, cap, over) => el('span', { klass: 'cn-laad', role: 'img', 'aria-label': 'gepland ' + uren(gepl) + ' van ' + uren(cap) }, el('span', { style: 'width:' + (cap > 0 ? Math.min(100, Math.round(gepl / cap * 100)) : 0) + '%', klass: over ? 'over' : '' }));

  function tekenWeek(m, rijen, wrap) {
    const dagen = m.dagen, kol = dagen.length;
    const raster = el('div', { klass: 'cn-week', style: 'grid-template-columns:190px repeat(' + kol + ',minmax(128px,1fr));min-width:' + (190 + kol * 128) + 'px' });
    raster.appendChild(el('div', { klass: 'cn-hoek' }, el('span', { tekst: 'Team · ' + rijen.filter(r => r.heeftCap).length }), el('span', { tekst: 'ochtend / middag' })));
    dagen.forEach(d => raster.appendChild(el('div', { klass: 'cn-dagkop' + (d.nu ? ' nu' : '') }, el('b', { tekst: DAGKORT[wd(nr(d.datum))] }), ' ', el('span', { klass: 'cn-num', tekst: dagMnd(d.datum) }))));
    rijen.forEach(r => {
      const w = r.weken[0] || { gepland_min: 0, cap_min: 0, over_min: 0 };
      raster.appendChild(persoonKop(r, r.heeftCap ? N.weekTekst(r, 0) : '', w.over_min > 0, r.heeftCap ? laadBalk(w.gepland_min, w.cap_min, w.over_min > 0) : null));
      r.dagen.forEach((c, i) => {
        const som = N.celSom(c), d = dagen[i];
        const cel = el('div', { klass: 'cn-cel' + (d.nu ? ' nu' : '') + (som.staat === 'vrij' ? ' vrij' : '') + (som.staat === 'over' ? ' over' : '') + (som.staat === 'vol' ? ' vol' : '') });
        cel.appendChild(el('div', { klass: 'cn-som' + (som.staat === 'over' ? ' over' : '') }, el('span', { tekst: som.sum }), som.over ? el('span', { tekst: som.over }) : null));
        if (c.verlof) cel.appendChild(el('div', { klass: 'cn-vrijtekst', tekst: 'Vrij (verlof)' }));
        else if (!c.werkdag) cel.appendChild(el('div', { klass: 'cn-vrijtekst', tekst: 'Vrije dag' }));
        if ((c.verlof || !c.werkdag) && r.slug) doelZone(cel, () => ({ persoon: r.slug, datum: c.datum, dagdeel: 0 }));   // loslaten mag, maar eerst een bevestiging (V.waarschuwing)
        else (r.slots[i] || [[], []]).forEach((lijst, dl) => { const slot = el('div', { klass: 'cn-slot' }, lijst.map(it => blok(it)), lijst.length ? null : el('div', { klass: 'cn-leeg', tekst: dl ? 'middag' : 'ochtend' })); if (r.slug) doelZone(slot, () => ({ persoon: r.slug, datum: c.datum, dagdeel: dl })); cel.appendChild(slot); });
        if (c.verlof || !c.werkdag) (c.items || []).forEach(it => cel.appendChild(blok(it)));   // iets op een vrije dag niet laten verdwijnen
        raster.appendChild(cel);
      });
    });
    wrap.appendChild(raster);
  }

  function tekenUren(m, rijen, wrap) {
    const idx = m.dagIdx, kolTot = idx.length * KOL, nu = D.nu();
    const hoofd = el('div', { klass: 'cn-uren-kop', style: 'grid-template-columns:180px minmax(0,1fr)' }, el('div', { klass: 'cn-hoek' }, el('span', { tekst: 'Team · uren' })),
      el('div', { klass: 'cn-uren-schaal', style: 'grid-template-columns:repeat(' + kolTot + ',minmax(0,1fr))' },
        idx.map(i => el('div', { klass: 'cn-dagkop2' + (m.dagen[i].nu ? ' nu' : ''), style: 'grid-column:span ' + KOL }, el('b', { tekst: DAGKORT[wd(nr(m.dagen[i].datum))] }), ' ', el('span', { klass: 'cn-num', tekst: dagMnd(m.dagen[i].datum) }))),
        idx.map(i => { const t = []; for (let h = 7; h < 17; h++) t.push(el('div', { klass: 'cn-tik' + (m.dagen[i].nu ? ' nu' : '') + (h === 7 ? ' eerste' : ''), style: 'grid-column:span 2', title: String(h).padStart(2, '0') + ':00', tekst: String(h).padStart(2, '0') + (idx.length === 1 ? ':00' : '') })); return t; })));
    const bin = el('div', { klass: 'cn-uren' });   // de uurkolommen schalen mee met de breedte (fr-eenheden): 07:00-17:00 past altijd, zonder horizontaal scrollen
    bin.appendChild(hoofd);
    rijen.forEach(r => {
      const per = idx.map(i => ({ i, ...N.urenBlokken((r.dagen[i] || {}).items) }));
      const banen = Math.max(1, ...per.map(p => p.banen)), dubbel = per.some(p => p.dubbel);
      const gepl = idx.reduce((s, i) => s + ((r.dagen[i] || {}).gepland_min || 0), 0);
      const raster = el('div', { klass: 'cn-uren-raster', style: 'grid-template-columns:repeat(' + kolTot + ',minmax(0,1fr));grid-template-rows:repeat(' + banen + ',48px)' });
      per.forEach((p, k) => {
        const c = r.dagen[p.i];
        if (c.verlof || !c.werkdag) raster.appendChild(el('div', { klass: 'cn-uren-vrij', style: 'grid-column:' + (k * KOL + 1) + ' / ' + (k * KOL + KOL + 1) + ';grid-row:1 / span ' + banen, tekst: c.verlof ? 'Vrij (verlof)' : 'Vrije dag' }));
        p.blokken.forEach(b => {
          const a = k * KOL + Math.floor((b.start - U0) / 30) + 1, e = k * KOL + Math.max(Math.floor((b.start - U0) / 30) + 1, Math.ceil((b.eind - U0) / 30)) + 1;
          raster.appendChild(blok(b.it, hhmm(b.start) + '–' + hhmm(b.eind) + (b.bij ? ' ~' : ''), 'grid-column:' + a + ' / ' + e + ';grid-row:' + (b.lane + 1)));
        });
      });
      if (r.slug) {   // loslaan op een tijd: een lijntje toont waar het blok begint
        const marker = el('span', { klass: 'cn-dropmarker', hidden: true, 'aria-hidden': 'true' }, el('span', { klass: 'cn-dropmarker-tijd' })); raster.appendChild(marker);
        const dagenDatum = per.map(p => m.dagen[p.i].datum);
        doelZone(raster, ev => { const d = urenDoel(raster, dagenDatum, ev); return d ? { persoon: r.slug, datum: d.datum, start: d.start, _min: d.minuut, _k: d.kolom } : null; }, d => { if (!d) { marker.hidden = true; return; } marker.hidden = false; marker.style.left = ((d._k * KOL + (d._min - U0) / 30) / kolTot * 100).toFixed(2) + '%'; marker.firstChild.textContent = d.start; });
      }
      // nu-lijn (alleen als vandaag in beeld is en de tijd tussen 07:00 en 17:00 valt)
      const t = new Date(nu), tm = t.getHours() * 60 + t.getMinutes(), k = idx.findIndex(i => m.dagen[i].datum === m.today);
      if (k >= 0 && tm >= U0 && tm <= U1) raster.appendChild(el('span', { klass: 'cn-nu', 'aria-hidden': 'true', style: 'left:' + ((k * KOL + (tm - U0) / 30) / kolTot * 100).toFixed(2) + '%' }));
      bin.appendChild(el('div', { klass: 'cn-uren-rij', style: 'grid-template-columns:180px minmax(0,1fr)' },
        el('div', { klass: 'cn-persoon enkel' }, el('div', { klass: 'cn-pkop' }, el('span', { klass: 'cn-avatar', tekst: ini(r.naam) }), el('span', { klass: 'cn-pnaam' }, el('b', { tekst: r.naam }), el('span', { klass: 'cn-vrij' + (dubbel ? ' over' : ''), tekst: dubbel ? 'dubbel geboekt' : uren(gepl) + ' gepland' })))), raster));
    });
    wrap.appendChild(bin);
  }

  function tekenMaand(m, rijen, wrap) {
    const dagen = m.dagen, kol = dagen.length;
    const bin = el('div', { klass: 'cn-maand', style: 'min-width:960px' });
    const kopRij = el('div', { klass: 'cn-maand-kop', style: 'grid-template-columns:200px repeat(' + kol + ',minmax(0,1fr))' }, el('div', { klass: 'cn-hoek', style: 'grid-row:span 2' }, el('span', { tekst: 'Belasting per dag' })));
    for (let w = 0; w < m.weken; w++) kopRij.appendChild(el('div', { klass: 'cn-weekkop', style: 'grid-column:span 5', tekst: 'week ' + isoWeek(plusDagen(m.van, w * 7)) }));
    dagen.forEach((d, i) => kopRij.appendChild(el('div', { klass: 'cn-dagnum' + (d.nu ? ' nu' : '') + (i % 5 === 0 ? ' eerste' : ''), tekst: String(Number(d.datum.slice(8))) })));
    bin.appendChild(kopRij);
    rijen.forEach(r => {
      const over = r.dagen.filter(c => c.over_min > 0).length, cap = r.dagen.reduce((s, c) => s + c.cap_min, 0), gepl = r.dagen.reduce((s, c) => s + c.gepland_min, 0);
      const rij = el('div', { klass: 'cn-maand-rij', style: 'grid-template-columns:200px repeat(' + kol + ',minmax(0,1fr))' },
        el('div', { klass: 'cn-persoon enkel' }, el('div', { klass: 'cn-pkop' }, el('span', { klass: 'cn-avatar', tekst: ini(r.naam) }), el('span', { klass: 'cn-pnaam' }, el('b', { tekst: r.naam }), el('span', { klass: 'cn-vrij' + (over ? ' over' : ''), tekst: over ? over + (over === 1 ? ' dag over' : ' dagen over') : (r.heeftCap ? uren(Math.max(0, cap - gepl)) + ' vrij' : uren(gepl) + ' gepland'), title: '' })))));
      r.dagen.forEach((c, i) => {
        const nuDag = dagen[i].nu, pct = c.cap_min > 0 ? c.gepland_min / c.cap_min * 100 : (c.gepland_min ? 100 : 0);
        const vrij = c.verlof || !c.werkdag;
        rij.appendChild(el('div', { klass: 'cn-mdag' + (nuDag ? ' nu' : '') + (i % 5 === 0 ? ' eerste' : '') + (vrij ? ' vrij' : ''), title: P.datumKort(c.datum) + ': ' + (c.verlof ? 'verlof' : !c.werkdag ? 'vrije dag' : uren(c.gepland_min) + ' van ' + uren(c.cap_min)) },
          vrij ? null : el('span', { klass: 'cn-mbalk' + (c.over_min > 0 ? ' over' : c.gepland_min > 0 && pct >= 100 ? ' vol' : ''), style: 'height:' + Math.max(c.gepland_min ? 8 : 0, Math.min(100, Math.round(pct))) + '%' })));
      });
      bin.appendChild(rij);
    });
    wrap.appendChild(bin);
  }

  function tekenKwartaal(m, rijen, wrap) {
    const W = m.weken, bin = el('div', { klass: 'cn-kwartaal', style: 'min-width:960px' });
    const kop = el('div', { klass: 'cn-kw-kop', style: 'grid-template-columns:200px repeat(' + W + ',minmax(0,1fr))' }, el('div', { klass: 'cn-hoek' }, el('span', { tekst: 'Projecten per persoon' })));
    for (let w = 0; w < W; w++) { const ma = plusDagen(m.van, w * 7); kop.appendChild(el('div', { klass: 'cn-wk' + (ma <= m.today && m.today <= plusDagen(ma, 6) ? ' nu' : ''), title: dagMnd(ma), tekst: 'wk ' + isoWeek(ma) })); }
    bin.appendChild(kop);
    rijen.forEach(r => {
      const perWeek = []; for (let w = 0; w < W; w++) perWeek.push(r.dagen.slice(w * 5, w * 5 + 5));
      const spans = new Map();   // projectcode -> [eerste week, laatste week]
      perWeek.forEach((dg, w) => dg.forEach(c => (c.items || []).forEach(it => { if (!it.code) return; const s = spans.get(it.code) || [w, w]; s[0] = Math.min(s[0], w); s[1] = Math.max(s[1], w); spans.set(it.code, s); })));
      const balken = [...spans.entries()].sort((a, b) => a[1][0] - b[1][0] || (a[0] < b[0] ? -1 : 1));
      const raster = el('div', { klass: 'cn-kw-raster', style: 'grid-template-columns:repeat(' + W + ',minmax(0,1fr))' });
      for (let w = 0; w < W; w++) { const wk = r.weken[w] || { gepland_min: 0, cap_min: 0, over_min: 0 }; raster.appendChild(el('div', { klass: 'cn-kw-laad', style: 'grid-row:1;grid-column:' + (w + 1), title: uren(wk.gepland_min) + ' van ' + uren(wk.cap_min) }, el('span', { klass: 'cn-kw-tekst' + (wk.over_min > 0 ? ' over' : ''), tekst: wk.gepland_min ? uren(wk.gepland_min) : '' }), el('span', { klass: 'cn-laad' }, el('span', { klass: wk.over_min > 0 ? 'over' : '', style: 'width:' + (wk.cap_min > 0 ? Math.min(100, Math.round(wk.gepland_min / wk.cap_min * 100)) : 0) + '%' })))); }
      balken.forEach(([code, [a, b]], i) => raster.appendChild(el('button', { type: 'button', klass: 'cn-blok cn-balk', style: '--block-color:' + P.projectKleur(code) + ';grid-row:' + (i + 2) + ';grid-column:' + (a + 1) + ' / ' + (b + 2), title: projNr(code) + ' ' + projNaam(code) + ' · week ' + isoWeek(plusDagen(m.van, a * 7)) + (a === b ? '' : ' t/m ' + isoWeek(plusDagen(m.van, b * 7))), klik: () => open(code) }, el('span', { klass: 'cn-blok-titel' }, el('span', { klass: 'cn-code', tekst: projNr(code) }), a === b ? '' : ' ' + projNaam(code)))));
      bin.appendChild(el('div', { klass: 'cn-kw-rij', style: 'grid-template-columns:200px minmax(0,1fr)' }, el('div', { klass: 'cn-persoon enkel' }, el('div', { klass: 'cn-pkop' }, el('span', { klass: 'cn-avatar', tekst: ini(r.naam) }), el('span', { klass: 'cn-pnaam' }, el('b', { tekst: r.naam }), el('span', { klass: 'cn-sub', tekst: balken.length + (balken.length === 1 ? ' project' : ' projecten') })))), raster));
    });
    wrap.appendChild(bin);
  }

  N.ongKlap = function (dicht) { S.ongDicht = !!dicht; try { D.storage && (dicht ? D.storage.setItem(LS_ONG, 'dicht') : D.storage.removeItem(LS_ONG)); } catch (e) {} N.teken(); };
  function zijkolom(m) {
    const up = m.ongepland;
    if (S.ongDicht) { const b = el('button', { type: 'button', klass: 'cn-ong-dicht', 'aria-expanded': 'false', 'aria-label': 'Ongepland tonen: ' + up.items.length + ' taken, ' + uren(up.min), title: 'Ongepland tonen', klik: () => N.ongKlap(false) }, icoon('M15 6l-6 6l6 6'), el('span', { klass: 'cn-num', tekst: String(up.items.length) }), el('span', { klass: 'cn-ong-tekst', tekst: 'Ongepland' })); return el('aside', { klass: 'cn-ongepland dicht', 'aria-label': 'Ongepland (ingeklapt)' }, b); }
    return el('aside', { klass: 'cn-ongepland', 'aria-labelledby': 'cn-h-ongepland' },
      el('div', { klass: 'cn-ong-kop' }, el('span', { id: 'cn-h-ongepland', tekst: 'Ongepland' }), el('span', { klass: 'cn-num cn-sub', tekst: up.items.length + ' · ' + uren(up.min) }), el('button', { type: 'button', klass: 'cn-knop icoon cn-ong-klap', 'aria-expanded': 'true', 'aria-label': 'Ongepland inklappen', title: 'Inklappen', klik: () => N.ongKlap(true) }, icoon('M9 6l6 6l-6 6'))),
      el('div', { klass: 'cn-ong-lijst' }, up.items.length ? up.items.map(u => ongItem(u)) : el('div', { klass: 'cn-sub cn-ong-leeg', tekst: 'Alles heeft een plek.' })));
  }
  // Een taak in Ongepland: sleepbaar naar een dagdeel of een tijd (er ontstaat een planblok), of via "Inplannen…" met het toetsenbord
  function ongItem(u) {
    const sleep = N.mag() && (!D.magTaken || !!D.magTaken()) && !u.voorstel, taak = { code: u.code, id: u.id, naam: u.naam, min: u.min, voorstel: u.voorstel };   // een taak uit Ongepland slepen past de taak aan: dat vraagt ook het recht om taken te wijzigen
    const gemarkeerd = !!S.markeer && String(S.markeer.id) === String(u.id) && (!S.markeer.code || String(S.markeer.code).toLowerCase() === String(u.code).toLowerCase()) && D.nu() < S.markeer.tot;   // net vanuit Vandaag gekozen om in te plannen
    const knop = el('div', { role: 'button', tabindex: '0', klass: 'cn-blok cn-ong' + (u.voorstel ? ' voorstel' : '') + (sleep ? ' sleepbaar' : '') + (gemarkeerd ? ' gemarkeerd' : ''), 'data-pf-taak': String(u.id), 'data-pf-code': String(u.code), style: '--block-color:' + P.projectKleur(u.code), title: u.tekst || u.naam },
      el('span', { klass: 'cn-ong-rij' }, el('span', { klass: 'cn-blok-titel', tekst: u.naam }), u.min ? el('span', { klass: 'cn-num cn-sub', tekst: uren(u.min) }) : null),
      el('span', { klass: 'cn-blok-sub' }, el('span', { klass: 'cn-code', tekst: projNr(u.code) }), ' ' + projNaam(u.code), u.voorstel ? ' · voorstel werkplaats' : ''));
    const item = { soort: 'taak', id: u.id, code: u.code };
    klikOpen(knop, item);
    knop.addEventListener('keydown', ev => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === knop) { ev.preventDefault(); openItem(item, knop); } });
    if (sleep) sleepBron({ soort: 'nieuw', taak }, knop, u.naam);
    const w = el('div', { klass: 'cn-bw' }, knop);
    if (sleep && D.dialoog && (S.zoom === 'week' || S.zoom === '3d' || S.zoom === 'dag')) w.appendChild(el('button', { type: 'button', klass: 'cn-vpl', 'aria-label': 'Plan ' + u.naam + ' in…', title: 'Inplannen…', klik: ev => { ev.stopPropagation(); N.menu({ soort: 'nieuw', taak, naam: u.naam }); } }, icoon('M7 7h11l-3-3M17 17H6l3 3')));
    return w;
  }

  // ── uitvoeren, ongedaan maken en het toetsenbord-alternatief ──
  const persNaam = slug => { const t = (D.team() || []).find(x => String(x.slug).toLowerCase() === String(slug).toLowerCase()); return t ? t.naam : slug; };
  N.toast = function (tekst, ongedaan, lang, label) {
    const oud = D.doc.getElementById('cn-toast'); if (oud && oud.parentNode) oud.parentNode.removeChild(oud);
    clearTimeout(N.toast._t);
    const t = el('div', { id: 'cn-toast', klass: 'cn-toast', role: 'status' }, el('span', { tekst: tekst }));
    if (ongedaan) t.appendChild(el('button', { type: 'button', klass: 'cn-toast-knop', tekst: label || 'Ongedaan maken', klik: async () => { if (t.parentNode) t.parentNode.removeChild(t); await ongedaan(); } }));
    t.appendChild(el('button', { type: 'button', klass: 'cn-toast-sluit', 'aria-label': 'Melding sluiten', tekst: '×', klik: () => { if (t.parentNode) t.parentNode.removeChild(t); } }));
    D.doc.body.appendChild(t);
    N.toast._t = setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, lang ? 20000 : ongedaan ? 12000 : 6000);   // lang: een melding die je niet mag missen (traag opslaan, tegelijk gewijzigd)
  };
  // spec = { soort:'verplaats', blokId } of { soort:'nieuw', taak } plus { persoon, datum, dagdeel | start }
  N.drop = async function (spec) {
    if (S.bezig) return { ok: false, bezet: true, reden: 'Er loopt nog een opslag in de planning; probeer het zo opnieuw.' };
    const schoon = {}; Object.keys(spec).forEach(k => { if (k[0] !== '_') schoon[k] = spec[k]; });
    S.bezig = true;   // de lock gaat er meteen op en komt altijd vrij (finally), ook bij een uitzondering of een time-out in de opslag
    try { return await N._drop(schoon); } finally { S.bezig = false; S.focusTaak = null; }
  };   // -> de uitkomst (voor het taakpaneel, dat de datums via deze zelfde route wijzigt); de meldingen en het ongedaan maken doet N._drop zelf
  // Een opslag die na 90 s nog hing: de echte actie loopt door en houdt het slot van die taak vast; zodra SharePoint antwoordt komt hier de uitkomst (opgeslagen, niet opgeslagen of tegelijk gewijzigd)
  N.naOnzeker = function (belofte) {
    Promise.resolve(belofte).then(u => { N.teken(); N.toast((u && u.tekst) || 'Ververs de planning om te zien of het opslaan gelukt is.', null, true); }, () => { N.toast('Ik kon niet vaststellen of het opslaan gelukt is. Ververs de planning.', null, true); });
  };
  N._drop = async function (schoon) {
    let r; const opt = { traag: () => N.toast('Opslaan duurt lang, even geduld…', null, true) };   // na 20 s een rustige melding; de actie blijft gelockt tot SharePoint antwoordt
    try {
      r = await D.verplaats(schoon, opt);
      // Verlof, een verplichte vrije dag of een dag waarop iemand volgens de werktijden niet werkt: eerst bevestigen (mtDialog). Annuleren = niets schrijven; het blok blijft waar het was.
      if (r && !r.ok && r.vraag) {
        const ja = D.dialoog && D.dialoog.confirm ? await D.dialoog.confirm({ title: 'Controleer de planning', message: r.vraag, okLabel: 'Toch inplannen', cancelLabel: 'Annuleren' }) : false;
        if (!ja) { S.bezig = false; N.teken(); return { ok: false, geannuleerd: true }; }
        r = await D.verplaats(Object.assign({}, schoon, { bevestigd: true }), opt);
      }
    } catch (e) { r = { ok: false, reden: 'Opslaan mislukt: ' + ((e && e.message) || e) }; }
    S.bezig = false;
    if (r && r.onzeker) { N.teken(); N.toast(r.reden, null, true); N.naOnzeker(r.onzeker); return r; }
    if (r && r.geannuleerd) { N.teken(); return r; }   // de vraag over de opvolgers is geannuleerd: niets gewijzigd
    if (!r || !r.ok) { N.toast((r && r.reden) || 'Dat lukt niet.'); return r || { ok: false, reden: 'Dat lukt niet.' }; }
    if (r.noop) return r;
    S.markeer = null;
    N.teken();
    if (r.tegelijk) { N.toast(r.tegelijk, null, true); return r; }   // iemand wijzigde tegelijk en won: de planning toont nu de samengevoegde stand; geen ongedaan maken
    const w = r.wijziging, wat = w.soort === 'taak' && !w.na.datum && w.voor && w.voor.start ? (w.naam || 'Taak') + ': datums gewist, de taak staat weer in Ongepland' : w.soort === 'taak' ? (w.naam || 'Taak') + ' → ' + persNaam(w.na.persoon) + (w.na.datum && w.voor && (w.voor.start !== w.na.datum || w.voor.eind !== w.na.eind) ? ', ' + P.datumKort(w.na.datum) + (w.na.eind && w.na.eind !== w.na.datum ? ' t/m ' + P.datumKort(w.na.eind) : '') : '') + (r.melding ? ' · ' + r.melding : '')
      : (w.naam || 'Planblok') + ' → ' + persNaam(w.na.persoon) + ', ' + P.datumKort(w.na.datum) + ' ' + w.na.start;
    if (!r.behouden) { N.toast('Iemand anders was net sneller met ' + (w.naam || 'dit blok') + ': jouw wijziging is niet bewaard.'); return r; }
    N.toast(wat + (r.opgeslagen ? '' : ' (alleen lokaal bewaard: SharePoint is niet bereikbaar)'), async () => {
      let h; try { h = await D.herstel(w, opt); } catch (e) { h = { ok: false, reden: 'Terugzetten mislukt: ' + ((e && e.message) || e) }; }
      N.teken();
      if (h && h.onzeker) { N.toast(h.reden, null, true); N.naOnzeker(h.onzeker); return; }
      N.toast(h && h.ok ? (h.tegelijk || 'Teruggezet') : ((h && h.reden) || 'Terugzetten lukt niet.'), null, !!(h && h.tegelijk));
      if (D.naHerstel) { try { D.naHerstel(); } catch (e) {} }
    });
    return r;
  };
  // T6: een oud tb:-planblok dat bij een taak hoort (het item heeft de taak en een blokId) kan een taakbalk worden. Alleen met het recht om te slepen en om taken te wijzigen; niet voor een open voorstel.
  N.omzetbaar = it => !!D.omzetten && !!D.dialoog && N.mag() === true && (!D.magTaken || !!D.magTaken()) && !!it && it.soort === 'taak' && it.blokId != null && !N.isVoorstel(it) && it.status !== 'klaar';
  N.omzetten = async function (it, opnieuw) {
    if (!N.omzetbaar(it) || S.bezig || S.menuBezig) return;
    const blokPersoon = x => { const b = (D.blokken() || []).find(y => y && String(y.id) === String(x.blokId)); return b ? (P.persoonSlug(b.persoon, D.team()) || b.persoon) : x.persoon; };
    const aantal = (() => { try { return P.taakBlokkenVan(it.taak, (D.taken() || {})[it.code], it.code, D.blokken(), D.taken()).length; } catch (e) { return 1; } })();
    const spec = { blokId: String(it.blokId), taak: { code: it.code, id: it.id, naam: it.naam }, opnieuw: !!opnieuw };
    if (!opnieuw) {
      S.menuBezig = true; let ja = false;
      try { ja = D.dialoog.confirm ? await D.dialoog.confirm({ title: 'Omzetten naar taakbalk', message: '"' + it.naam + '" is nu een planblok. Het wordt een taakbalk: de taak krijgt ' + persNaam(blokPersoon(it)) + ' en de dag van het blok, en het planblok verdwijnt. Een taak die al eigen datums heeft, houdt die.' + (aantal > 1 ? ' Deze taak heeft ' + aantal + ' planblokken: ze worden samengevoegd tot een balk van het eerste tot het laatste blok.' : ''), okLabel: 'Omzetten', cancelLabel: 'Annuleren' }) : false; } finally { S.menuBezig = false; }
      if (!ja) return;
    }
    if (S.bezig) return;
    S.bezig = true; let r;
    try { r = await D.omzetten(spec, { traag: () => N.toast('Opslaan duurt lang, even geduld…', null, true) }); } catch (e) { r = { ok: false, reden: 'Omzetten mislukt: ' + ((e && e.message) || e) }; } finally { S.bezig = false; }
    N.teken(); omzetUitkomst(r, it);
  };
  // De uitkomst van omzetten of opruimen tonen. Een blok dat er nog staat: opnieuw proberen = ALLEEN die blokken opruimen (met hun oorspronkelijke snapshots), nooit de omzetting opnieuw draaien.
  const omzetUitkomst = (r, it) => {
    if (r && r.onzeker) { N.toast(r.reden, null, true); N.naOnzeker(r.onzeker); return; }
    if (!r || !r.ok) { N.toast((r && r.reden) || 'Dat lukt niet.', null, true); return; }
    if (r.tegelijk) { N.toast(r.tegelijk, null, true); return; }
    if (r.alOmgezet) { N.toast(r.melding || 'Dit planblok is al omgezet.', null, true); return; }
    if (r.omgezet && !r.blokWeg) {   // de taak staat goed, een of meer blokken staan er nog (en tellen gewoon mee)
      if (r.gewijzigd) { N.toast(r.melding, null, true); return; }   // een blok is intussen gewijzigd: eerst controleren, dan opnieuw omzetten
      N.toast(r.melding, () => N.opruimen(it, r.restSnaps), true, 'Opnieuw proberen'); return;
    }
    N.toast(r.melding || 'Omgezet naar een taakbalk.', null, true);
  };
  N.opruimen = async function (it, restSnaps) {
    if (!D.opruimen || N.mag() !== true || (D.magTaken && !D.magTaken()) || !Array.isArray(restSnaps) || !restSnaps.length || S.bezig || S.menuBezig) return;
    S.bezig = true; let r;
    try { r = await D.opruimen({ taak: { code: it.code, id: it.id, naam: it.naam }, resten: restSnaps }, { traag: () => N.toast('Opslaan duurt lang, even geduld…', null, true) }); } catch (e) { r = { ok: false, reden: 'Opruimen mislukt: ' + ((e && e.message) || e) }; } finally { S.bezig = false; }
    N.teken(); omzetUitkomst(r, it);
  };
  // Datums wijzigen (de toegankelijke vervanger van de randen slepen, zonder Alt of Shift): een dialoog met twee datumvelden (start en eind; een mijlpaal heeft er een). -> Promise<{start, eind} | null>
  N.datumsDialoog = function (it) {
    const t = it.taak || {}, mijlpaal = t.soort === 'mijlpaal', s0 = P.isYmd(t.start) ? t.start : it.datum, e0 = P.isYmd(t.eind) ? t.eind : s0;
    const dlg0 = D.doc.createElement('dialog');
    if (typeof dlg0.showModal !== 'function') {   // zonder <dialog>: twee korte vragen
      return (async () => {
        if (!D.dialoog || !D.dialoog.prompt) return null;
        const a = await D.dialoog.prompt({ title: 'Datums wijzigen', message: (mijlpaal ? 'Datum' : 'Start') + ' (jjjj-mm-dd)', defaultValue: s0 }); if (a === null || a === undefined) return null;
        const b = mijlpaal ? a : await D.dialoog.prompt({ title: 'Datums wijzigen', message: 'Eind (jjjj-mm-dd)', defaultValue: e0 }); if (b === null || b === undefined) return null;
        return P.isYmd(String(a).trim()) && P.isYmd(String(b).trim()) ? { start: String(a).trim(), eind: String(b).trim() } : null;
      })();
    }
    return new Promise(klaar => {
      const dlg = dlg0; dlg.className = 'cn-datums'; dlg.setAttribute('aria-labelledby', 'cn-dat-kop');
      const veld = (id, label, waarde) => el('label', { 'for': id, klass: 'cn-dat-veld' }, el('span', { tekst: label }), el('input', { type: 'date', id, value: waarde, required: true }));
      const fout = el('div', { klass: 'cn-dat-fout', role: 'alert' }), a = veld('cn-dat-start', mijlpaal ? 'Datum' : 'Start', s0), b = mijlpaal ? null : veld('cn-dat-eind', 'Eind', e0);
      let gemeld = false;
      const sluit = w => { if (gemeld) return; gemeld = true; try { dlg.close(); } catch (e) {} if (dlg.parentNode) dlg.parentNode.removeChild(dlg); klaar(w); };
      const form = el('form', { method: 'dialog', klass: 'cn-dat-form' },
        el('h2', { id: 'cn-dat-kop', klass: 'cn-dat-kop', tekst: 'Datums wijzigen' }), el('div', { klass: 'cn-sub', tekst: it.naam }), a, b, fout,
        el('div', { klass: 'cn-dat-knoppen' }, el('button', { type: 'button', klass: 'cn-knop', tekst: 'Annuleren', klik: () => sluit(null) }), el('button', { type: 'submit', klass: 'cn-knop prim', tekst: 'Opslaan' })));
      form.addEventListener('submit', ev => {
        ev.preventDefault();
        const s = a.querySelector('input').value, e = b ? b.querySelector('input').value : s;
        if (!P.isYmd(s) || !P.isYmd(e)) { fout.textContent = 'Vul een geldige datum in.'; return; }
        if (e < s) { fout.textContent = 'Het eind ligt voor de start.'; return; }
        sluit({ start: s, eind: e });
      });
      dlg.addEventListener('cancel', ev => { ev.preventDefault(); sluit(null); });
      dlg.appendChild(form); D.doc.body.appendChild(dlg);
      try { dlg.showModal(); const i = a.querySelector('input'); if (i && i.focus) i.focus(); } catch (e) { sluit(null); }
    });
  };
  // Het toetsenbord-alternatief voor slepen: kies persoon, dag en dagdeel of uur in drie korte keuzelijsten (mtDialog.choose)
  N.menu = async function (bron) {
    if (S.menuBezig || S.bezig) return;   // twee keuzemenu's vlak na elkaar of een lopende opslag: niet twee mutaties
    S.menuBezig = true; try { await menuStappen(bron); } finally { S.menuBezig = false; }
  };
  async function menuStappen(bron) {
    const dlg = D.dialoog; if (!dlg || !dlg.choose || !N.mag()) return;
    const m = N.laatste; if (!m) return;
    const team = (D.team() || []).filter(t => t && t.slug), titel = 'Verplaats naar…';
    const pi = await dlg.choose({ title: titel, message: bron.naam + '\nKies de persoon', choices: team.map(t => ({ label: t.naam })) }); if (pi === null || pi === undefined) return;
    const dagen = (m.dagIdx ? m.dagIdx.map(i => m.dagen[i]) : m.dagen).filter(d => d.werkdag);
    if (bron.soort === 'taakbalk') { if (!dagen.length) return; N.drop({ soort: 'taakbalk', taak: bron.taak, van: bron.van, persoon: team[pi].slug, datum: dagen[0].datum }); return; }   // alleen de persoon verandert: de datums blijven
    const di = await dlg.choose({ title: titel, message: bron.naam + ' → ' + team[pi].naam + '\nKies de dag', choices: dagen.map(d => ({ label: P.datumKort(d.datum) })) }); if (di === null || di === undefined) return;
    if (bron.soort === 'nieuw') { N.drop({ soort: 'nieuw', taak: bron.taak, persoon: team[pi].slug, datum: dagen[di].datum }); return; }   // uit Ongepland: de taak begint op die dag (het moment doet er niet toe, het is een taakbalk)
    const uurZoom = S.zoom === '3d' || S.zoom === 'dag', opties = [{ label: 'Ochtend', sublabel: 'op de eerste vrije tijd', spec: { dagdeel: 0 } }, { label: 'Middag', sublabel: 'op de eerste vrije tijd', spec: { dagdeel: 1 } }];
    if (uurZoom) for (let h = 7; h < 17; h++) opties.push({ label: String(h).padStart(2, '0') + ':00', spec: { start: String(h).padStart(2, '0') + ':00' } });
    const oi = await dlg.choose({ title: titel, message: bron.naam + ' → ' + team[pi].naam + ', ' + P.datumKort(dagen[di].datum) + '\nKies het moment', choices: opties.map(o => ({ label: o.label, sublabel: o.sublabel })) }); if (oi === null || oi === undefined) return;
    N.drop(Object.assign({}, bron.soort === 'nieuw' ? { soort: 'nieuw', taak: bron.taak } : { soort: 'verplaats', blokId: bron.blokId }, { persoon: team[pi].slug, datum: dagen[di].datum }, opties[oi].spec));
  }
  const HINT = { kwartaal: 'Elke balk is een project; de uren per week staan erboven', maand: 'Hoogte = belasting per dag · inzoomen naar week voor de blokken', week: 'Getinte blokken per project · gestippeld = open voorstel', '3d': 'Blokken in uren · twee banen = dubbel geboekt', dag: 'Blokken in uren · de messing lijn is nu' };
  function filterKnoppen() {
    if (FF()) return FF().balk({ pre: 'cap', std: 'iedereen', status: false, klaar: () => N.teken() });   // dezelfde balk als Mijn werk en de Planning van een project (de status past hier niet: de Capaciteit telt uren, geen taakstatus)
    const team = D.team() || [];
    const wie = el('select', { id: 'cn-wie', 'aria-label': 'Wie', klass: 'cn-filter', wijzig: ev => { S.persoon = ev.target.value; N.teken(); } }, el('option', { value: '', tekst: 'Wie: iedereen' }), team.map(t => el('option', { value: t.slug, tekst: t.naam })));
    wie.value = S.persoon;
    const pr = (D.projecten ? D.projecten() : []).slice().sort((a, b) => String(a.label).localeCompare(String(b.label)));
    const proj = el('select', { id: 'cn-project', 'aria-label': 'Project', klass: 'cn-filter', wijzig: ev => { S.project = ev.target.value; N.teken(); } }, el('option', { value: '', tekst: 'Project: alle' }), pr.map(p => el('option', { value: p.code, tekst: p.label || p.code })));
    proj.value = S.project;
    return [wie, proj];
  }
  N.stap = function (richting) {
    S.exactDag = false; const a = S.anker || P.vandaagYmd();
    S.anker = S.zoom === 'week' ? plusDagen(a, 7 * richting) : S.zoom === 'maand' ? plusDagen(a, 28 * richting) : S.zoom === 'kwartaal' ? plusDagen(a, 91 * richting) : S.zoom === '3d' ? plusWerkdagen(volgendeWerkdag(a, 1), 3 * richting) : plusWerkdagen(volgendeWerkdag(a, 1), richting);
    duwPeriode(); N.teken();
  };
  N.zoom = function (z) {
    if (!ZOOM_UI || !ZOOMS.some(x => x[0] === z)) return;
    S.exactDag = false; S.zoom = z; try { D.storage && D.storage.setItem(LS_ZOOM, z); } catch (e) {}
    duwPeriode(); N.teken();
  };

  N.teken = function () {
    const w = D && D.doc.getElementById('agenda-capaciteit'); if (!w) return;
    w.textContent = '';
    trekFilter();
    if (!S.anker) S.anker = P.vandaagYmd();
    let m; try { m = N.model(); } catch (e) { console.warn('Capaciteit (nieuw):', e); w.appendChild(el('div', { klass: 'cn-melding', tekst: 'De planning kon niet worden berekend.' })); return; }
    N.laatste = m;
    const zi = ZOOMS.findIndex(z => z[0] === S.zoom);
    const knop = (label, klik, kl) => el('button', { type: 'button', klass: 'cn-knop' + (kl ? ' ' + kl : ''), 'aria-label': label, klik });
    const vorige = knop('Vorige periode', () => N.stap(-1), 'icoon'), volgende = knop('Volgende periode', () => N.stap(1), 'icoon');
    vorige.appendChild(icoon('M15 6l-6 6l6 6')); volgende.appendChild(icoon('M9 6l6 6l-6 6'));
    const vandaag = knop('Naar vandaag', () => { S.exactDag = false; S.anker = P.vandaagYmd(); duwPeriode(); N.teken(); }); vandaag.textContent = 'Vandaag';
    const zoomGroep = el('div', { klass: 'cn-zoom', role: 'group', 'aria-label': 'Inzoomen' },
      (() => { const b = knop('Uitzoomen', () => N.zoom(ZOOMS[Math.max(0, zi - 1)][0]), 'zm'); b.appendChild(icoon('M5 12h14')); return b; })(),
      ZOOMS.map(z => { const b = el('button', { type: 'button', klass: 'cn-zk' + (z[0] === S.zoom ? ' aan' : ''), 'aria-pressed': z[0] === S.zoom ? 'true' : 'false', klik: () => N.zoom(z[0]), tekst: z[1] }); return b; }),
      (() => { const b = knop('Inzoomen', () => N.zoom(ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)][0]), 'zm'); b.appendChild(icoon('M12 5v14M5 12h14')); return b; })());
    w.appendChild(el('div', { klass: 'cn-balk-boven' }, vorige, vandaag, volgende, el('span', { klass: 'cn-titel', title: m.titel + ' · ' + m.sub, tekst: m.titel }), el('span', { klass: 'cn-sub cn-num', tekst: m.sub }), el('span', { klass: 'cn-rek' }), filterKnoppen(), ZOOM_UI ? zoomGroep : null));
    if (D.takenKlaar && !D.takenKlaar()) w.appendChild(el('div', { klass: 'cn-melding', role: 'status', tekst: D.takenStatusTekst() + ' Je ziet alleen wat er al staat.' }));
    const vlak = el('div', { klass: 'cn-vlak' });
    const rijen = m.rijen;
    if (!rijen.length) vlak.appendChild(el('div', { klass: 'cn-melding', tekst: 'Geen teamleden voor deze keuze.' }));
    else if (S.zoom === 'week') tekenWeek(m, rijen, vlak);
    else if (S.zoom === 'maand') tekenMaand(m, rijen, vlak);
    else if (S.zoom === 'kwartaal') tekenKwartaal(m, rijen, vlak);
    else tekenUren(m, rijen, vlak);
    vlak.appendChild(el('div', { klass: 'cn-legenda' }, el('span', null, el('i', { klass: 'cn-lg-balk' }), 'gepland t.o.v. beschikbaar'), el('span', { klass: 'over' }, el('i', { klass: 'cn-lg-over' }), 'meer gepland dan beschikbaar'), el('span', null, el('i', { klass: 'cn-lg-vrij' }), 'vrij of verlof'), el('span', null, el('i', { klass: 'cn-lg-voorstel' }), 'open voorstel'), el('span', { klass: 'cn-hint', tekst: HINT[S.zoom] + ((S.zoom === 'week' || S.zoom === '3d' || S.zoom === 'dag') ? (N.mag() ? ' · sleep een blok, of kies ⇄ voor het toetsenbord' : ' · verplaatsen is voor kantoor') : '') })));
    w.appendChild(el('div', { klass: 'cn-kader' }, el('div', { klass: 'cn-hoofd' }, vlak), zijkolom(m)));
    if (S.focusTaak) { const f = [...w.querySelectorAll('.cn-blok[data-taak]')].find(x => x.getAttribute('data-taak') === S.focusTaak && (!S.focusCode || x.getAttribute('data-code') === S.focusCode)); S.focusTaak = null; S.focusCode = null; if (f && f.focus) f.focus(); }   // de balk waarop met het toetsenbord gewerkt werd houdt de focus
    if (FF()) FF().markeer(w);   // de geselecteerde taak (het laatst geopende taakpaneel) blijft gemarkeerd bij het wisselen van weergave
  };

  // Vanuit Vandaag ("Inplannen" bij een taak zonder datum): de taak in Ongepland markeren en het bestaande "Plan … in…"-keuzemenu (N.menu) openen. Er is geen eigen schrijfroute:
  // plannen loopt via N.drop, dus via D.verplaats met dezelfde controles als slepen. De aanroeper heeft de Agenda al op Capaciteit gezet. Zonder recht (N.mag) blijft het bij markeren.
  N.inplannen = function (taak) {
    if (!taak || taak.id === undefined || taak.id === null) return false;
    duwFilter({ persoon: '', project: '' }); S.exactDag = false; S.persoon = ''; S.project = ''; S.anker = P.vandaagYmd(); S.ongDicht = false;
    if (S.zoom === 'maand' || S.zoom === 'kwartaal') S.zoom = 'week';   // een keuzemenu voor dag en moment heeft een week of dagweergave nodig (de bewaarde zoomkeuze verandert niet)
    duwPeriode();
    S.markeer = { id: String(taak.id), code: String(taak.code == null ? '' : taak.code), tot: D.nu() + 60000 };
    N.teken();
    const m = N.laatste, staat = !!m && m.ongepland.items.some(x => String(x.id) === String(taak.id) && (!taak.code || String(x.code).toLowerCase() === String(taak.code).toLowerCase()) && !x.voorstel);
    if (!staat) { N.toast('Deze taak staat niet meer in Ongepland: iemand heeft hem net ingepland of gewijzigd.'); return false; }
    const e = D.doc.querySelector('.cn-ong.gemarkeerd'); if (e && e.scrollIntoView) e.scrollIntoView({ block: 'nearest' });
    if (N.mag()) N.menu({ soort: 'nieuw', taak: { code: taak.code, id: taak.id, naam: taak.naam, min: taak.min || 0, voorstel: false }, naam: taak.naam });
    return true;
  };
  // Vanuit Afwijkingen (Admin > Team en werktijden): de dagweergave van die dag voor die persoon openen (de aanroeper wisselt naar de Agenda).
  // Vanuit het taakpaneel ("Toon in tijdlijn"): de week van de taak, zonder filters, en de balk(en) van die taak een minuut gemarkeerd (de aanroeper wisselt naar de Agenda ▸ Capaciteit).
  N.toonTaak = function (taak, datum) {
    if (!taak || taak.id == null) return false;
    duwFilter({ persoon: '', project: '' }); S.exactDag = false; S.persoon = ''; S.project = ''; S.anker = P.isYmd(datum) ? datum : P.vandaagYmd();
    if (S.zoom === 'maand' || S.zoom === 'kwartaal') S.zoom = 'week';   // de balken zijn pas in een week- of dagweergave te zien (de bewaarde zoomkeuze verandert niet)
    duwPeriode();
    S.toon = { id: String(taak.id), code: String(taak.code == null ? '' : taak.code).toLowerCase(), tot: D.nu() + 60000 };
    N.teken();
    const e = D.doc.querySelector('#agenda-capaciteit .cn-blok.tp-gemarkeerd'); if (e && e.scrollIntoView) e.scrollIntoView({ block: 'center', inline: 'center' });
    return !!e;
  };
  N.gaNaar = function (datum, slug) { if (P.isYmd(datum)) S.anker = datum; S.persoon = slug || ''; S.project = ''; S.zoom = P.isYmd(datum) ? 'dag' : 'week'; S.exactDag = P.isYmd(datum); duwFilter({ persoon: slug || '', project: '' }); duwPeriode(); };   // precies die dag (ook een weekenddag), met die persoon in beeld; de bewaarde zoomkeuze verandert niet
  N.init = function (deps) {
    D = deps; P = deps.planning || root.MTPlanning;
    try { const z = D.storage && D.storage.getItem(LS_ZOOM); if (ZOOM_UI && z && ZOOMS.some(x => x[0] === z)) S.zoom = z; S.ongDicht = !!(D.storage && D.storage.getItem(LS_ONG) === 'dicht'); } catch (e) {}
    return N;
  };
  N.S = S;
  root.MTCapaciteitNieuw = N;
  if (typeof module !== 'undefined' && module.exports) module.exports = N;
})(typeof window !== 'undefined' ? window : globalThis);
