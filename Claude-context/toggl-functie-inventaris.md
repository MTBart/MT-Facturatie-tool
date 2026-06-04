# Toggl functie-inventaris — Focus + Track (volledig)

> Doel (Bart, 2026-06-04): álle functies van **Toggl Focus** én **Toggl Track**
> in kaart, zodat we (a) elke mogelijkheid kunnen nábouwen in de M&T-tool,
> (b) met onze eigen knoppen **Toggl Focus 1-op-1 kunnen aansturen**, en
> (c) het later **zelfstandig** kunnen laten draaien (nachtrun / autonoom).
>
> Dit document is zowel analyse als bouw-spec. Per functie staat: wat het doet,
> via welke API-call het gaat, en welke knop/feature wij ervoor (gaan) bouwen.

---

## 0. De twee producten — eindelijk ontward

Mortise & Tenon raakt steeds de draad kwijt tussen "Focus" en "Track". Hier de
grondwaarheid (geverifieerd tegen de code + Toggl-docs, 2026-06-04):

| | **Toggl Track** | **Toggl Focus** |
|---|---|---|
| Wat | Klassieke tijdregistratie (timer + rapporten) | Nieuwer unified plan-én-track product: **Board / Kalender / Timeline / Capaciteit** |
| API-base | `https://api.track.toggl.com/api/v9` | `https://focus.toggl.com/api` |
| Reports-base | `https://api.track.toggl.com/reports/api/v3` | (geen aparte reports-API; alles via time-entries/time-blocks) |
| Auth | **Basic** `base64(token + ":api_token")` | **Bearer** `Authorization: Bearer <token>` |
| Resource-pad | `/me/...` (eigen) en `/workspaces/{ws}/...` | `/organizations/{org}/workspaces/{ws}/...` |
| Workspace | `21258443` | `21258443` (zelfde) + org `21259253`, user `7289555` |
| Token | in browser-localStorage (uren.html) | `C:\Users\BartWitte\.mt-secret\toggl.json` → `tokens[0].token` |
| Wie gebruikt 't bij M&T | uren.html (`syncTogglEntries`, timer-push) | de Python-CLI + nachtrun; Bart's actieve dag-app |

**Belangrijk:** beide praten met **dezelfde workspace `21258443`** en, volgens
Toggl ("all feeding data to the same place"), grotendeels dezelfde onderliggende
data. Focus is de moderne schil; Track is de klassieke API + de enige met een
**Reports-API** die over álle workspace-gebruikers aggregeert. Dat laatste is
precies wat we nodig hebben voor "uren van álle medewerkers terugkijken".

**Conclusie voor de bouw:**
- **Terugkijken/aggregeren (alle medewerkers, alle projecten)** → **Track Reports API v3**
  (de enige die niet-eigen entries teruggeeft) of de **Focus time-entries-list**
  met `include_taskless=true`. Track Reports is het rijkst voor totalen.
- **Focus 1-op-1 aansturen (knoppen)** → **Focus API** (Bearer). Token blijft
  server-side via de Cloudflare Worker (`TOGGL_FOCUS_KEY` is al een Worker-secret)
  → veilig én klaar voor autonoom draaien zonder browser.

---

## 1. Toggl Track — API v9 (functie → endpoint)

Base: `https://api.track.toggl.com/api/v9` — Basic auth `base64(<token>:api_token)`.

### 1a. Time entries (de kern)
| Functie | Endpoint | Notitie |
|---|---|---|
| Laatste eigen entries | `GET /me/time_entries?start_date=&end_date=` | Alleen **eigen** entries. start/end = ISO-datum of RFC3339. Ook `since` (UNIX) + `before`. |
| Lopende timer ophalen | `GET /me/time_entries/current` | `null` als niets loopt |
| Eén entry | `GET /me/time_entries/{id}` | |
| Timer starten / entry maken | `POST /workspaces/{ws}/time_entries` | body: `description, project_id, task_id, tags[], billable, start (RFC3339), duration (-1 = lopend), workspace_id, created_with` |
| Timer stoppen | `PATCH /workspaces/{ws}/time_entries/{id}/stop` | |
| Entry wijzigen | `PUT /workspaces/{ws}/time_entries/{id}` | volledige update |
| **Bulk** wijzigen | `PATCH /workspaces/{ws}/time_entries/{ids}` | max 100 ids; JSON-patch-achtig (`op/path/value`) |
| Entry verwijderen | `DELETE /workspaces/{ws}/time_entries/{id}` | |

**Time-entry velden:** `id, start, stop, duration, description, billable, user_id,
workspace_id, project_id, task_id, tag_ids, tags, client_id, at, created_with,
duronly`. Display-velden (met `?meta=true`): `project_name, project_color,
task_name, client_name, user_name, user_avatar_url`. Legacy: `pid/tid/uid/wid`.
Lopend = `duration` negatief (`-(start_unix)`).

