/* ============================================================================
 * mt-kijk.js — kijkmodus voor de rol "meekijker" (externe coach): alles inzien, niets wijzigen, nooit SharePoint/Graph
 * ----------------------------------------------------------------------------
 * De worker dwingt de rol af (dat is de echte poort); dit bestand maakt de browser eromheen "dicht by default":
 *   0. Vroeg (v2.html, vóór de app-scripts): een #EXT#-gast in de MSAL-cache (of een eerder bevestigde meekijker) start meteen in STRENGE modus:
 *      alleen /me en de Microsoft-login mogen het netwerk op, de app blijft verborgen achter een neutraal laadscherm tot /me bevestigt dat dit
 *      een meekijker is (rol meekijker + altijdAfdwingen). Is dat niet zo, dan blijft alles dicht met een nette melding.
 *   1. Opslag: localStorage en indexedDB worden vervangen door een LEGE geheugenopslag. De kijkmodus leest en schrijft nooit bestaande sleutels van
 *      de app in de browser en wist ze ook niet (lokale gegevens blijven onaangeroerd, ook als iemand de kijkmodus in een eigen browser test).
 *   2. Graph: getGraphToken geeft voor een meekijker (en voor elke #EXT#-gast) altijd null — nooit een token, nooit een popup.
 *   3. Data: _SP.read/prefetch lezen uit /spiegel (de kopie die het team vult); _SP.write/maakAan/merge doen niets ("alleen inkijken").
 *      De calculatie-sync (mt_calc_offertes) leest eveneens alleen uit de spiegel; de oude sync staat uit.
 *   4. Netwerk: elke fetch/XHR/sendBeacon gaat door een toets (routeMag). Toegestaan: GET naar de leesroutes van de worker, de Reports-
 *      POST's (lezen), /track voor het kijkoverzicht, en de MSAL-login. Graph/SharePoint/Office-hosts en alle andere schrijfverzoeken
 *      worden in de browser geweigerd (synthetische 403) — de worker weigert ze daarna nog eens. Elk verzoek naar de worker draagt
 *      X-MT-Kijk: <versie>; een meekijker-verzoek zonder die header (een oude, gecachte client) weigert de worker.
 *   5. Scherm: tabs die niet voor de coach zijn verdwijnen, een banner "Meekijken · stand van …", schrijf-knoppen (op naam van hun
 *      handler) en formulieren worden geblokkeerd met een nette melding. MTRol.mag() toetst voor deze rol altijd echt (modus afdwingen).
 * Volgorde (v2.html): script (data-kijk="v2") vroeg · installAuth → MTKijk.bewaakGraph() · toonApp → koppelSP(_SP) + await voorStart(account).
 * ========================================================================== */
