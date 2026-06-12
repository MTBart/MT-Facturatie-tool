# OPDRACHT — toggl2.html: Toggl 2.0 UI 1-op-1 nabouwen (slice 1)

**Voor:** subagent "toggl2-ui" · **Van:** Larry · **Datum:** 2026-06-12
**Bestand:** `C:\MT\toggl2.html` — NIEUW standalone bestand. ALLEEN dit bestand aanmaken/wijzigen.

## Waarom (Barts woorden)

Mathijs houdt niet van verandering. De MT-tool moet er daarom voor hem uitzien
als **letterlijk Toggl** ("Toggl 2.0" = Toggl Focus). Onze extra functionaliteiten
komen erbij **alsof het native Toggl-features zijn**, met heel klein ergens een
M&T-verwijzing. Geen walnut-huisstijl hier — dit bestand kopieert de Toggl-look.

## Bron van waarheid voor de UI

Lees EERST de volledige UI-inventaris:
`C:\Users\BartWitte\OneDrive - Mortise & Tenon\Bart-PKA\Deliverables\2026-06-11-toggl-focus-ui-inventaris.md`
— §1 (sidebar), §2 (timer/calendar), §4 (projects), §6 (tasks list/board/detail),
§0+§11 (alle API-endpoints). Bouw wat daar beschreven staat zo letterlijk mogelijk na.

