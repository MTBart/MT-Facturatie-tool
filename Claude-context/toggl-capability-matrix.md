# Toggl capability-matrix — bouwlijst volledig Toggl-tabblad

> Gegenereerd 2026-06-05 (nachtrun, /effort ultra) door Larry. STAP 1 van
> `toggl-volledige-tab-OPDRACHT.md`. Endpoints met ✅live = vannacht READ-ONLY
> geverifieerd tegen de echte API (Focus via lokale Bearer, response-vorm
> bevestigd). Track-endpoints = uit inventaris (browser-token zit in localStorage,
> niet lokaal te testen) → defensief parsen, in-browser verifiëren.
> Status-kolom = of de UI vannacht gebouwd is.

## Legenda
- **Product:** T=Track (api/v9, Basic, Worker `target=toggl`), R=Reports
  (reports/api/v3, Worker `target=toggl_reports`), F=Focus (focus.toggl.com,
  Bearer, Worker `target=toggl_focus`).
- **Vorm ✅** = response-shape vannacht live bevestigd.

## Geverifieerde response-vormen (Focus, 2026-06-05)

| Endpoint | HTTP | Envelope | Item-velden (kern) |
|---|---|---|---|
| `GET users/me/settings` (focus root) | 200 | object | current_workspace_id, time_format, duration_format, start_week_on, … |
| `GET {FBASE}/projects?page=N` | 200 | `{page,per_page,data,total}` 20/pg | id, color, name, description, active, billable, tag_ids, tags, total_tracked_secs, total_tasks, estimated_mins, start_date, end_date, toggl_user_id, archived_at |
| `GET {FBASE}/tasks?page=N` | 200 | `{page,per_page,data,total}` 20/pg | id, status_id, project_id, name, priority, assignee_user_ids, tag_ids, project(obj), status(obj), tags, client(obj), total_tracked_time, sub_task_total_count, sub_task_done_count, time_entry_total_count, position |
| `GET {FBASE}/time-entries?date_from=<RFC3339>&date_to=<RFC3339>&include_taskless=true&page=N` | 200* | `{page,per_page,data}` | (date_from/date_to VERPLICHT, **RFC3339** `2026-05-06T00:00:00Z`, niet kale datum) |
| `GET {FBASE}/time-blocks` | 200 | `{page,per_page,data}` | (geplande blokken; leeg in onze ws) |
| `GET {FBASE}/statuses` | **404** | — | bestaat NIET op ws-pad → status komt embedded in task.status |
| `GET {FBASE}/users` | **404** | — | → workspace-users via Track `api/v9/workspaces/{ws}/users` |
| `GET {FBASE}/clients` | **404** | — | → client komt embedded in task.client; Track heeft wél clients-CRUD |

`FBASE = focus.toggl.com/api/organizations/21259253/workspaces/21258443`

## Capability-matrix (feature → UI → endpoint)

### Subsectie A — Timer / Track (live timer + handmatige entries)
| Feature | UI-control | Product | Endpoint | Method | Vorm | Gebouwd |
|---|---|---|---|---|---|---|
| Lopende timer tonen | sticky timerbar | T | `me/time_entries/current` | GET | — | n |
| Timer starten | ▶ start-knop | T | `workspaces/{ws}/time_entries` | POST | — | n |
| Timer stoppen | ⏹ stop-knop | T | `workspaces/{ws}/time_entries/{id}/stop` | PATCH | — | n |
| Entry bewerken | inline edit | T | `workspaces/{ws}/time_entries/{id}` | PUT | — | n |
| Entry verwijderen | 🗑 (confirm) | T | `workspaces/{ws}/time_entries/{id}` | DELETE | — | n |
| Handmatige entry | +tijd-form | T | `workspaces/{ws}/time_entries` | POST | — | n |
| Recente entries (eigen) | quickstart-lijst | T | `me/time_entries?start_date&end_date` | GET | — | n |
| Alle medewerkers entries | agenda/lijst | R | `workspace/{ws}/search/time_entries` | POST | (al in agenda) | ✅(agenda) |

### Subsectie B — Projecten (Track + Focus samengevoegd)
| Feature | UI | Product | Endpoint | Method | Vorm | Gebouwd |
|---|---|---|---|---|---|---|
| Projecten lijst+totalen | kaartenraster | F | `{FBASE}/projects?page=N` | GET | ✅ | n |
| Projecten lijst (Track) | — | T | `workspaces/{ws}/projects` | GET | — | n |
| Project aanmaken | +knop (confirm) | T | `workspaces/{ws}/projects` | POST | — | n |
| Project bewerken/kleur | edit-form | T | `workspaces/{ws}/projects/{pid}` | PUT | — | n |
| Project archiveren | toggle (confirm) | T | `workspaces/{ws}/projects/{pid}` | PUT(active) | — | n |
| Project-totaal (tracked) | uren-badge | F | projects[].total_tracked_secs | — | ✅ | n |

