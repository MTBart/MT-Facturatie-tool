/* ============================================================================
 * mt-kijk.js — kijkmodus voor de rol "meekijker" (externe coach): alles inzien, niets wijzigen, nooit SharePoint/Graph
 * ----------------------------------------------------------------------------
 * De worker dwingt de rol af (dat is de echte poort); dit bestand maakt de browser eromheen "dicht by default":
 *   1. Graph: getGraphToken geeft voor een meekijker (en voor elke #EXT#-gast) altijd null — nooit een token, nooit een popup.
 *   2. Data: _SP.read/prefetch lezen uit /spiegel (de kopie die het team vult); _SP.write/maakAan/merge doen niets ("alleen inkijken").
 *   3. Netwerk: elke fetch/XHR/sendBeacon gaat door een toets (routeMag). Toegestaan: GET naar de leesroutes van de worker, de Reports-
 *      POST's (lezen), /track voor het kijkoverzicht, en de MSAL-login. Graph/SharePoint/Office-hosts en alle andere schrijfverzoeken
 *      worden in de browser geweigerd (synthetische 403) — de worker weigert ze daarna nog eens.
 *   4. Scherm: tabs die niet voor de coach zijn verdwijnen, een banner "Meekijken · stand van …", schrijf-knoppen (op naam van hun
 *      handler) en formulieren worden geblokkeerd met een nette melding. MTRol.mag() toetst voor deze rol altijd echt (modus afdwingen).
 * Volgorde (v2.html): installAuth → MTKijk.bewaakGraph() · _SP gemaakt → MTKijk.koppelSP(_SP) · toonApp → await MTKijk.voorStart(account).
 * ========================================================================== */
