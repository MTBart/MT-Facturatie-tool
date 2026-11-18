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
// Plafond: snijpunt naar boven en de hoogte recht boven een vloerhoek
s = AR.snijHorizontaal({ x: 0, y: 1.5, z: 0 }, { x: 0, y: Math.SQRT1_2, z: -Math.SQRT1_2 }, 2.6, 12);
check('kijkrichting 45 graden omhoog, plafond op 2,6 m: plafondpunt 1,1 m vooruit', s && Math.abs(s.z + 1.1) < 1e-9 && s.y === 2.6);
check('omlaag kijken geeft geen plafondpunt achter je', AR.snijHorizontaal({ x: 0, y: 1.5, z: 0 }, { x: 0, y: -0.5, z: -1 }, 2.6, 12) === null);
{
  // vloerhoek op (2, 0, -3); de telefoon staat op (0, 1.45, 0) en kijkt naar de plafondhoek (2, 2.62, -3)
  const oog = { x: 0, y: 1.45, z: 0 }, doel = { x: 2, y: 2.62, z: -3 }, L = Math.hypot(2, 1.17, 3), d = { x: 2 / L, y: 1.17 / L, z: -3 / L };
  const h = AR.hoogteBoven(oog, d, { x: 2, z: -3 });
  check('plafondhoogte recht boven een vloerhoek: 2,62 m', h && Math.abs(h.y - 2.62) < 1e-9 && h.naast < 1e-9, h ? h.y.toFixed(4) + ' naast ' + h.naast.toExponential(1) : 'null');
  // 1 graad ernaast gericht: de hoogte verschuift maar een beetje
  const r = 1 * Math.PI / 180, d2 = { x: d.x * Math.cos(r) - d.z * Math.sin(r), y: d.y, z: d.x * Math.sin(r) + d.z * Math.cos(r) }, h2 = AR.hoogteBoven(oog, d2, { x: 2, z: -3 });
  check('1 graad zijwaarts ernaast: hoogte binnen 1 cm, afwijking naast de hoek zichtbaar', h2 && Math.abs(h2.y - 2.62) < 0.01 && h2.naast > 0.03, h2 ? h2.y.toFixed(4) + ' naast ' + h2.naast.toFixed(3) : 'null');
  check('recht omhoog kijken geeft geen hoogte', AR.hoogteBoven(oog, { x: 0, y: 1, z: 0 }, { x: 2, z: -3 }) === null);
  // plafondhoek aantikken: de vloerhoek ligt recht eronder
  const oog2 = { x: 0.4, y: 1.5, z: 0.2 }, hoek = { x: -1.3, z: -2.2 }, L2 = Math.hypot(hoek.x - oog2.x, 2.62 - 1.5, hoek.z - oog2.z);
  const sp = AR.snijHorizontaal(oog2, { x: (hoek.x - oog2.x) / L2, y: 1.12 / L2, z: (hoek.z - oog2.z) / L2 }, 2.62, 12);
  check('hoek via het plafond valt recht boven de echte vloerhoek', sp && Math.abs(sp.x - hoek.x) < 1e-9 && Math.abs(sp.z - hoek.z) < 1e-9);
  // 2 cm fout in de plafondhoogte geeft bij een hoek op 3 m afstand zo'n 5 cm fout op de vloer
  const sp2 = AR.snijHorizontaal(oog2, { x: (hoek.x - oog2.x) / L2, y: 1.12 / L2, z: (hoek.z - oog2.z) / L2 }, 2.64, 12);
  console.log('info - 2 cm fout in de plafondhoogte, hoek op ' + Math.hypot(hoek.x - oog2.x, hoek.z - oog2.z).toFixed(1) + ' m: ' + (AR.afstand(sp2, hoek) * 1000).toFixed(0) + ' mm ernaast op de vloer');
}
check('mediaan',AR.mediaan([3, 1, 2]) === 2 && AR.mediaan([4, 1, 2, 3]) === 2.5 && AR.mediaan([]) === null);

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