(function (root) {
  'use strict';
  const doc = root.document;
  const eigenScript = doc && doc.currentScript;                                         // alleen nu (synchroon) te lezen
  const pagina = eigenScript && eigenScript.getAttribute ? eigenScript.getAttribute('data-kijk') : null;
  const VERSIE = '1';                                                                    // X-MT-Kijk; de worker eist minimaal deze waarde van een meekijker
  const STANDAARD_WORKER = 'https://mt-claude-proxy.bart-a12.workers.dev';
  const VLAG = 'mtkijk.gebruiker', HERSTART = 'mtkijk.herstart';                          // eigen sleutels (nooit sleutels van de app)
  // Zelfde 15 stores als SPIEGEL_STORES in worker.js (de worker projecteert: geen contactgegevens, notities, e-mailadressen).
  const STORES = ['mt_projecten', 'mt_planning', 'mt_planblokken', 'mt_planinrichting', 'mt_project_taken_v2', 'mt_project_afhank', 'mt_vrijedagen',
    'mt_calc_offertes', 'mt_calc_defaults', 'mt_offerte_keuze', 'mt_toeslag_lak', 'mt_toeslag_spuit', 'mt_uurtarieven', 'mt_verbeterpunten', 'mt_feedback'];
  const TOESLAG = ['mt_toeslag_lak', 'mt_toeslag_spuit'];                                // in de spiegel verpakt als {waarde: getal}; hier weer uitgepakt
  const KERN = ['mt_projecten', 'mt_planning', 'mt_project_taken_v2'];                  // zonder deze is er "nog geen gegevens"
  const VERBORGEN_TABS = ['dashboard', 'inbox', 'attentie', 'oplevering', 'voorraad', 'bestelling', 'klanten', 'instellingen', 'admin'];
  const GRAPH_HOST = /(^|\.)(graph\.microsoft\.com|sharepoint\.com|sharepoint-df\.com|onedrive\.live\.com|1drv\.ms|office\.com|office365\.com|outlook\.com)$/i;
  const LEES_GET = [/^\/me$/, /^\/klanten$/, /^\/instellingen$/, /^\/teller\/(status|werkcodes|binding)$/, /^\/signalen$/, /^\/zoek\/moneybird$/, /^\/geld\//, /^\/spiegel(\/|$)/];
  const PROXY_LEES = ['toggl', 'toggl_focus', 'toggl_admin_projects', 'moneybird'];     // GET; de worker toetst het pad nog eens
  // Handlers die wijzigen (op naam). Alleen een vangnet bovenop de gegevenslaag; data-kijk-ok op een element zet de toets uit.
  const SCHRIJF_RE = /(save|opslaan|bewaar|verwijder|delete|remove|wissen|toevoeg|nieuw|aanmaken|create|maak|boek|verstuur|send|archiv|bewerk|edit|wijzig|import|upload|koppel|afvink|markeer|overzetten|genereer|timer|dupli|verplaats|inplan|toewijs|plak|accepteer|goedkeur|afwijs)/i;
  // Handlers die toevallig een schrijfwoord bevatten maar alleen iets sluiten/openen (gecontroleerd tegen alle inline onclick's in v2.html en mt-*.js).
  const SCHRIJF_OK_RE = /^\s*(MTKoppelUI\.sluit|tbOpenInNieuwVenster|updNieuwToon)\b/;

  const K = { aan: false, modus: null, STORES, VERSIE, standen: {}, geblokkeerd: [], _sp: null, _worker: '', _rolWacht: null, _guards: false, _geopend: 0, _vroeg: false };

  const nee = reden => ({ ok: false, reden }), ja = () => ({ ok: true });
  K.extern = account => /#ext#/i.test(String((account && account.username) || ''));
  const huidigeAccount = () => { try { const a = root._msal && root._msal.getAllAccounts(); return a && a[0] || null; } catch (e) { return null; } };
  K.graphDicht = () => K.aan || K.modus === 'streng' || K.extern(huidigeAccount());

  // ── Opslag: leeg en alleen in het geheugen ────────────────────────────────────────────────────────────────────────────────────
  // Vervangt window.localStorage (en maakt indexedDB onbereikbaar) door een lege opslag; de echte opslag wordt niet gelezen, geschreven of gewist.
  // MSAL houdt zijn eigen verwijzing naar de echte opslag (zijn tokencache blijft werken). Moet vóór de app-scripts: die leggen
  // localStorage.setItem.bind(localStorage) vast.
  K.maakGeheugenOpslag = function () {
    const m = new Map();
    const api = {
      getItem: k => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: k => { m.delete(String(k)); },
      clear: () => { m.clear(); }, key: i => { const s = [...m.keys()]; return i >= 0 && i < s.length ? s[i] : null; }, get length() { return m.size; },
    };
    return new Proxy(api, {
      get(t, p) { if (p in t) return typeof t[p] === 'function' ? t[p].bind(t) : t[p]; return typeof p === 'string' && m.has(p) ? m.get(p) : undefined; },
      set(t, p, v) { if (p in t) { try { t[p] = v; } catch (e) { } return true; } m.set(String(p), String(v)); return true; },
      has(t, p) { return p in t || (typeof p === 'string' && m.has(p)); },
      ownKeys() { return [...m.keys()]; },
      getOwnPropertyDescriptor(t, p) { return typeof p === 'string' && m.has(p) ? { value: m.get(p), writable: true, enumerable: true, configurable: true } : undefined; },
      deleteProperty(t, p) { m.delete(String(p)); return true; },
    });
  };
  K.installeerOpslag = function () {
    if (K._opslag) return;
    try { K._echt = root.localStorage; } catch (e) { K._echt = null; }                  // alleen een verwijzing, er wordt niets gelezen
    K._opslag = K.maakGeheugenOpslag();
    try { Object.defineProperty(root, 'localStorage', { configurable: true, get() { return K._opslag; } }); } catch (e) { }
    try { Object.defineProperty(root, 'indexedDB', { configurable: true, get() { return undefined; } }); } catch (e) { }
  };
  // MSAL moet zijn tokencache in de ECHTE opslag houden (anders is de login weg bij elke herlaad). v2.html roept dit rond de ene synchrone
  // `new msal.PublicClientApplication(…)` aan: MSAL pakt window.localStorage bij het aanmaken en bewaart die verwijzing; daarna is het weer de lege opslag.
  K.msalBegin = function () { if (K._opslag && K._echt) { try { Object.defineProperty(root, 'localStorage', { configurable: true, get() { return K._echt; } }); } catch (e) { } } };
  K.msalEinde = function () { if (K._opslag) { try { Object.defineProperty(root, 'localStorage', { configurable: true, get() { return K._opslag; } }); } catch (e) { } } };

  // ── Vroege detectie: een gast in de MSAL-cache ──────────────────────────────────────────────────────────────────────────────────
  // MSAL bewaart accounts als localStorage-sleutel "<id>-login.microsoftonline.com-<tenant>" met o.a. username. Alleen lezen.
  function gebruikersInCache() {
    const uit = [];
    try {
      const ls = root.localStorage;
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i); if (!k || k.indexOf('login.microsoftonline.com') < 0) continue;
        let v; try { v = JSON.parse(ls.getItem(k)); } catch (e) { continue; }
        if (v && typeof v.username === 'string') uit.push(v.username.toLowerCase());
      }
    } catch (e) { }
    return uit;
  }
  K.vroegKandidaat = function () {
    const g = gebruikersInCache(); if (!g.length) return false;
    let vlag = null; try { vlag = root.localStorage.getItem(VLAG); } catch (e) { }
    return g.some(u => /#ext#/.test(u)) || !!(vlag && g.includes(String(vlag).toLowerCase()));
  };

  // ── Netwerktoets ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const werkerOrigin = () => { try { return new URL(K._worker || STANDAARD_WORKER).origin; } catch (e) { return ''; } };
  K.routeMag = function (u, methode) {
    let url; try { url = new URL(String(u), root.location && root.location.href); } catch (e) { return ja(); }
    const m = String(methode || 'GET').toUpperCase(), lees = m === 'GET' || m === 'HEAD';
    if (GRAPH_HOST.test(url.hostname)) return nee('graph');
    const wo = werkerOrigin();
    if (!wo || url.origin !== wo) {
      if (lees) return ja();
      if (url.hostname === 'login.microsoftonline.com') return ja();                  // MSAL (alleen id-token: de Graph-scopes worden nooit gevraagd)
      return nee('schrijven');
    }
    const pad = url.pathname, target = url.searchParams.get('target'), wpad = url.searchParams.get('path') || '';
    if (K.modus === 'streng') return lees && pad === '/me' ? ja() : nee('streng');   // nog niet bevestigd als meekijker: alleen /me
    if (pad === '/track' || pad === '/track/heartbeat') return m === 'POST' ? ja() : nee('track');
    if (pad === '/') {                                                                // de proxy: ?target=…&path=…
      if (lees && PROXY_LEES.includes(target)) return ja();
      if (m === 'POST' && target === 'toggl_reports' && /^workspace\/\d+\/search\/time_entries$/.test(wpad)) return ja();     // Reports lezen met POST
      if (m === 'POST' && target === 'toggl_focus' && /^reports\/workspaces\/\d+\/query$/.test(wpad)) return ja();
      return nee(lees ? 'niet-voor-meekijker' : 'schrijven');
    }
    if (lees && LEES_GET.some(re => re.test(pad))) return ja();
    return nee(lees ? 'niet-voor-meekijker' : 'schrijven');
  };
  K._blok = function (u, m, reden) {
    if (K.geblokkeerd.length < 200) K.geblokkeerd.push({ url: String(u).replace(/\?.*$/, ''), methode: String(m || 'GET').toUpperCase(), reden });
    if (reden === 'schrijven') K.melding();
  };
  const blokAntwoord = reden => (typeof root.Response === 'function' ? new root.Response(JSON.stringify({ error: 'alleen-inkijken', reden }), { status: 403, headers: { 'Content-Type': 'application/json' } }) : { ok: false, status: 403, json: async () => ({ error: 'alleen-inkijken', reden }), text: async () => '' });
  // Zet X-MT-Kijk op elk verzoek naar de worker (een oude client stuurt die header niet; de worker weigert hem dan voor een meekijker).
  function metKijkHeader(input, init) {
    const u = typeof input === 'string' ? input : (input && input.url) || String(input);
    let url; try { url = new URL(String(u), root.location && root.location.href); } catch (e) { return init; }
    if (url.origin !== werkerOrigin()) return init;
    const oud = (init && init.headers) || (input && typeof input === 'object' && input.headers) || {};
    let h;
    if (typeof root.Headers === 'function') { h = new root.Headers(oud); h.set('X-MT-Kijk', VERSIE); }
    else h = Object.assign({}, oud, { 'X-MT-Kijk': VERSIE });
    return Object.assign({}, init || {}, { headers: h });
  }
  K.installeerGuards = function () {
    if (K._guards) return; K._guards = true;
    if (typeof root.fetch === 'function') {
      const orig = root.fetch.bind(root);
      root.fetch = function (input, init) {
        const u = typeof input === 'string' ? input : (input && input.url) || String(input), m = (init && init.method) || (input && input.method) || 'GET';
        const r = K.routeMag(u, m); if (!r.ok) { K._blok(u, m, r.reden); return Promise.resolve(blokAntwoord(r.reden)); }
        return orig(input, metKijkHeader(input, init));
      };
    }
    try {
      const XHR = root.XMLHttpRequest && root.XMLHttpRequest.prototype;
      if (XHR && XHR.open) { const o = XHR.open; XHR.open = function (m, u) { const r = K.routeMag(u, m); if (!r.ok) { K._blok(u, m, r.reden); throw new Error('alleen-inkijken'); } return o.apply(this, arguments); }; }
    } catch (e) { }
    try {
      const n = root.navigator; if (n && typeof n.sendBeacon === 'function') { const b = n.sendBeacon.bind(n); n.sendBeacon = function (u, d) { const r = K.routeMag(u, 'POST'); if (!r.ok) { K._blok(u, 'POST', r.reden); return false; } return b(u, d); }; }
    } catch (e) { }
  };

  // ── Graph dicht ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // Na MTCore.installAuth. Een #EXT#-gast of bevestigde meekijker krijgt nooit een Graph-token (en dus nooit een popup of toestemmingsvraag);
  // voor de rest wacht de eerste aanvraag kort op /me (zodat een meekijker niet vóór de rol bekend is een token probeert te halen).
  K.bewaakGraph = function () {
    if (K._graphBewaakt || typeof root.getGraphToken !== 'function') return; K._graphBewaakt = true;
    const orig = root.getGraphToken;
    root.getGraphToken = async function () {
      if (K.graphDicht()) return null;
      if (K._rolWacht) { try { await K._rolWacht; } catch (e) { } if (K.graphDicht()) return null; }
      return orig.apply(this, arguments);
    };
  };

  // ── Neutraal laadscherm en melding "geen toegang" ───────────────────────────────────────────────────────────────────────────────
  K.laadScherm = function (tekst) {
    if (!doc) return;
    if (tekst) K._laadTekst = tekst;                                                  // een later (uitgestelde) tekenronde mag een melding niet terugzetten naar "Laden…"
    const maak = () => {
      if (K.modus === 'kijk') return;                                                   // al bevestigd: geen laadscherm meer terugzetten
      let el = doc.getElementById('mt-kijk-laden');
      if (!el) { el = doc.createElement('div'); el.id = 'mt-kijk-laden'; el.setAttribute('role', 'status'); (doc.body || doc.documentElement).appendChild(el); }
      el.textContent = K._laadTekst || 'Laden…';
    };
    if (doc.body) maak(); else doc.addEventListener('DOMContentLoaded', maak);
  };
  K.klaarMetLaden = function () {
    if (!doc) return;
    doc.documentElement.removeAttribute('data-kijk-laden');
    const el = doc.getElementById('mt-kijk-laden'); if (el && el.parentNode) el.parentNode.removeChild(el);
  };
  // /me bevestigde GEEN meekijker (of is onbereikbaar): alles blijft dicht en de app blijft verborgen.
  K.weiger = function (me) {
    K.modus = 'streng'; K.installeerGuards();
    if (doc) { stijl(); doc.documentElement.setAttribute('data-kijk-laden', '1'); }
    const reden = me && me.reden;
    const tekst = !me ? 'Kon je account niet controleren. Herlaad de pagina; lukt dat niet, neem dan contact op met de eigenaar.'
      : me.error === 'client-te-oud' ? 'Deze versie van de tool is verouderd. Herlaad de pagina met Ctrl+F5.'
      : reden === 'verlopen' ? 'Je toegang is verlopen. Neem contact op met de eigenaar als je langer wilt meekijken.'
      : reden === 'wacht-op-goedkeuring' ? 'Je bent uitgenodigd. De eigenaar moet je toegang nog goedkeuren; daarna kun je opnieuw inloggen.'
      : 'Je account heeft geen toegang tot deze tool. Neem contact op met de eigenaar.';
    K.laadScherm(tekst);
  };
  K.startStreng = function () {
    K._vroeg = true; K.modus = 'streng'; K._worker = K._worker || STANDAARD_WORKER;
    try { root.sessionStorage.removeItem(HERSTART); } catch (e) { }
    K.installeerOpslag(); K.installeerGuards();
    if (doc) { stijl(); doc.documentElement.setAttribute('data-kijk-laden', '1'); K.laadScherm(); }
  };
  // De pagina is zonder vroege kijkmodus geladen terwijl dit een meekijker blijkt te zijn: onthoud het en laad één keer opnieuw, zodat de volgende
  // keer de lege opslag er al is vóór de app-scripts. → true als er opnieuw geladen wordt.
  K.herstart = function (account) {
    try {
      if (root.sessionStorage.getItem(HERSTART)) return false;
      root.sessionStorage.setItem(HERSTART, '1');
      root.localStorage.setItem(VLAG, String((account && account.username) || '').toLowerCase());
      root.location.reload(); return true;
    } catch (e) { return false; }
  };

  // ── Start: wie ben ik? (vóór de eerste SharePoint-lees) ─────────────────────────────────────────────────────────────────────────
  // /me ophalen zonder iets vast te leggen (voor het team verandert er niets); null bij geen token of een fout.
  K.vraagMe = async function (worker) {
    const h = await root.authHeader(); if (!h || !h['X-Auth-Token']) return null;
    const r = await root.fetch(String(worker || K._worker).replace(/\/+$/, '') + '/me', { headers: Object.assign({}, h, { 'X-MT-Kijk': VERSIE }) });
    return r.ok ? await r.json() : (r.status === 403 ? await r.json().catch(() => null) : null);
  };
  K.isMeekijker = async function (worker) {
    try { const me = await Promise.race([K.vraagMe(worker), new Promise(r => root.setTimeout(() => r(null), 3000))]); return !!(me && me.rol === 'meekijker'); } catch (e) { return false; }
  };
  K.voorStart = function (account, worker) {
    K._worker = worker || K._worker;
    const gast = K.extern(account);
    if (gast) K.installeerGuards();                                                    // gast: al het schrijfverkeer en Graph direct dicht, ook als /me traag is
    if (gast && !K._vroeg && K.herstart(account)) return new Promise(() => { });       // opnieuw laden met de vroege kijkmodus; de app mag hier niet verder
    const taak = (async () => {
      try {
        // Alleen kijken wie je bent: voor het team verandert er niets (de gewone rolLaad volgt later); pas bij een meekijker wordt de rol vastgelegd.
        const me = await K.vraagMe(K._worker);
        if (me && me.rol === 'meekijker' && me.altijdAfdwingen) {
          if (!K._vroeg && K.herstart(account)) return new Promise(() => { });
          K.activeer(me); if (root.MTRol) await root.MTRol.laad(K._worker);
        } else if (K._vroeg || gast) K.weiger(me);                                        // gast zonder bevestigde meekijker-rol: alles dicht
      } catch (e) { if (K._vroeg || gast) K.weiger(null); }
    })();
    const grens = new Promise(r => root.setTimeout(r, K._vroeg || gast ? 15000 : 3000)); // /me traag of stuk: het team werkt dan als vroeger, een gast blijft buiten
    K._rolWacht = Promise.race([taak, grens.then(() => { if ((K._vroeg || gast) && !K.aan) K.weiger(null); })]);
    return K._rolWacht;
  };
  // ── Spiegel als bron ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const winkel = f => String(f || '').replace(/\.json$/, '');
  K.haalSpiegel = async function (bestand) {
    const store = winkel(bestand);
    if (!STORES.includes(store)) return { ok: false, status: 0, data: null, reden: 'niet-beschikbaar' };         // geen laag 1: niet voor de coach
    try {
      const r = await root.fetchMetAuth(K._worker.replace(/\/+$/, '') + '/spiegel/' + encodeURIComponent(store));
      if (r.status === 404) return { ok: false, status: 404, data: null, reden: 'nog-geen-gegevens' };
      if (!r.ok) return { ok: false, status: r.status, data: null, reden: 'http-' + r.status };
      const j = await r.json();
      if (!j || typeof j !== 'object' || !j.data || typeof j.data !== 'object') return { ok: false, status: 0, data: null, reden: 'onleesbaar' };
      let data = j.data;
      if (TOESLAG.includes(store)) { const w = Number(data.waarde); if (data.waarde === null || data.waarde === '' || !Number.isFinite(w)) return { ok: false, status: 0, data: null, reden: 'onleesbaar' }; data = w; }   // de app leest hier een los getal
      K.standen[store] = Number(j.ts) || 0;
      return { ok: true, status: 200, data, ts: Number(j.ts) || 0 };
    } catch (e) { return { ok: false, status: 0, data: null, reden: 'netwerk' }; }
  };
  // Voor modules die zelf hun gegevens ophalen (calculatie): de spiegel-inhoud of null (nog geen gegevens / niet beschikbaar).
  K.leesSpiegel = async function (store) { const r = await K.haalSpiegel(store); if (r.ok) K.banner(); return r.ok ? r.data : null; };
  K.koppelSP = function (sp, opt) {
    K._sp = sp; if (opt && opt.worker) K._worker = opt.worker;
    if (K.aan) patchSP();
  };
  function patchSP() {
    const sp = K._sp; if (!sp || sp._kijk) return; sp._kijk = true;
    sp._driveBase = async () => { throw new Error('alleen-inkijken (geen SharePoint voor een meekijker)'); };
    sp.read = async function (bestand) {
      const r = await K.haalSpiegel(bestand);
      if (!r.ok) throw new Error('Spiegel: ' + (r.reden || 'niet beschikbaar') + ' (' + winkel(bestand) + ')');   // nooit als "leeg" lezen: dan blokkeert de app die sleutel
      K.banner(); return r.data;
    };
    sp.prefetch = async function (bestanden) {
      const uit = new Map();
      await Promise.all((bestanden || []).map(async f => { const r = await K.haalSpiegel(f); uit.set(f, r.ok ? { ok: true, status: 200, data: r.data } : { ok: false, status: r.status || 0, data: null, error: r.reden }); }));
      K.banner(); return uit;
    };
    const dicht = async () => { K.melding(); return false; };
    sp.write = dicht; sp.maakAan = dicht; sp._resolveConflict = dicht;
    sp.schedule = function () { /* auto-sync bestaat niet in kijkmodus */ };
    sp.ready = true;
  }

  // ── Scherm ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const tijdTekst = ts => { try { return new Date(ts).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  K.stand = function () {
    const waarden = Object.entries(K.standen).filter(([, t]) => t > 0);
    const kern = KERN.filter(s => K.standen[s] > 0);
    return { oudste: waarden.length ? Math.min(...waarden.map(x => x[1])) : null, nieuwste: waarden.length ? Math.max(...waarden.map(x => x[1])) : null, geenKern: kern.length === 0 };
  };
  K.banner = function () {
    if (!doc || !K.aan) return;
    let el = doc.getElementById('mt-kijk-banner');
    if (!el) { el = doc.createElement('div'); el.id = 'mt-kijk-banner'; el.setAttribute('role', 'status'); if (doc.body) doc.body.insertBefore(el, doc.body.firstChild); else return; }
    const s = K.stand();
    el.textContent = 'Meekijken · alleen inkijken · ' + (s.geenKern ? 'nog geen gegevens (het team vult ze bij het eerstvolgende gebruik)' : 'stand van ' + tijdTekst(s.oudste)) + ' · contactgegevens en notities zijn verborgen';
    el.title = Object.entries(K.standen).map(([n, t]) => n + ': ' + tijdTekst(t)).join('\n');
  };
  K.melding = function (tekst) {
    if (!doc || !doc.body) return; const nu = Date.now(); if (nu - K._geopend < 3000) return; K._geopend = nu;
    let el = doc.getElementById('mt-kijk-toast');
    if (!el) { el = doc.createElement('div'); el.id = 'mt-kijk-toast'; el.setAttribute('role', 'status'); doc.body.appendChild(el); }
    el.textContent = tekst || 'Alleen inkijken — wijzigen kan niet met deze toegang.'; el.style.opacity = '1';
    root.setTimeout(() => { el.style.opacity = '0'; }, 3000);
  };
  function stijl() {
    if (!doc || doc.getElementById('mt-kijk-stijl')) return;
    const s = doc.createElement('style'); s.id = 'mt-kijk-stijl';
    s.textContent = 'html[data-kijk] [data-schrijf]{display:none!important}'
      + 'html[data-kijk-laden] body>*:not(#mt-kijk-laden){visibility:hidden!important}html[data-kijk-laden] body{overflow:hidden}'
      + '#mt-kijk-laden{position:fixed;inset:0;z-index:20000;background:#F4F7F6;color:#1d2b27;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font:15px/1.5 system-ui,sans-serif}'
      + '#mt-kijk-banner{background:#1F5C36;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:6px 14px;text-align:center}'
      + '#mt-kijk-toast{position:fixed;left:50%;bottom:48px;transform:translateX(-50%);background:#1d2b27;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:8px 16px;border-radius:8px;z-index:10001;opacity:0;transition:opacity .2s;pointer-events:none}';
    (doc.head || doc.documentElement).appendChild(s);
  }
  // Alleen wijzigen als het nog niet zo staat (de MutationObserver hieronder kijkt naar stijl/klasse: geen eindeloze lus).
  function verberg(b) { if (b.style.display !== 'none') b.style.display = 'none'; if (!b.classList.contains('mt-rol-verborgen')) b.classList.add('mt-rol-verborgen'); }
  K.pasToe = function () {
    if (!doc || !K.aan) return;
    doc.documentElement.setAttribute('data-kijk', '1');
    doc.querySelectorAll('.tabs-wrap .tab-btn').forEach(b => {
      const m = /showTab\('([^']+)'/.exec(b.getAttribute('onclick') || '');
      if (m && VERBORGEN_TABS.includes(m[1])) verberg(b);
    });
    doc.querySelectorAll('.tab-help-btn').forEach(b => { if (/helpOpen/.test(b.getAttribute('onclick') || '')) verberg(b); });
    K.banner();
    try { root.updateSyncStatus = K.syncBadge; K.syncBadge(); } catch (e) { }
  };
  K.syncBadge = function () {
    if (!doc || !doc.body) return;
    let el = doc.getElementById('spSyncBadge');
    if (!el) { el = doc.createElement('div'); el.id = 'spSyncBadge'; el.style.cssText = 'position:fixed;bottom:10px;right:12px;z-index:9999;font:11px/1.4 system-ui,sans-serif;padding:4px 9px;border-radius:9px;opacity:.85;user-select:none;box-shadow:0 1px 4px rgba(0,0,0,.25)'; doc.body.appendChild(el); }
    el.textContent = 'Alleen inkijken'; el.style.background = '#e5e7eb'; el.style.color = '#374151'; el.title = 'Je kijkt mee; er wordt niets opgeslagen.';
  };
  // Vangnet op knoppen en formulieren (default dicht voor wat op naam wijzigt); de gegevenslaag hierboven is de echte garantie.
  function klikToets(e) {
    if (!K.aan) return;
    const el = e.target && e.target.closest ? e.target.closest('[onclick],[data-schrijf],button,a') : null;
    if (!el || el.closest('[data-kijk-ok]')) return;
    const h = (el.getAttribute('onclick') || '') + ' ' + (el.getAttribute('data-schrijf') != null ? 'schrijf' : '');
    if (SCHRIJF_RE.test(h) && !SCHRIJF_OK_RE.test(h) && !el.classList.contains('tab-btn')) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); K.melding(); }
  }
  function submitToets(e) { if (!K.aan) return; const t = e.target; if (t && t.closest && t.closest('[data-kijk-ok]')) return; e.preventDefault(); e.stopPropagation(); K.melding(); }
  K.klikToets = klikToets;

  // ── Activeren ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  K.activeer = function (me) {
    if (K.aan) return;
    K.aan = true; K.modus = 'kijk'; K.me = me || null;
    K.installeerOpslag();                                                              // normaal al vroeg gedaan; hier het vangnet voor een late activering
    K.installeerGuards();
    if (K._sp) patchSP();
    // De calculatie heeft een eigen SharePoint-sync (MTCalcOpslag): in kijkmodus staat die uit; de calculatie leest alleen uit de spiegel (hydrateCalc).
    try { if (root._calcSync && typeof root._calcSync.schrijf === 'function') root._calcSync.schrijf = async () => ({ ok: false, dicht: true, reden: 'alleen-inkijken' }); root._calcAutoSync = function () { }; } catch (e) { }
    if (doc) {
      stijl();
      doc.documentElement.setAttribute('data-kijk', '1');
      K.klaarMetLaden();
      doc.addEventListener('click', klikToets, true);
      doc.addEventListener('submit', submitToets, true);
      doc.addEventListener('DOMContentLoaded', () => K.pasToe());
      if (root.addEventListener) root.addEventListener('mt-rol', () => K.pasToe());
      const balk = doc.querySelector('.tabs-wrap');
      if (balk && root.MutationObserver) {                                             // andere code die een verborgen tab terugzet: weer dicht
        let plan = 0; new root.MutationObserver(() => { if (plan) return; plan = root.setTimeout(() => { plan = 0; K.pasToe(); }, 200); }).observe(balk, { attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
      }
      K.pasToe();
    }
  };
  root.MTKijk = K;
  // Vroege start (alleen v2.html: <script data-kijk="v2">): een gast in de MSAL-cache of een eerder bevestigde meekijker begint streng, vóór de app-scripts.
  if (pagina === 'v2') { try { if (K.vroegKandidaat()) K.startStreng(); } catch (e) { } }
})(typeof window !== 'undefined' ? window : globalThis);
