// mt-cijfers.js — de cijfers bij de rapporten (G9): CEO-balk, kerncijfers en interactieve grafieken (eigen SVG).
// Data van de worker: /geld/cijfers (per maand vanaf 2022; de worker vult de historie in stukken aan),
// /geld/cijfers/detail (drill-down met Moneybird-links), /geld/cijfers/indeling (eigenaar: indeling aanpassen),
// /geld/prognose (omzetprognose), /geld/tijdlijn (kasprognose, als het geldscherm geladen is).
// Altijd per boekjaar (kalenderjaar), nooit rollende 12 maanden. Prognose is gestippeld/gearceerd en telt nooit
// mee in de kerncijfers. Rood/oranje/groen is alleen voor oordelen; categorieën zijn neutrale tinten.
(function (root) {
  'use strict';
  const C = root.MTCijfers = root.MTCijfers || {};
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = n => n == null || !isFinite(n) ? '—' : (n < 0 ? '−' : '') + '€ ' + Math.round(Math.abs(n)).toLocaleString('nl-NL');
  const kort = n => { if (n == null || !isFinite(n)) return '—'; const a = Math.abs(n), t = n < 0 ? '−' : ''; return t + '€ ' + (a >= 1e6 ? (a / 1e6).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + 'M' : a >= 1e4 ? Math.round(a / 1e3) + 'k' : a >= 1e3 ? (a / 1e3).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + 'k' : Math.round(a)); };
  const pct = n => n == null || !isFinite(n) ? '—' : n.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const MND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const maandNaam = ym => `${MND[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
  const START = '2022-01', BTW = 1.21, MAX_RONDES = 15;
  // Neutrale tinten per categorie (geen rood/oranje/groen: die kleuren zijn voor oordelen).
  const TINT = ['#3f4a56', '#6b7682', '#94a0ab', '#2b333c', '#7f8a96', '#b3bcc5', '#56616d', '#a2abb4', '#c9d0d6', '#1f262d', '#8c96a0'];
  const ZOOMS = [['M', 'maand'], ['K', 'kwartaal'], ['J', 'jaar t/m nu'], ['5J', '5 jaar']];
  const WEERGAVEN = [['omzet_kosten', 'Omzet en kosten'], ['brutomarge', 'Brutomarge'], ['kosten_pct', 'Kosten vs branche'], ['opnames', 'Opnames'], ['kas', 'Kas'], ['waterval', 'Waterval']];
  const REEKS_NAAR = { omzet_kosten: 'omzet_kosten', omzet: 'omzet_kosten', kosten: 'omzet_kosten', resultaat: 'omzet_kosten', brutomarge: 'brutomarge', kosten_pct: 'kosten_pct', opnames: 'opnames', kas: 'kas', waterval: 'waterval' };
  const st = C._st = { el: null, bron: null, mag: false, wie: '', maanden: [], cats: [], bm: {}, ontbrekend: [], laden: false, rondes: 0, fout: null, prognose: null, kasProg: null,
    jaar: null, zoom: 'M', weergave: 'omzet_kosten', eerlijk: true, vergelijk: 0, sel: null, focusCat: null, horizon: 'kort', opHorizon: null, correctieVan: null, prive: [], vandaag: null, nietIngedeeld: [] };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };
  const mobiel = () => { try { return root.matchMedia && root.matchMedia('(max-width: 760px)').matches; } catch (e) { return false; } };

  function css() {
    if (document.getElementById('mtc-css')) return;
    const s = document.createElement('style'); s.id = 'mtc-css';
    s.textContent = `
.mtc{font-size:14px;--mtc-zacht:var(--text-faint,#8a8a80);--mtc-lijn:var(--green,#2A4A38)}
.mtc *{box-sizing:border-box}
.mtc-balk{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px}
.mtc-groep{display:inline-flex;border:1px solid var(--border,#ddd);border-radius:22px;overflow:hidden;background:var(--card,#fff)}
.mtc-groep button{border:0;background:none;padding:0 12px;min-height:44px;min-width:44px;font:inherit;font-size:14px;cursor:pointer;color:inherit}
.mtc-groep button.aan{background:var(--green,#2A4A38);color:#fff}
.mtc-knop{border:1px solid var(--border,#ddd);background:var(--card,#fff);border-radius:22px;padding:0 12px;min-height:44px;font:inherit;font-size:14px;cursor:pointer}
.mtc-knop.aan{background:#e8eef9;border-color:#9fb3d6}
.mtc-badge{font-size:11px;background:#e8eef9;color:#3a5a8a;border-radius:10px;padding:1px 7px;margin-left:4px;white-space:nowrap}
.mtc-kpi{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:10px}
.mtc-kpi>div{background:var(--card,#fff);border:1px solid var(--border,#e4e2da);border-radius:10px;padding:8px 10px;min-width:0}
.mtc-kpi .l{font-size:12px;color:var(--mtc-zacht)}.mtc-kpi .w{font-size:18px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mtc-kpi .s{font-size:12px;color:var(--mtc-zacht)}
.mtc-weergaven{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;margin-bottom:6px}
.mtc-weergaven button{flex:0 0 auto}
.mtc-kaart{background:var(--card,#fff);border:1px solid var(--border,#e4e2da);border-radius:10px;padding:10px 12px;margin-bottom:10px}
.mtc-grafiek{touch-action:pan-y;user-select:none;position:relative}
.mtc-grafiek svg{display:block;width:100%;height:auto}
.mtc-grafiek [data-tik]{cursor:pointer}
.mtc-noot{font-size:12px;color:var(--mtc-zacht);margin-top:4px}
.mtc-legenda{display:flex;flex-wrap:wrap;gap:10px;font-size:12px;color:var(--mtc-zacht);margin-top:4px}
.mtc-legenda i{display:inline-block;width:14px;height:10px;margin-right:4px;vertical-align:-1px}
.mtc-euro{display:flex;height:44px;border-radius:8px;overflow:hidden;margin-top:6px}
.mtc-euro button{border:0;padding:0;min-width:3px;cursor:pointer;color:#fff;font-size:11px;overflow:hidden;white-space:nowrap}
.mtc-sheet{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9000;display:flex;align-items:flex-end;justify-content:center}
.mtc-sheet>div{background:var(--card,#fff);width:100%;max-width:640px;max-height:85vh;overflow:auto;border-radius:14px 14px 0 0;padding:14px 16px}
@media(min-width:761px){.mtc-sheet{justify-content:flex-end;align-items:stretch}.mtc-sheet>div{max-width:460px;max-height:none;border-radius:0}}
.mtc-sheet table{width:100%;border-collapse:collapse;font-size:13px}.mtc-sheet td{border-bottom:1px solid var(--border,#eee);padding:5px 4px;vertical-align:top}
.mtc-sheet td.b{text-align:right;white-space:nowrap}
.mtc-sheet select,.mtc-sheet input{font:inherit;font-size:14px;padding:4px 6px;max-width:100%}
.mtc-waarsch{font-size:12px;background:#fbf0dc;border-radius:8px;padding:6px 8px;margin-bottom:8px}
@media(max-width:760px){.mtc-kpi{grid-template-columns:repeat(2,minmax(0,1fr))}.mtc-kpi>div:last-child{grid-column:1/-1}}
`;
    document.head.appendChild(s);
  }

  // ── Rekenen (los te testen) ──────────────────────────────────────────────
  // Maanden optellen tot één periode; met "eerlijk beeld" telt de correctie (lonen via de bank) als personeelskosten.
  C.som = function (ms, cats, eerlijk) {
    const P = { maanden: 0, ontbrekend: 0, omzet: 0, kosten: {}, correctie: 0, prive: {}, prive_totaal: 0, aflossing: 0, kas: null, kasStart: null, prognose: 0, prognoseKosten: 0 };
    for (const c of cats) P.kosten[c] = 0;
    for (const m of ms) {
      if (m.prognose) { P.prognose += m.omzet || 0; P.prognoseKosten += m.kosten_totaal || 0; continue; }
      if (!m.maanden) { P.ontbrekend++; continue; }
      P.maanden++; P.omzet += m.omzet || 0;
      for (const c of cats) P.kosten[c] += (m.kosten || {})[c] || 0;
      P.correctie += m.correctie || 0; P.aflossing += m.aflossing || 0;
      for (const [n, x] of Object.entries(m.prive || {})) { P.prive[n] = (P.prive[n] || 0) + x; P.prive_totaal += x; }
      if (m.kas) { if (!P.kasStart) P.kasStart = m.kas; P.kas = m.kas; }
    }
    if (eerlijk && P.kosten.personeel != null) P.kosten.personeel += P.correctie;
    P.kosten_totaal = Object.values(P.kosten).reduce((a, x) => a + x, 0);
    P.brutomarge = P.omzet - (P.kosten.materiaal || 0) - (P.kosten.uitbesteed || 0);
    P.brutomarge_pct = P.omzet ? P.brutomarge / P.omzet * 100 : null;
    P.resultaat = P.omzet - P.kosten_totaal;
    return P;
  };
  // Periodes voor een zoomstand. M/K: het gekozen boekjaar; J: elk boekjaar t/m dezelfde maand als nu (eerlijk vergelijken); 5J: hele jaren.
  C.periodes = function (maanden, zoom, jaar, laatsteMaand, prog) {
    const per = new Map(), alle = maanden.concat(prog || []);
    const zet = (k, label, m) => { if (!per.has(k)) per.set(k, { id: k, label, ms: [] }); per.get(k).ms.push(m); };
    if (zoom === 'M' || zoom === 'K') {
      for (let i = 1; i <= 12; i++) { const ym = `${jaar}-${String(i).padStart(2, '0')}`; if (zoom === 'M') per.set(ym, { id: ym, label: MND[i - 1], ms: [] }); else { const k = `${jaar}-K${Math.ceil(i / 3)}`; if (!per.has(k)) per.set(k, { id: k, label: 'K' + Math.ceil(i / 3), ms: [] }); } }
      for (const m of alle) if (m.id.startsWith(jaar + '-')) zet(zoom === 'M' ? m.id : `${jaar}-K${Math.ceil(Number(m.id.slice(5)) / 3)}`, null, m);
    } else {
      const tm = laatsteMaand ? Number(laatsteMaand.slice(5, 7)) : 12, j0 = Number(START.slice(0, 4)), j1 = Number(laatsteMaand ? laatsteMaand.slice(0, 4) : jaar);
      for (let j = j0; j <= j1; j++) per.set(String(j), { id: String(j), label: zoom === 'J' ? `${j} t/m ${MND[tm - 1]}` : String(j), ms: [] });
      for (const m of alle) { if (zoom === 'J' && (m.prognose || Number(m.id.slice(5, 7)) > tm)) continue; if (per.has(m.id.slice(0, 4))) per.get(m.id.slice(0, 4)).ms.push(m); }
    }
    return [...per.values()];
  };
  // Omzetprognose voor de rest van het boekjaar: de termijnen uit de prognose (incl. btw → ≈ excl. ÷ 1,21);
  // kosten = het gemiddelde van de afgesloten maanden van dit jaar (anders de laatste 3).
  C.prognose = function (maanden, progItems, vandaag, eerlijk, cats) {
    const jaar = vandaag.slice(0, 4), huidig = vandaag.slice(0, 7), uit = [];
    const dicht = maanden.filter(m => m.maanden && m.id < huidig), ditJaar = dicht.filter(m => m.id.startsWith(jaar + '-'));
    const basis = ditJaar.length >= 3 ? ditJaar : dicht.slice(-3);
    const kostGem = basis.length ? basis.reduce((a, m) => a + C.som([m], cats, eerlijk).kosten_totaal, 0) / basis.length : null;
    for (let i = Number(huidig.slice(5)) + 1; i <= 12; i++) {
      const ym = `${jaar}-${String(i).padStart(2, '0')}`; let omzet = 0, n = 0;
      for (const it of Object.values(progItems || {})) {
        if (!it || it.soort !== 'project' || it.aan === false) continue;
        for (const t of it.termijnen || []) if (t.aan !== false && String(t.factuurdatum || '').slice(0, 7) === ym) { omzet += (t.bedrag || 0) / BTW; n++; }
      }
      uit.push({ id: ym, prognose: true, omzet: Math.round(omzet * 100) / 100, kosten_totaal: kostGem == null ? 0 : Math.round(kostGem * 100) / 100, termijnen: n });
    }
    return { maanden: uit, kostenBasis: basis.length };
  };
  // Waterval: omzet → brutomarge → resultaat → na opnames → na aflossing → werkelijke kasmutatie (rest = btw, debiteuren e.d.).
  // De kasmutatie loopt van de stand vóór de periode (eind van de maand ervoor) tot het eind van de periode; zonder
  // die beginstand geen kasmutatie-stap.
  C.waterval = function (P, kasVoor) {
    const stappen = [{ id: 'omzet', label: 'Omzet', kort: 'omzet', w: P.omzet, totaal: true },
      { id: 'inkoop', label: 'Materiaal en uitbesteed', kort: 'inkoop', w: -((P.kosten.materiaal || 0) + (P.kosten.uitbesteed || 0)) }, { id: 'marge', label: 'Brutomarge', kort: 'marge', w: P.brutomarge, totaal: true },
      { id: 'overig', label: 'Overige kosten', kort: 'overig', w: -(P.kosten_totaal - (P.kosten.materiaal || 0) - (P.kosten.uitbesteed || 0)) }, { id: 'resultaat', label: 'Resultaat', kort: 'resultaat', w: P.resultaat, totaal: true },
      { id: 'prive', label: 'Privé-opnames', kort: 'opnames', w: -P.prive_totaal }, { id: 'aflossing', label: 'Aflossing', kort: 'aflossing', w: -P.aflossing }];
    const naOp = P.resultaat - P.prive_totaal - P.aflossing;
    stappen.push({ id: 'vrij', label: 'Over na opnames en aflossing', kort: 'over', w: naOp, totaal: true });
    if (P.kas && kasVoor && P.kas.met_btw != null && kasVoor.met_btw != null) {
      const mut = P.kas.met_btw - kasVoor.met_btw;
      stappen.push({ id: 'rest', label: 'Btw, debiteuren, afschrijving e.d.', kort: 'btw e.d.', w: mut - naOp, rest: true }, { id: 'kas', label: 'Kasmutatie (lopend + BTW-pot)', kort: 'kas', w: mut, totaal: true });
    }
    return stappen;
  };

  // ── Laden ────────────────────────────────────────────────────────────────
  C.mount = async function (el, opt) {
    st.el = el; st.bron = opt.bron; st.mag = !!opt.magWijzigen; st.wie = opt.wie || ''; st.opHorizon = opt.opHorizon || null; st.horizon = opt.horizon || st.horizon;
    st.vandaag = opt.vandaag || new Date().toISOString().slice(0, 10); st.jaar = st.jaar || Number(st.vandaag.slice(0, 4));
    st.eerlijk = ls.get('mtc:eerlijk:' + st.wie) !== '0';
    const v = ls.get('mtc:vergelijk:' + st.wie); st.vergelijk = v != null ? Math.max(0, Math.min(2, Number(v) || 0)) : (mobiel() ? 0 : 1);
    css(); teken();
    if (!st.maanden.length && !st.laden) await C.laad();
  };
  C.laad = async function (herbouw) {
    st.laden = true; st.rondes = 0; st.fout = null; const mislukt = new Set();
    const [prog] = await Promise.all([st.bron.haal('/geld/prognose').catch(() => null)]);
    st.prognoseRuw = prog && prog.items ? prog.items : {};
    for (;;) {
      const r = await st.bron.haal(`/geld/cijfers?per=maand&van=${START}&tot=${st.vandaag.slice(0, 7)}${herbouw && !st.rondes ? '&herbouw=' + encodeURIComponent(herbouw) : ''}`);
      if (!r || r.error) { st.fout = (r && r.error) || 'geen antwoord'; break; }
      st.maanden = r.perioden || []; st.cats = (r.categorieen || []).map(c => c.id); st.catNaam = Object.fromEntries((r.categorieen || []).map(c => [c.id, c.naam]));
      st.bm = r.benchmarks || {}; st.bmBron = r.benchmarks_bron; st.ontbrekend = r.ontbrekend || []; st.correctieVan = r.correctie_van; st.voorstel = r.indeling_voorstel || 0;
      st.nietIngedeeld = r.niet_ingedeeld || []; st.waarsch = r.waarschuwingen || []; st.equityOver = r.equity_niet_ingedeeld || [];
      (r.mislukt || []).forEach(m => mislukt.add(m)); st.mislukt = [...mislukt].filter(m => st.ontbrekend.includes(m)).sort();
      teken();
      // stoppen als alles wat nog ontbreekt al eens mislukte (Moneybird gaf het niet): niet blijven proberen
      if (r.compleet || st.ontbrekend.every(m => mislukt.has(m)) || ++st.rondes >= MAX_RONDES || !st.el || !st.el.isConnected) break;
      await new Promise(res => setTimeout(res, C._pauze == null ? 1500 : C._pauze));
    }
    st.laden = false; teken();
    kasPrognose();
  };
  // Kasprognose uit de geldtijdlijn (zelfde rekenregels), alleen als het geldscherm geladen is.
  async function kasPrognose() {
    if (!root.MTGeld || !root.MTGeld.lijn) return;
    try {
      const v = st.vandaag, d = await st.bron.haal(`/geld/tijdlijn?van=${C._dag(v, -35)}&tot=${C._dag(v, 364)}`); if (!d || d.error || !d.events) return;
      const met = root.MTGeld.lijn(d, { modus: 'lopend', prognose: true }).punten, zonder = root.MTGeld.lijn(d, { modus: 'lopend', prognose: true, groep: ['lopend'] }).punten;
      const uit = [];
      for (let i = Number(v.slice(5, 7)); i <= 12; i++) {
        const ym = `${v.slice(0, 4)}-${String(i).padStart(2, '0')}`, eind = C._eind(ym), p = met.filter(x => x.datum <= eind && !x.verleden).pop(), q = zonder.filter(x => x.datum <= eind && !x.verleden).pop();
        if (p) uit.push({ id: ym, met_btw: p.saldo, lopend: q ? q.saldo : null });
      }
      st.kasProg = uit; teken();
    } catch (e) { }
  }
  C._maandPlus = (ym, n) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
  C._dag = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  C._eind = ym => `${ym}-${String(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
  // Een rapportsectie opent de grafiek in context.
  C.toon = function (g) {
    if (!g) return;
    st.weergave = REEKS_NAAR[g.reeks] || 'omzet_kosten'; st.focusCat = g.categorie || null;
    if (g.per) st.zoom = g.per === 'kwartaal' ? 'K' : g.per === 'jaar' ? '5J' : 'M';
    if (g.van && /^\d{4}/.test(g.van)) st.jaar = Number(g.van.slice(0, 4));
    st.sel = null; teken();
  };
  C.horizon = function (h) { st.horizon = h; teken(); };

  // ── Tekenen ──────────────────────────────────────────────────────────────
  // laatste afgesloten maand: de lopende maand is nog niet compleet en telt niet mee in vergelijkingen en kerncijfers
  const laatste = () => { const h = st.vandaag.slice(0, 7), m = st.maanden.filter(x => x.maanden && x.id < h).map(x => x.id).sort(); return m[m.length - 1] || null; };
  function huidigePeriodes() {
    const prog = st.jaar === Number(st.vandaag.slice(0, 4)) && (st.zoom === 'M' || st.zoom === 'K' || st.zoom === '5J') ? C.prognose(st.maanden, st.prognoseRuw, st.vandaag, st.eerlijk, st.cats).maanden : [];
    return C.periodes(st.maanden, st.zoom, st.jaar, laatste(), prog).map(p => Object.assign(p, { P: C.som(p.ms, st.cats, st.eerlijk) }));
  }
  function teken() {
    if (!st.el) return;
    maat();
    const per = st.maanden.length ? huidigePeriodes() : [];
    const balk = `<div class="mtc-balk">
      ${st.zoom === 'M' || st.zoom === 'K' ? `<div class="mtc-groep"><button data-jaar="-1" aria-label="Vorig boekjaar" ${st.jaar <= Number(START.slice(0, 4)) ? 'disabled' : ''}>‹</button><button disabled style="font-weight:600">${st.jaar}</button><button data-jaar="1" aria-label="Volgend boekjaar" ${st.jaar >= Number(st.vandaag.slice(0, 4)) ? 'disabled' : ''}>›</button></div>` : ''}
      <div class="mtc-groep" role="group" aria-label="Zoom">${ZOOMS.map(([k, t]) => `<button data-zoom="${k}" title="${esc(t)}" class="${st.zoom === k ? 'aan' : ''}">${k}</button>`).join('')}</div>
      <button class="mtc-knop ${st.eerlijk ? 'aan' : ''}" data-eerlijk="1" aria-pressed="${st.eerlijk}">Eerlijk beeld${st.eerlijk ? '<span class="mtc-badge">incl. niet-in-W&amp;V lonen</span>' : ''}</button>
      <div class="mtc-groep" role="group" aria-label="Vergelijk jaren">${[[0, 'geen'], [1, '−1 jaar'], [2, '−2 jaar']].map(([n, t]) => `<button data-vergelijk="${n}" class="${st.vergelijk === n ? 'aan' : ''}">${n ? esc(t) : 'Vergelijk: uit'}</button>`).join('')}</div>
      <div class="mtc-groep" role="group" aria-label="Horizon advies"><button data-horizon="kort" class="${st.horizon === 'kort' ? 'aan' : ''}">Korte termijn</button><button data-horizon="lang" class="${st.horizon === 'lang' ? 'aan' : ''}">Lange termijn</button></div>
      ${st.mag ? '<button class="mtc-knop" data-indeling="1" title="Indeling grootboeken, privé, aflossing, loonpatronen, branche">⚙ Indeling</button>' : ''}</div>`;
    let midden;
    if (st.fout && !st.maanden.length) midden = `<div class="mtc-kaart">Cijfers konden niet worden geladen: ${esc(st.fout)}.</div>`;
    else if (!st.maanden.length) midden = '<div class="mtc-kaart mtc-noot">Cijfers laden…</div>';
    else midden = kpiHtml() + `<div class="mtc-weergaven" role="tablist">${WEERGAVEN.map(([k, t]) => `<button class="mtc-knop ${st.weergave === k ? 'aan' : ''}" role="tab" aria-selected="${st.weergave === k}" data-weergave="${k}">${esc(t)}</button>`).join('')}</div>
      <div class="mtc-kaart">${grafiekHtml(per)}</div>`;
    const nogTeGaan = st.ontbrekend.length - (st.mislukt || []).length;
    const status = [nogTeGaan > 0 ? `Historie wordt opgebouwd: nog ${nogTeGaan} maand${nogTeGaan === 1 ? '' : 'en'} te gaan${st.laden ? '…' : ' (ververs later)'}.` : '',
      st.voorstel ? `${st.voorstel} grootboek${st.voorstel === 1 ? '' : 'en'} ingedeeld volgens het voorstel${st.mag ? ' — controleer de indeling (⚙)' : ''}.` : '',
      (st.equityOver || []).length ? `Privé-opnames: alleen rekeningen met privé, opname of onttrek in de naam tellen nu mee. Niet ingedeeld: ${st.equityOver.join(', ')}${st.mag ? ' — kies in ⚙ Indeling' : ''}.` : '',
      (st.mislukt || []).length ? `${st.mislukt.length} maand${st.mislukt.length === 1 ? '' : 'en'} kon${st.mislukt.length === 1 ? '' : 'den'} niet worden opgehaald (${st.mislukt.map(maandNaam).join(', ')}) — probeer later opnieuw.` : '',
      st.fout && st.maanden.length ? 'Laatste aanvulling mislukte: ' + st.fout : ''].filter(Boolean);
    st.el.innerHTML = `<div class="mtc">${balk}${status.length ? `<div class="mtc-waarsch">${status.map(esc).join('<br>')}</div>` : ''}${midden}</div>`;
    st.el.querySelector('.mtc').addEventListener('click', klik);
    gebaren();
  }
  // Kerncijfers: het boekjaar t/m de laatste afgesloten maand (of de gekozen periode), tegenover hetzelfde deel van vorig jaar. Nooit prognose.
  function kpiHtml() {
    const lm = laatste(); if (!lm) return '';
    const jaar = st.sel ? null : st.jaar, tm = jaar === Number(lm.slice(0, 4)) ? Number(lm.slice(5, 7)) : 12;
    const kies = (j, t) => st.maanden.filter(m => m.id.startsWith(j + '-') && Number(m.id.slice(5, 7)) <= t);
    const sel = st.sel ? st.sel.ms.filter(m => !m.prognose) : kies(jaar, tm), vorig = st.sel ? st.sel.ms.filter(m => !m.prognose).map(m => st.maanden.find(x => x.id === `${Number(m.id.slice(0, 4)) - 1}${m.id.slice(4)}`)).filter(Boolean) : kies(jaar - 1, tm);
    const A = C.som(sel, st.cats, st.eerlijk), B = vorig.length ? C.som(vorig, st.cats, st.eerlijk) : null;
    const d = (a, b) => b == null || !b ? '' : `${a >= b ? '▲' : '▼'} ${pct(Math.abs((a - b) / Math.abs(b) * 100))} t.o.v. vorig jaar`;
    const label = st.sel ? st.sel.label || st.sel.id : `${jaar} t/m ${MND[tm - 1]}`;
    return `<div class="mtc-noot" style="margin:-2px 0 4px">Kerncijfers ${esc(label)}${st.sel ? ' · <a href="#" data-wissel="1">terug naar het boekjaar</a>' : ''}</div><div class="mtc-kpi">
      <div><div class="l">Omzet</div><div class="w">${kort(A.omzet)}</div><div class="s">${esc(d(A.omzet, B && B.omzet))}</div></div>
      <div><div class="l">Brutomarge</div><div class="w">${pct(A.brutomarge_pct)}</div><div class="s">${esc(kort(A.brutomarge))}${st.bm.brutomarge ? ' · branche ' + esc(bmTekst(st.bm.brutomarge)) : ''}</div></div>
      <div><div class="l">Resultaat${st.eerlijk && A.correctie ? ' (eerlijk)' : ''}</div><div class="w">${kort(A.resultaat)}</div><div class="s">${A.omzet ? esc(pct(A.resultaat / A.omzet * 100)) + ' van de omzet' : ''}${st.eerlijk && A.correctie ? ' · incl. ' + esc(kort(A.correctie)) + ' lonen buiten de W&V' : ''}</div></div>
      <div><div class="l">Opnames</div><div class="w">${kort(A.prive_totaal)}</div><div class="s">${esc(Object.entries(A.prive).map(([n, x]) => n + ' ' + kort(x)).join(' · ') || '—')}</div></div>
      <div><div class="l">Kaspositie</div><div class="w">${kort(A.kas && A.kas.met_btw)}</div><div class="s">lopend ${esc(kort(A.kas && A.kas.lopend))}${A.kas ? ' · eind ' + esc(maandNaam(A.kas.maand || lm)) : ''}</div></div></div>`;
  }
  const bmTekst = b => b.van != null && b.tot != null ? `${pct(b.van)}–${pct(b.tot)}` : pct(b.pct);
  const bmMid = b => !b ? null : b.pct != null ? b.pct : (b.van + b.tot) / 2;

  // ── Grafieken ──
  // De viewBox volgt de breedte (anders worden de letters op een telefoon onleesbaar klein).
  let BR = 640, HO = 260; const ML = 52, MR = 12, MT = 24, MB = 30;   // MT: ruimte boven de grafiek voor het label "vanaf hier prognose"
  function maat() { const b = (st.el && st.el.clientWidth) || 640; BR = Math.max(320, Math.min(900, b - 24)); HO = BR < 500 ? 230 : 260; }
  function schaal(min, max) { if (min === max) { max = min + 1; } const stap = Math.pow(10, Math.floor(Math.log10((max - min) / 4))), s = [1, 2, 2.5, 5, 10].map(x => x * stap).find(x => (max - min) / x <= 5) || stap * 10;
    const a = Math.floor(min / s) * s, b = Math.ceil(max / s) * s, ticks = []; for (let v = a; v <= b + s / 2; v += s) ticks.push(Math.round(v * 100) / 100); return { a, b, ticks }; }
  function assen(sc, y, fmt, n) {
    return sc.ticks.map(t => `<g><line x1="${ML}" x2="${BR - MR}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? '#9aa' : '#e6e6e0'}"/><text x="${ML - 6}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="#888">${esc(fmt(t))}</text></g>`).join('');
  }
  const defs = `<defs><pattern id="mtc-arcering" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#eef1f6"/><line x1="0" y1="0" x2="0" y2="6" stroke="#9fb3d6" stroke-width="2"/></pattern>
    <pattern id="mtc-corr" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="6" height="6" fill="#f3e9d2"/><line x1="0" y1="0" x2="0" y2="6" stroke="#a5803a" stroke-width="2"/></pattern>
    <pattern id="mtc-streep" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="5" height="5" fill="#d5d9de"/><line x1="0" y1="0" x2="0" y2="5" stroke="#8c96a0" stroke-width="1.5"/></pattern></defs>`;
  function vergelijkReeks(per, f) {   // dezelfde periodes in eerdere jaren (alleen M/K)
    if (!st.vergelijk || !(st.zoom === 'M' || st.zoom === 'K')) return [];
    return Array.from({ length: st.vergelijk }, (_, i) => { const j = st.jaar - 1 - i; if (j < Number(START.slice(0, 4))) return null;
      const pv = C.periodes(st.maanden, st.zoom, j, laatste(), []).map(p => Object.assign(p, { P: C.som(p.ms, st.cats, st.eerlijk) }));
      return { jaar: j, w: pv.map(p => p.P.maanden ? f(p.P) : null) }; }).filter(Boolean);
  }
  function grafiekHtml(per) {
    const g = st.weergave;
    if (g === 'kosten_pct') return bulletHtml();
    if (g === 'waterval') return watervalHtml();
    const n = per.length, bw = (BR - ML - MR) / n, x = i => ML + i * bw + bw / 2;
    st.geo = { weergave: g, n, bw, ids: per.map(p => p.id), segs: [] };   // voor tikken op de x-positie (smalle staven op mobiel)
    const progStart = per.findIndex(p => p.ms.length && p.ms.every(m => m.prognose));
    let svg = '', leg = [], noot = [];
    if (g === 'omzet_kosten') {
      const hoog = Math.max(1, ...per.map(p => Math.max(p.P.omzet + p.P.prognose, p.P.kosten_totaal + p.P.prognoseKosten))), laag = Math.min(0, ...per.map(p => p.P.resultaat), ...per.map(p => p.P.prognose || p.P.prognoseKosten ? p.P.omzet + p.P.prognose - p.P.kosten_totaal - p.P.prognoseKosten : 0));   // ook de prognoselijn past op de as
      const sc = schaal(laag, hoog), y = v => MT + (HO - MT - MB) * (1 - (v - sc.a) / (sc.b - sc.a));
      svg += assen(sc, y, kort);
      per.forEach((p, i) => {
        let top = 0; const P = p.P, w = Math.max(4, bw * 0.62), x0 = x(i) - w / 2, gekozen = st.sel && st.sel.id === p.id;
        if (gekozen) svg += `<rect x="${ML + i * bw}" y="${MT}" width="${bw}" height="${HO - MT - MB}" fill="#eef1f6"/>`;
        const segs = st.geo.segs[i] = [];
        st.cats.forEach((c, k) => { const v = c === 'personeel' && st.eerlijk ? P.kosten[c] - P.correctie : P.kosten[c]; if (!(v > 0)) return; const y1 = y(top + v), y0 = y(top); top += v; segs.push({ tik: 'kosten', cat: c, y1, y2: y0 });
          const dim = st.focusCat && st.focusCat !== c ? ' opacity="0.25"' : '';
          svg += `<rect data-tik="kosten" data-p="${esc(p.id)}" data-cat="${c}" x="${x0}" y="${y1}" width="${w}" height="${Math.max(0.5, y0 - y1)}" fill="${TINT[k % TINT.length]}"${dim}><title>${esc((st.catNaam[c] || c) + ' ' + (p.label || p.id) + ': ' + eur(v))}</title></rect>`; });
        if (st.eerlijk && P.correctie > 0) { const y1 = y(top + P.correctie), y0 = y(top); top += P.correctie; segs.push({ tik: 'correctie', y1, y2: y0 });
          svg += `<rect data-tik="correctie" data-p="${esc(p.id)}" x="${x0}" y="${y1}" width="${w}" height="${Math.max(0.5, y0 - y1)}" fill="url(#mtc-corr)"><title>${esc('lonen buiten de W&V (eerlijk beeld) ' + (p.label || p.id) + ': ' + eur(P.correctie))}</title></rect>`; }
        if (P.maanden) segs.push({ tik: 'omzet', y1: y(P.omzet) - 2, y2: y(P.omzet) + 2 });
        if (P.prognoseKosten) svg += `<rect data-tik="periode" data-p="${esc(p.id)}" x="${x0}" y="${y(top + P.prognoseKosten)}" width="${w}" height="${Math.max(0.5, y(top) - y(top + P.prognoseKosten))}" fill="url(#mtc-arcering)" stroke="#9fb3d6" stroke-dasharray="3 2"><title>prognose kosten ${esc(eur(P.prognoseKosten))}</title></rect>`;
        if (P.maanden) svg += `<line data-tik="omzet" data-p="${esc(p.id)}" x1="${x0 - 3}" x2="${x0 + w + 3}" y1="${y(P.omzet)}" y2="${y(P.omzet)}" stroke="#1d3557" stroke-width="3"><title>omzet ${esc(eur(P.omzet))}</title></line>`;
        if (P.prognose) svg += `<line x1="${x0 - 3}" x2="${x0 + w + 3}" y1="${y(P.omzet + P.prognose)}" y2="${y(P.omzet + P.prognose)}" stroke="#1d3557" stroke-width="2" stroke-dasharray="4 3"><title>prognose omzet ≈ ${esc(eur(P.prognose))} (excl. btw)</title></line>`;
        svg += `<rect data-tik="periode" data-p="${esc(p.id)}" x="${ML + i * bw}" y="${HO - MB}" width="${bw}" height="${MB}" fill="transparent"/><text x="${x(i)}" y="${HO - MB + 14}" text-anchor="middle" font-size="11" fill="#666">${esc(p.label || p.id)}</text>`;
      });
      const res = per.map((p, i) => p.P.maanden ? [x(i), y(p.P.resultaat)] : null);
      svg += pad(res, '#2A4A38', 2.5) + res.map((q, i) => q ? `<circle data-tik="periode" data-p="${esc(per[i].id)}" cx="${q[0]}" cy="${q[1]}" r="${st.sel && st.sel.id === per[i].id ? 6 : 4}" fill="#2A4A38"><title>resultaat ${esc(eur(per[i].P.resultaat))}</title></circle>` : '').join('');
      const resProg = per.map((p, i) => p.P.prognose || p.P.prognoseKosten ? [x(i), y(p.P.omzet + p.P.prognose - p.P.kosten_totaal - p.P.prognoseKosten)] : null);
      svg += pad(resProg, '#2A4A38', 2, '4 4');
      if (!st.eerlijk) { const ref = per.map((p, i) => p.P.maanden && p.P.correctie ? [x(i), y(p.P.resultaat - p.P.correctie)] : null); if (ref.some(Boolean)) { svg += pad(ref, '#2A4A38', 1.2, '2 3'); noot.push('Dunne stippellijn: resultaat mét de lonen die niet in de W&V staan (eerlijk beeld).'); } }
      vergelijkReeks(per, P => P.omzet).forEach((r, k) => { svg += pad(r.w.map((v, i) => v == null ? null : [x(i), y(v)]), '#9aa3ad', 1.5, k ? '2 4' : '6 3'); leg.push([`border-top:2px ${k ? 'dotted' : 'dashed'} #9aa3ad;height:0`, `omzet ${r.jaar}`]); });
      leg.unshift(['background:#3f4a56', 'kosten (tik voor de categorie)'], ['border-top:3px solid #1d3557;height:0', 'omzet'], ['border-top:3px solid #2A4A38;height:0', 'resultaat']);
      if (st.eerlijk && per.some(p => p.P.correctie > 0)) leg.splice(3, 0, ['background:repeating-linear-gradient(135deg,#f3e9d2 0 3px,#a5803a 3px 5px)', 'lonen buiten de W&V (eerlijk beeld)']);
      if (per.some(p => p.P.prognose || p.P.prognoseKosten)) leg.push(['background:url(#x);background:repeating-linear-gradient(45deg,#eef1f6 0 3px,#9fb3d6 3px 5px)', 'prognose']);
    } else if (g === 'brutomarge') {
      const vals = per.map(p => p.P.maanden ? p.P.brutomarge_pct : null), bm = st.bm.brutomarge, top = Math.max(70, ...vals.filter(v => v != null), bm ? (bm.tot || bm.pct || 0) + 10 : 0);
      const sc = schaal(0, top), y = v => MT + (HO - MT - MB) * (1 - (v - sc.a) / (sc.b - sc.a));         // %-as altijd vanaf 0
      svg += assen(sc, y, v => v + '%');
      if (bm) svg += bm.van != null && bm.tot != null ? `<rect x="${ML}" y="${y(bm.tot)}" width="${BR - ML - MR}" height="${y(bm.van) - y(bm.tot)}" fill="#e4e7eb"/>` : `<line x1="${ML}" x2="${BR - MR}" y1="${y(bm.pct)}" y2="${y(bm.pct)}" stroke="#7f8a96" stroke-width="2" stroke-dasharray="6 3"/>`;
      per.forEach((p, i) => { const v = vals[i], w = Math.max(4, bw * 0.55);
        if (v != null) svg += `<rect data-tik="periode" data-p="${esc(p.id)}" x="${x(i) - w / 2}" y="${y(Math.max(0, v))}" width="${w}" height="${Math.abs(y(Math.max(0, v)) - y(0))}" fill="${st.sel && st.sel.id === p.id ? '#1d3557' : '#56616d'}"><title>${esc((p.label || p.id) + ': ' + pct(v))}</title></rect>`;
        svg += `<rect data-tik="periode" data-p="${esc(p.id)}" x="${ML + i * bw}" y="${HO - MB}" width="${bw}" height="${MB}" fill="transparent"/><text x="${x(i)}" y="${HO - MB + 14}" text-anchor="middle" font-size="11" fill="#666">${esc(p.label || p.id)}</text>`; });
      vergelijkReeks(per, P => P.brutomarge_pct).forEach((r, k) => { svg += pad(r.w.map((v, i) => v == null ? null : [x(i), y(v)]), '#9aa3ad', 1.5, k ? '2 4' : '6 3'); leg.push([`border-top:2px ${k ? 'dotted' : 'dashed'} #9aa3ad;height:0`, String(r.jaar)]); });
      leg.unshift(['background:#56616d', 'brutomarge %']); if (bm) leg.push(['background:#e4e7eb', 'branche ' + bmTekst(bm) + (bm.bron ? ' (' + bm.bron + ')' : '')]);
      noot.push('Brutomarge = omzet − materiaal − uitbesteed werk, als % van de omzet. De as begint bij 0%.');
    } else if (g === 'opnames') {
      const namen = [...new Set(per.flatMap(p => Object.keys(p.P.prive)))];
      const hoog = Math.max(1, ...per.map(p => Math.max(p.P.prive_totaal + p.P.aflossing, p.P.maanden ? p.P.resultaat : 0))), laag = Math.min(0, ...per.map(p => p.P.maanden ? p.P.resultaat : 0));
      const sc = schaal(laag, hoog), y = v => MT + (HO - MT - MB) * (1 - (v - sc.a) / (sc.b - sc.a)); svg += assen(sc, y, kort);
      per.forEach((p, i) => { let top = 0; const w = Math.max(4, bw * 0.55), x0 = x(i) - w / 2;
        namen.forEach((nm, k) => { const v = p.P.prive[nm] || 0; if (!(v > 0)) return; svg += `<rect data-tik="prive" data-p="${esc(p.id)}" x="${x0}" y="${y(top + v)}" width="${w}" height="${y(top) - y(top + v)}" fill="${['#3f4a56', '#94a0ab', '#6b7682'][k % 3]}"><title>${esc(nm + ': ' + eur(v))}</title></rect>`; top += v; });
        if (p.P.aflossing > 0) svg += `<rect data-tik="aflossing" data-p="${esc(p.id)}" x="${x0}" y="${y(top + p.P.aflossing)}" width="${w}" height="${y(top) - y(top + p.P.aflossing)}" fill="url(#mtc-streep)"><title>aflossing ${esc(eur(p.P.aflossing))}</title></rect>`;
        svg += `<rect data-tik="periode" data-p="${esc(p.id)}" x="${ML + i * bw}" y="${HO - MB}" width="${bw}" height="${MB}" fill="transparent"/><text x="${x(i)}" y="${HO - MB + 14}" text-anchor="middle" font-size="11" fill="#666">${esc(p.label || p.id)}</text>`; });
      svg += pad(per.map((p, i) => p.P.maanden ? [x(i), y(p.P.resultaat)] : null), '#2A4A38', 2.5);
      leg = namen.slice(0, 3).map((nm, k) => [`background:${['#3f4a56', '#94a0ab', '#6b7682'][k % 3]}`, 'opname ' + nm]).concat([['background:repeating-linear-gradient(-45deg,#d5d9de 0 3px,#8c96a0 3px 4px)', 'aflossing'], ['border-top:3px solid #2A4A38;height:0', 'resultaat']]);
      noot.push('Opnames en aflossing komen uit het resultaat (of uit de kas als het resultaat niet genoeg is).');
    } else if (g === 'kas') {
      const pts = per.map(p => p.P.kas), prog = st.zoom === 'M' && st.jaar === Number(st.vandaag.slice(0, 4)) ? (st.kasProg || []) : [];
      const alle = pts.filter(Boolean).flatMap(k => [k.lopend, k.met_btw]).concat(prog.flatMap(k => [k.lopend, k.met_btw])).filter(v => v != null);
      const sc = schaal(Math.min(0, ...alle), Math.max(1, ...alle)), y = v => MT + (HO - MT - MB) * (1 - (v - sc.a) / (sc.b - sc.a)); svg += assen(sc, y, kort);
      svg += pad(pts.map((k, i) => k && k.met_btw != null ? [x(i), y(k.met_btw)] : null), '#1d3557', 2.5) + pad(pts.map((k, i) => k && k.lopend != null ? [x(i), y(k.lopend)] : null), '#7f8a96', 2);
      if (prog.length) { const xi = id => per.findIndex(p => p.id === id); svg += pad(prog.map(k => xi(k.id) >= 0 && k.met_btw != null ? [x(xi(k.id)), y(k.met_btw)] : null), '#1d3557', 2, '4 4') + pad(prog.map(k => xi(k.id) >= 0 && k.lopend != null ? [x(xi(k.id)), y(k.lopend)] : null), '#7f8a96', 1.5, '4 4'); }
      per.forEach((p, i) => { if (pts[i]) svg += `<circle data-tik="periode" data-p="${esc(p.id)}" cx="${x(i)}" cy="${y(pts[i].met_btw != null ? pts[i].met_btw : pts[i].lopend)}" r="${st.sel && st.sel.id === p.id ? 6 : 4}" fill="#1d3557"><title>${esc((p.label || p.id) + ': lopend + BTW-pot ' + eur(pts[i].met_btw) + ', lopend ' + eur(pts[i].lopend))}</title></circle>`;
        svg += `<rect data-tik="periode" data-p="${esc(p.id)}" x="${ML + i * bw}" y="${HO - MB}" width="${bw}" height="${MB}" fill="transparent"/><text x="${x(i)}" y="${HO - MB + 14}" text-anchor="middle" font-size="11" fill="#666">${esc(p.label || p.id)}</text>`; });
      vergelijkReeks(per, P => P.kas && P.kas.met_btw).forEach((r, k) => { svg += pad(r.w.map((v, i) => v == null ? null : [x(i), y(v)]), '#9aa3ad', 1.5, k ? '2 4' : '6 3'); leg.push([`border-top:2px ${k ? 'dotted' : 'dashed'} #9aa3ad;height:0`, String(r.jaar)]); });
      leg.unshift(['border-top:3px solid #1d3557;height:0', 'lopend + BTW-pot'], ['border-top:3px solid #7f8a96;height:0', 'lopend']);
      if (prog.length) leg.push(['border-top:2px dashed #1d3557;height:0', 'prognose (geldtijdlijn)']);
      noot.push('Stand op het maandeinde (balans in Moneybird). Een €-as die niet bij 0 begint, staat er niet: de as loopt altijd door 0.');
    }
    if (progStart >= 0 && g !== 'opnames') { svg += `<line x1="${ML + progStart * bw}" x2="${ML + progStart * bw}" y1="${MT - 18}" y2="${HO - MB}" stroke="#9fb3d6" stroke-dasharray="3 3"/><text x="${ML + progStart * bw + (ML + progStart * bw > BR - 130 ? -4 : 4)}" y="${MT - 8}" text-anchor="${ML + progStart * bw > BR - 130 ? 'end' : 'start'}" font-size="11" fill="#3a5a8a">vanaf hier prognose</text>`;
      const pr = C.prognose(st.maanden, st.prognoseRuw, st.vandaag, st.eerlijk, st.cats); noot.push(`Prognose: omzet uit de termijnen in de prognose (≈ excl. 21% btw), kosten = gemiddelde van ${pr.kostenBasis} afgesloten maand${pr.kostenBasis === 1 ? '' : 'en'}. Telt nooit mee in de kerncijfers.`); }
    if (per.some(p => p.P.ontbrekend && !p.ms.every(m => m.prognose))) noot.push('Niet alle maanden zijn al opgehaald (zie boven).');
    leg = leg.slice(0, 6);
    return `<div class="mtc-grafiek" data-grafiek="${esc(g)}"><svg viewBox="0 0 ${BR} ${HO}" role="img" aria-label="${esc(WEERGAVEN.find(w => w[0] === g)[1])}">${defs}${svg}</svg></div>
      <div class="mtc-legenda">${leg.map(([s, t]) => `<span><i style="${s}"></i>${esc(t)}</span>`).join('')}</div>${noot.map(t => `<div class="mtc-noot">${esc(t)}</div>`).join('')}
      ${g === 'omzet_kosten' ? euroHtml(per) : ''}`;
  }
  function pad(pts, kleur, dikte, streep) {
    let d = '', open = false; for (const q of pts) { if (!q) { open = false; continue; } d += (open ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1) + ' '; open = true; }
    return d ? `<path d="${d}" fill="none" stroke="${kleur}" stroke-width="${dikte}"${streep ? ` stroke-dasharray="${streep}"` : ''}/>` : '';
  }
  // "Waar ging elke € omzet heen": één balk, per categorie aan te tikken (de gekozen periode, anders het boekjaar t/m nu).
  const selP = () => C.som(st.sel.ms.filter(m => !m.prognose), st.cats, st.eerlijk);   // altijd opnieuw (eerlijk beeld kan gewisseld zijn)
  function euroHtml(per) {
    const P = st.sel ? selP() : C.som(per.flatMap(p => p.ms.filter(m => !m.prognose)), st.cats, st.eerlijk); if (!(P.omzet > 0)) return '';
    const delen = st.cats.map((c, k) => ({ c, v: P.kosten[c], kleur: TINT[k % TINT.length] })).filter(x => x.v > 0);
    const res = P.resultaat;
    return `<div class="mtc-noot" style="margin-top:10px"><b>Waar ging elke € 1 omzet heen</b> (${esc(st.sel ? st.sel.label || st.sel.id : st.jaar + ' t/m nu')}) — tik op een deel</div>
      <div class="mtc-euro" role="group">${delen.map(x => `<button data-euro="${x.c}" style="background:${x.kleur};flex:${x.v / P.omzet}" title="${esc((st.catNaam[x.c] || x.c) + ': ' + Math.round(x.v / P.omzet * 100) + ' ct per € omzet')}">${x.v / P.omzet > 0.08 ? esc(Math.round(x.v / P.omzet * 100) + 'ct') : ''}</button>`).join('')}
      ${res > 0 ? `<button data-euro="resultaat" style="background:#2A4A38;flex:${res / P.omzet}" title="${esc('resultaat: ' + Math.round(res / P.omzet * 100) + ' ct')}">${res / P.omzet > 0.08 ? esc(Math.round(res / P.omzet * 100) + 'ct') : ''}</button>` : ''}</div>
      ${res < 0 ? `<div class="mtc-noot">De kosten zijn ${esc(Math.round(-res / P.omzet * 100))} ct per € omzet hoger dan de omzet (verlies).</div>` : ''}<div id="mtc-euro-uitleg" class="mtc-noot"></div>`;
  }
  // Bullet charts: eigen kosten als % van de omzet tegenover de branche (CBS-marker of -band).
  function bulletHtml() {
    const lm = laatste(), tm = st.jaar === Number((lm || '').slice(0, 4)) ? Number(lm.slice(5, 7)) : 12;
    const P = st.sel ? selP() : C.som(st.maanden.filter(m => m.id.startsWith(st.jaar + '-') && Number(m.id.slice(5, 7)) <= tm), st.cats, st.eerlijk);
    if (!(P.omzet > 0)) return '<div class="mtc-noot">Geen omzet in deze periode.</div>';
    const rij = (id, naam, v, b, tik, schaal) => { const max = schaal || Math.max(10, v * 1.25, b ? (b.tot || b.pct || 0) * 1.5 : 0), sx = q => 4 + (Math.min(q, max) / max) * 92;
      const bmEl = !b ? '' : b.van != null && b.tot != null ? `<rect x="${sx(b.van)}%" y="4" width="${sx(b.tot) - sx(b.van)}%" height="20" fill="#d5d9de"/>` : `<line x1="${sx(b.pct)}%" x2="${sx(b.pct)}%" y1="2" y2="26" stroke="#1f262d" stroke-width="2"/>`;
      return `<div ${tik ? `data-bullet="${id}" style="cursor:pointer;min-height:44px"` : 'style="min-height:44px"'}><div style="display:flex;justify-content:space-between;font-size:13px"><span>${esc(naam)}</span><span><b>${esc(pct(v))}</b>${b ? ` <span class="mtc-noot">· branche ${esc(bmTekst(b))}</span>` : ''}</span></div>
        <svg width="100%" height="28" style="display:block">${bmEl}<rect x="4%" y="10" width="${Math.max(0.3, sx(Math.max(0, v)) - 4)}%" height="8" fill="${st.focusCat === id ? '#1d3557' : '#56616d'}"/></svg></div>`; };
    return `<div class="mtc-noot" style="margin-bottom:6px">${esc(st.sel ? st.sel.label || st.sel.id : st.jaar + ' t/m ' + MND[tm - 1])} — kosten als % van de omzet. Balk = eigen, streep of band = branche${st.bmBron === 'standaard' ? ' (standaard CBS-kengetallen)' : ''}. Tik voor de maanden.</div>
      ${rij('brutomarge', 'Brutomarge', P.brutomarge_pct, st.bm.brutomarge)}
      ${(() => { const gem = Math.max(10, ...st.cats.map(c => P.kosten[c] / P.omzet * 100 * 1.15), ...st.cats.map(c => st.bm[c] ? (st.bm[c].tot || st.bm[c].pct || 0) * 1.15 : 0));   // één schaal voor alle categorieën (eerlijk vergelijken)
        return st.cats.map(c => rij(c, st.catNaam[c] || c, P.kosten[c] / P.omzet * 100, st.bm[c], true, gem)).join(''); })()}
      ${rij('resultaat', 'Resultaat' + (st.eerlijk && P.correctie ? ' (eerlijk)' : ''), P.resultaat / P.omzet * 100, st.bm.resultaat)}`;
  }
  // Waterval als verhaalkaart (gekozen periode, anders het boekjaar t/m nu).
  function watervalHtml() {
    const lm = laatste(), tm = st.jaar === Number((lm || '').slice(0, 4)) ? Number(lm.slice(5, 7)) : 12;
    const P = st.sel ? selP() : C.som(st.maanden.filter(m => m.id.startsWith(st.jaar + '-') && Number(m.id.slice(5, 7)) <= tm), st.cats, st.eerlijk);
    const eerste = st.sel ? st.sel.ms.filter(m => !m.prognose).map(m => m.id).sort()[0] : `${st.jaar}-01`;
    const voor = eerste ? st.maanden.find(m => m.maanden && m.id === C._maandPlus(eerste, -1)) : null, kasVoor = voor && voor.kas;
    const s = C.waterval(P, kasVoor), H = BR < 500 ? 320 : 300, top = Math.max(1, ...s.map(x => Math.abs(x.w)), P.omzet), y = v => 16 + (H - 60) * (1 - v / top), bw = (BR - ML - MR) / s.length;
    let loop = 0, svg = `<line x1="${ML}" x2="${BR - MR}" y1="${y(0)}" y2="${y(0)}" stroke="#9aa"/>`;
    s.forEach((x, i) => { const van = x.totaal ? 0 : loop, tot = x.totaal ? x.w : loop + x.w; if (x.totaal) loop = x.w; else loop = tot;
      const y1 = y(Math.max(van, tot)), y2 = y(Math.min(van, tot)), kl = x.totaal ? '#3f4a56' : x.rest ? 'url(#mtc-streep)' : '#94a0ab';
      svg += `<rect data-tik="stap" data-stap="${x.id}" x="${ML + i * bw + bw * 0.15}" y="${y1}" width="${bw * 0.7}" height="${Math.max(1, y2 - y1)}" fill="${kl}"><title>${esc(x.label + ': ' + eur(x.w))}</title></rect>
        <text x="${ML + i * bw + bw / 2}" y="${Math.max(12, y1 - 4)}" text-anchor="middle" font-size="11" fill="#333">${esc(kort(x.w))}</text>
        ${bw < 60 ? `<text transform="translate(${ML + i * bw + bw / 2},${H - 40}) rotate(-35)" text-anchor="end" font-size="10" fill="#666">${esc(x.kort || x.label)}</text>` : `<text x="${ML + i * bw + bw / 2}" y="${H - 30}" text-anchor="middle" font-size="10" fill="#666">${esc(x.label.length > 14 ? x.label.slice(0, 13) + '…' : x.label)}</text>`}`; });
    return `<div class="mtc-noot" style="margin-bottom:6px">${esc(st.sel ? st.sel.label || st.sel.id : st.jaar + ' t/m ' + MND[tm - 1])}: van omzet naar wat er in de kas overblijft.${st.eerlijk && P.correctie ? ' Incl. ' + esc(kort(P.correctie)) + ' lonen buiten de W&V.' : ''}</div>
      <div class="mtc-grafiek" data-grafiek="waterval"><svg viewBox="0 0 ${BR} ${H}" role="img" aria-label="Waterval">${defs}${svg}</svg></div>
      <div class="mtc-noot">${kasVoor ? 'Gearceerd: het verschil tussen "over na opnames" en de werkelijke kasmutatie (btw, debiteuren/crediteuren, afschrijving, investeringen). Kasmutatie = stand (lopend + BTW-pot) eind van de periode − stand eind van de maand ervoor.' : 'Geen kasmutatie: de stand vóór deze periode is niet bekend.'}</div>`;
  }

  // ── Interactie ──
  // Tik naast een (smalle) staaf: kies de kolom op de x-positie en het dichtstbijzijnde deel binnen ±22 px (samen ≥ 44 px).
  function tikOpPositie(e) {
    const svg = e.target.closest && e.target.closest('.mtc-grafiek svg'); if (!svg || !st.geo || !st.geo.n || st.geo.weergave !== st.weergave || st.weergave === 'waterval') return false;
    const b = svg.getBoundingClientRect(), vbA = String(svg.getAttribute('viewBox') || '').split(/\s+/).map(Number), vb = { width: vbA[2], height: vbA[3] }; if (!b.width || !(vb.width > 0)) return false;
    const x = (e.clientX - b.left) * vb.width / b.width, yy = (e.clientY - b.top) * vb.height / b.height, i = Math.floor((x - ML) / st.geo.bw);
    if (i < 0 || i >= st.geo.n) return false;
    const p = huidigePeriodes().find(q => q.id === st.geo.ids[i]); if (!p) return false;
    const seg = (st.geo.segs[i] || []).map(q => ({ q, af: yy < q.y1 ? q.y1 - yy : yy > q.y2 ? yy - q.y2 : 0 })).filter(z => z.af <= 22).sort((a, c) => a.af - c.af)[0];
    st.sel = p; teken();
    if (seg) drill(seg.q.tik === 'kosten' ? 'kosten' : seg.q.tik, seg.q.cat || null, p);
    return true;
  }
  function klik(e) {
    const b = e.target.closest('[data-zoom],[data-jaar],[data-eerlijk],[data-vergelijk],[data-horizon],[data-weergave],[data-indeling],[data-wissel],[data-tik],[data-euro],[data-bullet]'); if (!b) { tikOpPositie(e); return; }
    const d = b.dataset;
    if (d.zoom) { st.zoom = d.zoom; st.sel = null; }
    else if (d.jaar) { st.jaar = Math.max(Number(START.slice(0, 4)), Math.min(Number(st.vandaag.slice(0, 4)), st.jaar + Number(d.jaar))); st.sel = null; }
    else if (d.eerlijk) { st.eerlijk = !st.eerlijk; ls.set('mtc:eerlijk:' + st.wie, st.eerlijk ? '1' : '0'); }
    else if (d.vergelijk != null) { st.vergelijk = Number(d.vergelijk); ls.set('mtc:vergelijk:' + st.wie, String(st.vergelijk)); }
    else if (d.horizon) { st.horizon = d.horizon; if (st.opHorizon) st.opHorizon(d.horizon); }
    else if (d.weergave) { st.weergave = d.weergave; }
    else if (d.indeling) return indelingBlad();
    else if (d.wissel) { e.preventDefault(); st.sel = null; }
    else if (d.euro) { const u = st.el.querySelector('#mtc-euro-uitleg'); if (d.euro === 'resultaat') { if (u) u.textContent = 'Resultaat: wat er van elke € omzet overblijft.'; return; } return drill('kosten', d.euro); }
    else if (d.bullet) return drill('kosten', d.bullet);
    else if (d.tik) {
      const p = huidigePeriodes().find(x => x.id === d.p);
      if (d.tik === 'stap') return;
      if (p && (d.tik === 'periode' || !st.sel || st.sel.id !== p.id)) st.sel = p;          // vaste markering op het gekozen punt
      if (d.tik === 'kosten') return (teken(), drill('kosten', d.cat, p));
      if (d.tik === 'omzet' || d.tik === 'prive' || d.tik === 'aflossing' || d.tik === 'correctie') return (teken(), drill(d.tik, null, p));
    }
    teken();
  }
  function gebaren() {
    const box = st.el.querySelector('.mtc-grafiek'); if (!box) return;
    const ptrs = new Map(); let start = null, knijp = null;
    box.addEventListener('pointerdown', e => { ptrs.set(e.pointerId, e.clientX); if (ptrs.size === 1) start = { x: e.clientX, t: Date.now() }; if (ptrs.size === 2) { const v = [...ptrs.values()]; knijp = Math.abs(v[0] - v[1]); start = null; } });
    box.addEventListener('pointermove', e => { if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, e.clientX);
      if (ptrs.size === 2 && knijp) { const v = [...ptrs.values()], a = Math.abs(v[0] - v[1]), z = ZOOMS.map(q => q[0]), i = z.indexOf(st.zoom);
        if (a > knijp * 1.4 && i > 0) { st.zoom = z[i - 1]; knijp = a; teken(); } else if (a < knijp / 1.4 && i < z.length - 1) { st.zoom = z[i + 1]; knijp = a; teken(); } } });
    const los = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) knijp = null;
      if (start && (st.zoom === 'M' || st.zoom === 'K')) { const dx = e.clientX - start.x; if (Math.abs(dx) > 60 && Date.now() - start.t < 800) { const nj = st.jaar + (dx < 0 ? 1 : -1);
        if (nj >= Number(START.slice(0, 4)) && nj <= Number(st.vandaag.slice(0, 4))) { st.jaar = nj; st.sel = null; start = null; teken(); return; } } } start = null; };
    box.addEventListener('pointerup', los); box.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); start = null; knijp = null; });
  }
  function sheet(html) {
    const o = document.createElement('div'); o.className = 'mtc-sheet';
    o.innerHTML = `<div role="dialog" aria-modal="true">${html}<div style="margin-top:12px;text-align:right"><button class="mtc-knop" data-sluit="1">Sluiten</button></div></div>`;
    o.addEventListener('click', ev => { if (ev.target === o || ev.target.closest('[data-sluit]')) o.remove(); });
    document.body.appendChild(o); return o;
  }
  const mbLink = u => /^https:\/\/moneybird\.com\//.test(String(u || '')) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">open</a>` : '';
  // Drill-down: per maand de stukken uit Moneybird; een kwartaal/jaar eerst de maanden laten kiezen.
  async function drill(reeks, cat, p) {
    p = p || st.sel;
    const titel = reeks === 'kosten' ? (st.catNaam[cat] || cat) : { omzet: 'Omzet', prive: 'Privé-opnames', aflossing: 'Aflossing', correctie: 'Lonen buiten de W&V' }[reeks];
    const ms = p ? p.ms.filter(m => !m.prognose && m.maanden) : st.maanden.filter(m => m.maanden && m.id.startsWith(st.jaar + '-'));
    if (ms.length !== 1) {
      const waarde = m => { const P = C.som([m], st.cats, st.eerlijk); return reeks === 'kosten' ? P.kosten[cat] : reeks === 'omzet' ? P.omzet : reeks === 'prive' ? P.prive_totaal : reeks === 'aflossing' ? P.aflossing : P.correctie; };
      const o = sheet(`<h3 style="margin-top:0">${esc(titel)} — kies een maand</h3><table>${ms.map(m => `<tr><td><a href="#" data-maand="${esc(m.id)}">${esc(maandNaam(m.id))}</a></td><td class="b">${esc(eur(waarde(m)))}</td>${reeks === 'kosten' ? `<td class="b mtc-noot">${m.omzet ? esc(pct(waarde(m) / m.omzet * 100)) : ''}</td>` : ''}</tr>`).join('')}</table>`);
      o.addEventListener('click', ev => { const a = ev.target.closest('[data-maand]'); if (a) { ev.preventDefault(); o.remove(); drillMaand(reeks, cat, a.dataset.maand, titel); } });
      return;
    }
    return drillMaand(reeks, cat, ms[0].id, titel);
  }
  async function drillMaand(reeks, cat, ym, titel) {
    const o = sheet(`<h3 style="margin-top:0">${esc(titel)} — ${esc(maandNaam(ym))}</h3><div class="mtc-noot">Ophalen uit Moneybird…</div>`), box = o.firstElementChild;
    const r = await st.bron.haal(`/geld/cijfers/detail?maand=${encodeURIComponent(ym)}&reeks=${encodeURIComponent(reeks)}${cat ? '&categorie=' + encodeURIComponent(cat) : ''}`);
    if (!r || r.error) { box.querySelector('.mtc-noot').textContent = 'Kon niet worden opgehaald: ' + ((r && r.error) || 'geen antwoord'); return; }
    const extra = reeks === 'kosten' && st.eerlijk && cat === 'personeel' ? (st.maanden.find(m => m.id === ym) || {}).correctie || 0 : 0;
    box.innerHTML = `<h3 style="margin-top:0">${esc(titel)} — ${esc(maandNaam(ym))}</h3>
      ${r.totaal_wv != null ? `<div class="mtc-noot">In de W&V: ${esc(eur(r.totaal_wv))}${r.rest ? ` · waarvan ${esc(eur(r.rest))} niet als losse factuur/bon/mutatie te zien (memoriaal, afschrijving e.d.)` : ''}</div>` : ''}
      ${extra ? `<div class="mtc-noot">Eerlijk beeld: plus ${esc(eur(extra))} lonen die via de bank zijn betaald maar niet in de W&V staan (<a href="#" data-corr="1">bekijk</a>).</div>` : ''}
      <table>${r.items.map(x => `<tr><td>${esc(x.datum || '')}</td><td>${esc(x.tegenpartij || '')}${x.nummer ? ' · ' + esc(x.nummer) : ''}${x.omschrijving ? `<div class="mtc-noot">${esc(x.omschrijving)}</div>` : ''}<div class="mtc-noot">${esc(x.soort)}</div></td><td class="b">${esc(eur(x.bedrag))}</td><td class="b">${mbLink(x.url)}</td></tr>`).join('') || '<tr><td>Geen losse stukken gevonden.</td></tr>'}</table>
      ${r.meer ? `<div class="mtc-noot">En nog ${esc(r.meer)} kleinere posten.</div>` : ''}${r.onvolledig ? '<div class="mtc-waarsch">Niet alles kon worden opgehaald; de lijst is mogelijk onvolledig.</div>' : ''}
      <div style="margin-top:12px;text-align:right"><button class="mtc-knop" data-sluit="1">Sluiten</button></div>`;
    box.addEventListener('click', ev => { if (ev.target.closest('[data-corr]')) { ev.preventDefault(); o.remove(); drillMaand('correctie', null, ym, 'Lonen buiten de W&V'); } });
  }
  // Indeling (eigenaar): grootboek → categorie, privé- en aflossingsgrootboeken, loonpatronen, correctie vanaf, branche.
  async function indelingBlad() {
    if (!st.mag) return;
    const o = sheet('<h3 style="margin-top:0">Indeling</h3><div class="mtc-noot">Laden…</div>'), box = o.firstElementChild;
    const [r, c] = await Promise.all([st.bron.haal('/geld/cijfers/indeling'), st.bron.haal('/geld/config')]);
    if (!r || r.error || !c || !c.config) { box.querySelector('.mtc-noot').textContent = 'Kon niet worden geladen.'; return; }
    const priveSet = new Map((r.prive || []).map(p => [p.ledger, p.naam])), afl = new Set(r.aflossing || []);
    const opties = sel => r.categorieen.map(k => `<option value="${esc(k.id)}" ${k.id === sel ? 'selected' : ''}>${esc(k.naam)}</option>`).join('');
    const bmVeld = (id, naam) => { const b = (r.benchmarks || {})[id] || {}; return `<tr><td>${esc(naam)}</td><td><input type="number" step="0.1" min="0" max="100" data-bm="${esc(id)}" value="${b.pct != null ? b.pct : b.van != null ? (b.van + b.tot) / 2 : ''}" style="width:80px"> %</td></tr>`; };
    box.innerHTML = `<h3 style="margin-top:0">Indeling</h3>
      <div class="mtc-noot">Welke grootboekrekening in welke categorie valt. "voorstel" = op naam geraden; kies om vast te leggen. De cijfers rekenen meteen opnieuw (zonder Moneybird opnieuw te vragen).</div>
      <table>${r.kosten.map(k => `<tr><td>${esc(k.naam)}${k.bron === 'voorstel' ? ' <span class="mtc-badge">voorstel</span>' : ''}</td><td><select data-led="${esc(k.ledger)}">${opties(k.categorie)}</select></td></tr>`).join('')}</table>
      <h4>Privé-opnames (per eigenaar)</h4><table>${r.eigen_vermogen.map(l => `<tr><td><label><input type="checkbox" data-prive="${esc(l.ledger)}" ${priveSet.has(l.ledger) ? 'checked' : ''}> ${esc(l.naam)}</label></td><td><input data-privenaam="${esc(l.ledger)}" value="${esc(priveSet.get(l.ledger) || '')}" placeholder="naam" maxlength="40" style="width:120px"></td></tr>`).join('') || '<tr><td>Geen eigen-vermogensrekeningen.</td></tr>'}</table>
      <h4>Aflossingen (leningen)</h4><table>${r.schulden.map(l => `<tr><td><label><input type="checkbox" data-afl="${esc(l.ledger)}" ${afl.has(l.ledger) ? 'checked' : ''}> ${esc(l.naam)}</label></td></tr>`).join('') || '<tr><td>Geen schulden-rekeningen.</td></tr>'}</table>
      <h4>Eerlijk beeld</h4><div class="mtc-noot">Uitgaande bankmutaties die niet in de W&V staan en een van deze woorden bevatten, tellen als personeelskosten (alleen het deel dat nog niet in de W&V staat).</div>
      <label>Woorden <input data-loon value="${esc((r.loonpatronen || []).join(', '))}" style="width:100%"></label><label>Vanaf maand <input type="month" data-corrvan value="${esc(r.correctie_van || '')}"></label>
      <h4>Opnieuw ophalen</h4><div class="mtc-noot">Na late boekingen in Moneybird: haal een afgesloten jaar opnieuw op (in rondes van 6 maanden).</div>
      <select data-herbouwjaar>${Array.from({ length: Number(st.vandaag.slice(0, 4)) - Number(START.slice(0, 4)) + 1 }, (_, i) => Number(START.slice(0, 4)) + i).reverse().map(j => `<option value="${j}">${j}</option>`).join('')}</select> <button class="mtc-knop" data-herbouw="1">Jaar opnieuw ophalen</button>
      <h4>Branche (% van de omzet)</h4><table>${bmVeld('brutomarge', 'Brutomarge')}${r.categorieen.map(k => bmVeld(k.id, k.naam)).join('')}${bmVeld('resultaat', 'Resultaat')}</table>
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end"><button class="mtc-knop" data-sluit="1">Annuleren</button><button class="mtc-knop aan" data-bewaar="1">Opslaan</button></div>`;
    box.querySelector('[data-herbouw]').addEventListener('click', () => { const j = box.querySelector('[data-herbouwjaar]').value; o.remove(); C.laad(j); });
    box.querySelector('[data-bewaar]').addEventListener('click', async () => {
      const map = {}; box.querySelectorAll('select[data-led]').forEach(s => { const k = r.kosten.find(x => x.ledger === s.dataset.led); if (k && (k.bron === 'instelling' || s.value !== k.categorie)) map[s.dataset.led] = s.value; });
      const prive = [...box.querySelectorAll('input[data-prive]:checked')].map(i => ({ ledger: i.dataset.prive, naam: (box.querySelector(`[data-privenaam="${i.dataset.prive}"]`) || {}).value || 'privé' }));
      const aflossing = [...box.querySelectorAll('input[data-afl]:checked')].map(i => i.dataset.afl);
      const loonpatronen = box.querySelector('[data-loon]').value.split(',').map(x => x.trim()).filter(Boolean);
      const bm = {}; const oud = r.benchmarks || {};
      box.querySelectorAll('[data-bm]').forEach(i => { const id = i.dataset.bm, v = i.value === '' ? null : Number(i.value), o2 = oud[id] || {};
        if (v == null || !isFinite(v)) return; const gelijk = o2.pct != null ? o2.pct === v : o2.van != null && (o2.van + o2.tot) / 2 === v; bm[id] = gelijk ? o2 : { pct: v, bron: 'eigen' }; });
      const cijfers = Object.assign({}, c.config.cijfers || {}, { map: Object.assign({}, (c.config.cijfers || {}).map || {}, map), prive, aflossing, loonpatronen, correctie_van: box.querySelector('[data-corrvan]').value || null, benchmarks: bm });
      const res = await st.bron.haal('/geld/config', { method: 'POST', body: { revisie: c.config.revisie, cijfers } });
      if (!res || res.error) { const f = document.createElement('div'); f.className = 'mtc-waarsch'; f.textContent = 'Niet opgeslagen: ' + ((res && res.error) || 'geen antwoord'); box.appendChild(f); return; }
      o.remove(); st.maanden = []; await C.laad();
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
