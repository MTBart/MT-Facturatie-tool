// Controleert dat elke lokale <script src> en <link href> in de HTML-pagina's naar een bestaand bestand wijst
// (geen weggevallen bestandsnaam, bijvoorbeeld "=2026-10-23z", en geen verwijzing naar een bestand dat niet bestaat).
//   node tools/check-verwijzingen.js        exit 0 = in orde, exit 1 = fout
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const paginas = fs.readdirSync(root).filter(f => /\.html$/.test(f));
let fouten = 0, aantal = 0;
for (const pagina of paginas) {
  const tekst = fs.readFileSync(path.join(root, pagina), 'utf8');
  const re = /<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/gi; let m;
  while ((m = re.exec(tekst))) {
    const ref = m[1];
    if (/^(https?:)?\/\//i.test(ref) || /^(data|mailto|tel|javascript):/i.test(ref) || ref.startsWith('#')) continue;
    const bestand = decodeURIComponent(ref.split(/[?#]/)[0]);
    aantal++;
    if (!bestand || !fs.existsSync(path.join(root, bestand)) || fs.statSync(path.join(root, bestand)).isDirectory()) {
      fouten++; console.log('FOUT ' + pagina + ': verwijzing "' + ref + '" wijst naar geen bestand');
    }
  }
}
console.log(fouten ? 'check-verwijzingen: ' + fouten + ' fout(en) in ' + aantal + ' verwijzingen' : 'check-verwijzingen: ' + aantal + ' lokale verwijzingen in ' + paginas.length + ' pagina\'s in orde');
process.exit(fouten ? 1 : 0);