// Detail op de wand: de kijkrichting snijdt de dichtstbijzijnde wand (kamer 4 x 3, telefoon in het midden op 1,5 m)
{
  const W = AR.wanden3d([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }], true, 0, 2.6);
  const oog = { x: 2, y: 1.5, z: 1.5 }, r = { x: 0, y: -0.6, z: -0.8 }, s = AR.snijWand(oog, r, W);
  check('snijWand: recht naar wand 1, iets omlaag', s && s.nr === 0 && Math.abs(s.u - 2) < 1e-9 && Math.abs(s.v - (1.5 - 0.6 / 0.8 * 1.5)) < 1e-9, s && JSON.stringify({ nr: s.nr, u: s.u.toFixed(3), v: s.v.toFixed(3) }));
  const s2 = AR.snijWand(oog, { x: 1, y: 0, z: 0 }, W);
  check('snijWand: naar rechts komt op wand 2, 1,5 m vanaf H2', s2 && s2.nr === 1 && Math.abs(s2.u - 1.5) < 1e-9 && Math.abs(s2.v - 1.5) < 1e-9);
  check('snijWand: recht omhoog raakt geen wand', AR.snijWand(oog, { x: 0, y: 1, z: 0 }, W) === null);
  const s3 = AR.snijWand(oog, { x: 0, y: 0.9, z: -0.1 }, W);
  check('snijWand: boven het plafond van de wand telt niet', s3 === null);
}

// Richtingskaart en draai-aanwijzing
{
  const kijk = (yaw, pitch) => ({ pos: [1, 1.4, 1], dir: [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)] });
  const rond = []; for (let k = 0; k < 8; k++) rond.push(kijk(k * Math.PI / 4, 0));
  let r = AR.richtingen(rond.concat([kijk(0, 0.7), kijk(0, -0.7)]), { x: 1, z: 1 }, 0.6);
  check('richtingen: rondom, omhoog en omlaag gedekt: geen aanwijzing', r.sectoren.every(n => n === 1) && r.omhoog === 1 && r.omlaag === 1 && AR.draaiHint(r, 0) === null);
  r = AR.richtingen(rond.filter((_, k) => k !== 6 && k !== 7).concat([kijk(0, -0.7)]), { x: 1, z: 1 }, 0.6);
  const h = AR.draaiHint(r, 0);
  check('aanwijzing: links ontbreekt en omhoog ontbreekt', h && h.tekst === 'Draai hier even naar links en omhoog', h && h.tekst);
  check('aanwijzing: rechts als de leemte rechts ligt', AR.draaiHint(AR.richtingen(rond.filter((_, k) => k !== 2).concat([kijk(0, 0.7), kijk(0, -0.7)]), { x: 1, z: 1 }, 0.6), 0).tekst === 'Draai hier even naar rechts');
  check('beelden van een ander standpunt tellen niet mee', AR.richtingen(rond, { x: 3, z: 3 }, 0.6).n === 0);
  check('te weinig beelden: nog geen aanwijzing', AR.draaiHint(AR.richtingen(rond.slice(0, 2), { x: 1, z: 1 }, 0.6), 0) === null);
  const sg = AR.vlakSegment([{ x: 0, y: 0, z: 2 }, { x: 3, y: 0, z: 2 }, { x: 3, y: 2.4, z: 2 }, { x: 0, y: 2.4, z: 2 }], { x: 1, z: 0 });
  check('vlakSegment: wandvlak van bovenaf 3 m lang', sg && Math.abs(sg.lengte - 3) < 1e-9 && sg.y1 === 2.4 && Math.abs(sg.a.x) < 1e-9 && Math.abs(sg.b.x - 3) < 1e-9);
}

