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
  assert.deepStrictEqual(t.netto, [20000, 100050 - 30025 - 5000, -15000 - 70000]); assert.strictEqual(t.later.binnen, 4000);
  const zonderK = F.totalen({ rijen, events: ev, vandaag: V, maanden: 3, kostenAan: false }); assert.deepStrictEqual(zonderK.netto, [20000, 100050 - 5000, -70000]);
  const zonderBeide = F.totalen({ rijen, events: ev, vandaag: V, maanden: 3, kostenAan: false, overigAan: false }); assert.deepStrictEqual(zonderBeide.netto, [20000, 100050, 0]);
  assert.strictEqual(zonderBeide.later.netto, 4000);
});
test('totalen: gepland telt eerder en later van rijen die meetellen', () => {
  const r = [{ aan: true, eerderC: 300, laterC: 700, maanden: [{ vrijC: 0, vastOpenC: 0 }] }];
  const t = F.totalen({ rijen: r, events: [], vandaag: V, maanden: 1 }); assert.strictEqual(t.eerder.gepland, 300); assert.strictEqual(t.later.gepland, 700);
});
test('12 maanden over de jaargrens', () => {
  const r = F.bouwRijen({ schatten: [schat('300000000007', 'Eta', 100)], items: {}, posten: [], projecten: [], vandaag: '2026-11-30', maanden: 12 })[0];
  assert.strictEqual(r.maanden.length, 12); assert.strictEqual(r.maanden[0].ym, '2026-11'); assert.strictEqual(r.maanden[2].ym, '2027-01'); assert.strictEqual(r.maanden[11].ym, '2027-10');
});

console.log(`\n${n} tests geslaagd${process.exitCode ? ' — er zijn fouten' : ''}`);
