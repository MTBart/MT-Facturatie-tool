/* ============================================================================
 * mt-dagvraag.js: de dagvraag "Klopt je dag?" (restyling fase 1, brok 11)
 * ----------------------------------------------------------------------------
 * 15 minuten voor de eindtijd van jouw werkdag (uit mt_werktijden; zonder record 16:45 op ma-vr) vraagt de tool of je uren kloppen: wat er geboekt is en waar nog niets staat.
 * Nooit blokkerend en nooit een native alert: een kleine melding rechtsonder (of een kaart in de Uren-tab) die je kunt negeren.
 *  - één keer per dag per gebruiker (onthouden in localStorage, per e-mailadres): getoond is getoond;
 *  - niet beantwoord (niet op Klopt zo of een boeking) -> de volgende werkdag bij het eerste openen nog één keer, voor de vorige dag;
 *  - op een niet-werkdag (weekend, vrij volgens de werktijden, verlof, verplichte vrije dag) komt er geen vraag;
 *  - alleen in de nieuwe stijl (html[data-stijl="nieuw"]).
 * Boeken gaat via mt-uren-nieuw.js (tgBoekEntry, met bevestiging). Alles komt van buiten via init(deps); beslis() is rekenwerk zonder DOM.
 * ========================================================================== */
(function (root) {
  'use strict';
  const M = {};
  let D = null, P = null;
  const S = { open: null, banner: null, bezig: false };   // open: { datum, soort, moment } zolang er een vraag op een antwoord wacht
  const pad = n => String(n).padStart(2, '0');
  const lokaalYmd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const plus = (s, n) => { const d = new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n); return lokaalYmd(d); };
  const mm = t => t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null;
  const klok = min => { const n = Math.max(0, Math.round(min || 0)); return Math.floor(n / 60) + ':' + pad(n % 60); };
  const hm = min => pad(Math.floor(min / 60)) + ':' + pad(Math.round(min) % 60);
  const MND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'], DAG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const kort = s => Number(s.slice(8)) + ' ' + MND[Number(s.slice(5, 7)) - 1];
  M.leegStaat = () => ({ gevraagd: {}, klaar: {}, gesloten: {} });   // gesloten: de melding is weggeklikt (Later); klaar: beantwoord

  // Wat moet er nu gevraagd worden? o = { nu (ms), slug, werktijden, verlof, vrijedagen, team, staat } -> { tonen:false } | { tonen:true, voorDatum, soort:'avond'|'ochtend', moment }
  M.beslis = function (o) {
    const staat = o.staat || M.leegStaat(), d = new Date(o.nu), vandaag = lokaalYmd(d), nuMin = d.getHours() * 60 + d.getMinutes();
    const opt = { verlof: o.verlof, vrijedagen: o.vrijedagen, team: o.team };
    const moment = dag => P.dagvraagMoment(o.slug, o.werktijden, dag, opt);
    const gevraagd = (dag, soort) => !!(staat.gevraagd && staat.gevraagd[dag] && staat.gevraagd[dag][soort]), klaar = dag => !!(staat.klaar && staat.klaar[dag]);
    const q = moment(vandaag);
    if (!q) return { tonen: false };   // een niet-werkdag: geen vraag (ook niet voor gisteren: die komt op de eerstvolgende werkdag)
    if (nuMin >= mm(q)) {
      if (!klaar(vandaag) && !gevraagd(vandaag, 'avond')) return { tonen: true, voorDatum: vandaag, soort: 'avond', moment: q };
      return { tonen: false };
    }
    for (let i = 1; i <= 4; i++) {   // de eerste ochtend: de vorige werkdag met een vraag die nog open staat (tot vier kalenderdagen terug: weekend en een vrije maandag)
      const dag = plus(vandaag, -i), mom = moment(dag); if (!mom) continue;
      if (!klaar(dag) && !gevraagd(dag, 'ochtend')) return { tonen: true, voorDatum: dag, soort: 'ochtend', moment: mom };
      break;   // alleen de laatste werkdag telt
    }
    return { tonen: false };
  };

  // De tekst van de vraag uit het dagmodel van mt-uren-nieuw.js (m.dagInfo: geboektSec, gaten, items). -> { tekst, gat, voorstel, leeg, loopt }
  M.inhoud = function (m) {
    const di = m.dagInfo, gaten = di.gaten.slice().sort((a, b) => (b.tot - b.van) - (a.tot - a.van)), geboekt = klok(Math.round(di.geboektSec / 60));
    const loopt = di.items.some(x => x.soort === 'lopend');
    const entries = di.items.filter(x => x.soort === 'entry' || x.soort === 'lopend').sort((a, b) => a.van - b.van);
    const gat = gaten[0] || null;
    let voorstel = null;
    if (gat) { const voor = entries.filter(x => x.tot <= gat.van).pop() || entries.find(x => x.van >= gat.tot) || null; voorstel = voor && voor.soort === 'entry' ? voor : null; }
    let tekst;
    if (!entries.length) tekst = 'Er staat nog niets in Toggl voor deze dag.';
    else if (gat) tekst = geboekt + ' geboekt. Tussen ' + hm(gat.van) + ' en ' + hm(gat.tot) + ' staat nog niets.' + (voorstel ? ' Was dat ' + voorstel.titel + '?' : '');
    else tekst = geboekt + ' geboekt, zonder gaten. Klopt dat met je dag?';
    return { tekst, gat, voorstel, leeg: !entries.length, loopt, geboekt };
  };

  // ── bewaren ──
  const sleutel = () => 'mt_dagvraag:' + String(D.ik() || '').toLowerCase();
  M.lees = function () {
    try { const o = JSON.parse(D.storage.getItem(sleutel()) || 'null'); if (o && typeof o === 'object' && !Array.isArray(o)) return { gevraagd: o.gevraagd && typeof o.gevraagd === 'object' ? o.gevraagd : {}, klaar: o.klaar && typeof o.klaar === 'object' ? o.klaar : {}, gesloten: o.gesloten && typeof o.gesloten === 'object' ? o.gesloten : {} }; } catch (e) {}
    return M.leegStaat();
  };
  M.bewaar = function (staat) {
    const grens = plus(lokaalYmd(new Date(D.nu())), -30);   // oude dagen opruimen
    Object.keys(staat.gevraagd).forEach(k => { if (k < grens) delete staat.gevraagd[k]; }); Object.keys(staat.klaar).forEach(k => { if (k < grens) delete staat.klaar[k]; }); Object.keys(staat.gesloten || {}).forEach(k => { if (k < grens) delete staat.gesloten[k]; });
    try { D.storage.setItem(sleutel(), JSON.stringify(staat)); } catch (e) {}
  };
  const mijnSlug = () => { const ik = String(D.ik() || '').toLowerCase(), l = (D.team() || []).find(x => String(x.email || '').toLowerCase() === ik); return l ? l.slug : ik.split('@')[0]; };
  const nieuweStijl = () => { try { return D.doc.documentElement.getAttribute('data-stijl') === 'nieuw'; } catch (e) { return false; } };

  M.open = () => S.open;
  // Is de open vraag beantwoord of gesloten (ook in een ander tabblad)? Dan hoort de melding overal weg.
  M.moetVerbergen = (open, st) => !!open && !!st && (!!(st.klaar && st.klaar[open.datum]) || !!(st.gesloten && st.gesloten[open.datum]));
  // Er waren gaten toen de vraag voor het eerst getoond werd en nu niet meer (gedekt door een boeking): de vraag is daarmee beantwoord.
  M.gatenDichtGegaan = (st, m) => { const d = m && m.dagInfo && m.dagInfo.datum, g = d && st && st.gevraagd && st.gevraagd[d]; return !!g && !(st.klaar && st.klaar[d]) && g.gaten > 0 && m.dagInfo.gaten.length === 0; };
  M.beoordeel = function (m) { if (!D || !nieuweStijl() || !m || !m.dagInfo) return; if (M.gatenDichtGegaan(M.lees(), m)) root.setTimeout(() => M.beantwoord(m.dagInfo.datum), 0); };
  const momentVoor = datum => P.dagvraagMoment(mijnSlug(), D.werktijden ? D.werktijden() : null, datum, { verlof: D.verlof ? D.verlof() : [], vrijedagen: D.vrijedagen ? D.vrijedagen() : [], team: D.team() || [] });   // '' = geen vraag (weekend, vrij, verlof)
  M.beantwoord = function (datum) {
    const st = M.lees(); st.klaar[datum] = new Date(D.nu()).toISOString(); M.bewaar(st);
    if (S.open && S.open.datum === datum) S.open = null; verberg();
    try { D.herteken && D.herteken(); } catch (e) {}
  };

  // ── tekenen (DOM-calls) ──
  function el(tag, props, ...kids) {
    const e = D.doc.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => { if (v === null || v === undefined || v === false) return; if (k === 'klass') e.className = v; else if (k === 'tekst') e.textContent = v; else if (k === 'klik') e.addEventListener('click', v); else e.setAttribute(k, v === true ? '' : v); });
    kids.flat(2).forEach(x => { if (x === null || x === undefined || x === false) return; e.appendChild(typeof x === 'string' ? D.doc.createTextNode(x) : x); });
    return e;
  }
  const knop = (tekst, klass, klik) => el('button', { type: 'button', klass: 'dv-knop' + (klass ? ' ' + klass : ''), tekst, klik });
  function titelVoor(o) { return o.soort === 'ochtend' ? DAG[new Date(+o.datum.slice(0, 4), +o.datum.slice(5, 7) - 1, +o.datum.slice(8, 10)).getDay()] + ' ' + kort(o.datum) + ': klopt je dag?' : 'Klopt je dag?'; }
  // De kaart in de Uren-tab (aside) voor een dag met een open vraag; m = het dagmodel van die dag. null als er niets te vragen is.
  M.kaart = function (datum, m) {
    if (!D || !nieuweStijl() || !m) return null;
    const st = M.lees(), g = st.gevraagd[datum]; if (!g || st.klaar[datum]) return null;
    const moment = momentVoor(datum); if (!moment) return null;   // intussen verlof of een vrije dag geworden: niet tonen
    const soort = g.ochtend ? 'ochtend' : 'avond', mag = !!(D.magBoeken && D.magBoeken());
    if (g.gaten === undefined) { g.gaten = m.dagInfo.gaten.length; M.bewaar(st); }   // onthoud of er gaten waren, om te zien of een boeking ze dichtte
    const inh = M.inhoud(m);
    const boekEn = async (gat, vi) => { const r = await D.boekGat(m, gat, vi); if (r && r.ok) M.beantwoord(datum); };   // een geslaagde boeking beantwoordt de vraag
    return el('section', { klass: 'dv-kaart', 'aria-labelledby': 'dv-titel' },
      el('span', { klass: 'dv-eyebrow', tekst: moment ? moment + ' · 15 min voor je eindtijd' : '15 min voor je eindtijd' }),
      el('span', { id: 'dv-titel', klass: 'dv-titel', tekst: titelVoor({ soort, datum }) }),
      el('span', { klass: 'dv-tekst', tekst: inh.tekst + (inh.loopt ? ' Je timer loopt nog.' : '') }),
      el('div', { klass: 'dv-acties' },
        !mag ? null : (inh.gat && inh.voorstel ? knop('Ja, boek ' + klok(inh.gat.tot - inh.gat.van), 'primair', () => boekEn(inh.gat, inh.voorstel)) : (inh.gat || inh.leeg ? knop('Tijd boeken', 'primair', () => boekEn(inh.gat || { van: m.dagInfo.venster.van, tot: m.dagInfo.venster.tot }, null)) : null)),
        !mag ? null : (inh.gat && inh.voorstel ? knop('Iets anders', '', () => boekEn(inh.gat, null)) : null),
        knop(inh.gat || inh.leeg ? 'Klopt zo' : 'Klopt', inh.gat || inh.leeg ? '' : 'primair', () => M.beantwoord(datum))),
      soort === 'avond' ? el('span', { klass: 'dv-noot', tekst: 'Niet beantwoord? Morgen bij het openen vraagt de tool het nog een keer.' }) : null);
  };
  function verberg() { if (S.banner) { try { S.banner.remove(); } catch (e) {} S.banner = null; } }
  async function toonBanner(o) {
    verberg();
    let tekst = 'Kijk even of je uren kloppen.', m = null;
    try { if (D.modelVoor) { m = await D.modelVoor(o.datum); if (m) tekst = M.inhoud(m).tekst; } } catch (e) {}
    if (!S.open || S.open.datum !== o.datum) return;   // intussen beantwoord of vervangen
    if (!momentVoor(o.datum)) { S.open = null; return; }   // intussen verlof of een vrije dag geworden: niet tonen
    const b = el('div', { klass: 'dv-banner', role: 'status', 'aria-live': 'polite' },
      el('span', { klass: 'dv-eyebrow', tekst: (o.moment ? o.moment + ' · ' : '') + (o.soort === 'ochtend' ? 'van gisteren' : '15 min voor je eindtijd') }),
      el('span', { klass: 'dv-titel', tekst: titelVoor(o) }),
      el('span', { klass: 'dv-tekst', tekst }),
      el('div', { klass: 'dv-acties' }, knop('Bekijk', 'primair', () => { verberg(); try { D.naarUren(o.datum); } catch (e) {} }), knop('Klopt zo', '', () => M.beantwoord(o.datum)), knop('Later', 'ghost', () => { const st = M.lees(); st.gesloten[o.datum] = new Date(D.nu()).toISOString(); M.bewaar(st); verberg(); })));
    D.doc.body.appendChild(b); S.banner = b;
  }
  // Eén controle: moet er nu een vraag komen? Aangeroepen bij het opstarten, elke minuut, bij het terugkomen op het tabblad en na het openen van Uren.
  M.controleer = function () {
    if (!D || !nieuweStijl()) { verberg(); return null; }
    try { if (D.doc.visibilityState === 'hidden') return null; } catch (e) {}
    if (!String(D.ik() || '')) return null;
    const st = M.lees();
    const b = M.beslis({ nu: D.nu(), slug: mijnSlug(), werktijden: D.werktijden ? D.werktijden() : null, verlof: D.verlof ? D.verlof() : [], vrijedagen: D.vrijedagen ? D.vrijedagen() : [], team: D.team() || [], staat: st });
    if (!b.tonen) return null;
    const dag = st.gevraagd[b.voorDatum] = st.gevraagd[b.voorDatum] || {}; dag[b.soort] = new Date(D.nu()).toISOString(); M.bewaar(st);   // getoond is getoond: nooit twee keer dezelfde vraag
    S.open = { datum: b.voorDatum, soort: b.soort, moment: b.moment };
    if (D.urenZichtbaar && D.urenZichtbaar()) { try { D.herteken && D.herteken(); } catch (e) {} }   // de kaart staat dan al in de Uren-tab
    else toonBanner({ datum: b.voorDatum, soort: b.soort, moment: b.moment });
    return b;
  };
  // Een ander tabblad beantwoordde of sloot de vraag: ook hier weg (het storage-event komt alleen bij de andere tabbladen).
  M.luister = function () {
    if (M._luistert) return; M._luistert = true;
    try { root.addEventListener('storage', e => { try { if (!D || (e.key !== null && e.key !== sleutel())) return; const st = M.lees(); if (M.moetVerbergen(S.open, st)) { verberg(); if (st.klaar[S.open.datum]) S.open = null; if (D.herteken) D.herteken(); } } catch (x) {} }); } catch (e) {}
  };
  M.toonBanner = toonBanner;
  M.start = function () {
    if (!D || M._iv) return;
    try { root.setTimeout(() => M.controleer(), 6000); M._iv = root.setInterval(() => M.controleer(), 60000); } catch (e) {}
    try { D.doc.addEventListener('visibilitychange', () => { if (D.doc.visibilityState === 'visible') M.controleer(); }); } catch (e) {}
    M.luister();
    try { root.addEventListener('mt-stijl', () => { if (!nieuweStijl()) verberg(); else M.controleer(); }); } catch (e) {}
  };
  M.init = function (deps) { D = deps; P = deps.planning || root.MTPlanning; return M; };
  M.S = S;
  root.MTDagvraag = M;
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
