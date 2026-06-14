const TENANT_ID = '15b652c3-ff53-433f-a29d-e9626cbafb41';
const CLIENT_ID = 'a091db96-24ed-4b64-8b9d-7c55bc86cfdb';
const JWKS_URL = `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`;

// Usage-/presence-tracking: alleen deze e-mail mag de admin-leesroutes
// (/track/online, /track/usage). Schrijfroutes (/track, /track/heartbeat)
// mogen alle ingelogde @mortiseandtenon.nl-gebruikers.
const TRACK_ADMIN = 'bart@mortiseandtenon.nl';

let jwksCache = null;
let jwksCacheTime = 0;

async function getJwks() {
  if (jwksCache && (Date.now() - jwksCacheTime) < 3600000) return jwksCache;
  const resp = await fetch(JWKS_URL);
  jwksCache = (await resp.json()).keys;
  jwksCacheTime = Date.now();
  return jwksCache;
}

function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '==='.slice((b64.length + 3) % 4);
  return Uint8Array.from(atob(pad), c => c.charCodeAt(0));
}

// Valideert het MSAL-token en geeft de JWT-payload terug (of null).
// De payload is nodig voor per-user token-mapping (F1): e-mailclaim → secret.
async function validateToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header  = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    if (payload.exp * 1000 < Date.now()) return null;
    if (payload.tid !== TENANT_ID) return null;
    if (payload.aud !== CLIENT_ID) return null;
    const keys = await getJwks();
    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) return null;
    const cryptoKey = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, b64urlDecode(parts[2]), data);
    return ok ? payload : null;
  } catch(e) {
    return null;
  }
}

// F1: per-user Toggl-token. E-mail uit het MSAL-token → Worker-secret
// `<prefix>_<NAAM>` (bv. TOGGL_KEY_ARJAN voor arjan@mortiseandtenon.nl).
// Geen persoonlijk secret gezet (of geen MS-login, bv. X-Claude-Key) →
// fallback naar het gedeelde secret. toggl_reports blijft bewust op het
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
// ?target=-routes hierboven. Zelfde auth (MSAL of server-key) is al gevalideerd
// vóór dit punt. Schrijfroutes: alle ingelogde gebruikers. Leesroutes: admin-only.
// Faalt nooit hard op ontbrekende bindings — tracking mag de tool niet ophouden.
async function handleTrack(pathname, request, env, msPayload, cors) {
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...cors }
  });
  const email = tokenEmail(msPayload);
  const isAdmin = email === TRACK_ADMIN;

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

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://mtbart.github.io',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PATCH, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Valideer: Microsoft-token OF Claude-server-key
    const authToken = request.headers.get('X-Auth-Token');
    const claudeKey = request.headers.get('X-Claude-Key');
    const validClaude = claudeKey && env.CLAUDE_SECRET && claudeKey === env.CLAUDE_SECRET;
    const msPayload = authToken ? await validateToken(authToken) : null;
    const validMs = !!msPayload;
    if (!validClaude && !validMs) {
      return new Response(JSON.stringify({ error: 'Niet geautoriseerd' }), {
        status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    try {
      const url = new URL(request.url);

      // Pad-gebaseerde tracking-routes (los van de ?target=-proxy hieronder).
      if (url.pathname === '/track' || url.pathname.startsWith('/track/')) {
        return await handleTrack(url.pathname, request, env, msPayload, corsHeaders);
      }

      // Dashboard-routes
      if (url.pathname.startsWith('/dashboard/')) {
        return await handleDashboard(url.pathname, request, env, msPayload, corsHeaders);
      }

      const target = url.searchParams.get('target');

     if (target === 'claude') {
  const body = await request.text();
  const parsed = JSON.parse(body);
  delete parsed.api_key;
  parsed.stream = true;
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
        const response = await fetch(`https://moneybird.com/api/v2/${mbPath}`, {
          method,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.MONEYBIRD_KEY}` },
          body
        });
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
        const token = btoa(`${userKey(env, 'TOGGL_KEY', env.TOGGL_KEY, msPayload)}:api_token`);
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
            'Authorization': `Bearer ${userKey(env, 'TOGGL_FOCUS_KEY', env.TOGGL_FOCUS_KEY, msPayload)}`
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
