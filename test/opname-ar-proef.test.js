// Test van het rekenwerk in docs/opname-ar-proef.html (hoeken aantikken met AR op een Android-telefoon).
// Draaien: node test/opname-ar-proef.test.js — verzonnen kamer, geen persoonsgegevens.
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'opname-ar-proef.html'), 'utf8');
const kern = html.split('/*KERN-BEGIN*/')[1].split('/*KERN-EINDE*/')[0];
const mod = { exports: {} };
new Function('module', kern)(mod);
const AR = mod.exports;

let goed = 0, fout = 0;
function check(naam, ok, extra) { if (ok) goed++; else fout++; console.log((ok ? 'ok  - ' : 'FOUT - ') + naam + (extra ? '  ' + extra : '')); }
const RAD = Math.PI / 180;

// Snijpunt met de vloer
let s = AR.snijVloer({ x: 0, y: 1.5, z: 0 }, { x: 0, y: -Math.SQRT1_2, z: -Math.SQRT1_2 }, 0, 12);
check('kijkrichting 45 graden omlaag op 1,5 m: vloerpunt 1,5 m vooruit', s && Math.abs(s.z + 1.5) < 1e-9 && Math.abs(s.x) < 1e-9 && s.y === 0);
check('kijkrichting omhoog: geen vloerpunt', AR.snijVloer({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0.2, z: -1 }, 0, 12) === null);
check('vloer verder dan 12 m: geen vloerpunt', AR.snijVloer({ x: 0, y: 1.5, z: 0 }, { x: 0, y: -0.05, z: -1 }, 0, 12) === null);
check('mediaan', AR.mediaan([3, 1, 2]) === 2 && AR.mediaan([4, 1, 2, 3]) === 2.5 && AR.mediaan([]) === null);

// De proefkamer met de knik, precies aangetikt (meters), gedraaid in de AR-ruimte, beide looprichtingen
const KAMER = [[0, 0], [4, 0], [4, 3], [2.5, 3], [0, 0.9022]], MATEN = [4000, 3000, 1500, 3264, 902];
function inAR(pts, graden) { const r = graden * RAD; return pts.map(p => ({ x: p[0] * Math.cos(r) - p[1] * Math.sin(r) + 0.7, z: p[0] * Math.sin(r) + p[1] * Math.cos(r) - 1.9 })); }
[false, true].forEach(om => {
  const pts = inAR(om ? KAMER.slice().reverse() : KAMER, 31), k = AR.kamer(pts), naam = om ? 'tegen de klok in' : 'met de klok mee';
  const maten = om ? MATEN.slice(0, 4).reverse().concat([MATEN[4]]) : MATEN;   // omgekeerd: wand i loopt van punt i naar i+1
  const verwachtL = om ? [3264, 1500, 3000, 4000, 902] : MATEN;
  check(naam + ': lengtes', k.wanden.every((w, i) => Math.abs(w.lengte - verwachtL[i]) < 1), k.wanden.map(w => w.lengte.toFixed(0)).join(' '));
  const verwachtH = om ? [140, 90, 90, 90, 130].map((h, i, a) => a[i]) : [90, 90, 90, 140, 130];
  check(naam + ': binnenhoeken', k.hoeken.slice().sort((a, b) => a - b).every((h, i) => Math.abs(h - [90, 90, 90, 130, 140][i]) < 0.05), k.hoeken.map(h => h.toFixed(1)).join(' '));
  check(naam + ': som van de binnenhoeken 540', Math.abs(k.hoeken.reduce((a, b) => a + b, 0) - 540) < 0.01);
  check(naam + ': oppervlak 9,38 m2', Math.abs(k.oppervlak / 1e6 - 9.3777) < 0.01, (k.oppervlak / 1e6).toFixed(3));
  const r = k.wanden.map(w => w.richting);
  check(naam + ': sluit op 0 met de echte maten', AR.sluit(r, verwachtL) < 2, AR.sluit(r, verwachtL).toFixed(2));
});

