/* ============================================================================
 * mt-project.js — één projectresolver voor de cockpit (v2), de app (mobiel), uren, mt-toggl en mt-koppel
 * (brok C projectnummers). Een project is te vinden op:
 *   project_id · code (technische sleutel) · projectnummer (260812) · werkcode (W26-003) ·
 *   oude codes en aliassen (legacy_codes, aliasregister van de teller) · offertenummer(s).
 * Uitkomst altijd { soort: 'geen' | 'een' | 'ambigu', project, via, sleutel, kandidaten } — nooit gokken.
 * Volgorde bij dezelfde sleutel: id > code > nummer > werkcode > alias > offerte (de hoogste soort die
 * iets vindt, telt; vindt die twee projecten, dan is het ambigu). Puur: geen DOM, geen opslag.
 * ========================================================================== */
(function (root) {
  'use strict';
  if (!root) return;
  const NR_RE = /^\d{6}$/, W_RE = /^W\d{2}-\d{3,}$/i;
  const SOORTEN = ['id', 'code', 'nummer', 'werkcode', 'alias', 'offerte'];
  const norm = s => String(s == null ? '' : s).trim().toUpperCase();
  const GEEN = Object.freeze({ soort: 'geen', project: null, via: null, sleutel: '', kandidaten: [] });

  // opts.nummer(p): het projectnummer om te gebruiken (cockpit: projNummer, de teller is de bron); anders p.projectnummer.
  // opts.aliassen: { alias: project_id } uit het aliasregister van de teller.
  function index(projecten, opts) {
    opts = opts || {};
    const per = new Map(), lijst = [], aliasPer = new Map();
    Object.entries(opts.aliassen || {}).forEach(([a, pid]) => { if (!pid) return; if (!aliasPer.has(pid)) aliasPer.set(pid, []); aliasPer.get(pid).push(a); });
    const zet = (s, via, p) => {
      const k = norm(s); if (!k) return;
      if (!per.has(k)) per.set(k, new Map());
      const m = per.get(k); if (!m.has(via)) m.set(via, []);
      if (!m.get(via).includes(p)) m.get(via).push(p);
    };
    for (const p of Array.isArray(projecten) ? projecten : []) {
      if (!p || typeof p !== 'object' || p._vervallen || p._mt_meta) continue;
      lijst.push(p);
      zet(p.project_id, 'id', p);
      zet(p.code, 'code', p);
      const nr = typeof opts.nummer === 'function' ? opts.nummer(p) : p.projectnummer;
      if (nr != null && NR_RE.test(String(nr))) zet(nr, 'nummer', p);
      zet(p.werkcode, 'werkcode', p);
      (Array.isArray(p.legacy_codes) ? p.legacy_codes : []).forEach(c => zet(c, 'alias', p));
      (aliasPer.get(p.project_id) || []).forEach(a => zet(a, 'alias', p));
      zet(p.offertenr, 'offerte', p);
      (Array.isArray(p.offertes) ? p.offertes : []).forEach(o => { if (o && o.nummer && o.rol !== 'genegeerd') zet(o.nummer, 'offerte', p); });
    }
    return { per, lijst };
  }
  function uitkomst(m, sleutel, soorten) {
    for (const via of soorten || SOORTEN) {
      const l = m.get(via);
      if (l && l.length) return l.length === 1 ? { soort: 'een', project: l[0], via, sleutel, kandidaten: l.slice() }
        : { soort: 'ambigu', project: null, via, sleutel, kandidaten: l.slice() };
    }
    return GEEN;
  }
  // Exact op één sleutel (hoofdletterongevoelig).
  function vind(ix, s, soorten) {
    const k = norm(s), m = k && ix && ix.per.get(k);
    return m ? uitkomst(m, k, soorten) : GEEN;
  }
  // Een sleutel VOORAAN een tekst (referentie van een inkoopfactuur, Toggl-naam): het eerste woord, eventueel tussen [ ],
  // en daarvan ook de delen tot een streep ("W26-003-beslag" → W26-003). Alleen bekende sleutels tellen, met een grens
  // erna (geen letter of cijfer): "2608123" of "KL-KASTEN" vinden dus niet "260812" of "KL-K". De langste passende
  // sleutel wint. project_id telt hier niet.
  function uitPrefix(ix, tekst) {
    const t = norm(tekst).replace(/^\[/, '');
    const tok = (t.match(/^[A-Z0-9][A-Z0-9-]*/) || [''])[0].replace(/-+$/, '');
    if (!tok || !ix) return GEEN;
    const delen = tok.split('-'), kand = [];
    for (let i = delen.length; i >= 1; i--) kand.push(delen.slice(0, i).join('-'));
    for (const k of kand) {
      const m = ix.per.get(k); if (!m) continue;
      const u = uitkomst(m, k, SOORTEN.slice(1));
      if (u.soort !== 'geen') return u;
    }
    return GEEN;
  }
  // Toggl-projectnaam, alle vormen: "naam [CODE]" (app), "260812 Naam" (projectnummer voorop), "W26-003 Naam",
  // "2026-054 Naam" (offertenummer voorop, oude conventie) en een kale code als hele naam. Altijd tegen de index.
  function uitToggl(ix, naam) {
    const s = String(naam == null ? '' : naam).trim();
    if (!s || !ix) return GEEN;
    const b = s.match(/\[([A-Za-z0-9][A-Za-z0-9\-]*)\]\s*$/);
    if (b) { const u = vind(ix, b[1], SOORTEN.slice(1)); if (u.soort !== 'geen') return Object.assign({}, u, { vorm: '[code]' }); }
    const u = uitPrefix(ix, s);
    if (u.soort === 'geen') return GEEN;
    return Object.assign({}, u, { vorm: NR_RE.test(u.sleutel) ? 'nummer-prefix' : W_RE.test(u.sleutel) ? 'werkcode-prefix' : u.via === 'offerte' ? 'offerte-prefix' : 'code' });
  }
  // Toggl-naam voor een project: "<projectnummer> <projectnaam>" ("260801 Werkblad ref 186986"). De projectnaam is het product;
  // klant en locatie staan er niet in, want de klant is in Toggl een apart veld (Bart, 14-10). Zonder product de volledige naam.
  // Zonder projectnummer de oude vorm (offertenummer of naam), zodat lopende projecten niet ineens een andere naam voorgesteld krijgen.
  function togglNaam(p, opts) {
    opts = opts || {};
    const naam = String((p && (p.naam || p.product_naam)) || '').trim();
    const product = String((p && (p.product_naam || p.product)) || '').trim();
    const nr = p && (typeof opts.nummer === 'function' ? opts.nummer(p) : p.projectnummer);
    if (nr && NR_RE.test(String(nr))) return (String(nr) + ' ' + (product || naam)).trim();
    return p && p.offertenr ? (p.offertenr + ' ' + naam).trim() : naam;
  }
  // De leesbare naam uit een Toggl-projectnaam zonder herkende code (project overnemen uit Toggl): "[CODE]" achteraan eraf,
  // en vooraan een projectnummer (6 cijfers), werkcode (W26-003) of offertenummer (2026-054). Alleen op vorm (een nog niet
  // gekoppeld project staat niet in de index); wat eraf ging komt mee terug. Blijft er niets over, dan de oorspronkelijke naam.
  function naamZonderCode(naam) {
    const orig = String(naam == null ? '' : naam).trim();
    let s = orig, code = '', nummer = '', werkcode = '', offerte = '';
    const b = s.match(/\s*\[([A-Za-z0-9][A-Za-z0-9-]*)\]\s*$/);
    if (b) { code = b[1].toUpperCase(); s = s.slice(0, b.index).trim(); }
    const v = s.match(/^(\d{6}|W\d{2}-\d{3,}|\d{4}-\d{2,4})(?=[\s:·|–—]|$)[\s\-–—:·|]*/i);
    if (v) { const t = v[1].toUpperCase(); if (NR_RE.test(t)) nummer = t; else if (W_RE.test(t)) werkcode = t; else offerte = t; s = s.slice(v[0].length).trim(); }
    return { naam: s || orig, code, nummer, werkcode, offerte };
  }
  // Navigatie naar een adres (L1c): op iOS Apple Maps (daddr), elders Google Maps met dir_action=navigate. ua = navigator.userAgent.
  function navUrl(adres, ua) {
    const a = String(adres == null ? '' : adres).replace(/\s+/g, ' ').trim();
    if (!a) return '';
    if (/iPad|iPhone|iPod/.test(String(ua || ''))) return 'https://maps.apple.com/?daddr=' + encodeURIComponent(a);
    return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(a) + '&dir_action=navigate';
  }
  root.MTProject = { NR_RE, W_RE, SOORTEN, norm, index, vind, uitPrefix, uitToggl, togglNaam, naamZonderCode, navUrl };
})(typeof window !== 'undefined' ? window : globalThis);
