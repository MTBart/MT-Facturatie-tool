#!/usr/bin/env node
// Privacy- en secret-scan voor de PUBLIEKE MT-repo. Gedeeld door pre-commit, commit-msg en pre-push (zie githooks/README.md).
//
//   node githooks/privacy-scan.js --staged                 toegevoegde regels + bestandsnamen in de index (pre-commit)
//   node githooks/privacy-scan.js --bericht <bestand>      commitbericht (commit-msg)
//   node githooks/privacy-scan.js --range <a..b | sha>     alle commits in de range: diff, bericht, bestandsnamen (pre-push)
//   node githooks/privacy-scan.js --pre-push <remote> <url>   leest de pre-push-regels van stdin
//   node githooks/privacy-scan.js --tree [<rev>]           volledige boom van <rev> (standaard HEAD) als toegevoegde regels
//   node githooks/privacy-scan.js --uitzonderingen         overzicht van alle uitzonderingsmarkeringen in de gevolgde bestanden
//
// Uitzondering: ALLEEN per regel, met een reden:   // privacy-ok: <reden>   (elke commentaarsoort; de regel zelf moet de markering bevatten).
// Een markering zonder reden is zelf een overtreding. Namenlijst (lokaal, NIET gecommit): zie githooks/README.md.
// De uitvoer noemt type en plek, NOOIT de gevonden waarde of de naam.
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');

// ---------- markering ----------
const MARK = 'privacy' + '-ok:';
const MARK_RE = new RegExp(MARK + '[ \\t]*(\\S.*)?$');

// ---------- bestanden die voor sommige regels niet tellen ----------
// vendor-bibliotheken en kopieën bevatten auteurs-e-mails, versienummers en lange cijferreeksen.
const VENDOR_PAD = /(^|\/)(vendor|backup|node_modules)\//;
const BINAIR = /\.(png|jpe?g|gif|webp|ico|pdf|xlsx|woff2?|ttf|otf|zip|gz|mp[34]|mov)$/i;

