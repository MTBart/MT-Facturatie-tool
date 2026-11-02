/* ============================================================================
 * mt-spiegel.js — zendkant van de alleen-lezen spiegel (rol meekijker, brok "spiegel")
 * ----------------------------------------------------------------------------
 * De worker heeft geen toegang tot SharePoint. Daarom stuurt een teamclient met schrijfrecht, NA een geslaagde SharePoint-save, een kopie
 * van dat bestand naar de worker (POST /spiegel/<store>). De meekijker leest die kopie (GET /spiegel/...) en raakt SharePoint nooit aan.
 * SharePoint blijft de bron: de spiegel is een afgeleide, door de worker geprojecteerde kopie (allowlist per store, zie worker.js).
 *
 *   - Alleen laag 1 (STORES). Gezonden wordt alleen met het schrijfrecht daarvoor; de worker controleert opnieuw met zijn store x rol-tabel.
 *   - Gedebounced: per store hooguit eens per 5 minuten (de eerste keer na 3 s), de laatste stand wint; bij het verbergen/sluiten van de
 *     pagina (visibilitychange/pagehide) gaat wat nog wacht meteen weg. Zendingen gaan één voor één (geen golf bij het eerste vullen).
 *   - Versie: ts = lastModifiedDateTime van SharePoint voor die stand (uit het PUT-antwoord, de listing of de metadata), nooit de klok van
 *     deze pc; zonder die versie wordt er niet gezonden (de volgende hydrate vult het bij). De worker weigert een niet-nieuwere (409).
 *   - Na het laden (initStorage) vergelijkt naHydrate de SharePoint-ETags met /spiegel/_index en vult alleen wat achterloopt of ontbreekt.
 *   - Nooit in kijkmodus (rol meekijker) en nooit zonder schrijfrecht. Er wordt NIETS teruggeschreven naar SharePoint of naar een bestaande
 *     store. Fouten worden nooit getoond aan de gebruiker (de spiegel mag het opslaan nooit hinderen), maar wel vastgelegd als /track-event
 *     'spiegel_fout' (via deps.logFout) zodat een achterstand zichtbaar is in het gebruiksoverzicht.
 * ========================================================================== */
