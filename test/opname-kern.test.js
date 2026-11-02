// Tests van de opname-rekenkern (mt-opname-kern.js), zonder DOM. Draaien: node test/opname-kern.test.js — verzonnen project en ruimtenaam (kamer Joe), geen persoonsgegevens.
// De maten van kamer Joe komen uit de meetproef (31-10). Na de review van 1-11 (ChatGPT 035 en Bart) tellen we voor Joe met werkzone Oost 17 basis, 25 werkzone en 6 optioneel
// (het prototype had 21 en 16): openingen buiten de werkzone vragen alleen breedte en positie, de radiator heeft er twee vragen bij, elke wand buiten de werkzone heeft één bevestiging
// en een werkzone-wand vraagt de lengte op 3 hoogtes en het plafond op 3 punten.
'use strict';
const assert = require('assert');
const K = require('../mt-opname-kern.js');
let n = 0; const test = (naam, fn) => { try { fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };
const kopie = x => JSON.parse(JSON.stringify(x));
const dichtbij = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1 : tol);

// ── Testdata: kamer Joe, 4 openingen, werkzone Oost, toegangsdeur D1 op de zuidwand ──
const T0 = '2026-11-01T09:00:00.000Z';
function joeRuimte(zone) {
  return K.nieuweRuimte({ id: 'R1', naam: 'Kamer Joe', meubeltype: 'kast', werkzone: zone || ['O'], toegangsdeur: 'D1',
    openingen: [
      { id: 'R1', soort: 'raam', wand: 'N', definitie: 'muursparing', maten: {} },
      { id: 'R2', soort: 'raam', wand: 'N', definitie: 'muursparing', positie_vanaf: 'R1', maten: {} },
      { id: 'R3', soort: 'raam', wand: 'O', definitie: 'muursparing', maten: {} },
      { id: 'D1', soort: 'deur', wand: 'Z', definitie: 'muursparing', maten: {} }],
    objecten: [
      { id: 'RAD1', type: 'radiator', wand: 'N', maten: {} }, { id: 'PLN', type: 'plint', wand: 'N', maten: {} },
      { id: 'SC1', type: 'stopcontact', wand: 'O', hoek: 'ZO', naam: 'Stopcontact SC1 (rechts)', maten: {} }, { id: 'SC2', type: 'stopcontact', wand: 'O', hoek: 'NO', maten: {} },
      { id: 'RAD2', type: 'radiator', wand: 'O', maten: {} }, { id: 'VB3', type: 'vensterbank', wand: 'O', opening: 'R3', maten: {} }, { id: 'PLO', type: 'plint', wand: 'O', maten: {} },
      { id: 'SW1', type: 'schakelaar', wand: 'Z', hoek: 'ZO', maten: {} }, { id: 'PLZ', type: 'plint', wand: 'Z', maten: {} },
      { id: 'SC3', type: 'stopcontact', wand: 'W', hoek: 'NW', maten: {} }, { id: 'SC4', type: 'stopcontact', wand: 'W', hoek: 'NW', maten: {} }, { id: 'PLW', type: 'plint', wand: 'W', maten: {} }],
    bijzonderheden: [{ id: 'B1', soort: 'kabelgoot', wand: 'O', notitie: 'Kabelgoot in de noordoosthoek, de hoek zit erachter', maten: {} }, { id: 'B2', soort: 'nis', wand: 'N', notitie: 'R1 zit in een nis', maten: {} }] });
}
const joe = zone => K.nieuweOpname({ opname_id: 'OPN-TEST-001', project: { code: 'TEST-001' }, aangemaakt: T0, ruimtes: [joeRuimte(zone)] });
const R = op => op.ruimtes[0];
const zet = (op, pad, invoer) => { const r = K.zetMaat(op, 'R1', pad, invoer, T0); assert.strictEqual(r.fout, null, pad + ': ' + r.fout); return r.opname; };
const meet = (op, pad, waarde, bron) => zet(op, pad, { staat: 'gemeten', waarde, bron: bron || 'disto' });
// De echte vorm van Joe uit hoekpunten (onafhankelijk van de kern): NW(0,0) NO(5760,0) ZO(5761,2900) ZW(-1,2903).
const N_J = 5760, O_J = Math.round(Math.hypot(1, 2900)), Z_J = Math.round(Math.hypot(5762, 3)), W_J = Math.round(Math.hypot(1, 2903)), A_J = Math.round(Math.hypot(5761, 2900)), B_J = Math.round(Math.hypot(5761, 2903));
function metWanden(op) { op = meet(op, 'wanden.N.maten.lengte', N_J); op = meet(op, 'wanden.Z.maten.lengte', Z_J); op = meet(op, 'wanden.O.maten.lengte', O_J); return meet(op, 'wanden.W.maten.lengte', W_J); }
// Alles wat gevraagd wordt (ook de tweede diagonaal) gemeten, zodat er niets openstaat.
function allesGemeten(op) {
  op = metWanden(op);
  for (const v of K.vragen(R(op))) {
    if (v.pad.startsWith('wanden.') && v.pad.endsWith('.lengte')) continue;
    if (/^wanden\.[NOZW]\.maten\.lengte_(onder|boven)$/.test(v.pad)) { op = meet(op, v.pad, { N: N_J, O: O_J, Z: Z_J, W: W_J }[v.pad.split('.')[1]], 'hand'); continue; }          // dezelfde wandlengte op elke hoogte: geen onwaarschijnlijk verschil
    if (v.pad.startsWith('diagonalen.')) op = meet(op, v.pad, v.pad.includes('.A.') ? A_J : B_J);
    else if (v.eenheid === 'keuze') op = zet(op, v.pad, { staat: 'gemeten', keuze: v.keuzes[0], bron: 'hand' });
    else op = meet(op, v.pad, v.pad.includes('plafond') ? 2450 : 1000 + (v.pad.length % 7) * 10, 'hand');
  }
  return op;
}
const rondjeKlaar = (op, zone, afwezig) => { let r = R(op); for (const w of zone) for (const [c] of K.RONDJE_CATEGORIEEN) r = K.zetRondje(r, w, c, afwezig && (c === 'water' || c === 'afw') ? 'afwezig' : 'aanwezig', T0).ruimte; const o = kopie(op); o.ruimtes[0] = r; return o; };
const metFoto = op => K.voegFotoToe(op, { bestand: 'joe-oost.jpg', ruimte: 'R1', wand: 'O' }).opname;     // een foto van de werkzone-wand is verplicht voor het vrijgeven
const klaar = () => metFoto(rondjeKlaar(allesGemeten(joe()), ['O'], true));
const redenCodes = c => c.redenen.map(x => x.code);
// Een los te vullen ruimte voor de vormtests.
function vormRuimte(nn, oo, zz, ww, a, b) {
  const r = K.nieuweRuimte({ naam: 'Vorm' }), s = (kind, id, w) => { if (w != null) r[kind].find(e => e.id === id).maten.lengte = { staat: 'gemeten', waarde: w, bron: 'disto', tijd: null }; };
  s('wanden', 'N', nn); s('wanden', 'O', oo); s('wanden', 'Z', zz); s('wanden', 'W', ww); s('diagonalen', 'A', a); s('diagonalen', 'B', b); return r;
}

