/* track.js — lichtgewicht usage-/presence-tracking voor de M&T-cockpit.
 *
 * Ontwerpprincipes (hard):
 *  - Faalt ALTIJD stil. Tracking mag de tool nooit ophouden, blokkeren of breken.
 *  - Data-minimalisme: functienamen + ID's + status. GEEN klant-PII, GEEN
 *    factuurinhoud, GEEN vrije tekst van de gebruiker in 'detail'.
 *  - Batcht events en flush't periodiek (8s) of bij N events, plus op pagehide
 *    via sendBeacon zodat de laatste events niet verloren gaan.
 *  - Server (Worker) bepaalt de definitieve 'user' uit het MSAL-token; de client
 *    stuurt 'm alleen als hint. De client kan dus niet als iemand anders loggen.
 *
 * Publieke API:
 *  track(event, action, {detail, ok, ms})   — log één event
 *  trackError(action, detail)               — log een gevangen fout (ok=false)
 *  trackHeartbeat(tab)                       — presence-ping (ook auto elke 30s)
 *
 * Afhankelijkheden uit v2.html (optioneel, alles defensief):
 *  window.WORKER         — Worker base-URL
 *  window.getAuthToken() — MSAL id-token (async)
 *  window._msal          — MSAL-instance (voor user-hint)
 *  window.APP_VERSION    — commit/versie-string
 */
(function () {
  'use strict';

  var WORKER = (typeof window.WORKER === 'string') ? window.WORKER : '';
  var FLUSH_MS = 8000;        // periodieke flush
  var FLUSH_N = 20;           // of zodra de buffer dit aantal bereikt
  var HEARTBEAT_MS = 30000;   // presence-ping interval
  var MAX_DETAIL = 180;       // detail-veld afkappen

  // Sessie-id per page-load. Sessieduur = max(ts)-min(ts) server-side.
  var SESSION_ID = 's_' + Date.now().toString(36) + '_' +
    Math.random().toString(36).slice(2, 8);

  var buffer = [];
  var lastTab = '?';
  var started = false;

  function appVersion() {
    return (typeof window.APP_VERSION === 'string') ? window.APP_VERSION : 'onbekend';
  }

  // User-hint uit MSAL (server overschrijft dit met het gevalideerde token).
  function userHint() {
    try {
      var a = window._msal && window._msal.getAllAccounts();
      return (a && a[0] && a[0].username || '').toLowerCase();
    } catch (e) { return ''; }
  }

  async function authHeaders() {
    var h = { 'Content-Type': 'application/json' };
    try {
      if (typeof window.getAuthToken === 'function') {
        var t = await window.getAuthToken();
        if (t) h['X-Auth-Token'] = t;
      }
    } catch (e) { /* stil */ }
    return h;
  }

  function clip(v) {
    if (v == null) return undefined;
    var s = String(v);
    return s.length > MAX_DETAIL ? s.slice(0, MAX_DETAIL) : s;
  }

  // ── Publiek: één event loggen ────────────────────────────────────────────────
  function track(event, action, opts) {
    try {
      opts = opts || {};
      buffer.push({
        sessionId: SESSION_ID,
        user: userHint(),
        event: event || 'onbekend',
        action: action || null,
        detail: clip(opts.detail),
        ok: (typeof opts.ok === 'boolean') ? opts.ok : undefined,
        ms: (opts.ms == null || isNaN(opts.ms)) ? undefined : Math.round(opts.ms),
        appVersion: appVersion(),
        ts: Date.now()
      });
      if (buffer.length >= FLUSH_N) flush();
    } catch (e) { /* tracking faalt nooit hardop */ }
  }

  function trackError(action, detail) {
    track('error', action || 'js_error', { detail: detail, ok: false });
  }

  // ── Flush naar /track ────────────────────────────────────────────────────────
  async function flush() {
    if (!buffer.length || !WORKER) return;
    var batch = buffer.splice(0, buffer.length);
    try {
      var h = await authHeaders();
      await fetch(WORKER + '/track', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ events: batch, appVersion: appVersion() }),
        keepalive: true
      });
    } catch (e) {
      // Netwerk weg → events terug in de buffer (begrensd, géén oneindige groei).
      if (buffer.length < 500) buffer = batch.concat(buffer);
    }
  }

  // sendBeacon-flush bij pagehide (overleeft een tab-sluiting).
  function beaconFlush() {
    try {
      if (!buffer.length || !WORKER || !navigator.sendBeacon) { flush(); return; }
      var batch = buffer.splice(0, buffer.length);
      // Beacon kan geen custom headers; user-hint zit in de payload, server
      // valt terug op de hint als er geen token meekomt. Geen PII in payload.
      var blob = new Blob(
        [JSON.stringify({ events: batch, appVersion: appVersion() })],
        { type: 'application/json' }
      );
      navigator.sendBeacon(WORKER + '/track', blob);
    } catch (e) { /* stil */ }
  }

  // ── Presence-heartbeat ───────────────────────────────────────────────────────
  async function trackHeartbeat(tab) {
    if (tab) lastTab = tab;
    if (!WORKER) return;
    try {
      var h = await authHeaders();
      await fetch(WORKER + '/track/heartbeat', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ sessionId: SESSION_ID, tab: lastTab, user: userHint() }),
        keepalive: true
      });
    } catch (e) { /* stil */ }
  }

  // ── Auto-instrumentatie die generiek is (errors + lifecycle) ─────────────────
  function start() {
    if (started) return;
    started = true;

    // Gevangen JS-errors → usability-frictie zichtbaar maken.
    window.addEventListener('error', function (ev) {
      try {
        var where = (ev.filename || '').split('/').pop() + ':' + (ev.lineno || '?');
        trackError('window_error', (ev.message || 'error') + ' @' + where);
      } catch (e) {}
    });
    window.addEventListener('unhandledrejection', function (ev) {
      try {
        var msg = (ev.reason && (ev.reason.message || ev.reason)) || 'rejection';
        trackError('unhandled_rejection', String(msg));
      } catch (e) {}
    });

    // Periodieke flush + heartbeat.
    setInterval(flush, FLUSH_MS);
    setInterval(function () { trackHeartbeat(); }, HEARTBEAT_MS);

    // Tab/venster naar achtergrond → flush + heartbeat (presence + geen verlies).
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { beaconFlush(); }
      else { trackHeartbeat(); }
    });
    window.addEventListener('pagehide', beaconFlush);

    // Sessie-start markeren + eerste heartbeat.
    track('session', 'start', { detail: 'load' });
    trackHeartbeat('dashboard');
    flush();
  }

  // Expose
  window.track = track;
  window.trackError = trackError;
  window.trackHeartbeat = trackHeartbeat;
  window.trackSessionId = function () { return SESSION_ID; };
  window._trackFlush = flush;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
