#!/usr/bin/env node
// Vult de LOKALE lijst met verboden namen (klanten, aliassen, locaties, losse termen) voor githooks/privacy-scan.js.
// De lijst wordt NOOIT gecommit: standaard .git/info/verboden-namen.txt (gedeeld door alle worktrees van deze clone),
// of het pad in  git config mt.verbodenNamenPad  of --uit <pad>.
//
//   node githooks/vul-verboden-namen.js --bron <bestand> [--bron <bestand> ...] [--uit <pad>] [--min 5] [--toevoegen] [--zet-config]
//
// Bronnen (de regie wijst ze aan; ze worden alleen GELEZEN, nooit gekopieerd):
//   *.json  klantenlijst: {klanten:[{naam, aliassen[], locaties[{naam}]}]}, een array daarvan, of een array met strings
//   *.txt   een term per regel (# = commentaar), bv. data/klanten-historie.txt en data/privacy-termen.txt
// --toevoegen  houdt bestaande regels in de lijst (anders wordt de lijst vervangen)
// --zet-config schrijft het uitvoerpad naar git config mt.verbodenNamenPad (alleen nodig bij een eigen pad)
// De uitvoer toont alleen aantallen, nooit namen. Termen korter dan --min (standaard 5) worden overgeslagen (klantcodes e.d.).
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const a = process.argv.slice(2);
const bronnen = [];
let uit = null, min = 5, toevoegen = false, zetConfig = false;
for (let i = 0; i < a.length; i++) {
  if (a[i] === '--bron') bronnen.push(a[++i]);
  else if (a[i] === '--uit') uit = a[++i];
  else if (a[i] === '--min') min = +a[++i];
  else if (a[i] === '--toevoegen') toevoegen = true;
  else if (a[i] === '--zet-config') zetConfig = true;
  else { process.stderr.write('Onbekende optie: ' + a[i] + '\n'); process.exit(2); }
}
if (!bronnen.length) { process.stderr.write('Gebruik: node githooks/vul-verboden-namen.js --bron <bestand> [--bron ...] [--uit <pad>] [--min 5] [--toevoegen]\n'); process.exit(2); }
const git = args => { try { return cp.execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return ''; } };
if (!uit) uit = git(['config', '--get', 'mt.verbodenNamenPad']) || (git(['rev-parse', '--git-common-dir']) ? path.resolve(git(['rev-parse', '--git-common-dir']), 'info', 'verboden-namen.txt') : null);
if (!uit) { process.stderr.write('Geen uitvoerpad (geen git-map?): geef --uit <pad>.\n'); process.exit(2); }

const SLEUTELS = new Set(['naam', 'name', 'alias', 'aliassen', 'aliases', 'locatie', 'locaties', 'zoektermen', 'termen', 'bedrijf', 'klant']);
const termen = new Set();
function loop(w, sleutelOk) {
  if (typeof w === 'string') { if (sleutelOk) termen.add(w.trim()); return; }
  if (Array.isArray(w)) { for (const x of w) loop(x, sleutelOk); return; }
  if (w && typeof w === 'object') for (const [k, v] of Object.entries(w)) loop(v, SLEUTELS.has(k.toLowerCase()) || k.toLowerCase() === 'klanten');
}
for (const b of bronnen) {
  if (!fs.existsSync(b)) { process.stderr.write('Bron ontbreekt: ' + b + '\n'); process.exit(2); }
  const tekst = fs.readFileSync(b, 'utf8').replace(/^﻿/, '');
  if (/\.json$/i.test(b)) {
    let j;
    try { j = JSON.parse(tekst); } catch (e) { process.stderr.write('Bron is geen geldige JSON: ' + b + '\n'); process.exit(2); }
    loop(j, Array.isArray(j) && j.every(x => typeof x === 'string'));
  } else {
    for (const r of tekst.split(/\r?\n/)) { const t = r.trim(); if (t && !t.startsWith('#')) termen.add(t); }
  }
}
let bestaand = 0;
if (toevoegen && fs.existsSync(uit)) for (const r of fs.readFileSync(uit, 'utf8').split(/\r?\n/)) { const t = r.trim(); if (t && !t.startsWith('#')) { termen.add(t); bestaand++; } }
// De eigen organisatie staat als interne "klant" in de bronnen, maar is geen klantnaam: die mag overal in de code staan.
// Ook gewone woorden die als locatie van de eigen organisatie in de lijst staan (werkplaats, administratie, …) zijn geen klantnaam.
const EIGEN = /mortise|tenon|bedrijf ?vijf|^(werkplaats|administratie|kantoor|magazijn|showroom|algemeen|intern|hoofdkantoor|opslag|loods)$/i;
const eigen = [...termen].filter(t => EIGEN.test(t)).length;
const lijst = [...termen].filter(t => t.length >= min && !EIGEN.test(t)).sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()));
const overgeslagen = termen.size - lijst.length - eigen;
fs.mkdirSync(path.dirname(uit), { recursive: true });
fs.writeFileSync(uit, '# Lokale lijst verboden namen. NIET committen. Gemaakt door githooks/vul-verboden-namen.js; een term per regel.\n' + lijst.join('\n') + '\n');
if (zetConfig) git(['config', 'mt.verbodenNamenPad', uit]);
process.stdout.write('Verboden-namenlijst: ' + lijst.length + ' termen geschreven naar ' + uit + (overgeslagen ? ' (' + overgeslagen + ' korter dan ' + min + ' tekens overgeslagen)' : '') + (toevoegen ? ' (bestaande regels behouden: ' + bestaand + ')' : '') + '\n');
