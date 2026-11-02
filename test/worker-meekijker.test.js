// Worker-tests rol Meekijker: matrix, altijd afdwingen, einddatum, gastadres, Beheer-regels, /geld en /push dicht.
// Draaien: node test/worker-meekijker.test.js  — verzonnen ids en namen.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const { pathToFileURL } = require('url');

(async () => {
  const bron = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8')
    + '\nexport { requirePermission, effectieveModus, bepaalRol, handleBeheer, handleGeld, handleSignalen, handleKlanten, meAntwoord, toegangTotNorm, tokenAdressen, RECHTEN, ROLLEN, MB_ADMIN, eindeDagAmsterdam, kijkerRapportBody, mbMagerDoc, kijkerNamen, externToken, handleToegang, kijkOpruimen, bouwTijdlijn, kijkLabel };\n';
  const tmp = path.join(os.tmpdir(), `mt-worker-meekijker-${process.pid}.mjs`); fs.writeFileSync(tmp, bron, 'utf8');
  let W; try { W = await import(pathToFileURL(tmp).href); } finally { try { fs.unlinkSync(tmp); } catch { } }
  const { requirePermission: rp, effectieveModus, bepaalRol, handleBeheer, handleGeld, handleSignalen, handleKlanten, meAntwoord, toegangTotNorm, tokenAdressen, RECHTEN, ROLLEN, MB_ADMIN, eindeDagAmsterdam, kijkerRapportBody, mbMagerDoc, kijkerNamen, externToken, handleToegang, kijkOpruimen, bouwTijdlijn, kijkLabel } = W;

  const kv = () => { const m = new Map(); return { m, async get(k) { return m.has(k) ? m.get(k).v : null; }, async put(k, v, o) { m.set(k, { v, meta: (o && o.metadata) || null }); }, async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix || '')).sort().map(name => ({ name, metadata: m.get(name).meta })), list_complete: true }; } }; };
  const json0 = (b, s) => ({ status: s || 200, body: b });
  let n = 0; const test = async (naam, fn) => { try { await fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };
  const D = 86400e3;
  const mb = p => `${MB_ADMIN}/${p}`;

  await test('rol bestaat met de afgesproken rij', () => {
    assert.ok(ROLLEN.includes('meekijker'));
    const R = RECHTEN.meekijker;
    assert.strictEqual(R.uren, 'team-lezen'); assert.strictEqual(R.geld, 'kijken'); assert.strictEqual(R.moneybird, 'kijken');
    for (const k of ['taken', 'bestellijst', 'opmerkingen', 'inbox', 'ai', 'beheer', 'mb_verwijderen']) assert.strictEqual(R[k], null, k);
    assert.strictEqual(R.projecten, 'lezen');
  });

  await test('altijd afdwingen: meekijker ook bij log/uit; anderen volgen de var; verlopen meekijker (rol null) ook', () => {
    for (const v of ['log', 'uit', 'afdwingen']) assert.strictEqual(effectieveModus({ ROLLEN_MODUS: v }, 'meekijker'), 'afdwingen');
    assert.strictEqual(effectieveModus({ ROLLEN_MODUS: 'log' }, 'kantoor'), 'log');
    assert.strictEqual(effectieveModus({ ROLLEN_MODUS: 'uit' }, 'lezen'), 'uit');
    assert.strictEqual(effectieveModus({ ROLLEN_MODUS: 'log' }, null, { role: 'meekijker' }), 'afdwingen');
    assert.strictEqual(effectieveModus({ ROLLEN_MODUS: 'log' }, null, { role: 'kantoor' }), 'log');
    assert.strictEqual(effectieveModus({ ROLLEN_MODUS: 'log' }, null, null), 'log');
  });

  await test('/me: modus afdwingen en vlag, ook bij log', () => {
    const me = meAntwoord({ ROLLEN_MODUS: 'log' }, { rol: 'meekijker', rec: { toegangTot: 123 }, email: 'x@example.com' }, { oid: 'o1' });
    assert.strictEqual(me.modus, 'afdwingen'); assert.strictEqual(me.altijdAfdwingen, true); assert.strictEqual(me.toegangTot, 123);
    const k = meAntwoord({ ROLLEN_MODUS: 'log' }, { rol: 'kantoor', rec: {}, email: 'x@example.com' }, { oid: 'o2' });
    assert.strictEqual(k.modus, 'log'); assert.strictEqual(k.altijdAfdwingen, undefined);
  });

  await test('AI, Inbox/beheer en eigen Toggl-koppeling dicht; aanwezig dicht', () => {
    assert.strictEqual(rp('meekijker', 'claude', 'POST', '').ok, false);
    assert.strictEqual(rp('meekijker', 'beheer', 'GET', '/beheer/gebruikers').ok, false);
    assert.strictEqual(rp('meekijker', 'track_admin', 'GET', '/track/usage').ok, false);
    assert.strictEqual(rp('meekijker', 'mijn', 'GET', '/mijn/toggl').ok, false);
    assert.strictEqual(rp('meekijker', 'aanwezig', 'GET', '/aanwezig').ok, false);
    assert.strictEqual(rp('meekijker', 'track', 'POST', '/track').ok, true, 'tab-events blijven kunnen');
    assert.strictEqual(rp('kantoor', 'mijn', 'GET', '/mijn/toggl').ok, true, 'andere rollen onveranderd');
  });

  await test('Toggl: planning lezen ja, schrijven nee; team-uren (Reports GET/POST) ja, rest nee; eigen uren/timer nee', () => {
    assert.strictEqual(rp('meekijker', 'toggl_focus', 'GET', 'tasks').ok, true);
    assert.strictEqual(rp('meekijker', 'toggl_admin_projects', 'GET', 'workspaces/1/projects').ok, true);
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) assert.strictEqual(rp('meekijker', 'toggl_focus', m, 'tasks/9', ['status_id']).ok, false, m);
    assert.strictEqual(rp('meekijker', 'toggl_reports', 'POST', 'workspace/1/search/time_entries').ok, true);
    assert.strictEqual(rp('meekijker', 'toggl_reports', 'POST', 'workspace/1/summary/time_entries').ok, false, 'alleen de route die de tool gebruikt');
    assert.strictEqual(rp('meekijker', 'toggl_reports', 'GET', 'workspace/1/search/time_entries').ok, false);
    for (const m of ['PUT', 'PATCH', 'DELETE']) assert.strictEqual(rp('meekijker', 'toggl_reports', m, 'x').ok, false, m);
    assert.strictEqual(rp('meekijker', 'toggl', 'GET', 'me/time_entries/current').ok, false, 'eigen uren = gedeelde sleutel: dicht');
    assert.strictEqual(rp('meekijker', 'toggl', 'POST', 'workspaces/1/time_entries').ok, false);
    assert.strictEqual(rp('meekijker', 'toggl_focus', 'GET', 'organizations/1/workspaces/2/tracking/current').ok, false);
    assert.strictEqual(rp('meekijker', 'toggl_focus', 'POST', 'organizations/1/workspaces/2/time-entries').ok, false);
    assert.strictEqual(rp('meekijker', 'toggl', 'POST', 'workspaces/1/projects').ok, false);
    assert.strictEqual(rp('meekijker', 'toggl', 'POST', 'workspaces/1/users').ok, false, 'meta schrijven: beheer nodig');
  });

  await test('Moneybird kijken: documenten/rapporten lezen ja; contacten, downloads, uploads en alle schrijfacties nee', () => {
    for (const p of ['documents/purchase_invoices', 'documents/purchase_invoices/123', 'sales_invoices', 'sales_invoices/5', 'estimates', 'estimates/7', 'ledger_accounts', 'reports/profit_loss'])
      assert.strictEqual(rp('meekijker', 'moneybird', 'GET', mb(p) + '?per_page=10').ok, true, p);
    for (const p of ['reports/creditors', 'reports/debtors', 'reports/expenses_by_contact', 'reports/creditors_aging', 'contacts', 'contacts/9', 'documents/purchase_invoices/1/attachments/2', 'documents/purchase_invoices/1/attachments/2/download', 'financial_accounts', 'sales_invoices/5/send_invoice'])
      assert.strictEqual(rp('meekijker', 'moneybird', 'GET', mb(p)).ok, false, p);
    assert.strictEqual(rp('meekijker', 'moneybird', 'GET', '999/sales_invoices').ok, false, 'andere administratie');
    assert.strictEqual(rp('meekijker', 'moneybird_download', 'GET', '').ok, false);
    assert.strictEqual(rp('meekijker', 'moneybird_upload', 'POST', mb('documents/purchase_invoices/1/attachments')).ok, false);
    for (const [m, p] of [['POST', 'sales_invoices'], ['POST', 'estimates'], ['PATCH', 'documents/purchase_invoices/1'], ['DELETE', 'documents/purchase_invoices/1'], ['POST', 'contacts']])
      assert.strictEqual(rp('meekijker', 'moneybird', m, mb(p)).ok, false, m + ' ' + p);
    assert.strictEqual(rp('lezen', 'moneybird', 'GET', mb('contacts')).ok, true, 'rol lezen onveranderd');
  });

  await test('/geld: lezen ja; vraag stellen en gelezen-markering (POST) nee; ijkpunten nee', async () => {
    const env = { MT_ROLLEN: kv() };
    const ik = { rol: 'meekijker', oid: 'o9', email: 'c@example.com', rec: { naam: 'Coach' } };
    const roep = (pad, m, body) => handleGeld(pad.split('?')[0], { method: m, url: 'https://x.test' + pad, json: async () => body || {} }, env, ik, json0);
    let r = await roep('/geld/rapporten', 'GET'); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    r = await roep('/geld/rapport/vraag', 'POST', { rapport_id: '2026-10-01', sectie_id: 's', tekst: 'hoi' }); assert.strictEqual(r.status, 403); assert.strictEqual(r.body.reden, 'geld-kijken');
    r = await roep('/geld/koers/gelezen', 'POST', { datum: '2026-10-01' }); assert.strictEqual(r.status, 403);
    r = await roep('/geld/schets', 'POST', { eid: '1', ym: '2026-11', bedrag: 1, oud: null }); assert.strictEqual(r.status, 403);
    assert.ok(![...env.MT_ROLLEN.m.keys()].some(k => /koers|rvr|rap/i.test(k) && k !== 'x'), 'niets geschreven');
    const a = await handleGeld('/geld/rapporten', { method: 'GET', url: 'https://x.test/geld/rapporten' }, env, { rol: 'administratie', oid: 'o8', rec: {} }, json0);
    assert.strictEqual(a.status, 200, 'administratie (lezen) ongewijzigd');
  });

  await test('/push dicht voor meekijker; /signalen lezen blijft, schrijven niet', async () => {
    const env = { MT_ROLLEN: kv(), MT_TELLER: { idFromName: x => x, get: () => ({ fetch: async () => new Response('{}') }) } };
    const ik = { rol: 'meekijker', oid: 'o9', rec: {} };
    const req = (m, body) => ({ method: m, url: 'https://x.test/x', json: async () => body || {}, text: async () => JSON.stringify(body || {}) });
    for (const p of ['/push/sleutel', '/push/status', '/push/aanmelden']) {
      const r = await handleSignalen(p, req(p === '/push/aanmelden' ? 'POST' : 'GET'), env, ik, json0);
      assert.strictEqual(r.status, 403, p); assert.strictEqual(r.body.reden, 'push-meekijker');
    }
    const w = await handleSignalen('/signalen/actie', req('POST', { sleutel: 'x', actie: 'oppakken' }), env, ik, json0);
    assert.strictEqual(w.status, 403); assert.strictEqual(w.body.reden, 'offertes-wijzigen');
  });

  await test('einddatum: normalisatie', () => {
    const nu = Date.UTC(2026, 10, 2);
    assert.deepStrictEqual(toegangTotNorm(null, nu), { ok: true, waarde: null });
    assert.strictEqual(toegangTotNorm(nu - 1, nu).fout, 'einddatum-in-het-verleden');
    assert.strictEqual(toegangTotNorm(nu + 500 * D, nu).fout, 'einddatum-te-ver');
    assert.strictEqual(toegangTotNorm('morgen', nu).fout, 'ongeldige-einddatum');
    assert.strictEqual(toegangTotNorm(1.5, nu).fout, 'ongeldige-einddatum');
    assert.strictEqual(toegangTotNorm(nu + 30 * D, nu).waarde, nu + 30 * D);
    assert.ok(toegangTotNorm('2026-12-31', nu).waarde > nu);
  });

  await test('bepaalRol: actief tot de einddatum, daarna geen rol (reden verlopen); deactiveren werkt; eigenaar verloopt nooit', async () => {
    const env = { MT_ROLLEN: kv() };
    const pl = { oid: '11111111-1111-1111-1111-111111111111', preferred_username: 'coach@example.com', name: 'Coach' };
    await env.MT_ROLLEN.put('user:' + pl.oid, JSON.stringify({ oid: pl.oid, role: 'meekijker', active: true, email: pl.preferred_username, naam: 'Coach', toegangTot: Date.now() + 5000, lastSeen: Date.now() }));
    let ik = await bepaalRol(env, pl, null); assert.strictEqual(ik.rol, 'meekijker');
    await env.MT_ROLLEN.put('user:' + pl.oid, JSON.stringify({ oid: pl.oid, role: 'meekijker', active: true, naam: 'Coach', toegangTot: Date.now() - 1, lastSeen: Date.now() }));
    await new Promise(r => setTimeout(r, 5100));   // cache van 5 s voor meekijker
    ik = await bepaalRol(env, pl, null); assert.strictEqual(ik.rol, null); assert.strictEqual(ik.reden, 'verlopen');
    assert.strictEqual(effectieveModus({ ROLLEN_MODUS: 'log' }, ik.rol, ik.rec), 'afdwingen');
    await env.MT_ROLLEN.put('user:' + pl.oid, JSON.stringify({ oid: pl.oid, role: 'meekijker', active: false, naam: 'Coach', lastSeen: Date.now() }));
    await new Promise(r => setTimeout(r, 5100));
    ik = await bepaalRol(env, pl, null); assert.strictEqual(ik.rol, null); assert.strictEqual(ik.reden, 'gedeactiveerd');
    const eig = { oid: '22222222-2222-2222-2222-222222222222', preferred_username: 'baas@example.com' };
    await env.MT_ROLLEN.put('user:' + eig.oid, JSON.stringify({ oid: eig.oid, role: 'eigenaar', active: true, bron: 'owner_oid', toegangTot: 1, lastSeen: Date.now() }));
    ik = await bepaalRol({ ...env, OWNER_OIDS: eig.oid }, eig, null); assert.strictEqual(ik.rol, 'eigenaar');
  });

  await test('gast-adres: uitnodiging koppelt op mail-claim of #EXT#-UPN en neemt de einddatum mee; verlopen uitnodiging koppelt niet', async () => {
    const tot = Date.now() + 10 * D;
    let teller = 0;
    for (const claims of [{ preferred_username: 'jan_example.org#EXT#@example.net' }, { preferred_username: 'x@example.net', email: 'jan@example.org' }]) {
      const env = { MT_ROLLEN: kv() };
      await env.MT_ROLLEN.put('invite:jan@example.org', JSON.stringify({ email: 'jan@example.org', role: 'lezen', naam: 'Jan', createdBy: 'o', verloopt: Date.now() + D, toegangTot: tot }));
      const pl = { oid: '33333333-3333-3333-3333-33333333333' + (++teller), ...claims };
      const ik = await bepaalRol(env, pl, null);
      assert.strictEqual(ik.rol, 'lezen', JSON.stringify(claims)); assert.strictEqual(ik.rec.toegangTot, tot); assert.strictEqual(ik.rec.email, 'jan@example.org');
      assert.strictEqual(await env.MT_ROLLEN.get('invite:jan@example.org'), null);
    }
    const env = { MT_ROLLEN: kv() };
    await env.MT_ROLLEN.put('invite:jan@example.org', JSON.stringify({ email: 'jan@example.org', role: 'meekijker', verloopt: Date.now() + D, toegangTot: Date.now() - 1 }));
    const ik = await bepaalRol(env, { oid: '44444444-4444-4444-4444-444444444444', preferred_username: 'jan@example.org' }, null);
    assert.strictEqual(ik.rol, null);
    assert.deepStrictEqual(tokenAdressen({ preferred_username: 'A_example.org#EXT#@example.net', email: 'a@example.org' }), ['a_example.org#ext#@example.net', 'a@example.org']);
  });

  await test('Beheer: alleen eigenaar maakt/wijzigt meekijkers; einddatum verplicht; audit; verlengen; ongeldig = 400', async () => {
    const env = { MT_ROLLEN: kv() };
    const ik = rol => ({ rol, oid: 'oid-' + rol, email: rol + '@example.com', rec: { naam: rol } });
    const roep = (rol, p, body, m = 'POST') => handleBeheer(p, { method: m, url: 'https://x.test' + p, json: async () => body || {} }, env, ik(rol), json0);
    const tot = Date.now() + 30 * D;
    let r = await roep('beheerder', '/beheer/uitnodigen', { email: 'c@example.com', rol: 'meekijker', toegangTot: tot }); assert.strictEqual(r.status, 403); assert.strictEqual(r.body.error, 'alleen-eigenaar-mag-meekijker');
    r = await roep('eigenaar', '/beheer/uitnodigen', { email: 'c@example.com', rol: 'meekijker' }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.error, 'einddatum-verplicht');
    r = await roep('eigenaar', '/beheer/uitnodigen', { email: 'c@example.com', rol: 'meekijker', toegangTot: Date.now() - 1 }); assert.strictEqual(r.status, 400);
    r = await roep('eigenaar', '/beheer/uitnodigen', { email: 'c@example.com', rol: 'meekijker', toegangTot: tot }); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.uitnodiging.toegangTot, tot);
    // bestaand account (gekoppeld) wijzigen
    const oid = '55555555-5555-5555-5555-555555555555';
    await env.MT_ROLLEN.put('user:' + oid, JSON.stringify({ oid, role: 'meekijker', active: true, naam: 'Coach', email: 'c@example.com', toegangTot: tot }));
    r = await roep('beheerder', '/beheer/gebruiker', { oid, toegangTot: tot + D }); assert.strictEqual(r.status, 403);
    r = await roep('eigenaar', '/beheer/gebruiker', { oid, toegangTot: null }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.error, 'einddatum-verplicht');
    r = await roep('eigenaar', '/beheer/gebruiker', { oid, toegangTot: tot + 7 * D }); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.gebruiker.toegangTot, tot + 7 * D);
    r = await roep('eigenaar', '/beheer/gebruiker', { oid, actief: false }); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.gebruiker.active, false);
    const audit = (await roep('eigenaar', '/beheer/audit', null, 'GET')).body.audit.map(x => x.actie);
    assert.ok(audit.includes('einddatum-gewijzigd') && audit.includes('uitgenodigd') && audit.includes('gedeactiveerd'), audit.join());
    // een gewone gebruiker kan niet naar meekijker zonder einddatum
    const o2 = '66666666-6666-6666-6666-666666666666';
    await env.MT_ROLLEN.put('user:' + o2, JSON.stringify({ oid: o2, role: 'lezen', active: true, naam: 'X' }));
    r = await roep('eigenaar', '/beheer/gebruiker', { oid: o2, rol: 'meekijker' }); assert.strictEqual(r.status, 400);
    r = await roep('eigenaar', '/beheer/gebruiker', { oid: o2, rol: 'meekijker', toegangTot: tot }); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.gebruiker.role, 'meekijker');
    // niet-meekijkers: bestaande flows ongewijzigd
    r = await roep('beheerder', '/beheer/uitnodigen', { email: 'k@example.com', rol: 'kantoor' }); assert.strictEqual(r.status, 200);
    assert.strictEqual((await roep('beheerder', '/beheer/gebruikers', null, 'GET')).body.rollen.some(x => x.id === 'meekijker'), true);
  });

  await test('/klanten: verlopen meekijker krijgt 403, ook bij ROLLEN_MODUS=log', async () => {
    const env = { MT_ROLLEN: kv(), ROLLEN_MODUS: 'log' };
    const req = { method: 'GET', url: 'https://x.test/klanten' };
    const r = await handleKlanten(req, env, { rol: null, rec: { role: 'meekijker' }, reden: 'verlopen', oid: 'o' }, json0, {});
    assert.strictEqual(r.status, 403);
    const r2 = await handleKlanten(req, env, { rol: null, rec: null, reden: 'onbekend', oid: 'o' }, json0, {});
    assert.notStrictEqual(r2.status, 403, 'onbekende gebruiker in log: onveranderd');
  });

  // ── Brok 2b: fetch-handler end-to-end met een echt ondertekend token (RS256) en een nagebootste upstream ──────────────────────────
  const TENANT = '15b652c3-ff53-433f-a29d-e9626cbafb41', CLIENT = 'a091db96-24ed-4b64-8b9d-7c55bc86cfdb';
  const sleutels = await globalThis.crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await globalThis.crypto.subtle.exportKey('jwk', sleutels.publicKey)), kid: 'k1', use: 'sig', alg: 'RS256' };
  const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const maakToken = async claims => {
    const kop = b64u({ alg: 'RS256', kid: 'k1', typ: 'JWT' }), lading = b64u({ tid: TENANT, iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
    const sig = Buffer.from(await globalThis.crypto.subtle.sign('RSASSA-PKCS1-v1_5', sleutels.privateKey, Buffer.from(kop + '.' + lading))).toString('base64url');
    return `${kop}.${lading}.${sig}`;
  };
  const upstream = []; let mbAntwoord = null;
  const echteFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    u = String(u);
    if (u.includes('/discovery/v2.0/keys')) return new Response(JSON.stringify({ keys: [jwk] }));
    upstream.push({ u, m: (init && init.method) || 'GET' });
    if (u.includes('moneybird.com')) return new Response(JSON.stringify(mbAntwoord || []), { headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/users')) return new Response(JSON.stringify([{ id: 7, fullname: 'Piet Voorbeeld', email: 'piet@example.com', phone: '06', name: 'Piet' }]));
    return new Response('[]');
  };
  const pending = [];
  const ctx = { waitUntil: p => { pending.push(p.catch(() => {})); } };
  const roepFetch = async (env, token, pad, init) => {
    const req = new Request('https://worker.test' + pad, { ...(init || {}), headers: { 'X-Auth-Token': token, 'Content-Type': 'application/json', ...((init && init.headers) || {}) } });
    const r = await W.default.fetch(req, env, ctx); const t = await r.text(); await Promise.all(pending.splice(0)); let b; try { b = JSON.parse(t); } catch { b = t; }
    return { status: r.status, body: b };
  };
  const envMet = (extra, kvx) => ({ MT_ROLLEN: kvx || kv(), ROLLEN_MODUS: 'log', MONEYBIRD_KEY: 'x', TOGGL_KEY: 'x', TOGGL_FOCUS_KEY: 'x', ...(extra || {}) });
  const OID_K = i => `aaaaaaaa-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`;
  const zetMeekijker = async (env, oid, extra) => env.MT_ROLLEN.put('user:' + oid, JSON.stringify({ oid, role: 'meekijker', active: true, naam: 'Coach', email: 'coach@example.org', toegangTot: Date.now() + 30 * D, lastSeen: Date.now(), ...(extra || {}) }));

  await test('fail-closed: KV-storing of ontbrekende binding sluit een gast buiten; eigen medewerker en vaste eigenaar blijven (log-modus)', async () => {
    const kapot = { async get() { throw new Error('KV down'); }, async put() { throw new Error('KV down'); }, async delete() { }, async list() { throw new Error('KV down'); } };
    const gast = await maakToken({ oid: OID_K(1), preferred_username: 'coach_example.org#EXT#@example.net', name: 'Coach' });
    for (const env of [envMet({}, kapot), { ROLLEN_MODUS: 'log', MONEYBIRD_KEY: 'x' }]) {
      for (const pad of ['/klanten', '/instellingen', '/track', '/?target=toggl_focus&path=tasks', '/?target=moneybird&path=' + MB_ADMIN + '/contacts', '/geld/tijdlijn', '/zoek/moneybird?q=abc']) {
        const r = await roepFetch(env, gast, pad); assert.strictEqual(r.status, 403, pad + ' ' + JSON.stringify(r.body));
      }
      const me = await roepFetch(env, gast, '/me'); assert.strictEqual(me.status, 200); assert.strictEqual(me.body.actief, false);
    }
    const intern = await maakToken({ oid: OID_K(2), preferred_username: 'medewerker@mortiseandtenon.nl', name: 'Intern' });
    let r = await roepFetch(envMet({}, kapot), intern, '/klanten'); assert.notStrictEqual(r.status, 403, 'eigen medewerker: log-modus ongewijzigd');
    const baas = await maakToken({ oid: OID_K(3), preferred_username: 'baas@example.org' });
    r = await roepFetch(envMet({ OWNER_OIDS: OID_K(3) }, kapot), baas, '/me'); assert.strictEqual(r.body.rol, 'eigenaar', 'vaste eigenaar blijft eigenaar bij KV-storing');
    assert.strictEqual(externToken({ preferred_username: 'a@mortiseandtenon.nl', email: 'a@mortiseandtenon.nl' }), false);
    assert.strictEqual(externToken({ preferred_username: 'a@mortiseandtenon.nl', email: 'a@example.org' }), true);
    assert.strictEqual(externToken({}), true);
  });

  await test('gast zonder rol (log-modus) komt nergens; onbekende interne gebruiker in log ongewijzigd', async () => {
    const env = envMet({});
    const gast = await maakToken({ oid: OID_K(4), preferred_username: 'x@example.org' });
    assert.strictEqual((await roepFetch(env, gast, '/klanten')).status, 403);
    const intern = await maakToken({ oid: OID_K(5), preferred_username: 'nieuw@mortiseandtenon.nl' });
    assert.notStrictEqual((await roepFetch(env, intern, '/klanten')).status, 403);
  });

  await test('meekijker via de echte handler (ROLLEN_MODUS=log): AI, schrijven, contacten, eigen uren en Focus-meta dicht; planning en teamuren open', async () => {
    const env = envMet({}), oid = OID_K(6); await zetMeekijker(env, oid);
    const tok = await maakToken({ oid, preferred_username: 'coach@example.org', name: 'Coach' });
    const mb = (p, init) => roepFetch(env, tok, '/?target=moneybird&path=' + encodeURIComponent(MB_ADMIN + '/' + p), init);
    upstream.length = 0;
    assert.strictEqual((await roepFetch(env, tok, '/?target=claude', { method: 'POST', body: '{}' })).status, 403);
    assert.strictEqual((await mb('contacts')).status, 403);
    assert.strictEqual((await mb('reports/creditors')).status, 403);
    assert.strictEqual((await mb('sales_invoices', { method: 'POST', body: '{}', headers: { 'X-MT-Bevestiging': 'ja' } })).status, 403);
    assert.strictEqual((await roepFetch(env, tok, '/?target=toggl_focus&path=' + encodeURIComponent('organizations/1/workspaces/2/tasks/9'), { method: 'PATCH', body: '{"status_id":1}' })).status, 403);
    assert.strictEqual((await roepFetch(env, tok, '/?target=toggl_focus&path=' + encodeURIComponent('organizations/1/workspaces/2/tracking/current'))).status, 403);
    assert.strictEqual((await roepFetch(env, tok, '/?target=toggl_focus&path=me')).status, 403, 'Focus-meta dicht');
    assert.strictEqual((await roepFetch(env, tok, '/?target=toggl&path=me')).status, 403);
    assert.strictEqual((await roepFetch(env, tok, '/?target=toggl&path=' + encodeURIComponent('workspaces/9/organizations'))).status, 403);
    assert.strictEqual((await roepFetch(env, tok, '/mijn/toggl')).status, 403);
    assert.strictEqual((await roepFetch(env, tok, '/aanwezig')).status, 403);
    assert.strictEqual((await roepFetch(env, tok, '/push/aanmelden', { method: 'POST', body: '{}' })).status, 403);
    assert.strictEqual((await roepFetch(env, tok, '/beheer/gebruikers')).status, 403);
    assert.strictEqual((await roepFetch(env, tok, '/track/usage')).status, 403);
    assert.strictEqual((await roepFetch(env, tok, '/geld/rapport/vraag', { method: 'POST', body: '{}' })).status, 403);
    assert.strictEqual((await roepFetch(env, tok, '/onbekend-doel?target=iets')).status, 403, 'onbekend target = dicht');
    assert.strictEqual((await roepFetch(env, tok, '/')).status, 403, 'geen target = dicht');
    assert.strictEqual(upstream.length, 0, 'niets doorgestuurd naar Toggl/Moneybird/Anthropic');
    assert.strictEqual((await roepFetch(env, tok, '/?target=toggl_focus&path=' + encodeURIComponent('organizations/1/workspaces/2/tasks?page=1'))).status, 200);
    assert.strictEqual((await roepFetch(env, tok, '/?target=toggl_admin_projects&path=' + encodeURIComponent('workspaces/9/projects'))).status, 200);
    assert.strictEqual((await roepFetch(env, tok, '/track/heartbeat', { method: 'POST', body: '{}' })).status, 200);
    assert.strictEqual((await roepFetch(env, tok, '/me')).body.modus, 'afdwingen');
  });

  await test('Reports voor de meekijker: alleen begrensde bodies (periode ≤ 400 dagen, vaste velden, klein)', async () => {
    const env = envMet({}), oid = OID_K(7); await zetMeekijker(env, oid);
    const tok = await maakToken({ oid, preferred_username: 'coach@example.org' });
    const rep = body => roepFetch(env, tok, '/?target=toggl_reports&path=' + encodeURIComponent('workspace/5/search/time_entries'), { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
    assert.strictEqual((await rep({ start_date: '2026-01-01', end_date: '2026-06-30', page_size: 1000, first_row_number: 1 })).status, 200);
    assert.strictEqual((await rep({ start_date: '2020-01-01', end_date: '2026-06-30' })).status, 403, 'periode te lang');
    assert.strictEqual((await rep({ start_date: '2026-01-01', end_date: '2026-02-01', user_ids: [1] })).status, 403, 'onbekend veld');
    assert.strictEqual((await rep({ start_date: '2026-01-01', end_date: '2026-02-01', page_size: 100000 })).status, 403);
    assert.strictEqual((await rep({ end_date: '2026-02-01' })).status, 403);
    assert.strictEqual((await rep('x'.repeat(5000))).status, 403, 'te groot');
    assert.strictEqual((await rep('geen json')).status, 403);
    const focus = body => roepFetch(env, tok, '/?target=toggl_focus&path=' + encodeURIComponent('reports/workspaces/3/query'), { method: 'POST', body: JSON.stringify(body) });
    const q = (a, e) => ({ groupings: [{ property: 'project_id' }], aggregations: [{ property: 'duration', function: 'sum' }], filters: [{ property: 'start', operator: 'between', value: [a, e] }, { property: 'project_id', operator: 'in', value: [1] }] });
    assert.strictEqual((await focus(q('2026-10-01T00:00:00Z', '2026-10-29T00:00:00Z'))).status, 200);
    assert.strictEqual((await focus(q('2024-01-01T00:00:00Z', '2026-10-29T00:00:00Z'))).status, 403);
    assert.strictEqual((await focus({ groupings: [], filters: [] })).status, 403, 'zonder periodefilter');
    assert.strictEqual(kijkerRapportBody('toggl_reports', '', JSON.stringify({ start_date: '2026-02-30', end_date: '2026-03-01' })), 'rapport-periode');
  });

  await test('Moneybird voor de meekijker: contact alleen id + naam; bijlagen, notities, events, betaallinks weg', async () => {
    const env = envMet({}), oid = OID_K(8); await zetMeekijker(env, oid);
    const tok = await maakToken({ oid, preferred_username: 'coach@example.org' });
    const contact = { id: '77', company_name: 'Klant BV', firstname: 'Piet', lastname: 'Jansen', address1: 'Straat 1', zipcode: '1234AB', email: 'klant@example.com', phone: '06123', sepa_iban: 'IBANGEHEIM123', chamber_of_commerce: '1', tax_number: 'NL1', notes: [{ note: 'geheim' }], custom_fields: [{ v: 1 }], contact_persons: [{ firstname: 'X' }] };
    const doc = { id: '1', invoice_id: '2026-1', total_price_incl_tax: '121.0', contact, contact_id: '77', contact_person: { firstname: 'Y' }, attachments: [{ id: '5', filename: 'f.pdf' }], notes: [{ note: 'intern' }], events: [{ action: 'x' }], payments: [{ price: '1' }], payment_url: 'https://pay.example.com/x', public_view_code: 'abc', url: 'https://moneybird.com/x', details: [{ description: 'Keuken', price: '100' }] };
    mbAntwoord = [doc];
    let r = await roepFetch(env, tok, '/?target=moneybird&path=' + encodeURIComponent(MB_ADMIN + '/documents/purchase_invoices'));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const d = r.body[0];
    assert.deepStrictEqual(d.contact, { id: '77', company_name: 'Klant BV' });
    for (const k of ['attachments', 'notes', 'events', 'payments', 'payment_url', 'public_view_code', 'url', 'contact_person']) assert.ok(!(k in d), k);
    assert.strictEqual(d.total_price_incl_tax, '121.0'); assert.strictEqual(d.details[0].description, 'Keuken'); assert.strictEqual(d.contact_id, '77');
    assert.ok(!JSON.stringify(r.body).match(/Straat|klant@|IBANGEHEIM|06123|geheim|pay\.example/), 'nergens een restant');
    assert.deepStrictEqual(mbMagerDoc({ contact: { id: '1', firstname: 'A', lastname: 'B', email: 'e' } }).contact, { id: '1', firstname: 'A', lastname: 'B' });
    mbAntwoord = { id: '9', contact, attachments: [1] };
    r = await roepFetch(env, tok, '/?target=moneybird&path=' + encodeURIComponent(MB_ADMIN + '/sales_invoices/9'));
    assert.deepStrictEqual(r.body.contact, { id: '77', company_name: 'Klant BV' }); assert.ok(!('attachments' in r.body));
    const ok = OID_K(9); await env.MT_ROLLEN.put('user:' + ok, JSON.stringify({ oid: ok, role: 'kantoor', active: true, lastSeen: Date.now() }));
    const tk = await maakToken({ oid: ok, preferred_username: 'kantoor@mortiseandtenon.nl' });
    r = await roepFetch(env, tk, '/?target=moneybird&path=' + encodeURIComponent(MB_ADMIN + '/sales_invoices/9'));
    assert.strictEqual(r.body.contact.email, 'klant@example.com', 'kantoor: ongewijzigd'); mbAntwoord = null;
  });

  await test('gebruikerslijsten voor de meekijker: alleen id en naam', async () => {
    const env = envMet({}), oid = OID_K(10); await zetMeekijker(env, oid);
    const tok = await maakToken({ oid, preferred_username: 'coach@example.org' });
    let r = await roepFetch(env, tok, '/?target=toggl&path=' + encodeURIComponent('workspaces/9/users'));
    assert.deepStrictEqual(r.body, [{ id: 7, fullname: 'Piet Voorbeeld', name: 'Piet' }]);
    r = await roepFetch(env, tok, '/?target=toggl_focus&path=' + encodeURIComponent('organizations/1/users'));
    assert.deepStrictEqual(r.body, [{ id: 7, fullname: 'Piet Voorbeeld', name: 'Piet' }]);
    assert.deepStrictEqual(JSON.parse(kijkerNamen(JSON.stringify({ data: [{ id: 1, name: 'A', email: 'e', user_account_id: 5 }] }))), { data: [{ id: 1, name: 'A', user_account_id: 5 }] });
    assert.strictEqual(kijkerNamen('kapot'), '[]');
  });

  await test('uitnodiging meekijker activeert niet: eerste login komt in Aanvragen (met vlag); goedkeuren door de eigenaar geeft het account met de einddatum; weigeren ruimt op', async () => {
    const env = envMet({}), tot = Date.now() + 20 * D, oid = OID_K(11);
    await env.MT_ROLLEN.put('invite:coach@example.org', JSON.stringify({ id: 'inv-1', email: 'coach@example.org', role: 'meekijker', naam: 'Coach', createdBy: 'o', verloopt: Date.now() + D, toegangTot: tot }));
    const tok = await maakToken({ oid, preferred_username: 'coach_example.org#EXT#@example.net', email: 'coach@example.org', name: 'Coach' });
    const me = await roepFetch(env, tok, '/me'); assert.strictEqual(me.body.rol, null); assert.strictEqual(me.body.reden, 'wacht-op-goedkeuring');
    assert.strictEqual((await roepFetch(env, tok, '/?target=toggl_focus&path=tasks')).status, 403);
    assert.strictEqual(await env.MT_ROLLEN.get('user:' + oid), null, 'geen user-record');
    const a = JSON.parse(await env.MT_ROLLEN.get('aanvraag:' + oid)); assert.strictEqual(a.uitgenodigdAls, 'meekijker'); assert.strictEqual(a.toegangTot, tot); assert.strictEqual(a.oid, oid);
    await env.MT_ROLLEN.put('aanvraag:' + oid, JSON.stringify({ ...a, ts: Date.now() - 2 * 3600e3 }));
    await roepFetch(env, tok, '/toegang', { method: 'POST', body: JSON.stringify({ bericht: 'hoi', uitgenodigdAls: 'eigenaar' }) });
    const a2 = JSON.parse(await env.MT_ROLLEN.get('aanvraag:' + oid)); assert.strictEqual(a2.uitgenodigdAls, 'meekijker'); assert.strictEqual(a2.bericht, 'hoi');
    const ikE = rol => ({ rol, oid: 'oid-' + rol, email: rol + '@example.com', rec: { naam: rol } });
    const beheer = (rol, p, body) => handleBeheer(p, { method: 'POST', url: 'https://x.test' + p, json: async () => body }, env, ikE(rol), json0);
    let r = await beheer('beheerder', '/beheer/aanvraag', { oid, rol: 'meekijker' }); assert.strictEqual(r.status, 403, 'beheerder mag geen meekijker maken');
    r = await beheer('eigenaar', '/beheer/aanvraag', { oid, rol: 'eigenaar' }); assert.strictEqual(r.status, 200, 'rol staat vast op de uitnodiging');
    assert.strictEqual(r.body.gebruiker.role, 'meekijker'); assert.strictEqual(r.body.gebruiker.toegangTot, tot);
    assert.strictEqual(await env.MT_ROLLEN.get('invite:coach@example.org'), null);
    assert.strictEqual((await roepFetch(env, tok, '/me')).body.rol, 'meekijker');
    const o2 = OID_K(12); await env.MT_ROLLEN.put('invite:b@example.org', JSON.stringify({ id: 'inv-b', email: 'b@example.org', role: 'meekijker', verloopt: Date.now() + D, toegangTot: tot }));
    const t2 = await maakToken({ oid: o2, preferred_username: 'b@example.org' }); await roepFetch(env, t2, '/me');
    r = await beheer('eigenaar', '/beheer/aanvraag', { oid: o2, weigeren: true }); assert.strictEqual(r.status, 200);
    assert.strictEqual(await env.MT_ROLLEN.get('invite:b@example.org'), null); assert.strictEqual(await env.MT_ROLLEN.get('aanvraag:' + o2), null);
    const o3 = OID_K(13); await env.MT_ROLLEN.put('invite:c@example.org', JSON.stringify({ id: 'inv-c', email: 'c@example.org', role: 'meekijker', verloopt: Date.now() + D }));
    await env.MT_ROLLEN.put('aanvraag:' + o3, JSON.stringify({ oid: o3, email: 'c@example.org', naam: 'C', ts: Date.now(), uitgenodigdAls: 'meekijker', toegangTot: Date.now() - 1000, inviteEmail: 'c@example.org', inviteId: 'inv-c' }));
    r = await beheer('eigenaar', '/beheer/aanvraag', { oid: o3 }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.error, 'einddatum-in-het-verleden');
    r = await beheer('eigenaar', '/beheer/aanvraag', { oid: o3, toegangTot: Date.now() + D }); assert.strictEqual(r.status, 200);
  });

  await test('/toegang is dicht voor een verlopen of ingetrokken meekijker; /track begrensd', async () => {
    const env = envMet({ TRACK_DB: { prepare: () => ({ bind: () => ({}) }), batch: async () => [] } }), oid = OID_K(14), oid2 = OID_K(15);
    await zetMeekijker(env, oid, { toegangTot: Date.now() - 1000 }); await zetMeekijker(env, oid2, { active: false });
    for (const o of [oid, oid2]) {
      const tok = await maakToken({ oid: o, preferred_username: 'coach@example.org' });
      assert.strictEqual((await roepFetch(env, tok, '/toegang', { method: 'POST', body: '{}' })).status, 403);
      assert.strictEqual((await roepFetch(env, tok, '/track', { method: 'POST', body: '{"events":[]}' })).status, 403, 'geen rol: ook /track dicht');
      assert.strictEqual((await roepFetch(env, tok, '/klanten')).status, 403);
    }
    const ok = OID_K(16); await zetMeekijker(env, ok);
    const tk = await maakToken({ oid: ok, preferred_username: 'coach@example.org' });
    assert.strictEqual((await roepFetch(env, tk, '/track', { method: 'POST', body: JSON.stringify({ events: [], pad: 'x'.repeat(300000) }) })).status, 413);
    assert.strictEqual((await roepFetch(env, tk, '/track', { method: 'POST', body: '{"events":[]}' })).status, 200);
  });

  await test('einddatum JJJJ-MM-DD = einde van die dag in Europe/Amsterdam (zomer- en wintertijd)', () => {
    const iso = ymd => new Date(eindeDagAmsterdam(ymd)).toISOString();
    assert.strictEqual(iso('2026-07-01'), '2026-07-01T21:59:59.999Z');
    assert.strictEqual(iso('2026-12-31'), '2026-12-31T22:59:59.999Z');
    assert.strictEqual(iso('2026-03-28'), '2026-03-28T22:59:59.999Z');
    assert.strictEqual(iso('2026-03-29'), '2026-03-29T21:59:59.999Z');
    assert.strictEqual(iso('2026-10-25'), '2026-10-25T22:59:59.999Z');
    assert.ok(Number.isNaN(eindeDagAmsterdam('2026-02-30'))); assert.ok(Number.isNaN(eindeDagAmsterdam('26-1-1')));
    assert.strictEqual(toegangTotNorm('2026-02-30').fout, 'ongeldige-einddatum');
  });

  // ── Brok 3: kijklog ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const d1 = () => {
    const kijklog = [], events = [];
    return { kijklog, events, prepare(sql) {
      return { bind(...a) {
        return {
          async run() {
            if (/^INSERT INTO kijklog/.test(sql)) { const [ts, oid, user, methode, route, target, actie, status, ua] = a; kijklog.push({ ts, oid, user, methode, route, target, actie, status, ua }); }
            else if (/^DELETE FROM kijklog/.test(sql)) { for (let i = kijklog.length - 1; i >= 0; i--) if (kijklog[i].ts < a[0]) kijklog.splice(i, 1); }
            return {};
          },
          async all() {
            if (/FROM kijklog/.test(sql) && !/FROM events/.test(sql)) { const [oid, van, tot, lim] = a; return { results: kijklog.filter(r => r.oid === oid && r.ts >= van && r.ts <= tot).sort((x, y) => x.ts - y.ts).slice(0, lim) }; }
            if (/FROM events/.test(sql)) { const [van, tot, oid, lim] = a; const users = new Set(kijklog.filter(r => r.oid === oid).map(r => r.user)); return { results: events.filter(e => e.ts >= van && e.ts <= tot && users.has(e.user) && ['tab', 'project'].includes(e.event)).sort((x, y) => x.ts - y.ts).slice(0, lim) }; }
            return { results: [] };
          },
        };
      } };
    } };
  };

  await test('kijklog: elk meekijker-verzoek (ook geweigerd) krijgt een serverregel zonder query of inhoud; team en heartbeat niet', async () => {
    const db = d1(), env = envMet({ TRACK_DB: db }), oid = OID_K(20); await zetMeekijker(env, oid);
    const tok = await maakToken({ oid, preferred_username: 'coach@example.org', name: 'Coach' });
    await roepFetch(env, tok, '/?target=toggl_focus&path=' + encodeURIComponent('organizations/1/workspaces/2/tasks?page=1&zoek=geheimeklant'));
    await roepFetch(env, tok, '/?target=moneybird&path=' + encodeURIComponent(MB_ADMIN + '/contacts'));
    await roepFetch(env, tok, '/?target=claude', { method: 'POST', body: '{"messages":[{"content":"topgeheim"}]}' });
    await roepFetch(env, tok, '/geld/tijdlijn?van=2026-01-01');
    await roepFetch(env, tok, '/track/heartbeat', { method: 'POST', body: '{}' });
    await roepFetch(env, tok, '/track', { method: 'POST', body: '{"events":[]}' });
    await roepFetch(env, tok, '/me');
    assert.strictEqual(db.kijklog.length, 5, JSON.stringify(db.kijklog.map(r => r.route + ' ' + r.status)));
    const tekst = JSON.stringify(db.kijklog);
    assert.ok(!/geheimeklant|topgeheim|page=1|van=2026|messages/.test(tekst), 'geen query of inhoud in de log');
    const r0 = db.kijklog[0]; assert.strictEqual(r0.oid, oid); assert.strictEqual(r0.target, 'toggl_focus'); assert.strictEqual(r0.status, 200); assert.strictEqual(r0.route, '/'); assert.ok(r0.ts > 0);
    assert.strictEqual(r0.actie, 'GET toggl_focus:tasks');
    assert.deepStrictEqual(db.kijklog.map(r => r.status), [200, 403, 403, db.kijklog[3].status, 200]);
    assert.strictEqual(db.kijklog[3].route, '/geld/tijdlijn');
    // team en onbekenden: geen regel
    const k = OID_K(21); await env.MT_ROLLEN.put('user:' + k, JSON.stringify({ oid: k, role: 'kantoor', active: true, lastSeen: Date.now() }));
    const tk = await maakToken({ oid: k, preferred_username: 'kantoor@mortiseandtenon.nl' });
    await roepFetch(env, tk, '/me'); await roepFetch(env, tk, '/?target=toggl_focus&path=tasks');
    const gast = await maakToken({ oid: OID_K(22), preferred_username: 'x@example.org' }); await roepFetch(env, gast, '/klanten');
    assert.strictEqual(db.kijklog.length, 5);
  });

  await test('kijklog: ook een verlopen of ingetrokken meekijker (geweigerde poging) wordt gelogd; zonder TRACK_DB geen fout', async () => {
    const db = d1(), env = envMet({ TRACK_DB: db }), oid = OID_K(23); await zetMeekijker(env, oid, { toegangTot: Date.now() - 1000 });
    const tok = await maakToken({ oid, preferred_username: 'coach@example.org' });
    const r = await roepFetch(env, tok, '/klanten'); assert.strictEqual(r.status, 403);
    assert.strictEqual(db.kijklog.length, 1); assert.strictEqual(db.kijklog[0].status, 403); assert.strictEqual(db.kijklog[0].route, '/klanten');
    const zonder = envMet({}), o2 = OID_K(24); await zetMeekijker(zonder, o2);
    const t2 = await maakToken({ oid: o2, preferred_username: 'coach@example.org' });
    assert.strictEqual((await roepFetch(zonder, t2, '/me')).status, 200);
    const kapot = envMet({ TRACK_DB: { prepare() { throw new Error('D1 down'); } } }), o3 = OID_K(25); await zetMeekijker(kapot, o3);
    const t3 = await maakToken({ oid: o3, preferred_username: 'coach@example.org' });
    assert.strictEqual((await roepFetch(kapot, t3, '/me')).status, 200, 'een D1-fout houdt het antwoord niet op');
  });

  await test('kijkoverzicht: alleen de eigenaar; tijdlijn per dag met tab/project (met duur) en gegroepeerde serverregels', async () => {
    const db = d1(), env = envMet({ TRACK_DB: db }), oid = OID_K(26), user = 'coach@example.org';
    const nu = Date.now(), t0 = nu - 3600e3;
    const rij = (ts, route, target, actie, status) => db.kijklog.push({ ts, oid, user, methode: 'GET', route, target, actie, status });
    rij(t0, '/geld/tijdlijn', null, null, 200); rij(t0 + 1000, '/geld/cijfers', null, null, 200); rij(t0 + 2000, '/geld/cijfers/detail', null, null, 403);
    rij(t0 + 5000, '/', 'toggl_focus', 'GET toggl_focus:tasks', 200); rij(t0 + 6000, '/', 'moneybird', 'GET moneybird:sales_invoices', 200);
    db.kijklog.push({ ts: t0, oid: OID_K(27), user: 'ander@example.org', methode: 'GET', route: '/geld/tijdlijn', status: 200 });
    const ev = (ts, event, action, detail, ms) => db.events.push({ ts, event, action, detail, ms: ms || null, user });
    ev(t0 + 100, 'tab', 'tab_open', 'geld'); ev(t0 + 100 + 60000, 'tab', 'tab_dwell', 'geld', 60000);
    ev(t0 + 70000, 'project', 'project_open', 'P-1001'); ev(t0 + 70000 + 30000, 'project', 'project_dwell', 'P-1001', 30000);
    ev(t0 + 99000, 'tab', 'tab_open', 'projecten');
    db.events.push({ ts: t0 + 50, event: 'tab', action: 'tab_open', detail: 'inbox', user: 'ander@example.org' }, { ts: t0, event: 'action', action: 'factuur_boeken', detail: 'x', user });
    const ik = rol => ({ rol, oid: 'oid-' + rol, email: rol + '@example.com', rec: { naam: rol } });
    const vraag = (rol, qs) => handleBeheer('/beheer/kijklog', { method: 'GET', url: 'https://x.test/beheer/kijklog?' + qs, json: async () => ({}) }, env, ik(rol), json0);
    assert.strictEqual((await vraag('beheerder', `oid=${oid}`)).status, 403);
    assert.strictEqual((await vraag('kantoor', `oid=${oid}`)).status, 403);
    assert.strictEqual((await vraag('eigenaar', 'oid=geen-guid')).status, 400);
    assert.strictEqual((await vraag('eigenaar', `oid=${oid}&van=2020-01-01&tot=2026-11-02`)).status, 400, 'periode > 180 dagen');
    const r = await vraag('eigenaar', `oid=${oid}`); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.bewaartermijn_dagen, 180); assert.strictEqual(r.body.verzoeken, 5);
    const items = r.body.dagen.flatMap(d => d.items);
    const geld = items.find(i => i.bron === 'server' && i.label === 'Financiën / Forecast'); assert.strictEqual(geld.n, 3); assert.strictEqual(geld.geweigerd, 1);
    assert.ok(items.some(i => i.bron === 'server' && i.label === 'Projecten / planning (Toggl)' && i.n === 1));
    assert.ok(items.some(i => i.bron === 'server' && i.label === 'Moneybird'));
    const tab = items.find(i => i.bron === 'tab' && i.label === 'geld'); assert.strictEqual(tab.duur_ms, 60000);
    const pr = items.find(i => i.bron === 'project'); assert.strictEqual(pr.label, 'P-1001'); assert.strictEqual(pr.duur_ms, 30000);
    assert.ok(items.some(i => i.bron === 'tab' && i.label === 'projecten' && i.duur_ms == null), 'laatste tab zonder duur');
    assert.ok(!JSON.stringify(r.body).match(/inbox|ander@|factuur_boeken/), 'niets van andere gebruikers of andere events');
    assert.ok(items.every((i, x, a) => x === 0 || a[x - 1].ts <= i.ts) || r.body.dagen.length > 1, 'op tijd gesorteerd');
    const leeg = await handleBeheer('/beheer/kijklog', { method: 'GET', url: `https://x.test/beheer/kijklog?oid=${oid}`, json: async () => ({}) }, envMet({}), ik('eigenaar'), json0);
    assert.strictEqual(leeg.status, 503);
  });

  await test('kijklog opruimen: ouder dan 180 dagen weg, rest blijft; labels', async () => {
    const db = d1(), env = { TRACK_DB: db }, nu = Date.now();
    db.kijklog.push({ ts: nu - 181 * D, oid: 'a' }, { ts: nu - 179 * D, oid: 'a' }, { ts: nu, oid: 'a' });
    await kijkOpruimen(env); assert.strictEqual(db.kijklog.length, 2); assert.ok(db.kijklog.every(r => r.ts > nu - 180 * D));
    await kijkOpruimen({}); // geen binding: geen fout
    assert.strictEqual(kijkLabel({ route: '/geld/tijdlijn' }), 'Financiën / Forecast');
    assert.strictEqual(kijkLabel({ route: '/', target: 'toggl_reports' }), 'Uren (rapporten)');
    assert.strictEqual(kijkLabel({ route: '/', target: 'toggl_focus', actie: 'POST toggl_focus:reports/workspaces' }), 'Uren (rapporten)');
    assert.strictEqual(kijkLabel({ route: '/spiegel/mt_projecten' }), 'Gegevens: mt_projecten');
    const tl = bouwTijdlijn([], [{ ts: 1000, action: 'project_dwell', detail: 'P-2', ms: 500 }, { ts: 2000, action: 'tab_dwell', detail: 'x', ms: 0 }, { ts: 3000, action: 'ander', detail: 'y' }]);
    assert.strictEqual(tl.length, 1); assert.strictEqual(tl[0].items.length, 1, 'dwell zonder open = eigen item; ms 0 en onbekende acties genegeerd');
  });

  // ── Brok 4 (Codex-ronde 2): lastSeen los van user:{oid}; aanvraag gekoppeld aan het id van de uitnodiging ───────────────────────
  await test('laatst gezien: eigen record seen:{oid}; user:{oid} wordt door verkeer nooit geschreven (geen race met intrekken of einddatum)', async () => {
    const env = envMet({}), oid = OID_K(30);
    await zetMeekijker(env, oid, { lastSeen: undefined });
    const voor = await env.MT_ROLLEN.get('user:' + oid);
    const tok = await maakToken({ oid, preferred_username: 'coach@example.org' });
    assert.strictEqual((await roepFetch(env, tok, '/me')).body.rol, 'meekijker');
    assert.strictEqual(await env.MT_ROLLEN.get('user:' + oid), voor, 'user-record onaangeroerd');
    const seen = JSON.parse(await env.MT_ROLLEN.get('seen:' + oid)); assert.strictEqual(seen.oid, oid); assert.ok(Date.now() - seen.ts < 5000);
    // intrekken tussen twee verzoeken: het volgende verzoek (na de cache van 5 s) schrijft het niet terug
    await env.MT_ROLLEN.put('user:' + oid, JSON.stringify({ ...JSON.parse(voor), active: false }));
    await new Promise(r => setTimeout(r, 5100));
    assert.strictEqual((await roepFetch(env, tok, '/me')).body.rol, null);
    assert.strictEqual(JSON.parse(await env.MT_ROLLEN.get('user:' + oid)).active, false, 'blijft gedeactiveerd');
    // Beheer toont de tijd uit seen:
    const adm = await handleBeheer('/beheer/gebruikers', { method: 'GET', url: 'https://x.test/beheer/gebruikers', json: async () => ({}) }, env, { rol: 'eigenaar', oid: 'o', email: 'e@example.com', rec: {} }, json0);
    assert.strictEqual(adm.body.gebruikers.find(g => g.oid === oid).lastSeen, seen.ts);
  });

  await test('aanvraag hoort bij het id van de uitnodiging: ingetrokken, vervangen of verlopen uitnodiging = aanvraag ongeldig; nieuwe uitnodiging werkt', async () => {
    const env = envMet({}), tot = Date.now() + 20 * D, oid = OID_K(31), mailadres = 'nieuw@example.org';
    const ikE = rol => ({ rol, oid: 'oid-' + rol, email: rol + '@example.com', rec: { naam: rol } });
    const beheer = (p, body) => handleBeheer(p, { method: 'POST', url: 'https://x.test' + p, json: async () => body }, env, ikE('eigenaar'), json0);
    const nodig = async () => (await beheer('/beheer/uitnodigen', { email: mailadres, rol: 'meekijker', toegangTot: tot })).body.uitnodiging;
    const tok = await maakToken({ oid, preferred_username: mailadres, name: 'Nieuw' });
    const loginEnAanvraag = async () => { await roepFetch(env, tok, '/me'); return JSON.parse(await env.MT_ROLLEN.get('aanvraag:' + oid)); };
    // 1. intrekken van de uitnodiging ruimt de aanvraag op
    const i1 = await nodig(); assert.ok(i1.id && i1.id.length >= 8);
    let a = await loginEnAanvraag(); assert.strictEqual(a.inviteId, i1.id);
    let r = await beheer('/beheer/uitnodiging-intrekken', { email: mailadres }); assert.strictEqual(r.status, 200);
    assert.strictEqual(await env.MT_ROLLEN.get('aanvraag:' + oid), null, 'aanvraag weg met de uitnodiging');
    // 2. aanvraag blijft staan terwijl de uitnodiging verdween (bv. TTL) = goedkeuren mislukt (409) en de aanvraag wordt opgeruimd
    await env.MT_ROLLEN.put('aanvraag:' + oid, JSON.stringify(a));
    r = await beheer('/beheer/aanvraag', { oid }); assert.strictEqual(r.status, 409); assert.strictEqual(r.body.error, 'uitnodiging-ongeldig');
    assert.strictEqual(await env.MT_ROLLEN.get('aanvraag:' + oid), null); assert.strictEqual(await env.MT_ROLLEN.get('user:' + oid), null);
    // 3. nieuwe uitnodiging (ander id) -> nieuwe aanvraag; een oude aanvraag met het oude id is ongeldig, ook al bestaat er weer een uitnodiging
    const i2 = await nodig(); assert.notStrictEqual(i2.id, i1.id);
    await env.MT_ROLLEN.put('aanvraag:' + oid, JSON.stringify(a));   // oude aanvraag (oud id)
    r = await beheer('/beheer/aanvraag', { oid }); assert.strictEqual(r.status, 409, 'oud id past niet bij de nieuwe uitnodiging');
    assert.ok(await env.MT_ROLLEN.get('invite:' + mailadres), 'nieuwe uitnodiging blijft staan');
    // 4. na een nieuwe uitnodiging maakt de volgende login een verse aanvraag, ook als er nog een oude lag
    await env.MT_ROLLEN.put('aanvraag:' + oid, JSON.stringify(a));
    a = await loginEnAanvraag(); assert.strictEqual(a.inviteId, i2.id, 'aanvraag overschreven met het nieuwe id');
    // 5. weigeren van een oude aanvraag verwijdert een nieuwere uitnodiging NIET
    const oud = { ...a, inviteId: i1.id }; await env.MT_ROLLEN.put('aanvraag:' + oid, JSON.stringify(oud));
    r = await beheer('/beheer/aanvraag', { oid, weigeren: true }); assert.strictEqual(r.status, 200);
    assert.ok(await env.MT_ROLLEN.get('invite:' + mailadres), 'nieuwere uitnodiging blijft');
    // 6. verlopen uitnodigingstermijn: goedkeuren mislukt
    a = await loginEnAanvraag();
    const inv = JSON.parse(await env.MT_ROLLEN.get('invite:' + mailadres)); await env.MT_ROLLEN.put('invite:' + mailadres, JSON.stringify({ ...inv, verloopt: Date.now() - 1 }));
    r = await beheer('/beheer/aanvraag', { oid }); assert.strictEqual(r.status, 409);
    // 7. een goede keten werkt nog steeds
    await beheer('/beheer/uitnodigen', { email: mailadres, rol: 'meekijker', toegangTot: tot });
    a = await loginEnAanvraag();
    r = await beheer('/beheer/aanvraag', { oid }); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.gebruiker.role, 'meekijker'); assert.strictEqual(r.body.gebruiker.toegangTot, tot);
    assert.strictEqual(await env.MT_ROLLEN.get('invite:' + mailadres), null);
  });

  await test('Moneybird: contact is een allowlist (id, bedrijfsnaam, voor-/achternaam); een nieuw veld lekt niet', () => {
    const c = mbMagerDoc({ contact: { id: '1', company_name: 'X BV', nieuw_veld: 'lek', address1: 'a', bank_account: 'b' } }).contact;
    assert.deepStrictEqual(c, { id: '1', company_name: 'X BV' });
  });

  globalThis.fetch = echteFetch;

  console.log(`\n${n} tests geslaagd`);
})();
