/* ============================================================================
 * mt-zoek.js — één zoekbron voor projecten, klanten, locaties, taken en contacten
 * ----------------------------------------------------------------------------
 * Zuivere zoeklogica: GEEN DOM, geen localStorage, geen window-globals nodig. De cockpit (v2),
 * de app (mobiel) en later het Outlook-paneel geven hun eigen gegevens mee via een adapter
 * (Z.bronVan) en krijgen overal dezelfde treffers in dezelfde volgorde terug.
 *
 * Stroom:   gegevens --Z.bronVan(data, h)--> bron-items --Z.index(items)--> index --Z.zoek(index, q)--> groepen
 *
 * Normalisatie (Z.norm): kleine letters, accenten weg, alles behalve a-z0-9 wordt één spatie.
 *   "Kantoor Zuidás" en "kantoor zuidas" zijn dus gelijk; "KL-AMS-01" wordt "kl ams 01". Codes worden
 *   ook zonder spaties vergeleken ("klams01" vindt "KL-AMS-01").
 *
 * Treffers: op code (project-, werk-, offertecode, oude codes), naam, alias, klantnaam en overige
 * zoektekst. Alle zoektermen (gescheiden door spaties) moeten ergens voorkomen.
 *
 * Rangorde (vast, binnen elke soort):
 *   0  exacte code of alias           (de hele zoekopdracht is gelijk aan een code/alias)
 *   1  begint met                     (code, alias of naam begint met de zoekopdracht)
 *   2  klant                          (een zoekterm zit in de klantnaam/-organisatie)
 *   3  recente activiteit             (overige treffer, activiteit binnen recentDagen — standaard 30)
 *   4  overige treffers
 * Binnen een rang: treffers op het begin van een woord vóór losse deelstrings, dan meest recent, dan op naam.
 *
 * Bron-item (wat een adapter aanlevert):
 *   { soort:'project'|'klant'|'locatie'|'taak'|'contact', id, titel, sub?, tag?,
 *     codes?:[…], alias?:[…], namen?:[…], klant?:'klantnaam', extra?:[…], recent?:ms|ISO, data?:{…} }
 *   `data` is wat de aanroeper nodig heeft om het item te openen (bv. {code}); de zoeker raakt het niet aan.
 *
 * Rechten: Z.SOORTEN[].recht is de kolom uit de rollenmatrix (mt-rollen.js). Z.zoek krijgt opts.mag(soort)
 * mee; Z.magUitRollen() bouwt zo'n functie uit MTRol. Buiten modus 'afdwingen' mag alles (zoals overal).
 * ========================================================================== */
