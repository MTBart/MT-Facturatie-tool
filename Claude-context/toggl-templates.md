# Toggl Focus — Projecttemplates & Geleerde Patronen

> Dit bestand wordt bijgehouden door Claude. Voeg NOOIT handmatig iets toe — Claude leert en schrijft hier naartoe.
> Laatste update: 2026-05-12

---

## Vaste Toggl-gegevens

### IDs
- **Organisation ID:** 21259253
- **Workspace ID:** 21258443

### Medewerkers
| Naam | E-mail | User ID |
|------|--------|---------|
| Bart | bart@mortiseandtenon.nl | 7289555 |
| Mathijs | mathijs@mortiseandtenon.nl | 7289451 |
| Arjan | arjan@mortiseandtenon.nl | 7334139 |
| Jade | jade@mortiseandtenon.nl | 7381167 |
| Maarten | maarten@mortiseandtenon.nl | 7331774 |

### Statuses
| ID | Naam | Gebruik |
|----|------|---------|
| 300785 | Todo 🗒️ | Standaard voor nieuwe taken |
| 314194 | Backlog 🅿️ | Taken die nog niet ingepland zijn |
| 300788 | In Progress 🚧 | Actief mee bezig |
| 300787 | Blocked 🚫 | Wacht op iets/iemand anders |
| 309790 | Klaar voor levering 🚛 | Productie klaar, wacht op transport |
| 300786 | Done ✅ | Afgerond |

### Tags
| ID | Naam | Kleur | Gebruik |
|----|------|-------|---------|
| 55267 | Offerte | #9447E1 | Offertetraject en klantcontact |
| 54625 | Werkvoorbereiding | #E024E0 | Voorbereiding productie |
| 56559 | Productie | #E024E0 | Maakfase |
| 56896 | Ontwerpen | #1AB233 | Tekeningen, 3D, details |
| 60326 | Calculatie | #C7A600 | Kosten- en tijdsberekening |
| 60325 | Afwerking | — | Lak, spuit, schuren |
| 60327 | Montage | — | Plaatsing bij klant |
| 60329 | Transport | — | Rijden en leveren |
| 53694 | Factureren | #FA9200 | Facturatie na oplevering |

### Prioriteiten
`none` | `low` | `medium` | `high` | `urgent`

---

## Projecttemplates

### 🍳 Keuken
Geschatte doorlooptijd: 6-12 weken | Standaard budget: 40-120 uur

**Standaard taken:**

| Taak | Tag | Geschat (min) | Status start | Toewijzing |
|------|-----|--------------|--------------|-----------|
| Ontwerp & Offerte | Offerte, Ontwerpen | 240 | Todo | Bart/Mathijs |
| ↳ Klantgesprek & opname | Offerte | 60 | Todo | Bart |
| ↳ 3D model uitwerken | Ontwerpen | 120 | Todo | Bart/Mathijs |
| ↳ Materiaalcalculatie | Calculatie | 30 | Todo | Bart |
| ↳ Offerte opstellen | Offerte | 30 | Todo | Bart |
| Werkvoorbereiding | Werkvoorbereiding | 180 | Backlog | Bart/Mathijs |
| ↳ Vectorworks tekeningen | Werkvoorbereiding | 120 | Backlog | Mathijs |
| ↳ CNC-bestanden aanmaken | Werkvoorbereiding | 30 | Backlog | Mathijs |
| ↳ Materiaal bestellen | Werkvoorbereiding | 30 | Backlog | Bart |
| Productie | Productie | 1200 | Backlog | Arjan/Mathijs |
| ↳ Plaatmateriaal frezen (CNC) | Productie | 240 | Backlog | Arjan |
| ↳ Onderdelen afwerken | Productie | 480 | Backlog | Arjan |
| ↳ Assemblage werkplaats | Productie | 360 | Backlog | Arjan/Mathijs |
| ↳ Spuiten & lak | Afwerking | 120 | Backlog | Arjan |
| Montage & Levering | Montage | 300 | Backlog | Bart/Arjan |
| ↳ Transport | Transport | 60 | Backlog | Bart/Arjan |
| ↳ Plaatsing bij klant | Montage | 180 | Backlog | Bart/Arjan |
| ↳ Nazorg & oplevering | Montage | 60 | Backlog | Bart |
| Facturatie | Factureren | 30 | Backlog | Bart |

---

### 🚪 Kast (inbouw / garderobekast)
Geschatte doorlooptijd: 3-6 weken | Standaard budget: 15-40 uur

| Taak | Tag | Geschat (min) | Status start |
|------|-----|--------------|--------------|
| Ontwerp & Offerte | Offerte, Ontwerpen | 150 | Todo |
| ↳ Klantgesprek & opmeten | Offerte | 45 | Todo |
| ↳ Tekening uitwerken | Ontwerpen | 60 | Todo |
| ↳ Offerte opstellen | Offerte | 45 | Todo |
| Werkvoorbereiding | Werkvoorbereiding | 90 | Backlog |
| ↳ CNC-bestanden | Werkvoorbereiding | 60 | Backlog |
| ↳ Materiaal bestellen | Werkvoorbereiding | 30 | Backlog |
| Productie | Productie | 480 | Backlog |
| ↳ Zagen & frezen | Productie | 180 | Backlog |
| ↳ Assemblage | Productie | 180 | Backlog |
| ↳ Afwerking | Afwerking | 120 | Backlog |
| Montage | Montage | 120 | Backlog |
| ↳ Plaatsing | Montage | 90 | Backlog |
| ↳ Nazorg | Montage | 30 | Backlog |
| Facturatie | Factureren | 20 | Backlog |