**Toggl-look (licht thema):** witte achtergrond, lichtgrijze sidebar (#F5F3F7-achtig),
donkerpaars voor logo/koppen (#2C1338), Toggl-roze accent (#E57CD8) voor de
start-knop/actieve states, afgeronde chips, systeem-sans (Inter-achtig:
`-apple-system,'Segoe UI',Roboto,sans-serif`). Linksboven logo-tekst "toggl"
(lowercase, vet, donkerpaars) met daaronder workspace-switcher "Mortise and Tenon".

## Harde grenzen

- ALLEEN `C:\MT\toggl2.html` schrijven. `v2.html` en `mobiel.html` zijn READ-ONLY
  (patronen kopiëren mag en moet).
- GEEN git-commando's (Larry commit). GEEN secrets in code (Worker doet auth).
- Nederlandse UI mag NIET: Toggl is Engelstalig — labels exact zoals de inventaris
  ("What are you working on?", "Logged", "Planned", "+ Add task", "Group by" enz.).
- Na afloop: Node-syntaxcheck (extract scriptblokken + `new Function`), 0 fouten.
- Verslag naar `C:\MT\Claude-context\toggl2-VERSLAG.md`.

## Infra (kopieer uit v2.html — read-only)

- **MSAL** (regel ~7300+): zelfde clientId/authority; `redirectUri =
  window.location.origin + window.location.pathname.replace(/toggl2\.html$/,'')`;
  loginPopup; alleen @mortiseandtenon.nl. Geen login → login-scherm in Toggl-stijl
  (geen demo-modus hier; deze pagina is altijd live).
- **Worker:** `https://mt-claude-proxy.bart-a12.workers.dev` met `X-Auth-Token`.
  - `focusFetch` (v2 ~2147): target `toggl_focus`, basis
    `organizations/21259253/workspaces/21258443/`.
  - `tgTrack` (v2 ~2280): target `toggl`, Track v9 (workspace `TG_WS` — const
    overnemen uit v2).
- **_SP** mini-versie (v2 ~5339): site MortiseTenon, map `MT-Bedrijfstool/`,
  site-id eerst resolven; read-merge-write op id.
- **MT_TEAM + mtIsAdmin()** (v2 ~6518): overnemen.
- Focus status-id's: todo=300785, bezig=300788, klaar=300786; overige statussen
  live ophalen via `/statuses` (er zijn er 5, o.a. "Klaar voor levering").

## Te bouwen — slice 1 (de schermen die Mathijs dagelijks gebruikt)

### 1. App-shell
- Linker sidebar exact §1: TRACK→Timer · ANALYZE→Reports · PLAN→Projects, Tasks,
  Timeline · MANAGE→Members · ADMIN→Settings. Slice-1-schermen = Timer, Tasks,
  Projects. De rest = wel klikbaar, nette "Coming soon"-placeholder in Toggl-stijl.
- Onderin de sidebar, klein en subtiel: `M&T edition ✦` (tooltip "Mortise & Tenon
  — powered by MT-tool"). Dit is de ENIGE plek waar M&T groot of klein genoemd wordt.
- Topbalk op elk scherm (§2): invoerveld "What are you working on?" + chips
  `@ Task` `+ Project` `# Tags` + lopende tijd `0:00:00` + roze ▶ start-knop.
  Wired: start → Track POST time_entries `{duration:-1, created_with:'mt-toggl2'}`;
  stop (■) → PATCH stop; lopende timer bij laden ophalen via Focus
  `tracking/current` (204 = geen) en elke 60s verversen.

### 2. Timer-scherm (= calendar, default na login)
- Week-grid (ma–zo, urenraster): **logged** entries donker (project-kleur),
  **planned** time-blocks licht/transparant — data via Focus
  `time-entries/stream?date_from&date_to&order_by=start&include_taskless` en
  `time-blocks/stream?date_from&date_to&order_by=start`.
- Periode-nav "This week • W{nr}" met ←/→; per dag onderin "Xh Ym / Zh Wm"
  (logged/planned); weektotaal "Logged 37h 24m"-balk.
- View-iconen rechtsboven: Kalender (gebouwd) en Lijst (gebouwd: entries per dag
  met start–stop, duur, project-chip, dagtotaal); Split en Timesheet = icoon
  aanwezig maar disabled (tooltip "Coming soon").
- Klik op bestaande logged entry → klein popover: omschrijving, project, tijd,
  Edit (PUT) / Delete (DELETE) via Track v9.
  **M&T-extra (native-look):** entry ouder dan `lockDagen` (uit SP
  `mt_adminconfig.json`, default 14) → klein 🔒 in de popover; niet-admin krijgt
  "Locked entries can only be changed by an admin" en geen Edit/Delete; admin
  krijgt reden-prompt en de wijziging gaat door + append `mt_auditlog.json`
  (zelfde formaat als v2: `{id,ts,wie,actie,doel,oud,nieuw,reden}`). Bij het
  🔒-icoon een piepklein ✦.
- Drag op lege plek → nieuwe logged entry (Track POST met start+stop).

### 3. Tasks-scherm (§6)
- Toolbar: preset-dropdown "My tasks ▾" (My tasks / Today / Upcoming / Done),
  "Group by: Date ▾" (Date/Status/Project/None), zoekveld, **+ Add task**.
- **List-view**: grouping-headers "Overdue · n / Today · n / …"; per rij ronde
  status-checkbox (○ klik = volgende status), taaknaam, project-chip, due-date.
- **Board-view** (kanban): kolommen = statussen (live uit `/statuses`); kaarten
  met naam, datum, project-chip; drag tussen kolommen = status-PATCH.
- **Task detail slide-over** (rechts, §6-tabel): titel (direct editbaar),
  description, project-dropdown, From–To datums, Estimate, Priority
  (High/Medium/Low/None), Status, Assignee (leden via Focus `/users` of org-users
  endpoint), Tags; Time-blok Logged/Planned/Estimate + ▶ start-knop die de
  topbalk-timer start met deze taak. Alles PATCH naar Focus `tasks/{id}`.
- Data: Focus `tasks?…` (zie §0 voor filters). Aanmaken: POST `tasks`.

### 4. Projects-scherm (§4)
- Lijst: kolommen Project (kleurbolletje + naam), Client, Dates, **Time status**
  (progressbalkje "X of Y h • Z%" — logged uit reports of task-aggregatie;
  als dat te zwaar is: logged via time-entries-som per project deze maand,
  estimate uit project-detail), Tags. Zoekveld "Find projects by title".
- "+ ADD PROJECT" onderaan → naam + client → Track POST (zelfde patroon als
  mobiel) + SP `mt_user_projects.json` read-merge-write (formaat zie mobiel.html).
- Data: Focus `projects?page&per_page` of `projects/groups/client`.

### 5. Members-scherm — klein (§7)
- People-tabel: Member (avatar-initiaal), Role, Work Hours — Work Hours uit SP
  `mt_adminconfig.json` werkuren (✦-badge bij de kolomkop), rollen hardcoded
  conform MT_TEAM (admin → "Tool admin", anders "Member").

## Oplevering

1. Werkende `C:\MT\toggl2.html`, syntaxcheck 0 fouten, bytes/regels rapporteren.
2. `toggl2-VERSLAG.md`: per scherm wat echt/stub is, endpoints gebruikt,
   SP-bestanden, open punten voor slice 2 (Timeline/Gantt, Reports, Timesheet,
   Settings, capaciteitsbalk, verlof/saldo native inweven).
