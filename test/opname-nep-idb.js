// Hulpbestand voor de opslagtests (brok 3e): een IndexedDB-nabootsing met de eigenschappen waar het om gaat bij tabblad-conflicten en atomair terugzetten, zonder dependencies.
// Wat ze bootst na: transacties over één of meer stores; readwrite-transacties met overlappende stores lopen na elkaar (zoals bij twee tabbladen op dezelfde database);
// requests worden in volgorde uitgevoerd en melden zich via onsuccess; een transactie commit pas als er niets meer te doen is; abort() gooit alles van die transactie weg
// (ook de puts in andere stores) en meldt onabort. Schrijven in een transactie is pas voor anderen zichtbaar na de commit.
// Faalinjectie: nep.voorPut = (store, rec) => foutobject | null laat die put mislukken (de transactie breekt dan af).
'use strict';
const kopie = x => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));

function maakNepIDB() {
  const duurzaam = { opnames: new Map(), fotos: new Map() }, actief = [], wachtrij = [];
  const nep = { duurzaam, voorPut: null, transacties: 0 };
  const botst = (a, b) => (a.modus === 'readwrite' || b.modus === 'readwrite') && a.stores.some(s => b.stores.includes(s));
  function volgende() {
    for (let i = 0; i < wachtrij.length;) {
      const tx = wachtrij[i];
      if (actief.some(a => botst(a, tx))) { i++; continue; }
      wachtrij.splice(i, 1); actief.push(tx); setTimeout(() => pomp(tx), 0);
    }
  }
  function klaar(tx) { tx.klaar = true; const i = actief.indexOf(tx); if (i >= 0) actief.splice(i, 1); volgende(); }
  function stop(tx, fout) { if (tx.klaar) return; tx.error = fout || null; klaar(tx); setTimeout(() => tx.onabort && tx.onabort(), 0); }
  function pomp(tx) {
    if (tx.klaar) return;
    const v = tx.queue.shift();
    if (!v) { for (const naam of Object.keys(tx.staged)) for (const [id, rec] of tx.staged[naam]) duurzaam[naam].set(id, rec); klaar(tx); tx.oncomplete && tx.oncomplete(); return; }
    let uit; try { uit = v.fn(); } catch (e) { v.req.error = e; try { v.req.onerror && v.req.onerror(); tx.onerror && tx.onerror(); } catch (x) { /* */ } stop(tx, e); return; }
    v.req.result = uit;
    try { v.req.onsuccess && v.req.onsuccess({ target: v.req }); } catch (e) { stop(tx, e); return; }       // een uitzondering in een succes-handler breekt de transactie af
    setTimeout(() => pomp(tx), 0);
  }
  const open = () => {
    const req = { result: null, error: null };
    setTimeout(() => {
      req.result = {
        objectStoreNames: { contains: () => true }, close() {}, createObjectStore() { return { createIndex() {} }; },
        transaction(stores, modus) {
          stores = [].concat(stores); nep.transacties++;
          const tx = { stores, modus, queue: [], staged: {}, klaar: false, error: null };
          const lees = (naam, id) => { const s = tx.staged[naam]; const m = s && s.get(id) !== undefined ? s.get(id) : duurzaam[naam].get(id); return m === undefined ? undefined : kopie(m); };
          const alle = naam => { const m = new Map(duurzaam[naam]); if (tx.staged[naam]) for (const [k, v] of tx.staged[naam]) m.set(k, v); return Array.from(m.values()).map(kopie); };
          const vraag = fn => { const req = { result: undefined, error: null }; tx.queue.push({ req, fn }); return req; };
          tx.objectStore = naam => {
            if (!stores.includes(naam)) throw new Error('NotFoundError: store ' + naam + ' hoort niet bij deze transactie');
            return {
              put(rec) { if (modus !== 'readwrite') throw new Error('ReadOnlyError'); return vraag(() => { const f = nep.voorPut && nep.voorPut(naam, rec); if (f) throw f; (tx.staged[naam] = tx.staged[naam] || new Map()).set(rec.id, kopie(rec)); return rec.id; }); },
              get: id => vraag(() => lees(naam, id)),
              getAll: () => vraag(() => alle(naam)),
              index: () => ({ getAll: w => vraag(() => alle(naam).filter(r => r.opnameId === w)) })
            };
          };
          tx.abort = fout => { if (tx.klaar) throw new Error('InvalidStateError'); stop(tx, fout && fout.name ? fout : null); };
          wachtrij.push(tx); setTimeout(volgende, 0);
          return tx;
        } };
      req.onsuccess && req.onsuccess();
    }, 0);
    return req;
  };
  nep.idb = { open };
  return nep;
}
// Een tweede, losse instantie van de opslagmodule (zoals een tweede tabblad: eigen geopende database, zelfde opslag eronder).
function laadOpslag() {
  const pad = require.resolve('../mt-opname-opslag.js'); delete require.cache[pad];
  const stil = globalThis.MTOpnameOpslag; delete globalThis.MTOpnameOpslag;
  const O = require(pad); if (stil) globalThis.MTOpnameOpslag = stil; else delete globalThis.MTOpnameOpslag; return O;
}
module.exports = { maakNepIDB, laadOpslag };
