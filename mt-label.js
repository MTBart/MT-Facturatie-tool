/* ============================================================================
 * mt-label.js — projectlabel printen op de Godex DT4 (90 x 50 mm, liggend).
 * ----------------------------------------------------------------------------
 * Opgezet als een bladkader (Bart, 10-11-2026): een kader met vakken, in elk vak klein het veldnaampje en groot de waarde.
 *   ┌──────────────────────────────┬────────────┐
 *   │ [merk] mortise & tenon       │ PROJECTNR  │
 *   ├──────────────────────────────┴────────────┤
 *   │ KLANT                                     │
 *   ├───────────────────────────────────────────┤
 *   │ PROJECT (mag over twee regels)            │
 *   ├─────────────────────┬─────────────────────┤
 *   │ DATUM GEREED  + wk  │ OPMERKING           │
 *   └─────────────────────┴─────────────────────┘
 * Waardes staan gecentreerd in hun vak en worden kleiner gezet tot ze passen (L.passen meet in de browser).
 * Alleen zwart (thermisch), lijnen van 0,3 mm, geen vlakken. Opmerking leeg = ruimte om met de hand te schrijven.
 * Printen gaat via de gewone Windows-driver van de Godex: een verborgen iframe met een pagina van precies 90 x 50 mm (@page) en
 * window.print(). Geen extra software nodig. Kies in het printvenster één keer de Godex; Chrome onthoudt dat.
 * Tekent met DOM-calls, nooit met opgebouwde HTML (check-sinks). Puur deel (gegevens, datum, week) is los te testen.
 * ========================================================================== */
