/* ============================================================================
 * mt-uren-nieuw.js: de Uren-tab in de nieuwe stijl (restyling fase 1, brok 11)
 * ----------------------------------------------------------------------------
 * Het canvas (Uren.dc.html): een Toggl-achtige invoerbalk (de bestaande timerbalk, alleen anders opgemaakt), dagtabs ma-vr met het totaal per dag, een
 * verticale dagtijdlijn met je entries, de gaten ("Nog niet geboekt") en afspraken uit je Outlook-agenda als suggestie, de week per project en "Klaar zonder uren".
 * De timer start en stopt met precies dezelfde functies als altijd (mt-toggl.js, met hun dubbelstart-guard); dit bestand start of stopt niets zelf.
 * Boeken gaat via tgBoekEntry (mt-toggl.js): eerst opnieuw lezen of die tijd al in Toggl staat, een keer posten, nooit een native alert en nooit een tweede poging.
 * Tekent met DOM-calls (nooit met opgebouwde HTML); alles komt van buiten via init(deps) zodat het zonder de hele cockpit te testen is; bouw() is rekenwerk zonder DOM.
 * Niet in de oude stijl: zonder html[data-stijl="nieuw"] doet tgLaadRecent wat het altijd deed en blijft #uren-nieuw leeg en verborgen.
 * ========================================================================== */
