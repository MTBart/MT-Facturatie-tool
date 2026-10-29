// mt-geld.js — het geldscherm (geldtijdlijn): kaarten, lijn met zoom, lijst van 14 dagen, potjes met doelen,
// instellingen en uitleg. Alleen met recht `geld` (de worker dwingt dat af; dit scherm verbergt alleen).
// Data komt van de worker (/geld/*) via een "bron" { haal(pad, {method, body}) → json }; in de demo een fixture.
// Rekenregels (zie worker): elk event heeft `delta` = effect op zijn rekening (+ = erbij); intern + pot → de pot
// krijgt −delta (totaal blijft gelijk). Bankevents = verleden (zit al in het saldo van vandaag); de rest is gepland.
(function (root) {
  'use strict';
  const G = root.MTGeld = root.MTGeld || {};
  const DAG = 864e5;
  const dagPlus = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const dagenTussen = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAG);
  const rond = n => Math.round(n * 100) / 100;
  G._dagPlus = dagPlus; G._dagenTussen = dagenTussen;
  // Bankdagen (zoals de worker): geen weekend, geen NL-bankfeestdag (Nieuwjaar, Goede Vrijdag, Paasmaandag, Koningsdag,
  // Hemelvaart, Pinkstermaandag, Kerst). Nodig als het scenario een ontvangst verschuift.
  const feest = {};
  function feestdagen(j) {
    if (feest[j]) return feest[j];
    const a = j % 19, b = Math.floor(j / 100), c = j % 100, h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30,
      l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mnd = Math.floor((h + l - 7 * m + 114) / 31), dg = ((h + l - 7 * m + 114) % 31) + 1;
    const pasen = `${j}-${String(mnd).padStart(2, '0')}-${String(dg).padStart(2, '0')}`, koning = new Date(Date.UTC(j, 3, 27)).getUTCDay() === 0 ? `${j}-04-26` : `${j}-04-27`;
    return (feest[j] = new Set([`${j}-01-01`, dagPlus(pasen, -2), dagPlus(pasen, 1), koning, dagPlus(pasen, 39), dagPlus(pasen, 50), `${j}-12-25`, `${j}-12-26`]));
  }
  const bankdag = d => { const x = new Date(d + 'T00:00:00Z').getUTCDay(); return x !== 0 && x !== 6 && !feestdagen(Number(d.slice(0, 4))).has(d); };
  G.bankdagNa = d => { let x = d; while (!bankdag(x)) x = dagPlus(x, 1); return x; };

  // ── Rekenen (los testbaar) ───────────────────────────────────────────────────
  const isGepland = e => e.bron !== 'bank' && !e.saldo_ijkpunt && !!e.datum && typeof e.delta === 'number';
  G.isGepland = isGepland;
  // Effect van een event op de gekozen lijn: 'lopend' = de lopende rekening; 'totaal' = lopend + potjes (intern telt niet).
  // Groep die als "lopende rekening" telt: lopend, en bij btw.modus 'in_lopend' (standaard) ook de BTW-pot (als die een
  // bekend saldo heeft). Overboekingen binnen de groep (BTW-sparen) zijn dan neutraal; de andere potjes zijn echt weg.
  G.groep = function (data) {
    const i = data.instellingen || {}, pot = i.btw_pot, s = pot && data.saldo && data.saldo.potten && data.saldo.potten[pot];
    return (!i.btw || i.btw.modus !== 'apart') && pot && s && s.gerapporteerd != null ? ['lopend', pot] : ['lopend'];
  };
  G.btwInLopend = data => G.groep(data).length > 1;
  function effect(e, modus, groep) {
    if (typeof e.delta !== 'number' || e.saldo_ijkpunt) return 0;
    if (modus === 'totaal') return e.intern ? 0 : e.delta;
    const g = groep || ['lopend'];
    let x = g.includes(e.rekening || 'lopend') ? e.delta : 0;
    if (e.intern && e.pot && g.includes(e.pot)) x -= e.delta;      // de pot krijgt −delta: binnen de groep heft het elkaar op
    return x;
  }
  G.effect = effect;
  // Saldo van de groep vandaag (lopend + BTW-pot), of null als het onbekend is.
  G.groepSaldo = function (data, groep) {
    let s = data.saldo.lopend && data.saldo.lopend.gerapporteerd; if (s == null) return null;
    for (const r of (groep || G.groep(data)).filter(x => x !== 'lopend')) s += data.saldo.potten[r].gerapporteerd;
    return rond(s);
  };
  // Telt dit geplande event mee? Prognose alleen met de schakelaar aan (en de post zelf aan).
  G.telt = (e, opt) => !(e.zekerheid === 'prognose' && !(opt && opt.prognose));
  // Dagelijkse lijn van van..tot: verleden terug vanaf het saldo van vandaag (bank), toekomst vooruit (gepland).
  G.lijn = function (data, opt) {
    opt = opt || {};
    const modus = opt.modus || 'lopend', v = data.vandaag, groep = opt.groep || G.groep(data);
    const s0 = modus === 'totaal' ? data.saldo.totaal && data.saldo.totaal.gerapporteerd : G.groepSaldo(data, groep);
    if (s0 == null) return { punten: [], onbekend: true };
    const dagsomVan = modus === 'lopend' && data.historie_dagsom ? Object.keys(data.historie_dagsom).sort()[0] : null;   // verder terug dan de bank van de tijdlijn
    const van = opt.van || (dagsomVan && dagsomVan < data.van ? dagsomVan : data.van), tot = opt.tot || data.tot, perDag = {}, verleden = {};
    for (const e of data.events || []) {
      if (e.bron === 'bank') { if (e.datum <= v) verleden[e.datum] = (verleden[e.datum] || 0) + effect(e, modus, groep); continue; }
      if (!isGepland(e) || !G.telt(e, opt)) continue;
      const d = e.datum < v ? v : e.datum;
      perDag[d] = (perDag[d] || 0) + effect(e, modus, groep);
    }
    // Verder terug dan de bankmutaties van de tijdlijn: dagsommen (alleen de lopende rekening).
    const bankVan = data.bronnen && data.bronnen.bankmutaties ? data.bronnen.bankmutaties.van : v;
    // (lopend + BTW-pot: de overboekingen naar de BTW-pot eruit, die zijn binnen de groep neutraal)
    const intern = (data.historie_intern || {}), binnen = groep.filter(x => x !== 'lopend');
    if (modus === 'lopend' && data.historie_dagsom) for (const [d, som] of Object.entries(data.historie_dagsom)) if (d < bankVan && !(d in verleden)) verleden[d] = rond(som - binnen.reduce((a, p) => a + ((intern[p] || {})[d] || 0), 0));
    const eerste = modus === 'lopend' && data.historie_dagsom ? Object.keys(data.historie_dagsom).sort()[0] || bankVan : bankVan;
    const punten = [];
    // verleden: saldo(d) = saldo(d+1) − mutaties(d+1)
    let s = s0;
    const terug = [];
    for (let d = v; d >= van && d >= dagPlus(eerste, -1); d = dagPlus(d, -1)) { terug.push({ datum: d, saldo: rond(s), verleden: d < v }); s -= verleden[d] || 0; }
    punten.push(...terug.reverse());
    // toekomst: vandaag telt al wat vandaag gepland staat (achterstallig e.d.)
    let f = s0;
    for (let d = v; d <= tot; d = dagPlus(d, 1)) {
      f += perDag[d] || 0;
      if (d === v) { punten[punten.length - 1].saldo_gepland = rond(f); continue; }
      punten.push({ datum: d, saldo: rond(f) });
    }
    return { punten, start: s0 };
  };
  // Alleen de lopende rekening (zonder BTW-pot): BTW-sparen haalt daar geld af en de aangifte gaat ervan af; aangenomen
  // wordt dat er op de aangiftedag wordt teruggeboekt van de BTW-pot (begrensd op de verwachte potstand).
  G.alleenLopend = function (data, opt) {
    const pot = (data.instellingen || {}).btw_pot;
    let al = 0;                                                    // eerdere aangenomen terugboekingen gaan van de pot af (op volgorde)
    const terug = (data.events || []).filter(e => e.bron === 'btw' && e.kwartaal && e.datum && e.delta < 0 && (e.rekening || 'lopend') === 'lopend' && G.telt(e, opt))
      .sort((a, b) => a.datum.localeCompare(b.datum) || String(a.id).localeCompare(String(b.id))).map(e => {
        const stand = pot ? G.potOp(data, pot, e.datum, opt) : null, b = stand == null ? 0 : Math.max(0, Math.min(-e.delta, stand - al));
        al += b;
        return { id: e.id + ':aangenomen-terug', bron: 'btw', datum: e.datum, delta: rond(b), rekening: 'lopend', zekerheid: e.zekerheid, aangenomen: true };
      }).filter(e => e.delta > 0);
    return G.lijn(Object.assign({}, data, { events: (data.events || []).concat(terug) }), Object.assign({}, opt, { modus: 'lopend', groep: ['lopend'] }));
  };
  // Waarschuwing als alleen de lopende rekening onder de kredietlimiet zakt (terwijl lopend + BTW-pot erboven blijft).
  // Doel: alleen de timing van de terugboeking. Dus alleen op dagen waarop lopend + BTW-pot BOVEN de limiet zit en
  // alleen-lopend eronder (dan is het benodigde bedrag nooit meer dan wat de pot dekt). Zakt ook de gecombineerde stand
  // onder de limiet, dan is dat al de hoofdboodschap (laagste punt/ruimte): hier alleen een korte zin.
  G.limietWaarschuwing = function (data, opt, tot) {
    const lim = data.saldo.lopend && data.saldo.lopend.kredietlimiet; if (lim == null || !G.btwInLopend(data)) return null;
    const al = G.alleenLopend(data, opt).punten, sam = new Map(G.lijn(data, Object.assign({}, opt, { modus: 'lopend' })).punten.map(p => [p.datum, p]));
    const st = p => p.saldo_gepland != null ? Math.min(p.saldo, p.saldo_gepland) : p.saldo;
    let timing = null, potNietGenoeg = null;
    for (const p of al) {
      if (p.verleden || p.datum > tot) continue;
      const c = sam.get(p.datum); if (!c) continue;
      if (st(c) <= -lim) { if (!potNietGenoeg) potNietGenoeg = { datum: p.datum }; continue; }   // gecombineerd moet echt erboven zitten
      if (st(p) < -lim && (!timing || st(p) < timing.saldo)) timing = { datum: p.datum, saldo: st(p), nodig: rond(-lim - st(p)) };
    }
    if (potNietGenoeg) timing = null;                            // dan is de hoofdboodschap het laagste punt; hier alleen één zin
    return timing || potNietGenoeg ? { timing, potNietGenoeg } : null;
  };
  // ── G7: besteedbaar budget (één bron voor het hoofdgetal, de kasruimte, het laagste punt, de grafiek en de Koersmeter) ──
  // Besteedbaar = lopend − (btw_verschuldigd − dekking). btw_verschuldigd = de btw van ALLE kwartalen (vorig en dit jaar) die niet aantoonbaar betaald zijn plus het
  // lopende kwartaal tot vandaag (de BTW-aangifte-events van de worker: schatting ±10%; een kwartaal waarvan de betaling niet te vinden is telt behoudend mee,
  // gemarkeerd onvolledig). De dekking is ALLEEN wat de worker als terugboeking van de BTW-pot aan de aangifte koppelt (btw.terugboeking_van, het ':terug'-event
  // met dezelfde prognose en begrenzing als de worker). Zonder terugboeking is de dekking 0: de BTW-pot telt dan niet mee. De noodbuffer (het potje met doel
  // 'buffer', config-id 'buffer') telt standaard niet mee; opt.nood = true telt de potstand wel mee.
  G.btwBasis = function (data) {
    const pot = (data.instellingen || {}).btw_pot, ps = pot && data.saldo && data.saldo.potten && data.saldo.potten[pot], v = data.vandaag, btwCfg = (data.instellingen || {}).btw || {};
    const kw = `${v.slice(0, 4)}-K${Math.floor((Number(v.slice(5, 7)) - 1) / 3) + 1}`;
    const terug = new Map((data.events || []).filter(e => e.bron === 'btw' && String(e.id).endsWith(':terug') && typeof e.delta === 'number' && e.delta > 0).map(e => [String(e.id).replace(/:terug$/, ''), e]));
    const betalingen = (data.events || []).filter(e => e.bron === 'btw' && e.kwartaal && !String(e.id).endsWith(':terug') && typeof e.delta === 'number' && e.delta < 0 && e.datum && (e.rekening || 'lopend') === 'lopend')
      .sort((a, b) => a.datum.localeCompare(b.datum) || String(a.id).localeCompare(String(b.id)))
      .map(e => ({ id: e.id, kwartaal: e.kwartaal, datum: e.datum, bedrag: rond(-e.delta), dekking: terug.has(e.id) ? rond(Math.min(-e.delta, terug.get(e.id).delta)) : 0, loopt: e.kwartaal === kw, marge: e.marge || null, achterstallig: !!e.achterstallig,
        onvolledig: !!e.onvolledig, reden: e.onvolledig_reden || null }));
    const schuld = rond(betalingen.reduce((a, b) => a + b.bedrag, 0)), dekking = rond(betalingen.reduce((a, b) => a + b.dekking, 0)), potStand = ps && ps.gerapporteerd != null ? ps.gerapporteerd : null;
    return { betalingen, schuld, dekking, tekort: rond(Math.max(0, schuld - dekking)), potStand, potId: pot || null, potOnbekend: !!pot && potStand == null, kwartaal: kw,
      terugboeking: !!btwCfg.terugboeking_van && btwCfg.terugboeking_van !== 'lopend', modus: btwCfg.modus || null, onvolledig: betalingen.filter(x => x.onvolledig).map(x => x.kwartaal) };
  };
  G.noodPot = (data, cfg) => G.reservePot(data, cfg);
  // Het potje voor noodgevallen heet in de UI overal "Noodbuffer" (de config-id blijft 'buffer').
  G.potNaam = pt => { if (!pt) return ''; const n = String(pt.naam || ''); return (pt.id === 'buffer' || pt.doel === 'buffer') && /^(eigen )?buffer(potje)?$/i.test(n.trim()) ? 'Noodbuffer' : n; };
  G.fictief = cfg => (cfg && typeof cfg.fictieve_buffer === 'number' && cfg.fictieve_buffer > 0 ? cfg.fictieve_buffer : 0);   // met een effectieve config (G.effCfg)
  // Het hoofdgetal vandaag, met de onderdelen. null als lopend onbekend is.
  G.besteedbaar = function (data, cfg, opt) {
    const lop = data.saldo && data.saldo.lopend && data.saldo.lopend.gerapporteerd; if (lop == null) return null;
    const b = G.btwBasis(data), np = G.noodPot(data, cfg), ns = np && data.saldo.potten && data.saldo.potten[np], noodStand = ns && ns.gerapporteerd != null ? ns.gerapporteerd : null;
    const tekort = b.tekort, zonderNood = rond(lop - tekort);
    const mee = !!(opt && opt.nood) && noodStand != null ? Math.max(0, noodStand) : 0;
    const marge = b.betalingen.length ? { min: rond(b.betalingen.reduce((a, x) => a + (x.marge ? x.marge.min : x.bedrag * 0.9), 0)), max: rond(b.betalingen.reduce((a, x) => a + (x.marge ? x.marge.max : x.bedrag * 1.1), 0)) } : null;
    return { lopend: rond(lop), btwSchuld: b.schuld, btwDekking: b.dekking, btwPot: b.potStand, btwPotOnbekend: b.potOnbekend, btwTekort: tekort, besteedbaar: rond(zonderNood + mee), zonderNood, betalingen: b.betalingen, btwMarge: marge,
      terugboeking: b.terugboeking, btwOnvolledig: b.onvolledig, nood: { pot: np, stand: noodStand, meegeteld: mee > 0, onbekend: !!np && noodStand == null } };
  };
  // De lijn van het besteedbaar budget (zelfde basis als het hoofdgetal): de lopende rekening zelf (inclusief de betalingen en de terugboekingen van de worker);
  // wat nog niet betaald is en niet door een terugboeking gedekt wordt gaat er alvast vanaf. Zo blijft de lijn vlak rond de aangiftedata. Verleden = lopend zelf.
  G.kasLijn = function (data, cfg, opt) {
    opt = opt || {};
    const basis = G.lijn(data, Object.assign({}, opt, { modus: 'lopend', groep: ['lopend'] })); if (basis.onbekend) return basis;
    const v = data.vandaag, b = G.btwBasis(data), np = G.noodPot(data, cfg), bes = G.besteedbaar(data, cfg, opt);
    const bet = b.betalingen.map(x => ({ eff: x.datum < v ? v : x.datum, rest: rond(x.bedrag - x.dekking) }));
    const nood = d => opt.nood && np ? Math.max(0, G.potOp(data, np, d, opt) || 0) : 0;
    const punten = basis.punten.map(p => {
      if (p.datum < v) return p;
      const plus = -bet.reduce((a, x) => a + (x.eff > p.datum ? x.rest : 0), 0) + nood(p.datum);
      if (p.datum === v) return Object.assign({}, p, { saldo: bes.besteedbaar, saldo_gepland: rond((p.saldo_gepland != null ? p.saldo_gepland : p.saldo) + plus) });
      return Object.assign({}, p, { saldo: rond(p.saldo + plus) });
    });
    return { punten, start: bes.besteedbaar, basis: bes };
  };
  // ── Instellingen met advies (alleen voorstellen; er wordt niets automatisch gezet) ──
  // Fictieve buffer: het hoogste van het p90 van de diepste stand per maand van de lopende rekening zelf en 1× de vaste lasten per maand.
  G.fictiefAdvies = function (data) {
    const M = G.historieMaanden(data, true); if (M.length < 6) return null;
    const p90 = pctL(M.map(m => Math.max(0, -m.min)), 0.9), vast = G.vasteLastenMaand(data), bedrag = ceil5k(Math.max(p90, vast || 0));
    return { bedrag, p90: rond(p90), vast, maanden: M.length, reden: `het hoogste van: p90 van de diepste stand per maand van de lopende rekening in de laatste ${M.length} maanden (${eur(p90)}) en 1× de vaste lasten per maand (${vast == null ? 'onbekend' : eur(vast)}), naar boven afgerond op € 5.000` };
  };
  // Streefomvang noodbuffer: 2 tot 3× de vaste lasten per maand (patronen + inleg, zonder inkoopfacturen).
  G.noodAdvies = function (data) {
    const vast = G.vasteLastenMaand(data); if (!(vast > 0)) return null;
    return { van: ceil5k(2 * vast), tot: ceil5k(3 * vast), bedrag: ceil5k(2.5 * vast), vast, reden: `2 tot 3× de vaste lasten per maand (${eur(vast)}: patronen + inleg in de potjes, zonder inkoopfacturen), naar boven afgerond op € 5.000` };
  };
  // ── Streefbedragen (fictieve buffer, streefomvang noodbuffer, streefniveau lopend): standaard het berekende advies ──
  // Een eigen bedrag wint; leeg = weer het advies. G.effCfg geeft een kopie van de config met die bedragen ingevuld (herkomst 'advies' of 'handmatig' in
  // streef.herkomst en in _herkomst); het advies wordt per data-object onthouden (opnieuw berekend als de data verandert).
  const eigenStreef = st0 => !!st0 && (st0.bedrag != null || (st0.van != null && st0.tot != null));
  const effCache = new WeakMap();
  // De adviezen worden één keer per dag berekend en onthouden (localStorage, sleutel per datum): ze springen niet per pagina-load. Een nieuwe dag (nieuwe data) = opnieuw.
  // Zonder localStorage (de worker/cron) wordt er per run gerekend.
  // De cache heeft een revisie: de dag, de config-revisie en een vingerafdruk van de brondata (patronen, profiel, aantallen en bedragen van mutaties en geplande posten; NIET het
  // tijdstip van het laden). Verandert er iets aan de bron, dan wordt het advies opnieuw berekend; anders blijft het staan, ook na een nieuwe pagina-load.
  function adviesRevisie(data, cfg) {
    const b = data.bronnen || {}, f = b.facturen || {}, m = b.bankmutaties || {}, e = data.events || [];
    return [data.vandaag, (cfg || {}).revisie, (data.patronen || {}).as_of, (data.profiel || {}).as_of, m.aantal, f.inkoop, f.verkoop, e.length, Math.round(e.reduce((a, x) => a + (typeof x.delta === 'number' ? Math.abs(x.delta) : 0), 0)),
      Math.round(((data.saldo || {}).lopend || {}).gerapporteerd || 0)].join('|');
  }
  function adviesVanDag(data, cfg) {
    const sleutel = 'mtg:advies:' + data.vandaag, rev = adviesRevisie(data, cfg); let ls = null; try { ls = root.localStorage || null; } catch (e) { ls = null; }
    try { const o = ls && JSON.parse(ls.getItem(sleutel)); if (o && o.rev === rev && 'fa' in o && 'na' in o && 'la' in o) return o; } catch (e) { /* kapot: opnieuw rekenen */ }
    const o = { rev, fa: G.fictiefAdvies(data), na: G.noodAdvies(data), la: G.lopendAdvies(data) };
    try { if (ls) { for (let i = ls.length - 1; i >= 0; i--) { const k = ls.key(i); if (k && k.indexOf('mtg:advies:') === 0) ls.removeItem(k); } ls.setItem(sleutel, JSON.stringify(o)); } } catch (e) { /* opslag vol of geblokkeerd: dan elke keer rekenen */ }
    return o;
  }
  G.effCfg = function (data, cfg) {
    cfg = cfg || {}; if (cfg._eff) return cfg;
    const c0 = effCache.get(data); if (c0 && c0.cfg === cfg) return c0.eff;
    const dag = adviesVanDag(data, cfg), fa = dag.fa, na = dag.na, la = dag.la, eff = Object.assign({}, cfg, { _eff: true }), her = {};
    if (typeof cfg.fictieve_buffer === 'number') her.fictieve_buffer = { bron: 'handmatig', advies: fa };
    else { eff.fictieve_buffer = fa ? fa.bedrag : null; her.fictieve_buffer = { bron: 'advies', advies: fa }; }
    const np = G.reservePot(data, cfg);
    eff.potten = (cfg.potten || []).map(pt => {
      if (pt.id !== np) return pt;
      const eigen = eigenStreef(pt.streef); her.noodbuffer = { bron: eigen ? 'handmatig' : 'advies', advies: na };
      return eigen ? Object.assign({}, pt, { streef: Object.assign({}, pt.streef, { herkomst: 'handmatig' }) })
        : na ? Object.assign({}, pt, { streef: Object.assign({}, pt.streef || {}, { bedrag: na.bedrag, van: null, tot: null, meegroeien: false, herkomst: 'advies' }) }) : pt;
    });
    const ls = cfg.lopend_streef, leigen = eigenStreef(ls); her.lopend = { bron: leigen ? 'handmatig' : 'advies', advies: la };
    if (leigen) eff.lopend_streef = Object.assign({}, ls, { herkomst: 'handmatig' });
    else if (la) eff.lopend_streef = Object.assign({}, ls || {}, { bedrag: la.bedrag, van: null, tot: null, meegroeien: false, herkomst: 'advies' });
    eff._herkomst = her;
    effCache.set(data, { cfg, eff }); return eff;
  };
  // 'advies', 'handmatig' of null (geen fictieve buffer: ook geen advies mogelijk)
  G.fictiefBron = (data, cfg) => { const e = G.effCfg(data, cfg); return typeof e.fictieve_buffer === 'number' ? e._herkomst.fictieve_buffer.bron : null; };
  // ── v2.9.7 (vervangen door G7): fictieve nullijn met eigen reserve; de functies blijven voor de roodstand-uitleg en het advies ──
  // Reserve = het ingestelde bedrag, maar nooit meer dan wat er (verwacht) in het reservepotje zit op die dag.
  const pctL = (a, q) => { const x = a.slice().sort((p, r) => p - r); if (!x.length) return null; const k = (x.length - 1) * q, f = Math.floor(k), c = Math.min(f + 1, x.length - 1); return x[f] + (x[c] - x[f]) * (k - f); };
  const ceil5k = x => Math.ceil(x / 5000) * 5000;               // afrondingsstap (geen bedrag uit de administratie)
  G.reserveCfg = (data, cfg) => (cfg && cfg.reserve) || (data.instellingen || {}).reserve || null;
  G.reservePot = function (data, cfg) {
    const r = G.reserveCfg(data, cfg); if (r && r.pot) return r.pot;
    const p = ((cfg && cfg.potten) || (data.instellingen || {}).potten || []).find(x => x.doel === 'buffer' && !x.virtueel && x.actief !== false && x.id !== (data.instellingen || {}).btw_pot);
    return p ? p.id : null;
  };
  G.reserveOp = function (data, cfg, datum, opt) {
    const r = G.reserveCfg(data, cfg); if (!r || !(r.bedrag > 0)) return 0;
    const pot = G.reservePot(data, cfg); if (pot && G.groep(data).includes(pot)) return 0;   // de BTW-pot telt al in lopend: niet nog eens als reserve
    const stand = pot ? G.potOp(data, pot, datum, opt) : null;
    return stand == null ? 0 : rond(Math.max(0, Math.min(r.bedrag, stand)));
  };
  G.reserveNu = function (data, cfg) {
    const nu = G.groepSaldo(data); if (nu == null) return null;
    const res = G.reserveOp(data, cfg, data.vandaag);
    return { nu, reserve: res, gebruikt: rond(Math.max(0, Math.min(res, -nu))), krediet: rond(Math.max(0, -nu - res)) };
  };
  // Kosten rekening-courant uit de "RC AFREK."-mutaties: historisch per maand, en als er debetrente was een
  // afgeleid jaartarief (rente / gemiddeld negatief dagsaldo van de lopende rekening zelf × 365 / dagen in de maand —
  // daarover rekent de bank). De bereidstellingsprovisie (over het ongebruikte deel) als mediaan per maand erbij.
  G.rcKosten = function (data) {
    const rc = data.historie_rc || []; if (!rc.length) return null;
    const per = {};
    for (const x of rc) { if (x.soort !== 'rente' && x.soort !== 'provisie') continue; const m = per[x.maand] = per[x.maand] || { provisie: 0, rente: 0 }; m[x.soort] += x.bedrag; }   // onbekende RC-regels niet als kosten
    if (!Object.keys(per).length) return null;
    const maanden = Object.keys(per).sort(), tot = maanden.map(k => per[k].provisie + per[k].rente);
    const r = { min: rond(Math.min(...tot)), max: rond(Math.max(...tot)), maanden: maanden.length, provisie: rond(pctL(maanden.map(k => per[k].provisie), 0.5)) };
    const L = G.lijn(data, { modus: 'lopend', groep: ['lopend'] }).punten.filter(p => p.verleden), tarieven = [];
    for (const k of maanden) {
      if (!(per[k].rente > 0)) continue;
      const dagen = L.filter(p => p.datum.slice(0, 7) === k); if (dagen.length < 20) continue;
      const gem = dagen.reduce((a, p) => a + Math.max(0, -p.saldo), 0) / dagen.length;
      const mdagen = new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)), 0)).getUTCDate();
      if (gem > 100) tarieven.push(per[k].rente / gem * 365 / mdagen);   // ondergrens tegen ruis (bijna geen negatief saldo → geen tarief)
    }
    if (tarieven.length) {
      r.tariefJaar = pctL(tarieven, 0.5); r.tariefMaanden = tarieven.length;
      r.rente = rond(r.tariefJaar / 12 * Math.max(0, -((data.saldo.lopend && data.saldo.lopend.gerapporteerd) || 0))); r.schatting = rond(r.provisie + r.rente);
    }
    return r;
  };
  // ── Roodstaan: kosten en wat zelf bufferen oplevert (alleen weergave) ──
  const MOEITE = 25;   // €/mnd: minder besparing dan dit is het terugboeken niet de moeite (omslagpunt)
  // Spaarrente op de potjes: zelf ingevuld, anders uit de rentebijschrijvingen van de laatste 12 maanden ÷ de huidige
  // stand van die potjes. Niets gevonden → null ("onbekend — vul in"), nooit een aangenomen percentage.
  G.spaarRente = function (data, cfg) {
    const ing = cfg && cfg.spaarrente != null ? cfg.spaarrente : (data.instellingen || {}).spaarrente;
    if (ing != null) return { tarief: ing, bron: 'ingesteld' };
    const grens = dagPlus(data.vandaag, -365), bij = (data.historie_spaarrente || []).filter(x => x.datum > grens && x.bedrag > 0);
    if (!bij.length) return null;
    const pots = [...new Set(bij.map(x => x.pot))], stand = pots.reduce((a, p) => a + Math.max(0, ((data.saldo.potten || {})[p] || {}).gerapporteerd || 0), 0);
    return stand > 0 ? { tarief: bij.reduce((a, x) => a + x.bedrag, 0) / stand, bron: 'afgeleid', n: bij.length } : null;
  };
  G.roodKosten = function (data, cfg) {
    cfg = G.effCfg(data, cfg);
    const k = G.rcKosten(data), L = data.saldo.lopend && data.saldo.lopend.gerapporteerd;
    if (!k && !(L < 0)) return null;
    const per = {};
    for (const x of data.historie_rc || []) if (x.soort === 'rente' || x.soort === 'provisie') { const m = per[x.maand] = per[x.maand] || { maand: x.maand, rente: 0, provisie: 0 }; m[x.soort] = rond(m[x.soort] + x.bedrag); }
    const maanden = Object.values(per).sort((a, b) => a.maand.localeCompare(b.maand)).slice(-12);
    const som = f => rond(maanden.reduce((a, m) => a + f(m), 0));
    const rood = rond(Math.max(0, -(L || 0))), rp = G.reservePot(data, cfg), potIds = [...new Set([(data.instellingen || {}).btw_pot, rp].filter(Boolean))];
    const X = rond(potIds.reduce((a, p) => a + Math.max(0, ((data.saldo.potten || {})[p] || {}).gerapporteerd || 0), 0)), terug = rond(Math.min(X, rood));
    const sp = G.spaarRente(data, cfg), tj = k ? k.tariefJaar : null;
    const r = { maanden, totaal: som(m => m.rente + m.provisie), totRente: som(m => m.rente), totProvisie: som(m => m.provisie), rood, nu: k ? k.schatting : null, renteNu: k ? k.rente : null,
      provisie: k ? k.provisie : null, potIds, X, terug, sp, tariefJaar: tj };
    if (tj == null) return r;
    r.renteWeg = rond(tj / 12 * terug);                                   // debetrente die verdwijnt als je terugboekt
    if (sp) { r.spaarMis = rond(sp.tarief / 12 * terug); r.winstMnd = rond(r.renteWeg - r.spaarMis); r.winstJr = rond(r.winstMnd * 12); r.omslag = tj > sp.tarief ? rond(MOEITE * 12 / (tj - sp.tarief)) : null; }
    // Doelpad: had je een volle eigen reserve R op de lopende rekening gehad (i.p.v. op een spaarpotje), hoeveel debetrente
    // was er dan weggevallen — op de werkelijke rode dagsaldi van de lopende rekening van de laatste 12 maanden.
    const P = G.lijn(data, { modus: 'lopend', groep: ['lopend'] }).punten.filter(p => p.verleden && p.datum > dagPlus(data.vandaag, -365));
    const pot = ((cfg && cfg.potten) || []).find(p => p.id === rp), s = pot && pot.streef, res = G.reserveCfg(data, cfg);
    const Rs = s && s.van != null && s.tot != null ? [s.van, s.tot] : res && res.bedrag > 0 ? [res.bedrag] : s && s.bedrag ? [s.bedrag] : [];
    if (P.length >= 60 && Rs.length) {
      r.histDagen = P.length;
      r.historisch = Rs.map(R => { const bruto = P.reduce((a, p) => a + Math.min(R, Math.max(0, -p.saldo)), 0) * tj / P.length;   // gemiddeld per dag × 365 / 365
        return { R, bruto: rond(bruto), netto: sp ? rond(bruto - R * sp.tarief) : null }; });
    }
    return r;
  };
  // ── Doelen die meegroeien met de bankhistorie (alleen echte data, geen prognose) ──
  G.historieMaanden = function (data, alleenLopend) {   // alleenLopend: de lopende rekening zelf (G7), anders lopend + BTW-pot
    const P = G.lijn(data, alleenLopend ? { modus: 'lopend', groep: ['lopend'] } : { modus: 'lopend' }).punten.filter(p => p.verleden), per = {};
    for (const p of P) { const k = p.datum.slice(0, 7), m = per[k] = per[k] || { min: Infinity, max: -Infinity, n: 0 }; m.min = Math.min(m.min, p.saldo); m.max = Math.max(m.max, p.saldo); m.n++; }
    const huidig = data.vandaag.slice(0, 7);
    return Object.entries(per).filter(([k, m]) => k !== huidig && m.n >= 20).sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([k, m]) => Object.assign({ maand: k }, m));
  };
  G.reserveAdvies = function (data, streef) {
    const M = G.historieMaanden(data, true); if (M.length < 6) return null;   // G7: op de nieuwe basis (de lopende rekening zelf, zonder BTW-pot)
    const p90 = pctL(M.map(m => Math.max(0, -m.min)), 0.9); let b = ceil5k(p90);
    const band = streef && streef.van != null && streef.tot != null ? [streef.van, streef.tot] : null;
    const onbegrensd = b;
    if (band) b = Math.min(band[1], Math.max(band[0], b));
    return { bedrag: b, p90: rond(p90), onbegrensd, band, maanden: M.length, reden: `de dips onder 0 van de lopende rekening (zonder BTW-pot) in de laatste ${M.length} maanden (p90 van de maandminima ${eur(p90)}), naar boven afgerond op € 5.000${band ? `, binnen je band ${kort(band[0])}–${kort(band[1])}` : ''}` };
  };
  // Vaste lasten per maand: de ingeplande patronen (loon, huur, abonnementen …) en de inleg in de potjes van de komende
  // 13 weken, gemiddeld per maand. Geen inkoopfacturen (die worden vaak doorbelast) en geen BTW.
  G.vasteLastenMaand = function (data) {
    const tot = [dagPlus(data.vandaag, 91), data.tot].filter(Boolean).sort()[0], dagen = dagenTussen(data.vandaag, tot); if (!(dagen >= 28)) return null;
    const groep = G.groep(data), btwPot = (data.instellingen || {}).btw_pot;
    const som = (data.events || []).filter(e => (e.bron === 'patroon' || (e.bron === 'inleg' && !(btwPot && e.pot === btwPot))) && isGepland(e) && e.datum > data.vandaag && e.datum <= tot)   // BTW-sparen is geen vaste last, ook niet in modus 'apart'
      .reduce((a, e) => a + Math.max(0, -effect(e, 'lopend', groep)), 0);
    return rond(som / (dagen / (365.25 / 12)));
  };
  G.lopendAdvies = function (data) {
    const M = G.historieMaanden(data, true); if (M.length < 6) return null;   // G7: op de nieuwe basis (de lopende rekening zelf, zonder BTW-pot)
    const p75 = pctL(M.map(m => m.max), 0.75), vast = G.vasteLastenMaand(data);
    const uit = data.historie_maand_uit || {}, mu = M.map(m => uit[m.maand]).filter(x => typeof x === 'number');   // bruto: alleen ter referentie
    const bruto = mu.length ? rond(mu.reduce((a, x) => a + x, 0) / mu.length) : null;
    return { bedrag: ceil5k(Math.max(p75, vast || 0)), p75: rond(p75), vast, bruto, brutoAdvies: bruto == null ? null : ceil5k(2 * bruto), wint: vast != null && vast > p75 ? 'vast' : 'pieken', maanden: M.length, reden: `het hoogste van: p75 van de maandpieken van de lopende rekening (zonder BTW-pot) in de laatste ${M.length} maanden (${eur(p75)}) en 1× de vaste lasten per maand (patronen + inleg in de potjes, zonder inkoopfacturen: ${vast == null ? 'onbekend' : eur(vast)}), naar boven afgerond op € 5.000` };
  };
  // Per doel met meegroeien aan (reserve-/Bufferpotje en lopende rekening). Automatisch alleen een kleine stap omhoog:
  // hooguit 1× per maand, max +10%, nooit boven de bovengrens (meegroei_max, anders de "tot" van de band; geen grens =
  // niets automatisch), en pas nadat de eigenaar een advies één keer zelf heeft overgenomen. Al het andere (het eerste
  // advies, een grotere sprong, boven de grens, lager) is een voorstel met een Ja-knop. Nooit stil verlagen.
  const STAP_MAX = 0.10;
  G.meegroeiPlan = function (data, cfg) {
    const maand = data.vandaag.slice(0, 7), uit = { wijzig: [], voorstel: [] }, doelen = [];
    if (cfg && cfg.lopend_streef) doelen.push({ id: 'lopend', naam: 'de lopende rekening', streef: cfg.lopend_streef, advies: G.lopendAdvies(data) });
    const rp = G.reservePot(data, cfg), pot = ((cfg && cfg.potten) || []).find(p => p.id === rp);
    if (pot && pot.streef) doelen.push({ id: pot.id, naam: G.potNaam(pot), streef: pot.streef, advies: G.reserveAdvies(data, pot.streef) });
    for (const x of doelen) {
      const doel = x.streef.bedrag != null ? x.streef.bedrag : x.streef.van, a = x.advies && x.advies.bedrag;
      if (x.streef.meegroeien === false || !x.advies || doel == null || a === doel) continue;
      const grens = x.streef.meegroei_max != null ? x.streef.meegroei_max : x.streef.tot != null ? x.streef.tot : null;
      const waarom = a < doel ? null : !x.streef.advies_akkoord ? 'eerste advies: eerst zelf overnemen' : grens == null ? 'geen bovengrens ingesteld'
        : a > grens ? `boven je bovengrens ${eur(grens)}` : a > doel * (1 + STAP_MAX) ? 'meer dan +10% in één keer' : '';
      if (waarom === '') {                                          // kleine stap omhoog: automatisch, hooguit 1× per maand
        if (x.streef.advies_maand === maand) continue;
        const nieuw = Object.assign({}, x.streef, { advies_maand: maand, bedrag: a, wijziging: { van: doel, naar: a, datum: data.vandaag, reden: x.advies.reden } });
        uit.wijzig.push({ id: x.id, naam: x.naam, streef: nieuw, verhoogd: { van: doel, naar: a } });
      } else uit.voorstel.push({ id: x.id, naam: x.naam, van: doel, naar: a, reden: x.advies.reden, hoger: a > doel, waarom });
    }
    return uit;
  };
  // Waar de kennis ophoudt: na de laatste verwachte factuurontvangst (en prognose, als die meetelt) staan alleen nog
  // vaste lasten in de lijn. Geen facturen bekend → vanaf zes weken.
  G.onzekerVanaf = function (data, opt) {
    const ds = (data.events || []).filter(e => isGepland(e) && e.delta > 0 && e.datum >= data.vandaag && (e.bron === 'verkoop' || (e.bron === 'prognose' && G.telt(e, opt)))).map(e => e.datum).sort();
    return ds.length ? ds[ds.length - 1] : dagPlus(data.vandaag, 42);
  };
  // Laagste punt in de toekomst (vanaf vandaag, inclusief wat vandaag nog gepland staat).
  G.laagste = function (lijn, tot) {
    let min = null;
    for (const p of lijn.punten) {
      if (p.verleden || (tot && p.datum > tot)) continue;
      const s = p.saldo_gepland != null ? Math.min(p.saldo, p.saldo_gepland) : p.saldo;
      if (!min || s < min.saldo) min = { datum: p.datum, saldo: s };
    }
    return min;
  };
  // Verwachte stand per pot op een datum (gepland): saldo nu + inleg/opname (intern) + betalingen van de pot zelf.
  G.potOp = function (data, pot, datum, opt) {
    const s = data.saldo.potten && data.saldo.potten[pot];
    if (!s || s.gerapporteerd == null) return null;
    let x = s.gerapporteerd;
    for (const e of data.events || []) {
      if (!isGepland(e) || !G.telt(e, opt) || e.datum > datum) continue;
      if (e.intern && e.pot === pot) x -= e.delta;
      else if (e.rekening === pot) x += e.delta;
    }
    return rond(x);
  };
  // Werkelijk tempo per maand over de laatste 8 weken (alleen bankmutaties, geen planning).
  G.tempo = function (data, rek) {
    const v = data.vandaag, bankVan = data.bronnen && data.bronnen.bankmutaties ? data.bronnen.bankmutaties.van : v;
    // 8 weken; voor potjes hooguit zo ver als de bankmutaties van de tijdlijn teruggaan (minstens 4 weken)
    const dagen = rek === 'lopend' && data.historie_dagsom ? 56 : Math.min(56, dagenTussen(bankVan, v) + 1), van = dagPlus(v, -dagen);
    if (dagen < 28) return null;                                                            // te weinig historie
    let som = 0;
    const groep = G.groep(data), binnen = groep.filter(x => x !== 'lopend'), intern = data.historie_intern || {};
    for (const e of data.events || []) {
      if (e.bron !== 'bank' || e.datum <= van || e.datum > v) continue;
      if (rek === 'lopend') som += effect(e, 'lopend', groep); else if (e.intern && e.pot === rek) som -= e.delta;
    }
    if (rek === 'lopend' && data.historie_dagsom && bankVan > dagPlus(van, 1)) for (const [d, x] of Object.entries(data.historie_dagsom)) if (d > van && d < bankVan) som += x - binnen.reduce((a, p) => a + ((intern[p] || {})[d] || 0), 0);
    return rond(som / (dagen / 30.44));
  };
  // Voortgang naar een doel: % vanaf het startpunt, nodig vs werkelijk tempo, verwachte datum. Eerlijk: geen tempo → geen belofte.
  G.voortgang = function (streef, nu, tempo, vandaag) {
    if (!streef || nu == null) return null;
    const doel = streef.bedrag != null ? streef.bedrag : streef.van;
    if (doel == null) return null;
    const start = streef.start && streef.start.bedrag != null ? streef.start.bedrag : nu;
    const r = { doel, nu, start, band: streef.van != null && streef.tot != null ? [streef.van, streef.tot] : null };
    r.pct = doel === start ? (nu >= doel ? 100 : 0) : Math.max(0, Math.min(100, Math.round((nu - start) / (doel - start) * 100)));
    r.gehaald = r.band ? nu >= r.band[0] : nu >= doel;
    if (r.band && nu > r.band[1]) r.boven = true;
    r.tempo = tempo;
    if (streef.datum && !r.gehaald) {
      const mnd = dagenTussen(vandaag, streef.datum) / 30.44;
      r.nodig = mnd > 0 ? rond((doel - nu) / mnd) : null;
      r.verlopen = mnd <= 0;
    }
    if (!r.gehaald && tempo != null) {
      if (tempo > 0) { r.verwacht = dagPlus(vandaag, Math.round((doel - nu) / tempo * 30.44)); r.opSchema = streef.datum ? r.verwacht <= streef.datum : null; }
      else r.nietBijDitTempo = true;
    }
    return r;
  };
  // BTW-pot zonder eigen doel: het doel is de eerstvolgende BTW-aangifte. Dekt de verwachte stand van de pot
  // (vlak vóór de aangifte, incl. BTW-sparen) het bedrag? Prognose telt niet mee (alleen wat zeker is).
  G.btwDekking = function (data, pot) {
    const a = (data.events || []).filter(e => e.bron === 'btw' && e.kwartaal && !String(e.id).endsWith(':terug') && e.delta < 0 && e.datum).sort((p, q) => p.datum.localeCompare(q.datum))[0];
    if (!a) return null;
    const bedrag = Math.abs(a.delta), stand = G.potOp(data, pot, dagPlus(a.datum, -1));
    const r = { kwartaal: a.kwartaal, bedrag, datum: a.datum, pot: stand };
    if (stand == null) return Object.assign(r, { gedekt: null, pct: 0 });
    return Object.assign(r, { gedekt: stand >= bedrag, tekort: rond(Math.max(0, bedrag - stand)), pct: Math.max(0, Math.min(100, Math.round(stand / bedrag * 100))) });
  };
  // Mijlpalen: expliciet ingesteld, anders 0 voor de lopende rekening en 25/50/75/100% van het doel voor potjes.
  G.mijlpalen = function (streef, rek) {
    if (!streef) return rek === 'lopend' ? [0] : [];
    if (Array.isArray(streef.mijlpalen) && streef.mijlpalen.length) return streef.mijlpalen.slice().sort((a, b) => a - b);
    const doel = streef.bedrag != null ? streef.bedrag : streef.van;
    if (rek === 'lopend') return [0].concat(doel != null && doel > 0 ? [doel] : []);
    return doel != null ? [0.25, 0.5, 0.75, 1].map(f => rond(doel * f)) : [];
  };
  // Klantgroep-voorstel: gedeeld naamvoorvoegsel (eerste woord, ≥ 3 tekens) bij ≥ 2 klanten. Alleen een voorstel.
  G.groepVoorstel = function (klanten, bestaand) {
    const per = {};
    for (const [cid, k] of Object.entries(klanten || {})) {
      const w = String(k.naam || '').trim().split(/\s+/)[0] || '';
      if (w.length < 3 || /^(de|het|van|bv|b\.v\.|stichting|gemeente|vof|v\.o\.f\.)$/i.test(w)) continue;
      (per[w.toLowerCase()] = per[w.toLowerCase()] || { prefix: w, namen: [], ids: [] }).namen.push(k.naam);
      per[w.toLowerCase()].ids.push(cid);
    }
    const al = (bestaand || []).map(g => String(g.prefix || '').toLowerCase()).filter(Boolean);
    return Object.values(per).filter(g => g.namen.length >= 2 && !al.some(a => a.startsWith(g.prefix.toLowerCase()) || g.prefix.toLowerCase().startsWith(a)))
      .sort((a, b) => b.namen.length - a.namen.length);
  };

  // ── Opmaak ───────────────────────────────────────────────────────────────────
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (n, dec) => n == null ? '—' : (n < 0 ? '−' : '') + '€ ' + Math.abs(n).toLocaleString('nl-NL', { minimumFractionDigits: dec ? 2 : 0, maximumFractionDigits: dec ? 2 : 0 });
  const kort = n => { if (n == null) return '—'; const a = Math.abs(n); return (n < 0 ? '−' : '') + '€ ' + (a >= 1e6 ? (a / 1e6).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + 'M' : a >= 1e4 ? Math.round(a / 1e3) + 'k' : a >= 1e3 ? (a / 1e3).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + 'k' : Math.round(a)); };
  // Datum in gewone taal; buiten het huidige jaar met jaartal (anders is "20 feb" dubbelzinnig).
  const datumTekst = (d, lang) => {
    if (!d) return 'nog geen datum';
    const t = new Date(d + 'T12:00:00Z'), ander = d.slice(0, 4) !== ((st.data && st.data.vandaag) || new Date().toISOString()).slice(0, 4);
    return t.toLocaleDateString('nl-NL', Object.assign(lang ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' }, ander ? { year: 'numeric' } : {}));
  };
  G._eur = eur; G._esc = esc;
  // ── G6: "Kan ik € X uitgeven op datum Y?" ────────────────────────────────────────────────────────────────────────────
  // Rekent op dezelfde lijn als de rest van het scherm (G.kasLijn: besteedbaar budget, noodbuffer volgens het vinkje) maar BEHOUDEND: zonder
  // prognose (alleen wat zeker of vast is). Een uitgave van X op datum Y verlaagt de lijn vanaf Y; het laagste punt daarna bepaalt het antwoord:
  //   ja (boven de gele lijn / nul) · onder-buffer (onder de fictieve buffer, nog boven nul) · noodbuffer (onder nul, de noodbuffer dekt het)
  //   · krediet (alleen met bankkrediet) · nee (onder de kredietlimiet, of zonder krediet onder nul).
  // Geeft ook het maximum dat op Y kan, en vanaf wanneer het wel kan. Puur en los testbaar; verzint niets: geen lijn → fout 'onbekend'.
  G.kanUitgeven = function (data, cfg, bedrag, datum, opt) {
    opt = opt || {};
    const v = data.vandaag, X = Number(bedrag);
    if (!(X > 0) || !isFinite(X) || X > 1e12) return { fout: 'bedrag' };
    const XC = Math.round(X * 100);                                        // alles hieronder rekent in gehele centen (geen drijvende-komma-vergelijkingen)
    if (Math.abs(X * 100 - XC) > 1e-6) return { fout: 'decimalen' };       // hooguit twee decimalen: 100,004 is geen bedrag
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(datum || '')) || isNaN(Date.parse(datum + 'T00:00:00Z'))) return { fout: 'datum' };
    if (datum < v) return { fout: 'verleden', vandaag: v };
    const kasOpt = { prognose: false, nood: !!opt.nood }, cent = n => Math.round(n * 100), euro = c => c / 100;
    const eerst = lijn => {   // alle toekomstpunten met het laagste saldo van die dag (vandaag: inclusief wat vandaag nog gepland staat), in centen
      const pt = lijn.punten.filter(q => !q.verleden && q.datum >= v).map(q => ({ datum: q.datum, c: cent(q.saldo_gepland != null ? Math.min(q.saldo, q.saldo_gepland) : q.saldo) }));
      const suf = new Array(pt.length); let m = null;
      for (let i = pt.length - 1; i >= 0; i--) { if (!m || pt[i].c <= m.c) m = pt[i]; suf[i] = m; }   // bij gelijke stand de EERSTE dag van het laagste punt
      return { pt, suf };
    };
    const lijn = G.kasLijn(data, cfg, kasOpt); if (lijn.onbekend) return { fout: 'onbekend' };
    const { pt, suf } = eerst(lijn); if (!pt.length) return { fout: 'onbekend' };
    const eind = pt[pt.length - 1].datum; if (datum > eind) return { fout: 'buiten', tot: eind };
    const onder = G.drempel(data, cfg), lim = data.saldo && data.saldo.lopend ? data.saldo.lopend.kredietlimiet : null, bes = G.besteedbaar(data, cfg, kasOpt);
    const noodStand = !opt.nood && bes && bes.nood && bes.nood.stand > 0 ? bes.nood.stand : 0;
    const oC = cent(onder), limC = typeof lim === 'number' ? cent(lim) : null, noodC = cent(noodStand);
    const beoordeel = (suffix, idx) => {
      const min = suffix[idx], naC = min.c - XC;
      const status = naC >= oC ? 'ja' : naC >= 0 ? 'onder-buffer' : noodC > 0 && naC >= -noodC ? 'noodbuffer' : limC != null && naC >= -limC ? 'krediet' : 'nee';
      return { status, min: { datum: min.datum, saldo: euro(min.c) }, na: { datum: min.datum, saldo: euro(naC) }, naC };
    };
    const idx = pt.findIndex(q => q.datum >= datum), r = beoordeel(suf, idx);
    let eerstMogelijk = null;                                              // vroegste dag vanaf wanneer het bedrag past (alleen als dat later is dan gevraagd)
    if (r.status !== 'ja') for (let i = idx + 1; i < pt.length; i++) if (suf[i].c - XC >= oC) { eerstMogelijk = pt[i].datum; break; }
    const onzekerVanaf = G.onzekerVanaf(data, kasOpt);
    const metProg = (data.events || []).some(e => e.zekerheid === 'prognose') ? (() => { const l2 = G.kasLijn(data, cfg, { prognose: true, nood: !!opt.nood }), e2 = l2.onbekend ? null : eerst(l2); if (!e2 || !e2.pt.length) return null; const i2 = e2.pt.findIndex(q => q.datum >= datum); return i2 < 0 ? null : beoordeel(e2.suf, i2); })() : null;
    // Een onvolledige bron (btw, facturen, saldo, bank, ...; alleen de prognose telt hier niet, die gebruiken we niet) maakt een "ja" onbetrouwbaar:
    // dan is het antwoord "onbekend", met wat het zou zijn als indicatie. Slecht nieuws blijft slecht nieuws.
    const bronnen = [...new Set((data.waarschuwingen || []).filter(x => x && x.onvolledig === true && x.bron !== 'prognose').map(x => String(x.bron || 'onbekend')))];
    const indicatie = r.status;
    const status = r.status === 'ja' && bronnen.length ? 'onbekend' : r.status;
    return { status, indicatie: status === 'onbekend' ? indicatie : undefined, bedrag: euro(XC), datum, vandaag: v, min: r.min, na: r.na, ruimte: euro(r.naC - oC), onder, grens: onder > 0 ? 'fictieve buffer' : 'nul',
      maxBedrag: Math.max(0, Math.floor((suf[idx].c - oC) / 100)), eerstMogelijk, onzeker: r.min.datum > onzekerVanaf || datum > onzekerVanaf, onzekerVanaf,
      onvolledig: bronnen.length, onvolledigBronnen: bronnen, noodStand, kredietlimiet: typeof lim === 'number' ? lim : null,
      metPrognose: metProg && metProg.status !== r.status ? { status: metProg.status, saldo: metProg.na.saldo, datum: metProg.na.datum } : null };
  };
  // De uitkomst in gewone zinnen (Nederlands): { kop, regels[], klasse }. Alleen tekst; de aanroeper escapet.
  G.kanTekst = function (u) {
    if (!u) return { kop: '', regels: [], klasse: '' };
    if (u.fout) return { kop: u.fout === 'bedrag' ? 'Vul een bedrag boven nul in.' : u.fout === 'decimalen' ? 'Gebruik hooguit twee decimalen (hele centen).' : u.fout === 'datum' ? 'Kies een datum.' : u.fout === 'verleden' ? 'Kies vandaag of een dag later: het verleden kan niet meer.' : u.fout === 'buiten' ? 'Die datum ligt buiten het overzicht (tot ' + datumTekst(u.tot, true) + ').' : 'Het besteedbaar budget is nog onbekend: ijk eerst de lopende rekening.', regels: [], klasse: 'let-op' };
    const E = n => eur(n), dat = d => datumTekst(d, true), regels = [];
    const laag = 'Het laagste punt wordt dan ' + E(u.na.saldo) + ' op ' + dat(u.na.datum) + ' (nu zonder deze uitgave: ' + E(u.min.saldo) + ').';
    let kop, klasse;
    if (u.status === 'onbekend') {
      kop = 'Kan ik niet zeker zeggen.'; klasse = 'let-op';
      regels.push('Een of meer bronnen zijn onvolledig (' + u.onvolledigBronnen.join(', ') + '), dus een "ja" zou onbetrouwbaar zijn. Alleen als indicatie: als alles klopt wordt het laagste punt ' + E(u.na.saldo) + ' op ' + dat(u.na.datum) + ' (' + E(Math.abs(u.ruimte)) + (u.ruimte >= 0 ? ' boven ' : ' onder ') + (u.onder > 0 ? 'je fictieve buffer' : 'nul') + ').');
      regels.push('Indicatie: op ' + dat(u.datum) + ' zou maximaal ' + E(u.maxBedrag) + ' kunnen zonder onder ' + (u.onder > 0 ? 'je fictieve buffer' : 'nul') + ' te komen. Werk de onvolledige bron bij (zie "Let op" hieronder) en probeer het opnieuw.');
    }
    else if (u.status === 'ja') { kop = 'Ja, dat kan.'; klasse = 'ja'; regels.push(laag + ' Dat is ' + E(u.ruimte) + ' boven ' + (u.onder > 0 ? 'je fictieve buffer (gele lijn).' : 'nul.')); }
    else if (u.status === 'onder-buffer') { kop = 'Het kan, maar je komt onder je fictieve buffer.'; klasse = 'let-op'; regels.push(laag + ' Dat is ' + E(-u.ruimte) + ' onder de gele lijn, nog wel boven nul.'); }
    else if (u.status === 'noodbuffer') { kop = 'Alleen met je noodbuffer.'; klasse = 'let-op'; regels.push(laag + ' Dat is onder nul; je noodbuffer (' + E(u.noodStand) + ') dekt dat, maar dan is die grotendeels op.'); }
    else if (u.status === 'krediet') { kop = 'Alleen door rood te staan.'; klasse = 'nee'; regels.push(laag + ' Dat kan alleen met bankkrediet' + (u.kredietlimiet != null ? ' (je limiet is ' + E(u.kredietlimiet) + ')' : '') + '; dat kost rente.'); }
    else { kop = 'Nee, dat kan niet.'; klasse = 'nee'; regels.push(laag + (u.kredietlimiet != null ? ' Dat is onder je kredietlimiet (−' + E(u.kredietlimiet) + ').' : ' Dat is onder nul en er is geen krediet ingesteld.')); }
    if (u.status !== 'ja' && u.status !== 'onbekend') regels.push(u.maxBedrag > 0 ? 'Op ' + dat(u.datum) + ' kan maximaal ' + E(u.maxBedrag) + ' zonder onder ' + (u.onder > 0 ? 'je fictieve buffer' : 'nul') + ' te komen.' : 'Op ' + dat(u.datum) + ' is er geen ruimte boven ' + (u.onder > 0 ? 'je fictieve buffer' : 'nul') + '.');
    if (u.status !== 'ja' && u.status !== 'onbekend') regels.push(u.eerstMogelijk ? 'Dit bedrag past wel vanaf ' + dat(u.eerstMogelijk) + ' (zonder onder ' + (u.onder > 0 ? 'je fictieve buffer' : 'nul') + ' te komen).' : 'Binnen het overzicht past dit bedrag op geen enkele dag zonder onder ' + (u.onder > 0 ? 'je fictieve buffer' : 'nul') + ' te komen.');
    if (u.metPrognose) regels.push('Met de prognose erbij wordt het: ' + ({ ja: 'ja', 'onder-buffer': 'onder je fictieve buffer', noodbuffer: 'alleen met je noodbuffer', krediet: 'alleen met krediet', nee: 'nee' })[u.metPrognose.status] + ' (laagste punt ' + E(u.metPrognose.saldo) + '). Deze uitkomst rekent behoudend zonder prognose.');
    else regels.push('Rekent behoudend: alleen wat zeker of vast is, zonder prognose.');
    if (u.onzeker) regels.push('Let op: na ' + dat(u.onzekerVanaf) + ' zijn alleen nog vaste lasten bekend en geen inkomsten; die uitkomst is daar onzeker.');
    if (u.onvolledig && u.status !== 'onbekend') regels.push('Let op: ' + u.onvolledig + ' bron(nen) zijn onvolledig (zie "Let op" hieronder); de uitkomst kan afwijken.');
    return { kop, regels, klasse };
  };
  const BRON = { bank: 'Bank (werkelijk)', inkoop: 'Inkoopfactuur', verkoop: 'Verkoopfactuur', patroon: 'Vast patroon', inleg: 'Weekinleg potje', btw: 'BTW-aangifte', 'btw-sparen': 'BTW-sparen', prognose: 'Prognose', ijkpunt: 'IJkpunt' };
  const ZEKER = { werkelijk: 'werkelijk', vastgelegd: 'vastgelegd in Moneybird', gepland: 'gepland', aanname: 'aanname (betaalgedrag)', invullen: 'nog in te vullen', patroon: 'vast patroon', schatting: 'schatting', prognose: 'prognose' };
  const UITLEG = {
    intro: 'De lijn is je besteedbaar budget: de lopende rekening min de btw die je nog moet betalen en die de BTW-pot niet dekt. Links wat er gebeurd is (bank), rechts wat er verwacht wordt. ▲ is geld dat binnenkomt, ▼ geld dat eruit gaat. Een stippellijn is prognose (nog geen factuur). Geel is je fictieve buffer (een extra marge boven nul), oranje is het punt waarop de noodbuffer op is en rood is de kredietlimiet: daaronder kan het niet. De andere spaarpotjes zijn echt weg van de lopende rekening (dat geld wordt later privé uitbetaald): een weekinleg is gewoon een uitgave. De noodbuffer telt standaard niet mee; met het vinkje "Noodbuffer meenemen" wel.',
    nood: 'De noodbuffer is het potje voor als het echt tegenzit. Standaard telt hij niet mee in je besteedbaar budget, de kasruimte en het laagste punt; met "Noodbuffer meenemen" wel (dan staat overal "incl. noodbuffer"). De oranje lijn in de grafiek laat zien wanneer de noodbuffer op is (0 min de stand van het potje). Daaronder gebruik je bankkrediet; de kosten zijn een indicatie uit de afrekeningen van de bank (bereidstellingsprovisie en debetrente).',
    nu: 'Besteedbaar = het saldo van de lopende rekening min de btw die je nog moet betalen en die de BTW-pot niet dekt. Een BTW-pot die groter is dan de schuld telt niet mee: dat geld staat niet op de lopende rekening. Tik op de kaart voor de onderdelen en de bronnen.',
    laagste: 'Het laagste verwachte besteedbaar budget in de gekozen periode, met alles wat gepland staat (facturen, vaste lasten, BTW). Hiermee zie je of het krap wordt.',
    ruimte: 'Hoeveel ruimte er op het laagste punt van de gekozen periode nog is tot de gele lijn (je fictieve buffer; zonder fictieve buffer tot nul). Daaronder: tot de noodbuffer op is en tot de kredietlimiet.',
    lijn: 'Sleep of veeg om terug of vooruit te kijken, knijp of gebruik de knoppen om in of uit te zoomen. Tik op een dag voor wat er die dag gebeurt.',
    kan: 'Vul een bedrag en een datum in en je ziet of die uitgave past in je besteedbaar budget. De uitgave gaat vanaf die datum van de lijn af; het laagste punt daarna bepaalt het antwoord (boven de gele lijn is ja). Het rekent behoudend: alleen wat zeker of vast is, zonder prognose. Het noodbuffer-vinkje werkt hier ook. Er wordt niets opgeslagen of ingepland.',
    lijst: 'Alles wat de komende 14 dagen verwacht wordt. Tik op een regel voor de bron, de uitleg waarom het op die datum staat, en de link naar Moneybird.',
    potjes: 'De lopende rekening en de spaarpotjes, met het doel dat je ze geeft. Het tempo is het gemiddelde van de laatste 8 weken op de bank; de verwachting rekent daarmee door.',
    letop: 'Wat de tool niet zeker weet of niet kon ophalen. Niets wordt stil weggelaten: wat hier staat, kan het beeld beïnvloeden.',
    patronen: 'Terugkerende betalingen die de tool in 12 maanden bank heeft gezien (loon, hypotheek, privé, abonnementen). Ze worden vooruit ingepland; zet uit wat niet meer klopt. Komt er een factuur voor, dan telt die in plaats van het patroon.',
  };
  G.UITLEG = UITLEG;

  // ── CSS (eenmalig) ───────────────────────────────────────────────────────────
  function css() {
    if (document.getElementById('mtg-css')) return;
    const s = document.createElement('style'); s.id = 'mtg-css';
    s.textContent = `
.mtg{--mtg-in:#2A7A4A;--mtg-uit:#B4412F;--mtg-lijn:var(--green,#2A4A38);--mtg-zacht:var(--text-faint,#8a8a80);font-size:14px;max-width:1100px;margin:0 auto}
.mtg *{box-sizing:border-box}
.mtg-kop{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:4px 0 10px}
.mtg-kop h2{font-family:var(--serif,Georgia,serif);font-weight:400;font-size:22px;margin:0;color:var(--green,#2A4A38);flex:1}
.mtg-kaart{background:var(--card,#fff);border:1px solid var(--border,#e4e2da);border-radius:10px;padding:12px 14px;margin-bottom:12px}
.mtg-kaarten{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:12px}
.mtg-k{background:var(--card,#fff);border:1px solid var(--border,#e4e2da);border-radius:10px;padding:10px 12px;min-width:0}
.mtg-k .l{font-size:12px;color:var(--mtg-zacht);display:flex;justify-content:space-between;gap:6px}
.mtg-k .w{font-size:22px;font-weight:600;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mtg-k .s{font-size:12px;color:var(--mtg-zacht);margin-top:2px}
.mtg-k.rood .w{color:var(--mtg-uit)}
.mtg-k.amber .w{color:#b7791f}
.mtg-vraag{border:1px solid var(--border,#ddd);background:none;border-radius:50%;width:20px;height:20px;line-height:17px;font-size:12px;cursor:pointer;color:var(--mtg-zacht);padding:0;flex:none}
.mtg-uitleg{font-size:13px;background:var(--gold-50,#FBF5E0);border:1px solid var(--gold-mid,#E8D48A);border-radius:8px;padding:8px 10px;margin:6px 0;line-height:1.45}
.mtg-knoppen{display:flex;gap:4px;flex-wrap:wrap}
.mtg-knop{border:1px solid var(--border,#ddd);background:var(--card,#fff);border-radius:16px;padding:5px 11px;font-size:13px;cursor:pointer;min-height:32px}
.mtg-knop.aan{background:var(--green,#2A4A38);border-color:var(--green,#2A4A38);color:#fff}
.mtg-knop.klein{padding:3px 8px;min-height:28px;font-size:12px}
.mtg-grafiek{position:relative;touch-action:pan-y;user-select:none;-webkit-user-select:none}
.mtg-grafiek svg{display:block;width:100%;height:240px}
.mtg-tip{position:absolute;pointer-events:none;background:rgba(30,30,25,.9);color:#fff;font-size:12px;border-radius:6px;padding:4px 7px;white-space:nowrap;transform:translate(-50%,-110%)}
.mtg-legenda{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--mtg-zacht);margin-top:6px}
.mtg-legenda i{display:inline-block;width:18px;height:0;border-top:2px solid var(--mtg-lijn);vertical-align:middle;margin-right:4px}
.mtg-dag{font-size:12px;color:var(--mtg-zacht);margin:10px 0 2px}
.mtg-dag::first-letter{text-transform:uppercase}
.mtg-rij{display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid var(--border,#eee);cursor:pointer;min-height:44px}
.mtg-rij:hover{background:var(--bg,#f6f5f0)}
.mtg-rij .p{width:16px;text-align:center;flex:none}
.mtg-rij .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mtg-rij .b{font-variant-numeric:tabular-nums;white-space:nowrap}
.mtg-in{color:var(--mtg-in)}.mtg-uit{color:var(--mtg-uit)}
.mtg-chip{font-size:11px;border-radius:10px;padding:1px 7px;background:var(--bg,#f1f0ea);color:var(--mtg-zacht);white-space:nowrap}
.mtg-chip.achter{background:#fbe3dd;color:var(--mtg-uit)}
.mtg-chip.prog{background:#e8eef9;color:#3a5a8a}
.mtg-advlink{border:0;background:none;padding:0;margin-left:3px;font:inherit;color:#3a5a8a;text-decoration:underline dotted;cursor:pointer}
.mtg-staafjes{display:flex;align-items:flex-end;gap:3px;height:62px;margin:6px 0 2px}
.mtg-staafjes>div{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:stretch;height:100%;min-width:0}
.mtg-staafjes i{display:block}.mtg-staafjes i.re{background:var(--mtg-uit,#c0392b)}.mtg-staafjes i.pr{background:#b9b6aa}
.mtg-staafjes span{font-size:9px;text-align:center;color:var(--mtg-zacht)}
details.mtg-kaart>summary{cursor:pointer;font-weight:600}details.mtg-kaart p{margin:8px 0}
.mtg-pot{padding:10px 2px;border-bottom:1px solid var(--border,#eee)}
.mtg-pot .r1{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.mtg-pot .r1 b{flex:1;min-width:120px}
.mtg-balk{height:8px;background:var(--bg,#efeee8);border-radius:4px;overflow:hidden;margin:6px 0 3px}
.mtg-balk>div{height:100%;background:var(--green-mid,#4A7A5C)}
.mtg-pot .r3{font-size:12px;color:var(--mtg-zacht);line-height:1.4}
.mtg-blad{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9000;display:flex;align-items:flex-end;justify-content:center}
.mtg-blad>div{background:var(--card,#fff);width:100%;max-width:560px;max-height:88vh;overflow:auto;border-radius:14px 14px 0 0;padding:14px 16px 22px}
@media(min-width:700px){.mtg-blad{align-items:center}.mtg-blad>div{border-radius:14px}}
.mtg-blad h3{margin:0 0 6px;font-size:17px}
.mtg-veld{display:block;margin:8px 0}
.mtg-veld span{display:block;font-size:12px;color:var(--mtg-zacht);margin-bottom:2px}
.mtg-veld input,.mtg-veld select{width:100%;padding:8px;border:1px solid var(--border,#ccc);border-radius:6px;font-size:15px}
.mtg-dl{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:13px;margin:8px 0}
.mtg-dl dt{color:var(--mtg-zacht)}.mtg-dl dd{margin:0}
.mtg-letop li{margin:3px 0;font-size:13px}
.mtg-melding{font-size:13px;color:var(--mtg-zacht);padding:6px 0}
.mtg-toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:var(--green,#2A4A38);color:#fff;padding:9px 14px;border-radius:20px;font-size:13px;z-index:9100;box-shadow:0 4px 14px rgba(0,0,0,.2)}
@media(max-width:700px){.mtg-kaarten{grid-template-columns:repeat(2,minmax(0,1fr))}.mtg-k .w{font-size:19px}.mtg-grafiek svg{height:200px}}
@media(max-width:380px){.mtg-kaarten{grid-template-columns:1fr}}
.mtg-kanrij{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.mtg-kan{border-left:6px solid var(--mtg-zacht);border-radius:6px;background:var(--bg,#f6f5f0);padding:8px 10px;font-size:14px;line-height:1.5;margin-top:6px}
.mtg-kan.ja{border-color:var(--mtg-in)}.mtg-kan.let-op{border-color:#d9a400}.mtg-kan.nee{border-color:var(--mtg-uit)}
.mtg-kan b{display:block;font-size:15px}
.mtg-veld input[type=number],.mtg-veld input[type=date]{min-height:40px}
.mtg-fp-m{border-top:1px solid var(--border,#eee);padding:6px 0}
.mtg-fp-mk{display:flex;align-items:baseline;gap:8px;min-height:28px}
.mtg-fp-mk>b:first-child,.mtg-fp-mk>span:first-child{flex:1;min-width:0}
.mtg-fp-mk .n{flex:none;font-size:12px;color:var(--mtg-zacht)}
.mtg-fp-mk .t{font-variant-numeric:tabular-nums;white-space:nowrap}
.mtg-fp-m.leeg{padding:3px 0;color:var(--mtg-zacht);font-size:13px}
.mtg-fp-m.eerder .mtg-fp-mk>b:first-child{color:var(--mtg-uit)}
.mtg-fp-r,.mtg-fb-r{display:flex;align-items:center;gap:8px;padding:5px 0 5px 10px;min-height:40px;flex-wrap:wrap}
.mtg-fp-r .n,.mtg-fb-r .n{flex:1;min-width:140px;overflow:hidden;text-overflow:ellipsis}
.mtg-fp-r .b,.mtg-fb-r .b{font-variant-numeric:tabular-nums;white-space:nowrap}
.mtg-fp-r .m,.mtg-fb-r .m{font-size:13px;color:var(--mtg-zacht);white-space:nowrap}
.mtg-fp-r.klaar,.mtg-fb-r.klaar{color:var(--mtg-zacht)}
.mtg-fp-r.klaar .b,.mtg-fb-r.klaar .b{text-decoration:line-through}
.mtg-fm{padding:4px 6px;border:1px solid var(--border,#ccc);border-radius:6px;font-size:13px;background:var(--card,#fff);min-height:32px}
.mtg-fp-tot,.mtg-fb-tot{display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--border,#ddd);margin-top:6px;padding-top:6px}
.mtg-fb{background:var(--card,#fff);border:1px solid var(--border,#e4e2da);border-radius:8px;padding:8px 12px;margin:0 0 .6rem;cursor:pointer}
.mtg-fb:hover{background:var(--bg,#f6f5f0)}
.mtg-fb-kop{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mtg-fb-kop b{flex:none}
.mtg-fb-naar{margin-left:auto;font-size:12px;color:var(--mtg-zacht)}
.mtg-fb-r{padding-left:0}
@media(max-width:700px){.mtg-fm{min-height:44px;font-size:16px}.mtg-fp-r,.mtg-fb-r{padding-left:0}.mtg-fp-r .n,.mtg-fb-r .n{flex-basis:100%}}
.mtg-mob .mtg-veld input{min-height:44px;font-size:16px}
.mtg-mob{max-width:none;margin:0;padding:12px 12px 28px;overflow-x:hidden}
.mtg-mob .mtg-kaarten{grid-template-columns:1fr}
.mtg-mob .mtg-k .w{font-size:24px}
.mtg-mob .mtg-knop,.mtg-mob .mtg-knop.klein{min-height:44px;padding:8px 14px;font-size:14px}
.mtg-mob .mtg-vraag{width:44px;height:44px;line-height:40px;font-size:15px;margin:-8px -8px -8px 0}
.mtg-mob a{color:var(--green-mid,#4A7A5C)}
.mtg-mob .mtg-rij{min-height:48px}
.mtg-mob .mtg-rij .n{white-space:normal}
.mtg-mob .mtg-k label{min-height:44px;display:flex;align-items:center}
.mtg-mob .mtg-k input[type=checkbox],.mtg-blad input[type=checkbox]{width:24px;height:24px;flex:none}
.mtg-mob a.mtg-knop{display:inline-flex;align-items:center;text-decoration:none;color:inherit}
.mtg-mob input,.mtg-mob select,.mtg-blad input,.mtg-blad select{font-size:16px}
.mtg-mob .mtg-grafiek{max-width:100%}
.mtg-mob .mtg-grafiek svg{height:230px}
.mtg-blad .mtg-knop{min-height:44px}
.mtg-mob .mtk-gelezen{min-height:44px;min-width:96px}
.mtg-mob .mtk-i{min-width:44px;height:44px;margin:-8px -8px -8px 0}
.mtg-mob .mtk-och-rij button{align-self:flex-end}
`;
    document.head.appendChild(s);
  }

  // ── Staat en laden ───────────────────────────────────────────────────────────
  const ZOOM = { week: 14, maand: 31, kwartaal: 92, jaar: 365 };
  const st = G._st = { data: null, cfg: null, zoom: 'maand', modus: 'lopend', offset: 0, prognose: true, el: null, bron: null, mag: false, wie: '', bezig: false, open: null };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };

  G.start = async function (el, opties) {
    st.el = el; st.bron = opties.bron; st.mag = !!opties.magWijzigen; st.wie = opties.wie || ''; st.ververst = false; st.scenario = {};
    st.koers = { r: null, laden: false, fout: null, rondes: 0 };
    st.projecten = opties.projecten || null; st.offerteBedrag = opties.offerteBedrag || null;
    st.compact = !!opties.compact; st.desktopUrl = /^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9._~\/-]*(#[A-Za-z0-9=&_-]*)?$/.test(String(opties.desktopUrl || '')) ? String(opties.desktopUrl) : '';   // mobiel: alleen het belangrijkste, touch-vriendelijk
    if (ls.get('mtg:zoom:' + st.wie)) st.zoom = ls.get('mtg:zoom:' + st.wie);
    if (st.compact && st.zoom === 'jaar') st.zoom = 'kwartaal';
    if (ls.get('mtg:prognose:' + st.wie) === '0') st.prognose = false;
    st.planMnd = ls.get('mtg:planmnd:' + st.wie) === '12' ? 12 : 6; st.planSl = null;
    st.noodMee = ls.get('mtg:nood:' + st.wie) === '1';   // G7: noodbuffer meenemen (per gebruiker onthouden)
    css();
    el.innerHTML = '<div class="mtg"><div class="mtg-melding">Financiën laden…</div></div>';
    await G.laad();
  };
  const cfgE = () => G.effCfg(st.dataS || st.data, st.cfg || {});   // streefbedragen: eigen bedrag of het advies
  const besNu = d => { const b = G.besteedbaar(d, st.cfg, { nood: !!st.noodMee }); return b ? b.besteedbaar : null; };   // G7: het hoofdgetal
  const verseKs = () => (st.ks || []).filter(x => Date.now() - x.t < 180000).map(x => x.k);   // 3 minuten meesturen
  G.laad = async function (vers) {
    const v = st.data ? st.data.vandaag : null;
    const vandaag = v || new Date().toISOString().slice(0, 10);
    const pad = `/geld/tijdlijn?van=${dagPlus(vandaag, -35)}&tot=${dagPlus(vandaag, 364)}&historie=1${vers ? '&vers=1' : ''}${st.cv ? '&cv=' + encodeURIComponent(st.cv) : ''}${verseKs().length ? '&ks=' + encodeURIComponent(verseKs().join(',')) : ''}`;
    try {
      const [d, c] = await Promise.all([st.bron.haal(pad), st.cfg && !vers ? Promise.resolve({ config: st.cfg }) : st.bron.haal('/geld/config')]);
      if (!d || d.error) throw new Error(d && d.error || 'geen antwoord');
      st.data = d; st.cfg = c && c.config ? c.config : st.cfg;
    } catch (e) {
      const druk = /429|retry later|druk/i.test(String(e.message));
      st.el.innerHTML = `<div class="mtg"><div class="mtg-kaart">${druk ? '<b>Moneybird is even druk.</b> Probeer het over een minuut opnieuw.' : `Financiën kon niet laden (${esc(e.message)}). Probeer het later opnieuw.`} <button class="mtg-knop klein" data-herlaad-los="1">Opnieuw laden</button></div></div>`;
      const k = st.el.querySelector('[data-herlaad-los]'); if (k) k.addEventListener('click', () => G.laad());
      return;
    }
    teken();
    koersLaad();
    verversOpAchtergrond();
  };
  // ── Koersmeter (mt-koers.js): de cijfers van dit en vorig boekjaar, één keer per openen. De worker vult ontbrekende
  // maanden in stukken aan; daarom een paar rondes (zoals in Rapporten), en alleen de kaart opnieuw tekenen.
  const KOERS_RONDES = 6;
  async function koersLaad() {
    const k = st.koers; if (!root.MTKoers || !k || k.laden || (k.r && !k.fout && (k.r.compleet || k.klaar))) return;
    k.laden = true; k.fout = null; koersTeken();
    const v = st.data.vandaag, mislukt = new Set();
    // Koersmeter A2: de ochtendmeldingen van de laatste dagen (oude worker → geen). Eerst tekenen, dan pas de zware cijfers.
    if (!k.meldingen) { try { const d = await st.bron.haal('/geld/koers/meldingen?dagen=7'); k.meldingen = d && Array.isArray(d.meldingen) ? d.meldingen : []; } catch (e) { k.meldingen = []; } koersTeken(); }
    // Koersmeter C: de dagfoto's van de laatste dagen (oude worker → leeg; dan geen "sinds gisteren").
    if (!k.dagfotos) { try { const d = await st.bron.haal('/geld/koers/dagfotos?dagen=7'); k.dagfotos = d && Array.isArray(d.dagfotos) ? d.dagfotos : null; } catch (e) { k.dagfotos = null; } }   // null = oude worker / fout: geen vergelijking, ook geen 'eerste dagfoto'
    for (k.rondes = 0; k.rondes < KOERS_RONDES; k.rondes++) {
      let r = null;
      try { r = await st.bron.haal(`/geld/cijfers?per=maand&van=${Number(v.slice(0, 4)) - 1}-01&tot=${v.slice(0, 7)}`); } catch (e) { r = { error: e.message || String(e) }; }
      if (!r || r.error) { k.fout = (r && r.error) || 'geen antwoord'; break; }
      k.r = r; (r.mislukt || []).forEach(m => mislukt.add(m));
      if (r.compleet || (r.ontbrekend || []).every(m => mislukt.has(m)) || !st.el || !st.el.isConnected) break;
      await new Promise(res => setTimeout(res, G._pauze != null ? G._pauze : 1500));
    }
    k.laden = false; k.klaar = true; koersTeken();
    koersDagfotoBewaar();
  }
  // De dagfoto van vandaag bewaren (alleen de eigenaar; de worker weigert anders): één keer per openen, als de cijfers binnen zijn.
  async function koersDagfotoBewaar() {
    const k = st.koers, K = root.MTKoers; if (!K || !st.mag || !k || k.fotoBewaard || !st.koersOordeel || k.fout) return;
    k.fotoBewaard = true;
    try { const r = await st.bron.haal('/geld/koers/dagfoto', { method: 'POST', body: K.dagfotoOpslag(st.koersOordeel) }); if (r && r.ok) k.fotoVandaag = r.datum; } catch (e) { }
  }
  function koersHtml() {
    if (!root.MTKoers || !st.data) return '';
    try {
      const K = root.MTKoers; K.css();
      const inv = K.invoer(st.data, st.cfg, st.koers, G), o = st.koersOordeel = K.oordeel(inv);
      // Koersmeter C (alleen als de cijfers binnen zijn): sinds gisteren, één actie, melding bij verslechtering.
      let extra = null;
      if (st.koers && st.koers.klaar && !st.koers.laden) {
        const v = st.data.vandaag, gisteren = (st.koers.dagfotos || []).filter(x => x.datum < v).sort((a, b) => b.datum.localeCompare(a.datum))[0] || null, nu = K.dagfotoOpslag(o);
        extra = { actie: K.actie(o, inv), verschil: K.verschil(gisteren, nu), melding: K.moetMelden(gisteren, nu), eersteDag: !gisteren && !!st.koers.dagfotos };
      }
      return K.meldingHtml(st.koers && st.koers.meldingen) + K.kaartHtml(o, extra);
    } catch (e) { return `<div class="mtg-melding">Koersmeter kon niet rekenen (${esc(e.message)}).</div>`; }
  }
  // Een ochtendmelding als gelezen afvinken (per gebruiker, tot en met die datum).
  async function koersGelezen(datum) {
    const k = st.koers; if (!k || !/^\d{4}-\d{2}-\d{2}$/.test(String(datum))) return;
    try {
      const r = await st.bron.haal('/geld/koers/gelezen', { method: 'POST', body: { datum } });
      if (!r || r.error || !r.ok) throw new Error((r && r.error) || 'niet opgeslagen');
      (k.meldingen || []).forEach(x => { if (x.datum <= datum) x.gelezen = true; });
      koersTeken();
      if (root.dispatchEvent && typeof root.CustomEvent === 'function') root.dispatchEvent(new root.CustomEvent('mtg-koers-gelezen', { detail: { datum } }));
    } catch (e) { toast('Afvinken lukte niet (' + (e.message || e) + ') — probeer het zo nog eens'); }
  }
  function koersTeken() { const p = st.el && st.el.querySelector('#mtk-plek'); if (p) p.innerHTML = koersHtml(); }
  // Betaalgedrag en vaste patronen: zonder cron — de eigenaar ververst ze op de achtergrond bij het openen.
  async function verversOpAchtergrond() {
    if (!st.mag || st.bezig || st.ververst) return;          // hooguit één poging per keer openen
    const w = st.data.waarschuwingen || [];
    if (w.some(isDruk)) return;                               // Moneybird druk: niet nog meer vragen
    const oud = b => w.some(x => x.bron === b && /nog niet berekend|ouder dan|onvolledig/.test(x.fout));
    const taken = [oud('profiel') && '/geld/profiel?vers=1', oud('patronen') && '/geld/patronen?vers=1'].filter(Boolean);
    if (!taken.length) return;
    st.bezig = true; st.ververst = true; teken();
    await new Promise(r => setTimeout(r, G._pauze != null ? G._pauze : 4000));   // eerst de tijdlijn laten uitrusten (Moneybird-limiet)
    try { for (const t of taken) { const r = await st.bron.haal(t); if (r && r.cachever) st.cv = r.cachever; } } catch (e) { }
    st.bezig = false;
    await G.laad(true);
  }

  // ── Tekenen ──────────────────────────────────────────────────────────────────
  function teken() {
    if (!st.data) return;
    const d = st.dataS = G.metScenario(st.data, st.scenario);      // scenario: verschoven termijnen (nog niet opgeslagen)
    // G7: de lijn en alle kaarten rekenen op het besteedbaar budget (G.kasLijn, dezelfde basis als het hoofdgetal en de Koersmeter);
    // modus 'totaal' = lopend + alle potjes. De noodbuffer telt alleen mee met het vinkje (per gebruiker onthouden).
    const nood = !!st.noodMee, kasL = G.kasLijn(d, st.cfg, { prognose: st.prognose, nood }), lijn = st.modus === 'totaal' ? G.lijn(d, { modus: 'totaal', prognose: st.prognose }) : kasL;
    st.lijn = lijn;
    const zoomTot = dagPlus(d.vandaag, ZOOM[st.zoom]);
    const low = st.low = kasL.onbekend ? null : G.laagste(kasL, zoomTot), heeftProg = (d.events || []).some(e => e.zekerheid === 'prognose');
    const lowZonder = heeftProg && st.prognose && low ? G.laagste(G.kasLijn(d, st.cfg, { prognose: false, nood }), zoomTot) : null;
    const L = d.saldo.lopend || {}, limiet = L.kredietlimiet, bes = G.besteedbaar(d, st.cfg, { nood }), fict = G.fictief(G.effCfg(d, st.cfg)), kosten = G.rcKosten(d);
    const noodStand = bes && bes.nood.stand != null ? Math.max(0, bes.nood.stand) : 0, grensSoort = G.drempelSoort(d, st.cfg), onder = G.drempel(d, st.cfg);
    st.meegroei = st.mag && st.cfg ? G.meegroeiPlan(d, st.cfg) : { wijzig: [], voorstel: [] };
    const ruimte = low ? rond(low.saldo - onder) : null;
    const introWeg = ls.get('mtg:intro:' + st.wie) === 'weg', c = st.compact;
    st.el.innerHTML = `<div class="mtg${c ? ' mtg-mob' : ''}">
  ${c ? '' : `<div class="mtg-kop"><h2>Financiën</h2>
    <div class="mtg-knoppen">
      <button class="mtg-knop ${st.modus === 'lopend' ? 'aan' : ''}" data-modus="lopend">Besteedbaar budget</button>
      <button class="mtg-knop ${st.modus === 'totaal' ? 'aan' : ''}" data-modus="totaal" title="De spaarpotjes zijn geen buffer: dat geld blijft eraf">Inclusief spaarpotjes (niet bedoeld als buffer)</button>
      <button class="mtg-knop" data-forecastplus="1" title="De facturatieplanning per maand die met de prognose meerekent (de eenvoudige schets staat onder Forecast)">Uitgebreide forecast</button>
      ${introWeg ? '<button class="mtg-vraag" data-intro="1" title="Wat zie je hier?">?</button>' : ''}
    </div></div>`}
  <div id="mtk-plek">${koersHtml()}</div>
  ${introWeg || c ? '' : `<div class="mtg-uitleg"><b>Wat zie je hier?</b> ${esc(UITLEG.intro)} <button class="mtg-knop klein" data-intro="weg">Begrepen</button></div>`}
  ${drukHtml()}
  ${verseKs().length ? '<div class="mtg-melding">✓ Net opgeslagen — wordt verwerkt (op andere apparaten kan het een minuut duren).</div>' : ''}
  ${st.bezig ? '<div class="mtg-uitleg">Betaalgedrag en vaste patronen worden bijgewerkt… (de lijn ververst vanzelf)</div>' : ''}
  <div class="mtg-kaarten">
    ${kaartBesteed(bes, d)}
    <div class="mtg-k ${esc(low && (low.saldo < 0 ? 'rood' : low.saldo < onder ? 'amber' : ''))}"><div class="l"><span>${heeftProg && st.prognose ? 'Laagste punt (incl. prognose)' : 'Laagste punt'}</span><button class="mtg-vraag" data-uitleg="laagste">?</button></div>
      <div class="w">${esc(low ? eur(low.saldo) : '—')}</div><div class="s">${low ? `<a href="#" data-laag="1" title="Naar die dag in de grafiek, met de grootste oorzaken">${esc(datumTekst(low.datum, true))} · waardoor?</a> · komende ${st.zoom === 'week' ? '2 weken' : esc(st.zoom)}${lowZonder ? ` · zonder prognose: ${esc(eur(lowZonder.saldo))} op ${esc(datumTekst(lowZonder.datum))}` : ''}${nood ? ' · incl. noodbuffer' : ''}${(st.zoom === 'kwartaal' || st.zoom === 'jaar') && low.datum > G.onzekerVanaf(d, { prognose: st.prognose }) ? ' · let op: valt waar alleen vaste lasten bekend zijn (vul de prognose aan)' : ''}` : ''}</div></div>
    ${kaart('ruimte', 'Ruimte op laagste punt', ruimte == null ? '—' : eur(ruimte), ruimte != null && ruimte < 0, ruimteSub(low, d, { limiet, noodStand, nood, grensSoort, fictBron: G.fictiefBron(d, st.cfg) }))}
    ${noodKaart(d, bes, nood, kosten)}
  </div>
  ${kanHtml()}
  <div class="mtg-kaart">
    <div class="mtg-kop" style="margin:0 0 6px"><b style="flex:1">Verloop ${st.modus === 'totaal' ? 'totaal' : 'besteedbaar budget'}</b>
      <div class="mtg-knoppen">${Object.keys(ZOOM).filter(z => !(c && z === 'jaar')).map(z => `<button class="mtg-knop klein ${st.zoom === z ? 'aan' : ''}" data-zoom="${esc(z)}">${esc(z)}</button>`).join('')}
      ${st.offset ? '<button class="mtg-knop klein" data-terug="1">vandaag</button>' : ''}
      ${heeftProg ? `<button class="mtg-knop klein ${st.prognose ? 'aan' : ''}" data-prognose="1" title="Prognose meenemen">prognose</button>` : ''}
      <button class="mtg-vraag" data-uitleg="lijn">?</button></div></div>
    <div class="mtg-grafiek" id="mtg-grafiek"></div>
    <div class="mtg-legenda"><span><i></i>saldo</span><span><i style="border-top-style:dashed"></i>verwacht</span>${heeftProg && st.prognose ? '<span><i style="border-top:2px dotted #3a5a8a"></i>met prognose (waar het afwijkt)</span>' : ''}${st.modus === 'lopend' ? `${fict > 0 ? '<span><i style="border-top:2px solid #d9a400"></i>fictieve buffer (geel)</span>' : ''}${noodStand > 0 && !nood ? '<span><i style="border-top:2px solid #e07b1a"></i>noodbuffer is op (oranje)</span>' : ''}${limiet != null ? '<span><i style="border-color:var(--mtg-uit)"></i>kredietlimiet (rood)</span>' : ''}${nood ? '<span>incl. noodbuffer</span>' : ''}` : ''}<span><i style="border-top:8px solid rgba(138,138,128,.15);vertical-align:-2px"></i>alleen vaste lasten bekend</span>${st.modus === 'lopend' && cfgE().lopend_streef && cfgE().lopend_streef.datum ? '<span><i style="border-top:2px dashed var(--gold,#B8962E)"></i>doelpad</span>' : ''}<span class="mtg-in">▲ erbij</span><span class="mtg-uit">▼ eraf</span><span>⚑ mijlpaal</span></div>
  </div>
  <div class="mtg-kaart"><div class="mtg-kop" style="margin:0"><b style="flex:1">Komende 14 dagen</b><button class="mtg-vraag" data-uitleg="lijst">?</button></div>${lijstHtml()}</div>
  ${c ? `${letOpHtml()}${mobielStaart()}` : `${planningHtml()}${prognoseHtml()}
  <div class="mtg-kaart"><div class="mtg-kop" style="margin:0"><b style="flex:1">Potjes en doelen</b><button class="mtg-vraag" data-uitleg="potjes">?</button></div>${potjesHtml()}</div>
  ${schuldenHtml()}
  ${roodHtml()}
  ${instellenHtml()}
  ${letOpHtml()}
  ${patronenHtml()}
  ${st.mag ? instellingenHtml() : ''}`}
</div>`;
    grafiek();
    const rk = st.el.querySelector('#mtg-rood'); if (rk) rk.addEventListener('toggle', () => { st.roodOpen = rk.open; });
    st.el.querySelector('.mtg').addEventListener('click', klik);
    st.el.querySelector('.mtg').addEventListener('input', e => {
      const kn = e.target.closest('[name="kan-bedrag"],[name="kan-datum"]');
      if (kn) { st.kan = st.kan || {}; if (kn.name === 'kan-bedrag') st.kan.bedrag = kn.value; else st.kan.datum = kn.value; kanTeken(); return; }
      const h = e.target.closest('[data-hulp]'); if (!h) return;
      st.hulp[h.dataset.hulp] = h.value;
      if (h.dataset.hulp === 'id') { const p = st.el.querySelector('#mts-plek'); if (p) p.outerHTML = schuldenHtml(); const s = st.el.querySelector('[data-hulp="id"]'); if (s) s.focus(); return; }
      const u = st.el.querySelector('#mts-uit'); if (u) u.innerHTML = hulpUitkomst();
    });
    st.el.querySelector('.mtg').addEventListener('change', e => {        // termijndatum verschuiven = scenario, lijn rekent mee
      const fm = e.target.closest('.mtg-fm');                                // verwachte factuurmaand (Factuurplanning): meteen opslaan
      if (fm) { if (!st.mag) return; fm.disabled = true; return opslaan(() => G.factuurMaandZet(st.bron, fm.dataset.sl, fm.dataset.tm, fm.value, st.data.vandaag), 'Verwachte factuurmaand opgeslagen'); }
      const i = e.target.closest('.mtg-fd'); if (!i || !i.value) return;
      const sc = st.scenario = st.scenario || {}, x = (st.data.prognose && st.data.prognose.posten || []).find(p => p.sleutel === i.dataset.sl), t = x && x.termijnen.find(q => q.id === i.dataset.tm);
      (sc[i.dataset.sl] = sc[i.dataset.sl] || {})[i.dataset.tm] = i.value;
      if (t && t.factuurdatum === i.value) { delete sc[i.dataset.sl][i.dataset.tm]; if (!Object.keys(sc[i.dataset.sl]).length) delete sc[i.dataset.sl]; }
      teken();
    });
    felicitatie();
    meegroeiUitvoeren();
    if (st.planScroll) { st.planScroll = false; const k = st.el.querySelector('#mtg-plan'); if (k && k.scrollIntoView) { try { k.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { k.scrollIntoView(); } } }
  }
  // Werkelijk op de bank: de lopende rekening zelf (zonder potjes) en wat dat kost. De bank rekent over dat saldo,
  // ook als er in de potjes genoeg staat.
  function bankTekst(d, kosten, metBtw) {
    const lop = d.saldo.lopend && d.saldo.lopend.gerapporteerd; if (lop == null) return '';
    if (lop >= 0) return `werkelijk op de bank: lopende rekening ${esc(eur(lop))} (niet rood)`;
    const rp = G.reservePot(d, st.cfg), rn = G.potNaam((((st.cfg || {}).potten || []).find(p => p.id === rp)) || { id: rp, naam: 'Noodbuffer' }) || 'Noodbuffer';
    const k = kosten ? (kosten.schatting != null ? `kost ≈${esc(eur(kosten.schatting))}/mnd: rente ±${esc((kosten.tariefJaar * 100).toFixed(1).replace('.', ','))}%/jr, afgeleid uit je ING-afrekeningen, + provisie; <a href="#" data-rc="1">hoe berekend?</a>` : `kostte historisch ${esc(eur(kosten.min))}–${esc(eur(kosten.max))}/mnd, <a href="#" data-rc="1">hoe berekend?</a>`) : 'kosten nog onbekend';
    return `werkelijk op de bank: lopende rekening ${esc(eur(lop))} rood (${k}); zolang je het ${esc((metBtw ? 'BTW- en ' : '') + rn)}geld niet terugboekt, betaal je die rente`;
  }
  function roodHtml() {
    const d = st.data, r = G.roodKosten(d, st.cfg); if (!r) return '';
    const pct = x => (x * 100).toFixed(1).replace('.', ',') + '%', namen = r.potIds.map(id => G.potNaam((((st.cfg || {}).potten || []).find(p => p.id === id)) || { id, naam: id })).join(' + ');
    const max = Math.max(1, ...r.maanden.map(m => m.rente + m.provisie)), h = x => Math.round(x / max * 46);
    const staaf = r.maanden.length ? `<div class="mtg-staafjes">${r.maanden.map(m => `<div title="${esc(m.maand)}: debetrente ${esc(eur(m.rente))} · provisie ${esc(eur(m.provisie))}"><i class="re" style="height:${esc(h(m.rente))}px"></i><i class="pr" style="height:${esc(h(m.provisie))}px"></i><span>${esc(m.maand.slice(5))}</span></div>`).join('')}</div>
      <div class="mtg-legenda"><span><i style="border-top:8px solid var(--mtg-uit,#c0392b);vertical-align:-2px"></i>debetrente</span><span><i style="border-top:8px solid #b9b6aa;vertical-align:-2px"></i>provisie</span></div>` : '';
    const delen = [];
    delen.push(r.maanden.length ? `<p><b>Afgelopen ${r.maanden.length} maand${r.maanden.length === 1 ? '' : 'en'}</b>: ${esc(eur(r.totaal))} aan ING-kosten (debetrente ${esc(eur(r.totRente))}, provisie ${esc(eur(r.totProvisie))}).</p>${staaf}`
      : '<p><b>Afgelopen 12 maanden</b>: nog geen afrekeningen van de rekening-courant gezien.</p>');
    delen.push(`<p><b>Nu</b>: ${r.rood > 0 ? `lopende rekening ${esc(eur(-r.rood))} rood${r.nu != null ? ` → ≈${esc(eur(r.nu))}/mnd (debetrente ≈${esc(eur(r.renteNu))} + provisie ${esc(eur(r.provisie))})` : ''}` : 'de lopende rekening staat niet rood'}.</p>`);
    let z;
    if (r.rood <= 0) z = 'Je staat nu niet rood: terugboeken levert nu niets op.';
    else if (r.tariefJaar == null) z = 'Nog geen debetrente in de afrekeningen gezien: geen tarief, dus geen berekening.';
    else if (!(r.X > 0)) z = `Er staat nu niets in ${esc(namen || 'de potjes')} om terug te boeken.`;
    else {
      z = `Rekenvoorbeeld: boek je ${esc(eur(r.terug))} terug uit ${esc(namen)} (er staat nu ${esc(eur(r.X))}) naar de lopende rekening, dan verdwijnt ≈${esc(eur(r.renteWeg))}/mnd debetrente.${r.X > r.rood ? ' Meer terugboeken dan je rood staat levert niets extra op.' : ''} `;
      z += r.sp ? `Je mist dan ≈${esc(eur(r.spaarMis))}/mnd spaarrente (${esc(pct(r.sp.tarief))}/jr, ${r.sp.bron === 'ingesteld' ? 'zelf ingevuld' : 'afgeleid uit de rentebijschrijvingen op je potjes'}): netto scheelt het ≈${esc(eur(r.winstMnd))}/mnd, ${esc(eur(r.winstJr))}/jr.`
        : `Spaarrente onbekend — vul in${st.mag ? ' (<a href="#" data-inst="algemeen">instellingen</a>)' : ''} voor het netto verschil.`;
      z += ` <br>Formule: (debetrente ±${esc(pct(r.tariefJaar))}/jr, afgeleid uit je ING-afrekeningen − spaarrente ${r.sp ? esc(pct(r.sp.tarief)) : '?'}/jr) ÷ 12 × het teruggeboekte bedrag.`;
    }
    if (r.tariefJaar != null) z += ' ' + (!r.sp ? 'Omslagpunt: onbekend zolang de spaarrente onbekend is.' : r.omslag != null ? `Pas als je meer dan ${esc(eur(r.omslag))} rood staat, loont terugboeken echt de moeite (dan scheelt het ≥ ${esc(eur(MOEITE))}/mnd).` : 'Je spaarrente is hoger dan de debetrente: terugboeken levert niets op.');
    delen.push(`<p><b>Wat zelf bufferen oplevert</b>: ${z}</p>`);
    if (r.provisie != null) delen.push(`<p>De bereidstellingsprovisie (≈${esc(eur(r.provisie))}/mnd, ≈${esc(eur(r.provisie * 12))}/jr) blijft zolang de kredietfaciliteit er is, ook als je niet rood staat. Die verdwijnt alleen als je de limiet laat verlagen. Ter informatie, geen advies om op te zeggen.</p>`);
    if (r.historisch) {
      const hs = r.historisch, bed = x => hs.length > 1 ? `${esc(eur(x(hs[0])))}–${esc(eur(x(hs[1])))}` : esc(eur(x(hs[0])));
      delen.push(`<p><b>Doelpad</b>: met een volle eigen reserve van ${hs.length > 1 ? `${esc(kort(hs[0].R))}–${esc(kort(hs[1].R))}` : esc(kort(hs[0].R))} op de lopende rekening (in plaats van op een spaarpotje) bespaar je historisch ±${esc(r.sp ? bed(x => x.netto) : bed(x => x.bruto))}/jr${r.sp ? ' netto (na gemiste spaarrente)' : ' aan debetrente (vóór gemiste spaarrente; spaarrente onbekend)'}, berekend op de werkelijke rode dagsaldi van de lopende rekening (${esc(r.histDagen)} dagen).</p>`);
    }
    return `<details class="mtg-kaart" id="mtg-rood" ${st.roodOpen ? 'open' : ''}><summary>Roodstaan: kosten en besparing${r.nu != null ? ` <span class="mtg-chip">≈${esc(eur(r.nu))}/mnd</span>` : ''}</summary>${delen.join('')}</details>`;
  }
  // Uitleg bij het advies naast een doel: bronnen, getallen en welke regel wint.
  function adviesUitleg(id) {
    const d = st.data, eurVetHtml = x => `<b>${x == null ? 'onbekend' : esc(eur(x))}</b>`;
    if (id === 'lopend') {
      const a = G.lopendAdvies(d); if (!a) return;
      return blad(`<h3>Advies lopende rekening: ${esc(eur(a.bedrag))}</h3><div class="mtg-uitleg">
        <p>Maandpieken: p75 van het hoogste saldo per maand (lopende rekening, zonder BTW-pot, laatste ${esc(a.maanden)} maanden): ${eurVetHtml(a.p75)}${a.wint === 'pieken' ? ' ← wint' : ''}</p>
        <p>Vaste lasten per maand: patronen + inleg in de potjes (komende 13 weken), zonder inkoopfacturen en BTW-sparen: ${eurVetHtml(a.vast)}${a.wint === 'vast' ? ' ← wint' : ''}</p>
        <p>Gemiddelde bruto uitgaven per maand (alles, incl. inkoop en potinleg, zonder BTW-sparen): ${eurVetHtml(a.bruto)}</p>
        <p>Regel: het hoogste van maandpieken en vaste lasten, naar boven afgerond op € 5.000 → ${eurVetHtml(a.bedrag)}.</p>
        ${a.brutoAdvies != null ? `<p>Ter referentie (telt niet mee): 2× gemiddelde maanduitgaven incl. inkoop en potinleg = ${eurVetHtml(a.brutoAdvies)}${a.brutoAdvies > a.bedrag ? ' (hoger dan het advies)' : ''}.</p>` : ''}</div>`);
    }
    const pot = ((st.cfg || {}).potten || []).find(p => p.id === id), a = pot && G.reserveAdvies(d, pot.streef); if (!a) return;
    blad(`<h3>Advies ${esc(G.potNaam(pot))}: ${esc(eur(a.bedrag))}</h3><div class="mtg-uitleg">
      <p>Dips onder 0: de laagste stand per maand van de lopende rekening (zonder BTW-pot), laatste ${esc(a.maanden)} maanden; p90 daarvan: ${eurVetHtml(a.p90)}</p>
      <p>Naar boven afgerond op € 5.000: ${eurVetHtml(a.onbegrensd)}${a.band ? `; binnen je band ${esc(kort(a.band[0]))}–${esc(kort(a.band[1]))} → ${eurVetHtml(a.bedrag)}` : ''}.</p>
      <p>Regel: de reserve dekt 9 van de 10 maanddips.</p></div>`);
  }
  function rcUitleg() {
    const k = G.rcKosten(st.data), lop = st.data.saldo.lopend && st.data.saldo.lopend.gerapporteerd; if (!k) return;
    const pct = x => (x * 100).toFixed(1).replace('.', ',') + '%';
    blad(`<h3>Kosten rekening-courant</h3><div class="mtg-uitleg">${k.schatting != null
      ? `≈ ${esc(eur(k.schatting))} per maand = debetrente ≈${esc(eur(k.rente))} (±${esc(pct(k.tariefJaar))}/jr ÷ 12 × het huidige rode saldo van de lopende rekening ${esc(eur(Math.max(0, -(lop || 0))))}) + bereidstellingsprovisie ${esc(eur(k.provisie))} (mediaan per maand; die rekent de bank over het ongebruikte deel van het krediet). Het tarief is afgeleid uit je ING-afrekeningen: debetrente ÷ het gemiddelde rode dagsaldo in die maand, omgerekend naar een jaar (mediaan over ${k.tariefMaanden} maand${k.tariefMaanden === 1 ? '' : 'en'}).`
      : `Er is (nog) geen debetrente in de afrekeningen gezien, dus geen tarief; alleen wat het historisch kostte.`} Historisch: ${esc(eur(k.min))}–${esc(eur(k.max))} per maand over ${esc(k.maanden)} maand${k.maanden === 1 ? '' : 'en'}. Een indicatie: de bank rekent per dag over de lopende rekening zelf, los van wat er in de potjes staat.</div>`);
  }
  // Eigenaar opent het scherm: wat deze maand nog niet herberekend is, verwerken (kleine stap omhoog, met melding).
  async function meegroeiUitvoeren() {
    const plan = st.meegroei; if (!st.mag || st.meegroeiBezig || !plan || !plan.wijzig.length || !st.cfg) return;
    st.meegroeiBezig = true;
    const cfg = st.cfg, body = { revisie: cfg.revisie };
    for (const w of plan.wijzig) {
      if (w.id === 'lopend') body.lopend_streef = w.streef;
      else body.potten = (body.potten || cfg.potten.map(p => Object.assign({}, p))).map(p => p.id === w.id ? Object.assign({}, p, { streef: w.streef }) : p);
    }
    try {
      await stuur('/geld/config', body);
      for (const w of plan.wijzig.filter(x => x.verhoogd)) toast(`Doel ${w.naam} verhoogd van ${eur(w.verhoogd.van)} naar ${eur(w.verhoogd.naar)} (zie de uitleg bij het doel)`);
      st.cfg = null; await G.laad(true);
    } catch (e) { toast('Doel kon niet automatisch worden bijgewerkt (' + e.message + ') — het wordt de volgende keer opnieuw geprobeerd'); } finally { st.meegroeiBezig = false; }
  }
  // Mijlpaal gehaald (werkelijk saldo, niet de verwachting): eenmalig een korte felicitatie. Bij de eerste keer
  // openen tellen al gehaalde mijlpalen als gezien (geen stortvloed van felicitaties).
  function felicitatie() {
    const d = st.data, cfg = cfgE(), rek = [['lopend', 'Het besteedbaar budget', besNu(d), cfg.lopend_streef]]
      .concat((cfg.potten || []).filter(p => !p.virtueel && p.streef).map(p => [p.id, G.potNaam(p), (d.saldo.potten[p.id] || {}).gerapporteerd, p.streef]));
    const eerst = !ls.get('mtg:mp-init:' + st.wie), nieuw = [];
    for (const [id, naam, nu, streef] of rek) {
      if (nu == null) continue;
      for (const m of G.mijlpalen(streef, id)) {
        const k = `mtg:mp:${st.wie}:${id}:${m}`;
        if (nu >= m && !ls.get(k)) { ls.set(k, '1'); if (!eerst) nieuw.push(`${naam}: ${m === 0 ? 'uit het rood' : eur(m)} gehaald`); }
      }
    }
    ls.set('mtg:mp-init:' + st.wie, '1');
    if (nieuw.length) toast('⚑ ' + nieuw[0] + (nieuw.length > 1 ? ` (+${nieuw.length - 1})` : '') + ' — mooi!');
  }
  // Potstand met de herkomst: "BTW-pot € 7.533 (ijkpunt 7 okt € 24.542 − opname 8 okt € 23.500 + inleg € 6.338)". Een onzekere stand zegt dat, met de reden.
  function potUitleg(s, naam) {
    if (!s) return '';
    if (s.gerapporteerd == null) return `${naam} onbekend${s.onzeker_reden ? ' — ' + s.onzeker_reden : ' (nog niet geijkt)'}; bij Besteedbaar telt de pot daarom niet mee (de hele btw-schuld gaat eraf)`;
    const b = s.beweging;
    if (s.bron !== 'ijkpunt' || !s.ijkpunt) return `${naam} ${eur(s.gerapporteerd)} (stand Moneybird)`;
    if (!b) return `${naam} ${eur(s.gerapporteerd)} (vanaf ijkpunt ${datumTekst(s.ijkpunt.datum)})`;
    const opnames = b.mutaties.filter(m => m.pot_bedrag < 0), inleggen = b.mutaties.filter(m => m.pot_bedrag > 0);
    const delen = [`ijkpunt ${datumTekst(s.ijkpunt.datum)} ${eur(s.ijkpunt.bedrag)}`];
    if (b.n_opname) delen.push(`− opname${b.n_opname === 1 && opnames[0] ? ' ' + datumTekst(opnames[0].datum) : 's'} ${eur(b.opname)}`);
    if (b.n_inleg) delen.push(`+ inleg${b.n_inleg === 1 && inleggen[0] ? ' ' + datumTekst(inleggen[0].datum) : ''} ${eur(b.inleg)}`);
    return `${naam} ${eur(s.gerapporteerd)} (${delen.join(' ')})`;
  }
  function kaartNu(titel, waarde, rood, sub, pot, potNaam) {
    const tekst = pot ? potUitleg(pot, potNaam) : '', onzeker = pot && pot.onzeker && pot.onzeker_reden;
    return `<div class="mtg-k ${rood ? 'rood' : ''}"><div class="l"><span>${esc(titel)}</span><button class="mtg-vraag" data-uitleg="nu">?</button></div><div class="w">${esc(waarde)}</div><div class="s">${esc(sub)}</div>
      ${pot ? `<div class="s">${esc(tekst)}${pot.beweging && pot.beweging.mutaties.length ? ` · <a href="#" data-potmuts="${esc(pot.id)}" title="De overboekingen tussen lopend en deze pot sinds het ijkpunt">mutaties</a>` : ''}</div>` : ''}
      ${onzeker ? `<div class="s" style="color:var(--rood,#b3261e)">⚠ ${esc(onzeker)}</div>` : ''}</div>`;
  }
  // G7: uitleg van het hoofdgetal: de onderdelen (lopend, btw per kwartaal, BTW-pot) en waar ze vandaan komen.
  function besteedUitleg() {
    const d = st.dataS || st.data, bes = G.besteedbaar(d, st.cfg, { nood: !!st.noodMee });
    if (!bes) return blad(`<h3>Besteedbaar</h3><div class="mtg-uitleg">${esc(UITLEG.nu)}</div><p>De lopende rekening is nog onbekend: ijk eerst de rekening.</p>`);
    const eur2 = x => eur(x, true), Lb = (d.saldo.lopend || {}).bron === 'ijkpunt' ? `ijkpunt ${datumTekst(((d.saldo.lopend || {}).ijkpunt || {}).datum)} plus de bankmutaties` : 'stand uit Moneybird';
    const gemarkeerd = ((st.cfg || {}).btw || {}).betaald_kwartalen || [];
    const o = blad(`<h3>Besteedbaar: ${esc(eur2(bes.besteedbaar))}</h3><div class="mtg-uitleg">${esc(UITLEG.nu)}</div>
      <dl class="mtg-dl"><dt>Lopende rekening</dt><dd>${esc(eur2(bes.lopend))} <span style="color:var(--text-dim)">(${esc(Lb)})</span></dd>
      <dt>Btw nog te betalen</dt><dd>${esc(eur2(bes.btwSchuld))}${bes.btwMarge && bes.btwSchuld > 0 ? ` <span style="color:var(--text-dim)">(schatting ±10%: ${esc(eur2(bes.btwMarge.min))} tot ${esc(eur2(bes.btwMarge.max))})</span>` : ''}</dd>
      ${bes.betalingen.map(x => `<dt style="padding-left:12px">${esc(x.kwartaal)}</dt><dd>${esc(eur2(x.bedrag))} <span style="color:var(--text-dim)">${x.loopt ? 'het kwartaal loopt nog: stand tot vandaag, loopt nog op' : 'nog niet betaald'} · uiterste betaaldatum ${esc(datumTekst(x.datum, true))}${x.achterstallig ? ' (voorbij)' : ''}${x.dekking > 0 ? ` · gedekt door de BTW-pot: ${esc(eur2(x.dekking))}` : ''}</span>${x.onvolledig ? ` <b style="color:var(--rood,#b3261e)">⚠ ${esc(x.reden || 'betaling niet gevonden')} — behoudend als open schuld meegeteld</b>` : ''}${st.mag && !x.loopt ? ` <button class="mtg-knop klein" data-btwbetaald="${esc(x.kwartaal)}">markeer als betaald</button>` : ''}</dd>`).join('')}
      <dt>BTW-pot</dt><dd>${esc(bes.btwPot == null ? 'onbekend' : eur2(bes.btwPot))} <span style="color:var(--text-dim)">${bes.terugboeking ? '(telt mee voor zover de worker de aangifte van de BTW-pot terugboekt)' : '(telt NIET mee: er is geen terugboeking van de BTW-rekening ingesteld)'}</span></dd>
      <dt>Gedekt door de pot</dt><dd>${esc(eur2(bes.btwDekking))}</dd>
      <dt>Niet gedekt</dt><dd>${esc(eur2(bes.btwTekort))}</dd>
      <dt>Besteedbaar</dt><dd><b>${esc(eur2(bes.zonderNood))}</b> = lopend − niet gedekte btw</dd>
      ${bes.nood.meegeteld ? `<dt>Noodbuffer</dt><dd>+ ${esc(eur2(bes.nood.stand))} meegeteld (vinkje "Noodbuffer meenemen")</dd><dt>Totaal</dt><dd><b>${esc(eur2(bes.besteedbaar))}</b> incl. noodbuffer</dd>` : ''}</dl>
      ${gemarkeerd.length ? `<p style="font-size:12px">Als betaald gemarkeerd: ${gemarkeerd.map(k => `${esc(k)} <button class="mtg-knop klein" data-btwterug="${esc(k)}">terugzetten</button>`).join(' · ')}</p>` : ''}
      <p style="font-size:12px;color:var(--text-dim)">Bronnen: het banksaldo (Moneybird of je ijkpunt); de btw per kwartaal is verkoop-btw min inkoop-btw uit Moneybird (BTW-overzicht), een schatting van ±10% omdat de aangifte nog niet is ingediend. Alle kwartalen van vorig en dit jaar die niet als betaald te vinden zijn tellen mee. De BTW-pot telt alleen mee voor zover de aangifte van de lopende rekening wordt teruggeboekt van de BTW-rekening (Instellingen). Een deel van het lopende kwartaal dat nog moet binnenkomen staat er nog niet in.</p>`);
    // markeren als betaald (of terugzetten): alleen de eigenaar; de worker bewaart het in btw.betaald_kwartalen
    const zet = async lijst => { o.remove(); await opslaan(() => stuur('/geld/config', { revisie: (st.cfg || {}).revisie, btw: { betaald_kwartalen: lijst } }), 'Opgeslagen'); };
    o.querySelectorAll('[data-btwbetaald]').forEach(k => k.addEventListener('click', () => zet([...new Set(gemarkeerd.concat(k.dataset.btwbetaald))].sort())));
    o.querySelectorAll('[data-btwterug]').forEach(k => k.addEventListener('click', () => zet(gemarkeerd.filter(x => x !== k.dataset.btwterug))));
  }
  // G7: het hoofdgetal. Eronder klein: lopend · btw nog te betalen (schatting ±10%) · btw-pot (met herkomst en mutaties).
  function kaartBesteed(bes, d) {
    const btwPot = (d.instellingen || {}).btw_pot;
    if (!bes) return kaart('nu', 'Besteedbaar', '—', false, 'de lopende rekening is (nog) onbekend');
    const w = (d.waarschuwingen || []).filter(x => /^btw/.test(x.bron || '') && x.onvolledig);
    const sub = `lopend ${eur(bes.lopend)} · btw nog te betalen ${eur(bes.btwSchuld)}${bes.btwSchuld > 0 ? ' (schatting ±10%)' : ''}${bes.btwDekking > 0 ? ` · de BTW-pot dekt ${eur(bes.btwDekking)} (terugboeking)` : ''}${bes.btwPot != null && bes.btwPot > 0 && bes.btwSchuld > 0 && !bes.terugboeking ? ' · ⚠ de BTW-pot telt niet mee: er is geen terugboeking van de BTW-rekening ingesteld (Instellingen)' : bes.btwPot != null && bes.btwPot > bes.btwDekking && bes.btwDekking >= bes.btwSchuld && bes.btwSchuld > 0 ? ' · de BTW-pot is groter dan de schuld: het teveel telt niet mee' : ''}${!btwPot ? ' · geen BTW-pot ingesteld' : ''}${bes.btwOnvolledig.length ? ` · ⚠ niet (volledig) als betaald gevonden: ${bes.btwOnvolledig.join(', ')} — behoudend als open schuld meegeteld` : ''}${bes.nood.meegeteld ? ` · noodbuffer ${eur(bes.nood.stand)} meegeteld` : ''}${w.length ? ' · ⚠ btw-schuld mogelijk onvolledig (zie "Let op")' : ''}`;
    return kaartNu('Besteedbaar' + (bes.nood.meegeteld ? ' (incl. noodbuffer)' : ''), eur(bes.besteedbaar), bes.besteedbaar < 0, sub, btwPot ? d.saldo.potten[btwPot] : null, 'BTW-pot');
  }
  // De onderzijde van de kaart "Ruimte op laagste punt": tot de gele lijn (fictieve buffer; het bedrag staat alleen in Instellingen), tot de noodbuffer op is, tot de kredietlimiet.
  function ruimteSub(low, d, o) {
    if (!low) return 'geen saldo of verwachte lijn';
    const delen = [o.grensSoort === 'fictief' ? 'tot de gele lijn (' + (o.fictBron === 'advies' ? 'volgt advies' : 'eigen bedrag') + ')' : 'tot de nullijn'];
    if (!o.nood && o.noodStand > 0) delen.push(`tot de noodbuffer op is: ${eur(low.saldo + o.noodStand)}`);
    if (o.limiet != null) delen.push(`tot de kredietlimiet: ${eur(low.saldo + o.limiet)}`);
    if (o.nood) delen.push('incl. noodbuffer');
    return delen.join(' · ');
  }
  // G7: de noodbuffer (potje met doel 'buffer'): standaard niet in het besteedbaar budget; met het vinkje wel (per gebruiker onthouden).
  function noodKaart(d, bes, nood, kosten) {
    const np = bes && bes.nood.pot, cp = np && (cfgE().potten || []).find(p => p.id === np), streef = cp && cp.streef, doel = streef ? (streef.bedrag != null ? streef.bedrag : streef.van) : null, doelBron = streef && streef.herkomst ? (streef.herkomst === 'advies' ? ' (volgt advies)' : ' (eigen bedrag)') : '';
    if (!np) return st.mag ? `<div class="mtg-k"><div class="l"><span>Noodbuffer</span><button class="mtg-vraag" data-uitleg="nood">?</button></div><div class="w" style="font-size:15px">nog niet ingesteld</div><div class="s"><a href="#" data-inst="algemeen">instellen</a></div></div>` : '';
    return `<div class="mtg-k"><div class="l"><span>Noodbuffer</span><button class="mtg-vraag" data-uitleg="nood">?</button></div>
      <div class="w">${esc(bes.nood.stand != null ? eur(bes.nood.stand) : 'saldo onbekend')}</div>
      <div class="s">${esc(bes.nood.onbekend ? 'ijk het potje om de stand te zien' : doel != null ? `doel ${eur(doel)}${doelBron}` : 'nog geen doel (nog geen advies)')} · ${nood ? 'telt mee in Besteedbaar, kasruimte en laagste punt' : 'telt niet mee in Besteedbaar, kasruimte en laagste punt'}</div>
      <label class="s" style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" data-nood="1" style="width:auto" ${nood ? 'checked' : ''}> Noodbuffer meenemen</label>
      <div class="s">${bankTekst(d, kosten, !!(d.instellingen || {}).btw_pot)}</div></div>`;
  }
  // De overboekingen tussen lopend en een pot sinds het ijkpunt (inleg en opname), nieuwste eerst; tik op een regel voor de details.
  function potMutaties(id) {
    const s = (st.data.saldo.potten || {})[id]; if (!s || !s.beweging) return;
    const b = s.beweging, bestaat = mid => (st.data.events || []).some(e => e.id === mid);
    blad(`<h3>${esc(G.potNaam({ id, naam: s.naam }) || id)}: overboekingen sinds ${esc(datumTekst(b.sinds, true))}</h3>
      <p style="font-size:12px;color:var(--text-dim)">${esc(s.bron === 'ijkpunt' ? 'ijkpunt' : 'stand Moneybird')} ${esc(eur(b.start, true))} ${b.n_opname ? `− opnames ${esc(eur(b.opname, true))} (${b.n_opname})` : ''} ${b.n_inleg ? `+ inleg ${esc(eur(b.inleg, true))} (${b.n_inleg})` : ''} = <b>${esc(eur(s.gerapporteerd, true))}</b></p>
      ${b.mutaties.length ? b.mutaties.map(m => `<div class="mtg-rij" ${bestaat(m.id) ? `data-ev="${esc(m.id)}" style="cursor:pointer"` : ''}><span>${esc(datumTekst(m.datum, true))}</span> <b class="${m.pot_bedrag > 0 ? 'mtg-in' : 'mtg-uit'}">${m.pot_bedrag > 0 ? 'inleg' : 'opname'} ${esc(eur(Math.abs(m.pot_bedrag), true))}</b> <span style="color:var(--text-dim)">${esc(m.tegenpartij || '')}</span></div>`).join('') : '<p>Geen overboekingen sinds het ijkpunt.</p>'}
      ${b.mutaties.length >= 30 ? '<p style="font-size:11px">Alleen de laatste 30 getoond.</p>' : ''}`);
  }
  function kaart(sleutel, titel, waarde, rood, sub) {
    return `<div class="mtg-k ${rood ? 'rood' : ''}"><div class="l"><span>${esc(titel)}</span><button class="mtg-vraag" data-uitleg="${esc(sleutel)}">?</button></div><div class="w">${esc(waarde)}</div><div class="s">${esc(sub || '')}</div></div>`;
  }
  // Lijst: vandaag t/m +14, inclusief achterstallig (staat op vandaag); zonder datum apart.
  // Mobiel: wat hier niet staat (potjes, prognose, schulden, instellingen, rapporten) staat op de computer.
  function mobielStaart() {
    return `<div class="mtg-kaart"><div class="mtg-melding" style="padding:0 0 8px">Potjes en doelen, prognose, schulden, instellingen en rapporten staan op de computer.</div>${st.desktopUrl ? `<a class="mtg-knop" href="${esc(st.desktopUrl)}" target="_blank" rel="noopener">Meer op de computer ↗</a>` : ''}</div>`;
  }
  function lijstHtml() {
    const d = st.dataS || st.data, eind = dagPlus(d.vandaag, 14);
    const ev = (d.events || []).filter(e => isGepland(e) && G.telt(e, { prognose: st.prognose }) && e.datum <= eind && !(e.intern && e.bron === 'btw-sparen'))
      .sort((a, b) => a.datum.localeCompare(b.datum) || Math.abs(b.delta) - Math.abs(a.delta));
    const zonder = (d.events || []).filter(e => e.bron !== 'bank' && !e.saldo_ijkpunt && !e.datum);
    if (!ev.length && !zonder.length) return '<div class="mtg-melding">Niets gepland de komende 14 dagen.</div>';
    let h = '', dag = '';
    const inleg = {};
    for (const e of ev) if (e.bron === 'inleg') (inleg[e.datum] = inleg[e.datum] || []).push(e);
    for (const e of ev) {
      if (e.datum !== dag) { dag = e.datum; h += `<div class="mtg-dag">${e.datum === d.vandaag ? 'vandaag' : esc(datumTekst(e.datum, true))}</div>`; }
      if (e.bron !== 'inleg') { h += rijHtml(e); continue; }
      const l = inleg[e.datum]; if (l[0] !== e) continue;      // één regel per dag voor alle weekinleg
      const som = rond(l.reduce((a, x) => a + x.delta, 0));
      h += `<div class="mtg-rij" data-dag="${esc(e.datum)}"><span class="p mtg-uit">▼</span><span class="n">Weekinleg potjes: ${esc(l.map(x => x.tegenpartij || x.pot).join(', '))}</span><span class="mtg-chip">intern</span><span class="b mtg-uit">${esc(eur(som))}</span></div>`;
    }
    if (zonder.length) h += `<div class="mtg-dag">zonder datum (niet in de lijn)</div>` + zonder.map(rijHtml).join('');
    return h;
  }
  // G6: de kaart "Kan ik dit uitgeven?"; de invoer blijft staan bij elke nieuwe tekening (st.kan), alleen het antwoord wordt ververst.
  function kanHtml() {
    const d = st.dataS || st.data, k = st.kan = st.kan || { bedrag: '', datum: d.vandaag };
    if (!k.datum || k.datum < d.vandaag) k.datum = d.vandaag;
    return `<div class="mtg-kaart" id="mtg-kan"><div class="mtg-kop" style="margin:0 0 6px"><b style="flex:1">Kan ik dit uitgeven?</b><button class="mtg-vraag" data-uitleg="kan">?</button></div>
    <div class="mtg-kanrij"><label class="mtg-veld"><span>Bedrag (€)</span><input type="number" inputmode="decimal" min="0" step="0.01" name="kan-bedrag" value="${esc(k.bedrag)}" placeholder="bv. 8000"></label>
      <label class="mtg-veld"><span>Op datum</span><input type="date" name="kan-datum" min="${esc(d.vandaag)}" value="${esc(k.datum)}"></label></div>
    <div id="mtg-kan-uit" aria-live="polite">${kanUitHtml()}</div></div>`;
  }
  function kanUitHtml() {
    const d = st.dataS || st.data, k = st.kan;
    if (!String(k.bedrag).trim()) return '<div class="mtg-melding">Vul een bedrag en een datum in: je ziet meteen of het past in je besteedbaar budget.</div>';
    const t = G.kanTekst(G.kanUitgeven(d, st.cfg, Number(String(k.bedrag).replace(',', '.')), k.datum, { nood: !!st.noodMee }));
    return `<div class="mtg-kan ${esc(t.klasse)}"><b>${esc(t.kop)}</b>${t.regels.map(r => `<div>${esc(r)}</div>`).join('')}</div>`;
  }
  function kanTeken() { const p = st.el && st.el.querySelector('#mtg-kan-uit'); if (p) p.innerHTML = kanUitHtml(); }
  function rijHtml(e) {
    const nt = e.telt_niet, inn = !nt && e.delta > 0, chip = nt ? `<span class="mtg-chip achter">${esc(nt.soort === 'tegoed' ? 'tegoed — telt niet mee' : nt.soort === 'valuta' ? 'vreemde valuta — telt niet mee' : 'zonder datum/nummer — telt niet mee')}</span>` : e.achterstallig ? '<span class="mtg-chip achter">achterstallig</span>' : e.zekerheid === 'prognose' ? '<span class="mtg-chip prog">prognose</span>' : e.intern ? '<span class="mtg-chip">intern</span>' : `<span class="mtg-chip">${esc(ZEKER[e.zekerheid] || e.zekerheid || '')}</span>`;
    return `<div class="mtg-rij" data-ev="${esc(e.id)}"${e.scenario ? ' style="background:#eef3fb"' : ''}><span class="p ${nt ? '' : inn ? 'mtg-in' : 'mtg-uit'}">${nt ? '○' : inn ? '▲' : '▼'}</span><span class="n">${esc(e.tegenpartij || BRON[e.bron] || e.bron)}${e.termijn ? ` · termijn ${esc(e.termijn)}` : ''}</span>${chip}<span class="b ${nt ? '' : inn ? 'mtg-in' : 'mtg-uit'}">${esc(eur(nt ? Math.abs(e.bedrag) : e.delta != null ? e.delta : e.bedrag))}</span></div>`;
  }
  // Potjes: lopende rekening + elk potje (ook virtueel), met doel, balk en tempo.
  function potjesHtml() {
    const d = st.data, cfg = cfgE(), rijen = [];
    const lopendStreef = cfg.lopend_streef || null;
    rijen.push(potRij('lopend', 'Besteedbaar budget (lopende rekening)', besNu(d), lopendStreef, G.tempo(d, 'lopend'), null));
    for (const p of (cfg.potten || [])) {
      const s = (d.saldo.potten || {})[p.id];
      const nu = p.virtueel ? virtueelSaldo(p, d.vandaag) : s ? s.gerapporteerd : null;
      rijen.push(potRij(p.id, G.potNaam(p) + (p.actief === false ? ' (gearchiveerd)' : ''), nu, p.streef, p.virtueel ? (p.weekinleg ? rond(p.weekinleg * 52 / 12) : null) : G.tempo(d, p.id), p, !p.streef && p.doel === 'btw' ? G.btwDekking(d, p.id) : null));
    }
    return rijen.join('') + (st.mag ? '<div style="margin-top:10px"><button class="mtg-knop" data-pot="nieuw">+ potje of doel toevoegen</button></div>' : '');
  }
  function virtueelSaldo(p, vandaag) {
    const s = p.streef && p.streef.start; if (!s || s.bedrag == null) return null;
    return rond(s.bedrag + (p.weekinleg || 0) * Math.max(0, Math.floor(dagenTussen(s.datum, vandaag) / 7)));
  }
  function potRij(id, naam, nu, streef, tempo, pot, btw) {
    const v = G.voortgang(streef, nu, tempo, st.data.vandaag);
    if (btw) return `<div class="mtg-pot" ${st.mag ? `data-pot="${esc(id)}" style="cursor:pointer"` : ''}><div class="r1"><b>${esc(naam)}</b><span style="font-weight:600">${esc(nu == null ? 'saldo onbekend' : eur(nu))}</span>
      <span class="mtg-chip">doel: BTW-aangifte ${esc(btw.kwartaal)} (≈${esc(kort(btw.bedrag))})</span></div>
      <div class="mtg-balk"><div style="width:${esc(btw.pct)}%"></div></div><div class="r3">${btw.gedekt == null ? 'saldo onbekend — ijk de pot om de dekking te zien' : btw.gedekt ? `dekt ${esc(btw.kwartaal)} (≈${eur(btw.bedrag)}) ✓ — verwacht ${eur(btw.pot)} op ${esc(datumTekst(btw.datum))}` : `tekort ${eur(btw.tekort)} vóór ${esc(datumTekst(btw.datum))} (aangifte ${esc(btw.kwartaal)} ≈${eur(btw.bedrag)})${G.btwInLopend(st.data) && (st.data.instellingen || {}).btw_pot === id ? ' — als reserve; de aangifte zelf gaat van de lopende rekening (+ BTW-pot)' : ''}`}${esc(pot && pot.weekinleg ? ' · inleg ' + eur(pot.weekinleg) + '/week' : '')} · automatisch doel; een eigen doel overschrijft het${G.btwInLopend(st.data) && (st.data.instellingen || {}).btw_pot === id ? ' · dekt de btw; het teveel telt niet mee in Besteedbaar' : ''}</div></div>`;
    const doelTekst = !streef ? (st.mag ? 'nog geen doel — tik om er een te geven' : 'geen doel') : streef.van != null && streef.tot != null ? `doel ${kort(streef.van)}–${kort(streef.tot)}${streef.herkomst === 'handmatig' ? ' (eigen bedrag)' : ''}` : `doel ${kort(streef.bedrag)}${streef.herkomst === 'advies' ? ' (volgt advies)' : streef.herkomst === 'handmatig' ? ' (eigen bedrag)' : ''}`;
    const adv = !streef || streef.herkomst === 'advies' ? null : id === 'lopend' ? G.lopendAdvies(st.data) : id === G.reservePot(st.data, st.cfg) ? G.reserveAdvies(st.data, streef) : null;   // ook met meegroeien uit
    const advTitel = !adv ? '' : id === 'lopend' ? `hoogste van maandpieken ${kort(adv.p75)} en vaste lasten ${kort(adv.vast)}${adv.brutoAdvies != null ? ` (referentie 2× bruto uitgaven ${kort(adv.brutoAdvies)})` : ''} — klik voor de uitleg` : `p90 van de maanddips ${kort(adv.p90)}${adv.band ? `, binnen je band ${kort(adv.band[0])}–${kort(adv.band[1])}` : ''} — klik voor de uitleg`;
    const advHtml = adv ? `<button class="mtg-advlink" data-adviesuitleg="${esc(id)}" title="${esc(advTitel)}">(advies ${esc(kort(adv.bedrag))})</button>` : '';
    let r3 = '';
    if (v) {
      if (v.gehaald) r3 = v.boven ? 'boven de bandbreedte' : 'doel gehaald ✓';
      else {
        const delen = [];
        if (v.nodig != null) delen.push(`nodig ${kort(v.nodig)}/mnd tot ${datumTekst(streef.datum)}`);
        else if (v.verlopen) delen.push(`streefdatum ${datumTekst(streef.datum)} is voorbij`);
        if (tempo != null) delen.push(`${pot && pot.virtueel ? 'gepland' : 'tempo'} ${kort(tempo)}/mnd${pot && pot.virtueel ? '' : ' (laatste weken, bank)'}`);
        if (v.verwacht) delen.push(`zo gehaald rond ${datumTekst(v.verwacht)}${v.opSchema === false ? ' — later dan de streefdatum' : ''}`);
        else if (v.nietBijDitTempo) delen.push('bij dit tempo niet: het saldo daalt of staat stil');
        else if (tempo == null) delen.push('nog te weinig bankhistorie voor een tempo');
        r3 = delen.join(' · ');
      }
    }
    const extra = pot ? [pot.virtueel ? 'virtueel (geen eigen rekening, telt niet mee in totaal)' : '', pot.weekinleg ? `inleg ${eur(pot.weekinleg)}/week` : ''].filter(Boolean).join(' · ') : '';
    const wz = streef && streef.wijziging && dagenTussen(streef.wijziging.datum, st.data.vandaag) <= 30 && streef.wijziging.naar === (streef.bedrag != null ? streef.bedrag : streef.van) ? streef.wijziging : null;   // alleen als het doel nog zo staat (niet na handmatig terugzetten)
    const vs = ((st.meegroei && st.meegroei.voorstel) || []).find(x => x.id === id);
    const meeTekst = (wz ? `<div class="r3" style="color:#7a6010">Doel ${wz.naar < wz.van ? 'verlaagd' : 'verhoogd'} van ${esc(eur(wz.van))} naar ${esc(eur(wz.naar))} op ${esc(datumTekst(wz.datum))}, omdat ${esc(wz.reden)}.</div>` : '')
      + (vs ? `<div class="r3" style="color:#7a6010">${vs.hoger ? `Advies: ${esc(eur(vs.naar))} (nu ${esc(eur(vs.van))}; ${esc(vs.waarom)}) — ${esc(vs.reden)}. ${st.mag ? `<button class="mtg-knop klein aan" data-doeladvies="${esc(id)}">Ja, overnemen</button>` : ''}`
        : `Voorstel: doel verlagen naar ${esc(eur(vs.naar))} — ${esc(vs.reden)}. ${st.mag ? `<button class="mtg-knop klein aan" data-doeladvies="${esc(id)}">Ja, verlagen</button>` : ''}`}</div>` : '')
      + (streef && streef.meegroeien !== false && (id === 'lopend' || id === G.reservePot(st.data, st.cfg)) ? `<div class="r3">doel groeit mee met de bankhistorie: automatisch alleen kleine stappen (max +10%, hooguit 1× per maand${streef.meegroei_max != null || streef.tot != null ? `, tot ${esc(eur(streef.meegroei_max != null ? streef.meegroei_max : streef.tot))}` : ', stel een bovengrens in'})${streef.advies_akkoord ? '' : ', na het eerste overgenomen advies'}</div>` : '');
    return `<div class="mtg-pot" ${st.mag ? `data-pot="${esc(id)}" style="cursor:pointer"` : ''}>
  <div class="r1"><b>${esc(naam)}</b><span class="${nu != null && nu < 0 ? 'mtg-uit' : ''}" style="font-weight:600">${esc(nu == null ? 'saldo onbekend' : eur(nu))}</span><span class="mtg-chip">${esc(doelTekst)}${advHtml}${streef && streef.datum ? ' · ' + esc(datumTekst(streef.datum)) : ''}</span></div>
  ${v ? `<div class="mtg-balk" title="${esc(v.pct)}% van de weg vanaf het startpunt"><div style="width:${esc(v.pct)}%"></div></div>` : ''}
  <div class="r3">${esc([r3, extra].filter(Boolean).join(' · '))}</div>${meeTekst}</div>`;
  }
  // Waarschuwingen in drie soorten: Moneybird even druk (429), nog in te stellen (verwacht tot de eigenaar het
  // instelt) en de rest (Let op).
  const isDruk = x => x.status === 429 || /\b429\b|retry later|even druk/i.test(x.fout || '');
  const isInstellen = x => x.bron === 'config' && !isDruk(x);
  G._soorten = { isDruk, isInstellen };
  function drukHtml() {
    const w = (st.data.waarschuwingen || []).filter(isDruk);
    if (!w.length) return '';
    return `<div class="mtg-uitleg" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="flex:1;min-width:200px"><b>Moneybird is even druk.</b> Niet alles kon worden opgehaald (${w.length}×); probeer het over een minuut opnieuw.</span><button class="mtg-knop klein aan" data-herlaad="1">Opnieuw laden</button></div>`;
  }
  function instellenHtml() {
    const w = (st.data.waarschuwingen || []).filter(isInstellen);
    if (!w.length) return '';
    const tekst = x => /spaarpotten/.test(x.fout) ? 'Spaarpotjes (grootboek of tegenrekening per potje)' : /kredietlimiet/.test(x.fout) ? 'Kredietlimiet van de lopende rekening'
      : /BTW-instellingen/.test(x.fout) ? 'BTW: van welke rekening de aangifte betaald wordt' : /weekdag/.test(x.fout) ? x.fout.replace(/ — stel hem in.*$/, '') : x.fout;
    return `<div class="mtg-kaart"><div class="mtg-kop" style="margin:0"><b style="flex:1">Nog in te stellen (${w.length})</b></div>
      <ul class="mtg-letop">${[...new Set(w.map(tekst))].map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      ${st.mag ? '<div class="mtg-knoppen"><button class="mtg-knop" data-inst="algemeen">Kredietlimiet en BTW…</button><button class="mtg-knop" data-pot="nieuw">+ potje</button></div>' : '<div class="mtg-melding">De eigenaar stelt dit in.</div>'}</div>`;
  }
  function letOpHtml() {
    const w = (st.data.waarschuwingen || []).filter(x => !isDruk(x) && !isInstellen(x));
    const lw = G.limietWaarschuwing(st.dataS || st.data, { prognose: st.prognose }, dagPlus(st.data.vandaag, 60));
    if (lw && lw.potNietGenoeg) w.unshift({ bron: 'limiet', fout: `Op ${datumTekst(lw.potNietGenoeg.datum)} is ook de BTW-pot niet genoeg: dan zakt lopend + BTW-pot onder de kredietlimiet (zie het laagste punt).` });
    if (lw && lw.timing) w.unshift({ bron: 'limiet', fout: `Je lopende rekening zelf komt op ${datumTekst(lw.timing.datum)} op ${eur(lw.timing.saldo)}, onder de kredietlimiet. Boek eerder geld terug van de BTW-rekening (≈${eur(lw.timing.nodig)} nodig).` });
    if (!w.length) return '';
    return `<div class="mtg-kaart"><div class="mtg-kop" style="margin:0"><b style="flex:1">Let op (${w.length})</b><button class="mtg-vraag" data-uitleg="letop">?</button></div>
      <details><summary class="mtg-melding" style="cursor:pointer">tonen</summary><ul class="mtg-letop">${w.map(x => `<li>${esc(x.fout)}${x.rekening ? ` <span class="mtg-chip">${esc(x.rekening)}</span>` : ''}</li>`).join('')}</ul></details></div>`;
  }
  function patronenHtml() {
    const p = st.data.patronen; if (!p || !p.lijst.length) return '';
    const dagen = ['', 'ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
    return `<div class="mtg-kaart"><div class="mtg-kop" style="margin:0"><b style="flex:1">Vaste patronen (${esc(p.aan)} actief)</b><button class="mtg-vraag" data-uitleg="patronen">?</button></div>
      <details><summary class="mtg-melding" style="cursor:pointer">tonen</summary>${p.lijst.map(x => `<div class="mtg-rij" style="cursor:default"><span class="p ${x.richting === 'in' ? 'mtg-in' : 'mtg-uit'}">${x.richting === 'in' ? '▲' : '▼'}</span>
        <span class="n">${esc(x.tegenpartij)} <span class="mtg-chip">${esc(x.frequentie === 'week' ? 'elke ' + dagen[x.weekdag] : 'rond de ' + (((x.dag + (x.verschuiving || 0) - 1) % 31) + 1) + 'e')}</span>${x.potje ? ' <span class="mtg-chip">potje</span>' : ''}</span>
        <span class="b">${esc(eur(x.bedrag))}</span>${st.mag && !x.potje ? `<button class="mtg-knop klein ${x.aan ? 'aan' : ''}" data-patroon="${esc(x.id)}" data-aan="${x.aan ? 0 : 1}">${x.aan ? 'aan' : 'uit'}</button>` : ''}</div>`).join('')}</details></div>`;
  }
  // ── Schulden (mt-schulden.js): per lening restschuld, rente, termijn, einde, nog te betalen rente + rekenhulp extra aflossen ──
  // De rekening-courant (kredietlimiet ingesteld) staat er altijd bij als "rood staan": geen lening om in te vullen.
  const RC_ID = ':rc';   // geen geldige lening-id (a-z, 0-9, -): botst nooit met een lening
  const rcPotten = () => (((st.cfg || {}).potten) || []).filter(p => !p.virtueel && p.actief !== false);
  function schuldenHtml() {
    const S = root.MTSchulden, lijst = ((st.cfg && st.cfg.schulden) || []);
    if (!S || !st.data) return '';
    const rc = S.rcInfo(st.data, st.cfg, G);
    if (!lijst.length && !rc && !st.mag) return '';
    S.css();
    const v = st.data.vandaag, keuzes = lijst.map(s => [s.id, s.naam]).concat(rc ? [[RC_ID, 'Rekening-courant (rood staan)']] : []);
    const nieuw = st.mag && !lijst.length ? `<div class="mtg-melding">Nog geen leningen ingevuld. <a href="#" data-inst="schulden">Lening toevoegen</a> (de hypotheek op het pand) voor de restschuld, de rente en de rekenhulp extra aflossen.</div>` : '';
    const kop = `<div class="mtg-kop" style="margin:0"><b style="flex:1">Schulden${lijst.length ? ` <span class="mtg-melding" style="font-weight:400">${lijst.length} lening${lijst.length === 1 ? '' : 'en'} · samen ${esc(S._eurC(lijst.reduce((x, s) => x + S.analyse(s, v).restNuCent, 0)))}</span>` : ''}</b><button class="mtg-vraag" data-uitleg="schulden">?</button></div>`;
    if (!keuzes.length) return `<div class="mtg-kaart" id="mts-plek">${kop}${nieuw}</div>`;
    const pots = rcPotten(), r = rc && rc.r, standaardPot = (r && r.potIds && r.potIds.find(id => pots.some(p => p.id === id && id !== (st.data.instellingen || {}).btw_pot))) || (pots[0] && pots[0].id) || '';
    const h = st.hulp = st.hulp || { id: keuzes[0][0], perMaand: '', eenmalig: '', datum: v, bron: standaardPot };
    if (!keuzes.some(k => k[0] === h.id)) h.id = keuzes[0][0];
    if (h.bron == null) h.bron = standaardPot;
    const isRc = h.id === RC_ID;
    const velden = isRc
      ? `<label>Bedrag (€)<input inputmode="decimal" data-hulp="eenmalig" value="${esc(h.eenmalig)}" placeholder="bv. 10.000"></label>
          <label>Waarvandaan<select data-hulp="bron">${pots.map(p => `<option value="${esc(p.id)}" ${h.bron === p.id ? 'selected' : ''}>terugboeken uit ${esc(G.potNaam(p))}</option>`).join('')}<option value="" ${!h.bron ? 'selected' : ''}>aanvullen (storting van buiten)</option></select></label>`
      : `<label>Extra per maand (€)<input inputmode="decimal" data-hulp="perMaand" value="${esc(h.perMaand)}" placeholder="bv. 500"></label>
          <label>Of eenmalig (€)<input inputmode="decimal" data-hulp="eenmalig" value="${esc(h.eenmalig)}" placeholder="bv. 10.000"></label>`;
    return `<div class="mtg-kaart" id="mts-plek">${kop}
      ${lijst.map(s => S.leningHtml(s, S.analyse(s, v))).join('')}${rc ? S.rcHtml(rc) : ''}${nieuw}
      <div class="mts-hulp"><b>${isRc ? 'Rekenhulp terugboeken/aanvullen' : 'Rekenhulp extra aflossen'}</b>
        <div class="rij" style="margin-top:6px">${keuzes.length > 1 ? `<label>Schuld<select data-hulp="id">${keuzes.map(([id, n]) => `<option value="${esc(id)}" ${id === h.id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : ''}
          ${velden}
          <label>Op / vanaf datum<input type="date" data-hulp="datum" value="${esc(h.datum)}" min="${esc(v)}"></label></div>
        <div id="mts-uit">${hulpUitkomst()}</div>
        <div class="mtg-melding" style="font-size:12px;margin-top:6px">${esc(S.INFO)}</div></div></div>`;
  }
  function hulpUitkomst() {
    const S = root.MTSchulden, h = st.hulp; if (!S || !h) return '';
    if (h.id === RC_ID) {
      const rc = S.rcInfo(st.data, st.cfg, G); if (!rc) return '';
      // Terugboeken kan nooit meer dan er (verwacht) in het potje zit op die datum: begrenzen, en dat melden.
      const gevraagd = S.centUit(h.eenmalig) || 0, pot = rcPotten().find(p => p.id === h.bron), start = h.datum && h.datum > st.data.vandaag ? h.datum : st.data.vandaag;
      const stand = pot && gevraagd > 0 ? G.potOp(st.data, pot.id, start, { prognose: true }) : null;
      const sc = S.potCent(stand), c = pot && gevraagd > 0 ? (sc == null ? 0 : Math.min(gevraagd, sc)) : gevraagd;
      const kas = c > 0 ? S.kasEffect(st.data, st.cfg, { terugCent: c, pot: pot ? pot.id : null, datum: start, nood: !!st.noodMee }, G) : null;
      return S.rcUitkomstHtml(rc, Object.assign({}, h, { bron: pot ? pot.id : '', cent: c, gevraagd }), kas, pot && G.potNaam(pot), pot && gevraagd > 0 ? { datum: start, stand: sc == null ? null : stand } : null);
    }
    const s = ((st.cfg && st.cfg.schulden) || []).find(x => x.id === h.id); if (!s) return '';
    const per = S.centUit(h.perMaand) || 0, een = S.centUit(h.eenmalig) || 0;
    const kas = per > 0 || een > 0 ? S.kasEffect(st.data, st.cfg, { perMaandCent: per, eenmaligCent: een, datum: h.datum, nood: !!st.noodMee }, G) : null;
    return S.uitkomstHtml(s, S.analyse(s, st.data.vandaag), Object.assign({ vandaag: st.data.vandaag }, h), kas);
  }
  // Leningen invullen (alleen de eigenaar; de worker controleert alles opnieuw).
  function schuldenBlad() {
    const S = root.MTSchulden, c = st.cfg || {}, lijst = (c.schulden || []).map(x => Object.assign({}, x));
    const cent = x => x == null ? '' : (x / 100).toLocaleString('nl-NL', { minimumFractionDigits: x % 100 ? 2 : 0, maximumFractionDigits: 2 });
    const veld = (s, i) => `<div class="mtg-kaart" data-i="${i}">
      <label class="mtg-veld"><span>Naam (max. 60 tekens)</span><input name="naam" maxlength="60" value="${esc(s.naam || '')}"></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><label class="mtg-veld" style="flex:1"><span>Soort</span><select name="soort">${S.SOORTEN.map(([k, t]) => `<option value="${k}" ${s.soort === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label class="mtg-veld" style="flex:1"><span>Vorm</span><select name="vorm">${S.VORMEN.map(([k, t]) => `<option value="${k}" ${s.vorm === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><label class="mtg-veld" style="flex:1"><span>Restschuld (€)</span><input name="rest" inputmode="decimal" value="${esc(cent(s.restschuld_cent))}"></label>
        <label class="mtg-veld" style="flex:1"><span>Stand op datum</span><input type="date" name="stand" value="${esc(s.stand_datum || st.data.vandaag)}"></label></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><label class="mtg-veld" style="flex:1"><span>Rente (% per jaar) — leeg = onbekend</span><input name="rente" inputmode="decimal" value="${esc(s.rente_bp == null ? '' : (s.rente_bp / 100).toLocaleString('nl-NL', { maximumFractionDigits: 2 }))}"></label>
        <label class="mtg-veld" style="flex:1"><span>Einddatum (optioneel)</span><input type="date" name="einde" value="${esc(s.einde || '')}"></label></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><label class="mtg-veld" style="flex:1"><span>Termijn per maand, rente + aflossing (€)</span><input name="termijn" inputmode="decimal" value="${esc(cent(s.maandtermijn_cent))}"></label>
        <label class="mtg-veld" style="flex:1"><span>Aflossing per maand (€, lineair)</span><input name="aflossing" inputmode="decimal" value="${esc(cent(s.aflossing_cent))}"></label></div>
      <label class="mtg-veld"><span>Moneybird-grootboek (id, optioneel)</span><input name="ledger" inputmode="numeric" value="${esc(s.ledger_id || '')}"></label>
      <button class="mtg-knop klein" data-weg="${i}">Lening verwijderen</button></div>`;
    const o = blad(`<h3>Leningen</h3><div class="mtg-melding">${esc(S.INFO)} Bedragen in euro's; de rekenhulp rekent in hele centen.</div>
      <div class="mts-lijst">${lijst.map(veld).join('')}</div>
      ${lijst.length < 10 ? '<button class="mtg-knop" data-nieuw="1">+ lening</button>' : ''} <button class="mtg-knop aan" data-ok="1">Opslaan</button>`);
    const lees = () => {
      const uit = [];
      for (const k of o.querySelectorAll('.mts-lijst [data-i]')) {
        const f = n => k.querySelector(`[name="${n}"]`).value.trim(), oud = lijst[Number(k.dataset.i)] || {};
        const opt = (n, wat) => { const t = f(n); if (t === '') return null; if (/-/.test(t)) throw new Error(`${wat} kan niet negatief zijn`); const c = S.centUit(t); if (c == null) throw new Error(`${wat} is niet te lezen`); return c; };
        const naam = f('naam'); if (!naam) throw new Error('geef elke lening een naam');
        const rest = opt('rest', 'De restschuld'); if (rest == null) throw new Error(`vul de restschuld van "${naam}" in`);
        const stand = f('stand'), einde = f('einde') || null;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(stand)) throw new Error(`kies de datum van de stand voor "${naam}"`);
        if (einde && einde <= stand) throw new Error(`de einddatum van "${naam}" moet na de stand liggen`);
        const led = f('ledger'); if (led && !/^\d{6,25}$/.test(led)) throw new Error('het grootboek-id bestaat alleen uit cijfers');
        uit.push({ id: oud.id || ('lening-' + Math.random().toString(36).slice(2, 8)), naam: naam.slice(0, 60), soort: f('soort'), restschuld_cent: rest, stand_datum: stand,
          rente_bp: opt('rente', 'De rente'), maandtermijn_cent: opt('termijn', 'De termijn'), aflossing_cent: opt('aflossing', 'De aflossing'), vorm: f('vorm'), einde, ledger_id: led || null });
      }
      return uit;
    };
    o.addEventListener('click', ev => {
      const k = ev.target.closest('[data-weg],[data-nieuw],[data-ok]'); if (!k) return;
      if (k.dataset.weg != null) { if (!confirm('Deze lening verwijderen? (de vorige instellingen blijven in de historie bewaard)')) return; k.closest('[data-i]').remove(); }
      else if (k.dataset.nieuw) { const n = lijst.length; lijst.push({ soort: 'hypotheek', vorm: 'annuiteit', stand_datum: st.data.vandaag }); o.querySelector('.mts-lijst').insertAdjacentHTML('beforeend', veld(lijst[n], n)); if (o.querySelectorAll('.mts-lijst [data-i]').length >= 10) k.remove(); }
      else { let uit; try { uit = lees(); } catch (e) { return toast(e.message); } o.remove(); opslaan(() => stuur('/geld/config', { revisie: c.revisie, schulden: uit }), 'Leningen opgeslagen'); }
    });
  }
  function instellingenHtml() {
    const c = st.cfg || {}, b = c.btw || {};
    return `<div class="mtg-kaart"><details><summary style="cursor:pointer"><b>Instellingen</b> <span class="mtg-melding">kredietlimiet, BTW, klantgroepen</span></summary>
      <dl class="mtg-dl"><dt>Kredietlimiet</dt><dd>${esc(c.kredietlimiet == null ? 'niet ingesteld' : eur(c.kredietlimiet))}</dd>
      <dt>BTW-sparen</dt><dd>${b.spaarpercentage ? Math.round(b.spaarpercentage * 10000) / 100 + '% naar ' + esc(b.spaarpot || '?') : 'uit'}</dd>
      <dt>BTW-aangifte</dt><dd>${b.modus === 'apart' ? `van ${esc(b.aangifte_van || 'lopend (aangenomen)')}${b.terugboeking_van ? ', terug uit ' + esc(b.terugboeking_van) : ''}` : 'van de lopende rekening; de BTW-pot dekt het deel dat erin zit (zie Besteedbaar)'}</dd>
      <dt>Klantgroepen</dt><dd>${(c.klantgroepen || []).map(g => esc(g.naam) + (g.prefix ? ` (begint met "${esc(g.prefix)}")` : ` (${g.contact_ids.length} klanten)`)).join(', ') || 'geen'}</dd>
      <dt>Prognose</dt><dd>${c.prognose_schema ? `schema: klein onder ${eur(c.prognose_schema.grens_klein)}, groot vanaf ${eur(c.prognose_schema.grens_groot)}` : 'standaardschema nog niet ingesteld'}</dd></dl>
      <div class="mtg-knoppen"><button class="mtg-knop" data-inst="algemeen">Kredietlimiet en BTW…</button><button class="mtg-knop" data-inst="groepen">Klantgroepen…</button><button class="mtg-knop" data-inst="schema">Prognose-schema…</button><button class="mtg-knop" data-inst="schulden">Leningen…</button></div></details></div>`;
  }

  // ── Grafiek (SVG) ────────────────────────────────────────────────────────────
  function grafiek() {
    const box = st.el.querySelector('#mtg-grafiek'); if (!box) return;
    const d = st.dataS || st.data, lijn = st.lijn, n = ZOOM[st.zoom];
    if (lijn.onbekend) { box.innerHTML = '<div class="mtg-melding">Saldo onbekend — ijk eerst de rekening (Potjes → tik op de rekening → saldo ijken).</div>'; return; }
    const vanD = dagPlus(d.vandaag, Math.round(-n * 0.25) + st.offset), totD = dagPlus(vanD, n);
    const pts = lijn.punten.filter(p => p.datum >= vanD && p.datum <= totD);
    if (pts.length < 2) { box.innerHTML = '<div class="mtg-melding">Geen gegevens voor deze periode.</div>'; return; }
    const W = Math.max(300, box.clientWidth || 600), H = box.clientWidth < 700 ? 220 : 260, pl = 46, pr = 8, pt = 10, pb = 44;   // onderin: datums + strook voor ▲▼
    const limiet = st.modus === 'lopend' && d.saldo.lopend.kredietlimiet != null ? -d.saldo.lopend.kredietlimiet : null;
    // de lijn zonder prognose als stippel-referentie wanneer prognose aan staat
    const zonder = st.prognose && (d.events || []).some(e => e.zekerheid === 'prognose') ? G.lijn(d, { modus: st.modus, prognose: false }).punten.filter(p => p.datum >= vanD && p.datum <= totD) : null;
    // G7: gele lijn = +fictieve buffer, oranje = 0 − noodbuffer-potstand (alleen als de noodbuffer niet meetelt), rood = −kredietlimiet
    const fict = st.modus === 'lopend' ? G.fictief(cfgE()) : 0, bsd = G.besteedbaar(d, st.cfg, { nood: !!st.noodMee }), noodS = st.modus === 'lopend' && !st.noodMee && bsd && bsd.nood.stand > 0 ? bsd.nood.stand : 0;
    const waarden = pts.map(p => p.saldo).concat(zonder ? zonder.map(p => p.saldo) : [], limiet != null ? [limiet] : [], fict > 0 ? [fict] : [], noodS > 0 ? [-noodS] : [], [0]);
    let lo = Math.min(...waarden), hi = Math.max(...waarden); if (hi - lo < 100) { hi += 50; lo -= 50; }
    const marge = (hi - lo) * 0.08; lo -= marge; hi += marge;
    const x = dd => pl + dagenTussen(vanD, dd) / n * (W - pl - pr), y = v => pt + (hi - v) / (hi - lo) * (H - pt - pb);
    // Traplijn: het saldo verandert óp de dag van de beweging (geen schuine lijnen tussen dagen).
    const pad = l => l.map((p, i) => i ? `H${x(p.datum).toFixed(1)}V${y(p.saldo).toFixed(1)}` : `M${x(p.datum).toFixed(1)},${y(p.saldo).toFixed(1)}`).join('');
    // Met prognose: alleen tekenen waar het afwijkt van de gewone verwachting (losse stukken).
    const afwijk = (met, zon) => { const z = new Map(zon.map(p => [p.datum, p.saldo])); let h = '', vorig = null;
      met.forEach((p, i) => { const anders = Math.abs(p.saldo - (z.has(p.datum) ? z.get(p.datum) : p.saldo)) > 0.5;
        if (anders) h += vorig ? `H${x(p.datum).toFixed(1)}V${y(p.saldo).toFixed(1)}` : `M${x(p.datum).toFixed(1)},${y(z.get(p.datum)).toFixed(1)}V${y(p.saldo).toFixed(1)}`;
        else if (vorig) h += `H${x(p.datum).toFixed(1)}V${y(p.saldo).toFixed(1)}`;
        vorig = anders ? p : null; }); return h; };
    const ver = pts.filter(p => p.datum <= d.vandaag), toek = pts.filter(p => p.datum >= d.vandaag);
    const ticks = [], stap = niceStap((hi - lo) / 4); for (let t = Math.ceil(lo / stap) * stap; t <= hi; t += stap) ticks.push(t);
    const maandStreep = []; for (let dd = vanD; dd <= totD; dd = dagPlus(dd, 1)) if (dd.endsWith('-01') || (n <= 31 && new Date(dd + 'T00:00:00Z').getUTCDay() === 1)) maandStreep.push(dd);
    // ▲▼: grootste bewegingen per dag (gepland én verleden)
    const perDag = {};
    for (const e of d.events || []) { if (!e.datum || e.datum < vanD || e.datum > totD || e.saldo_ijkpunt || !G.telt(e, { prognose: st.prognose })) continue; const ef = effect(e, st.modus, G.groep(d)); if (!ef) continue; const dd = e.bron !== 'bank' && e.datum < d.vandaag ? d.vandaag : e.datum; perDag[dd] = perDag[dd] || { in: 0, uit: 0 }; if (ef > 0) perDag[dd].in += ef; else perDag[dd].uit += ef; }
    // ▲▼ op een eigen strook onder de datums, grootte naar het bedrag (kleine posten weg: < 4% van het bereik).
    const drempel = (hi - lo) * 0.04, groot = Math.max(1, ...Object.values(perDag).map(s => Math.max(s.in, -s.uit)));
    const maat = b => (9 + 9 * Math.sqrt(Math.min(1, Math.abs(b) / groot))).toFixed(1);
    const pijlen = Object.entries(perDag).flatMap(([dd, s]) => [s.in > drempel ? `<text x="${esc(x(dd))}" y="${esc(H - 18)}" text-anchor="middle" font-size="${esc(maat(s.in))}" fill="var(--mtg-in)">▲</text>` : '', s.uit < -drempel ? `<text x="${esc(x(dd))}" y="${esc(H - 3)}" text-anchor="middle" font-size="${esc(maat(s.uit))}" fill="var(--mtg-uit)">▼</text>` : '']).join('');
    const vlaggen = mijlpaalVlaggen(vanD, totD, x, y);
    // Zones tussen de lijnen (subtiel): 0 tot geel, 0 tot oranje, oranje tot rood.
    const band = (a, b, kleur, op, klasse) => { const top = Math.min(hi, Math.max(a, b)), bot = Math.max(lo, Math.min(a, b)); return top > bot ? `<rect x="${esc(pl)}" y="${esc(y(top))}" width="${esc(W - pl - pr)}" height="${esc(y(bot) - y(top))}" fill="${esc(kleur)}" fill-opacity="${esc(op)}" class="${esc(klasse)}"/>` : ''; };
    const zones = st.modus !== 'lopend' ? '' : band(0, fict, '#f2d34b', 0.14, 'mtg-zone-geel') + (noodS > 0 ? band(0, -noodS, '#e07b1a', 0.1, 'mtg-zone-oranje') : '') + (limiet != null ? band(noodS > 0 ? -noodS : 0, limiet, '#d9574a', 0.08, 'mtg-zone-rood') : '');
    box.innerHTML = `<svg viewBox="0 0 ${esc(W)} ${esc(H)}" preserveAspectRatio="none" role="img" aria-label="Verloop saldo">
      ${ticks.map(t => `<line x1="${esc(pl)}" x2="${esc(W - pr)}" y1="${esc(y(t))}" y2="${esc(y(t))}" stroke="#e8e6de" stroke-width="1"/><text x="${esc(pl - 4)}" y="${esc(y(t) + 3)}" text-anchor="end" font-size="10" fill="#8a8a80">${esc(kort(t))}</text>`).join('')}
      ${maandStreep.map(dd => `<line x1="${esc(x(dd))}" x2="${esc(x(dd))}" y1="${esc(pt)}" y2="${esc(H - pb)}" stroke="#f0eee6"/><text x="${esc(x(dd) + 2)}" y="${esc(H - pb + 12)}" font-size="10" fill="#8a8a80">${esc(datumTekst(dd))}</text>`).join('')}
      ${zones}
      ${lo < 0 && hi > 0 ? `<line x1="${esc(pl)}" x2="${esc(W - pr)}" y1="${esc(y(0))}" y2="${esc(y(0))}" stroke="#bbb" stroke-width="1"/>` : ''}
      ${fict > 0 && fict <= hi ? `<line x1="${esc(pl)}" x2="${esc(W - pr)}" y1="${esc(y(fict))}" y2="${esc(y(fict))}" stroke="#d9a400" stroke-width="1.5"/><text x="${esc(W - pr - 2)}" y="${esc(y(fict) - 3)}" text-anchor="end" font-size="10" fill="#a07800">fictieve buffer</text>` : ''}
      ${noodS > 0 && -noodS >= lo ? `<line x1="${esc(pl)}" x2="${esc(W - pr)}" y1="${esc(y(-noodS))}" y2="${esc(y(-noodS))}" stroke="#e07b1a" stroke-width="1.5"/><text x="${esc(W - pr - 2)}" y="${esc(y(-noodS) - 3)}" text-anchor="end" font-size="10" fill="#b35a00">noodbuffer is op</text>` : ''}
      ${limiet != null && limiet >= lo ? `<line x1="${esc(pl)}" x2="${esc(W - pr)}" y1="${esc(y(limiet))}" y2="${esc(y(limiet))}" stroke="var(--mtg-uit)" stroke-width="1.5"/><text x="${esc(W - pr - 2)}" y="${esc(y(limiet) - 3)}" text-anchor="end" font-size="10" fill="var(--mtg-uit)">kredietlimiet</text>` : ''}
      ${d.vandaag >= vanD && d.vandaag <= totD ? `<line x1="${esc(x(d.vandaag))}" x2="${esc(x(d.vandaag))}" y1="${esc(pt)}" y2="${esc(H - pb)}" stroke="var(--gold,#B8962E)" stroke-dasharray="3 3"/>` : ''}
      ${st.markeer && st.markeer >= vanD && st.markeer <= totD ? `<line x1="${esc(x(st.markeer))}" x2="${esc(x(st.markeer))}" y1="${esc(pt)}" y2="${esc(H - pb)}" stroke="var(--mtg-uit)" stroke-width="1.5" stroke-dasharray="2 2"/><text x="${esc(x(st.markeer) + 3)}" y="${esc(pt + 20)}" font-size="10" fill="var(--mtg-uit)">laagste punt</text>` : ''}
      ${ver.length > 1 ? `<path d="${esc(pad(ver))}" fill="none" stroke="var(--mtg-lijn)" stroke-width="2"/>` : ''}
      ${(zonder || toek).filter(p => p.datum >= d.vandaag).length > 1 ? `<path d="${esc(pad((zonder || toek).filter(p => p.datum >= d.vandaag)))}" fill="none" stroke="var(--mtg-lijn)" stroke-width="2" stroke-dasharray="6 4"/>` : ''}
      ${zonder && toek.length > 1 ? `<path d="${esc(afwijk(toek, zonder.filter(p => p.datum >= d.vandaag)))}" fill="none" stroke="#3a5a8a" stroke-width="2" stroke-dasharray="1 3"/>` : ''}
      ${(() => { const z = G.onzekerVanaf(d, { prognose: st.prognose }); if (z >= totD) return ''; const x0 = Math.max(pl, x(z < vanD ? vanD : z));
        return `<defs><pattern id="mtg-arc" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#8a8a80" stroke-opacity="0.22" stroke-width="2"/></pattern></defs><rect x="${esc(x0)}" y="${esc(pt)}" width="${Math.max(0, W - pr - x0)}" height="${esc(H - pt - pb)}" fill="url(#mtg-arc)" class="mtg-zone"/><text x="${Math.min(x0 + 4, W - pr - 4)}" y="${esc(pt + 32)}" font-size="10" fill="#7a7a70">verder weg: alleen vaste lasten bekend — vul de prognose aan</text>`; })()}
      ${pijlen}${vlaggen}
      <rect x="${esc(pl)}" y="0" width="${esc(W - pl - pr)}" height="${esc(H)}" fill="transparent" class="mtg-vang"/></svg><div class="mtg-tip" style="display:none"></div>`;
    st.geo = { vanD, n, W, pl, pr };
    gebaren(box);
  }
  function niceStap(r) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, r)))); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= r) || p * 10; }
  function mijlpaalVlaggen(vanD, totD, x, y) {
    if (st.modus !== 'lopend') return '';
    const streef = cfgE().lopend_streef, m = G.mijlpalen(streef, 'lopend'), punten = st.lijn.punten;
    let h = '';
    for (const mp of m) {
      const p = punten.find(q => !q.verleden && q.datum >= st.data.vandaag && q.saldo >= mp && q.datum >= vanD && q.datum <= totD);
      if (p && besNu(st.data) < mp) h += `<text x="${esc(x(p.datum))}" y="${esc(y(mp) - 4)}" font-size="12" fill="var(--gold,#B8962E)">⚑</text>`;
    }
    if (streef && streef.datum && (streef.bedrag != null || streef.van != null)) {   // doelpad: stippellijn van nu naar het doel op de streefdatum
      const doel = streef.bedrag != null ? streef.bedrag : streef.van, nu = besNu(st.data);
      if (nu != null && streef.datum > st.data.vandaag) {
        const a = st.data.vandaag < vanD ? vanD : st.data.vandaag, b = streef.datum > totD ? totD : streef.datum, f = dd => nu + (doel - nu) * dagenTussen(st.data.vandaag, dd) / dagenTussen(st.data.vandaag, streef.datum);
        if (a < b) h += `<path d="M${esc(x(a))},${esc(y(f(a)))}L${esc(x(b))},${esc(y(f(b)))}" stroke="var(--gold,#B8962E)" stroke-width="1.5" stroke-dasharray="4 4" fill="none"/>`;
      }
    }
    return h;
  }
  // Slepen/vegen = verschuiven; knijpen = zoomen; tikken = dag-info.
  // Luisteraars op het vaste vak (niet op de SVG, die tijdens het slepen opnieuw getekend wordt) + pointer capture.
  function gebaren(box) {
    if (box.dataset.gebaren) return; box.dataset.gebaren = '1';
    const ptrs = new Map(); let start = null, pinch = null;
    const dagVan = cx => { const g = st.geo, svg = box.querySelector('svg'); if (!g || !svg) return null; const r = svg.getBoundingClientRect(), f = (cx - r.left) / r.width * g.W; return dagPlus(g.vanD, Math.round((f - g.pl) / (g.W - g.pl - g.pr) * g.n)); };
    const tip = () => box.querySelector('.mtg-tip');
    box.addEventListener('pointerdown', e => { if (!box.querySelector('svg')) return; try { box.setPointerCapture(e.pointerId); } catch (x) { } ptrs.set(e.pointerId, e.clientX);
      if (ptrs.size === 1) start = { x: e.clientX, off: st.offset, t: Date.now() }; if (ptrs.size === 2) { const v = [...ptrs.values()]; pinch = Math.abs(v[0] - v[1]); start = null; } });
    box.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) { toonTip(dagVan(e.clientX), e); return; }
      ptrs.set(e.pointerId, e.clientX);
      if (ptrs.size === 2 && pinch) { const v = [...ptrs.values()], afst = Math.abs(v[0] - v[1]); if (afst > pinch * 1.4) { zoomStap(-1); pinch = afst; } else if (afst < pinch / 1.4) { zoomStap(1); pinch = afst; } return; }
      if (start && st.geo) { const r = box.getBoundingClientRect(), dd = Math.round(-(e.clientX - start.x) / r.width * st.geo.n); if (dd + start.off !== st.offset) { st.offset = start.off + dd; begrens(); grafiek(); } }
    });
    const los = e => {
      if (!ptrs.has(e.pointerId)) return;
      const tik = start && ptrs.size === 1 && Math.abs(e.clientX - start.x) < 6 && Date.now() - start.t < 400;
      ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
      if (tik) { start = null; const d = dagVan(e.clientX); if (d) dagInfo(d); return; }
      if (!ptrs.size) { const sleep = start && start.off !== st.offset; start = null; if (sleep) teken(); }
    };
    box.addEventListener('pointerup', los); box.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); if (!ptrs.size) { start = null; pinch = null; } });
    box.addEventListener('pointerleave', () => { const t = tip(); if (t) t.style.display = 'none'; });
    function toonTip(dd, e) {
      const t = tip(), p = dd && st.lijn.punten.find(q => q.datum === dd); if (!t) return; if (!p) { t.style.display = 'none'; return; }
      const r = box.getBoundingClientRect(); t.style.display = ''; t.style.left = (e.clientX - r.left) + 'px'; t.style.top = '40px';
      t.textContent = `${datumTekst(dd)}: ${eur(p.saldo_gepland != null ? p.saldo_gepland : p.saldo)}`;
    }
  }
  function begrens() {
    const d = st.data, n = ZOOM[st.zoom], eerste = st.lijn.punten.length ? st.lijn.punten[0].datum : d.vandaag;
    const minOff = dagenTussen(d.vandaag, eerste) + Math.round(n * 0.25), maxOff = dagenTussen(d.vandaag, d.tot) - n + Math.round(n * 0.25);
    st.offset = Math.max(Math.min(st.offset, Math.max(maxOff, 0)), Math.min(minOff, 0));
  }
  function zoomStap(r) { const z = Object.keys(ZOOM), i = Math.max(0, Math.min(z.length - 1, z.indexOf(st.zoom) + r)); if (z[i] !== st.zoom) { st.zoom = z[i]; ls.set('mtg:zoom:' + st.wie, st.zoom); begrens(); grafiek(); } }
  // Laagste punt: naar die dag in de grafiek (gemarkeerd) en de drie posten die het meest bijdragen (tot en met die dag).
  G.laagsteOorzaken = function (data, low, opt) {
    const groep = G.groep(data);
    return (data.events || []).filter(e => isGepland(e) && G.telt(e, opt) && e.datum <= low.datum).map(e => ({ e, ef: effect(e, 'lopend', groep) }))
      .filter(x => x.ef < 0).sort((a, b) => a.ef - b.ef).slice(0, 3).map(x => x.e);
  };
  // Een voorstel (hoger of lager) alleen na "Ja"; daarna mag het doel in kleine stappen vanzelf meegroeien (advies_akkoord).
  // De wijziging komt in de historie van de instellingen.
  function doelAdvies(id) {
    const vs = ((st.meegroei && st.meegroei.voorstel) || []).find(x => x.id === id), cfg = st.cfg; if (!st.mag || !vs || !cfg) return;
    const maand = st.data.vandaag.slice(0, 7), wz = { van: vs.van, naar: vs.naar, datum: st.data.vandaag, reden: (vs.hoger ? 'overgenomen op voorstel: ' : 'verlaagd op voorstel: ') + vs.reden };
    const zet = s => Object.assign({}, s, { bedrag: vs.naar, advies_maand: maand, wijziging: wz, advies_akkoord: { bedrag: vs.naar, datum: st.data.vandaag } });
    const body = { revisie: cfg.revisie };
    if (id === 'lopend') body.lopend_streef = zet(cfg.lopend_streef);
    else body.potten = cfg.potten.map(p => p.id === id ? Object.assign({}, p, { streef: zet(p.streef) }) : p);
    return opslaan(() => stuur('/geld/config', body), vs.hoger ? 'Advies overgenomen' : 'Doel verlaagd');
  }
  function laagsteUitleg() {
    const low = st.low; if (!low) return;
    const n = ZOOM[st.zoom]; st.markeer = low.datum; st.offset = dagenTussen(st.data.vandaag, low.datum) - Math.round(n * 0.5) + Math.round(n * 0.25); begrens(); teken();
    const oorz = G.laagsteOorzaken(st.dataS || st.data, low, { prognose: st.prognose });
    blad(`<h3>Laagste punt: ${esc(eur(low.saldo))}</h3><div class="mtg-melding">${esc(datumTekst(low.datum, true))} — in de grafiek gemarkeerd. Vertrekpunt: het besteedbaar budget van nu, ${esc(eur(besNu(st.data)))}. De grootste geplande posten die er (tot en met die dag) aan bijdragen:</div>
      ${oorz.length ? oorz.map(rijHtml).join('') : '<div class="mtg-melding">Geen geplande uitgaven vóór die dag — het laagste punt is het saldo van nu.</div>'}`);
  }
  function dagInfo(dd) {
    const ev = ((st.dataS || st.data).events || []).filter(e => (e.datum === dd || (dd === st.data.vandaag && isGepland(e) && e.datum < dd)) && !e.saldo_ijkpunt && G.telt(e, { prognose: st.prognose }));
    const p = st.lijn.punten.find(q => q.datum === dd);
    blad(`<h3>${esc(datumTekst(dd, true))}</h3><div class="mtg-melding">Saldo ${dd < st.data.vandaag ? 'aan het eind van de dag' : 'verwacht'}: <b>${esc(eur(p ? (p.saldo_gepland != null ? p.saldo_gepland : p.saldo) : null))}</b></div>
      ${ev.length ? ev.map(rijHtml).join('') : '<div class="mtg-melding">Geen bewegingen op deze dag.</div>'}`);
  }


  // ── G5: prognose, factuurmoment-hulp ─────────────────────────────────────────
  // Scenario: termijndatums lokaal verschuiven (lijn rekent mee) tot je opslaat. st.scenario[sleutel][termijn] = nieuwe factuurdatum.
  // Een verschoven termijn verschuift zijn verwachte ontvangst en het BTW-sparen dat erbij hoort evenveel.
  G.metScenario = function (data, scenario) {
    if (!scenario || !Object.keys(scenario).length) return data;
    const schuif = {};
    const events = (data.events || []).map(e => {
      const nieuw = e.prognose && e.termijn_id && scenario[e.prognose] && scenario[e.prognose][e.termijn_id];
      if (!nieuw || !e.factuurdatum) return e;
      let fd = nieuw < data.vandaag ? data.vandaag : nieuw, d = G.bankdagNa(dagPlus(fd, e.ontvangst_na || 0)); if (d < data.vandaag) d = G.bankdagNa(data.vandaag);
      schuif[e.id] = d;
      return Object.assign({}, e, { factuurdatum: fd, datum: d, scenario: true });
    }).map(e => e.van_event && schuif[e.van_event] ? Object.assign({}, e, { datum: schuif[e.van_event], scenario: true }) : e);
    return Object.assign({}, data, { events });
  };
  // Drempel voor het signaal: de buffer (zelf ingesteld) of anders de kredietlimiet.
  // Drempel voor signalen en advies: de eigen ondergrens als die is ingesteld, anders de onderkant van de eigen reserve,
  // anders de kredietlimiet. Onder 0 maar binnen de reserve is geen alarm.
  // G7: de onderkant van de kasruimte is de gele lijn (de fictieve buffer: eigen bedrag of advies); zonder beide de nullijn.
  G.drempelSoort = (data, cfg) => (typeof G.effCfg(data, cfg).fictieve_buffer === 'number' ? 'fictief' : 'nul');   // buffer_lopend is samengevoegd met de fictieve buffer (de worker migreert het oude veld)
  G.drempel = function (data, cfg, datum) {
    const e = G.effCfg(data, cfg), soort = G.drempelSoort(data, e);
    return soort === 'fictief' ? G.fictief(e) : 0;
  };
  // Factuurmoment-hulp: welke prognosetermijn eerder factureren tilt het laagste punt het meest op? Alleen een voorstel.
  G.factuurAdvies = function (data, cfg, scenario, tot) {
    cfg = G.effCfg(data, cfg);
    if (G.drempel(data, cfg) == null) return null;
    const basis = G.metScenario(data, scenario), lijn0 = G.kasLijn(basis, cfg, { prognose: true }), low0 = G.laagste(lijn0, tot);
    const drempel = low0 ? G.drempel(data, cfg, low0.datum) : G.drempel(data, cfg);   // de reserve op de dag van het dieptepunt
    if (!low0 || low0.saldo >= drempel) return { ok: true, low: low0, drempel };
    const kand = (basis.events || []).filter(e => e.bron === 'prognose' && e.termijn_id && e.factuurdatum && e.datum > low0.datum);
    let best = null;
    for (const e of kand) {
      let fd = dagPlus(low0.datum, -(e.ontvangst_na || 0)); if (fd < data.vandaag) fd = data.vandaag;
      while (fd > data.vandaag && G.bankdagNa(dagPlus(fd, e.ontvangst_na || 0)) > low0.datum) fd = dagPlus(fd, -1);   // ontvangst vóór (of op) het dieptepunt
      while (fd > data.vandaag && !bankdag(fd)) fd = dagPlus(fd, -1);                                                  // factureren op een werkdag
      for (const kies of [...new Set([fd, data.vandaag])]) {
        if (kies >= e.factuurdatum) continue;
        const sc = JSON.parse(JSON.stringify(scenario || {})); (sc[e.prognose] = sc[e.prognose] || {})[e.termijn_id] = kies;
        const low = G.laagste(G.kasLijn(G.metScenario(data, sc), cfg, { prognose: true }), tot);
        if (low && (!best || low.saldo > best.low.saldo + 0.004)) best = { event: e, van: e.factuurdatum, naar: kies, low, winst: rond(low.saldo - low0.saldo), scenario: sc, opTijd: G.bankdagNa(dagPlus(kies, e.ontvangst_na || 0)) <= low0.datum };
      }
    }
    if (best && cfg && cfg.lopend_streef && cfg.lopend_streef.datum) {
      const s = cfg.lopend_streef, doel = s.bedrag != null ? s.bedrag : s.van, p = G.kasLijn(G.metScenario(data, best.scenario), cfg, { prognose: true }).punten.find(q => q.datum === s.datum);
      if (p && doel != null && p.saldo >= doel) best.doelpad = true;
    }
    return { ok: false, low: low0, drempel, voorstel: best && best.winst > 0 ? best : null };
  };
  // Termijnen uit het standaardschema (instellingen): grootte → percentages; datum = de start- of opleverdatum als die
  // bekend is (anker), anders akkoord + het aantal dagen (zoals afgesproken: +7/+50/+100 bij onbekende planning).
  G.schemaTermijnen = function (schema, totaal, datums) {
    if (!schema || !(totaal > 0) || schema.grens_klein == null || schema.grens_groot == null) return [];
    const klasse = schema.grens_klein != null && totaal < schema.grens_klein ? 'klein' : schema.grens_groot != null && totaal < schema.grens_groot ? 'middel' : 'groot';
    const rijen = schema[klasse] || []; if (!rijen.length) return [];
    let rest = rond(totaal);
    return rijen.map((r, i) => {
      const b = i === rijen.length - 1 ? rest : rond(totaal * r.pct / 100); rest = rond(rest - b);
      const anker = r.anker === 'start' && datums.start ? datums.start : r.anker === 'oplevering' && datums.oplevering ? datums.oplevering : null;
      return { id: 't' + (i + 1), label: r.label || 'termijn ' + (i + 1), bedrag: b, factuurdatum: anker || dagPlus(datums.akkoord, r.dagen), aan: true, pct: r.pct };
    });
  };
  // Voorstel voor de verdeling per grootte (percentages); de grensbedragen vult de eigenaar zelf in (geen bedragen in de code).
  G.SCHEMA_VOORSTEL = { grens_klein: null, grens_groot: null, betaaltermijn: 14,
    klein: [{ pct: 100, dagen: 14, label: 'factuur', anker: 'akkoord' }],
    middel: [{ pct: 50, dagen: 7, label: 'aanbetaling', anker: 'akkoord' }, { pct: 50, dagen: 60, label: 'oplevering', anker: 'oplevering' }],
    groot: [{ pct: 50, dagen: 7, label: 'bevestiging opdracht', anker: 'akkoord' }, { pct: 40, dagen: 50, label: 'voor oplevering', anker: 'start' }, { pct: 10, dagen: 100, label: 'oplevering', anker: 'oplevering' }] };
  UITLEG.prognose = 'Projecten die zeker doorgaan maar nog geen factuur hebben. Vink een project aan; het bedrag (incl. btw) wordt volgens het standaardschema in termijnen verdeeld, elk met een factuurdatum. Voorbeeld: een middelgroot project geeft 50% aanbetaling een week na akkoord en 50% bij oplevering; de tool rekent er de betaaltermijn en het gewone betaalgedrag van de klant bij. In de lijn is dat de stippellijn, en alleen als "prognose" aan staat. Komt de echte factuur in Moneybird (zelfde offerte, of het offertenummer in de referentie), dan vervangt die de termijn vanzelf; twijfelt de tool, dan vraagt hij het hier. Schuif een factuurdatum om te zien wat eerder factureren doet — pas bij "Opslaan" wordt het bewaard. Er gaat nooit iets naar Moneybird.';
  UITLEG.planning = 'Per maand wat er naar verwachting gefactureerd wordt, uit de termijnen van de projecten die zeker doorgaan (Prognose). De maand is de maand van de factuurdatum van de termijn: kies een andere maand en de factuurdatum gaat naar die maand (zelfde dag, in de lopende maand niet vóór vandaag); de lijn en de prognose rekenen meteen mee. Bedragen zijn incl. btw. Een termijn die in Moneybird al gefactureerd is telt niet meer mee en staat als gefactureerd bij zijn maand. Termijnen waarvan de datum voorbij is en die nog niet gefactureerd zijn staan apart bovenaan. Er gaat nooit iets naar Moneybird.';
  UITLEG.reserve = UITLEG.nood;   // oude sleutel
  UITLEG.schulden = 'Per lening: de restschuld nu (een schatting als er sinds de ingevulde stand maanden zijn verstreken), de rente, de termijn, de einddatum en de rente die nog betaald wordt, volgens het aflosschema (annuïtair of lineair; aflossingsvrij lost niet af; zonder bekende rente geen prognose). De rekenhulp vergelijkt het schema met en zonder extra aflossing, met de aanname dat de termijn gelijk blijft en de looptijd korter wordt. Daaronder staat wat de aflossing doet met de kasruimte (laagste punt komende 8 weken, zoals in de Koersmeter): aflossen bekijk je nooit los van de kas. De rekening-courant is geen aflossende lening: daar zie je hoeveel je nu rood staat, de limiet en de kosten (uit je ING-afrekeningen), en wat terugboeken uit een potje of aanvullen per jaar aan rente scheelt. Terugboeken uit je eigen reserve laat de kasruimte gelijk zolang de Buffer daardoor onder het reserve-doel zakt (het geld was al van jou); staat er meer in dan het doel, dan stijgt de kasruimte eerst met dat deel. ' + ((root.MTSchulden && root.MTSchulden.INFO) || 'Algemene informatie, geen advies.');
  UITLEG.advies = 'Zakt het laagste punt onder de gele lijn (je fictieve buffer), dan zoekt de tool welke prognosetermijn je eerder kunt factureren om daarboven te blijven. Het is alleen een voorstel: je beslist zelf, en er gaat niets naar Moneybird.';

  function prognoseHtml() {
    const p = st.data.prognose || { posten: [] }, sc = st.scenario || {}, heeft = Object.keys(sc).length;
    const advies = st.prognose ? G.factuurAdvies(st.data, st.cfg, sc, dagPlus(st.data.vandaag, 180)) : null;   // alleen met prognose aan
    let h = `<div class="mtg-kaart"><div class="mtg-kop" style="margin:0"><b style="flex:1">Prognose</b>
      <button class="mtg-knop klein ${st.prognose ? 'aan' : ''}" data-prognose="1">${st.prognose ? 'meegenomen' : 'niet meegenomen'}</button><button class="mtg-vraag" data-uitleg="prognose">?</button></div>`;
    if (heeft) h += `<div class="mtg-uitleg">Scenario (nog niet opgeslagen): ${esc(Object.values(sc).reduce((a, x) => a + Object.keys(x).length, 0))} termijn(en) verschoven. ${st.mag ? '<button class="mtg-knop klein aan" data-sc="opslaan">Opslaan</button> ' : ''}<button class="mtg-knop klein" data-sc="terug">Terug</button></div>`;
    const soort = G.drempelSoort(st.data, st.cfg), grens = soort === 'fictief' ? 'de gele lijn' : 'de nullijn';   // G7: het bedrag van de fictieve buffer staat nergens in Geld
    if (advies && !advies.ok) h += `<div class="mtg-uitleg" style="background:#fbe3dd;border-color:#f0b8aa"><b>Krap:</b> laagste punt ${esc(eur(advies.low.saldo))} op ${esc(datumTekst(advies.low.datum))}, onder ${esc(grens)}${soort === 'ondergrens' ? ' (' + esc(eur(advies.drempel)) + ')' : ''}. <button class="mtg-vraag" data-uitleg="advies">?</button><br>`
      + (advies.voorstel ? `Factureer <b>${esc(advies.voorstel.event.tegenpartij)}</b> op ${esc(datumTekst(advies.voorstel.naar))} i.p.v. ${esc(datumTekst(advies.voorstel.van))} → laagste punt +${esc(eur(advies.voorstel.winst))}${advies.voorstel.low.saldo >= advies.drempel ? ' (weer boven ' + grens + ')' : `, maar nog steeds onder ${grens}`}${advies.voorstel.opTijd ? '' : ' — de betaling komt pas na het dieptepunt binnen, eerder factureren kan niet meer'}${advies.voorstel.doelpad ? ' → doelpad gehaald' : ''}. <button class="mtg-knop klein" data-advies="1">Probeer</button>`
        : 'Geen prognosetermijn die op tijd gefactureerd kan worden om dit op te lossen.') + '</div>';
    const posten = p.posten || [];
    if (!posten.length) h += `<div class="mtg-melding">Nog geen prognose. ${st.mag ? 'Vink in een project "gaat zeker door" aan, of voeg hier een project of post toe.' : ''}</div>`;
    for (const x of posten) {
      if (x.soort === 'post') { const e = (st.data.events || []).find(q => q.prognose === x.sleutel); h += `<div class="mtg-rij" ${st.mag ? `data-prog="${esc(x.sleutel)}"` : ''}><span class="p ${e && e.delta > 0 ? 'mtg-in' : 'mtg-uit'}">${e && e.delta > 0 ? '▲' : '▼'}</span><span class="n">${esc(x.omschrijving)} <span class="mtg-chip">handmatig</span>${x.aan ? '' : ' <span class="mtg-chip">uit</span>'}</span><span class="b">${e ? esc(datumTekst(e.datum)) + ' ' + eur(e.delta) : ''}</span></div>`; continue; }
      h += `<div class="mtg-pot" ${st.mag ? `data-prog="${esc(x.sleutel)}" style="cursor:pointer"` : ''}><div class="r1"><b>${esc(x.naam || x.code)}</b>${x.aan ? '' : '<span class="mtg-chip">uit</span>'}<span>${esc(eur(x.totaal))}</span><span class="mtg-chip">${esc(x.gefactureerd > 0 ? 'gefactureerd ' + kort(x.gefactureerd) : 'nog niets gefactureerd')}</span></div>
        <div class="r3">${(x.termijnen || []).map(t => {
          const nieuw = sc[x.sleutel] && sc[x.sleutel][t.id], ev = (st.data.events || []).find(q => q.prognose === x.sleutel && q.termijn_id === t.id);
          return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:3px 0">${esc(t.label)}: ${esc(eur(t.bedrag))}${t.gefactureerd > 0 ? ` (${t.open > 0 ? 'deels ' : ''}gefactureerd ${kort(t.gefactureerd)})` : ''}${t.open > 0 && t.aan && x.aan ? ` · factuur <input type="date" class="mtg-fd" data-sl="${esc(x.sleutel)}" data-tm="${esc(t.id)}" value="${esc(nieuw || t.factuurdatum)}" style="font-size:12px;padding:2px 4px;border:1px solid var(--border,#ccc);border-radius:4px">${ev ? ` → binnen rond ${esc(datumTekst(ev.datum))}` : ''}${nieuw ? ' <span class="mtg-chip prog">scenario</span>' : ''}` : t.aan ? '' : ' · uit'}</div>`;
        }).join('')}</div>
        ${(x.vragen || []).slice(0, 3).map(f => `<div class="mtg-uitleg">Hoort factuur ${esc(f.nummer || f.id)} (${esc(eur(f.bedrag))}, ${esc(datumTekst(f.datum))}${f.ref ? ', "' + esc(f.ref) + '"' : ''}) bij dit project?${f.meerdere ? ' <b>Hij past bij meer dan één project.</b>' : ''} ${st.mag ? `<button class="mtg-knop klein aan" data-vraag="ja" data-sl="${esc(x.sleutel)}" data-f="${esc(f.id)}">Ja</button> <button class="mtg-knop klein" data-vraag="nee" data-sl="${esc(x.sleutel)}" data-f="${esc(f.id)}">Nee</button>` : ''}</div>`).join('')}</div>`;
    }
    if (st.mag) h += `<div class="mtg-knoppen" style="margin-top:8px"><button class="mtg-knop" data-prog="nieuw-project">+ project</button><button class="mtg-knop" data-prog="nieuw-post">+ handmatige post</button></div>`;
    return h + '</div>';
  }
  G._prognoseHtml = prognoseHtml;
  async function prognoseItems() { const r = await st.bron.haal('/geld/prognose'); return (r && r.items) || {}; }
  async function prognoseBewaar(sleutel, item, ok) {
    return opslaan(async () => { const huidig = (await prognoseItems())[sleutel]; return stuur('/geld/prognose', { sleutel, item, vorige_ts: huidig ? huidig.ts : null }); }, ok || 'Prognose opgeslagen');
  }
  async function scenarioOpslaan() {
    const sc = st.scenario || {}; const items = await prognoseItems();
    try {
      for (const [sl, tm] of Object.entries(sc)) {
        const it = items[sl]; if (!it) continue;
        const n = Object.assign({}, it, { termijnen: it.termijnen.map(t => tm[t.id] ? Object.assign({}, t, { factuurdatum: tm[t.id] }) : t) });
        delete n.ts; delete n.door;
        await stuur('/geld/prognose', { sleutel: sl, item: n, vorige_ts: it.ts });
      }
      st.scenario = {}; toast('Factuurdatums opgeslagen'); await G.laad(true);
    } catch (e) { toast('Niet opgeslagen: ' + e.message); await G.laad(true); }
  }
  async function vraagAntwoord(sl, fid, ja) {
    const items = await prognoseItems(), it = items[sl]; if (!it) return;
    const n = Object.assign({}, it, ja ? { k: [...new Set((it.k || []).concat(fid))] } : { x: [...new Set((it.x || []).concat(fid))] });
    delete n.ts; delete n.door;
    return opslaan(() => stuur('/geld/prognose', { sleutel: sl, item: n, vorige_ts: it.ts }), ja ? 'Factuur gekoppeld — de termijn is vervangen' : 'Genoteerd: hoort er niet bij');
  }
  // ── Factuurplanning (verzoek Mathijs 22-10): wat er naar verwachting per maand gefactureerd wordt ─────────────────────────
  // Geen eigen opslag: de verwachte factuurmaand is de maand van de factuurdatum van de prognosetermijn (hetzelfde veld als
  // de factuurmoment-hulp en de lijn). Een maand kiezen zet die datum in de gekozen maand: dezelfde dag (hooguit de laatste
  // dag van de maand), en in de lopende maand nooit vóór vandaag. Bedragen zijn incl. btw, zoals de prognose zelf.
  const MND = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const MND_K = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const maandPlus = (ym, n) => { const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };
  const maandTekst = (ym, k) => (k ? MND_K : MND)[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4);
  const centen = n => Math.round((Number(n) || 0) * 100);
  const lokaalVandaag = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  G.maandPlus = maandPlus; G.maandTekst = maandTekst;
  G.zetMaand = function (datum, ym, vandaag) {
    const dim = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
    const d = `${ym}-${String(Math.min(Number(String(datum || '').slice(8, 10)) || 1, dim)).padStart(2, '0')}`;
    return vandaag && ym === vandaag.slice(0, 7) && d < vandaag ? vandaag : d;
  };
  // Eén termijn als regel: bedrag en open deel in hele centen (geen optelfouten), status uit wat in Moneybird al gefactureerd is.
  function termijnRegel(x, t) {
    const b = centen(t.bedrag), g = Math.min(b, Math.max(0, centen(t.gefactureerd))), o = t.open != null ? Math.max(0, Math.min(b, centen(t.open))) : b - g;
    return { sleutel: x.sleutel, naam: x.naam || x.code || '', code: x.code || '', id: t.id, label: t.label || '', factuurdatum: t.factuurdatum, maand: String(t.factuurdatum || '').slice(0, 7),
      bedrag: b / 100, gefactureerd: g / 100, open: o / 100, status: o <= 0 ? 'gefactureerd' : g > 0 ? 'deels' : 'open' };
  }
  const regelVolgorde = (a, b) => String(a.factuurdatum).localeCompare(String(b.factuurdatum)) || a.naam.localeCompare(b.naam) || String(a.id).localeCompare(String(b.id));
  // Termijnen van één project (ruw item uit /geld/prognose, optioneel met het berekende overzicht voor wat al gefactureerd is).
  G.blokRegels = function (item, post) {
    const x = { sleutel: item.sleutel, naam: item.naam, code: item.code };
    return (item.termijnen || []).filter(t => t && t.aan !== false && t.factuurdatum).map(t => {
      const c = post && (post.termijnen || []).find(q => q.id === t.id);
      return termijnRegel(x, c ? Object.assign({}, t, { gefactureerd: c.gefactureerd, open: c.open }) : t);
    }).sort(regelVolgorde);
  };
  // Maandtotalen uit prognose.posten van de tijdlijn: alleen projecten die doorgaan en termijnen die aan staan. Wat al gefactureerd
  // is telt niet mee in het totaal (het staat wel bij zijn maand, als gefactureerd). Open termijnen van vóór deze maand staan
  // apart (eerder), wat voorbij het venster ligt onder later.
  G.factuurPlanning = function (posten, vandaag, opt) {
    opt = opt || {};
    const n = opt.maanden || 6, nu = vandaag.slice(0, 7), einde = maandPlus(nu, n - 1), maanden = [];
    for (let i = 0; i < n; i++) maanden.push({ ym: maandPlus(nu, i), totaalC: 0, regels: [] });
    const eerder = { totaalC: 0, regels: [] }, later = { totaalC: 0, regels: [] };
    let gefC = 0;
    for (const x of posten || []) {
      if (!x || x.soort !== 'project' || !x.aan || (opt.sleutel && x.sleutel !== opt.sleutel)) continue;
      for (const t of x.termijnen || []) {
        if (!t || t.aan === false || !t.factuurdatum) continue;
        const r = termijnRegel(x, t), vak = r.maand < nu ? eerder : r.maand > einde ? later : maanden[maanden.findIndex(m => m.ym === r.maand)];
        if (r.status === 'gefactureerd') { if (vak !== eerder && vak !== later) { vak.regels.push(r); gefC += centen(r.bedrag); } continue; }
        vak.regels.push(r); vak.totaalC += centen(r.open);
      }
    }
    const fin = v => { v.regels.sort(regelVolgorde); v.totaal = v.totaalC / 100; return v; };
    maanden.forEach(fin); fin(eerder); fin(later);
    const totC = maanden.reduce((a, m) => a + m.totaalC, 0) + eerder.totaalC + later.totaalC;
    return { maanden, eerder, later, totaal: totC / 100, gefactureerd: gefC / 100 };
  };
  // Verwachte factuurmaand van één termijn wijzigen: de bestaande prognose met de nieuwe termijndatum opslaan (zelfde route, dezelfde
  // controle op tussentijdse wijzigingen en dezelfde gestempelde opslag als de editor). Niets gaat naar Moneybird.
  G.factuurMaandZet = async function (bron, sleutel, termijnId, ym, vandaag) {
    const r = await bron.haal('/geld/prognose'); if (!r || r.error) throw new Error(r && r.error || 'geen antwoord');
    const it = (r.items || {})[sleutel]; if (!it || it.soort === 'post') throw new Error('deze prognose bestaat niet meer — herlaad');
    const t = (it.termijnen || []).find(q => q.id === termijnId); if (!t) throw new Error('deze termijn bestaat niet meer — herlaad');
    const nieuw = G.zetMaand(t.factuurdatum, ym, vandaag); if (nieuw === t.factuurdatum) return null;
    const n = Object.assign({}, it, { termijnen: it.termijnen.map(q => q.id === termijnId ? Object.assign({}, q, { factuurdatum: nieuw }) : q) });
    delete n.ts; delete n.door;
    const res = await bron.haal('/geld/prognose', { method: 'POST', body: { sleutel, item: n, vorige_ts: it.ts } });
    if (!res || res.error) throw new Error(res && res.error || 'opslaan mislukt');
    return res;
  };
  // Maandkiezer: vanaf deze maand 18 maanden vooruit; staat de termijn daarbuiten, dan blijft die maand zichtbaar gekozen.
  function maandSelect(r, vandaag) {
    const nu = vandaag.slice(0, 7), lijst = [];
    for (let i = 0; i < 18; i++) lijst.push(maandPlus(nu, i));
    if (!lijst.includes(r.maand)) { lijst.push(r.maand); lijst.sort(); }
    return `<select class="mtg-fm" data-sl="${esc(r.sleutel)}" data-tm="${esc(r.id)}" aria-label="Verwachte factuurmaand van ${esc(r.naam)}, ${esc(r.label)}">${lijst.map(m => `<option value="${esc(m)}"${m === r.maand ? ' selected' : ''}>${esc(maandTekst(m, true))}${m < nu ? ' (voorbij)' : ''}</option>`).join('')}</select>`;
  }
  function planningHtml() {
    const p = st.data.prognose || { posten: [] }, vandaag = st.data.vandaag, n = st.planMnd === 12 ? 12 : 6, filter = st.planSl || null;
    const fp = filter && (p.posten || []).find(x => x.sleutel === filter), pl = G.factuurPlanning(p.posten, vandaag, { maanden: n, sleutel: filter });
    const aantal = v => v.regels.filter(r => r.status !== 'gefactureerd').length;
    const regel = (r, toonMaand) => `<div class="mtg-fp-r${r.status === 'gefactureerd' ? ' klaar' : ''}">
        <span class="n"${st.mag ? ` data-prog="${esc(r.sleutel)}" title="De prognose van dit project openen" style="cursor:pointer"` : ''}><b>${esc(r.naam || r.code)}</b> · ${esc(r.label)}</span>
        <span class="b">${esc(eur(r.status === 'gefactureerd' ? r.bedrag : r.open, true))}</span>
        ${r.status === 'gefactureerd' ? '<span class="mtg-chip">gefactureerd</span>' : `${r.status === 'deels' ? `<span class="mtg-chip">deels gefactureerd (${esc(kort(r.gefactureerd))})</span>` : ''}${st.mag ? maandSelect(r, vandaag) : toonMaand ? `<span class="m">${esc(maandTekst(r.maand, true))}</span>` : ''}`}</div>`;
    const telTekst = v => aantal(v) ? aantal(v) + (aantal(v) === 1 ? ' termijn' : ' termijnen') : v.regels.length ? 'alles gefactureerd' : '';
    const blok = (kop, v, klasse) => `<div class="mtg-fp-m ${esc(klasse)}"><div class="mtg-fp-mk"><b>${esc(kop)}</b><span class="n">${esc(telTekst(v))}</span><b class="t">${v.regels.length ? esc(eur(v.totaal, true)) : '—'}</b></div>${klasse === 'eerder' ? '<div class="mtg-melding" style="padding:2px 0">Deze factuurdatum is voorbij. Kies een nieuwe maand of factureer.</div>' : ''}${v.regels.map(r => regel(r, klasse === 'eerder' || klasse === 'later')).join('')}</div>`;
    let h = `<div class="mtg-kaart" id="mtg-plan"><div class="mtg-kop" style="margin:0 0 6px"><b style="flex:1">Factuurplanning</b>
      <div class="mtg-knoppen"><button class="mtg-knop klein ${n === 6 ? 'aan' : ''}" data-planmnd="6">6 maanden</button><button class="mtg-knop klein ${n === 12 ? 'aan' : ''}" data-planmnd="12">12 maanden</button></div><button class="mtg-vraag" data-uitleg="planning">?</button></div>`;
    if (filter) h += `<div class="mtg-uitleg">Alleen ${esc(fp ? fp.naam || fp.code : 'dit project')} <button class="mtg-knop klein" data-planwis="1">Toon alle projecten</button>${fp ? '' : '<br>Dit project heeft (nog) geen prognose die doorgaat: vink hieronder bij Prognose aan dat het zeker doorgaat.'}</div>`;
    if (!(p.posten || []).some(x => x.soort === 'project' && x.aan && (x.termijnen || []).length)) return h + `<div class="mtg-melding">Nog geen termijnen om te plannen. Vink bij Prognose in een project "gaat zeker door" aan.</div></div>`;
    if (pl.eerder.regels.length) h += blok('Eerder gepland, nog niet gefactureerd', pl.eerder, 'eerder');
    h += pl.maanden.map(m => m.regels.length ? blok(maandTekst(m.ym), m, 'maand') : `<div class="mtg-fp-m leeg"><div class="mtg-fp-mk"><span>${esc(maandTekst(m.ym))}</span><span class="t">—</span></div></div>`).join('');
    if (pl.later.regels.length) h += blok('Later', pl.later, 'later');
    return h + `<div class="mtg-fp-tot"><span>Nog te factureren${filter ? '' : ' (incl. btw)'}</span><b>${esc(eur(pl.totaal, true))}</b></div>${pl.gefactureerd > 0 ? `<div class="mtg-melding" style="padding:2px 0">Al gefactureerd in deze periode: ${esc(eur(pl.gefactureerd, true))}</div>` : ''}</div>`;
  }
  // Vanuit een ander scherm (bv. het blokje in de offerte): de planning op één project filteren en in beeld scrollen.
  G.planFocus = function (sleutel) { st.planSl = sleutel || null; st.planScroll = !!sleutel; if (st.data) teken(); };

  // Compact blokje "Facturatie verwacht" voor in de offerte-weergave van een project. Hetzelfde veld en dezelfde opslag als de
  // Factuurplanning; een klik op het blokje (buiten de maandkiezer) brengt je naar Financiën, gefilterd op dit project.
  // o = { bron, sleutel: 'p:<project_id>', mag, naar(), instellen() }
  const blokCache = { items: null, t: 0, posten: null, vandaag: null, tp: 0 };
  G.projectBlok = async function (host, o) {
    css();
    const tok = host._fbTok = (host._fbTok || 0) + 1, sl = o.sleutel;
    host._fbO = o;
    if (!host._fbKoppel) {
      host._fbKoppel = true;
      host.addEventListener('change', e => {
        const s = e.target.closest('.mtg-fm'); if (!s) return;
        s.disabled = true;
        const opnieuw = () => { blokCache.items = null; return G.projectBlok(host, host._fbO); };
        G.factuurMaandZet(host._fbO.bron, s.dataset.sl, s.dataset.tm, s.value, host._fbVandaag || lokaalVandaag())
          .then(r => { if (r) toast('Verwachte factuurmaand opgeslagen'); return opnieuw(); })
          .catch(err => { toast('Niet opgeslagen: ' + (err.message || err)); return opnieuw(); });
      });
      host.addEventListener('click', e => {
        if (e.target.closest('[data-fb-instel]')) { e.preventDefault(); if (host._fbO.instellen) host._fbO.instellen(); return; }
        if (e.target.closest('select')) return;
        if (e.target.closest('[data-fb-naar]') && host._fbO.naar) host._fbO.naar();
      });
    }
    let items = null, fout = null;
    try {
      if (blokCache.items && Date.now() - blokCache.t < 20000) items = blokCache.items;
      else { const r = await o.bron.haal('/geld/prognose'); if (!r || r.error) throw new Error(r && r.error || 'geen antwoord'); items = r.items || {}; blokCache.items = items; blokCache.t = Date.now(); }
    } catch (e) { fout = e.message || String(e); }
    if (host._fbTok !== tok) return;
    const it = items && items[sl];
    if (fout) { host.innerHTML = `<div class="mtg"><div class="mtg-melding">Facturatie verwacht: kon niet laden (${esc(fout)}).</div></div>`; return; }
    if (!it || it.soort === 'post' || !it.aan || !(it.termijnen || []).length) {
      const leeg = !it || it.soort === 'post' ? 'Nog niet ingesteld.' : it.aan ? 'Nog geen termijnen.' : 'De prognose van dit project staat uit.';
      host.innerHTML = `<div class="mtg"><div class="mtg-fb"><div class="mtg-fb-kop"><b>Facturatie verwacht</b></div><div class="mtg-melding" style="padding:2px 0">${esc(leeg)}${o.mag && o.instellen ? ' <button type="button" class="mtg-knop klein" data-fb-instel="1">Termijnen instellen…</button>' : ''}</div></div></div>`;
      return;
    }
    const item = Object.assign({}, it, { sleutel: sl });
    const toon = (post, vandaag, zonderStatus) => {
      if (host._fbTok !== tok) return;
      host._fbVandaag = vandaag;
      const regels = G.blokRegels(item, post), open = regels.filter(r => r.status !== 'gefactureerd'), totC = open.reduce((a, r) => a + centen(r.open), 0), mag = !!o.mag;
      host.innerHTML = `<div class="mtg"><div class="mtg-fb" data-fb-naar="1" role="link" tabindex="0" title="Naar Financiën, gefilterd op dit project"><div class="mtg-fb-kop"><b>Facturatie verwacht</b><span class="mtg-chip">incl. btw</span><span class="mtg-fb-naar">Financiën ›</span></div>
        ${regels.map(r => `<div class="mtg-fb-r${r.status === 'gefactureerd' ? ' klaar' : ''}"><span class="n">${esc(r.label || 'termijn')}</span><span class="b">${esc(eur(r.status === 'gefactureerd' ? r.bedrag : r.open, true))}</span>${r.status === 'gefactureerd' ? `<span class="m">${esc(maandTekst(r.maand, true))}</span><span class="mtg-chip">gefactureerd</span>` : `${mag ? maandSelect(r, vandaag) : `<span class="m">${esc(maandTekst(r.maand, true))}</span>`}${r.status === 'deels' ? '<span class="mtg-chip">deels gefactureerd</span>' : ''}`}</div>`).join('')}
        <div class="mtg-fb-tot"><span>${open.length ? 'Nog te factureren' : 'Alles gefactureerd'}</span><b>${esc(eur(totC / 100, true))}</b></div>${zonderStatus ? '<div class="mtg-melding" style="padding:2px 0">Wat al gefactureerd is, wordt nog opgehaald.</div>' : ''}</div></div>`;
      const b = host.querySelector('.mtg-fb'); if (b) b.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === b && host._fbO.naar) { e.preventDefault(); host._fbO.naar(); } });
    };
    // Wat al gefactureerd is, staat in de tijdlijn (prognose.posten): uit het geopende Financiën-scherm, anders (kort onthouden) opgehaald.
    const vind = posten => (posten || []).find(x => x.sleutel === sl) || null;
    if (st.data && st.data.prognose && st.data.prognose.posten) return toon(vind(st.data.prognose.posten), st.data.vandaag, false);
    if (blokCache.posten && Date.now() - blokCache.tp < 60000) return toon(vind(blokCache.posten), blokCache.vandaag, false);
    toon(null, lokaalVandaag(), true);
    try {
      const v = lokaalVandaag(), d = await o.bron.haal(`/geld/tijdlijn?van=${dagPlus(v, -35)}&tot=${dagPlus(v, 364)}`);
      if (d && !d.error && d.prognose) { blokCache.posten = d.prognose.posten || []; blokCache.vandaag = d.vandaag || v; blokCache.tp = Date.now(); toon(vind(blokCache.posten), blokCache.vandaag, false); }
    } catch (e) { }
  };

  // Editor: project (vinkje "gaat zeker door", totaal, termijnen) of handmatige post.
  G.prognoseBewerk = async function (sleutel, project) {
    if (!st.data) return;
    const items = await prognoseItems(), oud = items[sleutel] || null;
    if (sleutel && sleutel.startsWith('h:') || sleutel === 'nieuw-post') return postBlad(sleutel === 'nieuw-post' ? null : sleutel, oud);
    let pr = project || null;
    if (!pr && sleutel === 'nieuw-project') {
      const lijst = st.projecten ? st.projecten() : [];
      const o = blad(`<h3>Project als prognose</h3><label class="mtg-veld"><span>Project</span><select name="pr"><option value="">— kies —</option>${lijst.map((x, i) => `<option value="${i}">${esc(x.label)}</option>`).join('')}</select></label><button class="mtg-knop aan" data-ok="1">Verder</button>`);
      o.querySelector('[data-ok]').addEventListener('click', () => { const i = o.querySelector('[name="pr"]').value; if (i === '') return; o.remove(); const x = lijst[Number(i)]; G.prognoseBewerk('p:' + x.project_id, x); });
      return;
    }
    if (!pr && st.projecten) pr = st.projecten().find(x => 'p:' + x.project_id === sleutel) || null;
    projectBlad(sleutel, oud, pr);
  };
  async function projectBlad(sleutel, oud, pr) {
    const schema = (st.cfg || {}).prognose_schema;
    const akkoord = st.data.vandaag, datums = { akkoord, start: pr && pr.start || null, oplevering: pr && pr.oplevering || null };
    let totaal = oud ? oud.totaal : null, voorstel = null;
    if (!oud && pr && st.offerteBedrag) { try { voorstel = await st.offerteBedrag(pr); } catch (e) { } }
    let termijnen = oud ? oud.termijnen.map(t => Object.assign({}, t)) : [];
    const o = blad(`<h3>Prognose: ${esc(pr ? pr.label : (oud && oud.naam) || '')}</h3>
      <label class="mtg-veld" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="aan" style="width:auto" ${!oud || oud.aan ? 'checked' : ''}> <span style="margin:0"><b>Gaat zeker door</b> — meenemen in de prognose</span></label>
      <label class="mtg-veld"><span>Totaal incl. btw (€)${voorstel ? ` — offerte: <a href="#" data-voorstel="1">${esc(eur(voorstel, true))} overnemen</a>` : ''}</span><input type="number" step="0.01" name="totaal" value="${esc(totaal != null ? totaal : '')}"></label>
      <div style="display:flex;gap:8px"><label class="mtg-veld" style="flex:1"><span>Akkoord</span><input type="date" name="akkoord" value="${esc(akkoord)}"></label><label class="mtg-veld" style="flex:1"><span>Betaaltermijn (dagen)</span><input type="number" name="bt" value="${esc(oud ? oud.betaaltermijn : (schema && schema.betaaltermijn != null ? schema.betaaltermijn : 14))}"></label></div>
      <div class="mtg-melding">${datums.start || datums.oplevering ? `Planning: start ${esc(datumTekst(datums.start))}, oplevering ${esc(datumTekst(datums.oplevering))}.` : 'Geen planning bekend: datums volgens het schema vanaf akkoord.'}${schema ? '' : ' <b>Standaardschema nog niet ingesteld</b> (Instellingen) — vul de termijnen zelf in.'}</div>
      <button class="mtg-knop klein" data-schema="1">Termijnen volgens het standaardschema</button>
      <div class="tms" style="margin-top:8px"></div><button class="mtg-knop klein" data-tm-bij="1">+ termijn</button>
      <div class="mtg-melding som"></div>
      <div style="margin-top:10px"><button class="mtg-knop aan" data-ok="1">Opslaan</button>${oud ? ' <button class="mtg-knop" data-wis="1">Prognose verwijderen</button>' : ''}</div>`);
    const tms = o.querySelector('.tms'), somEl = o.querySelector('.som');
    const tekenTm = () => {
      tms.innerHTML = termijnen.map((t, i) => `<div style="display:flex;gap:4px;align-items:center;margin:4px 0;flex-wrap:wrap" data-i="${i}">
        <input name="l" value="${esc(t.label)}" maxlength="24" style="flex:2;min-width:90px;padding:6px;border:1px solid #ccc;border-radius:5px">
        <input name="b" type="number" step="0.01" value="${esc(t.bedrag)}" style="flex:1;min-width:80px;padding:6px;border:1px solid #ccc;border-radius:5px">
        <input name="d" type="date" value="${esc(t.factuurdatum)}" style="flex:1;min-width:120px;padding:6px;border:1px solid #ccc;border-radius:5px">
        <label style="font-size:12px"><input name="a" type="checkbox" ${t.aan !== false ? 'checked' : ''}> aan</label><button class="mtg-knop klein" data-tm-weg="${i}">×</button></div>`).join('');
      const som = rond(termijnen.reduce((a, t) => a + (Number(t.bedrag) || 0), 0)), tt = Number(o.querySelector('[name="totaal"]').value) || 0;
      somEl.textContent = termijnen.length ? `Termijnen samen ${eur(som, true)}${Math.abs(som - tt) > 0.01 ? ` — moet ${eur(tt, true)} zijn` : ' ✓'}` : '';
    };
    const lees = () => { tms.querySelectorAll('[data-i]').forEach(r => { const t = termijnen[Number(r.dataset.i)]; t.label = r.querySelector('[name="l"]').value; t.bedrag = Number(r.querySelector('[name="b"]').value); t.factuurdatum = r.querySelector('[name="d"]').value; t.aan = r.querySelector('[name="a"]').checked; }); };
    tekenTm();
    o.addEventListener('input', () => { lees(); const som = rond(termijnen.reduce((a, t) => a + (Number(t.bedrag) || 0), 0)), tt = Number(o.querySelector('[name="totaal"]').value) || 0; somEl.textContent = termijnen.length ? `Termijnen samen ${eur(som, true)}${Math.abs(som - tt) > 0.01 ? ` — moet ${eur(tt, true)} zijn` : ' ✓'}` : ''; });
    o.addEventListener('click', ev => {
      const k = ev.target.closest('[data-voorstel],[data-schema],[data-tm-bij],[data-tm-weg],[data-ok],[data-wis]'); if (!k) return;
      ev.preventDefault();
      if (k.dataset.voorstel) { o.querySelector('[name="totaal"]').value = voorstel; lees(); tekenTm(); }
      else if (k.dataset.schema) { if (!schema || schema.grens_klein == null || schema.grens_groot == null) return toast('Stel eerst het standaardschema in (Instellingen → Prognose-schema) of vul de termijnen zelf in');
        const tt = Number(o.querySelector('[name="totaal"]').value); termijnen = G.schemaTermijnen(schema, tt, Object.assign({}, datums, { akkoord: o.querySelector('[name="akkoord"]').value || akkoord })); tekenTm(); }
      else if (k.dataset.tmBij !== undefined && k.dataset.tmBij) { lees(); termijnen.push({ id: 't' + (Math.max(0, ...termijnen.map(t => Number(String(t.id).slice(1)) || 0)) + 1), label: 'termijn', bedrag: 0, factuurdatum: st.data.vandaag, aan: true }); tekenTm(); }
      else if (k.dataset.tmWeg !== undefined && k.dataset.tmWeg !== '') { lees(); termijnen.splice(Number(k.dataset.tmWeg), 1); tekenTm(); }
      else if (k.dataset.wis) { if (!confirm('Prognose voor dit project verwijderen? (de historie blijft bewaard)')) return; o.remove(); prognoseBewaar(sleutel, null, 'Prognose verwijderd'); }
      else if (k.dataset.ok) {
        lees();
        const item = { naam: pr ? pr.label : oud && oud.naam, code: pr ? pr.code : oud && oud.code, contact_id: pr ? pr.mb_contact_id : oud && oud.contact_id, estimate_id: pr ? pr.offerte_mb_id : oud && oud.estimate_id,
          offertenr: pr ? pr.offertenr : oud && oud.offertenr, totaal: Number(o.querySelector('[name="totaal"]').value), betaaltermijn: Number(o.querySelector('[name="bt"]').value) || 0,
          aan: o.querySelector('[name="aan"]').checked, termijnen: termijnen.map(t => ({ id: t.id, label: t.label, bedrag: Number(t.bedrag), factuurdatum: t.factuurdatum, aan: t.aan !== false })), k: oud ? oud.k : [], x: oud ? oud.x : [] };
        if (!(item.totaal > 0)) return toast('Vul het totaal in');
        if (!item.termijnen.length) return toast('Voeg termijnen toe (of gebruik het schema)');
        if (Math.abs(item.termijnen.reduce((a, t) => a + t.bedrag, 0) - item.totaal) > 0.01) return toast('De termijnen tellen niet op tot het totaal');
        o.remove(); prognoseBewaar(sleutel, item);
      }
    });
  }
  function postBlad(sleutel, oud) {
    const o = blad(`<h3>${oud ? 'Handmatige post' : 'Nieuwe handmatige post'}</h3><div class="mtg-melding">Bijvoorbeeld een machine, subsidie of andere verwachte post zonder factuur. Telt mee als prognose.</div>
      <label class="mtg-veld"><span>Omschrijving</span><input name="om" maxlength="60" value="${esc(oud ? oud.omschrijving : '')}"></label>
      <label class="mtg-veld"><span>Richting</span><select name="ri"><option value="uit" ${oud && oud.richting === 'in' ? '' : 'selected'}>uitgave</option><option value="in" ${oud && oud.richting === 'in' ? 'selected' : ''}>inkomst</option></select></label>
      <div style="display:flex;gap:8px"><label class="mtg-veld" style="flex:1"><span>Bedrag (€)</span><input type="number" step="0.01" name="b" value="${esc(oud ? oud.bedrag : '')}"></label><label class="mtg-veld" style="flex:1"><span>Datum</span><input type="date" name="d" value="${esc(oud ? oud.datum : st.data.vandaag)}"></label></div>
      <label class="mtg-veld" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="aan" style="width:auto" ${!oud || oud.aan ? 'checked' : ''}> <span style="margin:0">Meenemen</span></label>
      <button class="mtg-knop aan" data-ok="1">Opslaan</button>${oud ? ' <button class="mtg-knop" data-wis="1">Verwijderen</button>' : ''}`);
    o.addEventListener('click', ev => {
      const k = ev.target.closest('[data-ok],[data-wis]'); if (!k) return;
      const sl = sleutel || 'h:' + Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, 'x').padEnd(8, 'x');
      if (k.dataset.wis) { o.remove(); return prognoseBewaar(sl, null, 'Post verwijderd'); }
      const f = n => o.querySelector(`[name="${n}"]`);
      const item = { omschrijving: f('om').value, richting: f('ri').value, bedrag: Number(f('b').value), datum: f('d').value, aan: f('aan').checked };
      if (!(item.bedrag > 0)) return toast('Vul een bedrag in');
      o.remove(); prognoseBewaar(sl, item);
    });
  }
  function schemaBlad() {
    const c = st.cfg || {}, s = c.prognose_schema || null, v = s || G.SCHEMA_VOORSTEL;
    const rijen = k => (v[k] || []).map(r => `${r.pct}% ${r.label} (${r.anker === 'akkoord' ? 'akkoord + ' + r.dagen + ' d' : r.anker + ', anders akkoord + ' + r.dagen + ' d'})`).join(' · ');
    const o = blad(`<h3>Standaardschema prognose</h3>${s ? '' : '<div class="mtg-uitleg">Nog niet ingesteld. De verdeling hieronder is een voorstel (uit de analyse van eerdere facturen); vul zelf de grensbedragen in en sla op.</div>'}
      <div style="display:flex;gap:8px"><label class="mtg-veld" style="flex:1"><span>Klein onder (€)</span><input type="number" name="gk" value="${esc(v.grens_klein != null ? v.grens_klein : '')}"></label><label class="mtg-veld" style="flex:1"><span>Groot vanaf (€)</span><input type="number" name="gg" value="${esc(v.grens_groot != null ? v.grens_groot : '')}"></label><label class="mtg-veld" style="flex:1"><span>Betaaltermijn</span><input type="number" name="bt" value="${esc(v.betaaltermijn != null ? v.betaaltermijn : 14)}"></label></div>
      ${['klein', 'middel', 'groot'].map(k => `<label class="mtg-veld"><span>${k} — per regel: % ; omschrijving ; anker (akkoord/start/oplevering) ; dagen na akkoord</span><textarea name="${k}" rows="3" style="width:100%;font-size:13px;padding:6px;border:1px solid #ccc;border-radius:6px">${esc((v[k] || []).map(r => `${r.pct};${r.label};${r.anker};${r.dagen}`).join('\n'))}</textarea><span>${esc(rijen(k))}</span></label>`).join('')}
      <button class="mtg-knop aan" data-ok="1">Opslaan</button>`);
    o.querySelector('[data-ok]').addEventListener('click', () => {
      const f = n => o.querySelector(`[name="${n}"]`).value;
      const lijst = k => f(k).split('\n').map(l => l.split(';').map(x => x.trim())).filter(x => x[0]).map(x => ({ pct: Number(x[0].replace(',', '.')), label: x[1] || '', anker: x[2] || 'akkoord', dagen: Number(x[3] || 0) }));
      const schema = { grens_klein: f('gk') === '' ? null : Number(f('gk')), grens_groot: f('gg') === '' ? null : Number(f('gg')), betaaltermijn: Number(f('bt')) || 14, klein: lijst('klein'), middel: lijst('middel'), groot: lijst('groot') };
      if (schema.grens_klein == null || schema.grens_groot == null || schema.grens_klein > schema.grens_groot) return toast('Vul beide grensbedragen in (klein ≤ groot)');
      for (const k of ['klein', 'middel', 'groot']) if (schema[k].length && Math.abs(schema[k].reduce((a, r) => a + r.pct, 0) - 100) > 0.01) return toast(`${k}: de percentages moeten samen 100 zijn`);
      o.remove(); opslaan(() => stuur('/geld/config', { revisie: c.revisie, prognose_schema: schema }), 'Standaardschema opgeslagen');
    });
  }

  // ── Interactie ───────────────────────────────────────────────────────────────
  function klik(e) {
    if (e.target.closest('.mtg-fd,.mtg-fm')) return;
    if (e.target.closest('[data-laag]')) { e.preventDefault(); return laagsteUitleg(); }
    const pm = e.target.closest('[data-potmuts]'); if (pm) { e.preventDefault(); return potMutaties(pm.dataset.potmuts); }
    const kg = e.target.closest('[data-koers-gelezen]');
    if (kg) { e.stopPropagation(); return koersGelezen(kg.dataset.koersGelezen); }
    const kz = e.target.closest('[data-koers]');
    if (kz) { e.stopPropagation(); return blad(root.MTKoers.uitlegHtml(st.koersOordeel, kz.dataset.koers)); }
    const vl = e.target.closest('[data-doeladvies]');
    if (vl) { e.stopPropagation(); return doelAdvies(vl.dataset.doeladvies); }
    if (e.target.closest('[data-rc]')) { e.preventDefault(); e.stopPropagation(); return rcUitleg(); }
    const au = e.target.closest('[data-adviesuitleg]');
    if (au) { e.stopPropagation(); return adviesUitleg(au.dataset.adviesuitleg); }
    if (e.target.closest('[data-nood]')) { st.noodMee = !!e.target.closest('[data-nood]').checked; ls.set('mtg:nood:' + st.wie, st.noodMee ? '1' : '0'); return teken(); }
    const t = e.target.closest('[data-modus],[data-zoom],[data-terug],[data-prognose],[data-uitleg],[data-intro],[data-ev],[data-dag],[data-pot],[data-patroon],[data-inst],[data-prog],[data-sc],[data-advies],[data-vraag],[data-herlaad],[data-planmnd],[data-planwis]');
    if (!t) return;
    if (t.dataset.modus) { st.modus = t.dataset.modus; st.offset = 0; teken(); }
    else if (t.dataset.zoom) { st.zoom = t.dataset.zoom; ls.set('mtg:zoom:' + st.wie, st.zoom); begrens(); teken(); }
    else if (t.dataset.terug) { st.offset = 0; teken(); }
    else if (t.dataset.prognose) { st.prognose = !st.prognose; ls.set('mtg:prognose:' + st.wie, st.prognose ? '1' : '0'); teken(); }
    else if (t.dataset.uitleg === 'nu') besteedUitleg();
    else if (t.dataset.uitleg) blad(`<h3>Uitleg</h3><div class="mtg-uitleg">${esc(UITLEG[t.dataset.uitleg] || '')}</div>`);
    else if (t.dataset.intro) { ls.set('mtg:intro:' + st.wie, t.dataset.intro === 'weg' ? 'weg' : ''); teken(); }
    else if (t.dataset.ev) eventDetail(t.dataset.ev);
    else if (t.dataset.dag) dagInfo(t.dataset.dag);
    else if (t.dataset.herlaad) { st.ververst = false; G.laad(st.mag); }
    else if (t.dataset.pot) potBlad(t.dataset.pot);
    else if (t.dataset.patroon) patroonZet(t.dataset.patroon, t.dataset.aan === '1');
    else if (t.dataset.inst === 'algemeen') instBlad();
    else if (t.dataset.inst === 'groepen') groepenBlad();
    else if (t.dataset.inst === 'schema') schemaBlad();
    else if (t.dataset.inst === 'schulden') schuldenBlad();
    else if (t.dataset.planmnd) { st.planMnd = Number(t.dataset.planmnd) === 12 ? 12 : 6; ls.set('mtg:planmnd:' + st.wie, String(st.planMnd)); teken(); }
    else if (t.dataset.planwis) { st.planSl = null; teken(); }
    else if (t.dataset.prog) G.prognoseBewerk(t.dataset.prog);
    else if (t.dataset.sc === 'opslaan') scenarioOpslaan();
    else if (t.dataset.sc === 'terug') { st.scenario = {}; teken(); }
    else if (t.dataset.advies) { const a = G.factuurAdvies(st.data, st.cfg, st.scenario, dagPlus(st.data.vandaag, 180)); if (a && a.voorstel) { st.scenario = a.voorstel.scenario; st.prognose = true; teken(); toast('Scenario: termijn eerder gefactureerd — sla op als je het zo wilt'); } }
    else if (t.dataset.vraag) vraagAntwoord(t.dataset.sl, t.dataset.f, t.dataset.vraag === 'ja');
  }
  function blad(html, bij) {
    const o = document.createElement('div'); o.className = 'mtg-blad';
    o.innerHTML = `<div role="dialog" aria-modal="true">${html}<div style="margin-top:14px;text-align:right"><button class="mtg-knop" data-sluit="1">Sluiten</button></div></div>`;
    o.addEventListener('click', ev => { if (ev.target === o || ev.target.closest('[data-sluit]')) o.remove(); else if (ev.target.closest('[data-ev]') && !bij) { o.remove(); eventDetail(ev.target.closest('[data-ev]').dataset.ev); } });
    document.body.appendChild(o);
    if (bij) bij(o);
    return o;
  }
  function toast(t) { const o = document.createElement('div'); o.className = 'mtg-toast'; o.textContent = t; document.body.appendChild(o); setTimeout(() => o.remove(), 3500); }
  G._toast = toast;
  async function stuur(pad, body) {
    const r = await st.bron.haal(pad, { method: 'POST', body });
    if (!r || r.error) throw new Error(r && r.error || 'opslaan mislukt');
    if (r.cachever) st.cv = r.cachever;                      // volgende load met deze versie (geen oude cache van een andere edge)
    if (r.ks) { st.ks = (st.ks || []).filter(x => x.k !== r.ks && Date.now() - x.t < 180000).concat({ k: r.ks, t: Date.now() }).slice(-10); }   // KV-list loopt tot ~1 min achter
    return r;
  }
  function eventDetail(id) {
    const e = (st.data.events || []).find(x => x.id === id); if (!e) return;
    const v = e.verwacht, link0 = e.document_url || e.bron_url, link = /^https:\/\/moneybird\.com\//.test(String(link0 || '')) ? link0 : null;   // alleen Moneybird-links
    const factuur = (e.bron === 'inkoop' || e.bron === 'verkoop') && e.document_id;
    blad(`<h3>${esc(e.tegenpartij || BRON[e.bron] || '')}</h3>
      <dl class="mtg-dl"><dt>Bedrag</dt><dd class="${e.telt_niet ? '' : e.delta > 0 ? 'mtg-in' : 'mtg-uit'}"><b>${esc(eur(e.telt_niet ? Math.abs(e.bedrag) : e.delta, true))}</b>${e.telt_niet ? ' <span class="mtg-chip achter">telt niet mee in de lijn</span>' : ''}${e.marge ? ` <span class="mtg-chip">${esc(eur(e.marge.min))} tot ${esc(eur(e.marge.max))}</span>` : ''}</dd>
      <dt>Datum</dt><dd>${esc(datumTekst(e.datum, true))}${e.vervaldag && e.vervaldag !== e.datum ? ` <span class="mtg-chip">vervaldag ${esc(datumTekst(e.vervaldag))}</span>` : ''}</dd>
      ${e.datum_vroeg ? `<dt>Marge</dt><dd>${esc(datumTekst(e.datum_vroeg))} – ${esc(datumTekst(e.datum_laat))}</dd>` : ''}
      <dt>Bron</dt><dd>${esc(BRON[e.bron] || e.bron)}${e.referentie ? ' ' + esc(e.referentie) : ''}</dd>
      <dt>Zekerheid</dt><dd>${esc(ZEKER[e.zekerheid] || e.zekerheid)}${e.achterstallig ? ' · <span class="mtg-uit">achterstallig</span>' : ''}${e.intern ? ' · intern (potje ' + esc(e.pot) + ')' : ''}</dd></dl>
      <div class="mtg-uitleg"><b>Waarom deze datum?</b> ${esc(e.uitleg || '')}${v && v.n ? ` (gebaseerd op ${v.n} betaalde facturen)` : ''}</div>
      ${link ? `<p><a href="${esc(link)}" target="_blank" rel="noopener">Openen in Moneybird ↗</a></p>` : ''}
      ${e.telt_niet && e.telt_niet.soort === 'concept' ? '<div class="mtg-melding">Controleer deze factuur in Moneybird: zonder factuurdatum of -nummer is hij nooit verstuurd (of staat een inkoopfactuur per ongeluk bij de verkoop). Pas na het versturen telt hij mee.</div>' : ''}
      ${e.telt_niet && e.telt_niet.soort === 'valuta' ? '<div class="mtg-melding">Deze factuur is in een vreemde valuta zonder bedrag in euro in Moneybird: ze telt niet mee in de lijn en wordt niet verrekend. Controleer ze in Moneybird.</div>' : ''}
      ${(e.tegoed && !e.tegoed_onbekend && st.mag) ? `<label class="mtg-veld" style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" data-tegoed="1"${e.tegoed_telt ? ' checked' : ''} style="width:22px;height:22px"><span>Als ontvangst meetellen (het tegoed wordt echt uitbetaald)</span></label>` : ''}
      ${st.mag && factuur && !e.tegoed ? `<div class="mtg-knoppen"><button class="mtg-knop" data-ov="datum">Andere datum…</button><button class="mtg-knop" data-ov="afbetaling">Afbetaling…</button>${e.override ? '<button class="mtg-knop" data-ov="wissen">Eigen afspraak wissen</button>' : ''}</div>` : ''}
      ${st.mag && e.patroon_id ? `<div class="mtg-knoppen"><button class="mtg-knop" data-pt="uit">Dit patroon niet meer meenemen</button></div>` : ''}`, o => {
      o.addEventListener('click', async ev => {
        const tg = ev.target.closest('[data-tegoed]');
        if (tg) { const aan = tg.checked; o.remove(); return opslaan(() => stuur('/geld/override', aan ? { document_id: e.document_id, soort: 'inkoop', type: 'tegoed', vorige_ts: e.override ? e.override.ts : null } : { document_id: e.document_id, soort: 'inkoop', type: 'wissen', vorige_ts: e.override ? e.override.ts : null }), aan ? 'Het tegoed telt nu als ontvangst mee' : 'Het tegoed telt niet meer als ontvangst mee'); }
        const k = ev.target.closest('[data-ov],[data-pt]'); if (!k) return;
        if (k.dataset.pt) { o.remove(); return patroonZet(e.patroon_id, false); }
        o.remove(); overrideBlad(e, k.dataset.ov);
      });
    });
  }
  function overrideBlad(e, type) {
    const soort = e.bron, basis = { document_id: e.document_id, soort, vorige_ts: e.override ? e.override.ts : null };
    if (type === 'wissen') return opslaan(() => stuur('/geld/override', Object.assign(basis, { type: 'wissen' })), 'Eigen afspraak gewist');
    const o = blad(type === 'datum' ? `<h3>Andere betaaldatum</h3><div class="mtg-melding">Voor ${esc(e.tegenpartij)} (${esc(eur(e.delta))}). Alleen in deze tool; er gaat niets naar Moneybird.</div>
      <label class="mtg-veld"><span>Datum</span><input type="date" name="datum" value="${esc(e.datum || '')}"></label><label class="mtg-veld"><span>Reden (optioneel)</span><input name="reden" maxlength="120"></label>
      <button class="mtg-knop aan" data-ok="1">Opslaan</button>`
      : `<h3>Afbetaling</h3><div class="mtg-melding">Open: ${esc(eur(Math.abs(e.delta), true))}. De termijnen tellen samen precies op tot het open bedrag; de laatste termijn neemt de rest.</div>
      <label class="mtg-veld"><span>Bedrag per termijn (€)</span><input type="number" step="0.01" min="0.01" name="bedrag"></label>
      <label class="mtg-veld"><span>Eerste termijn</span><input type="date" name="eerste" value="${esc(st.data.vandaag)}"></label>
      <label class="mtg-veld"><span>Elke</span><select name="interval"><option value="maand">maand</option><option value="week">week</option></select></label>
      <label class="mtg-veld"><span>Aantal termijnen (leeg = tot het betaald is)</span><input type="number" min="1" max="240" step="1" name="termijnen"></label>
      <label class="mtg-veld"><span>Reden (optioneel)</span><input name="reden" maxlength="120"></label><button class="mtg-knop aan" data-ok="1">Opslaan</button>`);
    o.querySelector('[data-ok]').addEventListener('click', () => {
      const f = n => o.querySelector(`[name="${n}"]`).value;
      const body = type === 'datum' ? Object.assign(basis, { type, datum: f('datum'), reden: f('reden') })
        : Object.assign(basis, { type, bedrag: Number(f('bedrag')), eerste: f('eerste'), interval: f('interval'), termijnen: f('termijnen') ? Number(f('termijnen')) : null, reden: f('reden') });
      o.remove(); opslaan(() => stuur('/geld/override', body), 'Opgeslagen — de lijn rekent mee');
    });
  }
  async function opslaan(fn, ok) {
    try { await fn(); toast(ok); st.cfg = null; await G.laad(true); }
    catch (e) { toast('Niet opgeslagen: ' + e.message + (/gewijzigd|aangepast/.test(e.message) ? ' — herlaad' : '')); await G.laad(true); }
  }
  function patroonZet(id, aan) {
    const k = st.data.patronen && st.data.patronen.lijst.find(x => x.id === id);
    return opslaan(async () => { const huidig = await st.bron.haal('/geld/patronen'); const keuze = huidig && huidig.keuzes && huidig.keuzes[id]; return stuur('/geld/patroon', { id, aan, vorige_ts: keuze ? keuze.ts : null }); },
      `${k ? k.tegenpartij : 'Patroon'} ${aan ? 'weer meegenomen' : 'niet meer meegenomen'}`);
  }
  // Potje of rekening bewerken (doel, streefdatum, inleg, herkenning, ijken) of een nieuw potje/doel.
  function potBlad(id) {
    const cfg = st.cfg || { potten: [] }, nieuw = id === 'nieuw', lopend = id === 'lopend';
    const p = nieuw ? { id: '', naam: '', doel: 'buffer', weekinleg: null, weekdag: null, actief: true, herkenning: { tegenrekening: '', omschrijving: '' } } : lopend ? { id: 'lopend', naam: 'Lopende rekening', streef: cfg.lopend_streef } : (cfg.potten || []).find(x => x.id === id);
    if (!p) return;
    const s = p.streef || {}, saldo = lopend ? st.data.saldo.lopend : (st.data.saldo.potten || {})[id];
    const kand = herkenningKandidaten();
    const dagen = ['', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
    const o = blad(`<h3>${nieuw ? 'Nieuw potje of doel' : esc(G.potNaam(p))}</h3>
      ${!nieuw && (lopend || id === G.noodPot(st.data, st.cfg)) ? '<div class="mtg-melding">Het doel volgt standaard het advies. Vul hieronder een eigen bedrag of band in om dat te gebruiken; laat je alles leeg, dan geldt weer het advies.</div>' : ''}
      ${lopend ? '' : `<label class="mtg-veld"><span>Naam</span><input name="naam" value="${esc(G.potNaam(p))}" maxlength="40"></label>
      <label class="mtg-veld"><span>Soort</span><select name="doel">${['buffer', 'winst', 'vakantie', 'btw', 'overig'].map(x => `<option ${p.doel === x ? 'selected' : ''} value="${esc(x)}">${esc({ buffer: 'buffer', winst: 'winstuitkering', vakantie: 'vakantiegeld', btw: 'BTW', overig: 'eigen doel' }[x])}</option>`).join('')}</select></label>
      ${nieuw ? `<label class="mtg-veld" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="virtueel" style="width:auto"> <span style="margin:0">Doel zonder eigen rekening (virtueel, bv. "machine-sparen" binnen de buffer) — telt niet mee in het totaal</span></label>` : ''}`}
      <label class="mtg-veld"><span>Doelbedrag (€) — of vul hieronder een bandbreedte in</span><input type="number" name="bedrag" value="${esc(s.bedrag != null ? s.bedrag : '')}"></label>
      <div style="display:flex;gap:8px"><label class="mtg-veld" style="flex:1"><span>Van (€)</span><input type="number" name="van" value="${esc(s.van != null ? s.van : '')}"></label><label class="mtg-veld" style="flex:1"><span>Tot (€)</span><input type="number" name="tot" value="${esc(s.tot != null ? s.tot : '')}"></label></div>
      <label class="mtg-veld"><span>Streefdatum</span><input type="date" name="datum" value="${esc(s.datum || '')}"></label>
      <label class="mtg-veld" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="mee" style="width:auto" ${s.meegroeien === false ? '' : 'checked'}> <span style="margin:0">Doel laten meegroeien met de bankhistorie (automatisch alleen kleine stappen tot +10% per maand en onder de bovengrens, met melding; het eerste advies, grotere sprongen en verlagen alleen als voorstel)</span></label>
      <label class="mtg-veld"><span>Bovengrens voor automatisch meegroeien (€) — leeg = de "tot" van de band, of niets automatisch</span><input type="number" name="meemax" value="${esc(s.meegroei_max != null ? s.meegroei_max : '')}"></label>
      <label class="mtg-veld"><span>Mijlpalen (€, komma-gescheiden; leeg = standaard)</span><input name="mijlpalen" value="${esc((s.mijlpalen || []).join(', '))}"></label>
      ${lopend ? '' : `<div style="display:flex;gap:8px"><label class="mtg-veld" style="flex:1"><span>Weekinleg (€)</span><input type="number" name="weekinleg" value="${esc(p.weekinleg != null ? p.weekinleg : '')}"></label>
      <label class="mtg-veld" style="flex:1"><span>Op</span><select name="weekdag"><option value="">${p.weekdag ? '' : 'afleiden uit de bank'}</option>${[1, 2, 3, 4, 5, 6, 7].map(i => `<option value="${i}" ${p.weekdag === i ? 'selected' : ''}>${esc(dagen[i])}</option>`).join('')}</select></label></div>
      <div class="pot-echt"><label class="mtg-veld"><span>Herkenning: tegenrekening van de overboekingen</span><input name="tegenrekening" list="mtg-kand" value="${esc(p.herkenning ? p.herkenning.tegenrekening : '')}"><datalist id="mtg-kand">${kand.map(k => `<option value="${esc(k.iban)}">${esc(k.naam)}</option>`).join('')}</datalist></label>
      <label class="mtg-veld"><span>…of de letter in de naam van de overboeking (bij "Zakelijke oranje spaarrekening <b>Z</b>"; de bank geeft dan geen tegenrekening mee)</span><input name="letter" maxlength="1" size="2" list="mtg-letters" value="${esc(p.herkenning && p.herkenning.letter ? p.herkenning.letter : '')}" style="width:60px"><datalist id="mtg-letters">${letterKandidaten().map(k => `<option value="${esc(k.letter)}">${esc(k.naam)}</option>`).join('')}</datalist></label>
      ${kand.length ? `<div class="mtg-melding">Herkende overboekingen: ${kand.slice(0, 4).map(k => esc(k.naam + ' ' + k.iban)).join(' · ')}</div>` : ''}</div>
      ${!nieuw ? `<label class="mtg-veld" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="actief" style="width:auto" ${p.actief !== false ? 'checked' : ''}> <span style="margin:0">Actief (uitvinken = archiveren; het saldo blijft meetellen)</span></label>` : ''}`}
      <button class="mtg-knop aan" data-ok="1">Opslaan</button>
      ${!nieuw && !p.virtueel ? `<hr><b>Saldo ijken</b><div class="mtg-melding">Vul het echte banksaldo aan het eind van een dag in (uit de bank-app). Huidig: ${esc(eur(saldo ? saldo.gerapporteerd : null, true))}${saldo && saldo.ijkpunt ? ', laatst geijkt ' + esc(datumTekst(saldo.ijkpunt.datum)) : ''}.</div>
      <div style="display:flex;gap:8px"><label class="mtg-veld" style="flex:1"><span>Saldo (€)</span><input type="number" step="0.01" name="ijk"></label><label class="mtg-veld" style="flex:1"><span>Eind van de dag</span><input type="date" name="ijkdatum" value="${esc(st.data.vandaag)}" max="${esc(st.data.vandaag)}"></label></div>
      <button class="mtg-knop" data-ijk="1">Saldo opslaan</button>` : ''}`);
    o.querySelector('[data-ok]').addEventListener('click', () => {
      const f = n => { const el = o.querySelector(`[name="${n}"]`); return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined; };
      const getal = n => f(n) === '' || f(n) == null ? null : Number(f(n));
      const nuSaldo = lopend ? besNu(st.data) : saldo ? saldo.gerapporteerd : 0;   // lopend: het besteedbaar budget (zoals de lijn)
      const streef = (getal('bedrag') != null || getal('van') != null || f('datum')) ? { bedrag: getal('bedrag'), van: getal('van'), tot: getal('tot'), datum: f('datum') || null,
        mijlpalen: String(f('mijlpalen') || '').split(/[;,]\s*/).map(x => Number(x.replace(/[^\d.-]/g, ''))).filter(x => x === x && String(x) !== ''),
        start: s.start && (s.bedrag === getal('bedrag') && s.van === getal('van')) ? s.start : { datum: st.data.vandaag, bedrag: nuSaldo == null ? 0 : nuSaldo } } : null;
      if (streef && !(f('mijlpalen') || '').trim()) streef.mijlpalen = [];
      if (streef) Object.assign(streef, { meegroeien: !!f('mee'), meegroei_max: getal('meemax'), advies_maand: s.advies_maand || null, wijziging: s.wijziging || null, advies_akkoord: s.advies_akkoord || null });
      let body;
      if (lopend) body = { revisie: cfg.revisie, lopend_streef: streef };
      else {
        const potten = (cfg.potten || []).map(x => Object.assign({}, x));
        const nieuwId = nieuw ? (String(f('naam') || 'potje').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'potje') : id;
        let pid = nieuwId; for (let i = 2; nieuw && potten.some(x => x.id === pid); i++) pid = nieuwId + '-' + i;
        const pot = Object.assign(nieuw ? { id: /^[a-z]/.test(pid) ? pid : 'p-' + pid } : potten.find(x => x.id === id), { naam: f('naam') || p.naam, doel: f('doel') || p.doel, weekinleg: getal('weekinleg'), weekdag: f('weekdag') ? Number(f('weekdag')) : null, streef });
        if (!pot.virtueel && !(nieuw && f('virtueel'))) pot.herkenning = Object.assign({}, pot.herkenning || {}, { tegenrekening: f('tegenrekening') || '', letter: String(f('letter') || '').trim().slice(0, 1).toUpperCase() });
        if (nieuw && f('virtueel')) { pot.virtueel = true; delete pot.herkenning; }
        if (!nieuw) pot.actief = !!f('actief');
        if (nieuw) potten.push(pot);
        body = { revisie: cfg.revisie, potten };
      }
      o.remove(); opslaan(() => stuur('/geld/config', body), 'Opgeslagen');
    });
    const ijk = o.querySelector('[data-ijk]');
    if (ijk) ijk.addEventListener('click', () => {
      const bedrag = Number(o.querySelector('[name="ijk"]').value), datum = o.querySelector('[name="ijkdatum"]').value;
      if (!o.querySelector('[name="ijk"]').value) return toast('Vul een saldo in');
      o.remove(); opslaan(() => stuur('/geld/ijkpunt', { rekening: id, bedrag, datum }), 'Saldo geijkt');
    });
  }
  // Letters uit namen als "… spaarrekening Z" van overboekingen die bij geen pot horen of juist wel (om de letter van een pot te kiezen).
  function letterKandidaten() {
    const uit = new Map();
    for (const e of st.data.events || []) { const m = e.bron === 'bank' && /spaarrekening\s+([A-Z])(\d{6,})?\s*$/i.exec(e.tegenpartij || ''); if (m) uit.set(m[1].toUpperCase(), { letter: m[1].toUpperCase(), naam: e.tegenpartij }); }
    return [...uit.values()];
  }
  // Kandidaten voor potjes-herkenning: tegenrekeningen van overboekingen die op spaar lijken, en wekelijkse patronen.
  function herkenningKandidaten() {
    const uit = new Map();
    for (const e of st.data.events || []) if (e.bron === 'bank' && e.iban && (e.intern_vermoed || e.intern_onzeker || /spaar/i.test(e.tegenpartij || ''))) uit.set(e.iban, { iban: e.iban, naam: e.tegenpartij });
    for (const x of (st.data.patronen && st.data.patronen.lijst) || []) if (x.frequentie === 'week' && x.richting === 'uit') uit.set(x.tegenpartij, { iban: '', naam: x.tegenpartij + ' (wekelijks ' + eur(x.bedrag) + ')' });
    return [...uit.values()].filter(k => k.iban);
  }
  function instBlad() {
    const c = st.cfg || {}, b = c.btw || {}, pot = (c.potten || []).filter(p => !p.virtueel);
    const o = blad(`<h3>Kredietlimiet en BTW</h3>
      <label class="mtg-veld" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="inl" style="width:auto" ${b.modus === 'apart' ? '' : 'checked'}> <span style="margin:0">BTW-rekening telt mee als lopende rekening (aangifte gaat van de gezamenlijke stand, geen terugboeking)</span></label>
      <label class="mtg-veld"><span>Kredietlimiet lopende rekening (€)</span><input type="number" name="kl" value="${esc(c.kredietlimiet != null ? c.kredietlimiet : '')}"></label>
      ${(() => {
        const e = G.effCfg(st.data, c), np = G.noodPot(st.data, c), npot = (c.potten || []).find(x => x.id === np), ns = npot && npot.streef, nd = eigenStreef(ns) ? (ns.bedrag != null ? ns.bedrag : ns.van) : null, ls0 = c.lopend_streef || null, ld = eigenStreef(ls0) ? (ls0.bedrag != null ? ls0.bedrag : ls0.van) : null;
        const fa = e._herkomst.fictieve_buffer.advies, na = e._herkomst.noodbuffer && e._herkomst.noodbuffer.advies, la = e._herkomst.lopend.advies;
        const hintHtml = (eigen, a, tekst, naam) => `<div class="mtg-melding">${a ? `Advies: ${esc(eur(a.bedrag))} (${esc(a.reden)})` : `Nog geen advies: ${esc(tekst)}`} · <b>${eigen ? 'eigen bedrag' : a ? 'volgt advies' : 'geen bedrag'}</b>${eigen ? ` <a href="#" data-leeg="${esc(naam)}">leegmaken = weer het advies</a>` : ''}</div>`;
        const veldHtml = (naam, tekst, waarde, a, uit) => `<label class="mtg-veld"><span>${tekst}</span><input type="number" name="${esc(naam)}" value="${esc(waarde != null ? waarde : '')}" placeholder="${esc(a ? 'advies ' + eur(a.bedrag) : 'geen advies')}" ${uit ? 'disabled' : ''}></label>`;
        return `<div class="mtg-uitleg" style="font-size:12px">Besteedbaar budget en buffers. Standaard geldt het advies uit je eigen historie; vul je zelf een bedrag in, dan geldt dat. Leeg laten (of weer leegmaken) = weer het advies. Het advies wordt opnieuw berekend als de data verandert.</div>
        ${veldHtml('fict', 'Fictieve buffer op de lopende rekening (€) — alleen een gele lijn in de grafiek en de onderkant van de kasruimte en de Koersmeter; dit bedrag staat nergens anders in Financiën', c.fictieve_buffer, fa, false)}
        ${hintHtml(typeof c.fictieve_buffer === 'number', fa, 'minstens 6 maanden bankhistorie nodig', 'fict')}
        ${veldHtml('noodstreef', `Streefomvang noodbuffer (€)${npot ? ` — ${esc(G.potNaam(npot))}${ns && ns.van != null && ns.tot != null ? `, nu een band van ${esc(eur(ns.van))} tot ${esc(eur(ns.tot))}` : ''}` : ' — er is nog geen potje met doel "buffer"'}`, nd, na, !npot)}
        ${npot ? hintHtml(eigenStreef(ns), na, 'de vaste lasten per maand zijn nog onbekend', 'noodstreef') : ''}
        ${veldHtml('lopstreef', `Streefniveau lopende rekening (€) — het doel voor je besteedbaar budget${ls0 && ls0.van != null && ls0.tot != null ? `, nu een band van ${esc(eur(ls0.van))} tot ${esc(eur(ls0.tot))}` : ''}`, ld, la, false)}
        ${hintHtml(eigenStreef(ls0), la, 'minstens 6 maanden bankhistorie nodig', 'lopstreef')}`;
      })()}
      <label class="mtg-veld"><span>Spaarrente op de potjes (% per jaar) — leeg = afleiden uit de rentebijschrijvingen${(() => { const sp = G.spaarRente(Object.assign({}, st.data, { instellingen: Object.assign({}, st.data.instellingen, { spaarrente: null }) }), Object.assign({}, c, { spaarrente: null })); return sp ? ` (afgeleid: ${(sp.tarief * 100).toFixed(2).replace('.', ',')}%)` : ' (niet gevonden)'; })()}</span><input type="number" step="0.01" name="spr" value="${c.spaarrente != null ? Math.round(c.spaarrente * 10000) / 100 : ''}"></label>
      <label class="mtg-veld"><span>BTW-sparen: percentage van elke ontvangst (bv. 17,36 = 21/121)</span><input type="number" step="0.01" name="pct" value="${b.spaarpercentage != null ? Math.round(b.spaarpercentage * 10000) / 100 : ''}"></label>
      <label class="mtg-veld"><span>BTW-sparen naar potje</span><select name="spaarpot"><option value="">—</option>${pot.map(p => `<option value="${esc(p.id)}" ${b.spaarpot === p.id ? 'selected' : ''}>${esc(p.naam)}</option>`).join('')}</select></label>
      <div class="btw-apart"><label class="mtg-veld"><span>Alleen als de BTW-rekening apart staat — BTW-aangifte betaald van</span><select name="van"><option value="lopend" ${b.aangifte_van !== 'lopend' && b.aangifte_van ? '' : 'selected'}>lopende rekening</option>${pot.map(p => `<option value="${esc(p.id)}" ${b.aangifte_van === p.id ? 'selected' : ''}>${esc(p.naam)}</option>`).join('')}</select></label>
      <label class="mtg-veld"><span>Zelfde dag terugboeken van</span><select name="terug"><option value="">niet</option>${pot.map(p => `<option value="${esc(p.id)}" ${b.terugboeking_van === p.id ? 'selected' : ''}>${esc(p.naam)}</option>`).join('')}</select></label>
      </div><button class="mtg-knop aan" data-ok="1">Opslaan</button>`);
    const apartZet = () => { o.querySelector('.btw-apart').style.display = o.querySelector('[name="inl"]').checked ? 'none' : ''; };
    o.querySelector('[name="inl"]').addEventListener('change', apartZet); apartZet();
    o.querySelectorAll('[data-leeg]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); const i = o.querySelector(`[name="${a.dataset.leeg}"]`); if (i) i.value = ''; }));
    o.querySelector('[data-ok]').addEventListener('click', () => {
      const f = n => o.querySelector(`[name="${n}"]`).value;
      const body = { revisie: c.revisie, kredietlimiet: f('kl') === '' ? null : Number(f('kl')), btw: { spaarpercentage: f('pct') === '' ? null : Math.round(Number(String(f('pct')).replace(',', '.')) * 100) / 10000, spaarpot: f('spaarpot') || null, aangifte_van: f('van') || null, terugboeking_van: f('terug') || null, modus: o.querySelector('[name="inl"]').checked ? 'in_lopend' : 'apart' } };
      body.fictieve_buffer = f('fict') === '' ? null : Number(f('fict'));
      // streefomvang noodbuffer en streefniveau lopend: alleen sturen als je ze hebt gewijzigd. Een bedrag = eigen bedrag; leeg = weer het advies (eigen bedrag gewist).
      const np = G.noodPot(st.data, c), npot = (c.potten || []).find(x => x.id === np), ns = npot && npot.streef, nd = eigenStreef(ns) ? (ns.bedrag != null ? ns.bedrag : ns.van) : null, ls0 = c.lopend_streef || null, ld = eigenStreef(ls0) ? (ls0.bedrag != null ? ls0.bedrag : ls0.van) : null;
      const nieuwNood = f('noodstreef') === '' ? null : Number(f('noodstreef')), nieuwLop = f('lopstreef') === '' ? null : Number(f('lopstreef'));
      if (npot && nieuwNood !== (nd == null ? null : nd)) body.potten = (c.potten || []).map(x => x.id === np ? Object.assign({}, x, { streef: Object.assign({}, x.streef || {}, { bedrag: nieuwNood, van: null, tot: null }) }) : x);
      if (nieuwLop !== (ld == null ? null : ld)) body.lopend_streef = Object.assign({}, ls0 || {}, { bedrag: nieuwLop, van: null, tot: null });
      body.spaarrente = f('spr') === '' ? null : Math.round(Number(String(f('spr')).replace(',', '.')) * 100) / 10000;
      o.remove();
      opslaan(() => stuur('/geld/config', body), 'Opgeslagen').then(() => { if (body.fictieve_buffer != null && st.cfg && st.cfg.fictieve_buffer !== body.fictieve_buffer) toast('De fictieve buffer is niet opgeslagen: de server kent hem nog niet (worker-update nodig)'); });
    });
  }
  // Klantgroepen: voorstel uit gedeelde naamvoorvoegsels (≥ 2 klanten met betaalhistorie); de eigenaar bevestigt.
  async function groepenBlad() {
    const c = st.cfg || {}, groepen = (c.klantgroepen || []).slice();
    let prof = null; try { prof = await st.bron.haal('/geld/profiel'); } catch (e) { }
    const vs = prof && prof.klanten ? G.groepVoorstel(prof.klanten, groepen) : [];
    const o = blad(`<h3>Klantgroepen</h3><div class="mtg-melding">Een groep laat nieuwe klanten (of klanten met weinig historie) rekenen met het betaalgedrag van de hele groep. Alleen wat je hier bevestigt telt; er wordt niets gegokt.</div>
      ${groepen.map((g, i) => `<div class="mtg-rij" style="cursor:default"><span class="n">${esc(g.naam)} ${g.prefix ? `<span class="mtg-chip">begint met "${esc(g.prefix)}"</span>` : `<span class="mtg-chip">${g.contact_ids.length} klanten</span>`}</span><button class="mtg-knop klein" data-weg="${i}">verwijderen</button></div>`).join('') || '<div class="mtg-melding">Nog geen groepen.</div>'}
      ${vs.length ? `<p><b>Voorstellen</b> (zelfde begin van de naam bij meerdere klanten):</p>${vs.slice(0, 8).map((v, i) => `<div class="mtg-rij" style="cursor:default"><span class="n">"${esc(v.prefix)}…" — ${esc(v.namen.slice(0, 4).join(', '))}${v.namen.length > 4 ? ' …' : ''}</span><button class="mtg-knop klein aan" data-voeg="${i}">als groep</button></div>`).join('')}` : `<div class="mtg-melding">${prof ? 'Geen voorstellen gevonden.' : 'Voorstellen komen zodra het betaalgedrag is berekend.'}</div>`}
      <label class="mtg-veld"><span>Of zelf: naam begint met (≥ 3 tekens)</span><input name="prefix"></label><button class="mtg-knop" data-eigen="1">Groep toevoegen</button>`);
    const bewaar = lijst => { o.remove(); opslaan(() => stuur('/geld/config', { revisie: c.revisie, klantgroepen: lijst }), 'Klantgroepen opgeslagen'); };
    const id = t => (t.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'groep').replace(/^([^a-z])/, 'g-$1');
    o.addEventListener('click', ev => {
      const k = ev.target.closest('[data-weg],[data-voeg],[data-eigen]'); if (!k) return;
      if (k.dataset.weg) bewaar(groepen.filter((_, i) => i !== Number(k.dataset.weg)));
      else if (k.dataset.voeg) { const v = vs[Number(k.dataset.voeg)]; bewaar(groepen.concat([{ id: id(v.prefix), naam: v.prefix + '-locaties', prefix: v.prefix, contact_ids: [] }])); }
      else { const p = o.querySelector('[name="prefix"]').value.trim(); if (p.length < 3) return toast('Minstens 3 tekens'); bewaar(groepen.concat([{ id: id(p), naam: p, prefix: p, contact_ids: [] }])); }
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
