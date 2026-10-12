#!/usr/bin/env node
// Tests voor githooks/privacy-scan.js, commit-msg, pre-push en vul-verboden-namen.js.
//   node githooks/test-privacy.js [--geen-head]
// Alle waarden zijn FICTIEF en worden uit stukjes opgebouwd, zodat dit bestand zelf niet door de scan struikelt.
// Voorbeeld-IBAN's komen uit de documentatie van de standaard. De laatste test controleert dat de huidige HEAD schoon is.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const S = require('./privacy-scan.js');
const HOOKS = __dirname;
let ok = 0, fout = 0;
function check(naam, voorwaarde, extra) {
  if (voorwaarde) { ok++; } else { fout++; console.log('FOUT: ' + naam + (extra ? ' -> ' + extra : '')); }
}
const namenObj = lijst => ({ lijst: lijst.map(t => new RegExp('(?<![\\p{L}\\p{N}])' + t.replace(/\s+/g, '\\s+') + '(?![\\p{L}\\p{N}])', 'iu')), aantal: lijst.length });
const NAMEN = namenObj(['Zonnebloem Testkeukens', 'Fictief Meubel']);
const vind = (regel, pad) => S.scanRegel(regel, pad || 'x.js', NAMEN).types;
const moetBlokkeren = (naam, regel, pad) => { const t = vind(regel, pad); check('positief: ' + naam, t.length > 0, 'geen treffer'); };
const moetSchoon = (naam, regel, pad) => { const t = vind(regel, pad); check('negatief: ' + naam, t.length === 0, t.join(',')); };

// ---------- IBAN ----------
const NL = 'NL91' + 'ABNA0417164300', GB = 'GB82' + 'WEST12345698765432', DE = 'DE89' + '370400440532013000';
moetBlokkeren('IBAN NL zonder spaties', 'rekening: ' + NL);
moetBlokkeren('IBAN NL met spaties', 'rekening: ' + 'NL91 ' + 'ABNA 0417 ' + '1643 00');
moetBlokkeren('IBAN GB', 'iban=' + GB);
moetBlokkeren('IBAN GB met spaties', 'GB82 ' + 'WEST 1234 5698 ' + '7654 32 betaald');
moetBlokkeren('IBAN DE', DE + ';');
moetBlokkeren('IBAN in JSON', '{"iban":"' + NL + '"}');
moetSchoon('IBAN met foute controle', 'NL91' + 'ABNA0417164301');
moetSchoon('hoofdletterwoord als IBAN-achtig', 'DE12 ABCD EFGH IJKL MNOP QR');
moetSchoon('gewone tekst', 'const NAAM = "ALLEENHOOFDLETTERS";');
check('mod97 NL', S.mod97(NL) === true && S.mod97('NL91' + 'ABNA0417164301') === false);

// ---------- hex-tokens ----------
const H32 = '0123456789abcdef'.repeat(2), H64 = '0123456789abcdef'.repeat(4);
moetBlokkeren('32-hex bij api_key', 'const api_key = "' + H32 + '";');
moetBlokkeren('64-hex bij token', 'moneybird_token: ' + H64);
moetBlokkeren('64-hex bij secret achter de waarde', H64 + ' // secret van moneybird');
moetSchoon('64-hex zonder context', 'const x = "' + H64 + '";');
moetSchoon('SRI-hash met integrity', '<script integrity="sha256-' + H64 + '" src="a.js">key');
moetSchoon('32-hex als deel van UUID', 'key = "a091db96-' + '3c1b-4f2e-9a7d-0123456789ab' + '"');
moetSchoon('hex met key maar te kort', 'key = "' + H32.slice(0, 30) + '"');

// ---------- Bearer ----------
moetBlokkeren('Bearer-literal', 'Authorization: Bearer ' + 'abcd1234'.repeat(3));
moetSchoon('Bearer met variabele', 'headers.Authorization = `Bearer ${token}`;');
moetSchoon('Bearer in woordgebruik', 'Gebruik een Bearer authenticatiemechanisme');

