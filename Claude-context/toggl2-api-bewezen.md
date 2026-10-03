# Toggl 2.0 API — bewezen contract (spikes 2026-10-03)

Getest met echte calls op een testproject (`ZZ-TEST Claude`), dat daarna weer is opgeruimd.
Basis: `https://focus.toggl.com/api`, header `Authorization: Bearer <sleutel>` (sleutels staan
alleen als worker-secret `TOGGL_FOCUS_KEY_<NAAM>`, nooit in deze repo).
`O` = `/organizations/{org}/workspaces/{ws}` · `W` = `/workspaces/{ws}` (zonder org).

## Projecten
| Actie | Call | Resultaat |
|---|---|---|
| lijst | `GET O/projects?page=N&per_page=100` | 200 `{page,per_page,data,total}`; velden o.a. `client_id`, `client`, `total_tracked_secs`, `estimated_mins`, `archived_at` |
| aanmaken | `POST O/projects {name}` | 201, volledig object. **`active` komt altijd als `false` terug, ook met `active:true` en na `PATCH {active:true}`.** Betekenis van `active` nog niet duidelijk: in de Toggl-UI controleren of een via de API gemaakt project zichtbaar is |
| hernoemen | `PATCH O/projects/{id} {name}` | 204 (bewezen: naam gewijzigd) |
| ophalen | `GET O/projects/{id}` | 200 |
| archiveren | `PATCH O/projects/{id}/archive` | 204, zet `archived_at` |
| terugzetten | `PATCH O/projects/{id}/restore` | 204, maar `archived_at` bleef direct daarna gevuld → in de UI controleren |
| verwijderen | `DELETE O/projects/{id}` | 204 |

## Klanten, statussen, tags (zonder org-prefix)
| Actie | Call | Resultaat |
|---|---|---|
| klanten | `GET W/clients`, `POST W/clients {name}`, `DELETE W/clients/{id}` | 200 / 201 / 204 |
| statussen | `GET W/statuses` | 200; M&T: Todo 300785, In progress 300788, Productie 604241, Blocked 300787, Klaar voor levering 309790, Factureren 604212, Backlog 314194, Done 300786 |
| tags | `GET W/tags` | 200 |

> Let op: oudere notities (juni) zeggen dat clients/statuses/tags 404 geven. Dat klopt alleen met het
> org-pad (`O/clients`). Met `W/...` werken ze.

## Taken
| Actie | Call | Resultaat |
|---|---|---|
| aanmaken | `POST O/tasks {name, project_id}` | 201; krijgt automatisch status Todo (300785). Met `status_id` mag ook |
| subtaak | `POST O/tasks {name, project_id, parent_task_id}` | 201 |
| subtaken lijst | `GET O/tasks?parent_task_id={id}` | 200 |
| bijwerken | `PATCH O/tasks/{id} {name, status_id, priority, …}` | 204 (priority: `none|low|medium|high`) |
| bulk bijwerken | `PATCH O/tasks/bulk [{id, …}]` | 204 |
| notitie als marker | `notes` veld (bv. `mt-sync:<op-id>`) | blijft bewaard, terug te lezen |
| alles | `GET O/tasks/stream` | 200, lijst zonder paginering (979 taken) |
| verwijderen | `DELETE O/tasks/{id}` | 204 |

## Uren en timer
| Actie | Call | Resultaat |
|---|---|---|
| eigen uren | `GET O/time-entries?date_from=<RFC3339Z>&date_to=<RFC3339Z>&include_taskless=true[&project_id=]` of `/time-entries/stream?…` | **alleen uren van de eigenaar van de sleutel.** Zonder `include_taskless=true` mis je taakloze uren. Kale datum zonder `T…Z` → stil leeg |
| urenregel | `POST O/time-entries {start, duration, description, type:"activity", project_id}` | 201 |
| bewerken | `PATCH O/time-entries/{id} {description, task_id, duration, …}` | 204 |
| verwijderen | `DELETE O/time-entries/{id}` | 204 |
| timer starten | `POST O/tracking/start {type:"activity", description, project_id[, task_id]}` | 200, lopende entry. **Een tweede start stopt de vorige vanzelf** (die krijgt duur 0 als hij binnen een seconde valt) |
| lopende timer | `GET O/tracking/current` | 200 met entry, of **204 als er niets loopt** |
| timer stoppen | `POST O/tracking/stop {end:<RFC3339Z>}` | 200. **`end` moet ná `start` liggen**: stoppen in dezelfde seconde → 400 `invalid_timeentry` → in de code `end = max(nu, start+1s)` |
| alternatief | `POST O/time-entries` zonder `duration` = lopend; `PATCH …/{id} {duration}` = stop | werkt ook |
| bestaat niet | `POST O/tracking` (404), `PATCH O/tracking/current` (405), `GET O/time-entries/current` (400) | |

## Gebruikers
`GET /organizations/{org}/users` → 200, lijst met `email`, `user_account_id` (= `toggl_user_id` op taken/uren).
