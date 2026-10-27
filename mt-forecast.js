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
  // Compacte bedragen voor smalle kolommen: 950 · 1,2k · 12k · 1,2M (de volle waarde staat in de tooltip).
  F.fmtKort = function (cc) {
    const a = Math.abs(cc) / 100, kort = (v, x) => { const t = Math.round(v * 10) / 10; return String(t).replace('.', ',') + x; };
    const t = a < 1000 ? duizend(Math.round(a)) : a < 10000 ? kort(a / 1000, 'k') : a < 1e6 ? Math.round(a / 1000) + 'k' : kort(a / 1e6, 'M');
    return (cc < 0 ? '−' : '') + t;
  };
  // "Passend maken": kolombreedte zo dat alle gekozen maanden in beeld passen, met een minimum; daaronder compacte bedragen.
  F.passendBreedte = function (beschikbaar, n, o) {
    o = Object.assign({ min: 64, max: 110, compactOnder: 96 }, o || {});
    const ruim = n > 0 ? Math.floor(beschikbaar / n) : o.max, w = Math.max(o.min, Math.min(o.max, ruim));
    return { w, compact: w < o.compactOnder, past: ruim >= o.min };
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
    return { id: String(e.id), nummer: String(e.estimate_id || ''), naam, ref: String(e.reference || '').trim(), contact_id: e.contact_id != null ? String(e.contact_id) : '', totaalC: c(t),
      status: { accepted: 'geaccepteerd', open: 'openstaand', late: 'openstaand', draft: 'concept' }[String(e.state || 'accepted')] || 'overig' };
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
        status: basis.status || null, opleverYm: basis.opleverYm || null, gefNettoC: pool, gefC: Math.max(0, pool), creditC: 0, gecrediteerd: false, dubbelen: [], termijnen: info, maanden: [], eerderC: 0, laterC: 0, eerderVrijC: 0, geplandC: 0 };
      // Creditnota's: het netto gefactureerde bedrag wordt niet weggeklemd getoond; de gecrediteerde bedragen komen uit de openstaande creditregels van de gekoppelde facturen.
      if (ov && Array.isArray(ov.facturen) && ov.facturen.length) for (const e of o.events || []) if (e && e.bron === 'verkoop' && typeof e.delta === 'number' && e.delta < 0 && e.document_id != null && ov.facturen.map(String).includes(String(e.document_id))) r.creditC += -c(e.delta);
      r.gecrediteerd = r.creditC > 0 || pool < 0;
      for (let i = 0; i < n; i++) r.maanden.push({ ym: maandPlus(nu, i), vrijC: 0, vastGefC: 0, vastOpenC: 0, datum: null, label: '' });
      for (const t of info) {
        if (!t.aan) continue;
        if (t.maand < nu) { r.eerderC += t.openC; if (!t.vast) r.eerderVrijC += t.openC; }
        else if (t.maand > einde) r.laterC += t.openC;
        else { const m = r.maanden[r.maanden.findIndex(x => x.ym === t.maand)]; if (t.vast) { m.vastGefC += t.gefC; m.vastOpenC += t.openC; } else { m.vrijC += t.openC; m.datum = m.datum || t.factuurdatum; m.label = m.label || t.label; } }
        r.geplandC += t.openC;
      }
      r.nogC = Math.max(0, totaalC - r.gefC - r.geplandC);       // wat nog in geen enkele maand staat
      r.afwijkt = !!(item && r.schatTotaalC != null && r.schatTotaalC !== totaalC);
      r.mbTotaalC = r.schatTotaalC;
      r.uitbeeld = (o.uitbeeld && r.estimateId && o.uitbeeld[String(r.estimateId)]) || null;
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
      rijen.push(maak(sleutel, { naam, offertenr: s.nummer, code: pr ? pr.code : '', estimateId: s.id, contactId: s.contact_id, totaalC: s.totaalC, status: s.status || 'geaccepteerd', opleverYm: pr && pr.oplevering ? String(pr.oplevering).slice(0, 7) : null }));
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
      totaal: rij.totaalC / 100, betaaltermijn: Number.isInteger(betaaltermijn) && betaaltermijn >= 0 && betaaltermijn <= 120 ? betaaltermijn : 14, aan: !(rij.status && rij.status !== 'geaccepteerd'),
      termijnen: [{ id: 't1', label: REST_LABEL, bedrag: rij.totaalC / 100, factuurdatum: vandaag, aan: false }], k: [], x: [] };
  };
  // Zet de vrije (nog niet gefactureerde) planning van één maand op nieuweC; de rest van het offertebedrag blijft "nog niet gepland".
  F.zetCel = function (item, ov, ym, nieuweC, vandaag, opt) {
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
      lijst.push({ id, label: opt && opt.label != null && String(opt.label).trim() ? String(opt.label).trim().slice(0, 24) : oud ? oud.label : 'termijn', bedrag: nieuweC / 100, factuurdatum: oud ? oud.factuurdatum : zetMaand(ym + '-15', ym, vandaag), aan: true });
    }
    if (rest > 0) {
      const oud = uit[0] || (nieuweC === 0 ? inMaand[0] : null) || null, id = oud && !gebruikt.has(oud.id) ? oud.id : nieuwId(gebruikt); if (!id) return { fout: 'Te veel termijnen.' };
      const laatste = lijst.reduce((a, t) => t.factuurdatum > a ? t.factuurdatum : a, vandaag);
      lijst.push({ id, label: REST_LABEL, bedrag: rest / 100, factuurdatum: laatste, aan: false });
    }
    if (lijst.length > MAX_TERMIJNEN) return { fout: `Een offerte kan in hoogstens ${MAX_TERMIJNEN} delen gepland worden (het nog niet geplande deel telt als één). Voeg bedragen samen of plan de rest in één keer.` };
    if (!lijst.length) return { fout: 'Er is geen termijn over.' };
    lijst.sort((a, b) => String(a.factuurdatum).localeCompare(String(b.factuurdatum)) || a.id.localeCompare(b.id));
    const n = Object.assign(schoon(item), { termijnen: lijst, aan: opt && opt.behoudAan ? item.aan !== false : nieuweC > 0 ? true : item.aan !== false });
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
  // Bij een afwijkend Moneybird-totaal mag ‘Gaat zeker door’ alleen UIT: aanzetten pas na bijwerken. Dit is de controle in het schrijfpad (huidig = het item zoals het nu is opgeslagen).
  F.aanZetFout = function (huidig, nieuw, mbTotaalC) {
    const aanzetten = !!(huidig && nieuw && huidig.aan === false && nieuw.aan !== false), afwijkend = !!(huidig && mbTotaalC != null && c(huidig.totaal) !== mbTotaalC);
    return aanzetten && afwijkend ? 'Het bedrag wijkt af van Moneybird: werk eerst het bedrag bij voordat ‘Gaat zeker door’ aan kan.' : null;
  };
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

  // ── Percentages en factuurschema's ───────────────────────────────────────────────
  // Een percentage van de offerte wordt naar hele centen afgerond; wat overblijft komt vanzelf in het restdeel ("nog niet gepland"),
  // dus de laatste cent gaat altijd naar het restdeel en de termijnen blijven exact optellen tot het offertebedrag.
  F.pctNaarCenten = (totaalC, pct) => Math.round(totaalC * Math.round(pct * 100) / 10000);
  F.centenNaarPct = (totaalC, cc) => totaalC > 0 ? Math.round(cc / totaalC * 10000) / 100 : 0;
  F.parsePct = function (t) {
    const s = String(t == null ? '' : t).replace(/[%\s]/g, '').replace(',', '.');
    if (s === '') return 0; if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    const v = Number(s); return v <= 100 ? v : null;
  };
  // totaalC verdelen over gewichten (percentages): alle delen afgerond, het laatste deel krijgt de rest (som is altijd precies totaalC).
  F.verdeelOver = function (totaalC, gewichten) {
    const som = gewichten.reduce((a, g) => a + g, 0); if (!(som > 0) || !(totaalC >= 0)) return gewichten.map(() => 0);
    const uit = []; let gebruikt = 0;
    gewichten.forEach((g, i) => { const v = i === gewichten.length - 1 ? totaalC - gebruikt : Math.round(totaalC * g / som); uit.push(v); gebruikt += v; });
    return uit;
  };
  // Percentages van een offerte (som 100): afgerond per deel, het laatste deel de rest. Som ≠ 100: elk deel afgerond, niets verrekend.
  F.pctVerdeel = function (totaalC, pcts) {
    const som = Math.round(pcts.reduce((a, p) => a + p, 0) * 100);
    if (som !== 10000) return pcts.map(p => F.pctNaarCenten(totaalC, p));
    return F.verdeelOver(totaalC, pcts);
  };
  const SCHEMA_VOORSTEL = { klein: [{ pct: 100, label: 'factuur' }], middel: [{ pct: 50, label: 'aanbetaling' }, { pct: 50, label: 'oplevering' }],
    groot: [{ pct: 50, label: 'aanbetaling' }, { pct: 40, label: 'tussentijds' }, { pct: 10, label: 'oplevering' }] };
  F.SCHEMA_VOORSTEL = SCHEMA_VOORSTEL;
  // Welk schema hoort bij deze offerte? 1) het schema van de klant (contact-id), 2) het standaardschema uit de instellingen op grootte
  // (grens_klein/grens_groot), 3) het voorstel. Geeft {bron, rijen:[{label,pct}]}.
  F.kiesSchema = function (contactId, totaalC, factuurschemas, prognoseSchema) {
    const k = factuurschemas && contactId != null ? factuurschemas[String(contactId)] : null;
    if (Array.isArray(k) && k.length) return { bron: 'klant', rijen: k.map(r => ({ label: String(r.label || ''), pct: Number(r.pct) })) };
    const ps = prognoseSchema || {}, gk = ps.grens_klein, gg = ps.grens_groot, euro = totaalC / 100;
    const maat = gk != null && gg != null ? (euro < gk ? 'klein' : euro < gg ? 'middel' : 'groot') : 'middel';
    const uitCfg = Array.isArray(ps[maat]) && ps[maat].length ? ps[maat].map(r => ({ label: String(r.label || ''), pct: Number(r.pct) })) : null;
    return { bron: 'standaard', maat, rijen: uitCfg || SCHEMA_VOORSTEL[maat].map(r => Object.assign({}, r)) };
  };
  // Het schema op het NOG NIET GEPLANDE deel zetten: delen waarvan het label al gepland of gefactureerd is vervallen, de rest van de
  // percentages wordt herverdeeld over wat nog open staat. Maanden: het eerste deel in de lopende maand (akkoord), het laatste in de
  // opleverdatum als die bekend is (de andere gelijkmatig ertussen), anders de maanden erna; nooit in een maand waar al iets staat.
  F.schemaPlan = function (item, ov, schema, vandaag, o) {
    const info = F.termijnInfo(item, ov), nu = vandaag.slice(0, 7), opl = o && o.opleverYm && o.opleverYm >= nu ? o.opleverYm : null;
    const gepland = info.filter(t => t.vast || t.aan), bezet = new Set(gepland.map(t => t.maand)), labels = new Set(gepland.map(t => String(t.label).trim().toLowerCase()));
    const open = c(item.totaal) - gepland.reduce((a, t) => a + t.bedragC, 0);
    if (open <= 0) return { fout: 'Er is niets meer te plannen: de offerte is al helemaal gepland of gefactureerd.' };
    const rijen = (schema.rijen || []).filter(r => r.pct > 0 && !labels.has(String(r.label).trim().toLowerCase()));
    if (!rijen.length) return { fout: 'Alle onderdelen van dit schema staan al gepland of gefactureerd.' };
    if (rijen.length + gepland.length > MAX_TERMIJNEN) return { fout: `Dit schema past niet: een offerte kan in hoogstens ${MAX_TERMIJNEN} delen.` };
    const bedragen = F.verdeelOver(open, rijen.map(r => r.pct)), span = opl ? (Number(opl.slice(0, 4)) * 12 + Number(opl.slice(5, 7))) - (Number(nu.slice(0, 4)) * 12 + Number(nu.slice(5, 7))) : 0;
    const delen = []; let vorige = -1;
    rijen.forEach((r, k) => {
      let m = opl && span >= rijen.length - 1 && rijen.length > 1 ? (k === rijen.length - 1 ? span : Math.floor(k * span / (rijen.length - 1))) : k;
      m = Math.max(m, vorige + 1);
      while (bezet.has(maandPlus(nu, m))) m++;
      vorige = m; delen.push({ ym: maandPlus(nu, m), bedragC: bedragen[k], label: String(r.label).slice(0, 24), pct: r.pct });
    });
    if (delen.some(d => d.ym > maandPlus(nu, HORIZON))) return { fout: 'Dit schema past niet binnen de komende 24 maanden.' };
    return { delen: delen.filter(d => d.bedragC > 0), open };
  };
  F.schemaToepassen = function (item, ov, schema, vandaag, o) {
    const plan = F.schemaPlan(item, ov, schema, vandaag, o); if (plan.fout) return plan;
    let it = item;
    for (const d of plan.delen) { const r = F.zetCel(it, ov, d.ym, d.bedragC, vandaag, { label: d.label, behoudAan: !!(o && o.behoudAan) }); if (r.fout) return r; it = r.item; }
    return { item: it, delen: plan.delen };
  };
  // ── Statusfilter (geaccepteerd / openstaand / concept) ───────────────────────────
  F.STATUSSEN = ['geaccepteerd', 'openstaand', 'concept'];
  F.telStatus = (lijst, uitbeeld) => { const t = { geaccepteerd: 0, openstaand: 0, concept: 0, uitbeeld: 0 }; for (const s of lijst || []) { if (uitbeeld && uitbeeld[s.id]) t.uitbeeld++; else if (t[s.status] != null) t[s.status]++; } return t; };
  // Zichtbare rijen (rijen zonder status, zoals prognose-projecten zonder offerte, blijven altijd staan). Het filter verbergt ALLEEN rijen:
  // de totalen blijven gelijk aan Financiën (alle actieve prognose-items); alleen dubbele items (zelfde offerte) tellen niet mee.
  F.zichtbaar = function (rijen, toegestaan) {
    const mag = new Set(toegestaan), zicht = [], uitgesloten = [];
    let verborgen = 0;
    for (const r of rijen) { if (r.uitbeeld ? mag.has('uitbeeld') : (!r.status || mag.has(r.status))) zicht.push(r); else verborgen++; for (const d of r.dubbelen) uitgesloten.push(d.sleutel); }
    return { zichtbaar: zicht, verborgen, uitgesloten };
  };
  // Alle offertes met de drie statussen uit Moneybird (alleen lezen): haalPagina(filter, pagina) → lijst. Per status gepagineerd.
  F.haalOffertes = async function (haalPagina, o) {
    const lijst = [], gezien = new Set(); let afgekapt = false;
    for (const filter of ['accepted', 'open|late', 'draft']) {
      const r = await F.pagineer(p => haalPagina(filter, p), o); afgekapt = afgekapt || r.afgekapt;
      for (const e of r.lijst) if (e && !gezien.has(String(e.id))) { gezien.add(String(e.id)); lijst.push(e); }
    }
    return { lijst, afgekapt };
  };

  // ── Uit beeld zetten (opschonen van de lijst; alleen verbergen, Moneybird blijft alleen-lezen) ──────────
  // Opslag: de geld-config (config.uitbeeld = { offerte-id: {reden, door, ts} }, door en ts zet de server), met dezelfde revisiecontrole als
  // de andere instellingen. Uit beeld zetten zet ook "Gaat zeker door" uit (aan:false) van het prognose-item, als dat er is; termijnen,
  // bedragen en wat al gefactureerd is blijven ongemoeid. Terugzetten haalt alleen de markering weg en zet het vinkje NIET aan.
  F.UITBEELD_REDENEN = { verkeerd: 'Verkeerd of vervallen', gefactureerd: 'Al gefactureerd', weg: 'Weg (hoort er niet in)' };
  F.FILTERS = ['geaccepteerd', 'openstaand', 'concept', 'uitbeeld'];
  F.uitBeeldItem = huidig => huidig && huidig.soort !== 'post' && huidig.aan !== false ? F.zetAan(huidig, false).item : null;
  // Alle actieve prognose-items die bij deze offerte horen (het hoofd-item en eventuele dubbelen met dezelfde estimate_id).
  F.itemSleutels = function (rij, items) {
    const uit = [], eid = rij && rij.estimateId ? String(rij.estimateId) : '';
    for (const k of Object.keys(items || {})) { const it = items[k]; if (!it || it.soort === 'post' || it.aan === false) continue; if (k === rij.sleutel || (eid && String(it.estimate_id || '') === eid)) uit.push(k); }
    return uit;
  };
  F.bulkUitBeeld = function (rijen, items, reden) {
    if (!F.UITBEELD_REDENEN[reden]) return { fout: 'Kies een reden.' };
    const upd = {}, ids = [], overgeslagen = [], perRij = {};
    for (const r of rijen) {
      if (!r || !/^\d{6,25}$/.test(String(r.estimateId || ''))) { if (r) overgeslagen.push(r.sleutel); continue; }
      if (!ids.includes(String(r.estimateId))) ids.push(String(r.estimateId));
      perRij[r.sleutel] = F.itemSleutels(r, items);
      for (const k of perRij[r.sleutel]) (upd[k] = upd[k] || { sleutel: k, item: F.uitBeeldItem(items[k]), rijen: [] }).rijen.push(r.sleutel);
    }
    return { updates: Object.values(upd), ids, perRij, overgeslagen };
  };
  F.terugzetMap = function (map, ids) { const n = Object.assign({}, map); for (const id of ids) delete n[String(id)]; return n; };

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
  const st = F._st = { el: null, bron: null, mag: false, wie: '', data: null, items: {}, schatten: null, schattenT: 0, projecten: null, haalSchatten: null, rijen: [], sel: null, menu: false, ub: {}, ubInfo: null, ubOverlay: {}, ubBeschikbaar: true, fs: {}, fsBeschikbaar: true, uitbeeldMelding: null, focusTerug: null, rijmenuSel: null, keuze: null, rijmenu: null, weergave: 'vast', aandachtOpen: null, bulkReden: 'verkeerd', filter: null, cfg: null, pop: null, popBezig: false, kostenAan: true, overigAan: true, openAan: true, verouderd: false, afgekapt: false, bezig: false, fout: null, uitleg: false, wachtrij: Promise.resolve(), vers: {}, ks: [], cv: '', bt: null };
  const UITLEG = 'Links staan de goedgekeurde offertes uit Moneybird (incl. btw). Typ in een maand het bedrag dat je dan wilt factureren, in zijn geheel of in delen; "rest" zet wat nog niet gepland is in die maand. De planning is dezelfde als de prognose in Financiën (de termijnen van de offerte): de kaslijn, de Factuurplanning en deze tabel rekenen meteen mee. Het vinkje ‘Gaat zeker door’ is hetzelfde vinkje als in Financiën: alleen die offertes tellen mee. Met ‘…’ achter een offerte (of Selecteren voor meerdere tegelijk) zet je een offerte uit beeld, met een reden; het vinkje Gaat zeker door gaat dan uit en de planning blijft bewaard. Bij het filter Uit beeld zet je ze terug. Met Uitklappen kies je de lange paginaweergave. Staan er meer maanden in beeld dan er passen, dan scrolt de tabel zijwaarts (Shift+muiswiel, slepen of de pijlknoppen); Passend maken maakt de maandkolommen smaller zodat alles in beeld past. Met de chips boven de tabel kies je welke offertes je ziet (geaccepteerd, openstaand, concept); het filter verbergt alleen rijen, de totalen blijven gelijk aan Financiën. Een niet-geaccepteerde offerte staat standaard op ‘Gaat zeker door’ uit. Klik in een maandcel voor een paneel met bedrag of percentage en een label; ‘Schema toepassen’ vult de standaardverdeling van de klant in op het nog niet geplande deel. "Binnen" is de verwachte betaling: factuurdatum plus betaaltermijn en het gewone betaalgedrag van de klant. "Openstaande facturen" zijn de al verstuurde, nog niet betaalde verkoopfacturen per verwachte betaalmaand. Vink die, "lopende kosten" en "overige voorspelling" (btw, weekinleg, handmatige posten) aan of uit om het netto per maand te zien. Een deel dat al in Moneybird gefactureerd is, staat vast. Een offerte kan in hoogstens 6 delen. Er gaat nooit iets naar Moneybird.';
  function css() {
    if (document.getElementById('mtf-css')) return;
    const s = document.createElement('style'); s.id = 'mtf-css';
    s.textContent = `
.mtf,.mtf-pop,.mtf-modal,.mtf-toast{--m-surface:var(--surface,#fff);--m-surface2:var(--surface-2,#f1ede5);--m-line:var(--line,#dfd8cb);--m-soft:var(--line-soft,#ece7de);--m-strong:var(--line-strong,#9a917f);--m-ink:var(--ink,#1b211e);--m-ink2:var(--ink-2,#5e655f);--m-ink3:var(--ink-3,#8c918a);--m-primary:var(--primary,#17643f);--m-onprimary:var(--on-primary,#fff);--m-psoft:var(--primary-soft,#ddefe3);--m-ptext:var(--primary-text,#17643f);--m-ok:var(--ok,#1a6e3b);--m-okbg:var(--ok-bg,#e3f3e8);--m-warn:var(--warn,#8f5508);--m-warnbg:var(--warn-bg,#fcefd9);--m-err:var(--err,#c4322a);--m-errbg:var(--err-bg,#fce6e4);--m-mono:var(--font-mono,"Geist Mono",ui-monospace,Menlo,monospace);--m-ui:var(--font-ui,"Geist",system-ui,-apple-system,"Segoe UI",sans-serif);--m-head:var(--font-head,"Bricolage Grotesque","Geist",system-ui,sans-serif);--m-r:var(--radius-ctl,4px);--m-rp:var(--radius-panel,8px);--m-pop:var(--shadow-pop,0 24px 60px rgba(40,34,20,.2))}
.mtf{font-family:var(--m-ui);font-size:14px;line-height:20px;color:var(--m-ink);max-width:none;margin:0;display:flex;flex-direction:column;gap:var(--space-4,16px)}
.mtf .ui-ico,.mtf-pop .ui-ico{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.mtf button,.mtf-pop button,.mtf-modal button{font-family:inherit}
.mtf-kop{display:flex;align-items:flex-end;gap:var(--space-4,16px);flex-wrap:wrap}.mtf-titelblok{flex:1;min-width:200px}
.mtf-titel{font-family:var(--m-head);font-size:28px;line-height:32px;font-weight:600;letter-spacing:-.015em;margin:0}
.mtf-sub{margin:2px 0 0;font-size:13px;color:var(--m-ink2)}
.mtf-acties{display:flex;align-items:center;gap:var(--space-2,8px)}
.mtf-seg-knoppen{display:inline-flex}.mtf-seg-knoppen .ui-knop{border-radius:0;margin-left:-1px}.mtf-seg-knoppen .ui-knop:first-child{border-radius:var(--m-r) 0 0 var(--m-r);margin-left:0}.mtf-seg-knoppen .ui-knop:last-child{border-radius:0 var(--m-r) var(--m-r) 0}
.mtf-stil{width:36px;padding:0}.mtf-menuwrap{position:relative}
.mtf-menu{display:none;position:absolute;right:0;top:calc(100% + 4px);z-index:50;min-width:190px;background:var(--m-surface);border:1px solid var(--m-line);border-radius:var(--m-rp);box-shadow:var(--m-pop);padding:4px}
.mtf-menu.open{display:block}.mtf-menu button{display:block;width:100%;text-align:left;border:0;background:none;padding:8px 12px;border-radius:var(--m-r);font-size:13px;color:var(--m-ink);cursor:pointer}.mtf-menu button:hover{background:var(--m-surface2)}.mtf-menu button:disabled{opacity:.45;cursor:default}
.mtf-uitleg{font-size:13px;line-height:20px;background:var(--m-surface);border:1px solid var(--m-line);border-radius:var(--m-rp);padding:var(--space-4,16px) var(--space-6,24px);color:var(--m-ink2)}
.mtf-kaart{background:var(--m-surface);border:1px solid var(--m-line);border-radius:var(--m-rp)}
.mtf-kaart-kop{display:flex;align-items:center;gap:var(--space-3,12px);padding:var(--space-3,12px) var(--space-6,24px);border-bottom:1px solid var(--m-line)}
.mtf-kaart-kop h2{margin:0 auto 0 0;font-size:15px;line-height:22px;font-weight:600}.mtf-getal{font-family:var(--m-mono);font-size:12px;color:var(--m-ink3)}
.mtf-strook{padding:var(--space-3,12px) var(--space-6,24px) var(--space-4,16px)}
.mtf-filter{display:flex;align-items:center;gap:var(--space-2,8px);flex-wrap:wrap;margin-bottom:var(--space-3,12px)}.mtf-zacht{color:var(--m-ink3);font-size:12px}
.mtf-kopje{font-size:11px;font-weight:500;color:var(--m-ink3);margin-right:4px}.mtf-fchip .ui-ico{opacity:.5}.mtf-fchip[aria-pressed=true] .ui-ico{opacity:1}.mtf-dot{opacity:.5}
.mtf-fchip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:var(--m-r);border:1px solid var(--m-line);background:var(--m-surface);color:var(--m-ink3);font-size:12px;font-weight:500;cursor:pointer}
.mtf-fchip:hover{background:var(--m-surface2)}.mtf-fchip[aria-pressed=true]{background:var(--m-psoft);border-color:var(--m-psoft);color:var(--m-ptext)}
.mtf-tel{font-family:var(--m-mono);font-size:11px;opacity:.75}.mtf-verborgen{font-size:12px;color:var(--m-ink3);margin-left:auto}
.mtf-balk{padding:0}.mtf-jaren{position:relative;height:14px;font-size:11px;color:var(--m-ink3)}.mtf-jaren span{position:absolute;top:0;white-space:nowrap}
.mtf-spoor{position:relative;height:28px;border-top:1px solid var(--m-line);border-bottom:1px solid var(--m-line);touch-action:none;user-select:none;-webkit-user-select:none;cursor:pointer}
.mtf-seg{position:absolute;top:0;bottom:0;border:0;border-left:1px solid var(--m-soft);background:none;padding:0;font-size:11px;color:var(--m-ink3);overflow:hidden;white-space:nowrap;cursor:pointer}
.mtf-seg:first-child{border-left:0}.mtf-seg.in{color:var(--m-ptext)}.mtf-seg .l{display:none}
.mtf-sel{position:absolute;top:0;bottom:0;background:var(--m-psoft);background:color-mix(in srgb,var(--m-psoft) 70%,transparent);border-top:2px solid var(--m-primary);border-bottom:2px solid var(--m-primary);cursor:grab;z-index:1}.mtf-sel:active{cursor:grabbing}
.mtf-greep{position:absolute;top:50%;width:6px;height:14px;margin-top:-7px;background:var(--m-primary);border-radius:2px;cursor:ew-resize;z-index:2;opacity:.4}.mtf-spoor:hover .mtf-greep,.mtf-greep:focus-visible{opacity:1;height:22px;margin-top:-11px}
.mtf-periode{font-size:12px;color:var(--m-ink2);margin-bottom:4px}
.mtf-scrollwrap{position:relative}.mtf-scrollwrap::after{content:"";display:none;position:absolute;top:0;bottom:0;right:0;width:36px;pointer-events:none;background:linear-gradient(to right,transparent,var(--m-surface));z-index:6}
.mtf-scrollwrap::before{content:"";display:none;position:absolute;top:0;bottom:0;left:var(--sbreed,0px);width:28px;pointer-events:none;background:linear-gradient(to left,transparent,var(--m-surface));z-index:6}
.mtf-scrollwrap:not(.eind)::after,.mtf-scrollwrap:not(.begin)::before{display:block}
.mtf-scroll{scrollbar-width:thin;scrollbar-color:var(--m-strong) var(--m-surface2)}.mtf-scroll.sleept{cursor:grabbing;user-select:none;-webkit-user-select:none}
.mtf-pijlen{display:inline-flex;gap:2px;margin-left:auto;float:right}.mtf-pijl{width:24px;height:24px;border:1px solid var(--m-line);background:var(--m-surface);color:var(--m-ink2);border-radius:var(--m-r);cursor:pointer;font-size:15px;line-height:1;padding:0}.mtf-pijl:hover{background:var(--m-surface2);color:var(--m-ink)}
.mtf-tabel .kort{display:none}.mtf-tabel.compact .kort{display:inline}.mtf-tabel.compact .vol{display:none}
.mtf-tabel.passend th.mnd,.mtf-tabel.passend td.mnd{width:var(--kolbreed);min-width:var(--kolbreed);max-width:var(--kolbreed);padding-left:4px;padding-right:4px;box-sizing:border-box}
.mtf-tabel.passend .mtf-in{width:calc(var(--kolbreed) - 10px);padding:0 4px}.mtf-tabel.passend .mtf-cel{min-width:0}.mtf-tabel.passend.compact{font-size:12px}.mtf-tabel.passend .s{min-width:270px;max-width:270px}.mtf-tabel.passend .mtf-naam b{max-width:180px}
.mtf-zk{display:block;font-size:11px;font-weight:400;color:var(--m-ink3)}
@media (hover:none){.mtf-greep{opacity:1}}
.mtf-greep::before{content:"";position:absolute;top:-10px;bottom:-10px;left:-10px;right:-10px}.mtf-greep.van{left:-4px}.mtf-greep.tot{right:-4px}
.mtf-greep:focus-visible{outline:2px solid var(--focus,var(--m-primary));outline-offset:2px}
.mtf-aandacht{padding:0}.mtf-aandacht-rij:first-of-type{border-top:0}.mtf-aandacht-rij{display:flex;align-items:center;gap:var(--space-3,12px);padding:var(--space-3,12px) var(--space-6,24px);border-bottom:1px solid var(--m-soft);font-size:13px}.mtf-aandacht-rij:last-child{border-bottom:0}
.mtf-aandacht-rij .ui-ico{color:var(--m-warn)}.mtf-aandacht-rij p{margin:0;flex:1;color:var(--m-ink)}
.mtf-kern{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-4,16px);padding:var(--space-4,16px) var(--space-6,24px)}
.mtf-fact{display:flex;flex-direction:column;gap:2px;min-width:0}.mtf-fact .label{font-size:12px;line-height:16px;font-weight:500;color:var(--m-ink2)}.mtf-fact.netto{background:var(--m-surface2);border-radius:var(--m-r);padding:8px 12px}.mtf-fact .v{font-family:var(--m-mono);font-size:18px;line-height:24px;font-weight:500;font-variant-numeric:tabular-nums}
.mtf-sm{height:28px;padding:0 10px;font-size:12px;white-space:nowrap}
.mtf-melding{padding:var(--space-6,24px);color:var(--m-ink2)}.mtf-fout{padding:var(--space-3,12px) var(--space-4,16px);border:1px solid var(--m-err);background:var(--m-errbg);color:var(--m-err);border-radius:var(--m-rp);font-size:13px}
.mtf-scroll{overflow-x:auto;border-radius:0 0 var(--m-rp) var(--m-rp)}
.mtf-tabel{border-collapse:separate;border-spacing:0;min-width:100%;font-size:13px}
.mtf-tabel th,.mtf-tabel td{padding:4px 10px;border-bottom:1px solid var(--m-soft);vertical-align:middle;white-space:nowrap;text-align:right}
.mtf-tabel thead th{font-size:12px;font-weight:500;color:var(--m-ink2);background:var(--m-surface);border-bottom:1px solid var(--m-line);height:36px}
.mtf-tabel .s{text-align:left;position:sticky;left:0;z-index:1;background:var(--m-surface);min-width:370px;max-width:390px;white-space:normal}
.mtf-tabel thead .s{z-index:2}
.mtf-tabel td.nu,.mtf-tabel th.nu{background:var(--m-surface2)}.mtf-tabel th.nu{color:var(--m-ptext)}
.mtf-tabel td.num,.mtf-tabel th.num{font-family:var(--m-mono);font-variant-numeric:tabular-nums}
.mtf-tabel tbody tr{height:44px}
.mtf-naam{display:flex;gap:10px;align-items:flex-start;cursor:default}.mtf-naam input{margin-top:3px;width:16px;height:16px;flex:none}
.mtf-naam>span{min-width:0;display:flex;flex-direction:column;gap:2px}.mtf-naam b{font-weight:500;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px;display:block}
.mtf-meta{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;font-size:11px;line-height:16px;color:var(--m-ink3)}
.mtf-st{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 6px 0 4px;border-radius:var(--m-r);font-size:11px;font-weight:500;white-space:nowrap}
.mtf-st-ok{color:var(--m-ok);background:var(--m-okbg)}.mtf-st-warn{color:var(--m-warn);background:var(--m-warnbg)}.mtf-st-neutraal{color:var(--m-ink2);background:var(--m-surface2)}
.mtf-vlag{display:inline-flex;align-items:center;gap:4px;color:var(--m-err);font-weight:500;font-size:11px;white-space:nowrap}.mtf-vlag.let{color:var(--m-warn)}
.mtf-schema{border:0;background:none;padding:0;margin:0;font-size:11px;color:var(--m-ink3);text-decoration:none;cursor:pointer}.mtf-schema:hover,.mtf-schema:focus-visible{color:var(--m-ptext);text-decoration:underline}.mtf-schema:disabled{opacity:.4;cursor:default}
.mtf-rij.uit td:not(.s){opacity:.5}.mtf-rij.uit .s .mtf-naam b{color:var(--m-ink2)}
.mtf-cel{position:relative;display:flex;flex-direction:column;align-items:flex-end;gap:2px;min-width:84px}
.mtf-in{width:88px;height:28px;text-align:right;border:1px solid transparent;border-radius:var(--m-r);padding:0 8px;background:transparent;color:var(--m-ink);font:inherit;font-family:var(--m-mono);font-variant-numeric:tabular-nums}
.mtf-in::placeholder{color:var(--m-ink3);opacity:1}.mtf-in:not(:disabled){cursor:pointer}.mtf-cel:hover .mtf-in:not(:disabled){background:var(--m-surface2)}
.mtf-in:hover:not(:disabled),.mtf-in:focus{border-color:var(--m-strong);background:var(--m-surface);cursor:text}.mtf .mtf-in:disabled{opacity:.3;cursor:not-allowed}
.mtf-hint{padding:6px var(--space-6,24px);font-size:12px;color:var(--m-ink3);border-bottom:1px solid var(--m-soft)}
.mtf-in:focus{outline:2px solid var(--focus,var(--m-primary));outline-offset:1px}
.mtf-gef{font-size:11px;color:var(--m-ink3)}.mtf-vast{font-size:12px}
.mtf-rest{border:0;background:var(--m-surface);color:var(--m-ptext);font-size:11px;cursor:pointer;padding:0 4px;text-decoration:underline;position:absolute;right:0;bottom:-9px;z-index:2;visibility:hidden;line-height:14px}
.mtf-cel:hover .mtf-rest,.mtf-cel:focus-within .mtf-rest{visibility:visible}.mtf-rest:disabled{opacity:.4;cursor:default}
.mtf-agg{border:0;background:none;font:inherit;color:inherit;cursor:pointer;padding:2px 4px;border-radius:var(--m-r);display:flex;flex-direction:column;align-items:flex-end;margin-left:auto}
.mtf-agg:hover{background:var(--m-surface2)}.mtf-kopknop{font-weight:500;color:var(--m-ink2);display:inline;font-size:12px}
.mtf-tabel tfoot td,.mtf-tabel tfoot th{background:var(--m-surface);font-weight:400;border-bottom:1px solid var(--m-soft);height:34px;color:var(--m-ink2)}
.mtf-tabel tfoot .s{background:var(--m-surface)}.mtf-tabel tfoot tr:first-child td,.mtf-tabel tfoot tr:first-child th{border-top:1px solid var(--m-line)}
.mtf-tabel tfoot tr.netto td,.mtf-tabel tfoot tr.netto th{font-weight:600;color:var(--m-ink);border-top:1px solid var(--m-strong);border-bottom:0;height:40px}
.mtf-tabel tfoot label{display:flex;gap:8px;align-items:center;cursor:pointer}.mtf-tabel tfoot input{width:14px;height:14px}
.mtf-p{color:var(--m-ok)}.mtf-n{color:var(--m-err)}.mtf-0{color:var(--m-ink3)}
.mtf input[type=checkbox],.mtf-modal input[type=checkbox]{accent-color:var(--m-primary)}
.mtf input:disabled,.mtf button:disabled{opacity:.5;cursor:not-allowed}
.mtf-bezig{opacity:.6;pointer-events:none}
.mtf-voet{font-size:12px;color:var(--m-ink3);padding:0 2px}
.mtf-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--m-surface);color:var(--m-ink);border:1px solid var(--m-line);box-shadow:var(--m-pop);padding:10px 16px;border-radius:var(--m-rp);font-size:13px;z-index:9999;max-width:90vw}
.mtf-pop{position:fixed;z-index:9000;width:300px;max-width:calc(100vw - 16px);background:var(--m-surface);border:1px solid var(--m-line);border-radius:var(--m-rp);box-shadow:var(--m-pop);padding:var(--space-4,16px);font-family:var(--m-ui);font-size:13px;color:var(--m-ink)}
.mtf-pop.blad{left:0;right:0;bottom:0;top:auto;width:auto;max-width:none;border-radius:var(--m-rp) var(--m-rp) 0 0;padding:var(--space-4,16px) var(--space-4,16px) var(--space-6,24px)}
.mtf-pop-kop{display:flex;flex-direction:column;gap:2px;margin-bottom:var(--space-3,12px);padding-right:28px;position:relative}.mtf-pop-kop small,.mtf-pop-hint{color:var(--m-ink3);font-size:12px}.mtf-pop-hint{margin:4px 0 8px;min-height:16px}
.mtf-pop-x{position:absolute;top:-4px;right:-4px;width:28px;height:28px;border:0;background:none;font-size:20px;line-height:1;color:var(--m-ink2);cursor:pointer;border-radius:var(--m-r)}.mtf-pop-x:hover{background:var(--m-surface2)}
.mtf-pop-rij{display:flex;align-items:center;gap:var(--space-2,8px)}.mtf-pop-veld{display:flex;flex-direction:column;gap:3px;margin-top:6px}.mtf-pop-veld span{font-size:12px;color:var(--m-ink2)}
.mtf-pop-bedrag,.mtf-pop-label{height:36px;border:1px solid var(--m-strong);border-radius:var(--m-r);padding:0 8px;font:inherit;background:var(--m-surface);color:inherit;min-width:0;width:100%;box-sizing:border-box}.mtf-pop-bedrag{text-align:right;font-family:var(--m-mono)}
.mtf-pop-acties{display:flex;gap:6px;flex-wrap:wrap;margin-top:var(--space-3,12px)}
.mtf-modal{position:fixed;inset:0;background:rgba(27,33,30,.35);z-index:9500;display:flex;align-items:center;justify-content:center;padding:12px}
.mtf-modal-in{background:var(--m-surface);border-radius:var(--m-rp);box-shadow:var(--m-pop);padding:var(--space-6,24px);width:460px;max-width:100%;max-height:90vh;overflow:auto;font-family:var(--m-ui);font-size:13px;color:var(--m-ink)}.mtf-modal-in h3{margin:0 0 6px;font-size:16px;font-weight:600}
.mtf-modal-in .mtf-pop-rij{margin:6px 0}.mtf-sel-contact{text-align:left;margin:6px 0 8px}
.mtf-naam>span{flex:1}
.mtf-fout button{margin-left:6px}
.mtf-rijmenu{flex:none;border:0;background:none;width:24px;height:24px;display:inline-grid;place-items:center;color:var(--m-ink3);cursor:pointer;border-radius:var(--m-r);opacity:0}
.mtf-rij:hover .mtf-rijmenu,.mtf-rijmenu:focus-visible,.mtf-rijmenu[aria-expanded=true]{opacity:1}.mtf-rijmenu:hover{background:var(--m-surface2)}
.mtf-rijmenu-lijst{position:fixed;z-index:9100;min-width:220px;background:var(--m-surface);border:1px solid var(--m-line);border-radius:var(--m-rp);box-shadow:var(--m-pop);padding:4px;font-family:var(--m-ui);font-size:13px;color:var(--m-ink)}
.mtf-rijmenu-lijst button{display:block;width:100%;text-align:left;border:0;background:none;padding:8px 12px;border-radius:var(--m-r);font:inherit;color:inherit;cursor:pointer}.mtf-rijmenu-lijst button:hover,.mtf-rijmenu-lijst button:focus-visible{background:var(--m-surface2)}
.mtf-rm-kop{padding:6px 12px 2px;font-size:11px;color:var(--m-ink3)}
.mtf-bulk{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--m-ink2)}.mtf-bulkreden{height:28px;border:1px solid var(--m-strong);border-radius:var(--m-r);background:var(--m-surface);color:var(--m-ink);font:inherit;font-size:12px;padding:0 6px}
.mtf-aandacht-kop{display:flex;align-items:center;gap:12px;width:100%;border:0;background:none;padding:10px var(--space-6,24px);font-size:14px;font-weight:600;text-align:left;cursor:pointer;color:var(--m-ink)}.mtf-aandacht-kop .ui-ico{color:var(--m-warn)}
.mtf-samen{flex:1;min-width:0;font-weight:400;font-size:13px;color:var(--m-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mtf-aandacht:not(.dicht) .mtf-aandacht-kop{border-bottom:1px solid var(--m-line)}.mtf-aandacht.dicht .mtf-aandacht-rij{display:none}
.mtf-tabelkaart{overflow:hidden}.mtf-tabelkaart .mtf-kaart-kop{min-height:48px}.mtf-tabelkaart .mtf-scrollwrap{min-height:0}
.mtf.vast{overflow:hidden;gap:var(--space-3,12px)}.mtf.vast>*{flex:none}.mtf.vast>.mtf-tabelkaart{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.mtf.vast .mtf-tabelkaart .mtf-scrollwrap{flex:1 1 auto}.mtf.vast .mtf-scrollwrap .mtf-scroll{position:absolute;top:0;right:0;bottom:0;left:0;overflow:auto;border-radius:0}
.mtf.vast .mtf-tabel thead th{position:sticky;top:0;z-index:3}.mtf.vast .mtf-tabel thead th.s{z-index:5}
.mtf.vast .mtf-tabel tfoot th,.mtf.vast .mtf-tabel tfoot td{position:sticky;z-index:3;height:28px;padding-top:2px;padding-bottom:2px;box-sizing:border-box}.mtf.vast .mtf-tabel tfoot tr.netto th,.mtf.vast .mtf-tabel tfoot tr.netto td{height:34px}.mtf.vast .mtf-tabelkaart .mtf-kaart-kop{min-height:40px;padding-top:6px;padding-bottom:6px}.mtf.vast .mtf-hint{padding-top:3px;padding-bottom:3px}.mtf.vast .mtf-tabel tbody tr{height:40px}.mtf.vast .mtf-tabel tfoot th.s{z-index:5}
.mtf.vast .mtf-kernkaart .mtf-kaart-kop{display:none}.mtf.vast .mtf-kern{padding:10px var(--space-6,24px)}.mtf.vast .mtf-fact .v{font-size:16px;line-height:22px}.mtf.vast .mtf-fact.netto{padding:4px 12px}
.mtf.vast .mtf-strook{padding:8px var(--space-6,24px) 10px}.mtf.vast .mtf-filter{margin-bottom:6px}.mtf.vast .mtf-aandacht-kop{padding:6px var(--space-6,24px)}
@media (max-width:700px){
.mtf-titel{font-size:24px;line-height:29px}.mtf-kop{align-items:flex-start}
.mtf-strook,.mtf-kaart-kop,.mtf-aandacht-rij{padding-left:var(--space-4,16px);padding-right:var(--space-4,16px)}
.mtf-kern{grid-template-columns:repeat(2,1fr);padding:var(--space-4,16px)}
.mtf-tabel .s{min-width:170px;max-width:180px;box-shadow:1px 0 0 var(--m-soft)}.mtf-naam b{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;max-width:130px}
.kol-gef,.kol-nog{display:none}.mtf-fact.netto{grid-column:1/-1}.mtf-pijlen{display:none}
.mtf-seg .k{display:none}.mtf-seg .l{display:inline}.mtf-spoor.kwartaal .mtf-seg .k,.mtf-spoor.jaar .mtf-seg .k{display:inline}.mtf-spoor.kwartaal .mtf-seg .l,.mtf-spoor.jaar .mtf-seg .l{display:none}.mtf-spoor.kwartaal .mtf-seg{font-size:10px}
.mtf-verborgen{margin-left:0;width:100%}
.mtf-aandacht-rij{flex-wrap:wrap}
}
`;
    document.head.appendChild(s);
  }
  function toast(t) { document.querySelectorAll('.mtf-toast').forEach(x => x.remove()); const o = h('div', { class: 'mtf-toast', role: 'status' }, t); document.body.appendChild(o); setTimeout(() => o.remove(), 4500); }

  function maakKnop(tekst, attr) { return h('button', Object.assign({ type: 'button', class: 'ui-knop' }, attr), tekst); }
  const bedragTd = (cc, klasse) => h('td', { class: 'num ' + (klasse || ''), title: cc ? F.fmt(cc, { altijdCenten: true }) : null }, cc ? [h('span', { class: 'vol' }, F.fmt(cc)), h('span', { class: 'kort' }, F.fmtKort(cc))] : h('span', { class: 'mtf-0' }, '–'));
  const getalTd = (cc, klasse) => h('td', { class: 'num ' + (klasse || ''), title: cc === 0 ? null : F.fmt(cc, { altijdCenten: true }) }, cc === 0 ? h('span', { class: 'mtf-0' }, '–') : h('span', { class: cc < 0 ? 'mtf-n' : 'mtf-p' }, h('span', { class: 'vol' }, F.fmt(cc)), h('span', { class: 'kort' }, F.fmtKort(cc))));

  const ico = naam => { try { return root.mtIcoon ? root.mtIcoon(naam) : null; } catch (e) { return null; } };
  // Status altijd als icoon + woord + kleur (statustaal van de rust-pas): Geaccepteerd = klaar, Openstaand = wacht, Concept = open.
  const STATUSLABEL = { geaccepteerd: ['stKlaar', 'Geaccepteerd', 'ok'], openstaand: ['stWacht', 'Openstaand', 'warn'], concept: ['stOpen', 'Concept', 'neutraal'], uitbeeld: ['stOpen', 'Uit beeld', 'neutraal'] };
  const statusPil = sts => { const d = STATUSLABEL[sts]; return d ? h('span', { class: 'mtf-st mtf-st-' + d[2] }, ico(d[0]), d[1]) : null; };
  const vlag = (tekst, titel, klasse) => h('span', { class: 'mtf-vlag' + (klasse ? ' ' + klasse : ''), title: titel }, ico('stProbleem'), tekst);
  const uitbeeldPil = r => h('span', { class: 'mtf-st mtf-st-neutraal', title: 'Uit beeld gezet' + (r.uitbeeld.door ? ' door ' + r.uitbeeld.door : '') + (r.uitbeeld.ts ? ' op ' + new Date(r.uitbeeld.ts).toLocaleDateString('nl-NL') : '') }, ico('stOpen'), 'Uit beeld · ' + (F.UITBEELD_REDENEN[r.uitbeeld.reden] || '').replace(/ \(.*\)$/, ''));
  // Wat aandacht vraagt (details en actieknop staan in de kaart "Aandacht"; in de rij staat alleen een klein icoon met een kort woord).
  function aandachtItems() {
    const lijst = [];
    for (const r of st.rijen) {
      if (r.uitbeeld) continue;
      if (r.afwijkt) lijst.push({ tekst: `${r.naam}: in Moneybird staat ${F.fmt(r.mbTotaalC)}, de prognose rekent met ${F.fmt(r.totaalC)}. Plannen is geblokkeerd tot het bedrag is bijgewerkt.`, knop: 'Bijwerken', data: { bijwerk: r.sleutel } });
      for (const d of r.dubbelen) lijst.push({ tekst: `${r.naam}: nog een prognose-item (${d.naam}, ${F.fmt(d.totaalC)}) hoort bij deze offerte. Het telt hier niet mee, maar wel in Financiën.`, knop: 'Zet dat item uit', data: { dubbeluit: d.sleutel } });
      if (r.status && r.status !== 'geaccepteerd' && r.aan) lijst.push({ tekst: `${r.naam}: nog niet geaccepteerd (${r.status}), maar gaat zeker door en staat in de prognose van Financiën.` });
    }
    return lijst;
  }
  function aandachtKaart() {
    const lijst = aandachtItems(); if (!lijst.length) return null;
    const open = st.aandachtOpen == null ? st.weergave !== 'vast' : st.aandachtOpen;       // in de vaste weergave klapt Aandacht in tot een regel
    return h('section', { class: 'mtf-kaart mtf-aandacht' + (open ? '' : ' dicht'), 'aria-label': 'Aandacht' },
      h('button', { type: 'button', class: 'mtf-aandacht-kop', 'aria-expanded': String(open), data: { aandacht: '1' } }, ico('stProbleem'), h('span', { class: 't' }, 'Aandacht'), h('span', { class: 'mtf-getal' }, String(lijst.length)), h('span', { class: 'mtf-samen' }, open ? '' : lijst[0].tekst)),
      lijst.map(i => h('div', { class: 'mtf-aandacht-rij' }, ico('stProbleem'), h('p', null, i.tekst), i.knop && st.mag ? h('button', { type: 'button', class: 'ui-knop mtf-sm', disabled: st.verouderd, data: i.data }, i.knop) : null)));
  }

  // ── Popover aan de cel: bedrag of percentage, label, opslaan / rest hier / verwijderen ──────────
  const LABEL_TIPS = ['aanbetaling', 'tussentijds', 'oplevering', 'factuur'];
  const behoudAanVoor = r => !!(r.status && r.status !== 'geaccepteerd');
  function closePop(focus) { const p = st.pop; if (p && p.el) p.el.remove(); st.pop = null; st.popBezig = false; if (p && focus === true && p.sel) { st.focusTerug = p.sel; focusSel(p.sel); } }
  function openPop(inp) {
    closePop();
    const sl = inp.dataset.sl, ym = inp.dataset.ym, r = st.rijen.find(x => x.sleutel === sl), m = r && r.maanden.find(x => x.ym === ym); if (!r || !m) return;
    if (r.uitbeeld) { toast('Deze offerte staat uit beeld: zet hem eerst terug.'); return; }
    if (r.afwijkt) { toast('Het bedrag wijkt af van Moneybird: werk eerst het bedrag bij.'); return; }
    const totaal = r.totaalC; let modus = 'eur';
    const bedrag = h('input', { class: 'mtf-pop-bedrag', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Bedrag of percentage', value: m.vrijC ? F.fmt(m.vrijC) : '' });
    const label = h('input', { class: 'mtf-pop-label', type: 'text', maxlength: '24', list: 'mtf-labels', autocomplete: 'off', 'aria-label': 'Label van dit factuurdeel', placeholder: 'bijvoorbeeld aanbetaling', value: m.label && m.label !== REST_LABEL ? m.label : '' });
    const hint = h('div', { class: 'mtf-pop-hint', 'aria-live': 'polite' });
    const lees = () => { if (modus === 'eur') return F.parseBedrag(bedrag.value); const p = F.parsePct(bedrag.value); return p == null ? null : F.pctNaarCenten(totaal, p); };
    const anders = r.geplandC - m.vrijC + r.gefC, pctGepland = cc => String(F.centenNaarPct(totaal, anders + cc)).replace('.', ',');
    const toon = () => { const cc = lees(); hint.textContent = cc == null ? 'Dit is geen geldig bedrag.' : modus === 'eur' ? `${pctGepland(cc)}% van € ${F.fmt(totaal)} gepland` : `€ ${F.fmt(cc)}; samen ${pctGepland(cc)}% van € ${F.fmt(totaal)} gepland`; };
    const knopEur = h('button', { type: 'button', class: 'ui-knop ui-knop--primair', 'aria-pressed': 'true', data: { modus: 'eur' } }, '€'), knopPct = h('button', { type: 'button', class: 'ui-knop', 'aria-pressed': 'false', data: { modus: 'pct' } }, '%');
    const zetModus = nieuw => {
      if (nieuw === modus) return; const cc = lees(); modus = nieuw;
      knopEur.className = 'ui-knop' + (modus === 'eur' ? ' ui-knop--primair' : ''); knopPct.className = 'ui-knop' + (modus === 'pct' ? ' ui-knop--primair' : '');
      knopEur.setAttribute('aria-pressed', String(modus === 'eur')); knopPct.setAttribute('aria-pressed', String(modus === 'pct'));
      bedrag.value = cc == null || cc === 0 ? '' : modus === 'eur' ? F.fmt(cc) : String(F.centenNaarPct(totaal, cc)).replace('.', ','); toon();
    };
    knopEur.addEventListener('click', () => zetModus('eur')); knopPct.addEventListener('click', () => zetModus('pct')); bedrag.addEventListener('input', toon);
    const sla = cc => { if (cc == null) { toast('Vul een bedrag of percentage in.'); return; } closePop(true); wijzig(sl, (it, ov) => F.zetCel(it, ov, ym, cc, st.data.vandaag, { label: label.value, behoudAan: behoudAanVoor(r) }), 'Opgeslagen — Financiën rekent mee'); };
    const opslaan = h('button', { type: 'button', class: 'ui-knop ui-knop--primair' }, 'Opslaan'), restKnop = h('button', { type: 'button', class: 'ui-knop', disabled: !(r.nogC > 0) }, 'Rest hier'),
      weg = m.vrijC ? h('button', { type: 'button', class: 'ui-knop' }, 'Verwijderen') : null, sluit = h('button', { type: 'button', class: 'mtf-pop-x', 'aria-label': 'Sluiten', title: 'Sluiten (Esc)' }, '×');
    opslaan.addEventListener('click', () => sla(lees())); restKnop.addEventListener('click', () => { const cc = F.restHier(r, ym); if (cc == null) toast('Er is niets meer te plannen.'); else sla(cc); });
    if (weg) weg.addEventListener('click', () => { closePop(true); wijzig(sl, (it, ov) => F.zetCel(it, ov, ym, 0, st.data.vandaag), 'Factuurdeel verwijderd'); }); sluit.addEventListener('click', () => closePop(true));
    [bedrag, label].forEach(x => x.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sla(lees()); } }));
    const el = h('div', { class: 'mtf-pop', role: 'dialog', 'aria-label': 'Factuurdeel plannen: ' + r.naam + ', ' + maandTekst(ym) },
      h('div', { class: 'mtf-pop-kop' }, sluit, h('b', null, r.naam), h('small', null, maandTekst(ym) + ' · offerte ' + F.fmt(totaal) + (r.nogC > 0 ? ' · nog te plannen ' + F.fmt(r.nogC) : ''))),
      h('div', { class: 'mtf-pop-rij' }, bedrag, h('span', { class: 'mtf-seg-knoppen', role: 'group', 'aria-label': 'Eenheid' }, knopEur, knopPct)), hint,
      h('label', { class: 'mtf-pop-veld' }, h('span', null, 'Label'), label), h('datalist', { id: 'mtf-labels' }, LABEL_TIPS.map(x => h('option', { value: x }))),
      h('div', { class: 'mtf-pop-acties' }, opslaan, restKnop, weg));
    el.addEventListener('pointerdown', () => { st.popBezig = true; setTimeout(() => { st.popBezig = false; }, 600); });
    document.body.append(el); st.pop = { el, sl, ym, sel: 'input.mtf-in[data-sl="' + sl + '"][data-ym="' + ym + '"]', zet: v => { if (modus === 'eur') { bedrag.value = v; toon(); } } };
    const b = inp.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
    if (W <= 700) el.classList.add('blad');
    else { const pw = el.offsetWidth || 300, ph = el.offsetHeight || 220; el.style.left = Math.max(8, Math.min(b.left, W - pw - 8)) + 'px'; el.style.top = (b.bottom + 6 + ph > H ? Math.max(8, b.top - ph - 6) : b.bottom + 6) + 'px'; }
    toon();
  }

  // ── Beheerpaneel "Factuurschema's": per Moneybird-contact een lijst {label, pct}; opgeslagen in de geld-config ──
  async function openSchemaPaneel() {
    if (!st.mag || st.verouderd) return;
    let start; try { const f0 = await st.bron.haal('/geld/fschemas'); if (!f0 || f0.error || !f0.schemas) throw new Error(f0 && f0.error || 'geen antwoord'); start = f0.schemas; st.fs = start; } catch (e) { toast('Factuurschema\u2019s niet te lezen: ' + (e.message || e)); return; }
    try { const c0 = await st.bron.haal('/geld/config'); if (c0 && c0.config) st.cfg = c0.config; } catch (e) { }
    const werk = JSON.parse(JSON.stringify(start)), namen = new Map();
    for (const s of st.schatten || []) if (s.contact_id && !namen.has(s.contact_id)) namen.set(s.contact_id, s.naam || 'contact ' + s.contact_id);
    for (const k of Object.keys(werk)) if (!namen.has(k)) namen.set(k, 'contact ' + k);
    let gekozen = [...namen.keys()][0] || null;
    const modal = h('div', { class: 'mtf-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Factuurschema’s' }), binnen = h('div', { class: 'mtf-modal-in' });
    modal.append(binnen);
    const sluit = () => { modal.remove(); document.removeEventListener('keydown', esc); }, esc = e => { if (e.key === 'Escape') sluit(); };
    document.addEventListener('keydown', esc); modal.addEventListener('pointerdown', e => { if (e.target === modal) sluit(); });
    const som = l => Math.round(l.reduce((a, r) => a + (Number(r.pct) || 0), 0) * 100) / 100;
    const toonIn = () => {
      const keuze = h('select', { class: 'mtf-pop-bedrag mtf-sel-contact', 'aria-label': 'Klant' }, [...namen.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => h('option', { value: k, selected: k === gekozen }, n + (werk[k] ? ' (eigen schema)' : ' (standaard)'))));
      keuze.addEventListener('change', () => { gekozen = keuze.value; toonIn(); });
      const lijst = gekozen ? (werk[gekozen] || null) : null, terugval = gekozen ? F.kiesSchema(gekozen, 0, {}, st.cfg && st.cfg.prognose_schema) : null;
      const inhoud = [h('h3', null, 'Factuurschema’s'), h('p', { class: 'mtf-pop-hint' }, 'Per klant (Moneybird-contact) een vaste verdeling van de factuur, bijvoorbeeld aanbetaling en oplevering. De knop "Schema toepassen" bij een offerte vult dit in op het nog niet geplande deel. Zonder eigen schema geldt het standaardschema (klein, middel of groot).')];
      if (!gekozen) inhoud.push(h('p', null, 'Er zijn nog geen klanten met offertes.'));
      else {
        inhoud.push(keuze);
        const werkLijst = werk[gekozen] || [];
        if (!werk[gekozen]) inhoud.push(h('p', { class: 'mtf-pop-hint' }, 'Nu: standaardschema (' + terugval.rijen.map(r => r.label + ' ' + r.pct + '%').join(', ') + ').'), h('button', { type: 'button', class: 'ui-knop', data: { nieuw: '1' } }, 'Eigen schema voor deze klant'));
        else {
          werkLijst.forEach((r, i) => {
            const l = h('input', { class: 'mtf-pop-label', type: 'text', maxlength: '24', list: 'mtf-labels', value: r.label, 'aria-label': 'Label deel ' + (i + 1) }), p = h('input', { class: 'mtf-pop-bedrag', type: 'text', inputmode: 'decimal', value: String(r.pct).replace('.', ','), 'aria-label': 'Percentage deel ' + (i + 1) });
            l.addEventListener('input', () => { r.label = l.value; }); p.addEventListener('input', () => { const v = F.parsePct(p.value); r.pct = v == null ? NaN : v; kontrole(); });
            const x = h('button', { type: 'button', class: 'ui-knop', 'aria-label': 'Deel ' + (i + 1) + ' verwijderen', data: { weg: String(i) } }, '×');
            inhoud.push(h('div', { class: 'mtf-pop-rij' }, l, p, h('span', null, '%'), x));
          });
          inhoud.push(h('datalist', { id: 'mtf-labels' }, LABEL_TIPS.map(x => h('option', { value: x }))), h('div', { class: 'mtf-pop-hint', id: 'mtf-som' }),
            h('div', { class: 'mtf-pop-acties' }, h('button', { type: 'button', class: 'ui-knop', data: { bij: '1' }, disabled: werkLijst.length >= 6 }, '+ deel'), h('button', { type: 'button', class: 'ui-knop', data: { terug: '1' } }, 'Terug naar standaard')));
        }
      }
      inhoud.push(h('div', { class: 'mtf-pop-acties' }, h('button', { type: 'button', class: 'ui-knop ui-knop--primair', data: { opslaan: '1' } }, 'Opslaan'), h('button', { type: 'button', class: 'ui-knop', data: { sluit: '1' } }, 'Sluiten')));
      binnen.replaceChildren(...inhoud); kontrole();
    };
    const kontrole = () => { const e = binnen.querySelector('#mtf-som'); if (!e || !gekozen || !werk[gekozen]) return; const s = som(werk[gekozen]); e.textContent = Math.abs(s - 100) < 0.01 ? 'Samen 100%.' : 'Samen ' + String(s).replace('.', ',') + '%; het moet 100% zijn.'; e.className = 'mtf-pop-hint' + (Math.abs(s - 100) < 0.01 ? '' : ' mtf-n'); };
    binnen.addEventListener('click', async e => {
      const k = e.target.closest('button'); if (!k) return; const d = k.dataset;
      if (d.nieuw) { werk[gekozen] = F.kiesSchema(gekozen, 0, {}, st.cfg && st.cfg.prognose_schema).rijen.map(r => ({ label: r.label, pct: r.pct })); toonIn(); }
      else if (d.weg) { werk[gekozen].splice(Number(d.weg), 1); if (!werk[gekozen].length) delete werk[gekozen]; toonIn(); }
      else if (d.bij) { werk[gekozen].push({ label: '', pct: 0 }); toonIn(); }
      else if (d.terug) { delete werk[gekozen]; toonIn(); }
      else if (d.sluit) sluit();
      else if (d.opslaan) {
        for (const [id, l] of Object.entries(werk)) if (!l.length || l.some(r => !String(r.label).trim() || !(r.pct > 0)) || Math.abs(som(l) - 100) >= 0.01) { toast(`Het schema van ${namen.get(id) || id} is niet af: elk deel een label en een percentage, samen 100%.`); return; }
        // per klant een eigen opslag: alleen wat echt gewijzigd of weggehaald is gaat naar de server (andere klanten blijven ongemoeid)
        const schoon = l => l.map(r => ({ label: String(r.label).trim().slice(0, 24), pct: Number(r.pct) })), wijz = [];
        for (const [id, l] of Object.entries(werk)) if (JSON.stringify(schoon(l)) !== JSON.stringify(start[id] || null)) wijz.push([id, schoon(l)]);
        for (const id of Object.keys(start)) if (!(id in werk)) wijz.push([id, null]);
        let gelukt = 0;
        try { for (const [id, rijen] of wijz) { const r = await st.bron.haal('/geld/fschema', { method: 'POST', body: { contact_id: id, rijen } }); if (!r || r.error) throw new Error(r && r.error || 'opslaan mislukt'); if (rijen) st.fs[id] = rijen; else delete st.fs[id]; gelukt++; } toast(wijz.length ? 'Factuurschema\u2019s opgeslagen' : 'Niets gewijzigd'); sluit(); teken(); }
        catch (err) { toast(`Niet alles opgeslagen (${gelukt} van ${wijz.length}): ` + (err.message || err)); }
      }
    });
    toonIn(); document.body.append(modal);
  }

  function rijEl(r, nu, kols, edit) {
    const mag = st.mag, uit = st.verouderd, blok = r.afwijkt || !!r.uitbeeld, tr = h('tr', { class: 'mtf-rij' + (r.aan ? '' : ' uit'), data: { sl: r.sleutel } });
    const nietAcc = !!(r.status && r.status !== 'geaccepteerd');
    const meta = h('span', { class: 'mtf-meta' }, r.offertenr ? 'offerte ' + r.offertenr : null, r.extra ? 'geen openstaande offerte' : null, statusPil(r.status), r.uitbeeld ? uitbeeldPil(r) : null,
      r.uitbeeld && mag && !uit ? h('button', { type: 'button', class: 'ui-knop mtf-sm', data: { terug: r.sleutel }, title: 'Zet de offerte terug in de lijst; ‘Gaat zeker door’ blijft uit' }, 'Terugzetten') : null,
      r.afwijkt ? vlag('Bedrag wijkt af', 'In Moneybird staat ' + F.fmt(r.mbTotaalC) + ', de prognose rekent met ' + F.fmt(r.totaalC) + '. Zie Aandacht.') : null,
      r.dubbelen.length ? vlag('Dubbel', 'Nog een prognose-item voor deze offerte. Zie Aandacht.') : null,
      nietAcc && r.aan ? vlag('Nog niet geaccepteerd', 'Deze offerte is nog niet geaccepteerd, maar gaat zeker door. Zie Aandacht.', 'let') : null,
      mag && !uit && !blok && r.nogC > 0 && r.geplandC === 0 && r.gefC === 0 ? h('button', { type: 'button', class: 'mtf-schema', data: { schema: r.sleutel }, title: 'Vul de standaardverdeling van deze klant in op het nog niet geplande deel' }, 'Schema toepassen') : null);
    tr.append(h('td', { class: 's' }, h('div', { class: 'mtf-naam' },
      st.keuze ? h('input', { type: 'checkbox', checked: st.keuze.has(r.sleutel), disabled: !r.estimateId || !!r.uitbeeld, 'aria-label': 'Selecteer: ' + r.naam, data: { kies: r.sleutel } })
        : h('input', { type: 'checkbox', checked: r.aan, disabled: !mag || uit || !!r.uitbeeld, 'aria-label': 'Gaat zeker door: ' + r.naam, title: 'Vink aan als deze offerte zeker doorgaat; telt dan mee hier en in Financiën', data: { aan: r.sleutel } }),
      h('span', null, h('b', { title: r.naam }, r.naam), meta),
      mag && !uit && st.ubBeschikbaar && !st.keuze && r.estimateId && !r.uitbeeld ? h('button', { type: 'button', class: 'mtf-rijmenu', 'aria-haspopup': 'menu', 'aria-label': 'Acties voor ' + r.naam, title: 'Uit beeld zetten', data: { rijmenu: r.sleutel } }, ico('meer') || '…') : null)));
    tr.append(h('td', { class: 'num' + (r.afwijkt ? ' mtf-n' : ''), title: r.afwijkt ? 'Prognose rekent met ' + F.fmt(r.totaalC) + '; Moneybird: ' + F.fmt(r.mbTotaalC) : null }, F.fmt(r.afwijkt ? r.mbTotaalC : r.totaalC)),
      h('td', { class: 'num kol-gef', title: r.gecrediteerd ? 'Netto, na creditnota’s' : null }, r.gefNettoC ? h('span', { class: r.gefNettoC < 0 ? 'mtf-n' : null }, F.fmt(r.gefNettoC)) : h('span', { class: 'mtf-0' }, '–'), r.gecrediteerd ? h('div', { class: 'mtf-gef' }, 'gecrediteerd' + (r.creditC ? ' ' + F.fmt(r.creditC) : '')) : null),
      h('td', { class: 'num kol-nog' }, r.nogC > 0 ? F.fmt(r.nogC) : h('span', { class: 'mtf-0' }, r.bestaat ? 'gepland' : '–')));
    if (st.heeftEerder) tr.append(h('td', { class: 'num' }, r.eerderC ? h('div', { class: 'mtf-cel' }, F.fmt(r.eerderC), mag && r.eerderVrijC ? h('button', { type: 'button', class: 'mtf-schema', disabled: uit || blok, data: { eerder: r.sleutel }, title: 'De factuurdatum is voorbij: zet de open termijnen in de lopende maand' }, 'naar deze maand') : null) : h('span', { class: 'mtf-0' }, '–')));
    kols.forEach((kol, ki) => {
      const nuKol = kol.van === 0;
      if (!edit) {                                                // kwartaal/jaar: som, alleen lezen; klik = naar de maanden van deze periode
        const s = F.rijKolom(r, kol), gepl = s.vrijC + s.vastOpenC;
        const inh = gepl || s.vastGefC ? h('button', { type: 'button', class: 'mtf-agg', data: { spring: String(ki) }, title: 'Klik om deze periode per maand te bewerken' }, gepl ? F.fmt(gepl) : null, s.vastGefC ? h('span', { class: 'mtf-gef' }, 'gefactureerd ' + F.fmt(s.vastGefC)) : null) : h('button', { type: 'button', class: 'mtf-agg mtf-0', data: { spring: String(ki) }, title: 'Klik om deze periode per maand te bewerken' }, '–');
        tr.append(h('td', { class: 'num mnd' + (nuKol ? ' nu' : '') }, inh)); return;
      }
      const m = r.maanden[kol.van], inhoud = h('div', { class: 'mtf-cel' });
      if (m.vastGefC) inhoud.append(h('span', { class: 'mtf-gef', title: 'Al gefactureerd in Moneybird' }, 'gefactureerd ' + F.fmt(m.vastGefC)));
      if (m.vastOpenC) inhoud.append(h('span', { class: 'mtf-vast', title: 'Deel van een termijn die al gedeeltelijk gefactureerd is: vast' }, F.fmt(m.vastOpenC) + ' (vast)'));
      if (mag) {
        inhoud.append(h('input', { class: 'mtf-in', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: m.vrijC ? F.fmt(m.vrijC) : '', placeholder: '–', disabled: uit || blok, 'aria-label': r.naam + ', facturatie ' + maandTekst(m.ym), title: m.datum ? 'Factuurdatum ' + m.datum : 'Bedrag dat je in deze maand factureert', data: { sl: r.sleutel, ym: m.ym } }));
        if (r.nogC > 0) inhoud.append(h('button', { type: 'button', class: 'mtf-rest', disabled: uit || blok, data: { rest: r.sleutel, ym: m.ym }, title: 'Zet het nog niet geplande deel (' + F.fmt(r.nogC) + ') in deze maand' }, 'rest hier'));
      } else if (m.vrijC) inhoud.append(F.fmt(m.vrijC));
      tr.append(h('td', { class: 'num mnd' + (m.ym === nu ? ' nu' : '') }, inhoud.childNodes.length ? inhoud : h('span', { class: 'mtf-0' }, '–')));
    });
    if (st.heeftLater) { const l = F.rijLater(r, kols); tr.append(bedragTd(l)); }
    return tr;
  }

  // Tijdbalk: lopende maand t/m +24 maanden, met de gekozen periode gemarkeerd. Klik = dat blok kiezen, grepen slepen = bereik
  // groter/kleiner (klikt vast op het blok), het gemarkeerde stuk slepen = verschuiven. Pijltjes en Shift+pijltjes op de grepen.
  const bewaarSel = () => { st.scrollNaarBegin = true; ls.set('mtg:fc:per:' + st.wie, F.selTekst(st.sel)); };
  function posSel(spoor, lijst) {
    const N = F.HORIZON + 1, s = st.sel, a = lijst[s.i0].van, b = lijst[s.i1].tot, sel = spoor.querySelector('.mtf-sel');
    if (sel) { sel.style.left = (a / N * 100) + '%'; sel.style.width = ((b - a + 1) / N * 100) + '%'; }
    const pl = spoor.parentNode && spoor.parentNode.querySelector('.mtf-periode'); if (pl) pl.textContent = 'Periode: ' + lijst[s.i0].label + (s.i1 > s.i0 ? ' – ' + lijst[s.i1].label : '');
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
    const wrap = h('div', { class: 'mtf-balk' }, h('div', { class: 'mtf-periode' }), jaren, spoor);
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

  // Het scrollvak: fades aan de randen, Shift+muiswiel, slepen met de muis op een lege plek; "passend maken" past de maandkolommen aan.
  function pasKolommen(sc) {
    const tab = sc && sc.querySelector('table'); if (!tab) return;
    tab.classList.remove('passend', 'compact'); tab.style.removeProperty('--kolbreed');
    if (!st.passend) return;
    const ms = tab.querySelectorAll('thead th.mnd'); if (!ms.length) return;
    tab.classList.add('passend');                                                                 // eerst de vaste kolommen in hun passende stand meten
    const vast = [...tab.querySelectorAll('thead th:not(.mnd)')].reduce((a, t) => a + (getComputedStyle(t).display === 'none' ? 0 : t.offsetWidth), 0);
    const r = F.passendBreedte(sc.clientWidth - vast - 2, ms.length);
    let w = r.w; const zet = () => { tab.style.setProperty('--kolbreed', w + 'px'); tab.classList.toggle('compact', w < 96); }; zet();
    for (let i = 0; i < 40 && w > 64 && sc.scrollWidth > sc.clientWidth + 1; i++) { w--; zet(); }   // rand- en afrondingsverschillen: zo smal als nodig tot het past
  }
  function scrollWrap(tab) {
    const sc = h('div', { class: 'mtf-scroll' }, tab), wrap = h('div', { class: 'mtf-scrollwrap' }, sc);
    const bij = () => {
      const over = sc.scrollWidth > sc.clientWidth + 2, sk = tab.querySelector('thead th.s');
      wrap.classList.toggle('eind', !over || sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 2); wrap.classList.toggle('begin', !over || sc.scrollLeft <= 2);
      wrap.style.setProperty('--sbreed', (sk ? sk.offsetWidth : 0) + 'px');
      if (tab.classList.contains('vast')) {                                                       // dynamisch gemeten hoogte van de vaste kop en totalen
        const kopH = (tab.querySelector('thead') || {}).offsetHeight || 0; let totH = 0; tab.querySelectorAll('tfoot tr').forEach(tr => { totH += tr.offsetHeight; });
        sc.style.scrollPaddingBottom = (totH + 4) + 'px'; sc.style.scrollPaddingTop = (kopH + 4) + 'px'; sc.style.scrollPaddingLeft = ((sk ? sk.offsetWidth : 0) + 4) + 'px';
      }
    };
    sc.addEventListener('scroll', bij);
    sc.addEventListener('wheel', e => { if (e.shiftKey && !e.deltaX && e.deltaY) { sc.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    sc.addEventListener('pointerdown', e => {                       // slepen met de muis op een lege plek (niet op velden, knoppen of vinkjes)
      if (e.pointerType !== 'mouse' || e.button !== 0 || (e.target.closest && e.target.closest('input,button,a,label,select,textarea'))) return;
      const x0 = e.clientX, y0 = e.clientY, l0 = sc.scrollLeft, t0 = sc.scrollTop; let sleept = false;
      const mv = ev => { if (!sleept && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 5) return; sleept = true; sc.classList.add('sleept'); sc.scrollLeft = l0 - (ev.clientX - x0); sc.scrollTop = t0 - (ev.clientY - y0); ev.preventDefault(); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); sc.classList.remove('sleept'); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    });
    st.scrollBij = () => { pasKolommen(sc); bij(); };
    (root.requestAnimationFrame || setTimeout)(() => { pasKolommen(sc); bij(); }); return wrap;
  }
  function tekenTabel() {
    const vast = st.weergave === 'vast';
    const vandaag = st.data.vandaag, nu = vandaag.slice(0, 7), zv = F.zichtbaar(st.rijen, [...st.filter]), rijen = st.rijen, edit = st.sel.eenheid === 'maand';
    const lijst = F.eenheden(nu, st.sel.eenheid), kols = F.kolommen(lijst, st.sel);
    st.heeftEerder = rijen.some(r => r.aan && r.eerderC);
    const G = root.MTGeld, groep = G && G.groep ? G.groep(st.data) : null;
    const tot = F.totalen({ rijen, events: st.data.events, vandaag, maanden: F.HORIZON + 1, uitgesloten: zv.uitgesloten, openAan: st.openAan, kostenAan: st.kostenAan, overigAan: st.overigAan, effect: G && G.effect && groep ? (e => c(G.effect(e, 'lopend', groep))) : null });
    const g = F.groepeerTotalen(tot, kols);
    st.heeftLater = rijen.some(r => r.aan && F.rijLater(r, kols) > 0) || ['gepland', 'binnen', 'open', 'kosten', 'overig'].some(k => g.later[k] !== 0);
    const eenheidWoord = st.sel.eenheid === 'maand' ? 'maand' : st.sel.eenheid;
    // Kerncijfers voor de gekozen periode
    const som = a => a.reduce((x, y) => x + y, 0), nogTot = rijen.reduce((a, r) => a + (r.aan ? r.nogC : 0), 0), netto = som(g.netto);
    const fact = (label, cc, klasse, titel, extra) => h('div', { class: 'mtf-fact' + (extra ? ' ' + extra : ''), title: titel }, h('span', { class: 'label' }, label), h('span', { class: 'v ' + (klasse || '') }, cc === 0 ? '–' : '€ ' + F.fmt(cc)));
    const kern = h('section', { class: 'mtf-kaart mtf-kernkaart', 'aria-label': 'Kerncijfers' }, h('div', { class: 'mtf-kaart-kop' }, h('h2', null, 'Kerncijfers'), h('span', { class: 'mtf-getal' }, kols.length === 1 ? kols[0].label : kols[0].label + ' t/m ' + kols[kols.length - 1].label)),
      h('div', { class: 'mtf-kern' }, fact('Te factureren', som(g.gepland), null, 'Wat je in deze periode factureert, van de offertes die zeker doorgaan'), fact('Binnen', som(g.binnen), null, 'Verwachte betalingen van die facturen in deze periode'),
        fact('Nog niet gepland', nogTot, null, 'Deel van de offertes dat zeker doorgaat en nog in geen enkele maand staat'),
        fact('Verwacht netto', netto, netto < 0 ? 'mtf-n' : netto > 0 ? 'mtf-p' : '', 'Binnen min de aangevinkte kosten, in deze periode', 'netto')));
    const kop = h('tr', null, h('th', { class: 's', title: 'Vink aan als deze offerte zeker doorgaat; telt dan mee hier en in Financiën' }, h('span', { class: 'mtf-pijlen' }, h('button', { type: 'button', class: 'mtf-pijl', 'aria-label': 'Kolommen naar links (Shift: een pagina)', title: 'Een kolom naar links; met Shift een pagina', data: { scroll: '-1' } }, '‹'), h('button', { type: 'button', class: 'mtf-pijl', 'aria-label': 'Kolommen naar rechts (Shift: een pagina)', title: 'Een kolom naar rechts; met Shift een pagina', data: { scroll: '1' } }, '›')), h('span', { class: 'mtf-zk' }, 'Gaat zeker door'), 'Offerte'), h('th', { class: 'num' }, 'Bedrag'), h('th', { class: 'num kol-gef' }, 'Gefactureerd'), h('th', { class: 'num kol-nog' }, 'Nog te plannen'),
      st.heeftEerder ? h('th', { class: 'num', title: 'Factuurdatum voorbij, nog niet gefactureerd' }, 'Eerder') : null,
      kols.map((k, ki) => h('th', { class: 'num mnd' + (k.van === 0 ? ' nu' : ''), title: edit ? null : k.maanden[0] + ' t/m ' + k.maanden[k.maanden.length - 1] }, edit ? k.label : h('button', { type: 'button', class: 'mtf-agg mtf-kopknop', data: { spring: String(ki) }, title: 'Per maand bekijken en bewerken' }, k.label))),
      st.heeftLater ? h('th', { class: 'num', title: 'Alles na de gekozen periode' }, 'Later') : null);
    const foot = [];
    const regel = (label, cellen, eerder, later, klasse, extra) => h('tr', { class: klasse || '' }, h('th', { class: 's' }, extra || label), h('td'), h('td', { class: 'kol-gef' }), h('td', { class: 'kol-nog' }), st.heeftEerder ? (eerder != null ? getalTd(eerder) : h('td')) : null, cellen, st.heeftLater ? (later != null ? getalTd(later) : h('td')) : null);
    foot.push(regel('Gefactureerd (gepland)', g.gepland.map(v => bedragTd(v, 'mnd')), tot.eerder.gepland, g.later.gepland, '', h('span', { title: 'Wat je in die periode factureert, van de offertes die meetellen' }, 'Gefactureerd (gepland)')));
    foot.push(regel('Binnen', g.binnen.map(v => getalTd(v, 'mnd')), null, g.later.binnen, '', h('span', { title: 'Verwachte betaling: factuurdatum plus betaaltermijn en het gewone betaalgedrag van de klant, zoals in Financiën' }, 'Binnen (betaaldatum)')));
    foot.push(regel('', g.open.map(v => getalTd(v, 'mnd')), null, g.later.open, '', h('label', { title: 'Al verstuurde verkoopfacturen die nog niet betaald zijn, per verwachte betaalmaand (dezelfde bron als de kaslijn in Financiën)' }, h('input', { type: 'checkbox', checked: st.openAan, data: { open: '1' } }), 'Openstaande facturen')));
    foot.push(regel('', g.kosten.map(v => getalTd(v, 'mnd')), null, g.later.kosten, '', h('label', { title: 'Inkoopfacturen en vaste patronen uit Financiën' }, h('input', { type: 'checkbox', checked: st.kostenAan, data: { kosten: '1' } }), 'Lopende kosten')));
    foot.push(regel('', g.overig.map(v => getalTd(v, 'mnd')), null, g.later.overig, '', h('label', { title: 'Btw-aangifte, weekinleg en handmatige posten uit Financiën' }, h('input', { type: 'checkbox', checked: st.overigAan, data: { overig: '1' } }), 'Overige voorspelling')));
    foot.push(regel('Netto', g.netto.map(v => getalTd(v, 'mnd')), null, g.later.netto, 'netto', h('span', { title: 'Binnen, min de aangevinkte kosten' }, 'Netto per ' + eenheidWoord)));
    const tab = h('table', { class: 'mtf-tabel' + (vast ? ' vast' : '') }, h('thead', null, kop), h('tbody', null, zv.zichtbaar.map(r => rijEl(r, nu, kols, edit))), h('tfoot', null, foot));
    if (vast) { const hs = [28, 28, 28, 28, 28, 34]; foot.forEach((tr, i) => { const b = hs.slice(i + 1).reduce((a, x) => a + x, 0); [...tr.children].forEach(cel => { cel.style.bottom = b + 'px'; }); }); }   // totalen blijven onderaan in beeld
    const nKeuze = st.keuze ? st.keuze.size : 0, magSel = st.mag && !st.verouderd;
    const kopActies = st.keuze ? h('div', { class: 'mtf-bulk' }, h('span', null, nKeuze + ' geselecteerd'), h('button', { type: 'button', class: 'mtf-schema', data: { kiesalle: '1' } }, 'Alles'),
        h('select', { class: 'mtf-bulkreden', 'aria-label': 'Reden', data: { bulkreden: '1' } }, Object.keys(F.UITBEELD_REDENEN).map(k => h('option', { value: k, selected: st.bulkReden === k }, F.UITBEELD_REDENEN[k]))),
        h('button', { type: 'button', class: 'ui-knop ui-knop--primair mtf-sm', disabled: nKeuze === 0, data: { bulk: '1' } }, `Uit beeld zetten (${nKeuze})`), h('button', { type: 'button', class: 'ui-knop mtf-sm', data: { keuzeuit: '1' } }, 'Annuleren'))
      : (magSel && st.ubBeschikbaar ? h('button', { type: 'button', class: 'ui-knop mtf-sm', title: 'Meerdere offertes tegelijk uit beeld zetten', data: { selecteren: '1' } }, 'Selecteren') : null);
    const passendKnop = h('button', { type: 'button', class: 'ui-knop mtf-sm', 'aria-pressed': String(!!st.passend), title: st.passend ? 'Terug naar de normale kolombreedte' : 'Maak de maandkolommen smaller zodat alle gekozen maanden in beeld passen', data: { passend: '1' } }, st.passend ? 'Normale breedte' : 'Passend maken');
    const kaart = h('section', { class: 'mtf-kaart mtf-tabelkaart', 'aria-label': 'Offertes' }, h('div', { class: 'mtf-kaart-kop' }, h('h2', null, 'Offertes'), h('span', { class: 'mtf-getal' }, String(zv.zichtbaar.length)), passendKnop, kopActies), edit && st.mag ? h('div', { class: 'mtf-hint' }, 'Klik op een maand om een factuurbedrag te plannen') : null, scrollWrap(tab));
    return [kern, kaart];
  }

  function teken() {
    const el = st.el; if (!el) return;
    const eenh = h('div', { class: 'mtf-seg-knoppen', role: 'group', 'aria-label': 'Periode-eenheid' }, F.EENHEDEN.map(x => h('button', { type: 'button', class: 'ui-knop' + (st.sel.eenheid === x ? ' ui-knop--primair' : ''), 'aria-pressed': String(st.sel.eenheid === x), data: { eenheid: x } }, x.charAt(0).toUpperCase() + x.slice(1))));
    const menu = h('div', { class: 'mtf-menu' + (st.menu ? ' open' : ''), role: 'menu' }, st.mag && st.data && st.fsBeschikbaar ? h('button', { type: 'button', role: 'menuitem', disabled: st.verouderd, data: { schemas: '1' } }, 'Factuurschema’s') : null,
      h('button', { type: 'button', role: 'menuitem', data: { vernieuw: '1' } }, 'Vernieuwen'), h('button', { type: 'button', role: 'menuitem', data: { uitleg: '1' } }, st.uitleg ? 'Uitleg verbergen' : 'Uitleg'));
    const weergaveKnop = h('button', { type: 'button', class: 'ui-knop', title: st.weergave === 'vast' ? 'Naar de lange paginaweergave' : 'Terug naar de beeldvullende weergave', data: { weergave: '1' } }, st.weergave === 'vast' ? 'Uitklappen' : 'Inklappen');
    const kop = h('div', { class: 'mtf-kop' }, h('div', { class: 'mtf-titelblok' }, h('h1', { class: 'mtf-titel' }, 'Forecast'), h('p', { class: 'mtf-sub' }, 'Facturatie per periode, incl. btw. Wat je plant staat ook in de prognose van Financiën.')),
      h('div', { class: 'mtf-acties' }, eenh, weergaveKnop, h('div', { class: 'mtf-menuwrap' }, h('button', { type: 'button', class: 'ui-knop mtf-stil', 'aria-haspopup': 'menu', 'aria-expanded': String(!!st.menu), 'aria-label': 'Meer acties', title: 'Factuurschema’s, vernieuwen, uitleg', data: { menu: '1' } }, ico('meer') || '…'), menu)));
    const w = h('div', { class: 'mtf' + (st.weergave === 'vast' ? ' vast' : '') + (st.bezig ? ' mtf-bezig' : '') }, kop, st.uitleg ? h('div', { class: 'mtf-uitleg' }, UITLEG) : null);
    if (st.onvolledig) w.append(h('div', { class: 'mtf-fout', role: 'alert' }, h('b', null, 'Prognose onvolledig geladen. '), 'Niet alle prognose-items zijn opgehaald, dus de dubbelencontrole en de totalen kunnen niet kloppen. Wijzigen is uitgeschakeld; kies Vernieuwen in het menu.'));
    else if (st.verouderd) w.append(h('div', { class: 'mtf-fout' }, h('b', null, 'Gegevens verouderd — Vernieuwen. '), 'Wijzigen is uitgeschakeld tot het verversen lukt.'));
    if (st.fout) w.append(h('div', { class: 'mtf-fout' }, st.fout));
    if (st.uitbeeldMelding) { const m = st.uitbeeldMelding;
      w.append(h('div', { class: 'mtf-fout', role: 'alert' }, h('b', null, 'Uit beeld zetten: niet alles is gelukt. '),
        m.gelukt.length && !m.vast ? `Gelukt: ${m.gelukt.join(', ')}. ` : '',
        m.mislukt.length ? `Mislukt (niets veranderd voor deze offertes behalve eventueel een al uitgezet prognose-item): ${m.mislukt.map(x => x.naam + ' (' + x.fout + ')').join('; ')}. ` : '',
        m.vast ? `Uitgezet maar niet uit beeld: ${m.vast.namen.join(', ')} (${m.vast.fout}). ` : '',
        m.vast ? h('button', { type: 'button', class: 'ui-knop mtf-sm', data: { ubopnieuw: '1' } }, 'Opnieuw') : null, ' ', h('button', { type: 'button', class: 'ui-knop mtf-sm', data: { ubsluit: '1' } }, 'Sluiten'))); }
    if (st.afgekapt) w.append(h('div', { class: 'mtf-fout' }, h('b', null, 'Lijst afgekapt. '), 'Er zijn meer geaccepteerde offertes in Moneybird dan hier getoond worden; de lijst is dus niet volledig.'));
    if (st.data) {
      const tel = F.telStatus(st.schatten || [], ubEff()), verb = F.zichtbaar(st.rijen, [...st.filter]).verborgen;
      w.append(h('section', { class: 'mtf-kaart mtf-strook', 'aria-label': 'Filter en periode' },
        h('div', { class: 'mtf-filter', role: 'group', 'aria-label': 'Status van de offertes' }, h('span', { class: 'mtf-kopje' }, 'Offertes'),
          F.FILTERS.map(x => h('button', { type: 'button', class: 'mtf-fchip', 'aria-pressed': String(st.filter.has(x)), data: { filter: x } }, ico(STATUSLABEL[x][0]), h('span', { class: 'mtf-nm' }, STATUSLABEL[x][1]), h('span', { class: 'mtf-dot' }, '·'), h('span', { class: 'mtf-tel' }, String(tel[x])))),
          st.ubInfo && st.ubInfo.max && st.ubInfo.aantal / st.ubInfo.max > 0.8 ? h('span', { class: 'mtf-verborgen' }, `De uit-beeld-lijst is bijna vol (${st.ubInfo.aantal} van ${st.ubInfo.max}). Zet oude offertes terug of laat ze weg.`) : null,
          verb ? h('span', { class: 'mtf-verborgen' }, verb + (verb === 1 ? ' offerte verborgen door filter; totalen tellen hem' : ' offertes verborgen door filter; totalen tellen ze') + ' wel mee (zoals Financiën).') : null),
        sliderEl(st.data.vandaag.slice(0, 7))));
      const ak = aandachtKaart(); if (ak) w.append(ak);
    }
    if (!st.data) { w.append(h('div', { class: 'mtf-melding' }, st.fout ? '' : 'Forecast laden…')); }
    else if (!st.rijen.length) w.append(h('div', { class: 'mtf-kaart mtf-melding' }, 'Geen offertes in Moneybird gevonden.'));
    else if (!F.zichtbaar(st.rijen, [...st.filter]).zichtbaar.length) { w.append(h('div', { class: 'mtf-kaart mtf-melding' }, 'Geen offertes met de gekozen statussen. Zet een status aan.')); }
    else {
      for (const k of tekenTabel()) w.append(k);
      const waarsch = (st.data.waarschuwingen || []).filter(x => x && x.onvolledig).length;
      w.append(h('div', { class: 'mtf-voet' }, 'De totalen tellen alle offertes waar ‘Gaat zeker door’ aan staat, ook als het filter ze verbergt (zoals Financiën).' + (st.sel.eenheid === 'maand' ? '' : ' Kwartaal en jaar zijn sommen: klik op een periode om per maand te bewerken.') + (st.mag ? '' : ' Je mag lezen, niet wijzigen.') + (waarsch ? ' Let op: niet alle bronnen van Financiën zijn volledig geladen; de bedragen kunnen afwijken.' : '')));
    }
    closePop(); closeRijMenu();
    const oudSc = el.querySelector('.mtf-scroll'), pos = oudSc && !st.scrollNaarBegin ? [oudSc.scrollLeft, oudSc.scrollTop] : null; st.scrollNaarBegin = false;   // na een andere periode naar het begin, anders de plek behouden
    el.replaceChildren(w); pasHoogte();
    if (st.focusTerug && !st.bezig) { focusSel(st.focusTerug); st.focusTerug = null; }
    if (pos) { const nsc = el.querySelector('.mtf-scroll'); if (nsc) { nsc.scrollLeft = pos[0]; nsc.scrollTop = pos[1]; } if (st.scrollBij) st.scrollBij(); }
    if (st.focusGreep) { const g = el.querySelector('.mtf-greep.' + st.focusGreep); if (g) g.focus(); st.focusGreep = null; }
  }

  // ── Laden en opslaan ─────────────────────────────────────────────────────────
  const verseKs = () => st.ks.filter(x => Date.now() - x.t < 180000).map(x => x.k);
  // Uit-beeld-markeringen: de lijst van de server (eigen sleutel per offerte) met onze eigen recente wijzigingen erover (KV-lijsten lopen even achter).
  function ubEff() {
    const ub = Object.assign({}, st.ub), nu = Date.now();
    for (const id of Object.keys(st.ubOverlay)) { const o = st.ubOverlay[id]; if (nu - o.t >= 120000) { delete st.ubOverlay[id]; continue; } if (o.rec) ub[id] = o.rec; else delete ub[id]; }
    return ub;
  }
  function rekenRijen() {
    const items = Object.assign({}, st.items);
    for (const k of Object.keys(st.vers)) { const v = st.vers[k]; if (Date.now() - v.t < 120000 && (!items[k] || (items[k].ts || 0) < (v.item.ts || 0))) items[k] = v.item; else if (Date.now() - v.t >= 120000) delete st.vers[k]; }
    st.itemsEff = items;
    st.rijen = F.bouwRijen({ schatten: st.schatten || [], events: (st.data && st.data.events) || [], items, posten: (st.data && st.data.prognose && st.data.prognose.posten) || [], projecten: st.projecten ? st.projecten() : [], vandaag: st.data.vandaag, maanden: F.HORIZON + 1, uitbeeld: ubEff() });
  }
  const tijdlijnPad = vers => { const v = st.data ? st.data.vandaag : new Date().toISOString().slice(0, 10); return `/geld/tijdlijn?van=${dagPlus(v, -35)}&tot=${dagPlus(v, 364)}&historie=1${vers ? '&vers=1' : ''}${st.cv ? '&cv=' + encodeURIComponent(st.cv) : ''}${verseKs().length ? '&ks=' + encodeURIComponent(verseKs().join(',')) : ''}`; };
  F.laad = async function (vers) {
    if (!st.el) return;
    const pad = tijdlijnPad(vers);
    st.fout = null;
    try {
      const nodig = !st.schatten || vers === 'schatten' || Date.now() - st.schattenT > 120000;
      const foutObj = e => ({ error: String((e && e.message) || e) });
      const [d, p, s, cf, ubR, fsR] = await Promise.all([st.bron.haal(pad), st.bron.haal('/geld/prognose'), nodig ? st.haalSchatten() : Promise.resolve(null), st.bron.haal('/geld/config').catch(() => null),
        st.bron.haal('/geld/uitbeeld').catch(foutObj), st.bron.haal('/geld/fschemas').catch(foutObj)]);
      if (cf && cf.config) st.cfg = cf.config;
      const weg = r => !r || (r.error && /404|onbekende|not.?found/i.test(String(r.error)));          // oude worker zonder deze routes: die functie uitzetten
      if (ubR && !ubR.error && ubR.items) { st.ubBeschikbaar = true; st.ub = ubR.items; st.ubInfo = { aantal: ubR.aantal, max: ubR.max }; }
      else if (weg(ubR)) { st.ubBeschikbaar = false; st.ub = {}; st.ubInfo = null; }
      else throw new Error(ubR.error || 'de uit-beeld-lijst is niet te lezen');                          // fail-closed: nooit werken met een halve lijst
      if (fsR && !fsR.error && fsR.schemas) { st.fsBeschikbaar = true; st.fs = fsR.schemas; }
      else if (weg(fsR)) { st.fsBeschikbaar = false; st.fs = {}; }
      else throw new Error(fsR.error || 'de factuurschema’s zijn niet te lezen');
      if (!d || d.error) throw new Error(d && d.error || 'geen antwoord van Financiën');
      if (!p || p.error) throw new Error(p && p.error || 'prognose niet te lezen');
      if (s) { st.schatten = (Array.isArray(s) ? s : s.lijst || []).map(F.schatNorm).filter(x => x && x.status !== 'overig'); st.afgekapt = !Array.isArray(s) && !!s.afgekapt; st.schattenT = Date.now(); }
      st.data = d; st.items = p.items || {}; st.verouderd = false; st.onvolledig = p.compleet === false; if (st.onvolledig) st.verouderd = true;   // lijst niet compleet: nooit wijzigen op halve gegevens
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
    { const f = ls.get('mtg:fc:filter:' + st.wie); st.filter = new Set(f == null ? F.STATUSSEN : f.split(',').filter(x => F.FILTERS.includes(x))); }
    st.passend = ls.get('mtg:fc:passend:' + st.wie) === '1';
    { const wg = ls.get('mtg:fc:weergave:' + st.wie); st.weergave = wg === 'vast' || wg === 'lang' ? wg : (window.innerWidth <= 700 ? 'lang' : 'vast'); }   // telefoon: lange pagina, een vast vak met eigen scroll werkt daar slecht met touch
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
        if (r.compleet === false) throw new Error('de prognoselijst is niet compleet geladen — vernieuw');
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
        const aanFout = F.aanZetFout(huidig, res.item, rij ? rij.schatTotaalC : null); if (aanFout) { toast(aanFout); return; }
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
  // ── Uit beeld zetten / terugzetten (schrijven) ──
  function noteer(w, sleutel) {
    if (w.cachever) st.cv = w.cachever;
    if (w.ks) st.ks = st.ks.filter(x => x.k !== w.ks && Date.now() - x.t < 180000).concat({ k: w.ks, t: Date.now() }).slice(-10);
    if (w.item) st.vers[sleutel] = { item: w.item, t: Date.now() };
    const G = root.MTGeld; if (G && G._st) { if (w.cachever) G._st.cv = w.cachever; if (w.ks) G._st.ks = (G._st.ks || []).filter(x => x.k !== w.ks).concat({ k: w.ks, t: Date.now() }).slice(-10); }
  }
  function taak(fn) {
    st.bezig = true; teken();
    st.wachtrij = st.wachtrij.then(async () => {
      try { if (!st.mag) throw new Error('je mag dit niet wijzigen'); if (st.verouderd) throw new Error('de gegevens zijn verouderd — vernieuw eerst'); await fn(); }
      catch (e) { toast('Niet opgeslagen: ' + (e.message || e) + (/gewijzigd|aangepast/.test(String(e.message)) ? ' — herlaad' : '')); }
      await F.laad(true);
    });
    return st.wachtrij;
  }
  // Elke uitbeeld-actie: eerst een controle zonder schrijven (rechten, validatie, maximum), dan de prognose-items (per rij het resultaat),
  // dan de markering (1x opnieuw proberen); wat mislukt blijft zichtbaar in een melding met een knop Opnieuw, nooit stil.
  function noteerUb(res) {
    const t = Date.now();
    for (const [id, rec] of Object.entries(res.items || {})) st.ubOverlay[id] = { rec, t };
    for (const id of res.verwijderd || []) st.ubOverlay[id] = { rec: null, t };
    if (typeof res.aantal === 'number') st.ubInfo = { aantal: res.aantal, max: res.max };
  }
  async function ubPost(body) { const res = await st.bron.haal('/geld/uitbeeld', { method: 'POST', body }); if (!res || res.error) throw new Error(res && res.error || 'opslaan mislukt'); return res; }
  function uitBeeldZetten(sleutels, reden) {
    return taak(async () => {
      const rijen = sleutels.map(s => st.rijen.find(r => r.sleutel === s)).filter(r => r && !r.uitbeeld);
      if (!rijen.length) throw new Error('niets te doen');
      const r = await st.bron.haal('/geld/prognose'); if (!r || r.error) throw new Error(r && r.error || 'prognose niet te lezen');
      if (r.compleet === false) throw new Error('de prognoselijst is niet compleet geladen — vernieuw');
      const lijst = Object.assign({}, r.items || {});
      for (const k of Object.keys(st.vers)) { const e = st.vers[k]; if (Date.now() - e.t < 120000 && (!lijst[k] || (lijst[k].ts || 0) < (e.item.ts || 0))) lijst[k] = e.item; }
      const plan = F.bulkUitBeeld(rijen, lijst, reden);
      if (plan.fout) throw new Error(plan.fout);
      if (!plan.ids.length) throw new Error('deze offertes hebben geen geldig offerte-id');
      await ubPost({ ids: plan.ids, reden, controle: true });                         // 1. gaat de markering straks slagen? Zo niet: niets gewijzigd
      const fouten = {};                                                              // 2. prognose-items uit (alle actieve items van dezelfde offerte), resultaat per rij
      for (const u of plan.updates) {
        try { const w = await st.bron.haal('/geld/prognose', { method: 'POST', body: { sleutel: u.sleutel, item: u.item, vorige_ts: lijst[u.sleutel].ts } }); if (!w || w.error) throw new Error(w && w.error || 'opslaan mislukt'); noteer(w, u.sleutel); }
        catch (e) { for (const rs of u.rijen) (fouten[rs] = fouten[rs] || []).push(e.message || String(e)); }
      }
      const goed = rijen.filter(x => plan.perRij[x.sleutel] && !fouten[x.sleutel]), slecht = rijen.filter(x => fouten[x.sleutel]);
      const melding = { gelukt: goed.map(x => x.naam), mislukt: slecht.map(x => ({ naam: x.naam, fout: fouten[x.sleutel][0] })), vast: null };
      const ids = goed.map(x => String(x.estimateId));                                // 3. markering (alleen voor rijen waarvan alle items zijn uitgezet)
      if (ids.length) {
        let laatste = null;
        for (let poging = 0; poging < 2; poging++) { try { noteerUb(await ubPost({ ids, reden })); laatste = null; break; } catch (e) { laatste = e; } }
        if (laatste) melding.vast = { ids, reden, namen: goed.map(x => x.naam), fout: laatste.message || String(laatste) };
      }
      st.uitbeeldMelding = melding.mislukt.length || melding.vast ? melding : null;
      if (st.uitbeeldMelding) toast('Niet alles is gelukt: zie de melding bovenaan.');
      else toast(`${goed.length === 1 ? 'Offerte' : goed.length + ' offertes'} uit beeld gezet (${F.UITBEELD_REDENEN[reden].toLowerCase()}). Terug te vinden bij Uit beeld.`);
    });
  }
  function ubOpnieuw() {
    const v = st.uitbeeldMelding && st.uitbeeldMelding.vast; if (!v) return;
    return taak(async () => {
      noteerUb(await ubPost({ ids: v.ids, reden: v.reden }));
      st.uitbeeldMelding = st.uitbeeldMelding.mislukt.length ? Object.assign({}, st.uitbeeldMelding, { vast: null }) : null; toast('Uit beeld gezet.');
    });
  }
  function terugzetten(sleutel) {
    return taak(async () => {
      const rij = st.rijen.find(r => r.sleutel === sleutel); if (!rij || !rij.estimateId) throw new Error('deze offerte staat er niet meer — vernieuw');
      noteerUb(await ubPost({ ids: [String(rij.estimateId)], reden: null })); toast('Teruggezet. ‘Gaat zeker door’ staat uit; zet het aan als de offerte doorgaat.');
    });
  }
  async function bevestigUitBeeld(rijen, reden) {
    if (!root.mtDialog) { toast('Het bevestigingsvenster is niet beschikbaar.'); return false; }
    const n = rijen.length, items = new Set(); for (const r of rijen) for (const k of F.itemSleutels(r, st.itemsEff || st.items)) items.add(k);
    const itemTekst = items.size ? `\n${items.size} ${items.size === 1 ? 'prognose-item gaat' : 'prognose-items gaan'} uit${items.size > n ? ' (ook dubbele items van dezelfde offerte)' : ''}.` : '';
    return root.mtDialog.confirm({ title: n === 1 ? 'Offerte uit beeld zetten' : `${n} offertes uit beeld zetten`,
      message: (n === 1 ? `${rijen[0].naam} uit beeld zetten (${F.UITBEELD_REDENEN[reden].toLowerCase()})?\n‘Gaat zeker door’ gaat uit; planning blijft bewaard.` : `Reden: ${F.UITBEELD_REDENEN[reden]}.\n‘Gaat zeker door’ gaat uit voor de offertes met een prognose; de planning blijft bewaard.`) + itemTekst + `\nJe zet ze terug via het filter Uit beeld. Er verandert niets in Moneybird.`, okLabel: 'Uit beeld zetten' });
  }
  async function bulkFlow() {
    const rijen = [...(st.keuze || [])].map(s => st.rijen.find(r => r.sleutel === s)).filter(Boolean); if (!rijen.length) return;
    const reden = st.bulkReden || 'verkeerd';
    if (!(await bevestigUitBeeld(rijen, reden))) return; st.keuze = null; uitBeeldZetten(rijen.map(r => r.sleutel), reden);
  }
  function focusSel(sel) { const e = sel && st.el && st.el.querySelector(sel); if (e && !e.disabled) { try { e.focus({ preventScroll: true }); } catch (x) { } } }
  function closeRijMenu(focus) {
    const sel = st.rijmenuSel; if (st.rijmenu) { st.rijmenu.remove(); st.rijmenu = null; }
    if (focus && sel) { st.focusTerug = sel; focusSel(sel); }
  }
  function openRijMenu(knop, r) {
    closeRijMenu(); st.rijmenuSel = '[data-rijmenu="' + r.sleutel + '"]';
    const menu = h('div', { class: 'mtf-rijmenu-lijst', role: 'menu', 'aria-label': 'Uit beeld zetten: ' + r.naam }, h('div', { class: 'mtf-rm-kop' }, 'Uit beeld zetten'),
      Object.keys(F.UITBEELD_REDENEN).map(k => h('button', { type: 'button', role: 'menuitem', data: { reden: k } }, F.UITBEELD_REDENEN[k])));
    menu.addEventListener('click', async e => { const b = e.target.closest('button'); if (!b) return; const reden = b.dataset.reden; closeRijMenu(true); if (await bevestigUitBeeld([r], reden)) uitBeeldZetten([r.sleutel], reden); });
    menu.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const bs = [...menu.querySelectorAll('button')], i = bs.indexOf(document.activeElement); const n = bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length]; if (n) { n.focus(); e.preventDefault(); } } });
    document.body.append(menu); st.rijmenu = menu;
    const b = knop.getBoundingClientRect(), W = window.innerWidth, pw = menu.offsetWidth || 220;
    menu.style.left = Math.max(8, Math.min(b.left, W - pw - 8)) + 'px'; menu.style.top = (b.bottom + 4) + 'px';
    const eerste = menu.querySelector('button'); if (eerste) eerste.focus();
  }
  // Vaste (beeldvullende) weergave: de hoogte volgt het venster, de tabel scrolt in een eigen vak.
  function pasHoogte() {
    const w = st.el && st.el.querySelector('.mtf.vast'); if (!w) return;
    const top = w.getBoundingClientRect().top + (window.pageYOffset || 0);
    w.style.height = Math.max(520, window.innerHeight - top - 16) + 'px';
  }

  function zetMenu(open) {
    st.menu = !!open; const w = st.el && st.el.querySelector('.mtf-menu'), k = st.el && st.el.querySelector('[data-menu]');
    if (w) w.classList.toggle('open', st.menu); if (k) k.setAttribute('aria-expanded', String(st.menu));
  }
  function koppel() {
    const el = st.el; if (el._mtfKoppel) return; el._mtfKoppel = true;
    el.addEventListener('change', e => {
      const t = e.target; if (!st.mag || st.verouderd) return;
      if (t.matches && t.matches('input.mtf-in')) {
        if (st.popBezig) { if (st.pop && st.pop.el) { const b = st.pop.el.querySelector('.mtf-pop-bedrag'); if (b) { b.value = t.value; b.dispatchEvent(new Event('input')); } } return; }   // klik in het paneel: niet opslaan, de waarde gaat mee naar het paneel
        const rj = st.rijen.find(r => r.sleutel === t.dataset.sl); if (rj && rj.uitbeeld) { toast('Deze offerte staat uit beeld: zet hem eerst terug.'); teken(); return; }
        if (rj && rj.afwijkt) { toast('Het bedrag wijkt af van Moneybird: werk eerst het bedrag bij.'); teken(); return; }
        const cc = F.parseBedrag(t.value); if (cc == null) { toast('Dit is geen bedrag. Typ bijvoorbeeld 2.500 of 2500,50.'); teken(); return; }
        wijzig(t.dataset.sl, (it, ov) => F.zetCel(it, ov, t.dataset.ym, cc, st.data.vandaag, { behoudAan: !!rj && behoudAanVoor(rj) }), 'Opgeslagen — Financiën rekent mee');
      } else if (t.dataset && t.dataset.aan) {
        const aan = t.checked, sl = t.dataset.aan, rij = st.rijen.find(r => r.sleutel === sl);
        if (aan && rij && rij.afwijkt) { toast('Het bedrag wijkt af van Moneybird: werk eerst het bedrag bij voordat ‘Gaat zeker door’ aan kan.'); teken(); return; }
        wijzig(sl, it => F.zetAan(it, aan), aan ? 'Gaat zeker door — telt mee in de prognose van Financiën' : 'Gaat niet meer zeker door — telt niet meer mee, ook niet in Financiën');
        void rij;
      } else if (t.dataset && t.dataset.kies) { if (st.keuze) { if (t.checked) st.keuze.add(t.dataset.kies); else st.keuze.delete(t.dataset.kies); teken(); }
      } else if (t.dataset && t.dataset.bulkreden) { st.bulkReden = t.value;
      } else if (t.dataset && t.dataset.kosten) { st.kostenAan = t.checked; ls.set('mtg:fc:kosten:' + st.wie, t.checked ? '1' : '0'); teken(); }
      else if (t.dataset && t.dataset.open) { st.openAan = t.checked; ls.set('mtg:fc:open:' + st.wie, t.checked ? '1' : '0'); teken(); }
      else if (t.dataset && t.dataset.overig) { st.overigAan = t.checked; ls.set('mtg:fc:overig:' + st.wie, t.checked ? '1' : '0'); teken(); }
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches && e.target.matches('input.mtf-in')) e.target.blur(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (st.pop) closePop(true); if (st.menu) zetMenu(false); if (st.rijmenu) closeRijMenu(true); } });
    el.addEventListener('input', e => { if (st.pop && e.target.matches && e.target.matches('input.mtf-in') && e.target.dataset.sl === st.pop.sl && e.target.dataset.ym === st.pop.ym) st.pop.zet(e.target.value); });
    window.addEventListener('resize', () => { if (st.pop) closePop(true); if (st.rijmenu) closeRijMenu(true); pasHoogte(); if (st.scrollBij) st.scrollBij(); });
    document.addEventListener('scroll', () => { if (st.pop) closePop(true); if (st.rijmenu) closeRijMenu(true); }, true);          // scrollen van het tabelvak of de pagina sluit het paneel en het menu
    document.addEventListener('pointerdown', e => { if (st.rijmenu && !st.rijmenu.contains(e.target) && !(e.target.closest && e.target.closest('[data-rijmenu]'))) closeRijMenu(); });
    document.addEventListener('pointerdown', e => { if (st.menu && !(e.target.closest && e.target.closest('.mtf-menuwrap'))) zetMenu(false); });
    document.addEventListener('pointerdown', e => { if (st.pop && st.pop.el && !st.pop.el.contains(e.target) && !(e.target.closest && e.target.closest('input.mtf-in'))) closePop(); });
    el.addEventListener('click', e => {
      const inv = e.target.closest && e.target.closest('input.mtf-in'); if (inv && st.mag && !st.verouderd) { if (!st.pop || st.pop.sl !== inv.dataset.sl || st.pop.ym !== inv.dataset.ym) openPop(inv); return; }
      const k = e.target.closest && e.target.closest('button'); if (!k) return;
      const d = k.dataset;
      if (d.ubopnieuw && st.mag && !st.verouderd) ubOpnieuw();
      else if (d.ubsluit) { st.uitbeeldMelding = null; teken(); }
      else if (d.scroll) { const sc = st.el.querySelector('.mtf-scroll'); if (sc) { const kol = sc.querySelector('thead th.mnd'), vastB = (sc.querySelector('thead th.s') || {}).offsetWidth || 0, stap = e.shiftKey ? Math.max(120, sc.clientWidth - vastB - 40) : (kol ? kol.offsetWidth : 110); sc.scrollBy({ left: Number(d.scroll) * stap, behavior: 'smooth' }); } }
      else if (d.passend) { st.passend = !st.passend; ls.set('mtg:fc:passend:' + st.wie, st.passend ? '1' : '0'); teken(); }
      else if (d.rijmenu) { const rij = st.rijen.find(r => r.sleutel === d.rijmenu); if (rij && st.mag && !st.verouderd) openRijMenu(k, rij); }
      else if (d.selecteren) { st.keuze = new Set(); teken(); }
      else if (d.keuzeuit) { st.keuze = null; teken(); }
      else if (d.kiesalle) { st.keuze = new Set(F.zichtbaar(st.rijen, [...st.filter]).zichtbaar.filter(r => r.estimateId && !r.uitbeeld).map(r => r.sleutel)); teken(); }
      else if (d.bulk) bulkFlow();
      else if (d.terug && st.mag && !st.verouderd) terugzetten(d.terug);
      else if (d.aandacht) { const nu0 = st.aandachtOpen == null ? st.weergave !== 'vast' : st.aandachtOpen; st.aandachtOpen = !nu0; teken(); }
      else if (d.weergave) { st.weergave = st.weergave === 'vast' ? 'lang' : 'vast'; ls.set('mtg:fc:weergave:' + st.wie, st.weergave); teken(); }
      else if (d.filter) { if (st.filter.has(d.filter)) st.filter.delete(d.filter); else st.filter.add(d.filter); ls.set('mtg:fc:filter:' + st.wie, [...st.filter].join(',')); teken(); }
      else if (d.schemas) { zetMenu(false); openSchemaPaneel(); }
      else if (d.schema && st.mag && !st.verouderd) {
        const rij = st.rijen.find(r => r.sleutel === d.schema); if (!rij || rij.afwijkt) return;
        const sch = F.kiesSchema(rij.contactId, rij.totaalC, st.fs, st.cfg && st.cfg.prognose_schema);
        wijzig(d.schema, (it, ov) => { const res = F.schemaToepassen(it, ov, sch, st.data.vandaag, { opleverYm: rij.opleverYm, behoudAan: behoudAanVoor(rij) }); if (res.item) toast(`Schema toegepast (${sch.bron === 'klant' ? 'schema van deze klant' : 'standaardschema'}): ${res.delen.map(x => x.label).join(', ')}`); return res; });
      }
      else if (d.eenheid) { if (st.data) { st.sel = F.selNaarEenheid(st.sel, st.data.vandaag.slice(0, 7), d.eenheid); bewaarSel(); teken(); } }
      else if (d.spring) { const nu = st.data.vandaag.slice(0, 7), kol = F.kolommen(F.eenheden(nu, st.sel.eenheid), st.sel)[Number(d.spring)]; if (kol) { st.sel = F.selSchoon({ eenheid: 'maand', i0: kol.van, i1: kol.tot }, F.eenheden(nu, 'maand')); bewaarSel(); teken(); } }
      else if (d.menu) zetMenu(!st.menu)
      else if (d.uitleg) { zetMenu(false); st.uitleg = !st.uitleg; teken(); }
      else if (d.vernieuw) { zetMenu(false); st.bezig = true; teken(); F.laad('schatten'); }
      else if (d.bijwerk && st.mag && !st.verouderd) { const rij = st.rijen.find(r => r.sleutel === d.bijwerk); if (rij && rij.afwijkt) wijzig(d.bijwerk, (it, ov) => F.bijwerkTotaal(it, ov, rij.mbTotaalC, st.data.vandaag), 'Totaal bijgewerkt naar het Moneybird-bedrag'); }
      else if (d.dubbeluit && st.mag && !st.verouderd) wijzig(d.dubbeluit, it => F.zetAan(it, false), 'Dubbel item uitgezet (niet verwijderd)');
      else if (d.rest && st.mag && !st.verouderd) { const rij = st.rijen.find(r => r.sleutel === d.rest), cc = rij && F.restHier(rij, d.ym); if (cc != null) wijzig(d.rest, (it, ov) => F.zetCel(it, ov, d.ym, cc, st.data.vandaag, { behoudAan: behoudAanVoor(rij) }), 'Rest ingepland — Financiën rekent mee'); }
      else if (d.eerder && st.mag && !st.verouderd) wijzig(d.eerder, (it, ov) => F.eerderNaarNu(it, ov, st.data.vandaag), 'Naar de lopende maand gezet');
    });
  }
})(typeof window !== 'undefined' ? window : this);
if (typeof module !== 'undefined' && module.exports && module.exports.MTForecast) module.exports = module.exports.MTForecast;   // node-tests