(function (root) {
  'use strict';
  if (!root) return;

  const SOORTEN = [
    { soort: 'project', label: 'Projecten', recht: 'projecten' },
    { soort: 'klant', label: 'Klanten', recht: 'projecten' },
    { soort: 'locatie', label: 'Locaties', recht: 'projecten' },
    { soort: 'taak', label: 'Taken', recht: 'taken' },
    { soort: 'contact', label: 'Contacten', recht: 'projecten' }
  ];
  const DAG = 86400000;

  const lijst = v => Array.isArray(v) ? v : [];
  const tekst = v => String(v == null ? '' : v);
  function norm(s) {
    return tekst(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  // Tijdstip in ms uit een getal, ISO-datum of niets (0).
  function tijd(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const t = Date.parse(tekst(v));
    return isNaN(t) ? 0 : t;
  }
  const uniek = a => Array.from(new Set(a.filter(Boolean)));

  // ── index ────────────────────────────────────────────────────────────────
  // Normaliseert elk item één keer, zodat zoeken per toetsaanslag alleen nog vergelijkt.
  function index(items) {
    const uit = [];
    lijst(items).forEach(it => {
      if (!it || !it.soort || it.id == null || !tekst(it.titel).trim()) return;
      const codes = uniek(lijst(it.codes).map(norm));
      const alias = uniek(lijst(it.alias).map(norm));
      const namen = uniek([it.titel].concat(lijst(it.namen)).map(norm));
      const klant = norm(it.klant);
      const extra = uniek(lijst(it.extra).map(norm));
      uit.push({
        it, soort: it.soort,
        c: codes, cc: uniek(codes.map(c => c.replace(/ /g, ''))),
        a: alias, n: namen, k: klant,
        hooi: ' ' + uniek([].concat(codes, alias, namen, klant ? [klant] : [], extra)).join(' ') + ' ',
        recent: tijd(it.recent), t: namen[0] || ''
      });
    });
    return uit;
  }

  const begintMet = (arr, q) => arr.some(x => x === q || x.startsWith(q));

  // Rang van één geïndexeerd item voor deze zoekopdracht; -1 = geen treffer.
  function rang(e, q, qc, termen, recentVanaf) {
    if (e.c.includes(q) || e.cc.includes(qc) || e.a.includes(q)) return 0;
    if (begintMet(e.c, q) || begintMet(e.cc, qc) || begintMet(e.a, q) || begintMet(e.n, q)) return 1;
    const alle = termen.every(t => e.hooi.includes(t));
    if (!alle && !(qc.length >= 3 && e.cc.some(c => c.includes(qc)))) return -1;
    if (e.k && e.soort !== 'klant' && termen.some(t => e.k.includes(t))) return 2;
    return e.recent && e.recent >= recentVanaf ? 3 : 4;
  }

  function sorteer(a, b) {
    return (a.r - b.r) || (a.kw - b.kw) || (b.e.recent - a.e.recent) || (a.e.t < b.e.t ? -1 : a.e.t > b.e.t ? 1 : 0);
  }

  // Z.zoek(index, q, opts) → { q, groepen:[{soort,label,items,totaal,meer}], totaal }
  //   opts.max       treffers per groep (standaard 5)
  //   opts.soorten   alleen deze soorten (standaard alle)
  //   opts.mag       (soort) => bool — rechten; ontbreekt = alles
  //   opts.nu        'nu' in ms (voor tests); opts.recentDagen (standaard 30)
  // Elk item in de uitvoer: { soort, id, titel, sub, tag, data, rang }.
  function zoek(idx, q, opts) {
    opts = opts || {};
    const qn = norm(q), uit = { q: qn, groepen: [], totaal: 0 };
    if (!qn) return uit;
    const termen = qn.split(' '), qc = qn.replace(/ /g, '');
    const max = opts.max > 0 ? opts.max : 5;
    const nu = opts.nu != null ? opts.nu : Date.now();
    const recentVanaf = nu - (opts.recentDagen > 0 ? opts.recentDagen : 30) * DAG;
    const per = {};
    for (let i = 0; i < idx.length; i++) {
      const e = idx[i];
      const r = rang(e, qn, qc, termen, recentVanaf);
      if (r < 0) continue;
      let kw = 0;   // 0 = elke zoekterm begint een woord, 1 = (deels) losse deelstring
      if (r > 1) for (let j = 0; j < termen.length; j++) if (!e.hooi.includes(' ' + termen[j])) { kw = 1; break; }
      (per[e.soort] || (per[e.soort] = [])).push({ e, r, kw });
    }
    SOORTEN.forEach(s => {
      if (opts.soorten && !opts.soorten.includes(s.soort)) return;
      if (typeof opts.mag === 'function' && !opts.mag(s.soort)) return;
      const treffers = per[s.soort]; if (!treffers) return;
      treffers.sort(sorteer);
      const items = treffers.slice(0, max).map(x => ({
        soort: x.e.soort, id: x.e.it.id, titel: tekst(x.e.it.titel), sub: tekst(x.e.it.sub), tag: tekst(x.e.it.tag), data: x.e.it.data || null, rang: x.r
      }));
      uit.groepen.push({ soort: s.soort, label: s.label, items, totaal: treffers.length, meer: treffers.length - items.length });
      uit.totaal += items.length;
    });
    return uit;
  }

  // Lijkt de invoer een vraag aan Claude (in plaats van een zoekterm)? Een vraagteken of 4+ woorden.
  function isVraag(q) {
    const t = tekst(q).trim();
    return /\?/.test(t) || t.split(/\s+/).filter(Boolean).length >= 4;
  }

  // Rechtenfunctie uit mt-rollen.js (MTRol); zonder MTRol of buiten 'afdwingen' mag alles.
  function magUitRollen(rol) {
    rol = rol || root.MTRol;
    return soort => {
      if (!rol || typeof rol.mag !== 'function') return true;
      const s = SOORTEN.find(x => x.soort === soort);
      return s ? !!rol.mag(s.recht) : false;
    };
  }

  // ── adapter ──────────────────────────────────────────────────────────────
  // Z.bronVan(data, h) zet de gegevens van de aanroeper om naar bron-items.
  //   data: { projecten:[…], klanten:[…registry…], taken:{code:[…]}, contacten:[…] }
  //   h (hulpfuncties van de aanroeper, allemaal optioneel — zonder h worden de ruwe velden gebruikt):
  //     h.projectNaam(p) · h.klantNaam(p) · h.locNaam(p) · h.projectLabel(p) (zichtbaar nummer)
  //     h.contactNaam(c)
  const echt = (naam, code) => { const n = tekst(naam).trim(); return n && n.toUpperCase() !== tekst(code).trim().toUpperCase() ? n : ''; };
  // Telefoonnummer als alleen cijfers, +31/0031 → 0 (zoals mt-contacten.js het vergelijkt).
  function telCijfers(nr) {
    let s = tekst(nr).replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
    if (s.startsWith('+31')) s = '0' + s.slice(3); else if (s.startsWith('0031')) s = '0' + s.slice(4);
    return s.replace(/\D/g, '');
  }
  const STATUS = { todo: 'Todo', bezig: 'Bezig', klaar: 'Klaar' };

  function bronVan(data, h) {
    data = data || {}; h = h || {};
    const items = [];
    const projecten = lijst(data.projecten).filter(p => p && p.code && !p._vervallen);
    const pNaam = p => (h.projectNaam ? h.projectNaam(p) : tekst(p.naam)) || '';
    const pKlant = p => (h.klantNaam ? h.klantNaam(p) : tekst(p.klant_naam)) || '';
    const pLoc = p => (h.locNaam ? h.locNaam(p) : echt(p.loc_naam, p.loc)) || '';
    const pLabel = p => (h.projectLabel ? h.projectLabel(p) : tekst(p.offertenr)) || '';
    const kl = p => tekst(p.klant).toUpperCase();
    const perCode = new Map(), klantAantal = new Map(), locaties = new Map();

    projecten.forEach(p => {
      perCode.set(p.code, p);
      const k = kl(p); if (k) klantAantal.set(k, (klantAantal.get(k) || 0) + 1);
      const klantNaam = pKlant(p), locNaam = pLoc(p), label = pLabel(p);
      items.push({
        soort: 'project', id: p.code, titel: pNaam(p) || label || 'Project zonder naam',
        sub: [klantNaam, locNaam].filter(Boolean).join(' · '), tag: label,
        codes: [p.code, p.werkcode, p.offertenr, label].concat(lijst(p.legacy_codes), lijst(p.offertes).map(o => o && o.nummer)),
        alias: [], klant: klantNaam, extra: [locNaam, p.product_naam],
        recent: Math.max(tijd(p._gewijzigd), tijd(p.created)), data: { code: p.code }
      });
      const lc = tekst(p.loc).toUpperCase();
      if (k && lc && locNaam) {
        const sl = k + '/' + lc;
        if (!locaties.has(sl)) locaties.set(sl, { klant: k, loc: lc, naam: locNaam, klantNaam, recent: 0 });
        const l = locaties.get(sl); l.recent = Math.max(l.recent, tijd(p._gewijzigd), tijd(p.created));
      }
    });

    // Klanten: de registry plus klantcodes die alleen in projecten voorkomen (alleen met een echte naam).
    const klantenZien = new Set();
    lijst(data.klanten).forEach(k => {
      if (!k || !k.code) return;
      const code = tekst(k.code).toUpperCase(); klantenZien.add(code);
      const naam = echt(k.naam, code); if (!naam) return;
      const n = klantAantal.get(code) || 0;
      items.push({ soort: 'klant', id: code, titel: naam, sub: n ? n + (n === 1 ? ' project' : ' projecten') : '', tag: '', codes: [code], alias: lijst(k.aliassen), recent: 0, data: { klant: code } });
      lijst(k.locaties).forEach(l => {
        const lc = tekst(l && l.code).toUpperCase(), ln = echt(l && l.naam, lc); if (!lc || !ln) return;
        const sl = code + '/' + lc;
        if (!locaties.has(sl)) locaties.set(sl, { klant: code, loc: lc, naam: ln, klantNaam: naam, recent: 0 });
      });
    });
    projecten.forEach(p => {
      const code = kl(p); if (!code || klantenZien.has(code)) return;
      const naam = pKlant(p); if (!echt(naam, code)) return;
      klantenZien.add(code); const n = klantAantal.get(code) || 0;
      items.push({ soort: 'klant', id: code, titel: naam, sub: n + (n === 1 ? ' project' : ' projecten'), tag: '', codes: [code], recent: 0, data: { klant: code } });
    });
    locaties.forEach((l, sl) => items.push({
      soort: 'locatie', id: sl, titel: l.naam, sub: l.klantNaam, tag: '', codes: [l.loc], klant: l.klantNaam, recent: l.recent, data: { klant: l.klant, loc: l.loc }
    }));

    // Taken per projectcode.
    const taken = data.taken && typeof data.taken === 'object' ? data.taken : {};
    Object.keys(taken).forEach(code => {
      const p = perCode.get(code); if (!p) return;
      const pn = pNaam(p);
      lijst(taken[code]).forEach(t => {
        if (!t || !t.id || !tekst(t.naam).trim()) return;
        items.push({
          soort: 'taak', id: code + '/' + t.id, titel: tekst(t.naam),
          sub: [pn, STATUS[t.status] || ''].filter(Boolean).join(' · '), tag: '', codes: [], extra: [pn],
          recent: Math.max(tijd(t.ts), tijd(t.aangemaakt)), data: { code, id: t.id }
        });
      });
    });

    // Contacten (register van mt-contacten.js).
    lijst(data.contacten).forEach(c => {
      if (!c || !c.id || c._vervallen) return;
      const org = c.organisatie || {};
      const naam = h.contactNaam ? h.contactNaam(c) : (tekst(c.naam) || lijst(c.emails)[0] || tekst(org.naam));
      if (!tekst(naam).trim()) return;
      items.push({
        soort: 'contact', id: c.id, titel: naam,
        sub: [org.naam, c.functie, lijst(c.emails)[0]].filter(Boolean).join(' · '), tag: '',
        codes: lijst(c.emails), klant: tekst(org.naam),
        namen: [c.voornaam], extra: [c.functie, org.klantCode].concat(lijst(c.telefoons).map(t => telCijfers(t && t.nr))),
        recent: tijd(c._gewijzigd), data: { id: c.id }
      });
    });
    return items;
  }

  root.MTZoek = { SOORTEN, norm, tijd, index, zoek, rang, isVraag, magUitRollen, bronVan };
})(typeof window !== 'undefined' ? window : globalThis);
