# ROUTES.md — de wegen-kaart van de M&T-tool (cockpit + app + Worker)

> **Doel:** één plek waar permanent staat hoe alles aan elkaar hangt — front-ends,
> Worker-routes, SharePoint-databestanden, auth en deploy. Vindbaar op beide PC's
> (SharePoint-sync) én voor Claude-sessies. Geen secrets hier — repo is **PUBLIC**.
>
> Laatst geverifieerd: 2026-06-12.

## De front-ends (wat is wat)

| Bestand | Naam (afspraak Bart 12-6) | Wat |
|---|---|---|
| `v2.html` | **de cockpit** | PC-tool waar Bart non-stop mee werkt: projecten, facturen/MB, inbox, agenda/planning, admin, nacalculatie. Actieve ontwikkeling gebeurt hier. |
| `mobiel.html` | **de app** | Telefoon-PWA (manifest `manifest-mobiel.json`) voor het veld: timer, capture/foto's, taken, agenda, Rapportage (opname- + opleverrapport), feedback. |
| `index.html` | v4 (legacy, live op root) | Oudere bedrijfstool, staat nog op de root-URL. Niet meer doorontwikkelen; alles nieuw → v2.html. |
| `toggl2.html` | Toggl 2.0-weergave | Aparte agenda/uren-view op de Focus-API. |
| `uren.html` | M&T Uren | Urenregistratie (ouder). |

Nóg oudere front-ends staan gearchiveerd in `_archief/oude-tool-2026-06-04/`
(gitignored, niet live).

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

Per-user mapping (`userKey()`): e-mailprefix uit het MSAL-token →
`TOGGL_KEY_MATHIJS` enz. Zo klokt iedereen op eigen naam; geen token client-side.

### Weg 2 — Microsoft Graph (direct vanuit de browser)

- **Gedeelde tool-data:** `_SP`-laag → site `mortisetenon.sharepoint.com/sites/MortiseTenon`,
  default drive (Documenten), map **`MT-Bedrijfstool/`**. Patroon: read-merge-write
  JSON-bestanden (zie tabel hieronder), dedup op `id`.
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
