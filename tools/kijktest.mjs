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
  mt_planning: {}, mt_project_taken_v2: {}, mt_planblokken: [], mt_verlof: [], mt_vrijedagen: [], mt_klant_codes: {}, mt_offerte_keuze: {}, mt_calc_offertes: [], mt_calc_defaults: {},
};
const verzoeken = [];   // alles wat de pagina doet, zoals het de (nagebootste) worker of het netwerk bereikt
function antwoord(u, m) {
  const pad = u.pathname, target = u.searchParams.get('target');
  const json = (o, s = 200) => ({ s, b: JSON.stringify(o) });
  if (m === 'OPTIONS') return { s: 204, b: '' };
  if (pad === '/me') return json(ME_ACTIEF);
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
  if (pad === '/track' || pad === '/track/heartbeat') return json({ ok: true });
  if (pad === '/' && target) return json([]);
  return json({ error: 'onbekend' }, 404);
}

// ── Chrome en CDP ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let ME_ACTIEF = ME;   // per scenario instelbaar (de controle met een gewoon teamlid gebruikt een andere rol)
async function scenario(naam, pad, { wacht = 14000, controle, me = ME, gebruiker = 'coach_example.org#EXT#@example.net' }) {
  ME_ACTIEF = me;
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
        netwerk.push({ methode: r.method, host: u.hostname, pad: u.pathname, target: u.searchParams.get('target'), heeftBody: !!r.postData });
        if (u.origin === WORKER) { const a = antwoord(u, r.method); send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: a.s, responseHeaders: CORS, body: Buffer.from(a.b).toString('base64') }); }
        else send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: u.hostname.includes('microsoft') || u.hostname.includes('sharepoint') ? 401 : 200, responseHeaders: CORS.slice(0, 1), body: '' });
      }
    };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    // Nagebootste MSAL: een gast (#EXT#) is ingelogd; elke tokenaanvraag wordt vastgelegd.
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      (function(){
        window.__acq = [];
        const b64u = o => btoa(JSON.stringify(o)).replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_');
        const acct = { username: '${gebruiker}', name: 'Coach Voorbeeld', homeAccountId: 'h', localAccountId: 'l', environment: 'login.microsoftonline.com', tenantId: 't' };
        const idt = () => 'e30.' + b64u({ exp: Math.floor(Date.now()/1000) + 3600, oid: '${ME.oid}', preferred_username: acct.username }) + '.sig';
        const maak = (soort) => async (r) => { window.__acq.push({ soort, scopes: (r && r.scopes) || [] }); return { idToken: idt(), accessToken: 'AT', account: acct }; };
        const FAKE = { PublicClientApplication: class { constructor(){} async initialize(){} getAllAccounts(){ return [acct]; } acquireTokenSilent(r){ return maak('silent')(r); } acquireTokenPopup(r){ return maak('popup')(r); } acquireTokenRedirect(r){ return maak('redirect')(r); } async loginPopup(r){ window.__acq.push({ soort:'loginPopup', scopes:(r&&r.scopes)||[] }); return { account: acct }; } async logoutPopup(){} async handleRedirectPromise(){ return null; } } };
        Object.defineProperty(window, 'msal', { configurable: true, get(){ return FAKE; }, set(){} });
      })();` });
    await send('Page.navigate', { url: `${ORIGIN}/${pad}` });
    await sleep(wacht);
    const ev = async expressie => { const r = await send('Runtime.evaluate', { expression: expressie, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { fout: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text } : r.result?.result?.value; };
    const staat = await controle({ ev, sleep });
    const acq = await ev('JSON.stringify(window.__acq)');
    return { naam, exc, consoleFout, netwerk, acq: JSON.parse(acq || '[]'), staat };
  } finally { await opruimen(); }
}

// ── de toetsen ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const mislukt = []; const toets = (naam, ok, detail) => { console.log((ok ? 'ok   ' : 'FOUT ') + naam + (ok ? '' : '  ' + (detail || ''))); if (!ok) mislukt.push(naam); };
const GRAPH = /(^|\.)(graph\.microsoft\.com|sharepoint\.com|onedrive\.live\.com|office\.com|office365\.com|outlook\.com)$/i;

const v2 = await scenario('v2 meekijker', 'v2.html', {
  wacht: 15000,
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
    return s;
  },
});
const post = v2.netwerk.filter(n => n.methode !== 'GET' && n.methode !== 'OPTIONS' && n.host === 'mt-claude-proxy.bart-a12.workers.dev');
toets('v2: geen uitzonderingen in de pagina', v2.exc.length === 0, v2.exc.join(' | '));
toets('v2: kijkmodus actief + banner', v2.staat.kijk === true && /Meekijken/.test(v2.staat.banner), JSON.stringify([v2.staat.kijk, v2.staat.banner]));
toets('v2: banner toont de stand van de spiegel', /stand van/.test(v2.staat.banner), v2.staat.banner);
toets('v2: gegevens komen uit de spiegel (projecten lokaal gevuld)', /Voorbeeldproject/.test(v2.staat.projectData), v2.staat.projectData.slice(0, 80));
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
