// Tests van de reken- en projectiefuncties van de opname-schermen (mt-opname-geo.js), zonder DOM. Draaien: node test/opname-geo.test.js — verzonnen ruimte (kamer Joe), geen persoonsgegevens.
'use strict';
const assert = require('assert');
const K = require('../mt-opname-kern.js');
const G = require('../mt-opname-geo.js');
let n = 0; const test = (naam, fn) => { try { fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };
const dicht = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-6 : tol);

function ruimteMet(maten) {
  let op = K.nieuweOpname({ opname_id: 'OPN-TEST-002', project: { code: 'TEST-001' }, ruimtes: [K.nieuweRuimte({ id: 'R1', naam: 'Kamer Joe', werkzone: ['O'] })] });
  let c = K.voegOpeningToe(op, 'R1', { soort: 'raam', wand: 'O', definitie: 'muursparing' }); op = c.opname;
  c = K.voegOpeningToe(op, 'R1', { soort: 'deur', wand: 'Z', definitie: 'muursparing' }); op = c.opname;
  c = K.voegObjectToe(op, 'R1', { type: 'stopcontact', wand: 'O', hoek: 'ZO' }); op = c.opname;
  for (const [pad, w] of Object.entries(maten || {})) { const x = K.zetMaat(op, 'R1', pad, { staat: 'gemeten', waarde: w, bron: 'disto' }); assert.ok(!x.fout, pad + ': ' + x.fout); op = x.opname; }
  return op.ruimtes[0];
}

test('homografie: vier hoeken van een rechthoek geven de eenheidsafbeelding terug', () => {
  const afb = G.wandAfbeelding([[100, 500], [900, 500], [900, 100], [100, 100]]);
  const p = afb.naarBeeld(0.5, 0.5); assert.ok(dicht(p[0], 500) && dicht(p[1], 300));
  const t = afb.naarWand(500, 300); assert.ok(dicht(t[0], 0.5) && dicht(t[1], 0.5));
});
test('homografie: een wand in perspectief (rechts lager en korter) wordt goed terugvertaald', () => {
  const hoeken = [[100, 700], [800, 620], [800, 180], [100, 100]];
  const afb = G.wandAfbeelding(hoeken);
  for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1], [0.3, 0.8], [0.9, 0.1]]) { const p = afb.naarBeeld(u, v), t = afb.naarWand(p[0], p[1]); assert.ok(dicht(t[0], u) && dicht(t[1], v), u + ',' + v); }
  const m = afb.naarBeeld(0.5, 0.5); assert.ok(m[0] > 100 && m[0] < 800 && m[1] > 100 && m[1] < 700);
  const kant = afb.naarBeeld(1, 0); assert.ok(dicht(kant[0], 800) && dicht(kant[1], 620));
});
test('hoeken: een gekruiste of platte vierhoek wordt geweigerd', () => {
  assert.strictEqual(G.hoekenGeldig([[0, 10], [10, 10], [10, 0], [0, 0]]), true);
  assert.strictEqual(G.hoekenGeldig([[0, 10], [10, 0], [10, 10], [0, 0]]), false);
  assert.strictEqual(G.hoekenGeldig([[0, 0], [10, 0], [20, 0], [30, 0]]), false);
  assert.strictEqual(G.hoekenGeldig([[0, 10], [10, 10], [10, 0]]), false);
  assert.strictEqual(G.wandAfbeelding([[0, 0], [1, 1], [0, 1], [1, 0]]), null);
});
test('schema zonder foto: de verhouding van breedte en hoogte volgt de wand', () => {
  const s = G.schemaHoeken(5000, 2500, 1000); assert.strictEqual(s.hoogte, 500); assert.deepStrictEqual(s.hoeken[2], [1000, 0]);
});

