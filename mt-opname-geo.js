// mt-opname-geo.js — pure reken- en projectiefuncties voor de opname-schermen (brok 2), zonder DOM en zonder netwerk, zodat ze in node te testen zijn.
// Drie dingen:
//   1. Homografie: vier hoeken van een wand op de foto (links onder, rechts onder, rechts boven, links boven) leggen vast waar de wand in de foto zit.
//      Daarmee gaat elk punt van de wand (u langs de wand, v omhoog, beide 0 tot 1) naar het beeld, en elk getikt punt van het beeld terug naar de wand.
//   2. Draadmodel: de kamer als eenvoudig 3D-lijnenmodel (eigen projectie, geen bibliotheek). Gemeten wandlengtes en de vorm uit de kern, anders een duidelijk
//      gelabelde schatting.
//   3. Wandlijnen: per wand de lijnen die bij de maatvragen van de kern horen (wandlengte, plafondhoogte, opening, object), in mm in de wand zelf (x langs de wand
//      vanaf de linkerhoek, y omhoog vanaf de vloer). De lijn van een vraag hoort bij hetzelfde pad als de vraag van de kern (bijvoorbeeld wanden.N.maten.lengte).
// Niets hier verzint een maat: een lijn zonder maat is een schatting van de plek (grijs, gestippeld) en de app zegt dat ook zo. De getallen komen alleen uit de kern.
(function (root) {
  'use strict';
  const G = root.MTOpnameGeo = root.MTOpnameGeo || {};
  const K = root.MTOpnameKern || (typeof require !== 'undefined' ? require('./mt-opname-kern.js') : null);
  const lijst = x => Array.isArray(x) ? x : [];
  const getal = x => typeof x === 'number' && isFinite(x);
  const vind = (arr, id) => lijst(arr).find(e => e && e.id === id);

  // ── 1. Homografie ──
  // Oplossen van de 8 onbekenden met Gauss-eliminatie (met kiezen van de beste rij). src en dst zijn lijsten van vier [x, y]-punten.
  G.homografie = function (src, dst) {
    if (!Array.isArray(src) || !Array.isArray(dst) || src.length !== 4 || dst.length !== 4) return null;
    const A = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    for (let c = 0; c < 8; c++) {
      let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-12) return null;
      const t = A[c]; A[c] = A[p]; A[p] = t;
      for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]; }
    }
    const h = []; for (let i = 0; i < 8; i++) h.push(A[i][8] / A[i][i]);
    h.push(1); return h;
  };
  G.pas = function (h, p) {
    if (!h || !p) return null;
    const w = h[6] * p[0] + h[7] * p[1] + h[8];
    if (Math.abs(w) < 1e-12) return null;
    return [(h[0] * p[0] + h[1] * p[1] + h[2]) / w, (h[3] * p[0] + h[4] * p[1] + h[5]) / w];
  };
  G.inverse = function (h) {
    if (!h) return null;
    const [a, b, c, d, e, f, g, i, j] = h;
    const det = a * (e * j - f * i) - b * (d * j - f * g) + c * (d * i - e * g);
    if (Math.abs(det) < 1e-18) return null;
    return [(e * j - f * i) / det, (c * i - b * j) / det, (b * f - c * e) / det, (f * g - d * j) / det, (a * j - c * g) / det, (c * d - a * f) / det, (d * i - e * g) / det, (b * g - a * i) / det, (a * e - b * d) / det];
  };
  // De vier hoekpunten moeten een bolle vierhoek vormen met een vaste draairichting en een zichtbare oppervlakte.
  G.hoekenGeldig = function (h4) {
    if (!Array.isArray(h4) || h4.length !== 4 || h4.some(p => !Array.isArray(p) || !getal(p[0]) || !getal(p[1]))) return false;
    let teken = 0, opp = 0;
    for (let i = 0; i < 4; i++) {
      const a = h4[i], b = h4[(i + 1) % 4], c = h4[(i + 2) % 4];
      const kruis = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(kruis) < 1e-9) return false;
      const t = kruis > 0 ? 1 : -1; if (teken && t !== teken) return false; teken = t;
      opp += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(opp) / 2 > 1e-6;
  };
  // Een afbeelding van de wand: hoeken in beeldruimte in de volgorde links onder, rechts onder, rechts boven, links boven. Geeft { naarBeeld(u, v), naarWand(x, y) } of null.
  G.wandAfbeelding = function (hoeken) {
    if (!G.hoekenGeldig(hoeken)) return null;
    const heen = G.homografie([[0, 0], [1, 0], [1, 1], [0, 1]], hoeken), terug = G.inverse(heen);
    if (!heen || !terug) return null;
    return { naarBeeld: (u, v) => G.pas(heen, [u, v]), naarWand: (x, y) => G.pas(terug, [x, y]) };
  };
  // Schematisch wandaanzicht zonder foto: een rechthoek van breedte b en hoogte (breedte x hoogte/lengte).
  G.schemaHoeken = function (lengteMm, hoogteMm, breedte) {
    const b = breedte || 1000, h = Math.max(40, Math.round(b * (hoogteMm / Math.max(1, lengteMm))));
    return { hoeken: [[0, h], [b, h], [b, 0], [0, 0]], breedte: b, hoogte: h };
  };

  // ── 2. Draadmodel ──
  const STANDAARD = { breedte: 4000, diepte: 3000, hoogte: 2600 };
  const WAND_HOEKEN = { N: ['NW', 'NO'], O: ['NO', 'ZO'], Z: ['ZO', 'ZW'], W: ['ZW', 'NW'] };
  G.WAND_HOEKEN = WAND_HOEKEN;
  const gem = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const meting = (ent, sleutel) => (ent && ent.maten && ent.maten[sleutel]) ? K.waarde(ent.maten[sleutel]) : null;

  // De kamer in mm: de vier hoekpunten in het plattegrondvlak (x = oost, y = zuid), de hoogte en wat daarvan een schatting is.
  G.kamer = function (ruimte) {
    const r = ruimte || {}, vorm = K.vorm(r);
    const len = {}; for (const w of K.WANDEN) len[w] = meting(vind(r.wanden, w), 'lengte');
    let punten, vormSchatting;
    if (vorm.hoekpunten_mm && vorm.status !== 'inconsistent') { punten = vorm.hoekpunten_mm; vormSchatting = vorm.status !== 'consistent'; }
    else {
      const b = gem([len.N, len.Z].filter(getal)), d = gem([len.O, len.W].filter(getal));
      const B = b != null ? b : STANDAARD.breedte, D = d != null ? d : STANDAARD.diepte;
      punten = { NW: [0, 0], NO: [B, 0], ZO: [B, D], ZW: [0, D] }; vormSchatting = true;
    }
    const pp = lijst(r.plafondpunten).map(p => meting(p, 'hoogte')).filter(getal), wandHoog = [];
    for (const w of K.WANDEN) for (const s of ['plafond_links', 'plafond_midden', 'plafond_rechts']) { const v = meting(vind(r.wanden, w), s); if (getal(v)) wandHoog.push(v); }
    const hoogte = pp.length ? gem(pp) : wandHoog.length ? gem(wandHoog) : STANDAARD.hoogte;
    const wanden = {};
    for (const w of K.WANDEN) {
      const [van, naar] = WAND_HOEKEN[w], a = punten[van], b = punten[naar], koorde = Math.hypot(b[0] - a[0], b[1] - a[1]);
      wanden[w] = { van, naar, a, b, koorde, lengte: getal(len[w]) ? len[w] : koorde, lengteGemeten: getal(len[w]) };
    }
    return { punten, hoogte, hoogteGeschat: !(pp.length || wandHoog.length), vormGeschat: vormSchatting, vormStatus: vorm.status, wanden };
  };
  // Punt op een wand: x mm langs de wand vanaf de linkerhoek (kijkend naar de wand), y mm omhoog -> [oost, zuid, omhoog]
  G.wandNaar3D = function (kamer, wand, x, y) {
    const w = kamer.wanden[wand], t = w.koorde ? x / w.lengte : 0;
    return [w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t, y];
  };
  // Camera: yaw (graden, om de verticale as) en pitch (graden boven de horizon). straal = grootste afstand van het midden tot een hoekpunt.
  G.camera = function (kamer, yaw, pitch) {
    const xs = [], ys = []; for (const k of Object.keys(kamer.punten)) { xs.push(kamer.punten[k][0]); ys.push(kamer.punten[k][1]); }
    const cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, cy = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2, cz = kamer.hoogte / 2;
    let straal = 0; for (const k of Object.keys(kamer.punten)) straal = Math.max(straal, Math.hypot(kamer.punten[k][0] - cx, kamer.punten[k][1] - cy, kamer.hoogte / 2));
    const ya = (yaw || 0) * Math.PI / 180, pi = Math.max(5, Math.min(85, pitch == null ? 30 : pitch)) * Math.PI / 180;
    return { cx, cy, cz, straal: straal || 1, cosY: Math.cos(ya), sinY: Math.sin(ya), cp: Math.cos(pi), sp: Math.sin(pi), afstand: 6 * (straal || 1) };
  };
  // Eén punt [oost, zuid, omhoog] naar het scherm: { x, y, d } in eenheden van de straal (x rechts, y omlaag), d = hoe dicht bij de kijker (groter is dichterbij).
  G.projecteer = function (cam, p) {
    const x = p[0] - cam.cx, y = p[1] - cam.cy, z = p[2] - cam.cz;
    const x1 = x * cam.cosY - y * cam.sinY, y1 = x * cam.sinY + y * cam.cosY;
    const omhoog = z * cam.cp + y1 * cam.sp, dichtbij = -y1 * cam.cp + z * cam.sp;
    const s = cam.afstand / (cam.afstand - dichtbij);
    return { x: x1 * s / cam.straal, y: -omhoog * s / cam.straal, d: dichtbij };
  };
  // Welke twee wanden zijn de achterwanden (verste van de kijker): die kun je aantikken als vlak, de voorste twee alleen via hun label.
  G.achterwanden = function (kamer, cam) {
    const d = K.WANDEN.map(w => { const m = G.wandNaar3D(kamer, w, kamer.wanden[w].lengte / 2, kamer.hoogte / 2); return { w, d: G.projecteer(cam, m).d }; });
    d.sort((a, b) => a.d - b.d); return d.slice(0, 2).map(x => x.w);
  };

  // ── 3. Wandlijnen ──
  const STANDAARD_OPENING = { raam: { b: 1200, h: 1200, borst: 900 }, deur: { b: 900, h: 2100, borst: 0 } };
  const STANDAARD_OBJECT = { stopcontact: 300, schakelaar: 1050, leiding: 600, overig: 1000 };
  const PLINT_STANDAARD = 80;
  G.PLAFOND_UIT_HOEK = K.PLAFOND_UIT_HOEK;

  // Waarde voor tekenen: gemeten, anders het grijze voorstel, anders een standaardwaarde (altijd als schatting herkenbaar).
  function maatWaarde(ent, sleutel, standaard) {
    const m = ent && ent.maten ? ent.maten[sleutel] : null, w = K.waarde(m);
    if (getal(w)) return { mm: w, gemeten: true };
    if (m && m.voorstel && getal(m.voorstel.schatting_mm)) return { mm: m.voorstel.schatting_mm, gemeten: false, voorstel: true };
    return { mm: standaard, gemeten: false };
  }

  // Het model van één wand. layout.vormen[id] = { u0, u1, v0, v1 } (onderdelen als fracties 0..1 van de wand, door de opnemer getikt op de foto of het schema).
  // Geeft { lengte, hoogte, lengteGemeten, hoogteGeschat, vormen[], lijnen[] }. Elke lijn: { pad, a:[x,y], b:[x,y], label, groep, item }.
  G.wandModel = function (ruimte, wand, kamer, layout) {
    const r = ruimte || {}, k = kamer || G.kamer(r), w = k.wanden[wand], L = w.lengte;
    const vormen = (layout && layout.vormen) || {}, we = vind(r.wanden, wand);
    // hoogte van de wand: gemiddelde van de gemeten plafondpunten op deze wand, anders de kamerhoogte
    const eigenHoog = ['plafond_links', 'plafond_midden', 'plafond_rechts'].map(s => meting(we, s)).filter(getal);
    const H = eigenHoog.length ? Math.max.apply(null, eigenHoog) : k.hoogte, hoogteGeschat = !eigenHoog.length && k.hoogteGeschat;
    const m = { wand, lengte: L, hoogte: H, lengteGemeten: w.lengteGemeten, hoogteGeschat, vormen: [], lijnen: [], hoek_links: w.van, hoek_rechts: w.naar };
    const lijn = (pad, a, b, label, groep, item) => m.lijnen.push({ pad, a, b, label, groep, item: item || null });
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const fr = (id, u0, u1, v0, v1) => { const f = vormen[id]; return f ? { x0: f.u0 * L, x1: f.u1 * L, y0: f.v0 * H, y1: f.v1 * H, getikt: true } : null; };

    // de wand zelf: lengte op drie hoogtes (werkzone), plafondhoogte op drie punten (werkzone)
    const inZone = lijst(r.werkzone).includes(wand);
    lijn('wanden.' + wand + '.maten.lengte', [0, 1000], [L, 1000], 'wandlengte', 'wand');
    if (inZone) {
      lijn('wanden.' + wand + '.maten.lengte_onder', [0, 150], [L, 150], 'lengte onderaan', 'wand');
      lijn('wanden.' + wand + '.maten.lengte_boven', [0, H - 150], [L, H - 150], 'lengte bovenaan', 'wand');
      lijn('wanden.' + wand + '.maten.plafond_links', [K.PLAFOND_UIT_HOEK, 0], [K.PLAFOND_UIT_HOEK, H], 'plafond links', 'wand');
      lijn('wanden.' + wand + '.maten.plafond_midden', [L / 2, 0], [L / 2, H], 'plafond midden', 'wand');
      lijn('wanden.' + wand + '.maten.plafond_rechts', [L - K.PLAFOND_UIT_HOEK, 0], [L - K.PLAFOND_UIT_HOEK, H], 'plafond rechts', 'wand');
    }

    // plaatsing van onderdelen zonder getikte plek: gelijkmatig verdeeld over de wand, in de volgorde van de lijst
    const ongeplaatst = [];
    const openingen = lijst(r.openingen).filter(o => o && o.id && o.wand === wand), objecten = lijst(r.objecten).filter(o => o && o.id && o.wand === wand && o.type !== 'plint' && o.type !== 'vensterbank');
    for (const o of openingen.concat(objecten)) if (!vormen[o.id] && !getal(o.positie_x) && !(openingen.includes(o) && getal(meting(o, 'positie'))) && !(!openingen.includes(o) && getal(meting(o, 'afstand')))) ongeplaatst.push(o.id);
    const slotX = id => { const i = ongeplaatst.indexOf(id); return i < 0 ? null : (i + 1) / (ongeplaatst.length + 1) * L; };

    // openingen
    for (const o of openingen) {
      const std = STANDAARD_OPENING[o.soort] || STANDAARD_OPENING.raam;
      const bw = maatWaarde(o, 'breedte', std.b), hw = maatWaarde(o, 'hoogte', std.h), bo = maatWaarde(o, 'borstwering', std.borst), po = maatWaarde(o, 'positie', null);
      let s = fr(o.id);
      if (!s) {
        const x0 = getal(o.positie_x) ? o.positie_x : (po.gemeten ? po.mm : (slotX(o.id) - bw.mm / 2));
        const x0c = clamp(x0, 0, Math.max(0, L - bw.mm));
        s = { x0: x0c, x1: x0c + bw.mm, y0: bo.mm, y1: bo.mm + hw.mm, getikt: false };
      }
      const geschat = !(bw.gemeten && hw.gemeten);
      m.vormen.push({ id: o.id, soort: o.soort, type: o.soort, naam: (o.soort === 'deur' ? 'Deur ' : 'Raam ') + (o.naam || o.id), x0: s.x0, x1: s.x1, y0: s.y0, y1: s.y1, geschat, getikt: s.getikt, rect: true });
      const w1 = s.x1 - s.x0, h1 = s.y1 - s.y0, ym = (s.y0 + s.y1) / 2, P = 'openingen.' + o.id + '.maten.';
      lijn(P + 'breedte', [s.x0, s.y1], [s.x1, s.y1], 'breedte', 'opening', o.id);
      lijn(P + 'hoogte', [s.x0 + w1 * 0.8, s.y0], [s.x0 + w1 * 0.8, s.y1], 'hoogte', 'opening', o.id);
      lijn(P + 'positie', [0, ym], [s.x0, ym], 'tot linkerhoek', 'opening', o.id);
      if (o.soort !== 'deur') lijn(P + 'borstwering', [s.x0 + w1 * 0.25, 0], [s.x0 + w1 * 0.25, s.y0], 'borstwering', 'opening', o.id);
      lijn(P + 'positie_rechts', [s.x1, ym - h1 * 0.2], [L, ym - h1 * 0.2], 'tot rechterhoek', 'opening', o.id);
    }

    // objecten
    for (const ob of objecten) {
      const P = 'objecten.' + ob.id + '.maten.', zijRechts = ob.hoek === w.naar;
      if (ob.type === 'radiator') {
        const bw = maatWaarde(ob, 'breedte', 900), hw = maatWaarde(ob, 'hoogte', 600), on = maatWaarde(ob, 'onderkant', 100);
        let s = fr(ob.id);
        if (!s) { const x0c = clamp(getal(ob.positie_x) ? ob.positie_x : (slotX(ob.id) - bw.mm / 2), 0, Math.max(0, L - bw.mm)); s = { x0: x0c, x1: x0c + bw.mm, y0: on.mm, y1: on.mm + hw.mm, getikt: false }; }
        m.vormen.push({ id: ob.id, soort: 'object', type: 'radiator', naam: 'Radiator ' + ob.id, x0: s.x0, x1: s.x1, y0: s.y0, y1: s.y1, geschat: !(bw.gemeten && hw.gemeten), getikt: s.getikt, rect: true });
        const w1 = s.x1 - s.x0;
        lijn(P + 'breedte', [s.x0, s.y1], [s.x1, s.y1], 'breedte', 'object', ob.id);
        lijn(P + 'hoogte', [s.x0 + w1 * 0.8, s.y0], [s.x0 + w1 * 0.8, s.y1], 'hoogte', 'object', ob.id);
        lijn(P + 'onderkant', [s.x0 + w1 * 0.25, 0], [s.x0 + w1 * 0.25, s.y0], 'onderkant', 'object', ob.id);
        continue;
      }
      const std = STANDAARD_OBJECT[ob.type] != null ? STANDAARD_OBJECT[ob.type] : 1000;
      const hg = maatWaarde(ob, ob.type === 'leiding' ? 'kraan' : 'hoogte', std), af = maatWaarde(ob, 'afstand', null);
      let px, py;
      const f = vormen[ob.id];
      if (f) { px = ((f.u0 + f.u1) / 2) * L; py = ((f.v0 + f.v1) / 2) * H; }
      else { px = af.gemeten ? (zijRechts ? L - af.mm : af.mm) : (getal(ob.positie_x) ? ob.positie_x : slotX(ob.id)); py = hg.mm; }
      m.vormen.push({ id: ob.id, soort: 'object', type: ob.type, naam: (K.OBJECTTYPES[ob.type] ? K.OBJECTTYPES[ob.type].naam : ob.type) + ' ' + ob.id, x: px, y: py, geschat: !(hg.gemeten && af.gemeten), getikt: !!f, rect: false });
      if (ob.type === 'leiding') lijn(P + 'kraan', [px, 0], [px, py], 'kraanhoogte', 'object', ob.id);
      else if (ob.type === 'stopcontact' || ob.type === 'schakelaar') lijn(P + 'hoogte', [px, 0], [px, py], 'hoogte', 'object', ob.id);
      lijn(P + 'afstand', zijRechts ? [px, py + 120] : [0, py + 120], zijRechts ? [L, py + 120] : [px, py + 120], zijRechts ? 'tot rechterhoek' : 'tot linkerhoek', 'object', ob.id);
      if (ob.type === 'stopcontact' || ob.type === 'schakelaar') lijn(P + 'afdek', [px - 40, py - 120], [px + 40, py - 120], 'afdekraam', 'object', ob.id);
    }

    // vensterbanken hangen aan hun opening
    for (const vb of lijst(r.objecten).filter(o => o && o.type === 'vensterbank' && o.wand === wand)) {
      const op = vb.opening ? m.vormen.find(v => v.id === vb.opening) : null, P = 'objecten.' + vb.id + '.maten.';
      const di = maatWaarde(vb, 'dikte', 30), ov = maatWaarde(vb, 'overstek', 40);
      const x0 = op ? op.x0 - ov.mm : L * 0.35, x1 = op ? op.x1 + ov.mm : L * 0.65, yb = op ? op.y0 : maatWaarde(vb, 'hoogte', 900).mm;
      m.vormen.push({ id: vb.id, soort: 'object', type: 'vensterbank', naam: 'Vensterbank ' + vb.id, x0, x1, y0: yb - di.mm, y1: yb, geschat: !di.gemeten, getikt: false, rect: true, bank: true });
      if (op) lijn(P + 'overstek', [op.x1, yb - di.mm - 60], [op.x1 + ov.mm, yb - di.mm - 60], 'overstek', 'object', vb.id);
      else lijn(P + 'hoogte', [(x0 + x1) / 2, 0], [(x0 + x1) / 2, yb], 'hoogte', 'object', vb.id);
      lijn(P + 'dikte', [x1 + 60, yb - di.mm], [x1 + 60, yb], 'dikte', 'object', vb.id);
    }

    // plint: een band onderaan de wand
    for (const pl of lijst(r.objecten).filter(o => o && o.type === 'plint' && o.wand === wand)) {
      const hh = maatWaarde(pl, 'hoogte', PLINT_STANDAARD);
      m.vormen.push({ id: pl.id, soort: 'object', type: 'plint', naam: 'Plint ' + pl.id, x0: 0, x1: L, y0: 0, y1: hh.mm, geschat: !hh.gemeten, getikt: false, rect: true, band: true });
      lijn('objecten.' + pl.id + '.maten.hoogte', [L * 0.06, 0], [L * 0.06, hh.mm], 'plinthoogte', 'object', pl.id);
    }
    // alleen lijnen waar de kern ook echt naar vraagt (buiten de werkzone vraagt de kern bijvoorbeeld niet naar de positie tot de rechterhoek)
    const gevraagd = new Set(K.vragen(r).map(v => v.pad));
    m.lijnen = m.lijnen.filter(l => gevraagd.has(l.pad));
    return m;
  };

  // Een wandlijn naar het beeld: begin en eind in beeldruimte. afb = G.wandAfbeelding; L en H zijn de wandmaten in mm waarop de lijn getekend is.
  G.lijnNaarBeeld = function (afb, model, l) {
    if (!afb) return null;
    const p = afb.naarBeeld(l.a[0] / model.lengte, l.a[1] / model.hoogte), q = afb.naarBeeld(l.b[0] / model.lengte, l.b[1] / model.hoogte);
    return p && q ? { a: p, b: q } : null;
  };
  // Een getikt beeldpunt naar de wand als fracties (u, v) die begrensd blijven op 0 tot 1.
  G.beeldNaarFractie = function (afb, pt) {
    const w = afb && afb.naarWand(pt[0], pt[1]); if (!w) return null;
    return [Math.max(0, Math.min(1, w[0])), Math.max(0, Math.min(1, w[1]))];
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = G;
})(typeof window !== 'undefined' ? window : globalThis);
