// mt-schulden.js — Schulden in Geld: aflosschema (annuïtair, lineair, aflossingsvrij, vrij), restschuld nu, nog te
// betalen rente en de rekenhulp "extra aflossen", in hele centen. Port van de door Codex nagekeken rekenregels uit
// LifeHub (services/schulden.ts): maandrente = rest × rente_bp / 120000 (nominaal), annuïteit één keer naar boven
// afgerond, laatste termijn begrensd op wat nog openstaat. Rente onbekend → geen prognose (0% alleen als expliciet
// ingevuld); aflossingsvrij lost nooit af; aanname bij extra aflossen: de termijn blijft gelijk, de looptijd wordt korter.
// Zakelijk extra: S.kasEffect laat zien wat een aflossing doet met de kasruimte (laagste punt komende 8 weken),
// met dezelfde tijdlijn-rekenregels als de Koersmeter. Algemene informatie, geen advies.
(function (root) {
  'use strict';
  const S = root.MTSchulden = root.MTSchulden || {};
  const MAX_MAANDEN = 1200, STAND_TE_OUD = 62, KAS_DAGEN = 56;
  S.MAX_MAANDEN = MAX_MAANDEN;
  S.VORMEN = [['annuiteit', 'annuïtair'], ['lineair', 'lineair'], ['aflossingsvrij', 'aflossingsvrij'], ['vrij', 'vrij (eigen aflossing)']];
  S.SOORTEN = [['hypotheek', 'hypotheek'], ['lening', 'lening'], ['krediet', 'krediet'], ['overig', 'overig']];
  S.INFO = 'Algemene informatie, geen advies. Check de boetevrije aflosruimte in je NEW10-contract en bespreek grote aflossingen met de accountant.';

  // ── Datum ──
  const pd = s => ({ j: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) });
  const dim = (j, m) => new Date(Date.UTC(j, m, 0)).getUTCDate();
  const fmt = (j, m, d) => `${j}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  S.plusMaanden = function (iso, n) { const a = pd(iso), t = a.j * 12 + (a.m - 1) + n, j = Math.floor(t / 12), m = t - j * 12 + 1; return fmt(j, m, Math.min(a.d, dim(j, m))); };
  S.heleMaandenTussen = function (van, tot) { const a = pd(van), b = pd(tot); let n = (b.j - a.j) * 12 + (b.m - a.m); if (n > 0 && S.plusMaanden(van, n) > tot) n -= 1; return Math.max(0, n); };
  const dagPlus = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const dagenTussen = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

  // ── Invoer: "1.234,56" / "1234.5" / "€ 12" → hele centen, zonder floats; "4,46" → 446 basispunten ──
  S.centUit = function (invoer) {
    const ruw = String(invoer == null ? '' : invoer).replace(/[€\s]/g, '');
    if (ruw === '' || /[^0-9.,]/.test(ruw)) return null;
    let t = ruw;
    // Nederlands: punten als duizendtallen ("1.000", "10.000", "1.234.567"); een komma is het decimaalteken.
    if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    else t = t.replace(',', '.');
    if ((t.match(/\./g) || []).length > 1) return null;
    const [geheel, deel = ''] = t.split('.');
    if (geheel === '' && deel === '') return null;
    const c = Number(geheel || '0') * 100 + Number((deel + '00').slice(0, 2));
    return Number.isFinite(c) ? c : null;
  };
  S.bpUit = S.centUit;

  // ── Aflosschema ──
  S.maandRenteCent = (rest, bp) => Math.round(rest * bp / 120000);
  S.annuiteitBetalingCent = function (hoofdsom, bp, maanden) {
    if (maanden <= 0 || hoofdsom <= 0) return 0;
    if (bp === 0) return Math.ceil(hoofdsom / maanden);
    const r = bp / 120000;
    return Math.ceil(hoofdsom * r / (1 - Math.pow(1 + r, -maanden)) - 1e-6);   // marge tegen floating point net boven een hele cent
  };
  // invoer: { restCent, renteBp (undefined = onbekend), aflosvorm, maandlastCent, aflossingCent }; extraCent per maand bovenop de aflossing.
  S.aflosschema = function (inv, extraCent) {
    const extra = Math.max(0, Math.round(extraCent || 0)), rest0 = inv.restCent;
    if (rest0 <= 0) return { regels: [], afgelost: true, heeftSchema: true };
    if (inv.aflosvorm === 'aflossingsvrij') return { regels: [], afgelost: false, heeftSchema: false, geenSchemaReden: 'aflossingsvrij' };
    let modus = null;
    if (inv.aflosvorm === 'annuiteit') modus = inv.maandlastCent > 0 ? 'annuiteit' : null;
    else if (inv.aflosvorm === 'lineair') modus = inv.aflossingCent > 0 ? 'lineair' : null;
    else if (inv.aflossingCent > 0) modus = 'lineair';
    else if (inv.maandlastCent > 0) modus = 'annuiteit';
    if (modus === null) { if (extra > 0) modus = 'lineair'; else return { regels: [], afgelost: false, heeftSchema: false, geenSchemaReden: 'geen-betaling' }; }
    if (inv.renteBp === undefined || inv.renteBp === null) return { regels: [], afgelost: false, heeftSchema: false, geenSchemaReden: 'rente-onbekend' };
    const bp = inv.renteBp, regels = [];
    let rest = rest0;
    for (let maand = 1; maand <= MAX_MAANDEN && rest > 0; maand++) {
      const rente = S.maandRenteCent(rest, bp);
      let afl = modus === 'annuiteit' ? (inv.maandlastCent || 0) - rente + extra : (inv.aflossingCent || 0) + extra;
      if (afl <= 0) return { regels, afgelost: false, heeftSchema: true };            // betaling dekt de rente niet
      afl = Math.min(afl, rest); rest -= afl;
      regels.push({ maand, renteCent: rente, aflossingCent: afl, restCent: rest });
    }
    return { regels, afgelost: rest === 0, heeftSchema: true };
  };
  // Lening uit geld:config → invoer. Ontbrekende betaling aanvullen uit de einddatum (annuïtair: vaste betaling die
  // precies op de einddatum klaar is; lineair: gelijke aflossing). Lineair met alleen een termijn: eerste maand rente eraf.
  S.invoerUit = function (s) {
    const inv = { restCent: s.restschuld_cent, renteBp: s.rente_bp == null ? undefined : s.rente_bp, aflosvorm: s.vorm,
      maandlastCent: s.maandtermijn_cent == null ? undefined : s.maandtermijn_cent, aflossingCent: s.aflossing_cent == null ? undefined : s.aflossing_cent };
    const n = s.einde ? S.heleMaandenTussen(s.stand_datum, s.einde) : 0;
    if (n > 0) {
      if (s.vorm === 'annuiteit' && !inv.maandlastCent) inv.maandlastCent = S.annuiteitBetalingCent(s.restschuld_cent, inv.renteBp == null ? 0 : inv.renteBp, n);
      else if (s.vorm === 'lineair' && !inv.aflossingCent && !inv.maandlastCent) inv.aflossingCent = Math.ceil(s.restschuld_cent / n);
    }
    if (inv.aflosvorm === 'lineair' && !inv.aflossingCent && inv.maandlastCent) { const a = inv.maandlastCent - S.maandRenteCent(inv.restCent, inv.renteBp == null ? 0 : inv.renteBp); if (a > 0) inv.aflossingCent = a; }
    return inv;
  };
  // Restschuld nu (de stand min de aflossingen sinds de stand volgens het schema: een schatting), einde, nog te betalen rente, verloop.
  S.analyse = function (s, vandaag) {
    const inv = S.invoerUit(s), sch = S.aflosschema(inv);
    const k = Math.min(S.heleMaandenTussen(s.stand_datum, vandaag), sch.heeftSchema ? MAX_MAANDEN : 0);
    const gedaan = sch.regels.slice(0, k);
    const restNu = k === 0 || !sch.heeftSchema ? s.restschuld_cent : gedaan.length < k ? 0 : gedaan[k - 1].restCent;
    const toekomst = sch.regels.slice(k), klaar = sch.heeftSchema && sch.afgelost;
    const eindSchema = klaar ? S.plusMaanden(s.stand_datum, sch.regels.length) : null;
    const volgende = toekomst[0], verloop = [{ maand: 0, restCent: restNu }];
    if (klaar) toekomst.forEach((r, i) => verloop.push({ maand: i + 1, restCent: r.restCent }));
    return { standCent: s.restschuld_cent, standDatum: s.stand_datum, restNuCent: restNu, isSchatting: sch.heeftSchema && k > 0, verstreken: k,
      heeftSchema: sch.heeftSchema, loopAf: sch.heeftSchema ? sch.afgelost : false, geenSchemaReden: sch.geenSchemaReden || null,
      renteOnbekend: s.rente_bp == null && s.vorm !== 'aflossingsvrij' && s.restschuld_cent > 0, aflossingsvrij: s.vorm === 'aflossingsvrij',
      einde: eindSchema || s.einde || null, eindeBron: eindSchema ? 'schema' : s.einde ? 'opgegeven' : null,
      maandenResterend: klaar ? toekomst.length : null, renteResterendCent: klaar && s.rente_bp != null ? toekomst.reduce((a, r) => a + r.renteCent, 0) : null,
      volgende: volgende ? { renteCent: volgende.renteCent, aflossingCent: volgende.aflossingCent } : null, verloop,
      standOud: !sch.heeftSchema && dagenTussen(s.stand_datum, vandaag) > STAND_TE_OUD, invoer: Object.assign({}, inv, { restCent: restNu }) };
  };
  // Rekenhulp: met en zonder extra (per maand en/of eenmalig, gerekend vanaf de restschuld nu). Zonder schema dat afloopt
  // (ook bij onbekende rente of aflossingsvrij) is er niets te vergelijken.
  S.extraAflossen = function (inv, opt) {
    const per = Math.max(0, Math.round((opt && opt.perMaandCent) || 0)), een = Math.max(0, Math.round((opt && opt.eenmaligCent) || 0));
    const leeg = { mogelijk: false, maandenZonder: null, maandenMet: null, maandenEerder: null, renteBespaardCent: null, renteZonderCent: null, renteMetCent: null };
    if (!(per > 0 || een > 0) || inv.restCent <= 0) return leeg;
    const zonder = S.aflosschema(inv, 0); if (!zonder.heeftSchema || !zonder.afgelost) return Object.assign(leeg, { reden: zonder.geenSchemaReden || (zonder.heeftSchema ? 'loopt-niet-af' : null) });
    const met = S.aflosschema(Object.assign({}, inv, { restCent: Math.max(0, inv.restCent - een) }), per); if (!met.afgelost) return leeg;
    const som = s => s.regels.reduce((a, r) => a + r.renteCent, 0);
    return { mogelijk: true, maandenZonder: zonder.regels.length, maandenMet: met.regels.length, maandenEerder: zonder.regels.length - met.regels.length,
      renteBespaardCent: som(zonder) - som(met), renteZonderCent: som(zonder), renteMetCent: som(met), eenmaligAlles: een >= inv.restCent };
  };

  // ── Zakelijk: effect op de kasruimte (laagste punt lopend + BTW-pot komende 56 dagen, incl. prognose) ──
  // opt: { eenmaligCent, perMaandCent, datum } — eenmalig op `datum`, per maand vanaf `datum` elke maand. G = MTGeld.
  S.kasEffect = function (data, cfg, opt, G) {
    G = G || root.MTGeld;
    const v = data.vandaag, tot = dagPlus(v, KAS_DAGEN), start = opt.datum && opt.datum > v ? opt.datum : v;
    const ruimte = d => { const lijn = G.lijn(d, { modus: 'lopend', prognose: true }); if (lijn.onbekend) return null; const low = G.laagste(lijn, tot); if (!low) return null;
      const g = G.drempel(d, cfg, low.datum); return { datum: low.datum, saldo: low.saldo, grens: g == null ? 0 : g, ruimte: Math.round((low.saldo - (g == null ? 0 : g)) * 100) / 100 }; };
    const ev = [], uit = (d, c, i) => ev.push({ id: 'scenario:aflossen:' + i, bron: 'scenario', datum: d, delta: -c / 100, rekening: 'lopend', zekerheid: 'gepland', tegenpartij: 'extra aflossing (rekenhulp)' });
    if (opt.eenmaligCent > 0) uit(start, opt.eenmaligCent, 'e');
    if (opt.perMaandCent > 0) for (let i = 0; i < 3; i++) { const d = S.plusMaanden(start, i); if (d > tot) break; uit(d, opt.perMaandCent, i); }
    const voor = ruimte(data); if (!voor) return null;
    const na = ruimte(Object.assign({}, data, { events: (data.events || []).concat(ev) }));
    return { voor, na, verschil: Math.round((na.ruimte - voor.ruimte) * 100) / 100, binnen: ev.some(e => e.datum <= tot), start, tot,
      onderGrens: na.ruimte < 0, wasOnder: voor.ruimte < 0, onderLimiet: data.saldo && data.saldo.lopend && data.saldo.lopend.kredietlimiet != null && na.saldo < -data.saldo.lopend.kredietlimiet };
  };

  // ── Weergave ──
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eurC = (c, dec) => c == null ? '—' : (c < 0 ? '−' : '') + '€ ' + (Math.abs(c) / 100).toLocaleString('nl-NL', { minimumFractionDigits: dec ? 2 : 0, maximumFractionDigits: dec ? 2 : 0 });
  const eur = n => n == null ? '—' : (n < 0 ? '−' : '') + '€ ' + Math.round(Math.abs(n)).toLocaleString('nl-NL');
  const MND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const datum = d => d ? `${Number(d.slice(8, 10))} ${MND[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : '—';
  const pct = bp => (bp / 100).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  const looptijd = n => n == null ? '—' : n >= 12 ? `${Math.floor(n / 12)} jaar${n % 12 ? ' en ' + (n % 12) + ' mnd' : ''}` : `${n} mnd`;
  S._eurC = eurC; S._looptijd = looptijd;
  S.css = function () {
    if (!root.document || document.getElementById('mts-css')) return;
    const s = document.createElement('style'); s.id = 'mts-css';
    s.textContent = `
.mts-lening{border-top:1px solid var(--border,#eee);padding:8px 0}
.mts-lening:first-of-type{border-top:0}
.mts-kop{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.mts-kop b{font-size:15px}
.mts-cijfers{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:4px 12px;margin-top:4px;font-size:13px}
.mts-cijfers span{display:block;font-size:11px;color:var(--mtg-zacht,#8a8a80)}
.mts-grafiek svg{display:block;width:100%;height:56px}
.mts-hulp{background:var(--gold-50,#FBF5E0);border:1px solid var(--gold-mid,#E8D48A);border-radius:8px;padding:10px 12px;margin-top:8px}
.mts-hulp .rij{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}
.mts-hulp label{display:flex;flex-direction:column;font-size:12px;gap:2px;flex:1 1 130px}
.mts-hulp input,.mts-hulp select{font:inherit;font-size:15px;padding:6px 8px;min-height:44px;border:1px solid var(--border,#ddd);border-radius:6px;max-width:100%}
.mts-uit{margin-top:8px;font-size:14px;line-height:1.5}
.mts-kas{margin-top:6px;font-size:13px;padding:6px 8px;border-radius:6px;background:#fff;border-left:4px solid #8c96a0}
.mts-kas.rood{border-left-color:#B4412F}.mts-kas.oranje{border-left-color:#b7791f}
`;
    document.head.appendChild(s);
  };
  function grafiekSvg(a) {
    const v = a.verloop; if (v.length < 2) return '';
    const n = v.length - 1, max = v[0].restCent || 1, stap = Math.max(1, Math.ceil(n / 120)), pts = [];
    for (let i = 0; i <= n; i += stap) pts.push(v[i]); if (pts[pts.length - 1] !== v[n]) pts.push(v[n]);
    const x = m => 4 + m / n * 292, y = c => 6 + (1 - c / max) * 44;
    return `<div class="mts-grafiek" aria-hidden="true"><svg viewBox="0 0 300 56" preserveAspectRatio="none"><path d="M${pts.map(p => `${x(p.maand).toFixed(1)},${y(p.restCent).toFixed(1)}`).join(' L')}" fill="none" stroke="#2A4A38" stroke-width="2" vector-effect="non-scaling-stroke"/><line x1="4" x2="296" y1="50" y2="50" stroke="#ddd"/></svg></div>`;
  }
  S.leningHtml = function (s, a) {
    const vorm = (S.VORMEN.find(x => x[0] === s.vorm) || [0, s.vorm])[1];
    const termijn = a.volgende ? `${eurC(a.volgende.renteCent + a.volgende.aflossingCent)} <span style="display:inline;font-size:11px">(rente ${eurC(a.volgende.renteCent)} + aflossing ${eurC(a.volgende.aflossingCent)})</span>`
      : s.maandtermijn_cent != null ? eurC(s.maandtermijn_cent) : '—';
    const opm = [a.renteOnbekend ? 'Rente onbekend: geen prognose van restschuld, einddatum of rente (0% alleen als je dat invult).' : '',
      a.aflossingsvrij ? 'Aflossingsvrij: de termijn is rente en lost niets af; de restschuld blijft staan.' : '',
      a.heeftSchema && !a.loopAf ? 'De termijn dekt de rente niet: de schuld loopt zo niet af.' : '',
      !a.heeftSchema && a.geenSchemaReden === 'geen-betaling' ? 'Geen termijn of aflossing ingevuld: geen schema.' : '',
      a.standOud ? `De stand is van ${datum(s.stand_datum)}: werk hem bij (zonder schema rekenen we niets af).` : ''].filter(Boolean);
    return `<div class="mts-lening"><div class="mts-kop"><b>${esc(s.naam)}</b><span class="mtg-chip">${esc(s.soort)}</span><span class="mtg-chip">${esc(vorm)}</span></div>
      <div class="mts-cijfers"><div><span>Restschuld nu${a.isSchatting ? ' (schatting)' : ''}</span>${eurC(a.restNuCent)}</div><div><span>Rente</span>${s.rente_bp == null ? 'onbekend' : pct(s.rente_bp)}</div>
        <div><span>Termijn per maand</span>${termijn}</div><div><span>Einde${a.eindeBron === 'opgegeven' ? ' (opgegeven)' : ''}</span>${datum(a.einde)}${a.maandenResterend != null ? ` · nog ${looptijd(a.maandenResterend)}` : ''}</div>
        <div><span>Nog te betalen rente</span>${a.renteResterendCent == null ? '—' : eurC(a.renteResterendCent)}</div></div>
      ${grafiekSvg(a)}
      <div class="mtg-melding" style="font-size:12px">Stand ${eurC(a.standCent)} op ${datum(s.stand_datum)}${a.isSchatting ? `; daarna ${a.verstreken} maand${a.verstreken === 1 ? '' : 'en'} afgelost volgens het schema` : ''}.</div>
      ${opm.map(o => `<div class="mtg-melding" style="font-size:12px">${esc(o)}</div>`).join('')}</div>`;
  };
  // Uitkomst van de rekenhulp (tekst), met het kas-effect. h = { id, perMaand, eenmalig, datum } (invoer als tekst).
  S.uitkomstHtml = function (s, a, h, kas) {
    const per = S.centUit(h.perMaand) || 0, een = S.centUit(h.eenmalig) || 0;
    if (!(per > 0 || een > 0)) return '<div class="mts-uit mtg-melding">Vul een extra bedrag per maand of een eenmalig bedrag in.</div>';
    const r = S.extraAflossen(a.invoer, { perMaandCent: per, eenmaligCent: een });
    const wat = [per > 0 ? `${eurC(per)} per maand` : '', een > 0 ? `eenmalig ${eurC(een)}` : ''].filter(Boolean).join(' en ');
    let t;
    if (r.mogelijk) {
      const eind = r.maandenMet === 0 ? null : S.plusMaanden(h.vandaag, r.maandenMet);
      t = r.eenmaligAlles ? `Extra aflossen: ${wat} → de lening is in één keer afgelost; ${eurC(r.renteBespaardCent)} rente bespaard.`
        : `Extra aflossen: ${wat} → <b>${r.maandenEerder ? `${r.maandenEerder} maand${r.maandenEerder === 1 ? '' : 'en'} eerder klaar` : 'nog geen hele maand eerder klaar'}</b>${eind ? ` (rond ${datum(eind)})` : ''}, <b>${eurC(r.renteBespaardCent)} rente bespaard</b>.`;
      t += ` <span class="mtg-melding" style="font-size:12px">Aanname: de termijn blijft gelijk en de looptijd wordt korter${een > 0 ? '; het eenmalige bedrag gerekend alsof het nu wordt afgelost' : ''}. Verlaagt de bank juist de termijn, dan klopt dit niet.</span>`;
    } else t = a.renteOnbekend ? 'Rente onbekend: niets uit te rekenen. Vul de rente in (of expliciet 0).' : a.aflossingsvrij ? 'Aflossingsvrij: zonder vast aflosschema is er geen "eerder klaar" te berekenen.' : 'Geen aflosschema dat afloopt: niets te vergelijken.';
    let k = '';
    if (kas) {
      const kl = kas.onderGrens ? 'rood' : kas.verschil < 0 ? 'oranje' : '';
      k = !kas.binnen ? `<div class="mts-kas">De ${per > 0 ? 'eerste ' : ''}betaling valt na de komende 8 weken: geen effect op de kasruimte in die periode. Kijk in de grafiek verder vooruit.</div>`
        : `<div class="mts-kas ${kl}">Dit verlaagt de kasruimte (laagste punt komende 8 weken) met <b>${eur(-kas.verschil)}</b>: van ${eur(kas.voor.ruimte)} naar ${eur(kas.na.ruimte)} op ${datum(kas.na.datum)}.${kas.onderGrens && !kas.wasOnder ? ' <b>Daarmee zakt de kas onder je ondergrens.</b>' : kas.onderGrens ? ' De kas zit dan (nog dieper) onder je ondergrens.' : ''}${kas.onderLimiet ? ' Ook onder de kredietlimiet.' : ''}</div>`;
    } else k = '<div class="mts-kas">Kasruimte niet te berekenen (saldo onbekend).</div>';
    return `<div class="mts-uit">${t}</div>${k}`;
  };
})(typeof window !== 'undefined' ? window : globalThis);
