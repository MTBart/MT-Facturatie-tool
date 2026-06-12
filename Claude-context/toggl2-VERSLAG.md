# toggl2.html — Slice 1 Verslag

**Gebouwd:** 2026-06-12 · **Bestand:** `C:\MT\toggl2.html` · **2092 regels, 93 809 bytes**
**Syntaxcheck:** 9 blokken, 0 fouten

---

## Per scherm: echt vs stub

### App-shell
- **Echt:** sidebar met alle secties (Track/Analyze/Plan/Manage/Admin), active-state, showScreen routing, topbar met timer-invoerveld, chips, digitale klok, ▶/■ Start/Stop knop, user-avatar + logout.
- **Echt:** "M&T edition ✦" in de sidebar-footer (tooltip via title-attribuut), enige M&T-vermelding.
- **Stub:** Reports, Timeline, Settings → nette "Coming soon"-placeholder.

### Timer / Calendar (screen-timer)
- **Echt:** week-grid (ma–zo), uurlijnen, halfuurlijnen, vandaag-lijn, now-lijn, periode-nav ←/→, weeknummer.
- **Echt:** logged entries als gekleurde blokken (project-kleur), planned time-blocks als dashed transparante blokken.
- **Echt:** dag-totalen (logged/planned) onderin elke kolom; week-totaalbalk boven.
- **Echt:** Lijst-view (entries per dag, start–stop, duur, project-chip, dagtotaal).
- **Echt:** Klik op entry → popover met omschrijving, project, tijd; Edit + Delete via Track PUT/DELETE.
- **Echt:** Lock-check (lockDagen uit mt_adminconfig.json): entry ≥ lockDagen oud → 🔒✦ icoon; niet-admin ziet geen Edit/Delete; admin krijgt reden-prompt; wijziging → auditLog op SP.
- **Echt:** Drag op lege plek → nieuw entry via Track POST (mousedown+mouseup, min 15 min).
- **Echt:** Drag bestaande entry naar andere dag/tijd → Track PUT.
- **Stub:** Split-view en Timesheet → icoon aanwezig maar `cursor:not-allowed` + tooltip "Coming soon".
- **Stub:** `$` billable-chip in topbar (aanwezig maar niet gewired).

### Tasks (screen-tasks)
- **Echt:** Toolbar met preset-dropdown (My tasks/Today/Upcoming/Done), Group by (Date/Status/Project/None), Sort by, zoekveld, + Add task.
- **Echt:** List-view met groupering-headers (Overdue · n / Today · n / Upcoming · n / No date · n).
- **Echt:** Ronde status-checkbox (klik = volgende status via Focus PATCH), taaknaam, project-chip, prioriteit-dot, due-date.
- **Echt:** Board-view (kanban): kolommen uit live `/statuses` endpoint; drag tussen kolommen = status-PATCH.
- **Echt:** Task detail slide-over: titel (direct editeerbaar), description, project-dropdown, From/To datums, Estimate, Priority, Status, Assignee (MT_TEAM), Time-blok Logged/Planned/Estimate, ▶ Start timer.
- **Echt:** Aanmaken via Focus POST tasks; subtask-knop aanwezig als structuur (nog niet in slide-over uitgebouwd).
- **Stub:** Tags in slide-over (veld ontbreekt — slice 2). Attachments, Notes, + Add property → slice 2.

### Projects (screen-projects)
- **Echt:** Tabel met Project (kleurbolletje + naam), Client, Dates, Time status (progress-balk "X of Y h • Z%"), Tags.
- **Echt:** Zoekveld "Find projects by title".
- **Echt:** "+ ADD PROJECT" → naam + client → Track POST projects; client auto-aanmaken als nieuw; SP mt_user_projects.json write (via _SP.write).
- **Echt:** Time status berekend uit project.logged_duration + project.estimated_duration (from Focus API).
- **Stub:** Pinnen, archief-icoon, Saved views, Share — slice 2.

