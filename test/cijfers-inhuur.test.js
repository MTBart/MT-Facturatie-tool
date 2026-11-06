// Cijfers: categorie "Vaste inhuur" (mt-cijfers.js), zonder DOM. Draaien: node test/cijfers-inhuur.test.js — nep-gegevens.
'use strict';
const assert = require('assert');
const Nep = require('./fixtures/cijfers-nep.js');
require('../mt-cijfers.js');
const C = globalThis.MTCijfers, st = C._st;
let n = 0; const test = async (naam, fn) => { try { await fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };

function zet(o) {
  const a = Nep.antwoord('2026-11', o);
  Object.assign(st, { maanden: a.perioden, cats: a.categorieen.map(c => c.id), catNaam: Object.fromEntries(a.categorieen.map(c => [c.id, c.naam])), bm: Object.assign({}, a.benchmarks, { personeel: { van: 15, tot: 19, bron: 'CBS' }, uitbesteed: { van: 5, tot: 6, bron: 'CBS' } }),
    ontbrekend: [], mislukt: [], vandaag: '2026-11-05', jaar: 2026, zoom: 'J', eerlijk: false, vgl: { j1: true, j2: true, b: true }, sel: null, stapelSel: null, kCache: {}, kTop: null, kUit: null, focusCat: null, prognoseRuw: {}, kasProg: null });
}
const vergelijk = () => { const per = C.periodes(st.maanden, 'J', 2026, '2026-10', []), i = per.findIndex(p => p.id === '2026'); per.forEach(p => { p.P = C.som(p.ms, st.cats, st.eerlijk); });
  return C.stapelVergelijk({ per, i, zoom: 'J', jaar: 2026, maanden: st.maanden, cats: st.cats, eerlijk: st.eerlijk, bm: st.bm, lm: '2026-10', offsets: [1, 2] }); };

(async () => {
  await test('som: inhuur telt mee in de kosten, totaal en resultaat gelijk, brutomarge rekent inhuur niet als uitbesteed', () => {
    const zonder = Nep.antwoord('2026-11'), met = Nep.antwoord('2026-11', { inhuur: true }), cz = zonder.categorieen.map(c => c.id), cm = met.categorieen.map(c => c.id);
    const a = C.som(zonder.perioden, cz, false), b = C.som(met.perioden, cm, false);
    assert.ok(b.kosten.inhuur > 0); assert.strictEqual(b.kosten_totaal, a.kosten_totaal); assert.strictEqual(b.resultaat, a.resultaat); assert.strictEqual(b.brutomarge, a.brutomarge);
    assert.strictEqual(b.kosten.personeel + b.kosten.inhuur, a.kosten.personeel);
  });
  await test('kleur: inhuur heeft een eigen klasse, anders dan alle andere categorieën; oude cats ongewijzigd', () => {
    const cats = Nep.antwoord('2026-11', { inhuur: true }).categorieen.map(c => c.id), kl = cats.map(c => C.katKlasse(c, cats));
    assert.strictEqual(C.katKlasse('inhuur', cats), 'mtd-k7'); assert.strictEqual(new Set(kl).size, kl.length, 'elke categorie een eigen kleur');
    assert.deepStrictEqual(['materiaal', 'uitbesteed', 'personeel', 'huisvesting', 'overig'].map(c => C.katKlasse(c, [])), ['mtd-k0', 'mtd-k1', 'mtd-k2', 'mtd-k3', 'mtd-k4']);
  });
  await test('branche: personeel oordeelt op personeel + inhuur samen, eigen waarden blijven apart; inhuur heeft geen eigen norm', () => {
    zet({ inhuur: true }); const v = vergelijk(), pers = v.onderdelen.find(o => o.id === 'personeel'), ih = v.onderdelen.find(o => o.id === 'inhuur');
    assert.ok(ih && ih.v > 0 && pers.v > 0); assert.ok(pers.samen > pers.v && Math.abs(pers.samen - (pers.v + ih.v)) < 1e-9, 'samen = personeel + inhuur');
    assert.ok(/samen/.test(pers.noot)); assert.strictEqual(ih.branche.oordeel, null); assert.ok(/personeel/.test(ih.branche.reden));
    // zelfde oordeel als wanneer de bedragen nog in personeel zaten
    zet(); const oud = vergelijk().onderdelen.find(o => o.id === 'personeel');
    assert.strictEqual(pers.branche.oordeel.niveau, oud.branche.oordeel.niveau); assert.ok(Math.abs(pers.branche.oordeel.pp - oud.branche.oordeel.pp) < 1e-9);
  });
  await test('oude worker zonder inhuur: geen crash, geen inhuur-onderdeel, geen noot', () => {
    zet(); const v = vergelijk(); assert.ok(!v.onderdelen.some(o => o.id === 'inhuur')); assert.strictEqual(v.onderdelen.find(o => o.id === 'personeel').noot, '');
  });
  await test('laden: inhuur zonder bedragen (instelling uit) of oude cache blijft uit de categorielijst; met bedragen staat hij erin', async () => {
    const laad = async antwoord => { st.el = null; st.rondes = 0; st.bron = { haal: async p => p.startsWith('/geld/cijfers?') ? antwoord : null }; st.maanden = []; await C.laad(); return st.cats; };
    const leeg = Nep.antwoord('2026-11', { inhuur: true }); leeg.perioden.forEach(m => { m.kosten.personeel += m.kosten.inhuur; m.kosten.inhuur = 0; });
    assert.ok(!(await laad(leeg)).includes('inhuur'), 'nul = verborgen');
    assert.ok(!(await laad(Nep.antwoord('2026-11'))).includes('inhuur'), 'oude worker');
    const oud = Nep.antwoord('2026-11', { inhuur: true }); oud.perioden.forEach(m => { delete m.kosten.inhuur; });
    assert.ok(!(await laad(oud)).includes('inhuur'), 'categorie genoemd, maar maandrecords zonder veld: geen crash, niet getoond');
    assert.ok((await laad(Nep.antwoord('2026-11', { inhuur: true }))).includes('inhuur'));
  });
  await test('aandachtspunt: een begrensde maand staat met maand en niet-verschoven bedrag in het statuspaneel', () => {
    zet({ inhuur: true }); st.inhuurAfw = []; assert.ok(!C.statusItems().aandacht.some(t => /Vaste inhuur/.test(t)));
    st.inhuurAfw = [{ maand: '2026-03', ledger: '700200', factuur: 900, wv: 300, verschoven: 300 }];
    const t = C.statusItems().aandacht.find(x => /Vaste inhuur/.test(x)); assert.ok(t && /600/.test(t) && /mrt|maart/i.test(t), t);
  });
  console.log(`\n${n} tests geslaagd`);
})();
