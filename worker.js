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
// ── CSP-rapporten (POST /csp-rapport, zonder login: een browser stuurt ze zonder token) ───────────────────────────────────────────────
// De pagina's draaien met een afgedwongen minimale meta-CSP (object-src 'none'; base-uri 'self') en op Cloudflare Pages met een Report-Only-CSP (_headers).
// Een overtreding komt hier binnen. We bewaren ALLEEN de directive (bv. script-src-elem) en het host van het geblokkeerde ding (bv. cdn.example.com, of
// "inline"/"eval"/"data"/"blob"): nooit de pagina-url met pad of query, de broncode (sample), de bronregel, het beleid of de referrer. Alleen tellers per dag,
// bijgehouden in de teller-DO (MT_TELLER, instantie csp; NOOIT in KV: dit endpoint is open en KV heeft een dagelijkse schrijflimiet die ook de Koersmeter en de
// zoekindex nodig hebben), getoond in /beheer/log als cspTop. Begrensd: grootte, aantal per bericht, aantal per minuut per isolate, en in de DO een globaal
// budget per minuut en per dag (daarna alleen 204 zonder opslag) en een maximum aantal verschillende sleutels.
const CSP_MAX_BODY = 16384, CSP_PER_MIN = 120, CSP_PER_BERICHT = 10, CSP_DO_PER_MIN = 60, CSP_DO_DAGBUDGET = 500, CSP_MAX_SLEUTELS = 200, CSP_BEWAAR_DAGEN = 35;
const CSP_KOP = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', 'Cache-Control': 'no-store' };
const _cspVenster = { t: 0, n: 0 };
const _cspStop = { tot: 0, dag: '' };   // DO-budget op: tot dat tijdstip (minuut) of voor die dag geen DO-aanroep meer vanuit deze isolate
const cspGestopt = () => Date.now() < _cspStop.tot || (_cspStop.dag !== '' && _cspStop.dag === new Date().toISOString().slice(0, 10));
function cspHost(u) {
  const s = String(u == null ? '' : u).trim().toLowerCase();
  if (!s) return 'leeg';
  if (['inline', 'eval', 'self', 'data', 'blob', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink'].includes(s)) return s;
  if (s.startsWith('data:')) return 'data'; if (s.startsWith('blob:')) return 'blob';
  try {
    const x = new URL(s), schema = x.protocol.replace(':', '');
    if (!['http', 'https', 'ws', 'wss'].includes(schema)) return /^[a-z-]{2,30}$/.test(schema) ? 'schema:' + schema : 'onbekend';
    return /^[a-z0-9.-]{1,80}$/.test(x.hostname) ? x.hostname : 'ongeldig';
  } catch { return 'onbekend'; }
}
function cspVeld(b) {   // b = het rapportlichaam (oud: csp-report; nieuw: Reporting API body)
  if (!b || typeof b !== 'object') return null;
  const d = String(b['effective-directive'] || b.effectiveDirective || b['violated-directive'] || b.violatedDirective || '').trim().split(/\s+/)[0].toLowerCase();
  return { directive: /^[a-z][a-z-]{1,40}$/.test(d) ? d : 'onbekend', host: cspHost(b['blocked-uri'] !== undefined ? b['blocked-uri'] : b.blockedURL !== undefined ? b.blockedURL : b.blockedUri) };
}
async function cspRapport(request, env, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CSP_KOP });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: CSP_KOP });
  if (cspGestopt()) return new Response(null, { status: 204, headers: CSP_KOP });   // budget in de DO op: alleen een lege 204, geen DO-aanroep, geen schrijfactie
  const cl = Number(request.headers.get('content-length'));
  if (isFinite(cl) && cl > CSP_MAX_BODY) return new Response(null, { status: 413, headers: CSP_KOP });
  let tekst = ''; try { tekst = await request.text(); } catch { return new Response(null, { status: 400, headers: CSP_KOP }); }
  if (tekst.length > CSP_MAX_BODY) return new Response(null, { status: 413, headers: CSP_KOP });
  let j = null; try { j = JSON.parse(tekst); } catch {}
  const lijst = Array.isArray(j) ? j.filter(r => r && typeof r === 'object' && (r.type === undefined || r.type === 'csp-violation')).map(r => r.body)
    : j && typeof j === 'object' && j['csp-report'] ? [j['csp-report']] : [];
  const nu = Date.now(); if (nu - _cspVenster.t > 60000) { _cspVenster.t = nu; _cspVenster.n = 0; }
  const items = [];
  for (const b of lijst.slice(0, CSP_PER_BERICHT)) {
    if (_cspVenster.n >= CSP_PER_MIN) break;
    const v = cspVeld(b); if (!v) continue;
    _cspVenster.n++; items.push(v.directive + '|' + v.host);
    console.log(JSON.stringify({ csp: v.directive, host: v.host }));
  }
  // Tellen in de DO (nooit KV); zonder binding of bij een fout gaat het rapport verloren, de browser merkt niets.
  if (items.length && env.MT_TELLER && env.MT_TELLER.idFromName) waitUntil(ctx, (async () => { try {
    const dag = new Date().toISOString().slice(0, 10), x = await env.MT_TELLER.get(env.MT_TELLER.idFromName('csp')).fetch('https://mt-teller/csp-tel', { method: 'POST', body: JSON.stringify({ dag, nu: Date.now(), items }) });
    const j = await x.json().catch(() => null);
    if (j && j.vol === 'dag') _cspStop.dag = dag; else if (j && j.vol === 'minuut') _cspStop.tot = Number(j.tot) || Date.now() + 60000;
  } catch {} })());
  return new Response(null, { status: 204, headers: CSP_KOP });
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
// ── Projectnummers (brok B) ──
// Eén doorlopende reeks zonder jaar: het eerste nummer is 260801, daarna +1 (ook na de jaarwisseling), nooit hergebruikt —
// ook niet na een terugrol (het nummer wordt dan "ingetrokken"). Uitgifte idempotent per project_id. Bestaande W-codes blijven
// gelden; het aliasregister (`alias:<oud>` → project_id) en `pid:<project_id>` (code, nummer, aliassen) geven de binding.
// De nieuwe reeks staat achter een vlag in deze DO (`cfg:reeks`, standaard UIT): pas als die aan staat, geeft de teller voor
// nieuwe projecten nummers uit in plaats van W-codes, en alleen aan een app die nummers aankan (schema ≥ NR_MIN_SCHEMA).
// Omnummeren van bestaande projecten = een migratie: droogloop (plan + hash) → toepassen (alleen met die hash, atomair) →
// status → terugrol (alleen zolang alles nog precies is zoals de migratie het achterliet; anders conflict).
// Audit: elk uitgegeven nummer, elke migratie, terugrol en elk conflict komt als `log:<volgnummer>` in dezelfde schrijfactie
// (actor, project_id, oud, nieuw, migratie-id, resultaat) en daarnaast samengevat in de KV-audit.
const NR_START = 260801;
const NR_MIN_SCHEMA = 3;                 // v2.html PROJ_SCHEMA: pas vanaf 3 (brok C: mappen, Toggl, mobiel, uren lezen nummers) krijgt de cockpit nummers
const NR_MIG_MAX = 15;                   // × ≤ 7 sleutels (pid, nr, ≤ 4 aliassen, log) + 3 ≤ 128 sleutels per put (DO-limiet)
const NR_ALIAS_MAX = 3;                  // extra oude codes per project, naast de W-code
const NR_ALIAS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/;
const NR_MIG_RE = /^m_[0-9a-z]{6,40}$/;
const NR_WCODE_RE = /^W\d{2}-\d{3,}$/;
// Schemaversie van de cockpit (v2.html PROJ_SCHEMA) staat hier en NIET in mt_projecten.json: oudere apps (uren) gooien
// records zonder code daar weg. `cfg:schema_min` = de laagste versie die mt_projecten nog mag schrijven (standaard 2;
// de cockpit leest het via GET /teller/status (alleen lezen) en stopt met schrijven als hij te oud is).
// `cfg:schema_uitgerold` = de app-versie die volgens de eigenaar live staat (POST /teller/schema {uitgerold, bevestig},
// met audit; de regie doet dit bij de release). De reeks en een hoger minimum kunnen pas aan als die versie er echt is
// (anders kan niemand meer projecten aanmaken). Een gewone gebruiker kan dit dus niet vervroegen.
const NR_SCHEMA_STANDAARD = 2;
const nrAntw = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
async function nrHash(o) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(o)));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export class MtTeller {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(request) {
    const op = new URL(request.url).pathname.slice(1);
    let b = {}; try { b = await request.json(); } catch {}
    const st = this.state.storage, antw = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (op.startsWith('ai-')) return await this.ai(op, b);
    if (op.startsWith('csp-')) return await this.csp(op, b);
    if (op.startsWith('nr-')) return await this.nummers(op, b);
    if (op.startsWith('sig-')) return await SigDO.ops(this, op, b);   // signalen (L3), instantie 'signalen'
    if (op === 'alle') {
      const m = await st.list({ prefix: 'pid:' }), werkcodes = {}, nummers = {}, aliassen = {};
      for (const [k, w] of m) {
        const pid = k.slice(4);
        if (NR_WCODE_RE.test(String(w.code))) werkcodes[pid] = w.code;
        if (w.nummer) nummers[pid] = w.nummer;
        for (const a of w.aliassen || []) aliassen[a] = pid;
      }
      const c = (await st.get('cfg:reeks')) || {};
      return antw({ werkcodes, nummers, aliassen, reeks: { aan: !!c.aan } });
    }
    if (op !== 'ken' && op !== 'proef') return antw({ error: 'onbekend' }, 404);
    if (((await st.get('cfg:reeks')) || {}).aan) return antw({ error: 'w-reeks-gestopt', uitleg: 'De nieuwe projectnummers staan aan: er worden geen W-codes meer uitgegeven' }, 409);
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
  // Projectnummers (brok B): zie de uitleg bij NR_START. Lezen buiten het slot; alles wat schrijft in één geserialiseerd blok.
  async nummers(op, b) {
    const st = this.state.storage;
    if (op === 'nr-status') {
      const c = (await st.get('cfg:reeks')) || {}, n = (await st.get('n:reeks')) || NR_START - 1;
      const uitgerold = (await st.get('cfg:schema_uitgerold')) || null;
      return nrAntw({ reeks: { aan: !!c.aan, sinds: c.ts || null, door: c.doorNaam || null, volgende: n + 1, laatste: n >= NR_START ? n : null },
        schema_min: (await st.get('cfg:schema_min')) || NR_SCHEMA_STANDAARD, schema_uitgerold: uitgerold, laatste_migratie: (await st.get('cfg:laatste_mig')) || null });
    }
    if (op === 'nr-binding') {
      const pid = await this._nrZoek(String(b.sleutel || ''));
      const bi = pid && await this._nrBinding(pid);
      return bi ? nrAntw(bi) : nrAntw({ error: 'onbekend' }, 404);
    }
    if (op === 'nr-log') {
      const m = await st.list({ prefix: 'log:' }), uit = [...m.values()].reverse().slice(0, Math.min(500, Math.max(1, Number(b.limiet) || 100)));
      return nrAntw({ log: uit });
    }
    if (op === 'nr-mig-status') {
      const r = await this._nrMigStand(String(b.mig_id || ''));
      return r ? nrAntw(r) : nrAntw({ error: 'onbekende-migratie' }, 404);
    }
    if (!['nr-nieuw', 'nr-reeks', 'nr-schema', 'nr-mig-proef', 'nr-mig-toepassen', 'nr-mig-terugrol'].includes(op)) return nrAntw({ error: 'onbekend' }, 404);
    const uit = await this.state.blockConcurrencyWhile(async () => {
      const ts = Date.now(), schrijf = {}, door = { door: b.door || null, doorNaam: b.doorNaam || null };
      let logn = (await st.get('logn')) || 0;
      const log = e => { logn++; schrijf['log:' + String(logn).padStart(12, '0')] = Object.assign({ ts }, door, e); schrijf.logn = logn; };
      if (op === 'nr-nieuw') {
        const pid = String(b.project_id);
        const al = await this._nrBinding(pid);
        if (al) return { j: Object.assign(al, { nieuw: false }) };
        const cfg = (await st.get('cfg:reeks')) || {};
        if (!cfg.aan) {                                  // W-reeks (zoals voorheen): per jaar doorlopend
          const jaar = String(b.jaar), jj = jaar.slice(-2);
          let n = (await st.get('n:' + jaar)) || 0, code;
          do { n++; code = `W${jj}-${String(n).padStart(3, '0')}`; } while (await st.get('code:' + code) || await st.get('alias:' + code));
          Object.assign(schrijf, { ['n:' + jaar]: n, ['pid:' + pid]: { code, ts }, ['code:' + code]: pid });
          log({ actie: 'werkcode-uitgegeven', project_id: pid, oud: null, nieuw: code, mig: null, resultaat: 'uitgegeven' });
          await st.put(schrijf);
          return { j: { project_id: pid, code, werkcode: code, projectnummer: null, aliassen: [], nieuw: true } };
        }
        if (!(Number(b.schema) >= NR_MIN_SCHEMA)) return { s: 409, j: { error: 'verouderde-app', uitleg: 'Deze pagina is verouderd — herlaad de pagina om een projectnummer te krijgen' } };
        let n = (await st.get('n:reeks')) || NR_START - 1, nr;
        do { n++; nr = String(n); } while (await st.get('nr:' + nr) || await st.get('code:' + nr) || await st.get('alias:' + nr));
        Object.assign(schrijf, { 'n:reeks': n, ['pid:' + pid]: { code: nr, nummer: nr, ts }, ['nr:' + nr]: { pid, ts } });
        log({ actie: 'projectnummer-uitgegeven', project_id: pid, oud: null, nieuw: nr, mig: null, resultaat: 'uitgegeven' });
        await st.put(schrijf);
        return { j: { project_id: pid, code: nr, werkcode: null, projectnummer: nr, aliassen: [], nieuw: true } };
      }
      if (op === 'nr-reeks') {
        const aan = b.aan === true, c = (await st.get('cfg:reeks')) || {};
        if (!!c.aan === aan) return { j: { reeks: { aan }, gewijzigd: false } };
        // Aanzetten alleen als er al een app is die nummers aankan (anders kan niemand meer een project aanmaken).
        if (aan && ((await st.get('cfg:schema_uitgerold')) || 0) < NR_MIN_SCHEMA) return { s: 409, j: { error: 'nog-geen-app-met-nummers', uitleg: 'De reeks kan pas aan als de eigenaar heeft vastgelegd dat de cockpit met schema ' + NR_MIN_SCHEMA + ' (brok C) is uitgerold' } };
        schrijf['cfg:reeks'] = Object.assign({ aan, ts }, door);
        log({ actie: aan ? 'reeks-aan' : 'reeks-uit', project_id: null, oud: !!c.aan, nieuw: aan, mig: null, resultaat: 'gezet' });
        await st.put(schrijf);
        return { j: { reeks: { aan }, gewijzigd: true } };
      }
      if (op === 'nr-schema') {
        const oudMin = (await st.get('cfg:schema_min')) || NR_SCHEMA_STANDAARD, oudUit = (await st.get('cfg:schema_uitgerold')) || 0;
        const uit = b.uitgerold != null ? b.uitgerold : oudUit, min = b.min != null ? b.min : oudMin;
        if (min > Math.max(uit, NR_SCHEMA_STANDAARD)) return { s: 409, j: { error: 'nog-geen-app-met-dit-schema', uitleg: 'Minimum ' + min + ' is hoger dan de uitgerolde versie (' + (uit || 'onbekend') + ')' } };
        if (min === oudMin && uit === oudUit) return { j: { schema_min: min, schema_uitgerold: uit || null, gewijzigd: false } };
        if (uit !== oudUit) { schrijf['cfg:schema_uitgerold'] = uit; log({ actie: 'schema-uitgerold', project_id: null, oud: oudUit || null, nieuw: uit, mig: null, resultaat: 'gezet' }); }
        if (min !== oudMin) { schrijf['cfg:schema_min'] = min; log({ actie: 'schema-min', project_id: null, oud: oudMin, nieuw: min, mig: null, resultaat: 'gezet' }); }
        await st.put(schrijf);
        return { j: { schema_min: min, schema_uitgerold: uit || null, gewijzigd: true } };
      }
      if (op === 'nr-mig-proef' || op === 'nr-mig-toepassen') {
        const items = Array.isArray(b.items) ? b.items : [];
        if (op === 'nr-mig-toepassen' && b.mig_id) {        // hervatten/herhalen: een toegepaste migratie nooit twee keer
          const m = await st.get('mig:' + b.mig_id);
          if (m && m.status !== 'toegepast') return { s: 409, j: { error: 'migratie-' + m.status, status: m.status, mig_id: m.id } };   // bv. teruggerold: niet stil "herhaald"
          if (m) return m.hash === b.hash ? { j: { mig_id: m.id, plan: m.items.map(({ voor, na, ...x }) => x), herhaald: true, status: m.status } } : { s: 409, j: { error: 'migratie-id-bestaat', status: m.status } };
        }
        const { plan, conflicten, n } = await this._nrMigPlan(items);
        const hash = await nrHash({ plan, conflicten });
        if (op === 'nr-mig-proef') return { j: { plan: plan.map(({ voor, ...x }) => x), conflicten, hash } };
        if (conflicten.length || b.hash !== hash) {
          const reden = conflicten.length ? 'conflict' : 'droogloop-verouderd';
          for (const c of conflicten.length ? conflicten : [{ project_id: null }]) log({ actie: 'projectnummer-migratie', project_id: c.project_id || null, oud: c.oud || null, nieuw: null, mig: b.mig_id || null, resultaat: reden + (c.reden ? ': ' + c.reden : '') });
          await st.put(schrijf);
          return { s: 409, j: { error: reden, conflicten, hash } };
        }
        const id = b.mig_id || ('m_' + ts.toString(36) + [...crypto.getRandomValues(new Uint8Array(4))].map(x => x.toString(16).padStart(2, '0')).join(''));
        const mItems = [];
        for (const p of plan) {
          const na = Object.assign({}, p.voor, { nummer: p.nieuw, aliassen: [...(p.voor.aliassen || []), ...p.aliassen], mig: id, ts });
          schrijf['pid:' + p.project_id] = na;
          schrijf['nr:' + p.nieuw] = { pid: p.project_id, ts, mig: id };
          for (const a of p.aliassen) schrijf['alias:' + a] = { pid: p.project_id, ts, mig: id };
          log({ actie: 'projectnummer-migratie', project_id: p.project_id, oud: p.oud, nieuw: p.nieuw, mig: id, resultaat: 'toegepast' });
          mItems.push(Object.assign({}, p, { na }));
        }
        schrijf['n:reeks'] = n;
        schrijf['mig:' + id] = Object.assign({ id, ts, status: 'toegepast', hash, items: mItems }, door);
        schrijf['cfg:laatste_mig'] = id;
        if (Object.keys(schrijf).length > 128) throw new Error('te-veel-sleutels');
        await st.put(schrijf);
        return { j: { mig_id: id, plan: plan.map(({ voor, ...x }) => x) } };
      }
      // nr-mig-terugrol
      const id = String(b.mig_id || ''), stand = await this._nrMigStand(id);
      if (!stand) return { s: 404, j: { error: 'onbekende-migratie' } };
      if (!stand.terugrolbaar) {
        const gewijzigd = stand.items.filter(x => !x.ongewijzigd);
        for (const x of gewijzigd.length ? gewijzigd : [{ project_id: null }]) log({ actie: 'projectnummer-terugrol', project_id: x.project_id, oud: x.nieuw || null, nieuw: x.oud || null, mig: id, resultaat: 'conflict: ' + (stand.status !== 'toegepast' ? 'status ' + stand.status : 'gewijzigd na de migratie') });
        await st.put(schrijf);
        return { s: 409, j: { error: 'conflict', reden: stand.status !== 'toegepast' ? 'migratie is ' + stand.status : 'de toestand is gewijzigd na deze migratie', items: stand.items } };
      }
      const m = await st.get('mig:' + id);
      for (const x of m.items) {
        schrijf['pid:' + x.project_id] = x.voor;
        schrijf['nr:' + x.nieuw] = { pid: x.project_id, ts, mig: id, ingetrokken: true };   // nummer blijft verbruikt: nooit opnieuw uitgegeven
        for (const a of x.aliassen) schrijf['alias:' + a] = { pid: null, ts, mig: id, ingetrokken: true };
        log({ actie: 'projectnummer-terugrol', project_id: x.project_id, oud: x.nieuw, nieuw: x.oud, mig: id, resultaat: 'teruggerold' });
      }
      schrijf['mig:' + id] = Object.assign({}, m, { status: 'teruggerold', terug_ts: ts, terug_door: door.door, terug_doorNaam: door.doorNaam });
      if (Object.keys(schrijf).length > 128) throw new Error('te-veel-sleutels');
      await st.put(schrijf);
      return { j: { mig_id: id, teruggerold: m.items.map(x => x.project_id) } };
    }).catch(e => ({ s: 500, j: { error: String(e.message || e) } }));
    return nrAntw(uit.j, uit.s || 200);
  }
  async _nrBinding(pid) {
    const r = await this.state.storage.get('pid:' + pid);
    if (!r) return null;
    return { project_id: pid, code: r.code, werkcode: NR_WCODE_RE.test(String(r.code)) ? r.code : null, projectnummer: r.nummer || null, aliassen: (r.aliassen || []).slice() };
  }
  async _nrZoek(s) {
    if (!s) return null;
    const st = this.state.storage;
    if (WERKCODE_PID_RE.test(s)) return (await st.get('pid:' + s)) ? s : null;
    const n = await st.get('nr:' + s); if (n && n.pid && !n.ingetrokken) return n.pid;
    const c = await st.get('code:' + s); if (c) return c;
    const a = await st.get('alias:' + s); if (a && a.pid && !a.ingetrokken) return a.pid;
    return null;
  }
  // Plan voor het omnummeren (in de volgorde van de lijst): per project het volgende nummer, de W-code (en eventuele extra
  // oude codes) als alias. Conflicten: onbekend bij de teller, al genummerd, afwijkende oude code, alias van een ander project.
  async _nrMigPlan(items) {
    const st = this.state.storage, plan = [], conflicten = [], pids = new Set(), aliasVan = new Map();
    let n = (await st.get('n:reeks')) || NR_START - 1;
    for (const it of items) {
      const pid = String(it.project_id), fout = reden => conflicten.push({ project_id: pid, oud: it.oud || null, reden });
      if (pids.has(pid)) { fout('dubbel in de lijst'); continue; }
      pids.add(pid);
      const voor = await st.get('pid:' + pid);
      if (!voor) { fout('onbekend bij de teller'); continue; }
      if (voor.nummer) { fout('heeft al projectnummer ' + voor.nummer); continue; }
      if (it.oud != null && String(it.oud) !== voor.code) { fout('oude code wijkt af (teller: ' + voor.code + ')'); continue; }
      const nieuweAliassen = [], al = voor.aliassen || [];
      let mis = '';
      for (const a of [voor.code, ...(it.aliassen || [])].map(String)) {
        if (al.includes(a) || nieuweAliassen.includes(a)) continue;
        const ap = await st.get('alias:' + a), cp = await st.get('code:' + a), np = await st.get('nr:' + a);
        if (ap && ap.pid && !ap.ingetrokken && ap.pid !== pid) { mis = 'alias ' + a + ' hoort bij een ander project'; break; }
        if (cp && cp !== pid) { mis = 'code ' + a + ' hoort bij een ander project'; break; }
        if (np) { mis = a + ' is een projectnummer'; break; }
        if (aliasVan.has(a) && aliasVan.get(a) !== pid) { mis = 'alias ' + a + ' staat twee keer in de lijst'; break; }
        aliasVan.set(a, pid); nieuweAliassen.push(a);
      }
      if (mis) { fout(mis); continue; }
      let nr;
      do { n++; nr = String(n); } while (await st.get('nr:' + nr) || await st.get('code:' + nr) || await st.get('alias:' + nr));
      plan.push({ project_id: pid, oud: voor.code, nieuw: nr, aliassen: nieuweAliassen, voor });
    }
    return { plan, conflicten, n };
  }
  // Stand van een migratie: per project of alles nog precies is zoals de migratie het achterliet (dan mag terugrollen).
  async _nrMigStand(id) {
    if (!NR_MIG_RE.test(id)) return null;
    const st = this.state.storage, m = await st.get('mig:' + id);
    if (!m) return null;
    const items = [];
    for (const x of m.items) {
      const cur = await st.get('pid:' + x.project_id), nr = await st.get('nr:' + x.nieuw);
      let ok = JSON.stringify(cur) === JSON.stringify(x.na) && !!nr && nr.pid === x.project_id && nr.mig === id && !nr.ingetrokken;
      for (const a of x.aliassen) { const ap = await st.get('alias:' + a); if (!ap || ap.pid !== x.project_id || ap.mig !== id || ap.ingetrokken) ok = false; }
      items.push({ project_id: x.project_id, oud: x.oud, nieuw: x.nieuw, aliassen: x.aliassen, ongewijzigd: ok });
    }
    return { mig_id: m.id, ts: m.ts, door: m.doorNaam || null, status: m.status, hash: m.hash, items, terugrolbaar: m.status === 'toegepast' && items.every(x => x.ongewijzigd) };
  }
  // F6: AI-gebruik per gebruiker. Eén instantie (idFromName('ai')); alles in één geserialiseerd blok (atomair, ook bij gelijktijdige verzoeken).
  // Per verzoek: claim (limieten toetsen + tokens reserveren) → afrond (werkelijk gebruik; bij een fout de reservering terug).
  // Opgeslagen: tellers per gebruiker-hash en dag, een globale dagteller, het minuutvenster, lopende claims en een logboek
  // ZONDER inhoud (alleen tijd, gebruiker-hash, rol, model, aantallen tokens, status). Een claim die nooit afgerond wordt (afgebroken
  // verbinding) vervalt na 5 minuten; de reservering blijft dan staan (behoudend).
  async ai(op, b) {
    const st = this.state.storage, antw = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
    const dag = String(b.dag || ''), nu = Number(b.nu) || Date.now(), h = String(b.oid || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dag) || (op !== 'ai-overzicht' && !/^[0-9a-f]{10}$/.test(h))) return antw({ error: 'ongeldig' }, 400);
    const kort = x => (x == null ? undefined : String(x).slice(0, 60)), getal = x => (typeof x === 'number' && isFinite(x) && x >= 0 ? Math.round(x) : null);
    const logZet = e => st.put('log:' + String(9e15 - nu).padStart(16, '0') + ':' + randHex(3), e);
    return await this.state.blockConcurrencyWhile(async () => {
      try {
        const dk = 'u:' + h + ':' + dag, gk = 'g:' + dag;
        if (op === 'ai-claim') {
          const l = b.limiet || {}, lim = { dag: getal(l.dag), minuut: getal(l.minuut), gelijktijdig: getal(l.gelijktijdig), totaal_dag: getal(l.totaal_dag) };
          if (Object.values(lim).some(x => x == null)) return antw({ error: 'ongeldige-limieten' }, 400);
          const reserve = Math.max(1, Math.min(2e6, Math.ceil(Number(b.reserve) || 0)));
          await this.aiRuimVerlopen(nu, 'f:' + h + ':', dag);
          await this.aiRuimGraven(nu);
          let inflight = 0;
          for (const [, f] of await st.list({ prefix: 'f:' + h + ':' })) inflight++;   // wat na het opruimen overblijft is niet verlopen
          const u = (await st.get(dk)) || { tokens: 0, calls: 0, in: 0, uit: 0, afgewezen: 0 }, g = (await st.get(gk)) || { tokens: 0, calls: 0, afgewezen: 0 };
          u.rol = kort(b.rol);
          const vk = 'v:' + h, v = ((await st.get(vk)) || []).filter(t => nu - t < 60000);
          let reden = null, wacht = 0;
          if (inflight >= lim.gelijktijdig) reden = 'gelijktijdig';
          else if (v.length >= lim.minuut) { reden = 'minuut'; wacht = Math.max(1, Math.ceil((60000 - (nu - v[0])) / 1000)); }
          else if (u.tokens + reserve > lim.dag) reden = 'dag';
          else if (g.tokens + reserve > lim.totaal_dag) reden = 'totaal';
          if (reden && b.modus === 'afdwingen') {
            u.afgewezen++; g.afgewezen++;
            await st.put({ [dk]: u, [gk]: g }); await logZet({ ts: nu, oid: h, rol: u.rol, model: kort(b.model), status: 'geweigerd', reden, reserve });
            return antw({ ok: false, reden, wacht_s: wacht || undefined, dag_gebruikt: u.tokens, dag_limiet: lim.dag });
          }
          const claim = randHex(6);
          u.tokens += reserve; u.calls++; g.tokens += reserve; g.calls++; v.push(nu);
          await st.put({ [dk]: u, [gk]: g, [vk]: v, ['f:' + h + ':' + claim]: { ts: nu, dag, reserve, uit: Math.max(0, Math.min(reserve, Math.ceil(Number(b.uit_res) || 0))), zou: reden || undefined } });
          try { if ((await st.getAlarm()) == null) await st.setAlarm(nu + AI_CLAIM_VERLOOP_MS + 1000); } catch {}   // verlopen claims ruimt het alarm op, ook als er geen volgend verzoek komt
          if ((await st.get('opruim')) !== dag) {                      // één keer per dag: oude tellers (> AI_BEWAAR_DAGEN) weg
            const grens = geldDag(dag, -AI_BEWAAR_DAGEN), oud = [...(await st.list({ prefix: 'u:' })), ...(await st.list({ prefix: 'g:' }))].map(([k]) => k).filter(k => k.slice(-10) < grens);
            for (let i = 0; i < oud.length; i += 100) await st.delete(oud.slice(i, i + 100));
            await st.put('opruim', dag);
          }
          return antw({ ok: true, claim, zou_weigeren: reden || undefined });
        }
        if (op === 'ai-verleng') {                                      // hartslag van een lopende stream: de claim blijft vers en het alarm rekent hem niet af
          const fk = 'f:' + h + ':' + String(b.claim || ''), f = await st.get(fk);
          if (!f) return antw({ ok: true, bestaat: false });
          f.ts = nu; await st.put(fk, f); return antw({ ok: true, bestaat: true });
        }
        if (op === 'ai-afrond') {
          const cid = String(b.claim || ''), fk = 'f:' + h + ':' + cid, tk = 'x:' + h + ':' + cid, f = await st.get(fk), graf = f ? null : await st.get(tk);
          // Een claim die al verlopen was (grafsteen): de reservering is bij het verlopen deels teruggeboekt; bij de afronding wordt het verschil alsnog afgerekend (eenmalig per claim-id).
          const bron = f || (graf ? { reserve: Math.max(0, graf.reserve - graf.terug), dag: graf.dag, uit: 0, zou: graf.zou } : null);
          if (!bron) { await logZet({ ts: nu, oid: h, model: kort(b.model), status: ['ok', 'fout', 'afgebroken'].includes(b.status) ? b.status : 'fout', niet_gevonden: true }); return antw({ ok: true, niet_gevonden: true }); }   // onbekend of al afgerekend: tellers blijven ongemoeid (idempotent)
          const cd = /^\d{4}-\d{2}-\d{2}$/.test(String(bron.dag || '')) ? bron.dag : dag, uk = 'u:' + h + ':' + cd, gk3 = 'g:' + cd;
          const u = (await st.get(uk)) || { tokens: 0, calls: 0, in: 0, uit: 0, afgewezen: 0 }, g = (await st.get(gk3)) || { tokens: 0, calls: 0, afgewezen: 0 };
          const tin = getal(b.in), tuit = getal(b.uit), status = ['ok', 'fout', 'afgebroken'].includes(b.status) ? b.status : 'fout';
          let delta = 0;
          if (status === 'fout' && tin == null && tuit == null) delta = -bron.reserve;                       // niets verbruikt: de reservering terug
          else if (tin != null && tuit != null) delta = (tin + tuit) - bron.reserve;                          // werkelijk gebruik i.p.v. de schatting (ook bij een afgebroken stream: wat al binnen was)
          else if (status === 'afgebroken') delta = -Math.max(0, Math.min(bron.reserve, bron.uit || 0));      // afgebroken zonder cijfers: minstens de ongebruikte output-reservering terug
          u.tokens = Math.max(0, u.tokens + delta); g.tokens = Math.max(0, g.tokens + delta);
          if (tin != null) u.in += tin; if (tuit != null) u.uit += tuit;
          // Claim/grafsteen weg, tellers bijgesteld en logregel: ALLES of NIETS (een crash halverwege laat de claim staan en de tellers ongemoeid; de afronding kan dan opnieuw).
          await this.aiAtomair(async w => { await w.delete(f ? fk : tk); await w.put({ [uk]: u, [gk3]: g }); await w.put('log:' + String(9e15 - nu).padStart(16, '0') + ':' + randHex(3), { ts: nu, oid: h, rol: u.rol, model: kort(b.model), in: tin == null ? undefined : tin, uit: tuit == null ? undefined : tuit, status, http: getal(b.http) == null ? undefined : getal(b.http), ms: getal(b.ms) == null ? undefined : getal(b.ms), zou: bron.zou, laat: graf ? true : undefined }); });
          const logs = [...(await st.list({ prefix: 'log:', limit: AI_LOG_MAX + 50 }))].map(([k]) => k);
          if (logs.length > AI_LOG_MAX) await st.delete(logs.slice(AI_LOG_MAX));
          return antw({ ok: true });
        }
        if (op === 'ai-overzicht') {
          const n = Math.max(1, Math.min(31, Number(b.dagen) || 7)), vanaf = geldDag(dag, -(n - 1));
          const gebruikers = [...(await st.list({ prefix: 'u:' }))].map(([k, r]) => ({ oid: k.slice(2, 12), dag: k.slice(13), rol: r.rol, tokens: r.tokens, calls: r.calls, in: r.in, uit: r.uit, afgewezen: r.afgewezen })).filter(x => x.dag >= vanaf && x.dag <= dag).sort((a, c) => c.dag.localeCompare(a.dag) || c.tokens - a.tokens);
          const totaal = [...(await st.list({ prefix: 'g:' }))].map(([k, r]) => ({ dag: k.slice(2), tokens: r.tokens, calls: r.calls, afgewezen: r.afgewezen })).filter(x => x.dag >= vanaf && x.dag <= dag).sort((a, c) => c.dag.localeCompare(a.dag));
          const recent = [...(await st.list({ prefix: 'log:', limit: Math.max(1, Math.min(100, Number(b.log) || 50)) }))].map(([, r]) => r);
          const lopend = [...(await st.list({ prefix: 'f:' }))].filter(([, f]) => nu - f.ts <= AI_CLAIM_VERLOOP_MS).length;
          return antw({ gebruikers, totaal, recent, lopend });
        }
        return antw({ error: 'onbekend' }, 404);
      } catch (e) { return antw({ error: 'opslag', detail: String((e && e.message) || e).slice(0, 120) }, 503); }
    });
  }
  // CSP-tellers (instantie 'csp'): per dag { totaal, afgewezen, sleutels:{ 'directive|host': n } }, met een globaal budget per minuut en per dag.
  async csp(op, b) {
    const st = this.state.storage, antw = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
    const dag = String(b.dag || ''), nu = Number(b.nu) || Date.now();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dag)) return antw({ error: 'ongeldig' }, 400);
    return await this.state.blockConcurrencyWhile(async () => {
      try {
        if (op === 'csp-tel') {
          const items = (Array.isArray(b.items) ? b.items : []).slice(0, CSP_PER_BERICHT).filter(k => typeof k === 'string' && /^[a-z][a-z-]{1,40}\|[a-z0-9.:-]{1,80}$/.test(k));
          if (!items.length) return antw({ ok: true, geteld: 0 });
          let w = (await st.get('venster')) || { t: 0, n: 0 }; if (nu - w.t > 60000 || nu < w.t) w = { t: nu, n: 0 };
          const ck = 'c:' + dag, rec = (await st.get(ck)) || { totaal: 0, afgewezen: 0, sleutels: {} };
          const vol = () => rec.totaal >= CSP_DO_DAGBUDGET ? { vol: 'dag' } : w.n >= CSP_DO_PER_MIN ? { vol: 'minuut', tot: w.t + 60000 } : {};
          if (vol().vol) return antw({ ok: true, geteld: 0, ...vol() });   // al vol: geen enkele schrijfactie (ook niet voor 'afgewezen'); de aanroeper stopt tot het einde van de minuut/dag
          let geteld = 0;
          for (const k of items) {
            if (w.n >= CSP_DO_PER_MIN || rec.totaal >= CSP_DO_DAGBUDGET) { rec.afgewezen++; continue; }
            w.n++; rec.totaal++; geteld++;
            if (rec.sleutels[k] != null || Object.keys(rec.sleutels).length < CSP_MAX_SLEUTELS) rec.sleutels[k] = (rec.sleutels[k] || 0) + 1;
          }
          await st.put({ venster: w, [ck]: rec });
          if ((await st.get('opruim')) !== dag) {                      // één keer per dag: oude tellers weg
            const grens = geldDag(dag, -CSP_BEWAAR_DAGEN), oud = [...(await st.list({ prefix: 'c:' }))].map(([k]) => k).filter(k => k.slice(2) < grens);
            for (let i = 0; i < oud.length; i += 100) await st.delete(oud.slice(i, i + 100));
            await st.put('opruim', dag);
          }
          return antw({ ok: true, geteld, ...vol() });
        }
        if (op === 'csp-overzicht') {
          const n = Math.max(1, Math.min(31, Number(b.dagen) || 7)), vanaf = geldDag(dag, -(n - 1)), uit = { totaal: 0, afgewezen: 0, sleutels: {} };
          for (const [k, r] of await st.list({ prefix: 'c:' })) { const d = k.slice(2); if (d < vanaf || d > dag) continue; uit.totaal += r.totaal || 0; uit.afgewezen += r.afgewezen || 0; for (const [sl, cn] of Object.entries(r.sleutels || {})) uit.sleutels[sl] = (uit.sleutels[sl] || 0) + cn; }
          return antw(uit);
        }
        return antw({ error: 'onbekend' }, 404);
      } catch (e) { return antw({ error: 'opslag', detail: String((e && e.message) || e).slice(0, 120) }, 503); }
    });
  }
  // Een claim die nooit werd afgerond (afgebroken verbinding, crash): de invoerschatting blijft staan (behoudend), de ONGEBRUIKTE output-reservering gaat terug.
  // Alleen de claims onder `prefix` ('f:' = alle gebruikers, 'f:<oid>:' = één gebruiker). Aanroepen binnen blockConcurrencyWhile. → aantal opgeruimde claims.
  // Alle wijzigingen van één opruiming gaan in ÉÉN transactie (alles of niets): tellers terugboeken, grafstenen schrijven, claims verwijderen en loggen. Valt de DO halverwege uit, dan
  // blijven de claims staan en de tellers ongemoeid; de volgende opruiming doet het dan opnieuw (nooit dubbel terugboeken, nooit een claim zonder grafsteen).
  async aiAtomair(fn) { const st = this.state.storage; return typeof st.transaction === 'function' ? await st.transaction(async txn => await fn(txn)) : await fn(st); }
  async aiRuimVerlopen(nu, prefix, dagStd) {
    const st = this.state.storage, verlopen = [];
    for (const [k, f] of await st.list({ prefix })) if (nu - f.ts > AI_CLAIM_VERLOOP_MS) verlopen.push([k, f]);
    if (!verlopen.length) return 0;
    const per = new Map();                                                       // oid → { n, som, dagen: Map(dag → tokens terug) }
    for (const [k, f] of verlopen) {
      const o = k.split(':')[1], d = /^\d{4}-\d{2}-\d{2}$/.test(String(f.dag || '')) ? f.dag : dagStd, x = Math.max(0, Math.min(f.reserve, f.uit || 0));
      const e = per.get(o) || { n: 0, som: 0, dagen: new Map() }; e.n++; e.som += x; e.dagen.set(d, (e.dagen.get(d) || 0) + x); per.set(o, e);
    }
    const doc = {}, schrijf = {};                                                // eerst alles uitrekenen (lezen), dan in één keer schrijven
    const haal = async k => { if (!(k in doc)) doc[k] = await st.get(k); return doc[k]; };
    let logN = 0;
    for (const [o, e] of per) {
      for (const [d, x] of e.dagen) { const uk = 'u:' + o + ':' + d, gk = 'g:' + d, u2 = await haal(uk), g2 = await haal(gk); if (u2) { u2.tokens = Math.max(0, u2.tokens - x); schrijf[uk] = u2; } if (g2) { g2.tokens = Math.max(0, g2.tokens - x); schrijf[gk] = g2; } }
      schrijf['log:' + String(9e15 - nu).padStart(16, '0') + ':' + randHex(3) + (logN++ ? '-' + logN : '')] = { ts: nu, oid: o, status: 'verlopen', n: e.n, teruggeboekt: e.som };
    }
    // Grafsteen per verlopen claim (24 uur): komt de stream later toch nog tot een afronding, dan wordt het verschil alsnog afgerekend.
    for (const [k, f] of verlopen) { const [, o, cid] = k.split(':'); schrijf['x:' + o + ':' + cid] = { dag: /^\d{4}-\d{2}-\d{2}$/.test(String(f.dag || '')) ? f.dag : dagStd, reserve: f.reserve, terug: Math.max(0, Math.min(f.reserve, f.uit || 0)), ts: nu, zou: f.zou }; }
    const weg = verlopen.map(([k]) => k).concat(await this.aiOudeGraven(nu)), sl = Object.keys(schrijf);
    await this.aiAtomair(async w => {
      for (let i = 0; i < sl.length; i += 100) await w.put(Object.fromEntries(sl.slice(i, i + 100).map(k => [k, schrijf[k]])));
      for (let i = 0; i < weg.length; i += 100) await w.delete(weg.slice(i, i + 100));
    });
    return verlopen.length;
  }
  // Grafstenen (x:) ouder dan 24 uur. Ook los van een nieuw verlopen claim op te ruimen (alarm en claim-pad).
  async aiOudeGraven(nu) { return [...(await this.state.storage.list({ prefix: 'x:' }))].filter(([, x]) => nu - x.ts > 24 * 3600 * 1000).map(([k]) => k); }
  async aiRuimGraven(nu) { const oud = await this.aiOudeGraven(nu); if (oud.length) await this.aiAtomair(async w => { for (let i = 0; i < oud.length; i += 100) await w.delete(oud.slice(i, i + 100)); }); return oud.length; }
  // DO-alarm: rekent verlopen claims (> 5 minuten) af, onafhankelijk van een volgend verzoek, en plant zichzelf op de eerstvolgende verloopdatum.
  // De signalen-instantie (merkteken sig:instantie) gebruikt het alarm voor de gebundelde pushmelding (PushDO.alarm).
  async alarm() {
    if (await this.state.storage.get('sig:instantie')) { await PushDO.alarm(this); return; }
    await this.state.blockConcurrencyWhile(async () => {
      const st = this.state.storage, nu = Date.now();
      await this.aiRuimVerlopen(nu, 'f:', geldVandaag());
      await this.aiRuimGraven(nu);
      let volgende = null; const min = t => { if (volgende == null || t < volgende) volgende = t; };
      for (const [, f] of await st.list({ prefix: 'f:' })) min(f.ts + AI_CLAIM_VERLOOP_MS + 1000);
      for (const [, x] of await st.list({ prefix: 'x:' })) min(x.ts + 24 * 3600 * 1000 + 1000);   // een grafsteen die niet meer gebruikt wordt, verdwijnt ook zonder nieuw verzoek
      if (volgende != null) await st.setAlarm(Math.max(nu + 1000, volgende));
    });
  }
}
// ── F6: AI-limieten (zie MtTeller.ai) ─────────────────────────────────────────
// Eén serversleutel (CLAUDE_KEY); de worker toetst per verzoek een limiet per gebruiker: tokens per dag (invoer + uitvoer, vooraf geschat en
// achteraf met het werkelijke gebruik uit de stream bijgesteld), verzoeken per minuut en gelijktijdige verzoeken, plus een dagplafond voor de
// hele tool. Standaardwaarden hieronder; de eigenaar kan ze aanpassen (POST /beheer/ai-limieten, KV instelling:ai_limieten).
// Modus (wrangler-var AI_LIMIET_MODUS): 'afdwingen' (standaard) weigert met 429, 'log' telt en logt alleen wat geweigerd zóu worden, 'uit' doet niets.
// Het logboek bevat nooit de inhoud van vragen of antwoorden.
const AI_CLAIM_VERLOOP_MS = 5 * 60 * 1000, AI_LOG_MAX = 300, AI_BEWAAR_DAGEN = 45, AI_HARTSLAG_MS = 60 * 1000, AI_HARTSLAG_MAX = 30;
const AI_LIMIET_STD = { totaal_dag: 4000000, rollen: { eigenaar: { dag: 1500000, minuut: 30, gelijktijdig: 4 }, beheerder: { dag: 1000000, minuut: 20, gelijktijdig: 3 },
  kantoor: { dag: 600000, minuut: 20, gelijktijdig: 3 }, werkplaats: { dag: 150000, minuut: 10, gelijktijdig: 2 } } };
