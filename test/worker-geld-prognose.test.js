// Worker-tests voor /geld/prognose en de schrijfrechten van de /geld/-routes (zonder deploy: de handler wordt lokaal geladen met een
// nagebootste KV). Draaien: node test/worker-geld-prognose.test.js  — verzonnen ids en namen.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const { pathToFileURL } = require('url');

(async () => {
  const bron = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8') + '\nexport { handleGeld, geldPrognoseEvents, geldBankdagNa };\n';
  const tmp = path.join(os.tmpdir(), `mt-worker-test-${process.pid}.mjs`); fs.writeFileSync(tmp, bron, 'utf8');
  let handleGeld, MtTeller, geldPrognoseEvents, geldBankdagNa; try { ({ handleGeld, MtTeller, geldPrognoseEvents, geldBankdagNa } = await import(pathToFileURL(tmp).href)); } finally { try { fs.unlinkSync(tmp); } catch { } }

  const kv = () => { const m = new Map(); return { m, async get(k) { return m.has(k) ? m.get(k).v : null; }, async put(k, v, o) { m.set(k, { v, meta: (o && o.metadata) || null }); }, async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix || '')).sort().map(name => ({ name, metadata: m.get(name).meta })), list_complete: true }; } }; };
  const json0 = (b, s) => ({ status: s || 200, body: b });
  const fakeState = () => { let ketting = Promise.resolve(); const opslag = new Map(); return { storage: { async get(k) { return opslag.get(k); }, async put(k, v) { opslag.set(k, v); } }, async blockConcurrencyWhile(fn) { const vorige = ketting; let los; ketting = new Promise(r => { los = r; }); await vorige; try { return await fn(); } finally { los(); } } }; };
  const maakNs = env => { const dos = {}; return { idFromName: n => n, get: id => { dos[id] = dos[id] || new MtTeller(fakeState(), env); return { fetch: (url, init) => dos[id].fetch(new Request(url, init)) }; } }; };
  const roep = async (env, rol, pad, methode, body) => {
    if (!env.MT_TELLER && !env.zonderDO) env.MT_TELLER = maakNs(env);
    const req = { method: methode, url: 'https://x.test' + pad, json: async () => body || {} };
    return handleGeld(pad.split('?')[0], req, env, { rol, oid: 'oid-' + rol, email: rol + '@voorbeeld.test', rec: { naam: 'Test' } }, json0);
  };
  const plus = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const item = (eid, o) => Object.assign({ naam: 'Voorbeeld ' + eid, estimate_id: eid, offertenr: '2026-1', totaal: 1000, betaaltermijn: 14, aan: true,
    termijnen: [{ id: 't1', label: 'factuur', bedrag: 1000, factuurdatum: plus(30), aan: true }], k: [], x: [] }, o || {});

  let n = 0; const test = async (naam, fn) => { try { await fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };

  await test('lees-recht (administratie) kan geen enkele schrijvende /geld/-route gebruiken', async () => {
    const env = { MT_ROLLEN: kv() };
    for (const [pad, body] of [['/geld/prognose', { sleutel: 'p:abc', item: item('300000000001'), vorige_ts: null }], ['/geld/patroon', { id: 'p0123456789ab', aan: false }],
      ['/geld/override', { document_id: 'abc', soort: 'verkoop', type: 'wissen' }], ['/geld/config', {}], ['/geld/ijkpunt', {}], ['/geld/koers/dagfoto', {}]]) {
      const r = await roep(env, 'administratie', pad, 'POST', body);
      assert.strictEqual(r.status, 403, pad + ' gaf ' + r.status); assert.strictEqual(r.body.reden, 'geld-wijzigen');
    }
    assert.strictEqual([...env.MT_ROLLEN.m.keys()].filter(k => k.startsWith('geld:prognose:')).length, 0, 'er is niets opgeslagen');
    const lees = await roep(env, 'administratie', '/geld/prognose', 'GET'); assert.strictEqual(lees.status, 200);
  });
  await test('rol zonder geld-recht komt er niet in; lezen via GET kan niet', async () => {
    const env = { MT_ROLLEN: kv() };
    for (const rol of ['beheerder', 'kantoor', 'werkplaats', 'lezen']) { const r = await roep(env, rol, '/geld/prognose', 'POST', { sleutel: 'p:abc', item: item('300000000001') }); assert.strictEqual(r.status, 403); assert.strictEqual(r.body.reden, 'geld'); }
  });
  await test('eigenaar kan opslaan; een tweede actief item met dezelfde offerte krijgt 409', async () => {
    const env = { MT_ROLLEN: kv() };
    const a = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:abc', item: item('300000000001'), vorige_ts: null }); assert.strictEqual(a.status, 200, JSON.stringify(a.body));
    const b = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:e300000000001', item: item('300000000001'), vorige_ts: null });
    assert.strictEqual(b.status, 409); assert.match(b.body.error, /staat al als actief prognose-item/); assert.strictEqual(b.body.dubbel, 'p:abc');
    assert.ok(![...env.MT_ROLLEN.m.keys()].includes('geld:prognose:p:e300000000001'), 'het dubbele item is niet opgeslagen');
  });
  await test('dubbel uitzetten (aan:false) en een ander item met een andere offerte mogen wel; hetzelfde sleutel bijwerken ook', async () => {
    const env = { MT_ROLLEN: kv() };
    const a = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:abc', item: item('300000000001'), vorige_ts: null });
    const uit = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:e300000000001', item: item('300000000001', { aan: false }), vorige_ts: null }); assert.strictEqual(uit.status, 200);
    const andere = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:xyz', item: item('300000000002'), vorige_ts: null }); assert.strictEqual(andere.status, 200);
    const zelfde = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:abc', item: item('300000000001', { totaal: 1000 }), vorige_ts: a.body.item.ts }); assert.strictEqual(zelfde.status, 200);
    const wissen = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:xyz', item: null, vorige_ts: andere.body.item.ts }); assert.strictEqual(wissen.status, 200);
  });
  await test('een uitgezet item weer aanzetten terwijl een ander actief is, wordt geweigerd', async () => {
    const env = { MT_ROLLEN: kv() };
    await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:abc', item: item('300000000001'), vorige_ts: null });
    const uit = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:e300000000001', item: item('300000000001', { aan: false }), vorige_ts: null });
    const aan = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:e300000000001', item: item('300000000001'), vorige_ts: uit.body.item.ts }); assert.strictEqual(aan.status, 409);
  });
  await test('handmatige post en item zonder offerte-id worden niet op dubbelen gecontroleerd', async () => {
    const env = { MT_ROLLEN: kv() };
    const x = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:a1', item: item(null), vorige_ts: null }); assert.strictEqual(x.status, 200);
    const y = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:a2', item: item(null), vorige_ts: null }); assert.strictEqual(y.status, 200);
    const z = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'h:abcd1234', item: { omschrijving: 'machine', richting: 'uit', bedrag: 100, datum: plus(10), aan: true }, vorige_ts: null }); assert.strictEqual(z.status, 200);
  });
  await test('verouderde vorige_ts blijft 409', async () => {
    const env = { MT_ROLLEN: kv() };
    await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:abc', item: item('300000000001'), vorige_ts: null });
    const r = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:abc', item: item('300000000001'), vorige_ts: 5 }); assert.strictEqual(r.status, 409); assert.match(r.body.error, /intussen aangepast/);
  });
  await test('termijnlabel komt ongewijzigd terug uit de worker (label-roundtrip, max 24 tekens)', async () => {
    const env = { MT_ROLLEN: kv() };
    const r = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:lab', item: item('300000000031', { totaal: 3000, termijnen: [{ id: 't1', label: 'aanbetaling', bedrag: 1000, factuurdatum: plus(20), aan: true }, { id: 't2', label: 'tussentijds termijn die veel te lang is', bedrag: 2000, factuurdatum: plus(40), aan: false }] }), vorige_ts: null });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.deepStrictEqual(r.body.item.termijnen.map(t => t.label), ['aanbetaling', 'tussentijds termijn die ']);
    const lijst = await roep(env, 'eigenaar', '/geld/prognose', 'GET'); assert.strictEqual(lijst.body.items['p:lab'].termijnen[0].label, 'aanbetaling');
  });
  const kvPag = (per, oneindig) => { const k = kv(); k.list = async ({ prefix, cursor }) => { const alle = [...k.m.keys()].filter(x => x.startsWith(prefix || '')).sort(), van = Number(cursor || 0), stuk = alle.slice(van, van + per);
    const klaar = !oneindig && van + per >= alle.length; return { keys: stuk.map(name => ({ name, metadata: k.m.get(name).meta })), list_complete: klaar, cursor: klaar ? undefined : String(van + per) }; }; return k; };
  const zaai = (env, n) => { for (let i = 0; i < n; i++) { const it = Object.assign({ soort: 'project', ts: 1 + i, door: 'x' }, item('300000000' + String(100 + i))); it.naam = 'Zaad ' + i; env.MT_ROLLEN.m.set('geld:prognose:p:z' + String(i).padStart(3, '0'), { v: JSON.stringify(it), meta: it }); } };
  await test('dubbele offerte wordt ook gevonden als de prognoselijst uit meer dan 3 pagina\u2019s bestaat', async () => {
    const env = { MT_ROLLEN: kvPag(2) }; zaai(env, 9);                                   // 5 pagina's van 2; de dubbele offerte staat op de laatste pagina
    const dubbel = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:nieuw', item: item('300000000108'), vorige_ts: null });
    assert.strictEqual(dubbel.status, 409, JSON.stringify(dubbel.body)); assert.strictEqual(dubbel.body.dubbel, 'p:z008');
    const eerste = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:nieuw2', item: item('300000000100'), vorige_ts: null }); assert.strictEqual(eerste.status, 409);
    const vrij = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:nieuw3', item: item('300000000999'), vorige_ts: null }); assert.strictEqual(vrij.status, 200, JSON.stringify(vrij.body));
  });
  await test('onvolledige prognoselijst: weigeren met 503, nooit doorlaten; uitzetten (aan:false) mag wel', async () => {
    const env = { MT_ROLLEN: kvPag(2, true) }; zaai(env, 3);                               // de lijst meldt nooit "klaar"
    const r = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:nieuw', item: item('300000000555'), vorige_ts: null });
    assert.strictEqual(r.status, 503); assert.match(r.body.error, /kon niet controleren op dubbele offerte/); assert.ok(!env.MT_ROLLEN.m.has('geld:prognose:p:nieuw'));
    const uit = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:nieuw', item: item('300000000555', { aan: false }), vorige_ts: null }); assert.strictEqual(uit.status, 200);
    const kapot = kv(); kapot.list = async () => { throw new Error('KV stuk'); };
    const r2 = await roep({ MT_ROLLEN: kapot }, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:nieuw', item: item('300000000555'), vorige_ts: null }); assert.strictEqual(r2.status, 503);
  });  const ub = (env) => [...env.MT_ROLLEN.m.keys()].filter(k => k.startsWith('geld:uitbeeld:'));
  const idn = i => '3' + String(10000000000 + i);                                    // verzonnen, geldige offerte-id's
  await test('uit beeld: per offerte een eigen KV-sleutel; server zet wie en wanneer; de config blijft ongemoeid', async () => {
    const env = { MT_ROLLEN: kv() }; await roep(env, 'eigenaar', '/geld/config', 'GET');
    env.MT_ROLLEN.m.set('geld:config', { v: JSON.stringify({ revisie: 4, kredietlimiet: 1234 }), meta: null }); const configVoor = env.MT_ROLLEN.m.get('geld:config').v;
    const leeg = await roep(env, 'administratie', '/geld/uitbeeld', 'GET'); assert.strictEqual(leeg.status, 200); assert.deepStrictEqual(leeg.body.items, {}); assert.strictEqual(leeg.body.max, 5000);
    const w = await roep(env, 'eigenaar', '/geld/uitbeeld', 'POST', { ids: [idn(1), idn(2)], reden: 'verkeerd', door: 'Valse Naam', ts: 5 });
    assert.strictEqual(w.status, 200, JSON.stringify(w.body)); assert.deepStrictEqual(ub(env).sort(), ['geld:uitbeeld:' + idn(1), 'geld:uitbeeld:' + idn(2)]);
    const rec = w.body.items[idn(1)]; assert.strictEqual(rec.reden, 'verkeerd'); assert.notStrictEqual(rec.door, 'Valse Naam'); assert.ok(rec.ts > 1e12);
    assert.strictEqual(env.MT_ROLLEN.m.get('geld:config').v, configVoor, 'de config is niet aangeraakt');
    const lees = await roep(env, 'administratie', '/geld/uitbeeld', 'GET'); assert.deepStrictEqual(Object.keys(lees.body.items).sort(), [idn(1), idn(2)].sort()); assert.strictEqual(lees.body.aantal, 2);
  });
  await test('uit beeld: gelijktijdige acties op verschillende offertes wissen elkaar niet; zelfde reden houdt de stempel; terugzetten wist alleen die offerte', async () => {
    const env = { MT_ROLLEN: kv() };
    const [a, b] = await Promise.all([roep(env, 'eigenaar', '/geld/uitbeeld', 'POST', { ids: [idn(11)], reden: 'weg' }), roep(env, 'eigenaar', '/geld/uitbeeld', 'POST', { ids: [idn(12)], reden: 'gefactureerd' })]);
    assert.strictEqual(a.status, 200); assert.strictEqual(b.status, 200); assert.deepStrictEqual(ub(env).sort(), ['geld:uitbeeld:' + idn(11), 'geld:uitbeeld:' + idn(12)]);
    const eerst = JSON.parse(env.MT_ROLLEN.m.get('geld:uitbeeld:' + idn(11)).v); await new Promise(r => setTimeout(r, 5));
    const nog = await roep(env, 'eigenaar', '/geld/uitbeeld', 'POST', { ids: [idn(11)], reden: 'weg' }); assert.deepStrictEqual(nog.body.items[idn(11)], eerst);
    const anders = await roep(env, 'eigenaar', '/geld/uitbeeld', 'POST', { ids: [idn(11)], reden: 'verkeerd' }); assert.strictEqual(anders.body.items[idn(11)].reden, 'verkeerd'); assert.ok(anders.body.items[idn(11)].ts >= eerst.ts);
    const terug = await roep(env, 'eigenaar', '/geld/uitbeeld', 'POST', { ids: [idn(11)], reden: null }); assert.deepStrictEqual(terug.body.verwijderd, [idn(11)]);
    assert.deepStrictEqual(ub(env), ['geld:uitbeeld:' + idn(12)]); assert.deepStrictEqual(Object.keys((await roep(env, 'eigenaar', '/geld/uitbeeld', 'GET')).body.items), [idn(12)]);
  });
  await test('uit beeld: validatie, rechten (server) en controle zonder schrijven', async () => {
    const env = { MT_ROLLEN: kv() };
    for (const b of [{ ids: [], reden: 'weg' }, { ids: ['abc'], reden: 'weg' }, { ids: [idn(1), idn(1)], reden: 'weg' }, { ids: [idn(1)], reden: 'onzin' }, { ids: [idn(1)] }, { reden: 'weg' }, { ids: 'x', reden: 'weg' }, { ids: Array.from({ length: 501 }, (_, i) => idn(i)), reden: 'weg' }])
      assert.strictEqual((await roep(env, 'eigenaar', '/geld/uitbeeld', 'POST', b)).status, 400, JSON.stringify(b).slice(0, 60));
    for (const rol of ['administratie', 'beheerder', 'kantoor', 'werkplaats', 'lezen']) assert.strictEqual((await roep(env, rol, '/geld/uitbeeld', 'POST', { ids: [idn(1)], reden: 'weg' })).status, 403, rol);
    for (const rol of ['beheerder', 'kantoor', 'werkplaats', 'lezen']) assert.strictEqual((await roep(env, rol, '/geld/uitbeeld', 'GET')).status, 403, rol);
    const c = await roep(env, 'eigenaar', '/geld/uitbeeld', 'POST', { ids: [idn(1)], reden: 'weg', controle: true }); assert.strictEqual(c.status, 200); assert.strictEqual(c.body.controle, true); assert.strictEqual(c.body.aantal, 1);
    assert.deepStrictEqual(ub(env), [], 'controle schrijft niets');
  });
  await test('uit beeld: maximum aantal sleutels (5000), controle en echte schrijfactie weigeren; terugzetten blijft mogelijk', async () => {
    const env = { MT_ROLLEN: kvPag(1000) };
    for (let i = 0; i < 5000; i++) { const r = { reden: 'weg', door: 'x', ts: 1 }; env.MT_ROLLEN.m.set('geld:uitbeeld:' + idn(i), { v: JSON.stringify(r), meta: r }); }
    const vol = await roep(env, 'eigenaar', '/geld/uitbeeld', 'POST', { ids: [idn(9000)], reden: 'weg' }); assert.strictEqual(vol.status, 400); assert.match(vol.body.error, /vol/);
    assert.strictEqual((await roep(env, 'eigenaar', '/geld/uitbeeld', 'POST', { ids: [idn(9000)], reden: 'weg', controle: true })).status, 400);
    assert.strictEqual((await roep(env, 'eigenaar', '/geld/uitbeeld', 'POST', { ids: [idn(5)], reden: 'verkeerd' })).status, 200);                   // een bestaande aanpassen mag
    assert.strictEqual((await roep(env, 'eigenaar', '/geld/uitbeeld', 'POST', { ids: [idn(6)], reden: null })).status, 200);                           // terugzetten mag
    assert.strictEqual((await roep(env, 'eigenaar', '/geld/uitbeeld', 'POST', { ids: [idn(9000)], reden: 'weg' })).status, 200);                       // nu is er weer een plek
    const g = await roep(env, 'eigenaar', '/geld/uitbeeld', 'GET'); assert.strictEqual(g.body.aantal, 5000);                                         // volledige paginering: 5000 sleutels over 5 pagina's
  });
  await test('uit beeld en factuurschema’s: fail-closed bij een onvolledige lijst (503), nooit een halve lijst of schrijven op een gok', async () => {
    const env = { MT_ROLLEN: kvPag(2, true) };
    for (let i = 0; i < 3; i++) { const r = { reden: 'weg', door: 'x', ts: 1 }; env.MT_ROLLEN.m.set('geld:uitbeeld:' + idn(i), { v: JSON.stringify(r), meta: r }); }
    assert.strictEqual((await roep(env, 'eigenaar', '/geld/uitbeeld', 'GET')).status, 503);
    for (const b of [{ ids: [idn(50)], reden: 'weg' }, { ids: [idn(50)], reden: 'weg', controle: true }, { ids: [idn(1)], reden: null }]) assert.strictEqual((await roep(env, 'eigenaar', '/geld/uitbeeld', 'POST', b)).status, 503);
    assert.ok(!env.MT_ROLLEN.m.has('geld:uitbeeld:' + idn(50))); assert.ok(env.MT_ROLLEN.m.has('geld:uitbeeld:' + idn(1)));
    assert.strictEqual((await roep(env, 'eigenaar', '/geld/fschemas', 'GET')).status, 503);
    const kapot = kv(); kapot.list = async () => { throw new Error('KV stuk'); };
    assert.strictEqual((await roep({ MT_ROLLEN: kapot }, 'eigenaar', '/geld/uitbeeld', 'GET')).status, 503); assert.strictEqual((await roep({ MT_ROLLEN: kapot }, 'eigenaar', '/geld/fschemas', 'GET')).status, 503);
    assert.strictEqual((await roep({ MT_ROLLEN: kapot }, 'eigenaar', '/geld/fschema', 'POST', { contact_id: '700000000001', rijen: [{ label: 'a', pct: 100 }] })).status, 503);
  });
  await test('uit beeld: een lijst van meer dan 3 pagina’s wordt helemaal gelezen', async () => {
    const env = { MT_ROLLEN: kvPag(2) }; for (let i = 0; i < 9; i++) { const r = { reden: 'weg', door: 'x', ts: 1 }; env.MT_ROLLEN.m.set('geld:uitbeeld:' + idn(i), { v: JSON.stringify(r), meta: r }); }
    assert.strictEqual((await roep(env, 'administratie', '/geld/uitbeeld', 'GET')).body.aantal, 9);
  });
  const leg = { revisie: 4, kredietlimiet: 1000, fictieve_buffer: 500, uitbeeld: { [idn(21)]: { reden: 'weg', door: 'Oud', ts: 7 } }, factuurschemas: { '700000000001': [{ label: 'aanbetaling', pct: 40 }, { label: 'oplevering', pct: 60 }] },
    potten: [{ id: 'spaar1', naam: 'Spaarpot', doel: 'buffer', actief: true, weekinleg: 25 }], prognose_schema: { grens_klein: 1000, grens_groot: 20000, betaaltermijn: 14, middel: [{ pct: 50, dagen: 7, label: 'aanbetaling', anker: 'akkoord' }, { pct: 50, dagen: 60, label: 'oplevering', anker: 'oplevering' }] } };
  const metConfig = () => { const env = { MT_ROLLEN: kv() }; env.MT_ROLLEN.m.set('geld:config', { v: JSON.stringify(leg), meta: null }); return env; };
  await test('factuurschema’s per klant: eigen sleutel per contact; teruglezen; geen terugval of migratie uit de config; config ongemoeid', async () => {
    const env = metConfig(), voor = env.MT_ROLLEN.m.get('geld:config').v;
    assert.deepStrictEqual((await roep(env, 'administratie', '/geld/fschemas', 'GET')).body.schemas, {});                                              // geen terugval op config.factuurschemas
    const w = await roep(env, 'eigenaar', '/geld/fschema', 'POST', { contact_id: '700000000002', rijen: [{ label: 'factuur', pct: 100 }] }); assert.strictEqual(w.status, 200, JSON.stringify(w.body));
    const g = (await roep(env, 'administratie', '/geld/fschemas', 'GET')).body.schemas; assert.deepStrictEqual(Object.keys(g), ['700000000002']);
    assert.ok(env.MT_ROLLEN.m.has('geld:fschema:700000000002') && ![...env.MT_ROLLEN.m.keys()].some(k => /migratie/.test(k)), 'geen migratievlaggen');
    await roep(env, 'eigenaar', '/geld/fschema', 'POST', { contact_id: '700000000002', rijen: null });
    assert.deepStrictEqual((await roep(env, 'administratie', '/geld/fschemas', 'GET')).body.schemas, {});
    assert.strictEqual(env.MT_ROLLEN.m.get('geld:config').v, voor, 'niets uit de config gewist');
    const [x, y] = await Promise.all([roep(env, 'eigenaar', '/geld/fschema', 'POST', { contact_id: '700000000003', rijen: [{ label: 'a', pct: 100 }] }), roep(env, 'eigenaar', '/geld/fschema', 'POST', { contact_id: '700000000004', rijen: [{ label: 'b', pct: 100 }] })]);
    assert.strictEqual(x.status + y.status, 400); assert.deepStrictEqual(Object.keys((await roep(env, 'eigenaar', '/geld/fschemas', 'GET')).body.schemas).sort(), ['700000000003', '700000000004']);
  });
  await test('factuurschema’s: ongeldig (som, label, aantal, contact-id), rechten server-side', async () => {
    const env = { MT_ROLLEN: kv() };
    for (const b of [{ contact_id: '700000000001', rijen: [{ label: 'a', pct: 40 }, { label: 'b', pct: 40 }] }, { contact_id: '700000000001', rijen: [{ label: '', pct: 100 }] }, { contact_id: '700000000001', rijen: [] },
      { contact_id: '700000000001', rijen: Array.from({ length: 7 }, (_, i) => ({ label: 'd' + i, pct: i < 6 ? 14 : 16 })) }, { contact_id: 'abc', rijen: [{ label: 'a', pct: 100 }] }, { rijen: [{ label: 'a', pct: 100 }] }, { contact_id: '700000000001' }])
      assert.strictEqual((await roep(env, 'eigenaar', '/geld/fschema', 'POST', b)).status, 400, JSON.stringify(b).slice(0, 60));
    for (const rol of ['administratie', 'beheerder', 'kantoor', 'werkplaats', 'lezen']) assert.strictEqual((await roep(env, rol, '/geld/fschema', 'POST', { contact_id: '700000000001', rijen: [{ label: 'a', pct: 100 }] })).status, 403, rol);
    assert.strictEqual((await roep(env, 'eigenaar', '/geld/fschema', 'POST', { contact_id: '700000000001', rijen: [{ label: 'a', pct: 33.33 }, { label: 'b', pct: 33.33 }, { label: 'c', pct: 33.34 }] })).status, 200);
    assert.deepStrictEqual(Object.keys((await roep(env, 'administratie', '/geld/fschemas', 'GET')).body.schemas), ['700000000001']);
  });
  await test('config-POST: velden die niet in de body staan blijven van de VERSE oude stand (potten, prognose_schema, oude Forecast-velden); ze worden niet meer door de config geschreven', async () => {
    const env = metConfig(); const g = (await roep(env, 'eigenaar', '/geld/config', 'GET')).body.config;
    const r = await roep(env, 'eigenaar', '/geld/config', 'POST', { kredietlimiet: 2500, revisie: g.revisie }); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const c = (await roep(env, 'administratie', '/geld/config', 'GET')).body.config;
    assert.strictEqual(c.kredietlimiet, 2500); assert.strictEqual(c.fictieve_buffer, 500); assert.deepStrictEqual(c.potten.map(p => [p.id, p.weekinleg]), [['spaar1', 25]]); assert.strictEqual(c.prognose_schema.middel.length, 2); assert.strictEqual(c.prognose_schema.grens_groot, 20000);
    assert.deepStrictEqual(c.uitbeeld, leg.uitbeeld); assert.deepStrictEqual(c.factuurschemas, leg.factuurschemas); assert.strictEqual(c.revisie, g.revisie + 1);
    for (const b of [{ uitbeeld: { [idn(30)]: { reden: 'weg' } } }, { factuurschemas: {} }]) { const x = await roep(env, 'eigenaar', '/geld/config', 'POST', Object.assign({ revisie: c.revisie }, b)); assert.strictEqual(x.status, 400); }
    const na = (await roep(env, 'eigenaar', '/geld/config', 'GET')).body.config; assert.deepStrictEqual(na.uitbeeld, leg.uitbeeld); assert.deepStrictEqual(na.factuurschemas, leg.factuurschemas); assert.strictEqual(na.revisie, c.revisie);
    // gelijktijdig, zelfde revisie: precies een 200 en een 409; de tweede wijziging overschrijft de eerste niet
    const env2 = metConfig(), g2 = (await roep(env2, 'eigenaar', '/geld/config', 'GET')).body.config;
    const [a, b] = await Promise.all([roep(env2, 'eigenaar', '/geld/config', 'POST', { kredietlimiet: 111, revisie: g2.revisie }), roep(env2, 'eigenaar', '/geld/config', 'POST', { fictieve_buffer: 900, revisie: g2.revisie })]);
    assert.deepStrictEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
    const nu2 = JSON.parse(env2.MT_ROLLEN.m.get('geld:config').v), winnaar = a.status === 200 ? { kredietlimiet: 111, fictieve_buffer: 500 } : { kredietlimiet: 1000, fictieve_buffer: 900 };
    assert.strictEqual(nu2.kredietlimiet, winnaar.kredietlimiet); assert.strictEqual(nu2.fictieve_buffer, winnaar.fictieve_buffer); assert.strictEqual(nu2.revisie, g2.revisie + 1);     // niet allebei, geen halve mix
    assert.strictEqual([...env2.MT_ROLLEN.m.keys()].filter(k => k.startsWith('geld:config:historie:')).length, 1, 'één historie-stand, van de stand die echt is vervangen');
    // viervoudig tegelijk: nog steeds precies één winnaar
    const env3 = metConfig(), g3 = (await roep(env3, 'eigenaar', '/geld/config', 'GET')).body.config;
    const vier = await Promise.all([1, 2, 3, 4].map(i => roep(env3, 'eigenaar', '/geld/config', 'POST', { kredietlimiet: 1000 + i, revisie: g3.revisie })));
    assert.strictEqual(vier.filter(x => x.status === 200).length, 1); assert.strictEqual(vier.filter(x => x.status === 409).length, 3);
  });
  await test('verouderde KV-lees: de DO onthoudt de laatst geschreven revisie; een oude revisie krijgt 409 en overschrijft nooit een nieuwere stand', async () => {
    const env = metConfig(), g = (await roep(env, 'eigenaar', '/geld/config', 'GET')).body.config, oudeDoc = env.MT_ROLLEN.m.get('geld:config').v;      // revisie 4
    const w1 = await roep(env, 'eigenaar', '/geld/config', 'POST', { kredietlimiet: 2000, revisie: g.revisie }); assert.strictEqual(w1.status, 200);                  // nu revisie 5, DO onthoudt 5
    const nieuweDoc = env.MT_ROLLEN.m.get('geld:config').v; assert.strictEqual(JSON.parse(nieuweDoc).revisie, g.revisie + 1);
    env.MT_ROLLEN.m.set('geld:config', { v: oudeDoc, meta: null });                                                                                              // KV geeft een VEROUDERDE stand terug (revisie 4)
    const stale = await roep(env, 'eigenaar', '/geld/config', 'POST', { fictieve_buffer: 999, revisie: g.revisie }); assert.strictEqual(stale.status, 409, JSON.stringify(stale.body));
    assert.strictEqual(env.MT_ROLLEN.m.get('geld:config').v, oudeDoc, 'er is niets geschreven door de verouderde aanvraag');
    // direct op de DO: verwacht 4 (verouderd) → 409, verwacht 5 (de echte stand) → 200 ondanks de oude KV-lees
    const doe = (body) => env.MT_TELLER.get('geldconfig').fetch('https://mt-teller/gc-schrijf', { method: 'POST', body: JSON.stringify(body) });
    const norm5 = Object.assign({}, JSON.parse(nieuweDoc), { revisie: g.revisie + 2 });
    assert.strictEqual((await doe({ verwacht: g.revisie, norm: norm5, ts: Date.now() })).status, 409);
    assert.strictEqual((await doe({ verwacht: g.revisie + 1, norm: norm5, ts: Date.now() })).status, 200);
    assert.strictEqual(JSON.parse(env.MT_ROLLEN.m.get('geld:config').v).revisie, g.revisie + 2);
    assert.strictEqual((await doe({ verwacht: g.revisie + 1, norm: norm5, ts: Date.now() })).status, 409);                                                     // de revisie is verder: nog eens dezelfde kan niet
  });
  await test('config schrijven: eerst de config, dan de historie (een falende historie verliest de config niet; geen spook-historie)', async () => {
    const env = metConfig(), g = (await roep(env, 'eigenaar', '/geld/config', 'GET')).body.config, put0 = env.MT_ROLLEN.put.bind(env.MT_ROLLEN), volgorde = [];
    env.MT_ROLLEN.put = async (k, v, o) => { volgorde.push(k.startsWith('geld:config:historie:') ? 'historie' : k); if (k.startsWith('geld:config:historie:')) throw new Error('KV historie stuk'); return put0(k, v, o); };
    const r = await roep(env, 'eigenaar', '/geld/config', 'POST', { kredietlimiet: 3000, revisie: g.revisie }); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(volgorde.indexOf('geld:config') >= 0 && volgorde.indexOf('geld:config') < volgorde.indexOf('historie'), volgorde.join());
    assert.strictEqual(JSON.parse(env.MT_ROLLEN.m.get('geld:config').v).kredietlimiet, 3000);
    assert.strictEqual([...env.MT_ROLLEN.m.keys()].filter(k => k.startsWith('geld:config:historie:')).length, 0);
  });
  await test('config-POST zonder Durable Object (of een DO die faalt): 503 en niets geschreven, nooit een terugval zonder slot', async () => {
    const env = metConfig(); env.zonderDO = true; const voor = env.MT_ROLLEN.m.get('geld:config').v;
    const r = await roep(env, 'eigenaar', '/geld/config', 'POST', { kredietlimiet: 5, revisie: 4 }); assert.strictEqual(r.status, 503); assert.strictEqual(env.MT_ROLLEN.m.get('geld:config').v, voor);
    assert.strictEqual([...env.MT_ROLLEN.m.keys()].filter(k => k.startsWith('geld:config:historie:')).length, 0);
    const env2 = metConfig(); env2.MT_TELLER = { idFromName: n => n, get: () => ({ fetch: async () => { throw new Error('DO stuk'); } }) };
    const r2 = await roep(env2, 'eigenaar', '/geld/config', 'POST', { kredietlimiet: 5, revisie: 4 }); assert.strictEqual(r2.status, 503); assert.strictEqual(env2.MT_ROLLEN.m.get('geld:config').v, voor);
    const env3 = metConfig(); env3.MT_TELLER = { idFromName: n => n, get: () => ({ fetch: async () => new Response('{"error":"kapot"}', { status: 500 }) }) };
    assert.strictEqual((await roep(env3, 'eigenaar', '/geld/config', 'POST', { kredietlimiet: 5, revisie: 4 })).status, 500);
    assert.strictEqual(env3.MT_ROLLEN.m.get('geld:config').v, voor);
    assert.strictEqual((await roep(env, 'administratie', '/geld/config', 'GET')).status, 200);       // lezen kan zonder DO gewoon
  });

  // De Forecast rekent na een opslag alleen die ene offerte lokaal opnieuw (F.lokaalPrognose). Dat moet exact dezelfde uitkomst geven als de worker.
  await test('bankdag: dezelfde uitkomst als de worker voor drie jaar aan dagen (weekend, feestdagen)', async () => {
    const F = require(path.join(__dirname, '..', 'mt-forecast.js'));
    for (let i = 0, d = '2026-01-01'; i < 3 * 366; i++, d = (x => { x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); })(new Date(d + 'T00:00:00Z'))) assert.strictEqual(F.bankdagNa(d), geldBankdagNa(d), d);
  });
  await test('lokaal herrekenen = berekening van de worker (gefactureerd, gepland, uit, betaalgedrag)', async () => {
    const F = require(path.join(__dirname, '..', 'mt-forecast.js')), vandaag = plus(0);
    const itemW = (eid, termijnen, o) => Object.assign({ soort: 'project', naam: 'Voorbeeld ' + eid, code: '', contact_id: '700000000001', estimate_id: eid, offertenr: '', totaal: termijnen.reduce((a, t) => a + t.bedrag, 0), betaaltermijn: 14, aan: true, termijnen, k: [], x: [] }, o || {});
    const fac = (id, bedrag, eid) => ({ id, contact_id: '700000000001', datum: plus(-3), bedrag, ref: '', estimate_id: eid, nummer: 'F' + id, orig: null });
    const profielMet = d => ({ klanten: { '700000000001': { d, naam: 'Voorbeeld' } }, algemeen: { n: 0 } }), cfg = { klantgroepen: [] };
    const gevallen = [
      ['niets gefactureerd', itemW('300000000011', [{ id: 't1', label: 'aanbetaling', bedrag: 500, factuurdatum: plus(10), aan: true }, { id: 't2', label: 'oplevering', bedrag: 700.5, factuurdatum: plus(45), aan: true }]), [], null],
      ['deels gefactureerd over twee termijnen', itemW('300000000012', [{ id: 't1', label: 'aanbetaling', bedrag: 500, factuurdatum: plus(-20), aan: true }, { id: 't2', label: 'oplevering', bedrag: 700, factuurdatum: plus(45), aan: true }, { id: 't3', label: 'nog niet gepland', bedrag: 300, factuurdatum: plus(60), aan: false }]), [fac('900000000001', 650, '300000000012')], null],
      ['alles uit', itemW('300000000013', [{ id: 't1', label: 'factuur', bedrag: 800, factuurdatum: plus(5), aan: true }], { aan: false }), [fac('900000000002', 100, '300000000013')], null],
      ['betaalgedrag: 6 dagen later dan de betaaltermijn', itemW('300000000014', [{ id: 't1', label: 'aanbetaling', bedrag: 400.33, factuurdatum: plus(12), aan: true }, { id: 't2', label: 'oplevering', bedrag: 600.67, factuurdatum: plus(80), aan: true }]), [fac('900000000003', 100, '300000000014')], [6, 6, 6]],
      ['factuurdatum voorbij: vandaag', itemW('300000000015', [{ id: 't1', label: 'factuur', bedrag: 250, factuurdatum: plus(-10), aan: true }]), [], null],
    ];
    for (const [naam, it, facturen, d] of gevallen) {
      const sleutel = 'p:t' + it.estimate_id, ctx = { vandaag, profiel: d ? profielMet(d) : null, cfg }, w = [];
      // de worker: eerst met het oude item (zonder onze wijziging) om het overzicht van vóór de wijziging te krijgen, dan met het nieuwe item
      const oudItem = itemW(it.estimate_id, [{ id: 't1', label: 'x', bedrag: it.totaal, factuurdatum: plus(30), aan: true }]);
      const oud = geldPrognoseEvents({ [sleutel]: oudItem }, facturen, ctx, []), oudOv = oud.overzicht[0];
      const server = geldPrognoseEvents({ [sleutel]: it }, facturen, ctx, w);
      const vert = d ? F.vertragingUit(oud.events, sleutel, oudItem) : 0;
      assert.strictEqual(vert === null ? 0 : vert, d ? d[0] : 0, naam + ': vertraging uit de vorige events');
      const lok = F.lokaalPrognose(sleutel, it, oudOv, vandaag, vert === null ? 0 : vert);
      const bank = (x) => { let dd = geldBankdagNa(x.datum); if (dd < vandaag) dd = geldBankdagNa(vandaag); return dd; };
      server.events.forEach(e => { e.datum = bank(e); e.delta = e.bedrag; });                       // wat de worker daarna met de events doet (bankdagen, delta)
      const norm = e => ({ id: e.id, bedrag: e.bedrag, delta: e.delta, datum: e.datum, factuurdatum: e.factuurdatum, ontvangst_na: e.ontvangst_na, termijn_id: e.termijn_id, tegenpartij: e.tegenpartij, richting: e.richting, prognose: e.prognose, bron: e.bron });
      assert.deepStrictEqual(lok.events.map(norm), server.events.map(norm), naam + ': events');
      const so = server.overzicht[0], nt = o => ({ gefactureerd: o.gefactureerd, totaal: o.totaal, aan: o.aan, termijnen: o.termijnen.map(t => ({ id: t.id, bedrag: t.bedrag, gefactureerd: t.gefactureerd, open: t.open, aan: t.aan, factuurdatum: t.factuurdatum })) });
      assert.deepStrictEqual(nt(lok.ov), nt(so), naam + ': overzicht (gefactureerd/open per termijn)');
    }
  });
  console.log(`\n${n} worker-tests geslaagd${process.exitCode ? ' — er zijn fouten' : ''}`);
})();
