// Neutraliseert de CHANGELOG-tekst (stdin -> stdout) voor de publieke repo: klantnamen, aliassen, locatienamen en
// Moneybird-contact-id's worden "[klant]". Woordenlijst, alles LOKAAL en genegeerd door git:
//   data/klanten.json          de huidige klantenlijst
//   data/klanten-historie.txt  alles wat ooit in klanten.json stond; groeit alleen (een naam die uit de lijst verdwijnt blijft
//                              geneutraliseerd, want de commitgeschiedenis noemt hem nog)
//   data/privacy-termen.txt    losse termen (een per regel)
// FAIL CLOSED: bij een parse- of runtimefout, of zonder woordenlijst, komt er GEEN uitvoer en een exitcode ≠ 0; de aanroeper
// (githooks/pre-commit) laat de bestaande CHANGELOG.md dan staan in plaats van ongefilterd te herschrijven.
// (2 = geen woordenlijst, 3 = fout in een bestand of tijdens het werk)
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'data');
function stop(code, melding) { process.stderr.write('changelog.js: ' + melding + '\n'); process.exit(code); }
try {
  const lees = f => { try { return fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, ''); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  const termenUitLijst = klanten => {
    const uit = [];
    for (const k of klanten) {
      if (!k || k.code === 'INT') continue;
      const waarden = [k.naam, k.mb_contact_id];
      for (const a of (Array.isArray(k.aliassen) ? k.aliassen : [])) waarden.push(a);
      for (const l of (Array.isArray(k.locaties) ? k.locaties : [])) { waarden.push(l && l.naam); waarden.push(l && l.mb_contact_id); }
      for (const v of waarden) if (typeof v === 'string' && v.trim().length >= 6 && v.trim().toLowerCase() !== 'styles') uit.push(v.trim());
    }
    return uit;
  };
  const termen = new Set();
  const kl = lees('klanten.json');
  let huidig = [];
  if (kl != null) {
    const j = JSON.parse(kl);                                     // kapot bestand = fout (niet stil overslaan)
    if (!j || !Array.isArray(j.klanten)) throw new Error('klanten.json heeft geen klanten-lijst');
    huidig = termenUitLijst(j.klanten);
  }
  const historieTekst = lees('klanten-historie.txt');
  const historie = new Set((historieTekst || '').split(/\r?\n/).map(r => r.trim()).filter(r => r.length >= 6));
  const bekend = new Set(historie);
  for (const x of huidig) historie.add(x);
  if ([...historie].some(x => !bekend.has(x))) {                  // alleen schrijven als er iets bij is gekomen; nooit verwijderen
    try { fs.writeFileSync(path.join(dir, 'klanten-historie.txt'), [...historie].sort().join('\n') + '\n', 'utf8'); }
    catch (e) { stop(3, 'kon klanten-historie.txt niet bijwerken: ' + e.message); }   // liever geen changelog dan een verlies van de geschiedenis
  }
  for (const x of historie) termen.add(x);
  const extra = lees('privacy-termen.txt');
  if (extra != null) for (const r of extra.split(/\r?\n/)) if (r.trim().length >= 3) termen.add(r.trim());
  if (!termen.size) stop(2, 'geen woordenlijst (data/klanten.json ontbreekt)');
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp([...termen].sort((a, b) => b.length - a.length).map(esc).join('|'), 'gi');
  const invoer = fs.readFileSync(0, 'utf8');
  const uit = invoer.replace(re, '[klant]');
  if (!uit.length) stop(3, 'lege invoer');
  process.stdout.write(uit);
} catch (e) { stop(3, (e && e.message) || String(e)); }
