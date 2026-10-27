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
  await test('termijnlabel komt ongewijzigd terug uit de worker (label-roundtrip, max 24 tekens)', async () => {
    const env = { MT_ROLLEN: kv() };
    const r = await roep(env, 'eigenaar', '/geld/prognose', 'POST', { sleutel: 'p:lab', item: item('300000000031', { totaal: 3000, termijnen: [{ id: 't1', label: 'aanbetaling', bedrag: 1000, factuurdatum: plus(20), aan: true }, { id: 't2', label: 'tussentijds termijn die veel te lang is', bedrag: 2000, factuurdatum: plus(40), aan: false }] }), vorige_ts: null });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.deepStrictEqual(r.body.item.termijnen.map(t => t.label), ['aanbetaling', 'tussentijds termijn die ']);
    const lijst = await roep(env, 'eigenaar', '/geld/prognose', 'GET'); assert.strictEqual(lijst.body.items['p:lab'].termijnen[0].label, 'aanbetaling');
  });
  const schema = (x) => ({ '700000000001': x || [{ label: 'aanbetaling', pct: 50 }, { label: 'oplevering', pct: 50 }] });
  await test('factuurschema\u2019s per klant: opslaan in de geld-config, teruglezen, ook door een lezer', async () => {
    const env = { MT_ROLLEN: kv() };
    const c0 = await roep(env, 'eigenaar', '/geld/config', 'GET'); assert.strictEqual(c0.status, 200); assert.deepStrictEqual(c0.body.config.factuurschemas, {});
    const w = await roep(env, 'eigenaar', '/geld/config', 'POST', { factuurschemas: schema(), revisie: c0.body.config.revisie }); assert.strictEqual(w.status, 200, JSON.stringify(w.body));
    assert.deepStrictEqual(w.body.config.factuurschemas, schema());
    const les = await roep(env, 'administratie', '/geld/config', 'GET'); assert.deepStrictEqual(les.body.config.factuurschemas, schema());
    const nogmaals = await roep(env, 'eigenaar', '/geld/config', 'POST', { factuurschemas: schema([{ label: 'factuur', pct: 100 }]), revisie: w.body.config.revisie }); assert.strictEqual(nogmaals.status, 200);
    const leeg = await roep(env, 'eigenaar', '/geld/config', 'POST', { factuurschemas: null, revisie: nogmaals.body.config.revisie }); assert.deepStrictEqual(leeg.body.config.factuurschemas, {});
  });
  await test('factuurschema\u2019s: ongeldig wordt geweigerd (som, label, aantal, contact-id), oude revisie 409, lezer 403', async () => {
    const env = { MT_ROLLEN: kv() }; const rev = (await roep(env, 'eigenaar', '/geld/config', 'GET')).body.config.revisie;
    const slecht = [schema([{ label: 'a', pct: 40 }, { label: 'b', pct: 40 }]), schema([{ label: '', pct: 100 }]), schema([{ label: 'a', pct: 0 }, { label: 'b', pct: 100 }]), { 'abc': [{ label: 'a', pct: 100 }] },
      schema(Array.from({ length: 7 }, (_, i) => ({ label: 'd' + i, pct: i < 6 ? 14 : 16 }))), schema([]), { '700000000001': 'x' }];
    for (const s of slecht) { const r = await roep(env, 'eigenaar', '/geld/config', 'POST', { factuurschemas: s, revisie: rev }); assert.strictEqual(r.status, 400, JSON.stringify(s)); }
    assert.strictEqual((await roep(env, 'eigenaar', '/geld/config', 'POST', { factuurschemas: [], revisie: rev })).status, 400);
    assert.strictEqual((await roep(env, 'eigenaar', '/geld/config', 'POST', { factuurschemas: schema(), revisie: rev + 5 })).status, 409);
    assert.strictEqual((await roep(env, 'administratie', '/geld/config', 'POST', { factuurschemas: schema(), revisie: rev })).status, 403);
    assert.deepStrictEqual((await roep(env, 'eigenaar', '/geld/config', 'GET')).body.config.factuurschemas, {});
    const afronding = await roep(env, 'eigenaar', '/geld/config', 'POST', { factuurschemas: schema([{ label: 'a', pct: 33.33 }, { label: 'b', pct: 33.33 }, { label: 'c', pct: 33.34 }]), revisie: rev }); assert.strictEqual(afronding.status, 200);
  });  const kvPag = (per, oneindig) => { const k = kv(); k.list = async ({ prefix, cursor }) => { const alle = [...k.m.keys()].filter(x => x.startsWith(prefix || '')).sort(), van = Number(cursor || 0), stuk = alle.slice(van, van + per);
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
  });  console.log(`\n${n} worker-tests geslaagd${process.exitCode ? ' — er zijn fouten' : ''}`);
})();
