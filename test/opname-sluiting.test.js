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
test('vormLabel: de tekst volgt de bewezen stap en beweert nergens meer (scherm 33: niet "Alles gemeten en gecontroleerd")', () => {
  const l = op => K.vormLabel(K.vorm(R(op)));
  assert.strictEqual(l(zesWanden()).kort, 'Lengtes gemeten; model onder hoekaanname');
  assert.strictEqual(l(metDiagonaal(zesWanden(), 'H1', 'H3', D['H1-H3'])).kort, 'Lengtes gemeten; model onder hoekaanname; controle C klopt');
  assert.strictEqual(l(zesWanden({ bron: 'gemeten' })).bepaling, 'bepaald'); assert.ok(/nog niet met een controlemaat gecontroleerd/.test(l(zesWanden({ bron: 'gemeten' })).kort));
  assert.strictEqual(l(metDiagonaal(zesWanden({ bron: 'gemeten' }), 'H1', 'H3', D['H1-H3'])).kort, 'Vorm gecontroleerd met controlemaat C');
  assert.strictEqual(l(zesWanden({ laatste: 270 })).pil, 'conflict');
  for (const op of [zesWanden(), metDiagonaal(zesWanden(), 'H1', 'H3', D['H1-H3'])]) assert.ok(!/Alles/.test(l(op).kort) && !/^Vorm gecontroleerd/.test(l(op).kort));
  assert.ok(/Getekend/.test(K.vormLabel(K.vorm(R(K.nieuweOpname({ ruimtes: [K.nieuweRuimte({ id: 'R1', wanden: [] })] })))).kort));
});
test('haaksheid met een driehoek: hoek uit a, b en c; haaks wordt bevestigd (gemeten), een afwijking wordt een gemeten schuine hoek, en de drie maten blijven bewaard', () => {
  assert.strictEqual(K.hoekUitDriehoek(1000, 1000, 1414), 89.98); assert.strictEqual(K.hoekUitDriehoek(1000, 1000, 3000), null); assert.strictEqual(K.hoekUitDriehoek(0, 1, 1), null);
  const op = zesWanden(), res = K.zetHoekDriehoek(op, 'R1', 'W1', 1000, 1000, 1414, T0); assert.strictEqual(res.fout, null); assert.strictEqual(res.haaks, true);
  assert.deepStrictEqual([K.hoekVan(R(res.opname), 'W1').graden, K.hoekVan(R(res.opname), 'W1').bron], [89.98, 'gemeten'], 'de werkelijk gemeten hoek, niet afgerond naar 90'); assert.strictEqual(R(res.opname).wanden[0].hoek_naar_volgende.driehoek.c, 1414);
  const scheef = K.zetHoekDriehoek(op, 'R1', 'W1', 1000, 1000, 1500, T0); assert.strictEqual(scheef.haaks, false); assert.ok(Math.abs(K.hoekVan(R(scheef.opname), 'W1').graden - 97.18) < 0.05, K.hoekVan(R(scheef.opname), 'W1').graden);
  // een inspringende hoek (270) meet je over de hoek heen: 360 min de gemeten hoek
  const binnen = K.zetHoekDriehoek(op, 'R1', 'W3', 1000, 1000, 1414, T0); assert.deepStrictEqual([K.hoekVan(R(binnen.opname), 'W3').graden, K.hoekVan(R(binnen.opname), 'W3').bron], [270.02, 'gemeten']);
  assert.ok(K.zetHoekDriehoek(op, 'R1', 'W1', 1000, 1000, 2500, T0).fout);
  // alle zes hoeken bevestigd haaks (via de driehoek) + alle lengtes: geometrisch bepaald
  let alles = op; ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'].forEach(w => { alles = K.zetHoekDriehoek(alles, 'R1', w, 1000, 1000, 1414, T0).opname; });
  assert.strictEqual(K.vorm(R(alles)).bepaling, 'bepaald');
});
test('voorstel voor de werkzone: de hoeken aan de uiteinden van de werkzone-wand die nog aangenomen zijn', () => {
  let op = goed(K.zetRuimte(zesWanden(), 'R1', { werkzone: ['W2'] }));
  assert.deepStrictEqual(K.haaksheidsVoorstel(R(op)).map(x => x.wand + ':' + x.hoek), ['W1:H2', 'W2:H3'], 'begin en eind van wand 2');
  op = K.zetHoekDriehoek(op, 'R1', 'W1', 1000, 1000, 1414, T0).opname;
  assert.deepStrictEqual(K.haaksheidsVoorstel(R(op)).map(x => x.wand), ['W2'], 'een bevestigde hoek valt weg');
  op = goed(K.zetRuimte(op, 'R1', { werkzone: ['W1'] })); assert.deepStrictEqual(K.haaksheidsVoorstel(R(op)).map(x => x.wand), ['W6'], 'wand 1: de hoek ervoor (na wand 6); de hoek erna is al bevestigd');
});
test('uitsprong: drie gescheiden bronnen (bronstandaard / foto-interpretatie / gemeten); gemeten winnen en blijven als de kalibratie later wijzigt', () => {
  let op = ruimteVier();
  op = goed(K.zetWandVorm(op, 'R1', 'W2', { foto: 'F1', knikken: [{ x: 0.3, y: 0.9, u: 0.3 }, { x: 0.5, y: 0.9, u: 0.5 }], tussenstukken: ['voor'] }, T0));
  op = meet(op, 'wanden.W2.maten.lengte', 5000);
  let v = K.uitsprongWaarden(R(op), R(op).uitsprongen[0]);
  assert.deepStrictEqual([v.breedte.bron, v.positie.bron, v.diepte.bron], ['foto-interpretatie', 'foto-interpretatie', 'bronstandaard']);
  assert.deepStrictEqual([v.breedte.mm, v.positie.mm, v.diepte.mm], [1000, 1500, 300]);
  assert.strictEqual(v.breedte.voorstel.bron, 'foto-interpretatie'); assert.strictEqual(v.diepte.voorstel.bron, 'bronstandaard'); assert.notStrictEqual(v.diepte.voorstel.bron, 'foto-voorstel');
  assert.deepStrictEqual(Object.keys(K.WAARDE_BRONNEN), ['gemeten', 'foto-interpretatie', 'bronstandaard']);
  assert.ok(K.vragen(R(op)).filter(x => x.object === 'U1').every(x => x.staat === 'open'), 'geen van de drie is een meting');
  // gemeten breedte, positie en diepte winnen
  for (const [k, w] of [['breedte', 940], ['positie', 1480], ['diepte', 420]]) op = meet(op, 'uitsprongen.U1.maten.' + k, w);
  v = K.uitsprongWaarden(R(op), R(op).uitsprongen[0]); assert.deepStrictEqual([v.breedte.bron, v.positie.bron, v.diepte.bron], ['gemeten', 'gemeten', 'gemeten']); assert.deepStrictEqual([v.breedte.mm, v.positie.mm, v.diepte.mm], [940, 1480, 420]);
  // de kalibratie (de vier wandhoeken op de foto) verandert: de knikken krijgen een andere plek op de wand; de gemeten maten blijven staan en blijven leidend
  op = goed(K.zetWandVorm(op, 'R1', 'W2', { foto: 'F1', knikken: [{ x: 0.35, y: 0.9, u: 0.36 }, { x: 0.62, y: 0.9, u: 0.61 }], tussenstukken: ['voor'] }, T0));
  assert.deepStrictEqual(R(op).uitsprongen[0].verhouding, { van: 0.36, tot: 0.61, bron: 'foto-voorstel' }, 'de foto-interpretatie is bijgewerkt');
  v = K.uitsprongWaarden(R(op), R(op).uitsprongen[0]); assert.deepStrictEqual([v.breedte.mm, v.positie.mm, v.diepte.mm], [940, 1480, 420]); assert.deepStrictEqual([v.breedte.bron, v.positie.bron, v.diepte.bron], ['gemeten', 'gemeten', 'gemeten']);
  const p = K.plattegrond(R(op)).uitsprongen[0]; assert.deepStrictEqual([p.breedte, p.positie, p.diepte], [940, 1480, 420]); assert.deepStrictEqual(p.geschat, { positie: false, breedte: false, diepte: false }); assert.deepStrictEqual(p.bron, { positie: 'gemeten', breedte: 'gemeten', diepte: 'gemeten' });
  // alleen de diepte nog niet gemeten: die blijft als enige bronstandaard
  const half = meet(meet(ruimteVierMetUitsprong(), 'uitsprongen.U1.maten.breedte', 900), 'uitsprongen.U1.maten.positie', 1200), ph = K.plattegrond(R(half)).uitsprongen[0];
  assert.deepStrictEqual(ph.bron, { positie: 'gemeten', breedte: 'gemeten', diepte: 'bronstandaard' });
});
function ruimteVier() {
  let op = K.nieuweOpname({ opname_id: 'U', aangemaakt: T0, ruimtes: [K.nieuweRuimte({ id: 'R1', naam: 'U', wanden: [] })] });
  for (let i = 0; i < 4; i++) op = goed(K.voegWandToe(op, 'R1')); return goed(K.maakRond(op, 'R1'));
}
function ruimteVierMetUitsprong() {
  let op = ruimteVier(); op = goed(K.zetWandVorm(op, 'R1', 'W2', { foto: 'F1', knikken: [{ x: 0.3, y: 0.9, u: 0.3 }, { x: 0.5, y: 0.9, u: 0.5 }], tussenstukken: ['voor'] }, T0));
  return meet(op, 'wanden.W2.maten.lengte', 5000);
}
test('meerdere foto\'s van hetzelfde vlak geven geen extra wand: een extra foto hoort bij een bestaande wand', () => {
  let op = ruimteVier();
  const foto = (id, wand, extra) => ({ id, bestand: id + '.jpg', ruimte: 'R1', wand, tijd: T0, ...(extra ? { soort: 'extra' } : {}) });
  op = goed(K.voegFotoToe(op, foto('F1', 'W1')));
  const aantal = K.wandIds(R(op)).length;
  assert.ok(K.voegFotoToe(op, foto('F2', 'W1', true)).opname, 'een extra foto bij een wand met foto kan');
  op = goed(K.voegFotoToe(op, foto('F2', 'W1', true))); op = goed(K.voegFotoToe(op, foto('F3', 'W1', true)));
  assert.strictEqual(K.wandIds(R(op)).length, aantal, 'het aantal wanden verandert niet');
  assert.strictEqual(K.wandFoto(op, 'R1', 'W1').id, 'F1', 'de hoofdfoto blijft de hoofdfoto'); assert.deepStrictEqual(K.extraFotos(op, 'R1', 'W1').map(f => f.id), ['F2', 'F3']);
  assert.ok(K.voegFotoToe(op, foto('F4', 'W2', true)).fout && /al een foto/.test(K.voegFotoToe(op, foto('F4', 'W2', true)).fout), 'een extra foto zonder hoofdfoto kan niet');
  // een extra foto telt niet als de foto van een andere wand: W2 blijft zonder foto en blokkeert (waarschuwing of reden) zoals voorheen
  assert.strictEqual(K.wandFoto(op, 'R1', 'W2'), null);
  // de hoofdfoto vervangen laat de extra foto's staan
  const nieuweHoofd = goed(K.voegFotoToe(goed(K.verwijderFoto(op, 'F1')), foto('F5', 'W1'))); assert.strictEqual(K.wandFoto(nieuweHoofd, 'R1', 'W1').id, 'F5'); assert.strictEqual(K.extraFotos(nieuweHoofd, 'R1', 'W1').length, 2);
  // de laatste wand weghalen neemt ook de extra foto's mee naar het archief
  let met = goed(K.voegFotoToe(ruimteVier(), foto('G1', 'W4'))); met = goed(K.voegFotoToe(met, foto('G2', 'W4', true))); const weg = goed(K.verwijderLaatsteWand(goed(K.openRond(met, 'R1')), 'R1'));
  assert.strictEqual(K.fotosVan(weg, 'R1', 'W4').length, 0); assert.strictEqual(weg.fotos_verwijderd.length, 2);
});
test('historische v0.3-vrijgave blijft geldig maar staat als "gevalideerd met oude kern (v0.3)"; een nieuwe vrijgave staat op de huidige kern', () => {
  const fs = require('fs'), path = require('path');
  const oud = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'opname-v03-vrijgegeven.json'), 'utf8')), gelezen = K.lees(oud);
  assert.strictEqual(K.effectieveStatus(gelezen.opname), 'vrijgegeven', 'de oude vrijgave blijft geldig');
  const kern = K.vrijgaveKern(gelezen.opname); assert.deepStrictEqual([kern.versie, kern.oud, kern.tekst], ['0.3', true, 'Gevalideerd met oude kern (v0.3)']);
  // een wijziging laat de vrijgave vervallen (dan is er geen kernlabel meer)
  const gewijzigd = goed(K.zetMaat(gelezen.opname, 'R1', 'wanden.N.maten.lengte', { staat: 'gemeten', waarde: 5770, bron: 'hand' }, T0)); assert.strictEqual(K.vrijgaveKern(gewijzigd), null);
  // opnieuw vrijgeven met de nieuwe kern: dan staat de huidige kern erop
  const opnieuw = K.vrijgeven(gelezen.opname, 'test', T0); assert.strictEqual(opnieuw.fout, null, opnieuw.fout);
  const k2 = K.vrijgaveKern(opnieuw.opname); assert.deepStrictEqual([k2.versie, k2.oud, k2.tekst], [K.VERSIE, false, 'Gevalideerd met kern v' + K.VERSIE]); assert.strictEqual(opnieuw.opname.vrijgave.kern, K.VERSIE);
  assert.strictEqual(K.vrijgaveKern(K.nieuweOpname({ ruimtes: [K.nieuweRuimte({ id: 'R1' })] })), null, 'zonder vrijgave geen kernlabel');
});
test('de tekst noemt alleen diagonalen die meetellen; een diagonaal door de buitenruimte of een herhaling staat er apart bij', () => {
  let op = zesWanden(); for (const k of ['H1-H3', 'H1-H4', 'H3-H5']) { const [a, b] = k.split('-'); op = metDiagonaal(op, a, b, k === 'H3-H5' ? hyp(3000, 2000) : D[k]); }
  const v = K.vorm(R(op)), l = K.vormLabel(v);
  assert.strictEqual(l.kort, 'Lengtes gemeten; model onder hoekaanname; controle C en D klopt', 'E (H3-H5, door de buitenruimte) staat er niet bij');
  assert.ok(/Diagonaal E loopt door de buitenruimte en telt niet mee/.test(v.reden), v.reden);
});
// ── Brok 3c: ChatGPT-review 046 ──
// P1: een gemeten hoek die de uit de maten berekende vorm tegenspreekt wordt nooit stil genegeerd (ChatGPT's repro letterlijk).
function vierWanden(opties) {
  opties = opties || {};
  let op = K.nieuweOpname({ opname_id: 'OPN-TEST-046', project: { code: 'TEST-001' }, aangemaakt: T0, ruimtes: [K.nieuweRuimte({ id: 'R1', naam: 'Testkamer', wanden: [] })] });
  for (let i = 0; i < 4; i++) op = goed(K.voegWandToe(op, 'R1'));
  op = goed(K.maakRond(op, 'R1'));
  [4000, 3000, 4000, 3000].forEach((l, i) => { op = meet(op, 'wanden.W' + (i + 1) + '.maten.lengte', l); });
  (opties.diagonalen || []).forEach(([id, l]) => { op = meet(op, 'diagonalen.' + id + '.maten.lengte', l); });
  return op;
}
test('046 P1: vier wanden 4000/3000/4000/3000, diagonalen A en B 5000, hoek na wand 1 gemeten 100 graden: conflict met pad, niet gecontroleerd', () => {
  const basis = vierWanden({ diagonalen: [['A', 5000], ['B', 5000]] });
  assert.strictEqual(K.vorm(R(basis)).bepaling, 'gecontroleerd', 'zonder de tegenstrijdige hoek is de vorm gecontroleerd');
  const op = hoek(basis, 'W1', 100, 'gemeten'), v = K.vorm(R(op));
  assert.strictEqual(v.status, 'inconsistent'); assert.strictEqual(v.bepaling, null); assert.strictEqual(K.vormLabel(v).pil, 'conflict');
  assert.ok(v.betrokken.includes('wanden.W1.hoek_naar_volgende'), v.betrokken.join(' '));
  assert.deepStrictEqual([v.hoek_conflict.hoek, v.hoek_conflict.wand, v.hoek_conflict.gemeten_graden, v.hoek_conflict.berekend_graden], ['H2', 'W1', 100, 90]);
  assert.ok(/hoek 2 is 100 graden gemeten/.test(v.reden) && /volgt 90 graden/.test(v.reden), v.reden);
  assert.ok(!/gecontroleerd met/.test(K.vormLabel(v).kort));
});
test('046 P1: elke gemeten hoek wordt getoetst (eerste en laatste ook), ook met slechts een diagonaal; een aangenomen hoek mag afwijken', () => {
  for (const diag of [[['A', 5000]], [['B', 5000]], [['A', 5000], ['B', 5000]]]) {
    const basis = vierWanden({ diagonalen: diag });
    for (const w of ['W1', 'W2', 'W3', 'W4']) {
      const v = K.vorm(R(hoek(basis, w, 100, 'gemeten')));
      assert.strictEqual(v.status, 'inconsistent', w + ' met ' + diag.length + ' diagonaal'); assert.ok(v.betrokken.includes('wanden.' + w + '.hoek_naar_volgende'), w);
      assert.strictEqual(K.vorm(R(hoek(basis, w, 90, 'gemeten'))).status, diag.length === 2 ? 'consistent' : 'onverifieerd', 'een gemeten hoek die klopt, ' + w);
    }
    const aangenomen = K.vorm(R(hoek(basis, 'W1', 100, 'aanname')));
    assert.notStrictEqual(aangenomen.status, 'inconsistent', 'een aangenomen hoek van 100 graden mag afwijken van de uit echte maten berekende vorm');
  }
});
test('046 P1: de marge is de eigen onzekerheid van de gemeten hoek, niet alleen 1 graad', () => {
  const basis = vierWanden({ diagonalen: [['A', 5000]] });
  assert.strictEqual(K.vorm(R(hoek(basis, 'W1', 90.9, 'gemeten'))).status, 'onverifieerd', '0,9 graden valt binnen de 1 graad');
  assert.strictEqual(K.vorm(R(hoek(basis, 'W1', 91.5, 'gemeten'))).status, 'inconsistent', '1,5 graden is te veel zonder opgegeven onzekerheid');
  const ruim = goed(K.zetHoek(basis, 'R1', 'W1', 91.5, 'gemeten', T0, { methode: 'invoer', onzekerheid_graden: 1 }));
  assert.strictEqual(K.vorm(R(ruim)).status, 'onverifieerd', 'met een opgegeven onzekerheid van 1 graad is 1,5 graden nog te rijmen');
  assert.strictEqual(K.hoekVan(R(ruim), 'W1').onzekerheid, 1);
});
test('046 P1: zelfde toets in de N-hoek-route: een tegenstrijdige gemeten hoek geeft een conflict met het pad van de gemeten hoeken, nooit gecontroleerd', () => {
  const goedeOp = metDiagonaal(zesWanden({ bron: 'gemeten' }), 'H1', 'H3', D['H1-H3']);
  assert.strictEqual(K.vorm(R(goedeOp)).bepaling, 'gecontroleerd');
  for (let i = 1; i <= 6; i++) {
    const v = K.vorm(R(hoek(goedeOp, 'W' + i, i === 3 ? 250 : 100, 'gemeten')));
    assert.strictEqual(v.status, 'inconsistent', 'W' + i); assert.strictEqual(v.bepaling, null);
    assert.ok(v.betrokken.includes('wanden.W' + i + '.hoek_naar_volgende'), 'W' + i + ': ' + v.betrokken.join(' '));
  }
});
test('046 P1: de marge van de hoekensom in de N-hoek-route telt de onzekerheid van gemeten hoeken mee', () => {
  let op = zesWanden({ bron: 'gemeten' });
  op = goed(K.zetHoek(op, 'R1', 'W1', 91.3, 'gemeten', T0)); assert.strictEqual(K.vorm(R(op)).hoeksom.tolerantie, 1);
  assert.strictEqual(K.vorm(R(op)).status, 'inconsistent', 'de rondgang sluit niet met 91,3 graden');
  op = goed(K.zetHoek(op, 'R1', 'W1', 91.3, 'gemeten', T0, { onzekerheid_graden: 0.5 })); assert.strictEqual(K.vorm(R(op)).hoeksom.tolerantie, 1.5);
});
// P2: een driehoeksmeting wordt niet weggerond naar 90.
test('046 P2: a = b = 1000 en c voor 89,6 graden: het hoekrecord is 89,6 (niet 90); methode, a, b, c, ruwe hoek en onzekerheid staan erbij; ongeveer haaks is alleen een classificatie', () => {
  const c = Math.sqrt(2 * 1000 * 1000 - 2 * 1000 * 1000 * Math.cos(89.6 * Math.PI / 180));
  assert.strictEqual(K.hoekUitDriehoek(1000, 1000, c), 89.6);
  const res = K.zetHoekDriehoek(zesWanden(), 'R1', 'W1', 1000, 1000, c, T0); assert.strictEqual(res.fout, null);
  const rec = R(res.opname).wanden[0].hoek_naar_volgende;
  assert.strictEqual(rec.graden, 89.6); assert.strictEqual(rec.bron, 'gemeten'); assert.strictEqual(rec.methode, 'driehoek');
  assert.deepStrictEqual([rec.driehoek.a, rec.driehoek.b, rec.driehoek.c], [1000, 1000, c]); assert.strictEqual(rec.driehoek.ruw_graden, 89.6); assert.strictEqual(rec.driehoek.gemeten_graden, 89.6);
  assert.ok(rec.onzekerheid_graden > 0 && rec.onzekerheid_graden === rec.driehoek.onzekerheid_graden, 'onzekerheid');
  assert.strictEqual(res.haaks, true, 'classificatie: ongeveer haaks (binnen 0,5 graad)'); assert.strictEqual(res.gemeten_graden, 89.6);
  const hk = K.hoekVan(R(res.opname), 'W1'); assert.deepStrictEqual([hk.graden, hk.haaks, hk.methode, hk.onzekerheid], [89.6, true, 'driehoek', rec.onzekerheid_graden]);
  // de geometrie gebruikt 89,6: 0,4 graden over 6000 mm geeft ongeveer 42 mm, ver boven de sluitmarge van 10 mm. Dat wordt dus een conflict, geen stil rechtgezette hoek.
  assert.ok(Math.abs(K.vorm(R(zesWandenMetHoek(89.6))).sluitfout.mm - 42) < 6, 'ongeveer 42 mm sluitfout bij 0,4 graden over 6000 mm: ' + K.vorm(R(zesWandenMetHoek(89.6))).sluitfout.mm);
  // inspringend: 360 min de gemeten hoek, ook niet afgerond naar 270
  const cb = Math.sqrt(2 * 1000 * 1000 - 2 * 1000 * 1000 * Math.cos(90.4 * Math.PI / 180)), ins = K.zetHoekDriehoek(zesWanden(), 'R1', 'W3', 1000, 1000, cb, T0);
  assert.strictEqual(R(ins.opname).wanden[2].hoek_naar_volgende.graden, 269.6); assert.strictEqual(ins.haaks, true);
});
function zesWandenMetHoek(g) { return goed(K.zetHoek(zesWanden(), 'R1', 'W1', g, 'gemeten', T0)); }
test('046 P2: een winkelhaak bewaart de methode; zonder opgegeven onzekerheid blijft die leeg (geen schijnnauwkeurigheid)', () => {
  const op = goed(K.zetHoek(zesWanden(), 'R1', 'W1', 90, 'gemeten', T0, { methode: 'winkelhaak' })), hk = K.hoekVan(R(op), 'W1');
  assert.deepStrictEqual([hk.graden, hk.bron, hk.methode, hk.onzekerheid], [90, 'gemeten', 'winkelhaak', null]);
  assert.strictEqual(K.hoekVan(R(goed(K.zetHoek(zesWanden(), 'R1', 'W1', 90, 'aanname', T0))), 'W1').methode, null);
});
test('046 teksten: "Vorm gecontroleerd met controlemaat C" noemt de controlemaat en houdt lokale haaksheid, obstakels en montage-/hoogtematen apart open; toleranties zijn rekenregels', () => {
  const vier = K.vormLabel(K.vorm(R(vierWanden({ diagonalen: [['A', 5000], ['B', 5000]] }))));
  assert.strictEqual(vier.kort, 'Vorm gecontroleerd met controlemaat B'); assert.strictEqual(vier.pil, 'ok'); assert.ok(/lokale haaksheid, obstakels en de montage- en hoogtematen/.test(vier.open), vier.open);
  const zes = K.vormLabel(K.vorm(R(metDiagonaal(zesWanden({ bron: 'gemeten' }), 'H1', 'H3', D['H1-H3']))));
  assert.strictEqual(zes.kort, 'Vorm gecontroleerd met controlemaat C'); assert.strictEqual(zes.open, vier.open);
  const aangenomen = K.vorm(R(metDiagonaal(metDiagonaal(metDiagonaal(zesWanden(), 'H1', 'H3', D['H1-H3']), 'H1', 'H4', D['H1-H4']), 'H4', 'H6', D['H4-H6'])));
  if (aangenomen.bepaling === 'bepaald') assert.ok(/controlemaat/.test(K.vormLabel(aangenomen).kort));
  assert.ok(/geen meetnauwkeurigheid of productietolerantie/.test(K.CRITERIA_TEKST) && /1°/.test(K.CRITERIA_TEKST) && /1 mm/.test(K.CRITERIA_TEKST) && /10 mm/.test(K.CRITERIA_TEKST), K.CRITERIA_TEKST);
});
test('046 restfouten: sluitfout, hoekensom, diagonaalverschil en hoekconflict worden getoond, zodat groen niet perfect suggereert', () => {
  const zes = K.restfouten(K.vorm(R(metDiagonaal(zesWanden({ bron: 'gemeten' }), 'H1', 'H3', D['H1-H3']))));
  assert.ok(zes.some(x => /^Sluitfout van de rondgang: 0 mm \(criterium 10 mm\)/.test(x)) && zes.some(x => /^Hoekensom: 0° ten opzichte van 720°/.test(x)) && zes.some(x => /^Diagonaal C: .* \(\+?0 mm, criterium 10 mm\)/.test(x)), zes.join(' | '));
  const conflict = K.restfouten(K.vorm(R(hoek(vierWanden({ diagonalen: [['A', 5000], ['B', 5000]] }), 'W1', 100, 'gemeten'))));
  assert.ok(conflict.some(x => /^hoek 2: 100° gemeten, 90° berekend/.test(x)), conflict.join(' | '));
  assert.deepStrictEqual(K.restfouten(null), []);
});
console.log('\n' + n + ' tests geslaagd');