// ---------- verboden paden (nieuw toegevoegde bestanden), aanvulling op PATH_RE in pre-commit ----------
const PAD_VERBODEN = [
  [/(^|\/)_backup\//, 'map _backup/'],
  [/(^|\/)backup-[0-9-]+\//, 'map backup-<datum>/'],
  [/(^|\/)toggl-preview\//, 'map toggl-preview/'],
  [/(^|\/)\.claude\/(ctx|memory|worktrees)\//, 'map .claude/(ctx|memory|worktrees)'],
  [/\.bak([-._0-9a-z]*)?$/i, 'back-upbestand (.bak)'],
  [/\.(sqlite3?|db)$/i, 'databasebestand'],
  [/(^|\/)\.dev\.vars/, '.dev.vars'],
  [/(^|\/)\.wrangler\//, 'map .wrangler/'],
  [/(^|\/)node_modules\//, 'map node_modules/'],
  [/(^|\/)data\/(klanten|klant-zoektermen|klanten-historie|privacy-termen|vaste-lasten)/, 'lokaal klantenbestand in data/'],
];

// ---------- IBAN ----------
const IBAN_LEN = { AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20 };
function mod97(iban) {
  const s = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of s) { const v = ch >= 'A' ? ch.charCodeAt(0) - 55 : ch.charCodeAt(0) - 48; rest = (rest * (v > 9 ? 100 : 10) + v) % 97; }
  return rest === 1;
}
function vindIbans(regel) {
  const uit = [];
  const re = /(?<![A-Za-z0-9])([A-Z]{2})(\d{2})((?: ?[A-Z0-9]){8,30})/g;
  let m;
  while ((m = re.exec(regel))) {
    const L = IBAN_LEN[m[1]];
    if (!L) continue;
    const kaal = (m[1] + m[2] + m[3]).replace(/ /g, '');
    if (kaal.length < L) continue;
    const kand = kaal.slice(0, L);
    // aansluitend nog een alfanumeriek teken zonder spatie = deel van een langer woord, geen IBAN
    if (kaal.length > L && !/ /.test(m[3]) && /[A-Za-z0-9]/.test(kaal[L])) continue;
    if (mod97(kand)) uit.push('IBAN');
  }
  return uit;
}

// ---------- BSN (11-proef) ----------
function bsn11(c) {
  if (!/^\d{9}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  let s = 0;
  for (let i = 0; i < 8; i++) s += (9 - i) * +c[i];
  s -= +c[8];
  return s % 11 === 0;
}

// ---------- telefoon (NL) ----------
function vindTelefoon(regel) {
  const uit = [];
  const re = /(?<![\w.+-])((?:\+|00)31[ -]?\(?0?\)?[ -]?|0)([1-9](?:[ -]?\d){8})(?![\d]|[.,]\d)/g;
  let m;
  while ((m = re.exec(regel))) {
    const cijfers = m[2].replace(/\D/g, '');
    if (cijfers.length !== 9) continue;
    const metPlus = m[1] !== '0';
    const heeftScheiding = /[ -]/.test(m[0]);
    const context = /(tel|telefoon|mobiel|phone|gsm|whatsapp|bel\b|fax)/i.test(regel);
    // 10 aaneengesloten cijfers die met 0 beginnen zijn te vaak een id: alleen 06-nummers of met telefoon-context
    if (!metPlus && !heeftScheiding && !(cijfers[0] === '6' || context)) continue;
    uit.push('telefoonnummer');
  }
  return uit;
}

// ---------- vaste regels (elke regel een type; alleen op toegevoegde tekst) ----------
const hexRE = (n) => new RegExp('(?<![0-9A-Za-z])[0-9a-fA-F]{' + n + '}(?![0-9A-Za-z])');
const CONTEXT_RE = /(token|key|secret|sleutel|bearer|apikey|passw|wachtwoord)/i;
const SRI_RE = /(integrity\s*=|sha(256|384|512)[-:]|['"]sha(256|384|512)['"])/i;

function vindHex(regel) {
  if (SRI_RE.test(regel)) return [];
  const uit = [];
  for (const n of [32, 64]) {
    const re = new RegExp('(?<![0-9A-Za-z])[0-9a-fA-F]{' + n + '}(?![0-9A-Za-z])', 'g');
    let m;
    while ((m = re.exec(regel))) {
      const voor = regel.slice(Math.max(0, m.index - 45), m.index), na = regel.slice(m.index + n, m.index + n + 45);
      if (CONTEXT_RE.test(voor) || CONTEXT_RE.test(na)) { uit.push(n + '-hex-token bij token/key/secret'); break; }
    }
  }
  return uit;
}

// [type, regexp, optionele extra controle (regel, match) => boolean]
const NIET_WAARDE = /^(client_secret|process\.|env\.|os\.|\$|<|\{|%|null|undefined|true|false|config|settings|secrets?\.|getenv)/i;
const VASTE_REGELS = [
  ['Anthropic/OpenAI-sleutel', /sk-ant-[A-Za-z0-9_-]{20,}|(?<![A-Za-z0-9-])sk-[A-Za-z0-9]{20,}/],
  ['Toggl-sleutel', /toggl_sk_[A-Za-z0-9]{20,}/],
  ['GitHub/cloud-token', /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['Cloudflare-token', /cfut_[A-Za-z0-9]{30,}|cfk_[A-Za-z0-9]{30,}|(CLOUDFLARE_API_TOKEN|CF_API_(KEY|TOKEN))["']?\s*[=:]\s*["']?[^<\s"'$%{][^\s"']{19,}/],
  ['Cloudflare-token (40 tekens)', /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40}(?![A-Za-z0-9_-])/, (regel, m) => /(cloudflare|wrangler|\bcf[_-])/i.test(regel) && /[a-z]/.test(m[0]) && /[A-Z]/.test(m[0]) && /\d/.test(m[0]) && !/^(\w+\.)+\w+$/.test(m[0]) && !/[\\/]/.test(regel.slice(Math.max(0, m.index - 1), m.index))],
  ['Azure client-secret (patroon)', /(?<![A-Za-z0-9_.~-])[A-Za-z0-9_.~-]{3}\dQ~[A-Za-z0-9_.~-]{30,}/],
  ['client_secret-toewijzing', /client_secret["']?\s*[=:]\s*["']?([^\s"',;]{10,})/i, (regel, m) => !NIET_WAARDE.test(m[1])],
  ['sleutel/wachtwoord-toewijzing', /(password|wachtwoord|passwd|secret|api[_-]?key)["']?\s*[:=]\s*["']([A-Za-z0-9/+_=.-]{16,})["']/i, (regel, m) => !NIET_WAARDE.test(m[2]) && /\d/.test(m[2]) && /[A-Za-z]/.test(m[2])],
  ['Bearer-token', /Bearer\s+([A-Za-z0-9._~+/=-]{20,})/, (regel, m) => /\d/.test(m[1])],
  ['PEM-blok (BEGIN)', new RegExp('-{5}BEGIN')],
  ['JWT', new RegExp('eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}|eyJ0eXAi' + 'OiJKV1Q')],
  ['refresh_token-waarde', /"refresh_token"\s*:\s*"[A-Za-z0-9]/],
  ['geheim via wrangler-commandoregel', /wrangler\s+secret\s+put[^\n]*<<<|echo\s+\S{16,}\s*\|\s*wrangler/],
  ['rekeningnummer in tekst', /(spaar|betaal|zakelijk)\w*rekening(nummer)?\s+[A-Z][0-9]{6,}/i],
];

// ---------- e-mail ----------
const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})(?![A-Za-z0-9-])/g;
// Eigen domein en bekende publieke domeinen. Alleen bekende publieke ADRESSEN/domeinen hier; nooit personen.
const MAIL_DOMEIN_OK = /^(mortiseandtenon\.nl|users\.noreply\.github\.com|example\.(com|org|net|nl)|test\.example|localhost)$/i;
const MAIL_ADRES_OK = new Set(['noreply@anthropic.com', 'noreply@github.com', 'no-reply@github.com', 'noreply@claude.ai']);
function vindEmail(regel) {
  const uit = [];
  let m;
  EMAIL_RE.lastIndex = 0;
  while ((m = EMAIL_RE.exec(regel))) {
    const adres = m[0].toLowerCase(), domein = m[1].toLowerCase();
    if (MAIL_DOMEIN_OK.test(domein) || MAIL_ADRES_OK.has(adres)) continue;
    // bestandsachtige "adressen" (img@2x.png, pkg@1.2.js) zijn geen e-mail
    if (/\.(png|jpe?g|gif|svg|webp|css|js|mjs|json|html?|map)$/i.test(domein)) continue;
    uit.push('e-mailadres buiten @mortiseandtenon.nl');
  }
  return uit;
}

// ---------- BSN-achtig ----------
function vindBsn(regel) {
  const uit = [];
  if (/\b(bsn|burgerservicenummer)\b.{0,15}(?<![\d])\d{9}(?!\d)/i.test(regel)) uit.push('BSN (bij trefwoord)');
  const re = /(?<![\w.,/-])(\d{9}|\d{3}[ .]\d{3}[ .]\d{3})(?![\w]|[.,]\d)/g;
  let m;
  while ((m = re.exec(regel))) { if (bsn11(m[1].replace(/\D/g, ''))) { uit.push('BSN-achtige reeks (11-proef)'); break; } }
  return uit;
}

// ---------- namenlijst ----------
function git(args, opt) {
  return cp.execFileSync('git', args, Object.assign({ maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] }, opt || {})).toString('utf8');
}
function gitOk(args) { try { return git(args).trim(); } catch (e) { return ''; } }
function namenPad() {
  if (process.env.MT_VERBODEN_NAMEN) return process.env.MT_VERBODEN_NAMEN;
  const cfg = gitOk(['config', '--get', 'mt.verbodenNamenPad']);
  if (cfg) return cfg;
  const gc = gitOk(['rev-parse', '--git-common-dir']);
  return gc ? path.resolve(gc, 'info', 'verboden-namen.txt') : null;
}
function laadNamen() {
  const p = namenPad();
  const res = { pad: p, lijst: null, aantal: 0, verplicht: false };
  res.verplicht = process.env.MT_PRIVACY_NAMEN_VERPLICHT === '1' || gitOk(['config', '--bool', '--get', 'mt.privacyNamenVerplicht']) === 'true';
  if (!p || !fs.existsSync(p)) return res;
  const termen = fs.readFileSync(p, 'utf8').replace(/^﻿/, '').split(/\r?\n/).map(r => r.trim()).filter(r => r && !r.startsWith('#'));
  const uniek = [...new Set(termen.map(t => t.toLowerCase()))];
  res.aantal = uniek.length;
  res.lijst = uniek.map(t => new RegExp('(?<![\\p{L}\\p{N}])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '(?![\\p{L}\\p{N}])', 'iu'));
  return res;
}

// ---------- scan van een tekstregel ----------
function scanRegel(regel, pad, namen) {
  const markering = regel.match(MARK_RE);
  if (markering) {
    const reden = (markering[1] || '').replace(/\s*(-->|\*\/|--%>)\s*$/, '').trim();
    if (!reden) return { types: ['uitzonderingsmarkering zonder reden'], uitzondering: null };
    return { types: [], uitzondering: reden };
  }
  const types = [];
  const vendor = VENDOR_PAD.test(pad || '');
  for (const [type, re, extra] of VASTE_REGELS) {
    const m = regel.match(re);
    if (m && (!extra || extra(regel, m))) types.push(type);
  }
  types.push(...vindIbans(regel));
  types.push(...vindHex(regel));
  if (!vendor) { types.push(...vindEmail(regel)); types.push(...vindTelefoon(regel)); types.push(...vindBsn(regel)); }
  if (namen && namen.lijst) { for (const re of namen.lijst) if (re.test(regel)) { types.push('verboden naam (lokale lijst)'); break; } }
  return { types: [...new Set(types)], uitzondering: null };
}

// Een pad scannen op naam: verboden paden + namenlijst
function scanPad(pad, namen) {
  const types = [];
  for (const [re, naam] of PAD_VERBODEN) if (re.test(pad)) types.push('verboden pad: ' + naam);
  if (namen && namen.lijst) for (const re of namen.lijst) if (re.test(pad)) { types.push('verboden naam in bestandsnaam'); break; }
  return types;
}

// ---------- git-diff parsen (toegevoegde regels) ----------
function parseDiff(tekst, cb) {
  let bestand = null, nr = 0;
  for (const r of tekst.split('\n')) {
    if (r.startsWith('diff --git ')) { bestand = null; continue; }
    if (r.startsWith('+++ ')) { bestand = r === '+++ /dev/null' ? null : r.replace(/^\+\+\+ (b\/)?/, '').replace(/\t.*$/, ''); continue; }
    if (r.startsWith('--- ')) continue;
    const h = r.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (h) { nr = +h[1]; continue; }
    if (bestand && r.startsWith('+')) { cb(bestand, nr, r.slice(1).replace(/\r$/, '')); nr++; }
  }
}

// ---------- resultaten verzamelen ----------
function nieuwResultaat() { return { vondsten: [], uitzonderingen: [], bestandenGescand: new Set() }; }
function scanDiffTekst(tekst, res, namen, voorvoegsel) {
  parseDiff(tekst, (bestand, nr, regel) => {
    if (BINAIR.test(bestand)) return;
    res.bestandenGescand.add(bestand);
    const r = scanRegel(regel, bestand, namen);
    for (const t of r.types) res.vondsten.push({ plek: (voorvoegsel || '') + bestand + ':' + nr, type: t });
    if (r.uitzondering) res.uitzonderingen.push({ plek: (voorvoegsel || '') + bestand + ':' + nr, reden: r.uitzondering });
  });
}
function scanNieuwePaden(lijst, res, namen, voorvoegsel) {
  for (const p of lijst) for (const t of scanPad(p, namen)) res.vondsten.push({ plek: (voorvoegsel || '') + p, type: t });
}
function scanBerichtTekst(tekst, res, namen, voorvoegsel) {
  const regels = tekst.split(/\r?\n/);
  regels.forEach((regel, i) => {
    if (regel.startsWith('#')) return;                       // commentaar van de editor
    const r = scanRegel(regel, '', namen);
    for (const t of r.types) res.vondsten.push({ plek: (voorvoegsel || 'commitbericht') + ':regel ' + (i + 1), type: t });
    if (r.uitzondering) res.uitzonderingen.push({ plek: (voorvoegsel || 'commitbericht') + ':regel ' + (i + 1), reden: r.uitzondering });
  });
}

const DIFF_OPTIES = ['-c', 'core.quotepath=off'];
const LEGE_BOOM = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function scanStaged(namen) {
  const res = nieuwResultaat();
  const paden = git([...DIFF_OPTIES, 'diff', '--cached', '--name-only', '--diff-filter=ACMR']).split('\n').filter(Boolean);
  scanNieuwePaden(paden, res, namen);
  scanDiffTekst(git([...DIFF_OPTIES, 'diff', '--cached', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=ACMR']), res, namen);
  return res;
}
function scanCommit(sha, res, namen) {
  const kort = sha.slice(0, 9);
  const paden = git([...DIFF_OPTIES, 'diff-tree', '--no-commit-id', '--name-only', '-r', '--root', '--diff-filter=ACMR', '-m', '--first-parent', sha]).split('\n').filter(Boolean);
  scanNieuwePaden(paden, res, namen, kort + ' ');
  scanDiffTekst(git([...DIFF_OPTIES, 'show', '--format=', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=ACMR', '-m', '--first-parent', sha]), res, namen, kort + ' ');
  scanBerichtTekst(git(['log', '-1', '--format=%B', sha]), res, namen, kort + ' bericht');
}
function scanRange(range, namen) {
  const res = nieuwResultaat();
  const shas = range.includes('..') || range.includes(' ') ? git(['rev-list', '--reverse', ...range.split(' ')]).split('\n').filter(Boolean) : [range];
  for (const sha of shas) scanCommit(sha, res, namen);
  res.commits = shas.length;
  return res;
}
function scanTree(rev, namen) {
  const res = nieuwResultaat();
  const paden = git([...DIFF_OPTIES, 'ls-tree', '-r', '--name-only', rev]).split('\n').filter(Boolean);
  scanNieuwePaden(paden, res, namen);
  scanDiffTekst(git([...DIFF_OPTIES, 'diff', '-U0', '--no-color', '--no-ext-diff', LEGE_BOOM, rev]), res, namen);
  return res;
}

// ---------- overzicht van uitzonderingen ----------
const OVERZICHT_NEGEER = new Set(['githooks/privacy-scan.js', 'githooks/test-privacy.js', 'githooks/README.md']);
function uitzonderingenOverzicht() {
  let uit = '';
  try { uit = git([...DIFF_OPTIES, 'grep', '-n', '-I', '-F', '-e', MARK]); } catch (e) { return []; }
  const lijst = [];
  for (const r of uit.split('\n').filter(Boolean)) {
    const m = r.match(/^([^:]+):(\d+):(.*)$/);
    if (!m || OVERZICHT_NEGEER.has(m[1])) continue;
    const mk = m[3].match(MARK_RE);
    if (!mk) continue;
    lijst.push({ plek: m[1] + ':' + m[2], reden: (mk[1] || '').replace(/\s*(-->|\*\/|--%>)\s*$/, '').trim() || '(GEEN REDEN: ongeldig)' });
  }
  return lijst;
}

// ---------- uitvoer ----------
function toonResultaat(res, titel, namen, opties) {
  const o = opties || {};
  const verplichtOntbreekt = namen && !namen.lijst;
  if (verplichtOntbreekt) {
    const tekst = 'Let op: lokale namenlijst ontbreekt (' + (namen.pad ? 'verwacht: ' + namen.pad : 'geen git-map') + '); klantnamen worden NIET gecontroleerd. Vullen: node githooks/vul-verboden-namen.js --bron <bestand>.';
    process.stderr.write((namen.verplicht ? 'STOP: ' : '') + tekst + '\n');
  }
  if (res.uitzonderingen.length) {
    process.stdout.write('Privacy-scan: ' + res.uitzonderingen.length + ' regel(s) met uitzonderingsmarkering (' + MARK + ' reden):\n');
    for (const u of res.uitzonderingen) process.stdout.write('   ' + u.plek + '  reden: ' + u.reden + '\n');
  }
  const stop = res.vondsten.length > 0 || (verplichtOntbreekt && namen.verplicht);
  if (res.vondsten.length) {
    process.stderr.write('\nGEBLOKKEERD: ' + titel + ': privacy-/secret-scan vond ' + res.vondsten.length + ' plek(ken) (waarden worden bewust niet getoond):\n');
    for (const v of res.vondsten) process.stderr.write('   [' + v.type + '] ' + v.plek + '\n');
    process.stderr.write('\nOplossen: haal het weg of vervang het door een placeholder. Alleen echt onschuldige regels:\n');
    process.stderr.write('   zet op DIE regel een commentaar met  ' + MARK + ' met een reden  (verschijnt in het uitzonderingenoverzicht).\n\n');
  } else if (!stop) {
    process.stdout.write('Privacy-scan: schoon' + (namen && namen.lijst ? ' (' + namen.aantal + ' verboden namen gecontroleerd)' : '') + '\n');
  }
  return stop ? 1 : 0;
}

// ---------- main ----------
function main() {
  const a = process.argv.slice(2);
  const modus = a[0];
  if (modus === '--uitzonderingen') {
    const l = uitzonderingenOverzicht();
    process.stdout.write('Uitzonderingen (' + MARK + ' reden): ' + l.length + '\n');
    for (const u of l) process.stdout.write('   ' + u.plek + '  ' + u.reden + '\n');
    process.exit(l.some(u => u.reden.startsWith('(GEEN')) ? 1 : 0);
  }
  const namen = laadNamen();
  let res, titel;
  if (modus === '--staged') { res = scanStaged(namen); titel = 'commit'; }
  else if (modus === '--bericht') {
    res = nieuwResultaat();
    scanBerichtTekst(fs.readFileSync(a[1], 'utf8'), res, namen);
    titel = 'commitbericht';
  } else if (modus === '--range') { res = scanRange(a.slice(1).join(' '), namen); titel = 'push'; }
  else if (modus === '--tree') { res = scanTree(a[1] || 'HEAD', namen); titel = 'boom ' + (a[1] || 'HEAD'); }
  else if (modus === '--pre-push') {
    const remote = a[1] || '';
    const invoer = fs.readFileSync(0, 'utf8').split('\n').filter(Boolean);
    res = nieuwResultaat();
    const nul = /^0+$/;
    const gezien = new Set();
    for (const regel of invoer) {
      const [, lokaal, , extern] = regel.split(' ');
      if (!lokaal || nul.test(lokaal)) continue;                      // branch verwijderen: niets te scannen
      let shas;
      if (extern && !nul.test(extern)) shas = git(['rev-list', '--reverse', extern + '..' + lokaal]).split('\n').filter(Boolean);
      else shas = git(['rev-list', '--reverse', lokaal, '--not', '--remotes=' + remote]).split('\n').filter(Boolean);
      for (const sha of shas) if (!gezien.has(sha)) { gezien.add(sha); scanCommit(sha, res, namen); }
    }
    res.commits = gezien.size;
    titel = 'push (' + gezien.size + ' commit(s))';
  } else {
    process.stderr.write('Gebruik: privacy-scan.js --staged | --bericht <bestand> | --range <range> | --pre-push <remote> <url> | --tree [rev] | --uitzonderingen\n');
    process.exit(2);
  }
  process.exit(toonResultaat(res, titel, namen));
}

if (require.main === module) {
  try { main(); } catch (e) { process.stderr.write('privacy-scan.js: fout, dus GEBLOKKEERD (fail closed): ' + e.message + '\n'); process.exit(3); }
}
module.exports = { scanRegel, scanPad, parseDiff, bsn11, mod97, vindIbans, MARK, scanDiffTekst, scanBerichtTekst, nieuwResultaat };
