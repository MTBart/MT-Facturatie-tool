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
  assert.deepStrictEqual(s, { id: '444888999777', nummer: '2026-0123', naam: 'Voorbeeld BV', ref: 'Keuken', contact_id: '888999', totaalC: 1210000, status: 'geaccepteerd' });
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

// ── percentages, schema's, statusfilter, labels ──
const E2 = '300000000021';
const leegItem = (o) => F.nieuwItem(Object.assign({ naam: 'Schema BV — kast', estimateId: E2, contactId: '700000000001', totaalC: 1000000, status: 'geaccepteerd' }, o || {}), 14, V);   // 10.000,00
test('percentage naar centen: afronden op hele centen; laatste cent naar het restdeel', () => {
  assert.strictEqual(F.pctNaarCenten(1000000, 40), 400000); assert.strictEqual(F.pctNaarCenten(10001, 50), 5001); assert.strictEqual(F.pctNaarCenten(10001, 33.33), 3333); assert.strictEqual(F.pctNaarCenten(0, 50), 0); assert.strictEqual(F.pctNaarCenten(10000, 0.01), 1);
  assert.strictEqual(F.parsePct('33,33'), 33.33); assert.strictEqual(F.parsePct('50%'), 50); assert.strictEqual(F.parsePct(' 12 '), 12); assert.strictEqual(F.parsePct(''), 0); assert.strictEqual(F.parsePct('101'), null); assert.strictEqual(F.parsePct('1,234'), null); assert.strictEqual(F.parsePct('-5'), null);
  assert.strictEqual(F.centenNaarPct(1000000, 400000), 40); assert.strictEqual(F.centenNaarPct(30000, 10000), 33.33);
  // percentage in een cel van een offerte van 100,01: het restdeel krijgt de cent die overblijft, de som blijft exact
  const it = F.nieuwItem({ naam: 'x', totaalC: 10001 }, 14, V), r = F.zetCel(it, null, '2026-11', F.pctNaarCenten(10001, 50), V).item;
  assert.deepStrictEqual(r.termijnen.map(t => [t.aan, Math.round(t.bedrag * 100)]), [[true, 5001], [false, 5000]]); assert.strictEqual(somC(r), 10001); valideer('p:x', r, V);
});
test('pctVerdeel / verdeelOver: som precies het totaal, de laatste krijgt de rest', () => {
  assert.deepStrictEqual(F.pctVerdeel(10000, [33.33, 33.33, 33.34]), [3333, 3333, 3334]); assert.deepStrictEqual(F.pctVerdeel(10001, [33.33, 33.33, 33.34]), [3333, 3333, 3335]);
  assert.deepStrictEqual(F.pctVerdeel(10001, [50, 50]), [5001, 5000]); assert.deepStrictEqual(F.pctVerdeel(10001, [30, 30]), [3000, 3000]);           // som ≠ 100: niets verrekend
  for (const tot of [1, 2, 3, 99, 10001, 123457, 999999]) for (const p of [[50, 50], [50, 40, 10], [33.33, 33.33, 33.34], [10, 20, 30, 40], [100]]) assert.strictEqual(F.pctVerdeel(tot, p).reduce((a, b) => a + b, 0), tot);
  assert.deepStrictEqual(F.verdeelOver(6000, [40, 10]), [4800, 1200]); assert.deepStrictEqual(F.verdeelOver(7, [1, 1, 1]), [2, 2, 3]); assert.deepStrictEqual(F.verdeelOver(5, [0, 0]), [0, 0]);
});
test('zetCel: label wordt het termijnlabel (en overleeft de worker); lege label behoudt het oude; behoudAan laat het vinkje staan', () => {
  let it = leegItem({ status: 'concept' }); assert.strictEqual(it.aan, false);                                // niet-geaccepteerd begint op "gaat zeker door" uit
  assert.strictEqual(leegItem().aan, true); assert.strictEqual(leegItem({ status: 'openstaand' }).aan, false); assert.strictEqual(leegItem({ status: undefined }).aan, true);
  it = F.zetCel(it, null, '2026-12', 300000, V, { label: '  aanbetaling ', behoudAan: true }).item;
  assert.strictEqual(it.aan, false); assert.strictEqual(it.termijnen.find(t => t.aan).label, 'aanbetaling');
  const geld = valideer('p:e' + E2, Object.assign({}, it), V); assert.strictEqual(geld.termijnen.find(t => t.aan).label, 'aanbetaling');   // label-roundtrip via geldPrognoseNorm
  const nog = F.zetCel(it, null, '2026-12', 350000, V, { label: '', behoudAan: true }).item; assert.strictEqual(nog.termijnen.find(t => t.aan).label, 'aanbetaling');
  const lang = F.zetCel(it, null, '2027-01', 100000, V, { label: 'een veel te lange labeltekst voor een termijn', behoudAan: true }).item; assert.ok(lang.termijnen.every(t => t.label.length <= 24));
  valideer('p:e' + E2, lang, V);
  assert.strictEqual(F.zetCel(it, null, '2026-12', 300000, V).item.aan, true);                                 // zonder behoudAan: plannen zet het vinkje aan (geaccepteerde offerte)
  assert.strictEqual(F.zetCel(leegItem(), null, '2026-12', 0, V, { behoudAan: true }).item.aan, true);
});
test('schema toepassen op een lege offerte: percentages naar centen, laatste deel de rest, maanden volgen de oplevering', () => {
  const groot = { bron: 'klant', rijen: [{ label: 'aanbetaling', pct: 50 }, { label: 'tussentijds', pct: 40 }, { label: 'oplevering', pct: 10 }] };
  const a = F.schemaToepassen(leegItem(), null, groot, V, { opleverYm: '2027-03' });                                  // oplevering maart 2027: okt, dec, mrt
  assert.deepStrictEqual(a.item.termijnen.map(t => [t.label, t.factuurdatum.slice(0, 7), Math.round(t.bedrag * 100), t.aan]), [['aanbetaling', '2026-10', 500000, true], ['tussentijds', '2026-12', 400000, true], ['oplevering', '2027-03', 100000, true]]);
  assert.strictEqual(somC(a.item), 1000000); valideer('p:e' + E2, a.item, V);
  const b = F.schemaToepassen(leegItem(), null, groot, V, {});                                                        // geen opleverdatum: de maanden erna
  assert.deepStrictEqual(b.item.termijnen.map(t => t.factuurdatum.slice(0, 7)), ['2026-10', '2026-11', '2026-12']);
  const c1 = F.schemaToepassen(leegItem({ totaalC: 10001 }), null, { rijen: [{ label: 'a', pct: 33.33 }, { label: 'b', pct: 33.33 }, { label: 'c', pct: 33.34 }] }, V, {});
  assert.strictEqual(somC(c1.item), 10001); assert.deepStrictEqual(c1.item.termijnen.map(t => Math.round(t.bedrag * 100)), [3333, 3333, 3335]); assert.ok(c1.item.termijnen.every(t => t.aan));
  const kort = F.schemaToepassen(leegItem(), null, groot, V, { opleverYm: '2026-11' });                              // oplevering te dichtbij: toch drie verschillende maanden
  assert.strictEqual(new Set(kort.item.termijnen.map(t => t.factuurdatum.slice(0, 7))).size, 3);
  const verleden = F.schemaToepassen(leegItem(), null, groot, V, { opleverYm: '2026-05' }); assert.deepStrictEqual(verleden.item.termijnen.map(t => t.factuurdatum.slice(0, 7)), ['2026-10', '2026-11', '2026-12']);
});
test('schema toepassen op een deels geplande offerte: alleen het open deel, nooit over geplande of gefactureerde termijnen heen', () => {
  const groot = { rijen: [{ label: 'aanbetaling', pct: 50 }, { label: 'tussentijds', pct: 40 }, { label: 'oplevering', pct: 10 }] };
  let it = F.zetCel(leegItem(), null, '2026-11', 400000, V, { label: 'Aanbetaling' }).item;                          // aanbetaling 4.000 staat al in november
  const r = F.schemaToepassen(it, null, groot, V, { opleverYm: '2027-03' });
  assert.ok(r.item, r.fout); const per = Object.fromEntries(r.item.termijnen.map(t => [t.label, [t.factuurdatum.slice(0, 7), Math.round(t.bedrag * 100), t.aan]]));
  assert.deepStrictEqual(per['Aanbetaling'], ['2026-11', 400000, true]);                                               // onaangeroerd
  assert.deepStrictEqual(per.tussentijds, ['2026-10', 480000, true]); assert.deepStrictEqual(per.oplevering, ['2027-03', 120000, true]);   // 40:10 herverdeeld over de resterende 6.000
  assert.strictEqual(somC(r.item), 1000000); valideer('p:e' + E2, r.item, V);
  // een gefactureerde termijn blijft vast en telt niet als open
  const ov = { termijnen: [{ id: 't1', bedrag: 3000, gefactureerd: 3000, open: 0 }] };
  const met = { soort: 'project', naam: 'V', estimate_id: E2, totaal: 10000, aan: true, betaaltermijn: 14, k: [], x: [], termijnen: [{ id: 't1', label: 'bevestiging', bedrag: 3000, factuurdatum: '2026-10-05', aan: true }, { id: 't2', label: 'nog niet gepland', bedrag: 7000, factuurdatum: '2026-10-05', aan: false }] };
  const g = F.schemaToepassen(met, ov, { rijen: [{ label: 'a', pct: 50 }, { label: 'b', pct: 50 }] }, V, {});
  assert.deepStrictEqual(g.item.termijnen.map(t => [t.id === 't1' ? 'vast' : t.label, Math.round(t.bedrag * 100)]).sort(), [['a', 350000], ['b', 350000], ['vast', 300000]].sort()); assert.strictEqual(g.item.termijnen.find(t => t.id === 't1').bedrag, 3000);
  assert.strictEqual(somC(g.item), 1000000);
});
test('schema toepassen: niets over, alles al gepland, te veel delen en niet-geaccepteerd behoudt het vinkje', () => {
  const vol = F.zetCel(leegItem(), null, '2026-11', 1000000, V).item;
  assert.ok(F.schemaToepassen(vol, null, { rijen: [{ label: 'a', pct: 100 }] }, V, {}).fout);
  const half = F.zetCel(leegItem(), null, '2026-11', 500000, V, { label: 'factuur' }).item;
  assert.ok(/al gepland/.test(F.schemaToepassen(half, null, { rijen: [{ label: 'Factuur', pct: 100 }] }, V, {}).fout));
  let zes = leegItem({ totaalC: 600000 }); for (const m of ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03']) zes = F.zetCel(zes, null, m, 10000, V, { label: 'x' + m }).item;
  assert.ok(/hoogstens 6/.test(F.schemaToepassen(zes, null, { rijen: [{ label: 'a', pct: 50 }, { label: 'b', pct: 50 }] }, V, {}).fout));
  const concept = F.schemaToepassen(leegItem({ status: 'concept' }), null, { rijen: [{ label: 'a', pct: 50 }, { label: 'b', pct: 50 }] }, V, { behoudAan: true });
  assert.strictEqual(concept.item.aan, false); assert.strictEqual(F.schemaToepassen(leegItem(), null, { rijen: [{ label: 'a', pct: 100 }] }, V, {}).item.aan, true);
});
test('kiesSchema: schema van de klant (contact-id), anders standaard op grootte, anders het voorstel', () => {
  const eigen = { '700000000001': [{ label: 'aanbetaling', pct: 30 }, { label: 'oplevering', pct: 70 }] };
  assert.deepStrictEqual(F.kiesSchema('700000000001', 500000, eigen, null), { bron: 'klant', rijen: eigen['700000000001'] });
  assert.strictEqual(F.kiesSchema('700000000002', 500000, eigen, null).bron, 'standaard');
  assert.strictEqual(F.kiesSchema('700000000002', 50000, {}, { grens_klein: 1000, grens_groot: 20000 }).maat, 'klein');
  assert.strictEqual(F.kiesSchema('7', 500000, {}, { grens_klein: 1000, grens_groot: 20000 }).maat, 'middel'); assert.strictEqual(F.kiesSchema('7', 5000000, {}, { grens_klein: 1000, grens_groot: 20000 }).maat, 'groot');
  assert.deepStrictEqual(F.kiesSchema('7', 500000, {}, { grens_klein: 1000, grens_groot: 20000, middel: [{ label: 'x', pct: 100, dagen: 7 }] }).rijen, [{ label: 'x', pct: 100 }]);   // het standaardschema uit de instellingen gaat voor
  assert.strictEqual(F.kiesSchema('7', 500000, null, {}).maat, 'middel'); assert.deepStrictEqual(F.kiesSchema('7', 500000, null, null).rijen.map(r => r.pct), [50, 50]);
  for (const k of ['klein', 'middel', 'groot']) assert.strictEqual(F.SCHEMA_VOORSTEL[k].reduce((a, r) => a + r.pct, 0), 100);
});
test('statusfilter: tellen per status, zichtbare rijen en de totalen (alleen zichtbaar én gaat zeker door)', () => {
  const sch = (id, st) => Object.assign(schat(id, 'N' + id.slice(-2), 1000), { status: st });
  const lijst = [sch('300000000041', 'geaccepteerd'), sch('300000000042', 'openstaand'), sch('300000000043', 'concept'), sch('300000000044', 'concept')];
  assert.deepStrictEqual(F.telStatus(lijst), { geaccepteerd: 1, openstaand: 1, concept: 2, uitbeeld: 0 }); assert.deepStrictEqual(F.telStatus(null), { geaccepteerd: 0, openstaand: 0, concept: 0, uitbeeld: 0 });
  const mk = (eid, aan) => ({ soort: 'project', naam: 'I' + eid.slice(-2), estimate_id: eid, totaal: 1000, aan, betaaltermijn: 14, k: [], x: [], termijnen: [{ id: 't1', label: 'a', bedrag: 1000, factuurdatum: '2026-11-10', aan: true }] });
  const items = { 'p:a': mk('300000000041', true), 'p:b': mk('300000000042', true), 'p:c': mk('300000000043', false) };       // concept 44 heeft geen item: "gaat zeker door" uit
  const rijen = F.bouwRijen({ schatten: lijst, items, posten: [], projecten: [], vandaag: V, maanden: 3 });
  assert.deepStrictEqual(rijen.map(r => [r.status, r.aan]), [['geaccepteerd', true], ['openstaand', true], ['concept', false], ['concept', false]]);
  const events = ['a', 'b', 'c'].map(k => ({ id: k, bron: 'prognose', termijn_id: 't1', prognose: 'p:' + k, datum: '2026-12-01', delta: 1000 }));
  const alles = F.zichtbaar(rijen, F.STATUSSEN); assert.strictEqual(alles.zichtbaar.length, 4); assert.deepStrictEqual(alles.uitgesloten, []);
  const t1 = F.totalen({ rijen: alles.zichtbaar, events, vandaag: V, maanden: 3, uitgesloten: alles.uitgesloten }); assert.deepStrictEqual(t1.gepland, [0, 200000, 0]); assert.deepStrictEqual(t1.binnen, [0, 0, 300000]);
  const zonderOpen = F.zichtbaar(rijen, ['geaccepteerd', 'concept']); assert.deepStrictEqual(zonderOpen.zichtbaar.map(r => r.status), ['geaccepteerd', 'concept', 'concept']); assert.strictEqual(zonderOpen.verborgen, 1); assert.deepStrictEqual(zonderOpen.uitgesloten, []);
  const t2 = F.totalen({ rijen, events, vandaag: V, maanden: 3, uitgesloten: zonderOpen.uitgesloten }); assert.deepStrictEqual(t2, t1);   // het filter verbergt alleen rijen: de totalen blijven gelijk aan Financiën (alle actieve prognose-items)
  assert.deepStrictEqual(t2.gepland, [0, 200000, 0]); assert.deepStrictEqual(t2.binnen, [0, 0, 300000]);   // p:c staat uit maar levert een event; 'aan' telt in Financiën
  const geen = F.zichtbaar(rijen, []); assert.strictEqual(geen.zichtbaar.length, 0); assert.strictEqual(geen.verborgen, 4); assert.deepStrictEqual(F.totalen({ rijen, events, vandaag: V, maanden: 3, uitgesloten: geen.uitgesloten }), t1);
  // rijen zonder status (prognose-project zonder offerte) blijven altijd zichtbaar; dubbelen tellen nooit mee
  const extra = F.bouwRijen({ schatten: [], items: { 'p:z': mk('300000000099', true) }, posten: [], projecten: [], vandaag: V, maanden: 6 }); assert.strictEqual(F.zichtbaar(extra, []).zichtbaar.length, 1);
});
test('dubbele items tellen nooit mee, ook niet als de rij door het filter verborgen is', () => {
  const mk = (eid, aan) => ({ soort: 'project', naam: 'D', estimate_id: eid, totaal: 1000, aan, betaaltermijn: 14, k: [], x: [], termijnen: [{ id: 't1', label: 'a', bedrag: 1000, factuurdatum: '2026-11-10', aan: true }] });
  const s = Object.assign(schat('300000000061', 'Dub', 1000), { status: 'concept' }), items = { 'p:a': mk('300000000061', true), 'p:b': mk('300000000061', true) };
  const rijen = F.bouwRijen({ schatten: [s], items, posten: [], projecten: [], vandaag: V, maanden: 3 }), zv = F.zichtbaar(rijen, ['geaccepteerd']);
  assert.strictEqual(zv.verborgen, 1); assert.deepStrictEqual(zv.uitgesloten, ['p:b']);
  const ev = ['a', 'b'].map(k => ({ id: k, bron: 'prognose', termijn_id: 't1', prognose: 'p:' + k, datum: '2026-12-01', delta: 1000 }));
  assert.deepStrictEqual(F.totalen({ rijen, events: ev, vandaag: V, maanden: 3, uitgesloten: zv.uitgesloten }).binnen, [0, 0, 100000]);
});
test('Gaat zeker door bij een afwijkend Moneybird-totaal: alleen uitzetten, aanzetten wordt in het schrijfpad geweigerd', () => {
  const uit = { soort: 'project', naam: 'A', totaal: 1000, aan: false, termijnen: [] }, aan = Object.assign({}, uit, { aan: true });
  assert.ok(/wijkt af/.test(F.aanZetFout(uit, F.zetAan(uit, true).item, 120000)));                    // uit → aan, Moneybird 1.200 ≠ 1.000: geweigerd
  assert.strictEqual(F.aanZetFout(aan, F.zetAan(aan, false).item, 120000), null);                      // aan → uit mag altijd
  assert.strictEqual(F.aanZetFout(uit, F.zetAan(uit, true).item, 100000), null);                       // geen afwijking: aanzetten mag
  assert.strictEqual(F.aanZetFout(uit, F.zetAan(uit, false).item, 120000), null);                      // blijft uit: geen verandering
  assert.strictEqual(F.aanZetFout(aan, aan, 120000), null);                                           // blijft aan (bv. bijwerken van het totaal)
  assert.strictEqual(F.aanZetFout(null, aan, 120000), null); assert.strictEqual(F.aanZetFout(uit, F.zetAan(uit, true).item, null), null);     // nieuw item of geen Moneybird-bedrag bekend
  // plannen (zetCel) op een uitstaande rij met afwijking zet het vinkje aan: het schrijfpad vangt dat af
  const planAan = F.zetCel(Object.assign({}, uit, { termijnen: [{ id: 't1', label: 'x', bedrag: 1000, factuurdatum: '2026-11-10', aan: false }] }), null, '2026-11', 50000, V).item;
  assert.strictEqual(planAan.aan, true); assert.ok(F.aanZetFout(uit, planAan, 120000));
});
test('statusfilter: een niet-geaccepteerde offerte met een prognose die aan staat telt mee zodra "gaat zeker door" aan staat', () => {
  const s = Object.assign(schat('300000000051', 'Concept BV', 5000), { status: 'concept' });
  let it = F.zetCel(leegItem({ estimateId: '300000000051', totaalC: 500000, status: 'concept' }), null, '2026-11', 200000, V, { label: 'aanbetaling', behoudAan: true }).item; assert.strictEqual(it.aan, false);
  const uit = F.totalen({ rijen: F.bouwRijen({ schatten: [s], items: { 'p:q': it }, posten: [], projecten: [], vandaag: V, maanden: 3 }), events: [], vandaag: V, maanden: 3 }); assert.deepStrictEqual(uit.gepland, [0, 0, 0]);
  it = F.zetAan(it, true).item;
  const aan = F.totalen({ rijen: F.bouwRijen({ schatten: [s], items: { 'p:q': it }, posten: [], projecten: [], vandaag: V, maanden: 3 }), events: [], vandaag: V, maanden: 3 }); assert.deepStrictEqual(aan.gepland, [0, 200000, 0]);
});
test('schatNorm: status uit de Moneybird-state; afgewezen of gefactureerde offertes vallen buiten de drie statussen', () => {
  const norm = state => F.schatNorm({ id: 1234567, estimate_id: 'x', total_price_incl_tax_base: '100', state }).status;
  assert.deepStrictEqual(['accepted', 'open', 'late', 'draft', 'rejected', 'billed', 'archived', undefined].map(norm), ['geaccepteerd', 'openstaand', 'openstaand', 'concept', 'overig', 'overig', 'overig', 'geaccepteerd']);
});

// ── uit beeld zetten ──
const EU = ['300000000071', '300000000072', '300000000073', '300000000074'];
const itemU = (eid, o) => Object.assign({ soort: 'project', naam: 'U' + eid.slice(-2), estimate_id: eid, totaal: 1000, aan: true, betaaltermijn: 14, ts: 5, door: 'x', k: [], x: [],
  termijnen: [{ id: 't1', label: 'aanbetaling', bedrag: 400, factuurdatum: '2026-11-10', aan: true }, { id: 't2', label: 'oplevering', bedrag: 600, factuurdatum: '2026-12-10', aan: true }] }, o || {});
const schU = (id, st) => Object.assign(schat(id, 'N' + id.slice(-2), 1000), { status: st || 'geaccepteerd' });
test('uit beeld zetten: Gaat zeker door uit, termijnen en bedragen blijven bewaard; terugzetten zet het vinkje niet aan', () => {
  const it = itemU(EU[0]), ov = { sleutel: 'p:a', soort: 'project', gefactureerd: 400, termijnen: [{ id: 't1', bedrag: 400, gefactureerd: 400, open: 0 }, { id: 't2', bedrag: 600, gefactureerd: 0, open: 600 }] };
  const nieuw = F.uitBeeldItem(it); assert.strictEqual(nieuw.aan, false); assert.deepStrictEqual(nieuw.termijnen, it.termijnen); assert.strictEqual(nieuw.totaal, 1000); assert.strictEqual(nieuw.ts, undefined);
  assert.strictEqual(F.uitBeeldItem(itemU(EU[0], { aan: false })), null); assert.strictEqual(F.uitBeeldItem(null), null); assert.strictEqual(F.uitBeeldItem({ soort: 'post', aan: true }), null);   // niets te doen
  valideer('p:a', nieuw, V);
  // met al gefactureerd bedrag: de bedragen veranderen niet (de rij houdt zijn gefactureerde deel)
  const voor = F.bouwRijen({ schatten: [schU(EU[0])], items: { 'p:a': it }, posten: [ov], projecten: [], vandaag: V, maanden: 3 })[0];
  const na = F.bouwRijen({ schatten: [schU(EU[0])], items: { 'p:a': nieuw }, posten: [ov], projecten: [], vandaag: V, maanden: 3, uitbeeld: { [EU[0]]: { reden: 'gefactureerd', door: 'T', ts: 1 } } })[0];
  assert.strictEqual(na.uitbeeld.reden, 'gefactureerd'); assert.strictEqual(voor.uitbeeld, null); assert.strictEqual(na.totaalC, voor.totaalC); assert.strictEqual(na.gefC, voor.gefC); assert.strictEqual(na.aan, false); assert.strictEqual(voor.aan, true);
  assert.deepStrictEqual(na.termijnen.map(t => [t.id, t.bedragC, t.factuurdatum, t.label]), voor.termijnen.map(t => [t.id, t.bedragC, t.factuurdatum, t.label]));   // (de worker geeft voor een item dat uit staat geen termijnoverzicht: alleen het totaal gefactureerd blijft, gelijk aan voor)
  // terugzetten haalt alleen de markering weg; het item (aan:false) blijft zoals het is
  const terug = F.bouwRijen({ schatten: [schU(EU[0])], items: { 'p:a': nieuw }, posten: [ov], projecten: [], vandaag: V, maanden: 3, uitbeeld: F.terugzetMap({ [EU[0]]: { reden: 'gefactureerd' } }, [EU[0]]) })[0];
  assert.strictEqual(terug.uitbeeld, null); assert.strictEqual(terug.aan, false);
});
test('uit beeld: bulk (alleen rijen met offerte-id, items alleen waar aan, bestaande markeringen blijven, ongeldige reden geweigerd)', () => {
  const items = { 'p:a': itemU(EU[0]), 'p:b': itemU(EU[1], { aan: false }) };
  const rijen = F.bouwRijen({ schatten: [schU(EU[0]), schU(EU[1]), schU(EU[2], 'concept')], items, posten: [], projecten: [], vandaag: V, maanden: 3 });
  const geen = { sleutel: 'p:x', estimateId: '' };                                              // prognose-project zonder offerte: overgeslagen
  const plan = F.bulkUitBeeld(rijen.concat([geen]), items, 'verkeerd', { '300000000999': { reden: 'weg', door: 'A', ts: 3 } });
  assert.deepStrictEqual(plan.updates.map(u => u.sleutel), ['p:a']); assert.strictEqual(plan.updates[0].item.aan, false); assert.deepStrictEqual(plan.overgeslagen, ['p:x']);
  assert.deepStrictEqual(Object.keys(plan.map).sort(), [EU[0], EU[1], EU[2], '300000000999'].sort()); assert.strictEqual(plan.map[EU[1]].reden, 'verkeerd'); assert.strictEqual(plan.map['300000000999'].door, 'A');
  assert.ok(F.bulkUitBeeld(rijen, items, 'rommel').fout); assert.ok(F.bulkUitBeeld(rijen, items, undefined).fout);
  assert.deepStrictEqual(F.terugzetMap({ a: 1, b: 2 }, ['a']), { b: 2 });
  for (const k of Object.keys(F.UITBEELD_REDENEN)) assert.ok(F.bulkUitBeeld(rijen, items, k).map);
});
test('uit beeld: filter Uit beeld, tellingen en rijen (standaard verborgen, aan = zichtbaar met reden)', () => {
  const ub = { [EU[1]]: { reden: 'weg', door: 'T', ts: 1 }, [EU[3]]: { reden: 'verkeerd', door: 'T', ts: 1 } };
  const lijst = [schU(EU[0]), schU(EU[1]), schU(EU[2], 'concept'), schU(EU[3], 'openstaand')];
  assert.deepStrictEqual(F.telStatus(lijst, ub), { geaccepteerd: 1, openstaand: 0, concept: 1, uitbeeld: 2 });       // uit beeld telt niet meer mee bij de status
  const rijen = F.bouwRijen({ schatten: lijst, items: {}, posten: [], projecten: [], vandaag: V, maanden: 3, uitbeeld: ub });
  assert.deepStrictEqual(rijen.map(r => !!r.uitbeeld), [false, true, false, true]);
  const std = F.zichtbaar(rijen, F.STATUSSEN); assert.deepStrictEqual(std.zichtbaar.map(r => r.estimateId), [EU[0], EU[2]]); assert.strictEqual(std.verborgen, 2);
  const mee = F.zichtbaar(rijen, F.FILTERS); assert.strictEqual(mee.zichtbaar.length, 4); assert.strictEqual(mee.verborgen, 0);
  const alleenUit = F.zichtbaar(rijen, ['uitbeeld']); assert.deepStrictEqual(alleenUit.zichtbaar.map(r => r.estimateId), [EU[1], EU[3]]);          // een uit-beeld-rij volgt het statusfilter niet
  assert.deepStrictEqual(F.zichtbaar(rijen, []).zichtbaar, []);
});
test('uit beeld: totalen blijven gelijk aan Financiën (alleen items die aan staan tellen), ook als de rij verborgen is', () => {
  const items = { 'p:a': itemU(EU[0]), 'p:b': itemU(EU[1]) };
  const ev = k => ({ id: k, bron: 'prognose', termijn_id: 't1', prognose: 'p:' + k, datum: '2026-12-01', delta: 400 });
  const maak = (uitA) => { const it = Object.assign({}, items, uitA ? { 'p:a': F.uitBeeldItem(items['p:a']) } : {});
    const rijen = F.bouwRijen({ schatten: [schU(EU[0]), schU(EU[1])], items: it, posten: [], projecten: [], vandaag: V, maanden: 3, uitbeeld: uitA ? { [EU[0]]: { reden: 'weg', door: 'T', ts: 1 } } : {} });
    const events = ['a', 'b'].filter(k => !(uitA && k === 'a')).map(ev);                         // zoals de worker: items die uit staan leveren geen events
    return { rijen, t: F.totalen({ rijen, events, vandaag: V, maanden: 3, uitgesloten: F.zichtbaar(rijen, F.STATUSSEN).uitgesloten }) }; };
  const voor = maak(false), na = maak(true);
  assert.deepStrictEqual(voor.t.gepland, [0, 80000, 60000 * 2]); assert.deepStrictEqual(voor.t.binnen, [0, 0, 80000]);
  assert.deepStrictEqual(na.t.gepland, [0, 40000, 60000]); assert.deepStrictEqual(na.t.binnen, [0, 0, 40000]);                                    // alleen nog p:b
  assert.strictEqual(F.zichtbaar(na.rijen, F.STATUSSEN).verborgen, 1);                                                                          // p:a is verborgen, maar het totaal klopt met Financiën
});

// ── brede tabel: compacte bedragen en passende kolombreedte ──
test('fmtKort: 950 · 1,2k · 12k · 1,2M, negatief met minteken, afgerond', () => {
  const k = e => F.fmtKort(Math.round(e * 100));
  assert.strictEqual(k(0), '0'); assert.strictEqual(k(950), '950'); assert.strictEqual(k(999.4), '999'); assert.strictEqual(k(1000), '1k'); assert.strictEqual(k(1200), '1,2k'); assert.strictEqual(k(9950), '10k');
  assert.strictEqual(k(12100), '12k'); assert.strictEqual(k(18150), '18k'); assert.strictEqual(k(999499), '999k'); assert.strictEqual(k(1200000), '1,2M'); assert.strictEqual(k(25000000), '25M');
  assert.strictEqual(k(-12100), '−12k'); assert.strictEqual(k(-1250), '−1,3k'); assert.strictEqual(F.fmtKort(-7), '−0');
});
test('passendBreedte: alle maanden in beeld met een minimum van 64 px; compact onder 96 px', () => {
  assert.deepStrictEqual(F.passendBreedte(720, 6), { w: 110, compact: false, past: true });             // genoeg ruimte: gewone breedte (maximum)
  assert.deepStrictEqual(F.passendBreedte(720, 8), { w: 90, compact: true, past: true });                 // smaller en compacte bedragen
  assert.deepStrictEqual(F.passendBreedte(768, 12), { w: 64, compact: true, past: true });                // precies het minimum
  assert.deepStrictEqual(F.passendBreedte(767, 12), { w: 64, compact: true, past: false });               // past niet meer: minimum, het vak blijft zijwaarts scrollen
  assert.deepStrictEqual(F.passendBreedte(500, 25), { w: 64, compact: true, past: false });
  assert.deepStrictEqual(F.passendBreedte(500, 0), { w: 110, compact: false, past: true }); assert.strictEqual(F.passendBreedte(2000, 3).w, 110);
  assert.strictEqual(F.passendBreedte(960, 10, { min: 80, compactOnder: 100 }).w, 96);
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
atest('haalOffertes: drie statussen apart gepagineerd, samengevoegd zonder dubbelen; afgekapt als één status het plafond raakt', async () => {
  const gezien = [];
  const data = { accepted: 250, 'open|late': 40, draft: 3 };
  const haal = (filter, p) => { gezien.push(filter + '#' + p); const per = 100, totaal = data[filter], start = (p - 1) * per; return Promise.resolve(Array.from({ length: Math.max(0, Math.min(per, totaal - start)) }, (_, i) => ({ id: filter + (start + i), state: filter.split('|')[0] }))); };
  const r = await F.haalOffertes(haal, { max: 50, per: 100 });
  assert.strictEqual(r.lijst.length, 293); assert.strictEqual(r.afgekapt, false); assert.strictEqual(new Set(r.lijst.map(e => e.id)).size, 293);
  assert.deepStrictEqual(gezien.filter(x => x.startsWith('accepted')), ['accepted#1', 'accepted#2', 'accepted#3']); assert.ok(gezien.includes('draft#1') && gezien.includes('open|late#1'));
  const dubbel = await F.haalOffertes(() => Promise.resolve([{ id: 7 }, { id: 8 }]), { max: 5, per: 100 }); assert.deepStrictEqual(dubbel.lijst.map(e => e.id), [7, 8]);   // dezelfde offerte in meerdere lijsten telt één keer
  const afgekapt = await F.haalOffertes((f, p) => Promise.resolve(f === 'draft' ? Array.from({ length: 100 }, (_, i) => ({ id: 'd' + p + '_' + i })) : []), { max: 2, per: 100 }); assert.strictEqual(afgekapt.afgekapt, true);
});async_.then(() => console.log(`\n${n} tests geslaagd${process.exitCode ? ' — er zijn fouten' : ''}`));
