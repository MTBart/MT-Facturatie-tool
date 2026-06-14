# TRACKING.md — usage-/presence-tracking van de M&T-cockpit

> **Doel:** weten of, hoeveel en door wie de cockpit gebruikt wordt, en **waar het
> schuurt** (usability-frictie), zodat de tool gericht verbeterd kan worden.
>
> **Repo is PUBLIC. Dit bestand bevat alleen ontwerp — NOOIT data.** Alle
> tracking-data leeft server-side op Cloudflare (D1 + KV). Er komt geen
> logbestand, dump of export in de repo.

## Privacy-grens (hard)

Wat wél gelogd wordt:
- Functienaam / actie (`factuur_boeken`, `tab_dwell`, `inbox_move`, …)
- Status (gelukt/mislukt), duur (ms), tab-naam, statuscode
- ID's/codes zónder inhoud (projectcode, sessionId, MB-pad-prefix)
- Ingelogde gebruiker (e-mail uit MSAL — server-bepaald, client kan niet spoofen)
- App-versie/commit + afgekapte user-agent

Wat **nooit** gelogd wordt:
- Klant-PII, namen, adressen
- Factuurinhoud, bedragen, regels
- Vrije tekst die de gebruiker typt (chat/feedback-inhoud gaat via de aparte
  `_LOG`/feedback-laag, niet via tracking)

`detail` is bewust klein (≤180 tekens client, ≤200 server) en bevat alleen
niet-gevoelige labels. De Worker kapt alles nog eens af (data-minimalisme).

## Componenten

| Component | Bestand | Rol |
|---|---|---|
| Front-end helper | `track.js` | batcht events, heartbeat, faalt stil |
| Instrumentatie | `v2.html` | `track()`-haakjes op kernacties + globale error-hooks |
| Worker-routes | `worker.js` | `/track`, `/track/heartbeat`, `/track/online`, `/track/usage` |
| Opslag (events) | D1 `mt-tracking`, tabel `events` | aggregaties |
| Opslag (presence) | KV `TRACK_KV`, key `presence:<user>` TTL 90s | wie online |
| Admin-weergave | Activiteit-tab in `v2.html` | alleen voor Bart |
| Migratie | `migrations/0001_events.sql` | schema |

## Events die geïnstrumenteerd zijn

| event | action | wanneer | signaal |
|---|---|---|---|
| `session` | `start` | page-load | aantal sessies, sessieduur |
| `tab` | `tab_open` | tab-wissel | welke tabs gebruikt worden |
| `tab` | `tab_dwell` | bij wegklikken (met `ms`) | hoe lang per tab — aandacht/verwarring |
| `action` | `factuur_boeken` | MB-boeking gelukt/mislukt | kernfunctie + faalpunten |
| `action` | `inbox_move` | mail verplaatst | inbox-gebruik + 403/fouten |
| `chat` | `help_open` | feedback-/uitlegvenster open | waar men hulp zoekt |
| `chat` | `feedback_verstuur` | feedback verstuurd | engagement met de leerlus |
| `api` | `mb_get/post/patch/delete` | elke MB-call (met latency + ok) | trage/gefaalde API-calls = frictie |
| `error` | `window_error` | gevangen JS-fout | kapotte plekken zichtbaar |
| `error` | `unhandled_rejection` | gevangen promise-fout | idem |

Elk event draagt: `sessionId` (per page-load), `user` (server-bepaald),
`appVersion`, `ts`. Sessieduur = `max(ts) − min(ts)` per `session_id`.

### Usability-signalen die hieruit komen

- **Worden functies gebruikt?** events per `action`, per gebruiker, per dag.
- **Waar haakt het?** mislukt-% per functie + top mislukte/afgebroken acties
  (`ok=0` of `event='error'`) = de hotspots-tabel in de Activiteit-tab.
- **Trage plekken?** gem. latency (`ms`) per MB-call.
- **Aandacht/verwarring?** dwell-tijd per tab (lang blijven hangen of snel weg).
- **Adoptie?** sessies + gem. sessieduur + actieve gebruikers per periode.

## Batching & betrouwbaarheid (front-end)

- Buffer flush't elke 8s of bij 20 events; bij `pagehide` via `navigator.sendBeacon`
  (overleeft tab-sluiting). Netwerk weg → events terug in buffer (begrensd op 500,
  geen oneindige groei).
- Heartbeat elke 30s + bij terugkomen op de tab → `presence:<user>` (90s TTL).
- **Alles faalt stil.** Geen enkele tracking-fout mag de tool ophouden of breken;
  elke `track()`-call in `v2.html` zit achter `window.track && try/catch`.

## Admin-gating

- Schrijfroutes (`/track`, `/track/heartbeat`): elke ingelogde gebruiker.
- Leesroutes (`/track/online`, `/track/usage`): **alleen** `bart@mortiseandtenon.nl`
  (`TRACK_ADMIN` in `worker.js`; de Worker geeft 403 voor ieder ander, óók andere
  admins zoals Mathijs). De Activiteit-tab-knop verschijnt alleen bij Bart.

## Activiteit-tab leest

`GET /track/online` (elke 30s ververst zolang de tab open is) en
`GET /track/usage?range=today|7d|30d`. Toont: online-chips, kerncijfers
(events/sessies/gem. sessieduur/actieve gebruikers), gebruik per functie met
mislukt-%, per gebruiker, en de usability-hotspots.
