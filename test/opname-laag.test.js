// Test van de host-laag van de opname-beta in mobiel.html (brok 3e, Codex-review punt 6): een geopende laag sluit zich als de rol of de schakelaar niet meer geldt, zonder verlies van wat al is ingevoerd.
// Het blok OPNAME-LAAG wordt uit mobiel.html gehaald en in een nagebootste omgeving (window, document, localStorage, MTRol, MTOpname) uitgevoerd.
// Draaien: node test/opname-laag.test.js
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
let n = 0; const test = (naam, fn) => fn().then(() => { n++; console.log('ok  - ' + naam); }, e => { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; });
const html = fs.readFileSync(path.join(__dirname, '..', 'mobiel.html'), 'utf8');
const van = html.indexOf('OPNAME-LAAG (beta)'), tot = html.indexOf('TAKEN PER PROJECT (punt 2)');
assert.ok(van > 0 && tot > van, 'het blok OPNAME-LAAG staat in mobiel.html');
const blok = html.slice(html.lastIndexOf('/*', van), html.lastIndexOf('/*', tot));
const wacht = (ms) => new Promise(r => setTimeout(r, ms || 5));

function omgeving(opties) {
  opties = opties || {};
  const handlers = {}, toasts = [], opslag = { mt_opname_beta: '1' };
  const laag = { hidden: true, _init: false };
  const kinderen = [{ tagName: 'DIV', inert: false }];
  const w = {
    MTRol: { me: { rechten: { beheer: true } }, isBeheer() { return !!(this.me && this.me.rechten && this.me.rechten.beheer); } },
    addEventListener(t, f) { (handlers[t] = handlers[t] || []).push(f); },
    MTOpname: { X: { schermen: { model: () => {} } }, start: async () => {}, stop() {}, terug: () => false, bewaarAlles: opties.bewaarAlles || (async () => true) },
    showToast: t => toasts.push(t), allProjects: () => [], mProjNaam: p => p, mProjNr: p => p,
    localStorage: { getItem: k => (k in opslag ? opslag[k] : null), setItem: (k, v) => { opslag[k] = String(v); }, removeItem: k => { delete opslag[k]; } },
    history: { pushState() {}, back() {} },
    document: { getElementById: id => id === 'opnameLaag' ? laag : null, body: { children: kinderen }, activeElement: null, head: { appendChild() {} }, createElement: () => ({}) }
  };
  w.window = w; w.opnameLaagOpen = null;
  const ctx = vm.createContext(w);
  vm.runInContext(blok, ctx);
  const stuur = (type, ev) => Promise.all((handlers[type] || []).map(f => f(ev || {})));
  return { w, laag, toasts, opslag, kinderen, stuur, handlers };
}

(async () => {
  await test('de laag opent voor beheer met de schakelaar aan (uitgangspunt van de test)', async () => {
    const o = omgeving(); await o.w.opnameLaagOpen(); assert.strictEqual(o.laag.hidden, false); assert.strictEqual(o.kinderen[0].inert, true, 'de rest van de pagina is geblokkeerd zolang de laag open staat');
  });
  await test('6: wordt de beheer-rol ingetrokken (mt-rol-event) terwijl de laag open staat, dan sluit de laag, nadat alles is weggeschreven', async () => {
    let geschreven = false; const o = omgeving({ bewaarAlles: async () => { await wacht(20); geschreven = true; return true; } });
    await o.w.opnameLaagOpen(); assert.strictEqual(o.laag.hidden, false);
    o.w.MTRol.me = { rechten: { beheer: false } }; const p = o.stuur('mt-rol', { detail: o.w.MTRol.me });
    assert.strictEqual(o.laag.hidden, false, 'pas dicht na het wegschrijven'); await p;
    assert.strictEqual(geschreven, true); assert.strictEqual(o.laag.hidden, true); assert.strictEqual(o.kinderen[0].inert, false, 'de pagina is weer bruikbaar');
    assert.ok(o.toasts.some(t => /uitgezet/.test(t) && /opgeslagen/.test(t)), o.toasts.join(' | '));
  });
  await test('6: staat er nog iets onbewaards op het scherm, dan blijft de laag open (geen verlies) met een melding', async () => {
    const o = omgeving({ bewaarAlles: async () => false }); await o.w.opnameLaagOpen();
    o.w.MTRol.me = { rechten: { beheer: false } }; await o.stuur('mt-rol'); assert.strictEqual(o.laag.hidden, false); assert.ok(o.toasts.some(t => /niet alles is opgeslagen/.test(t)), o.toasts.join(' | '));
    await o.stuur('mt-rol'); assert.strictEqual(o.laag.hidden, false, 'ook een volgend event gooit niets weg');
    o.w.MTOpname.bewaarAlles = async () => true; await o.stuur('mt-rol'); assert.strictEqual(o.laag.hidden, true, 'zodra alles is opgeslagen sluit de laag alsnog');
  });
  await test('6: zet een ander tabblad de schakelaar uit (storage-event), dan sluit de laag ook', async () => {
    const o = omgeving(); await o.w.opnameLaagOpen(); delete o.opslag.mt_opname_beta; await o.stuur('storage', { key: 'mt_opname_beta' });
    assert.strictEqual(o.laag.hidden, true);
  });
  await test('6: een mt-rol-event terwijl het recht en de schakelaar nog gelden laat de laag met rust; een onbelangrijk storage-event ook', async () => {
    const o = omgeving(); await o.w.opnameLaagOpen(); await o.stuur('mt-rol', { detail: o.w.MTRol.me }); await o.stuur('storage', { key: 'iets_anders' });
    assert.strictEqual(o.laag.hidden, false); assert.deepStrictEqual(o.toasts, []);
  });
  await test('6: is het recht intussen terug (na het wachten op het wegschrijven), dan sluit de laag niet', async () => {
    let o; o = omgeving({ bewaarAlles: async () => { await wacht(15); o.w.MTRol.me = { rechten: { beheer: true } }; return true; } });
    await o.w.opnameLaagOpen(); o.w.MTRol.me = { rechten: { beheer: false } }; await o.stuur('mt-rol'); assert.strictEqual(o.laag.hidden, false);
  });
  await test('6: een gesloten laag blijft onaangeroerd bij rolwijzigingen, en openen zonder recht mag nog steeds niet', async () => {
    const o = omgeving(); o.w.MTRol.me = { rechten: { beheer: false } }; await o.stuur('mt-rol'); assert.strictEqual(o.laag.hidden, true); assert.deepStrictEqual(o.toasts, []);
    await o.w.opnameLaagOpen(); assert.strictEqual(o.laag.hidden, true); assert.ok(o.toasts.some(t => /testversie voor beheer/.test(t)));
  });
  console.log('\n' + n + ' tests geslaagd');
})();
