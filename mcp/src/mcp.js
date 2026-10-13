// mt-mcp: het MCP-eindpunt /mcp (streamable HTTP, stateless, alleen JSON-antwoorden). De OAuthProvider heeft het
// MCP-token al gecontroleerd (eigen token, audience = deze resource) vóór deze handler draait: ctx.props en ctx.auth.
// Hier: client nog op de lijst, limiet per gebruiker, rol opnieuw uit MT_ROLLEN en toestemming bij ELKE aanroep, scope per tool.
import { insufficientScope } from '@cloudflare/workers-oauth-provider';
import { SCOPE_WHOAMI, ROL_NAAM, json, basis, clientVoor, bepaalRol, leesToestemming, trekAllesIn, binnenLimiet, audit, SCOPES } from './gedeeld.js';

const VERSIES = ['2025-11-25', '2025-06-18', '2025-03-26'];
// Clients roepen aan vanaf hun eigen servers (geen Origin). Een browser-Origin mag alleen van de chat-apps zelf komen.
const ORIGINS = ['https://claude.ai', 'https://chatgpt.com'];

const WHOAMI = {
  name: 'whoami',
  title: 'Wie ben ik',
  description: 'Zegt kort wie je bent in de MT tool, welke rol je hebt en via welke app je verbonden bent. Leest alleen; geen bedrijfsgegevens.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: {
    type: 'object',
    properties: { naam: { type: 'string' }, rol: { type: 'string' }, client: { type: 'string' } },
    required: ['naam', 'rol', 'client'],
  },
  annotations: { title: 'Wie ben ik', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  securitySchemes: [{ type: 'oauth2', scopes: [SCOPE_WHOAMI] }],
};

const rpc = (id, result) => json({ jsonrpc: '2.0', id, result });
const rpcFout = (id, code, message, status = 200, extra) => json({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } }, status, extra);
// 401 met challenge: de client logt opnieuw in (bv. na ingetrokken toestemming).
function opnieuwInloggen(env, id) {
  const meta = `${basis(env)}/.well-known/oauth-protected-resource/mcp`;
  return rpcFout(id, -32001, 'Opnieuw inloggen nodig.', 401, {
    'WWW-Authenticate': `Bearer error="invalid_token", error_description="Toestemming ingetrokken of verlopen", resource_metadata=${JSON.stringify(meta)}, scope=${JSON.stringify(SCOPES.join(' '))}`,
  });
}

async function whoami(env, id, wie, props) {
  const client = clientVoor(props.clientId, env);
  const naam = wie.naam || props.naam || 'onbekend';
  const rol = ROL_NAAM[wie.rol] || wie.rol;
  const tekst = `Je bent ${naam}, met de rol ${rol}, verbonden via ${client.naam}.`;
  return rpc(id, { content: [{ type: 'text', text: tekst }], structuredContent: { naam, rol, client: client.naam }, isError: false });
}

export const mcpHandler = {
  async fetch(request, env, ctx) {
    const pad = new URL(request.url).pathname;
    if (pad !== '/mcp') return json({ error: 'not_found' }, 404);
    const origin = request.headers.get('Origin');
    if (origin && !ORIGINS.includes(origin)) return json({ error: 'origin_niet_toegestaan' }, 403);
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });

    const props = ctx.props || {}, auth = ctx.auth || {};
    const oid = String(props.oid || '').toLowerCase();
    const client = clientVoor(props.clientId, env);
    if (!oid || !client) return opnieuwInloggen(env, null);

    // Volgorde (Codex-review): eerst lezen, dan limiet, rol en toestemming, en pas daarna een notificatie met 202
    // beantwoorden. Zo krijgt ook een bericht zonder id (of een kapot bericht) geen antwoord buiten de controles om.
    let bericht, leesFout = null;
    try { bericht = await request.json(); } catch { leesFout = rpcFout(null, -32700, 'Parse error', 400); }
    if (!leesFout && Array.isArray(bericht)) leesFout = rpcFout(null, -32600, 'Batches worden niet ondersteund.', 400);
    if (!leesFout && (!bericht || bericht.jsonrpc !== '2.0' || typeof bericht.method !== 'string')) leesFout = rpcFout(bericht && bericht.id, -32600, 'Invalid Request', 400);
    const { id, method, params } = leesFout ? {} : bericht;
    const notificatie = !leesFout && id === undefined;
    // Enige lichte uitzondering: notifications/initialized (hoort bij elke verbinding) telt niet mee voor de limiet en
    // komt niet in de audit. Rol en toestemming worden ook daarvoor wél gecontroleerd.
    const licht = notificatie && method === 'notifications/initialized';
    const wat = leesFout ? 'ongeldig-bericht' : method === 'tools/call' ? String(params && params.name).slice(0, 40) : String(method).slice(0, 60);

    if (!licht && !(await binnenLimiet(env, oid))) {
      await audit(env, { oid, client: client.soort, tool: wat, resultaat: 'limiet' });
      return rpcFout(notificatie ? null : id, -32002, 'Te veel verzoeken. Probeer het over een minuut opnieuw.', 429, { 'Retry-After': '60' });
    }
    if (leesFout) return leesFout;

    // Rol en toestemming bij elk verzoek opnieuw: gedeactiveerd = direct weigeren én alles intrekken.
    const wie = await bepaalRol(env, oid);
    if (!wie.rol) {
      if (wie.reden === 'gedeactiveerd' || wie.reden === 'onbekend') {
        const klus = trekAllesIn(env, env.OAUTH_PROVIDER, oid).catch(() => {});
        if (ctx.waitUntil) ctx.waitUntil(klus); else await klus;
      }
      await audit(env, { oid, client: client.soort, tool: wat, resultaat: 'geweigerd:' + wie.reden });
      return rpcFout(notificatie ? null : id, -32003, 'Geen toegang: je account heeft geen actieve rol in de MT tool.', 403);
    }
    if (!(await leesToestemming(env, oid, props.clientId, SCOPES))) return opnieuwInloggen(env, notificatie ? null : id);

    if (notificatie) {
      if (!licht) await audit(env, { oid, client: client.soort, tool: wat, resultaat: 'notificatie' });
      return new Response(null, { status: 202 });
    }

    switch (method) {
      case 'initialize': {
        const gevraagd = params && params.protocolVersion;
        return rpc(id, {
          protocolVersion: VERSIES.includes(gevraagd) ? gevraagd : VERSIES[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'mt-mcp', title: 'MT tool (proef)', version: '0.1.0' },
          instructions: 'Proefkoppeling met de MT tool van Mortise & Tenon. Er is één tool: whoami (wie ben ik, mijn rol, via welke app). Antwoord kort.',
        });
      }
      case 'ping': return rpc(id, {});
      case 'tools/list': return rpc(id, { tools: [WHOAMI] });
      case 'tools/call': {
        const naam = params && params.name;
        if (naam !== 'whoami') {
          await audit(env, { oid, client: client.soort, tool: String(naam).slice(0, 40), resultaat: 'onbekende-tool' });
          return rpcFout(id, -32602, 'Onbekende tool.');
        }
        if (!(auth.scope || []).includes(SCOPE_WHOAMI)) {
          await audit(env, { oid, client: client.soort, tool: 'whoami', resultaat: 'scope-ontbreekt' });
          return insufficientScope(auth, [SCOPE_WHOAMI]);
        }
        const antwoord = await whoami(env, id, wie, props);
        await audit(env, { oid, client: client.soort, tool: 'whoami', resultaat: 'ok' });
        return antwoord;
      }
      default: return rpcFout(id, -32601, 'Method not found');
    }
  },
};
