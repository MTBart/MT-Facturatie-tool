/* ============================================================================
 * mt-spiegel.js — zendkant van de alleen-lezen spiegel (rol meekijker, brok "spiegel")
 * ----------------------------------------------------------------------------
 * De worker heeft geen toegang tot SharePoint. Daarom stuurt een teamclient met schrijfrecht, NA een geslaagde SharePoint-save, een kopie
 * van dat bestand naar de worker (POST /spiegel/<store>). De meekijker leest die kopie (GET /spiegel/...) en raakt SharePoint nooit aan.
 *
 *   - Alleen laag 1 (STORES). Elke store hoort bij een matrixkolom; gezonden wordt alleen met het schrijfrecht daarvoor.
 *   - Gedebounced: per store hooguit eens per 5 minuten (de eerste keer na 3 s), de laatste stand wint; bij het verbergen/sluiten van de
 *     pagina (visibilitychange/pagehide) gaat wat nog wacht meteen weg. Zendingen gaan één voor één (geen golf bij het eerste vullen).
 *   - Versie: ts = het moment waarop de stand in SharePoint is vastgelegd (of gelezen); de worker weigert een oudere dan de bewaarde (409).
 *   - Na het laden (initStorage) vergelijkt naHydrate de SharePoint-ETags met /spiegel/_index en vult alleen wat achterloopt of ontbreekt.
 *   - Nooit in kijkmodus (rol meekijker) en nooit zonder schrijfrecht; de worker controleert dat opnieuw. Er wordt NIETS teruggeschreven
 *     naar SharePoint of naar een bestaande store; fouten worden stil genegeerd (de spiegel mag het opslaan nooit hinderen).
 * ========================================================================== */
(function (root) {
  'use strict';
  // store (bestandsnaam zonder .json) -> matrixkolom; moet gelijk lopen met SPIEGEL_STORES in worker.js
  const STORES = {
    mt_projecten: 'projecten', mt_planning: 'projecten', mt_planblokken: 'projecten', mt_planinrichting: 'projecten', mt_project_taken_v2: 'projecten',
    mt_project_afhank: 'projecten', mt_project_controle: 'projecten', mt_project_sjablonen: 'projecten', mt_klant_codes: 'projecten', 'klanten-registry-vol': 'projecten',
    mt_verlof: 'projecten', mt_vrijedagen: 'projecten', mt_opleveringen: 'projecten', mt_attentie: 'projecten',
    mt_calc_offertes: 'offertes', mt_calc_defaults: 'offertes', mt_offerte_keuze: 'offertes', mt_toeslag_lak: 'offertes', mt_toeslag_spuit: 'offertes',
    mt_uurtarieven: 'geld',
    mt_verbeterpunten: 'verbeterpunten', mt_feedback: 'verbeterpunten',
  };
  const INTERVAL_MS = 5 * 60 * 1000, EERSTE_WACHT_MS = 3000, HYDRATE_MIN_MS = 30 * 60 * 1000, VERS_MS = 24 * 3600 * 1000, KEEPALIVE_MAX = 60000;
  const basis = w => String(w || '').replace(/\/+$/, '');
  const winkel = bestand => String(bestand || '').replace(/\.json$/, '');

  // deps: { worker, fetch(url, init), auth() -> {'X-Auth-Token'}, recht(kolom) -> waarde, aan() -> bool, nu(), zetTimer(fn, ms), wisTimer(h) }
  function maak(deps) {
    const nu = deps.nu || (() => Date.now());
    const zetTimer = deps.zetTimer || ((f, ms) => root.setTimeout(f, ms)), wisTimer = deps.wisTimer || (h => root.clearTimeout(h));
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
      let data; try { data = JSON.parse(p.tekst); } catch (e) { stats.mislukt++; return; }
      if (!data || typeof data !== 'object') { stats.mislukt++; return; }
      let h; try { h = await deps.auth(); } catch (e) { h = null; }
      const terug = () => { if (!s.pending) { s.pending = p; s.laatst = Math.max(0, s.laatst); plan(store); } };   // later opnieuw proberen (niet als er al een nieuwere wacht)
      if (!h || !h['X-Auth-Token']) { stats.mislukt++; terug(); return; }
      const body = JSON.stringify({ ts: p.ts, etag: p.etag, data });
      try {
        const r = await deps.fetch(basis(deps.worker) + '/spiegel/' + encodeURIComponent(store),
          { method: 'POST', headers: Object.assign({}, h, { 'Content-Type': 'application/json' }), body, keepalive: !!(snel && body.length < KEEPALIVE_MAX) });
        if (r.ok) stats.verstuurd++;
        else if (r.status >= 500 || r.status === 429) { stats.mislukt++; terug(); }
        else stats.geweigerd++;                 // 409 (een nieuwere kopie ging voor), 400/403/413: niet opnieuw proberen
      } catch (e) { stats.mislukt++; terug(); }
    }

    // Hook voor makeSP: een SharePoint-PUT is geslaagd.
    function zend(bestand, tekst, etag, ts) {
      const store = winkel(bestand);
      if (!STORES[store] || !magSchrijven(store)) return false;
      const s = st(store); s.pending = { tekst, etag: etag || null, ts: ts || nu() };
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
    // `pref` = Map(bestand -> {ok,status,data}) van de SharePoint-listing, `etags` = _SP._etags, `lees(bestand)` = SharePoint-read voor wat niet in de listing zat.
    async function naHydrate(pref, etags, lees) {
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
          if (!idx || !idx.etag || !et || idx.etag !== et) { if (zend(bestand, JSON.stringify(pf.data), et, gelezen)) res.gezonden.push(store); }
        } else if (!pf && typeof lees === 'function' && (!idx || !idx.ts || gelezen - idx.ts > VERS_MS)) {   // niet in de listing: los lezen, hooguit eens per dag
          try {
            const tijd = nu(), d = await lees(bestand);   // {data, etag} of null; zonder bijwerken van de SharePoint-etags van de app
            if (d && d.data && typeof d.data === 'object' && zend(bestand, JSON.stringify(d.data), d.etag || null, tijd)) res.gezonden.push(store);
          } catch (e) { /* ontbreekt of onleesbaar: niets doen */ }
        }
      }
      return res;
    }
    // Hydrate-gegevens bewaren tot de rol bekend is (de rol komt vaak na initStorage binnen) en dan één keer proberen.
    function onthoudHydrate(pref, etags, lees) { wachtOpHydrate = { pref, etags: Object.assign({}, etags || {}), lees }; return probeer(); }
    function probeer() {
      if (!wachtOpHydrate || !deps.aan()) return Promise.resolve(null);
      const w = wachtOpHydrate; wachtOpHydrate = null;
      return naHydrate(w.pref, w.etags, w.lees).catch(() => null);
    }
    return { zend, flushAlles, naHydrate, onthoudHydrate, probeer, magSchrijven, stats, _staat: staat, STORES };
  }

  // Koppeling met de pagina (v2.html): één instantie, gevoed door MTRol en de worker-URL.
  function start(opt) {
    const inst = maak({
      worker: opt.worker, fetch: (u, i) => root.fetch(u, i), auth: () => root.authHeader(),
      recht: k => (root.MTRol && root.MTRol.recht ? root.MTRol.recht(k) : null),
      aan: () => !!(root.MTRol && root.MTRol.me && root.MTRol.me.rol && root.MTRol.me.rol !== 'meekijker'),   // alleen een ingelogd teamlid, nooit de meekijker
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
