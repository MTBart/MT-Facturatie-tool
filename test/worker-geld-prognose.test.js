// Worker-tests voor /geld/prognose en de schrijfrechten van de /geld/-routes (zonder deploy: de handler wordt lokaal geladen met een
// nagebootste KV). Draaien: node test/worker-geld-prognose.test.js  — verzonnen ids en namen.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const { pathToFileURL } = require('url');

(async () => {
  const bron = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8') + '\nexport { handleGeld };\n';
  const tmp = path.join(os.tmpdir(), `mt-worker-test-${process.pid}.mjs`); fs.writeFileSync(tmp, bron, 'utf8');
  let handleGeld; try { ({ handleGeld } = await import(pathToFileURL(tmp).href)); } finally { try { fs.unlinkSync(tmp); } catch { } }

  const kv = () => { const m = new Map(); return { m, async get(k) { return m.has(k) ? m.get(k).v : null; }, async put(k, v, o) { m.set(k, { v, meta: (o && o.metadata) || null }); }, async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix || '')).sort().map(name => ({ name, metadata: m.get(name).meta })), list_complete: true }; } }; };
  const json0 = (b, s) => ({ status: s || 200, body: b });
  const roep = async (env, rol, pad, methode, body) => {
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
  console.log(`\n${n} worker-tests geslaagd${process.exitCode ? ' — er zijn fouten' : ''}`);
})();
