// Tests van de opname-rekenkern (mt-opname-kern.js), zonder DOM. Draaien: node test/opname-kern.test.js — verzonnen project en ruimtenaam (kamer Joe), geen persoonsgegevens.
// De maten van kamer Joe komen uit de meetproef (31-10); de tellers 21 basis en 16 werkzone (Oost) zijn die van het prototype.
'use strict';
const assert = require('assert');
const K = require('../mt-opname-kern.js');
let n = 0; const test = (naam, fn) => { try { fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };
const kopie = x => JSON.parse(JSON.stringify(x));

// ── Testdata: kamer Joe, 4 openingen, werkzone Oost ──
const T0 = '2026-11-01T09:00:00.000Z';
function joeRuimte(zone) {
  return K.nieuweRuimte({ id: 'R1', naam: 'Kamer Joe', meubeltype: 'kast', werkzone: zone || ['O'],
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
// Meet de vier wanden en de diagonalen van Joe: noord 5760, zuid 5762, oost 2900, west 2903.
function metWanden(op, extra) {
  op = meet(op, 'wanden.N.maten.lengte', 5760); op = meet(op, 'wanden.Z.maten.lengte', 5762); op = meet(op, 'wanden.O.maten.lengte', 2900); op = meet(op, 'wanden.W.maten.lengte', 2903);
  return op;
}
const VERWACHT = Math.round(Math.sqrt(5761 * 5761 + 2901.5 * 2901.5));                  // 6451
// Alles wat gevraagd wordt (ook de tweede diagonaal) gemeten, zodat er niets openstaat.
function allesGemeten(op, zone) {
  op = metWanden(op);
  for (const v of K.vragen(R(op))) {
    if (v.pad.startsWith('wanden.')) continue;
    if (v.pad.startsWith('diagonalen.')) op = meet(op, v.pad, VERWACHT + (v.pad.includes('.A.') ? 2 : -1));
    else if (v.eenheid === 'keuze') op = zet(op, v.pad, { staat: 'gemeten', keuze: v.keuzes[0], bron: 'hand' });
    else op = meet(op, v.pad, v.pad.startsWith('plafond') ? 2450 : 1000 + (v.pad.length % 7) * 10, 'hand');
  }
  return op;
}
const rondjeKlaar = (op, zone) => { let r = R(op); for (const w of zone) for (const [c] of K.RONDJE_CATEGORIEEN) r = K.zetRondje(r, w, c, c === 'water' || c === 'afw' ? 'afwezig' : 'aanwezig', T0).ruimte; const o = kopie(op); o.ruimtes[0] = r; return o; };
const redenCodes = c => c.redenen.map(x => x.code);

// ── Vragenlijst en tellers ──
test('kamer Joe, werkzone Oost: 21 basis en 16 werkzone, zoals het prototype', () => {
  const t = K.tellers(R(joe()));
  assert.strictEqual(t.basis.n, 21, 'basis: 4 wanden + plafond + diagonaal A + (3 ramen x 4) + (deur x 3)');
  assert.strictEqual(t.werkzone.n, 16, 'werkzone Oost: positie R3 tot rechterhoek + SC1 3 + SC2 3 + RAD2 3 + VB3 3 + PLO 3');
  assert.strictEqual(t.extra.n, 0); assert.strictEqual(t.optie.n, 1, 'tweede diagonaal is optioneel en telt niet mee');
  assert.strictEqual(t.basis.open, 21); assert.strictEqual(t.werkzone.open, 16);
});
test('de vragen zijn uniek, hebben tekst, een emmer en een bruikbare referentie', () => {
  const v = K.vragen(R(joe())), paden = v.map(x => x.pad);
  assert.strictEqual(new Set(paden).size, paden.length, 'paden zijn uniek');
  for (const x of v) { assert.ok(x.vraag && x.kort && x.pad, x.pad); assert.ok(['basis', 'optie', 'werkzone', 'extra'].includes(x.bucket), x.pad); assert.ok(['hoek', 'vloerpeil', 'zijkanten', 'boven-onder', 'opening', 'object'].includes(x.referentie), x.pad + ' ' + x.referentie); }
  assert.deepStrictEqual(v.slice(0, 4).map(x => x.pad), ['wanden.N.maten.lengte', 'wanden.O.maten.lengte', 'wanden.Z.maten.lengte', 'wanden.W.maten.lengte']);
  assert.ok(paden.includes('plafondpunten.P1.maten.hoogte') && paden.includes('diagonalen.A.maten.lengte'));
  const get = p => v.find(x => x.pad === p);
  assert.strictEqual(get('openingen.R1.maten.borstwering').referentie, 'vloerpeil'); assert.strictEqual(get('openingen.R2.maten.positie').referentie, 'opening', 'R2 wordt vanaf R1 gemeten (penant)');
  assert.strictEqual(get('openingen.R1.maten.breedte').definitie, 'muursparing'); assert.ok(/muursparing/.test(get('openingen.R1.maten.breedte').vraag));
  assert.ok(/noordwesthoek/.test(get('openingen.R1.maten.positie').vraag), 'linkerhoek van de noordwand is de noordwesthoek');
  assert.ok(/zuidoosthoek/.test(get('objecten.SC1.maten.afstand').vraag), 'object met een gekozen hoek');
  assert.ok(!paden.includes('openingen.D1.maten.borstwering'), 'een deur heeft geen borstwering');
});
test('werkzone Oost: precies de punten van het prototype (O7, SC1, SC2, RAD2, VB3, PLO)', () => {
  const z = K.vragen(R(joe())).filter(x => x.bucket === 'werkzone').map(x => x.pad);
  assert.deepStrictEqual(z.sort(), [
    'objecten.PLO.maten.dikte', 'objecten.PLO.maten.hoogte', 'objecten.PLO.maten.keuze',
    'objecten.RAD2.maten.breedte', 'objecten.RAD2.maten.hoogte', 'objecten.RAD2.maten.onderkant',
    'objecten.SC1.maten.afdek', 'objecten.SC1.maten.afstand', 'objecten.SC1.maten.hoogte',
    'objecten.SC2.maten.afdek', 'objecten.SC2.maten.afstand', 'objecten.SC2.maten.hoogte',
    'objecten.VB3.maten.diepte', 'objecten.VB3.maten.dikte', 'objecten.VB3.maten.overstek',
    'openingen.R3.maten.positie_rechts'].sort());
});
test('een ruimte zonder openingen heeft 6 basisvragen; zonder werkzone is er geen werkzonevraag', () => {
  const r = K.nieuweRuimte({ naam: 'Leeg' }), t = K.tellers(r);
  assert.strictEqual(t.basis.n, 6); assert.strictEqual(t.werkzone.n, 0);
  assert.strictEqual(K.tellers(joeRuimte([])).werkzone.n, 0);
});
test('andere werkzone of meer wanden geeft andere vragen; objecten buiten de werkzone worden niet gevraagd', () => {
  assert.strictEqual(K.tellers(joeRuimte(['N'])).werkzone.n, 8, 'RAD1 3 + PLN 3 + R1 en R2 tot rechterhoek');
  assert.strictEqual(K.tellers(joeRuimte(['O', 'N'])).werkzone.n, 24);
  assert.strictEqual(K.tellers(joeRuimte(['Z'])).werkzone.n, 3 + 3 + 1 * 1, 'SW1 3 + PLZ 3 + D1 tot rechterhoek');
  assert.ok(!K.vragen(joeRuimte(['O'])).some(x => x.pad.startsWith('objecten.SC3')), 'SC3 staat op de westwand, buiten de werkzone');
  assert.deepStrictEqual(K.tellers(joeRuimte(['O'])).gezien, { n: 7, bevestigd: 0 }, 'de 7 objecten buiten de werkzone zijn alleen gezien');
});
test('toch meten en zelf toegevoegde objecten komen bij Extra; bijzonderheid met een maat ook', () => {
  const r = joeRuimte(['O']); r.objecten.find(o => o.id === 'SC3').gezien = 'toch-meten';
  r.objecten.push({ id: 'X1', type: 'leiding', wand: 'W', eigen: true, maten: {} }, { id: 'X2', type: 'stopcontact', wand: 'O', eigen: true, maten: {} });
  r.plafondpunten.push({ id: 'P2', plaats: 'hoek NO', maten: {} }); r.bijzonderheden[0].maten.maat = K.nieuweMaat();
  const t = K.tellers(r);
  assert.strictEqual(t.extra.n, 3 + 3 + 1 + 1, 'SC3 3 + leiding X1 3 + plafondpunt P2 + maat bij de kabelgoot');
  assert.strictEqual(t.werkzone.n, 16 + 3, 'een zelf toegevoegd object op de werkzone-wand telt als werkzone (zoals in het prototype)');
  assert.deepStrictEqual(K.tellers(r).gezien, { n: 7, bevestigd: 1 }, 'toch meten is een bevestiging; het zelf toegevoegde X1 telt niet als gezien');
  r.objecten.find(o => o.id === 'SC4').gezien = 'klopt'; assert.strictEqual(K.tellers(r).gezien.bevestigd, 2);
});
test('een vensterbank zonder gekoppelde opening vraagt ook de hoogte', () => {
  const r = K.nieuweRuimte({ werkzone: ['W'], objecten: [{ id: 'V1', type: 'vensterbank', wand: 'W', maten: {} }] });
  assert.deepStrictEqual(K.vragen(r).filter(x => x.bucket === 'werkzone').map(x => x.pad.split('.').pop()), ['diepte', 'dikte', 'overstek', 'hoogte']);
});
test('tellers: later telt als beantwoord (x van n) maar niet als compleet; n.v.t. telt als compleet', () => {
  let op = joe();
  op = meet(op, 'wanden.N.maten.lengte', 5760); op = zet(op, 'wanden.O.maten.lengte', { staat: 'nvt', notitie: 'niet nodig' }); op = zet(op, 'wanden.Z.maten.lengte', { staat: 'later', notitie: 'ladder nodig' });
  const b = K.tellers(R(op)).basis;
  assert.deepStrictEqual([b.gemeten, b.nvt, b.later, b.open, b.n], [1, 1, 1, 18, 21]);
  assert.strictEqual(b.beantwoord, 3); assert.strictEqual(b.compleet, 2);
});
test('een foto-voorstel is nooit een meting: gemeten met bron foto-voorstel telt als open en geeft een waarschuwing', () => {
  const op = joe(); R(op).wanden.find(w => w.id === 'N').maten.lengte = { staat: 'gemeten', waarde: 5700, bron: 'foto-voorstel', tijd: T0 };
  assert.strictEqual(K.tellers(R(op)).basis.gemeten, 0); assert.strictEqual(K.tellers(R(op)).basis.open, 21);
  assert.strictEqual(K.waarde(R(op).wanden[0].maten.lengte), null);
  assert.ok(K.waarschuwingen(R(op)).some(w => w.code === 'meting-ongeldig'));
  assert.ok(K.zetMaat(op, 'R1', 'wanden.N.maten.lengte', { staat: 'gemeten', waarde: 5700, bron: 'foto-voorstel' }, T0).fout, 'ook zetMaat weigert het');
});
test('het grijze voorstel staat naast de meting en telt niet mee', () => {
  let op = joe(); op = K.zetVoorstel(op, 'R1', 'openingen.R3.maten.breedte', { waarde: 1215, pm: 25 }, T0).opname;
  let v = K.vragen(R(op)).find(x => x.pad === 'openingen.R3.maten.breedte');
  assert.strictEqual(v.staat, 'open'); assert.deepStrictEqual(v.voorstel, { waarde: 1215, bron: 'foto-voorstel', tijd: T0, pm: 25 });
  op = meet(op, 'openingen.R3.maten.breedte', 1221);
  v = K.vragen(R(op)).find(x => x.pad === 'openingen.R3.maten.breedte');
  assert.strictEqual(v.staat, 'gemeten'); assert.strictEqual(v.maat.waarde, 1221); assert.strictEqual(v.voorstel.waarde, 1215, 'het voorstel blijft bewaard');
  assert.ok(K.zetVoorstel(op, 'R1', 'openingen.R3.maten.breedte', { waarde: -3 }, T0).fout);
});

// ── Sluitcontrole ──
const checkVan = (r, id) => K.sluitcontrole(r).checks.find(c => c.id === id);
test('sluitcontrole: zonder maten wachten alle controles, zonder conflict', () => {
  const sc = K.sluitcontrole(R(joe()));
  assert.deepStrictEqual(sc.checks.map(c => c.id), ['tegenover-NZ', 'tegenover-WO', 'diagonaal-A']); assert.ok(sc.checks.every(c => c.status === 'wacht')); assert.strictEqual(sc.conflicten.length, 0);
});
test('sluitcontrole: tegenoverliggende wanden mogen 5 mm verschillen, 6 mm is een conflict', () => {
  let op = joe(); op = meet(op, 'wanden.N.maten.lengte', 5760); op = meet(op, 'wanden.Z.maten.lengte', 5765);
  assert.strictEqual(checkVan(R(op), 'tegenover-NZ').status, 'ok'); assert.strictEqual(checkVan(R(op), 'tegenover-NZ').verschil_mm, 5);
  op = meet(op, 'wanden.Z.maten.lengte', 5766);
  const c = checkVan(R(op), 'tegenover-NZ'); assert.strictEqual(c.status, 'conflict'); assert.deepStrictEqual(c.maten, ['wanden.N.maten.lengte', 'wanden.Z.maten.lengte']); assert.ok(/verschil 6 mm/.test(c.detail));
  assert.deepStrictEqual(K.conflictPaden(R(op)).sort(), ['wanden.N.maten.lengte', 'wanden.Z.maten.lengte']);
  const v = K.vragen(R(op)).find(x => x.pad === 'wanden.Z.maten.lengte'); assert.strictEqual(v.conflict, true); assert.strictEqual(v.staat, 'gemeten', 'een conflict wist de meting niet');
  assert.strictEqual(K.tellers(R(op)).basis.conflict, 2);
});
test('sluitcontrole: diagonaal tegen de verwachte waarde (10 mm), met gemiddelde wandlengtes', () => {
  const op = metWanden(joe()); assert.strictEqual(K.sluitcontrole(R(op)).verwacht_diagonaal_mm, VERWACHT, 'verwacht uit het gemiddelde van de tegenoverliggende wanden');
  let a = meet(op, 'diagonalen.A.maten.lengte', VERWACHT + 10); assert.strictEqual(checkVan(R(a), 'diagonaal-A').status, 'ok');
  a = meet(op, 'diagonalen.A.maten.lengte', VERWACHT + 11); const c = checkVan(R(a), 'diagonaal-A');
  assert.strictEqual(c.status, 'conflict'); assert.strictEqual(c.verschil_mm, 11); assert.deepStrictEqual(c.maten, ['diagonalen.A.maten.lengte']); assert.ok(/De app past niets aan/.test(c.detail));
  a = meet(op, 'diagonalen.A.maten.lengte', VERWACHT - 34); assert.strictEqual(K.sluitcontrole(R(a)).conflicten.length, 1, 'de demo van het prototype: 34 mm eraf geeft een conflict');
});
test('sluitcontrole: twee diagonalen onderling maximaal 6 mm; verwachting met een enkele wand van het paar', () => {
  let op = metWanden(joe()); op = meet(op, 'diagonalen.A.maten.lengte', VERWACHT); op = meet(op, 'diagonalen.B.maten.lengte', VERWACHT + 6);
  assert.strictEqual(checkVan(R(op), 'diagonalen-onderling').status, 'ok'); assert.ok(/haaks/.test(checkVan(R(op), 'diagonalen-onderling').detail));
  op = meet(op, 'diagonalen.B.maten.lengte', VERWACHT + 7);
  const c = checkVan(R(op), 'diagonalen-onderling'); assert.strictEqual(c.status, 'conflict'); assert.deepStrictEqual(c.maten, ['diagonalen.A.maten.lengte', 'diagonalen.B.maten.lengte']); assert.ok(/niet haaks/.test(c.detail));
  let e = K.nieuweRuimte({}); e = K.sluitcontrole(e); assert.strictEqual(e.verwacht_diagonaal_mm, null);
  let op2 = joe(); op2 = meet(op2, 'wanden.N.maten.lengte', 6000); op2 = meet(op2, 'wanden.O.maten.lengte', 3000);
  assert.strictEqual(K.sluitcontrole(R(op2)).verwacht_diagonaal_mm, Math.round(Math.sqrt(6000 * 6000 + 3000 * 3000)), 'één wand per paar volstaat voor de verwachting');
});
test('sluitcontrole: foto-voorstellen en n.v.t. tellen niet; de invoer blijft ongewijzigd', () => {
  let op = joe(); op = meet(op, 'wanden.N.maten.lengte', 5760); op = zet(op, 'wanden.Z.maten.lengte', { staat: 'nvt' });
  op = K.zetVoorstel(op, 'R1', 'wanden.Z.maten.lengte', { waarde: 5000 }, T0).opname;
  const voor = kopie(op); assert.strictEqual(checkVan(R(op), 'tegenover-NZ').status, 'wacht'); K.sluitcontrole(R(op)); K.vrijgeefCheck(op); K.vragen(R(op)); K.tellers(R(op)); K.takenlijst(op);
  assert.deepStrictEqual(op, voor, 'alleen lezen: geen enkele functie past zijn invoer aan');
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
  assert.strictEqual(c.kan, false); assert.deepStrictEqual(redenCodes(c).filter((x, i, a) => a.indexOf(x) === i), ['open', 'rondje']);
  assert.ok(c.redenen.some(x => x.bucket === 'basis' && x.aantal === 21)); assert.ok(c.redenen.some(x => x.code === 'rondje' && x.aantal === 6));
  const s = K.samenvatting(op); assert.strictEqual(s.kan_opslaan, true); assert.strictEqual(s.open, 37); assert.strictEqual(s.taken, 0);
  const zonder = K.vrijgeefCheck(joe([])); assert.ok(redenCodes(zonder).includes('werkzone'));
  assert.ok(redenCodes(K.vrijgeefCheck({ ruimtes: [] })).includes('geen-ruimte'));
});
test('vrijgeven: alles gemeten, werkzone gekozen, rondje gedaan, geen conflicten: kan', () => {
  const op = rondjeKlaar(allesGemeten(joe(), ['O']), ['O']), c = K.vrijgeefCheck(op);
  assert.deepStrictEqual(c.redenen, []); assert.strictEqual(c.kan, true);
  const t = K.tellers(R(op)); assert.strictEqual(t.basis.compleet, 21); assert.strictEqual(t.werkzone.compleet, 16); assert.strictEqual(t.optie.compleet, 1);
  assert.strictEqual(K.samenvatting(op).taken, 0);
});
test('vrijgeven: elk van de voorwaarden blokkeert apart', () => {
  const basis = rondjeKlaar(allesGemeten(joe(), ['O']), ['O']);
  const open = zet(basis, 'wanden.N.maten.lengte', { staat: 'open' });
  assert.deepStrictEqual(redenCodes(K.vrijgeefCheck(open)), ['open'], 'een punt weer op open');
  const later = zet(basis, 'objecten.SC1.maten.hoogte', { staat: 'later', notitie: 'ladder nodig' });
  assert.deepStrictEqual(redenCodes(K.vrijgeefCheck(later)), ['later'], 'later is niet compleet');
  const nvt = zet(basis, 'objecten.SC1.maten.hoogte', { staat: 'nvt', notitie: 'achter de kast, niet maatvast nodig' });
  assert.strictEqual(K.vrijgeefCheck(nvt).kan, true, 'n.v.t. is bewust weggeklikt en telt als afgehandeld');
  const conflict = meet(basis, 'wanden.N.maten.lengte', 5800);
  const cc = K.vrijgeefCheck(conflict); assert.ok(redenCodes(cc).length > 0 && redenCodes(cc).every(c => c === 'conflict'), 'alleen conflicten: noord 5800 tegen zuid 5762 (de diagonalen kloppen dan ook niet meer)');
  assert.ok(cc.redenen.some(x => x.id === 'tegenover-NZ'));
  const rondje = kopie(basis); delete rondje.ruimtes[0].rondje['O|plint'];
  assert.deepStrictEqual(redenCodes(K.vrijgeefCheck(rondje)), ['rondje']);
  const rl = kopie(basis); rl.ruimtes[0] = K.zetRondje(rl.ruimtes[0], 'O', 'plint', 'later', T0).ruimte;
  assert.deepStrictEqual(redenCodes(K.vrijgeefCheck(rl)), ['rondje-later'], 'rondje op later is bekeken, maar blokkeert');
  const zone = kopie(basis); zone.ruimtes[0].werkzone = [];
  assert.ok(redenCodes(K.vrijgeefCheck(zone)).includes('werkzone'));
  const extra = kopie(basis); extra.ruimtes[0].objecten.push({ id: 'X2', type: 'stopcontact', wand: 'W', eigen: true, maten: {} });
  assert.ok(redenCodes(K.vrijgeefCheck(extra)).includes('open'), 'ook een extra punt dat de opnemer zelf koos moet af');
  const lat = kopie(basis); lat.ruimtes[0].werkzone = ['O', 'N']; assert.ok(K.vrijgeefCheck(lat).redenen.length > 0, 'een extra werkzone-wand brengt nieuwe punten en een nieuw rondje');
});
test('vrijgeven: waarschuwingen blokkeren niet (definitie ontbreekt, onwaarschijnlijke maat)', () => {
  let op = rondjeKlaar(allesGemeten(joe(), ['O']), ['O']); delete R(op).openingen[0].definitie; op = meet(op, 'wanden.W.maten.lengte', 2903);
  const c = K.vrijgeefCheck(op); assert.strictEqual(c.kan, true); assert.ok(c.waarschuwingen.some(w => w.code === 'definitie-ontbreekt' && w.pad.startsWith('openingen.R1.')));
  const klein = meet(op, 'plafondpunten.P1.maten.hoogte', 245); assert.ok(K.waarschuwingen(R(klein)).some(w => w.code === 'onwaarschijnlijk'), '245 mm plafond: tikfout?');
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
  assert.strictEqual(K.samenvatting(o2).taken, 4); assert.strictEqual(K.samenvatting(o2).later, 3);
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
test('een keuze (plint blijft of gaat weg) is compleet met een geldige keuze, zonder waarde', () => {
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

// ── Veilig lezen en migreren ──
test('lezen: een v0.3-opname komt ongewijzigd terug, ook na tweemaal lezen', () => {
  let op = rondjeKlaar(allesGemeten(joe(), ['O']), ['O']); op = K.voegFotoToe(op, { bestand: 'oost-01.jpg', ruimte: 'R1', wand: 'O' }).opname;
  const a = K.lees(op); assert.deepStrictEqual(a.opname, op); assert.deepStrictEqual(a.meldingen, []); assert.strictEqual(a.alleenLezen, false);
  assert.deepStrictEqual(K.lees(a.opname).opname, op); assert.deepStrictEqual(K.lees(JSON.parse(JSON.stringify(op))).opname, op, 'ook via JSON');
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
test('lezen: v0.2 en onbekende vormen worden nooit weggegooid, het origineel staat in _oud', () => {
  const v02 = { schema: 'mt-opname', schema_versie: '0.2.0', opname_id: 'OPN-2026-11-0001', project_nr: 'TEST-002', ruimte: 'Woonkamer', maten: [{ id: 'M1', waarde_mm: 4012 }], punten: [{ id: 'P1', type: 'wcd' }] };
  const { opname, meldingen, alleenLezen } = K.lees(v02);
  assert.strictEqual(opname.versie, '0.3'); assert.strictEqual(opname.opname_id, 'OPN-2026-11-0001'); assert.strictEqual(opname.project.code, 'TEST-002'); assert.strictEqual(opname.ruimtes[0].naam, 'Woonkamer'); assert.strictEqual(alleenLezen, false);
  assert.deepStrictEqual(opname._oud, Object.assign({ versie: '0.2.0' }, v02), 'het volledige origineel blijft bewaard'); assert.ok(/niet automatisch omgezet/.test(meldingen[0]));
  const onbekend = { iets: 'anders', lijst: [1, 2, 3] }; const o = K.lees(onbekend);
  assert.deepStrictEqual(o.opname._oud, Object.assign({ versie: 'onbekend' }, onbekend)); assert.strictEqual(K.lees({ versie: 'abc', x: 1 }).opname._oud.x, 1);
  assert.strictEqual(K.lees({ ruimtes: [{ id: 'R1', naam: 'Zonder versie' }] }).opname.versie, '0.3');
  assert.deepStrictEqual(K.lees({ ruimtes: [{ id: 'R1', naam: 'Zonder versie' }] }).meldingen, ['Versie ontbrak: gelezen als 0.3.']);
});
test('lezen: een nieuwere versie wordt alleen gelezen, nooit omgezet; rommel geeft geen fout', () => {
  const nw = { versie: '0.4', ruimtes: [{ id: 'R1', nieuw_model: { x: 1 } }], onbekend: true }, a = K.lees(nw);
  assert.strictEqual(a.alleenLezen, true); assert.deepStrictEqual(a.opname, nw); assert.notStrictEqual(a.opname, nw); assert.strictEqual(K.lees({ versie: '1.0' }).alleenLezen, true);
  assert.strictEqual(K.lees({ versie: '0.3.1', ruimtes: [] }).alleenLezen, false, 'een patchversie blijft leesbaar');
  for (const rommel of [null, undefined, 5, 'tekst', [], true]) { const r = K.lees(rommel); assert.strictEqual(r.opname, null); assert.strictEqual(r.alleenLezen, true); assert.deepStrictEqual(r.origineel, rommel === undefined ? null : rommel); }
  const heel = K.lees({ versie: '0.3', project: 'tekst', ruimtes: [null, 7, { naam: 'Zonder id' }] }); assert.strictEqual(heel.opname._project_oud, 'tekst'); assert.strictEqual(heel.opname.ruimtes.length, 3);
  assert.deepStrictEqual(heel.opname.ruimtes.map(r => r.id), ['R1', 'R2', 'R3']); assert.deepStrictEqual(heel.opname.ruimtes[0]._oud, null);
});
test('gelezen opnames werken met alle functies (ook een leeg gelezen ruimte)', () => {
  const { opname } = K.lees({ versie: '0.3', ruimtes: [{ id: 'R1', naam: 'Minimaal' }] });
  assert.strictEqual(K.tellers(opname.ruimtes[0]).basis.n, 6); assert.strictEqual(K.vrijgeefCheck(opname).kan, false); assert.deepStrictEqual(K.takenlijst(opname), []);
  const r = K.zetMaat(opname, 'R1', 'wanden.N.maten.lengte', { staat: 'gemeten', waarde: 4000 }, T0); assert.strictEqual(r.fout, null);
});
test('het voorbeeld uit docs/opname-json-v0.3.md bestaat en is leesbaar', () => {
  const fs = require('fs'), tekst = fs.readFileSync(require('path').join(__dirname, '..', 'docs', 'opname-json-v0.3.md'), 'utf8');
  const m = /```json\n([\s\S]*?)\n```/.exec(tekst); assert.ok(m, 'een json-blok in de documentatie');
  const voorbeeld = JSON.parse(m[1]), r = K.lees(voorbeeld);
  assert.deepStrictEqual(r.meldingen, [], 'het voorbeeld is al volledig v0.3'); assert.deepStrictEqual(r.opname, voorbeeld, 'lezen verandert het voorbeeld niet');
  const t = K.tellers(r.opname.ruimtes[0]); assert.strictEqual(t.basis.n, 21); assert.strictEqual(t.werkzone.n, 16);
  assert.ok(K.vrijgeefCheck(r.opname).kan === false);
});
console.log('\n' + n + ' tests geslaagd' + (process.exitCode ? ' (met fouten)' : ''));
