// Test van de duurzaamheid van de lokale opslag (brok 3b, ChatGPT-review 043): "opgeslagen" mag pas gelden na een duurzame commit (tx.oncomplete), een afgebroken of
// vergeten transactie (quotafout) is een fout. Een nagebootste IndexedDB waarvan de test zelf de commit bepaalt. Draaien: node test/opname-opslag.test.js
'use strict';
const assert = require('assert');
let n = 0; const test = (naam, fn) => fn().then(() => { n++; console.log('ok  - ' + naam); }, e => { console.log('FOUT - ' + naam + '\n' + (e.stack || e)); process.exitCode = 1; });

// Een IndexedDB-nabootsing: put() verandert de duurzame inhoud pas als de test de transactie laat slagen (commit); abort() laat hem mislukken (quota).
function nepIDB() {
  const duurzaam = { opnames: new Map(), fotos: new Map() }, transacties = [];
  const open = () => {
    const req = { result: null, error: null };
    setTimeout(() => {
      const db = {
        objectStoreNames: { contains: () => true }, close() {}, createObjectStore() { return { createIndex() {} }; },
        transaction(store) {
          const tx = { error: null, put: [], commit() { this.put.forEach(f => f()); this.oncomplete && this.oncomplete(); }, abort(fout) { this.error = fout || null; this.onabort && this.onabort(); } };
          tx.objectStore = () => ({
            put(rec) { const r = { result: rec.id }; tx.put.push(() => duurzaam[store].set(rec.id, JSON.parse(JSON.stringify(rec)))); return r; },
            get(id) { const r = { get result() { return duurzaam[store].get(id); } }; setTimeout(() => r.onsuccess && r.onsuccess({ target: r }), 0); return r; },   // opslaan leest eerst (compare-and-set) en beslist pas in onsuccess
            getAll() { return { get result() { return Array.from(duurzaam[store].values()); } }; },
            index() { return { getAll: () => ({ get result() { return Array.from(duurzaam[store].values()); } }) }; } });
          transacties.push(tx); return tx;
        } };
      req.result = db; req.onsuccess && req.onsuccess();
    }, 0);
    return req;
  };
  return { idb: { open }, duurzaam, transacties };
}
const wacht = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const nep = nepIDB(); global.indexedDB = nep.idb;
  const O = require('../mt-opname-opslag.js');
  await test('schrijven is pas klaar na de duurzame commit (tx.oncomplete), niet eerder', async () => {
    let klaar = false; const p = O.schrijf({ id: 'OPN-1', opname: { a: 1 } }).then(() => { klaar = true; });
    await wacht(30); assert.strictEqual(klaar, false, 'de transactie is nog niet gecommit: nog niet opgeslagen'); assert.strictEqual(nep.duurzaam.opnames.size, 0, 'en er staat ook niets duurzaam');
    nep.transacties[nep.transacties.length - 1].commit(); await p; assert.strictEqual(klaar, true); assert.strictEqual(nep.duurzaam.opnames.get('OPN-1').opname.a, 1);
  });
  await test('een afgebroken transactie (quota vol of toegang geweigerd) is een fout met een leesbare tekst, geen succes', async () => {
    let uitslag = null; const p = O.schrijf({ id: 'OPN-2', opname: {} }).then(() => { uitslag = 'ok'; }, e => { uitslag = e.message; });
    await wacht(30); nep.transacties[nep.transacties.length - 1].abort({ name: 'QuotaExceededError', message: 'The quota has been exceeded.' }); await p;
    assert.ok(/Opslaan afgebroken/.test(uitslag) && /quota/i.test(uitslag), uitslag); assert.strictEqual(nep.duurzaam.opnames.has('OPN-2'), false, 'er is niets duurzaam geschreven'); assert.ok(O.status.fout, 'de status onthoudt de fout');
  });
  await test('een foto is pas opgeslagen na de commit; na een fout slaagt een volgende poging gewoon', async () => {
    let klaar = false; const p = O.zetFoto({ id: 'OPN-1:F1', opnameId: 'OPN-1', blob: {} }).then(() => { klaar = true; });
    await wacht(30); assert.strictEqual(klaar, false); nep.transacties[nep.transacties.length - 1].commit(); await p; assert.strictEqual(nep.duurzaam.fotos.has('OPN-1:F1'), true);
    const q = O.schrijf({ id: 'OPN-3', opname: {} }); await wacht(30); nep.transacties[nep.transacties.length - 1].commit(); await q; assert.strictEqual(O.status.fout, null, 'na een geslaagde schrijfactie is de foutstatus weer leeg');
  });
  console.log('\n' + n + ' tests geslaagd');
})();
