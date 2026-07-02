# ROUTES.md — de wegen-kaart van de M&T-tool (cockpit + app + Worker)

> **Doel:** één plek waar permanent staat hoe alles aan elkaar hangt — front-ends,
> Worker-routes, SharePoint-databestanden, auth en deploy. Vindbaar op beide PC's
> (SharePoint-sync) én voor Claude-sessies. Geen secrets hier — repo is **PUBLIC**.
>
> Laatst geverifieerd: 2026-07-02.

## De front-ends (wat is wat)

| Bestand | Naam (afspraak Bart 12-6) | Wat |
|---|---|---|
| `v2.html` | **de cockpit** | PC-tool waar Bart non-stop mee werkt: projecten, facturen/MB, inbox, agenda/planning, admin, nacalculatie. Actieve ontwikkeling gebeurt hier. |
| `mobiel.html` | **de app** | Telefoon-PWA (manifest `manifest-mobiel.json`) voor het veld: timer, capture/foto's, taken, agenda, Rapportage (opname- + opleverrapport), feedback. |
| `index.html` | redirect naar de cockpit | Sinds 15-6 alleen nog een doorstuurpagina naar `v2.html` (query/hash blijven behouden). De oude v4-bedrijfstool is gearchiveerd in `_archive/index-v4.html`. |
| `toggl2.html` | Toggl 2.0-weergave | Aparte agenda/uren-view op de Focus-API. |
| `uren.html` | M&T Uren | Urenregistratie (ouder). |

Nóg oudere front-ends staan gearchiveerd in `_archief/oude-tool-2026-06-04/`
(gitignored, niet live).

### Gevendorde libraries (`vendor/`, sinds 2-7)

Geen runtime-CDN-afhankelijkheden meer; alles same-origin (en dus door `sw.js`
mee-gecachet voor offline):

| Bestand | Versie | Gebruikt door |
|---|---|---|
| `vendor/msal-browser.min.js` | 2.39.0 (sha256 in comment bij de script-tag) | cockpit + app (login) |
| `vendor/xlsx.full.min.js` | SheetJS (bestond al) | cockpit (import, `defer`) |
| `vendor/jspdf.umd.min.js` | 4.2.1 (Vex-akkoord 1-7) | cockpit (PDF-export, `defer`) |

Nieuwe versie = bestand vervangen + `?v=`-cachebuster in de script-tag bumpen.

### Gedeelde kernlaag (`mt-core.js`, sinds 2-7)

Eén bestand met de laag die cockpit én app allebei nodig hebben — voorheen
tweemaal inline gedupliceerd. Geladen als gewone (niet-`defer`) script-tag ná
`vendor/msal-browser` en vóór de inline-app-code, in beide front-ends:
`<script src="mt-core.js?v=<datum>"></script>`. Zet alles expliciet op `window`,
zodat de losse script-blokken elkaar zien.

| Export | Wat |
|---|---|
| `window.esc(s)` | canonieke HTML-escaper (`& < > "`) |
| `window._encPath(p)` | Graph-padencodering (`encodeURI` + `#`/`?` escapen) |
| `window.authHeader()` | `{X-Auth-Token}`-header uit het huidige ID-token |
| `window.getAuthToken()` | silent ID-token (null bij fail) |
| `window.getGraphToken()` | Graph-access-token: silent → popup → `onTokenFail`-hook |
| `MTCore.installAuth(cfg)` | zet de token-helpers op `window`; `cfg` = `{graphScopes, onTokenOk, onTokenFail}` |
| `MTCore.makeSP(cfg)` | bouwt de `_SP`-synckern (site-resolve, faalveilig `read`, `write` + S1 ETag/412-merge); `cfg` = `{toast, onSyncStatus, trackLastSync, etagKeys}` |

Page-specifieke verschillen zitten in de config, niet in geforkte code:
- **cockpit:** 7 Graph-scopes (Files/Sites/Mail/Calendars/Tasks), Q7-sessiebanner
  via `onTokenFail`, `trackLastSync:true` + `onSyncStatus` (statusbalk), `_SP`
  uitgebreid met `KEYS`/`schedule`/`PROJ_DRIVE` via `Object.assign`.