(function (root) {
  'use strict';
  if (!root) return;
  const L = {};
  const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const DAGEN = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  const schoon = s => String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
  const datum = ymd => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d) || d.getUTCMonth() !== +m[2] - 1 ? null : d;
  };

  // "2026-11-23" → "23 november" (ongeldige of lege datum → '')
  L.datumTekst = ymd => { const d = datum(ymd); return d ? d.getUTCDate() + ' ' + MAANDEN[d.getUTCMonth()] : ''; };
  // "2026-11-23" → "ma" ; ISO-weeknummer → 48
  L.dagTekst = ymd => { const d = datum(ymd); return d ? DAGEN[d.getUTCDay()] : ''; };
  L.week = ymd => {
    const d = datum(ymd); if (!d) return '';
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  };
  // g = { klant, project, leverdatum (JJJJ-MM-DD), opmerking, nummer } → de velden van het label
  L.gegevens = g => {
    g = g || {};
    return { klant: schoon(g.klant), project: schoon(g.project), datum: L.datumTekst(g.leverdatum), dag: L.dagTekst(g.leverdatum),
      week: L.week(g.leverdatum), opmerking: schoon(g.opmerking), nummer: schoon(g.nummer) };
  };
  const CSS = [
    '@page{size:90mm 50mm;margin:0}',
    'html,body{margin:0;padding:0;background:#fff;color:#000}',
    '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    '.lbl{width:90mm;height:50mm;padding:3.5mm;font-family:"Segoe UI",Arial,Helvetica,sans-serif;overflow:hidden;page-break-after:always;break-after:page}',
    '.lbl:last-child{page-break-after:auto;break-after:auto}',
    '.kader{width:100%;height:100%;border:0.5mm solid #000;display:grid;grid-template-columns:40mm 1fr 22mm;grid-template-rows:8.5mm 9.5mm 1fr 11.5mm}',
    '.vak{border:0 solid #000;padding:0.9mm 1.6mm 0.6mm;min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column}',
    '.kop{grid-column:1/3;flex-direction:row;align-items:center;gap:1.8mm;border-bottom-width:0.3mm;border-right-width:0.3mm}',
    '.nr{grid-column:3;border-bottom-width:0.3mm}',
    '.klant{grid-column:1/4;border-bottom-width:0.3mm}',
    '.proj{grid-column:1/4;border-bottom-width:0.3mm}',
    '.dat{grid-column:1/2;border-right-width:0.3mm}',
    '.opm{grid-column:2/4}',
    '.wv{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden}',
    '.wv .w{max-width:100%}.wv .een{white-space:nowrap}',
    '.k{font-size:5.5pt;letter-spacing:0.08em;text-transform:uppercase;line-height:1;margin-bottom:0.5mm;white-space:nowrap}',
    '.w{font-weight:700;line-height:1.08;overflow-wrap:anywhere}',
    '.merk{width:5.2mm;height:5.2mm;flex:none;fill:none;stroke:#000;stroke-width:7}',
    '.woord{font-size:10pt;font-weight:500;letter-spacing:0.01em;white-space:nowrap}.woord i{font-weight:400}',
    '.nr .w{font-size:11pt;letter-spacing:0.02em}',
    '.datrij{display:flex;align-items:baseline;justify-content:center;gap:2.2mm;white-space:nowrap;max-width:100%}',
    '.dag{font-size:7pt;font-weight:400}.wk{font-size:7.5pt;font-weight:600;white-space:nowrap}',
    '.opm .w{font-weight:400;font-size:9pt}',
    '.leeg{border-bottom:0.2mm dotted #000;width:100%;height:4mm}'
  ].join('\n');

  // Bouw het label in `doc` (het document van de iframe). Geeft het .lbl-element terug.
  L.bouw = (doc, g) => {
    const el = (tag, klass, tekst, ...kids) => { const e = doc.createElement(tag); if (klass) e.className = klass; if (tekst != null) e.textContent = tekst; kids.forEach(k => k && e.appendChild(k)); return e; };
    const vak = (klass, label, ...kids) => el('div', 'vak ' + klass, null, label ? el('div', 'k', label) : null, ...kids);
    // Een waarde, gecentreerd in de rest van het vak. max/min in pt; een = op één regel houden. passen() maakt hem na het tekenen precies passend.
    const groot = (tekst, max, min, een) => { const w = el('div', 'w' + (een ? ' een' : ''), tekst || ''); w.style.fontSize = max + 'pt'; w.setAttribute('data-min', min); return w; };
    const midden = (...kids) => el('div', 'wv', null, ...kids);
    // het beeldmerk: pen-en-gat-doorsnede (zelfde als mt-merk.css)
    const NS = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('class', 'merk'); svg.setAttribute('aria-hidden', 'true');
    const r = doc.createElementNS(NS, 'rect'); [['x', 4], ['y', 4], ['width', 92], ['height', 92]].forEach(([a, v]) => r.setAttribute(a, v));
    const pd = doc.createElementNS(NS, 'path'); pd.setAttribute('d', 'M55.4 4 V31.3 H34.2 V67.3 H55.4 V96');
    svg.appendChild(r); svg.appendChild(pd);
    const woord = el('span', 'woord', 'mortise '); woord.appendChild(el('i', null, '&')); woord.appendChild(doc.createTextNode(' tenon'));
    const kader = el('div', 'kader', null,
      el('div', 'vak kop', null, svg, woord),
      vak('nr', 'Projectnr', midden(groot(g.nummer, 12, 7, true))),
      vak('klant', 'Klant', midden(groot(g.klant, 16, 7, true))),
      vak('proj', 'Project', midden(groot(g.project, 20, 7, false))),
      vak('dat', 'Datum gereed', midden(el('div', 'datrij', null, groot(g.datum, 14, 7, true), g.week ? el('span', 'wk', 'wk ' + g.week) : null))),
      vak('opm', 'Opmerking', midden(g.opmerking ? groot(g.opmerking, 11, 6, false) : el('div', 'leeg'))));
    return el('div', 'lbl', null, kader);
  };
  // Na het tekenen (het label staat in een document met opmaak): elke waarde in stapjes van 0,5 pt kleiner tot hij in zijn vak past,
  // in de breedte én de hoogte. Meet in de echte browser, dus met het echte lettertype. Een waarde op één regel past als hij niet
  // breder is dan het vak; een waarde die mag afbreken (project, opmerking) past als hij niet hoger is dan het vak.
  L.passen = lbl => {
    lbl.querySelectorAll('.wv').forEach(vak => {
      const w = vak.querySelector('.w'); if (!w) return;
      const min = Number(w.getAttribute('data-min')) || 6;
      const rij = w.parentNode !== vak ? w.parentNode : w;     // datum + week samen in één rij
      const te = () => rij.scrollWidth > vak.clientWidth + 0.5 || rij.scrollHeight > vak.clientHeight + 0.5 || w.scrollWidth > w.clientWidth + 0.5;
      let pt = parseFloat(w.style.fontSize) || 12;
      for (let i = 0; i < 60 && pt > min && te(); i++) { pt -= 0.5; w.style.fontSize = pt + 'pt'; }
    });
    return lbl;
  };

  // Afstelling per pc (de Godex legt het beeld niet altijd precies op het etiket): verschuiving in mm, x = naar rechts, y = omhoog.
  // Standaard de correctie die op de eerste twee echte prints (10-11-2026) is gemeten: het beeld zat ~3-5 mm te ver naar links en ~2-4 mm te laag.
  const AFSTEL_SLEUTEL = 'mt_label_afstelling', AFSTEL_STANDAARD = Object.freeze({ x: 4, y: 3 });
  const getal = (v, d) => { const n = Number(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) && Math.abs(n) <= 20 ? Math.round(n * 10) / 10 : d; };
  L.afstelling = () => {
    try { const j = JSON.parse(root.localStorage.getItem(AFSTEL_SLEUTEL) || 'null'); if (j && typeof j === 'object') return { x: getal(j.x, AFSTEL_STANDAARD.x), y: getal(j.y, AFSTEL_STANDAARD.y) }; } catch (e) {}
    return { x: AFSTEL_STANDAARD.x, y: AFSTEL_STANDAARD.y };
  };
  // tekst "2 4" of "2,5 -1" → {x, y}; null als het geen twee getallen tussen -20 en 20 zijn
  L.leesAfstelling = tekst => {
    const d = String(tekst == null ? '' : tekst).trim().split(/[\s;\/]+/).filter(Boolean);
    if (d.length !== 2) return null;
    const x = getal(d[0], null), y = getal(d[1], null);
    return x == null || y == null ? null : { x, y };
  };
  L.zetAfstelling = a => { try { root.localStorage.setItem(AFSTEL_SLEUTEL, JSON.stringify({ x: a.x, y: a.y })); return true; } catch (e) { return false; } };
  // De marges (boven, rechts, onder, links) in mm binnen de pagina: normaal 3,5 rondom; de afstelling schuift het kader binnen de pagina
  // (nooit buiten de pagina, want wat buiten de pagina valt print de driver niet). Minimaal 0,5 mm.
  L.marges = a => { const m = v => Math.max(0.5, Math.round(v * 10) / 10); return [m(3.5 - a.y), m(3.5 - a.x), m(3.5 + a.y), m(3.5 + a.x)]; };
  L.afstellingTekst = a => String(a.x).replace('.', ',') + ' ' + String(a.y).replace('.', ',');

  // Print een of meer labels. lijst = [{klant, project, leverdatum, opmerking, nummer}], opts.doc = het hoofddocument (test).
  // → Promise die klaar is zodra het printvenster is geopend (en weer dicht, waar de browser dat meldt).
  L.print = (lijst, opts) => new Promise((klaar, fout) => {
    const doc = (opts && opts.doc) || root.document;
    const items = (Array.isArray(lijst) ? lijst : [lijst]).filter(Boolean).map(L.gegevens);
    if (!items.length) { fout(new Error('geen label om te printen')); return; }
    const oud = doc.getElementById('mt-label-print'); if (oud) oud.remove();
    const f = doc.createElement('iframe');
    f.id = 'mt-label-print'; f.setAttribute('aria-hidden', 'true'); f.title = 'Label';
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    doc.body.appendChild(f);
    const w = f.contentWindow, d = w.document;
    d.open(); d.close();
    d.title = 'Label ' + (items[0].nummer || items[0].project || '');
    const st = d.createElement('style'); st.textContent = CSS; d.head.appendChild(st);
    const af = (opts && opts.afstelling) || L.afstelling();
    items.forEach(g => { const lbl = L.bouw(d, g); lbl.style.padding = L.marges(af).map(m => m + 'mm').join(' '); L.passen(d.body.appendChild(lbl)); });
    let weg = false;
    const ruim = () => { if (weg) return; weg = true; setTimeout(() => { try { f.remove(); } catch (e) {} }, 500); klaar(); };
    w.addEventListener('afterprint', ruim);
    setTimeout(() => {
      try { w.focus(); w.print(); } catch (e) { try { f.remove(); } catch (x) {} fout(e); return; }
      setTimeout(ruim, 60000);   // vangnet als de browser geen afterprint stuurt
    }, 50);
  });

  L.CSS = CSS;
  root.MTLabel = L;
})(typeof window !== 'undefined' ? window : globalThis);
