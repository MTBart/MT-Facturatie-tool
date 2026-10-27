// Tests voor de rekenlogica van mt-forecast.js (tabblad Forecast). Draaien: node test/forecast-rekenen.test.js
// Alleen verzonnen namen en bedragen. De worker-validatie (geldPrognoseNorm) wordt uit worker.js gelezen, zodat elk item dat de
// Forecast opslaat ook echt door de worker wordt geaccepteerd.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const F = require(path.join(__dirname, '..', 'mt-forecast.js'));

// ── worker-validatie uit worker.js ──
const wsrc = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
const pak = (re) => { const m = wsrc.match(re); if (!m) throw new Error('niet gevonden in worker.js: ' + re); return m[0]; };
const wcode = [pak(/function geldDag\(s, n\) \{[^\n]*\n/), pak(/const geldIsDatum = [^\n]*\n/), pak(/const geldRond = [^\n]*\n/),
  wsrc.slice(wsrc.indexOf('function geldPrognoseNorm'), wsrc.indexOf('// Facturen voor de koppeling'))].join('\n');
const geldPrognoseNorm = new Function(wcode + '\nreturn geldPrognoseNorm;')();
const valideer = (sleutel, item, vandaag) => { const n = geldPrognoseNorm(sleutel, item, vandaag); assert.ok(!n.fout, 'worker weigert: ' + n.fout); assert.ok(new TextEncoder().encode(JSON.stringify(Object.assign({}, n.item, { door: 'Bart Test', ts: 1e13 }))).length <= 1000, 'item te groot'); return n.item; };
const somC = it => it.termijnen.reduce((a, t) => a + Math.round(t.bedrag * 100), 0);

let n = 0; const test = (naam, fn) => { try { fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };
const V = '2026-10-27';

test('parseBedrag: NL-notatie, duizendtallen, leeg en ongeldig', () => {
  assert.strictEqual(F.parseBedrag('1.500,50'), 150050); assert.strictEqual(F.parseBedrag('1500,5'), 150050); assert.strictEqual(F.parseBedrag('1500.50'), 150050);
  assert.strictEqual(F.parseBedrag('€ 2.500'), 250000); assert.strictEqual(F.parseBedrag('2500'), 250000); assert.strictEqual(F.parseBedrag(''), 0);
  assert.strictEqual(F.parseBedrag('0,07'), 7); assert.strictEqual(F.parseBedrag('-5'), null); assert.strictEqual(F.parseBedrag('abc'), null); assert.strictEqual(F.parseBedrag('1,234,5'), null);
});
test('fmt: hele euro zonder, anders met centen; negatief met minteken', () => {
  assert.strictEqual(F.fmt(150000), '1.500'); assert.strictEqual(F.fmt(150050), '1.500,50'); assert.strictEqual(F.fmt(-7), '−0,07'); assert.strictEqual(F.fmt(123456789), '1.234.567,89');
});
test('schatNorm: bedrag incl. btw in centen, naam uit contact', () => {
  const s = F.schatNorm({ id: 444888999777, estimate_id: '2026-0123', contact_id: 888999, reference: 'Keuken', total_price_incl_tax_base: '12100.00', contact: { company_name: 'Voorbeeld BV' } });
  assert.deepStrictEqual(s, { id: '444888999777', nummer: '2026-0123', naam: 'Voorbeeld BV', ref: 'Keuken', contact_id: '888999', totaalC: 1210000 });
  assert.strictEqual(F.schatNorm({ id: 1, total_price_incl_tax: '0' }), null); assert.strictEqual(F.schatNorm(null), null);
});

const schat = (id, naam, totaal) => ({ id, nummer: '2026-' + id.slice(-3), naam, ref: '', contact_id: '777888', totaalC: Math.round(totaal * 100) });

test('bouwRijen: koppeling via estimate_id, via project, anders eigen sleutel; extra prognose-project', () => {
  const items = { 'p:abc': { soort: 'project', naam: 'Eerste', estimate_id: '300000000001', totaal: 1000, aan: true, termijnen: [{ id: 't1', label: 'a', bedrag: 1000, factuurdatum: '2026-11-10', aan: true }] },
    'p:zzz': { soort: 'project', naam: 'Zonder offerte', totaal: 500, aan: true, termijnen: [{ id: 't1', label: 'a', bedrag: 500, factuurdatum: '2026-12-01', aan: true }] },
    'h:abcd1234': { soort: 'post', omschrijving: 'x', richting: 'uit', bedrag: 5, datum: V, aan: true } };
  const rijen = F.bouwRijen({ schatten: [schat('300000000001', 'Alfa', 1000), schat('300000000002', 'Beta', 2000), schat('300000000003', 'Gamma', 3000)], items, posten: [], projecten: [{ project_id: 'prj1', label: 'Project Beta', code: 'BET-1', offerte_mb_id: '300000000002' }], vandaag: V, maanden: 6 });
  const sl = rijen.map(r => r.sleutel);
  assert.deepStrictEqual(sl, ['p:abc', 'p:prj1', 'p:e300000000003', 'p:zzz']);
  assert.strictEqual(rijen[1].naam, 'Project Beta'); assert.strictEqual(rijen[1].bestaat, false); assert.strictEqual(rijen[1].nogC, 200000);
  assert.strictEqual(rijen[0].aan, true); assert.strictEqual(rijen[0].geplandC, 100000); assert.strictEqual(rijen[0].nogC, 0);
  assert.strictEqual(rijen[3].extra, true);
  assert.strictEqual(rijen[0].maanden[1].ym, '2026-11'); assert.strictEqual(rijen[0].maanden[1].vrijC, 100000);
});
test('bouwRijen: project met item voor een andere offerte krijgt eigen sleutel; afwijkend totaal wordt gemeld', () => {
  const items = { 'p:prj1': { soort: 'project', naam: 'X', estimate_id: '300000000009', totaal: 900, aan: true, termijnen: [{ id: 't1', label: 'a', bedrag: 900, factuurdatum: '2026-11-10', aan: true }] },
    'p:e300000000004': { soort: 'project', naam: 'Y', estimate_id: '300000000004', totaal: 1000, aan: true, termijnen: [{ id: 't1', label: 'a', bedrag: 1000, factuurdatum: '2026-11-10', aan: true }] } };
  const rijen = F.bouwRijen({ schatten: [schat('300000000004', 'Delta', 1200)], items, posten: [], projecten: [{ project_id: 'prj1', label: 'P', offerte_mb_id: '300000000004' }], vandaag: V, maanden: 6 });
  assert.strictEqual(rijen[0].sleutel, 'p:e300000000004'); assert.strictEqual(rijen[0].afwijkt, true); assert.strictEqual(rijen[0].totaalC, 100000);
});

// nieuwe rij zonder item → nieuw item → plannen
const rij0 = { naam: 'Alfa — keuken', offertenr: '2026-001', code: '', estimateId: '300000000001', contactId: '777888', totaalC: 1000000 };   // 10.000,00
test('nieuwItem is geldig voor de worker en telt op tot het totaal', () => {
  const it = F.nieuwItem(rij0, 14, V); valideer('p:e300000000001', it, V); assert.strictEqual(somC(it), 1000000);
  assert.strictEqual(it.termijnen[0].aan, false);
});
test('zetCel: plannen in delen; som blijft het totaal; rest is uitgeschakeld; worker accepteert', () => {
  let it = F.nieuwItem(rij0, 14, V);
  it = F.zetCel(it, null, '2026-11', 300000, V).item; it = F.zetCel(it, null, '2027-01', 250050, V).item;
  assert.strictEqual(somC(it), 1000000); valideer('p:e300000000001', it, V);
  const open = it.termijnen.filter(t => t.aan), rest = it.termijnen.filter(t => !t.aan);
  assert.deepStrictEqual(open.map(t => [t.factuurdatum.slice(0, 7), t.bedrag]), [['2026-11', 3000], ['2027-01', 2500.5]]);
  assert.strictEqual(rest.length, 1); assert.strictEqual(rest[0].bedrag, 4499.5); assert.strictEqual(rest[0].label, 'nog niet gepland');
  assert.strictEqual(it.aan, true);
});
test('zetCel: zelfde maand opnieuw zetten vervangt (geen dubbele termijn), 0 haalt hem weg', () => {
  let it = F.nieuwItem(rij0, 14, V);
  it = F.zetCel(it, null, '2026-12', 100000, V).item; it = F.zetCel(it, null, '2026-12', 400000, V).item;
  assert.strictEqual(it.termijnen.filter(t => t.aan).length, 1); assert.strictEqual(it.termijnen.filter(t => t.aan)[0].bedrag, 4000);
  it = F.zetCel(it, null, '2026-12', 0, V).item; assert.strictEqual(it.termijnen.filter(t => t.aan).length, 0);
  assert.strictEqual(it.termijnen.length, 1); assert.strictEqual(it.termijnen[0].bedrag, 10000); valideer('p:e300000000001', it, V);
});
test('zetCel: precies het hele bedrag geeft geen rest-termijn; meer dan het totaal wordt geweigerd', () => {
  let it = F.nieuwItem(rij0, 14, V);
  const vol = F.zetCel(it, null, '2026-11', 1000000, V); assert.strictEqual(vol.item.termijnen.length, 1); assert.strictEqual(vol.item.termijnen[0].aan, true); valideer('p:e300000000001', vol.item, V);
  const te = F.zetCel(it, null, '2026-11', 1000001, V); assert.ok(te.fout && /meer dan het offertebedrag/.test(te.fout)); assert.ok(!te.item);
  assert.ok(F.zetCel(it, null, '2026-11', -1, V).fout);
});
test('centen: drie keer 33,33 van 100,00 laat 0,01 rest, geen float-fout', () => {
  const r = { naam: 'Klein', estimateId: '300000000005', contactId: '777888', totaalC: 10000 };
  let it = F.nieuwItem(r, 14, V);
  for (const m of ['2026-11', '2026-12', '2027-01']) it = F.zetCel(it, null, m, 3333, V).item;
  assert.strictEqual(somC(it), 10000); assert.strictEqual(it.termijnen.find(t => !t.aan).bedrag, 0.01); valideer('p:e300000000005', it, V);
  // en 0,1 + 0,2 style bedragen: 3 x 0,10 van 0,30
  let k = F.nieuwItem({ naam: 'k', totaalC: 30 }, 14, V); k = F.zetCel(k, null, '2026-11', 10, V).item; k = F.zetCel(k, null, '2026-12', 10, V).item; k = F.zetCel(k, null, '2027-01', 10, V).item;
  assert.strictEqual(somC(k), 30); assert.strictEqual(k.termijnen.length, 3);
});
test('zetCel: lopende maand nooit vóór vandaag; andere maanden de 15e', () => {
  const it = F.zetCel(F.nieuwItem(rij0, 14, V), null, '2026-10', 100000, V).item;
  assert.strictEqual(it.termijnen.find(t => t.aan).factuurdatum, V);
  const it2 = F.zetCel(F.nieuwItem(rij0, 14, V), null, '2026-11', 100000, V).item; assert.strictEqual(it2.termijnen.find(t => t.aan).factuurdatum, '2026-11-15');
});
test('maximaal 6 termijnen: 5 gepland + rest mag, de zesde geplande niet zolang er rest is', () => {
  let it = F.nieuwItem(rij0, 14, V);
  for (const m of ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03']) it = F.zetCel(it, null, m, 100000, V).item;
  assert.strictEqual(it.termijnen.length, 6); valideer('p:e300000000001', it, V);
  const zes = F.zetCel(it, null, '2027-04', 100000, V); assert.ok(zes.fout && /hoogstens 6/.test(zes.fout));
  const alles = F.zetCel(it, null, '2027-04', 500000, V); assert.ok(alles.item && alles.item.termijnen.length === 6 && !alles.item.termijnen.some(t => !t.aan));   // alles gepland: de rest-termijn verdwijnt, dus 6 delen
  const vol = F.zetCel(it, null, '2027-03', 600000, V); assert.ok(vol.item, 'bestaande maand ophogen mag'); assert.strictEqual(somC(vol.item), 1000000);
});

// gefactureerde termijnen (overzicht uit de tijdlijn)
const itemVast = () => ({ soort: 'project', naam: 'Vast', estimate_id: '300000000006', totaal: 6000, aan: true, betaaltermijn: 14, k: [], x: [],
  termijnen: [{ id: 't1', label: 'aanbetaling', bedrag: 3000, factuurdatum: '2026-10-05', aan: true }, { id: 't2', label: 'oplevering', bedrag: 3000, factuurdatum: '2026-12-10', aan: true }] });
const ovVast = { sleutel: 'p:vast', soort: 'project', gefactureerd: 3000, termijnen: [{ id: 't1', bedrag: 3000, gefactureerd: 3000, open: 0, factuurdatum: '2026-10-05', aan: true }, { id: 't2', bedrag: 3000, gefactureerd: 0, open: 3000, factuurdatum: '2026-12-10', aan: true }] };
test('gefactureerde termijn is vast: niet te wijzigen, wel zichtbaar, telt niet als nog te factureren', () => {
  const rijen = F.bouwRijen({ schatten: [], items: { 'p:vast': itemVast() }, posten: [ovVast], projecten: [], vandaag: V, maanden: 6 });
  const r = rijen[0]; assert.strictEqual(r.gefC, 300000); assert.strictEqual(r.maanden[0].vastGefC, 300000); assert.strictEqual(r.maanden[0].vrijC, 0); assert.strictEqual(r.maanden[2].vrijC, 300000); assert.strictEqual(r.nogC, 0);
  const res = F.zetCel(itemVast(), ovVast, '2026-10', 0, V).item;           // in de maand van de vaste termijn: die blijft staan
  const t1 = res.termijnen.find(t => t.id === 't1'); assert.strictEqual(t1.bedrag, 3000); assert.strictEqual(t1.factuurdatum, '2026-10-05');
  assert.strictEqual(somC(res), 600000); valideer('p:vast', res, V);
  const weg = F.zetCel(itemVast(), ovVast, '2026-12', 0, V).item;            // vrije termijn wissen → rest 3000 niet gepland
  assert.deepStrictEqual(weg.termijnen.map(t => [t.id, t.aan, t.bedrag]), [['t1', true, 3000], ['t2', false, 3000]]); valideer('p:vast', weg, V);
});
test('meer plannen dan er na het gefactureerde deel over is wordt geweigerd', () => {
  const r = F.zetCel(itemVast(), ovVast, '2026-12', 350000, V); assert.ok(r.fout);
});
test('deels gefactureerde termijn: vast, open deel telt als gepland', () => {
  const it = itemVast(), ov = JSON.parse(JSON.stringify(ovVast)); ov.termijnen[1].gefactureerd = 1000; ov.termijnen[1].open = 2000;
  const r = F.bouwRijen({ schatten: [], items: { 'p:vast': it }, posten: [ov], projecten: [], vandaag: V, maanden: 6 })[0];
  assert.strictEqual(r.maanden[2].vastGefC, 100000); assert.strictEqual(r.maanden[2].vastOpenC, 200000); assert.strictEqual(r.maanden[2].vrijC, 0);
});
test('eerderNaarNu: open termijn van vóór deze maand gaat naar vandaag, gefactureerde blijft', () => {
  const it = itemVast(); it.termijnen[1].factuurdatum = '2026-09-20';
  const ov = JSON.parse(JSON.stringify(ovVast)); ov.termijnen[1].factuurdatum = '2026-09-20';
  const r = F.bouwRijen({ schatten: [], items: { 'p:vast': it }, posten: [ov], projecten: [], vandaag: V, maanden: 6 })[0]; assert.strictEqual(r.eerderC, 300000);
  const res = F.eerderNaarNu(it, ov, V).item; assert.strictEqual(res.termijnen.find(t => t.id === 't2').factuurdatum, V); assert.strictEqual(res.termijnen.find(t => t.id === 't1').factuurdatum, '2026-10-05');
});
test('restHier: vrije cel + nog niet gepland; null als alles gepland is', () => {
  let it = F.nieuwItem(rij0, 14, V); it = F.zetCel(it, null, '2026-11', 250000, V).item;
  const r = F.bouwRijen({ schatten: [], items: { 'p:x': it }, posten: [], projecten: [], vandaag: V, maanden: 6 })[0];
  assert.strictEqual(r.nogC, 750000); assert.strictEqual(F.restHier(r, '2026-12'), 750000); assert.strictEqual(F.restHier(r, '2026-11'), 1000000);
  const vol = F.zetCel(it, null, '2026-12', F.restHier(r, '2026-12'), V).item;
  const r2 = F.bouwRijen({ schatten: [], items: { 'p:x': vol }, posten: [], projecten: [], vandaag: V, maanden: 6 })[0]; assert.strictEqual(r2.nogC, 0); assert.strictEqual(F.restHier(r2, '2027-01'), null);
});
test('zetAan: alleen het vinkje, termijnen blijven; ts en door worden niet teruggestuurd', () => {
  const it = Object.assign(itemVast(), { ts: 5, door: 'X' }); const r = F.zetAan(it, false).item;
  assert.strictEqual(r.aan, false); assert.strictEqual(r.ts, undefined); assert.strictEqual(r.door, undefined); assert.strictEqual(r.termijnen.length, 2);
  const rij = F.bouwRijen({ schatten: [schat('300000000006', 'Zeta', 6000)], items: { 'p:q': Object.assign({}, r, { estimate_id: '300000000006' }) }, posten: [], projecten: [], vandaag: V, maanden: 6 })[0];
  assert.strictEqual(rij.aan, false);
});

test('totalen: binnen/kosten/overig per maand, klem op vandaag, later-bucket, netto met en zonder vinkjes', () => {
  const rijen = [{ aan: true, eerderC: 0, laterC: 0, maanden: [{ vrijC: 100000, vastOpenC: 0 }, { vrijC: 200000, vastOpenC: 5000 }, { vrijC: 0, vastOpenC: 0 }] },
    { aan: false, eerderC: 7, laterC: 9, maanden: [{ vrijC: 999, vastOpenC: 0 }, { vrijC: 0, vastOpenC: 0 }, { vrijC: 0, vastOpenC: 0 }] }];
  const ev = [{ id: 'a', bron: 'prognose', termijn_id: 't1', datum: '2026-11-20', delta: 1000.5 }, { id: 'b', bron: 'prognose', termijn_id: 't2', datum: '2026-10-20', delta: 200 },   // verleden → vandaag (okt)
    { id: 'c', bron: 'inkoop', datum: '2026-11-05', delta: -300.25 }, { id: 'd', bron: 'patroon', datum: '2026-12-01', delta: -150 }, { id: 'e', bron: 'btw', datum: '2026-12-31', delta: -700 },
    { id: 'f', bron: 'prognose', datum: '2026-11-15', delta: -50 }, { id: 'g', bron: 'verkoop', datum: '2026-11-02', delta: 5000 }, { id: 'h', bron: 'bank', datum: '2026-10-01', delta: -9 },
    { id: 'i', bron: 'btw-sparen', intern: true, datum: '2026-11-03', delta: -100 }, { id: 'j', bron: 'prognose', termijn_id: 't1', datum: '2027-06-01', delta: 40 }];
  const t = F.totalen({ rijen, events: ev, vandaag: V, maanden: 3 });
  assert.deepStrictEqual(t.maanden, ['2026-10', '2026-11', '2026-12']);
  assert.deepStrictEqual(t.gepland, [100000, 205000, 0]); assert.strictEqual(t.eerder.gepland, 0); assert.strictEqual(t.later.gepland, 0);   // rij 2 staat uit
  assert.deepStrictEqual(t.binnen, [20000, 100050, 0]); assert.deepStrictEqual(t.kosten, [0, -30025, -15000]); assert.deepStrictEqual(t.overig, [0, -5000, -70000]);
  assert.deepStrictEqual(t.open, [0, 500000, 0]);                                             // de openstaande verkoopfactuur (g) staat apart van Binnen
  assert.deepStrictEqual(t.netto, [20000, 100050 + 500000 - 30025 - 5000, -15000 - 70000]); assert.strictEqual(t.later.binnen, 4000);
  const zonderK = F.totalen({ rijen, events: ev, vandaag: V, maanden: 3, kostenAan: false }); assert.deepStrictEqual(zonderK.netto, [20000, 100050 + 500000 - 5000, -70000]);
  const zonderBeide = F.totalen({ rijen, events: ev, vandaag: V, maanden: 3, kostenAan: false, overigAan: false, openAan: false }); assert.deepStrictEqual(zonderBeide.netto, [20000, 100050, 0]);
  assert.strictEqual(zonderBeide.later.netto, 4000);
});
test('totalen: openstaande facturen per verwachte betaalmaand, klem op vandaag, later, creditnota, vinkje, bank/intern telt niet', () => {
  const ev = [{ id: 'v1', bron: 'verkoop', datum: '2026-09-01', delta: 1000 },                // achterstallig: vandaag (lopende maand)
    { id: 'v2', bron: 'verkoop', datum: '2026-12-10', delta: 2500.5 }, { id: 'v3', bron: 'verkoop', datum: '2026-12-20', delta: -100.25 },   // creditnota trekt af
    { id: 'v4', bron: 'verkoop', datum: '2027-08-01', delta: 700 }, { id: 'v5', bron: 'verkoop', telt_niet: { soort: 'concept' }, bedrag: 999, datum: '2026-11-01' },   // zonder delta: telt niet
    { id: 'v6', bron: 'verkoop', intern: true, datum: '2026-11-01', delta: 50 }, { id: 'b1', bron: 'bank', datum: '2026-10-02', delta: 123 }];
  const t = F.totalen({ rijen: [], events: ev, vandaag: V, maanden: 3 });
  assert.deepStrictEqual(t.open, [100000, 0, 240025]); assert.strictEqual(t.later.open, 70000); assert.deepStrictEqual(t.netto, [100000, 0, 240025]); assert.strictEqual(t.later.netto, 70000);
  const uit = F.totalen({ rijen: [], events: ev, vandaag: V, maanden: 3, openAan: false }); assert.deepStrictEqual(uit.netto, [0, 0, 0]); assert.strictEqual(uit.later.netto, 0); assert.deepStrictEqual(uit.open, t.open);
  const eigen = F.totalen({ rijen: [], events: ev, vandaag: V, maanden: 3, effect: e => e.id === 'v2' ? 111 : 0 }); assert.deepStrictEqual(eigen.open, [0, 0, 111]);   // effect van de kaslijn (MTGeld.effect) gaat voor
});
test('totalen: gepland telt eerder en later van rijen die meetellen', () => {
  const r = [{ aan: true, eerderC: 300, laterC: 700, maanden: [{ vrijC: 0, vastOpenC: 0 }] }];
  const t = F.totalen({ rijen: r, events: [], vandaag: V, maanden: 1 }); assert.strictEqual(t.eerder.gepland, 300); assert.strictEqual(t.later.gepland, 700);
});
test('12 maanden over de jaargrens', () => {
  const r = F.bouwRijen({ schatten: [schat('300000000007', 'Eta', 100)], items: {}, posten: [], projecten: [], vandaag: '2026-11-30', maanden: 12 })[0];
  assert.strictEqual(r.maanden.length, 12); assert.strictEqual(r.maanden[0].ym, '2026-11'); assert.strictEqual(r.maanden[2].ym, '2027-01'); assert.strictEqual(r.maanden[11].ym, '2027-10');
});

// ── dubbele offertes, afwijkend totaal, creditnota's, paginering ──
const E1 = '300000000011', itm = (eid, o) => Object.assign({ soort: 'project', naam: 'Voorbeeld ' + eid.slice(-2), estimate_id: eid, totaal: 10000, aan: true, betaaltermijn: 14, k: [], x: [],
  termijnen: [{ id: 't1', label: 'a', bedrag: 4000, factuurdatum: '2026-11-10', aan: true }, { id: 't2', label: REST(), bedrag: 6000, factuurdatum: '2026-11-10', aan: false }] }, o || {});
function REST() { return 'nog niet gepland'; }
test('dubbele estimate_id: één rij, het andere actieve item staat als dubbel erbij en telt niet mee', () => {
  const items = { 'p:aaa': itm(E1), ['p:e' + E1]: itm(E1) };
  const rijen = F.bouwRijen({ schatten: [schat(E1, 'Dubbel', 10000)], items, posten: [], projecten: [], vandaag: V, maanden: 6 });
  assert.strictEqual(rijen.length, 1); assert.strictEqual(rijen[0].sleutel, 'p:aaa'); assert.deepStrictEqual(rijen[0].dubbelen.map(d => d.sleutel), ['p:e' + E1]);
  const ev = [{ id: 'a', bron: 'prognose', termijn_id: 't1', prognose: 'p:aaa', datum: '2026-12-01', delta: 4000 }, { id: 'b', bron: 'prognose', termijn_id: 't1', prognose: 'p:e' + E1, datum: '2026-12-01', delta: 4000 }];
  const t = F.totalen({ rijen, events: ev, vandaag: V, maanden: 3, uitgesloten: rijen[0].dubbelen.map(d => d.sleutel) }); assert.deepStrictEqual(t.binnen, [0, 0, 400000]);   // niet 800000
  assert.deepStrictEqual(F.totalen({ rijen, events: ev, vandaag: V, maanden: 3 }).binnen, [0, 0, 800000]);                                                          // zonder uitsluiting zou het dubbel zijn
  // het hoofd-item uitzetten: een inactief duplicaat wordt niet meer als dubbel gemeld
  const uit = Object.assign({}, items, { ['p:e' + E1]: Object.assign({}, items['p:e' + E1], { aan: false }) });
  assert.strictEqual(F.bouwRijen({ schatten: [schat(E1, 'Dubbel', 10000)], items: uit, posten: [], projecten: [], vandaag: V, maanden: 6 })[0].dubbelen.length, 0);
});
test('dubbel: het item van het gekoppelde project wint; gefactureerd item wint van een ander', () => {
  const items = { 'p:aaa': itm(E1), 'p:prj9': itm(E1) };
  const r1 = F.bouwRijen({ schatten: [schat(E1, 'X', 10000)], items, posten: [], projecten: [{ project_id: 'prj9', label: 'P9', offerte_mb_id: E1 }], vandaag: V, maanden: 6 });
  assert.strictEqual(r1[0].sleutel, 'p:prj9'); assert.deepStrictEqual(r1[0].dubbelen.map(d => d.sleutel), ['p:aaa']);
  const r2 = F.bouwRijen({ schatten: [schat(E1, 'X', 10000)], items, posten: [{ sleutel: 'p:aaa', soort: 'project', gefactureerd: 4000, termijnen: [] }], projecten: [], vandaag: V, maanden: 6 });
  assert.strictEqual(r2[0].sleutel, 'p:aaa');
});
test('dubbel uitzetten: aan:false, termijnen blijven (niet verwijderen)', () => {
  const r = F.zetAan(itm(E1), false).item; assert.strictEqual(r.aan, false); assert.strictEqual(r.termijnen.length, 2);
});
test('afwijkend Moneybird-totaal: rij geeft afwijkt + mbTotaalC; planning blijft op het oude totaal tot bijwerken', () => {
  const it = itm(E1, { totaal: 10000 });
  const r = F.bouwRijen({ schatten: [schat(E1, 'Afw', 12100)], items: { 'p:aaa': it }, posten: [], projecten: [], vandaag: V, maanden: 6 })[0];
  assert.strictEqual(r.afwijkt, true); assert.strictEqual(r.mbTotaalC, 1210000); assert.strictEqual(r.totaalC, 1000000);
});
test('bijwerkTotaal: verschil gaat in "nog niet gepland"; niets geplands verandert; worker accepteert', () => {
  const it = itm(E1, { totaal: 10000 });
  const r = F.bijwerkTotaal(it, null, 1210000, V).item;
  assert.strictEqual(r.totaal, 12100); assert.strictEqual(somC(r), 1210000); valideer('p:aaa', r, V);
  assert.strictEqual(r.termijnen.find(t => t.aan).bedrag, 4000); assert.strictEqual(r.termijnen.find(t => !t.aan).bedrag, 8100);
  // verhogen als er geen rest-termijn was (alles gepland)
  const vol = { soort: 'project', naam: 'V', estimate_id: E1, totaal: 4000, aan: true, betaaltermijn: 14, k: [], x: [], termijnen: [{ id: 't1', label: 'a', bedrag: 4000, factuurdatum: '2026-11-10', aan: true }] };
  const r2 = F.bijwerkTotaal(vol, null, 500000, V).item; assert.strictEqual(r2.termijnen.length, 2); assert.strictEqual(r2.termijnen.find(t => !t.aan).bedrag, 1000); assert.strictEqual(somC(r2), 500000);
});
test('bijwerkTotaal: lager dan gepland of gefactureerd wordt geblokkeerd met uitleg, nooit stil verlaagd', () => {
  const it = itm(E1, { totaal: 10000 });
  const lager = F.bijwerkTotaal(it, null, 300000, V); assert.ok(lager.fout && /niets stil verlaagd/.test(lager.fout) && !lager.item);
  const gelijk = F.bijwerkTotaal(it, null, 400000, V); assert.ok(gelijk.item && gelijk.item.termijnen.length === 1 && gelijk.item.termijnen[0].aan);   // precies de planning: rest verdwijnt
  const ov = { termijnen: [{ id: 't1', bedrag: 4000, gefactureerd: 4000, open: 0 }] };
  assert.ok(F.bijwerkTotaal(it, ov, 399999, V).fout);
  assert.ok(F.bijwerkTotaal(it, null, 0, V).fout);
});
test('creditnota: netto gefactureerd wordt niet op 0 geklemd; status gecrediteerd; volledig gecrediteerde termijn is niet meer vast', () => {
  const it = itm(E1, { totaal: 6000, termijnen: [{ id: 't1', label: 'a', bedrag: 3000, factuurdatum: '2026-10-05', aan: true }, { id: 't2', label: 'b', bedrag: 3000, factuurdatum: '2026-12-10', aan: true }] });
  // factuur van 3000 volledig gecrediteerd: de worker geeft dekking 0 (pool 0) — termijn t1 weer open en vrij
  const ovVol = { sleutel: 'p:aaa', soort: 'project', gefactureerd: 0, facturen: ['f1', 'c1'], termijnen: [{ id: 't1', bedrag: 3000, gefactureerd: 0, open: 3000 }, { id: 't2', bedrag: 3000, gefactureerd: 0, open: 3000 }] };
  const ev = [{ id: 'verkoop:c1', bron: 'verkoop', document_id: 'c1', delta: -3000, datum: '2026-11-20' }];
  const r0 = F.bouwRijen({ schatten: [], items: { 'p:aaa': it }, posten: [ovVol], projecten: [], events: ev, vandaag: V, maanden: 6 })[0];
  assert.strictEqual(r0.termijnen.find(t => t.id === 't1').vast, false); assert.strictEqual(r0.creditC, 300000); assert.strictEqual(r0.gecrediteerd, true); assert.strictEqual(r0.maanden[0].vrijC, 300000);
  // creditnota groter dan wat gefactureerd is: netto negatief wordt getoond (niet 0), de planning rekent met dekking 0
  const ovNeg = Object.assign({}, ovVol, { gefactureerd: -1000 });
  const r1 = F.bouwRijen({ schatten: [], items: { 'p:aaa': it }, posten: [ovNeg], projecten: [], events: ev, vandaag: V, maanden: 6 })[0];
  assert.strictEqual(r1.gefNettoC, -100000); assert.strictEqual(r1.gefC, 0); assert.strictEqual(r1.gecrediteerd, true); assert.strictEqual(r1.nogC, 0);
  // deels gecrediteerd: factuur 3000, credit 1000 → pool 2000: t1 deels gefactureerd, vast
  const ovDeel = { sleutel: 'p:aaa', soort: 'project', gefactureerd: 2000, facturen: ['f1', 'c1'], termijnen: [{ id: 't1', bedrag: 3000, gefactureerd: 2000, open: 1000 }, { id: 't2', bedrag: 3000, gefactureerd: 0, open: 3000 }] };
  const r2 = F.bouwRijen({ schatten: [], items: { 'p:aaa': it }, posten: [ovDeel], projecten: [], events: [{ id: 'x', bron: 'verkoop', document_id: 'c1', delta: -1000, datum: '2026-11-20' }], vandaag: V, maanden: 6 })[0];
  assert.strictEqual(r2.termijnen.find(t => t.id === 't1').vast, true); assert.strictEqual(r2.creditC, 100000); assert.strictEqual(r2.gefNettoC, 200000);
  // geen creditnota → niet gecrediteerd; credit van een niet-gekoppelde factuur telt niet mee
  const r3 = F.bouwRijen({ schatten: [], items: { 'p:aaa': it }, posten: [ovDeel], projecten: [], events: [{ id: 'y', bron: 'verkoop', document_id: 'andere', delta: -500, datum: '2026-11-20' }], vandaag: V, maanden: 6 })[0];
  assert.strictEqual(r3.creditC, 0); assert.strictEqual(r3.gecrediteerd, false);
});
// ── periodekeuze: eenheden, selectie vastklikken, groeperen ──
test('eenheden: kwartaal en jaar over de jaarwisseling; alle 25 maanden precies één keer gedekt; laatste blok afgekapt', () => {
  for (const nu of ['2026-10', '2026-11', '2026-12', '2027-01']) for (const e of F.EENHEDEN) {
    const l = F.eenheden(nu, e), alle = [].concat(...l.map(u => u.maanden));
    assert.strictEqual(alle.length, 25); assert.strictEqual(new Set(alle).size, 25); assert.strictEqual(l[0].van, 0); assert.strictEqual(l[l.length - 1].tot, 24);
    l.forEach((u, i) => { assert.strictEqual(u.maanden.length, u.tot - u.van + 1); if (i) assert.strictEqual(u.van, l[i - 1].tot + 1); });
  }
  assert.deepStrictEqual(F.eenheden('2026-11', 'kwartaal').slice(0, 3).map(u => [u.label, u.van, u.tot]), [['K4 2026', 0, 1], ['K1 2027', 2, 4], ['K2 2027', 5, 7]]);
  assert.deepStrictEqual(F.eenheden('2026-10', 'jaar').map(u => [u.label, u.van, u.tot]), [['2026', 0, 2], ['2027', 3, 14], ['2028', 15, 24]]);
  assert.deepStrictEqual(F.eenheden('2026-12', 'jaar').map(u => [u.label, u.van, u.tot]), [['2026', 0, 0], ['2027', 1, 12], ['2028', 13, 24]]);
  assert.strictEqual(F.eenheden('2026-10', 'maand')[3].label, 'jan 2027');
});
test('selectie: klik, greep slepen, verschuiven en vastklikken op de eenheid', () => {
  const L = F.eenheden('2026-10', 'kwartaal'), s = { eenheid: 'kwartaal', i0: 2, i1: 4 };
  assert.deepStrictEqual(F.selKies(s, L, 5), { eenheid: 'kwartaal', i0: 5, i1: 5 });
  assert.deepStrictEqual(F.selGreep(s, L, 'van', 0), { eenheid: 'kwartaal', i0: 0, i1: 4 });
  assert.deepStrictEqual(F.selGreep(s, L, 'van', 7), { eenheid: 'kwartaal', i0: 4, i1: 4 });          // grepen kruisen niet
  assert.deepStrictEqual(F.selGreep(s, L, 'tot', 1), { eenheid: 'kwartaal', i0: 2, i1: 2 });
  assert.deepStrictEqual(F.selGreep(s, L, 'tot', 99), { eenheid: 'kwartaal', i0: 2, i1: L.length - 1 });   // begrensd op het einde
  assert.deepStrictEqual(F.selVerschuif(s, L, 2), { eenheid: 'kwartaal', i0: 4, i1: 6 });
  assert.deepStrictEqual(F.selVerschuif(s, L, -9), { eenheid: 'kwartaal', i0: 0, i1: 2 });            // breedte blijft, tegen de rand gestopt
  assert.deepStrictEqual(F.selVerschuif(s, L, 99), { eenheid: 'kwartaal', i0: L.length - 3, i1: L.length - 1 });
  assert.deepStrictEqual(F.selNieuw(s, L, 6, 3), { eenheid: 'kwartaal', i0: 3, i1: 6 });
  assert.deepStrictEqual(F.selSchoon({ eenheid: 'jaar', i0: 9, i1: -3 }, F.eenheden('2026-10', 'jaar')), { eenheid: 'jaar', i0: 0, i1: 2 });
});
test('positie op het spoor klikt vast op het blok eronder (maand, kwartaal, jaar)', () => {
  const M = F.eenheden('2026-10', 'maand'), K = F.eenheden('2026-10', 'kwartaal'), J = F.eenheden('2026-10', 'jaar');
  assert.strictEqual(F.indexBijPositie(0, M), 0); assert.strictEqual(F.indexBijPositie(1, M), 24); assert.strictEqual(F.indexBijPositie(0.039, M), 0); assert.strictEqual(F.indexBijPositie(0.04, M), 1);
  assert.strictEqual(F.indexBijPositie(0.1, K), 0);                    // maand 2 → nog K4 2026
  assert.strictEqual(F.indexBijPositie(0.12, K), 1);                   // maand 3 → K1 2027
  assert.strictEqual(F.indexBijPositie(0.5, J), 1); assert.strictEqual(F.indexBijPositie(0.99, J), 2); assert.strictEqual(F.indexBijPositie(-5, J), 0); assert.strictEqual(F.indexBijPositie(9, J), 2);
});
test('eenheid wisselen: dezelfde maanden, vastgeklikt op de nieuwe blokken; bewaren en terugkrijgen', () => {
  const std = F.selStandaard(); assert.deepStrictEqual(std, { eenheid: 'maand', i0: 0, i1: 5 });
  assert.deepStrictEqual(F.selNaarEenheid(std, '2026-10', 'kwartaal'), { eenheid: 'kwartaal', i0: 0, i1: 1 });        // okt-dec en jan-mrt
  assert.deepStrictEqual(F.selNaarEenheid(std, '2026-10', 'jaar'), { eenheid: 'jaar', i0: 0, i1: 1 });                 // 2026 en 2027
  assert.deepStrictEqual(F.selNaarEenheid({ eenheid: 'kwartaal', i0: 2, i1: 2 }, '2026-10', 'maand'), { eenheid: 'maand', i0: 6, i1: 8 });
  assert.deepStrictEqual(F.selNaarEenheid({ eenheid: 'jaar', i0: 2, i1: 2 }, '2026-10', 'kwartaal'), { eenheid: 'kwartaal', i0: 5, i1: 8 });
  const s = { eenheid: 'kwartaal', i0: 1, i1: 3 }; assert.strictEqual(F.selTekst(s), 'kwartaal:1:3'); assert.deepStrictEqual(F.selLees('kwartaal:1:3', '2026-10'), s);
  assert.deepStrictEqual(F.selLees('rommel', '2026-10'), std); assert.deepStrictEqual(F.selLees(null, '2026-10'), std); assert.deepStrictEqual(F.selLees('jaar:7:9', '2026-10'), { eenheid: 'jaar', i0: 2, i1: 2 });
});
test('groeperen per kwartaal en jaar: centen exact, grenzen, jaarwisseling; alles na het bereik naar later', () => {
  const nu = '2026-11', maanden = Array.from({ length: 25 }, (_, i) => ({ vrijC: i % 2 ? 1 : 3, vastGefC: i === 1 ? 7 : 0, vastOpenC: i === 3 ? 5 : 0 }));
  const rij = { aan: true, eerderC: 0, laterC: 11, maanden };
  const ev = [];   // elke maand een prognose-ontvangst van 0,01 + een kostenpost van -0,03, plus een ontvangst ver na het bereik
  for (let i = 0; i < 25; i++) { const ym = F.maandPlus(nu, i); ev.push({ id: 'b' + i, bron: 'prognose', termijn_id: 't1', datum: ym + '-15', delta: 0.01 }, { id: 'k' + i, bron: 'patroon', datum: ym + '-16', delta: -0.03 }); }
  ev.push({ id: 'ver', bron: 'prognose', termijn_id: 't1', datum: '2030-01-10', delta: 0.07 });
  const tot = F.totalen({ rijen: [rij], events: ev, vandaag: '2026-11-27', maanden: 25 });
  const tel = (a, v, t) => a.slice(v, t + 1).reduce((x, y) => x + y, 0);
  for (const eenheid of ['kwartaal', 'jaar']) {
    const L = F.eenheden(nu, eenheid), g = F.groepeerTotalen(tot, F.kolommen(L, { i0: 0, i1: L.length - 1 }));
    L.forEach((u, i) => { assert.strictEqual(g.binnen[i], u.maanden.length); assert.strictEqual(g.kosten[i], -3 * u.maanden.length); assert.strictEqual(g.gepland[i], tel(tot.gepland, u.van, u.tot)); assert.strictEqual(g.netto[i], g.binnen[i] + g.kosten[i]); });
    assert.strictEqual(g.later.binnen, 7); assert.strictEqual(g.later.gepland, 11);                              // alleen wat buiten 25 maanden valt
    assert.strictEqual(g.binnen.reduce((a, b) => a + b, 0) + g.later.binnen, 25 + 7);                           // niets kwijt of dubbel
  }
  const K = F.eenheden(nu, 'kwartaal'), een = F.groepeerTotalen(tot, F.kolommen(K, { i0: 0, i1: 1 }));                // K4 2026 (2 mnd) + K1 2027 (3 mnd)
  assert.deepStrictEqual(een.binnen, [2, 3]); assert.strictEqual(een.later.binnen, (25 - 5) + 7); assert.strictEqual(een.later.kosten, -3 * 20);       // de rest gaat naar later
  assert.strictEqual(een.later.gepland, tel(tot.gepland, 5, 24) + 11);
  // rij per kolom en later per rij (centen)
  const L = F.eenheden(nu, 'kwartaal'), k0 = F.rijKolom(rij, L[0]);
  assert.deepStrictEqual(k0, { vrijC: 3 + 1, vastGefC: 7, vastOpenC: 0 }); assert.deepStrictEqual(F.rijKolom(rij, L[1]), { vrijC: 3 + 1 + 3, vastGefC: 0, vastOpenC: 5 });
  assert.strictEqual(F.rijLater(rij, F.kolommen(L, { i0: 0, i1: 1 })), 11 + maanden.slice(5).reduce((a, m) => a + m.vrijC + m.vastOpenC, 0));
});

let async_ = Promise.resolve();
const atest = (naam, fn) => { async_ = async_.then(async () => { try { await fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } }); };
const pagina = (totaal, per) => async p => { const start = (p - 1) * per; return Array.from({ length: Math.max(0, Math.min(per, totaal - start)) }, (_, i) => ({ id: start + i })); };
atest('pagineer: stopt bij een korte pagina; leest verder dan pagina 5 (501 offertes)', async () => {
  const r = await F.pagineer(pagina(501, 100), { max: 50, per: 100 }); assert.strictEqual(r.lijst.length, 501); assert.strictEqual(r.afgekapt, false);
});
atest('pagineer: exact 500 (laatste pagina vol) stopt bij de lege pagina daarna; precies 0 offertes geeft lege lijst', async () => {
  const r = await F.pagineer(pagina(500, 100), { max: 50, per: 100 }); assert.strictEqual(r.lijst.length, 500); assert.strictEqual(r.afgekapt, false);
  assert.deepStrictEqual(await F.pagineer(pagina(0, 100), { max: 50, per: 100 }), { lijst: [], afgekapt: false });
});
atest('pagineer: veiligheidsplafond geraakt = lijst afgekapt, en de fout van een pagina breekt de hele lijst (geen stille helft)', async () => {
  const r = await F.pagineer(pagina(10000, 100), { max: 3, per: 100 }); assert.strictEqual(r.lijst.length, 300); assert.strictEqual(r.afgekapt, true);
  const vol = await F.pagineer(pagina(300, 100), { max: 3, per: 100 }); assert.strictEqual(vol.afgekapt, false);   // precies het plafond maar niet meer
  await assert.rejects(F.pagineer(async p => { if (p === 2) throw new Error('HTTP 429'); return pagina(1000, 100)(p); }, { max: 50 }), /429/);
});
async_.then(() => console.log(`\n${n} tests geslaagd${process.exitCode ? ' — er zijn fouten' : ''}`));