- **app:** 2 scopes (Files/Sites), géén banner (leunt op `_RQ`-queue),
  géén `lastSync`/statusbalk; `_SP` = kale synckern met `showToast` als toast.

`window._msal` (i.p.v. een lokale `let`) zodat `mt-core.js` dezelfde MSAL-instance
gebruikt als de inline init. `sw.js` is network-first zonder precache-manifest →
`mt-core.js` wordt vanzelf same-origin mee-gecachet, geen aparte vermelding nodig.

## Repo & paden

| Wat | Pad / waarde |
|---|---|
| Werkkopie (lokaal, SharePoint-sync) | `C:\Users\<naam>\Mortise & Tenon\Mortise & Tenon - On-Prem-Data\Applicaties\Claude\` |
| Junction zonder spaties/`&` | **`C:\MT`** → dezelfde map (gebruik dit voor scripts/scheduled tasks) |
| Git remote | `https://github.com/MTBart/MT-Facturatie-tool.git` (**PUBLIC**) |
| Push-branch | `main` (push alleen met Bart-akkoord per actie) |
| Live site | `https://mtbart.github.io/MT-Facturatie-tool/` (+ `/v2.html`, `/mobiel.html`, …) |
| Worker | `mt-claude-proxy` → `https://mt-claude-proxy.bart-a12.workers.dev` (bron: `worker.js`) |

> Commits **altijd via deze SharePoint-repo**, nooit via een losse kloon. Beide
> PC's zien hetzelfde pad. Syntaxcheck vóór commit:
> `node "C:\MT\Claude-context\_syntaxcheck.js" "C:\MT\<bestand>.html"`.

## PC-namen

- **thuis-PC = `DESKTOP-LA2A33H`** — Claude Code-terminal, `.mt-secret`,
  Bart-PKA-vault, email-forward-scripts, gesyncte repo.
- **werk-PC = `KANTOOR`** — waar Bart overdag zit, zelfde SharePoint-sync.
  Gelijktijdige edits → `-DESKTOP-LA2A33H`-conflictkopieën (niet mergen; één
  bron tegelijk bewerken).

## Architectuur — drie wegen vanuit de browser

```
cockpit / app (browser, MSAL-login @mortiseandtenon.nl)
 ├─ 1. Cloudflare Worker  → Moneybird / Toggl / Claude   (secrets blijven server-side)
 ├─ 2. Microsoft Graph    → SharePoint-data + projectmappen + mail (direct, met MSAL-token)
 └─ 3. localStorage       → cache, concepten, offline retry-queue
```

### Weg 1 — de Worker (`worker.js`)

Auth per request: **`X-Auth-Token`** (MSAL-JWT; Worker valideert handtekening
tegen tenant `15b652c3…` + client `a091db96…`) óf **`X-Claude-Key`**
(server-side scripts, secret `CLAUDE_SECRET`). CORS alleen voor
`https://mtbart.github.io`.

| `?target=` | Doet | Token |
|---|---|---|
| `claude` | Anthropic `/v1/messages` (SSE-stream) voor in-app chat | `CLAUDE_KEY` |
| `moneybird` | MB API v2, pad via `?path=` (GET/POST/PATCH) | `MONEYBIRD_KEY` |
| `moneybird_upload` | MB multipart-upload (bijlages) | `MONEYBIRD_KEY` |
| `moneybird_download` | factuur-bijlage → base64 | `MONEYBIRD_KEY` |
| `toggl` | Track API v9 | **per-user** `TOGGL_KEY_<NAAM>`, fallback `TOGGL_KEY` |
| `toggl_focus` | Toggl 2.0 (Focus) API | **per-user** `TOGGL_FOCUS_KEY_<NAAM>`, fallback `TOGGL_FOCUS_KEY` |
| `toggl_admin_projects` | volledige workspace-projectenlijst; **GET-only + pad-whitelist** (alleen `workspaces/<id>/projects`) — gewone tokens zien privé-projecten zonder lidmaatschap niet | admin `TOGGL_KEY` |
| `toggl_reports` | Reports API v3 (aggregeert over álle gebruikers) | admin `TOGGL_KEY` |

