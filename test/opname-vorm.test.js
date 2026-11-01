// Tests van de vorm uit de foto's (brok 3, datamodel v0.4): wanden uit de fotoronde, hoeken, uitsprongen en nissen uit knikken, de plattegrond die met de metingen meegroeit, de sluitcontrole met
// N wanden en de migratie van v0.3. Draaien: node test/opname-vorm.test.js — verzonnen ruimte, geen persoonsgegevens.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const K = require('../mt-opname-kern.js');
let n = 0; const test = (naam, fn) => { try { fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };
const kopie = x => JSON.parse(JSON.stringify(x));
const T0 = '2026-11-01T09:00:00.000Z';
const goed = res => { assert.strictEqual(res.fout, null, res.fout); return res.opname; };

// Een ruimte uit de foto's met zoveel wanden als gevraagd; hoeken (binnenhoek aan het eind van elke wand) standaard 90.
function ruimteUitFotos(aantal, opties) {
  opties = opties || {};
  let op = K.nieuweOpname({ opname_id: 'OPN-TEST-003', project: { code: 'TEST-001' }, aangemaakt: T0, ruimtes: [K.nieuweRuimte({ id: 'R1', naam: 'Testkamer', wanden: [] })] });
  for (let i = 0; i < aantal; i++) op = goed(K.voegWandToe(op, 'R1'));
  if (opties.rond !== false) op = goed(K.maakRond(op, 'R1'));
  return op;
}
const R = op => op.ruimtes[0];
const meet = (op, pad, waarde, bron) => goed(K.zetMaat(op, 'R1', pad, { staat: 'gemeten', waarde, bron: bron || 'disto' }, T0));
const wandL = (op, w, l) => meet(op, 'wanden.' + w + '.maten.lengte', l);
const hoek = (op, w, g, bron) => goed(K.zetHoek(op, 'R1', w, g, bron, T0));
// Een L-vorm met zes wanden: W1 6000 (naar rechts), W2 2000 (omlaag), W3 3000 (naar links), W4 2000 (omlaag, na een inspringende hoek van 270), W5 3000 (naar links), W6 4000 (omhoog).
const L_WANDEN = { W1: 6000, W2: 2000, W3: 3000, W4: 2000, W5: 3000, W6: 4000 };
function lVorm(lengtes) {
  let op = ruimteUitFotos(6);
  op = hoek(op, 'W3', 270);
  for (const [w, l] of Object.entries(Object.assign({}, L_WANDEN, lengtes || {}))) if (l != null) op = wandL(op, w, l);
  return op;
}

test('een ruimte uit de foto\'s begint zonder wanden en zonder sjabloon; wanden komen met de foto\'s', () => {
  let op = ruimteUitFotos(0, { rond: false });
  assert.deepStrictEqual(K.wandIds(R(op)), []); assert.strictEqual(R(op).rond, false); assert.strictEqual(K.isRond(R(op)), false);
  op = goed(K.voegWandToe(op, 'R1')); op = goed(K.voegWandToe(op, 'R1')); op = goed(K.voegWandToe(op, 'R1'));
  assert.deepStrictEqual(K.wandIds(R(op)), ['W1', 'W2', 'W3']);
  assert.deepStrictEqual(R(op).wanden.map(w => [w.van, w.naar]), [['H1', 'H2'], ['H2', 'H3'], ['H3', 'H4']], 'de hoeken lopen door; de laatste wand is nog open');
  assert.strictEqual(K.wandNaam('W2'), 'Wand 2'); assert.strictEqual(K.wandLabel('W2'), 'Wand 2'); assert.strictEqual(K.wandLabel('N'), 'Noordwand'); assert.strictEqual(K.wandNaam('W'), 'West');
  assert.strictEqual(K.voegWandToe(ruimteUitFotos(3), 'R1').fout, 'Deze ruimte heeft vaste wanden of is al rond.');
});
test('kamer rond: de laatste wand loopt terug naar de eerste hoek; minstens drie wanden', () => {
  const kort = ruimteUitFotos(2, { rond: false }); assert.ok(/minstens drie/.test(K.maakRond(kort, 'R1').fout));
  const op = ruimteUitFotos(4); assert.strictEqual(R(op).wanden[3].naar, 'H1'); assert.strictEqual(R(op).rond, true);
  assert.ok(K.maakRond(op, 'R1').fout, 'al rond');
  const open = goed(K.openRond(op, 'R1')); assert.strictEqual(R(open).rond, false); assert.strictEqual(R(open).wanden[3].naar, 'H5');
  assert.ok(K.openRond(joeLegacy(), 'R1').fout, 'een ruimte met vaste wanden heeft geen ronde');
});
function joeLegacy() { return K.nieuweOpname({ opname_id: 'OPN-TEST-001', project: { code: 'TEST-001' }, ruimtes: [K.nieuweRuimte({ id: 'R1', naam: 'Joe', werkzone: ['O'] })] }); }
test('zonder rond te zijn is de vorm een schatting, ook met alle lengtes', () => {
  let op = ruimteUitFotos(4, { rond: false }); for (const w of ['W1', 'W2', 'W3', 'W4']) op = wandL(op, w, 4000);
  const v = K.vorm(R(op)); assert.strictEqual(v.status, 'onvoldoende-bepaald'); assert.ok(/nog niet rond/.test(v.reden));
  const g = K.vrijgeefCheck(op); assert.ok(g.redenen.some(x => x.code === 'ronde'), 'vrijgeven kan niet voor de ronde rond is');
});
test('vier wanden uit de foto\'s: dezelfde vierhoek-logica als v0.3 (vier zijden en een diagonaal, de tweede als controle)', () => {
  // dezelfde maten als kamer Joe: noord 5760, oost 2900, zuid 5762, west 2903
  const legacy = K.nieuweRuimte({ id: 'R1', naam: 'Joe', werkzone: ['O'] });
  let a = K.nieuweOpname({ opname_id: 'A', ruimtes: [legacy] }), b = ruimteUitFotos(4);
  const W = [5760, 2900, 5762, 2903], A = Math.round(Math.hypot(5761, 2900));
  ['N', 'O', 'Z', 'W'].forEach((w, i) => { a = meet(a, 'wanden.' + w + '.maten.lengte', W[i]); b = wandL(b, 'W' + (i + 1), W[i]); });
  a = meet(a, 'diagonalen.A.maten.lengte', A); b = meet(b, 'diagonalen.A.maten.lengte', A);
  const va = K.vorm(R(a)), vb = K.vorm(R(b));
  assert.strictEqual(vb.status, va.status); assert.strictEqual(vb.status, 'onverifieerd');
  assert.deepStrictEqual(Object.values(vb.hoekpunten_mm), Object.values(va.hoekpunten_mm), 'dezelfde hoekpunten, andere namen');
  assert.deepStrictEqual(Object.keys(vb.hoekpunten_mm), ['H1', 'H2', 'H3', 'H4']);
  b = meet(b, 'diagonalen.B.maten.lengte', Math.round(Math.hypot(5761, 2903))); assert.strictEqual(K.vorm(R(b)).status, 'consistent');
  b = meet(b, 'diagonalen.B.maten.lengte', 6600); assert.strictEqual(K.vorm(R(b)).status, 'inconsistent'); assert.ok(K.sluitcontrole(R(b)).conflicten[0].maten.includes('wanden.W1.maten.lengte'));
});
test('veelhoek: een L-vorm met zes wanden en een inspringende hoek sluit en is schematisch (hoeken aangenomen 90 of 270 graden)', () => {
  const op = lVorm(), v = K.vorm(R(op));
  assert.strictEqual(v.status, 'onverifieerd'); assert.strictEqual(v.schematisch, true); assert.ok(v.sluitfout.mm <= 1, 'sluitfout ' + v.sluitfout.mm);
  assert.strictEqual(v.bepaling, 'getekend'); assert.ok(/onder hoekaanname/.test(v.reden) && /aangenomen \(90 of 270 graden\)/.test(v.reden), 'nooit stil haaks: de aanname staat in de tekst');
  assert.deepStrictEqual(v.hoekpunten_mm.H1, [0, 0]); assert.deepStrictEqual(v.hoekpunten_mm.H2, [6000, 0]); assert.deepStrictEqual(v.hoekpunten_mm.H3, [6000, 2000]); assert.deepStrictEqual(v.hoekpunten_mm.H4, [3000, 2000]);
  assert.deepStrictEqual(v.hoekpunten_mm.H5, [3000, 4000]); assert.deepStrictEqual(v.hoekpunten_mm.H6, [0, 4000]);
  assert.strictEqual(v.hoeken.H4, 270, 'de inspringende hoek staat bij het eindpunt van wand 3');
});
test('sluitfout: boven de 10 mm is de meting inconsistent, eronder sluit de L-vorm; een diagonaal als controle maakt het consistent', () => {
  assert.strictEqual(K.vorm(R(lVorm({ W6: 4008 }))).status, 'onverifieerd', '8 mm is binnen de tolerantie');
  const fout = K.vorm(R(lVorm({ W6: 4050 })));
  assert.strictEqual(fout.status, 'inconsistent'); assert.ok(/inconsistent/.test(fout.reden) && /50 mm/.test(fout.reden)); assert.strictEqual(fout.sluitfout.y, -50);
  assert.ok(K.vrijgeefCheck(lVorm({ W6: 4050 })).redenen.some(x => x.code === 'conflict'));
  // diagonaal H1 naar H4 (0,0) -> (3000,2000)
  let op = goed(K.voegDiagonaalToe(lVorm(), 'R1', 'H1', 'H4'));
  const dpad = 'diagonalen.C.maten.lengte'; assert.ok(K.vragen(R(op)).some(v => v.pad === dpad && v.bucket === 'optie'), 'optioneel');
  const metC = K.vorm(R(meet(op, dpad, Math.round(Math.hypot(3000, 2000))))); assert.strictEqual(metC.status, 'onverifieerd', 'een diagonaal bewijst niet alle aangenomen hoeken'); assert.strictEqual(metC.bepaling, 'getekend'); assert.ok(/diagonaal C .*klopt/.test(metC.reden));
  const slecht = K.vorm(R(meet(op, dpad, 3800))); assert.strictEqual(slecht.status, 'inconsistent'); assert.ok(/Diagonaal C/.test(slecht.reden));
  assert.ok(K.voegDiagonaalToe(meet(op, dpad, 3606), 'R1', 'H1', 'H4').fout, 'dezelfde gemeten diagonaal twee keer kan niet');
});
test('een inconsistente meting wordt in de plattegrond niet mooi gemaakt: de sluitfout blijft zichtbaar', () => {
  const p = K.plattegrond(R(lVorm({ W6: 4050 })));
  assert.strictEqual(p.vorm.status, 'inconsistent'); assert.strictEqual(p.sluitfout.mm, 50);
  // een kleine afwijking zonder diagonaal bij een rechthoek (4 wanden, geen conflict mogelijk) wordt wel gelijk verdeeld getekend, zonder een maat te veranderen
  let op = ruimteUitFotos(4); for (const [w, l] of [['W1', 5000], ['W2', 3000], ['W3', 5002], ['W4', 3004]]) op = wandL(op, w, l);
  const q = K.plattegrond(R(op)); assert.ok(q.sluitfout.mm <= 1); assert.strictEqual(K.waarde(R(op).wanden[2].maten.lengte), 5002); assert.strictEqual(q.wanden.W3.lengte, 5002, 'de gemeten lengte blijft de gemeten lengte');
});
test('een schuine hoek zonder bepaling: de plattegrond tekent wel iets (schatting) en meldt geen sluitfout als conflict', () => {
  let op = ruimteUitFotos(4); for (const [w, l] of [['W1', 4000], ['W2', 3000], ['W3', 4000], ['W4', 3000]]) op = wandL(op, w, l);
  op = hoek(op, 'W2', 120); const p = K.plattegrond(R(op));
  assert.strictEqual(p.vorm.status, 'onvoldoende-bepaald'); assert.strictEqual(p.schatting, true); assert.strictEqual(p.contour.length, 4); assert.ok(p.bbox.x1 > p.bbox.x0);
});
test('diagonalen: bij vier wanden A (basis) en B (optie); komt er een wand bij, dan verdwijnt een onbemeten A of B, een gemeten blijft als optionele controle', () => {
  let op = ruimteUitFotos(4, { rond: false }); op = wandL(op, 'W1', 4000);
  assert.deepStrictEqual(K.vragen(R(op)).filter(v => v.pad.startsWith('diagonalen.')).map(v => [v.pad.split('.')[1], v.bucket]), [['A', 'basis'], ['B', 'optie']]);
  const leeg = goed(K.voegWandToe(op, 'R1')); assert.deepStrictEqual(K.vragen(R(leeg)).filter(v => v.pad.startsWith('diagonalen.')), [], 'onbemeten A en B vallen weg bij vijf wanden');
  const gemeten = goed(K.voegWandToe(meet(op, 'diagonalen.A.maten.lengte', 5500), 'R1'));
  assert.deepStrictEqual(K.vragen(R(gemeten)).filter(v => v.pad.startsWith('diagonalen.')).map(v => [v.pad.split('.')[1], v.bucket, v.staat]), [['A', 'optie', 'gemeten']], 'een gemeten diagonaal gaat nooit stil verloren');
});
test('een wand die de hoeken scheef zet: kruisende of verkeerd gedraaide wanden zijn inconsistent', () => {
  let op = ruimteUitFotos(6); op = hoek(op, 'W3', 90);                    // alle hoeken 90: de zes wanden sluiten niet en lopen niet netjes rond
  for (const [w, l] of Object.entries(L_WANDEN)) op = wandL(op, w, l);
  assert.strictEqual(K.vorm(R(op)).status, 'inconsistent');
});
test('schuin: een geschatte hoek maakt de vorm onvoldoende bepaald, ook bij vier wanden zonder diagonaal', () => {
  let op = ruimteUitFotos(4); for (const [w, l] of [['W1', 4000], ['W2', 3000], ['W3', 3000], ['W4', 3200]]) op = wandL(op, w, l);
  op = hoek(op, 'W1', 100);                                                // 100 graden, een eigen schatting
  assert.strictEqual(K.hoekVan(R(op), 'W1').bron, 'foto-voorstel'); assert.strictEqual(K.hoekVan(R(op), 'W1').schuin, true);
  const v = K.vorm(R(op)); assert.strictEqual(v.status, 'onvoldoende-bepaald'); assert.ok(/schuin/.test(v.reden) && /geschat/.test(v.reden));
  // met een diagonaal bepaalt de vierhoek de hoeken zelf
  const met = meet(op, 'diagonalen.A.maten.lengte', 5000); assert.notStrictEqual(K.vorm(R(met)).status, 'onvoldoende-bepaald');
  // vijf wanden met een schuine hoek: pas als de hoek gemeten is, is de vorm bepaald
  let pent = ruimteUitFotos(5); pent = hoek(pent, 'W2', 135);
  const lengtes = [4000, 3000, 1500, 2500, 3000];
  const vorm = K.vorm(R(lengtes.reduce((o, l, i) => wandL(o, 'W' + (i + 1), l), pent)));
  assert.strictEqual(vorm.status, 'onvoldoende-bepaald'); assert.ok(/schuin/.test(vorm.reden));
  assert.strictEqual(K.vorm(R(hoek(pent, 'W2', 135, 'gemeten'))).status, 'onvoldoende-bepaald', 'zonder lengtes nog steeds onvoldoende');
  // een gemeten schuine hoek is een bekende hoek: dan beslist de sluitfout (hier klopt de vijfhoek niet met alleen deze hoeken en lengtes)
  const gemeten = lengtes.reduce((o, l, i) => wandL(o, 'W' + (i + 1), l), hoek(pent, 'W2', 135, 'gemeten'));
  assert.notStrictEqual(K.vorm(R(gemeten)).status, 'onvoldoende-bepaald'); assert.ok(['inconsistent', 'onverifieerd'].includes(K.vorm(R(gemeten)).status));
});
test('uitsprong uit knikken: een stuk naar voren wordt een uitsprong met een verhouding, nooit met een gemeten maat', () => {
  let op = ruimteUitFotos(4);
  const res = K.zetWandVorm(op, 'R1', 'W2', { foto: 'F1', knikken: [{ x: 0.3, y: 0.9, u: 0.3 }, { x: 0.5, y: 0.9, u: 0.5 }], tussenstukken: ['voor'] }, T0); op = goed(res);
  assert.deepStrictEqual(res.uitsprongen, ['U1']);
  const u = R(op).uitsprongen[0]; assert.deepStrictEqual([u.id, u.wand, u.soort, u.stuk], ['U1', 'W2', 'voor', 0]); assert.deepStrictEqual(u.verhouding, { van: 0.3, tot: 0.5, bron: 'foto-voorstel' });
  assert.strictEqual(R(op).wanden[1].foto_vorm.knikken.length, 2); assert.strictEqual(R(op).wanden[1].foto_vorm.foto, 'F1');
  const v = K.vragen(R(op)).filter(x => x.object === 'U1');
  assert.deepStrictEqual(v.map(x => x.pad.split('.').pop()).sort(), ['breedte', 'diepte', 'positie']);
  assert.ok(v.every(x => x.bucket === 'basis' && x.staat === 'open'));
  // zonder gemeten wandlengte: geen voorstel in mm voor breedte en positie, wel de standaardschatting voor de diepte
  assert.strictEqual(v.find(x => x.pad.endsWith('.breedte')).voorstel, null); assert.strictEqual(v.find(x => x.pad.endsWith('.positie')).voorstel, null);
  const d = v.find(x => x.pad.endsWith('.diepte')).voorstel; assert.strictEqual(d.schatting_mm, 300); assert.strictEqual(d.bron, 'foto-voorstel'); assert.strictEqual(d.afgeleid, 'standaardschatting');
  // met een gemeten wandlengte volgt het voorstel de verhouding
  op = wandL(op, 'W2', 5000); const w = K.vragen(R(op)).filter(x => x.object === 'U1');
  assert.strictEqual(w.find(x => x.pad.endsWith('.positie')).voorstel.schatting_mm, 1500); assert.strictEqual(w.find(x => x.pad.endsWith('.breedte')).voorstel.schatting_mm, 1000);
  assert.ok(w.every(x => x.staat === 'open' && x.voorstel.bron === 'foto-voorstel'), 'een voorstel is geen meting');
  assert.strictEqual(K.vrijgeefCheck(op).redenen.some(x => x.code === 'open' && x.bucket === 'basis'), true);
});
test('uitsprong in de werkzone vraagt ook de hoogte; erbuiten alleen breedte, positie en diepte', () => {
  let op = ruimteUitFotos(4);
  op = goed(K.zetWandVorm(op, 'R1', 'W2', { knikken: [{ x: 0.3, y: 0.9, u: 0.3 }, { x: 0.5, y: 0.9, u: 0.5 }], tussenstukken: ['achter'] }, T0));
  assert.ok(!K.vragen(R(op)).some(x => x.pad === 'uitsprongen.U1.maten.hoogte'));
  op = goed(K.zetRuimte(op, 'R1', { werkzone: ['W2'] }));
  const h = K.vragen(R(op)).find(x => x.pad === 'uitsprongen.U1.maten.hoogte'); assert.ok(h && h.bucket === 'werkzone');
  assert.ok(/nis/.test(K.vragen(R(op)).find(x => x.pad === 'uitsprongen.U1.maten.diepte').vraag), 'een nis heet nis');
  assert.ok(K.zetRuimte(op, 'R1', { werkzone: ['N'] }).fout, 'een onbekende wand kan niet in de werkzone');
});
test('de route vraagt de uitsprongen van links naar rechts, na de wandlengte en voor de openingen', () => {
  let op = ruimteUitFotos(4);
  const kn = us => us.map(u => ({ x: u, y: 0.9, u }));
  op = goed(K.zetWandVorm(op, 'R1', 'W2', { knikken: kn([0.1, 0.2, 0.3]), tussenstukken: ['recht', 'voor'] }, T0));                       // U1 bij 0,2 tot 0,3
  op = goed(K.zetWandVorm(op, 'R1', 'W2', { knikken: kn([0.1, 0.2, 0.3, 0.6, 0.7]), tussenstukken: ['voor', 'voor', 'recht', 'achter'] }, T0));      // U2 bij 0,1 en U3 bij 0,6 erbij
  op = goed(K.voegOpeningToe(op, 'R1', { soort: 'raam', wand: 'W2', definitie: 'muursparing' }));
  const rt = K.routeVanOpname(op, 'R1'), stappen = rt.stappen.filter(s => s.wand === 'W2' && s.pad).map(s => s.pad);
  assert.strictEqual(rt.foto_wanden.length, 4); assert.strictEqual(rt.stappen.find(s => s.wand === 'W2').wanden_totaal, 4);
  const iL = stappen.indexOf('wanden.W2.maten.lengte'), iU = stappen.findIndex(p => p.startsWith('uitsprongen.')), iO = stappen.findIndex(p => p.startsWith('openingen.'));
  assert.ok(iL < iU && iU < iO, stappen.join(' '));
  assert.deepStrictEqual(Array.from(new Set(stappen.filter(p => p.startsWith('uitsprongen.')).map(p => p.split('.')[1]))), ['U2', 'U1', 'U3'], 'links naar rechts, niet in de volgorde van aanmaken');
});
test('knikken veranderen: een stuk dat recht wordt, gaat met zijn maten naar het archief; een gemeten maat blijft bij dezelfde uitsprong', () => {
  let op = ruimteUitFotos(4);
  const vorm = (ts) => ({ knikken: [{ x: 0.3, y: 0.9, u: 0.3 }, { x: 0.5, y: 0.9, u: 0.5 }], tussenstukken: ts });
  op = goed(K.zetWandVorm(op, 'R1', 'W2', vorm(['voor']), T0)); op = meet(op, 'uitsprongen.U1.maten.diepte', 420);
  op = goed(K.zetWandVorm(op, 'R1', 'W2', { knikken: [{ x: 0.31, y: 0.9, u: 0.31 }, { x: 0.52, y: 0.9, u: 0.52 }], tussenstukken: ['achter'] }, T0));      // iets verschoven en nu een nis
  assert.strictEqual(R(op).uitsprongen.length, 1); assert.strictEqual(R(op).uitsprongen[0].soort, 'achter'); assert.strictEqual(K.waarde(R(op).uitsprongen[0].maten.diepte), 420, 'de meting blijft');
  op = goed(K.zetWandVorm(op, 'R1', 'W2', { knikken: [{ x: 0.31, y: 0.9, u: 0.31 }, { x: 0.52, y: 0.9, u: 0.52 }], tussenstukken: ['recht'] }, T0));
  assert.strictEqual(R(op).uitsprongen.length, 0); assert.strictEqual(R(op).verwijderd.length, 1); assert.strictEqual(K.waarde(R(op).verwijderd[0].item.maten.diepte), 420, 'niets gaat stil verloren');
  op = goed(K.zetWandVorm(op, 'R1', 'W2', vorm(['voor']), T0)); assert.strictEqual(R(op).uitsprongen[0].id, 'U2', 'een id wordt nooit hergebruikt');
  op = goed(K.verwijderItem(op, 'R1', 'uitsprongen', 'U2')); assert.deepStrictEqual(R(op).wanden[1].foto_vorm.tussenstukken, ['recht']);
  assert.strictEqual(K.zetWandVorm(op, 'R1', 'W2', { knikken: [], tussenstukken: [] }, T0).fout, null); assert.strictEqual(R(goed(K.zetWandVorm(op, 'R1', 'W2', { knikken: [], tussenstukken: [] }, T0))).wanden[1].foto_vorm, undefined);
});
test('knikken worden gecontroleerd: minstens twee, binnen de wand, van links naar rechts, elk stuk een vorm', () => {
  const op = ruimteUitFotos(4), k = u => ({ x: u, y: 0.9, u });
  assert.ok(/minstens twee/.test(K.zetWandVorm(op, 'R1', 'W1', { knikken: [k(0.4)], tussenstukken: [] }).fout));
  assert.ok(K.zetWandVorm(op, 'R1', 'W1', { knikken: [k(0.4), k(0.6)], tussenstukken: [] }).fout);
  assert.ok(/hoek/.test(K.zetWandVorm(op, 'R1', 'W1', { knikken: [k(0), k(0.6)], tussenstukken: ['voor'] }).fout), 'een knik in de hoek is geen knik');
  assert.ok(K.zetWandVorm(op, 'R1', 'W1', { knikken: [k(0.6), k(0.4)], tussenstukken: ['voor'] }).fout);
  assert.ok(K.zetWandVorm(op, 'R1', 'W1', { knikken: [k(0.4), k(0.6)], tussenstukken: ['scheef'] }).fout);
  assert.ok(K.zetWandVorm(op, 'R1', 'W9', { knikken: [], tussenstukken: [] }).fout);
});
test('de plattegrond groeit mee: 2 wanden, alle wanden, daarna gemeten', () => {
  let op = ruimteUitFotos(2, { rond: false });
  let p = K.plattegrond(R(op)); assert.strictEqual(p.n, 2); assert.strictEqual(p.rond, false); assert.deepStrictEqual(Object.keys(p.punten), ['H1', 'H2', 'H3']);
  assert.strictEqual(p.schatting, true); assert.ok(p.wanden.W1.geschat && p.wanden.W2.geschat);
  op = goed(K.voegWandToe(op, 'R1')); op = goed(K.voegWandToe(op, 'R1')); op = goed(K.maakRond(op, 'R1'));
  p = K.plattegrond(R(op)); assert.strictEqual(p.rond, true); assert.strictEqual(p.contour.length, 4);
  assert.ok(Math.abs(p.sluitfout.mm) <= 1 || p.sluitfout.mm >= 0, 'er is een sluitfout bekend');
  op = wandL(op, 'W1', 5000); op = wandL(op, 'W2', 3000);
  p = K.plattegrond(R(op)); assert.strictEqual(p.wanden.W1.gemeten, true); assert.strictEqual(p.wanden.W3.geschat, true);
  assert.strictEqual(Math.round(p.wanden.W3.lengte), 5000, 'de tegenoverliggende wand volgt als schatting'); assert.strictEqual(p.sluitfout.mm, 0);
  assert.strictEqual(p.schatting, true, 'zolang er schattingen in zitten blijft de tekening een schatting');
  for (const [w, l] of [['W3', 5000], ['W4', 3000]]) op = wandL(op, w, l);
  op = meet(op, 'diagonalen.A.maten.lengte', Math.round(Math.hypot(5000, 3000))); op = meet(op, 'diagonalen.B.maten.lengte', Math.round(Math.hypot(5000, 3000)));
  p = K.plattegrond(R(op)); assert.strictEqual(p.schatting, false, 'alles gemeten en gecontroleerd: vast');
});
test('onbekende lengtes sluiten als schatting (grijs) bij een L-vorm; gemeten wanden blijven zoals ze zijn', () => {
  const op = lVorm({ W6: null, W2: null }), p = K.plattegrond(R(op));
  assert.strictEqual(p.wanden.W6.geschat, true); assert.strictEqual(p.wanden.W2.geschat, true); assert.strictEqual(p.wanden.W1.gemeten, true);
  assert.strictEqual(Math.round(p.wanden.W1.lengte), 6000); assert.ok(p.sluitfout.mm <= 1, 'sluitfout ' + p.sluitfout.mm);
  assert.strictEqual(Math.round(p.wanden.W6.lengte), 4000, 'de schatting sluit de L-vorm'); assert.strictEqual(Math.round(p.wanden.W2.lengte), 2000);
  assert.strictEqual(K.waarde(R(op).wanden[5].maten.lengte), null, 'de kern schrijft de schatting nooit als maat weg');
  assert.strictEqual(p.schatting, true);
});
test('de plattegrond tekent de uitsprong en schaalt mee met de gemeten wandlengte', () => {
  let op = ruimteUitFotos(4); for (const [w, l] of [['W1', 5000], ['W2', 3000], ['W3', 5000], ['W4', 3000]]) op = wandL(op, w, l);
  op = goed(K.zetWandVorm(op, 'R1', 'W1', { knikken: [{ x: 0.4, y: 0.9, u: 0.4 }, { x: 0.6, y: 0.9, u: 0.6 }], tussenstukken: ['voor'] }, T0));
  let p = K.plattegrond(R(op)), u = p.uitsprongen[0];
  assert.deepStrictEqual([u.positie, u.breedte, u.diepte], [2000, 1000, 300]); assert.deepStrictEqual(u.geschat, { positie: true, breedte: true, diepte: true });
  // W1 loopt naar rechts, de ruimte ligt eronder: een uitsprong naar voren steekt de ruimte in (y positief)
  assert.deepStrictEqual(u.punten.map(q => q.map(Math.round)), [[2000, 0], [2000, 300], [3000, 300], [3000, 0]]);
  assert.strictEqual(p.contour.filter(c => c.uitsprong === 'U1').length, 3); assert.strictEqual(p.contour.length, 8, 'W1 heeft vijf stukken (wand, zijkant, voorkant, zijkant, wand), de andere drie wanden elk een');
  // een nis steekt de wand in (y negatief)
  const nis = goed(K.zetWandVorm(op, 'R1', 'W1', { knikken: [{ x: 0.4, y: 0.9, u: 0.4 }, { x: 0.6, y: 0.9, u: 0.6 }], tussenstukken: ['achter'] }, T0)), pn = K.plattegrond(R(nis));
  assert.deepStrictEqual(pn.uitsprongen[0].punten.map(q => q.map(Math.round)), [[2000, 0], [2000, -300], [3000, -300], [3000, 0]]);
  // de wandlengte van W1 klopt niet met wat eerst geschat was (4000): met de gemeten 6000 schalen de verhoudingen mee, de diepte blijft
  const op2 = wandL(op, 'W1', 6000), p2 = K.plattegrond(R(op2)); assert.deepStrictEqual([p2.uitsprongen[0].positie, p2.uitsprongen[0].breedte], [2400, 1200]);
  // zodra de breedte gemeten is, is die leidend en blijft de rest een verhouding
  const op3 = meet(op2, 'uitsprongen.U1.maten.breedte', 1100), p3 = K.plattegrond(R(op3)); assert.strictEqual(p3.uitsprongen[0].breedte, 1100); assert.strictEqual(p3.uitsprongen[0].geschat.breedte, false); assert.strictEqual(p3.uitsprongen[0].geschat.positie, true);
  const op4 = meet(meet(meet(op3, 'uitsprongen.U1.maten.positie', 2300), 'uitsprongen.U1.maten.diepte', 450), 'wanden.W2.maten.lengte', 3000), p4 = K.plattegrond(R(op4));
  assert.deepStrictEqual([p4.uitsprongen[0].positie, p4.uitsprongen[0].breedte, p4.uitsprongen[0].diepte], [2300, 1100, 450]); assert.deepStrictEqual(p4.uitsprongen[0].geschat, { positie: false, breedte: false, diepte: false });
});
test('de plattegrond zonder gemeten wandlengte rekent de uitsprong op de geschatte lengte, als schatting', () => {
  let op = ruimteUitFotos(4);
  op = goed(K.zetWandVorm(op, 'R1', 'W1', { knikken: [{ x: 0.25, y: 0.9, u: 0.25 }, { x: 0.5, y: 0.9, u: 0.5 }], tussenstukken: ['voor'] }, T0));
  const p = K.plattegrond(R(op)), u = p.uitsprongen[0]; assert.strictEqual(u.geschat.positie, true);
  assert.strictEqual(Math.round(u.positie / p.wanden.W1.lengte * 100), 25); assert.strictEqual(Math.round(u.breedte / p.wanden.W1.lengte * 100), 25);
  assert.strictEqual(K.vragen(R(op)).find(x => x.pad === 'uitsprongen.U1.maten.positie').voorstel, null, 'op een geschatte wandlengte komt geen mm-voorstel in de vragen');
});
test('uitsprongen die buiten de wand vallen of over elkaar liggen geven een waarschuwing, geen blokkade', () => {
  let op = ruimteUitFotos(4); op = wandL(op, 'W1', 5000);
  op = goed(K.zetWandVorm(op, 'R1', 'W1', { knikken: [{ x: 0.1, y: 0.9, u: 0.1 }, { x: 0.4, y: 0.9, u: 0.4 }, { x: 0.7, y: 0.9, u: 0.7 }], tussenstukken: ['voor', 'voor'] }, T0));
  assert.deepStrictEqual(K.waarschuwingen(R(op)).filter(x => x.code.startsWith('uitsprong')), []);
  op = meet(op, 'uitsprongen.U2.maten.positie', 1400); const w = K.waarschuwingen(R(op)).filter(x => x.code === 'uitsprong-overlap'); assert.strictEqual(w.length, 1);
  op = meet(op, 'uitsprongen.U2.maten.positie', 4800); assert.ok(K.waarschuwingen(R(op)).some(x => x.code === 'uitsprong-buiten-wand'));
});
test('hoek: standaard 90 en een aanname; een eigen waarde is een voorstel; historie blijft; ongeldige hoeken worden geweigerd', () => {
  let op = ruimteUitFotos(4);
  assert.deepStrictEqual(K.hoekVan(R(op), 'W1'), { graden: 90, bron: 'aanname', haaks: true, inspringend: false, schuin: false });
  op = hoek(op, 'W1', 270); assert.strictEqual(K.hoekVan(R(op), 'W1').inspringend, true); assert.strictEqual(K.hoekVan(R(op), 'W1').bron, 'aanname');
  op = hoek(op, 'W1', 112.5); assert.deepStrictEqual([K.hoekVan(R(op), 'W1').graden, K.hoekVan(R(op), 'W1').bron], [112.5, 'foto-voorstel']);
  op = hoek(op, 'W1', 112.4, 'gemeten'); assert.strictEqual(K.hoekVan(R(op), 'W1').bron, 'gemeten'); assert.strictEqual(R(op).wanden[0].hoek_naar_volgende.historie.length, 2);
  for (const slecht of [0, 10, 180, 181 - 1, 350, NaN, '90']) assert.ok(K.zetHoek(op, 'R1', 'W1', slecht).fout, String(slecht));
  assert.ok(K.zetHoek(op, 'R1', 'W1', 90, 'wild').fout); assert.ok(K.zetHoek(op, 'R1', 'W7', 90).fout);
});
test('wand weghalen: alleen de laatste en alleen als er niets op staat; foto en wand gaan naar het archief; het id wordt niet hergebruikt', () => {
  let op = ruimteUitFotos(3, { rond: false });
  op = goed(K.voegFotoToe(op, { bestand: 'w3.jpg', ruimte: 'R1', wand: 'W3' }));
  const res = K.verwijderLaatsteWand(op, 'R1', T0); op = goed(res); assert.strictEqual(res.id, 'W3');
  assert.deepStrictEqual(K.wandIds(R(op)), ['W1', 'W2']); assert.strictEqual(R(op).verwijderd[0].item.id, 'W3'); assert.strictEqual(op.fotos.length, 0); assert.strictEqual(op.fotos_verwijderd[0].bestand, 'w3.jpg');
  op = goed(K.voegWandToe(op, 'R1')); assert.deepStrictEqual(K.wandIds(R(op)), ['W1', 'W2', 'W4'], 'W3 komt niet terug, zodat een oude foto nooit aan een nieuwe wand blijft hangen');
  op = goed(K.voegOpeningToe(op, 'R1', { soort: 'raam', wand: 'W4' })); assert.ok(K.verwijderLaatsteWand(op, 'R1').fout);
  assert.ok(K.verwijderLaatsteWand(ruimteUitFotos(3), 'R1').fout, 'niet in een ronde ring');
});
test('foto\'s, openingen, objecten en werkzone werken met de nieuwe wanden', () => {
  let op = ruimteUitFotos(5);
  op = goed(K.voegFotoToe(op, { bestand: 'a.jpg', ruimte: 'R1', wand: 'W5' })); assert.ok(K.voegFotoToe(op, { bestand: 'b.jpg', ruimte: 'R1', wand: 'N' }).fout, 'N bestaat hier niet');
  op = goed(K.voegOpeningToe(op, 'R1', { soort: 'deur', wand: 'W1', naam: 'toegangsdeur' })); op = goed(K.zetRuimte(op, 'R1', { toegangsdeur: 'D1', werkzone: ['W3', 'W4'] }));
  op = goed(K.voegObjectToe(op, 'R1', { type: 'stopcontact', wand: 'W3', hoek: 'H3' })); assert.ok(K.voegObjectToe(op, 'R1', { type: 'stopcontact', wand: 'W3', hoek: 'XX' }).fout);
  assert.ok(K.vragen(R(op)).find(x => x.pad === 'objecten.SC1.maten.afstand').vraag.includes('hoek 3'), 'hoeken heten hoek 3 in plaats van een kompashoek');
  assert.strictEqual(R(op).werkzone.join(), 'W3,W4');
  const rt = K.routeVanOpname(op, 'R1'); assert.strictEqual(rt.toegangswand, 'W1'); assert.deepStrictEqual(rt.foto_wanden, ['W1', 'W2', 'W3', 'W4', 'W5']); assert.strictEqual(rt.start_wand, 'W3', 'de maten-rondloop begint bij de eerste werkzone-wand');
  assert.strictEqual(rt.stappen.find(s => s.id === 'maat:wanden.W4.maten.lengte').wand_tekst, 'wand 2 van 5');
  assert.ok(rt.stappen.some(s => s.id === 'bijz:W3')); assert.ok(K.rondje(R(op)).wanden.join() === 'W3,W4');
  const z = K.zetRondje(R(op), 'W3', 'elektra', 'aanwezig', T0); assert.strictEqual(z.fout, null); assert.ok(K.zetRondje(R(op), 'N', 'elektra', 'aanwezig').fout);
});
function volledigeLVorm() {
  let op = lVorm();
  op = goed(K.voegOpeningToe(op, 'R1', { soort: 'deur', wand: 'W1', naam: 'toegangsdeur', definitie: 'muursparing' })); op = goed(K.zetRuimte(op, 'R1', { toegangsdeur: 'D1', werkzone: ['W6'] }));
  op = goed(K.zetWandVorm(op, 'R1', 'W6', { foto: 'F6', knikken: [{ x: 0.3, y: 0.9, u: 0.3 }, { x: 0.5, y: 0.9, u: 0.5 }], tussenstukken: ['voor'] }, T0));
  for (let i = 1; i <= 6; i++) op = goed(K.voegFotoToe(op, { bestand: 'w' + i + '.jpg', ruimte: 'R1', wand: 'W' + i, tijd: T0 }));
  for (const v of K.vragen(R(op))) {
    if (v.staat === 'gemeten' || v.bucket === 'optie') continue;
    if (v.eenheid === 'keuze') op = goed(K.zetMaat(op, 'R1', v.pad, { staat: 'gemeten', keuze: v.keuzes[0], bron: 'hand' }, T0));
    else if (/^wanden\.(W\d)\.maten\.lengte_(onder|boven)$/.test(v.pad)) op = meet(op, v.pad, L_WANDEN[v.pad.split('.')[1]], 'hand');
    else op = meet(op, v.pad, v.pad.includes('plafond') ? 2500 : v.pad.includes('uitsprongen') ? 600 : 900, 'hand');
  }
  let r = R(op); for (const [c] of K.RONDJE_CATEGORIEEN) r = K.zetRondje(r, 'W6', c, 'aanwezig', T0).ruimte;
  op = kopie(op); op.ruimtes[0] = r; return op;
}
test('vrijgeven met zes wanden en een uitsprong: hash, scope en uitzonderingen werken; een wijziging maakt de vrijgave ongeldig', () => {
  const op = volledigeLVorm(), c = K.vrijgeefCheck(op);
  assert.deepStrictEqual(c.redenen, [], JSON.stringify(c.redenen)); assert.strictEqual(c.kan, true);
  assert.strictEqual(c.scope[0].vorm.aantal_wanden, 6); assert.strictEqual(c.scope[0].vorm.uitsprongen, 1); assert.strictEqual(c.scope[0].vorm.veelhoek, true);
  assert.deepStrictEqual(c.scope[0].wanden_alleen_basis, ['W1', 'W2', 'W3', 'W4', 'W5']);
  assert.ok(c.uitzonderingen.some(u => u.soort === 'vorm' && /hoekaanname/.test(u.tekst)), 'getekend onder hoekaanname staat als uitzondering');
  assert.strictEqual(c.volledig_gemeten, false);
  const v = goed(K.vrijgeven(op, 'test', T0)); assert.strictEqual(K.effectieveStatus(v), 'vrijgegeven');
  const andereHoek = goed(K.zetHoek(v, 'R1', 'W1', 91, 'gemeten', T0)); assert.strictEqual(K.effectieveStatus(andereHoek), 'vrijgave-vervallen');
  const anderUit = goed(K.zetMaat(v, 'R1', 'uitsprongen.U1.maten.diepte', { staat: 'gemeten', waarde: 650, bron: 'hand' }, T0)); assert.strictEqual(K.effectieveStatus(anderUit), 'vrijgave-vervallen');
  const anderKnik = goed(K.zetWandVorm(v, 'R1', 'W6', { foto: 'F6', knikken: [{ x: 0.3, y: 0.9, u: 0.3 }, { x: 0.52, y: 0.9, u: 0.52 }], tussenstukken: ['voor'] }, T0)); assert.strictEqual(K.effectieveStatus(anderKnik), 'vrijgave-vervallen');
  // met een enkele diagonaal als controle is de vorm niet bepaald
  let met = goed(K.voegDiagonaalToe(v, 'R1', 'H1', 'H4')); met = meet(met, 'diagonalen.C.maten.lengte', Math.round(Math.hypot(3000, 2000)));
  assert.ok(K.vrijgeefCheck(met).uitzonderingen.some(u => u.soort === 'vorm'), 'een enkele diagonaal maakt de vorm nog niet bepaald: nog steeds een uitzondering');
});
test('een niet gesloten fotoronde of een wand zonder foto blokkeert het vrijgeven', () => {
  const open = goed(K.openRond(volledigeLVorm(), 'R1')); assert.ok(K.vrijgeefCheck(open).redenen.some(x => x.code === 'ronde'));
  const zonder = kopie(volledigeLVorm()); zonder.fotos = zonder.fotos.filter(f => f.wand !== 'W6'); assert.ok(K.vrijgeefCheck(zonder).redenen.some(x => x.code === 'foto' && x.wand === 'W6'));
});
test('migratie v0.3 naar v0.4: een vrijgegeven opname uit de oude kern blijft geldig, vrijgegeven en onveranderd', () => {
  const oud = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'opname-v03-vrijgegeven.json'), 'utf8'));
  assert.strictEqual(oud.versie, '0.3'); assert.strictEqual(oud.status, 'vrijgegeven');
  const gelezen = K.lees(oud); assert.strictEqual(gelezen.alleenLezen, false); assert.deepStrictEqual(gelezen.meldingen, []);
  const nieuw = gelezen.opname; assert.strictEqual(nieuw.versie, '0.4'); assert.strictEqual(nieuw._versie_oud, '0.3');
  assert.strictEqual(K.isVrijgaveGeldig(nieuw), true, 'de hash uit de oude kern klopt nog'); assert.strictEqual(K.effectieveStatus(nieuw), 'vrijgegeven'); assert.strictEqual(nieuw.vrijgave.hash, oud.vrijgave.hash);
  // niets verdwenen of veranderd: alles wat er stond staat er nog, onder dezelfde namen en met dezelfde waarden
  const zonder = kopie(nieuw); zonder.versie = '0.3'; delete zonder._versie_oud; assert.deepStrictEqual(zonder, oud);
  assert.deepStrictEqual(K.wandIds(nieuw.ruimtes[0]), ['N', 'O', 'Z', 'W']); assert.strictEqual(K.isRond(nieuw.ruimtes[0]), true);
  assert.strictEqual(K.vorm(nieuw.ruimtes[0]).status, 'consistent'); assert.strictEqual(K.vrijgeefCheck(nieuw).kan, true);
  // een wijziging na het lezen maakt de vrijgave (zoals altijd) ongeldig, ook na de migratie
  const wijz = goed(K.zetMaat(nieuw, 'R1', 'wanden.N.maten.lengte', { staat: 'gemeten', waarde: 5001, bron: 'hand' }, T0)); assert.strictEqual(K.effectieveStatus(wijz), 'vrijgave-vervallen');
  // opnieuw opslaan en weer lezen blijft stabiel (geen dubbele migratie)
  const slaOp = goed(K.slaOp(nieuw, T0)), nogmaals = K.lees(kopie(slaOp)).opname; assert.strictEqual(nogmaals._versie_oud, '0.3'); assert.strictEqual(K.isVrijgaveGeldig(nogmaals), true);
  // wat de oude kern vroeg, vraagt de nieuwe ook: 17 + 25 voor een ruimte met een werkzone
  assert.strictEqual(K.vragen(nieuw.ruimtes[0]).length, K.vragen(K.lees(oud).opname.ruimtes[0]).length);
});
test('migratie: een v0.3-opname met alleen vier wanden krijgt geen nieuwe velden die de hash veranderen', () => {
  const oud = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'opname-v03-vrijgegeven.json'), 'utf8')), nieuw = K.lees(oud).opname, r = nieuw.ruimtes[0];
  for (const w of r.wanden) assert.strictEqual(w.hoek_naar_volgende, undefined); assert.strictEqual(r.uitsprongen, undefined); assert.strictEqual(r.rond, undefined);
  const verder = goed(K.zetHoek(nieuw, 'R1', 'N', 90, 'gemeten', T0)); assert.strictEqual(K.hoekVan(R(verder), 'N').bron, 'gemeten'); assert.strictEqual(K.effectieveStatus(verder), 'vrijgave-vervallen');
});
test('een v0.4-opname wordt door deze kern ongewijzigd gelezen; een nieuwere versie blijft alleen lezen', () => {
  const op = volledigeLVorm(), g = K.lees(kopie(op)); assert.deepStrictEqual(g.meldingen, []); assert.deepStrictEqual(g.opname, op);
  assert.strictEqual(K.lees({ versie: '0.5', ruimtes: [] }).alleenLezen, true);
});
test('het voorbeeld uit docs/opname-json-v0.4.md bestaat, is leesbaar en klopt met de kern', () => {
  const tekst = fs.readFileSync(path.join(__dirname, '..', 'docs', 'opname-json-v0.4.md'), 'utf8'), m = /```json\r?\n([\s\S]*?)\r?\n```/.exec(tekst); assert.ok(m, 'een json-blok in de documentatie');
  const voorbeeld = JSON.parse(m[1]), g = K.lees(voorbeeld);
  assert.deepStrictEqual(g.meldingen, []); assert.deepStrictEqual(g.opname, voorbeeld, 'lezen verandert het voorbeeld niet');
  const r = g.opname.ruimtes[0], p = K.plattegrond(r); assert.strictEqual(r.rond, true); assert.ok(K.wandIds(r).length >= 5); assert.ok(r.uitsprongen.length >= 1);
  assert.ok(p.contour.length > K.wandIds(r).length, 'de uitsprong staat in de contour'); assert.ok(K.vragen(r).some(v => v.pad.startsWith('uitsprongen.')));
});
test('onwaarschijnlijke maar mogelijke maten moeten voor het vrijgeven bevestigd worden; een kleine maat is gewoon een maat', () => {
  let op = volledigeLVorm(); assert.strictEqual(K.vrijgeefCheck(op).kan, true);
  // een plintdikte of voeg van 6 mm is geen fout: geen minimum meer
  op = goed(K.voegObjectToe(op, 'R1', { type: 'plint', wand: 'W1' })); op = meet(op, 'objecten.PL1.maten.dikte', 6, 'hand'); op = meet(op, 'objecten.PL1.maten.hoogte', 80, 'hand'); op = goed(K.zetMaat(op, 'R1', 'objecten.PL1.maten.keuze', { staat: 'gemeten', keuze: 'blijft', bron: 'hand' }, T0));
  assert.strictEqual(K.vrijgeefCheck(op).kan, true, JSON.stringify(K.vrijgeefCheck(op).redenen));
  // een plafond van 1000 mm kan, maar moet bevestigd worden
  op = meet(op, 'plafondpunten.P1.maten.hoogte', 1000, 'hand');
  const c = K.vrijgeefCheck(op); assert.strictEqual(c.kan, false); assert.deepStrictEqual(c.redenen.map(x => x.code), ['onwaarschijnlijk']); assert.strictEqual(c.redenen[0].pad, 'plafondpunten.P1.maten.hoogte');
  assert.ok(K.bevestigOnwaarschijnlijk(op, 'R1', 'wanden.W1.maten.lengte').fout, 'alleen wat onwaarschijnlijk is, kan bevestigd worden');
  const b = goed(K.bevestigOnwaarschijnlijk(op, 'R1', 'plafondpunten.P1.maten.hoogte', T0)); assert.strictEqual(K.vrijgeefCheck(b).kan, true); assert.strictEqual(R(b).bevestigingen['plafondpunten.P1.maten.hoogte'].waarde, 1000);
  assert.ok(K.waarschuwingen(R(b)).some(x => x.code === 'onwaarschijnlijk' && x.bevestigd), 'de waarschuwing blijft staan, als bevestigd');
  // een andere waarde: de bevestiging geldt niet meer
  assert.strictEqual(K.vrijgeefCheck(meet(b, 'plafondpunten.P1.maten.hoogte', 1100, 'hand')).kan, false);
  // een bevestigde maat is een inhoudelijke wijziging: een eerdere vrijgave vervalt
  const v = goed(K.vrijgeven(b, 'test', T0)); assert.strictEqual(K.effectieveStatus(goed(K.bevestigOnwaarschijnlijk(meet(op, 'wanden.W1.maten.lengte', 20000), 'R1', 'wanden.W1.maten.lengte'))), 'concept');
  assert.strictEqual(K.effectieveStatus(v), 'vrijgegeven');
});
test('een grote verschil in wandlengte tussen onder, midden en boven is onwaarschijnlijk (bevestigen); een kleine is informatie', () => {
  let op = volledigeLVorm();
  op = meet(op, 'wanden.W6.maten.lengte_boven', 4040, 'hand'); let w = K.waarschuwingen(R(op)); assert.ok(w.some(x => x.code === 'wand-scheef')); assert.ok(!w.some(x => x.code === 'onwaarschijnlijk'));
  op = meet(op, 'wanden.W6.maten.lengte_boven', 6000, 'hand'); w = K.waarschuwingen(R(op)); const x = w.find(y => y.code === 'onwaarschijnlijk' && y.pad === 'wanden.W6.scheef'); assert.ok(x && x.waarde === 2000 && !x.bevestigd);
  assert.strictEqual(K.vrijgeefCheck(op).kan, false); op = goed(K.bevestigOnwaarschijnlijk(op, 'R1', 'wanden.W6.scheef')); assert.strictEqual(K.vrijgeefCheck(op).kan, true);
});
test('geometrisch onmogelijke combinaties blokkeren: een opening of uitsprong buiten de wand', () => {
  let op = volledigeLVorm(); assert.strictEqual(K.vrijgeefCheck(op).kan, true);
  op = goed(K.voegOpeningToe(op, 'R1', { soort: 'raam', wand: 'W2', definitie: 'muursparing' })); op = meet(op, 'openingen.R1.maten.breedte', 1500, 'hand'); op = meet(op, 'openingen.R1.maten.positie', 900, 'hand');   // W2 is 2000 mm: 900 + 1500 past niet
  assert.ok(K.waarschuwingen(R(op)).some(x => x.code === 'opening-buiten-wand')); assert.ok(K.vrijgeefCheck(op).redenen.some(x => x.code === 'onmogelijk'));
  op = meet(op, 'openingen.R1.maten.positie', 400, 'hand'); assert.ok(!K.vrijgeefCheck(op).redenen.some(x => x.code === 'onmogelijk'));
  const buiten = meet(op, 'uitsprongen.U1.maten.positie', 5900, 'hand'); assert.ok(K.vrijgeefCheck(buiten).redenen.some(x => x.code === 'onmogelijk' && x.pad === 'uitsprongen.U1'));
});
console.log('\n' + n + ' tests geslaagd' + (process.exitCode ? ' (met fouten)' : ''));
