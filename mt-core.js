/* ============================================================================
 * mt-core.js — gedeelde kernlaag voor de cockpit (v2.html) én de app (mobiel.html)
 * ----------------------------------------------------------------------------
 * Eén bron voor de code die tot nu toe in BEIDE bestanden apart leefde en
 * daardoor uit elkaar dreef (audit 2026-07-02, bevinding #5 + actie S2):
 *
 *   - esc()      — canonieke HTML-escaper (& < > ")
 *   - _encPath() — Graph-pad-encoder die '#' en '?' in projectnamen redt
 *   - auth       — MSAL-tokenhelpers (getAuthToken / getGraphToken)
 *   - _SP        — SharePoint-synclaag (site-resolve, faalveilig read, write met
 *                  S1 ETag/If-Match + 412-merge)
 *
 * GEEN build-pipeline: dit is een los <script src="mt-core.js?v=..."> dat vóór
 * de gebruikende code laadt (zelfde patroon als calc-engine.js). Alles wordt
 * expliciet op window gezet zodat bestaande inline-code in beide HTML-bestanden
 * ongewijzigd blijft werken.
 *
 * v2 ↔ mobiel VERSCHILLEN worden geünificeerd via configuratie, niet door een
 * van beide gedragingen te laten vallen:
 *   - installAuth({ graphScopes, onTokenOk, onTokenFail })
 *       * graphScopes: v2 heeft 7 scopes (incl. Mail/Calendars/Tasks), mobiel 2.
 *       * onTokenFail: v2 toont de sessie-verlopen-banner (Q7); mobiel geeft stil
 *         null terug en leunt op zijn _RQ-retry-queue. Hook i.p.v. hardcode.
 *       * onTokenOk: v2 wist de sessie-banner weer; mobiel laat 'm leeg.
 *     (De redirectUri-strip van 'v2.html'/'mobiel.html' blijft per pagina in
 *      initMsal — die functie verschilt sowieso al tussen beide.)
 *   - makeSP({ toast, onSyncStatus, trackLastSync })
 *       * toast: v2 gebruikt planToast, mobiel showToast (bij niet-mergebaar 412).
 *       * onSyncStatus: v2 heeft updateSyncStatus + lastSync-status; mobiel niet.
 *       * trackLastSync: v2 vult _SP.lastSync (zichtbare sync-status), mobiel niet.
 *   Page-specifieke uitbreidingen (v2: KEYS/ready/schedule/PROJ_DRIVE/mkdir-helpers;
 *   mobiel: _RQ-koppeling) blijven in het betreffende HTML-bestand en worden via
 *   Object.assign óp de kern-_SP gelegd.
 * ========================================================================== */