(function (root) {
  'use strict';
  const doc = root.document;
  // Zelfde lijst als SPIEGEL_STORES in worker.js (alleen laag 1).
  const STORES = ['mt_projecten', 'mt_planning', 'mt_planblokken', 'mt_planinrichting', 'mt_project_taken_v2', 'mt_project_afhank', 'mt_project_controle', 'mt_project_sjablonen',
    'mt_klant_codes', 'klanten-registry-vol', 'mt_verlof', 'mt_vrijedagen', 'mt_opleveringen', 'mt_attentie', 'mt_calc_offertes', 'mt_calc_defaults', 'mt_offerte_keuze',
    'mt_toeslag_lak', 'mt_toeslag_spuit', 'mt_uurtarieven', 'mt_verbeterpunten', 'mt_feedback'];
  const KERN = ['mt_projecten', 'mt_planning', 'mt_project_taken_v2'];                // zonder deze is er "nog geen gegevens"
  const VERBORGEN_TABS = ['dashboard', 'inbox', 'attentie', 'oplevering', 'voorraad', 'bestelling', 'klanten', 'instellingen', 'admin'];
  const GRAPH_HOST = /(^|\.)(graph\.microsoft\.com|sharepoint\.com|sharepoint-df\.com|onedrive\.live\.com|1drv\.ms|office\.com|office365\.com|outlook\.com)$/i;
  const LEES_GET = [/^\/me$/, /^\/klanten$/, /^\/instellingen$/, /^\/teller\/(status|werkcodes|binding)$/, /^\/signalen$/, /^\/zoek\/moneybird$/, /^\/geld\//, /^\/spiegel(\/|$)/];
  const PROXY_LEES = ['toggl', 'toggl_focus', 'toggl_admin_projects', 'moneybird'];     // GET; de worker toetst het pad nog eens
  // Handlers die wijzigen (op naam). Alleen een vangnet bovenop de gegevenslaag; data-kijk-ok op een element zet de toets uit.
  const SCHRIJF_RE = /(save|opslaan|bewaar|verwijder|delete|remove|wissen|toevoeg|nieuw|aanmaken|create|maak|boek|verstuur|send|archiv|bewerk|edit|wijzig|import|upload|koppel|afvink|markeer|overzetten|genereer|timer|dupli|verplaats|inplan|toewijs|plak|accepteer|goedkeur|afwijs)/i;

  // Handlers die toevallig een schrijfwoord bevatten maar alleen iets sluiten/openen (gecontroleerd tegen alle inline onclick's in v2.html en mt-*.js).
  const SCHRIJF_OK_RE = /^\s*(MTKoppelUI\.sluit|tbOpenInNieuwVenster|updNieuwToon)\b/;

  const K = { aan: false, STORES, standen: {}, geblokkeerd: [], _sp: null, _worker: '', _rolWacht: null, _guards: false, _geopend: 0 };

  const nee = reden => ({ ok: false, reden }), ja = () => ({ ok: true });
  K.extern = account => /#ext#/i.test(String((account && account.username) || ''));
  const huidigeAccount = () => { try { const a = root._msal && root._msal.getAllAccounts(); return a && a[0] || null; } catch (e) { return null; } };
  K.graphDicht = () => K.aan || K.extern(huidigeAccount());

  // ── Netwerktoets ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  K.routeMag = function (u, methode) {
    let url; try { url = new URL(String(u), root.location && root.location.href); } catch (e) { return ja(); }
    const m = String(methode || 'GET').toUpperCase(), lees = m === 'GET' || m === 'HEAD';
    if (GRAPH_HOST.test(url.hostname)) return nee('graph');
    let werkerOrigin = ''; try { werkerOrigin = K._worker ? new URL(K._worker).origin : ''; } catch (e) { }
    if (!werkerOrigin || url.origin !== werkerOrigin) {
      if (lees) return ja();
      if (url.hostname === 'login.microsoftonline.com') return ja();                  // MSAL (alleen id-token: de Graph-scopes worden nooit gevraagd)
      return nee('schrijven');
    }
    const pad = url.pathname, target = url.searchParams.get('target'), wpad = url.searchParams.get('path') || '';
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
  K.installeerGuards = function () {
    if (K._guards) return; K._guards = true;
    if (typeof root.fetch === 'function') {
      const orig = root.fetch.bind(root);
      root.fetch = function (input, init) {
        const u = typeof input === 'string' ? input : (input && input.url) || String(input), m = (init && init.method) || (input && input.method) || 'GET';
        const r = K.routeMag(u, m); if (!r.ok) { K._blok(u, m, r.reden); return Promise.resolve(blokAntwoord(r.reden)); }
        return orig(input, init);
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

  // ── Start: wie ben ik? (vóór de eerste SharePoint-lees) ─────────────────────────────────────────────────────────────────────────
  // /me ophalen zonder iets vast te leggen (voor het team verandert er niets); null bij geen token of een fout.
  K.vraagMe = async function (worker) {
    const h = await root.authHeader(); if (!h || !h['X-Auth-Token']) return null;
    const r = await root.fetch(String(worker || K._worker).replace(/\/+$/, '') + '/me', { headers: h });
    return r.ok ? await r.json() : null;
  };
  K.isMeekijker = async function (worker) {
    try { const me = await Promise.race([K.vraagMe(worker), new Promise(r => root.setTimeout(() => r(null), 3000))]); return !!(me && me.rol === 'meekijker'); } catch (e) { return false; }
  };
  K.voorStart = function (account, worker) {
    K._worker = worker || K._worker;
    if (K.extern(account)) K.installeerGuards();                                       // gast: al het schrijfverkeer en Graph direct dicht, ook als /me traag is
    const taak = (async () => {
      try {
        // Alleen kijken wie je bent: voor het team verandert er niets (de gewone rolLaad volgt later); pas bij een meekijker wordt de rol vastgelegd.
        const me = await K.vraagMe(K._worker);
        if (me && me.rol === 'meekijker') { K.activeer(me); if (root.MTRol) await root.MTRol.laad(K._worker); }
      } catch (e) { }
    })();
    const grens = new Promise(r => root.setTimeout(r, 3000));                          // /me traag of stuk: niet eeuwig wachten (team werkt dan als vroeger)
    K._rolWacht = Promise.race([taak, grens]);
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
      K.standen[store] = Number(j.ts) || 0;
      return { ok: true, status: 200, data: j.data, ts: Number(j.ts) || 0 };
    } catch (e) { return { ok: false, status: 0, data: null, reden: 'netwerk' }; }
  };
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
    el.textContent = 'Meekijken · alleen inkijken · ' + (s.geenKern ? 'nog geen gegevens (het team vult ze bij het eerstvolgende gebruik)' : 'stand van ' + tijdTekst(s.oudste));
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
    K.aan = true; K.me = me || null;
    K.installeerGuards();
    if (K._sp) patchSP();
    if (doc) {
      stijl();
      doc.documentElement.setAttribute('data-kijk', '1');
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
})(typeof window !== 'undefined' ? window : globalThis);