// ---------- Cloudflare / Azure / PEM / merken ----------
moetBlokkeren('Cloudflare cfut', 'x = "' + 'cfut_' + 'A1b2'.repeat(9) + '"');
moetBlokkeren('CLOUDFLARE_API_TOKEN toewijzing', 'CLOUDFLARE_API_TOKEN=' + 'Zz9Yy8Xx7Ww6'.repeat(2));
moetSchoon('CLOUDFLARE_API_TOKEN uit env', 'CLOUDFLARE_API_TOKEN=$CF_TOKEN_UIT_CI');
moetBlokkeren('Cloudflare 40 tekens met context', 'wrangler cloudflare token: ' + 'Ab1cDeFgHiJkLmNo' + 'PqRsTuVwXyZ0123456789abc');
moetBlokkeren('Azure client-secret patroon', 'abc' + '8' + 'Q~' + 'x'.repeat(10) + 'Y'.repeat(10) + 'z'.repeat(14));
moetBlokkeren('client_secret toewijzing', 'client_secret: "' + 'Abcdefghij1234567890' + '"');
moetSchoon('client_secret uit env', 'client_secret: process.env.AZURE_SECRET');
moetBlokkeren('PEM', '-'.repeat(5) + 'BEGIN ' + 'PRIVATE KEY' + '-'.repeat(5));
moetBlokkeren('PEM certificaat', '-'.repeat(5) + 'BEGIN ' + 'CERTIFICATE' + '-'.repeat(5));
moetBlokkeren('Anthropic-sleutel', 'k = "' + 'sk-ant-' + 'api03-' + 'A'.repeat(30) + '"');
moetBlokkeren('Toggl-sleutel', 'toggl_sk_' + 'a1'.repeat(15));
moetBlokkeren('GitHub-token', 'ghp_' + 'a1B2'.repeat(6));
moetBlokkeren('JWT', 'eyJhbGciOiJIUzI1NiJ9' + '.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIn0' + '.sig');
moetBlokkeren('wachtwoordtoewijzing', 'const wachtwoord = "' + 'Abcd1234Efgh5678' + '";');
moetSchoon('wachtwoord placeholder', 'const wachtwoord = "<hier-invullen>";');

// ---------- e-mail ----------
moetBlokkeren('e-mail van buiten', 'contact: ' + 'jan.jansen@' + 'bedrijf-voorbeeld.nl');
moetSchoon('e-mail eigen domein', 'bart@' + 'mortiseandtenon.nl');
moetSchoon('noreply anthropic', 'Co-Authored-By: Claude <noreply@' + 'anthropic.com>');
moetSchoon('example.com', 'mail: naam@' + 'example.com');
moetSchoon('github noreply', '123+naam' + '@users.noreply.github.com');
moetSchoon('versie-notatie', 'import "lodash@4.17.21"; img@2x.png');
moetSchoon('vendor-pad (auteur-e-mail)', '// Auteur ' + 'x@' + 'auteur-voorbeeld.org', 'vendor/lib.js');
moetBlokkeren('vendor-pad blijft token-gevoelig', 'toggl_sk_' + 'a1'.repeat(15), 'vendor/lib.js');

// ---------- telefoon ----------
moetBlokkeren('NL mobiel met streepje', 'bel 06-' + '12345678');
moetBlokkeren('NL +31', 'tel: +31 6 ' + '12345678');
moetBlokkeren('NL vast met spatie', 'kantoor 020 ' + '1234567');
moetBlokkeren('NL 0031', '0031' + '612345678');
moetBlokkeren('NL bare 06', '06' + '12345678');
moetSchoon('10 cijfers zonder context', 'id: 0' + '123456789');
moetSchoon('tijdstempel', 'const t = 1' + '712345678901;');