const AI_LIMIET_GRENS = { dag: [0, 50e6], minuut: [1, 600], gelijktijdig: [1, 20], totaal_dag: [0, 200e6] };
const aiModus = env => { const m = String((env && env.AI_LIMIET_MODUS) || '').toLowerCase(); return ['uit', 'log', 'afdwingen'].includes(m) ? m : 'afdwingen'; };
function aiLimietNorm(r) {   // standaard + geldige overschrijvingen (ongeldige velden worden genegeerd)
  const uit = JSON.parse(JSON.stringify(AI_LIMIET_STD)), ok = (k, v) => Number.isInteger(v) && v >= AI_LIMIET_GRENS[k][0] && v <= AI_LIMIET_GRENS[k][1];
  if (r && typeof r === 'object') {
    if (ok('totaal_dag', r.totaal_dag)) uit.totaal_dag = r.totaal_dag;
    for (const rol of Object.keys(uit.rollen)) { const x = r.rollen && r.rollen[rol]; if (x) for (const k of ['dag', 'minuut', 'gelijktijdig']) if (ok(k, x[k])) uit.rollen[rol][k] = x[k]; }
  }
  return uit;
}
async function aiLimieten(env) { let r = null; try { r = await kvJson(env, 'instelling:ai_limieten'); } catch {} return aiLimietNorm(r); }
// Geschatte invoertokens (behoudend): tekst ≈ 1 token per 3 tekens, afbeelding vast, document naar grootte met een plafond. Geen inhoud bewaard.
const AI_DOC_BYTES = 400 * 1024;   // harde grens: documenten boven deze grootte (bytes, na base64-decodering) worden vooraf geweigerd
const AI_DOC_MAX = 150000;         // geschatte tokens aan documenten waarboven een verzoek vooraf wordt geweigerd (bij 1 token per 3 bytes is de bytegrens de feitelijke stop)
const AI_TEL_DREMPEL = 8000;       // vanaf zoveel bytes tekst (of bij een document/afbeelding) telt 'afdwingen' de invoer exact met /v1/messages/count_tokens
const AI_TEL_TIMEOUT_MS = 8000;
const _enc = new TextEncoder();
const utf8Len = x => _enc.encode(String(x == null ? '' : x)).length;
// Schatting: tekst = UTF-8-bytes / 3 (ook niet-Latijnse tekst blijft zo ruim), document = bytes / 3, afbeelding vast. `nCons` is de behoudende bovengrens voor als het exact tellen mislukt:
// 1 token per byte (tekst én document; documenten zijn al tot 400 kB begrensd). Geen inhoud bewaard.
function aiSchatTokens(p) {
  let doc = 0, bytes = 0, onbekend = false, tb = 0, beelden = 0, docs = 0;
  const blok = b => { if (!b) return; if (typeof b === 'string') tb += utf8Len(b); else if (b.type === 'text') tb += utf8Len(b.text);
    else if (b.type === 'image') beelden++;
    else if (b.type === 'document') {
      const s = (b && b.source) || {}; let by; docs++;
      if (s.type === 'base64' || (typeof s.data === 'string' && s.type !== 'text')) by = Math.ceil(String(s.data || '').length * 0.75);   // base64: 3 bytes per 4 tekens
      else if (s.type === 'text') by = utf8Len(s.data);
      else if (s.type === 'content') by = utf8Len(JSON.stringify(s.content || ''));
      else { onbekend = true; by = 0; }                    // url-bron of onbekend formaat: de grootte is niet vooraf te begrenzen
      doc += Math.ceil(by / 3); bytes += by;
    } else tb += utf8Len(JSON.stringify(b)); };
  const lijst = c => { if (typeof c === 'string') blok(c); else if (Array.isArray(c)) c.forEach(blok); };
  lijst(p && p.system); for (const m of (p && Array.isArray(p.messages) ? p.messages : [])) lijst(m && m.content);
  if (p && p.tools !== undefined) tb += utf8Len(JSON.stringify(p.tools));   // de tool-schema's tellen mee als invoer (UTF-8-bytes)
  const n = 50 + Math.ceil(tb / 3) + doc + 1600 * beelden, nCons = 50 + tb + bytes + 1600 * beelden;
  return { n, nCons, doc, bytes, onbekend, tekstBytes: tb, teltExact: docs > 0 || beelden > 0 || tb > AI_TEL_DREMPEL };
}
// Het gratis endpoint van Anthropic telt de invoertokens exact (zelfde body zonder max_tokens/stream). null bij elke fout (timeout, 4xx/5xx, rare uitkomst).
async function aiTelTokens(env, parsed) {
  if (!env.CLAUDE_KEY || !parsed || !parsed.model) return null;
  const body = {}; for (const k of ['model', 'messages', 'system', 'tools', 'tool_choice', 'thinking', 'mcp_servers']) if (parsed[k] !== undefined) body[k] = parsed[k];
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), Math.max(10, Number(env.AI_TEL_TIMEOUT_MS) || AI_TEL_TIMEOUT_MS));
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages/count_tokens', { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json', 'x-api-key': env.CLAUDE_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
    if (!r.ok) return null;
    const j = await r.json(); const n = j && j.input_tokens;
    return Number.isInteger(n) && n >= 0 && n < 5e6 ? n : null;
  } catch { return null; } finally { clearTimeout(timer); }
}
const AI_WEIGER = { dag: 'Je AI-limiet voor vandaag is bereikt. Morgen kun je weer verder; vraag de eigenaar om meer ruimte als het dringend is.',
  minuut: 'Even rustig aan: er zijn te veel AI-verzoeken in één minuut gedaan. Probeer het zo opnieuw.',
  gelijktijdig: 'Er loopt al een AI-verzoek van jou. Wacht tot dat klaar is en probeer het dan opnieuw.',
  totaal: 'De AI-limiet van de hele tool voor vandaag is bereikt. Probeer het morgen opnieuw of vraag de eigenaar om hulp.' };
async function aiDO(env, op, body, instantie = 'ai') {
  const ns = env.MT_TELLER; if (!ns || !ns.idFromName) return null;
  const r = await ns.get(ns.idFromName(instantie)).fetch('https://mt-teller/' + op, { method: 'POST', body: JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => null) };
}
// Toetsen vóór het verzoek naar Anthropic gaat. → { ok:true, claim?, ... } of { ok:false, status, body, wacht_s }
async function aiClaim(env, ik, parsed) {
  const modus = aiModus(env); if (modus === 'uit') return { ok: true };
  const lim = await aiLimieten(env), rolLim = lim.rollen[ik.rol];
  if (!rolLim) return { ok: true };                                        // rol zonder AI wordt al door de rolmatrix geweigerd
  const oid = await oidHash(ik.oid), dag = geldVandaag();
  const sch = aiSchatTokens(parsed), uitRes = Math.max(1, Number(parsed.max_tokens) || 1);
  if (sch.doc > AI_DOC_MAX || sch.bytes > AI_DOC_BYTES || sch.onbekend) {   // een document waarvan we de kosten niet veilig kunnen begrenzen: vooraf weigeren (in log-modus alleen melden)
    console.log(JSON.stringify({ ai: modus === 'afdwingen' ? 'geweigerd' : 'zou-weigeren', reden: 'te-groot', oid, rol: ik.rol, geschat: sch.doc, bytes: sch.bytes, onbekend: sch.onbekend || undefined }));
    if (modus === 'afdwingen') return { ok: false, status: 413, wacht_s: 1, body: { type: 'error', error: { type: 'mt_ai_te_groot', reden: 'te-groot', message: sch.onbekend ? 'Dit document kan niet vooraf worden gemeten (alleen bijgevoegde bestanden worden doorgegeven). Voeg het bestand zelf toe.' : 'Dit document is te groot voor de AI (meer dan ' + Math.round(AI_DOC_BYTES / 1024) + ' kB). Splits het of kies een kleiner bestand.' } } };
  }
  // Invoer exact tellen (alleen 'afdwingen'; in 'log' blijft het bij de schatting): bij een document, een afbeelding of veel tekst. Mislukt de telling, dan de behoudende bovengrens.
  let invoer = sch.n, telBron = 'schatting';
  if (modus === 'afdwingen' && sch.teltExact) { const x = await aiTelTokens(env, parsed); if (x != null) { invoer = x; telBron = 'geteld'; } else { invoer = sch.nCons; telBron = 'behoudend'; } console.log(JSON.stringify({ ai: 'invoer', bron: telBron, tokens: invoer, schatting: sch.n })); }
  const reserve = invoer + uitRes;
  let r = null;
  try { r = await aiDO(env, 'ai-claim', { oid, dag, nu: Date.now(), modus, rol: ik.rol, model: parsed.model, reserve, uit_res: uitRes, limiet: { dag: rolLim.dag, minuut: rolLim.minuut, gelijktijdig: rolLim.gelijktijdig, totaal_dag: lim.totaal_dag } }); } catch (e) { r = { status: 503, j: null }; }
  if (!r) {   // geen teller-binding: in 'afdwingen' NIET onbewaakt doorlaten (503), in 'log' wel met een waarschuwing in het log
    console.log(JSON.stringify({ ai: 'geen-binding', modus }));
    return modus === 'afdwingen' ? { ok: false, status: 503, wacht_s: 30, body: { type: 'error', error: { type: 'mt_ai_teller', message: 'De AI-limiet is niet beschikbaar (teller niet ingesteld); de AI staat daarom tijdelijk uit.' } } } : { ok: true };
  }
  if (r.status === 200 && r.j && r.j.ok) { if (r.j.zou_weigeren) console.log(JSON.stringify({ ai: 'zou-weigeren', reden: r.j.zou_weigeren, oid, rol: ik.rol })); return { ok: true, claim: r.j.claim, oid, dag, schat: invoer }; }
  if (r.status === 200 && r.j && r.j.ok === false) {
    const reden = r.j.reden;
    console.log(JSON.stringify({ ai: 'geweigerd', reden, oid, rol: ik.rol }));
    return { ok: false, status: 429, wacht_s: r.j.wacht_s || (reden === 'dag' || reden === 'totaal' ? 3600 : 5),
      body: { type: 'error', error: { type: 'mt_ai_limiet', reden, message: AI_WEIGER[reden] || 'AI-limiet bereikt.' }, limiet: { dag_gebruikt: r.j.dag_gebruikt, dag_limiet: r.j.dag_limiet } } };
  }
  // De teller zelf is stuk: in 'afdwingen' geen onbewaakt AI-gebruik (503), in 'log' gewoon doorlaten.
  console.log(JSON.stringify({ ai: 'teller-fout', modus, status: r.status }));
  return modus === 'afdwingen' ? { ok: false, status: 503, wacht_s: 10, body: { type: 'error', error: { type: 'mt_ai_teller', message: 'De AI-limiet kon niet gecontroleerd worden; probeer het zo opnieuw.' } } } : { ok: true };
}
function aiAfrond(env, ctx, claim, gegevens) {
  if (!claim || !claim.claim) return;
  waitUntil(ctx, aiDO(env, 'ai-afrond', Object.assign({ oid: claim.oid, dag: claim.dag, nu: Date.now(), claim: claim.claim }, gegevens)).catch(() => {}));
}
// Het antwoord ongewijzigd doorgeven en onderweg alleen de getallen (usage) opvangen; aan het eind het werkelijke gebruik afrekenen.
// Breekt de gebruiker de verbinding af (cancel), dan wordt dat direct afgerekend: wat al binnen was (invoer uit message_start, anders de schatting;
// uitvoer = het grootste van de gemelde usage en ±1 token per 3 getelde tekens) — de rest van de reservering gaat terug. Het verzoek naar Anthropic wordt ook gestopt.
function aiMeet(response, env, ctx, claim, model, t0) {
  const reader = response.body.getReader(), dec = new TextDecoder();
  let tin = null, tuit = null, fout = false, rest = '', tekens = 0, klaar = false;
  // Hartslag: een lopende stream verlengt zijn claim elke minuut (ai-verleng), zodat het alarm hem niet als verlopen afrekent. Stopt bij het einde, bij annuleren, bij een weggevallen claim en na AI_HARTSLAG_MAX slagen.
  let slagen = 0, hartslag = null;
  const stopSlag = () => { if (hartslag != null) { clearInterval(hartslag); hartslag = null; } };
  if (claim && claim.claim && aiModus(env) === 'afdwingen') {   // in 'log' (meetweek) tellen claim en afronding wel, maar geen hartslag
    hartslag = setInterval(() => {
      if (klaar || ++slagen > AI_HARTSLAG_MAX) { stopSlag(); return; }
      waitUntil(ctx, aiDO(env, 'ai-verleng', { oid: claim.oid, dag: claim.dag, nu: Date.now(), claim: claim.claim }).then(x => { if (x && x.j && x.j.bestaat === false) stopSlag(); }).catch(() => {}));
    }, Math.max(10, Number(env && env.AI_HARTSLAG_MS) || AI_HARTSLAG_MS));
    if (hartslag && typeof hartslag === 'object' && hartslag.unref) hartslag.unref();
  }
  const regel = r => { const x = r.trim(); if (!x.startsWith('data:')) return; let ev; try { ev = JSON.parse(x.slice(5)); } catch { return; }
    if (ev.type === 'message_start' && ev.message && ev.message.usage) { const u = ev.message.usage; tin = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0); if (typeof u.output_tokens === 'number') tuit = u.output_tokens; }
    else if (ev.type === 'message_delta' && ev.usage && typeof ev.usage.output_tokens === 'number') tuit = ev.usage.output_tokens;
    else if (ev.type === 'content_block_delta' && ev.delta && typeof ev.delta.text === 'string') tekens += ev.delta.text.length;
    else if (ev.type === 'error') fout = true; };
  const rond = status => {
    if (klaar) return; klaar = true; stopSlag();
    const gegevens = { http: response.status, ms: Date.now() - t0, model, status };
    if (status === 'afgebroken') Object.assign(gegevens, { in: tin != null ? tin : (claim.schat || 0), uit: Math.max(tuit || 0, Math.ceil(tekens / 3)) });
    else Object.assign(gegevens, { in: tin, uit: tuit });
    aiAfrond(env, ctx, claim, gegevens);
  };
  return new ReadableStream({
    async pull(c) {
      let r; try { r = await reader.read(); } catch (e) { rond('afgebroken'); c.error(e); return; }
      if (r.done) { regel(rest); rond(fout && tin == null ? 'fout' : 'ok'); c.close(); return; }
      c.enqueue(r.value);
      rest += dec.decode(r.value, { stream: true }); let i; while ((i = rest.indexOf('\n')) >= 0) { regel(rest.slice(0, i)); rest = rest.slice(i + 1); } if (rest.length > 200000) rest = '';
    },
    cancel(reden) { rond('afgebroken'); return reader.cancel(reden).catch(() => {}); } });
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
  const q = new URL(request.url).searchParams, door = { door: ik.oid, doorNaam: (ik.rec && ik.rec.naam) || ik.email };
  // Projectnummers (brok B): lezen mag elke rol; droogloop/status/log: beheer; reeks, toepassen en terugrol: alleen de eigenaar.
  if (m === 'GET' && p === '/teller/status') { const r = await doe('nr-status'); return json(r.j, r.status); }   // alleen lezen
  if (m === 'GET' && p === '/teller/binding') { const r = await doe('nr-binding', { sleutel: String(q.get('sleutel') || '').slice(0, 60) }); return json(r.j, r.status); }
  if (m === 'GET' && (p === '/teller/log' || p === '/teller/migratie/status')) {
    if (!R.beheer) return json({ error: 'geen-toegang', reden: 'beheer' }, 403);
    const r = p === '/teller/log' ? await doe('nr-log', { limiet: Number(q.get('limiet')) || 100 }) : await doe('nr-mig-status', { mig_id: String(q.get('mig_id') || '') });
    return json(r.j, r.status);
  }
  if (m === 'POST' && (p === '/teller/reeks' || p === '/teller/schema' || p.startsWith('/teller/migratie/'))) {
    let b = {}; try { b = await request.json(); } catch {}
    const eigenaar = R.beheer === 'alles';
    if (p === '/teller/schema') {
      if (!eigenaar) return json({ error: 'geen-toegang', reden: 'eigenaar' }, 403);
      // {uitgerold: N} = "de cockpit met schema N staat live" (regie, bij de release); {min: N} = vanaf nu mag alleen schema ≥ N schrijven
      const geldig = v => v == null || (Number.isInteger(v) && v >= NR_SCHEMA_STANDAARD && v <= 99);
      if ((b.min == null && b.uitgerold == null) || !geldig(b.min) || !geldig(b.uitgerold) || b.bevestig !== 'schema') return json({ error: 'ongeldig', uitleg: 'uitgerold en/of min: geheel getal ≥ ' + NR_SCHEMA_STANDAARD + ', bevestig: "schema"' }, 400);
      const r = await doe('nr-schema', { min: b.min, uitgerold: b.uitgerold, ...door });
      if (r.status === 200 && r.j.gewijzigd) await audit(env, { ...door, actie: 'schema', doel: 'teller', doelNaam: 'app-versie projecten', nieuw: 'uitgerold ' + (r.j.schema_uitgerold || '-') + ', minimum ' + r.j.schema_min });
      return json(r.j, r.status);
    }
    if (p === '/teller/reeks') {
      if (!eigenaar) return json({ error: 'geen-toegang', reden: 'eigenaar' }, 403);
      if (typeof b.aan !== 'boolean') return json({ error: 'ongeldig', uitleg: 'aan: true of false' }, 400);
      // aanzetten is onomkeerbaar in zijn gevolgen (verbruikte nummers): expliciete bevestiging verplicht
      if (b.aan && b.bevestig !== 'projectnummers-aan') return json({ error: 'bevestiging-nodig', uitleg: 'bevestig: "projectnummers-aan"' }, 400);
      const r = await doe('nr-reeks', { aan: b.aan, ...door });
      if (r.status === 200 && r.j.gewijzigd) await audit(env, { ...door, actie: b.aan ? 'projectnummers-aan' : 'projectnummers-uit', doel: 'teller', doelNaam: 'projectnummerreeks', nieuw: b.aan ? 'aan' : 'uit' });
      return json(r.j, r.status);
    }
    const welke = p.slice('/teller/migratie/'.length);
    if (!['droogloop', 'toepassen', 'terugrol'].includes(welke)) return json({ error: 'onbekende-route' }, 404);
    if (!R.beheer || (welke !== 'droogloop' && !eigenaar)) return json({ error: 'geen-toegang', reden: welke === 'droogloop' ? 'beheer' : 'eigenaar' }, 403);
    if (b.mig_id != null && !NR_MIG_RE.test(String(b.mig_id))) return json({ error: 'ongeldig-mig_id' }, 400);
    if (welke === 'terugrol') {
      const r = await doe('nr-mig-terugrol', { mig_id: String(b.mig_id || ''), ...door });
      await audit(env, { ...door, actie: 'projectnummers-terugrol', doel: String(b.mig_id || ''), doelNaam: r.status === 200 ? r.j.teruggerold.length + ' project(en)' : 'geweigerd', nieuw: r.status === 200 ? 'teruggerold' : String(r.j.error || r.status) });
      return json(r.j, r.status);
    }
    const items = Array.isArray(b.items) ? b.items : null;
    if (!items || !items.length || items.length > NR_MIG_MAX) return json({ error: 'ongeldige-items', max: NR_MIG_MAX }, 400);
    const schoon = [];
    for (const x of items) {
      const pid = String((x && x.project_id) || ''), oud = x && x.oud != null ? String(x.oud) : null, al = x && Array.isArray(x.aliassen) ? x.aliassen.map(String) : [];
      if (!WERKCODE_PID_RE.test(pid) || (oud !== null && !NR_WCODE_RE.test(oud) && !NR_ALIAS_RE.test(oud)) || (x.aliassen != null && !Array.isArray(x.aliassen)) || al.length > NR_ALIAS_MAX
        || al.some(a => !NR_ALIAS_RE.test(a) || /^\d{6}$/.test(a))) return json({ error: 'ongeldig-item', project_id: pid }, 400);
      schoon.push({ project_id: pid, oud, aliassen: al });
    }
    if (welke === 'droogloop') { const r = await doe('nr-mig-proef', { items: schoon }); return json(r.j, r.status); }
    const r = await doe('nr-mig-toepassen', { items: schoon, hash: String(b.hash || ''), mig_id: b.mig_id || null, ...door });
    if (!(r.status === 200 && r.j.herhaald)) await audit(env, { ...door, actie: 'projectnummers-migratie', doel: (r.j && r.j.mig_id) || String(b.mig_id || '') || 'teller', doelNaam: r.status === 200 ? r.j.plan.length + ' project(en)' : 'geweigerd', nieuw: r.status === 200 ? r.j.plan.map(x => x.oud + '→' + x.nieuw).join(', ').slice(0, 300) : String(r.j.error || r.status) });
    return json(r.j, r.status);
  }
  if (m !== 'POST' || (p !== '/teller/werkcode' && p !== '/teller/werkcode/batch')) return json({ error: 'onbekende-route' }, 404);
  // Nummers uitgeven: in élke modus afgedwongen (een verbruikt nummer komt nooit terug).
  if (R.projecten !== 'wijzigen') return json({ error: 'geen-toegang', reden: 'projecten-wijzigen' }, 403);
  let body = {}; try { body = await request.json(); } catch {}
  if (p === '/teller/werkcode') {
    const pid = String((body && body.project_id) || '');
    if (!WERKCODE_PID_RE.test(pid)) return json({ error: 'ongeldig-project_id' }, 400);
    // nieuw project: W-code met het jaar van nu (server), of — als de nieuwe reeks aan staat — een projectnummer
    const r = await doe('nr-nieuw', { project_id: pid, jaar: jaarNu(), schema: Number(body.schema) || 1, ...door });
    if (r.status !== 200) return json(r.j, r.status);
    const u = r.j;
    if (u.nieuw) await audit(env, { ...door, actie: u.projectnummer ? 'projectnummer-toegekend' : 'werkcode-toegekend', doel: pid, doelNaam: u.code, nieuw: u.code });
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
// Cron-run (Koersmeter): één gedeeld budget voor ALLE subrequests van de run (KV, Moneybird, Durable Object); zie koersBudget.
const geldBudget = env => ({ rest: env && env.__sub ? Math.min(GELD.budget, env.__sub.rest()) : GELD.budget });
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
// Koersmeter C: dagfoto (zie /geld/koers/dagfoto). Streng: alleen bekende kleuren/meters, getallen of null.
const GELD_DAGFOTO = 'geld:koers:dag:', GELD_KLEUR = ['groen', 'oranje', 'rood', 'onbetrouwbaar'], GELD_MKLEUR = ['groen', 'oranje', 'rood', 'neutraal', 'onbekend'], GELD_METER = ['kas', 'marge', 'omzet'];
function geldDagfotoFout(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return 'object verwacht';
  const vreemd = Object.keys(b).find(k => !['jaar', 'kleur', 'meters', 'bronnen', 'datum'].includes(k)); if (vreemd !== undefined) return `onbekend veld "${String(vreemd).slice(0, 40)}"`;
  if (!Number.isInteger(b.jaar) || b.jaar < 2020 || b.jaar > 2100) return 'jaar';
  if (!GELD_KLEUR.includes(b.kleur)) return 'kleur';
  if (!Array.isArray(b.meters) || b.meters.length > GELD_METER.length) return 'meters: lijst';
  const ids = new Set();
  for (const x of b.meters) {
    if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).some(k => !['id', 'kleur', 'getal'].includes(k))) return 'meter: alleen id, kleur, getal';
    if (!GELD_METER.includes(x.id) || ids.has(x.id)) return 'meter-id'; ids.add(x.id);
    if (!GELD_MKLEUR.includes(x.kleur)) return 'meter-kleur';
    if (x.getal != null && !(typeof x.getal === 'number' && isFinite(x.getal) && Math.abs(x.getal) < 1e10)) return 'meter-getal';
  }
  if (b.bronnen != null && !(Array.isArray(b.bronnen) && b.bronnen.length <= 20 && b.bronnen.every(x => typeof x === 'string'))) return 'bronnen: max 20 teksten';
  return null;
}
// Schulden (leningen) voor de rekenhulp in Geld: hele centen, rente in basispunten (null = onbekend, 0 alleen expliciet).
// Geen vrije tekst behalve de naam (≤ 60). Max. 10. Fout → de lening valt weg (normaliseren) of 400 (POST).
const GELD_SCHULD_MAX = 10, GELD_SCHULD_SOORT = ['hypotheek', 'lening', 'krediet', 'overig'], GELD_SCHULD_VORM = ['annuiteit', 'lineair', 'aflossingsvrij', 'vrij'];
const GELD_SCHULD_VELDEN = new Set(['id', 'naam', 'soort', 'vorm', 'restschuld_cent', 'stand_datum', 'rente_bp', 'maandtermijn_cent', 'aflossing_cent', 'einde', 'ledger_id']);
function geldSchuldFout(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return 'lening: object verwacht';
  // Onbekende velden (ook __proto__ of constructor uit JSON) weigeren, niet stil weglaten.
  const vreemd = Object.keys(x).find(k => !GELD_SCHULD_VELDEN.has(k)); if (vreemd !== undefined) return `onbekend veld "${String(vreemd).slice(0, 40)}"`;
  const cent = (v, max) => v === null || v === undefined ? null : Number.isInteger(v) && v >= 0 && v <= max ? v : false;
  if (!GELD_POT_ID.test(String(x.id || ''))) return 'id ongeldig (a-z, 0-9, -)';
  if (x.id === 'rc') return 'id "rc" is gereserveerd voor de rekening-courant';
  const naam = typeof x.naam === 'string' ? x.naam.trim() : '';
  if (!naam || naam.length > 60) return 'naam: 1 tot 60 tekens';
  if (!GELD_SCHULD_SOORT.includes(x.soort)) return 'soort: ' + GELD_SCHULD_SOORT.join(' | ');
  if (!GELD_SCHULD_VORM.includes(x.vorm)) return 'vorm: ' + GELD_SCHULD_VORM.join(' | ');
  if (!(Number.isInteger(x.restschuld_cent) && x.restschuld_cent >= 0 && x.restschuld_cent <= 1e11)) return 'restschuld_cent: heel getal ≥ 0';
  if (!geldIsDatum(x.stand_datum)) return 'stand_datum: JJJJ-MM-DD';
  if (cent(x.rente_bp, 5000) === false) return 'rente_bp: heel getal 0–5000 of null';
  if (cent(x.maandtermijn_cent, 1e10) === false) return 'maandtermijn_cent: heel getal ≥ 0 of null';
  if (cent(x.aflossing_cent, 1e10) === false) return 'aflossing_cent: heel getal ≥ 0 of null';
  if (x.einde != null && !(geldIsDatum(x.einde) && x.einde > x.stand_datum)) return 'einde: JJJJ-MM-DD na stand_datum, of null';
  if (x.ledger_id != null && !/^\d{6,25}$/.test(String(x.ledger_id))) return 'ledger_id: alleen cijfers, of null';
  return null;
}
const geldSchuldNorm = x => ({ id: String(x.id), naam: x.naam.trim(), soort: x.soort, vorm: x.vorm, restschuld_cent: x.restschuld_cent, stand_datum: x.stand_datum,
  rente_bp: x.rente_bp == null ? null : x.rente_bp, maandtermijn_cent: x.maandtermijn_cent == null ? null : x.maandtermijn_cent, aflossing_cent: x.aflossing_cent == null ? null : x.aflossing_cent,
  einde: x.einde == null ? null : x.einde, ledger_id: x.ledger_id == null ? null : String(x.ledger_id) });
