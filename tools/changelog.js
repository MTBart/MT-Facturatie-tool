// Neutraliseert de CHANGELOG-tekst (stdin -> stdout) voor de publieke repo: klantnamen, aliassen, locatienamen en
// Moneybird-contact-id's uit de LOKALE data/klanten.json, plus losse termen uit het lokale data/privacy-termen.txt
// (een term per regel), worden "[klant]". Geen woordenlijst beschikbaar: exitcode 2 en niets op stdout, zodat de aanroeper
// (githooks/pre-commit) de bestaande CHANGELOG.md ongemoeid laat in plaats van ongefilterd te herschrijven.
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'data');
const termen = new Set();
const lees = f => { try { return fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, ''); } catch (e) { return null; } };
const kl = lees('klanten.json');
if (kl) {
  try {
    for (const k of JSON.parse(kl).klanten || []) {
      if (k.code === 'INT') continue;
      for (const v of [k.naam, k.mb_contact_id, ...(k.aliassen || []), ...(k.locaties || []).flatMap(l => [l.naam, l.mb_contact_id])]) {
        if (typeof v === 'string' && v.trim().length >= 6 && v.trim().toLowerCase() !== 'styles') termen.add(v.trim());
      }
    }
  } catch (e) { /* kapotte lijst: zonder die termen verder */ }
}
const extra = lees('privacy-termen.txt');
if (extra) for (const r of extra.split(/\r?\n/)) if (r.trim().length >= 3) termen.add(r.trim());
if (!termen.size) process.exit(2);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const re = new RegExp([...termen].sort((a, b) => b.length - a.length).map(esc).join('|'), 'gi');
let invoer = fs.readFileSync(0, 'utf8');
process.stdout.write(invoer.replace(re, '[klant]'));
