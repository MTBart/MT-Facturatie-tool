// De tegel "Besteedbaar budget" in het cijfers-dashboard moet exact hetzelfde getal geven als Financiën (mt-geld.js). Draaien: node test/besteedbaar.test.js — nep-gegevens.
'use strict';
const assert = require('assert');
const Geld = require('./fixtures/geld-nep.js');
require('../mt-geld.js');
require('../mt-cijfers.js');
const G = globalThis.MTGeld, C = globalThis.MTCijfers, st = C._st;
let n = 0; const test = (naam, fn) => { try { fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };

// localStorage zoals Financiën hem gebruikt (per gebruiker): noodbuffer, prognose en periode.
const opslag = {}; globalThis.localStorage = { getItem: k => (k in opslag ? opslag[k] : null), setItem: (k, v) => { opslag[k] = String(v); } };
const WIE = 'nep-gebruiker';
const eurTekst = x => (x < 0 ? '−' : '') + '€ ' + Math.round(Math.abs(x)).toLocaleString('nl-NL');
function zet(opt) {
  Object.keys(opslag).forEach(k => delete opslag[k]);
  Object.assign(st, { wie: WIE, vandaag: '2026-11-05', besZoom: null, bes: { data: Geld.tijdlijn(), cfg: Geld.config(), laden: false, fout: null, cache: null } }, opt || {});
}
const ZOOM = { week: 14, maand: 31, kwartaal: 92, jaar: 365 };

test('tegelwaarde is gelijk aan G.besteedbaar (noodbuffer uit)', () => {
  zet(); const t = C.besteedTegel(), bes = G.besteedbaar(st.bes.data, st.bes.cfg, { nood: false });
  assert.ok(t.ok); assert.strictEqual(t.raw, bes.besteedbaar); assert.strictEqual(t.waarde, eurTekst(bes.besteedbaar));
  assert.strictEqual(bes.besteedbaar, 15000);   // lopend zonder open btw
});
test('laagste punt en ruimte zijn gelijk aan G.laagste en G.drempel', () => {
  zet(); const t = C.besteedTegel(), d = st.bes.data, lijn = G.kasLijn(d, st.bes.cfg, { prognose: true, nood: false }), low = G.laagste(lijn, Geld.dag(d.vandaag, ZOOM.maand));
  assert.deepStrictEqual(t.m.low, low); assert.strictEqual(t.rijen[0].v, eurTekst(low.saldo));
  const onder = G.drempel(d, st.bes.cfg); assert.strictEqual(t.m.ruimte, Math.round((low.saldo - onder) * 100) / 100); assert.strictEqual(t.rijen[1].v, eurTekst(t.m.ruimte));
  assert.strictEqual(low.saldo, -3000, 'fictieve tijdlijn: 15000 + 4000 - 22000 = -3000');
  assert.strictEqual(t.chip.goed, false); assert.ok(/tekort/.test(t.chip.tekst));
});
test('periode van Financiën wordt overgenomen (kwartaal ziet verder vooruit)', () => {
  zet(); opslag['mtg:zoom:' + WIE] = 'kwartaal'; const t = C.besteedTegel(), d = st.bes.data;
  const low = G.laagste(G.kasLijn(d, st.bes.cfg, { prognose: true, nood: false }), Geld.dag(d.vandaag, ZOOM.kwartaal)); assert.deepStrictEqual(t.m.low, low); assert.strictEqual(t.m.zoom, 'kwartaal');
  opslag['mtg:zoom:' + WIE] = 'onzin'; assert.strictEqual(C.besteedTegel().m.zoom, 'maand', 'onbekende waarde valt terug op maand');
});
test('noodbuffer aan en uit: gelijk aan Financiën in beide standen', () => {
  zet(); const d = st.bes.data, cfg = st.bes.cfg;
  const uit = C.besteedTegel(); assert.strictEqual(uit.m.nood, false); assert.ok(!/incl\. noodbuffer/.test(uit.label));
  opslag['mtg:nood:' + WIE] = '1'; const aan = C.besteedTegel(), bes = G.besteedbaar(d, cfg, { nood: true });
  assert.strictEqual(aan.m.nood, true); assert.strictEqual(aan.raw, bes.besteedbaar); assert.strictEqual(aan.waarde, eurTekst(bes.besteedbaar)); assert.strictEqual(bes.besteedbaar, 15000 + 8000);
  assert.ok(/incl\. noodbuffer/.test(aan.label));
  const low = G.laagste(G.kasLijn(d, cfg, { prognose: true, nood: true }), Geld.dag(d.vandaag, ZOOM.maand)); assert.deepStrictEqual(aan.m.low, low);
  opslag['mtg:nood:' + WIE] = '0'; assert.strictEqual(C.besteedTegel().raw, uit.raw, 'weer uit = weer het oude getal');
});
test('prognose uit (zoals in Financiën onthouden) rekent zonder prognose', () => {
  zet(); opslag['mtg:prognose:' + WIE] = '0'; opslag['mtg:zoom:' + WIE] = 'jaar'; const t = C.besteedTegel(), d = st.bes.data;
  assert.strictEqual(t.m.prognose, false); assert.deepStrictEqual(t.m.low, G.laagste(G.kasLijn(d, st.bes.cfg, { prognose: false, nood: false }), Geld.dag(d.vandaag, ZOOM.jaar)));
});
test('ontbrekende gegevens geven "—" met reden, nooit 0', () => {
  zet({ bes: { data: null, cfg: null, laden: true, fout: null, cache: null } }); let t = C.besteedTegel(); assert.strictEqual(t.waarde, '—'); assert.ok(/laden/.test(t.sub)); assert.strictEqual(t.klik, false);
  zet({ bes: { data: null, cfg: null, laden: false, fout: 'HTTP 500', cache: null } }); t = C.besteedTegel(); assert.strictEqual(t.waarde, '—'); assert.ok(/tijdlijn niet geladen/.test(t.sub));
  zet({ bes: { data: Geld.tijdlijn(), cfg: null, laden: false, fout: null, cache: null } }); t = C.besteedTegel(); assert.strictEqual(t.waarde, '—'); assert.ok(/instellingen/.test(t.sub));
  const d = Geld.tijdlijn(); d.saldo.lopend.gerapporteerd = null; zet({ bes: { data: d, cfg: Geld.config(), laden: false, fout: null, cache: null } }); t = C.besteedTegel();
  assert.strictEqual(t.waarde, '—'); assert.ok(/lopende rekening onbekend/.test(t.sub)); assert.ok(!t.rijen.length);
  const bewaard = globalThis.MTGeld; try { delete globalThis.MTGeld; zet(); t = C.besteedTegel(); assert.strictEqual(t.waarde, '—'); assert.ok(/niet geladen/.test(t.sub)); } finally { globalThis.MTGeld = bewaard; }
  zet(); assert.strictEqual(C.besteedTegel().ok, true, 'en met alles aanwezig weer een getal');
});
test('negatief besteedbaar budget blijft negatief en wordt als tekort gemarkeerd', () => {
  const d = Geld.tijdlijn(); d.saldo.lopend.gerapporteerd = -2500; zet({ bes: { data: d, cfg: Geld.config(), laden: false, fout: null, cache: null } }); const t = C.besteedTegel();
  assert.strictEqual(t.raw, -2500); assert.strictEqual(t.waarde, '−€ 2.500'); assert.strictEqual(t.rood, true);
});
test('vlakke tijdlijn: laagste punt is vandaag en de ruimte klopt', () => {
  const d = Geld.tijdlijn(); d.events = []; d.vandaag = '2026-11-05'; zet({ bes: { data: d, cfg: Geld.config(), laden: false, fout: null, cache: null } }); const t = C.besteedTegel();
  assert.ok(t.ok); assert.strictEqual(t.raw, 15000);   // vlakke lijn: laagste punt = vandaag
  assert.strictEqual(t.m.low.saldo, 15000); assert.strictEqual(t.m.low.datum, '2026-11-05'); assert.strictEqual(t.m.ruimte, 12500); assert.strictEqual(t.chip.goed, true);
});
console.log(`${n} tests gedaan`);
