// Tests kijkmodus (mt-kijk.js): netwerktoets, Graph dicht, SharePoint-laag vervangen door de spiegel, start/rolbepaling.
// Draaien: node test/kijk.test.js  — verzonnen gegevens. De volledige browser-proef staat in tools/kijktest.mjs.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
let n = 0; const test = async (naam, fn) => { try { await fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };
const W = 'https://w.test';

// Een kleine nagebootste browser: alleen wat mt-kijk.js nodig heeft (geen DOM).
const maakWin = (opt = {}) => {
  const aanroepen = [];
  const win = { setTimeout, clearTimeout, console, JSON, Date, Promise, URL, Response: class { constructor(b, i) { this.body = b; this.status = (i && i.status) || 200; this.ok = this.status < 300; } async json() { return JSON.parse(this.body); } }, location: { href: 'https://app.test/v2.html' } };
  win.window = win;
  win.fetch = async (u, i) => { aanroepen.push({ u: String(u), m: (i && i.method) || 'GET' }); return { ok: true, status: 200, json: async () => ({}) }; };
  win._msal = { getAllAccounts: () => [{ username: opt.gebruiker || 'collega@mortiseandtenon.nl' }] };
  win.authHeader = async () => ({ 'X-Auth-Token': 't' });
  win.fetchMetAuth = u => win.fetch(u, {});
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'mt-kijk.js'), 'utf8'), win);
  win.MTKijk._worker = W;
  return { win, K: win.MTKijk, aanroepen };
};

