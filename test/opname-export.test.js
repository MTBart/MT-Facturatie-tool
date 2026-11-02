// Tests van de volledige export en het terugzetten (brok 3b, ChatGPT-review 043: geen enig archief op één toestel). Draaien: node test/opname-export.test.js — verzonnen opname, eigen testbytes.
'use strict';
const assert = require('assert');
const zlib = require('zlib');
const K = require('../mt-opname-kern.js');
const E = require('../mt-opname-export.js');
let n = 0; const test = (naam, fn) => fn().then(() => { n++; console.log('ok  - ' + naam); }, e => { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; });
const T0 = '2026-11-01T09:00:00.000Z';
const goed = res => { assert.strictEqual(res.fout, null, res.fout); return res.opname; };
const bytes = (zaad, lengte) => { const b = new Uint8Array(lengte); let x = zaad; for (let i = 0; i < lengte; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; b[i] = x >> 16; } return b; };

function opnameMetFotos() {
  let op = K.nieuweOpname({ opname_id: 'OPN-TEST-EXP', project: { code: 'TEST-001' }, aangemaakt: T0, ruimtes: [K.nieuweRuimte({ id: 'R1', naam: 'Testkamer', wanden: [] })] });
  for (let i = 0; i < 4; i++) op = goed(K.voegWandToe(op, 'R1')); op = goed(K.maakRond(op, 'R1'));
  const foto = (id, wand, extra) => Object.assign({ id, bestand: 'testkamer-' + id.toLowerCase() + '.jpg', ruimte: 'R1', wand, tijd: T0 }, extra || {});
  op = goed(K.voegFotoToe(op, foto('F1', 'W1'))); op = goed(K.voegFotoToe(op, foto('F2', 'W2'))); op = goed(K.voegFotoToe(op, foto('F3', 'W1', { soort: 'extra' })));
  op = goed(K.voegFotoToe(op, foto('F4', 'W3'))); op = goed(K.verwijderFoto(op, 'F4'));              // een foto die uit de opname is gehaald blijft in het archief
  op = goed(K.zetMaat(op, 'R1', 'wanden.W1.maten.lengte', { staat: 'gemeten', waarde: 4000, bron: 'hand' }, T0));
  return op;
}
const rec = op => ({ id: op.opname_id, opname: op, layout: { R1: { W1: { foto: 'F1', hoeken: [[0.1, 0.9], [0.9, 0.9], [0.9, 0.1], [0.1, 0.1]] } } }, instellingen: { plint: { hoogte: 80 } } });
const fotoRecs = op => [['F1', 1500], ['F2', 2200], ['F3', 800], ['F4', 600], ['F9', 300]].map(([id, len], i) => ({ id: op.opname_id + ':' + id, opnameId: op.opname_id, bytes: bytes(i + 1, len), naam: id === 'F9' ? 'los.jpg' : 'testkamer-' + id.toLowerCase() + '.jpg', type: 'image/jpeg', grootte: len, breedte: 1536, hoogte: 1152, tijd: T0, ruimte: 'R1', wand: id === 'F1' || id === 'F3' ? 'W1' : id === 'F2' ? 'W2' : null, soort: id === 'F3' ? 'extra' : null, item: null }));

