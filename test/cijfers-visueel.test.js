// Visuele cijfers: periodetabel, stapel-rekening, oordelen, omzetzin, kostenvergelijking (mt-cijfers.js), zonder DOM. Draaien: node test/cijfers-visueel.test.js â€” nep-gegevens.
'use strict';
const assert = require('assert');
const Nep = require('./fixtures/cijfers-nep.js');
require('../mt-cijfers.js');
const C = globalThis.MTCijfers, st = C._st;
let n = 0; const test = (naam, fn) => { try { fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };

function zet(opt) {
  const a = Nep.antwoord('2026-11');
  Object.assign(st, { maanden: a.perioden, cats: a.categorieen.map(c => c.id), catNaam: Object.fromEntries(a.categorieen.map(c => [c.id, c.naam])), bm: a.benchmarks, ontbrekend: [], mislukt: [],
    vandaag: '2026-11-05', jaar: 2026, zoom: 'M', eerlijk: true, vgl: { j1: true, j2: true, b: true }, sel: null, stapelSel: null, focusCat: null, prognoseRuw: Nep.prognose().items, kasProg: null }, opt || {});
}
const tabel = (zoom, extra) => C.periodeTabelModel(Object.assign({ maanden: st.maanden, cats: st.cats, eerlijk: true, zoom, jaar: 2026, jaren: [2026, 2025, 2024], lm: '2026-10', rest: { '2026-11': 15000, '2026-12': 20000 }, meet: P => P.omzet }, extra || {}));
const OM = { 2026: [38, 41, 52, 47, 55, 61, 44, 36, 58, 63], 2025: [34, 37, 45, 44, 49, 52, 40, 31, 50, 55, 53, 47] };

// â”€â”€ periodetabel â”€â”€
test('periodetabel: Maand geeft 12 kolommen jan..dec, Kwartaal 4 kolommen K1..K4', () => {
  zet(); const m = tabel('M'), k = tabel('K');
  assert.deepStrictEqual(m.kolommen.map(x => x.label), ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']);
  assert.deepStrictEqual(k.kolommen.map(x => x.label), ['K1', 'K2', 'K3', 'K4']);
  assert.strictEqual(m.rijen.length, 3); assert.ok(m.rijen.every(r => r.cellen.length === 12)); assert.ok(k.rijen.every(r => r.cellen.length === 4));
});
test('periodetabel: de tabel volgt de knop (zoom K telt de maanden van het kwartaal op)', () => {
  zet(); const k = tabel('K'), r = k.rijen[0];
  assert.strictEqual(r.cellen[0].v, (38 + 41 + 52) * 1000); assert.strictEqual(r.cellen[1].v, (47 + 55 + 61) * 1000);
  assert.strictEqual(k.rijen[1].cellen[3].v, (55 + 53 + 47) * 1000);
});
test('periodetabel: afgesloten maanden tellen, de lopende maand niet; verwacht staat apart', () => {
  zet(); const r = tabel('M').rijen[0];
  assert.strictEqual(r.cellen[9].v, 63000); assert.strictEqual(r.cellen[10].v, null, 'november is lopend: niet geboekt meetellen');
  assert.strictEqual(r.cellen[10].fc, 15000); assert.strictEqual(r.cellen[11].fc, 20000); assert.strictEqual(r.cellen[0].fc, 0);
  assert.strictEqual(r.cellen[10].reden, 'nog niet afgesloten');
});
test('periodetabel: "â€”" met reden bij ontbrekende data, nooit 0', () => {
  zet(); st.maanden = st.maanden.filter(m => m.id !== '2025-03'); const t = tabel('M'), c = t.rijen[1].cellen[2];
  assert.strictEqual(c.v, null); assert.strictEqual(c.reden, 'niet opgehaald'); assert.ok(t.rijen[0].cellen[2].v > 0);
  assert.strictEqual(t.verschil.cellen[2].d, null); assert.ok(/geen gegevens 2025/.test(t.verschil.cellen[2].reden));
});
test('periodetabel: verschil alleen op afgesloten periodes (kwartaal)', () => {
  zet(); const t = tabel('K'), v = t.verschil;
  assert.ok(v.cellen[0].d != null && Math.abs(v.cellen[0].d - ((131 - 116) / 116 * 100)) < 1e-9, 'K1: ' + v.cellen[0].d);
  assert.strictEqual(v.cellen[3].d, null, 'K4 is nog niet afgesloten'); assert.ok(/alleen afgesloten|nog niet/.test(v.cellen[3].reden));
  const q3 = t.rijen[0].cellen[2]; assert.strictEqual(q3.vol, true); assert.strictEqual(t.rijen[0].cellen[3].v, 63000); assert.strictEqual(t.rijen[0].cellen[3].vol, false, 'K4 is deels geboekt');
});
test('periodetabel: totaal t/m laatste afgesloten maand en eerlijk vergeleken met vorig jaar', () => {
  zet(); const t = tabel('M'), som = a => a.reduce((x, y) => x + y, 0);
  assert.strictEqual(t.totaalLabel, 't/m okt'); assert.strictEqual(t.rijen[0].totaal.v, som(OM[2026]) * 1000);
  assert.strictEqual(t.rijen[1].totaal.v, som(OM[2025].slice(0, 10)) * 1000, 'vorig jaar t/m dezelfde maand');
  assert.ok(Math.abs(t.verschil.totaal.d - (som(OM[2026]) - som(OM[2025].slice(0, 10))) / som(OM[2025].slice(0, 10)) * 100) < 1e-9);
});
test('periodetabel: ontbrekende maand in vergelijkjaar geeft geen totaal-vergelijking', () => {
  zet(); st.maanden = st.maanden.filter(m => m.id !== '2025-07'); const t = tabel('M');
  assert.strictEqual(t.rijen[1].totaal.v, null); assert.strictEqual(t.verschil.totaal.d, null); assert.ok(t.verschil.totaal.reden);
});
test('periodetabel: zonder afgesloten maand geen cijfers en geen verschil', () => {
  zet(); const t = tabel('M', { lm: null, rest: {} });
  assert.ok(t.rijen.every(r => r.cellen.every(c => c.v == null))); assert.strictEqual(t.verschil.cellen[0].d, null); assert.strictEqual(t.totaalLabel, 'Jaar');
});
test('periodetabel jaren-vorm: kolommen zijn jaren, verschil met het jaar ervoor alleen bij afgesloten jaren', () => {
  zet(); st.zoom = '5J'; const per = C.periodes(st.maanden, '5J', 2026, '2026-10', []).map(p => Object.assign(p, { P: C.som(p.ms, st.cats, true) }));
  const t = C.periodeTabelJaren(per, { zoom: '5J', lm: '2026-10', meet: P => P.omzet });
  assert.deepStrictEqual(t.kolommen.map(k => k.label), ['2022', '2023', '2024', '2025', '2026']);
  assert.strictEqual(t.verschil.cellen[0].d, null); assert.ok(t.verschil.cellen[2].d > 0); assert.strictEqual(t.verschil.cellen[4].d, null, '2026 is nog niet volledig');
  assert.strictEqual(t.rijen[0].cellen[4].vol, false);
  const tj = C.periodeTabelJaren(C.periodes(st.maanden, 'J', 2026, '2026-10', []).map(p => Object.assign(p, { P: C.som(p.ms, st.cats, true) })), { zoom: 'J', lm: '2026-10', meet: P => P.omzet });
  assert.ok(tj.verschil.cellen[4].d != null, 'jaar t/m nu: alle jaren t/m dezelfde maand, dus wel vergelijkbaar');
});
test('categoriekleuren: vast per categorie, resultaat apart, onbekende categorie krijgt een eigen plek', () => {
  assert.strictEqual(C.katKlasse('materiaal', []), 'mtd-k0'); assert.strictEqual(C.katKlasse('overig', ['x']), 'mtd-k4'); assert.strictEqual(C.katKlasse('resultaat', []), 'mtd-kres');
  const cats = ['materiaal', 'vervoer', 'overig', 'kantoor']; assert.strictEqual(C.katKlasse('vervoer', cats), 'mtd-k5'); assert.strictEqual(C.katKlasse('kantoor', cats), 'mtd-k6');
  assert.strictEqual(C.katKlasse('materiaal', cats), C.katKlasse('materiaal', ['a']));
});

console.log(`${n} tests gedaan`);
