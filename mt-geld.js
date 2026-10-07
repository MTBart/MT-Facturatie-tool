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

  // ── Rekenen (los testbaar) ───────────────────────────────────────────────────
  const isGepland = e => e.bron !== 'bank' && !e.saldo_ijkpunt && !!e.datum && typeof e.delta === 'number';
  G.isGepland = isGepland;
  // Effect van een event op de gekozen lijn: 'lopend' = de lopende rekening; 'totaal' = lopend + potjes (intern telt niet).
  function effect(e, modus) {
    if (typeof e.delta !== 'number' || e.saldo_ijkpunt) return 0;
    if (modus === 'totaal') return e.intern ? 0 : e.delta;
    return (e.rekening || 'lopend') === 'lopend' ? e.delta : 0;
  }
  G.effect = effect;
  // Telt dit geplande event mee? Prognose alleen met de schakelaar aan (en de post zelf aan).
  G.telt = (e, opt) => !(e.zekerheid === 'prognose' && !(opt && opt.prognose));
  // Dagelijkse lijn van van..tot: verleden terug vanaf het saldo van vandaag (bank), toekomst vooruit (gepland).
  G.lijn = function (data, opt) {
    opt = opt || {};
    const modus = opt.modus || 'lopend', v = data.vandaag;
    const s0 = modus === 'totaal' ? data.saldo.totaal && data.saldo.totaal.gerapporteerd : data.saldo.lopend && data.saldo.lopend.gerapporteerd;
    if (s0 == null) return { punten: [], onbekend: true };
    const dagsomVan = modus === 'lopend' && data.historie_dagsom ? Object.keys(data.historie_dagsom).sort()[0] : null;   // verder terug dan de bank van de tijdlijn
    const van = opt.van || (dagsomVan && dagsomVan < data.van ? dagsomVan : data.van), tot = opt.tot || data.tot, perDag = {}, verleden = {};
    for (const e of data.events || []) {
      if (e.bron === 'bank') { if (e.datum <= v) verleden[e.datum] = (verleden[e.datum] || 0) + effect(e, modus); continue; }
      if (!isGepland(e) || !G.telt(e, opt)) continue;
      const d = e.datum < v ? v : e.datum;
      perDag[d] = (perDag[d] || 0) + effect(e, modus);
    }
    // Verder terug dan de bankmutaties van de tijdlijn: dagsommen (alleen de lopende rekening).
    const bankVan = data.bronnen && data.bronnen.bankmutaties ? data.bronnen.bankmutaties.van : v;
    if (modus === 'lopend' && data.historie_dagsom) for (const [d, som] of Object.entries(data.historie_dagsom)) if (d < bankVan && !(d in verleden)) verleden[d] = som;
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
    for (const e of data.events || []) {
      if (e.bron !== 'bank' || e.datum <= van || e.datum > v) continue;
      if (rek === 'lopend') som += e.delta; else if (e.intern && e.pot === rek) som -= e.delta;
    }
    if (rek === 'lopend' && data.historie_dagsom && bankVan > dagPlus(van, 1)) for (const [d, x] of Object.entries(data.historie_dagsom)) if (d > van && d < bankVan) som += x;
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
  const datumTekst = (d, lang) => { if (!d) return 'nog geen datum'; const t = new Date(d + 'T12:00:00Z'); return t.toLocaleDateString('nl-NL', lang ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' }); };
  G._eur = eur; G._esc = esc;
  const BRON = { bank: 'Bank (werkelijk)', inkoop: 'Inkoopfactuur', verkoop: 'Verkoopfactuur', patroon: 'Vast patroon', inleg: 'Weekinleg potje', btw: 'BTW-aangifte', 'btw-sparen': 'BTW-sparen', prognose: 'Prognose', ijkpunt: 'IJkpunt' };
  const ZEKER = { werkelijk: 'werkelijk', vastgelegd: 'vastgelegd in Moneybird', gepland: 'gepland', aanname: 'aanname (betaalgedrag)', invullen: 'nog in te vullen', patroon: 'vast patroon', schatting: 'schatting', prognose: 'prognose' };
  const UITLEG = {
    intro: 'De lijn is de lopende rekening: links wat er gebeurd is (bank), rechts wat er verwacht wordt. ▲ is geld dat binnenkomt, ▼ geld dat eruit gaat. Een stippellijn is prognose (nog geen factuur). De rode lijn is de kredietlimiet: daaronder kan het niet. Potjes zijn de spaarrekeningen; overboekingen daarheen tellen niet mee in "totaal".',
    nu: 'Het saldo van vandaag. Als er een ijkpunt is (zelf ingevuld bankaldo), rekent de tool vanaf dat ijkpunt met de bankmutaties; anders de stand uit Moneybird.',
    laagste: 'Het laagste verwachte saldo in de gekozen periode, met alles wat gepland staat (facturen, vaste lasten, BTW). Hiermee zie je of het krap wordt.',
    ruimte: 'Hoeveel ruimte er op het laagste punt nog is tot de kredietlimiet van de lopende rekening.',
    lijn: 'Sleep of veeg om terug of vooruit te kijken, knijp of gebruik de knoppen om in of uit te zoomen. Tik op een dag voor wat er die dag gebeurt.',
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
.mtg-kaarten{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px}
.mtg-k{background:var(--card,#fff);border:1px solid var(--border,#e4e2da);border-radius:10px;padding:10px 12px;min-width:0}
.mtg-k .l{font-size:12px;color:var(--mtg-zacht);display:flex;justify-content:space-between;gap:6px}
.mtg-k .w{font-size:22px;font-weight:600;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mtg-k .s{font-size:12px;color:var(--mtg-zacht);margin-top:2px}
.mtg-k.rood .w{color:var(--mtg-uit)}
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
`;
    document.head.appendChild(s);
  }

  // ── Staat en laden ───────────────────────────────────────────────────────────
  const ZOOM = { week: 14, maand: 31, kwartaal: 92, jaar: 365 };
  const st = G._st = { data: null, cfg: null, zoom: 'maand', modus: 'lopend', offset: 0, prognose: true, el: null, bron: null, mag: false, wie: '', bezig: false, open: null };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };

  G.start = async function (el, opties) {
    st.el = el; st.bron = opties.bron; st.mag = !!opties.magWijzigen; st.wie = opties.wie || ''; st.ververst = false; st.scenario = {};
    st.projecten = opties.projecten || null; st.offerteBedrag = opties.offerteBedrag || null;
    if (ls.get('mtg:zoom:' + st.wie)) st.zoom = ls.get('mtg:zoom:' + st.wie);
    if (ls.get('mtg:prognose:' + st.wie) === '0') st.prognose = false;
    css();
    el.innerHTML = '<div class="mtg"><div class="mtg-melding">Geld laden…</div></div>';
    await G.laad();
  };
  G.laad = async function (vers) {
    const v = st.data ? st.data.vandaag : null;
    const vandaag = v || new Date().toISOString().slice(0, 10);
    const pad = `/geld/tijdlijn?van=${dagPlus(vandaag, -35)}&tot=${dagPlus(vandaag, 364)}&historie=1${vers ? '&vers=1' : ''}`;
    try {
      const [d, c] = await Promise.all([st.bron.haal(pad), st.cfg && !vers ? Promise.resolve({ config: st.cfg }) : st.bron.haal('/geld/config')]);
      if (!d || d.error) throw new Error(d && d.error || 'geen antwoord');
      st.data = d; st.cfg = c && c.config ? c.config : st.cfg;
    } catch (e) {
      st.el.innerHTML = `<div class="mtg"><div class="mtg-kaart">Het geldscherm kon niet laden (${esc(e.message)}). Probeer het later opnieuw.</div></div>`;
      return;
    }
    teken();
    verversOpAchtergrond();
  };
  // Betaalgedrag en vaste patronen: zonder cron — de eigenaar ververst ze op de achtergrond bij het openen.
  async function verversOpAchtergrond() {
    if (!st.mag || st.bezig || st.ververst) return;          // hooguit één poging per keer openen
    const w = st.data.waarschuwingen || [];
    const oud = b => w.some(x => x.bron === b && /nog niet berekend|ouder dan|onvolledig/.test(x.fout));
    const taken = [oud('profiel') && '/geld/profiel?vers=1', oud('patronen') && '/geld/patronen?vers=1'].filter(Boolean);
    if (!taken.length) return;
    st.bezig = true; st.ververst = true; teken();
    try { for (const t of taken) await st.bron.haal(t); } catch (e) { }
    st.bezig = false;
    await G.laad(true);
  }

  // ── Tekenen ──────────────────────────────────────────────────────────────────
  function teken() {
    const d = st.data; if (!d) return;
    const lijn = G.lijn(d, { modus: st.modus, prognose: st.prognose });
    st.lijn = lijn;
    const zoomTot = dagPlus(d.vandaag, ZOOM[st.zoom]);
    const low = G.laagste(lijn, zoomTot);
    const L = d.saldo.lopend || {}, limiet = L.kredietlimiet;
    const nu = st.modus === 'totaal' ? d.saldo.totaal.gerapporteerd : L.gerapporteerd;
    const ruimte = limiet != null && low && st.modus === 'lopend' ? low.saldo + limiet : null;
    const introWeg = ls.get('mtg:intro:' + st.wie) === 'weg';
    const heeftProg = (d.events || []).some(e => e.zekerheid === 'prognose');
    st.el.innerHTML = `<div class="mtg">
  <div class="mtg-kop"><h2>Geld</h2>
    <div class="mtg-knoppen">
      <button class="mtg-knop ${st.modus === 'lopend' ? 'aan' : ''}" data-modus="lopend">Lopende rekening</button>
      <button class="mtg-knop ${st.modus === 'totaal' ? 'aan' : ''}" data-modus="totaal">Totaal met potjes</button>
      ${introWeg ? '<button class="mtg-vraag" data-intro="1" title="Wat zie je hier?">?</button>' : ''}
    </div></div>
  ${introWeg ? '' : `<div class="mtg-uitleg"><b>Wat zie je hier?</b> ${esc(UITLEG.intro)} <button class="mtg-knop klein" data-intro="weg">Begrepen</button></div>`}
  ${st.bezig ? '<div class="mtg-uitleg">Betaalgedrag en vaste patronen worden bijgewerkt… (de lijn ververst vanzelf)</div>' : ''}
  <div class="mtg-kaarten">
    ${kaart('nu', 'Nu', eur(nu), nu != null && nu < 0, (L.bron === 'ijkpunt' ? 'vanaf ijkpunt ' + datumTekst(L.ijkpunt && L.ijkpunt.datum) : 'stand Moneybird') + (L.verschil ? ` · verschil met Moneybird ${eur(L.verschil)}` : ''))}
    ${kaart('laagste', 'Laagste punt', low ? eur(low.saldo) : '—', low && (limiet != null ? low.saldo < -limiet * 0.9 : low.saldo < 0), low ? `${datumTekst(low.datum, true)} · komende ${st.zoom === 'week' ? '2 weken' : st.zoom}` : '')}
    ${st.modus === 'lopend' ? kaart('ruimte', 'Ruimte tot kredietlimiet', ruimte == null ? '—' : eur(ruimte), ruimte != null && ruimte < 0, limiet == null ? 'kredietlimiet nog niet ingesteld' : `limiet ${eur(-limiet)}`) : kaart('nu', 'Lopende rekening', eur(L.gerapporteerd), L.gerapporteerd < 0, 'zonder potjes')}
  </div>
  <div class="mtg-kaart">
    <div class="mtg-kop" style="margin:0 0 6px"><b style="flex:1">Verloop ${st.modus === 'totaal' ? 'totaal' : 'lopende rekening'}</b>
      <div class="mtg-knoppen">${Object.keys(ZOOM).map(z => `<button class="mtg-knop klein ${st.zoom === z ? 'aan' : ''}" data-zoom="${z}">${z}</button>`).join('')}
      ${st.offset ? '<button class="mtg-knop klein" data-terug="1">vandaag</button>' : ''}
      ${heeftProg ? `<button class="mtg-knop klein ${st.prognose ? 'aan' : ''}" data-prognose="1" title="Prognose meenemen">prognose</button>` : ''}
      <button class="mtg-vraag" data-uitleg="lijn">?</button></div></div>
    <div class="mtg-grafiek" id="mtg-grafiek"></div>
    <div class="mtg-legenda"><span><i></i>saldo</span><span><i style="border-top-style:dashed"></i>verwacht</span>${heeftProg ? '<span><i style="border-top:2px dotted #3a5a8a"></i>met prognose</span>' : ''}<span><i style="border-color:var(--mtg-uit)"></i>kredietlimiet</span>${st.modus === 'lopend' && st.cfg && st.cfg.lopend_streef && st.cfg.lopend_streef.datum ? '<span><i style="border-top:2px dashed var(--gold,#B8962E)"></i>doelpad</span>' : ''}<span class="mtg-in">▲ erbij</span><span class="mtg-uit">▼ eraf</span><span>⚑ mijlpaal</span></div>
  </div>
  <div class="mtg-kaart"><div class="mtg-kop" style="margin:0"><b style="flex:1">Komende 14 dagen</b><button class="mtg-vraag" data-uitleg="lijst">?</button></div>${lijstHtml()}</div>
  <div class="mtg-kaart"><div class="mtg-kop" style="margin:0"><b style="flex:1">Potjes en doelen</b><button class="mtg-vraag" data-uitleg="potjes">?</button></div>${potjesHtml()}</div>
  ${letOpHtml()}
  ${patronenHtml()}
  ${st.mag ? instellingenHtml() : ''}
</div>`;
    grafiek();
    st.el.querySelector('.mtg').addEventListener('click', klik);
    felicitatie();
  }
  // Mijlpaal gehaald (werkelijk saldo, niet de verwachting): eenmalig een korte felicitatie. Bij de eerste keer
  // openen tellen al gehaalde mijlpalen als gezien (geen stortvloed van felicitaties).
  function felicitatie() {
    const d = st.data, cfg = st.cfg || {}, rek = [['lopend', 'De lopende rekening', d.saldo.lopend.gerapporteerd, cfg.lopend_streef]]
      .concat((cfg.potten || []).filter(p => !p.virtueel && p.streef).map(p => [p.id, p.naam, (d.saldo.potten[p.id] || {}).gerapporteerd, p.streef]));
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
  function kaart(sleutel, titel, waarde, rood, sub) {
    return `<div class="mtg-k ${rood ? 'rood' : ''}"><div class="l"><span>${esc(titel)}</span><button class="mtg-vraag" data-uitleg="${sleutel}">?</button></div><div class="w">${esc(waarde)}</div><div class="s">${esc(sub || '')}</div></div>`;
  }
  // Lijst: vandaag t/m +14, inclusief achterstallig (staat op vandaag); zonder datum apart.
  function lijstHtml() {
    const d = st.data, eind = dagPlus(d.vandaag, 14);
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
      h += `<div class="mtg-rij" data-dag="${esc(e.datum)}"><span class="p mtg-uit">▼</span><span class="n">Weekinleg potjes: ${esc(l.map(x => x.tegenpartij || x.pot).join(', '))}</span><span class="mtg-chip">intern</span><span class="b mtg-uit">${eur(som)}</span></div>`;
    }
    if (zonder.length) h += `<div class="mtg-dag">zonder datum (niet in de lijn)</div>` + zonder.map(rijHtml).join('');
    return h;
  }
  function rijHtml(e) {
    const inn = e.delta > 0, chip = e.achterstallig ? '<span class="mtg-chip achter">achterstallig</span>' : e.zekerheid === 'prognose' ? '<span class="mtg-chip prog">prognose</span>' : e.intern ? '<span class="mtg-chip">intern</span>' : `<span class="mtg-chip">${esc(ZEKER[e.zekerheid] || e.zekerheid || '')}</span>`;
    return `<div class="mtg-rij" data-ev="${esc(e.id)}"><span class="p ${inn ? 'mtg-in' : 'mtg-uit'}">${inn ? '▲' : '▼'}</span><span class="n">${esc(e.tegenpartij || BRON[e.bron] || e.bron)}${e.termijn ? ` · termijn ${esc(e.termijn)}` : ''}</span>${chip}<span class="b ${inn ? 'mtg-in' : 'mtg-uit'}">${eur(e.delta != null ? e.delta : e.bedrag)}</span></div>`;
  }
  // Potjes: lopende rekening + elk potje (ook virtueel), met doel, balk en tempo.
  function potjesHtml() {
    const d = st.data, cfg = st.cfg || {}, rijen = [];
    const lopendStreef = cfg.lopend_streef || null;
    rijen.push(potRij('lopend', 'Lopende rekening', d.saldo.lopend.gerapporteerd, lopendStreef, G.tempo(d, 'lopend'), null));
    for (const p of (cfg.potten || [])) {
      const s = (d.saldo.potten || {})[p.id];
      const nu = p.virtueel ? virtueelSaldo(p, d.vandaag) : s ? s.gerapporteerd : null;
      rijen.push(potRij(p.id, p.naam + (p.actief === false ? ' (gearchiveerd)' : ''), nu, p.streef, p.virtueel ? (p.weekinleg ? rond(p.weekinleg * 52 / 12) : null) : G.tempo(d, p.id), p));
    }
    return rijen.join('') + (st.mag ? '<div style="margin-top:10px"><button class="mtg-knop" data-pot="nieuw">+ potje of doel toevoegen</button></div>' : '');
  }
  function virtueelSaldo(p, vandaag) {
    const s = p.streef && p.streef.start; if (!s || s.bedrag == null) return null;
    return rond(s.bedrag + (p.weekinleg || 0) * Math.max(0, Math.floor(dagenTussen(s.datum, vandaag) / 7)));
  }
  function potRij(id, naam, nu, streef, tempo, pot) {
    const v = G.voortgang(streef, nu, tempo, st.data.vandaag);
    const doelTekst = !streef ? (st.mag ? 'nog geen doel — tik om er een te geven' : 'geen doel') : streef.van != null && streef.tot != null ? `doel ${kort(streef.van)}–${kort(streef.tot)}` : `doel ${kort(streef.bedrag)}`;
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
    return `<div class="mtg-pot" ${st.mag ? `data-pot="${esc(id)}" style="cursor:pointer"` : ''}>
  <div class="r1"><b>${esc(naam)}</b><span class="${nu != null && nu < 0 ? 'mtg-uit' : ''}" style="font-weight:600">${nu == null ? 'saldo onbekend' : eur(nu)}</span><span class="mtg-chip">${esc(doelTekst)}${streef && streef.datum ? ' · ' + esc(datumTekst(streef.datum)) : ''}</span></div>
  ${v ? `<div class="mtg-balk" title="${v.pct}% van de weg vanaf het startpunt"><div style="width:${v.pct}%"></div></div>` : ''}
  <div class="r3">${esc([r3, extra].filter(Boolean).join(' · '))}</div></div>`;
  }
  function letOpHtml() {
    const w = st.data.waarschuwingen || [];
    if (!w.length) return '';
    return `<div class="mtg-kaart"><div class="mtg-kop" style="margin:0"><b style="flex:1">Let op (${w.length})</b><button class="mtg-vraag" data-uitleg="letop">?</button></div>
      <details><summary class="mtg-melding" style="cursor:pointer">tonen</summary><ul class="mtg-letop">${w.map(x => `<li>${esc(x.fout)}${x.rekening ? ` <span class="mtg-chip">${esc(x.rekening)}</span>` : ''}</li>`).join('')}</ul></details></div>`;
  }
  function patronenHtml() {
    const p = st.data.patronen; if (!p || !p.lijst.length) return '';
    const dagen = ['', 'ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
    return `<div class="mtg-kaart"><div class="mtg-kop" style="margin:0"><b style="flex:1">Vaste patronen (${p.aan} actief)</b><button class="mtg-vraag" data-uitleg="patronen">?</button></div>
      <details><summary class="mtg-melding" style="cursor:pointer">tonen</summary>${p.lijst.map(x => `<div class="mtg-rij" style="cursor:default"><span class="p ${x.richting === 'in' ? 'mtg-in' : 'mtg-uit'}">${x.richting === 'in' ? '▲' : '▼'}</span>
        <span class="n">${esc(x.tegenpartij)} <span class="mtg-chip">${x.frequentie === 'week' ? 'elke ' + dagen[x.weekdag] : 'rond de ' + (((x.dag + (x.verschuiving || 0) - 1) % 31) + 1) + 'e'}</span>${x.potje ? ' <span class="mtg-chip">potje</span>' : ''}</span>
        <span class="b">${eur(x.bedrag)}</span>${st.mag && !x.potje ? `<button class="mtg-knop klein ${x.aan ? 'aan' : ''}" data-patroon="${esc(x.id)}" data-aan="${x.aan ? 0 : 1}">${x.aan ? 'aan' : 'uit'}</button>` : ''}</div>`).join('')}</details></div>`;
  }
  function instellingenHtml() {
    const c = st.cfg || {}, b = c.btw || {};
    return `<div class="mtg-kaart"><details><summary style="cursor:pointer"><b>Instellingen</b> <span class="mtg-melding">kredietlimiet, BTW, klantgroepen</span></summary>
      <dl class="mtg-dl"><dt>Kredietlimiet</dt><dd>${c.kredietlimiet == null ? 'niet ingesteld' : eur(c.kredietlimiet)}</dd>
      <dt>BTW-sparen</dt><dd>${b.spaarpercentage ? Math.round(b.spaarpercentage * 10000) / 100 + '% naar ' + esc(b.spaarpot || '?') : 'uit'}</dd>
      <dt>BTW-aangifte</dt><dd>van ${esc(b.aangifte_van || 'lopend (aangenomen)')}${b.terugboeking_van ? ', terug uit ' + esc(b.terugboeking_van) : ''}</dd>
      <dt>Klantgroepen</dt><dd>${(c.klantgroepen || []).map(g => esc(g.naam) + (g.prefix ? ` (begint met "${esc(g.prefix)}")` : ` (${g.contact_ids.length} klanten)`)).join(', ') || 'geen'}</dd></dl>
      <div class="mtg-knoppen"><button class="mtg-knop" data-inst="algemeen">Kredietlimiet en BTW…</button><button class="mtg-knop" data-inst="groepen">Klantgroepen…</button></div></details></div>`;
  }

  // ── Grafiek (SVG) ────────────────────────────────────────────────────────────
  function grafiek() {
    const box = st.el.querySelector('#mtg-grafiek'); if (!box) return;
    const d = st.data, lijn = st.lijn, n = ZOOM[st.zoom];
    if (lijn.onbekend) { box.innerHTML = '<div class="mtg-melding">Saldo onbekend — ijk eerst de rekening (Potjes → tik op de rekening → saldo ijken).</div>'; return; }
    const vanD = dagPlus(d.vandaag, Math.round(-n * 0.25) + st.offset), totD = dagPlus(vanD, n);
    const pts = lijn.punten.filter(p => p.datum >= vanD && p.datum <= totD);
    if (pts.length < 2) { box.innerHTML = '<div class="mtg-melding">Geen gegevens voor deze periode.</div>'; return; }
    const W = Math.max(300, box.clientWidth || 600), H = box.clientWidth < 700 ? 200 : 240, pl = 46, pr = 8, pt = 10, pb = 22;
    const limiet = st.modus === 'lopend' && d.saldo.lopend.kredietlimiet != null ? -d.saldo.lopend.kredietlimiet : null;
    // de lijn zonder prognose als stippel-referentie wanneer prognose aan staat
    const zonder = st.prognose && (d.events || []).some(e => e.zekerheid === 'prognose') ? G.lijn(d, { modus: st.modus, prognose: false }).punten.filter(p => p.datum >= vanD && p.datum <= totD) : null;
    const waarden = pts.map(p => p.saldo).concat(zonder ? zonder.map(p => p.saldo) : [], limiet != null ? [limiet] : [], [0]);
    let lo = Math.min(...waarden), hi = Math.max(...waarden); if (hi - lo < 100) { hi += 50; lo -= 50; }
    const marge = (hi - lo) * 0.08; lo -= marge; hi += marge;
    const x = dd => pl + dagenTussen(vanD, dd) / n * (W - pl - pr), y = v => pt + (hi - v) / (hi - lo) * (H - pt - pb);
    const pad = l => l.map((p, i) => `${i ? 'L' : 'M'}${x(p.datum).toFixed(1)},${y(p.saldo).toFixed(1)}`).join('');
    const ver = pts.filter(p => p.datum <= d.vandaag), toek = pts.filter(p => p.datum >= d.vandaag);
    const ticks = [], stap = niceStap((hi - lo) / 4); for (let t = Math.ceil(lo / stap) * stap; t <= hi; t += stap) ticks.push(t);
    const maandStreep = []; for (let dd = vanD; dd <= totD; dd = dagPlus(dd, 1)) if (dd.endsWith('-01') || (n <= 31 && new Date(dd + 'T00:00:00Z').getUTCDay() === 1)) maandStreep.push(dd);
    // ▲▼: grootste bewegingen per dag (gepland én verleden)
    const perDag = {};
    for (const e of d.events || []) { if (!e.datum || e.datum < vanD || e.datum > totD || e.saldo_ijkpunt || !G.telt(e, { prognose: st.prognose })) continue; const ef = effect(e, st.modus); if (!ef) continue; const dd = e.bron !== 'bank' && e.datum < d.vandaag ? d.vandaag : e.datum; perDag[dd] = perDag[dd] || { in: 0, uit: 0 }; if (ef > 0) perDag[dd].in += ef; else perDag[dd].uit += ef; }
    const drempel = (hi - lo) * 0.04;
    const pijlen = Object.entries(perDag).flatMap(([dd, s]) => [s.in > drempel ? `<text x="${x(dd)}" y="${H - pb - 2}" text-anchor="middle" font-size="10" fill="var(--mtg-in)">▲</text>` : '', s.uit < -drempel ? `<text x="${x(dd)}" y="${pt + 9}" text-anchor="middle" font-size="10" fill="var(--mtg-uit)">▼</text>` : '']).join('');
    const vlaggen = mijlpaalVlaggen(vanD, totD, x, y);
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Verloop saldo">
      ${ticks.map(t => `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" stroke="#e8e6de" stroke-width="1"/><text x="${pl - 4}" y="${y(t) + 3}" text-anchor="end" font-size="10" fill="#8a8a80">${kort(t)}</text>`).join('')}
      ${maandStreep.map(dd => `<line x1="${x(dd)}" x2="${x(dd)}" y1="${pt}" y2="${H - pb}" stroke="#f0eee6"/><text x="${x(dd) + 2}" y="${H - 6}" font-size="10" fill="#8a8a80">${datumTekst(dd)}</text>`).join('')}
      ${lo < 0 && hi > 0 ? `<line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" stroke="#bbb" stroke-width="1"/>` : ''}
      ${limiet != null && limiet >= lo ? `<line x1="${pl}" x2="${W - pr}" y1="${y(limiet)}" y2="${y(limiet)}" stroke="var(--mtg-uit)" stroke-width="1.5"/><text x="${W - pr - 2}" y="${y(limiet) - 3}" text-anchor="end" font-size="10" fill="var(--mtg-uit)">kredietlimiet</text>` : ''}
      ${d.vandaag >= vanD && d.vandaag <= totD ? `<line x1="${x(d.vandaag)}" x2="${x(d.vandaag)}" y1="${pt}" y2="${H - pb}" stroke="var(--gold,#B8962E)" stroke-dasharray="3 3"/>` : ''}
      ${zonder ? `<path d="${pad(zonder.filter(p => p.datum >= d.vandaag))}" fill="none" stroke="#9aa7b8" stroke-width="1.5" stroke-dasharray="2 3"/>` : ''}
      ${ver.length > 1 ? `<path d="${pad(ver)}" fill="none" stroke="var(--mtg-lijn)" stroke-width="2"/>` : ''}
      ${toek.length > 1 ? `<path d="${pad(toek)}" fill="none" stroke="${zonder ? '#3a5a8a' : 'var(--mtg-lijn)'}" stroke-width="2" stroke-dasharray="${zonder ? '1 3' : '6 4'}"/>` : ''}
      ${pijlen}${vlaggen}
      <rect x="${pl}" y="0" width="${W - pl - pr}" height="${H}" fill="transparent" class="mtg-vang"/></svg><div class="mtg-tip" style="display:none"></div>`;
    st.geo = { vanD, n, W, pl, pr };
    gebaren(box);
  }
  function niceStap(r) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, r)))); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= r) || p * 10; }
  function mijlpaalVlaggen(vanD, totD, x, y) {
    if (st.modus !== 'lopend') return '';
    const streef = (st.cfg || {}).lopend_streef, m = G.mijlpalen(streef, 'lopend'), punten = st.lijn.punten;
    let h = '';
    for (const mp of m) {
      const p = punten.find(q => !q.verleden && q.datum >= st.data.vandaag && q.saldo >= mp && q.datum >= vanD && q.datum <= totD);
      if (p && st.data.saldo.lopend.gerapporteerd < mp) h += `<text x="${x(p.datum)}" y="${y(mp) - 4}" font-size="12" fill="var(--gold,#B8962E)">⚑</text>`;
    }
    if (streef && streef.datum && (streef.bedrag != null || streef.van != null)) {   // doelpad: stippellijn van nu naar het doel op de streefdatum
      const doel = streef.bedrag != null ? streef.bedrag : streef.van, nu = st.data.saldo.lopend.gerapporteerd;
      if (nu != null && streef.datum > st.data.vandaag) {
        const a = st.data.vandaag < vanD ? vanD : st.data.vandaag, b = streef.datum > totD ? totD : streef.datum, f = dd => nu + (doel - nu) * dagenTussen(st.data.vandaag, dd) / dagenTussen(st.data.vandaag, streef.datum);
        if (a < b) h += `<path d="M${x(a)},${y(f(a))}L${x(b)},${y(f(b))}" stroke="var(--gold,#B8962E)" stroke-width="1.5" stroke-dasharray="4 4" fill="none"/>`;
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
  function dagInfo(dd) {
    const ev = (st.data.events || []).filter(e => (e.datum === dd || (dd === st.data.vandaag && isGepland(e) && e.datum < dd)) && !e.saldo_ijkpunt && G.telt(e, { prognose: st.prognose }));
    const p = st.lijn.punten.find(q => q.datum === dd);
    blad(`<h3>${esc(datumTekst(dd, true))}</h3><div class="mtg-melding">Saldo ${dd < st.data.vandaag ? 'aan het eind van de dag' : 'verwacht'}: <b>${eur(p ? (p.saldo_gepland != null ? p.saldo_gepland : p.saldo) : null)}</b></div>
      ${ev.length ? ev.map(rijHtml).join('') : '<div class="mtg-melding">Geen bewegingen op deze dag.</div>'}`);
  }

  // ── Interactie ───────────────────────────────────────────────────────────────
  function klik(e) {
    const t = e.target.closest('[data-modus],[data-zoom],[data-terug],[data-prognose],[data-uitleg],[data-intro],[data-ev],[data-dag],[data-pot],[data-patroon],[data-inst]');
    if (!t) return;
    if (t.dataset.modus) { st.modus = t.dataset.modus; st.offset = 0; teken(); }
    else if (t.dataset.zoom) { st.zoom = t.dataset.zoom; ls.set('mtg:zoom:' + st.wie, st.zoom); begrens(); teken(); }
    else if (t.dataset.terug) { st.offset = 0; teken(); }
    else if (t.dataset.prognose) { st.prognose = !st.prognose; ls.set('mtg:prognose:' + st.wie, st.prognose ? '1' : '0'); teken(); }
    else if (t.dataset.uitleg) blad(`<h3>Uitleg</h3><div class="mtg-uitleg">${esc(UITLEG[t.dataset.uitleg] || '')}</div>`);
    else if (t.dataset.intro) { ls.set('mtg:intro:' + st.wie, t.dataset.intro === 'weg' ? 'weg' : ''); teken(); }
    else if (t.dataset.ev) eventDetail(t.dataset.ev);
    else if (t.dataset.dag) dagInfo(t.dataset.dag);
    else if (t.dataset.pot) potBlad(t.dataset.pot);
    else if (t.dataset.patroon) patroonZet(t.dataset.patroon, t.dataset.aan === '1');
    else if (t.dataset.inst === 'algemeen') instBlad();
    else if (t.dataset.inst === 'groepen') groepenBlad();
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
    return r;
  }
  function eventDetail(id) {
    const e = (st.data.events || []).find(x => x.id === id); if (!e) return;
    const v = e.verwacht, link0 = e.document_url || e.bron_url, link = /^https:\/\/moneybird\.com\//.test(String(link0 || '')) ? link0 : null;   // alleen Moneybird-links
    const factuur = (e.bron === 'inkoop' || e.bron === 'verkoop') && e.document_id;
    blad(`<h3>${esc(e.tegenpartij || BRON[e.bron] || '')}</h3>
      <dl class="mtg-dl"><dt>Bedrag</dt><dd class="${e.delta > 0 ? 'mtg-in' : 'mtg-uit'}"><b>${eur(e.delta, true)}</b>${e.marge ? ` <span class="mtg-chip">${eur(e.marge.min)} tot ${eur(e.marge.max)}</span>` : ''}</dd>
      <dt>Datum</dt><dd>${esc(datumTekst(e.datum, true))}${e.vervaldag && e.vervaldag !== e.datum ? ` <span class="mtg-chip">vervaldag ${esc(datumTekst(e.vervaldag))}</span>` : ''}</dd>
      ${e.datum_vroeg ? `<dt>Marge</dt><dd>${esc(datumTekst(e.datum_vroeg))} – ${esc(datumTekst(e.datum_laat))}</dd>` : ''}
      <dt>Bron</dt><dd>${esc(BRON[e.bron] || e.bron)}${e.referentie ? ' ' + esc(e.referentie) : ''}</dd>
      <dt>Zekerheid</dt><dd>${esc(ZEKER[e.zekerheid] || e.zekerheid)}${e.achterstallig ? ' · <span class="mtg-uit">achterstallig</span>' : ''}${e.intern ? ' · intern (potje ' + esc(e.pot) + ')' : ''}</dd></dl>
      <div class="mtg-uitleg"><b>Waarom deze datum?</b> ${esc(e.uitleg || '')}${v && v.n ? ` (gebaseerd op ${v.n} betaalde facturen)` : ''}</div>
      ${link ? `<p><a href="${esc(link)}" target="_blank" rel="noopener">Openen in Moneybird ↗</a></p>` : ''}
      ${st.mag && factuur ? `<div class="mtg-knoppen"><button class="mtg-knop" data-ov="datum">Andere datum…</button><button class="mtg-knop" data-ov="afbetaling">Afbetaling…</button>${e.override ? '<button class="mtg-knop" data-ov="wissen">Eigen afspraak wissen</button>' : ''}</div>` : ''}
      ${st.mag && e.patroon_id ? `<div class="mtg-knoppen"><button class="mtg-knop" data-pt="uit">Dit patroon niet meer meenemen</button></div>` : ''}`, o => {
      o.addEventListener('click', async ev => {
        const k = ev.target.closest('[data-ov],[data-pt]'); if (!k) return;
        if (k.dataset.pt) { o.remove(); return patroonZet(e.patroon_id, false); }
        o.remove(); overrideBlad(e, k.dataset.ov);
      });
    });
  }
  function overrideBlad(e, type) {
    const soort = e.bron, basis = { document_id: e.document_id, soort, vorige_ts: e.override ? e.override.ts : null };
    if (type === 'wissen') return opslaan(() => stuur('/geld/override', Object.assign(basis, { type: 'wissen' })), 'Eigen afspraak gewist');
    const o = blad(type === 'datum' ? `<h3>Andere betaaldatum</h3><div class="mtg-melding">Voor ${esc(e.tegenpartij)} (${eur(e.delta)}). Alleen in deze tool; er gaat niets naar Moneybird.</div>
      <label class="mtg-veld"><span>Datum</span><input type="date" name="datum" value="${esc(e.datum || '')}"></label><label class="mtg-veld"><span>Reden (optioneel)</span><input name="reden" maxlength="120"></label>
      <button class="mtg-knop aan" data-ok="1">Opslaan</button>`
      : `<h3>Afbetaling</h3><div class="mtg-melding">Open: ${eur(Math.abs(e.delta), true)}. De termijnen tellen samen precies op tot het open bedrag; de laatste termijn neemt de rest.</div>
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
    const o = blad(`<h3>${nieuw ? 'Nieuw potje of doel' : esc(p.naam)}</h3>
      ${lopend ? '' : `<label class="mtg-veld"><span>Naam</span><input name="naam" value="${esc(p.naam)}" maxlength="40"></label>
      <label class="mtg-veld"><span>Soort</span><select name="doel">${['buffer', 'winst', 'vakantie', 'btw', 'overig'].map(x => `<option ${p.doel === x ? 'selected' : ''} value="${x}">${{ buffer: 'buffer', winst: 'winstuitkering', vakantie: 'vakantiegeld', btw: 'BTW', overig: 'eigen doel' }[x]}</option>`).join('')}</select></label>
      ${nieuw ? `<label class="mtg-veld" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="virtueel" style="width:auto"> <span style="margin:0">Doel zonder eigen rekening (virtueel, bv. "machine-sparen" binnen de buffer) — telt niet mee in het totaal</span></label>` : ''}`}
      <label class="mtg-veld"><span>Doelbedrag (€) — of vul hieronder een bandbreedte in</span><input type="number" name="bedrag" value="${s.bedrag != null ? s.bedrag : ''}"></label>
      <div style="display:flex;gap:8px"><label class="mtg-veld" style="flex:1"><span>Van (€)</span><input type="number" name="van" value="${s.van != null ? s.van : ''}"></label><label class="mtg-veld" style="flex:1"><span>Tot (€)</span><input type="number" name="tot" value="${s.tot != null ? s.tot : ''}"></label></div>
      <label class="mtg-veld"><span>Streefdatum</span><input type="date" name="datum" value="${esc(s.datum || '')}"></label>
      <label class="mtg-veld"><span>Mijlpalen (€, komma-gescheiden; leeg = standaard)</span><input name="mijlpalen" value="${esc((s.mijlpalen || []).join(', '))}"></label>
      ${lopend ? '' : `<div style="display:flex;gap:8px"><label class="mtg-veld" style="flex:1"><span>Weekinleg (€)</span><input type="number" name="weekinleg" value="${p.weekinleg != null ? p.weekinleg : ''}"></label>
      <label class="mtg-veld" style="flex:1"><span>Op</span><select name="weekdag"><option value="">${p.weekdag ? '' : 'afleiden uit de bank'}</option>${[1, 2, 3, 4, 5, 6, 7].map(i => `<option value="${i}" ${p.weekdag === i ? 'selected' : ''}>${dagen[i]}</option>`).join('')}</select></label></div>
      <div class="pot-echt"><label class="mtg-veld"><span>Herkenning: tegenrekening van de overboekingen</span><input name="tegenrekening" list="mtg-kand" value="${esc(p.herkenning ? p.herkenning.tegenrekening : '')}"><datalist id="mtg-kand">${kand.map(k => `<option value="${esc(k.iban)}">${esc(k.naam)}</option>`).join('')}</datalist></label>
      ${kand.length ? `<div class="mtg-melding">Herkende overboekingen: ${kand.slice(0, 4).map(k => esc(k.naam + ' ' + k.iban)).join(' · ')}</div>` : ''}</div>
      ${!nieuw ? `<label class="mtg-veld" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="actief" style="width:auto" ${p.actief !== false ? 'checked' : ''}> <span style="margin:0">Actief (uitvinken = archiveren; het saldo blijft meetellen)</span></label>` : ''}`}
      <button class="mtg-knop aan" data-ok="1">Opslaan</button>
      ${!nieuw && !p.virtueel ? `<hr><b>Saldo ijken</b><div class="mtg-melding">Vul het echte banksaldo aan het eind van een dag in (uit de bank-app). Huidig: ${eur(saldo ? saldo.gerapporteerd : null, true)}${saldo && saldo.ijkpunt ? ', laatst geijkt ' + esc(datumTekst(saldo.ijkpunt.datum)) : ''}.</div>
      <div style="display:flex;gap:8px"><label class="mtg-veld" style="flex:1"><span>Saldo (€)</span><input type="number" step="0.01" name="ijk"></label><label class="mtg-veld" style="flex:1"><span>Eind van de dag</span><input type="date" name="ijkdatum" value="${esc(st.data.vandaag)}" max="${esc(st.data.vandaag)}"></label></div>
      <button class="mtg-knop" data-ijk="1">Saldo opslaan</button>` : ''}`);
    o.querySelector('[data-ok]').addEventListener('click', () => {
      const f = n => { const el = o.querySelector(`[name="${n}"]`); return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined; };
      const getal = n => f(n) === '' || f(n) == null ? null : Number(f(n));
      const nuSaldo = lopend ? st.data.saldo.lopend.gerapporteerd : saldo ? saldo.gerapporteerd : 0;
      const streef = (getal('bedrag') != null || getal('van') != null || f('datum')) ? { bedrag: getal('bedrag'), van: getal('van'), tot: getal('tot'), datum: f('datum') || null,
        mijlpalen: String(f('mijlpalen') || '').split(/[;,]\s*/).map(x => Number(x.replace(/[^\d.-]/g, ''))).filter(x => x === x && String(x) !== ''),
        start: s.start && (s.bedrag === getal('bedrag') && s.van === getal('van')) ? s.start : { datum: st.data.vandaag, bedrag: nuSaldo == null ? 0 : nuSaldo } } : null;
      if (streef && !(f('mijlpalen') || '').trim()) streef.mijlpalen = [];
      let body;
      if (lopend) body = { revisie: cfg.revisie, lopend_streef: streef };
      else {
        const potten = (cfg.potten || []).map(x => Object.assign({}, x));
        const nieuwId = nieuw ? (String(f('naam') || 'potje').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'potje') : id;
        let pid = nieuwId; for (let i = 2; nieuw && potten.some(x => x.id === pid); i++) pid = nieuwId + '-' + i;
        const pot = Object.assign(nieuw ? { id: /^[a-z]/.test(pid) ? pid : 'p-' + pid } : potten.find(x => x.id === id), { naam: f('naam') || p.naam, doel: f('doel') || p.doel, weekinleg: getal('weekinleg'), weekdag: f('weekdag') ? Number(f('weekdag')) : null, streef });
        if (!pot.virtueel && !(nieuw && f('virtueel'))) pot.herkenning = Object.assign({}, pot.herkenning || {}, { tegenrekening: f('tegenrekening') || '' });
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
      <label class="mtg-veld"><span>Kredietlimiet lopende rekening (€)</span><input type="number" name="kl" value="${c.kredietlimiet != null ? c.kredietlimiet : ''}"></label>
      <label class="mtg-veld"><span>BTW-sparen: percentage van elke ontvangst (bv. 17,36 = 21/121)</span><input type="number" step="0.01" name="pct" value="${b.spaarpercentage != null ? Math.round(b.spaarpercentage * 10000) / 100 : ''}"></label>
      <label class="mtg-veld"><span>BTW-sparen naar potje</span><select name="spaarpot"><option value="">—</option>${pot.map(p => `<option value="${esc(p.id)}" ${b.spaarpot === p.id ? 'selected' : ''}>${esc(p.naam)}</option>`).join('')}</select></label>
      <label class="mtg-veld"><span>BTW-aangifte betaald van</span><select name="van"><option value="lopend" ${b.aangifte_van !== 'lopend' && b.aangifte_van ? '' : 'selected'}>lopende rekening</option>${pot.map(p => `<option value="${esc(p.id)}" ${b.aangifte_van === p.id ? 'selected' : ''}>${esc(p.naam)}</option>`).join('')}</select></label>
      <label class="mtg-veld"><span>Zelfde dag terugboeken van</span><select name="terug"><option value="">niet</option>${pot.map(p => `<option value="${esc(p.id)}" ${b.terugboeking_van === p.id ? 'selected' : ''}>${esc(p.naam)}</option>`).join('')}</select></label>
      <button class="mtg-knop aan" data-ok="1">Opslaan</button>`);
    o.querySelector('[data-ok]').addEventListener('click', () => {
      const f = n => o.querySelector(`[name="${n}"]`).value;
      const body = { revisie: c.revisie, kredietlimiet: f('kl') === '' ? null : Number(f('kl')), btw: { spaarpercentage: f('pct') === '' ? null : Math.round(Number(String(f('pct')).replace(',', '.')) * 100) / 10000, spaarpot: f('spaarpot') || null, aangifte_van: f('van') || null, terugboeking_van: f('terug') || null } };
      o.remove(); opslaan(() => stuur('/geld/config', body), 'Opgeslagen');
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
