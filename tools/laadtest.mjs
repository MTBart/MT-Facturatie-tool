// Laadt een pagina in headless Chrome via CDP, verzamelt console-fouten en test of de pagina reageert.
import { spawn, execSync } from 'node:child_process';
const URL_ = process.argv[2] || 'https://mtbart.github.io/MT-Facturatie-tool/v2.html';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9800 + Math.floor(Math.random() * 150);   // eigen poort per run: nooit de Chrome van een andere (achtergebleven) laadtest hergebruiken
const PROF = `mt-cdp-prof-${Date.now()}-${process.pid}`;   // uniek profiel: daarmee vinden we bij het opruimen precies onze eigen processen terug
const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${process.env.TEMP}/${PROF}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Opruimen: eerst netjes via CDP (Browser.close sluit alle processen van dit profiel), dan de boom van het startproces,
// en als laatste alles wat nog met ons eigen profiel draait. Op Windows overleeft de browser vaak zijn startproces,
// waardoor taskkill /T alleen niet genoeg is (zo bleven er honderden headless Chromes hangen).
async function opruimen() {
  try {
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const bws = new WebSocket(v.webSocketDebuggerUrl);
    await Promise.race([new Promise(r => bws.onopen = r), sleep(2000)]);
    if (bws.readyState === 1) { bws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); await sleep(1500); }
  } catch {}
  try { execSync(`taskkill /PID ${ch.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*${PROF}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' });
  } catch {}
}

try {
  let tgt;
  for (let i = 0; i < 30 && !tgt; i++) { await sleep(500); try { tgt = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {} }
  if (!tgt) throw new Error('Chrome start niet (geen CDP-doel)');
  const ws = new WebSocket(tgt.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const wacht = new Map();
  const send = (method, params = {}) => new Promise(res => { const i = ++id; wacht.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wacht.has(m.id)) { wacht.get(m.id)(m); wacht.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; console.log('EXC', d.exception?.description?.slice(0, 400) || d.text, d.url || '', d.lineNumber, d.columnNumber); }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) console.log('CON', m.params.type, m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') console.log('LOG', m.params.entry.text.slice(0, 300), m.params.entry.url || '');
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL_ });
  await sleep(10000);
  const t0 = Date.now();
  const r = await Promise.race([send('Runtime.evaluate', { expression: `(()=>{const b=document.body;return JSON.stringify(b?{ver:(b.innerText.match(/v2\\.\\d+\\.\\d+/)||[])[0],tabs:[...document.querySelectorAll('[data-tab],.tab,.nav-btn')].length,txt:b.innerText.slice(0,300)}:{geenBody:true,url:location.href,ready:document.readyState})})()`, returnByValue: true }), sleep(15000).then(() => 'TIMEOUT')]);
  console.log('EVAL', Date.now() - t0, 'ms', r === 'TIMEOUT' ? 'PAGINA REAGEERT NIET' : (r.result?.exceptionDetails ? 'EVAL-FOUT ' + (r.result.result?.description || '').slice(0, 200) : r.result?.result?.value));
} catch (e) {
  console.log('EXC laadtest zelf:', String(e && e.message || e).slice(0, 300));
  process.exitCode = 1;
} finally {
  await opruimen();
}
process.exit(process.exitCode || 0);
