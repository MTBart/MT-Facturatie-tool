// mt-mcp: inloggen en toestemming (de "defaultHandler" van de OAuthProvider).
//   GET  /authorize        client + redirect tegen de allowlist, PKCE S256 verplicht, dan door naar Entra (code + PKCE + nonce)
//   GET  /callback         terug van Entra: id-token controleren, rol uit MT_ROLLEN, toestemming vragen of hergebruiken
//   POST /toestemming      Toestaan / Weigeren → eigen MCP-tokens via completeAuthorization (Entra-tokens worden nooit bewaard of doorgegeven)
//   POST /beheer/intrekken alle MCP-toegang van één persoon intrekken; alleen de eigenaar, alleen met een browsertoken van de MT tool
import { AuthorizationError, CimdFetchError, authorizationErrorRedirect } from '@cloudflare/workers-oauth-provider';
import {
  ENTRA_AUTHORIZE, ENTRA_TOKEN, TOOL_CLIENT_ID, SCOPES, ROL_NAAM, esc, json, basis, nuS, logUrl, willekeurig, sha256hex, sha256b64url,
  toegestaan, clientVoor, checkEntraToken, bepaalRol, leesToestemming, schrijfToestemming, trekAllesIn, audit,
} from './gedeeld.js';

const SCOPE_TEKST = { 'mt.whoami': 'Zien wie je bent en welke rol je hebt in de MT tool (geen bedrijfsgegevens).' };
const ENTRA_SCOPE = 'openid profile';
const WACHT_TTL_S = 600;