#### Tracking-routes (pad-gebaseerd, niet `?target=`)

Usage-/presence-tracking. Auth = zelfde Worker-auth (MSAL-token of server-key).
Server bepaalt de `user` uit het MSAL-token (client kan niet als iemand anders
loggen). Schema + privacy-grens: zie `TRACKING.md`. Opslag: **D1** (`TRACK_DB`,
tabel `events`) + **KV** (`TRACK_KV`, presence met 90s TTL) — server-side,
nooit in de repo.

| Route | Methode | Doet | Wie |
|---|---|---|---|
| `/track` | POST | batch events → D1 (`{events:[{sessionId,event,action,detail,ok,ms,ts,appVersion}]}`) | alle ingelogde gebruikers |
| `/track/heartbeat` | POST | presence in KV (`presence:<user>`, TTL 90s, laatste tab) | alle ingelogde gebruikers |
| `/track/online` | GET | wie nu online is (KV-scan) | **admin-only** (Bart) |
| `/track/usage?range=today\|7d\|30d` | GET | aggregaties uit D1 (per functie/gebruiker/dag, sessies, mislukt-%) | **admin-only** (Bart) |

Admin-gate = e-mailclaim `bart@mortiseandtenon.nl` (`TRACK_ADMIN` in `worker.js`).
Front-end: `track.js` (batcht + heartbeat) + Activiteit-tab in de cockpit
(alleen voor Bart zichtbaar).

Per-user mapping (`userKey()`): e-mailprefix uit het MSAL-token →
`TOGGL_KEY_MATHIJS` enz. Zo klokt iedereen op eigen naam; geen token client-side.

### Weg 2 — Microsoft Graph (direct vanuit de browser)

- **Gedeelde tool-data:** `_SP`-laag (synckern uit `mt-core.js`, zie boven) → site
  `mortisetenon.sharepoint.com/sites/MortiseTenon`,
  default drive (Documenten), map **`MT-Bedrijfstool/`**. Patroon: read-merge-write
  JSON-bestanden (zie tabel hieronder), dedup op `id`. Sinds 2-7 faalveilig:
  alleen HTTP 404 telt als "bestaat nog niet"; elke andere leesfout blokkeert
  migratie én auto-sync voor die key (anti-clobber) en de cockpit re-hydrateert
  na >10 min verborgen tab.
- **ETag-concurrency (S1, proef op `mt_planning`):** `_SP.read` bewaart per
  bestand de `ETag` (`_SP._etags`), `_SP.write` stuurt `If-Match` mee voor keys in
  `_SP.etagKeys` (nu alleen `mt_planning`). Bij **HTTP 412** (andere PC schreef
  ertussenin): re-read → merge → herschrijf met verse ETag; bij gelijke sleutel
  wint **lokaal**. Merge is vorm-bewust: array-van-`{id}` per id, plain object/map
  per sleutel (`mt_planning[code]`). Niet-mergebare vorm → géén blinde overwrite:
  toast "sync-conflict, herladen" + write vervalt tot de volgende schedule na
  re-hydrate. Gespiegeld in v2.html én mobiel.html; 412 gaat op mobiel **niet**
  terug in `_RQ` (geen retry-loop). Alle overige keys: ongewijzigd last-write-wins.
  Uitrol naar meer keys volgt.
- **Projectmappen:** drive **On-Prem-Data** (`_SPProj.DRIVE = b!lTex…yoejLeBe`,
  "Nieuwe mappenstructuur"). `findProjectFolder(code)` zoekt drive-bewust:
  eerst On-Prem-drive, fallback site-default drive; gevonden `driveId` wordt
  per projectcode onthouden (`_projDriveMap`) en alle vervolg-calls gebruiken
  die (`_projDrive(code)`). Paden via `_encPath()` (encodeert ook `#`/`?`).
  Foto-uploads → `<projectmap>/06_Fotos/` met prefix (`opname_`/`aangetroffen_`/
  `opgeleverd_`), conflictBehavior=rename, dedupe op naam+grootte.

### Weg 3 — localStorage + offline retry

