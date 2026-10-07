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
    const horizon = url2.searchParams.get('horizon') || '90d';
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
function geldConfigNorm(c) {
  c = c && typeof c === 'object' ? c : {};
  const getal = (x, min, max) => (typeof x === 'number' && isFinite(x) && x >= min && x <= max) ? x : null;
  const potten = (Array.isArray(c.potten) ? c.potten : []).filter(p => p && GELD_POT_ID.test(String(p.id)) && p.id !== 'lopend').map(p => ({
    id: String(p.id), naam: String(p.naam || p.id).slice(0, 40), doel: GELD_POT_DOELEN.includes(p.doel) ? p.doel : 'overig',
    ledger: /^\d{6,25}$/.test(String(p.ledger || '')) ? String(p.ledger) : null,
    herkenning: { tegenrekening: String((p.herkenning && p.herkenning.tegenrekening) || '').replace(/\s+/g, '').toUpperCase().slice(0, 40),
      omschrijving: String((p.herkenning && p.herkenning.omschrijving) || '').trim().slice(0, 60) },
    weekinleg: getal(p.weekinleg, 0, 1e7), actief: p.actief !== false }));
  const ids = new Set(), uniek = potten.filter(p => !ids.has(p.id) && ids.add(p.id));
  const btw = c.btw && typeof c.btw === 'object' ? c.btw : {};
  const rek = x => (x === 'lopend' || uniek.some(p => p.id === x)) ? x : null;
  return { kredietlimiet: getal(c.kredietlimiet, 0, 1e9), potten: uniek,
    btw: { spaarpercentage: getal(btw.spaarpercentage, 0, 1), spaarpot: uniek.some(p => p.id === btw.spaarpot) ? btw.spaarpot : null,
      aangifte_van: rek(btw.aangifte_van), terugboeking_van: rek(btw.terugboeking_van) },
    gewijzigd: c.gewijzigd || null, door: c.door || null, revisie: Number.isInteger(c.revisie) ? c.revisie : 0 };
}
async function geldConfig(env) { return geldConfigNorm(await kvJson(env, 'geld:config')); }
const geldRekeningen = cfg => ['lopend', ...cfg.potten.map(p => p.id)];
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
function geldMb(env, budget) {
  const hdr = { Authorization: `Bearer ${env.MONEYBIRD_KEY}`, Accept: 'application/json' };
  return async function get(pad) {
    if (budget.rest <= 0) return { ok: false, status: 0, fout: 'budget-op' };
    budget.rest--;
    let r;
    try { r = await fetch(`https://moneybird.com/api/v2/${MB_ADMIN}/${pad}`, { headers: hdr }); }
    catch (e) { return { ok: false, status: 0, fout: 'netwerk: ' + String(e.message || e).slice(0, 80) }; }
    if (r.status === 429 && budget.rest > 0) {                       // één keer opnieuw na korte pauze
      await new Promise(res => setTimeout(res, 1000)); budget.rest--;
      try { r = await fetch(`https://moneybird.com/api/v2/${MB_ADMIN}/${pad}`, { headers: hdr }); } catch (e) { return { ok: false, status: 0, fout: 'netwerk' }; }
    }
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
  const vrij = !(m.payments || []).length && ids.every(id => potLedgers.has(id));
  const tekst = (String(m.message || '') + ' ' + String(m.contra_account_name || '')).toLowerCase();
  const tegen = String(m.contra_account_number || '').replace(/\s+/g, '').toUpperCase();
  // Zeker: grootboek of exacte tegenrekening. Alleen een omschrijving → "te bevestigen" (onzeker), want een
  // leveranciertekst kan toevallig overeenkomen en dan zou een echte uitgave als inleg verdwijnen.
  const zeker = potten.filter(p => p.actief && ((p.ledger && ids.length && ids.every(id => id === p.ledger)) ||
    (vrij && p.herkenning.tegenrekening && tegen && tegen === p.herkenning.tegenrekening)));
  const viaTekst = potten.filter(p => p.actief && vrij && !zeker.includes(p) && p.herkenning.omschrijving && tekst.includes(p.herkenning.omschrijving.toLowerCase()));
  const deels = ids.some(id => potLedgers.has(id)) && !ids.every(id => potLedgers.has(id));
  const kandidaten = [...new Set([...zeker, ...viaTekst, ...(deels ? potten.filter(p => p.ledger && ids.includes(p.ledger)) : [])].map(p => p.id))];
  if (zeker.length === 1 && !deels && !viaTekst.length) return { pot: zeker[0].id, onzeker: false, kandidaten };
  return { pot: null, onzeker: kandidaten.length > 0, kandidaten, alleenTekst: !zeker.length && !deels && viaTekst.length > 0 };
}
function geldBankEvent(m, potten) {
  const bedrag = geldRond(geldGetal(m.amount)), sp = geldPotVan(m, potten), betaling = (m.payments || [])[0] || null;
  const ev = {
    id: 'bank:' + m.id, bron: 'bank', richting: bedrag >= 0 ? 'in' : 'uit', bedrag, datum: m.date, datumtype: 'werkelijk', zekerheid: 'werkelijk',
    rekening: 'lopend', tegenpartij: m.contra_account_name || '', document_id: betaling ? betaling.invoice_id : null,
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
    rekening: 'lopend', tegenpartij: c.company_name || [c.firstname, c.lastname].filter(Boolean).join(' ') || '',
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
  const perioden = [[`20000101..${jaren[0] - 1}1231`, 'vóór ' + jaren[0]], ...jaren.map(j => [`${j}0101..${j}1231`, String(j)])];
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
async function geldIjkpunten(env, perRekening, rekeningen) {
  if (!env.MT_ROLLEN) return [];
  const uit = [];
  for (const rek of rekeningen) {
    const r = await env.MT_ROLLEN.list({ prefix: `${GELD_IJK}${rek}:`, limit: perRekening });
    for (const k of r.keys) { const v = await kvJson(env, k.name); if (v) uit.push(v); }
  }
  return uit.sort((a, b) => (b.ts - a.ts) || String(b.id).localeCompare(String(a.id)));
}
async function geldCacheVersie(env) { return (await kvJson(env, 'geld:cachever')) || '0'; }

async function geldTijdlijn(env, url) {
  const vandaag = geldVandaag(), w = [], budget = { rest: GELD.budget };   // + GELD.kvReserve voor KV (cache, ijkpunten)
  let van = url.searchParams.get('van') || geldDag(vandaag, -30), tot = url.searchParams.get('tot') || geldDag(vandaag, 90);
  if (!geldIsDatum(van) || !geldIsDatum(tot) || van > tot) return { status: 400, body: { error: 'ongeldige periode (van/tot = JJJJ-MM-DD, van ≤ tot)' } };
  if ((Date.parse(tot) - Date.parse(van)) / 864e5 > GELD.maxDagen) return { status: 400, body: { error: `periode te lang (max ${GELD.maxDagen} dagen)` } };
  const get = geldMb(env, budget);
  let cfg;
  try { cfg = await geldConfig(env); } catch (e) { cfg = geldConfigNorm(null); w.push({ bron: 'config', fout: 'instellingen niet te lezen (opslag)' }); }
  const potten = cfg.potten;                         // inactief = alleen niet meer herkennen; het saldo telt wel mee
  if (!potten.length) w.push({ bron: 'config', fout: 'nog geen spaarpotten ingesteld — overboekingen naar spaar worden niet herkend' });
  let ijk = [];
  try { ijk = await geldIjkpunten(env, 1, geldRekeningen(cfg)); }
  catch (e) { w.push({ bron: 'ijkpunt', fout: 'ijkpunten niet te lezen (opslag) — Moneybird-stand gebruikt' }); }
  const laatsteIjk = {};
  for (const i of ijk) if (!laatsteIjk[i.rekening]) laatsteIjk[i.rekening] = i;
  const balans = await geldBalans(get, vandaag, w, potten);
  // Mutaties nodig vanaf: de dag na het maandeinde (MB-stand), de dag na het oudste ijkpunt, en het begin van de tijdlijn.
  const vanaf = [geldDag(balans.maandeinde, 1), van, ...Object.values(laatsteIjk).map(i => geldDag(i.datum, 1))].filter(d => geldIsDatum(d) && d <= vandaag).sort()[0] || vandaag;
  const ondergrens = geldDag(vandaag, -GELD.maxDagen);
  if (vanaf < ondergrens) w.push({ bron: 'ijkpunt', fout: `ijkpunt ouder dan ${GELD.maxDagen} dagen — niet meegenomen, opnieuw ijken` });
  const mutVan = vanaf < ondergrens ? ondergrens : vanaf;
  const [muts, fact] = await Promise.all([geldMutaties(get, mutVan, vandaag, w), geldFacturen(get, vandaag, w)]);
  if (budget.rest <= 0) w.push({ bron: 'algemeen', fout: 'te veel Moneybird-verzoeken nodig — gegevens mogelijk onvolledig' });
  const bankEv = muts.lijst.map(m => geldBankEvent(m, potten)).sort((a, b) => a.datum.localeCompare(b.datum) || a.id.localeCompare(b.id));
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
  const factEv = [...fact.inkoop.map(d => geldFactuurEvent('inkoop', d, vandaag, w)), ...fact.verkoop.map(d => geldFactuurEvent('verkoop', d, vandaag, w))]
    .filter(e => e.bedrag !== 0);
  // Achterstallig en zonder datum altijd mee (nooit weg); verder alleen binnen de periode.
  events.push(...factEv.filter(e => e.achterstallig || !e.datum || (e.datum >= van && e.datum <= tot)));
  for (const rek of Object.keys(laatsteIjk)) { const i = laatsteIjk[rek];
    if (i.datum >= van && i.datum <= tot) events.push({ id: 'ijkpunt:' + i.id, bron: 'ijkpunt', richting: 'in', bedrag: i.bedrag, datum: i.datum, datumtype: 'werkelijk', zekerheid: 'werkelijk', rekening: rek, tegenpartij: '', document_id: null, bron_url: null, uitleg: 'IJkpunt: eindsaldo van deze dag (ingevuld door ' + (i.doorNaam || i.door || '?') + ').', saldo_ijkpunt: true }); }
  const buiten = factEv.filter(e => e.datum && !e.achterstallig && (e.datum < van || e.datum > tot)).length;
  return { status: 200, body: {
    vandaag, van, tot, as_of: new Date().toISOString(),
    bronnen: { bankmutaties: { as_of: new Date().toISOString(), van: mutVan, tot: vandaag, aantal: muts.lijst.length, onvolledig: muts.onvolledig },
      facturen: { as_of: new Date().toISOString(), jaren: fact.jaren, inkoop: fact.inkoop.length, verkoop: fact.verkoop.length, buiten_periode: buiten, onvolledig: fact.onvolledig },
      balans: { as_of: new Date().toISOString(), maandeinde: balans.maandeinde, gevonden: !!metBalans } },
    saldo, events, waarschuwingen: w, verzoeken: GELD.budget - budget.rest,
    instellingen: { kredietlimiet: cfg.kredietlimiet, potten: cfg.potten.map(p => ({ id: p.id, naam: p.naam, doel: p.doel, actief: p.actief, weekinleg: p.weekinleg })), btw: cfg.btw },
  } };
}
async function handleGeld(p, request, env, ik, json) {
  // Recht `geld`, in élke ROLLEN_MODUS: lezen (eigenaar, administratie), wijzigen alleen de eigenaar.
  const R = RECHTEN[ik.rol], m = request.method, url = new URL(request.url);
  if (!R || !R.geld) return json({ error: 'geen-toegang', reden: 'geld' }, 403);
  if (!['GET', 'HEAD'].includes(m.toUpperCase()) && R.geld !== 'wijzigen') return json({ error: 'geen-toegang', reden: 'geld-wijzigen' }, 403);
  if (p === '/geld/tijdlijn' && m === 'GET') {
    const ver = await geldCacheVersie(env), key = `geld:cache:v${ver}:${url.searchParams.get('van') || ''}:${url.searchParams.get('tot') || ''}:${geldVandaag()}`;
    if (url.searchParams.get('vers') !== '1') { const c = await kvJson(env, key); if (c) return json(Object.assign(c, { cache: true })); }
    const r = await geldTijdlijn(env, url);
    if (r.status === 200 && env.MT_ROLLEN) { try { await kvZet(env, key, r.body, { expirationTtl: GELD.cacheTtl }); } catch {} }
    // (de cachesleutel bevat de versie van ná de laatste wijziging; een wijziging maakt een nieuwe, unieke versie)
    return json(r.body, r.status);
  }
  if (p === '/geld/ijkpunten' && m === 'GET') {
    try { return json({ ijkpunten: await geldIjkpunten(env, 50, geldRekeningen(await geldConfig(env))) }); } catch (e) { return json({ error: 'ijkpunten niet te lezen' }, 503); }
  }
  if (p === '/geld/config' && m === 'GET') {
    const cfg = await geldConfig(env);
    // Voorstel voor potten: de grootboeken naast de bankrekening onder "financiële rekeningen" (namen live uit Moneybird).
    let voorstel = null;
    if (url.searchParams.get('voorstel') === '1') {
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
      nieuw.potten = b.potten; gewijzigd.push('potten');
    }
    if ('btw' in b) {
      const t = b.btw || {};
      if (t.spaarpercentage != null && !(typeof t.spaarpercentage === 'number' && t.spaarpercentage >= 0 && t.spaarpercentage <= 1)) return json({ error: 'btw.spaarpercentage: fractie tussen 0 en 1' }, 400);
      nieuw.btw = Object.assign({}, oud.btw, t); gewijzigd.push('btw');
    }
    if (!gewijzigd.length) return json({ error: 'niets te wijzigen' }, 400);
    const ts = Date.now(), norm = geldConfigNorm(Object.assign(nieuw, { gewijzigd: new Date(ts).toISOString(), door: (ik.rec && ik.rec.naam) || ik.email || ik.oid, revisie: oud.revisie + 1 }));
    if ('btw' in b) for (const k of ['spaarpot', 'aangifte_van', 'terugboeking_van']) if (b.btw && b.btw[k] != null && norm.btw[k] !== b.btw[k]) return json({ error: `btw.${k}: onbekende rekening/pot` }, 400);
    await kvZet(env, `geld:config:historie:${String(9e15 - ts).padStart(16, '0')}:${randHex(4)}`, oud);   // vorige stand bewaard
    await kvZet(env, 'geld:config', norm);
    await kvZet(env, 'geld:cachever', `${ts}-c${randHex(3)}`);
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
    await kvZet(env, `${GELD_IJK}${rek}:${String(9e15 - ts).padStart(16, '0')}:${id}`, rec);
    await kvZet(env, 'geld:cachever', `${ts}-${id}`);                                          // unieke versie: cache meteen ongeldig (geen teller-race)
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
        if (!RG || !RG.geld || (!lees && RG.geld !== 'wijzigen')) return json({ error: 'geen-toegang', reden: RG && RG.geld ? 'geld-wijzigen' : 'geld' }, 403);
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
