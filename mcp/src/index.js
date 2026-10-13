// mt-mcp: aparte proef-Worker voor ChatGPT en Claude (MCP via streamable HTTP op /mcp). Raakt de hoofdworker niet.
// OAuth: deze Worker is zelf de authorization server (@cloudflare/workers-oauth-provider) en geeft eigen, kortlevende
// MCP-tokens uit. Entra ID is alleen de login erachter (code + PKCE, alleen onze tenant). Geen open registratie (DCR):
// alleen de clients uit de allowlist in gedeeld.js. Setup voor Bart: SETUP-BART.md.
import { OAuthProvider, OAuthError, getOAuthApi } from '@cloudflare/workers-oauth-provider';
import { inlogHandler } from './inlog.js';
import { mcpHandler } from './mcp.js';
import { SCOPES, ACCESS_TTL_S, REFRESH_TTL_S, basis, json, sha256hex, clientVoor, bepaalRol, leesToestemming, audit } from './gedeeld.js';

const TOKEN_PAD = '/oauth/token';
const GEBRUIKT_TTL_S = REFRESH_TTL_S + 86400;

// Bij elke code-inwisseling en elke refresh: client nog toegestaan, rol nog actief, toestemming niet ingetrokken.
// Anders invalid_grant: de library trekt dan de hele grant in (met al zijn tokens).
async function controleerBijToken({ grantType, clientId, userId, env }) {
  const client = clientVoor(clientId, env);
  const wie = await bepaalRol(env, userId);
  const reden = !client ? 'client' : !wie.rol ? wie.reden : !(await leesToestemming(env, userId, clientId, SCOPES)) ? 'toestemming' : null;
  if (reden) {
    await audit(env, { oid: userId, client: client ? client.soort : 'onbekend', tool: 'token:' + grantType, resultaat: 'geweigerd:' + reden });
    throw new OAuthError('invalid_grant', { description: 'Toegang tot de MT tool is ingetrokken of verlopen' });
  }
}

function opties(b) {
  return {
    apiRoute: '/mcp',
    apiHandler: mcpHandler,
    defaultHandler: inlogHandler,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: TOKEN_PAD,
    scopesSupported: [...SCOPES, 'offline_access'],
    resourceMetadata: { resource: b + '/mcp', authorization_servers: [b] },
    requiredScopes: SCOPES,
    clientIdMetadataDocumentEnabled: true,          // geen clientRegistrationEndpoint: DCR staat uit
    accessTokenTTL: ACCESS_TTL_S,
    refreshTokenTTL: REFRESH_TTL_S,
    tokenExchangeCallback: controleerBijToken,
    onError: ({ code, internal }) => { console.warn(JSON.stringify({ mcp_oauth: code, categorie: internal && internal.category, reden: internal && internal.reason })); },
  };
}
const _providers = new Map();
function provider(env) {
  const b = basis(env);
  if (!_providers.has(b)) _providers.set(b, { opt: opties(b), p: new OAuthProvider(opties(b)) });
  return _providers.get(b);
}

// Refresh-rotatie met detectie van hergebruik, atomisch per grant (Codex-review: KV get-dan-put was racegevoelig).
// Elke refresh gaat naar één Durable Object per grant (naam = userId:grantId uit het refresh-token). Dat object handelt
// strikt één verzoek tegelijk af: claim (in de eigen, sterk consistente DO-opslag), dan de refresh, en bij een tweede
// claim van hetzelfde token het intrekken van de hele grant. Zo kunnen twee gelijktijdige verzoeken met hetzelfde token
// nooit allebei slagen, en kan een lopende refresh een intrekking niet meer "terugschrijven".
// Een token dat al eens is geclaimd (ook als die eerste poging mislukte) geldt bij een tweede aanbieding als gelekt of
// gekopieerd. Daarmee vervalt ook de coulance van de library voor een herhaalde refresh na een verloren antwoord: dan
// opnieuw inloggen.
async function tokenRoute(request, env, ctx, prov) {
  let form = null;
  if ((request.headers.get('Content-Type') || '').includes('application/x-www-form-urlencoded')) {
    try { form = new URLSearchParams(await request.clone().text()); } catch {}
  }
  if (form && form.get('grant_type') === 'authorization_code' && form.get('code')) return codeMetEenPoging(request, env, ctx, prov, form.get('code'));
  if (!form || form.get('grant_type') !== 'refresh_token' || !form.get('refresh_token')) return prov.p.fetch(request, env, ctx);
  const [userId, grantId] = form.get('refresh_token').split(':');
  if (!userId || !grantId) return json({ error: 'invalid_grant', error_description: 'Ongeldig refresh token' }, 400);
  const stub = env.MCP_REFRESH.get(env.MCP_REFRESH.idFromName(`${userId}:${grantId}`));
  return stub.fetch(new Request(request.url, { method: 'POST', headers: request.headers, body: form.toString() }));
}

