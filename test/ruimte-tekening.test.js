// Test van mt-ruimte-tekening.js: het wandaanzicht, de doorsnede, de kameruitslag en de wandafwikkeling als boom van gewone objecten.
// Draaien: node test/ruimte-tekening.test.js — met de nagebootste voorbeeldkamer (test/ruimte-voorbeeldkamer.js), geen klant- of persoonsgegevens.
'use strict';
const fs = require('fs');
const path = require('path');
const D = require('../mt-ruimte-dossier.js');
const T = require('../mt-ruimte-tekening.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'opname-ar-proef.html'), 'utf8');
const mod = { exports: {} };
new Function('module', html.split('/*KERN-BEGIN*/')[1].split('/*KERN-EINDE*/')[0])(mod);
const AR = mod.exports;

let goed = 0, fout = 0;
function check(naam, ok, extra) { if (ok) goed++; else fout++; console.log((ok ? 'ok  - ' : 'FOUT - ') + naam + (extra ? '  ' + extra : '')); }
const NU = Date.UTC(2026, 10, 18, 10, 0, 0);
const K = require('./ruimte-voorbeeldkamer.js')(D, AR, NU), d = K.dossier, lm = D.lijnmodel(d, AR), azs = d.wanden.map(w => D.wandAanzicht(d, w.id, lm));
const teksten = boom => T.knopen(boom).filter(k => k.t === 'text').map(k => (k.a['class'] || '') + ':' + k.x);
const it = (az, det) => az.items.find(x => x.det.id === det.id);

// ── de voorbeeldkamer staat zoals in de proef van 18-11 ──
check('R1 op W2 334 vanaf links, kader 12 mm: buitenmaat 2464 × 1106, binnen 2440 × 1082', (() => { const a = it(azs[1], K.details.r1); return a.rect.x === 334 && a.rect.w === 2464 && a.rect.h === 1106 && a.opening.binnen.w === 2440 && a.opening.binnen.x === 346; })());
check('R2 op dezelfde wand 40 vanaf rechts, onderkant 750', (() => { const a = it(azs[1], K.details.r2); return a.rect.x === 5771 - 40 - 535 && a.rect.y === 750 && !a.vanLinks; })());
check('R3 op W3 780 vanaf rechts, onderkant 930; de deur op W4', (() => { const a = it(azs[2], K.details.r3); return a.rect.x === 2902 - 780 - 1218 && a.rect.y === 930 && !!it(azs[3], K.details.deur); })());

// ── wandaanzicht met een gekozen onderdeel: tikbare maten ──
const t1 = T.aanzicht(azs[1], { gekozen: K.details.r1.id, actief: 'opening_breedte', breedte: 600, fs: 32 }), k1 = T.knopen(t1.boom), tx1 = teksten(t1.boom);
check('aanzicht is een boom van svg-knopen (geen tekst-HTML)', t1.boom.t === 'svg' && /^0 0 600 /.test(t1.boom.a.viewBox) && k1.every(k => typeof k.t === 'string' && typeof k.a === 'object' && Array.isArray(k.k)));
check('keten van R1 langs de wand: 334 – 12 – 2440 – 12 – rest 2973 (afgeleid)', ['t-gemeten:334', 't-gemeten:12', 't-gemeten:2440', 't-afgeleid:2973'].every(x => tx1.indexOf(x) >= 0), tx1.join(' '));
check('keten van R1 omhoog: 945 – 12 – 1082 – 12 – 395 (gemeten tot plafond)', ['t-gemeten:945', 't-gemeten:1082', 't-gemeten:395'].every(x => tx1.indexOf(x) >= 0));
check('maten van het gekozen onderdeel zijn tikbaar (data-veld), die van andere niet', (() => { const v = k1.filter(k => k.a['data-veld']).map(k => k.a['data-veld']); return ['afstand_tot_hoek', 'opening_breedte', 'opening_hoogte', 'kozijn_onderkant', 'boven_tot_plafond'].every(f => v.indexOf(f) >= 0) && v.indexOf('breedte') < 0; })());
check('de actieve maat is gemarkeerd', k1.some(k => k.t === 'rect' && /tikvlak actief/.test(k.a['class']) && k.a['data-veld'] === 'opening_breedte'));
check('onderdelen en vakken zijn aan te tikken (data-id, data-vak)', k1.some(k => k.a['data-id'] === K.details.rad.id) && k1.filter(k => k.t === 'rect' && k.a['data-vak'] != null).length === 3);
check('draairichting: twee gestreepte driehoeken (naar buiten) met de punt naar links en naar rechts', (() => { const p = k1.filter(k => k.t === 'polyline' && /draai weg/.test(k.a['class'])); return p.length === 2 && p[0].a.points !== p[1].a.points; })());
check('stopcontact dubbel: afdekplaat 152 × 81 op schaal en 2× in de naam', (() => { const a = it(azs[1], K.details.sc1), tg = T.aanzicht(azs[1], { ketens: 'alles', breedte: 3000, fs: 22 }), pl = T.knopen(tg.boom).filter(k => k.t === 'rect' && /plaat/.test(k.a['class'])); return a.plaat.w === 152 && pl.length === 1 && Math.abs(Number(pl[0].a.width) - 152 * tg.s) < 0.2 && Math.abs(Number(pl[0].a.height) - 81 * tg.s) < 0.2 && tx1.some(x => /Stopcontact 2×/.test(x)); })());
// een naam met opmaaktekens blijft tekst
const kwaad = D.voegDetailToe(d, { soort: 'stopcontact', label: '<img src=x onerror=1>&"', wand_id: d.wanden[0].id }, NU), tq = T.aanzicht(D.wandAanzicht(d, d.wanden[0].id, lm), { gekozen: kwaad.id });
check('een naam met < > & " blijft gewone tekst in de boom', T.knopen(tq.boom).some(k => k.t === 'text' && k.x.indexOf('<img src=x onerror=1>&"') === 0) && !T.knopen(tq.boom).some(k => k.t === 'img'));
D.verwijderDetail(d, kwaad.id, 'test', NU);
// nieuw onderdeel zonder maten: vraagtekens
const nieuw = D.voegDetailToe(d, { soort: 'kozijn', wand_id: d.wanden[0].id }, NU); nieuw.opening = { type: 'nis', zijden: [] };
const tn = T.aanzicht(D.wandAanzicht(d, d.wanden[0].id, lm), { gekozen: nieuw.id }), txn = teksten(tn.boom);
check('nieuw kozijn zonder maten: vraagtekens om aan te tikken, geen verzonnen restmaat', txn.filter(x => x === 't-open:?').length >= 4 && !txn.some(x => /^t-(geschat|afgeleid):~?\d+$/.test(x) && x !== 't-geschat:~0'), txn.join(' '));
D.verwijderDetail(d, nieuw.id, 'test', NU);

// ── doorsnede ──
const ds1 = T.doorsnede(it(azs[1], K.details.r1), { actief: 'diepte_tot_kozijn' }), ds3 = T.doorsnede(it(azs[2], K.details.r3)), ds2 = T.doorsnede(it(azs[1], K.details.r2));
check('doorsnede R1: 5 voor de muur, 310 tot het kozijn, beide tikbaar', teksten(ds1.boom).indexOf('t-gemeten:5') >= 0 && teksten(ds1.boom).indexOf('t-gemeten:310') >= 0 && T.knopen(ds1.boom).some(k => k.a['data-veld'] === 'aftimmer_uitsteek'));
check('doorsnede R3: 120 tot de aftimmering, 80 tot het kozijn', teksten(ds3.boom).indexOf('t-gemeten:120') >= 0 && teksten(ds3.boom).indexOf('t-gemeten:80') >= 0);
check('doorsnede R2 (kale nis): 115 tot het kozijn, geen paneel', teksten(ds2.boom).indexOf('t-gemeten:115') >= 0 && !T.knopen(ds2.boom).some(k => k.a['class'] === 'paneel'));
check('pictogram per soort opening', ['nis', 'aftimmering-op-wand', 'nis-met-aftimmering'].every(x => T.openingIcoon(x).t === 'svg'));

// ── alle maten op één wand (afdruk) ──
const ta = T.aanzicht(azs[1], { ketens: 'alles', breedte: 1500, fs: 22 }), txa = teksten(ta.boom);
check('wandpagina: keten van de openingen (334 – 12 – 2440 – 12 – 2398 – 535 – 40), keten van de overige onderdelen (950 – 1200) en de totaalmaat 5771; niets tikbaar', ['t-gemeten:334', 't-gemeten:2440', 't-afgeleid:2398', 't-gemeten:535', 't-gemeten:40', 't-gemeten:950', 't-gemeten:1200', 't-gemeten:5771'].every(x => txa.indexOf(x) >= 0) && !T.knopen(ta.boom).some(k => k.a['data-veld']));
check('elke doorlopende keten sluit op de wandlengte', [D.wandKeten(azs[1]), D.wandKeten(azs[1], D.isOpening), D.wandKeten(azs[1], x => !D.isOpening(x))].every(wk => Math.abs(wk.reduce((t, x) => t + x.waarde, 0) - 5771) < 0.01));

// ── kameruitslag en wandafwikkeling ──
const u = T.uitslag(lm, azs, { titel: 'Woonkamer' }), ku = T.knopen(u.boom);
check('uitslag: vier wanden opengeklapt, aan te tikken, kamer liggend op het papier', ku.filter(k => k.t === 'g' && k.a['data-wand']).length === 4 && u.breedte > u.hoogte && T.eenvoudig(lm));
check('uitslag: elke wand is alleen gedraaid, niet gespiegeld (determinant +1)', ku.filter(k => k.t === 'g' && k.a['data-wand']).every(k => { const m = k.a.transform.replace(/[^0-9.\- ]/g, '').trim().split(/\s+/).map(Number); return Math.abs(m[0] * m[3] - m[1] * m[2] - 1) < 0.01; }));
const af = T.afwikkeling(azs);
check('afwikkeling: wanden naast elkaar, elke volgende wand begint in de hoek waar de vorige eindigt', af.volgorde.length === 4 && azs.every((a, i) => { const j = af.volgorde.indexOf(a.wand), nx = azs.find(b => b.wand === af.volgorde[(j + 1) % 4]); return nx.links.id === a.rechts.id; }), af.volgorde.join(' '));
// L-vormige kamer: geen uitslag maar een plattegrond
{
  const e = D.nieuw({}, NU), s = D.startSessie(e, {}, NU); s.xr.vloerY = 0;
  D.zetHoeken(e, s.id, [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 4 }, { x: 0, z: 4 }], NU);
  const lmL = D.lijnmodel(e, AR), azL = e.wanden.map(w => D.wandAanzicht(e, w.id, lmL)), pl = T.uitslag(lmL, azL, { ketens: 'plan' }), afL = T.afwikkeling(azL);
  check('L-vormige kamer: niet eenvoudig, plattegrond met zes wandlengtes, afwikkeling met zes wanden', !T.eenvoudig(lmL) && T.knopen(pl.boom).filter(k => k.t === 'g' && k.a['data-wand']).length === 6 && afL.volgorde.length === 6 && !T.knopen(pl.boom).some(k => /wandlijn/.test(k.a['class'] || '')));
}
// ── tabelrijen ──
const rijen = T.onderdeelRijen(azs), r1 = rijen.find(x => x.id === K.details.r1.id), sc = rijen.find(x => x.id === K.details.sc1.id);
check('onderdeelrijen: R1 met opening, binnenwerks en vakken; stopcontact met uitvoering en hart', r1.binnenwerks === '2440 × 1082' && /Aftimmering op de wand/.test(r1.opening) && /310/.test(r1.diepte) && r1.vakken.split(' | ').length === 3 && sc.variant === 'Dubbel' && /hart 300/.test(sc.hoogte) && /1400 vanaf/.test(sc.plek));
// ── draadmodel: het overzicht na de opname ──
{
  const ov = D.openPerWand(d, D.openVragen(d, AR)), tel = {}; d.wanden.forEach(w => { tel[w.id] = ov.wanden[w.id].length; });
  const w2 = d.wanden[1].id; tel[w2] = 3;
  const dm = T.draadmodel(lm, azs, { open: tel }), kn = T.knopen(dm.boom);
  const knoppen = kn.filter(k => k.t === 'g' && k.a['data-wand']), vlakken = kn.filter(k => k.t === 'path' && /dmwand/.test(k.a['class']));
  check('draadmodel: een aantikbaar rondje per wand en een vlak per wand', knoppen.length === d.wanden.length && vlakken.length === d.wanden.length && new Set(knoppen.map(k => k.a['data-wand'])).size === d.wanden.length);
  const kW2 = knoppen.find(k => k.a['data-wand'] === w2), tW2 = kW2.k.map(c => c.x).filter(Boolean);
  check('draadmodel: wand met open maten is oranje met het aantal, een wand zonder is klaar', tW2.indexOf('W2') >= 0 && tW2.indexOf('3 open') >= 0 && kW2.k.some(c => /dmbol open/.test(c.a['class'] || '')) && knoppen.some(k => k.k.some(c => c.x === 'klaar')), JSON.stringify(tW2));
  check('draadmodel: alleen de achterste wanden zijn als vlak aantikbaar, de voorste niet', vlakken.some(k => k.a['data-wand']) && vlakken.some(k => !k.a['data-wand'] && / voor/.test(k.a['class'])));
  check('draadmodel: onderdelen staan als omtrek op hun wand, alles binnen het beeld', kn.filter(k => /dmitem/.test(k.a['class'] || '')).length >= 5 && kn.filter(k => k.t === 'circle' && k.a.cx).every(k => Number(k.a.cx) >= 0 && Number(k.a.cx) <= dm.breedte && Number(k.a.cy) >= 0 && Number(k.a.cy) <= dm.hoogte));
}
// ── naarDom met een nagebootst document ──
{
  const gemaakt = [], doc = { createElementNS: (ns, t) => { const e = { ns, t, at: {}, kids: [], setAttribute(k, v) { this.at[k] = v; }, appendChild(c) { this.kids.push(c); } }; gemaakt.push(e); return e; } };
  const dom = T.naarDom(doc, t1.boom);
  check('naarDom: alle knopen via createElementNS (svg), tekst via textContent', dom.t === 'svg' && gemaakt.length === k1.length && gemaakt.every(e => e.ns === 'http://www.w3.org/2000/svg') && gemaakt.some(e => e.textContent === '2440'));
}

console.log('\n' + goed + ' tests geslaagd' + (fout ? ', ' + fout + ' MISLUKT' : ''));
process.exit(fout ? 1 : 0);
