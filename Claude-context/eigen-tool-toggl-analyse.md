# Analyse: Toggl Focus Functionaliteiten → Eigen Tool

> Doel: alles wat we in Toggl Focus gebruiken volledig begrijpen en documenteren,
> zodat we het later kunnen nabouwen in de eigen tool (opvolger van index-v4.html / uren.html).
> Gemaakt op: 2026-05-12 op basis van live API-exploratie en documentatie.

---

## 1. Datamodel — Entiteiten en relaties

```
Organisation (21259253)
└── Workspace (21258443)
    ├── Clients
    │   └── naam, id
    ├── Projects
    │   ├── naam, kleur, client_id, estimated_mins
    │   ├── start_date, end_date
    │   ├── billable, private, archived
    │   └── status (active/completed/archived)
    ├── Tasks
    │   ├── naam, description, estimated_mins
    │   ├── project_id, parent_task_id (voor subtaken)
    │   ├── assignee_user_ids (meerdere personen)
    │   ├── status_id → koppeling naar Status
    │   ├── tag_ids → koppeling naar Tags
    │   ├── priority (none/low/medium/high/urgent)
    │   ├── billable, start_date, end_date
    │   ├── pinned, private
    │   └── auto_log_time
    ├── Statuses (workspace-niveau, aanpasbaar)
    ├── Tags (workspace-niveau, aanpasbaar)
    ├── Time Entries (tijdregistraties per taak)
    ├── Time Blocks (ingeplande blokken per dag)
    └── Users
```

---

## 2. Statuses (M&T workspace)

| ID | Naam | Type | Emoji | Gebruik |
|----|------|------|-------|---------|
| 300785 | Todo | todo | 🗒️ | Actieve nieuwe taken |
| 314194 | Backlog | in_progress | 🅿️ | Nog niet ingepland |
| 300788 | In Progress | in_progress | 🚧 | Mee bezig |
| 300787 | Blocked | blocked | 🚫 | Wacht op iets |
| 309790 | Klaar voor levering | in_progress | 🚛 | Productie klaar |
| 300786 | Done | done | ✅ | Afgerond |

**Voor eigen tool:** Kopieer dit statusmodel exact. De `type` bepaalt gedrag (done-taken verdwijnen uit actieve view).

---

## 3. Tags (M&T workspace)

| ID | Naam | Kleur | Gebruik in workflow |
|----|------|-------|---------------------|
| 55267 | Offerte | #9447E1 | Klantcontact en offertetraject |
| 54625 | Werkvoorbereiding | #E024E0 | Voorbereiding productie |
| 56559 | Productie | #E024E0 | Maakfase |
| 56896 | Ontwerpen | #1AB233 | Tekeningen en 3D |
| 60326 | Calculatie | #C7A600 | Kosten- en tijdsberekening |
| 60325 | Afwerking | — | Lak, spuit, schuren |
| 60327 | Montage | — | Plaatsing bij klant |
| 60329 | Transport | — | Rijden en leveren |
| 53694 | Factureren | #FA9200 | Facturatie |

**Voor eigen tool:** Tags zijn de primaire manier om taken te filteren op fase. Implementeer als kolom in kanban of als filteroptie.

---

## 4. Prioriteiten

Waarden: `none` | `low` | `medium` | `high` | `urgent`

**Voor eigen tool:** Eenvoudig te implementeren als dropdown of kleurcodering per kaart.

---

## 5. Task-hiërarchie (taken en subtaken)

- Taken kunnen genest worden via `parent_task_id`
- Toggl toont `sub_task_done_count` en `sub_task_total_count` op de ouder-taak
- Subtaken erven NIET automatisch project of assignee — dit moet expliciet meegegeven worden
- Maximale nesting: in de UI lijkt 2 niveaus het meest gebruikt (taak → subtaak)

**Voor eigen tool:** Implementeer als tree-structuur in de database. Eerste versie: max 2 niveaus.

---

## 6. Tijdregistratie

- `estimated_mins` → schatting bij aanmaken
- `total_tracked_time` → werkelijke geregistreerde tijd (seconden)
- `time_block_*` counts → ingeplande blokken op de tijdlijn
- `auto_log_time` → kan automatisch tijd bijhouden (zelden gebruikt)

**Verschil geschat vs werkelijk:** Toggl toont beide. Dit is cruciaal voor nacalculatie.

**Voor eigen tool:** Sla beide op. Toon als voortgangsbalk (geschat) + werkelijk getal.

---

## 7. Time Blocks (planning)

Time blocks zijn losse planningsblokken op de kalender/tijdlijn, los van taken.
- Gekoppeld aan een taak (optioneel)
- Hebben een datum + duur
- Zichtbaar in de Timeline-view

**Voor eigen tool:** Dit is de "planning op de dag"-functionaliteit die we willen nabouwen.
De huidige `uren.html` doet dit al deels — verbinden met het taakmodel.

---

## 8. Users / medewerkers

| ID | Naam | Rol |
|----|------|-----|
| 7289555 | Bart | Eigenaar |
| 7289451 | Mathijs | Eigenaar |
| 7334139 | Arjan | ZZP via Inter Projecten |
| 7381167 | Jade | — |
| 7331774 | Maarten | — |

