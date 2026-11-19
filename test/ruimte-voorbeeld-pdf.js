// Maakt van de voorbeeldkamer (test/ruimte-voorbeeldkamer.js) een pakket, opent het in de kantoorpagina en drukt de tekeningen af als PDF.
// Zo is de voorbeeld-PDF altijd opnieuw te maken, ook van een bestaand pakket (zip) als tweede argument.
// Draaien: in de repo `python -m http.server 8123 --bind 127.0.0.1`, daarna `node test/ruimte-voorbeeld-pdf.js <uitmap> [pakket.zip]`. Vraagt Playwright met Chromium.
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const D = require('../mt-ruimte-dossier.js');
(async () => {
  const uit = process.argv[2]; let zip = process.argv[3], naam = 'pakket';
  if (!uit) { console.log('Gebruik: node test/ruimte-voorbeeld-pdf.js <uitmap> [pakket.zip]'); process.exit(1); }
  fs.mkdirSync(uit, { recursive: true });
  if (!zip) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'opname-ar-proef.html'), 'utf8'), mod = { exports: {} };
    new Function('module', html.split('/*KERN-BEGIN*/')[1].split('/*KERN-EINDE*/')[0])(mod);
    const K = require('./ruimte-voorbeeldkamer.js')(D, mod.exports, Date.now());
    const pk = await D.maakPakket(K.dossier, {}, { AR: mod.exports, nu: Date.now() });
    zip = path.join(uit, 'voorbeeldkamer.zip'); fs.writeFileSync(zip, Buffer.from(pk.bytes)); naam = 'voorbeeld';
  }
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('pageerror', e => console.log('PAGINAFOUT', e.message));
  await p.goto('http://127.0.0.1:8123/docs/opname-ar-kijk.html');
  await p.setInputFiles('#bestand', zip);
  await p.waitForSelector('#k-tekening:not([hidden])', { timeout: 20000 });
  await p.click('#k-tekening'); await p.waitForSelector('#rapport .rp-pagina');
  console.log('pagina\'s in het rapport:', await p.evaluate(() => document.querySelectorAll('#rapport .rp-pagina').length));
  const doel = path.join(uit, naam + '-tekeningen.pdf');
  await p.pdf({ path: doel, format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
  console.log('pdf:', doel, fs.statSync(doel).size, 'bytes');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
