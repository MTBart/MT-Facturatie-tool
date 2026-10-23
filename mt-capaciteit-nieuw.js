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
  // C1 (doorlopende schaal): zoom en anker blijven de snelkeuze (de knoppen, de link, de tests). Zodra je scrolt, knijpt of sleept is `vrij` waar en gelden ppd (pixels per werkdag) en pos
  // (de werkdag-index aan de linkerrand, met een breuk voor het deel van de dag) als enige waarheid; `zoom` is dan alleen het etiket van het niveau waarin je zit en `anker` de datum aan de linkerrand.
  const S = { zoom: 'week', anker: null, persoon: '', project: '', ongDicht: false, fRev: -1, vrij: false, ppd: 0, pos: 0, Wv: 0, agenda: {}, meer: {} };
  // De gedeelde filterbalk (mt-planfilter.js): project, persoon en periode (begindatum en zoom) komen daar vandaan en staan in de link. Zonder die module (losse tests) werkt alles als voorheen.
  const FF = () => root.MTPlanFilter || null;
  function trekFilter() {   // de gedeelde stand overnemen zodra die veranderd is (de balk, een link, een andere weergave)
    const f = FF(); if (!f || f.rev() === S.fRev) return;
    const g = f.get();
    S.project = g.project; S.persoon = f.persoonSlug('iedereen');
    if (f.ZOOMS.includes(g.zoom)) S.zoom = g.zoom;
    if (f.isYmd(g.van)) { S.anker = g.van; S.exactDag = false; } else if (S.fRev >= 0) S.anker = null;   // een link zonder datum = deze periode
    // een link met schaal (pixels per uur) en tijd is een vrije stand; zonder schaal geldt de snelkeuze (zoom + van) zoals altijd
    const sc = Number(g.schaal);
    if (sc > 0) { S.vrij = true; S.ppd = begrens(sc * UH(), S.Wv || 1000); const dag0 = P.isYmd(S.anker) ? S.anker : P.vandaagYmd(), t = tijdMin(g.tijd); S.pos = wiVan(dag0) + (t === null ? 0 : Math.max(0, Math.min(0.999, (t - U0) / (UH() * 60)))); S.exactDag = false; } else if (S.fRev >= 0 || g.van || g.zoom) S.vrij = false;   // een link met alleen een snelkeuze wint van de onthouden vrije schaal
    S.fRev = f.rev();
  }
  function duwPeriode() {   // een eigen keuze van de periode (bladeren, zoom) naar de gedeelde stand en de link
    const f = FF(); if (!f) return;
    const nu = P.vandaagYmd(), p = { van: S.anker && S.anker !== nu ? S.anker : '', zoom: S.zoom, schaal: '', tijd: '' };
    if (S.vrij && S.ppd > 0) { p.schaal = String(Math.round(S.ppd / UH() * 10) / 10); const fr = S.pos - Math.floor(S.pos); if (fr > 0.002) p.tijd = hhmm(U0 + Math.round(fr * UH() * 12) * 5); }   // de linkerrand tot op 5 minuten
    f.zet(p); S.fRev = f.rev();
  }
  function duwFilter(patch) { const f = FF(); if (!f) return; f.zet(patch); S.fRev = f.rev(); }   // een sprong naar een taak of persoon zet de filters zelf
  const LS_ONG = 'mt-cap-ong';   // 'dicht' = de Ongepland-kolom is ingeklapt (per computer onthouden)
  let U0 = 420, U1 = 1020;   // de as van een dag: 07:00 tot 17:00, ruimer zodra iemands werktijden daarbuiten vallen (zie bepaalUren)
  const UH = () => (U1 - U0) / 60;   // uren per getekende dag

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

  // ── de doorlopende schaal (C1) ──
  // De tijdas telt alleen werkdagen (zaterdag en zondag bestaan niet in het model): de werkdag-index wi is 0 op maandag 5 januari 1970, 5 op de maandag erna, enzovoort. De schaal is ppd
  // (pixels per werkdag); een werkdag beslaat de as U0..U1, dus pixels per uur = ppd / UH. Alles hieronder is rekenwerk zonder DOM (testbaar met b-cap-zoom-harness.js).
  const MIN_PPD = 6, MAX_PPD = 3600, MAX_DAGEN_ZICHT = 300;
  const wiVan = s => { const n = nr(s) - 4, wk = Math.floor(n / 7), d = n - wk * 7; return d < 5 ? wk * 5 + d : (wk + 1) * 5; };   // een weekend valt op de maandag erna
  const datumVanWi = wi => { const w = Math.floor(wi), wk = Math.floor(w / 5); return ymd(4 + wk * 7 + (w - wk * 5)); };
  const begrens = (ppd, Wv) => Math.max(MIN_PPD, Wv / MAX_DAGEN_ZICHT, Math.min(MAX_PPD, ppd));   // nooit meer dan MAX_DAGEN_ZICHT werkdagen tegelijk in beeld
  N.wiVan = wiVan; N.datumVanWi = datumVanWi; N.begrens = begrens;
  // De grenzen (in pixels per werkdag) tussen kwartaal | maand | week | uren, bij een tijdkolom van Wv pixels
  // De grenzen volgen de breedte van de tijdkolom: kwartaal/maand bij 40 dagen in beeld, maand/week bij 10, week/uren bij 3,5 (zodat "week" een week blijft en "3 dagen" ook op een smalle kolom drie dagen is), met ondergrenzen voor wat leesbaar blijft
  N.drempels = Wv => ({ km: Math.max(12, Wv / 40), mw: Math.max(110, Wv / 10), wu: Math.max(150, Wv / 3.5) });
  // Het niveau waarin een schaal valt: kwartaal, maand, week, 3d of dag (het etiket op de knoppen)
  N.modus = (ppd, Wv) => { const t = N.drempels(Wv); if (ppd < t.km) return 'kwartaal'; if (ppd < t.mw) return 'maand'; if (ppd < t.wu) return 'week'; return ppd < Wv * 0.55 ? '3d' : 'dag'; };
  // De schaal van een snelkeuze: zoveel mogelijk precies zoveel dagen in beeld (65 · 20 · 5 · 3 · 1), maar binnen het eigen niveau (op een telefoon past een week niet: dan scrolt de rest)
  N.preset = (z, Wv) => {
    const t = N.drempels(Wv), kl = (x, a, b) => Math.max(a, Math.min(b, x));
    if (z === 'kwartaal') return kl(Wv / 65, Math.max(MIN_PPD, Wv / MAX_DAGEN_ZICHT), t.km - 0.5);
    if (z === 'maand') return kl(Wv / 20, t.km + 0.5, t.mw - 0.5);
    if (z === 'week') return kl(Wv / 5, t.mw + 0.5, t.wu - 0.5);
    if (z === '3d') return Math.max(t.wu + 0.5, Wv / 3);
    return Math.max(t.wu + 0.5, Wv);
  };
  // Het aantal werkdagen (met breuk) dat één klik op vorige/volgende schuift: één eenheid van het niveau
  N.eenheid = z => z === 'kwartaal' ? 65 : z === 'maand' ? 20 : z === 'week' ? 5 : z === '3d' ? 3 : 1;
  // Zoomen rond een punt: het moment onder de muis (x pixels vanaf de linkerrand van de tijdkolom) blijft onder de muis. st = { ppd, pos } -> { ppd, pos }
  N.zoomRond = (st, x, factor, Wv) => { const ppd2 = begrens(st.ppd * factor, Wv); return { ppd: ppd2, pos: st.pos + x / st.ppd - x / ppd2 }; };
  // Schuiven: dx pixels naar rechts slepen toont wat links lag; de positie blijft binnen een eindig bereik (ruim drie jaar)
  N.schuif = (st, dx) => ({ ppd: st.ppd, pos: st.pos - dx / st.ppd });
  N.posBegrens = (pos, vandaagWi) => Math.max(vandaagWi - 800, Math.min(vandaagWi + 800, pos));
  // De rasterstap bij het slepen en uittrekken van een planblok: 15 minuten vanaf 60 pixels per uur (dagweergave), anders 30 (3 dagen); in de weekweergave is er geen uurraster maar een dagdeel
  N.snapMin = ppd => (ppd / UH() >= 60 ? 15 : 30);
  N.snap = (min, stap) => Math.round(min / stap) * stap;
  // Een plek (pixels in de strook van een persoon, vanaf de eerste getekende dag) naar werkdag-index en minuten in de dag
  N.plekNaarTijd = (px, ppd, stap, grijp) => {
    const x = px - (grijp || 0), k = Math.floor(x / ppd), min = U0 + (x - k * ppd) / ppd * (U1 - U0);
    return { k, min: Math.max(U0, Math.min(U1 - stap, N.snap(min, stap))) };
  };
  // Een blok van `start` (minuten) en `duur` tegen de as: links en breedte in pixels (binnen de as geknipt)
  N.blokPx = (k, start, eind, ppd) => { const a = Math.max(U0, start), e = Math.min(U1, Math.max(a + 15, eind)); return { left: k * ppd + (a - U0) / (U1 - U0) * ppd, width: Math.max(3, (e - a) / (U1 - U0) * ppd) }; };
  // Uittrekken: de nieuwe start en duur van een blok na een sleep van dMin minuten aan de rechter (eind) of linker (start) rand. Minimaal één rasterstap, binnen de as.
  N.uittrek = (start, duur, kant, dMin, stap) => {
    const eind = start + duur;
    if (kant === 'eind') { const e = Math.max(start + stap, Math.min(U1, N.snap(eind + dMin, stap))); return { start, duur: e - start }; }
    const s = Math.min(eind - stap, Math.max(U0, N.snap(start + dMin, stap))); return { start: s, duur: eind - s };
  };
  // Het etiket boven de tijdas: titel en subtitel voor het venster van `eerste` t/m `laatste` (datums van de zichtbare werkdagen) met `midden` in het midden
  const hoofdletter = s => s.charAt(0).toUpperCase() + s.slice(1);
  N.titelVoor = function (zoom, eerste, laatste, midden) {
    if (zoom === 'week') return { titel: 'Week ' + isoWeek(monday(midden)), sub: dagMnd(eerste) + ' – ' + dagMnd(laatste) };
    if (zoom === 'maand') { const a = Number(eerste.slice(5, 7)) - 1, b = Number(laatste.slice(5, 7)) - 1; return { titel: a === b ? hoofdletter(MNDLANG[a]) : hoofdletter(MNDLANG[a]) + ' – ' + MNDLANG[b], sub: 'week ' + isoWeek(eerste) + '–' + isoWeek(laatste) }; }
    if (zoom === 'kwartaal') return { titel: Math.max(1, Math.round((nr(laatste) - nr(eerste) + 1) / 7)) + ' weken', sub: 'week ' + isoWeek(eerste) + '–' + isoWeek(laatste) + ' · ' + dagMnd(eerste) + ' – ' + dagMnd(laatste) };
    if (zoom === '3d') return { titel: DAGKORT[wd(nr(eerste))] + ' ' + dagMnd(eerste) + ' – ' + DAGKORT[wd(nr(laatste))] + ' ' + dagMnd(laatste), sub: 'week ' + isoWeek(eerste) + ' · ' + hhmm(U0) + '–' + hhmm(U1) };
    return { titel: hoofdletter(DAGLANG[wd(nr(eerste))]) + ' ' + dagMnd(eerste), sub: 'week ' + isoWeek(eerste) + ' · ' + hhmm(U0) + '–' + hhmm(U1) };
  };
  // De as van een dag volgt de werktijden van het team: minstens 07:00-17:00, ruimer als iemand eerder begint of later eindigt (hele uren). Alleen rekenwerk; zonder werktijden blijft het 07:00-17:00.
  const werkMap = () => { try { return P.werktijdenMap && D.werktijden ? P.werktijdenMap(D.werktijden()) : {}; } catch (e) { return {}; } };
  function bepaalUren() {
    let a = 420, e = 1020;
    try { Object.values(werkMap()).forEach(rec => { (P.WERKTIJD_DAGEN || []).forEach(k => { const x = rec.dagen && rec.dagen[k]; if (!x || !x.werk) return; const s = tijdMin(x.start), z = tijdMin(x.eind); if (s !== null && z !== null && z > s) { a = Math.min(a, Math.floor(s / 60) * 60); e = Math.max(e, Math.ceil(z / 60) * 60); } }); }); } catch (x) {}
    U0 = Math.max(300, a); U1 = Math.min(1320, e);
  }
  N.bepaalUren = bepaalUren; N.as = () => ({ U0, U1 });
  // Het werkvenster van deze persoon op deze weekdag (wdIdx 0 = maandag): { a, e } in minuten, { vrij: true } als hij die dag niet werkt, of null zonder werktijden-record
  N.werkVenster = function (slug, wdIdx) {
    const rec = werkMap()[String(slug || '').toLowerCase()]; if (!rec) return null;
    const x = rec.dagen && rec.dagen[(P.WERKTIJD_DAGEN || [])[wdIdx]]; if (!x || !x.werk) return { vrij: true };
    const a = tijdMin(x.start), e = tijdMin(x.eind); return a === null || e === null || e <= a ? null : { a, e };
  };

  // ── rekenwerk (geen DOM) ──
  // Een venster van `weken` weken vanaf de maandag `van`, in stukken van maximaal 6 weken (zo veel rekent weekRooster in één keer) samengevoegd.
  // C1: de stukken van zes weken liggen vast op een raster (week-nummer deelbaar door 6) en worden onthouden, zodat schuiven en zoomen niet bij elke beweging opnieuw rekent. N.teken()
  // (een verandering in de gegevens, een filter) wist het geheugen; het schuiven en zoomen zelf niet. Met een extra weekenddag (alleen "Naar de dag") wordt niet onthouden.
  const stukken = new Map();
  N.cacheWis = () => stukken.clear();
  const stuk = (vanMa, o) => {
    const sl = vanMa + '|' + (o.project || '') + '|' + P.vandaagYmd(); let s = stukken.get(sl);
    if (!s) { const opt = Object.assign({}, o, { vandaag: vanMa, weken: 6, wachtVandaag: P.vandaagYmd() }); s = { cap: P.teamCapaciteit(D.taken(), D.afhank(), D.blokken(), opt), rr: P.weekRooster(D.taken(), D.afhank(), D.blokken(), opt), n: 6 }; if (stukken.size > 40) stukken.clear(); stukken.set(sl, s); }
    return s;
  };
  function rooster(van, weken, o) {
    if (o && Array.isArray(o.extra) && o.extra.length) return roosterVan(van, weken, o);
    const wk = Math.floor((nr(van) - 4) / 7), w0 = Math.floor(wk / 6) * 6, delen = [];
    for (let w = w0; w < wk + weken; w += 6) delen.push(stuk(ymd(4 + w * 7), o));
    const r = voegSamen(delen, o), a = wk - w0;
    if (!a && r.dagen.length === weken * 5) return r;
    const snij = (arr, k, l) => arr.slice(k, l);   // alleen de gevraagde weken (de stukken zijn op het raster gelegd)
    return { dagen: snij(r.dagen, a * 5, (a + weken) * 5).map(d => Object.assign({}, d, { week: d.week - a })), rijen: r.rijen.map(t => Object.assign({}, t, { dagen: snij(t.dagen, a * 5, (a + weken) * 5), weken: snij(t.weken, a, a + weken), slots: snij(t.slots, a * 5, (a + weken) * 5) })) };
  }
  function roosterVan(van, weken, o) {
    const delen = [];
    for (let w = 0; w < weken; w += 6) {
      const n = Math.min(6, weken - w), opt = Object.assign({}, o, { vandaag: plusDagen(van, w * 7), weken: n, wachtVandaag: P.vandaagYmd() });
      delen.push({ cap: P.teamCapaciteit(D.taken(), D.afhank(), D.blokken(), opt), rr: P.weekRooster(D.taken(), D.afhank(), D.blokken(), opt), n });
    }
    return voegSamen(delen, o);
  }
  function voegSamen(delen, o) {
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

  const roosterOpties = st => ({ team: D.team() || [], vrij: D.vrij ? D.vrij() : null, verlof: D.verlof ? D.verlof() : null, werkuren: D.werkuren ? D.werkuren() : null, werktijden: D.werktijden ? D.werktijden() : null, project: st.project || '' });
  // Na het tekenen alvast de stukken van zes weken vóór en na het beeld rekenen (één per keer, in de pauzes): over de grens van een stuk schuiven kost dan geen beeld.
  function voorLaad(m) {
    clearTimeout(S.vlT);
    const wk0 = Math.floor(m.d0w / 5), wk1 = wk0 + m.weken - 1, lijst = [Math.floor(wk1 / 6) * 6 + 6, Math.floor(wk0 / 6) * 6 - 6];
    let i = 0;
    const stap = () => { if (i >= lijst.length || gebaarActief() || !S.V) return; const w = lijst[i++]; try { stuk(ymd(4 + w * 7), roosterOpties(S)); } catch (e) {} S.vlT = setTimeout(stap, 40); };
    S.vlT = setTimeout(stap, 150);
  }
  // De Ongepland-lijst (taken zonder datum en voorstellen), gefilterd op project en persoon. Los van het venster: het schuiven en zoomen hoeft dit niet opnieuw te rekenen.
  function ongeplandVoor(st, team, o) {
    const og = ongepland({ team, vrij: o.vrij, verlof: o.verlof, project: st.project || '' });
    if (st.persoon) { og.items = og.items.filter(x => { const sl = Object.keys(D.taken() || {}).find(c => String(c).toLowerCase() === String(x.code).toLowerCase()); const t = sl ? (D.taken()[sl] || []).find(y => y && y.id === x.id) : null; return t && P.taakMensen(t).some(p => P.zelfdePersoon(p, st.persoon, team)); }); og.min = og.items.reduce((s, x) => s + x.min, 0); }
    return og;
  }
  // st.d0 en st.d1 (werkdag-indexen, d1 niet meegeteld) vragen een venster op de doorlopende tijdas: de weken eromheen worden gerekend, m.venster zegt welke dagen (indexen in m.dagen) in beeld zijn en
  // m.d0w is de werkdag-index van m.dagen[0]. Zonder d0/d1 geldt de snelkeuze (st.zoom + st.anker) precies zoals voorheen.
  N.model = function (st) {
    st = Object.assign({}, S, st || {});
    const today = P.vandaagYmd(), zoom = st.zoom, anker = st.anker || today;
    const team = D.team() || [], o = roosterOpties(st);
    let van, weken, zichtbaar, venster = null, d0w = null;
    const weekendDag = zoom === 'dag' && st.exactDag && P.isYmd(anker) && ((wd(nr(anker)) + 6) % 7) > 4;   // alleen na "Naar de dag" (exactDag) op een zaterdag of zondag (Afwijkingen: iemand werkte toch): precies die dag, als extra kolom. Gewoon bladeren of Vandaag op een weekend springt nog naar de maandag.   // zichtbaar = de datums die getekend worden
    const vrijVenster = Number.isFinite(st.d0) && Number.isFinite(st.d1) && !weekendDag;
    if (vrijVenster) {
      const a = Math.floor(st.d0), b = Math.max(a + 1, Math.ceil(st.d1)), w0 = Math.floor(a / 5), w1 = Math.floor((b - 1) / 5);
      d0w = w0 * 5; van = datumVanWi(d0w); weken = Math.min(MAX_DAGEN_ZICHT / 5 + 2, w1 - w0 + 1);
      venster = []; for (let d = a; d < Math.min(b, d0w + weken * 5); d++) venster.push(d - d0w);
      if (zoom === '3d' || zoom === 'dag') zichtbaar = venster.map(i => datumVanWi(d0w + i));
    }
    else if (zoom === 'week') { van = monday(anker); weken = 1; }
    else if (zoom === 'maand') { van = monday(anker); weken = 4; }
    else if (zoom === 'kwartaal') { van = monday(anker); weken = 13; }
    else {
      const s0 = weekendDag ? anker : volgendeWerkdag(anker, 1); van = monday(s0); zichtbaar = [s0]; weken = 1; if (weekendDag) o.extra = [anker];
      if (zoom === '3d') { let d = s0; for (let i = 0; i < 2; i++) { d = plusWerkdagen(d, 1); zichtbaar.push(d); } weken = Math.ceil((nr(zichtbaar[2]) - nr(van) + 1) / 7); }
    }
    const r = rooster(van, weken, o);
    const dagIdx = zichtbaar ? (vrijVenster ? venster.slice() : zichtbaar.map(d => r.dagen.findIndex(x => x.datum === d))) : null;
    if (!venster) venster = dagIdx ? dagIdx.slice() : r.dagen.map((d, i) => i);
    if (d0w === null) d0w = wiVan(van);
    let rijen = r.rijen; if (st.persoon) rijen = rijen.filter(x => x.slug === st.persoon);
    const m = { zoom, today, anker, van, weken, dagen: r.dagen.map(d => Object.assign({}, d, { nu: d.datum === today })), dagIdx, venster, d0w, weekend: weekendDag, rijen, project: st.project, persoon: st.persoon };
    m.ongepland = st.ongepland || ongeplandVoor(st, team, o);
    // periodetitel
    const eerste = m.dagen[venster[0]].datum, laatste = m.dagen[venster[venster.length - 1]].datum;
    if (vrijVenster) Object.assign(m, N.titelVoor(zoom, eerste, laatste, m.dagen[venster[Math.floor((venster.length - 1) / 2)]].datum));
    else if (zoom === 'week') { m.titel = 'Week ' + isoWeek(van); m.sub = dagMnd(van) + ' – ' + dagMnd(plusDagen(van, 4)); }
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
  const openItem = (it, bron) => {
    const bid = it ? blokIdVan(it) : null;   // een planblok (los, of als blok van een taak): het planblokpaneel (alleen lezen); een taakbalk zonder blok: het taakpaneel
    if (bid && D.openBlok) D.openBlok(bid, bron);
    else if (D.openTaak && it && it.soort === 'taak' && it.id != null && it.code) D.openTaak(it.code, it.id, bron); else open(it && it.code);
  };
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
    node.addEventListener('dragstart', ev => { S.sleep = bron; S.grijp = Math.max(0, (ev.clientX || 0) - node.getBoundingClientRect().left); node.classList.add('sleept'); try { ev.dataTransfer.setData('text/plain', tekst || ''); ev.dataTransfer.effectAllowed = 'move'; } catch (e) {} });
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
  // Loslaten op een tijdbalk: de dag volgt uit de plek op de balk, de tijd uit de plek binnen de dag, gerasterd op V.snap minuten (15 bij de dagweergave, 30 bij 3 dagen). Een bestaand blok begint waar
  // zijn linkerrand komt (de plek waar je het vastpakte telt mee), niet waar de muis is.
  function urenDoel(raster, dagen, ev, V) {
    const r = raster.getBoundingClientRect(); if (!r.width || !dagen.length) return null;
    const px = ev.clientX - r.left, grijp = S.sleep && S.sleep.soort === 'verplaats' ? (S.grijp || 0) : 0;
    const t = N.plekNaarTijd(px, V.ppd, V.snap, grijp), k = Math.max(0, Math.min(dagen.length - 1, t.k));
    const min = t.k < 0 ? U0 : t.k >= dagen.length ? U1 - V.snap : t.min;
    return { datum: dagen[k], start: hhmm(min), minuut: min, kolom: k };
  }

  // Eén planblok (getint per project; een open voorstel is gestippeld met een chip; een wachtende taak toont dat)
  function blok(it, uur, stijl) {
    const voorstel = N.isVoorstel(it), wacht = !!(it.wacht && it.status !== 'klaar'), sleep = N.sleepbaar(it), bid = blokIdVan(it), taakSleep = !sleep && N.taakSleepbaar(it), taakBron = { soort: 'taakbalk', taak: { code: it.code, id: it.id, naam: it.naam, voorstel: false }, van: it.persoon || '', vanDatum: it.datum || '' }, mijlpaal = !!(it.taak && it.taak.soort === 'mijlpaal');
    const sub = el('span', { klass: 'cn-blok-sub' }, el('span', { klass: 'cn-code', tekst: projNr(it.code) }), ' ' + projNaam(it.code), it.min && !uur ? ' · ' + uren(it.min) : '');
    const b = el('div', { role: 'button', tabindex: '0', klass: 'cn-blok' + (voorstel ? ' voorstel' : '') + (wacht ? ' wacht' : '') + (sleep || taakSleep ? ' sleepbaar' : ''), 'data-taak': taakSleep ? String(it.id) : null, 'data-code': taakSleep ? String(it.code) : null, 'data-pf-taak': it.soort === 'taak' ? String(it.id) : null, 'data-pf-code': it.soort === 'taak' ? String(it.code) : null, 'data-blok': sleep ? String(bid) : null, 'aria-keyshortcuts': taakSleep ? 'ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight Alt+Shift+ArrowLeft Alt+Shift+ArrowRight' : null, style: '--block-color:' + P.projectKleur(it.code), title: [it.naam, projNr(it.code) + ' ' + projNaam(it.code), it.min ? uren(it.min) : '', voorstel ? 'voorstel' : '', wacht ? ('wacht' + (it.wachtTekst ? ': ' + it.wachtTekst : '')) : '', it.waarschuwing || '', it.nietEenduidig ? 'niet eenduidig aan een taak gekoppeld (hetzelfde taak-id staat in meer dan één project)' : ''].filter(Boolean).join(' · ') },
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
        sleepBron({ soort: 'taakrand', kant, taak: taakBron.taak, van: it.persoon || '', gezien: { start: (it.taak && it.taak.start) || '', eind: (it.taak && it.taak.eind) || '' } }, g, it.naam); g.addEventListener('dragstart', ev => ev.stopPropagation());   // de greep sleept alleen de rand, niet de hele balk
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
  }  const persoonKop = (r, tekst, over, balk, badge) => el('div', { klass: 'cn-persoon' }, badge || null,
    el('div', { klass: 'cn-pkop' }, el('span', { klass: 'cn-avatar', tekst: ini(r.naam) }), el('span', { klass: 'cn-pnaam' }, el('b', { tekst: r.naam }), r.heeftCap ? null : el('span', { klass: 'cn-sub', tekst: 'zonder eigenaar of niet in het team' }))),
    tekst ? el('span', { klass: 'cn-vrij' + (over ? ' over' : ''), tekst }) : null, balk || null);
  const laadBalk = (gepl, cap, over) => el('span', { klass: 'cn-laad', role: 'img', 'aria-label': 'gepland ' + uren(gepl) + ' van ' + uren(cap) }, el('span', { style: 'width:' + (cap > 0 ? Math.min(100, Math.round(gepl / cap * 100)) : 0) + '%', klass: over ? 'over' : '' }));

  // ── C2: stapelen en de belasting per persoon ──
  // Stapelen: taken die elkaar overlappen bij dezelfde persoon staan in banen onder elkaar (een taak houdt dezelfde baan over de dagen); er zijn er MAX_STAPEL zichtbaar, de rest zit achter "+N meer".
  const MAX_STAPEL = 4;
  const itemSleutel = it => (it.soort || '') + '|' + String(it.code == null ? '' : it.code).toLowerCase() + '|' + String(it.id);
  N.MAX_STAPEL = MAX_STAPEL; N.itemSleutel = itemSleutel;
  N.banen = function (perDag) {   // perDag: per dag een lijst items -> { dagen: per dag [{ it, lane }], banen }
    const toe = new Map(); let max = 0;
    const dagen = perDag.map(items => {
      const bezet = new Set(), res = items.map(it => { const l = toe.get(itemSleutel(it)); if (l !== undefined && !bezet.has(l)) { bezet.add(l); return { it, lane: l }; } return { it, lane: -1 }; });
      res.forEach(x => { if (x.lane >= 0) return; let l = 0; while (bezet.has(l)) l++; bezet.add(l); x.lane = l; toe.set(itemSleutel(x.it), l); });
      res.forEach(x => { if (x.lane + 1 > max) max = x.lane + 1; });
      return res;
    });
    return { dagen, banen: max };
  };
  // Belasting = beschikbaar min gepland over de dagen idx van rij r. Beschikbaar is de capaciteit van die persoon per dag (zijn werktijden, min verlof en vrije dagen), gepland de raming per dag zoals
  // MTPlanning.weekRooster die verdeelt (taakVerdeling over echte werkdagen, planblokken zonder dubbeltelling met hun taak, een open voorstel telt niet): dezelfde getallen als Mijn werk en de weekbezetting,
  // zonder afronding op dagdelen. Het saldo is netto over de periode: wat een taak binnen haar datums vrij verdeelbaar maakt.
  const uurTekst = min => { const n = Math.max(0, Math.round(min)), h = Math.floor(n / 60), r = n % 60; return h && r ? h + ' u ' + r + ' min' : h ? h + ' u' : r ? r + ' min' : '0 u'; };
  N.uurTekst = uurTekst;
  N.belasting = function (r, idx) {
    let cap = 0, gepl = 0; const per = new Map(), dagen = [];
    idx.forEach(i => {
      const c = r.dagen[i]; if (!c) return;
      cap += c.cap_min; gepl += c.gepland_min;
      dagen.push({ datum: c.datum, cap: c.cap_min, gepl: c.gepland_min, verlof: !!c.verlof, werkdag: !!c.werkdag, werktNiet: !!c.werktNiet });
      (c.items || []).forEach(it => {
        if (it.planvoorstel) return; const min = Math.round(it.min || 0); if (min <= 0) return;
        const k = itemSleutel(it), x = per.get(k) || { naam: it.naam, code: it.code, soort: it.soort, min: 0 }; x.min += min; per.set(k, x);
      });
    });
    const items = [...per.values()].sort((a, b) => b.min - a.min || String(a.naam).localeCompare(String(b.naam)));
    return { cap, gepl, saldo: cap - gepl, dagen, items };
  };
  N.belastingTekst = function (saldo) {
    const s = Math.round(saldo);
    if (s > 0) return { tekst: uurTekst(s) + ' over', staat: 'over' };
    if (s === 0) return { tekst: '0 u over', staat: 'nul' };
    return { tekst: uurTekst(-s) + ' te veel', staat: 'teveel' };
  };
  // De periode waar het getal bij de naam over gaat: de week in het midden van beeld (kwartaal, maand en week) of de dag in het midden (3 dagen en dag)
  function belastingPeriode(V) {
    const m = V.m, mid = V.venster[Math.floor((V.venster.length - 1) / 2)];
    if (V.teken === 'uren' || m.weekend) return { idx: [mid], label: DAGLANG[wd(nr(m.dagen[mid].datum))] + ' ' + dagMnd(m.dagen[mid].datum) };
    const w0 = Math.floor(mid / 5) * 5, idx = []; for (let i = w0; i < w0 + 5 && i < m.dagen.length; i++) idx.push(i);
    return { idx, label: 'week ' + isoWeek(m.dagen[idx[0]].datum) + ' (' + dagMnd(m.dagen[idx[0]].datum) + ' – ' + dagMnd(m.dagen[idx[idx.length - 1]].datum) + ')' };
  }
  function belastingEl(V, r) {
    if (!r.heeftCap) return null;
    const p = belastingPeriode(V), b = N.belasting(r, p.idx), t = N.belastingTekst(b.saldo), metRec = !!werkMap()[String(r.slug || '').toLowerCase()];
    const dagTekst = b.dagen.map(d => DAGKORT[wd(nr(d.datum))] + ' ' + (d.verlof ? 'verlof' : !d.werkdag ? 'vrij' : d.werktNiet ? 'werkt niet' : uurTekst(d.cap))).join(' · ');
    const rijen = b.items.slice(0, 12).map(x => el('div', { klass: 'cn-bpop-rij' }, el('span', { klass: 'cn-bpop-naam' }, el('span', { klass: 'cn-code', tekst: x.code ? projNr(x.code) : '' }), ' ' + x.naam), el('span', { klass: 'cn-num', tekst: uurTekst(x.min) })));
    if (b.items.length > 12) rijen.push(el('div', { klass: 'cn-bpop-sub', tekst: '… en ' + (b.items.length - 12) + ' andere' }));
    const pop = el('div', { klass: 'cn-bpop', role: 'tooltip', hidden: true },
      el('b', { tekst: r.naam + ' · ' + p.label }),
      el('div', { klass: 'cn-bpop-reg' }, el('span', { tekst: 'Beschikbaar' }), el('span', { klass: 'cn-num', tekst: uurTekst(b.cap) })),
      el('div', { klass: 'cn-bpop-sub', tekst: dagTekst + (metRec ? ' (volgens de werktijden)' : ' (geen werktijden ingevuld: werkuren per week gedeeld door 5)') }),
      el('div', { klass: 'cn-bpop-reg' }, el('span', { tekst: 'Gepland' }), el('span', { klass: 'cn-num', tekst: uurTekst(b.gepl) })),
      rijen.length ? el('div', { klass: 'cn-bpop-lijst' }, rijen) : el('div', { klass: 'cn-bpop-sub', tekst: 'Niets gepland in deze periode.' }),
      el('div', { klass: 'cn-bpop-reg tot ' + t.staat }, el('span', { tekst: 'Beschikbaar − gepland' }), el('span', { klass: 'cn-num', tekst: (b.saldo < 0 ? '−' : '') + uurTekst(Math.abs(b.saldo)) + (b.saldo < 0 ? ' (te veel)' : ' (over)') })));
    const badge = el('button', { type: 'button', klass: 'cn-bbadge ' + t.staat, 'aria-expanded': 'false', 'aria-label': 'Belasting van ' + r.naam + ', ' + p.label + ': ' + t.tekst + '. Activeer voor de opbouw.' }, el('span', { tekst: t.tekst }));
    let open = false, vast = false;
    const buiten = ev => { if (!badge.contains(ev.target) && !pop.contains(ev.target)) verberg(); };
    const toon = () => {
      if (open) return; if (S.popOpruim && S.popOpruim !== verberg) S.popOpruim(); S.popOpruim = verberg; open = true; pop.hidden = false; D.doc.body.appendChild(pop);
      const br = badge.getBoundingClientRect(), g = D.doc.defaultView, pw = pop.offsetWidth, ph = pop.offsetHeight;
      let y = br.bottom + 6; if (g && y + ph > g.innerHeight - 8) y = Math.max(8, br.top - ph - 6);
      pop.style.left = Math.max(8, Math.min(br.left, (g ? g.innerWidth : 1000) - pw - 8)) + 'px'; pop.style.top = y + 'px'; badge.setAttribute('aria-expanded', 'true');
    };
    function verberg() { if (!open) return; open = false; vast = false; if (pop.parentNode) pop.parentNode.removeChild(pop); badge.setAttribute('aria-expanded', 'false'); D.doc.removeEventListener('pointerdown', buiten, true); }
    badge.addEventListener('mouseenter', toon); badge.addEventListener('focus', toon);
    badge.addEventListener('mouseleave', () => { if (!vast) verberg(); }); badge.addEventListener('blur', () => { if (!vast) verberg(); });
    badge.addEventListener('click', ev => { ev.stopPropagation(); if (vast) verberg(); else { toon(); vast = true; D.doc.addEventListener('pointerdown', buiten, true); } });
    badge.addEventListener('keydown', ev => { if (ev.key === 'Escape') verberg(); });
    return badge;
  }
  // "+N meer" / "minder": de rij uitklappen of weer terug naar MAX_STAPEL banen
  const meerKnop = (tekst, open, sleutel, stijl) => el('button', { type: 'button', klass: 'cn-meer' + (stijl ? ' chip' : ''), style: stijl || null, 'aria-expanded': open ? 'true' : 'false', tekst, klik: ev => { ev.stopPropagation(); S.meer[sleutel] = !open; N.vlakTeken(true); } });
  const stapelEl = (items, sleutel, maak) => {   // items onder elkaar, maximaal MAX_STAPEL, dan een knop
    const open = !!S.meer[sleutel], toon = open ? items : items.slice(0, MAX_STAPEL), rest = items.length - toon.length, uit = toon.map(maak);
    if (rest > 0) uit.push(meerKnop('+' + rest + ' meer', false, sleutel)); else if (open && items.length > MAX_STAPEL) uit.push(meerKnop('minder', true, sleutel));
    return uit;
  };
  // Een rand van een taakbalk in de uurweergave slepen (hele dagen): de datum van de rand wordt de dag waar je loslaat, via dezelfde taakroute (spec taakrand) als de grepen van de weekweergave
  function dagGreep(w, bl, kant, ctx) {
    const g = el('span', { klass: 'cn-greep d ' + (kant === 'eind' ? 'r' : 'l'), 'aria-hidden': 'true', title: kant === 'eind' ? 'Sleep om de einddatum te verplaatsen (hele dagen)' : 'Sleep om de startdatum te verplaatsen (hele dagen)' });
    g.addEventListener('pointerdown', ev => {
      if ((ev.pointerType === 'mouse' && ev.button !== 0) || S.bezig) return;
      ev.preventDefault(); ev.stopPropagation();
      const x0 = ev.clientX, l0 = parseFloat(w.style.left), w0 = parseFloat(w.style.width), tip = el('span', { klass: 'cn-greep-tip' });
      let dd = 0; bl.setAttribute('draggable', 'false'); w.classList.add('uitrekt'); w.appendChild(tip); S.gebaar = Date.now();
      try { g.setPointerCapture(ev.pointerId); } catch (e) {}
      const verplicht = (() => { try { return P.vrijSet(D.vrij ? D.vrij() : null); } catch (e) { return new Set(); } })();   // wat je ziet is wat er wordt opgeslagen: een weekend of verplichte vrije dag schuift naar de eerstvolgende (start) of vorige (eind) werkdag
      const doel = () => { let wi = wiVan(ctx.datum) + dd, d = datumVanWi(wi); for (let i = 0; i < 30 && verplicht.has(d); i++) { wi += kant === 'eind' ? -1 : 1; d = datumVanWi(wi); } return d; };
      const mv = e => {
        dd = Math.round((e.clientX - x0) / ctx.ppd);
        if (kant === 'eind') w.style.width = Math.max(8, w0 + dd * ctx.ppd) + 'px'; else { const nw = Math.max(8, w0 - dd * ctx.ppd); w.style.left = (l0 + w0 - nw) + 'px'; w.style.width = nw + 'px'; }
        tip.textContent = (kant === 'eind' ? 'tot ' : 'vanaf ') + P.datumKort(doel());
      };
      const klaar = e => {
        g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', klaar); g.removeEventListener('pointercancel', klaar);
        try { g.releasePointerCapture(ev.pointerId); } catch (x) {}
        bl.setAttribute('draggable', 'true'); w.classList.remove('uitrekt'); S.gebaar = 0; if (tip.parentNode) tip.parentNode.removeChild(tip);
        if (e.type === 'pointercancel' || dd === 0) { w.style.left = l0 + 'px'; w.style.width = w0 + 'px'; gebaarKlaar(); return; }
        S.focusTaak = String(ctx.taak.id); S.focusCode = String(ctx.taak.code);
        N.drop({ soort: 'taakrand', kant, taak: ctx.taak, van: ctx.van, datum: doel(), gezien: ctx.gezien });   // gezien: wat je bij het tekenen zag; is het intussen anders, dan wordt er niets overschreven
      };
      g.addEventListener('pointermove', mv); g.addEventListener('pointerup', klaar); g.addEventListener('pointercancel', klaar);
    });
    g.addEventListener('click', ev => ev.stopPropagation());
    bl.appendChild(g);
  }
  // ── de tijdlijn: rijen met links de persoon (blijft staan) en rechts een tijdkolom waarin een strook met de zichtbare dagen langs schuift (C1) ──
  // V = { m, ppd, Wv, kind, venster (indexen in m.dagen), snap }. Elke strook (.cn-strip) begint bij dezelfde werkdag (V.base) en wordt in plaats() met een transform op de positie gezet;
  // schuiven binnen een dag raakt dus geen DOM, en een nieuwe dag in beeld bouwt de stroken opnieuw op (zonder de gegevens opnieuw te rekenen).
  const rijEl = (kl, label, strip) => el('div', { klass: 'cn-rij ' + kl }, label, el('div', { klass: 'cn-lane' }, strip));
  const stripEl = (kl, breedte, stijl, ...kids) => el('div', { klass: 'cn-strip ' + kl, style: 'width:' + Math.round(breedte * 100) / 100 + 'px;' + (stijl || '') }, ...kids);
  const dagenVan = V => V.venster.map(i => V.m.dagen[i]);
  const asRij = (V, hoek, kl, hoogte, ...kids) => {
    const as = stripEl('cn-as ' + (kl || ''), V.breedte, 'height:' + hoogte + 'px', ...kids);
    as.setAttribute('tabindex', '0'); as.setAttribute('role', 'group'); as.setAttribute('aria-label', 'Tijdas. Pijl links en rechts schuiven, plus en min zoomen. Je kunt ook scrollen om te zoomen en de as slepen om te schuiven.');
    return rijEl('cn-as-rij', hoek, as);
  };

  function tekenWeek(V, rijen, wrap) {
    const m = V.m, venster = V.venster, dagen = dagenVan(V), kol = dagen.length, cols = 'grid-template-columns:repeat(' + kol + ',' + V.ppd + 'px)';
    wrap.appendChild(asRij(V, el('div', { klass: 'cn-hoek' }, el('span', { tekst: 'Team · ' + rijen.filter(r => r.heeftCap).length }), el('span', { tekst: 'ochtend / middag' })), 'cn-as-week', 40,
      dagen.map((d, k) => el('div', { klass: 'cn-dagkop' + (d.nu ? ' nu' : ''), style: 'left:' + k * V.ppd + 'px;width:' + V.ppd + 'px' }, el('b', { tekst: DAGKORT[wd(nr(d.datum))] }), ' ', el('span', { klass: 'cn-num', tekst: dagMnd(d.datum) })))));
    const wkIdx = Math.floor(venster[Math.floor((kol - 1) / 2)] / 5);   // de week in het midden van beeld geeft de weektotalen bij de naam
    rijen.forEach(r => {
      const w = r.weken[wkIdx] || r.weken[0] || { gepland_min: 0, cap_min: 0, over_min: 0 };
      const strip = stripEl('cn-week', V.breedte, cols);
      venster.forEach(i => {
        const c = r.dagen[i], d = m.dagen[i];
        const som = N.celSom(c);
        const cel = el('div', { klass: 'cn-cel' + (d.nu ? ' nu' : '') + (som.staat === 'vrij' ? ' vrij' : '') + (som.staat === 'over' ? ' over' : '') + (som.staat === 'vol' ? ' vol' : '') });
        cel.appendChild(el('div', { klass: 'cn-som' + (som.staat === 'over' ? ' over' : '') }, el('span', { tekst: som.sum }), som.over ? el('span', { tekst: som.over }) : null));
        if (c.verlof) cel.appendChild(el('div', { klass: 'cn-vrijtekst', tekst: 'Vrij (verlof)' }));
        else if (!c.werkdag) cel.appendChild(el('div', { klass: 'cn-vrijtekst', tekst: 'Vrije dag' }));
        if ((c.verlof || !c.werkdag) && r.slug) doelZone(cel, () => ({ persoon: r.slug, datum: c.datum, dagdeel: 0 }));   // loslaten mag, maar eerst een bevestiging (V.waarschuwing)
        else {   // wat de hele dag beslaat (in beide dagdelen) staat één keer bovenaan; de rest per dagdeel; elk stapeltje maximaal MAX_STAPEL
          const sl = r.slots[i] || [[], []], heel = sl[0].filter(x => sl[1].includes(x)), eigen = sl.map(l => l.filter(x => !heel.includes(x))), sk = (r.slug || '_') + '|' + c.datum;
          if (heel.length) cel.appendChild(el('div', { klass: 'cn-heel' }, el('span', { klass: 'cn-heel-kop', tekst: 'hele dag' }), stapelEl(heel, sk + '|h', it => blok(it))));
          eigen.forEach((lijst, dl) => { const slot = el('div', { klass: 'cn-slot' }, stapelEl(lijst, sk + '|' + dl, it => blok(it)), lijst.length ? null : el('div', { klass: 'cn-leeg', tekst: dl ? 'middag' : 'ochtend' })); if (r.slug) doelZone(slot, () => ({ persoon: r.slug, datum: c.datum, dagdeel: dl })); cel.appendChild(slot); });
        }
        if (c.verlof || !c.werkdag) (c.items || []).forEach(it => cel.appendChild(blok(it)));   // iets op een vrije dag niet laten verdwijnen
        strip.appendChild(cel);
      });
      wrap.appendChild(rijEl('cn-rij-week', persoonKop(r, r.heeftCap ? N.weekTekst(r, r.weken[wkIdx] ? wkIdx : 0) : '', w.over_min > 0, r.heeftCap ? laadBalk(w.gepland_min, w.cap_min, w.over_min > 0) : null, belastingEl(V, r)), strip));
    });
  }

  // De uurweergave (3 dagen en dag, en alles daartussen): een planblok staat op zijn echte begintijd en duur; een taak zonder tijd komt achter elkaar vanaf 08:00 (met ~). Buiten de werktijd van de
  // persoon is het gedimd. Het raster wordt fijner naarmate je verder inzoomt; slepen en uittrekken rasteren op V.snap minuten (15 bij de dagweergave, 30 bij drie dagen).
  const BAAN = 52, ALD = 28;   // hoogte van een baan voor een blok met tijd, en voor een dagbalk
  function uitrekGreep(w, bl, kant, ctx) {   // de rand van een planblok slepen = de begintijd of de duur wijzigen, via dezelfde route als verplaatsen (spec.duurMin)
    const g = el('span', { klass: 'cn-greep u ' + (kant === 'eind' ? 'r' : 'l'), 'aria-hidden': 'true', title: kant === 'eind' ? 'Sleep om het eind te verplaatsen (' + ctx.snap + ' min)' : 'Sleep om het begin te verplaatsen (' + ctx.snap + ' min)' });
    g.addEventListener('pointerdown', ev => {
      if ((ev.pointerType === 'mouse' && ev.button !== 0) || S.bezig) return;
      ev.preventDefault(); ev.stopPropagation();
      const x0 = ev.clientX, v0 = w.style.left, b0 = w.style.width, tijd = w.querySelector('.cn-tijd'), t0 = tijd ? tijd.textContent : '';
      let huidig = { start: ctx.start, duur: ctx.duur };
      bl.setAttribute('draggable', 'false'); w.classList.add('uitrekt'); S.gebaar = Date.now();
      try { g.setPointerCapture(ev.pointerId); } catch (e) {}
      const mv = e => {
        huidig = N.uittrek(ctx.start, ctx.duur, kant, (e.clientX - x0) / ctx.ppu * 60, ctx.snap);
        const p = N.blokPx(ctx.k, huidig.start, huidig.start + huidig.duur, ctx.ppd); w.style.left = (p.left + 1) + 'px'; w.style.width = Math.max(2, p.width - 2) + 'px';
        if (tijd) tijd.textContent = hhmm(huidig.start) + '–' + hhmm(huidig.start + huidig.duur);
      };
      const klaar = e => {
        g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', klaar); g.removeEventListener('pointercancel', klaar);
        try { g.releasePointerCapture(ev.pointerId); } catch (x) {}
        bl.setAttribute('draggable', 'true'); w.classList.remove('uitrekt'); S.gebaar = 0;
        if (e.type === 'pointercancel' || (huidig.start === ctx.start && huidig.duur === ctx.duur)) { w.style.left = v0; w.style.width = b0; if (tijd) tijd.textContent = t0; gebaarKlaar(); return; }
        N.drop({ soort: 'verplaats', blokId: ctx.blokId, persoon: ctx.persoon, datum: ctx.datum, start: hhmm(huidig.start), duurMin: huidig.duur });
      };
      g.addEventListener('pointermove', mv); g.addEventListener('pointerup', klaar); g.addEventListener('pointercancel', klaar);
    });
    g.addEventListener('click', ev => ev.stopPropagation());
    bl.appendChild(g);
  }
  function tekenUren(V, rijen, wrap) {
    const m = V.m, idx = V.venster, ppd = V.ppd, ppu = ppd / UH(), nd = idx.length, nu = D.nu(), breedte = V.breedte;
    // de as: dagnamen en de uren (fijner naarmate er meer ruimte is)
    const stapLabel = ppu >= 140 ? 15 : ppu >= 55 ? 30 : ppu >= 20 ? 60 : ppu >= 10 ? 120 : 240, tikken = [];
    idx.forEach((i, k) => { for (let t = Math.ceil(U0 / stapLabel) * stapLabel; t < U1; t += stapLabel) tikken.push(el('div', { klass: 'cn-tik' + (m.dagen[i].nu ? ' nu' : '') + (t === U0 ? ' eerste' : '') + (t % 60 ? ' deel' : ''), style: 'left:' + (k * ppd + (t - U0) / 60 * ppu).toFixed(1) + 'px', title: hhmm(t), tekst: t % 60 ? ':' + String(t % 60).padStart(2, '0') : (stapLabel >= 60 && ppu < 44 ? String(t / 60).padStart(2, '0') : hhmm(t)) })); });
    wrap.appendChild(asRij(V, el('div', { klass: 'cn-hoek' }, el('span', { tekst: 'Team · uren' })), 'cn-as-uren', 54,
      idx.map((i, k) => el('div', { klass: 'cn-dagkop2' + (m.dagen[i].nu ? ' nu' : ''), style: 'left:' + k * ppd + 'px;width:' + ppd + 'px' }, el('b', { tekst: DAGKORT[wd(nr(m.dagen[i].datum))] }), ' ', el('span', { klass: 'cn-num', tekst: dagMnd(m.dagen[i].datum) }))), tikken));
    const lijnen = 'repeating-linear-gradient(to right,var(--line-soft) 0 1px,transparent 1px ' + ppu.toFixed(2) + 'px)'
      + (ppu >= 50 ? ',repeating-linear-gradient(to right,color-mix(in srgb,var(--line-soft) 55%,transparent) 0 1px,transparent 1px ' + (ppu / 2).toFixed(2) + 'px)' : '')
      + (ppu >= 110 ? ',repeating-linear-gradient(to right,color-mix(in srgb,var(--line-soft) 30%,transparent) 0 1px,transparent 1px ' + (ppu / 4).toFixed(2) + 'px)' : '');
    rijen.forEach(r => {
      // Taken zonder tijd (de raming per dag) staan als dagbalken in banen bovenaan; planblokken met een tijd staan eronder op hun echte tijd (ook in banen). Maximaal MAX_STAPEL banen, de rest achter "+N meer".
      const dagItems = idx.map(i => ((r.dagen[i] || {}).items || [])), rijSl = r.slug || '_', uitg = !!S.meer[rijSl];
      const metTijd = dagItems.map(l => l.filter(it => tijdMin(it.start) !== null)), zonderTijd = dagItems.map(l => l.filter(it => tijdMin(it.start) === null));
      const per = idx.map((i, k) => ({ i, ...N.urenBlokken(metTijd[k]) })), alle = N.banen(zonderTijd);
      const bT = Math.max(1, ...per.map(p => p.banen)), dubbel = per.some(p => p.dubbel), zichtT = uitg ? bT : Math.min(bT, MAX_STAPEL), zichtA = uitg ? alle.banen : Math.min(alle.banen, MAX_STAPEL);
      const meerA = !uitg && alle.banen > zichtA, meerT = !uitg && bT > zichtT, kanMeer = alle.banen > MAX_STAPEL || bT > MAX_STAPEL;
      const tOff = zichtA ? zichtA * ALD + 6 + (meerA ? 20 : 0) : (meerA ? 20 : 0);
      const gepl = idx.reduce((s, i) => s + ((r.dagen[i] || {}).gepland_min || 0), 0), hoogte = tOff + zichtT * BAAN + 12 + (meerT ? 20 : 0);
      const raster = stripEl('cn-uren-raster', breedte, 'height:' + hoogte + 'px;background-image:' + lijnen + ';background-size:' + breedte + 'px 100%;background-repeat:no-repeat');
      per.forEach((p, k) => {
        const c = r.dagen[p.i], d = m.dagen[p.i], links = k * ppd, wdIdx = (wd(nr(d.datum)) + 6) % 7;
        raster.appendChild(el('span', { klass: 'cn-dagstreep', 'aria-hidden': 'true', style: 'left:' + links + 'px' }));
        const dim = (a, b, tekst) => raster.appendChild(el('div', { klass: 'cn-buiten', style: 'left:' + (links + a / (U1 - U0) * ppd).toFixed(1) + 'px;width:' + ((b - a) / (U1 - U0) * ppd).toFixed(1) + 'px', tekst: tekst || '' }));
        if (c.verlof || !c.werkdag) raster.appendChild(el('div', { klass: 'cn-uren-vrij', style: 'left:' + links + 'px;width:' + ppd + 'px', tekst: c.verlof ? 'Vrij (verlof)' : 'Vrije dag' }));
        else {
          const wv = r.slug ? N.werkVenster(r.slug, wdIdx) : null;   // buiten de werktijd van deze persoon gedimd (zonder rooster: niets)
          if (wv && wv.vrij) dim(0, U1 - U0, p.blokken.length ? '' : 'werkt niet');
          else if (wv) { if (wv.a > U0) dim(0, Math.min(U1, wv.a) - U0); if (wv.e < U1) dim(Math.max(U0, wv.e) - U0, U1 - U0); }
        }
        let verbA = 0, verbT = 0;
        alle.dagen[k].forEach(({ it, lane }) => {   // de dagbalken van taken zonder tijd
          if (lane >= zichtA) { verbA++; return; }
          const w = blok(it, uren(it.min || 0), 'position:absolute;left:' + (links + 1) + 'px;width:' + (ppd - 2) + 'px;top:' + (4 + lane * ALD) + 'px;height:' + (ALD - 4) + 'px'), bl = w.firstChild;
          w.classList.add('cn-alldag');
          if (bl && bl.hasAttribute('data-taak') && it.soort === 'taak' && !(it.taak && it.taak.soort === 'mijlpaal')) {   // de randen van een taakbalk: begin- en einddatum slepen (hele dagen)
            const taakB = { code: it.code, id: it.id, naam: it.naam, voorstel: false };
            const gezien = { start: (it.taak && it.taak.start) || '', eind: (it.taak && it.taak.eind) || '' };
            if (it.eerste) dagGreep(w, bl, 'start', { taak: taakB, van: it.persoon || '', datum: d.datum, ppd, gezien });
            if (it.laatste) dagGreep(w, bl, 'eind', { taak: taakB, van: it.persoon || '', datum: d.datum, ppd, gezien });
          }
          raster.appendChild(w);
        });
        if (verbA) raster.appendChild(meerKnop('+' + verbA + ' meer', false, rijSl, 'left:' + (links + 3) + 'px;top:' + (4 + zichtA * ALD) + 'px'));
        p.blokken.forEach(b => {
          if (b.lane >= zichtT) { verbT++; return; }
          const px = N.blokPx(k, b.start, b.eind, ppd), top = tOff + 6 + b.lane * BAAN;
          const w = blok(b.it, hhmm(b.start) + '–' + hhmm(b.eind) + (b.bij ? ' ~' : ''), 'position:absolute;left:' + (px.left + 1).toFixed(1) + 'px;width:' + Math.max(2, px.width - 2).toFixed(1) + 'px;top:' + top + 'px;height:' + (BAAN - 4) + 'px');
          const bl = w.firstChild, s0 = tijdMin(b.it.start);
          if (r.slug && !b.bij && s0 !== null && N.sleepbaar(b.it) && bl && bl.getAttribute('draggable') === 'true') {   // alleen een planblok met een echte begintijd: de randen zijn te slepen
            const ctx = { blokId: blokIdVan(b.it), persoon: r.slug, datum: d.datum, k, start: s0, duur: Math.max(0, Math.round(b.it.min || 0)) || (b.eind - b.start), ppd, ppu, snap: V.snap };
            uitrekGreep(w, bl, 'start', ctx); uitrekGreep(w, bl, 'eind', ctx);
            bl.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight');   // het toetsenbord: pijltje = een rasterstap verschuiven, Shift+pijltje = het eind een rasterstap verplaatsen
            bl.addEventListener('keydown', ev => {
              const pijl = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0; if (!pijl || ev.target !== bl || ev.ctrlKey || ev.metaKey || ev.altKey || S.bezig || N.mag() !== true) return;
              ev.preventDefault();
              let start = ctx.start, duur = ctx.duur;
              if (ev.shiftKey) duur = N.uittrek(start, duur, 'eind', pijl * V.snap, V.snap).duur; else start = Math.max(U0, Math.min(U1 - Math.max(duur, V.snap), start + pijl * V.snap));
              S.focusBlok = String(ctx.blokId); N.drop({ soort: 'verplaats', blokId: ctx.blokId, persoon: ctx.persoon, datum: ctx.datum, start: hhmm(start), duurMin: duur });
            });
          }
          raster.appendChild(w);
        });
        if (verbT) raster.appendChild(meerKnop('+' + verbT + ' meer', false, rijSl, 'left:' + (links + 3) + 'px;top:' + (tOff + 6 + zichtT * BAAN) + 'px'));
      });
      if (r.slug) {   // loslaten op een tijd: een lijntje toont waar het blok begint
        const marker = el('span', { klass: 'cn-dropmarker', hidden: true, 'aria-hidden': 'true' }, el('span', { klass: 'cn-dropmarker-tijd' })); raster.appendChild(marker);
        const dagenDatum = per.map(p => m.dagen[p.i].datum);
        doelZone(raster, ev => { const d = urenDoel(raster, dagenDatum, ev, V); return d ? { persoon: r.slug, datum: d.datum, start: d.start, _min: d.minuut, _k: d.kolom } : null; }, d => { if (!d) { marker.hidden = true; return; } marker.hidden = false; marker.style.left = (d._k * ppd + (d._min - U0) / (U1 - U0) * ppd).toFixed(1) + 'px'; marker.firstChild.textContent = d.start; });
      }
      // nu-lijn (alleen als vandaag in beeld is en de tijd binnen de as valt)
      const t = new Date(nu), tm = t.getHours() * 60 + t.getMinutes(), k = idx.findIndex(i => m.dagen[i].datum === m.today);
      if (k >= 0 && tm >= U0 && tm <= U1) raster.appendChild(el('span', { klass: 'cn-nu', 'aria-hidden': 'true', style: 'left:' + (k * ppd + (tm - U0) / (U1 - U0) * ppd).toFixed(1) + 'px' }));
      const open = !!S.agenda[r.slug || '_'];
      const label = el('div', { klass: 'cn-persoon enkel' }, belastingEl(V, r), el('div', { klass: 'cn-pkop' }, el('span', { klass: 'cn-avatar', tekst: ini(r.naam) }), el('span', { klass: 'cn-pnaam' }, el('b', { tekst: r.naam }), el('span', { klass: 'cn-vrij' + (dubbel ? ' over' : ''), tekst: dubbel ? 'dubbel geboekt' : uren(gepl) + ' gepland' }))),
        uitg && kanMeer ? meerKnop('minder', true, rijSl) : null,
        el('button', { type: 'button', klass: 'cn-agenda-knop', 'aria-expanded': open ? 'true' : 'false', title: 'Afspraken uit de agenda van ' + r.naam + ' (in aanbouw)', klik: () => { S.agenda[r.slug || '_'] = !open; bewaarAgenda(); N.vlakTeken(true); } }, 'Agenda', icoon(open ? 'M6 15l6-6l6 6' : 'M6 9l6 6l6-6')));
      wrap.appendChild(rijEl('cn-rij-uren', label, raster));
      if (open) wrap.appendChild(rijEl('cn-agenda-rij', el('div', { klass: 'cn-agenda-label', tekst: 'Agenda · ' + r.naam }), el('div', { klass: 'cn-agenda-strook' }, el('div', { klass: 'cn-agenda-tekst', tekst: 'Outlook-afspraken komen hier (in aanbouw)' }))));
    });
  }

  function tekenMaand(V, rijen, wrap) {
    const m = V.m, venster = V.venster, dagen = dagenVan(V), kol = dagen.length, cols = 'grid-template-columns:repeat(' + kol + ',' + V.ppd + 'px)';
    const kopWeken = [];   // per week het aantal zichtbare dagen: de weekkop beslaat die kolommen
    venster.forEach(i => { const w = Math.floor(i / 5), l = kopWeken[kopWeken.length - 1]; if (l && l.w === w) l.n++; else kopWeken.push({ w, n: 1, i }); });
    const dagnum = ppd => ppd >= 14;
    wrap.appendChild(asRij(V, el('div', { klass: 'cn-hoek' }, el('span', { tekst: 'Belasting per dag' })), 'cn-as-maand', 52,
      kopWeken.map(k => el('div', { klass: 'cn-weekkop', style: 'left:' + (venster.indexOf(k.i)) * V.ppd + 'px;width:' + k.n * V.ppd + 'px', tekst: k.n >= 3 || V.ppd >= 30 ? 'week ' + isoWeek(m.dagen[k.i].datum) : '' })),
      dagen.map((d, k) => dagnum(V.ppd) ? el('div', { klass: 'cn-dagnum' + (d.nu ? ' nu' : '') + (venster[k] % 5 === 0 ? ' eerste' : ''), style: 'left:' + k * V.ppd + 'px;width:' + V.ppd + 'px', tekst: String(Number(d.datum.slice(8))) }) : null)));
    rijen.forEach(r => {
      const cs = venster.map(i => r.dagen[i]);
      const over = cs.filter(c => c.over_min > 0).length, cap = cs.reduce((s, c) => s + c.cap_min, 0), gepl = cs.reduce((s, c) => s + c.gepland_min, 0);
      const label = el('div', { klass: 'cn-persoon enkel' }, belastingEl(V, r), el('div', { klass: 'cn-pkop' }, el('span', { klass: 'cn-avatar', tekst: ini(r.naam) }), el('span', { klass: 'cn-pnaam' }, el('b', { tekst: r.naam }), el('span', { klass: 'cn-vrij' + (over ? ' over' : ''), tekst: over ? over + (over === 1 ? ' dag over' : ' dagen over') : (r.heeftCap ? uren(Math.max(0, cap - gepl)) + ' vrij' : uren(gepl) + ' gepland'), title: '' }))));
      const strip = stripEl('cn-maand-strip', V.breedte, cols);
      venster.forEach((i, k) => {
        const c = r.dagen[i], d = m.dagen[i], pct = c.cap_min > 0 ? c.gepland_min / c.cap_min * 100 : (c.gepland_min ? 100 : 0), vrij = c.verlof || !c.werkdag;
        strip.appendChild(el('div', { klass: 'cn-mdag' + (d.nu ? ' nu' : '') + (i % 5 === 0 ? ' eerste' : '') + (vrij ? ' vrij' : ''), title: P.datumKort(c.datum) + ': ' + (c.verlof ? 'verlof' : !c.werkdag ? 'vrije dag' : uren(c.gepland_min) + ' van ' + uren(c.cap_min)) },
          vrij ? null : el('span', { klass: 'cn-mbalk' + (c.over_min > 0 ? ' over' : c.gepland_min > 0 && pct >= 100 ? ' vol' : ''), style: 'height:' + Math.max(c.gepland_min ? 8 : 0, Math.min(100, Math.round(pct))) + '%' }),
          !vrij && V.ppd >= 56 && c.gepland_min ? el('span', { klass: 'cn-mtekst' + (c.over_min > 0 ? ' over' : ''), tekst: uren(c.gepland_min) }) : null));
      });
      wrap.appendChild(rijEl('cn-rij-maand', label, strip));
    });
  }

  function tekenKwartaal(V, rijen, wrap) {
    const m = V.m, W = m.weken, wkPx = V.ppd * 5, cols = 'grid-template-columns:repeat(' + W + ',' + wkPx + 'px)', w0 = m.d0w / 5, stapLabel = Math.max(1, Math.ceil(46 / wkPx));
    const kop = [];
    for (let w = 0; w < W; w++) {
      const ma = plusDagen(m.van, w * 7), eerste = [0, 1, 2, 3, 4].map(k => plusDagen(ma, k)).find(d => d.slice(8) === '01'), mdag = eerste || ma, nieuweMaand = !!eerste || w === 0;   // de maandnaam staat boven de week waarin de 1e valt (en links in beeld)
      kop.push(el('div', { klass: 'cn-wk' + (ma <= m.today && m.today <= plusDagen(ma, 6) ? ' nu' : '') + (nieuweMaand ? ' mnd' : ''), style: 'left:' + w * wkPx + 'px;width:' + wkPx + 'px', title: dagMnd(ma) },
        el('span', { klass: 'cn-wk-mnd', tekst: nieuweMaand ? MND[Number(mdag.slice(5, 7)) - 1] + (mdag.slice(5, 7) === '01' ? ' ' + mdag.slice(0, 4) : '') : '' }), el('span', { klass: 'cn-wk-nr', tekst: (w0 + w) % stapLabel === 0 ? 'wk ' + isoWeek(ma) : '' })));
    }
    wrap.appendChild(asRij(V, el('div', { klass: 'cn-hoek' }, el('span', { tekst: 'Projecten per persoon' })), 'cn-as-kw', 46, kop));
    rijen.forEach(r => {
      const perWeek = []; for (let w = 0; w < W; w++) perWeek.push(r.dagen.slice(w * 5, w * 5 + 5));
      const spans = new Map();   // projectcode -> [eerste week, laatste week]
      perWeek.forEach((dg, w) => dg.forEach(c => (c.items || []).forEach(it => { if (!it.code) return; const s = spans.get(it.code) || [w, w]; s[0] = Math.min(s[0], w); s[1] = Math.max(s[1], w); spans.set(it.code, s); })));
      const balken = [...spans.entries()].sort((a, b) => a[1][0] - b[1][0] || (a[0] < b[0] ? -1 : 1));
      const raster = stripEl('cn-kw-raster', W * wkPx, cols);
      for (let w = 0; w < W; w++) { const wk = r.weken[w] || { gepland_min: 0, cap_min: 0, over_min: 0 }; raster.appendChild(el('div', { klass: 'cn-kw-laad', style: 'grid-row:1;grid-column:' + (w + 1), title: uren(wk.gepland_min) + ' van ' + uren(wk.cap_min) }, el('span', { klass: 'cn-kw-tekst' + (wk.over_min > 0 ? ' over' : ''), tekst: wk.gepland_min && wkPx >= 38 ? uren(wk.gepland_min) : '' }), el('span', { klass: 'cn-laad' }, el('span', { klass: wk.over_min > 0 ? 'over' : '', style: 'width:' + (wk.cap_min > 0 ? Math.min(100, Math.round(wk.gepland_min / wk.cap_min * 100)) : 0) + '%' })))); }
      balken.forEach(([code, [a, b]], i) => raster.appendChild(el('button', { type: 'button', klass: 'cn-blok cn-balk', style: '--block-color:' + P.projectKleur(code) + ';grid-row:' + (i + 2) + ';grid-column:' + (a + 1) + ' / ' + (b + 2), title: projNr(code) + ' ' + projNaam(code) + ' · week ' + isoWeek(plusDagen(m.van, a * 7)) + (a === b ? '' : ' t/m ' + isoWeek(plusDagen(m.van, b * 7))), klik: () => open(code) }, el('span', { klass: 'cn-blok-titel' }, el('span', { klass: 'cn-code', tekst: projNr(code) }), a === b ? '' : ' ' + projNaam(code)))));
      wrap.appendChild(rijEl('cn-rij-kw', el('div', { klass: 'cn-persoon enkel' }, belastingEl(V, r), el('div', { klass: 'cn-pkop' }, el('span', { klass: 'cn-avatar', tekst: ini(r.naam) }), el('span', { klass: 'cn-pnaam' }, el('b', { tekst: r.naam }), el('span', { klass: 'cn-sub', tekst: balken.length + (balken.length === 1 ? ' project' : ' projecten') })))), raster));
    });
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
  const naWijziging = () => { if (D.naWijziging) { try { D.naWijziging(); } catch (e) { console.warn('Capaciteit: verversen na een wijziging:', e); } } };
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
    try { return await N._drop(schoon); } finally { S.bezig = false; S.focusTaak = null; S.focusBlok = null; }
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
    N.teken(); naWijziging();   // de projecttabel en het taakpaneel tonen de nieuwe datums meteen
    if (r.tegelijk) { N.toast(r.tegelijk, null, true); return r; }   // iemand wijzigde tegelijk en won: de planning toont nu de samengevoegde stand; geen ongedaan maken
    const w = r.wijziging, wat = w.soort === 'taak' && !w.na.datum && w.voor && w.voor.start ? (w.naam || 'Taak') + ': datums gewist, de taak staat weer in Ongepland' : w.soort === 'taak' ? (w.naam || 'Taak') + ' → ' + persNaam(w.na.persoon) + (w.na.datum && w.voor && (w.voor.start !== w.na.datum || w.voor.eind !== w.na.eind) ? ', ' + P.datumKort(w.na.datum) + (w.na.eind && w.na.eind !== w.na.datum ? ' t/m ' + P.datumKort(w.na.eind) : '') : '') + (r.melding ? ' · ' + r.melding : '')
      : (w.naam || 'Planblok') + ' → ' + persNaam(w.na.persoon) + ', ' + P.datumKort(w.na.datum) + ' ' + w.na.start + (w.na.duurMin ? ' · ' + uren(w.na.duurMin) : '');
    if (!r.behouden) { N.toast('Iemand anders was net sneller met ' + (w.naam || 'dit blok') + ': jouw wijziging is niet bewaard.'); return r; }
    N.toast(wat + (r.opgeslagen ? '' : ' (alleen lokaal bewaard: SharePoint is niet bereikbaar)'), async () => {
      let h; try { h = await D.herstel(w, opt); } catch (e) { h = { ok: false, reden: 'Terugzetten mislukt: ' + ((e && e.message) || e) }; }
      N.teken();
      if (h && h.onzeker) { N.toast(h.reden, null, true); N.naOnzeker(h.onzeker); return; }
      N.toast(h && h.ok ? (h.tegelijk || 'Teruggezet') : ((h && h.reden) || 'Terugzetten lukt niet.'), null, !!(h && h.tegelijk));
      if (D.naHerstel) { try { D.naHerstel(); } catch (e) {} }
      naWijziging();
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
    const dagen = (m.venster ? m.venster.map(i => m.dagen[i]) : m.dagIdx ? m.dagIdx.map(i => m.dagen[i]) : m.dagen).filter(d => d.werkdag);
    if (bron.soort === 'taakbalk') { if (!dagen.length) return; N.drop({ soort: 'taakbalk', taak: bron.taak, van: bron.van, persoon: team[pi].slug, datum: dagen[0].datum }); return; }   // alleen de persoon verandert: de datums blijven
    const di = await dlg.choose({ title: titel, message: bron.naam + ' → ' + team[pi].naam + '\nKies de dag', choices: dagen.map(d => ({ label: P.datumKort(d.datum) })) }); if (di === null || di === undefined) return;
    if (bron.soort === 'nieuw') { N.drop({ soort: 'nieuw', taak: bron.taak, persoon: team[pi].slug, datum: dagen[di].datum }); return; }   // uit Ongepland: de taak begint op die dag (het moment doet er niet toe, het is een taakbalk)
    const uurZoom = S.zoom === '3d' || S.zoom === 'dag', opties = [{ label: 'Ochtend', sublabel: 'op de eerste vrije tijd', spec: { dagdeel: 0 } }, { label: 'Middag', sublabel: 'op de eerste vrije tijd', spec: { dagdeel: 1 } }];
    if (uurZoom) for (let t = Math.ceil(U0 / 30) * 30; t < U1; t += 30) opties.push({ label: hhmm(t), spec: { start: hhmm(t) } });
    const oi = await dlg.choose({ title: titel, message: bron.naam + ' → ' + team[pi].naam + ', ' + P.datumKort(dagen[di].datum) + '\nKies het moment', choices: opties.map(o => ({ label: o.label, sublabel: o.sublabel })) }); if (oi === null || oi === undefined) return;
    N.drop(Object.assign({}, bron.soort === 'nieuw' ? { soort: 'nieuw', taak: bron.taak } : { soort: 'verplaats', blokId: bron.blokId }, { persoon: team[pi].slug, datum: dagen[di].datum }, opties[oi].spec));
  }
  const HINT = { kwartaal: 'Elke balk is een project; de uren per week staan erboven', maand: 'Hoogte = belasting per dag · inzoomen voor de blokken', week: 'Getinte blokken per project · gestippeld = open voorstel', '3d': 'Blokken in uren · twee banen = dubbel geboekt', dag: 'Blokken in uren · de messing lijn is nu' };
  const GEBAAR = 'Scroll op de tijdas om te zoomen · sleep de as of de achtergrond om te schuiven';
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
  const LS_SCHAAL = 'mt-cap-schaal', LS_AGENDA = 'mt-cap-agenda';
  const bewaarAgenda = () => { try { D.storage && D.storage.setItem(LS_AGENDA, JSON.stringify(S.agenda)); } catch (e) {} };
  const vandaagWi = () => wiVan(P.vandaagYmd());
  // Naar een snelkeuze (de knoppen): de schaal en de plek volgen uit zoom + anker, zoals voorheen. Vanuit een vrije stand blijft het midden van wat je ziet het midden.
  N.zoom = function (z) {
    if (!ZOOM_UI || !ZOOMS.some(x => x[0] === z)) return;
    if (S.vrij && S.ppd > 0) {
      const mid = Math.floor(S.pos + (S.Wv / S.ppd) / 2);
      S.anker = datumVanWi(z === '3d' ? mid - 1 : mid);
    }
    S.vrij = false; S.exactDag = false; S.zoom = z; try { D.storage && (D.storage.setItem(LS_ZOOM, z), D.storage.removeItem(LS_SCHAAL)); } catch (e) {}
    duwPeriode(); N.teken();
  };
  N.stap = function (richting) {
    S.exactDag = false;
    if (S.vrij) {   // één eenheid van het niveau waarin je zit, vanaf waar je nu staat (ook halverwege een dag)
      S.pos = N.posBegrens(S.pos + richting * N.eenheid(S.zoom), vandaagWi()); N.vlakTeken(); N.stapStil(true); return;
    }
    const a = S.anker || P.vandaagYmd();
    S.anker = S.zoom === 'week' ? plusDagen(a, 7 * richting) : S.zoom === 'maand' ? plusDagen(a, 28 * richting) : S.zoom === 'kwartaal' ? plusDagen(a, 91 * richting) : S.zoom === '3d' ? plusWerkdagen(volgendeWerkdag(a, 1), 3 * richting) : plusWerkdagen(volgendeWerkdag(a, 1), richting);
    duwPeriode(); N.teken();
  };
  N.naarVandaag = function () {
    S.exactDag = false;
    if (S.vrij && S.ppd > 0) { const n = S.Wv / S.ppd; S.pos = N.posBegrens(vandaagWi() - Math.max(0, (n - 1) / 2), vandaagWi()); N.vlakTeken(); N.stapStil(true); return; }   // vandaag in het midden
    S.anker = P.vandaagYmd(); duwPeriode(); N.teken();
  };

  // ── gebaren: scrollen om te zoomen, slepen om te schuiven, knijpen op touch ──
  const gebaarOK = () => !!(S.V && S.vlak && D && D.doc.contains(S.vlak));
  const maakVrij = () => { if (!S.vrij) { S.vrij = true; S.exactDag = false; } };   // S.ppd en S.pos hold de snelkeuze die nu getekend staat
  N.stapStil = function (nu) {   // na een gebaar: het niveau-etiket, de datum aan de linkerrand en de link bijwerken (niet bij elke beweging)
    clearTimeout(S.stilT);
    const doe = () => { if (!S.vrij) return; S.anker = datumVanWi(Math.floor(S.pos)); duwPeriode(); try { D.storage && D.storage.setItem(LS_SCHAAL, String(Math.round(S.ppd / UH() * 10) / 10)); } catch (e) {} };
    if (nu) doe(); else S.stilT = setTimeout(doe, 300);
  };
  N.vraag = function () {   // tekenen hoogstens één keer per beeld
    if (S.raf) return;
    const run = () => { S.raf = 0; try { N.vlakTeken(); } catch (e) { console.warn('Capaciteit (tekenen):', e); } };
    const g = D.doc.defaultView; S.raf = g && g.requestAnimationFrame ? g.requestAnimationFrame(run) : setTimeout(run, 16);
  };
  N.zoomBeweeg = function (x, factor) {   // x = pixels vanaf de linkerrand van de tijdkolom
    if (!gebaarOK() || !(factor > 0)) return;
    maakVrij(); const r = N.zoomRond({ ppd: S.ppd, pos: S.pos }, Math.max(0, Math.min(S.Wv, x)), factor, S.Wv);
    S.ppd = r.ppd; S.pos = N.posBegrens(r.pos, vandaagWi()); N.vraag(); N.stapStil();
  };
  N.schuifPx = function (dx) {   // dx > 0: de inhoud schuift naar rechts (je ziet wat eerder lag)
    if (!gebaarOK() || !dx) return;
    maakVrij(); S.pos = N.posBegrens(N.schuif({ ppd: S.ppd, pos: S.pos }, dx).pos, vandaagWi()); N.vraag(); N.stapStil();
  };
  function koppelGebaren(vlak) {
    const norm = (v, mode) => mode === 1 ? v * 16 : mode === 2 ? v * 400 : v;
    const laneLinks = () => { const l = vlak.querySelector('.cn-lane'); return (l || vlak).getBoundingClientRect().left; };
    vlak.addEventListener('wheel', ev => {
      if (!gebaarOK()) return;
      const dy = norm(ev.deltaY, ev.deltaMode), dx = norm(ev.deltaX, ev.deltaMode), opAs = !!(ev.target && ev.target.closest && ev.target.closest('.cn-as-rij'));
      if (ev.ctrlKey || (opAs && !ev.shiftKey && Math.abs(dy) >= Math.abs(dx) && dy)) { ev.preventDefault(); N.zoomBeweeg(ev.clientX - laneLinks(), Math.exp(-dy * (ev.ctrlKey ? 0.01 : 0.0022))); }   // Ctrl+wiel en knijpen op een trackpad (de browser meldt dat als Ctrl+wiel): overal; het gewone wiel alleen op de tijdas
      else if (ev.shiftKey || Math.abs(dx) > Math.abs(dy)) { ev.preventDefault(); N.schuifPx(-(ev.shiftKey && !dx ? dy : dx)); }   // Shift+wiel en horizontaal scrollen: schuiven
      // het gewone wiel boven de rijen blijft verticaal scrollen
    }, { passive: false });
    const ptrs = new Map(); let pan = null, pinch = null;
    const stopTraag = () => { if (S.traagId) { const g = D.doc.defaultView; if (g && g.cancelAnimationFrame) g.cancelAnimationFrame(S.traagId); S.traagId = 0; } };
    const eindPan = (ev, geannuleerd) => {
      ptrs.delete(ev.pointerId); if (!ptrs.size) setTimeout(gebaarKlaar, 0);
      if (pinch && ptrs.size < 2) pinch = null;
      if (pan && pan.id === ev.pointerId) {
        const p = pan; pan = null;
        if (p.bewogen) {
          S.nietKlikken = true; setTimeout(() => { S.nietKlikken = false; }, 60);
          const h = p.hist, nu = h[h.length - 1], oud = h.find(x => nu[1] - x[1] < 120) || nu;   // uitrollen na een veeg op touch
          const v = nu[1] > oud[1] ? (nu[0] - oud[0]) / (nu[1] - oud[1]) : 0;
          if (!geannuleerd && ev.pointerType === 'touch' && Math.abs(v) > 0.3) {
            let last = nu[1], vv = Math.max(-3, Math.min(3, v)); const g = D.doc.defaultView;   // een veeg rolt uit, maar nooit sneller dan 3 px per ms
            const stap = t => { if (!gebaarOK()) { S.traagId = 0; return; } const dt = Math.min(48, t - last); last = t; vv *= Math.pow(0.94, dt / 16); S.pos = N.posBegrens(S.pos - vv * dt / S.ppd, vandaagWi()); N.vlakTeken(); if (Math.abs(vv) > 0.03) S.traagId = g.requestAnimationFrame(stap); else { S.traagId = 0; N.stapStil(true); } };
            S.traagId = g.requestAnimationFrame(stap);
          } else N.stapStil();
        }
      }
    };
    vlak.addEventListener('pointerdown', ev => {
      if (!gebaarOK() || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      const t = ev.target; if (!t || !t.closest) return;
      const opAs = !!t.closest('.cn-as-rij .cn-lane');
      if (!opAs && (!t.closest('.cn-lane') || t.closest('.cn-blok,.cn-bw,button,input,select,textarea,a,.cn-greep'))) return;   // blokken en knoppen houden hun eigen gedrag; de lege achtergrond en de as schuiven
      stopTraag(); S.gebaar = Date.now(); ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (ptrs.size === 1) pan = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, pos0: S.pos, ppd0: S.ppd, bewogen: false, hist: [[ev.clientX, ev.timeStamp || Date.now()]] };
      else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pan = null; maakVrij(); pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), cx0: (a.x + b.x) / 2, ppd0: S.ppd, pos0: S.pos }; }
      try { vlak.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    vlak.addEventListener('pointermove', ev => {
      if (!ptrs.has(ev.pointerId)) return;
      ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pinch && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, links = laneLinks();
        const r = N.zoomRond({ ppd: pinch.ppd0, pos: pinch.pos0 }, Math.max(0, Math.min(S.Wv, pinch.cx0 - links)), d / pinch.d0, S.Wv);
        S.ppd = r.ppd; S.pos = N.posBegrens(r.pos - (cx - pinch.cx0) / r.ppd, vandaagWi()); N.vraag(); N.stapStil(); return;
      }
      if (pan && pan.id === ev.pointerId) {
        const dx = ev.clientX - pan.x;
        if (!pan.bewogen && Math.abs(dx) < 4 && Math.abs(ev.clientY - pan.y) < 4) return;
        pan.bewogen = true; maakVrij();
        pan.hist.push([ev.clientX, ev.timeStamp || Date.now()]); if (pan.hist.length > 8) pan.hist.shift();
        S.pos = N.posBegrens(pan.pos0 - dx / pan.ppd0, vandaagWi()); N.vraag(); N.stapStil();
        if (ev.cancelable) ev.preventDefault();
      }
    });
    vlak.addEventListener('pointerup', ev => eindPan(ev, false));
    vlak.addEventListener('pointercancel', ev => eindPan(ev, true));
    vlak.addEventListener('click', ev => { if (S.nietKlikken) { ev.stopPropagation(); ev.preventDefault(); } }, true);   // na een sleep geen klik op wat eronder lag
    vlak.addEventListener('keydown', ev => {   // het toetsenbord op de tijdas
      if (!ev.target || !ev.target.closest || !ev.target.closest('.cn-as') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') { ev.preventDefault(); N.schuifPx((ev.key === 'ArrowLeft' ? 1 : -1) * (ev.shiftKey ? S.ppd / 4 : S.ppd)); N.stapStil(true); }
      else if (ev.key === '+' || ev.key === '=' || ev.key === '-' || ev.key === '_') { ev.preventDefault(); N.zoomBeweeg(S.Wv / 2, ev.key === '+' || ev.key === '=' ? 1.3 : 1 / 1.3); N.stapStil(true); }
    });
  }

  // ── tekenen ──
  const LBL = () => { const g = D.doc.defaultView; return g && g.innerWidth <= 640 ? 104 : 190; };
  const optiesBasis = st => ({ team: D.team() || [], vrij: D.vrij ? D.vrij() : null, verlof: D.verlof ? D.verlof() : null, project: st.project || '' });
  N.balkBijwerken = function (m) {
    const b = S.balk; if (!b) return;
    b.titel.textContent = m.titel; b.titel.setAttribute('title', m.titel + ' · ' + m.sub); b.sub.textContent = m.sub;
    b.zk.forEach((k, i) => { const aan = ZOOMS[i][0] === S.zoom; k.classList.toggle('aan', aan); k.setAttribute('aria-pressed', aan ? 'true' : 'false'); });
  };
  // De tijdkolom: de stand (snelkeuze of vrij) naar een schaal en een venster, dan de rijen. Met `forceer` altijd opnieuw; anders wordt bij een beweging binnen dezelfde dagen alleen verschoven.
  N.vlakTeken = function (forceer) {
    const vlak = S.vlak; if (!vlak || !D || !D.doc.contains(vlak)) return;
    const hoofd = vlak.parentNode, cw = hoofd && hoofd.clientWidth, Wv = cw > 0 ? Math.max(160, cw - LBL() - 2) : (S.Wv || 1000), today = P.vandaagYmd();
    S.Wv = Wv;
    const weekendPad = !S.vrij && S.zoom === 'dag' && S.exactDag && P.isYmd(S.anker) && ((wd(nr(S.anker)) + 6) % 7) > 4;   // een weekenddag (alleen via "Naar de dag") is één losse kolom
    if (S.centreer) { S.centreer = false; if (S.vrij) S.pos = vandaagWi() - Math.max(0, (Wv / S.ppd - 1) / 2); }
    if (!S.vrij) { S.ppd = N.preset(S.zoom, Wv); const a = P.isYmd(S.anker) ? S.anker : today; S.pos = S.zoom === 'week' || S.zoom === 'maand' || S.zoom === 'kwartaal' ? wiVan(monday(a)) : wiVan(a); }
    S.ppd = begrens(S.ppd, Wv); S.pos = N.posBegrens(S.pos, vandaagWi());
    const kind = weekendPad ? 'dag' : N.modus(S.ppd, Wv);
    if (S.vrij) { S.zoom = kind; S.anker = datumVanWi(Math.floor(S.pos)); }
    const n = Wv / S.ppd, d0 = Math.floor(S.pos + 1e-9), d1 = Math.max(d0 + 1, Math.ceil(S.pos + n - 1e-6)), snap = N.snapMin(S.ppd);
    const sleutel = [weekendPad ? 'w' + S.anker : d0 + ':' + d1, S.ppd.toFixed(3), Wv, S.project, S.persoon, S.zoom, JSON.stringify(S.agenda), U0, U1, today].join('|');
    if (!forceer && S.sleutel === sleutel && vlak.firstChild) { N.plaats(); return; }
    if (S.popOpruim) { try { S.popOpruim(); } catch (e) {} S.popOpruim = null; }   // een open opbouw hoort bij de oude weergave
    let m;
    try { m = N.model(Object.assign({}, S, { zoom: S.zoom, ongepland: S.ong, d0: weekendPad ? undefined : d0, d1: weekendPad ? undefined : d1 })); }
    catch (e) { console.warn('Capaciteit (nieuw):', e); vlak.textContent = ''; vlak.appendChild(el('div', { klass: 'cn-melding', tekst: 'De planning kon niet worden berekend.' })); S.V = null; return; }
    N.laatste = m;
    const uren = kind === '3d' || kind === 'dag', teken = uren ? 'uren' : kind;
    const V = { m, ppd: S.ppd, Wv, kind, snap, venster: m.venster, teken };
    V.breedte = teken === 'kwartaal' ? m.weken * 5 * S.ppd : m.venster.length * S.ppd;
    V.base = m.weekend ? null : m.d0w + (teken === 'kwartaal' ? 0 : m.venster[0]);
    S.V = V;
    vlak.textContent = '';
    const rijen = m.rijen;
    if (!rijen.length) vlak.appendChild(el('div', { klass: 'cn-melding', tekst: 'Geen teamleden voor deze keuze.' }));
    else if (teken === 'week') tekenWeek(V, rijen, vlak);
    else if (teken === 'maand') tekenMaand(V, rijen, vlak);
    else if (teken === 'kwartaal') tekenKwartaal(V, rijen, vlak);
    else tekenUren(V, rijen, vlak);
    const hint = HINT[kind] + ((kind === 'week' || kind === '3d' || kind === 'dag') ? (N.mag() ? ' · sleep een blok, of kies ⇄ voor het toetsenbord' : ' · verplaatsen is voor kantoor') : '');
    vlak.appendChild(el('div', { klass: 'cn-legenda' }, el('span', null, el('i', { klass: 'cn-lg-balk' }), 'gepland t.o.v. beschikbaar'), el('span', { klass: 'over' }, el('i', { klass: 'cn-lg-over' }), 'meer gepland dan beschikbaar'), el('span', null, el('i', { klass: 'cn-lg-vrij' }), 'vrij of verlof'), el('span', null, el('i', { klass: 'cn-lg-voorstel' }), 'open voorstel'), el('span', { klass: 'cn-hint', tekst: hint + ' · ' + GEBAAR })));
    S.sleutel = sleutel;
    N.balkBijwerken(m); N.plaats(); if (!m.weekend) voorLaad(m);
    const w = D.doc.getElementById('agenda-capaciteit');
    if (w && S.focusTaak) { const f = [...w.querySelectorAll('.cn-blok[data-taak]')].find(x => x.getAttribute('data-taak') === S.focusTaak && (!S.focusCode || x.getAttribute('data-code') === S.focusCode)); S.focusTaak = null; S.focusCode = null; if (f && f.focus) f.focus(); }   // de balk waarop met het toetsenbord gewerkt werd houdt de focus
    if (w && S.focusBlok) { const f = [...w.querySelectorAll('.cn-blok[data-blok]')].find(x => x.getAttribute('data-blok') === S.focusBlok); S.focusBlok = null; if (f && f.focus) f.focus(); }
    if (FF() && w) FF().markeer(w);   // de geselecteerde taak (het laatst geopende taakpaneel) blijft gemarkeerd bij het wisselen van weergave
  };
  N.plaats = function () {   // de stroken op de plek van S.pos zetten (alleen een transform: geen DOM-werk)
    const V = S.V, vlak = S.vlak; if (!V || !vlak) return;
    const x = V.base === null ? 0 : (V.base - S.pos) * V.ppd, t = 'translate3d(' + x.toFixed(2) + 'px,0,0)';
    vlak.querySelectorAll('.cn-strip').forEach(s => { s.style.transform = t; });
  };

  const gebaarActief = () => !!S.gebaar && Date.now() - S.gebaar < 10000;   // tijdens slepen of knijpen niet de hele weergave vervangen (de sleep zou ophouden); daarna alsnog
  const gebaarKlaar = () => { S.gebaar = 0; if (S.nogTeken) { S.nogTeken = false; N.teken(); } };
  N.teken = function () {
    const w = D && D.doc.getElementById('agenda-capaciteit'); if (!w) return;
    if (gebaarActief()) { S.nogTeken = true; return; }
    N.cacheWis(); if (S.popOpruim) { try { S.popOpruim(); } catch (e) {} S.popOpruim = null; }
    if (S.ro) { try { S.ro.disconnect(); } catch (e) {} S.ro = null; }
    w.textContent = '';
    trekFilter();
    if (!S.anker) S.anker = P.vandaagYmd();
    bepaalUren();
    try { S.ong = ongeplandVoor(S, D.team() || [], optiesBasis(S)); } catch (e) { console.warn('Capaciteit (nieuw):', e); w.appendChild(el('div', { klass: 'cn-melding', tekst: 'De planning kon niet worden berekend.' })); return; }
    const knop = (label, klik, kl) => el('button', { type: 'button', klass: 'cn-knop' + (kl ? ' ' + kl : ''), 'aria-label': label, klik });
    const vorige = knop('Vorige periode', () => N.stap(-1), 'icoon'), volgende = knop('Volgende periode', () => N.stap(1), 'icoon');
    vorige.appendChild(icoon('M15 6l-6 6l6 6')); volgende.appendChild(icoon('M9 6l6 6l-6 6'));
    const vandaag = knop('Naar vandaag', () => N.naarVandaag()); vandaag.textContent = 'Vandaag';
    const zi = () => ZOOMS.findIndex(z => z[0] === S.zoom);
    const zk = ZOOMS.map(z => el('button', { type: 'button', klass: 'cn-zk' + (z[0] === S.zoom ? ' aan' : ''), 'aria-pressed': z[0] === S.zoom ? 'true' : 'false', klik: () => N.zoom(z[0]), tekst: z[1] }));
    const zoomGroep = el('div', { klass: 'cn-zoom', role: 'group', 'aria-label': 'Inzoomen' },
      (() => { const b = knop('Uitzoomen', () => N.zoom(ZOOMS[Math.max(0, zi() - 1)][0]), 'zm'); b.appendChild(icoon('M5 12h14')); return b; })(), zk,
      (() => { const b = knop('Inzoomen', () => N.zoom(ZOOMS[Math.min(ZOOMS.length - 1, zi() + 1)][0]), 'zm'); b.appendChild(icoon('M12 5v14M5 12h14')); return b; })());
    const titel = el('span', { klass: 'cn-titel' }), sub = el('span', { klass: 'cn-sub cn-num' });
    S.balk = { titel, sub, zk };
    w.appendChild(el('div', { klass: 'cn-balk-boven' }, vorige, vandaag, volgende, titel, sub, el('span', { klass: 'cn-rek' }), filterKnoppen(), ZOOM_UI ? zoomGroep : null));
    if (D.takenKlaar && !D.takenKlaar()) w.appendChild(el('div', { klass: 'cn-melding', role: 'status', tekst: D.takenStatusTekst() + ' Je ziet alleen wat er al staat.' }));
    const vlak = el('div', { klass: 'cn-vlak', style: '--cn-lbl:' + LBL() + 'px' });
    koppelGebaren(vlak);
    w.appendChild(el('div', { klass: 'cn-kader' }, el('div', { klass: 'cn-hoofd' }, vlak), zijkolom({ ongepland: S.ong })));
    S.vlak = vlak; S.V = null; S.sleutel = '';
    N.vlakTeken(true);   // eerst in het document (de breedte meten), dan de rijen
    if (typeof ResizeObserver !== 'undefined' && vlak.parentNode) {   // een andere breedte (venster, Ongepland in- of uitgeklapt, telefoon gedraaid): opnieuw tekenen
      let b0 = vlak.parentNode.clientWidth;
      S.ro = new ResizeObserver(() => { const b1 = vlak.parentNode ? vlak.parentNode.clientWidth : 0; if (b1 > 0 && Math.abs(b1 - b0) > 2) { b0 = b1; N.vraag(); } });
      S.ro.observe(vlak.parentNode);
    }
  };

  // Vanuit Vandaag ("Inplannen" bij een taak zonder datum): de taak in Ongepland markeren en het bestaande "Plan … in…"-keuzemenu (N.menu) openen. Er is geen eigen schrijfroute:
  // plannen loopt via N.drop, dus via D.verplaats met dezelfde controles als slepen. De aanroeper heeft de Agenda al op Capaciteit gezet. Zonder recht (N.mag) blijft het bij markeren.
  N.inplannen = function (taak) {
    if (!taak || taak.id === undefined || taak.id === null) return false;
    duwFilter({ persoon: '', project: '' }); S.exactDag = false; S.vrij = false; S.persoon = ''; S.project = ''; S.anker = P.vandaagYmd(); S.ongDicht = false;
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
    duwFilter({ persoon: '', project: '' }); S.exactDag = false; S.vrij = false; S.persoon = ''; S.project = ''; S.anker = P.isYmd(datum) ? datum : P.vandaagYmd();
    if (S.zoom === 'maand' || S.zoom === 'kwartaal') S.zoom = 'week';   // de balken zijn pas in een week- of dagweergave te zien (de bewaarde zoomkeuze verandert niet)
    duwPeriode();
    S.toon = { id: String(taak.id), code: String(taak.code == null ? '' : taak.code).toLowerCase(), tot: D.nu() + 60000 };
    N.teken();
    const e = D.doc.querySelector('#agenda-capaciteit .cn-blok.tp-gemarkeerd'); if (e && e.scrollIntoView) e.scrollIntoView({ block: 'center', inline: 'center' });
    return !!e;
  };
  N.gaNaar = function (datum, slug) { S.vrij = false; if (P.isYmd(datum)) S.anker = datum; S.persoon = slug || ''; S.project = ''; S.zoom = P.isYmd(datum) ? 'dag' : 'week'; S.exactDag = P.isYmd(datum); duwFilter({ persoon: slug || '', project: '' }); duwPeriode(); };   // precies die dag (ook een weekenddag), met die persoon in beeld; de bewaarde zoomkeuze verandert niet
  N.init = function (deps) {
    D = deps; P = deps.planning || root.MTPlanning;
    try { const z = D.storage && D.storage.getItem(LS_ZOOM); if (ZOOM_UI && z && ZOOMS.some(x => x[0] === z)) S.zoom = z; S.ongDicht = !!(D.storage && D.storage.getItem(LS_ONG) === 'dicht');
      const sc = Number(D.storage && D.storage.getItem(LS_SCHAAL)); if (sc >= 0.5 && sc <= 400) { S.vrij = true; S.ppd = sc * UH(); S.centreer = true; }   // de laatst gebruikte vrije schaal (niet de plek: die is vandaag)
      const ag = D.storage && D.storage.getItem(LS_AGENDA); if (ag) { const o = JSON.parse(ag); if (o && typeof o === 'object') S.agenda = o; }
    } catch (e) {}
    return N;
  };
  N.S = S;
  root.MTCapaciteitNieuw = N;
  if (typeof module !== 'undefined' && module.exports) module.exports = N;
})(typeof window !== 'undefined' ? window : globalThis);
