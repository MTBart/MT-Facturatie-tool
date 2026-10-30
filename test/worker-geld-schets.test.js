// Worker-tests voor /geld/schets (Forecast light): rechten, 409 bij een tussentijdse wijziging, historie, geen invloed op de prognose.
// Draaien: node test/worker-geld-schets.test.js  — verzonnen ids en namen.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const { pathToFileURL } = require('url');

(async () => {
  const bron = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8') + '\nexport { handleGeld };\n';
  const tmp = path.join(os.tmpdir(), `mt-worker-schets-${process.pid}.mjs`); fs.writeFileSync(tmp, bron, 'utf8');
  let handleGeld, MtTeller; try { ({ handleGeld, MtTeller } = await import(pathToFileURL(tmp).href)); } finally { try { fs.unlinkSync(tmp); } catch { } }

  const kv = () => { const m = new Map(); return { m, async get(k) { return m.has(k) ? m.get(k).v : null; }, async put(k, v, o) { m.set(k, { v, meta: (o && o.metadata) || null }); }, async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix || '')).sort().map(name => ({ name, metadata: m.get(name).meta })), list_complete: true }; } }; };
  const json0 = (b, s) => ({ status: s || 200, body: b });
  // DO-opslag zoals Cloudflare: get/put (ook een object), delete, list({prefix, reverse, limit}) → Map gesorteerd op sleutel; waarden worden gekopieerd.
  const fakeState = () => { let ketting = Promise.resolve(); const opslag = new Map(), kopie = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    return { opslag, storage: { async get(k) { return kopie(opslag.get(k)); }, async put(k, v) { if (typeof k === 'object') { for (const [a, b] of Object.entries(k)) opslag.set(a, kopie(b)); } else opslag.set(k, kopie(v)); },
      async delete(k) { return opslag.delete(k); },
      async list(o) { o = o || {}; let ks = [...opslag.keys()].filter(k => k.startsWith(o.prefix || '')).sort(); if (o.reverse) ks.reverse(); if (o.limit) ks = ks.slice(0, o.limit); return new Map(ks.map(k => [k, kopie(opslag.get(k))])); } },
      async blockConcurrencyWhile(fn) { const vorige = ketting; let los; ketting = new Promise(r => { los = r; }); await vorige; try { return await fn(); } finally { los(); } } }; };
  const maakNs = env => { const dos = {}; return { dos, idFromName: n => n, get: id => { if (!dos[id]) { dos[id] = new MtTeller(fakeState(), env); } return { fetch: (url, init) => dos[id].fetch(new Request(url, init)) }; } }; };
  const roep = async (env, rol, pad, methode, body) => {
    if (!env.MT_TELLER && !env.zonderDO) env.MT_TELLER = maakNs(env);
    const req = { method: methode, url: 'https://x.test' + pad, json: async () => body || {} };
    return handleGeld(pad.split('?')[0], req, env, { rol, oid: 'oid-' + rol, email: rol + '@voorbeeld.test', rec: { naam: rol === 'eigenaar' ? 'Eigenaar A' : 'Test' } }, json0);
  };
  const E = '300000000001';
  let n = 0; const test = async (naam, fn) => { try { await fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };

  await test('eigenaar zet, wijzigt en wist een vakje; lezen geeft de stand terug', async () => {
    const env = { MT_ROLLEN: kv() };
    let r = await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, ym: '2026-11', bedrag: 500000, oud: null, naam: 'Klant — Keuken', nummer: '2026-100' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.item.cellen['2026-11'], 500000); assert.strictEqual(r.body.item.door, 'Eigenaar A'); assert.strictEqual(r.body.item.naam, 'Klant — Keuken');
    r = await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, ym: '2026-11', bedrag: 250050, oud: 500000 }); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.item.cellen['2026-11'], 250050);
    r = await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, ym: '2026-12', bedrag: -1000, oud: null }); assert.strictEqual(r.status, 200, 'negatief (creditnota) mag');
    r = await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, ym: '2026-11', bedrag: null, oud: 250050 }); assert.strictEqual(r.status, 200); assert.ok(!('2026-11' in r.body.item.cellen));
    const l = await roep(env, 'eigenaar', '/geld/schets', 'GET'); assert.strictEqual(l.status, 200); assert.deepStrictEqual(l.body.items[E].cellen, { '2026-12': -1000 }); assert.strictEqual(l.body.items[E].naam, 'Klant — Keuken');
  });
  await test('verouderde "oud" geeft 409 met de huidige waarde en schrijft niets', async () => {
    const env = { MT_ROLLEN: kv() };
    await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, ym: '2026-11', bedrag: 100, oud: null });
    const r = await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, ym: '2026-11', bedrag: 999, oud: null });
    assert.strictEqual(r.status, 409); assert.strictEqual(r.body.huidig, 100);
    const r2 = await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, ym: '2026-11', bedrag: null, oud: 5 }); assert.strictEqual(r2.status, 409, 'wissen met verkeerde oud ook niet');
    const l = await roep(env, 'eigenaar', '/geld/schets', 'GET'); assert.strictEqual(l.body.items[E].cellen['2026-11'], 100);
  });
  await test('gelijktijdige schrijfacties op verschillende maanden van dezelfde offerte gaan geen van beide verloren', async () => {
    const env = { MT_ROLLEN: kv() };
    await Promise.all(['2026-11', '2026-12', '2027-01', '2027-02'].map((ym, i) => roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, ym, bedrag: (i + 1) * 100, oud: null })));
    const l = await roep(env, 'eigenaar', '/geld/schets', 'GET'); assert.deepStrictEqual(l.body.items[E].cellen, { '2026-11': 100, '2026-12': 200, '2027-01': 300, '2027-02': 400 });
  });
  await test('gaat zeker door: eigen vlag, los van de vakjes', async () => {
    const env = { MT_ROLLEN: kv() };
    let r = await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, zeker: true, oud: null }); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.item.zeker, true);
    r = await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, zeker: false, oud: true }); assert.strictEqual(r.body.item.zeker, false);
    r = await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, zeker: true, oud: true }); assert.strictEqual(r.status, 409, 'verouderde stand: 409'); assert.strictEqual(r.body.huidig, false);
    r = await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, zeker: true }); assert.strictEqual(r.status, 400, 'zonder oud');
    r = await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, zeker: 'ja', oud: null }); assert.strictEqual(r.status, 400);
    r = await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, ym: '2026-11', bedrag: 1, oud: null, zeker: true }); assert.strictEqual(r.status, 400, 'niet allebei');
  });
  await test('historie: elke wijziging staat erin, nieuwste eerst, ook gewiste bedragen', async () => {
    const env = { MT_ROLLEN: kv() };
    await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, ym: '2026-11', bedrag: 700, oud: null });
    await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, ym: '2026-11', bedrag: null, oud: 700 });
    await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: '300000000002', ym: '2026-11', bedrag: 5, oud: null });
    const h = await roep(env, 'administratie', '/geld/schets?historie=1&eid=300000000001', 'GET'); assert.strictEqual(h.status, 200);
    assert.deepStrictEqual(h.body.historie.map(x => [x.oud, x.nieuw]), [[700, null], [null, 700]]);
    const alle = await roep(env, 'eigenaar', '/geld/schets?historie=1', 'GET'); assert.strictEqual(alle.body.historie.length, 3);
  });
  await test('ongeldige invoer → 400, niets opgeslagen', async () => {
    const env = { MT_ROLLEN: kv() };
    for (const b of [{ eid: 'abc', ym: '2026-11', bedrag: 1, oud: null }, { eid: E, ym: '2026-13', bedrag: 1, oud: null }, { eid: E, ym: '2026-11', bedrag: 1.5, oud: null }, { eid: E, ym: '2026-11', bedrag: 1 },
      { eid: E, ym: '2026-11', oud: null }, { eid: E, ym: '2026-11', bedrag: 1e12, oud: null }, { eid: E }]) {
      const r = await roep(env, 'eigenaar', '/geld/schets', 'POST', b); assert.strictEqual(r.status, 400, JSON.stringify(b));
    }
    const l = await roep(env, 'eigenaar', '/geld/schets', 'GET'); assert.deepStrictEqual(l.body.items, {});
  });
  await test('rechten: administratie mag lezen maar niet schrijven; zonder geld-recht geen toegang', async () => {
    const env = { MT_ROLLEN: kv() };
    const w = await roep(env, 'administratie', '/geld/schets', 'POST', { eid: E, ym: '2026-11', bedrag: 1, oud: null }); assert.strictEqual(w.status, 403); assert.strictEqual(w.body.reden, 'geld-wijzigen');
    assert.strictEqual((await roep(env, 'administratie', '/geld/schets', 'GET')).status, 200);
    for (const rol of ['beheerder', 'kantoor', 'werkplaats', 'lezen']) assert.strictEqual((await roep(env, rol, '/geld/schets', 'GET')).status, 403, rol);
  });
  await test('zonder Durable Object: 503, nooit schrijven zonder slot', async () => {
    const env = { MT_ROLLEN: kv(), zonderDO: true };
    const r = await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, ym: '2026-11', bedrag: 1, oud: null }); assert.strictEqual(r.status, 503);
  });
  await test('de schets raakt de prognose en de KV niet', async () => {
    const env = { MT_ROLLEN: kv() };
    await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, ym: '2026-11', bedrag: 100, oud: null });
    await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, zeker: true, oud: null });
    assert.strictEqual(env.MT_ROLLEN.m.size, 0, 'niets in KV (ook geen audit)');
    const p = await roep(env, 'eigenaar', '/geld/prognose', 'GET'); assert.strictEqual(p.status, 200); assert.deepStrictEqual(Object.keys(p.body.items || {}), []);
  });
  await test('hetzelfde bedrag opnieuw = geen nieuwe historieregel', async () => {
    const env = { MT_ROLLEN: kv() };
    await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, ym: '2026-11', bedrag: 100, oud: null });
    const r = await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, ym: '2026-11', bedrag: 100, oud: 100 }); assert.strictEqual(r.body.ongewijzigd, true);
    const h = await roep(env, 'eigenaar', '/geld/schets?historie=1', 'GET'); assert.strictEqual(h.body.historie.length, 1);
  });
  await test('import uit de uitgebreide forecast: geplande termijnen per maand, nooit overschrijven, maar één keer', async () => {
    const env = { MT_ROLLEN: kv() };
    const zet = (k, v) => env.MT_ROLLEN.m.set('geld:prognose:' + k, { v: JSON.stringify(v), meta: v });
    zet('p:abc', { naam: 'Klant — Kast', estimate_id: E, offertenr: '2026-1', totaal: 1000, aan: true, ts: 5, termijnen: [{ id: 't1', bedrag: 300.5, factuurdatum: '2026-11-03', aan: true }, { id: 't2', bedrag: 200, factuurdatum: '2026-11-20', aan: true }, { id: 't3', bedrag: 499.5, factuurdatum: '2026-12-01', aan: false }] });
    zet('p:e300000000002', { naam: 'Uit', estimate_id: '300000000002', totaal: 50, aan: false, ts: 1, termijnen: [{ id: 't1', bedrag: 50, factuurdatum: '2027-01-10', aan: true }] });
    zet('p:dubbel', { naam: 'Dubbel oud', estimate_id: '300000000002', totaal: 50, aan: false, ts: 0, termijnen: [{ id: 't1', bedrag: 7, factuurdatum: '2027-02-10', aan: true }] });
    zet('p:zonder', { naam: 'Zonder offerte', totaal: 10, aan: true, termijnen: [{ id: 't1', bedrag: 10, factuurdatum: '2026-11-01', aan: true }] });
    zet('h:abcd1234', { soort: 'post', omschrijving: 'machine', bedrag: 100, datum: '2026-11-01' });
    await roep(env, 'eigenaar', '/geld/schets', 'POST', { eid: E, ym: '2026-11', bedrag: 1, oud: null });   // al ingevuld in de light: blijft staan
    const voor = JSON.stringify([...env.MT_ROLLEN.m.entries()]);
    const r = await roep(env, 'eigenaar', '/geld/schets/import', 'POST', {}); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.import.zonder_offerte, 1); assert.strictEqual(r.body.import.overgeslagen, 1);
    const l = await roep(env, 'eigenaar', '/geld/schets', 'GET');
    assert.deepStrictEqual(l.body.items[E].cellen, { '2026-11': 1 }, 'bestaand bedrag niet overschreven; niet-geplande rest niet overgenomen');
    assert.deepStrictEqual(l.body.items['300000000002'].cellen, { '2027-01': 5000 }, 'van dubbele items het nieuwste');
    assert.strictEqual(l.body.items['300000000002'].zeker, false); assert.strictEqual(l.body.items['300000000002'].naam, 'Uit');
    assert.ok(l.body.import && l.body.import.ts);
    assert.strictEqual(JSON.stringify([...env.MT_ROLLEN.m.entries()]), voor, 'de prognose (KV) is alleen gelezen');
    const r2 = await roep(env, 'eigenaar', '/geld/schets/import', 'POST', {}); assert.strictEqual(r2.body.al, true, 'tweede keer: niets');
    const a = await roep(env, 'administratie', '/geld/schets/import', 'POST', {}); assert.strictEqual(a.status, 403);
  });
  await test('import zonder eerdere schets: optellen per maand', async () => {
    const env = { MT_ROLLEN: kv() };
    env.MT_ROLLEN.m.set('geld:prognose:p:x', { v: '', meta: { naam: 'X', estimate_id: E, totaal: 1000, aan: true, termijnen: [{ id: 't1', bedrag: 300.5, factuurdatum: '2026-11-03', aan: true }, { id: 't2', bedrag: 200, factuurdatum: '2026-11-20', aan: true }] } });
    const r = await roep(env, 'eigenaar', '/geld/schets/import', 'POST', {}); assert.strictEqual(r.body.import.vakjes, 1);
    const l = await roep(env, 'eigenaar', '/geld/schets', 'GET'); assert.deepStrictEqual(l.body.items[E].cellen, { '2026-11': 50050 }); assert.strictEqual(l.body.items[E].zeker, true);
  });
  await test('kasindeling: startindeling uit KV zolang er niets is opgeslagen; ongeldig = geen', async () => {
    const env = { MT_ROLLEN: kv() };
    assert.strictEqual((await roep(env, 'eigenaar', '/geld/schets', 'GET')).body.kas_start, null);
    await env.MT_ROLLEN.put('geld:kas:start', { posten: [{ id: 'startx', groep: 'vast', naam: 'Start', richting: 'uit', bedragC: 100, van: '2026-11', lev: 'n:x', loon: 'ilona' }] });
    let r = await roep(env, 'administratie', '/geld/schets?kas=1', 'GET'); assert.strictEqual(r.body.kas, null); assert.strictEqual(r.body.kas_start.posten[0].loon, 'ilona');
    assert.strictEqual((await roep(env, 'eigenaar', '/geld/schets', 'GET')).body.kas_start.posten[0].id, 'startx');
    r = await roep(env, 'eigenaar', '/geld/schets/kas', 'POST', { kas: { posten: [] }, oud_ts: null }); assert.strictEqual(r.status, 200);
    assert.ok(!('kas_start' in (await roep(env, 'eigenaar', '/geld/schets?kas=1', 'GET')).body), 'na opslaan geen startindeling meer');
    const env2 = { MT_ROLLEN: kv() }; await env2.MT_ROLLEN.put('geld:kas:start', { posten: [{ id: 'x', groep: 'raar' }] });
    assert.strictEqual((await roep(env2, 'eigenaar', '/geld/schets?kas=1', 'GET')).body.kas_start, null);
  });
  await test('kasindeling: opslaan, 409 bij een verouderde stand, historie, lezer mag niet', async () => {
    const env = { MT_ROLLEN: kv() };
    const kas = { indeling: { 'p:pabc123': 'vast', 'n:leverancier b.v.': 'open' }, loon: { 'p:pabc123': 'bart' }, posten: [{ id: 'post1', groep: 'patroon', naam: 'Verhuur werkplaats', richting: 'in', bedragC: 50000, van: '2026-11', tot: null }, { id: 'post2', groep: 'vast', naam: 'Vattenfall', richting: 'uit', bedragC: 143961, van: '2026-11', tot: null, lev: 'n:vattenfall klantenservice n.v.' }, { id: 'post3', groep: 'vast', naam: 'Loon Ilona', richting: 'uit', bedragC: 100000, van: '2026-11', tot: null, loon: 'ilona' }] };
    let r = await roep(env, 'eigenaar', '/geld/schets/kas', 'POST', { kas, oud_ts: null }); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const ts = r.body.kas.ts; assert.strictEqual(r.body.kas.door, 'Eigenaar A'); assert.strictEqual(r.body.kas.posten[0].bedragC, 50000); assert.strictEqual(r.body.kas.posten[1].lev, 'n:vattenfall klantenservice n.v.'); assert.strictEqual(r.body.kas.posten[2].loon, 'ilona'); assert.ok(!('lev' in r.body.kas.posten[0]));
    r = await roep(env, 'eigenaar', '/geld/schets/kas', 'POST', { kas: { indeling: {} }, oud_ts: null }); assert.strictEqual(r.status, 409, 'verouderd: 409'); assert.strictEqual(r.body.huidig.ts, ts);
    r = await roep(env, 'eigenaar', '/geld/schets/kas', 'POST', { kas: { indeling: { 'p:pabc123': 'patroon' } }, oud_ts: ts }); assert.strictEqual(r.status, 200); assert.ok(r.body.kas.ts > ts);
    const l = await roep(env, 'administratie', '/geld/schets?kas=1', 'GET'); assert.strictEqual(l.status, 200); assert.strictEqual(l.body.kas.indeling['p:pabc123'], 'patroon');
    const g = await roep(env, 'eigenaar', '/geld/schets', 'GET'); assert.strictEqual(g.body.kas.indeling['p:pabc123'], 'patroon'); assert.ok(!('cfg' in g.body.items), 'niet tussen de offertes');
    const h = await roep(env, 'eigenaar', '/geld/schets?historie=1', 'GET'); assert.strictEqual(h.body.historie.length, 2); assert.strictEqual(h.body.historie[0].oud.indeling['p:pabc123'], 'vast', 'vorige versie bewaard');
    r = await roep(env, 'administratie', '/geld/schets/kas', 'POST', { kas: { indeling: {} }, oud_ts: r.body.kas.ts }); assert.strictEqual(r.status, 403);
  });
  await test('kasindeling: ongeldige invoer → 400', async () => {
    const env = { MT_ROLLEN: kv() };
    for (const kas of [null, { indeling: { 'x:1': 'vast' } }, { indeling: { 'p:a': 'raar' } }, { loon: { 'p:a': 'iemand' } }, { posten: [{ id: 'p1', groep: 'vast', naam: 'x', richting: 'uit', bedragC: 1, van: '2026-11' }] },
      { posten: [{ id: 'post1', groep: 'open', naam: 'x', richting: 'uit', bedragC: 1, van: '2026-11' }] }, { posten: [{ id: 'post1', groep: 'vast', naam: ' ', richting: 'uit', bedragC: 1, van: '2026-11' }] },
      { posten: [{ id: 'post1', groep: 'vast', naam: 'x', richting: 'uit', bedragC: 1.5, van: '2026-11' }] }, { posten: [{ id: 'post1', groep: 'vast', naam: 'x', richting: 'uit', bedragC: 1, van: '2026-11', tot: '2026-10' }] },
      { posten: [{ id: 'post1', groep: 'vast', naam: 'x', richting: 'uit', bedragC: 1, van: '2026-11' }, { id: 'post1', groep: 'vast', naam: 'y', richting: 'uit', bedragC: 1, van: '2026-11' }] },
      { posten: [{ id: 'post1', groep: 'vast', naam: 'x', richting: 'uit', bedragC: 1, van: '2026-11', lev: 'vattenfall' }] }, { posten: [{ id: 'post1', groep: 'vast', naam: 'x', richting: 'uit', bedragC: 1, van: '2026-11', loon: 'iemand' }] }]) {
      const r = await roep(env, 'eigenaar', '/geld/schets/kas', 'POST', { kas, oud_ts: null }); assert.strictEqual(r.status, 400, JSON.stringify(kas));
    }
    const r = await roep(env, 'eigenaar', '/geld/schets/kas', 'POST', { kas: { indeling: {} } }); assert.strictEqual(r.status, 400, 'zonder oud_ts');
    const l = await roep(env, 'eigenaar', '/geld/schets?kas=1', 'GET'); assert.strictEqual(l.body.kas, null);
  });
  console.log(`\n${n} tests geslaagd${process.exitCode ? ' (met fouten)' : ''}`);
})();
