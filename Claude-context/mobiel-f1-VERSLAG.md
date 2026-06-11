# mobiel-f1 VERSLAG

**Datum:** 2026-06-11  
**Bestand:** `C:\MT\mobiel.html`  
**Voor/na:** 2499 regels → 3076 regels (+577 regels)  
**Syntaxcheck:** SYNTAX OK (Node `new Function()`, 0 fouten)

---

## Wat is gebouwd

### 1. MSAL Login-gate
- MSAL Browser v2 CDN toegevoegd aan `<head>`.
- `initMsal()` initialiseert `PublicClientApplication`, wist stale interaction-sessiestorage flags, en controleert bij start of er al een account gecached is. Wordt aangeroepen in `DOMContentLoaded`.
- `msLogin()` gebruikt `loginPopup` (geen redirect, werkt zonder `mobiel.html` als geregistreerde SPA-redirect-URI). Vangt popup-blokkade af met duidelijke foutmelding + retry-mogelijkheid.
- `toonApp()` controleert domein: alleen `@mortiseandtenon.nl` accounts geaccepteerd. Anderen worden uitgelogd met foutmelding.
- `startDemoMode()` — app werkt volledig zonder login: alles localStorage/mock, goud "DEMO"-badge in header.
- `msLogout()` via `logoutPopup`, reset staat, login-scherm terug.
- **Redirect URI:** `window.location.origin + pathname.replace(/mobiel\.html$/, '')` = kale map-URL, geen extra Azure-registratie nodig.

### 2. Echte projectenlijst
- `loadRealProjects()` haalt na login `workspaces/21258443/projects?active=true` op via de Worker.
- Naam-parsing: `[CODE]` uit Track-naam extraheren; als die er niet is → `TG-{id}` als fallback.
- `allProjects()`: REAL_PROJECTS + USER_PROJECTS als ingelogd, anders PROJECTS (mock) + USER_PROJECTS.
- Na laden: picker, kaarten, oplevering-select her-gerenderd + toast met aantal projecten.

### 3. Project aanmaken — echt
- `saveNewProject()` is `async` geworden.
- POST naar `workspaces/21258443/projects` met naam `{naam} [CODE]` → `togglProjectId` opgeslagen op project-object.
- SP read-merge-write `mt_user_projects.json` (veld: `{id, code, naam, klantcode, togglProjectId, ts, door, pending}`).
- Faalt Track-call → `pending: true` op project, lokaal bewaard, toast "sync later".
- Toast bij succes: "✓ Project {code} live aangemaakt (Toggl 2.0 + gedeeld)".

### 4. Taken → Toggl 2.0 sync

#### Taak aanmaken (`saveNewTask`)
- POST `tasks` naar Focus API met `{name, status_id: 300785, project_id: togglProjectId}`.
- `togglTaskId` lokaal bewaren + SP write `mt_app_taken.json`.
- Project zonder `togglProjectId` → taak alleen lokaal, grijs puntje in de UI.

#### Status-toggle (`toggleTaskStatus`)
- Status-cyclus: todo → bezig → klaar → todo.
- PATCH `tasks/{togglTaskId}` met juiste `status_id` (300785/300788/300786) + SP write.

#### Naam-wijziging (`saveTaskEdit`)
- PATCH `tasks/{togglTaskId}` met `{name}` (alleen als naam gewijzigd is) + SP write.

#### Herstelpunt-taak (`herstelNaarTaak`)
- POST naar Focus als project `togglProjectId` heeft, zelfde flow als `saveNewTask`.

#### Project-detail openen (`openProjectSheet`)
- Ingelogd + echt project: `loadAndMergeTasksForProject()` op de achtergrond.
- Toggl 2.0 wint bij conflict (naam + status overschreven vanuit Focus).
- Nieuwe Focus-taken (aangemaakt op de PC) worden als `ft-{id}` lokaal toegevoegd.

#### Sync-indicator
- Groen puntje (`.task-sync-dot.synced`) = `togglTaskId` aanwezig.
- Grijs puntje (`.task-sync-dot.unsynced`) = niet gesynchroniseerd.
- Alleen zichtbaar als project een `togglProjectId` heeft en gebruiker is ingelogd.

### 5. Timer — echt klokken
- `startTimer()` roept `startTimerOnToggl()` aan (best-effort, catch wordt genegeerd).
- POST `workspaces/21258443/time_entries` met `{description, project_id, start: ISO, duration: -1, created_with: 'mt-mobiel', workspace_id}`.
- `stopTimer()` roept `stopTimerOnToggl()` aan → PATCH `workspaces/21258443/time_entries/{id}/stop`.
- Mock-project (geen `togglProjectId`) → timer blijft lokaal, geen API-call.

---

## Endpoints gebruikt

