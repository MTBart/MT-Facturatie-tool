// Tests van de opslag bij meerdere tabbladen en bij terugzetten (brok 3e, Codex-review): revisienummer met compare-and-set, botsing bij import transactioneel bepaald, import atomair
// (foto's en opname in één transactie) en het gedrag van het opnamescherm bij een conflict. Een IndexedDB-nabootsing met echte transactie-eigenschappen (test/opname-nep-idb.js);
// een tweede tabblad is een tweede, losse instantie van de opslagmodule op dezelfde opslag. Draaien: node test/opname-tabs.test.js — verzonnen opname, eigen testbytes.
'use strict';
const assert = require('assert');
const { maakNepIDB, laadOpslag } = require('./opname-nep-idb.js');
let n = 0; const test = (naam, fn) => fn().then(() => { n++; console.log('ok  - ' + naam); }, e => { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; });
const nep = maakNepIDB(); global.indexedDB = nep.idb; global.document = {};
const K = global.MTOpnameKern = require('../mt-opname-kern.js');
global.MTOpnameGeo = require('../mt-opname-geo.js');
const E = require('../mt-opname-export.js');
const A = global.MTOpnameOpslag = laadOpslag();              // tabblad A: de instantie die het opnamescherm gebruikt
const B = laadOpslag();                                      // tabblad B: een tweede venster op dezelfde opslag
const M = require('../mt-opname.js'); require('../mt-opname-model.js');
const T0 = '2026-11-02T09:00:00.000Z';
const goed = res => { assert.strictEqual(res.fout, null, res.fout); return res.opname; };
const bytes = (zaad, lengte) => { const b = new Uint8Array(lengte); let x = zaad; for (let i = 0; i < lengte; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; b[i] = x >> 16; } return b; };
const wis = () => { nep.duurzaam.opnames.clear(); nep.duurzaam.fotos.clear(); nep.voorPut = null; };
const afwijzing = p => p.then(() => null, e => e);
function opnameMet(maat) {
  let op = K.nieuweOpname({ opname_id: 'OPN-TABS', project: { code: 'TEST-002' }, aangemaakt: T0, ruimtes: [K.nieuweRuimte({ id: 'R1', naam: 'Tabkamer', wanden: [] })] });
  for (let i = 0; i < 4; i++) op = goed(K.voegWandToe(op, 'R1')); op = goed(K.maakRond(op, 'R1'));
  op = goed(K.voegFotoToe(op, { id: 'F1', bestand: 'tabkamer-f1.jpg', ruimte: 'R1', wand: 'W1', tijd: T0 })); op = goed(K.voegFotoToe(op, { id: 'F2', bestand: 'tabkamer-f2.jpg', ruimte: 'R1', wand: 'W2', tijd: T0 }));
  if (maat) op = goed(K.zetMaat(op, 'R1', 'wanden.W1.maten.lengte', { staat: 'gemeten', waarde: maat, bron: 'hand' }, T0));
  return op;
}
const recVan = (op, extra) => Object.assign({ id: op.opname_id, opname: op, layout: {}, instellingen: {} }, extra || {});
async function exportVan(op) {
  const fotos = ['F1', 'F2'].map((id, i) => ({ id: op.opname_id + ':' + id, opnameId: op.opname_id, bytes: bytes(i + 3, 700), naam: 'tabkamer-' + id.toLowerCase() + '.jpg', type: 'image/jpeg', grootte: 700, breedte: 10, hoogte: 10, tijd: T0, ruimte: 'R1', wand: 'W' + (i + 1), soort: null, item: null }));
  return E.leesPakket(E.zipBytes((await E.maakPakket(recVan(op), fotos, { tijd: T0 })).entries));
}
// wat de app doet: de plan-bepaling binnen de transactie, met de bytes als opslagrecord
const bepaler = pak => huidig => {
  const id = pak.manifest.opname_id, hash = huidig ? K.inhoudsHash(huidig.opname) : null, p = E.herstelPlan(pak, huidig ? { [id]: hash } : {}, 12345);
  p.fotoRecords = (p.fotoRecords || []).map(f => ({ id: f.id, opnameId: f.opnameId, blob: f.bytes, naam: f.naam, type: f.type })); return p;
};

