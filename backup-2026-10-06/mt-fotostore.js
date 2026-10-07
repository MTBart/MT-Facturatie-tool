/* =====================================================================
   MT-FOTOSTORE — lokale herstelkopie voor rapportfoto's (IndexedDB)
   =====================================================================
   Gedeeld door mobiel.html (rapportflow) en test/fotoherstel-test.html.
   Eigen database 'mt-rapporten' zodat de bestaande 'mt-app'/'drafts'
   (losse-opname-concept) ongemoeid blijft.

   Stores:
   - fotos   : key = foto-id. Record bevat de Blob zelf (structured clone)
               + metadata + uploadstatus. Dit is de harde herstelkopie:
               een foto is pas "opgeslagen" als de put() hier gelukt is.
   - drafts  : key = rapport-id. Conceptrapport-metadata (geen blobs).

   Uploadstatus per foto: 'lokaal' (veilig op toestel, nog niet verstuurd),
   'wacht' (upload gepland), 'sync' (bewezen op SharePoint), 'fout'
   (upload mislukt — opnieuw proberen). Blobs worden hier NOOIT impliciet
   verwijderd: alleen cleanupSynced() ruimt op, en alleen foto's met
   status 'sync', ná definitieve afronding van het rapport.
   ===================================================================== */
(function (global) {
  "use strict";

  const DB_NAME = "mt-rapporten";
  const DB_VERSION = 1;
  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("fotos")) db.createObjectStore("fotos");
        if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts");
      };
      req.onsuccess = () => { _db = req.result; _db.onclose = () => { _db = null; }; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function _tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const os = tx.objectStore(store);
      const req = fn(os);
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transactie afgebroken"));
    }));
  }

  function newId(prefix) {
    return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }

  const MTFotoStore = {
    newId,

    /* ── foto's ── */
    // rec: {id, rapportId, hoofdstukId, naam, mime, opmerking, soort, ts, status, blob, bewerktBlob}
    async putFoto(rec) {
      if (!rec || !rec.id) throw new Error("putFoto: id verplicht");
      if (!(rec.blob instanceof Blob)) throw new Error("putFoto: blob verplicht");
      await _tx("fotos", "readwrite", os => os.put(rec, rec.id));
      return rec.id;
    },
    async getFoto(id) { return _tx("fotos", "readonly", os => os.get(id)); },
    async listFotos(rapportId) {
      const all = await _tx("fotos", "readonly", os => os.getAll());
      return (all || []).filter(r => r && (!rapportId || r.rapportId === rapportId));
    },
    async setFotoStatus(id, status) {
      const rec = await this.getFoto(id);
      if (!rec) return false;
      rec.status = status;
      await _tx("fotos", "readwrite", os => os.put(rec, id));
      return true;
    },
    async updateFoto(id, patch) {
      const rec = await this.getFoto(id);
      if (!rec) return false;
      Object.assign(rec, patch);
      await _tx("fotos", "readwrite", os => os.put(rec, id));
      return true;
    },
    async deleteFoto(id) { await _tx("fotos", "readwrite", os => os.delete(id)); },

    /* ── conceptrapporten ── */
    async putDraft(draft) {
      if (!draft || !draft.rapportId) throw new Error("putDraft: rapportId verplicht");
      await _tx("drafts", "readwrite", os => os.put(draft, draft.rapportId));
      return draft.rapportId;
    },
    async getDraft(rapportId) { return _tx("drafts", "readonly", os => os.get(rapportId)); },
    async listDrafts() {
      const all = await _tx("drafts", "readonly", os => os.getAll());
      return (all || []).filter(Boolean);
    },
    async deleteDraft(rapportId) { await _tx("drafts", "readwrite", os => os.delete(rapportId)); },

    /* ── opruimen: alléén na bewezen upload + definitieve afronding ── */
    async cleanupSynced(rapportId) {
      const fotos = await this.listFotos(rapportId);
      const removed = [];
      for (const f of fotos) {
        if (f.status === "sync") { await this.deleteFoto(f.id); removed.push(f.id); }
      }
      const rest = (await this.listFotos(rapportId)).length;
      if (!rest) await this.deleteDraft(rapportId);
      return { removed, rest };
    },

    /* Blob → File terug (voor herstel na reload) */
    fotoToFile(rec, edited) {
      const b = edited ? rec.bewerktBlob : rec.blob;
      if (!b) return null;
      try { return new File([b], rec.naam || "foto.jpg", { type: rec.mime || b.type || "image/jpeg" }); }
      catch (e) { return b; }
    },

    async estimateQuota() {
      if (navigator.storage && navigator.storage.estimate) {
        try { return await navigator.storage.estimate(); } catch (e) { /* ignore */ }
      }
      return null;
    }
  };

  global.MTFotoStore = MTFotoStore;
})(typeof window !== "undefined" ? window : globalThis);
