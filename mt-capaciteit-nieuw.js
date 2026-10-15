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
  const S = { zoom: 'week', anker: null, persoon: '', project: '', ongDicht: false };
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
    const neem = (it, soort) => { if (it.soort === 'taak' && !lijst.some(x => x.id === it.id)) lijst.push({ id: it.id, code: it.code, naam: it.taak.naam, min: it.gepland_min || 0, voorstel: !!it.taak.voorstel, soort, tekst: it.taak.voorstel ? P.voorstelTekst(it.taak.voorstel) : '' }); };
    mw.groepen.voorstel.forEach(it => neem(it, 'voorstel'));
    mw.groepen.zonderDatum.forEach(it => neem(it, 'zonder'));
    mw.groepen.nietVrij.filter(it => !it.start && !it.eind && !(it.blokken && it.blokken.length)).forEach(it => neem(it, 'zonder'));
    lijst.sort((a, b) => (b.voorstel - a.voorstel) || (String(a.code).toLowerCase() < String(b.code).toLowerCase() ? -1 : String(a.code).toLowerCase() > String(b.code).toLowerCase() ? 1 : 0) || (a.naam < b.naam ? -1 : 1));
    return { items: lijst, min: lijst.reduce((s, x) => s + x.min, 0) };
  }

  N.model = function (st) {
    st = Object.assign({}, S, st || {});
    const today = P.vandaagYmd(), zoom = st.zoom, anker = st.anker || today;
    const team = D.team() || [], o = { team, vrij: D.vrij ? D.vrij() : null, verlof: D.verlof ? D.verlof() : null, werkuren: D.werkuren ? D.werkuren() : null, project: st.project || '' };
    let van, weken, zichtbaar;   // zichtbaar = de datums die getekend worden
    if (zoom === 'week') { van = monday(anker); weken = 1; }
    else if (zoom === 'maand') { van = monday(anker); weken = 4; }
    else if (zoom === 'kwartaal') { van = monday(anker); weken = 13; }
    else {
      const s0 = volgendeWerkdag(anker, 1); van = monday(s0); zichtbaar = [s0]; weken = 1;
      if (zoom === '3d') { let d = s0; for (let i = 0; i < 2; i++) { d = plusWerkdagen(d, 1); zichtbaar.push(d); } weken = Math.ceil((nr(zichtbaar[2]) - nr(van) + 1) / 7); }
    }
    const r = rooster(van, weken, o);
    const dagIdx = zichtbaar ? zichtbaar.map(d => r.dagen.findIndex(x => x.datum === d)) : null;
    let rijen = r.rijen; if (st.persoon) rijen = rijen.filter(x => x.slug === st.persoon);
    const m = { zoom, today, anker, van, weken, dagen: r.dagen.map(d => Object.assign({}, d, { nu: d.datum === today })), dagIdx, rijen, project: st.project, persoon: st.persoon };
    m.ongepland = ongepland({ team, vrij: o.vrij, verlof: o.verlof, project: st.project || '' });
    if (st.persoon) { m.ongepland.items = m.ongepland.items.filter(x => { const sl = Object.keys(D.taken() || {}).find(c => String(c).toLowerCase() === String(x.code).toLowerCase()); const t = sl ? (D.taken()[sl] || []).find(y => y && y.id === x.id) : null; return t && P.zelfdePersoon(t.toegewezen, st.persoon, team); }); m.ongepland.min = m.ongepland.items.reduce((s, x) => s + x.min, 0); }
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

  // Een open voorstel: een planblok met status voorstel (ook als het aan een taak hangt: dan heeft het item een blokId) of een taak met een voorstel-markering.
  N.isVoorstel = function (it) { if (!it) return false; if (it.planvoorstel || it.voorstel) return true; if (it.blokId == null) return false; return (D.blokken() || []).some(b => b && String(b.id) === String(it.blokId) && b.status === 'voorstel' && !b._vervallen); };

  // Eén planblok (getint per project; een open voorstel is gestippeld met een chip; een wachtende taak toont dat)
  function blok(it, uur, stijl) {
    const voorstel = N.isVoorstel(it), wacht = !!(it.wacht && it.status !== 'klaar');
    const sub = el('span', { klass: 'cn-blok-sub' }, el('span', { klass: 'cn-code', tekst: projNr(it.code) }), ' ' + projNaam(it.code), it.min && !uur ? ' · ' + uren(it.min) : '');
    const b = el('button', { type: 'button', klass: 'cn-blok' + (voorstel ? ' voorstel' : '') + (wacht ? ' wacht' : ''), style: '--block-color:' + P.projectKleur(it.code) + (stijl ? ';' + stijl : ''), title: [it.naam, projNr(it.code) + ' ' + projNaam(it.code), it.min ? uren(it.min) : '', voorstel ? 'voorstel' : '', wacht ? ('wacht' + (it.wachtTekst ? ': ' + it.wachtTekst : '')) : ''].filter(Boolean).join(' · '), klik: () => open(it.code) },
      el('span', { klass: 'cn-blok-kop' }, el('span', { klass: 'cn-blok-titel', tekst: it.naam }), voorstel ? el('span', { klass: 'cn-chipje', tekst: 'voorstel' }) : null, wacht && !voorstel ? el('span', { klass: 'cn-chipje wacht', tekst: 'wacht' }) : null), uur ? el('span', { klass: 'cn-blok-sub' }, el('span', { klass: 'cn-tijd', tekst: uur }), ' · ', el('span', { klass: 'cn-code', tekst: projNr(it.code) }), ' ' + projNaam(it.code)) : sub,
);
    return b;
  }
  const persoonKop = (r, tekst, over, balk) => el('div', { klass: 'cn-persoon' },
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
        else (r.slots[i] || [[], []]).forEach((lijst, dl) => cel.appendChild(el('div', { klass: 'cn-slot' }, lijst.map(it => blok(it)), lijst.length ? null : el('div', { klass: 'cn-leeg', tekst: dl ? 'middag' : 'ochtend' }))));
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
      el('div', { klass: 'cn-ong-lijst' }, up.items.length ? up.items.map(u => el('button', { type: 'button', klass: 'cn-blok cn-ong' + (u.voorstel ? ' voorstel' : ''), style: '--block-color:' + P.projectKleur(u.code), title: u.tekst || u.naam, klik: () => open(u.code) },
        el('span', { klass: 'cn-ong-rij' }, el('span', { klass: 'cn-blok-titel', tekst: u.naam }), u.min ? el('span', { klass: 'cn-num cn-sub', tekst: uren(u.min) }) : null),
        el('span', { klass: 'cn-blok-sub' }, el('span', { klass: 'cn-code', tekst: projNr(u.code) }), ' ' + projNaam(u.code), u.voorstel ? ' · voorstel werkplaats' : ''))) : el('div', { klass: 'cn-sub cn-ong-leeg', tekst: 'Alles heeft een plek.' })));
  }

  const HINT = { kwartaal: 'Elke balk is een project; de uren per week staan erboven', maand: 'Hoogte = belasting per dag · inzoomen naar week voor de blokken', week: 'Getinte blokken per project · gestippeld = open voorstel', '3d': 'Blokken in uren · twee banen = dubbel geboekt', dag: 'Blokken in uren · de messing lijn is nu' };
  function filterKnoppen() {
    const team = D.team() || [];
    const wie = el('select', { id: 'cn-wie', 'aria-label': 'Wie', klass: 'cn-filter', wijzig: ev => { S.persoon = ev.target.value; N.teken(); } }, el('option', { value: '', tekst: 'Wie: iedereen' }), team.map(t => el('option', { value: t.slug, tekst: t.naam })));
    wie.value = S.persoon;
    const pr = (D.projecten ? D.projecten() : []).slice().sort((a, b) => String(a.label).localeCompare(String(b.label)));
    const proj = el('select', { id: 'cn-project', 'aria-label': 'Project', klass: 'cn-filter', wijzig: ev => { S.project = ev.target.value; N.teken(); } }, el('option', { value: '', tekst: 'Project: alle' }), pr.map(p => el('option', { value: p.code, tekst: p.label || p.code })));
    proj.value = S.project;
    return [wie, proj];
  }
  N.stap = function (richting) {
    const a = S.anker || P.vandaagYmd();
    S.anker = S.zoom === 'week' ? plusDagen(a, 7 * richting) : S.zoom === 'maand' ? plusDagen(a, 28 * richting) : S.zoom === 'kwartaal' ? plusDagen(a, 91 * richting) : S.zoom === '3d' ? plusWerkdagen(volgendeWerkdag(a, 1), 3 * richting) : plusWerkdagen(volgendeWerkdag(a, 1), richting);
    N.teken();
  };
  N.zoom = function (z) {
    if (!ZOOM_UI || !ZOOMS.some(x => x[0] === z)) return;
    S.zoom = z; try { D.storage && D.storage.setItem(LS_ZOOM, z); } catch (e) {}
    N.teken();
  };

  N.teken = function () {
    const w = D && D.doc.getElementById('agenda-capaciteit'); if (!w) return;
    w.textContent = '';
    if (!S.anker) S.anker = P.vandaagYmd();
    let m; try { m = N.model(); } catch (e) { console.warn('Capaciteit (nieuw):', e); w.appendChild(el('div', { klass: 'cn-melding', tekst: 'De planning kon niet worden berekend.' })); return; }
    N.laatste = m;
    const zi = ZOOMS.findIndex(z => z[0] === S.zoom);
    const knop = (label, klik, kl) => el('button', { type: 'button', klass: 'cn-knop' + (kl ? ' ' + kl : ''), 'aria-label': label, klik });
    const vorige = knop('Vorige periode', () => N.stap(-1), 'icoon'), volgende = knop('Volgende periode', () => N.stap(1), 'icoon');
    vorige.appendChild(icoon('M15 6l-6 6l6 6')); volgende.appendChild(icoon('M9 6l6 6l-6 6'));
    const vandaag = knop('Naar vandaag', () => { S.anker = P.vandaagYmd(); N.teken(); }); vandaag.textContent = 'Vandaag';
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
    vlak.appendChild(el('div', { klass: 'cn-legenda' }, el('span', null, el('i', { klass: 'cn-lg-balk' }), 'gepland t.o.v. beschikbaar'), el('span', { klass: 'over' }, el('i', { klass: 'cn-lg-over' }), 'meer gepland dan beschikbaar'), el('span', null, el('i', { klass: 'cn-lg-vrij' }), 'vrij of verlof'), el('span', null, el('i', { klass: 'cn-lg-voorstel' }), 'open voorstel'), el('span', { klass: 'cn-hint', tekst: HINT[S.zoom] })));
    w.appendChild(el('div', { klass: 'cn-kader' }, el('div', { klass: 'cn-hoofd' }, vlak), zijkolom(m)));
  };

  N.init = function (deps) {
    D = deps; P = deps.planning || root.MTPlanning;
    try { const z = D.storage && D.storage.getItem(LS_ZOOM); if (ZOOM_UI && z && ZOOMS.some(x => x[0] === z)) S.zoom = z; S.ongDicht = !!(D.storage && D.storage.getItem(LS_ONG) === 'dicht'); } catch (e) {}
    return N;
  };
  N.S = S;
  root.MTCapaciteitNieuw = N;
  if (typeof module !== 'undefined' && module.exports) module.exports = N;
})(typeof window !== 'undefined' ? window : globalThis);