function pagina(titel, inhoud, status = 200, headers = new Headers()) {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.append('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titel)}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#222}
.let{background:#fff4d6;padding:.6rem .8rem;border-radius:6px}button{font-size:1rem;padding:.6rem 1.2rem;margin:.3rem .5rem 0 0;border-radius:6px;border:1px solid #888;background:#fff}
button.ja{background:#2d5a3d;color:#fff;border-color:#2d5a3d}</style></head><body><h1>${esc(titel)}</h1>${inhoud}</body></html>`;
  return new Response(html, { status, headers });
}
const melding = (titel, tekst, status) => pagina(titel, `<p>${esc(tekst)}</p>`, status);
const doorsturen = (locatie, headers = new Headers()) => { headers.set('Location', locatie); return new Response(null, { status: 302, headers }); };

function toestemmingsPagina({ naam, rol, client, details, handle }) {
  const scopes = details.scope.filter(s => SCOPE_TEKST[s]).map(s => `<li>${esc(SCOPE_TEKST[s])}</li>`).join('');
  const lokaal = details.redirectIsLoopback
    ? '<p class="let"><strong>Dit stuurt toegang naar een programma op je eigen computer.</strong> Ga alleen door als je net zelf het inloggen bent gestart.</p>' : '';
  return `<p>Ingelogd als <strong>${esc(naam)}</strong> (${esc(ROL_NAAM[rol] || rol)}).</p>
<p><strong>${esc(client.naam)}</strong> vraagt toegang tot de MT tool.${details.clientDomain ? ` Uitgegeven door <strong>${esc(details.clientDomain)}</strong>.` : ''}
De toegang gaat naar <strong>${esc(details.redirectHost)}</strong>.</p>${lokaal}
<p>Wat deze app mag:</p><ul>${scopes}</ul>
<form method="post" action="/toestemming"><input type="hidden" name="handle" value="${esc(handle)}">
<button class="ja" name="besluit" value="ja">Toestaan</button><button name="besluit" value="nee">Weigeren</button></form>`;
}

async function voltooi(env, oauth, areq, oid, naam, headers) {
  const client = clientVoor(areq.clientId, env);
  const { redirectTo } = await oauth.completeAuthorization({
    request: areq, userId: oid, metadata: { client: client.soort }, scope: SCOPES,
    props: { oid, naam, clientId: areq.clientId, soort: client.soort },
  });
  await audit(env, { oid, client: client.soort, tool: 'login', resultaat: 'toegestaan' });
  return doorsturen(redirectTo, headers);
}

async function authorize(request, env, oauth) {
  let areq;
  try {
    areq = await oauth.parseAuthRequest(request);
  } catch (e) {
    // Terugsturen naar de client alleen als client én redirect op onze lijst staan; anders hier tonen.
    const q = new URL(request.url).searchParams;
    if (e instanceof AuthorizationError && e.redirectTo && toegestaan(q.get('client_id'), e.redirectUri, env)) return Response.redirect(e.redirectTo, 302);
    if (e instanceof AuthorizationError) return melding('Inloggen niet mogelijk', e.description || 'Ongeldig verzoek.', 400);
    if (e instanceof CimdFetchError) return melding('Inloggen niet mogelijk', 'Deze app kon niet worden gecontroleerd.', 400);
    throw e;
  }
  const client = toegestaan(areq.clientId, areq.redirectUri, env);
  if (!client) {
    // Zichtbaar in `wrangler tail`, zodat Bart de exacte client-URL kan overnemen (CLAUDE_CIMD, SETUP-BART.md stap 5).
    // Alleen schema + host + pad (logUrl): geen query, fragment of userinfo, want daar kan state of iets geheims in staan.
    console.warn(JSON.stringify({ mcp_client_geweigerd: logUrl(areq.clientId), redirect: logUrl(areq.redirectUri) }));
    await audit(env, { client: 'onbekend', tool: 'authorize', resultaat: 'client-geweigerd' });
    return melding('Inloggen niet mogelijk', 'Deze app staat niet op de lijst van toegestane apps voor de MT tool.', 400);
  }
  if (!areq.codeChallenge || areq.codeChallengeMethod !== 'S256') return Response.redirect(authorizationErrorRedirect(areq, 'invalid_request', 'PKCE met S256 is verplicht'), 302);
  if (!env.ENTRA_CLIENT_ID || !env.ENTRA_CLIENT_SECRET || !basis(env)) return melding('Nog niet ingericht', 'De koppeling met Microsoft is nog niet ingesteld.', 503);
  const verifier = willekeurig(48), nonce = willekeurig(24);
  const { state, headers } = await oauth.beginUpstream(areq, { data: { verifier, nonce } });
  const u = new URL(ENTRA_AUTHORIZE);
  for (const [k, v] of Object.entries({
    client_id: env.ENTRA_CLIENT_ID, response_type: 'code', response_mode: 'query', redirect_uri: basis(env) + '/callback',
    scope: ENTRA_SCOPE, state, nonce, code_challenge: await sha256b64url(verifier), code_challenge_method: 'S256', prompt: 'select_account',
  })) u.searchParams.set(k, v);
  return doorsturen(u.href, headers);
}

async function callback(request, env, oauth) {
  let up;
  try { up = await oauth.finishUpstream(request); } catch (e) {
    if (e instanceof AuthorizationError) return melding('Inloggen verlopen', 'Dit inlogscherm is verlopen of in een andere browser geopend. Begin opnieuw vanuit de app.', 400);
    throw e;
  }
  const { request: areq, data, headers } = up;
  const client = clientVoor(areq.clientId, env);
  const q = new URL(request.url).searchParams;
  if (!client) return melding('Inloggen niet mogelijk', 'Deze app staat niet op de lijst van toegestane apps voor de MT tool.', 400);
  if (q.get('error') || !q.get('code')) return doorsturen(authorizationErrorRedirect(areq, 'access_denied'), headers);

  // Code inwisselen bij Entra (met PKCE-verifier en het eigen client-geheim). Het id-token gebruiken we alleen om de persoon
  // vast te stellen; Entra-tokens worden niet bewaard en nergens doorgegeven.
  let tok = null;
  try {
    const r = await fetch(ENTRA_TOKEN, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.ENTRA_CLIENT_ID, client_secret: env.ENTRA_CLIENT_SECRET, grant_type: 'authorization_code', code: q.get('code'),
        redirect_uri: basis(env) + '/callback', code_verifier: data.verifier, scope: ENTRA_SCOPE,
      }),
    });
    tok = r.ok ? await r.json() : null;
  } catch {}
  if (!tok || !tok.id_token) {
    await audit(env, { client: client.soort, tool: 'login', resultaat: 'entra-mislukt' });
    return melding('Inloggen mislukt', 'Microsoft gaf geen geldige login terug. Probeer het opnieuw.', 502);
  }
  const chk = await checkEntraToken(tok.id_token, { aud: env.ENTRA_CLIENT_ID, nonce: data.nonce });
  tok = null;
  if (chk.fout) {
    await audit(env, { client: client.soort, tool: 'login', resultaat: 'id-token:' + chk.fout });
    return melding('Inloggen mislukt', 'De login van Microsoft kon niet worden gecontroleerd.', 401);
  }
  const oid = String(chk.payload.oid).toLowerCase(), entraNaam = String(chk.payload.name || '').slice(0, 80);
  const wie = await bepaalRol(env, oid);
  if (!wie.rol) {
    await audit(env, { oid, client: client.soort, tool: 'login', resultaat: 'geweigerd:' + wie.reden });
    return melding('Geen toegang', 'Je account heeft (nu) geen actieve rol in de MT tool. Vraag de eigenaar om toegang.', 403);
  }
  const naam = wie.naam || entraNaam;
  if (await leesToestemming(env, oid, areq.clientId, SCOPES)) return voltooi(env, oauth, areq, oid, naam, headers);

  const details = await oauth.describeConsent(areq);
  const consent = await oauth.beginConsent(areq);
  await env.MCP_DATA.put('wacht:' + await sha256hex(consent.handle), JSON.stringify({ oid, naam }), { expirationTtl: WACHT_TTL_S });
  for (const c of headers.getSetCookie()) consent.headers.append('Set-Cookie', c);
  return pagina('Toegang tot de MT tool', toestemmingsPagina({ naam, rol: wie.rol, client, details, handle: consent.handle }), 200, consent.headers);
}