### 1b. Projecten / taken / clients / tags / groepen
| Functie | Endpoint |
|---|---|
| Projecten v.d. workspace | `GET /workspaces/{ws}/projects?active=true` |
| Project maken/wijzigen/verwijderen | `POST/PUT/DELETE /workspaces/{ws}/projects[/{id}]` |
| Taken per project | `GET /workspaces/{ws}/projects/{pid}/tasks` |
| Clients | `GET/POST/PUT/DELETE /workspaces/{ws}/clients` |
| Tags | `GET/POST/PUT/DELETE /workspaces/{ws}/tags` |
| Workspace-gebruikers | `GET /workspaces/{ws}/workspace_users` |
| Groepen | `GET /workspaces/{ws}/groups` |
| Eigen workspaces | `GET /me/workspaces` |
| Profiel | `GET /me` (smoke-test) |

### 1c. **Reports API v3** — aggregatie over álle gebruikers (sleutel voor terugkijken)
Base: `https://api.track.toggl.com/reports/api/v3` — zelfde Basic auth.

| Rapport | Endpoint | Geeft |
|---|---|---|
| **Summary** | `POST /workspace/{ws}/summary/time_entries` | gegroepeerde totalen (seconden) |
| **Detailed/search** | `POST /workspace/{ws}/search/time_entries` | individuele entries van **alle** users, gepagineerd |
| **Weekly** | `POST /workspace/{ws}/weekly/time_entries` | week-grid per project/user |

Body-params (alle rapporten): `start_date, end_date` (YYYY-MM-DD), `project_ids[],
user_ids[], client_ids[], tag_ids[], task_ids[], billable (bool), description,
grouping` (`projects|users|clients|tasks|tags|time_entries`), `sub_grouping`,
`rounding, rounding_minutes, order_by, order_dir`. Detailed pagineert via
`page_size` + `first_row_number` (response-header `X-Next-Row-Number`).

Summary-response: `groups[] { id, sub_groups[] { id, seconds, rates… } }`.
Detailed-response: rijen met `user_id, username, project_id, description,
time_entries[] { id, start, stop, seconds, at }`.

> ⚠️ **CORS-risico:** de Reports-API gaf historisch geen CORS-headers voor
> browser-calls (v9 time-entries wél — uren.html bewijst dat). Plan B = via de
> **Cloudflare Worker** proxyen. Bij de bouw eerst direct proberen, anders Worker.

### 1d. Overig Track (compleetheid, lagere prio)
- **Webhooks** (`/webhooks` service) — push bij entry-mutaties (handig voor
  realtime sync i.p.v. pollen).
- **Saved reports**, **insights**, **dashboard** — afgeleide rapporten; nábouwen
  we zelf uit summary/detailed, niet nodig als losse calls.
- **Favorites**, **pinned**, **preferences** — UI-comfort, optioneel.

---

## 2. Toggl Focus — API (functie → endpoint)

Base: `https://focus.toggl.com/api/organizations/{org}/workspaces/{ws}` — Bearer.
(org `21259253`, ws `21258443`.) Volledige gotcha-set: zie
`reference_toggl_focus_api.md` in de Bart-PKA-memory + `Tooling/toggl-focus.md`.

### 2a. Focus-views (wat het product kan — dit gaan we nábouwen)
Uit de Toggl-productpagina's, dit zijn de **Focus-mogelijkheden** die we 1-op-1
willen kunnen:

1. **Kalender-view** — drag-&-drop timeline-kalender, tijd-blokken plannen,
   externe agenda's (Outlook) als events importeren en met één klik → taak.
2. **Board-view** — kanban van taken (Todo/Doing/Done), eigenaar/deadline/prioriteit.
3. **Timeline-view** — projecten/mensen over de tijd (planning + bezetting).
4. **Capaciteit-view** — wie is over-/onderbezet, rekening houdend met verlof,
   feestdagen, werkuren.
5. **Tijdregistratie** — live timer, preset tikken, of een range slepen (manual),
   plus Pomodoro. Alles landt op dezelfde data.
6. **Taakbeheer** — taken in Kalender/Board/List, eigenaars, deadlines, prio's,
   gedeelde teamborden.