function geldSchuldenNorm(l) {
  const ids = new Set();
  return (Array.isArray(l) ? l : []).filter(x => !geldSchuldFout(x) && !ids.has(x.id) && ids.add(x.id)).slice(0, GELD_SCHULD_MAX).map(geldSchuldNorm);
}
function geldConfigNorm(c) {
  c = c && typeof c === 'object' ? c : {};
  const getal = (x, min, max) => (typeof x === 'number' && isFinite(x) && x >= min && x <= max) ? x : null;
  const potten = (Array.isArray(c.potten) ? c.potten : []).filter(p => p && GELD_POT_ID.test(String(p.id)) && p.id !== 'lopend').map(p => ({
    id: String(p.id), naam: String(p.naam || p.id).slice(0, 40), doel: GELD_POT_DOELEN.includes(p.doel) ? p.doel : 'overig',
    ledger: /^\d{6,25}$/.test(String(p.ledger || '')) ? String(p.ledger) : null,
    herkenning: { tegenrekening: String((p.herkenning && p.herkenning.tegenrekening) || '').replace(/\s+/g, '').toUpperCase().slice(0, 40),
      omschrijving: String((p.herkenning && p.herkenning.omschrijving) || '').trim().slice(0, 60),
      letter: /^[A-Za-z]$/.test(String((p.herkenning && p.herkenning.letter) || '')) ? String(p.herkenning.letter).toUpperCase() : '' },
    weekinleg: getal(p.weekinleg, 0, 1e7), weekdag: Number.isInteger(p.weekdag) && p.weekdag >= 1 && p.weekdag <= 7 ? p.weekdag : null, actief: p.actief !== false,
    streef: geldStreefNorm(p.streef), virtueel: p.virtueel === true }))
    .map(p => p.virtueel ? Object.assign(p, { ledger: null, herkenning: { tegenrekening: '', omschrijving: '', letter: '' } }) : p);   // virtueel: geen eigen rekening
  const ids = new Set(), uniek = potten.filter(p => !ids.has(p.id) && ids.add(p.id));
  const btw = c.btw && typeof c.btw === 'object' ? c.btw : {};
  const rek = x => (x === 'lopend' || uniek.some(p => p.id === x && !p.virtueel)) ? x : null;   // virtueel heeft geen eigen saldo
  const groepen = (Array.isArray(c.klantgroepen) ? c.klantgroepen : []).filter(g => g && GELD_POT_ID.test(String(g.id))).map(g => ({
    id: String(g.id), naam: String(g.naam || g.id).slice(0, 60), prefix: String(g.prefix || '').trim().slice(0, 60),
    contact_ids: (Array.isArray(g.contact_ids) ? g.contact_ids : []).map(String).filter(x => /^\d{6,25}$/.test(x)).slice(0, 200) }))
    .filter(g => g.prefix.length >= 3 || g.contact_ids.length);
  const uit = { kredietlimiet: getal(c.kredietlimiet, 0, 1e9), potten: uniek, klantgroepen: groepen, lopend_streef: geldStreefNorm(c.lopend_streef), prognose_schema: geldSchemaNorm(c.prognose_schema),
    // buffer_lopend (eigen ondergrens) is samengevoegd met de fictieve buffer: een gezet oud veld wordt het eigen bedrag (negatief → 0). Eén release lang schrijven we beide velden
    // (dual-write) zodat een terugdraaiing van de front-end niets verliest: buffer_lopend = de fictieve buffer, of de oude waarde zolang er nog geen fictieve buffer is.
    buffer_lopend: null,   // hieronder gelijkgetrokken met fictieve_buffer (dual-write)
    // G7: fictieve buffer op lopend (≥ 0). Alleen een gele lijn in de grafiek en de onderkant van de kasruimte/Koersmeter; nooit als getal in Geld (behalve Instellingen).
    fictieve_buffer: getal(c.fictieve_buffer, 0, 1e9) != null ? getal(c.fictieve_buffer, 0, 1e9) : getal(c.buffer_lopend, 0, 1e9),   // een negatief oud veld telt niet (geweigerd bij invoer)
    // cijfers (G9): indeling grootboek → categorie, privé- en aflossingsgrootboeken, loonpatronen, branche; null = voorstel
    cijfers: geldCijferCfgNorm(c.cijfers),
    // spaarrente op de potjes (fractie per jaar), door de eigenaar ingevuld; leeg = afleiden uit rentebijschrijvingen
    spaarrente: typeof c.spaarrente === 'number' && isFinite(c.spaarrente) && c.spaarrente >= 0 && c.spaarrente <= 0.2 ? c.spaarrente : null,
    schulden: geldSchuldenNorm(c.schulden),
    // Eigen reserve (alleen weergave): tot dit bedrag, en nooit meer dan de stand van het reservepotje, telt een stand
    // onder 0 als "eigen reserve" in plaats van bankkrediet.
    reserve: c.reserve && typeof c.reserve === 'object' && getal(c.reserve.bedrag, 0, 1e9) != null ? { bedrag: c.reserve.bedrag, pot: uniek.some(p => p.id === c.reserve.pot && !p.virtueel && p.doel !== 'btw' && p.id !== (btw.spaarpot || null)) ? c.reserve.pot : null } : null,   // nooit de BTW-pot (die telt al in lopend)
    // modus 'in_lopend' (standaard): de BTW-pot telt mee als lopende rekening, aangifte van die gecombineerde stand, geen
    // terugboeking; 'apart': BTW-pot als eigen rekening met aangifte_van/terugboeking_van.
    btw: { modus: btw.modus === 'apart' ? 'apart' : 'in_lopend', spaarpercentage: getal(btw.spaarpercentage, 0, 1), spaarpot: uniek.some(p => p.id === btw.spaarpot && !p.virtueel) ? btw.spaarpot : null,
      aangifte_van: rek(btw.aangifte_van), terugboeking_van: rek(btw.terugboeking_van),
      // kwartalen die de eigenaar als betaald heeft gemarkeerd (de betaling is niet automatisch terug te vinden)
      betaald_kwartalen: [...new Set((Array.isArray(btw.betaald_kwartalen) ? btw.betaald_kwartalen : []).map(String).filter(x => /^\d{4}-K[1-4]$/.test(x)))].sort().slice(0, 12) },
    gewijzigd: c.gewijzigd || null, door: c.door || null, revisie: Number.isInteger(c.revisie) ? c.revisie : 0 };
  uit.buffer_lopend = uit.fictieve_buffer;   // exact dezelfde waarde (één release lang dual-write voor een terugdraaiing)
  uit.streef_herkomst = geldStreefHerkomst(c.streef_herkomst, uit);
  return uit;
}
// G7: de streefbedragen (fictieve buffer, streefomvang noodbuffer, streefniveau lopend) volgen standaard het berekende advies; een eigen bedrag wint, leeg = weer het advies.
// De herkomst wordt uit de bedragen zelf afgeleid ('handmatig' = er is een eigen bedrag, anders 'advies') en met datum en naam van de laatste wijziging vastgelegd.
const geldEigenStreef = x => !!x && (x.bedrag != null || (x.van != null && x.tot != null));
function geldNoodPotId(cfg) {
  if (cfg.reserve && cfg.reserve.pot) return cfg.reserve.pot;
  const p = cfg.potten.find(x => x.doel === 'buffer' && !x.virtueel && x.actief !== false && x.id !== (cfg.btw || {}).spaarpot);
  return p ? p.id : null;
}
function geldStreefBedragen(cfg) {
  const np = geldNoodPotId(cfg), pot = cfg.potten.find(x => x.id === np), sj = x => x ? [x.bedrag, x.van, x.tot] : null;
  return { fictieve_buffer: cfg.fictieve_buffer, noodbuffer: pot && geldEigenStreef(pot.streef) ? sj(pot.streef) : null, lopend: geldEigenStreef(cfg.lopend_streef) ? sj(cfg.lopend_streef) : null };
}
function geldStreefHerkomst(oud, cfg) {
  oud = oud && typeof oud === 'object' ? oud : {};
  const b = geldStreefBedragen(cfg), eigen = { fictieve_buffer: b.fictieve_buffer != null, noodbuffer: b.noodbuffer != null, lopend: b.lopend != null }, r = {};
  for (const k of Object.keys(eigen)) { const o = oud[k] && typeof oud[k] === 'object' ? oud[k] : {}; r[k] = { bron: eigen[k] ? 'handmatig' : 'advies', datum: geldIsDatum(o.datum) ? o.datum : null, door: typeof o.door === 'string' ? o.door.slice(0, 60) : null }; }
  return r;
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
// Retry-After: een aantal seconden OF een HTTP-datum → seconden (0 = onbekend). Productplafond ZOEK_RETRY_MAX (24 uur): een langere
// wachttijd van Moneybird wordt tot een dag teruggebracht, zodat een foutieve of extreme header de zoekbalk niet blijvend lamlegt.
const ZOEK_RETRY_MAX = 24 * 3600;
function retryAfterSec(h, nu) {
  h = String(h == null ? '' : h).trim(); if (!h) return 0;
  if (/^\d+$/.test(h)) return Math.min(Number(h), ZOEK_RETRY_MAX);
  const t = Date.parse(h); if (isNaN(t)) return 0;
  return Math.max(0, Math.min(ZOEK_RETRY_MAX, Math.ceil((t - (nu || Date.now())) / 1000)));
}
function geldMb(env, budget, opties) {
  const hdr = { Authorization: `Bearer ${env.MONEYBIRD_KEY}`, Accept: 'application/json' };
  let bezig = 0; const rij = [];
  const slot = () => bezig < GELD_MB_TEGELIJK ? (bezig++, Promise.resolve()) : new Promise(res => rij.push(res));
  const vrij = () => { const n = rij.shift(); if (n) n(); else bezig--; };
  const haal = async pad => { if (env.__sub && !env.__sub.neem()) return { netwerk: 'subrequest-budget-op' }; try { return await fetch(`https://moneybird.com/api/v2/${MB_ADMIN}/${pad}`, { headers: hdr, signal: opties && opties.signal }); } catch (e) { return { netwerk: String(e.message || e).slice(0, 80) }; } };
  return async function get(pad) {
    if (budget.rest <= 0) return { ok: false, status: 0, fout: 'budget-op' };
    budget.rest--;
    await slot();
    let r;
    try {
      r = await haal(pad);
      for (let poging = 1; r.status === 429 && poging <= 2 && budget.rest > 0 && !(opties && opties.geen429Retry); poging++) {
        budget.rest--;                                               // eerst reserveren, dan wachten (anders kan een ander verzoek het restant opmaken)
        const ra = Number(r.headers && r.headers.get && r.headers.get('Retry-After'));
        await new Promise(res => setTimeout(res, ra > 0 ? Math.min(ra, 8) * 1000 : 1500 * poging));
        r = await haal(pad);
      }
    } finally { vrij(); }
    if (r.netwerk) return { ok: false, status: 0, fout: 'netwerk: ' + r.netwerk };
    if (r.status === 429) { const ra = retryAfterSec(r.headers && r.headers.get && r.headers.get('Retry-After')); return { ok: false, status: 429, retryAfter: ra, fout: 'Moneybird is even druk (429) — over een minuut opnieuw' }; }
    let data = null, tekst = '';
    try { tekst = await r.text(); data = JSON.parse(tekst); } catch {}
    if (!r.ok) return { ok: false, status: r.status, fout: (data && (data.error || data.message)) || tekst.slice(0, 120) || ('HTTP ' + r.status) };
    return { ok: true, status: r.status, data };
  };
}
// Lijst met paginering (per_page=100); dubbele id's eruit; fouten → waarschuwing + onvolledig.
// Waarschuwingen met onvolledig: true = er ontbreken gegevens (afgebroken lijst, mislukte aanvraag, bron niet te lezen,
// niet berekend of te oud). De Koersmeter geeft dan "oordeel onbetrouwbaar", nooit groen; echte signalen (BTW-tekort,
// te late termijn) hebben de vlag niet.
async function geldLijst(get, pad, w, label) {
  const uit = [], gezien = new Set(); let page = 1, onvolledig = false;
  for (;;) {
    const r = await get(`${pad}${pad.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!r.ok) { w.push({ onvolledig: true, bron: label, fout: r.fout, status: r.status, retryAfter: r.retryAfter, pad: pad.split('?')[0] }); onvolledig = true; break; }
    if (!Array.isArray(r.data)) { w.push({ onvolledig: true, bron: label, fout: 'onverwacht antwoord (geen lijst)', pad: pad.split('?')[0] }); onvolledig = true; break; }
    const d = r.data;
    const nieuw = d.filter(x => x && x.id && !gezien.has(x.id));
    nieuw.forEach(x => gezien.add(x.id)); uit.push(...nieuw);
    if (d.length < 100 || !nieuw.length) break;
    if (++page > 20) { w.push({ onvolledig: true, bron: label, fout: 'meer dan 20 pagina\'s — afgebroken', pad: pad.split('?')[0] }); onvolledig = true; break; }
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
    if (r.ok && !Array.isArray(r.data)) { w.push({ onvolledig: true, bron: 'bankmutaties', fout: 'onverwacht antwoord (geen lijst)', periode: `${a}..${b}` }); onvolledig = true; return; }
    const vol = r.ok && r.data.length >= 100;
    const teVeel = !r.ok && r.status === 400 && /too many|sync api/i.test(String(r.fout || ''));
    const serverFout = !r.ok && (r.status >= 500 || r.status === 0 || r.status === 429) && r.fout !== 'budget-op' && foutDiepte < 3;   // geen 4xx-fouten herhalen
    if ((vol || teVeel || serverFout) && a < b) {
      const dagen = Math.round((Date.parse(b) - Date.parse(a)) / 864e5), mid = geldDag(a, Math.floor(dagen / 2)), d = serverFout ? foutDiepte + 1 : foutDiepte;
      await stuk(a, mid, d); await stuk(geldDag(mid, 1), b, d); return;
    }
    if (!r.ok) { w.push({ onvolledig: true, bron: 'bankmutaties', fout: teVeel ? 'te veel mutaties op één dag — mogelijk onvolledig' : r.fout, status: r.status, periode: `${a}..${b}` }); onvolledig = true; return; }
    if (vol) { w.push({ onvolledig: true, bron: 'bankmutaties', fout: '100 of meer mutaties op één dag — mogelijk onvolledig', periode: a }); onvolledig = true; }
    for (const m of r.data) if (m && m.id) uit.set(m.id, m);
  };
  if (van <= tot) await stuk(van, tot);
  return { lijst: [...uit.values()], onvolledig };
}
// Welke pot hoort bij deze bankmutatie? Op grootboek (alle boekingen op het pot-grootboek) of op de EXACTE tegenrekening van de pot
// (ook als de mutatie elders is geboekt, bv. op een tussenrekening: een overboeking van of naar een pot-IBAN is altijd intern) — tenzij de
// mutatie aan een factuur hangt (dan nooit stil intern). Heeft de mutatie geen tegenrekening, dan telt een pot-IBAN in de omschrijving.
// Alleen een naam/omschrijving zonder IBAN → onzeker (te bevestigen). Meer dan één pot, of deels op een pot-grootboek → onzeker (melden, niet gokken).
// Bij een lege tegenrekening (zo levert de bank de overboekingen tussen eigen rekeningen) zit de pot in de naam: "Zakelijke oranje spaarrekening Z". De letter
// erachter hoort bij één pot: `herkenning.letter`, anders de letter waarmee de naam, de omschrijving of het id van de pot eindigt ("BTW Z"). Onbekende letter → niet herkend (gemeld).
const GELD_SPAAR_LETTER = /spaarrekening\s+([A-Z])(\d{6,})?\s*$/i;   // "…spaarrekening Z" of, zoals de bank het levert, "…spaarrekening Z96824563" (letter + rekeningnummer)
const geldPotLetters = p => {
  const uit = new Set(), eind = t => { const m = /(?:^|[\s(\-–])([A-Za-z])\)?\s*$/.exec(String(t || '').trim()); return m ? m[1].toUpperCase() : null; };
  const h = p.herkenning || {};
  for (const l of [h.letter, eind(h.omschrijving), eind(p.naam), String(h.tegenrekening || '').length === 1 ? h.tegenrekening : null, String(p.id || '').length === 1 ? p.id : null]) if (l && /^[A-Za-z]$/.test(l)) uit.add(l.toUpperCase());
  return uit;
};
// `inactief` = de tegenrekening hoort bij een pot die op inactief staat: die wordt niet meer herkend, maar mag ook niet stil verdwijnen.
function geldPotVan(m, potten) {
  const ids = (m.ledger_account_bookings || []).map(b => String(b.ledger_account_id));
  const potLedgers = new Set(potten.filter(p => p.ledger).map(p => p.ledger));
  const metFactuur = (m.payments || []).length > 0;      // hangt aan een factuur → nooit stil intern
  const vrij = !metFactuur && ids.every(id => potLedgers.has(id));
  const tekst = (String(m.message || '') + ' ' + String(m.contra_account_name || '')).toLowerCase();
  const tegen = String(m.contra_account_number || '').replace(/\s+/g, '').toUpperCase();
  const tekstCompact = String(m.message || '').replace(/\s+/g, '').toUpperCase();
  const naamDelen = GELD_SPAAR_LETTER.exec(String(m.contra_account_name || '').trim()) || [], naamLetter = String(naamDelen[1] || '').toUpperCase(), naamNummer = String(naamDelen[2] || '');
  const ibanVan = p => String(p.herkenning.tegenrekening || '').length >= 12 && (tegen ? tegen === p.herkenning.tegenrekening : tekstCompact.includes(p.herkenning.tegenrekening));   // een IBAN, geen losse letter of woord
  // De pot hoort bij de letter, of — als de pot een rekeningnummer als tegenrekening heeft — bij het nummer achter de letter.
  const nummerVan = p => !!naamNummer && [naamLetter + naamNummer, naamNummer].includes(String(p.herkenning.tegenrekening || ''));
  const letterVan = p => !!naamLetter && !tegen && (geldPotLetters(p).has(naamLetter) || nummerVan(p));
  const eigenVan = p => ibanVan(p) || letterVan(p);
  const zeker = potten.filter(p => p.actief && ((!metFactuur && p.ledger && ids.length && ids.every(id => id === p.ledger)) || (!metFactuur && eigenVan(p))));
  const viaTekst = potten.filter(p => p.actief && vrij && !zeker.includes(p) && p.herkenning.omschrijving.length >= 4 && tekst.includes(p.herkenning.omschrijving.toLowerCase()));
  const deels = ids.some(id => potLedgers.has(id)) && !ids.every(id => potLedgers.has(id));
  const viaIbanFactuur = metFactuur ? potten.filter(p => p.actief && eigenVan(p)) : [];
  const kandidaten = [...new Set([...zeker, ...viaTekst, ...viaIbanFactuur, ...(deels || metFactuur ? potten.filter(p => p.ledger && ids.includes(p.ledger)) : [])].map(p => p.id))];
  const inactief = potten.filter(p => !p.actief && eigenVan(p)).map(p => p.id);
  const geboekt = ids.length > 0 && !ids.every(id => potLedgers.has(id));
  if (zeker.length === 1 && !deels && !viaTekst.length) return { pot: zeker[0].id, onzeker: false, kandidaten, geboekt, inactief };
  return { pot: null, onzeker: kandidaten.length > 0, kandidaten, alleenTekst: !zeker.length && !deels && !viaIbanFactuur.length && viaTekst.length > 0, inactief };
}
// Een mutatie zonder boeking en zonder factuur die er uitziet als een overboeking tussen eigen rekeningen: de naam noemt spaar/online bankieren/
// eigen rekening/interne overboeking, of er is een tegenrekening zonder naam. Een gewone betaling aan een leverancier heeft een naam en valt hier niet onder.
const GELD_INTERN_NAAM = /spaar|online\s*bankieren|eigen\s*rekening|interne?\s*overboeking/i;
function geldInternVermoed(m) {
  const naam = String(m.contra_account_name || '').trim();
  return GELD_INTERN_NAAM.test(naam) || (!naam && (!!String(m.contra_account_number || '').trim() || GELD_INTERN_NAAM.test(String(m.message || ''))));
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
  if (sp.pot) { ev.intern = true; ev.pot = sp.pot; ev.uitleg = (bedrag < 0 ? 'Inleg in' : 'Opname uit') + ' spaarpot (interne overboeking: telt niet mee in "totaal").'; if (sp.geboekt) { ev.geboekt_elders = true; ev.uitleg += ' Herkend op de tegenrekening van de pot, hoewel de mutatie elders is geboekt.'; } }
  else if (sp.onzeker) { ev.intern_onzeker = true; ev.pot_kandidaten = sp.kandidaten; ev.uitleg += sp.alleenTekst ? ' Omschrijving lijkt op een spaarpot — te bevestigen (stel de tegenrekening van de pot in).' : ' Mogelijk (deels) een overboeking naar een spaarpot — controleer.'; }
  else if (sp.inactief.length) { ev.intern_vermoed = true; ev.vermoed_reden = 'inactieve pot'; ev.uitleg += ` Tegenrekening van de pot "${sp.inactief[0]}", die op inactief staat: niet meer herkend, dus de potstand klopt niet meer — zet de pot weer actief.`; }
  else if (!(m.payments || []).length && ((!(m.ledger_account_bookings || []).length && geldInternVermoed(m)) || GELD_SPAAR_LETTER.test(String(m.contra_account_name || '').trim()))) { ev.intern_vermoed = true; ev.vermoed_reden = 'lijkt intern'; ev.uitleg += ' Lijkt een overboeking tussen lopend en een spaarpot, maar hoort bij geen ingestelde pot: de potstand klopt dan niet (stel de tegenrekening van de pot in).'; }
  return ev;
}
// Open factuur → event op de vervaldag (betaaldag-logica volgt in G2). Achterstallig blijft staan; zonder
// vervaldag geen gok: zekerheid "invullen".
// Een "verkoopfactuur" zonder factuurdatum of factuurnummer is een concept dat nooit verstuurd is (of een inkoopfactuur die per ongeluk als
// verkoop is aangemaakt): daar komt geen geld voor binnen. Telt dus niet als verwachte ontvangst; wel zichtbaar, met een waarschuwing en de link.
const geldVerkoopConcept = d => d.state === 'draft' || !String(d.invoice_id || '').trim() || !geldIsDatum(d.invoice_date);
const geldEurTekst = n => String(geldRond(n).toFixed(2)).replace('.', ',');
// Inkoop-creditnota's (negatieve inkoopfactuur) worden in de praktijk VERREKEND met de volgende facturen van DEZELFDE leverancier: er komt dan geen
// geld binnen, de uitgaven worden lager. Per leverancier (contact_id) gaat de creditnota eerst van de vroegste vervaldag af. Wat overblijft (geen open
// facturen, of minder dan het tegoed) is "tegoed bij leverancier": telt standaard NIET als ontvangst (de eigenaar kan dat per creditnota aanzetten).
// Alleen inkoopfacturen van hetzelfde contact worden verrekend, nooit verkoopfacturen. Muteert de events; geeft de verrekeningen terug.
function geldCreditVerrekening(paren, w) {
  const per = new Map(), verrekend = [];
  for (const [, e] of paren) {
    if (e.valuta_onzeker) continue;                                  // vreemde valuta zonder bruikbaar EUR-bedrag: buiten de cashflow én buiten de verrekening
    if (!e.contact_id) {
      // Zonder stabiele leverancier-id kan er niet veilig verrekend worden, en een creditnota is nooit een ontvangst zonder dat het zeker is: tegoed, telt niet, melden.
      if (e.bedrag < 0) {
        e.tegoed = true; e.tegoed_onbekend = true; e.uitleg = 'Creditnota van een leverancier zonder bekend contact (geen contact-id in Moneybird): niet te verrekenen, dus tegoed — telt niet als ontvangst.';
        if (w) w.push({ onvolledig: true, bron: 'inkoopfacturen', fout: 'creditnota zonder contact-id: niet verrekend en niet als ontvangst meegeteld — controleer in Moneybird' + (e.tegenpartij ? ' (' + e.tegenpartij + ')' : ''), document_id: e.document_id, url: e.bron_url });
      }
      continue;
    }
    if (!per.has(e.contact_id)) per.set(e.contact_id, []); per.get(e.contact_id).push(e);
  }
  for (const lijst of per.values()) {
    const credits = lijst.filter(e => e.bedrag < 0).sort((a, b) => String(a.datum || a.factuurdatum || '9999').localeCompare(String(b.datum || b.factuurdatum || '9999')));
    const open = lijst.filter(e => e.bedrag > 0).sort((a, b) => String(a.datum || '9999').localeCompare(String(b.datum || '9999')) || String(a.id).localeCompare(String(b.id)));
    for (const c of credits) {
      let rest = geldRond(-c.bedrag); const met = [];
      for (const f of open) {
        if (rest <= 0.004) break; if (f.bedrag <= 0.004) continue;
        const neem = geldRond(Math.min(rest, f.bedrag)), nr = c.referentie || c.document_id;
        f.bedrag = geldRond(f.bedrag - neem); rest = geldRond(rest - neem);
        f.verrekend = (f.verrekend || []).concat({ credit: String(c.document_id), bedrag: neem });
        f.verrekend_tekst = (f.verrekend_tekst || '') + ` Verrekend met creditnota ${nr} (−€ ${geldEurTekst(neem)}).`;
        met.push({ document_id: String(f.document_id), bedrag: neem });
      }
      const verr = geldRond(-c.bedrag - rest);
      if (verr > 0.004) verrekend.push({ credit_id: String(c.document_id), tegenpartij: c.tegenpartij, bedrag: verr, met });
      if (rest <= 0.004) { c.bedrag = 0; c.verrekend_volledig = true; }
      else {
        c.bedrag = -rest; c.tegoed = true;
        c.uitleg = (verr > 0.004 ? `Creditnota van de leverancier: € ${geldEurTekst(verr)} is verrekend met open facturen, het restant van € ${geldEurTekst(rest)}` : 'Creditnota van de leverancier zonder open facturen om mee te verrekenen') + ' is tegoed bij de leverancier: er komt geen geld binnen, dus het telt niet als ontvangst.';
      }
    }
  }
  return verrekend;
}
function geldFactuurEvent(soort, d, vandaag, w) {
  const verkoop = soort === 'verkoop';
  // Vreemde valuta: alleen met een geldig bedrag in euro (de *_base-velden). Anders buiten de cashflow én buiten de verrekening, en de bron wordt onvolledig.
  const eurOk = v => v != null && v !== '' && isFinite(parseFloat(v)), vreemd = !!d.currency && d.currency !== 'EUR';
  const valutaOnzeker = vreemd && !(eurOk(d.total_price_incl_tax_base) && (verkoop ? eurOk(d.total_unpaid_base) : (d.payments || []).every(p => eurOk(p.price_base))));
  if (valutaOnzeker) w.push({ onvolledig: true, bron: soort + 'facturen', fout: 'factuur in ' + d.currency + ' zonder (volledig) bedrag in euro — niet meegeteld in de cashflow en niet verrekend, controleer in Moneybird', document_id: d.id, url: geldUrl(verkoop ? 'sales_invoices' : 'documents', d.id) });
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
    factuurdatum: (verkoop ? d.invoice_date : d.date) || null, referentie: d.reference || d.invoice_id || '', factuurnummer: verkoop ? String(d.invoice_id || '') : undefined, status: d.state,
    uitleg: due ? (verkoop ? 'Open verkoopfactuur op de vervaldag.' : 'Open inkoopfactuur op de vervaldag.') : 'Geen vervaldag in Moneybird — datum invullen.',
  };
  if (open < 0) ev.creditnota = true;
  const cid = d.contact_id != null ? String(d.contact_id) : (c.id != null ? String(c.id) : ''); if (cid) ev.contact_id = cid;
  if (valutaOnzeker) { ev.valuta_onzeker = true; ev.telt_niet = { soort: 'valuta', reden: 'Factuur in ' + d.currency + ' zonder bedrag in euro: niet meegeteld — controleer in Moneybird.' }; ev.uitleg = ev.telt_niet.reden; }
  if (verkoop && geldVerkoopConcept(d)) {
    ev.telt_niet = { soort: 'concept', reden: 'Verkoopfactuur zonder factuurdatum of factuurnummer (concept, niet verstuurd): telt niet als verwachte ontvangst — controleer in Moneybird.' };
    ev.uitleg = ev.telt_niet.reden;
    w.push({ bron: 'verkoopfacturen', fout: 'verkoopfactuur zonder datum/nummer: controleer in Moneybird' + (ev.tegenpartij ? ' (' + ev.tegenpartij + ')' : ''), document_id: d.id, url: ev.bron_url });
  }
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
  if (!r.ok) { w.push({ onvolledig: true, bron: 'balans', fout: r.fout, status: r.status }); return { maandeinde, waarden: null }; }
  const treffers = {};
  const zoek = o => { if (Array.isArray(o)) o.forEach(zoek); else if (o && typeof o === 'object') {
    if (o.ledger_account_id && 'value' in o) (treffers[String(o.ledger_account_id)] = treffers[String(o.ledger_account_id)] || []).push(geldGetal(o.value));
    Object.values(o).forEach(v => { if (v && typeof v === 'object') zoek(v); }); } };
  zoek(r.data);
  // Alleen een eenduidige waarde gebruiken (dezelfde ledger als ouder én kind met andere bedragen → niet gokken).
  const waarden = {};
  for (const [id, vs] of Object.entries(treffers)) { if (vs.every(x => x === vs[0])) waarden[id] = vs[0]; else w.push({ onvolledig: true, bron: 'balans', fout: 'grootboek komt met verschillende bedragen in de balans voor — niet gebruikt', ledger: id }); }
  if (!(GELD.bank.ledger in waarden)) w.push({ onvolledig: true, bron: 'balans', fout: 'bankrekening niet (eenduidig) gevonden in de balans' });
  for (const p of potten) if (p.ledger && !(p.ledger in waarden)) w.push({ onvolledig: true, bron: 'balans', rekening: p.id, fout: 'grootboek van deze pot niet (eenduidig) gevonden in de balans' });
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
  const { vandaag, profiel, overrides, cfg } = ctx, sleutel = `${soort}:${d.id}`;
  let ov = overrides[sleutel];
  const due = basis.datum, ev = Object.assign({}, basis, { vervaldag: due });
  if (ov && ov.type === 'tegoed') { ctx.gebruikt.add(sleutel); ev.override = ov; ov = null; }   // geen datum-override: alleen de keuze dat het tegoed als ontvangst telt
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
    { const bb = geldBtwBetaling(m); if (bb) btw.push(Object.assign({ datum: m.date, bedrag: geldRond(bedrag) }, bb)); }
    if (pays.some(p => p.invoice_type === 'VatDocument')) continue;                // een btw-document-betaling blijft buiten de patronen (zoals altijd), maar telt niet meer als betaald
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
    if (!wd) { w.push({ onvolledig: true, bron: 'config', rekening: p.id, fout: `weekdag van de inleg in "${p.naam}" onbekend — stel hem in (nu niet ingepland)` }); continue; }
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
// Een btw-betaling aan een kwartaal koppelen, STRIKT (Codex G7): alleen een NEGATIEVE mutatie aan de Belastingdienst waarvan de hele omschrijving "Btw aangifte Kwartaal N JJJJ" is; het kwartaal komt uit de
// tekst, niet uit de betaaldatum. Geen betalingskenmerken, geen btw-document-koppeling en geen bedragen of vensters: dat liet een schuld wegvallen door een willekeurige mutatie.
// Al het andere blijft open + onvolledig tot de eigenaar het kwartaal als betaald markeert (btw.betaald_kwartalen). Een teruggaaf (positief) telt nooit.
function geldBtwBetaling(m) {
  if (!(geldGetal(m.amount) < 0)) return null;
  // De tekst telt ALLEEN als de hele omschrijving (message), verankerd; nooit de naam van de tegenpartij. Daarnaast moet de tegenpartij de Belastingdienst zijn.
  if (!/belastingdienst/i.test(String(m.contra_account_name || ''))) return null;
  const a = /^\s*btw\s+aangifte\s+kwartaal\s+([1-4])\s+(\d{4})\s*$/i.exec(String(m.message || ''));
  return a ? { soort: 'tekst', kw: `${a[2]}-K${a[1]}` } : null;
}
const GELD_BTW_KW = 'geld:btw:kwartalen';   // bedragen van afgesloten kwartalen (12 uur), tegen te veel Moneybird-verzoeken
async function geldBtwAangifte(get, vandaag, cfg, betalingen, w, env) {
  // Alle kwartalen van vorig jaar t/m het lopende die niet aantoonbaar betaald zijn (Codex G7): oudere onbetaalde kwartalen mogen niet ontbreken.
  // Een afgesloten kwartaal dat niet als betaald terug te vinden is, telt als open schuld met onvolledig:true ("betaling niet gevonden"), behalve als de
  // eigenaar het in de instellingen als betaald heeft gemarkeerd (btw.betaald_kwartalen).
  const nu = geldKwartaal(vandaag), uit = [], markeerd = new Set((cfg.btw && cfg.btw.betaald_kwartalen) || []), kws = [];
  for (let j = nu.j - 1; j <= nu.j; j++) for (let q = 1; q <= 4; q++) { const k = geldKwartaal(`${j}-${String(q * 3 - 2).padStart(2, '0')}-01`); if (k.van <= nu.van) kws.push([k, k.van === nu.van]); }
  const cache = (env && await kvJson(env, GELD_BTW_KW)) || {}; let cacheNieuw = false;
  const gebruikt = new Set(), bet = (betalingen || []).slice().sort((x, y) => x.datum.localeCompare(y.datum));
  const verval = k => new Date(Date.UTC(Number(k.tot.slice(0, 4)), Number(k.tot.slice(5, 7)) + 1, 0)).toISOString().slice(0, 10), naam = k => `${k.j}-K${k.q}`;
  // Hoort deze betaling bij dit kwartaal? Alleen de tekst bepaalt het kwartaal (en de betaling moet na het kwartaaleinde liggen). Een teruggaaf (positief) telt nooit.
  const hoort = (b, k) => b.soort === 'tekst' && b.kw === naam(k) && b.bedrag < 0 && b.datum > k.tot;
  // Het overzicht van het lopende en het vorige kwartaal altijd verversen; van de oudere hooguit twee per aanroep (nieuwste eerst), de rest komt uit de cache of bij een volgende aanroep.
  const magOphalen = new Set(); let nOud = 0;
  for (let i = kws.length - 1; i >= 0; i--) { const [k, loopt] = kws[i], c = cache[naam(k)]; if (loopt || i >= kws.length - 2) { magOphalen.add(naam(k)); continue; } if (markeerd.has(naam(k)) || (c && Date.now() - c.ts < 7 * 24 * 36e5)) continue; if (nOud++ < 2) magOphalen.add(naam(k)); }
  const vorigKw = kws.length > 1 ? naam(kws[kws.length - 2][0]) : null;   // het vorige kwartaal wordt nog geboekt: elk uur verversen, oudere 24 uur
  for (const [k, loopt] of kws) {
    const kw = naam(k), vervalt = verval(k), id = `btw:${kw}`;
    if (!loopt && markeerd.has(kw)) continue;
    let bedrag = null; const c = cache[kw];
    if (!loopt && c && typeof c.bedrag === 'number' && (Date.now() - c.ts < (kw === vorigKw ? 36e5 : 7 * 24 * 36e5) || !magOphalen.has(kw))) bedrag = c.bedrag;   // afgesloten kwartalen veranderen nauwelijks: 7 dagen
    else if (!loopt && !magOphalen.has(kw)) { w.push({ onvolledig: true, bron: 'btw', fout: `BTW-overzicht ${kw} nog niet opgehaald (wordt bij een volgende keer aangevuld) — aangifte niet ingepland` }); continue; }
    else {
      const r = await get(`reports/tax?period=${k.van.replace(/-/g, '')}..${k.tot.replace(/-/g, '')}`);
      if (r.ok && r.data && Array.isArray(r.data.tax_rates)) {
        const som = t => r.data.tax_rates.filter(x => x.type === t).reduce((a2, x) => a2 + geldGetal(x.tax), 0);
        bedrag = geldRond(som('sales_invoice') - som('purchase_invoice'));
        if (!loopt) { cache[kw] = { bedrag, ts: Date.now() }; cacheNieuw = true; }
      } else if (!loopt && c && typeof c.bedrag === 'number') bedrag = c.bedrag;   // een oude waarde is beter dan niets
      else { w.push({ onvolledig: true, bron: 'btw', fout: `BTW-overzicht ${kw} niet op te halen — aangifte niet ingepland`, status: r.status }); continue; }
    }
    if (bedrag === 0) continue;
    let deel = false, gevonden = true;
    let reden = null;                                                        // 'betaling niet gevonden' of 'deels betaald'
    if (!loopt) {                                                          // al betaald? alleen betalingen met de expliciete tekst voor precies dit kwartaal
      const kand = bet.filter(b => !gebruikt.has(b) && hoort(b, k)); kand.forEach(b => gebruikt.add(b));
      const betaald = geldRond(kand.reduce((a, b) => a + Math.abs(b.bedrag), 0));
      if (bedrag > 0) {
        if (betaald >= bedrag - 1) continue;                                // volledig betaald: de aangifte min € 1 (geen procentuele marge)
        if (betaald > 0) { w.push({ onvolledig: true, bron: 'btw-schuld', kwartaal: kw, fout: `BTW ${kw}: deels betaald (${geldRond(betaald)} van ${bedrag}) — het exacte restant staat open` }); bedrag = geldRond(bedrag - betaald); deel = true; reden = 'deels betaald'; }
        else gevonden = false;
      }
    }
    const apart = cfg.btw.modus === 'apart', datum = vervalt < vandaag ? vandaag : vervalt, rek = apart ? (cfg.btw.aangifte_van || 'lopend') : 'lopend';
    const marge = { min: geldRond(bedrag * 0.9), max: geldRond(bedrag * 1.1) };
    const ev = { id, bron: 'btw', richting: bedrag > 0 ? 'uit' : 'in', bedrag: Math.abs(bedrag), datum, datumtype: 'aangifte', zekerheid: 'schatting', rekening: rek, tegenpartij: 'Belastingdienst',
      document_id: null, bron_url: null, kwartaal: kw, marge,
      uitleg: `BTW-aangifte ${k.j} kwartaal ${k.q}: verkoop-btw min inkoop-btw uit Moneybird, schatting ±10%${deel ? ' — restant na een eerdere (deel)betaling' : ''}${loopt ? ' — het kwartaal loopt nog, dit is de stand tot nu toe en loopt nog op' : ''}${vervalt < vandaag ? ` — uiterste betaaldatum ${vervalt} is voorbij en er is geen betaling gezien` : ''}.` };
    if (vervalt < vandaag) ev.achterstallig = true;
    if (reden) { ev.onvolledig = true; ev.onvolledig_reden = reden; ev.uitleg += ' Deels betaald: het exacte restant staat open (markeer het kwartaal als betaald als dat klopt).'; }
    if (!loopt && !gevonden && vervalt < vandaag) { ev.onvolledig = true; ev.onvolledig_reden = 'betaling niet gevonden'; ev.uitleg += ' Betaling niet gevonden in de bankmutaties: behoudend als open schuld meegenomen.'; w.push({ onvolledig: true, bron: 'btw-schuld', kwartaal: kw, fout: `BTW ${kw}: betaling niet gevonden — als open schuld meegenomen (markeer het kwartaal als betaald in Instellingen als dat klopt)` }); }
    if (apart && !cfg.btw.aangifte_van) w.push({ bron: 'config', fout: 'BTW-instellingen: van welke rekening de aangifte betaald wordt is niet ingesteld — lopende rekening aangenomen' });
    if (!apart) ev.uitleg += ' Betaald van de lopende rekening; zonder terugboeking van de BTW-pot telt de pot niet mee in Besteedbaar.';
    uit.push(ev);
    const terug = apart ? cfg.btw.terugboeking_van : null;   // in_lopend: geen terugboeking (de BTW-pot hoort al bij lopend)
    if (bedrag > 0 && rek === 'lopend' && terug && terug !== 'lopend') uit.push(Object.assign({}, ev, { onvolledig: undefined, onvolledig_reden: undefined, id: id + ':terug', richting: 'in', rekening: 'lopend', intern: true, pot: terug, tegenpartij: '',
      uitleg: `Terugboeking van de BTW-pot op dezelfde dag als de aangifte (lopende rekening netto 0, de BTW-pot daalt).` }));
  }
  if (cacheNieuw && env) { try { await kvZet(env, GELD_BTW_KW, cache); } catch (e) { /* cache is een extraatje */ } }
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
    else if (bev.length > 1 || kand.length > 1) { meer.set(f.id, [...new Set(bev.concat(kand))]); w.push({ onvolledig: true, bron: 'prognose', fout: `factuur ${f.nummer || f.id} past bij meerdere prognoseprojecten — bevestig bij welk project hij hoort (tot dan telt de prognose-ontvangst van die projecten voor dit bedrag niet mee)` }); }
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
    // Een factuur die bij meerdere projecten past is zelf al een echte ontvangst; de prognose-termijnen van die kandidaat-projecten
    // tellen voor dat bedrag NIET mee (anders staat dezelfde ontvangst dubbel in de tijdlijn) tot de eigenaar de koppeling kiest.
    const onbesliste = geldRond(facturen.filter(f => f.bedrag > 0 && !toe.has(f.id) && (meer.get(f.id) || []).includes(sleutel)).reduce((a, f) => a + f.bedrag, 0));
    const ov = { sleutel, soort: 'project', naam: it.naam, code: it.code, aan: it.aan, totaal: it.totaal, gefactureerd, facturen: mijn.map(f => f.id), vragen, termijnen: [] };
    if (onbesliste > 0) ov.onbeslist = onbesliste;
    overzicht.push(ov);
    if (!it.aan) continue;
    const v = geldVerwachtVerkoop({ contact_id: it.contact_id, contact: { company_name: it.naam } }, profiel, cfg), vertraging = v.basis !== 'vervaldag' ? v.mediaan : 0;
    let rest = gefactureerd, onbRest = onbesliste, onbGebruikt = 0;
    for (const t of it.termijnen.slice().sort((a, b) => a.factuurdatum.localeCompare(b.factuurdatum) || a.id.localeCompare(b.id))) {
      const dekking = Math.min(t.bedrag, Math.max(0, rest)); rest = geldRond(rest - dekking);
      const overRuw = geldRond(t.bedrag - dekking);
      const onb = t.aan ? Math.min(overRuw, onbRest) : 0; onbRest = geldRond(onbRest - onb); onbGebruikt = geldRond(onbGebruikt + onb);
      const over = geldRond(overRuw - onb);
      ov.termijnen.push({ id: t.id, label: t.label, bedrag: t.bedrag, gefactureerd: geldRond(dekking), open: overRuw, factuurdatum: t.factuurdatum, aan: t.aan, onbeslist: onb > 0 ? geldRond(onb) : undefined });
      if (!t.aan || over <= 0.004) continue;
      const fd = t.factuurdatum < vandaag ? vandaag : t.factuurdatum;
      if (t.factuurdatum < vandaag) w.push({ bron: 'prognose', fout: `${it.naam || it.code}: ${t.label} had op ${t.factuurdatum} gefactureerd moeten worden en er is nog geen factuur gezien` });
      let ontvangst = geldDag(fd, it.betaaltermijn + vertraging); if (ontvangst < vandaag) ontvangst = vandaag;
      uit.push({ id: `prognose:${sleutel}:${t.id}`, bron: 'prognose', richting: 'in', bedrag: over, datum: ontvangst, factuurdatum: fd, ontvangst_na: geldDagenTussen(fd, ontvangst),
        datumtype: 'prognose', zekerheid: 'prognose', rekening: 'lopend', tegenpartij: `${it.naam || it.code} — ${t.label}`, document_id: null, bron_url: null, prognose: sleutel, termijn_id: t.id,
        uitleg: `Prognose (gaat zeker door, nog geen factuur): factureren op ${fd}, betaaltermijn ${it.betaaltermijn} dagen${vertraging ? ` + ${vertraging} dag(en) zoals ${v.basis === 'klant' ? 'deze klant' : v.basis === 'groep' ? 'de groep' : 'klanten'} meestal later betalen` : ''}.${dekking > 0 ? ` Al gefactureerd van deze termijn: ${dekking}.` : ''} Komt de echte factuur, dan vervangt die deze regel.` });
    }
    if (onbGebruikt > 0.004) w.push({ onvolledig: true, bron: 'prognose', fout: `${it.naam || it.code}: ${onbGebruikt} van de prognose-ontvangst telt nog niet mee, omdat een factuur bij meerdere prognoseprojecten past — bevestig bij welk project hij hoort` });
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
  const vandaag = geldVandaag(), w = [], budget = geldBudget(env);   // + GELD.kvReserve voor KV (cache, ijkpunten)
  if (ksFout.length) w.push({ onvolledig: true, bron: 'opslag', fout: 'een net opgeslagen wijziging kon niet direct gelezen worden — over een minuut opnieuw laden' });
  let van = url.searchParams.get('van') || geldDag(vandaag, -30), tot = url.searchParams.get('tot') || geldDag(vandaag, 90);
  if (!geldIsDatum(van) || !geldIsDatum(tot) || van > tot) return { status: 400, body: { error: 'ongeldige periode (van/tot = JJJJ-MM-DD, van ≤ tot)' } };
  if ((Date.parse(tot) - Date.parse(van)) / 864e5 > GELD.maxDagen) return { status: 400, body: { error: `periode te lang (max ${GELD.maxDagen} dagen)` } };
  const get = geldMb(env, budget);
  let cfg;
  try { cfg = await geldConfig(env); } catch (e) { cfg = geldConfigNorm(null); w.push({ onvolledig: true, bron: 'config', fout: 'instellingen niet te lezen (opslag)' }); }
  const potten = cfg.potten.filter(p => !p.virtueel);   // inactief = alleen niet meer herkennen; het saldo telt wel mee. Virtueel = geen eigen rekening.
  if (!potten.length) w.push({ bron: 'config', fout: 'nog geen spaarpotten ingesteld — overboekingen naar spaar worden niet herkend' });
  let ijk = [];
  try { ijk = await geldIjkpunten(env, 1, geldRekeningen(cfg)); if (ijk.onvolledig) w.push({ onvolledig: true, bron: 'ijkpunt', fout: 'niet alle ijkpunten gelezen (te veel) — oudere stand mogelijk' }); }
  catch (e) { w.push({ onvolledig: true, bron: 'ijkpunt', fout: 'ijkpunten niet te lezen (opslag) — Moneybird-stand gebruikt' }); }
  for (const [k, x] of Object.entries(ksWaarde)) if (k.startsWith('ijkpunt:') && x && x.id && !ijk.some(i => i.id === x.id)) ijk.push(x);   // net ingevuld
  ijk.sort((a, b) => (b.ts - a.ts) || String(b.id).localeCompare(String(a.id)));
  const laatsteIjk = {};
  for (const i of ijk) if (!laatsteIjk[i.rekening]) laatsteIjk[i.rekening] = i;
  let profiel = null, overrides = { items: {}, compleet: false }, prognose = { items: {}, compleet: false }, profielRuw = null;
  try { profiel = profielRuw = await kvJson(env, 'geld:profiel'); overrides = await geldOverrides(env); prognose = await geldKvLijst(env, GELD_PROG); }
  catch (e) { w.push({ onvolledig: true, bron: 'overrides', fout: 'eigen betaaldata/afbetalingen niet te lezen (opslag) — facturen volgens het beleid ingepland' }); }
  for (const [k, x] of Object.entries(ksWaarde)) {
    if (k.startsWith('ov:')) { if (x && x.type) overrides.items[k.slice(3)] = x; else delete overrides.items[k.slice(3)]; }
    else if (k.startsWith('prognose:')) { if (x) prognose.items[k.slice(9)] = x; else delete prognose.items[k.slice(9)]; }
  }
  if (!overrides.compleet && !w.some(x => x.bron === 'overrides')) w.push({ onvolledig: true, bron: 'overrides', fout: 'niet alle eigen betaaldata/afbetalingen gelezen' });
  const profielDagen = profiel ? geldDagenTussen(String(profiel.vandaag || '2000-01-01'), vandaag) : null;
  if (!profiel) w.push({ onvolledig: true, bron: 'profiel', fout: 'betaalprofiel nog niet berekend — klantbetalingen op de vervaldag, incasso\'s niet herkend (GET /geld/profiel?vers=1)' });
  else if (profiel.onvolledig || !(profielDagen <= GELD_PROFIEL_MAX)) {
    w.push({ onvolledig: true, bron: 'profiel', fout: (profiel.onvolledig ? 'betaalprofiel onvolledig' : `betaalprofiel ouder dan ${GELD_PROFIEL_MAX} dagen`) + ' — niet gebruikt: klantbetalingen op de vervaldag, incasso\'s niet herkend; vernieuwen' });
    profiel = null;
  } else if (profielDagen > GELD_PROFIEL_DAGEN) w.push({ bron: 'profiel', fout: `betaalprofiel ouder dan ${GELD_PROFIEL_DAGEN} dagen — vernieuwen` });
  let patronen = null, keuzes = { items: {}, compleet: false };
  try { patronen = await kvJson(env, 'geld:patronen'); keuzes = await geldKvLijst(env, GELD_PK); }
  catch (e) { w.push({ onvolledig: true, bron: 'patronen', fout: 'vaste patronen niet te lezen (opslag) — niet ingepland' }); }
  const patDagen = patronen ? geldDagenTussen(String(patronen.vandaag || '2000-01-01'), vandaag) : null;
  if (!patronen) w.push({ onvolledig: true, bron: 'patronen', fout: 'vaste patronen (loon, hypotheek, privé, abonnementen) nog niet berekend — niet ingepland (GET /geld/patronen?vers=1)' });
  else if (patronen.onvolledig || !(patDagen <= GELD_PROFIEL_MAX)) { w.push({ onvolledig: true, bron: 'patronen', fout: (patronen.onvolledig ? 'vaste patronen onvolledig' : `vaste patronen ouder dan ${GELD_PROFIEL_MAX} dagen`) + ' — niet gebruikt; vernieuwen' }); patronen = null; }
  else if (patDagen > GELD_PROFIEL_DAGEN) w.push({ bron: 'patronen', fout: `vaste patronen ouder dan ${GELD_PROFIEL_DAGEN} dagen — vernieuwen` });
  for (const [k, x] of Object.entries(ksWaarde)) if (k.startsWith('pk:')) { if (x) keuzes.items[k.slice(3)] = x; else delete keuzes.items[k.slice(3)]; }
  if (!keuzes.compleet && patronen) w.push({ onvolledig: true, bron: 'patronen', fout: 'niet alle aan/uit-keuzes van patronen gelezen' });
  const balans = await geldBalans(get, vandaag, w, potten);
  // Mutaties nodig vanaf: de dag na het maandeinde (MB-stand), de dag na het oudste ijkpunt, en het begin van de tijdlijn.
  const vanaf = [geldDag(balans.maandeinde, 1), van, ...Object.values(laatsteIjk).map(i => geldDag(i.datum, 1))].filter(d => geldIsDatum(d) && d <= vandaag).sort()[0] || vandaag;
  const ondergrens = geldDag(vandaag, -GELD.maxDagen);
  if (vanaf < ondergrens) w.push({ onvolledig: true, bron: 'ijkpunt', fout: `ijkpunt ouder dan ${GELD.maxDagen} dagen — niet meegenomen, opnieuw ijken` });
  const mutVan = vanaf < ondergrens ? ondergrens : vanaf;
  const [muts, fact] = await Promise.all([geldMutaties(get, mutVan, vandaag, w), geldFacturen(get, vandaag, w)]);
  if (budget.rest <= 0) w.push({ onvolledig: true, bron: 'algemeen', fout: 'te veel Moneybird-verzoeken nodig — gegevens mogelijk onvolledig' });
  const bankEv = muts.lijst.map(m => geldBankEvent(m, potten)).sort((a, b) => a.datum.localeCompare(b.datum) || a.id.localeCompare(b.id));
  for (const e of bankEv) { e.delta = e.bedrag; if (e.intern && e.pot) e.pot_delta = -e.delta; }
  const gemengd = bankEv.filter(e => e.intern_onzeker);
  if (gemengd.length) w.push({ onvolledig: true, bron: 'bankmutaties', fout: `${gemengd.length} mutatie(s) niet eenduidig aan één spaarpot toe te wijzen — pot- en totaalsaldo onzeker`, ids: gemengd.slice(0, 10).map(e => e.id) });
  // Mutaties die er uitzien als een overboeking tussen lopend en een pot maar bij geen (actieve) pot horen: de lopende rekening klopt (alles staat erin),
  // maar de pot niet. Nooit stil: onvolledig, de IBAN's erbij (om de tegenrekening van de pot in te stellen), en de potten zelf worden onzeker.
  const vermoed = bankEv.filter(e => e.intern_vermoed && !e.intern && !e.intern_onzeker);
  if (vermoed.length) {
    const ibans = [...new Set(vermoed.map(e => e.iban).filter(Boolean))].slice(0, 5), namen = [...new Set(vermoed.map(e => e.tegenpartij).filter(Boolean))].slice(0, 5), netto = geldRond(vermoed.reduce((a, e) => a + e.bedrag, 0));
    w.push({ onvolledig: true, bron: 'bankmutaties', fout: `${vermoed.length} mutatie(s) lijken een overboeking tussen lopend en een spaarpot (netto ${String(netto.toFixed(2)).replace('.', ',')}) maar horen bij geen ingestelde pot${ibans.length ? ' (tegenrekening ' + ibans.join(', ') + ')' : ''}${namen.length ? ' (naam ' + namen.map(n => '"' + n + '"').join(', ') + ')' : ''}: de potstand en "Nu" kunnen daardoor afwijken — stel de tegenrekening of de letter van de pot in`, ids: vermoed.slice(0, 10).map(e => e.id), ibans, namen, netto });
  }
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
      w.push({ onvolledig: s.mb_stand == null, bron: 'saldo', rekening: rek, fout: s.mb_stand != null ? 'nog niet geijkt — Moneybird-stand gebruikt' : 'nog niet geijkt en geen Moneybird-stand — saldo onbekend' });
    }
    // Wat er sinds de basis van het saldo (ijkpunt, anders het maandeinde) echt tussen lopend en deze pot is overgeboekt: inleg (lopend → pot) en opname (pot → lopend).
    if (rek !== 'lopend') {
      const basisD = s.bron === 'ijkpunt' ? i.datum : balans.maandeinde, bw = bankEv.filter(e => e.pot === rek && e.datum > basisD);
      const inl = bw.filter(e => e.bedrag < 0), opn = bw.filter(e => e.bedrag > 0);
      s.beweging = { sinds: basisD, start: s.bron === 'ijkpunt' ? i.bedrag : (balans.waarden && pot && pot.ledger && pot.ledger in balans.waarden ? geldRond(balans.waarden[pot.ledger]) : null),
        inleg: geldRond(-inl.reduce((a, e) => a + e.bedrag, 0)), n_inleg: inl.length, opname: geldRond(opn.reduce((a, e) => a + e.bedrag, 0)), n_opname: opn.length,
        mutaties: bw.slice(-30).reverse().map(e => ({ id: e.id, datum: e.datum, bedrag: e.bedrag, pot_bedrag: geldRond(-e.bedrag), tegenpartij: e.tegenpartij || '', bron_url: e.bron_url })) };
    }
    if (muts.onvolledig) { s.onzeker = true; s.onzeker_reden = 'bankmutaties onvolledig opgehaald — saldo kan afwijken'; }
    else if (rek !== 'lopend') {
      // Een niet-eenduidige mutatie die deze pot kan raken (ná de basis van het saldo) → saldo onbekend, niet gokken.
      const basis = s.bron === 'ijkpunt' ? i.datum : balans.maandeinde;
      const raak = gemengd.filter(e => (e.pot_kandidaten || []).includes(rek) && e.datum > basis);
      if (raak.length) { s.onzeker = true; s.onzeker_reden = `${raak.length} niet eenduidige mutatie(s) — bevestig de pot (tegenrekening instellen) of boek ze`; s.gerapporteerd = null; }
      else {
        const vm = vermoed.filter(e => e.datum > basis);
        if (vm.length) { s.onzeker = true; s.onzeker_reden = `${vm.length} mutatie(s) lijken een overboeking van of naar een spaarpot maar horen bij geen pot (netto ${String(geldRond(vm.reduce((a, e) => a + e.bedrag, 0)).toFixed(2)).replace('.', ',')}) — de potstand kan afwijken: stel de tegenrekening van de pot in`; }
      }
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
    uitleg: 'Lopend + spaarpotten; inleg en opname tussen lopend en potten heffen elkaar op.', onzeker: (muts.onvolledig || gemengd.length > 0 || vermoed.length > 0) || undefined };
  // ── events: verleden (bank, binnen de tijdlijn) + toekomst/open (facturen) + ijkpunten
  const events = bankEv.filter(e => e.datum >= van && e.datum <= tot);
  const plan = { vandaag, profiel, overrides: overrides.items || {}, cfg, gebruikt: new Set() };
  const inkoopPar = fact.inkoop.map(d => [d, geldFactuurEvent('inkoop', d, vandaag, w)]), verkoopPar = fact.verkoop.map(d => [d, geldFactuurEvent('verkoop', d, vandaag, w)]);
  const verrekend = geldCreditVerrekening(inkoopPar, w);
  const factEv = [...inkoopPar, ...verkoopPar].filter(([, e]) => e.bedrag !== 0).flatMap(([d, e]) => geldPlan(e.bron, d, e, plan));
  // Overrides voor facturen die niet (meer) open zijn: melden zodat ze opgeruimd kunnen worden (niet stil laten liggen).
  const vervallenOv = Object.keys(plan.overrides).filter(id => !plan.gebruikt.has(id));
  const metDelta = e => { if (!e.saldo_ijkpunt) { e.delta = geldRond((e.richting === 'in' ? 1 : -1) * Math.abs(e.bedrag)); if (e.intern && e.pot) e.pot_delta = -e.delta; } return e; };
  factEv.forEach(metDelta);
  // Wat niet als geldstroom telt (concept-verkoopfactuur, tegoed bij een leverancier) blijft zichtbaar maar beweegt de lijn niet (delta 0).
  for (const e of factEv) {
    if (e.verrekend_tekst) { e.uitleg += e.verrekend_tekst; delete e.verrekend_tekst; }
    if (e.tegoed) {
      if (e.override && e.override.type === 'tegoed' && !e.tegoed_onbekend) { e.tegoed_telt = true; e.uitleg += ' Op jouw keuze als ontvangst meegeteld.'; }
      else e.telt_niet = { soort: 'tegoed', reden: e.uitleg };
    }
    if (e.telt_niet) { e.delta = 0; if (e.pot_delta != null) e.pot_delta = 0; }
  }
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
  for (const [, x] of pctx.mogelijkDubbel || []) w.push({ onvolledig: true, bron: 'patronen', fout: `mogelijk dubbel: vast patroon "${x.patroon}" lijkt op een afbetaling van factuur ${x.factuur} — beide staan ingepland, dus de uitgave kan dubbel meetellen tot je het patroon uitzet (als het dezelfde betaling is)` });
  const inlegEv = geldInlegEvents(cfg, patronen, pctx, w).map(metDelta);
  const btwBet = new Map();
  for (const b of (patronen && patronen.btw_betalingen) || []) btwBet.set(b.datum + '|' + b.bedrag, b);
  for (const m of muts.lijst) { const bb = geldBtwBetaling(m); if (bb) btwBet.set(m.date + '|' + geldRond(geldGetal(m.amount)), Object.assign({ datum: m.date, bedrag: geldRond(geldGetal(m.amount)) }, bb)); }
  // ── G5: prognose (projecten die zeker doorgaan, handmatige posten); echte facturen gaan voor
  let progEv = [], progOverzicht = [];
  const progItems = prognose.items || {};
  if (Object.keys(progItems).length) {
    if (!prognose.compleet) w.push({ onvolledig: true, bron: 'prognose', fout: 'niet alle prognose-posten gelezen' });
    const fk = new Map();
    for (const f of (profielRuw && profielRuw.facturen) || []) fk.set(f.id, f);
    if (Object.values(progItems).some(it => it.soort === 'project')) {
      if (!profielRuw) w.push({ onvolledig: true, bron: 'prognose', fout: 'betaalprofiel ontbreekt: facturen ouder dan 60 dagen niet te zien — een al gefactureerde termijn kan dubbel staan' });
      const rec = await geldLijst(get, `sales_invoices?filter=period:${geldDag(vandaag, -60).replace(/-/g, '')}..${vandaag.replace(/-/g, '')},state:paid`, w, 'recent betaalde verkoopfacturen');
      for (const x of rec.lijst) fk.set(String(x.id), geldFactuurKort(x));
      if (rec.onvolledig) w.push({ onvolledig: true, bron: 'prognose', fout: 'recent betaalde facturen onvolledig — een al gefactureerde termijn kan dubbel staan' });
    }
    for (const x of fact.verkoop) if (!geldVerkoopConcept(x)) fk.set(String(x.id), geldFactuurKort(x));   // een concept zonder nummer is geen echte factuur: de prognoseterm mag er niet door verdwijnen
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
  const btwEv = bankdagen((await geldBtwAangifte(get, vandaag, cfg, [...btwBet.values()], w, env)).map(metDelta));
  // Terugboeking uit de BTW-pot: hooguit wat er (verwacht) in de pot zit op die dag; onbekend potsaldo → niet terugboeken.
  for (const t of btwEv.filter(e => e.id.endsWith(':terug')).sort((a, b) => a.datum.localeCompare(b.datum))) {
    const aangifte = btwEv.find(e => e.id === t.id.replace(/:terug$/, '')), ps = saldo.potten[t.pot];
    let pot = ps && ps.gerapporteerd != null ? ps.gerapporteerd : null;
    if (pot != null) for (const e of gepland.concat(btwEv)) { if (e === t || !e.datum || e.datum > t.datum || typeof e.delta !== 'number') continue; if (e.intern && e.pot === t.pot && (e.id.endsWith(':terug') ? btwEv.indexOf(e) < btwEv.indexOf(t) : true)) pot -= e.delta; else if (e.rekening === t.pot) pot += e.delta; }
    if (pot == null || pot <= 0) {
      btwEv.splice(btwEv.indexOf(t), 1); aangifte.gedekt = false;
      w.push({ onvolledig: pot == null, bron: 'btw', rekening: t.pot, fout: pot == null ? `saldo BTW-pot onbekend — terugboeking voor ${aangifte.kwartaal} niet meegenomen (ijk de pot)` : `BTW-pot verwacht leeg op ${t.datum} — aangifte ${aangifte.kwartaal} niet gedekt` });
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
    if (!a.gedekt) w.push({ onvolledig: pot == null, bron: 'btw', rekening: a.rekening, fout: pot == null ? `saldo van "${a.rekening}" onbekend — dekking BTW-aangifte ${a.kwartaal} niet te controleren` : `"${a.rekening}" dekt de BTW-aangifte ${a.kwartaal} niet: tekort ${geldRond(-(pot + a.delta))}` });
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
    saldo, events, waarschuwingen: w, verzoeken: GELD.budget - budget.rest, verrekend,
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
// Audit van de ▲-posten (ontvangsten) in de tijdlijn: welke regel classificeert ze, en wat is verdacht (ook leverancier, geen datum/nummer, negatieve inkoop).
function geldOntvangstAudit(body) {
  const ev = body.events || [], inkoopContacten = new Set(ev.filter(e => e.bron === 'inkoop' && e.contact_id).map(e => e.contact_id)), inkoopNamen = new Set(ev.filter(e => e.bron === 'inkoop' && e.tegenpartij).map(e => e.tegenpartij.toLowerCase()));
  const regel = e => e.bron === 'verkoop' ? (e.telt_niet ? 'verkoopfactuur zonder datum/nummer: telt niet' : 'open verkoopfactuur (open ≥ 0) = ontvangst op de verwachte betaaldatum')
    : e.bron === 'inkoop' ? (e.creditnota ? (e.tegoed ? (e.tegoed_telt ? 'inkoop-creditnota (tegoed) op jouw keuze als ontvangst' : 'inkoop-creditnota zonder (genoeg) open facturen: tegoed, telt niet') : 'inkoop-creditnota (open < 0) = ontvangst') : 'inkoopfactuur (uitgave)')
    : e.bron === 'prognose' ? 'prognose (project/handmatige post)' : e.bron === 'patroon' ? 'vast patroon (richting in)' : e.id && String(e.id).endsWith(':terug') ? 'btw-terugboeking uit de pot' : e.bron;
  const items = ev.filter(e => e.bron !== 'bank' && e.bron !== 'ijkpunt' && (e.richting === 'in' || e.delta > 0)).map(e => ({
    id: e.id, bron: e.bron, regel: regel(e), tegenpartij: e.tegenpartij || '', contact_id: e.contact_id || null, bedrag: e.bedrag, delta: e.delta, datum: e.datum, zekerheid: e.zekerheid, datumtype: e.datumtype,
    factuurdatum: e.factuurdatum || null, referentie: e.referentie || null, status: e.status || null, url: e.bron_url || null, telt_niet: e.telt_niet || null,
    flags: [ e.bron === 'verkoop' && ((e.contact_id && inkoopContacten.has(e.contact_id)) || (e.tegenpartij && inkoopNamen.has(e.tegenpartij.toLowerCase()))) ? 'contact_ook_leverancier' : null,
      e.bron === 'verkoop' && (!e.factuurdatum || !e.factuurnummer) ? 'zonder_datum_of_nummer' : null, e.bron === 'inkoop' && e.bedrag < 0 ? 'negatieve_inkoop' : null, e.telt_niet ? 'telt_niet' : null ].filter(Boolean) }));
  return { as_of: body.as_of, vandaag: body.vandaag, aantal: items.length, per_bron: items.reduce((a, x) => (a[x.bron] = (a[x.bron] || 0) + 1, a), {}), verdacht: items.filter(x => x.flags.length).length, verrekend: body.verrekend || [], items };
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
  if (!r.ok || !Array.isArray(r.data)) { w.push({ onvolledig: true, bron: 'grootboeken', fout: r.fout || 'onverwacht antwoord', status: r.status }); return c && c.lijst ? c.lijst : null; }
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
  if (!pl.ok || !pl.data || !bal.ok || muts.onvolledig || (ink && ink.onvolledig) || (bon && bon.onvolledig)) { w.push({ onvolledig: true, bron: 'cijfers ' + ym, fout: (!pl.ok && pl.fout) || (!bal.ok && bal.fout) || (w2[0] && w2[0].fout) || 'onvolledig', status: pl.status || bal.status }); return null; }
  const omzet = {}, kosten = {};
  const tel = (o, k, x) => { const id = geldId(k); if (id) o[id] = geldRond((o[id] || 0) + x); };
  for (const a of ((pl.data.revenue_by_ledger_account || {}).ledger_accounts || [])) tel(omzet, a.ledger_account_id, geldGetal(a.value));
  for (const s of ['direct_costs_by_ledger_account', 'expenses_by_ledger_account']) for (const a of ((pl.data[s] || {}).ledger_accounts || [])) tel(kosten, a.ledger_account_id, geldGetal(a.value));
  for (const a of ((pl.data.other_income_expenses_by_ledger_account || {}).ledger_accounts || [])) tel(kosten, a.ledger_account_id, -geldGetal(a.value));   // bate = negatieve kosten
  const fact = metFact ? geldFactRegels(ink, bon, ledgers) : undefined;
  if (fact && fact.length > GELD_CIJ_MAX_FACT) { w.push({ onvolledig: true, bron: 'cijfers ' + ym, fout: `meer dan ${GELD_CIJ_MAX_FACT} facturen/bonnen met balansregels — maand niet opgeslagen` }); return null; }   // niet stil afkappen
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
  const w = [], budget = geldBudget(env), get = geldMb(env, budget), cfg = await geldConfig(env), cc = cfg.cijfers || geldCijferCfgNorm(null);
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
  // Koersmeter A2: de ochtendmeldingen (geschreven door de cron, zie koersCron) lezen en per gebruiker als gelezen afvinken.
  // Alleen met recht `geld` (die controle staat hierboven); afvinken mag ook wie alleen mag lezen (het is een eigen markering).
  if (p === '/geld/koers/meldingen' && m === 'GET') {
    const n = Math.max(1, Math.min(30, Number(url.searchParams.get('dagen')) || 7)), vandaag = geldVandaag();
    const dagen = Array.from({ length: n }, (_, i) => geldDag(vandaag, -i)), van = dagen[dagen.length - 1];
    // Maandagberichten: één list (hooguit een stuk of dertien sleutels in 90 dagen) en dan alleen de berichten binnen het venster lezen (hooguit 5), zodat dit verzoek ruim onder het subrequest-plafond blijft.
    let weekDagen = []; try { weekDagen = (await geldKvNamen(env, KOERS_WEEK, 1)).keys.map(k => String(k.name).slice(KOERS_WEEK.length)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= van && d <= vandaag).sort().slice(-5); } catch {}
    const recs = await Promise.all([...dagen.map(d => kvJson(env, KOERS_MELDING + d)), ...weekDagen.map(d => kvJson(env, KOERS_WEEK + d))]);
    const gel = (await kvJson(env, KOERS_GELEZEN + ik.oid)) || {};
    const lijst = recs.filter(Boolean).map(x => Object.assign({}, x, { gelezen: !!(gel.datum && x.datum <= gel.datum) })).sort((a, b) => b.datum.localeCompare(a.datum) || (a.soort === 'week' ? -1 : 1));
    return json({ meldingen: lijst, ongelezen: lijst.filter(x => !x.gelezen).length });
  }
  // Koersmeter: status van de ochtendrun per dag (bezig / klaar / mislukt, pogingen, laatste fout) uit de dagclaim (Durable Object MT_KOERSDAG).
  if (p === '/geld/koers/cron' && m === 'GET') {
    const n = Math.max(1, Math.min(14, Number(url.searchParams.get('dagen')) || 7)), ns = env.MT_KOERSDAG;
    if (!ns || !ns.idFromName) return json({ error: 'geen-dagclaim', uitleg: 'Durable Object-binding MT_KOERSDAG ontbreekt (zie wrangler.toml)' }, 503);
    let r; try { r = await ns.get(ns.idFromName('koers')).fetch('https://mt-koersdag/lees', { method: 'POST', body: JSON.stringify({ dagen: n }) }); } catch { return json({ error: 'opslag' }, 503); }
    const uit = await r.json().catch(() => ({}));
    return r.ok ? json({ dagen: Array.isArray(uit.dagen) ? uit.dagen : [] }) : json({ error: 'opslag' }, 503);
  }
  if (p === '/geld/koers/gelezen' && m === 'POST') {
    if (!env.MT_ROLLEN) return json({ error: 'geen-opslag' }, 503);
    let b = null; try { b = await request.json(); } catch {}
    if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ error: 'gelezen: object verwacht' }, 400);
    const vreemd = Object.keys(b).find(k => k !== 'datum'); if (vreemd !== undefined) return json({ error: `onbekend veld "${String(vreemd).slice(0, 40)}"` }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.datum || '')) || b.datum > geldVandaag()) return json({ error: 'datum: JJJJ-MM-DD, niet in de toekomst' }, 400);
    const oud = (await kvJson(env, KOERS_GELEZEN + ik.oid)) || {}, datum = oud.datum && oud.datum > b.datum ? oud.datum : b.datum;   // alleen vooruit: een oudere afvinking maakt niets ongedaan
    await kvZet(env, KOERS_GELEZEN + ik.oid, { datum, ts: Date.now() }, { expirationTtl: 400 * 86400 });
    return json({ ok: true, datum });
  }
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
  if (p === '/geld/audit/ontvangsten' && m === 'GET') {          // alleen lezen: alle ▲-posten van de tijdlijn met bron, contact en de regel die ze als ontvangst classificeert
    if (R.geld !== 'wijzigen') return json({ error: 'geen-toegang', reden: 'geld-wijzigen' }, 403);
    const r = await geldTijdlijn(env, url, { ks: [] });
    return json(r.status === 200 ? geldOntvangstAudit(r.body) : r.body, r.status);
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
    } else if (type === 'tegoed') {
      if (soort !== 'inkoop') return json({ error: "type 'tegoed' kan alleen bij een inkoopfactuur (creditnota van een leverancier)" }, 400);
      item = { soort, type };
    } else return json({ error: "type: 'datum', 'afbetaling', 'tegoed' of 'wissen'" }, 400);
    const ts = Date.now(), door = String((ik.rec && ik.rec.naam) || ik.email || ik.oid).slice(0, 60);
    if (item) Object.assign(item, { reden: String(b.reden || '').slice(0, 120), door, ts });
    await kvZet(env, `geld:ov-historie:${String(9e15 - ts).padStart(16, '0')}:${randHex(4)}`, { sleutel: `${soort}:${id}`, vorige, nieuw: item, door, ts });   // elke wijziging bewaard
    if (item) await kvZet(env, sleutel, item, { metadata: item }); else await env.MT_ROLLEN.delete(sleutel);
    ctx.ks = sleutel.slice(5);
    await geldZetVersie(env, `${ts}-o${randHex(3)}`, ctx);
    await audit(env, { door: ik.oid, doorNaam: (ik.rec && ik.rec.naam) || ik.email || '', actie: 'geld-override', doel: `${soort}:${id}`, doelNaam: `${soort}factuur: ${type}` });   // geen bedragen
    return json({ ok: true, override: item });
  }
  // Koersmeter C: één dagfoto per dag (de laatste van die dag telt): kleur + getallen per meter + de onvolledige bronnen.
  // Alleen kleuren/getallen, geen namen of vrije tekst behalve korte bronteksten. Datum = vandaag volgens de server.
  if (p === '/geld/koers/dagfoto' && m === 'POST') {
    if (!env.MT_ROLLEN) return json({ error: 'geen-opslag' }, 503);
    let b = null; try { b = await request.json(); } catch {}
    const f = geldDagfotoFout(b); if (f) return json({ error: 'dagfoto: ' + f }, 400);
    const datum = geldVandaag(), rec = { datum, jaar: b.jaar, kleur: b.kleur, meters: b.meters.map(x => ({ id: x.id, kleur: x.kleur, getal: x.getal == null ? null : x.getal })), bronnen: (b.bronnen || []).map(x => String(x).slice(0, 160)), ts: Date.now() };
    await kvZet(env, GELD_DAGFOTO + datum, rec, { expirationTtl: 400 * 86400 });
    return json({ ok: true, datum });
  }
  if (p === '/geld/koers/dagfotos' && m === 'GET') {
    const n = Math.max(1, Math.min(60, Number(url.searchParams.get('dagen')) || 14)), vandaag = geldVandaag();
    const dagen = Array.from({ length: n }, (_, i) => geldDag(vandaag, -i));
    const recs = await Promise.all(dagen.map(d => kvJson(env, GELD_DAGFOTO + d)));
    return json({ dagfotos: recs.filter(Boolean) });
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
    if ('fictieve_buffer' in b || 'buffer_lopend' in b) {   // één waarde, in beide velden (dual-write); buffer_lopend is het oude veld
      const geldig = x => x === null || (typeof x === 'number' && isFinite(x) && x >= 0 && x <= 1e9);
      if ('fictieve_buffer' in b && !geldig(b.fictieve_buffer)) return json({ error: 'fictieve_buffer: getal ≥ 0 of null' }, 400);
      if ('buffer_lopend' in b && !geldig(b.buffer_lopend)) return json({ error: 'buffer_lopend: getal ≥ 0 of null (negatieve waarden worden niet meer geaccepteerd)' }, 400);
      if ('fictieve_buffer' in b && 'buffer_lopend' in b && b.fictieve_buffer !== b.buffer_lopend) return json({ error: 'fictieve_buffer en buffer_lopend zijn dezelfde instelling en moeten gelijk zijn' }, 400);
      const v = 'fictieve_buffer' in b ? b.fictieve_buffer : b.buffer_lopend;
      nieuw.fictieve_buffer = v; nieuw.buffer_lopend = v; gewijzigd.push('fictieve_buffer');
    }
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
    if ('schulden' in b) {
      if (!Array.isArray(b.schulden) || b.schulden.length > GELD_SCHULD_MAX) return json({ error: `schulden: lijst (max ${GELD_SCHULD_MAX})` }, 400);
      const ids = new Set();
      for (const x of b.schulden) {
        const f = geldSchuldFout(x); if (f) return json({ error: 'schulden: ' + f, lening: x && GELD_POT_ID.test(String(x.id || '')) ? x.id : null }, 400);
        if (ids.has(x.id)) return json({ error: 'schulden: dubbele id', lening: x.id }, 400); ids.add(x.id);
      }
      nieuw.schulden = b.schulden.map(geldSchuldNorm); gewijzigd.push('schulden');
    }
    if ('btw' in b) {
      const t = b.btw || {};
      if (t.spaarpercentage != null && !(typeof t.spaarpercentage === 'number' && t.spaarpercentage >= 0 && t.spaarpercentage <= 1)) return json({ error: 'btw.spaarpercentage: fractie tussen 0 en 1' }, 400);
      if (t.modus != null && !['in_lopend', 'apart'].includes(t.modus)) return json({ error: "btw.modus: 'in_lopend' of 'apart'" }, 400);
      if (t.betaald_kwartalen != null && !(Array.isArray(t.betaald_kwartalen) && t.betaald_kwartalen.length <= 12 && t.betaald_kwartalen.every(x => /^\d{4}-K[1-4]$/.test(String(x))))) return json({ error: 'btw.betaald_kwartalen: lijst (max 12) met kwartalen als JJJJ-K1..K4' }, 400);
      nieuw.btw = Object.assign({}, oud.btw, t); gewijzigd.push('btw');
    }
    if (!gewijzigd.length) return json({ error: 'niets te wijzigen' }, 400);
    const ts = Date.now(), norm = geldConfigNorm(Object.assign(nieuw, { gewijzigd: new Date(ts).toISOString(), door: (ik.rec && ik.rec.naam) || ik.email || ik.oid, revisie: oud.revisie + 1 }));
    if ('btw' in b) for (const k of ['spaarpot', 'aangifte_van', 'terugboeking_van']) if (b.btw && b.btw[k] != null && norm.btw[k] !== b.btw[k]) return json({ error: `btw.${k}: onbekende rekening/pot` }, 400);
    await kvZet(env, `geld:config:historie:${String(9e15 - ts).padStart(16, '0')}:${randHex(4)}`, oud);   // vorige stand bewaard
    // G7: wijzigt een streefbedrag (of de keuze eigen bedrag ↔ advies), leg datum en naam vast
    { const vb = geldStreefBedragen(oud), nb = geldStreefBedragen(norm);
      for (const k of Object.keys(nb)) if (JSON.stringify(vb[k]) !== JSON.stringify(nb[k])) norm.streef_herkomst[k] = { bron: norm.streef_herkomst[k].bron, datum: geldVandaag(), door: norm.door || null }; }
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
  if (p === '/beheer/ai' && m === 'GET') {                           // F6: AI-gebruik per gebruiker en dag + logboek (zonder inhoud) + de geldende limieten
    const u = new URL(request.url), dagen = Math.max(1, Math.min(31, parseInt(u.searchParams.get('dagen') || '7', 10) || 7));
    let o = null; try { o = await aiDO(env, 'ai-overzicht', { dag: geldVandaag(), nu: Date.now(), dagen, log: 50 }); } catch {}
    if (!o || o.status !== 200) return json({ error: 'geen-teller', modus: aiModus(env), limieten: await aiLimieten(env) }, 503);
    // Het logboek bewaart alleen een gebruiker-hash en de rol; namen komen hier, alleen voor de eigenaar, uit de gebruikerslijst (MT_ROLLEN).
    const namen = {};
    if (ik.rol === 'eigenaar') {
      try { for (const g of await lijstKV(env, 'user:')) if (g && g.oid) namen[await oidHash(g.oid)] = String(g.naam || g.email || '').slice(0, 60); } catch {}
      for (const oid of ownerOids(env)) { const hh = await oidHash(oid); if (!namen[hh]) namen[hh] = '(vaste eigenaar)'; }
    }
    const metNaam = x => (ik.rol === 'eigenaar' && namen[x.oid] ? Object.assign({}, x, { naam: namen[x.oid] }) : x);
    return json(Object.assign({ modus: aiModus(env), limieten: await aiLimieten(env), vandaag: geldVandaag(), dagen }, o.j, { gebruikers: (o.j.gebruikers || []).map(metNaam), recent: (o.j.recent || []).map(metNaam), namen_zichtbaar: ik.rol === 'eigenaar' }));
  }
  if (p === '/beheer/ai-limieten' && m === 'POST') {                  // alleen de eigenaar; ongeldige of onbekende velden → 400, niets bewaard
    if (ik.rol !== 'eigenaar') return json({ error: 'alleen-eigenaar' }, 403);
    const b = await body(); if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ error: 'ongeldige-body' }, 400);
    if (b.standaard === true) { await env.MT_ROLLEN.delete('instelling:ai_limieten'); await audit(env, { ...door, actie: 'ai-limieten', doel: 'standaard' }); return json({ ok: true, limieten: aiLimietNorm(null) }); }
    const toegestaan = new Set(['totaal_dag', 'rollen']); if (Object.keys(b).some(k => !toegestaan.has(k))) return json({ error: 'onbekend-veld' }, 400);
    const nieuw = { totaal_dag: undefined, rollen: {} }, grens = (k, v) => Number.isInteger(v) && v >= AI_LIMIET_GRENS[k][0] && v <= AI_LIMIET_GRENS[k][1];
    if (b.totaal_dag !== undefined) { if (!grens('totaal_dag', b.totaal_dag)) return json({ error: 'ongeldig', veld: 'totaal_dag' }, 400); nieuw.totaal_dag = b.totaal_dag; }
    for (const [rol, x] of Object.entries(b.rollen || {})) {
      if (!AI_LIMIET_STD.rollen[rol] || !x || typeof x !== 'object') return json({ error: 'onbekende-rol', rol }, 400);
      for (const [k, v] of Object.entries(x)) { if (!['dag', 'minuut', 'gelijktijdig'].includes(k) || !grens(k, v)) return json({ error: 'ongeldig', veld: rol + '.' + k }, 400); }
      nieuw.rollen[rol] = x;
    }
    const huidig = (await kvJson(env, 'instelling:ai_limieten')) || {}, samen = { totaal_dag: nieuw.totaal_dag !== undefined ? nieuw.totaal_dag : huidig.totaal_dag, rollen: Object.assign({}, huidig.rollen || {}) };
    for (const [rol, x] of Object.entries(nieuw.rollen)) samen.rollen[rol] = Object.assign({}, samen.rollen[rol] || {}, x);
    await kvZet(env, 'instelling:ai_limieten', Object.assign(samen, { ts: Date.now(), door: ik.oid }));
    await audit(env, { ...door, actie: 'ai-limieten', doel: 'gewijzigd' });   // geen bedragen of inhoud in het logboek
    return json({ ok: true, limieten: aiLimietNorm(samen) });
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
    let csp = { totaal: 0, afgewezen: 0, sleutels: {} }, cspBeschikbaar = false;   // CSP-tellers staan in de teller-DO, niet in KV
    try { const x = await aiDO(env, 'csp-overzicht', { dag: new Date().toISOString().slice(0, 10), dagen }, 'csp'); if (x && x.status === 200 && x.j) { csp = x.j; cspBeschikbaar = true; } } catch {}
    const proxyTop = Object.entries(tot.proxy).sort((a, b) => b[1] - a[1]).slice(0, 25)
      .map(([k, n]) => { const [target, actie, reden] = k.split('|'); return { target, actie, reden, n }; });
    const top = Object.entries(tot.redenen).sort((a, b) => b[1] - a[1]).slice(0, 25)
      .map(([k, n]) => { const [rol, actie, reden] = k.split('|'); return { rol, actie, reden, n }; });
    return json({ modus: rollenModus(env), proxyModus: proxyModus(env), dagen, totaal: tot.totaal, geweigerd: tot.geweigerd, perDag, top, proxyAfwijkingen: tot.proxyTotaal, proxyTop,
      cspTotaal: csp.totaal, cspAfgewezen: csp.afgewezen, cspBeschikbaar, cspTop: Object.entries(csp.sleutels).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => { const [directive, host] = k.split('|'); return { directive, host, n }; }) });
  }
  return json({ error: 'unknown-beheer-route' }, 404);
}

// ── Klantenlijst (F5): niet meer als publiek bestand (data/klanten.json) maar na login via de worker, uit KV.
// GET: iedereen die is ingelogd (in modus 'afdwingen' alleen met een rol; in 'log' ook zonder rol, maar apart gelogd als
// `klanten.zonder_rol`). Antwoord bevat `rev`. POST: alleen wie mag beheren, streng gecontroleerd (types, geen onbekende velden,
// ook niet bovenin de body), met `rev`: is die verouderd dan 409 en blijft alles bewaard. Oude stand wordt altijd bewaard.
// Schrijven loopt via de Durable Object MT_KLANTEN (class MtKlanten): één object serialiseert alle writes en doet het
// compare-and-set op `rev` binnen dat object (KV zelf heeft geen CAS). Twee gelijktijdige POST's met dezelfde rev: precies één
// wint, de ander krijgt 409. Zonder binding geen schrijfroute (503, bewust geen KV-terugval). Elke vorige stand gaat naar de historie.
// Auditlog zonder namen.
const KLANTEN_KV = 'klanten:registry', KLANTEN_MAX = 500;
const KLANT_VELDEN = new Set(['code', 'naam', 'aliassen', 'mb_contact_id', 'opmerking', 'locaties']), KLANT_LOC_VELDEN = new Set(['code', 'naam', 'mb_contact_id']);
const KLANT_BODY_VELDEN = new Set(['klanten', 'rev']);
// Controleert één klant (of locatie) en geeft { fout } of { klant } terug, met de canonieke vorm (getrimde teksten; mb_contact_id altijd tekst of null:
// een getal wordt geweigerd, want een 18-cijferig id rondt in JSON af).
function klantSchoon(k, loc) {
  if (!k || typeof k !== 'object' || Array.isArray(k)) return { fout: 'object verwacht' };
  const vreemd = Object.keys(k).find(x => !(loc ? KLANT_LOC_VELDEN : KLANT_VELDEN).has(x)); if (vreemd !== undefined) return { fout: `onbekend veld "${String(vreemd).slice(0, 40)}"` };
  if (typeof k.code !== 'string' || !/^[A-Z0-9]{1,10}$/.test(k.code)) return { fout: 'code: tekst van 1–10 hoofdletters/cijfers' };
  if (typeof k.naam !== 'string' || !k.naam.trim() || k.naam.length > 120) return { fout: 'naam: 1–120 tekens' };
  const uit = { code: k.code, naam: k.naam.trim() };
  if (k.mb_contact_id != null) {
    if (typeof k.mb_contact_id !== 'string') return { fout: 'mb_contact_id: tekst of null (geen getal)' };
    const id = k.mb_contact_id.trim();
    if (id !== '' && !/^\d{6,25}$/.test(id)) return { fout: 'mb_contact_id: cijfers of null' };
    uit.mb_contact_id = id === '' ? null : id;
  } else uit.mb_contact_id = null;
  if (loc) return { klant: uit };
  if (k.aliassen != null) {
    if (!(Array.isArray(k.aliassen) && k.aliassen.length <= 20 && k.aliassen.every(a => typeof a === 'string' && a.length <= 120))) return { fout: 'aliassen: max 20 teksten' };
    const al = k.aliassen.map(a => a.trim()).filter(Boolean); if (al.length) uit.aliassen = al;
  }
  if (k.opmerking != null) {
    if (!(typeof k.opmerking === 'string' && k.opmerking.length <= 300)) return { fout: 'opmerking: max 300 tekens' };
    if (k.opmerking.trim()) uit.opmerking = k.opmerking.trim();
  }
  if (k.locaties != null) {
    if (!Array.isArray(k.locaties) || k.locaties.length > 50) return { fout: 'locaties: lijst (max 50)' };
    const ls = [];
    for (const l of k.locaties) { const r = klantSchoon(l, true); if (r.fout) return { fout: 'locatie: ' + r.fout }; ls.push(r.klant); }
    if (ls.length) uit.locaties = ls;
  }
  return { klant: uit };
}
const klantenRevVan = d => (d && Number.isInteger(d.rev) && d.rev >= 0 ? d.rev : 0);
// Durable Object: één instantie ('registry'). De waarheid over `rev` staat in de opslag van het object (geserialiseerd);
// KV bevat de lijst voor lezers. Start (of een KV-stand die vooruit liep, bv. handmatig gezet) telt mee: rev = max(object, KV).
export class MtKlanten {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(request) {
    const op = new URL(request.url).pathname.slice(1), st = this.state.storage;
    const antw = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (op !== 'schrijf') return antw({ error: 'onbekend' }, 404);
    let b = {}; try { b = await request.json(); } catch {}
    if (!Number.isInteger(b.rev) || !Array.isArray(b.klanten)) return antw({ error: 'ongeldig' }, 400);
    return await this.state.blockConcurrencyWhile(async () => {
      try {
        const kvRec = await kvJson(this.env, KLANTEN_KV), doRev = (await st.get('rev')) || 0, kvRev = klantenRevVan(kvRec);
        const cur = Math.max(doRev, kvRev);
        if (cur !== b.rev) return antw({ error: 'verouderd', rev: cur }, 409);
        const doRec = doRev >= kvRev ? await st.get('rec') : null, oud = doRec || kvRec;   // de eigen kopie is nooit ouder dan KV
        const ts = Date.now(), rev = cur + 1, nieuw = { klanten: b.klanten, bijgewerkt: new Date(ts).toISOString(), door: b.door || null, rev };
        if (oud) await kvZet(this.env, `${KLANTEN_KV}:historie:${String(9e15 - ts).padStart(16, '0')}:${randHex(4)}`, oud);   // vorige stand bewaard
        await kvZet(this.env, KLANTEN_KV, nieuw);
        await st.put({ rev, rec: nieuw });
        return antw({ ok: true, aantal: b.klanten.length, rev });
      } catch (e) { return antw({ error: 'opslag', detail: String((e && e.message) || e).slice(0, 120) }, 503); }
    });
  }
}
async function handleKlanten(request, env, ik, json, ctx) {
  const m = request.method.toUpperCase();
  const huidig = async () => (env.MT_ROLLEN ? await kvJson(env, KLANTEN_KV) : null);
  const revVan = klantenRevVan;
  if (m === 'GET') {
    if (!ik.rol) {
      if (rollenModus(env) === 'afdwingen') return json({ error: 'geen-toegang', reden: ik.reden || 'geen-rol' }, 403);
      if (rollenModus(env) === 'log') { try { await noteerBesluit(env, ctx, { ok: false, modus: 'log', rol: null, oid: ik.oid, target: 'klanten', actie: 'klanten.zonder_rol', reden: ik.reden || 'geen-rol' }); } catch {} }
    }
    const d = await huidig();
    if (!d || !Array.isArray(d.klanten) || !d.klanten.length) return json({ error: 'geen-klantenlijst', rev: 0 }, 404);
    return json({ klanten: d.klanten, bijgewerkt: d.bijgewerkt || null, rev: revVan(d) });
  }
  if (m !== 'POST') return json({ error: 'alleen GET of POST' }, 405);
  if (!(RECHTEN[ik.rol] && RECHTEN[ik.rol].beheer)) return json({ error: 'geen-toegang', reden: 'beheer' }, 403);
  if (!env.MT_ROLLEN) return json({ error: 'geen-opslag' }, 503);
  let b = null; try { b = await request.json(); } catch {}
  if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ error: `klanten: lijst (1–${KLANTEN_MAX})` }, 400);
  const vreemdB = Object.keys(b).find(x => !KLANT_BODY_VELDEN.has(x)); if (vreemdB !== undefined) return json({ error: `onbekend veld "${String(vreemdB).slice(0, 40)}"` }, 400);
  if (!Array.isArray(b.klanten) || !b.klanten.length || b.klanten.length > KLANTEN_MAX) return json({ error: `klanten: lijst (1–${KLANTEN_MAX})` }, 400);
  if (!Number.isInteger(b.rev) || b.rev < 0) return json({ error: 'rev: verplicht (het getal uit de laatste GET /klanten)' }, 400);
  const codes = new Set(), schoon = [];
  for (const k of b.klanten) {
    const r = klantSchoon(k, false);
    if (r.fout) return json({ error: 'klant: ' + r.fout, code: k && typeof k.code === 'string' && /^[A-Z0-9]{1,10}$/.test(k.code) ? k.code : null }, 400);
    if (codes.has(r.klant.code)) return json({ error: 'dubbele code', code: r.klant.code }, 400);
    codes.add(r.klant.code); schoon.push(r.klant);
  }
  const ns = env.MT_KLANTEN;
  if (!ns || !ns.idFromName) return json({ error: 'geen-klanten-opslag', uitleg: 'Durable Object-binding MT_KLANTEN ontbreekt (zie wrangler.toml)' }, 503);
  let r; try { r = await ns.get(ns.idFromName('registry')).fetch('https://mt-klanten/schrijf', { method: 'POST', body: JSON.stringify({ rev: b.rev, klanten: schoon, door: ik.oid }) }); } catch { return json({ error: 'opslag' }, 503); }
  const uit = await r.json().catch(() => ({}));
  if (r.status === 409) return json({ error: 'verouderd', rev: uit.rev }, 409);   // niets geschreven; de aanvrager haalt de lijst opnieuw op
  if (!r.ok || !uit.ok) return json({ error: 'opslag' }, 503);
  const rev = uit.rev;
  await audit(env, { door: ik.oid, doorNaam: (ik.rec && ik.rec.naam) || ik.email || '', actie: 'klantenlijst', doel: 'klanten', doelNaam: `klantenlijst opgeslagen (${schoon.length})` });   // geen namen
  return json({ ok: true, aantal: schoon.length, rev });
}

// ── Koersmeter A+A2: elke ochtend vóór 07:00 (Europe/Amsterdam) de dagfoto bewaren en bij verslechtering een melding in KV ─────────
// Het werk begint om 07:00: de melding moet dan klaar zijn. Cron Triggers staan in UTC. Daarom elke 30 minuten van 03:00 tot 05:30 UTC
// (wrangler.toml [triggers]); de code kijkt naar de lokale tijd in Europe/Amsterdam (zomer- en wintertijd kloppen dan vanzelf):
//   - 04:00 tot 05:30 lokaal: alleen caches vullen (koersVoor): de volledige tijdlijn van vandaag en de maandcijfers in KV, binnen één run van 45; geen claim,
//     geen dagfoto, geen melding. Zomer is dat één trigger (05:00), winter drie (04:00, 04:30, 05:00).
//   - 05:30 tot 07:00 lokaal: de eigenlijke run (poging 1 om 05:30, 2 om 06:00, 3 om 06:30), als de dag nog niet klaar is en er minder dan KOERS_POGINGEN
//     pogingen zijn gedaan. Mislukt of onvolledig (Moneybird, subrequest-budget), dan probeert de volgende trigger het nog een keer. Vanaf 07:00 doet niets meer mee.
// De berekening is dezelfde als in het scherm: de routes van handleGeld worden intern als eigenaar aangeroepen en mt-geld.js/mt-koers.js
// (K.invoer, K.oordeel, K.moetMelden, K.actie) doen het rekenwerk.
// Eén run per dag, atomair: de dagclaim staat in de Durable Object MT_KOERSDAG (class MtKoersDag; bezig / klaar / mislukt, pogingen, fout).
// Dagfoto en melding schrijft alleen de claim-eigenaar. Een run mag nooit meer dan KOERS_SUB_MAX subrequests doen (gratis plan: 50 per invocation;
// KV, Moneybird en Durable Object tellen allemaal mee): één gedeeld budget (koersBudget), waarvan KOERS_SUB_RESERVE alleen voor het afronden
// (dagfoto, melding, claim afsluiten) is. Is het budget op, dan is het oordeel "onbetrouwbaar", nooit groen, en nooit een crash.
// KV: geld:koers:dag:<datum> (de dagfoto, zoals het scherm hem ook bewaart), geld:koers:melding:<datum> (hooguit één per dag),
// geld:koers:gelezen:<oid> (per gebruiker tot en met welke datum afgevinkt), geld:koers:tijdlijn:<datum> (volledige tijdlijn van vandaag, 6 uur, voor de volgende run).
// G6: het maandagbericht (geld:koers:week:<datum>, 90 dagen): één per maandag, door de cron geschreven, als melding in de app naast de ochtendmelding. Niets naar derden.
const KOERS_WEEK = 'geld:koers:week:', KOERS_MELDING = 'geld:koers:melding:', KOERS_GELEZEN = 'geld:koers:gelezen:', KOERS_TIJDLIJN = 'geld:koers:tijdlijn:';
const KOERS_POGINGEN = 3, KOERS_SUB_MAX = 45, KOERS_SUB_RESERVE = 5, KOERS_BEZIG_MS = 20 * 60 * 1000;   // 20 min > de maximale looptijd van een cron-run: een levende run wordt nooit overgenomen
const maandagLokaal = ms => new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Amsterdam', weekday: 'short' }).format(new Date(ms)) === 'Mon';
function amsterdamTijd(ms) {
  const d = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)), g = t => Number((d.find(x => x.type === t) || {}).value);
  return { uur: g('hour'), min: g('minute') };
}
// Fase op lokale tijd: 'run' van 05:30 tot 07:00, 'voor' (caches vullen) van 04:00 tot 05:30, anders null.
const koersFase = ms => { const a = amsterdamTijd(ms), m = a.uur * 60 + a.min; return m >= 330 && m < 420 ? 'run' : m >= 240 && m < 330 ? 'voor' : null; };
// Gedeeld subrequest-budget van één run. neem() telt er één bij; reserve = alleen voor het afronden. Geweigerde aanvragen worden onthouden (geweigerd).
function koersBudget(max, reserve) {
  const s = { n: 0, max, reserve, geweigerd: 0, soort: {},
    neem(gereserveerd, soort) { if (s.n >= (gereserveerd ? max : max - reserve)) { s.geweigerd++; return false; } s.n++; const k = soort || 'mb'; s.soort[k] = (s.soort[k] || 0) + 1; return true; },
    rest() { return Math.max(0, max - reserve - s.n); } };
  return s;
}
// KV-binding die meetelt in het budget; bij een op budget gooit elke aanroep (kvJson vangt dat op en geeft null, kvZet gooit door).
function telKv(kv, sub, gereserveerd) {
  const tel = naam => (...a) => { if (!sub.neem(gereserveerd, 'kv:' + naam)) throw new Error('subrequest-budget-op'); return kv[naam](...a); };
  return { get: tel('get'), put: tel('put'), delete: tel('delete'), list: tel('list'), getWithMetadata: tel('getWithMetadata') };
}
// Durable Object: de dagclaim. Eén instantie ('koers'), geserialiseerd; per datum { status, pogingen, token, ts, fout, kleur, gemeld }.
export class MtKoersDag {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const op = new URL(request.url).pathname.slice(1), st = this.state.storage;
    const antw = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
    let b = {}; try { b = await request.json(); } catch {}
    if (!['claim', 'afrond', 'lees'].includes(op)) return antw({ error: 'onbekend' }, 404);
    const datum = String(b.datum || ''), tekst = x => (x == null ? undefined : String(x).slice(0, 200));
    return await this.state.blockConcurrencyWhile(async () => {
      try {
        if (op === 'lees') {
          const n = Math.max(1, Math.min(14, Number(b.dagen) || 7)), m = await st.list({ prefix: 'dag:', reverse: true, limit: n });
          return antw({ dagen: [...m].map(([k, r]) => ({ datum: k.slice(4), status: r.status, pogingen: r.pogingen, ts: r.ts, kleur: r.kleur || null, gemeld: !!r.gemeld, fout: r.fout || null })) });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || typeof b.token !== 'string' || b.token.length < 6 || b.token.length > 40) return antw({ error: 'ongeldig' }, 400);
        const sleutel = 'dag:' + datum, rec = await st.get(sleutel), nu = Number(b.nu) || Date.now();
        if (op === 'afrond') {
          if (!rec || rec.token !== b.token || rec.status !== 'bezig') return antw({ ok: false, reden: 'geen-eigenaar' });   // alleen de claim-eigenaar sluit af
          if (!['klaar', 'mislukt'].includes(b.status)) return antw({ error: 'ongeldig' }, 400);
          await st.put(sleutel, Object.assign({}, rec, { status: b.status, ts: nu, fout: tekst(b.fout) || (b.status === 'mislukt' ? 'onbekend' : undefined), kleur: tekst(b.kleur), gemeld: !!b.gemeld }));
          return antw({ ok: true });
        }
        const max = Math.max(1, Math.min(10, Number(b.max) || KOERS_POGINGEN)), p = rec ? rec.pogingen || 0 : 0;
        if (rec && rec.status === 'klaar') return antw({ ok: false, reden: 'klaar' });
        if (rec && rec.status === 'bezig' && nu - rec.ts < KOERS_BEZIG_MS) return antw({ ok: false, reden: 'bezig' });
        if (rec && rec.status === 'bezig') await st.put(sleutel, Object.assign({}, rec, { status: 'mislukt', fout: 'run afgebroken (niet afgesloten)', ts: nu }));   // afgebroken run: telt als poging
        if (p >= max) return antw({ ok: false, reden: 'pogingen-op', pogingen: p });
        await st.put(sleutel, { status: 'bezig', pogingen: p + 1, token: b.token, ts: nu, fout: rec && rec.fout ? String(rec.fout).slice(0, 200) : undefined });
        const oud = [...await st.list({ prefix: 'dag:' })].map(([k]) => k).sort();
        if (oud.length > 30) await st.delete(oud.slice(0, oud.length - 30));
        return antw({ ok: true, poging: p + 1 });
      } catch (e) { return antw({ error: 'opslag', detail: String((e && e.message) || e).slice(0, 120) }, 503); }
    });
  }
}
async function geldModules() { await import('./mt-geld.js'); await import('./mt-koers.js'); return { G: globalThis.MTGeld, K: globalThis.MTKoers }; }
// Een /geld-route intern aanroepen als eigenaar (zelfde code als het scherm, geen tweede berekening).
async function geldIntern(env, pad) {
  const ik = { rol: 'eigenaar', oid: 'cron-koersmeter', rec: { naam: 'Koersmeter' }, email: '' };
  const r = await handleGeld(pad.split('?')[0], new Request('https://intern.invalid' + pad), env, ik, (b, st = 200) => new Response(JSON.stringify(b), { status: st, headers: { 'Content-Type': 'application/json' } }));
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
// Een Moneybird-hapering in de tijdlijn (aanvraag mislukt, lijst afgebroken) loont een nieuwe poging; "nog niet berekend" (profiel, patronen,
// prognose, instellingen) verdwijnt niet door wachten en telt dus niet mee. De K.invoer-regels maken er in beide gevallen "onbetrouwbaar" van.
const KOERS_TIJDELIJK = new Set(['balans', 'bankmutaties', 'grootboeken', 'btw', 'algemeen']);
const koersTijdelijk = w => (Array.isArray(w) ? w : []).some(x => x && x.onvolledig && (x.pad || KOERS_TIJDELIJK.has(x.bron)));
// De volledige tijdlijn van vandaag: uit KV als een eerdere run/voorverversing hem bewaarde, anders berekenen en (als hij volledig is) bewaren.
async function koersTijdlijn(envT, sub, vandaag) {
  const tl = await kvJson(envT, KOERS_TIJDLIJN + vandaag);
  if (tl && tl.vandaag) return { status: 200, j: tl, uitCache: true };
  const voor = sub.geweigerd;
  const t = await geldIntern(envT, `/geld/tijdlijn?van=${geldDag(vandaag, -35)}&tot=${geldDag(vandaag, 364)}&historie=1&vers=1`);
  const vol = t.status === 200 && t.j && t.j.vandaag && sub.geweigerd === voor && !koersTijdelijk(t.j.waarschuwingen);   // een tijdlijn met een Moneybird-hapering nooit bewaren
  if (vol) { try { await kvZet(envT, KOERS_TIJDLIJN + vandaag, t.j, { expirationTtl: 6 * 3600 }); } catch {} }
  return t;
}
const koersCijfersPad = vandaag => `/geld/cijfers?per=maand&van=${Number(vandaag.slice(0, 4)) - 1}-01&tot=${vandaag.slice(0, 7)}`;
// Voorverversing (04:00-05:30 lokaal): de tijdlijn en de maandcijfers in KV zetten, zodat de run van 05:30 alleen nog hoeft te rekenen.
// Geen dagclaim, geen dagfoto, geen melding; een volledig budget van 45 (er is geen afrondfase). Fouten worden gelogd, nooit gegooid.
async function koersVoor(env) {
  const sub = koersBudget(KOERS_SUB_MAX, 0), vandaag = geldVandaag();
  const envT = Object.assign({}, env, { MT_ROLLEN: telKv(env.MT_ROLLEN, sub, false), __sub: sub });
  try {
    const t = await koersTijdlijn(envT, sub, vandaag);   // eerst de tijdlijn: alles-of-niets (31+ aanvragen); de cijfers vullen zich ook in stukken aan
    const x = await geldIntern(envT, koersCijfersPad(vandaag));
    const uit = { status: 'voorverwarmd', tijdlijn: !!(t.status === 200 && t.j && t.j.vandaag), cijfersCompleet: !!(x.status === 200 && x.j && x.j.compleet), subrequests: sub.n, soorten: sub.soort };
    koersLog(uit);
    return uit;
  } catch (e) {
    const fout = String((e && e.message) || e).slice(0, 200);
    koersLog({ status: 'voor-fout', fout, subrequests: sub.n });
    return { status: 'voor-fout', fout, subrequests: sub.n };
  }
}
function koersLog(o) { try { console.log(JSON.stringify(Object.assign({ koerscron: true }, o))); } catch {} }
async function koersCron(env, tijd) {
  const fase = koersFase(tijd);
  if (!fase) return { status: 'niet-nu' };
  if (!env.MT_ROLLEN) return { status: 'geen-opslag' };
  if (fase === 'voor') return await koersVoor(env);
  const ns = env.MT_KOERSDAG;
  if (!ns || !ns.idFromName) { koersLog({ status: 'geen-dagclaim' }); return { status: 'geen-dagclaim' }; }   // zonder atomaire claim geen run (liever geen dagfoto dan twee)
  const sub = koersBudget(KOERS_SUB_MAX, KOERS_SUB_RESERVE), vandaag = geldVandaag(), token = randHex(8);
  const claimDo = async (op, body) => {   // elke Durable Object-aanroep telt als subrequest (uit het gereserveerde deel)
    if (!sub.neem(true, 'do')) throw new Error('subrequest-budget-op');
    const r = await ns.get(ns.idFromName('koers')).fetch('https://mt-koersdag/' + op, { method: 'POST', body: JSON.stringify(Object.assign({ datum: vandaag, token, nu: Date.now() }, body)) });
    return await r.json().catch(() => ({}));
  };
  let claim;
  try { claim = await claimDo('claim', { max: KOERS_POGINGEN }); } catch (e) { koersLog({ status: 'claim-fout', fout: String((e && e.message) || e).slice(0, 120) }); return { status: 'claim-fout' }; }
  if (!claim.ok) return { status: claim.reden === 'klaar' ? 'al-gedaan' : (claim.reden || 'geen-claim') };
  const poging = claim.poging, laatste = poging >= KOERS_POGINGEN;
  let nu = null, o = null, inv = null, bronFout = null, onvolledigRun = false;
  const envT = Object.assign({}, env, { MT_ROLLEN: telKv(env.MT_ROLLEN, sub, false), __sub: sub });   // alles wat de routes doen telt mee in het gedeelde budget
  const envR = Object.assign({}, env, { MT_ROLLEN: telKv(env.MT_ROLLEN, sub, true) });             // afronden: mag het gereserveerde deel gebruiken
  try {
    const { G, K } = await geldModules();
    // De dagfoto van "gisteren": de laatste van de zeven dagen vóór vandaag (zoals het scherm); meestal is de eerste al raak.
    let gisteren = null;
    for (let i = 1; i <= 7 && !gisteren; i++) gisteren = await kvJson(envT, GELD_DAGFOTO + geldDag(vandaag, -i));
    let r = null, fout = null;
    // De tijdlijn is het duurste deel (tientallen Moneybird-/KV-aanvragen) en past met de cijfers niet in één run van 45. Daarom staat hij na de
    // voorverversing (of poging 1) in KV (KOERS_TIJDLIJN): een volgende run leest hem daar en besteedt het budget aan de cijfers.
    const t = await koersTijdlijn(envT, sub, vandaag);
    const c = await geldIntern(envT, '/geld/config');
    if (t.status !== 200 || !t.j || !t.j.vandaag) bronFout = `geldtijdlijn niet te lezen (${(t.j && t.j.error) || 'HTTP ' + t.status})`;
    else if (c.status !== 200 || !c.j) bronFout = `instellingen niet te lezen (${(c.j && c.j.error) || 'HTTP ' + c.status})`;
    else {
      // Cijfers: uit de KV-cache van de maandrecords; wat ontbreekt haalt de route aan met het restant van het budget (één ronde, geen vervolgrondes).
      // Blijft er iets over, dan is het oordeel "onbetrouwbaar" en vult de volgende poging (30 min later) verder aan: gehaalde maanden staan dan in de cache.
      const x = await geldIntern(envT, koersCijfersPad(vandaag));
      if (x.status !== 200 || !x.j || x.j.error) fout = (x.j && x.j.error) || 'geen antwoord'; else r = x.j;
      inv = K.invoer(t.j, c.j.config, { r, laden: false, fout }, G); o = K.oordeel(inv); nu = K.dagfotoOpslag(o);
      if (sub.geweigerd > 0 && nu.kleur !== 'onbetrouwbaar') {   // een geweigerde aanvraag kan als "leeg" zijn gelezen: dan nooit een groen oordeel
        nu = Object.assign({}, nu, { kleur: 'onbetrouwbaar', bronnen: ['subrequest-budget van de run was op — gegevens onvolledig'].concat(nu.bronnen || []), meters: (nu.meters || []).map(mm => mm.kleur === 'groen' ? Object.assign({}, mm, { kleur: 'onbekend' }) : mm) });
      }
      onvolledigRun = !!fout || sub.geweigerd > 0 || !(r && r.compleet) || koersTijdelijk(t.j.waarschuwingen);   // ook een Moneybird-hapering in de tijdlijn: eerst nog een poging
    }
    if (bronFout || onvolledigRun) {
      const reden = bronFout || (fout ? 'cijfers: ' + fout : sub.geweigerd > 0 ? 'subrequest-budget op' : (r && !r.compleet) ? 'cijfers onvolledig' : 'tijdlijn onvolledig');
      if (!laatste) {   // nog een poging te goed: niets bewaren of melden, de volgende trigger probeert het opnieuw
        await claimDo('afrond', { status: 'mislukt', fout: reden });
        koersLog({ status: 'mislukt', poging, fout: reden, subrequests: sub.n, soorten: sub.soort });
        return { status: 'mislukt', poging, fout: reden, subrequests: sub.n, soorten: sub.soort };
      }
    }
    // Laatste poging, of alles gelukt: bewaren en melden (alleen de claim-eigenaar komt hier).
    if (nu) await kvZet(envR, GELD_DAGFOTO + vandaag, { datum: vandaag, jaar: nu.jaar, kleur: nu.kleur, meters: nu.meters, bronnen: nu.bronnen, ts: Date.now(), via: 'cron' }, { expirationTtl: 400 * 86400 });
    // Melden: alleen bij verslechtering (K.moetMelden). Is een bron onvolledig, dan is er geen groen oordeel maar "oordeel onbetrouwbaar";
    // die melding komt alleen als het oordeel gisteren betrouwbaar was (anders is het geen verandering).
    const gisterenBetrouwbaar = !!gisteren && gisteren.kleur !== 'onbetrouwbaar';
    let redenen = [], verschil = null;
    if (nu) {
      const mm = K.moetMelden(gisteren, nu); redenen = mm.redenen.slice(); verschil = mm.verschil || null;
      if (nu.kleur === 'onbetrouwbaar' && gisterenBetrouwbaar && !redenen.some(x => /onbetrouwbaar/.test(x))) redenen.unshift('oordeel onbetrouwbaar: ' + (nu.bronnen[0] || 'een bron is onvolledig'));
    } else if (gisterenBetrouwbaar) redenen = ['oordeel onbetrouwbaar: ' + bronFout];
    let melding = null;
    if (redenen.length) {
      melding = { datum: vandaag, ts: Date.now(), kleur: nu ? nu.kleur : 'onbetrouwbaar', titel: nu ? K.TITEL[nu.kleur] : K.TITEL.onbetrouwbaar, van: gisteren ? gisteren.kleur : null, redenen: redenen.map(x => String(x).slice(0, 200)).slice(0, 6),
        tekst: verschil ? verschil.tekst : null, actie: o ? String(K.actie(o, inv)).slice(0, 300) : null, onbetrouwbaar: !nu || nu.kleur === 'onbetrouwbaar' };
      if (!(await kvJson(envR, KOERS_MELDING + vandaag))) await kvZet(envR, KOERS_MELDING + vandaag, melding, { expirationTtl: 60 * 86400 });   // hooguit één per dag
    }
    // G6: op maandag (lokale tijd van de trigger) het maandagbericht, één keer per datum; alleen met een leesbare tijdlijn en config en een oordeel.
    // Past het lezen + schrijven niet meer in het budget (reserve), dan geldt dat als een mislukte poging: de volgende trigger (30 min later) doet het opnieuw
    // (dagfoto en melding bestaan dan al, dus die kosten minder); pas de laatste poging geeft het op en meldt dat in de dagclaim.
    let week = 'geen-maandag';
    if (maandagLokaal(tijd)) {
      try {
        week = 'bestond';
        if (!(await kvJson(envR, KOERS_WEEK + vandaag))) {
          if (o && inv && t && t.j && t.j.vandaag && c && c.j && c.j.config) {
            const wb = K.weekbericht(o, inv, t.j, c.j.config, G);
            await kvZet(envR, KOERS_WEEK + vandaag, wb, { expirationTtl: 90 * 86400 }); week = 'gemaakt';
          } else week = 'geen-data';
        }
      } catch (e) {
        week = 'budget-of-opslag';
        if (!laatste) { await claimDo('afrond', { status: 'mislukt', fout: 'maandagbericht niet geschreven: ' + String((e && e.message) || e).slice(0, 80) }); koersLog({ status: 'mislukt', poging, fout: 'maandagbericht', subrequests: sub.n, soorten: sub.soort }); return { status: 'mislukt', poging, week, fout: 'maandagbericht', subrequests: sub.n, soorten: sub.soort }; }
      }
    }
    const status = bronFout ? 'bron-fout' : 'klaar';
    await claimDo('afrond', { status: 'klaar', kleur: nu ? nu.kleur : null, gemeld: !!melding, fout: bronFout || (onvolledigRun ? 'onvolledig na ' + poging + ' pogingen' : undefined) || (week === 'budget-of-opslag' ? 'maandagbericht niet geschreven' : undefined) });
    koersLog({ status, poging, subrequests: sub.n, soorten: sub.soort, week });
    return { status, poging, week, kleur: nu ? nu.kleur : null, gemeld: !!melding, fout: bronFout || undefined, subrequests: sub.n, soorten: sub.soort };
  } catch (e) {
    const fout = String((e && e.message) || e).slice(0, 200);
    try { await claimDo('afrond', { status: 'mislukt', fout }); } catch {}
    koersLog({ status: 'fout', poging, fout, subrequests: sub.n, soorten: sub.soort });
    return { status: 'fout', poging, fout, subrequests: sub.n, soorten: sub.soort };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ZOEKBALK — Moneybird-facturen en -offertes (GET /zoek/moneybird?q=…&max=10). Alleen lezen.
// De zoekbalk typt per toetsaanslag: een Moneybird-download daarbij is uitgesloten. Daarom staat er een compacte
// zoekindex in KV (verkoopfacturen, inkoopfacturen, offertes van dit en vorig jaar: nummer, referentie, contactnaam,
// datum, nooit bedragen). Een verzoek leest alleen die index. Is de index er niet of te oud, dan start een
// achtergrondtaak (waitUntil) de opbouw/verversing en antwoordt het verzoek meteen ("opbouwen" of de oude index).
// Bij Moneybird-429 komt er een korte pauze-markering (Retry-After) en wordt er niet opnieuw gehaald.
// ═══════════════════════════════════════════════════════════════════════════
const ZOEK_MB_INDEX = 'zoek:mb:index:v1', ZOEK_MB_SLOT = 'zoek:mb:slot', ZOEK_MB_PAUZE = 'zoek:mb:pauze';
const ZOEK_MB_ONVOLLEDIG_MS = 2 * 60 * 1000, ZOEK_MB_VERS_MS = 15 * 60 * 1000, ZOEK_MB_OUD_MS = 24 * 3600 * 1000, ZOEK_MB_SLOT_S = 120, ZOEK_MB_MIN = 3, ZOEK_MB_BUDGET = 45;
const zoekNorm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const ZOEK_MB_SOORT = { v: 'verkoopfactuur', i: 'inkoopfactuur', o: 'offerte' };
const ZOEK_MB_PAD = { v: 'sales_invoices', i: 'documents', o: 'estimates' };
function zoekMbContact(c) { if (!c || typeof c !== 'object') return ''; return String(c.company_name || [c.firstname, c.lastname].filter(Boolean).join(' ') || '').trim(); }
// De zes lijsten (drie soorten × dit en vorig jaar) en hun compacte vorm; gedeeld door de eenmalige opbouw en de hervatbare opbouw in de DO.
const ZOEK_MB_LIJSTEN = [['v', 'sales_invoices', 'invoice_id', 'invoice_date'], ['i', 'documents/purchase_invoices', 'reference', 'date'], ['o', 'estimates', 'estimate_id', 'estimate_date']]
  .flatMap(([s, pad, nrVeld, datumVeld]) => ['this_year', 'prev_year'].map(periode => ({ s, pad, nrVeld, datumVeld, periode })));
const zoekMbItem = (l, x) => ({ s: l.s, id: String(x.id), nr: String((l.s === 'i' ? '' : x[l.nrVeld]) || ''), ref: String(x.reference || '').slice(0, 80), c: zoekMbContact(x.contact).slice(0, 80), d: String(x[l.datumVeld] || '').slice(0, 10) });
const zoekMbSorteer = items => items.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
// Eenmalige opbouw (alleen zonder Durable Object, zie zoekMbVerversen1). Een Moneybird-429 is TERMINAAL: geen retries, geen verdere
// bron/periode-combinaties, niets wordt bewaard; de echte Retry-After komt terug. Alleen een volledige opbouw (geen enkele waarschuwing) is `compleet`.
async function zoekMbOpbouwen(env) {
  const budget = { rest: ZOEK_MB_BUDGET }, w = [], get = geldMb(env, budget, { geen429Retry: true }), items = [];
  for (const l of ZOEK_MB_LIJSTEN) {
    const r = await geldLijst(get, `${l.pad}?filter=period:${l.periode}`, w, l.s);
    const t429 = w.find(x => x.status === 429);
    if (t429) return { items: [], compleet: false, afgebroken: '429', retryAfter: t429.retryAfter > 0 ? t429.retryAfter : 60, fouten: w.length };
    r.lijst.forEach(x => items.push(zoekMbItem(l, x)));
  }
  zoekMbSorteer(items);
  return { items: items.slice(0, 6000), compleet: w.length === 0 && items.length <= 6000, fouten: w.length };
}
// KV-slot: alleen de terugval zonder Durable Object (bij benadering één opbouw tegelijk).
async function zoekMbClaim(env) {
  const token = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, '').slice(0, 32);
  if (await kvJson(env, ZOEK_MB_SLOT)) return null;
  await kvZet(env, ZOEK_MB_SLOT, { ts: Date.now(), token }, { expirationTtl: ZOEK_MB_SLOT_S });
  return token;
}
async function zoekMbVrij(env) { try { if (env.MT_ROLLEN) await env.MT_ROLLEN.delete(ZOEK_MB_SLOT); } catch {} }
const zoekMbPauze = (env, seconden, reden) => { seconden = Math.max(1, Math.min(Number(seconden) || 60, ZOEK_RETRY_MAX)); return kvZet(env, ZOEK_MB_PAUZE, { tot: Date.now() + seconden * 1000, ra: seconden, reden }, { expirationTtl: Math.max(60, seconden) }); };
// Resultaat van een opbouw wegschrijven. Een complete index wordt alleen vervangen door een aantoonbaar complete nieuwe; een onvolledige
// opbouw laat de laatste complete versie staan (en geeft 120 s pauze). Een 429 is terminaal: pauze met de echte Retry-After, index onaangetast.
async function zoekMbAfronden(env, res) {
  if (res.afgebroken === '429') { await zoekMbPauze(env, res.retryAfter, '429'); return; }
  const oud = await kvJson(env, ZOEK_MB_INDEX);
  if (res.items.length && (res.compleet || !oud || !oud.compleet)) {
    await kvZet(env, ZOEK_MB_INDEX, { ts: Date.now(), items: res.items, compleet: !!res.compleet, onvolledig: !res.compleet }, { expirationTtl: 7 * 86400 });
  }
  if (!res.compleet) await zoekMbPauze(env, 120, 'onvolledig');      // niet elk verzoek opnieuw laten proberen
}
let zoekMbBezig = null;   // binnen deze isolate hooguit één start/opbouw tegelijk (goedkoop)
function zoekMbVerversen(env) {
  if (zoekMbBezig) return zoekMbBezig;
  zoekMbBezig = zoekMbVerversen1(env).catch(() => {}).finally(() => { zoekMbBezig = null; });
  return zoekMbBezig;
}
async function zoekMbVerversen1(env) {
  const pauze = await kvJson(env, ZOEK_MB_PAUZE);
  if (pauze && pauze.tot > Date.now()) return;                       // tijdens een pauze nooit opnieuw proberen
  const ns = env.MT_ZOEKINDEX;
  if (ns && ns.idFromName) {
    // Hervatbare opbouw in stukken door de Durable Object (alarm): het verzoek start hem alleen. Onbereikbaar = niet bouwen.
    try { await ns.get(ns.idFromName('mb')).fetch('https://mt-zoekindex/start', { method: 'POST', body: JSON.stringify({ nu: Date.now() }) }); } catch {}
    return;
  }
  const token = await zoekMbClaim(env); if (!token) return;
  try {
    let res; try { res = await zoekMbOpbouwen(env); } catch (e) { res = { items: [], compleet: false, mislukt: true, fouten: 1 }; }
    await zoekMbAfronden(env, res);
  } finally { await zoekMbVrij(env); }
}
function zoekMbTreffers(index, q, max) {
  const termen = zoekNorm(q).split(' ').filter(Boolean), qn = termen.join(' ');
  const uit = [];
  for (const x of index.items) {
    const nr = zoekNorm(x.nr), c = zoekNorm(x.c), hooi = ' ' + [nr, zoekNorm(x.ref), c].join(' ') + ' ';
    if (!termen.every(t => hooi.includes(t))) continue;
    const rang = nr && (nr === qn || nr.replace(/ /g, '') === qn.replace(/ /g, '')) ? 0 : (nr && nr.startsWith(qn)) || c.startsWith(qn) ? 1 : 2;
    uit.push({ x, rang });
  }
  uit.sort((a, b) => (a.rang - b.rang) || (a.x.d < b.x.d ? 1 : a.x.d > b.x.d ? -1 : 0));
  const url = x => `https://moneybird.com/${MB_ADMIN}/${x.s === 'i' ? 'documents' : x.s === 'v' ? 'sales_invoices' : 'estimates'}/${x.id}`;
  return { totaal: uit.length, items: uit.slice(0, max).map(({ x }) => ({ soort: ZOEK_MB_SOORT[x.s], id: x.id, titel: [x.nr, x.ref].filter(Boolean).join(' · ') || '(zonder nummer)', klant: x.c, datum: x.d, url: url(x) })) };
}
async function handleZoekMb(request, env, ik, json, ctx, modus) {
  if (String(request.method).toUpperCase() !== 'GET') return json({ error: 'alleen GET' }, 405);
  // Geld/facturen: het recht `moneybird` geldt hier ALTIJD, ook in ROLLEN_MODUS=log (zoals /geld/*): geen rol of geen recht = 403.
  const R = ik && ik.rol ? RECHTEN[ik.rol] : null;
  if (!R || !R.moneybird) return json({ error: 'geen-toegang', reden: 'moneybird' }, 403);
  if (!env.MT_ROLLEN) return json({ error: 'geen-opslag' }, 503);
  const url = new URL(request.url), q = (url.searchParams.get('q') || '').trim();
  if (zoekNorm(q).replace(/ /g, '').length < ZOEK_MB_MIN) return json({ error: `q: minimaal ${ZOEK_MB_MIN} tekens` }, 400);
  const max = Math.max(1, Math.min(20, Number(url.searchParams.get('max')) || 10));
  const [index, pauze] = await Promise.all([kvJson(env, ZOEK_MB_INDEX), kvJson(env, ZOEK_MB_PAUZE)]);
  const nu = Date.now(), leeftijd = index ? nu - index.ts : Infinity;
  const pauzeNog = pauze && pauze.tot > nu ? Math.ceil((pauze.tot - nu) / 1000) : 0;
  const versMs = index && index.onvolledig ? ZOEK_MB_ONVOLLEDIG_MS : ZOEK_MB_VERS_MS;   // een onvolledige index (bv. na een 429) wordt snel opnieuw geprobeerd
  if (leeftijd > versMs && !pauzeNog) waitUntil(ctx, zoekMbVerversen(env).catch(() => {}));   // achtergrond, nooit in dit verzoek
  if (!index || leeftijd > ZOEK_MB_OUD_MS || !index.items) {
    if (pauzeNog) {
      const is429 = !pauze || pauze.reden === '429';
      const r = json({ error: is429 ? 'moneybird-429' : 'moneybird-onbereikbaar', retry_after: pauzeNog }, is429 ? 429 : 503); r.headers.set('Retry-After', String(pauzeNog)); return r;
    }
    return json({ status: 'opbouwen', retry_after: 5, items: [], totaal: 0 });
  }
  const t = zoekMbTreffers(index, q, max);
  return json({ status: 'klaar', verouderd: leeftijd > versMs, onvolledig: !!index.onvolledig, ts: index.ts, totaal: t.totaal, items: t.items });
}

// Zoekindex-opbouw (Durable Object MT_ZOEKINDEX): één hervatbare opbouw tegelijk, in stukken, gedreven door een alarm.
// Waarom: een waitUntil-taak heeft maar ~30 s; de opbouw kan dan halverwege stoppen. Hier verwerkt elke alarm-run hooguit ZOEK_MB_PAGINAS_PER_RUN
// pagina's (en ZOEK_MB_RUN_MS), bewaart de cursor (lijst, pagina) en de ruwe pagina's als `c:<lijst>:<pagina>` in de DO-opslag en plant het
// volgende alarm. Pas als alle lijsten binnen zijn wordt de index in KV gezet (en alleen `compleet` als er geen enkele waarschuwing was).
// Een afgebroken of gecrashte run hervat bij de bewaarde cursor (geen dubbele pagina's, nooit een halve index als compleet). Een opbouw
// zonder voortgang van ZOEK_MB_STIL_MS wordt door een nieuwe start overgenomen. Een Moneybird-429 stopt alles direct (pauze = echte Retry-After).
const ZOEK_MB_PAGINAS_PER_RUN = 8, ZOEK_MB_RUN_MS = 15000, ZOEK_MB_STIL_MS = 5 * 60 * 1000, ZOEK_MB_TOTAAL = 80, ZOEK_MB_FOUT_MAX = 3;
export class MtZoekIndex {
  constructor(state, env) { this.state = state; this.env = env || {}; }
  async fetch(request) {
    const op = new URL(request.url).pathname.slice(1);
    const antw = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
    let b = {}; try { b = await request.json(); } catch {}
    if (!['start', 'status'].includes(op)) return antw({ error: 'onbekend' }, 404);
    return await this.state.blockConcurrencyWhile(async () => {
      try {
        const st = this.state.storage, bouw = await st.get('bouw'), nu = Number(b.nu) || Date.now();
        if (op === 'status') return antw({ bezig: !!bouw, cursor: bouw ? { lijst: bouw.L, pagina: bouw.pagina, verzoeken: bouw.verzoeken, waarschuwingen: bouw.warn } : null });
        if (bouw && nu - bouw.ts < ZOEK_MB_STIL_MS) return antw({ ok: false, reden: 'bezig' });
        const pauze = await kvJson(this.env, ZOEK_MB_PAUZE);
        if (pauze && pauze.tot > nu) return antw({ ok: false, reden: 'pauze' });
        if (bouw) await this.opruimen();                                   // vastgelopen opbouw: opnieuw beginnen
        await st.put('bouw', { gestart: nu, ts: nu, L: 0, pagina: 1, verzoeken: 0, warn: 0, fouten: 0 });
        await st.setAlarm(nu);
        return antw({ ok: true });
      } catch (e) { return antw({ error: 'opslag' }, 503); }
    });
  }
  async opruimen() {
    const st = this.state.storage, sl = [...(await st.list({ prefix: 'c:' })).keys()];
    for (let i = 0; i < sl.length; i += 100) await st.delete(sl.slice(i, i + 100));
    await st.delete('bouw');
  }
  async alarm() {
    const st = this.state.storage, env = this.env;
    const b = await st.get('bouw'); if (!b) return;
    // Harde grens: een AbortController breekt elke Moneybird-fetch in deze run af op de deadline (standaard 15 s, ruim onder de limiet van een
    // alarm-run); de lus stopt dan, de cursor wordt bewaard en het volgende alarm gepland. Een hangende fetch kan de run dus nooit blokkeren.
    const t0 = Date.now(), maxP = Number(env.ZOEK_MB_STAP) > 0 ? Number(env.ZOEK_MB_STAP) : ZOEK_MB_PAGINAS_PER_RUN;
    const runMs = Number(env.ZOEK_MB_RUN_MS) > 0 ? Number(env.ZOEK_MB_RUN_MS) : ZOEK_MB_RUN_MS;
    const ac = new AbortController(), dl = setTimeout(() => { try { ac.abort(); } catch {} }, runMs);
    const get = geldMb(env, { rest: maxP + 2 }, { geen429Retry: true, signal: ac.signal });
    const volgende = () => { b.L++; b.pagina = 1; b.fouten = 0; };
    try {
      let gedaan = 0;
      while (b.L < ZOEK_MB_LIJSTEN.length && gedaan < maxP && Date.now() - t0 < runMs) {
        if (b.verzoeken >= ZOEK_MB_TOTAAL) { b.warn++; b.L = ZOEK_MB_LIJSTEN.length; break; }   // totaalbudget op: onvolledig
        const l = ZOEK_MB_LIJSTEN[b.L];
        const r = await get(`${l.pad}?filter=period:${l.periode}&per_page=100&page=${b.pagina}`);
        gedaan++; b.verzoeken++;
        if (!r.ok && r.status === 429) { await this.opruimen(); await zoekMbPauze(env, r.retryAfter > 0 ? r.retryAfter : 60, '429'); return; }   // terminaal
        if (!r.ok || !Array.isArray(r.data)) {
          b.fouten = (b.fouten || 0) + 1;
          const blijvend = r.ok || (r.status >= 400 && r.status < 500);   // onverwacht antwoord of 4xx: niet opnieuw proberen
          if (blijvend || b.fouten >= ZOEK_MB_FOUT_MAX) { b.warn++; volgende(); }
          else { await st.put('bouw', b); await st.setAlarm(Date.now() + 5000); return; }   // tijdelijk (netwerk/5xx): dezelfde pagina opnieuw
          b.ts = Date.now(); await st.put('bouw', b); continue;
        }
        await st.put('c:' + b.L + ':' + String(b.pagina).padStart(2, '0'), r.data.filter(x => x && x.id).map(x => zoekMbItem(l, x)));
        b.fouten = 0;
        if (r.data.length < 100) volgende(); else if (b.pagina >= 20) { b.warn++; volgende(); } else b.pagina++;
        b.ts = Date.now(); await st.put('bouw', b);
      }
      if (b.L >= ZOEK_MB_LIJSTEN.length) {
        const items = []; for (const [, v] of await st.list({ prefix: 'c:' })) items.push(...v);
        zoekMbSorteer(items);
        await zoekMbAfronden(env, { items: items.slice(0, 6000), compleet: b.warn === 0 && items.length <= 6000, fouten: b.warn });
        await this.opruimen();
        return;
      }
      await st.put('bouw', b); await st.setAlarm(Date.now() + 500);
    } catch (e) {   // onverwacht (opslag, KV): de cursor staat in 'bouw'; later opnieuw, na drie keer opgeven
      b.fouten = (b.fouten || 0) + 1;
      try {
        if (b.fouten >= ZOEK_MB_FOUT_MAX) { await this.opruimen(); await zoekMbPauze(env, 120, 'onvolledig'); }
        else { await st.put('bouw', b); await st.setAlarm(Date.now() + 5000); }
      } catch {}
    } finally { clearTimeout(dl); }
  }
}

// ══ SIGNALEN (L3): gedeelde actiewachtrij ═════════════════════════════════════
// Eén wachtrij voor het hele team ("iedereen ziet alles, één persoon pakt het op"). Opslag: de bestaande DO-klasse MtTeller,
// eigen instantie 'signalen' (zoals 'ai' en 'csp'): geserialiseerd, dus "per oorzaak maximaal één item open" is atomair (KV kan dat niet).
//   Item-sleutel  project_id:soort:bronversie:datum   (bronversie = <bron>.<versie>, bv. e123456789.1760000000)
//   Oorzaak       project_id:soort:bron              (zolang er een niet-afgehandeld item is, komt er geen tweede)
//   Statussen     open → opgepakt (wie, wanneer) → afgehandeld;  open/opgepakt → gesnoozed (tot een datum) → open
//                 Een gesnoozed item waarvan de datum bereikt is, telt vanzelf weer als open. Afgehandeld is eindstation: een
//                 nieuwe oorzaak geeft een nieuw item. Dezelfde sleutel komt nooit twee keer (ook niet na afhandelen).
// Rechten (in élke ROLLEN_MODUS, nieuwe routes): zien = recht `offertes` of `projecten`; wijzigen = `offertes: 'wijzigen'` (verkooprecht).
// Audit (DO-logboek `log:`) zonder klantinhoud: alleen tijd, actie, sleutel/soort/project_id, mb_id en een oid-hash.
// Offertekoppelingen (`off:<mb_id>` → project_id) komen alleen via POST /signalen/offertes, dus van een koppeling die een mens in de
// cockpit bevestigde. Een offerte zonder koppeling geeft nooit een signaal (en de worker koppelt nooit zelf).
const SIG_INSTANTIE = 'signalen';
const SIG_SOORTEN = {
  offerte_geaccepteerd: 'Offerte geaccepteerd: markeer gewonnen?',
  offerte_afgewezen: 'Offerte afgewezen: markeer verloren?',
};
const SIG_PID_RE = /^p_[0-9a-z]{4,40}$/;
const SIG_MBID_RE = /^\d{6,25}$/;
const SIG_BRON_RE = /^[0-9A-Za-z_-]{1,40}$/;
const SIG_VERSIE_RE = /^[0-9A-Za-z_-]{1,30}$/;
const SIG_DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;
const SIG_ACTIES = ['oppakken', 'loslaten', 'afhandelen', 'snoozen', 'heropenen'];
const SIG_LOG_MAX = 500, SIG_AFGEHANDELD_DAGEN = 30, SIG_SLEUTEL_DAGEN = 400, SIG_SNOOZE_MAX_DAGEN = 365, SIG_OFF_PER_KEER = 200;
const SIG_OFF_EIND = ['accepted', 'rejected', 'billed', 'archived', 'weg'];   // daarna hoeft de dagelijkse controle niet meer te kijken
const sigAntw = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
// Status zoals de gebruiker hem ziet: een verlopen snooze is weer open.
function sigEffectief(it, vandaag) { return it.status === 'gesnoozed' && !(it.snooze_tot > vandaag) ? 'open' : it.status; }
function sigTelling(items, vandaag) {
  const t = { open: 0, opgepakt: 0, gesnoozed: 0 };
  for (const it of items) { const s = sigEffectief(it, vandaag); if (s in t) t[s]++; }
  return t;
}
// Stub naar de signalen-instantie; null zonder binding.
function sigStub(env, budget) {
  const ns = env.MT_TELLER; if (!ns || !ns.idFromName) return null;
  const stub = ns.get(ns.idFromName(SIG_INSTANTIE));
  return async (op, b) => {
    if (budget && !budget.neem(true, 'do')) throw new Error('subrequest-budget-op');
    const r = await stub.fetch('https://mt-teller/' + op, { method: 'POST', body: JSON.stringify(b || {}) });
    return { status: r.status, j: await r.json().catch(() => null) };
  };
}

// De DO-kant (aangeroepen vanuit MtTeller.fetch voor ops 'sig-*'). Alles binnen blockConcurrencyWhile.
const SigDO = {
  async ops(self, op, b) {
    const st = self.state.storage, nu = Number(b.nu) || Date.now(), vandaag = SIG_DATUM_RE.test(String(b.vandaag || '')) ? b.vandaag : geldVandaag();
    const logZet = (e, w = st) => w.put('log:' + String(9e15 - nu).padStart(16, '0') + ':' + randHex(3), { ts: nu, ...e });
    return await self.state.blockConcurrencyWhile(async () => {
      try {
        if (!(await st.get('sig:instantie'))) await st.put('sig:instantie', 1);   // merkteken: het alarm van deze instantie hoort bij de signalen
        if (op === 'sig-maak') { const r = await SigDO.maak(self, b, nu, logZet); return sigAntw(r.body, r.status); }
        if (op === 'sig-lijst') {
          const items = [...(await st.list({ prefix: 'i:' })).values()];
          const zichtbaar = items.filter(it => it.status !== 'afgehandeld' || (b.met_afgehandeld && nu - ((it.afgehandeld && it.afgehandeld.ts) || 0) < 7 * DAG_S * 1000))
            .map(it => ({ ...it, status_effectief: sigEffectief(it, vandaag) }))
            .sort((x, y) => y.aangemaakt - x.aangemaakt);
          return sigAntw({ items: zichtbaar, telling: sigTelling(items, vandaag), vandaag });
        }
        if (op === 'sig-zet') return await SigDO.zet(self, b, nu, vandaag, logZet);
        if (op === 'sig-off-zet') {
          const zet = (Array.isArray(b.koppelingen) ? b.koppelingen : []).slice(0, SIG_OFF_PER_KEER), weg = (Array.isArray(b.weg) ? b.weg : []).slice(0, SIG_OFF_PER_KEER);
          const schrijf = {}; let gezet = 0, verwijderd = 0;
          for (const k of zet) {
            const mb = String(k.mb_id), oud = (await st.get('off:' + mb)) || null;
            if (oud && oud.project_id === k.project_id) continue;
            schrijf['off:' + mb] = { project_id: k.project_id, staat: oud ? oud.staat : null, gemeld: oud && oud.project_id === k.project_id ? oud.gemeld : null, gecontroleerd: oud ? oud.gecontroleerd : 0, ts: nu, door: b.door };
            gezet++;
          }
          const sl = Object.keys(schrijf);
          for (let i = 0; i < sl.length; i += 100) await st.put(Object.fromEntries(sl.slice(i, i + 100).map(x => [x, schrijf[x]])));
          for (const mb of weg) { if (await st.get('off:' + mb)) { await st.delete('off:' + mb); verwijderd++; } }
          if (gezet || verwijderd) await logZet({ actie: 'offertes-gekoppeld', gezet, verwijderd, door: b.door });
          return sigAntw({ ok: true, gezet, verwijderd });
        }
        if (op === 'sig-off-get') { const k = await st.get('off:' + String(b.mb_id || '')); return sigAntw({ koppeling: k || null }); }
        if (op === 'sig-off-lijst') {   // voor de dagelijkse controle: nog niet in een eindstaat, langst niet gecontroleerd eerst
          const max = Math.max(1, Math.min(100, Number(b.max) || 10));
          const lijst = [...(await st.list({ prefix: 'off:' }))].map(([k, v]) => ({ mb_id: k.slice(4), ...v }))
            .filter(x => !SIG_OFF_EIND.includes(x.staat)).sort((x, y) => (x.gecontroleerd || 0) - (y.gecontroleerd || 0));
          return sigAntw({ items: lijst.slice(0, max), totaal: lijst.length });
        }
        if (op === 'sig-offerte') return await SigDO.offerte(self, b, nu, logZet);
        if (op === 'sig-log') { const n = Math.max(1, Math.min(200, Number(b.limiet) || 50)); return sigAntw({ log: [...(await st.list({ prefix: 'log:', limit: n })).values()] }); }
        if (op === 'sig-opruim') {
          const weg = [];
          for (const [k, it] of await st.list({ prefix: 'i:' })) if (it.status === 'afgehandeld' && nu - ((it.afgehandeld && it.afgehandeld.ts) || nu) > SIG_AFGEHANDELD_DAGEN * DAG_S * 1000) weg.push(k);
          for (const [k, ts] of await st.list({ prefix: 'k:' })) if (nu - Number(ts) > SIG_SLEUTEL_DAGEN * DAG_S * 1000) weg.push(k);
          for (const [k, w] of await st.list({ prefix: 'wh:' })) if (nu - (w.ts || 0) > 30 * DAG_S * 1000) weg.push(k);
          const logs = [...(await st.list({ prefix: 'log:' })).keys()]; if (logs.length > SIG_LOG_MAX) weg.push(...logs.slice(SIG_LOG_MAX));
          for (let i = 0; i < weg.length; i += 100) await st.delete(weg.slice(i, i + 100));
          return sigAntw({ ok: true, opgeruimd: weg.length });
        }
        if (op.startsWith('sig-sub-')) return await PushDO.ops(self, op, b, nu, logZet);   // push-subscriptions (L3b)
        if (op === 'sig-wh-claim' || op === 'sig-wh-klaar' || op === 'sig-wh-wis') {   // idempotentie van de Moneybird-webhook
          const sl = String(b.sleutel || ''); if (!MB_WH_SLEUTEL_RE.test(sl)) return sigAntw({ error: 'ongeldig' }, 400);
          const k = 'wh:' + sl, w = await st.get(k);
          if (op === 'sig-wh-claim') {
            if (w && w.status === 'klaar') return sigAntw({ dubbel: true });
            if (w && w.status === 'bezig' && nu - w.ts < MB_WH_BEZIG_MS) return sigAntw({ bezig: true });
            await st.put(k, { status: 'bezig', ts: nu }); return sigAntw({ nieuw: true });
          }
          if (op === 'sig-wh-klaar') {
            await st.put(k, { status: 'klaar', ts: nu });
            await logZet({ actie: 'webhook', resultaat: String(b.resultaat || '').slice(0, 30), mb_id: SIG_MBID_RE.test(String(b.mb_id || '')) ? String(b.mb_id) : undefined });
            return sigAntw({ ok: true });
          }
          await st.delete(k); return sigAntw({ ok: true });
        }
        return sigAntw({ error: 'onbekend' }, 404);
      } catch (e) { return sigAntw({ error: 'opslag', detail: String((e && e.message) || e).slice(0, 120) }, 503); }
    });
  },
  // Nieuw signaal (binnen het slot). → { status, body:{ ok, nieuw, sleutel, reden } }
  async maak(self, b, nu, logZet) {
    const st = self.state.storage;
    if (!SIG_PID_RE.test(String(b.project_id || '')) || !SIG_SOORTEN[b.soort] || !SIG_BRON_RE.test(String(b.bron || '')) || !SIG_VERSIE_RE.test(String(b.versie || '')) || !SIG_DATUM_RE.test(String(b.datum || '')))
      return { status: 400, body: { error: 'ongeldig-signaal' } };
    const sleutel = `${b.project_id}:${b.soort}:${b.bron}.${b.versie}:${b.datum}`, oorzaak = `${b.project_id}:${b.soort}:${b.bron}`;
    if (await st.get('k:' + sleutel)) return { status: 200, body: { ok: true, nieuw: false, sleutel, reden: 'bestaat' } };
    const open = await st.get('o:' + oorzaak), oudItem = open ? await st.get('i:' + open) : null;
    if (oudItem && oudItem.status !== 'afgehandeld') {
      oudItem.laatste_versie = `${b.bron}.${b.versie}`; oudItem.herhaald = (oudItem.herhaald || 0) + 1;
      await st.put({ ['i:' + open]: oudItem, ['k:' + sleutel]: nu });
      await logZet({ actie: 'signaal-samengevoegd', sleutel: open, soort: b.soort, project_id: b.project_id, via: b.via });
      return { status: 200, body: { ok: true, nieuw: false, sleutel: open, reden: 'oorzaak-open' } };
    }
    const item = { sleutel, oorzaak, project_id: b.project_id, soort: b.soort, titel: SIG_SOORTEN[b.soort], bron: b.bron, versie: String(b.versie), datum: b.datum,
      mb_id: SIG_MBID_RE.test(String(b.mb_id || '')) ? String(b.mb_id) : undefined, status: 'open', aangemaakt: nu, gewijzigd: nu, via: b.via || 'systeem' };
    await st.put({ ['i:' + sleutel]: item, ['o:' + oorzaak]: sleutel, ['k:' + sleutel]: nu });
    await logZet({ actie: 'signaal-nieuw', sleutel, soort: b.soort, project_id: b.project_id, mb_id: item.mb_id, via: item.via });
    await PushDO.plan(self, nu);   // push (L3b): gebundeld, buiten de stille uren
    return { status: 200, body: { ok: true, nieuw: true, sleutel } };
  },
  // Statusovergang door een gebruiker (binnen het slot).
  async zet(self, b, nu, vandaag, logZet) {
    const st = self.state.storage, sleutel = String(b.sleutel || ''), it = await st.get('i:' + sleutel);
    if (!it) return sigAntw({ error: 'onbekend-signaal' }, 404);
    const eff = sigEffectief(it, vandaag), ik = { oid: String(b.oid || ''), naam: String(b.naam || '').slice(0, 80), ts: nu };
    const vanMij = it.opgepakt && it.opgepakt.oid === ik.oid, vanAnder = eff === 'opgepakt' && !vanMij;
    const weiger = (error, extra) => sigAntw({ error, status: eff, ...(extra || {}) }, 409);
    if (eff === 'afgehandeld') return b.actie === 'afhandelen' ? sigAntw({ ok: true, gewijzigd: false, item: it }) : weiger('afgehandeld');
    if (vanAnder && b.actie !== 'oppakken') return weiger('opgepakt-door-ander', { door: it.opgepakt.naam });
    const nieuw = { ...it, gewijzigd: nu };
    if (b.actie === 'oppakken') {
      if (eff === 'opgepakt') return vanMij ? sigAntw({ ok: true, gewijzigd: false, item: it }) : weiger('al-opgepakt', { door: it.opgepakt.naam });
      Object.assign(nieuw, { status: 'opgepakt', opgepakt: ik }); delete nieuw.snooze_tot;
    } else if (b.actie === 'loslaten') {
      if (eff !== 'opgepakt') return weiger('ongeldige-overgang');
      nieuw.status = 'open'; delete nieuw.opgepakt;
    } else if (b.actie === 'afhandelen') {
      Object.assign(nieuw, { status: 'afgehandeld', afgehandeld: ik }); delete nieuw.snooze_tot;
    } else if (b.actie === 'snoozen') {
      const tot = String(b.tot || '');
      if (!SIG_DATUM_RE.test(tot) || !(tot > vandaag) || tot > geldDag(vandaag, SIG_SNOOZE_MAX_DAGEN)) return sigAntw({ error: 'ongeldige-datum', uitleg: 'tot: een datum na vandaag, hooguit een jaar vooruit' }, 400);
      Object.assign(nieuw, { status: 'gesnoozed', snooze_tot: tot, gesnoozed: ik }); delete nieuw.opgepakt;
    } else if (b.actie === 'heropenen') {
      if (eff !== 'gesnoozed' && !(it.status === 'gesnoozed')) return weiger('ongeldige-overgang');
      nieuw.status = 'open'; delete nieuw.snooze_tot;
    } else return sigAntw({ error: 'ongeldige-actie' }, 400);
    const schrijf = { ['i:' + sleutel]: nieuw };
    await st.put(schrijf);
    if (nieuw.status === 'afgehandeld' && (await st.get('o:' + it.oorzaak)) === sleutel) await st.delete('o:' + it.oorzaak);
    await logZet({ actie: 'signaal-' + b.actie, sleutel, soort: it.soort, project_id: it.project_id, door: b.door, tot: nieuw.snooze_tot });
    return sigAntw({ ok: true, gewijzigd: true, item: { ...nieuw, status_effectief: sigEffectief(nieuw, vandaag) } });
  },
  // Geverifieerde Moneybird-offertestaat verwerken (webhook of dagelijkse controle): staat bijwerken en, alleen bij accepted/rejected
  // én een bevestigde koppeling, één signaal. `gemeld` onthoudt de laatst gemelde staat per offerte: dezelfde overgang twee keer
  // (webhook + controle, of een latere wijziging aan een al geaccepteerde offerte) geeft geen tweede signaal.
  async offerte(self, b, nu, logZet) {
    const st = self.state.storage, mb = String(b.mb_id || '');
    if (!SIG_MBID_RE.test(mb)) return sigAntw({ error: 'ongeldig' }, 400);
    const off = await st.get('off:' + mb);
    if (!off) { await logZet({ actie: 'offerte-onbekend', mb_id: mb, via: b.via }); return sigAntw({ ok: true, nieuw: false, reden: 'onbekend' }); }
    const staat = String(b.staat || '').slice(0, 20);
    off.staat = staat; off.gecontroleerd = nu;
    if (off.gemeld && off.gemeld.staat !== staat) off.gemeld = null;   // terug naar open e.d.: een volgende acceptatie mag weer gemeld worden
    let uit = { ok: true, nieuw: false, reden: 'geen-signaal', staat };
    const soort = staat === 'accepted' ? 'offerte_geaccepteerd' : staat === 'rejected' ? 'offerte_afgewezen' : null;
    if (soort && off.gemeld && off.gemeld.staat === staat) uit.reden = 'al-gemeld';
    else if (soort) {
      const r = await SigDO.maak(self, { project_id: off.project_id, soort, bron: 'e' + mb, versie: b.versie, datum: b.datum, mb_id: mb, via: b.via }, nu, logZet);
      if (r.status !== 200) return sigAntw(r.body, r.status);
      off.gemeld = { staat, ts: nu, sleutel: r.body.sleutel };
      uit = { ...r.body, staat };
    }
    await st.put('off:' + mb, off);
    return sigAntw(uit);
  },
};

// Routes /signalen/* (en straks /push/*). Achter de MS-auth; rechten in élke modus.
async function handleSignalen(p, request, env, ik, json) {
  const R = ik.rol ? RECHTEN[ik.rol] : null, m = request.method;
  const zien = !!(R && (R.offertes || R.projecten)), wijzigen = !!(R && R.offertes === 'wijzigen');
  if (!zien) return json({ error: 'geen-toegang', reden: R ? 'offertes' : (ik.reden || 'geen-rol') }, 403);
  if (p.startsWith('/push/')) return await handlePush(p, request, env, ik, json, R);
  const doe = sigStub(env);
  if (!doe) return json({ error: 'geen-signalen-opslag', uitleg: 'Durable Object-binding MT_TELLER ontbreekt (zie wrangler.toml)' }, 503);
  const leesBody = async () => { const t = await geldLeesMax(request, 64 * KB); if (t == null) return { fout: 413 }; try { const j = JSON.parse(t || '{}'); return j && typeof j === 'object' && !Array.isArray(j) ? { j } : { fout: 400 }; } catch { return { fout: 400 }; } };
  if (p === '/signalen' && m === 'GET') {
    const r = await doe('sig-lijst', { met_afgehandeld: new URL(request.url).searchParams.get('afgehandeld') === '1' });
    return json(r.j, r.status);
  }
  if (p === '/signalen/log' && m === 'GET') {
    if (!R.beheer) return json({ error: 'geen-toegang', reden: 'beheer' }, 403);
    const r = await doe('sig-log', { limiet: Number(new URL(request.url).searchParams.get('limiet')) || 50 }); return json(r.j, r.status);
  }
  if (m !== 'POST' || !['/signalen/actie', '/signalen/offertes'].includes(p)) return json({ error: 'onbekende-route' }, 404);
  if (!wijzigen) return json({ error: 'geen-toegang', reden: 'offertes-wijzigen' }, 403);
  const { j: b, fout } = await leesBody(); if (fout) return json({ error: fout === 413 ? 'te-groot' : 'ongeldige-json' }, fout);
  const door = await oidHash(ik.oid);
  if (p === '/signalen/actie') {
    if (!SIG_ACTIES.includes(b.actie) || typeof b.sleutel !== 'string' || b.sleutel.length > 200) return json({ error: 'ongeldig', uitleg: 'sleutel en actie (' + SIG_ACTIES.join(', ') + ') verplicht' }, 400);
    const r = await doe('sig-zet', { sleutel: b.sleutel, actie: b.actie, tot: b.tot, oid: ik.oid, naam: clip((ik.rec && ik.rec.naam) || ik.email || '', 80), door });
    return json(r.j, r.status);
  }
  // /signalen/offertes: door een mens bevestigde koppelingen offerte (mb_id) → project_id doorgeven (of weghalen).
  const zet = Array.isArray(b.koppelingen) ? b.koppelingen : [], weg = Array.isArray(b.weg) ? b.weg : [];
  if (!zet.length && !weg.length) return json({ error: 'ongeldig', uitleg: 'koppelingen [{project_id, mb_id}] en/of weg [mb_id]' }, 400);
  if (zet.length > SIG_OFF_PER_KEER || weg.length > SIG_OFF_PER_KEER) return json({ error: 'te-veel', max: SIG_OFF_PER_KEER }, 400);
  if (!zet.every(k => k && SIG_PID_RE.test(String(k.project_id || '')) && SIG_MBID_RE.test(String(k.mb_id || ''))) || !weg.every(x => SIG_MBID_RE.test(String(x))))
    return json({ error: 'ongeldig', uitleg: 'project_id p_… en mb_id (cijfers)' }, 400);
  const r = await doe('sig-off-zet', { koppelingen: zet.map(k => ({ project_id: String(k.project_id), mb_id: String(k.mb_id) })), weg: weg.map(String), door });
  return json(r.j, r.status);
}

// ── Moneybird-webhook (L3): POST /mb/webhook ─────────────────────────────────────
// Server-naar-server, vóór de MS-auth en zonder CORS. Volgorde:
//  1. Handtekening (developer.moneybird.com/webhooks/verifying-signatures): header `Moneybird-Signature: t=<epoch s>,v1=<hex>`,
//     v1 = HMAC-SHA256(geheim, "<t>.<ruwe body>") over de exacte bytes; één van de v1-waarden moet kloppen (constant-time) en t mag
//     hooguit 5 minuten afwijken. Geheim = worker-secret MB_WEBHOOK_SECRET (bij rotatie tijdelijk ook MB_WEBHOOK_SECRET_VORIG).
//     Zonder geheim: 503 (nooit open). Fout → 401.
//     Vóór het lezen van de body: een ontbrekende, te lange, slecht gevormde of verlopen header → 401, Content-Length boven MB_WH_MAX → 413,
//     en een rate-limit per IP (429; de binding MB_WEBHOOK_LIMIET als die er is, anders een teller per isolate). Zo kost rommel geen body-lezen.
//  2. Idempotentie: ALTIJD de SHA-256 van de ruwe body (die door de HMAC gedekt is) in de signalen-DO; de niet-gesigneerde header
//     `Idempotency-Key` telt niet mee (een replay met een andere header is dus ook dubbel). Een herhaalde levering = 200, niets gedaan.
//  3. Alleen offertes (entity_type Estimate) van onze administratie, en alleen als de offerte een bevestigde koppeling heeft (POST
//     /signalen/offertes). Dan een read-only GET estimates/{id}: de staat uit de payload wordt nooit vertrouwd.
//  4. accepted/rejected → één signaal "markeer gewonnen/verloren?". Nooit een MB-write, nooit zelf koppelen, nooit een fase wijzigen.
// 200 bij alles wat verwerkt of bewust genegeerd is (anders herhaalt Moneybird tot 10 keer); 503 bij een tijdelijke fout (Moneybird of
// opslag): de claim wordt dan vrijgegeven, zodat de herhaling van Moneybird het opnieuw doet.
const MB_WH_MAX = 64 * KB, MB_WH_TOLERANTIE_S = 300, MB_WH_BEZIG_MS = 2 * 60 * 1000, MB_WH_KOP_MAX = 600, MB_WH_PER_MIN = 60;
const MB_WH_SLEUTEL_RE = /^h[0-9a-f]{64}$/;
const sigLog = o => { try { console.log(JSON.stringify(Object.assign({ sig: true }, o))); } catch {} };
const hexVan = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function leesRuw(request, max) {   // de exacte bytes (nodig voor de handtekening); null als het te groot is
  const cl = Number(request.headers.get('Content-Length'));
  if (isFinite(cl) && cl > max) return null;
  if (!request.body) return new Uint8Array(0);
  const r = request.body.getReader(), delen = []; let n = 0;
  for (;;) {
    const { done, value } = await r.read(); if (done) break;
    n += value.byteLength; if (n > max) { try { await r.cancel(); } catch {} return null; }
    delen.push(value);
  }
  const buf = new Uint8Array(n); let o = 0; for (const d of delen) { buf.set(d, o); o += d.byteLength; }
  return buf;
}
function gelijkTijd(a, b) { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }
// De header ontleden en de tijd toetsen (zonder de body) → { ts, v1: [...] } of null.
function mbHandtekeningKop(kop, nu) {
  if (!kop || kop.length > MB_WH_KOP_MAX) return null;
  let ts = null; const v1 = [];
  for (const deel of String(kop).split(',')) {
    const i = deel.indexOf('='); if (i < 0) return null;
    const k = deel.slice(0, i).trim(), v = deel.slice(i + 1).trim();
    if (k === 't') { if (ts != null) return null; ts = v; }
    else if (k === 'v1') { if (!/^[0-9a-fA-F]{64}$/.test(v) || v1.length >= 4) return null; v1.push(v.toLowerCase()); }
  }
  if (!/^\d{1,12}$/.test(ts || '') || !v1.length) return null;
  if (Math.abs(nu / 1000 - Number(ts)) > MB_WH_TOLERANTIE_S) return null;
  return { ts, v1 };
}
// Rate-limit per IP vóór het lezen van de body. Met de (optionele) Cloudflare-binding MB_WEBHOOK_LIMIET (zie wrangler.toml) over alle
// datacenters; zonder binding een eenvoudige teller per isolate (MB_WH_PER_MIN per minuut). Moneybird zelf komt hier nooit in de buurt.
const _whIp = new Map();
async function mbWebhookTeVaak(request, env) {
  const ip = String(request.headers.get('CF-Connecting-IP') || 'onbekend').slice(0, 64);
  const b = env.MB_WEBHOOK_LIMIET;
  if (b && typeof b.limit === 'function') { try { const r = await b.limit({ key: 'mbwh:' + ip }); return !(r && r.success); } catch { /* terugval hieronder */ } }
  const nu = Date.now(), w = (_whIp.get(ip) || []).filter(x => nu - x < 60000);
  if (w.length >= MB_WH_PER_MIN) { _whIp.set(ip, w); return true; }
  w.push(nu); if (_whIp.size > 5000) _whIp.clear(); _whIp.set(ip, w);
  return false;
}
async function mbHandtekeningOk(kopInfo, ruw, geheimen) {
  if (!kopInfo) return false;
  const { ts, v1 } = kopInfo;
  const voor = new TextEncoder().encode(ts + '.'), data = new Uint8Array(voor.length + ruw.length); data.set(voor, 0); data.set(ruw, voor.length);
  for (const g of geheimen) {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(g), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const h = hexVan(await crypto.subtle.sign('HMAC', k, data));
    if (v1.some(v => gelijkTijd(v, h))) return true;
  }
  return false;
}
// Read-only: één offerte ophalen. → { e } of { weg: true }; gooit bij een tijdelijke fout.
async function sigMbOfferte(env, mbId, budget) {
  if (budget && !budget.neem(false, 'mb')) throw new Error('subrequest-budget-op');
  const r = await fetch(`https://moneybird.com/api/v2/${MB_ADMIN}/estimates/${mbId}.json`, { method: 'GET', headers: { 'Authorization': `Bearer ${env.MONEYBIRD_KEY}`, 'Accept': 'application/json' } });
  if (r.status === 404) return { weg: true };
  if (!r.ok) throw new Error('moneybird-' + r.status);
  const e = await r.json().catch(() => null);
  if (!e || String(e.id) !== String(mbId)) throw new Error('moneybird-antwoord');
  return { e };
}
// Staat + een vaste versie/datum van de overgang (het moment van accepteren/afwijzen), zodat webhook en dagelijkse controle dezelfde sleutel maken.
function sigOfferteStaat(e) {
  const staat = String(e.state || '').slice(0, 20);
  const moment = (staat === 'accepted' ? e.accepted_at : staat === 'rejected' ? e.rejected_at : null) || e.updated_at || null;
  const ms = Date.parse(moment || '');
  const versie = isFinite(ms) ? String(Math.floor(ms / 1000)) : /^\d{1,20}$/.test(String(e.version || '')) ? String(e.version) : '0';
  const datum = isFinite(ms) ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)) : geldVandaag();
  return { staat, versie, datum };
}
async function mbWebhook(request, env) {
  const antw = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return antw({ error: 'methode' }, 405);
  const geheimen = [env.MB_WEBHOOK_SECRET, env.MB_WEBHOOK_SECRET_VORIG].map(x => String(x || '').trim()).filter(Boolean);
  if (!geheimen.length) return antw({ error: 'niet-ingericht' }, 503);
  if (await mbWebhookTeVaak(request, env)) { sigLog({ webhook: 'te-vaak' }); return antw({ error: 'te-vaak' }, 429); }
  // Alles wat zonder de body te toetsen is, eerst (de body wordt pas gelezen als de header klopt en de lengte past).
  const kopInfo = mbHandtekeningKop(request.headers.get('Moneybird-Signature'), Date.now());
  if (!kopInfo) { sigLog({ webhook: 'handtekening', stap: 'kop' }); return antw({ error: 'handtekening' }, 401); }
  const cl = request.headers.get('Content-Length');
  if (cl != null && cl !== '' && !(Number(cl) <= MB_WH_MAX)) return antw({ error: 'te-groot' }, 413);
  const ruw = await leesRuw(request, MB_WH_MAX);
  if (!ruw) return antw({ error: 'te-groot' }, 413);
  if (!(await mbHandtekeningOk(kopInfo, ruw, geheimen))) { sigLog({ webhook: 'handtekening' }); return antw({ error: 'handtekening' }, 401); }
  let p = null; try { p = JSON.parse(new TextDecoder().decode(ruw)); } catch {}
  const negeer = reden => { sigLog({ webhook: 'genegeerd', reden }); return antw({ ok: true, genegeerd: reden }); };
  if (!p || typeof p !== 'object' || Array.isArray(p)) return negeer('json');
  if (String(p.administration_id || '') !== MB_ADMIN) return negeer('administratie');
  if (String(p.entity_type || '') !== 'Estimate') return negeer('geen-offerte');
  const mbId = String(p.entity_id || '');
  if (!SIG_MBID_RE.test(mbId)) return negeer('id');
  const doe = sigStub(env);
  if (!doe) return antw({ error: 'geen-opslag' }, 503);
  // Idempotentie altijd op de gesigneerde body; de header Idempotency-Key alleen in de log (ingekort, nooit als sleutel).
  const idem = 'h' + hexVan(await crypto.subtle.digest('SHA-256', ruw));
  const kopIdem = String(request.headers.get('Idempotency-Key') || '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 40);
  const c = await doe('sig-wh-claim', { sleutel: idem });
  if (c.status !== 200 || !c.j) return antw({ error: 'opslag' }, 503);
  if (c.j.dubbel) { sigLog({ webhook: 'dubbel', kop: kopIdem || undefined }); return antw({ ok: true, dubbel: true }); }
  if (c.j.bezig) return antw({ error: 'bezig' }, 503);
  try {
    const k = await doe('sig-off-get', { mb_id: mbId });
    if (k.status !== 200 || !k.j) throw new Error('opslag');
    let uit;
    if (!k.j.koppeling) uit = { resultaat: 'onbekend' };          // geen bevestigde koppeling: geen GET, geen signaal
    else {
      const g = await sigMbOfferte(env, mbId);
      if (g.weg) uit = { resultaat: 'niet-gevonden' };
      else {
        const s = sigOfferteStaat(g.e), r = await doe('sig-offerte', { mb_id: mbId, ...s, via: 'webhook' });
        if (r.status !== 200 || !r.j) throw new Error('opslag');
        uit = { resultaat: r.j.nieuw ? 'signaal' : r.j.reden, staat: s.staat };
      }
    }
    await doe('sig-wh-klaar', { sleutel: idem, resultaat: uit.resultaat, mb_id: mbId });
    return antw({ ok: true, ...uit });
  } catch (e) {
    sigLog({ webhook: 'tijdelijk', fout: String((e && e.message) || e).slice(0, 80) });
    try { await doe('sig-wh-wis', { sleutel: idem }); } catch {}
    return antw({ error: 'tijdelijk' }, 503);
  }
}

// ── Dagelijkse controle (L3): gemiste webhooks opvangen ─────────────────────────────
// Eigen cron-expressie (SIG_REC_CRON, ook in wrangler.toml [triggers]); NIET in koersCron (die heeft een vol subrequest-budget). De
// scheduled-handler splitst op event.cron: alleen deze expressie komt hier, alle andere triggers gaan zoals altijd naar de Koersmeter.
// Eigen budget: SIG_REC_BUDGET subrequests per run (DO-aanroepen + Moneybird-GET's). Per run de offertes met een bevestigde koppeling die
// nog niet in een eindstaat zijn, langst niet gecontroleerd eerst; per offerte één read-only GET en één DO-aanroep. Wat niet past, komt
// de volgende dag aan de beurt. Signalen ontstaan precies zoals bij de webhook (zelfde sleutel, dus nooit dubbel). Daarna opruimen.
const SIG_REC_CRON = '45 4 * * *', SIG_REC_BUDGET = 30;
async function sigReconciliatie(env) {
  const budget = koersBudget(SIG_REC_BUDGET, 0), doe = sigStub(env, budget);
  if (!doe) { sigLog({ controle: 'geen-opslag' }); return { status: 'geen-opslag' }; }
  if (!env.MONEYBIRD_KEY) { sigLog({ controle: 'geen-mb-sleutel' }); return { status: 'geen-mb-sleutel' }; }
  const n = Math.floor((SIG_REC_BUDGET - 2) / 2);                      // 1 voor de lijst, 1 voor het opruimen, 2 per offerte
  const l = await doe('sig-off-lijst', { max: n });
  if (l.status !== 200 || !l.j) { sigLog({ controle: 'fout', stap: 'lijst' }); return { status: 'fout' }; }
  const uit = { status: 'klaar', gecontroleerd: 0, signalen: 0, fouten: 0, rest: Math.max(0, (l.j.totaal || 0) - l.j.items.length) };
  for (const x of l.j.items) {
    if (budget.rest() < 3) { uit.status = 'budget'; break; }            // GET + DO + het opruimen moeten nog passen
    try {
      const g = await sigMbOfferte(env, x.mb_id, budget);
      const s = g.weg ? { staat: 'weg', versie: '0', datum: geldVandaag() } : sigOfferteStaat(g.e);
      const r = await doe('sig-offerte', { mb_id: x.mb_id, ...s, via: 'controle' });
      if (r.status !== 200) throw new Error('opslag');
      uit.gecontroleerd++; if (r.j && r.j.nieuw) uit.signalen++;
    } catch (e) {
      uit.fouten++;
      if (/budget|moneybird-429/.test(String(e && e.message))) { uit.status = 'gestopt'; break; }   // rate-limit of budget op: morgen verder
    }
  }
  try { await doe('sig-opruim', {}); } catch {}
  sigLog({ controle: uit.status, ...uit, subrequests: budget.n });
  return uit;
}

// ══ WEB-PUSH (L3b) ═════════════════════════════════════════════════════════════
// Een algemene pushmelding op de telefoon als er nieuwe signalen zijn. NOOIT klantnaam, bedrag, nummer of project in de melding: de tekst
// is altijd "M&T: N acties vragen aandacht"; de details staan pas na inloggen in de app.
//   Sleutels: VAPID_PUBLIC (base64url, 65 bytes ongecomprimeerd P-256) en VAPID_PRIVATE (base64url, 32 bytes `d`), allebei als worker-secret
//   (de publieke mag ook een var zijn); optioneel VAPID_SUBJECT (https:// of mailto:). Zonder sleutels: /push/sleutel en /push/aanmelden
//   geven 503 en er wordt niets verstuurd. Aanmaken: zie wrangler.toml (instructie; niet door Claude uitgevoerd).
//   Subscriptions per gebruiker en per apparaat: DO-sleutel `s:<oid>:<sha256(endpoint)[:32]>` in de signalen-instantie; hooguit
//   PUSH_SUBS_PER_GEBRUIKER per gebruiker (de oudste valt af). Alleen endpoints van de bekende pushdiensten (geen willekeurige URL's).
//   Aanmelden alleen met verkooprecht (`offertes`); bij het versturen wordt de rol opnieuw gecontroleerd (geen recht meer = subscription weg).
//   De pushdienst zegt 404/410 → subscription opgeruimd.
//   Encryptie: RFC 8291 (aes128gcm, ECDH P-256 + HKDF + AES-128-GCM) en VAPID (RFC 8292, ES256-JWT), alles via WebCrypto.
//   Bundeling en stille uren (alleen voor push; de lijst in de app toont alles meteen): een nieuw signaal zet een DO-alarm op
//   max(nu + 1 min, vorige push + 15 min), en nooit tussen PUSH_STIL_VAN en PUSH_STIL_TOT (Europe/Amsterdam): dan op het eind van de stille uren.
const PUSH_BUNDEL_MS = 15 * 60 * 1000, PUSH_VERZAMEL_MS = 60 * 1000, PUSH_STIL_VAN = 21, PUSH_STIL_TOT = 7;
const PUSH_SUBS_PER_GEBRUIKER = 10, PUSH_MAX_SUBS = 200, PUSH_TTL_S = 24 * 3600, PUSH_URL = 'mobiel.html';
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];
const PUSH_HASH_RE = /^[0-9a-f]{32}$/;
const PUSH_OID_RE = /^[0-9a-fA-F-]{36}$/;
function pushTekst(n) { return `M&T: ${n} ${n === 1 ? 'actie vraagt' : 'acties vragen'} aandacht`; }
function pushStil(ms) { const u = amsterdamTijd(ms).uur; return PUSH_STIL_VAN > PUSH_STIL_TOT ? (u >= PUSH_STIL_VAN || u < PUSH_STIL_TOT) : (u >= PUSH_STIL_VAN && u < PUSH_STIL_TOT); }
function pushNaStil(ms) { let x = ms; for (let i = 0; i < 96 && pushStil(x); i++) x += 15 * 60 * 1000; return x; }
function pushEndpointOk(e) {
  try { const s = String(e || ''), u = new URL(s); return s.length <= 1024 && u.protocol === 'https:' && !u.port && !u.username && PUSH_HOSTS.some(r => r.test(u.hostname)); } catch { return false; }
}
const b64uVan = bytes => { const b = new Uint8Array(bytes); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const b64uNaar = s => { try { return /^[A-Za-z0-9_-]+={0,2}$/.test(String(s || '')) ? b64urlDecode(String(s).replace(/=+$/, '')) : null; } catch { return null; } };
const bytesSamen = (...delen) => { const n = delen.reduce((a, d) => a + d.length, 0), uit = new Uint8Array(n); let o = 0; for (const d of delen) { uit.set(d, o); o += d.length; } return uit; };
function pushPubliek(env) {
  const k = String((env && env.VAPID_PUBLIC) || '').trim(), b = b64uNaar(k);
  return b && b.length === 65 && b[0] === 4 && String(env.VAPID_PRIVATE || '').trim() ? k : null;
}
let _vapid = null;
async function pushVapid(env) {
  const pub = pushPubliek(env); if (!pub) return null;
  const d = String(env.VAPID_PRIVATE).trim();
  if (_vapid && _vapid.pub === pub && _vapid.d === d) return _vapid;
  const b = b64uNaar(pub);
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64uVan(b.slice(1, 33)), y: b64uVan(b.slice(33, 65)), d, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  _vapid = { pub, d, key };
  return _vapid;
}
async function pushVapidKop(v, endpoint, env, nu) {
  const enc = x => b64uVan(new TextEncoder().encode(JSON.stringify(x)));
  const onder = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: new URL(endpoint).origin, exp: Math.floor(nu / 1000) + 12 * 3600, sub: String(env.VAPID_SUBJECT || 'https://mortiseandtenon.nl') });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, new TextEncoder().encode(onder));   // WebCrypto geeft r||s (64 bytes), precies wat ES256 vraagt
  return `vapid t=${onder}.${b64uVan(sig)}, k=${v.pub}`;
}
// RFC 8291: één record, aes128gcm. → body (salt | rs | idlen | keyid | ciphertext).
async function pushVersleutel(tekst, p256dh, auth) {
  const S = crypto.subtle, uaPub = b64uNaar(p256dh), geheim = b64uNaar(auth);
  if (!uaPub || uaPub.length !== 65 || uaPub[0] !== 4 || !geheim || geheim.length !== 16) throw new Error('ongeldige-sleutels');
  const eph = await S.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await S.exportKey('raw', eph.publicKey));
  const uaKey = await S.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await S.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const hkdf = async (salt, ikm, info, len) => new Uint8Array(await S.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await S.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), len * 8));
  const te = x => new TextEncoder().encode(x);
  const ikm = await hkdf(geheim, ecdh, bytesSamen(te('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te('Content-Encoding: nonce\0'), 12);
  const ct = new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv: nonce }, await S.importKey('raw', cek, 'AES-GCM', false, ['encrypt']), bytesSamen(te(tekst), new Uint8Array([2]))));
  const kop = new Uint8Array(21); kop.set(salt, 0); new DataView(kop.buffer).setUint32(16, 4096); kop[20] = 65;
  return bytesSamen(kop, asPub, ct);
}
async function pushStuur(env, v, sub, tekst, nu) {
  const body = await pushVersleutel(tekst, sub.p256dh, sub.auth);
  const r = await fetch(sub.endpoint, { method: 'POST', body, headers: { 'Authorization': await pushVapidKop(v, sub.endpoint, env, nu), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', 'TTL': String(PUSH_TTL_S), 'Urgency': 'normal' } });
  return r.status;
}
// Mag deze gebruiker (nog) meldingen krijgen? true / false / null (onbekend: KV-fout → deze keer overslaan, niet weggooien).
async function pushMag(env, oid) {
  if (vasteEigenaar(env, oid, null)) return true;
  if (!env.MT_ROLLEN) return false;
  let rec; try { const v = await env.MT_ROLLEN.get('user:' + oid); rec = v ? JSON.parse(v) : null; } catch { return null; }
  return !!(rec && rec.active !== false && ROLLEN.includes(rec.role) && RECHTEN[rec.role].offertes);
}
// DO-kant van push (signalen-instantie).
const PushDO = {
  async ops(self, op, b, nu, logZet) {
    const st = self.state.storage, oid = String(b.oid || ''), hash = String(b.hash || '');
    if (!PUSH_OID_RE.test(oid)) return sigAntw({ error: 'ongeldig' }, 400);
    if (op === 'sig-sub-status') return sigAntw({ apparaten: (await st.list({ prefix: 's:' + oid + ':' })).size });
    if (!PUSH_HASH_RE.test(hash)) return sigAntw({ error: 'ongeldig' }, 400);
    const k = 's:' + oid + ':' + hash;
    if (op === 'sig-sub-zet') {
      if (!pushEndpointOk(b.endpoint) || !b64uNaar(b.p256dh) || !b64uNaar(b.auth)) return sigAntw({ error: 'ongeldig' }, 400);
      const bestaand = await st.get(k), eigen = [...(await st.list({ prefix: 's:' + oid + ':' }))].filter(([x]) => x !== k).sort(([, x], [, y]) => (x.ts || 0) - (y.ts || 0));
      const teVeel = eigen.length - (PUSH_SUBS_PER_GEBRUIKER - 1);
      if (teVeel > 0) await st.delete(eigen.slice(0, teVeel).map(([x]) => x));
      await st.put(k, { endpoint: String(b.endpoint), p256dh: String(b.p256dh), auth: String(b.auth), ts: nu });
      if (!bestaand) await logZet({ actie: 'push-aangemeld', door: b.door });
      return sigAntw({ ok: true, nieuw: !bestaand, apparaten: Math.min(eigen.length, PUSH_SUBS_PER_GEBRUIKER - 1) + 1 });
    }
    if (op === 'sig-sub-weg') {
      const was = !!(await st.get(k)); if (was) { await st.delete(k); await logZet({ actie: 'push-afgemeld', door: b.door }); }
      return sigAntw({ ok: true, verwijderd: was });
    }
    return sigAntw({ error: 'onbekend' }, 404);
  },
  // Na een nieuw signaal (binnen het slot): bundelen en stille uren respecteren via het DO-alarm.
  async plan(self, nu) {
    const st = self.state.storage;
    if (!(await st.list({ prefix: 's:', limit: 1 })).size) return;            // niemand aangemeld: niets te plannen
    const p = (await st.get('p:stand')) || { laatst: 0 };
    if (!p.wachtend) { p.wachtend = true; await st.put('p:stand', p); }
    const tijd = pushNaStil(Math.max(nu + PUSH_VERZAMEL_MS, (p.laatst || 0) + PUSH_BUNDEL_MS));
    const huidig = await st.getAlarm();
    if (huidig == null || huidig > tijd) await st.setAlarm(tijd);
  },
  // Het alarm: één algemene melding met het aantal open acties naar alle aangemelde apparaten (buiten het slot versturen).
  async alarm(self, nu = Date.now()) {
    const st = self.state.storage;
    const plan = await self.state.blockConcurrencyWhile(async () => {
      const p = (await st.get('p:stand')) || {};
      if (!p.wachtend) return null;
      if (pushStil(nu)) { await st.setAlarm(pushNaStil(nu)); return null; }
      if (p.laatst && nu - p.laatst < PUSH_BUNDEL_MS) { await st.setAlarm(p.laatst + PUSH_BUNDEL_MS); return null; }
      const n = sigTelling([...(await st.list({ prefix: 'i:' })).values()], geldVandaag()).open;
      const subs = n ? [...(await st.list({ prefix: 's:' }))].slice(0, PUSH_MAX_SUBS) : [];
      await st.put('p:stand', { laatst: subs.length ? nu : (p.laatst || 0), wachtend: false });
      return subs.length ? { n, subs } : null;
    });
    if (!plan) return { verstuurd: 0 };
    const env = self.env || {}, v = await pushVapid(env).catch(() => null);
    const log = e => self.state.blockConcurrencyWhile(() => st.put('log:' + String(9e15 - nu).padStart(16, '0') + ':' + randHex(3), { ts: nu, ...e }));
    if (!v) { await log({ actie: 'push', resultaat: 'niet-ingericht', n: plan.n }); return { verstuurd: 0 }; }
    const tekst = JSON.stringify({ titel: 'M&T', tekst: pushTekst(plan.n), n: plan.n, url: PUSH_URL });
    const weg = [], mag = new Map(); let verstuurd = 0, fouten = 0;
    for (const [k, s] of plan.subs) {
      const oid = k.split(':')[1];
      if (!mag.has(oid)) mag.set(oid, await pushMag(env, oid));
      if (mag.get(oid) === false) { weg.push(k); continue; }
      if (mag.get(oid) == null) continue;
      try { const status = await pushStuur(env, v, s, tekst, nu); if (status === 404 || status === 410) weg.push(k); else if (status >= 200 && status < 300) verstuurd++; else fouten++; }
      catch { fouten++; }
    }
    if (weg.length) await self.state.blockConcurrencyWhile(() => st.delete(weg));
    await log({ actie: 'push', n: plan.n, verstuurd, opgeruimd: weg.length, fouten });
    return { verstuurd, opgeruimd: weg.length, fouten };
  },
};
// Routes /push/* (via handleSignalen: wie de signalen mag zien). Aanmelden alleen met verkooprecht.
async function handlePush(p, request, env, ik, json, R) {
  const m = request.method;
  if (p === '/push/sleutel' && m === 'GET') {
    const k = pushPubliek(env);
    return k ? json({ publicKey: k }) : json({ error: 'push-niet-ingericht', uitleg: 'VAPID_PUBLIC en VAPID_PRIVATE ontbreken (zie wrangler.toml)' }, 503);
  }
  const doe = sigStub(env);
  if (!doe) return json({ error: 'geen-signalen-opslag', uitleg: 'Durable Object-binding MT_TELLER ontbreekt (zie wrangler.toml)' }, 503);
  const door = await oidHash(ik.oid);
  if (p === '/push/status' && m === 'GET') { const r = await doe('sig-sub-status', { oid: ik.oid }); return json({ ingericht: !!pushPubliek(env), mag: !!R.offertes, ...(r.j || {}) }, r.status); }
  if (m !== 'POST' || !['/push/aanmelden', '/push/afmelden'].includes(p)) return json({ error: 'onbekende-route' }, 404);
  const t = await geldLeesMax(request, 8 * KB); if (t == null) return json({ error: 'te-groot' }, 413);
  let b; try { b = JSON.parse(t || '{}'); } catch { return json({ error: 'ongeldige-json' }, 400); }
  const sub = b && typeof b === 'object' ? (b.subscription && typeof b.subscription === 'object' ? b.subscription : b) : {};
  const endpoint = String(sub.endpoint || '');
  if (!pushEndpointOk(endpoint)) return json({ error: 'ongeldig', uitleg: 'endpoint van een bekende pushdienst (https) verplicht' }, 400);
  const hash = (await sha256Hex(endpoint)).slice(0, 32);
  if (p === '/push/afmelden') { const r = await doe('sig-sub-weg', { oid: ik.oid, hash, door }); return json(r.j, r.status); }
  if (!R.offertes) return json({ error: 'geen-toegang', reden: 'offertes' }, 403);
  if (!pushPubliek(env)) return json({ error: 'push-niet-ingericht', uitleg: 'VAPID_PUBLIC en VAPID_PRIVATE ontbreken (zie wrangler.toml)' }, 503);
  const keys = sub.keys || {}, p256 = b64uNaar(keys.p256dh), au = b64uNaar(keys.auth);
  if (!p256 || p256.length !== 65 || p256[0] !== 4 || !au || au.length !== 16) return json({ error: 'ongeldig', uitleg: 'keys.p256dh (65 bytes) en keys.auth (16 bytes), base64url' }, 400);
  const r = await doe('sig-sub-zet', { oid: ik.oid, hash, endpoint, p256dh: String(keys.p256dh), auth: String(keys.auth), door });
  return json(r.j, r.status);
}

// CORS: het oude adres (GitHub Pages) én het nieuwe (Cloudflare Pages + eigen domein), exact — geen '*', en niets voor een onbekende herkomst.
const CORS_HERKOMST = ['https://mtbart.github.io', 'https://tool.mortiseandtenon.nl', 'https://mt-tool.pages.dev'];
export default {
  // Cron Triggers (wrangler.toml [triggers]): zie koersCron. Fouten worden gelogd, nooit gegooid (de volgende ochtend probeert opnieuw).
  // Splitsing op cron-expressie: alleen SIG_REC_CRON gaat naar de dagelijkse signalen-controle; elke andere trigger (ook zonder
  // event.cron) gaat ongewijzigd naar de Koersmeter.
  async scheduled(event, env, ctx) {
    if (event && event.cron === SIG_REC_CRON) {
      const ctl = sigReconciliatie(env).catch(e => { sigLog({ controle: 'fout', fout: String((e && e.message) || e).slice(0, 200) }); return { status: 'fout' }; });
      waitUntil(ctx, ctl);
      return await ctl;
    }
    const taak = koersCron(env, event && event.scheduledTime != null ? event.scheduledTime : Date.now()).catch(e => { try { console.log(JSON.stringify({ koerscron: 'fout', fout: String((e && e.message) || e).slice(0, 200) })); } catch {} return { status: 'fout' }; });
    waitUntil(ctx, taak);
    return await taak;
  },
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/csp-rapport') return await cspRapport(request, env, ctx);
    // Moneybird-webhook (L3): server-naar-server, eigen handtekening (geen MS-token, geen CORS); zie mbWebhook.
    if (new URL(request.url).pathname === '/mb/webhook') return await mbWebhook(request, env);
    const herkomst = request.headers.get('Origin') || '';
    // Onbekende herkomst: géén CORS-headers (dan blokkeert de browser het antwoord); alleen Vary.
    const corsHeaders = CORS_HERKOMST.includes(herkomst) ? {
      'Access-Control-Allow-Origin': herkomst,
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PATCH, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token, X-MT-Bevestiging, X-MT-Actie',
      'Access-Control-Expose-Headers': 'X-MT-Herhaald',
    } : { 'Vary': 'Origin' };

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
      // Klantenlijst (F5): na login via de worker, niet meer als publiek bestand.
      if (url.pathname === '/klanten') return await handleKlanten(request, env, ik, json, ctx);
      // Werkcode-teller en centrale instellingen: eigen routes (zie handleTeller).
      if (url.pathname === '/instellingen' || url.pathname.startsWith('/teller/')) return await handleTeller(url.pathname, request, env, ik, json);
      // Zoekbalk: Moneybird-facturen en -offertes uit de zoekindex (alleen lezen; recht `moneybird`).
      if (url.pathname === '/zoek/moneybird') return await handleZoekMb(request, env, ik, json, ctx, modus);
      // Signalen (L3): de gedeelde actiewachtrij. Zien = recht offertes of projecten, wijzigen = offertes 'wijzigen' (in élke modus).
      if (url.pathname === '/signalen' || url.pathname.startsWith('/signalen/') || url.pathname.startsWith('/push/')) return await handleSignalen(url.pathname, request, env, ik, json);
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
  let parsed; try { parsed = JSON.parse(body); } catch { return json({ error: 'ongeldige-json' }, 400); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'ongeldige-json' }, 400);
  delete parsed.api_key;
  parsed.stream = true;
  // F6: het plafond van ${CLAUDE_MAX_TOKENS} tokens uitvoer geldt alleen in 'afdwingen'; in 'log' (en 'uit') wordt max_tokens NIET ingekort (bestaande AI-functies met lange uitvoer
  // blijven werken), er wordt alleen gelogd wat begrensd zou worden.
  if (!(Number(parsed.max_tokens) > 0)) parsed.max_tokens = 1024;
  if (aiModus(env) === 'afdwingen') parsed.max_tokens = Math.min(parsed.max_tokens, CLAUDE_MAX_TOKENS);
  else if (parsed.max_tokens > CLAUDE_MAX_TOKENS) console.log(JSON.stringify({ ai: 'zou-begrenzen', max_tokens: parsed.max_tokens, plafond: CLAUDE_MAX_TOKENS, rol: ik.rol }));
  // Werkplaats: AI "beperkt" → kortere antwoorden.
  if (beperkt) parsed.max_tokens = Math.min(Number(parsed.max_tokens) || AI_BEPERKT_MAX_TOKENS, AI_BEPERKT_MAX_TOKENS);
  // F6: limiet per gebruiker toetsen vóór het verzoek naar Anthropic gaat.
  const gate = await aiClaim(env, ik, parsed);
  if (!gate.ok) return new Response(JSON.stringify(gate.body), { status: gate.status, headers: { 'Content-Type': 'application/json', 'Retry-After': String(gate.wacht_s || 5), ...corsHeaders } });
  const t0 = Date.now();
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(parsed)
    });
  } catch (e) { aiAfrond(env, ctx, gate, { status: 'fout', model: parsed.model, ms: Date.now() - t0 }); throw e; }
  if (!response.ok) aiAfrond(env, ctx, gate, { status: 'fout', http: response.status, model: parsed.model, ms: Date.now() - t0 });   // niets verbruikt: reservering terug
  else if (gate.claim) { return new Response(aiMeet(response, env, ctx, gate, parsed.model, t0), { status: response.status, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...corsHeaders } }); }
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
