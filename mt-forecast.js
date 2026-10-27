// mt-forecast.js — tabblad Forecast: de facturatieplanning als rapporttabel (verzoek Mathijs 22-10, Bart 27-10).
// Links de goedgekeurde (geaccepteerde) offertes uit Moneybird, kolommen = maanden. In een maandcel plan je (een deel van) de
// facturatie van die offerte; onderaan per maand wat er gefactureerd wordt, wat er binnenkomt (factuurdatum + betaaltermijn en
// betaalgedrag, zoals Financiën al rekent) en het netto-saldo met/zonder lopende kosten en overige voorspelling.
//
// Geen tweede administratie: de planning IS het prognose-item van de offerte (/geld/prognose, termijnen met factuurdatum), dezelfde
// opslag als Financiën, de Factuurplanning en de kaslijn. Een maandcel met een bedrag = één termijn met een factuurdatum in die
// maand. Het nog niet geplande deel staat als één uitgeschakelde termijn ("nog niet gepland"), zodat de termijnen altijd precies
// optellen tot het offertebedrag (eis van de worker). Alles in hele centen. Bedragen zijn incl. btw. Er gaat NOOIT iets naar Moneybird.
// De rekenregels (F.*) zijn zonder DOM te testen; de weergave bouwt met DOM-methoden (geen innerHTML).
(function (root) {
  'use strict';
  const F = root.MTForecast = root.MTForecast || {};
  const MAX_TERMIJNEN = 6, MAX_BYTES = 1000, REST_LABEL = 'nog niet gepland';
  const MND_K = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

  // ── Kleine hulpjes ───────────────────────────────────────────────────────────
  const c = n => Math.round((Number(n) || 0) * 100);          // euro → hele centen
  const dagPlus = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const maandPlus = (ym, n) => { const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };
  const maandTekst = ym => MND_K[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4);
  const lokaalVandaag = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  // Zelfde regel als MTGeld.zetMaand: dezelfde dag in de nieuwe maand (hooguit de laatste dag), in de lopende maand nooit vóór vandaag.
  const zetMaand = (datum, ym, vandaag) => {
    const dim = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
    const d = `${ym}-${String(Math.min(Number(String(datum || '').slice(8, 10)) || 1, dim)).padStart(2, '0')}`;
    return vandaag && ym === vandaag.slice(0, 7) && d < vandaag ? vandaag : d;
  };
  F.centen = c; F.maandPlus = maandPlus; F.maandTekst = maandTekst; F.zetMaand = zetMaand;
  // Bedrag in Nederlandse notatie ("1.500,50", "1500,5", "1500.50", "€ 1.500") → hele centen; leeg = 0; ongeldig of negatief = null.
  F.parseBedrag = function (t) {
    let s = String(t == null ? '' : t).replace(/[€\s]/g, '');
    if (s === '') return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    return Math.round(Number(s) * 100);
  };
  const duizend = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  F.fmt = function (cc, opt) {                               // 150000 → "1.500"; 150050 → "1.500,50"
    const a = Math.abs(cc), eur = Math.floor(a / 100), ct = a % 100;
    return (cc < 0 ? '−' : '') + duizend(eur) + (ct || (opt && opt.altijdCenten) ? ',' + String(ct).padStart(2, '0') : '');
  };

  // ── Offertes uit Moneybird (ruw) → kort ──────────────────────────────────────
  F.schatNorm = function (e) {
    if (!e || e.id == null) return null;
    const t = parseFloat(e.total_price_incl_tax_base != null ? e.total_price_incl_tax_base : e.total_price_incl_tax);
    if (!isFinite(t) || t <= 0) return null;
    const k = e.contact || {}, naam = String(k.company_name || [k.firstname, k.lastname].filter(Boolean).join(' ') || '').trim();
    return { id: String(e.id), nummer: String(e.estimate_id || ''), naam, ref: String(e.reference || '').trim(), contact_id: e.contact_id != null ? String(e.contact_id) : '', totaalC: c(t) };
  };

  // ── Termijnen van een prognose-item, met wat al gefactureerd is (overzicht uit /geld/tijdlijn → prognose.posten) ──
  // vast = er is al (deels) gefactureerd: niet meer te wijzigen, wel te tonen.
  F.termijnInfo = function (item, ov) {
    return ((item && item.termijnen) || []).map(t => {
      const o = ((ov && ov.termijnen) || []).find(q => q.id === t.id), b = c(t.bedrag);
      const g = o ? Math.min(b, Math.max(0, c(o.gefactureerd))) : 0, open = o && o.open != null ? Math.max(0, Math.min(b, c(o.open))) : b - g;
      return { id: t.id, label: t.label || '', bedragC: b, factuurdatum: t.factuurdatum, aan: t.aan !== false, gefC: g, openC: open, maand: String(t.factuurdatum || '').slice(0, 7), vast: g > 0 };
    });
  };

  // ── Rijen: één per goedgekeurde offerte (+ prognose-projecten zonder openstaande offerte) ──
  // schatten: F.schatNorm-resultaten; items: /geld/prognose items; posten: prognose.posten uit de tijdlijn;
  // projecten: [{project_id, label, code, offerte_mb_id}] (bestaande koppeling offerte → project).
  F.bouwRijen = function (o) {
    const items = o.items || {}, posten = o.posten || [], vandaag = o.vandaag, n = o.maanden || 6, nu = vandaag.slice(0, 7), einde = maandPlus(nu, n - 1);
    const gebruikt = new Set(), rijen = [];
    const ovVan = sleutel => posten.find(x => x.sleutel === sleutel && x.soort === 'project') || null;
    const isProject = k => items[k] && items[k].soort !== 'post';
    // Dezelfde offerte in meer dan één prognose-item: één item is het hoofd-item (sleutel van het project, anders het item waar al op
    // gefactureerd is, anders de eerste sleutel); de andere actieve staan als "dubbel" bij die rij en tellen hier niet mee.
    const perOfferte = {};
    for (const k of Object.keys(items).sort()) if (isProject(k) && items[k].estimate_id) (perOfferte[String(items[k].estimate_id)] = perOfferte[String(items[k].estimate_id)] || []).push(k);
    const hoofd = {}, dubbelBij = {};
    for (const eid of Object.keys(perOfferte)) {
      const ks = perOfferte[eid], pr = (o.projecten || []).find(p => p.offerte_mb_id != null && String(p.offerte_mb_id) === eid);
      const kies = (pr && ks.find(k => k === 'p:' + pr.project_id)) || ks.find(k => items[k].aan !== false && ovVan(k) && c(ovVan(k).gefactureerd) > 0) || ks.find(k => items[k].aan !== false) || ks[0];
      hoofd[eid] = kies;
      for (const k of ks) if (k !== kies) dubbelBij[k] = kies;
    }
    const maak = (sleutel, basis) => {
      const item = isProject(sleutel) ? items[sleutel] : null, ov = ovVan(sleutel);
      const info = item ? F.termijnInfo(item, item.aan === false ? null : ov) : [];
      const totaalC = item ? c(item.totaal) : basis.totaalC;
      const pool = ov ? c(ov.gefactureerd) : 0;                // netto, na creditnota's: kan negatief zijn
      const r = { sleutel, naam: basis.naam || (item && (item.naam || item.code)) || sleutel, offertenr: basis.offertenr || (item && item.offertenr) || '', code: basis.code || (item && item.code) || '', estimateId: basis.estimateId || (item && item.estimate_id) || '',
        contactId: basis.contactId || (item && item.contact_id) || '', schatTotaalC: basis.totaalC != null ? basis.totaalC : null, extra: !!basis.extra, bestaat: !!item, aan: !!(item && item.aan !== false), totaalC,
        gefNettoC: pool, gefC: Math.max(0, pool), creditC: 0, gecrediteerd: false, dubbelen: [], termijnen: info, maanden: [], eerderC: 0, laterC: 0, eerderVrijC: 0, geplandC: 0 };
      // Creditnota's: het netto gefactureerde bedrag wordt niet weggeklemd getoond; de gecrediteerde bedragen komen uit de openstaande creditregels van de gekoppelde facturen.
      if (ov && Array.isArray(ov.facturen) && ov.facturen.length) for (const e of o.events || []) if (e && e.bron === 'verkoop' && typeof e.delta === 'number' && e.delta < 0 && e.document_id != null && ov.facturen.map(String).includes(String(e.document_id))) r.creditC += -c(e.delta);
      r.gecrediteerd = r.creditC > 0 || pool < 0;
      for (let i = 0; i < n; i++) r.maanden.push({ ym: maandPlus(nu, i), vrijC: 0, vastGefC: 0, vastOpenC: 0, datum: null });
      for (const t of info) {
        if (!t.aan) continue;
        if (t.maand < nu) { r.eerderC += t.openC; if (!t.vast) r.eerderVrijC += t.openC; }
        else if (t.maand > einde) r.laterC += t.openC;
        else { const m = r.maanden[r.maanden.findIndex(x => x.ym === t.maand)]; if (t.vast) { m.vastGefC += t.gefC; m.vastOpenC += t.openC; } else { m.vrijC += t.openC; m.datum = m.datum || t.factuurdatum; } }
        r.geplandC += t.openC;
      }
      r.nogC = Math.max(0, totaalC - r.gefC - r.geplandC);       // wat nog in geen enkele maand staat
      r.afwijkt = !!(item && r.schatTotaalC != null && r.schatTotaalC !== totaalC);
      r.mbTotaalC = r.schatTotaalC;
      for (const dk of Object.keys(dubbelBij)) if (dubbelBij[dk] === sleutel && items[dk].aan !== false) r.dubbelen.push({ sleutel: dk, naam: items[dk].naam || items[dk].code || dk, totaalC: c(items[dk].totaal) });
      return r;
    };
    const lijst = (o.schatten || []).slice().sort((a, b) => (a.naam + a.ref).localeCompare(b.naam + b.ref) || a.id.localeCompare(b.id));
    for (const s of lijst) {
      const pr = (o.projecten || []).find(p => p.offerte_mb_id != null && String(p.offerte_mb_id) === s.id);
      let sleutel = hoofd[s.id] && !gebruikt.has(hoofd[s.id]) ? hoofd[s.id] : null;
      if (!sleutel && pr) { const k = 'p:' + pr.project_id; if (!gebruikt.has(k) && /^p:[A-Za-z0-9_-]{1,40}$/.test(k) && !dubbelBij[k] && !(items[k] && items[k].estimate_id && String(items[k].estimate_id) !== s.id)) sleutel = k; }
      if (!sleutel) sleutel = 'p:e' + s.id;
      gebruikt.add(sleutel);
      const naam = (pr && pr.label) || [s.naam, s.ref].filter(Boolean).join(' — ') || s.nummer || s.id;
      rijen.push(maak(sleutel, { naam, offertenr: s.nummer, code: pr ? pr.code : '', estimateId: s.id, contactId: s.contact_id, totaalC: s.totaalC }));
    }
    // Prognose-projecten die meetellen in Financiën maar geen openstaande offerte hebben: toch tonen, anders klopt het totaal niet.
    for (const k of Object.keys(items).sort()) {
      const it = items[k]; if (it.soort === 'post' || gebruikt.has(k) || it.aan === false || dubbelBij[k]) continue;
      if (!(it.termijnen || []).some(t => t.aan !== false)) continue;
      gebruikt.add(k); rijen.push(maak(k, { naam: it.naam || it.code || k, extra: true }));
    }
    // Actieve dubbelen waarvan het hoofd-item niet als rij is getoond (uit, of zonder termijnen): toch melden, bij een eigen rij.
    for (const dk of Object.keys(dubbelBij)) {
      const hk = dubbelBij[dk]; if (items[dk].aan === false || rijen.some(r => r.sleutel === hk)) continue;
      gebruikt.add(hk); rijen.push(maak(hk, { naam: items[hk].naam || items[hk].code || hk, extra: true }));
    }
    return rijen;
  };

  // ── Bewerkingen op een prognose-item (zuiver; geven {item} of {fout}) ──────────
  const nieuwId = gebruikt => { for (let i = 1; i < 100; i++) if (!gebruikt.has('t' + i)) return 't' + i; return null; };
  const schoon = it => { const n = Object.assign({}, it); delete n.ts; delete n.door; return n; };
  F.itemGrootte = it => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(JSON.stringify(it)).length : JSON.stringify(it).length);
  // Nieuw item voor een offerte die nog geen prognose heeft: aan, met het hele bedrag als niet-geplande termijn.
  F.nieuwItem = function (rij, betaaltermijn, vandaag) {
    const num = v => /^\d{6,25}$/.test(String(v || '')) ? String(v) : null;
    return { soort: 'project', naam: String(rij.naam).slice(0, 50), contact_id: num(rij.contactId), estimate_id: num(rij.estimateId), offertenr: String(rij.offertenr || '').slice(0, 24), code: String(rij.code || '').slice(0, 30),
      totaal: rij.totaalC / 100, betaaltermijn: Number.isInteger(betaaltermijn) && betaaltermijn >= 0 && betaaltermijn <= 120 ? betaaltermijn : 14, aan: true,
      termijnen: [{ id: 't1', label: REST_LABEL, bedrag: rij.totaalC / 100, factuurdatum: vandaag, aan: false }], k: [], x: [] };
  };
  // Zet de vrije (nog niet gefactureerde) planning van één maand op nieuweC; de rest van het offertebedrag blijft "nog niet gepland".
  F.zetCel = function (item, ov, ym, nieuweC, vandaag) {
    if (!(nieuweC >= 0)) return { fout: 'Vul een bedrag in (0 of meer).' };
    const info = F.termijnInfo(item, ov), totaalC = c(item.totaal);
    const vast = info.filter(t => t.vast), vrij = info.filter(t => !t.vast && t.aan), uit = info.filter(t => !t.vast && !t.aan);
    const inMaand = vrij.filter(t => t.maand === ym), blijf = vrij.filter(t => t.maand !== ym);
    const rest = c(item.totaal) - vast.reduce((a, t) => a + t.bedragC, 0) - blijf.reduce((a, t) => a + t.bedragC, 0) - nieuweC;
    if (rest < 0) return { fout: `Dat is ${F.fmt(-rest)} meer dan het offertebedrag (nog te plannen: ${F.fmt(totaalC - vast.reduce((a, t) => a + t.bedragC, 0) - blijf.reduce((a, t) => a + t.bedragC, 0))}).` };
    const gebruikt = new Set(vast.concat(blijf).map(t => t.id));
    const lijst = vast.concat(blijf).map(t => ({ id: t.id, label: t.label, bedrag: t.bedragC / 100, factuurdatum: t.factuurdatum, aan: t.aan }));
    if (nieuweC > 0) {
      const oud = inMaand[0], id = oud ? oud.id : nieuwId(gebruikt); if (!id) return { fout: 'Te veel termijnen.' }; gebruikt.add(id);
      lijst.push({ id, label: oud ? oud.label : 'termijn', bedrag: nieuweC / 100, factuurdatum: oud ? oud.factuurdatum : zetMaand(ym + '-15', ym, vandaag), aan: true });
    }
    if (rest > 0) {
      const oud = uit[0] || (nieuweC === 0 ? inMaand[0] : null) || null, id = oud && !gebruikt.has(oud.id) ? oud.id : nieuwId(gebruikt); if (!id) return { fout: 'Te veel termijnen.' };
      const laatste = lijst.reduce((a, t) => t.factuurdatum > a ? t.factuurdatum : a, vandaag);
      lijst.push({ id, label: REST_LABEL, bedrag: rest / 100, factuurdatum: laatste, aan: false });
    }
    if (lijst.length > MAX_TERMIJNEN) return { fout: `Een offerte kan in hoogstens ${MAX_TERMIJNEN} delen gepland worden (het nog niet geplande deel telt als één). Voeg bedragen samen of plan de rest in één keer.` };
    if (!lijst.length) return { fout: 'Er is geen termijn over.' };
    lijst.sort((a, b) => String(a.factuurdatum).localeCompare(String(b.factuurdatum)) || a.id.localeCompare(b.id));
    const n = Object.assign(schoon(item), { termijnen: lijst, aan: nieuweC > 0 ? true : item.aan !== false });
    if (F.itemGrootte(n) > MAX_BYTES - 90) return { fout: 'Het prognose-item wordt te groot (kortere naam of minder delen).' };
    return { item: n };
  };
  // "rest hier": het nog niet geplande deel erbij zetten in deze maand.
  F.restHier = (rij, ym) => { const m = rij.maanden.find(x => x.ym === ym); return m && rij.nogC > 0 ? m.vrijC + rij.nogC : null; };
  // Open termijnen van vóór deze maand naar de lopende maand (de factuurdatum is voorbij en er is nog niet gefactureerd).
  F.eerderNaarNu = function (item, ov, vandaag) {
    const nu = vandaag.slice(0, 7), vast = new Set(F.termijnInfo(item, ov).filter(t => t.vast).map(t => t.id));
    const n = Object.assign(schoon(item), { termijnen: item.termijnen.map(t => !vast.has(t.id) && t.aan !== false && String(t.factuurdatum).slice(0, 7) < nu ? Object.assign({}, t, { factuurdatum: zetMaand(t.factuurdatum, nu, vandaag) }) : t) });
    return { item: n };
  };
  F.zetAan = (item, aan) => ({ item: Object.assign(schoon(item), { aan: !!aan }) });
  // Totaal gelijktrekken met Moneybird: het verschil gaat in de termijn "nog niet gepland". Nooit stil een geplande of gefactureerde termijn verlagen.
  F.bijwerkTotaal = function (item, ov, nieuwC, vandaag) {
    const info = F.termijnInfo(item, ov), vast = info.filter(t => t.vast || t.aan).reduce((a, t) => a + t.bedragC, 0);
    if (!(nieuwC > 0)) return { fout: 'Het Moneybird-bedrag ontbreekt.' };
    if (nieuwC < vast) return { fout: `Het Moneybird-bedrag (${F.fmt(nieuwC)}) is lager dan wat al gepland of gefactureerd is (${F.fmt(vast)}). Er wordt niets stil verlaagd: haal eerst planning weg (zet een maand op 0), of pas de termijnen aan in Financiën.` };
    return F.zetCel(Object.assign({}, item, { totaal: nieuwC / 100 }), ov, null, 0, vandaag);
  };
  // Alle pagina's van een Moneybird-lijst: door tot een lege of korte pagina; bij het veiligheidsplafond is de lijst afgekapt (afgekapt: true).
  F.pagineer = async function (haal, o) {
    const max = (o && o.max) || 50, per = (o && o.per) || 100, lijst = [];
    for (let p = 1; ; p++) {
      const j = await haal(p);
      if (p > max) return { lijst, afgekapt: Array.isArray(j) && j.length > 0 };
      if (!Array.isArray(j) || !j.length) return { lijst, afgekapt: false };
      lijst.push(...j); if (j.length < per) return { lijst, afgekapt: false };
    }
  };

  // ── Periodekeuze: maand, kwartaal of jaar, over de lopende maand t/m +24 maanden ────────────────────
  // Een eenheid is een lijst blokken (elk met de maand-offsets van t/m); de selectie is {eenheid, i0, i1} (indexen in die lijst).
  // Kwartaal en jaar zijn kalenderkwartalen en -jaren; het eerste blok begint bij de lopende maand, het laatste eindigt bij +24.
  const HORIZON = 24;
  F.HORIZON = HORIZON; F.EENHEDEN = ['maand', 'kwartaal', 'jaar'];
  F.eenheden = function (nu, eenheid) {
    const lijst = [];
    for (let i = 0; i <= HORIZON; i++) {
      const ym = maandPlus(nu, i), jr = ym.slice(0, 4), kw = Math.floor((Number(ym.slice(5, 7)) - 1) / 3) + 1;
      const sleutel = eenheid === 'jaar' ? jr : eenheid === 'kwartaal' ? jr + '-K' + kw : ym, l = lijst[lijst.length - 1];
      if (l && l.sleutel === sleutel) { l.tot = i; l.maanden.push(ym); }
      else lijst.push({ sleutel, label: eenheid === 'jaar' ? jr : eenheid === 'kwartaal' ? 'K' + kw + ' ' + jr : maandTekst(ym), van: i, tot: i, maanden: [ym] });
    }
    return lijst;
  };
  F.eenheidBijMaand = (lijst, m) => lijst.findIndex(u => m >= u.van && m <= u.tot);
  F.selStandaard = () => ({ eenheid: 'maand', i0: 0, i1: 5 });                      // lopende maand + 5
  F.selSchoon = function (sel, lijst) {
    const k = v => Math.max(0, Math.min(lijst.length - 1, Math.round(Number(v) || 0)));
    let a = k(sel.i0), b = k(sel.i1); if (b < a) [a, b] = [b, a];
    return { eenheid: sel.eenheid, i0: a, i1: b };
  };
  F.selKies = (sel, lijst, idx) => F.selSchoon({ eenheid: sel.eenheid, i0: idx, i1: idx }, lijst);                              // klik op één blok
  F.selNieuw = (sel, lijst, a, b) => F.selSchoon({ eenheid: sel.eenheid, i0: Math.min(a, b), i1: Math.max(a, b) }, lijst);       // sleep over leeg spoor
  F.selGreep = (sel, lijst, greep, idx) => greep === 'van' ? F.selSchoon({ eenheid: sel.eenheid, i0: Math.min(idx, sel.i1), i1: sel.i1 }, lijst) : F.selSchoon({ eenheid: sel.eenheid, i0: sel.i0, i1: Math.max(idx, sel.i0) }, lijst);
  F.selVerschuif = function (sel, lijst, d) {                                                                                     // het hele bereik schuiven, breedte blijft gelijk
    const breed = sel.i1 - sel.i0, i0 = Math.max(0, Math.min(lijst.length - 1 - breed, sel.i0 + d));
    return { eenheid: sel.eenheid, i0, i1: i0 + breed };
  };
  // Andere eenheid: dezelfde maanden, vastgeklikt op de nieuwe blokken.
  F.selNaarEenheid = function (sel, nu, nieuw) {
    const oud = F.eenheden(nu, sel.eenheid), lijst = F.eenheden(nu, nieuw), s = oud[Math.min(sel.i0, oud.length - 1)], e = oud[Math.min(sel.i1, oud.length - 1)];
    return F.selSchoon({ eenheid: nieuw, i0: F.eenheidBijMaand(lijst, s.van), i1: F.eenheidBijMaand(lijst, e.tot) }, lijst);
  };
  // Positie op het spoor (0..1) → het blok daaronder.
  F.indexBijPositie = (frac, lijst) => F.eenheidBijMaand(lijst, Math.min(HORIZON, Math.max(0, Math.floor((Number(frac) || 0) * (HORIZON + 1)))));
  F.kolommen = (lijst, sel) => lijst.slice(sel.i0, sel.i1 + 1);
  F.selTekst = sel => `${sel.eenheid}:${sel.i0}:${sel.i1}`;
  F.selLees = function (tekst, nu) {
    const m = /^(maand|kwartaal|jaar):(\d{1,2}):(\d{1,2})$/.exec(String(tekst || '')); if (!m) return F.selStandaard();
    return F.selSchoon({ eenheid: m[1], i0: Number(m[2]), i1: Number(m[3]) }, F.eenheden(nu, m[1]));
  };
  const somVan = (a, k) => { let s = 0; for (let i = k.van; i <= k.tot; i++) s += a[i] || 0; return s; };
  // De maandtotalen (F.totalen over 25 maanden) per gekozen kolom; alles na de laatste kolom gaat naar "later".
  F.groepeerTotalen = function (tot, kols) {
    const laatste = kols.length ? kols[kols.length - 1].tot : -1, na = a => { let s = 0; for (let i = laatste + 1; i < a.length; i++) s += a[i] || 0; return s; };
    const uit = { kolommen: kols, later: {}, eerder: tot.eerder };
    for (const k of ['gepland', 'binnen', 'open', 'kosten', 'overig', 'netto']) { uit[k] = kols.map(x => somVan(tot[k], x)); uit.later[k] = na(tot[k]) + ((tot.later && tot.later[k]) || 0); }
    return uit;
  };
  // Eén rij over een kolom (som van de maanden): vrij gepland, al gefactureerd (vast) en vast open deel.
  F.rijKolom = function (r, kol) {
    const o = { vrijC: 0, vastGefC: 0, vastOpenC: 0 };
    for (let i = kol.van; i <= kol.tot; i++) { const m = r.maanden[i]; if (m) { o.vrijC += m.vrijC; o.vastGefC += m.vastGefC; o.vastOpenC += m.vastOpenC; } }
    return o;
  };
  F.rijLater = function (r, kols) {
    const laatste = kols.length ? kols[kols.length - 1].tot : -1; let s = r.laterC;
    for (let i = laatste + 1; i < r.maanden.length; i++) s += r.maanden[i].vrijC + r.maanden[i].vastOpenC;
    return s;
  };

  // ── Maandtotalen ─────────────────────────────────────────────────────────────
  // events: de tijdlijn-events. effect(e) → delta op de lopende rekening (standaard: intern telt niet). Verdeling:
  //   binnen = prognose-ontvangsten van termijnen (factuurdatum + betaaltermijn + betaalgedrag, zoals Financiën)
  //   kosten = inkoopfacturen en vaste patronen · overig = btw-aangifte, weekinleg en handmatige prognose-posten.
  F.totalen = function (o) {
    const rijen = o.rijen || [], vandaag = o.vandaag, n = o.maanden || 6, nu = vandaag.slice(0, 7), einde = maandPlus(nu, n - 1);
    const effect = o.effect || (e => e.intern ? 0 : (typeof e.delta === 'number' ? c(e.delta) : 0));
    const uitgesloten = new Set(o.uitgesloten || []);
    const kol = () => { const a = []; for (let i = 0; i < n; i++) a.push(0); return a; };
    const t = { maanden: Array.from({ length: n }, (_, i) => maandPlus(nu, i)), gepland: kol(), binnen: kol(), open: kol(), kosten: kol(), overig: kol(), netto: kol(), eerder: { gepland: 0 }, later: { gepland: 0, binnen: 0, open: 0, kosten: 0, overig: 0 } };
    for (const r of rijen) {
      if (!r.aan) continue;
      t.eerder.gepland += r.eerderC; t.later.gepland += r.laterC;
      r.maanden.forEach((m, i) => { t.gepland[i] += m.vrijC + m.vastOpenC; });
    }
    for (const e of o.events || []) {
      if (!e || e.bron === 'bank' || e.saldo_ijkpunt || !e.datum) continue;
      if (e.bron === 'prognose' && e.prognose && uitgesloten.has(e.prognose)) continue;     // dubbel prognose-item van dezelfde offerte
      const soort = e.bron === 'prognose' ? (e.termijn_id ? 'binnen' : 'overig') : e.bron === 'verkoop' ? 'open' : e.bron === 'inkoop' || e.bron === 'patroon' ? 'kosten' : e.bron === 'btw' || e.bron === 'inleg' ? 'overig' : null;
      if (!soort) continue;
      const v = effect(e); if (!v) continue;
      const ym = (e.datum < vandaag ? vandaag : e.datum).slice(0, 7);
      if (ym > einde) t.later[soort] += v; else t[soort][Math.max(0, t.maanden.indexOf(ym))] += v;
    }
    const openAan = o.openAan !== false, kostenAan = o.kostenAan !== false, overigAan = o.overigAan !== false;
    t.netto = t.binnen.map((b, i) => b + (openAan ? t.open[i] : 0) + (kostenAan ? t.kosten[i] : 0) + (overigAan ? t.overig[i] : 0));
    t.later.netto = t.later.binnen + (openAan ? t.later.open : 0) + (kostenAan ? t.later.kosten : 0) + (overigAan ? t.later.overig : 0);
    return t;
  };

  // ── Weergave ─────────────────────────────────────────────────────────────────
  const h = function (tag, attr) {
    const e = document.createElement(tag);
    if (attr) for (const k of Object.keys(attr)) { const v = attr[k]; if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k === 'data') for (const d of Object.keys(v)) e.dataset[d] = v[d]; else if (k === 'value') e.value = v; else if (k === 'checked') e.checked = true; else e.setAttribute(k, v === true ? '' : v); }
    for (let i = 2; i < arguments.length; i++) for (const kid of [].concat(arguments[i])) if (kid != null && kid !== false) e.append(kid && kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };
  const st = F._st = { el: null, bron: null, mag: false, wie: '', data: null, items: {}, schatten: null, schattenT: 0, projecten: null, haalSchatten: null, rijen: [], sel: null, kostenAan: true, overigAan: true, openAan: true, verouderd: false, afgekapt: false, bezig: false, fout: null, uitleg: false, wachtrij: Promise.resolve(), vers: {}, ks: [], cv: '', bt: null };
  const UITLEG = 'Links staan de goedgekeurde offertes uit Moneybird (incl. btw). Typ in een maand het bedrag dat je dan wilt factureren, in zijn geheel of in delen; "rest" zet wat nog niet gepland is in die maand. De planning is dezelfde als de prognose in Financiën (de termijnen van de offerte): de kaslijn, de Factuurplanning en deze tabel rekenen meteen mee. Het vinkje bij een offerte bepaalt of hij meetelt. "Binnen" is de verwachte betaling: factuurdatum plus betaaltermijn en het gewone betaalgedrag van de klant. "Openstaande facturen" zijn de al verstuurde, nog niet betaalde verkoopfacturen per verwachte betaalmaand. Vink die, "lopende kosten" en "overige voorspelling" (btw, weekinleg, handmatige posten) aan of uit om het netto per maand te zien. Een deel dat al in Moneybird gefactureerd is, staat vast. Een offerte kan in hoogstens 6 delen. Er gaat nooit iets naar Moneybird.';
  function css() {
    if (document.getElementById('mtf-css')) return;
    const s = document.createElement('style'); s.id = 'mtf-css';
    s.textContent = `
.mtf{--mtf-in:#2A7A4A;--mtf-uit:#B4412F;--mtf-zacht:var(--ink-3,var(--text-faint,#7a786f));font-size:14px;color:var(--ink,#1d1d1b);max-width:1500px;margin:0 auto}
.mtf-kop{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:4px 0 12px}.mtf-kop h2{margin:0 8px 0 0;font-size:20px;font-weight:600}.mtf-kop .ruim{flex:1}
.mtf-chip{font-size:11px;border-radius:10px;padding:1px 7px;background:var(--surface-2,#f1f0ea);color:var(--mtf-zacht);white-space:nowrap}
.mtf-uitleg{font-size:13px;background:var(--surface-2,#f6f5f0);border:1px solid var(--line,#e4e2da);border-radius:8px;padding:10px 12px;margin:0 0 12px;line-height:1.5}
.mtf-melding{padding:14px;color:var(--mtf-zacht)}.mtf-fout{padding:12px 14px;border:1px solid #f0b8aa;background:#fbe3dd;border-radius:8px;margin-bottom:12px}
.mtf-scroll{overflow-x:auto;border:1px solid var(--line,#e4e2da);border-radius:10px;background:var(--surface,#fff)}
.mtf-tabel{border-collapse:separate;border-spacing:0;min-width:100%;font-size:13px}
.mtf-tabel th,.mtf-tabel td{padding:6px 10px;border-bottom:1px solid var(--line-soft,#eeece5);vertical-align:middle;white-space:nowrap;text-align:right}
.mtf-tabel thead th{font-weight:500;color:var(--mtf-zacht);background:var(--surface,#fff);position:sticky;top:0;border-bottom:1px solid var(--line,#e4e2da)}
.mtf-tabel .s{text-align:left;position:sticky;left:0;z-index:1;background:var(--surface,#fff);min-width:230px;max-width:290px;white-space:normal;border-right:1px solid var(--line-soft,#eeece5)}
.mtf-tabel thead .s{z-index:2}
.mtf-tabel .nu{background:var(--primary-soft,#e9f1ec);color:var(--ink,#1d1d1b)}
.mtf-tabel td.num,.mtf-tabel th.num{font-family:var(--font-mono,ui-monospace,Menlo,monospace);font-variant-numeric:tabular-nums}
.mtf-naam{display:flex;gap:8px;align-items:flex-start}.mtf-naam input{margin-top:3px;width:16px;height:16px;flex:none}.mtf-naam b{font-weight:500;display:block;line-height:1.3}.mtf-naam small{display:block;color:var(--mtf-zacht);font-size:11px;line-height:1.3}
.mtf-rij.uit td:not(.s){opacity:.45}.mtf-rij.uit .s .mtf-naam b{color:var(--mtf-zacht)}
.mtf-cel{display:flex;flex-direction:column;align-items:flex-end;gap:2px;min-width:92px}
.mtf-in{width:92px;height:30px;text-align:right;border:1px solid var(--line-strong,#cfcdc3);border-radius:6px;padding:0 8px;background:var(--surface,#fff);color:var(--ink,#1d1d1b);font:inherit;font-family:var(--font-mono,ui-monospace,Menlo,monospace);font-variant-numeric:tabular-nums}
.mtf-in:focus{outline:2px solid var(--primary,#2A4A38);outline-offset:-1px}.mtf-in::placeholder{color:#b3b0a4}
.mtf-gef{font-size:11px;color:var(--mtf-zacht)}.mtf-vast{font-size:12px}
.mtf-rest{border:0;background:none;color:var(--primary-text,#2A4A38);font-size:11px;cursor:pointer;padding:0;text-decoration:underline}
.mtf-rest:disabled{opacity:.4;cursor:default}
.mtf-eerder{font-size:11px}
.mtf-tabel tfoot td,.mtf-tabel tfoot th{background:var(--surface-2,#f7f6f1);font-weight:500;border-bottom:1px solid var(--line-soft,#eeece5)}
.mtf-tabel tfoot .s{background:var(--surface-2,#f7f6f1)}.mtf-tabel tfoot tr.netto td,.mtf-tabel tfoot tr.netto th{font-weight:600;border-top:2px solid var(--line-strong,#cfcdc3)}
.mtf-tabel tfoot label{display:flex;gap:8px;align-items:center;cursor:pointer}.mtf-tabel tfoot input{width:16px;height:16px}
.mtf-p{color:var(--mtf-in)}.mtf-n{color:var(--mtf-uit)}.mtf-0{color:var(--mtf-zacht)}
.mtf input[type=checkbox]{accent-color:var(--primary,#2A4A38)}
.mtf-waarsch{background:#fbe3dd;border:1px solid #f0b8aa;border-radius:6px;padding:6px 8px;font-size:12px;margin-top:6px;line-height:1.4;color:#7a2a1c}
.mtf-waarsch b{font-weight:600}.mtf-sm{height:26px;font-size:12px;margin-top:4px}
.mtf input:disabled,.mtf button:disabled{opacity:.5;cursor:not-allowed}
.mtf-seg-knoppen{display:inline-flex}.mtf-seg-knoppen .ui-knop{border-radius:0;margin-left:-1px}.mtf-seg-knoppen .ui-knop:first-child{border-radius:8px 0 0 8px;margin-left:0}.mtf-seg-knoppen .ui-knop:last-child{border-radius:0 8px 8px 0}
.mtf-balk{margin:0 0 12px;padding:0 2px}.mtf-jaren{position:relative;height:16px;font-size:11px;color:var(--mtf-zacht)}.mtf-jaren span{position:absolute;top:0;white-space:nowrap}
.mtf-spoor{position:relative;height:40px;border:1px solid var(--line,#e4e2da);border-radius:8px;background:var(--surface,#fff);touch-action:none;user-select:none;-webkit-user-select:none;cursor:pointer}
.mtf-seg{position:absolute;top:0;bottom:0;border:0;border-left:1px solid var(--line-soft,#eeece5);background:none;padding:0;font:inherit;font-size:11px;color:var(--mtf-zacht);overflow:hidden;white-space:nowrap;cursor:pointer}
.mtf-seg:first-child{border-left:0}.mtf-seg.in{color:var(--ink,#1d1d1b)}.mtf-seg .l{display:none}
.mtf-sel{position:absolute;top:2px;bottom:2px;background:rgba(42,74,56,.13);border:2px solid var(--primary,#2A4A38);border-radius:6px;cursor:grab;z-index:1;pointer-events:auto}
.mtf-sel:active{cursor:grabbing}
.mtf-greep{position:absolute;top:50%;width:14px;height:26px;margin-top:-13px;background:var(--primary,#2A4A38);border-radius:5px;cursor:ew-resize;z-index:2}
.mtf-greep::before{content:"";position:absolute;top:-8px;bottom:-8px;left:-8px;right:-8px}
.mtf-greep.van{left:-8px}.mtf-greep.tot{right:-8px}
.mtf-greep:focus-visible{outline:3px solid var(--primary,#2A4A38);outline-offset:3px}
.mtf-agg{border:0;background:none;font:inherit;color:inherit;cursor:pointer;padding:2px 4px;border-radius:4px;display:flex;flex-direction:column;align-items:flex-end;margin-left:auto}
.mtf-agg:hover{background:var(--surface-2,#f1f0ea)}.mtf-kopknop{font-weight:500;color:var(--mtf-zacht);display:inline}
@media (max-width:700px){.mtf-seg .k{display:none}.mtf-seg .l{display:inline}.mtf-spoor.kwartaal .mtf-seg .k,.mtf-spoor.jaar .mtf-seg .k{display:inline}.mtf-spoor.kwartaal .mtf-seg .l,.mtf-spoor.jaar .mtf-seg .l{display:none}.mtf-spoor.kwartaal .mtf-seg{font-size:10px}}
.mtf-bezig{opacity:.6;pointer-events:none}
.mtf-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink,#1d1d1b);color:#fff;padding:9px 14px;border-radius:8px;font-size:13px;z-index:9999;max-width:90vw}
.mtf-voet{font-size:12px;color:var(--mtf-zacht);margin:8px 2px}
@media (max-width:700px){.mtf-tabel .s{min-width:140px;max-width:150px}.mtf-kop h2{font-size:17px}}
`;
    document.head.appendChild(s);
  }
  function toast(t) { document.querySelectorAll('.mtf-toast').forEach(x => x.remove()); const o = h('div', { class: 'mtf-toast', role: 'status' }, t); document.body.appendChild(o); setTimeout(() => o.remove(), 4500); }

  function maakKnop(tekst, attr) { return h('button', Object.assign({ type: 'button', class: 'ui-knop' }, attr), tekst); }
  const bedragTd = (cc, klasse) => h('td', { class: 'num ' + (klasse || '') }, cc ? F.fmt(cc) : h('span', { class: 'mtf-0' }, '—'));
  const getalTd = (cc, klasse) => h('td', { class: 'num ' + (klasse || '') }, cc === 0 ? h('span', { class: 'mtf-0' }, '—') : h('span', { class: cc < 0 ? 'mtf-n' : 'mtf-p' }, F.fmt(cc)));

  function rijEl(r, nu, kols, edit) {
    const mag = st.mag, uit = st.verouderd, blok = r.afwijkt, tr = h('tr', { class: 'mtf-rij' + (r.aan ? '' : ' uit'), data: { sl: r.sleutel } });
    const sub = [r.offertenr && 'offerte ' + r.offertenr, r.extra && 'staat in de prognose, geen openstaande offerte', ].filter(Boolean).join(' · ');
    const waarsch = [];
    if (r.afwijkt) waarsch.push(h('div', { class: 'mtf-waarsch' }, h('b', null, 'Bedrag wijkt af. '), `In Moneybird staat ${F.fmt(r.mbTotaalC)}, de prognose rekent met ${F.fmt(r.totaalC)}. Plannen is geblokkeerd tot dit is bijgewerkt. `,
      mag ? h('button', { type: 'button', class: 'ui-knop mtf-sm', disabled: uit, data: { bijwerk: r.sleutel } }, 'Bijwerken naar Moneybird-bedrag') : null));
    for (const d of r.dubbelen) waarsch.push(h('div', { class: 'mtf-waarsch' }, h('b', null, 'Dubbel in Financiën. '), `Nog een prognose-item (${d.naam}, ${F.fmt(d.totaalC)}) hoort bij deze offerte. Het telt hier niet mee, maar wel in Financiën. `,
      mag ? h('button', { type: 'button', class: 'ui-knop mtf-sm', disabled: uit, data: { dubbeluit: d.sleutel } }, 'Zet dat item uit') : null));
    tr.append(h('td', { class: 's' }, h('label', { class: 'mtf-naam' },
      h('input', { type: 'checkbox', checked: r.aan, disabled: !mag || uit, 'aria-label': 'Telt mee in prognose: ' + r.naam, title: 'Telt mee in prognose. Zet ook ‘gaat zeker door’ in Financiën aan of uit.', data: { aan: r.sleutel } }),
      h('span', null, h('b', null, r.naam), sub ? h('small', null, sub) : null)), waarsch));
    tr.append(h('td', { class: 'num' + (r.afwijkt ? ' mtf-n' : ''), title: r.afwijkt ? 'Prognose rekent met ' + F.fmt(r.totaalC) + '; Moneybird: ' + F.fmt(r.mbTotaalC) : null }, F.fmt(r.afwijkt ? r.mbTotaalC : r.totaalC)),
      h('td', { class: 'num', title: r.gecrediteerd ? 'Netto, na creditnota’s' : null }, r.gefNettoC ? h('span', { class: r.gefNettoC < 0 ? 'mtf-n' : null }, F.fmt(r.gefNettoC)) : h('span', { class: 'mtf-0' }, '—'), r.gecrediteerd ? h('div', { class: 'mtf-gef' }, 'gecrediteerd' + (r.creditC ? ' ' + F.fmt(r.creditC) : '')) : null),
      h('td', { class: 'num' }, r.nogC > 0 ? F.fmt(r.nogC) : h('span', { class: 'mtf-0' }, r.bestaat ? 'gepland' : '—')));
    if (st.heeftEerder) tr.append(h('td', { class: 'num' }, r.eerderC ? h('div', { class: 'mtf-cel' }, F.fmt(r.eerderC), mag && r.eerderVrijC ? h('button', { type: 'button', class: 'mtf-rest', disabled: uit || blok, data: { eerder: r.sleutel }, title: 'De factuurdatum is voorbij: zet de open termijnen in de lopende maand' }, 'naar deze maand') : null) : h('span', { class: 'mtf-0' }, '—')));
    kols.forEach((kol, ki) => {
      const nuKol = kol.van === 0;
      if (!edit) {                                                // kwartaal/jaar: som, alleen lezen; klik = naar de maanden van deze periode
        const s = F.rijKolom(r, kol), gepl = s.vrijC + s.vastOpenC;
        const inh = gepl || s.vastGefC ? h('button', { type: 'button', class: 'mtf-agg', data: { spring: String(ki) }, title: 'Klik om deze periode per maand te bewerken' }, gepl ? F.fmt(gepl) : null, s.vastGefC ? h('span', { class: 'mtf-gef' }, 'gefactureerd ' + F.fmt(s.vastGefC)) : null) : h('button', { type: 'button', class: 'mtf-agg mtf-0', data: { spring: String(ki) }, title: 'Klik om deze periode per maand te bewerken' }, '—');
        tr.append(h('td', { class: 'num' + (nuKol ? ' nu' : '') }, inh)); return;
      }
      const m = r.maanden[kol.van], inhoud = h('div', { class: 'mtf-cel' });
      if (m.vastGefC) inhoud.append(h('span', { class: 'mtf-gef', title: 'Al gefactureerd in Moneybird' }, 'gefactureerd ' + F.fmt(m.vastGefC)));
      if (m.vastOpenC) inhoud.append(h('span', { class: 'mtf-vast', title: 'Deel van een termijn die al gedeeltelijk gefactureerd is: vast' }, F.fmt(m.vastOpenC) + ' (vast)'));
      if (mag) {
        inhoud.append(h('input', { class: 'mtf-in', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: m.vrijC ? F.fmt(m.vrijC) : '', placeholder: '—', disabled: uit || blok, 'aria-label': r.naam + ', facturatie ' + maandTekst(m.ym), title: m.datum ? 'Factuurdatum ' + m.datum : 'Bedrag dat je in deze maand factureert', data: { sl: r.sleutel, ym: m.ym } }));
        if (r.nogC > 0) inhoud.append(h('button', { type: 'button', class: 'mtf-rest', disabled: uit || blok, data: { rest: r.sleutel, ym: m.ym }, title: 'Zet het nog niet geplande deel (' + F.fmt(r.nogC) + ') in deze maand' }, 'rest hier'));
      } else if (m.vrijC) inhoud.append(F.fmt(m.vrijC));
      tr.append(h('td', { class: 'num' + (m.ym === nu ? ' nu' : '') }, inhoud.childNodes.length ? inhoud : h('span', { class: 'mtf-0' }, '—')));
    });
    if (st.heeftLater) { const l = F.rijLater(r, kols); tr.append(bedragTd(l)); }
    return tr;
  }

  // Tijdbalk: lopende maand t/m +24 maanden, met de gekozen periode gemarkeerd. Klik = dat blok kiezen, grepen slepen = bereik
  // groter/kleiner (klikt vast op het blok), het gemarkeerde stuk slepen = verschuiven. Pijltjes en Shift+pijltjes op de grepen.
  const bewaarSel = () => ls.set('mtg:fc:per:' + st.wie, F.selTekst(st.sel));
  function posSel(spoor, lijst) {
    const N = F.HORIZON + 1, s = st.sel, a = lijst[s.i0].van, b = lijst[s.i1].tot, sel = spoor.querySelector('.mtf-sel');
    if (sel) { sel.style.left = (a / N * 100) + '%'; sel.style.width = ((b - a + 1) / N * 100) + '%'; }
    spoor.querySelectorAll('.mtf-seg').forEach((x, i) => x.classList.toggle('in', i >= s.i0 && i <= s.i1));
    [['van', s.i0], ['tot', s.i1]].forEach(([g, i]) => { const e = spoor.querySelector('.mtf-greep.' + g); if (e) { e.setAttribute('aria-valuenow', String(i)); e.setAttribute('aria-valuetext', lijst[i].label); } });
  }
  function sliderEl(nu) {
    const N = F.HORIZON + 1, lijst = F.eenheden(nu, st.sel.eenheid), s = st.sel;
    const spoor = h('div', { class: 'mtf-spoor ' + st.sel.eenheid, data: { slider: '1' } });
    lijst.forEach((u, i) => {
      const seg = h('button', { type: 'button', class: 'mtf-seg', tabindex: '-1', 'aria-label': u.label, data: { seg: String(i) } }, h('span', { class: 'k' }, u.label.replace(/ \d{4}$/, '')), h('span', { class: 'l' }, st.sel.eenheid === 'maand' ? u.label.charAt(0) : u.label.replace(/ \d{4}$/, '')));
      seg.style.left = (u.van / N * 100) + '%'; seg.style.width = ((u.tot - u.van + 1) / N * 100) + '%'; spoor.append(seg);
    });
    const greep = (g, i) => h('div', { class: 'mtf-greep ' + g, role: 'slider', tabindex: '0', 'aria-orientation': 'horizontal', 'aria-label': g === 'van' ? 'Begin van de periode' : 'Einde van de periode', 'aria-valuemin': '0', 'aria-valuemax': String(lijst.length - 1), 'aria-valuenow': String(i), 'aria-valuetext': lijst[i].label, data: { greep: g } });
    spoor.append(h('div', { class: 'mtf-sel', title: 'Sleep om de periode te verschuiven' }, greep('van', s.i0), greep('tot', s.i1)));
    // jaarlabels boven het spoor
    const jaren = h('div', { class: 'mtf-jaren', 'aria-hidden': 'true' });
    F.eenheden(nu, 'jaar').forEach(u => { const e = h('span', null, u.label); e.style.left = (u.van / N * 100) + '%'; jaren.append(e); });
    const wrap = h('div', { class: 'mtf-balk' }, jaren, spoor);
    posSel(spoor, lijst);
    bindSpoor(spoor, lijst);
    return wrap;
  }
  function bindSpoor(spoor, lijst) {
    spoor.addEventListener('pointerdown', ev => {
      if (ev.button > 0 || st.slidermodus) return;
      const r = spoor.getBoundingClientRect(), idxBij = x => F.indexBijPositie((x - r.left) / r.width, lijst);
      const greep = ev.target.closest('.mtf-greep'), inSel = ev.target.closest('.mtf-sel');
      const modus = greep ? greep.dataset.greep : inSel ? 'schuif' : 'nieuw', start = { x: ev.clientX, idx: idxBij(ev.clientX), sel: Object.assign({}, st.sel) };
      let bewogen = false; st.slidermodus = modus;
      try { spoor.setPointerCapture(ev.pointerId); } catch (e) { }
      ev.preventDefault();
      const beweeg = e => {
        if (Math.abs(e.clientX - start.x) > 3) bewogen = true; if (!bewogen) return;
        const idx = idxBij(e.clientX);
        st.sel = modus === 'van' || modus === 'tot' ? F.selGreep(start.sel, lijst, modus, idx) : modus === 'schuif' ? F.selVerschuif(start.sel, lijst, idx - start.idx) : F.selNieuw(start.sel, lijst, start.idx, idx);
        posSel(spoor, lijst);
      };
      const klaar = () => {
        spoor.removeEventListener('pointermove', beweeg); spoor.removeEventListener('pointerup', klaar); spoor.removeEventListener('pointercancel', klaar); st.slidermodus = null;
        if (!bewogen && !greep) st.sel = F.selKies(start.sel, lijst, start.idx);        // een klik kiest dat blok
        bewaarSel(); teken();
      };
      spoor.addEventListener('pointermove', beweeg); spoor.addEventListener('pointerup', klaar); spoor.addEventListener('pointercancel', klaar);
    });
    spoor.addEventListener('keydown', ev => {
      const g = ev.target.closest && ev.target.closest('.mtf-greep'); if (!g) return;
      const dir = ev.key === 'ArrowRight' || ev.key === 'ArrowUp' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowDown' ? -1 : 0, bound = g.dataset.greep;
      let s = null;
      if (dir) s = ev.shiftKey ? F.selVerschuif(st.sel, lijst, dir) : F.selGreep(st.sel, lijst, bound, (bound === 'van' ? st.sel.i0 : st.sel.i1) + dir);
      else if (ev.key === 'Home') s = F.selGreep(st.sel, lijst, bound, 0); else if (ev.key === 'End') s = F.selGreep(st.sel, lijst, bound, lijst.length - 1);
      if (!s) return; ev.preventDefault(); st.sel = s; st.focusGreep = bound; bewaarSel(); teken();
    });
    spoor.addEventListener('click', ev => {                       // toetsenbord (Enter/spatie op een blok); muis en touch gaan via pointerdown
      const b = ev.target.closest && ev.target.closest('.mtf-seg'); if (!b || ev.detail !== 0) return;
      st.sel = F.selKies(st.sel, lijst, Number(b.dataset.seg)); bewaarSel(); teken();
    });
  }

  function tekenTabel() {
    const vandaag = st.data.vandaag, nu = vandaag.slice(0, 7), rijen = st.rijen, edit = st.sel.eenheid === 'maand';
    const lijst = F.eenheden(nu, st.sel.eenheid), kols = F.kolommen(lijst, st.sel);
    st.heeftEerder = rijen.some(r => r.aan && r.eerderC);
    const G = root.MTGeld, groep = G && G.groep ? G.groep(st.data) : null;
    const tot = F.totalen({ rijen, events: st.data.events, vandaag, maanden: F.HORIZON + 1, uitgesloten: st.rijen.reduce((a, r) => a.concat(r.dubbelen.map(d => d.sleutel)), []), openAan: st.openAan, kostenAan: st.kostenAan, overigAan: st.overigAan, effect: G && G.effect && groep ? (e => c(G.effect(e, 'lopend', groep))) : null });
    const g = F.groepeerTotalen(tot, kols);
    st.heeftLater = rijen.some(r => r.aan && F.rijLater(r, kols) > 0) || ['gepland', 'binnen', 'open', 'kosten', 'overig'].some(k => g.later[k] !== 0);
    const kop = h('tr', null, h('th', { class: 's', title: 'Het vinkje bepaalt of de offerte meetelt in de prognose (zelfde als ‘gaat zeker door’ in Financiën)' }, 'Goedgekeurde offertes'), h('th', { class: 'num' }, 'Offerte'), h('th', { class: 'num' }, 'Gefactureerd'), h('th', { class: 'num' }, 'Nog te plannen'),
      st.heeftEerder ? h('th', { class: 'num', title: 'Factuurdatum voorbij, nog niet gefactureerd' }, 'Eerder') : null,
      kols.map((k, ki) => h('th', { class: 'num' + (k.van === 0 ? ' nu' : ''), title: edit ? null : k.maanden[0] + ' t/m ' + k.maanden[k.maanden.length - 1] }, edit ? k.label : h('button', { type: 'button', class: 'mtf-agg mtf-kopknop', data: { spring: String(ki) }, title: 'Per maand bekijken en bewerken' }, k.label))),
      st.heeftLater ? h('th', { class: 'num', title: 'Alles na de gekozen periode' }, 'Later') : null);
    const foot = [];
    const regel = (label, cellen, eerder, later, klasse, extra) => h('tr', { class: klasse || '' }, h('th', { class: 's' }, extra || label), h('td'), h('td'), h('td'), st.heeftEerder ? (eerder != null ? getalTd(eerder) : h('td')) : null, cellen, st.heeftLater ? (later != null ? getalTd(later) : h('td')) : null);
    foot.push(regel('Gefactureerd (gepland)', g.gepland.map(v => bedragTd(v, 'mtf-p')), tot.eerder.gepland, g.later.gepland, '', h('span', { title: 'Wat je in die periode factureert, van de offertes die meetellen' }, 'Gefactureerd (gepland)')));
    foot.push(regel('Binnen', g.binnen.map(v => getalTd(v)), null, g.later.binnen, '', h('span', { title: 'Verwachte betaling: factuurdatum plus betaaltermijn en het gewone betaalgedrag van de klant, zoals in Financiën' }, 'Binnen (betaaldatum)')));
    foot.push(regel('', g.open.map(v => getalTd(v)), null, g.later.open, '', h('label', { title: 'Al verstuurde verkoopfacturen die nog niet betaald zijn, per verwachte betaalmaand (dezelfde bron als de kaslijn in Financiën)' }, h('input', { type: 'checkbox', checked: st.openAan, data: { open: '1' } }), 'Openstaande facturen')));
    foot.push(regel('', g.kosten.map(v => getalTd(v)), null, g.later.kosten, '', h('label', { title: 'Inkoopfacturen en vaste patronen uit Financiën' }, h('input', { type: 'checkbox', checked: st.kostenAan, data: { kosten: '1' } }), 'Lopende kosten')));
    foot.push(regel('', g.overig.map(v => getalTd(v)), null, g.later.overig, '', h('label', { title: 'Btw-aangifte, weekinleg en handmatige posten uit Financiën' }, h('input', { type: 'checkbox', checked: st.overigAan, data: { overig: '1' } }), 'Overige voorspelling')));
    foot.push(regel('Netto', g.netto.map(v => getalTd(v)), null, g.later.netto, 'netto', h('span', { title: 'Binnen, min de aangevinkte kosten' }, 'Netto per ' + (st.sel.eenheid === 'maand' ? 'maand' : st.sel.eenheid))));
    const tab = h('table', { class: 'mtf-tabel' }, h('thead', null, kop), h('tbody', null, rijen.map(r => rijEl(r, nu, kols, edit))), h('tfoot', null, foot));
    return h('div', { class: 'mtf-scroll' }, tab);
  }

  function teken() {
    const el = st.el; if (!el) return;
    const eenh = h('div', { class: 'mtf-seg-knoppen', role: 'group', 'aria-label': 'Periode-eenheid' }, F.EENHEDEN.map(x => h('button', { type: 'button', class: 'ui-knop' + (st.sel.eenheid === x ? ' ui-knop--primair' : ''), 'aria-pressed': String(st.sel.eenheid === x), data: { eenheid: x } }, x.charAt(0).toUpperCase() + x.slice(1))));
    const kop = h('div', { class: 'mtf-kop' }, h('h2', null, 'Forecast'), h('span', { class: 'mtf-chip' }, 'incl. btw'), h('span', { class: 'ruim' }), eenh,
      maakKnop('Vernieuwen', { data: { vernieuw: '1' } }), maakKnop('Uitleg', { 'aria-expanded': String(st.uitleg), data: { uitleg: '1' } }));
    const w = h('div', { class: 'mtf' + (st.bezig ? ' mtf-bezig' : '') }, kop, st.uitleg ? h('div', { class: 'mtf-uitleg' }, UITLEG) : null);
    if (st.data) w.append(sliderEl(st.data.vandaag.slice(0, 7)));
    if (st.verouderd) w.append(h('div', { class: 'mtf-fout' }, h('b', null, 'Gegevens verouderd — Vernieuwen. '), 'Wijzigen is uitgeschakeld tot het verversen lukt.'));
    if (st.fout) w.append(h('div', { class: 'mtf-fout' }, st.fout));
    if (st.afgekapt) w.append(h('div', { class: 'mtf-fout' }, h('b', null, 'Lijst afgekapt. '), 'Er zijn meer geaccepteerde offertes in Moneybird dan hier getoond worden; de lijst is dus niet volledig.'));
    if (!st.data) { w.append(h('div', { class: 'mtf-melding' }, st.fout ? '' : 'Forecast laden…')); }
    else if (!st.rijen.length) w.append(h('div', { class: 'mtf-melding' }, 'Geen goedgekeurde offertes in Moneybird gevonden.'));
    else {
      w.append(tekenTabel());
      const waarsch = (st.data.waarschuwingen || []).filter(x => x && x.onvolledig).length;
      w.append(h('div', { class: 'mtf-voet' }, 'Wat je hier plant, staat ook in de prognose van Financiën.' + (st.sel.eenheid === 'maand' ? '' : ' Kwartaal en jaar zijn sommen: klik op een periode om per maand te bewerken.') + (st.mag ? '' : ' Je mag lezen, niet wijzigen.') + (waarsch ? ' Let op: niet alle bronnen van Financiën zijn volledig geladen; de bedragen onderaan kunnen afwijken.' : '')));
    }
    el.replaceChildren(w);
    if (st.focusGreep) { const g = el.querySelector('.mtf-greep.' + st.focusGreep); if (g) g.focus(); st.focusGreep = null; }
  }

  // ── Laden en opslaan ─────────────────────────────────────────────────────────
  const verseKs = () => st.ks.filter(x => Date.now() - x.t < 180000).map(x => x.k);
  function rekenRijen() {
    const items = Object.assign({}, st.items);
    for (const k of Object.keys(st.vers)) { const v = st.vers[k]; if (Date.now() - v.t < 120000 && (!items[k] || (items[k].ts || 0) < (v.item.ts || 0))) items[k] = v.item; else if (Date.now() - v.t >= 120000) delete st.vers[k]; }
    st.itemsEff = items;
    st.rijen = F.bouwRijen({ schatten: st.schatten || [], events: (st.data && st.data.events) || [], items, posten: (st.data && st.data.prognose && st.data.prognose.posten) || [], projecten: st.projecten ? st.projecten() : [], vandaag: st.data.vandaag, maanden: F.HORIZON + 1 });
  }
  const tijdlijnPad = vers => { const v = st.data ? st.data.vandaag : new Date().toISOString().slice(0, 10); return `/geld/tijdlijn?van=${dagPlus(v, -35)}&tot=${dagPlus(v, 364)}&historie=1${vers ? '&vers=1' : ''}${st.cv ? '&cv=' + encodeURIComponent(st.cv) : ''}${verseKs().length ? '&ks=' + encodeURIComponent(verseKs().join(',')) : ''}`; };
  F.laad = async function (vers) {
    if (!st.el) return;
    const pad = tijdlijnPad(vers);
    st.fout = null;
    try {
      const nodig = !st.schatten || vers === 'schatten' || Date.now() - st.schattenT > 120000;
      const [d, p, s] = await Promise.all([st.bron.haal(pad), st.bron.haal('/geld/prognose'), nodig ? st.haalSchatten() : Promise.resolve(null)]);
      if (!d || d.error) throw new Error(d && d.error || 'geen antwoord van Financiën');
      if (!p || p.error) throw new Error(p && p.error || 'prognose niet te lezen');
      if (s) { st.schatten = (Array.isArray(s) ? s : s.lijst || []).map(F.schatNorm).filter(Boolean); st.afgekapt = !Array.isArray(s) && !!s.afgekapt; st.schattenT = Date.now(); }
      st.data = d; st.items = p.items || {}; st.verouderd = false;
      if (!st.selGelezen) { st.selGelezen = true; st.sel = F.selLees(ls.get('mtg:fc:per:' + st.wie), d.vandaag.slice(0, 7)); }
      rekenRijen();
    } catch (e) {
      if (st.data) st.verouderd = true;                          // nooit wijzigen op oude context
      const druk = /429|retry later|druk/i.test(String(e.message));
      st.fout = druk ? 'Moneybird is even druk. Probeer het over een minuut opnieuw.' : 'Forecast kon niet (volledig) laden: ' + (e.message || e) + '.';
    }
    st.bezig = false; teken();
  };
  F.start = async function (el, o) {
    st.el = el; st.bron = o.bron; st.mag = !!o.magWijzigen; st.wie = o.wie || ''; st.projecten = o.projecten || null; st.haalSchatten = o.schatten;
    st.kostenAan = ls.get('mtg:fc:kosten:' + st.wie) !== '0'; st.overigAan = ls.get('mtg:fc:overig:' + st.wie) !== '0'; st.openAan = ls.get('mtg:fc:open:' + st.wie) !== '0';
    st.sel = F.selStandaard();
    css(); koppel(); teken(); await F.laad();
  };
  // Eén wijziging tegelijk (de prognose heeft een versiecontrole per item). fn(item, overzicht) → {item} of {fout}.
  function wijzig(sleutel, fn, ok) {
    st.bezig = true; teken();
    st.wachtrij = st.wachtrij.then(async () => {
      try {
        if (st.verouderd) throw new Error('de gegevens zijn verouderd — vernieuw eerst');
        const rij = st.rijen.find(r => r.sleutel === sleutel);
        // Vlak vóór het opslaan het actuele overzicht ophalen: is er intussen gefactureerd, dan niet opslaan op de oude context.
        const vers = await st.bron.haal(tijdlijnPad(true)); if (!vers || vers.error) throw new Error(vers && vers.error || 'actueel overzicht niet te lezen');
        const slot = x => JSON.stringify(((x && x.prognose && x.prognose.posten) || []).filter(q => q.sleutel === sleutel).map(q => [q.gefactureerd, (q.termijnen || []).map(t => [t.id, t.gefactureerd, t.open])]));
        if (slot(vers) !== slot(st.data)) { st.data = vers; throw new Error('er is intussen gefactureerd of gewijzigd voor deze offerte; de tabel is ververst, probeer het opnieuw'); }
        const r = await st.bron.haal('/geld/prognose'); if (!r || r.error) throw new Error(r && r.error || 'prognose niet te lezen');
        const lijst = Object.assign({}, r.items || {}), eigen = st.vers[sleutel];
        if (eigen && Date.now() - eigen.t < 120000 && (!lijst[sleutel] || (lijst[sleutel].ts || 0) < (eigen.item.ts || 0))) lijst[sleutel] = eigen.item;   // KV-lijst loopt achter
        const huidig = lijst[sleutel] && lijst[sleutel].soort !== 'post' ? lijst[sleutel] : null;
        let item = huidig;
        if (!item) {
          if (st.bt == null) { try { const cf = await st.bron.haal('/geld/config'); const sch = cf && cf.config && cf.config.prognose_schema; st.bt = sch && sch.betaaltermijn != null ? Number(sch.betaaltermijn) : 14; } catch (e) { st.bt = 14; } }
          item = F.nieuwItem(rij, st.bt, st.data.vandaag);
        }
        if (!item && !rij) throw new Error('deze offerte staat er niet meer — vernieuw');
        const ov = ((vers.prognose && vers.prognose.posten) || []).find(x => x.sleutel === sleutel && x.soort === 'project') || null;
        const res = fn(item, ov, rij); if (res.fout) { toast(res.fout); return; }
        const body = { sleutel, item: res.item, vorige_ts: huidig ? huidig.ts : null };
        const w = await st.bron.haal('/geld/prognose', { method: 'POST', body });
        if (!w || w.error) throw new Error(w && w.error || 'opslaan mislukt');
        if (w.cachever) st.cv = w.cachever;
        if (w.ks) st.ks = st.ks.filter(x => x.k !== w.ks && Date.now() - x.t < 180000).concat({ k: w.ks, t: Date.now() }).slice(-10);
        if (w.item) st.vers[sleutel] = { item: w.item, t: Date.now() };
        const G = root.MTGeld; if (G && G._st) { if (w.cachever) G._st.cv = w.cachever; if (w.ks) G._st.ks = (G._st.ks || []).filter(x => x.k !== w.ks).concat({ k: w.ks, t: Date.now() }).slice(-10); }
        if (ok) toast(ok);
      } catch (e) { toast('Niet opgeslagen: ' + (e.message || e) + (/aangepast|gewijzigd/.test(String(e.message)) ? ' — herlaad' : '')); }
      await F.laad(true);
    });
    return st.wachtrij;
  }
  function koppel() {
    const el = st.el; if (el._mtfKoppel) return; el._mtfKoppel = true;
    el.addEventListener('change', e => {
      const t = e.target; if (!st.mag || st.verouderd) return;
      if (t.matches && t.matches('input.mtf-in')) {
        const rj = st.rijen.find(r => r.sleutel === t.dataset.sl); if (rj && rj.afwijkt) { toast('Het bedrag wijkt af van Moneybird: werk eerst het bedrag bij.'); teken(); return; }
        const cc = F.parseBedrag(t.value); if (cc == null) { toast('Dit is geen bedrag. Typ bijvoorbeeld 2.500 of 2500,50.'); teken(); return; }
        wijzig(t.dataset.sl, (it, ov) => F.zetCel(it, ov, t.dataset.ym, cc, st.data.vandaag), 'Opgeslagen — Financiën rekent mee');
      } else if (t.dataset && t.dataset.aan) {
        const aan = t.checked, sl = t.dataset.aan, rij = st.rijen.find(r => r.sleutel === sl);
        wijzig(sl, it => F.zetAan(it, aan), aan ? 'Telt mee' : 'Telt niet meer mee (ook niet in de prognose van Financiën)');
        void rij;
      } else if (t.dataset && t.dataset.kosten) { st.kostenAan = t.checked; ls.set('mtg:fc:kosten:' + st.wie, t.checked ? '1' : '0'); teken(); }
      else if (t.dataset && t.dataset.open) { st.openAan = t.checked; ls.set('mtg:fc:open:' + st.wie, t.checked ? '1' : '0'); teken(); }
      else if (t.dataset && t.dataset.overig) { st.overigAan = t.checked; ls.set('mtg:fc:overig:' + st.wie, t.checked ? '1' : '0'); teken(); }
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches && e.target.matches('input.mtf-in')) e.target.blur(); });
    el.addEventListener('click', e => {
      const k = e.target.closest && e.target.closest('button'); if (!k) return;
      const d = k.dataset;
      if (d.eenheid) { if (st.data) { st.sel = F.selNaarEenheid(st.sel, st.data.vandaag.slice(0, 7), d.eenheid); bewaarSel(); teken(); } }
      else if (d.spring) { const nu = st.data.vandaag.slice(0, 7), kol = F.kolommen(F.eenheden(nu, st.sel.eenheid), st.sel)[Number(d.spring)]; if (kol) { st.sel = F.selSchoon({ eenheid: 'maand', i0: kol.van, i1: kol.tot }, F.eenheden(nu, 'maand')); bewaarSel(); teken(); } }
      else if (d.uitleg) { st.uitleg = !st.uitleg; teken(); }
      else if (d.vernieuw) { st.bezig = true; teken(); F.laad('schatten'); }
      else if (d.bijwerk && st.mag && !st.verouderd) { const rij = st.rijen.find(r => r.sleutel === d.bijwerk); if (rij && rij.afwijkt) wijzig(d.bijwerk, (it, ov) => F.bijwerkTotaal(it, ov, rij.mbTotaalC, st.data.vandaag), 'Totaal bijgewerkt naar het Moneybird-bedrag'); }
      else if (d.dubbeluit && st.mag && !st.verouderd) wijzig(d.dubbeluit, it => F.zetAan(it, false), 'Dubbel item uitgezet (niet verwijderd)');
      else if (d.rest && st.mag && !st.verouderd) { const rij = st.rijen.find(r => r.sleutel === d.rest), cc = rij && F.restHier(rij, d.ym); if (cc != null) wijzig(d.rest, (it, ov) => F.zetCel(it, ov, d.ym, cc, st.data.vandaag), 'Rest ingepland — Financiën rekent mee'); }
      else if (d.eerder && st.mag && !st.verouderd) wijzig(d.eerder, (it, ov) => F.eerderNaarNu(it, ov, st.data.vandaag), 'Naar de lopende maand gezet');
    });
  }
})(typeof window !== 'undefined' ? window : this);
if (typeof module !== 'undefined' && module.exports && module.exports.MTForecast) module.exports = module.exports.MTForecast;   // node-tests