// ── Vragenlijst en tellers ──
test('kamer Joe, werkzone Oost: 17 basis, 25 werkzone en 6 optioneel (na de review van 1-11)', () => {
  const t = K.tellers(R(joe()));
  assert.strictEqual(t.basis.n, 17, 'basis: 4 wanden + plafond + diagonaal A + breedte en positie van 4 openingen (8) + bevestiging van de 3 wanden buiten de werkzone');
  assert.strictEqual(t.werkzone.n, 25, 'werkzone Oost: lengte onder en boven (2) + plafond links, midden, rechts (3) + R3 hoogte, borstwering en tot rechterhoek (3) + SC1 3 + SC2 3 + RAD2 5 + VB3 3 + PLO 3');
  assert.strictEqual(t.extra.n, 0); assert.strictEqual(t.optie.n, 6, 'diagonaal B + hoogte en borstwering van R1 en R2 + hoogte van D1: optioneel (grijs voorstel)');
  assert.strictEqual(t.basis.open, 17); assert.strictEqual(t.werkzone.open, 25);
});
test('de vragen zijn uniek, hebben tekst, een emmer en een bruikbare referentie', () => {
  const v = K.vragen(R(joe())), paden = v.map(x => x.pad);
  assert.strictEqual(new Set(paden).size, paden.length, 'paden zijn uniek');
  for (const x of v) { assert.ok(x.vraag && x.kort && x.pad, x.pad); assert.ok(['basis', 'optie', 'werkzone', 'extra'].includes(x.bucket), x.pad); assert.ok(['hoek', 'vloerpeil', 'zijkanten', 'boven-onder', 'opening', 'object', 'wand'].includes(x.referentie), x.pad + ' ' + x.referentie); }
  assert.deepStrictEqual(paden.filter(p => p.endsWith('.lengte') && p.startsWith('wanden.')), ['wanden.N.maten.lengte', 'wanden.O.maten.lengte', 'wanden.Z.maten.lengte', 'wanden.W.maten.lengte']);
  assert.ok(paden.includes('plafondpunten.P1.maten.hoogte') && paden.includes('diagonalen.A.maten.lengte'));
  const get = p => v.find(x => x.pad === p);
  assert.strictEqual(get('openingen.R1.maten.borstwering').referentie, 'vloerpeil'); assert.strictEqual(get('openingen.R2.maten.positie').referentie, 'opening', 'R2 wordt vanaf R1 gemeten (penant)');
  assert.strictEqual(get('openingen.R1.maten.breedte').definitie, 'muursparing'); assert.ok(/muursparing/.test(get('openingen.R1.maten.breedte').vraag));
  assert.ok(/noordwesthoek/.test(get('openingen.R1.maten.positie').vraag), 'linkerhoek van de noordwand is de noordwesthoek');
  assert.ok(/zuidoosthoek/.test(get('objecten.SC1.maten.afstand').vraag), 'object met een gekozen hoek');
  assert.ok(!paden.includes('openingen.D1.maten.borstwering'), 'een deur heeft geen borstwering');
  assert.strictEqual(get('wanden.Z.maten.bevestiging').soort, 'wandbevestiging'); assert.deepStrictEqual(get('wanden.Z.maten.bevestiging').nvt_keuzes, ['afgedekt', 'niet-beoordeeld']);
  assert.ok(!paden.includes('wanden.O.maten.bevestiging'), 'de werkzone-wand krijgt geen bevestiging maar volledige details');
});
test('openingen buiten de werkzone: alleen breedte en positie verplicht, hoogte en borstwering optioneel; in de werkzone alles', () => {
  const v = K.vragen(R(joe())), b = p => v.find(x => x.pad === p).bucket;
  assert.deepStrictEqual(['breedte', 'positie'].map(k => b('openingen.R1.maten.' + k)), ['basis', 'basis']); assert.deepStrictEqual(['hoogte', 'borstwering'].map(k => b('openingen.R1.maten.' + k)), ['optie', 'optie']);
  assert.strictEqual(b('openingen.D1.maten.hoogte'), 'optie'); assert.strictEqual(v.find(x => x.pad === 'openingen.D1.maten.hoogte').optioneel, true);
  assert.deepStrictEqual(['breedte', 'positie'].map(k => b('openingen.R3.maten.' + k)), ['basis', 'basis']); assert.deepStrictEqual(['hoogte', 'borstwering', 'positie_rechts'].map(k => b('openingen.R3.maten.' + k)), ['werkzone', 'werkzone', 'werkzone']);
});
test('werkzone Oost: precies deze punten, de radiator met buitencontour, uitsteek en bereikbaarheid', () => {
  const z = K.vragen(R(joe())).filter(x => x.bucket === 'werkzone').map(x => x.pad);
  assert.deepStrictEqual(z.slice().sort(), [
    'objecten.PLO.maten.dikte', 'objecten.PLO.maten.hoogte', 'objecten.PLO.maten.keuze',
    'objecten.RAD2.maten.bereikbaarheid', 'objecten.RAD2.maten.breedte', 'objecten.RAD2.maten.hoogte', 'objecten.RAD2.maten.onderkant', 'objecten.RAD2.maten.uitsteek',
    'objecten.SC1.maten.afdek', 'objecten.SC1.maten.afstand', 'objecten.SC1.maten.hoogte',
    'objecten.SC2.maten.afdek', 'objecten.SC2.maten.afstand', 'objecten.SC2.maten.hoogte',
    'objecten.VB3.maten.diepte', 'objecten.VB3.maten.dikte', 'objecten.VB3.maten.overstek',
    'openingen.R3.maten.borstwering', 'openingen.R3.maten.hoogte', 'openingen.R3.maten.positie_rechts',
    'wanden.O.maten.lengte_boven', 'wanden.O.maten.lengte_onder', 'wanden.O.maten.plafond_links', 'wanden.O.maten.plafond_midden', 'wanden.O.maten.plafond_rechts'].sort());
  const rb = K.vragen(R(joe())).find(x => x.pad === 'objecten.RAD2.maten.bereikbaarheid'); assert.deepStrictEqual(rb.keuzes, ['vrij', 'beperkt', 'geblokkeerd']); assert.strictEqual(rb.eenheid, 'keuze');
  assert.ok(/kraan en leiding/.test(K.vragen(R(joe())).find(x => x.pad === 'objecten.RAD2.maten.breedte').uitleg), 'buitencontour inclusief kraan en leiding');
});
test('een ruimte zonder openingen: 6 basisvragen als alle wanden werkzone zijn, anders komt per wand buiten de werkzone een bevestiging', () => {
  assert.strictEqual(K.tellers(K.nieuweRuimte({ naam: 'Leeg', werkzone: ['N', 'O', 'Z', 'W'] })).basis.n, 6);
  assert.strictEqual(K.tellers(K.nieuweRuimte({ naam: 'Leeg' })).basis.n, 10);
  assert.strictEqual(K.tellers(joeRuimte([])).werkzone.n, 0);
});
test('andere werkzone of meer wanden geeft andere vragen; objecten buiten de werkzone worden niet gevraagd', () => {
  const t = z => K.tellers(joeRuimte(z));
  assert.deepStrictEqual([t(['N']).basis.n, t(['N']).werkzone.n], [17, 19], 'noord: 5 wandpunten + R1 en R2 (3 elk) + RAD1 5 + PLN 3');
  assert.deepStrictEqual([t(['O', 'N']).basis.n, t(['O', 'N']).werkzone.n], [16, 44]);
  assert.strictEqual(t(['Z']).werkzone.n, 5 + 2 + 3 + 3, '5 wandpunten + D1 hoogte en tot rechterhoek + SW1 3 + PLZ 3');
  assert.ok(!K.vragen(joeRuimte(['O'])).some(x => x.pad.startsWith('objecten.SC3')), 'SC3 staat op de westwand, buiten de werkzone');
  assert.deepStrictEqual(t(['O']).gezien, { n: 7, bevestigd: 0 }, 'de 7 objecten buiten de werkzone zijn alleen gezien');
});
test('toch meten en zelf toegevoegde objecten komen bij Extra; bijzonderheid met een maat ook', () => {
  const r = joeRuimte(['O']); r.objecten.find(o => o.id === 'SC3').gezien = 'toch-meten';
  r.objecten.push({ id: 'X1', type: 'leiding', wand: 'W', eigen: true, maten: {} }, { id: 'X2', type: 'stopcontact', wand: 'O', eigen: true, maten: {} });
  r.plafondpunten.push({ id: 'P2', plaats: 'hoek NO', maten: {} }); r.bijzonderheden[0].maten.maat = K.nieuweMaat();
  const t = K.tellers(r);
  assert.strictEqual(t.extra.n, 3 + 3 + 1 + 1, 'SC3 3 + leiding X1 3 + plafondpunt P2 + maat bij de kabelgoot');
  assert.strictEqual(t.werkzone.n, 25 + 3, 'een zelf toegevoegd object op de werkzone-wand telt als werkzone (zoals in het prototype)');
  assert.deepStrictEqual(t.gezien, { n: 7, bevestigd: 1 }, 'toch meten is een bevestiging; het zelf toegevoegde X1 telt niet als gezien');
  r.objecten.find(o => o.id === 'SC4').gezien = 'klopt'; assert.strictEqual(K.tellers(r).gezien.bevestigd, 2);
});
test('een vensterbank zonder gekoppelde opening vraagt ook de hoogte', () => {
  const r = K.nieuweRuimte({ werkzone: ['W'], objecten: [{ id: 'V1', type: 'vensterbank', wand: 'W', maten: {} }] });
  assert.deepStrictEqual(K.vragen(r).filter(x => x.bucket === 'werkzone' && x.pad.indexOf('objecten.') === 0).map(x => x.pad.split('.').pop()), ['diepte', 'dikte', 'overstek', 'hoogte']);
});
test('tellers: later telt als beantwoord (x van n) maar niet als compleet; n.v.t. telt als compleet', () => {
  let op = joe();
  op = meet(op, 'wanden.N.maten.lengte', 5760); op = zet(op, 'wanden.O.maten.lengte', { staat: 'nvt', notitie: 'niet nodig' }); op = zet(op, 'wanden.Z.maten.lengte', { staat: 'later', notitie: 'ladder nodig' });
  const b = K.tellers(R(op)).basis;
  assert.deepStrictEqual([b.gemeten, b.nvt, b.later, b.open, b.n], [1, 1, 1, 14, 17]);
  assert.strictEqual(b.beantwoord, 3); assert.strictEqual(b.compleet, 2);
});
test('een foto-voorstel is nooit een meting: gemeten met bron foto-voorstel telt als open en geeft een waarschuwing', () => {
  const op = joe(); R(op).wanden.find(w => w.id === 'N').maten.lengte = { staat: 'gemeten', waarde: 5700, bron: 'foto-voorstel', tijd: T0 };
  assert.strictEqual(K.tellers(R(op)).basis.gemeten, 0); assert.strictEqual(K.tellers(R(op)).basis.open, 17);
  assert.strictEqual(K.waarde(R(op).wanden[0].maten.lengte), null);
  assert.ok(K.waarschuwingen(R(op)).some(w => w.code === 'meting-ongeldig'));
  assert.ok(K.zetMaat(op, 'R1', 'wanden.N.maten.lengte', { staat: 'gemeten', waarde: 5700, bron: 'foto-voorstel' }, T0).fout, 'ook zetMaat weigert het');
});
test('het grijze voorstel heeft schatting_mm en een aparte onzekerheid_mm, staat naast de meting en telt niet mee', () => {
  let op = joe(); op = K.zetVoorstel(op, 'R1', 'openingen.R3.maten.breedte', { schatting_mm: 1215, onzekerheid_mm: 25 }, T0).opname;
  let v = K.vragen(R(op)).find(x => x.pad === 'openingen.R3.maten.breedte');
  assert.strictEqual(v.staat, 'open'); assert.deepStrictEqual(v.voorstel, { schatting_mm: 1215, bron: 'foto-voorstel', tijd: T0, onzekerheid_mm: 25 });
  const zonder = K.zetVoorstel(joe(), 'R1', 'openingen.R3.maten.hoogte', { schatting_mm: 1220 }, T0).opname;
  assert.deepStrictEqual(Object.keys(K.vragen(R(zonder)).find(x => x.pad === 'openingen.R3.maten.hoogte').voorstel).sort(), ['bron', 'schatting_mm', 'tijd'], 'zonder onderbouwing geen onzekerheid');
  op = meet(op, 'openingen.R3.maten.breedte', 1221);
  v = K.vragen(R(op)).find(x => x.pad === 'openingen.R3.maten.breedte');
  assert.strictEqual(v.staat, 'gemeten'); assert.strictEqual(v.maat.waarde, 1221); assert.strictEqual(v.voorstel.schatting_mm, 1215, 'het voorstel blijft bewaard');
  assert.ok(K.zetVoorstel(op, 'R1', 'openingen.R3.maten.breedte', { schatting_mm: -3 }, T0).fout); assert.ok(K.zetVoorstel(op, 'R1', 'openingen.R3.maten.breedte', { waarde: 1200 }, T0).fout, 'het oude veld waarde bestaat niet meer');
  assert.ok(K.zetVoorstel(op, 'R1', 'openingen.R3.maten.breedte', { schatting_mm: 1200, onzekerheid_mm: -1 }, T0).fout);
});
test('meubeltype: alleen kast is een echte vragenset; keuken en badmeubel zijn een hook en blokkeren het vrijgeven', () => {
  assert.deepStrictEqual(K.MEUBELTYPES, ['kast', 'keuken', 'badmeubel']); assert.strictEqual(K.MEUBELSETS.kast.gereed, true); assert.strictEqual(K.MEUBELSETS.keuken.gereed, false);
  for (const mt of ['keuken', 'badmeubel']) {
    const op = klaar(); R(op).meubeltype = mt;
    const c = K.vrijgeefCheck(op); assert.strictEqual(c.kan, false); assert.deepStrictEqual(redenCodes(c), ['meubelset']); assert.strictEqual(c.scope[0].meubelset_gereed, false);
    assert.strictEqual(K.vragen(R(op)).length, K.vragen(R(klaar())).length, 'geen andere vragen: er wordt geen keuken- of badmeubelset geclaimd');
  }
  assert.strictEqual(K.vrijgeefCheck(klaar()).kan, true);
  const oud = K.MEUBELSETS.keuken.extraSlots;
  try {
    K.MEUBELSETS.keuken.extraSlots = (ruimte, slot) => slot('extra.werkblad', { maten: {} }, 'peil', 'basis', { kort: 'Werkbladpeil', vraag: 'Welk werkbladpeil?', wand: 'N', soort: 'maat' });
    const r = joeRuimte(['O']); r.meubeltype = 'keuken';
    assert.ok(K.vragen(r).some(v => v.pad === 'extra.werkblad'), 'de hook voegt vragen toe'); assert.ok(!K.vragen(joeRuimte(['O'])).some(v => v.pad === 'extra.werkblad'), 'alleen voor dat meubeltype');
  } finally { K.MEUBELSETS.keuken.extraSlots = oud; }
});