### Subsectie C — Clients
| Feature | UI | Product | Endpoint | Method | Gebouwd |
|---|---|---|---|---|---|
| Clients lijst | dropdown/lijst | T | `workspaces/{ws}/clients` | GET | n |
| Client aanmaken | +knop (confirm) | T | `workspaces/{ws}/clients` | POST | n |
| Client bewerken | edit | T | `workspaces/{ws}/clients/{id}` | PUT | n |

### Subsectie D — Tags
| Feature | UI | Product | Endpoint | Method | Gebouwd |
|---|---|---|---|---|---|
| Tags lijst | chip-lijst | T | `workspaces/{ws}/tags` | GET | n |
| Tag aanmaken | +knop (confirm) | T | `workspaces/{ws}/tags` | POST | n |
| Tag bewerken | edit | T | `workspaces/{ws}/tags/{id}` | PUT | n |
| Focus-tags (label-ids) | chips op taak | F | task.tag_ids / task.tags | — | n |

### Subsectie E — Taken (Focus)  [deels in bestaande Focus-modal]
| Feature | UI | Product | Endpoint | Method | Vorm | Gebouwd |
|---|---|---|---|---|---|---|
| Taken lijst | tabel/board | F | `{FBASE}/tasks?page=N` | GET | ✅ | n |
| Taak aanmaken | +knop (confirm) | F | `{FBASE}/tasks` | POST | — | n |
| Taak bewerken | edit-form | F | `{FBASE}/tasks/{id}` | PATCH | — | deels(status) |
| Status zetten | dropdown | F | `{FBASE}/tasks/{id}` (status_id) | PATCH | — | ✅(modal) |
| Taak verplaatsen (project) | drag/select | F | re-POST (project sticky-bug) | POST | — | n |
| Prioriteit | select | F | task.priority (none/low/med/high/urgent) | PATCH | — | n |
| Assignee | select | F | task.assignee_user_ids | PATCH | — | n |
| Subtaken | nest-lijst | F | parent_task_id | POST | — | n |
| Tijd-entry op taak | +tijd (undo) | F | `{FBASE}/time-entries` +PATCH task_id | POST | — | ✅(modal) |

### Subsectie F — Board (Focus, kanban)
| Feature | UI | Product | Endpoint | Method | Gebouwd |
|---|---|---|---|---|---|
| Kanban-kolommen per status | board-view | F | tasks gegroepeerd op status_id | GET | n |
| Kaart verslepen → status | drag-drop (confirm) | F | `{FBASE}/tasks/{id}` status_id | PATCH | n |

### Subsectie G — Reports
| Feature | UI | Product | Endpoint | Method | Gebouwd |
|---|---|---|---|---|---|
| Summary per project | balk/tabel | R | `workspace/{ws}/search/time_entries` | POST | n |
| Per persoon | tabel | R | idem, group by user | POST | n |
| Dag-grafiek | bar-chart | R | idem, group by datum | POST | n |

## Concrete IDs (grondwaarheid, inventaris §6 + bevestigd)
- org `21259253`, workspace `21258443`.
- users: Bart `7289555`, Mathijs `7289451`, Arjan `7334139`, Maarten `7331774`, Jade `7381167`.
- statussen: Todo `300785`, Backlog `314194`, In Progress `300788`, Blocked `300787`, Klaar voor levering `309790`, Done `300786`.
- tags (Focus): Offerte `55267`, Calculatie `60326`, Werkvoorbereiding `54625`, Ontwerpen `56896`, Productie `56559`, Afwerking `60325`, Montage `60327`, Transport `60329`, Factureren `53694`.

## Bouwvolgorde (commit-plan)
1. `tgStore` data-laag + lege Toggl-tab-shell + nav-knop (commit 1)
2. Subsectie B Projecten (read, Focus totalen) (commit 2)
3. Subsectie E/F Taken+Board (read + status via bestaande Focus-write) (commit 3)
4. Subsectie A Timer/Track (current + start/stop, confirm-gated) (commit 4)
5. Subsectie G Reports (commit 5)
6. Subsectie C/D Clients+Tags (read + create confirm-gated) (commit 6)
7. Agenda timer-view-look integreren als view-toggle (commit 7)
