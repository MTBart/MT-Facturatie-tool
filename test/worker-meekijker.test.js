// Worker-tests rol Meekijker: matrix, altijd afdwingen, einddatum, gastadres, Beheer-regels, /geld en /push dicht.
// Draaien: node test/worker-meekijker.test.js  — verzonnen ids en namen.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const { pathToFileURL } = require('url');

(async () => {
  const bron = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8')
    + '\nexport { requirePermission, effectieveModus, bepaalRol, handleBeheer, handleGeld, handleSignalen, handleKlanten, meAntwoord, toegangTotNorm, tokenAdressen, RECHTEN, ROLLEN, MB_ADMIN };\n';
  const tmp = path.join(os.tmpdir(), `mt-worker-meekijker-${process.pid}.mjs`); fs.writeFileSync(tmp, bron, 'utf8');
  let W; try { W = await import(pathToFileURL(tmp).href); } finally { try { fs.unlinkSync(tmp); } catch { } }
  const { requirePermission: rp, effectieveModus, bepaalRol, handleBeheer, handleGeld, handleSignalen, handleKlanten, meAntwoord, toegangTotNorm, tokenAdressen, RECHTEN, ROLLEN, MB_ADMIN } = W;

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
    assert.strictEqual(rp('meekijker', 'toggl_reports', 'POST', 'workspace/1/summary/time_entries').ok, true);
    assert.strictEqual(rp('meekijker', 'toggl_reports', 'GET', 'x').ok, true);
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
    for (const p of ['contacts', 'contacts/9', 'documents/purchase_invoices/1/attachments/2', 'documents/purchase_invoices/1/attachments/2/download', 'financial_accounts', 'sales_invoices/5/send_invoice'])
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
      await env.MT_ROLLEN.put('invite:jan@example.org', JSON.stringify({ email: 'jan@example.org', role: 'meekijker', naam: 'Jan', createdBy: 'o', verloopt: Date.now() + D, toegangTot: tot }));
      const pl = { oid: '33333333-3333-3333-3333-33333333333' + (++teller), ...claims };
      const ik = await bepaalRol(env, pl, null);
      assert.strictEqual(ik.rol, 'meekijker', JSON.stringify(claims)); assert.strictEqual(ik.rec.toegangTot, tot); assert.strictEqual(ik.rec.email, 'jan@example.org');
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

  console.log(`\n${n} tests geslaagd`);
})();
