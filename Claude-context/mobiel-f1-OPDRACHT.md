# OPDRACHT — mobiel F1-slice: MSAL-login + echte projecten + taken→Toggl 2.0

**Voor:** subagent "mobiel-f1" · **Van:** Larry · **Datum:** 2026-06-12
**Bestand:** `C:\MT\mobiel.html` (F0.5-prototype, ~105 KB, 1 scriptblok — ALLEEN dit bestand wijzigen)
**Let op:** `C:\MT\v2.html` wordt op dit moment door een andere subagent bewerkt —
je mag v2.html LEZEN voor patronen, maar er ABSOLUUT NIETS in wijzigen.

## Doel (Barts woorden)

App "live zetten": inloggen verplicht met @mortiseandtenon.nl-account (MSAL),
dan mobiel een écht project kunnen aanmaken, en taken die in de app worden
aangemaakt/gewijzigd **meteen syncen naar Toggl 2.0** (= nieuwe naam van Toggl
Focus — gebruik "Toggl 2.0" in UI-teksten). Agenda-gedeelte blijft zoals het is
(mock), timer mag ook echt gaan klokken.

## Harde grenzen

- GEEN git-commando's (Larry commit). GEEN secrets in code (Worker doet auth server-side).
- Mock-flows blijven werken als fallback (niet ingelogd / geen netwerk → lokaal, met label).
- Na afloop: Node-syntaxcheck (extract scriptblok + `new Function`), 0 fouten.
- Verslag naar `C:\MT\Claude-context\mobiel-f1-VERSLAG.md`.

## Bouwstenen (kopieer patronen uit v2.html — read-only!)

- **MSAL** (v2 regel ~7300–7340): msal-browser@2 CDN (zit in v2 regel 7),
  `clientId:'a091db96-24ed-4b64-8b9d-7c55bc86cfdb'`,
  `authority:'https://login.microsoftonline.com/15b652c3-ff53-433f-a29d-e9626cbafb41'`,
  `redirectUri: window.location.origin + window.location.pathname.replace(/mobiel\.html$/,'')`
  (= kale map-URL, de enige geregistreerde SPA-redirect-URI — mobiel.html zelf
  registreren geeft AADSTS50011). Login via **loginPopup** (werkt zonder MSAL op
  de redirect-pagina); vang popup-blokkade af met nette foutmelding + retry-knop.
  Token-helpers: `getAuthToken()` (id-token via acquireTokenSilent
  ['openid','profile']) en `getGraphToken()` (scopes zoals v2 GRAPH_SCOPES,
  minimaal Files.ReadWrite + Sites.ReadWrite.All) — kopieer de v2-implementatie.
- **Worker:** `const WORKER='https://mt-claude-proxy.bart-a12.workers.dev'`;
  elke call met header `X-Auth-Token: <id-token>`.
  - Track v9: `WORKER?target=toggl&path=<urlencoded pad>` (zie v2 `tgTrack`, regel ~2280).
  - Toggl 2.0 (Focus): `WORKER?target=toggl_focus&path=<urlencoded
    organizations/21259253/workspaces/21258443/...>` (zie v2 `focusFetch`, regel ~2147).
  - `TG_WS` (Track workspace-id): zoek de const in v2 en neem de waarde over.
- **SharePoint:** kopieer een mini-versie van `_SP.read/write` uit v2 (regel ~5339):
  site `mortisetenon.sharepoint.com:/sites/MortiseTenon`, map `MT-Bedrijfstool/`,
  site-id eerst resolven (colon-path-bug). Altijd read-merge-write op `id`.
- **Focus status-id's:** todo=300785, bezig=300788, klaar=300786 (v2 `_PLAN_TG_STATUS`).

## Te bouwen

### 1. Login-gate
- Bij app-start: MSAL init; geen account → login-scherm (app-logo, één knop
  "Inloggen met Microsoft"). Na login: initiaal/naam in de header (tik = uitloggen).
- Alleen accounts op @mortiseandtenon.nl accepteren; anders melding + uitloggen.
- Niet ingelogd = demo-modus: alles blijft werken op mock/localStorage, met een
  klein "demo"-label in de header en een login-knop.

### 2. Echte projectenlijst
- Na login: Track-projecten laden (`workspaces/{TG_WS}/projects?active=true`)
  via de Worker en mergen met lokale projecten in de picker/projectkaarten
  (echte bovenaan, mock-projecten alleen tonen als er géén echte zijn, of onder
  een kopje "demo").

### 3. Project aanmaken — echt
- De bestaande "＋ Nieuw project"-sheet krijgt bij ingelogde staat een echte flow:
  1. POST Track-project `workspaces/{TG_WS}/projects` `{name:'<Naam> [CODE]',active:true,workspace_id:TG_WS}` → `togglProjectId`.
  2. Read-merge-write `mt_user_projects.json` op SP:
     `{id, code, naam, klantcode, togglProjectId, ts, door:<email>}`.
  3. Lokaal bijwerken + toast "✓ Project live aangemaakt (Toggl 2.0 + gedeeld)".
- Faalt de Toggl-call → project lokaal bewaren met `pending:true` + toast dat
  sync later opnieuw geprobeerd wordt (retry bij volgende app-start/sync-knop).

### 4. Taken → Toggl 2.0 (meteen syncen)
- Taak aanmaken in project-detail → `focusFetch('tasks','POST',{name, status_id:300785, project_id:<togglProjectId>})`;
  `togglTaskId` lokaal bewaren én in `mt_app_taken.json` op SP
  (`{id, project_code, naam, status, togglTaskId, ts, door}`).
- Status-toggle ○→◐→✓ → `PATCH tasks/{togglTaskId}` met de bijbehorende status_id.
- Taak-naam wijzigen → PATCH `{name}`. Herstelpunt→taak (oplever-flow) gaat door
  dezelfde route (krijgt dus ook een Toggl 2.0-taak).
- Project zonder `togglProjectId` (mock/pending) → taken alleen lokaal, met
  grijs "niet gesynct"-puntje.
- Bij project-detail openen (ingelogd): taken van dat project uit Toggl 2.0
  lezen (`tasks?project_id=...`) en mergen (Toggl wint bij conflict) — zo zie je
  ook taken die op de pc zijn aangemaakt.

### 5. Timer — echt klokken (best-effort)
- Ingelogd + echt project gekozen: start → POST `workspaces/{TG_WS}/time_entries`
  `{description, project_id, start:<ISO>, duration:-1, created_with:'mt-mobiel', workspace_id:TG_WS}`;
  stop → PATCH `.../time_entries/{id}/stop`. Mock-project → timer blijft lokaal.
- NB: de Worker klokt nu nog op één Toggl-token (Bart); per-user mapping komt
  later server-side. Zet dit als notitie in je verslag, niet in de UI.

## Oplevering

1. Werkende code in `C:\MT\mobiel.html`, syntaxcheck 0 fouten.
2. `mobiel-f1-VERSLAG.md`: wat gebouwd, welke endpoints, SP-bestanden,
   bekende beperkingen (popup, per-user-token, offline-queue), testlijstje voor Bart.
