// Tests van de sluiting en de drie statussen van de vorm (brok 3b, ChatGPT-review 043): positie- en richtingssluiting, de hoekensom, raakpunten en overlap, een wand als diagonaal,
// getekend / geometrisch bepaald / onafhankelijk gecontroleerd. Draaien: node test/opname-sluiting.test.js — verzonnen ruimte, geen persoonsgegevens.
'use strict';
const assert = require('assert');
const K = require('../mt-opname-kern.js');
let n = 0; const test = (naam, fn) => { try { fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };
const kopie = x => JSON.parse(JSON.stringify(x));
const T0 = '2026-11-01T09:00:00.000Z';
const goed = res => { assert.strictEqual(res.fout, null, res.fout); return res.opname; };
const R = op => op.ruimtes[0];
const meet = (op, pad, waarde) => goed(K.zetMaat(op, 'R1', pad, { staat: 'gemeten', waarde, bron: 'disto' }, T0));
const hoek = (op, w, g, bron) => goed(K.zetHoek(op, 'R1', w, g, bron, T0));
// De zes wanden van ChatGPT's repro (043): lengtes [6000,2000,3000,2000,3000,4000], binnenhoeken [90,90,270,90,90,90], H1 tot H6, rond.
const LENGTES = [6000, 2000, 3000, 2000, 3000, 4000], HOEKEN = [90, 90, 270, 90, 90, 90];
function zesWanden(opties) {
  opties = opties || {};
  let op = K.nieuweOpname({ opname_id: 'OPN-TEST-043', project: { code: 'TEST-001' }, aangemaakt: T0, ruimtes: [K.nieuweRuimte({ id: 'R1', naam: 'Testkamer', wanden: [] })] });
  for (let i = 0; i < 6; i++) op = goed(K.voegWandToe(op, 'R1'));
  op = goed(K.maakRond(op, 'R1'));
  const hoeken = HOEKEN.slice(); if (opties.laatste != null) hoeken[5] = opties.laatste;
  hoeken.forEach((g, i) => { const bron = (i === 5 && opties.laatsteBron) || opties.bron; if (g !== 90 || bron) op = hoek(op, 'W' + (i + 1), g, bron); });
  LENGTES.forEach((l, i) => { op = meet(op, 'wanden.W' + (i + 1) + '.maten.lengte', l); });
  return op;
}
const metDiagonaal = (op, van, naar, waarde) => { const res = K.voegDiagonaalToe(op, 'R1', van, naar); assert.strictEqual(res.fout, null, res.fout); return meet(res.opname, 'diagonalen.' + res.id + '.maten.lengte', waarde); };
const hyp = (a, b) => Math.round(Math.hypot(a, b));
// Alle diagonalen van de L-vorm die helemaal binnen de ruimte liggen (voor de driehoeksverdeling): H1-H3, H1-H4, H1-H5, H2-H4, H4-H6.
const D = { 'H1-H3': hyp(6000, 2000), 'H1-H4': hyp(3000, 2000), 'H1-H5': hyp(3000, 4000), 'H2-H4': hyp(3000, 2000), 'H4-H6': hyp(3000, 2000) };

test('repro 043 P1: laatste hoek 90 mag kloppen (hoekensom 720, positie en richting sluiten), met diagonaal H1-H3 niet globaal groen', () => {
  let op = metDiagonaal(zesWanden(), 'H1', 'H3', hyp(6000, 2000)); const v = K.vorm(R(op));
  assert.notStrictEqual(v.status, 'inconsistent'); assert.strictEqual(v.hoeksom.som, 720); assert.strictEqual(v.hoeksom.verwacht, 720); assert.ok(v.sluitfout.mm <= 1);
  assert.strictEqual(v.bepaling, 'getekend', 'een diagonaal bewijst niet alle aangenomen hoeken'); assert.notStrictEqual(v.status, 'consistent'); assert.strictEqual(v.schematisch, true);
  for (const [h, g] of Object.entries({ H1: 90, H2: 90, H3: 90, H4: 270, H5: 90, H6: 90 })) assert.ok(Math.abs(v.hoeken_gereconstrueerd[h] - g) < 0.5, h + ' ' + v.hoeken_gereconstrueerd[h]);
});
test('repro 043 P1: laatste hoek 270 of 135 (gemeten) sluit niet in richting: nooit consistent', () => {
  for (const [g, bron] of [[270, undefined], [135, 'gemeten']]) {
    const op = metDiagonaal(zesWanden({ laatste: g, laatsteBron: bron }), 'H1', 'H3', hyp(6000, 2000)), v = K.vorm(R(op));
    assert.strictEqual(v.status, 'inconsistent', 'laatste hoek ' + g); assert.ok(v.hoeksom.som !== 720 && Math.abs(v.hoeksom.verschil) > 1);
    assert.ok(/tellen op tot/.test(v.reden) && /720/.test(v.reden), v.reden);
    assert.ok(K.sluitcontrole(R(op)).conflicten.length === 1 && K.vrijgeefCheck(op).redenen.some(x => x.code === 'conflict'), 'blokkeert het vrijgeven');
  }
});
test('sluit het niet onder aangenomen hoeken, dan staat er dat de hoeken niet kloppen, niet dat de wandmetingen fout zijn', () => {
  const v = K.vorm(R(zesWanden({ laatste: 270 })));
  assert.ok(/aangenomen hoeken/.test(v.reden) && /controlehoek/.test(v.reden) && /niet dat de wandlengtes fout zijn/.test(v.reden), v.reden);
  assert.deepStrictEqual(v.betrokken, [], 'geen wandmaat wordt als fout aangewezen'); assert.strictEqual(v.volgende.soort, 'hoek');
  const p = K.vorm(R(zesWanden({ bron: 'aanname', laatste: 90 }))); assert.notStrictEqual(p.status, 'inconsistent');
  // een lengte die niet sluit onder aangenomen hoeken: ook de positiesluiting noemt de hoeken
  const l = K.vorm(R(meet(zesWanden(), 'wanden.W6.maten.lengte', 4100))); assert.strictEqual(l.status, 'inconsistent'); assert.ok(/aangenomen hoeken/.test(l.reden) && /controlehoek/.test(l.reden), l.reden);
});
test('wandBotsing: strikte kruising, hoekpunt op een andere wand, collineaire overlap en terugvouwen', () => {
  const B = K._intern.wandBotsing;
  assert.strictEqual(B([[0, 0], [6000, 0], [6000, 2000], [3000, 2000], [3000, 4000], [0, 4000]], 1), null, 'de L-vorm is geldig');
  assert.strictEqual(B([[0, 0], [4000, 3000], [4000, 0], [0, 3000]], 1).soort, 'kruist', 'strikte kruising (vlinderdas)');
  assert.strictEqual(B([[0, 0], [6000, 0], [6000, 3000], [3000, 0], [0, 3000]], 1).soort, 'raakt', 'een hoekpunt ligt midden op een andere wand');
  assert.ok(['raakt', 'overlapt'].includes(B([[0, 0], [4000, 0], [4000, 1000], [3000, 1000], [3000, 0], [1000, 0]], 1).soort), 'twee wanden liggen collineair over elkaar'); assert.strictEqual(B([[0, 0], [6000, 0], [6000, 3000], [3000, 5], [0, 3000]], 1), null, 'op 5 mm van de wand is geen botsing');
  assert.strictEqual(B([[0, 0], [4000, 0], [2000, 0]], 1).soort, 'overlapt', 'een wand vouwt terug over de vorige');
  assert.strictEqual(B([[0, 0], [4000, 0], [4000, 3000], [0, 3000]], 1), null);
});
test('een vorm waarvan een hoekpunt op een andere wand ligt is inconsistent (geen strikte kruising nodig)', () => {
  // vijf wanden: A(0,0) B(6000,0) C(6000,3000) D(3000,0) E(0,3000)? de hoeken volgen uit de rondgang; hier kloppen ze niet met 90, dus bouwen we de raakvorm met schuine gemeten hoeken
  let op = K.nieuweOpname({ opname_id: 'X', ruimtes: [K.nieuweRuimte({ id: 'R1', naam: 'T', wanden: [] })] });
  for (let i = 0; i < 5; i++) op = goed(K.voegWandToe(op, 'R1')); op = goed(K.maakRond(op, 'R1'));
  const pts = [[0, 0], [6000, 0], [6000, 3000], [3000, 0], [0, 3000]], L = pts.map((p, i) => Math.hypot(pts[(i + 1) % 5][0] - p[0], pts[(i + 1) % 5][1] - p[1]));
  const richting = pts.map((p, i) => Math.atan2(pts[(i + 1) % 5][1] - p[1], pts[(i + 1) % 5][0] - p[0]) * 180 / Math.PI);
  const g = pts.map((p, i) => { const volg = richting[(i + 1) % 5], draai = ((volg - richting[i] + 540) % 360) - 180; return Math.round((180 - draai) * 100) / 100; });
  g.forEach((x, i) => { op = hoek(op, 'W' + (i + 1), x, 'gemeten'); }); L.forEach((l, i) => { op = meet(op, 'wanden.W' + (i + 1) + '.maten.lengte', Math.round(l)); });
  const v = K.vorm(R(op)); assert.strictEqual(v.status, 'inconsistent'); assert.ok(/ligt op een andere wand|kruisen|over elkaar|lopen niet/.test(v.reden), v.reden);
});
test('een wand is geen diagonaal: voegDiagonaalToe weigert aangrenzende hoeken, ook de sluitende wand H6-H1', () => {
  const op = zesWanden();
  for (const [a, b] of [['H1', 'H2'], ['H2', 'H1'], ['H6', 'H1'], ['H1', 'H6'], ['H3', 'H4']]) { const res = K.voegDiagonaalToe(op, 'R1', a, b); assert.ok(res.fout && /is een wand, geen diagonaal/.test(res.fout), a + b); }
  assert.strictEqual(K.voegDiagonaalToe(op, 'R1', 'H1', 'H3').fout, null); assert.strictEqual(K.hoekenAangrenzend(R(op), 'H2', 'H3'), true); assert.strictEqual(K.hoekenAangrenzend(R(op), 'H1', 'H3'), false);
  assert.ok(K.voegDiagonaalToe(K.nieuweOpname({ ruimtes: [K.nieuweRuimte({ id: 'R1', wanden: [] })] }), 'R1', 'H1', 'H2').fout);
});
test('repro 043 P1: H1-H2 = 6000 (de eerste wand) als diagonaal uit een import promoveert de vorm niet', () => {
  let op = zesWanden(); const r = R(op);
  r.diagonalen = [{ id: 'C', van: 'H1', naar: 'H2', maten: { lengte: { staat: 'gemeten', waarde: 6000, bron: 'disto', tijd: T0 } } }];
  const gelezen = K.lees(kopie(op)); assert.ok(gelezen.meldingen.some(m => /Diagonaal C/.test(m) && /is een wand/.test(m)), JSON.stringify(gelezen.meldingen));
  const v = K.vorm(R(gelezen.opname));
  assert.notStrictEqual(v.status, 'consistent'); assert.strictEqual(v.bepaling, 'getekend'); assert.strictEqual(v.schematisch, true); assert.strictEqual(v.controles.length, 0); assert.strictEqual(v.genegeerd.length, 1);
  assert.ok(K.waarschuwingen(R(gelezen.opname)).some(w => w.code === 'diagonaal-is-wand'));
  assert.ok(!K.vragen(R(gelezen.opname)).some(q => q.pad.startsWith('diagonalen.C')), 'geen vraag voor een diagonaal die een wand is');
  assert.strictEqual(K.waarde(R(gelezen.opname).diagonalen[0].maten.lengte), 6000, 'de maat gaat niet verloren');
});
test('statussen: getekend onder hoekaanname, geometrisch bepaald (bevestigde hoeken of N-3 diagonalen), onafhankelijk gecontroleerd (extra maat)', () => {
  // alles aangenomen + alle lengtes: getekend (de wanden sluiten, maar een lengte bewijst geen richting)
  let v = K.vorm(R(zesWanden())); assert.strictEqual(v.bepaling, 'getekend'); assert.strictEqual(v.status, 'onverifieerd'); assert.ok(/onder hoekaanname/.test(v.reden)); assert.strictEqual(v.volgende.soort, 'diagonaal');
  // alle hoeken gemeten/bevestigd (90 en 270) + alle lengtes: bepaald, nog niet gecontroleerd
  const bevestigd = zesWanden({ bron: 'gemeten' }); v = K.vorm(R(bevestigd));
  assert.strictEqual(v.bepaling, 'bepaald'); assert.strictEqual(v.schematisch, false); assert.strictEqual(v.status, 'onverifieerd'); assert.strictEqual(v.volgende.soort, 'controle');
  // plus een diagonaal die klopt: onafhankelijk gecontroleerd
  v = K.vorm(R(metDiagonaal(bevestigd, 'H1', 'H3', D['H1-H3']))); assert.strictEqual(v.bepaling, 'gecontroleerd'); assert.strictEqual(v.status, 'consistent'); assert.strictEqual(v.volgende, null);
  // N-3 = 3 onafhankelijke interne diagonalen (aangenomen hoeken): bepaald
  let op = zesWanden(); for (const k of ['H1-H3', 'H1-H4', 'H4-H6']) { const [a, b] = k.split('-'); op = metDiagonaal(op, a, b, D[k]); }
  v = K.vorm(R(op)); assert.strictEqual(v.bepaling, 'bepaald', v.reden); assert.strictEqual(v.status, 'onverifieerd'); assert.strictEqual(v.schematisch, false);
  // een vierde die klopt is een onafhankelijke controle
  v = K.vorm(R(metDiagonaal(op, 'H2', 'H4', D['H2-H4']))); assert.strictEqual(v.bepaling, 'gecontroleerd'); assert.strictEqual(v.status, 'consistent');
  // een van de drie klopt niet: conflict
  const fout = metDiagonaal(metDiagonaal(zesWanden(), 'H1', 'H3', D['H1-H3']), 'H1', 'H4', D['H1-H4'] + 40); assert.strictEqual(K.vorm(R(fout)).status, 'inconsistent');
});
test('twee diagonalen die elkaar kruisen, een diagonaal door de buitenruimte en een herhaling tellen niet als onafhankelijke driehoeksverdeling', () => {
  // H1-H5 en H4-H6 kruisen elkaar; samen met H1-H3 zijn dat drie diagonalen maar geen triangulatie
  let op = zesWanden(); for (const k of ['H1-H3', 'H1-H5', 'H4-H6']) { const [a, b] = k.split('-'); op = metDiagonaal(op, a, b, D[k]); }
  assert.strictEqual(K.vorm(R(op)).bepaling, 'getekend', 'kruisende diagonalen leggen de vorm niet vast');
  // H3-H5 loopt door de buitenruimte van de L (blinde waaier): klopt de maat, dan nog telt hij niet
  let buiten = zesWanden(); for (const [k, w] of [['H1-H3', D['H1-H3']], ['H1-H4', D['H1-H4']], ['H3-H5', hyp(3000, 2000)]]) { const [a, b] = k.split('-'); buiten = metDiagonaal(buiten, a, b, w); }
  const vb = K.vorm(R(buiten)); assert.strictEqual(vb.bepaling, 'getekend'); assert.strictEqual(vb.controles.find(c => c.diagonaal === 'E').binnen, false);
  // een herhaling van dezelfde twee hoeken (via een import) is geen onafhankelijke maat
  const dubbel = kopie(metDiagonaal(zesWanden(), 'H1', 'H3', D['H1-H3'])); R(dubbel).diagonalen.push({ id: 'D', van: 'H3', naar: 'H1', maten: { lengte: { staat: 'gemeten', waarde: D['H1-H3'], bron: 'disto', tijd: T0 } } });
  const vd = K.vorm(R(dubbel)); assert.strictEqual(vd.controles.length, 2); assert.strictEqual(vd.controles[1].herhaling, true); assert.strictEqual(vd.controles[1].telt, false);
});
test('de app vraagt telkens de volgende benodigde maat: een diagonaal binnen de ruimte die de gekozen diagonalen niet kruist', () => {
  let op = zesWanden(), v = K.vorm(R(op)); assert.strictEqual(v.volgende.soort, 'diagonaal'); assert.strictEqual(v.volgende.nog, 3);
  assert.ok(!K.hoekenAangrenzend(R(op), v.volgende.van, v.volgende.naar), 'nooit een wand voorstellen');
  op = metDiagonaal(op, v.volgende.van, v.volgende.naar, Math.round(Math.hypot.apply(null, (() => { const p = v.hoekpunten_mm; return [p[v.volgende.van][0] - p[v.volgende.naar][0], p[v.volgende.van][1] - p[v.volgende.naar][1]]; })())));
  const v2 = K.vorm(R(op)); assert.strictEqual(v2.volgende.nog, 2); assert.notStrictEqual(v2.volgende.van + v2.volgende.naar, v.volgende.van + v.volgende.naar);
});
test('vierhoek: één diagonaal bepaalt de vorm (bepaald), de tweede controleert (gecontroleerd); zonder diagonaal getekend', () => {
  let op = K.nieuweOpname({ opname_id: 'Q', ruimtes: [K.nieuweRuimte({ id: 'R1', naam: 'Q', wanden: [] })] });
  for (let i = 0; i < 4; i++) op = goed(K.voegWandToe(op, 'R1')); op = goed(K.maakRond(op, 'R1'));
  [5000, 3000, 5000, 3000].forEach((l, i) => { op = meet(op, 'wanden.W' + (i + 1) + '.maten.lengte', l); });
  let v = K.vorm(R(op)); assert.strictEqual(v.bepaling, 'getekend'); assert.strictEqual(v.volgende.soort, 'diagonaal');
  op = meet(op, 'diagonalen.A.maten.lengte', hyp(5000, 3000)); v = K.vorm(R(op)); assert.strictEqual(v.bepaling, 'bepaald'); assert.strictEqual(v.schematisch, false); assert.strictEqual(v.volgende.soort, 'controle');
  op = meet(op, 'diagonalen.B.maten.lengte', hyp(5000, 3000)); v = K.vorm(R(op)); assert.strictEqual(v.bepaling, 'gecontroleerd'); assert.strictEqual(v.status, 'consistent');
});
console.log('\n' + n + ' tests geslaagd');