// ---------- BSN ----------
check('11-proef geldig', S.bsn11('12345' + '6782') && !S.bsn11('12345' + '6789') && !S.bsn11('1'.repeat(9)));
moetBlokkeren('BSN 11-proef', 'waarde ' + '123456' + '782 einde');
moetBlokkeren('BSN met punten', 'bsn ' + '123.456' + '.782');
moetBlokkeren('BSN bij trefwoord zonder 11-proef', 'BSN: ' + '123456' + '789');
moetSchoon('9 cijfers zonder 11-proef', 'const n = ' + '123456' + '789;');
moetSchoon('9 cijfers in decimaal', 'x = 1.' + '123456' + '782');

// ---------- namenlijst ----------
moetBlokkeren('naam in tekst', 'Offerte voor ' + 'zonnebloem testkeukens' + ' verstuurd');
moetBlokkeren('naam hoofdlettergevoelig niet', 'FICTIEF MEUBEL BV');
moetBlokkeren('naam aan het einde van de zin', 'mail aan fictief meubel.');
moetSchoon('naam als deel van langer woord', 'Zonnebloem Testkeukensen');
moetSchoon('andere tekst', 'Offerte voor een fictieve klant');
check('pad met naam', S.scanPad('docs/' + 'Fictief Meubel' + '.md', NAMEN).length === 1);
check('verboden pad', S.scanPad('toggl-preview/x.html', NAMEN).length === 1 && S.scanPad('_backup/a.bak', NAMEN).length >= 1 && S.scanPad('src/app.js', NAMEN).length === 0);

// ---------- uitzonderingen ----------
const M = S.MARK;
moetSchoon('uitzondering met reden', 'const i = "' + NL + '"; // ' + M + ' voorbeeld uit de IBAN-standaard');
moetSchoon('uitzondering in HTML-commentaar', 'tekst ' + NL + ' <!-- ' + M + ' documentatie-IBAN -->');
check('uitzondering zonder reden is een overtreding', vind('x = 1; // ' + M).includes('uitzonderingsmarkering zonder reden') && vind('x = 1; // ' + M + '   ').length === 1);
check('uitzondering levert reden', S.scanRegel('a // ' + M + ' om dit te testen', 'x.js', NAMEN).uitzondering === 'om dit te testen');
moetBlokkeren('markering op een andere regel telt niet', NL);   // de vorige regel was gemarkeerd, deze niet

// ---------- diff-parser ----------
{
  const diff = 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1,0 +5,2 @@\n+eerste\n+tweede ' + NL + '\n';
  const res = S.nieuwResultaat();
  S.scanDiffTekst(diff, res, NAMEN);
  check('diff: regelnummer en bestand', res.vondsten.length === 1 && res.vondsten[0].plek === 'x.js:6', JSON.stringify(res.vondsten));
  check('diff: waarde niet in uitvoer', !JSON.stringify(res).includes(NL));
}

