// Worker-tests Toggl koppelen: na een sleutelreset is opnieuw koppelen in de tool genoeg.
// Draaien: node test/worker-toggl-koppel.test.js  — verzonnen sleutels, ids en adressen.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const { pathToFileURL } = require('url');

(async () => {
  const bron = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8')
    + '\nexport { valideerFocus, beheerFocusKandidaten, focusNamen, versleutel };\nexport function _reset() { _namenCache.projecten = null; _sleutelCache.clear(); }\n';
  const tmp = path.join(os.tmpdir(), `mt-worker-toggl-koppel-${process.pid}.mjs`); fs.writeFileSync(tmp, bron, 'utf8');
  let W; try { W = await import(pathToFileURL(tmp).href); } finally { try { fs.unlinkSync(tmp); } catch { } }
  const { valideerFocus, beheerFocusKandidaten, focusNamen, versleutel, _reset } = W;

  const kv = () => { const m = new Map(); return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix || '')).sort().map(name => ({ name })), list_complete: true }; } }; };
  let n = 0; const test = async (naam, fn) => { _reset(); try { await fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };

  // Nep-Toggl: OUD = ingetrokken, BAAS = beheerder, COLLEGA = gewone gebruiker (mag geen gebruikerslijst).
  const USERS = [{ email: 'baas@example.org', user_account_id: 1, name: 'Baas' }, { email: 'collega@example.org', user_account_id: 2, name: 'Collega' }];
  const SLEUTELS = { 'sleutel-baas-nieuw-0001': { id: 1, admin: true }, 'sleutel-collega-0000001': { id: 2, admin: false }, 'sleutel-baas-geenuren-01': { id: 1, admin: true, geenUren: true } };
  const gebruikt = [];
  globalThis.fetch = async (u, init) => {
    const s = String(((init && init.headers) || {}).Authorization || '').replace(/^Bearer /, ''), k = SLEUTELS[s], url = String(u);
    gebruikt.push({ s, url });
    if (!k) return new Response('{"error":"invalid_session"}', { status: 401 });
    if (/tracking\/current$/.test(url)) return new Response(null, { status: 204 });
    if (/\/users$/.test(url)) return k.admin ? new Response(JSON.stringify(USERS)) : new Response('{}', { status: 403 });
    if (/time-entries\/stream/.test(url)) return new Response(JSON.stringify(k.geenUren ? [] : [{ toggl_user_id: k.id }]));
    if (/\/projects\?/.test(url)) return new Response(JSON.stringify([{ id: 7, name: 'Project zeven' }]));
    return new Response('[]');
  };
  const KEK = Buffer.alloc(32, 7).toString('base64');
  const envMet = extra => ({ MT_ROLLEN: kv(), SLEUTEL_KEK: KEK, TOGGL_FOCUS_KEY: 'sleutel-oud-ingetrokken-1', OWNER_OIDS: 'oid-baas', ...(extra || {}) });
  const koppelEigenaar = async (env, oid, sleutel) => {
    await env.MT_ROLLEN.put('user:' + oid, JSON.stringify({ oid, role: 'eigenaar', active: true, email: 'baas@example.org' }));
    await env.MT_ROLLEN.put('sleutel:' + oid, JSON.stringify({ focus: { ...(await versleutel(env, oid, 'focus', sleutel)), naam: 'Baas' } }));
  };

  await test('beheerder koppelt nieuwe sleutel terwijl het gedeelde secret is ingetrokken', async () => {
    const env = envMet();
    const v = await valideerFocus(env, 'sleutel-baas-nieuw-0001', 'baas@example.org', 'oid-baas');
    assert.strictEqual(v.fout, undefined, JSON.stringify(v)); assert.strictEqual(v.tgUserId, 1); assert.strictEqual(v.bevestigd, true);
  });

  await test('collega koppelt via de in de tool gekoppelde sleutel van de eigenaar (secret ingetrokken)', async () => {
    const env = envMet(); await koppelEigenaar(env, 'oid-baas', 'sleutel-baas-nieuw-0001');
    const v = await valideerFocus(env, 'sleutel-collega-0000001', 'collega@example.org', 'oid-collega');
    assert.strictEqual(v.fout, undefined, JSON.stringify(v)); assert.strictEqual(v.tgUserId, 2); assert.strictEqual(v.naam, 'Collega');
  });

  await test('geen enkele werkende beheersleutel → duidelijke fout beheer-sleutel', async () => {
    const env = envMet(); await koppelEigenaar(env, 'oid-baas', 'sleutel-oud-ingetrokken-2');
    const v = await valideerFocus(env, 'sleutel-collega-0000001', 'collega@example.org', 'oid-collega');
    assert.strictEqual(v.fout, 'beheer-sleutel');
  });

  await test('ongeldige eigen sleutel blijft sleutel-ongeldig', async () => {
    const v = await valideerFocus(envMet(), 'sleutel-oud-ingetrokken-3', 'collega@example.org', 'oid-collega');
    assert.strictEqual(v.fout, 'sleutel-ongeldig');
  });

  await test('e-mail niet in Toggl blijft email-niet-in-toggl', async () => {
    const env = envMet(); await koppelEigenaar(env, 'oid-baas', 'sleutel-baas-nieuw-0001');
    const v = await valideerFocus(env, 'sleutel-collega-0000001', 'iemand@example.org', 'oid-x');
    assert.strictEqual(v.fout, 'email-niet-in-toggl');
  });

  await test('collega plakt de (uren-loze) gekoppelde sleutel van de eigenaar → sleutel-van-ander', async () => {
    const env = envMet(); await koppelEigenaar(env, 'oid-baas', 'sleutel-baas-geenuren-01');
    const v = await valideerFocus(env, 'sleutel-baas-geenuren-01', 'baas@example.org', 'oid-collega');
    assert.strictEqual(v.fout, 'sleutel-van-ander');
    const zelf = await valideerFocus(env, 'sleutel-baas-geenuren-01', 'baas@example.org', 'oid-baas');
    assert.strictEqual(zelf.fout, undefined, 'eigenaar zelf mag dezelfde sleutel opnieuw koppelen');
  });

  await test('kandidaten: eerst gekoppelde eigenaarssleutel, dan secret; niet de eigen oid', async () => {
    const env = envMet(); await koppelEigenaar(env, 'oid-baas', 'sleutel-baas-nieuw-0001');
    assert.deepStrictEqual(await beheerFocusKandidaten(env), ['sleutel-baas-nieuw-0001', 'sleutel-oud-ingetrokken-1']);
    assert.deepStrictEqual(await beheerFocusKandidaten(env, 'OID-BAAS'), ['sleutel-oud-ingetrokken-1']);
  });

  await test('projectnamen werken met de gekoppelde eigenaarssleutel als het secret is ingetrokken', async () => {
    const env = envMet(); await koppelEigenaar(env, 'oid-baas', 'sleutel-baas-nieuw-0001');
    const m = await focusNamen(env);
    assert.strictEqual(m.get('7'), 'Project zeven');
  });

  await test('ontkoppelen door de eigenaar werkt meteen door (geen cache)', async () => {
    const env = envMet(); await koppelEigenaar(env, 'oid-baas', 'sleutel-baas-nieuw-0001');
    assert.strictEqual((await valideerFocus(env, 'sleutel-collega-0000001', 'collega@example.org', 'oid-collega')).fout, undefined);
    await env.MT_ROLLEN.delete('sleutel:oid-baas'); _reset();
    assert.strictEqual((await valideerFocus(env, 'sleutel-collega-0000001', 'collega@example.org', 'oid-collega')).fout, 'beheer-sleutel');
  });

  await test('eigenaar via Beheer (niet in OWNER_OIDS) levert geen beheersleutel', async () => {
    const env = envMet({ OWNER_OIDS: '' }); await koppelEigenaar(env, 'oid-baas', 'sleutel-baas-nieuw-0001');
    assert.deepStrictEqual(await beheerFocusKandidaten(env), ['sleutel-oud-ingetrokken-1']);
  });


  console.log(`\n${n} tests geslaagd`);
})();