| Doel | Methode | Pad |
|---|---|---|
| Projecten laden | GET | `workspaces/21258443/projects?active=true` |
| Project aanmaken | POST | `workspaces/21258443/projects` |
| Timer start | POST | `workspaces/21258443/time_entries` |
| Timer stop | PATCH | `workspaces/21258443/time_entries/{id}/stop` |
| Taken laden | GET | `organizations/21259253/workspaces/21258443/tasks?project_id={id}` |
| Taak aanmaken | POST | `organizations/21259253/workspaces/21258443/tasks` |
| Status PATCH | PATCH | `organizations/21259253/workspaces/21258443/tasks/{id}` |
| Naam PATCH | PATCH | `organizations/21259253/workspaces/21258443/tasks/{id}` |

Worker-routing: Track v9 via `?target=toggl&path=...`, Focus via `?target=toggl_focus&path=...`  
Header op elke call: `X-Auth-Token: <MSAL id-token>`

---

## SharePoint-bestanden

Site: `mortisetenon.sharepoint.com:/sites/MortiseTenon`  
Map: `MT-Bedrijfstool/`

| Bestand | Inhoud |
|---|---|
| `mt_user_projects.json` | Array van `{id, code, naam, klantcode, togglProjectId, ts, door, pending}` |
| `mt_app_taken.json` | Array van `{id, project_code, naam, status, togglTaskId, ts, door}` |

Patroon: altijd read → merge op `id` → write (nooit blind overschrijven).  
Site-ID eerst resolven via Graph om colon-path-bug (HTTP 400) te vermijden.

---

## Bekende beperkingen

1. **Per-user Toggl-token**: de Worker klokt nu op één Toggl-token (Bart). Per-user mapping moet server-side komen in een volgende iteratie.
2. **Popup-vereiste**: loginPopup werkt niet als de browser popups blokkeert. Melding + retry-knop aanwezig; redirect-flow (zou `mobiel.html` Azure-registratie vereisen) is niet geïmplementeerd.
3. **Offline-queue**: projecten met `pending: true` worden niet automatisch opnieuw geprobeerd. Een retry-lus bij volgende app-start is nog niet gebouwd.
4. **Timer crash-recovery**: als de app crasht terwijl de timer loopt, is de Track time-entry al gestart maar wordt nooit gestopt. Huidige localStorage-recovery herstart de lokale timer, maar weet de Track entry-ID niet meer.
5. **SP-foto-upload**: opname/foto-capture is nog mock; Graph-upload volgt in latere fase.

---

## Testlijstje voor Bart

### Login-flow
- [ ] Pagina openen → login-scherm verschijnt (logo + "Inloggen met Microsoft"-knop)
- [ ] Knop klikken → Microsoft popup → inloggen met `bart@mortiseandtenon.nl` → app opent, initiaal "B" rechts in header
- [ ] Klikken op "B" → "Uitloggen?"-bevestiging → login-scherm terug
- [ ] Inloggen met een ander domein (bijv. gmail) → foutmelding + uitloggen
- [ ] "Doorgaan zonder inloggen" → app opent, goud DEMO-badge zichtbaar in header

### Projectenlijst
- [ ] Na login: toast "✓ N projecten geladen van Toggl 2.0"
- [ ] Track-projecten bovenaan in picker en kaarten-tab
- [ ] Demo-modus: mock-projecten zichtbaar, geen toast

### Project aanmaken
- [ ] Nieuw project aanmaken (ingelogd) → toast "✓ live aangemaakt (Toggl 2.0 + gedeeld)"
- [ ] Project verschijnt in Toggl Track werkruimte
- [ ] `mt_user_projects.json` op SP bevat nieuw record
- [ ] Toggl offline simuleren → toast "lokaal bewaard — sync later", `pending: true` in localStorage

### Taken
- [ ] Project met `togglProjectId` openen → taken laden uit Focus (Toggl 2.0), merge zichtbaar
- [ ] Nieuwe taak aanmaken → groene sync-dot verschijnt na sync
- [ ] Taak zonder togglProjectId → grijs puntje
- [ ] Status-toggle (○→◐→✓) → wijziging direct zichtbaar in Toggl 2.0 dashboard
- [ ] Naam wijzigen → PATCH zichtbaar in Toggl 2.0
- [ ] Herstelpunt → taak aanmaken → taak verschijnt in project-detail EN in Toggl 2.0

### Timer
- [ ] Project met togglProjectId selecteren → START klikken → Track time entry gestart (zichtbaar in Toggl Track web)
- [ ] STOP klikken → entry gestopt, duur zichtbaar in Toggl
- [ ] Mock-project selecteren → timer draait lokaal, geen Track-entry

---

*Gegenereerd door subagent mobiel-f1 op 2026-06-11*