// Rechtzetten en de schuine wand op de eigen maten zetten
{
  // de echte proef van 17-11 (7 hoeken, schuine knik bij H2-H3), met de eigen maten
  const P = '0.141;-1.344 0.163;-0.736 0.778;-0.391 0.912;-0.413 1.129;2.933 -1.533;3.330 -1.725;-1.217'.split(' ').map(t => { const [a, b] = t.split(';').map(Number); return { x: a, z: b }; });
  const L = [600, 655, 155, 3427, 2454, 4371, 1792];
  const rz = AR.rechtzetten(P, 10), kc = AR.kamer(rz.punten);
  check('proef 17-11: zes wanden haaks gezet, wand 2 schuin', rz.schuin.length === 1 && rz.schuin[0] === 1, rz.haaks.join(','));
  check('proef 17-11: alle haakse hoeken precies 90 of 270', kc.hoeken.filter((h, i) => i !== 1 && i !== 2).every(h => Math.abs(h - 90) < 1e-6), kc.hoeken.map(h => h.toFixed(1)).join(' '));
  const f = AR.pasSchuin(kc.wanden.map(w => w.richting), rz.schuin, L), hk = AR.hoekenUitRichtingen(f.richtingen, 1);
  check('proef 17-11: met eigen maten blijft 42 mm over (de maten passen niet helemaal)', Math.abs(f.gat - 42.3) < 1, f.gat.toFixed(1) + ' mm, H2 ' + hk[1].toFixed(1) + ' H3 ' + hk[2].toFixed(1));
  check('proef 17-11: binnenhoeken samen 900 graden', Math.abs(hk.reduce((a, b) => a + b, 0) - 900) < 1e-6);
  for (const stap of [1, -1]) {
    for (let start = 0; start < P.length; start++) {
      const hoek = P.map((_, i) => (start + stap * i + P.length) % P.length);
      const wand = hoek.map((h, i) => stap === 1 ? h : hoek[(i + 1) % P.length]);
      const raster = AR.rechtzetten(hoek.map(h => P[h]), 10);
      const fit = AR.pasSchuin(AR.kamer(raster.punten).wanden.map(w => w.richting), raster.schuin, wand.map(w => L[w]));
      check('start H' + (start + 1) + ', richting ' + stap + ': dezelfde knik en sluitfout',
        raster.schuin.length === 1 && wand[raster.schuin[0]] === 1 && Math.abs(fit.gat - f.gat) < 0.001);
    }
  }
  const recht = AR.rechtzetten([{x: 0, z: 0}, {x: 3, z: 0}, {x: 3, z: 2}, {x: 0, z: 2}], 10);
  check('exact haakse wanden blijven als haaks geclassificeerd', recht.schuin.length === 0);

}
{
  // kamer met de knik, haakse hoeken tot 6 graden scheef getikt: rechtzetten + echte maten geeft de echte kamer terug
  let goed2 = 0, slechtst = 0, hoekFout = 0;
  for (let t = 0; t < 200; t++) {
    const pts = inAR(KAMER.map(p => [p[0] + rnd() * 0.2, p[1] + rnd() * 0.2]), 360 * (rnd() + 0.5));
    const rz = AR.rechtzetten(pts, 10), kc = AR.kamer(rz.punten), ruw = AR.kamer(pts);
    const opp = (() => { let s2 = 0; const Q = kc.punten; for (let i = 0; i < Q.length; i++) { const q = Q[(i + 1) % Q.length]; s2 += Q[i].x * q.y - q.x * Q[i].y; } return s2; })();
    const f = AR.pasSchuin(kc.wanden.map(w => w.richting), rz.schuin, MATEN), hk = AR.hoekenUitRichtingen(f.richtingen, opp >= 0 ? 1 : -1);
    const fout2 = Math.max(...hk.map((h, i) => Math.abs(h - [90, 90, 90, 140, 130][i])));
    if (rz.schuin.length === 1 && f.gat < 2 && fout2 < 0.1) goed2++;
    slechtst = Math.max(slechtst, f.gat); hoekFout = Math.max(hoekFout, Math.max(...ruw.hoeken.map((h, i) => Math.abs(h - [90, 90, 90, 140, 130][i]))));
  }
  check('kamer met knik, tikfout tot 10 cm: haaks gezet en op maten sluit hij en de knik komt op 140/130 (' + goed2 + ' van 200)', goed2 >= 190, 'getikte hoeken tot ' + hoekFout.toFixed(1) + ' graden scheef, grootste gat ' + slechtst.toFixed(1) + ' mm');
}
{
  // twee schuine wanden (een afgeschuinde rechthoek aan twee kanten): sluit precies
  const K2 = [[0, 0], [4, 0], [4.6, 0.6], [4.6, 3], [0.8, 3], [0, 2.2]], M2 = [];
  for (let i = 0; i < K2.length; i++) { const a = K2[i], b = K2[(i + 1) % K2.length]; M2.push(Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 1000)); }
  const pts = inAR(K2.map(p => [p[0] + rnd() * 0.04, p[1] + rnd() * 0.04]), 17), rz = AR.rechtzetten(pts, 10), kc = AR.kamer(rz.punten);
  const f = AR.pasSchuin(kc.wanden.map(w => w.richting), rz.schuin, M2);
  check('twee schuine wanden: beide herkend en de kamer sluit op de maten', rz.schuin.length === 2 && f.gat < 2, 'schuin ' + rz.schuin.join(',') + ', gat ' + f.gat.toFixed(2));
}
check('stabiel punt: mediaan negeert een uitschieter van het drukken', (() => { const p = AR.stabiel([{ x: 1, z: 2 }, { x: 1.01, z: 2.01 }, { x: 0.99, z: 1.99 }, { x: 1.4, z: 2.5 }, { x: 1, z: 2 }]); return Math.abs(p.x - 1) < 0.011 && Math.abs(p.z - 2) < 0.011; })());

