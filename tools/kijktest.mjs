// Kijkmodus-harnas (rol meekijker): laadt v2.html en mobiel.html in headless Chrome met een nagebootste Microsoft-login (gast, #EXT#) en een
// nagebootste worker (rol meekijker via /me), en BEWIJST dat er
//   - geen Graph/SharePoint/Office-verzoek het netwerk bereikt,
//   - geen MSAL-popup en geen token met Graph-scopes wordt gevraagd,
//   - geen enkel niet-GET naar de worker gaat behalve /track (en de Reports-leesPOST's),
//   - de gegevens uit /spiegel komen, de banner "Meekijken" er staat en de verboden tabs weg zijn,
//   - schrijfpogingen (SharePoint-write, Moneybird-POST, Graph-fetch) in de browser al worden geweigerd.
// Gebruik: node tools/kijktest.mjs   (geen argumenten; start zelf een statische server op een vrije poort). Exit 1 bij een afwijking.
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WORKER = 'https://mt-claude-proxy.bart-a12.workers.dev';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };

// ── statische server ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/v2.html';
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('niet gevonden'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

// ── de nagebootste worker ────────────────────────────────────────────────────────────────────────────────────────────────────────
const RECHTEN = { projecten: 'lezen', taken: null, bestellijst: null, opmerkingen: null, inbox: null, offertes: 'lezen', moneybird: 'kijken', mb_verwijderen: null, uren: 'team-lezen', verbeterpunten: 'lezen', ai: null, beheer: null, geld: 'kijken' };
const ME = { oid: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'coach_example.org#ext#@example.net', naam: 'Coach Voorbeeld', rol: 'meekijker', rolNaam: 'Meekijker', actief: true, reden: null, modus: 'afdwingen', altijdAfdwingen: true, toegangTot: Date.now() + 20 * 864e5, rechten: RECHTEN, extern: true };
const TS = Date.now() - 3600e3;
const SPIEGEL = {
  mt_projecten: [{ code: 'P-0001', naam: 'Voorbeeldproject', klant: 'Voorbeeld BV', status: 'actief', project_id: 'p_voorbeeld01', _gewijzigd: new Date(TS).toISOString() }],
  mt_planning: {}, mt_project_taken_v2: {}, mt_planblokken: [], mt_vrijedagen: [], mt_offerte_keuze: {},
  mt_calc_offertes: { offertes: { 'P-0001': { titel: 'Spiegeloffer', project_code: 'P-0001', meta: { status: 'Verstuurd' }, materiaal: [], uren: [] } } }, mt_calc_defaults: { materiaal_marge: 1.5, marge_ondergrens: 0.15, uren: [{ omschrijving: 'Productie', uurtarief: 61, marge: 2 }] },
  mt_toeslag_lak: { waarde: 62 },   // mt_toeslag_spuit ontbreekt bewust: de kijkmodus mag dan nooit op de standaard terugvallen
};
const verzoeken = [];   // alles wat de pagina doet, zoals het de (nagebootste) worker of het netwerk bereikt
let ME_HUIDIG = ME;
function antwoord(u, m, hdr) {
  const pad = u.pathname, target = u.searchParams.get('target');
  const json = (o, s = 200) => ({ s, b: JSON.stringify(o) });
  if (m === 'OPTIONS') return { s: 204, b: '' };
  if (pad.startsWith('/spiegel/') && m === 'POST') return json({ ok: true });
  if (pad === '/me') {
    // `me` van een scenario mag een functie van de gebruikersnaam in het (nagebootste) id-token zijn: dan bepaalt het ingelogde account de rol
    let me = ME_ACTIEF;
    if (typeof me === 'function') { let naam = ''; try { naam = JSON.parse(Buffer.from(String(hdr && (hdr['X-Auth-Token'] || hdr['x-auth-token'])).split('.')[1], 'base64url').toString()).preferred_username || ''; } catch { } me = me(naam); }
    ME_HUIDIG = me; return json(me);
  }
  if (pad === '/spiegel/_index' && ME_HUIDIG.rol !== 'meekijker') return json({ stores: {} });   // een teamlid ziet een lege spiegel: alles moet gevuld worden
  if (pad === '/spiegel/_index') return json({ stores: Object.fromEntries(Object.keys(SPIEGEL).map(k => [k, { ts: TS, etag: 'e', bytes: 10 }])) });
  if (pad.startsWith('/spiegel/')) { const s = decodeURIComponent(pad.slice(9)); return SPIEGEL[s] ? json({ store: s, ts: TS, etag: 'e', data: SPIEGEL[s] }) : json({ error: 'geen-spiegel' }, 404); }
  if (pad === '/klanten') return json({ klanten: [], rev: 0 });
  if (pad === '/instellingen') return json({ projectcode: 'offerte' });
  if (pad.startsWith('/teller/')) return json({ nummers: {} });
  if (pad === '/signalen') return json({ items: [], telling: { open: 0, opgepakt: 0, gesnoozed: 0 } });
  if (pad === '/geld/tijdlijn') return json({ saldo: { lopend: { gerapporteerd: 1000 }, potten: {}, totaal: { gerapporteerd: 1000 } }, vandaag: '2026-11-02', van: '2026-10-01', tot: '2027-01-01', events: [], cachever: 'x' });
  if (pad.startsWith('/geld/')) return json({ items: [], meldingen: [], ongelezen: 0, rapporten: [], open: {} });
  if (pad === '/beheer/gebruikers') {
    const rol = id => ({ id, naam: id });
    return json({ gebruikers: [{ oid: ME.oid, role: 'eigenaar', rolNaam: 'Eigenaar', naam: 'Baas', email: 'baas@mortiseandtenon.nl', active: true, beschermd: true },
      { oid: 'aaaaaaaa-0000-4000-8000-000000000009', role: 'meekijker', rolNaam: 'Meekijker', naam: '<img src=x onerror=window.__xss=1>', email: 'c@example.org', active: true, toegangTot: Date.now() + 9 * 864e5, lastSeen: Date.now() }],
      uitnodigingen: [{ id: 'i1', email: 'n@example.org', role: 'meekijker', naam: 'Nieuwe Coach', verloopt: Date.now() + 5 * 864e5, toegangTot: Date.now() + 30 * 864e5 }],
      aanvragen: [{ oid: 'bbbbbbbb-0000-4000-8000-000000000001', naam: 'Gast Voorbeeld', email: 'g@example.org', ts: Date.now(), uitgenodigdAls: 'meekijker', toegangTot: Date.now() + 30 * 864e5, inviteId: 'i1' }],
      rollen: ['eigenaar', 'beheerder', 'kantoor', 'werkplaats', 'lezen', 'administratie', 'meekijker'].map(rol), matrix: {}, modus: 'log', ik: ME.oid, ikRol: 'eigenaar' });
  }
  if (pad === '/beheer/log') return json({ modus: 'log', dagen: 7, totaal: 0, geweigerd: 0, perDag: [], top: [] });
  if (pad === '/beheer/audit') return json({ audit: [] });
  if (pad === '/beheer/kijklog') return json({ oid: 'x', bewaartermijn_dagen: 180, afgekapt: false, verzoeken: 3, dagen: [{ dag: '2026-11-02', items: [{ ts: Date.now() - 6e4, bron: 'server', soort: 'verzoeken', label: '<b>Financiën</b>', n: 3, geweigerd: 1 }, { ts: Date.now(), bron: 'tab', soort: 'open', label: 'projecten', duur_ms: 61000 }] }] });
  if (pad === '/track' || pad === '/track/heartbeat' || pad.startsWith('/spiegel/') && m === 'POST') return json({ ok: true });
  if (pad === '/' && target) return json([]);
  return json({ error: 'onbekend' }, 404);
}

// ── Chrome en CDP ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let ME_ACTIEF = ME;   // per scenario instelbaar (de controle met een gewoon teamlid gebruikt een andere rol)
async function scenario(naam, pad, { wacht = 14000, controle, me = ME, gebruiker = 'coach_example.org#EXT#@example.net', graph = null, plant = false, vertraagMe = 0, halverwege = null, plantAccounts = null, plantActief = null, plantRecord = undefined }) {
  ME_ACTIEF = me; ME_HUIDIG = typeof me === 'function' ? ME : me;
  // Wat er vóór de eerste pagina in de echte opslag staat (MSAL-cache, actief account, ons eigen record). Standaard: alleen het ingelogde account
  // (een gast met zijn record, een teamlid zonder record). `plantAccounts: []` = niemand ingelogd.
  const GAST_ACCT = { username: 'coach_example.org#EXT#@example.net', name: 'Coach Voorbeeld', homeAccountId: 'oid.tid', localAccountId: 'l', environment: 'login.microsoftonline.com', tenantId: 't' };
  const eigenAcct = { username: gebruiker, name: 'Gebruiker Voorbeeld', homeAccountId: /#EXT#/i.test(gebruiker) ? 'oid.tid' : 'oid2.tid', localAccountId: 'l', environment: 'login.microsoftonline.com', tenantId: 't' };
  const accountsPlant = plantAccounts === null ? [eigenAcct] : plantAccounts;
  const recordPlantWaarde = plantRecord !== undefined ? plantRecord : (/#EXT#/i.test(gebruiker) ? { h: eigenAcct.homeAccountId, u: gebruiker.toLowerCase(), ext: true, m: false } : null);
  const actiefPlant = plantActief !== null ? plantActief : (accountsPlant.length ? accountsPlant[0].homeAccountId : null);
  const port = 9300 + Math.floor(Math.random() * 400), PROF = `mt-kijk-prof-${Date.now()}-${process.pid}-${Math.floor(Math.random() * 1e4)}`;
  const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${process.env.TEMP}/${PROF}`, 'about:blank'], { stdio: 'ignore' });
  const fouten = [], exc = [], netwerk = [], consoleFout = [];
  const opruimen = async () => {
    try { const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); const b = new WebSocket(v.webSocketDebuggerUrl); await Promise.race([new Promise(r => b.onopen = r), sleep(2000)]); if (b.readyState === 1) { b.send(JSON.stringify({ id: 1, method: 'Browser.close' })); await sleep(1500); } } catch { }
    try { execSync(`taskkill /PID ${ch.pid} /T /F`, { stdio: 'ignore' }); } catch { }
    try { execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*${PROF}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' }); } catch { }
  };
  try {
    let tgt; for (let i = 0; i < 30 && !tgt; i++) { await sleep(500); try { tgt = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch { } }
    if (!tgt) throw new Error('Chrome start niet');
    const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
    let id = 0; const wacht_ = new Map();
    const send = (method, params = {}) => new Promise(res => { const i = ++id; wacht_.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: '*' }, { name: 'Content-Type', value: 'application/json' }];
    ws.onmessage = async e => {
      const m = JSON.parse(e.data);
      if (m.id && wacht_.has(m.id)) { wacht_.get(m.id)(m); wacht_.delete(m.id); return; }
      if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; exc.push((d.exception?.description || d.text || '').slice(0, 300)); }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleFout.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 200));
      if (m.method === 'Fetch.requestPaused') {
        const r = m.params.request, u = new URL(r.url);
        if (u.origin === ORIGIN) { send('Fetch.continueRequest', { requestId: m.params.requestId }); return; }
        netwerk.push({ methode: r.method, host: u.hostname, pad: u.pathname, search: u.search, target: u.searchParams.get('target'), heeftBody: !!r.postData, body: r.postData || null, auth: (r.headers && (r.headers.Authorization || r.headers.authorization)) || null });
        if (graph && (u.hostname === 'graph.microsoft.com' || u.hostname === 'dl.example')) {   // nagebootst SharePoint voor het teamlid-scenario
          const a = r.method === 'OPTIONS' ? { s: 204, b: '' } : (graph(u, r.method) || { s: 404, b: {} });
          const GCORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET,PUT,POST,PATCH,DELETE,OPTIONS' }, { name: 'Access-Control-Allow-Headers', value: 'authorization,content-type,if-match,if-none-match,x-auth-token' }, { name: 'Access-Control-Expose-Headers', value: 'ETag' }, { name: 'Content-Type', value: 'application/json' }];
          send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: a.s, responseHeaders: [...GCORS, ...(a.etag ? [{ name: 'ETag', value: a.etag }] : [])], body: Buffer.from(a.b === '' ? '' : JSON.stringify(a.b)).toString('base64') });
        }
        else if (u.origin === WORKER) { const a = antwoord(u, r.method, r.headers); if (vertraagMe && u.pathname === '/me' && r.method === 'GET') await sleep(vertraagMe); send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: a.s, responseHeaders: CORS, body: Buffer.from(a.b).toString('base64') }); }
        else send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: u.hostname.includes('microsoft') || u.hostname.includes('sharepoint') ? 401 : 200, responseHeaders: CORS.slice(0, 1), body: '' });
      }
    };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    // Nagebootste MSAL: een gast (#EXT#) is ingelogd; elke tokenaanvraag wordt vastgelegd.
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      (function(){
        window.__acq = [];
        const LS = window.localStorage;   // vóór mt-kijk.js: de echte opslag (zoals MSAL die bij het aanmaken ook krijgt)
        const lees = () => { const l = []; for (let i = 0; i < LS.length; i++) { const k = LS.key(i); if (k.indexOf('login.microsoftonline.com') < 0) continue; try { const v = JSON.parse(LS.getItem(k)); if (v && v.homeAccountId && v.username) l.push(v); } catch (e) { } } return l; };
        const zet = a => LS.setItem(a.homeAccountId + '-login.microsoftonline.com-tenant', JSON.stringify(a));
        try { window.__loads = (+sessionStorage.getItem('__loads') || 0) + 1; sessionStorage.setItem('__loads', String(window.__loads)); } catch (e) { }
        try {
          if (window.top === window) {
            let eerste = false; try { eerste = !sessionStorage.getItem('__geplant1'); sessionStorage.setItem('__geplant1', '1'); } catch (e) { }
            if (eerste) { ${JSON.stringify(accountsPlant)}.forEach(zet); if (${JSON.stringify(actiefPlant)}) LS.setItem('fake.active', ${JSON.stringify(actiefPlant)}); if (${JSON.stringify(recordPlantWaarde)}) LS.setItem('mtkijk.actief', JSON.stringify(${JSON.stringify(recordPlantWaarde)})); }
            if (eerste && ${plant}) {
              localStorage.setItem('mt_projecten', JSON.stringify([{ code: 'LOKAAL-1', naam: 'LOKAAL GEPLANT' }])); localStorage.setItem('mt_planning', '{"LOKAAL-1":{}}'); localStorage.setItem('mt_uurtarieven', '{"x":9}');
              localStorage.setItem('mt_toeslag_spuit', '"77"'); localStorage.setItem('mt-stijl-keuze', 'oud');
              localStorage.setItem('mt_calc_offertes', JSON.stringify({ versie: 2, offertes: { 'LOKAAL-OFF': { titel: 'LOKAAL OFFERTE', meta: {}, materiaal: [], uren: [] } } }));
            }
            window.__geplant = JSON.stringify(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)]));
          }
        } catch (e) { }
        const b64u = o => btoa(JSON.stringify(o)).replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_');
        const acct = ${JSON.stringify(eigenAcct)}, gastAcct = ${JSON.stringify(GAST_ACCT)};
        const idt = a => 'e30.' + b64u({ exp: Math.floor(Date.now()/1000) + 3600, oid: '${ME.oid}', preferred_username: a.username }) + '.sig';
        const maak = (soort) => async (r) => { const a = (r && r.account) || acct; window.__acq.push({ soort, scopes: (r && r.scopes) || [], u: a.username }); return { idToken: idt(a), accessToken: 'AT', account: a }; };
        // Nagebootste MSAL die zoals de echte alles uit de (echte) opslag leest: accounts uit de cache, het actieve account in "fake.active".
        const FAKE = { PublicClientApplication: class { constructor(){} async initialize(){} getAllAccounts(){ return lees(); } getActiveAccount(){ const h = LS.getItem('fake.active'); return lees().find(x => x.homeAccountId === h) || null; } setActiveAccount(a){ if (a) LS.setItem('fake.active', a.homeAccountId); else LS.removeItem('fake.active'); }
          acquireTokenSilent(r){ return maak('silent')(r); } acquireTokenPopup(r){ return maak('popup')(r); } acquireTokenRedirect(r){ return maak('redirect')(r); }
          async loginPopup(r){ const a = window.__loginAls || acct; window.__acq.push({ soort:'loginPopup', scopes:(r&&r.scopes)||[], u: a.username }); zet(a); return { account: a }; }
          async logoutPopup(){ const h = LS.getItem('fake.active'); if (h) LS.removeItem(h + '-login.microsoftonline.com-tenant'); LS.removeItem('fake.active'); } async handleRedirectPromise(){ return null; } } };
        window.__gastAcct = gastAcct;
        Object.defineProperty(window, 'msal', { configurable: true, get(){ return FAKE; }, set(){} });
      })();` });
    await send('Page.navigate', { url: `${ORIGIN}/${pad}` });
    let tussen = null;
    if (halverwege) { await sleep(900); tussen = await halverwege({ ev: async expressie => { const r = await send('Runtime.evaluate', { expression: expressie, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { fout: r.result.exceptionDetails.text } : r.result?.result?.value; } }); }
    await sleep(wacht);
    const ev = async expressie => { const r = await send('Runtime.evaluate', { expression: expressie, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { fout: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text } : r.result?.result?.value; };
    const staat = await controle({ ev, sleep });
    const acq = await ev('JSON.stringify(window.__acq)');
    return { naam, exc, consoleFout, netwerk, acq: JSON.parse(acq || '[]'), staat, tussen };
  } finally { await opruimen(); }
}

// ── de toetsen ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const mislukt = []; const toets = (naam, ok, detail) => { console.log((ok ? 'ok   ' : 'FOUT ') + naam + (ok ? '' : '  ' + (detail || ''))); if (!ok) mislukt.push(naam); };
const GRAPH = /(^|\.)(graph\.microsoft\.com|sharepoint\.com|onedrive\.live\.com|office\.com|office365\.com|outlook\.com)$/i;

const v2 = await scenario('v2 meekijker', 'v2.html', {
  wacht: 15000, plant: true, vertraagMe: 1800,
  // Terwijl /me nog onderweg is (vertraagd): neutraal laadscherm, app verborgen, niets van de worker bereikbaar behalve /me, lege opslag.
  halverwege: async ({ ev }) => ({
    laden: await ev("document.documentElement.getAttribute('data-kijk-laden')"), overlay: await ev("!!document.getElementById('mt-kijk-laden')"),
    appZichtbaar: await ev("(()=>{const a=document.getElementById('app-wrap'); return !!a && getComputedStyle(a).visibility!=='hidden';})()"),
    streng: await ev(`MTKijk.modus`), klanten: await ev(`fetch('${WORKER}/klanten').then(r=>r.status)`), moneybird: await ev(`fetch('${WORKER}?target=moneybird&path=1/sales_invoices').then(r=>r.status)`),
    opslagLeeg: await ev("localStorage.length===0 && localStorage.getItem('mt_projecten')===null"),
  }),
  controle: async ({ ev }) => {
    const s = {};
    s.kijk = await ev('!!(window.MTKijk && MTKijk.aan)');
    s.banner = await ev("(document.getElementById('mt-kijk-banner')||{}).textContent||''");
    s.zichtbaar = JSON.parse(await ev("JSON.stringify([...document.querySelectorAll('.tabs-wrap .tab-btn')].filter(b=>b.style.display!=='none'&&!b.classList.contains('mt-rol-verborgen')).map(b=>(/showTab\\('([^']+)'/.exec(b.getAttribute('onclick')||'')||[])[1]))"));
    // Pogingen die de gegevenslaag moet weigeren, zonder dat er iets het netwerk bereikt:
    s.graphToken = await ev('getGraphToken().then(t=>String(t))');
    s.spWrite = await ev("_SP.write('mt_planning.json',{x:1}).then(r=>String(r))");
    s.spMaakAan = await ev("_SP.maakAan('mt_nieuw.json',{x:1}).then(r=>String(r))");
    s.spRead = await ev("_SP.read('mt_voorraad.json').then(()=>'gelezen',e=>'fout:'+e.message)");
    s.graphFetch = await ev("fetch('https://graph.microsoft.com/v1.0/me/messages').then(r=>r.status)");
    s.spFetch = await ev("fetch('https://mortisetenon.sharepoint.com/sites/x',{method:'PUT',body:'x'}).then(r=>r.status)");
    s.mbPost = await ev(`fetch('${WORKER}?target=moneybird&path=1/sales_invoices',{method:'POST',body:'{}'}).then(r=>r.status)`);
    s.claude = await ev(`fetch('${WORKER}?target=claude',{method:'POST',body:'{}'}).then(r=>r.status)`);
    s.beheer = await ev(`fetch('${WORKER}/beheer/gebruikers').then(r=>r.status)`);
    s.focusPatch = await ev(`fetch('${WORKER}?target=toggl_focus&path=tasks/1',{method:'PATCH',body:'{}'}).then(r=>r.status)`);
    s.klikBlok = await ev("(()=>{const b=document.createElement('button');b.setAttribute('onclick','window.__geklikt=1;projectOpslaan()');b.textContent='x';document.body.appendChild(b);b.click();return !window.__geklikt;})()");
    s.leesOk = await ev(`fetch('${WORKER}/spiegel/mt_projecten').then(r=>r.status)`);
    s.geblokkeerd = await ev('JSON.stringify(MTKijk.geblokkeerd.map(x=>x.methode+" "+x.reden))');
    s.projectData = await ev("localStorage.getItem('mt_projecten')||''");
    // lokale opslag: geplante data blijft onzichtbaar en onaangeroerd
    s.zichtLokaal = await ev("(document.body.innerText + ' ' + [...Object.keys(localStorage)].map(k => localStorage.getItem(k)).join(' ')).includes('LOKAAL')");
    s.uurtarieven = await ev("String(localStorage.getItem('mt_uurtarieven'))");
    s.echteOpslagOnveranderd = await ev("(()=>{const f=document.createElement('iframe'); document.body.appendChild(f); const l=f.contentWindow.localStorage; const nu=JSON.stringify(Object.keys(l).sort().map(k=>[k,l.getItem(k)])); f.remove(); return nu===window.__geplant;})()");
    s.stijl = await ev("document.documentElement.getAttribute('data-stijl')");   // 'oud' staat in de echte opslag; de inline stijlcode ziet alleen de lege opslag
    s.opslagIsGeheugen = await ev("localStorage !== undefined && !('mt_zelf_gezet' in localStorage) && (localStorage.setItem('mt_zelf_gezet','1'), localStorage.getItem('mt_zelf_gezet')==='1')");
    s.echtNaSchrijven = await ev("(()=>{const f=document.createElement('iframe'); document.body.appendChild(f); const l=f.contentWindow.localStorage; const x=l.getItem('mt_zelf_gezet'); f.remove(); return x;})()");
    s.indexedDB = await ev('String(window.indexedDB)');
    // toeslag: lak uit de spiegel, spuit ontbreekt -> onbekend (niet 80, niet de geplante 77)
    s.toeslagLak = await ev("String(getToeslag('gelakt eiken'))"); s.toeslagSpuit = await ev("String(getToeslag('gespoten spuit'))"); s.toeslagTekst = await ev("toeslagRegel(null, 2).includes('toeslag onbekend') && !toeslagRegel(null,2).includes('80') && !toeslagRegel(null,2).includes('77')");
    // calculatie: alleen uit de spiegel, geen lokale geplante offerte, oude sync uit
    s.calc = await ev("calcZorgGeladen().then(()=>JSON.stringify({offertes:Object.keys(CALC.offertes), titel:(CALC.offertes['P-0001']||{}).titel, marge:CALC.defaults.materiaal_marge, uren:CALC.defaults.uren.length}))");
    s.calcSync = await ev("window._calcSync ? _calcSync.schrijf().then(r=>JSON.stringify({ok:r.ok,dicht:!!r.dicht})) : 'geen sync'");
    return s;
  },
});
const post = v2.netwerk.filter(n => n.methode !== 'GET' && n.methode !== 'OPTIONS' && n.host === 'mt-claude-proxy.bart-a12.workers.dev');
toets('v2: geen uitzonderingen in de pagina', v2.exc.length === 0, v2.exc.join(' | '));
toets('v2: kijkmodus actief + banner', v2.staat.kijk === true && /Meekijken/.test(v2.staat.banner), JSON.stringify([v2.staat.kijk, v2.staat.banner]));
toets('v2: de inline stijlcode leest de echte opslag niet (geplante keuze "oud" telt niet)', v2.staat.stijl === 'nieuw', String(v2.staat.stijl));
toets('v2: banner toont de stand van de spiegel', /stand van/.test(v2.staat.banner), v2.staat.banner);
toets('v2: gegevens komen uit de spiegel (projecten lokaal gevuld)', /Voorbeeldproject/.test(v2.staat.projectData), v2.staat.projectData.slice(0, 80));
toets('v2: tijdens het wachten op /me: neutraal laadscherm, app verborgen, streng, geen worker-verzoek behalve /me, lege opslag', v2.tussen && v2.tussen.laden === '1' && v2.tussen.overlay === true && v2.tussen.appZichtbaar === false && v2.tussen.streng === 'streng' && v2.tussen.klanten === 403 && v2.tussen.moneybird === 403 && v2.tussen.opslagLeeg === true, JSON.stringify(v2.tussen));
{ const w = v2.netwerk.filter(n => n.host.endsWith('workers.dev') && n.methode !== 'OPTIONS'), meIdx = w.findIndex(n => n.pad === '/me');
  toets('v2: het eerste (en enige) worker-verzoek vóór de bevestiging is GET /me', meIdx === 0 && w.slice(0, 1).every(n => n.methode === 'GET'), JSON.stringify(w.slice(0, 3).map(n => n.methode + ' ' + n.pad))); }
toets('v2: bestaande lokale opslag is onzichtbaar voor de meekijker en blijft onaangeroerd (ook zonder dat iets gewist is)', v2.staat.zichtLokaal === false && v2.staat.uurtarieven === 'null' && v2.staat.echteOpslagOnveranderd === true && v2.staat.echtNaSchrijven === null && v2.staat.indexedDB === 'undefined', JSON.stringify([v2.staat.zichtLokaal, v2.staat.uurtarieven, v2.staat.echteOpslagOnveranderd, v2.staat.echtNaSchrijven, v2.staat.indexedDB]));
toets('v2: toeslag lak uit de spiegel (62); spuit ontbreekt = onbekend (geen stille standaard 80, geen lokale 77)', v2.staat.toeslagLak === '62' && v2.staat.toeslagSpuit === 'null' && v2.staat.toeslagTekst === true, JSON.stringify([v2.staat.toeslagLak, v2.staat.toeslagSpuit, v2.staat.toeslagTekst]));
toets('v2: calculatie leest alleen uit de spiegel (geen lokale offerte), de oude sync staat uit', /"offertes":\["P-0001"\]/.test(v2.staat.calc) && /Spiegeloffer/.test(v2.staat.calc) && /"marge":1.5/.test(v2.staat.calc) && /"dicht":true/.test(v2.staat.calcSync) && /"ok":false/.test(v2.staat.calcSync), v2.staat.calc + ' ' + v2.staat.calcSync);
toets('v2: geen enkel Graph/SharePoint/Office-verzoek op het netwerk', !v2.netwerk.some(n => GRAPH.test(n.host)), JSON.stringify(v2.netwerk.filter(n => GRAPH.test(n.host))));
toets('v2: geen MSAL-popup of -redirect', !v2.acq.some(a => a.soort === 'popup' || a.soort === 'redirect'), JSON.stringify(v2.acq));
toets('v2: geen token met Graph-scopes gevraagd', v2.acq.every(a => a.scopes.every(sc => ['openid', 'profile', 'email'].includes(sc))), JSON.stringify(v2.acq));
toets('v2: niet-GET naar de worker alleen /track (en Reports-leesPOST\'s)', post.every(n => (n.pad === '/track' || n.pad === '/track/heartbeat') || (n.pad === '/' && ['toggl_reports', 'toggl_focus'].includes(n.target) && n.methode === 'POST')), JSON.stringify(post));
toets('v2: geen worker-verzoek naar AI, beheer, mijn/toggl, aanwezig, push', !v2.netwerk.some(n => n.host.endsWith('workers.dev') && (/^\/(beheer|aanwezig|mijn|push)/.test(n.pad) || n.target === 'claude')), JSON.stringify(v2.netwerk.filter(n => /^\/(beheer|aanwezig|mijn|push)/.test(n.pad) || n.target === 'claude')));
toets('v2: getGraphToken() geeft null', v2.staat.graphToken === 'null', v2.staat.graphToken);
toets('v2: _SP.write/maakAan doen niets (false)', v2.staat.spWrite === 'false' && v2.staat.spMaakAan === 'false', JSON.stringify([v2.staat.spWrite, v2.staat.spMaakAan]));
toets('v2: een store buiten laag 1 is niet leesbaar', /^fout:/.test(v2.staat.spRead), v2.staat.spRead);
toets('v2: Graph-, SharePoint-, Moneybird-POST-, AI-, Beheer- en Focus-PATCH-pogingen worden in de browser geweigerd (403)', [v2.staat.graphFetch, v2.staat.spFetch, v2.staat.mbPost, v2.staat.claude, v2.staat.beheer, v2.staat.focusPatch].every(x => x === 403), JSON.stringify([v2.staat.graphFetch, v2.staat.spFetch, v2.staat.mbPost, v2.staat.claude, v2.staat.beheer, v2.staat.focusPatch]));
toets('v2: een leesroute (/spiegel) blijft werken', v2.staat.leesOk === 200, String(v2.staat.leesOk));
toets('v2: een schrijf-knop (handler op naam) wordt geblokkeerd', v2.staat.klikBlok === true, String(v2.staat.klikBlok));
toets('v2: verboden tabs zijn weg (Inbox, Instellingen, Admin, Voorraad, Bestellijst, Klanten, Opleveringen, Vereist aandacht)', !v2.staat.zichtbaar.some(t => ['inbox', 'instellingen', 'admin', 'voorraad', 'bestelling', 'klanten', 'oplevering', 'attentie', 'dashboard'].includes(t)), JSON.stringify(v2.staat.zichtbaar));
toets('v2: de tabs voor de coach staan er (Projecten, Agenda, Uren, Verbeterpunten)', ['projecten', 'agenda', 'toggl', 'verbeterpunten'].every(t => v2.staat.zichtbaar.includes(t)), JSON.stringify(v2.staat.zichtbaar));
console.log('   verzoeken naar de worker:', [...new Set(v2.netwerk.filter(n => n.host.endsWith('workers.dev')).map(n => `${n.methode} ${n.pad}${n.target ? '?' + n.target : ''}`))].join(', '));
console.log('   geblokkeerd in de browser:', v2.staat.geblokkeerd);
if (v2.consoleFout.length) console.log('   console-fouten (info):', [...new Set(v2.consoleFout)].slice(0, 6).join(' | '));

const mob = await scenario('mobiel meekijker', 'mobiel.html', {
  wacht: 9000,
  controle: async ({ ev }) => {
    const s = {}; s.melding = await ev("(document.getElementById('login-error')||{}).textContent||''"); s.loginZichtbaar = await ev("getComputedStyle(document.getElementById('login-screen')).display!=='none'");
    return s;
  },
});
toets('mobiel: nette melding "gebruik de desktopversie"', /desktopversie/i.test(mob.staat.melding), mob.staat.melding);
toets('mobiel: geen gegevens, geen Graph, geen popup', !mob.netwerk.some(n => GRAPH.test(n.host)) && !mob.acq.some(a => a.soort === 'popup') && !mob.netwerk.some(n => /\/spiegel|target=/.test(n.pad + (n.target || ''))), JSON.stringify({ graph: mob.netwerk.filter(n => GRAPH.test(n.host)), acq: mob.acq }));
toets('mobiel: geen uitzonderingen', mob.exc.length === 0, mob.exc.join(' | '));

// Controle dat het harnas tanden heeft: een gewoon teamlid (geen meekijker) vraagt WEL een Graph-token; dat moet het harnas dus zien.
const team = await scenario('v2 teamlid (controle)', 'v2.html', { wacht: 9000, me: { ...ME, rol: 'kantoor', rolNaam: 'Kantoor', modus: 'log', altijdAfdwingen: undefined, extern: undefined, rechten: { ...RECHTEN, projecten: 'wijzigen', moneybird: 'concepten', uren: 'team' } }, gebruiker: 'collega@mortiseandtenon.nl', controle: async ({ ev }) => ({ kijk: await ev('!!(window.MTKijk && MTKijk.aan)') }) });
toets('controle: een teamlid blijft buiten de kijkmodus en vraagt wél Graph-scopes (het harnas ziet dat)', team.staat.kijk === false && team.acq.some(a => a.scopes.some(sc => /graph\.microsoft\.com/.test(sc))), JSON.stringify({ kijk: team.staat.kijk, acq: team.acq.slice(0, 3) }));

// Een gast die GEEN bevestigde meekijker is (hier: rol "lezen", of een /me zonder rol): alles blijft dicht, neutraal scherm met melding, alleen /me op het netwerk.
for (const [titel, meX, tekstRe] of [['rol lezen', { ...ME, rol: 'lezen', rolNaam: 'Alleen lezen', altijdAfdwingen: undefined, modus: 'log', rechten: { ...RECHTEN, projecten: 'lezen' } }, /geen toegang/], ['verlopen', { oid: ME.oid, rol: null, rolNaam: null, actief: false, reden: 'verlopen', modus: 'log', rechten: null, extern: true }, /verlopen/]]) {
  const geen = await scenario('v2 gast ' + titel, 'v2.html', { wacht: 8000, plant: true, me: meX,
    controle: async ({ ev }) => ({ overlay: await ev("(document.getElementById('mt-kijk-laden')||{}).textContent||''"), appZichtbaar: await ev("(()=>{const a=document.getElementById('app-wrap'); return !!a && getComputedStyle(a).visibility!=='hidden';})()"), modus: await ev('MTKijk.modus'), aan: await ev('MTKijk.aan'),
      moneybird: await ev(`fetch('${WORKER}?target=moneybird&path=1/sales_invoices').then(r=>r.status)`), spiegel: await ev(`fetch('${WORKER}/spiegel/mt_projecten').then(r=>r.status)`), lokaal: await ev("document.body.innerText.includes('LOKAAL')") }) });
  const w = geen.netwerk.filter(n => n.host.endsWith('workers.dev') && n.methode !== 'OPTIONS');
  toets(`v2: gast zonder bevestigde meekijker-rol (${titel}): alles dicht, melding, app verborgen, alleen /me op het netwerk, geen Graph`, tekstRe.test(geen.staat.overlay) && geen.staat.appZichtbaar === false && geen.staat.modus === 'streng' && geen.staat.aan === false && geen.staat.moneybird === 403 && geen.staat.spiegel === 403 && geen.staat.lokaal === false
    && w.length >= 1 && w.every(n => n.pad === '/me' && n.methode === 'GET') && !geen.netwerk.some(n => GRAPH.test(n.host)) && !geen.acq.some(a => a.soort === 'popup'), JSON.stringify({ staat: geen.staat, w: w.map(n => n.methode + ' ' + n.pad), exc: geen.exc, con: geen.consoleFout.slice(0, 4) }));
}
// ── Actief account en accountwissel (brok 6b) ──────────────────────────────────────────────────────────────────────────────────────
const BART_A = { username: 'collega@mortiseandtenon.nl', name: 'Teamlid Voorbeeld', homeAccountId: 'oid2.tid', localAccountId: 'l2', environment: 'login.microsoftonline.com', tenantId: 't' };
const GAST_A = { username: 'coach_example.org#EXT#@example.net', name: 'Coach Voorbeeld', homeAccountId: 'oid.tid', localAccountId: 'l', environment: 'login.microsoftonline.com', tenantId: 't' };
const TEAM_ME = { ...ME, rol: 'kantoor', rolNaam: 'Kantoor', modus: 'log', altijdAfdwingen: undefined, extern: undefined, rechten: { ...RECHTEN, projecten: 'wijzigen', moneybird: 'concepten', uren: 'team' } };
const naarRol = naam => (/#ext#/i.test(naam) ? ME : TEAM_ME);   // de rol volgt het account in het id-token
const stand = async ev => ({
  modus: await ev('MTKijk.modus'), aan: await ev('MTKijk.aan'), loads: await ev('window.__loads'),
  echtLokaal: await ev("(window.MTKijk._echt || localStorage).getItem('mt_projecten')"), recordEcht: await ev("(window.MTKijk._echt || localStorage).getItem('mtkijk.actief')"),
  idb: await ev("typeof indexedDB !== 'undefined' && !!indexedDB"), appZichtbaar: await ev("(()=>{const a=document.getElementById('app-wrap'); return !!a && getComputedStyle(a).display!=='none' && getComputedStyle(a).visibility!=='hidden';})()"),
  login: await ev("(()=>{const a=document.getElementById('login-screen'); return !!a && getComputedStyle(a).display!=='none';})()"),
});
// 1. Een gast staat ook in de cache, maar het ACTIEVE account is een teamlid: gewone app met de echte opslag (met en zonder record)
for (const [titel, rec] of [['record van het teamlid', { h: 'oid2.tid', u: BART_A.username, ext: false, m: false }], ['geen record', null]]) {
  const r = await scenario('v2 gast in cache, teamlid actief (' + titel + ')', 'v2.html', { wacht: 9000, plant: true, me: naarRol, gebruiker: BART_A.username, plantAccounts: [BART_A, GAST_A], plantActief: 'oid2.tid', plantRecord: rec, controle: async ({ ev }) => stand(ev) });
  toets(`gast in cache + teamlid actief (${titel}): geen strenge modus, echte opslag en indexedDB, app zichtbaar, tokens alleen voor het teamlid`,
    r.staat.modus === null && r.staat.aan === false && /LOKAAL-1/.test(r.staat.echtLokaal || '') && r.staat.idb === true && r.staat.loads === 1 && r.staat.appZichtbaar === true
    && r.acq.length > 0 && r.acq.every(a => a.u === BART_A.username) && r.acq.some(a => a.scopes.some(sc => /graph\.microsoft\.com/.test(sc))), JSON.stringify({ staat: r.staat, acq: r.acq.slice(0, 4), exc: r.exc }));
}
// 2. Teamlid -> gast in dezelfde browser: één herlaadronde vóór er iets geladen wordt, daarna kijkmodus; geen lus; echte opslag onaangeroerd
const bartNaarGast = await scenario('v2 teamlid logt in als gast', 'v2.html', { wacht: 8000, plant: true, me: naarRol, gebruiker: BART_A.username, plantAccounts: [BART_A], plantRecord: { h: 'oid2.tid', u: BART_A.username, ext: false, m: false },
  controle: async ({ ev, sleep: slaap }) => {
    const voor = await stand(ev);
    await ev("(window.__loginAls = window.__gastAcct, msLogin().catch(()=>0), 1)"); await slaap(10000);
    const na = await stand(ev); await slaap(4000); const later = await ev('window.__loads');
    return { voor, na, later, record: await ev("JSON.stringify(JSON.parse(MTKijk._echt.getItem('mtkijk.actief')||'null'))"), lokaalGast: await ev("localStorage.getItem('mt_projecten')") };
  } });
toets('teamlid logt in als gast: precies één herlaadronde (geen lus), daarna kijkmodus', bartNaarGast.staat.voor.modus === null && bartNaarGast.staat.voor.aan === false && bartNaarGast.staat.na.loads === 2 && bartNaarGast.staat.later === 2 && bartNaarGast.staat.na.modus === 'kijk' && bartNaarGast.staat.na.aan === true, JSON.stringify(bartNaarGast.staat));
toets('teamlid logt in als gast: het record wijst naar de gast; de echte opslag van het teamlid blijft onaangeroerd en onzichtbaar voor de gast', /"ext":true/.test(bartNaarGast.staat.record) && /LOKAAL-1/.test(bartNaarGast.staat.na.echtLokaal || '') && !/LOKAAL/.test(bartNaarGast.staat.lokaalGast || '') && /P-0001/.test(bartNaarGast.staat.lokaalGast || '') && bartNaarGast.staat.na.idb === false, JSON.stringify(bartNaarGast.staat));
toets('teamlid logt in als gast: Graph blijft voor de gast dicht', !bartNaarGast.acq.some(a => a.u === GAST_A.username && a.scopes.some(sc => /graph\.microsoft\.com/.test(sc))), JSON.stringify(bartNaarGast.acq.filter(a => a.u === GAST_A.username)));
// 3. Gast uitloggen en daarna als teamlid inloggen: schoon herladen (record weg, echte opslag intact), dan gewone app met de echte opslag, zonder tweede herlaadronde
const gastNaarBart = await scenario('v2 gast logt uit en teamlid logt in', 'v2.html', { wacht: 9000, plant: true, me: naarRol, gebruiker: GAST_A.username,
  controle: async ({ ev, sleep: slaap }) => {
    const voor = await stand(ev);
    await ev("window.confirm = () => true; msLogout().catch(()=>0); 1"); await slaap(8000);
    const uit = await stand(ev);
    await ev(`(window.__loginAls = ${JSON.stringify(BART_A)}, msLogin().catch(()=>0), 1)`); await slaap(12000);
    const bart = await stand(ev); await slaap(3000);
    return { voor, uit, bart, later: await ev('window.__loads'), lokaal: await ev("localStorage.getItem('mt_projecten')"), acq: await ev('JSON.stringify(window.__acq)') };
  } });
const gb = gastNaarBart.staat;
toets('gast: kijkmodus voor het uitloggen', gb.voor.modus === 'kijk' && gb.voor.aan === true && gb.voor.loads === 1, JSON.stringify(gb.voor));
toets('gast logt uit: herladen zonder record en zonder strenge modus; loginscherm; echte opslag intact', gb.uit.loads === 2 && gb.uit.modus === null && gb.uit.recordEcht === null && gb.uit.login === true && /LOKAAL-1/.test(gb.uit.echtLokaal || ''), JSON.stringify(gb.uit));
toets('daarna teamlid-login: geen extra herlaadronde, gewone app met de echte opslag, record = teamlid, tokens voor het teamlid',
  gb.bart.loads === 2 && gb.later === 2 && gb.bart.modus === null && gb.bart.aan === false && /LOKAAL-1/.test(gb.lokaal || '') && /"ext":false/.test(gb.bart.recordEcht || '') && gb.bart.idb === true && gb.bart.appZichtbaar === true
  && JSON.parse(gb.acq).some(a => a.u === BART_A.username && a.scopes.some(sc => /graph\.microsoft\.com/.test(sc))), JSON.stringify(gb));
toets('accountwissel: geen uitzonderingen in de pagina', bartNaarGast.exc.length === 0 && gastNaarBart.exc.length === 0, JSON.stringify([bartNaarGast.exc, gastNaarBart.exc]));

// Integratietest van de zendkant met een teamlid (kantoor): het bijvulpad leest echt uit (nagebootst) SharePoint met een geldige URL en bearer-token,
// de versie komt uit SharePoint (lastModifiedDateTime), en een geslaagde save levert een spiegelzending op met de versie uit het PUT-antwoord.
const V_PROJ = '2026-11-01T08:00:00Z', V_PLAN = '2026-11-01T09:00:00Z', V_BLOK = '2026-11-01T10:00:00Z', V_SAVE = '2026-11-02T09:30:00Z';
const LIJST = { 'mt_projecten.json': ['"L-proj"', V_PROJ, [{ code: 'P-1', naam: 'Voorbeeldproject' }]], 'mt_planning.json': ['"L-plan"', V_PLAN, {}] };
const graafTeam = (u, m) => {
  const p = u.pathname;
  if (p === '/v1.0/sites/mortisetenon.sharepoint.com:/sites/MortiseTenon') return { s: 200, b: { id: 'SITE1' } };
  if (p === '/v1.0/sites/SITE1/drive/root:/MT-Bedrijfstool:/children') return { s: 200, b: { value: Object.entries(LIJST).map(([n, [e, t]]) => ({ name: n, eTag: e, lastModifiedDateTime: t, '@microsoft.graph.downloadUrl': `https://dl.example/${n}` })) } };
  if (u.hostname === 'dl.example') { const n = p.slice(1); return LIJST[n] ? { s: 200, b: LIJST[n][2] } : { s: 404, b: {} }; }
  if (p === '/v1.0/sites/SITE1/drive/root:/MT-Bedrijfstool/mt_planblokken.json' && u.searchParams.get('$select')) return { s: 200, b: { eTag: '"M1"', lastModifiedDateTime: V_BLOK } };
  if (p === '/v1.0/sites/SITE1/drive/root:/MT-Bedrijfstool/mt_planblokken.json:/content') return { s: 200, b: [{ id: 'b1', persoon: 'arjan' }], etag: '"M1"' };
  if (m === 'PUT' && /:\/content$/.test(p)) return { s: 200, b: { lastModifiedDateTime: V_SAVE }, etag: '"W1"' };
  return { s: 404, b: {} };
};
const teamSp = await scenario('v2 teamlid spiegel', 'v2.html', { wacht: 16000, graph: graafTeam, me: { ...ME, rol: 'kantoor', rolNaam: 'Kantoor', modus: 'log', altijdAfdwingen: undefined, extern: undefined, rechten: { ...RECHTEN, projecten: 'wijzigen', offertes: 'wijzigen', moneybird: 'concepten', uren: 'team', beheer: null } }, gebruiker: 'collega@mortiseandtenon.nl',
  controle: async ({ ev }) => {
    const s = {};
    s.save = await ev("_SP.write('mt_planning.json',{ 'P-1': { fases: [] } }).then(r=>String(r))");
    await ev('MTSpiegelInst.flushAlles().then(()=>1)');
    return s;
  } });
const zend = teamSp.netwerk.filter(n => n.methode === 'POST' && /^\/spiegel\//.test(n.pad)).map(n => ({ store: n.pad.slice(9), body: JSON.parse(n.body) }));
const lijstVerz = teamSp.netwerk.filter(n => n.host === 'graph.microsoft.com' && n.methode !== 'OPTIONS');
toets('teamlid: elke zending draagt een SharePoint-versie (listing, metadata of PUT-antwoord), nooit de klok van de pc; gesynchroniseerde stores zijn gezonden', zend.length >= 3 && zend.every(z => [V_PROJ, V_PLAN, V_BLOK, V_SAVE].map(v => Date.parse(v)).includes(z.body.ts)) && zend.some(z => z.store === 'mt_projecten') && zend.some(z => z.store === 'mt_planning'), JSON.stringify(zend.map(z => [z.store, new Date(z.body.ts).toISOString(), z.body.etag])));
toets('teamlid: het bijvulpad buiten de listing leest echt (geldige Graph-URL, bearer-token) en zendt met etag + versie van die lees', zend.some(z => z.store === 'mt_planblokken' && z.body.etag === '"M1"' && z.body.ts === Date.parse(V_BLOK) && z.body.data[0].id === 'b1')
  && lijstVerz.some(n => n.pad === '/v1.0/sites/SITE1/drive/root:/MT-Bedrijfstool/mt_planblokken.json:/content' && /^Bearer \S+/.test(n.auth || ''))
  && lijstVerz.some(n => n.pad === '/v1.0/sites/SITE1/drive/root:/MT-Bedrijfstool/mt_planblokken.json' && /select=eTag,lastModifiedDateTime/.test(decodeURIComponent(n.search))), JSON.stringify({ zend: zend.map(z => z.store), graph: lijstVerz.map(n => n.pad + n.search.slice(0, 30)).filter(x => /planblokken/.test(x)) }));
toets('teamlid: geen kapotte padstukken of lege tokens in de Graph-verzoeken', !lijstVerz.some(n => /root:\/\/|\/\/:\/content|:\/content\//.test(n.pad)) && lijstVerz.every(n => /^Bearer \S+/.test(n.auth || '')), JSON.stringify(lijstVerz.filter(n => !/^Bearer \S+/.test(n.auth || '') || /root:\/\//.test(n.pad)).map(n => n.pad)));
toets('teamlid: een geslaagde SharePoint-save geeft een zending met de versie uit het PUT-antwoord', teamSp.staat.save === 'true' && zend.some(z => z.store === 'mt_planning' && z.body.ts === Date.parse(V_SAVE) && z.body.etag === '"W1"' && z.body.data['P-1']), JSON.stringify([teamSp.staat.save, zend.filter(z => z.store === 'mt_planning').map(z => [z.body.ts, z.body.etag])]));
toets('teamlid: alleen stores uit de lijst van 13 worden gezonden', zend.every(z => ['mt_projecten', 'mt_planning', 'mt_planblokken', 'mt_planinrichting', 'mt_project_taken_v2', 'mt_project_afhank', 'mt_vrijedagen', 'mt_calc_offertes', 'mt_calc_defaults', 'mt_offerte_keuze', 'mt_uurtarieven', 'mt_verbeterpunten', 'mt_feedback'].includes(z.store)), JSON.stringify(zend.map(z => z.store)));
// De eigenaar ziet in Beheer de meekijker met einddatum, de uitnodiging, de aanvraag met vlag en het kijkoverzicht; niets uit de gegevens wordt als HTML uitgevoerd.
const eig = await scenario('v2 eigenaar beheer', 'v2.html', { wacht: 9000, me: { ...ME, rol: 'eigenaar', rolNaam: 'Eigenaar', modus: 'log', altijdAfdwingen: undefined, extern: undefined, toegangTot: undefined, rechten: { ...RECHTEN, projecten: 'wijzigen', beheer: 'alles', geld: 'wijzigen', moneybird: 'concepten', uren: 'alles' } }, gebruiker: 'baas@mortiseandtenon.nl',
  controle: async ({ ev }) => {
    const s = {};
    await ev('beheerLaad().then(()=>1)');
    s.beheer = await ev("document.getElementById('beheer-inhoud').innerText");
    s.knoppen = await ev("[...document.querySelectorAll('#beheer-inhoud button')].map(b=>b.textContent.trim()).join('|')");
    s.datumVelden = await ev("document.querySelectorAll('#beheer-inhoud input[type=date]').length");
    await ev("beheerKijkoverzicht('aaaaaaaa-0000-4000-8000-000000000009').then(()=>1)");
    s.kijk = await ev("document.getElementById('bh-kijk').innerText");
    s.xss = await ev('String(window.__xss)'); s.img = await ev("document.querySelectorAll('#beheer-inhoud img, #bh-kijk img, #bh-kijk b').length");
    s.rolOpties = await ev("[...document.querySelectorAll('#bh-inv-rol option')].map(o=>o.value).join(',')");
    return s;
  } });
toets('beheer: meekijker met "Toegang tot <datum>", Verlengen, Intrekken en Kijkoverzicht', /Toegang tot/.test(eig.staat.beheer) && /Verlengen/.test(eig.staat.knoppen) && /Intrekken/.test(eig.staat.knoppen) && /Kijkoverzicht/.test(eig.staat.knoppen), eig.staat.beheer.slice(0, 300) + ' || ' + eig.staat.knoppen);
toets('beheer: uitleg "Intrekken werkt binnen een minuut" + gastaccount in Microsoft 365', /Intrekken werkt binnen een minuut/.test(eig.staat.beheer) && /gastaccount in Microsoft 365/.test(eig.staat.beheer));
toets('beheer: uitnodigen als meekijker met verplichte einddatum-veld; meekijker-optie in de rollenlijst', eig.staat.datumVelden >= 3 && /meekijker/.test(eig.staat.rolOpties), JSON.stringify([eig.staat.datumVelden, eig.staat.rolOpties]));
toets('beheer: aanvraag met vlag "uitgenodigd als meekijker" + goedkeuren/weigeren', /uitgenodigd als meekijker/.test(eig.staat.beheer) && /Toekennen/.test(eig.staat.knoppen) && /Weigeren/.test(eig.staat.knoppen));
toets('beheer: kijkoverzicht toont de tijdlijn (tabblad + duur, onderdeel + aantal + geweigerd)', /Financiën/.test(eig.staat.kijk) && /3 verzoeken, 1 geweigerd/.test(eig.staat.kijk) && /Tabblad projecten/.test(eig.staat.kijk) && /1 min/.test(eig.staat.kijk), eig.staat.kijk.slice(0, 300));
toets('beheer: gegevens worden als tekst getoond (geen XSS, geen HTML uit naam of label)', eig.staat.xss === 'undefined' && eig.staat.img === 0 && /<img src=x onerror/.test(eig.staat.beheer) && /<b>Financiën<\/b>/.test(eig.staat.kijk), JSON.stringify([eig.staat.xss, eig.staat.img]));
toets('beheer: geen uitzonderingen', eig.exc.length === 0, eig.exc.join(' | '));
server.close();
console.log(mislukt.length ? `\n${mislukt.length} toets(en) mislukt` : '\nalle toetsen geslaagd');
process.exit(mislukt.length ? 1 : 0);
