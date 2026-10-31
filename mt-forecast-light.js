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
  L.FILTERS = ['geaccepteerd', 'openstaand', 'concept', 'los', 'gefactureerd', 'afgerond', 'uitbeeld'];
  // Met maanden: helemaal gefactureerd en in die maanden niets meer dat telt = Afgerond (eigen filter, standaard uit).
  L.filter = (rijen, aan, maanden) => { const mag = new Set(aan); return rijen.filter(r => maanden && !L.inBeeld(r, maanden) ? mag.has('afgerond') : r.uitbeeld ? mag.has('uitbeeld') : mag.has(r.status)); };
  L.tel = (rijen, maanden) => { const t = { geaccepteerd: 0, openstaand: 0, concept: 0, los: 0, gefactureerd: 0, afgerond: 0, uitbeeld: 0 }; for (const r of rijen) { if (maanden && !L.inBeeld(r, maanden)) t.afgerond++; else if (r.uitbeeld) t.uitbeeld++; else if (t[r.status] != null) t[r.status]++; } return t; };
  L.bedrag = (r, btw) => btw === 'excl' ? r.exclC : r.inclC;
  // Wat telt in een maand: het gefactureerde bedrag als er in die maand een factuur is (het vakje staat dan vast), anders de schets.
  L.vast = (r, ym) => !!(r.gef && ym in r.gef.maand);
  L.cel = (r, ym) => L.vast(r, ym) ? r.gef.maand[ym] : (r.cellen[ym] || 0);
  // Nog te factureren: het offertebedrag min wat er al gefactureerd is (in dezelfde weergave incl./excl.), nooit onder nul.
  L.nog = (r, btw) => { const b = L.bedrag(r, btw); if (b == null || !r.gef) return null; return Math.max(0, b - (btw === 'excl' ? r.gef.exclC : r.gef.inclC)); };
  // Helemaal gefactureerd (afgerond): alleen in de lijst als er in de getoonde maanden iets van meetelt. Deels gefactureerd blijft altijd staan.
  L.inBeeld = (r, maanden) => r.fstatus !== 'gefactureerd' || maanden.some(m => L.cel(r, m));
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
  L.KAS_GROEPEN = ['open', 'betaald', 'vast', 'patroon', 'overig'];   // betaald = al betaalde facturen (alleen uit de bank: voorbije maanden en deze maand)
  const VAST_RE = /vattenfall|eneco|essent|greenchoice|vandebron|pwn|vitens|evides|dunea|waternet|verzeker|allianz|nationale.nederlanden|interpolis|centraal beheer|hypothe|ziggo|kpn|odido|t-mobile|delta fiber|moneybird|renewi|rci financial|lease/i;
  L.kasSleutel = e => e.bron === 'patroon' && /^[a-z0-9]{1,20}$/i.test(String(e.patroon_id || '')) ? 'p:' + String(e.patroon_id).toLowerCase()
    : 'n:' + (String(e.tegenpartij || '').toLowerCase().replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80) || 'onbekend');
  L.kasStandaard = e => e.bron === 'patroon' ? 'vast' : e.bron === 'inkoop' ? (VAST_RE.test(String(e.tegenpartij || '')) ? 'vast' : 'open') : 'overig';
  L.LONEN = [['bart', 'Bart'], ['mathijs', 'Mathijs'], ['maarten', 'Maarten'], ['ilona', 'Ilona']];
  // Zolang er nog nooit een indeling is opgeslagen geldt de startindeling die de worker meegeeft (kas_start, uit KV; met namen en bedragen,
  // dus niet in deze code). Wie opslaat, legt hem vast en kan hem aanpassen. Eigen posten met lev vervallen in een maand met hun echte factuur.
  L.kasEff = (kas, start) => kas || start || null;
  L.loonAanSleutel = k => 'loon' + k.charAt(0).toUpperCase() + k.slice(1);
  L.loonVan = function (sl, naam, kas) {
    const x = kas && kas.loon && kas.loon[sl]; if (x) return x === 'geen' ? null : x;
    if (!sl.startsWith('p:')) return null;
    return /\bwitte\b/i.test(naam) ? 'bart' : /\b(zwiers|mathijs)\b/i.test(naam) ? 'mathijs' : /\bmaarten\b/i.test(naam) ? 'maarten' : /\bilona\b/i.test(naam) ? 'ilona' : null;
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
  // Termijnen van een betalingsregeling (override afbetaling) tellen niet als factuur: die komen naast de gewone maandfactuur.
  // Een vaste betaling (patroon) telt ook onder zijn naam, zodat een post met lev n:<naam> vervalt zodra die betaling als patroon herkend wordt.
  L.bezet = (events, vandaag) => new Set((events || []).filter(e => !(e && e.override && e.override.type === 'afbetaling')).map(e => L.kasRegel(e, null, vandaag)).filter(r => r && (r.bron === 'inkoop' || r.bron === 'patroon'))
    .flatMap(r => [r.sleutel + '|' + r.ym, 'n:' + String(r.naam || '').toLowerCase().trim() + '|' + r.ym]));
  L.postRegels = function (kas, maanden, bezet) {
    const uit = [];
    for (const p of (kas && kas.posten) || []) for (const ym of maanden) if (ym >= p.van && (!p.tot || ym <= p.tot) && !(p.lev && bezet && bezet.has(p.lev + '|' + ym))) uit.push({ sleutel: 'post:' + p.id, naam: p.naam, groep: p.groep, c: (p.richting === 'in' ? 1 : -1) * p.bedragC, ym, loon: p.loon || null, bron: 'post' });
    return uit;
  };
  // Werkelijk betaald (Bart 30-10): voorbije maanden komen exact uit de bank (worker: historie_maand_partij = per maand uitgaven per tegenpartij,
  // btw-afdracht en ontvangsten; spaarpotten en interne overboekingen tellen niet). Alleen vooruit wordt voorspeld. Een tegenpartij die als vaste
  // betaling herkend is, krijgt de sleutel van dat patroon (zelfde indeling en loonvinkjes); de rest per naam (standaard: vast of facturen).
  L.patNamen = events => { const m = {}; for (const e of events || []) if (e && e.bron === 'patroon' && /^[a-z0-9]{1,20}$/i.test(String(e.patroon_id || '')) && e.tegenpartij) m[String(e.tegenpartij).trim().toLowerCase()] = 'p:' + String(e.patroon_id).toLowerCase(); return m; };
  L.histRegels = function (hist, maanden, kas, patNamen) {
    const uit = [];
    for (const ym of maanden) {
      const h = hist && hist[ym]; if (!h) continue;
      for (const [naam, bedrag] of Object.entries(h.uit || {})) {
        const c = Math.round(Number(bedrag) * 100); if (!isFinite(c) || c <= 0) continue;
        const ps = patNamen && patNamen[naam.trim().toLowerCase()], sl = ps || L.kasSleutel({ tegenpartij: naam });
        let groep = (kas && kas.indeling && kas.indeling[sl]) || (ps ? 'vast' : VAST_RE.test(naam) ? 'vast' : 'open');
        if (groep === 'uit') continue;
        if (groep === 'open') groep = 'betaald';                           // al betaald: nooit onder Openstaande facturen
        uit.push({ sleutel: sl, naam: naam === '(onbekend)' ? 'Verzamelbetalingen en betalingen zonder naam' : naam, groep, c: -c, ym, loon: groep === 'vast' ? L.loonVan(sl, naam, kas) : null, bron: 'bank' });
      }
      const b = Math.round(Number(h.btw || 0) * 100); if (b > 0) uit.push({ sleutel: 'btw:' + ym, naam: 'Btw-aangifte (betaald)', groep: 'overig', c: -b, ym, loon: null, bron: 'bank' });
    }
    return uit;
  };
  L.nettoWerkelijk = (netto, maanden, nu, hist, kt, aan, asOf) => netto.map((v, i) => { const ym = maanden[i]; if (!nu || ym >= nu) return v; const hi = L.histIn(hist, ym); if (hi == null || !L.histCompleet(ym, nu, asOf, false)) return 0;
    return hi + L.KAS_GROEPEN.reduce((a, g) => a + ((aan || {})[g] !== false && kt && kt[g] ? kt[g].per[i] : 0), 0); });
  // Een maand uit de historie is pas compleet als de berekening van ná die maand is; deze maand alleen als hij van vandaag is.
  L.histCompleet = (ym, nu, asOf, vers) => ym === nu ? !!vers : ym < nu && !!asOf && ym < String(asOf).slice(0, 7);
  L.histIn = (hist, ym) => hist && hist[ym] ? Math.round(Number(hist[ym].in || 0) * 100) : null;
  // Per groep per maand de som en de opbouw (voor de mouse-over). aan.loonBart / loonMathijs / loonMaarten / loonIlona === false: dat loon telt niet mee.
  L.kasTotalen = function (regels, maanden, aan) {
    aan = aan || {}; const idx = new Map(maanden.map((m, i) => [m, i])), t = {};
    for (const g of L.KAS_GROEPEN) t[g] = { per: maanden.map(() => 0), opbouw: maanden.map(() => new Map()), posten: maanden.map(() => new Map()) };
    for (const r of regels || []) {
      const i = idx.get(r.ym); if (i == null || !t[r.groep]) continue;
      if (r.loon && aan[L.loonAanSleutel(r.loon)] === false) continue;
      t[r.groep].per[i] += r.c; const o = t[r.groep].opbouw[i]; o.set(r.naam, (o.get(r.naam) || 0) + r.c);
      // per post ook of hij al betaald is (bank) of nog verwacht wordt: voor het lijstje met doorgehaalde betaalde posten
      const bet = r.bron === 'bank', k = r.naam + '|' + (bet ? 1 : 0), ps = t[r.groep].posten[i], x = ps.get(k) || { naam: r.naam, c: 0, betaald: bet }; x.c += r.c; ps.set(k, x);
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

  // ── Cijfers per maand: dezelfde berekening voor de tabel (vulVoet) en het dagoverzicht op de telefoon ──
  // o = { rijen | tot, ms, fact, fk, regels (kasRegels of null), aan (kasAan), nuYm, hist, histAsOf }. Kosten = de aangevinkte kasgroepen; netto zoals L.netto/L.nettoWerkelijk;
  // inkomen = netto min kosten (dus In + Kosten = Netto, ook voor voorbije maanden uit de bank). onbekend = voorbije maand zonder complete bankgegevens.
  L.cijfers = function (o) {
    const ms = o.ms, aan = o.aan || {}, tot = o.tot || L.totalen(o.rijen, ms), idx = new Map(ms.map((m, i) => [m, i])), losPer = ms.map(() => 0), losIds = new Set(o.fk ? o.fk.los.map(f => f.id) : []);
    for (const f of o.fact || []) { const i = idx.get(f.ym); if (i != null && losIds.has(f.id)) losPer[i] += f.inclC; }
    const kt = o.regels ? L.kasTotalen(o.regels, ms, aan) : null;
    const netto = L.nettoWerkelijk(L.netto(tot.per, o.fact ? losPer : null, kt, aan), ms, o.nuYm, o.hist, kt, aan, o.histAsOf);
    const kosten = ms.map((_, i) => L.KAS_GROEPEN.reduce((a, g) => a + (aan[g] !== false && kt && kt[g] ? kt[g].per[i] : 0), 0));
    const onbekend = ms.map(m => !!(o.nuYm && m < o.nuYm && (L.histIn(o.hist, m) == null || !L.histCompleet(m, o.nuYm, o.histAsOf, false))));
    return { tot, kt, losPer, netto, kosten, inkomen: netto.map((v, i) => v - kosten[i]), onbekend };
  };
  // Het blok maanden van het dagoverzicht (telefoon): een voorkeuze of een vrije keuze { p:'vrij', s:'2026-10', n:1..12 } → { start, n }.
  // std = deze maand + 3, kw = dit kwartaal, vkw = volgend kwartaal, 6 = 6 maanden, jaar = dit jaar (jan t/m dec).
  L.periode = function (sel, nuYm) {
    const p = sel && sel.p || 'std', j = Number(nuYm.slice(0, 4)), m = Number(nuYm.slice(5, 7)), q0 = maandPlus(j + '-01', Math.floor((m - 1) / 3) * 3);
    if (p === 'kw') return { start: q0, n: 3 };
    if (p === 'vkw') return { start: maandPlus(q0, 3), n: 3 };
    if (p === '6') return { start: nuYm, n: 6 };
    if (p === 'jaar') return { start: j + '-01', n: 12 };
    if (p === 'vrij' && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(sel.s)) && Number.isInteger(sel.n) && sel.n >= 1 && sel.n <= 12) return { start: sel.s, n: sel.n };
    return { start: nuYm, n: 4 };
  };
  // In duizenden euro's, voor veel maanden naast elkaar: 24.000 → "24", 5.304 → "5,3", 40 → "0"; negatief met een echt minteken.
  L.kortD = function (cc) {
    if (cc == null) return '–';
    const k = Math.abs(cc) / 100000, t = k >= 9.95 ? String(Math.round(k)) : String(Math.round(k * 10) / 10).replace('.', ',');
    return (cc < 0 && t !== '0' ? '−' : '') + t;
  };
  // 21.400 € → "21k"; 5.304 → "5,3k"; 840 → "840"; negatief met een echt minteken.
  L.kortK = function (cc) {
    if (cc == null) return '–';
    const e = Math.round(Math.abs(cc) / 100), t = e >= 10000 ? Math.round(e / 1000) + 'k' : e >= 1000 ? String(Math.round(e / 100) / 10).replace('.', ',') + 'k' : String(e);
    return (cc < 0 && e ? '−' : '') + t;
  };
  // Nu factureren: geaccepteerd of zeker, nog niet helemaal gefactureerd, en een bedrag gepland in deze of een eerdere maand dat nog niet gefactureerd is. Bedrag = wat er nog openstaat (L.nog), anders de geplande som.
  // Per maand telt het geplande bedrag min wat er in die maand al gefactureerd is (deels gefactureerd in dezelfde maand blijft dus staan); ontbreekt het offertebedrag, dan geldt de som van die restanten.
  L.nuFactureren = (rijen, nuYm, btw) => rijen.filter(r => !r.uitbeeld && !r.los && (r.status === 'geaccepteerd' || r.zeker) && r.fstatus !== 'gefactureerd').map(r => {
    const rest = m => (r.cellen[m] || 0) - (r.gef && r.gef.maand[m] ? r.gef.maand[m] : 0), gepland = Object.keys(r.cellen).filter(m => m <= nuYm && rest(m) > 0).sort(); if (!gepland.length) return null;
    const nog = L.nog(r, btw), bedrag = nog != null ? nog : gepland.reduce((a, m) => a + rest(m), 0); return bedrag > 0 ? { r, bedrag, gepland } : null;
  }).filter(Boolean).sort((a, b) => b.bedrag - a.bedrag);
  // Offertes met een bepaalde status (openstaand, concept): bedrag en de eerstvolgende geplande maand (vanaf nuYm); helemaal gefactureerde offertes niet.
  L.offertesMet = (rijen, nuYm, status, btw) => rijen.filter(r => !r.uitbeeld && !r.los && r.status === status && r.fstatus !== 'gefactureerd').map(r => ({ r, bedrag: L.bedrag(r, btw), eerstvolgende: Object.keys(r.cellen).filter(m => r.cellen[m] > 0 && m >= nuYm).sort()[0] || null }))
    .sort((a, b) => (b.bedrag || 0) - (a.bedrag || 0));
  // Geaccepteerd maar nog nergens ingepland (en niet helemaal gefactureerd): mag niet uit beeld verdwijnen.
  L.nietIngepland = (rijen, btw) => rijen.filter(r => !r.uitbeeld && !r.los && r.status === 'geaccepteerd' && r.fstatus !== 'gefactureerd' && !Object.values(r.cellen).some(v => v)).map(r => ({ r, bedrag: L.bedrag(r, btw), eerstvolgende: null, nietIngepland: true }))
    .sort((a, b) => (b.bedrag || 0) - (a.bedrag || 0));

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
  // Telefoon (≤700 px): bedragen op hele euro's (het exacte bedrag staat in de title en verschijnt zodra je in een vakje tikt), compactere kolommen en een maandenbalk.
  const telefoon = () => !!(window.matchMedia && window.matchMedia('(max-width:700px)').matches);
  const kort = cc => { const e = Math.round(Math.abs(cc) / 100); return (cc < 0 && e ? '−' : '') + duizend(e); };
  const dtxt = cc => cc == null ? '' : telefoon() ? kort(cc) : L.fmt(cc);
  const nu = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const st = L._st = { el: null, opt: null, mag: false, schatten: null, schattenT: 0, afgekapt: false, schets: null, uitbeeld: {}, start: nu(), btw: 'incl', filter: null, sort: null,
    bezig: false, fout: null, bewaren: new Map(), keten: new Map(), mislukt: new Map(), zekerBezig: new Set(), sessie: Math.random().toString(36).slice(2), laadNr: 0,
    fact: null, factFout: null, factAfgekapt: false, prog: null, fk: null, kas: null, tl: null, tlFout: null, tlBezig: false, kasOpen: false, kasAan: {}, paneel: null };
  const STATUS_TEKST = { geaccepteerd: 'Geaccepteerd', openstaand: 'Openstaand', concept: 'Concept', los: 'Niet meer open', gefactureerd: 'Gefactureerd', afgerond: 'Afgerond', uitbeeld: 'Uit beeld' };
  const FSTATUS_TEKST = { deels: 'Deels gefactureerd', gefactureerd: 'Gefactureerd' };
  const KAS_TEKST = { open: 'Openstaande facturen', betaald: 'Betaalde facturen', vast: 'Vaste kosten', patroon: 'Vaste patronen', overig: 'Overige voorspelling', uit: 'Niet meetellen' };
  const KAS_UITLEG = { open: 'Inkoopfacturen die wij nog moeten betalen, per verwachte betaalmaand (uit Financiën)', betaald: 'Inkoopfacturen en andere betalingen die al van de bank zijn afgeschreven (voorbije maanden en wat deze maand al betaald is); verzamelbetalingen staan als één regel', vast: 'Vaste kosten: lonen, energie (Vattenfall), water (PWN), verzekeringen, hypotheek, abonnementen, lease. Herkend uit de bank en de inkoopfacturen; met Indeling zet je een regel in een andere groep',
    patroon: 'Vaste patronen: terugkerende posten die geen vaste kosten zijn (bv. Interprojecten). Voeg ze toe of zet ze hierheen met Indeling', overig: 'Btw-aangifte (uit het btw-overzicht van Moneybird; het lopende kwartaal telt live op in de maand na het kwartaal) en handmatige posten uit Financiën' };

  function css() {
    if (document.getElementById('mtl-css')) return;
    const s = document.createElement('style'); s.id = 'mtl-css';
    s.textContent = `
.mtl,.mtl-toast,.mtl-overlay,.mtl-pop,.mtl-sheet{--l-fbg:color-mix(in srgb,#3d8fe0 16%,var(--surface,#fff));--l-f:color-mix(in srgb,#1f6bb8 85%,var(--ink,#1b211e));--l-surface:var(--surface,#fff);--l-surface2:var(--surface-2,#f1ede5);--l-line:var(--line,#dfd8cb);--l-soft:var(--line-soft,#ece7de);--l-strong:var(--line-strong,#9a917f);--l-ink:var(--ink,#1b211e);--l-ink2:var(--ink-2,#5e655f);--l-ink3:var(--ink-3,#8c918a);--l-primary:var(--primary,#17643f);--l-psoft:var(--primary-soft,#ddefe3);--l-ptext:var(--primary-text,#17643f);--l-ok:var(--ok,#1a6e3b);--l-okbg:var(--ok-bg,#e3f3e8);--l-warn:var(--warn,#8f5508);--l-warnbg:var(--warn-bg,#fcefd9);--l-err:var(--err,#c4322a);--l-errbg:var(--err-bg,#fce6e4);--l-mono:var(--font-mono,"Geist Mono",ui-monospace,Menlo,monospace);--l-ui:var(--font-ui,"Geist",system-ui,-apple-system,"Segoe UI",sans-serif);--l-head:var(--font-head,"Bricolage Grotesque","Geist",system-ui,sans-serif);--l-r:var(--radius-ctl,4px);--l-rp:var(--radius-panel,8px);--l-pop:var(--shadow-pop,0 24px 60px rgba(40,34,20,.2))}
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
.mtl-tabel tfoot tr.k th,.mtl-tabel tfoot tr.k td{height:38px;font-weight:400;font-size:13px;color:var(--l-ink);background:color-mix(in srgb,var(--l-surface2) 45%,var(--l-surface))}.mtl-tabel tfoot tr.k td.nu{background:var(--l-surface2)}.mtl-tabel tfoot tr.k .mtl-vink input{width:16px;height:16px}.mtl-tabel tfoot tr.k .mtl-loon{font-size:12px;color:var(--l-ink2)}
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
.mtl-tabel tfoot td.klik{cursor:pointer}.mtl-tabel tfoot td.klik:hover{text-decoration:underline dotted}.mtl-tabel tfoot td.klik:focus-visible{outline:2px solid var(--l-primary);outline-offset:-2px}.mtl-nogk{display:block;font-size:10px;line-height:12px;color:var(--l-ink3);font-weight:400}
.mtl-pop{position:fixed;z-index:9997;background:var(--l-surface);color:var(--l-ink);border:1px solid var(--l-line);border-radius:var(--l-rp);box-shadow:var(--l-pop);font-family:var(--l-ui);font-size:13px;width:min(380px,calc(100vw - 16px));max-height:60vh;overflow:auto;padding:10px 12px}
.mtl-popkop{display:flex;align-items:center;gap:6px;margin-bottom:6px}.mtl-popkop button{margin-left:auto;font-size:16px;text-decoration:none}.mtl-pop ul{list-style:none;margin:0;padding:0}.mtl-pop li{display:flex;gap:8px;align-items:baseline;padding:3px 0;border-bottom:1px solid var(--l-soft)}
.mtl-pop li .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mtl-pop li .b{font-family:var(--l-mono);font-variant-numeric:tabular-nums}.mtl-pop li.betaald .n,.mtl-pop li.betaald .b{text-decoration:line-through;color:var(--l-ink3)}
.mtl-pop li .tag{font-size:10px;color:var(--l-ok);background:var(--l-okbg);border-radius:var(--l-r);padding:0 5px}.mtl-popvoet{display:flex;gap:14px;justify-content:flex-end;margin-top:8px;font-size:12px;color:var(--l-ink2)}
.mtl-mbar{display:none}.mtl-jj{margin-left:0}
@media (max-width:700px){
.mtl-mbd{display:inline;width:100%;font-family:var(--l-mono);font-variant-numeric:tabular-nums;color:var(--l-ink2)}.mtl{gap:8px}.mtl-kop{align-items:flex-start;gap:6px}.mtl-titelblok{min-width:0}.mtl-titel{font-size:23px;line-height:28px}.mtl-sub{font-size:11px;line-height:15px;margin-top:1px}.mtl-acties{width:100%;gap:4px;flex-wrap:nowrap;overflow-x:auto;padding-bottom:1px}.mtl-acties .ui-knop{min-height:44px;padding:0 8px;font-size:12px;white-space:nowrap}.mtl-acties .mtl-seg{flex:none}
.mtl-balk{padding:8px;gap:6px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.mtl-balk::-webkit-scrollbar{display:none}.mtl-chip,.mtl-nav{flex:none}.mtl-chip{height:30px;padding:0 9px}.mtl-nav{margin-left:0}.mtl-nav .ui-knop{min-height:44px}.mtl-periode{font-size:11px;margin:0 2px}
.mtl-tabel{font-size:12px}.mtl-tabel .s{min-width:118px;max-width:118px}.mtl-tabel .zk{width:36px;min-width:36px;padding-left:2px;padding-right:2px}.mtl-tabel .bd{display:none}.mtl-tabel th,.mtl-tabel td{padding-left:8px;padding-right:8px}.mtl-tabel thead .zk .mtl-sortknop{font-size:0;padding:4px 0}.mtl-tabel thead .zk .mtl-sortknop::after{content:"Zeker";font-size:11px}.mtl-tabel td.num,.mtl-tabel th.num{padding-left:4px;padding-right:4px}.mtl-naam b{max-width:110px;white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;line-height:16px}.mtl-meta{gap:2px;line-height:14px}.mtl-meta>span:not(.mtl-st):not(.mtl-mbd){display:none}.mtl-st{height:17px;padding:0 5px;font-size:10px}.mtl-in,.mtl-gefcel{width:68px}.mtl-in{height:32px}.mtl-gefcel{line-height:32px;padding:0 5px}.mtl-tabel tbody tr:not(.vul){height:52px}
.mtl-tabel.kasopen tfoot th,.mtl-tabel.kasopen tfoot td{position:static}.mtl-tabel tfoot th.s{overflow:hidden}.mtl-tabel tfoot th.s .mtl-vink{white-space:normal;align-items:center;line-height:16px}.mtl-tabel tfoot th.s .mtl-vink input{flex:none;min-height:0;width:16px;height:16px;padding:0}.mtl-tabel tfoot th.s .mtl-vinkrij{max-width:100%}.mtl-tabel.kasopen tfoot th.s{position:sticky;left:0;bottom:auto!important}.mtl-tabel.kasopen tfoot tr.som th.s{bottom:34px!important;z-index:5}.mtl-tabel.kasopen tfoot tr.netto th.s{bottom:0!important;z-index:5}.mtl-tabel.kasopen tfoot tr.som th,.mtl-tabel.kasopen tfoot tr.som td{position:sticky;bottom:34px!important;z-index:4}.mtl-tabel.kasopen tfoot tr.netto th,.mtl-tabel.kasopen tfoot tr.netto td{position:sticky;bottom:0!important;z-index:4}.mtl-vinkrij{flex-wrap:wrap;gap:2px 8px;max-width:150px}.mtl-loon{flex-wrap:wrap;gap:2px 8px}.mtl-tabel tfoot tr.k th{height:auto;padding-top:4px;padding-bottom:4px}.mtl-tabel tfoot tr.k th,.mtl-tabel tfoot tr.k td{font-size:11px}.mtl-uitklap{min-height:44px;padding-top:4px;padding-bottom:4px}.mtl-somkop{gap:2px 4px;flex-wrap:wrap;white-space:normal}.mtl-tabel tfoot th.s .mtl-uitklap{font-size:12px;gap:4px;margin-left:-4px;padding-left:4px;padding-right:4px;text-align:left}.mtl-voet{font-size:11px;line-height:15px;max-height:30px;overflow:auto;padding-right:4px}.mtl-lang{display:none}
.mtl-popbg{position:fixed;inset:0;z-index:9996;background:rgba(20,18,12,.35)}
.mtl-pop.mtl-pop--blad{left:0;right:0;top:auto;bottom:0;width:auto;max-height:70vh;border-radius:12px 12px 0 0;border-width:1px 0 0;padding:6px 16px calc(14px + env(safe-area-inset-bottom,0px));font-size:14px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.mtl-pop--blad .mtl-popkop{position:sticky;top:-6px;z-index:1;margin:0 -16px 4px;padding:0 4px 0 16px;background:var(--l-surface);border-bottom:1px solid var(--l-soft);min-height:48px}
.mtl-pop--blad .mtl-popkop button{min-width:44px;min-height:44px;font-size:26px;line-height:1;padding:0;text-decoration:none;color:var(--l-ink2)}
.mtl-pop--blad li{padding:8px 0;min-height:28px}.mtl-pop--blad .mtl-popvoet{font-size:13px}
.mtl-nav{display:none}
.mtl-mbar{display:flex;position:relative;flex:none;gap:2px;align-items:center;overflow-x:auto;scroll-snap-type:x proximity;scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;padding:0 8px;border-bottom:1px solid var(--l-line);background:var(--l-surface)}
.mtl-mbar::-webkit-scrollbar{display:none}
.mtl-mj{flex:none;scroll-snap-align:start;margin-left:6px;padding:0 6px 0 10px;border-left:1px solid var(--l-line);font-size:11px;font-weight:600;line-height:44px;color:var(--l-ink3)}.mtl-mj:first-child{margin-left:0;border-left:0}
.mtl-mchip{flex:none;scroll-snap-align:center;min-width:44px;height:44px;padding:0 6px;border:0;border-radius:var(--l-r);background:none;color:var(--l-ink2);font:500 13px var(--l-ui);cursor:pointer}
.mtl-mchip.in{background:var(--l-psoft);color:var(--l-ptext);font-weight:600}.mtl-mchip.nu:not(.in){box-shadow:inset 0 -2px 0 var(--l-primary)}
.mtl-tabel .s{min-width:104px;max-width:104px}.mtl-tabel th.s{padding-left:6px;padding-right:4px}.mtl-naam b{max-width:94px;font-size:12px}
.mtl-tabel .zk{width:32px;min-width:32px;padding-left:0;padding-right:0;text-align:center}.mtl-tabel thead .zk .mtl-sortknop::after{font-size:10px}
.mtl-tabel td.num,.mtl-tabel th.num{padding-left:2px;padding-right:2px}.mtl-tabel thead th.num .mtl-sortknop{padding:2px 1px;line-height:14px}
.mtl-mm{font-size:12px}.mtl-jj{display:block;font-size:10px;color:var(--l-ink3)}
.mtl-in,.mtl-gefcel{width:62px}.mtl-in{height:36px;padding:0 3px;letter-spacing:-.03em}.mtl-gefcel{padding:0 3px;line-height:36px}
.mtl-tabel .tot{min-width:60px}.mtl-tabel tfoot td.num,.mtl-tabel tfoot th{font-size:11px}.mtl-tabel tbody tr:not(.vul){height:48px}
.mtl-sw{display:flex;align-items:center;justify-content:center;width:32px;height:48px}
.mtl-sw span{position:static;inset:auto;width:20px;height:20px;border-radius:50%;box-sizing:border-box;background:var(--l-surface);border:2px solid var(--l-strong);transition:none}.mtl-sw span::after{display:none}
.mtl-sw input:checked+span{background:var(--l-primary);border-color:var(--l-primary)}
.mtl--m{min-height:0;gap:14px;font-size:15px;line-height:22px}.mtl--m .mtl-titelblok{display:none}.mtl--m .mtl-kop{margin:0}
.mtl-ico{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
.mtl-m-blok{background:var(--l-surface);border:1px solid var(--l-line);border-radius:var(--l-rp);padding:8px 8px 12px}
.mtl-m-per{display:flex;align-items:center;gap:4px;margin-bottom:4px}.mtl-m-pt{flex:1;text-align:center;font-size:15px;font-weight:600}
.mtl-m-pijl{width:44px;height:44px;border:0;border-radius:var(--l-r);background:none;color:var(--l-ink2);display:grid;place-items:center}.mtl-m-nu{min-height:44px}
.mtl-m-grid{display:grid;grid-template-columns:54px repeat(4,minmax(0,1fr));align-items:stretch}
.mtl-m-l{display:flex;align-items:center;min-height:40px;padding:0 2px;font-size:14px;color:var(--l-ink2);border-top:1px solid var(--l-soft)}.mtl-m-nl{min-height:54px;font-weight:600;color:var(--l-ink)}
.mtl-m-grid>:nth-child(-n+5){border-top:0}
.mtl-m-mnd{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:60px;border:0;border-radius:var(--l-r);background:none;color:var(--l-ink);font:inherit}.mtl-m-mnd b{font-size:15px;line-height:18px}.mtl-m-mnd span:last-child{font-size:13px;line-height:15px;color:var(--l-ink3)}.mtl-m-mnd.nu{background:var(--l-surface2)}
.mtl-m-c{display:flex;align-items:center;justify-content:center;min-height:40px;border-top:1px solid var(--l-soft);font-family:var(--l-mono);font-variant-numeric:tabular-nums;font-size:15px}
.mtl-m-netto{min-height:54px;font-size:21px;font-weight:600}.mtl-m-netto.groen{color:var(--l-ok)}.mtl-m-netto.oranje{color:var(--l-warn)}.mtl-m-netto.rood{color:var(--l-err)}.mtl-m-netto.zonder{font-style:italic}
.mtl-m-let{margin-top:8px;padding:8px 10px;font-size:14px;line-height:20px;color:var(--l-warn);background:var(--l-warnbg);border-radius:var(--l-r)}.mtl-m-let .ui-knop{min-height:44px;margin-left:6px}
.mtl-m-sec{display:flex;flex-direction:column;gap:6px}.mtl-m-h{margin:0;font:600 16px/22px var(--l-ui)}
.mtl-m-hk{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:48px;padding:0;border:0;background:none;color:var(--l-ink)}.mtl-m-leeg{margin:0;font-size:14px;color:var(--l-ink3)}
.mtl-m-rij{display:flex;align-items:center;gap:8px;width:100%;min-height:60px;padding:8px 12px;border:1px solid var(--l-line);border-radius:var(--l-rp);background:var(--l-surface);color:var(--l-ink);text-align:left;font:inherit}
.mtl-m-rn{flex:1;min-width:0;display:flex;flex-direction:column}.mtl-m-rn b{font-weight:500;font-size:15px;line-height:20px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.mtl-m-rn small{font-size:13px;line-height:18px;color:var(--l-ink2)}
.mtl-m-rb{font-family:var(--l-mono);font-weight:600;font-size:15px;white-space:nowrap}.mtl-m-tabel{width:100%;min-height:48px}
.mtl-sheet{position:fixed;left:0;right:0;bottom:0;z-index:9997;max-height:88vh;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;background:var(--l-surface);color:var(--l-ink);border-top:1px solid var(--l-line);border-radius:12px 12px 0 0;box-shadow:var(--l-pop);font:15px/22px var(--l-ui);padding:0 16px calc(12px + env(safe-area-inset-bottom,0px))}
.mtl-sheet-kop{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;margin:0 -16px;padding:6px 4px 6px 16px;min-height:56px;background:var(--l-surface);border-bottom:1px solid var(--l-soft)}
.mtl-sheet-t{flex:1;min-width:0;display:flex;flex-direction:column}.mtl-sheet-t b{font-size:17px;line-height:22px}.mtl-sheet-t small{font-size:13px;line-height:18px;color:var(--l-ink2)}
.mtl-sheet-x{flex:none;width:44px;height:44px;border:0;border-radius:var(--l-r);background:none;color:var(--l-ink2);display:grid;place-items:center}
.mtl-ks-rij{position:relative;display:flex;align-items:center;gap:12px;min-height:52px;border-bottom:1px solid var(--l-soft);cursor:pointer}.mtl-ks-rij.sub{padding-left:30px;min-height:48px}
.mtl-ks-in{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;z-index:1}
.mtl-ks-v{flex:none;position:relative;width:24px;height:24px;border-radius:50%;border:2px solid var(--l-strong);box-sizing:border-box;background:var(--l-surface)}
.mtl-ks-in:checked+.mtl-ks-v{background:var(--l-primary);border-color:var(--l-primary)}.mtl-ks-in:checked+.mtl-ks-v::after{content:"";position:absolute;left:6px;top:2px;width:6px;height:11px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.mtl-ks-in:focus-visible+.mtl-ks-v{outline:2px solid var(--l-primary);outline-offset:2px}
.mtl-ks-t{flex:1;min-width:0;font-size:15px}.mtl-ks-b{font-family:var(--l-mono);font-size:15px;color:var(--l-ink2)}
.mtl-ks-voet{position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 -16px;padding:10px 16px;background:var(--l-surface);border-top:1px solid var(--l-line)}
.mtl-ks-vl{position:relative;display:inline-flex;align-items:center;gap:8px;font-size:15px;font-weight:500}.mtl-ks-net{font-family:var(--l-mono);font-size:23px;line-height:28px}.mtl-ks-net.groen{color:var(--l-ok)}.mtl-ks-net.oranje{color:var(--l-warn)}.mtl-ks-net.rood{color:var(--l-err)}
.mtl-os{display:flex;flex-direction:column;padding-top:6px}.mtl-os-st{display:flex;align-items:center;gap:10px;min-height:44px}.mtl-os-mb{margin-left:auto;min-height:44px;display:inline-flex;align-items:center;font-size:14px}
.mtl-os-dl{display:flex;justify-content:space-between;align-items:center;gap:10px;min-height:40px;border-bottom:1px solid var(--l-soft)}.mtl-os-dl b{font-family:var(--l-mono);font-weight:600}
.mtl-os-zeker{display:flex;align-items:center;justify-content:space-between;min-height:52px;border-bottom:1px solid var(--l-soft);font:500 15px/22px var(--l-ui);color:var(--l-ink)}.mtl-os-zeker>span:first-child{font:500 15px/22px var(--l-ui);color:var(--l-ink)}.mtl-os-h{margin:14px 0 2px;font-size:16px;line-height:22px}
.mtl-os-rij{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px;border-bottom:1px solid var(--l-soft)}.mtl-os-rij .mtl-in{width:150px;height:44px;padding:0 10px;letter-spacing:normal}
.mtl-os-gf{display:flex;flex-direction:column;align-items:flex-end;font-family:var(--l-mono);color:var(--l-f)}.mtl-os-gf small{font:13px/16px var(--l-ui)}
.mtl--m .mtl-acties{flex-wrap:wrap;overflow:visible}
.mtl-m-ver{width:44px;padding:0;display:inline-grid;place-items:center}.mtl-m-filter{display:inline-flex;align-items:center;gap:6px}.mtl-m-fn{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:var(--l-primary);color:#fff;font:600 12px/1 var(--l-ui)}
.mtl-m-pt{flex:1;min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:0;background:none;color:var(--l-ink);font:600 15px var(--l-ui)}
.mtl-m-ksb{position:relative;flex:none;width:44px;height:44px;margin-left:-6px;border:0;background:none;color:var(--l-ink2);display:grid;place-items:center}.mtl-m-ksb.stip::after{content:"";position:absolute;top:10px;right:9px;width:8px;height:8px;border-radius:50%;background:var(--l-primary);border:2px solid var(--l-surface);box-sizing:content-box}
.mtl-m-nl{overflow:visible;font-weight:600;color:var(--l-ink)}.mtl-m-cap{margin:6px 0 0;font-size:12px;line-height:16px;color:var(--l-ink3);text-align:center}.mtl-m-blok.d3{padding:8px 4px 12px}.mtl-m-grid .jr{box-shadow:inset 1px 0 0 var(--l-line)}
.mtl-m-d1 .mtl-m-netto{font:600 20px/24px var(--l-ui)}.mtl-m-d2 .mtl-m-l{font-size:13px}.mtl-m-d2 .mtl-m-c{font:13px/16px var(--l-ui);letter-spacing:-.02em;padding:0}.mtl-m-d2 .mtl-m-netto{font:600 15px/18px var(--l-ui)}.mtl-m-d2 .mtl-m-mnd b{font-size:13px}.mtl-m-d2 .mtl-m-mnd span:last-child{font-size:11px}
.mtl-m-d3 .mtl-m-l{font-size:11px;padding:0}.mtl-m-d3 .mtl-m-c{font:11px/14px var(--l-ui);letter-spacing:-.02em;padding:0}.mtl-m-d3 .mtl-m-netto{font:600 12px/14px var(--l-ui)}.mtl-m-d3 .mtl-m-mnd{min-height:32px;padding:0}.mtl-m-d3 .mtl-m-mnd b{font-size:11px}
.mtl-ks-mnd{display:grid;grid-template-columns:repeat(auto-fill,minmax(54px,1fr));gap:6px;padding:10px 0}
.mtl-mp-voor{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 0}.mtl-mp-v{min-height:48px;border:1px solid var(--l-line);border-radius:var(--l-r);background:var(--l-surface);color:var(--l-ink);font:500 15px var(--l-ui)}.mtl-mp-v.aan{background:var(--l-psoft);border-color:var(--l-psoft);color:var(--l-ptext);font-weight:600}
.mtl-mp-jaar{display:flex;align-items:center;justify-content:space-between;padding:4px 0}.mtl-mp-jaar b{font-size:17px}
.mtl-mp-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:6px 0 10px}.mtl-mp-m{min-height:52px;border:1px solid var(--l-line);border-radius:var(--l-r);background:var(--l-surface);color:var(--l-ink);font:500 15px var(--l-ui)}.mtl-mp-m.in{background:var(--l-psoft);border-color:var(--l-psoft);color:var(--l-ptext)}.mtl-mp-m.end{background:var(--l-primary);border-color:var(--l-primary);color:#fff;font-weight:600}
.mtl-mp-t{flex:1;font-size:14px;line-height:20px;color:var(--l-ink2)}.mtl-mp-ok{min-height:48px;padding:0 20px}
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
    if (!st.fout) laadKas(!!(o && o.vers));                                  // altijd: het netto resultaat staat vast onderaan
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
      const vd = /^\d{4}-\d{2}-\d{2}$/.test(String(r.vandaag || '')) ? r.vandaag : v, asOf = r.patronen && r.patronen.as_of ? String(r.patronen.as_of).slice(0, 10) : null;
      const hist = r.historie_maand_partij && typeof r.historie_maand_partij === 'object' ? r.historie_maand_partij : null;
      st.tl = { events: r.events, vandaag: vd, onvolledig: onv, hist, histVers: !!(hist && asOf && asOf >= vd), histAsOf: asOf };
      // Bankhistorie ontbreekt of is niet van vandaag: één keer per sessie opnieuw laten berekenen (alleen de eigenaar mag dat), daarna opnieuw laden.
      if ((!hist || !st.tl.histVers) && st.mag && !st.histGevraagd) vernieuwHist();
    } catch (e) { st.tlFout = String(e.message || e); st.tl = null; }   // nooit met de cijfers van een vorige keer verder rekenen
    st.tlBezig = false; teken();
  }
  // Bankhistorie opnieuw laten berekenen (eigenaar; één keer per sessie vanzelf, daarna via "opnieuw"). Mislukt het, dan een melding bij Netto.
  function vernieuwHist() {
    st.histGevraagd = true; st.histFout = null;
    st.opt.bron.haal('/geld/patronen?vers=1').then(x => { if (x && !x.error && x.opgeslagen !== false) laadKas(false); else { st.histFout = (x && x.error) || 'de bankgegevens konden niet volledig worden opgehaald'; teken(); } })
      .catch(e => { st.histFout = String(e.message || e); teken(); });
  }
  function kasRegels(ms) {
    if (!st.tl) return null;
    const kas = st.kasGeladen ? L.kasEff(st.kas, st.kasStart) : st.kas;
    const nu = st.tl.vandaag.slice(0, 7), vooruit = ms.filter(m => m >= nu), terug = ms.filter(m => L.histCompleet(m, nu, st.tl.histAsOf, st.tl.histVers));
    const pn = L.patNamen(st.tl.events), bezet = L.bezet(st.tl.events, st.tl.vandaag), hNu = st.tl.histVers && st.tl.hist ? st.tl.hist[nu] : null;
    // Deze maand al betaald (historie van vandaag): een eigen post van dezelfde leverancier en de btw-aangifte van de tijdlijn tellen dan niet nog eens (Codex).
    if (hNu) for (const n of Object.keys(hNu.uit || {})) { bezet.add('n:' + n.trim().toLowerCase() + '|' + nu); if (pn[n.trim().toLowerCase()]) bezet.add(pn[n.trim().toLowerCase()] + '|' + nu); }
    const ev = st.tl.events.map(e => L.kasRegel(e, kas, st.tl.vandaag)).filter(r => r && !(hNu && hNu.btw > 0 && r.bron === 'btw' && r.ym === nu));
    return ev.concat(L.postRegels(kas, vooruit, bezet), L.histRegels(st.tl.hist, terug, kas, pn));
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
    if (st.zekerBezig.has(id)) { werkBij(); return; }   // er loopt al een opslag voor deze offerte: een tweede tik wordt genegeerd (geen dubbele POST of vals conflict); de schakelaar springt terug naar wat er staat en volgt het antwoord van de eerste
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
  function zichtbareRijen() { const ms = maanden(); return L.sorteer(L.filter(L.rijen(st.schatten, st.schets, st.uitbeeld, st.fk), st.filter, ms), st.sort, st.btw, ms); }
  // Na een opslag alleen de cijfers bijwerken (geen hertekening: de focus en een half getypt vakje blijven staan).
  function werkBij(forceer) {
    if (st.mob) { tekenMobiel(); vernieuwSheet(); return; }
    const t = st.el && st.el.querySelector('.mtl-tabel'); if (!t) return;
    const ms = maanden(), rijen = zichtbareRijen(), perId = new Map(rijen.map(r => [r.id, r]));
    t.querySelectorAll('input.mtl-in').forEach(inp => {
      const r = perId.get(inp.dataset.id); if (!r) return; const sl = inp.dataset.id + '|' + inp.dataset.ym;
      inp.classList.toggle('fout', st.mislukt.has(sl)); inp.classList.toggle('bewaren', st.bewaren.has(sl));
      const v = r.cellen[inp.dataset.ym]; inp.dataset.oud = v == null ? '' : String(v);              // altijd de laatst bekende stand van de server
      if ((document.activeElement === inp && sl !== forceer) || st.bewaren.has(sl)) return;   // niet door iemands getyp heen schrijven
      const m = st.mislukt.get(sl), toon = m ? m.nieuw : v;                                    // rood vakje: jouw niet-opgeslagen bedrag blijft staan
      inp.value = m && m.tekst != null ? m.tekst : toon == null ? '' : dtxt(toon);
      inp.title = telefoon() && toon != null && toon % 100 ? L.fmt(toon) : '';
    });
    t.querySelectorAll('td.tot[data-id]').forEach(td => { const r = perId.get(td.dataset.id); if (r) { zetGetal(td, L.rijTotaal(r, ms)); td.title = td.dataset.ex || ''; } });
    t.querySelectorAll('input.mtl-zk').forEach(cb => { const r = perId.get(cb.dataset.id); if (r) cb.checked = r.zeker; });
    const tot = L.totalen(rijen, ms);
    vulVoet(t, tot, ms);
    const v = st.el.querySelector('.mtl-voet'); if (v) v.textContent = voetTekst(tot);
  }
  function zetGetal(td, c) { td.textContent = c ? dtxt(c) : '\u2013'; td.classList.toggle('mtl-0', !c); td.dataset.ex = c && telefoon() && c % 100 ? L.fmt(c) : ''; }
  function postenTekst(m) { const ps = [...m.values()]; const b = ps.filter(x => x.betaald).reduce((a, x) => a + x.c, 0), n = ps.filter(x => !x.betaald).reduce((a, x) => a + x.c, 0); return (b ? 'Al betaald ' + L.fmt(b) + '\n' : '') + (n ? 'Nog verwacht ' + L.fmt(n) + '\n' : '') + 'Klik voor het lijstje'; }
  // Lijstje bij een kostencel: al betaalde posten doorgehaald (met "betaald"), wat nog komt gewoon. Sluit met Esc, een klik ernaast of opnieuw klikken.
  function toonPosten(g, i, td) {
    sluitPosten(); if (!st.voet || !st.voet.kt) return;
    const ps = [...st.voet.kt[g].posten[i].values()].filter(x => x.c).sort((a, b) => (a.betaald - b.betaald) || Math.abs(b.c) - Math.abs(a.c)); if (!ps.length) return;
    const bet = ps.filter(x => x.betaald).reduce((a, x) => a + x.c, 0), nog = ps.filter(x => !x.betaald).reduce((a, x) => a + x.c, 0);
    const pop = h('div', { class: 'mtl-pop', role: 'dialog', 'aria-label': KAS_TEKST[g] + ' ' + maandTekst(st.voet.ms[i]) },
      h('div', { class: 'mtl-popkop' }, h('b', null, KAS_TEKST[g]), ' ', maandTekst(st.voet.ms[i]), h('button', { type: 'button', class: 'mtl-link', 'aria-label': 'Sluiten', onclick: () => sluitPosten() }, '\u00d7')),
      h('ul', null, ps.slice(0, 40).map(x => h('li', { class: x.betaald ? 'betaald' : null }, h('span', { class: 'n' }, x.naam), x.betaald ? h('span', { class: 'tag' }, 'betaald') : null, h('span', { class: 'b' }, L.fmt(x.c))))),
      ps.length > 40 ? h('div', { class: 'mtl-0' }, '\u2026 en nog ' + (ps.length - 40)) : null,
      h('div', { class: 'mtl-popvoet' }, bet ? h('span', null, 'Al betaald ', h('b', null, L.fmt(bet))) : null, nog ? h('span', null, 'Nog verwacht ', h('b', null, L.fmt(nog))) : null));
    // Telefoon: een bladwerk van onderaf (binnen duimbereik, sluitknop van 44 px, een tik ernaast sluit); desktop: naast de cel zoals altijd.
    const blad = !!(window.matchMedia && window.matchMedia('(max-width:700px)').matches), bg = blad ? h('div', { class: 'mtl-popbg' }) : null;
    if (bg) document.body.appendChild(bg);
    document.body.appendChild(pop); st.pop = { el: pop, td, bg };
    if (blad) { pop.classList.add('mtl-pop--blad'); const x = pop.querySelector('.mtl-popkop button'); if (x) x.focus({ preventScroll: true }); }
    else { const r = td.getBoundingClientRect(), w = pop.offsetWidth, hh = pop.offsetHeight;
      pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px'; pop.style.top = Math.max(8, r.top - hh - 6) + 'px'; }
    setTimeout(() => { if (!st.pop || st.pop.el !== pop) return; document.addEventListener('mousedown', st.pop.weg = ev => { if (!pop.contains(ev.target) && !td.contains(ev.target)) sluitPosten(); }); document.addEventListener('keydown', st.pop.esc = ev => { if (ev.key === 'Escape') { sluitPosten(); td.focus(); } }); }, 0);
  }
  function sluitPosten() { if (!st.pop) return; document.removeEventListener('mousedown', st.pop.weg); document.removeEventListener('keydown', st.pop.esc); st.pop.el.remove(); if (st.pop.bg) st.pop.bg.remove(); st.pop = null; }
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
      tr.querySelectorAll('td[data-i]').forEach(td => { const i = Number(td.dataset.i); if (per) zetGetal(td, per[i]); else { td.textContent = st.tlBezig ? '\u2026' : ''; td.classList.add('mtl-0'); } td.title = per && titel ? titel(i) : ''; if (td.dataset.ex) td.title = (td.title ? td.title + '\n' : '') + td.dataset.ex; });
      const s = tr.querySelector('td.tot'); if (s) { if (per) { zetGetal(s, per.reduce((a, b) => a + b, 0)); s.title = s.dataset.ex || ''; } else s.textContent = ''; }
    };
    zet('som', tot.per); zet('zeker', tot.zeker);
    const idx = new Map(ms.map((m, i) => [m, i])), alle = ms.map(() => new Map()), allePer = ms.map(() => 0), losPer = ms.map(() => 0), losIds = new Set(st.fk ? st.fk.los.map(f => f.id) : []);
    for (const f of st.fact || []) { const i = idx.get(f.ym); if (i == null) continue; allePer[i] += f.inclC; if (losIds.has(f.id)) losPer[i] += f.inclC;
      alle[i].set((f.nummer || 'factuur') + ' ' + (f.klant || '') + (losIds.has(f.id) ? ' (zonder offerte)' : ''), f.inclC); }
    zet('gef', st.fact ? allePer : null, i => opbouwTekst('Gefactureerd in ' + maandTekst(ms[i]) + ' (incl. btw)', alle[i]));
    const nuYmV = st.tl ? st.tl.vandaag.slice(0, 7) : null;
    const cj = L.cijfers({ tot, ms, fact: st.fact, fk: st.fk, regels: kasRegels(ms), aan: st.kasAan, nuYm: nuYmV, hist: st.tl && st.tl.hist, histAsOf: st.tl && st.tl.histAsOf }), kt = cj.kt;   // dezelfde cijfers als het dagoverzicht op de telefoon
    st.voet = { kt, ms };
    for (const g of L.KAS_GROEPEN) zet(g, kt ? kt[g].per : null, i => postenTekst(kt[g].posten[i]) + '\n\n' + opbouwTekst(KAS_TEXT_KORT(g) + ' ' + maandTekst(ms[i]) + (nuYmV && ms[i] < nuYmV ? ' (betaald, bank)' : nuYmV && ms[i] === nuYmV && st.tl.histVers ? ' (al betaald + nog verwacht)' : ' (verwacht)'), kt[g].opbouw[i]));
    const onv = st.tl && st.tl.onvolledig.length;
    // Voorbije maanden: netto = werkelijk ontvangen min werkelijk betaald (bank, met de vinkjes). Vanaf deze maand: totaal + aangevinkte regels.
    const nuYm = nuYmV, nettoPer = cj.netto;
    zet('netto', nettoPer, i => nuYm && ms[i] < nuYm ? (st.tl.hist && st.tl.hist[ms[i]] && L.histCompleet(ms[i], nuYm, st.tl.histAsOf, false) ? 'Werkelijk via de bank in ' + maandTekst(ms[i]) + ': ontvangen ' + L.fmt(L.histIn(st.tl.hist, ms[i])) + ', min de aangevinkte betaalde kosten' : (st.tl.hist && st.tl.histAsOf && ms[i] >= st.tl.histAsOf.slice(0, 7) ? 'De bankgegevens van ' + maandTekst(ms[i]) + ' zijn nog niet bijgewerkt' : 'Geen bankgegevens voor ' + maandTekst(ms[i]) + ' (de bankhistorie gaat een jaar terug)')) : !kt ? 'De kosten zijn niet geladen: dit is alleen het totaal' : onv ? 'Let op: het overzicht van Financiën is niet compleet, er kunnen kosten ontbreken' : '');
    const nr = t.querySelector('tfoot tr[data-rij="netto"]'); if (nr) nr.classList.toggle('onv', !kt || !!onv);
    t.querySelectorAll('tfoot tr[data-rij]').forEach(tr => { const g = tr.dataset.rij; if (g === 'gef' || L.KAS_GROEPEN.includes(g)) tr.classList.toggle('uit', st.kasAan[g] === false); });
    // Kostencellen klikbaar (lijstje met posten); deze maand met een regeltje "nog …" als een deel al betaald is.
    if (kt) for (const g of L.KAS_GROEPEN) t.querySelectorAll(`tfoot tr[data-rij="${g}"] td[data-i]`).forEach(td => { const i = Number(td.dataset.i), ps = [...kt[g].posten[i].values()];
      td.classList.toggle('klik', ps.length > 0); td.tabIndex = ps.length ? 0 : -1; td.setAttribute('role', ps.length ? 'button' : 'cell');
      const bet = ps.filter(x => x.betaald).reduce((a, x) => a + x.c, 0), nog = ps.filter(x => !x.betaald).reduce((a, x) => a + x.c, 0);
      if (bet && ps.some(x => !x.betaald)) td.appendChild(h('span', { class: 'mtl-nogk' }, 'nog ' + L.fmt(nog))); });
  }
  const KAS_TEXT_KORT = g => KAS_TEKST[g];
  function voetTekst(tot) {
    const d = [];
    if (tot.buiten) d.push(`Buiten deze ${AANTAL} maanden staat nog ${L.fmt(tot.buiten)} (${telefoon() ? 'kies een andere maand in de balk' : 'blader met ‹ ›'}).`);
    if (st.afgekapt) d.push('Let op: niet alle offertes uit Moneybird zijn geladen.');
    if (st.factFout) d.push('De facturen uit Moneybird zijn niet geladen (' + st.factFout + '): alleen de schets telt. Probeer Vernieuwen.');
    if (st.fact) d.push('Een blauw vakje is gefactureerd in Moneybird: dat bedrag telt in die maand in plaats van de schets.');
    d.push('De schets telt nergens anders mee. Typ een bedrag, of een percentage van het offertebedrag (bv. 50%). Leeg maken = wissen.');
    return d.join(' ');
  }
  function sortKnop(sleutel, tekst) {
    const actief = st.sort.sleutel === sleutel, pijl = actief ? (st.sort.richting === 'op' ? ' \u2191' : ' \u2193') : '';
    const tk = Array.isArray(tekst) ? tekst.map(x => x.textContent).join('') : tekst;   // een maand mag uit twee delen bestaan (maand en jaar, op de telefoon onder elkaar)
    return h('button', { type: 'button', class: 'mtl-sortknop' + (actief ? ' actief' : ''), 'aria-sort': actief ? (st.sort.richting === 'op' ? 'ascending' : 'descending') : null, title: 'Sorteren op ' + tk.toLowerCase(),
      onclick: () => { st.sort = { sleutel, richting: actief && st.sort.richting === 'af' ? 'op' : 'af' }; ls.set('mtl:sort', st.sort.sleutel + ':' + st.sort.richting); teken(); } }, Array.isArray(tekst) ? tekst : tekst + pijl, Array.isArray(tekst) ? pijl : null);
  }
  // ── Maandenbalk (telefoon): een sleepbare strook met maanden zoals de periodekiezer van Moneybird. Dezelfde state als de pijltjes (st.start): een maand
  //    buiten de tabel zet het begin van de tabel op die maand (ook in het verleden), een maand in de tabel scrolt er naartoe; de maanden die in beeld zijn lichten op.
  function maandenBalk(ms, dezeMaand) {
    const lo0 = maandPlus(dezeMaand, -12), hi0 = maandPlus(dezeMaand, 24), lo = lo0 < ms[0] ? lo0 : ms[0], hi = hi0 > ms[ms.length - 1] ? hi0 : ms[ms.length - 1], items = [];
    let jaar = null;
    for (let m = lo; m <= hi; m = maandPlus(m, 1)) {
      if (m.slice(0, 4) !== jaar) { jaar = m.slice(0, 4); items.push(h('span', { class: 'mtl-mj', 'aria-hidden': 'true' }, jaar)); }
      items.push(h('button', { type: 'button', class: 'mtl-mchip' + (m === dezeMaand ? ' nu' : ''), data: { ym: m }, 'aria-label': maandTekst(m), 'aria-pressed': 'false', onclick: () => naarMaand(m) }, MND_K[Number(m.slice(5, 7)) - 1]));
    }
    return h('div', { class: 'mtl-mbar', role: 'group', 'aria-label': 'Maand kiezen: sleep om terug of vooruit te gaan' }, items);
  }
  const vasteBreedte = s => { const a = s.querySelector('thead th.s'), b = s.querySelector('thead th.zk'), c = s.querySelector('thead th.bd'); return (a ? a.offsetWidth : 0) + (b ? b.offsetWidth : 0) + (c && c.offsetParent ? c.offsetWidth : 0); };
  function naarMaand(m) {
    if (!st.el) return;
    if (!maanden().includes(m)) { st.start = m; teken(); const s0 = st.el.querySelector('.mtl-scroll'); if (s0) s0.scrollLeft = 0; syncMaanden(); return; }
    const s = st.el.querySelector('.mtl-scroll'), th = s && s.querySelector(`thead th[data-ym="${m}"]`); if (!th) return;
    s.scrollTo({ left: Math.max(0, th.getBoundingClientRect().left - s.getBoundingClientRect().left + s.scrollLeft - vasteBreedte(s)), behavior: 'smooth' });
  }
  function syncMaanden() {
    const s = st.el && st.el.querySelector('.mtl-scroll'), bar = st.el && st.el.querySelector('.mtl-mbar'); if (!s || !bar || !bar.offsetParent) return;
    const sr = s.getBoundingClientRect(), vast = vasteBreedte(s), zicht = new Set(); let eerste = null;
    s.querySelectorAll('thead th[data-ym]').forEach(th => { const r = th.getBoundingClientRect(); if (r.right > sr.left + vast + 6 && r.left < sr.right - 6) zicht.add(th.dataset.ym); });
    bar.querySelectorAll('.mtl-mchip').forEach(c => { const aan = zicht.has(c.dataset.ym); c.classList.toggle('in', aan); c.setAttribute('aria-pressed', String(aan)); if (aan && !eerste) eerste = c; });
    if (eerste) { const br = bar.getBoundingClientRect(), cr = eerste.getBoundingClientRect(); if (cr.left < br.left + 8 || cr.right > br.right - 8) bar.scrollTo({ left: bar.scrollLeft + cr.left - br.left - 48, behavior: 'smooth' }); }
  }
  function kopBouw() {
    return h('div', { class: 'mtl-kop' },
      h('div', { class: 'mtl-titelblok' }, h('h1', { class: 'mtl-titel' }, 'Forecast'), h('p', { class: 'mtl-sub' }, 'Schets van de facturatie per maand. De bedragen tellen alleen hier op.')),
      h('div', { class: 'mtl-acties' },
        h('div', { class: 'mtl-seg', role: 'group', 'aria-label': 'Offertebedrag' }, ['incl', 'excl'].map(b => knop(b + '. btw', { class: 'ui-knop' + (st.btw === b ? ' ui-knop--primair' : ''), 'aria-pressed': String(st.btw === b), title: 'Alleen de kolom Bedrag (offertetotaal uit Moneybird)',
          onclick: () => { st.btw = b; ls.set('mtl:btw', b); teken(); } }))),
        st.mob ? h('button', { type: 'button', class: 'ui-knop mtl-m-filter', 'aria-label': 'Filter' + (filterActief() ? ', ' + st.filter.length + ' aan' : ''), 'aria-haspopup': 'dialog', onclick: () => openFilterSheet() }, lijnIcoon(PAD_FILTER), 'Filter', filterActief() ? h('span', { class: 'mtl-m-fn' }, String(st.filter.length)) : null) : null,
        st.mob ? h('button', { type: 'button', class: 'ui-knop mtl-m-ver', 'aria-label': 'Vernieuwen', title: 'Vernieuwen', disabled: st.bezig, onclick: () => L.laad({ vers: true }) }, lijnIcoon(PAD_VERNIEUW)) : knop('Vernieuwen', { disabled: st.bezig, onclick: () => L.laad({ vers: true }) }),
        telefoon() && stijlNieuw() && !st.mob ? knop('Dagoverzicht', { onclick: () => { ls.set('mtl:volledig', '0'); teken(); } }) : null,
        st.opt.openUitgebreid ? knop('Uitgebreide forecast', { title: 'De uitgebreide Forecast (met de prognose van Financiën) staat bij Financiën', onclick: () => st.opt.openUitgebreid() }) : null));
  }
  function teken() {
    sluitPosten();
    if (!st.el) return;
    st.mob = mobielAan();                                           // telefoon in de nieuwe stijl: een eigen dagoverzicht; de tabel is er één tik achter ("Volledige tabel")
    if (st.mob) return tekenMobiel();
    const sl = st.el.querySelector('.mtl-scroll'), sx = sl ? sl.scrollLeft : 0, sy = sl ? sl.scrollTop : 0;
    const oudeBalk = st.el.querySelector('.mtl-mbar'), bx = oudeBalk ? oudeBalk.scrollLeft : null;
    // wie aan het typen is houdt zijn vakje, tekst en cursor bij een hertekening (bv. Vernieuwen of het laden na het openen van de tab)
    const a = document.activeElement, typ = a && a.classList && a.classList.contains('mtl-in') && st.el.contains(a) ? { id: a.dataset.id, ym: a.dataset.ym, v: a.value, s: a.selectionStart, e: a.selectionEnd } : null;
    const ms = maanden(), dezeMaand = nu();
    const delen = [kopBouw()];
    if (st.fout) delen.push(h('div', { class: 'mtl-fout', role: 'alert' }, 'Kon niet laden: ' + st.fout + ' ', knop('Opnieuw', { onclick: () => L.laad({ vers: true }) })));
    const kaart = h('div', { class: 'mtl-kaart' });
    delen.push(kaart);
    if (!st.schets || !st.schatten) {
      kaart.appendChild(h('div', { class: 'mtl-melding' }, st.bezig ? 'Offertes en schets laden\u2026' : 'Nog niets geladen.'));
    } else {
      const alle = L.rijen(st.schatten, st.schets, st.uitbeeld, st.fk), tel = L.tel(alle, ms), rijen = zichtbareRijen(), tot = L.totalen(rijen, ms);
      kaart.appendChild(h('div', { class: 'mtl-balk' },
        L.FILTERS.filter(f => (f !== 'los' || tel.los) && (f !== 'gefactureerd' || tel.gefactureerd) && (f !== 'afgerond' || tel.afgerond)).map(f => h('button', { type: 'button', class: 'mtl-chip', 'aria-pressed': String(st.filter.includes(f)),
          title: f === 'los' ? 'Offertes die niet meer open staan in Moneybird maar waar nog bedragen in de schets staan' : f === 'gefactureerd' ? 'Offertes die niet meer open staan en waarvan facturen in Moneybird staan' : f === 'afgerond' ? 'Helemaal gefactureerd, en in de getoonde maanden telt er niets meer van mee' : f === 'uitbeeld' ? 'Offertes die bij de uitgebreide forecast uit beeld zijn gezet' : null,
          onclick: () => { st.filter = st.filter.includes(f) ? st.filter.filter(x => x !== f) : st.filter.concat(f); ls.set('mtl:filter', JSON.stringify(st.filter)); teken(); } }, STATUS_TEKST[f], h('span', { class: 'mtl-tel' }, String(tel[f])))),
        h('div', { class: 'mtl-nav' },
          knop('\u2039', { title: 'Eén maand terug', 'aria-label': 'Eén maand terug', onclick: () => { st.start = maandPlus(st.start, -1); teken(); } }),
          h('span', { class: 'mtl-periode' }, maandTekst(ms[0]) + ' \u2013 ' + maandTekst(ms[ms.length - 1])),
          knop('\u203a', { title: 'Eén maand verder', 'aria-label': 'Eén maand verder', onclick: () => { st.start = maandPlus(st.start, 1); teken(); } }),
          st.start !== dezeMaand ? knop('Vanaf nu', { onclick: () => { st.start = dezeMaand; teken(); } }) : null)));
      kaart.appendChild(maandenBalk(ms, dezeMaand));
      const thead = h('thead', null, h('tr', null,
        h('th', { class: 's', scope: 'col' }, h('div', { class: 'mtl-sortrij' }, sortKnop('offerte', 'Offerte'), sortKnop('datum', 'Datum'), sortKnop('status', 'Status'))),
        h('th', { class: 'zk', scope: 'col' }, sortKnop('zeker', 'Gaat zeker door')),
        h('th', { class: 'bd num', scope: 'col' }, sortKnop('bedrag', 'Bedrag ' + st.btw + '.')),
        ms.map(m => h('th', { class: 'num' + (m === dezeMaand ? ' nu' : ''), scope: 'col', data: { ym: m } }, sortKnop('m:' + m, [h('span', { class: 'mtl-mm' }, MND_K[Number(m.slice(5, 7)) - 1]), h('span', { class: 'mtl-jj' }, ' ' + m.slice(0, 4))]))),
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
              return h('td', { class: 'num gef' + (m === dezeMaand ? ' nu' : ''), title: titel }, u ? h('a', { class: 'mtl-gefcel', href: u, target: '_blank', rel: 'noopener', 'aria-label': r.naam + ', ' + maandTekst(m) + ': gefactureerd ' + L.fmt(r.gef.maand[m]) }, dtxt(r.gef.maand[m])) : h('span', { class: 'mtl-gefcel' }, dtxt(r.gef.maand[m])));
            }
            return h('td', { class: 'num' + (m === dezeMaand ? ' nu' : '') }, h('input', { class: 'mtl-in' + (st.mislukt.has(sl) ? ' fout' : '') + (st.bewaren.has(sl) ? ' bewaren' : ''), type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: st.mag ? '\u2013' : '',
              'aria-label': r.naam + ', ' + maandTekst(m), disabled: !st.mag, data: { id: r.id, ym: m, oud: v == null ? '' : String(v) }, value: st.mislukt.has(sl) ? (st.mislukt.get(sl).tekst != null ? st.mislukt.get(sl).tekst : L.fmt(st.mislukt.get(sl).nieuw)) : v == null ? '' : dtxt(v), title: telefoon() && v != null && v % 100 ? L.fmt(v) : null })); }),
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
        onclick: () => { st.kasOpen = !st.kasOpen; bewaarKasStand(); teken(); if (!st.tl && !st.tlBezig) laadKas(false); } }, 'Totaal per maand', h('span', { class: 'mtl-meer', 'aria-hidden': 'true' }, st.kasOpen ? '▾' : '⋯')),
        st.kasOpen ? h('button', { type: 'button', class: 'mtl-link', title: 'Welke vaste betaling of leverancier in welke groep, lonen en eigen terugkerende posten (bv. Interprojecten)', disabled: !st.tl, onclick: () => openIndeling() }, 'Indeling…') : null))];
      if (st.kasOpen) {
        voet.push(voetRij('zeker', 'k', h('span', { class: 'mtl-sub0' }, 'waarvan gaat zeker door')));
        voet.push(voetRij('gef', 'k', vink('gef', 'Gefactureerd', 'Alle verkoopfacturen van die maand (incl. btw; mouse-over per maand voor de lijst). Facturen bij een offerte staan al in het totaal; met het vinkje tellen ook de facturen zonder offerte mee in het netto resultaat.')));
        for (const g of L.KAS_GROEPEN) voet.push(voetRij(g, 'k', g === 'vast' ? h('span', { class: 'mtl-vinkrij' }, vink(g, KAS_TEKST[g], KAS_UITLEG[g]), h('span', { class: 'mtl-loon' }, 'loon', L.LONEN.map(([k, n]) => vink(L.loonAanSleutel(k), n, 'Loon van ' + n + ' meetellen')))) : vink(g, KAS_TEKST[g], KAS_UITLEG[g])));
      }
      // Netto resultaat staat altijd vast onder het totaal; de vinkjes in de uitsplitsing bepalen wat meetelt.
      voet.push(voetRij('netto', 'netto', h('span', { class: 'mtl-somkop' }, h('span', { title: 'Totaal per maand plus de aangevinkte regels uit de uitsplitsing (kosten zijn negatief; klik op Totaal per maand om te zien wat meetelt). Kas, incl. btw.' }, 'Netto resultaat'),
          st.tlFout ? h('span', { class: 'mtl-kasfout', title: st.tlFout }, '⚠ kosten niet geladen ', h('button', { type: 'button', class: 'mtl-link', onclick: () => laadKas(true) }, 'opnieuw')) : null,
          st.histFout && st.mag ? h('span', { class: 'mtl-kasfout', title: 'Bankgegevens niet bijgewerkt: ' + st.histFout + '. Voorbije maanden tonen de laatst berekende stand.' }, '\u26a0 bank niet bijgewerkt ', h('button', { type: 'button', class: 'mtl-link', onclick: () => vernieuwHist() }, 'opnieuw')) : null,
          st.tl && st.tl.onvolledig.length ? h('span', { class: 'mtl-kasfout', title: 'Het overzicht van Financiën is niet compleet:\n' + st.tl.onvolledig.slice(0, 10).join('\n') }, '⚠ mogelijk onvolledig ', h('button', { type: 'button', class: 'mtl-link', onclick: () => laadKas(true) }, 'opnieuw')) : null)));
      const tfoot = h('tfoot', null, voet);
      // vast onderaan: elke regel krijgt als bottom de hoogte van de regels eronder
      { let b = 0; for (const tr of voet.slice().reverse()) { for (const c of tr.children) c.style.bottom = b + 'px'; b += tr.classList.contains('k') ? 38 : 34; } }
      const kostTd = ev => { const td = ev.target.closest && ev.target.closest('td[data-i].klik'), tr = td && td.parentElement; return td && tr && L.KAS_GROEPEN.includes(tr.dataset.rij) ? [tr.dataset.rij, Number(td.dataset.i), td] : null; };
      tfoot.addEventListener('click', ev => { const k = kostTd(ev); if (!k) return; if (st.pop && st.pop.td === k[2]) return sluitPosten(); toonPosten(...k); });
      tfoot.addEventListener('keydown', ev => { const k = kostTd(ev); if (k && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); toonPosten(...k); } });
      tfoot.addEventListener('change', ev => { const g = ev.target.dataset && ev.target.dataset.kas; if (!g) return; st.kasAan[g] = ev.target.checked; bewaarKasStand(); werkBij(); });
      const tabel = h('table', { class: 'mtl-tabel' + (st.kasOpen ? ' kasopen' : '') }, thead, tbody, tfoot);
      tabel.addEventListener('focusin', ev => { const i = ev.target; if (!i.classList || !i.classList.contains('mtl-in')) return;
        const sl = i.dataset.id + '|' + i.dataset.ym;   // telefoon: in het vakje staat altijd het exacte bedrag (het afgeronde getal is alleen om te lezen)
        if (telefoon() && i.dataset.oud !== '' && !st.bewaren.has(sl) && !st.mislukt.has(sl) && i.value === dtxt(Number(i.dataset.oud))) i.value = L.fmt(Number(i.dataset.oud));
        i.select(); });
      tabel.addEventListener('focusout', ev => { const i = ev.target; if (!telefoon() || !i.classList || !i.classList.contains('mtl-in')) return;
        setTimeout(() => { if (document.activeElement === i || !i.isConnected || i.dataset.oud === '') return; const sl = i.dataset.id + '|' + i.dataset.ym;
          if (!st.bewaren.has(sl) && !st.mislukt.has(sl) && i.value === L.fmt(Number(i.dataset.oud))) i.value = dtxt(Number(i.dataset.oud)); }, 0); });
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
    const nb = st.el.querySelector('.mtl-mbar');
    if (nb) { if (bx != null) nb.scrollLeft = bx; else { const nuc = nb.querySelector('.mtl-mchip.nu'); if (nuc) nb.scrollLeft = Math.max(0, nuc.offsetLeft - 64); } }
    if (sl2) { let raf = 0; sl2.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; syncMaanden(); }); }, { passive: true }); }
    syncMaanden();
    if (typ) { const i = st.el.querySelector(`input.mtl-in[data-id="${typ.id}"][data-ym="${typ.ym}"]`); if (i && !i.disabled) { i.value = typ.v; i.focus({ preventScroll: true }); try { i.setSelectionRange(typ.s, typ.e); } catch (e) { } } }
  }
  // ── Dagoverzicht voor de telefoon (alleen telefoon() én nieuwe stijl; "Volledige tabel" schakelt naar de tabel en terug, onthouden in mtl:volledig) ──
  // Alle cijfers komen uit L.cijfers / L.nuFactureren / L.offertesMet (dus uit dezelfde L.*-regels als de tabel); opslaan gaat via verwerk/bewaar/stuur/zetZeker
  // (concepten, 409, oud-vergelijking): een offerte-sheet die je alleen opent en sluit slaat nooit iets op, want opslaan volgt pas op een wijziging (change).
  const stijlNieuw = () => document.documentElement.getAttribute('data-stijl') === 'nieuw';
  const mobielAan = () => telefoon() && stijlNieuw() && ls.get('mtl:volledig') !== '1';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const PAD_CHEV = 'M9 6l6 6l-6 6', PAD_X = 'M6 6l12 12M18 6L6 18', PAD_REGELS = 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4', PAD_LINKS = 'M15 6l-6 6l6 6';
  function lijnIcoon(pad) { const s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'mtl-ico'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false'); const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', pad); s.appendChild(p); return s; }
  const ONBEKEND_TEKST = 'Geen (complete) bankgegevens voor deze maand';
  const PAD_FILTER = 'M3 5h18l-7 8v6l-4 2v-8z', PAD_NEER = 'M6 9l6 6l6-6', PAD_VERNIEUW = 'M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5', FILTER_STANDAARD = ['geaccepteerd', 'openstaand', 'los', 'gefactureerd'];
  const eur = cc => (cc < 0 ? '\u2212' : '') + '\u20ac\u00a0' + duizend(Math.round(Math.abs(cc) / 100));
  // Het gekozen blok maanden (bewaard in mtl:mper): voorkeuzen rekenen elke keer vanaf deze maand, een vrije keuze of verschuiving ligt vast.
  const mobSel = () => { if (st.mSel === undefined) { try { const x = JSON.parse(ls.get('mtl:mper') || 'null'); st.mSel = x && typeof x === 'object' ? x : null; } catch (e) { st.mSel = null; } } return st.mSel; };
  const zetMobSel = sel => { st.mSel = sel; ls.set('mtl:mper', JSON.stringify(sel)); };
  const mobPeriode = () => L.periode(mobSel(), nu());
  const mobMaanden = () => { const p = mobPeriode(); return L.maanden(p.start, p.n); };
  const kostenGroepen = () => L.KAS_GROEPEN.concat(st.fact ? ['gef'] : []);
  const maandVerschil = (a, b) => (Number(b.slice(0, 4)) * 12 + Number(b.slice(5, 7))) - (Number(a.slice(0, 4)) * 12 + Number(a.slice(5, 7)));
  function mobCijfers(ms) {
    const alle = L.rijen(st.schatten, st.schets, st.uitbeeld, st.fk), rijen = L.sorteer(L.filter(alle, st.filter, ms), st.sort, st.btw, ms), nuYm = st.tl ? st.tl.vandaag.slice(0, 7) : null;
    return { alle, rijen, c: L.cijfers({ rijen, ms, fact: st.fact, fk: st.fk, regels: kasRegels(ms), aan: st.kasAan, nuYm, hist: st.tl && st.tl.hist, histAsOf: st.tl && st.tl.histAsOf }) };
  }
  const filterActief = () => st.filter.length !== FILTER_STANDAARD.length || !FILTER_STANDAARD.every(f => st.filter.includes(f));
  function tekenMobiel() {
    if (!st.el) return;
    const ms = mobMaanden(), n = ms.length, delen = [kopBouw()];
    if (st.fout) delen.push(h('div', { class: 'mtl-fout', role: 'alert' }, 'Kon niet laden: ' + st.fout + ' ', knop('Opnieuw', { onclick: () => L.laad({ vers: true }) })));
    if (!st.schets || !st.schatten) delen.push(h('div', { class: 'mtl-melding' }, st.bezig ? 'Offertes en schets laden\u2026' : 'Nog niets geladen.'));
    else {
      // De filter geldt voor de cijfers én de lijsten, precies als in de tabel (L.filter met dezelfde st.filter).
      const { rijen, c } = mobCijfers(ms), dezeMaand = nu(), dens = n <= 4 ? 'd1' : n <= 6 ? 'd2' : 'd3', fm = dens === 'd3' ? L.kortD : L.kortK, jr = (m, i) => m.slice(5) === '01' && i > 0 ? ' jr' : '';
      // 1. de gekozen maanden naast elkaar (schaalt mee: geen horizontaal scrollen): In, Kosten, Netto
      const cel = (tekst, titel, klasse, m, i) => h('div', { class: 'mtl-m-c' + (klasse ? ' ' + klasse : '') + jr(m, i), title: titel || null }, tekst);
      const kostCel = (i, m) => !st.tl ? cel(st.tlBezig ? '\u2026' : '\u2013', st.tlFout || null, '', m, i) : cel(fm(c.kosten[i]), L.fmt(c.kosten[i]), '', m, i);
      const kopCel = (m, i) => { const inh = [h('b', null, MND_K[Number(m.slice(5, 7)) - 1]), dens === 'd3' ? null : h('span', null, m.slice(0, 4))], kl = 'mtl-m-mnd' + (m === dezeMaand ? ' nu' : '') + jr(m, i);
        return dens === 'd3' ? h('div', { class: kl, 'aria-label': maandTekst(m), title: maandTekst(m) }, inh)
          : h('button', { type: 'button', class: kl, 'aria-label': maandTekst(m) + ': kosten bekijken en aanpassen', title: 'Kosten van ' + maandTekst(m) + ' bekijken en aanpassen', onclick: () => openKostenSheet(i) }, inh); };
      const x = kostenGroepen().filter(g => st.kasAan[g] !== false).length, y = kostenGroepen().length;
      const kostenKnop = h('button', { type: 'button', class: 'mtl-m-ksb' + (x < y ? ' stip' : ''), 'aria-label': 'Kosten die meetellen', title: 'Kosten die meetellen' + (x < y ? ' (niet alles staat aan)' : ''), onclick: () => openKostenSheet(0) }, lijnIcoon(PAD_REGELS));
      const grid = h('div', { class: 'mtl-m-grid mtl-m-' + dens, style: 'grid-template-columns:' + (dens === 'd3' ? '72px' : '84px') + ' repeat(' + n + ',minmax(0,1fr))', role: 'group', 'aria-label': n + ' maanden: in, kosten en netto' },
        h('div', { class: 'mtl-m-l' }), ms.map(kopCel),
        h('div', { class: 'mtl-m-l' }, 'In'), ms.map((m, i) => c.onbekend[i] ? cel('\u2013', ONBEKEND_TEKST, '', m, i) : cel(fm(c.inkomen[i]), L.fmt(c.inkomen[i]), '', m, i)),
        h('div', { class: 'mtl-m-l' }, 'Kosten'), ms.map((m, i) => kostCel(i, m)),
        h('div', { class: 'mtl-m-l mtl-m-nl' }, h('span', null, 'Netto'), kostenKnop),
        ms.map((m, i) => c.onbekend[i] ? cel('\u2013', ONBEKEND_TEKST, 'mtl-m-netto', m, i) : cel(fm(c.netto[i]), L.fmt(c.netto[i]), 'mtl-m-netto ' + (c.netto[i] < 0 ? 'rood' : 'groen') + (st.tl ? '' : ' zonder'), m, i)));
      const p = mobPeriode(), sel = mobSel(), verschuif = r => () => { zetMobSel({ p: 'vrij', s: maandPlus(p.start, r * p.n), n: p.n }); teken(); };
      const periode = h('div', { class: 'mtl-m-per' },
        h('button', { type: 'button', class: 'mtl-m-pijl', 'aria-label': 'Het blok maanden terug schuiven', onclick: verschuif(-1) }, lijnIcoon(PAD_LINKS)),
        h('button', { type: 'button', class: 'mtl-m-pt', 'aria-haspopup': 'dialog', title: 'Andere maanden kiezen', onclick: () => openMaandSheet() }, n === 1 ? maandTekst(ms[0]) : maandTekst(ms[0]) + ' \u2013 ' + maandTekst(ms[n - 1]), lijnIcoon(PAD_NEER)),
        h('button', { type: 'button', class: 'mtl-m-pijl', 'aria-label': 'Het blok maanden vooruit schuiven', onclick: verschuif(1) }, lijnIcoon(PAD_CHEV)),
        sel && sel.p && sel.p !== 'std' ? knop('Nu', { class: 'ui-knop mtl-m-nu', title: 'Terug naar deze maand + 3', onclick: () => { zetMobSel(null); teken(); } }) : null);
      const melding = !st.tl ? h('div', { class: 'mtl-m-let' }, st.tlBezig ? 'Kosten laden\u2026' : '\u26a0 Kosten niet geladen: netto is nu alleen de facturatie. ', !st.tlBezig ? knop('Opnieuw', { onclick: () => laadKas(true) }) : null)
        : st.tl.onvolledig.length ? h('div', { class: 'mtl-m-let' }, '\u26a0 Het overzicht van Financi\u00ebn is mogelijk onvolledig; er kunnen kosten ontbreken.') : null;
      delen.push(h('section', { class: 'mtl-m-blok ' + dens }, periode, grid, dens === 'd3' ? h('p', { class: 'mtl-m-cap' }, 'Bedragen in duizenden euro\u2019s') : null, melding));
      // 2. nu factureren, 3. open offertes (concept ingeklapt), allebei uit de gefilterde rijen
      const nuYm = nu(), nf = L.nuFactureren(rijen, nuYm, st.btw), op = L.offertesMet(rijen, nuYm, 'openstaand', st.btw).concat(L.nietIngepland(rijen, st.btw)), co = L.offertesMet(rijen, nuYm, 'concept', st.btw);
      const rij = (it, sub, bedrag) => h('button', { type: 'button', class: 'mtl-m-rij', onclick: () => openOfferteSheet(it.r.id) }, h('span', { class: 'mtl-m-rn' }, h('b', null, it.r.naam), h('small', null, sub)),
        h('span', { class: 'mtl-m-rb', title: bedrag == null ? null : L.fmt(bedrag) }, bedrag == null ? '\u2013' : eur(bedrag)), lijnIcoon(PAD_CHEV));
      const sec = (titel, k, lijst, leeg) => h('section', { class: 'mtl-m-sec' }, h('h2', { class: 'mtl-m-h' }, titel + ' (' + k + ')'), k ? lijst : h('p', { class: 'mtl-m-leeg' }, leeg));
      const openSub = it => it.nietIngepland ? 'geaccepteerd \u00b7 nog niet gepland' + (it.r.nummer ? ' \u00b7 offerte ' + it.r.nummer : '') : (it.eerstvolgende ? 'gepland: ' + maandTekst(it.eerstvolgende) : 'nog niets gepland') + (it.r.nummer ? ' \u00b7 offerte ' + it.r.nummer : '');
      delen.push(sec('Nu factureren', nf.length, nf.map(it => rij(it, 'gepland: ' + it.gepland.map(maandTekst).join(', '), it.bedrag)), 'Niets dat nu gefactureerd kan worden.'));
      delen.push(sec('Open offertes', op.length, op.map(it => rij(it, openSub(it), it.bedrag)), 'Geen openstaande offertes.'));
      if (co.length) delen.push(h('section', { class: 'mtl-m-sec' }, h('button', { type: 'button', class: 'mtl-m-h mtl-m-hk', 'aria-expanded': String(!!st.mConcept), onclick: () => { st.mConcept = !st.mConcept; teken(); } }, 'Concept (' + co.length + ')', lijnIcoon(st.mConcept ? PAD_NEER : PAD_CHEV)),
        st.mConcept ? co.map(it => rij(it, openSub(it), it.bedrag)) : null));
      const w = [st.afgekapt ? 'Let op: niet alle offertes uit Moneybird zijn geladen.' : null, st.factFout ? 'De facturen uit Moneybird zijn niet geladen (' + st.factFout + '): alleen de schets telt. Probeer Vernieuwen.' : null].filter(Boolean);
      if (w.length) delen.push(h('div', { class: 'mtl-m-let' }, w.join(' ')));
      delen.push(knop('Volledige tabel', { class: 'ui-knop mtl-m-tabel', onclick: () => { ls.set('mtl:volledig', '1'); sluitSheet(); teken(); } }));
    }
    st.el.replaceChildren(h('div', { class: 'mtl mtl--m' + (st.bezig ? ' bezig' : '') }, delen));
  }
  // ── Sheets (van onderaf): kosten en offerte ──
  // Alles wat in een vakje van de sheet getypt staat maar nog niet (via change) is verwerkt, gaat eerst via verwerk/bewaar/stuur weg (concept, 409, oud-vergelijking); een ongewijzigd vakje stuurt niets.
  function spoelSheet() {
    const s = st.sheet; if (!s || s.soort !== 'offerte' || !st.mag) return;
    s.el.querySelectorAll('input.mtl-in:not([disabled])').forEach(inp => { const o = inp.dataset.oud, sl = inp.dataset.id + '|' + inp.dataset.ym;
      if (st.mislukt.has(sl) || inp.value === (o === '' ? '' : L.fmt(Number(o)))) return;   // ongewijzigd, of al als mislukt/rood vastgelegd
      if (st.bewaren.has(sl) && L.leesInvoer(inp.value).c === st.bewaren.get(sl)) return;    // dit bedrag wordt al opgeslagen
      verwerk(inp); });
  }
  function sluitSheet() { const s = st.sheet; if (!s) return; try { spoelSheet(); } catch (e) { } document.removeEventListener('keydown', s.esc); document.removeEventListener('visibilitychange', s.verborgen); window.removeEventListener('pagehide', s.verborgen); s.el.remove(); s.bg.remove(); st.sheet = null; }
  L.sluitSheet = () => sluitSheet();
  function maakSheet(soort, extra) {
    sluitSheet(); sluitPosten();
    const bg = h('div', { class: 'mtl-popbg', onclick: () => sluitSheet() }), el = h('div', { class: 'mtl-sheet', role: 'dialog', 'aria-modal': 'true' });
    const esc = ev => { if (ev.key === 'Escape' && !(ev.target.classList && ev.target.classList.contains('mtl-in'))) sluitSheet(); };
    const verborgen = () => { if (document.visibilityState !== 'visible') spoelSheet(); };   // app naar de achtergrond of pagina dicht: wat er getypt staat gaat eerst weg
    document.body.appendChild(bg); document.body.appendChild(el); document.addEventListener('keydown', esc); document.addEventListener('visibilitychange', verborgen); window.addEventListener('pagehide', verborgen);
    st.sheet = Object.assign({ soort, el, bg, esc, verborgen }, extra); return el;
  }
  const sheetKop = (titel, sub) => h('div', { class: 'mtl-sheet-kop' }, h('div', { class: 'mtl-sheet-t' }, h('b', null, titel), sub ? h('small', null, sub) : null),
    h('button', { type: 'button', class: 'mtl-sheet-x', 'aria-label': 'Sluiten', onclick: () => sluitSheet() }, lijnIcoon(PAD_X)));
  function vernieuwSheet() { const s = st.sheet; if (!s) return; if (!s.el.isConnected) { st.sheet = null; return; } if (s.soort === 'kosten') vulKostenSheet(); else if (s.soort === 'filter') vulFilterSheet(); else if (s.soort === 'offerte') vulOfferteSheet(false); }
  function openKostenSheet(i) {
    const el = maakSheet('kosten', {}); st.ksIdx = i || 0; vulKostenSheet();
    const x = el.querySelector('.mtl-sheet-x'); if (x) x.focus({ preventScroll: true });
  }
  // Kosten die meetellen: dezelfde schakelaars (st.kasAan) en loonvinkjes als de tabel; een lokale weergave-instelling, dus ook voor de rol lezen. Onderaan het netto van de gekozen maand, direct ververst.
  function vulKostenSheet() {
    const s = st.sheet; if (!s || s.soort !== 'kosten') return;
    const el = s.el, hoog = el.scrollTop, a = document.activeElement, actief = a && el.contains(a) ? a.dataset.kas || (a.dataset.m != null ? 'm' + a.dataset.m : null) : null;
    const ms = mobMaanden(), { c } = mobCijfers(ms), i = Math.min(st.ksIdx || 0, ms.length - 1), aan = st.kasAan;
    const netto = c.onbekend[i] ? null : c.netto[i];
    const wissel = g => ev => { st.kasAan[g] = ev.target.checked; bewaarKasStand(); tekenMobiel(); vulKostenSheet(); };
    const vink = (g, tekst, bedrag, sub) => h('label', { class: 'mtl-ks-rij' + (sub ? ' sub' : '') }, h('input', { type: 'checkbox', class: 'mtl-ks-in', data: { kas: g }, checked: aan[g] !== false, onchange: wissel(g) }), h('span', { class: 'mtl-ks-v', 'aria-hidden': 'true' }),
      h('span', { class: 'mtl-ks-t' }, tekst), bedrag != null ? h('span', { class: 'mtl-ks-b', title: L.fmt(bedrag) }, L.kortK(bedrag)) : null);
    const rijen = [];
    for (const g of L.KAS_GROEPEN) {
      rijen.push(vink(g, KAS_TEKST[g], c.kt ? c.kt[g].per[i] : null));
      if (g === 'vast') for (const [k, n] of L.LONEN) rijen.push(vink(L.loonAanSleutel(k), 'Loon ' + n, null, true));
    }
    if (st.fact) rijen.push(vink('gef', 'Facturen zonder offerte', c.losPer[i]));
    el.replaceChildren(sheetKop('Kosten die meetellen', 'Tik een maand om te wisselen'),
      h('div', { class: 'mtl-ks-mnd', role: 'group', 'aria-label': 'Maand' }, ms.map((m, j) => h('button', { type: 'button', class: 'mtl-ks-mk' + (j === i ? ' aan' : ''), 'aria-pressed': String(j === i), data: { m: String(j) }, onclick: () => { st.ksIdx = j; vulKostenSheet(); } }, MND_K[Number(m.slice(5, 7)) - 1]))),
      h('div', { class: 'mtl-ks-lijst' }, !st.tl ? h('p', { class: 'mtl-m-let' }, st.tlBezig ? 'Kosten laden…' : '⚠ De kosten zijn niet geladen. ', !st.tlBezig ? knop('Opnieuw', { onclick: () => laadKas(true) }) : null) : null, rijen),
      h('div', { class: 'mtl-ks-voet' }, h('span', { class: 'mtl-ks-vl' }, 'Netto ' + maandTekst(ms[i])),
        h('b', { class: 'mtl-ks-net ' + (netto == null ? '' : netto < 0 ? 'rood' : 'groen'), title: netto == null ? ONBEKEND_TEKST : L.fmt(netto) }, netto == null ? '\u2013' : eur(netto))));
    el.scrollTop = hoog;
    if (actief) { const n = /^m\d$/.test(actief) ? el.querySelector(`[data-m="${actief.slice(1)}"]`) : el.querySelector(`input[data-kas="${actief}"]`); if (n) n.focus({ preventScroll: true }); }
  }
  // ── Maandkiezer en filter (sheets) ──
  // Maandkiezer zoals bij Moneybird: voorkeuzen bovenin, daaronder een jaarraster waarin je een begin- en eindmaand tikt (hooguit 12 maanden).
  function openMaandSheet() {
    const p = mobPeriode(); st.pk = { a: p.start, b: maandPlus(p.start, p.n - 1), jaar: Number(p.start.slice(0, 4)) };
    const el = maakSheet('maand', {}); vulMaandSheet(); const x = el.querySelector('.mtl-sheet-x'); if (x) x.focus({ preventScroll: true });
  }
  function vulMaandSheet() {
    const s = st.sheet; if (!s || s.soort !== 'maand') return;
    const pk = st.pk, sel = mobSel(), actief = (sel && sel.p) || 'std', hoog = s.el.scrollTop, b = pk.b || pk.a, aantal = maandVerschil(pk.a, b) + 1;
    const kies = ym => { if (pk.b || !pk.a) { pk.a = ym; pk.b = null; } else { let u = pk.a, v = ym; if (v < u) [u, v] = [v, u]; if (maandVerschil(u, v) > 11) v = maandPlus(u, 11); pk.a = u; pk.b = v; } vulMaandSheet(); };
    const voor = [['std', 'Deze maand + 3'], ['kw', 'Dit kwartaal'], ['vkw', 'Volgend kwartaal'], ['6', '6 maanden'], ['jaar', 'Dit jaar']];
    const raster = Array.from({ length: 12 }, (_, i) => { const ym = pk.jaar + '-' + String(i + 1).padStart(2, '0'), inb = ym >= pk.a && ym <= b;
      return h('button', { type: 'button', class: 'mtl-mp-m' + (inb ? ' in' : '') + (ym === pk.a || ym === b ? ' end' : ''), 'aria-pressed': String(inb), 'aria-label': maandTekst(ym), onclick: () => kies(ym) }, MND_K[i]); });
    s.el.replaceChildren(sheetKop('Maanden kiezen', 'Kies een voorkeuze of tik een begin- en eindmaand'),
      h('div', { class: 'mtl-mp-voor' }, voor.map(([k, t]) => h('button', { type: 'button', class: 'mtl-mp-v' + (k === actief ? ' aan' : ''), 'aria-pressed': String(k === actief), onclick: () => { zetMobSel(k === 'std' ? null : { p: k }); sluitSheet(); teken(); } }, t))),
      h('div', { class: 'mtl-mp-jaar' }, h('button', { type: 'button', class: 'mtl-m-pijl', 'aria-label': 'Vorig jaar', onclick: () => { pk.jaar--; vulMaandSheet(); } }, lijnIcoon(PAD_LINKS)), h('b', null, String(pk.jaar)),
        h('button', { type: 'button', class: 'mtl-m-pijl', 'aria-label': 'Volgend jaar', onclick: () => { pk.jaar++; vulMaandSheet(); } }, lijnIcoon(PAD_CHEV))),
      h('div', { class: 'mtl-mp-grid' }, raster),
      h('div', { class: 'mtl-ks-voet' }, h('span', { class: 'mtl-mp-t' }, (pk.b ? maandTekst(pk.a) + ' \u2013 ' + maandTekst(pk.b) : pk.a === b ? maandTekst(pk.a) + ' \u2013 tik een eindmaand' : maandTekst(pk.a)) + ' \u00b7 ' + aantal + (aantal === 1 ? ' maand' : ' maanden') + ' (hooguit 12)'),
        knop('Toepassen', { class: 'ui-knop ui-knop--primair mtl-mp-ok', onclick: () => { zetMobSel({ p: 'vrij', s: pk.a, n: aantal }); sluitSheet(); teken(); } })));
    s.el.scrollTop = hoog;
  }
  // Filter: dezelfde statusfilters, dezelfde st.filter en opslag (mtl:filter) als de chips boven de tabel; de cijfers en lijsten volgen direct.
  function openFilterSheet() { const el = maakSheet('filter', {}); vulFilterSheet(); const x = el.querySelector('.mtl-sheet-x'); if (x) x.focus({ preventScroll: true }); }
  function vulFilterSheet() {
    const s = st.sheet; if (!s || s.soort !== 'filter') return;
    const el = s.el, hoog = el.scrollTop, a = document.activeElement, actief = a && el.contains(a) ? a.dataset.filter : null, ms = mobMaanden(), tel = L.tel(L.rijen(st.schatten, st.schets, st.uitbeeld, st.fk), ms);
    const zet = f => ev => { st.filter = ev.target.checked ? st.filter.concat(f) : st.filter.filter(x => x !== f); ls.set('mtl:filter', JSON.stringify(st.filter)); tekenMobiel(); vulFilterSheet(); };
    const rijen = L.FILTERS.filter(f => (f !== 'los' || tel.los) && (f !== 'gefactureerd' || tel.gefactureerd) && (f !== 'afgerond' || tel.afgerond)).map(f => h('label', { class: 'mtl-ks-rij' }, h('input', { type: 'checkbox', class: 'mtl-ks-in', data: { filter: f }, checked: st.filter.includes(f), onchange: zet(f) }), h('span', { class: 'mtl-ks-v', 'aria-hidden': 'true' }),
      h('span', { class: 'mtl-ks-t' }, STATUS_TEKST[f]), h('span', { class: 'mtl-ks-b' }, String(tel[f]))));
    el.replaceChildren(sheetKop('Filter', 'Welke offertes meetellen in de cijfers en de lijsten'), h('div', { class: 'mtl-ks-lijst' }, rijen),
      h('div', { class: 'mtl-ks-voet' }, h('span', { class: 'mtl-mp-t' }, st.filter.length + ' van ' + L.FILTERS.length + ' aan'), knop('Standaard', { disabled: !filterActief(), onclick: () => { st.filter = FILTER_STANDAARD.slice(); ls.set('mtl:filter', JSON.stringify(st.filter)); tekenMobiel(); vulFilterSheet(); } })));
    el.scrollTop = hoog; if (actief) { const n = el.querySelector(`input[data-filter="${actief}"]`); if (n) n.focus({ preventScroll: true }); }
  }
  function openOfferteSheet(id) {
    const el = maakSheet('offerte', { id }); vulOfferteSheet(true);
    const x = el.querySelector('.mtl-sheet-x'); if (x) x.focus({ preventScroll: true });
  }
  // Offerte-sheet: status, bedragen, "zeker" en de maandregels met het bedragveld (zelfde invoer, concept- en conflictregels als de tabel). Is er een vakje in gebruik, dan worden alleen de vakjes bijgewerkt (nooit door iemands getyp heen).
  function vulOfferteSheet(nieuwBouw) {
    const s = st.sheet; if (!s || s.soort !== 'offerte') return;
    const r = rijVan(s.id); if (!r) { sluitSheet(); return; }
    const a = document.activeElement, typt = !nieuwBouw && a && s.el.contains(a) && a.classList && a.classList.contains('mtl-in');
    if (typt || !nieuwBouw && s.el.querySelector('.mtl-in.bewaren')) {
      s.el.querySelectorAll('input.mtl-in').forEach(inp => { const sl = inp.dataset.id + '|' + inp.dataset.ym; inp.classList.toggle('fout', st.mislukt.has(sl)); inp.classList.toggle('bewaren', st.bewaren.has(sl));
        const v = r.cellen[inp.dataset.ym]; inp.dataset.oud = v == null ? '' : String(v); if (document.activeElement === inp || st.bewaren.has(sl)) return;
        const m = st.mislukt.get(sl), toon = m ? m.nieuw : v; inp.value = m && m.tekst != null ? m.tekst : toon == null ? '' : L.fmt(toon); });
      return;
    }
    const hoog = s.el.scrollTop, b = L.bedrag(r, st.btw), nog = L.nog(r, st.btw), gefBedrag = r.gef ? (st.btw === 'excl' ? r.gef.exclC : r.gef.inclC) : null;
    const stBadge = r.uitbeeld ? h('span', { class: 'mtl-st uitbeeld' }, 'Uit beeld') : r.fstatus ? h('span', { class: 'mtl-st f-' + r.fstatus }, FSTATUS_TEKST[r.fstatus]) : h('span', { class: 'mtl-st ' + r.status }, STATUS_TEKST[r.status]);
    const href = !r.los && st.opt.administratie ? root.MTForecast.mbUrl(st.opt.administratie(), 'estimates', r.id) : null;
    const dl = (k, v) => h('div', { class: 'mtl-os-dl' }, h('span', null, k), h('b', null, v));
    const set = new Set(L.maanden(nu(), 12)); for (const m of Object.keys(r.cellen).concat(r.gef ? Object.keys(r.gef.maand) : [])) set.add(m);
    const maanden = [...set].sort();
    const maandRij = m => {
      const v = r.cellen[m], sl = r.id + '|' + m;
      if (L.vast(r, m)) return h('div', { class: 'mtl-os-rij vast' }, h('span', null, maandTekst(m)), h('span', { class: 'mtl-os-gf', title: 'Gefactureerd in Moneybird; je schetsbedrag' + (v != null ? ' (' + L.fmt(v) + ')' : '') + ' blijft bewaard maar telt niet' }, L.fmt(r.gef.maand[m]), h('small', null, 'gefactureerd')));
      return h('label', { class: 'mtl-os-rij' }, h('span', null, maandTekst(m)), h('input', { class: 'mtl-in' + (st.mislukt.has(sl) ? ' fout' : '') + (st.bewaren.has(sl) ? ' bewaren' : ''), type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: st.mag ? '–' : '', 'aria-label': r.naam + ', ' + maandTekst(m),
        disabled: !st.mag, data: { id: r.id, ym: m, oud: v == null ? '' : String(v) }, value: st.mislukt.has(sl) ? (st.mislukt.get(sl).tekst != null ? st.mislukt.get(sl).tekst : L.fmt(st.mislukt.get(sl).nieuw)) : v == null ? '' : L.fmt(v),
        onfocus: ev => ev.target.select(), onchange: ev => verwerk(ev.target), oninput: ev => getypt(ev.target), onkeydown: toets }));
    };
    s.el.replaceChildren(sheetKop(r.naam, [r.nummer ? 'offerte ' + r.nummer : null, r.datum ? r.datum.split('-').reverse().join('-') : null].filter(Boolean).join(' · ')),
      h('div', { class: 'mtl-os' },
        h('div', { class: 'mtl-os-st' }, stBadge, href ? h('a', { class: 'mtl-link mtl-os-mb', href, target: '_blank', rel: 'noopener' }, 'Open in Moneybird') : null),
        dl('Offertebedrag (' + st.btw + '. btw)', b == null ? '–' : L.fmt(b)), dl('Al gefactureerd', gefBedrag == null ? '–' : L.fmt(gefBedrag)), dl('Nog openstaand', nog == null ? '–' : L.fmt(nog)),
        h('label', { class: 'mtl-os-zeker' }, h('span', null, 'Gaat zeker door'), h('span', { class: 'mtl-sw', title: 'Gaat zeker door (alleen voor deze schets)' }, h('input', { type: 'checkbox', class: 'mtl-zk', role: 'switch', data: { id: r.id }, 'aria-label': 'Gaat zeker door: ' + r.naam, disabled: !st.mag, checked: r.zeker, onchange: ev => { const t = ev.target; t.disabled = true; zetZeker(r.id, t.checked).finally(() => { t.disabled = !st.mag; }); } }), h('span'))),   // uit tot het verzoek klaar is: twee snelle tikken keren niet om
        h('h3', { class: 'mtl-os-h' }, 'Planning per maand' + (st.mag ? '' : ' (alleen kijken)')),
        maanden.map(maandRij)));
    s.el.scrollTop = hoog;
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