// Tikken met onnauwkeurigheid: hoeken 1 tot 2 graden scheef. Haaks zetten moet het gat kleiner maken.
let zaad = 99; const rnd = () => { zaad = (zaad * 1664525 + 1013904223) % 4294967296; return zaad / 4294967296 - 0.5; };
// Een kamer die echt haaks is (L-vorm), getikt met 3 cm afwijking per hoek: haaks gezet sluit hij met de echte maten op 0.
const LV = [[0, 0], [5, 0], [5, 2.2], [3, 2.2], [3, 4], [0, 4]], LM = [5000, 2200, 2000, 1800, 3000, 4000];
let nul = 0, proeven = 200, grootstVoor = 0;
for (let t = 0; t < proeven; t++) {
  const pts = inAR(LV.map(p => [p[0] + rnd() * 0.06, p[1] + rnd() * 0.06]), 360 * (rnd() + 0.5));
  const k = AR.kamer(pts), r = k.wanden.map(w => w.richting), a = AR.sluit(r, LM), b = AR.sluit(AR.haaks(r, 4, k.wanden.map(w => w.lengte)), LM);
  if (b < 0.5) nul++; grootstVoor = Math.max(grootstVoor, a);
}
check('haakse L-vorm met 3 cm tikfout: haaks gezet sluit op 0 (' + nul + ' van ' + proeven + ')', nul === proeven, 'zonder haaks zetten tot ' + grootstVoor.toFixed(0) + ' mm');
// De kamer met de knik met dezelfde tikfout: wat het gat dan doet, is informatie voor de proef (geen eis).
let som = 0, som2 = 0;
for (let t = 0; t < proeven; t++) {
  const pts = inAR(KAMER.map(p => [p[0] + rnd() * 0.06, p[1] + rnd() * 0.06]), 360 * (rnd() + 0.5));
  const k = AR.kamer(pts), r = k.wanden.map(w => w.richting);
  som += AR.sluit(r, MATEN); som2 += AR.sluit(AR.haaks(r, 4, k.wanden.map(w => w.lengte)), MATEN);
}
console.log('info - kamer met knik, 3 cm tikfout: gemiddeld gat ' + (som / proeven).toFixed(0) + ' mm zoals getikt, ' + (som2 / proeven).toFixed(0) + ' mm haaks gezet');

// Haaks zetten raakt de schuine wand niet
const kk = AR.kamer(inAR(KAMER, 12)), rr = kk.wanden.map(w => w.richting), hz = AR.haaks(rr, 4);
check('haaks zetten laat de schuine wand van 40 graden staan', Math.abs(hz[3] - rr[3]) < 1e-12 && Math.abs(hz[1] - rr[1]) < 1e-9);
const ha = AR.haaksAfwijking([90.5, 88, 270.4, 140, 131], 8);
check('afwijking van haaks over de bijna-haakse hoeken', ha && ha.aantal === 3 && Math.abs(ha.grootst - 2) < 1e-9 && Math.abs(ha.gemiddeld - (0.5 + 2 + 0.4) / 3) < 1e-9);

// knik (hoek tussen twee wanden tijdens het tikken)
check('knik van een rechte hoek is 90', Math.abs(AR.knik({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }) - 90) < 1e-9);

// voorbeeld
const vb = AR.kamer(AR.voorbeeld());
check('voorbeeld: 5 hoeken, wand 1 ongeveer 4 m', vb.wanden.length === 5 && Math.abs(vb.wanden[0].lengte - 4030) < 5, vb.wanden.map(w => w.lengte.toFixed(0)).join(' '));

[['3850', 3850], ['3,85', 3850], ['3,85 m', 3850], ['abc', null]].forEach(([t, v]) => check('leesMaat "' + t + '"', AR.leesMaat(t) === v));

console.log('\n' + goed + ' tests geslaagd' + (fout ? ', ' + fout + ' FOUT' : ''));
if (fout) process.exitCode = 1;
