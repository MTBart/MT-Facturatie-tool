// Laadt een pagina in headless Chrome via CDP, verzamelt console-fouten en test of de pagina reageert.
import { spawn } from 'node:child_process';
const URL_ = process.argv[2] || 'https://mtbart.github.io/MT-Facturatie-tool/v2.html';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9800 + Math.floor(Math.random() * 150);   // eigen poort per run: nooit de Chrome van een andere (achtergebleven) laadtest hergebruiken
const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${process.env.TEMP}/mt-cdp-prof-${Date.now()}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tgt;
for (let i = 0; i < 30 && !tgt; i++) { await sleep(500); try { tgt = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {} }
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
const r = await Promise.race([send('Runtime.evaluate', { expression: `JSON.stringify({ver:(document.body.innerText.match(/v2\\.\\d+\\.\\d+/)||[])[0], tabs:[...document.querySelectorAll('[data-tab],.tab,.nav-btn')].length, txt:document.body.innerText.slice(0,300)})`, returnByValue: true }), sleep(15000).then(() => 'TIMEOUT')]);
console.log('EVAL', Date.now() - t0, 'ms', r === 'TIMEOUT' ? 'PAGINA REAGEERT NIET' : r.result?.result?.value);
// Op Windows laat ch.kill() de kindprocessen van Chrome staan: de hele boom stoppen.
try { (await import('node:child_process')).execSync(`taskkill /PID ${ch.pid} /T /F`, { stdio: 'ignore' }); } catch { ch.kill(); }
process.exit(0);