- Retry-queue `_RQ` (key `mt_retry_queue`), flush bij login/online/voorgrond/60s.
  Types: `feedback`→fbUpload, `oplevering`→oplUpload, `notitie`→noteUpload,
  `opname`→opnUpload. Toggl-writes bewust uitgesloten (geen dubbele klok-entries).
- Timer-state (`togglEntryId` e.d.) overleeft app-herstart; server-vangnet via
  `me/time_entries/current`.
- Rapport-concepten: `mt_rapdraft_<code>` lokaal + gespiegeld op SP.

## SharePoint-databestanden (`MT-Bedrijfstool/`)

| Bestand | Schrijver | Lezer | Inhoud |
|---|---|---|---|
| `mt_user_projects.json` | app | app/cockpit | in de tool aangemaakte projecten |
| `mt_proj_adressen.json` | app | app | adres-overlay per projectcode |
| `mt_app_taken.json` | app | app/cockpit | taken (gesynct met Toggl 2.0; Toggl wint) |
| `mt_notities.json` | app | app (cockpit-weergave = backlog) | veldnotities + foto-refs |
| `mt_opnames.json` | app | cockpit (consumer = backlog) | opnamerapporten (inmeten) |
| `mt_opleveringen.json` | app | cockpit/nacalc | opleverrapport-log + foto-namen |
| `mt_rapport_concepten.json` | app | app | tussentijds opgeslagen oplever-concepten |
| `mt_notificaties.json` | cockpit | app (poll 90s, per-user `voor`-filter) | admin-notificaties + deep-link |
| `mt_feedback.json` | app | uitleeslus = backlog | feedback-tab input |
| `mt_projecten.json` | cockpit | cockpit | projectenregister cockpit |
| `mt_adminconfig.json` | cockpit | cockpit | admin-instellingen |
| `mt_verlof.json` / `mt_vrijedagen.json` | cockpit | cockpit | planning-laag |
| `mt_planblokken.json` | cockpit | cockpit | planning-blokken |
| `mt_auditlog.json` | cockpit | cockpit | admin-audit |
| `mt_klant_codes` (SP-synced store) | cockpit | cockpit | zelflerende KLANT-code-overrides |

## Projecten & toewijzing (sinds 12-6)

App-projectenlijst = **admin-route** (`toggl_admin_projects`, alle projecten,
ook privé) + **`me/projects`** met eigen token (= écht toegewezen).
`assigned` stuurt: picker-groepering, Projecten-tab-filter
(Alle / Toegewezen / Niet toegewezen), sortering toegewezen-eerst + A-Z.
Admin-route niet beschikbaar → fallback naar per-user `workspaces/<id>/projects`
(dan ziet je alleen je eigen zicht — het oude gedrag/Mathijs-bug).
Projectcode zit als `[CODE]`-suffix in de Toggl-projectnaam.

## Deployen

- **Front-end:** `git push origin main` → GitHub Pages herbouwt ~5 min.
  **Push alleen met expliciet Bart-akkoord per actie** (commits lokaal mogen).
- **Worker:** `wrangler deploy` vanuit `C:\MT` (wrangler 4.x op thuis-PC).
  **Ook deploy en `wrangler secret put` alleen met expliciet Bart-akkoord.**
  Secrets nooit in de repo; zetten via `wrangler secret put <NAAM>`.

## Veiligheid (repo is PUBLIC)

- Twee sloten: geharde `.gitignore` + version-controlled `githooks/pre-commit`
  (secret-guard; `git config core.hooksPath githooks` na re-clone). De hook
  maakt ook backups en werkt `CHANGELOG.md` bij.
- Echte secrets **uitsluitend** in `C:\Users\BartWitte\.mt-secret\` — buiten de
  repo én buiten OneDrive/SharePoint. Nooit tokens in chat/markdown/commits.
- Nooit PII committen. Audit-commando: zie `REPO-VEILIGHEID.md`.
- In-app chat (Larry in de tool) mag niets aan de tool/mappen wijzigen —
  hooguit helpen een project aan te maken; al het chatgebruik wordt gelogd
  (feedback-/leerlus).
