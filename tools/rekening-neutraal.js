// Vervangt rekeningnummers in tekst door "[rekening]": IBAN's (met en zonder spaties, alle landen met een bekende lengte; bewust
// zonder controlegetal, liever te veel dan te weinig neutraliseren) en spaarrekeningnummers van de vorm letter + 6-9 cijfers in de
// context "rekening ..." (spaarrekening, betaalrekening, zakelijke rekening). Gebruikt door tools/changelog.js (de CHANGELOG is publiek).
'use strict';
const { IBAN_LEN } = require('../githooks/privacy-scan.js');

function neutraal(tekst) {
  let uit = tekst.replace(/(?<![A-Za-z0-9])([A-Z]{2})(\d{2})((?: ?[A-Z0-9]){8,30})/g, (m, land) => {
    const L = IBAN_LEN[land];
    if (!L) return m;
    let tel = 0, eind = -1;
    for (let k = 0; k < m.length; k++) { if (m[k] !== ' ') tel++; if (tel === L) { eind = k + 1; break; } }
    if (eind < 0) return m;                              // te kort voor dit land
    if (/[A-Za-z0-9]/.test(m[eind] || '')) return m;     // loopt door in een langer woord: geen IBAN
    return '[rekening]' + m.slice(eind);
  });
  uit = uit.replace(/(rekening\w*\s+)[A-Z]\d{6,9}(?!\d)/gi, '$1[rekening]');
  return uit;
}
module.exports = { neutraal };
