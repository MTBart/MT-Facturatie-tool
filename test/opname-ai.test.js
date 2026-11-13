// Tests van de pure delen van de herkenning uit de foto's (mt-opname-ai.js), de DISTO-herkenning en de reeks foto's, zonder echte DOM en zonder AI: het verzoek, het lezen van het
// antwoord (SSE), het veilig maken van het voorstel, de omrekening van de foto naar het wandvlak en de plattegrond met een geschatte wandlengte. Draaien: node test/opname-ai.test.js
'use strict';
const assert = require('assert');
global.document = {};
const K = global.MTOpnameKern = require('../mt-opname-kern.js');
global.MTOpnameGeo = require('../mt-opname-geo.js');
global.MTOpnameOpslag = require('../mt-opname-opslag.js');
const M = require('../mt-opname.js');
require('../mt-opname-model.js');
const AI = require('../mt-opname-ai.js'), D = require('../mt-opname-disto.js'), X = M.X;
let n = 0; const test = (naam, fn) => { try { fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };
const sse = (tekst, stop) => ['data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"{ nee"}}', 'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: tekst.slice(0, 5) } }), 'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: tekst.slice(5) } }), 'data: ' + JSON.stringify({ type: 'message_delta', delta: { stop_reason: stop || 'end_turn' } })].join('\n');
const hk = (lo, ro, rb, lb, zicht) => ({ linksonder: { x: lo[0], y: lo[1], zichtbaar: zicht !== false }, rechtsonder: { x: ro[0], y: ro[1], zichtbaar: true }, rechtsboven: { x: rb[0], y: rb[1], zichtbaar: true }, linksboven: { x: lb[0], y: lb[1], zichtbaar: true } });
const goed = () => ({ bruikbaar: true, hoeken: hk([0.1, 0.9], [0.9, 0.9], [0.9, 0.1], [0.1, 0.1]), onderdelen: [{ type: 'raam', omschrijving: 'kozijn', x0: 0.5, y0: 0.3, x1: 0.7, y1: 0.6, zekerheid: 'hoog' }, { type: 'stopcontact', omschrijving: '', x0: 0.2, y0: 0.8, x1: 0.22, y1: 0.83, zekerheid: 'middel' }, { type: 'los', omschrijving: 'bank', x0: 0.3, y0: 0.6, x1: 0.6, y1: 0.9, zekerheid: 'hoog' }], wand_lengte_mm: 4237, opmerking: ' ok ' });