(async () => {
  await test('routeMag: lezen mag naar de leesroutes, de Reports-POST\'s en /track; al het andere schrijven en Graph is dicht', () => {
    const { K } = maakWin();
    const mag = (u, m) => K.routeMag(u, m || 'GET').ok;
    for (const p of ['/me', '/klanten', '/instellingen', '/teller/status', '/teller/werkcodes', '/signalen', '/zoek/moneybird?q=abc', '/geld/tijdlijn?van=1', '/geld/cijfers/detail', '/spiegel/_index', '/spiegel/mt_projecten'])
      assert.ok(mag(W + p), 'GET ' + p);
    for (const t of ['toggl', 'toggl_focus', 'toggl_admin_projects', 'moneybird']) assert.ok(mag(`${W}/?target=${t}&path=x`), t);
    assert.ok(mag(`${W}/?target=toggl_reports&path=${encodeURIComponent('workspace/12/search/time_entries')}`, 'POST'));
    assert.ok(mag(`${W}/?target=toggl_focus&path=${encodeURIComponent('reports/workspaces/12/query')}`, 'POST'));
    assert.ok(mag(`${W}/track`, 'POST') && mag(`${W}/track/heartbeat`, 'POST'));
    // dicht
    for (const [p, m] of [['/beheer/gebruikers', 'GET'], ['/beheer/kijklog', 'GET'], ['/aanwezig', 'GET'], ['/mijn/toggl', 'GET'], ['/push/sleutel', 'GET'], ['/track/usage', 'GET'], ['/track/online', 'GET'], ['/dashboard/cashflow', 'GET'], ['/?target=claude', 'POST'], ['/?target=claude', 'GET'],
      ['/?target=moneybird_download&factuur_id=1', 'GET'], ['/?target=moneybird_upload&path=x', 'POST'], ['/?target=moneybird&path=x', 'POST'], ['/?target=moneybird&path=x', 'DELETE'], ['/?target=toggl_focus&path=tasks/1', 'PATCH'], ['/?target=toggl_focus&path=tasks', 'POST'],
      ['/?target=toggl&path=x', 'POST'], ['/?target=toggl_reports&path=workspace/1/summary/time_entries', 'POST'], ['/?target=toggl_reports&path=workspace/1/search/time_entries', 'PUT'], ['/geld/rapport/vraag', 'POST'], ['/geld/schets', 'POST'],
      ['/klanten', 'POST'], ['/spiegel/mt_projecten', 'POST'], ['/signalen/actie', 'POST'], ['/toegang', 'POST'], ['/teller/werkcode', 'POST'], ['/instellingen', 'POST'], ['/track', 'GET']])
      assert.ok(!mag(W + p, m), m + ' ' + p);
    // Graph en SharePoint: nooit, ook geen GET
    for (const u of ['https://graph.microsoft.com/v1.0/me', 'https://mortisetenon.sharepoint.com/sites/x', 'https://x-my.sharepoint.com/y', 'https://outlook.office.com/api', 'https://onedrive.live.com/x', 'https://1drv.ms/x'])
      for (const m of ['GET', 'POST', 'PUT']) assert.ok(!mag(u, m), m + ' ' + u);
    // overig: lezen vrij (scripts, lettertypen), schrijven alleen naar de MSAL-login
    assert.ok(mag('https://cdnjs.cloudflare.com/x.js')); assert.ok(!mag('https://example.com/api', 'POST')); assert.ok(mag('https://login.microsoftonline.com/t/oauth2/v2.0/token', 'POST'));
    assert.ok(mag('data:text/plain,x')); assert.ok(mag('vendor/msal.js'));   // relatief = eigen site
    assert.ok(!mag('vendor/x.json', 'POST'));
  });

  await test('guards: fetch, XHR en sendBeacon worden getoetst; een geweigerd verzoek bereikt het netwerk niet (synthetische 403)', async () => {
    const { win, K, aanroepen } = maakWin();
    win.navigator = { sendBeacon: () => true }; const beacons = []; win.navigator.sendBeacon = (u) => { beacons.push(u); return true; };
    win.XMLHttpRequest = function () { }; win.XMLHttpRequest.prototype.open = function () { this.geopend = true; };
    K.installeerGuards(); K.installeerGuards();   // twee keer: geen dubbele omhulling
    let r = await win.fetch('https://graph.microsoft.com/v1.0/me'); assert.strictEqual(r.status, 403); assert.strictEqual((await r.json()).error, 'alleen-inkijken');
    r = await win.fetch(W + '/?target=moneybird&path=x', { method: 'POST', body: '{}' }); assert.strictEqual(r.status, 403);
    assert.strictEqual(aanroepen.length, 0, 'niets naar het netwerk');
    r = await win.fetch(W + '/spiegel/mt_projecten'); assert.strictEqual(r.status, 200); assert.strictEqual(aanroepen.length, 1);
    assert.strictEqual(aanroepen.filter(a => a.m !== 'GET').length, 0);
    assert.throws(() => new win.XMLHttpRequest().open('GET', 'https://mortisetenon.sharepoint.com/x'), /alleen-inkijken/);
    const x = new win.XMLHttpRequest(); x.open('GET', W + '/me'); assert.ok(x.geopend);
    assert.strictEqual(win.navigator.sendBeacon(W + '/beheer/x', 'd'), false); assert.strictEqual(beacons.length, 0);
    assert.strictEqual(win.navigator.sendBeacon(W + '/track', 'd'), true); assert.strictEqual(beacons.length, 1);
    assert.ok(K.geblokkeerd.length >= 4 && K.geblokkeerd.every(g => !/\?/.test(g.url)), 'bijgehouden zonder querystring');
    assert.ok(K.geblokkeerd.some(g => g.reden === 'schrijven'));
  });

  await test('Graph dicht: een meekijker en een #EXT#-gast krijgen nooit een token (de oorspronkelijke functie wordt niet aangeroepen); het team wel', async () => {
    for (const [gebruiker, aan, verwacht] of [['collega@mortiseandtenon.nl', false, 'TOKEN'], ['collega@mortiseandtenon.nl', true, null], ['coach_example.org#EXT#@example.net', false, null]]) {
      const { win, K } = maakWin({ gebruiker }); let n_ = 0;
      win.getGraphToken = async () => { n_++; return 'TOKEN'; };
      K.bewaakGraph(); K.bewaakGraph();
      if (aan) K.aan = true;
      assert.strictEqual(await win.getGraphToken(), verwacht, gebruiker + ' ' + aan);
      assert.strictEqual(n_, verwacht ? 1 : 0);
    }
    // wacht op /me voor de eerste aanvraag: zodra de rol 'meekijker' blijkt, geen token
    const { win, K } = maakWin(); let n_ = 0; win.getGraphToken = async () => { n_++; return 'TOKEN'; }; K.bewaakGraph();
    let los; K._rolWacht = new Promise(r => { los = r; });
    const p = win.getGraphToken(); K.aan = true; los(); assert.strictEqual(await p, null); assert.strictEqual(n_, 0);
  });

  await test('SharePoint-laag: lezen uit de spiegel, schrijven doet niets, buiten laag 1 niet leesbaar, geen netwerk naar Graph', async () => {
    const { win, K } = maakWin();
    const gevraagd = [];
    win.fetchMetAuth = async u => { gevraagd.push(u); const s = decodeURIComponent(u.split('/spiegel/')[1]);
      if (s === 'mt_projecten') return { ok: true, status: 200, json: async () => ({ ts: 1700000000000, data: [{ code: 'P1' }] }) };
      if (s === 'mt_planning') return { ok: false, status: 404, json: async () => ({}) };
      if (s === 'mt_klant_codes') return { ok: true, status: 200, json: async () => ({ ts: 1, data: 'tekst' }) };
      return { ok: false, status: 500, json: async () => ({}) }; };
    let gelezen = 0; const sp = { read: async () => { gelezen++; return 'sharepoint'; }, prefetch: async () => { gelezen++; return new Map(); }, write: async () => { gelezen++; return true; }, maakAan: async () => 'aangemaakt', _driveBase: async () => ({ base: 'x', token: 'y' }), schedule: () => { gelezen++; }, _resolveConflict: async () => true };
    K.koppelSP(sp, { worker: W }); assert.ok(!sp._kijk, 'nog niet actief');
    K.activeer({ rol: 'meekijker' }); assert.ok(sp._kijk);
    assert.strictEqual(JSON.stringify(await sp.read('mt_projecten.json')), '[{"code":"P1"}]');
    await assert.rejects(sp.read('mt_planning.json'), /Spiegel: nog-geen-gegevens/);
    await assert.rejects(sp.read('mt_voorraad.json'), /niet-beschikbaar/); await assert.rejects(sp.read('mt_mail_links.json'), /niet-beschikbaar/); await assert.rejects(sp.read('mt_adminconfig.json'), /niet-beschikbaar/);
    await assert.rejects(sp.read('mt_klant_codes.json'), /onleesbaar/);
    const map = await sp.prefetch(['mt_projecten.json', 'mt_planning.json', 'mt_voorraad.json', 'mt_klant_codes.json']);
    assert.strictEqual(JSON.stringify(map.get('mt_projecten.json')), '{"ok":true,"status":200,"data":[{"code":"P1"}]}');
    for (const f of ['mt_planning.json', 'mt_voorraad.json', 'mt_klant_codes.json']) assert.strictEqual(map.get(f).ok, false, f);
    assert.strictEqual(await sp.write('a.json', {}), false); assert.strictEqual(await sp.maakAan('a.json', {}), false); assert.strictEqual(await sp._resolveConflict('a.json', {}), false);
    await assert.rejects(sp._driveBase(), /alleen-inkijken/); sp.schedule('x');
    assert.strictEqual(gelezen, 0, 'de oorspronkelijke SharePoint-functies zijn nooit aangeroepen');
    assert.ok(gevraagd.every(u => u.startsWith(W + '/spiegel/')), 'alleen /spiegel');
    // stand: oudste ts van wat geladen is; zonder kern "nog geen gegevens"
    assert.strictEqual(K.stand().oudste, 1700000000000); assert.strictEqual(K.stand().geenKern, false);
    const leeg = maakWin(); leeg.K.koppelSP({ read() { } }, { worker: W }); assert.strictEqual(leeg.K.stand().geenKern, true);
    // activeren achteraf (SP al gekoppeld, rol later): ook gepatcht; tweede keer niets bijzonders
    const b = maakWin(); const sp2 = { read: async () => 'sp', write: async () => true, prefetch: async () => new Map() }; b.K.activeer({}); b.K.koppelSP(sp2, { worker: W }); assert.strictEqual(await sp2.write('x', {}), false);
  });

  await test('voorStart: meekijker -> kijkmodus; team -> niets verandert; #EXT#-gast -> guards direct; /me stuk of traag -> doorgaan', async () => {
    const meVan = me => { const t = maakWin(); t.win.fetch = async (u, i) => { t.aanroepen.push({ u: String(u), m: (i && i.method) || 'GET' }); return { ok: !!me, status: me ? 200 : 500, json: async () => me }; }; return t; };
    let t = meVan({ rol: 'meekijker', modus: 'afdwingen' }); t.win.MTRol = { laad: async () => { t.laadde = true; return {}; } };
    await t.K.voorStart({ username: 'x@mortiseandtenon.nl' }, W); assert.strictEqual(t.K.aan, true); assert.ok(t.laadde, 'MTRol.laad legt de rol vast');
    t = meVan({ rol: 'kantoor' }); t.win.MTRol = { laad: async () => { t.laadde = true; return {}; } };
    await t.K.voorStart({ username: 'x@mortiseandtenon.nl' }, W); assert.strictEqual(t.K.aan, false); assert.ok(!t.laadde, 'team: MTRol.laad niet vervroegd'); assert.strictEqual(t.K._guards, false);
    t = meVan({ rol: null }); await t.K.voorStart({ username: 'jan_example.org#EXT#@example.net' }, W); assert.strictEqual(t.K._guards, true); assert.strictEqual(t.K.aan, false);
    t = meVan(null); await t.K.voorStart({ username: 'x@mortiseandtenon.nl' }, W); assert.strictEqual(t.K.aan, false);
    assert.strictEqual(await meVan({ rol: 'meekijker' }).K.isMeekijker(W), true); assert.strictEqual(await meVan({ rol: 'kantoor' }).K.isMeekijker(W), false); assert.strictEqual(await meVan(null).K.isMeekijker(W), false);
    t = maakWin(); t.win.fetch = () => new Promise(() => { });   // /me hangt: na 3 s verder
    const start = Date.now(); await t.K.voorStart({ username: 'x@mortiseandtenon.nl' }, W); assert.ok(Date.now() - start >= 2900 && Date.now() - start < 6000);
  });

  await test('mt-rollen: verlopen, wachtend op goedkeuring en een externe gast zonder rol krijgen de "geen toegang"-pagina, ook in log-modus; een intern team in log niet', () => {
    const win = { console, JSON }; win.window = win; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'mt-rollen.js'), 'utf8'), win);
    const R = win.MTRol, nodig = me => { R.me = me; return R.geenToegangNodig(); };
    assert.strictEqual(nodig({ actief: false, reden: 'verlopen', modus: 'log' }), true);
    assert.strictEqual(nodig({ actief: false, reden: 'wacht-op-goedkeuring', modus: 'log' }), true);
    assert.strictEqual(nodig({ actief: false, reden: 'onbekend', modus: 'log', extern: true }), true);
    assert.strictEqual(nodig({ actief: false, reden: 'onbekend', modus: 'log' }), false, 'intern zonder rol in log: als vroeger');
    assert.strictEqual(nodig({ actief: false, reden: 'gedeactiveerd', modus: 'log' }), false);
    assert.strictEqual(nodig({ actief: false, reden: 'onbekend', modus: 'afdwingen' }), true);
    assert.strictEqual(nodig({ actief: true, rol: 'meekijker', modus: 'afdwingen' }), false);
  });
  console.log(`\n${n} tests geslaagd`);
  process.exit(process.exitCode || 0);
})();
