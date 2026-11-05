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

// ── Financiën: classificatie van meldingen en structurele alarmdetectie (pure functies uit mt-geld.js) ──
const W = G._weergave;
test('meldingen: fail-safe, onbekende bron of tekst is kritiek; alleen de korte lijst is informatief', () => {
  assert.strictEqual(W.isKritiek({ bron: 'iets-nieuws', fout: 'onbekende melding' }), true);
  assert.strictEqual(W.isKritiek({ bron: undefined, fout: 'zonder bron' }), true);
  assert.strictEqual(W.isKritiek({ bron: 'limiet', fout: 'x' }), true); assert.strictEqual(W.isKritiek({ bron: 'btw', fout: 'x' }), true);
  for (const b of ['profiel', 'patronen', 'prognose', 'verkoopfacturen']) assert.strictEqual(W.isKritiek({ bron: b, fout: 'vernieuwen' }), false, b);
  assert.strictEqual(W.isKritiek({ bron: 'profiel', fout: 'x', onvolledig: true }), true, 'onvolledig is altijd kritiek');
  const v = W.verdeel([{ bron: 'profiel', fout: 'a' }, { bron: 'nieuw', fout: 'b' }, { bron: 'prognose', fout: 'c' }]); assert.deepStrictEqual(v.kritiek.map(x => x.fout), ['b']); assert.deepStrictEqual(v.info.map(x => x.fout), ['a', 'c']);
});
test('config-meldingen: essentiële configuratie is kritiek en geen "nog in te stellen"; optionele blijft instelpunt', () => {
  const ess = [{ bron: 'config', fout: 'kredietlimiet lopende rekening niet ingesteld' }, { bron: 'config', fout: 'BTW-instellingen: van welke rekening de aangifte betaald wordt is niet ingesteld — lopende rekening aangenomen' }];
  for (const x of ess) { assert.strictEqual(W.isEssentieel(x), true); assert.strictEqual(W.isInstellen(x), false); assert.strictEqual(W.isKritiek(x), true); }
  const opt = { bron: 'config', fout: 'nog geen spaarpotten ingesteld — overboekingen naar spaar worden niet herkend' };
  assert.strictEqual(W.isEssentieel(opt), false); assert.strictEqual(W.isInstellen(opt), true);
  assert.strictEqual(W.isInstellen({ bron: 'profiel', fout: 'x' }), false, 'geen config-melding');
});
test('alarmdetectie op structuur: mtg-alarm en meldingen zonder info-merk; uitleg nooit', () => {
  const el = (...klassen) => ({ classList: { contains: k => klassen.includes(k) } }), blok = lijst => ({ querySelectorAll: () => lijst });
  assert.strictEqual(W.alarmen(blok([el('mtg-uitleg'), el('mtg-uitleg')]), true), 0, 'uitleg telt nooit');
  assert.strictEqual(W.alarmen(blok([el('mtg-uitleg', 'mtg-alarm')]), true), 1, 'uitleg met expliciet alarm wel (krap-advies, open vraag)');
  assert.strictEqual(W.alarmen(blok([el('mtg-melding', 'mtg-info'), el('mtg-melding', 'mtg-info')]), true), 0, 'neutrale lege-staat-teksten');
  assert.strictEqual(W.alarmen(blok([el('mtg-melding')]), true), 1, 'melding zonder info-merk telt in een strikt blok');
  assert.strictEqual(W.alarmen(blok([el('mtg-melding')]), false), 0, 'niet in een niet-strikt blok');
  assert.strictEqual(W.alarmen(blok([el('mtg-melding', 'mtg-alarm', 'mtg-info')]), false), 1, 'expliciet alarm wint altijd (Controle vereist voor de factuurplanning)');
  assert.strictEqual(W.alarmen(blok([el('mtg-melding', 'mtg-uitleg')]), true), 0);
});
// ── Laden: tokens, gebruikerswissel en verversen na een wijziging in Financiën ──
const wacht = () => { let ok; const p = new Promise(r => { ok = r; }); return { p, ok }; };
const antwoord = (fictief, buffer) => { const d = Geld.tijdlijn(); d.saldo.lopend.gerapporteerd = fictief; const c = Geld.config(); c.fictieve_buffer = buffer; return [d, { config: c }]; };
const bronVan = rondes => { const tl = rondes.map(r => r[0]), cf = rondes.map(r => r[1]); return { haal: pad => (/config/.test(pad) ? cf : tl).shift() }; };   // per verzoeksoort de volgende ronde
const asyncTest = async (naam, fn) => { try { await fn(); n++; console.log('ok  - ' + naam); } catch (e) { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; } };
(async () => {
  await asyncTest('laat antwoord van een oude ronde wordt genegeerd', async () => {
    zet({ bes: { data: null, cfg: null, laden: false, fout: null, cache: null, tok: 0, wie: WIE, bron: null }, bron: null });
    const oud = antwoord(1000, 0), nieuw = antwoord(7000, 0), t1 = wacht(), t2 = wacht(), c1 = wacht(), c2 = wacht(), rondes = [[t1.p, c1.p], [t2.p, c2.p]];   // verzoek 1 en 2 (elk tijdlijn + config)
    let i = 0; const bron = { haal: () => [t1.p, c1.p, t2.p, c2.p][i++] }; st.bron = bron; st.bes.bron = bron;
    const r1 = C._besteedLaad(), r2 = C._besteedLaad();
    t2.ok(nieuw[0]); c2.ok(nieuw[1]); await r2; assert.strictEqual(st.bes.data.saldo.lopend.gerapporteerd, 7000);
    t1.ok(oud[0]); c1.ok(oud[1]); await r1; assert.strictEqual(st.bes.data.saldo.lopend.gerapporteerd, 7000, 'het late antwoord van ronde 1 mag het nieuwe getal niet overschrijven');
    assert.strictEqual(st.bes.laden, false); void rondes;
  });
  await asyncTest('andere gebruiker: oude gegevens weg en een laat antwoord van de vorige gebruiker telt niet', async () => {
    const bronA = {}, t = wacht(), c = wacht(); let i = 0; bronA.haal = () => [t.p, c.p][i++];
    zet({ wie: 'gebruiker-a', bron: bronA, bes: { data: null, cfg: null, laden: false, fout: null, cache: null, tok: 0, wie: 'gebruiker-a', bron: bronA } });
    const r = C._besteedLaad(); st.bes.data = Geld.tijdlijn();   // inmiddels staat er iets in
    const bronB = { haal: async () => ({}) }; st.wie = 'gebruiker-b'; st.bron = bronB; C._besteedBewaak();
    assert.strictEqual(st.bes.data, null, 'niets van gebruiker A mag overblijven'); assert.strictEqual(st.bes.wie, 'gebruiker-b');
    const nu = st.bes; const a = antwoord(99999, 0); t.ok(a[0]); c.ok(a[1]); await r;
    assert.strictEqual(st.bes, nu); assert.strictEqual(st.bes.data, null, 'late antwoord van A blijft buiten het scherm van B');
    assert.strictEqual(C.besteedTegel().waarde, '—');
    C._besteedBewaak(); assert.strictEqual(st.bes, nu, 'zelfde gebruiker en bron: niets wissen');
  });
  await asyncTest('verversen na een configwijziging: tegel volgt de nieuwe config (eigen kopie en live Financiën)', async () => {
    const bron = bronVan([antwoord(15000, 2500), antwoord(15000, 9000)]);
    zet({ bron, bes: { data: null, cfg: null, laden: false, fout: null, cache: null, tok: 0, wie: WIE, bron } });
    await C._besteedLaad(); const voor = C.besteedTegel(); assert.strictEqual(voor.m.onder, 2500); assert.strictEqual(voor.m.ruimte, voor.m.low.saldo - 2500);
    st.bes.laatst = Date.now() - 61000;   // ouder dan een minuut: dan wordt er wel opnieuw geladen
    await C.ververs(); const na = C.besteedTegel(); assert.strictEqual(na.m.onder, 9000, 'na verversen de nieuwe fictieve buffer'); assert.strictEqual(na.m.ruimte, na.m.low.saldo - 9000);
    // Financiën zelf geladen (en later gewijzigd): de tegel gebruikt die stand direct
    const d = Geld.tijdlijn(), c1 = Geld.config(); globalThis.MTGeld._st.data = d; globalThis.MTGeld._st.cfg = c1; globalThis.MTGeld._st.wie = WIE; globalThis.MTGeld._st.scenario = {};
    try {
      const live1 = C.besteedTegel(); assert.strictEqual(live1.m.onder, 2500);
      const c2 = Geld.config(); c2.fictieve_buffer = 4000; globalThis.MTGeld._st.cfg = c2; assert.strictEqual(C.besteedTegel().m.onder, 4000, 'configwijziging in Financiën meteen zichtbaar');
      globalThis.MTGeld._st.wie = 'iemand-anders'; assert.strictEqual(C.besteedTegel().m.onder, 9000, 'Financiën van een andere gebruiker telt niet');
    } finally { globalThis.MTGeld._st.data = null; globalThis.MTGeld._st.cfg = null; globalThis.MTGeld._st.wie = ''; delete globalThis.MTGeld._st.scenario; }
  });
  await asyncTest('mislukte verversing laat geen oud getal staan', async () => {
    const bron = bronVan([antwoord(15000, 2500), [{ error: 'stuk' }, { config: Geld.config() }]]);
    zet({ bron, bes: { data: null, cfg: null, laden: false, fout: null, cache: null, tok: 0, wie: WIE, bron } });
    await C._besteedLaad(); assert.ok(C.besteedTegel().ok); await C._besteedLaad(); const t = C.besteedTegel(); assert.strictEqual(t.waarde, '—'); assert.ok(/tijdlijn niet geladen/.test(t.sub));
  });
  await asyncTest('scenario in Financiën wordt NIET overgenomen: de tegel toont het echte besteedbaar budget', async () => {
    const d = Geld.tijdlijn(); d.events.push({ id: 'p-9', bron: 'prognose', zekerheid: 'prognose', prognose: 'p1', termijn_id: 't1', factuurdatum: Geld.dag(d.vandaag, 9), ontvangst_na: 0, datum: Geld.dag(d.vandaag, 9), delta: 30000, rekening: 'lopend' });
    const cfg = Geld.config(); zet({ bes: { data: null, cfg: null, laden: false, fout: null, cache: null, tok: 0, wie: WIE, bron: null } });
    const fin = globalThis.MTGeld._st; fin.data = d; fin.cfg = cfg; fin.wie = WIE;
    try {
      fin.scenario = {}; const echt = C.besteedTegel(); assert.strictEqual(echt.m.low.saldo, 15000, 'zonder scenario is vandaag het laagste punt (daarna 19000, 49000, 27000)');
      fin.scenario = { p1: { t1: Geld.dag(d.vandaag, 40) } };   // onopgeslagen: de termijn schuift 40 dagen op
      const metScen = G.laagste(G.kasLijn(G.metScenario(d, fin.scenario), cfg, { prognose: true, nood: false }), Geld.dag(d.vandaag, 31)); assert.notStrictEqual(metScen.saldo, 15000, 'het scenario verandert het laagste punt echt');
      const t = C.besteedTegel(); assert.strictEqual(t.m.low.saldo, 15000, 'de tegel negeert het scenario'); assert.strictEqual(t.raw, echt.raw);
    } finally { fin.data = null; fin.cfg = null; fin.wie = ''; delete fin.scenario; }
  });
  await asyncTest('ververs voegt samen: geen nieuwe ronde terwijl er een loopt of binnen 60 seconden, wel bij een configwijziging', async () => {
    let n1 = 0; const bron = { haal: async pad => { n1++; return /config/.test(pad) ? { config: Geld.config() } : Geld.tijdlijn(); } };
    zet({ bron, bes: { data: null, cfg: null, laden: false, fout: null, cache: null, tok: 0, wie: WIE, bron } });
    const a = C.ververs(), b2 = C.ververs(); await Promise.all([a, b2]); assert.strictEqual(n1, 2, 'twee aanroepen tegelijk = één ronde (tijdlijn + config)');
    await C.ververs(); assert.strictEqual(n1, 2, 'binnen 60 seconden en zonder configwijziging: niets nieuws');
    st.bes.laatst = Date.now() - 61000; await C.ververs(); assert.strictEqual(n1, 4, 'na 60 seconden wel');
    const fin = globalThis.MTGeld._st; fin.data = Geld.tijdlijn(); fin.cfg = Geld.config(); fin.wie = WIE;
    try { await C.ververs(); assert.strictEqual(n1, 6, 'eerste keer dat een geladen Financiën-config opvalt telt als wijziging'); await C.ververs(); assert.strictEqual(n1, 6, 'zelfde config: samengevoegd'); fin.cfg = Geld.config(); await C.ververs(); assert.strictEqual(n1, 8, 'nieuw config-object in Financiën: wel opnieuw'); }
    finally { fin.data = null; fin.cfg = null; fin.wie = ''; }
  });
  await asyncTest('geen herteken met open volschermpaneel; na sluiten wordt de uitgestelde stand verwerkt', async () => {
    let tek = 0; C._tekenHook = () => { tek++; };
    try {
      zet({ bes: { data: Geld.tijdlijn(), cfg: Geld.config(), laden: false, fout: null, cache: null, tok: 0, wie: WIE, bron: null } }); st.el = { isConnected: true, contains: () => false }; st.paneel = 'besteedbaar';
      C._herteken(); assert.strictEqual(tek, 0, 'paneel open: niet hertekenen'); assert.strictEqual(st.bes.wacht, true);
      C._verwerkWacht(); assert.strictEqual(tek, 0, 'nog steeds open');
      st.paneel = null; C._verwerkWacht(); assert.strictEqual(tek, 1, 'na sluiten verwerkt'); assert.strictEqual(st.bes.wacht, false);
      C._verwerkWacht(); assert.strictEqual(tek, 1, 'niet nog een keer');
    } finally { C._tekenHook = null; st.el = null; st.paneel = null; }
  });
  console.log(`${n} tests gedaan`);
})();