### Members (screen-members)
- **Echt:** People-tabel: Member (avatar-initiaal), Role, Work Hours (waarde uit mt_adminconfig.json; ✦-badge bij kolomkop).
- **Echt:** Rollen hardcoded conform MT_TEAM + inventaris §7.
- **Stub:** Teams-tab, Rate-kolom, ⋮ menu per rij, + Invite members — slice 2.

---

## Endpoints gebruikt

| Target | Endpoint | Methode | Scherm |
|---|---|---|---|
| `toggl_focus` | `organizations/{o}/workspaces/{w}/tracking/current` | GET | Topbar timer (60s poll) |
| `toggl` | `workspaces/{w}/time_entries` | POST | Start timer |
| `toggl` | `workspaces/{w}/time_entries/{id}/stop` | PATCH | Stop timer |
| `toggl_focus` | `organizations/{o}/workspaces/{w}/time-entries/stream?date_from&date_to&order_by=start&include_taskless` | GET | Calendar logged |
| `toggl_focus` | `organizations/{o}/workspaces/{w}/time-blocks/stream?date_from&date_to&order_by=start` | GET | Calendar planned |
| `toggl` | `workspaces/{w}/time_entries/{id}` | PUT | Edit entry (+ audit) |
| `toggl` | `workspaces/{w}/time_entries/{id}` | DELETE | Delete entry (+ audit) |
| `toggl` | `workspaces/{w}/time_entries` | POST | Drag-create entry |
| `toggl_focus` | `workspaces/{w}/statuses?page=1&order_by=position` | GET | Tasks kanban kolommen |
| `toggl_focus` | `organizations/{o}/workspaces/{w}/tasks?page&per_page` | GET | Tasks laden |
| `toggl_focus` | `organizations/{o}/workspaces/{w}/tasks/{id}` | PATCH | Status/veld update |
| `toggl_focus` | `organizations/{o}/workspaces/{w}/tasks` | POST | Nieuwe taak aanmaken |
| `toggl_focus` | `organizations/{o}/workspaces/{w}/projects?page&per_page` | GET | Projects laden |
| `toggl` | `workspaces/{w}/projects` | GET | Project-kleuren ophalen |
| `toggl` | `workspaces/{w}/projects` | POST | Nieuw project aanmaken |
| `toggl` | `workspaces/{w}/clients` | GET | Clientnamen |
| `toggl` | `workspaces/{w}/clients` | POST | Nieuwe client aanmaken |

## SP-bestanden
| Bestand | Gebruik |
|---|---|
| `mt_adminconfig.json` | lockDagen, werkuren (laden bij opstart) |
| `mt_auditlog.json` | append bij edit/delete locked entries |

---

## Open punten slice 2

1. **Timeline/Gantt** (hoogste prio Bart): drag/resize taken, capaciteitsbalken per persoon per week, actuals naast plan, feestdagen/verlof.
2. **Reports**: Summary (KPI's, staafgrafiek, breakdown project×taak), Time logs tabel + CSV-export.
3. **Timesheet-grid** in Timer-screen: rijen = taak×project, kolommen = dagen, cellen direct editeren.
4. **Split-view** (3-daags).
5. **Settings modal**: Personal Details, Calendar integrations, Statuses, Tags, Track sync.
6. **Task slide-over**: Tags, Attachments, Notes, Subtasks, + Add property.
7. **Members**: Teams-tab, Rate-kolom, ⋮ menu, + Invite members.
8. **Project detail-pagina** (`/projects/{id}`): tabs Overview/Tasks/Board/Timeline/Dashboard/Members, milestones, attachments, billing, alerts.
9. **Saved views** (localStorage/SP).
10. **Task-chip in topbar** (taak koppelen aan lopende timer via popup).
11. **Project-chip in topbar** (project kiezen vóór start).
12. **Capaciteits-signaal** (M&T-pluspunt §12.3): Work Hours − feestdagen − geplande blokken per persoon-week.
13. **Vakantiesaldo** (M&T-pluspunt §12.8): jaarbudget − opgenomen − ingepland.
14. **Vakantiedagen inboeken** (§12.7) via Time Off module.