test('kamer zonder maten: schatting, duidelijk als schatting gemarkeerd', () => {
  const k = G.kamer(ruimteMet({}));
  assert.strictEqual(k.vormGeschat, true); assert.strictEqual(k.hoogteGeschat, true); assert.strictEqual(k.wanden.N.lengteGemeten, false);
  assert.ok(k.wanden.N.lengte > 0 && k.hoogte > 0);
});
test('kamer met gemeten wanden en diagonaal: de vorm komt uit de kern en is niet geschat', () => {
  const k = G.kamer(ruimteMet({ 'wanden.N.maten.lengte': 5760, 'wanden.O.maten.lengte': 2900, 'wanden.Z.maten.lengte': 5762, 'wanden.W.maten.lengte': 2903, 'diagonalen.A.maten.lengte': 6452, 'diagonalen.B.maten.lengte': 6451, 'plafondpunten.P1.maten.hoogte': 2447 }));
  assert.strictEqual(k.vormGeschat, false); assert.strictEqual(k.hoogte, 2447); assert.strictEqual(k.hoogteGeschat, false);
  assert.ok(dicht(k.wanden.N.lengte, 5760) && k.wanden.N.lengteGemeten);
  assert.ok(dicht(k.punten.NO[0], 5760, 1) && dicht(k.punten.NO[1], 0, 1));
});
test('alleen wandlengtes: een rechthoek uit de gemiddelde breedte en diepte, nog geschat', () => {
  const k = G.kamer(ruimteMet({ 'wanden.N.maten.lengte': 5000, 'wanden.Z.maten.lengte': 5002, 'wanden.O.maten.lengte': 3000, 'wanden.W.maten.lengte': 3004 }));
  assert.strictEqual(k.vormGeschat, true); assert.ok(dicht(k.punten.ZO[0], 5001) && dicht(k.punten.ZO[1], 3002));
});

test('projectie: de straal blijft binnen het beeld en draaien verandert de dieptevolgorde', () => {
  const k = G.kamer(ruimteMet({}));
  for (const yaw of [0, 45, 90, 180, 270]) {
    const cam = G.camera(k, yaw, 30);
    for (const p of Object.values(k.punten)) for (const z of [0, k.hoogte]) { const q = G.projecteer(cam, [p[0], p[1], z]); assert.ok(Math.abs(q.x) < 1.6 && Math.abs(q.y) < 1.6, yaw + ': ' + q.x + ',' + q.y); }
  }
  const a = G.achterwanden(k, G.camera(k, 0, 30)), b = G.achterwanden(k, G.camera(k, 180, 30));
  assert.strictEqual(a.length, 2); assert.notDeepStrictEqual(a.slice().sort(), b.slice().sort());
});
test('projectie: hoger boven de vloer staat hoger op het scherm (y kleiner)', () => {
  const k = G.kamer(ruimteMet({})), cam = G.camera(k, 20, 30), v = k.punten.NW;
  assert.ok(G.projecteer(cam, [v[0], v[1], k.hoogte]).y < G.projecteer(cam, [v[0], v[1], 0]).y);
});

