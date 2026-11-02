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
      if (s === 'mt_vrijedagen') return { ok: true, status: 200, json: async () => ({ ts: 1, data: 'tekst' }) };
      return { ok: false, status: 500, json: async () => ({}) }; };
    let gelezen = 0; const sp = { read: async () => { gelezen++; return 'sharepoint'; }, prefetch: async () => { gelezen++; return new Map(); }, write: async () => { gelezen++; return true; }, maakAan: async () => 'aangemaakt', _driveBase: async () => ({ base: 'x', token: 'y' }), schedule: () => { gelezen++; }, _resolveConflict: async () => true };
    K.koppelSP(sp, { worker: W }); assert.ok(!sp._kijk, 'nog niet actief');
    K.activeer({ rol: 'meekijker' }); assert.ok(sp._kijk);
    assert.strictEqual(JSON.stringify(await sp.read('mt_projecten.json')), '[{"code":"P1"}]');
    await assert.rejects(sp.read('mt_planning.json'), /Spiegel: nog-geen-gegevens/);
    await assert.rejects(sp.read('mt_voorraad.json'), /niet-beschikbaar/); await assert.rejects(sp.read('mt_mail_links.json'), /niet-beschikbaar/); await assert.rejects(sp.read('mt_adminconfig.json'), /niet-beschikbaar/);
    await assert.rejects(sp.read('mt_vrijedagen.json'), /onleesbaar/);
    const map = await sp.prefetch(['mt_projecten.json', 'mt_planning.json', 'mt_voorraad.json', 'mt_vrijedagen.json']);
    assert.strictEqual(JSON.stringify(map.get('mt_projecten.json')), '{"ok":true,"status":200,"data":[{"code":"P1"}]}');
    for (const f of ['mt_planning.json', 'mt_voorraad.json', 'mt_vrijedagen.json']) assert.strictEqual(map.get(f).ok, false, f);
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
    let t = meVan({ rol: 'meekijker', modus: 'afdwingen', altijdAfdwingen: true }); t.win.MTRol = { laad: async () => { t.laadde = true; return {}; } };
    await t.K.voorStart({ username: 'x@mortiseandtenon.nl' }, W); assert.strictEqual(t.K.aan, true); assert.ok(t.laadde, 'MTRol.laad legt de rol vast');
    t = meVan({ rol: 'kantoor' }); t.win.MTRol = { laad: async () => { t.laadde = true; return {}; } };
    await t.K.voorStart({ username: 'x@mortiseandtenon.nl' }, W); assert.strictEqual(t.K.aan, false); assert.ok(!t.laadde, 'team: MTRol.laad niet vervroegd'); assert.strictEqual(t.K._guards, false);
    t = meVan({ rol: null }); await t.K.voorStart({ username: 'jan_example.org#EXT#@example.net' }, W); assert.strictEqual(t.K._guards, true); assert.strictEqual(t.K.aan, false);
    t = meVan(null); await t.K.voorStart({ username: 'x@mortiseandtenon.nl' }, W); assert.strictEqual(t.K.aan, false);
    assert.strictEqual(await meVan({ rol: 'meekijker' }).K.isMeekijker(W), true); assert.strictEqual(await meVan({ rol: 'kantoor' }).K.isMeekijker(W), false); assert.strictEqual(await meVan(null).K.isMeekijker(W), false);
    t = maakWin(); t.win.fetch = () => new Promise(() => { });   // /me hangt: na 3 s verder
    const start = Date.now(); await t.K.voorStart({ username: 'x@mortiseandtenon.nl' }, W); assert.ok(Date.now() - start >= 2900 && Date.now() - start < 6000);
  });

  // ── Brok 6: vroege streng-modus, lege geheugenopslag, X-MT-Kijk, herstart, toeslag, calculatie ───────────────────────────────────
  // Een echte-opslag-dubbelganger die elke aanraking telt: de kijkmodus mag er niets van de app uit lezen, in schrijven of wissen.
  const spyOpslag = (inhoud) => {
    const m = new Map(Object.entries(inhoud || {})), log = [];
    const api = { getItem(k) { log.push(['get', String(k)]); return m.has(String(k)) ? m.get(String(k)) : null; }, setItem(k, v) { log.push(['set', String(k)]); m.set(String(k), String(v)); }, removeItem(k) { log.push(['del', String(k)]); m.delete(String(k)); },
      clear() { log.push(['clear']); m.clear(); }, key(i) { log.push(['key', i]); return [...m.keys()][i] ?? null; }, get length() { return m.size; } };
    return { api, m, log };
  };
  const fakeDoc = (scriptAttr) => {
    const attrs = {}, luisteraars = {}, kinderen = [], elementen = {};
    const maakEl = (tag) => { const e = { tag, id: '', textContent: '', style: {}, title: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; }, appendChild(c) { kinderen.push(c); if (c.id) elementen[c.id] = c; return c; }, insertBefore(c) { kinderen.unshift(c); if (c.id) elementen[c.id] = c; return c; }, parentNode: { removeChild(c) { delete elementen[c.id]; const i = kinderen.indexOf(c); if (i >= 0) kinderen.splice(i, 1); } }, classList: { contains: () => false, add() { } } }; return e; };
    const d = { currentScript: scriptAttr ? { getAttribute: k => (k === 'data-kijk' ? scriptAttr : null) } : null, attrs, kinderen, elementen,
      documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; }, appendChild: c => { kinderen.push(c); if (c.id) elementen[c.id] = c; } },
      head: null, body: maakEl('body'), getElementById: id => elementen[id] || null, createElement: maakEl, addEventListener: (t, f) => { (luisteraars[t] = luisteraars[t] || []).push(f); }, querySelector: () => null, querySelectorAll: () => [], luisteraars };
    d.body.appendChild = c => { kinderen.push(c); if (c.id) elementen[c.id] = c; return c; }; d.body.insertBefore = d.body.appendChild;
    return d;
  };
  const MSAL_GAST = 'oid.tid-login.microsoftonline.com-tenant', MSAL_TEAM = 'oid2.tid-login.microsoftonline.com-tenant';
  const maakVroeg = (opt = {}) => {
    const echt = spyOpslag(opt.ls), sess = spyOpslag(opt.sess), doc = fakeDoc(opt.pagina === undefined ? 'v2' : opt.pagina), aanroepen = [], herladen = [];
    const win = { setTimeout, clearTimeout, console, JSON, Date, Promise, URL, Map, Proxy, Object, Array, String, Number, Math,
      Response: class { constructor(b, i) { this.body = b; this.status = (i && i.status) || 200; this.ok = this.status < 300; } async json() { return JSON.parse(this.body); } },
      location: { href: 'https://app.test/v2.html', reload() { herladen.push(1); } }, document: doc, localStorage: echt.api, sessionStorage: sess.api, indexedDB: { open() { } } };
    win.window = win;
    win.fetch = async (u, i) => { aanroepen.push({ u: String(u), m: (i && i.method) || 'GET', h: i && i.headers }); return { ok: true, status: 200, json: async () => ({}) }; };
    win._msal = { getAllAccounts: () => [{ username: opt.gebruiker || 'collega@mortiseandtenon.nl' }] };
    win.authHeader = async () => ({ 'X-Auth-Token': 't' }); win.fetchMetAuth = (u) => win.fetch(u, {});
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'mt-kijk.js'), 'utf8'), win);
    return { win, K: win.MTKijk, echt, sess, doc, aanroepen, herladen };
  };
  const planten = { mt_projecten: JSON.stringify([{ code: 'LOKAAL-1', naam: 'LOKAAL GEPLANT' }]), mt_planning: '{"LOKAAL-1":{}}', 'mt-stijl-keuze': 'oud', mt_uurtarieven: '{"x":1}' };
  const ACT = (h, u, ext, m) => JSON.stringify({ h, u, ext: !!ext, m: !!m });
  const gastCache = () => ({ [MSAL_GAST]: JSON.stringify({ username: 'coach_example.org#EXT#@example.net', homeAccountId: 'oid.tid', name: 'Coach' }), 'mtkijk.actief': ACT('oid.tid', 'coach_example.org#ext#@example.net', true), ...planten });

  await test('lege geheugenopslag: de echte opslag wordt niet gelezen, geschreven of gewist; wat de app schrijft verdwijnt met de pagina; indexedDB weg', () => {
    const t = maakVroeg({ ls: gastCache() });
    const vroeg = t.echt.log.length; assert.strictEqual(t.K.modus, 'streng'); assert.strictEqual(t.K._vroeg, true);
    assert.notStrictEqual(t.win.localStorage, t.echt.api, 'window.localStorage is vervangen');
    // de detectie las alleen MSAL-sleutels (en onze eigen vlag), nooit app-sleutels
    const gelezen = t.echt.log.filter(l => l[0] === 'get').map(l => l[1]); assert.ok(gelezen.every(k => k.includes('login.microsoftonline.com') || k === 'mtkijk.actief'), gelezen.join());
    const ls = t.win.localStorage;
    assert.strictEqual(ls.getItem('mt_projecten'), null); assert.strictEqual(ls.getItem('mt_planning'), null); assert.strictEqual(ls.getItem('mt-stijl-keuze'), null); assert.strictEqual(ls.length, 0); assert.strictEqual(ls.key(0), null);
    ls.setItem('mt_projecten', '[1]'); ls.setItem('x', '2'); assert.strictEqual(ls.getItem('mt_projecten'), '[1]'); assert.strictEqual(ls.length, 2); assert.strictEqual(ls.key(1), 'x'); assert.deepStrictEqual(Object.keys(ls), ['mt_projecten', 'x']); assert.strictEqual(ls.x, '2'); ls.y = 5; assert.strictEqual(ls.getItem('y'), '5');
    ls.removeItem('x'); assert.strictEqual(ls.getItem('x'), null); delete ls.y; assert.strictEqual(ls.length, 1);
    const origSet = ls.setItem; ls.setItem = function (k, v) { return origSet.call(ls, k, v); }; const gebonden = t.win.localStorage.setItem.bind(t.win.localStorage); gebonden('z', '1'); assert.strictEqual(ls.getItem('z'), '1', 'ook de app-truc setItem.bind(localStorage) landt in het geheugen');
    ls.clear(); assert.strictEqual(ls.length, 0);
    assert.strictEqual(t.win.indexedDB, undefined);
    assert.strictEqual(t.echt.log.length, vroeg, 'na installatie nog geen enkele aanraking van de echte opslag'); assert.strictEqual(t.echt.log.filter(l => l[0] !== 'get' && l[0] !== 'key').length, 0, 'nooit geschreven of gewist');
    assert.strictEqual(t.echt.m.get('mt_projecten'), planten.mt_projecten, 'geplante data onaangeroerd'); assert.strictEqual(t.echt.m.size, Object.keys(gastCache()).length);
  });

  await test('vroege detectie: #EXT#-gast of eerder bevestigde meekijker (zelfde account) = streng; een teamlid niet (geen opslag vervangen); alleen op v2', () => {
    let t = maakVroeg({ ls: { [MSAL_TEAM]: JSON.stringify({ username: 'collega@mortiseandtenon.nl' }), ...planten } });
    assert.strictEqual(t.K.modus, null); assert.strictEqual(t.win.localStorage, t.echt.api, 'teamlid: echte opslag blijft'); assert.strictEqual(t.K._guards, false); assert.strictEqual(t.doc.attrs['data-kijk-laden'], undefined);
    t = maakVroeg({ ls: { [MSAL_TEAM]: JSON.stringify({ username: 'coach@example.org', homeAccountId: 'oid2.tid' }), 'mtkijk.actief': ACT('oid2.tid', 'coach@example.org', false, true), ...planten } }); assert.strictEqual(t.K.modus, 'streng', 'bevestigde meekijker = actief account');
    t = maakVroeg({ ls: { [MSAL_TEAM]: JSON.stringify({ username: 'iemand.anders@example.org', homeAccountId: 'oid2.tid' }), 'mtkijk.actief': ACT('oidX.tid', 'coach@example.org', false, true) } }); assert.strictEqual(t.K.modus, null, 'record van een ander account telt niet');
    t = maakVroeg({ ls: { 'mtkijk.actief': ACT('oid2.tid', 'coach@example.org', false, true) } }); assert.strictEqual(t.K.modus, null, 'geen account in de cache');
    // een gast in de cache maakt NIET streng als het actieve account een teamlid is (of er geen record is: /me beslist)
    const bart = { [MSAL_TEAM]: JSON.stringify({ username: 'collega@mortiseandtenon.nl', homeAccountId: 'oid2.tid' }), [MSAL_GAST]: JSON.stringify({ username: 'coach_example.org#EXT#@example.net', homeAccountId: 'oid.tid' }), ...planten };
    t = maakVroeg({ ls: { ...bart, 'mtkijk.actief': ACT('oid2.tid', 'collega@mortiseandtenon.nl', false, false) } });
    assert.strictEqual(t.K.modus, null, 'gast in cache + teamlid actief'); assert.strictEqual(t.win.localStorage, t.echt.api, 'echte opslag blijft'); assert.strictEqual(t.K._guards, false); assert.strictEqual(t.win.indexedDB !== undefined, true);
    t = maakVroeg({ ls: { ...bart } }); assert.strictEqual(t.K.modus, null, 'gast in cache, geen record: niet streng'); assert.strictEqual(t.win.localStorage, t.echt.api);
    t = maakVroeg({ ls: { ...bart, 'mtkijk.actief': '{kapot' } }); assert.strictEqual(t.K.modus, null, 'kapot record');
    t = maakVroeg({ ls: gastCache(), pagina: null }); assert.strictEqual(t.K.modus, null, 'niet op pagina\'s zonder data-kijk (mobiel)'); assert.strictEqual(t.win.localStorage, t.echt.api);
    t = maakVroeg({ ls: { [MSAL_GAST]: '{kapot' } }); assert.strictEqual(t.K.modus, null, 'onleesbare cache-entry');
    t = maakVroeg({ ls: gastCache() }); assert.strictEqual(t.doc.attrs['data-kijk-laden'], '1', 'app verborgen'); assert.ok(t.doc.elementen['mt-kijk-laden'] || t.doc.luisteraars.DOMContentLoaded, 'neutraal laadscherm');
  });

  await test('streng: alleen /me en de Microsoft-login mogen het netwerk op (ook geen Moneybird-GET); na bevestiging de kijkroutes; Graph altijd dicht', async () => {
    const t = maakVroeg({ ls: gastCache() }), K = t.K, W2 = 'https://mt-claude-proxy.bart-a12.workers.dev';
    const mag = (u, m) => K.routeMag(u, m || 'GET').ok;
    assert.ok(mag(W2 + '/me')); assert.ok(mag('https://login.microsoftonline.com/t/oauth2/v2.0/token', 'POST')); assert.ok(mag('https://login.microsoftonline.com/t/discovery'));
    // streng gaat vooraf aan de uitzondering voor externe GET's: ook scripts/lettertypen/eigen site/andere hosts zijn dicht
    for (const u of ['https://app.test/mt-core.js', 'https://fonts.example/x.css', 'https://cdnjs.cloudflare.com/x.js', 'vendor/msal.js', 'data:text/plain,x']) assert.ok(!mag(u), 'streng: ' + u);
    for (const [p, m] of [['/spiegel/mt_projecten', 'GET'], ['/spiegel/_index', 'GET'], ['/klanten', 'GET'], ['/geld/tijdlijn', 'GET'], ['/?target=moneybird&path=1/sales_invoices', 'GET'], ['/?target=toggl_focus&path=tasks', 'GET'], ['/track', 'POST'], ['/me', 'POST'], ['/instellingen', 'GET']])
      assert.ok(!mag(W2 + p, m), 'streng: ' + m + ' ' + p);
    for (const u of ['https://graph.microsoft.com/v1.0/me', 'https://x.sharepoint.com/y']) assert.ok(!mag(u));
    assert.ok(!mag('https://example.com/api', 'POST'));
    let r = await t.win.fetch(W2 + '/klanten'); assert.strictEqual(r.status, 403); assert.strictEqual(t.aanroepen.length, 0, 'bereikt het netwerk niet');
    assert.strictEqual(K.graphDicht(), true);
    // bevestigd als meekijker: de gewone kijkroutes
    K.activeer({ rol: 'meekijker', altijdAfdwingen: true }); assert.strictEqual(K.modus, 'kijk');
    assert.ok(mag(W2 + '/spiegel/mt_projecten')); assert.ok(mag(W2 + '/?target=moneybird&path=1/sales_invoices')); assert.ok(!mag(W2 + '/beheer/gebruikers')); assert.ok(!mag(W2 + '/?target=moneybird&path=x', 'POST'));
    assert.strictEqual(t.doc.attrs['data-kijk-laden'], undefined, 'app zichtbaar na bevestiging'); assert.ok(!t.doc.elementen['mt-kijk-laden']);
  });

  await test('X-MT-Kijk staat op elk verzoek naar de worker (en alleen daar); /me vraagt de rol met de header', async () => {
    const t = maakVroeg({ ls: gastCache() }), K = t.K, W2 = 'https://mt-claude-proxy.bart-a12.workers.dev';
    await t.win.fetch(W2 + '/me', { headers: { 'X-Auth-Token': 'tok' } }); await t.win.fetch('https://app.test/x.js'); await t.win.fetch('https://login.microsoftonline.com/t', { method: 'POST' });
    assert.strictEqual(t.aanroepen[0].h['X-MT-Kijk'], '1'); assert.strictEqual(t.aanroepen[0].h['X-Auth-Token'], 'tok', 'bestaande headers blijven');
    assert.strictEqual(t.aanroepen.length, 2, 'x.js is in de strenge modus geblokkeerd'); assert.ok(/login\.microsoftonline\.com/.test(t.aanroepen[1].u)); assert.ok(!t.aanroepen[1].h || !('X-MT-Kijk' in t.aanroepen[1].h));
    t.aanroepen.length = 0; K._worker = W2; await K.vraagMe(W2); assert.strictEqual(t.aanroepen[0].h['X-MT-Kijk'], '1');
    assert.strictEqual(K.VERSIE, '1');
  });

  await test('voorStart (vroege modus): meekijker + altijdAfdwingen = open; elke andere uitkomst (andere rol, gast zonder rol, verlopen, wacht, fout, te oude client) = dicht met nette melding', async () => {
    const run = async (me, opt = {}) => {
      const t = maakVroeg({ ls: gastCache(), ...opt }); t.win.fetch = async (u, i) => { t.aanroepen.push({ u: String(u), m: (i && i.method) || 'GET' }); if (me === 'stuk') throw new Error('offline'); return { ok: me.status ? me.status < 300 : true, status: me.status || 200, json: async () => me.body !== undefined ? me.body : me }; };
      t.K.installeerGuards = t.K.installeerGuards;   // guards waren al aan; fetch hierboven vervangt alleen de onderlaag
      await t.K.voorStart({ username: 'coach_example.org#EXT#@example.net' }, 'https://mt-claude-proxy.bart-a12.workers.dev'); return t;
    };
    let t = await run({ rol: 'meekijker', altijdAfdwingen: true, modus: 'afdwingen', actief: true }); assert.strictEqual(t.K.aan, true); assert.strictEqual(t.K.modus, 'kijk'); assert.strictEqual(t.doc.attrs['data-kijk-laden'], undefined);
    t = await run({ rol: 'meekijker' }); assert.strictEqual(t.K.aan, false, 'zonder altijdAfdwingen niet open'); assert.strictEqual(t.K.modus, 'streng'); assert.ok(/geen toegang/.test(t.doc.elementen['mt-kijk-laden'].textContent));
    t = await run({ rol: 'lezen', altijdAfdwingen: undefined }); assert.strictEqual(t.K.aan, false); assert.strictEqual(t.K.modus, 'streng');
    t = await run({ rol: null, reden: 'verlopen' }); assert.ok(/verlopen/.test(t.doc.elementen['mt-kijk-laden'].textContent)); assert.strictEqual(t.K.aan, false);
    t = await run({ rol: null, reden: 'wacht-op-goedkeuring' }); assert.ok(/goedkeuren/.test(t.doc.elementen['mt-kijk-laden'].textContent));
    t = await run({ status: 403, body: { error: 'client-te-oud' } }); assert.ok(/verouderd/.test(t.doc.elementen['mt-kijk-laden'].textContent)); assert.strictEqual(t.K.aan, false);
    t = await run('stuk'); assert.ok(/niet controleren/.test(t.doc.elementen['mt-kijk-laden'].textContent)); assert.strictEqual(t.K.modus, 'streng');
    t = await run({ status: 500, body: {} }); assert.ok(/niet controleren/.test(t.doc.elementen['mt-kijk-laden'].textContent));
    // nooit iets anders dan /me op het netwerk tot het bevestigd is
    t = await run({ rol: 'lezen' }); assert.ok(t.aanroepen.every(a => /\/me$/.test(a.u)), JSON.stringify(t.aanroepen));
    assert.strictEqual(t.K.graphDicht(), true);
  });

  await test('herstart: een gast of meekijker die niet vroeg was begonnen laadt één keer opnieuw (eigen vlag, geen app-sleutels); daarna geen lus', async () => {
    const t = maakVroeg({ ls: { [MSAL_TEAM]: JSON.stringify({ username: 'coach@example.org' }), ...planten }, pagina: 'v2' }); assert.strictEqual(t.K._vroeg, false);
    // meekijker zonder #EXT# (bevestigd via /me)
    t.win.fetch = async () => ({ ok: true, status: 200, json: async () => ({ rol: 'meekijker', altijdAfdwingen: true }) });
    let klaar = false; t.K.voorStart({ username: 'Coach@Example.org', homeAccountId: 'oid2.tid' }, 'https://w.test').then(() => { klaar = true; });
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(t.herladen.length, 1, 'één herlaadpoging'); assert.strictEqual(klaar, false, 'de app mag niet verder'); assert.strictEqual(t.K.aan, false);
    assert.deepStrictEqual(JSON.parse(t.echt.m.get('mtkijk.actief')), { h: 'oid2.tid', u: 'coach@example.org', ext: false, m: true }, 'onze eigen record, kleine letters'); assert.strictEqual(t.sess.m.get('mtkijk.herstart'), '1');
    const geschreven = t.echt.log.filter(l => l[0] === 'set' || l[0] === 'del' || l[0] === 'clear').map(l => l.join(':')); assert.deepStrictEqual(geschreven, ['set:mtkijk.actief'], 'alleen de eigen sleutel geschreven');
    for (const k of Object.keys(planten)) assert.strictEqual(t.echt.m.get(k), planten[k]);
    // tweede keer (sessionStorage-vlag staat): geen nieuwe herlaadpoging; late activering als vangnet
    const t2 = maakVroeg({ ls: { [MSAL_TEAM]: JSON.stringify({ username: 'coach@example.org' }) }, sess: { 'mtkijk.herstart': '1' } }); t2.win.fetch = t.win.fetch;
    await t2.K.voorStart({ username: 'coach@example.org' }, 'https://w.test'); assert.strictEqual(t2.herladen.length, 0); assert.strictEqual(t2.K.aan, true, 'vangnet: late activering'); assert.notStrictEqual(t2.win.localStorage, t2.echt.api, 'ook dan een lege opslag');
    // een gast zonder vroege modus (eerste login): meteen herladen
    const t3 = maakVroeg({ ls: {} }); t3.K.voorStart({ username: 'jan_example.org#EXT#@example.net' }, 'https://w.test'); await new Promise(r => setTimeout(r, 50)); assert.strictEqual(t3.herladen.length, 1);
    // team: niets
    const t4 = maakVroeg({ ls: { [MSAL_TEAM]: JSON.stringify({ username: 'collega@mortiseandtenon.nl' }) } }); t4.win.fetch = async () => ({ ok: true, status: 200, json: async () => ({ rol: 'kantoor' }) });
    await t4.K.voorStart({ username: 'collega@mortiseandtenon.nl' }, 'https://w.test'); assert.strictEqual(t4.herladen.length, 0); assert.strictEqual(t4.K.aan, false); assert.strictEqual(t4.win.localStorage, t4.echt.api);
  });

  await test('actief account: kiesAccount neemt het actieve account, anders het record, anders het enige; meerdere zonder keuze = geen account (nooit zomaar het eerste)', () => {
    const { K, echt } = maakVroeg({ ls: {} });
    const A = { homeAccountId: 'a.t', username: 'bart@mortiseandtenon.nl' }, G = { homeAccountId: 'g.t', username: 'coach_example.org#EXT#@example.net' };
    const msal = (lijst, actief) => { const m = { actief, gezet: null, getAllAccounts: () => lijst, getActiveAccount: () => m.actief, setActiveAccount: a => { m.gezet = a; m.actief = a; } }; return m; };
    let m = msal([G, A], A); assert.strictEqual(K.kiesAccount(m), A);
    m = msal([G, A], null); assert.strictEqual(K.kiesAccount(m), null, 'twee accounts, geen actief, geen record'); assert.strictEqual(m.gezet, null);
    m = msal([A], null); assert.strictEqual(K.kiesAccount(m), A); assert.strictEqual(m.gezet, A, 'enige account wordt actief gezet');
    echt.m.set('mtkijk.actief', ACT('g.t', G.username, true)); m = msal([A, G], null); assert.strictEqual(K.kiesAccount(m), G, 'record wijst het account aan'); assert.strictEqual(m.gezet, G);
    echt.m.set('mtkijk.actief', ACT('weg.t', G.username, true)); m = msal([A, G], null); assert.strictEqual(K.kiesAccount(m), null, 'record wijst naar een account dat er niet meer is');
    m = msal([], null); assert.strictEqual(K.kiesAccount(m), null);
  });

  await test('accountwissel: naLogin herlaadt vóór er iets geladen wordt bij gast, bij een ander account en bij een meekijker, in beide richtingen; teamlid-naar-teamlid-start en dezelfde account niet; nooit een lus', () => {
    const A = { homeAccountId: 'a.t', username: 'Bart@mortiseandtenon.nl' }, G = { homeAccountId: 'g.t', username: 'coach_example.org#EXT#@example.net' }, B = { homeAccountId: 'b.t', username: 'collega@mortiseandtenon.nl' };
    // eerste login teamlid, nog geen record: niet herladen, record geschreven
    let t = maakVroeg({ ls: {} }); assert.strictEqual(t.K.naLogin(A), false); assert.strictEqual(t.herladen.length, 0);
    assert.deepStrictEqual(JSON.parse(t.echt.m.get('mtkijk.actief')), { h: 'a.t', u: 'bart@mortiseandtenon.nl', ext: false, m: false });
    assert.strictEqual(t.K.naLogin(A), false, 'zelfde account, tweede keer'); assert.strictEqual(t.herladen.length, 0);
    // Bart -> gast: herladen (record eerst), geen app geladen
    assert.strictEqual(t.K.naLogin(G), true); assert.strictEqual(t.herladen.length, 1); assert.strictEqual(JSON.parse(t.echt.m.get('mtkijk.actief')).ext, true);
    assert.strictEqual(t.sess.m.get('mtkijk.wissel'), 'g.t');
    // na het herladen: nieuwe pagina met het gast-record en de gast in de cache = streng; geen login meer; kiesAccount/naLogin herlaadt niet nog eens
    const cache = { 'g.t-login.microsoftonline.com-tenant': JSON.stringify({ homeAccountId: 'g.t', username: G.username }) };
    let na = maakVroeg({ ls: { ...cache, 'mtkijk.actief': t.echt.m.get('mtkijk.actief') }, sess: { 'mtkijk.wissel': 'g.t' } });
    assert.strictEqual(na.K.modus, 'streng'); assert.strictEqual(na.K.naLogin(G), false, 'al streng + dezelfde gast: geen tweede herlaadronde'); assert.strictEqual(na.herladen.length, 0);
    // zonder strenge start (cache onleesbaar) mag de grendel een lus voorkomen
    na = maakVroeg({ ls: { 'mtkijk.actief': t.echt.m.get('mtkijk.actief') }, sess: { 'mtkijk.wissel': 'g.t' } }); assert.strictEqual(na.K.naLogin(G), false); assert.strictEqual(na.herladen.length, 0, 'grendel: nooit twee keer voor hetzelfde account');
    // gast -> Bart in dezelfde browser (na uitloggen is het record weg; zonder uitloggen: record = gast)
    let g = maakVroeg({ ls: { ...cache, 'mtkijk.actief': ACT('g.t', G.username, true) } }); assert.strictEqual(g.K.modus, 'streng');
    assert.strictEqual(g.K.naLogin(A), true, 'gast-record + teamlid logt in: herladen'); assert.strictEqual(g.herladen.length, 1); assert.strictEqual(JSON.parse(g.echt.m.get('mtkijk.actief')).h, 'a.t');
    // daarna: Bart actief, gast in cache -> niet streng, echte opslag
    const bartNa = maakVroeg({ ls: { ...cache, 'a.t-login.microsoftonline.com-tenant': JSON.stringify({ homeAccountId: 'a.t', username: A.username }), 'mtkijk.actief': g.echt.m.get('mtkijk.actief'), mt_projecten: '[1]' }, sess: { 'mtkijk.wissel': 'a.t' } });
    assert.strictEqual(bartNa.K.modus, null); assert.strictEqual(bartNa.win.localStorage, bartNa.echt.api); assert.strictEqual(bartNa.K.naLogin(A), false); assert.strictEqual(bartNa.herladen.length, 0); assert.strictEqual(bartNa.sess.m.has('mtkijk.wissel'), false, 'grendel opgeruimd');
    // teamlid -> ander teamlid: herladen (andere account); eerste keer na reload niet meer
    t = maakVroeg({ ls: { 'mtkijk.actief': ACT('a.t', A.username, false) } }); assert.strictEqual(t.K.naLogin(B), true); assert.strictEqual(t.herladen.length, 1);
    // gast eerste login (geen record, niet streng): herladen
    t = maakVroeg({ ls: {} }); assert.strictEqual(t.K.naLogin(G), true); assert.strictEqual(t.herladen.length, 1);
    // bevestigde meekijker zonder #EXT# (record m:true) maar niet streng: herladen
    t = maakVroeg({ ls: { 'mtkijk.actief': ACT('a.t', A.username, false, true) } }); assert.strictEqual(t.K.naLogin(A), true);
    // zonder account niets
    t = maakVroeg({ ls: {} }); assert.strictEqual(t.K.naLogin(null), false);
  });

  await test('uitloggen: record weg en schoon herladen; de app-sleutels blijven onaangeroerd; niet-streng team raakt alleen onze eigen sleutel', () => {
    const t = maakVroeg({ ls: { 'mtkijk.actief': ACT('a.t', 'bart@mortiseandtenon.nl', false), ...planten }, sess: { 'mtkijk.wissel': 'a.t', 'mtkijk.herstart': '1' } });
    assert.strictEqual(t.K.naUitloggen(), true); assert.strictEqual(t.herladen.length, 1);
    assert.strictEqual(t.echt.m.has('mtkijk.actief'), false); assert.strictEqual(t.sess.m.has('mtkijk.wissel'), false); assert.strictEqual(t.sess.m.has('mtkijk.herstart'), false);
    for (const k of Object.keys(planten)) assert.strictEqual(t.echt.m.get(k), planten[k]);
    assert.deepStrictEqual(t.echt.log.filter(l => l[0] === 'del' || l[0] === 'set' || l[0] === 'clear').map(l => l.join(':')), ['del:mtkijk.actief']);
    // uit de strenge modus: het record gaat uit de ECHTE opslag (niet uit de lege)
    const s = maakVroeg({ ls: gastCache() }); assert.strictEqual(s.K.modus, 'streng'); s.K.naUitloggen(); assert.strictEqual(s.echt.m.has('mtkijk.actief'), false); assert.strictEqual(s.echt.m.get('mt_projecten'), planten.mt_projecten);
    // een rol die vervalt: niet-gast met m:true wordt na "geen meekijker" niet meer streng
    const w = maakVroeg({ ls: { 'o.t-login.microsoftonline.com-t': JSON.stringify({ homeAccountId: 'o.t', username: 'coach@example.org' }), 'mtkijk.actief': ACT('o.t', 'coach@example.org', false, true) } });
    assert.strictEqual(w.K.modus, 'streng'); w.win.fetch = async () => ({ ok: true, status: 200, json: async () => ({ rol: 'kantoor' }) });
    return w.K.voorStart({ username: 'coach@example.org', homeAccountId: 'o.t' }, 'https://w.test').then(() => { assert.strictEqual(JSON.parse(w.echt.m.get('mtkijk.actief')).m, false); assert.strictEqual(maakVroeg({ ls: Object.fromEntries(w.echt.m) }).K.modus, null); });
  });

  await test('MSAL-opslag: msalBegin geeft MSAL de echte opslag, msalEinde zet de lege weer terug', () => {
    const t = maakVroeg({ ls: gastCache() });
    const leeg = t.win.localStorage; t.K.msalBegin(); assert.strictEqual(t.win.localStorage, t.echt.api, 'tijdens het aanmaken van MSAL: echt'); t.K.msalEinde(); assert.strictEqual(t.win.localStorage, leeg);
    const team = maakVroeg({ ls: {} }); team.K.msalBegin(); team.K.msalEinde(); assert.strictEqual(team.win.localStorage, team.echt.api, 'team: onveranderd');
  });

  await test('spiegel-toeslag: {waarde} wordt een los getal; ontbrekend of onleesbaar = niet beschikbaar (nooit een stille standaard); leesSpiegel levert de inhoud of null', async () => {
    const { win, K } = maakWin();
    const antwoord = { ok: true, status: 200 };
    win.fetchMetAuth = async u => { const s = decodeURIComponent(u.split('/spiegel/')[1]); const data = { mt_toeslag_lak: { waarde: 62.5 }, mt_toeslag_spuit: { waarde: null }, mt_vrijedagen: [1] }[s]; if (data === undefined) return { ok: false, status: 404, json: async () => ({}) }; return { ...antwoord, json: async () => ({ ts: 5, data }) }; };
    assert.strictEqual((await K.haalSpiegel('mt_toeslag_lak.json')).data, 62.5); assert.strictEqual((await K.haalSpiegel('mt_toeslag_spuit.json')).ok, false); assert.strictEqual((await K.haalSpiegel('mt_toeslag_extra.json')).ok, false);
    assert.strictEqual(await K.leesSpiegel('mt_toeslag_lak'), 62.5); assert.strictEqual(await K.leesSpiegel('mt_calc_offertes'), null); assert.deepStrictEqual(JSON.parse(JSON.stringify(await K.leesSpiegel('mt_vrijedagen'))), [1]);
    assert.strictEqual(K.STORES.length, 15);
  });

  await test('activeer zet de oude calculatie-sync uit', () => {
    const { win, K } = maakWin(); let n_ = 0; win._calcSync = { schrijf: async () => { n_++; return { ok: true }; } }; win._calcAutoSync = () => { n_++; };
    K.activeer({ rol: 'meekijker' }); win._calcAutoSync();
    return win._calcSync.schrijf().then(r => { assert.strictEqual(r.ok, false); assert.strictEqual(r.dicht, true); assert.strictEqual(n_, 0, 'de oorspronkelijke sync is nooit aangeroepen'); });
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
