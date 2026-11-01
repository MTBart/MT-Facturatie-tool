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
  X.wandFotoRec = wand => K.wandFoto(S.rec.opname, X.ruimte().id, wand);
  const slug = t => String(t || 'ruimte').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'ruimte';
  const ext = f => { const m = /\.([a-z0-9]{2,5})$/i.exec(f.name || ''); if (m) return m[1].toLowerCase(); return (f.type || '').indexOf('png') >= 0 ? 'png' : (f.type || '').indexOf('webp') >= 0 ? 'webp' : 'jpg'; };
  X.wandNaam = w => K.wandLabel(w);
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
    const basis = slug(r.naam) + '-' + (soort === 'closeup' ? 'close-' + slug(opties.item) : (wand ? slug(K.wandNaam(wand)) + (soort === 'extra' ? '-extra' : '') : 'overzicht'));
    let n = 1, naam; do { naam = basis + '-' + String(n).padStart(2, '0') + '.' + ext(file); n++; } while (bestaand.has(naam));
    const dim = await afmetingen(file), id = 'F' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    await O.zetFoto({ id: o.opname_id + ':' + id, opnameId: o.opname_id, blob: file, naam: file.name || naam, type: file.type || 'image/jpeg', grootte: file.size, breedte: dim.w, hoogte: dim.h, tijd: nu(), ruimte: r.id, wand, soort, item: opties.item || null });
    const verw = { id, bestand: naam, ruimte: r.id, wand: soort === 'closeup' ? null : wand, tijd: nu(), breedte: dim.w, hoogte: dim.h, origineel: file.name || null, grootte: file.size };
    if (soort === 'closeup') { verw.soort = 'closeup'; verw.item = opties.item; verw.op_wand = wand; }
    if (soort === 'extra') verw.soort = 'extra';
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
    if (S.kal || S.plaats || S.knik) { S.kal = null; S.plaats = null; S.knik = null; X.teken(); return true; }
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
    const kern = st === 'vrijgegeven' ? K.vrijgaveKern(rec.opname) : null;
    return st === 'vrijgegeven' ? (kern && kern.oud ? 'Vrijgegeven, oude kern v' + kern.versie : 'Vrijgegeven') : st === 'vrijgave-vervallen' ? 'Vrijgave vervallen' : st === 'opgeslagen' ? 'Opgeslagen' : 'Concept';
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
      const heeftFoto = lijst(rec.opname.fotos).some(f => f && f.soort !== 'closeup'), ronde = K.isRond(rec.opname.ruimtes[0]) && K.wandIds(rec.opname.ruimtes[0]).length >= 3;
      X.ga(heeftFoto && ronde ? 'model' : 'fotos', { wandKlaar: false, kal: null, plaats: null, modelStap: null, knik: null, fotoWand: null, werkzoneKiezen: false });
    } catch (e) { X.toast('Openen mislukt: ' + e.message); X.opslagFoutZet(e); }
  };

  // ── Scherm: start (project, ruimte, meubeltype). Geen sjabloon en geen werkzone: de vorm ontstaat uit de foto's, de werkzone kies je daarna in het model. ──
  SCHERMEN.start = function (c) {
    const F = S.formulier = S.formulier || { project: null, zoek: '', naam: '', meubeltype: 'kast' };
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
    body.appendChild(h('div', { class: 'opn-kaart opn-uitleg' }, h('div', { class: 'opn-kaart-titel', text: 'De vorm van de kamer ontstaat uit je foto\'s' }),
      h('p', { text: 'Je kiest geen vorm vooraf. Begin bij de toegangsdeur en loop met de klok mee: een foto per wand, ook als de kamer geen rechthoek is. De plattegrond groeit mee en wordt nauwkeuriger naarmate je meer meet. Waar het meubel komt (de werkzone) kies je daarna in het model.' })));
    const kn = h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', text: 'Start de fotoronde', onclick: maakOpname });
    body.appendChild(kn);
    function startKnop() { kn.disabled = !(F.project && F.naam.trim()); }
    startKnop();
    c.appendChild(body);
  };
  async function maakOpname() {
    const F = S.formulier;
    if (!(F.project && F.naam.trim())) return;
    try {
      const id = 'OPN-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      const op = K.nieuweOpname({ opname_id: id, project: { code: F.project.nr || F.project.code, naam: F.project.naam }, ruimtes: [K.nieuweRuimte({ id: 'R1', naam: F.naam.trim(), meubeltype: F.meubeltype, wanden: [] })] });
      S.rec = { id, opname: op, layout: {}, instellingen: {}, schema: 'mt-opname-app', versie: 1 };
      S.ruimteId = 'R1'; S.urls = {}; S.formulier = null; S.stapId = null; S.wandKlaar = false; S.fotoWand = null; S.werkzoneKiezen = false;
      await O.schrijf(S.rec); S.opslagFout = null;
      O.beveilig().catch(() => {});
      X.ga('fotos');
    } catch (e) { X.opslagFoutZet(e); X.toast('Opname starten mislukt: ' + (e.message || e)); }
  }

  // ── Het plattegrondkaartje: de contour van de ruimte uit de kern (K.plattegrond), groeit mee met elke foto en elke meting ──
  // Vast = gemeten, gestippeld grijs = schatting. Uitsprongen en nissen staan in blauw. Met opties.opWand zijn de wanden aantikbaar (werkzone kiezen).
  X.planKaart = function (r, o) {
    o = o || {};
    const plat = K.plattegrond(r), B = o.breed || 340, HH = o.hoog || 190, pad = 24, zone = lijst(r.werkzone);
    const svg = sv('svg', { viewBox: '0 0 ' + B + ' ' + HH, class: 'opn-plan-svg opn-plankaart', role: 'img', 'aria-label': 'Plattegrond van ' + r.naam + (plat.schatting ? ', deels een schatting' : '') });
    if (!plat.n) { svg.appendChild(sv('text', { x: B / 2, y: HH / 2, 'text-anchor': 'middle', 'font-size': 13, fill: COL.grijs, text: 'Nog geen wanden gefotografeerd' })); return svg; }
    const bb = plat.bbox, bw = Math.max(1, bb.x1 - bb.x0), bh = Math.max(1, bb.y1 - bb.y0), sc = Math.min((B - 2 * pad) / bw, (HH - 2 * pad) / bh), ox = (B - bw * sc) / 2 - bb.x0 * sc, oy = (HH - bh * sc) / 2 - bb.y0 * sc;
    const P = p => [p[0] * sc + ox, p[1] * sc + oy], f = p => p[0].toFixed(1) + ',' + p[1].toFixed(1);
    const cx = (bb.x0 + bb.x1) / 2 * sc + ox, cy = (bb.y0 + bb.y1) / 2 * sc + oy;
    if (plat.rond && plat.contour.length) svg.appendChild(sv('polygon', { points: plat.contour.map(s => f(P(s.van))).join(' '), fill: plat.schatting ? 'rgba(23,100,63,0.05)' : 'rgba(23,100,63,0.09)', stroke: 'none', 'pointer-events': 'none' }));
    const u = id => lijst(r.uitsprongen).find(x => x.id === id);
    for (const s of plat.contour) {
      const a = P(s.van), b = P(s.naar), werk = s.soort === 'wand' && zone.includes(s.wand), uitspr = s.soort !== 'wand';
      const kl = uitspr ? COL.blauw : werk ? COL.accent : (s.geschat ? '#8a8f89' : COL.donker), br = uitspr ? 3.2 : werk ? 4.6 : s.geschat ? 2 : 3;
      svg.appendChild(sv('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: kl, 'stroke-width': br, 'stroke-linecap': 'round', 'stroke-dasharray': s.geschat ? '5 3.5' : null, 'pointer-events': 'none', 'data-soort': s.soort, 'data-wand': s.wand }));
    }
    if (plat.n && (!plat.rond || (plat.sluitfout && plat.sluitfout.mm > K.TOLERANTIE.sluit && plat.vorm.status !== 'inconsistent'))) {      // de ronde is nog open of de vorm nog niet bepaald: een lichte stippellijn terug naar het begin
      const laatste = plat.wanden[plat.volgorde[plat.n - 1]], a = P(laatste.b), b = P(plat.wanden[plat.volgorde[0]].a);
      svg.appendChild(sv('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: '#c9ccc6', 'stroke-width': 1.5, 'stroke-dasharray': '2 4', 'pointer-events': 'none' }));
    }
    if (plat.rond && plat.sluitfout && plat.sluitfout.mm > K.TOLERANTIE.sluit && plat.vorm.status === 'inconsistent') {         // de wanden sluiten niet: laat zien waar het eindpunt uitkomt
      const l = plat.wanden[plat.volgorde[plat.n - 1]], a = P(l.b), b = P(plat.wanden[plat.volgorde[0]].a);
      svg.appendChild(sv('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: COL.conflict, 'stroke-width': 2, 'stroke-dasharray': '3 3', 'pointer-events': 'none' }));
      svg.appendChild(sv('circle', { cx: a[0], cy: a[1], r: 4, fill: COL.conflict, 'pointer-events': 'none' }));
    }
    // wandnummers en eventueel aantikbare wanden
    for (const w of plat.volgorde) {
      const we = plat.wanden[w], a = P(we.a), b = P(we.b), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dx = m[0] - cx, dy = m[1] - cy, dl = Math.hypot(dx, dy) || 1;
      const t = [Math.max(11, Math.min(B - 11, m[0] + dx / dl * 15)), Math.max(11, Math.min(HH - 11, m[1] + dy / dl * 15))], werk = zone.includes(w), actief = o.actief === w;
      if (o.opWand) svg.appendChild(sv('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: 'rgba(0,0,0,0.001)', 'stroke-width': 30, 'stroke-linecap': 'round', 'pointer-events': 'stroke', style: { cursor: 'pointer' }, 'data-wand': w, onclick: () => o.opWand(w) }));
      const g = sv('g', { class: 'opn-plan-nr', 'data-wand': w, 'pointer-events': o.opWand ? 'all' : 'none', role: o.opWand ? 'button' : null, tabindex: o.opWand ? '0' : null, 'aria-label': o.opWand ? K.wandLabel(w) + (werk ? ', werkzone' : '') : null, style: o.opWand ? { cursor: 'pointer' } : null, onclick: o.opWand ? () => o.opWand(w) : null },
        sv('circle', { cx: t[0], cy: t[1], r: 10.5, fill: werk ? COL.accent : '#fff', stroke: actief ? COL.rood : werk ? COL.accent : '#9a917f', 'stroke-width': actief ? 2.4 : 1.2 }),
        sv('text', { x: t[0], y: t[1] + 4.2, 'text-anchor': 'middle', 'font-size': 11.5, 'font-weight': 700, fill: werk ? '#fff' : COL.donker, text: String(we.nr) }));
      svg.appendChild(g);
    }
    // de toegangsdeur: een gouden stip aan het begin van de eerste wand
    const deur = lijst(r.openingen).find(x => x.id === r.toegangsdeur);
    if (deur && plat.wanden[deur.wand]) { const we = plat.wanden[deur.wand], a = P(we.a), b = P(we.b), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dx = cx - m[0], dy = cy - m[1], dl = Math.hypot(dx, dy) || 1;
      svg.appendChild(sv('circle', { cx: m[0] + dx / dl * 9, cy: m[1] + dy / dl * 9, r: 6.5, fill: '#d19a1f', stroke: COL.donker, 'stroke-width': 1.2, 'pointer-events': 'none' }));
      svg.appendChild(sv('text', { x: m[0] + dx / dl * 9, y: m[1] + dy / dl * 9 + 3.4, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 700, fill: COL.donker, 'pointer-events': 'none', text: 'D' })); }
    return svg;
  };
  X.planBlok = function (r, opties) {
    const plat = K.plattegrond(r), bij = [];
    if (plat.n) bij.push(plat.schatting ? 'Gestippeld is een schatting; vast is gemeten. ' + (plat.vorm.lengtes_gemeten || plat.vorm.bepaling !== 'getekend' ? K.vormLabel(plat.vorm).kort + '.' : '') : K.vormLabel(plat.vorm).kort + '.');
    if (plat.uitsprongen.length) bij.push('Blauw: ' + plat.uitsprongen.map(x => (K.UITSPRONG_SOORTEN[x.soort] || 'Uitsprong').toLowerCase()).filter((v, i, a) => a.indexOf(v) === i).join(' en ') + '.');
    if (plat.uitsprongen.some(x => x.bron && (x.bron.diepte !== 'gemeten' || x.bron.breedte !== 'gemeten' || x.bron.positie !== 'gemeten'))) bij.push('Gestippeld bij een uitsprong: foto-interpretatie (breedte, positie) of bronstandaard (diepte 300 mm) tot je het meet.');
    if (opties && opties.opWand && !opties.kies) bij.push('Tik een wandnummer om die wand te openen.');
    return h('div', { class: 'opn-kaart opn-planblok' }, opties && opties.titel ? h('div', { class: 'opn-kaart-titel', text: opties.titel }) : null, h('div', { class: 'opn-plan' }, X.planKaart(r, opties)), bij.length ? h('p', { class: 'opn-hint', text: bij.join(' ') }) : null);
  };

  // ── De hoek naar de volgende wand: standaard 90 graden (een aanname), 270 voor een inspringende hoek, of schuin met een eigen waarde ──
  X.hoekRij = function (wandId, opties) {
    opties = opties || {};
    const r = X.ruimte(), hk = K.hoekVan(r, wandId), volgende = K.wandIds(r)[(K.wandIds(r).indexOf(wandId) + 1) % K.wandIds(r).length], naarEerste = K.wandIds(r).indexOf(wandId) === K.wandIds(r).length - 1;
    const kop = opties.kop || ('Hoek tussen ' + K.wandLabel(wandId).toLowerCase() + ' en ' + (naarEerste ? 'wand 1' : K.wandLabel(volgende).toLowerCase()));
    const ververs = opties.vernieuw || (() => X.teken());
    const zet = (g, bron) => { if (X.wijzig(K.zetHoek(S.rec.opname, r.id, wandId, g, bron))) ververs(); };
    const blok = h('div', { class: 'opn-veld opn-hoekrij' }, h('div', { class: 'opn-label', text: kop }));
    const chips = h('div', { class: 'opn-chips' });
    const chip = (tekst, aan, fn) => h('button', { type: 'button', class: 'opn-chip' + (aan ? ' is-aan' : ''), 'aria-pressed': aan ? 'true' : 'false', onclick: fn }, tekst);
    const haaks90 = Math.abs(hk.graden - 90) < 0.5, haaks270 = Math.abs(hk.graden - 270) < 0.5, e0 = (lijst(r.wanden).find(x => x.id === wandId) || {}).hoek_naar_volgende;
    chips.appendChild(chip('90°', haaks90, () => zet(90, 'aanname')));
    chips.appendChild(chip('270° (hoek springt naar binnen)', haaks270, () => zet(270, 'aanname')));
    chips.appendChild(chip(hk.schuin ? hk.graden + '° schuin' : 'Schuin', hk.schuin, () => { S.hoekInvoer = S.hoekInvoer === wandId ? null : wandId; ververs(); }));
    blok.appendChild(chips);
    blok.appendChild(h('p', { class: 'opn-hint', text: hk.schuin ? (hk.bron === 'gemeten' ? 'Gemeten hoek.' : 'Geschatte hoek; meet hem of een diagonaal, dan is de vorm bepaald.') : hk.bron === 'gemeten' ? 'Bevestigd: ' + hk.graden + '° is gemeten' + (e0 && e0.driehoek ? ' (driehoek ' + e0.driehoek.a + ' - ' + e0.driehoek.b + ' - ' + e0.driehoek.c + ' mm)' : ' met een winkelhaak') + '.' : hk.graden + '° is een aanname; bevestig hem met een winkelhaak of een driehoeksmeting.' }));
    if (!hk.schuin) blok.appendChild(h('div', { class: 'opn-onderrij' }, h('button', { type: 'button', class: 'opn-btn opn-btn-klein', text: 'Haaksheid controleren', onclick: () => { S.driehoek = S.driehoek === wandId ? null : wandId; ververs(); } })));
    if (S.driehoek === wandId && !hk.schuin) blok.appendChild(driehoekPaneel(wandId, hk, zet, ververs));
    if (S.hoekInvoer === wandId) {
      const inp = h('input', { type: 'text', inputmode: 'decimal', class: 'opn-input', placeholder: 'graden, bijvoorbeeld 135', 'aria-label': 'Hoek in graden', value: hk.schuin ? String(hk.graden) : '' });
      const lees = () => { const g = parseFloat(String(inp.value).replace(',', '.')); if (!(g > 0)) { X.toast('Vul de hoek in graden in.'); return null; } return g; };
      blok.appendChild(h('div', { class: 'opn-invoerrij' }, inp, h('span', { class: 'opn-eenheid', text: '°' })));
      blok.appendChild(h('div', { class: 'opn-onderrij' },
        h('button', { type: 'button', class: 'opn-btn opn-btn-klein', text: 'Dit is een schatting', onclick: () => { const g = lees(); if (g != null) { S.hoekInvoer = null; zet(g, 'foto-voorstel'); } } }),
        h('button', { type: 'button', class: 'opn-btn opn-btn-klein', text: 'Gemeten', onclick: () => { const g = lees(); if (g != null) { S.hoekInvoer = null; zet(g, 'gemeten'); } } })));
    }
    return blok;
  };

  // Haaksheidscontrole: of met een winkelhaak (klopt, haaks), of met een driehoeksmeting (a en b vanaf de hoek langs de wanden, c ertussen). Het resultaat staat direct bij de hoek.
  function driehoekPaneel(wandId, hk, zet, ververs) {
    const veld = (label, ph) => { const i = h('input', { type: 'text', inputmode: 'decimal', class: 'opn-input', placeholder: ph, 'aria-label': label }); return i; };
    const a = veld('a in mm', '1000'), b = veld('b in mm', '1000'), c = veld('c in mm', 'afstand c');
    const getal = i => parseFloat(String(i.value).replace(',', '.'));
    const uitleg = h('p', { class: 'opn-hint', text: hk.inspringend ? 'Deze hoek springt naar binnen: meet over de hoek heen aan de buitenkant. Zet vanaf de hoek a mm langs de ene wand en b mm langs de andere (potlood), meet dan de afstand c tussen de twee punten.' : 'Zet vanaf de hoek a mm langs de ene wand en b mm langs de andere (potlood, bijvoorbeeld 1000 en 1000), meet dan de afstand c tussen de twee punten.' });
    return h('div', { class: 'opn-driehoek' }, uitleg,
      h('div', { class: 'opn-onderrij' }, h('button', { type: 'button', class: 'opn-btn opn-btn-klein', text: 'Winkelhaak: klopt, haaks', onclick: () => { S.driehoek = null; zet(hk.inspringend ? 270 : 90, 'gemeten'); } })),
      h('div', { class: 'opn-invoerrij' }, a, b, c),
      h('button', { type: 'button', class: 'opn-btn opn-btn-groot', text: 'Bereken de hoek', onclick: () => {
        const res = K.zetHoekDriehoek(S.rec.opname, X.ruimte().id, wandId, getal(a), getal(b), getal(c));
        if (!X.wijzig(res)) return; S.driehoek = null;
        X.toast(res.haaks ? 'Haaks bevestigd: ' + res.gemeten_graden.toString().replace('.', ',') + '° gemeten (marge ongeveer ' + res.onzekerheid_graden.toString().replace('.', ',') + '°).' : 'De hoek is ' + res.gemeten_graden.toString().replace('.', ',') + '°, niet haaks. Dit is nu de gemeten hoek.');
        ververs(); } }));
  }

  // ── Scherm: fotoronde. Geen vast aantal wanden: vanaf de toegangsdeur met de klok mee, een foto per wand, tot je terug bent bij de eerste wand. ──
  SCHERMEN.fotos = function (c) {
    const r = X.ruimte(), wanden = K.wandIds(r), rond = K.isRond(r) && wanden.length >= 3 && r.rond !== false;
    const laatsteZonder = wanden.length && !X.wandFotoRec(wanden[wanden.length - 1]) ? wanden[wanden.length - 1] : null;
    const huidig = S.fotoWand && wanden.includes(S.fotoWand) ? S.fotoWand : (S.fotoWand === 'nieuw' ? 'nieuw' : (rond ? wanden[0] : (laatsteZonder || 'nieuw')));
    const nieuw = huidig === 'nieuw', nr = nieuw ? wanden.length + 1 : wanden.indexOf(huidig) + 1, rec = nieuw ? null : X.wandFotoRec(huidig);
    c.appendChild(X.kop(r.naam, rond ? 'Stap 2 van 3: de foto\'s per wand' : 'Stap 2 van 3: fotoronde met de klok mee', { terugLabel: 'Naar de lijst' }));
    const body = h('div', { class: 'opn-body' });
    // wat nu
    const kaart = h('div', { class: 'opn-kaart' }, h('div', { class: 'opn-kaart-titel', text: (nieuw ? 'Nieuwe foto' : 'Foto ' + nr) + ' · ' + (nieuw || huidig ? 'wand ' + nr : '') }));
    if (!rond) {
      kaart.appendChild(h('p', { text: nr === 1 ? 'Begin bij de toegangsdeur: sta in de kamer en maak de foto van de wand met de deur. Recht van voren, met beide hoeken, de plafondrand en de vloerlijn in beeld.' : 'Loop met de klok mee naar de volgende wand en maak de foto recht van voren, met beide hoeken, de plafondrand en de vloerlijn in beeld.' }));
      kaart.appendChild(h('p', { class: 'opn-hint', text: 'Heeft de kamer een knik of een uitstekend stuk, zoals een schoorsteen of nis? Fotografeer de wand gewoon in één keer; de vorm wijs je daarna op de foto aan. Een uitsprong in de hoek mag een eigen wand zijn.' }));
    } else kaart.appendChild(h('p', { text: 'De ronde is rond. Tik een wand hieronder om de foto te bekijken of opnieuw te maken.' }));
    body.appendChild(kaart);
    // de knoppen voor de foto staan bovenaan, zodat je niet hoeft te scrollen; daaronder de hoek, de plattegrond en de wanden tot nu toe
    const kaartFoto = h('div', { class: 'opn-fotovak' });
    const toon = async () => { if (rec) { const u = await X.fotoUrl(rec.id); if (u) { X.leeg(kaartFoto); kaartFoto.appendChild(h('img', { src: u, alt: 'Foto van wand ' + nr, class: 'opn-foto' })); } } };
    if (rec) { body.appendChild(kaartFoto); toon(); } else if (!nieuw) { kaartFoto.appendChild(h('div', { class: 'opn-fotovak-leeg', text: 'Nog geen foto van deze wand' })); body.appendChild(kaartFoto); }
    // eerst het beeld veilig opslaan, daarna pas de verwijzing; bij een nieuwe wand komt de wand eerst (en bij de eerste wand de toegangsdeur)
    const maakWand = () => {
      let res = K.voegWandToe(S.rec.opname, r.id); if (!X.wijzig(res)) throw new Error(res.fout || 'wand toevoegen mislukt');
      const id = res.id;
      if (K.wandIds(X.ruimte()).length === 1) {
        res = K.voegOpeningToe(S.rec.opname, r.id, { soort: 'deur', wand: id, naam: 'toegangsdeur' }); if (!X.wijzig(res)) throw new Error(res.fout || 'toegangsdeur toevoegen mislukt');
        const z = K.zetRuimte(S.rec.opname, r.id, { toegangsdeur: res.id }); if (!X.wijzig(z)) throw new Error(z.fout || 'toegangsdeur instellen mislukt');
      }
      return id;
    };
    const vervang = async f => {
      let wand = huidig;
      if (nieuw) wand = maakWand();
      try { await X.opslaanFoto(f, { wand }); } catch (e) { if (nieuw) { const w = K.verwijderLaatsteWand(S.rec.opname, r.id); if (w.opname) X.wijzig(w); } throw e; }
      if (rec) X.wijzig(K.verwijderFoto(S.rec.opname, rec.id));
      S.fotoWand = nieuw ? 'nieuw' : (rond ? wand : 'nieuw'); X.teken();
    };
    body.appendChild(X.fotoKnop(rec ? 'Opnieuw fotograferen' : 'Foto maken', vervang, { klasse: 'opn-btn opn-btn-groot ' + (rec ? 'opn-btn-licht' : 'opn-btn-primair') }));
    body.appendChild(X.fotoKnop('Of kies een foto uit de galerij', vervang, { galerij: true, klasse: 'opn-btn opn-btn-licht' }));
    // nog een foto van hetzelfde vlak: een extra foto bij deze wand, nooit een nieuwe wand
    const extraBij = nieuw ? (wanden.length && X.wandFotoRec(wanden[wanden.length - 1]) ? wanden[wanden.length - 1] : null) : (rec ? huidig : null);
    if (extraBij) {
      if (nieuw) body.appendChild(h('p', { class: 'opn-hint', text: 'De foto hierboven wordt een nieuwe wand. Is het nog dezelfde wand als wand ' + (wanden.indexOf(extraBij) + 1) + '? Kies dan hieronder: dat wordt een extra foto, geen nieuwe wand.' }));
      body.appendChild(X.fotoKnop('Extra foto van wand ' + (wanden.indexOf(extraBij) + 1) + ' (geen nieuwe wand)', async f => { await X.opslaanFoto(f, { wand: extraBij, soort: 'extra' }); S.fotoWand = nieuw ? 'nieuw' : extraBij; X.toast('Extra foto bij wand ' + (wanden.indexOf(extraBij) + 1) + ' bewaard.'); X.teken(); }, { klasse: 'opn-btn opn-btn-licht' }));
    }
    // de hoek met de vorige wand
    if (!rond && nr >= 2) body.appendChild(X.hoekRij(wanden[nr - 2], { kop: nieuw && wanden.length >= 3 ? 'Hoek na wand ' + (nr - 1) + ' (naar wand ' + nr + ', of terug naar wand 1)' : 'Hoek tussen wand ' + (nr - 1) + ' en wand ' + nr }));
    body.appendChild(X.planBlok(r, { titel: 'Plattegrond (groeit met elke foto)', opWand: w => { S.fotoWand = w; X.teken(); } }));
    // overzicht van de wanden tot nu toe
    if (wanden.length) {
      const rij = h('div', { class: 'opn-wandrij' });
      for (const w of wanden) {
        const fr = X.wandFotoRec(w);
        rij.appendChild(h('button', { type: 'button', class: 'opn-wandtegel' + (w === huidig ? ' is-actief' : '') + (fr ? ' is-klaar' : ''), onclick: () => { S.fotoWand = w; X.teken(); } },
          h('span', { class: 'opn-wandtegel-naam', text: K.wandNaam(w) }), h('span', { class: 'opn-wandtegel-staat', text: fr ? 'foto ✓' + (K.extraFotos(S.rec.opname, r.id, w).length ? ' +' + K.extraFotos(S.rec.opname, r.id, w).length : '') : 'nog niet' })));
      }
      if (!rond) rij.appendChild(h('button', { type: 'button', class: 'opn-wandtegel opn-wandtegel-plus' + (nieuw ? ' is-actief' : ''), 'aria-label': 'Volgende wand', onclick: () => { S.fotoWand = 'nieuw'; X.teken(); } }, h('span', { class: 'opn-wandtegel-naam', text: '+' }), h('span', { class: 'opn-wandtegel-staat', text: 'volgende' })));
      body.appendChild(rij);
    }
    if (!rond) {
      const kanRond = wanden.length >= 3;
      if (kanRond && !nieuw) body.appendChild(X.hoekRij(wanden[wanden.length - 1], { kop: 'Hoek tussen wand ' + wanden.length + ' en wand 1 (terug bij het begin)' }));
      body.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-groot ' + (kanRond && !laatsteZonder ? 'opn-btn-primair' : 'opn-btn-licht'), disabled: !kanRond, text: 'Kamer rond: ik ben terug bij wand 1', onclick: () => { if (X.wijzig(K.maakRond(S.rec.opname, r.id))) { S.fotoWand = null; S.werkzoneKiezen = !lijst(X.ruimte().werkzone).length; X.ga('model'); } } }));
      if (!kanRond) body.appendChild(h('p', { class: 'opn-hint', text: 'Een kamer heeft minstens drie wanden. Maak eerst alle foto\'s en kies dan "kamer rond".' }));
      else if (laatsteZonder) body.appendChild(h('p', { class: 'opn-hint', text: 'Van wand ' + wanden.length + ' is nog geen foto. Zonder foto van een werkzone-wand kun je later niet vrijgeven.' }));
      const weg = h('button', { type: 'button', class: 'opn-link', text: 'Laatste wand weghalen', onclick: () => { const res = K.verwijderLaatsteWand(S.rec.opname, r.id); if (X.wijzig(res)) { X.toast('Wand ' + wanden.length + ' is weggehaald (bewaard in het archief).'); S.fotoWand = null; X.teken(); } } });
      if (wanden.length) body.appendChild(h('div', { class: 'opn-onderrij' }, weg));
    } else {
      body.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', text: 'Klaar, naar het draadmodel', onclick: () => { S.fotoWand = null; X.ga('model'); } }));
      body.appendChild(h('div', { class: 'opn-onderrij' }, h('button', { type: 'button', class: 'opn-link', text: 'De ronde weer openen (om een wand toe te voegen)', onclick: () => { if (X.wijzig(K.openRond(S.rec.opname, r.id))) { S.fotoWand = 'nieuw'; X.teken(); } } })));
    }
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
      const o = lijst(r.objecten).filter(x => x.wand === w && dezeCat.includes(x.type)).length + (cat === 'kozijn' ? lijst(r.openingen).filter(x => x.wand === w).length : 0) + (cat === 'afw' ? lijst(r.bijzonderheden).filter(x => x.wand === w).length + lijst(r.uitsprongen).filter(x => x.wand === w).length : 0);
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
    { const kern = st === 'vrijgegeven' ? K.vrijgaveKern(o) : null; if (kern && kern.oud) body.appendChild(h('p', { class: 'opn-waarschuwing', text: kern.tekst + ': de vrijgave blijft geldig, maar de nieuwe kern (v' + K.VERSIE + ') heeft deze opname niet opnieuw gecontroleerd. Geef hem opnieuw vrij om dat wel te doen.' })); }
    body.appendChild(X.planBlok(r, { titel: 'Plattegrond', opWand: w => X.openWand(w, null) }));
    body.appendChild(sluitKaart(r));
    // wat moet er nog voor vrijgeven (elke regel is tikbaar)
    const reden = h('div', { class: 'opn-kaart' }, h('div', { class: 'opn-kaart-titel', text: chk.kan ? 'Alles op orde voor vrijgeven' : 'Nog nodig om vrij te geven (' + chk.redenen.length + ')' }));
    for (const rd2 of chk.redenen) reden.appendChild(h('button', { type: 'button', class: 'opn-lijstrij', onclick: () => naarReden(rd2) }, h('span', { text: hoofdletter(rd2.tekst.replace(r.naam + ' - ', '').replace(r.naam + ': ', '')) }), h('span', { class: 'opn-pijl', text: '›' })));
    if (chk.kan) reden.appendChild(h('p', { class: 'opn-hint', text: 'Basis, werkzone en extra zijn compleet, het rondje is gedaan en er is een foto van elke werkzone-wand.' }));
    body.appendChild(reden);
    if (chk.waarschuwingen.length) {
      const w = h('div', { class: 'opn-kaart' }, h('div', { class: 'opn-kaart-titel', text: 'Let op' }));
      for (const x of chk.waarschuwingen) {
        if (x.code === 'onwaarschijnlijk' && !x.bevestigd) w.appendChild(h('div', { class: 'opn-waarschuwing opn-bevestig' }, h('p', { text: x.tekst + ' Blokkeert het vrijgeven tot je het bevestigt.' }),
          h('div', { class: 'opn-onderrij' }, h('button', { type: 'button', class: 'opn-btn opn-btn-klein opn-btn-primair', text: 'Klopt, bevestigen', onclick: () => { if (X.wijzig(K.bevestigOnwaarschijnlijk(S.rec.opname, r.id, x.pad))) X.teken(); } }), h('button', { type: 'button', class: 'opn-btn opn-btn-klein', text: 'Opnieuw meten', onclick: () => naarReden({ code: 'onwaarschijnlijk', pad: x.pad }) }))));
        else w.appendChild(h('p', { class: 'opn-waarschuwing', text: x.tekst + (x.code === 'onwaarschijnlijk' ? ' (bevestigd)' : '') }));
      }
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
    if (s0) sc.appendChild(h('p', { text: 'Werkzone: ' + (s0.werkzone.map(w => K.wandNaam(w).toLowerCase()).join(', ') || 'nog niet gekozen') + '. Andere wanden alleen basis (' + (s0.wanden_alleen_basis.map(w => K.wandNaam(w).toLowerCase()).join(', ') || 'geen') + '). Vorm: ' + (s0.vorm.label || '').toLowerCase() + '.' }));
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
  // De sluitcontrole in woorden: sluit de rondgang langs de wanden, wat is aangenomen en wat is gecontroleerd. Nooit stil haaks.
  function sluitKaart(r) {
    const sc = K.sluitcontrole(r), v = sc.vorm, plat = K.plattegrond(r), kaart = h('div', { class: 'opn-kaart opn-sluitkaart' }, h('div', { class: 'opn-kaart-titel', text: 'Vorm en sluitcontrole' }));
    const lab = K.vormLabel(v), pil = [lab.kort, lab.pil];
    kaart.appendChild(h('div', { class: 'opn-statusregel' }, h('span', { class: 'opn-pil opn-pil-' + pil[1], text: pil[0] }), v.sluitfout ? h('span', { class: 'opn-rij-sub', text: 'sluitfout ' + v.sluitfout.mm + ' mm' }) : null));
    kaart.appendChild(h('p', { text: v.reden || 'De wanden sluiten op elkaar.' }));
    if (v.volgende && v.volgende.tekst) kaart.appendChild(volgendeMaat(r, v));
    const hv = K.haaksheidsVoorstel(r);
    if (hv.length) kaart.appendChild(h('div', { class: 'opn-volgende' }, h('div', { class: 'opn-label', text: 'Haaksheid van de werkzone controleren' }),
      h('p', { class: 'opn-hint', text: 'Deze hoeken aan de werkzone zijn nog aangenomen. Een lokale driehoeksmeting (of winkelhaak) bevestigt ze.' }),
      h('div', { class: 'opn-chips' }, ...hv.map(x => h('button', { type: 'button', class: 'opn-chip', onclick: () => { S.driehoek = x.wand; X.blad('Hoek bij ' + K.hoekTekst(x.hoek), [X.hoekRij(x.wand, { kop: K.wandLabel(x.tussen[0]) + ' naar ' + K.wandLabel(x.tussen[1]).toLowerCase(), vernieuw: () => { X.sluitBlad(); X.teken(); } })]); } }, 'Hoek ' + K.hoekTekst(x.hoek) + ' (' + x.graden + '°, aanname)')))));
    kaart.appendChild(h('p', { class: 'opn-hint', text: 'Hoeken: ' + K.wandIds(r).map((w, i) => { const hk = K.hoekVan(r, w); return (i + 1) + ' naar ' + (i + 2 > K.wandIds(r).length ? 1 : i + 2) + ': ' + hk.graden + '°' + (hk.bron === 'aanname' ? ' (aanname)' : hk.bron === 'gemeten' ? ' (gemeten)' : ' (schatting)'); }).join(' · ') }));
    return kaart;
  }
  // De volgende benodigde maat: een diagonaal die je meteen kunt toevoegen en meten, of een controlehoek.
  function volgendeMaat(r, v) {
    const vk = v.volgende, blok = h('div', { class: 'opn-volgende' }, h('div', { class: 'opn-label', text: 'Volgende maat' }), h('p', { text: vk.tekst }));
    if ((vk.soort === 'diagonaal' || vk.soort === 'controle') && vk.van && vk.naar && !K.hoekenAangrenzend(r, vk.van, vk.naar)) {
      blok.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-klein opn-btn-primair', text: 'Meet ' + vk.van + ' - ' + vk.naar, onclick: () => {
        const bestaand = lijst(r.diagonalen).find(d => d && ((d.van === vk.van && d.naar === vk.naar) || (d.van === vk.naar && d.naar === vk.van)));
        const res = bestaand ? { opname: S.rec.opname, fout: null, id: bestaand.id } : K.voegDiagonaalToe(S.rec.opname, r.id, vk.van, vk.naar);
        if (!bestaand && !X.wijzig(res)) return; S.modelStap = 'maat:diagonalen.' + res.id + '.maten.lengte'; X.ga('model'); } }));
    }
    return blok;
  }
  function naarReden(rd) {
    if (rd.code === 'foto') { S.fotoWand = rd.wand; X.ga('fotos'); return; }
    if (rd.code === 'ronde' || rd.code === 'wanden') { S.fotoWand = null; X.ga('fotos'); return; }
    if (rd.code === 'werkzone') { S.werkzoneKiezen = true; X.ga('model'); return; }
    if (rd.code === 'rondje' || rd.code === 'rondje-later') { X.ga('rondje'); return; }
    if (rd.code === 'definitie') { const id = (rd.pad || '').split('.')[1], op = lijst(X.ruimte().openingen).find(x => x.id === id); if (op) { X.openWand(op.wand, null, id); return; } }
    if (rd.code === 'open' || rd.code === 'later') { const rt = X.route(), st = lijst(rt.stappen).find(s => !s.optioneel && (rd.code === 'later' ? s.staat === 'later' : !s.afgehandeld) && s.type !== 'rondje'); if (st) { X.naarStap(st); return; } }
    if (rd.code === 'conflict') { X.ga('model'); return; }
    if ((rd.code === 'onwaarschijnlijk' || rd.code === 'onmogelijk') && rd.pad) { const id = (rd.pad || '').split('.')[1], st = lijst(X.route().stappen).find(s => s.pad === rd.pad) || lijst(X.route().stappen).find(s => s.object === id || s.wand === id); if (st) { X.naarStap(st); return; } X.ga('model'); return; }
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
    zetToetsenbord();
    el.appendChild(h('div', { class: 'opn-fout', role: 'alert', hidden: true }));
    el.appendChild(h('div', { class: 'opn-scherm' }));
    el.appendChild(h('div', { class: 'opn-toast', role: 'status', hidden: true }));
    await X.naarLijst();
    O.beveilig().then(() => { if (S.scherm === 'lijst') X.teken(); }, () => {});
  };
  // Het schermtoetsenbord: de laag volgt de zichtbare hoogte (visualViewport), zodat het invoerveld en de knoppen eronder bereikbaar blijven. Bij weinig hoogte wordt de foto kleiner en gaat de werkbalk weg.
  function zetToetsenbord() {
    const vv = root.visualViewport; if (!vv || !S.el || S.vvPas) return;
    S.vvPas = () => {
      if (!S.el) return;
      S.el.style.top = vv.offsetTop + 'px'; S.el.style.bottom = 'auto'; S.el.style.height = vv.height + 'px'; S.el.style.setProperty('--opn-vh', vv.height + 'px'); S.el.classList.toggle('opn-klein-scherm', vv.height < 520);
      const a = doc.activeElement; if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && S.el.contains(a)) setTimeout(() => { try { a.scrollIntoView({ block: 'center' }); } catch (e) {} }, 60);
    };
    vv.addEventListener('resize', S.vvPas); vv.addEventListener('scroll', S.vvPas); S.vvPas();
  }
  M.stop = function () { try { if (S.vvPas && root.visualViewport) { root.visualViewport.removeEventListener('resize', S.vvPas); root.visualViewport.removeEventListener('scroll', S.vvPas); } } catch (e) {} S.vvPas = null; if (S.el) { S.el.style.top = ''; S.el.style.bottom = ''; S.el.style.height = ''; } for (const k of Object.keys(S.urls)) { try { URL.revokeObjectURL(S.urls[k]); } catch (e) {} } S.urls = {}; };
  M.stand = () => ({ scherm: S.scherm, wand: S.wand, stap: S.stapId });
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
