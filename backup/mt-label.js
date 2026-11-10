/* ============================================================================
 * mt-label.js — projectlabel printen op de Godex DT4 (90 x 50 mm, liggend).
 * ----------------------------------------------------------------------------
 * Zelfde opbouw als het Word-label "Label project" van Bart (10-11-2026):
 *   Klant:          <klantnaam>
 *   Project:        <korte projectnaam>
 *   Datum gereed:   <leverdatum, "23 november">
 *   Opmerking:      <vrije tekst, mag leeg: dan is er ruimte om te schrijven>
 * met rechtsboven klein het projectnummer.
 * Printen gaat via de gewone Windows-driver van de Godex: een verborgen iframe met een pagina van precies 90 x 50 mm (@page) en
 * window.print(). Geen extra software nodig. Kies in het printvenster één keer de Godex; Chrome onthoudt dat.
 * Tekent met DOM-calls, nooit met opgebouwde HTML (check-sinks). Puur deel (gegevens, tekstmaat) is los te testen.
 * ========================================================================== */
(function (root) {
  'use strict';
  if (!root) return;
  const L = {};
  const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const schoon = s => String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();

  // "2026-11-23" → "23 november" (ongeldige of lege datum → '')
  L.datumTekst = ymd => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    if (!m) return '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d) || d.getUTCMonth() !== +m[2] - 1 ? '' : (+m[3]) + ' ' + MAANDEN[+m[2] - 1];
  };
  // g = { klant, project, leverdatum (JJJJ-MM-DD), opmerking, nummer } → de regels van het label
  L.gegevens = g => {
    g = g || {};
    return { klant: schoon(g.klant), project: schoon(g.project), datum: L.datumTekst(g.leverdatum), opmerking: schoon(g.opmerking), nummer: schoon(g.nummer) };
  };
  // Lettergrootte in pt voor de waardes: zo groot als past. De labelkolom is 29 mm, de waardekolom ~52 mm breed.
  // Een vette letter is gemiddeld ~0,6 x de lettergrootte breed; 1 pt = 0,353 mm. De projectnaam mag over twee regels.
  // Tussen 11 en 20 pt.
  L.letterPt = (g, breedteMm) => {
    const b = Number(breedteMm) > 0 ? Number(breedteMm) : 52, n = k => String((g && g[k]) || '').length;
    const langst = Math.max(1, n('klant'), n('datum'), Math.ceil(n('project') / 1.8));
    return Math.max(11, Math.min(20, Math.floor(b / (langst * 0.6 * 0.353))));
  };

  const CSS = [
    '@page{size:90mm 50mm;margin:0}',
    'html,body{margin:0;padding:0;background:#fff;color:#000}',
    '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    '.lbl{width:90mm;height:50mm;padding:6mm 4mm 3mm 5mm;font-family:"Segoe UI",Arial,sans-serif;position:relative;overflow:hidden;page-break-after:always;break-after:page}',
    '.lbl:last-child{page-break-after:auto;break-after:auto}',
    '.nr{position:absolute;top:1.5mm;right:3mm;font-size:8pt;color:#000}',
    'table{border-collapse:collapse;width:100%;table-layout:fixed}',
    'td{padding:0.8mm 0;vertical-align:baseline;line-height:1.1;overflow-wrap:anywhere}',
    'td.k{width:29mm;font-size:11pt;white-space:nowrap}',
    'td.w{font-weight:700}',
    'tr.opm td{padding-top:3mm}',
    'tr.opm td.w{font-weight:400;font-size:11pt}'
  ].join('\n');

  // Bouw het label in `doc` (het document van de iframe). Geeft het .lbl-element terug.
  L.bouw = (doc, g) => {
    const el = (tag, klass, tekst) => { const e = doc.createElement(tag); if (klass) e.className = klass; if (tekst != null) e.textContent = tekst; return e; };
    const lbl = el('div', 'lbl');
    if (g.nummer) lbl.appendChild(el('div', 'nr', g.nummer));
    const t = el('table'), pt = L.letterPt(g) + 'pt';
    [['Klant:', g.klant], ['Project:', g.project], ['Datum gereed:', g.datum]].forEach(([k, w]) => {
      const tr = el('tr'), td = el('td', 'w', w || '');
      td.style.fontSize = pt;
      tr.appendChild(el('td', 'k', k)); tr.appendChild(td); t.appendChild(tr);
    });
    const tr = el('tr', 'opm');
    tr.appendChild(el('td', 'k', 'Opmerking:')); tr.appendChild(el('td', 'w', g.opmerking || ''));
    t.appendChild(tr);
    lbl.appendChild(t);
    return lbl;
  };

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
    items.forEach(g => d.body.appendChild(L.bouw(d, g)));
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
