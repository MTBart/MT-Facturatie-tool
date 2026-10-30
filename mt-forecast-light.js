// mt-forecast-light.js — tabblad Forecast (light): een schetsschema voor de facturatie (verzoek Mathijs en Bart, 29-10).
// Links de offertes uit Moneybird met hun totaalbedrag, kolommen = maanden, in elk vakje typ je vrij een bedrag. Onderaan staat per maand
// het totaal, rechts per offerte. Meer gebeurt er niet: de bedragen tellen NERGENS anders mee (niet in de prognose, niet in Financiën, niet
// in Moneybird). De uitgebreide Forecast (mt-forecast.js) staat sinds 29-10 bij Financiën.
// Sinds 30-10 (Bart): verkoopfacturen uit Moneybird (alleen lezen) vervangen in hun factuurmaand het schetsbedrag (vast, blauw; de schets blijft
// bewaard), en onder het totaal staat een uitklapbare uitsplitsing met kasregels uit Financiën (inkoop, vaste kosten, patronen, btw) en het netto.
// Opslag: /geld/schets (worker, Durable Object): per offerte { cellen: { 'JJJJ-MM': centen }, zeker }. Bij elk vakje gaat mee wat je zag
// (oud); heeft een collega het intussen gewijzigd, dan weigert de worker (409) en zie je zijn bedrag, zodat nooit iets ongezien overschreven
// wordt. Elke wijziging staat in de historie van de worker. Rekenregels (L.*) zijn zonder DOM te testen; de weergave bouwt met DOM-methoden.
(function (root) {
  'use strict';
  const L = root.MTForecastLight = root.MTForecastLight || {};
  const MND_K = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const AANTAL = 12;                                         // maanden in beeld (de tabel scrolt zijwaarts)
  const maandPlus = (ym, n) => { const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };
  const maandTekst = ym => MND_K[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4);
  const duizend = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  L.maandPlus = maandPlus; L.maandTekst = maandTekst;
  L.maanden = (start, n) => Array.from({ length: n }, (_, i) => maandPlus(start, i));

  // 150000 → "1.500"; 150050 → "1.500,50"; negatief met een echt minteken.
  L.fmt = function (cc) {
    if (cc == null) return '';
    const a = Math.abs(cc), eur = Math.floor(a / 100), ct = a % 100;
    return (cc < 0 ? '\u2212' : '') + duizend(eur) + (ct ? ',' + String(ct).padStart(2, '0') : '');
  };
  // Invoer in een vakje → { c: centen | null (leeg) } of { fout }. Nederlandse notatie ("1.500,50", "1500,5", "1500.50", "€ 1.500"),
  // een minteken mag (creditnota), en "50%" is dat deel van het getoonde offertebedrag (basisC), afgerond op hele centen.
  L.leesInvoer = function (t, basisC) {
    let s = String(t == null ? '' : t).replace(/[€\s]/g, '').replace(/\u2212/g, '-');
    if (s === '') return { c: null };
    const pm = /^(-?)(\d+(?:[.,]\d+)?)%$/.exec(s);
    if (pm) {
      if (!(basisC > 0)) return { fout: 'Percentage kan hier niet: deze offerte heeft geen bedrag.' };
      const p = Number(pm[2].replace(',', '.')); if (!(p > 0) || p > 1000) return { fout: 'Percentage tussen 0 en 1000.' };
      return { c: (pm[1] ? -1 : 1) * Math.round(basisC * p / 100) };
    }
    const neg = s.startsWith('-'); if (neg) s = s.slice(1);
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return { fout: 'Geen geldig bedrag. Typ bijvoorbeeld 5.000 of 2500,50 of 50%.' };
    const c = Math.round(Number(s) * 100);
    if (c > 1e11) return { fout: 'Bedrag te groot.' };
    return { c: neg ? -c : c };
  };

  // ── Verkoopfacturen (Moneybird, alleen lezen; Bart 30-10) ──
  // Een factuur bij een offerte vervangt in zijn factuurmaand het schetsbedrag (het vakje staat dan vast, in de kleur van de status); het
  // schetsbedrag zelf blijft bewaard. Bij de offerte staat wat er nog te factureren is.
  const cent = v => { const n = parseFloat(v); return isFinite(n) ? Math.round(n * 100) : null; };
  L.factuurNorm = function (x) {
    if (!x || x.id == null || String(x.state || '') === 'draft') return null;
    const datum = String(x.invoice_date || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return null;
    const incl = cent(x.total_price_incl_tax_base != null ? x.total_price_incl_tax_base : x.total_price_incl_tax); if (incl == null) return null;
    const excl = cent(x.total_price_excl_tax_base != null ? x.total_price_excl_tax_base : x.total_price_excl_tax), k = x.contact || {};
    return { id: String(x.id), nummer: String(x.invoice_id || ''), contact_id: x.contact_id != null ? String(x.contact_id) : '', klant: String(k.company_name || [k.firstname, k.lastname].filter(Boolean).join(' ') || '').trim(),
      datum, ym: datum.slice(0, 7), inclC: incl, exclC: excl, eid: x.original_estimate_id != null ? String(x.original_estimate_id) : null,
      orig: x.original_sales_invoice_id != null ? String(x.original_sales_invoice_id) : null, ref: String(x.reference || '') };
  };
  // Welke factuur hoort bij welke offerte: door de eigenaar bevestigd of uitgesloten in de uitgebreide forecast (prognose k/x), aangemaakt
  // vanuit de offerte (original_estimate_id), een creditnota volgt zijn factuur, anders hetzelfde contact met het offertenummer in de
  // referentie (alleen als dat precies één offerte is). De rest is "zonder offerte".
  L.koppelFacturen = function (facturen, schatten, prognose) {
    const perEid = {}, los = [], perId = new Map(), bevestigd = new Map(), nee = new Map();
    for (const it of Object.values(prognose || {})) {
      if (!it || !it.estimate_id) continue; const e = String(it.estimate_id);
      for (const k of it.k || []) bevestigd.set(String(k), e);
      for (const k of it.x || []) { const s = nee.get(String(k)) || new Set(); s.add(e); nee.set(String(k), s); }
    }
    const offertes = (schatten || []).filter(s => s && s.nummer && s.nummer.length >= 4 && s.contact_id);
    for (const f of (facturen || []).filter(Boolean).slice().sort((a, b) => (a.orig ? 1 : 0) - (b.orig ? 1 : 0))) {
      const niet = nee.get(f.id) || new Set();
      let eid = bevestigd.get(f.id) || null; if (eid && niet.has(eid)) eid = null;   // uitgesloten wint van bevestigd (tegenstrijdige prognose)
      if (!eid && f.eid && !niet.has(f.eid)) eid = f.eid;
      if (!eid && f.orig && perId.has(f.orig)) eid = perId.get(f.orig);
      if (!eid) { const ref = f.ref.toLowerCase(), kand = offertes.filter(s => s.contact_id === f.contact_id && !niet.has(s.id) && ref.includes(s.nummer.toLowerCase())); if (kand.length === 1) eid = kand[0].id; }
      if (!eid) { los.push(f); continue; }
      perId.set(f.id, eid);
      const g = perEid[eid] = perEid[eid] || { inclC: 0, exclC: 0, maand: {}, facturen: [], klant: f.klant };
      g.inclC += f.inclC; g.exclC += f.exclC == null ? 0 : f.exclC; g.maand[f.ym] = (g.maand[f.ym] || 0) + f.inclC; g.facturen.push(f);
    }
    return { perEid, los };
  };

  // Rijen: elke offerte uit Moneybird (genormaliseerd met MTForecast.schatNorm), plus schets-records van offertes die niet (meer) in de
  // Moneybird-lijst staan (bv. intussen gefactureerd): die blijven zichtbaar zolang er bedragen in staan, zodat er nooit iets uit beeld verdwijnt.
  // fk = L.koppelFacturen(...): gefactureerd per offerte; een factuur van een offerte die niet meer open staat geeft een eigen rij (status gefactureerd).
  L.rijen = function (schatten, schets, uitbeeld, fk) {
    const uit = [], gezien = new Set(), pe = (fk && fk.perEid) || {}; schets = schets || {}; uitbeeld = uitbeeld || {};
    const fst = (gef, inclC) => !gef ? null : inclC != null && gef.inclC < inclC - 100 ? 'deels' : 'gefactureerd';   // €1 marge voor afronding
    for (const s of schatten || []) {
      if (!s || gezien.has(s.id)) continue; gezien.add(s.id);
      const rec = schets[s.id] || null, gef = pe[s.id] || null;
      uit.push({ id: s.id, naam: [s.naam, s.ref].filter(Boolean).join(' \u2014 ') || s.nummer || s.id, nummer: s.nummer, datum: s.datum, status: s.status,
        inclC: s.totaalC, exclC: s.exclC, cellen: (rec && rec.cellen) || {}, zeker: rec && typeof rec.zeker === 'boolean' ? rec.zeker : s.status === 'geaccepteerd',
        uitbeeld: !!uitbeeld[s.id], los: false, gef, fstatus: fst(gef, s.totaalC) });
    }
    for (const [id, rec] of Object.entries(schets)) {
      if (gezien.has(id) || !rec) continue;
      const cellen = rec.cellen || {}; if (!Object.keys(cellen).length && !pe[id]) continue;
      gezien.add(id); const gef = pe[id] || null;
      uit.push({ id, naam: rec.naam || ('Offerte ' + (rec.nummer || id)), nummer: rec.nummer || '', datum: '', status: 'los', inclC: null, exclC: null, cellen,
        zeker: typeof rec.zeker === 'boolean' ? rec.zeker : false, uitbeeld: !!uitbeeld[id], los: true, gef, fstatus: fst(gef, null) });
    }
    for (const [id, gef] of Object.entries(pe)) {
      if (gezien.has(id) || !/^\d{6,25}$/.test(id)) continue;
      const nrs = gef.facturen.map(f => f.nummer).filter(Boolean);
      uit.push({ id, naam: gef.klant || 'Gefactureerde offerte', nummer: '', datum: gef.facturen.map(f => f.datum).sort()[0] || '', status: 'gefactureerd', inclC: null, exclC: null, cellen: {},
        zeker: true, uitbeeld: !!uitbeeld[id], los: true, gef, fstatus: 'gefactureerd', factuurnrs: nrs });
    }
    return uit;
  };
  L.FILTERS = ['geaccepteerd', 'openstaand', 'concept', 'los', 'gefactureerd', 'uitbeeld'];
  L.filter = (rijen, aan) => { const mag = new Set(aan); return rijen.filter(r => r.uitbeeld ? mag.has('uitbeeld') : mag.has(r.status)); };
  L.tel = rijen => { const t = { geaccepteerd: 0, openstaand: 0, concept: 0, los: 0, gefactureerd: 0, uitbeeld: 0 }; for (const r of rijen) { if (r.uitbeeld) t.uitbeeld++; else if (t[r.status] != null) t[r.status]++; } return t; };
  L.bedrag = (r, btw) => btw === 'excl' ? r.exclC : r.inclC;
  // Wat telt in een maand: het gefactureerde bedrag als er in die maand een factuur is (het vakje staat dan vast), anders de schets.
  L.vast = (r, ym) => !!(r.gef && ym in r.gef.maand);
  L.cel = (r, ym) => L.vast(r, ym) ? r.gef.maand[ym] : (r.cellen[ym] || 0);
  // Nog te factureren: het offertebedrag min wat er al gefactureerd is (in dezelfde weergave incl./excl.), nooit onder nul.
  L.nog = (r, btw) => { const b = L.bedrag(r, btw); if (b == null || !r.gef) return null; return Math.max(0, b - (btw === 'excl' ? r.gef.exclC : r.gef.inclC)); };
  L.rijTotaal = (r, maanden) => maanden.reduce((a, m) => a + L.cel(r, m), 0);
  // Totalen onderaan: per maand, het geheel, wat gaat zeker door (gefactureerd telt altijd als zeker), en wat er buiten de getoonde maanden staat.
  L.totalen = function (rijen, maanden) {
    const per = maanden.map(() => 0), zeker = maanden.map(() => 0), inBeeld = new Set(maanden); let buiten = 0;
    for (const r of rijen) {
      maanden.forEach((m, i) => { const v = L.cel(r, m); per[i] += v; if (r.zeker || L.vast(r, m)) zeker[i] += v; });
      const ms = new Set(Object.keys(r.cellen).concat(r.gef ? Object.keys(r.gef.maand) : []));
      for (const m of ms) if (!inBeeld.has(m)) buiten += L.cel(r, m);
    }
    return { per, zeker, som: per.reduce((a, b) => a + b, 0), somZeker: zeker.reduce((a, b) => a + b, 0), buiten };
  };

  // ── Kasregels onder het totaal (Bart 30-10), uit de tijdlijn van Financiën (kas, incl. btw) ──
  // open = openstaande inkoopfacturen (wat wij moeten betalen) · vast = vaste kosten (lonen, energie, water, verzekeringen, hypotheek,
  // abonnementen …) · patroon = vaste patronen (bv. Interprojecten) · overig = btw-aangifte en handmatige posten. Verstuurde verkoopfacturen,
  // de eigen termijnen van de uitgebreide forecast, interne boekingen en de bank tellen hier niet. De indeling per vaste betaling of leverancier
  // staat in /geld/schets (kas.indeling), lonen van de eigenaren in kas.loon; eigen terugkerende posten in kas.posten.
  L.KAS_GROEPEN = ['open', 'vast', 'patroon', 'overig'];
  const VAST_RE = /vattenfall|eneco|essent|greenchoice|vandebron|pwn|vitens|evides|dunea|waternet|verzeker|allianz|nationale.nederlanden|interpolis|centraal beheer|hypothe|ziggo|kpn|odido|t-mobile|delta fiber|moneybird|renewi|rci financial|lease/i;
  L.kasSleutel = e => e.bron === 'patroon' && /^[a-z0-9]{1,20}$/i.test(String(e.patroon_id || '')) ? 'p:' + String(e.patroon_id).toLowerCase()
    : 'n:' + (String(e.tegenpartij || '').toLowerCase().replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80) || 'onbekend');
  L.kasStandaard = e => e.bron === 'patroon' ? 'vast' : e.bron === 'inkoop' ? (VAST_RE.test(String(e.tegenpartij || '')) ? 'vast' : 'open') : 'overig';
  L.LONEN = [['bart', 'Bart'], ['mathijs', 'Mathijs'], ['ilona', 'Ilona']];
  // Zolang er nog nooit een indeling is opgeslagen geldt de startindeling die de worker meegeeft (kas_start, uit KV; met namen en bedragen,
  // dus niet in deze code). Wie opslaat, legt hem vast en kan hem aanpassen. Eigen posten met lev vervallen in een maand met hun echte factuur.
  L.kasEff = (kas, start) => kas || start || null;
  L.loonAanSleutel = k => 'loon' + k.charAt(0).toUpperCase() + k.slice(1);
  L.loonVan = function (sl, naam, kas) {
    const x = kas && kas.loon && kas.loon[sl]; if (x) return x === 'geen' ? null : x;
    if (!sl.startsWith('p:')) return null;
    return /\bwitte\b/i.test(naam) ? 'bart' : /\b(zwiers|mathijs)\b/i.test(naam) ? 'mathijs' : /\bilona\b/i.test(naam) ? 'ilona' : null;
  };
  L.kasRegel = function (e, kas, vandaag) {
    if (!e || e.intern || e.bron === 'bank' || e.saldo_ijkpunt || !e.datum || e.bron === 'verkoop' || e.bron === 'inleg' || (e.bron === 'prognose' && e.termijn_id)) return null;
    const b = Math.round(Math.abs(Number(e.bedrag)) * 100); if (!isFinite(b) || !b) return null;
    const btw = e.bron === 'btw', sl = btw ? 'btw' : L.kasSleutel(e);
    const naam = btw ? 'Btw-aangifte ' + String(e.kwartaal || '').replace('-K', ' K') : (String(e.tegenpartij || '').trim() || 'Onbekend');
    const groep = (!btw && kas && kas.indeling && kas.indeling[sl]) || L.kasStandaard(e), d = String(e.datum).slice(0, 10);
    return { sleutel: sl, naam, groep, c: (e.richting === 'in' ? 1 : -1) * b, ym: (d < vandaag ? vandaag : d).slice(0, 7), loon: groep === 'vast' ? L.loonVan(sl, naam, kas) : null, bron: e.bron };
  };
  // Een eigen post met lev (sleutel van een leverancier, bv. n:vattenfall …) vervalt in een maand waarin van die leverancier al een factuur of betaling staat:
  // de echte factuur telt dan, de post niet (geen dubbeltelling). bezet = L.bezet(events, vandaag).
  // Een vaste betaling (patroon) telt ook onder zijn naam, zodat een post met lev n:<naam> vervalt zodra die betaling als patroon herkend wordt.
  L.bezet = (events, vandaag) => new Set((events || []).map(e => L.kasRegel(e, null, vandaag)).filter(r => r && (r.bron === 'inkoop' || r.bron === 'patroon'))
    .flatMap(r => [r.sleutel + '|' + r.ym, 'n:' + String(r.naam || '').toLowerCase().trim() + '|' + r.ym]));
  L.postRegels = function (kas, maanden, bezet) {
    const uit = [];
    for (const p of (kas && kas.posten) || []) for (const ym of maanden) if (ym >= p.van && (!p.tot || ym <= p.tot) && !(p.lev && bezet && bezet.has(p.lev + '|' + ym))) uit.push({ sleutel: 'post:' + p.id, naam: p.naam, groep: p.groep, c: (p.richting === 'in' ? 1 : -1) * p.bedragC, ym, loon: p.loon || null, bron: 'post' });
    return uit;
  };
  // Per groep per maand de som en de opbouw (voor de mouse-over). aan.loonBart / loonMathijs / loonIlona === false: dat loon telt niet mee.
  L.kasTotalen = function (regels, maanden, aan) {
    aan = aan || {}; const idx = new Map(maanden.map((m, i) => [m, i])), t = {};
    for (const g of L.KAS_GROEPEN) t[g] = { per: maanden.map(() => 0), opbouw: maanden.map(() => new Map()) };
    for (const r of regels || []) {
      const i = idx.get(r.ym); if (i == null || !t[r.groep]) continue;
      if (r.loon && aan[L.loonAanSleutel(r.loon)] === false) continue;
      t[r.groep].per[i] += r.c; const o = t[r.groep].opbouw[i]; o.set(r.naam, (o.get(r.naam) || 0) + r.c);
    }
    return t;
  };
  // Samenvoegen na een 409 (Codex): basis = de indeling toen je het paneel opende, mijn = jouw versie, hun = wat er nu staat. Per regel telt
  // jouw wijziging alleen waar jij iets veranderde; de rest neemt de versie van de collega over. Veranderden jullie dezelfde regel verschillend,
  // dan is dat een botsing (wordt gemeld; pas na "Toch opslaan" wint jouw keuze). Posten: jouw toegevoegde en verwijderde posten op hun lijst.
  L.kasSamenvoegen = function (basis, mijn, hun) {
    basis = basis || {}; hun = hun || {}; const uit = { indeling: {}, loon: {}, posten: [] }, botsingen = [];
    for (const veld of ['indeling', 'loon']) {
      const b = basis[veld] || {}, m = mijn[veld] || {}, x = hun[veld] || {};
      for (const k of new Set(Object.keys(b).concat(Object.keys(m), Object.keys(x)))) {
        const ik = m[k] !== b[k], zij = x[k] !== b[k];
        const v = ik ? m[k] : x[k];
        if (ik && zij && m[k] !== x[k]) botsingen.push({ veld, sleutel: k, mijn: m[k] === undefined ? null : m[k], hun: x[k] === undefined ? null : x[k] });
        if (v !== undefined) uit[veld][k] = v;
      }
    }
    const bIds = new Set((basis.posten || []).map(p => p.id)), mIds = new Set((mijn.posten || []).map(p => p.id));
    uit.posten = (hun.posten || []).filter(p => !(bIds.has(p.id) && !mIds.has(p.id))).concat((mijn.posten || []).filter(p => !bIds.has(p.id) && !(hun.posten || []).some(q => q.id === p.id)));
    return { kas: uit, botsingen };
  };
  // Netto resultaat per maand: het totaal per maand, plus (aangevinkt) de facturen zonder offerte en de aangevinkte kasgroepen.
  L.netto = function (per, losPer, kt, aan) {
    aan = aan || {};
    return per.map((v, i) => v + (aan.gef !== false && losPer ? losPer[i] : 0) + L.KAS_GROEPEN.reduce((a, g) => a + (aan[g] !== false && kt && kt[g] ? kt[g].per[i] : 0), 0));
  };
  const SORT_RE = /^(offerte|datum|status|zeker|bedrag|totaal|m:\d{4}-\d{2}):(op|af)$/;
  L.SORT_STANDAARD = { sleutel: 'datum', richting: 'af' };
  L.sortLees = t => { const m = SORT_RE.exec(String(t || '')); return m ? { sleutel: m[1], richting: m[2] } : L.SORT_STANDAARD; };
  const STATUS = ['geaccepteerd', 'openstaand', 'concept', 'los', 'gefactureerd'];
  L.sorteer = function (rijen, sort, btw, maanden) {
    const s = sort || L.SORT_STANDAARD, f = s.richting === 'op' ? 1 : -1, nl = (a, b) => String(a).localeCompare(String(b), 'nl', { numeric: true, sensitivity: 'base' });
    const getal = (a, b) => (a == null) - (b == null) || (a == null ? 0 : a - b);
    const waarde = {
      offerte: (a, b) => nl(a.naam, b.naam), datum: (a, b) => nl(a.datum || '', b.datum || ''), status: (a, b) => STATUS.indexOf(a.status) - STATUS.indexOf(b.status),
      zeker: (a, b) => (a.zeker ? 1 : 0) - (b.zeker ? 1 : 0), bedrag: (a, b) => getal(L.bedrag(a, btw), L.bedrag(b, btw)), totaal: (a, b) => L.rijTotaal(a, maanden) - L.rijTotaal(b, maanden) };
    const cmp = s.sleutel.startsWith('m:') ? (a, b) => L.cel(a, s.sleutel.slice(2)) - L.cel(b, s.sleutel.slice(2)) : waarde[s.sleutel] || waarde.datum;
    const leegAchter = s.sleutel === 'bedrag' ? (a, b) => (L.bedrag(a, btw) == null) - (L.bedrag(b, btw) == null) : () => 0;   // zonder bedrag altijd onderaan
    return rijen.slice().sort((a, b) => leegAchter(a, b) || f * cmp(a, b) || -nl(a.datum || '', b.datum || '') || nl(a.id, b.id));
  };

  if (typeof document === 'undefined') return;   // tests: alleen de rekenregels

  // ── Weergave ─────────────────────────────────────────────────────────────────
  const h = function (tag, attr) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attr || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'data') for (const [d, w] of Object.entries(v)) e.dataset[d] = w; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v; else e.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) { const c = arguments[i]; if (c == null || c === false) continue; for (const x of Array.isArray(c) ? c : [c]) if (x != null && x !== false) e.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); }
    return e;
  };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };
  const nu = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const st = L._st = { el: null, opt: null, mag: false, schatten: null, schattenT: 0, afgekapt: false, schets: null, uitbeeld: {}, start: nu(), btw: 'incl', filter: null, sort: null,
    bezig: false, fout: null, bewaren: new Map(), keten: new Map(), mislukt: new Map(), zekerBezig: new Set(), sessie: Math.random().toString(36).slice(2), laadNr: 0,
    fact: null, factFout: null, factAfgekapt: false, prog: null, fk: null, kas: null, tl: null, tlFout: null, tlBezig: false, kasOpen: false, kasAan: {}, paneel: null };
  const STATUS_TEKST = { geaccepteerd: 'Geaccepteerd', openstaand: 'Openstaand', concept: 'Concept', los: 'Niet meer open', gefactureerd: 'Gefactureerd', uitbeeld: 'Uit beeld' };
  const FSTATUS_TEKST = { deels: 'Deels gefactureerd', gefactureerd: 'Gefactureerd' };
  const KAS_TEKST = { open: 'Openstaande facturen', vast: 'Vaste kosten', patroon: 'Vaste patronen', overig: 'Overige voorspelling', uit: 'Niet meetellen' };
  const KAS_UITLEG = { open: 'Inkoopfacturen die wij nog moeten betalen, per verwachte betaalmaand (uit Financiën)', vast: 'Vaste kosten: lonen, energie (Vattenfall), water (PWN), verzekeringen, hypotheek, abonnementen, lease. Herkend uit de bank en de inkoopfacturen; met Indeling zet je een regel in een andere groep',
    patroon: 'Vaste patronen: terugkerende posten die geen vaste kosten zijn (bv. Interprojecten). Voeg ze toe of zet ze hierheen met Indeling', overig: 'Btw-aangifte (uit het btw-overzicht van Moneybird; het lopende kwartaal telt live op in de maand na het kwartaal) en handmatige posten uit Financiën' };

  function css() {
    if (document.getElementById('mtl-css')) return;
    const s = document.createElement('style'); s.id = 'mtl-css';
    s.textContent = `
.mtl,.mtl-toast,.mtl-overlay{--l-fbg:color-mix(in srgb,#3d8fe0 16%,var(--surface,#fff));--l-f:color-mix(in srgb,#1f6bb8 85%,var(--ink,#1b211e));--l-surface:var(--surface,#fff);--l-surface2:var(--surface-2,#f1ede5);--l-line:var(--line,#dfd8cb);--l-soft:var(--line-soft,#ece7de);--l-strong:var(--line-strong,#9a917f);--l-ink:var(--ink,#1b211e);--l-ink2:var(--ink-2,#5e655f);--l-ink3:var(--ink-3,#8c918a);--l-primary:var(--primary,#17643f);--l-psoft:var(--primary-soft,#ddefe3);--l-ptext:var(--primary-text,#17643f);--l-ok:var(--ok,#1a6e3b);--l-okbg:var(--ok-bg,#e3f3e8);--l-warn:var(--warn,#8f5508);--l-warnbg:var(--warn-bg,#fcefd9);--l-err:var(--err,#c4322a);--l-errbg:var(--err-bg,#fce6e4);--l-mono:var(--font-mono,"Geist Mono",ui-monospace,Menlo,monospace);--l-ui:var(--font-ui,"Geist",system-ui,-apple-system,"Segoe UI",sans-serif);--l-head:var(--font-head,"Bricolage Grotesque","Geist",system-ui,sans-serif);--l-r:var(--radius-ctl,4px);--l-rp:var(--radius-panel,8px);--l-pop:var(--shadow-pop,0 24px 60px rgba(40,34,20,.2))}
.mtl{font-family:var(--l-ui);font-size:14px;line-height:20px;color:var(--l-ink);display:flex;flex-direction:column;gap:12px;min-height:360px}
.mtl button{font-family:inherit}
.mtl-kop{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;flex:none}.mtl-titelblok{flex:1;min-width:220px}
.mtl-titel{font-family:var(--l-head);font-size:28px;line-height:32px;font-weight:600;letter-spacing:-.015em;margin:0}
.mtl-sub{margin:2px 0 0;font-size:13px;color:var(--l-ink2)}
.mtl-acties{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mtl-seg{display:inline-flex}.mtl-seg .ui-knop{border-radius:0;margin-left:-1px}.mtl-seg .ui-knop:first-child{border-radius:var(--l-r) 0 0 var(--l-r);margin-left:0}.mtl-seg .ui-knop:last-child{border-radius:0 var(--l-r) var(--l-r) 0}
.mtl-kaart{background:var(--l-surface);border:1px solid var(--l-line);border-radius:var(--l-rp);flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.mtl-balk{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--l-line);flex:none}
.mtl-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:var(--l-r);border:1px solid var(--l-line);background:var(--l-surface);color:var(--l-ink3);font-size:12px;font-weight:500;cursor:pointer}
.mtl-chip:hover{background:var(--l-surface2)}.mtl-chip[aria-pressed=true]{background:var(--l-psoft);border-color:var(--l-psoft);color:var(--l-ptext)}.mtl-tel{font-family:var(--l-mono);font-size:11px;opacity:.75}
.mtl-nav{display:inline-flex;align-items:center;gap:4px;margin-left:auto}.mtl-nav .ui-knop{height:28px;padding:0 10px;font-size:12px}.mtl-periode{font-size:12px;color:var(--l-ink2);margin:0 6px;white-space:nowrap}
.mtl-scroll{flex:1 1 auto;min-height:0;overflow:auto;position:relative;scrollbar-width:thin;scrollbar-color:var(--l-strong) var(--l-surface2)}
.mtl-tabel{border-collapse:separate;border-spacing:0;min-width:100%;min-height:100%;font-size:13px}
.mtl-tabel tr.vul td,.mtl-tabel tr.vul th{height:100%;padding:0;border-bottom:0}.mtl-tabel tbody tr.vul:hover td,.mtl-tabel tbody tr.vul:hover th{background:var(--l-surface)}
.mtl-tabel th,.mtl-tabel td{padding:4px 8px;border-bottom:1px solid var(--l-soft);white-space:nowrap;text-align:right;vertical-align:middle;background:var(--l-surface)}
.mtl-tabel thead th{position:sticky;top:0;z-index:3;font-size:12px;font-weight:500;color:var(--l-ink2);border-bottom:1px solid var(--l-line);height:38px}
.mtl-tabel .s{position:sticky;left:0;z-index:2;text-align:left;min-width:300px;max-width:320px;white-space:normal;box-shadow:1px 0 0 var(--l-soft)}
.mtl-tabel thead th.s{z-index:5}.mtl-tabel tfoot th.s{z-index:5}
.mtl-tabel .num{font-family:var(--l-mono);font-variant-numeric:tabular-nums}
.mtl-tabel th.nu,.mtl-tabel td.nu{background:var(--l-surface2)}.mtl-tabel th.nu{color:var(--l-ptext)}
.mtl-tabel tbody tr:not(.vul){height:42px}.mtl-tabel tbody tr:hover td,.mtl-tabel tbody tr:hover th{background:color-mix(in srgb,var(--l-surface2) 55%,var(--l-surface))}
.mtl-tabel tfoot th,.mtl-tabel tfoot td{position:sticky;z-index:3;font-weight:600;color:var(--l-ink);height:34px;box-sizing:border-box}
.mtl-tabel tfoot tr.som th,.mtl-tabel tfoot tr.som td{bottom:28px;border-top:1px solid var(--l-strong)}
.mtl-tabel tfoot tr.zeker th,.mtl-tabel tfoot tr.zeker td{bottom:0;height:28px;font-weight:400;color:var(--l-ink2);font-size:12px;border-bottom:0}
.mtl-naam b{display:block;font-weight:500;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:290px}
.mtl-naam a{color:inherit;text-decoration:none}.mtl-naam a:hover,.mtl-naam a:focus-visible{color:var(--l-primary);text-decoration:underline}
.mtl-mbd{display:none}.mtl-meta{display:flex;gap:4px 8px;align-items:center;flex-wrap:wrap;font-size:11px;line-height:16px;color:var(--l-ink3)}
.mtl-st{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:var(--l-r);font-size:11px;font-weight:500}
.mtl-st.geaccepteerd{color:var(--l-ok);background:var(--l-okbg)}.mtl-st.openstaand{color:var(--l-warn);background:var(--l-warnbg)}.mtl-st.concept,.mtl-st.los,.mtl-st.uitbeeld{color:var(--l-ink2);background:var(--l-surface2)}
.mtl-tabel .zk{width:72px;min-width:72px;text-align:center}.mtl-tabel .bd{min-width:96px;color:var(--l-ink2)}.mtl-tabel .tot{min-width:96px;font-weight:500;box-shadow:inset 1px 0 0 var(--l-line)}
.mtl-sw{position:relative;display:inline-block;width:34px;height:20px;vertical-align:middle;cursor:pointer}.mtl-sw input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;z-index:1}
.mtl-sw span{position:absolute;inset:0;border-radius:10px;background:var(--l-strong);transition:background .15s}.mtl-sw span::after{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:var(--l-surface);box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
.mtl-sw input:checked+span{background:var(--l-primary)}.mtl-sw input:checked+span::after{transform:translateX(14px)}.mtl-sw input:focus-visible+span{outline:2px solid var(--l-primary);outline-offset:2px}.mtl-sw input:disabled{cursor:not-allowed}.mtl-sw input:disabled+span{opacity:.45}
.mtl-in{width:96px;height:28px;box-sizing:border-box;text-align:right;border:1px solid var(--l-soft);border-radius:var(--l-r);padding:0 6px;background:var(--l-surface);color:var(--l-ink);font:inherit;font-family:var(--l-mono);font-variant-numeric:tabular-nums}
.mtl-in::placeholder{color:var(--l-ink3);opacity:.6}.mtl-in:hover:not(:disabled){border-color:var(--l-strong)}.mtl-in:focus{outline:2px solid var(--l-primary);outline-offset:1px;border-color:var(--l-strong)}
.mtl-in.bewaren{color:var(--l-ink3)}.mtl-in.fout{border-color:var(--l-err);background:var(--l-errbg)}.mtl-in:disabled{background:transparent;border-color:transparent;cursor:default}
.mtl-sortknop{border:0;background:none;font:inherit;color:inherit;cursor:pointer;padding:2px 4px;border-radius:var(--l-r);white-space:nowrap}.mtl-sortknop:hover{background:var(--l-surface2);color:var(--l-ink)}.mtl-sortknop.actief{color:var(--l-ink);font-weight:600}
.mtl-sortrij{display:flex;gap:2px;align-items:center;flex-wrap:wrap}.mtl-0{color:var(--l-ink3);font-weight:400}
.mtl-melding{padding:24px;color:var(--l-ink2)}.mtl-fout{padding:10px 14px;border:1px solid var(--l-err);background:var(--l-errbg);color:var(--l-err);border-radius:var(--l-rp);font-size:13px;flex:none}
.mtl-voet{font-size:12px;color:var(--l-ink3);flex:none}
.mtl-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--l-surface);color:var(--l-ink);border:1px solid var(--l-line);box-shadow:var(--l-pop);padding:10px 16px;border-radius:var(--l-rp);font-family:var(--l-ui);font-size:13px;z-index:9999;max-width:90vw}
.mtl-toast button{margin-left:12px;border:0;background:none;color:var(--l-primary);font:inherit;font-weight:600;cursor:pointer;padding:0;text-decoration:underline}
.mtl-tabel tfoot tr.k th,.mtl-tabel tfoot tr.k td{height:28px;font-weight:400;font-size:12px;color:var(--l-ink2)}
.mtl-tabel tfoot tr.k.uit td{opacity:.4}.mtl-somkop{display:flex;align-items:center;gap:8px;white-space:nowrap}.mtl-sub0{padding-left:2px}
.mtl-tabel tfoot tr.netto th,.mtl-tabel tfoot tr.netto td{height:34px;border-top:1px solid var(--l-strong);border-bottom:0;font-weight:600}
.mtl-uitklap{display:inline-flex;align-items:center;gap:8px;border:0;background:none;font:inherit;font-weight:600;color:var(--l-ink);cursor:pointer;padding:3px 6px;margin-left:-6px;border-radius:var(--l-r)}.mtl-uitklap:hover,.mtl-uitklap[aria-expanded="true"]{background:var(--l-surface2)}.mtl-uitklap:focus-visible{outline:2px solid var(--l-primary);outline-offset:1px}.mtl-meer{color:var(--l-ink3);font-size:15px;line-height:1;min-width:14px;text-align:center}.mtl-uitklap:hover .mtl-meer{color:var(--l-ink)}
.mtl-link{border:0;background:none;color:var(--l-primary);font:inherit;font-size:12px;cursor:pointer;text-decoration:underline;padding:0 4px}.mtl-link:disabled{color:var(--l-ink3);cursor:default;text-decoration:none}
.mtl-vink{display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}.mtl-vink input{margin:0}
.mtl-vinkrij{display:flex;align-items:center;gap:12px}.mtl-loon{display:inline-flex;gap:8px;align-items:center;color:var(--l-ink3);font-size:11px}.mtl-kasfout{color:var(--l-err);font-size:12px}
.mtl-st.f-deels,.mtl-st.f-gefactureerd,.mtl-st.gefactureerd{color:var(--l-f);background:var(--l-fbg)}
.mtl-tabel td.gef,.mtl-tabel tbody tr:hover td.gef{background:var(--l-fbg)}
.mtl-gefcel{display:inline-block;width:96px;box-sizing:border-box;padding:0 7px;color:var(--l-f);font-weight:500;text-decoration:none;line-height:28px}a.mtl-gefcel:hover,a.mtl-gefcel:focus-visible{text-decoration:underline}
.mtl-nog{font-size:11px;line-height:14px;color:var(--l-f);font-family:var(--l-ui)}.mtl-nog.klaar{color:var(--l-ink3)}
.mtl-overlay{position:fixed;inset:0;background:rgba(20,18,12,.35);z-index:9998;display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px;overflow:auto;box-sizing:border-box}
.mtl-paneel{background:var(--l-surface);color:var(--l-ink);border:1px solid var(--l-line);border-radius:var(--l-rp);box-shadow:var(--l-pop);width:min(900px,100%);font-family:var(--l-ui);font-size:13px;display:flex;flex-direction:column;max-height:88vh}
.mtl-paneel h2{font-family:var(--l-head);font-size:20px;line-height:26px;font-weight:600;margin:0}.mtl-paneel h3{font-size:13px;margin:16px 0 4px}
.mtl-pkop{padding:16px 20px;border-bottom:1px solid var(--l-line)}.mtl-pkop p{margin:4px 0 0;color:var(--l-ink2);font-size:12px}.mtl-pinhoud{padding:8px 20px 16px;overflow:auto}.mtl-pinhoud p{margin:0 0 6px;font-size:12px}
.mtl-ptabel{width:100%;border-collapse:collapse}.mtl-ptabel th,.mtl-ptabel td{padding:4px 6px;border-bottom:1px solid var(--l-soft);text-align:left;vertical-align:middle}.mtl-ptabel th{font-weight:500;color:var(--l-ink2);font-size:12px}.mtl-ptabel .num{text-align:right;font-family:var(--l-mono)}
.mtl-paneel select,.mtl-paneel input{font:inherit;height:28px;box-sizing:border-box;border:1px solid var(--l-line);border-radius:var(--l-r);background:var(--l-surface);color:var(--l-ink);padding:0 6px}
.mtl-pnieuw{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px}.mtl-pvoet{padding:12px 20px;border-top:1px solid var(--l-line);display:flex;gap:8px;justify-content:flex-end}
.mtl-tabel tfoot tr.netto.onv td{color:var(--l-warn);font-style:italic}
@media (max-width:700px){
.mtl-mbd{display:inline;width:100%;font-family:var(--l-mono);font-variant-numeric:tabular-nums;color:var(--l-ink2)}.mtl{gap:8px}.mtl-kop{align-items:flex-start;gap:6px}.mtl-titelblok{min-width:0}.mtl-titel{font-size:23px;line-height:28px}.mtl-sub{font-size:11px;line-height:15px;margin-top:1px}.mtl-acties{width:100%;gap:4px;flex-wrap:nowrap;overflow-x:auto;padding-bottom:1px}.mtl-acties .ui-knop{min-height:36px;padding:0 8px;font-size:12px;white-space:nowrap}.mtl-acties .mtl-seg{flex:none}
.mtl-balk{padding:8px;gap:6px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.mtl-balk::-webkit-scrollbar{display:none}.mtl-chip,.mtl-nav{flex:none}.mtl-chip{height:30px;padding:0 9px}.mtl-nav{margin-left:0}.mtl-nav .ui-knop{min-height:36px}.mtl-periode{font-size:11px;margin:0 2px}
.mtl-tabel{font-size:12px}.mtl-tabel .s{min-width:118px;max-width:118px}.mtl-tabel .zk{width:36px;min-width:36px;padding-left:2px;padding-right:2px}.mtl-tabel .bd{display:none}.mtl-tabel th,.mtl-tabel td{padding-left:8px;padding-right:8px}.mtl-tabel thead .zk .mtl-sortknop{font-size:0;padding:4px 0}.mtl-tabel thead .zk .mtl-sortknop::after{content:"Zeker";font-size:11px}.mtl-tabel td.num,.mtl-tabel th.num{padding-left:4px;padding-right:4px}.mtl-naam b{max-width:110px;white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;line-height:16px}.mtl-meta{gap:2px;line-height:14px}.mtl-meta>span:not(.mtl-st):not(.mtl-mbd){display:none}.mtl-st{height:17px;padding:0 5px;font-size:10px}.mtl-in,.mtl-gefcel{width:68px}.mtl-in{height:32px}.mtl-gefcel{line-height:32px;padding:0 5px}.mtl-tabel tbody tr:not(.vul){height:52px}
.mtl-tabel.kasopen tfoot th,.mtl-tabel.kasopen tfoot td{position:static}.mtl-tabel.kasopen tfoot th.s{position:sticky;left:0;bottom:auto!important}.mtl-tabel.kasopen tfoot tr.som th,.mtl-tabel.kasopen tfoot tr.som td{position:sticky;bottom:0!important;z-index:4}.mtl-vinkrij{flex-wrap:wrap;gap:2px 8px;max-width:150px}.mtl-loon{flex-wrap:wrap;gap:2px 8px}.mtl-tabel tfoot tr.k th{height:auto;padding-top:4px;padding-bottom:4px}.mtl-tabel tfoot tr.k th,.mtl-tabel tfoot tr.k td{font-size:11px}.mtl-uitklap{min-height:36px;padding-top:4px;padding-bottom:4px}.mtl-somkop{gap:2px 4px;flex-wrap:wrap;white-space:normal}.mtl-tabel tfoot th.s .mtl-uitklap{font-size:12px;gap:4px;margin-left:-4px;padding-left:4px;padding-right:4px;text-align:left}.mtl-voet{font-size:11px;line-height:15px;max-height:30px;overflow:auto;padding-right:4px}.mtl-lang{display:none}
.mtl-overlay{padding:8px;align-items:flex-start}.mtl-paneel{max-height:calc(100vh - 16px);border-radius:var(--l-rp)}.mtl-pkop{padding:12px}.mtl-pkop h2{font-size:18px;line-height:23px}.mtl-pinhoud{padding:8px 12px 12px}.mtl-ptabel{min-width:560px}.mtl-paneel select,.mtl-paneel input{height:36px}.mtl-pnieuw{display:grid;grid-template-columns:1fr;gap:8px}.mtl-pnieuw>input,.mtl-pnieuw>select,.mtl-pnieuw>.ui-knop{width:100%;min-height:36px}.mtl-pvoet{padding:10px 12px}.mtl-pvoet .ui-knop{min-height:36px}
}
`;
    document.head.appendChild(s);
  }
  let toastTimer = null;
  function toast(tekst, actie) {
    document.querySelectorAll('.mtl-toast').forEach(x => x.remove()); clearTimeout(toastTimer);
    const t = h('div', { class: 'mtl-toast', role: 'status' }, tekst, actie ? h('button', { type: 'button', onclick: () => { t.remove(); actie.fn(); } }, actie.label) : null);
    document.body.appendChild(t); toastTimer = setTimeout(() => t.remove(), actie ? 12000 : 4500);
  }
  const knop = (tekst, attr) => h('button', Object.assign({ type: 'button', class: 'ui-knop' }, attr), tekst);

  // ── Laden ──
  L.start = function (el, opt) {
    st.el = el; st.opt = opt || {}; st.mag = !!st.opt.magWijzigen; css();
    st.btw = ls.get('mtl:btw') === 'excl' ? 'excl' : 'incl';
    try { const f = JSON.parse(ls.get('mtl:filter') || 'null'); st.filter = Array.isArray(f) ? f.filter(x => L.FILTERS.includes(x)) : null; } catch (e) { st.filter = null; }
    if (!st.filter) st.filter = ['geaccepteerd', 'openstaand', 'los', 'gefactureerd'];
    else if (ls.get('mtl:fv') !== '2' && !st.filter.includes('gefactureerd')) st.filter.push('gefactureerd');   // nieuw filter (30-10): eenmalig aan, anders telt een factuur niet mee
    ls.set('mtl:fv', '2'); ls.set('mtl:filter', JSON.stringify(st.filter));
    try { const k = JSON.parse(ls.get('mtl:kas') || '{}'); st.kasAan = k && typeof k === 'object' ? k.aan || {} : {}; st.kasOpen = !!(k && k.open); } catch (e) { st.kasAan = {}; }
    st.sort = L.sortLees(ls.get('mtl:sort'));
    if (!L._resize) { L._resize = true; window.addEventListener('resize', () => { if (st.el && st.el.isConnected) pasHoogte(); });
      meldLevend(); setInterval(() => meldLevend(), 10000); window.addEventListener('pagehide', () => meldLevend(true));
      window.addEventListener('beforeunload', ev => { if (eigenConcepten() || st.bewaren.size || st.zekerBezig.size) { ev.preventDefault(); ev.returnValue = ''; } }); }
    return L.laad();
  };
  // ── Concepten: wat je typt staat meteen op deze computer (mtl:concept), tot de worker het bevestigt. Herlaad je, sluit je de tab of valt de
  // verbinding weg vóór het opslaan, dan zet herstel() het bij het volgende laden terug: staat er op de server nog wat je zag, dan wordt het
  // alsnog opgeslagen; heeft een collega het intussen gewijzigd, dan wordt het vakje rood met jouw bedrag en kies je zelf (Toch zetten / Esc).
  // Opslag per tabblad: sleutel "<offerte>|<maand>#<sessie>", en elke wijziging leest eerst de actuele stand uit localStorage, zodat twee open
  // tabbladen elkaars concepten nooit overschrijven.
  function leesConcepten() { try { const c = JSON.parse(ls.get('mtl:concept') || '{}'); return c && typeof c === 'object' && !Array.isArray(c) ? c : {}; } catch (e) { return {}; } }
  function schrijfConcepten(m) { ls.set('mtl:concept', JSON.stringify(m)); }
  const ck = sl => sl + '#' + st.sessie;
  function zetConcept(sl, c) { const m = leesConcepten(); m[ck(sl)] = Object.assign({ ts: Date.now() }, c); schrijfConcepten(m); }
  function wisConcept(sl) { const m = leesConcepten(); if (ck(sl) in m) { delete m[ck(sl)]; schrijfConcepten(m); } }
  function heeftConcept(sl) { return ck(sl) in leesConcepten(); }
  function eigenConcepten() { return Object.keys(leesConcepten()).filter(k => k.endsWith('#' + st.sessie)).length; }
  // Open tabbladen melden zich elke 10 s (mtl:levend); bij sluiten of herladen (pagehide) meldt een tabblad zich af. Concepten van een tabblad
  // dat nog leeft laat herstel() met rust (daar wordt misschien nog getypt).
  function leesLevend() { try { const m = JSON.parse(ls.get('mtl:levend') || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } }
  function meldLevend(weg) { const m = leesLevend(), nu = Date.now(); for (const k of Object.keys(m)) if (nu - m[k] > 60000) delete m[k]; if (weg) delete m[st.sessie]; else m[st.sessie] = nu; ls.set('mtl:levend', JSON.stringify(m)); }
  function serverWaarde(id, ym) { const r = st.schets && st.schets[id]; return r && r.cellen && ym in r.cellen ? r.cellen[ym] : null; }
  // Pakt alleen concepten op van tabbladen die niet meer open zijn (eigen tabblad: dat regelt de open pagina zelf). Een opgepakt concept gaat
  // over naar dit tabblad (blijft dus bewaard als ook deze pagina herlaadt). Per vakje telt het nieuwste; een ouder concept voor hetzelfde vakje
  // is door later typen achterhaald. Onleesbare invoer (bv. "1.") gaat niet weg: het vakje wordt rood met die tekst.
  function herstel() {
    const auto = [], botsing = [], onleesbaar = [], levend = leesLevend(), m = leesConcepten(), perSl = {};
    for (const [k, c] of Object.entries(m)) {
      const i = k.lastIndexOf('#'), sl = i > 0 ? k.slice(0, i) : '', ses = i > 0 ? k.slice(i + 1) : '', [id, ym] = sl.split('|');
      if (!c || !/^\d{6,25}$/.test(id || '') || !/^\d{4}-\d{2}$/.test(ym || '')) { delete m[k]; continue; }
      if (ses === st.sessie) continue;
      if (levend[ses] && Date.now() - levend[ses] < 25000) continue;                                      // van een ander tabblad dat nog open is
      if (perSl[sl] && (perSl[sl].c.ts || 0) >= (c.ts || 0)) { delete m[k]; continue; }
      if (perSl[sl]) delete m[perSl[sl].k];
      perSl[sl] = { k, c };
    }
    for (const [sl, { k, c }] of Object.entries(perSl)) {
      delete m[k];
      if (ck(sl) in m || st.bewaren.has(sl)) continue;                                                     // in dit tabblad wordt er al aan gewerkt
      const [id, ym] = sl.split('|'), server = serverWaarde(id, ym);
      let nieuw = c.nieuw;
      if (nieuw === undefined) {
        const rij = rijVan(id), x = L.leesInvoer(c.tekst, rij ? L.bedrag(rij, c.btw || st.btw) : null);
        if (x.fout) { m[ck(sl)] = Object.assign({}, c, { ts: Date.now() }); st.mislukt.set(sl, { tekst: String(c.tekst), oud: server }); onleesbaar.push(sl); continue; }
        nieuw = x.c;
      }
      if (nieuw === server) continue;
      if (server === c.oud && !c.botsing) { m[ck(sl)] = { ts: Date.now(), nieuw, oud: server }; auto.push([id, ym, nieuw, server]); }
      else { m[ck(sl)] = { ts: Date.now(), nieuw, oud: c.oud, botsing: true }; st.mislukt.set(sl, { nieuw, oud: server }); botsing.push([id, ym, nieuw, server]); }
    }
    schrijfConcepten(m);
    for (const x of auto) bewaar(x[0], x[1], x[2], x[3], null);
    if (onleesbaar.length) toast(`${onleesbaar.length === 1 ? 'Eén niet-opgeslagen invoer is' : onleesbaar.length + ' niet-opgeslagen invoeren zijn'} niet als bedrag te lezen. Die vakjes staan rood: verbeter het bedrag, of Esc om weg te gooien.`);
    else
    if (botsing.length === 1) { const [id, ym, nieuw, server] = botsing[0]; toast(`Een niet-opgeslagen bedrag (${nieuw == null ? 'wissen' : L.fmt(nieuw)}, ${maandTekst(ym)}) botst met wat er nu staat (${server == null ? 'leeg' : L.fmt(server)}). Het vakje staat rood; Esc in het vakje gooit het weg.`, { label: 'Toch zetten', fn: () => bewaar(id, ym, nieuw, server, null) }); }
    else if (botsing.length) toast(`${botsing.length} niet-opgeslagen bedragen botsen met wat er nu staat. Die vakjes staan rood: typ opnieuw om op te slaan, of Esc om weg te gooien.`);
    else if (auto.length) toast(`${auto.length === 1 ? 'Eén niet-opgeslagen bedrag' : auto.length + ' niet-opgeslagen bedragen'} van eerder teruggezet en opgeslagen.`);
  }
  // Elke keer dat de tab opent: de schets altijd vers (goedkoop); de offertes uit Moneybird hooguit elke 2 minuten (of met Vernieuwen).
  L.laad = async function (o) {
    if (!st.el) return;
    const nr = ++st.laadNr, offertesOok = (o && o.vers) || !st.schatten || Date.now() - st.schattenT > 120000;
    st.bezig = true; st.fout = null; teken();
    try {
      // Facturen (Moneybird) en de bevestigde koppelingen (prognose) mogen mislukken: dan staat er een melding en telt alleen de schets.
      const factP = offertesOok && st.opt.facturen ? Promise.all([st.opt.facturen(), st.opt.bron.haal('/geld/prognose').catch(() => null)]).catch(e => ({ fout: String(e.message || e) })) : Promise.resolve(null);
      let [sch, ub, sr, fr] = await Promise.all([st.opt.bron.haal('/geld/schets'), st.opt.bron.haal('/geld/uitbeeld').catch(() => null), offertesOok ? st.opt.schatten() : Promise.resolve(null), factP]);
      if (nr !== st.laadNr) return;
      if (!sch || sch.error || !sch.items) throw new Error((sch && sch.error) || 'de schets is niet te lezen');
      // Eenmalig (de eerste keer dat iemand met schrijfrecht de light opent): de planning uit de uitgebreide Forecast overnemen. De worker vult
      // alleen lege vakjes en doet het nooit twee keer; mislukt het, dan gewoon de volgende keer opnieuw.
      if (sch.import === null && st.mag && !st.importGeprobeerd) {
        st.importGeprobeerd = true;
        let im = null; try { im = await st.opt.bron.haal('/geld/schets/import', { method: 'POST', body: {} }); } catch (e) { im = { error: String(e.message || e) }; }
        if (im && im.ok) {
          const sch2 = await st.opt.bron.haal('/geld/schets'); if (sch2 && sch2.items) sch = sch2;
          const x = im.import || {}; if (!im.al && (x.vakjes || x.offertes)) toast(`De planning uit de uitgebreide forecast is overgenomen: ${x.vakjes} bedragen bij ${x.offertes} offertes${x.zonder_offerte ? ` (${x.zonder_offerte} zonder offerte niet: die staan alleen in de uitgebreide forecast)` : ''}.`);
        } else { st.importGeprobeerd = false; toast('Overnemen uit de uitgebreide forecast lukte nog niet (' + ((im && im.error) || 'geen verbinding') + '); de volgende keer opnieuw.'); }
        if (nr !== st.laadNr) return;
      }
      st.schets = sch.items; ls.set('mtl:kopie', JSON.stringify({ ts: Date.now(), items: sch.items }));   // reservekopie op deze computer
      if (ub && ub.items) st.uitbeeld = ub.items;
      if (sr) { st.schatten = (sr.lijst || []).map(e => root.MTForecast.schatNorm(e)).filter(Boolean); st.afgekapt = !!sr.afgekapt; st.schattenT = Date.now(); }
      // Fail-closed (Codex): mislukt of afgekapt = géén factuurgegevens (ook niet die van een vorige keer); dan telt alleen de schets en zegt de melding dat.
      if (fr && fr.fout) { st.factFout = fr.fout; st.fact = null; }
      else if (Array.isArray(fr)) {
        const [fl, pg] = fr;
        if (fl && fl.afgekapt) { st.fact = null; st.factFout = 'te veel facturen om in één keer te lezen'; }
        else { st.fact = ((fl && fl.lijst) || []).map(L.factuurNorm).filter(Boolean); st.factFout = null; }
        st.prog = pg && pg.items ? pg.items : null;
      }
      if (sch.kas !== undefined) { st.kas = sch.kas; st.kasStart = sch.kas_start || null; st.kasGeladen = true; } else { st.kas = null; st.kasStart = null; st.kasGeladen = false; }   // geen kas in de respons: geen oude of startindeling gebruiken
      st.fk = st.fact ? L.koppelFacturen(st.fact, st.schatten, st.prog) : null;
    } catch (e) { if (nr === st.laadNr) st.fout = String(e.message || e); }
    if (nr !== st.laadNr) return;
    st.bezig = false; teken();
    if (st.kasOpen && !st.fout) laadKas(!!(o && o.vers));
    if (!st.fout && st.schets && st.schatten && st.mag) { herstel(); werkBij(); }
  };

  // ── Opslaan van één vakje ──
  function rijVan(id) { return L.rijen(st.schatten, st.schets, st.uitbeeld, st.fk).find(r => r.id === id) || null; }
  // De tijdlijn van Financiën (kosten, btw) pas laden als de uitsplitsing open staat; zelfde pad als de uitgebreide forecast (gedeelde cache).
  async function laadKas(vers) {
    if (st.tlBezig) return; st.tlBezig = true; st.tlFout = null; werkBij();
    const v = new Date().toISOString().slice(0, 10), dag = n => new Date(Date.parse(v + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
    try {
      const r = await st.opt.bron.haal(`/geld/tijdlijn?van=${dag(-35)}&tot=${dag(364)}&historie=1${vers && st.mag ? '&vers=1' : ''}`);
      if (!r || r.error || !Array.isArray(r.events)) throw new Error((r && r.error) || 'het overzicht van Financiën is niet te lezen');
      // Onvolledig (bv. inkoopfacturen, patronen of btw niet opgehaald): wel tonen, maar duidelijk gemarkeerd; verkoop-meldingen doen hier niet ter zake.
      const onv = (r.waarschuwingen || []).filter(w => w && w.onvolledig && !['prognose', 'verkoop'].includes(w.bron)).map(w => String(w.fout || 'onvolledig'));
      if (r.bronnen && r.bronnen.facturen && r.bronnen.facturen.onvolledig) onv.unshift('inkoopfacturen niet volledig opgehaald');
      if (r.bronnen && r.bronnen.bankmutaties && r.bronnen.bankmutaties.onvolledig) onv.unshift('bankmutaties niet volledig opgehaald');
      st.tl = { events: r.events, vandaag: /^\d{4}-\d{2}-\d{2}$/.test(String(r.vandaag || '')) ? r.vandaag : v, onvolledig: onv };
    } catch (e) { st.tlFout = String(e.message || e); st.tl = null; }   // nooit met de cijfers van een vorige keer verder rekenen
    st.tlBezig = false; teken();
  }
  function kasRegels(ms) {
    if (!st.tl) return null;
    const kas = st.kasGeladen ? L.kasEff(st.kas, st.kasStart) : st.kas;
    return st.tl.events.map(e => L.kasRegel(e, kas, st.tl.vandaag)).filter(Boolean).concat(L.postRegels(kas, ms, L.bezet(st.tl.events, st.tl.vandaag)));
  }
  function bewaarKasStand() { ls.set('mtl:kas', JSON.stringify({ open: st.kasOpen, aan: st.kasAan })); }
  // Per vakje één opslag tegelijk, op volgorde. Loopt er al een opslag voor dit vakje, dan zag je die waarde: die geldt als "oud" (anders gaf
  // snel twee keer wijzigen een vals conflict met jezelf). Mislukt de eerdere, dan weigert de worker ook de volgende (409): niets gaat stil verloren.
  function bewaar(id, ym, nieuw, oud, inp) {
    const sl = id + '|' + ym;
    if (st.bewaren.has(sl)) oud = st.bewaren.get(sl);
    st.bewaren.set(sl, nieuw); st.mislukt.delete(sl); if (inp) { inp.classList.add('bewaren'); inp.classList.remove('fout'); }
    // kwam de vorige opslag niet aan (netwerk), dan staat op de server nog wat díe zag: die waarde is dan de juiste "oud"
    const job = (st.keten.get(sl) || Promise.resolve()).then(vorige => stuur(id, ym, nieuw, vorige && vorige.netwerk ? vorige.oud : oud, inp, sl, job));
    st.keten.set(sl, job);
    return job;
  }
  async function stuur(id, ym, nieuw, oud, inp, sl, job) {
    const rij = rijVan(id);
    let r; try { r = await st.opt.bron.haal('/geld/schets', { method: 'POST', body: { eid: id, ym, bedrag: nieuw, oud, naam: rij ? rij.naam : undefined, nummer: rij && rij.nummer ? rij.nummer : undefined } }); } catch (e) { r = { error: String(e.message || e) }; }
    const laatste = st.keten.get(sl) === job;
    if (laatste) { st.keten.delete(sl); st.bewaren.delete(sl); }
    if (r && r.ok && r.item) { if (laatste) wisConcept(sl); st.schets[id] = r.item; ls.set('mtl:kopie', JSON.stringify({ ts: Date.now(), items: st.schets })); werkBij(inp ? undefined : sl); return; }   // vanuit de melding (Toch/Opnieuw): het vakje altijd bijwerken
    if (r && 'huidig' in r) {                                   // een collega was je voor: zijn bedrag tonen, het jouwe niet stilletjes wegschrijven
      if (r.item) st.schets[id] = r.item; else delete st.schets[id];
      if (!laatste) { werkBij(); return; }                    // een nieuwere opslag voor dit vakje volgt en meldt zelf
      if (heeftConcept(sl)) zetConcept(sl, { nieuw, oud, botsing: true });   // na herladen: rood + zelf kiezen, nooit automatisch over de collega heen
      werkBij(sl);
      toast(`Dit vakje (${maandTekst(ym)}) was intussen gewijzigd${r.item && r.item.door ? ' door ' + r.item.door : ''}: nu ${r.huidig == null ? 'leeg' : L.fmt(r.huidig)}. Jouw ${nieuw == null ? 'wissen' : L.fmt(nieuw)} is niet opgeslagen.`,
        { label: nieuw == null ? 'Toch wissen' : 'Toch ' + L.fmt(nieuw) + ' zetten', fn: () => bewaar(id, ym, nieuw, r.huidig, null) });
      return;
    }
    if (!laatste) return { netwerk: true, oud };                  // de nieuwere opslag gaat met deze "oud" verder en meldt zelf
    st.mislukt.set(sl, { nieuw, oud }); werkBij();
    toast('Niet opgeslagen: ' + ((r && r.error) || 'geen verbinding') + '. Het vakje staat rood.', { label: 'Opnieuw', fn: () => bewaar(id, ym, nieuw, oud, null) });
    return { netwerk: true, oud };
  }
  // Gaat zeker door: met dezelfde controle als de vakjes (oud = de stand die je zag; null = nog nooit gezet). Bij een conflict of fout springt de
  // schakelaar terug naar wat er echt staat en zie je waarom (met Toch / Opnieuw); tijdens het opslaan waarschuwt de browser bij sluiten.
  async function zetZeker(id, ja, oudOpt) {
    const rij = rijVan(id), rec = st.schets && st.schets[id], oud = oudOpt !== undefined ? oudOpt : rec && typeof rec.zeker === 'boolean' ? rec.zeker : null;
    st.zekerBezig.add(id);
    let r; try { r = await st.opt.bron.haal('/geld/schets', { method: 'POST', body: { eid: id, zeker: ja, oud, naam: rij ? rij.naam : undefined, nummer: rij && rij.nummer ? rij.nummer : undefined } }); } catch (e) { r = { error: String(e.message || e) }; }
    st.zekerBezig.delete(id);
    const wat = (ja ? 'aan' : 'uit') + 'zetten van "Gaat zeker door"' + (rij ? ' (' + rij.naam + ')' : '');
    if (r && r.ok && r.item) st.schets[id] = r.item;
    else if (r && 'huidig' in r) { if (r.item) st.schets[id] = r.item; toast(`Het ${wat} is niet opgeslagen: iemand anders had het intussen ${r.huidig ? 'aan' : 'uit'}gezet.`, { label: 'Toch ' + (ja ? 'aan' : 'uit'), fn: () => zetZeker(id, ja, r.huidig) }); }
    else toast(`Het ${wat} is niet opgeslagen: ${(r && r.error) || 'geen verbinding'}.`, { label: 'Opnieuw', fn: () => zetZeker(id, ja, oud) });
    werkBij();
  }

  // ── Indeling van de kasregels (paneel) ──
  // Per vaste betaling (patroon) of leverancier (inkoopfactuur): in welke groep, en bij een vaste betaling of het een loon van Bart of Mathijs is.
  // Plus eigen terugkerende posten. Je werkt in een kopie; Opslaan stuurt alles in één keer met de versie die je zag (409 = intussen gewijzigd).
  function openIndeling() {
    if (!st.tl) return;
    sluitIndeling();
    const kas = st.kas || {}, kopie = x => JSON.parse(JSON.stringify({ indeling: (x && x.indeling) || {}, loon: (x && x.loon) || {}, posten: (x && x.posten) || [] }));
    // nog nooit opgeslagen: je begint met de startindeling, ook als basis (zodat een 409-samenvoeging die niet als jouw toevoeging ziet)
    let basis = kopie(st.kasGeladen ? L.kasEff(st.kas, st.kasStart) : kas), c = kopie(basis);
    const oudTs = kas.ts == null ? null : kas.ts;
    const regels = new Map();
    for (const e of st.tl.events) {
      const r = L.kasRegel(e, null, st.tl.vandaag); if (!r || (r.bron !== 'patroon' && r.bron !== 'inkoop')) continue;
      const x = regels.get(r.sleutel) || { sleutel: r.sleutel, naam: r.naam, bron: r.bron, standaard: r.groep, loonStd: r.bron === 'patroon' ? L.loonVan(r.sleutel, r.naam, null) : null, bedrag: 0, n: 0 };
      x.n++; if (r.bron === 'patroon') x.bedrag = Math.abs(r.c); else x.bedrag += Math.abs(r.c); regels.set(r.sleutel, x);
    }
    for (const sl of Object.keys(c.indeling).concat(Object.keys(c.loon))) if (!regels.has(sl)) regels.set(sl, { sleutel: sl, naam: sl.slice(2), bron: sl.startsWith('p:') ? 'patroon' : 'inkoop', standaard: sl.startsWith('p:') ? 'vast' : 'open', loonStd: null, bedrag: null, n: 0, weg: true });
    const lijst = [...regels.values()].sort((a, b) => (a.bron === b.bron ? 0 : a.bron === 'patroon' ? -1 : 1) || (b.bedrag || 0) - (a.bedrag || 0));
    const dis = !st.mag;
    const sel = (opties, waarde, wijzig) => { const s = h('select', { disabled: dis, onchange: ev => wijzig(ev.target.value) }, opties.map(([v, t]) => h('option', { value: v }, t))); s.value = waarde; return s; };
    const groepVan = x => c.indeling[x.sleutel] || x.standaard, loonVan = x => { const l = c.loon[x.sleutel]; return l ? (l === 'geen' ? '' : l) : (x.loonStd || ''); };
    const regelTr = x => h('tr', null, h('td', null, x.naam, x.weg ? h('span', { class: 'mtl-0' }, ' (nu niet in beeld)') : null),
      h('td', { class: 'mtl-0' }, x.bron === 'patroon' ? 'vaste betaling' : 'inkoopfactuur'),
      h('td', { class: 'num' }, x.bedrag ? L.fmt(x.bedrag) + (x.bron === 'patroon' ? ' p/m' : '') : ''),
      h('td', null, sel(['open', 'vast', 'patroon', 'overig', 'uit'].map(g => [g, KAS_TEKST[g]]), groepVan(x), v => { if (v === x.standaard) delete c.indeling[x.sleutel]; else c.indeling[x.sleutel] = v; })),
      h('td', null, x.bron === 'patroon' ? sel([['', '—']].concat(L.LONEN.map(([k, n]) => [k, 'Loon ' + n])), loonVan(x), v => { const std = x.loonStd || ''; if (v === std) delete c.loon[x.sleutel]; else c.loon[x.sleutel] = v || 'geen'; }) : null));
    const postBody = h('tbody');
    const tekenPosten = () => postBody.replaceChildren(...(c.posten.length ? c.posten.map(p => h('tr', null, h('td', null, p.naam, p.loon ? h('span', { class: 'mtl-0' }, ' (loon ' + ((L.LONEN.find(l => l[0] === p.loon) || [0, p.loon])[1]) + ')') : null, p.lev ? h('div', { class: 'mtl-0', style: 'font-size:11px' }, 'telt niet in een maand met een factuur van ' + ((regels.get(p.lev) || { naam: p.lev.slice(2) }).naam)) : null), h('td', null, KAS_TEKST[p.groep]), h('td', null, p.richting === 'in' ? 'ontvangst' : 'betaling'),
      h('td', { class: 'num' }, L.fmt(p.bedragC) + ' p/m'), h('td', null, maandTekst(p.van) + ' – ' + (p.tot ? maandTekst(p.tot) : 'doorlopend')),
      h('td', null, dis ? null : h('button', { type: 'button', class: 'mtl-link', 'aria-label': 'Post ' + p.naam + ' verwijderen', onclick: () => { c.posten = c.posten.filter(q => q !== p); tekenPosten(); } }, 'verwijderen')))) : [h('tr', null, h('td', { colspan: '6', class: 'mtl-0' }, 'Nog geen eigen posten.'))]));
    tekenPosten();
    const f = { naam: h('input', { type: 'text', maxlength: '60', placeholder: 'bv. Interprojecten', 'aria-label': 'Naam' }), groep: sel([['patroon', KAS_TEKST.patroon], ['vast', KAS_TEKST.vast], ['overig', KAS_TEKST.overig]], 'patroon', () => { }),
      richting: sel([['uit', 'betaling'], ['in', 'ontvangst']], 'uit', () => { }), bedrag: h('input', { type: 'text', inputmode: 'decimal', placeholder: 'per maand', 'aria-label': 'Bedrag per maand', style: 'width:100px' }),
      van: h('input', { type: 'month', value: nu(), 'aria-label': 'Vanaf maand' }), tot: h('input', { type: 'month', 'aria-label': 'Tot en met maand (leeg = doorlopend)' }),
      loon: sel([['', 'geen loon']].concat(L.LONEN.map(([k, n]) => [k, 'loon ' + n])), '', () => { }),
      lev: sel([['', 'niet gekoppeld aan een leverancier']].concat(lijst.filter(x => !x.weg).map(x => [x.sleutel, 'vervalt bij factuur van ' + x.naam])), '', () => { }) };
    const voegToe = () => {
      const naam = f.naam.value.trim(), x = L.leesInvoer(f.bedrag.value, null), van = f.van.value, tot = f.tot.value || null;
      if (!naam) return toast('Geef de post een naam.'); if (x.fout || !(x.c > 0)) return toast('Vul een bedrag per maand in (groter dan 0).');
      if (!/^\d{4}-\d{2}$/.test(van) || (tot && tot < van)) return toast('Kies een geldige begin- en eindmaand.');
      if (c.posten.length >= 100) return toast('Hooguit 100 eigen posten.');
      c.posten.push({ id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), groep: f.groep.value, naam, richting: f.richting.value, bedragC: x.c, van, tot, ...(f.lev.value ? { lev: f.lev.value } : {}), ...(f.loon.value ? { loon: f.loon.value } : {}) });
      f.naam.value = ''; f.lev.value = ''; f.loon.value = ''; f.bedrag.value = ''; f.tot.value = ''; tekenPosten();
    };
    let samengevoegd = null;
    const bewaarIndeling = async (ts) => {
      knopOk.disabled = true;
      let r; try { r = await st.opt.bron.haal('/geld/schets/kas', { method: 'POST', body: { kas: c, oud_ts: ts } }); } catch (e) { r = { error: String(e.message || e) }; }
      knopOk.disabled = false;
      if (r && r.ok && r.kas) { st.kas = r.kas; sluitIndeling(); teken(); toast(samengevoegd ? 'Indeling opgeslagen, samen met de wijziging van ' + samengevoegd + '.' : 'Indeling opgeslagen.'); return; }
      if (r && 'huidig' in r) {                                   // een collega was je voor: samenvoegen, nooit zijn wijzigingen stil terugdraaien
        const wie = (r.huidig && r.huidig.door) || 'een collega', sv = L.kasSamenvoegen(basis, c, r.huidig), nieuwTs = r.huidig ? r.huidig.ts : null;
        st.kas = r.huidig; basis = kopie(r.huidig); c = sv.kas; samengevoegd = wie; tekenPosten();
        if (!sv.botsingen.length) return bewaarIndeling(nieuwTs);
        const naam = k => k.startsWith('p:') || k.startsWith('n:') ? ((st.tl && st.tl.events.map(e => L.kasRegel(e, null, st.tl.vandaag)).find(x => x && x.sleutel === k)) || { naam: k.slice(2) }).naam : k;
        toast(`${wie} heeft intussen ook ${sv.botsingen.map(b => naam(b.sleutel)).join(', ')} anders ingedeeld. Zijn andere wijzigingen zijn overgenomen.`, { label: 'Toch mijn keuze opslaan', fn: () => bewaarIndeling(nieuwTs) });
        return;
      }
      toast('Niet opgeslagen: ' + ((r && r.error) || 'geen verbinding') + '. Jouw wijzigingen staan nog in het paneel.', { label: 'Opnieuw', fn: () => bewaarIndeling(ts) });
    };
    const knopOk = knop('Opslaan', { class: 'ui-knop ui-knop--primair', onclick: () => bewaarIndeling(oudTs) });
    const paneel = h('div', { class: 'mtl-paneel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Indeling kosten en patronen' },
      h('div', { class: 'mtl-pkop' }, h('h2', null, 'Indeling kosten en patronen'), h('p', null, 'Kies per vaste betaling of leverancier waar hij onder de Forecast telt. Geldt voor de light en de uitgebreide forecast. Er gaat niets naar Moneybird of de bank.')),
      h('div', { class: 'mtl-pinhoud' },
        h('table', { class: 'mtl-ptabel' }, h('thead', null, h('tr', null, h('th', null, 'Naam'), h('th', null, 'Soort'), h('th', { class: 'num' }, 'Bedrag'), h('th', null, 'Groep'), h('th', null, 'Loon'))),
          h('tbody', null, lijst.length ? lijst.map(regelTr) : h('tr', null, h('td', { colspan: '5', class: 'mtl-0' }, 'Geen vaste betalingen of inkoopfacturen in het overzicht.')))),
        h('h3', null, 'Eigen terugkerende posten'),
        h('p', { class: 'mtl-0' }, 'Voor wat de bank niet als vast patroon herkent, zoals Interprojecten of een betalingsregeling. Koppel je de post aan een leverancier, dan telt hij niet in een maand waarin diens echte factuur al staat (geen dubbeltelling).'),
        h('table', { class: 'mtl-ptabel' }, h('thead', null, h('tr', null, h('th', null, 'Naam'), h('th', null, 'Groep'), h('th', null, 'Soort'), h('th', { class: 'num' }, 'Bedrag'), h('th', null, 'Periode'), h('th'))), postBody),
        dis ? null : h('div', { class: 'mtl-pnieuw' }, f.naam, f.groep, f.richting, f.bedrag, f.van, f.tot, f.loon, f.lev, knop('Toevoegen', { onclick: voegToe }))),
      h('div', { class: 'mtl-pvoet' }, knop(dis ? 'Sluiten' : 'Annuleren', { onclick: () => sluitIndeling() }), dis ? null : knopOk));
    const ov = h('div', { class: 'mtl-overlay', onclick: ev => { if (ev.target === ov) sluitIndeling(); } }, paneel);
    ov.addEventListener('keydown', ev => { if (ev.key === 'Escape') sluitIndeling(); });
    document.body.appendChild(ov); st.paneel = ov; (paneel.querySelector('select,input,button') || paneel).focus();
  }
  function sluitIndeling() { if (st.paneel) { st.paneel.remove(); st.paneel = null; } }

  // ── Tekenen ──
  function pasHoogte() {
    const w = st.el && st.el.querySelector('.mtl'); if (!w) return;
    const top = w.getBoundingClientRect().top, hgt = Math.max(420, window.innerHeight - Math.max(0, top) - 16);
    w.style.height = hgt + 'px';
  }
  function maanden() { return L.maanden(st.start, AANTAL); }
  function zichtbareRijen() { return L.sorteer(L.filter(L.rijen(st.schatten, st.schets, st.uitbeeld, st.fk), st.filter), st.sort, st.btw, maanden()); }
  // Na een opslag alleen de cijfers bijwerken (geen hertekening: de focus en een half getypt vakje blijven staan).
  function werkBij(forceer) {
    const t = st.el && st.el.querySelector('.mtl-tabel'); if (!t) return;
    const ms = maanden(), rijen = zichtbareRijen(), perId = new Map(rijen.map(r => [r.id, r]));
    t.querySelectorAll('input.mtl-in').forEach(inp => {
      const r = perId.get(inp.dataset.id); if (!r) return; const sl = inp.dataset.id + '|' + inp.dataset.ym;
      inp.classList.toggle('fout', st.mislukt.has(sl)); inp.classList.toggle('bewaren', st.bewaren.has(sl));
      const v = r.cellen[inp.dataset.ym]; inp.dataset.oud = v == null ? '' : String(v);              // altijd de laatst bekende stand van de server
      if ((document.activeElement === inp && sl !== forceer) || st.bewaren.has(sl)) return;   // niet door iemands getyp heen schrijven
      const m = st.mislukt.get(sl), toon = m ? m.nieuw : v;                                    // rood vakje: jouw niet-opgeslagen bedrag blijft staan
      inp.value = m && m.tekst != null ? m.tekst : toon == null ? '' : L.fmt(toon);
    });
    t.querySelectorAll('td.tot[data-id]').forEach(td => { const r = perId.get(td.dataset.id); if (r) zetGetal(td, L.rijTotaal(r, ms)); });
    t.querySelectorAll('input.mtl-zk').forEach(cb => { const r = perId.get(cb.dataset.id); if (r) cb.checked = r.zeker; });
    const tot = L.totalen(rijen, ms);
    vulVoet(t, tot, ms);
    const v = st.el.querySelector('.mtl-voet'); if (v) v.textContent = voetTekst(tot);
  }
  function zetGetal(td, c) { td.textContent = c ? L.fmt(c) : '\u2013'; td.classList.toggle('mtl-0', !c); }
  // Opbouw voor de mouse-over: grootste posten eerst, hooguit 14 regels.
  function opbouwTekst(kop, m) {
    const xs = [...m.entries()].filter(([, c]) => c).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (!xs.length) return kop + ': niets';
    return kop + ':\n' + xs.slice(0, 14).map(([n, c]) => n + '   ' + L.fmt(c)).join('\n') + (xs.length > 14 ? `\n\u2026 en nog ${xs.length - 14}` : '');
  }
  // Totaalregels onderaan: totaal per maand, gaat zeker door, en (uitgeklapt) gefactureerd, de kasgroepen en het netto resultaat.
  function vulVoet(t, tot, ms) {
    const zet = (rij, per, titel) => {
      const tr = t.querySelector(`tfoot tr[data-rij="${rij}"]`); if (!tr) return;
      tr.querySelectorAll('td[data-i]').forEach(td => { const i = Number(td.dataset.i); if (per) zetGetal(td, per[i]); else { td.textContent = st.tlBezig ? '\u2026' : ''; td.classList.add('mtl-0'); } td.title = per && titel ? titel(i) : ''; });
      const s = tr.querySelector('td.tot'); if (s) { if (per) zetGetal(s, per.reduce((a, b) => a + b, 0)); else s.textContent = ''; }
    };
    zet('som', tot.per); zet('zeker', tot.zeker);
    if (!st.kasOpen) return;
    const idx = new Map(ms.map((m, i) => [m, i])), alle = ms.map(() => new Map()), allePer = ms.map(() => 0), losPer = ms.map(() => 0), losIds = new Set(st.fk ? st.fk.los.map(f => f.id) : []);
    for (const f of st.fact || []) { const i = idx.get(f.ym); if (i == null) continue; allePer[i] += f.inclC; if (losIds.has(f.id)) losPer[i] += f.inclC;
      alle[i].set((f.nummer || 'factuur') + ' ' + (f.klant || '') + (losIds.has(f.id) ? ' (zonder offerte)' : ''), f.inclC); }
    zet('gef', st.fact ? allePer : null, i => opbouwTekst('Gefactureerd in ' + maandTekst(ms[i]) + ' (incl. btw)', alle[i]));
    const regels = kasRegels(ms), kt = regels ? L.kasTotalen(regels, ms, st.kasAan) : null;
    for (const g of L.KAS_GROEPEN) zet(g, kt ? kt[g].per : null, i => opbouwTekst(KAS_TEXT_KORT(g) + ' ' + maandTekst(ms[i]), kt[g].opbouw[i]));
    const onv = st.tl && st.tl.onvolledig.length;
    zet('netto', L.netto(tot.per, st.fact ? losPer : null, kt, st.kasAan), !kt ? () => 'De kosten zijn niet geladen: dit is alleen het totaal' : onv ? () => 'Let op: het overzicht van Financiën is niet compleet, er kunnen kosten ontbreken' : null);
    const nr = t.querySelector('tfoot tr[data-rij="netto"]'); if (nr) nr.classList.toggle('onv', !kt || !!onv);
    t.querySelectorAll('tfoot tr[data-rij]').forEach(tr => { const g = tr.dataset.rij; if (g === 'gef' || L.KAS_GROEPEN.includes(g)) tr.classList.toggle('uit', st.kasAan[g] === false); });
  }
  const KAS_TEXT_KORT = g => KAS_TEKST[g];
  function voetTekst(tot) {
    const d = [];
    if (tot.buiten) d.push(`Buiten deze ${AANTAL} maanden staat nog ${L.fmt(tot.buiten)} (blader met ‹ ›).`);
    if (st.afgekapt) d.push('Let op: niet alle offertes uit Moneybird zijn geladen.');
    if (st.factFout) d.push('De facturen uit Moneybird zijn niet geladen (' + st.factFout + '): alleen de schets telt. Probeer Vernieuwen.');
    if (st.fact) d.push('Een blauw vakje is gefactureerd in Moneybird: dat bedrag telt in die maand in plaats van de schets.');
    d.push('De schets telt nergens anders mee. Typ een bedrag, of een percentage van het offertebedrag (bv. 50%). Leeg maken = wissen.');
    return d.join(' ');
  }
  function sortKnop(sleutel, tekst) {
    const actief = st.sort.sleutel === sleutel, pijl = actief ? (st.sort.richting === 'op' ? ' \u2191' : ' \u2193') : '';
    return h('button', { type: 'button', class: 'mtl-sortknop' + (actief ? ' actief' : ''), 'aria-sort': actief ? (st.sort.richting === 'op' ? 'ascending' : 'descending') : null, title: 'Sorteren op ' + tekst.toLowerCase(),
      onclick: () => { st.sort = { sleutel, richting: actief && st.sort.richting === 'af' ? 'op' : 'af' }; ls.set('mtl:sort', st.sort.sleutel + ':' + st.sort.richting); teken(); } }, tekst + pijl);
  }
  function teken() {
    if (!st.el) return;
    const sl = st.el.querySelector('.mtl-scroll'), sx = sl ? sl.scrollLeft : 0, sy = sl ? sl.scrollTop : 0;
    // wie aan het typen is houdt zijn vakje, tekst en cursor bij een hertekening (bv. Vernieuwen of het laden na het openen van de tab)
    const a = document.activeElement, typ = a && a.classList && a.classList.contains('mtl-in') && st.el.contains(a) ? { id: a.dataset.id, ym: a.dataset.ym, v: a.value, s: a.selectionStart, e: a.selectionEnd } : null;
    const ms = maanden(), dezeMaand = nu();
    const kop = h('div', { class: 'mtl-kop' },
      h('div', { class: 'mtl-titelblok' }, h('h1', { class: 'mtl-titel' }, 'Forecast'), h('p', { class: 'mtl-sub' }, 'Schets van de facturatie per maand. De bedragen tellen alleen hier op.')),
      h('div', { class: 'mtl-acties' },
        h('div', { class: 'mtl-seg', role: 'group', 'aria-label': 'Offertebedrag' }, ['incl', 'excl'].map(b => knop(b + '. btw', { class: 'ui-knop' + (st.btw === b ? ' ui-knop--primair' : ''), 'aria-pressed': String(st.btw === b), title: 'Alleen de kolom Bedrag (offertetotaal uit Moneybird)',
          onclick: () => { st.btw = b; ls.set('mtl:btw', b); teken(); } }))),
        knop('Vernieuwen', { disabled: st.bezig, onclick: () => L.laad({ vers: true }) }),
        st.opt.openUitgebreid ? knop('Uitgebreide forecast', { title: 'De uitgebreide Forecast (met de prognose van Financiën) staat bij Financiën', onclick: () => st.opt.openUitgebreid() }) : null));
    const delen = [kop];
    if (st.fout) delen.push(h('div', { class: 'mtl-fout', role: 'alert' }, 'Kon niet laden: ' + st.fout + ' ', knop('Opnieuw', { onclick: () => L.laad({ vers: true }) })));
    const kaart = h('div', { class: 'mtl-kaart' });
    delen.push(kaart);
    if (!st.schets || !st.schatten) {
      kaart.appendChild(h('div', { class: 'mtl-melding' }, st.bezig ? 'Offertes en schets laden\u2026' : 'Nog niets geladen.'));
    } else {
      const alle = L.rijen(st.schatten, st.schets, st.uitbeeld, st.fk), tel = L.tel(alle), rijen = zichtbareRijen(), tot = L.totalen(rijen, ms);
      kaart.appendChild(h('div', { class: 'mtl-balk' },
        L.FILTERS.filter(f => (f !== 'los' || tel.los) && (f !== 'gefactureerd' || tel.gefactureerd)).map(f => h('button', { type: 'button', class: 'mtl-chip', 'aria-pressed': String(st.filter.includes(f)),
          title: f === 'los' ? 'Offertes die niet meer open staan in Moneybird maar waar nog bedragen in de schets staan' : f === 'gefactureerd' ? 'Offertes die niet meer open staan en waarvan facturen in Moneybird staan' : f === 'uitbeeld' ? 'Offertes die bij de uitgebreide forecast uit beeld zijn gezet' : null,
          onclick: () => { st.filter = st.filter.includes(f) ? st.filter.filter(x => x !== f) : st.filter.concat(f); ls.set('mtl:filter', JSON.stringify(st.filter)); teken(); } }, STATUS_TEKST[f], h('span', { class: 'mtl-tel' }, String(tel[f])))),
        h('div', { class: 'mtl-nav' },
          knop('\u2039', { title: 'Eén maand terug', 'aria-label': 'Eén maand terug', onclick: () => { st.start = maandPlus(st.start, -1); teken(); } }),
          h('span', { class: 'mtl-periode' }, maandTekst(ms[0]) + ' \u2013 ' + maandTekst(ms[ms.length - 1])),
          knop('\u203a', { title: 'Eén maand verder', 'aria-label': 'Eén maand verder', onclick: () => { st.start = maandPlus(st.start, 1); teken(); } }),
          st.start !== dezeMaand ? knop('Vanaf nu', { onclick: () => { st.start = dezeMaand; teken(); } }) : null)));
      const thead = h('thead', null, h('tr', null,
        h('th', { class: 's', scope: 'col' }, h('div', { class: 'mtl-sortrij' }, sortKnop('offerte', 'Offerte'), sortKnop('datum', 'Datum'), sortKnop('status', 'Status'))),
        h('th', { class: 'zk', scope: 'col' }, sortKnop('zeker', 'Gaat zeker door')),
        h('th', { class: 'bd num', scope: 'col' }, sortKnop('bedrag', 'Bedrag ' + st.btw + '.')),
        ms.map(m => h('th', { class: 'num' + (m === dezeMaand ? ' nu' : ''), scope: 'col' }, sortKnop('m:' + m, maandTekst(m)))),
        h('th', { class: 'tot num', scope: 'col' }, sortKnop('totaal', 'Totaal'))));
      const tbody = h('tbody', null, rijen.length ? rijen.map(r => {
        const b = L.bedrag(r, st.btw), href = !r.los && st.opt.administratie ? root.MTForecast.mbUrl(st.opt.administratie(), 'estimates', r.id) : null, nog = L.nog(r, st.btw);
        const fUrl = id => st.opt.administratie ? root.MTForecast.mbUrl(st.opt.administratie(), 'sales_invoices', id) : null;
        const stBadge = r.uitbeeld ? h('span', { class: 'mtl-st uitbeeld' }, 'Uit beeld') : r.fstatus ? h('span', { class: 'mtl-st f-' + r.fstatus, title: 'Gefactureerd ' + L.fmt(r.gef.inclC) + ' incl. btw' + (r.inclC != null ? ' van ' + L.fmt(r.inclC) : '') }, FSTATUS_TEKST[r.fstatus]) : h('span', { class: 'mtl-st ' + r.status }, STATUS_TEKST[r.status]);
        const bdTitel = [r.inclC != null ? 'incl. btw ' + L.fmt(r.inclC) + (r.exclC != null ? ' \u00b7 excl. btw ' + L.fmt(r.exclC) : '') : null, r.gef ? 'gefactureerd ' + L.fmt(r.gef.inclC) + ' incl. btw (' + r.gef.facturen.length + (r.gef.facturen.length === 1 ? ' factuur)' : ' facturen)') : null].filter(Boolean).join('\n') || null;
        return h('tr', null,
          h('th', { class: 's', scope: 'row' }, h('div', { class: 'mtl-naam' }, h('b', { title: r.naam }, href ? h('a', { href, target: '_blank', rel: 'noopener', title: 'Open de offerte in Moneybird' }, r.naam) : r.naam),
            h('div', { class: 'mtl-meta' }, h('span', { class: 'mtl-mbd', title: bdTitel }, b == null ? (r.gef ? L.fmt(r.gef.inclC) : '') : L.fmt(b) + (nog ? ' \u00b7 nog ' + L.fmt(nog) : '')),   // alleen op mobiel (daar valt de kolom Bedrag weg)
              r.nummer ? h('span', null, 'offerte ' + r.nummer) : null, r.factuurnrs && r.factuurnrs.length ? h('span', null, (r.factuurnrs.length === 1 ? 'factuur ' : 'facturen ') + r.factuurnrs.join(', ')) : null,
              r.datum ? h('span', null, r.datum.split('-').reverse().join('-')) : null, stBadge))),
          h('td', { class: 'zk' }, h('label', { class: 'mtl-sw', title: 'Gaat zeker door (alleen voor deze schets)' }, h('input', { type: 'checkbox', class: 'mtl-zk', role: 'switch', data: { id: r.id }, 'aria-label': 'Gaat zeker door: ' + r.naam, disabled: !st.mag, checked: r.zeker, onchange: ev => zetZeker(r.id, ev.target.checked) }), h('span'))),
          h('td', { class: 'bd num', title: bdTitel }, h('div', null, b == null ? (r.gef ? L.fmt(r.gef.inclC) : '\u2013') : L.fmt(b)),
            r.gef ? h('div', { class: 'mtl-nog' + (nog ? '' : ' klaar') }, nog ? 'nog ' + L.fmt(nog) + ' te factureren' : b == null ? 'gefactureerd' : 'alles gefactureerd') : null),
          ms.map(m => { const v = r.cellen[m], sl = r.id + '|' + m;
            if (L.vast(r, m)) {                                         // gefactureerd in deze maand: vast, in de statuskleur; de schets blijft bewaard
              const fs = r.gef.facturen.filter(f => f.ym === m), u = fs.length === 1 ? fUrl(fs[0].id) : null;
              const titel = 'Gefactureerd in Moneybird (incl. btw):\n' + fs.map(f => (f.nummer || 'factuur') + ' van ' + f.datum.split('-').reverse().join('-') + '   ' + L.fmt(f.inclC)).join('\n') + (v != null ? `\nJe schetsbedrag hier (${L.fmt(v)}) blijft bewaard maar telt niet.` : '');
              return h('td', { class: 'num gef' + (m === dezeMaand ? ' nu' : ''), title: titel }, u ? h('a', { class: 'mtl-gefcel', href: u, target: '_blank', rel: 'noopener', 'aria-label': r.naam + ', ' + maandTekst(m) + ': gefactureerd ' + L.fmt(r.gef.maand[m]) }, L.fmt(r.gef.maand[m])) : h('span', { class: 'mtl-gefcel' }, L.fmt(r.gef.maand[m])));
            }
            return h('td', { class: 'num' + (m === dezeMaand ? ' nu' : '') }, h('input', { class: 'mtl-in' + (st.mislukt.has(sl) ? ' fout' : '') + (st.bewaren.has(sl) ? ' bewaren' : ''), type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: st.mag ? '\u2013' : '',
              'aria-label': r.naam + ', ' + maandTekst(m), disabled: !st.mag, data: { id: r.id, ym: m, oud: v == null ? '' : String(v) }, value: st.mislukt.has(sl) ? (st.mislukt.get(sl).tekst != null ? st.mislukt.get(sl).tekst : L.fmt(st.mislukt.get(sl).nieuw)) : v == null ? '' : L.fmt(v) })); }),
          h('td', { class: 'tot num', data: { id: r.id } }));
      }) : h('tr', null, h('td', { class: 's', colspan: String(ms.length + 4), style: 'text-align:left;color:var(--l-ink3)' }, 'Geen offertes met dit filter.')),
        // vulrij: neemt de rest van de hoogte, zodat de totalen ook bij weinig offertes tegen de onderrand staan
        h('tr', { class: 'vul', 'aria-hidden': 'true' }, h('th', { class: 's' }), h('td', { colspan: String(ms.length + 3) })));
      const voetRij = (rij, klasse, label) => h('tr', { class: klasse, data: { rij } }, h('th', { class: 's', scope: 'row' }, label), h('td', { class: 'zk' }), h('td', { class: 'bd num' }),
        ms.map((m, i) => h('td', { class: 'num' + (m === dezeMaand ? ' nu' : ''), data: { i: String(i) } })), h('td', { class: 'tot num' }));
      const vink = (g, tekst, titel) => h('label', { class: 'mtl-vink', title: titel }, h('input', { type: 'checkbox', data: { kas: g }, checked: st.kasAan[g] !== false }), tekst);
      // Dichtgeklapt alleen "Totaal per maand"; een klik erop (of op ⋯) opent de lijst met wat wel en niet meetelt.
      const voet = [voetRij('som', 'som', h('span', { class: 'mtl-somkop' }, h('button', { type: 'button', class: 'mtl-uitklap', 'aria-expanded': String(st.kasOpen),
        title: st.kasOpen ? 'Uitsplitsing dichtklappen' : 'Uitsplitsing openen: gefactureerd, kosten en netto resultaat, met per regel een vinkje of hij meetelt',
        onclick: () => { st.kasOpen = !st.kasOpen; bewaarKasStand(); teken(); if (st.kasOpen && !st.tl) laadKas(false); } }, 'Totaal per maand', h('span', { class: 'mtl-meer', 'aria-hidden': 'true' }, st.kasOpen ? '▾' : '⋯')),
        st.kasOpen ? h('button', { type: 'button', class: 'mtl-link', title: 'Welke vaste betaling of leverancier in welke groep, lonen en eigen terugkerende posten (bv. Interprojecten)', disabled: !st.tl, onclick: () => openIndeling() }, 'Indeling…') : null))];
      if (st.kasOpen) {
        voet.push(voetRij('zeker', 'k', h('span', { class: 'mtl-sub0' }, 'waarvan gaat zeker door')));
        voet.push(voetRij('gef', 'k', vink('gef', 'Gefactureerd', 'Alle verkoopfacturen van die maand (incl. btw; mouse-over per maand voor de lijst). Facturen bij een offerte staan al in het totaal; met het vinkje tellen ook de facturen zonder offerte mee in het netto resultaat.')));
        for (const g of L.KAS_GROEPEN) voet.push(voetRij(g, 'k', g === 'vast' ? h('span', { class: 'mtl-vinkrij' }, vink(g, KAS_TEKST[g], KAS_UITLEG[g]), h('span', { class: 'mtl-loon' }, 'loon', L.LONEN.map(([k, n]) => vink(L.loonAanSleutel(k), n, 'Loon van ' + n + ' meetellen')))) : vink(g, KAS_TEKST[g], KAS_UITLEG[g])));
        voet.push(voetRij('netto', 'netto', h('span', { class: 'mtl-somkop' }, h('span', { title: 'Totaal per maand plus de aangevinkte regels (kosten zijn negatief). Kas, incl. btw.' }, 'Netto resultaat'),
          st.tlFout ? h('span', { class: 'mtl-kasfout', title: st.tlFout }, '⚠ kosten niet geladen ', h('button', { type: 'button', class: 'mtl-link', onclick: () => laadKas(true) }, 'opnieuw')) : null,
          st.tl && st.tl.onvolledig.length ? h('span', { class: 'mtl-kasfout', title: 'Het overzicht van Financiën is niet compleet:\n' + st.tl.onvolledig.slice(0, 10).join('\n') }, '⚠ mogelijk onvolledig ', h('button', { type: 'button', class: 'mtl-link', onclick: () => laadKas(true) }, 'opnieuw')) : null)));
      }
      const tfoot = h('tfoot', null, voet);
      // vast onderaan: elke regel krijgt als bottom de hoogte van de regels eronder
      { let b = 0; for (const tr of voet.slice().reverse()) { for (const c of tr.children) c.style.bottom = b + 'px'; b += tr.classList.contains('som') || tr.classList.contains('netto') ? 34 : 28; } }
      tfoot.addEventListener('change', ev => { const g = ev.target.dataset && ev.target.dataset.kas; if (!g) return; st.kasAan[g] = ev.target.checked; bewaarKasStand(); werkBij(); });
      const tabel = h('table', { class: 'mtl-tabel' + (st.kasOpen ? ' kasopen' : '') }, thead, tbody, tfoot);
      tabel.addEventListener('focusin', ev => { if (ev.target.classList && ev.target.classList.contains('mtl-in')) ev.target.select(); });
      tabel.addEventListener('keydown', toets);
      tabel.addEventListener('change', ev => { if (ev.target.classList && ev.target.classList.contains('mtl-in')) verwerk(ev.target); });
      tabel.addEventListener('input', ev => { if (ev.target.classList && ev.target.classList.contains('mtl-in')) getypt(ev.target); });
      kaart.appendChild(h('div', { class: 'mtl-scroll' }, tabel));
      delen.push(h('div', { class: 'mtl-voet' }, voetTekst(tot)));
    }
    const w = h('div', { class: 'mtl' + (st.bezig ? ' bezig' : '') }, delen);
    st.el.replaceChildren(w);
    werkBij(); pasHoogte();
    const sl2 = st.el.querySelector('.mtl-scroll'); if (sl2) { sl2.scrollLeft = sx; sl2.scrollTop = sy; }
    if (typ) { const i = st.el.querySelector(`input.mtl-in[data-id="${typ.id}"][data-ym="${typ.ym}"]`); if (i && !i.disabled) { i.value = typ.v; i.focus({ preventScroll: true }); try { i.setSelectionRange(typ.s, typ.e); } catch (e) { } } }
  }
  function verwerk(inp) {
    const id = inp.dataset.id, ym = inp.dataset.ym, oud = inp.dataset.oud === '' ? null : Number(inp.dataset.oud), rij = rijVan(id);
    const x = L.leesInvoer(inp.value, rij ? L.bedrag(rij, st.btw) : null);
    const sl = id + '|' + ym;
    if (x.fout) {                                                  // onleesbaar: niets weggooien; de tekst blijft rood staan (en als concept) tot verbeterd of Esc
      st.mislukt.set(sl, { tekst: inp.value, oud }); zetConcept(sl, { tekst: inp.value, btw: st.btw, oud });
      inp.classList.add('fout'); toast(x.fout + ' Het vakje staat rood; verbeter het, of Esc om terug te gaan.'); return;
    }
    inp.value = x.c == null ? '' : L.fmt(x.c);
    const gezien = st.bewaren.has(sl) ? st.bewaren.get(sl) : oud;    // een lopende opslag telt als wat er staat
    if (x.c === gezien && !st.mislukt.has(sl)) { if (!st.bewaren.has(sl)) wisConcept(sl); return; }
    zetConcept(sl, { nieuw: x.c, oud: st.bewaren.has(sl) ? st.bewaren.get(sl) : oud });
    bewaar(id, ym, x.c, oud, inp);
  }
  // Elke toetsaanslag meteen als concept op deze computer (zie herstel), zodat herladen of sluiten vóór het opslaan niets kost.
  function getypt(inp) {
    const sl = inp.dataset.id + '|' + inp.dataset.ym;
    zetConcept(sl, { tekst: inp.value, btw: st.btw, oud: st.bewaren.has(sl) ? st.bewaren.get(sl) : inp.dataset.oud === '' ? null : Number(inp.dataset.oud) });
  }
  // Enter = opslaan en naar het vakje eronder (Shift+Enter: erboven); Escape = terug naar wat er stond.
  function toets(ev) {
    const inp = ev.target; if (!inp.classList || !inp.classList.contains('mtl-in')) return;
    if (ev.key === 'Escape') {                                   // terug naar wat er op de server staat; een rood (niet opgeslagen) bedrag gaat weg
      const o = inp.dataset.oud, sl = inp.dataset.id + '|' + inp.dataset.ym; inp.value = o === '' ? '' : L.fmt(Number(o));
      if (!st.bewaren.has(sl)) { wisConcept(sl); st.mislukt.delete(sl); } inp.blur(); werkBij(sl); return;
    }
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const alle = [...st.el.querySelectorAll(`input.mtl-in[data-ym="${inp.dataset.ym}"]`)], i = alle.indexOf(inp), volgende = alle[i + (ev.shiftKey ? -1 : 1)];
    if (volgende) volgende.focus(); else inp.blur();
  }
})(typeof window !== 'undefined' ? window : globalThis);
