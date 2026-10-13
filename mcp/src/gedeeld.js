// mt-mcp: gedeelde stukken — constanten, client-allowlist, Entra-tokencontrole, rol (alleen lezen), toestemming, audit, limiet.
// Geen bedrijfsdata: deze proef kent alleen wie je bent, je rol en via welke client je komt.

export const TENANT_ID = '15b652c3-ff53-433f-a29d-e9626cbafb41';
export const TOOL_CLIENT_ID = 'a091db96-24ed-4b64-8b9d-7c55bc86cfdb';            // de app-registratie van de MT tool (browser-tokens)
export const ENTRA_ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
export const ENTRA_AUTHORIZE = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize`;
export const ENTRA_TOKEN = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
export const JWKS_URL = `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`;

export const SCOPE_WHOAMI = 'mt.whoami';
export const SCOPES = [SCOPE_WHOAMI];                  // alles wat deze server kan toekennen (offline_access komt erbij voor refresh)
export const ACCESS_TTL_S = 600;                       // MCP-access-token: 10 minuten
export const REFRESH_TTL_S = 30 * 86400;               // grant (refresh-keten): 30 dagen vast, daarna opnieuw inloggen
export const TOESTEMMING_TTL_S = REFRESH_TTL_S;        // toestemming per persoon + client verloopt tegelijk met de grant
export const LIMIET_PER_MIN = 30;                      // toolaanroepen per gebruiker per minuut
const KLOK_MARGE_S = 300;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLLEN = ['eigenaar', 'beheerder', 'kantoor', 'werkplaats', 'lezen', 'administratie'];
export const ROL_NAAM = { eigenaar: 'eigenaar', beheerder: 'beheerder', kantoor: 'kantoor', werkplaats: 'werkplaats', lezen: 'alleen lezen', administratie: 'administratie' };

// ── Client-allowlist (geen open registratie) ────────────────────────────────────────────────────────────────────
// Alleen deze clients, elk met hun exacte redirect(s). De library controleert daarnaast dat de redirect in het
// CIMD-document van de client staat; wij eisen bovendien dat client én redirect hier passen.
export const CHATGPT_CIMD = 'https://chatgpt.com/oauth/client.json';
export const CHATGPT_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
export const CLAUDE_CODE_CIMD = 'https://claude.ai/oauth/claude-code-client-metadata';
export const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

function urlOf(s) { try { return new URL(s); } catch { return null; } }
function schoon(u) { return u && !u.username && !u.password && !u.search && !u.hash; }
// Claude Code: loopback /callback op elke poort (RFC 8252), alleen localhost en 127.0.0.1.
function loopbackCallback(r) {
  const u = urlOf(r);
  return !!(schoon(u) && u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.pathname === '/callback');
}
// De gehoste Claude-apps (web, desktop, mobiel) melden zich met een eigen CIMD-URL op claude.ai. Die URL staat NIET in
// de documentatie (claude.com/docs/connectors/building/authentication noemt alleen die van Claude Code). Daarom is
// Claude web/mobiel standaard UIT en zet Bart de exacte URL('s) na de eerste poging in de var CLAUDE_CIMD (komma-
// gescheiden; zie SETUP-BART.md). Elke waarde moet exact zijn, https, host precies claude.ai, zonder query/fragment, en
// niet de Claude Code-URL; andere waarden worden genegeerd.
export function claudeCimds(env) {
  return String((env && env.CLAUDE_CIMD) || '').split(',').map(s => s.trim()).filter(id => {
    const u = urlOf(id);
    return !!(schoon(u) && u.protocol === 'https:' && u.host === 'claude.ai' && u.pathname.length > 1 && u.href === id && id !== CLAUDE_CODE_CIMD);
  });
}
export const CLIENTS = [
  { soort: 'chatgpt', naam: 'ChatGPT', past: id => id === CHATGPT_CIMD, redirect: r => r === CHATGPT_REDIRECT },
  { soort: 'claude-code', naam: 'Claude Code', past: id => id === CLAUDE_CODE_CIMD, redirect: loopbackCallback },
  { soort: 'claude', naam: 'Claude', past: (id, env) => claudeCimds(env).includes(id), redirect: r => r === CLAUDE_REDIRECT },
];
// env is verplicht: zonder env geen Claude web/mobiel (faalt gesloten).
export function clientVoor(clientId, env) { const id = String(clientId || ''); return CLIENTS.find(c => c.past(id, env)) || null; }
export function toegestaan(clientId, redirectUri, env) {
  const c = clientVoor(clientId, env);
  return c && c.redirect(String(redirectUri || '')) ? c : null;
}

// ── Kleine hulpjes ──────────────────────────────────────────────────────────────────────────────────────────────
export const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
export function b64url(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function b64urlDecode(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '==='.slice((b64.length + 3) % 4)), c => c.charCodeAt(0));
}
export async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256b64url(s) { return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))))); }
// Voor logregels: alleen schema, host (met poort) en pad van een URL; nooit query, fragment of userinfo. Hooguit 120 tekens.
export function logUrl(s) {
  try { const u = new URL(String(s || '')); return (u.protocol + '//' + u.host + u.pathname).slice(0, 120); } catch { return '(geen geldige URL)'; }
}
export function willekeurig(n = 32) { return b64url(crypto.getRandomValues(new Uint8Array(n))); }
function randHex(n) { return [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join(''); }
export const nuS = () => Math.floor(Date.now() / 1000);
export function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
}
export function basis(env) { return String(env.MCP_BASIS || '').replace(/\/+$/, ''); }

// ── Entra-tokencontrole (RS256, JWKS van de tenant) ─────────────────────────────────────────────────────────────
let jwksCache = null, jwksTijd = 0, jwksVerversTijd = 0;
async function jwks(verversen) {
  if (jwksCache && !verversen && Date.now() - jwksTijd < 3600000) return jwksCache;
  if (verversen && jwksCache && Date.now() - jwksVerversTijd < 300000) return jwksCache;
  if (verversen) jwksVerversTijd = Date.now();
  try {
    const r = await fetch(JWKS_URL);
    const keys = r.ok ? (await r.json()).keys : null;
    if (Array.isArray(keys) && keys.length) { jwksCache = keys; jwksTijd = Date.now(); }
  } catch {}
  return jwksCache || [];
}
// Controleert een Entra-v2-token van onze tenant voor precies één audience → {payload} of {fout}.
export async function checkEntraToken(token, { aud, nonce } = {}) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return { fout: 'vorm' };
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    const p = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    if (header.alg !== 'RS256' || !header.kid) return { fout: 'alg' };
    const sec = nuS();
    if (typeof p.exp !== 'number' || p.exp <= sec) return { fout: 'verlopen' };
    if (typeof p.nbf === 'number' && p.nbf > sec + KLOK_MARGE_S) return { fout: 'nbf' };
    if (p.tid !== TENANT_ID) return { fout: 'tid' };
    if (p.iss !== ENTRA_ISSUER) return { fout: 'iss' };
    if (!aud || p.aud !== aud) return { fout: 'aud' };
    if (nonce !== undefined && p.nonce !== nonce) return { fout: 'nonce' };
    if (!GUID_RE.test(String(p.oid || ''))) return { fout: 'oid' };
    let jwk = (await jwks()).find(k => k.kid === header.kid);
    if (!jwk) jwk = (await jwks(true)).find(k => k.kid === header.kid);
    if (!jwk || jwk.kty !== 'RSA' || (jwk.use && jwk.use !== 'sig')) return { fout: 'kid' };
    const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    return ok ? { payload: p } : { fout: 'handtekening' };
  } catch {
    return { fout: 'ongeldig' };
  }
}

// ── Rol: KV MT_ROLLEN alleen lezen ──────────────────────────────────────────────────────────────────────────────
// Cloudflare kent geen alleen-lezen-KV-binding; deze server gebruikt MT_ROLLEN uitsluitend via deze get.
// Geen geheugencache: elke toolaanroep leest opnieuw, zodat deactiveren direct telt.
async function leesRol(env, key) {
  if (!env.MT_ROLLEN) throw new Error('geen MT_ROLLEN');
  const v = await env.MT_ROLLEN.get(key);
  return v ? JSON.parse(v) : null;
}
const lijstVar = v => String(v || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
// → { rol, naam } of { rol: null, reden }. Faalt gesloten: kapotte opslag of een onleesbaar record = geen toegang.
// Volgorde (Codex-review): een AANWEZIG record met active=false weigert ALTIJD, ook voor een vaste eigenaar uit
// OWNER_OIDS. Daarna pas de eigenaar-regel. Ontbreekt het record van een eigenaar, dan blijft hij eigenaar: OWNER_OIDS
// is de vaste bron voor eigenaren (zoals in de hoofdworker), zodat een lege of gewiste rollenlijst de eigenaar niet
// buitensluit. Een eigenaar weghalen = zijn oid uit het secret OWNER_OIDS halen, of zijn record op gedeactiveerd zetten.
export async function bepaalRol(env, oid) {
  oid = String(oid || '').toLowerCase();
  if (!GUID_RE.test(oid)) return { rol: null, reden: 'oid' };
  let rec;
  try { rec = await leesRol(env, 'user:' + oid); } catch { return { rol: null, reden: 'opslag' }; }
  if (rec !== null && (typeof rec !== 'object' || Array.isArray(rec))) return { rol: null, reden: 'opslag' };
  if (rec && (rec.active === false || rec.active === 'false')) return { rol: null, reden: 'gedeactiveerd' };
  if (new Set([...lijstVar(env.OWNER_OIDS), ...lijstVar(env.OWNER_OID)]).has(oid)) return { rol: 'eigenaar', naam: (rec && rec.naam) || '' };
  if (!rec) return { rol: null, reden: 'onbekend' };
  if (!ROLLEN.includes(rec.role)) return { rol: null, reden: 'onbekende-rol' };
  return { rol: rec.role, naam: rec.naam || '' };
}

// ── Eigen opslag (MCP_DATA): toestemming, audit, hergebruik-markers ─────────────────────────────────────────────
export async function clientSleutel(clientId) { return (await sha256hex('mt-client:' + clientId)).slice(0, 24); }
const toestemmingKey = async (oid, clientId) => `toestemming:${String(oid).toLowerCase()}:${await clientSleutel(clientId)}`;

// Actieve toestemming van deze persoon voor deze client die alle gevraagde scopes dekt, anders null.
export async function leesToestemming(env, oid, clientId, scopes) {
  const v = await env.MCP_DATA.get(await toestemmingKey(oid, clientId));
  const t = v ? JSON.parse(v) : null;
  if (!t || t.revoked_at || !(t.expires_at > nuS())) return null;
  return (scopes || []).every(s => t.scopes.includes(s)) ? t : null;
}
export async function schrijfToestemming(env, oid, clientId, scopes) {
  const issued_at = nuS();
  const t = { oid: String(oid).toLowerCase(), client_id: clientId, scopes, issued_at, expires_at: issued_at + TOESTEMMING_TTL_S, revoked_at: null };
  await env.MCP_DATA.put(await toestemmingKey(oid, clientId), JSON.stringify(t), { expirationTtl: TOESTEMMING_TTL_S + 30 * 86400 });
  return t;
}
// Zet revoked_at op alle toestemmingen van deze persoon → aantal.
export async function trekToestemmingenIn(env, oid) {
  const prefix = `toestemming:${String(oid).toLowerCase()}:`;
  let n = 0, cursor;
  do {
    const l = await env.MCP_DATA.list({ prefix, cursor });
    for (const { name } of l.keys) {
      const v = await env.MCP_DATA.get(name);
      const t = v ? JSON.parse(v) : null;
      if (!t || t.revoked_at) continue;
      t.revoked_at = nuS();
      await env.MCP_DATA.put(name, JSON.stringify(t), { expirationTtl: 30 * 86400 });
      n++;
    }
    cursor = l.list_complete ? null : l.cursor;
  } while (cursor);
  return n;
}

// Offboarding: alle grants (met hun access- en refresh-tokens) van deze persoon weg, en alle toestemmingen ingetrokken.
export async function trekAllesIn(env, oauth, oid) {
  oid = String(oid).toLowerCase();
  let grants = 0, cursor;
  do {
    const l = await oauth.listUserGrants(oid, cursor ? { cursor } : undefined);
    for (const g of l.items) { await oauth.revokeGrant(g.id, oid); grants++; }
    cursor = l.cursor;
  } while (cursor);
  return { grants, toestemmingen: await trekToestemmingenIn(env, oid) };
}

// Audit zonder inhoud: alleen oid, client, tool/gebeurtenis, tijd en resultaat (en bij beheer: door wie). Append-only, nieuwste eerst bij list().
export async function audit(env, { oid, client, tool, resultaat, door }) {
  const ts = Date.now();
  const rec = { ts, oid: oid || null, client: client || null, tool: tool || null, resultaat: resultaat || null };
  if (door) rec.door = door;
  try { await env.MCP_DATA.put(`audit:${String(9e15 - ts).padStart(16, '0')}:${randHex(4)}`, JSON.stringify(rec), { expirationTtl: 400 * 86400 }); } catch {}
}

// Rate limit per gebruiker: Cloudflare-binding MCP_LIMIET; zonder binding een teller per isolate (zwakker, wel iets).
const _teller = new Map();
export async function binnenLimiet(env, oid) {
  if (env.MCP_LIMIET && typeof env.MCP_LIMIET.limit === 'function') {
    try { return !!(await env.MCP_LIMIET.limit({ key: 'oid:' + oid })).success; } catch {}
  }
  const nu = Date.now(), t = _teller.get(oid);
  if (!t || nu - t.start >= 60000) { _teller.set(oid, { start: nu, n: 1 }); return true; }
  t.n++;
  return t.n <= LIMIET_PER_MIN;
}