// ── Vorm en sluitcontrole (geen rechthoek veronderstellen) ──
test('vorm: een rechthoek met één diagonaal is bepaald maar nog niet gecontroleerd; met de tweede is hij consistent', () => {
  let v = K.vorm(vormRuimte(5000, 3000, 5000, 3000, 5831, null));
  assert.strictEqual(v.status, 'onverifieerd'); assert.strictEqual(v.bepaling, 'bepaald'); assert.strictEqual(v.schematisch, false); assert.strictEqual(v.afwijkend, false); assert.strictEqual(v.diagonaal_gebruikt, 'A');
  assert.deepStrictEqual(v.hoekpunten_mm, { NW: [0, 0], NO: [5000, 0], ZO: [5000, 3000], ZW: [0, 3000] }); assert.deepStrictEqual(v.hoeken, { NW: 90, NO: 90, ZO: 90, ZW: 90 });
  v = K.vorm(vormRuimte(5000, 3000, 5000, 3000, 5831, 5831));
  assert.strictEqual(v.status, 'consistent'); assert.strictEqual(v.bepaling, 'gecontroleerd'); assert.strictEqual(v.schematisch, false); assert.strictEqual(v.afwijkend, false); assert.deepStrictEqual(v.controle, { diagonaal: 'B', gemeten_mm: 5831, berekend_mm: 5831, verschil_mm: 0, tolerantie_mm: 10 });
  assert.strictEqual(K.sluitcontrole(vormRuimte(5000, 3000, 5000, 3000, 5831, 5831)).checks[0].status, 'ok');
});
test('vorm: alleen diagonaal B werkt ook, met dezelfde vaste assen', () => {
  const v = K.vorm(vormRuimte(5000, 3000, 5000, 3000, null, 5831));
  assert.strictEqual(v.diagonaal_gebruikt, 'B'); assert.strictEqual(v.status, 'onverifieerd'); assert.deepStrictEqual(v.hoekpunten_mm, { NW: [0, 0], NO: [5000, 0], ZO: [5000, 3000], ZW: [0, 3000] });
  const s = K.vorm(vormRuimte(5000, 3041, 4000, 3041, null, 5408)); assert.strictEqual(s.afwijkend, true, 'ook via B zie je het trapezium');
});
test('vorm: gelijke diagonalen bewijzen geen rechthoek (gelijkbenig trapezium): afwijkende vorm, geen conflict', () => {
  // NW(0,0) NO(5000,0) ZO(4500,3000) ZW(500,3000): noord 5000, zuid 4000, oost en west 3041, beide diagonalen 5408
  const r = vormRuimte(5000, 3041, 4000, 3041, 5408, 5408), v = K.vorm(r), sc = K.sluitcontrole(r);
  assert.strictEqual(v.status, 'consistent'); assert.strictEqual(v.afwijkend, true); assert.strictEqual(v.tegenover[0].verschil_mm, 1000);
  assert.ok(dichtbij(v.hoekpunten_mm.ZO[0], 4500) && dichtbij(v.hoekpunten_mm.ZO[1], 3000) && dichtbij(v.hoekpunten_mm.ZW[0], 500) && dichtbij(v.hoekpunten_mm.ZW[1], 3000), JSON.stringify(v.hoekpunten_mm));
  assert.ok(v.hoeken.NW > 90.3 || v.hoeken.NW < 89.7); assert.ok(/niet rechthoekig/.test(v.reden)); assert.ok(!/haaks/.test(v.reden), 'geen "de kamer is haaks"');
  assert.strictEqual(sc.checks[0].status, 'afwijkend'); assert.deepStrictEqual(sc.conflicten, [], 'een afwijkende vorm is informatie, geen fout');
  assert.ok(!K.vrijgeefCheckRuimte(r).redenen.some(x => x.code === 'conflict'));
});
test('vorm: tegenoverliggende wanden die verschillen zijn geen conflict (ook niet zonder diagonaal)', () => {
  const v = K.vorm(vormRuimte(5000, 3000, 5030, 3000, null, null));
  assert.strictEqual(v.status, 'onvoldoende-bepaald'); assert.strictEqual(v.afwijkend, true, 'het verschil van 30 mm bewijst al dat het geen rechthoek is'); assert.strictEqual(v.schematisch, true);
  assert.deepStrictEqual(K.sluitcontrole(vormRuimte(5000, 3000, 5030, 3000, null, null)).conflicten, []);
  assert.strictEqual(K.vorm(vormRuimte(5000, 3000, 5004, 3000, null, null)).afwijkend, null, '4 mm verschil blijft binnen de tolerantie en zegt niets zonder diagonaal');
});
test('vorm: de grenzen van "afwijkend": 5 mm verschil tussen tegenoverliggende wanden en 0,3 graad in een hoek', () => {
  assert.strictEqual(K.vorm(vormRuimte(5000, 3000, 5005, 3000, null, null)).afwijkend, null, '5 mm is nog binnen de tolerantie'); assert.strictEqual(K.vorm(vormRuimte(5000, 3000, 5006, 3000, null, null)).afwijkend, true, '6 mm niet');
  // parallellogram met hoeken van 89 en 91 graden: tegenoverliggende wanden zijn gelijk, de vorm is toch niet rechthoekig
  const A = Math.round(Math.hypot(5052.4, 2999.5)), B = Math.round(Math.hypot(4947.6, 2999.5)), v = K.vorm(vormRuimte(5000, 3000, 5000, 3000, A, B));
  assert.strictEqual(v.status, 'consistent'); assert.deepStrictEqual(v.tegenover, []); assert.strictEqual(v.afwijkend, true); assert.ok(v.max_hoekafwijking_graden > 0.9 && v.max_hoekafwijking_graden < 1.1, String(v.max_hoekafwijking_graden));
  assert.strictEqual(K.vorm(vormRuimte(5000, 3000, 5000, 3000, 5831, 5831)).afwijkend, false, 'een echte rechthoek is niet afwijkend');
});
test('vorm: zonder alle zijden of zonder diagonaal is de vorm onvoldoende bepaald', () => {
  let v = K.vorm(vormRuimte(5000, 3000, null, 3000, 5831, null)); assert.strictEqual(v.status, 'onvoldoende-bepaald'); assert.ok(/wandlengte zuid/.test(v.reden));
  v = K.vorm(vormRuimte(5000, 3000, 5000, 3000, null, null)); assert.strictEqual(v.status, 'onvoldoende-bepaald'); assert.ok(/diagonaal/.test(v.reden)); assert.strictEqual(v.hoekpunten_mm, null);
  assert.strictEqual(K.sluitcontrole(R(joe())).checks[0].status, 'wacht'); assert.deepStrictEqual(K.sluitcontrole(R(joe())).conflicten, []);
});
test('vorm: de tweede diagonaal is de controle, 10 mm tolerantie; daarboven zijn de meetgegevens inconsistent', () => {
  let r = vormRuimte(5000, 3000, 5000, 3000, 5831, 5841); assert.strictEqual(K.vorm(r).status, 'consistent', '10 mm is nog goed');
  r = vormRuimte(5000, 3000, 5000, 3000, 5831, 5842);
  const sc = K.sluitcontrole(r), v = sc.vorm;
  assert.strictEqual(v.status, 'inconsistent'); assert.strictEqual(v.controle.verschil_mm, 11); assert.strictEqual(sc.checks[0].status, 'conflict'); assert.strictEqual(sc.conflicten.length, 1);
  assert.ok(/sluiten niet op elkaar/.test(v.reden) && /De app past niets aan/.test(v.reden));
  assert.deepStrictEqual(K.conflictPaden(r).sort(), ['diagonalen.A.maten.lengte', 'diagonalen.B.maten.lengte', 'wanden.N.maten.lengte', 'wanden.O.maten.lengte', 'wanden.W.maten.lengte', 'wanden.Z.maten.lengte']);
  assert.strictEqual(K.vorm(vormRuimte(5000, 3000, 5000, 3000, 5831, 5831 - 34)).status, 'inconsistent', 'de demo van het prototype: 34 mm eraf');
});
test('vorm: een vierhoek die niet kan bestaan is inconsistent', () => {
  const v = K.vorm(vormRuimte(5760, 2900, 5760, 2900, 9000, null)); assert.strictEqual(v.status, 'inconsistent'); assert.ok(/kan de ruimte niet bestaan/.test(v.reden));
  assert.strictEqual(K.sluitcontrole(vormRuimte(5760, 2900, 5760, 2900, 9000, null)).conflicten.length, 1);
});
test('vorm: kamer Joe met de gemeten maten is consistent; foto-voorstellen en n.v.t. tellen niet en de invoer blijft ongewijzigd', () => {
  let op = metWanden(joe()); op = meet(op, 'diagonalen.A.maten.lengte', A_J); op = meet(op, 'diagonalen.B.maten.lengte', B_J);
  const v = K.vorm(R(op)); assert.strictEqual(v.status, 'consistent'); assert.ok(Math.abs(v.controle.verschil_mm) <= 1, 'verschil ' + v.controle.verschil_mm);
  assert.ok(dichtbij(v.hoekpunten_mm.ZO[0], 5761) && dichtbij(v.hoekpunten_mm.ZO[1], 2900) && dichtbij(v.hoekpunten_mm.ZW[0], -1) && dichtbij(v.hoekpunten_mm.ZW[1], 2903), JSON.stringify(v.hoekpunten_mm));
  let o2 = joe(); o2 = meet(o2, 'wanden.N.maten.lengte', 5760); o2 = zet(o2, 'wanden.Z.maten.lengte', { staat: 'nvt' }); o2 = K.zetVoorstel(o2, 'R1', 'wanden.Z.maten.lengte', { schatting_mm: 5000 }, T0).opname;
  const voor = kopie(o2); assert.strictEqual(K.vorm(R(o2)).status, 'onvoldoende-bepaald'); K.sluitcontrole(R(o2)); K.vrijgeefCheck(o2); K.vragen(R(o2)); K.tellers(R(o2)); K.takenlijst(o2); K.route(R(o2));
  assert.deepStrictEqual(o2, voor, 'alleen lezen: geen enkele functie past zijn invoer aan');
});
test('een ingevulde optionele tweede diagonaal telt mee: een conflict erop blokkeert het vrijgeven, een lege B niet', () => {
  const basis = klaar(); assert.strictEqual(K.vrijgeefCheck(basis).kan, true);
  const zonderB = kopie(basis); delete R(zonderB).diagonalen.find(d => d.id === 'B').maten.lengte; assert.strictEqual(K.vrijgeefCheck(zonderB).kan, true, 'optioneel en onbemeten mag');
  assert.ok(K.vrijgeefCheck(zonderB).uitzonderingen.some(x => x.soort === 'vorm'), 'maar de vorm is dan niet gecontroleerd en dat staat in de uitzonderingen');
  const fout = meet(basis, 'diagonalen.B.maten.lengte', B_J + 30), c = K.vrijgeefCheck(fout);
  assert.strictEqual(c.kan, false); assert.deepStrictEqual(redenCodes(c), ['conflict']); assert.ok(/meetgegevens inconsistent/.test(c.redenen[0].tekst));
  const later = zet(basis, 'diagonalen.B.maten.lengte', { staat: 'later' }); assert.deepStrictEqual(redenCodes(K.vrijgeefCheck(later)), ['later'], 'een bewust uitgestelde optionele maat is een open taak');
  assert.strictEqual(K.vrijgeefCheck(zet(basis, 'diagonalen.B.maten.lengte', { staat: 'nvt' })).kan, true);
});
test('een conflict wist de meting niet en kleurt de betrokken maten', () => {
  let op = metWanden(joe()); op = meet(op, 'diagonalen.A.maten.lengte', A_J); op = meet(op, 'diagonalen.B.maten.lengte', B_J + 40);
  const v = K.vragen(R(op)).find(x => x.pad === 'wanden.Z.maten.lengte'); assert.strictEqual(v.conflict, true); assert.strictEqual(v.staat, 'gemeten');
  assert.ok(K.tellers(R(op)).basis.conflict >= 5);
});

test('werkzone-wand: de lengte op 3 hoogtes (onder, midden, boven) en het plafond op 3 punten (links, midden, rechts); de basis houdt één plafondpunt', () => {
  const v = K.vragen(R(joe())), get = p => v.find(x => x.pad === p);
  const wz = v.filter(x => x.pad.indexOf('wanden.O.') === 0).map(x => [x.pad.split('.').pop(), x.bucket]);
  assert.deepStrictEqual(wz, [['lengte', 'basis'], ['lengte_onder', 'werkzone'], ['lengte_boven', 'werkzone'], ['plafond_links', 'werkzone'], ['plafond_midden', 'werkzone'], ['plafond_rechts', 'werkzone']]);
  assert.ok(/net boven de plint/.test(get('wanden.O.maten.lengte_onder').vraag) && /net onder het plafond/.test(get('wanden.O.maten.lengte_boven').vraag) && /middelste van drie hoogtes/.test(get('wanden.O.maten.lengte').uitleg));
  assert.strictEqual(get('wanden.O.maten.plafond_links').referentie, 'vloerpeil'); assert.strictEqual(get('wanden.O.maten.lengte_onder').referentie, 'hoek');
  assert.strictEqual(v.filter(x => x.pad.indexOf('plafondpunten.') === 0).length, 1, 'de basis houdt één plafondpunt');
  assert.ok(!v.some(x => x.pad.indexOf('wanden.N.maten.lengte_') === 0 || x.pad.indexOf('wanden.N.maten.plafond_') === 0), 'wanden buiten de werkzone niet');
  assert.strictEqual(v.filter(x => x.bucket === 'basis').length, 17, 'de basis blijft gelijk');
  let op = meet(joe(), 'wanden.O.maten.plafond_links', 2447); assert.strictEqual(K.vragen(R(op)).find(x => x.pad === 'wanden.O.maten.plafond_links').staat, 'gemeten');
  assert.ok(K.waarschuwingen(R(meet(joe(), 'wanden.O.maten.plafond_rechts', 245))).some(w => w.code === 'onwaarschijnlijk'));
  const ids = K.route(R(joe())).stappen.map(s => s.id).slice(4, 11);
  assert.deepStrictEqual(ids, ['maat:wanden.O.maten.lengte', 'maat:wanden.O.maten.lengte_onder', 'maat:wanden.O.maten.lengte_boven', 'maat:wanden.O.maten.plafond_links', 'maat:wanden.O.maten.plafond_midden', 'maat:wanden.O.maten.plafond_rechts', 'maat:openingen.R3.maten.breedte']);
  const vorm = K.vorm(R(meet(metWanden(joe()), 'wanden.O.maten.lengte_onder', 2890))); assert.strictEqual(vorm.status, 'onvoldoende-bepaald', 'de extra hoogtes beïnvloeden de vorm niet: die gebruikt de lengte op 1000 mm');
});
test('een opening IN de werkzone zonder definitie blokkeert het vrijgeven; erbuiten is het een waarschuwing', () => {
  const binnen = klaar(); delete R(binnen).openingen.find(o => o.id === 'R3').definitie;
  const c = K.vrijgeefCheck(binnen); assert.strictEqual(c.kan, false); assert.deepStrictEqual(redenCodes(c), ['definitie']); assert.ok(/R3|raam R3/.test(c.redenen[0].tekst) && c.redenen[0].pad === 'openingen.R3');
  assert.ok(!c.waarschuwingen.some(w => w.code === 'definitie-ontbreekt'), 'binnen de werkzone is het geen waarschuwing meer maar een reden');
  const buiten = klaar(); delete R(buiten).openingen.find(o => o.id === 'R1').definitie;
  const b = K.vrijgeefCheck(buiten); assert.strictEqual(b.kan, true); assert.ok(b.waarschuwingen.some(w => w.code === 'definitie-ontbreekt' && w.pad.indexOf('openingen.R1.') === 0));
  assert.strictEqual(K.vrijgeefCheck(klaar()).kan, true, 'met definities kan het');
  const z = klaar(); z.ruimtes[0].werkzone = ['O', 'N']; assert.ok(!redenCodes(K.vrijgeefCheck(z)).includes('definitie'), 'R1 en R2 hebben een definitie, dus geen reden');
});
test('K.RONDJE_LATER_BLOKKEERT blijft bestaan en staat aan; uitzetten laat een rondje op later door', () => {
  assert.strictEqual(K.RONDJE_LATER_BLOKKEERT, true);
  const rl = klaar(); rl.ruimtes[0] = K.zetRondje(rl.ruimtes[0], 'O', 'plint', 'later', T0).ruimte;
  assert.deepStrictEqual(redenCodes(K.vrijgeefCheck(rl)), ['rondje-later']);
  try { K.RONDJE_LATER_BLOKKEERT = false; assert.strictEqual(K.vrijgeefCheck(rl).kan, true); } finally { K.RONDJE_LATER_BLOKKEERT = true; }
  assert.strictEqual(K.vrijgeefCheck(rl).kan, false);
});