**Voor eigen tool:** User-model met rollen. Arjan is extern (ZZP) — aparte behandeling voor urenregistratie en facturatie.

---

## 9. Clients

- Simpel model: `id`, `naam`, `workspace_id`, `active`
- Geen KvK, adres of contactpersoon in Toggl → die zitten in Moneybird
- Koppeling Toggl ↔ Moneybird: via klantnaam (geen native koppeling)

**Voor eigen tool:** Clients zijn de primaire entiteit. Koppel aan Moneybird via `client_id` (Moneybird) opgeslagen als custom field.

---

## 10. Billable tracking

- `billable` op zowel project- als taakniveau
- Toggl Focus heeft geen tarieven per taak (wel per project via rates-endpoint)
- Tarieven zitten in de `rate`-object op projectniveau: `hourly_rate`, `currency`, `billable`

**Voor eigen tool:** Sla uurtarief op per project (en overschrijfbaar per taak). Bereken factuurbedrag automatisch op basis van tracked_time × tarief.

---

## 11. Views die we willen nabouwen

### Huidige Toggl views:
| View | Wat het doet | Prioriteit eigen tool |
|------|-------------|----------------------|
| Timeline | Taken op kalender per dag/week | ⭐⭐⭐ Hoog |
| Task board (kanban) | Taken per status gesorteerd | ⭐⭐⭐ Hoog |
| Project overview | Taken per project, voortgang | ⭐⭐⭐ Hoog |
| My work | Alleen taken van ingelogde user | ⭐⭐ Medium |
| Reports | Uren per project/persoon/periode | ⭐⭐⭐ Hoog |

---

## 12. API-patronen die we gebruiken (technisch)

### Authenticatie
- Bearer token: **[REDACTED — staat als Worker-secret `TOGGL_FOCUS_KEY`, en in `~/.mt-secret/toggl.json`]**
  (nooit klare tekst in repo-werkmap; PUBLIC repo)
- Via Cloudflare Worker als proxy (beschermt de token)
- Worker URL: `https://mt-claude-proxy.bart-a12.workers.dev?target=toggl_focus&path=[endpoint]`

### CRUD-patronen
```
GET    /api/workspaces/{ws_id}/clients
POST   /api/workspaces/{ws_id}/clients
GET    /api/organizations/{org_id}/workspaces/{ws_id}/projects
POST   /api/organizations/{org_id}/workspaces/{ws_id}/projects
GET    /api/organizations/{org_id}/workspaces/{ws_id}/tasks
POST   /api/organizations/{org_id}/workspaces/{ws_id}/tasks
PATCH  /api/organizations/{org_id}/workspaces/{ws_id}/tasks/{id}
DELETE /api/organizations/{org_id}/workspaces/{ws_id}/tasks/{id}
GET    /api/workspaces/{ws_id}/statuses
GET    /api/workspaces/{ws_id}/tags
GET    /api/organizations/{org_id}/users
```

### CORS-beperking (belangrijk!)
- Worker staat alleen `https://mtbart.github.io` toe als origin
- Directe calls vanuit `focus.toggl.com` werken (zelfde domein)
- Oplossing voor eigen tool: worker CORS uitbreiden of eigen backend

---

## 13. Migratiestrategie (Toggl → Eigen tool)

### Fase 1: Parallel draaien (nu)
- Toggl Focus voor projectbeheer en planning
- Claude maakt aan in Toggl via browser-automatisering
- Eigen tool (uren.html) voor tijdregistratie werkplaats

### Fase 2: Uitbreiden eigen tool
- Projecten, taken en subtaken in eigen tool bouwen
- Koppelen aan Moneybird voor facturatie
- Koppelen aan Toggl Focus voor tijdregistratie (of eigen implementatie)

### Fase 3: Vervanging
- Eigen tool wordt primair systeem
- Toggl Focus optioneel (export als backup)
- Volledige koppeling: Klant → Project → Taken → Uren → Factuur

### Wat we NIET willen overnemen van Toggl:
- De prijsstelling (per user per maand)
- De complexe organisatie/workspace-structuur
- Time blocks (te complex voor werkplaats-context)

### Wat we WEL willen overnemen:
- Het statusmodel (Todo/Backlog/In Progress/Blocked/Done)
- Taak-hiërarchie (project → taak → subtaak)
- Tijdschatting vs. werkelijke tijd
- Billable tracking per project
- Tags voor fasefiltering
- Prioriteiten
- Toewijzing aan medewerkers

---

## 14. Aanbevelingen voor eigen tool

1. **Gebruik Moneybird als klantdatabase** — niet dupliceren in eigen tool
2. **Projectnummer als primaire sleutel** — bijv. `26-018` — koppelt NAS-map, Moneybird en eigen tool
3. **Offline-first** — de werkplaats heeft soms geen stabiele verbinding; localStorage als cache, sync bij verbinding
4. **Mobiel-vriendelijk** — Bart en Mathijs werken ook op telefoon
5. **Spraakgestuurd** — integreer Claude voor aanmaken via spraak (al bewezen vandaag)
6. **Nacalculatie** — sla altijd geschatte én werkelijke uren op per taak; toon verschil
7. **Facturatieflow** — koppel aan Moneybird: 1 klik van "Done" naar conceptfactuur
