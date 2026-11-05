// Visuele cijfers: periodetabel, stapel-rekening, oordelen, omzetzin, kostenvergelijking (mt-cijfers.js), zonder DOM. Draaien: node test/cijfers-visueel.test.js â€” nep-gegevens.
'use strict';
const assert = require('assert');
const Nep = require('./fixtures/cijfers-nep.js');
require('../mt-cijfers.js');
const C = globalThis.MTCijfers, st = C._st;
let n = 0; const test = (naam, fn) => { try { fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };

function zet(opt) {
  const a = Nep.antwoord('2026-11');
  Object.assign(st, { maanden: a.perioden, cats: a.categorieen.map(c => c.id), catNaam: Object.fromEntries(a.categorieen.map(c => [c.id, c.naam])), bm: a.benchmarks, ontbrekend: [], mislukt: [],
    vandaag: '2026-11-05', jaar: 2026, zoom: 'M', eerlijk: true, vgl: { j1: true, j2: true, b: true }, sel: null, stapelSel: null, focusCat: null, prognoseRuw: Nep.prognose().items, kasProg: null }, opt || {});
}
const tabel = (zoom, extra) => C.periodeTabelModel(Object.assign({ maanden: st.maanden, cats: st.cats, eerlijk: true, zoom, jaar: 2026, jaren: [2026, 2025, 2024], lm: '2026-10', rest: { '2026-11': 15000, '2026-12': 20000 }, meet: P => P.omzet }, extra || {}));
const OM = { 2026: [38, 41, 52, 47, 55, 61, 44, 36, 58, 63], 2025: [34, 37, 45, 44, 49, 52, 40, 31, 50, 55, 53, 47] };

// â”€â”€ periodetabel â”€â”€
test('periodetabel: Maand geeft 12 kolommen jan..dec, Kwartaal 4 kolommen K1..K4', () => {
  zet(); const m = tabel('M'), k = tabel('K');
  assert.deepStrictEqual(m.kolommen.map(x => x.label), ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']);
  assert.deepStrictEqual(k.kolommen.map(x => x.label), ['K1', 'K2', 'K3', 'K4']);
  assert.strictEqual(m.rijen.length, 3); assert.ok(m.rijen.every(r => r.cellen.length === 12)); assert.ok(k.rijen.every(r => r.cellen.length === 4));
});
test('periodetabel: de tabel volgt de knop (zoom K telt de maanden van het kwartaal op)', () => {
  zet(); const k = tabel('K'), r = k.rijen[0];
  assert.strictEqual(r.cellen[0].v, (38 + 41 + 52) * 1000); assert.strictEqual(r.cellen[1].v, (47 + 55 + 61) * 1000);
  assert.strictEqual(k.rijen[1].cellen[3].v, (55 + 53 + 47) * 1000);
});
test('periodetabel: afgesloten maanden tellen, de lopende maand niet; verwacht staat apart', () => {
  zet(); const r = tabel('M').rijen[0];
  assert.strictEqual(r.cellen[9].v, 63000); assert.strictEqual(r.cellen[10].v, null, 'november is lopend: niet geboekt meetellen');
  assert.strictEqual(r.cellen[10].fc, 15000); assert.strictEqual(r.cellen[11].fc, 20000); assert.strictEqual(r.cellen[0].fc, 0);
  assert.strictEqual(r.cellen[10].reden, 'nog niet afgesloten');
});
test('periodetabel: "â€”" met reden bij ontbrekende data, nooit 0', () => {
  zet(); st.maanden = st.maanden.filter(m => m.id !== '2025-03'); const t = tabel('M'), c = t.rijen[1].cellen[2];
  assert.strictEqual(c.v, null); assert.strictEqual(c.reden, 'niet opgehaald'); assert.ok(t.rijen[0].cellen[2].v > 0);
  assert.strictEqual(t.verschil.cellen[2].d, null); assert.ok(/geen gegevens 2025/.test(t.verschil.cellen[2].reden));
});
test('periodetabel: verschil alleen op afgesloten periodes (kwartaal)', () => {
  zet(); const t = tabel('K'), v = t.verschil;
  assert.ok(v.cellen[0].d != null && Math.abs(v.cellen[0].d - ((131 - 116) / 116 * 100)) < 1e-9, 'K1: ' + v.cellen[0].d);
  assert.strictEqual(v.cellen[3].d, null, 'K4 is nog niet afgesloten'); assert.ok(/alleen afgesloten|nog niet/.test(v.cellen[3].reden));
  const q3 = t.rijen[0].cellen[2]; assert.strictEqual(q3.vol, true); assert.strictEqual(t.rijen[0].cellen[3].v, 63000); assert.strictEqual(t.rijen[0].cellen[3].vol, false, 'K4 is deels geboekt');
});
test('periodetabel: totaal t/m laatste afgesloten maand en eerlijk vergeleken met vorig jaar', () => {
  zet(); const t = tabel('M'), som = a => a.reduce((x, y) => x + y, 0);
  assert.strictEqual(t.totaalLabel, 't/m okt'); assert.strictEqual(t.rijen[0].totaal.v, som(OM[2026]) * 1000);
  assert.strictEqual(t.rijen[1].totaal.v, som(OM[2025].slice(0, 10)) * 1000, 'vorig jaar t/m dezelfde maand');
  assert.ok(Math.abs(t.verschil.totaal.d - (som(OM[2026]) - som(OM[2025].slice(0, 10))) / som(OM[2025].slice(0, 10)) * 100) < 1e-9);
});
test('periodetabel: ontbrekende maand in vergelijkjaar geeft geen totaal-vergelijking', () => {
  zet(); st.maanden = st.maanden.filter(m => m.id !== '2025-07'); const t = tabel('M');
  assert.strictEqual(t.rijen[1].totaal.v, null); assert.strictEqual(t.verschil.totaal.d, null); assert.ok(t.verschil.totaal.reden);
});
test('periodetabel: zonder afgesloten maand geen cijfers en geen verschil', () => {
  zet(); const t = tabel('M', { lm: null, rest: {} });
  assert.ok(t.rijen.every(r => r.cellen.every(c => c.v == null))); assert.strictEqual(t.verschil.cellen[0].d, null); assert.strictEqual(t.totaalLabel, 'Jaar');
});
test('periodetabel jaren-vorm: kolommen zijn jaren, verschil met het jaar ervoor alleen bij afgesloten jaren', () => {
  zet(); st.zoom = '5J'; const per = C.periodes(st.maanden, '5J', 2026, '2026-10', []).map(p => Object.assign(p, { P: C.som(p.ms, st.cats, true) }));
  const t = C.periodeTabelJaren(per, { zoom: '5J', lm: '2026-10', meet: P => P.omzet });
  assert.deepStrictEqual(t.kolommen.map(k => k.label), ['2022', '2023', '2024', '2025', '2026']);
  assert.strictEqual(t.verschil.cellen[0].d, null); assert.ok(t.verschil.cellen[2].d > 0); assert.strictEqual(t.verschil.cellen[4].d, null, '2026 is nog niet volledig');
  assert.strictEqual(t.rijen[0].cellen[4].vol, false);
  const tj = C.periodeTabelJaren(C.periodes(st.maanden, 'J', 2026, '2026-10', []).map(p => Object.assign(p, { P: C.som(p.ms, st.cats, true) })), { zoom: 'J', lm: '2026-10', meet: P => P.omzet });
  assert.ok(tj.verschil.cellen[4].d != null, 'jaar t/m nu: alle jaren t/m dezelfde maand, dus wel vergelijkbaar');
});
test('categoriekleuren: vast per categorie, resultaat apart, onbekende categorie krijgt een eigen plek', () => {
  assert.strictEqual(C.katKlasse('materiaal', []), 'mtd-k0'); assert.strictEqual(C.katKlasse('overig', ['x']), 'mtd-k4'); assert.strictEqual(C.katKlasse('resultaat', []), 'mtd-kres');
  const cats = ['materiaal', 'vervoer', 'overig', 'kantoor']; assert.strictEqual(C.katKlasse('vervoer', cats), 'mtd-k5'); assert.strictEqual(C.katKlasse('kantoor', cats), 'mtd-k6');
  assert.strictEqual(C.katKlasse('materiaal', cats), C.katKlasse('materiaal', ['a']));
});

// ── oordeel en stapel ──
const perM = (zoom, jaar) => C.periodes(st.maanden, zoom, jaar || 2026, '2026-10', []).map(p => Object.assign(p, { P: C.som(p.ms, st.cats, true) }));
const vgl = (zoom, i, extra) => C.stapelVergelijk(Object.assign({ per: perM(zoom), i, zoom, jaar: 2026, maanden: st.maanden, cats: st.cats, eerlijk: true, bm: st.bm, lm: '2026-10', offsets: [1, 2] }, extra || {}));
test('oordeel: drempels uit één constante, woord + niveau, hoger/lager is goed', () => {
  assert.deepStrictEqual([C.DREMPEL.INLIJN_PP, C.DREMPEL.SLECHT_PP], [1, 5]);
  assert.strictEqual(C.oordeel(53, { van: 50, tot: 56 }, true).woord, 'in lijn');
  assert.strictEqual(C.oordeel(60, { van: 50, tot: 56 }, true).woord, 'beter'); assert.strictEqual(C.oordeel(60, { van: 50, tot: 56 }, true).niveau, 'goed');
  assert.strictEqual(C.oordeel(47, { van: 50, tot: 56 }, true).niveau, 'let-op');
  assert.strictEqual(C.oordeel(40, { van: 50, tot: 56 }, true).niveau, 'slecht');
  assert.strictEqual(C.oordeel(35, 28, false).niveau, 'slecht', 'kosten veel hoger = slecht'); assert.strictEqual(C.oordeel(20, 28, false).niveau, 'goed');
  assert.strictEqual(C.oordeel(28.9, { pct: 28 }, false).woord, 'in lijn');
});
test('oordeel: geen oordeel zonder waarde of referentie', () => {
  assert.strictEqual(C.oordeel(null, 5, true), null); assert.strictEqual(C.oordeel(5, null, true), null); assert.strictEqual(C.oordeel(5, {}, true), null); assert.strictEqual(C.oordeel(NaN, 5, true), null);
});
test('stapel: de som van de delen is de omzet, per periode, ook per kwartaal en jaar', () => {
  zet(); for (const [zoom, j] of [['M', 2026], ['K', 2025], ['5J', 2026]]) {
    const m = C.stapelModel(zoom === '5J' ? C.periodes(st.maanden, '5J', 2026, '2026-10', []).map(p => Object.assign(p, { P: C.som(p.ms, st.cats, true) })) : perM(zoom, j), st.cats);
    for (const k of m.kolommen.filter(x => !x.geen)) { assert.ok(Math.abs(k.som - k.omzet) < 1e-6, `${zoom} ${k.id}: ${k.som} != ${k.omzet}`); assert.ok(Math.abs(k.delen.reduce((a, d) => a + d.pct, 0) - 100) < 1e-6); }
  }
});
test('stapel: alleen geboekte cijfers; periode zonder boeking is leeg', () => {
  zet(); const m = C.stapelModel(perM('M'), st.cats); assert.strictEqual(m.kolommen[11].geen, true);
  assert.strictEqual(m.kolommen[0].geen, false);
});
test('stapel: negatief resultaat staat onder de nullijn en maakt de stapel niet vals', () => {
  zet(); const mm = st.maanden.find(x => x.id === '2026-03'); mm.omzet = 20000;
  const k = C.stapelModel(perM('M'), st.cats).kolommen[2]; assert.ok(k.resultaat < 0); assert.ok(k.onder && k.onder.y1 === k.resultaat && k.onder.y0 === 0);
  assert.ok(!k.boven.some(s => s.id === 'resultaat'), 'geen resultaatdeel boven de nul'); assert.ok(Math.abs(k.top - (k.omzet - k.resultaat)) < 1e-6, 'stapel loopt tot de kosten');
  assert.ok(k.top > k.omzet); assert.ok(Math.abs(k.som - k.omzet) < 1e-6);
  const m = C.stapelModel(perM('M'), st.cats); assert.strictEqual(m.min, k.resultaat);
});
test('stapel: een creditpost (negatieve kosten) wordt niet als stuk getekend maar blijft in de som', () => {
  zet(); const mm = st.maanden.find(x => x.id === '2026-02'); mm.kosten.overig = -500;
  const k = C.stapelModel(perM('M'), st.cats).kolommen[1]; assert.ok(!k.boven.some(s => s.id === 'overig')); assert.strictEqual(k.credit, 500); assert.ok(Math.abs(k.som - k.omzet) < 1e-6);
});
test('stapelvergelijk: afgesloten periode vergelijkt met twee vorige jaren en de branche', () => {
  zet(); const v = vgl('M', 2), bm = v.onderdelen.find(o => o.id === 'brutomarge');
  assert.strictEqual(v.afgesloten, true); assert.strictEqual(v.vorig.length, 2); assert.ok(bm.vorig.every(q => q.v != null && q.oordeel));
  assert.ok(Math.abs(bm.v - 66.5) < 0.05); assert.strictEqual(bm.branche.oordeel.niveau, 'goed'); assert.strictEqual(bm.branche.oordeel.beter, true);
});
test('stapelvergelijk: branche ontbreekt voor een categorie = "—" met reden, geen oordeel', () => {
  zet(); const mat = vgl('M', 2).onderdelen.find(o => o.id === 'materiaal');
  assert.strictEqual(mat.branche.oordeel, null); assert.ok(/geen branchecijfer voor materiaal/.test(mat.branche.reden));
  const b0 = vgl('M', 2, { bm: {} }).onderdelen.find(o => o.id === 'brutomarge'); assert.strictEqual(b0.branche.oordeel, null); assert.ok(b0.branche.reden);
  const mat2 = vgl('M', 2, { bm: { materiaal: { van: 24, tot: 28 } } }).onderdelen.find(o => o.id === 'materiaal'); assert.ok(mat2.branche.oordeel);
});
test('stapelvergelijk: ontbrekend vorig jaar of niet afgesloten periode = "—" met reden, nooit 0', () => {
  zet(); st.maanden = st.maanden.filter(m => m.id !== '2025-03'); const v = vgl('M', 2), q = v.vorig[0];
  assert.strictEqual(q.u, undefined); assert.ok(/geen gegevens 2025/.test(q.reden)); assert.ok(v.onderdelen.every(o => o.vorig[0].v === null && o.vorig[0].oordeel === null && o.vorig[0].reden));
  assert.ok(v.onderdelen.every(o => o.vorig[1].v != null), '2024 blijft wel beschikbaar');
  zet(); const lopend = vgl('M', 10); assert.strictEqual(lopend.afgesloten, false); assert.ok(/nog niet afgesloten/.test(lopend.reden));
  assert.ok(lopend.onderdelen.every(o => o.vorig.every(q => q.v === null && /nog niet afgesloten/.test(q.reden)) && /nog niet afgesloten/.test(o.branche.reden) && o.branche.oordeel === null));
  assert.strictEqual(vgl('K', 3).afgesloten, false);
});
test('stapelvergelijk: jaar-vorm vergelijkt met voorgaande jaren; 2026 t/m nu is vergelijkbaar, 5 jaar niet', () => {
  zet(); const per = C.periodes(st.maanden, 'J', 2026, '2026-10', []).map(p => Object.assign(p, { P: C.som(p.ms, st.cats, true) }));
  const v = C.stapelVergelijk({ per, i: per.length - 1, zoom: 'J', jaar: 2026, maanden: st.maanden, cats: st.cats, eerlijk: true, bm: st.bm, lm: '2026-10', offsets: [1, 2] });
  assert.strictEqual(v.afgesloten, true); assert.ok(v.vorig.every(q => q.u)); assert.strictEqual(v.vorig[0].jaar, 2025);
  const per5 = C.periodes(st.maanden, '5J', 2026, '2026-10', []).map(p => Object.assign(p, { P: C.som(p.ms, st.cats, true) }));
  assert.strictEqual(C.stapelVergelijk({ per: per5, i: per5.length - 1, zoom: '5J', jaar: 2026, maanden: st.maanden, cats: st.cats, eerlijk: true, bm: st.bm, lm: '2026-10', offsets: [1, 2] }).afgesloten, false);
});

test('omzetzin: voor, achter, gelijk en niet te vergelijken, in woorden', () => {
  const c0 = [10000, 25000, 40000], c1 = [9000, 20000, 30000];
  const z = C.cumulZin(c0, c1, 3, 2026); assert.strictEqual(z.richting, 1); assert.ok(/Eind maart/.test(z.tekst) && /voor op 2025/.test(z.tekst) && /33,3%/.test(z.tekst) && /10\.000/.test(z.tekst), z.tekst);
  const a = C.cumulZin([1, 2, 20], [5, 6, 40], 3, 2026); assert.strictEqual(a.richting, -1); assert.ok(/achter op 2025/.test(a.tekst));
  assert.strictEqual(C.cumulZin([1, 2, 30], [5, 6, 30], 3, 2026).richting, 0);
  const g = C.cumulZin(c0, [9000, null, null], 3, 2026); assert.strictEqual(g.richting, null); assert.ok(/Geen vergelijking met 2025/.test(g.tekst) && !/voor|achter/.test(g.tekst));
  assert.strictEqual(C.cumulZin([null], null, 0, 2026).richting, null);
});

test('kostenzin: alleen uit de cijfers, met woorden van het oordeel, geen oorzaak', () => {
  zet(); const o = vgl('M', 2).onderdelen.find(x => x.id === 'materiaal'); st.bm.materiaal = { van: 14, tot: 18 };
  const o2 = vgl('M', 2).onderdelen.find(x => x.id === 'materiaal'), z = C.kostenZin(o2);
  assert.ok(/^Materiaal is 26,5% van de omzet/.test(z), z); assert.ok(/in 2025/.test(z) && /boven de branche/.test(z) && /duidelijk slechter/.test(z), z);
  assert.ok(!/omdat|doordat|komt door|oorzaak/i.test(z));
  const z0 = C.kostenZin(o); assert.ok(/in 2025 \(in lijn\)/.test(z0) && !/branche/.test(z0), z0);
  st.maanden = st.maanden.filter(m => !m.id.startsWith('2025-') && !m.id.startsWith('2024-')); const z1 = C.kostenZin(vgl('M', 2, { bm: {} }).onderdelen.find(x => x.id === 'materiaal'));
  assert.ok(/Geen vergelijking mogelijk/.test(z1) && /geen gegevens 2025/.test(z1), z1);
  assert.strictEqual(C.kostenZin({ v: null }), 'Geen cijfers voor deze periode.');
});
(async () => {
  try {
    zet(); const lopen = []; let actief = 0, maxActief = 0;
    st.bron = { haal: async u => { lopen.push(u); actief++; maxActief = Math.max(maxActief, actief); await new Promise(r => setTimeout(r, 2)); actief--;
      if (/2026-03/.test(u)) throw new Error('stuk'); if (/2026-05/.test(u)) return { error: 'nee' }; return { items: [{ tegenpartij: 'Nep A', bedrag: 100 }, { tegenpartij: 'Nep B', bedrag: 50 }, { tegenpartij: 'Nep A', bedrag: 25 }], meer: 0 }; } };
    const p1 = C._laadKosten('materiaal'), p2 = C._laadKosten('materiaal'); await Promise.all([p1, p2]);
    assert.strictEqual(lopen.length, 10, 'één verzoek per afgesloten maand, geen tweede ronde'); assert.strictEqual(maxActief, 1, 'achter elkaar, geen storm');
    assert.ok(lopen.every(u => /reeks=kosten&categorie=materiaal/.test(u)));
    assert.strictEqual(st.kTop.laden, false); assert.strictEqual(st.kTop.fouten, 2); assert.strictEqual(st.kTop.onvolledig, true);
    assert.deepStrictEqual(st.kTop.items.map(x => [x.naam, x.v]), [['Nep A', 125 * 8], ['Nep B', 50 * 8]]);
    // annuleren: de lopende ronde stopt na het wegzetten
    lopen.length = 0; st.bron.haal = async u => { lopen.push(u); await new Promise(r => setTimeout(r, 2)); if (lopen.length === 3) st.kTop = null; return { items: [] }; };
    st.kTop = null; await C._laadKosten('uitbesteed'); assert.strictEqual(lopen.length, 3, 'gestopt na annuleren'); assert.strictEqual(st.kTop, null);
    // alles mislukt: geen blijvende laadstand
    st.bron.haal = async () => { throw new Error('x'); }; await C._laadKosten('personeel'); assert.strictEqual(st.kTop.laden, false); assert.strictEqual(st.kTop.fouten, 10); assert.strictEqual(st.kTop.items.length, 0);
    n++; console.log('ok  - kosten-leveranciers: één ronde, achter elkaar, annuleerbaar, fouten en onvolledig zonder blijvende laadstand');
  } catch (e) { console.log('FOUT - kosten-leveranciers\n' + (e.stack || e)); process.exitCode = 1; }
  console.log(`${n} tests gedaan`);
})();