// ── Rondje controle ──
test('rondje: alleen de werkzone-wanden, 6 categorieën per wand, niet gekozen = nog niet bekeken', () => {
  const rd = K.rondje(R(joe(['O', 'N'])));
  assert.strictEqual(rd.tot, 12); assert.strictEqual(rd.mis, 12); assert.strictEqual(rd.bekeken, 0); assert.ok(rd.regels.every(x => x.status === 'nog-niet-bekeken' && x.waarde === null));
  assert.deepStrictEqual(K.rondje(R(joe([]))).tot, 0);
  assert.deepStrictEqual(K.RONDJE_CATEGORIEEN.map(c => c[0]), ['kozijn', 'elektra', 'water', 'radiator', 'plint', 'afw']);
  assert.strictEqual(K.rondje(Object.assign(R(joe()), { meubeltype: 'keuken' })).regels.find(x => x.categorie === 'water').nadruk, true, 'bij keuken en badmeubel valt water op');
});
test('rondje: keuze vastleggen, weghalen laat een spoor, onbekende keuzes worden geweigerd', () => {
  let r = K.zetRondje(R(joe()), 'O', 'elektra', 'aanwezig', T0).ruimte;
  assert.deepStrictEqual(r.rondje['O|elektra'], { waarde: 'aanwezig', tijd: T0 }); assert.strictEqual(K.rondje(r).bekeken, 1);
  r = K.zetRondje(r, 'O', 'elektra', null, T0).ruimte; assert.strictEqual(r.rondje['O|elektra'], undefined); assert.strictEqual(r.rondje_historie.length, 1, 'de eerdere keuze blijft in de historie');
  assert.ok(K.zetRondje(r, 'X', 'elektra', 'aanwezig').fout); assert.ok(K.zetRondje(r, 'O', 'elektra', 'misschien').fout); assert.ok(K.zetRondje(r, 'O', 'gas', 'aanwezig').fout);
});
test('rondje: "niet aanwezig" terwijl er wel iets vastgelegd is, geeft een waarschuwing', () => {
  const r = K.zetRondje(R(joe()), 'O', 'elektra', 'afwezig', T0).ruimte;
  assert.ok(K.waarschuwingen(r).some(w => w.code === 'rondje-tegenspraak' && w.pad === 'O|elektra'));
  const r2 = K.zetRondje(R(joe()), 'O', 'water', 'afwezig', T0).ruimte; assert.ok(!K.waarschuwingen(r2).some(w => w.code === 'rondje-tegenspraak'), 'in Joe zit geen leiding op de oostwand');
});

// ── Vrijgeef-check ──
test('vrijgeven: een lege opname kan niet, met alle redenen; opslaan kan altijd', () => {
  const op = joe(), c = K.vrijgeefCheck(op);
  assert.strictEqual(c.kan, false); assert.deepStrictEqual(redenCodes(c).filter((x, i, a) => a.indexOf(x) === i), ['open', 'rondje', 'foto']);
  assert.ok(c.redenen.some(x => x.bucket === 'basis' && x.aantal === 17)); assert.ok(c.redenen.some(x => x.code === 'rondje' && x.aantal === 6));
  const s = K.samenvatting(op); assert.strictEqual(s.kan_opslaan, true); assert.strictEqual(s.open, 42); assert.strictEqual(s.taken, 0);
  assert.ok(redenCodes(K.vrijgeefCheck(joe([]))).includes('werkzone'));
  assert.ok(redenCodes(K.vrijgeefCheck({ ruimtes: [] })).includes('geen-ruimte'));
});
test('vrijgeven: alles gemeten, werkzone gekozen, rondje gedaan, geen conflicten: kan', () => {
  const op = klaar(), c = K.vrijgeefCheck(op);
  assert.deepStrictEqual(c.redenen, []); assert.strictEqual(c.kan, true);
  const t = K.tellers(R(op)); assert.strictEqual(t.basis.compleet, 17); assert.strictEqual(t.werkzone.compleet, 25); assert.strictEqual(t.optie.compleet, 6);
  assert.strictEqual(K.samenvatting(op).taken, 0);
});
test('vrijgeven: elk van de voorwaarden blokkeert apart', () => {
  const basis = klaar();
  const open = zet(basis, 'wanden.N.maten.lengte', { staat: 'open' });
  assert.ok(redenCodes(K.vrijgeefCheck(open)).includes('open'), 'een punt weer op open');
  const later = zet(basis, 'objecten.SC1.maten.hoogte', { staat: 'later', notitie: 'ladder nodig' });
  assert.deepStrictEqual(redenCodes(K.vrijgeefCheck(later)), ['later'], 'later is niet compleet');
  const nvt = zet(basis, 'objecten.SC1.maten.hoogte', { staat: 'nvt', notitie: 'achter de kast, niet maatvast nodig' });
  assert.strictEqual(K.vrijgeefCheck(nvt).kan, true, 'n.v.t. is bewust weggeklikt en telt als afgehandeld');
  const conflict = meet(basis, 'wanden.N.maten.lengte', 5800), cc = K.vrijgeefCheck(conflict);
  assert.ok(redenCodes(cc).length > 0 && redenCodes(cc).every(c => c === 'conflict'), 'alleen een conflict: noord 5800 past niet meer bij de diagonalen'); assert.ok(cc.redenen.some(x => x.id === 'vorm'));
  const rondje = kopie(basis); delete rondje.ruimtes[0].rondje['O|plint'];
  assert.deepStrictEqual(redenCodes(K.vrijgeefCheck(rondje)), ['rondje']);
  const rl = kopie(basis); rl.ruimtes[0] = K.zetRondje(rl.ruimtes[0], 'O', 'plint', 'later', T0).ruimte;
  assert.deepStrictEqual(redenCodes(K.vrijgeefCheck(rl)), ['rondje-later'], 'rondje op later is een open taak en blokkeert');
  const zone = kopie(basis); zone.ruimtes[0].werkzone = [];
  assert.ok(redenCodes(K.vrijgeefCheck(zone)).includes('werkzone'));
  const extra = kopie(basis); extra.ruimtes[0].objecten.push({ id: 'X2', type: 'stopcontact', wand: 'W', eigen: true, maten: {} });
  assert.ok(redenCodes(K.vrijgeefCheck(extra)).includes('open'), 'ook een extra punt dat de opnemer zelf koos moet af');
  const lat = kopie(basis); lat.ruimtes[0].werkzone = ['O', 'N']; assert.ok(K.vrijgeefCheck(lat).redenen.length > 0, 'een extra werkzone-wand brengt nieuwe punten en een nieuw rondje');
  const wand = zet(basis, 'wanden.W.maten.bevestiging', { staat: 'open' }); assert.ok(redenCodes(K.vrijgeefCheck(wand)).includes('open'), 'elke wand buiten de werkzone moet bevestigd zijn');
});
test('de wandbevestiging buiten de werkzone: bekeken, afgedekt of niet beoordeeld; afgedekt en niet beoordeeld komen in de uitzonderingen', () => {
  const basis = klaar();
  assert.ok(K.zetMaat(basis, 'R1', 'wanden.W.maten.bevestiging', { staat: 'nvt' }, T0).fout, 'nvt vraagt afgedekt of niet-beoordeeld');
  assert.ok(K.zetMaat(basis, 'R1', 'wanden.W.maten.bevestiging', { staat: 'nvt', keuze: 'bekeken' }, T0).fout);
  assert.ok(K.zetMaat(basis, 'R1', 'wanden.W.maten.bevestiging', { staat: 'gemeten', keuze: 'afgedekt', bron: 'hand' }, T0).fout, 'afgedekt is geen "bekeken"');
  const w = zet(basis, 'wanden.W.maten.bevestiging', { staat: 'nvt', keuze: 'afgedekt', notitie: 'kast voor de wand' }), c = K.vrijgeefCheck(w);
  assert.strictEqual(c.kan, true); const u = c.uitzonderingen.find(x => x.soort === 'wand-niet-beoordeeld');
  assert.deepStrictEqual([u.wand, u.tekst, u.notitie], ['W', 'Wand west: afgedekt', 'kast voor de wand']);
  assert.ok(!K.vrijgeefCheck(basis).uitzonderingen.some(x => x.soort === 'wand-niet-beoordeeld'), 'bekeken is geen uitzondering');
});
test('de vrijgave geeft scope en uitzonderingen terug; niets staat stil als volledig gemeten', () => {
  const op = klaar(), c = K.vrijgeefCheck(op);
  assert.deepStrictEqual(c.scope[0].werkzone, ['O']); assert.deepStrictEqual(c.scope[0].wanden_alleen_basis, ['N', 'Z', 'W']); assert.deepStrictEqual(c.scope[0].telling.basis, { n: 17, gemeten: 17, nvt: 0 });
  assert.strictEqual(c.scope[0].vorm.status, 'consistent'); assert.strictEqual(c.scope[0].meubelset_gereed, true);
  const soorten = c.uitzonderingen.map(x => x.soort).sort();
  assert.deepStrictEqual(soorten, ['bijzonderheid', 'bijzonderheid', 'rondje-niet-aanwezig', 'rondje-niet-aanwezig'], 'twee benoemde bijzonderheden zonder maat en twee rondjekeuzes niet aanwezig');
  assert.strictEqual(c.volledig_gemeten, false); assert.ok(c.uitzonderingen.find(x => x.soort === 'bijzonderheid' && x.wand === 'O').tekst.includes('genoemd, niet bemeten'));
  const nvt = zet(op, 'objecten.SC1.maten.hoogte', { staat: 'nvt', notitie: 'achter de kast' }); const u = K.vrijgeefCheck(nvt).uitzonderingen.find(x => x.soort === 'nvt');
  assert.deepStrictEqual([u.pad, u.notitie], ['objecten.SC1.maten.hoogte', 'achter de kast']);
  // helemaal schoon: geen bijzonderheden, geen nvt, rondje overal aanwezig, beide diagonalen
  const schoon = metFoto(rondjeKlaar(allesGemeten(joe()), ['O'], false)); R(schoon).bijzonderheden = [];
  const cs = K.vrijgeefCheck(schoon); assert.deepStrictEqual(cs.uitzonderingen, []); assert.strictEqual(cs.volledig_gemeten, true);
  const v = K.vrijgeven(op, 'Bart', T0);
  assert.deepStrictEqual(v.opname.vrijgave.uitzonderingen, c.uitzonderingen); assert.deepStrictEqual(v.opname.vrijgave.scope, c.scope); assert.strictEqual(v.opname.vrijgave.volledig_gemeten, false);
});
test('vrijgeven: waarschuwingen blokkeren niet (definitie ontbreekt, onwaarschijnlijke maat, foto ontbreekt)', () => {
  let op = klaar(); delete R(op).openingen[0].definitie; op = meet(op, 'wanden.W.maten.lengte', W_J);
  const c = K.vrijgeefCheck(op); assert.strictEqual(c.kan, true); assert.ok(c.waarschuwingen.some(w => w.code === 'definitie-ontbreekt' && w.pad.startsWith('openingen.R1.')));
  assert.deepStrictEqual(c.waarschuwingen.filter(w => w.code === 'foto-ontbreekt').map(w => w.wand), ['N', 'Z', 'W'], 'alleen de wanden buiten de werkzone zonder foto');
  const klein = meet(op, 'plafondpunten.P1.maten.hoogte', 245); assert.ok(K.waarschuwingen(R(klein)).some(w => w.code === 'onwaarschijnlijk'), '245 mm plafond: tikfout?');
});

test('een foto van elke werkzone-wand is verplicht voor het vrijgeven; van de andere wanden is het een waarschuwing', () => {
  const zonder = rondjeKlaar(allesGemeten(joe()), ['O'], true), c = K.vrijgeefCheck(zonder);
  assert.deepStrictEqual(redenCodes(c), ['foto']); assert.strictEqual(c.redenen[0].wand, 'O'); assert.ok(/foto van de oostwand/.test(c.redenen[0].tekst)); assert.strictEqual(c.waarschuwingen.filter(w => w.code === 'foto-ontbreekt').length, 3);
  const anders = K.voegFotoToe(zonder, { bestand: 'joe-noord.jpg', ruimte: 'R1', wand: 'N' }).opname;
  assert.deepStrictEqual(redenCodes(K.vrijgeefCheck(anders)), ['foto'], 'een foto van een andere wand telt niet voor de werkzone-wand');
  const overzicht = K.voegFotoToe(zonder, { bestand: 'joe-overzicht.jpg', ruimte: 'R1' }).opname; assert.deepStrictEqual(redenCodes(K.vrijgeefCheck(overzicht)), ['foto'], 'een overzichtsfoto zonder wand ook niet');
  const andereRuimte = K.nieuweOpname({ opname_id: 'OPN-TEST-001', ruimtes: [R(zonder), K.nieuweRuimte({ id: 'R2', naam: 'Andere' })], fotos: [{ id: 'F1', bestand: 'x.jpg', ruimte: 'R2', wand: 'O' }] });
  assert.ok(redenCodes(K.vrijgeefCheck(andereRuimte)).includes('foto'), 'een foto van een andere ruimte telt niet');
  const ok = metFoto(zonder); assert.strictEqual(K.vrijgeefCheck(ok).kan, true); assert.deepStrictEqual(K.vrijgeefCheck(ok).waarschuwingen.filter(w => w.code === 'foto-ontbreekt').map(w => w.wand), ['N', 'Z', 'W']);
  assert.strictEqual(K.vrijgeven(zonder, 'Bart', T0).opname, null); assert.ok(K.vrijgeven(ok, 'Bart', T0).opname);
  const twee = joe(['O', 'N']); assert.deepStrictEqual(K.vrijgeefCheck(twee).redenen.filter(x => x.code === 'foto').map(x => x.wand), ['N', 'O'], 'elke werkzone-wand heeft een foto nodig');
});