### 2b. Focus-endpoints (geverifieerd werkend)
| Functie | Endpoint | Status |
|---|---|---|
| Auth-smoke | `GET /users/me/settings` (zonder ws-pad) | OK |
| Time-entries lijst | `GET …/time-entries?date_from=&date_to=&include_taskless=true&page=N` | OK — RFC3339Z (`T00:00:00Z`), `.data`-envelope, 20/pagina; **`include_taskless=true` verplicht** om taskless te zien |
| Eén entry | `GET …/time-entries/{id}` | OK |
| Entry maken | `POST …/time-entries` body `{task_id, start(RFC3339Z), duration(sec), description, type:"activity"}` | 201; **`task_id` dropt silently → altijd PATCH na** |
| Entry task koppelen | `PATCH …/time-entries/{id}` body `{task_id}` (int) | 200 — verplichte follow-up na POST |
| Entry verwijderen | `DELETE …/time-entries/{id}` | 204 (let op: **task DELETE = cascade** op entries) |
| Projecten | `GET …/projects` (`.data`-envelope, paginate) | OK |
| Taken | `GET …/tasks` / `POST` (`{name, project_id}`→201) / `DELETE` (204) | OK; **task verplaatsen = opnieuw POST, niet PATCH** (project plakt niet) |
| Planning-blokken | `GET …/time-blocks` | OK — dit zijn de **kalender/timeline-planblokken** |
| Status-IDs | Done=`300786`, Todo=`300785` | |
| Entry-eigenaar | veld `toggl_user_id` (niet `user_id`) | |
| 404 (bestaat niet) | `/clients`, `/tags`, `/statuses`, `/calendar`, `/reports/*`, `/me/time-entries` | info zit inline op tasks |

**Home-project automatisering:** `Automatisering administratie` project_id
`549584`, task `myPKA automatisering` task_id `12977094`, alles `billable:false`.

### 2c. Wat Focus (nog) niet via API blootlegt
- Geen reports/aggregatie-endpoint → aggregeren doen we zelf uit de
  time-entries-list, óf we lenen Track Reports v3 (zelfde workspace-data).
- Board/Capaciteit-specifieke velden: deels in `tasks` (status, assignee,
  deadline) en `time-blocks` (planning). Capaciteit = zelf rekenen
  (geplande blokken vs. werkuren per persoon).

---

## 3. Mapping — onze knop → welke API → welk product

> Dit is de "1-op-1 aansturen"-tabel. Knoppen in de M&T-tool, elk gekoppeld aan
> de juiste call. Aansturen van Focus = Bearer via Worker; terugkijken/aggregeren
> = Track Reports (alle users) of Focus-list.

| M&T-knop / feature | Actie | API-call | Product |
|---|---|---|---|
| **Agenda terugkijken** (week-kalender, alle medewerkers/projecten) | lees geboekte uren | `POST reports/api/v3/.../search/time_entries` (alle users) | Track |
| ↳ fallback eigen | eigen entries | `GET /me/time_entries` | Track |
| ↳ fallback Focus | incl. taskless | `GET focus …/time-entries?include_taskless=true` | Focus |
| **Filter project** | client-side + `project_ids[]` in report-body | Reports v3 | Track |
| **Filter persoon** | client-side + `user_ids[]` in report-body | Reports v3 | Track |
| **Timer start** | nieuwe lopende entry | `POST /workspaces/{ws}/time_entries` (`duration:-1`) | Track |
| **Timer stop** | stop lopende | `PATCH /workspaces/{ws}/time_entries/{id}/stop` | Track |
| **Handmatige entry / drag-range** | entry met start+duur | `POST …/time_entries` | Track |
| **Entry bewerken/slepen** | start/duur wijzigen | `PUT …/time_entries/{id}` of bulk-`PATCH` | Track |
| **Entry verwijderen** | weg | `DELETE …/time_entries/{id}` | Track |
| **Planblok (kalender) maken** | tijd-blok plannen | Focus `time-blocks` (+ task) | Focus |
| **Taak maken/Done/Todo** | board/kanban | Focus `POST/PATCH /tasks` + status-id | Focus |
| **Project koppelen** | mapping Toggl↔M&T-code | lokaal (`mt_toggl_project_map`) | — |
| **Persoon koppelen** | mapping Toggl-user↔teamlid | lokaal (`mt_toggl_user_map`) | — |
| **Capaciteit** (over/onderbezet) | geplande blokken vs werkuren | Focus `time-blocks` + teamlid-werkuren | Focus + lokaal |
| **Pomodoro / preset** | korte entry met vaste duur | `POST …/time_entries` | Track |
| **Autonoom boeken (nachtrun)** | automatiserings-tijd | `toggl_cli.py` / `toggl.py` (Focus Bearer) | Focus |

---

## 4. Wat er al staat (niet opnieuw bouwen)

- **uren.html** heeft al: Track-token-opslag, `togglFetch` (Basic), `/me`-test,
  project- en user-mapping-UI (`laadTogglMapping`, `slaTogglMappingOp`),
  `syncTogglEntries(dagen)` (importeert eigen entries → `mt_uren_entries`),
  timer-push (`togglTimerStart/Stop`). **Track-kant grotendeels gedekt.**