---

### 🪑 Tafel / meubel los stuk
Geschatte doorlooptijd: 2-4 weken | Standaard budget: 8-20 uur

| Taak | Tag | Geschat (min) | Status start |
|------|-----|--------------|--------------|
| Ontwerp & Offerte | Offerte, Ontwerpen | 90 | Todo |
| Productie | Productie | 360 | Backlog |
| ↳ Zagen & bewerken | Productie | 180 | Backlog |
| ↳ Assemblage | Productie | 120 | Backlog |
| ↳ Afwerking | Afwerking | 60 | Backlog |
| Levering | Transport | 60 | Backlog |
| Facturatie | Factureren | 15 | Backlog |

---

### 🚿 Badkamermeubel
Geschatte doorlooptijd: 3-5 weken | Standaard budget: 20-35 uur

| Taak | Tag | Geschat (min) | Status start |
|------|-----|--------------|--------------|
| Ontwerp & Offerte | Offerte, Ontwerpen | 150 | Todo |
| ↳ Klantgesprek & opmeten | Offerte | 60 | Todo |
| ↳ Tekening + sanitaircoördinatie | Ontwerpen | 60 | Todo |
| ↳ Offerte opstellen | Offerte | 30 | Todo |
| Werkvoorbereiding | Werkvoorbereiding | 60 | Backlog |
| Productie | Productie | 600 | Backlog |
| ↳ Watervaste bewerking | Productie | 240 | Backlog |
| ↳ Assemblage | Productie | 180 | Backlog |
| ↳ Afwerking waterbestendig | Afwerking | 180 | Backlog |
| Montage & Levering | Montage | 150 | Backlog |
| Facturatie | Factureren | 20 | Backlog |

---

### 🔧 Custom / Overig
Gebruik het interview-proces volledig — geen standaard template.

---

## Correcte API-patronen (uitgetest 2026-05-12)

### Taken ophalen per project
Gebruik de **stream** endpoint — de gewone /tasks endpoint negeert de project_ids filter:
```
GET /api/organizations/21259253/workspaces/21258443/tasks/stream?project_id={project_id}&archived=false&include_project_completed=true&source=focus
```
Returns: JSON array direct (geen paginering, geen SSE).

### Taak aanmaken
```
POST /api/organizations/21259253/workspaces/21258443/tasks
Body: { name, project_id, priority, tag_ids, status_id, assignee_user_ids, estimated_mins, parent_task_id, billable, start_date, end_date, description }
```

### Taak bijwerken (PUT)
```
PUT /api/organizations/21259253/workspaces/21258443/tasks/{task_id}
Body: { name, project_id, priority, tag_ids, status_id, assignee_user_ids, ... }
```
⚠️ **Altijd `project_id` meesturen bij PUT** — weglaten koppelt de taak los van het project!
⚠️ **Altijd `name` meesturen bij PUT** — is verplicht veld.

### Client zoeken
```
GET /api/workspaces/21258443/clients?name={naam}
```
(Let op: geen `/organizations/` prefix bij clients!)

### Project aanmaken
```
POST /api/organizations/21259253/workspaces/21258443/projects
Body: { name, client_id, color, estimated_mins, start_date, end_date, billable }
```

### Medewerker IDs (geverifieerd)
- **Bart** = `7289555` (accounthouder, ingelogd)
- **Mathijs** = `7289451`
- **Arjan** = `7334139`

---

## Geleerde Afwijkingen

> Claude schrijft hier naartoe als een niet-standaard taak meerdere keren voorkomt.
> Als een afwijking 2+ keer voorkomt, stelt Claude voor om het aan de standaard template toe te voegen.

| Datum | Projecttype | Afwijking | Aantal keer | Toegevoegd aan template? |
|-------|------------|-----------|-------------|--------------------------|
| — | — | — | — | — |

---

## Interview-checklist volgorde

Claude loopt ALTIJD deze vragen af voor een nieuw project:

1. **Klant** — Naam klant? Al bekend in Toggl? (zoek eerst)
2. **Type** — Keuken / kast / tafel / badkamer / custom?
3. **Details** — Afmetingen, bijzondere materialen, speciale wensen?
4. **Planning** — Gewenste opleverdatum? Wanneer start offerte/ontwerp?
5. **Urgentie** — Hoe urgent? (bepaalt prioriteit: urgent/high/medium/low)
6. **Uitvoerder(s)** — Wie doet wat? (Bart, Mathijs, Arjan, combinatie)
7. **Billable?** — Bijna altijd ja, tenzij intern/garantie/correctie
8. **Afwijkingen** — Zijn er taken die NIET in de standaard template zitten?

Na aanmaken:
9. **Leren** — Zijn er nieuwe taken bijgekomen? Wil je dat ik die onthoud voor volgende keer?
