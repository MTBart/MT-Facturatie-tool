// mt-opname-opslag.js — lokale opslag van de nieuwe opname-module (brok 2): alleen IndexedDB op dit toestel, geen upload, geen netwerk.
// Eigen database "mt-opname" (stores opnames en fotos). Bewust NIET mt-fotostore.js: die is van de bestaande Capture/Rapportage (database mt-rapporten, met een opruimfunctie voor
// gesynchroniseerde foto's) en blijft ongemoeid. Een opname-record is { id, opname, layout, instellingen, bijgewerkt } met de kern-opname onaangeroerd in `opname`; wat alleen de
// schermen nodig hebben (waar op de foto de wandhoeken zitten, waar een kozijn getekend staat) staat ernaast in `layout`, zodat het datamodel v0.3 en de inhoudshash gelijk blijven.
// Een foto-record is { id, opnameId, blob, naam, type, grootte, breedte, hoogte, tijd, ruimte, wand, soort, item }.
// Nooit stil verlies: er is geen wis-functie voor opnames of foto's; een foto die uit de opname gehaald wordt blijft hier bewaard (de kern archiveert de verwijzing).
// Elke fout komt als rejectie terug met een leesbare tekst; de schermen tonen die altijd (balk "Opslaan mislukt").
(function (root) {
  'use strict';
  const O = root.MTOpnameOpslag = root.MTOpnameOpslag || {};
  const DB = 'mt-opname', VERSIE = 1;
  let _db = null, _open = null;
  O.status = { persistent: null, fout: null, quota: null };

  const tekstVan = e => (e && (e.message || e.name)) ? String(e.message || e.name) : String(e || 'onbekende fout');
  const kwaad = (wat, e) => { const m = wat + ': ' + tekstVan(e); O.status.fout = m; return new Error(m); };

  O.open = function () {
    if (_db) return Promise.resolve(_db);
    if (_open) return _open;
    _open = new Promise((ok, fail) => {
      if (!root.indexedDB) { fail(kwaad('Opslag niet beschikbaar', 'IndexedDB ontbreekt in deze browser')); return; }
      let q; try { q = root.indexedDB.open(DB, VERSIE); } catch (e) { fail(kwaad('Opslag openen', e)); return; }
      q.onupgradeneeded = () => {
        const db = q.result;
        if (!db.objectStoreNames.contains('opnames')) db.createObjectStore('opnames', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('fotos')) { const s = db.createObjectStore('fotos', { keyPath: 'id' }); s.createIndex('opnameId', 'opnameId', { unique: false }); }
      };
      q.onsuccess = () => { _db = q.result; _db.onclose = () => { _db = null; _open = null; }; _db.onversionchange = () => { try { _db.close(); } catch (e) {} _db = null; _open = null; }; ok(_db); };
      q.onerror = () => fail(kwaad('Opslag openen', q.error));
      q.onblocked = () => fail(kwaad('Opslag openen', 'geblokkeerd door een ander tabblad'));
    }).catch(e => { _open = null; throw e; });
    return _open;
  };

  function transactie(store, modus, werk) {
    return O.open().then(db => new Promise((ok, fail) => {
      let tx; try { tx = db.transaction(store, modus); } catch (e) { fail(kwaad('Opslag', e)); return; }
      let uit; try { uit = werk(tx.objectStore(store)); } catch (e) { fail(kwaad('Opslag', e)); return; }
      tx.oncomplete = () => { O.status.fout = null; ok(uit && 'result' in uit ? uit.result : undefined); };
      tx.onerror = () => fail(kwaad('Opslaan', tx.error));
      tx.onabort = () => fail(kwaad('Opslaan afgebroken', tx.error || 'te weinig ruimte of toegang geweigerd'));
    }));
  }

  O.schrijf = rec => { const k = JSON.parse(JSON.stringify(rec)); k.bijgewerkt = new Date().toISOString(); return transactie('opnames', 'readwrite', s => s.put(k)).then(() => k); };
  O.lees = id => transactie('opnames', 'readonly', s => s.get(id));
  O.lijst = () => transactie('opnames', 'readonly', s => s.getAll()).then(l => (l || []).sort((a, b) => String(b.bijgewerkt || '').localeCompare(String(a.bijgewerkt || ''))));
  O.zetFoto = f => transactie('fotos', 'readwrite', s => s.put(f)).then(() => f);
  O.leesFoto = id => transactie('fotos', 'readonly', s => s.get(id));
  O.fotosVan = opnameId => transactie('fotos', 'readonly', s => s.index('opnameId').getAll(opnameId));

  // Vraagt de browser de opslag te bewaren (niet automatisch op te ruimen) en meldt hoeveel ruimte er is. Mislukt dit, dan blijft de opslag werken, maar het scherm zegt het.
  O.beveilig = async function () {
    try {
      if (root.navigator && navigator.storage && navigator.storage.persisted) O.status.persistent = await navigator.storage.persisted();
      if (O.status.persistent === false && navigator.storage.persist) O.status.persistent = await navigator.storage.persist();
      if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); O.status.quota = { gebruikt: e.usage || 0, totaal: e.quota || 0 }; }
    } catch (e) { /* geen schade: de status blijft onbekend */ }
    return O.status;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = O;
})(typeof window !== 'undefined' ? window : globalThis);
