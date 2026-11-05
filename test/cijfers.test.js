// Rekenregels en tekenmodel van het cijfers-dashboard (mt-cijfers.js), zonder DOM. Draaien: node test/cijfers.test.js — nep-gegevens.
'use strict';
const assert = require('assert');
const Nep = require('./fixtures/cijfers-nep.js');
require('../mt-cijfers.js');
const C = globalThis.MTCijfers, st = C._st;
let n = 0; const test = (naam, fn) => { try { fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };

function zet(opt) {
  const a = Nep.antwoord('2026-11');
  Object.assign(st, { maanden: a.perioden, cats: a.categorieen.map(c => c.id), catNaam: Object.fromEntries(a.categorieen.map(c => [c.id, c.naam])), bm: a.benchmarks, ontbrekend: [], mislukt: [],
    vandaag: '2026-11-05', jaar: 2026, zoom: 'M', eerlijk: true, vgl: { j1: true, j2: true, b: true }, sel: null, focusCat: null, prognoseRuw: Nep.prognose().items, kasProg: null }, opt || {});
}

test('schaal: alle waarden (ook negatief en groot) liggen binnen de as', () => {
  const sc = C.schaalVoor([[10, 250, null], [-40, 90], [NaN, undefined, 120000]], {});
  for (const v of [10, 250, -40, 90, 120000, 0]) assert.ok(v >= sc.a && v <= sc.b, `${v} buiten ${sc.a}..${sc.b}`);
  assert.ok(sc.ticks.length >= 2);
});
test('schaal: zonder waarden een bruikbare lege as; min/max forceren', () => {
  const leeg = C.schaalVoor([[null]], {}); assert.ok(leeg.b > leeg.a);
  const m = C.schaalVoor([[5, 6]], { min: 0, max: 100 }); assert.ok(m.a <= 0 && m.b >= 100);
  const geenNul = C.schaalVoor([[500, 600]], { nul: false }); assert.ok(geenNul.a > 0);
});
test('verzamel: negeert niet-getallen', () => { assert.deepStrictEqual(C.verzamel([[1, null, 'x', NaN, Infinity], 3, [undefined]]), [1, 3]); });

// Alle y-waarden van lijnen/paden/punten moeten binnen het tekengebied liggen (dit was de schaalfout: de vergelijkjaren en de referentielijn telden niet mee).
function yWaarden(svg) {
  const ys = [];
  for (const m of svg.matchAll(/<path d="([^"]+)"/g)) for (const q of m[1].matchAll(/[ML]([\d.\-]+) ([\d.\-]+)/g)) ys.push(Number(q[2]));
  for (const m of svg.matchAll(/<circle[^>]* cy="([\d.\-]+)"/g)) ys.push(Number(m[1]));
  for (const m of svg.matchAll(/<line [^>]*x1="([\d.\-]+)" x2="([\d.\-]+)" y1="([\d.\-]+)" y2="([\d.\-]+)"/g)) if (m[1] !== m[2] && m[3] === m[4]) ys.push(Number(m[3]));
  return ys;
}
const BOVEN = 24, ONDER = 260 - 30;   // MT en HO-MB uit mt-cijfers.js (HO = 260 bij brede grafiek)
for (const zoom of ['M', 'K']) for (const eerlijk of [true, false]) for (const g of ['omzet_kosten', 'brutomarge', 'kas']) {
  test(`schaal-bug: ${g} zoom ${zoom} eerlijk ${eerlijk}: niets buiten de grafiek`, () => {
    zet({ zoom, eerlijk }); const html = C._grafiekHtml(g), ys = yWaarden(html);
    assert.ok(ys.length > 5, 'er moet iets getekend zijn');
    for (const y of ys) assert.ok(y >= BOVEN - 0.6 && y <= ONDER + 0.6, `y=${y} buiten ${BOVEN}..${ONDER} in ${g}`);
  });
}
test('schaal-bug: vergelijkjaar met veel hogere waarden dwingt de as mee (omzet)', () => {
  zet({ zoom: 'M', vergelijk: 2 }); const hoog = st.maanden.find(m => m.id === '2025-06'); const oud = hoog.omzet; hoog.omzet = 900000;
  try { const ys = yWaarden(C._grafiekHtml('omzet_kosten')); for (const y of ys) assert.ok(y >= BOVEN - 0.6 && y <= ONDER + 0.6, `y=${y}`); }
  finally { hoog.omzet = oud; }
});

test('som: boekjaar t/m oktober, prognose telt niet mee', () => {
  zet(); const ms = st.maanden.filter(m => m.id >= '2026-01' && m.id <= '2026-10'), P = C.som(ms, st.cats, true);
  assert.strictEqual(P.omzet, [38, 41, 52, 47, 55, 61, 44, 36, 58, 63].reduce((a, b) => a + b, 0) * 1000);
  assert.strictEqual(P.prognose, 0);
});
test('tegels: omzet t/m oktober, vergelijking en forecast apart gehouden', () => {
  zet(); const tg = C._tegels(), o = tg.find(x => x.id === 'omzet');
  assert.strictEqual(tg.length, 6); assert.strictEqual(o.waarde, '€ 495k'); assert.strictEqual(o.chip.pijl, '▲'); assert.ok(/13,3%/.test(o.chip.tekst));
  const k = tg.find(x => x.id === 'komende'); assert.strictEqual(k.tot, 140000); assert.ok(k.forecast);
  const op = tg.find(x => x.id === 'opnames'); assert.strictEqual(op.waarde, '€ 40k'); assert.ok(!tg.some(x => x.id === 'debiteuren'));   // geen bron voor debiteuren: geen tegel, geen verzonnen getal
  assert.strictEqual(tg.A.prognose, 0);
});
test('tegels: ontbrekende vorig-jaar-maand geeft geen vergelijking', () => {
  zet(); st.maanden = st.maanden.filter(m => m.id !== '2025-03'); const o = C._tegels().find(x => x.id === 'omzet');
  assert.strictEqual(o.chip, null); assert.ok(!o.rijen.some(r => r.soort === 'j1'));
});
test('sparkline: alle punten binnen 4..36 op één gedeelde schaal', () => {
  zet(); for (const t of C._tegels()) { if (!t.spark) continue; for (const d of Object.values(t.spark)) for (const m of d.matchAll(/[ML]([\d.]+) ([\d.-]+)/g)) assert.ok(Number(m[2]) >= 3.9 && Number(m[2]) <= 36.1, t.id + ' ' + m[2]); }
});
test('feitzinnen: omzet, bron erbij, uit de gegevens', () => {
  zet(); const f = C.feiten('omzet'); assert.ok(f.length >= 4); assert.ok(f.every(x => x.t && x.bron));
  assert.ok(/495k/.test(f[0].t) && /58k/.test(f[0].t) && /13,3%/.test(f[0].t));
  assert.ok(f.some(x => /augustus/.test(x.t)));
  assert.ok(f.some(x => /forecast/.test(x.bron)));
});
test('feitzinnen: geen forecast-zin zonder forecast', () => { zet({ prognoseRuw: {} }); assert.ok(!C.feiten('omzet').some(x => /forecast/.test(x.bron))); });
test('status: aandachtspunten en toelichting', () => {
  zet({ mislukt: ['2025-05'], ontbrekend: ['2025-05'], waarsch: ['Nep-waarschuwing'] }); const s = C.statusItems();
  assert.ok(s.aandacht.some(x => /2025/.test(x) && /niet worden opgehaald/.test(x))); assert.ok(s.aandacht.includes('Nep-waarschuwing')); assert.ok(s.uitleg.some(x => /Forecast/.test(x)) && s.uitleg.some(x => /Eerlijk beeld/.test(x)));
  zet({ mislukt: [], ontbrekend: [], waarsch: [] }); assert.strictEqual(C.statusItems().aandacht.length, 0);
});
test('vergelijk-schakelaars: onthouden en terugzetten', () => { assert.deepStrictEqual(C.vglLees(C.vglTekst({ j1: true, j2: false, b: true })), { j1: true, j2: false, b: true }); assert.deepStrictEqual(C.vglLees('xx'), { j1: true, j2: true, b: true }); });
test('feitzinnen: ontbrekende maand = geen uitspraken (omzet, brutomarge, resultaat)', () => {
  zet(); st.maanden = st.maanden.filter(m => m.id !== '2026-04');
  for (const id of ['omzet', 'brutomarge', 'resultaat', 'kas']) assert.deepStrictEqual(C.feiten(id), [], id);
});
test('feitzinnen: nooit "positief"; resultaat €0 blijft neutraal', () => {
  zet(); assert.ok(!C.feiten('resultaat').some(x => /positief/.test(x.t)));
  const m = st.maanden.find(x => x.id === '2026-03'), oud = m.omzet; m.omzet = m.kosten_totaal + m.correctie;   // resultaat precies 0 (eerlijk beeld: correctie telt als kosten)
  try { const f = C.feiten('resultaat'); assert.ok(!f.some(x => /positief/.test(x.t) || (/negatief/.test(x.t) && /maart/.test(x.t)))); } finally { m.omzet = oud; }
});
test('schaal: negatieve brancheband en referentiewaarden vallen binnen de as (geen +10-truc)', () => {
  zet({ zoom: 'M' }); st.bm = { brutomarge: { van: -35, tot: -20, bron: 'nep' } }; const html = C._grafiekHtml('brutomarge');
  const r = /<rect x="[\d.]+" y="([\d.\-]+)" width="[\d.]+" height="([\d.\-]+)" fill="#e4e7eb"/.exec(html); assert.ok(r, 'bandje getekend');
  assert.ok(Number(r[1]) >= BOVEN - 0.6 && Number(r[1]) + Number(r[2]) <= ONDER + 0.6, `band ${r[1]}+${r[2]} buiten ${BOVEN}..${ONDER}`);
  st.bm = { brutomarge: { pct: 95 } }; const y2 = /<line x1="[\d.]+" x2="[\d.]+" y1="([\d.\-]+)" y2="[\d.\-]+" stroke="#7f8a96"/.exec(C._grafiekHtml('brutomarge')); assert.ok(y2 && Number(y2[1]) >= BOVEN - 0.6, 'lijn op 95% binnen de grafiek');
});
test('komende 3 maanden: eerlijk gelabeld als verwachting, niet ontdubbeld met boekingen', () => {
  zet(); const k = C._tegels().find(x => x.id === 'komende'); assert.ok(/verwachting uit forecast/.test(k.sub));
  const alles = [k.sub, ...C.statusItems().uitleg, ...C.feiten('komende').map(x => x.t + x.bron)].join(' ');
  assert.ok(/niet ontdubbeld/.test(alles)); assert.ok(!/geen geboekte omzet/.test(alles));
});
(async () => {
  try {
    zet(); st.paneel = null; let n1 = 0; st.bron = { haal: async u => { n1++; if (/2026-03/.test(u)) throw new Error('stuk'); if (/2026-05/.test(u)) return { error: 'nee' }; return { items: [{ tegenpartij: 'Nep A', bedrag: 100 }] }; } };
    const p1 = C._laadTop(), p2 = C._laadTop(); await Promise.all([p1, p2]);
    assert.strictEqual(n1, 10, 'één verzoek per maand, geen tweede ronde'); assert.strictEqual(st.top.laden, false); assert.strictEqual(st.top.fouten, 2); assert.strictEqual(st.top.onvolledig, true); assert.strictEqual(st.top.items[0].v, 800);
    st.bron = { haal: async () => ({ items: [{ tegenpartij: 'Nep B', bedrag: 5 }] }) }; await C._laadTop(); assert.strictEqual(st.top.fouten, 0); assert.strictEqual(st.top.laden, false);   // opnieuw proberen
    n++; console.log('ok  - grootste klanten: fout/exceptie zet laden uit, onvolledig + opnieuw proberen, geen dubbele verzoeken');
  } catch (e) { console.log('FOUT - grootste klanten\n' + (e.stack || e)); process.exitCode = 1; }
  console.log(`${n} tests gedaan`);
})();