(function (root) {
  'use strict';
  const U = {};
  let D = null, P = null;
  const S = { dag: '', weergave: 'dag', weekStart: '', entries: [], projecten: [], agenda: null, agendaDag: '', fout: '', bezig: false, geladen: false, token: 0, melding: '', boekt: false };

  const MND = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const MNDK = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const DAG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'], DAGK = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  const pad = n => String(n).padStart(2, '0');
  const nr = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const dymd = n => { const t = new Date(n * 864e5); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); };
  const wdag = n => ((n + 4) % 7 + 7) % 7;   // 0 = zondag
  const plus = (s, n) => dymd(nr(s) + n);
  const maandag = s => plus(s, -((wdag(nr(s)) + 6) % 7));
  const lokaalYmd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const minVan = d => d.getHours() * 60 + d.getMinutes();
  const klok = min => { const n = Math.max(0, Math.round(min || 0)); return Math.floor(n / 60) + ':' + pad(n % 60); };   // 1:47
  const hm = min => pad(Math.floor(min / 60)) + ':' + pad(Math.round(min) % 60);                                       // 08:05
  const secKlok = sec => klok(Math.round((sec || 0) / 60));
  const kort = s => Number(s.slice(8)) + ' ' + MNDK[Number(s.slice(5, 7)) - 1];
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function isoWeek(s) { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))), dag = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - dag); return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); }
  U.hulp = { klok, hm, maandag, plus, isoWeek, kort };

  // ── rekenwerk (geen DOM) ──
  // Een entry uit Toggl naar { id, i, datum, van, tot, sec, titel, projectId, lopend } (lokale tijd; een entry over middernacht telt op de startdag en wordt bij 24:00 afgekapt).
  U.entryNorm = function (e, nu, i) {
    const a = new Date(e.start); if (isNaN(a.getTime())) return null;
    const lopend = !e.stop; let b = lopend ? new Date(nu) : new Date(e.stop); if (isNaN(b.getTime()) || b < a) b = a;
    const sec = lopend ? Math.max(0, (b - a) / 1000) : (e.duration > 0 ? e.duration : Math.max(0, (b - a) / 1000));
    const datum = lokaalYmd(a), van = minVan(a), tot = lokaalYmd(b) === datum ? minVan(b) : 24 * 60;
    return { id: e.id, i, datum, van, tot: Math.max(tot, van), sec, titel: String(e.description || '').trim(), projectId: e.project_id == null ? null : e.project_id, lopend, billable: !!e.billable };
  };
  // Vrije stukken in [van, tot] die niet door `bezet` ([[a, b], ...]) gedekt zijn, minstens `min` minuten lang.
  U.vrijeStukken = function (van, tot, bezet, min) {
    const b = bezet.map(x => [Math.max(van, x[0]), Math.min(tot, x[1])]).filter(x => x[1] > x[0]).sort((x, y) => x[0] - y[0]);
    const uit = []; let c = van;
    b.forEach(x => { if (x[0] - c >= min) uit.push([c, x[0]]); c = Math.max(c, x[1]); });
    if (tot - c >= min) uit.push([c, tot]);
    return uit;
  };
  // Banen naast elkaar voor items die in de tijd overlappen (twee timers tegelijk): lane en lanes (het aantal in die groep).
  U.banen = function (items) {
    const lijst = items.slice().sort((a, b) => a.van - b.van || a.tot - b.tot); let groep = [], eind = -1;
    const sluit = () => { const n = groep.reduce((m, x) => Math.max(m, x.lane + 1), 1); groep.forEach(x => { x.lanes = n; }); groep = []; };
    lijst.forEach(it => { if (groep.length && it.van >= eind) { sluit(); eind = -1; } const bezet = groep.filter(x => x.tot > it.van).map(x => x.lane); let l = 0; while (bezet.includes(l)) l++; it.lane = l; groep.push(it); eind = Math.max(eind, it.tot); });
    if (groep.length) sluit();
    return items;
  };

  // o = { dag, nu (ms), entries (afgesloten, uit Toggl, in de volgorde van de recent-lijst), lopend (entry|null), doel(ymd) -> minuten, venster(ymd) -> {van, tot} (minuten),
  //       projInfo(projectId) -> { sleutel, label, nummer, naam, kleur }, agenda (lijst|null), negeerAgenda (Set), gepland (planblokken van die dag), klaar (lijst), negeerKlaar (Set) }
  U.bouw = function (o) {
    const nu = o.nu, vandaag = lokaalYmd(new Date(nu)), nuMin = minVan(new Date(nu)), dag = o.dag, ma = maandag(dag), wk = [0, 1, 2, 3, 4].map(n => plus(ma, n));
    const alle = (o.entries || []).map((e, i) => U.entryNorm(e, nu, i)).filter(Boolean);
    if (o.lopend) { const l = U.entryNorm(Object.assign({}, o.lopend, { stop: null }), nu, -1); if (l) alle.push(l); }
    const projInfo = o.projInfo || (() => ({ sleutel: 'geen', label: 'Geen project', nummer: '', naam: 'Geen project', kleur: 'var(--line-strong)' }));
    const doel = o.doel || (() => 480);
    const perDag = {}; wk.concat(plus(ma, 5), plus(ma, 6)).forEach(d => { perDag[d] = []; });
    alle.forEach(e => { if (perDag[e.datum]) perDag[e.datum].push(e); });
    const m = { vandaag, dag, weekStart: ma, weekNr: isoWeek(ma) };
    m.dagen = wk.map(d => { const tot = perDag[d].reduce((s, e) => s + e.sec, 0), dm = Math.max(0, Math.round(doel(d) || 0)); return { datum: d, dow: DAGK[wdag(nr(d))], kort: kort(d), totSec: tot, doelMin: dm, pct: dm > 0 ? Math.round(tot / 60 / dm * 100) : (tot > 0 ? 100 : 0), sel: d === dag, vandaag: d === vandaag, toekomst: d > vandaag }; });
    // de gekozen dag
    const ev = perDag[dag] || [], bezet = ev.map(e => [e.van, e.tot]);
    const ven = o.venster ? o.venster(dag) : { van: 480, tot: 1020 }, vanW = ven.van, totW = ven.tot;
    const eindeGaten = dag > vandaag ? -1 : (dag === vandaag ? Math.min(totW, nuMin) : totW);
    const kandAg = (Array.isArray(o.agenda) ? o.agenda : []).filter(a => a && !a.heleDag && a.tot - a.van >= 15 && !(o.negeerAgenda && o.negeerAgenda.has(a.id)) && !bezet.some(b => b[0] < a.tot && a.van < b[1]));
    const items = [];
    ev.forEach(e => { const p = projInfo(e.projectId); items.push({ soort: e.lopend ? 'lopend' : 'entry', i: e.i, id: e.id, titel: e.titel || '(geen omschrijving)', van: e.van, tot: e.tot, tijd: hm(e.van) + '–' + (e.lopend ? 'nu' : hm(e.tot)), sec: e.sec, proj: p, projectId: e.projectId }); });
    kandAg.forEach(a => items.push({ soort: 'agenda', id: a.id, titel: a.titel || '(geen titel)', van: a.van, tot: a.tot, tijd: hm(a.van) + '–' + hm(a.tot), sec: (a.tot - a.van) * 60, min: a.tot - a.van, plaats: a.plaats || '' }));
    (o.gepland || []).forEach(g => { if (g && g.van != null && g.tot > g.van && !bezet.some(b => b[0] < g.tot && g.van < b[1])) items.push({ soort: 'gepland', id: g.id, titel: g.titel, van: g.van, tot: g.tot, tijd: hm(g.van) + '–' + hm(g.tot), sec: (g.tot - g.van) * 60, min: g.tot - g.van, proj: g.proj || null, tgProjectId: g.tgProjectId == null ? null : g.tgProjectId }); });
    const gaten = eindeGaten > vanW ? U.vrijeStukken(vanW, eindeGaten, bezet.concat(kandAg.map(a => [a.van, a.tot])), 15) : [];
    gaten.forEach(g => items.push({ soort: 'gat', van: g[0], tot: g[1], tijd: hm(g[0]) + '–' + hm(g[1]), min: g[1] - g[0], sec: (g[1] - g[0]) * 60, titel: 'Nog niet geboekt' }));
    U.banen(items.filter(x => x.soort !== 'gat')); items.forEach(x => { if (x.soort === 'gat') { x.lane = 0; x.lanes = 1; } });   // een gat loopt over de volle breedte; een gepland blok of afspraak ligt erover
    const geboektSec = ev.reduce((s, e) => s + e.sec, 0), dm = Math.max(0, Math.round(doel(dag) || 0));
    const axisVan = Math.min(7, Math.floor(Math.min(vanW, ...items.map(x => x.van)) / 60)), axisTot = Math.max(17, Math.ceil(Math.max(totW, ...items.map(x => x.tot)) / 60));
    m.dagInfo = { datum: dag, titel: cap(DAG[wdag(nr(dag))]) + ' ' + Number(dag.slice(8)) + ' ' + MND[Number(dag.slice(5, 7)) - 1], geboektSec, openMin: Math.max(0, dm - Math.round(geboektSec / 60)), doelMin: dm, items, gaten: gaten.map(g => ({ van: g[0], tot: g[1], min: g[1] - g[0] })), axis: { van: axisVan, tot: axisTot }, nuMin: dag === vandaag ? nuMin : null, venster: ven };
    // de week per project (alle vijf de dagen), met het totaal per dag voor het weekoverzicht
    const pp = new Map();
    wk.forEach((d, di) => perDag[d].forEach(e => { const p = projInfo(e.projectId), r = pp.get(p.sleutel) || { sleutel: p.sleutel, label: p.label, kleur: p.kleur, sec: 0, perDag: [0, 0, 0, 0, 0] }; r.sec += e.sec; r.perDag[di] += e.sec; pp.set(p.sleutel, r); }));
    const totWeek = [...pp.values()].reduce((s, r) => s + r.sec, 0), doelWeek = wk.reduce((s, d) => s + Math.max(0, Math.round(doel(d) || 0)), 0);
    m.week = { nr: m.weekNr, totSec: totWeek, doelMin: doelWeek, perProject: [...pp.values()].sort((a, b) => b.sec - a.sec || (a.label < b.label ? -1 : 1)).map(r => Object.assign(r, { pct: totWeek > 0 ? Math.round(r.sec / totWeek * 100) : 0 })), perDag: m.dagen.map(d => d.totSec) };
    // Klaar zonder uren: een taak van mij die klaar is, zonder entry met die naam in de geladen uren
    const beschr = alle.map(e => norm(e.titel)).filter(Boolean);
    m.klaar = (o.klaar || []).filter(t => t && !(o.negeerKlaar && o.negeerKlaar.has(String(t.id))) && !beschr.some(b => { const n = norm(t.naam); return n && (b.includes(n) || n.includes(b)); }))
      .map(t => ({ id: t.id, naam: t.naam, projLabel: t.projLabel || '', wie: t.wie || '', code: t.code || '', budgetMin: Math.max(0, Math.round(t.budgetMin || 0)), tgProjectId: t.tgProjectId == null ? null : t.tgProjectId,
        klaarTekst: !t.klaarOp ? 'klaar' : t.klaarOp === vandaag ? 'klaar vandaag' : t.klaarOp === plus(vandaag, -1) ? 'klaar gisteren' : 'klaar op ' + kort(t.klaarOp) }));
    return m;
  };
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // Waar een nieuwe boeking van `min` minuten op de gekozen dag hoort: het eerste gat dat groot genoeg is, anders direct na de laatste entry, anders aan het begin van het werkvenster.
  U.plek = function (m, min) {
    const g = m.dagInfo.gaten.find(x => x.min >= min); if (g) return g.van;
    const eind = m.dagInfo.items.filter(x => x.soort === 'entry' || x.soort === 'lopend').reduce((a, x) => Math.max(a, x.tot), 0);
    return eind > 0 ? eind : m.dagInfo.venster.van;
  };
  // De starttijd (ISO, UTC zonder milliseconden) van een lokale dag + minuut-van-de-dag.
  U.isoStart = function (ymd, min) { const d = new Date(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), Math.floor(min / 60), Math.round(min) % 60, 0, 0); return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); };

  // ── tekenen ──
  function el(tag, props, ...kids) {
    const e = D.doc.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'klass') e.className = v; else if (k === 'tekst') e.textContent = v; else if (k === 'klik') e.addEventListener('click', v); else if (k === 'stijl') Object.entries(v).forEach(([s, w]) => e.style.setProperty(s, w));
      else e.setAttribute(k, v === true ? '' : v);
    });
    kids.flat(2).forEach(x => { if (x === null || x === undefined || x === false) return; e.appendChild(typeof x === 'string' ? D.doc.createTextNode(x) : x); });
    return e;
  }
  const knop = (tekst, klass, klik, extra) => el('button', Object.assign({ type: 'button', klass: 'un-knop' + (klass ? ' ' + klass : ''), tekst, klik }, extra || {}));
  const actief = () => { try { return D.doc.documentElement.getAttribute('data-stijl') === 'nieuw'; } catch (e) { return false; } };
  U.actief = () => !!D && actief();
  const vandaagYmd = () => lokaalYmd(new Date(D.nu()));
  const mijnSlug = () => { const ik = String(D.ik() || '').toLowerCase(), l = (D.team() || []).find(x => String(x.email || '').toLowerCase() === ik); return l ? l.slug : ik.split('@')[0]; };
  const leesNegeer = sleutel => { try { const a = JSON.parse(D.storage.getItem(sleutel) || '[]'); return new Set(Array.isArray(a) ? a.map(String) : []); } catch (e) { return new Set(); } };
  const zetNegeer = (sleutel, set) => { try { D.storage.setItem(sleutel, JSON.stringify([...set].slice(-200))); } catch (e) {} };
  const SL_KLAAR = 'mt_uren_klaar_negeer', slAg = d => 'mt_uren_agenda_negeer:' + d;

  function model(dagIn, entriesIn, agendaIn) {
    const dag = dagIn || S.dag, slug = mijnSlug(), wt = D.werktijden ? D.werktijden() : null, wu = D.werkuren ? D.werkuren() : null, verlof = D.verlof ? D.verlof() : [], vrij = D.vrijedagen ? D.vrijedagen() : [];
    const rec = P.werktijdenMap(wt)[slug] || null;
    const idx = d => ((wdag(nr(d)) + 6) % 7);
    const afwezig = d => idx(d) > 4 || (vrij || []).some(v => v && v.datum === d && v.type === 'verplicht') || (verlof || []).some(v => v && v.van <= d && d <= v.tm && P.zelfdePersoon(v.persoon, slug, D.team() || []));
    const doel = d => afwezig(d) ? 0 : P.dagCapMin(slug, idx(d), { werkuren: wu, werktijden: wt });
    const venster = d => { const x = rec && rec.dagen && rec.dagen[['ma', 'di', 'wo', 'do', 'vr'][idx(d)]]; if (x && x.werk) { const a = /^(\d{1,2}):(\d{2})/.exec(x.start || ''), b = /^(\d{1,2}):(\d{2})/.exec(x.eind || ''); if (a && b) return { van: +a[1] * 60 + +a[2], tot: +b[1] * 60 + +b[2] }; } return { van: 480, tot: 1020 }; };
    const gepland = (D.gepland ? D.gepland(dag, slug) : []) || [];
    return U.bouw({ dag, nu: D.nu(), entries: entriesIn || S.entries, lopend: D.lopend ? D.lopend() : null, doel, venster, projInfo: pid => D.projInfo(pid, S.projecten), agenda: agendaIn !== undefined ? agendaIn : (S.agendaDag === dag ? S.agenda : null),
      negeerAgenda: leesNegeer(slAg(dag)), gepland, klaar: D.klaarTaken ? D.klaarTaken() : [], negeerKlaar: leesNegeer(SL_KLAAR) });
  }

  // De entries van de week laden (zelfde bron als altijd: tgStore.eigenEntries) en bewaren in de recent-lijst, zodat ▶ ✎ 🗑 dezelfde functies met dezelfde index gebruiken.
  U.laad = async function () {
    if (!D || !actief()) return;
    if (!S.dag) S.dag = standaardDag();
    S.weekStart = maandag(S.dag); const token = ++S.token; S.bezig = true; S.fout = ''; U.teken();
    try {
      const van = plus(S.weekStart, -1), tot = plus(S.weekStart, 8);
      const [es, ps] = await Promise.all([D.eigenEntries(van, tot), D.projecten()]);
      if (token !== S.token) return;
      const lijst = (Array.isArray(es) ? es : []).filter(e => e && e.stop).sort((a, b) => new Date(b.start) - new Date(a.start));
      S.entries = lijst; S.projecten = Array.isArray(ps) ? ps : []; S.geladen = true; try { D.zetRecent(lijst); } catch (e) {}
    } catch (e) { if (token !== S.token) return; S.fout = 'Je uren konden niet worden geladen: ' + String((e && e.message) || e); }
    S.bezig = false; U.teken(); U.laadAgenda();
  };
  function standaardDag() { const v = vandaagYmd(), i = (wdag(nr(v)) + 6) % 7; return i > 4 ? plus(v, 4 - i) : v; }   // in het weekend: vrijdag
  U.laadAgenda = async function () {
    const dag = S.dag; if (!D.agenda || !actief() || !agendaAan()) return;
    try { const l = await D.agenda(dag); if (dag !== S.dag) return; S.agenda = Array.isArray(l) ? l : null; S.agendaDag = dag; U.teken(); }
    catch (e) { if (dag === S.dag) { S.agenda = null; S.agendaDag = dag; } }   // geen agenda is geen fout: de suggesties ontbreken gewoon
  };
  // De agenda-suggesties halen je Outlook-afspraken op: pas nadat je daar zelf voor kiest (een klik), zodat er nooit onverwacht een Microsoft-venster opent. Daarna blijft het aan zolang dit tabblad open is.
  const agendaAan = () => { try { return !!D.sessie && D.sessie.getItem('mt_uren_agenda_aan') === '1'; } catch (e) { return false; } };
  U.agendaAanzetten = function () { try { D.sessie && D.sessie.setItem('mt_uren_agenda_aan', '1'); } catch (e) {} S.agendaDag = ''; S.melding = 'Agenda ophalen…'; U.teken(); U.laadAgenda().then(() => { if (S.melding === 'Agenda ophalen…') { S.melding = S.agenda ? '' : 'De agenda kon niet worden opgehaald; log zo nodig opnieuw in bij Microsoft.'; U.teken(); } }); };
  // Het dagmodel voor een willekeurige dag (de dagvraag): de entries van die week uit Toggl (of de al geladen week), zonder agenda. null als het laden mislukt.
  U.modelVoor = async function (datum) {
    if (!D) return null; const ma = maandag(datum);
    if (S.geladen && S.weekStart === ma) return model(datum, S.entries, null);
    try { const es = await D.eigenEntries(plus(ma, -1), plus(ma, 8)); return model(datum, (Array.isArray(es) ? es : []).filter(e => e && e.stop).sort((a, b) => new Date(b.start) - new Date(a.start)), null); } catch (e) { return null; }
  };
  U.kiesDag = function (d) { if (d === S.dag) return; const nieuweWeek = maandag(d) !== S.weekStart; S.dag = d; S.melding = ''; if (nieuweWeek) U.laad(); else { U.teken(); U.laadAgenda(); } };
  U.weekVerder = function (n) { U.kiesDag(plus(S.weekStart || maandag(S.dag || vandaagYmd()), n * 7)); };
  U.naarDag = function (d) { S.weergave = 'dag'; S.dag = d; S.weekStart = maandag(d); S.melding = ''; if (S.geladen) U.teken(); };   // de aanroeper opent de tab; die laadt de week
  U.timerGewijzigd = function () { if (!D || !actief() || !S.geladen) return; clearTimeout(U._t); U._t = setTimeout(() => U.teken(), 30); };

  // ── boeken ──
  // Boeken mag alleen met het recht Uren boeken (v2.html: urenMagBoeken, dezelfde regel als de timer in het startvenster); zonder dat recht zijn alle boekknoppen weg en weigert boek() ook zelf.
  const magBoeken = () => { try { return typeof D.magBoeken === 'function' && !!D.magBoeken(); } catch (e) { return false; } };
  U.magBoeken = magBoeken;
  const dialoog = () => (typeof D.dialoog === 'function' ? D.dialoog() : D.dialoog) || null;
  async function kiesProject(titel, voorstelId) {
    const dl = dialoog(); if (!dl || !dl.choose) return undefined;
    const gebruikt = []; S.entries.forEach(e => { if (e.project_id != null && !gebruikt.includes(e.project_id)) gebruikt.push(e.project_id); });
    const ps = (S.projecten || []).filter(p => p && !p.archived_at && !p.is_template).sort((a, b) => { const ga = gebruikt.indexOf(a.id), gb = gebruikt.indexOf(b.id); return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb) || String(a.name || '').localeCompare(String(b.name || '')); }).slice(0, 60);
    const keuzes = [{ label: 'Geen project', sublabel: '' }].concat(ps.map(p => { const i = D.projInfo(p.id, S.projecten); return { label: i.label, sublabel: '' }; }));
    const k = await dl.choose({ title: titel, message: 'Op welk project boeken?', choices: keuzes, defaultIndex: voorstelId != null ? Math.max(0, ps.findIndex(p => String(p.id) === String(voorstelId)) + 1) : 0 });
    if (k === null || k === undefined) return undefined;
    return k === 0 ? null : ps[k - 1].id;
  }
  async function boek(spec) {   // spec = { datum, van (min), min, omschrijving, projectId, label }
    if (!magBoeken()) { S.melding = 'Je hebt geen recht om uren te boeken.'; U.teken(); return { ok: false, reden: 'geen recht' }; }
    if (S.boekt) return null; const dl = dialoog(); if (!dl || !dl.confirm) return null;
    const ok = await dl.confirm({ title: 'Tijd boeken', message: spec.label + '\n\n' + kort(spec.datum) + ', ' + hm(spec.van) + '–' + hm(spec.van + spec.min) + ' (' + klok(spec.min) + ')\n' + (spec.omschrijving || '(geen omschrijving)'), okLabel: 'Boeken', cancelLabel: 'Annuleren' });
    if (!ok) return null;
    S.boekt = true; S.melding = 'Boeken…'; U.teken();
    let r; try { r = await D.boek({ startIso: U.isoStart(spec.datum, spec.van), duurMin: spec.min, omschrijving: spec.omschrijving, projectId: spec.projectId }); } catch (e) { r = { ok: false, reden: String((e && e.message) || e) }; }
    S.boekt = false; S.melding = r && r.ok ? (r.stondErAl ? '✓ De tijd staat in Toggl (de bevestiging kwam niet binnen, maar de entry staat er).' : '✓ Geboekt in Toggl.') : 'Niet geboekt: ' + ((r && r.reden) || 'onbekende fout');
    if (r && r.ok) U.laad(); else U.teken();
    return r;
  }
  U.boekGat = async function (m, gat) {
    if (!magBoeken()) return null;
    const pid = await kiesProject('Gat boeken', null); if (pid === undefined) return null;
    return boek({ datum: m.dagInfo.datum, van: gat.van, min: gat.tot - gat.van, omschrijving: '', projectId: pid, label: 'Het gat zonder uren.' });
  };
  // Het gat boeken op hetzelfde project en met dezelfde omschrijving als de entry ervoor (de dagvraag: "Was dat Platen bestellen?"); eerst de bevestiging.
  U.boekGatMet = function (m, gat, entry) { if (!magBoeken()) return Promise.resolve(null); return boek({ datum: m.dagInfo.datum, van: gat.van, min: gat.tot - gat.van, omschrijving: entry && entry.titel !== '(geen omschrijving)' ? entry.titel : '', projectId: entry ? entry.projectId : null, label: 'Het gat zonder uren.' }); };
  // Een gepland blok (planning) als uren boeken: op het project van de taak (of een keuze), met de taaknaam als omschrijving; eerst een bevestiging.
  U.boekGepland = async function (m, it) {
    if (!magBoeken()) return null;
    let pid = it.tgProjectId; if (pid == null) { pid = await kiesProject('Gepland blok boeken', null); if (pid === undefined) return null; }
    return boek({ datum: m.dagInfo.datum, van: it.van, min: it.tot - it.van, omschrijving: it.titel, projectId: pid, label: 'Gepland blok uit de planning.' });
  };
  U.boekAgenda = async function (m, it) {
    if (!magBoeken()) return null;
    const pid = await kiesProject('Afspraak boeken', null); if (pid === undefined) return null;
    return boek({ datum: m.dagInfo.datum, van: it.van, min: it.tot - it.van, omschrijving: it.titel, projectId: pid, label: 'Afspraak uit je Outlook-agenda.' });
  };
  U.boekKlaar = async function (m, t, minuten) {
    if (!magBoeken()) return null;
    const dl = dialoog(); if (!dl) return null;
    let min = minuten != null ? minuten : t.budgetMin;
    if (!(min > 0)) { const a = await dl.prompt({ title: 'Tijd boeken', message: 'Hoeveel tijd (minuten) voor “' + t.naam + '”?', defaultValue: '60' }); if (a === null || a === undefined) return; min = parseInt(a, 10); }
    if (!(min > 0 && min <= 24 * 60)) { S.melding = 'Niet geboekt: vul een aantal minuten tussen 1 en 1440 in.'; U.teken(); return; }
    let pid = t.tgProjectId; if (pid == null) { pid = await kiesProject('Taak boeken', null); if (pid === undefined) return; }
    return boek({ datum: m.dagInfo.datum, van: U.plek(m, min), min, omschrijving: t.naam, projectId: pid, label: 'Taak “' + t.naam + '” (klaar zonder uren).' });
  };
  U.andereTijd = async function (m, t) {
    if (!magBoeken()) return;
    const dl = dialoog(); if (!dl || !dl.prompt) return;
    const a = await dl.prompt({ title: 'Andere tijd', message: 'Hoeveel minuten voor “' + t.naam + '”?', defaultValue: String(t.budgetMin || 60) });
    if (a === null || a === undefined) return; const min = parseInt(a, 10);
    if (!(min > 0 && min <= 24 * 60)) { S.melding = 'Niet geboekt: vul een aantal minuten tussen 1 en 1440 in.'; U.teken(); return; }
    U.boekKlaar(m, t, min);
  };

  // ── de onderdelen ──
  function dagTabs(m) {
    return el('div', { klass: 'un-dagen', role: 'tablist', 'aria-label': 'Dagen van week ' + m.weekNr },
      m.dagen.map(d => el('button', { type: 'button', role: 'tab', 'aria-selected': d.sel ? 'true' : 'false', klass: 'un-dag' + (d.sel ? ' sel' : '') + (d.vandaag ? ' vandaag' : ''), klik: () => U.kiesDag(d.datum) },
        el('span', { klass: 'un-dag-kop' }, el('span', { klass: 'un-dag-naam', tekst: d.dow }), el('span', { klass: 'un-dag-datum', tekst: d.kort })),
        el('span', { klass: 'un-dag-tot', tekst: secKlok(d.totSec) }),
        el('span', { klass: 'un-dag-balk' }, el('span', { klass: 'un-dag-vul' + (d.pct > 100 ? ' over' : ''), stijl: { width: Math.min(100, d.pct) + '%' } })))));
  }
  function itemKnop(it, m) {
    if (it.soort === 'entry') return el('span', { klass: 'un-acties' },
      knop('▶', 'un-ik', () => { try { D.hervat(it.i); } catch (e) {} }, { 'aria-label': 'Opnieuw starten: ' + it.titel, title: 'Opnieuw starten' }),
      knop('✎', 'un-ik', () => { try { D.bewerk(it.i); } catch (e) {} }, { 'aria-label': 'Bewerken: ' + it.titel, title: 'Bewerken' }),
      knop('✕', 'un-ik', () => { try { D.verwijder(it.i); } catch (e) {} }, { 'aria-label': 'Verwijderen: ' + it.titel, title: 'Verwijderen' }));
    const mag = magBoeken();
    if (it.soort === 'gat') return !mag ? null : el('span', { klass: 'un-acties vast' }, knop('Boek ' + klok(it.min), '', () => U.boekGat(m, it), { 'aria-label': 'Boek het gat van ' + it.tijd }));
    if (it.soort === 'agenda') return el('span', { klass: 'un-acties vast' }, mag ? knop('Boek ' + klok(it.min), '', () => U.boekAgenda(m, it)) : null, knop('Negeren', 'ghost', () => { const s = leesNegeer(slAg(m.dagInfo.datum)); s.add(String(it.id)); zetNegeer(slAg(m.dagInfo.datum), s); U.teken(); }));
    if (it.soort === 'gepland') return !mag ? null : el('span', { klass: 'un-acties vast' }, knop('Boek dit', '', () => U.boekGepland(m, it), { 'aria-label': 'Boek het geplande blok ' + it.titel + ' (' + it.tijd + ')', title: 'Dit geplande blok als uren in Toggl boeken' }));
    return null;
  }
  function tijdlijn(m) {
    const H = 56, di = m.dagInfo, ax = di.axis, hoogte = (ax.tot - ax.van) * H, y = min => Math.round((min / 60 - ax.van) * H);
    const uren = []; for (let h = ax.van; h <= ax.tot; h++) uren.push(el('span', { klass: 'un-uur', stijl: { top: ((h - ax.van) * H - 7) + 'px' }, tekst: pad(h) + ':00' }));
    const kolom = el('div', { klass: 'un-kolom', stijl: { height: hoogte + 'px', 'background-size': '100% ' + H + 'px' } });
    di.items.forEach(it => {
      const h = Math.max(22, y(it.tot) - y(it.van) - 4), breed = 100 / (it.lanes || 1);
      const lbl = it.soort === 'gat' ? 'Nog niet geboekt, ' + it.tijd : (it.soort === 'gepland' ? 'Gepland, nog niet geboekt: ' : '') + it.titel + ', ' + it.tijd;
      const knopjes = itemKnop(it, m), inKop = !!knopjes && knopjes.classList.contains('vast') && h < 80;   // een kort blok: de knop staat in de titelrij, anders valt hij buiten het blok
      const c = el('div', { klass: 'un-item ' + it.soort + (h < 46 ? ' kort' : '') + (inKop ? ' knop-in-kop' : ''), 'aria-label': lbl, title: lbl + (it.proj && it.proj.label ? ' · ' + it.proj.label : ''), stijl: { top: (y(it.van) + 2) + 'px', height: h + 'px', left: (it.lane || 0) * breed + '%', width: 'calc(' + breed + '% - 4px)' } },
        el('span', { klass: 'un-item-kop' }, el('span', { klass: 'un-item-titel', tekst: it.titel }), it.soort === 'gepland' ? el('span', { klass: 'un-chip', tekst: 'gepland' }) : null, inKop ? knopjes : null, el('span', { klass: 'un-item-dur', tekst: secKlok(it.sec) })),
        el('span', { klass: 'un-item-sub' }, el('span', { klass: 'un-mono', tekst: it.tijd }), it.soort === 'gepland' ? (it.proj && it.proj.label ? ' · ' + it.proj.label : '') + ' · nog niet geboekt' : it.proj && it.proj.label ? ' · ' + it.proj.label : (it.soort === 'agenda' ? ' · uit je Outlook-agenda' : (it.soort === 'gat' ? (magBoeken() ? ' · klik op Boek of start een timer' : ' · nog niet geboekt') : (it.soort === 'lopend' ? ' · loopt' : (it.soort === 'gepland' ? ' · nog niet geboekt' : ''))))),
        inKop ? null : knopjes);
      if (it.proj && it.proj.kleur && (it.soort === 'entry' || it.soort === 'lopend' || it.soort === 'gepland')) c.style.setProperty('--pk', it.proj.kleur);
      kolom.appendChild(c);
    });
    if (di.nuMin != null && di.nuMin >= ax.van * 60 && di.nuMin <= ax.tot * 60) { kolom.appendChild(el('span', { klass: 'un-nu', 'aria-hidden': 'true', stijl: { top: y(di.nuMin) + 'px' } })); kolom.appendChild(el('span', { klass: 'un-nu-punt', 'aria-hidden': 'true', stijl: { top: (y(di.nuMin) - 4) + 'px' } })); }
    return el('div', { klass: 'un-tijdlijn' }, el('div', { klass: 'un-uren', stijl: { height: hoogte + 'px' } }, uren), kolom);
  }
  function weekTabel(m) {
    const w = m.week, rijen = w.perProject.length ? w.perProject.map(r => el('tr', null,
      el('th', { scope: 'row' }, el('span', { klass: 'un-stip', stijl: { background: r.kleur } }), el('span', { tekst: r.label })),
      r.perDag.map(s => el('td', { klass: 'un-num', tekst: s > 0 ? secKlok(s) : '–' })),
      el('td', { klass: 'un-num un-som', tekst: secKlok(r.sec) }))) : [el('tr', null, el('td', { colspan: '7', klass: 'un-leeg', tekst: 'Deze week zijn nog geen uren geboekt.' }))];
    return el('table', { klass: 'un-weektabel' },
      el('thead', null, el('tr', null, el('th', { scope: 'col', tekst: 'Project' }), m.dagen.map(d => el('th', { scope: 'col', klass: 'un-num', tekst: d.dow + ' ' + Number(d.datum.slice(8)) })), el('th', { scope: 'col', klass: 'un-num', tekst: 'Totaal' }))),
      el('tbody', null, rijen),
      el('tfoot', null, el('tr', null, el('th', { scope: 'row', tekst: 'Totaal' }), m.dagen.map(d => el('td', { klass: 'un-num', tekst: secKlok(d.totSec) })), el('td', { klass: 'un-num un-som', tekst: secKlok(w.totSec) }))));
  }
  function zijkant(m) {
    const w = m.week;
    const perProj = el('section', { klass: 'un-sectie', 'aria-labelledby': 'un-h-week' },
      el('div', { klass: 'un-sectie-kop' }, el('span', { id: 'un-h-week', tekst: 'Week ' + w.nr }), el('span', { klass: 'un-num un-dim', tekst: secKlok(w.totSec) + ' / ' + klok(w.doelMin) })),
      el('div', { klass: 'un-sectie-inhoud' }, w.perProject.length ? w.perProject.map(r => el('div', { klass: 'un-pp' },
        el('span', { klass: 'un-pp-naam' }, el('span', { klass: 'un-stip', stijl: { background: r.kleur } }), el('span', { klass: 'un-pp-tekst', tekst: r.label })), el('span', { klass: 'un-pp-uren', tekst: secKlok(r.sec) }),
        el('span', { klass: 'un-pp-balk' }, el('span', { stijl: { width: r.pct + '%', background: r.kleur } })))) : el('span', { klass: 'un-leeg', tekst: 'Nog geen uren deze week.' })));
    const klaar = el('section', { klass: 'un-sectie', 'aria-labelledby': 'un-h-klaar' },
      el('div', { klass: 'un-sectie-kop' }, el('span', { id: 'un-h-klaar', tekst: 'Klaar zonder uren' }), el('span', { klass: 'un-num un-dim', tekst: String(m.klaar.length) })),
      el('div', { klass: 'un-sectie-inhoud' }, m.klaar.length ? m.klaar.slice(0, 5).map(t => el('div', { klass: 'un-klaar' },
        el('span', { klass: 'un-klaar-naam', tekst: t.naam }),
        el('span', { klass: 'un-dim un-klein', tekst: [t.projLabel, t.wie, t.klaarTekst].filter(Boolean).join(' · ') }),
        el('span', { klass: 'un-klaar-acties' },
          magBoeken() ? knop(t.budgetMin > 0 ? 'Tijd boeken: ' + klok(t.budgetMin) : 'Tijd boeken', 'primair', () => U.boekKlaar(m, t)) : null,
          magBoeken() ? knop('Andere tijd', '', () => U.andereTijd(m, t)) : null,
          knop('Niet nodig', 'ghost', () => { const s = leesNegeer(SL_KLAAR); s.add(String(t.id)); zetNegeer(SL_KLAAR, s); U.teken(); })))) : el('span', { klass: 'un-leeg', tekst: 'Alles wat klaar is heeft uren.' })));
    const dv = D.dagvraagKaart ? D.dagvraagKaart(m.dagInfo.datum, m) : null;
    return el('aside', { klass: 'un-zij' }, perProj, klaar, dv);
  }
  U.teken = function () {
    if (!D) return; const root0 = D.doc.getElementById('uren-nieuw'); if (!root0) return;
    if (!actief()) { root0.hidden = true; root0.textContent = ''; return; }
    root0.hidden = false;
    if (!S.dag) S.dag = standaardDag();
    S.weekStart = maandag(S.dag);
    let m; try { m = model(); } catch (e) { root0.textContent = ''; root0.appendChild(el('div', { klass: 'un-leeg', tekst: 'De uren konden niet worden getoond.' })); return; }
    root0.textContent = '';
    const kop = el('div', { klass: 'un-kop' },
      el('h2', { klass: 'un-titel', tekst: 'Uren' }),
      el('div', { role: 'group', 'aria-label': 'Weergave', klass: 'un-wissel' },
        knop('Dag', S.weergave === 'dag' ? 'sel' : '', () => { S.weergave = 'dag'; U.teken(); }, { 'aria-pressed': S.weergave === 'dag' ? 'true' : 'false' }),
        knop('Week', S.weergave === 'week' ? 'sel' : '', () => { S.weergave = 'week'; U.teken(); }, { 'aria-pressed': S.weergave === 'week' ? 'true' : 'false' })),
      el('div', { klass: 'un-weeknav' },
        knop('‹', '', () => U.weekVerder(-1), { 'aria-label': 'Vorige week' }), el('span', { klass: 'un-weeklabel', tekst: 'Week ' + m.weekNr + ' · ' + kort(m.weekStart) + ' – ' + kort(plus(m.weekStart, 4)) }), knop('›', '', () => U.weekVerder(1), { 'aria-label': 'Volgende week' }),
        knop('Vandaag', 'ghost', () => U.kiesDag(standaardDag()))),
      el('div', { klass: 'un-kopacties' }, S.weergave === 'dag' && D.agenda && !agendaAan() && magBoeken() ? knop('Agenda tonen', '', () => U.agendaAanzetten(), { title: 'Je Outlook-afspraken van deze dag als suggestie tonen' }) : null, knop('Ververs', '', () => U.laad()), magBoeken() ? knop('Tijd boeken', 'primair', () => { try { D.handmatig(); } catch (e) {} }, { title: 'Een handmatige entry maken' }) : null));
    const links = el('section', { klass: 'un-sectie un-hoofd', 'aria-labelledby': 'un-h-dag' },
      el('div', { klass: 'un-sectie-kop' }, el('span', { id: 'un-h-dag', tekst: S.weergave === 'dag' ? m.dagInfo.titel : 'Week ' + m.weekNr }),
        el('span', { klass: 'un-num un-dim', tekst: S.weergave === 'dag' ? (secKlok(m.dagInfo.geboektSec) + ' geboekt' + (m.dagInfo.doelMin > 0 ? ' · ' + klok(m.dagInfo.openMin) + ' open' : '')) : (secKlok(m.week.totSec) + ' geboekt') })),
      S.bezig && !S.geladen ? el('div', { klass: 'un-leeg', tekst: 'Laden…' }) : (S.fout ? el('div', { klass: 'un-leeg fout', role: 'alert', tekst: S.fout }) : (S.weergave === 'dag' ? tijdlijn(m) : weekTabel(m))));
    const melding = S.melding ? el('div', { klass: 'un-melding', role: 'status', tekst: S.melding }) : null;
    root0.appendChild(kop); root0.appendChild(dagTabs(m)); if (melding) root0.appendChild(melding);
    root0.appendChild(el('div', { klass: 'un-onder' }, links, zijkant(m)));
    try { if (D.naTeken) D.naTeken(m); } catch (e) {}   // de dagvraag ziet of een boeking de gaten dichtte
  };

  U.init = function (deps) {
    D = deps; P = deps.planning || root.MTPlanning;
    // De lopende timer groeit: een keer per halve minuut verversen zolang de tab open is (niets dubbel starten of opslaan, alleen tekenen).
    try { if (!U._iv && root.setInterval) U._iv = root.setInterval(() => { try { const t = D.doc.getElementById('tab-toggl'); if (actief() && t && t.classList.contains('active') && D.lopend && D.lopend() && S.geladen) U.teken(); } catch (e) {} }, 30000); } catch (e) {}
    return U;
  };
  U.S = S;
  root.MTUrenNieuw = U;
  if (typeof module !== 'undefined' && module.exports) module.exports = U;
})(typeof window !== 'undefined' ? window : globalThis);