// ── Vrijgave gekoppeld aan de inhoud ──
test('vrijgeven: legt hash, tijd en door vast; een geldige vrijgave blijft staan bij opslaan', () => {
  const r = K.vrijgeven(klaar(), 'Bart', '2026-11-01T11:00:00.000Z'); assert.strictEqual(r.fout, null);
  const o = r.opname; assert.strictEqual(o.status, 'vrijgegeven'); assert.strictEqual(o.vrijgave.door, 'Bart'); assert.strictEqual(o.vrijgave.tijd, '2026-11-01T11:00:00.000Z'); assert.ok(/^[0-9a-f]{14}$/.test(o.vrijgave.hash));
  assert.strictEqual(K.isVrijgaveGeldig(o), true); assert.strictEqual(K.effectieveStatus(o), 'vrijgegeven');
  assert.strictEqual(K.slaOp(o, T0).opname.status, 'vrijgegeven', 'opslaan zonder inhoudelijke wijziging laat de vrijgave staan');
  const nee = K.vrijgeven(joe(), 'Bart', T0); assert.strictEqual(nee.opname, null); assert.ok(nee.fout && nee.check.redenen.length > 0);
});
test('elke inhoudelijke wijziging maakt een eerdere vrijgave ongeldig', () => {
  const v = K.vrijgeven(klaar(), 'Bart', T0).opname, wijzig = f => { const o = kopie(v); f(o); return o; };
  const gevallen = {
    maat: K.zetMaat(v, 'R1', 'wanden.N.maten.lengte', { staat: 'gemeten', waarde: 5761, bron: 'disto' }, T0).opname,
    staat: K.zetMaat(v, 'R1', 'objecten.SC1.maten.hoogte', { staat: 'nvt' }, T0).opname,
    bron: K.zetMaat(v, 'R1', 'wanden.N.maten.lengte', { staat: 'gemeten', waarde: N_J, bron: 'hand' }, T0).opname,
    meubeltype: wijzig(o => { o.ruimtes[0].meubeltype = 'keuken'; }),
    werkzone: wijzig(o => { o.ruimtes[0].werkzone = ['O', 'N']; }),
    'punt toevoegen': wijzig(o => { o.ruimtes[0].objecten.push({ id: 'X9', type: 'leiding', wand: 'N', maten: {} }); }),
    'punt verwijderen': wijzig(o => { o.ruimtes[0].objecten = o.ruimtes[0].objecten.filter(x => x.id !== 'SC4'); }),
    'bijzonderheid wijzigen': wijzig(o => { o.ruimtes[0].bijzonderheden[0].notitie = 'iets anders'; }),
    'bijzonderheid toevoegen': wijzig(o => { o.ruimtes[0].bijzonderheden.push({ id: 'B9', soort: 'koof', wand: 'O', maten: {} }); }),
    'opening wijzigen': wijzig(o => { o.ruimtes[0].openingen[0].definitie = 'dagmaat'; }),
    rondje: wijzig(o => { o.ruimtes[0].rondje['O|plint'].waarde = 'afwezig'; }),
    project: wijzig(o => { o.project.code = 'TEST-002'; }),
    'gezien-status': wijzig(o => { o.ruimtes[0].objecten.find(x => x.id === 'SC3').gezien = 'niet-aanwezig'; }) };
  for (const k of Object.keys(gevallen)) { assert.strictEqual(K.isVrijgaveGeldig(gevallen[k]), false, k); assert.strictEqual(K.effectieveStatus(gevallen[k]), 'vrijgave-vervallen', k); assert.strictEqual(gevallen[k].status, 'vrijgegeven', k + ': de status zelf is niet aangepast, de hash vangt het toch'); }
  assert.strictEqual(K.slaOp(gevallen.maat, T0).opname.status, 'opgeslagen', 'opslaan na een wijziging maakt er "opgeslagen" van');
  assert.strictEqual(K.inhoudsHash(v), K.inhoudsHash(kopie(v)));
});
test('geen inhoudelijke wijziging: tijd, historie, grijs voorstel en foto\'s buiten de werkzone veranderen de hash niet', () => {
  const v = K.vrijgeven(klaar(), 'Bart', T0).opname;
  const zelfde = K.zetMaat(v, 'R1', 'wanden.N.maten.lengte', { staat: 'gemeten', waarde: N_J, bron: 'disto' }, '2026-12-24T10:00:00.000Z').opname;
  assert.strictEqual(R(zelfde).wanden[0].maten.lengte.historie.length, 1, 'er is wel een historie bijgekomen'); assert.strictEqual(K.isVrijgaveGeldig(zelfde), true);
  const voorstel = K.zetVoorstel(v, 'R1', 'openingen.R1.maten.hoogte', { schatting_mm: 1100 }, T0).opname; assert.strictEqual(K.isVrijgaveGeldig(voorstel), true);
  const foto = K.voegFotoToe(v, { bestand: 'noord-01.jpg', ruimte: 'R1', wand: 'N' }).opname; assert.strictEqual(K.isVrijgaveGeldig(foto), true, 'een foto van een wand buiten de werkzone raakt de hash niet');
  const overzicht = K.voegFotoToe(v, { bestand: 'overzicht.jpg', ruimte: 'R1' }).opname; assert.strictEqual(K.isVrijgaveGeldig(overzicht), true);
  assert.strictEqual(K.isVrijgaveGeldig(joe()), false); assert.strictEqual(K.isVrijgaveGeldig(null), false); assert.strictEqual(K.effectieveStatus(joe()), 'concept');
});

test('foto-verwijzingen van werkzone-wanden zitten in de hash: verwijderen, vervangen of toevoegen maakt de vrijgave ongeldig', () => {
  const v = K.vrijgeven(klaar(), 'Bart', T0).opname; assert.strictEqual(K.isVrijgaveGeldig(v), true); assert.strictEqual(v.fotos.length, 1);
  const weg = kopie(v); weg.fotos = []; assert.strictEqual(K.isVrijgaveGeldig(weg), false, 'foto verwijderd'); assert.strictEqual(K.effectieveStatus(weg), 'vrijgave-vervallen');
  const ander = kopie(v); ander.fotos[0].bestand = 'oost-02.jpg'; assert.strictEqual(K.isVrijgaveGeldig(ander), false, 'foto vervangen');
  const extra = K.voegFotoToe(v, { bestand: 'oost-02.jpg', ruimte: 'R1', wand: 'O' }).opname; assert.strictEqual(K.isVrijgaveGeldig(extra), false, 'tweede foto van de werkzone-wand');
  const tijd = kopie(v); tijd.fotos[0].tijd = '2027-01-01T00:00:00.000Z'; tijd.fotos[0].exif = { breedte: 4000 }; assert.strictEqual(K.isVrijgaveGeldig(tijd), true, 'tijd en extra gegevens van de foto tellen niet mee');
  const buiten = kopie(v); buiten.fotos.unshift({ id: 'FX', bestand: 'a.jpg', ruimte: 'R1', wand: 'N' }); assert.strictEqual(K.isVrijgaveGeldig(buiten), true, 'foto buiten de werkzone');
});
test('plafond links en rechts: 300 mm uit de hoek staat in vraag en uitleg; het midden niet', () => {
  const v = K.vragen(R(joe())), get = p => v.find(x => x.pad === p);
  assert.strictEqual(K.PLAFOND_UIT_HOEK, 300);
  assert.ok(/300 mm uit de linkerhoek/.test(get('wanden.O.maten.plafond_links').vraag) && /300 mm van de linkerhoek/.test(get('wanden.O.maten.plafond_links').uitleg));
  assert.ok(/300 mm uit de rechterhoek/.test(get('wanden.O.maten.plafond_rechts').vraag) && /300 mm van de rechterhoek/.test(get('wanden.O.maten.plafond_rechts').uitleg));
  assert.ok(!/300/.test(get('wanden.O.maten.plafond_midden').vraag + get('wanden.O.maten.plafond_midden').uitleg) && /in het midden/.test(get('wanden.O.maten.plafond_midden').vraag));
});
test('wand niet te lood: drie wandlengtes meer dan 5 mm uit elkaar geeft een melding, geen blokkade', () => {
  const scheef = w => w.filter(x => x.code === 'wand-scheef');
  let op = meet(meet(meet(joe(), 'wanden.O.maten.lengte', 2900), 'wanden.O.maten.lengte_onder', 2900), 'wanden.O.maten.lengte_boven', 2905);
  assert.strictEqual(scheef(K.waarschuwingen(R(op))).length, 0, '5 mm verschil is nog goed');
  op = meet(op, 'wanden.O.maten.lengte_onder', 2890); const m = scheef(K.waarschuwingen(R(op)));
  assert.strictEqual(m.length, 1); assert.strictEqual(m[0].wand, 'O'); assert.strictEqual(m[0].verschil_mm, 15); assert.ok(/niet te lood of scheef/.test(m[0].tekst) && /onder 2890 mm/.test(m[0].tekst));
  assert.strictEqual(scheef(K.waarschuwingen(R(meet(joe(), 'wanden.O.maten.lengte', 2900)))).length, 0, 'met één hoogte valt er niets te vergelijken');
  assert.strictEqual(scheef(K.waarschuwingen(R(meet(meet(joe(), 'wanden.O.maten.lengte', 2900), 'wanden.O.maten.lengte_boven', 2880)))).length, 1, 'ook met twee van de drie');
  const buiten = kopie(R(meet(joe(), 'wanden.N.maten.lengte', 5700))); buiten.wanden.find(x => x.id === 'N').maten.lengte_onder = { staat: 'gemeten', waarde: 5600, bron: 'hand', tijd: T0 }; assert.strictEqual(scheef(K.waarschuwingen(buiten)).length, 0, 'alleen werkzone-wanden');
  const k = klaar(), scheefK = meet(k, 'wanden.O.maten.lengte_onder', O_J - 20);
  assert.strictEqual(K.vrijgeefCheck(scheefK).kan, K.vrijgeefCheck(k).kan, 'de melding blokkeert het vrijgeven niet'); assert.ok(K.vrijgeefCheck(scheefK).waarschuwingen.some(w => w.code === 'wand-scheef'));
});