- **toggl_cli.py** (`C:\MT\Toggl\toggl_cli.py`) + **toggl.py** (nachtrun-CLI):
  Focus-kant (add/start/stop/patch/delete/projects/today/nightrun). **Focus-boeken gedekt.**
- **index.html** deelt origin → leest dezelfde localStorage (`mt_uren_entries`,
  `mt_projecten`, mappings, `mt_toggl_token`). De agenda-tab kan dus de reeds
  geïmporteerde data lezen zonder eigen sync.

## 5. Gaten t.o.v. "alles kunnen"

1. **Aggregatie over álle medewerkers** — `/me/time_entries` geeft alleen Bart.
   → Reports v3 `search/time_entries` (admin-token) toevoegen. **(nieuw)**
2. **Week-kalender tijd-blok-view** in de tool — bestaat als planning in uren.html,
   maar niet als terugkijk-agenda op geboekte uren. **(nieuw — dit bouwen we)**
3. **Focus 1-op-1 knoppen vanuit de webtool** — nu alleen via CLI. → Focus-calls
   via Worker-proxy zodat de browser-knoppen Focus kunnen aansturen. **(nieuw)**
4. **Webhooks/realtime** — optioneel later i.p.v. pollen. **(later)**
5. **Capaciteit/Board nábouw** — fase 2+. **(later)**

---

## 6. Concrete IDs + Worker-route (bouw-constanten)

Geverifieerd (2026-05-12, hergebruikt). Deze hardcoderen we in de Focus-knoppen
zodat we niet per call hoeven te zoeken. **Geen secrets — alleen IDs.**

### 6a. Focus status-IDs (kanban/board)
| Status | ID |
|---|---|
| Todo | `300785` |
| Backlog | `314194` |
| In Progress | `300788` |
| Blocked | `300787` |
| Klaar voor levering | `309790` |
| Done | `300786` |

### 6b. Focus tag-IDs (werkfasen — projectcode-systeem-relevant)
| Tag | ID |
|---|---|
| Offerte | `55267` |
| Calculatie | `60326` |
| Werkvoorbereiding | `54625` |
| Ontwerpen | `56896` |
| Productie | `56559` |
| Afwerking | `60325` |
| Montage | `60327` |
| Transport | `60329` |
| Factureren | `53694` |

### 6c. User-IDs (zelfde in Track én Focus — workspace `21258443`)
| Persoon | User-ID | Rol |
|---|---|---|
| Bart | `7289555` | admin |
| Mathijs | `7289451` | admin |
| Arjan | `7334139` | ZZP/medewerker |
| Maarten | `7331774` | medewerker |
| Jade | `7381167` | medewerker |

> Deze IDs voeden zowel de **`user_ids[]`-filter** in Reports v3 (Fase 2,
> alle-medewerkers terugkijken) als de **persoon-kleur/-filter** in de agenda-tab.
> Mappen naar teamlid-slugs gebeurt via `mt_toggl_user_map` (lokaal).

### 6d. Worker-proxy route (BEVESTIGD in `worker.js`, geen nieuwe backend nodig)
`worker.js` heeft al twee Toggl-targets ingebakken:
- **Track:** `?target=toggl&path=<v9-pad>` → voegt `Basic base64(TOGGL_KEY:api_token)` toe.
- **Focus:** `?target=toggl_focus&path=<focus-pad>` → voegt `Bearer TOGGL_FOCUS_KEY` toe.

Volledige URL: `https://mt-claude-proxy.bart-a12.workers.dev?target=toggl_focus&path=organizations/21259253/workspaces/21258443/<endpoint>`
Worker valideert MS-token (`X-Auth-Token`, alleen `@mortiseandtenon.nl`) +
`X-Claude-Key`. CORS staat alleen `https://mtbart.github.io` toe.

→ **Fase 3 (Focus 1-op-1 knoppen) heeft dus géén backend-bouw nodig** — alleen
front-end-knoppen die via deze route POST/PATCH/DELETE doen. Track Reports v3
(Fase 2) kan dezelfde Worker-route gebruiken als de browser CORS weigert
(`?target=toggl&path=reports/...` — let op: Worker-base is v9, voor reports
desnoods een aparte `target=toggl_reports` toevoegen).

---

_Bron-URLs: Toggl Track API v9 docs (engineering.toggl.com/docs/track),_
_Reports API v3 (api.track.toggl.com/reports/api/v3), Toggl Focus product +_
_Focus-API gotchas (reference_toggl_focus_api.md), eigen-tool-toggl-analyse.md_
_(IDs, 2026-05-12), worker.js (proxy-route). Opgesteld 2026-06-04._
