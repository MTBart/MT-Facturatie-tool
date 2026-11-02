// Tests zendkant van de spiegel: mt-spiegel.js (debounce, rechten, versie, retries, hydrate, foutregistratie) en de hooks in mt-core.js makeSP.
// Draaien: node test/spiegel.test.js  — verzonnen gegevens.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');

let n = 0; const test = async (naam, fn) => { try { await fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };
const laad = bestand => { const win = { setTimeout, clearTimeout, console, JSON, Date, Promise, atob: s => Buffer.from(s, 'base64').toString('binary') }; win.window = win; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', bestand), 'utf8'), win); return win; };
const MTSpiegel = laad('mt-spiegel.js').MTSpiegel;
const V1 = '2026-11-02T10:00:00.000Z', V2 = '2026-11-02T11:00:00.000Z', MS = iso => Date.parse(iso);

// Nagebootste klok en timers: tijd gaat alleen vooruit als de test dat zegt.
const klok = () => {
  let t = 10_000_000, id = 0; const timers = new Map();
  return { nu: () => t, zetTimer: (f, ms) => { const h = ++id; timers.set(h, { f, op: t + ms }); return h; }, wisTimer: h => timers.delete(h), aantal: () => timers.size,
    async vooruit(ms) { const eind = t + ms; for (;;) { const volgende = [...timers.entries()].filter(([, x]) => x.op <= eind).sort((a, b) => a[1].op - b[1].op)[0]; if (!volgende) break; timers.delete(volgende[0]); t = Math.max(t, volgende[1].op); volgende[1].f(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); } t = eind; await new Promise(r => setImmediate(r)); } };
};
const maakInst = (opt = {}) => {
  const k = klok(), calls = [], fouten = [], rechten = Object.assign({ projecten: 'wijzigen', offertes: 'wijzigen', geld: null, verbeterpunten: 'alles' }, opt.rechten);
  let aan = opt.aan !== false, status = opt.status || 200, token = opt.token !== false, indexAntwoord = opt.index || { stores: {} };
  const inst = MTSpiegel.maak({ worker: 'https://w.test/', nu: k.nu, zetTimer: k.zetTimer, wisTimer: k.wisTimer, logFout: (s, r) => fouten.push(s + ' ' + r),
    fetch: async (u, i) => { calls.push({ u, i }); if (/\/spiegel\/_index$/.test(u)) return { ok: true, status: 200, json: async () => indexAntwoord }; const s = typeof status === 'function' ? status(calls.length) : status; return { ok: s >= 200 && s < 300, status: s, json: async () => ({}) }; },
    auth: async () => (token ? { 'X-Auth-Token': 't' } : {}), recht: kol => rechten[kol], aan: () => aan });
  return { inst, k, calls, fouten, zet: o => { if ('aan' in o) aan = o.aan; if ('status' in o) status = o.status; if ('token' in o) token = o.token; if ('index' in o) indexAntwoord = o.index; }, posts: () => calls.filter(c => c.i && c.i.method === 'POST').map(c => ({ store: decodeURIComponent(c.u.split('/spiegel/')[1]), body: JSON.parse(c.i.body), i: c.i })) };
};

(async () => {
  await test('zend: eerst na 3 s, daarna hooguit eens per 5 minuten per store; de laatste stand wint; ts = SharePoint-versie', async () => {
    const t = maakInst();
    assert.strictEqual(t.inst.zend('mt_projecten.json', '{"a":1}', '"e1"', V1), true);
    await t.k.vooruit(2000); assert.strictEqual(t.posts().length, 0);
    t.inst.zend('mt_projecten.json', '{"a":2}', '"e2"', V2);                 // samenvoegen met de wachtende
    await t.k.vooruit(1500);
    let p = t.posts(); assert.strictEqual(p.length, 1); assert.strictEqual(p[0].store, 'mt_projecten'); assert.deepStrictEqual(p[0].body.data, { a: 2 }); assert.strictEqual(p[0].body.etag, '"e2"'); assert.strictEqual(p[0].body.ts, MS(V2), 'versie uit SharePoint, niet de klok');
    assert.strictEqual(p[0].i.headers['X-Auth-Token'], 't'); assert.strictEqual(p[0].i.method, 'POST'); assert.ok(!p[0].i.keepalive);
    t.inst.zend('mt_projecten.json', '{"a":3}', '"e3"', '2026-11-02T12:00:00Z'); t.inst.zend('mt_projecten.json', '{"a":4}', '"e4"', '2026-11-02T13:00:00Z');
    await t.k.vooruit(4 * 60 * 1000); assert.strictEqual(t.posts().length, 1, 'binnen 5 minuten niets nieuws');
    await t.k.vooruit(61 * 1000); p = t.posts(); assert.strictEqual(p.length, 2); assert.deepStrictEqual(p[1].body.data, { a: 4 }); assert.strictEqual(p[1].body.ts, MS('2026-11-02T13:00:00Z'));
    t.inst.zend('mt_planning.json', '{"x":1}', null, V1); await t.k.vooruit(3100);       // andere store loopt los van de eerste
    assert.strictEqual(t.posts().length, 3); assert.strictEqual(t.posts()[2].store, 'mt_planning');
  });

  await test('versie: zonder SharePoint-versie niet zenden (nooit de klok van deze pc); een oudere stand vervangt een wachtende nieuwere niet', async () => {
    const t = maakInst();
    for (const v of [undefined, null, '', 'geen datum', 0, NaN]) assert.strictEqual(t.inst.zend('mt_projecten.json', '{}', '"e"', v), false, String(v));
    assert.ok(t.fouten.every(f => f === 'mt_projecten geen-versie') && t.fouten.length === 6, 'elke weigering is vastgelegd');
    await t.k.vooruit(10000); assert.strictEqual(t.calls.length, 0);
    t.inst.zend('mt_projecten.json', '{"v":2}', '"b"', V2);
    assert.strictEqual(t.inst.zend('mt_projecten.json', '{"v":1}', '"a"', V1), false, 'oudere versie');
    await t.k.vooruit(4000); assert.deepStrictEqual(t.posts()[0].body.data, { v: 2 });
    t.inst.zend('mt_planning.json', '{}', null, MS(V1)); await t.k.vooruit(4000); assert.strictEqual(t.posts().pop().body.ts, MS(V1), 'ook milliseconden');
  });

  await test('zend: alleen met schrijfrecht, alleen de 13 stores, nooit als meekijker of zonder rol', async () => {
    const t = maakInst({ rechten: { projecten: 'lezen', offertes: 'wijzigen', geld: null, verbeterpunten: 'lezen' } });
    assert.strictEqual(t.inst.zend('mt_projecten.json', '{}', null, V1), false, 'projecten alleen lezen');
    assert.strictEqual(t.inst.zend('mt_uurtarieven.json', '{}', null, V1), false, 'geen geld-recht');
    assert.strictEqual(t.inst.zend('mt_feedback.json', '[]', null, V1), false, 'verbeterpunten alleen lezen');
    assert.strictEqual(t.inst.zend('mt_calc_offertes.json', '{}', null, V1), true);
    for (const f of ['mt_mail_links.json', 'mt_contacten.json', 'mt_adminconfig.json', 'mt_voorraad.json', 'onbekend.json', 'klanten-registry-vol.json', 'mt_verlof.json', 'mt_klant_codes.json', 'mt_project_controle.json', 'mt_project_sjablonen.json', 'mt_opleveringen.json', 'mt_attentie.json', 'mt_toeslag_lak.json'])
      assert.strictEqual(t.inst.zend(f, '{}', null, V1), false, f);
    assert.strictEqual(Object.keys(t.inst.STORES).length, 13);
    t.zet({ aan: false });                                                              // meekijker of rol nog onbekend
    assert.strictEqual(t.inst.zend('mt_calc_offertes.json', '{}', null, V1), false);
    await t.k.vooruit(10000); const p = t.posts(); assert.ok(p.length <= 1);
    const m = maakInst({ aan: false }); m.inst.zend('mt_projecten.json', '{}', null, V1); await m.k.vooruit(60000); assert.strictEqual(m.calls.length, 0, 'geen enkel netwerkverzoek');
    const r = maakInst(); r.inst.zend('mt_projecten.json', '{}', null, V1); r.zet({ aan: false }); await r.k.vooruit(4000); assert.strictEqual(r.calls.length, 0);
  });

  await test('flushAlles (verbergen/sluiten): wat wacht gaat meteen weg, met keepalive als het klein is', async () => {
    const t = maakInst();
    t.inst.zend('mt_projecten.json', '{"k":1}', '"x"', V1); t.inst.zend('mt_calc_offertes.json', JSON.stringify({ groot: 'x'.repeat(70000) }), '"y"', V1);
    await t.inst.flushAlles();
    const p = t.posts(); assert.strictEqual(p.length, 2);
    assert.strictEqual(p.find(x => x.store === 'mt_projecten').i.keepalive, true); assert.strictEqual(p.find(x => x.store === 'mt_calc_offertes').i.keepalive, false, 'te groot voor keepalive');
    await t.k.vooruit(60000); assert.strictEqual(t.posts().length, 2, 'geen dubbele zending achteraf');
  });

  await test('fouten: 409/403/413 niet opnieuw; 500, netwerk en ontbrekend token wel (later); alles behalve 409 wordt vastgelegd (spiegel_fout)', async () => {
    let t = maakInst({ status: 409 }); t.inst.zend('mt_projecten.json', '{}', null, V1); await t.k.vooruit(4000); await t.k.vooruit(11 * 60 * 1000);
    assert.strictEqual(t.posts().length, 1, '409: een nieuwere versie ging voor'); assert.strictEqual(t.inst.stats.geweigerd, 1); assert.deepStrictEqual(t.fouten, [], '409 is normaal');
    t = maakInst({ status: 403 }); t.inst.zend('mt_projecten.json', '{}', null, V1); await t.k.vooruit(4000); await t.k.vooruit(11 * 60 * 1000);
    assert.strictEqual(t.posts().length, 1); assert.deepStrictEqual(t.fouten, ['mt_projecten http-403']);
    t = maakInst({ status: 500 }); t.inst.zend('mt_projecten.json', '{"a":1}', null, V1); await t.k.vooruit(4000); assert.strictEqual(t.posts().length, 1); assert.deepStrictEqual(t.fouten, ['mt_projecten http-500']);
    t.zet({ status: 200 }); await t.k.vooruit(5 * 60 * 1000 + 1000); assert.strictEqual(t.posts().length, 2, 'na 5 minuten opnieuw'); assert.deepStrictEqual(t.posts()[1].body.data, { a: 1 });
    t = maakInst({ status: 429 }); t.inst.zend('mt_projecten.json', '{}', null, V1); await t.k.vooruit(4000); assert.deepStrictEqual(t.fouten, ['mt_projecten http-429']); t.zet({ status: 200 }); await t.k.vooruit(5 * 60 * 1000 + 1000); assert.strictEqual(t.posts().length, 2, 'rate-limit: later opnieuw');
    t = maakInst({ token: false }); t.inst.zend('mt_projecten.json', '{}', null, V1); await t.k.vooruit(4000); assert.strictEqual(t.calls.length, 0); assert.deepStrictEqual(t.fouten, ['mt_projecten geen-token']);
    t.zet({ token: true }); await t.k.vooruit(5 * 60 * 1000 + 1000); assert.strictEqual(t.posts().length, 1);
    t = maakInst(); t.inst.zend('mt_projecten.json', 'geen json{', null, V1); await t.k.vooruit(4000); assert.strictEqual(t.calls.length, 0); assert.strictEqual(t.inst.stats.mislukt, 1); assert.deepStrictEqual(t.fouten, ['mt_projecten tekst']);
    t.inst.zend('mt_projecten.json', '"tekst"', null, V2); await t.k.vooruit(6 * 60 * 1000); assert.strictEqual(t.calls.length, 0, 'data moet een object of lijst zijn');
    t = maakInst({ status: n => (n === 1 ? 500 : 200) }); t.inst.zend('mt_projecten.json', '{"v":1}', null, V1); await t.k.vooruit(3100);
    t.inst.zend('mt_projecten.json', '{"v":2}', null, V2); await t.k.vooruit(5 * 60 * 1000 + 1000);
    assert.deepStrictEqual(t.posts().pop().body.data, { v: 2 });
    const k = klok(), fouten = []; const w = MTSpiegel.maak({ worker: 'https://w.test', nu: k.nu, zetTimer: k.zetTimer, wisTimer: k.wisTimer, logFout: (s, r) => fouten.push(s + ' ' + r), fetch: async () => { throw new Error('offline'); }, auth: async () => ({ 'X-Auth-Token': 't' }), recht: () => 'wijzigen', aan: () => true });
    w.zend('mt_projecten.json', '{}', null, V1); await k.vooruit(4000); assert.deepStrictEqual(fouten, ['mt_projecten netwerk']);
  });

  await test('naHydrate: alleen wat achterloopt of ontbreekt; versie uit de listing; fallback-read mét versie hooguit eens per dag', async () => {
    const pref = new Map([['mt_projecten.json', { ok: true, status: 200, data: { P: 1 } }], ['mt_planning.json', { ok: true, status: 200, data: { Q: 1 } }], ['mt_calc_offertes.json', { ok: true, status: 404, data: null }], ['mt_offerte_keuze.json', { ok: false, status: 0, data: null }], ['mt_uurtarieven.json', { ok: true, status: 200, data: { a: 1 } }]]);
    const etags = { 'mt_projecten.json': '"gelijk"', 'mt_planning.json': '"nieuw"', 'mt_uurtarieven.json': '"u"' };
    const gewijzigd = { 'mt_projecten.json': V1, 'mt_planning.json': V2 };   // mt_uurtarieven: geen versie bekend
    const leesde = []; const lees = async f => { leesde.push(f); return f === 'mt_planblokken.json' ? { data: [1], etag: '"v"', gewijzigd: V1 } : null; };
    const t = maakInst({ index: { stores: { mt_projecten: { ts: 5, etag: '"gelijk"' }, mt_planning: { ts: 5, etag: '"oud"' }, mt_vrijedagen: { ts: 10_000_000 - 3600e3, etag: 'x' } } } });
    const res = await t.inst.naHydrate(pref, etags, lees, gewijzigd); await t.k.vooruit(60000);
    const p = t.posts().map(x => x.store).sort();
    assert.ok(p.includes('mt_planning'), 'andere etag'); assert.ok(!p.includes('mt_projecten'), 'zelfde etag'); assert.ok(!p.includes('mt_calc_offertes'), '404 in SharePoint'); assert.ok(!p.includes('mt_offerte_keuze'), 'leesfout');
    assert.ok(!p.includes('mt_uurtarieven'), 'geen geld-recht voor deze rol');
    assert.ok(p.includes('mt_planblokken'), 'ontbreekt in de spiegel en niet in de listing: los gelezen'); assert.ok(!p.includes('mt_vrijedagen'), 'spiegel is minder dan een dag oud');
    assert.strictEqual(t.posts().find(x => x.store === 'mt_planblokken').body.etag, '"v"'); assert.strictEqual(t.posts().find(x => x.store === 'mt_planblokken').body.ts, MS(V1), 'versie van de gelezen stand');
    assert.strictEqual(t.posts().find(x => x.store === 'mt_planning').body.ts, MS(V2), 'versie uit de listing');
    assert.ok(!leesde.includes('mt_projecten.json') && !leesde.includes('mt_planning.json') && !leesde.includes('mt_vrijedagen.json'), 'wat in de listing zat of vers is wordt niet los gelezen');
    assert.ok(res.gezonden.length >= 2);
    assert.strictEqual((await t.inst.naHydrate(pref, etags, lees, gewijzigd)).overgeslagen, true);
    const x = maakInst({ index: null }); x.zet({ index: { stores: null } }); assert.strictEqual((await x.inst.naHydrate(pref, etags, lees, gewijzigd)).index, false);
    const y = maakInst({ aan: false }); assert.strictEqual((await y.inst.naHydrate(pref, etags, lees, gewijzigd)).overgeslagen, true); assert.strictEqual(y.calls.length, 0);
    const z = maakInst({ rechten: { projecten: 'lezen', offertes: null, geld: null, verbeterpunten: null } }); await z.inst.naHydrate(pref, etags, lees, gewijzigd); await z.k.vooruit(60000); assert.strictEqual(z.posts().length, 0);
    // zonder bekende SharePoint-versie (listing zonder lastModifiedDateTime) niet zenden, wel vastleggen
    const g = maakInst({ index: { stores: {} } }); await g.inst.naHydrate(new Map([['mt_projecten.json', { ok: true, status: 200, data: { P: 1 } }]]), { 'mt_projecten.json': '"e"' }, null, {}); await g.k.vooruit(10000);
    assert.strictEqual(g.posts().length, 0); assert.ok(g.fouten.includes('mt_projecten geen-versie'));
    const f = maakInst({ index: { stores: {} } }); await f.inst.naHydrate(new Map(), {}, async () => { throw new Error('HTTP 500'); }, {}); assert.ok(f.fouten.some(s => /lezen$/.test(s)));
  });

  await test('onthoudHydrate wacht op de rol en voert dan eenmalig uit', async () => {
    const t = maakInst({ aan: false, index: { stores: {} } });
    const pref = new Map([['mt_projecten.json', { ok: true, status: 200, data: { P: 1 } }]]);
    await t.inst.onthoudHydrate(pref, { 'mt_projecten.json': '"e"' }, null, { 'mt_projecten.json': V1 }); assert.strictEqual(t.calls.length, 0, 'rol nog onbekend');
    t.zet({ aan: true }); await t.inst.probeer(); await t.k.vooruit(5000); assert.strictEqual(t.posts().length, 1); assert.strictEqual(t.posts()[0].body.ts, MS(V1));
    await t.inst.probeer(); await t.k.vooruit(5000); assert.strictEqual(t.posts().length, 1, 'niet nog eens');
  });

  // ── hooks in mt-core.js makeSP ───────────────────────────────────────────────────────────────────────────────────────────────
  const maakSP = (cfg, fetchFn) => { const w = laad('mt-core.js'); w.fetch = fetchFn; w.getGraphToken = async () => 'tok'; const SP = w.MTCore.makeSP(cfg); SP.SITE_ID = 'site'; return SP; };
  const antw = (status, et, mod) => ({ ok: status >= 200 && status < 300, status, headers: { get: k => (/etag/i.test(k) ? et || null : null) }, json: async () => (mod ? { lastModifiedDateTime: mod } : {}) });

  await test('makeSP: naGeslaagd na een geslaagde write/maakAan/412-merge met etag EN SharePoint-versie; niet bij een fout; een falende hook hindert niets', async () => {
    const meldingen = []; const hook = (f, t, e, g) => meldingen.push({ f, t, e, g });
    let SP = maakSP({ naGeslaagd: hook }, async () => antw(200, '"E1"', V1));
    assert.strictEqual(await SP.write('mt_planning.json', { a: 1 }), true);
    assert.deepStrictEqual(meldingen, [{ f: 'mt_planning.json', t: '{"a":1}', e: '"E1"', g: V1 }]); assert.strictEqual(SP._gewijzigd['mt_planning.json'], V1);
    assert.strictEqual(await SP.write('mt_planning.json', '{"b":2}'), true); assert.strictEqual(meldingen[1].t, '{"b":2}');
    assert.strictEqual(await SP.maakAan('mt_nieuw.json', { c: 3 }), 'aangemaakt'); assert.deepStrictEqual(meldingen[2], { f: 'mt_nieuw.json', t: '{"c":3}', e: '"E1"', g: V1 });
    SP = maakSP({ naGeslaagd: hook }, async () => antw(200, '"E1"')); await SP.write('x.json', {}); assert.strictEqual(meldingen[meldingen.length - 1].g, null, 'antwoord zonder versie: null (de spiegel zendt dan niet)');
    SP = maakSP({ naGeslaagd: hook }, async () => antw(500)); const voor = meldingen.length;
    assert.strictEqual(await SP.write('mt_planning.json', { a: 1 }), false); assert.strictEqual(await SP.maakAan('mt_x.json', {}), false); assert.strictEqual(meldingen.length, voor);
    let stap = 0; SP = maakSP({ naGeslaagd: hook }, async (u, i) => { stap++; if (i && i.method === 'PUT') return stap === 1 ? antw(412) : antw(200, '"E2"', V2); return Object.assign(antw(200, '"E0"'), { json: async () => [{ id: 1, v: 'remote' }] }); });
    SP._etags['m.json'] = '"E0"';
    assert.strictEqual(await SP.write('m.json', [{ id: 2, v: 'lokaal' }]), true);
    const laatste = meldingen[meldingen.length - 1]; assert.strictEqual(laatste.f, 'm.json'); assert.deepStrictEqual(JSON.parse(laatste.t).map(x => x.id).sort(), [1, 2]); assert.strictEqual(laatste.e, '"E2"'); assert.strictEqual(laatste.g, V2);
    SP = maakSP({ naGeslaagd: () => { throw new Error('boem'); } }, async () => antw(200, '"E"', V1)); assert.strictEqual(await SP.write('x.json', {}), true);
    SP = maakSP({}, async () => antw(200, '"E"', V1)); assert.strictEqual(await SP.write('x.json', {}), true);
    SP = maakSP({ naGeslaagd: hook }, async () => Object.assign(antw(200, '"R"'), { json: async () => ({}) })); const m0 = meldingen.length; await SP.read('mt_planning.json'); assert.strictEqual(meldingen.length, m0);
  });

  await test('makeSP.prefetch onthoudt de SharePoint-versie per bestand; leesMeta leest metadata + inhoud op de juiste URL, zonder de etags van de app aan te raken', async () => {
    const urls = [];
    let SP = maakSP({}, async (u, i) => { urls.push({ u: String(u), h: i && i.headers }); if (/\/children/.test(u)) return Object.assign(antw(200), { json: async () => ({ value: [{ name: 'mt_planning.json', eTag: '"L1"', lastModifiedDateTime: V1, '@microsoft.graph.downloadUrl': 'https://dl.test/p' }] }) }); return Object.assign(antw(200, '"E"'), { json: async () => ({ P: 1 }) }); });
    const map = await SP.prefetch(['mt_planning.json', 'mt_ontbreekt.json']);
    assert.strictEqual(SP._gewijzigd['mt_planning.json'], V1); assert.strictEqual(SP._etags['mt_planning.json'], '"L1"'); assert.ok(!('mt_ontbreekt.json' in SP._gewijzigd));
    assert.ok(/\$select=name,eTag,lastModifiedDateTime,@microsoft\.graph\.downloadUrl/.test(urls[0].u), urls[0].u); assert.strictEqual(map.get('mt_ontbreekt.json').status, 404);
    urls.length = 0;
    SP = maakSP({}, async (u, i) => { urls.push({ u: String(u), h: i && i.headers }); if (/\$select=eTag,lastModifiedDateTime/.test(u)) return Object.assign(antw(200), { json: async () => ({ eTag: '"M1"', lastModifiedDateTime: V2 }) }); return Object.assign(antw(200, '"C1"'), { json: async () => [{ id: 'b1' }] }); });
    SP._etags['mt_planblokken.json'] = '"app-etag"';
    const d = await SP.leesMeta('mt_planblokken.json');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(d)), { data: [{ id: 'b1' }], etag: '"M1"', gewijzigd: V2 });
    assert.strictEqual(urls.length, 2); assert.strictEqual(urls[0].u, 'https://graph.microsoft.com/v1.0/sites/site/drive/root:/MT-Bedrijfstool/mt_planblokken.json?$select=eTag,lastModifiedDateTime', 'metadata eerst');
    assert.strictEqual(urls[1].u, 'https://graph.microsoft.com/v1.0/sites/site/drive/root:/MT-Bedrijfstool/mt_planblokken.json:/content');
    assert.ok(urls.every(x => x.h && x.h.Authorization === 'Bearer tok'), 'echte bearer-token');
    assert.ok(!urls.some(x => /root:\/\/|\/\/:\/content/.test(x.u.replace('https://', ''))), 'geen kapotte padstukken');
    assert.strictEqual(SP._etags['mt_planblokken.json'], '"app-etag"', 'de etags van de app blijven ongemoeid'); assert.ok(!('mt_planblokken.json' in SP._gewijzigd));
    SP = maakSP({}, async () => antw(404)); assert.strictEqual(await SP.leesMeta('mt_weg.json'), null);
    SP = maakSP({}, async () => antw(500)); await assert.rejects(SP.leesMeta('mt_stuk.json'), /HTTP 500/);
  });

  console.log(`\n${n} tests geslaagd`);
})();
