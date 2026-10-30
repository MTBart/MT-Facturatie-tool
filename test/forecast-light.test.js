// Rekenregels van de Forecast light (mt-forecast-light.js), zonder DOM. Draaien: node test/forecast-light.test.js — verzonnen ids en namen.
'use strict';
const assert = require('assert');
const F = require('../mt-forecast.js'); require('../mt-forecast-light.js');
const L = globalThis.MTForecastLight;
let n = 0; const test = (naam, fn) => { try { fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };

test('invoer: Nederlandse notatie, minteken, leeg, percentage', () => {
  assert.deepStrictEqual(L.leesInvoer('5.000'), { c: 500000 });
  assert.deepStrictEqual(L.leesInvoer('2500,5'), { c: 250050 });
  assert.deepStrictEqual(L.leesInvoer('€ 1.234,56'), { c: 123456 });
  assert.deepStrictEqual(L.leesInvoer('1500.50'), { c: 150050 });
  assert.deepStrictEqual(L.leesInvoer('-250'), { c: -25000 });
  assert.deepStrictEqual(L.leesInvoer('−250'), { c: -25000 });
  assert.deepStrictEqual(L.leesInvoer(''), { c: null });
  assert.deepStrictEqual(L.leesInvoer('  '), { c: null });
  assert.deepStrictEqual(L.leesInvoer('50%', 2646453), { c: 1323227 });
  assert.deepStrictEqual(L.leesInvoer('33,3%', 100000), { c: 33300 });
  assert.ok(L.leesInvoer('50%', null).fout); assert.ok(L.leesInvoer('abc').fout); assert.ok(L.leesInvoer('1,234,5').fout); assert.ok(L.leesInvoer('0%', 100).fout);
});
test('weergave en invoer zijn elkaars omgekeerde', () => {
  for (const c of [0, 1, 99, 100, 150050, 530359, 123456789, -1000, -150050]) assert.strictEqual(L.leesInvoer(L.fmt(c)).c, c, String(c));
});
test('rijen: offertes uit Moneybird plus losse schets-records met bedragen; uit beeld gemarkeerd', () => {
  const sch = [F.schatNorm({ id: 300000000001, estimate_id: '2026-1', contact: { company_name: 'A' }, reference: 'Kast', total_price_incl_tax: '121', total_price_excl_tax: '100', state: 'accepted', estimate_date: '2026-10-01' }),
    F.schatNorm({ id: 300000000002, estimate_id: '2026-2', contact: { company_name: 'B' }, total_price_incl_tax: '50', state: 'open', estimate_date: '2026-10-02' })];
  const rijen = L.rijen(sch, { '300000000002': { cellen: { '2026-11': 100 }, zeker: true }, '300000000009': { cellen: { '2026-10': 5 }, naam: 'Weg — oud' }, '300000000010': { cellen: {} } }, { '300000000002': { reden: 'verkeerd' } });
  assert.deepStrictEqual(rijen.map(r => r.id), ['300000000001', '300000000002', '300000000009'], 'een leeg los record verschijnt niet');
  assert.strictEqual(rijen[0].naam, 'A — Kast'); assert.strictEqual(rijen[0].zeker, true, 'geaccepteerd: standaard aan'); assert.strictEqual(rijen[0].exclC, 10000);
  assert.strictEqual(rijen[1].zeker, true); assert.strictEqual(rijen[1].uitbeeld, true);
  assert.strictEqual(rijen[2].status, 'los'); assert.strictEqual(rijen[2].naam, 'Weg — oud');
  assert.deepStrictEqual(L.filter(rijen, ['geaccepteerd', 'los']).map(r => r.id), ['300000000001', '300000000009']);
  assert.deepStrictEqual(L.tel(rijen), { geaccepteerd: 1, openstaand: 0, concept: 0, los: 1, gefactureerd: 0, uitbeeld: 1 });
});
const fx = (o) => L.factuurNorm(Object.assign({ id: 400000000001, invoice_id: '2026-0100', contact_id: 500000000001, contact: { company_name: 'A' }, invoice_date: '2026-10-15', state: 'open', total_price_incl_tax: '60.50', total_price_excl_tax: '50' }, o));
test('facturen: normaliseren; concept en zonder datum tellen niet', () => {
  const f = fx(); assert.strictEqual(f.inclC, 6050); assert.strictEqual(f.exclC, 5000); assert.strictEqual(f.ym, '2026-10'); assert.strictEqual(f.klant, 'A');
  assert.strictEqual(fx({ state: 'draft' }), null); assert.strictEqual(fx({ invoice_date: null }), null);
});
test('facturen koppelen: via de offerte, bevestigd/uitgesloten in de prognose, creditnota volgt, referentie met offertenummer', () => {
  const sch = [F.schatNorm({ id: 300000000001, estimate_id: '2026-1001', contact_id: 500000000001, contact: { company_name: 'A' }, total_price_incl_tax: '121', state: 'accepted' }),
    F.schatNorm({ id: 300000000002, estimate_id: '2026-1002', contact_id: 500000000002, contact: { company_name: 'B' }, total_price_incl_tax: '200', state: 'accepted' })];
  const fs = [fx({ id: 400000000001, original_estimate_id: 300000000001 }), fx({ id: 400000000002, original_sales_invoice_id: 400000000001, total_price_incl_tax: '-10', total_price_excl_tax: '-8', invoice_date: '2026-11-02' }),
    fx({ id: 400000000003, contact_id: 500000000002, reference: 'Termijn 1 offerte 2026-1002' }), fx({ id: 400000000004, contact_id: 500000000002, reference: 'los werk' }),
    fx({ id: 400000000005, contact_id: 500000000009 }), fx({ id: 400000000006, original_estimate_id: 300000000001, total_price_incl_tax: '5' })];
  const k = L.koppelFacturen(fs, sch, { 'p:x': { estimate_id: '300000000002', k: ['400000000004'], x: [] }, 'p:y': { estimate_id: '300000000001', k: [], x: ['400000000006'] } });
  assert.deepStrictEqual(k.perEid['300000000001'].maand, { '2026-10': 6050, '2026-11': -1000 }, 'creditnota volgt de factuur; uitgesloten factuur telt niet');
  assert.strictEqual(k.perEid['300000000001'].inclC, 5050);
  assert.strictEqual(k.perEid['300000000002'].inclC, 12100, 'referentie + bevestigd');
  assert.deepStrictEqual(k.los.map(f => f.id).sort(), ['400000000005', '400000000006']);
});
test('kasindeling samenvoegen na 409: collega-wijzigingen blijven, botsingen worden gemeld', () => {
  const basis = { indeling: { 'n:a': 'open', 'n:b': 'vast' }, loon: {}, posten: [{ id: 'post1', naam: 'P1' }, { id: 'post2', naam: 'P2' }] };
  const mijn = { indeling: { 'n:a': 'patroon', 'n:b': 'vast', 'n:c': 'uit' }, loon: { 'p:x': 'bart' }, posten: [{ id: 'post1', naam: 'P1' }, { id: 'post9', naam: 'Nieuw van mij' }] };
  const hun = { indeling: { 'n:a': 'open', 'n:b': 'overig', 'n:d': 'vast' }, loon: {}, posten: [{ id: 'post1', naam: 'P1' }, { id: 'post2', naam: 'P2' }, { id: 'post7', naam: 'Nieuw van hen' }], ts: 5 };
  let r = L.kasSamenvoegen(basis, mijn, hun);
  assert.deepStrictEqual(r.kas.indeling, { 'n:a': 'patroon', 'n:b': 'overig', 'n:c': 'uit', 'n:d': 'vast' }); assert.deepStrictEqual(r.kas.loon, { 'p:x': 'bart' });
  assert.deepStrictEqual(r.kas.posten.map(p => p.id), ['post1', 'post7', 'post9'], 'mijn verwijdering (post2) en toevoeging, hun toevoeging'); assert.strictEqual(r.botsingen.length, 0);
  r = L.kasSamenvoegen(basis, mijn, Object.assign({}, hun, { indeling: { 'n:a': 'uit', 'n:b': 'vast' } }));
  assert.deepStrictEqual(r.botsingen.map(b => b.sleutel), ['n:a']); assert.strictEqual(r.kas.indeling['n:a'], 'patroon', 'bij Toch opslaan wint mijn keuze');
  r = L.kasSamenvoegen(basis, { indeling: { 'n:b': 'vast' }, loon: {}, posten: basis.posten }, hun);
  assert.ok(!('n:a' in r.kas.indeling) || r.kas.indeling['n:a'] === 'open', 'een regel die ik terugzette naar standaard (weg) en zij niet aanraakten');
});
test('facturen koppelen: uitgesloten wint van bevestigd', () => {
  const k = L.koppelFacturen([fx({ id: 400000000011 })], [], { 'p:x': { estimate_id: '300000000001', k: ['400000000011'], x: ['400000000011'] } });
  assert.strictEqual(k.los.length, 1); assert.deepStrictEqual(k.perEid, {});
});
test('gefactureerd vervangt de schets in zijn maand, nog te factureren, status', () => {
  const sch = [F.schatNorm({ id: 300000000001, estimate_id: '2026-1001', contact_id: 500000000001, contact: { company_name: 'A' }, total_price_incl_tax: '121', total_price_excl_tax: '100', state: 'accepted' })];
  const k = L.koppelFacturen([fx({ original_estimate_id: 300000000001 })], sch, null);
  const [r] = L.rijen(sch, { '300000000001': { cellen: { '2026-10': 9000, '2026-11': 4000 } } }, {}, k);
  assert.strictEqual(r.fstatus, 'deels'); assert.ok(L.vast(r, '2026-10')); assert.ok(!L.vast(r, '2026-11'));
  assert.strictEqual(L.cel(r, '2026-10'), 6050, 'factuur vervangt de schets'); assert.strictEqual(r.cellen['2026-10'], 9000, 'de schets blijft bewaard');
  assert.strictEqual(L.nog(r, 'incl'), 6050); assert.strictEqual(L.nog(r, 'excl'), 5000);
  const t = L.totalen([r], ['2026-10', '2026-11']); assert.deepStrictEqual(t.per, [6050, 4000]); assert.deepStrictEqual(t.zeker, [6050, 4000], 'geaccepteerd: zeker');
  const k2 = L.koppelFacturen([fx({ original_estimate_id: 300000000001, total_price_incl_tax: '121' })], sch, null);
  assert.strictEqual(L.rijen(sch, {}, {}, k2)[0].fstatus, 'gefactureerd');
  const los = L.rijen([], {}, {}, L.koppelFacturen([fx({ original_estimate_id: 300000000077 })], [], null));
  assert.strictEqual(los[0].status, 'gefactureerd'); assert.strictEqual(los[0].zeker, true); assert.strictEqual(L.cel(los[0], '2026-10'), 6050);
});
test('kasregels: indeling, standaard, lonen, btw, eigen posten en netto', () => {
  const ev = [{ bron: 'patroon', patroon_id: 'pa14c9087c018', tegenpartij: 'B.Witte', richting: 'uit', bedrag: 5308.48, datum: '2026-11-25' },
    { bron: 'patroon', patroon_id: 'pcd18cfd0f9bb', tegenpartij: 'Mathijs Zwiers', richting: 'uit', bedrag: 5250, datum: '2026-11-25' },
    { bron: 'patroon', patroon_id: 'p88e21ebf5fe9', tegenpartij: 'Allianz', richting: 'uit', bedrag: 222.24, datum: '2026-11-03' },
    { bron: 'inkoop', tegenpartij: 'Vattenfall', richting: 'uit', bedrag: 400, datum: '2026-10-01' }, { bron: 'inkoop', tegenpartij: 'Houthandel', richting: 'uit', bedrag: 1000, datum: '2026-11-10' },
    { bron: 'btw', kwartaal: '2026-K3', richting: 'uit', bedrag: 22971.48, datum: '2026-10-31' }, { bron: 'verkoop', richting: 'in', bedrag: 99, datum: '2026-11-01' },
    { bron: 'inleg', intern: true, richting: 'uit', bedrag: 50, datum: '2026-11-01' }, { bron: 'prognose', termijn_id: 't1', richting: 'in', bedrag: 5, datum: '2026-11-01' }];
  const kas = { indeling: { 'n:houthandel': 'patroon' }, loon: {}, posten: [{ id: 'post1', groep: 'patroon', naam: 'Interprojecten', richting: 'uit', bedragC: 100000, van: '2026-11', tot: null }] };
  const ms = ['2026-10', '2026-11'];
  const rg = ev.map(e => L.kasRegel(e, kas, '2026-10-30')).filter(Boolean).concat(L.postRegels(kas, ms));
  assert.strictEqual(rg.length, 7, 'verkoop, intern en eigen termijnen tellen niet');
  const vf = rg.find(r => r.naam === 'Vattenfall'); assert.strictEqual(vf.groep, 'vast'); assert.strictEqual(vf.ym, '2026-10', 'voorbij = deze maand');
  assert.strictEqual(rg.find(r => r.naam === 'B.Witte').loon, 'bart'); assert.strictEqual(rg.find(r => r.naam === 'Mathijs Zwiers').loon, 'mathijs');
  assert.strictEqual(rg.find(r => r.naam === 'Houthandel').groep, 'patroon', 'eigen indeling wint');
  const btw = rg.find(r => r.bron === 'btw'); assert.strictEqual(btw.groep, 'overig'); assert.strictEqual(btw.c, -2297148); assert.strictEqual(btw.ym, '2026-10');
  let kt = L.kasTotalen(rg, ms, {});
  assert.deepStrictEqual(kt.vast.per, [-40000, -530848 - 525000 - 22224]); assert.deepStrictEqual(kt.patroon.per, [0, -100000 - 100000]); assert.deepStrictEqual(kt.overig.per, [-2297148, 0]);
  assert.strictEqual(kt.vast.opbouw[1].get('Allianz'), -22224);
  kt = L.kasTotalen(rg, ms, { loonBart: false }); assert.deepStrictEqual(kt.vast.per, [-40000, -525000 - 22224], 'loon Bart uit');
  assert.deepStrictEqual(L.netto([3000000, 0], [100, 0], kt, { overig: false }), [3000000 + 100 - 40000, -525000 - 22224 - 200000]);
  assert.deepStrictEqual(L.netto([5, 5], [1, 1], kt, { gef: false, open: false, vast: false, patroon: false, overig: false }), [5, 5]);
  const geenLoon = L.kasRegel(ev[0], { loon: { 'p:pa14c9087c018': 'geen' } }, '2026-10-30'); assert.strictEqual(geenLoon.loon, null);
});
test('eigen posten: vervallen in een maand met een factuur van dezelfde leverancier; loon Ilona; startindeling', () => {
  const ev = [{ bron: 'inkoop', tegenpartij: 'Energie Test N.V.', richting: 'uit', bedrag: 1439.62, datum: '2026-11-05' },
    { bron: 'inkoop', tegenpartij: 'Inhuur Test B.V.', richting: 'uit', bedrag: 1405, datum: '2026-10-27' }];
  const kas = { posten: [{ id: 'post1', groep: 'vast', naam: 'Energie', richting: 'uit', bedragC: 143961, van: '2026-11', tot: null, lev: 'n:energie test n.v.' },
    { id: 'post2', groep: 'patroon', naam: 'Inhuur', richting: 'uit', bedragC: 1000000, van: '2026-11', tot: null, lev: 'n:inhuur test b.v.' },
    { id: 'post3', groep: 'vast', naam: 'Loon Ilona', richting: 'uit', bedragC: 200000, van: '2026-11', tot: null, loon: 'ilona' }] };
  const ms = ['2026-10', '2026-11', '2026-12'], bezet = L.bezet(ev, '2026-10-30');
  const pr = L.postRegels(kas, ms, bezet);
  assert.deepStrictEqual(pr.filter(r => r.naam === 'Energie').map(r => r.ym), ['2026-12'], 'november heeft al een factuur');
  assert.deepStrictEqual(pr.filter(r => r.naam === 'Inhuur').map(r => r.ym), ['2026-11', '2026-12'], 'oktober-factuur raakt november niet');
  assert.strictEqual(L.postRegels(kas, ms).length, 6, 'zonder bezet telt alles');
  assert.strictEqual(L.loonVan('p:abc', 'Ilona X', null), 'ilona'); assert.strictEqual(L.loonVan('p:abd', 'Maarten X', null), 'maarten');
  assert.deepStrictEqual(L.kasTotalen([{ groep: 'vast', c: -100, ym: '2026-11', loon: 'maarten', naam: 'M', sleutel: 'p:abd' }], ['2026-11'], { loonMaarten: false }).vast.per, [0], 'loon Maarten uit');
  const rg = ev.map(e => L.kasRegel(e, { indeling: { 'n:energie test n.v.': 'vast' } }, '2026-10-30')).concat(pr);
  assert.deepStrictEqual(L.kasTotalen(rg, ms, {}).vast.per, [0, -143962 - 200000, -143961 - 200000]);
  assert.deepStrictEqual(L.kasTotalen(rg, ms, { loonIlona: false }).vast.per, [0, -143962, -143961], 'loon Ilona uit');
  const pat = [{ bron: 'patroon', patroon_id: 'pabc123', tegenpartij: 'Medewerker Test', richting: 'uit', bedrag: 2100, datum: '2026-12-01' }];
  const start = { posten: [{ id: 'startx', groep: 'vast', naam: 'Loon', richting: 'uit', bedragC: 210000, van: '2026-11', tot: null, lev: 'n:medewerker test', loon: 'ilona' }] };
  assert.deepStrictEqual(L.postRegels(L.kasEff(null, start), ms, L.bezet(pat, '2026-10-30')).map(r => r.ym), ['2026-11'], 'herkend patroon onder dezelfde naam vervangt de post');
  assert.strictEqual(L.kasEff({ posten: [] }, start).posten.length, 0, 'opgeslagen indeling wint'); assert.strictEqual(L.kasEff(null, null), null);
});
test('totalen: per maand, zeker, geheel en buiten beeld', () => {
  const ms = ['2026-10', '2026-11'];
  const rijen = [{ cellen: { '2026-10': 100, '2026-11': 200, '2027-05': 7 }, zeker: true }, { cellen: { '2026-11': -50, '2026-09': 3 }, zeker: false }];
  const t = L.totalen(rijen, ms);
  assert.deepStrictEqual(t.per, [100, 150]); assert.deepStrictEqual(t.zeker, [100, 200]); assert.strictEqual(t.som, 250); assert.strictEqual(t.somZeker, 300); assert.strictEqual(t.buiten, 10);
  assert.strictEqual(L.rijTotaal(rijen[0], ms), 300);
});
test('sorteren: op gaat zeker door, bedrag (leeg achteraan), maand en standaard datum', () => {
  const r = (id, o) => Object.assign({ id, naam: id, datum: '2026-10-0' + id.slice(-1), status: 'geaccepteerd', inclC: 100, exclC: 80, cellen: {}, zeker: false }, o);
  const rijen = [r('x1', { zeker: true }), r('x2', { inclC: null, exclC: null }), r('x3', { inclC: 500, exclC: 400, cellen: { '2026-11': 9 } })];
  assert.deepStrictEqual(L.sorteer(rijen, { sleutel: 'zeker', richting: 'af' }, 'incl', []).map(x => x.id)[0], 'x1');
  assert.deepStrictEqual(L.sorteer(rijen, { sleutel: 'bedrag', richting: 'af' }, 'incl', []).map(x => x.id), ['x3', 'x1', 'x2']);
  assert.deepStrictEqual(L.sorteer(rijen, { sleutel: 'bedrag', richting: 'op' }, 'incl', []).map(x => x.id), ['x1', 'x3', 'x2']);
  assert.deepStrictEqual(L.sorteer(rijen, { sleutel: 'bedrag', richting: 'op' }, 'excl', []).map(x => x.id), ['x1', 'x3', 'x2']);
  assert.deepStrictEqual(L.sorteer(rijen, { sleutel: 'm:2026-11', richting: 'af' }, 'incl', ['2026-11']).map(x => x.id)[0], 'x3');
  assert.deepStrictEqual(L.sorteer(rijen, null, 'incl', []).map(x => x.id), ['x3', 'x2', 'x1']);
  assert.deepStrictEqual(L.sortLees('m:2026-11:op'), { sleutel: 'm:2026-11', richting: 'op' }); assert.deepStrictEqual(L.sortLees('rommel'), L.SORT_STANDAARD);
});
console.log(`\n${n} tests geslaagd${process.exitCode ? ' (met fouten)' : ''}`);
