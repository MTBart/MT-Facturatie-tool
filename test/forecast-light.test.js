// Rekenregels van de Forecast light (mt-forecast-light.js), zonder DOM. Draaien: node test/forecast-light.test.js — verzonnen ids en namen.
'use strict';
const assert = require('assert');
const F = require('../mt-forecast.js'); require('../mt-forecast-light.js');
const L = globalThis.MTForecastLight;
let n = 0; const test = (naam, fn) => { try { fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };

test('invoer: Nederlandse notatie, minteken, leeg, percentage', () => {
  assert.deepStrictEqual(L.leesInvoer('5.000'), { c: 500000 });
  assert.deepStrictEqual(L.leesInvoer('2500,5'), { c: 250050 });
  assert.deepStrictEqual(L.leesInvoer('€ 1.234,56'), { c: 123456 });
  assert.deepStrictEqual(L.leesInvoer('1500.50'), { c: 150050 });
  assert.deepStrictEqual(L.leesInvoer('-250'), { c: -25000 });
  assert.deepStrictEqual(L.leesInvoer('−250'), { c: -25000 });
  assert.deepStrictEqual(L.leesInvoer(''), { c: null });
  assert.deepStrictEqual(L.leesInvoer('  '), { c: null });
  assert.deepStrictEqual(L.leesInvoer('50%', 2646453), { c: 1323227 });
  assert.deepStrictEqual(L.leesInvoer('33,3%', 100000), { c: 33300 });
  assert.ok(L.leesInvoer('50%', null).fout); assert.ok(L.leesInvoer('abc').fout); assert.ok(L.leesInvoer('1,234,5').fout); assert.ok(L.leesInvoer('0%', 100).fout);
});
test('weergave en invoer zijn elkaars omgekeerde', () => {
  for (const c of [0, 1, 99, 100, 150050, 530359, 123456789, -1000, -150050]) assert.strictEqual(L.leesInvoer(L.fmt(c)).c, c, String(c));
});
test('rijen: offertes uit Moneybird plus losse schets-records met bedragen; uit beeld gemarkeerd', () => {
  const sch = [F.schatNorm({ id: 300000000001, estimate_id: '2026-1', contact: { company_name: 'A' }, reference: 'Kast', total_price_incl_tax: '121', total_price_excl_tax: '100', state: 'accepted', estimate_date: '2026-10-01' }),
    F.schatNorm({ id: 300000000002, estimate_id: '2026-2', contact: { company_name: 'B' }, total_price_incl_tax: '50', state: 'open', estimate_date: '2026-10-02' })];
  const rijen = L.rijen(sch, { '300000000002': { cellen: { '2026-11': 100 }, zeker: true }, '300000000009': { cellen: { '2026-10': 5 }, naam: 'Weg — oud' }, '300000000010': { cellen: {} } }, { '300000000002': { reden: 'verkeerd' } });
  assert.deepStrictEqual(rijen.map(r => r.id), ['300000000001', '300000000002', '300000000009'], 'een leeg los record verschijnt niet');
  assert.strictEqual(rijen[0].naam, 'A — Kast'); assert.strictEqual(rijen[0].zeker, true, 'geaccepteerd: standaard aan'); assert.strictEqual(rijen[0].exclC, 10000);
  assert.strictEqual(rijen[1].zeker, true); assert.strictEqual(rijen[1].uitbeeld, true);
  assert.strictEqual(rijen[2].status, 'los'); assert.strictEqual(rijen[2].naam, 'Weg — oud');
  assert.deepStrictEqual(L.filter(rijen, ['geaccepteerd', 'los']).map(r => r.id), ['300000000001', '300000000009']);
  assert.deepStrictEqual(L.tel(rijen), { geaccepteerd: 1, openstaand: 0, concept: 0, los: 1, uitbeeld: 1 });
});
test('totalen: per maand, zeker, geheel en buiten beeld', () => {
  const ms = ['2026-10', '2026-11'];
  const rijen = [{ cellen: { '2026-10': 100, '2026-11': 200, '2027-05': 7 }, zeker: true }, { cellen: { '2026-11': -50, '2026-09': 3 }, zeker: false }];
  const t = L.totalen(rijen, ms);
  assert.deepStrictEqual(t.per, [100, 150]); assert.deepStrictEqual(t.zeker, [100, 200]); assert.strictEqual(t.som, 250); assert.strictEqual(t.somZeker, 300); assert.strictEqual(t.buiten, 10);
  assert.strictEqual(L.rijTotaal(rijen[0], ms), 300);
});
test('sorteren: op gaat zeker door, bedrag (leeg achteraan), maand en standaard datum', () => {
  const r = (id, o) => Object.assign({ id, naam: id, datum: '2026-10-0' + id.slice(-1), status: 'geaccepteerd', inclC: 100, exclC: 80, cellen: {}, zeker: false }, o);
  const rijen = [r('x1', { zeker: true }), r('x2', { inclC: null, exclC: null }), r('x3', { inclC: 500, exclC: 400, cellen: { '2026-11': 9 } })];
  assert.deepStrictEqual(L.sorteer(rijen, { sleutel: 'zeker', richting: 'af' }, 'incl', []).map(x => x.id)[0], 'x1');
  assert.deepStrictEqual(L.sorteer(rijen, { sleutel: 'bedrag', richting: 'af' }, 'incl', []).map(x => x.id), ['x3', 'x1', 'x2']);
  assert.deepStrictEqual(L.sorteer(rijen, { sleutel: 'bedrag', richting: 'op' }, 'incl', []).map(x => x.id), ['x1', 'x3', 'x2']);
  assert.deepStrictEqual(L.sorteer(rijen, { sleutel: 'bedrag', richting: 'op' }, 'excl', []).map(x => x.id), ['x1', 'x3', 'x2']);
  assert.deepStrictEqual(L.sorteer(rijen, { sleutel: 'm:2026-11', richting: 'af' }, 'incl', ['2026-11']).map(x => x.id)[0], 'x3');
  assert.deepStrictEqual(L.sorteer(rijen, null, 'incl', []).map(x => x.id), ['x3', 'x2', 'x1']);
  assert.deepStrictEqual(L.sortLees('m:2026-11:op'), { sleutel: 'm:2026-11', richting: 'op' }); assert.deepStrictEqual(L.sortLees('rommel'), L.SORT_STANDAARD);
});
console.log(`\n${n} tests geslaagd${process.exitCode ? ' (met fouten)' : ''}`);
