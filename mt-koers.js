// mt-koers.js — Koersmeter (variant A) bovenaan Geld: één eerlijk oordeel plus drie getallen, altijd per boekjaar.
// 1. Kasruimte 8 weken: laagste stand van lopend + BTW-pot in de komende 56 dagen (incl. aangevinkte prognoses)
//    t.o.v. de eigen ondergrens. 2. Brutomarge boekjaar t/m de laatste afgesloten maand t.o.v. vorig boekjaar over
//    dezelfde maanden en de branche (CBS). 3. Omzet op 31-12 (schatting): gefactureerd + aangevinkte prognosetermijnen
//    t.o.v. het hele vorige boekjaar. Oordeel = de slechtste kleur; een onvolledige bron geeft "Oordeel onbetrouwbaar",
//    nooit groen. Een betrouwbaar rood blijft rood, ook als een andere bron onvolledig is.
// K.oordeel(invoer) is puur (los te testen) en serialiseerbaar: K.dagfoto() is de basis voor een latere ochtendmelding.
(function (root) {
  'use strict';
  const K = root.MTKoers = root.MTKoers || {};
  const BTW = 1.21, KAS_DAGEN = 56, KAS_BUFFER = 10000, MARGE_PP = 5, OMZET_ORANJE = 0.85, DUN = 3;
  K.DREMPELS = { KAS_DAGEN, KAS_BUFFER, MARGE_PP, OMZET_ORANJE, DUN };
  const MND = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const ORDE = { groen: 0, oranje: 1, rood: 2 };
  const TITEL = { groen: 'Op koers', oranje: 'Opletten', rood: 'Alle zeilen bijzetten', onbetrouwbaar: 'Oordeel onbetrouwbaar' };
  K.TITEL = TITEL;
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kort = n => { if (n == null || !isFinite(n)) return '—'; const a = Math.abs(n), t = n < 0 ? '−' : ''; return t + '€ ' + (a >= 1e6 ? (a / 1e6).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + 'M' : a >= 1e4 ? Math.round(a / 1e3) + 'k' : a >= 1e3 ? (a / 1e3).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + 'k' : Math.round(a)); };
  const pct = n => n == null || !isFinite(n) ? '—' : n.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const pp = n => Math.abs(n).toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const datum = d => d ? `${Number(d.slice(8, 10))} ${MND[Number(d.slice(5, 7)) - 1]}` : '';
  const mndKort = n => MND[n - 1];
  const ym = (j, m) => `${j}-${String(m).padStart(2, '0')}`;
  const dagPlus = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  K._kort = kort;

  // ── Bronnen: wat maakt een oordeel onbetrouwbaar ──
  // Waarschuwingen van de routes die betekenen dat er gegevens ontbreken (niet: echte signalen zoals een BTW-tekort).
  const ONVOLLEDIG = /niet te lezen|niet alle|onvolledig|nog niet berekend|niet gebruikt|onbekend|niet meegenomen, opnieuw ijken|niet direct gelezen|kan dubbel staan|te veel moneybird/i;
  const druk = x => x.status === 429 || /\b429\b|retry later|even druk/i.test(x.fout || '');
  K.onvolledig = (w, bron) => (w || []).filter(x => (!bron || x.bron === bron) && (druk(x) || ONVOLLEDIG.test(x.fout || ''))).map(x => String(x.fout || 'onbekende fout'));

  // ── Invoer bouwen uit de geldtijdlijn (+ config) en /geld/cijfers ──
  // G = MTGeld (lijn, laagste, drempel, vasteLastenMaand, reserveCfg). cijfers = { r: antwoord /geld/cijfers, laden, fout }.
  K.invoer = function (data, cfg, cijfers, G) {
    G = G || root.MTGeld;
    const v = data.vandaag, jaar = Number(v.slice(0, 4)), vj = jaar - 1, mnd = Number(v.slice(5, 7)), tm = mnd - 1;
    // a. kas
    const tot = dagPlus(v, KAS_DAGEN), lijn = G.lijn(data, { modus: 'lopend', prognose: true });
    const low = lijn.onbekend ? null : G.laagste(lijn, tot);
    const heeftProg = (data.events || []).some(e => e.zekerheid === 'prognose');
    const zonder = heeftProg && low ? G.laagste(G.lijn(data, { modus: 'lopend', prognose: false }), tot) : null;
    const L = (data.saldo && data.saldo.lopend) || {}, res = G.reserveCfg(data, cfg);
    const soort = cfg && cfg.buffer_lopend != null ? 'ondergrens' : res && res.bedrag > 0 ? 'reserve' : L.kredietlimiet != null ? 'kredietlimiet' : null;
    const W = data.waarschuwingen || [];
    const kas = { laagste: low, zonderPrognose: zonder, ondergrens: low ? G.drempel(data, cfg, low.datum) : null, soort, kredietlimiet: L.kredietlimiet != null ? L.kredietlimiet : null,
      vasteLasten: G.vasteLastenMaand(data), onvolledig: K.onvolledig(W).filter((x, i, a) => a.indexOf(x) === i) };
    // b + c: cijfers (per maand, `maanden` > 0 = er is een record)
    const r = cijfers && cijfers.r, per = new Map(((r && r.perioden) || []).map(m => [m.id, m]));
    const heeft = id => { const m = per.get(id); return !!(m && m.maanden); };
    const som = ids => ids.reduce((P, id) => { const m = per.get(id) || {}, k = m.kosten || {}; P.omzet += m.omzet || 0; P.inkoop += (k.materiaal || 0) + (k.uitbesteed || 0); return P; }, { omzet: 0, inkoop: 0 });
    const reeks = (j, van, totM) => Array.from({ length: Math.max(0, totM - van + 1) }, (_, i) => ym(j, van + i));
    const cijferFout = !cijfers || cijfers.laden ? null : cijfers.fout ? 'cijfers niet geladen: ' + cijfers.fout : !r ? 'cijfers niet geladen' : null;
    const cijferW = r ? K.onvolledig(r.waarschuwingen) : [];
    const mist = ids => ids.filter(id => !heeft(id));
    const maandTekst = ids => ids.map(id => `${mndKort(Number(id.slice(5, 7)))} ${id.slice(0, 4)}`).join(', ');
    const lijst = (...x) => x.filter(Boolean);
    const dicht = reeks(jaar, 1, tm), dichtVj = reeks(vj, 1, tm), alles = reeks(jaar, 1, mnd), heelVj = reeks(vj, 1, 12);
    const md = r ? mist(dicht.concat(dichtVj)) : [], mo = r ? mist(alles.concat(heelVj)) : [];
    const marge = { tm, laden: !!(cijfers && cijfers.laden), dit: null, vorig: null, branche: (r && r.benchmarks && r.benchmarks.brutomarge) || null,
      onvolledig: lijst(cijferFout, ...cijferW, md.length && 'maanden ontbreken in de cijfers: ' + maandTekst(md)) };
    const pctVan = P => P.omzet > 0 ? (P.omzet - P.inkoop) / P.omzet * 100 : null;
    if (r && tm > 0) { const A = som(dicht), B = som(dichtVj); marge.dit = { omzet: A.omzet, pct: pctVan(A) }; marge.vorig = B.omzet > 0 ? { omzet: B.omzet, pct: pctVan(B) } : null; }
    // c. omzet: gefactureerd dit boekjaar (incl. de lopende maand) + nog open, aangevinkte prognosetermijnen tot 31-12 (÷ 1,21)
    const eind = `${jaar}-12-31`, termijnen = (data.events || []).filter(e => e.bron === 'prognose' && e.termijn_id && e.factuurdatum && e.factuurdatum <= eind);
    const omzet = { laden: marge.laden, gerealiseerd: r ? som(alles).omzet : null, prognose: termijnen.reduce((a, e) => a + (e.bedrag != null ? e.bedrag : Math.max(0, e.delta || 0)), 0) / BTW,
      termijnen: termijnen.length, vorigJaar: r ? som(heelVj).omzet : null,
      onvolledig: lijst(cijferFout, ...cijferW, mo.length && 'maanden ontbreken in de cijfers: ' + maandTekst(mo), ...K.onvolledig(W, 'prognose')) };
    return { vandaag: v, jaar, kas, marge, omzet };
  };

  // ── De drie meters ──
  function kasMeter(k) {
    const m = { id: 'kas', titel: 'Kasruimte 8 weken', kleur: 'onbekend', waarde: '—', sub: [], waarom: [], getal: null,
      bron: 'Geldtijdlijn: banksaldo (Moneybird/ijkpunt), open facturen, vaste patronen, BTW en de aangevinkte prognosetermijnen.' };
    const buffer = k && k.vasteLasten > 0 ? k.vasteLasten : KAS_BUFFER, grensNaam = !k || !k.soort ? 'nullijn' : k.soort === 'ondergrens' ? 'eigen ondergrens' : k.soort === 'reserve' ? 'onderkant eigen reserve' : 'kredietlimiet';
    m.uitleg = `De laagste stand van de lopende rekening + BTW-pot in de komende ${KAS_DAGEN} dagen, met alles wat gepland staat (facturen, vaste lasten, BTW) en de aangevinkte prognosetermijnen. Vergeleken met je ${grensNaam}. Groen: minstens ${k && k.vasteLasten > 0 ? 'één maand vaste lasten (' + kort(buffer) + ')' : kort(KAS_BUFFER) + ' (vaste lasten nog onbekend)'} boven de grens. Oranje: erboven, maar minder dan dat. Rood: eronder.`;
    if (!k || !k.laagste) { m.waarom.push('geen saldo of verwachte lijn: de lopende rekening is (nog) onbekend'); return m; }
    const grens = k.ondergrens != null ? k.ondergrens : 0, ruimte = k.laagste.saldo - grens;
    m.getal = Math.round(ruimte); m.datum = k.laagste.datum; m.grensNaam = grensNaam;
    m.waarde = (ruimte < 0 ? '' : '+') + kort(ruimte);
    m.sub.push(`laagste punt ${kort(k.laagste.saldo)} op ${datum(k.laagste.datum)} · ${grensNaam} ${kort(grens)}`);
    if (k.ondergrens == null) m.sub.push('geen ondergrens ingesteld: gerekend vanaf € 0');
    if (k.kredietlimiet != null && k.laagste.saldo < -k.kredietlimiet) m.sub.push(`onder de kredietlimiet (${kort(-k.kredietlimiet)})`);
    if (k.zonderPrognose && Math.round(k.zonderPrognose.saldo) !== Math.round(k.laagste.saldo)) m.sub.push(`zonder prognose: ruimte ${kort(k.zonderPrognose.saldo - grens)} op ${datum(k.zonderPrognose.datum)}`);
    if (k.onvolledig && k.onvolledig.length) { m.waarom.push(...k.onvolledig); return m; }
    m.kleur = ruimte < 0 ? 'rood' : ruimte < buffer ? 'oranje' : 'groen';
    m.buffer = buffer;
    return m;
  }
  function margeMeter(x, jaar) {
    const t = x.tm, m = { id: 'marge', titel: 'Brutomarge', kleur: 'onbekend', waarde: '—', sub: [], waarom: [], getal: null,
      bron: 'Moneybird via /geld/cijfers (grootboekindeling materiaal en uitbesteed werk); branchenorm: CBS (of eigen instelling).' };
    m.uitleg = `Brutomarge = omzet − materiaal − uitbesteed werk, als % van de omzet. Boekjaar ${jaar} t/m de laatste afgesloten maand, vergeleken met ${jaar - 1} over precies dezelfde maanden, en met de branchenorm. Groen: gelijk aan of boven vorig jaar óf de branche. Oranje: tot ${MARGE_PP} procentpunt eronder. Rood: meer dan ${MARGE_PP} punten eronder.`;
    const b = x.branche, bRef = b ? (b.van != null ? b.van : b.pct) : null, bTekst = b ? (b.van != null && b.tot != null ? `${pct(b.van)}–${pct(b.tot)}` : pct(b.pct)) : null;
    if (x.laden) { m.waarde = '…'; m.waarom.push('cijfers worden nog geladen'); return m; }
    if (x.onvolledig.length) { m.waarom.push(...x.onvolledig); return m; }
    if (!t) { m.kleur = 'neutraal'; m.waarde = 'nog niet'; m.sub.push(`nog geen afgesloten maand in ${jaar}`); return m; }
    if (!x.dit || x.dit.pct == null) { m.kleur = 'neutraal'; m.sub.push(`geen omzet t/m ${mndKort(t)}: geen marge te berekenen`); return m; }
    const nu = x.dit.pct; m.getal = Math.round(nu * 10) / 10; m.waarde = pct(nu);
    const dv = x.vorig && x.vorig.pct != null ? nu - x.vorig.pct : null, db = bRef != null ? nu - bRef : null;
    m.sub.push(`t/m ${mndKort(t)} · ${jaar - 1} zelfde periode: ${x.vorig ? `${pct(x.vorig.pct)} (${dv >= 0 ? '+' : '−'}${pp(dv)} punt)` : 'geen omzet'}`);
    if (bTekst) m.sub.push(`branche (CBS): ${bTekst}${b.bron ? ' · ' + b.bron : ''}`);
    if (dv == null && db == null) { m.waarom.push('geen vergelijking: geen omzet in dezelfde periode vorig jaar en geen branchecijfer'); return m; }
    const beste = Math.max(dv == null ? -Infinity : dv, db == null ? -Infinity : db);
    m.kleur = beste >= 0 ? 'groen' : beste >= -MARGE_PP ? 'oranje' : 'rood';
    m.achter = dv; m.achterBranche = db;
    if (t < DUN && m.kleur === 'rood') { m.kleur = 'oranje'; m.gedempt = true; }
    return m;
  }
  function omzetMeter(x, jaar, tm) {
    const m = { id: 'omzet', titel: 'Omzet op 31-12', kleur: 'onbekend', waarde: '—', sub: [], waarom: [], getal: null, schatting: true,
      bron: 'Gefactureerd: Moneybird via /geld/cijfers. Prognose: de aangevinkte termijnen in Geld → Prognose die nog niet gefactureerd zijn.' };
    m.uitleg = `Schatting: de gefactureerde omzet van ${jaar} (t/m vandaag) plus de aangevinkte prognosetermijnen met een factuurdatum vóór 31-12 (bedragen ÷ 1,21, dus excl. btw). Vergeleken met de omzet van heel ${jaar - 1}. Groen: minstens zoveel als vorig jaar. Oranje: ${Math.round(OMZET_ORANJE * 100)}–99%. Rood: minder dan ${Math.round(OMZET_ORANJE * 100)}%. Alleen wat zeker doorgaat telt mee; offertes niet.`;
    if (x.laden) { m.waarde = '…'; m.waarom.push('cijfers worden nog geladen'); return m; }
    if (x.onvolledig.length) { m.waarom.push(...x.onvolledig); return m; }
    const s = (x.gerealiseerd || 0) + (x.prognose || 0); m.waarde = kort(s); m.som = s;
    m.sub.push(`gefactureerd ${kort(x.gerealiseerd)} + prognose ${kort(x.prognose)} (${x.termijnen} termijn${x.termijnen === 1 ? '' : 'en'})`);
    if (!(x.vorigJaar > 0)) { m.kleur = 'neutraal'; m.sub.push(`geen omzet in ${jaar - 1} om mee te vergelijken`); return m; }
    const q = s / x.vorigJaar; m.getal = Math.round(q * 1000) / 10; m.vorig = x.vorigJaar;
    m.sub.push(`${pct(q * 100)} van ${jaar - 1} (${kort(x.vorigJaar)})`);
    m.kleur = q >= 1 ? 'groen' : q >= OMZET_ORANJE ? 'oranje' : 'rood';
    if (tm < DUN && m.kleur === 'rood') { m.kleur = 'oranje'; m.gedempt = true; }
    return m;
  }

  // ── Het oordeel ──
  K.oordeel = function (inv) {
    const tm = inv.marge ? inv.marge.tm : Number(inv.vandaag.slice(5, 7)) - 1;
    const kas = kasMeter(inv.kas), marge = margeMeter(inv.marge, inv.jaar), omzet = omzetMeter(inv.omzet, inv.jaar, tm), meters = [kas, marge, omzet];
    const echt = meters.filter(m => m.kleur in ORDE), onbekend = meters.filter(m => m.kleur === 'onbekend');
    const kleur = echt.some(m => m.kleur === 'rood') ? 'rood' : onbekend.length || !echt.length ? 'onbetrouwbaar' : echt.reduce((a, m) => ORDE[m.kleur] > ORDE[a] ? m.kleur : a, 'groen');
    const noten = [];
    const dun = tm < DUN;
    if (dun) noten.push(tm ? `Vroeg in het boekjaar (${tm} afgesloten maand${tm === 1 ? '' : 'en'}): de vergelijking met vorig jaar is nog dun. Marge en omzet geven daarom hooguit "opletten".` : `Nog geen afgesloten maand in ${inv.jaar}: de marge is nog niet te beoordelen en de omzet is vooral wat er al vastligt.`);
    let zin;
    const margeZin = m => m.achter != null && m.achter < 0 ? `de marge ligt ${pp(m.achter)} punt onder vorig boekjaar${m.achterBranche != null && m.achterBranche < 0 ? ' en onder de branche' : ''}` : `de marge ligt ${pp(m.achterBranche)} punt onder de branche`;
    const omzetZin = m => `de omzet komt naar schatting op ${pct(m.getal)} van vorig jaar (${kort(m.som)} tegen ${kort(m.vorig)})`;
    if (kleur === 'rood') {
      if (kas.kleur === 'rood') zin = `Op ${datum(kas.datum)} zakt de kas ${kort(-kas.getal)} onder de ${kas.grensNaam}${inv.kas.kredietlimiet != null && inv.kas.laagste.saldo < -inv.kas.kredietlimiet ? ', en zelfs onder de kredietlimiet' : ''}; zonder ingreep is dit geen boekhoudkundig maar een betalingsprobleem.`;
      else if (marge.kleur === 'rood') zin = `${cap(margeZin(marge))}: er is werk, maar er blijft te weinig van over.`;
      else zin = `${cap(omzetZin(omzet))}; met wat nu vastligt halen we vorig jaar niet.`;
      if (onbekend.length) noten.push(`Let op: ${onbekend.map(m => m.titel.toLowerCase()).join(' en ')} ${onbekend.length === 1 ? 'is' : 'zijn'} niet te beoordelen (bron onvolledig).`);
    } else if (kleur === 'onbetrouwbaar') {
      const r = onbekend.length ? onbekend.map(m => `${m.titel.toLowerCase()}: ${m.waarom[0] || 'bron onvolledig'}`) : ['geen enkel getal te beoordelen'];
      zin = `Geen oordeel, omdat niet alle bronnen compleet zijn — ${r.join('; ')}.`;
    } else if (kleur === 'oranje') {
      const delen = [];
      if (marge.kleur === 'oranje') delen.push(margeZin(marge));
      if (omzet.kleur === 'oranje') delen.push(omzetZin(omzet));
      zin = kas.kleur === 'oranje'
        ? `De kas blijft boven de ${kas.grensNaam}, maar op ${datum(kas.datum)} is de ruimte maar ${kort(kas.getal)} — minder dan ${inv.kas.vasteLasten > 0 ? 'één maand vaste lasten' : kort(KAS_BUFFER)}${delen.length ? '; en ' + delen.join(' en ') : ''}.`
        : `Kas blijft veilig, maar ${delen.join(' en ')}.`;
    } else {
      zin = `Kas blijft minstens ${kort(kas.getal)} boven de ${kas.grensNaam}; ${omzet.kleur === 'groen' ? `omzetprognose ${kort(omzet.som)}` : 'omzet nog niet te vergelijken'} en ${marge.kleur === 'groen' ? 'marge op niveau' : 'marge nog niet te beoordelen'}.`;
    }
    return { datum: inv.vandaag, jaar: inv.jaar, kleur, titel: TITEL[kleur], zin, noten, meters, dun };
  };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  // Dagfoto (voor later: ochtendmelding alleen bij verslechtering): alleen kleuren en getallen, geen tekst.
  K.dagfoto = o => ({ datum: o.datum, jaar: o.jaar, kleur: o.kleur, meters: o.meters.map(m => ({ id: m.id, kleur: m.kleur, getal: m.getal })) });

  // ── Weergave ──
  K.css = function () {
    if (!root.document || document.getElementById('mtk-css')) return;
    const s = document.createElement('style'); s.id = 'mtk-css';
    s.textContent = `
.mtk{background:var(--card,#fff);border:1px solid var(--border,#e4e2da);border-left:8px solid var(--mtk-kleur);border-radius:10px;padding:12px 14px;margin-bottom:12px;--mtk-kleur:#6b7682}
.mtk.groen{--mtk-kleur:#2A7A4A}.mtk.oranje{--mtk-kleur:#b7791f}.mtk.rood{--mtk-kleur:#B4412F}.mtk.onbetrouwbaar{--mtk-kleur:#6b7682}
.mtk-kop{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.mtk-titel{font-size:24px;font-weight:700;color:var(--mtk-kleur);line-height:1.2}
.mtk-jaar{font-size:12px;color:var(--mtg-zacht,#8a8a80);margin-left:auto}
.mtk-zin{font-size:15px;margin:4px 0 2px;line-height:1.45}
.mtk-noot{font-size:12px;color:var(--mtg-zacht,#8a8a80);margin-top:2px}
.mtk-meters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}
.mtk-m{border:1px solid var(--border,#e4e2da);border-top:4px solid #c9d0d6;border-radius:8px;padding:8px 10px;min-width:0}
.mtk-m.groen{border-top-color:#2A7A4A}.mtk-m.oranje{border-top-color:#b7791f}.mtk-m.rood{border-top-color:#B4412F}.mtk-m.onbekend{border-top-style:dashed;border-top-color:#8c96a0}
.mtk-m .l{font-size:12px;color:var(--mtg-zacht,#8a8a80);display:flex;justify-content:space-between;align-items:center;gap:6px}
.mtk-m .w{font-size:20px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mtk-m .k{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.mtk-m.groen .k{color:#2A7A4A}.mtk-m.oranje .k{color:#b7791f}.mtk-m.rood .k{color:#B4412F}.mtk-m.onbekend .k,.mtk-m.neutraal .k{color:#6b7682}
.mtk-m .s{font-size:12px;color:var(--mtg-zacht,#8a8a80);margin-top:2px}
.mtk-i{border:1px solid var(--border,#ddd);background:none;border-radius:50%;min-width:24px;height:24px;font-size:12px;font-style:italic;font-family:Georgia,serif;cursor:pointer;color:inherit;padding:0}
@media(max-width:760px){.mtk-meters{grid-template-columns:1fr}.mtk-titel{font-size:21px}}
`;
    document.head.appendChild(s);
  };
  const KLEURWOORD = { groen: 'goed', oranje: 'opletten', rood: 'te laag', neutraal: 'nog niet te beoordelen', onbekend: 'onvolledig' };
  K.kaartHtml = function (o) {
    return `<section class="mtk ${o.kleur}" aria-label="Koersmeter: ${esc(o.titel)}">
  <div class="mtk-kop"><span class="mtk-titel">${esc(o.titel)}</span><span class="mtk-jaar">Koersmeter · boekjaar ${o.jaar}</span></div>
  <div class="mtk-zin">${esc(o.zin)}</div>${o.noten.map(n => `<div class="mtk-noot">${esc(n)}</div>`).join('')}
  <div class="mtk-meters">${o.meters.map(m => `<div class="mtk-m ${m.kleur}"><div class="l"><span>${esc(m.titel)}${m.schatting ? ' (schatting)' : ''}</span><button class="mtk-i" data-koers="${m.id}" aria-label="Uitleg en bron: ${esc(m.titel)}" title="Uitleg en bron">i</button></div>
    <div class="w">${esc(m.waarde)}</div><div class="k">${esc(KLEURWOORD[m.kleur])}${m.gedempt ? ' (vroeg in het jaar)' : ''}</div>${m.sub.map(s => `<div class="s">${esc(s)}</div>`).join('')}${m.kleur === 'onbekend' && m.waarom.length ? `<div class="s">${esc(m.waarom[0])}</div>` : ''}</div>`).join('')}</div>
</section>`;
  };
  K.uitlegHtml = function (o, id) {
    const m = o && o.meters.find(x => x.id === id); if (!m) return '';
    return `<h3>${esc(m.titel)}</h3><div class="mtg-uitleg">${esc(m.uitleg)}</div><p style="font-size:13px"><b>Bron:</b> ${esc(m.bron)}</p>`
      + (m.waarom.length ? `<p style="font-size:13px"><b>Waarom geen oordeel:</b></p><ul style="font-size:13px">${m.waarom.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '')
      + `<p style="font-size:12px;color:#8a8a80">Het oordeel bovenaan is de slechtste kleur van de drie getallen. Ontbreekt een bron, dan staat er "Oordeel onbetrouwbaar" — nooit groen.</p>`;
  };
})(typeof window !== 'undefined' ? window : globalThis);