// Durable Object (binding MCP_REFRESH, klasse RefreshSlot): één per grant. Opslag: 'rt:<hash>' → { t, clientId }.
export class RefreshSlot {
  constructor(state, env) { this.state = state; this.env = env; this.rij = Promise.resolve(); }

  // Wachtrij: het volgende verzoek begint pas als het vorige helemaal klaar is (ook over KV-wachttijden heen,
  // waar de input gate van een Durable Object andere verzoeken wél zou toelaten).
  fetch(request) {
    const klus = this.rij.then(() => this.verwerk(request));
    this.rij = klus.catch(() => {});
    return klus;
  }

  async verwerk(request) {
    const env = this.env, prov = provider(env), opslag = this.state.storage;
    const tekst = await request.text();
    const form = new URLSearchParams(tekst);
    const rt = form.get('refresh_token') || '';
    const [userId, grantId] = rt.split(':');
    const sleutel = 'rt:' + await sha256hex('mt-rt:' + rt);
    const eerder = await opslag.get(sleutel);
    if (eerder) {
      try { await getOAuthApi(prov.opt, env).revokeGrant(grantId, userId); } catch {}
      await audit(env, { oid: userId, client: (clientVoor(eerder.clientId, env) || {}).soort || 'onbekend', tool: 'token:refresh', resultaat: 'hergebruik-grant-ingetrokken' });
      return json({ error: 'invalid_grant', error_description: 'Refresh token is al gebruikt' }, 400);
    }
    await opslag.put(sleutel, { t: Date.now(), clientId: form.get('client_id') || null });
    if (!(await opslag.getAlarm())) await opslag.setAlarm(Date.now() + GEBRUIKT_TTL_S * 1000);
    const verzoek = new Request(request.url, { method: 'POST', headers: request.headers, body: tekst });
    return prov.p.fetch(verzoek, env, { waitUntil: p => (this.state.waitUntil ? this.state.waitUntil(p) : p), passThroughOnException() {} });
  }

  // Opruimen: claims ouder dan de levensduur van een refresh-token (+1 dag) weg; daarna het volgende alarm.
  async alarm() {
    const opslag = this.state.storage, grens = Date.now() - GEBRUIKT_TTL_S * 1000;
    let oudste = null;
    for (const [k, v] of await opslag.list({ prefix: 'rt:' })) {
      if (!v || v.t <= grens) await opslag.delete(k);
      else if (oudste === null || v.t < oudste) oudste = v.t;
    }
    if (oudste !== null) await opslag.setAlarm(oudste + GEBRUIKT_TTL_S * 1000);
  }
}

// Een autorisatiecode krijgt één poging: faalt de inwisseling (bv. verkeerde PKCE-verifier), dan is de code daarna ook
// met de juiste verifier waardeloos. De library laat een code na een PKCE-fout staan; dit maakt dat strenger.
async function codeMetEenPoging(request, env, ctx, prov, code) {
  const markering = 'code-mislukt:' + await sha256hex('mt-code:' + code);
  if (await env.MCP_DATA.get(markering)) return json({ error: 'invalid_grant', error_description: 'Code is niet meer geldig' }, 400);
  const antwoord = await prov.p.fetch(request, env, ctx);
  if (antwoord.status === 400) await env.MCP_DATA.put(markering, '1', { expirationTtl: 900 });
  return antwoord;
}

export default {
  async fetch(request, env, ctx) {
    // Faalt gesloten: zonder de Durable Object voor refresh-claims geen enkele OAuth-route.
    if (!basis(env) || !env.OAUTH_KV || !env.MCP_DATA || !env.MCP_REFRESH) return json({ error: 'niet_ingericht' }, 503);
    const prov = provider(env);
    const pad = new URL(request.url).pathname;
    if (pad === TOKEN_PAD && request.method === 'POST') return tokenRoute(request, env, ctx, prov);
    return prov.p.fetch(request, env, ctx);
  },
};