// ── Wat er op een wand zit (brok 2: de app legt openingen, objecten en bijzonderheden vast) ──
const leeg = zone => K.nieuweOpname({ opname_id: 'OPN-TEST-002', aangemaakt: T0, ruimtes: [K.nieuweRuimte({ id: 'R1', naam: 'Testruimte', werkzone: zone || ['O'] })] });
test('ruimtegegevens zetten: naam, meubeltype, werkzone (in wandvolgorde) en toegangsdeur; fouten worden geweigerd', () => {
  let op = leeg(); const r1 = K.zetRuimte(op, 'R1', { naam: '  Woonkamer ', werkzone: ['Z', 'O'], meubeltype: 'keuken' }); assert.strictEqual(r1.fout, null);
  assert.strictEqual(R(r1.opname).naam, 'Woonkamer'); assert.deepStrictEqual(R(r1.opname).werkzone, ['O', 'Z']); assert.strictEqual(R(r1.opname).meubeltype, 'keuken'); assert.strictEqual(R(op).naam, 'Testruimte', 'de invoer blijft ongewijzigd');
  for (const slecht of [{ naam: '  ' }, { meubeltype: 'tuinhuis' }, { werkzone: ['X'] }, { werkzone: 'O' }, { toegangsdeur: 'D9' }]) assert.ok(K.zetRuimte(op, 'R1', slecht).fout, JSON.stringify(slecht));
  assert.ok(K.zetRuimte(op, 'R9', {}).fout);
  const d = K.voegOpeningToe(op, 'R1', { soort: 'deur', wand: 'Z' }); const met = K.zetRuimte(d.opname, 'R1', { toegangsdeur: d.id }).opname; assert.strictEqual(R(met).toegangsdeur, 'D1');
  assert.strictEqual(K.zetRuimte(met, 'R1', { toegangsdeur: null }).opname.ruimtes[0].toegangsdeur, undefined);
});
test('openingen toevoegen: deur D1, D2 en raam R1; id uniek, definitie optioneel, de route vraagt er direct naar', () => {
  let op = leeg(); const a = K.voegOpeningToe(op, 'R1', { soort: 'deur', wand: 'Z' }), b = K.voegOpeningToe(a.opname, 'R1', { soort: 'raam', wand: 'O', definitie: 'dagmaat' }), c = K.voegOpeningToe(b.opname, 'R1', { soort: 'deur', wand: 'N' });
  assert.deepStrictEqual([a.id, b.id, c.id], ['D1', 'R1', 'D2']); assert.strictEqual(R(c.opname).openingen.find(o => o.id === 'R1').definitie, 'dagmaat'); assert.strictEqual(R(c.opname).openingen.find(o => o.id === 'D1').definitie, undefined);
  assert.ok(K.vragen(R(c.opname)).some(v => v.pad === 'openingen.R1.maten.breedte' && v.bucket === 'basis'));
  assert.ok(K.route(R(c.opname)).stappen.some(x => x.id === 'maat:openingen.D2.maten.positie'));
  for (const slecht of [{ soort: 'poort', wand: 'N' }, { soort: 'raam', wand: 'X' }, { soort: 'raam', wand: 'N', definitie: 'iets' }]) assert.ok(K.voegOpeningToe(op, 'R1', slecht).fout, JSON.stringify(slecht));
  assert.strictEqual(K.zetDefinitie(c.opname, 'R1', 'D1', 'muursparing').opname.ruimtes[0].openingen[0].definitie, 'muursparing'); assert.ok(K.zetDefinitie(c.opname, 'R1', 'D1', 'x').fout); assert.ok(K.zetDefinitie(c.opname, 'R1', 'D9', 'dagmaat').fout);
});
test('objecten toevoegen: in de werkzone volledig gevraagd; erbuiten alleen omdat de opnemer het zelf toevoegde (extra)', () => {
  let op = leeg(['O']); const sc = K.voegObjectToe(op, 'R1', { type: 'stopcontact', wand: 'O', hoek: 'ZO' }), buiten = K.voegObjectToe(sc.opname, 'R1', { type: 'radiator', wand: 'N' });
  assert.strictEqual(sc.id, 'SC1'); assert.strictEqual(buiten.id, 'RAD1');
  const vr = K.vragen(R(buiten.opname)); assert.strictEqual(vr.find(v => v.pad === 'objecten.SC1.maten.hoogte').bucket, 'werkzone'); assert.strictEqual(vr.find(v => v.pad === 'objecten.RAD1.maten.breedte').bucket, 'extra');
  assert.strictEqual(R(buiten.opname).objecten[1].eigen, true); assert.strictEqual(R(buiten.opname).objecten[0].eigen, undefined);
  assert.ok(/zuidoosthoek/.test(vr.find(v => v.pad === 'objecten.SC1.maten.afstand').vraag));
  for (const slecht of [{ type: 'tafel', wand: 'O' }, { type: 'plint', wand: 'X' }, { type: 'plint', wand: 'O', hoek: 'XX' }, { type: 'vensterbank', wand: 'O', opening: 'R9' }]) assert.ok(K.voegObjectToe(op, 'R1', slecht).fout, JSON.stringify(slecht));
  const raam = K.voegOpeningToe(op, 'R1', { soort: 'raam', wand: 'O' }), vb = K.voegObjectToe(raam.opname, 'R1', { type: 'vensterbank', wand: 'O', opening: raam.id }); assert.ok(!K.vragen(R(vb.opname)).some(v => v.pad === 'objecten.VB1.maten.hoogte'), 'bij een raam is de hoogte de borstwering');
});
test('bijzonderheid toevoegen: genoemd zonder maat komt in de uitzonderingen, met "bemeten" krijgt hij een maatvraag', () => {
  let op = leeg(); const a = K.voegBijzonderheidToe(op, 'R1', { soort: 'koof', wand: 'O', notitie: 'koof boven de radiator' }), b = K.voegBijzonderheidToe(a.opname, 'R1', { soort: 'nis', wand: 'O', bemeten: true });
  assert.deepStrictEqual([a.id, b.id], ['B1', 'B2']); assert.ok(K.vrijgeefCheckRuimte(R(b.opname)).uitzonderingen.some(u => u.soort === 'bijzonderheid' && u.pad === 'bijzonderheden.B1'));
  assert.ok(K.vragen(R(b.opname)).some(v => v.pad === 'bijzonderheden.B2.maten.maat' && v.bucket === 'extra')); assert.ok(!K.vragen(R(b.opname)).some(v => v.pad === 'bijzonderheden.B1.maten.maat'));
  assert.ok(K.voegBijzonderheidToe(op, 'R1', { soort: 'spook', wand: 'O' }).fout); assert.ok(K.voegBijzonderheidToe(op, 'R1', { soort: 'koof', wand: 'Q' }).fout);
});
test('weghalen archiveert het hele item met zijn maten; de toegangsdeur en de opening van een vensterbank vervallen netjes', () => {
  let op = leeg(); const d = K.voegOpeningToe(op, 'R1', { soort: 'deur', wand: 'Z' }); op = K.zetRuimte(d.opname, 'R1', { toegangsdeur: 'D1' }).opname;
  op = zet(op, 'openingen.D1.maten.breedte', { staat: 'gemeten', waarde: 830 }); const raam = K.voegOpeningToe(op, 'R1', { soort: 'raam', wand: 'O' }); op = K.voegObjectToe(raam.opname, 'R1', { type: 'vensterbank', wand: 'O', opening: 'R1' }).opname;
  const weg = K.verwijderItem(op, 'R1', 'openingen', 'D1', T0); assert.strictEqual(weg.fout, null); const r = R(weg.opname);
  assert.ok(!r.openingen.some(o => o.id === 'D1')); assert.strictEqual(r.toegangsdeur, undefined); assert.strictEqual(r.verwijderd.length, 1); assert.strictEqual(r.verwijderd[0].item.maten.breedte.waarde, 830, 'de gemeten maat blijft bewaard'); assert.strictEqual(r.verwijderd[0].tijd, T0);
  const weg2 = K.verwijderItem(weg.opname, 'R1', 'openingen', 'R1', T0).opname; assert.strictEqual(R(weg2).objecten[0].opening, undefined); assert.strictEqual(R(weg2).verwijderd.length, 2);
  assert.ok(K.verwijderItem(op, 'R1', 'openingen', 'D9').fout); assert.ok(K.verwijderItem(op, 'R1', 'meubels', 'D1').fout);
  assert.strictEqual(K.lees(weg2).meldingen.length, 0, 'lezen laat het archief ongemoeid'); assert.deepStrictEqual(K.lees(weg2).opname.ruimtes[0].verwijderd, R(weg2).verwijderd);
});
test('foto weghalen: de verwijzing gaat naar fotos_verwijderd, een werkzone-foto weghalen blokkeert het vrijgeven weer', () => {
  const op = klaar(); assert.strictEqual(K.vrijgeefCheck(op).kan, true); const f = op.fotos[0];
  const weg = K.verwijderFoto(op, f.id, T0); assert.strictEqual(weg.fout, null); assert.strictEqual(weg.opname.fotos.length, 0); assert.strictEqual(weg.opname.fotos_verwijderd[0].bestand, f.bestand); assert.strictEqual(weg.opname.fotos_verwijderd[0].verwijderd_op, T0);
  assert.ok(redenCodes(K.vrijgeefCheck(weg.opname)).includes('foto')); assert.ok(K.verwijderFoto(op, 'F99').fout); assert.strictEqual(op.fotos.length, 1, 'de invoer blijft ongewijzigd');
});

// ── Takenlijst ──
test('takenlijst: elk later-punt wordt "Nameten: ..." met een stabiele sleutel; ook het rondje op later', () => {
  let op = joe(); op = zet(op, 'openingen.R1.maten.hoogte', { staat: 'later', notitie: 'Ladder nodig, meubels in de weg' }); op = zet(op, 'wanden.Z.maten.lengte', { staat: 'later' });
  op = zet(op, 'objecten.SC1.maten.afdek', { staat: 'later' }); op = zet(op, 'wanden.N.maten.lengte', { staat: 'nvt' });
  op = zet(op, 'objecten.SC3.maten.hoogte', { staat: 'later' });                         // buiten de werkzone en niet gevraagd: geen taak
  const o2 = kopie(op); o2.ruimtes[0] = K.zetRondje(R(op), 'O', 'elektra', 'later', T0).ruimte;
  const t = K.takenlijst(o2);
  assert.deepStrictEqual(t.map(x => x.tekst), ['Nameten: Kamer Joe, Zuid: Wandlengte zuid', 'Nameten: Kamer Joe, Noord: R1 hoogte', 'Nameten: Kamer Joe, Oost: SC1 afdekraam', 'Nameten: Kamer Joe, Oost: elektra beoordelen (rondje controle)']);
  assert.strictEqual(t[1].reden, 'Ladder nodig, meubels in de weg'); assert.strictEqual(t[1].sleutel, 'OPN-TEST-001|R1|openingen.R1.maten.hoogte');
  assert.deepStrictEqual(K.takenlijst(o2).map(x => x.sleutel), t.map(x => x.sleutel), 'opnieuw opslaan geeft dezelfde sleutels, dus geen dubbele taken');
  assert.strictEqual(K.samenvatting(o2).taken, 4); assert.strictEqual(K.samenvatting(o2).later, 2);
});

// ── Wijzigen ──
test('zetMaat: geeft een nieuwe opname, bewaart eerdere standen in de historie en past de invoer niet aan', () => {
  const op0 = joe(), voor = kopie(op0);
  const op1 = K.zetMaat(op0, 'R1', 'wanden.N.maten.lengte', { staat: 'gemeten', waarde: 5755, bron: 'hand', notitie: 'rolmaat' }, '2026-11-01T10:00:00Z').opname;
  assert.deepStrictEqual(op0, voor, 'de invoer blijft zoals hij was'); assert.notStrictEqual(op1, op0);
  const op2 = K.zetMaat(op1, 'R1', 'wanden.N.maten.lengte', { staat: 'gemeten', waarde: 5760, bron: 'disto' }, '2026-11-01T10:05:00Z').opname;
  const op3 = K.zetMaat(op2, 'R1', 'wanden.N.maten.lengte', { staat: 'nvt', notitie: 'toch niet nodig' }, '2026-11-01T10:10:00Z').opname;
  const m = R(op3).wanden.find(w => w.id === 'N').maten.lengte;
  assert.strictEqual(m.staat, 'nvt'); assert.strictEqual(m.waarde, null); assert.strictEqual(m.notitie, 'toch niet nodig');
  assert.deepStrictEqual(m.historie.map(h => [h.staat, h.waarde, h.bron, h.tijd]), [['gemeten', 5755, 'hand', '2026-11-01T10:00:00Z'], ['gemeten', 5760, 'disto', '2026-11-01T10:05:00Z']], 'append-only, niets gaat stil verloren');
  assert.strictEqual(R(op2).wanden.find(w => w.id === 'N').maten.lengte.bron, 'disto'); assert.strictEqual(R(op2).wanden.find(w => w.id === 'N').maten.lengte.tijd, '2026-11-01T10:05:00Z');
});
test('zetMaat: weigert onzin met een duidelijke fout', () => {
  const op = joe(), f = (ruimte, pad, inv) => K.zetMaat(op, ruimte, pad, inv, T0).fout;
  assert.ok(f('R1', 'wanden.N.maten.lengte', { staat: 'misschien' })); assert.ok(f('R1', 'wanden.N.maten.lengte', { staat: 'gemeten' }), 'gemeten zonder waarde');
  assert.ok(f('R1', 'wanden.N.maten.lengte', { staat: 'gemeten', waarde: 0 })); assert.ok(f('R1', 'wanden.N.maten.lengte', { staat: 'gemeten', waarde: -5 })); assert.ok(f('R1', 'wanden.N.maten.lengte', { staat: 'gemeten', waarde: NaN }));
  assert.ok(f('R9', 'wanden.N.maten.lengte', { staat: 'later' }), 'onbekende ruimte'); assert.ok(f('R1', 'wanden.X.maten.lengte', { staat: 'later' }), 'onbekend punt');
  assert.ok(f('R1', '__proto__.maten.x', { staat: 'later' })); assert.ok(f('R1', 'constructor.prototype.x', { staat: 'later' })); assert.strictEqual({}.maten, undefined);
  assert.ok(f('R1', 'objecten.PLO.maten.keuze', { staat: 'gemeten', waarde: 5 }), 'een keuze is geen maat'); assert.ok(f('R1', 'objecten.PLO.maten.keuze', { staat: 'gemeten', keuze: 'weet niet' }));
  assert.strictEqual(f('R1', 'objecten.PLO.maten.keuze', { staat: 'gemeten', keuze: 'gaat-weg' }), null);
});
test('een keuze (plint blijft of gaat weg, bereikbaarheid) is compleet met een geldige keuze, zonder waarde', () => {
  let op = zet(joe(), 'objecten.PLO.maten.keuze', { staat: 'gemeten', keuze: 'blijft', bron: 'hand' });
  const v = K.vragen(R(op)).find(x => x.pad === 'objecten.PLO.maten.keuze'); assert.strictEqual(v.staat, 'gemeten'); assert.strictEqual(v.eenheid, 'keuze'); assert.deepStrictEqual(v.keuzes, ['blijft', 'gaat-weg']);
});
test('foto\'s: alleen een verwijzing met ruimte en wand per foto', () => {
  let op = joe();
  op = K.voegFotoToe(op, { bestand: 'oost-01.jpg', ruimte: 'R1', wand: 'O' }).opname; op = K.voegFotoToe(op, { bestand: 'overzicht.jpg', ruimte: 'R1' }).opname;
  assert.strictEqual(op.fotos.length, 2); assert.deepStrictEqual(op.fotos.map(f => [f.id, f.ruimte, f.wand]), [['F1', 'R1', 'O'], ['F2', 'R1', null]]);
  assert.deepStrictEqual(K.fotosVan(op, 'R1', 'O').map(f => f.bestand), ['oost-01.jpg']); assert.strictEqual(K.fotosVan(op, 'R1').length, 2);
  assert.ok(K.voegFotoToe(op, { bestand: 'x.jpg' }).fout, 'zonder ruimte'); assert.ok(K.voegFotoToe(op, { bestand: 'x.jpg', ruimte: 'R9' }).fout); assert.ok(K.voegFotoToe(op, { bestand: 'x.jpg', ruimte: 'R1', wand: 'Q' }).fout);
  assert.ok(K.voegFotoToe(op, { bestand: 'oost-01.jpg', ruimte: 'R1', wand: 'O' }).fout, 'hetzelfde bestand twee keer'); assert.ok(K.voegFotoToe(op, { ruimte: 'R1' }).fout);
  const kapot = kopie(op); kapot.fotos.push({ id: 'F3', bestand: 'los.jpg' }); assert.ok(K.vrijgeefCheck(kapot).waarschuwingen.some(w => w.code === 'foto-zonder-ruimte'));
});

