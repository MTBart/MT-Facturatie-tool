// mt-opname.js — de nieuwe opname-module (brok 2, beta): start, fotoronde, lijst, rondje controle en afronden. Het draadmodel en de wandfoto met lijnenoverlay staan in
// mt-opname-model.js. Alles wat gemeten wordt rekent de kern (mt-opname-kern.js); de projectie en de wandlijnen komen uit mt-opname-geo.js; opslag is alleen lokaal in
// IndexedDB (mt-opname-opslag.js). Geen upload, geen taken, geen worker. Bouwt uitsluitend met DOM-methoden (textContent), nooit innerHTML.
// Lazy: mobiel.html laadt deze bestanden pas bij het openen van de beta-laag (zelfde patroon als mt-forecast-light.js).
(function (root) {
  'use strict';
  const M = root.MTOpname = root.MTOpname || {};
  const K = root.MTOpnameKern, G = root.MTOpnameGeo, O = root.MTOpnameOpslag, doc = root.document;
  const X = M.X = M.X || {};                                   // gedeeld met mt-opname-model.js
  X.K = K; X.G = G; X.O = O;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const COL = X.COL = { rood: '#c4322a', donker: '#1b211e', accent: '#17643f', grijs: '#8a8f89', oranje: '#c77d0a', conflict: '#d4570a', blauw: '#3e5c76' };
  const lijst = x => Array.isArray(x) ? x : [];
  const kloon = x => JSON.parse(JSON.stringify(x));
  const nu = () => new Date().toISOString();

  // ── DOM-hulpjes ──
  function zet(e, p) {
    for (const k of Object.keys(p || {})) {
      const v = p[k]; if (v === false || v == null) continue;
      if (k === 'class') e.setAttribute('class', v);
      else if (k === 'text') e.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else e.setAttribute(k, v === true ? '' : String(v));
    }
  }
  function voeg(e, kids) { for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; e.appendChild(typeof c === 'object' ? c : doc.createTextNode(String(c))); } }
  const h = X.h = (tag, p, ...kids) => { const e = doc.createElement(tag); zet(e, p); voeg(e, kids); return e; };
  const sv = X.sv = (tag, p, ...kids) => { const e = doc.createElementNS(SVGNS, tag); zet(e, p); voeg(e, kids); return e; };
  X.leeg = e => { while (e.firstChild) e.removeChild(e.firstChild); return e; };
  X.nu = nu; X.kloon = kloon; X.lijst = lijst;

  // ── Staat van de module ──
  const S = X.S = { host: null, el: null, scherm: 'lijst', rec: null, ruimteId: null, wand: null, stapId: null, modelStap: null, urls: {}, opslagFout: null, keten: Promise.resolve(), cam: { yaw: -28, pitch: 30 },
    kal: null, plaats: null, wandKlaar: false, wandFoto: null, melding: null, opnames: [], formulier: null };

  // ── Opslaan: elke wijziging gaat meteen naar IndexedDB; een fout blijft zichtbaar tot een opslag weer lukt ──
  X.bewaar = function () {
    if (!S.rec) return Promise.resolve();
    const snap = kloon(S.rec);
    S.keten = S.keten.then(() => O.schrijf(snap)).then(() => { S.opslagFout = null; X.foutBalk(); }, e => { S.opslagFout = e.message || String(e); X.foutBalk(); });
    return S.keten;
  };
  X.foutBalk = function () {
    const b = S.el && S.el.querySelector('.opn-fout'); if (!b) return;
    X.leeg(b);
    if (!S.opslagFout) { b.hidden = true; return; }
    b.hidden = false;
    b.appendChild(h('span', { text: 'Opslaan mislukt, de laatste wijziging staat alleen op het scherm. ' + S.opslagFout }));
    b.appendChild(h('button', { type: 'button', class: 'opn-fout-knop', text: 'Opnieuw proberen', onclick: () => X.bewaar() }));
  };
  X.toast = function (tekst) {
    const t = S.el && S.el.querySelector('.opn-toast'); if (!t) return;
    t.textContent = tekst; t.hidden = false; clearTimeout(X._tt);
    X._tt = setTimeout(() => { t.hidden = true; }, 3800);
  };

  // ── Opname en wijzigingen ──
  X.ruimte = () => S.rec && S.rec.opname ? S.rec.opname.ruimtes.find(r => r.id === S.ruimteId) || S.rec.opname.ruimtes[0] : null;
  X.route = () => K.routeVanOpname(S.rec.opname, X.ruimte().id, { volgorde: 'fotos-dan-rondloop' });
  X.wijzig = function (res) {
    if (!res || res.fout || !res.opname) { X.toast((res && res.fout) || 'Dat is niet gelukt.'); return false; }
    S.rec.opname = res.opname; X.bewaar(); return true;
  };
  X.zetRondje = function (wand, cat, waarde) {
    const res = K.zetRondje(X.ruimte(), wand, cat, waarde);
    if (res.fout) { X.toast(res.fout); return false; }
    const o = kloon(S.rec.opname); o.ruimtes = o.ruimtes.map(r => r.id === res.ruimte.id ? res.ruimte : r); o.bijgewerkt = nu();
    S.rec.opname = o; X.bewaar(); return true;
  };
  // Het hulpgetal positie_x (mm vanaf de linkerhoek, alleen voor de volgorde links naar rechts) heeft geen eigen kern-functie; de app zet het veld op een kopie van de opname.
  X.zetVeld = function (lijstNaam, id, veld, waarde) {
    const o = kloon(S.rec.opname), r = o.ruimtes.find(x => x.id === X.ruimte().id), e = r && lijst(r[lijstNaam]).find(x => x && x.id === id);
    if (!e) return false; e[veld] = waarde; o.bijgewerkt = nu(); S.rec.opname = o; X.bewaar(); return true;
  };
  X.wandLayout = function (wand, maak) {
    const L = S.rec.layout = S.rec.layout || {}, r = L[S.ruimteId] = L[S.ruimteId] || {};
    if (!r[wand]) { if (!maak) return {}; r[wand] = { vormen: {} }; }
    r[wand].vormen = r[wand].vormen || {}; return r[wand];
  };
  X.wandFotoRec = wand => { const l = K.fotosVan(S.rec.opname, X.ruimte().id, wand).filter(f => f.soort !== 'closeup'); return l.length ? l[l.length - 1] : null; };
  const slug = t => String(t || 'ruimte').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'ruimte';
  const ext = f => { const m = /\.([a-z0-9]{2,5})$/i.exec(f.name || ''); if (m) return m[1].toLowerCase(); return (f.type || '').indexOf('png') >= 0 ? 'png' : (f.type || '').indexOf('webp') >= 0 ? 'webp' : 'jpg'; };
  X.wandNaam = w => K.wandNaam(w) + 'wand';
  X.mm = v => v == null ? '' : String(Math.round(v * 10) / 10).replace('.', ',');

  // ── Foto's: eerst het beeld veilig in IndexedDB, dan pas de verwijzing in de opname. De originele file blijft onaangeroerd (volle resolutie, EXIF), er wordt niets hernoemd of herschreven. ──
  function afmetingen(blob) {
    return new Promise(ok => {
      const u = URL.createObjectURL(blob), i = new Image();
      i.onload = () => { const r = { w: i.naturalWidth, h: i.naturalHeight }; URL.revokeObjectURL(u); ok(r); };
      i.onerror = () => { URL.revokeObjectURL(u); ok({ w: 0, h: 0 }); };
      i.src = u;
    });
  }
  X.opslaanFoto = async function (file, opties) {
    opties = opties || {};
    const o = S.rec.opname, r = X.ruimte(), wand = opties.wand || null, soort = opties.soort || 'wand';
    const bestaand = new Set(lijst(o.fotos).concat(lijst(o.fotos_verwijderd)).map(f => f && f.bestand));
    const basis = slug(r.naam) + '-' + (soort === 'closeup' ? 'close-' + slug(opties.item) : (wand ? slug(K.wandNaam(wand)) : 'overzicht'));
    let n = 1, naam; do { naam = basis + '-' + String(n).padStart(2, '0') + '.' + ext(file); n++; } while (bestaand.has(naam));
    const dim = await afmetingen(file), id = 'F' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    await O.zetFoto({ id: o.opname_id + ':' + id, opnameId: o.opname_id, blob: file, naam: file.name || naam, type: file.type || 'image/jpeg', grootte: file.size, breedte: dim.w, hoogte: dim.h, tijd: nu(), ruimte: r.id, wand, soort, item: opties.item || null });
    const verw = { id, bestand: naam, ruimte: r.id, wand: soort === 'closeup' ? null : wand, tijd: nu(), breedte: dim.w, hoogte: dim.h, origineel: file.name || null, grootte: file.size };
    if (soort === 'closeup') { verw.soort = 'closeup'; verw.item = opties.item; verw.op_wand = wand; }
    const res = K.voegFotoToe(o, verw);
    if (!X.wijzig(res)) throw new Error(res.fout || 'verwijzing niet gelukt');
    return id;
  };
  X.fotoUrl = async function (fotoId) {
    if (!fotoId) return null;
    if (S.urls[fotoId]) return S.urls[fotoId];
    const rec = await O.leesFoto(S.rec.opname.opname_id + ':' + fotoId);
    if (!rec || !rec.blob) return null;
    return (S.urls[fotoId] = URL.createObjectURL(rec.blob));
  };
  // Een knop die de camera (of de galerij) opent: de input zit in het label zelf, zodat Android de native camera start zonder tussenstap.
  X.fotoKnop = function (tekst, bijFile, opties) {
    opties = opties || {};
    const inp = h('input', { type: 'file', accept: 'image/*', capture: opties.galerij ? false : 'environment', class: 'opn-file' });
    inp.addEventListener('change', async () => { const f = inp.files && inp.files[0]; inp.value = ''; if (f) { try { await bijFile(f); } catch (e) { X.toast('Foto opslaan mislukt: ' + (e.message || e)); X.opslagFoutZet(e); } } });
    inp.setAttribute('aria-label', tekst);
    return h('div', { class: (opties.klasse || 'opn-btn opn-btn-groot') + ' opn-fotoknop' }, h('span', { text: tekst }), inp);
  };
  X.opslagFoutZet = e => { S.opslagFout = (e && e.message) || String(e); X.foutBalk(); };

  // ── Navigatie ──
  const SCHERMEN = X.schermen = X.schermen || {};
  X.teken = function () {
    const c = S.el && S.el.querySelector('.opn-scherm'); if (!c) return;
    X.leeg(c);
    const f = SCHERMEN[S.scherm] || SCHERMEN.lijst;
    c.setAttribute('data-scherm', S.scherm);
    f(c);
  };
  X.ga = function (scherm, extra) { S.scherm = scherm; Object.assign(S, extra || {}); X.teken(); const b = S.el && S.el.querySelector('.opn-body'); if (b) b.scrollTop = 0; };
  // Terugknop (ook voor de Android-terugknop): geeft true als de module intern een stap terugging, false als de laag dicht mag.
  const TERUG = { lijst: null, start: 'lijst', fotos: 'lijst', model: 'lijst', wand: 'model', rondje: 'afronden', afronden: 'model' };
  M.terug = function () {
    if (!S.el) return false;
    if (S.kal || S.plaats) { S.kal = null; S.plaats = null; X.teken(); return true; }
    const naar = TERUG[S.scherm]; if (!naar) return false;
    if (naar === 'lijst') return X.naarLijst(), true;
    X.ga(naar, naar === 'model' ? { wandKlaar: false } : {}); return true;
  };
  X.naarLijst = async function () {
    try { S.opnames = await O.lijst(); S.opslagFout = null; } catch (e) { S.opnames = []; S.opslagFout = e.message; }
    S.rec = null; X.ga('lijst'); X.foutBalk();
  };
  X.kop = function (titel, sub, opties) {
    opties = opties || {};
    return h('header', { class: 'opn-kop' },
      h('button', { type: 'button', class: 'opn-terug', 'aria-label': opties.terugLabel || 'Terug', onclick: () => { if (!M.terug()) (S.host && S.host.sluit && S.host.sluit()); } }, opties.terugTekst || '←'),
      h('div', { class: 'opn-kop-tekst' }, h('div', { class: 'opn-titel', text: titel }), sub ? h('div', { class: 'opn-sub', text: sub }) : null),
      opties.rechts || null);
  };

  // ── Hoeveelheden voor kop en kaarten ──
  X.voortgang = function () {
    const t = K.tellers(X.ruimte()), n = t.basis.n + t.werkzone.n + t.extra.n, klaar = t.basis.compleet + t.werkzone.compleet + t.extra.compleet, later = t.basis.later + t.werkzone.later + t.extra.later;
    return { n, klaar, later, open: n - klaar - later, pct: n ? Math.round(klaar / n * 100) : 0 };
  };
  X.statusTekst = rec => {
    const st = K.effectieveStatus(rec.opname);
    return st === 'vrijgegeven' ? 'Vrijgegeven' : st === 'vrijgave-vervallen' ? 'Vrijgave vervallen' : st === 'opgeslagen' ? 'Opgeslagen' : 'Concept';
  };

  // ── Scherm: lijst ──
  SCHERMEN.lijst = function (c) {
    c.appendChild(X.kop('Opname (beta)', 'Alleen op dit toestel, niets wordt geüpload', { terugLabel: 'Sluiten' }));
    const body = h('div', { class: 'opn-body' });
    body.appendChild(h('div', { class: 'opn-kaart opn-uitleg' },
      h('div', { class: 'opn-kaart-titel', text: 'Nieuwe opname in testfase' }),
      h('p', { text: 'Maak een foto per wand, bekijk de kamer als draadmodel en meet wand voor wand met een rode lijn op de foto. De oude Capture en Rapportage blijven gewoon werken.' })));
    body.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', text: '+ Nieuwe opname', onclick: () => { S.formulier = null; X.ga('start'); } }));
    if (!S.opnames.length) body.appendChild(h('p', { class: 'opn-leeg', text: 'Nog geen opnames op dit toestel.' }));
    for (const rec of S.opnames) {
      const r = rec.opname && rec.opname.ruimtes && rec.opname.ruimtes[0] || {}, st = K.effectieveStatus(rec.opname), open = (() => { try { return K.tellers(r); } catch (e) { return null; } })();
      const klaar = open ? open.basis.compleet + open.werkzone.compleet + open.extra.compleet : 0, n = open ? open.basis.n + open.werkzone.n + open.extra.n : 0;
      body.appendChild(h('button', { type: 'button', class: 'opn-rij', onclick: () => X.openOpname(rec.id) },
        h('span', { class: 'opn-rij-hoofd' }, h('span', { class: 'opn-rij-titel', text: r.naam || 'Ruimte' }), h('span', { class: 'opn-pil opn-pil-' + (st || 'concept'), text: X.statusTekst(rec) })),
        h('span', { class: 'opn-rij-sub', text: [rec.opname && rec.opname.project && (rec.opname.project.naam || rec.opname.project.code), klaar + ' van ' + n + ' maten', datumTekst(rec.bijgewerkt)].filter(Boolean).join(' · ') })));
    }
    if (O.status.persistent === false) body.appendChild(h('p', { class: 'opn-waarschuwing', text: 'Let op: de browser kan opgeslagen foto\'s opruimen als het toestel vol raakt. Maak bij een afgeronde opname een JSON-kopie (Afronden).' }));
    c.appendChild(body);
  };
  function datumTekst(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.getDate() + '-' + (d.getMonth() + 1) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  X.openOpname = async function (id) {
    try {
      const rec = await O.lees(id); if (!rec) { X.toast('Deze opname is niet te vinden.'); return; }
      const g = K.lees(rec.opname); if (g.alleenLezen) { X.toast('Deze opname komt uit een nieuwere versie: alleen lezen is nog niet gebouwd.'); return; }
      rec.opname = g.opname; rec.layout = rec.layout || {}; rec.instellingen = rec.instellingen || {};
      S.rec = rec; S.ruimteId = rec.opname.ruimtes[0].id; S.urls = {};
      const heeftFoto = lijst(rec.opname.fotos).some(f => f && f.soort !== 'closeup');
      X.ga(heeftFoto ? 'model' : 'fotos', { wandKlaar: false, kal: null, plaats: null, modelStap: null });
    } catch (e) { X.toast('Openen mislukt: ' + e.message); X.opslagFoutZet(e); }
  };

  // ── Scherm: start (project, ruimte, meubeltype, werkzone, toegangsdeur) ──
  SCHERMEN.start = function (c) {
    const F = S.formulier = S.formulier || { project: null, zoek: '', naam: '', meubeltype: 'kast', werkzone: [], deur: null };
    c.appendChild(X.kop('Nieuwe opname', 'Stap 1 van 3: de ruimte'));
    const body = h('div', { class: 'opn-body' });
    // project: de bestaande projectenlijst van de app (allProjects), met zoeken
    body.appendChild(h('div', { class: 'opn-veld' }, h('div', { class: 'opn-label', text: 'Project' })));
    const pv = body.lastChild;
    if (F.project) pv.appendChild(h('div', { class: 'opn-gekozen' }, h('span', { text: F.project.naam + (F.project.nr ? ' · ' + F.project.nr : '') }), h('button', { type: 'button', class: 'opn-link', text: 'Wijzigen', onclick: () => { F.project = null; X.teken(); } })));
    else {
      const lijstEl = h('div', { class: 'opn-projecten' });
      const vul = () => {
        X.leeg(lijstEl);
        const q = F.zoek.trim().toLowerCase(), alle = lijst(S.host && S.host.projecten ? S.host.projecten() : []);
        const t = alle.filter(p => !q || (p.naam + ' ' + p.nr + ' ' + p.code).toLowerCase().includes(q)).slice(0, 8);
        if (!t.length) lijstEl.appendChild(h('p', { class: 'opn-leeg', text: alle.length ? 'Geen project gevonden.' : 'De projecten zijn nog niet geladen.' }));
        for (const p of t) lijstEl.appendChild(h('button', { type: 'button', class: 'opn-rij opn-rij-klein', onclick: () => { F.project = p; X.teken(); } }, h('span', { class: 'opn-rij-titel', text: p.naam }), h('span', { class: 'opn-rij-sub', text: p.nr || p.code || '' })));
      };
      pv.appendChild(h('input', { type: 'search', class: 'opn-input', placeholder: 'Zoek project of nummer', value: F.zoek, 'aria-label': 'Zoek project', oninput: ev => { F.zoek = ev.target.value; vul(); } }));
      pv.appendChild(lijstEl); vul();
    }
    body.appendChild(h('div', { class: 'opn-veld' }, h('label', { class: 'opn-label', for: 'opn-naam', text: 'Ruimte' }),
      h('input', { id: 'opn-naam', type: 'text', class: 'opn-input', placeholder: 'Bijvoorbeeld Woonkamer', value: F.naam, autocomplete: 'off', oninput: ev => { F.naam = ev.target.value; startKnop(); } })));
    body.appendChild(h('div', { class: 'opn-veld' }, h('div', { class: 'opn-label', text: 'Soort meubel' }),
      h('div', { class: 'opn-chips' }, ...K.MEUBELTYPES.map(t => {
        const actief = t === 'kast';
        return h('button', { type: 'button', class: 'opn-chip' + (F.meubeltype === t ? ' is-aan' : '') + (actief ? '' : ' is-uit'), disabled: !actief, 'aria-pressed': F.meubeltype === t ? 'true' : 'false', onclick: () => { F.meubeltype = t; X.teken(); } },
          t === 'kast' ? 'Kast' : t === 'keuken' ? 'Keuken (nog niet)' : 'Badmeubel (nog niet)');
      }))));
    // werkzone en toegangsdeur op een klein plattegrondje: kijk van boven, noord is de bovenste wand
    const plan = planSvg(F);
    body.appendChild(h('div', { class: 'opn-veld' }, h('div', { class: 'opn-label', text: 'Waar komt het meubel (werkzone)?' }),
      h('p', { class: 'opn-hint', text: 'Kijk van boven op de kamer: noord is de bovenste wand, daarna met de klok mee oost, zuid, west. Meerdere wanden mag.' }),
      h('div', { class: 'opn-chips' }, ...K.WANDEN.map(w => h('button', { type: 'button', class: 'opn-chip' + (F.werkzone.includes(w) ? ' is-aan' : ''), 'aria-pressed': F.werkzone.includes(w) ? 'true' : 'false', onclick: () => { F.werkzone = F.werkzone.includes(w) ? F.werkzone.filter(x => x !== w) : F.werkzone.concat([w]); X.teken(); } }, X.wandNaam(w))))));
    body.appendChild(h('div', { class: 'opn-veld' }, h('div', { class: 'opn-label', text: 'Waar loop je de kamer in (toegangsdeur)?' }),
      h('div', { class: 'opn-chips' }, ...K.WANDEN.map(w => h('button', { type: 'button', class: 'opn-chip' + (F.deur === w ? ' is-aan' : ''), 'aria-pressed': F.deur === w ? 'true' : 'false', onclick: () => { F.deur = w; X.teken(); } }, X.wandNaam(w)))),
      h('p', { class: 'opn-hint', text: 'De fotoronde begint bij de wand van de toegangsdeur en gaat met de klok mee.' })));
    body.appendChild(h('div', { class: 'opn-plan' }, plan));
    const kn = h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', text: 'Start de fotoronde', onclick: maakOpname });
    body.appendChild(kn);
    function startKnop() { kn.disabled = !(F.project && F.naam.trim() && F.werkzone.length && F.deur); }
    startKnop();
    c.appendChild(body);
  };
  function planSvg(F) {
    const p = (w, x1, y1, x2, y2) => sv('line', { x1, y1, x2, y2, stroke: F.werkzone.includes(w) ? COL.accent : COL.donker, 'stroke-width': F.werkzone.includes(w) ? 7 : 3, 'stroke-linecap': 'round' });
    return sv('svg', { viewBox: '0 0 220 150', class: 'opn-plan-svg', role: 'img', 'aria-label': 'Plattegrondje met noord boven' },
      p('N', 40, 30, 180, 30), p('O', 180, 30, 180, 120), p('Z', 180, 120, 40, 120), p('W', 40, 120, 40, 30),
      sv('text', { x: 110, y: 22, 'text-anchor': 'middle', 'font-size': 12, fill: COL.donker, text: 'N' }), sv('text', { x: 192, y: 78, 'font-size': 12, fill: COL.donker, text: 'O' }),
      sv('text', { x: 110, y: 140, 'text-anchor': 'middle', 'font-size': 12, fill: COL.donker, text: 'Z' }), sv('text', { x: 20, y: 78, 'font-size': 12, fill: COL.donker, text: 'W' }),
      F.deur ? sv('circle', { cx: { N: 110, O: 180, Z: 110, W: 40 }[F.deur], cy: { N: 30, O: 75, Z: 120, W: 75 }[F.deur], r: 9, fill: '#d19a1f', stroke: COL.donker, 'stroke-width': 1.5 }) : null,
      F.deur ? sv('text', { x: { N: 110, O: 180, Z: 110, W: 40 }[F.deur], y: { N: 34, O: 79, Z: 124, W: 79 }[F.deur], 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 600, fill: COL.donker, text: 'D' }) : null);
  }
  async function maakOpname() {
    const F = S.formulier;
    if (!(F.project && F.naam.trim() && F.werkzone.length && F.deur)) return;
    try {
      const id = 'OPN-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      let op = K.nieuweOpname({ opname_id: id, project: { code: F.project.nr || F.project.code, naam: F.project.naam }, ruimtes: [K.nieuweRuimte({ id: 'R1', naam: F.naam.trim(), meubeltype: F.meubeltype, werkzone: F.werkzone })] });
      let res = K.voegOpeningToe(op, 'R1', { soort: 'deur', wand: F.deur, naam: 'toegangsdeur' }); if (res.fout) throw new Error(res.fout);
      op = res.opname; res = K.zetRuimte(op, 'R1', { toegangsdeur: res.id }); if (res.fout) throw new Error(res.fout);
      S.rec = { id, opname: res.opname, layout: {}, instellingen: {}, schema: 'mt-opname-app', versie: 1 };
      S.ruimteId = 'R1'; S.urls = {}; S.formulier = null; S.stapId = null; S.wandKlaar = false;
      await O.schrijf(S.rec); S.opslagFout = null;
      O.beveilig().catch(() => {});
      X.ga('fotos');
    } catch (e) { X.opslagFoutZet(e); X.toast('Opname starten mislukt: ' + (e.message || e)); }
  }

  // ── Scherm: fotoronde (een foto per wand, met de klok mee vanaf de toegangsdeur) ──
  SCHERMEN.fotos = function (c) {
    const r = X.ruimte(), rt = X.route(), wanden = rt.foto_wanden, zonder = wanden.filter(w => !X.wandFotoRec(w));
    const huidig = S.fotoWand && wanden.includes(S.fotoWand) ? S.fotoWand : (zonder[0] || wanden[0]);
    c.appendChild(X.kop(r.naam, 'Stap 2 van 3: een foto per wand', { terugLabel: 'Naar de lijst' }));
    const body = h('div', { class: 'opn-body' });
    const rec = X.wandFotoRec(huidig), nr = wanden.indexOf(huidig) + 1;
    body.appendChild(h('div', { class: 'opn-kaart' },
      h('div', { class: 'opn-kaart-titel', text: 'Foto ' + nr + ' van 4 · ' + X.wandNaam(huidig) }),
      h('p', { text: 'Sta voor de ' + X.wandNaam(huidig).toLowerCase() + ' en maak de foto recht van voren, met beide hoeken, de plafondrand en de vloerlijn in beeld. Volle resolutie van de eigen camera; de foto wordt niet bewerkt.' }),
      huidig === rt.toegangswand ? h('p', { class: 'opn-hint', text: 'Dit is de wand met de toegangsdeur: hier begint de ronde.' }) : null));
    const kaartFoto = h('div', { class: 'opn-fotovak' });
    body.appendChild(kaartFoto);
    const toon = async () => { if (rec) { const u = await X.fotoUrl(rec.id); if (u) { X.leeg(kaartFoto); kaartFoto.appendChild(h('img', { src: u, alt: 'Foto van de ' + X.wandNaam(huidig).toLowerCase(), class: 'opn-foto' })); } } };
    if (rec) toon(); else kaartFoto.appendChild(h('div', { class: 'opn-fotovak-leeg', text: 'Nog geen foto van deze wand' }));
    // eerst de nieuwe foto veilig opslaan, daarna pas de oude verwijzing archiveren (het beeld van de oude foto blijft bewaard)
    const vervang = async f => {
      await X.opslaanFoto(f, { wand: huidig });
      if (rec) X.wijzig(K.verwijderFoto(S.rec.opname, rec.id));
      S.fotoWand = null; X.teken();
    };
    body.appendChild(X.fotoKnop(rec ? 'Opnieuw fotograferen' : 'Foto maken', vervang, { klasse: 'opn-btn opn-btn-groot ' + (rec ? 'opn-btn-licht' : 'opn-btn-primair') }));
    body.appendChild(X.fotoKnop('Of kies een foto uit de galerij', vervang, { galerij: true, klasse: 'opn-btn opn-btn-licht' }));
    // overzicht van de vier wanden
    const rij = h('div', { class: 'opn-wandrij' });
    for (const w of wanden) {
      const fr = X.wandFotoRec(w);
      rij.appendChild(h('button', { type: 'button', class: 'opn-wandtegel' + (w === huidig ? ' is-actief' : '') + (fr ? ' is-klaar' : ''), onclick: () => { S.fotoWand = w; X.teken(); } },
        h('span', { class: 'opn-wandtegel-naam', text: K.wandNaam(w) }), h('span', { class: 'opn-wandtegel-staat', text: fr ? 'foto ✓' : 'nog niet' })));
    }
    body.appendChild(rij);
    const klaar = zonder.length === 0;
    body.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-groot ' + (klaar ? 'opn-btn-primair' : 'opn-btn-licht'), text: klaar ? 'Klaar, naar het draadmodel' : 'Verder zonder alle foto\'s (' + zonder.length + ' mist)', onclick: () => { S.fotoWand = null; X.ga('model'); } }));
    if (!klaar) body.appendChild(h('p', { class: 'opn-hint', text: 'Zonder foto van een werkzone-wand kun je later niet vrijgeven. Opslaan kan altijd.' }));
    c.appendChild(body);
  };

  // ── Scherm: rondje controle (per werkzone-wand en categorie: aanwezig, afwezig of later) ──
  SCHERMEN.rondje = function (c) {
    const r = X.ruimte(), rd = K.rondje(r);
    c.appendChild(X.kop('Rondje controle', rd.bekeken + ' van ' + rd.tot + ' bekeken', { terugLabel: 'Terug naar afronden' }));
    const body = h('div', { class: 'opn-body' });
    body.appendChild(h('p', { class: 'opn-hint', text: 'Loop de werkzone-wanden na op wat je gemist kunt hebben. Kies per punt: aanwezig en vastgelegd, niet aanwezig, of later meten. Niets kiezen blijft "nog niet bekeken".' }));
    const tel = (w, cat) => {
      const dezeCat = Object.keys(K.OBJECTTYPES).filter(t => K.OBJECTTYPES[t].cat === cat);
      const o = lijst(r.objecten).filter(x => x.wand === w && dezeCat.includes(x.type)).length + (cat === 'kozijn' ? lijst(r.openingen).filter(x => x.wand === w).length : 0) + (cat === 'afw' ? lijst(r.bijzonderheden).filter(x => x.wand === w).length : 0);
      return o ? o + ' vastgelegd' : 'niets vastgelegd';
    };
    for (const w of rd.wanden) {
      const kaart = h('div', { class: 'opn-kaart' }, h('div', { class: 'opn-kaart-titel', text: X.wandNaam(w) }));
      for (const reg of rd.regels.filter(x => x.wand === w)) {
        kaart.appendChild(h('div', { class: 'opn-rondje-rij' },
          h('div', { class: 'opn-rondje-naam' }, h('span', { text: reg.naam }), h('span', { class: 'opn-rij-sub', text: tel(w, reg.categorie) })),
          h('div', { class: 'opn-chips opn-chips-klein' }, ...K.RONDJE_KEUZES.map(k => h('button', { type: 'button', class: 'opn-chip' + (reg.waarde === k ? ' is-aan' : '') + (k === 'later' && reg.waarde === k ? ' is-later' : ''), 'aria-pressed': reg.waarde === k ? 'true' : 'false', onclick: () => { if (X.zetRondje(w, reg.categorie, reg.waarde === k ? null : k)) X.teken(); } }, k === 'aanwezig' ? 'Aanwezig' : k === 'afwezig' ? 'Niet aanwezig' : 'Later')))));
      }
      body.appendChild(kaart);
    }
    body.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', text: 'Klaar, terug naar afronden', onclick: () => X.ga('afronden') }));
    c.appendChild(body);
  };

  // ── Scherm: afronden (controle, wat nog moet, opslaan, vrijgeven) ──
  SCHERMEN.afronden = function (c) {
    const o = S.rec.opname, r = X.ruimte(), t = K.tellers(r), rd = K.rondje(r), chk = K.vrijgeefCheck(o), taken = K.takenlijst(o), st = K.effectieveStatus(o);
    c.appendChild(X.kop('Afronden', r.naam, { terugLabel: 'Terug naar het model' }));
    const body = h('div', { class: 'opn-body' });
    const tegel = (naam, cnt, sub) => h('div', { class: 'opn-tegel' }, h('div', { class: 'opn-tegel-getal', text: cnt }), h('div', { class: 'opn-tegel-naam', text: naam }), sub ? h('div', { class: 'opn-tegel-sub', text: sub }) : null);
    body.appendChild(h('div', { class: 'opn-tegels' },
      tegel('Basis', t.basis.compleet + ' van ' + t.basis.n, t.basis.later ? t.basis.later + ' later' : ''),
      tegel('Werkzone', t.werkzone.compleet + ' van ' + t.werkzone.n, t.werkzone.later ? t.werkzone.later + ' later' : ''),
      tegel('Rondje', rd.bekeken + ' van ' + rd.tot, rd.later ? rd.later + ' later' : ''),
      tegel('Optioneel', t.optie.compleet + ' van ' + t.optie.n, 'mag leeg')));
    body.appendChild(h('div', { class: 'opn-statusregel' }, h('span', { class: 'opn-pil opn-pil-' + st, text: X.statusTekst(S.rec) }), st === 'vrijgave-vervallen' ? h('span', { class: 'opn-rij-sub', text: 'er is na het vrijgeven iets gewijzigd' }) : null));
    // wat moet er nog voor vrijgeven (elke regel is tikbaar)
    const reden = h('div', { class: 'opn-kaart' }, h('div', { class: 'opn-kaart-titel', text: chk.kan ? 'Alles op orde voor vrijgeven' : 'Nog nodig om vrij te geven (' + chk.redenen.length + ')' }));
    for (const rd2 of chk.redenen) reden.appendChild(h('button', { type: 'button', class: 'opn-lijstrij', onclick: () => naarReden(rd2) }, h('span', { text: hoofdletter(rd2.tekst.replace(r.naam + ' - ', '').replace(r.naam + ': ', '')) }), h('span', { class: 'opn-pijl', text: '›' })));
    if (chk.kan) reden.appendChild(h('p', { class: 'opn-hint', text: 'Basis, werkzone en extra zijn compleet, het rondje is gedaan en er is een foto van elke werkzone-wand.' }));
    body.appendChild(reden);
    if (chk.waarschuwingen.length) {
      const w = h('div', { class: 'opn-kaart' }, h('div', { class: 'opn-kaart-titel', text: 'Let op (blokkeert niet)' }));
      for (const x of chk.waarschuwingen) w.appendChild(h('p', { class: 'opn-waarschuwing', text: x.tekst }));
      body.appendChild(w);
    }
    // Nameten: de lijst die later taken wordt (in deze beta alleen een lijst, geen taken)
    const nm = h('div', { class: 'opn-kaart' }, h('div', { class: 'opn-kaart-titel', text: 'Nameten (' + taken.length + ')' }));
    if (!taken.length) nm.appendChild(h('p', { class: 'opn-hint', text: 'Niets op later gezet.' }));
    for (const tk of taken) nm.appendChild(h('p', { class: 'opn-nameten', text: tk.tekst + (tk.reden ? ' — ' + tk.reden : '') }));
    if (taken.length) nm.appendChild(h('p', { class: 'opn-hint', text: 'In deze testversie worden hier nog geen taken van gemaakt. De lijst staat bij de opname.' }));
    body.appendChild(nm);
    // scope en uitzonderingen: wat de vrijgave straks zegt
    const sc = h('div', { class: 'opn-kaart' }, h('div', { class: 'opn-kaart-titel', text: 'Wat de vrijgave zegt' }));
    const s0 = chk.scope[0];
    if (s0) sc.appendChild(h('p', { text: 'Werkzone: ' + (s0.werkzone.map(w => K.wandNaam(w).toLowerCase()).join(', ') || 'nog niet gekozen') + '. Andere wanden alleen basis (' + (s0.wanden_alleen_basis.map(w => K.wandNaam(w).toLowerCase()).join(', ') || 'geen') + '). Vorm: ' + vormTekst(s0.vorm) + '.' }));
    if (chk.uitzonderingen.length) { sc.appendChild(h('div', { class: 'opn-label', text: 'Uitzonderingen (' + chk.uitzonderingen.length + ')' })); for (const u of chk.uitzonderingen) sc.appendChild(h('p', { class: 'opn-nameten', text: u.tekst || u.omschrijving || JSON.stringify(u) })); }
    else sc.appendChild(h('p', { class: 'opn-hint', text: 'Geen uitzonderingen.' }));
    body.appendChild(sc);
    body.appendChild(h('div', { class: 'opn-knoppen' },
      h('button', { type: 'button', class: 'opn-btn opn-btn-licht', text: 'Rondje controle (' + rd.bekeken + ' van ' + rd.tot + ')', onclick: () => X.ga('rondje') }),
      h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', text: 'Opslaan', onclick: opslaan }),
      h('button', { type: 'button', class: 'opn-btn opn-btn-groot', text: 'Vrijgeven voor maatwerk', disabled: !chk.kan, onclick: () => vrijgeven(chk) }),
      !chk.kan ? h('p', { class: 'opn-hint', text: 'Vrijgeven kan pas als alle punten hierboven opgelost zijn. Opslaan kan altijd.' }) : null,
      h('button', { type: 'button', class: 'opn-btn opn-btn-licht', text: 'JSON-kopie bewaren op dit toestel', onclick: jsonKopie })));
    c.appendChild(body);
  };
  const hoofdletter = t => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  function vormTekst(v) { return v.schematisch ? 'schematisch (nog niet bepaald of niet gecontroleerd)' : v.afwijkend ? 'bepaald, niet rechthoekig' : 'bepaald en gecontroleerd'; }
  function naarReden(rd) {
    if (rd.code === 'foto') { S.fotoWand = rd.wand; X.ga('fotos'); return; }
    if (rd.code === 'rondje' || rd.code === 'rondje-later') { X.ga('rondje'); return; }
    if (rd.code === 'definitie') { const id = (rd.pad || '').split('.')[1], op = lijst(X.ruimte().openingen).find(x => x.id === id); if (op) { X.openWand(op.wand, null, id); return; } }
    if (rd.code === 'open' || rd.code === 'later') { const rt = X.route(), st = lijst(rt.stappen).find(s => !s.optioneel && (rd.code === 'later' ? s.staat === 'later' : !s.afgehandeld) && s.type !== 'rondje'); if (st) { X.naarStap(st); return; } }
    if (rd.code === 'conflict') { X.ga('model'); return; }
    X.toast('Dit los je bij het model of de start op.');
  }
  async function opslaan() {
    const res = K.slaOp(S.rec.opname); if (res.fout) { X.toast(res.fout); return; }
    S.rec.opname = res.opname;
    try { await X.bewaar(); if (S.opslagFout) return; const s = res.samenvatting; X.toast('Opgeslagen: ' + s.gemeten + ' gemeten, ' + s.open + ' open, ' + s.later + ' op later (' + s.taken + ' nameten).'); X.teken(); }
    catch (e) { X.opslagFoutZet(e); }
  }
  function vrijgeven(chk) {
    const c = S.el.querySelector('.opn-scherm');
    const blad = h('div', { class: 'opn-blad-bg', onclick: ev => { if (ev.target === blad) blad.remove(); } },
      h('div', { class: 'opn-blad', role: 'dialog', 'aria-label': 'Vrijgeven voor maatwerk' },
        h('div', { class: 'opn-kaart-titel', text: 'Vrijgeven voor maatwerk' }),
        h('p', { text: 'Je geeft ' + X.ruimte().naam + ' vrij met werkzone ' + (chk.scope[0].werkzone.map(w => K.wandNaam(w).toLowerCase()).join(', ')) + '. Wijzig je hierna iets, dan vervalt de vrijgave vanzelf.' }),
        chk.uitzonderingen.length ? h('p', { class: 'opn-waarschuwing', text: chk.uitzonderingen.length + ' uitzondering(en) komen in het rapport.' }) : h('p', { class: 'opn-hint', text: 'Volledig gemeten, zonder uitzonderingen.' }),
        h('div', { class: 'opn-knoppen' },
          h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', text: 'Bevestig vrijgeven', onclick: async () => {
            const res = K.vrijgeven(S.rec.opname, S.host && S.host.door ? S.host.door() : null); blad.remove();
            if (res.fout || !res.opname) { X.toast(res.fout || 'Vrijgeven lukte niet.'); return; }
            S.rec.opname = res.opname; await X.bewaar(); if (!S.opslagFout) { X.toast('Vrijgegeven voor maatwerk.'); X.teken(); }
          } }),
          h('button', { type: 'button', class: 'opn-btn opn-btn-licht', text: 'Annuleren', onclick: () => blad.remove() }))));
    c.appendChild(blad);
  }
  function jsonKopie() {
    try {
      const data = { app: 'mt-opname-beta', gemaakt: nu(), opname: S.rec.opname, layout: S.rec.layout, instellingen: S.rec.instellingen };
      const b = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), u = URL.createObjectURL(b), a = h('a', { href: u, download: S.rec.opname.opname_id + '.json' });
      S.el.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); X.toast('JSON-kopie bewaard in de downloads van dit toestel (zonder de foto\'s zelf).');
    } catch (e) { X.toast('Kopie maken mislukt: ' + e.message); }
  }

  // ── Opstarten ──
  // host: { projecten(): [{code, naam, nr}], door(): naam, sluit(): void }
  M.start = async function (el, host) {
    S.host = host || {}; S.el = el; X.leeg(el);
    el.classList.add('opn');
    el.appendChild(h('div', { class: 'opn-fout', role: 'alert', hidden: true }));
    el.appendChild(h('div', { class: 'opn-scherm' }));
    el.appendChild(h('div', { class: 'opn-toast', role: 'status', hidden: true }));
    await X.naarLijst();
    O.beveilig().then(() => { if (S.scherm === 'lijst') X.teken(); }, () => {});
  };
  M.stop = function () { for (const k of Object.keys(S.urls)) { try { URL.revokeObjectURL(S.urls[k]); } catch (e) {} } S.urls = {}; };
  M.stand = () => ({ scherm: S.scherm, wand: S.wand, stap: S.stapId });
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
