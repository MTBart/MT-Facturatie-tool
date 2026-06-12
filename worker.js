const TENANT_ID = '15b652c3-ff53-433f-a29d-e9626cbafb41';
const CLIENT_ID = 'a091db96-24ed-4b64-8b9d-7c55bc86cfdb';
const JWKS_URL = `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`;

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
