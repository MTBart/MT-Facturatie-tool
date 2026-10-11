// Eenmalig (en opnieuw te draaien): vult data/klanten-historie.txt met ALLE klantnamen, aliassen, locaties en Moneybird-id's die
// ooit in de git-geschiedenis hebben gestaan — alle oude versies van data/klanten.json (ook in backup/ en de oude backup-mappen)
// én de oude hardcoded KLANTEN-blokken / KLANT_REGISTRY-tabellen in v2.html, index.html en dergelijke. Daarna zet het een
// seed-marker bovenaan; tools/changelog.js en de pre-commit-hook weigeren zonder die marker (fail closed).
//   node tools/changelog-seed.js            (vanuit de repo; vereist de volledige geschiedenis, dus geen shallow clone)
// De uitvoer bevat alleen aantallen, nooit de namen zelf. Het bestand staat in .gitignore (lokaal).
const fs = require('fs'), path = require('path'), cp = require('child_process');
const REPO = path.join(__dirname, '..'), DIR = path.join(REPO, 'data'), UIT = path.join(DIR, 'klanten-historie.txt');
const git = (args, opt) => cp.execFileSync('git', args, Object.assign({ cwd: REPO, maxBuffer: 256 * 1024 * 1024 }, opt || {}));
if (git(['rev-parse', '--is-shallow-repository']).toString().trim() === 'true') { console.error('shallow clone: de volledige geschiedenis ontbreekt'); process.exit(3); }