// ── De route ──
const staps = (route, f) => route.stappen.filter(f || (() => true));
test('route voor Joe (fotos-dan-rondloop): fotoronde vanaf de toegangsdeur, rondloop vanaf de eerste werkzone-wand, dan ruimtebreed en rondje', () => {
  const rt = K.route(R(joe()));
  assert.strictEqual(rt.volgorde, 'fotos-dan-rondloop'); assert.strictEqual(rt.toegangswand, 'Z'); assert.deepStrictEqual(rt.foto_wanden, ['Z', 'W', 'N', 'O']); assert.deepStrictEqual(rt.maten_wanden, ['O', 'Z', 'W', 'N']); assert.strictEqual(rt.start_wand, 'O');
  assert.deepStrictEqual(rt.stappen.map(s => s.id.replace(/^maat:/, '').replace(/\.maten\./, ':').replace(/^(objecten|openingen|wanden|diagonalen|plafondpunten)\./, '')), [
    'foto:Z', 'foto:W', 'foto:N', 'foto:O',
    'O:lengte', 'O:lengte_onder', 'O:lengte_boven', 'O:plafond_links', 'O:plafond_midden', 'O:plafond_rechts', 'R3:breedte', 'R3:hoogte', 'R3:positie', 'R3:borstwering', 'R3:positie_rechts',
    'SC1:hoogte', 'SC1:afstand', 'SC1:afdek', 'SC2:hoogte', 'SC2:afstand', 'SC2:afdek', 'RAD2:breedte', 'RAD2:hoogte', 'RAD2:onderkant', 'RAD2:uitsteek', 'RAD2:bereikbaarheid',
    'VB3:diepte', 'VB3:dikte', 'VB3:overstek', 'PLO:hoogte', 'PLO:dikte', 'PLO:keuze', 'bijz:O',
    'Z:lengte', 'D1:breedte', 'D1:hoogte', 'D1:positie', 'Z:bevestiging',
    'W:lengte', 'W:bevestiging',
    'N:lengte', 'R1:breedte', 'R1:hoogte', 'R1:positie', 'R1:borstwering', 'R2:breedte', 'R2:hoogte', 'R2:positie', 'R2:borstwering', 'N:bevestiging',
    'P1:hoogte', 'A:lengte', 'B:lengte',
    'rondje:O|kozijn', 'rondje:O|elektra', 'rondje:O|water', 'rondje:O|radiator', 'rondje:O|plint']);
  assert.deepStrictEqual(rt.stappen.map(s => s.fase).filter((f, i, a) => a.indexOf(f) === i), ['fotoronde', 'wand', 'ruimte', 'rondje']);
});
test('route: elke stap heeft nr, "stap x van y", "wand n van m", groep, label, definitie en referentie', () => {
  const rt = K.route(R(joe())), totaal = rt.stappen.length;
  rt.stappen.forEach((s, i) => { assert.strictEqual(s.nr, i + 1); assert.strictEqual(s.totaal, totaal); assert.strictEqual(s.stap, 'stap ' + (i + 1) + ' van ' + totaal); assert.ok(s.label && s.vraag && s.groep && s.referentie && s.fase && s.type, s.id); });
  const s = rt.stappen.find(x => x.id === 'maat:openingen.R3.maten.breedte'); assert.deepStrictEqual([s.wand, s.wand_nr, s.wanden_totaal, s.wand_tekst, s.groep, s.definitie, s.referentie], ['O', 1, 4, 'wand 1 van 4', 'basis', 'muursparing', 'zijkanten']);
  const z = rt.stappen.find(x => x.id === 'maat:openingen.R3.maten.positie_rechts'); assert.strictEqual(z.groep, 'werkzone');
  assert.strictEqual(rt.stappen.find(x => x.id === 'maat:wanden.N.maten.lengte').wand_tekst, 'wand 4 van 4'); assert.strictEqual(rt.stappen.find(x => x.id === 'maat:plafondpunten.P1.maten.hoogte').wand_tekst, '');
  assert.deepStrictEqual(rt.samenvatting, { totaal: 58, vereist: 52, optioneel: 6, afgehandeld: 0, nog_relevant: 52 });
  assert.strictEqual(rt.stappen.find(x => x.id === 'foto:W').wand_tekst, 'wand 2 van 4', 'in de fotoronde telt de wand vanaf de toegangsdeur');
});
test('route: elk gevraagd punt komt precies één keer voor, ook punten zonder wand', () => {
  const r = joeRuimte(['O']); r.objecten.push({ id: 'X3', type: 'leiding', eigen: true, maten: {} }); r.bijzonderheden.push({ id: 'B3', soort: 'anders', maten: { maat: K.nieuweMaat() } }); r.plafondpunten.push({ id: 'P2', plaats: 'hoek NO', maten: {} });
  const paden = K.vragen(r).map(v => v.pad).sort(), inRoute = K.route(r).stappen.filter(s => s.pad && s.pad.indexOf('rondje.') !== 0).map(s => s.pad).sort();
  assert.deepStrictEqual(inRoute, paden); assert.ok(inRoute.includes('objecten.X3.maten.afstand'));
});
test('route: later en n.v.t. houden de route niet op; alleen open stappen worden aangeboden', () => {
  let op = joe(); op = zet(op, 'wanden.O.maten.lengte', { staat: 'later', notitie: 'ladder' }); op = zet(op, 'openingen.R3.maten.breedte', { staat: 'nvt', notitie: 'niet nodig' }); op = meet(op, 'openingen.R3.maten.hoogte', 1219);
  const rt = K.routeVanOpname(op, 'R1'), eerste = K.volgendeOpen(rt);
  assert.strictEqual(eerste.id, 'foto:Z', 'de fotoronde komt eerst');
  assert.strictEqual(K.volgendeOpen(rt, 'foto:O').id, 'maat:wanden.O.maten.lengte_onder', 'de lengte (later) wordt overgeslagen');
  const na = K.volgendeOpen(rt, 'maat:wanden.O.maten.plafond_rechts'); assert.strictEqual(na.id, 'maat:openingen.R3.maten.positie', 'breedte (n.v.t.) en hoogte (gemeten) worden overgeslagen');
  const by = id => K.stap(rt, id); assert.deepStrictEqual(['maat:wanden.O.maten.lengte', 'maat:openingen.R3.maten.breedte', 'maat:openingen.R3.maten.hoogte'].map(id => [by(id).staat, by(id).afgehandeld]), [['later', true], ['nvt', true], ['gemeten', true]]);
  assert.strictEqual(rt.samenvatting.afgehandeld, 3); assert.strictEqual(rt.samenvatting.nog_relevant, 49);
  // alles op later of n.v.t.: de route loopt door tot het eind
  let alles = joe(); for (const v of K.vragen(R(alles))) alles = zet(alles, v.pad, { staat: v.pad.length % 2 ? 'later' : 'nvt', keuze: v.nvt_keuzes ? v.nvt_keuzes[0] : undefined });
  const r2 = K.routeVanOpname(alles, 'R1'); let stap = K.volgendeOpen(r2), teller = 0; const gezien = [];
  while (stap && teller < 100) { gezien.push(stap.id); stap = K.volgendeOpen(r2, stap.nr); teller++; }
  assert.deepStrictEqual(gezien.filter(id => id.indexOf('maat:') === 0), [], 'alle maatpunten zijn beantwoord met later of n.v.t.: de route blokkeert niet'); assert.ok(gezien.every(id => id.indexOf('foto:') === 0 || id.indexOf('rondje:') === 0 || id === 'bijz:O'));
  assert.ok(gezien.length > 0 && gezien.length < 100);
});
test('route: optionele stappen (grijze voorstellen) worden niet als open aangeboden', () => {
  const rt = K.route(R(joe())), opt = staps(rt, s => s.optioneel).map(s => s.id.replace('maat:', ''));
  assert.deepStrictEqual(opt, ['openingen.D1.maten.hoogte', 'openingen.R1.maten.hoogte', 'openingen.R1.maten.borstwering', 'openingen.R2.maten.hoogte', 'openingen.R2.maten.borstwering', 'diagonalen.B.maten.lengte']);
  let s = K.volgendeOpen(rt), gezien = []; while (s) { gezien.push(s.id); s = K.volgendeOpen(rt, s.nr); }
  assert.ok(!gezien.some(id => opt.indexOf(id.replace('maat:', '')) >= 0), 'geen optionele stap in de open stappen'); assert.strictEqual(gezien.length, rt.samenvatting.nog_relevant);
});
test('route: volgendeOpen, vorige en stap werken met nr of id; wrap begint opnieuw bij het begin', () => {
  let op = joe(); op = zet(op, 'wanden.O.maten.lengte', { staat: 'later' });
  const rt = K.routeVanOpname(op, 'R1');
  assert.strictEqual(K.volgendeOpen(rt, 0).id, 'foto:Z'); assert.strictEqual(K.volgendeOpen(rt, 4).id, 'maat:wanden.O.maten.lengte_onder'); assert.strictEqual(K.volgendeOpen(rt, 'maat:openingen.R3.maten.breedte').id, 'maat:openingen.R3.maten.hoogte');
  assert.strictEqual(K.vorige(rt, 6).id, 'maat:wanden.O.maten.lengte'); assert.strictEqual(K.vorige(rt, 'foto:W').id, 'foto:Z'); assert.strictEqual(K.vorige(rt, 1), null); assert.strictEqual(K.vorige(rt, 'onbekend'), null);
  assert.strictEqual(K.stap(rt, 6).id, 'maat:wanden.O.maten.lengte_onder'); assert.strictEqual(K.stap(rt, 'foto:O').nr, 4); assert.strictEqual(K.stap(rt, 999), null);
  const laatste = rt.stappen[rt.stappen.length - 1]; assert.strictEqual(K.volgendeOpen(rt, laatste.nr), null); assert.strictEqual(K.volgendeOpen(rt, laatste.nr, { wrap: true }).id, 'foto:Z');
  assert.strictEqual(K.volgendeOpen(null), null); assert.strictEqual(K.vorige(null, 3), null);
});
test('route: de fotostap is klaar zodra er een foto van die wand bij de ruimte staat', () => {
  let op = K.voegFotoToe(joe(), { bestand: 'zuid-01.jpg', ruimte: 'R1', wand: 'Z' }).opname; op = K.voegFotoToe(op, { bestand: 'oost-01.jpg', ruimte: 'R1', wand: 'O' }).opname;
  const rt = K.routeVanOpname(op, 'R1'); assert.deepStrictEqual(staps(rt, s => s.type === 'foto').map(s => [s.wand, s.afgehandeld]), [['Z', true], ['W', false], ['N', false], ['O', true]]);
  assert.strictEqual(K.volgendeOpen(rt).id, 'foto:W'); assert.strictEqual(K.route(R(op)).stappen[0].afgehandeld, false, 'zonder opties.fotos kent de route geen foto\'s');
});
test('route: alternatieve volgorde rondloop (start bij de toegangsdeur, foto per wand) en per-soort', () => {
  const rl = K.route(R(joe()), { volgorde: 'rondloop' });
  assert.strictEqual(rl.volgorde, 'rondloop'); assert.deepStrictEqual(rl.maten_wanden, ['Z', 'W', 'N', 'O']); assert.strictEqual(rl.start_wand, 'Z');
  assert.deepStrictEqual(rl.stappen.slice(0, 7).map(s => s.id), ['foto:Z', 'maat:wanden.Z.maten.lengte', 'maat:openingen.D1.maten.breedte', 'maat:openingen.D1.maten.hoogte', 'maat:openingen.D1.maten.positie', 'maat:wanden.Z.maten.bevestiging', 'foto:W']);
  assert.strictEqual(staps(rl, s => s.type === 'foto').length, 4); assert.ok(staps(rl, s => s.type === 'foto').every(s => s.fase === 'wand'));
  const ps = K.route(R(joe()), { volgorde: 'per-soort' }), ids = ps.stappen.map(s => s.id);
  assert.deepStrictEqual(ids.slice(0, 4), ['foto:Z', 'foto:W', 'foto:N', 'foto:O']); assert.deepStrictEqual(ids.slice(4, 9), ['maat:wanden.O.maten.lengte', 'maat:wanden.O.maten.lengte_onder', 'maat:wanden.O.maten.lengte_boven', 'maat:wanden.Z.maten.lengte', 'maat:wanden.W.maten.lengte'], 'eerst alle wandlengtes');
  assert.ok(ids.indexOf('maat:openingen.R3.maten.breedte') > ids.indexOf('maat:wanden.Z.maten.bevestiging'));
  for (const rt of [rl, ps]) { assert.strictEqual(rt.stappen.length, K.route(R(joe())).stappen.length, 'dezelfde stappen, andere volgorde'); assert.deepStrictEqual(rt.stappen.map(s => s.id).sort(), K.route(R(joe())).stappen.map(s => s.id).sort()); }
  assert.strictEqual(K.route(R(joe()), { volgorde: 'onzin' }).volgorde, 'fotos-dan-rondloop'); assert.deepStrictEqual(K.ROUTE_VOLGORDES, ['fotos-dan-rondloop', 'rondloop', 'per-soort']);
});
test('route: objecten en openingen van links naar rechts als de positie bekend is; anders blijft de invoervolgorde', () => {
  const r = joeRuimte(['O']); r.openingen.push({ id: 'R4', soort: 'raam', wand: 'N', definitie: 'dagmaat', maten: {} });
  r.openingen.find(o => o.id === 'R1').maten.positie = { staat: 'gemeten', waarde: 3000, bron: 'disto', tijd: null }; r.openingen.find(o => o.id === 'R4').maten.positie = { staat: 'gemeten', waarde: 300, bron: 'disto', tijd: null }; r.openingen.find(o => o.id === 'R2').positie_x = 2000;
  const noord = K.route(Object.assign(r, { werkzone: ['N'] })).stappen.filter(s => s.wand === 'N' && s.pad && s.pad.startsWith('openingen.') && s.pad.endsWith('.breedte')).map(s => s.object);
  assert.deepStrictEqual(noord, ['R4', 'R2', 'R1'], 'gemeten positie of positie_x bepaalt de volgorde: 300, 2000, 3000');
  const r2 = joeRuimte(['O']); r2.objecten.find(o => o.id === 'SC1').positie_x = 3000; r2.objecten.find(o => o.id === 'SC2').positie_x = 400;
  const objOrde = rt => rt.stappen.filter(s => s.object && s.wand === 'O' && s.type === 'maat' && s.pad && !s.pad.startsWith('openingen') && !s.pad.startsWith('objecten.PLO')).map(s => s.object).filter((o, i, a) => a.indexOf(o) === i);
  assert.deepStrictEqual(objOrde(K.route(r2)), ['SC1', 'SC2', 'RAD2', 'VB3'], 'zonder positie voor alle objecten blijft de invoervolgorde');
  r2.objecten.find(o => o.id === 'RAD2').positie_x = 1500; r2.objecten.find(o => o.id === 'VB3').positie_x = 1000;
  assert.deepStrictEqual(objOrde(K.route(r2)), ['SC2', 'VB3', 'RAD2', 'SC1']);
});
test('route: de toegangswand komt uit de toegangsdeur, anders de eerste deur, anders noord; zonder werkzone start de rondloop daar', () => {
  const r = joeRuimte(['O']); delete r.toegangsdeur; assert.strictEqual(K.route(r).toegangswand, 'Z', 'de eerste deur');
  r.openingen = r.openingen.filter(o => o.soort !== 'deur'); assert.strictEqual(K.route(r).toegangswand, 'N'); r.openingen.push({ id: 'D9', soort: 'deur', wand: 'W', maten: {} }); r.toegangsdeur = 'D9'; assert.strictEqual(K.route(r).toegangswand, 'W');
  const z = joeRuimte([]); const rt = K.route(z); assert.strictEqual(rt.start_wand, 'Z'); assert.deepStrictEqual(rt.maten_wanden, ['Z', 'W', 'N', 'O']); assert.strictEqual(staps(rt, s => s.type === 'rondje' || s.type === 'bijzonderheden').length, 0);
});
test('route: de bijzonderheden-stap en het rondje delen hun antwoord (afwijkingen komen niet dubbel)', () => {
  let op = joe(); const voor = K.route(R(op)); assert.strictEqual(K.stap(voor, 'bijz:O').afgehandeld, false); assert.ok(!voor.stappen.some(s => s.id === 'rondje:O|afw'));
  op.ruimtes[0] = K.zetRondje(R(op), 'O', 'afw', 'aanwezig', T0).ruimte; const na = K.route(R(op)); assert.deepStrictEqual([K.stap(na, 'bijz:O').staat, K.stap(na, 'bijz:O').afgehandeld], ['gemeten', true]);
  assert.strictEqual(K.rondje(R(op)).regels.find(x => x.sleutel === 'O|afw').waarde, 'aanwezig');
});

