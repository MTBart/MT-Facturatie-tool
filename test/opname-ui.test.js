// Tests van de pure delen van de opname-schermen (mt-opname.js en mt-opname-model.js), zonder echte DOM: het laden van de bestanden en het lezen van een ingetikte maat.
// De schermen zelf zijn in headless Chrome op 390 px bekeken (screenshots in OPNAME-APP\BOUW\brok2-screens). Draaien: node test/opname-ui.test.js
'use strict';
const assert = require('assert');
global.document = {};                                             // alleen om de bestanden te laden; er wordt hier niets getekend
global.MTOpnameKern = require('../mt-opname-kern.js');
global.MTOpnameGeo = require('../mt-opname-geo.js');
global.MTOpnameOpslag = require('../mt-opname-opslag.js');
const M = require('../mt-opname.js');
require('../mt-opname-model.js');
const X = M.X;
let n = 0; const test = (naam, fn) => { try { fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };

test('alle schermen en het gedeelde hulpmiddel bestaan na het laden', () => {
  for (const s of ['lijst', 'start', 'fotos', 'model', 'wand', 'rondje', 'afronden']) assert.strictEqual(typeof X.schermen[s], 'function', s);
  assert.strictEqual(typeof M.start, 'function'); assert.strictEqual(typeof M.terug, 'function'); assert.strictEqual(M.terug(), false, 'zonder gestarte module is er niets om naar terug te gaan');
});
test('maat lezen: hele millimeters, komma en duizendtalpunt', () => {
  assert.strictEqual(X.leesMm('5760').v, 5760);
  assert.strictEqual(X.leesMm(' 5760 mm ').v, 5760);
  assert.strictEqual(X.leesMm('1234,5').v, 1234.5);
  assert.strictEqual(X.leesMm('5.760').v, 5760, 'een punt als duizendtal');
  assert.strictEqual(X.leesMm('2.447,5').v, 2447.5);
  assert.strictEqual(X.leesMm('80').v, 80);
});
test('maat lezen: leeg, geen getal, meters en onmogelijk grote maten worden geweigerd met een uitleg', () => {
  for (const t of ['', '   ', 'abc', '12x', '-5']) assert.ok(X.leesMm(t).fout, JSON.stringify(t));
  assert.ok(/millimeters/.test(X.leesMm('5,76').fout), 'een maat in meters wordt niet stilletjes gelezen als 6 mm');
  assert.ok(X.leesMm('2').fout); assert.ok(X.leesMm('100000').fout);
  assert.strictEqual(X.leesMm('100000').v, undefined);
});
test('millimeters tonen met een komma', () => { assert.strictEqual(X.mm(2447), '2447'); assert.strictEqual(X.mm(1234.5), '1234,5'); assert.strictEqual(X.mm(null), ''); });
test('wandnamen voor de schermen', () => { assert.strictEqual(X.wandNaam('O'), 'Oostwand'); assert.strictEqual(X.wandNaam('Z'), 'Zuidwand'); });
console.log('\n' + n + ' tests geslaagd');