(function (root) {
  'use strict';
  // Dezelfde 13 stores als SPIEGEL_STORES in worker.js. De worker projecteert zelf (allowlist) en bepaalt per rol wie mag schrijven; hier alleen wat
  // de client mag proberen: matrixkolom + niveau waarmee de eigen rol in /me staat (de worker controleert opnieuw met zijn store x rol-tabel).
  const STORES = {
    mt_projecten: 'projecten', mt_planning: 'projecten', mt_planblokken: 'projecten', mt_planinrichting: 'projecten', mt_project_taken_v2: 'projecten',
    mt_project_afhank: 'projecten', mt_vrijedagen: 'projecten',
    mt_calc_offertes: 'offertes', mt_calc_defaults: 'offertes', mt_offerte_keuze: 'offertes',
    mt_uurtarieven: 'geld',
    mt_verbeterpunten: 'verbeterpunten', mt_feedback: 'verbeterpunten',
  };
  // ISO-tekst of milliseconden -> ms (geheel getal) of 0.
  const msVan = v => { const n = typeof v === 'number' ? v : Date.parse(v || ''); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };
  const INTERVAL_MS = 5 * 60 * 1000, EERSTE_WACHT_MS = 3000, HYDRATE_MIN_MS = 30 * 60 * 1000, VERS_MS = 24 * 3600 * 1000, KEEPALIVE_MAX = 60000;
  const basis = w => String(w || '').replace(/\/+$/, '');
  const winkel = bestand => String(bestand || '').replace(/\.json$/, '');

  // deps: { worker, fetch(url, init), auth() -> {'X-Auth-Token'}, recht(kolom) -> waarde, aan() -> bool, nu(), zetTimer(fn, ms), wisTimer(h), logFout(store, reden) }
  function maak(deps) {
    const nu = deps.nu || (() => Date.now());
    const zetTimer = deps.zetTimer || ((f, ms) => root.setTimeout(f, ms)), wisTimer = deps.wisTimer || (h => root.clearTimeout(h));
    const logFout = (store, reden) => { try { if (deps.logFout) deps.logFout(store, reden); } catch (e) { } };
    const staat = new Map();                   // store -> { pending, laatst, timer }
    const stats = { verstuurd: 0, geweigerd: 0, mislukt: 0, overgeslagen: 0 };
    let ketting = Promise.resolve(), laatsteHydrate = 0, wachtOpHydrate = null;

    const magSchrijven = store => {
      const kolom = STORES[store]; if (!kolom || !deps.aan()) return false;
      const v = deps.recht(kolom);
      return kolom === 'verbeterpunten' ? ['maken', 'beheren', 'alles'].includes(v) : v === 'wijzigen';
    };
    const st = store => { let s = staat.get(store); if (!s) { s = { pending: null, laatst: 0, timer: null }; staat.set(store, s); } return s; };

    function plan(store) {
      const s = st(store); if (s.timer || !s.pending) return;
      const wacht = s.laatst ? Math.max(EERSTE_WACHT_MS, s.laatst + INTERVAL_MS - nu()) : EERSTE_WACHT_MS;
      s.timer = zetTimer(() => { s.timer = null; wachtrij(store, false); }, wacht);
    }
    function wachtrij(store, snel) { ketting = ketting.then(() => verstuur(store, snel)).catch(() => { }); return ketting; }

    async function verstuur(store, snel) {
      const s = st(store), p = s.pending; if (!p) return;
      if (!magSchrijven(store)) { s.pending = null; stats.overgeslagen++; return; }
      s.pending = null; s.laatst = nu();
      let data; try { data = JSON.parse(p.tekst); } catch (e) { stats.mislukt++; logFout(store, 'tekst'); return; }
      if (!data || typeof data !== 'object') { stats.mislukt++; logFout(store, 'vorm'); return; }
      let h; try { h = await deps.auth(); } catch (e) { h = null; }
      const terug = () => { if (!s.pending) { s.pending = p; plan(store); } };   // later opnieuw proberen (niet als er al een nieuwere wacht)
      if (!h || !h['X-Auth-Token']) { stats.mislukt++; logFout(store, 'geen-token'); terug(); return; }
      const body = JSON.stringify({ ts: p.ts, etag: p.etag, data });
      try {
        const r = await deps.fetch(basis(deps.worker) + '/spiegel/' + encodeURIComponent(store),
          { method: 'POST', headers: Object.assign({}, h, { 'Content-Type': 'application/json' }), body, keepalive: !!(snel && body.length < KEEPALIVE_MAX) });
        if (r.ok) stats.verstuurd++;
        else if (r.status >= 500 || r.status === 429) { stats.mislukt++; logFout(store, 'http-' + r.status); terug(); }
        else { stats.geweigerd++; if (r.status !== 409) logFout(store, 'http-' + r.status); }   // 409 = een nieuwere versie ging voor (normaal); 400/403/413: niet opnieuw proberen
      } catch (e) { stats.mislukt++; logFout(store, 'netwerk'); terug(); }
    }

    // Hook voor makeSP: een SharePoint-PUT is geslaagd. `versie` = lastModifiedDateTime van die stand (ISO of ms).
    function zend(bestand, tekst, etag, versie) {
      const store = winkel(bestand);
      if (!STORES[store] || !magSchrijven(store)) return false;
      const ts = msVan(versie); if (!ts) { logFout(store, 'geen-versie'); return false; }       // zonder SharePoint-versie niet zenden (nooit de klok van deze pc)
      const s = st(store); if (s.pending && s.pending.ts > ts) return false;                      // een nieuwere stand wacht al
      s.pending = { tekst, etag: etag || null, ts };
      plan(store); return true;
    }
    function flushAlles() {
      for (const [store, s] of staat) { if (s.pending) { if (s.timer) { wisTimer(s.timer); s.timer = null; } wachtrij(store, true); } }
      return ketting;
    }

    async function leesIndex() {
      const h = await deps.auth(); if (!h || !h['X-Auth-Token']) return null;
      const r = await deps.fetch(basis(deps.worker) + '/spiegel/_index', { headers: h });
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      return j && j.stores && typeof j.stores === 'object' ? j.stores : null;
    }
    // Na initStorage: alleen wat in de spiegel ontbreekt of achterloopt (andere ETag; of niet in de listing en ouder dan 24 uur) wordt gezonden.
    // `pref` = Map(bestand -> {ok,status,data}) van de SharePoint-listing, `etags` = _SP._etags, `gewijzigd` = _SP._gewijzigd (versie per bestand uit de listing),
    // `lees(bestand)` = SharePoint-read mét versie ({data, etag, gewijzigd} of null) voor wat niet in de listing zat.
    async function naHydrate(pref, etags, lees, gewijzigd) {
      if (!deps.aan() || nu() - laatsteHydrate < HYDRATE_MIN_MS) return { overgeslagen: true };
      laatsteHydrate = nu();
      let index; try { index = await leesIndex(); } catch (e) { index = null; }
      if (!index) { laatsteHydrate = 0; return { index: false }; }
      const gelezen = nu(), res = { gezonden: [] };
      for (const store of Object.keys(STORES)) {
        if (!magSchrijven(store)) continue;
        const bestand = store + '.json', idx = index[store], pf = pref && pref.get ? pref.get(bestand) : null;
        if (pf && pf.ok && pf.status === 200 && pf.data && typeof pf.data === 'object') {
          const et = etags && etags[bestand] || null;
          if (!idx || !idx.etag || !et || idx.etag !== et) { if (zend(bestand, JSON.stringify(pf.data), et, gewijzigd && gewijzigd[bestand])) res.gezonden.push(store); }
        } else if (!pf && typeof lees === 'function' && (!idx || !idx.ts || gelezen - idx.ts > VERS_MS)) {   // niet in de listing: los lezen, hooguit eens per dag
          try {
            const d = await lees(bestand);   // {data, etag, gewijzigd} of null; zonder bijwerken van de SharePoint-etags van de app
            if (d && d.data && typeof d.data === 'object' && (!idx || !idx.etag || idx.etag !== d.etag) && zend(bestand, JSON.stringify(d.data), d.etag || null, d.gewijzigd)) res.gezonden.push(store);
          } catch (e) { logFout(store, 'lezen'); }
        }
      }
      return res;
    }
    // Hydrate-gegevens bewaren tot de rol bekend is (de rol komt vaak na initStorage binnen) en dan één keer proberen.
    function onthoudHydrate(pref, etags, lees, gewijzigd) { wachtOpHydrate = { pref, etags: Object.assign({}, etags || {}), lees, gewijzigd: Object.assign({}, gewijzigd || {}) }; return probeer(); }
    function probeer() {
      if (!wachtOpHydrate || !deps.aan()) return Promise.resolve(null);
      const w = wachtOpHydrate; wachtOpHydrate = null;
      return naHydrate(w.pref, w.etags, w.lees, w.gewijzigd).catch(() => null);
    }
    return { zend, flushAlles, naHydrate, onthoudHydrate, probeer, magSchrijven, stats, _staat: staat, STORES };
  }

  // Koppeling met de pagina (v2.html): één instantie, gevoed door MTRol en de worker-URL.
  function start(opt) {
    const inst = maak({
      worker: opt.worker, fetch: (u, i) => root.fetch(u, i), auth: () => root.authHeader(),
      recht: k => (root.MTRol && root.MTRol.recht ? root.MTRol.recht(k) : null),
      aan: () => !!(root.MTRol && root.MTRol.me && root.MTRol.me.rol && root.MTRol.me.rol !== 'meekijker'),   // alleen een ingelogd teamlid, nooit de meekijker
      logFout: (store, reden) => { if (typeof root.track === 'function') root.track('spiegel', 'spiegel_fout', { detail: store + ' ' + reden, ok: false }); },   // zichtbaar in het gebruiksoverzicht
    });
    try {
      root.document.addEventListener('visibilitychange', () => { if (root.document.visibilityState === 'hidden') inst.flushAlles(); });
      root.addEventListener('pagehide', () => inst.flushAlles());
      root.addEventListener('mt-rol', () => inst.probeer());
    } catch (e) { }
    return inst;
  }
  root.MTSpiegel = { maak, start, STORES };
})(typeof window !== 'undefined' ? window : globalThis);
