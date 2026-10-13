#!/usr/bin/env node
// Maakt een manifest voor een ander basisadres (bv. na de verhuizing naar tool.mortiseandtenon.nl).
//   node outlook/maak-manifest.js https://tool.mortiseandtenon.nl/ [uitvoerbestand] [--proef]
// Met --proef wordt het testmanifest met gebeurtenissen (manifest-gebeurtenissen.xml) omgezet in plaats van manifest.xml.
// Zonder uitvoerbestand komt het manifest op stdout. Het huidige basisadres wordt uit <SupportUrl> gelezen; elke URL, het AppDomain
// volgen het nieuwe adres. Verhoog daarna <Version> zelf (en upload als "Update"); voeg ook de nieuwe redirect-URI toe in Azure (zie README.md).
const fs = require('fs'), path = require('path');
function maak(manifestTekst, nieuwBasis) {
  let basis;
  try { const u = new URL(nieuwBasis); if (u.protocol !== 'https:' || u.search || u.hash) throw new Error('x'); basis = u.origin + (u.pathname.endsWith('/') ? u.pathname : u.pathname + '/'); }
  catch (e) { throw new Error('Geef een https-adres zonder ?query of #hash, bv. https://tool.mortiseandtenon.nl/'); }
  const m = /<SupportUrl DefaultValue="([^"]+)"/.exec(manifestTekst);
  if (!m) throw new Error('SupportUrl niet gevonden in het manifest');
  const oud = m[1], oudOrigin = new URL(oud).origin, nieuwOrigin = new URL(basis).origin;
  let uit = manifestTekst.split(oud).join(basis);                                         // alle URL's onder het oude basisadres
  uit = uit.split('<AppDomain>' + oudOrigin + '</AppDomain>').join('<AppDomain>' + nieuwOrigin + '</AppDomain>');
  if (uit.includes(oudOrigin) && oudOrigin !== nieuwOrigin) throw new Error('Er staat nog een verwijzing naar ' + oudOrigin + ' in het manifest');
  return uit;
}
module.exports = { maak };
if (require.main === module) {
  const args = process.argv.slice(2), proef = args.includes('--proef'), [basis, uitvoer] = args.filter(a => a !== '--proef');
  if (!basis) { console.error('Gebruik: node outlook/maak-manifest.js <https-basisadres> [uitvoerbestand] [--proef]'); process.exit(2); }
  try {
    const uit = maak(fs.readFileSync(path.join(__dirname, proef ? 'manifest-gebeurtenissen.xml' : 'manifest.xml'), 'utf8'), basis);
    if (uitvoer) { fs.writeFileSync(uitvoer, uit); console.error('geschreven: ' + uitvoer); } else process.stdout.write(uit);
  } catch (e) { console.error(e.message); process.exit(1); }
}