// ---------- integratie: tijdelijke repo met kopie van de hooks ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-test-'));
const repo = path.join(tmp, 'repo'), bare = path.join(tmp, 'remote.git'), hk = path.join(repo, 'hooks-kopie');
const namenBestand = path.join(tmp, 'namen.txt');
fs.writeFileSync(namenBestand, '# test\nZonnebloem Testkeukens\n');
const env = Object.assign({}, process.env, { MT_VERBODEN_NAMEN: namenBestand, GIT_CONFIG_GLOBAL: path.join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' });
fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '[user]\n\tname = Test\n\temail = test@mortiseandtenon.nl\n');
const run = (args, cwd, extra) => cp.spawnSync(args[0], args.slice(1), Object.assign({ cwd: cwd || repo, env, encoding: 'utf8' }, extra || {}));
const g = (...args) => run(['git', ...args]);
try {
  fs.mkdirSync(repo); run(['git', 'init', '-q', '-b', 'main'], repo); fs.mkdirSync(hk);
  for (const f of ['privacy-scan.js', 'commit-msg', 'pre-push']) fs.copyFileSync(path.join(HOOKS, f), path.join(hk, f));
  g('config', 'core.hooksPath', 'hooks-kopie');
  g('config', 'core.autocrlf', 'false');
  run(['git', 'init', '-q', '--bare', '-b', 'main', bare], tmp);
  g('remote', 'add', 'origin', bare);
  const schrijf = (f, t) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), t); };
  const scanStaged = () => run(['node', path.join(HOOKS, 'privacy-scan.js'), '--staged']);

  schrijf('schoon.js', 'const a = 1;\n'); g('add', 'schoon.js');
  check('staged: schoon bestand door', scanStaged().status === 0);
  let c = g('commit', '-m', 'Eerste schone commit');
  check('commit-msg: schone commit lukt', c.status === 0, c.stderr);
  const p0 = g('push', '-q', 'origin', 'main');
  check('pre-push: schone push lukt', p0.status === 0, p0.stderr);

  // commit-msg blokkeert naam
  schrijf('b.js', 'const b = 2;\n'); g('add', 'b.js');
  c = g('commit', '-m', 'Offerte voor ' + 'Zonnebloem Testkeukens');
  check('commit-msg: naam in bericht geblokkeerd', c.status !== 0 && !c.stderr.includes('Zonnebloem'), c.stderr);
  c = g('commit', '-m', 'Co-Authored-By: Claude noreply@' + 'anthropic.com\n\n# commentaar met ' + NL);
  check('commit-msg: commentaarregels en allowlist genegeerd', c.status === 0, c.stderr);

  // staged met token
  schrijf('lek.js', 'const k = "' + 'toggl_sk_' + 'a1'.repeat(15) + '";\nconst i = "' + NL + '";\n'); g('add', 'lek.js');
  const s = scanStaged();
  check('staged: token + IBAN geblokkeerd, plek genoemd, geen waarde', s.status === 1 && s.stderr.includes('lek.js:1') && s.stderr.includes('lek.js:2') && !s.stderr.includes(NL) && !s.stderr.includes('toggl_sk_'), s.stderr);

  // --no-verify omzeilen en pre-push vangt het
  c = g('commit', '--no-verify', '-m', 'Omzeild');
  check('no-verify commit lukt (testopzet)', c.status === 0, c.stderr);
  const p1 = g('push', 'origin', 'main');
  check('pre-push: vangt lek na --no-verify', p1.status !== 0 && p1.stderr.includes('lek.js'), p1.stderr);
  check('pre-push: waarde niet getoond', !p1.stderr.includes(NL));
  const p2 = g('push', 'origin', 'main:nieuwe-tak');
  check('pre-push: nieuwe branch ook gescand', p2.status !== 0, p2.stderr);
  // herstel: nieuwe commit die het lek verwijdert is niet genoeg (oude commit zit nog in de range)
  schrijf('lek.js', 'const k = 1;\n'); g('add', 'lek.js'); g('commit', '-q', '-m', 'Opgeruimd');
  const p3 = g('push', 'origin', 'main');
  check('pre-push: lek blijft zichtbaar in de range zolang de commit erin zit', p3.status !== 0, p3.stderr);
  g('reset', '-q', '--hard', 'origin/main');
  const p4 = g('push', 'origin', 'main');
  check('pre-push: na reset schoon', p4.status === 0, p4.stderr);

  // uitzondering per regel + overzicht
  schrijf('doc.md', 'Voorbeeld-IBAN: ' + NL + ' <!-- ' + M + ' documentatie-voorbeeld -->\n'); g('add', 'doc.md');
  const u = scanStaged();
  check('uitzondering: staged door, wordt gemeld', u.status === 0 && u.stdout.includes('doc.md:1') && u.stdout.includes('documentatie-voorbeeld'), u.stdout + u.stderr);
  g('commit', '-q', '-m', 'Doc met uitzondering');
  const ov = run(['node', path.join(HOOKS, 'privacy-scan.js'), '--uitzonderingen']);
  check('overzicht toont uitzondering met reden', ov.status === 0 && ov.stdout.includes('doc.md:1') && ov.stdout.includes('documentatie-voorbeeld'), ov.stdout);
  schrijf('doc2.md', 'x ' + NL + ' <!-- ' + M + ' -->\n'); g('add', 'doc2.md');
  check('uitzondering zonder reden: geblokkeerd', scanStaged().status === 1);
  g('reset', '-q');

  // namen: lijst ontbreekt
  const zonder = cp.spawnSync('node', [path.join(HOOKS, 'privacy-scan.js'), '--bericht', path.join(tmp, 'leeg.txt')], { cwd: repo, env: Object.assign({}, env, { MT_VERBODEN_NAMEN: path.join(tmp, 'bestaat-niet.txt') }), encoding: 'utf8' });
  check('namenlijst ontbreekt: fout bij ontbrekend bericht (fail closed)', zonder.status !== 0);
  fs.writeFileSync(path.join(tmp, 'bericht.txt'), 'gewoon bericht\n');
  const zonder2 = cp.spawnSync('node', [path.join(HOOKS, 'privacy-scan.js'), '--bericht', path.join(tmp, 'bericht.txt')], { cwd: repo, env: Object.assign({}, env, { MT_VERBODEN_NAMEN: path.join(tmp, 'bestaat-niet.txt') }), encoding: 'utf8' });
  check('namenlijst ontbreekt: waarschuwing, geen blokkade', zonder2.status === 0 && zonder2.stderr.includes('namenlijst ontbreekt'), zonder2.stderr);
  const zonder3 = cp.spawnSync('node', [path.join(HOOKS, 'privacy-scan.js'), '--bericht', path.join(tmp, 'bericht.txt')], { cwd: repo, env: Object.assign({}, env, { MT_VERBODEN_NAMEN: path.join(tmp, 'bestaat-niet.txt'), MT_PRIVACY_NAMEN_VERPLICHT: '1' }), encoding: 'utf8' });
  check('namenlijst ontbreekt + verplicht: blokkade', zonder3.status === 1, zonder3.stderr);

  // vul-verboden-namen.js
  const bronJson = path.join(tmp, 'klanten.json'), bronTxt = path.join(tmp, 'extra.txt'), uit = path.join(tmp, 'uit', 'lijst.txt');
  fs.writeFileSync(bronJson, JSON.stringify({ klanten: [{ code: 'ZT', naam: 'Zonnebloem Testkeukens', aliassen: ['Zonnebloem', 'ZT'], mb_contact_id: '123456789012345678', locaties: [{ naam: 'Testlocatie Noord' }] }] }));
  fs.writeFileSync(bronTxt, '# comment\nLosse Fictieve Term\nkort\n');
  const v = run(['node', path.join(HOOKS, 'vul-verboden-namen.js'), '--bron', bronJson, '--bron', bronTxt, '--uit', uit], tmp);
  const lijst = fs.existsSync(uit) ? fs.readFileSync(uit, 'utf8') : '';
  check('vul-script: termen geschreven, geen id/korte termen, geen namen in uitvoer', v.status === 0 && /4 termen/.test(v.stdout) && lijst.includes('Testlocatie Noord') && !lijst.includes('123456789012345678') && !/^kort$/m.test(lijst) && !v.stdout.includes('Zonnebloem'), v.stdout + v.stderr);
  const v2 = run(['node', path.join(HOOKS, 'vul-verboden-namen.js'), '--bron', bronTxt, '--uit', uit, '--toevoegen'], tmp);
  check('vul-script: --toevoegen behoudt bestaande', v2.status === 0 && fs.readFileSync(uit, 'utf8').includes('Testlocatie Noord'), v2.stdout + v2.stderr);
} catch (e) {
  fout++; console.log('FOUT: integratietest crashte: ' + e.message);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* tijdelijke map blijft staan */ }
}