(function (root) {
  'use strict';
  if (!root) return;

  // ── esc — canonieke HTML-escaper ─────────────────────────────────────────
  // Zelfde tekenmap als het oude tgEsc/esc in v2. Bewust NIET voor attribute-only
  // escapes of CSV-quoting — die functies houden hun eigen lokale helper.
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
    }[c]));
  }

  // ── _encPath — Graph laat '#' en '?' staan → URL breekt bij namen als
  //    "#519617 CN Bajeskwartier". Deze twee alsnog percent-encoden.
  function _encPath(p) {
    return encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
  }

  // ── authHeader — X-Auth-Token-header voor Worker-calls. Meteen beschikbaar
  //    (niet achter installAuth) zodat vroege fetch-code er niet op struikelt;
  //    leest root.getAuthToken pas op aanroep-tijd.
  async function authHeader() {
    const t = typeof root.getAuthToken === 'function' ? await root.getAuthToken() : null;
    return t ? { 'X-Auth-Token': t } : {};
  }

  // ── Auth (MSAL-tokenhelpers) ─────────────────────────────────────────────
  // De MSAL-instance zelf (_msal) en initMsal/toonApp blijven per pagina — die
  // verschillen (mobiel handelt redirect-terugkeer af, v2 niet). De token-
  // acquisitie is wél identiek op scopes en de fail-hook na.
  //
  // config: { graphScopes: string[], onTokenFail?: fn(err), onTokenOk?: fn() }
  function installAuth(config) {
    config = config || {};
    const GRAPH_SCOPES = config.graphScopes || [
      'https://graph.microsoft.com/Files.ReadWrite',
      'https://graph.microsoft.com/Sites.ReadWrite.All'
    ];
    root.MT_GRAPH_SCOPES = GRAPH_SCOPES;

    // ID-token (voor de Worker: X-Auth-Token). Silent-only; geen popup.
    root.getAuthToken = async function () {
      const m = root._msal;
      if (!m) return null;
      const accounts = m.getAllAccounts();
      if (!accounts.length) return null;
      try {
        const result = await m.acquireTokenSilent({ scopes: ['openid', 'profile'], account: accounts[0] });
        return result.idToken;
      } catch (e) { return null; }
    };

    // Graph-accesstoken. Silent → popup-fallback → onTokenFail-hook.
    root.getGraphToken = async function () {
      const m = root._msal;
      if (!m) return null;
      const accounts = m.getAllAccounts();
      if (!accounts.length) return null;
      try {
        const result = await m.acquireTokenSilent({ scopes: GRAPH_SCOPES, account: accounts[0] });
        if (typeof config.onTokenOk === 'function') config.onTokenOk();
        return result.accessToken;
      } catch (e) {
        try {
          const result = await m.acquireTokenPopup({ scopes: GRAPH_SCOPES });
          if (typeof config.onTokenOk === 'function') config.onTokenOk();
          return result.accessToken;
        } catch (e2) {
          if (typeof config.onTokenFail === 'function') config.onTokenFail(e2);
          return null;   // stille null (mobiel) of banner is via de hook getoond (v2)
        }
      }
    };

    return { GRAPH_SCOPES };
  }

  // ── SharePoint-synclaag (kern) ───────────────────────────────────────────
  // Levert de gedeelde methoden; de aanroeper legt er via Object.assign zijn
  // page-specifieke velden/methoden bovenop (v2: KEYS/ready/schedule/PROJ_DRIVE
  // + mkdir-helpers; mobiel: koppeling met _RQ).
  //
  // config: {
  //   toast?: fn(msg)           // niet-mergebaar 412 → gebruiker waarschuwen
  //   onSyncStatus?: fn()       // na elke write de zichtbare sync-status bijwerken
  //   trackLastSync?: bool      // this.lastSync = {ts,ok,key,error} bijhouden (v2)
  //   etagKeys?: Set<string>    // opt-in keys met If-Match/412-merge (default mt_planning)
  // }
  function makeSP(config) {
    config = config || {};
    const toast = typeof config.toast === 'function' ? config.toast : function () {};
    const syncStatus = typeof config.onSyncStatus === 'function' ? config.onSyncStatus : function () {};
    const trackLastSync = !!config.trackLastSync;

    const SP = {
      SITE: 'mortisetenon.sharepoint.com:/sites/MortiseTenon',
      SITE_ID: null,               // resolved site-id (cache) — colon-path chaining geeft HTTP 400
      FOLDER: 'MT-Bedrijfstool',

      // S1 — ETag-concurrency. Alleen keys in etagKeys krijgen If-Match +
      // 412-conflictafhandeling; andere keys houden last-write-wins.
      etagKeys: config.etagKeys instanceof Set ? config.etagKeys : new Set(['mt_planning']),
      _etags: {},                  // filename -> laatst gelezen ETag

      lastSync: null,              // {ts, ok, key, error} — alleen gevuld als trackLastSync

      // Graph weigert twee colon-paths in één URL; daarom eerst de site naar id
      // resolven en dáármee /sites/{id}/drive/... bouwen.
      async _driveBase() {
        const token = await root.getGraphToken();
        if (!token) throw new Error('geen Graph-token (Microsoft-login/toestemming vereist)');
        if (!this.SITE_ID) {
          const sr = await fetch(`https://graph.microsoft.com/v1.0/sites/${this.SITE}`,
            { headers: { 'Authorization': `Bearer ${token}` } });
          if (!sr.ok) throw new Error(`site-resolve HTTP ${sr.status}`);
          this.SITE_ID = (await sr.json()).id;
        }
        return { base: `https://graph.microsoft.com/v1.0/sites/${this.SITE_ID}/drive`, token };
      },

      // Faalveilig lezen: ALLEEN 404 → null. Elke andere fout gooit — een leesfout
      // mag nooit als "SharePoint leeg" gelden, anders migreert stale localStorage
      // over de echte data heen (het twee-PC-clobber-patroon).
      async read(filename) {
        const { base, token } = await this._driveBase();
        const r = await fetch(`${base}/root:/${this.FOLDER}/${filename}:/content`,
          { headers: { 'Authorization': `Bearer ${token}` } });
        if (r.status === 404) { delete this._etags[filename]; return null; }
        if (!r.ok) {
          console.warn('SP read faalde:', filename, 'HTTP', r.status);
          throw new Error(`SP read ${filename}: HTTP ${r.status}`);
        }
        const et = r.headers.get('ETag');
        if (et) this._etags[filename] = et; else delete this._etags[filename];
        return await r.json();
      },

      async write(filename, data) {
        try {
          const { base, token } = await this._driveBase();
          const key = filename.replace(/\.json$/, '');
          const useEtag = this.etagKeys.has(key) && this._etags[filename];
          const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
          if (useEtag) headers['If-Match'] = this._etags[filename];
          const body = typeof data === 'string' ? data : JSON.stringify(data);
          const r = await fetch(`${base}/root:/${this.FOLDER}/${filename}:/content`,
            { method: 'PUT', headers, body });
          // S1: 412 = SP-versie nieuwer dan onze ETag → re-read, mergen, herschrijven.
          if (r.status === 412 && useEtag) return await this._resolveConflict(filename, data);
          if (r.ok) { const et = r.headers.get('ETag'); if (et) this._etags[filename] = et; }
          if (trackLastSync) this.lastSync = { ts: Date.now(), ok: r.ok, key: filename, error: r.ok ? null : `HTTP ${r.status}` };
          if (!r.ok) console.warn('SP write faalde:', filename, 'HTTP', r.status);
          syncStatus();
          return r.ok;
        } catch (e) {
          if (trackLastSync) this.lastSync = { ts: Date.now(), ok: false, key: filename, error: e.message };
          console.warn('SP write fout:', filename, e.message);
          syncStatus();
          return false;
        }
      },

      // S1 — conflictafhandeling na HTTP 412 (opt-in keys). Re-read (ververst
      // _etags), merge lokale wijzigingen erin (bij zelfde id/sleutel wint LOKAAL),
      // herschrijf met verse ETag. Niet-mergebare vorm → NIET blind overschrijven:
      // toast + write laten vallen; volgende schedule/flush herprobeert.
      // NB (mobiel): een 412 gaat bewust NIET terug in _RQ — dat zou dezelfde bytes
      // in een oneindige retry-loop zetten. De caller regelt dat; hier één keer.
      async _resolveConflict(filename, localData) {
        let remote;
        try { remote = await this.read(filename); }   // ververst _etags[filename]
        catch (e) {
          console.warn('SP 412 re-read faalde:', filename, e.message);
          if (trackLastSync) this.lastSync = { ts: Date.now(), ok: false, key: filename, error: '412 re-read faalde' };
          syncStatus();
          return false;
        }
        const local = (typeof localData === 'string')
          ? (() => { try { return JSON.parse(localData); } catch (e) { return localData; } })()
          : localData;
        const merged = this._mergeById(remote, local);
        if (merged === null) {
          const key = filename.replace(/\.json$/, '');
          console.warn('SP 412 op', key, '— niet-mergebare vorm, write overgeslagen (herlaad → verse write)');
          toast('⚠ sync-conflict op ' + key + ', herladen');
          if (trackLastSync) this.lastSync = { ts: Date.now(), ok: false, key: filename, error: 'sync-conflict (herladen)' };
          syncStatus();
          return false;
        }
        const { base, token } = await this._driveBase();
        const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
        if (this._etags[filename]) headers['If-Match'] = this._etags[filename];
        const r = await fetch(`${base}/root:/${this.FOLDER}/${filename}:/content`,
          { method: 'PUT', headers, body: JSON.stringify(merged) });
        if (r.ok) {
          const et = r.headers.get('ETag'); if (et) this._etags[filename] = et;
          if (trackLastSync) this.lastSync = { ts: Date.now(), ok: true, key: filename, error: null };
        } else {
          console.warn('SP 412-merge herschrijf faalde:', filename, 'HTTP', r.status);
          if (trackLastSync) this.lastSync = { ts: Date.now(), ok: false, key: filename, error: `HTTP ${r.status} (na merge)` };
        }
        syncStatus();
        return r.ok;
      },

      // S5 — snelle hydrate: haal de metadata van ALLE bestanden in de map met één
      // children-listing (naam + eTag + preauth downloadUrl), dan de gevraagde
      // bestanden parallel via hun downloadUrl. Scheelt bij login een reeks losse
      // site-resolve→content round-trips (initStorage deed er ~15 na elkaar-ish).
      //
      // Waarom listing i.p.v. Graph $batch van ':/content': dat pad geeft HTTP 302
      // naar een download-URL; in een $batch wordt die redirect NIET gevolgd, dus
      // je krijgt geen inhoud terug. De children-listing levert eTag én downloadUrl
      // rechtstreeks in de body — S1-ETags blijven zo intact — en is bovendien één
      // request i.p.v. een batch van twintig.
      //
      // Retour: Map(filename -> { ok, status, data }).
      //   - bestand niet in de map  -> { ok:true,  status:404, data:null }  (→ migreren)
      //   - downloadUrl-fetch faalt  -> { ok:false, status, data:null }     (→ key blokkeren)
      // De listing zelf faalt (≠ leeg) -> throw: de caller blokkeert dan ALLE keys,
      // net als wanneer een losse read een niet-404-fout gaf (anti-clobber).
      async prefetch(filenames) {
        const { base, token } = await this._driveBase();
        const listUrl = `${base}/root:/${this.FOLDER}:/children`
          + `?$select=name,eTag,@microsoft.graph.downloadUrl&$top=999`;
        const lr = await fetch(listUrl, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!lr.ok) throw new Error(`SP prefetch listing: HTTP ${lr.status}`);
        const kinderen = (await lr.json()).value || [];
        const byName = new Map();
        for (const c of kinderen) byName.set(c.name, c);

        const out = new Map();
        await Promise.all(filenames.map(async (filename) => {
          const meta = byName.get(filename);
          if (!meta) {                       // bestaat niet → zelfde als een echte 404
            delete this._etags[filename];
            out.set(filename, { ok: true, status: 404, data: null });
            return;
          }
          // S1: eTag uit de listing bewaren zodat write() 'm als If-Match meestuurt.
          if (meta.eTag) this._etags[filename] = meta.eTag; else delete this._etags[filename];
          const dl = meta['@microsoft.graph.downloadUrl'];
          if (!dl) {                         // geen downloadUrl (bv. lege map-item) → val terug op losse read
            try { out.set(filename, { ok: true, status: 200, data: await this.read(filename) }); }
            catch (e) { out.set(filename, { ok: false, status: 0, data: null, error: e.message }); }
            return;
          }
          try {
            // Preauth-URL: geen Authorization-header, geen CORS-preflight, korte TTL.
            const dr = await fetch(dl);
            if (dr.status === 404) { out.set(filename, { ok: true, status: 404, data: null }); return; }
            if (!dr.ok) { out.set(filename, { ok: false, status: dr.status, data: null }); return; }
            out.set(filename, { ok: true, status: 200, data: await dr.json() });
          } catch (e) {
            out.set(filename, { ok: false, status: 0, data: null, error: e.message });
          }
        }));
        return out;
      },

      // Merge remote+local; lokaal wint bij gelijke sleutel. null = niet-mergebare vorm.
      _mergeById(remote, local) {
        if (Array.isArray(local) && Array.isArray(remote)
            && local.every(x => x && typeof x === 'object' && 'id' in x)
            && remote.every(x => x && typeof x === 'object' && 'id' in x)) {
          const byId = new Map();
          for (const rec of remote) byId.set(rec.id, rec);
          for (const rec of local) byId.set(rec.id, rec);   // lokaal wint
          return [...byId.values()];
        }
        const isPlainObj = v => v && typeof v === 'object' && !Array.isArray(v);
        if (isPlainObj(local) && (isPlainObj(remote) || remote === null)) {
          return Object.assign({}, remote || {}, local);    // lokale sleutels winnen
        }
        return null;   // niet veilig mergebaar
      }
    };

    return SP;
  }

  // ── Export op window (geen build → globals expliciet) ────────────────────
  root.esc = esc;
  root._encPath = _encPath;
  root.authHeader = authHeader;
  root.MTCore = { esc, _encPath, authHeader, installAuth, makeSP };

})(typeof window !== 'undefined' ? window : null);