(async () => {
  await test('zip: schrijven en lezen geeft dezelfde bestanden terug (ook UTF-8-namen en leeg bestand)', async () => {
    const entries = [{ naam: 'a.txt', data: new TextEncoder().encode('hallo') }, { naam: 'fotos/één kamer ë.jpg', data: bytes(7, 5000) }, { naam: 'leeg.bin', data: new Uint8Array(0) }];
    const terug = await E.leesZip(E.zipBytes(entries));
    assert.deepStrictEqual(terug.map(x => x.naam), entries.map(x => x.naam)); terug.forEach((x, i) => assert.deepStrictEqual(Buffer.from(x.data), Buffer.from(entries[i].data)));
    assert.strictEqual(E.crc32(new TextEncoder().encode('123456789')), 0xCBF43926, 'bekende CRC32-testwaarde');
  });
  await test('zip: een zip met deflate (bijvoorbeeld door een ander programma opgeslagen) is ook te lezen', async () => {
    const data = new TextEncoder().encode('abc'.repeat(500)), def = zlib.deflateRawSync(data), naam = Buffer.from('x.txt'), crc = E.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(def.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(naam.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(def.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(naam.length, 28); cd.writeUInt32LE(0, 42);
    const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(46 + naam.length, 12); eocd.writeUInt32LE(30 + naam.length + def.length, 16);
    const zip = new Uint8Array(Buffer.concat([lh, naam, def, cd, naam, eocd])), uit = await E.leesZip(zip);
    assert.strictEqual(uit[0].naam, 'x.txt'); assert.deepStrictEqual(Buffer.from(uit[0].data), Buffer.from(data));
  });
  await test('export en terugzetten: de opname, layout, instellingen en ALLE foto\'s (ook de gearchiveerde en een los beeld) komen identiek terug', async () => {
    const op = opnameMetFotos(), pak = await E.maakPakket(rec(op), fotoRecs(op), { tijd: T0 });
    assert.strictEqual(pak.manifest.fotos.length, 5); assert.strictEqual(pak.manifest.schema, 'mt-opname-export'); assert.deepStrictEqual(pak.ontbrekend, []);
    assert.ok(pak.manifest.fotos.some(f => f.id === 'F4' && f.in_opname === false), 'de gearchiveerde foto staat erbij'); assert.ok(pak.manifest.fotos.some(f => f.id === 'F9' && f.niet_in_verwijzingen), 'een beeld zonder verwijzing gaat ook mee');
    assert.ok(pak.manifest.fotos.every(f => /^[0-9a-f]{64}$/.test(f.sha256)));
    const zip = E.zipBytes(pak.entries), terug = await E.leesPakket(zip);
    assert.strictEqual(terug.fout, null, terug.fout); assert.strictEqual(terug.fotos.length, 5);
    const plan = E.herstelPlan(terug, {}, 1);
    assert.strictEqual(plan.actie, 'terugzetten'); assert.strictEqual(plan.opname_id, 'OPN-TEST-EXP'); assert.deepStrictEqual(plan.record.opname, op, 'de opname is bit voor bit gelijk');
    assert.deepStrictEqual(plan.record.layout, rec(op).layout); assert.deepStrictEqual(plan.record.instellingen, { plint: { hoogte: 80 } });
    const bron = fotoRecs(op); assert.strictEqual(plan.fotoRecords.length, 5);
    plan.fotoRecords.forEach(f => { const b = bron.find(x => x.id === f.id); assert.ok(b, 'sleutel ' + f.id); assert.deepStrictEqual(Buffer.from(f.bytes), Buffer.from(b.bytes)); assert.strictEqual(f.wand, b.wand); assert.strictEqual(f.soort, b.soort); });
    assert.strictEqual(K.inhoudsHash(plan.record.opname), K.inhoudsHash(op)); assert.ok(K.lees(plan.record.opname).meldingen.length === 0);
  });
  await test('een vrijgegeven opname (uit de oude kern v0.3) blijft na export en terugzetten vrijgegeven, met zijn kernlabel', async () => {
    const fs = require('fs'), path = require('path'), op = K.lees(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'opname-v03-vrijgegeven.json'), 'utf8'))).opname;
    assert.strictEqual(K.effectieveStatus(op), 'vrijgegeven');
    const zip = E.zipBytes((await E.maakPakket({ id: op.opname_id, opname: op, layout: {}, instellingen: {} }, [])).entries), plan = E.herstelPlan(await E.leesPakket(zip), {}, 1);
    assert.strictEqual(plan.actie, 'terugzetten'); assert.strictEqual(K.effectieveStatus(plan.record.opname), 'vrijgegeven'); assert.strictEqual(K.vrijgaveKern(plan.record.opname).oud, true);
  });
  await test('bestaat de opname al op het toestel: dezelfde inhoud doet niets, een andere inhoud komt als kopie met een nieuwe id (niets overschreven)', async () => {
    const op = opnameMetFotos(), pak = await E.leesPakket(E.zipBytes((await E.maakPakket(rec(op), fotoRecs(op))).entries));
    assert.strictEqual(E.herstelPlan(pak, { 'OPN-TEST-EXP': K.inhoudsHash(op) }, 1).actie, 'staat-al-op-toestel');
    const kopie = E.herstelPlan(pak, { 'OPN-TEST-EXP': 'andere-hash' }, 1234);
    assert.strictEqual(kopie.actie, 'kopie'); assert.notStrictEqual(kopie.opname_id, 'OPN-TEST-EXP'); assert.ok(/^OPN-TEST-EXP-hersteld-/.test(kopie.opname_id));
    assert.strictEqual(kopie.record.opname.opname_id, kopie.opname_id); assert.ok(kopie.fotoRecords.every(f => f.id.startsWith(kopie.opname_id + ':') && f.opnameId === kopie.opname_id));
    assert.strictEqual(kopie.record.opname._hersteld_van.opname_id, 'OPN-TEST-EXP');
  });
  await test('een beschadigde of onvolledige export wordt geweigerd met een leesbare tekst, en er wordt niets teruggezet', async () => {
    const op = opnameMetFotos(), pak = await E.maakPakket(rec(op), fotoRecs(op)), zip = E.zipBytes(pak.entries);
    assert.ok(/geen zip/.test((await E.leesPakket(new Uint8Array(100))).fout));
    const kapot = zip.slice(); kapot[200] ^= 0xff; const k = await E.leesPakket(kapot); assert.ok(k.fout && /beschadigd/.test(k.fout), k.fout); assert.strictEqual(k.fotos.length, 0);
    const zonderFoto = E.zipBytes(pak.entries.filter(e => e.naam !== pak.manifest.fotos[0].pad)); const z = await E.leesPakket(zonderFoto); assert.ok(z.fout && /ontbreekt de foto/.test(z.fout), z.fout);
    const zonderJson = E.zipBytes(pak.entries.filter(e => e.naam !== 'opname.json')); assert.ok(/opname\.json ontbreekt/.test((await E.leesPakket(zonderJson)).fout));
    // foto met andere inhoud maar met correcte zip-CRC (bewust vervangen): de sha256 uit het manifest vangt het
    const vervangen = pak.entries.map(e => e.naam === pak.manifest.fotos[0].pad ? { naam: e.naam, data: bytes(99, e.data.length) } : e); const v = await E.leesPakket(E.zipBytes(vervangen)); assert.ok(v.fout && /controlesom/.test(v.fout), v.fout);
    const nieuwer = JSON.parse(JSON.stringify(pak.manifest)); nieuwer.formaat = 99; const nw = await E.leesPakket(E.zipBytes([{ naam: 'opname.json', data: new TextEncoder().encode(JSON.stringify(nieuwer)) }])); assert.ok(/nieuwere versie/.test(nw.fout));
  });
  await test('foto\'s die in de opname staan maar niet in de opslag zitten worden gemeld, niet verzwegen', async () => {
    const op = opnameMetFotos(), pak = await E.maakPakket(rec(op), fotoRecs(op).filter(f => !f.id.endsWith(':F2')));
    assert.deepStrictEqual(pak.ontbrekend, ['testkamer-f2.jpg']); const terug = await E.leesPakket(E.zipBytes(pak.entries)); assert.ok(terug.meldingen.some(m => /testkamer-f2\.jpg/.test(m)));
  });
  // ── brok 3e (Codex-review) ──
  await test('4: een vrijgegeven opname die als kopie terugkomt verliest de vrijgave expliciet en zichtbaar: status opgeslagen, reden en oude vrijgave vastgelegd, niet onverklaard "vrijgave-vervallen"', async () => {
    const fs = require('fs'), path = require('path'), op = K.lees(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'opname-v03-vrijgegeven.json'), 'utf8'))).opname;
    assert.strictEqual(K.effectieveStatus(op), 'vrijgegeven');
    const pak = await E.leesPakket(E.zipBytes((await E.maakPakket({ id: op.opname_id, opname: op, layout: {}, instellingen: {} }, [])).entries));
    const kopie = E.herstelPlan(pak, { [op.opname_id]: 'andere-hash' }, 1234), o = kopie.record.opname;
    assert.strictEqual(kopie.actie, 'kopie'); assert.strictEqual(o.status, 'opgeslagen'); assert.strictEqual(o.vrijgave, undefined, 'de vrijgave is weg');
    assert.strictEqual(K.effectieveStatus(o), 'opgeslagen', 'niet "vrijgave-vervallen"');
    const v = o._hersteld_van.vrijgave_vervallen; assert.ok(v && v.reden.indexOf('geïmporteerd als kopie van ' + op.opname_id) >= 0, v && v.reden);
    assert.strictEqual(v.oude_vrijgave.hash, op.vrijgave.hash); assert.strictEqual(v.oude_vrijgave.door, op.vrijgave.door); assert.strictEqual(v.oude_vrijgave.tijd, op.vrijgave.tijd);
    assert.strictEqual(op.status, 'vrijgegeven', 'de bron is niet aangepast'); assert.ok(op.vrijgave, 'de bron houdt zijn vrijgave');
    const gewoon = E.herstelPlan(pak, {}, 1); assert.strictEqual(K.effectieveStatus(gewoon.record.opname), 'vrijgegeven', 'terugzetten onder de eigen id houdt de vrijgave');
    const concept = opnameMetFotos(), pak2 = await E.leesPakket(E.zipBytes((await E.maakPakket(rec(concept), [])).entries)), k2 = E.herstelPlan(pak2, { 'OPN-TEST-EXP': 'x' }, 5);
    assert.strictEqual(k2.record.opname._hersteld_van.vrijgave_vervallen, undefined, 'zonder vrijgave valt er niets te vermelden');
  });
  await test('5: de import eist een opname-object, een gelijk opname-nummer en een kloppende inhoudshash; anders geweigerd met een duidelijke melding en niets teruggezet', async () => {
    const op = opnameMetFotos(), pak = await E.maakPakket(rec(op), fotoRecs(op), { tijd: T0 });
    const opnieuw = fn => { const m = JSON.parse(JSON.stringify(pak.manifest)); fn(m); return E.leesPakket(E.zipBytes(pak.entries.map(e => e.naam === 'opname.json' ? { naam: e.naam, data: new TextEncoder().encode(JSON.stringify(m)) } : e))); };   // zip-CRC en foto-sha256 kloppen wel
    assert.strictEqual((await opnieuw(() => {})).fout, null, 'ongewijzigd is in orde');
    let r = await opnieuw(m => { delete m.opname; }); assert.ok(r.fout && /opname zelf ontbreekt/.test(r.fout), r.fout); assert.strictEqual(r.fotos.length, 0);
    r = await opnieuw(m => { m.opname = 'tekst'; }); assert.ok(r.fout && /opname zelf ontbreekt/.test(r.fout), r.fout);
    r = await opnieuw(m => { m.opname = []; }); assert.ok(r.fout && /opname zelf ontbreekt/.test(r.fout), r.fout);
    r = await opnieuw(m => { m.opname_id = 'OPN-IETS-ANDERS'; }); assert.ok(r.fout && /opname-nummer/.test(r.fout) && /OPN-IETS-ANDERS/.test(r.fout) && /OPN-TEST-EXP/.test(r.fout), r.fout);
    r = await opnieuw(m => { m.opname.opname_id = 'OPN-GEHEEL-ANDER'; }); assert.ok(r.fout && /opname-nummer/.test(r.fout), r.fout);
    r = await opnieuw(m => { m.opname.ruimtes[0].wanden.find(w => w.id === 'W1').maten.lengte.waarde = 9999; }); assert.ok(r.fout && /beschadigd of aangepast/.test(r.fout), r.fout); assert.strictEqual(r.fotos.length, 0);
    r = await opnieuw(m => { m.inhoudshash = '00000000000000'; }); assert.ok(r.fout && /beschadigd of aangepast/.test(r.fout), r.fout);
    r = await opnieuw(m => { delete m.inhoudshash; }); assert.ok(r.fout && /beschadigd of aangepast/.test(r.fout), r.fout);
    r = await opnieuw(m => { m.inhoudshash = null; }); assert.ok(r.fout && /beschadigd of aangepast/.test(r.fout), r.fout);
    r = await opnieuw(m => { m.opname.status = 'opgeslagen'; m.opname.bijgewerkt = 'andere tijd'; }); assert.strictEqual(r.fout, null, 'velden die niet in de inhoudshash tellen (status, tijdstippen) mogen anders zijn');
  });
  console.log('\n' + n + ' tests geslaagd');
})();