// knik (hoek tussen twee wanden tijdens het tikken)
check('knik van een rechte hoek is 90', Math.abs(AR.knik({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }) - 90) < 1e-9);

// voorbeeld
const vb = AR.kamer(AR.voorbeeld());
check('voorbeeld: 5 hoeken, wand 1 ongeveer 4 m', vb.wanden.length === 5 && Math.abs(vb.wanden[0].lengte - 4030) < 5, vb.wanden.map(w => w.lengte.toFixed(0)).join(' '));

[['3850', 3850], ['3,85', 3850], ['3,85 m', 3850], ['abc', null]].forEach(([t, v]) => check('leesMaat "' + t + '"', AR.leesMaat(t) === v));

console.log('\n' + goed + ' tests geslaagd' + (fout ? ', ' + fout + ' FOUT' : ''));
if (fout) process.exitCode = 1;

// ---------- panorama: projectie, wanden, vakjes en dekking ----------
{
  const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s2 = 0; for (let k = 0; k < 4; k++) s2 += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s2; } return o; };
  const persp = (fov, asp, n, f) => { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; };
  const kijk = (o, d) => { const nz = [o[0] - d[0], o[1] - d[1], o[2] - d[2]], l = Math.hypot(...nz), z = nz.map(v => v / l), x0 = [z[2], 0, -z[0]], lx = Math.hypot(...x0), x = x0.map(v => v / lx), y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const d3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -d3(x, o), -d3(y, o), -d3(z, o), 1]; };
  const camera = (pos, doel) => ({ pos, dir: [doel[0] - pos[0], doel[1] - pos[1], doel[2] - pos[2]], pv: mul(persp(60 * Math.PI / 180, 0.56, 0.05, 50), kijk(pos, doel)) });
  const c0 = camera([0, 1.4, 0], [0, 1.4, -3]);
  const midden = AR.projecteer(c0.pv, 0, 1.4, -3), rechts = AR.projecteer(c0.pv, 0.5, 1.4, -3), boven = AR.projecteer(c0.pv, 0, 2, -3);
  check('projectie: recht vooruit valt in het midden van het beeld', Math.abs(midden.x - 0.5) < 1e-9 && Math.abs(midden.y - 0.5) < 1e-9);
  check('projectie: rechts is rechts, boven is boven (y naar beneden)', rechts.x > 0.5 && Math.abs(rechts.y - 0.5) < 1e-9 && boven.y < 0.5);
  check('projectie: achter de camera geeft niets', AR.projecteer(c0.pv, 0, 1.4, 3) === null);
  // kamer 4 x 3 m, vloer op 0; telefoon in het midden draait rond
  const K = [{ x: -2, z: -1.5 }, { x: 2, z: -1.5 }, { x: 2, z: 1.5 }, { x: -2, z: 1.5 }];
  const W = AR.wanden3d(K, true, 0, 2.6), Wom = AR.wanden3d(K.slice().reverse(), true, 0, 2.6);
  check('wanden: 4 stuks, normaal wijst de kamer in (beide looprichtingen)', W.length === 4 && [W, Wom].every(ws => ws.every(w => { const mx = w.a.x + w.ux * w.L / 2, mz = w.a.z + w.uz * w.L / 2; return (0 - mx) * w.nx + (0 - mz) * w.nz > 0; })));
  const C = W.map(w => AR.cellen(w, 0.3));
  check('vakjes: wand van 4 m bij 2,6 m in 13 x 9 vakjes', C[0].length === 13 * 9 && Math.abs(C[0][C[0].length - 1].u1 - 4) < 1e-9 && Math.abs(C[0][C[0].length - 1].v1 - 2.6) < 1e-9);
  const frames = [];
  for (let i = 0; i < 24; i++) for (const hoog of [0.6, 1.4, 2.2]) { const a = i / 24 * 2 * Math.PI; frames.push(camera([0, 1.4, 0], [Math.sin(a) * 3, hoog, -Math.cos(a) * 3])); }
  frames.forEach((f, i) => AR.dekBij(C, W, f, i));
  const dek = AR.dekking(C);
  check('dekking: rondkijken vanuit het midden laat bijna alle wanden zien', dek > 0.9, Math.round(dek * 100) + '%');
  const C2 = W.map(w => AR.cellen(w, 0.3)); AR.dekBij(C2, W, frames[0], 0);
  const per = C2.map(cs => cs.filter(c => c.beste >= 0).length);
  check('dekking: één beeld naar wand 1 dekt alleen wand 1', per[0] > 0 && per[1] === 0 && per[2] === 0 && per[3] === 0, per.join(','));
  const weg = camera([0, 1.4, -3], [0, 1.4, -6]), C3 = W.map(w => AR.cellen(w, 0.3)); AR.dekBij(C3, W, weg, 0);
  check('dekking: een beeld dat van de kamer wegkijkt telt niet', AR.dekking(C3) === 0);
  const langs = camera([1.9, 1.4, 0], [1.9, 1.4, -3]), C4 = W.map(w => AR.cellen(w, 0.3)); AR.dekBij(C4, W, langs, 0);
  check('dekking: een wand waar je vlak langs kijkt telt niet', C4[1].every(c => c.beste < 0));
  // affiene afbeelding
  const m = AR.affien({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 5, y: 5 }, { x: 25, y: 5 }, { x: 5, y: 25 });
  check('affien: schalen en verschuiven', m && Math.abs(m[0] - 2) < 1e-9 && Math.abs(m[3] - 2) < 1e-9 && Math.abs(m[4] - 5) < 1e-9 && Math.abs(m[5] - 5) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9);
}
console.log('\n' + goed + ' tests geslaagd (na panorama)' + (fout ? ', ' + fout + ' FOUT' : ''));
if (fout) process.exitCode = 1;
