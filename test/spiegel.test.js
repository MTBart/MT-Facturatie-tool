// Tests zendkant van de spiegel: mt-spiegel.js (debounce, rechten, retries, hydrate) en de hook in mt-core.js makeSP.
// Draaien: node test/spiegel.test.js  — verzonnen gegevens.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');

let n = 0; const test = async (naam, fn) => { try { await fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };
const laad = bestand => { const win = { setTimeout, clearTimeout, console, JSON, Date, Promise, atob: s => Buffer.from(s, 'base64').toString('binary') }; win.window = win; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', bestand), 'utf8'), win); return win; };
const MTSpiegel = laad('mt-spiegel.js').MTSpiegel;

// Nagebootste klok en timers: tijd gaat alleen vooruit als de test dat zegt.
const klok = () => {
  let t = 10_000_000, id = 0; const timers = new Map();
  return { nu: () => t, zetTimer: (f, ms) => { const h = ++id; timers.set(h, { f, op: t + ms }); return h; }, wisTimer: h => timers.delete(h), aantal: () => timers.size,
    async vooruit(ms) { const eind = t + ms; for (;;) { const volgende = [...timers.entries()].filter(([, x]) => x.op <= eind).sort((a, b) => a[1].op - b[1].op)[0]; if (!volgende) break; timers.delete(volgende[0]); t = Math.max(t, volgende[1].op); volgende[1].f(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); } t = eind; await new Promise(r => setImmediate(r)); } };
};
const maakInst = (opt = {}) => {
  const k = klok(), calls = [], rechten = Object.assign({ projecten: 'wijzigen', offertes: 'wijzigen', geld: null, verbeterpunten: 'alles' }, opt.rechten);
  let aan = opt.aan !== false, status = opt.status || 200, token = opt.token !== false, indexAntwoord = opt.index || { stores: {} };
  const inst = MTSpiegel.maak({ worker: 'https://w.test/', nu: k.nu, zetTimer: k.zetTimer, wisTimer: k.wisTimer,
    fetch: async (u, i) => { calls.push({ u, i }); if (/\/spiegel\/_index$/.test(u)) return { ok: true, status: 200, json: async () => indexAntwoord }; const s = typeof status === 'function' ? status(calls.length) : status; return { ok: s >= 200 && s < 300, status: s, json: async () => ({}) }; },
    auth: async () => (token ? { 'X-Auth-Token': 't' } : {}), recht: kol => rechten[kol], aan: () => aan });
  return { inst, k, calls, zet: o => { if ('aan' in o) aan = o.aan; if ('status' in o) status = o.status; if ('token' in o) token = o.token; if ('index' in o) indexAntwoord = o.index; }, posts: () => calls.filter(c => c.i && c.i.method === 'POST').map(c => ({ store: decodeURIComponent(c.u.split('/spiegel/')[1]), body: JSON.parse(c.i.body), i: c.i })) };
};

(async () => {
  await test('zend: eerst na 3 s, daarna hooguit eens per 5 minuten per store; de laatste stand wint', async () => {
    const t = maakInst();
    assert.strictEqual(t.inst.zend('mt_projecten.json', '{"a":1}', '"e1"'), true);
    await t.k.vooruit(2000); assert.strictEqual(t.posts().length, 0);
    t.inst.zend('mt_projecten.json', '{"a":2}', '"e2"');                 // samenvoegen met de wachtende
    await t.k.vooruit(1500);
    let p = t.posts(); assert.strictEqual(p.length, 1); assert.strictEqual(p[0].store, 'mt_projecten'); assert.deepStrictEqual(p[0].body.data, { a: 2 }); assert.strictEqual(p[0].body.etag, '"e2"'); assert.ok(Number.isInteger(p[0].body.ts));
    assert.strictEqual(p[0].i.headers['X-Auth-Token'], 't'); assert.strictEqual(p[0].i.method, 'POST'); assert.ok(!p[0].i.keepalive);
    t.inst.zend('mt_projecten.json', '{"a":3}', '"e3"'); t.inst.zend('mt_projecten.json', '{"a":4}', '"e4"');
    await t.k.vooruit(4 * 60 * 1000); assert.strictEqual(t.posts().length, 1, 'binnen 5 minuten niets nieuws');
    await t.k.vooruit(61 * 1000); p = t.posts(); assert.strictEqual(p.length, 2); assert.deepStrictEqual(p[1].body.data, { a: 4 });
    t.inst.zend('mt_planning.json', '{"x":1}', null); await t.k.vooruit(3100);       // andere store loopt los van de eerste
    assert.strictEqual(t.posts().length, 3); assert.strictEqual(t.posts()[2].store, 'mt_planning');
  });

  await test('zend: alleen met schrijfrecht, alleen laag 1, nooit als meekijker of zonder rol', async () => {
    const t = maakInst({ rechten: { projecten: 'lezen', offertes: 'wijzigen', geld: null, verbeterpunten: 'lezen' } });
    assert.strictEqual(t.inst.zend('mt_projecten.json', '{}', null), false, 'projecten alleen lezen');
    assert.strictEqual(t.inst.zend('mt_uurtarieven.json', '{}', null), false, 'geen geld-recht');
    assert.strictEqual(t.inst.zend('mt_feedback.json', '[]', null), false, 'verbeterpunten alleen lezen');
    assert.strictEqual(t.inst.zend('mt_calc_offertes.json', '[]', null), true);
    for (const f of ['mt_mail_links.json', 'mt_contacten.json', 'mt_adminconfig.json', 'mt_voorraad.json', 'onbekend.json']) assert.strictEqual(t.inst.zend(f, '{}', null), false, f);
    t.zet({ aan: false });                                                              // meekijker of rol nog onbekend
    assert.strictEqual(t.inst.zend('mt_calc_offertes.json', '[]', null), false);
    await t.k.vooruit(10000); const p = t.posts(); assert.ok(p.length <= 1);
    const m = maakInst({ aan: false }); m.inst.zend('mt_projecten.json', '{}', null); await m.k.vooruit(60000); assert.strictEqual(m.calls.length, 0, 'geen enkel netwerkverzoek');
    // het recht verdwijnt tussen zenden en versturen: er gaat niets weg
    const r = maakInst(); r.inst.zend('mt_projecten.json', '{}', null); r.zet({ aan: false }); await r.k.vooruit(4000); assert.strictEqual(r.calls.length, 0);
  });

  await test('flushAlles (verbergen/sluiten): wat wacht gaat meteen weg, met keepalive als het klein is', async () => {
    const t = maakInst();
    t.inst.zend('mt_projecten.json', '{"k":1}', '"x"'); t.inst.zend('mt_calc_offertes.json', JSON.stringify({ groot: 'x'.repeat(70000) }), '"y"');
    await t.inst.flushAlles();
    const p = t.posts(); assert.strictEqual(p.length, 2);
    assert.strictEqual(p.find(x => x.store === 'mt_projecten').i.keepalive, true); assert.strictEqual(p.find(x => x.store === 'mt_calc_offertes').i.keepalive, false, 'te groot voor keepalive');
    await t.k.vooruit(60000); assert.strictEqual(t.posts().length, 2, 'geen dubbele zending achteraf');
  });

  await test('fouten: 409/403/413 niet opnieuw; 500, netwerk en ontbrekend token wel (later); kapotte tekst valt weg', async () => {
    let t = maakInst({ status: 409 }); t.inst.zend('mt_projecten.json', '{}', null); await t.k.vooruit(4000); await t.k.vooruit(11 * 60 * 1000);
    assert.strictEqual(t.posts().length, 1, '409: een nieuwere kopie ging voor'); assert.strictEqual(t.inst.stats.geweigerd, 1);
    t = maakInst({ status: 500 }); t.inst.zend('mt_projecten.json', '{"a":1}', null); await t.k.vooruit(4000); assert.strictEqual(t.posts().length, 1);
    t.zet({ status: 200 }); await t.k.vooruit(5 * 60 * 1000 + 1000); assert.strictEqual(t.posts().length, 2, 'na 5 minuten opnieuw'); assert.deepStrictEqual(t.posts()[1].body.data, { a: 1 });
    t = maakInst({ token: false }); t.inst.zend('mt_projecten.json', '{}', null); await t.k.vooruit(4000); assert.strictEqual(t.calls.length, 0);
    t.zet({ token: true }); await t.k.vooruit(5 * 60 * 1000 + 1000); assert.strictEqual(t.posts().length, 1);
    t = maakInst(); t.inst.zend('mt_projecten.json', 'geen json{', null); await t.k.vooruit(4000); assert.strictEqual(t.calls.length, 0); assert.strictEqual(t.inst.stats.mislukt, 1);
    t.inst.zend('mt_projecten.json', '"tekst"', null); await t.k.vooruit(6 * 60 * 1000); assert.strictEqual(t.calls.length, 0, 'data moet een object of lijst zijn');
    // een nieuwere stand tijdens een mislukte zending wordt niet door de oude overschreven
    t = maakInst({ status: n => (n === 1 ? 500 : 200) }); t.inst.zend('mt_projecten.json', '{"v":1}', null); await t.k.vooruit(3100);
    t.inst.zend('mt_projecten.json', '{"v":2}', null); await t.k.vooruit(5 * 60 * 1000 + 1000);
    assert.deepStrictEqual(t.posts().pop().body.data, { v: 2 });
  });

  await test('naHydrate: alleen wat achterloopt of ontbreekt; verse index = niets; ts = leestijd; fallback-read hooguit eens per dag', async () => {
    const pref = new Map([['mt_projecten.json', { ok: true, status: 200, data: { P: 1 } }], ['mt_planning.json', { ok: true, status: 200, data: { Q: 1 } }], ['mt_calc_offertes.json', { ok: true, status: 404, data: null }], ['mt_offerte_keuze.json', { ok: false, status: 0, data: null }]]);
    const etags = { 'mt_projecten.json': '"gelijk"', 'mt_planning.json': '"nieuw"' };
    const lees = async f => (f === 'mt_verlof.json' ? { data: [1], etag: '"v"' } : null);
    const t = maakInst({ index: { stores: { mt_projecten: { ts: 5, etag: '"gelijk"' }, mt_planning: { ts: 5, etag: '"oud"' }, mt_vrijedagen: { ts: 10_000_000 - 3600e3, etag: 'x' } } } });
    const res = await t.inst.naHydrate(pref, etags, lees); await t.k.vooruit(60000);
    const p = t.posts().map(x => x.store).sort();
    assert.ok(p.includes('mt_planning'), 'andere etag'); assert.ok(!p.includes('mt_projecten'), 'zelfde etag'); assert.ok(!p.includes('mt_calc_offertes'), '404 in SharePoint'); assert.ok(!p.includes('mt_offerte_keuze'), 'leesfout');
    assert.ok(p.includes('mt_verlof'), 'ontbreekt in de spiegel en niet in de listing: los gelezen'); assert.ok(!p.includes('mt_vrijedagen'), 'spiegel is minder dan een dag oud');
    assert.strictEqual(t.posts().find(x => x.store === 'mt_verlof').body.etag, '"v"'); assert.strictEqual(t.posts().find(x => x.store === 'mt_planning').body.ts, 10_000_000, 'ts = moment van lezen');
    assert.ok(res.gezonden.length >= 2);
    // te snel opnieuw: overgeslagen
    assert.strictEqual((await t.inst.naHydrate(pref, etags, lees)).overgeslagen, true);
    // geen index (worker onbereikbaar) of geen schrijfrecht of meekijker: niets, en later opnieuw proberen
    const x = maakInst({ index: null }); x.zet({ index: { stores: null } }); assert.strictEqual((await x.inst.naHydrate(pref, etags, lees)).index, false);
    const y = maakInst({ aan: false }); assert.strictEqual((await y.inst.naHydrate(pref, etags, lees)).overgeslagen, true); assert.strictEqual(y.calls.length, 0);
    const z = maakInst({ rechten: { projecten: 'lezen', offertes: null, geld: null, verbeterpunten: null } }); await z.inst.naHydrate(pref, etags, lees); await z.k.vooruit(60000); assert.strictEqual(z.posts().length, 0);
  });

  await test('onthoudHydrate wacht op de rol en voert dan eenmalig uit', async () => {
    const t = maakInst({ aan: false, index: { stores: {} } });
    const pref = new Map([['mt_projecten.json', { ok: true, status: 200, data: { P: 1 } }]]);
    await t.inst.onthoudHydrate(pref, { 'mt_projecten.json': '"e"' }, null); assert.strictEqual(t.calls.length, 0, 'rol nog onbekend');
    t.zet({ aan: true }); await t.inst.probeer(); await t.k.vooruit(5000); assert.strictEqual(t.posts().length, 1);
    await t.inst.probeer(); await t.k.vooruit(5000); assert.strictEqual(t.posts().length, 1, 'niet nog eens');
  });

  // ── hook in mt-core.js makeSP ────────────────────────────────────────────────────────────────────────────────────────────────
  const maakSP = (cfg, fetchFn) => { const w = laad('mt-core.js'); w.fetch = fetchFn; w.getGraphToken = async () => 'tok'; const SP = w.MTCore.makeSP(cfg); SP.SITE_ID = 'site'; return SP; };
  const antw = (status, et) => ({ ok: status >= 200 && status < 300, status, headers: { get: k => (/etag/i.test(k) ? et || null : null) }, json: async () => ({}) });

  await test('makeSP: naGeslaagd na een geslaagde write (met etag), maakAan en 412-merge; niet bij een fout; een falende hook hindert niets', async () => {
    const meldingen = []; const hook = (f, t, e) => meldingen.push({ f, t, e });
    let SP = maakSP({ naGeslaagd: hook }, async () => antw(200, '"E1"'));
    assert.strictEqual(await SP.write('mt_planning.json', { a: 1 }), true);
    assert.deepStrictEqual(meldingen, [{ f: 'mt_planning.json', t: '{"a":1}', e: '"E1"' }]);
    assert.strictEqual(await SP.write('mt_planning.json', '{"b":2}'), true); assert.strictEqual(meldingen[1].t, '{"b":2}');
    assert.strictEqual(await SP.maakAan('mt_nieuw.json', { c: 3 }), 'aangemaakt'); assert.deepStrictEqual(meldingen[2], { f: 'mt_nieuw.json', t: '{"c":3}', e: '"E1"' });
    // fout: geen melding
    SP = maakSP({ naGeslaagd: hook }, async () => antw(500)); const voor = meldingen.length;
    assert.strictEqual(await SP.write('mt_planning.json', { a: 1 }), false); assert.strictEqual(await SP.maakAan('mt_x.json', {}), false); assert.strictEqual(meldingen.length, voor);
    // 412 -> lezen -> samenvoegen -> schrijven: de samengevoegde stand wordt gemeld
    let stap = 0; SP = maakSP({ naGeslaagd: hook }, async (u, i) => { stap++; if (i && i.method === 'PUT') return stap === 1 ? antw(412) : antw(200, '"E2"'); return Object.assign(antw(200, '"E0"'), { json: async () => [{ id: 1, v: 'remote' }] }); });
    SP._etags['m.json'] = '"E0"';
    assert.strictEqual(await SP.write('m.json', [{ id: 2, v: 'lokaal' }]), true);
    const laatste = meldingen[meldingen.length - 1]; assert.strictEqual(laatste.f, 'm.json'); assert.deepStrictEqual(JSON.parse(laatste.t).map(x => x.id).sort(), [1, 2]); assert.strictEqual(laatste.e, '"E2"');
    // hook die gooit
    SP = maakSP({ naGeslaagd: () => { throw new Error('boem'); } }, async () => antw(200, '"E"')); assert.strictEqual(await SP.write('x.json', {}), true);
    // geen hook (mobiel): onveranderd
    SP = maakSP({}, async () => antw(200, '"E"')); assert.strictEqual(await SP.write('x.json', {}), true);
    // de hook ziet niets van het lezen: read/prefetch roepen hem niet aan
    SP = maakSP({ naGeslaagd: hook }, async () => Object.assign(antw(200, '"R"'), { json: async () => ({}) })); const m0 = meldingen.length; await SP.read('mt_planning.json'); assert.strictEqual(meldingen.length, m0);
  });

  console.log(`\n${n} tests geslaagd`);
})();