const termen = new Set();
const bruikbaar = v => typeof v === 'string' && v.trim().length >= 6 && v.trim().toLowerCase() !== 'styles';
// Geen klantnamen maar gewone woorden / neutrale voorbeeldtekst: nooit in de lijst (anders worden ze in de changelog weggepoetst)
const NIET = new Set(['intern', 'voorbeeldklant', 'testlocatie', 'mortise & tenon', 'mortise', 'tenon', 'administratie', 'werkplaats']);
const voeg = v => { if (bruikbaar(v) && !NIET.has(v.trim().toLowerCase()) && !/mortise\s*&\s*tenon/i.test(v)) termen.add(v.trim()); };
// JSON-klantenlijst (data/klanten.json in al zijn versies)
function uitJson(tekst) {
  let j; try { j = JSON.parse(tekst.replace(/^﻿/, '')); } catch (e) { return false; }
  if (!j || !Array.isArray(j.klanten)) return false;
  for (const k of j.klanten) {
    if (!k || k.code === 'INT') continue;
    voeg(k.naam); voeg(k.mb_contact_id);
    for (const a of (Array.isArray(k.aliassen) ? k.aliassen : [])) voeg(a);
    for (const l of (Array.isArray(k.locaties) ? k.locaties : [])) { if (l) { voeg(l.naam); voeg(l.mb_contact_id); } }
  }
  return true;
}
// Haakjes-tellend blok vanaf de opening (slaat tekenreeksen en commentaar over)
function blok(t, vanaf) {
  const open = t[vanaf], sluit = open === '[' ? ']' : '}'; let d = 0;
  for (let i = vanaf; i < t.length; i++) {
    const c = t[i];
    if (c === '"' || c === "'" || c === '`') { const q = c; i++; while (i < t.length && t[i] !== q) i += t[i] === '\\' ? 2 : 1; }
    else if (c === '/' && t[i + 1] === '/') { i = t.indexOf('\n', i); if (i < 0) break; }
    else if (c === '/' && t[i + 1] === '*') { i = t.indexOf('*/', i + 2); if (i < 0) break; i++; }
    else if (c === open) d++;
    else if (c === sluit && --d === 0) return t.slice(vanaf, i + 1);
  }
  return t.slice(vanaf, vanaf + 20000);
}
// Oude hardcoded registry's in html/js/md: KLANTEN = [ … ] (naam/mb_contact_id/locaties) en KLANT_REGISTRY = { 'alias': 'CODE' }
function uitTekst(t) {
  let n = 0;
  for (const m of t.matchAll(/\bKLANTEN\s*[:=]\s*(\[)/g)) {
    const b = blok(t, m.index + m[0].length - 1); n++;
    for (const x of b.matchAll(/\bnaam\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) voeg(x[2]);
    for (const x of b.matchAll(/\bmb_contact_id\s*:\s*['"`](\d{6,25})['"`]/g)) voeg(x[1]);
    for (const x of b.matchAll(/\baliassen\s*:\s*\[([^\]]*)\]/g)) for (const a of x[1].matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) voeg(a[2]);
  }
  for (const m of t.matchAll(/\bKLANT_REGISTRY\s*[:=]\s*(\{)/g)) {
    const b = blok(t, m.index + m[0].length - 1); n++;
    for (const x of b.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1\s*:/g)) voeg(x[2]);
  }
  return n;
}
// Oudere vormen: <option value="JAN">JAN — Naam</option> (html) en $KlantMap = @{ "CN" = "Naam" } (PowerShell)
function uitOverig(t) {
  let n = 0;
  for (const x of t.matchAll(/<option value="([A-Z0-9]{2,8})">\s*\1\s*[—-]+\s*([^<]{3,80})</g)) { voeg(x[2]); n++; }
  for (const m of t.matchAll(/KlantMap\s*=\s*@\{/g)) {
    const b = blok(t, m.index + m[0].length - 1); n++;
    for (const x of b.matchAll(/["']([^"']+)["']\s*=\s*["']([^"']+)["']/g)) voeg(x[2]);
  }
  return n;
}
// Alle blobs (unieke inhoud) van de relevante paden uit de hele geschiedenis
const lijst = git(['log', '--all', '--raw', '--no-abbrev', '--format=', '--diff-filter=AMR']).toString().split('\n');
const REL = /(^|\/)(klanten\.json|v2\.html|mobiel\.html|index\.html|index-v[0-9]+\.html|uren\.html|worker\.js|mt-[a-z-]+\.js|nieuw-project\.ps1|create-project-structure\.ps1)$|klant/i;
const blobs = new Map();
for (const r of lijst) { const m = r.match(/^:\d+ \d+ [0-9a-f]+ ([0-9a-f]{40}) [AMR]\d*\t(?:[^\t]+\t)?(.+)$/); if (m && REL.test(m[2])) blobs.set(m[1], m[2]); }
let gelezen = 0, jsonLijsten = 0, blokken = 0;
for (const [id, pad] of blobs) {
  let t; try { t = git(['cat-file', 'blob', id]).toString('utf8'); } catch (e) { continue; }
  gelezen++;
  if (/\.json$/i.test(pad)) { if (uitJson(t)) jsonLijsten++; }
  else {
    if (/mb_contact_id|KLANT_REGISTRY|KLANTEN/.test(t)) blokken += uitTekst(t) ? 1 : 0;
    if (/<option value=|KlantMap/.test(t)) blokken += uitOverig(t) ? 1 : 0;
  }
}
// Huidige lokale lijst + bestaande historie meenemen (de lijst groeit alleen)
let bestaand = '';
try { bestaand = fs.readFileSync(UIT, 'utf8'); } catch (e) {}
for (const r of bestaand.split(/\r?\n/)) if (!r.startsWith('#')) voeg(r);   // marker/commentaar overslaan
try { uitJson(fs.readFileSync(path.join(DIR, 'klanten.json'), 'utf8')); } catch (e) { /* geen lokale lijst */ }
if (!termen.size || !jsonLijsten) { console.error('niets gevonden in de geschiedenis: geen seed geschreven'); process.exit(2); }
const marker = `# SEED-HISTORIE v1 ${new Date().toISOString().slice(0, 10)} blobs=${gelezen} jsonlijsten=${jsonLijsten} termen=${termen.size}`;
fs.writeFileSync(UIT, marker + '\n' + [...termen].sort().join('\n') + '\n', 'utf8');
console.log(marker);
