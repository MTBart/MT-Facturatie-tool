// Rekenregels en tekenmodel van het cijfers-dashboard (mt-cijfers.js), zonder DOM. Draaien: node test/cijfers.test.js — nep-gegevens.
'use strict';
const assert = require('assert');
const Nep = require('./fixtures/cijfers-nep.js');
require('../mt-cijfers.js');
const C = globalThis.MTCijfers, st = C._st;
let n = 0; const test = (naam, fn) => { try { fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };

function zet(opt) {
  const a = Nep.antwoord('2026-11');
  Object.assign(st, { maanden: a.perioden, cats: a.categorieen.map(c => c.id), catNaam: Object.fromEntries(a.categorieen.map(c => [c.id, c.naam])), bm: a.benchmarks, ontbrekend: [], mislukt: [],
    vandaag: '2026-11-05', jaar: 2026, zoom: 'M', eerlijk: true, vgl: { j1: true, j2: true, b: true }, sel: null, focusCat: null, prognoseRuw: Nep.prognose().items, kasProg: null }, opt || {});
}

test('schaal: alle waarden (ook negatief en groot) liggen binnen de as', () => {
  const sc = C.schaalVoor([[10, 250, null], [-40, 90], [NaN, undefined, 120000]], {});
  for (const v of [10, 250, -40, 90, 120000, 0]) assert.ok(v >= sc.a && v <= sc.b, `${v} buiten ${sc.a}..${sc.b}`);
  assert.ok(sc.ticks.length >= 2);
});
test('schaal: zonder waarden een bruikbare lege as; min/max forceren', () => {
  const leeg = C.schaalVoor([[null]], {}); assert.ok(leeg.b > leeg.a);
  const m = C.schaalVoor([[5, 6]], { min: 0, max: 100 }); assert.ok(m.a <= 0 && m.b >= 100);
  const geenNul = C.schaalVoor([[500, 600]], { nul: false }); assert.ok(geenNul.a > 0);
});
test('verzamel: negeert niet-getallen', () => { assert.deepStrictEqual(C.verzamel([[1, null, 'x', NaN, Infinity], 3, [undefined]]), [1, 3]); });

// Alle y-waarden van lijnen/paden/punten moeten binnen het tekengebied liggen (dit was de schaalfout: de vergelijkjaren en de referentielijn telden niet mee).
function yWaarden(svg) {
  const ys = [];
  for (const m of svg.matchAll(/<path d="([^"]+)"/g)) for (const q of m[1].matchAll(/[ML]([\d.\-]+) ([\d.\-]+)/g)) ys.push(Number(q[2]));
  for (const m of svg.matchAll(/<circle[^>]* cy="([\d.\-]+)"/g)) ys.push(Number(m[1]));
  for (const m of svg.matchAll(/<line [^>]*x1="([\d.\-]+)" x2="([\d.\-]+)" y1="([\d.\-]+)" y2="([\d.\-]+)"/g)) if (m[1] !== m[2] && m[3] === m[4]) ys.push(Number(m[3]));
  return ys;
}
const BOVEN = 24, ONDER = 260 - 30;   // MT en HO-MB uit mt-cijfers.js (HO = 260 bij brede grafiek)
for (const zoom of ['M', 'K']) for (const eerlijk of [true, false]) for (const g of ['omzet_kosten', 'brutomarge', 'kas']) {
  test(`schaal-bug: ${g} zoom ${zoom} eerlijk ${eerlijk}: niets buiten de grafiek`, () => {
    zet({ zoom, eerlijk }); const html = C._grafiekHtml(g), ys = yWaarden(html);
    assert.ok(ys.length > 5, 'er moet iets getekend zijn');
    for (const y of ys) assert.ok(y >= BOVEN - 0.6 && y <= ONDER + 0.6, `y=${y} buiten ${BOVEN}..${ONDER} in ${g}`);
  });
}
test('schaal-bug: vergelijkjaar met veel hogere waarden dwingt de as mee (omzet)', () => {
  zet({ zoom: 'M', vergelijk: 2 }); const hoog = st.maanden.find(m => m.id === '2025-06'); const oud = hoog.omzet; hoog.omzet = 900000;
  try { const ys = yWaarden(C._grafiekHtml('omzet_kosten')); for (const y of ys) assert.ok(y >= BOVEN - 0.6 && y <= ONDER + 0.6, `y=${y}`); }
  finally { hoog.omzet = oud; }
});

test('som: boekjaar t/m oktober, prognose telt niet mee', () => {
  zet(); const ms = st.maanden.filter(m => m.id >= '2026-01' && m.id <= '2026-10'), P = C.som(ms, st.cats, true);
  assert.strictEqual(P.omzet, [38, 41, 52, 47, 55, 61, 44, 36, 58, 63].reduce((a, b) => a + b, 0) * 1000);
  assert.strictEqual(P.prognose, 0);
});
test('tegels: omzet t/m oktober, vergelijking en forecast apart gehouden', () => {
  zet(); const tg = C._tegels(), o = tg.find(x => x.id === 'omzet');
  assert.strictEqual(tg.length, 6); assert.strictEqual(o.waarde, '€ 495k'); assert.strictEqual(o.chip.pijl, '▲'); assert.ok(/13,3%/.test(o.chip.tekst));
  const k = tg.find(x => x.id === 'komende'); assert.strictEqual(k.tot, 140000); assert.ok(k.forecast);
  assert.strictEqual(tg.find(x => x.id === 'debiteuren').waarde, '—');   // geen bron: geen verzonnen getal
  assert.strictEqual(tg.A.prognose, 0);
});
test('tegels: ontbrekende vorig-jaar-maand geeft geen vergelijking', () => {
  zet(); st.maanden = st.maanden.filter(m => m.id !== '2025-03'); const o = C._tegels().find(x => x.id === 'omzet');
  assert.strictEqual(o.chip, null); assert.ok(!o.rijen.some(r => r.soort === 'j1'));
});
test('sparkline: alle punten binnen 4..36 op één gedeelde schaal', () => {
  zet(); for (const t of C._tegels()) { if (!t.spark) continue; for (const d of Object.values(t.spark)) for (const m of d.matchAll(/[ML]([\d.]+) ([\d.-]+)/g)) assert.ok(Number(m[2]) >= 3.9 && Number(m[2]) <= 36.1, t.id + ' ' + m[2]); }
});
test('feitzinnen: omzet, bron erbij, uit de gegevens', () => {
  zet(); const f = C.feiten('omzet'); assert.ok(f.length >= 4); assert.ok(f.every(x => x.t && x.bron));
  assert.ok(/495k/.test(f[0].t) && /58k/.test(f[0].t) && /13,3%/.test(f[0].t));
  assert.ok(f.some(x => /augustus/.test(x.t)));
  assert.ok(f.some(x => /forecast/.test(x.bron)));
});
test('feitzinnen: geen forecast-zin zonder forecast', () => { zet({ prognoseRuw: {} }); assert.ok(!C.feiten('omzet').some(x => /forecast/.test(x.bron))); });
test('status: aandachtspunten en toelichting', () => {
  zet({ mislukt: ['2025-05'], ontbrekend: ['2025-05'], waarsch: ['Nep-waarschuwing'] }); const s = C.statusItems();
  assert.ok(s.aandacht.some(x => /2025/.test(x) && /niet worden opgehaald/.test(x))); assert.ok(s.aandacht.includes('Nep-waarschuwing')); assert.ok(s.uitleg.some(x => /Forecast/.test(x)) && s.uitleg.some(x => /Eerlijk beeld/.test(x)));
  zet({ mislukt: [], ontbrekend: [], waarsch: [] }); assert.strictEqual(C.statusItems().aandacht.length, 0);
});
test('vergelijk-schakelaars: onthouden en terugzetten', () => { assert.deepStrictEqual(C.vglLees(C.vglTekst({ j1: true, j2: false, b: true })), { j1: true, j2: false, b: true }); assert.deepStrictEqual(C.vglLees('xx'), { j1: true, j2: true, b: true }); });
console.log(`${n} tests gedaan`);