(async () => {
  // ── punt 2: revisienummer en compare-and-set ──
  await test('2: opslaan verhoogt de rev; een oud record zonder rev telt als rev 0 en wordt zonder verlies bijgewerkt', async () => {
    wis(); nep.duurzaam.opnames.set('OPN-OUD', { id: 'OPN-OUD', opname: { a: 1 }, layout: {}, instellingen: {}, bijgewerkt: T0 });          // zoals een opname van vóór brok 3e
    const gelezen = await A.lees('OPN-OUD'); assert.strictEqual(gelezen.rev, undefined);
    const k1 = await A.schrijf(Object.assign({}, gelezen, { opname: { a: 2 } })); assert.strictEqual(k1.rev, 1); assert.strictEqual(nep.duurzaam.opnames.get('OPN-OUD').opname.a, 2);
    const k2 = await A.schrijf(Object.assign({}, k1, { opname: { a: 3 } })); assert.strictEqual(k2.rev, 2); assert.strictEqual(nep.duurzaam.opnames.get('OPN-OUD').rev, 2);
  });
  await test('2: een tweede tabblad met een verouderde stand kan niets overschrijven: conflictfout met de vaste tekst, de opslag blijft zoals de eerste schreef', async () => {
    wis(); const nieuw = await A.schrijf({ id: 'OPN-X', opname: { v: 'start' }, layout: {}, instellingen: {} }, { nieuw: true });
    const vanA = await A.lees('OPN-X'), vanB = await B.lees('OPN-X'); assert.strictEqual(vanA.rev, 1); assert.strictEqual(vanB.rev, 1); assert.strictEqual(nieuw.rev, 1);
    await A.schrijf(Object.assign({}, vanA, { opname: { v: 'A' } }));
    const fout = await afwijzing(B.schrijf(Object.assign({}, vanB, { opname: { v: 'B' } })));
    assert.ok(fout, 'B moet geweigerd worden'); assert.strictEqual(fout.code, 'conflict'); assert.strictEqual(fout.message, 'Deze opname is in een ander tabblad of venster gewijzigd. Herlaad om verder te gaan; je laatste invoer is niet opgeslagen.');
    assert.strictEqual(nep.duurzaam.opnames.get('OPN-X').opname.v, 'A', 'de wijziging van A is niet overschreven'); assert.strictEqual(nep.duurzaam.opnames.get('OPN-X').rev, 2);
    const herlaad = await B.lees('OPN-X'); assert.strictEqual((await B.schrijf(Object.assign({}, herlaad, { opname: { v: 'B na herladen' } }))).rev, 3, 'na herladen kan B weer gewoon schrijven');
  });
  await test('2: twee tabbladen die tegelijk schrijven: precies één slaagt, de ander krijgt een conflict (geen stil last-writer-wins)', async () => {
    wis(); await A.schrijf({ id: 'OPN-Y', opname: { v: 0 }, layout: {}, instellingen: {} }, { nieuw: true });
    const a = await A.lees('OPN-Y'), b = await B.lees('OPN-Y');
    const [ra, rb] = await Promise.all([afwijzing(A.schrijf(Object.assign({}, a, { opname: { v: 'A' } }))), afwijzing(B.schrijf(Object.assign({}, b, { opname: { v: 'B' } })))]);
    assert.strictEqual([ra, rb].filter(x => x === null || (x && x.code === 'conflict')).length, 2); assert.strictEqual([ra, rb].filter(x => x && x.code === 'conflict').length, 1, 'één conflict');
    assert.strictEqual(nep.duurzaam.opnames.get('OPN-Y').rev, 2);
  });
  await test('2: opslaan met { nieuw: true } overschrijft nooit een bestaande opname', async () => {
    wis(); await A.schrijf({ id: 'OPN-Z', opname: { v: 1 }, layout: {}, instellingen: {} }, { nieuw: true });
    const fout = await afwijzing(B.schrijf({ id: 'OPN-Z', opname: { v: 'ander' }, layout: {}, instellingen: {} }, { nieuw: true })); assert.ok(fout && fout.code === 'conflict');
    assert.strictEqual(nep.duurzaam.opnames.get('OPN-Z').opname.v, 1);
  });
  await test('2: het opnamescherm houdt de invoer in beeld bij een conflict, meldt het en overschrijft ook bij volgende wijzigingen niets', async () => {
    wis(); const X = M.X, S = X.S, op = opnameMet(4000);
    S.rec = recVan(op); const eerste = X.bewaar(); await eerste; assert.strictEqual(S.rec.rev, 1, 'de rev van het scherm volgt de opslag'); assert.strictEqual(S.conflict, false);
    X.bewaar(); X.bewaar(); await S.keten; assert.strictEqual(S.rec.rev, 3, 'snel na elkaar bewaren (keten) botst niet met zichzelf'); assert.strictEqual(S.opslagFout, null);
    const ander = await B.lees('OPN-TABS'); await B.schrijf(Object.assign({}, ander, { opname: Object.assign({}, ander.opname, { bijgewerkt: 'tab-B' }) }));          // tabblad B wijzigt de opname
    const invoer = goed(K.zetMaat(S.rec.opname, 'R1', 'wanden.W2.maten.lengte', { staat: 'gemeten', waarde: 3500, bron: 'hand' }, T0));
    X.wijzig({ opname: invoer, fout: null }); await S.keten;
    assert.strictEqual(S.conflict, true); assert.strictEqual(S.opslagFout, A.CONFLICT_TEKST); assert.ok(/niet opgeslagen/.test(S.opslagFout));
    assert.strictEqual(S.rec.opname.ruimtes[0].wanden.find(w => w.id === 'W2').maten.lengte.waarde, 3500, 'de invoer staat nog gewoon op het scherm');
    assert.strictEqual(nep.duurzaam.opnames.get('OPN-TABS').opname.bijgewerkt, 'tab-B', 'en de opslag is van tabblad B gebleven');
    X.wijzig({ opname: goed(K.zetMaat(S.rec.opname, 'R1', 'wanden.W3.maten.lengte', { staat: 'gemeten', waarde: 3600, bron: 'hand' }, T0)), fout: null }); await S.keten;
    assert.strictEqual(nep.duurzaam.opnames.get('OPN-TABS').opname.bijgewerkt, 'tab-B', 'een volgende wijziging overschrijft het ook niet'); assert.strictEqual(await M.bewaarAlles(), false, 'de host mag de laag niet als veilig-sluitbaar zien');
    S.rec = null; S.conflict = false; S.onbewaard = false; S.opslagFout = null;
  });

  // ── punt 1 en 3: terugzetten ──
  await test('1: de botsing bij terugzetten wordt in de transactie bepaald: een opname die een ander tabblad net heeft gemaakt wordt niet overschreven, het wordt een kopie', async () => {
    wis(); const pak = await exportVan(opnameMet(4000));
    assert.deepStrictEqual(await A.lijst(), [], 'tabblad A ziet nog niets (verouderde lijst)');
    await B.schrijf(recVan(opnameMet(4321)), { nieuw: true });                                  // tabblad B maakt/herstelt dezelfde id met andere inhoud, ná het laden van A
    const plan = await A.importeer(pak.manifest.opname_id, bepaler(pak));
    assert.strictEqual(plan.actie, 'kopie'); assert.ok(/^OPN-TABS-hersteld-/.test(plan.opname_id));
    const b = nep.duurzaam.opnames.get('OPN-TABS'); assert.strictEqual(b.opname.ruimtes[0].wanden.find(w => w.id === 'W1').maten.lengte.waarde, 4321, 'de opname van B is onaangeroerd');
    assert.ok(nep.duurzaam.opnames.has(plan.opname_id), 'de import staat als kopie in de opslag'); assert.strictEqual(nep.duurzaam.fotos.size, 2);
    assert.ok([...nep.duurzaam.fotos.keys()].every(k => k.startsWith(plan.opname_id + ':')), 'de foto\'s horen bij de kopie');
  });
  await test('1: gelijktijdig terugzetten en schrijven door een ander tabblad: in beide volgorden gaat er niets verloren', async () => {
    wis(); const pak = await exportVan(opnameMet(4000));
    const [plan, fout] = await Promise.all([A.importeer('OPN-TABS', bepaler(pak)), afwijzing(B.schrijf(recVan(opnameMet(999)), { nieuw: true }))]);          // A staat in de wachtrij vóór B
    assert.strictEqual(plan.actie, 'terugzetten'); assert.ok(fout && fout.code === 'conflict', 'B wordt geweigerd i.p.v. de import te overschrijven');
    assert.strictEqual(nep.duurzaam.opnames.get('OPN-TABS').opname.ruimtes[0].wanden.find(w => w.id === 'W1').maten.lengte.waarde, 4000, 'de teruggezette opname is intact');
    wis(); const [fout2, plan2] = await Promise.all([afwijzing(B.schrijf(recVan(opnameMet(999)), { nieuw: true })), A.importeer('OPN-TABS', bepaler(pak))]);           // nu eerst B
    assert.strictEqual(fout2, null); assert.strictEqual(plan2.actie, 'kopie', 'de import ziet de opname van B en wordt een kopie');
    assert.strictEqual(nep.duurzaam.opnames.get('OPN-TABS').opname.ruimtes[0].wanden.find(w => w.id === 'W1').maten.lengte.waarde, 999);
  });
  await test('1: staat dezelfde inhoud al op het toestel, dan schrijft terugzetten niets', async () => {
    wis(); const op = opnameMet(4000), pak = await exportVan(op); await A.schrijf(recVan(op), { nieuw: true });
    const voor = JSON.stringify([...nep.duurzaam.opnames]), plan = await A.importeer('OPN-TABS', bepaler(pak));
    assert.strictEqual(plan.actie, 'staat-al-op-toestel'); assert.strictEqual(JSON.stringify([...nep.duurzaam.opnames]), voor); assert.strictEqual(nep.duurzaam.fotos.size, 0);
  });
  await test('3: terugzetten is atomair: mislukt een foto of de opname, dan staat er niets (geen halve import)', async () => {
    wis(); const pak = await exportVan(opnameMet(4000)); let puts = 0;
    nep.voorPut = (store) => { puts++; return store === 'fotos' && puts === 2 ? { name: 'QuotaExceededError', message: 'quota vol bij de tweede foto' } : null; };
    let fout = await afwijzing(A.importeer('OPN-TABS', bepaler(pak))); assert.ok(fout && /quota/i.test(fout.message), fout && fout.message);
    assert.strictEqual(nep.duurzaam.fotos.size, 0, 'de eerste foto is teruggedraaid'); assert.strictEqual(nep.duurzaam.opnames.size, 0);
    nep.voorPut = store => store === 'opnames' ? { name: 'QuotaExceededError', message: 'quota vol bij de opname' } : null;
    fout = await afwijzing(A.importeer('OPN-TABS', bepaler(pak))); assert.ok(fout && /quota/i.test(fout.message));
    assert.strictEqual(nep.duurzaam.fotos.size, 0, 'de foto\'s zijn teruggedraaid omdat de opname niet lukte'); assert.strictEqual(nep.duurzaam.opnames.size, 0);
    nep.voorPut = null; const voor = nep.transacties, plan = await A.importeer('OPN-TABS', bepaler(pak));
    assert.strictEqual(nep.transacties - voor, 1, 'foto\'s en opname gaan in één transactie'); assert.strictEqual(plan.actie, 'terugzetten');
    assert.strictEqual(nep.duurzaam.fotos.size, 2); assert.strictEqual(nep.duurzaam.opnames.get('OPN-TABS').rev, 1);
  });
  await test('3: een fout bij het bepalen van het plan (of een bestaande kopie-id) breekt af zonder iets te schrijven', async () => {
    wis(); const pak = await exportVan(opnameMet(4000));
    let fout = await afwijzing(A.importeer('OPN-TABS', () => { throw new Error('plan kapot'); })); assert.ok(fout && /plan kapot/.test(fout.message)); assert.strictEqual(nep.duurzaam.opnames.size + nep.duurzaam.fotos.size, 0);
    await B.schrijf(recVan(opnameMet(1)), { nieuw: true }); await B.schrijf({ id: 'OPN-TABS-hersteld-9ix', opname: {}, layout: {}, instellingen: {} }, { nieuw: true });          // 12345 in base36 = 9ix: de kopie-id bestaat al
    const voor = nep.duurzaam.opnames.size; fout = await afwijzing(A.importeer('OPN-TABS', bepaler(pak))); assert.ok(fout && fout.code === 'conflict', 'bestaande kopie-id: geweigerd');
    assert.strictEqual(nep.duurzaam.opnames.size, voor); assert.strictEqual(nep.duurzaam.fotos.size, 0);
  });
  console.log('\n' + n + ' tests geslaagd');
})();