async function toestemming(request, env, oauth) {
  const form = await request.formData();
  const handle = String(form.get('handle') || '');
  const wachtKey = 'wacht:' + await sha256hex(handle);
  const w = handle ? JSON.parse((await env.MCP_DATA.get(wachtKey)) || 'null') : null;
  if (!w) return melding('Verlopen', 'Dit toestemmingsscherm is verlopen. Begin opnieuw vanuit de app.', 400);
  try {
    if (form.get('besluit') !== 'ja') {
      const geweigerd = await oauth.denyConsent(request, handle);
      await env.MCP_DATA.delete(wachtKey);
      await audit(env, { oid: w.oid, client: (clientVoor(geweigerd.request?.clientId, env) || {}).soort, tool: 'toestemming', resultaat: 'geweigerd' });
      return new Response(null, { status: 302, headers: geweigerd.headers });
    }
    const ok = await oauth.approveConsent(request, handle, { scope: SCOPES });
    await env.MCP_DATA.delete(wachtKey);
    const client = clientVoor(ok.request.clientId, env);
    const wie = await bepaalRol(env, w.oid);                       // kan intussen gedeactiveerd zijn
    if (!client || !wie.rol) {
      await audit(env, { oid: w.oid, client: client && client.soort, tool: 'toestemming', resultaat: 'geweigerd:' + (wie.reden || 'client') });
      return melding('Geen toegang', 'Je account heeft (nu) geen actieve rol in de MT tool.', 403);
    }
    await schrijfToestemming(env, w.oid, ok.request.clientId, SCOPES);
    await audit(env, { oid: w.oid, client: client.soort, tool: 'toestemming', resultaat: 'gegeven' });
    return voltooi(env, oauth, ok.request, w.oid, w.naam, ok.headers);
  } catch (e) {
    if (e instanceof AuthorizationError) return melding('Verlopen', 'Dit toestemmingsscherm is verlopen of in een andere browser geopend. Begin opnieuw vanuit de app.', 400);
    throw e;
  }
}

// Alleen een browsertoken van de MT tool zelf (aud = de tool-app), nooit een MCP-token of een token van de MCP-app.
async function intrekken(request, env, oauth) {
  const kop = request.headers.get('X-Auth-Token') || (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const chk = await checkEntraToken(kop, { aud: TOOL_CLIENT_ID });
  if (chk.fout) return json({ error: 'niet_ingelogd' }, 401);
  const door = String(chk.payload.oid).toLowerCase();
  if ((await bepaalRol(env, door)).rol !== 'eigenaar') {
    await audit(env, { oid: door, client: 'beheer', tool: 'intrekken', resultaat: 'geweigerd:geen-eigenaar' });
    return json({ error: 'alleen_eigenaar' }, 403);
  }
  let body = null; try { body = await request.json(); } catch {}
  const oid = String((body && body.oid) || '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(oid)) return json({ error: 'oid_ongeldig' }, 400);
  const r = await trekAllesIn(env, oauth, oid);
  await audit(env, { oid, client: 'beheer', tool: 'intrekken', resultaat: `ok:${r.grants}/${r.toestemmingen}`, door });
  return json({ ok: true, ingetrokken: r, tijd: nuS() });
}

export const inlogHandler = {
  async fetch(request, env) {
    const pad = new URL(request.url).pathname, m = request.method, oauth = env.OAUTH_PROVIDER;
    if (pad === '/authorize' && m === 'GET') return authorize(request, env, oauth);
    if (pad === '/callback' && m === 'GET') return callback(request, env, oauth);
    if (pad === '/toestemming' && m === 'POST') return toestemming(request, env, oauth);
    if (pad === '/beheer/intrekken' && m === 'POST') return intrekken(request, env, oauth);
    if (pad === '/' && m === 'GET') return new Response('MT tool: MCP-proefserver. Verbind via /mcp.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    return new Response('Niet gevonden', { status: 404 });
  },
};