test('een reeks foto\'s komt op volgorde van opnametijd, bij gelijke tijd op naam', () => {
  const f = (name, lastModified) => ({ name, lastModified });
  assert.deepStrictEqual(X.fotoVolgorde([f('b.jpg', 30), f('a.jpg', 20), f('IMG_10.jpg', 10), f('IMG_9.jpg', 10)]).map(x => x.name), ['IMG_9.jpg', 'IMG_10.jpg', 'a.jpg', 'b.jpg']);
  assert.deepStrictEqual(X.fotoVolgorde(null), []);
});
test('een DISTO-reeks: snel getikt met Enter; een mens of een half veld is geen DISTO', () => {
  assert.strictEqual(X.isDistoReeks([0, 15, 30, 45], 60, 4), true);
  assert.strictEqual(X.isDistoReeks([0, 90, 180, 270], 360, 4), true, 'een trage Bluetooth-verbinding');
  assert.strictEqual(X.isDistoReeks([0, 220, 440, 660], 880, 4), false, 'met de hand getikt');
  assert.strictEqual(X.isDistoReeks([0, 15, 30, 45], 2000, 4), false, 'Enter kwam pas later');
  assert.strictEqual(X.isDistoReeks([0, 15, 30], 45, 5), false, 'er stond al iets in het veld');
  assert.strictEqual(X.isDistoReeks([0, 15], 30, 2), false, 'te kort om zeker te zijn');
  assert.strictEqual(X.isDistoReeks([], 30, 0), false);
});
test('de bron van een maat is standaard de hand en volgt de keuze voor de DISTO', () => {
  X.S.meetBron = null; assert.strictEqual(X.meetBron(), 'hand');
  X.zetMeetBron('disto'); assert.strictEqual(X.meetBron(), 'disto');
  X.zetMeetBron('iets anders'); assert.strictEqual(X.meetBron(), 'hand');
});
test('het verzoek: model en plafond passen in het contract van de worker, de foto gaat als jpeg mee, zonder tools', () => {
  const v = AI.verzoek('QUJD', 'Dit is de foto van wand 1.', true);
  assert.ok(/^claude-(haiku|sonnet)-[a-z0-9.-]{1,40}$/.test(v.model)); assert.ok(v.max_tokens > 0 && v.max_tokens <= 4096); assert.strictEqual(v.tools, undefined); assert.ok(v.system.length < 20000);
  assert.strictEqual(v.output_config.format.type, 'json_schema'); assert.strictEqual(v.output_config.effort, 'low'); assert.strictEqual(v.thinking, undefined); assert.strictEqual(v.temperature, undefined);
  assert.deepStrictEqual(v.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } });
  const z = AI.verzoek('QUJD', 'tekst', false); assert.strictEqual(z.output_config.format, undefined); assert.ok(/alleen één JSON-object/.test(z.messages[0].content[1].text));
});
test('het schema: elk object is dicht en noemt al zijn velden verplicht, zonder grenzen op getallen', () => {
  const loop = s => { if (!s || typeof s !== 'object') return; if (s.type === 'object') { assert.strictEqual(s.additionalProperties, false); assert.deepStrictEqual(s.required.slice().sort(), Object.keys(s.properties).sort()); Object.values(s.properties).forEach(loop); } if (s.type === 'array') loop(s.items); for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) assert.strictEqual(s[k], undefined, k); };
  loop(AI.SCHEMA);
});
test('het antwoord lezen: een SSE-stream met denkwerk ervoor, gewoon JSON, en fouten', () => {
  assert.deepStrictEqual(AI.leesAntwoord(200, sse(JSON.stringify({ a: 1 }))).data, { a: 1 });
  assert.deepStrictEqual(AI.leesAntwoord(200, JSON.stringify({ content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'Hier: {"b":2} klaar' }], stop_reason: 'end_turn' })).data, { b: 2 });
  assert.ok(/geweigerd|niet beoordelen/.test(AI.leesAntwoord(200, sse('{"a":1}', 'refusal')).fout));
  assert.ok(/afgebroken/.test(AI.leesAntwoord(200, sse('{"a":', 'max_tokens')).fout));
  const lim = AI.leesAntwoord(429, JSON.stringify({ type: 'error', error: { type: 'mt_ai_limiet', message: 'Even rustig aan.' } })); assert.strictEqual(lim.fout, 'Even rustig aan.'); assert.ok(!lim.formaat);
  assert.strictEqual(AI.leesAntwoord(400, JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'output_config.format: unsupported' } })).formaat, true);
  assert.ok(/niet ingelogd/.test(AI.leesAntwoord(401, '').fout)); assert.ok(/500/.test(AI.leesAntwoord(500, 'kapot').fout));
  assert.ok(AI.leesAntwoord(200, 'data: {"type":"error","error":{"message":"overloaded"}}').fout);
});
test('het voorstel veilig maken: vaste en losse onderdelen gescheiden, van links naar rechts, lengte afgerond', () => {
  const r = AI.normaliseer(goed());
  assert.strictEqual(r.bruikbaar, true); assert.deepStrictEqual(r.hoeken, [[0.1, 0.9], [0.9, 0.9], [0.9, 0.1], [0.1, 0.1]]);
  assert.deepStrictEqual(r.onderdelen.map(o => o.type), ['stopcontact', 'raam']); assert.deepStrictEqual(r.los.map(o => o.naam), ['bank']); assert.strictEqual(r.lengte_mm, 4240); assert.strictEqual(r.opmerking, 'ok');
  assert.strictEqual(AI.groep('raam'), 'ruimte'); assert.strictEqual(AI.groep('radiator'), 'constructief'); assert.strictEqual(AI.groep('los'), 'los');
});
test('het voorstel veilig maken: rommel in, niets geks uit', () => {
  assert.strictEqual(AI.normaliseer(null), null); assert.strictEqual(AI.normaliseer([1]), null);
  const d = goed(); d.hoeken = hk([0.1, 0.9], [0.9, 0.9], [0.9, 0.1], [0.1, 0.1], false);
  d.onderdelen = [{ type: 'onzin', omschrijving: 'x'.repeat(200), x0: -0.2, y0: 0.2, x1: 1.2, y1: 0.4, zekerheid: 'heel' }, { type: 'raam', x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5, zekerheid: 'hoog' }, { type: 'deur', x0: 'a' }, null];
  d.wand_lengte_mm = 99; d.opmerking = 5;
  const r = AI.normaliseer(d);
  assert.strictEqual(r.hoeken, null, 'een onzichtbare hoek geeft geen kader'); assert.strictEqual(r.hoeken_gezien, false);
  assert.strictEqual(r.onderdelen.length, 1); assert.deepStrictEqual([r.onderdelen[0].type, r.onderdelen[0].zeker, r.onderdelen[0].x0, r.onderdelen[0].x1, r.onderdelen[0].naam.length], ['overig', 'laag', 0, 1, 60]);
  assert.strictEqual(r.lengte_mm, null); assert.strictEqual(r.opmerking, '5');
  const kruis = goed(); kruis.hoeken = hk([0.9, 0.9], [0.1, 0.9], [0.9, 0.1], [0.1, 0.1]); assert.strictEqual(AI.normaliseer(kruis).hoeken, null, 'links en rechts verwisseld');
  const veel = goed(); veel.onderdelen = Array.from({ length: 80 }, (x, i) => ({ type: 'stopcontact', omschrijving: '', x0: i / 100, y0: 0.5, x1: i / 100 + 0.02, y1: 0.55, zekerheid: 'hoog' })); assert.strictEqual(AI.normaliseer(veel).onderdelen.length, 40);
});
test('pixels in plaats van fracties worden omgerekend met de afmetingen van de verstuurde foto', () => {
  const d = goed(); d.hoeken = hk([100, 900], [900, 900], [900, 100], [100, 100]); d.onderdelen = [{ type: 'raam', omschrijving: '', x0: 500, y0: 300, x1: 700, y1: 600, zekerheid: 'hoog' }];
  const r = AI.normaliseer(d, { w: 1000, h: 1000 }); assert.deepStrictEqual(r.hoeken[0], [0.1, 0.9]); assert.deepStrictEqual([r.onderdelen[0].x0, r.onderdelen[0].y1], [0.5, 0.6]);
  assert.strictEqual(AI.normaliseer(d).onderdelen.length, 0, 'zonder afmetingen is het niet te lezen');
});
test('van de foto naar het wandvlak: met de vier hoeken via de homografie, zonder hoeken geldt de foto als wand', () => {
  const lay = { hoeken: [[0.1, 0.9], [0.9, 0.9], [0.9, 0.1], [0.1, 0.1]] };
  assert.deepStrictEqual(AI.naarWand(lay, { x0: 0.5, y0: 0.3, x1: 0.7, y1: 0.5 }), { u0: 0.5, u1: 0.75, v0: 0.5, v1: 0.75 });
  assert.deepStrictEqual(AI.naarWand({}, { x0: 0.5, y0: 0.3, x1: 0.7, y1: 0.5 }), { u0: 0.5, u1: 0.7, v0: 0.5, v1: 0.7 });
  assert.deepStrictEqual(AI.naarWand({ hoeken: lay.hoeken, onbekend: true }, { x0: 0, y0: 0, x1: 0.001, y1: 1 }), { u0: 0, u1: 0.01, v0: 0, v1: 1 }, 'een onbekende hoek: geen homografie, en nooit een vorm zonder breedte');
  const buiten = AI.naarWand(lay, { x0: 0, y0: 0, x1: 1, y1: 1 }); assert.deepStrictEqual(buiten, { u0: 0, u1: 1, v0: 0, v1: 1 }, 'binnen de wand begrensd');
});
test('de plattegrond gebruikt een geschatte wandlengte uit de foto alleen als schatting, nooit als maat', () => {
  let op = K.nieuweOpname({ opname_id: 'T', project: { code: 'TEST-001', naam: 'Test' }, ruimtes: [K.nieuweRuimte({ id: 'R1', naam: 'Kamer', meubeltype: 'kast', wanden: [] })] });
  for (let i = 0; i < 4; i++) op = K.voegWandToe(op, 'R1').opname;
  op = K.maakRond(op, 'R1').opname;
  const zonder = K.plattegrond(op.ruimtes[0]); assert.deepStrictEqual(Object.values(zonder.wanden).map(w => Math.round(w.lengte)), [4000, 3000, 4000, 3000]);
  op = K.zetVoorstel(op, 'R1', 'wanden.W1.maten.lengte', { schatting_mm: 5200 }).opname; op = K.zetVoorstel(op, 'R1', 'wanden.W2.maten.lengte', { schatting_mm: 2500 }).opname;
  const met = K.plattegrond(op.ruimtes[0]); assert.deepStrictEqual(Object.values(met.wanden).map(w => Math.round(w.lengte)), [5200, 2500, 5200, 2500], 'de overstaande wand volgt het voorstel');
  assert.ok(Object.values(met.wanden).every(w => w.geschat && !w.gemeten)); assert.strictEqual(met.schatting, true);
  assert.strictEqual(K.vragen(op.ruimtes[0]).find(v => v.pad === 'wanden.W1.maten.lengte').staat, 'open', 'het voorstel is geen meting');
  op = K.zetMaat(op, 'R1', 'wanden.W3.maten.lengte', { staat: 'gemeten', waarde: 5000, bron: 'disto' }).opname;
  assert.strictEqual(Math.round(K.plattegrond(op.ruimtes[0]).wanden.W1.lengte), 5000, 'een gemeten overstaande wand gaat voor het voorstel');
});
test('DISTO-proef: de bytes van een melding worden leesbaar (afstand in mm, helling in graden)', () => {
  const f = v => new Uint8Array(new Float32Array([v]).buffer);
  assert.ok(/afstand \(m\): 2\.345 = 2345 mm/.test(D.lees(f(2.345), '01').tekst)); assert.ok(/= 90 graden/.test(D.lees(f(Math.PI / 2), '03').tekst));
  assert.strictEqual(D.kort('3ab1010a-f831-4395-b29d-570977d5bf94'), '0a'); assert.ok(/kenmerk ff: \(geen getal\)/.test(D.lees([1, 2], 'ff').tekst));
});
console.log('\n' + n + ' tests geslaagd');