// ── Veilig lezen en migreren ──
test('lezen: een v0.3-opname komt ongewijzigd terug, ook na tweemaal lezen', () => {
  let op = K.vrijgeven(klaar(), 'Bart', T0).opname; op = K.voegFotoToe(op, { bestand: 'noord-01.jpg', ruimte: 'R1', wand: 'N' }).opname;
  const a = K.lees(op); assert.deepStrictEqual(a.opname, op); assert.deepStrictEqual(a.meldingen, []); assert.strictEqual(a.alleenLezen, false);
  assert.deepStrictEqual(K.lees(a.opname).opname, op); assert.deepStrictEqual(K.lees(JSON.parse(JSON.stringify(op))).opname, op, 'ook via JSON'); assert.strictEqual(K.isVrijgaveGeldig(a.opname), true, 'lezen verandert de inhoud niet, dus de vrijgave blijft geldig');
});
test('lezen: onbekende velden blijven behouden en ontbrekende onderdelen worden aangevuld', () => {
  const ruw = { versie: '0.3', opname_id: 'X-1', toekomst: { a: 1 }, ruimtes: [{ id: 'R7', naam: 'Test', werkzone: 'Z', extraveld: [1, 2], wanden: [{ id: 'N', zijn_eigen_veld: true, maten: { lengte: 5000 } }] }] };
  const { opname, meldingen } = K.lees(ruw), r = opname.ruimtes[0];
  assert.deepStrictEqual(opname.toekomst, { a: 1 }); assert.deepStrictEqual(r.extraveld, [1, 2]); assert.strictEqual(r.wanden.length, 4, 'ontbrekende wanden aangevuld'); assert.strictEqual(r.diagonalen.length, 2); assert.strictEqual(r.plafondpunten[0].id, 'P1');
  assert.strictEqual(r.wanden[0].zijn_eigen_veld, true); assert.deepStrictEqual(r.werkzone, ['Z'], 'een tekst als werkzone wordt een lijst');
  assert.deepStrictEqual(r.wanden[0].maten.lengte, { staat: 'gemeten', waarde: 5000, bron: 'hand', tijd: null }); assert.ok(meldingen.some(m => /kaal getal/.test(m)));
  assert.strictEqual(r.meubeltype, 'kast'); assert.strictEqual(opname.status, 'concept'); assert.deepStrictEqual(opname.fotos, []);
});
test('lezen: onbekende staat, bron, waarde en werkzone blijven bewaard (nooit stil verlies)', () => {
  const ruw = { versie: '0.3', ruimtes: [{ id: 'R1', naam: 'T', werkzone: ['O', 'Q'], wanden: [{ id: 'N', maten: { lengte: { staat: 'bijna', waarde: '5.760', bron: 'laser' }, anders: { staat: 'later', waarde: 'veel' } } }] }] };
  const { opname, meldingen } = K.lees(ruw), r = opname.ruimtes[0], m = r.wanden[0].maten;
  assert.strictEqual(m.lengte.staat, 'open'); assert.strictEqual(m.lengte._staat_oud, 'bijna'); assert.strictEqual(m.lengte.bron, null); assert.strictEqual(m.lengte._bron_oud, 'laser');
  assert.strictEqual(m.anders.waarde, null); assert.strictEqual(m.anders._waarde_oud, 'veel'); assert.strictEqual(m.anders.staat, 'later');
  assert.deepStrictEqual(r.werkzone, ['O']); assert.deepStrictEqual(r._onbekend.werkzone, ['Q']); assert.ok(meldingen.length >= 3);
});
test('lezen: een voorstel met de oude namen (waarde, pm) krijgt schatting_mm en onzekerheid_mm erbij', () => {
  const { opname } = K.lees({ versie: '0.3', ruimtes: [{ id: 'R1', naam: 'T', wanden: [{ id: 'N', maten: { lengte: { staat: 'open', waarde: null, bron: null, tijd: null, voorstel: { waarde: 5700, pm: 30, bron: 'foto-voorstel' } } } }] }] });
  assert.deepStrictEqual(opname.ruimtes[0].wanden[0].maten.lengte.voorstel, { waarde: 5700, pm: 30, bron: 'foto-voorstel', schatting_mm: 5700, onzekerheid_mm: 30 }, 'de oude velden blijven staan');
});
test('lezen: v0.2 en onbekende vormen worden nooit weggegooid, het origineel staat in _oud', () => {
  const v02 = { schema: 'mt-opname', schema_versie: '0.2.0', opname_id: 'OPN-2026-11-0001', project_nr: 'TEST-002', ruimte: 'Woonkamer', maten: [{ id: 'M1', waarde_mm: 4012 }], punten: [{ id: 'P1', type: 'wcd' }] };
  const { opname, meldingen, alleenLezen } = K.lees(v02);
  assert.strictEqual(opname.versie, K.VERSIE); assert.strictEqual(opname.opname_id, 'OPN-2026-11-0001'); assert.strictEqual(opname.project.code, 'TEST-002'); assert.strictEqual(opname.ruimtes[0].naam, 'Woonkamer'); assert.strictEqual(alleenLezen, false);
  assert.deepStrictEqual(opname._oud, Object.assign({ versie: '0.2.0' }, v02), 'het volledige origineel blijft bewaard'); assert.ok(/niet automatisch omgezet/.test(meldingen[0]));
  const onbekend = { iets: 'anders', lijst: [1, 2, 3] }; const o = K.lees(onbekend);
  assert.deepStrictEqual(o.opname._oud, Object.assign({ versie: 'onbekend' }, onbekend)); assert.strictEqual(K.lees({ versie: 'abc', x: 1 }).opname._oud.x, 1);
  assert.strictEqual(K.lees({ ruimtes: [{ id: 'R1', naam: 'Zonder versie' }] }).opname.versie, K.VERSIE);
  assert.deepStrictEqual(K.lees({ ruimtes: [{ id: 'R1', naam: 'Zonder versie' }] }).meldingen, ['Versie ontbrak: gelezen als ' + K.VERSIE + '.']);
});
test('lezen: een nieuwere versie wordt alleen gelezen, nooit omgezet; rommel geeft geen fout', () => {
  const nw = { versie: '0.5', ruimtes: [{ id: 'R1', nieuw_model: { x: 1 } }], onbekend: true }, a = K.lees(nw);
  assert.strictEqual(a.alleenLezen, true); assert.deepStrictEqual(a.opname, nw); assert.notStrictEqual(a.opname, nw); assert.strictEqual(K.lees({ versie: '1.0' }).alleenLezen, true);
  assert.strictEqual(K.lees({ versie: '0.3.1', ruimtes: [] }).alleenLezen, false, 'een patchversie blijft leesbaar');
  for (const rommel of [null, undefined, 5, 'tekst', [], true]) { const r = K.lees(rommel); assert.strictEqual(r.opname, null); assert.strictEqual(r.alleenLezen, true); assert.deepStrictEqual(r.origineel, rommel === undefined ? null : rommel); }
  const heel = K.lees({ versie: '0.3', project: 'tekst', ruimtes: [null, 7, { naam: 'Zonder id' }] }); assert.strictEqual(heel.opname._project_oud, 'tekst'); assert.strictEqual(heel.opname.ruimtes.length, 3);
  assert.deepStrictEqual(heel.opname.ruimtes.map(r => r.id), ['R1', 'R2', 'R3']); assert.deepStrictEqual(heel.opname.ruimtes[0]._oud, null);
});
test('gelezen opnames werken met alle functies (ook een leeg gelezen ruimte)', () => {
  const { opname } = K.lees({ versie: '0.3', ruimtes: [{ id: 'R1', naam: 'Minimaal' }] });
  assert.strictEqual(K.tellers(opname.ruimtes[0]).basis.n, 10); assert.strictEqual(K.vrijgeefCheck(opname).kan, false); assert.deepStrictEqual(K.takenlijst(opname), []); assert.ok(K.route(opname.ruimtes[0]).stappen.length > 0);
  const r = K.zetMaat(opname, 'R1', 'wanden.N.maten.lengte', { staat: 'gemeten', waarde: 4000 }, T0); assert.strictEqual(r.fout, null);
});
test('het voorbeeld uit docs/opname-json-v0.3.md bestaat en is leesbaar', () => {
  const fs = require('fs'), tekst = fs.readFileSync(require('path').join(__dirname, '..', 'docs', 'opname-json-v0.3.md'), 'utf8');
  const m = /```json\r?\n([\s\S]*?)\r?\n```/.exec(tekst); assert.ok(m, 'een json-blok in de documentatie');
  const voorbeeld = JSON.parse(m[1]), r = K.lees(voorbeeld);
  assert.deepStrictEqual(r.meldingen, [], 'het voorbeeld is al volledig v0.3');
  // migratie van v0.3 naar v0.4 is additief: alleen de versie verschuift (het origineel staat in _versie_oud), verder verandert er niets
  const g = kopie(r.opname); assert.strictEqual(g.versie, K.VERSIE); assert.strictEqual(g._versie_oud, '0.3'); g.versie = '0.3'; delete g._versie_oud;
  assert.deepStrictEqual(g, voorbeeld, 'lezen verandert het voorbeeld niet');
  const t = K.tellers(r.opname.ruimtes[0]); assert.strictEqual(t.basis.n, 17); assert.strictEqual(t.werkzone.n, 25);
  assert.ok(K.vrijgeefCheck(r.opname).kan === false); assert.strictEqual(K.effectieveStatus(r.opname), 'concept');
});
console.log('\n' + n + ' tests geslaagd' + (process.exitCode ? ' (met fouten)' : ''));