// ---------- CHANGELOG-neutralisatie (tools/changelog.js + tools/rekening-neutraal.js) ----------
{
  const { neutraal } = require('../tools/rekening-neutraal.js');
  const SPAAR = 'Z' + '123456789';
  check('neutraal: IBAN zonder spaties', neutraal('a ' + NL + ' b') === 'a [rekening] b');
  check('neutraal: IBAN met spaties, rest van de zin blijft', neutraal('NL91 ' + 'ABNA 0417 ' + '1643 00 en meer') === '[rekening] en meer');
  check('neutraal: IBAN GB en DE', neutraal(GB + ';' + DE) === '[rekening];[rekening]');
  check('neutraal: spaarrekening letter+cijfers', neutraal('Zakelijke oranje spaarrekening ' + SPAAR + ' ok') === 'Zakelijke oranje spaarrekening [rekening] ok');
  check('neutraal: 6 cijfers ook', neutraal('rekening Z' + '000000') === 'rekening [rekening]');
  check('neutraal: placeholder en gewone tekst blijven', neutraal('spaarrekening <nummer> en DE12 woord, rekening Z') === 'spaarrekening <nummer> en DE12 woord, rekening Z');
  check('neutraal: te kort of te lang woord geen IBAN', neutraal('NL91' + 'ABNA04171643') === 'NL91' + 'ABNA04171643' && neutraal('NL91' + 'ABNA0417164300EXTRA') === 'NL91' + 'ABNA0417164300EXTRA');

  const t2 = fs.mkdtempSync(path.join(os.tmpdir(), 'changelog-test-'));
  try {
    for (const d of ['tools', 'githooks', 'data']) fs.mkdirSync(path.join(t2, d));
    fs.copyFileSync(path.join(HOOKS, '..', 'tools', 'changelog.js'), path.join(t2, 'tools', 'changelog.js'));
    fs.copyFileSync(path.join(HOOKS, '..', 'tools', 'rekening-neutraal.js'), path.join(t2, 'tools', 'rekening-neutraal.js'));
    fs.copyFileSync(path.join(HOOKS, 'privacy-scan.js'), path.join(t2, 'githooks', 'privacy-scan.js'));
    fs.writeFileSync(path.join(t2, 'data', 'klanten.json'), JSON.stringify({ klanten: [{ code: 'ZT', naam: 'Zonnebloem Testkeukens', aliassen: [], locaties: [] }] }));
    fs.writeFileSync(path.join(t2, 'data', 'klanten-historie.txt'), '# SEED-HISTORIE fictief\n');
    const invoer = '## 2026-10-11 - Geld: pot spaarrekening ' + SPAAR + ' voor Zonnebloem Testkeukens, ' + NL + ' en NL91 ' + 'ABNA 0417 ' + '1643 00\n';
    const r = cp.spawnSync('node', [path.join(t2, 'tools', 'changelog.js')], { input: invoer, encoding: 'utf8' });
    check('changelog.js: klant en rekeningnummers neutraal', r.status === 0 && r.stdout === '## 2026-10-11 - Geld: pot spaarrekening [rekening] voor [klant], [rekening] en [rekening]\n', r.stdout + r.stderr);
  } finally { try { fs.rmSync(t2, { recursive: true, force: true }); } catch (e) { /* laat staan */ } }
}

// ---------- HEAD moet schoon zijn ----------
if (!process.argv.includes('--geen-head')) {
  const h = cp.spawnSync('node', [path.join(HOOKS, 'privacy-scan.js'), '--tree', 'HEAD'], { cwd: path.join(HOOKS, '..'), encoding: 'utf8' });
  check('HEAD komt schoon door de scan', h.status === 0, '\n' + (h.stderr || '').split('\n').slice(0, 40).join('\n'));
}

console.log('\nPrivacy-tests: ' + ok + ' geslaagd, ' + fout + ' mislukt');
process.exit(fout ? 1 : 0);
