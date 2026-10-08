const TENANT_ID = '15b652c3-ff53-433f-a29d-e9626cbafb41';
const CLIENT_ID = 'a091db96-24ed-4b64-8b9d-7c55bc86cfdb';
const JWKS_URL = `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`;
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;   // v2-ID-token van onze tenant
const KLOK_MARGE_S = 300;                                                // speling voor nbf (klokverschil)
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Usage-/presence-tracking: de admin-leesroutes (/track/online, /track/usage) zijn
// voor rollen met beheerrecht (F1: Eigenaar/Beheerder). Schrijfroutes: iedereen
// die is ingelogd (in modus 'afdwingen': iedereen met een rol).

let jwksCache = null;
let jwksCacheTime = 0;
let jwksVerversTijd = 0;

// JWKS 1 uur cachen; onbekende kid → hooguit eens per 5 min opnieuw ophalen (sleutelrotatie).
async function getJwks(verversen) {
  if (jwksCache && !verversen && (Date.now() - jwksCacheTime) < 3600000) return jwksCache;
  if (verversen && jwksCache && Date.now() - jwksVerversTijd < 300000) return jwksCache;
  if (verversen) jwksVerversTijd = Date.now();
  // Mislukte/rare respons → oude cache houden (niet een uur lang een lege sleutellijst).
  try {
    const resp = await fetch(JWKS_URL);
    const keys = resp.ok ? (await resp.json()).keys : null;
    if (Array.isArray(keys) && keys.length) { jwksCache = keys; jwksCacheTime = Date.now(); }
  } catch {}
  return jwksCache || [];
}

function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '==='.slice((b64.length + 3) % 4);
  return Uint8Array.from(atob(pad), c => c.charCodeAt(0));
}

// Valideert het MSAL-ID-token streng (F1a) → {payload} of {fout: reden}.
// Handtekening (RS256, kid uit JWKS), exp, nbf (met klokmarge), tid, iss (v2 van
// onze tenant), aud (onze app) en een oid (vaste gebruikers-id voor de rol).
async function checkToken(token, nu = Date.now()) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return { fout: 'vorm' };
    const header  = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    if (header.alg !== 'RS256' || !header.kid) return { fout: 'alg' };
    const sec = Math.floor(nu / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= sec) return { fout: 'verlopen' };
    if (typeof payload.nbf === 'number' && payload.nbf > sec + KLOK_MARGE_S) return { fout: 'nbf' };
    if (payload.tid !== TENANT_ID) return { fout: 'tid' };
    if (payload.iss !== ISSUER) return { fout: 'iss' };
    if (payload.aud !== CLIENT_ID) return { fout: 'aud' };
    if (!GUID_RE.test(String(payload.oid || ''))) return { fout: 'oid' };
    let jwk = (await getJwks()).find(k => k.kid === header.kid);
    if (!jwk) jwk = (await getJwks(true)).find(k => k.kid === header.kid);
    if (!jwk || jwk.kty !== 'RSA' || (jwk.use && jwk.use !== 'sig')) return { fout: 'kid' };
    const cryptoKey = await crypto.subtle.importKey(
      'jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, b64urlDecode(parts[2]), data);
    return ok ? { payload } : { fout: 'handtekening' };
  } catch(e) {
    return { fout: 'ongeldig' };
  }
}
// Compat: payload of null. De payload is ook nodig voor per-user token-mapping (e-mailclaim → secret).
async function validateToken(token) {
  const r = await checkToken(token);
  return r.payload || null;
}

// F1: per-user Toggl-token. E-mail uit het MSAL-token → Worker-secret
// `<prefix>_<NAAM>` (bv. TOGGL_KEY_ARJAN voor arjan@mortiseandtenon.nl).
// Geen persoonlijk secret gezet → fallback naar het gedeelde secret. toggl_reports blijft bewust op het
// admin-token (aggregeert over alle workspace-gebruikers).
function userKey(env, prefix, fallback, payload) {
  const email = (payload && (payload.preferred_username || payload.upn || payload.email)) || '';
  const name = email.split('@')[0].replace(/[^a-z0-9]/gi, '').toUpperCase();
  return (name && env[`${prefix}_${name}`]) || fallback;
}

// E-mail uit het MSAL-token (lowercased). Leeg bij server-key/geen login.
function tokenEmail(payload) {
  return ((payload && (payload.preferred_username || payload.upn || payload.email)) || '').toLowerCase();
}

// Kapt een string af zodat payloads klein blijven (data-minimalisme).
function clip(v, n) {
  if (v == null) return null;
  const s = String(v);
  return s.length > n ? s.slice(0, n) : s;
}

// ── Tracking-routes ───────────────────────────────────────────────────────────
// Pad-gebaseerd (/track, /track/heartbeat, /track/online, /track/usage) i.t.t. de
// ?target=-routes hierboven. Het MSAL-token is al gevalideerd vóór dit punt.
// Schrijfroutes: alle ingelogde gebruikers. Leesroutes: rollen met beheerrecht (isAdmin).
// Faalt nooit hard op ontbrekende bindings — tracking mag de tool niet ophouden.
async function handleTrack(pathname, request, env, msPayload, cors, isAdmin) {
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...cors }
  });
  const email = tokenEmail(msPayload);

  // POST /track — batch events wegschrijven naar D1.
  if (pathname === '/track' && request.method === 'POST') {
    if (!env.TRACK_DB) return json({ ok: false, skipped: 'no-d1' });
    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: 'bad-json' }, 400); }
    const events = Array.isArray(payload?.events) ? payload.events : [];
    if (!events.length) return json({ ok: true, written: 0 });
    const recv = Date.now();
    // Server bepaalt de user (uit het token) — client mag dit niet vervalsen.
    const user = email || clip(payload.user, 120) || 'onbekend';
    const ua = clip(request.headers.get('User-Agent') || '', 200);
    const stmt = env.TRACK_DB.prepare(
      `INSERT INTO events (ts, recv_ts, session_id, user, event, action, detail, ok, ms, app_version, ua)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    );
    const batch = events.slice(0, 200).map(e => stmt.bind(
      Number(e.ts) || recv,
      recv,
      clip(e.sessionId, 80) || 'geen-sessie',
      user,
      clip(e.event, 40) || 'onbekend',
      clip(e.action, 80),
      clip(e.detail, 200),
      e.ok === true ? 1 : (e.ok === false ? 0 : null),
      (e.ms == null || isNaN(e.ms)) ? null : Math.round(Number(e.ms)),
      clip(e.appVersion || payload.appVersion, 60),
      ua
    ));
    try { await env.TRACK_DB.batch(batch); return json({ ok: true, written: batch.length }); }
    catch (err) { return json({ ok: false, error: clip(err.message, 200) }, 500); }
  }

  // POST /track/heartbeat — presence in KV met TTL.
  if (pathname === '/track/heartbeat' && request.method === 'POST') {
    if (!env.TRACK_KV) return json({ ok: false, skipped: 'no-kv' });
    let body = {};
    try { body = await request.json(); } catch {}
    const user = email || clip(body.user, 120) || 'onbekend';
    const value = JSON.stringify({
      tab: clip(body.tab, 40) || '?',
      sessionId: clip(body.sessionId, 80) || '?',
      at: Date.now(),
      ua: clip(request.headers.get('User-Agent') || '', 120)
    });
    try { await env.TRACK_KV.put(`presence:${user}`, value, { expirationTtl: 90 }); }
    catch (err) { return json({ ok: false, error: clip(err.message, 200) }, 500); }
    return json({ ok: true });
  }

  // GET /track/online — wie is nu online (KV-scan). Admin-only.
  if (pathname === '/track/online' && request.method === 'GET') {
    if (!isAdmin) return json({ error: 'admin-only' }, 403);
    if (!env.TRACK_KV) return json({ online: [], skipped: 'no-kv' });
    const list = await env.TRACK_KV.list({ prefix: 'presence:' });
    const online = [];
    for (const k of list.keys) {
      const v = await env.TRACK_KV.get(k.name);
      if (!v) continue;
      try {
        const d = JSON.parse(v);
        online.push({ user: k.name.slice('presence:'.length), tab: d.tab, sinds: d.at });
      } catch {}
    }
    return json({ online });
  }

  // GET /track/usage?range=today|7d|30d — aggregaties uit D1. Admin-only.
  if (pathname === '/track/usage' && request.method === 'GET') {
    if (!isAdmin) return json({ error: 'admin-only' }, 403);
    if (!env.TRACK_DB) return json({ skipped: 'no-d1' });
    const url = new URL(request.url);
    const range = url.searchParams.get('range') || '7d';
    const now = Date.now();
    const since = range === 'today'
      ? new Date(new Date().setHours(0, 0, 0, 0)).getTime()
      : range === '30d' ? now - 30 * 864e5 : now - 7 * 864e5;
    const db = env.TRACK_DB;
    const q = (sql, ...b) => db.prepare(sql).bind(...b).all();
    try {
      const [perFunctie, perUser, perDag, sessies, mislukt, totaal] = await Promise.all([
        // Gebruik per functie (action), met mislukt-percentage.
        q(`SELECT event, action,
                  COUNT(*) AS n,
                  SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) AS fout,
                  CAST(AVG(ms) AS INT) AS gem_ms
             FROM events WHERE ts>=? AND action IS NOT NULL
            GROUP BY event, action ORDER BY n DESC LIMIT 100`, since),
        // Gebruik per gebruiker.
        q(`SELECT user, COUNT(*) AS n, COUNT(DISTINCT session_id) AS sessies
             FROM events WHERE ts>=? GROUP BY user ORDER BY n DESC`, since),
        // Events per dag.
        q(`SELECT date(ts/1000,'unixepoch','localtime') AS dag, COUNT(*) AS n,
                  COUNT(DISTINCT user) AS users, COUNT(DISTINCT session_id) AS sessies
             FROM events WHERE ts>=? GROUP BY dag ORDER BY dag`, since),
        // Sessies + gem. sessieduur (laatste-eerste event per sessie).
        q(`SELECT COUNT(*) AS aantal, CAST(AVG(duur) AS INT) AS gem_duur_ms FROM (
              SELECT session_id, MAX(ts)-MIN(ts) AS duur
                FROM events WHERE ts>=? GROUP BY session_id
           )`, since),
        // Top mislukte/afgebroken acties = de usability-hotspots.
        q(`SELECT event, action, detail, COUNT(*) AS n
             FROM events WHERE ts>=? AND (ok=0 OR event='error')
            GROUP BY event, action, detail ORDER BY n DESC LIMIT 25`, since),
        q(`SELECT COUNT(*) AS n FROM events WHERE ts>=?`, since)
      ]);
      return json({
        range, since,
        perFunctie: perFunctie.results,
        perUser: perUser.results,
        perDag: perDag.results,
        sessies: sessies.results?.[0] || { aantal: 0, gem_duur_ms: 0 },
        mislukt: mislukt.results,
        totaal: totaal.results?.[0]?.n || 0
      });
    } catch (err) { return json({ error: clip(err.message, 200) }, 500); }
  }

  return json({ error: 'unknown-track-route' }, 404);
}

// ── Moneybird admin-ID (hardcoded; zit ook in v2.html als ADMIN_DEFAULT) ──
const MB_ADMIN = '342968480452052559';

// ── Dashboard-routes ───────────────────────────────────────────────────────────
// Pad-gebaseerd: /dashboard/cashflow, /dashboard/vrij-te-besteden,
// /dashboard/btw-pot, /dashboard/te-factureren, /dashboard/onderhanden,
// /dashboard/config, /dashboard/anker, /dashboard/doelen.
// Auth = MSAL-token (alle ingelogde gebruikers). Geen server-key-toegang
// (dashboarddata is persoonlijk/financieel; vereist echte user-context).
// KV-caching: financiële aggregaten 1 uur (key 'dash:...<user>'), config geen TTL.
async function handleDashboard(pathname, request, env, msPayload, cors) {
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...cors }
  });
  if (!msPayload) return json({ error: 'MSAL-login vereist' }, 401);

  const email = tokenEmail(msPayload);
  const MB_AUTH = { 'Authorization': `Bearer ${env.MONEYBIRD_KEY}`, 'Content-Type': 'application/json' };
  const TTL_1H = 3600; // seconden

  // ── Hulpfunctie: haal MB-lijst op met paginering (per_page=100) ──────────────
  async function mbList(endpoint) {
    const results = [];
    let page = 1;
    while (true) {
      const sep = endpoint.includes('?') ? '&' : '?';
      const resp = await fetch(
        `https://moneybird.com/api/v2/${MB_ADMIN}/${endpoint}${sep}per_page=100&page=${page}`,
        { headers: MB_AUTH }
      );
      if (!resp.ok) break;
      const data = await resp.json();
      if (!Array.isArray(data) || data.length === 0) break;
      results.push(...data);
      if (data.length < 100) break;
      page++;
    }
    return results;
  }

  // ── Hulpfunctie: mutations voor 1 bankrekeningperiode ophalen (max 14d per call) ──
  async function mbMutations(bankId, vanDate, tmDate) {
    // Splits periode in blokken van max 12 dagen (veiligheidsmarges voor MB-400).
    const MS_DAY = 86400000;
    const results = [];
    let cur = new Date(vanDate + 'T00:00:00Z');
    const end = new Date(tmDate + 'T00:00:00Z');
    while (cur <= end) {
      const blokEind = new Date(Math.min(cur.getTime() + 11 * MS_DAY, end.getTime()));
      const van = cur.toISOString().slice(0, 10).replace(/-/g, '');
      const tm  = blokEind.toISOString().slice(0, 10).replace(/-/g, '');
      const resp = await fetch(
        `https://moneybird.com/api/v2/${MB_ADMIN}/financial_mutations?filter=financial_account_id:${bankId},period:${van}..${tm}&per_page=100`,
        { headers: MB_AUTH }
      );
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data)) results.push(...data);
      }
      cur = new Date(blokEind.getTime() + MS_DAY);
    }
    return results;
  }

  // ── KV helpers ────────────────────────────────────────────────────────────────
  async function kvGet(key) {
    if (!env.TRACK_KV) return null;
    try { const v = await env.TRACK_KV.get(key); return v ? JSON.parse(v) : null; } catch { return null; }
  }
  async function kvPut(key, val, ttl) {
    if (!env.TRACK_KV) return;
    const opts = ttl ? { expirationTtl: ttl } : {};
    try { await env.TRACK_KV.put(key, JSON.stringify(val), opts); } catch {}
  }

  // ── GET /dashboard/config ─────────────────────────────────────────────────────
  if (pathname === '/dashboard/config' && request.method === 'GET') {
    const vasten  = await kvGet('cfg:vaste-lasten');
    const anker   = await kvGet('cfg:anker-saldo');
    const doelen  = await kvGet(`cfg:doelen:${email}`) || await kvGet('cfg:doelen:default');
    const uurtarief = await kvGet('cfg:uurtarief') || { bedrag: 95 };
    return json({ vasten, anker, doelen, uurtarief });
  }

  // ── POST /dashboard/anker ─────────────────────────────────────────────────────
  if (pathname === '/dashboard/anker' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad-json' }, 400); }
    const { bedrag, datum } = body || {};
    if (typeof bedrag !== 'number' || !datum) return json({ error: 'bedrag (number) en datum (YYYY-MM-DD) zijn verplicht' }, 400);
    await kvPut('cfg:anker-saldo', { bedrag, datum, opgeslagen_door: email, opgeslagen_op: new Date().toISOString() });
    return json({ ok: true });
  }

  // ── POST /dashboard/doelen ────────────────────────────────────────────────────
  if (pathname === '/dashboard/doelen' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad-json' }, 400); }
    const { salaris, buffer: buf } = body || {};
    await kvPut(`cfg:doelen:${email}`, { salaris: salaris || 0, buffer: buf || 0, opgeslagen_op: new Date().toISOString() });
    return json({ ok: true });
  }

  // ── GET /dashboard/vrij-te-besteden ──────────────────────────────────────────
  if (pathname === '/dashboard/vrij-te-besteden' && request.method === 'GET') {
    const cacheKey = `dash:vrij:${email}`;
    const cached = await kvGet(cacheKey);
    if (cached) return json({ ...cached, cached: true });

    const [anker, vasten, inkoopFacturen] = await Promise.all([
      kvGet('cfg:anker-saldo'),
      kvGet('cfg:vaste-lasten'),
      mbList('documents/purchase_invoices?filter=state:open|late')
    ]);

    // Huidig saldo = anker + mutaties t/m gisteren
    const gisteren = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let saldoHuidig = anker?.bedrag || 0;
    if (anker?.datum && anker.datum <= gisteren) {
      const mutaties = await mbMutations('343544076091524743', anker.datum, gisteren);
      const delta = mutaties.reduce((s, m) => s + parseFloat(m.amount || 0), 0);
      saldoHuidig = (anker.bedrag || 0) + delta;
    }

    // Resterende vaste lasten deze maand
    const nu = new Date();
    const dagVandaag = nu.getDate();
    const vastenActief = (vasten?.actief || []).filter(v => v.actief !== false);
    let vasteResterend = 0;
    vastenActief.forEach(v => {
      if (v.cadans === 'maandelijks' && (v.dag_van_maand || 28) >= dagVandaag) {
        vasteResterend += v.bedrag || 0;
      }
      if (v.cadans === 'jaarlijks') {
        // Alleen als de dag-van-maand nog komt in de resterende maanden t/m 31 dec
        const jaarDag = new Date(nu.getFullYear(), nu.getMonth(), v.dag_van_maand || 1);
        if (jaarDag >= nu) vasteResterend += v.bedrag || 0;
      }
    });

    // Openstaande inkoop
    const inkoopOpen = (Array.isArray(inkoopFacturen) ? inkoopFacturen : [])
      .reduce((s, f) => s + parseFloat(f.total_unpaid || 0), 0);

    const vrij = saldoHuidig - vasteResterend - inkoopOpen;
    const result = { vrij, saldo_huidig: saldoHuidig, vaste_resterend: vasteResterend, inkoop_open: inkoopOpen, anker_datum: anker?.datum || null };
    await kvPut(cacheKey, result, TTL_1H);
    return json(result);
  }

  // ── GET /dashboard/btw-pot ────────────────────────────────────────────────────
  if (pathname === '/dashboard/btw-pot' && request.method === 'GET') {
    const cacheKey = `dash:btw:${email}`;
    const cached = await kvGet(cacheKey);
    if (cached) return json({ ...cached, cached: true });

    const [salesFacturen, offertes] = await Promise.all([
      mbList('sales_invoices?filter=state:open|late'),
      mbList('estimates?filter=state:accepted|open|late')
    ]);

    function taxSum(items) {
      return (Array.isArray(items) ? items : []).reduce((s, item) => {
        const btw = (item.tax_totals || []).reduce((t, x) => t + parseFloat(x.tax_amount || 0), 0);
        return s + btw;
      }, 0);
    }

    const hard = taxSum(salesFacturen);
    const verwacht = taxSum(offertes);
    const result = { hard, verwacht, totaal: hard + verwacht };
    await kvPut(cacheKey, result, TTL_1H);
    return json(result);
  }

  // ── GET /dashboard/te-factureren ─────────────────────────────────────────────
  if (pathname === '/dashboard/te-factureren' && request.method === 'GET') {
    const cacheKey = `dash:tefact:${email}`;
    const cached = await kvGet(cacheKey);
    if (cached) return json({ items: cached, cached: true });

    const [offertes, salesFacturen] = await Promise.all([
      mbList('estimates?filter=state:accepted'),
      mbList('sales_invoices?filter=state:open|late|paid')
    ]);

    // Heuristiek: offerte is al gefactureerd als er een salesfactuur bestaat
    // voor hetzelfde contact met een bedrag dat op ≤10% afwijkt.
    const gefactureerdeContacten = new Map();
    (Array.isArray(salesFacturen) ? salesFacturen : []).forEach(sf => {
      const cid = sf.contact_id;
      if (!gefactureerdeContacten.has(cid)) gefactureerdeContacten.set(cid, []);
      gefactureerdeContacten.get(cid).push(parseFloat(sf.total_price_incl_tax || 0));
    });

    const nu = Date.now();
    const items = (Array.isArray(offertes) ? offertes : [])
      .filter(o => {
        const bedrag = parseFloat(o.total_price_incl_tax || 0);
        const sfBedragen = gefactureerdeContacten.get(o.contact_id) || [];
        // Beschouw als niet-gefactureerd als er geen SF is met vergelijkbaar bedrag
        const alGefactureerd = sfBedragen.some(b => Math.abs(b - bedrag) / Math.max(bedrag, 1) < 0.10);
        return !alGefactureerd;
      })
      .map(o => ({
        offerte_id: o.id,
        contact: o.contact?.company_name || o.contact?.firstname || '?',
        bedrag_excl: parseFloat(o.total_price_excl_tax || 0),
        bedrag_incl: parseFloat(o.total_price_incl_tax || 0),
        days_since_accepted: o.updated_at ? Math.floor((nu - new Date(o.updated_at).getTime()) / 86400000) : null,
        due_date: o.due_date || null
      }))
      .sort((a, b) => (b.days_since_accepted || 0) - (a.days_since_accepted || 0));

    await kvPut(cacheKey, items, TTL_1H);
    return json({ items });
  }

  // ── GET /dashboard/onderhanden ────────────────────────────────────────────────
  if (pathname === '/dashboard/onderhanden' && request.method === 'GET') {
    const cacheKey = `dash:onderhanden:${email}`;
    const cached = await kvGet(cacheKey);
    if (cached) return json({ items: cached, cached: true });

    // Toggl Reports API: uren van afgelopen 90 dagen, alle gebruikers, via admin-key.
    const uurtarief = (await kvGet('cfg:uurtarief'))?.bedrag || 95;
    const tot = new Date().toISOString().slice(0, 10);
    const van = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const WS = 21258443;

    let togglItems = [];
    try {
      const token = btoa(`${env.TOGGL_KEY}:api_token`);
      const resp = await fetch(
        `https://api.track.toggl.com/reports/api/v3/workspace/${WS}/summary/time_entries`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${token}` },
          body: JSON.stringify({ start_date: van, end_date: tot, grouping: 'projects', sub_grouping: 'time_entries' })
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        togglItems = (data.groups || []).map(g => ({
          project: g.title?.project || 'Geen project',
          seconden: g.seconds || 0,
          uren: Math.round((g.seconds || 0) / 36) / 100,
          geschat_bedrag: Math.round((g.seconds || 0) / 3600 * uurtarief * 100) / 100
        })).filter(i => i.seconden > 0).sort((a, b) => b.seconden - a.seconden).slice(0, 20);
      }
    } catch {}

    await kvPut(cacheKey, togglItems, TTL_1H);
    return json({ items: togglItems });
  }

  // ── GET /dashboard/cashflow?horizon=90d|kwartaal|jaar ─────────────────────────
  if (pathname === '/dashboard/cashflow' && request.method === 'GET') {
    const url2 = new URL(request.url);
    const horizon = ['90d', 'kwartaal', 'jaar'].includes(url2.searchParams.get('horizon')) ? url2.searchParams.get('horizon') : '90d';   // vaste waarden: geen eindeloze cachesleutels
    const cacheKey = `dash:cf:${email}:${horizon}`;
    const cached = await kvGet(cacheKey);
    if (cached) return json({ ...cached, cached: true });

    const [anker, vasten, doelen, salesFacturen, offertes, inkoopFacturen] = await Promise.all([
      kvGet('cfg:anker-saldo'),
      kvGet('cfg:vaste-lasten'),
      kvGet(`cfg:doelen:${email}`) || kvGet('cfg:doelen:default'),
      mbList('sales_invoices?filter=state:open|late'),
      mbList('estimates?filter=state:accepted|open|late'),
      mbList('documents/purchase_invoices?filter=state:open|late')
    ]);

    // Huidig saldo berekenen
    const vandaag = new Date(); vandaag.setHours(0,0,0,0);
    const vandaagStr = vandaag.toISOString().slice(0,10);
    let saldoAanker = anker?.bedrag || 0;
    if (anker?.datum && anker.datum < vandaagStr) {
      const mutaties = await mbMutations('343544076091524743', anker.datum, vandaagStr);
      const delta = mutaties.reduce((s,m) => s + parseFloat(m.amount||0), 0);
      saldoAanker += delta;
    }

    // Bepaal horizon
    let horizonDagen = 90;
    if (horizon === 'kwartaal') horizonDagen = 90;
    else if (horizon === 'jaar') horizonDagen = 365;
    else horizonDagen = 90;

    // Bepaal bucket-grootte: 90d = dag, kwartaal = week, jaar = week
    const bucketDagen = horizon === '90d' ? 1 : 7;

    // Helpers
    const MS_DAY = 86400000;
    function dateStr(ms) { return new Date(ms).toISOString().slice(0,10); }
    function addDays(d, n) { return d + n * MS_DAY; }
    function bucketIndex(ms) { return Math.floor((ms - vandaag.getTime()) / (bucketDagen * MS_DAY)); }

    const nBuckets = Math.ceil(horizonDagen / bucketDagen);
    const buckets = Array.from({ length: nBuckets }, (_, i) => ({
      datum: dateStr(addDays(vandaag.getTime(), i * bucketDagen)),
      saldo_verwacht: 0,
      in_hard: 0,
      in_verwacht: 0,
      uit_vast: 0,
      uit_inkoop: 0,
      btw_pot_hard: 0,
      btw_pot_verwacht: 0
    }));

    // IN hard: openstaande verkoopfacturen op due_date
    (Array.isArray(salesFacturen) ? salesFacturen : []).forEach(sf => {
      const dueMs = sf.due_date ? new Date(sf.due_date).getTime() : vandaag.getTime() + 30 * MS_DAY;
      const idx = bucketIndex(dueMs);
      if (idx >= 0 && idx < nBuckets) {
        const bedrag = parseFloat(sf.total_unpaid || 0);
        const btw = (sf.tax_totals || []).reduce((t, x) => t + parseFloat(x.tax_amount || 0), 0);
        buckets[idx].in_hard += bedrag;
        buckets[idx].btw_pot_hard += btw;
      }
    });

    // IN verwacht: geaccepteerde/openstaande/late offertes
    (Array.isArray(offertes) ? offertes : []).forEach(o => {
      const dueMs = o.due_date ? new Date(o.due_date).getTime() : vandaag.getTime() + 45 * MS_DAY;
      const idx = bucketIndex(dueMs);
      if (idx >= 0 && idx < nBuckets) {
        const bedrag = parseFloat(o.total_price_incl_tax || 0);
        const btw = (o.tax_totals || []).reduce((t, x) => t + parseFloat(x.tax_amount || 0), 0);
        buckets[idx].in_verwacht += bedrag;
        buckets[idx].btw_pot_verwacht += btw;
      }
    });

    // UIT inkoop: openstaande inkoopfacturen op due_date
    (Array.isArray(inkoopFacturen) ? inkoopFacturen : []).forEach(pf => {
      const dueMs = pf.due_date ? new Date(pf.due_date).getTime() : vandaag.getTime() + 30 * MS_DAY;
      const idx = bucketIndex(dueMs);
      if (idx >= 0 && idx < nBuckets) {
        buckets[idx].uit_inkoop += parseFloat(pf.total_unpaid || 0);
      }
    });

    // UIT vast: vaste lasten verdelen over hun dag_van_maand
    const vastenActief = (vasten?.actief || []).filter(v => v.actief !== false);
    for (let i = 0; i < nBuckets; i++) {
      const bucketStart = new Date(addDays(vandaag.getTime(), i * bucketDagen));
      vastenActief.forEach(v => {
        const dag = v.dag_van_maand || 1;
        // Controleer of de incassodag in dit bucket valt
        for (let d = 0; d < bucketDagen; d++) {
          const check = new Date(addDays(bucketStart.getTime(), d));
          if (check.getDate() !== dag) continue;
          // Maandelijks: elke maand
          if (v.cadans === 'maandelijks') { buckets[i].uit_vast += v.bedrag || 0; }
          // Jaarlijks: alleen als maand klopt (dag_van_maand + de oorspronkelijke maand — we nemen een benadering: 1x per jaar op die dag)
          if (v.cadans === 'jaarlijks') {
            // Voeg toe als de dag van deze check overeen komt
            buckets[i].uit_vast += v.bedrag || 0;
          }
        }
      });
    }

    // Saldo rolling berekenen (start bij huidig saldo, projecteer forward)
    let lopendSaldo = saldoAanker;
    buckets.forEach(b => {
      lopendSaldo += b.in_hard - b.uit_vast - b.uit_inkoop;
      b.saldo_verwacht = Math.round(lopendSaldo * 100) / 100;
      b.in_hard = Math.round(b.in_hard * 100) / 100;
      b.in_verwacht = Math.round(b.in_verwacht * 100) / 100;
      b.uit_vast = Math.round(b.uit_vast * 100) / 100;
      b.uit_inkoop = Math.round(b.uit_inkoop * 100) / 100;
      b.btw_pot_hard = Math.round(b.btw_pot_hard * 100) / 100;
      b.btw_pot_verwacht = Math.round(b.btw_pot_verwacht * 100) / 100;
    });

    const doelLijn = ((doelen?.salaris || 0) + (doelen?.buffer || 0));
    const result = {
      horizon,
      bucket_dagen: bucketDagen,
      saldo_aanvang: Math.round(saldoAanker * 100) / 100,
      doel_lijn: doelLijn,
      anker_datum: anker?.datum || null,
      buckets
    };
    await kvPut(cacheKey, result, TTL_1H);
    return json(result);
  }

  return json({ error: 'unknown-dashboard-route' }, 404);
}

// ══ ROLLEN (F1a/F1b) ═════════════════════════════════════════════════════════
// Rol per Entra-gebruiker (oid) in KV `MT_ROLLEN`; de worker dwingt af per target.
// Modus (worker-var ROLLEN_MODUS): 'uit' | 'log' (standaard: alles door, wel loggen
// wat geweigerd zóu worden) | 'afdwingen'. /beheer/* en de admin-leesroutes van
// /track zijn in élke modus beperkt (die waren al beperkt of zijn nieuw).
// KV-schema:
//   user:{oid}     {oid, role, active, email, naam, createdBy, createdAt, updatedAt, lastSeen}
//   invite:{email} {email, role, naam, createdBy, createdAt, verloopt}   (TTL 30 dagen)
//   aanvraag:{oid} {oid, email, naam, bericht, ts}                       (TTL 30 dagen)
//   audit:{omgekeerde ts}:{rand}  één wijziging, nieuwste eerst          (TTL 400 dagen)
//   stat:{yyyy-mm-dd}  teller "zou geweigerd zijn" (log-modus)           (TTL 35 dagen)
// Vaste eigenaren (worker-secrets, komma-lijsten; enkelvoud blijft werken):
//   OWNER_OIDS (+ OWNER_OID)     → altijd Eigenaar, via de API niet te wijzigen/deactiveren.
//   OWNER_EMAILS (+ OWNER_EMAIL) → idem voor wie z'n oid nog niet bekend is: geverifieerde
//     token-e-mail (zelfde tenant) → Eigenaar; bij eerste login user:{oid} met bron 'owner_email'
//     (alleen lezen + idempotente put, geen race). Beheer toont de oid om naar OWNER_OIDS te verplaatsen.
// Gewone eigenaren (via Beheer) zijn wél te wijzigen, maar nooit de laatste Eigenaar.
const ROLLEN = ['eigenaar', 'beheerder', 'kantoor', 'werkplaats', 'lezen', 'administratie'];
const ROL_NAAM = { eigenaar: 'Eigenaar', beheerder: 'Beheerder', kantoor: 'Kantoor', werkplaats: 'Werkplaats', lezen: 'Alleen lezen', administratie: 'Administratie' };
// De matrix (ontwerp F1 + besluiten Bart 7-10). Ook naar de front-end via /me (alleen UI-gemak; de worker beslist).
//   taken: 'status-nieuw' = taakstatus wijzigen + nieuwe taak/opdracht aanmaken (niet hernoemen/verwijderen/toewijzen)
//   bestellijst/opmerkingen: lopen via SharePoint → alleen UI (niet afdwingbaar in de worker)
//   mb_verwijderen: Moneybird-inkoopfacturen (en hun bijlagen/notities) verwijderen
//   geld: geldtijdlijn en financieel dashboard (/geld/*, /dashboard/*) — in élke modus afgedwongen;
//         administratie (extern): alleen geld en Moneybird bekijken
const RECHTEN = {
  eigenaar:   { projecten: 'wijzigen', taken: 'alles',        bestellijst: 'alles',     opmerkingen: 'alles',     inbox: 'alles',     offertes: 'wijzigen', moneybird: 'concepten', mb_verwijderen: 'ja', uren: 'alles',       verbeterpunten: 'alles',   ai: 'ja',      beheer: 'alles', geld: 'wijzigen' },
  beheerder:  { projecten: 'wijzigen', taken: 'alles',        bestellijst: 'alles',     opmerkingen: 'alles',     inbox: 'alles',     offertes: 'wijzigen', moneybird: 'concepten', mb_verwijderen: null, uren: 'alles',       verbeterpunten: 'alles',   ai: 'ja',      beheer: 'beheren', geld: null },
  kantoor:    { projecten: 'wijzigen', taken: 'alles',        bestellijst: 'alles',     opmerkingen: 'alles',     inbox: 'verwerken', offertes: 'wijzigen', moneybird: 'concepten', mb_verwijderen: null, uren: 'team',        verbeterpunten: 'beheren', ai: 'ja',      beheer: null, geld: null },
  werkplaats: { projecten: 'lezen',    taken: 'status-nieuw', bestellijst: 'toevoegen', opmerkingen: 'toevoegen', inbox: null,        offertes: null,       moneybird: null,        mb_verwijderen: null, uren: 'eigen',       verbeterpunten: 'maken',   ai: 'beperkt', beheer: null, geld: null },
  administratie: { projecten: null, taken: null, bestellijst: null, opmerkingen: null, inbox: null, offertes: null, moneybird: 'lezen', mb_verwijderen: null, uren: null, verbeterpunten: null, ai: null, beheer: null, geld: 'lezen' },
  lezen:      { projecten: 'lezen',    taken: null,           bestellijst: null,        opmerkingen: null,        inbox: null,        offertes: 'lezen',    moneybird: 'lezen',     mb_verwijderen: null, uren: 'eigen-lezen', verbeterpunten: 'lezen',   ai: null,      beheer: null, geld: null },
};
const ROLLEN_MODI = ['uit', 'log', 'afdwingen'];
const AI_BEPERKT_MAX_TOKENS = 1024;      // werkplaats: AI "beperkt"
const LOG_FLUSH_MS = 5 * 60 * 1000;      // teller hooguit eens per 5 min naar KV (KV-schrijflimiet)
const LASTSEEN_MS = 60 * 60 * 1000;      // "laatst gezien" hooguit eens per uur
const CACHE_MS = 60 * 1000;              // gebruikersrecord per isolate 60 s in geheugen
const DAG_S = 86400;

function rollenModus(env) {
  const m = String((env && env.ROLLEN_MODUS) || 'log').trim().toLowerCase();
  return ROLLEN_MODI.includes(m) ? m : 'log';
}
async function kvJson(env, key) {
  if (!env.MT_ROLLEN) return null;
  try { const v = await env.MT_ROLLEN.get(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
async function kvZet(env, key, val, opts) {
  if (!env.MT_ROLLEN) return;
  await env.MT_ROLLEN.put(key, JSON.stringify(val), opts || {});
}
// Korte, niet-omkeerbare oid-hash voor logregels (geen PII in de logs).
async function oidHash(oid) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mt-rol:' + String(oid || '')));
  return [...new Uint8Array(d)].slice(0, 5).map(b => b.toString(16).padStart(2, '0')).join('');
}
function randHex(n) { return [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join(''); }
// Append-only audit: elke wijziging een eigen sleutel (nooit overschrijven), nieuwste eerst bij list().
async function audit(env, e) {
  if (!env.MT_ROLLEN) return;
  const ts = Date.now();
  const key = `audit:${String(9e15 - ts).padStart(16, '0')}:${randHex(4)}`;
  try { await kvZet(env, key, { ts, ...e }, { expirationTtl: 400 * DAG_S }); } catch {}
}

const lijstVar = v => String(v || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
function ownerOids(env) { return new Set([...lijstVar(env.OWNER_OIDS), ...lijstVar(env.OWNER_OID)]); }
function ownerEmails(env) { return new Set([...lijstVar(env.OWNER_EMAILS), ...lijstVar(env.OWNER_EMAIL)]); }
// 'oid' | 'email' | null — is deze gebruiker een vaste eigenaar (uit de worker-secrets)?
function vasteEigenaar(env, oid, email) {
  if (oid && ownerOids(env).has(String(oid).toLowerCase())) return 'oid';
  if (email && ownerEmails(env).has(String(email).toLowerCase())) return 'email';
  return null;
}

const _gebruikerCache = new Map();   // oid -> {rec, t}
async function leesGebruiker(env, oid) {
  const c = _gebruikerCache.get(oid);
  if (c && Date.now() - c.t < CACHE_MS) return c.rec;
  const rec = await kvJson(env, 'user:' + oid);
  _gebruikerCache.set(oid, { rec, t: Date.now() });
  return rec;
}
async function schrijfGebruiker(env, rec) {
  await kvZet(env, 'user:' + rec.oid, rec);
  _gebruikerCache.set(rec.oid, { rec, t: Date.now() });
}
function nieuweGebruiker(oid, role, email, naam, door) {
  const nu = Date.now();
  return { oid, role, active: true, email: email || '', naam: clip(naam, 80) || email || '', createdBy: door || '', createdAt: nu, updatedAt: nu, lastSeen: nu };
}
const waitUntil = (ctx, p) => { try { if (ctx && ctx.waitUntil) ctx.waitUntil(p); else p.catch(() => {}); } catch {} };

// Rol van de ingelogde gebruiker → {rol, rec, reden}. Koppelt bij eerste login een
// uitnodiging (invite:{email}) of een vaste eigenaar via e-mail (OWNER_EMAILS) aan de oid.
async function bepaalRol(env, payload, ctx) {
  const oid = payload.oid, email = tokenEmail(payload), naam = payload.name || '';
  let rec = await leesGebruiker(env, oid);
  if (rec && Date.now() - (rec.lastSeen || 0) > LASTSEEN_MS) {
    rec = { ...rec, lastSeen: Date.now() };
    waitUntil(ctx, schrijfGebruiker(env, rec).catch(() => {}));
  }
  const vast = vasteEigenaar(env, oid, email);
  if (vast) {
    // Record vastleggen/bijwerken (idempotent); bij 'email' is dit hoe we de oid leren.
    const bron = vast === 'oid' ? 'owner_oid' : 'owner_email';
    if (env.MT_ROLLEN && (!rec || rec.role !== 'eigenaar' || rec.active === false || rec.bron !== bron)) {
      const nieuw = !rec;
      rec = { ...(rec || nieuweGebruiker(oid, 'eigenaar', email, naam, bron)), role: 'eigenaar', active: true, bron, email: email || (rec && rec.email) || '', updatedAt: Date.now() };
      await schrijfGebruiker(env, rec);
      await audit(env, { actie: nieuw ? 'eigenaar-vastgelegd' : 'eigenaar-bijgewerkt', door: 'systeem', doel: oid, doelNaam: rec.naam, nieuw: 'eigenaar', bron });
    }
    return { rol: 'eigenaar', rec, vast };
  }
  if (rec) {
    if (rec.active === false) return { rol: null, rec, reden: 'gedeactiveerd' };
    return ROLLEN.includes(rec.role) ? { rol: rec.role, rec } : { rol: null, rec, reden: 'onbekende-rol' };
  }
  if (!env.MT_ROLLEN) return { rol: null, rec: null, reden: 'geen-rollen-opslag' };
  const inv = email ? await kvJson(env, 'invite:' + email) : null;
  if (inv && ROLLEN.includes(inv.role) && (!inv.verloopt || inv.verloopt > Date.now())) {
    rec = nieuweGebruiker(oid, inv.role, email, inv.naam || naam, inv.createdBy);
    await schrijfGebruiker(env, rec);
    try { await env.MT_ROLLEN.delete('invite:' + email); } catch {}
    try { await env.MT_ROLLEN.delete('aanvraag:' + oid); } catch {}
    await audit(env, { actie: 'uitnodiging-gekoppeld', door: inv.createdBy || 'systeem', doel: oid, doelNaam: rec.naam, nieuw: inv.role });
    return { rol: inv.role, rec };
  }
  return { rol: null, rec: null, reden: 'onbekend' };
}

// ── Matrix toegepast op worker-targets ────────────────────────────────────────
// Moneybird-"concepten": alleen wat de app echt aanmaakt (concepten/nieuwe documenten);
// versturen, betalingen, boeken, contacten wijzigen e.d. vallen erbuiten.
// Derde veld 'verwijderen' = alleen met mb_verwijderen (Eigenaar).
const MB_CONCEPT = [
  ['POST',   /^contacts$/],
  ['POST',   /^documents\/purchase_invoices$/],
  ['PATCH',  /^documents\/purchase_invoices\/\d+$/],
  ['DELETE', /^documents\/purchase_invoices\/\d+$/, 'verwijderen'],
  ['POST',   /^documents\/purchase_invoices\/\d+\/(attachments|notes)$/],
  ['DELETE', /^documents\/purchase_invoices\/\d+\/(attachments|notes)\/\d+$/, 'verwijderen'],
  ['POST',   /^sales_invoices$/],
  ['POST',   /^estimates$/],
  ['PATCH',  /^estimates\/\d+\/bill_estimate$/],
];
function mbRest(pad) {
  const m = /^(\d+)\/([^?#]*)$/.exec(String(pad || '').split(/[?#]/)[0]);
  return m && m[1] === MB_ADMIN ? m[2].replace(/\.json$/, '').replace(/\/$/, '') : null;
}
// → null (geen concept-actie) | 'concept' | 'verwijderen'
function mbConcept(methode, pad) {
  const p = mbRest(pad);
  const hit = p != null ? MB_CONCEPT.find(([m, re]) => m === methode && re.test(p)) : null;
  return hit ? (hit[2] || 'concept') : null;
}
// Toggl Focus-pad zonder organisatie/werkruimte-voorvoegsel ("tasks/9").
function focusRest(pad) {
  return String(pad || '').split(/[?#]/)[0].replace(/^\/+/, '').replace(/^organizations\/\d+\/?/, '').replace(/^workspaces\/\d+\/?/, '').replace(/\/$/, '');
}
// Toggl-pad → klasse: 'uren' (eigen tijdregistratie), 'uren-team' (rapporten over iedereen),
// 'planning' (projecten/taken/klanten/statussen/blokken), 'meta' (gebruikers, werkruimtes).
function togglKlasse(target, pad) {
  if (target === 'toggl_reports') return 'uren-team';
  if (target === 'toggl_admin_projects') return 'planning';
  let p = String(pad || '').split(/[?#]/)[0].replace(/^\/+/, '');
  if (target === 'toggl_focus') {
    if (/^reports\//.test(p)) return 'uren-team';
    p = p.replace(/^organizations\/\d+\/?/, '').replace(/^workspaces\/\d+\/?/, '');
    if (/^reports\//.test(p)) return 'uren-team';
    const s = p.split('/')[0];
    if (['time-entries', 'tracking', 'timer'].includes(s)) return 'uren';
    if (['users', 'me', 'workspaces', 'organizations', ''].includes(s)) return 'meta';
    return 'planning';
  }
  p = p.replace(/^workspaces\/\d+\/?/, '');
  if (/^me\/time_entries/.test(p) || /^time_entries/.test(p)) return 'uren';
  const s = p.split('/')[0];
  if (['me', 'workspaces', 'organizations', 'users', ''].includes(s)) return 'meta';
  return 'planning';
}
// Centrale toets: mag `rol` deze actie? → {ok, reden?, beperkt?}
// `velden` = top-level sleutels van de JSON-body (alleen nodig voor Toggl-taak-PATCH van Werkplaats).
function requirePermission(rol, target, methode, pad, velden) {
  const R = RECHTEN[rol];
  const ja = extra => ({ ok: true, ...(extra || {}) }), nee = reden => ({ ok: false, reden });
  if (!R) return nee('geen-rol');
  const m = String(methode || 'GET').toUpperCase(), lees = m === 'GET' || m === 'HEAD';
  switch (target) {
    case 'claude':
      return R.ai === 'ja' ? ja() : R.ai === 'beperkt' ? ja({ beperkt: true }) : nee('ai');
    case 'moneybird_download':
      return R.moneybird ? ja() : nee('moneybird');
    case 'moneybird':
    case 'moneybird_upload': {
      if (!R.moneybird) return nee('moneybird');
      if (target === 'moneybird' && lees) return ja();
      if (R.moneybird !== 'concepten') return nee('moneybird-schrijven');
      const soort = mbConcept(target === 'moneybird_upload' ? 'POST' : m, pad);
      if (!soort) return nee('moneybird-geen-concept');
      return soort === 'verwijderen' && R.mb_verwijderen !== 'ja' ? nee('moneybird-verwijderen-alleen-eigenaar') : ja();
    }
    case 'toggl':
    case 'toggl_focus':
    case 'toggl_reports':
    case 'toggl_admin_projects': {
      const k = togglKlasse(target, pad);
      if (k === 'uren-team') return ['alles', 'team'].includes(R.uren) ? ja() : nee('uren-team');
      if (k === 'uren') return lees ? (R.uren ? ja() : nee('uren')) : (['alles', 'team', 'eigen'].includes(R.uren) ? ja() : nee('uren-schrijven'));
      // meta (gebruikers, werkruimtes, organisatie, profiel): lezen mag, schrijven alleen met beheerrecht
      if (k === 'meta') return lees ? ja() : (R.beheer ? ja() : nee('meta-schrijven'));
      if (lees) return R.projecten ? ja() : nee('projecten');
      if (R.projecten === 'wijzigen') return ja();
      // Werkplaats: nieuwe taak/opdracht aanmaken en alléén de status van een taak wijzigen.
      if (R.taken === 'status-nieuw' && target === 'toggl_focus') {
        const p = focusRest(pad);
        if (m === 'POST' && p === 'tasks') return ja();
        if (m === 'PATCH' && /^tasks\/\d+$/.test(p) && Array.isArray(velden) && velden.length && velden.every(v => v === 'status_id')) return ja();
        return nee('taken-alleen-status-en-nieuw');
      }
      return nee('projecten-schrijven');
    }
    case 'dashboard':          // financieel dashboard (v1-cashflow): recht `geld` (ook vóór de matrix afgedwongen)
      return !R.geld ? nee('geld') : (lees || R.geld === 'wijzigen') ? ja() : nee('geld-wijzigen');
    case 'track':
      return ja();
    case 'mijn':        // eigen instellingen (Toggl koppelen) — alleen wie met uren of projecten werkt
    case 'aanwezig':    // aanwezigheidsbord (met projecten/taken) — idem; niet voor bv. administratie
      return (R.uren || R.projecten) ? ja() : nee(target === 'mijn' ? 'mijn-toggl' : 'aanwezig');
    case 'track_admin':
    case 'beheer':
      return R.beheer ? ja() : nee('beheer');
  }
  return nee('onbekend-doel');
}
// Pad-hygiëne voor de proxy-targets (in élke modus): geen ../, backslash, // of stuurtekens.
function veiligPad(pad) {
  if (pad == null || pad === '') return true;
  const p = String(pad).split(/[?#]/)[0];
  let d; try { d = decodeURIComponent(p); } catch { return false; }
  const slecht = s => /(^|[\/\\])\.{1,2}([\/\\]|$)|\\|\/\/|^\/|[\x00-\x1f]/.test(s);
  return !slecht(p) && !slecht(d);
}
// Actienaam voor log/teller zonder ids, zoektermen of vrije padsegmenten (geen PII):
// alleen het resourcetype ("POST moneybird:sales_invoices"); onbekende vorm → "?".
const ACTIE_GROEP = ['documents', 'me', 'reports', 'tracking', 'workspace'];
function actieNaam(target, methode, pad) {
  const seg = String(pad || '').split(/[?#]/)[0].split('/')
    .filter(s => s && !/^\d+$/.test(s) && !['organizations', 'workspaces', 'api', 'v2', 'v9'].includes(s));
  const ok = x => /^[a-z][a-z_-]{1,39}$/.test(x || '');
  const res = !seg.length ? '' : !ok(seg[0]) ? '?' : (ACTIE_GROEP.includes(seg[0]) && ok(seg[1]) ? seg[0] + '/' + seg[1] : seg[0]);
  const m = /^[A-Z]{3,7}$/.test(String(methode || '').toUpperCase()) ? String(methode).toUpperCase() : '?';
  return `${m} ${target}${res ? ':' + res : ''}`;
}
// 'Eigen uren' (werkplaats/lezen) is alleen echt "eigen" met een persoonlijke Toggl-sleutel
// (zelf gekoppeld of worker-secret); met de gedeelde (admin-)sleutel zou je ieders uren zien.

// ══ EIGEN TOGGL-SLEUTEL (F1e-A) ══════════════════════════════════════════════
// Iedereen koppelt zelf z'n Toggl: POST /mijn/toggl valideert live bij Toggl en bewaart de
// sleutel VERSLEUTELD (AES-GCM, worker-secret SLEUTEL_KEK = 32 bytes base64) in KV
// `sleutel:{oid}`. De sleutel gaat nooit terug naar de browser en nooit in een log.
// Additional data = "mt-sleutel:{oid}:{soort}": een versleutelde sleutel is niet naar een
// andere gebruiker of ander soort te verplaatsen.
//   sleutel:{oid} = { focus?: {iv, ct, v, naam, tgUserId, sinds, bevestigd}, track?: {iv, ct, v, naam, sinds} }
// Volgorde in togglSleutel(): 1) eigen sleutel (KV)  2) worker-secret TOGGL_*_<NAAM>  3) gedeelde sleutel.
const FOCUS_ORG = 21259253, FOCUS_WS = 21258443;
const FOCUS_API = 'https://focus.toggl.com/api/';
const TOGGL_TIMEOUT_MS = 8000;
const b64 = u8 => btoa(String.fromCharCode(...u8));
const unb64 = s => Uint8Array.from(atob(String(s || '')), c => c.charCodeAt(0));
// KEK-rotatie: nieuwe SLEUTEL_KEK zetten en de oude als SLEUTEL_KEK_VORIG; records met de oude
// sleutel worden bij het eerstvolgende gebruik herversleuteld. `kid` = korte hash van de KEK.
const _keks = new Map();   // secret-tekst -> {key, kid}
async function kekUit(tekst) {
  if (!tekst) return null;
  if (_keks.has(tekst)) return _keks.get(tekst);
  let raw; try { raw = unb64(String(tekst).trim()); } catch { return null; }
  if (raw.length !== 32) return null;
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
  const k = { key, kid: [...d.slice(0, 4)].map(b => b.toString(16).padStart(2, '0')).join('') };
  _keks.set(tekst, k);
  return k;
}
async function sleutelKek(env) { const k = await kekUit(env.SLEUTEL_KEK); return k ? k.key : null; }
const sleutelAad = (oid, soort) => new TextEncoder().encode(`mt-sleutel:${String(oid).toLowerCase()}:${soort}`);
async function versleutel(env, oid, soort, tekst) {
  const k = await kekUit(env.SLEUTEL_KEK); if (!k) throw new Error('geen-kek');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: sleutelAad(oid, soort) }, k.key, new TextEncoder().encode(tekst));
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)), v: 1, kid: k.kid };
}
// → {tekst, oud} (oud = met SLEUTEL_KEK_VORIG ontsleuteld) of null (onleesbaar)
async function ontsleutelMet(env, oid, soort, blob) {
  if (!blob || !blob.iv || !blob.ct) return null;
  for (const [tekst, oud] of [[env.SLEUTEL_KEK, false], [env.SLEUTEL_KEK_VORIG, true]]) {
    const k = await kekUit(tekst); if (!k) continue;
    if (blob.kid && blob.kid !== k.kid) continue;
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv), additionalData: sleutelAad(oid, soort) }, k.key, unb64(blob.ct));
      return { tekst: new TextDecoder().decode(pt), oud };
    } catch {}
  }
  return null;
}
async function ontsleutel(env, oid, soort, blob) { const r = await ontsleutelMet(env, oid, soort, blob); return r ? r.tekst : null; }
const _sleutelCache = new Map();   // oid -> {rec, t} (versleuteld record, 60 s)
async function leesSleutelRec(env, oid) {
  if (!oid || !env.MT_ROLLEN) return null;
  const c = _sleutelCache.get(oid);
  if (c && Date.now() - c.t < CACHE_MS) return c.rec;
  const rec = await kvJson(env, 'sleutel:' + oid);
  _sleutelCache.set(oid, { rec, t: Date.now() });
  return rec;
}
// → {sleutel, bron: 'eigen'|'secret'|'gedeeld'|'geen'}
async function togglSleutel(env, soort, payload) {
  const prefix = soort === 'focus' ? 'TOGGL_FOCUS_KEY' : 'TOGGL_KEY', gedeeld = soort === 'focus' ? env.TOGGL_FOCUS_KEY : env.TOGGL_KEY;
  try {
    const rec = await leesSleutelRec(env, payload && payload.oid);
    const r = rec && rec[soort] ? await ontsleutelMet(env, payload.oid, soort, rec[soort]) : null;
    if (r) {
      if (r.oud) {   // met de vorige KEK → meteen herversleutelen met de huidige
        try { const nieuw = { ...rec, [soort]: { ...rec[soort], ...(await versleutel(env, payload.oid, soort, r.tekst)) } }; await kvZet(env, 'sleutel:' + payload.oid, nieuw); _sleutelCache.set(payload.oid, { rec: nieuw, t: Date.now() }); } catch {}
      }
      return { sleutel: r.tekst, bron: 'eigen' };
    }
  } catch {}
  const sec = userKey(env, prefix, null, payload);
  if (sec) return { sleutel: sec, bron: 'secret' };
  return gedeeld ? { sleutel: gedeeld, bron: 'gedeeld' } : { sleutel: null, bron: 'geen' };
}
async function togglFetch(url, init) {
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), TOGGL_TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: ac.signal }); } finally { clearTimeout(tm); }
}
const SLEUTEL_RE = /^[\x21-\x7e]{16,512}$/;
const _pogingen = new Map();   // oid -> [ts…] (koppelpogingen, in geheugen)
// Max 10 koppelpogingen per uur per gebruiker: in geheugen én in KV (geldt dan over isolates heen).
async function teVaakGeprobeerd(env, oid) {
  const nu = Date.now(), l = (_pogingen.get(oid) || []).filter(t => nu - t < 3600e3);
  l.push(nu); _pogingen.set(oid, l);
  if (l.length > 10) return true;
  if (!env.MT_ROLLEN) return false;
  const key = `poging:${oid}:${Math.floor(nu / 3600e3)}`;
  const n = ((await kvJson(env, key)) || 0) + 1;
  try { await kvZet(env, key, n, { expirationTtl: 2 * 3600 }); } catch {}
  return n > 10;
}
// Is dit een sleutel die de worker zelf als secret heeft (gedeeld of van iemand anders)?
function isServerSleutel(env, sleutel) {
  return Object.keys(env).some(k => /^TOGGL_(FOCUS_)?KEY(_|$)/.test(k) && env[k] === sleutel);
}
// Focus-sleutel: geldig in onze werkruimte + van deze gebruiker (e-mail ↔ Toggl-gebruiker ↔ eigen uren).
async function valideerFocus(env, sleutel, email) {
  const auth = { Authorization: `Bearer ${sleutel}` };
  const O = `${FOCUS_API}organizations/${FOCUS_ORG}/workspaces/${FOCUS_WS}/`;
  const r = await togglFetch(O + 'tracking/current', { headers: auth });
  if (r.status === 401 || r.status === 403) return { fout: 'sleutel-ongeldig' };
  if (r.status !== 200 && r.status !== 204) return { fout: 'toggl-onbereikbaar' };
  const ru = await togglFetch(`${FOCUS_API}organizations/${FOCUS_ORG}/users`, { headers: { Authorization: `Bearer ${env.TOGGL_FOCUS_KEY || sleutel}` } });
  if (!ru.ok) return { fout: 'toggl-onbereikbaar' };
  const lijst = await ru.json().catch(() => []);
  const users = Array.isArray(lijst) ? lijst : (lijst && Array.isArray(lijst.data) ? lijst.data : []);
  const ik = users.find(u => String(u.email || '').toLowerCase() === email);
  if (!ik) return { fout: 'email-niet-in-toggl' };
  const tgUserId = ik.user_account_id != null ? ik.user_account_id : (ik.id != null ? ik.id : null);
  const naam = clip(ik.name || ik.fullname || ik.full_name || ik.email, 80);
  // Eigenaarschap: de eigen uren van de sleutel moeten van deze Toggl-gebruiker zijn (laatste jaar).
  const tot = new Date(), van = new Date(Date.now() - 365 * DAG_S * 1000);
  const rt = await togglFetch(`${O}time-entries/stream?date_from=${encodeURIComponent(van.toISOString())}&date_to=${encodeURIComponent(tot.toISOString())}&include_taskless=true`, { headers: auth });
  let bevestigd = false;
  if (rt.ok) {
    const e = await rt.json().catch(() => []);
    const rijen = Array.isArray(e) ? e : (e && Array.isArray(e.data) ? e.data : []);
    const ids = new Set(rijen.map(x => x.toggl_user_id != null ? x.toggl_user_id : x.user_id).filter(x => x != null).map(String));
    if (ids.size && (ids.size > 1 || !ids.has(String(tgUserId)))) return { fout: 'sleutel-van-ander' };
    bevestigd = ids.size === 1;
  }
  // Onbevestigd (nog geen eigen uren) én gelijk aan een sleutel die de worker al als secret heeft
  // (de gedeelde of die van een collega) → weigeren: dat is nooit "je eigen" sleutel.
  if (!bevestigd && isServerSleutel(env, sleutel)) return { fout: 'sleutel-van-ander' };
  return { naam, tgUserId, bevestigd };
}
// Track-sleutel (v9, gaat er op termijn uit): /me moet ons e-mailadres zijn.
async function valideerTrack(sleutel, email) {
  const r = await togglFetch('https://api.track.toggl.com/api/v9/me', { headers: { Authorization: `Basic ${btoa(sleutel + ':api_token')}` } });
  if (r.status === 401 || r.status === 403) return { fout: 'sleutel-ongeldig' };
  if (!r.ok) return { fout: 'toggl-onbereikbaar' };
  const me = await r.json().catch(() => ({}));
  if (String(me.email || '').toLowerCase() !== email) return { fout: 'sleutel-van-ander' };
  return { naam: clip(me.fullname || me.email, 80), bevestigd: true };
}
async function mijnTogglStatus(env, payload) {
  const rec = await leesSleutelRec(env, payload.oid);
  const st = async soort => {
    const r = rec && rec[soort];
    // Opgeslagen maar niet (meer) te ontsleutelen (KEK gewijzigd zonder SLEUTEL_KEK_VORIG) → opnieuw koppelen.
    if (r && await ontsleutel(env, payload.oid, soort, r)) return { gekoppeld: true, bron: 'eigen', naam: r.naam || '', sinds: r.sinds || null, bevestigd: !!r.bevestigd };
    const sec = userKey(env, soort === 'focus' ? 'TOGGL_FOCUS_KEY' : 'TOGGL_KEY', null, payload);
    if (r) return { gekoppeld: false, bron: 'onleesbaar', opnieuwKoppelen: true, naam: r.naam || '', viaBeheer: !!sec };
    return { gekoppeld: !!sec, bron: sec ? 'secret' : 'geen' };
  };
  return { focus: await st('focus'), track: await st('track'), versleuteling: !!(await sleutelKek(env)) };
}
async function handleMijnToggl(request, env, ik, payload, json) {
  const m = request.method, email = tokenEmail(payload);
  if (m === 'GET') return json(await mijnTogglStatus(env, payload));
  if (!env.MT_ROLLEN) return json({ error: 'geen-rollen-opslag' }, 503);
  const door = { door: payload.oid, doorNaam: (ik.rec && ik.rec.naam) || email };
  if (m === 'DELETE') {
    const soort = new URL(request.url).searchParams.get('soort');   // leeg = beide
    const rec = await kvJson(env, 'sleutel:' + payload.oid);
    if (rec) {
      const nieuw = { ...rec }; if (!soort || soort === 'focus') delete nieuw.focus; if (!soort || soort === 'track') delete nieuw.track;
      if (nieuw.focus || nieuw.track) await kvZet(env, 'sleutel:' + payload.oid, nieuw); else await env.MT_ROLLEN.delete('sleutel:' + payload.oid);
      _sleutelCache.delete(payload.oid);
      await audit(env, { ...door, actie: 'toggl-ontkoppeld', doel: payload.oid, doelNaam: door.doorNaam, soort: soort || 'alles' });
    }
    return json({ ok: true, ...(await mijnTogglStatus(env, payload)) });
  }
  if (m !== 'POST') return json({ error: 'methode' }, 405);
  if (!(await sleutelKek(env))) return json({ error: 'geen-versleuteling', uitleg: 'Worker-secret SLEUTEL_KEK ontbreekt of is ongeldig.' }, 503);
  if (await teVaakGeprobeerd(env, payload.oid)) return json({ error: 'te-vaak' }, 429);
  let b = {}; try { b = await request.json(); } catch {}
  const focus = typeof b.focus === 'string' ? b.focus.trim() : '', track = typeof b.track === 'string' ? b.track.trim() : '';
  if (!focus && !track) return json({ error: 'geen-sleutel' }, 400);
  if ((focus && !SLEUTEL_RE.test(focus)) || (track && !SLEUTEL_RE.test(track))) return json({ error: 'sleutel-vorm' }, 400);
  const uit = {};
  try {
    if (focus) { const v = await valideerFocus(env, focus, email); if (v.fout) return json({ error: v.fout, soort: 'focus' }, v.fout === 'toggl-onbereikbaar' ? 502 : 400); uit.focus = v; }
    if (track) { const v = await valideerTrack(track, email); if (v.fout) return json({ error: v.fout, soort: 'track' }, v.fout === 'toggl-onbereikbaar' ? 502 : 400); uit.track = v; }
  } catch (e) { return json({ error: 'toggl-onbereikbaar' }, 502); }
  const rec = (await kvJson(env, 'sleutel:' + payload.oid)) || {};
  for (const soort of Object.keys(uit)) {
    rec[soort] = { ...(await versleutel(env, payload.oid, soort, soort === 'focus' ? focus : track)), naam: uit[soort].naam || '', sinds: Date.now(), bevestigd: !!uit[soort].bevestigd, ...(uit[soort].tgUserId != null ? { tgUserId: uit[soort].tgUserId } : {}) };
  }
  await kvZet(env, 'sleutel:' + payload.oid, rec);
  _sleutelCache.delete(payload.oid);
  await audit(env, { ...door, actie: 'toggl-gekoppeld', doel: payload.oid, doelNaam: door.doorNaam, soort: Object.keys(uit).join('+') });
  return json({ ok: true, ...(await mijnTogglStatus(env, payload)) });
}

// ══ AANWEZIGHEIDSBORD (F1e-C) ═══════════════════════════════════════════════
// GET /aanwezig: per teamlid (rol, actief) of er nu een timer loopt, op welk project/welke
// taak, en sinds wanneer. GEEN duur- of urentotalen en geen omschrijving. Alleen met de
// eigen sleutel van die persoon (KV of worker-secret) — nooit met de gedeelde sleutel
// (die zou de timer van de beheerder tonen). Gepland/verlof vult de app lokaal aan.
const AANWEZIG_MS = 60 * 1000;
let _aanwezig = null;            // {t, data}
const _namenCache = { projecten: null, t: 0, taken: new Map() };
async function focusNamen(env) {
  if (_namenCache.projecten && Date.now() - _namenCache.t < 10 * 60 * 1000) return _namenCache.projecten;
  const m = new Map();
  if (env.TOGGL_FOCUS_KEY) {
    for (let page = 1; page <= 10; page++) {
      const r = await togglFetch(`${FOCUS_API}organizations/${FOCUS_ORG}/workspaces/${FOCUS_WS}/projects?page=${page}&per_page=100`, { headers: { Authorization: `Bearer ${env.TOGGL_FOCUS_KEY}` } }).catch(() => null);
      if (!r || !r.ok) break;
      const j = await r.json().catch(() => ({})); const d = Array.isArray(j) ? j : (j.data || []);
      d.forEach(p => m.set(String(p.id), clip(p.name, 120)));
      if (d.length < 100) break;
    }
  }
  _namenCache.projecten = m; _namenCache.t = Date.now();
  return m;
}
async function focusTaakNaam(env, id) {
  if (id == null || !env.TOGGL_FOCUS_KEY) return null;
  const c = _namenCache.taken.get(String(id)); if (c && Date.now() - c.t < 10 * 60 * 1000) return c.naam;
  const r = await togglFetch(`${FOCUS_API}organizations/${FOCUS_ORG}/workspaces/${FOCUS_WS}/tasks/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${env.TOGGL_FOCUS_KEY}` } }).catch(() => null);
  const naam = r && r.ok ? clip((await r.json().catch(() => ({}))).name, 120) : null;
  _namenCache.taken.set(String(id), { naam, t: Date.now() });
  return naam;
}
async function handleAanwezig(env, json) {
  if (_aanwezig && Date.now() - _aanwezig.t < AANWEZIG_MS) return json({ ..._aanwezig.data, cache: true });
  const team = (await lijstKV(env, 'user:')).filter(g => g.active !== false && ROLLEN.includes(g.role));
  const projecten = await focusNamen(env).catch(() => new Map());
  const personen = await Promise.all(team.map(async g => {
    // slug = deel vóór de @ (koppelt aan planblokken/verlof in de app); geen volledig e-mailadres naar buiten.
    const basis = { naam: g.naam || String(g.email || '').split('@')[0], slug: String(g.email || '').split('@')[0].toLowerCase(), rol: g.role };
    const s = await togglSleutel(env, 'focus', { oid: g.oid, preferred_username: g.email }).catch(() => ({ bron: 'geen' }));
    if (s.bron !== 'eigen' && s.bron !== 'secret') return { ...basis, status: 'onbekend' };
    try {
      const r = await togglFetch(`${FOCUS_API}organizations/${FOCUS_ORG}/workspaces/${FOCUS_WS}/tracking/current`, { headers: { Authorization: `Bearer ${s.sleutel}` } });
      if (r.status === 204) return { ...basis, status: 'geen-timer' };
      if (!r.ok) return { ...basis, status: 'onbekend' };
      const e = await r.json().catch(() => null);
      if (!e || !e.start) return { ...basis, status: 'geen-timer' };
      const pid = e.project_id != null ? String(e.project_id) : null;
      return { ...basis, status: 'aan-het-werk', sinds: e.start, project_id: e.project_id ?? null, project: pid ? (projecten.get(pid) || null) : null,
        task_id: e.task_id ?? null, taak: await focusTaakNaam(env, e.task_id).catch(() => null) };
    } catch { return { ...basis, status: 'onbekend' }; }
  }));
  personen.sort((a, b) => (a.status === 'aan-het-werk' ? 0 : 1) - (b.status === 'aan-het-werk' ? 0 : 1) || String(a.naam).localeCompare(String(b.naam)));
  const data = { ts: Date.now(), personen };
  _aanwezig = { t: Date.now(), data };
  return json(data);
}


// Log-teller: in geheugen optellen, hooguit eens per LOG_FLUSH_MS samenvoegen in KV.
const _teller = { dag: '', totaal: 0, geweigerd: 0, redenen: {}, laatsteFlush: Date.now() };
async function flushTeller(env) {
  if (!env.MT_ROLLEN || (!_teller.totaal && !_teller.geweigerd && !_teller.proxyTotaal)) return;
  const dag = _teller.dag, delta = { totaal: _teller.totaal, geweigerd: _teller.geweigerd, redenen: _teller.redenen, proxy: _teller.proxy || {}, proxyTotaal: _teller.proxyTotaal || 0 };
  _teller.totaal = 0; _teller.geweigerd = 0; _teller.redenen = {}; _teller.proxy = {}; _teller.proxyTotaal = 0; _teller.laatsteFlush = Date.now();
  const oud = (await kvJson(env, 'stat:' + dag)) || { totaal: 0, geweigerd: 0, redenen: {} };
  oud.totaal += delta.totaal; oud.geweigerd += delta.geweigerd;
  for (const [k, n] of Object.entries(delta.redenen)) {
    if (oud.redenen[k] != null || Object.keys(oud.redenen).length < 300) oud.redenen[k] = (oud.redenen[k] || 0) + n;
  }
  // F2: afwijkingen van het proxy-contract apart
  oud.proxy = oud.proxy || {}; oud.proxyTotaal = (oud.proxyTotaal || 0) + delta.proxyTotaal;
  for (const [k, n] of Object.entries(delta.proxy)) {
    if (oud.proxy[k] != null || Object.keys(oud.proxy).length < 300) oud.proxy[k] = (oud.proxy[k] || 0) + n;
  }
  try { await kvZet(env, 'stat:' + dag, oud, { expirationTtl: 35 * DAG_S }); } catch {}
}
async function noteerBesluit(env, ctx, b) {
  const dag = new Date().toISOString().slice(0, 10);
  if (_teller.dag && _teller.dag !== dag) await flushTeller(env).catch(() => {});
  _teller.dag = dag;
  _teller.totaal++;
  if (!b.ok) {
    _teller.geweigerd++;
    const k = `${b.rol || '-'}|${b.actie}|${b.reden}`;
    if (_teller.redenen[k] != null || Object.keys(_teller.redenen).length < 300) _teller.redenen[k] = (_teller.redenen[k] || 0) + 1;
    // Alleen oid-hash, rol, target, actie, besluit — geen tokens, e-mail of inhoud.
    console.log(JSON.stringify({ rollen: b.modus, oid: await oidHash(b.oid), rol: b.rol || '-', target: b.target, actie: b.actie,
      besluit: b.modus === 'afdwingen' ? 'geweigerd' : 'zou-weigeren', reden: b.reden }));
  }
  if (Date.now() - _teller.laatsteFlush > LOG_FLUSH_MS) waitUntil(ctx, flushTeller(env).catch(() => {}));
}


// ══ PROXY-CONTRACT (F2) ══════════════════════════════════════════════════════
// Allowlist van wat de UI echt doet (v2, mobiel, toggl2, mt-*.js — inventaris 2026-10-07):
// per target methode + padpatroon + toegestane query-sleutels + maximale body. Alles daarbuiten
// is een "afwijking": PROXY_MODUS 'log' (standaard) logt en telt, 'afdwingen' weigert (403).
// Los daarvan blijven veiligPad (../, //, backslash) en de rolmatrix gelden.
// Regel: [methodes, pad-regex (zonder query), toegestane query-sleutels, maxBody (bytes)]
const KB = 1024, MB_ = 1024 * 1024;
const Q = (...s) => new Set(s);
const PROXY_CONTRACT = {
  // pad = na "<admin>/" (MB_ADMIN verplicht), zonder .json
  moneybird: [
    [['GET'], /^contacts$/, Q('page', 'per_page', 'query'), 0],
    [['GET'], /^documents\/purchase_invoices$/, Q('filter', 'page', 'per_page'), 0],
    [['GET'], /^documents\/purchase_invoices\/\d+$/, Q(), 0],
    [['GET'], /^documents\/sales_invoices$/, Q('filter', 'page', 'per_page'), 0],
    [['GET'], /^sales_invoices$/, Q('filter', 'page', 'per_page'), 0],
    [['GET'], /^sales_invoices\/\d+$/, Q(), 0],
    [['GET'], /^estimates$/, Q('filter', 'page', 'per_page'), 0],
    [['GET'], /^estimates\/\d+$/, Q(), 0],
    [['GET'], /^ledger_accounts$/, Q(), 0],
    [['GET'], /^reports\/(creditors|debtors|creditors_aging|debtors_aging|expenses_by_contact|profit_loss)$/, Q('period', 'per_page'), 0],
    [['POST'], /^contacts$/, Q(), 16 * KB],
    [['POST'], /^documents\/purchase_invoices$/, Q(), 256 * KB],
    [['PATCH'], /^documents\/purchase_invoices\/\d+$/, Q(), 256 * KB],
    [['DELETE'], /^documents\/purchase_invoices\/\d+$/, Q(), 0],
    [['POST'], /^documents\/purchase_invoices\/\d+\/notes$/, Q(), 16 * KB],
    [['POST'], /^estimates$/, Q(), 256 * KB],
    [['POST'], /^sales_invoices$/, Q(), 256 * KB],
    [['PATCH'], /^estimates\/\d+\/bill_estimate$/, Q(), 4 * KB],
  ],
  moneybird_upload: [[['POST'], /^documents\/purchase_invoices\/\d+\/attachments$/, Q(), 15 * MB_]],
  moneybird_download: [[['GET'], /^$/, Q(), 0]],   // ids worden apart als numeriek gecontroleerd
  toggl: [   // Track v9 (pad zonder workspaces/{WS}/ waar dat ervoor staat)
    [['GET'], /^me\/time_entries\/current$/, Q(), 0],
    [['GET'], /^me\/time_entries$/, Q('start_date', 'end_date'), 0],
    [['GET'], /^me\/projects$/, Q(), 0],
    [['GET', 'POST'], /^W\/projects$/, Q('active', 'per_page'), 16 * KB],
    [['GET'], /^W\/(workspace_users|users)$/, Q(), 0],
    [['GET', 'POST'], /^W\/(clients|tags)$/, Q(), 8 * KB],
    [['PUT', 'DELETE'], /^W\/(clients|tags)\/\d+$/, Q(), 8 * KB],
    [['POST'], /^W\/time_entries$/, Q(), 16 * KB],
    [['PUT', 'DELETE'], /^W\/time_entries\/\d+$/, Q(), 16 * KB],
    [['PATCH'], /^W\/time_entries\/\d+\/stop$/, Q(), 4 * KB],
  ],
  toggl_focus: [   // O = organizations/{ORG}/workspaces/{WS}, W = workspaces/{WS}, G = organizations/{ORG}
    [['GET', 'POST'], /^O\/projects$/, Q('page', 'per_page', 'order_by', 'include_drafts'), 16 * KB],
    [['GET', 'PATCH'], /^O\/projects\/\d+$/, Q(), 16 * KB],
    [['PATCH'], /^O\/projects\/\d+\/archive$/, Q(), 1 * KB],
    [['GET', 'POST'], /^O\/tasks$/, Q('page', 'per_page', 'parent_task_id'), 32 * KB],
    [['GET'], /^O\/tasks\/stream$/, Q(), 0],
    [['PATCH', 'DELETE'], /^O\/tasks\/\d+$/, Q(), 32 * KB],
    [['GET'], /^O\/tracking\/current$/, Q(), 0],
    [['POST'], /^O\/time-entries$/, Q(), 16 * KB],
    [['PATCH', 'DELETE'], /^O\/time-entries\/\d+$/, Q(), 16 * KB],
    [['GET'], /^O\/time-entries\/stream$/, Q('date_from', 'date_to', 'order_by', 'include_taskless', 'project_id'), 0],
    [['GET'], /^O\/time-blocks\/stream$/, Q('date_from', 'date_to', 'order_by'), 0],
    [['GET'], /^O\/capacities\/users$/, Q('user_id', 'unit', 'start_date', 'end_date'), 0],
    [['GET'], /^W\/statuses$/, Q('per_page', 'page', 'order_by'), 0],
    [['GET', 'POST'], /^W\/clients$/, Q('per_page', 'page'), 8 * KB],
    [['GET'], /^G\/users$/, Q(), 0],
    [['POST'], /^reports\/W\/query$/, Q(), 32 * KB],
  ],
  toggl_reports: [[['POST'], /^workspace\/WS\/search\/time_entries$/, Q(), 32 * KB]],
  toggl_admin_projects: [[['GET'], /^W\/projects$/, Q('active', 'per_page'), 0]],
  claude: [[['POST'], /^$/, Q(), 25 * MB_]],
};
const CLAUDE_MODEL_RE = /^claude-(haiku|sonnet)-[a-z0-9.-]{1,40}$/;
const CLAUDE_MAX_TOKENS = 4096;
function proxyModus(env) {
  const m = String((env && env.PROXY_MODUS) || 'log').trim().toLowerCase();
  return ['uit', 'log', 'afdwingen'].includes(m) ? m : 'log';
}
// Pad → genormaliseerde vorm voor het contract (ids en werkruimte vast, MB-admin eraf).
function contractPad(target, pad) {
  let p = String(pad || '').split(/[?#]/)[0].replace(/\.json$/, '').replace(/\/$/, '');
  if (target === 'moneybird' || target === 'moneybird_upload') {
    const m = /^(\d+)\/(.*)$/.exec(p);
    return m && m[1] === MB_ADMIN ? m[2] : null;
  }
  if (target === 'toggl' || target === 'toggl_admin_projects') return p.replace(new RegExp(`^workspaces/${FOCUS_WS}(?=/|$)`), 'W');
  if (target === 'toggl_focus') {
    return p.replace(new RegExp(`^organizations/${FOCUS_ORG}/workspaces/${FOCUS_WS}(?=/|$)`), 'O')
      .replace(new RegExp(`^organizations/${FOCUS_ORG}(?=/|$)`), 'G')
      .replace(new RegExp(`^reports/workspaces/${FOCUS_WS}(?=/|$)`), 'reports/W')
      .replace(new RegExp(`^workspaces/${FOCUS_WS}(?=/|$)`), 'W');
  }
  if (target === 'toggl_reports') return p.replace(new RegExp(`^workspace/${FOCUS_WS}(?=/|$)`), 'workspace/WS');
  return p;
}
// → null (binnen contract) of reden. `lengte` = Content-Length (of null), `body` = JSON (alleen claude).
function toetsContract(target, methode, pad, lengte, body) {
  const regels = PROXY_CONTRACT[target];
  if (!regels) return 'onbekend-target';
  const ruw = String(pad || '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(ruw) || ruw.includes('://')) return 'volledige-url';
  const p = contractPad(target, ruw);
  if (p == null) return 'andere-administratie';
  const m = String(methode || 'GET').toUpperCase();
  const regel = regels.find(([ms, re]) => ms.includes(m) && re.test(p));
  if (!regel) return regels.some(([, re]) => re.test(p)) ? 'methode-niet-in-contract' : 'pad-niet-in-contract';
  const qs = ruw.includes('?') ? ruw.slice(ruw.indexOf('?') + 1) : '';
  if (qs) {
    if (qs.length > 2000) return 'query-te-lang';
    const gezien = new Set();
    for (const [k, v] of new URLSearchParams(qs)) {
      if (!regel[2].has(k)) return 'onverwachte-query';
      if (gezien.has(k)) return 'dubbele-query';
      gezien.add(k);
      if (v.length > 500 || /[\x00-\x1f]/.test(v)) return 'query-waarde';
    }
  }
  if (lengte != null && lengte > regel[3]) return 'body-te-groot';
  if (target === 'claude' && body) {
    if (!CLAUDE_MODEL_RE.test(String(body.model || ''))) return 'claude-model';
    if (!(Number(body.max_tokens) > 0 && Number(body.max_tokens) <= CLAUDE_MAX_TOKENS)) return 'claude-max-tokens';
    if (body.tools || (body.system && String(body.system).length > 20000)) return 'claude-opties';
  }
  return null;
}
// F3: elke Moneybird-schrijfactie draagt X-MT-Bevestiging (de UI vroeg de gebruiker vooraf om bevestiging).
// Let op: dit is een UI-/auditmarkering, GEEN beveiligingsgrens — elke ingelogde aanroeper kan zo'n
// id verzinnen. De echte grenzen zijn de rolmatrix, het contract en de concept-only-regels.
const BEVESTIG_RE = /^mt-[a-z0-9-]{6,60}$/;
const ACTIE_RE = /^mt-[a-z0-9-]{6,60}(:[a-z0-9_-]{1,30})?$/;
const isMbSchrijf = (target, methode) => (target === 'moneybird' && String(methode).toUpperCase() !== 'GET') || target === 'moneybird_upload';
async function noteerProxy(env, ctx, b) {
  const k = `${b.target}|${b.actie}|${b.reden}`;
  _teller.proxy = _teller.proxy || {};
  if (_teller.proxy[k] != null || Object.keys(_teller.proxy).length < 200) _teller.proxy[k] = (_teller.proxy[k] || 0) + 1;
  _teller.proxyTotaal = (_teller.proxyTotaal || 0) + 1;
  console.log(JSON.stringify({ proxy: b.modus, oid: await oidHash(b.oid), target: b.target, actie: b.actie, reden: b.reden,
    besluit: b.modus === 'afdwingen' ? 'geweigerd' : 'zou-weigeren' }));
  if (!_teller.dag) _teller.dag = new Date().toISOString().slice(0, 10);
  if (Date.now() - _teller.laatsteFlush > LOG_FLUSH_MS) waitUntil(ctx, flushTeller(env).catch(() => {}));
}

// ══ IDEMPOTENTIE (F4) ════════════════════════════════════════════════════════
// MB-schrijfactie met X-MT-Actie: per (oid, actie) in KV `actie:{oid}:{actie}` (24 u):
//   bezig → klaar {http, body, mbId} | onzeker (5xx/time-out: MB kán het gedaan hebben)
// Zelfde actie nog eens: klaar → hetzelfde antwoord zonder nieuwe call (X-MT-Herhaald: 1);
// bezig (< 2 min) → 409 actie-bezig; anders → 409 actie-onzeker (UI zoekt het concept op).
// 4xx van MB = niets aangemaakt → sleutel weg, opnieuw proberen mag.
// Beperking: KV is eventually consistent; gelijktijdige dubbele verzoeken via verschillende
// datacenters kunnen beide door (de in-memory kaart vangt het binnen één isolate af).
const ACTIE_TTL_S = 24 * 3600, ACTIE_BEZIG_MS = 2 * 60 * 1000, ACTIE_BODY_MAX = 512 * KB;
const _acties = new Map();   // key -> rec (deze isolate; KV-terugval)
// Opslag van één actie. Met de Durable Object-binding MT_ACTIES is "begin" atomair (één object per
// gebruiker+actie, opslag geserialiseerd) — ook over datacenters heen. Zonder binding: KV + geheugen
// (KV is eventually consistent: gelijktijdige dubbele verzoeken via verschillende datacenters kunnen
// dan beide door; binnen één isolate vangt het geheugen het af).
function actieOpslag(env, key) {
  if (env.MT_ACTIES && env.MT_ACTIES.idFromName) {
    const stub = env.MT_ACTIES.get(env.MT_ACTIES.idFromName(key));
    const doe = async (op, rec) => (await stub.fetch('https://mt-acties/' + op, { method: 'POST', body: JSON.stringify(rec || {}) })).json();
    return { soort: 'do', begin: async start => doe('begin', start), zet: rec => doe('zet', rec), wis: () => doe('wis') };
  }
  return {
    soort: 'kv',
    begin: async start => {
      const bestaand = _acties.get(key) || await kvJson(env, key);
      if (bestaand) return { bestaand };
      _acties.set(key, start);
      try { await kvZet(env, key, start, { expirationTtl: ACTIE_TTL_S }); } catch {}
      return { nieuw: true };
    },
    zet: async rec => { _acties.set(key, rec); try { await kvZet(env, key, rec, { expirationTtl: ACTIE_TTL_S }); } catch {} },
    wis: async () => { _acties.delete(key); try { await env.MT_ROLLEN.delete(key); } catch {} },
  };
}
async function sha256Hex(tekst) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(tekst == null ? '' : tekst)));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function mbIdempotent(env, ik, actie, methode, pad, doFetch, cors, body) {
  const hdr = extra => ({ 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ...cors, ...(extra || {}) });
  const fout = (obj, status) => new Response(JSON.stringify(obj), { status, headers: hdr() });
  if (!ACTIE_RE.test(actie)) return fout({ error: 'ongeldige-actie' }, 400);
  const key = `actie:${String(ik.oid).toLowerCase()}:${actie}`;
  const opslag = actieOpslag(env, key);
  const start = { status: 'bezig', ts: Date.now(), methode, pad, hash: await sha256Hex(body) };
  const b = await opslag.begin(start);
  const bestaand = b && b.bestaand;
  if (bestaand) {
    // Zelfde actie-id hoort bij precies dezelfde vraag (methode, pad én inhoud).
    if (bestaand.methode !== methode || bestaand.pad !== pad || (bestaand.hash && bestaand.hash !== start.hash)) return fout({ error: 'actie-andere-inhoud' }, 409);
    if (bestaand.status === 'klaar') {
      const body = bestaand.body != null ? bestaand.body : JSON.stringify({ id: bestaand.mbId });
      return new Response(body, { status: bestaand.http || 200, headers: hdr({ 'X-MT-Herhaald': '1' }) });
    }
    const bezig = bestaand.status === 'bezig' && Date.now() - bestaand.ts < ACTIE_BEZIG_MS;
    return fout({ error: bezig ? 'actie-bezig' : 'actie-onzeker', sinds: bestaand.ts }, 409);
  }
  let resp;
  try { resp = await doFetch(); }
  catch (e) {
    try { await opslag.zet({ ...start, status: 'onzeker' }); } catch {}
    return fout({ error: 'moneybird-onbereikbaar', actie: 'onzeker' }, 504);
  }
  const text = await resp.text();
  try {
    if (resp.ok) {
      let mbId = null; try { const j = JSON.parse(text); mbId = j && j.id != null ? String(j.id) : null; } catch {}
      await opslag.zet({ ...start, status: 'klaar', http: resp.status, mbId, body: text.length <= ACTIE_BODY_MAX ? text : null });
    } else if (resp.status >= 400 && resp.status < 500) {
      await opslag.wis();   // MB weigerde: er is niets aangemaakt → opnieuw proberen mag
    } else {
      await opslag.zet({ ...start, status: 'onzeker', http: resp.status });
    }
  } catch {}
  return new Response(text, { status: resp.status, headers: hdr() });
}

// Durable Object: één per (gebruiker, actie). Opslag binnen een object is geserialiseerd, dus
// "begin" (lezen + bezig zetten) is atomair. Na 24 u ruimt een alarm het object op.
export class MtActies {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const op = new URL(request.url).pathname.slice(1);
    let rec = {}; try { rec = await request.json(); } catch {}
    const st = this.state.storage, antw = o => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
    if (op === 'begin') {
      const bestaand = await st.get('rec');
      if (bestaand) return antw({ bestaand });
      await st.put('rec', rec);
      try { await st.setAlarm(Date.now() + ACTIE_TTL_S * 1000); } catch {}
      return antw({ nieuw: true });
    }
    if (op === 'zet') { await st.put('rec', rec); return antw({ ok: true }); }
    if (op === 'wis') { await st.deleteAll(); return antw({ ok: true }); }
    return new Response('onbekend', { status: 404 });
  }
  async alarm() { await this.state.storage.deleteAll(); }
}

// ── Werkcode-teller (projectnummering) ────────────────────────────────────────
// Elk project krijgt een eigen werkcode W<jj>-<nnn> (bv. W26-014): per jaar doorlopend, nooit
// hergebruikt, en idempotent per project_id (zelfde project = zelfde code, ook bij herhalen of
// vanaf twee pc's tegelijk). Eén Durable Object houdt de teller; opslag daarin is geserialiseerd
// (blockConcurrencyWhile), dus lezen + ophogen + vastleggen is atomair. Bewust GEEN KV-terugval:
// KV is eventually consistent en zou dubbele nummers kunnen geven → zonder binding 503.
// Bestaande projecten: in volgorde van (jaar, created, project_id), in stukken van hooguit 40; elk stuk
// wordt in één schrijfactie vastgelegd (alles of niets). De cockpit stuurt de stukken gesorteerd en na
// elkaar; een afgebroken migratie is veilig te herhalen (idempotent per project_id). `proef` laat zien
// wat er nu zou gebeuren zonder iets vast te leggen (indicatief: andere uitgifte tussendoor kan schuiven).
const WERKCODE_PID_RE = /^p_[0-9a-z]{4,40}$/;
const WERKCODE_BATCH_MAX = 40;          // × 3 sleutels + tellers ≤ 128 sleutels per put (DO-limiet)
function jaarNu() { return Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Amsterdam', year: 'numeric' }).format(new Date())); }
export class MtTeller {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const op = new URL(request.url).pathname.slice(1);
    let b = {}; try { b = await request.json(); } catch {}
    const st = this.state.storage, antw = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (op === 'alle') {
      const m = await st.list({ prefix: 'pid:' }), werkcodes = {};
      for (const [k, w] of m) werkcodes[k.slice(4)] = w.code;
      return antw({ werkcodes });
    }
    if (op !== 'ken' && op !== 'proef') return antw({ error: 'onbekend' }, 404);
    const items = (Array.isArray(b.items) ? b.items : []).slice();
    if (b.sorteer) items.sort((x, y) => (x.jaar - y.jaar) || String(x.created || '').localeCompare(String(y.created || '')) || String(x.project_id).localeCompare(String(y.project_id)));
    const uit = await this.state.blockConcurrencyWhile(async () => {
      const res = [], teller = {}, gezien = new Map(), nieuweCodes = new Set(), schrijf = {}, ts = Date.now();
      for (const it of items) {
        const pid = String(it.project_id);
        const bestaand = gezien.get(pid) || ((await st.get('pid:' + pid)) || {}).code;
        if (bestaand) { res.push({ project_id: pid, werkcode: bestaand, nieuw: false }); gezien.set(pid, bestaand); continue; }
        const jaar = String(it.jaar), jj = jaar.slice(-2);   // teller per volledig jaar; code toont twee cijfers
        if (!(jaar in teller)) teller[jaar] = (await st.get('n:' + jaar)) || 0;
        let code;
        do { teller[jaar]++; code = `W${jj}-${String(teller[jaar]).padStart(3, '0')}`; } while (nieuweCodes.has(code) || await st.get('code:' + code));   // nooit een bestaande code
        nieuweCodes.add(code); gezien.set(pid, code);
        Object.assign(schrijf, { ['n:' + jaar]: teller[jaar], ['pid:' + pid]: { code, ts }, ['code:' + code]: pid });
        res.push({ project_id: pid, werkcode: code, nieuw: true });
      }
      if (op === 'ken' && Object.keys(schrijf).length) {
        if (Object.keys(schrijf).length > 128) throw new Error('te-veel-sleutels');
        await st.put(schrijf);   // alles in één keer: een afgebroken verzoek legt niets half vast
      }
      return res;
    }).catch(e => ({ fout: String(e.message || e) }));
    if (uit && uit.fout) return antw({ error: uit.fout }, 400);
    return antw({ uit, proef: op === 'proef' || undefined });
  }
}
// Centrale instellingen (KV MT_ROLLEN `instelling:<sleutel>`); alleen bekende sleutels/waarden.
const INSTELLINGEN = { projectcode: { naam: 'Projectcode tonen als', waarden: ['offerte', 'werkcode', 'beide'], standaard: 'offerte' } };
async function leesInstellingen(env) {
  const uit = {};
  for (const [k, d] of Object.entries(INSTELLINGEN)) { const r = await kvJson(env, 'instelling:' + k); uit[k] = r && d.waarden.includes(r.waarde) ? r.waarde : d.standaard; }
  return uit;
}
async function handleTeller(p, request, env, ik, json) {
  if (!ik.rol) return json({ error: 'geen-toegang', reden: ik.reden || 'geen-rol' }, 403);
  const m = request.method, R = RECHTEN[ik.rol];
  if (p === '/instellingen' && m === 'GET') return json(await leesInstellingen(env));
  const ns = env.MT_TELLER;
  if (!ns || !ns.idFromName) return json({ error: 'geen-teller', uitleg: 'Durable Object-binding MT_TELLER ontbreekt (zie wrangler.toml)' }, 503);
  const stub = ns.get(ns.idFromName('werkcode'));
  const doe = async (op, b) => { const r = await stub.fetch('https://mt-teller/' + op, { method: 'POST', body: JSON.stringify(b || {}) }); return { status: r.status, j: await r.json() }; };
  if (p === '/teller/werkcodes' && m === 'GET') { const r = await doe('alle'); return json(r.j, r.status); }
  if (m !== 'POST' || (p !== '/teller/werkcode' && p !== '/teller/werkcode/batch')) return json({ error: 'onbekende-route' }, 404);
  // Nummers uitgeven: in élke modus afgedwongen (een verbruikt nummer komt nooit terug).
  if (R.projecten !== 'wijzigen') return json({ error: 'geen-toegang', reden: 'projecten-wijzigen' }, 403);
  let body = {}; try { body = await request.json(); } catch {}
  const door = { door: ik.oid, doorNaam: (ik.rec && ik.rec.naam) || ik.email };
  if (p === '/teller/werkcode') {
    const pid = String((body && body.project_id) || '');
    if (!WERKCODE_PID_RE.test(pid)) return json({ error: 'ongeldig-project_id' }, 400);
    const r = await doe('ken', { items: [{ project_id: pid, jaar: jaarNu() }] });   // nieuw project: jaar van nu (server)
    if (r.status !== 200) return json(r.j, r.status);
    const u = r.j.uit[0];
    if (u.nieuw) await audit(env, { ...door, actie: 'werkcode-toegekend', doel: pid, doelNaam: u.werkcode, nieuw: u.werkcode });
    return json(u);
  }
  // Bestaande projecten (eenmalige migratie, of nagekomen projecten): alleen beheer.
  if (!R.beheer) return json({ error: 'geen-toegang', reden: 'beheer' }, 403);
  const items = body && Array.isArray(body.items) ? body.items : null;
  if (!items || !items.length || items.length > WERKCODE_BATCH_MAX) return json({ error: 'ongeldige-items' }, 400);
  const nu = jaarNu(), schoon = [];
  for (const x of items) {
    const pid = String((x && x.project_id) || ''), created = String((x && x.created) || ''), jaar = Number(created.slice(0, 4));
    // Bestaand project: het jaar komt uit de aanmaakdatum (verplicht) — zonder geldige datum geen gok.
    if (!WERKCODE_PID_RE.test(pid) || !/^\d{4}-\d{2}-\d{2}$/.test(created) || jaar < 2000 || jaar > nu || (x.jaar != null && Number(x.jaar) !== jaar)) return json({ error: 'ongeldig-item', project_id: pid }, 400);
    schoon.push({ project_id: pid, jaar, created });
  }
  const r = await doe(body.proef ? 'proef' : 'ken', { items: schoon, sorteer: true });
  if (r.status === 200 && !body.proef) {
    const n = r.j.uit.filter(u => u.nieuw).length;
    if (n) await audit(env, { ...door, actie: 'werkcodes-migratie', doel: 'werkcodes', doelNaam: n + ' project' + (n === 1 ? '' : 'en'), nieuw: r.j.uit.filter(u => u.nieuw).map(u => u.werkcode).join(', ').slice(0, 300) });
  }
  return json(r.j, r.status);
}

// ── Geldtijdlijn (cashflow v2), brok G1: /geld/* ──────────────────────────────
// Eén cash-eventlijst (verleden = echte bankmutaties, toekomst = open facturen op hun vervaldag) plus
// saldo-informatie. Recht `geld` (eigenaar: wijzigen, administratie: lezen), server-side en los van
// ROLLEN_MODUS; alle andere rollen nee. Uitgangspunt: geld
// mag nooit stil verdwijnen of dubbel tellen — elke onvolledige of mislukte bron komt in waarschuwingen[].
// - Mutaties: Moneybird geeft boven ~100 resultaten een 400 ("too many") en pagineert dan niet → de periode
//   wordt gehalveerd tot het past; één dag die nog te vol is → waarschuwing (mogelijk onvolledig).
// - Facturen: Moneybird geeft standaard alleen het huidige jaar → per jaar opvragen (period-filter).
// - Saldo: MB-stand = balans (reports/balance_sheet) op het laatste maandeinde + mutaties sindsdien.
//   IJkpunt (Bart): eindsaldo van die dag; mutaties tellen vanaf de dag ÉRNA. verschil = MB-stand − ijkpunt-stand.
// - Rekeningen: de lopende rekening + spaarpotjes (ING), die alleen in de configuratie staan (KV
//   `geld:config`, ingesteld door de eigenaar): per pot id, naam, doel, evt. Moneybird-grootboek en
//   herkenning (tegenrekening/omschrijving). Een overboeking naar/van een pot is intern:true: in de stand
//   "lopend" een uitgave/ontvangst, in "totaal" neutraal. Potsaldo = ijkpunt + herkende overboekingen sindsdien.
// - Kredietlimiet (ondergrens lopende rekening) en BTW-sparen (percentage, rekeningen) ook alleen in de
//   configuratie: geen bedragen of percentages in de repo.
// Rekening-id's zijn Moneybird-sleutels (geen geheimen; geen namen/IBAN's in de repo).
const GELD = {
  bank: { account: '343544076091524743', ledger: '343544076108301960' },
  maxDagen: 400, cacheTtl: 300, jarenTerug: 3,
  // Subrequest-limiet (gratis plan 50 per verzoek): Moneybird-verzoeken + KV-bewerkingen samen, met reserve.
  budget: 34, kvReserve: 14,
};
const GELD_POT_DOELEN = ['buffer', 'winst', 'vakantie', 'btw', 'overig'];
const GELD_POT_ID = /^[a-z][a-z0-9-]{1,30}$/;
// Configuratie normaliseren: alleen geldige velden; ontbrekend = leeg/null (niets verzinnen).
// Doel van een rekening/potje: bedrag óf bandbreedte (van–tot), streefdatum, mijlpalen, startpunt (voor het % van de weg).
function geldStreefNorm(x) {
  if (!x || typeof x !== 'object') return null;
  const g = v => typeof v === 'number' && isFinite(v) && Math.abs(v) <= 1e9 ? geldRond(v) : null;
  const r = { bedrag: g(x.bedrag), van: g(x.van), tot: g(x.tot), datum: geldIsDatum(x.datum) ? x.datum : null,
    mijlpalen: [...new Set((Array.isArray(x.mijlpalen) ? x.mijlpalen : []).map(g).filter(v => v != null))].sort((a, b) => a - b).slice(0, 10),
    start: x.start && geldIsDatum(x.start.datum) && g(x.start.bedrag) != null ? { datum: x.start.datum, bedrag: g(x.start.bedrag) } : null,
    // meegroeien met de bankhistorie (standaard aan); hooguit 1× per maand herberekend; laatste wijziging voor de melding
    meegroeien: x.meegroeien !== false, advies_maand: /^\d{4}-\d{2}$/.test(String(x.advies_maand || '')) ? x.advies_maand : null,
    wijziging: x.wijziging && g(x.wijziging.van) != null && g(x.wijziging.naar) != null && geldIsDatum(x.wijziging.datum)
      ? { van: g(x.wijziging.van), naar: g(x.wijziging.naar), datum: x.wijziging.datum, reden: String(x.wijziging.reden || '').slice(0, 200) } : null,
    // bovengrens voor automatisch meegroeien, en of de eigenaar al eens een advies heeft overgenomen (pas daarna automatisch)
    meegroei_max: g(x.meegroei_max) != null && g(x.meegroei_max) > 0 ? g(x.meegroei_max) : null,
    advies_akkoord: x.advies_akkoord && g(x.advies_akkoord.bedrag) != null && geldIsDatum(x.advies_akkoord.datum) ? { bedrag: g(x.advies_akkoord.bedrag), datum: x.advies_akkoord.datum } : null };
  if (r.van != null && r.tot != null && r.van > r.tot) [r.van, r.tot] = [r.tot, r.van];
  if (r.van == null || r.tot == null) { if (r.bedrag == null) r.bedrag = r.van != null ? r.van : r.tot; r.van = r.tot = null; }
  return r.bedrag == null && r.van == null && r.datum == null ? null : r;
}
// Standaardschema prognose (grenzen en termijnen per grootte; de eigenaar stelt het in, niets vast in de code).
function geldSchemaNorm(x) {
  if (!x || typeof x !== 'object') return null;
  const g = (v, min, max) => typeof v === 'number' && isFinite(v) && v >= min && v <= max ? v : null;
  const rij = l => (Array.isArray(l) ? l : []).slice(0, 6).map(r => ({ pct: g(r && r.pct, 0, 100), dagen: g(r && r.dagen, 0, 730), label: String((r && r.label) || '').slice(0, 24),
    anker: ['akkoord', 'start', 'oplevering'].includes(r && r.anker) ? r.anker : 'akkoord' })).filter(r => r.pct != null && r.dagen != null);
  const r = { grens_klein: g(x.grens_klein, 0, 1e9), grens_groot: g(x.grens_groot, 0, 1e9), betaaltermijn: Number.isInteger(x.betaaltermijn) && x.betaaltermijn >= 0 && x.betaaltermijn <= 120 ? x.betaaltermijn : null };
  for (const k of ['klein', 'middel', 'groot']) { const l = rij(x[k]); r[k] = l.length && Math.abs(l.reduce((a, q) => a + q.pct, 0) - 100) < 0.01 ? l : []; }
  return r;
}
function geldConfigNorm(c) {
  c = c && typeof c === 'object' ? c : {};
  const getal = (x, min, max) => (typeof x === 'number' && isFinite(x) && x >= min && x <= max) ? x : null;
  const potten = (Array.isArray(c.potten) ? c.potten : []).filter(p => p && GELD_POT_ID.test(String(p.id)) && p.id !== 'lopend').map(p => ({
    id: String(p.id), naam: String(p.naam || p.id).slice(0, 40), doel: GELD_POT_DOELEN.includes(p.doel) ? p.doel : 'overig',
    ledger: /^\d{6,25}$/.test(String(p.ledger || '')) ? String(p.ledger) : null,
    herkenning: { tegenrekening: String((p.herkenning && p.herkenning.tegenrekening) || '').replace(/\s+/g, '').toUpperCase().slice(0, 40),
      omschrijving: String((p.herkenning && p.herkenning.omschrijving) || '').trim().slice(0, 60) },
    weekinleg: getal(p.weekinleg, 0, 1e7), weekdag: Number.isInteger(p.weekdag) && p.weekdag >= 1 && p.weekdag <= 7 ? p.weekdag : null, actief: p.actief !== false,
    streef: geldStreefNorm(p.streef), virtueel: p.virtueel === true }))
    .map(p => p.virtueel ? Object.assign(p, { ledger: null, herkenning: { tegenrekening: '', omschrijving: '' } }) : p);   // virtueel: geen eigen rekening
  const ids = new Set(), uniek = potten.filter(p => !ids.has(p.id) && ids.add(p.id));
  const btw = c.btw && typeof c.btw === 'object' ? c.btw : {};
  const rek = x => (x === 'lopend' || uniek.some(p => p.id === x && !p.virtueel)) ? x : null;   // virtueel heeft geen eigen saldo
  const groepen = (Array.isArray(c.klantgroepen) ? c.klantgroepen : []).filter(g => g && GELD_POT_ID.test(String(g.id))).map(g => ({
    id: String(g.id), naam: String(g.naam || g.id).slice(0, 60), prefix: String(g.prefix || '').trim().slice(0, 60),
    contact_ids: (Array.isArray(g.contact_ids) ? g.contact_ids : []).map(String).filter(x => /^\d{6,25}$/.test(x)).slice(0, 200) }))
    .filter(g => g.prefix.length >= 3 || g.contact_ids.length);
  return { kredietlimiet: getal(c.kredietlimiet, 0, 1e9), potten: uniek, klantgroepen: groepen, lopend_streef: geldStreefNorm(c.lopend_streef), prognose_schema: geldSchemaNorm(c.prognose_schema),
    buffer_lopend: typeof c.buffer_lopend === 'number' && isFinite(c.buffer_lopend) && Math.abs(c.buffer_lopend) <= 1e9 ? c.buffer_lopend : null,
    // cijfers (G9): indeling grootboek → categorie, privé- en aflossingsgrootboeken, loonpatronen, branche; null = voorstel
    cijfers: geldCijferCfgNorm(c.cijfers),
    // spaarrente op de potjes (fractie per jaar), door de eigenaar ingevuld; leeg = afleiden uit rentebijschrijvingen
    spaarrente: typeof c.spaarrente === 'number' && isFinite(c.spaarrente) && c.spaarrente >= 0 && c.spaarrente <= 0.2 ? c.spaarrente : null,
    // Eigen reserve (alleen weergave): tot dit bedrag, en nooit meer dan de stand van het reservepotje, telt een stand
    // onder 0 als "eigen reserve" in plaats van bankkrediet.
    reserve: c.reserve && typeof c.reserve === 'object' && getal(c.reserve.bedrag, 0, 1e9) != null ? { bedrag: c.reserve.bedrag, pot: uniek.some(p => p.id === c.reserve.pot && !p.virtueel && p.doel !== 'btw' && p.id !== (btw.spaarpot || null)) ? c.reserve.pot : null } : null,   // nooit de BTW-pot (die telt al in lopend)
    // modus 'in_lopend' (standaard): de BTW-pot telt mee als lopende rekening, aangifte van die gecombineerde stand, geen
    // terugboeking; 'apart': BTW-pot als eigen rekening met aangifte_van/terugboeking_van.
    btw: { modus: btw.modus === 'apart' ? 'apart' : 'in_lopend', spaarpercentage: getal(btw.spaarpercentage, 0, 1), spaarpot: uniek.some(p => p.id === btw.spaarpot && !p.virtueel) ? btw.spaarpot : null,
      aangifte_van: rek(btw.aangifte_van), terugboeking_van: rek(btw.terugboeking_van) },
    gewijzigd: c.gewijzigd || null, door: c.door || null, revisie: Number.isInteger(c.revisie) ? c.revisie : 0 };
}
async function geldConfig(env) { return geldConfigNorm(await kvJson(env, 'geld:config')); }
// De BTW-pot: de ingestelde spaarpot, anders het (eerste) actieve potje met doel 'btw'.
const geldBtwPot = cfg => cfg.btw.spaarpot || ((cfg.potten.find(p => p.doel === 'btw' && !p.virtueel && p.actief) || {}).id) || null;
const geldRekeningen = cfg => ['lopend', ...cfg.potten.filter(p => !p.virtueel).map(p => p.id)];   // met eigen saldo (ijkbaar)
function geldVandaag() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function geldDag(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// Echte kalenderdatum (2026-02-31 wordt niet stil 3 maart).
const geldIsDatum = s => { s = String(s || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = Date.parse(s + 'T00:00:00Z'); return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };
const geldGetal = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const geldRond = n => Math.round(n * 100) / 100;
// Moneybird-webadressen: documenten en verkoopfacturen zoals de app ze al gebruikt; voor een bankmutatie is
// het formaat niet geverifieerd (bron_url_zeker:false).
const geldUrl = (soort, id) => `https://moneybird.com/${MB_ADMIN}/${soort}/${id}`;

// Moneybird-verzoeken met een vast budget (subrequest-limiet van de worker); elke fout wordt teruggegeven.
// Hooguit GELD_MB_TEGELIJK tegelijk (anders "429 Retry later" bij de eerste keer laden); bij 429 hooguit twee
// nieuwe pogingen, na Retry-After (max 8 s) of 1,5 s / 3 s — elke poging telt mee in het budget.
const GELD_MB_TEGELIJK = 3;
function geldMb(env, budget) {
  const hdr = { Authorization: `Bearer ${env.MONEYBIRD_KEY}`, Accept: 'application/json' };
  let bezig = 0; const rij = [];
  const slot = () => bezig < GELD_MB_TEGELIJK ? (bezig++, Promise.resolve()) : new Promise(res => rij.push(res));
  const vrij = () => { const n = rij.shift(); if (n) n(); else bezig--; };
  const haal = async pad => { try { return await fetch(`https://moneybird.com/api/v2/${MB_ADMIN}/${pad}`, { headers: hdr }); } catch (e) { return { netwerk: String(e.message || e).slice(0, 80) }; } };
  return async function get(pad) {
    if (budget.rest <= 0) return { ok: false, status: 0, fout: 'budget-op' };
    budget.rest--;
    await slot();
    let r;
    try {
      r = await haal(pad);
      for (let poging = 1; r.status === 429 && poging <= 2 && budget.rest > 0; poging++) {
        budget.rest--;                                               // eerst reserveren, dan wachten (anders kan een ander verzoek het restant opmaken)
        const ra = Number(r.headers && r.headers.get && r.headers.get('Retry-After'));
        await new Promise(res => setTimeout(res, ra > 0 ? Math.min(ra, 8) * 1000 : 1500 * poging));
        r = await haal(pad);
      }
    } finally { vrij(); }
    if (r.netwerk) return { ok: false, status: 0, fout: 'netwerk: ' + r.netwerk };
    if (r.status === 429) return { ok: false, status: 429, fout: 'Moneybird is even druk (429) — over een minuut opnieuw' };
    let data = null, tekst = '';
    try { tekst = await r.text(); data = JSON.parse(tekst); } catch {}
    if (!r.ok) return { ok: false, status: r.status, fout: (data && (data.error || data.message)) || tekst.slice(0, 120) || ('HTTP ' + r.status) };
    return { ok: true, status: r.status, data };
  };
}
// Lijst met paginering (per_page=100); dubbele id's eruit; fouten → waarschuwing + onvolledig.
async function geldLijst(get, pad, w, label) {
  const uit = [], gezien = new Set(); let page = 1, onvolledig = false;
  for (;;) {
    const r = await get(`${pad}${pad.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!r.ok) { w.push({ bron: label, fout: r.fout, status: r.status, pad: pad.split('?')[0] }); onvolledig = true; break; }
    if (!Array.isArray(r.data)) { w.push({ bron: label, fout: 'onverwacht antwoord (geen lijst)', pad: pad.split('?')[0] }); onvolledig = true; break; }
    const d = r.data;
    const nieuw = d.filter(x => x && x.id && !gezien.has(x.id));
    nieuw.forEach(x => gezien.add(x.id)); uit.push(...nieuw);
    if (d.length < 100 || !nieuw.length) break;
    if (++page > 20) { w.push({ bron: label, fout: 'meer dan 20 pagina\'s — afgebroken', pad: pad.split('?')[0] }); onvolledig = true; break; }
  }
  return { lijst: uit, onvolledig };
}
// Bankmutaties [van, tot] (inclusief): adaptief halveren bij "too many" of een volle pagina.
async function geldMutaties(get, van, tot, w) {
  const uit = new Map(); let onvolledig = false;
  // Ook bij een serverfout halveren (hooguit 3 niveaus, i.v.m. het budget): wat wél lukt komt binnen,
  // elk mislukt deel krijgt een eigen waarschuwing met zijn periode.
  const stuk = async (a, b, foutDiepte = 0) => {
    const r = await get(`financial_mutations?filter=period:${a.replace(/-/g, '')}..${b.replace(/-/g, '')},financial_account_id:${GELD.bank.account}&per_page=100&page=1`);
    if (r.ok && !Array.isArray(r.data)) { w.push({ bron: 'bankmutaties', fout: 'onverwacht antwoord (geen lijst)', periode: `${a}..${b}` }); onvolledig = true; return; }
    const vol = r.ok && r.data.length >= 100;
    const teVeel = !r.ok && r.status === 400 && /too many|sync api/i.test(String(r.fout || ''));
    const serverFout = !r.ok && (r.status >= 500 || r.status === 0 || r.status === 429) && r.fout !== 'budget-op' && foutDiepte < 3;   // geen 4xx-fouten herhalen
    if ((vol || teVeel || serverFout) && a < b) {
      const dagen = Math.round((Date.parse(b) - Date.parse(a)) / 864e5), mid = geldDag(a, Math.floor(dagen / 2)), d = serverFout ? foutDiepte + 1 : foutDiepte;
      await stuk(a, mid, d); await stuk(geldDag(mid, 1), b, d); return;
    }
    if (!r.ok) { w.push({ bron: 'bankmutaties', fout: teVeel ? 'te veel mutaties op één dag — mogelijk onvolledig' : r.fout, status: r.status, periode: `${a}..${b}` }); onvolledig = true; return; }
    if (vol) { w.push({ bron: 'bankmutaties', fout: '100 of meer mutaties op één dag — mogelijk onvolledig', periode: a }); onvolledig = true; }
    for (const m of r.data) if (m && m.id) uit.set(m.id, m);
  };
  if (van <= tot) await stuk(van, tot);
  return { lijst: [...uit.values()], onvolledig };
}
// Welke pot hoort bij deze bankmutatie? Op grootboek (alle boekingen op het pot-grootboek), of — alleen
// als de mutatie nergens anders op geboekt is en niet aan een factuur hangt — op tegenrekening/omschrijving.
// Meer dan één pot, of deels op een pot-grootboek → onzeker (melden, niet gokken).
function geldPotVan(m, potten) {
  const ids = (m.ledger_account_bookings || []).map(b => String(b.ledger_account_id));
  const potLedgers = new Set(potten.filter(p => p.ledger).map(p => p.ledger));
  const metFactuur = (m.payments || []).length > 0;      // hangt aan een factuur → nooit stil intern
  const vrij = !metFactuur && ids.every(id => potLedgers.has(id));
  const tekst = (String(m.message || '') + ' ' + String(m.contra_account_name || '')).toLowerCase();
  const tegen = String(m.contra_account_number || '').replace(/\s+/g, '').toUpperCase();
  // Zeker: grootboek of exacte tegenrekening. Alleen een omschrijving → "te bevestigen" (onzeker), want een
  // leveranciertekst kan toevallig overeenkomen en dan zou een echte uitgave als inleg verdwijnen.
  const zeker = potten.filter(p => p.actief && ((!metFactuur && p.ledger && ids.length && ids.every(id => id === p.ledger)) ||
    (vrij && p.herkenning.tegenrekening && tegen && tegen === p.herkenning.tegenrekening)));
  const viaTekst = potten.filter(p => p.actief && vrij && !zeker.includes(p) && p.herkenning.omschrijving && tekst.includes(p.herkenning.omschrijving.toLowerCase()));
  const deels = ids.some(id => potLedgers.has(id)) && !ids.every(id => potLedgers.has(id));
  const kandidaten = [...new Set([...zeker, ...viaTekst, ...(deels || metFactuur ? potten.filter(p => p.ledger && ids.includes(p.ledger)) : [])].map(p => p.id))];
  if (zeker.length === 1 && !deels && !viaTekst.length) return { pot: zeker[0].id, onzeker: false, kandidaten };
  return { pot: null, onzeker: kandidaten.length > 0, kandidaten, alleenTekst: !zeker.length && !deels && viaTekst.length > 0 };
}
function geldBankEvent(m, potten) {
  const bedrag = geldRond(geldGetal(m.amount)), sp = geldPotVan(m, potten), betaling = (m.payments || [])[0] || null;
  const ev = {
    id: 'bank:' + m.id, bron: 'bank', richting: bedrag >= 0 ? 'in' : 'uit', bedrag, datum: m.date, datumtype: 'werkelijk', zekerheid: 'werkelijk',
    rekening: 'lopend', tegenpartij: m.contra_account_name || '', iban: String(m.contra_account_number || '').replace(/\s+/g, '').toUpperCase() || undefined, document_id: betaling ? betaling.invoice_id : null,
    bron_url: geldUrl('financial_mutations', m.id), bron_url_zeker: false,
    uitleg: 'Bankmutatie (werkelijk afgeschreven/bijgeschreven op deze dag).',
  };
  if (betaling && betaling.invoice_id) ev.document_url = geldUrl(betaling.invoice_type === 'SalesInvoice' ? 'sales_invoices' : 'documents', betaling.invoice_id);
  if (sp.pot) { ev.intern = true; ev.pot = sp.pot; ev.uitleg = (bedrag < 0 ? 'Inleg in' : 'Opname uit') + ' spaarpot (interne overboeking: telt niet mee in "totaal").'; }
  else if (sp.onzeker) { ev.intern_onzeker = true; ev.pot_kandidaten = sp.kandidaten; ev.uitleg += sp.alleenTekst ? ' Omschrijving lijkt op een spaarpot — te bevestigen (stel de tegenrekening van de pot in).' : ' Mogelijk (deels) een overboeking naar een spaarpot — controleer.'; }
  else if (!(m.ledger_account_bookings || []).length && !(m.payments || []).length && /spaar/i.test(m.contra_account_name || '')) { ev.intern_vermoed = true; ev.uitleg += ' Lijkt een overboeking naar spaar, maar hoort bij geen ingestelde pot.'; }
  return ev;
}
// Open factuur → event op de vervaldag (betaaldag-logica volgt in G2). Achterstallig blijft staan; zonder
// vervaldag geen gok: zekerheid "invullen".
function geldFactuurEvent(soort, d, vandaag, w) {
  const verkoop = soort === 'verkoop';
  if (d.total_price_incl_tax_base == null && d.currency && d.currency !== 'EUR') w.push({ bron: soort + 'facturen', fout: 'factuur in ' + d.currency + ' zonder bedrag in euro — bedrag onzeker', document_id: d.id });
  const totaal = geldGetal(d.total_price_incl_tax_base != null ? d.total_price_incl_tax_base : d.total_price_incl_tax);
  const betaald = (d.payments || []).reduce((s, p) => s + geldGetal(p.price_base != null ? p.price_base : p.price), 0);
  const open = geldRond(verkoop ? (d.total_unpaid_base != null ? geldGetal(d.total_unpaid_base) : totaal - betaald) : totaal - betaald);
  const due = geldIsDatum(d.due_date) ? d.due_date : null;
  const c = d.contact || {};
  const ev = {
    id: (verkoop ? 'verkoop:' : 'inkoop:') + d.id, bron: soort, bedrag: open,
    richting: (verkoop ? open >= 0 : open < 0) ? 'in' : 'uit',
    datum: due, datumtype: due ? 'vervaldag' : 'onbekend', zekerheid: due ? 'vastgelegd' : 'invullen',
    rekening: 'lopend', tegenpartij: c.company_name || [c.firstname, c.lastname].filter(Boolean).join(' ') || '', iban: String(c.bank_account || '').replace(/\s+/g, '').toUpperCase() || undefined,
    document_id: d.id, bron_url: geldUrl(verkoop ? 'sales_invoices' : 'documents', d.id), bron_url_zeker: true,
    factuurdatum: (verkoop ? d.invoice_date : d.date) || null, referentie: d.reference || d.invoice_id || '', status: d.state,
    uitleg: due ? (verkoop ? 'Open verkoopfactuur op de vervaldag.' : 'Open inkoopfactuur op de vervaldag.') : 'Geen vervaldag in Moneybird — datum invullen.',
  };
  if (open < 0) ev.creditnota = true;
  // Al (deels) betaald via een andere rekening dan de betaalrekening (kas, privé): die betaling staat niet bij de bankmutaties.
  if ((d.payments || []).some(p => p.financial_account_id && String(p.financial_account_id) !== GELD.bank.account)) ev.betaald_buiten_bank = true;
  if (due && due < vandaag) { ev.achterstallig = true; ev.uitleg = (verkoop ? 'Vervallen verkoopfactuur' : 'Vervallen inkoopfactuur') + ' — nog niet betaald (blijft staan tot het betaald is).'; }
  if (!verkoop && d.state === 'new') { ev.ongeboekt = true; ev.zekerheid = 'invullen'; ev.uitleg = 'Nog niet geboekt in Moneybird — controleer bedrag en datum.'; }
  return ev;
}
async function geldFacturen(get, vandaag, w) {
  const jaar = Number(vandaag.slice(0, 4)), jaren = [];
  for (let j = jaar - GELD.jarenTerug; j <= jaar; j++) jaren.push(j);
  // Elk jaar apart (Moneybird geeft standaard alleen het huidige jaar) plus één vraag voor alles daarvóór,
  // zodat een oude open factuur nooit stil wegvalt.
  // Moneybird staat hooguit 10 jaar per vraag toe; deze administratie begint in 2022, dus 10 jaar vóór het venster volstaat.
  const perioden = [[`${jaren[0] - 10}0101..${jaren[0] - 1}1231`, `${jaren[0] - 10}-${jaren[0] - 1}`], ...jaren.map(j => [`${j}0101..${j}1231`, String(j)])];
  const [ink, ver] = await Promise.all([
    Promise.all(perioden.map(([p, l]) => geldLijst(get, `documents/purchase_invoices?filter=period:${p},state:open|late|pending_payment|new`, w, 'inkoopfacturen ' + l))),
    Promise.all(perioden.map(([p, l]) => geldLijst(get, `sales_invoices?filter=period:${p},state:open|late|reminded|pending_payment`, w, 'verkoopfacturen ' + l))),
  ]);
  const uniek = lijsten => { const m = new Map(); lijsten.forEach(l => l.lijst.forEach(x => m.set(x.id, x))); return [...m.values()]; };
  return { inkoop: uniek(ink), verkoop: uniek(ver), onvolledig: ink.some(l => l.onvolledig) || ver.some(l => l.onvolledig), jaren };
}
// Balans op het laatste maandeinde: bank-ledger en spaar-ledgers (veld `value`, cumulatief t/m periode-einde).
async function geldBalans(get, vandaag, w, potten) {
  const eersteDezeMaand = vandaag.slice(0, 8) + '01', maandeinde = geldDag(eersteDezeMaand, -1), begin = maandeinde.slice(0, 8) + '01';
  const r = await get(`reports/balance_sheet?period=${begin.replace(/-/g, '')}..${maandeinde.replace(/-/g, '')}`);
  if (!r.ok) { w.push({ bron: 'balans', fout: r.fout, status: r.status }); return { maandeinde, waarden: null }; }
  const treffers = {};
  const zoek = o => { if (Array.isArray(o)) o.forEach(zoek); else if (o && typeof o === 'object') {
    if (o.ledger_account_id && 'value' in o) (treffers[String(o.ledger_account_id)] = treffers[String(o.ledger_account_id)] || []).push(geldGetal(o.value));
    Object.values(o).forEach(v => { if (v && typeof v === 'object') zoek(v); }); } };
  zoek(r.data);
  // Alleen een eenduidige waarde gebruiken (dezelfde ledger als ouder én kind met andere bedragen → niet gokken).
  const waarden = {};
  for (const [id, vs] of Object.entries(treffers)) { if (vs.every(x => x === vs[0])) waarden[id] = vs[0]; else w.push({ bron: 'balans', fout: 'grootboek komt met verschillende bedragen in de balans voor — niet gebruikt', ledger: id }); }
  if (!(GELD.bank.ledger in waarden)) w.push({ bron: 'balans', fout: 'bankrekening niet (eenduidig) gevonden in de balans' });
  for (const p of potten) if (p.ledger && !(p.ledger in waarden)) w.push({ bron: 'balans', rekening: p.id, fout: 'grootboek van deze pot niet (eenduidig) gevonden in de balans' });
  return { maandeinde, waarden };
}
// IJkpunten: alleen toevoegen; nieuwste per rekening telt.
const GELD_IJK = 'geld:ijkpunt:';
// Sleutels zijn op omgekeerde tijd gesorteerd → de eerste per rekening is de nieuwste.
async function geldIjkpunten(env, perRekening, rekeningen, paginas = 1) {
  if (!env.MT_ROLLEN) return [];
  const uit = [], per = {}; let cursor, n = 0, losse = 0;
  do {                                                               // één list (met metadata) i.p.v. een get per ijkpunt
    const r = await env.MT_ROLLEN.list({ prefix: GELD_IJK, cursor });
    for (const k of r.keys) {
      const rek = k.name.slice(GELD_IJK.length).split(':')[0];
      if (!rekeningen.includes(rek) || (per[rek] = (per[rek] || 0) + 1) > perRekening) continue;
      if (!k.metadata && ++losse > 6) { uit.onvolledig = true; continue; }   // terugval zonder metadata begrensd (subrequests)
      const v = k.metadata || await kvJson(env, k.name); if (v) uit.push(v);
    }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor && ++n < paginas);
  if (cursor) uit.onvolledig = true;
  return uit.sort((a, b) => (b.ts - a.ts) || String(b.id).localeCompare(String(a.id)));
}
async function geldCacheVersie(env) { return (await kvJson(env, 'geld:cachever')) || '0'; }
// Nieuwe cacheversie (unieke tijdstempel) zetten én onthouden voor het antwoord (cachever), zodat de app die meteen kan
// meesturen: KV is per edge tot ~60 s achter, en dan zou een gewone load nog de oude cache geven.
async function geldZetVersie(env, versie, ctx) { await kvZet(env, 'geld:cachever', versie); if (ctx) ctx.versie = versie; }

// ── G2: betaaldag-logica, betaalprofiel en per-factuur overrides ──────────────
// Inkoop: override → incasso (leverancier die ons incasseert: op de vervaldag) → beleid "2 werkdagen vóór
//   de vervaldag" → zonder vervaldag "bij ontvangst" (factuurdatum, aanname). Vervallen → vandaag ingepland,
//   achterstallig:true. Nooit een betaaldag in het verleden voor iets dat nog open staat.
// Verkoop: override → vervaldag + gebruikelijke vertraging van die klant (≥3 betaalde facturen) → van zijn
//   groep (alleen een expliciete groep in de instellingen: prefix of contactlijst) → algemeen → vervaldag.
//   Marge p25–p75 als datum_vroeg/datum_laat. Creditnota's: op de vervaldag, zonder vertraging.
// Overrides: per factuur één KV-sleutel geld:ov:<soort>:<id> (waarde ook als metadata, zodat één list volstaat),
//   elke wijziging ook in geld:ov-historie:*. {type:'datum', datum} of {type:'afbetaling', bedrag, eerste,
//   interval:'maand'|'week', termijnen?} — afbetalingstermijnen tellen samen precies op tot het open bedrag.
// Betaalprofiel (KV geld:profiel): apart berekend via GET /geld/profiel (te veel verzoeken voor de tijdlijn);
//   alleen een volledige berekening wordt bewaard.
const GELD_PROFIEL_DAGEN = 7, GELD_PROFIEL_MAX = 31, GELD_PROFIEL_BUDGET = 40, GELD_OV = 'geld:ov:';
// Bankdag: geen weekend en geen NL-bankfeestdag (Nieuwjaar, Goede Vrijdag, Paasmaandag, Koningsdag, Hemelvaart,
// Pinkstermaandag, 1e en 2e Kerstdag). Banken boeken dan niet.
const _geldFeest = {};
function geldFeestdagen(j) {
  if (_geldFeest[j]) return _geldFeest[j];
  const a = j % 19, b = Math.floor(j / 100), c = j % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mnd = Math.floor((h + l - 7 * m + 114) / 31), dag = ((h + l - 7 * m + 114) % 31) + 1;
  const pasen = `${j}-${String(mnd).padStart(2, '0')}-${String(dag).padStart(2, '0')}`;
  const koning = new Date(Date.UTC(j, 3, 27)).getUTCDay() === 0 ? `${j}-04-26` : `${j}-04-27`;
  return (_geldFeest[j] = new Set([`${j}-01-01`, geldDag(pasen, -2), geldDag(pasen, 1), koning, geldDag(pasen, 39), geldDag(pasen, 50), `${j}-12-25`, `${j}-12-26`]));
}
const geldWerkdag = d => { const x = new Date(d + 'T00:00:00Z').getUTCDay(); return x !== 0 && x !== 6 && !geldFeestdagen(Number(d.slice(0, 4))).has(d); };
const geldBankdagNa = d => { let x = d; while (!geldWerkdag(x)) x = geldDag(x, 1); return x; };
const geldBankdagVoor = d => { let x = d; while (!geldWerkdag(x)) x = geldDag(x, -1); return x; };
function geldWerkdagenTerug(d, n) { let x = d, k = 0; while (k < n) { x = geldDag(x, -1); if (geldWerkdag(x)) k++; } return x; }
function geldPlusMaand(d, n) {                                // zelfde dag, of de laatste dag van een kortere maand
  const [j, m, dg] = d.split('-').map(Number), t = new Date(Date.UTC(j, m - 1 + n, 1)), laatste = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(dg, laatste))).toISOString().slice(0, 10);
}
const geldDagenTussen = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
function geldPct(a, q) { const s = a.slice().sort((x, y) => x - y); if (!s.length) return null; const k = (s.length - 1) * q, f = Math.floor(k), c = Math.min(f + 1, s.length - 1); return s[f] + (s[c] - s[f]) * (k - f); }
const geldStat = d => ({ n: d.length, mediaan: Math.round(geldPct(d, 0.5)), p25: Math.round(geldPct(d, 0.25)), p75: Math.round(geldPct(d, 0.75)) });
const geldContactNaam = c => (c && (c.company_name || [c.firstname, c.lastname].filter(Boolean).join(' '))) || '';
const geldIsIncasso = m => { const s = m && m.sepa_fields && typeof m.sepa_fields === 'object' ? m.sepa_fields : {};
  return 'marf' in s || String(s.sref || '').startsWith('DOMREC') || String(m && m.code || '') === '01018'; };
const geldInGroep = (g, cid, naam) => g.contact_ids.includes(String(cid)) || (!!g.prefix && String(naam || '').toLowerCase().startsWith(g.prefix.toLowerCase()));
function geldVerwachtVerkoop(d, profiel, cfg) {
  if (!profiel) return { basis: 'vervaldag', reden: 'geen bruikbaar betaalprofiel' };
  const k = profiel.klanten[String(d.contact_id)];
  if (k && k.d.length >= 3) return Object.assign({ basis: 'klant' }, geldStat(k.d));
  const gs = (cfg.klantgroepen || []).filter(g => geldInGroep(g, d.contact_id, geldContactNaam(d.contact)));
  let noot = '';
  if (gs.length > 1) noot = 'valt in meerdere klantgroepen (' + gs.map(g => g.naam).join(', ') + ') — groep niet gebruikt';   // niet kiezen
  else if (gs.length === 1) {
    const g = gs[0], ds = Object.entries(profiel.klanten).filter(([cid, x]) => geldInGroep(g, cid, x.naam)).flatMap(([, x]) => x.d);
    if (ds.length >= 3) return Object.assign({ basis: 'groep', groep: g.naam }, geldStat(ds));
  }
  if (profiel.algemeen && profiel.algemeen.n >= 3) return Object.assign({ basis: 'algemeen' }, profiel.algemeen, noot ? { noot } : {});
  return { basis: 'vervaldag', reden: noot || 'te weinig betaalhistorie' };
}
// Afbetaling: termijnen volgens het schema vanaf de eerste termijn op of na vandaag; samen precies het open bedrag.
// Bij een vast aantal termijnen: wat de resterende termijnen niet dragen (hooguit de gemiste termijnen) komt
// vandaag, als achterstallig; de rest van een te krap plan op de laatste termijn.
function geldTermijnen(basis, ov, vandaag) {
  const teken = basis.bedrag < 0 ? -1 : 1, per = Math.abs(ov.bedrag), wk = ov.interval === 'week';
  const stap = k => wk ? geldDag(ov.eerste, 7 * k) : geldPlusMaand(ov.eerste, k);
  const ev = (id, b, datum, extra) => { const e = Object.assign({}, basis, { id: `${basis.id}:${id}`, bedrag: geldRond(teken * b), datum, datumtype: 'override', zekerheid: 'gepland' }, extra);
    if (!extra.achterstallig) delete e.achterstallig; return e; };
  let k = Math.max(0, wk ? Math.floor(geldDagenTussen(ov.eerste, vandaag) / 7) - 1                      // k = verstreken termijnen (direct
    : (Number(vandaag.slice(0, 4)) - Number(ov.eerste.slice(0, 4))) * 12 + Number(vandaag.slice(5, 7)) - Number(ov.eerste.slice(5, 7)) - 1);   //  benaderd, dan exact)
  while (stap(k) < vandaag) k++;
  const nog = ov.termijnen ? ov.termijnen - k : Infinity;               // nog te komen termijnen
  const uit = []; let rest = Math.abs(basis.bedrag);
  if (k > 0 && nog !== Infinity) {
    const achter = nog <= 0 ? rest : Math.min(Math.max(0, rest - nog * per), k * per);
    if (achter > 0.004) { uit.push(ev('achter', achter, vandaag, { achterstallig: true, uitleg: `Afbetaling: ${nog <= 0 ? 'alle termijnen verstreken' : 'gemiste termijn(en)'} — nog open, vandaag ingepland.` })); rest = geldRond(rest - achter); }
  }
  for (let j = 0; rest > 0.004 && j < Math.min(nog, 240); j++) {
    const laatste = j === nog - 1, b = laatste ? rest : Math.min(per, rest), n = k + j + 1;
    uit.push(ev('t' + n, b, stap(k + j), { termijn: n, uitleg: `Afbetaling: termijn ${n}${ov.termijnen ? ' van ' + ov.termijnen : ''} (${wk ? 'wekelijks' : 'maandelijks'})${laatste && b > per + 0.004 ? ' — met restant' : ''}.` }));
    rest = geldRond(rest - b);
  }
  if (rest > 0.004) uit.push(ev('rest', rest, stap(k + Math.min(nog, 240)), { uitleg: 'Afbetaling: resterend bedrag (na 240 termijnen).' }));
  return uit;
}
// Eén open factuur → één of meer geplande events (G1-basis + betaaldag-logica).
function geldPlan(soort, d, basis, ctx) {
  const { vandaag, profiel, overrides, cfg } = ctx, sleutel = `${soort}:${d.id}`, ov = overrides[sleutel];
  const due = basis.datum, ev = Object.assign({}, basis, { vervaldag: due });
  const nooitVerleden = e => { if (e.datum && e.datum < vandaag) { e.datum = vandaag; e.uitleg += ' (nog open: vandaag ingepland)'; } return e; };
  if (ov) {
    ctx.gebruikt.add(sleutel);
    if (ov.type === 'afbetaling') return geldTermijnen(Object.assign(ev, { override: ov }), ov, vandaag);
    const e = Object.assign(ev, { datum: ov.datum, datumtype: 'override', zekerheid: 'gepland', override: ov, uitleg: 'Datum zelf ingesteld' + (ov.reden ? ': ' + ov.reden : '') + '.' });
    if (ov.datum < vandaag) e.achterstallig = true; else delete e.achterstallig;   // achterstallig t.o.v. de eigen afspraak
    return [nooitVerleden(e)];
  }
  if (soort === 'inkoop') {
    const inc = profiel && profiel.incasso && profiel.incasso[String(d.contact_id)];
    if (basis.bedrag < 0) return [nooitVerleden(Object.assign(ev, due ? {} : { datum: basis.factuurdatum || vandaag, datumtype: 'factuurdatum', zekerheid: ev.ongeboekt ? 'invullen' : 'aanname', uitleg: 'Creditnota zonder vervaldag: verrekenen bij ontvangst (aanname).' }))];
    if (inc) return [nooitVerleden(Object.assign(ev, { datum: due || basis.factuurdatum || vandaag, datumtype: 'incasso', zekerheid: ev.ongeboekt ? 'invullen' : 'gepland',
      uitleg: `Wordt geïncasseerd op de vervaldag (deze leverancier incasseerde ${inc.n}× in het afgelopen halfjaar).` }))];
    if (due && due < vandaag) return [Object.assign(ev, { datum: vandaag, datumtype: 'beleid', zekerheid: ev.ongeboekt ? 'invullen' : 'gepland', uitleg: `Vervallen op ${due} — nog te betalen (vandaag ingepland).` })];
    if (due) return [nooitVerleden(Object.assign(ev, { datum: geldWerkdagenTerug(due, 2), datumtype: 'beleid', zekerheid: ev.ongeboekt ? 'invullen' : 'gepland', uitleg: 'Betalen 2 werkdagen vóór de vervaldag (beleid).' }))];
    return [nooitVerleden(Object.assign(ev, { datum: basis.factuurdatum || vandaag, datumtype: 'beleid', zekerheid: ev.ongeboekt ? 'invullen' : 'aanname', uitleg: 'Geen vervaldag: betalen bij ontvangst (beleid).' }))];
  }
  // verkoop
  if (!due) return [ev];                                   // geen vervaldag: blijft "invullen" (geen gok)
  if (basis.bedrag < 0) return [nooitVerleden(Object.assign(ev, { uitleg: 'Creditnota: op de vervaldag.' }))];
  const v = geldVerwachtVerkoop(d, profiel, cfg);
  if (v.basis === 'vervaldag' && due < vandaag) {                 // achterstallig zonder betaalhistorie: over 2 bankdagen
    const d = geldBankdagNa(geldDag(geldBankdagNa(geldDag(vandaag, 1)), 1));
    return [Object.assign(ev, { datum: d, datumtype: 'beleid', zekerheid: 'aanname', verwacht: v, uitleg: `Achterstallig sinds ${due}; nog geen betaalhistorie (${v.reden || 'te weinig gegevens'}) → verwacht rond ${d}.` })];
  }
  if (v.basis === 'vervaldag') return [nooitVerleden(Object.assign(ev, { verwacht: v, uitleg: ev.uitleg + (v.reden ? ` (${v.reden})` : '') }))];
  const tekst = { klant: 'deze klant', groep: `groep ${v.groep}`, algemeen: 'alle klanten' }[v.basis];
  // Achterstallig en de gebruikelijke betaaldag is ook al voorbij: vandaag + (p75 − mediaan) dagen, minstens 2 bankdagen,
  // hooguit 30 dagen (geen "vandaag" meer: dat wordt het nooit). Het label achterstallig blijft.
  if (due < vandaag && geldDag(due, v.mediaan) < vandaag) {
    const min = geldBankdagNa(geldDag(geldBankdagNa(geldDag(vandaag, 1)), 1)), extra = Math.min(30, Math.max(0, v.p75 - v.mediaan));
    let d = geldBankdagNa(geldDag(vandaag, extra)); if (d < min) d = min;
    if (d > geldDag(vandaag, 30)) d = geldBankdagVoor(geldDag(vandaag, 30));   // 30 dagen is een harde grens (bankdag ervoor)
    return [Object.assign(ev, { datum: d, datumtype: 'beleid', zekerheid: 'aanname', verwacht: v, datum_vroeg: min, datum_laat: geldDag(vandaag, 30) < geldDag(d, Math.max(0, v.p75 - v.p25)) ? geldDag(vandaag, 30) : geldDag(d, Math.max(0, v.p75 - v.p25)),
      uitleg: `Achterstallig sinds ${due}; ${tekst} betaalt meestal ${v.mediaan} dag(en) na verval (n=${v.n}) → verwacht rond ${d}.${v.noot ? ' ' + v.noot + '.' : ''}` })];
  }
  const e = Object.assign(ev, { datum: geldDag(due, v.mediaan), datumtype: 'beleid', zekerheid: 'aanname', verwacht: v,
    datum_vroeg: geldDag(due, v.p25), datum_laat: geldDag(due, v.p75),
    uitleg: `Vervaldag ${v.mediaan >= 0 ? '+' : '−'} ${Math.abs(v.mediaan)} dag(en): zo betaalt ${tekst} meestal (n=${v.n}, marge ${v.p25} tot ${v.p75})${v.noot ? '; ' + v.noot : ''}.` });
  if (e.datum_vroeg < vandaag) e.datum_vroeg = vandaag;
  if (e.datum_laat < vandaag) e.datum_laat = vandaag;
  return [nooitVerleden(e)];
}
// Betaalprofiel berekenen: betaalde verkoopfacturen (2 jaar) → vertraging t.o.v. de vervaldag per klant;
// incasso-leveranciers uit de bankmutaties van het afgelopen halfjaar (gekoppeld aan inkoopfacturen).
async function geldProfielBereken(env) {
  const vandaag = geldVandaag(), w = [], budget = { rest: GELD_PROFIEL_BUDGET }, get = geldMb(env, budget), jaar = Number(vandaag.slice(0, 4));
  const vanaf = geldDag(vandaag, -730), halfjaar = geldDag(vandaag, -182);
  const [v1, v2, ink, muts] = await Promise.all([
    geldLijst(get, `sales_invoices?filter=period:${jaar - 1}0101..${jaar - 1}1231,state:paid`, w, 'betaalde verkoop ' + (jaar - 1)),
    geldLijst(get, `sales_invoices?filter=period:${jaar}0101..${jaar}1231,state:paid`, w, 'betaalde verkoop ' + jaar),
    geldLijst(get, `documents/purchase_invoices?filter=period:${geldDag(vandaag, -300).replace(/-/g, '')}..${vandaag.replace(/-/g, '')},state:paid`, w, 'betaalde inkoop'),
    geldMutaties(get, halfjaar, vandaag, w),
  ]);
  const klanten = {}, alle = [];
  for (const x of [...v1.lijst, ...v2.lijst]) {
    if (!geldIsDatum(x.due_date) || !(x.payments || []).length || geldGetal(x.total_price_incl_tax_base) <= 0) continue;
    const betaald = (x.payments || []).map(p => String(p.payment_date || '').slice(0, 10)).filter(geldIsDatum).sort().pop();
    if (!betaald || betaald < vanaf) continue;
    const delta = geldDagenTussen(x.due_date, betaald), cid = String(x.contact_id);
    (klanten[cid] = klanten[cid] || { naam: geldContactNaam(x.contact), d: [] }).d.push(delta); alle.push(delta);
  }
  for (const k of Object.values(klanten)) Object.assign(k, geldStat(k.d));
  const contactVan = new Map(ink.lijst.map(x => [String(x.id), x]));
  const incasso = {};
  for (const m of muts.lijst) {
    if (geldGetal(m.amount) >= 0 || !geldIsIncasso(m)) continue;
    for (const p of m.payments || []) { const doc = contactVan.get(String(p.invoice_id)); if (!doc) continue;
      const cid = String(doc.contact_id); (incasso[cid] = incasso[cid] || { naam: geldContactNaam(doc.contact), m: new Set() }).m.add(String(m.id)); }
  }
  for (const cid of Object.keys(incasso)) { const n = incasso[cid].m.size; if (n < 2) delete incasso[cid]; else incasso[cid] = { naam: incasso[cid].naam, n }; }   // pas vanaf 2 incasso's een patroon
  const facturen = [...v1.lijst, ...v2.lijst].filter(x => String(x.invoice_date || '') >= geldDag(vandaag, -400)).map(geldFactuurKort);
  return { as_of: new Date().toISOString(), vandaag, klanten, algemeen: alle.length ? geldStat(alle) : null, incasso, facturen,
    onvolledig: v1.onvolledig || v2.onvolledig || ink.onvolledig || muts.onvolledig || budget.rest <= 0, waarschuwingen: w, verzoeken: GELD_PROFIEL_BUDGET - budget.rest };
}
// Huidige overrides: één list (met metadata) i.p.v. een get per factuur.
async function geldOverrides(env, paginas) {
  const r = await geldKvLijst(env, GELD_OV, paginas);
  for (const s of Object.keys(r.items)) if (!r.items[s].type) delete r.items[s];
  return r;
}

// ── G3: vaste patronen, potjes-weekinleg, BTW-sparen en BTW-aangifte ─────────────
// Patronen (KV geld:patronen, apart berekend via GET /geld/patronen — 12 maanden mutaties is te veel voor de
//   tijdlijn): terugkerende betalingen buiten facturen om (loon, hypotheek, privé-opnames, verzekeringen) en
//   abonnementen met factuur. Automatisch doorgepland, per patroon uit te zetten (geld:pk:<id>). Een open
//   inkoopfactuur van dezelfde rekening met ongeveer hetzelfde bedrag rond die datum vervangt de patroonregel.
// Weekinleg: per actief potje met weekinleg een interne overboeking op de weekdag (instelling, anders uit de
//   bank afgeleid). BTW-sparen: percentage van elke verwachte ontvangst naar de BTW-pot (intern).
// BTW-aangifte: uit reports/tax (verkoop-btw − inkoop-btw), schatting ±10%, op de laatste dag van de maand
//   na het kwartaal; met terugboeking van de BTW-pot op dezelfde dag als zo ingesteld.
// Elk event krijgt `delta`: het effect op zijn rekening (+ = erbij). Intern (pot gezet): de pot krijgt −delta.
const GELD_PK = 'geld:pk:';
// Huidige stand per sleutel uit één list (waarde ook als metadata).
async function geldKvLijst(env, prefix, paginas = 1) {
  const items = {}; let cursor, n = 0;
  if (!env.MT_ROLLEN) return { items, compleet: true };
  do {
    const r = await env.MT_ROLLEN.list({ prefix, cursor });
    for (const k of r.keys) items[k.name.slice(prefix.length)] = k.metadata || await kvJson(env, k.name);
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor && ++n < paginas);
  for (const s of Object.keys(items)) if (!items[s]) delete items[s];
  return { items, compleet: !cursor };
}
// Vaste patronen herkennen uit bankmutaties (12 maanden). Per tegenpartij (IBAN, anders naam), richting en soort
// (los / betaling van een inkoopfactuur): wekelijks (≥ 6× in 8 weken, gelijk bedrag) of maandelijks: som per
// maand, in ≥ 5 van de laatste 6 hele maanden én in de vorige of deze maand; de maandgrens mag 15 dagen
// verschoven liggen (loon dat soms op de 30e, soms op de 2e komt). Bedrag = mediaan van de maandsommen (of van de laatste 3 als die
// stabiel zijn: een nieuw niveau).
function geldPatroonGroep(m) {
  const iban = String(m.contra_account_number || '').replace(/\s+/g, '').toUpperCase(), naam = String(m.contra_account_name || '').trim();
  const factuur = (m.payments || []).some(p => p.invoice_id);
  return iban || naam ? { sleutel: (iban || 'naam:' + naam.toLowerCase()) + (geldGetal(m.amount) < 0 ? ':uit' : ':in') + (factuur ? ':factuur' : ''), iban, naam, factuur } : null;
}
function geldPatroonVind(xs, vandaag) {
  const op = xs.slice().sort((a, b) => a.datum.localeCompare(b.datum)), mediaan = a => geldPct(a, 0.5);
  const recent = op.filter(x => x.datum > geldDag(vandaag, -56));
  if (recent.length >= 6) {                                          // wekelijks
    const tussen = recent.slice(1).map((x, i) => geldDagenTussen(recent[i].datum, x.datum)), b = recent.slice(-4).map(x => x.bedrag), med = mediaan(b);
    if (mediaan(tussen) >= 6 && mediaan(tussen) <= 8 && Math.max(...b) - Math.min(...b) <= med * 0.1) {
      const wd = recent.map(x => new Date(x.datum + 'T00:00:00Z').getUTCDay() || 7), modus = [1, 2, 3, 4, 5, 6, 7].sort((p, q) => wd.filter(v => v === q).length - wd.filter(v => v === p).length)[0];
      return { frequentie: 'week', weekdag: modus, bedrag: geldRond(med), min: geldRond(Math.min(...b)), max: geldRond(Math.max(...b)), n: recent.length, laatste: op[op.length - 1].datum, zekerheid: 'vast', ids: recent.slice(-6).map(x => x.id) };
    }
  }
  const nu = vandaag.slice(0, 7), mMin = (ym, n) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 - n, 1)).toISOString().slice(0, 7);
  let best = null;
  for (const s of [0, 15]) {                                         // maandgrens op de 1e, of 15 dagen later
    const per = {};
    for (const x of op) { const d = geldDag(x.datum, -s), k = d.slice(0, 7); const p = per[k] = per[k] || { som: 0, grootste: null };
      p.som += x.bedrag; if (!p.grootste || x.bedrag > p.grootste.bedrag) p.grootste = Object.assign({ dag: Number(d.slice(8, 10)) }, x); }
    const vorige = [1, 2, 3, 4, 5, 6].map(n => mMin(geldDag(vandaag, -s).slice(0, 7), n)), aanwezig = vorige.filter(k => per[k]);
    if (aanwezig.length < 5 || !(per[vorige[0]] || per[geldDag(vandaag, -s).slice(0, 7)])) continue;
    const dagen = aanwezig.map(k => per[k].grootste.dag), spreiding = geldPct(dagen, 0.75) - geldPct(dagen, 0.25);
    if (spreiding > 10) continue;
    const sommen = aanwezig.map(k => per[k].som), laatste3 = vorige.slice(0, 3).filter(k => per[k]).map(k => per[k].som), m3 = laatste3.length ? mediaan(laatste3) : 0, med = laatste3.length === 3 && laatste3.filter(x => Math.abs(x - m3) <= m3 * 0.1).length >= 2 ? m3 : mediaan(sommen);   // nieuw niveau (2 van de laatste 3), of mediaan van 6
    if (Math.max(...sommen) > med * 3 || Math.min(...sommen) < med / 3) continue;   // te wisselend om te plannen
    const wissel = (Math.max(...sommen) - Math.min(...sommen)) / med;
    if (!best || aanwezig.length > best.aanwezig.length || (aanwezig.length === best.aanwezig.length && wissel < best.wissel)) best = { s, per, aanwezig, dagen, sommen, laatste3, med, wissel };
  }
  if (!best) return null;
  const { s, per, aanwezig, dagen, sommen, laatste3, med } = best;
  const laatsteCyclus = Object.keys(per).sort().reverse().find(k => per[k].som >= med * 0.5) || null;   // laatste maand die al (grotendeels) betaald is
  return { frequentie: 'maand', dag: Math.round(mediaan(dagen)), verschuiving: s, bedrag: geldRond(med), min: geldRond(Math.min(...sommen)), max: geldRond(Math.max(...sommen)), n: aanwezig.length,
    laatste: op[op.length - 1].datum, laatste_cyclus: laatsteCyclus, zekerheid: Math.max(...laatste3) - Math.min(...laatste3) <= med * 0.05 ? 'vast' : 'schatting', ids: aanwezig.map(k => per[k].grootste.id) };
}
async function geldHash(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mt-geld:' + s)); return [...new Uint8Array(d)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join(''); }
async function geldPatronenBereken(env) {
  const vandaag = geldVandaag(), w = [], budget = { rest: GELD_PROFIEL_BUDGET }, get = geldMb(env, budget);
  let cfg; try { cfg = await geldConfig(env); } catch (e) { cfg = geldConfigNorm(null); }
  const muts = await geldMutaties(get, geldDag(vandaag, -365), vandaag, w);
  const groepen = {}, dagsom = {}, btw = [], potDag = {}, dagsomIntern = {}, maandUit = {}, rc = [], spaarRente = [], btwPot = geldBtwPot(cfg);
  for (const m of muts.lijst) {
    const bedrag = geldGetal(m.amount), pays = m.payments || [];
    dagsom[m.date] = geldRond((dagsom[m.date] || 0) + bedrag);
    const tekstRc = String(m.message || '');
    if (/RC AFREK/i.test(tekstRc)) {                              // rekening-courant: bereidstellingsprovisie en debetrente per maand
      const pm = tekstRc.match(/T\/M\s+\d{2}\.(\d{2})\.(\d{4})/i);
      rc.push({ datum: m.date, maand: pm ? `${pm[2]}-${pm[1]}` : m.date.slice(0, 7), soort: /DEBETRENTE/i.test(tekstRc) ? 'rente' : /PROVISIE/i.test(tekstRc) ? 'provisie' : 'overig', bedrag: geldRond(-bedrag) });
    }
    if (pays.some(p => p.invoice_type === 'VatDocument')) { btw.push({ datum: m.date, bedrag: geldRond(bedrag) }); continue; }
    const sp = geldPotVan(m, cfg.potten);
    if (bedrag < 0 && !(sp.pot && sp.pot === btwPot)) maandUit[m.date.slice(0, 7)] = geldRond((maandUit[m.date.slice(0, 7)] || 0) - bedrag);   // uitgaven (BTW-sparen telt niet)
    // rentebijschrijving vanaf een spaarpotje (herkend potje, binnenkomend, "rente"/"interest" in de omschrijving)
    if (sp.pot && bedrag > 0 && /\b(rente|interest)\b/i.test(`${m.message || ''} ${m.contra_account_name || ''}`)) spaarRente.push({ datum: m.date, pot: sp.pot, bedrag: geldRond(bedrag) });
    if (sp.pot) { const di = dagsomIntern[sp.pot] = dagsomIntern[sp.pot] || {}; di[m.date] = geldRond((di[m.date] || 0) + bedrag);
      if (m.date > geldDag(vandaag, -56)) (potDag[sp.pot] = potDag[sp.pot] || []).push(new Date(m.date + 'T00:00:00Z').getUTCDay() || 7); continue; }
    if (sp.onzeker || pays.some(p => p.invoice_type === 'SalesInvoice') || Math.abs(bedrag) < 5) continue;
    const g = geldPatroonGroep(m); if (!g) continue;
    const x = groepen[g.sleutel] = groepen[g.sleutel] || { g, xs: [], ledgers: new Set() };
    x.xs.push({ id: String(m.id), datum: m.date, bedrag: Math.abs(bedrag) });
    for (const b of m.ledger_account_bookings || []) if (b.ledger_account_id) x.ledgers.add(String(b.ledger_account_id));
  }
  // Eerst per rekening; wat geen patroon geeft opnieuw per naam (zelfde partij, nieuwe rekening — bv. Belastingdienst).
  const gevonden = [], rest = {};
  for (const x of Object.values(groepen)) { const p = geldPatroonVind(x.xs, vandaag);
    if (p) gevonden.push([x, p]); else if (x.g.iban && x.g.naam) { const k = 'naam:' + x.g.naam.toLowerCase() + x.g.sleutel.slice(x.g.iban.length); (rest[k] = rest[k] || []).push(x); } }
  for (const [k, l] of Object.entries(rest)) if (l.length > 1) {
    const x = { g: { sleutel: k, iban: l.map(y => y.g.iban).join(','), naam: l[0].g.naam, factuur: l[0].g.factuur }, xs: l.flatMap(y => y.xs), ledgers: new Set(l.flatMap(y => [...y.ledgers])) };
    const p = geldPatroonVind(x.xs, vandaag); if (p) gevonden.push([x, p]);
  }
  const patronen = [];
  for (const [x, p] of gevonden) patronen.push(Object.assign({ id: 'p' + await geldHash(x.g.sleutel), sleutel: x.g.sleutel, tegenpartij: x.g.naam, iban: x.g.iban,
    richting: x.g.sleutel.includes(':uit') ? 'uit' : 'in', factuur: x.g.factuur, ledgers: [...x.ledgers].slice(0, 10) }, p));
  const pot_weekdag = {};
  for (const [pot, wd] of Object.entries(potDag)) { const t = {}; for (const d of wd) t[d] = (t[d] || 0) + 1; const [dag, n] = Object.entries(t).sort((a, b) => b[1] - a[1])[0]; if (n >= 3) pot_weekdag[pot] = Number(dag); }
  return { as_of: new Date().toISOString(), vandaag, patronen: patronen.sort((a, b) => b.bedrag - a.bedrag), dagsom, dagsom_intern: dagsomIntern, maand_uit: maandUit, rc_afrek: rc, spaar_rente: spaarRente, btw_betalingen: btw, pot_weekdag,
    onvolledig: muts.onvolledig || budget.rest <= 0, waarschuwingen: w, verzoeken: GELD_PROFIEL_BUDGET - budget.rest };
}
const geldMaandLengte = ym => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const geldMaandPlus = (ym, n) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
// Geplande voorkomens van één patroon binnen [vandaag, tot]. Al gebeurd in deze cyclus (bank) → overslaan;
// een open inkoopfactuur (uit) van dezelfde rekening — het hele open bedrag ±15%, eerste betaaldag ±20 dagen —
// vervangt één voorkomen (de factuur telt). ctx.inkoop = [{id, iban, naam, open, datum}].
function geldPatroonEvents(p, ctx) {
  const { vandaag, tot, bank, inkoop } = ctx, uit = [], ibans = String(p.iban || '').split(',').filter(Boolean);
  const zelfde = e => (e.iban && ibans.includes(e.iban)) || (!ibans.length && e.tegenpartij && e.tegenpartij.toLowerCase() === String(p.tegenpartij).toLowerCase());
  const gebeurd = bank.filter(e => zelfde(e) && (e.richting === p.richting) && Math.abs(e.bedrag) >= 5);
  const marge = p.zekerheid === 'vast' ? null : { min: p.min, max: p.max };
  const naam = String(p.tegenpartij || '').toLowerCase(), benut = ctx.benut = ctx.benut || new Set();   // gedeeld: één factuur vervangt hooguit één voorkomen, over alle patronen
  const factuurDekt = d => {
    if (p.richting !== 'uit') return false;
    const f = inkoop.find(f => !benut.has(f.id) && (ibans.length ? f.iban && ibans.includes(f.iban) : !f.iban && f.naam && f.naam.toLowerCase() === naam)
      && f.datum && Math.abs(geldDagenTussen(f.datum, d)) <= 20 && Math.abs(f.open - p.bedrag) <= p.bedrag * 0.15);
    if (f) benut.add(f.id);
    return !!f;
  };
  const voeg = (d, tekst) => {
    if (d > tot) return;
    if (factuurDekt(d)) { ctx.vervangen++; return; }
    // Afbetaling van een factuur van dezelfde partij die op dit voorkomen lijkt: niet onderdrukken, wel melden.
    const tm = (ctx.termijnen || []).find(t => p.richting === 'uit' && t.iban && ibans.includes(t.iban) && Math.abs(geldDagenTussen(t.datum, d)) <= 20 && Math.abs(t.bedrag - p.bedrag) <= p.bedrag * 0.15);
    if (tm) (ctx.mogelijkDubbel = ctx.mogelijkDubbel || new Map()).set(p.id, { patroon: p.tegenpartij, factuur: tm.document_id });
    uit.push({ id: `patroon:${p.id}:${d}`, bron: 'patroon', richting: p.richting, bedrag: p.bedrag, datum: d, datumtype: 'patroon', zekerheid: 'patroon', rekening: 'lopend',
      tegenpartij: p.tegenpartij, document_id: null, bron_url: null, patroon_id: p.id, marge,
      uitleg: `Vast patroon: ${tekst} (gezien in ${p.n} van de laatste ${p.frequentie === 'week' ? '8 weken' : '6 maanden'}), ${marge ? `bedrag wisselt (${p.min} tot ${p.max}; mediaan gebruikt)` : 'vast bedrag'}.${p.factuur ? ' Komt de factuur binnen, dan telt die in plaats van deze regel.' : ''}` });
  };
  if (p.frequentie === 'week') {
    const dagen = ['', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
    let d = vandaag; while ((new Date(d + 'T00:00:00Z').getUTCDay() || 7) !== p.weekdag) d = geldDag(d, 1);
    for (; d <= tot; d = geldDag(d, 7)) if (!gebeurd.some(e => e.datum > geldDag(d, -7) && e.datum <= d) && !(p.laatste > geldDag(d, -7))) voeg(d, 'elke ' + dagen[p.weekdag]);
    return uit;
  }
  const s = p.verschuiving || 0, start = geldDag(vandaag, -s).slice(0, 7);
  for (let i = 0; i < 15; i++) {
    const ym = geldMaandPlus(start, i), d = geldDag(`${ym}-${String(Math.min(p.dag, geldMaandLengte(ym))).padStart(2, '0')}`, s);
    if (d > tot) break;
    const cyclus = e => geldDag(e.datum, -s).slice(0, 7) === ym;
    const bankSom = gebeurd.filter(cyclus).reduce((a, e) => a + Math.abs(e.bedrag), 0);
    if (bankSom >= p.bedrag * 0.5 || (p.laatste_cyclus && p.laatste_cyclus >= ym)) continue;   // deze cyclus al (grotendeels) betaald
    if (d < geldDag(vandaag, -10)) continue;                       // ruim voorbij en niet gezien: niet alsnog inplannen
    voeg(d < vandaag ? vandaag : d, `elke maand rond de ${geldDag(`${ym}-${String(Math.min(p.dag, geldMaandLengte(ym))).padStart(2, '0')}`, s).slice(8, 10).replace(/^0/, '')}e`);
  }
  return uit;
}
// Weekinleg potjes: interne overboeking lopend → pot op de weekdag.
function geldInlegEvents(cfg, patronen, ctx, w) {
  const { vandaag, tot, bank } = ctx, uit = [], dagen = ['', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
  for (const p of cfg.potten) {
    if (!p.actief || p.virtueel || !(p.weekinleg > 0)) continue;
    const wd = p.weekdag || (patronen && patronen.pot_weekdag && patronen.pot_weekdag[p.id]) || null;
    if (!wd) { w.push({ bron: 'config', rekening: p.id, fout: `weekdag van de inleg in "${p.naam}" onbekend — stel hem in (nu niet ingepland)` }); continue; }
    let d = vandaag; while ((new Date(d + 'T00:00:00Z').getUTCDay() || 7) !== wd) d = geldDag(d, 1);
    for (; d <= tot; d = geldDag(d, 7)) {
      if (bank.some(e => e.pot === p.id && e.delta < 0 && e.datum > geldDag(d, -7) && e.datum <= d)) continue;   // deze week al ingelegd
      uit.push({ id: `inleg:${p.id}:${d}`, bron: 'inleg', richting: 'uit', bedrag: p.weekinleg, datum: d, datumtype: 'gepland', zekerheid: 'gepland', rekening: 'lopend', intern: true, pot: p.id,
        tegenpartij: p.naam, document_id: null, bron_url: null, uitleg: `Weekinleg in "${p.naam}" (elke ${dagen[wd]}${p.weekdag ? '' : ', afgeleid uit de bank'}): interne overboeking, telt niet mee in "totaal".` });
    }
  }
  return uit;
}
// BTW-sparen: deel van elke verwachte omzet-ontvangst (verkoopfacturen, termijnen, prognose) naar de BTW-pot, zelfde dag.
function geldBtwSparen(events, cfg) {
  const pct = cfg.btw.spaarpercentage, pot = cfg.btw.spaarpot;
  if (!(pct > 0) || !pot) return [];
  return events.filter(e => e.datum && e.richting === 'in' && e.delta > 0 && !e.intern && ['verkoop', 'prognose'].includes(e.bron)).map(e => ({
    id: 'btw-sparen:' + e.id, bron: 'btw-sparen', richting: 'uit', bedrag: geldRond(e.delta * pct), datum: e.datum, datumtype: e.datumtype, zekerheid: e.zekerheid, rekening: 'lopend', intern: true, pot,
    tegenpartij: '', document_id: null, bron_url: null, van_event: e.id, uitleg: `BTW-sparen: ${Math.round(pct * 10000) / 100}% van deze ontvangst gaat naar de BTW-pot (interne overboeking).` }));
}
const geldKwartaal = d => { const j = Number(d.slice(0, 4)), q = Math.floor((Number(d.slice(5, 7)) - 1) / 3); return { j, q: q + 1, van: `${j}-${String(q * 3 + 1).padStart(2, '0')}-01`, tot: new Date(Date.UTC(j, q * 3 + 3, 0)).toISOString().slice(0, 10) }; };
async function geldBtwAangifte(get, vandaag, cfg, betalingen, w) {
  const nu = geldKwartaal(vandaag), vorig = geldKwartaal(geldDag(nu.van, -1)), uit = [];
  for (const [k, loopt] of [[vorig, false], [nu, true]]) {
    const vervalt = new Date(Date.UTC(Number(k.tot.slice(0, 4)), Number(k.tot.slice(5, 7)) + 1, 0)).toISOString().slice(0, 10);
    const r = await get(`reports/tax?period=${k.van.replace(/-/g, '')}..${k.tot.replace(/-/g, '')}`);
    if (!r.ok || !r.data || !Array.isArray(r.data.tax_rates)) { w.push({ bron: 'btw', fout: `BTW-overzicht ${k.j}-K${k.q} niet op te halen — aangifte niet ingepland`, status: r.status }); continue; }
    const som = t => r.data.tax_rates.filter(x => x.type === t).reduce((a, x) => a + geldGetal(x.tax), 0);
    let bedrag = geldRond(som('sales_invoice') - som('purchase_invoice')), deel = false;
    if (bedrag === 0) continue;
    if (!loopt) {                                                          // al betaald? alleen een BTW-betaling binnen het venster die bij de schatting past
      const kand = betalingen.filter(b => b.datum > k.tot && b.datum <= geldDag(vervalt, 60) && (bedrag > 0 ? b.bedrag < 0 : b.bedrag > 0));
      const betaald = geldRond(kand.reduce((a, b) => a + Math.abs(b.bedrag), 0));
      if (betaald > 0) {                                                   // betalingen opgeteld; restant (buiten de ±10%-schatting) blijft staan
        const rest = geldRond(Math.abs(bedrag) - betaald);
        if (rest <= Math.max(Math.abs(bedrag) * 0.1, 100)) continue;
        w.push({ bron: 'btw', fout: `BTW-betaling na ${k.j}-K${k.q} gezien die lager is dan de schatting — het restant is ingepland, controleer` });
        bedrag = (bedrag > 0 ? 1 : -1) * rest; deel = true;
      }
    }
    const apart = cfg.btw.modus === 'apart', datum = vervalt < vandaag ? vandaag : vervalt, rek = apart ? (cfg.btw.aangifte_van || 'lopend') : 'lopend', id = `btw:${k.j}-K${k.q}`;
    const marge = { min: geldRond(bedrag * 0.9), max: geldRond(bedrag * 1.1) };
    const ev = { id, bron: 'btw', richting: bedrag > 0 ? 'uit' : 'in', bedrag: Math.abs(bedrag), datum, datumtype: 'aangifte', zekerheid: 'schatting', rekening: rek, tegenpartij: 'Belastingdienst',
      document_id: null, bron_url: null, kwartaal: `${k.j}-K${k.q}`, marge,
      uitleg: `BTW-aangifte ${k.j} kwartaal ${k.q}: verkoop-btw min inkoop-btw uit Moneybird, schatting ±10%${deel ? ' — restant na een eerdere (deel)betaling' : ''}${loopt ? ' — het kwartaal loopt nog, dit is de stand tot nu toe en loopt nog op' : ''}${vervalt < vandaag ? ` — uiterste betaaldatum ${vervalt} is voorbij en er is geen betaling gezien` : ''}.` };
    if (vervalt < vandaag) ev.achterstallig = true;
    if (apart && !cfg.btw.aangifte_van) w.push({ bron: 'config', fout: 'BTW-instellingen: van welke rekening de aangifte betaald wordt is niet ingesteld — lopende rekening aangenomen' });
    if (!apart) ev.uitleg += ' Betaald van de lopende rekening; de BTW-pot telt daar al in mee.';
    uit.push(ev);
    const terug = apart ? cfg.btw.terugboeking_van : null;   // in_lopend: geen terugboeking (de BTW-pot hoort al bij lopend)
    if (bedrag > 0 && rek === 'lopend' && terug && terug !== 'lopend') uit.push(Object.assign({}, ev, { id: id + ':terug', richting: 'in', rekening: 'lopend', intern: true, pot: terug, tegenpartij: '',
      uitleg: `Terugboeking van de BTW-pot op dezelfde dag als de aangifte (lopende rekening netto 0, de BTW-pot daalt).` }));
  }
  return uit;
}

// ── G5: prognose (projecten die zeker doorgaan + handmatige posten) ───────────────
// Per post één KV-sleutel geld:prognose:<p:project_id | h:id> (waarde ook als metadata). Een project heeft een
// totaal (incl. btw) in termijnen met elk een factuurdatum; de verwachte ontvangst = factuurdatum + betaaltermijn
// + gebruikelijke vertraging van de klant (betaalprofiel). Echte verkoopfacturen vervangen termijnen: zeker bij
// dezelfde offerte (original_estimate_id), bij hetzelfde contact met het offertenummer in de referentie, of door de
// eigenaar bevestigd; wat al gefactureerd is gaat van de termijnen af (oudste eerst) — nooit dubbel. Andere facturen
// van hetzelfde contact komen als vraag op de lijst (niet afgetrokken tot de eigenaar kiest).
const GELD_PROG = 'geld:prognose:';
function geldPrognoseNorm(sleutel, x, vandaag) {
  const fout = t => ({ fout: t });
  if (!x || typeof x !== 'object') return fout('item ontbreekt');
  const bedrag = v => typeof v === 'number' && isFinite(v) && v >= 0.01 && v < 1e8 ? geldRond(v) : null;
  const binnen = d => geldIsDatum(d) && d >= geldDag(vandaag, -730) && d <= geldDag(vandaag, 3 * 366);
  const tekst = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const ids = (v, n) => [...new Set((Array.isArray(v) ? v : []).map(String).filter(s => /^[a-z0-9]{1,30}$/i.test(s)))].slice(0, n);
  if (sleutel.startsWith('h:')) {
    if (!['in', 'uit'].includes(x.richting)) return fout("richting: 'in' of 'uit'");
    if (bedrag(x.bedrag) == null) return fout('bedrag: getal ≥ 0,01');
    if (!binnen(x.datum)) return fout('datum ontbreekt of ligt te ver weg');
    return { item: { soort: 'post', omschrijving: tekst(x.omschrijving, 60) || 'Handmatige post', richting: x.richting, bedrag: bedrag(x.bedrag), datum: x.datum, aan: x.aan !== false } };
  }
  const totaal = bedrag(x.totaal);
  if (totaal == null) return fout('totaal (incl. btw): getal ≥ 0,01');
  const tm = Array.isArray(x.termijnen) ? x.termijnen : [];
  if (!tm.length || tm.length > 6) return fout('1 tot 6 termijnen');
  const termijnen = [];
  for (const [i, t] of tm.entries()) {
    if (!t || bedrag(t.bedrag) == null || !binnen(t.factuurdatum)) return fout(`termijn ${i + 1}: bedrag en factuurdatum nodig`);
    termijnen.push({ id: /^t\d{1,2}$/.test(t.id) ? t.id : 't' + (i + 1), label: tekst(t.label, 24) || 'termijn ' + (i + 1), bedrag: bedrag(t.bedrag), factuurdatum: t.factuurdatum, aan: t.aan !== false });
  }
  if (new Set(termijnen.map(t => t.id)).size !== termijnen.length) return fout('termijn-id dubbel');
  if (Math.abs(termijnen.reduce((a, t) => a + t.bedrag, 0) - totaal) > 0.01) return fout('de termijnen tellen niet op tot het totaal');
  const bt = Number.isInteger(x.betaaltermijn) && x.betaaltermijn >= 0 && x.betaaltermijn <= 120 ? x.betaaltermijn : 14;
  return { item: { soort: 'project', naam: tekst(x.naam, 60), contact_id: /^\d{6,25}$/.test(String(x.contact_id || '')) ? String(x.contact_id) : null,
    estimate_id: /^\d{6,25}$/.test(String(x.estimate_id || '')) ? String(x.estimate_id) : null, offertenr: tekst(x.offertenr, 24), code: tekst(x.code, 30),
    totaal, termijnen, betaaltermijn: bt, aan: x.aan !== false, k: ids(x.k, 10), x: ids(x.x, 20) } };
}
// Facturen voor de koppeling: open (tijdlijn) + recent betaald (profiel + laatste 60 dagen).
function geldFactuurKort(x) {
  return { id: String(x.id), contact_id: String(x.contact_id || ''), datum: x.invoice_date || null, bedrag: geldRond(geldGetal(x.total_price_incl_tax_base != null ? x.total_price_incl_tax_base : x.total_price_incl_tax)),
    ref: String(x.reference || '').slice(0, 80), estimate_id: x.original_estimate_id ? String(x.original_estimate_id) : null, nummer: x.invoice_id || '',
    orig: x.original_sales_invoice_id ? String(x.original_sales_invoice_id) : null };   // creditnota → oorspronkelijke factuur
}
function geldPrognoseEvents(items, facturen, ctx, w) {
  const { vandaag, profiel, cfg } = ctx, uit = [], overzicht = [];
  const zeker = (it, f) => !it.x.includes(f.id) && (it.k.includes(f.id) || (it.estimate_id && f.estimate_id === it.estimate_id)
    || (it.contact_id && f.contact_id === it.contact_id && it.offertenr.length >= 4 && f.ref.toLowerCase().includes(it.offertenr.toLowerCase())));
  const lijst = Object.entries(items).sort(([a], [b]) => a.localeCompare(b));
  // Toewijzing per factuur: door de eigenaar bevestigd bij precies één project, of zeker bij precies één project.
  // Past hij bij meerdere projecten → niet automatisch afboeken, maar vragen (nooit dubbel, nooit stil).
  // Een creditnota volgt de oorspronkelijke factuur.
  const projecten = lijst.filter(([, it]) => it.soort === 'project'), toe = new Map(), meer = new Map();
  for (const f of facturen.slice().sort((a, b) => (a.orig ? 1 : 0) - (b.orig ? 1 : 0))) {
    if (f.orig && toe.has(f.orig)) { toe.set(f.id, toe.get(f.orig)); continue; }
    const bev = projecten.filter(([, it]) => it.k.includes(f.id)).map(([sl]) => sl), kand = projecten.filter(([, it]) => zeker(it, f)).map(([sl]) => sl);
    if (bev.length === 1) toe.set(f.id, bev[0]);
    else if (!bev.length && kand.length === 1) toe.set(f.id, kand[0]);
    else if (bev.length > 1 || kand.length > 1) { meer.set(f.id, [...new Set(bev.concat(kand))]); w.push({ bron: 'prognose', fout: `factuur ${f.nummer || f.id} past bij meerdere prognoseprojecten — bevestig bij welk project hij hoort (nu bij geen enkel afgetrokken)` }); }
  }
  for (const [sleutel, it] of lijst) {
    if (it.soort === 'post') {
      const ov = { sleutel, soort: 'post', omschrijving: it.omschrijving, aan: it.aan };
      overzicht.push(ov);
      if (!it.aan) continue;
      if (it.datum < vandaag) w.push({ bron: 'prognose', fout: `handmatige post "${it.omschrijving}": datum ${it.datum} is voorbij — klopt hij nog? (vandaag ingepland)` });
      uit.push({ id: `prognose:${sleutel}`, bron: 'prognose', richting: it.richting, bedrag: it.bedrag, datum: it.datum < vandaag ? vandaag : it.datum, datumtype: 'prognose', zekerheid: 'prognose', rekening: 'lopend',
        tegenpartij: it.omschrijving, document_id: null, bron_url: null, prognose: sleutel, uitleg: 'Handmatige post (prognose): zelf ingevuld, telt alleen mee als de prognose aan staat.' });
      continue;
    }
    const mijn = facturen.filter(f => toe.get(f.id) === sleutel);
    const gefactureerd = geldRond(mijn.reduce((a, f) => a + f.bedrag, 0));   // creditnota's (negatief) tellen terug
    const vragen = facturen.filter(f => !it.x.includes(f.id) && f.bedrag > 0 && !toe.has(f.id) && ((meer.get(f.id) || []).includes(sleutel) || (!meer.has(f.id) && it.contact_id && f.contact_id === it.contact_id)))
      .map(f => ({ id: f.id, nummer: f.nummer, datum: f.datum, bedrag: f.bedrag, ref: f.ref, meerdere: meer.has(f.id) || undefined }));
    const ov = { sleutel, soort: 'project', naam: it.naam, code: it.code, aan: it.aan, totaal: it.totaal, gefactureerd, facturen: mijn.map(f => f.id), vragen, termijnen: [] };
    overzicht.push(ov);
    if (!it.aan) continue;
    const v = geldVerwachtVerkoop({ contact_id: it.contact_id, contact: { company_name: it.naam } }, profiel, cfg), vertraging = v.basis !== 'vervaldag' ? v.mediaan : 0;
    let rest = gefactureerd;
    for (const t of it.termijnen.slice().sort((a, b) => a.factuurdatum.localeCompare(b.factuurdatum) || a.id.localeCompare(b.id))) {
      const dekking = Math.min(t.bedrag, Math.max(0, rest)); rest = geldRond(rest - dekking);
      const over = geldRond(t.bedrag - dekking);
      ov.termijnen.push({ id: t.id, label: t.label, bedrag: t.bedrag, gefactureerd: geldRond(dekking), open: over, factuurdatum: t.factuurdatum, aan: t.aan });
      if (!t.aan || over <= 0.004) continue;
      const fd = t.factuurdatum < vandaag ? vandaag : t.factuurdatum;
      if (t.factuurdatum < vandaag) w.push({ bron: 'prognose', fout: `${it.naam || it.code}: ${t.label} had op ${t.factuurdatum} gefactureerd moeten worden en er is nog geen factuur gezien` });
      let ontvangst = geldDag(fd, it.betaaltermijn + vertraging); if (ontvangst < vandaag) ontvangst = vandaag;
      uit.push({ id: `prognose:${sleutel}:${t.id}`, bron: 'prognose', richting: 'in', bedrag: over, datum: ontvangst, factuurdatum: fd, ontvangst_na: geldDagenTussen(fd, ontvangst),
        datumtype: 'prognose', zekerheid: 'prognose', rekening: 'lopend', tegenpartij: `${it.naam || it.code} — ${t.label}`, document_id: null, bron_url: null, prognose: sleutel, termijn_id: t.id,
        uitleg: `Prognose (gaat zeker door, nog geen factuur): factureren op ${fd}, betaaltermijn ${it.betaaltermijn} dagen${vertraging ? ` + ${vertraging} dag(en) zoals ${v.basis === 'klant' ? 'deze klant' : v.basis === 'groep' ? 'de groep' : 'klanten'} meestal later betalen` : ''}.${dekking > 0 ? ` Al gefactureerd van deze termijn: ${dekking}.` : ''} Komt de echte factuur, dan vervangt die deze regel.` });
    }
    if (rest > 0.004) w.push({ bron: 'prognose', fout: `${it.naam || it.code}: er is meer gefactureerd dan het prognosetotaal — controleer het totaal` });
  }
  return { events: uit, overzicht };
}

async function geldTijdlijn(env, url, hint) {
  const ks = (hint && hint.ks) || [], ksWaarde = {};
  const ksFout = [];
  for (const k of ks) {                                         // direct gelezen (list loopt achter); leesfout ≠ verwijderd
    if (!env.MT_ROLLEN) break;
    try { const raw = await env.MT_ROLLEN.get('geld:' + k); ksWaarde[k] = raw ? JSON.parse(raw) : null; } catch (e) { ksFout.push(k); }
  }
  const vandaag = geldVandaag(), w = [], budget = { rest: GELD.budget };   // + GELD.kvReserve voor KV (cache, ijkpunten)
  if (ksFout.length) w.push({ bron: 'opslag', fout: 'een net opgeslagen wijziging kon niet direct gelezen worden — over een minuut opnieuw laden' });
  let van = url.searchParams.get('van') || geldDag(vandaag, -30), tot = url.searchParams.get('tot') || geldDag(vandaag, 90);
  if (!geldIsDatum(van) || !geldIsDatum(tot) || van > tot) return { status: 400, body: { error: 'ongeldige periode (van/tot = JJJJ-MM-DD, van ≤ tot)' } };
  if ((Date.parse(tot) - Date.parse(van)) / 864e5 > GELD.maxDagen) return { status: 400, body: { error: `periode te lang (max ${GELD.maxDagen} dagen)` } };
  const get = geldMb(env, budget);
  let cfg;
  try { cfg = await geldConfig(env); } catch (e) { cfg = geldConfigNorm(null); w.push({ bron: 'config', fout: 'instellingen niet te lezen (opslag)' }); }
  const potten = cfg.potten.filter(p => !p.virtueel);   // inactief = alleen niet meer herkennen; het saldo telt wel mee. Virtueel = geen eigen rekening.
  if (!potten.length) w.push({ bron: 'config', fout: 'nog geen spaarpotten ingesteld — overboekingen naar spaar worden niet herkend' });
  let ijk = [];
  try { ijk = await geldIjkpunten(env, 1, geldRekeningen(cfg)); if (ijk.onvolledig) w.push({ bron: 'ijkpunt', fout: 'niet alle ijkpunten gelezen (te veel) — oudere stand mogelijk' }); }
  catch (e) { w.push({ bron: 'ijkpunt', fout: 'ijkpunten niet te lezen (opslag) — Moneybird-stand gebruikt' }); }
  for (const [k, x] of Object.entries(ksWaarde)) if (k.startsWith('ijkpunt:') && x && x.id && !ijk.some(i => i.id === x.id)) ijk.push(x);   // net ingevuld
  ijk.sort((a, b) => (b.ts - a.ts) || String(b.id).localeCompare(String(a.id)));
  const laatsteIjk = {};
  for (const i of ijk) if (!laatsteIjk[i.rekening]) laatsteIjk[i.rekening] = i;
  let profiel = null, overrides = { items: {}, compleet: false }, prognose = { items: {}, compleet: false }, profielRuw = null;
  try { profiel = profielRuw = await kvJson(env, 'geld:profiel'); overrides = await geldOverrides(env); prognose = await geldKvLijst(env, GELD_PROG); }
  catch (e) { w.push({ bron: 'overrides', fout: 'eigen betaaldata/afbetalingen niet te lezen (opslag) — facturen volgens het beleid ingepland' }); }
  for (const [k, x] of Object.entries(ksWaarde)) {
    if (k.startsWith('ov:')) { if (x && x.type) overrides.items[k.slice(3)] = x; else delete overrides.items[k.slice(3)]; }
    else if (k.startsWith('prognose:')) { if (x) prognose.items[k.slice(9)] = x; else delete prognose.items[k.slice(9)]; }
  }
  if (!overrides.compleet && !w.some(x => x.bron === 'overrides')) w.push({ bron: 'overrides', fout: 'niet alle eigen betaaldata/afbetalingen gelezen' });
  const profielDagen = profiel ? geldDagenTussen(String(profiel.vandaag || '2000-01-01'), vandaag) : null;
  if (!profiel) w.push({ bron: 'profiel', fout: 'betaalprofiel nog niet berekend — klantbetalingen op de vervaldag, incasso\'s niet herkend (GET /geld/profiel?vers=1)' });
  else if (profiel.onvolledig || !(profielDagen <= GELD_PROFIEL_MAX)) {
    w.push({ bron: 'profiel', fout: (profiel.onvolledig ? 'betaalprofiel onvolledig' : `betaalprofiel ouder dan ${GELD_PROFIEL_MAX} dagen`) + ' — niet gebruikt: klantbetalingen op de vervaldag, incasso\'s niet herkend; vernieuwen' });
    profiel = null;
  } else if (profielDagen > GELD_PROFIEL_DAGEN) w.push({ bron: 'profiel', fout: `betaalprofiel ouder dan ${GELD_PROFIEL_DAGEN} dagen — vernieuwen` });
  let patronen = null, keuzes = { items: {}, compleet: false };
  try { patronen = await kvJson(env, 'geld:patronen'); keuzes = await geldKvLijst(env, GELD_PK); }
  catch (e) { w.push({ bron: 'patronen', fout: 'vaste patronen niet te lezen (opslag) — niet ingepland' }); }
  const patDagen = patronen ? geldDagenTussen(String(patronen.vandaag || '2000-01-01'), vandaag) : null;
  if (!patronen) w.push({ bron: 'patronen', fout: 'vaste patronen (loon, hypotheek, privé, abonnementen) nog niet berekend — niet ingepland (GET /geld/patronen?vers=1)' });
  else if (patronen.onvolledig || !(patDagen <= GELD_PROFIEL_MAX)) { w.push({ bron: 'patronen', fout: (patronen.onvolledig ? 'vaste patronen onvolledig' : `vaste patronen ouder dan ${GELD_PROFIEL_MAX} dagen`) + ' — niet gebruikt; vernieuwen' }); patronen = null; }
  else if (patDagen > GELD_PROFIEL_DAGEN) w.push({ bron: 'patronen', fout: `vaste patronen ouder dan ${GELD_PROFIEL_DAGEN} dagen — vernieuwen` });
  for (const [k, x] of Object.entries(ksWaarde)) if (k.startsWith('pk:')) { if (x) keuzes.items[k.slice(3)] = x; else delete keuzes.items[k.slice(3)]; }
  if (!keuzes.compleet && patronen) w.push({ bron: 'patronen', fout: 'niet alle aan/uit-keuzes van patronen gelezen' });
  const balans = await geldBalans(get, vandaag, w, potten);
  // Mutaties nodig vanaf: de dag na het maandeinde (MB-stand), de dag na het oudste ijkpunt, en het begin van de tijdlijn.
  const vanaf = [geldDag(balans.maandeinde, 1), van, ...Object.values(laatsteIjk).map(i => geldDag(i.datum, 1))].filter(d => geldIsDatum(d) && d <= vandaag).sort()[0] || vandaag;
  const ondergrens = geldDag(vandaag, -GELD.maxDagen);
  if (vanaf < ondergrens) w.push({ bron: 'ijkpunt', fout: `ijkpunt ouder dan ${GELD.maxDagen} dagen — niet meegenomen, opnieuw ijken` });
  const mutVan = vanaf < ondergrens ? ondergrens : vanaf;
  const [muts, fact] = await Promise.all([geldMutaties(get, mutVan, vandaag, w), geldFacturen(get, vandaag, w)]);
  if (budget.rest <= 0) w.push({ bron: 'algemeen', fout: 'te veel Moneybird-verzoeken nodig — gegevens mogelijk onvolledig' });
  const bankEv = muts.lijst.map(m => geldBankEvent(m, potten)).sort((a, b) => a.datum.localeCompare(b.datum) || a.id.localeCompare(b.id));
  for (const e of bankEv) { e.delta = e.bedrag; if (e.intern && e.pot) e.pot_delta = -e.delta; }
  const gemengd = bankEv.filter(e => e.intern_onzeker);
  if (gemengd.length) w.push({ bron: 'bankmutaties', fout: `${gemengd.length} mutatie(s) niet eenduidig aan één spaarpot toe te wijzen — pot- en totaalsaldo onzeker`, ids: gemengd.slice(0, 10).map(e => e.id) });
  const som = (lijst, filt) => geldRond(lijst.filter(filt).reduce((s, e) => s + e.bedrag, 0));
  // ── saldo per rekening (lopend + potten); een inleg is −bedrag op lopend en +bedrag in de pot
  const saldo = { potten: {} }, mbStand = {};
  const metBalans = balans.waarden && (GELD.bank.ledger in balans.waarden);
  mbStand.lopend = metBalans ? geldRond(balans.waarden[GELD.bank.ledger] + som(bankEv, e => e.datum > balans.maandeinde)) : null;
  for (const p of potten) mbStand[p.id] = p.ledger && balans.waarden && (p.ledger in balans.waarden) ? geldRond(balans.waarden[p.ledger] - som(bankEv, e => e.pot === p.id && e.datum > balans.maandeinde)) : null;
  for (const rek of ['lopend', ...potten.map(p => p.id)]) {
    const i = laatsteIjk[rek], s = { mb_stand: mbStand[rek], ijkpunt: i ? { bedrag: i.bedrag, datum: i.datum, door: i.doorNaam || i.door || '', ts: i.ts } : null };
    const pot = potten.find(p => p.id === rek);
    if (pot) Object.assign(s, { id: pot.id, naam: pot.naam, doel: pot.doel, actief: pot.actief });
    if (i && i.datum >= ondergrens) {
      // Eindsaldo van de ijkdag; mutaties vanaf de dag erna.
      const delta = rek === 'lopend' ? som(bankEv, e => e.datum > i.datum) : -som(bankEv, e => e.pot === rek && e.datum > i.datum);
      s.berekend = geldRond(i.bedrag + delta); s.gerapporteerd = s.berekend; s.bron = 'ijkpunt';
      s.verschil = s.mb_stand == null ? null : geldRond(s.mb_stand - s.berekend);
    } else {
      s.berekend = null; s.gerapporteerd = s.mb_stand; s.bron = 'moneybird'; s.verschil = null;
      w.push({ bron: 'saldo', rekening: rek, fout: s.mb_stand != null ? 'nog niet geijkt — Moneybird-stand gebruikt' : 'nog niet geijkt en geen Moneybird-stand — saldo onbekend' });
    }
    if (muts.onvolledig) { s.onzeker = true; s.onzeker_reden = 'bankmutaties onvolledig opgehaald — saldo kan afwijken'; }
    else if (rek !== 'lopend') {
      // Een niet-eenduidige mutatie die deze pot kan raken (ná de basis van het saldo) → saldo onbekend, niet gokken.
      const basis = s.bron === 'ijkpunt' ? i.datum : balans.maandeinde;
      const raak = gemengd.filter(e => (e.pot_kandidaten || []).includes(rek) && e.datum > basis);
      if (raak.length) { s.onzeker = true; s.onzeker_reden = `${raak.length} niet eenduidige mutatie(s) — bevestig de pot (tegenrekening instellen) of boek ze`; s.gerapporteerd = null; }
    }
    if (rek === 'lopend') saldo.lopend = s; else saldo.potten[rek] = s;
  }
  // Kredietlimiet: ondergrens van de lopende rekening (uit de instellingen; niet ingesteld → onbekend).
  saldo.lopend.kredietlimiet = cfg.kredietlimiet;
  saldo.lopend.ondergrens = cfg.kredietlimiet == null ? null : -cfg.kredietlimiet;
  saldo.lopend.ruimte = cfg.kredietlimiet == null || saldo.lopend.gerapporteerd == null ? null : geldRond(saldo.lopend.gerapporteerd + cfg.kredietlimiet);
  if (cfg.kredietlimiet == null) w.push({ bron: 'config', fout: 'kredietlimiet lopende rekening niet ingesteld' });
  const potSom = potten.map(p => saldo.potten[p.id].gerapporteerd);
  saldo.totaal = { gerapporteerd: saldo.lopend.gerapporteerd == null || potSom.some(v => v == null) ? null : geldRond(saldo.lopend.gerapporteerd + potSom.reduce((a, b) => a + b, 0)),
    uitleg: 'Lopend + spaarpotten; inleg en opname tussen lopend en potten heffen elkaar op.', onzeker: (muts.onvolledig || gemengd.length > 0) || undefined };
  // ── events: verleden (bank, binnen de tijdlijn) + toekomst/open (facturen) + ijkpunten
  const events = bankEv.filter(e => e.datum >= van && e.datum <= tot);
  const plan = { vandaag, profiel, overrides: overrides.items || {}, cfg, gebruikt: new Set() };
  const factEv = [...fact.inkoop.map(d => [d, geldFactuurEvent('inkoop', d, vandaag, w)]), ...fact.verkoop.map(d => [d, geldFactuurEvent('verkoop', d, vandaag, w)])]
    .filter(([, e]) => e.bedrag !== 0).flatMap(([d, e]) => geldPlan(e.bron, d, e, plan));
  // Overrides voor facturen die niet (meer) open zijn: melden zodat ze opgeruimd kunnen worden (niet stil laten liggen).
  const vervallenOv = Object.keys(plan.overrides).filter(id => !plan.gebruikt.has(id));
  const metDelta = e => { if (!e.saldo_ijkpunt) { e.delta = geldRond((e.richting === 'in' ? 1 : -1) * Math.abs(e.bedrag)); if (e.intern && e.pot) e.pot_delta = -e.delta; } return e; };
  factEv.forEach(metDelta);
  // ── G3: vaste patronen (niet voor potjes-overboekingen), weekinleg, BTW-aangifte en BTW-sparen
  const potLedgers = new Set(potten.filter(p => p.ledger).map(p => p.ledger)), potIbans = new Set(potten.map(p => p.herkenning.tegenrekening).filter(Boolean));
  const eersteDag = {};
  for (const e of factEv) if (e.bron === 'inkoop' && e.datum && (!eersteDag[e.document_id] || e.datum < eersteDag[e.document_id])) eersteDag[e.document_id] = e.datum;
  const inkoopOpen = fact.inkoop.map(d => [d, factEv.find(e => e.bron === 'inkoop' && String(e.document_id) === String(d.id))]).filter(([, e]) => e && e.delta < 0)
    .map(([d, e]) => ({ id: String(d.id), iban: e.iban, naam: e.tegenpartij, open: Math.abs(factEv.filter(x => x.bron === 'inkoop' && String(x.document_id) === String(d.id)).reduce((a, x) => a + x.delta, 0)), datum: eersteDag[d.id] || e.vervaldag }));
  const termijnen = factEv.filter(e => e.bron === 'inkoop' && e.override && e.override.type === 'afbetaling' && e.datum).map(e => ({ iban: e.iban, bedrag: Math.abs(e.delta), datum: e.datum, document_id: e.document_id }));
  const pctx = { vandaag, tot, bank: bankEv, inkoop: inkoopOpen, termijnen, vervangen: 0 }, patEv = [], patLijst = [];
  for (const pt of (patronen && Array.isArray(patronen.patronen) ? patronen.patronen : [])) {
    const k = keuzes.items[pt.id], aan = !(k && k.aan === false), pot = (pt.ledgers || []).some(l => potLedgers.has(l)) || String(pt.iban || '').split(',').some(i => potIbans.has(i));
    patLijst.push({ id: pt.id, tegenpartij: pt.tegenpartij, richting: pt.richting, frequentie: pt.frequentie, dag: pt.dag, verschuiving: pt.verschuiving, weekdag: pt.weekdag, bedrag: pt.bedrag, min: pt.min, max: pt.max,
      zekerheid: pt.zekerheid, factuur: pt.factuur, n: pt.n, aan, uit_door: k && k.aan === false ? k.door : undefined, potje: pot || undefined });
    if (aan && !pot) patEv.push(...geldPatroonEvents(pt, pctx).map(metDelta));
  }
  for (const [, x] of pctx.mogelijkDubbel || []) w.push({ bron: 'patronen', fout: `mogelijk dubbel: vast patroon "${x.patroon}" lijkt op een afbetaling van factuur ${x.factuur} — zet het patroon uit als het dezelfde betaling is` });
  const inlegEv = geldInlegEvents(cfg, patronen, pctx, w).map(metDelta);
  const btwBet = new Map();
  for (const b of (patronen && patronen.btw_betalingen) || []) btwBet.set(b.datum + '|' + b.bedrag, b);
  for (const m of muts.lijst) if ((m.payments || []).some(x => x.invoice_type === 'VatDocument')) btwBet.set(m.date + '|' + geldRond(geldGetal(m.amount)), { datum: m.date, bedrag: geldRond(geldGetal(m.amount)) });
  // ── G5: prognose (projecten die zeker doorgaan, handmatige posten); echte facturen gaan voor
  let progEv = [], progOverzicht = [];
  const progItems = prognose.items || {};
  if (Object.keys(progItems).length) {
    if (!prognose.compleet) w.push({ bron: 'prognose', fout: 'niet alle prognose-posten gelezen' });
    const fk = new Map();
    for (const f of (profielRuw && profielRuw.facturen) || []) fk.set(f.id, f);
    if (Object.values(progItems).some(it => it.soort === 'project')) {
      if (!profielRuw) w.push({ bron: 'prognose', fout: 'betaalprofiel ontbreekt: facturen ouder dan 60 dagen niet te zien — een al gefactureerde termijn kan dubbel staan' });
      const rec = await geldLijst(get, `sales_invoices?filter=period:${geldDag(vandaag, -60).replace(/-/g, '')}..${vandaag.replace(/-/g, '')},state:paid`, w, 'recent betaalde verkoopfacturen');
      for (const x of rec.lijst) fk.set(String(x.id), geldFactuurKort(x));
      if (rec.onvolledig) w.push({ bron: 'prognose', fout: 'recent betaalde facturen onvolledig — een al gefactureerde termijn kan dubbel staan' });
    }
    for (const x of fact.verkoop) fk.set(String(x.id), geldFactuurKort(x));
    const r = geldPrognoseEvents(progItems, [...fk.values()], { vandaag, profiel, cfg }, w);
    progEv = r.events.map(metDelta); progOverzicht = r.overzicht;
  }
  // Bankdagen: wat wij zelf betalen (inkoop volgens beleid, eigen afspraken, aangifte, handmatige uitgaven) → vorige
  // bankdag, maar niet vóór vandaag; ontvangsten, incasso's, patronen en inleg → volgende bankdag. Eerst verschuiven,
  // dan pas BTW-sparen en de dekking van de aangifte rekenen; afgeleide events (BTW-sparen, terugboeking) volgen hun bron.
  const bankdagen = lijst => {
    for (const e of lijst) {
      if (!e.datum || e.van_event || String(e.id).endsWith(':terug')) continue;
      const zelf = e.delta < 0 && e.datumtype !== 'incasso' && e.datumtype !== 'patroon' && e.bron !== 'inleg';
      let d = zelf ? geldBankdagVoor(e.datum) : geldBankdagNa(e.datum);
      if (d < vandaag) d = geldBankdagNa(vandaag);
      if (d !== e.datum) { e.datum_oorspronkelijk = e.datum; e.datum = d; }
    }
    const bron = new Map(lijst.map(e => [e.id, e]));
    for (const e of lijst) { const b = String(e.id).endsWith(':terug') ? bron.get(String(e.id).replace(/:terug$/, '')) : null; if (b && b.datum !== e.datum) e.datum = b.datum; }
    return lijst;
  };
  const gepland = bankdagen([...factEv, ...patEv, ...inlegEv, ...progEv]);
  gepland.push(...geldBtwSparen(gepland, cfg).map(metDelta));
  const btwEv = bankdagen((await geldBtwAangifte(get, vandaag, cfg, [...btwBet.values()], w)).map(metDelta));
  // Terugboeking uit de BTW-pot: hooguit wat er (verwacht) in de pot zit op die dag; onbekend potsaldo → niet terugboeken.
  for (const t of btwEv.filter(e => e.id.endsWith(':terug')).sort((a, b) => a.datum.localeCompare(b.datum))) {
    const aangifte = btwEv.find(e => e.id === t.id.replace(/:terug$/, '')), ps = saldo.potten[t.pot];
    let pot = ps && ps.gerapporteerd != null ? ps.gerapporteerd : null;
    if (pot != null) for (const e of gepland.concat(btwEv)) { if (e === t || !e.datum || e.datum > t.datum || typeof e.delta !== 'number') continue; if (e.intern && e.pot === t.pot && (e.id.endsWith(':terug') ? btwEv.indexOf(e) < btwEv.indexOf(t) : true)) pot -= e.delta; else if (e.rekening === t.pot) pot += e.delta; }
    if (pot == null || pot <= 0) {
      btwEv.splice(btwEv.indexOf(t), 1); aangifte.gedekt = false;
      w.push({ bron: 'btw', rekening: t.pot, fout: pot == null ? `saldo BTW-pot onbekend — terugboeking voor ${aangifte.kwartaal} niet meegenomen (ijk de pot)` : `BTW-pot verwacht leeg op ${t.datum} — aangifte ${aangifte.kwartaal} niet gedekt` });
    } else if (pot < t.bedrag - 0.004) {
      w.push({ bron: 'btw', rekening: t.pot, fout: `BTW-pot dekt de aangifte ${aangifte.kwartaal} niet helemaal: tekort ${geldRond(t.bedrag - pot)}` });
      t.bedrag = geldRond(pot); metDelta(t); t.uitleg += ' (begrensd tot het verwachte saldo van de pot)'; aangifte.gedekt = false;
    } else aangifte.gedekt = true;
  }
  // Aangifte rechtstreeks uit een pot: geen dekking → melden (de betaling blijft staan).
  for (const a of btwEv.filter(e => e.rekening !== 'lopend' && e.delta < 0)) {
    const ps = saldo.potten[a.rekening]; let pot = ps && ps.gerapporteerd != null ? ps.gerapporteerd : null;
    if (pot != null) for (const e of gepland.concat(btwEv)) { if (e === a || !e.datum || e.datum > a.datum || typeof e.delta !== 'number') continue; if (e.intern && e.pot === a.rekening) pot -= e.delta; else if (e.rekening === a.rekening && e.datum < a.datum) pot += e.delta; }
    a.gedekt = pot != null && pot + a.delta >= -0.004;
    if (!a.gedekt) w.push({ bron: 'btw', rekening: a.rekening, fout: pot == null ? `saldo van "${a.rekening}" onbekend — dekking BTW-aangifte ${a.kwartaal} niet te controleren` : `"${a.rekening}" dekt de BTW-aangifte ${a.kwartaal} niet: tekort ${geldRond(-(pot + a.delta))}` });
  }
  gepland.push(...btwEv);
  // Achterstallig en zonder datum altijd mee (nooit weg); verder alleen binnen de periode.
  const binnen = d => d && d >= van && d <= tot;
  const inBeeld = e => !e.datum || binnen(e.datum) || binnen(e.datum_oorspronkelijk) || e.achterstallig;   // achterstallig staat altijd op vandaag; verschoven naar een bankdag blijft zichtbaar
  events.push(...gepland.filter(inBeeld));
  for (const rek of Object.keys(laatsteIjk)) { const i = laatsteIjk[rek];
    if (i.datum >= van && i.datum <= tot) events.push({ id: 'ijkpunt:' + i.id, bron: 'ijkpunt', richting: 'in', bedrag: i.bedrag, datum: i.datum, datumtype: 'werkelijk', zekerheid: 'werkelijk', rekening: rek, tegenpartij: '', document_id: null, bron_url: null, uitleg: 'IJkpunt: eindsaldo van deze dag (ingevuld door ' + (i.doorNaam || i.door || '?') + ').', saldo_ijkpunt: true }); }
  const buitenEv = gepland.filter(e => !inBeeld(e) && !e.intern), buiten = buitenEv.length;   // alle geplande posten buiten de periode (intern heft zich op)
  const buitenBedrag = { in: geldRond(buitenEv.filter(e => e.richting === 'in').reduce((a, e) => a + Math.abs(e.bedrag), 0)), uit: geldRond(buitenEv.filter(e => e.richting === 'uit').reduce((a, e) => a + Math.abs(e.bedrag), 0)) };
  return { status: 200, body: {
    vandaag, van, tot, as_of: new Date().toISOString(),
    bronnen: { bankmutaties: { as_of: new Date().toISOString(), van: mutVan, tot: vandaag, aantal: muts.lijst.length, onvolledig: muts.onvolledig },
      facturen: { as_of: new Date().toISOString(), jaren: fact.jaren, inkoop: fact.inkoop.length, verkoop: fact.verkoop.length, buiten_periode: buiten, buiten_periode_bedrag: buitenBedrag, onvolledig: fact.onvolledig },
      balans: { as_of: new Date().toISOString(), maandeinde: balans.maandeinde, gevonden: !!metBalans } },
    saldo, events, waarschuwingen: w, verzoeken: GELD.budget - budget.rest,
    profiel: profiel ? { as_of: profiel.as_of, klanten: Object.keys(profiel.klanten || {}).length, incasso_leveranciers: Object.keys(profiel.incasso || {}).length, onvolledig: !!profiel.onvolledig } : null,
    overrides: { aantal: Object.keys(plan.overrides).length, niet_meer_open: vervallenOv, compleet: overrides.compleet },
    patronen: patronen ? { as_of: patronen.as_of, aantal: patLijst.length, aan: patLijst.filter(x => x.aan && !x.potje).length, vervangen_door_factuur: pctx.vervangen, lijst: patLijst } : null,
    historie_dagsom: url.searchParams.get('historie') === '1' && patronen ? patronen.dagsom : undefined,
    historie_intern: url.searchParams.get('historie') === '1' && patronen ? patronen.dagsom_intern || {} : undefined,
    historie_maand_uit: url.searchParams.get('historie') === '1' && patronen ? patronen.maand_uit || {} : undefined,
    historie_rc: url.searchParams.get('historie') === '1' && patronen ? patronen.rc_afrek || [] : undefined,
    historie_spaarrente: url.searchParams.get('historie') === '1' && patronen ? patronen.spaar_rente || [] : undefined,
    prognose: { posten: progOverzicht, compleet: prognose.compleet },
    instellingen: { kredietlimiet: cfg.kredietlimiet, potten: cfg.potten.map(p => ({ id: p.id, naam: p.naam, doel: p.doel, actief: p.actief, weekinleg: p.weekinleg, weekdag: p.weekdag, virtueel: p.virtueel, streef: p.streef })), btw: cfg.btw, btw_pot: geldBtwPot(cfg), lopend_streef: cfg.lopend_streef, reserve: cfg.reserve, buffer_lopend: cfg.buffer_lopend, spaarrente: cfg.spaarrente },
  } };
}
// ── Cijfers (G9): maandcijfers uit Moneybird voor de grafieken bij de rapporten ────────
// Per maand: de W&V per grootboek (reports/profit_loss), de balans op het maandeinde (kasstand) en de bankmutaties
// (per grootboek geboekt: privé-opnames, aflossingen; plus loonbetalingen die niet in de W&V staan — "eerlijk beeld").
// In KV staan de ruwe bedragen per grootboek; de indeling in categorieën gebeurt pas bij het opvragen, dus een andere
// indeling kost geen nieuwe Moneybird-verzoeken.
//   geld:cijfers:jaar:JJJJ    {maanden: {MM: rec}}  afgesloten maanden — onveranderlijk (de eigenaar kan een jaar opnieuw laten opbouwen)
//   geld:cijfers:maand:JJJJ-MM                      de lopende maand, dagelijks opnieuw (lazy, bij het eerste openen)
//   geld:cijfers:ledgers                            grootboekrekeningen (naam, soort), een dag geldig
// Per verzoek hooguit GELD_CIJ_PER_VERZOEK maanden (subrequest-budget); het antwoord zegt welke nog ontbreken.
const GELD_CIJ = 'geld:cijfers:', GELD_CIJ_START = '2022-01', GELD_CIJ_PER_VERZOEK = 6, GELD_CIJ_MB_PER_MAAND = 6, GELD_CIJ_MAX_FACT = 500;   // per maand: W&V, balans, bank, inkoopfacturen, bonnen (+ reserve)
const GELD_CATS = [['materiaal', 'Materiaal'], ['uitbesteed', 'Uitbesteed werk'], ['personeel', 'Personeel en inhuur'], ['huisvesting', 'Huisvesting en energie'],
  ['vervoer', 'Vervoer'], ['machines', 'Machines en gereedschap'], ['kantoor', 'Kantoor en ICT'], ['verzekeringen', 'Verzekeringen'], ['advies', 'Advies en administratie'],
  ['financiering', 'Financiering'], ['overig', 'Overig']];
const GELD_CAT_IDS = new Set(GELD_CATS.map(x => x[0]));
// Voorstel-indeling op grootboeknaam (eerste treffer wint; de eigenaar past aan). Afschrijving zonder soort → overig.
const GELD_CAT_REGELS = [
  ['uitbesteed', /inkoop diensten|uitbested|onderaannem/i],
  ['personeel', /loon|lonen|salari|sociale lasten|pensioen|personeel|inhuur|zzp|uitzend|cursus|opleiding|training|werkkleding|lunch/i],
  ['materiaal', /inkoop|materia|handelsgoed|grondstof|voorraad/i],
  ['vervoer', /auto|transport|brandstof|reis|vervoer|motorrijtuig|parkeer/i],
  ['huisvesting', /huur|huisvest|pand|gas, water|gas,|elektr|energie|afval|container|schoonmaak/i],
  ['machines', /machine|inventaris|gereedschap/i],
  ['verzekeringen', /verzeker/i],
  ['kantoor', /kantoor|software|automatiser|telefoon|internet|abonnement|contributie|porti|drukwerk|ict|algemene kosten/i],
  ['advies', /advies|administratie|accountant|juridisch|notaris/i],
  ['financiering', /rente|bankkosten|bank|koers|financ/i],
];
const GELD_CIJ_V = 2;   // versie van een maandrecord; ouder (zonder tegenrekeningen) wordt vanaf correctie_van opnieuw opgehaald
// De eigenaren: tegenrekeningen en -partijen van boekingen op privé/opname/onttrekking/storting (eigen vermogen).
function geldEigenaren(recs, idl, ledgers) {
  const led = new Set(idl.prive.map(p => p.ledger)), ib = new Set(), nm = new Set();
  for (const r of recs) for (const e of (r && r.eq) || []) if (led.has(e.ledger) || /priv|opname|onttrek|storting/i.test((ledgers[e.ledger] || {}).naam || '')) { if (e.iban) ib.add(e.iban); if (e.naam) nm.add(e.naam.toLowerCase()); }
  return { ib, nm };
}
// Naar of van een eigenaar (of op eigen vermogen geboekt)? Een bekend IBAN is doorslaggevend; alleen zonder IBAN op naam
// (anders valt een werknemer met dezelfde naam weg).
const geldIsEigenaar = (x, eig) => !!x.eq || x.soort === 'equity' || (x.iban ? eig.ib.has(x.iban) : !!(x.tegenpartij && eig.nm.has(x.tegenpartij.toLowerCase())));
const geldHeeftTrefwoord = (x, pat) => pat.some(t => `${x.omschrijving} ${x.tegenpartij} ${x.grootboek}`.toLowerCase().includes(t));
// Loonbetalingen buiten de W&V: een trefwoord of een vaste loonrekening (IBAN), en niet naar of van een eigenaar.
// lc = geldLoonCtx: vaste loonrekeningen (IBAN) en balansgrootboeken voor lonen (bv. "netto lonen", "af te dragen loonheffing").
function geldLoonKand(r, pat, eig, lc) {
  return ((r && r.kand) || []).filter(x => !geldIsEigenaar(x, eig) && ((lc && lc.li.has(x.iban || '-')) || (lc && geldLoonBalansSoort(x, lc)) || geldHeeftTrefwoord(x, pat)));
}
// Alle loonposten van een maand: bankbetalingen (trefwoord, vaste loonrekening of loon-balansgrootboek) en de regels van
// inkoopfacturen/bonnen die op een loon-balansgrootboek staan (per document en soort).
function geldLoonPosten(r, pat, eig, lc) {
  // Geen dubbeltelling: heeft een loon-balansgrootboek deze maand factuurregels, dan telt een bankmutatie op dát
  // grootboek niet als die op bedrag overeenkomt met een (nog niet gebruikte) factuurregel — de factuur telt dan.
  const pool = new Map();
  for (const d of (r && r.fact) || []) for (const g of d.regels || []) if (lc.lb.has(g.led)) { if (!pool.has(g.led)) pool.set(g.led, []); pool.get(g.led).push(geldRond(g.bedrag)); }
  const uit = [];
  for (const x of geldLoonKand(r, pat, eig, lc)) {
    const led = x.led || (x.grootboek && lc.lbNaamId.get(x.grootboek)) || null, arr = led ? pool.get(led) : null;
    if (arr) { const i = arr.findIndex(b => Math.abs(b - x.bedrag) < 0.01); if (i >= 0) { arr.splice(i, 1); continue; } }
    uit.push({ bron: 'bank', x, id: x.id, datum: x.datum, tegenpartij: x.tegenpartij, omschrijving: x.omschrijving, bedrag: x.bedrag, soort: geldLoonSoort(x, lc), balans: !!geldLoonBalansSoort(x, lc) });
  }
  for (const d of (r && r.fact) || []) {
    const per = {}; for (const g of d.regels || []) { const s2 = lc.lb.get(g.led); if (s2) per[s2] = (per[s2] || 0) + g.bedrag; }
    for (const [s2, b] of Object.entries(per)) if (b) uit.push({ bron: 'factuur', doc: d.soort, id: d.id, datum: d.datum, tegenpartij: d.tegenpartij, omschrijving: d.nummer || '', bedrag: geldRond(b), soort: s2 });
  }
  return uit;
}
// Lonen via balansgrootboeken: elke uitgaande betaling die daarop geboekt is, telt als die soort. Voorstel op naam
// (alleen schulden-grootboeken, dus geen spaarpotten); de eigenaar bevestigt of past aan (cijfers.loon_balans).
const GELD_CIJ_LOON_BALANS = [['netto', /netto ?lonen|nettoloon|vakantiegeld|te betalen lonen/i], ['loonheffing', /loonheffing/i], ['pensioen', /pensioen/i]];
// Balansgrootboeken die loon kunnen zijn: activa of passiva, maar nooit de bank of een spaarpot.
const geldBalansSoort = s2 => /assets|liabilities/.test(s2 || '');
const geldPotLedgers = cfg => new Set(((cfg && cfg.potten) || []).map(x => String(x.ledger || '')).filter(Boolean).concat([GELD.bank.ledger]));
function geldLoonBalans(ledgers, cc, potLed) {
  if (Array.isArray(cc.loon_balans)) return { lijst: cc.loon_balans, bron: 'instelling' };
  const lijst = [];
  for (const [id, l] of Object.entries(ledgers || {})) if (geldBalansSoort(l.soort) && !(potLed && potLed.has(id))) { const r = GELD_CIJ_LOON_BALANS.find(([, re]) => re.test(l.naam)); if (r) lijst.push({ ledger: id, soort: r[0] }); }
  return { lijst, bron: 'voorstel' };
}
function geldLoonCtx(ledgers, cc, potLed) {
  const lb = new Map(geldLoonBalans(ledgers, cc, potLed).lijst.map(x => [x.ledger, x.soort])), lbNaam = new Map(), naamIds = new Map();
  // Oudere records kennen alleen de grootboeknaam. Namen zijn niet uniek: alleen gebruiken als álle grootboeken met die
  // naam loon-balansgrootboek zijn van dezelfde soort.
  for (const [id, l] of Object.entries(ledgers || {})) if (l && l.naam) { if (!naamIds.has(l.naam)) naamIds.set(l.naam, []); naamIds.get(l.naam).push(id); }
  const lbNaamId = new Map();                                          // naam → grootboek-id, alleen als de naam uniek is
  for (const [n, ids] of naamIds) { const sr = new Set(ids.map(id => lb.get(id) || null)); if (sr.size === 1 && !sr.has(null)) lbNaam.set(n, [...sr][0]); if (ids.length === 1 && lb.has(ids[0])) lbNaamId.set(n, ids[0]); }
  return { li: geldLoonIban(cc), lb, lbNaam, lbNaamId };
}
const geldLoonBalansSoort = (x, lc) => (x.led && lc.lb.get(x.led)) || (x.grootboek && lc.lbNaam.get(x.grootboek)) || null;
// Welke W&V-grootboeken de lonen zijn: de instelling, anders alleen de echte loonrekeningen op naam (niet de hele
// categorie personeel: overige personeelskosten, reiskosten en inhuur zijn geen lonen).
const GELD_CIJ_LOON_WV = /bruto ?lonen|brutoloon|sociale lasten|pensioenbijdrage|pensioenpremie|pensioenlasten|vakantiegeld|loonheffing/i;
function geldLoonWv(ledgers, cc) {
  if (Array.isArray(cc.loon_wv)) return { set: new Set(cc.loon_wv), bron: 'instelling' };
  return { set: new Set(Object.entries(ledgers || {}).filter(([, l]) => ['direct_costs', 'expenses', 'other_income_expenses'].includes(l.soort) && GELD_CIJ_LOON_WV.test(l.naam)).map(([id]) => id)), bron: 'voorstel' };
}
const geldLoonIban = cc => new Map((cc.loon_iban || []).map(x => [x.iban, x]));
// Lonen die al in de W&V staan (deze maand): alleen het deel van de bankbetalingen daarboven telt als correctie.
const geldLoonPl = (r, wv) => Object.entries((r && r.kosten) || {}).reduce((a, [id, x]) => a + (wv.has(id) ? x : 0), 0);
// Afronden per soort zodat de drie samen precies de (afgeronde) correctie zijn: het restje naar de grootste soort.
function geldRondSoorten(o, totaal) {
  const r = Object.fromEntries(Object.entries(o).map(([k, x]) => [k, geldRond(x)])), d = geldRond(geldRond(totaal) - Object.values(r).reduce((a, x) => a + x, 0));
  if (d) { const k = Object.keys(r).sort((a, b) => r[b] - r[a])[0]; r[k] = geldRond(r[k] + d); }
  return r;
}
const geldLoonSoort = (x, lc) => lc && x.iban && lc.li.has(x.iban) ? lc.li.get(x.iban).soort
  : lc && geldLoonBalansSoort(x, lc) ? geldLoonBalansSoort(x, lc)
  : /belastingdienst/i.test(x.tegenpartij || '') || /loonheffing/i.test(`${x.omschrijving} ${x.grootboek}`) ? 'loonheffing'
  : /pensioen|pfzw|bpf|pme|pmt|abp/i.test(`${x.tegenpartij} ${x.omschrijving} ${x.grootboek}`) ? 'pensioen' : 'netto';
const GELD_CIJ_LOONPATRONEN = ['loon', 'salaris', 'loonheffing', 'pensioen'];       // standaard: tekst in een bankmutatie
// Branchekengetallen (CBS, % van de omzet) als standaard; de eigenaar kan ze in de instellingen aanpassen.
const GELD_CIJ_BRANCHE = { brutomarge: { pct: 53, bron: 'CBS' }, materiaal: { pct: 36, bron: 'CBS' }, uitbesteed: { van: 5, tot: 6, bron: 'CBS' }, personeel: { van: 15, tot: 19, bron: 'CBS' },
  huisvesting: { pct: 4.5, bron: 'CBS (huisvesting 3,5% + energie 1%)' }, vervoer: { pct: 1.6, bron: 'CBS' }, resultaat: { van: 12, tot: 13, bron: 'CBS' } };
const GELD_PL_SOORT = new Set(['revenue', 'direct_costs', 'expenses', 'other_income_expenses']);
const geldId = x => /^\d{6,25}$/.test(String(x || '')) ? String(x) : null;
function geldCijferCfgNorm(c) {
  c = c && typeof c === 'object' && !Array.isArray(c) ? c : {};
  const lijst = (x, max) => Array.isArray(x) ? x.slice(0, max) : [];
  const map = {}; for (const [k, w] of Object.entries(c.map && typeof c.map === 'object' ? c.map : {}).slice(0, 500)) if (geldId(k) && GELD_CAT_IDS.has(w)) map[k] = w;
  const pct = x => typeof x === 'number' && isFinite(x) && x >= 0 && x <= 100 ? x : null;
  let bm = null;
  if (c.benchmarks && typeof c.benchmarks === 'object') { bm = {}; for (const [k, w] of Object.entries(c.benchmarks)) if ((GELD_CAT_IDS.has(k) || k === 'brutomarge' || k === 'resultaat') && w && typeof w === 'object') {
    const r = { pct: pct(w.pct), van: pct(w.van), tot: pct(w.tot), bron: String(w.bron || '').slice(0, 80) }; if (r.pct != null || (r.van != null && r.tot != null)) bm[k] = r; } }
  return { map,
    prive: Array.isArray(c.prive) ? lijst(c.prive, 6).filter(x => x && geldId(x.ledger)).map(x => ({ ledger: String(x.ledger), naam: String(x.naam || '').trim().slice(0, 40) || 'privé' })) : null,
    aflossing: Array.isArray(c.aflossing) ? [...new Set(lijst(c.aflossing, 10).map(geldId).filter(Boolean))] : null,
    loonpatronen: Array.isArray(c.loonpatronen) ? lijst(c.loonpatronen, 10).map(x => String(x).trim().toLowerCase().slice(0, 30)).filter(x => x.length >= 3) : null,
    benchmarks: bm, correctie_van: /^\d{4}-\d{2}$/.test(String(c.correctie_van || '')) ? c.correctie_van : null,
    // welke W&V-grootboeken de lonen zijn (tegen dubbel tellen); null = voorstel op naam
    loon_wv: Array.isArray(c.loon_wv) ? [...new Set(lijst(c.loon_wv, 30).map(geldId).filter(Boolean))] : null,
    // vaste loonrekeningen: elke uitgaande betaling naar dit IBAN telt als loon (werknemer, Belastingdienst, pensioenfonds)
    // balansgrootboeken waarop lonen betaald worden (netto lonen, af te dragen loonheffing, pensioen); null = voorstel op naam
    loon_balans: Array.isArray(c.loon_balans) ? [...new Map(lijst(c.loon_balans, 30).filter(x => x && geldId(x.ledger) && ['netto', 'loonheffing', 'pensioen'].includes(x.soort)).map(x => [String(x.ledger), { ledger: String(x.ledger), soort: x.soort }])).values()] : null,
    loon_iban: Array.isArray(c.loon_iban) ? lijst(c.loon_iban, 60).filter(x => x && typeof x === 'object').map(x => ({ iban: String(x.iban || '').replace(/\s+/g, '').toUpperCase().slice(0, 34), naam: String(x.naam || '').slice(0, 60),
      soort: ['netto', 'loonheffing', 'pensioen'].includes(x.soort) ? x.soort : 'netto' })).filter(x => /^[A-Z0-9]{8,34}$/.test(x.iban)) : null };
}
const geldMaandEinde = ym => `${ym}-${String(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
function geldMaanden(van, tot) { const uit = []; for (let m = van; m <= tot && uit.length < 240; m = geldMaandPlus(m, 1)) uit.push(m); return uit; }
// Grootboekrekeningen (naam en soort), een dag in KV.
async function geldLedgers(env, get, w) {
  const c = await kvJson(env, GELD_CIJ + 'ledgers');
  if (c && c.datum === geldVandaag() && c.lijst) return c.lijst;
  const r = await get('ledger_accounts');
  if (!r.ok || !Array.isArray(r.data)) { w.push({ bron: 'grootboeken', fout: r.fout || 'onverwacht antwoord', status: r.status }); return c && c.lijst ? c.lijst : null; }
  const lijst = {}; for (const l of r.data) if (l && geldId(l.id)) lijst[String(l.id)] = { naam: String(l.name || '').slice(0, 80), soort: String(l.account_type || '') };
  try { await kvZet(env, GELD_CIJ + 'ledgers', { datum: geldVandaag(), lijst }); } catch {}
  return lijst;
}
// Effectieve indeling: de instelling, anders het voorstel op naam (gemarkeerd).
function geldCijferIndeling(ledgers, cc) {
  const cat = {}, bron = {}, prive = [], aflossing = [];
  for (const [id, l] of Object.entries(ledgers || {})) {
    if (['direct_costs', 'expenses', 'other_income_expenses'].includes(l.soort)) {
      if (cc.map[id]) { cat[id] = cc.map[id]; bron[id] = 'instelling'; }
      else { const r = GELD_CAT_REGELS.find(([, re]) => re.test(l.naam)); cat[id] = r ? r[0] : 'overig'; bron[id] = 'voorstel'; }
    }
    // Privé: alleen eigen-vermogensrekeningen die er op naam op lijken (kapitaal/winstverdeling niet); de rest noemen, de eigenaar kiest.
    if (cc.prive == null && l.soort === 'equity' && /priv|opname|onttrek/i.test(l.naam)) prive.push({ ledger: id, naam: l.naam.replace(/^\s*priv[ée]?\s*(opnamen?|opname|onttrekkingen?)?\s*/i, '').trim() || l.naam });
    if (cc.aflossing == null && l.soort === 'non_current_liabilities') aflossing.push(id);
  }
  const lang = id => (ledgers[id] || {}).soort === 'non_current_liabilities';   // aflossing: alleen langlopende schulden
  const pv = cc.prive != null ? cc.prive : prive, gekozen = new Set(pv.map(x => x.ledger));
  const equityOver = Object.entries(ledgers || {}).filter(([id, l]) => l.soort === 'equity' && !gekozen.has(id)).map(([, l]) => l.naam);
  return { cat, bron, prive: pv, aflossing: (cc.aflossing != null ? cc.aflossing : aflossing).filter(lang), prive_bron: cc.prive != null ? 'instelling' : 'voorstel', aflossing_bron: cc.aflossing != null ? 'instelling' : 'voorstel', equity_over: equityOver };
}
function geldBalansLedgers(data) {
  const t = {};
  const zoek = o => { if (Array.isArray(o)) o.forEach(zoek); else if (o && typeof o === 'object') {
    if (o.ledger_account_id && 'value' in o) (t[String(o.ledger_account_id)] = t[String(o.ledger_account_id)] || []).push(geldGetal(o.value));
    Object.values(o).forEach(x => { if (x && typeof x === 'object') zoek(x); }); } };
  zoek(data);
  const uit = {}; for (const [id, vs] of Object.entries(t)) if (vs.every(x => x === vs[0])) uit[id] = vs[0];   // alleen eenduidige waarden
  return uit;
}
// Factuur- en bonregels op balansgrootboeken (niet W&V, niet eigen vermogen): per document de bedragen per grootboek.
function geldFactRegels(ink, bon, ledgers) {
  const uit = [];
  for (const [l, soort] of [[ink, 'inkoopfactuur'], [bon, 'bonnetje']]) for (const d of (l && l.lijst) || []) {
    const per = {};
    for (const x of d.details || []) { const id = String(x.ledger_account_id || ''), lg = ledgers[id]; if (!lg || GELD_PL_SOORT.has(lg.soort) || lg.soort === 'equity') continue;
      per[id] = geldRond((per[id] || 0) + geldGetal(x.total_price_excl_tax_with_discount_base != null ? x.total_price_excl_tax_with_discount_base : x.total_price_excl_tax_with_discount != null ? x.total_price_excl_tax_with_discount : geldGetal(x.price) * geldGetal(x.amount || 1))); }
    const regels = Object.entries(per).filter(([, b]) => b).map(([led, bedrag]) => ({ led, bedrag }));
    if (regels.length) uit.push({ id: String(d.id), soort, datum: d.date || null, nummer: String(d.reference || '').slice(0, 40), tegenpartij: geldContactNaam(d.contact).slice(0, 60), regels });
  }
  return uit;
}
// Eén maand ophalen (W&V, balans, bankmutaties). null = mislukt (niet opslaan, later opnieuw).
async function geldCijferMaand(get, ym, ledgers, cfg, w) {
  const van = ym + '-01', tot = geldMaandEinde(ym), per = `${van.replace(/-/g, '')}..${tot.replace(/-/g, '')}`, w2 = [];
  // In de correctieperiode ook de inkoopfacturen en bonnen (op factuurdatum): lonen die via een factuur lopen
  // (bv. pensioenpremies) staan met hun grootboek in de factuurregels, niet in de bankboeking.
  const metFact = ym >= ((cfg.cijfers && cfg.cijfers.correctie_van) || `${geldVandaag().slice(0, 4)}-01`);
  const [pl, bal, muts, ink, bon] = await Promise.all([get(`reports/profit_loss?period=${per}`), get(`reports/balance_sheet?period=${per}`), geldMutaties(get, van, tot, w2),
    metFact ? geldLijst(get, `documents/purchase_invoices?filter=period:${per},state:open|late|pending_payment|paid`, w2, 'inkoopfacturen') : null,
    metFact ? geldLijst(get, `documents/receipts?filter=period:${per}`, w2, 'bonnetjes') : null]);
  if (!pl.ok || !pl.data || !bal.ok || muts.onvolledig || (ink && ink.onvolledig) || (bon && bon.onvolledig)) { w.push({ bron: 'cijfers ' + ym, fout: (!pl.ok && pl.fout) || (!bal.ok && bal.fout) || (w2[0] && w2[0].fout) || 'onvolledig', status: pl.status || bal.status }); return null; }
  const omzet = {}, kosten = {};
  const tel = (o, k, x) => { const id = geldId(k); if (id) o[id] = geldRond((o[id] || 0) + x); };
  for (const a of ((pl.data.revenue_by_ledger_account || {}).ledger_accounts || [])) tel(omzet, a.ledger_account_id, geldGetal(a.value));
  for (const s of ['direct_costs_by_ledger_account', 'expenses_by_ledger_account']) for (const a of ((pl.data[s] || {}).ledger_accounts || [])) tel(kosten, a.ledger_account_id, geldGetal(a.value));
  for (const a of ((pl.data.other_income_expenses_by_ledger_account || {}).ledger_accounts || [])) tel(kosten, a.ledger_account_id, -geldGetal(a.value));   // bate = negatieve kosten
  const fact = metFact ? geldFactRegels(ink, bon, ledgers) : undefined;
  if (fact && fact.length > GELD_CIJ_MAX_FACT) { w.push({ bron: 'cijfers ' + ym, fout: `meer dan ${GELD_CIJ_MAX_FACT} facturen/bonnen met balansregels — maand niet opgeslagen` }); return null; }   // niet stil afkappen
  const balans = geldBalansLedgers(bal.data), btwPot = (cfg.potten.find(p => p.id === geldBtwPot(cfg)) || {}).ledger;
  const bank = {}, kand = [], eq = [], eqGezien = new Set();
  for (const m of muts.lijst) {
    const amt = geldGetal(m.amount), bk = (m.ledger_account_bookings || []).filter(b => b && geldId(b.ledger_account_id));
    const iban = String(m.contra_account_number || '').replace(/\s+/g, '').toUpperCase(), tp = String(m.contra_account_name || '').slice(0, 60);
    // Tegenrekeningen van boekingen op eigen vermogen (privé/opnames/stortingen): daarmee herkennen we de eigenaren.
    const eqB = bk.find(b => (ledgers[String(b.ledger_account_id)] || {}).soort === 'equity');
    if (eqB && (iban || tp) && eq.length < 60) { const k = `${eqB.ledger_account_id}|${iban}|${tp}`; if (!eqGezien.has(k)) { eqGezien.add(k); eq.push({ ledger: String(eqB.ledger_account_id), iban, naam: tp }); } }
    if (bk.length === 1) tel(bank, bk[0].ledger_account_id, amt);
    else for (const b of bk) tel(bank, b.ledger_account_id, Math.sign(amt) * Math.abs(geldGetal(b.price)));
    // Kandidaat "loon buiten de W&V": uitgaand, niet aan een factuur gekoppeld, niet op een W&V-grootboek geboekt.
    if (amt < 0 && !(m.payments || []).length && !bk.some(b => GELD_PL_SOORT.has((ledgers[String(b.ledger_account_id)] || {}).soort)) && kand.length < 150)
      kand.push({ id: String(m.id), datum: m.date, bedrag: geldRond(-amt), tegenpartij: tp, iban, omschrijving: String(m.message || '').slice(0, 100),
        led: bk.length ? String(bk[0].ledger_account_id) : '', grootboek: bk.length ? (ledgers[String(bk[0].ledger_account_id)] || {}).naam || '' : '', soort: bk.length ? (ledgers[String(bk[0].ledger_account_id)] || {}).soort || '' : '',
        eq: !!eqB });                                               // een van de boekingen op eigen vermogen → nooit loon
  }
  return { maand: ym, as_of: geldVandaag(), omzet, kosten, mb: { omzet: geldRond(geldGetal(pl.data.total_revenue)), resultaat: geldRond(geldGetal(pl.data.net_profit)), bruto: geldRond(geldGetal(pl.data.gross_profit)) },
    kas: { lopend: GELD.bank.ledger in balans ? balans[GELD.bank.ledger] : null, btw_pot: btwPot && btwPot in balans ? balans[btwPot] : null }, bank, kand, eq, v: GELD_CIJ_V,
    fact };
}
// Maanden laden en (binnen het budget) aanvullen. Afgesloten maanden in een jaarbundel, de lopende maand apart.
async function geldCijferData(env, get, budget, maanden, cfg, ledgers, w, herbouwJaar) {
  const corrVan = (cfg.cijfers && cfg.cijfers.correctie_van) || `${geldVandaag().slice(0, 4)}-01`;
  const vandaag = geldVandaag(), huidig = vandaag.slice(0, 7), jaren = [...new Set(maanden.map(x => x.slice(0, 4)))], bundels = {}, recs = {};
  await Promise.all(jaren.map(async j => { bundels[j] = (await kvJson(env, `${GELD_CIJ}jaar:${j}`)) || { maanden: {} }; }));
  // Herbouwen: één keer per dag leeg beginnen (bundel.herbouw = datum); vervolgrondes gaan door op de deels herbouwde bundel.
  const herbouwNu = herbouwJaar && bundels[herbouwJaar] && bundels[herbouwJaar].herbouw !== vandaag;
  if (herbouwNu) bundels[herbouwJaar] = { maanden: {}, herbouw: vandaag };
  const lopend = maanden.includes(huidig) ? await kvJson(env, `${GELD_CIJ}maand:${huidig}`) : null;
  const nodig = [];
  for (const m of maanden) {
    if (m === huidig) { if (lopend && lopend.as_of === vandaag && lopend.v === GELD_CIJ_V && (m < corrVan || Array.isArray(lopend.fact))) recs[m] = lopend; else nodig.push(m); continue; }
    const r = bundels[m.slice(0, 4)].maanden[m.slice(5)]; if (r && (m < corrVan || (r.v === GELD_CIJ_V && Array.isArray(r.fact)))) recs[m] = r; else nodig.push(m);   // oud record in de correctieperiode → opnieuw
  }
  // Nieuwste eerst aanvullen (het lopende jaar is meteen bruikbaar), één maand tegelijk: elke maand neemt wat hij nodig
  // heeft van het budget; begint er een maand zonder genoeg budget, dan stoppen (die komt de volgende ronde). Een maand
  // die halverwege tekortkomt, wordt niet opgeslagen en staat in "mislukt".
  const gewijzigd = new Set(), mislukt = [];
  for (const m of nodig.sort().reverse()) {
    if (Object.keys(recs).filter(k => nodig.includes(k)).length + mislukt.length >= GELD_CIJ_PER_VERZOEK || budget.rest < GELD_CIJ_MB_PER_MAAND) break;
    const r = await geldCijferMaand(get, m, ledgers, cfg, w);
    if (!r) { mislukt.push(m); if (budget.rest <= 0) break; continue; }
    recs[m] = r;
    if (m === huidig) gewijzigd.add('maand'); else { bundels[m.slice(0, 4)].maanden[m.slice(5)] = r; gewijzigd.add(m.slice(0, 4)); }
  }
  for (const g of gewijzigd) { try { if (g === 'maand') await kvZet(env, `${GELD_CIJ}maand:${huidig}`, recs[huidig]); else await kvZet(env, `${GELD_CIJ}jaar:${g}`, bundels[g]); } catch (e) { w.push({ bron: 'cijfers-opslag', fout: String(e.message || e).slice(0, 80) }); } }
  if (herbouwNu && !gewijzigd.has(herbouwJaar)) { try { await kvZet(env, `${GELD_CIJ}jaar:${herbouwJaar}`, bundels[herbouwJaar]); } catch {} }
  return { recs, ontbrekend: maanden.filter(m => !recs[m]), mislukt };
}
// Maandrecords → reeksen per maand/kwartaal/jaar, met de indeling, de correctie en de branche.
function geldCijferReeksen(recs, maanden, per, idl, ledgers, cc, cfg) {
  const pat = cc.loonpatronen || GELD_CIJ_LOONPATRONEN, corrVan = cc.correctie_van || `${geldVandaag().slice(0, 4)}-01`;
  const sleutel = m => per === 'jaar' ? m.slice(0, 4) : per === 'kwartaal' ? `${m.slice(0, 4)}-K${Math.ceil(Number(m.slice(5)) / 3)}` : m;
  const perioden = new Map(), nietIngedeeld = {}, eig = geldEigenaren(Object.values(recs), idl, ledgers), wv = geldLoonWv(ledgers, cc).set, lc = geldLoonCtx(ledgers, cc, geldPotLedgers(cfg));
  for (const m of maanden) {
    const k = sleutel(m); if (!perioden.has(k)) perioden.set(k, { id: k, van: m, tot: m, maanden: 0, ontbrekend: 0, omzet: 0, kosten: Object.fromEntries(GELD_CATS.map(c => [c[0], 0])), correctie: 0, correctie_n: 0, correctie_soort: { netto: 0, loonheffing: 0, pensioen: 0 }, prive: {}, aflossing: 0, kas: null, mb_resultaat: 0 });
    const P = perioden.get(k); P.tot = m;
    const r = recs[m]; if (!r) { P.ontbrekend++; continue; }
    P.maanden++;
    for (const x of Object.values(r.omzet || {})) P.omzet += x;
    const loonPl = geldLoonPl(r, wv);
    for (const [id, x] of Object.entries(r.kosten || {})) {
      const c = idl.cat[id] || 'overig'; P.kosten[c] += x;
      if (!idl.cat[id]) nietIngedeeld[id] = geldRond((nietIngedeeld[id] || 0) + x);
    }
    if (m >= corrVan) {                                          // alleen het deel dat nog niet in de W&V staat
      const ps = geldLoonPosten(r, pat, eig, lc);
      const som = ps.reduce((a, x) => a + x.bedrag, 0), corr = Math.max(0, som - Math.max(0, loonPl));
      if (corr > 0) { P.correctie += corr; P.correctie_n += ps.length; for (const x of ps) P.correctie_soort[x.soort] += x.bedrag * corr / som; }
    }
    for (const p of idl.prive) { const x = -((r.bank || {})[p.ledger] || 0); if (x) P.prive[p.naam] = (P.prive[p.naam] || 0) + x; }
    for (const id of idl.aflossing) P.aflossing += -((r.bank || {})[id] || 0);
    P.mb_resultaat += (r.mb && r.mb.resultaat) || 0;
    if (r.kas && r.kas.lopend != null) P.kas = { lopend: r.kas.lopend, met_btw: r.kas.btw_pot != null ? geldRond(r.kas.lopend + r.kas.btw_pot) : null, maand: m };
  }
  const uit = [...perioden.values()].map(P => {
    const kt = Object.values(P.kosten).reduce((a, x) => a + x, 0), bruto = P.omzet - P.kosten.materiaal - P.kosten.uitbesteed, res = P.omzet - kt;
    Object.keys(P.kosten).forEach(c => { P.kosten[c] = geldRond(P.kosten[c]); });
    Object.keys(P.prive).forEach(n => { P.prive[n] = geldRond(P.prive[n]); });
    return Object.assign(P, { omzet: geldRond(P.omzet), kosten_totaal: geldRond(kt), brutomarge: geldRond(bruto), brutomarge_pct: P.omzet ? geldRond(bruto / P.omzet * 100) : null,
      resultaat: geldRond(res), correctie: geldRond(P.correctie), correctie_soort: geldRondSoorten(P.correctie_soort, P.correctie), resultaat_eerlijk: geldRond(res - P.correctie), prive_totaal: geldRond(Object.values(P.prive).reduce((a, x) => a + x, 0)),
      aflossing: geldRond(P.aflossing), mb_resultaat: geldRond(P.mb_resultaat), wijkt_af: P.maanden > 0 && Math.abs(res - P.mb_resultaat) > 1 });
  });
  return { perioden: uit, niet_ingedeeld: nietIngedeeld };
}
// Onderliggende stukken van één maand en reeks (drill-down), met Moneybird-links.
async function geldCijferDetail(env, get, w, ym, reeks, cat, cfg, ledgers, idl, rec, recsJaar) {
  const van = ym + '-01', tot = geldMaandEinde(ym), per = `${van.replace(/-/g, '')}..${tot.replace(/-/g, '')}`, items = [];
  const naam = c => geldContactNaam(c) || '';
  if (reeks === 'omzet') {
    const l = await geldLijst(get, `sales_invoices?filter=period:${per},state:open|late|reminded|pending_payment|paid|uncollectible`, w, 'verkoopfacturen');
    for (const f of l.lijst) items.push({ soort: 'verkoopfactuur', id: String(f.id), nummer: String(f.invoice_id || ''), datum: f.invoice_date || null, tegenpartij: naam(f.contact), bedrag: geldRond(geldGetal(f.total_price_excl_tax_base != null ? f.total_price_excl_tax_base : f.total_price_excl_tax)), url: geldUrl('sales_invoices', f.id) });
    return { items, totaal_wv: rec ? geldRond(Object.values(rec.omzet || {}).reduce((a, x) => a + x, 0)) : null, onvolledig: l.onvolledig };
  }
  if (reeks === 'correctie') {
    const lc = geldLoonCtx(ledgers, cfg.cijfers, geldPotLedgers(cfg)), eig = geldEigenaren(recsJaar || [rec], idl, ledgers), k2 = geldLoonPosten(rec, cfg.cijfers.loonpatronen || GELD_CIJ_LOONPATRONEN, eig, lc);
    // Zelfde regel als in de reeksen: alleen het deel boven de lonen die al in de W&V staan telt, naar rato per post.
    const som = k2.reduce((a, x) => a + x.bedrag, 0), inWv = Math.max(0, geldLoonPl(rec, geldLoonWv(ledgers, cfg.cijfers).set)), corr = Math.max(0, som - inWv), f = som ? corr / som : 0;
    const per = { netto: 0, loonheffing: 0, pensioen: 0 };
    const items = k2.map(x => { per[x.soort] += x.bedrag * f; return { soort: x.bron === 'factuur' ? x.doc : 'bankmutatie', loonsoort: x.soort, id: x.id, datum: x.datum, betaald: x.bedrag, bedrag: geldRond(x.bedrag * f), tegenpartij: x.tegenpartij, omschrijving: x.omschrijving,
      url: x.bron === 'factuur' ? geldUrl('documents', x.id) : geldUrl('financial_mutations', x.id) }; });
    return { items, totaal_wv: null, correctie: { betaald: geldRond(som), al_in_wv: geldRond(Math.min(som, inWv)), telt: geldRond(corr), per_soort: geldRondSoorten(per, corr) } };
  }
  const doel = new Set(reeks === 'kosten' ? Object.keys(idl.cat).filter(id => idl.cat[id] === cat) : reeks === 'prive' ? idl.prive.map(p => p.ledger) : reeks === 'aflossing' ? idl.aflossing : []);
  if (!doel.size) return { items, totaal_wv: 0 };
  const [mu, ink, bon] = await Promise.all([geldMutaties(get, van, tot, w),
    reeks === 'kosten' ? geldLijst(get, `documents/purchase_invoices?filter=period:${per}`, w, 'inkoopfacturen') : null,
    reeks === 'kosten' ? geldLijst(get, `documents/receipts?filter=period:${per}`, w, 'bonnetjes') : null]);
  for (const d of [...(ink ? ink.lijst : []), ...(bon ? bon.lijst : [])]) {
    const som = (d.details || []).filter(x => doel.has(String(x.ledger_account_id))).reduce((a, x) => a + geldGetal(x.total_price_excl_tax_with_discount_base != null ? x.total_price_excl_tax_with_discount_base : x.total_price_excl_tax_with_discount != null ? x.total_price_excl_tax_with_discount : geldGetal(x.price) * geldGetal(x.amount || 1)), 0);
    if (som) items.push({ soort: ink && ink.lijst.includes(d) ? 'inkoopfactuur' : 'bonnetje', id: String(d.id), nummer: String(d.reference || ''), datum: d.date || null, tegenpartij: naam(d.contact), bedrag: geldRond(som), url: geldUrl('documents', d.id) });
  }
  for (const m of mu.lijst) for (const b of (m.ledger_account_bookings || [])) if (doel.has(String(b.ledger_account_id))) {
    const amt = geldGetal(m.amount), x = (m.ledger_account_bookings.length === 1 ? amt : Math.sign(amt) * Math.abs(geldGetal(b.price)));
    items.push({ soort: 'bankmutatie', id: String(m.id), datum: m.date, tegenpartij: String(m.contra_account_name || '').slice(0, 60), omschrijving: String(m.message || '').slice(0, 100), bedrag: geldRond(-x), url: geldUrl('financial_mutations', m.id) });
  }
  const totaal = rec ? geldRond(reeks === 'kosten' ? [...doel].reduce((a, id) => a + ((rec.kosten || {})[id] || 0), 0) : [...doel].reduce((a, id) => a - ((rec.bank || {})[id] || 0), 0)) : null;
  return { items, totaal_wv: totaal, onvolledig: mu.onvolledig || !!(ink && ink.onvolledig) || !!(bon && bon.onvolledig) };
}
// Controle van het eerlijke beeld voor één jaar, per maand: betaald per soort, al in de W&V (welke grootboeken), telt,
// uitgesloten als eigenaar, en de uitgaande betalingen die (nog) niet herkend worden — om de instelling te controleren.
async function geldCijferDiagnose(env, jaar, cfg, ledgers) {
  const cc = cfg.cijfers || geldCijferCfgNorm(null), idl = geldCijferIndeling(ledgers, cc), huidig = geldVandaag().slice(0, 7);
  const bundel = (await kvJson(env, `${GELD_CIJ}jaar:${jaar}`)) || { maanden: {} }, lop = jaar === huidig.slice(0, 4) ? await kvJson(env, `${GELD_CIJ}maand:${huidig}`) : null;
  const recs = {}; for (const [mm, r] of Object.entries(bundel.maanden || {})) recs[`${jaar}-${mm}`] = r; if (lop) recs[huidig] = lop;
  const eig = geldEigenaren(Object.values(recs), idl, ledgers), pat = cc.loonpatronen || GELD_CIJ_LOONPATRONEN, wv = geldLoonWv(ledgers, cc), potLed = geldPotLedgers(cfg), lc = geldLoonCtx(ledgers, cc, potLed), lb = geldLoonBalans(ledgers, cc, potLed);
  // ruis uit "niet herkend": overboekingen naar de spaarpotten en aflossingen/leningen
  const potIban = new Set((cfg.potten || []).map(x => String((x.herkenning || {}).tegenrekening || '').replace(/\s+/g, '').toUpperCase()).filter(Boolean));
  // alleen echte potten en aflossingsgrootboeken; andere balansrekeningen (bv. een lonen-tussenrekening) blijven zichtbaar
  // oude records kennen alleen de naam: alleen gebruiken als álle grootboeken met die naam pot of aflossing zijn
  const ruisLed = new Set([...potLed, ...idl.aflossing]), ruisNaam = new Set();
  { const per = new Map(); for (const [id, l] of Object.entries(ledgers || {})) if (l && l.naam) { if (!per.has(l.naam)) per.set(l.naam, []); per.get(l.naam).push(id); }
    for (const [n, ids] of per) if (ids.every(id => ruisLed.has(id))) ruisNaam.add(n); }
  const ruis = x => (x.led ? ruisLed.has(x.led) : !!(x.grootboek && ruisNaam.has(x.grootboek))) || !!(x.iban && potIban.has(x.iban));
  const corrVan = cc.correctie_van || `${huidig.slice(0, 4)}-01`, nul = () => ({ netto: 0, loonheffing: 0, pensioen: 0 });
  const tot = { betaald: nul(), al_in_wv: 0, telt: 0, eigenaar_uitgesloten: 0 }, niet = new Map(), maanden = [];
  for (const m of Object.keys(recs).sort()) {
    const r = recs[m], ps = geldLoonPosten(r, pat, eig, lc), k2 = ps.filter(x => x.bron === 'bank').map(x => x.x), b = nul();
    for (const x of ps) b[x.soort] += x.bedrag;
    const viaBalans = ps.filter(x => x.bron === 'bank' && x.balans).reduce((a, x) => a + x.bedrag, 0), viaFactuur = ps.filter(x => x.bron === 'factuur').reduce((a, x) => a + x.bedrag, 0);
    const som = Object.values(b).reduce((a, x) => a + x, 0), inWv = Math.max(0, geldLoonPl(r, wv.set)), telt = m >= corrVan ? Math.max(0, som - inWv) : 0;
    const eigSom = (r.kand || []).filter(x => geldIsEigenaar(x, eig) && geldHeeftTrefwoord(x, pat)).reduce((a, x) => a + x.bedrag, 0);
    for (const x of r.kand || []) if (!k2.includes(x) && !geldIsEigenaar(x, eig) && !ruis(x)) {
      const k = x.iban || 'naam:' + String(x.tegenpartij || '').toLowerCase(), o = niet.get(k) || { iban: x.iban || '', tegenpartij: x.tegenpartij || '', n: 0, bedrag: 0, voorbeeld: x.omschrijving || '', grootboek: x.grootboek || '' };
      o.n++; o.bedrag += x.bedrag; niet.set(k, o);
    }
    for (const k of Object.keys(b)) tot.betaald[k] += b[k];
    tot.al_in_wv += Math.min(som, inWv); tot.telt += telt; tot.eigenaar_uitgesloten += eigSom;
    maanden.push({ maand: m, via_balans: geldRond(viaBalans), via_factuur: geldRond(viaFactuur), facturen_gehaald: Array.isArray(r.fact), betaald: Object.fromEntries(Object.entries(b).map(([k, x]) => [k, geldRond(x)])), al_in_wv: geldRond(Math.min(som, inWv)), telt: geldRond(telt), eigenaar_uitgesloten: geldRond(eigSom),
      wv_grootboeken: [...wv.set].filter(id => (r.kosten || {})[id]).map(id => ({ naam: (ledgers[id] || {}).naam || id, bedrag: geldRond(r.kosten[id]) })), versie: r.v || 1, in_correctie: m >= corrVan });
  }
  const alle = geldMaanden(`${jaar}-01`, jaar === huidig.slice(0, 4) ? huidig : `${jaar}-12`);
  return { jaar, correctie_van: corrVan, loonpatronen: pat, loon_balans: lb.lijst.map(x => ({ ledger: x.ledger, naam: (ledgers[x.ledger] || {}).naam || x.ledger, soort: x.soort })), loon_balans_bron: lb.bron, loon_wv: [...wv.set].map(id => (ledgers[id] || {}).naam || id), loon_wv_bron: wv.bron, loon_iban: cc.loon_iban || [],
    maanden, totaal: { betaald: Object.fromEntries(Object.entries(tot.betaald).map(([k, x]) => [k, geldRond(x)])), al_in_wv: geldRond(tot.al_in_wv), telt: geldRond(tot.telt), eigenaar_uitgesloten: geldRond(tot.eigenaar_uitgesloten) },
    niet_herkend: [...niet.values()].map(o => Object.assign(o, { bedrag: geldRond(o.bedrag) })).sort((a, b2) => b2.bedrag - a.bedrag).slice(0, 25), ontbrekend: alle.filter(m => !recs[m]) };
}
async function geldCijfersRoute(p, env, url, R, json) {
  const w = [], budget = { rest: GELD.budget }, get = geldMb(env, budget), cfg = await geldConfig(env), cc = cfg.cijfers || geldCijferCfgNorm(null);
  const ledgers = await geldLedgers(env, get, w);
  if (!ledgers) return json({ error: 'grootboeken niet op te halen', waarschuwingen: w }, 502);
  const idl = geldCijferIndeling(ledgers, cc), huidig = geldVandaag().slice(0, 7);
  if (p === '/geld/cijfers/indeling') {
    const rij = (id, l) => ({ ledger: id, naam: l.naam, soort: l.soort, categorie: idl.cat[id] || null, bron: idl.bron[id] || null });
    return json({ categorieen: GELD_CATS.map(([id, naam]) => ({ id, naam })), kosten: Object.entries(ledgers).filter(([id]) => idl.cat[id] !== undefined).map(([id, l]) => rij(id, l)).sort((a, b) => a.naam.localeCompare(b.naam)),
      eigen_vermogen: Object.entries(ledgers).filter(([, l]) => l.soort === 'equity').map(([id, l]) => ({ ledger: id, naam: l.naam })),
      schulden: Object.entries(ledgers).filter(([, l]) => l.soort === 'non_current_liabilities').map(([id, l]) => ({ ledger: id, naam: l.naam, soort: l.soort })),   // aflossing: alleen langlopend
      prive: idl.prive, prive_bron: idl.prive_bron, aflossing: idl.aflossing, aflossing_bron: idl.aflossing_bron, loonpatronen: cc.loonpatronen || GELD_CIJ_LOONPATRONEN,
      correctie_van: cc.correctie_van || `${huidig.slice(0, 4)}-01`, benchmarks: cc.benchmarks || GELD_CIJ_BRANCHE, benchmarks_bron: cc.benchmarks ? 'instelling' : 'standaard',
      loon_wv: [...geldLoonWv(ledgers, cc).set], loon_wv_bron: geldLoonWv(ledgers, cc).bron,
      loon_balans: geldLoonBalans(ledgers, cc, geldPotLedgers(cfg)).lijst, loon_balans_bron: geldLoonBalans(ledgers, cc, geldPotLedgers(cfg)).bron,
      balans_schulden: Object.entries(ledgers).filter(([id, l]) => geldBalansSoort(l.soort) && !geldPotLedgers(cfg).has(id)).map(([id, l]) => ({ ledger: id, naam: l.naam, soort: l.soort })).sort((a, b) => a.naam.localeCompare(b.naam)), loon_iban: R.geld === 'wijzigen' ? cc.loon_iban || [] : undefined, waarschuwingen: w });   // IBAN's alleen voor de eigenaar
  }
  if (p === '/geld/cijfers/diagnose') {                          // alleen de eigenaar (bevat tegenpartijen en IBAN's)
    if (R.geld !== 'wijzigen') return json({ error: 'geen-toegang', reden: 'geld-wijzigen' }, 403);
    const jaar = /^\d{4}$/.test(url.searchParams.get('jaar') || '') ? url.searchParams.get('jaar') : huidig.slice(0, 4);
    return json(Object.assign(await geldCijferDiagnose(env, jaar, cfg, ledgers), { waarschuwingen: w }));
  }
  if (p === '/geld/cijfers/detail') {
    const ym = String(url.searchParams.get('maand') || ''), reeks = String(url.searchParams.get('reeks') || ''), cat = String(url.searchParams.get('categorie') || '');
    if (!/^\d{4}-\d{2}$/.test(ym) || ym < GELD_CIJ_START || ym > huidig) return json({ error: `maand: JJJJ-MM, vanaf ${GELD_CIJ_START}` }, 400);
    if (!['omzet', 'kosten', 'prive', 'aflossing', 'correctie'].includes(reeks) || (reeks === 'kosten' && !GELD_CAT_IDS.has(cat))) return json({ error: 'reeks: omzet, kosten (met categorie), prive, aflossing of correctie' }, 400);
    const bundel = (await kvJson(env, `${GELD_CIJ}jaar:${ym.slice(0, 4)}`)) || { maanden: {} }, lop = ym.slice(0, 4) === huidig.slice(0, 4) ? await kvJson(env, `${GELD_CIJ}maand:${huidig}`) : null;
    const rec = ym === huidig ? lop : bundel.maanden[ym.slice(5)] || null, recsJaar = Object.values(bundel.maanden).concat(lop ? [lop] : []);
    const d = await geldCijferDetail(env, get, w, ym, reeks, cat, cfg, ledgers, idl, rec, recsJaar);
    d.items.sort((a, b) => Math.abs(b.bedrag) - Math.abs(a.bedrag));
    const som = geldRond(d.items.reduce((a, x) => a + x.bedrag, 0));
    return json({ maand: ym, reeks, categorie: cat || null, correctie: d.correctie || undefined, items: d.items.slice(0, 150), meer: Math.max(0, d.items.length - 150), som, totaal_wv: d.totaal_wv,
      rest: d.totaal_wv != null ? geldRond(d.totaal_wv - som) : null, onvolledig: !!d.onvolledig, waarschuwingen: w });
  }
  if (p !== '/geld/cijfers') return json({ error: 'onbekende-route' }, 404);
  const per = ['maand', 'kwartaal', 'jaar'].includes(url.searchParams.get('per')) ? url.searchParams.get('per') : 'maand';
  const van = /^\d{4}-\d{2}$/.test(url.searchParams.get('van') || '') ? url.searchParams.get('van') : `${huidig.slice(0, 4)}-01`;
  const tot = /^\d{4}-\d{2}$/.test(url.searchParams.get('tot') || '') ? url.searchParams.get('tot') : huidig;
  const maanden = geldMaanden(van < GELD_CIJ_START ? GELD_CIJ_START : van, tot > huidig ? huidig : tot);
  if (!maanden.length) return json({ error: 'van/tot: geen maanden in het bereik' }, 400);
  // Een jaar opnieuw opbouwen (bv. na late boekingen) mag alleen de eigenaar.
  const hb = url.searchParams.get('herbouw'), herbouwJaar = R.geld === 'wijzigen' && /^\d{4}$/.test(hb || '') && maanden.some(m => m.startsWith(hb)) ? hb : null;
  const { recs, ontbrekend, mislukt } = await geldCijferData(env, get, budget, maanden, cfg, ledgers, w, herbouwJaar);
  const r = geldCijferReeksen(recs, maanden, per, idl, ledgers, cc, cfg);
  const ni = Object.entries(r.niet_ingedeeld).map(([id, x]) => ({ ledger: id, naam: (ledgers[id] || {}).naam || id, bedrag: x }));
  return json({ per, van: maanden[0], tot: maanden[maanden.length - 1], perioden: r.perioden, categorieen: GELD_CATS.map(([id, naam]) => ({ id, naam })),
    benchmarks: cc.benchmarks || GELD_CIJ_BRANCHE, benchmarks_bron: cc.benchmarks ? 'instelling' : 'standaard', correctie_van: cc.correctie_van || `${huidig.slice(0, 4)}-01`,
    indeling_voorstel: Object.values(idl.bron).filter(x => x === 'voorstel').length, prive_namen: idl.prive.map(x => x.naam), niet_ingedeeld: ni,
    prive_bron: idl.prive_bron, equity_niet_ingedeeld: idl.prive_bron === 'voorstel' ? idl.equity_over : [], mislukt,
    ontbrekend, compleet: !ontbrekend.length, waarschuwingen: w, verzoeken: GELD.budget - budget.rest });
}

// ── Rapporten (G8) ──────────────────────────────────────────────────────────────
// Claude zet de rapporten met de CLI in KV (wrangler kv key put); de app leest ze, stelt vragen en vinkt acties af.
// geld:rapport:<JJJJ-MM-DD>                  het rapport (JSON)
// geld:rapport:index                         [{id, titel, periode}], nieuwste eerst
// geld:rapportvraag:<rapport>:<sectie>:<ts>  een vraag/opmerking {door, tekst, ts, status} (metadata {status})
//   …:<ts>:antwoord (of :antwoord-2 …)       het antwoord, door Claude erbij gezet {door, tekst, ts}
// geld:rapportactie:<rapport>:<actie>        afgevinkt {status, door, ts}: los van het rapport, dus een nieuwe versie wist dit niet
const GELD_RAP = 'geld:rapport:', GELD_RVR = 'geld:rapportvraag:', GELD_RAC = 'geld:rapportactie:';
const GELD_RAP_TEKST = 2000;   // max. tekens per vraag
const geldRapId = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null;
const GELD_RAP_PAGINAS = 50;        // KV-listing: hooguit 50 × 1000 sleutels, daarboven "onvolledig" (compleet: false)
const GELD_RAP_DRAAD = 300;         // per verzoek hooguit zoveel vragen met tekst lezen (de nieuwste)
const GELD_RAP_ANTW = 20;           // antwoorden per vraag
const GELD_RAP_VRAGEN_MAX = 500;    // vragen per rapport — bewust een zachte limiet (2-3 gebruikers; tellen en schrijven is niet atomair)
const GELD_RAP_TS = /^\d{10,16}(-[0-9a-f]{4,16})?$/;   // <ts> of <ts>-<rand>: elke vraag/elk antwoord een eigen sleutel, nooit overschrijven
const geldRapTs = () => `${Date.now()}-${randHex(4)}`;
const GELD_RAP_GERESERVEERD = new Set(['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString', 'valueOf', 'isPrototypeOf']);
const geldRapSleutel = s => /^[A-Za-z0-9_-]{1,40}$/.test(String(s || '')) && !GELD_RAP_GERESERVEERD.has(String(s)) ? String(s) : null;
async function geldInBatches(items, n, fn) { const uit = []; for (let i = 0; i < items.length; i += n) uit.push(...await Promise.all(items.slice(i, i + n).map(fn))); return uit; }
async function geldKvNamen(env, prefix, paginas = GELD_RAP_PAGINAS) {
  const keys = []; let cursor, n = 0;
  do { const r = await env.MT_ROLLEN.list({ prefix, cursor }); keys.push(...r.keys); cursor = r.list_complete ? null : r.cursor; } while (cursor && ++n < paginas);
  return { keys, compleet: !cursor };
}
// Vragen (van één rapport, of van alle): een vraag is open zolang er geen antwoord bij staat en de status 'open' is.
async function geldRapVragen(env, rapport, metTekst) {
  const { keys, compleet } = await geldKvNamen(env, GELD_RVR + (rapport ? rapport + ':' : ''));
  const vr = new Map(), antw = [];
  for (const k of keys) {
    const d = k.name.slice(GELD_RVR.length).split(':');                       // rapport, sectie, ts[, antwoord]
    if (d.length === 3 && geldRapId(d[0]) && geldRapSleutel(d[1]) && GELD_RAP_TS.test(d[2])) vr.set(k.name, { key: k.name, rapport_id: d[0], sectie_id: d[1], ts: Number(d[2].split('-')[0]), deel: d[2], meta: k.metadata || null, antwoorden: [] });
    else if ((d.length === 4 && /^antwoord(-\d{1,3})?$/.test(d[3])) || (d.length === 5 && d[3] === 'antwoord' && GELD_RAP_TS.test(d[4])))
      antw.push({ vraag: GELD_RVR + d.slice(0, 3).join(':'), key: k.name, volg: d.length === 5 ? Number(d[4].split('-')[0]) : Number((d[3].match(/-(\d+)$/) || [0, 1])[1]) });
  }
  for (const a of antw) { const x = vr.get(a.vraag); if (x) x.antwoorden.push(a); }
  const tekst = x => String(x == null ? '' : x).slice(0, 8000);
  const alle = [...vr.values()].sort((a, b) => a.ts - b.ts);
  // Met tekst: alleen de nieuwste GELD_RAP_DRAAD vragen (en per vraag GELD_RAP_ANTW antwoorden), parallel in kleine porties.
  const lezen = metTekst ? alle.slice(-GELD_RAP_DRAAD) : alle, afgekapt = metTekst && alle.length > lezen.length;
  const lijst = await geldInBatches(lezen, 25, async x => {
    const rec = metTekst ? (await kvJson(env, x.key)) || {} : null;
    const status = (rec && rec.status) || (x.meta && x.meta.status) || 'open';
    const item = { id: x.key.slice(GELD_RVR.length), rapport_id: x.rapport_id, sectie_id: x.sectie_id, ts: x.ts, vraag_ts: x.deel, status, open: status === 'open' && !x.antwoorden.length };
    if (metTekst) {
      Object.assign(item, { door: tekst(rec.door).slice(0, 80), tekst: tekst(rec.tekst) });
      const ak = x.antwoorden.sort((a, b) => a.volg - b.volg || a.key.localeCompare(b.key)).slice(0, GELD_RAP_ANTW);
      item.antwoorden = (await Promise.all(ak.map(a => kvJson(env, a.key)))).filter(Boolean).map(r => ({ door: tekst(r.door || 'Claude').slice(0, 80), tekst: tekst(r.tekst), ts: Number(r.ts) || null }));
      if (x.antwoorden.length > ak.length) item.antwoorden_afgekapt = true;
    }
    return item;
  });
  return { lijst, compleet, afgekapt };
}
// ── Rapporten schrijven, server-naar-server (headless Claude-run zonder wrangler) ──
// POST /geld/rapport/import {rapport}, POST /geld/rapport/antwoord {rapport_id, sectie_id, vraag_ts, tekst},
// GET /geld/rapport/vragen?status=open|alle. Alleen met header X-MT-Rapport-Key = secret RAPPORT_KEY (constant-time).
const GELD_RAP_SERVER = ['/geld/rapport/import', '/geld/rapport/antwoord', '/geld/rapport/vragen', '/geld/rapport/diagnose'];
const GELD_RAP_REEKSEN = ['omzet_kosten', 'omzet', 'kosten', 'brutomarge', 'resultaat', 'kosten_pct', 'opnames', 'kas', 'waterval'];   // grafieken die een sectie kan openen
const GELD_RAP_MAX = 200 * 1024;          // max. grootte van een rapport (bytes)
async function geldGelijk(a, b) {          // constant-time: vergelijk de SHA-256 van beide (lengte lekt niet)
  const e = new TextEncoder(), [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', e.encode(String(a))), crypto.subtle.digest('SHA-256', e.encode(String(b)))]);
  const u = new Uint8Array(x), w = new Uint8Array(y); let d = 0; for (let i = 0; i < u.length; i++) d |= u[i] ^ w[i]; return d === 0;
}
// Schema van een rapport: onbekende velden vallen weg, alles begrensd. Fout → { fout: 'pad: uitleg' }.
function geldRapportNorm(r) {
  const tk = (x, max, pad, nodig) => { if (x == null || x === '') { if (nodig) throw pad + ': verplicht'; return null; } if (typeof x !== 'string' && typeof x !== 'number') throw pad + ': tekst verwacht'; const t = String(x); if (t.length > max) throw `${pad}: hooguit ${max} tekens`; return t; };
  const lijst = (x, max, pad) => { if (x == null) return []; if (!Array.isArray(x)) throw pad + ': lijst verwacht'; if (x.length > max) throw `${pad}: hooguit ${max}`; return x; };
  const obj = (x, pad) => { if (!x || typeof x !== 'object' || Array.isArray(x)) throw pad + ': object verwacht'; return x; };
  try {
    obj(r, 'rapport');
    const id = geldRapId(r.id); if (!id) throw 'id: JJJJ-MM-DD';
    const sids = new Set(), aids = new Set();
    const secties = lijst(r.secties, 30, 'secties').map((x, i) => {
      const P = `secties[${i}]`; obj(x, P);
      const sid = geldRapSleutel(x.id); if (!sid) throw P + '.id: letters, cijfers, - of _ (max 40)'; if (sids.has(sid)) throw P + '.id: dubbel'; sids.add(sid);
      if (x.oordeel != null && !['groen', 'oranje', 'rood', 'neutraal'].includes(x.oordeel)) throw P + ".oordeel: groen, oranje, rood of neutraal";
      return { id: sid, titel: tk(x.titel, 200, P + '.titel', true), oordeel: x.oordeel || 'neutraal', kern: tk(x.kern, 1000, P + '.kern'),
        cijfers: lijst(x.cijfers, 40, P + '.cijfers').map((c, j) => { const Q = `${P}.cijfers[${j}]`; obj(c, Q); return { label: tk(c.label, 200, Q + '.label', true), waarde: tk(c.waarde, 200, Q + '.waarde'), branche: tk(c.branche, 200, Q + '.branche'), toelichting: tk(c.toelichting, 1000, Q + '.toelichting') }; }),
        tekst: tk(x.tekst, 20000, P + '.tekst'),
        acties: lijst(x.acties, 30, P + '.acties').map((a, j) => { const Q = `${P}.acties[${j}]`; obj(a, Q); const aid = geldRapSleutel(a.id); if (!aid) throw Q + '.id: letters, cijfers, - of _ (max 40)'; if (aids.has(aid)) throw Q + '.id: dubbel in dit rapport'; aids.add(aid);
          if (a.status != null && !['open', 'gedaan'].includes(a.status)) throw Q + ".status: open of gedaan"; return { id: aid, tekst: tk(a.tekst, 500, Q + '.tekst', true), wie: tk(a.wie, 80, Q + '.wie'), status: a.status || 'open' }; }),
        bronnen: lijst(x.bronnen, 20, P + '.bronnen').map((b, j) => { const Q = `${P}.bronnen[${j}]`; if (typeof b === 'string') return tk(b, 300, Q);
          obj(b, Q); const url = tk(b.url, 500, Q + '.url'); if (url && !/^https:\/\//i.test(url)) throw Q + '.url: alleen https://'; return { titel: tk(b.titel, 200, Q + '.titel'), url }; }),
        grafiek: x.grafiek == null ? null : (g => { obj(g, P + '.grafiek');                    // G9: de grafiek die bij deze sectie hoort
          if (!GELD_RAP_REEKSEN.includes(g.reeks)) throw `${P}.grafiek.reeks: ${GELD_RAP_REEKSEN.join(', ')}`;
          if (g.categorie != null && !GELD_CAT_IDS.has(g.categorie)) throw P + '.grafiek.categorie: onbekend';
          if (g.per != null && !['maand', 'kwartaal', 'jaar'].includes(g.per)) throw P + '.grafiek.per: maand, kwartaal of jaar';
          for (const k of ['van', 'tot']) if (g[k] != null && !/^\d{4}-\d{2}$/.test(String(g[k]))) throw `${P}.grafiek.${k}: JJJJ-MM`;
          return { reeks: g.reeks, categorie: g.categorie || null, per: g.per || null, van: g.van || null, tot: g.tot || null }; })(x.grafiek),
        advies: x.advies == null ? null : (a => { obj(a, P + '.advies');                       // G9: advies per horizon (kort / lang)
          return { kort: lijst(a.kort, 10, P + '.advies.kort').map((z, j) => tk(z, 1000, `${P}.advies.kort[${j}]`, true)), lang: lijst(a.lang, 10, P + '.advies.lang').map((z, j) => tk(z, 1000, `${P}.advies.lang[${j}]`, true)) }; })(x.advies) };
    });
    if (!secties.length) throw 'secties: minstens één';
    return { rapport: { id, titel: tk(r.titel, 200, 'titel', true), periode: tk(r.periode, 100, 'periode'), gemaakt: tk(r.gemaakt, 40, 'gemaakt'),
      samenvatting: lijst(r.samenvatting, 20, 'samenvatting').map((z, i) => tk(z, 1000, `samenvatting[${i}]`, true)), secties } };
  } catch (e) { return { fout: typeof e === 'string' ? e : 'ongeldig rapport' }; }
}
// Body lezen met een harde bytelimiet: eerst Content-Length, dan de stream (stopt zodra het te veel wordt). null = te groot.
async function geldLeesMax(request, max) {
  const cl = Number(request.headers.get('Content-Length'));
  if (isFinite(cl) && cl > max) return null;
  if (!request.body) return '';
  const r = request.body.getReader(), delen = []; let n = 0;
  for (;;) {
    const { done, value } = await r.read(); if (done) break;
    n += value.byteLength; if (n > max) { try { await r.cancel(); } catch {} return null; }
    delen.push(value);
  }
  const buf = new Uint8Array(n); let o = 0; for (const d of delen) { buf.set(d, o); o += d.byteLength; }
  return new TextDecoder().decode(buf);
}
async function geldRapportServer(p, request, env, json) {
  if (!env.RAPPORT_KEY) return json({ error: 'niet-ingesteld', uitleg: 'secret RAPPORT_KEY ontbreekt' }, 503);
  if (!(await geldGelijk(request.headers.get('X-MT-Rapport-Key') || '', env.RAPPORT_KEY))) return json({ error: 'Niet geautoriseerd' }, 401);
  if (!env.MT_ROLLEN) return json({ error: 'geen-opslag', uitleg: 'KV-binding MT_ROLLEN ontbreekt' }, 503);
  const m = request.method.toUpperCase(), wie = { door: 'rapport-key', doorNaam: 'Claude (rapporten)' };
  if (p === '/geld/rapport/diagnose') {                        // de controle van het eerlijke beeld, voor de geplande rapport-run
    if (m !== 'GET') return json({ error: 'alleen GET' }, 405);
    const u = new URL(request.url), jaar = /^\d{4}$/.test(u.searchParams.get('jaar') || '') ? u.searchParams.get('jaar') : geldVandaag().slice(0, 4), w = [];
    const cfg = await geldConfig(env), ledgers = await geldLedgers(env, geldMb(env, { rest: 3 }), w);
    if (!ledgers) return json({ error: 'grootboeken niet op te halen', waarschuwingen: w }, 502);
    return json(Object.assign(await geldCijferDiagnose(env, jaar, cfg, ledgers), { waarschuwingen: w }));
  }
  if (p === '/geld/rapport/vragen') {
    if (m !== 'GET') return json({ error: 'alleen GET' }, 405);
    const status = new URL(request.url).searchParams.get('status') || 'open';
    if (!['open', 'alle'].includes(status)) return json({ error: 'status: open of alle' }, 400);
    const vr = await geldRapVragen(env, null, true);
    return json({ vragen: vr.lijst.filter(x => status === 'alle' || x.open), compleet: vr.compleet });
  }
  if (m !== 'POST') return json({ error: 'alleen POST' }, 405);
  const ruw = await geldLeesMax(request, GELD_RAP_MAX);
  if (ruw == null) return json({ error: `te groot (max ${GELD_RAP_MAX / 1024} KB)` }, 413);
  let b; try { b = JSON.parse(ruw); } catch { return json({ error: 'geen geldige JSON' }, 400); }
  if (p === '/geld/rapport/import') {
    const n = geldRapportNorm(b); if (n.fout) return json({ error: 'schema', fout: n.fout }, 400);
    const r = n.rapport;
    await kvZet(env, GELD_RAP + r.id, r);
    // Index bijwerken (lezen-wijzigen-schrijven): er is één schrijver (de geplande Claude-run), de race is verwaarloosbaar.
    // Mist er toch een regel, dan herstelt GET /geld/rapporten die uit de KV-listing.
    const oud = await kvJson(env, GELD_RAP + 'index');
    const index = [{ id: r.id, titel: r.titel, periode: r.periode || '' }].concat((Array.isArray(oud) ? oud : []).filter(x => x && geldRapId(x.id) && x.id !== r.id))
      .sort((a, c) => c.id.localeCompare(a.id)).slice(0, 200);
    await kvZet(env, GELD_RAP + 'index', index);
    await audit(env, Object.assign({ actie: 'geld-rapport-import', doel: r.id, doelNaam: 'rapport geïmporteerd ' + r.id }, wie));   // zonder inhoud
    return json({ ok: true, id: r.id, secties: r.secties.length, index: index.length });
  }
  if (p === '/geld/rapport/antwoord') {
    const id = geldRapId(b && b.rapport_id), sec = geldRapSleutel(b && b.sectie_id), ts = String(b && b.vraag_ts != null ? b.vraag_ts : ''), tekst = String((b && b.tekst) == null ? '' : b.tekst).trim();
    if (!id || !sec || !GELD_RAP_TS.test(ts)) return json({ error: 'rapport_id, sectie_id en vraag_ts (uit /geld/rapport/vragen) verplicht' }, 400);
    if (!tekst || tekst.length > 8000) return json({ error: 'tekst: 1–8000 tekens' }, 400);
    const vk = `${GELD_RVR}${id}:${sec}:${ts}`, vraag = await kvJson(env, vk);
    if (!vraag) return json({ error: 'vraag niet gevonden' }, 404);
    const ak = `${vk}:antwoord:${geldRapTs()}`, nu = Date.now();
    await kvZet(env, ak, { door: 'Claude', tekst, ts: nu });
    await kvZet(env, vk, Object.assign({}, vraag, { status: 'beantwoord', beantwoord: nu }), { metadata: { status: 'beantwoord' } });
    await audit(env, Object.assign({ actie: 'geld-rapport-antwoord', doel: id, doelNaam: 'antwoord bij ' + sec }, wie));            // zonder de tekst
    return json({ ok: true, antwoord: ak.slice(GELD_RVR.length) });
  }
  return json({ error: 'onbekende-route' }, 404);
}
async function geldRapportRoute(p, request, env, ik, json, R, url) {
  const m = request.method.toUpperCase(), naam = String((ik.rec && ik.rec.naam) || ik.email || '').slice(0, 80);
  if (!env.MT_ROLLEN) return json({ error: 'geen-opslag', uitleg: 'KV-binding MT_ROLLEN ontbreekt' }, 503);
  if (p === '/geld/rapporten' && m === 'GET') {
    const index = await kvJson(env, GELD_RAP + 'index');
    let rapporten = (Array.isArray(index) ? index : []).filter(x => x && geldRapId(x.id)).slice(0, 200)
      .map(x => ({ id: x.id, titel: String(x.titel || x.id).slice(0, 200), periode: String(x.periode || '').slice(0, 100) }));
    // Herstelbaar: een rapport dat wel in KV staat maar niet in de index (bv. na een race), komt er alsnog bij.
    const bekend = new Set(rapporten.map(x => x.id));
    const mist = (await geldKvNamen(env, GELD_RAP)).keys.map(k => k.name.slice(GELD_RAP.length)).filter(x => geldRapId(x) && !bekend.has(x)).slice(0, 50);
    if (mist.length) {
      const extra = (await Promise.all(mist.map(async x => { const r = await kvJson(env, GELD_RAP + x); return r && typeof r === 'object' ? { id: x, titel: String(r.titel || x).slice(0, 200), periode: String(r.periode || '').slice(0, 100) } : null; }))).filter(Boolean);
      rapporten = rapporten.concat(extra).sort((a, c) => c.id.localeCompare(a.id)).slice(0, 200);
      if (extra.length) { try { await kvZet(env, GELD_RAP + 'index', rapporten); } catch {} }
    }
    const vr = await geldRapVragen(env, null, false), open = {};
    for (const x of vr.lijst) if (x.open) open[x.rapport_id] = (open[x.rapport_id] || 0) + 1;
    return json({ rapporten, open, open_totaal: Object.values(open).reduce((a, n) => a + n, 0), compleet: vr.compleet });
  }
  if (p === '/geld/rapport' && m === 'GET') {
    const id = geldRapId(url.searchParams.get('id')); if (!id) return json({ error: 'id: JJJJ-MM-DD' }, 400);
    const ruw = await kvJson(env, GELD_RAP + id); if (!ruw || typeof ruw !== 'object') return json({ error: 'rapport niet gevonden' }, 404);
    // Ook wat met de CLI in KV is gezet gaat door het schema (begrensd, onbekende velden weg) vóór het de app in gaat.
    const n = geldRapportNorm(Object.assign(Object.create(null), ruw, { id })); if (n.fout) return json({ error: 'rapport voldoet niet aan het schema', fout: n.fout }, 422);
    const rapport = n.rapport, vr = await geldRapVragen(env, id, true), acties = Object.create(null);
    for (const k of (await geldKvNamen(env, GELD_RAC + id + ':')).keys) {
      const aid = k.name.slice((GELD_RAC + id + ':').length), r = k.metadata || await kvJson(env, k.name);
      if (geldRapSleutel(aid) && r && ['open', 'gedaan'].includes(r.status)) acties[aid] = { status: r.status, door: String(r.door || '').slice(0, 80), ts: Number(r.ts) || null };
    }
    return json({ rapport, vragen: vr.lijst, acties, compleet: vr.compleet && !vr.afgekapt });
  }
  if (m !== 'POST') return json({ error: 'onbekende-route' }, 404);
  let b = {}; try { b = await request.json(); } catch {}
  const id = geldRapId(b.rapport_id); if (!id) return json({ error: 'rapport_id: JJJJ-MM-DD' }, 400);
  const ruw = await kvJson(env, GELD_RAP + id); if (!ruw || typeof ruw !== 'object') return json({ error: 'rapport niet gevonden' }, 404);
  const n = geldRapportNorm(Object.assign(Object.create(null), ruw, { id })); if (n.fout) return json({ error: 'rapport voldoet niet aan het schema', fout: n.fout }, 422);
  const rapport = n.rapport;
  if (p === '/geld/rapport/vraag') {                                          // eigenaar én administratie (sparren)
    const sec = geldRapSleutel(b.sectie_id), tekst = String(b.tekst == null ? '' : b.tekst).trim();
    if (!sec || !rapport.secties.some(x => x && String(x.id) === sec)) return json({ error: 'onbekende sectie' }, 400);
    if (!tekst || tekst.length > GELD_RAP_TEKST) return json({ error: `tekst: 1–${GELD_RAP_TEKST} tekens` }, 400);
    const al = (await geldKvNamen(env, GELD_RVR + id + ':')).keys.filter(k => k.name.slice(GELD_RVR.length).split(':').length === 3).length;
    if (al >= GELD_RAP_VRAGEN_MAX) return json({ error: `te veel vragen bij dit rapport (max ${GELD_RAP_VRAGEN_MAX})` }, 429);
    const deel = geldRapTs(), ts = Number(deel.split('-')[0]);                // eigen sleutel: overschrijft nooit een andere vraag
    const rec = { door: naam, tekst, ts, status: 'open', rapport_id: id, sectie_id: sec };
    await kvZet(env, `${GELD_RVR}${id}:${sec}:${deel}`, rec, { metadata: { status: 'open' } });
    await audit(env, { door: ik.oid, doorNaam: naam, actie: 'geld-rapport-vraag', doel: id, doelNaam: 'vraag bij ' + sec });   // zonder de tekst
    return json({ ok: true, vraag: { id: `${id}:${sec}:${deel}`, rapport_id: id, sectie_id: sec, ts, vraag_ts: deel, status: 'open', open: true, door: naam, tekst, antwoorden: [] } });
  }
  if (p === '/geld/rapport/actie') {                                          // alleen wie mag wijzigen
    if (R.geld !== 'wijzigen') return json({ error: 'geen-toegang', reden: 'geld-wijzigen' }, 403);
    const aid = geldRapSleutel(b.actie_id), status = String(b.status || '');
    if (!aid || !rapport.secties.some(x => x && Array.isArray(x.acties) && x.acties.some(a => a && String(a.id) === aid))) return json({ error: 'onbekende actie' }, 400);
    if (!['open', 'gedaan'].includes(status)) return json({ error: "status: 'open' of 'gedaan'" }, 400);
    const rec = { status, door: naam, ts: Date.now() };
    await kvZet(env, `${GELD_RAC}${id}:${aid}`, rec, { metadata: rec });
    await audit(env, { door: ik.oid, doorNaam: naam, actie: 'geld-rapport-actie', doel: id, doelNaam: `actie ${aid}: ${status}` });
    return json({ ok: true, actie: Object.assign({ id: aid }, rec) });
  }
  return json({ error: 'onbekende-route' }, 404);
}
async function handleGeld(p, request, env, ik, json0) {
  const ctx = {};
  const json = (b, st) => json0(ctx.versie && b && typeof b === 'object' && !Array.isArray(b) ? Object.assign(b, { cachever: ctx.versie }, ctx.ks ? { ks: ctx.ks } : {}) : b, st);
  // Recht `geld`, in élke ROLLEN_MODUS: lezen (eigenaar, administratie), wijzigen alleen de eigenaar.
  const R = RECHTEN[ik.rol], m = request.method, url = new URL(request.url);
  if (!R || !R.geld) return json({ error: 'geen-toegang', reden: 'geld' }, 403);
  if (p === '/geld/cijfers' || p.startsWith('/geld/cijfers/')) {
    if (m.toUpperCase() !== 'GET') return json({ error: 'alleen GET' }, 405);
    return await geldCijfersRoute(p, env, url, R, json);
  }
  // Rapporten: ook wie alleen mag lezen (administratie) mag er vragen bij stellen; afvinken alleen de eigenaar.
  if (p === '/geld/rapporten' || p === '/geld/rapport' || p.startsWith('/geld/rapport/')) return await geldRapportRoute(p, request, env, ik, json, R, url);
  if (!['GET', 'HEAD'].includes(m.toUpperCase()) && R.geld !== 'wijzigen') return json({ error: 'geen-toegang', reden: 'geld-wijzigen' }, 403);
  if (p === '/geld/tijdlijn' && m === 'GET') {
    let ver = await geldCacheVersie(env), vooruit = false;
    const cv = url.searchParams.get('cv');                   // versie uit het antwoord op een eigen wijziging (alleen voor wie mag wijzigen)
    if (R.geld === 'wijzigen' && /^\d{13}-[a-z0-9]{1,12}$/.test(cv || '') && cv.slice(0, 13) > String(ver).slice(0, 13)) { ver = cv; vooruit = true; }
    const key = `geld:cache:v${ver}:${url.searchParams.get('van') || ''}:${url.searchParams.get('tot') || ''}:${url.searchParams.get('historie') === '1' ? 'h' : ''}:${geldVandaag()}`;
    // Vers (cache overslaan) alleen voor wie mag wijzigen; lezers krijgen de gedeelde cache.
    // ks: net opgeslagen sleutels (alleen wie mag wijzigen) — die direct lezen; dan geen cache (vers, en niet terugschrijven).
    const ks = R.geld === 'wijzigen' ? String(url.searchParams.get('ks') || '').split(',').filter(k => /^(ov|pk|prognose|ijkpunt):[A-Za-z0-9_:.-]{1,90}$/.test(k)).slice(0, 10) : [];
    if (ks.length) vooruit = true;
    if (!ks.length && (url.searchParams.get('vers') !== '1' || R.geld !== 'wijzigen')) { const c = await kvJson(env, key); if (c) return json(Object.assign(c, { cache: true })); }
    const r = await geldTijdlijn(env, url, { ks });
    // Loopt deze edge achter (cv nieuwer dan KV hier ziet), dan niet cachen: de onderliggende gegevens kunnen hier ook nog oud zijn.
    if (r.status === 200 && env.MT_ROLLEN && !vooruit) { try { await kvZet(env, key, r.body, { expirationTtl: GELD.cacheTtl }); } catch {} }
    // (de cachesleutel bevat de versie van ná de laatste wijziging; een wijziging maakt een nieuwe, unieke versie)
    return json(r.body, r.status);
  }
  if (p === '/geld/ijkpunten' && m === 'GET') {
    try { return json({ ijkpunten: await geldIjkpunten(env, 50, geldRekeningen(await geldConfig(env)), 3) }); } catch (e) { return json({ error: 'ijkpunten niet te lezen' }, 503); }
  }
  if (p === '/geld/profiel' && m === 'GET') {
    // Lezen: eigenaar en administratie. (Her)berekenen alleen wie mag wijzigen; alleen een volledige berekening wordt bewaard.
    const oud = await kvJson(env, 'geld:profiel'), vers = url.searchParams.get('vers') === '1';
    if (oud && !vers) return json(oud);
    if (R.geld !== 'wijzigen') return vers ? json({ error: 'geen-toegang', reden: 'geld-wijzigen' }, 403) : json({ error: 'nog-niet-berekend', uitleg: 'het betaalprofiel is nog niet berekend (eigenaar)' }, 404);
    const prof = await geldProfielBereken(env);
    prof.opgeslagen = !!env.MT_ROLLEN && !prof.onvolledig;
    if (prof.opgeslagen) { await kvZet(env, 'geld:profiel', prof); await geldZetVersie(env, `${Date.now()}-p${randHex(3)}`, ctx); }
    return json(prof);
  }
  if (p === '/geld/overrides' && m === 'GET') return json(await geldOverrides(env, 3));
  if (p === '/geld/patronen' && m === 'GET') {
    // Zelfde regels als het betaalprofiel: lezen mag, (her)berekenen alleen de eigenaar, alleen volledig bewaren.
    const oud = await kvJson(env, 'geld:patronen'), vers = url.searchParams.get('vers') === '1', keuzes = await geldKvLijst(env, GELD_PK, 3);
    if (oud && !vers) return json(Object.assign(oud, { keuzes: keuzes.items }));
    if (R.geld !== 'wijzigen') return vers ? json({ error: 'geen-toegang', reden: 'geld-wijzigen' }, 403) : json({ error: 'nog-niet-berekend', uitleg: 'de vaste patronen zijn nog niet berekend (eigenaar)' }, 404);
    const pat = await geldPatronenBereken(env);
    pat.opgeslagen = !!env.MT_ROLLEN && !pat.onvolledig;
    if (pat.opgeslagen) { await kvZet(env, 'geld:patronen', pat); await geldZetVersie(env, `${Date.now()}-q${randHex(3)}`, ctx); }
    return json(Object.assign(pat, { keuzes: keuzes.items }));
  }
  if (p === '/geld/prognose' && m === 'GET') return json(await geldKvLijst(env, GELD_PROG, 3));
  if (p === '/geld/prognose' && m === 'POST') {
    if (!env.MT_ROLLEN) return json({ error: 'geen-opslag', uitleg: 'KV-binding MT_ROLLEN ontbreekt' }, 503);
    let b = {}; try { b = await request.json(); } catch {}
    const sleutel = String(b.sleutel || '');
    if (!/^p:[A-Za-z0-9_-]{1,40}$/.test(sleutel) && !/^h:[a-z0-9]{4,20}$/.test(sleutel)) return json({ error: 'sleutel: p:<project_id> of h:<id>' }, 400);
    const kv = GELD_PROG + sleutel, vorige = await kvJson(env, kv);
    if ((b.vorige_ts == null ? null : b.vorige_ts) !== (vorige ? vorige.ts : null)) return json({ error: 'deze prognose is intussen aangepast — herlaad en probeer opnieuw', huidig: vorige }, 409);
    let item = null;
    if (b.item !== null) {
      const n = geldPrognoseNorm(sleutel, b.item, geldVandaag());
      if (n.fout) return json({ error: n.fout }, 400);
      item = Object.assign(n.item, { door: String((ik.rec && ik.rec.naam) || ik.email || ik.oid).slice(0, 20), ts: Date.now() });
      if (new TextEncoder().encode(JSON.stringify(item)).byteLength > 1000) return json({ error: 'te groot — minder termijnen of kortere teksten' }, 400);   // KV-metadata ≤ 1024 bytes
    } else if (!vorige) return json({ error: 'er is geen prognose om te wissen' }, 400);
    const ts = item ? item.ts : Date.now();
    await kvZet(env, `geld:prognose-historie:${String(9e15 - ts).padStart(16, '0')}:${randHex(4)}`, { sleutel, vorige, nieuw: item });
    if (item) await kvZet(env, kv, item, { metadata: item }); else await env.MT_ROLLEN.delete(kv);
    ctx.ks = kv.slice(5);                                     // zonder 'geld:' — de app stuurt hem mee (KV-list loopt achter)
    await geldZetVersie(env, `${ts}-g${randHex(3)}`, ctx);
    await audit(env, { door: ik.oid, doorNaam: (ik.rec && ik.rec.naam) || ik.email || '', actie: 'geld-prognose', doel: sleutel, doelNaam: item ? (item.aan ? 'prognose aan' : 'prognose uit') : 'prognose gewist' });   // geen bedragen
    return json({ ok: true, item });
  }
  if (p === '/geld/patroon' && m === 'POST') {
    if (!env.MT_ROLLEN) return json({ error: 'geen-opslag', uitleg: 'KV-binding MT_ROLLEN ontbreekt' }, 503);
    let b = {}; try { b = await request.json(); } catch {}
    const id = String(b.id || '');
    if (!/^p[0-9a-f]{12}$/.test(id)) return json({ error: 'patroon-id ongeldig' }, 400);
    if (typeof b.aan !== 'boolean') return json({ error: 'aan: true of false' }, 400);
    const sleutel = GELD_PK + id, vorige = await kvJson(env, sleutel);
    if ((b.vorige_ts == null ? null : b.vorige_ts) !== (vorige ? vorige.ts : null)) return json({ error: 'dit patroon is intussen aangepast — herlaad en probeer opnieuw', huidig: vorige }, 409);
    const ts = Date.now(), door = String((ik.rec && ik.rec.naam) || ik.email || ik.oid).slice(0, 60), item = { aan: b.aan, reden: String(b.reden || '').slice(0, 120), door, ts };
    await kvZet(env, `geld:pk-historie:${String(9e15 - ts).padStart(16, '0')}:${randHex(4)}`, { sleutel: id, vorige, nieuw: item });
    await kvZet(env, sleutel, item, { metadata: item }); ctx.ks = sleutel.slice(5);
    await geldZetVersie(env, `${ts}-k${randHex(3)}`, ctx);
    await audit(env, { door: ik.oid, doorNaam: (ik.rec && ik.rec.naam) || ik.email || '', actie: 'geld-patroon', doel: id, doelNaam: b.aan ? 'patroon aan' : 'patroon uit' });
    return json({ ok: true, keuze: item });
  }
  if (p === '/geld/override' && m === 'POST') {
    if (!env.MT_ROLLEN) return json({ error: 'geen-opslag', uitleg: 'KV-binding MT_ROLLEN ontbreekt' }, 503);
    let b = {}; try { b = await request.json(); } catch {}
    const id = String(b.document_id || ''), soort = b.soort, type = b.type;
    if (!/^[a-z0-9]{1,40}$/i.test(id)) return json({ error: 'document_id ontbreekt' }, 400);
    if (!['inkoop', 'verkoop'].includes(soort)) return json({ error: "soort: 'inkoop' of 'verkoop'" }, 400);
    const sleutel = `${GELD_OV}${soort}:${id}`, vorige = await kvJson(env, sleutel), vandaag = geldVandaag();
    const binnen = d => geldIsDatum(d) && d >= '2000-01-01' && d <= geldDag(vandaag, 3 * 366);   // redelijke horizon (termijnen tot ± 2050)
    // Optimistische vergrendeling per factuur: wie een oude stand stuurt, overschrijft niet ongemerkt een nieuwere.
    if ((b.vorige_ts == null ? null : b.vorige_ts) !== (vorige ? vorige.ts : null)) return json({ error: 'deze factuur is intussen aangepast — herlaad en probeer opnieuw', huidig: vorige }, 409);
    let item = null;
    if (type === 'wissen') { if (!vorige) return json({ error: 'er is geen override voor deze factuur' }, 400); }
    else if (type === 'datum') {
      if (!binnen(b.datum)) return json({ error: 'datum (JJJJ-MM-DD, vanaf 2000, hooguit 3 jaar vooruit) ontbreekt' }, 400);
      item = { soort, type, datum: b.datum };
    } else if (type === 'afbetaling') {
      if (!(typeof b.bedrag === 'number' && isFinite(b.bedrag) && b.bedrag >= 0.01 && b.bedrag < 1e8)) return json({ error: 'bedrag per termijn: getal ≥ 0,01' }, 400);
      if (!binnen(b.eerste)) return json({ error: 'eerste termijn (JJJJ-MM-DD, vanaf 2000, hooguit 3 jaar vooruit) ontbreekt' }, 400);
      if (!['maand', 'week'].includes(b.interval || 'maand')) return json({ error: "interval: 'maand' of 'week'" }, 400);
      if (b.termijnen != null && !(Number.isInteger(b.termijnen) && b.termijnen > 0 && b.termijnen <= 240)) return json({ error: 'termijnen: geheel getal 1..240' }, 400);
      item = { soort, type, bedrag: geldRond(b.bedrag), eerste: b.eerste, interval: b.interval || 'maand', termijnen: b.termijnen || null };
    } else return json({ error: "type: 'datum', 'afbetaling' of 'wissen'" }, 400);
    const ts = Date.now(), door = String((ik.rec && ik.rec.naam) || ik.email || ik.oid).slice(0, 60);
    if (item) Object.assign(item, { reden: String(b.reden || '').slice(0, 120), door, ts });
    await kvZet(env, `geld:ov-historie:${String(9e15 - ts).padStart(16, '0')}:${randHex(4)}`, { sleutel: `${soort}:${id}`, vorige, nieuw: item, door, ts });   // elke wijziging bewaard
    if (item) await kvZet(env, sleutel, item, { metadata: item }); else await env.MT_ROLLEN.delete(sleutel);
    ctx.ks = sleutel.slice(5);
    await geldZetVersie(env, `${ts}-o${randHex(3)}`, ctx);
    await audit(env, { door: ik.oid, doorNaam: (ik.rec && ik.rec.naam) || ik.email || '', actie: 'geld-override', doel: `${soort}:${id}`, doelNaam: `${soort}factuur: ${type}` });   // geen bedragen
    return json({ ok: true, override: item });
  }
  if (p === '/geld/config' && m === 'GET') {
    const cfg = await geldConfig(env);
    // Voorstel voor potten: de grootboeken naast de bankrekening onder "financiële rekeningen" (namen live uit Moneybird).
    let voorstel = null;
    if (url.searchParams.get('voorstel') === '1' && R.geld === 'wijzigen') {
      const get = geldMb(env, { rest: 3 }), w = [];
      const [bal, la] = await Promise.all([get(`reports/balance_sheet`), get('ledger_accounts')]);
      if (bal.ok && la.ok && Array.isArray(la.data)) {
        const naam = new Map(la.data.map(x => [String(x.id), x.name]));
        const zoekOuder = o => { if (Array.isArray(o)) { for (const x of o) { const r = zoekOuder(x); if (r) return r; } return null; }
          if (o && typeof o === 'object') { if (Array.isArray(o.children) && o.children.some(c => String(c.ledger_account_id) === GELD.bank.ledger)) return o;
            for (const v of Object.values(o)) { if (v && typeof v === 'object') { const r = zoekOuder(v); if (r) return r; } } } return null; };
        const ouder = zoekOuder(bal.data);
        voorstel = ouder ? ouder.children.filter(c => String(c.ledger_account_id) !== GELD.bank.ledger).map(c => ({ ledger: String(c.ledger_account_id), naam: naam.get(String(c.ledger_account_id)) || '' })) : [];
      } else voorstel = { fout: 'Moneybird niet bereikbaar' };
    }
    // Vaste loonrekeningen (IBAN's en namen van werknemers) alleen voor de eigenaar, niet voor wie alleen mag lezen.
    if (R.geld !== 'wijzigen' && cfg.cijfers) cfg.cijfers = Object.assign({}, cfg.cijfers, { loon_iban: undefined });
    return json({ config: cfg, voorstel });
  }
  if (p === '/geld/config' && m === 'POST') {
    if (!env.MT_ROLLEN) return json({ error: 'geen-opslag', uitleg: 'KV-binding MT_ROLLEN ontbreekt' }, 503);
    let b = {}; try { b = await request.json(); } catch {}
    if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ error: 'ongeldige invoer' }, 400);
    const oud = await geldConfig(env), nieuw = Object.assign({}, oud), gewijzigd = [];
    // Optimistische vergrendeling: wie een oude stand stuurt, overschrijft niet ongemerkt een nieuwere.
    if (b.revisie !== oud.revisie) return json({ error: 'instellingen zijn intussen gewijzigd — herlaad en probeer opnieuw', revisie: oud.revisie }, 409);
    // Alleen meegestuurde onderdelen vervangen; ongeldige waarden weigeren (niet stil weglaten).
    if ('kredietlimiet' in b) { if (b.kredietlimiet !== null && !(typeof b.kredietlimiet === 'number' && isFinite(b.kredietlimiet) && b.kredietlimiet >= 0 && b.kredietlimiet <= 1e9)) return json({ error: 'kredietlimiet: getal ≥ 0 of null' }, 400); nieuw.kredietlimiet = b.kredietlimiet; gewijzigd.push('kredietlimiet'); }
    if ('potten' in b) {
      if (!Array.isArray(b.potten) || b.potten.length > 20) return json({ error: 'potten: lijst (max 20)' }, 400);
      const ids = new Set();
      for (const x of b.potten) {
        if (!x || !GELD_POT_ID.test(String(x.id)) || x.id === 'lopend' || ids.has(x.id)) return json({ error: 'pot-id ongeldig of dubbel (a-z, 0-9, -)', pot: x && x.id }, 400);
        if (x.doel != null && !GELD_POT_DOELEN.includes(x.doel)) return json({ error: 'onbekend doel', doelen: GELD_POT_DOELEN }, 400);
        if (x.ledger != null && x.ledger !== '' && !/^\d{6,25}$/.test(String(x.ledger))) return json({ error: 'ongeldig grootboek-id', pot: x.id }, 400);
        if (x.weekinleg != null && !(typeof x.weekinleg === 'number' && isFinite(x.weekinleg) && x.weekinleg >= 0)) return json({ error: 'weekinleg: getal ≥ 0 of null', pot: x.id }, 400);
        ids.add(x.id);
      }
      const ledgers = b.potten.map(x => x.ledger ? String(x.ledger) : '').filter(Boolean);
      if (new Set(ledgers).size !== ledgers.length) return json({ error: 'een grootboek kan maar bij één pot horen (anders telt het dubbel)' }, 400);
      // Een pot met ijkpunten niet verwijderen of naar een ander grootboek laten wijzen (dan klopt het ijkpunt niet meer).
      for (const o of oud.potten) {
        const n = b.potten.find(x => x.id === o.id);
        const heeftIjk = !n || String(n.ledger || '') !== String(o.ledger || '') ? (await env.MT_ROLLEN.list({ prefix: `${GELD_IJK}${o.id}:`, limit: 1 })).keys.length > 0 : false;
        if (heeftIjk && !n) return json({ error: `pot "${o.naam}" heeft ijkpunten — zet hem op inactief in plaats van verwijderen`, pot: o.id }, 400);
        if (heeftIjk) return json({ error: `pot "${o.naam}" heeft ijkpunten — grootboek niet wijzigen (maak een nieuwe pot)`, pot: o.id }, 400);
      }
      for (const n of b.potten) { const o = oud.potten.find(x => x.id === n.id); if (o && !!o.virtueel !== (n.virtueel === true)) return json({ error: `potje "${o.naam}": virtueel/echt kan na het aanmaken niet meer wisselen (maak een nieuw potje)`, pot: o.id }, 400); }
      nieuw.potten = b.potten; gewijzigd.push('potten');
    }
    if ('prognose_schema' in b) {
      const n = geldSchemaNorm(b.prognose_schema);
      if (b.prognose_schema !== null && (!n || ['klein', 'middel', 'groot'].some(k => Array.isArray(b.prognose_schema[k]) && b.prognose_schema[k].length && !n[k].length))) return json({ error: 'standaardschema: per grootte percentages die samen 100 zijn' }, 400);
      nieuw.prognose_schema = b.prognose_schema; gewijzigd.push('prognose_schema');
    }
    if ('reserve' in b) {
      if (b.reserve !== null && !(b.reserve && typeof b.reserve === 'object' && typeof b.reserve.bedrag === 'number' && isFinite(b.reserve.bedrag) && b.reserve.bedrag >= 0)) return json({ error: 'reserve: {bedrag ≥ 0, pot} of null' }, 400);
      if (b.reserve && b.reserve.pot != null && !(nieuw.potten || oud.potten).some(p => p.id === b.reserve.pot && !p.virtueel)) return json({ error: 'reserve.pot: onbekend potje' }, 400);
      if (b.reserve && b.reserve.pot != null && ((nieuw.potten || oud.potten).some(p => p.id === b.reserve.pot && p.doel === 'btw') || b.reserve.pot === ((nieuw.btw || oud.btw) || {}).spaarpot)) return json({ error: 'reserve.pot: niet de BTW-pot (die telt al mee in de lopende rekening)' }, 400);
      nieuw.reserve = b.reserve; gewijzigd.push('reserve');
    }
    if ('buffer_lopend' in b) { if (b.buffer_lopend !== null && !(typeof b.buffer_lopend === 'number' && isFinite(b.buffer_lopend))) return json({ error: 'buffer_lopend: getal of null' }, 400); nieuw.buffer_lopend = b.buffer_lopend; gewijzigd.push('buffer_lopend'); }
    if ('cijfers' in b) { if (b.cijfers !== null && (typeof b.cijfers !== 'object' || Array.isArray(b.cijfers))) return json({ error: 'cijfers: object of null' }, 400);
      const cb = b.cijfers || {};
      if (cb.loon_wv != null && (!Array.isArray(cb.loon_wv) || cb.loon_wv.length > 30 || cb.loon_wv.some(x => !geldId(x)) || new Set(cb.loon_wv.map(String)).size !== cb.loon_wv.length)) return json({ error: 'cijfers.loon_wv: lijst van hooguit 30 unieke grootboek-ids' }, 400);
      if (cb.loon_balans != null && (!Array.isArray(cb.loon_balans) || cb.loon_balans.length > 30 || cb.loon_balans.some(x => !x || !geldId(x.ledger) || !['netto', 'loonheffing', 'pensioen'].includes(x.soort))
        || new Set(cb.loon_balans.map(x => String(x.ledger))).size !== cb.loon_balans.length)) return json({ error: 'cijfers.loon_balans: lijst van hooguit 30 {ledger, soort netto/loonheffing/pensioen}, elk grootboek één keer' }, 400);
      if (Array.isArray(cb.loon_balans) && cb.loon_balans.length) {                // alleen bestaande balansgrootboeken, geen pot of bank
        const led = await geldLedgers(env, geldMb(env, { rest: 3 }), []);
        if (!led) return json({ error: 'grootboeken niet op te halen; probeer het zo opnieuw' }, 503);
        const pl2 = geldPotLedgers({ potten: nieuw.potten || oud.potten });
        const fout = cb.loon_balans.find(x => !led[String(x.ledger)] || !geldBalansSoort(led[String(x.ledger)].soort) || pl2.has(String(x.ledger)));
        if (fout) return json({ error: 'cijfers.loon_balans: alleen bestaande balansgrootboeken (activa of passiva, geen spaarpot of bank)', ledger: String(fout.ledger) }, 400);
      }
      if (cb.loon_iban != null) {
        if (!Array.isArray(cb.loon_iban) || cb.loon_iban.length > 60) return json({ error: 'cijfers.loon_iban: lijst van hooguit 60' }, 400);
        const ib = cb.loon_iban.map(x => x && typeof x === 'object' ? String(x.iban || '').replace(/\s+/g, '').toUpperCase() : '');
        if (ib.some(x => !/^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(x))) return json({ error: 'cijfers.loon_iban: ongeldig IBAN' }, 400);
        if (new Set(ib).size !== ib.length) return json({ error: 'cijfers.loon_iban: IBAN dubbel' }, 400);
        if (cb.loon_iban.some(x => !['netto', 'loonheffing', 'pensioen'].includes(x.soort))) return json({ error: "cijfers.loon_iban: soort netto, loonheffing of pensioen" }, 400);
        if (cb.loon_iban.some(x => x.naam != null && String(x.naam).length > 60)) return json({ error: 'cijfers.loon_iban: naam hooguit 60 tekens' }, 400);
      } nieuw.cijfers = b.cijfers; gewijzigd.push('cijfers'); }
    if ('spaarrente' in b) { if (b.spaarrente !== null && !(typeof b.spaarrente === 'number' && isFinite(b.spaarrente) && b.spaarrente >= 0 && b.spaarrente <= 0.2)) return json({ error: 'spaarrente: fractie per jaar tussen 0 en 0,2, of null' }, 400); nieuw.spaarrente = b.spaarrente; gewijzigd.push('spaarrente'); }
    if ('lopend_streef' in b) { if (b.lopend_streef !== null && (typeof b.lopend_streef !== 'object' || Array.isArray(b.lopend_streef))) return json({ error: 'lopend_streef: object of null' }, 400); nieuw.lopend_streef = b.lopend_streef; gewijzigd.push('lopend_streef'); }
    if ('klantgroepen' in b) {
      if (!Array.isArray(b.klantgroepen) || b.klantgroepen.length > 50) return json({ error: 'klantgroepen: lijst (max 50)' }, 400);
      const ids = new Set();
      for (const g of b.klantgroepen) {
        if (!g || !GELD_POT_ID.test(String(g.id)) || ids.has(g.id)) return json({ error: 'groep-id ongeldig of dubbel', groep: g && g.id }, 400);
        // Alleen een expliciete regel: een herkenbaar voorvoegsel (≥ 3 tekens) of een lijst contacten — niets gokken.
        if (!(String(g.prefix || '').trim().length >= 3 || (Array.isArray(g.contact_ids) && g.contact_ids.length))) return json({ error: 'groep heeft een voorvoegsel (≥ 3 tekens) of contactlijst nodig', groep: g.id }, 400);
        ids.add(g.id);
      }
      const cids = new Set(), pre = [];
      for (const g of b.klantgroepen) {
        for (const c of (Array.isArray(g.contact_ids) ? g.contact_ids : []).map(String)) { if (cids.has(c)) return json({ error: 'contact staat in twee klantgroepen', contact_id: c }, 400); cids.add(c); }
        const x = String(g.prefix || '').trim().toLowerCase();
        if (x && pre.some(y => y.startsWith(x) || x.startsWith(y))) return json({ error: 'voorvoegsels van klantgroepen overlappen', groep: g.id }, 400);
        if (x) pre.push(x);
      }
      nieuw.klantgroepen = b.klantgroepen; gewijzigd.push('klantgroepen');
    }
    if ('btw' in b) {
      const t = b.btw || {};
      if (t.spaarpercentage != null && !(typeof t.spaarpercentage === 'number' && t.spaarpercentage >= 0 && t.spaarpercentage <= 1)) return json({ error: 'btw.spaarpercentage: fractie tussen 0 en 1' }, 400);
      if (t.modus != null && !['in_lopend', 'apart'].includes(t.modus)) return json({ error: "btw.modus: 'in_lopend' of 'apart'" }, 400);
      nieuw.btw = Object.assign({}, oud.btw, t); gewijzigd.push('btw');
    }
    if (!gewijzigd.length) return json({ error: 'niets te wijzigen' }, 400);
    const ts = Date.now(), norm = geldConfigNorm(Object.assign(nieuw, { gewijzigd: new Date(ts).toISOString(), door: (ik.rec && ik.rec.naam) || ik.email || ik.oid, revisie: oud.revisie + 1 }));
    if ('btw' in b) for (const k of ['spaarpot', 'aangifte_van', 'terugboeking_van']) if (b.btw && b.btw[k] != null && norm.btw[k] !== b.btw[k]) return json({ error: `btw.${k}: onbekende rekening/pot` }, 400);
    await kvZet(env, `geld:config:historie:${String(9e15 - ts).padStart(16, '0')}:${randHex(4)}`, oud);   // vorige stand bewaard
    await kvZet(env, 'geld:config', norm);
    await geldZetVersie(env, `${ts}-c${randHex(3)}`, ctx);
    await audit(env, { door: ik.oid, doorNaam: (ik.rec && ik.rec.naam) || ik.email || '', actie: 'geld-config', doel: 'geld', doelNaam: 'instellingen: ' + gewijzigd.join(', ') });   // geen bedragen
    return json({ ok: true, config: norm });
  }
  if (p === '/geld/ijkpunt' && m === 'POST') {
    if (!env.MT_ROLLEN) return json({ error: 'geen-opslag', uitleg: 'KV-binding MT_ROLLEN ontbreekt' }, 503);
    let b = {}; try { b = await request.json(); } catch {}
    const rek = String(b.rekening || ''), bedrag = Number(b.bedrag), datum = String(b.datum || '');
    const rekeningen = geldRekeningen(await geldConfig(env));
    if (!rekeningen.includes(rek)) return json({ error: 'onbekende rekening of pot', rekeningen }, 400);
    if (typeof b.bedrag !== 'number' || !isFinite(bedrag) || Math.abs(bedrag) > 1e8) return json({ error: 'bedrag moet een getal zijn' }, 400);
    if (!geldIsDatum(datum) || datum > geldVandaag()) return json({ error: 'datum (JJJJ-MM-DD) mag niet in de toekomst liggen' }, 400);
    const ts = Date.now(), id = randHex(6);
    const rec = { id, rekening: rek, bedrag: geldRond(bedrag), datum, door: ik.oid, doorNaam: (ik.rec && ik.rec.naam) || ik.email || '', ts };
    await kvZet(env, `${GELD_IJK}${rek}:${String(9e15 - ts).padStart(16, '0')}:${id}`, rec, { metadata: rec }); ctx.ks = `${GELD_IJK}${rek}:${String(9e15 - ts).padStart(16, '0')}:${id}`.slice(5);
    await geldZetVersie(env, `${ts}-${id}`, ctx);                                          // unieke versie: cache meteen ongeldig (geen teller-race)
    await audit(env, { door: ik.oid, doorNaam: rec.doorNaam, actie: 'geld-ijkpunt', doel: rek, doelNaam: 'ijkpunt ' + datum });   // geen bedragen in het (voor beheerders leesbare) auditlog
    return json({ ok: true, ijkpunt: rec });
  }
  return json({ error: 'onbekende-route' }, 404);
}

// ── /me, /toegang en /beheer/* ────────────────────────────────────────────────
function meAntwoord(env, ik, payload) {
  return {
    oid: payload.oid, email: ik.email, naam: (ik.rec && ik.rec.naam) || payload.name || ik.email,
    rol: ik.rol, rolNaam: ik.rol ? ROL_NAAM[ik.rol] : null, actief: !!ik.rol, reden: ik.rol ? null : (ik.reden || 'onbekend'),
    modus: rollenModus(env), rechten: ik.rol ? RECHTEN[ik.rol] : null,
    // Vaste eigenaar via e-mail: zet deze oid (bovenaan) later in OWNER_OIDS.
    vasteEigenaar: ik.vast || undefined,
    ownerOidNogZetten: ik.vast === 'email' ? true : undefined,
  };
}
async function handleToegang(request, env, ik, payload, json) {
  if (request.method !== 'POST') return json({ error: 'POST verwacht' }, 405);
  if (ik.rol) return json({ ok: true, alToegang: true });
  if (!env.MT_ROLLEN) return json({ ok: false, error: 'geen-rollen-opslag' }, 503);
  let body = {}; try { body = await request.json(); } catch {}
  const bestaand = await kvJson(env, 'aanvraag:' + payload.oid);
  if (bestaand && Date.now() - bestaand.ts < 3600 * 1000) return json({ ok: true, alAangevraagd: true });
  const a = { oid: payload.oid, email: ik.email, naam: clip(payload.name, 80) || ik.email, bericht: clip(body && body.bericht, 300) || '', ts: Date.now() };
  await kvZet(env, 'aanvraag:' + payload.oid, a, { expirationTtl: 30 * DAG_S });
  await audit(env, { actie: 'toegang-aangevraagd', door: payload.oid, doorNaam: a.naam, doel: payload.oid, doelNaam: a.naam });
  return json({ ok: true });
}
async function lijstKV(env, prefix, max = 1000) {
  if (!env.MT_ROLLEN) return [];
  const uit = []; let cursor;
  do {
    const r = await env.MT_ROLLEN.list({ prefix, cursor, limit: Math.min(1000, max - uit.length) });
    for (const k of r.keys) { const v = await kvJson(env, k.name); if (v) uit.push(v); if (uit.length >= max) break; }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor && uit.length < max);
  return uit;
}
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;
// Wie mag wat aan een gebruiker veranderen (beheer-regels bovenop de matrix).
// `alle` = alle user-records (voor de laatste-eigenaar-toets); `deactiveren` = actief → uit.
function magBeheren(env, ik, doel, nieuweRol, alle, deactiveren) {
  if (nieuweRol != null && !ROLLEN.includes(nieuweRol)) return 'onbekende-rol';
  if (doel && (vasteEigenaar(env, doel.oid) || (doel.bron === 'owner_email' && vasteEigenaar(env, null, doel.email)))) return 'eigenaar-beschermd';
  if (doel && doel.oid === ik.oid) return 'niet-jezelf';
  if (ik.rol !== 'eigenaar' && ((doel && doel.role === 'eigenaar') || nieuweRol === 'eigenaar')) return 'alleen-eigenaar-mag-eigenaar';
  const wegAlsEigenaar = doel && doel.role === 'eigenaar' && doel.active !== false && ((nieuweRol != null && nieuweRol !== 'eigenaar') || deactiveren);
  if (wegAlsEigenaar && alle) {
    const eig = new Set([...ownerOids(env)]);
    for (const g of alle) if (g.role === 'eigenaar' && g.active !== false) eig.add(String(g.oid).toLowerCase());
    eig.delete(String(doel.oid).toLowerCase());
    if (!eig.size) return 'laatste-eigenaar';
  }
  return null;
}
function beheerVast(env, g) {
  return vasteEigenaar(env, g.oid) || (g.bron === 'owner_email' && vasteEigenaar(env, null, g.email)) || null;
}
async function handleBeheer(pathname, request, env, ik, json) {
  if (!(RECHTEN[ik.rol] && RECHTEN[ik.rol].beheer)) return json({ error: 'geen-toegang', reden: 'beheer' }, 403);
  if (!env.MT_ROLLEN) return json({ error: 'geen-rollen-opslag', uitleg: 'KV-binding MT_ROLLEN ontbreekt (zie wrangler.toml)' }, 503);
  const door = { door: ik.oid, doorNaam: (ik.rec && ik.rec.naam) || ik.email };
  const body = async () => { try { return await request.json(); } catch { return {}; } };
  const p = pathname, m = request.method;

  if (p === '/beheer/gebruikers' && m === 'GET') {
    const gebruikers = (await lijstKV(env, 'user:')).map(g => { const vast = beheerVast(env, g); return { ...g, rolNaam: ROL_NAAM[g.role] || g.role, beschermd: !!vast, vast }; });
    for (const o of ownerOids(env)) if (!gebruikers.some(g => String(g.oid).toLowerCase() === o))
      gebruikers.push({ oid: o, role: 'eigenaar', rolNaam: 'Eigenaar', active: true, naam: '(vaste eigenaar, nog niet ingelogd)', beschermd: true, vast: 'oid' });
    for (const e of ownerEmails(env)) if (!gebruikers.some(g => (g.email || '').toLowerCase() === e))
      gebruikers.push({ oid: '', email: e, role: 'eigenaar', rolNaam: 'Eigenaar', active: true, naam: '(vaste eigenaar via e-mail, nog niet ingelogd)', beschermd: true, vast: 'email' });
    return json({ gebruikers, uitnodigingen: await lijstKV(env, 'invite:'), aanvragen: await lijstKV(env, 'aanvraag:'),
      rollen: ROLLEN.map(r => ({ id: r, naam: ROL_NAAM[r] })), matrix: RECHTEN, modus: rollenModus(env), ik: ik.oid, ikRol: ik.rol });
  }
  if (p === '/beheer/uitnodigen' && m === 'POST') {
    const b = await body(), email = String(b.email || '').trim().toLowerCase(), rol = String(b.rol || '');
    if (!EMAIL_RE.test(email)) return json({ error: 'ongeldig-email' }, 400);
    const fout = magBeheren(env, ik, null, rol); if (fout) return json({ error: fout }, fout === 'onbekende-rol' ? 400 : 403);
    if ((await lijstKV(env, 'user:')).some(g => (g.email || '').toLowerCase() === email)) return json({ error: 'bestaat-al' }, 409);
    const inv = { email, role: rol, naam: clip(b.naam, 80) || '', createdBy: ik.oid, createdAt: Date.now(), verloopt: Date.now() + 30 * DAG_S * 1000 };
    await kvZet(env, 'invite:' + email, inv, { expirationTtl: 30 * DAG_S });
    await audit(env, { ...door, actie: 'uitgenodigd', doel: email, doelNaam: inv.naam || email, nieuw: rol });
    return json({ ok: true, uitnodiging: inv });
  }
  if (p === '/beheer/uitnodiging-intrekken' && m === 'POST') {
    const email = String((await body()).email || '').trim().toLowerCase();
    const inv = await kvJson(env, 'invite:' + email); if (!inv) return json({ error: 'niet-gevonden' }, 404);
    const fout = magBeheren(env, ik, null, inv.role); if (fout) return json({ error: fout }, 403);
    await env.MT_ROLLEN.delete('invite:' + email);
    await audit(env, { ...door, actie: 'uitnodiging-ingetrokken', doel: email, oud: inv.role });
    return json({ ok: true });
  }
  if (p === '/beheer/gebruiker' && m === 'POST') {
    const b = await body(), oid = String(b.oid || '');
    const doel = await kvJson(env, 'user:' + oid); if (!doel) return json({ error: 'niet-gevonden' }, 404);
    const nieuweRol = b.rol != null ? String(b.rol) : null, actief = b.actief != null ? !!b.actief : null;
    const fout = magBeheren(env, ik, doel, nieuweRol, await lijstKV(env, 'user:'), actief === false);
    if (fout) return json({ error: fout }, fout === 'onbekende-rol' ? 400 : fout === 'laatste-eigenaar' ? 409 : 403);
    const nieuw = { ...doel, updatedAt: Date.now() };
    if (nieuweRol != null && nieuweRol !== doel.role) { nieuw.role = nieuweRol; await audit(env, { ...door, actie: 'rol-gewijzigd', doel: oid, doelNaam: doel.naam, oud: doel.role, nieuw: nieuweRol }); }
    if (actief != null && actief !== (doel.active !== false)) { nieuw.active = actief; await audit(env, { ...door, actie: actief ? 'gereactiveerd' : 'gedeactiveerd', doel: oid, doelNaam: doel.naam }); }
    await schrijfGebruiker(env, nieuw);
    return json({ ok: true, gebruiker: nieuw });
  }
  if (p === '/beheer/aanvraag' && m === 'POST') {
    const b = await body(), oid = String(b.oid || '');
    const a = await kvJson(env, 'aanvraag:' + oid); if (!a) return json({ error: 'niet-gevonden' }, 404);
    if (b.weigeren) {
      await env.MT_ROLLEN.delete('aanvraag:' + oid);
      await audit(env, { ...door, actie: 'aanvraag-geweigerd', doel: oid, doelNaam: a.naam });
      return json({ ok: true });
    }
    const rol = String(b.rol || ''), fout = magBeheren(env, ik, { oid }, rol); if (fout) return json({ error: fout }, fout === 'onbekende-rol' ? 400 : 403);
    if (await kvJson(env, 'user:' + oid)) return json({ error: 'bestaat-al' }, 409);
    const rec = nieuweGebruiker(oid, rol, a.email, a.naam, ik.oid); rec.lastSeen = a.ts;
    await schrijfGebruiker(env, rec);
    await env.MT_ROLLEN.delete('aanvraag:' + oid);
    await audit(env, { ...door, actie: 'aanvraag-toegekend', doel: oid, doelNaam: a.naam, nieuw: rol });
    return json({ ok: true, gebruiker: rec });
  }
  // Centrale instelling wijzigen (alle pc's lezen hem bij het laden via /instellingen): alleen de eigenaar.
  if (p === '/beheer/instelling' && m === 'POST') {
    if (ik.rol !== 'eigenaar') return json({ error: 'alleen-eigenaar' }, 403);
    const b = await body(), d = b && INSTELLINGEN[b.sleutel];
    if (!d || !d.waarden.includes(b.waarde)) return json({ error: 'ongeldige-instelling' }, 400);
    const alle = await leesInstellingen(env), oud = alle[b.sleutel];
    if (oud !== b.waarde) {
      await kvZet(env, 'instelling:' + b.sleutel, { waarde: b.waarde, ts: Date.now(), door: ik.oid });
      await audit(env, { ...door, actie: 'instelling-gewijzigd', doel: b.sleutel, doelNaam: d.naam, oud, nieuw: b.waarde });
    }
    // De zojuist geschreven waarde teruggeven (KV is eventually consistent; andere pc's volgen binnen ±1 min).
    return json({ ok: true, instellingen: { ...alle, [b.sleutel]: b.waarde } });
  }
  if (p === '/beheer/audit' && m === 'GET') {
    const n = Math.max(1, Math.min(500, parseInt(new URL(request.url).searchParams.get('limit') || '100', 10) || 100));
    return json({ audit: await lijstKV(env, 'audit:', n) });
  }
  if (p === '/beheer/log' && m === 'GET') {
    const dagen = Math.max(1, Math.min(31, parseInt(new URL(request.url).searchParams.get('dagen') || '7', 10) || 7));
    const tot = { totaal: 0, geweigerd: 0, redenen: {}, proxy: {}, proxyTotaal: 0 }, perDag = [];
    for (let i = 0; i < dagen; i++) {
      const dag = new Date(Date.now() - i * DAG_S * 1000).toISOString().slice(0, 10);
      const s = await kvJson(env, 'stat:' + dag); if (!s) continue;
      perDag.push({ dag, totaal: s.totaal, geweigerd: s.geweigerd, proxy: s.proxyTotaal || 0 });
      tot.totaal += s.totaal; tot.geweigerd += s.geweigerd; tot.proxyTotaal += s.proxyTotaal || 0;
      for (const [k, n] of Object.entries(s.redenen || {})) tot.redenen[k] = (tot.redenen[k] || 0) + n;
      for (const [k, n] of Object.entries(s.proxy || {})) tot.proxy[k] = (tot.proxy[k] || 0) + n;
    }
    const proxyTop = Object.entries(tot.proxy).sort((a, b) => b[1] - a[1]).slice(0, 25)
      .map(([k, n]) => { const [target, actie, reden] = k.split('|'); return { target, actie, reden, n }; });
    const top = Object.entries(tot.redenen).sort((a, b) => b[1] - a[1]).slice(0, 25)
      .map(([k, n]) => { const [rol, actie, reden] = k.split('|'); return { rol, actie, reden, n }; });
    return json({ modus: rollenModus(env), proxyModus: proxyModus(env), dagen, totaal: tot.totaal, geweigerd: tot.geweigerd, perDag, top, proxyAfwijkingen: tot.proxyTotaal, proxyTop });
  }
  return json({ error: 'unknown-beheer-route' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://mtbart.github.io',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PATCH, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token, X-MT-Bevestiging, X-MT-Actie',
      'Access-Control-Expose-Headers': 'X-MT-Herhaald',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ...corsHeaders }
    });
    // Rapporten schrijven door de headless Claude-run (server-naar-server): alleen met X-MT-Rapport-Key, nooit met een MSAL-rol.
    { const pad = new URL(request.url).pathname; if (GELD_RAP_SERVER.includes(pad)) return await geldRapportServer(pad, request, env, json); }
    // Alleen het Microsoft-token (F1b: de X-Claude-Key-bypass is weg — er was geen gebruiker van).
    const authToken = request.headers.get('X-Auth-Token');
    const msPayload = authToken ? await validateToken(authToken) : null;
    if (!msPayload) return json({ error: 'Niet geautoriseerd' }, 401);

    try {
      const url = new URL(request.url);
      const modus = rollenModus(env);
      // Rollen mogen de tool niet platleggen: KV-storing → geen rol (vaste eigenaren blijven eigenaar).
      let ik;
      try { ik = await bepaalRol(env, msPayload, ctx); }
      catch (e) { const vast = vasteEigenaar(env, msPayload.oid, tokenEmail(msPayload)); ik = { rol: vast ? 'eigenaar' : null, rec: null, vast, reden: 'rollen-fout' }; }
      ik.oid = msPayload.oid; ik.email = tokenEmail(msPayload);

      // Eigen rol + rechten (front-end: tabs/knoppen verbergen — UI-gemak, geen beveiliging).
      if (url.pathname === '/me') return json(meAntwoord(env, ik, msPayload));
      // Toegang aanvragen (onbekende/gedeactiveerde gebruiker) → lijst in Beheer.
      if (url.pathname === '/toegang') return await handleToegang(request, env, ik, msPayload, json);
      // Gebruikersbeheer: in élke modus afgedwongen.
      if (url.pathname.startsWith('/beheer/')) return await handleBeheer(url.pathname, request, env, ik, json);
      // Werkcode-teller en centrale instellingen: eigen routes (zie handleTeller).
      if (url.pathname === '/instellingen' || url.pathname.startsWith('/teller/')) return await handleTeller(url.pathname, request, env, ik, json);
      // Geldtijdlijn en het financiële dashboard: recht `geld`, in élke ROLLEN_MODUS (zie handleGeld).
      if (url.pathname.startsWith('/geld/')) return await handleGeld(url.pathname, request, env, ik, json);
      if (url.pathname.startsWith('/dashboard/')) {
        const RG = RECHTEN[ik.rol], lees = ['GET', 'HEAD'].includes(request.method.toUpperCase());
        // Alleen de eigenaar: het oude dashboard rekent bij een cache-miss alles opnieuw uit (de administratie heeft het tabblad Geld).
        if (!RG || RG.geld !== 'wijzigen') return json({ error: 'geen-toegang', reden: RG && RG.geld ? 'geld-wijzigen' : 'geld' }, 403);
      }

      const isTrack = url.pathname === '/track' || url.pathname.startsWith('/track/');
      const isDash = url.pathname.startsWith('/dashboard/');
      const isMijn = url.pathname === '/mijn/toggl', isAanwezig = url.pathname === '/aanwezig';
      const eigenRoute = isTrack || isDash || isMijn || isAanwezig;
      const target = isTrack ? (['/track/online', '/track/usage'].includes(url.pathname) ? 'track_admin' : 'track')
        : isDash ? 'dashboard' : isMijn ? 'mijn' : isAanwezig ? 'aanwezig' : url.searchParams.get('target');
      const pad = eigenRoute ? url.pathname : (url.searchParams.get('path') || '');
      if (!eigenRoute && !veiligPad(pad)) return json({ error: 'ongeldig pad' }, 400);
      // Toggl-sleutel van deze gebruiker (eigen → secret → gedeeld), één keer per verzoek.
      const tgS = target === 'toggl' || target === 'toggl_focus' ? await togglSleutel(env, target === 'toggl_focus' ? 'focus' : 'track', msPayload) : null;

      // Matrix: 'log' = alles door + loggen wat geweigerd zóu worden; 'afdwingen' = weigeren.
      let beperkt = false;
      if (modus !== 'uit' && target !== 'track_admin') {
        // Body-sleutels alleen waar de matrix ernaar kijkt (Toggl Focus PATCH); dezelfde body gaat door.
        let velden = null;
        if (target === 'toggl_focus' && request.method === 'PATCH') {
          try { const j = await request.clone().json(); velden = j && typeof j === 'object' && !Array.isArray(j) ? Object.keys(j) : []; } catch { velden = []; }
        }
        let besluit = ik.rol ? requirePermission(ik.rol, target, request.method, pad, velden) : { ok: false, reden: ik.reden || 'geen-rol' };
        if (besluit.ok && (target === 'toggl' || target === 'toggl_focus') && ['eigen', 'eigen-lezen'].includes(RECHTEN[ik.rol].uren)
            && togglKlasse(target, pad) === 'uren' && !(tgS && (tgS.bron === 'eigen' || tgS.bron === 'secret'))) besluit = { ok: false, reden: 'uren-zonder-eigen-sleutel' };
        try { await noteerBesluit(env, ctx, { ...besluit, modus, rol: ik.rol, oid: ik.oid, target, actie: actieNaam(target, request.method, pad) }); } catch {}
        if (!besluit.ok && modus === 'afdwingen') return json({ error: 'geen-toegang', reden: besluit.reden, rol: ik.rol }, 403);
        beperkt = besluit.ok && !!besluit.beperkt && modus === 'afdwingen';
      }

      // F2/F3: proxy-contract + bevestiging bij Moneybird-schrijfacties ('log' = alleen loggen).
      const pm = proxyModus(env);
      if (pm !== 'uit' && !eigenRoute && PROXY_CONTRACT[target]) {
        let cBody = null;
        if (target === 'claude') { try { cBody = await request.clone().json(); } catch {} }
        // Bodygrootte: Content-Length, en zonder (of ongeldige) header gewoon nagemeten — zo geldt de
        // limiet ook bij chunked verzoeken.
        const cl = request.headers.get('content-length');
        let lengte = cl != null && cl !== '' && isFinite(Number(cl)) ? Number(cl) : null;
        if (lengte == null && !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
          try { lengte = (await request.clone().arrayBuffer()).byteLength; } catch { lengte = Infinity; }
        }
        let reden = toetsContract(target, request.method, target === 'moneybird_download' ? '' : pad, lengte, cBody);
        if (!reden && isMbSchrijf(target, request.method) && !BEVESTIG_RE.test(request.headers.get('X-MT-Bevestiging') || '')) reden = 'geen-bevestiging';
        if (reden) {
          try { await noteerProxy(env, ctx, { modus: pm, oid: ik.oid, target, actie: actieNaam(target, request.method, pad), reden }); } catch {}
          if (pm === 'afdwingen') return json({ error: 'buiten-contract', reden }, 403);
        }
      }

      if (isMijn) return await handleMijnToggl(request, env, ik, msPayload, json);
      if (isAanwezig) {
        if (!ik.rol) return json({ error: 'geen-toegang', reden: ik.reden || 'geen-rol' }, 403);
        return await handleAanwezig(env, json);
      }

      // Pad-gebaseerde tracking-routes (los van de ?target=-proxy hieronder).
      if (isTrack) {
        return await handleTrack(url.pathname, request, env, msPayload, corsHeaders, !!(RECHTEN[ik.rol] && RECHTEN[ik.rol].beheer));
      }

      // Dashboard-routes
      if (isDash) {
        return await handleDashboard(url.pathname, request, env, msPayload, corsHeaders);
      }

     if (target === 'claude') {
  const body = await request.text();
  const parsed = JSON.parse(body);
  delete parsed.api_key;
  parsed.stream = true;
  // Werkplaats: AI "beperkt" → kortere antwoorden.
  if (beperkt) parsed.max_tokens = Math.min(Number(parsed.max_tokens) || AI_BEPERKT_MAX_TOKENS, AI_BEPERKT_MAX_TOKENS);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.CLAUDE_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(parsed)
  });
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...corsHeaders
    }
  });

      } else if (target === 'moneybird_download') {
        const factuurId = url.searchParams.get('factuur_id');
        const bijlageId = url.searchParams.get('bijlage_id');
        if (!/^\d+$/.test(factuurId || '') || !/^\d+$/.test(bijlageId || '')) return json({ error: 'ongeldige id' }, 400);
        const response = await fetch(
          `https://moneybird.com/api/v2/342968480452052559/documents/purchase_invoices/${factuurId}/attachments/${bijlageId}/download`,
          { headers: { 'Authorization': `Bearer ${env.MONEYBIRD_KEY}` } }
        );
        if (!response.ok) {
          return new Response(JSON.stringify({ error: 'Download mislukt', status: response.status }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return new Response(JSON.stringify({ base64: btoa(binary) }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });

      } else if (target === 'moneybird') {
        const mbPath = url.searchParams.get('path');
        const method = request.method;
        const body = ['POST','PATCH'].includes(method) ? await request.text() : undefined;
        const mbFetch = () => fetch(`https://moneybird.com/api/v2/${mbPath}`, {
          method,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.MONEYBIRD_KEY}` },
          body
        });
        // F4: schrijfactie met X-MT-Actie → hooguit één keer uitvoeren (zie mbIdempotent).
        const actie = method !== 'GET' ? request.headers.get('X-MT-Actie') : null;
        if (actie && (env.MT_ACTIES || env.MT_ROLLEN)) return await mbIdempotent(env, ik, actie, method, mbPath, mbFetch, corsHeaders, body);
        const response = await mbFetch();
        const text = await response.text();
        return new Response(text, { status: response.status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

      } else if (target === 'moneybird_upload') {
        const mbPath = url.searchParams.get('path');
        const formData = await request.formData();
        const response = await fetch(`https://moneybird.com/api/v2/${mbPath}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.MONEYBIRD_KEY}` },
          body: formData
        });
        const text = await response.text();
        return new Response(text, { status: response.status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

      } else if (target === 'toggl') {
        const togglPath = url.searchParams.get('path');
        const method = request.method;
        const body = ['POST','PATCH','PUT'].includes(method) ? await request.text() : undefined;
        const token = btoa(`${tgS.sleutel}:api_token`);
        const response = await fetch(`https://api.track.toggl.com/api/v9/${togglPath}`, {
          method,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${token}` },
          body
        });
        const text = await response.text();
        return new Response(text, { status: response.status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

      } else if (target === 'toggl_focus') {
        // Toggl Focus API — Bearer auth, aparte base URL
        const focusPath = url.searchParams.get('path');
        const method = request.method;
        const body = ['POST','PATCH','PUT'].includes(method) ? await request.text() : undefined;
        const response = await fetch(`https://focus.toggl.com/api/${focusPath}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tgS.sleutel}`
          },
          body
        });
        const text = await response.text();
        return new Response(text, { status: response.status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

      } else if (target === 'toggl_admin_projects') {
        // Volledige workspace-projectenlijst met het admin-token. Gewone
        // gebruikers zien met hun eigen token geen privé-projecten waar ze
        // geen lid van zijn (Mathijs miste daardoor projecten in de app).
        // Bewust GET-only + pad-whitelist: alléén de projectenlijst, geen
        // andere admin-rechten via deze route.
        const apPath = url.searchParams.get('path') || '';
        if (request.method !== 'GET' || !/^workspaces\/\d+\/projects(\?[\w=&%.\-]*)?$/.test(apPath)) {
          return new Response('Forbidden', { status: 403, headers: corsHeaders });
        }
        const apToken = btoa(`${env.TOGGL_KEY}:api_token`);
        const apResp = await fetch(`https://api.track.toggl.com/api/v9/${apPath}`, {
          headers: { 'Authorization': `Basic ${apToken}` }
        });
        const apText = await apResp.text();
        return new Response(apText, { status: apResp.status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

      } else if (target === 'toggl_reports') {
        // Toggl Track Reports API v3 — Basic auth, aparte base. Aggregeert over ALLE
        // workspace-gebruikers (admin-token = TOGGL_KEY). Browser kan dit niet direct
        // (Reports-API stuurt geen CORS-headers) → daarom via deze proxy.
        const repPath = url.searchParams.get('path');
        const method = request.method;
        const body = ['POST','PATCH','PUT'].includes(method) ? await request.text() : undefined;
        const token = btoa(`${env.TOGGL_KEY}:api_token`);
        const response = await fetch(`https://api.track.toggl.com/reports/api/v3/${repPath}`, {
          method,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${token}` },
          body
        });
        const text = await response.text();
        return new Response(text, { status: response.status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      return new Response('Bad request', { status: 400, headers: corsHeaders });

    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
}
