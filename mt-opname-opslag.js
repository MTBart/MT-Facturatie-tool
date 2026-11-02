// mt-opname-opslag.js — lokale opslag van de nieuwe opname-module (brok 2): alleen IndexedDB op dit toestel, geen upload, geen netwerk.
// Eigen database "mt-opname" (stores opnames en fotos). Bewust NIET mt-fotostore.js: die is van de bestaande Capture/Rapportage (database mt-rapporten, met een opruimfunctie voor
// gesynchroniseerde foto's) en blijft ongemoeid. Een opname-record is { id, opname, layout, instellingen, bijgewerkt } met de kern-opname onaangeroerd in `opname`; wat alleen de
// schermen nodig hebben (waar op de foto de wandhoeken zitten, waar een kozijn getekend staat) staat ernaast in `layout`, zodat het datamodel v0.3 en de inhoudshash gelijk blijven.
// Elk opname-record heeft ook een revisienummer `rev` (ontbreekt = 0): opslaan is compare-and-set, zie O.schrijf (brok 3e).
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

  // Een transactie waarin gelezen wordt om pas daarna te beslissen (compare-and-set, botsing bij import). werk(tx, stop, zet): stop(fout) breekt de héle transactie af (er is dan niets
  // geschreven, ook niet in de andere store) en weigert met die fout; zet(waarde) bepaalt wat de belofte oplevert. De beslissing valt dus binnen de transactie, niet op een eerder gelezen stand.
  function beslis(stores, werk) {
    return O.open().then(db => new Promise((ok, fail) => {
      let tx, uit, eigen = null; try { tx = db.transaction(stores, 'readwrite'); } catch (e) { fail(kwaad('Opslag', e)); return; }
      const stop = fout => { if (eigen) return; eigen = fout; O.status.fout = fout.message; try { tx.abort(); } catch (e) { fail(fout); } };
      tx.oncomplete = () => { O.status.fout = null; ok(uit); };
      // een fout in een request breekt de transactie af: de melding komt dan uit onabort, waar tx.error gevuld is
      tx.onabort = () => fail(eigen || kwaad('Opslaan afgebroken', tx.error || 'te weinig ruimte of toegang geweigerd'));
      try { werk(tx, stop, w => { uit = w; }); } catch (e) { stop(kwaad('Opslag', e)); }
    }));
  }
  // Tegen het stil overschrijven door een tweede tabblad of venster: elk opname-record heeft een revisienummer `rev` (een record zonder rev telt als 0, zodat oude opnames zonder verlies
  // doorlopen). Opslaan = compare-and-set in één readwrite-transactie: staat er nu een andere rev in de opslag dan degene waarop deze invoer gebaseerd is, dan wordt de transactie afgebroken
  // met een fout met code 'conflict' en wordt er niets geschreven. Bij geslaagd opslaan gaat rev met 1 omhoog en komt het geschreven record terug.
  O.CONFLICT_TEKST = 'Deze opname is in een ander tabblad of venster gewijzigd. Herlaad om verder te gaan; je laatste invoer is niet opgeslagen.';
  const conflictFout = tekst => { const e = new Error(tekst || O.CONFLICT_TEKST); e.code = 'conflict'; return e; };
  const revVan = r => (r && Number(r.rev)) || 0;
  O.schrijf = (rec, opties) => {
    opties = opties || {};
    const k = JSON.parse(JSON.stringify(rec)), verwacht = revVan(rec); k.bijgewerkt = new Date().toISOString();
    return beslis('opnames', (tx, stop, zet) => {
      const s = tx.objectStore('opnames'), q = s.get(k.id);
      q.onsuccess = () => {
        try {
          const huidig = q.result;
          if (opties.nieuw && huidig) { stop(conflictFout('Er bestaat al een opname met deze id (' + k.id + '). Er is niets overschreven.')); return; }
          if (huidig && revVan(huidig) !== verwacht) { stop(conflictFout()); return; }
          k.rev = (huidig ? revVan(huidig) : verwacht) + 1; s.put(k); zet(k);
        } catch (e) { stop(kwaad('Opslag', e)); }
      };
    });
  };
  // Terugzetten uit een export, atomair: de opname én al haar foto's in één transactie over beide stores, óf niets. Of de id al bestaat wordt hier, binnen de transactie, bepaald:
  // bepaal(huidigRecord of null) krijgt de stand van dat moment en geeft het plan { actie, opname_id, kopie, record, fotoRecords } (of actie 'staat-al-op-toestel': dan wordt er niets geschreven).
  O.importeer = (opnameId, bepaal) => beslis(['opnames', 'fotos'], (tx, stop, zet) => {
    const so = tx.objectStore('opnames'), sf = tx.objectStore('fotos'), q = so.get(opnameId);
    q.onsuccess = () => {
      try {
        const huidig = q.result || null, plan = bepaal(huidig); zet(plan);
        if (!plan || plan.actie === 'staat-al-op-toestel') return;
        if (plan.actie === 'terugzetten' && huidig) { stop(conflictFout('De opname staat inmiddels op dit toestel. Er is niets overschreven.')); return; }
        const schrijf = () => { try { for (const f of plan.fotoRecords) sf.put(f); so.put(Object.assign({}, plan.record, { rev: 1, bijgewerkt: new Date().toISOString() })); } catch (e) { stop(kwaad('Opslag', e)); } };
        if (plan.opname_id === opnameId) { schrijf(); return; }
        const q2 = so.get(plan.opname_id);
        q2.onsuccess = () => { if (q2.result) stop(conflictFout('De kopie-id ' + plan.opname_id + ' bestaat al. Er is niets overschreven; probeer het opnieuw.')); else schrijf(); };
      } catch (e) { stop(kwaad('Opslag', e)); }
    };
  });
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