test('wandmodel: werkzone-wand heeft lijnen voor 3 lengtes en 3 plafondpunten, een andere wand alleen de lengte', () => {
  const r = ruimteMet({});
  const o = G.wandModel(r, 'O'), n = G.wandModel(r, 'N');
  const wandPaden = m => m.lijnen.filter(l => l.groep === 'wand').map(l => l.pad.split('.').pop()).sort();
  assert.deepStrictEqual(wandPaden(o), ['lengte', 'lengte_boven', 'lengte_onder', 'plafond_links', 'plafond_midden', 'plafond_rechts']);
  assert.deepStrictEqual(wandPaden(n), ['lengte']);
});
test('wandmodel: elke lijn hoort bij een bestaand pad van de kern (een lijn zonder vraag bestaat niet)', () => {
  const r = ruimteMet({ 'wanden.O.maten.lengte': 3000, 'plafondpunten.P1.maten.hoogte': 2500 });
  const paden = new Set(K.vragen(r).map(v => v.pad));
  for (const w of K.WANDEN) for (const l of G.wandModel(r, w).lijnen) assert.ok(paden.has(l.pad), w + ' ' + l.pad);
});
test('wandmodel: de opening staat op een getikte plek als die er is, anders verdeeld; een gemeten positie telt mee', () => {
  const r = ruimteMet({ 'wanden.O.maten.lengte': 3000 });
  const eerst = G.wandModel(r, 'O').vormen.find(v => v.id === 'R1');
  assert.ok(eerst.geschat && eerst.x0 >= 0 && eerst.x1 <= 3000);
  const getikt = G.wandModel(r, 'O', null, { vormen: { R1: { u0: 0.2, u1: 0.5, v0: 0.3, v1: 0.8 } } }).vormen.find(v => v.id === 'R1');
  assert.ok(dicht(getikt.x0, 600) && dicht(getikt.x1, 1500) && getikt.getikt);
  const op = K.zetMaat({ ruimtes: [r], fotos: [] }, 'R1', 'openingen.R1.maten.positie', { staat: 'gemeten', waarde: 400, bron: 'hand' }).opname.ruimtes[0];
  assert.ok(dicht(G.wandModel(op, 'O').vormen.find(v => v.id === 'R1').x0, 400));
});
test('wandmodel: stopcontact met hoek ZO meet vanaf de rechterhoek van de oostwand (ZO is de rechterhoek)', () => {
  const r = ruimteMet({ 'wanden.O.maten.lengte': 3000 });
  const l = G.wandModel(r, 'O').lijnen.find(x => /afstand$/.test(x.pad));
  assert.strictEqual(l.label, 'tot rechterhoek'); assert.strictEqual(l.b[0], 3000);
});
test('wandmodel: de lijnen van een opening liggen op de goede plek (breedte langs de bovenrand, borstwering van de vloer tot de onderrand)', () => {
  const r = ruimteMet({ 'wanden.O.maten.lengte': 3000, 'openingen.R1.maten.breedte': 1000, 'openingen.R1.maten.hoogte': 1200, 'openingen.R1.maten.borstwering': 900 });
  const m = G.wandModel(r, 'O'), v = m.vormen.find(x => x.id === 'R1');
  assert.ok(dicht(v.x1 - v.x0, 1000) && dicht(v.y0, 900) && dicht(v.y1, 2100));
  const br = m.lijnen.find(x => x.pad === 'openingen.R1.maten.breedte'), bw = m.lijnen.find(x => x.pad === 'openingen.R1.maten.borstwering');
  assert.ok(dicht(br.a[1], 2100) && dicht(br.b[0] - br.a[0], 1000)); assert.ok(bw.a[1] === 0 && dicht(bw.b[1], 900));
});
test('wandmodel: de plint is een band onderaan met een hoogtelijn', () => {
  let op = { ruimtes: [ruimteMet({ 'wanden.O.maten.lengte': 3000 })], fotos: [] };
  op = K.voegObjectToe(op, 'R1', { type: 'plint', wand: 'O' }).opname;
  const m = G.wandModel(op.ruimtes[0], 'O'), pl = m.vormen.find(x => x.type === 'plint');
  assert.ok(pl && pl.band && pl.y0 === 0 && pl.y1 === 80 && pl.geschat);
  assert.ok(m.lijnen.some(l => /objecten\.PL\d+\.maten\.hoogte/.test(l.pad)));
});
test('lijn naar beeld en terug: een getikt beeldpunt wordt een fractie binnen de wand', () => {
  const afb = G.wandAfbeelding([[100, 700], [800, 620], [800, 180], [100, 100]]);
  const m = G.wandModel(ruimteMet({ 'wanden.O.maten.lengte': 3000 }), 'O');
  const b = G.lijnNaarBeeld(afb, m, m.lijnen[0]); assert.ok(b && b.a[0] >= 100 && b.b[0] <= 800 + 1e-6);
  const f = G.beeldNaarFractie(afb, afb.naarBeeld(0.25, 0.4)); assert.ok(dicht(f[0], 0.25) && dicht(f[1], 0.4));
  const buiten = G.beeldNaarFractie(afb, [5000, 5000]); assert.ok(buiten[0] <= 1 && buiten[1] <= 1 && buiten[0] >= 0);
});
console.log('\n' + n + ' tests geslaagd');
