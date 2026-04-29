# Uren App — detail context

> Laden bij elk werk aan uren.html.

## Bouwvolgorde — checklist

- [x] **Stap 1** — Data model migratie: nieuw taak-object (platte array), DEFAULT_BUCKETS, STD_WERKTIJDEN, Toggl-code verwijderd, migratiefunctie aangemaakt
- [x] **Stap 1b** — Sidebar-layout (Toggl-stijl): linker sidebar 210px + content-wrap full height; Timer-tab omgebouwd naar kalender-view met topbar-input
- [x] **Stap 2** — Vandaag-tab: renderKalender(), nu-lijn, dag/3d/week toggle, auto-scroll 07:00
- [x] **Stap 3** — Taak-modal: universeel, `openTaakModal(taakId)`, subtaken, timer starten, auto-save, Outlook-flag
- [ ] **Stap 4** — Bord-tab (Kanban): drag & drop, buckets, huidige "Bord" → "Muur"
- [ ] **Stap 5** — Taken-tab: tabeloverzicht met filters
- [ ] **Stap 6** — Timeline verbeteringen: capaciteitsbalk, drag-to-create, vrije dagen weergave
- [ ] **Stap 7** — Project-detail panel: slide-in rechts, `openProjectPanel(projectCode)`
- [ ] **Stap 8** — Vrije dagen beheer: instellingen + timeline weergave
- [ ] **Stap 9** — Weekafsluiting: rapport + export platte tekst
- [ ] **Stap 10** — Mobiele optimalisatie: <768px responsive
- [ ] **Stap 11** — Vectorworks koppeling: knop + functie in index-v4.html
- [ ] **Stap 12** — Pauze-meldingen: werktijden instelbaar in admin

## Harde regels
- Geen breaking changes op: `mt_uren_entries`, `mt_uren_planning`, `mt_projecten`, `mt_uren_teamleden`
- Nieuwe keys: altijd `mt_uren_` prefix
- Toggl-code: volledig verwijderd (klaar)
- Werkmethode: str_replace (Edit tool), NOOIT volledig herschrijven
- Test na elke stap: `http://localhost:3456/uren.html`
- Commit na elke stap: `feat(uren): stap X — omschrijving`
- Timer-balk altijd zichtbaar (behalve Muur fullscreen)

## Huisstijl
`--green: #2A4A38` | `--gold: #B8962E` | `--bg: #F7F5F0`
Fonts: Fraunces (headings) + Figtree (body) + DM Mono (code/getallen)

## localStorage keys
| Key | Inhoud |
|---|---|
| `mt_uren_taken` | Taken (platte array, nieuw model) |
| `mt_uren_entries` | Tijdregistraties |
| `mt_uren_planning` | Planblokken |
| `mt_uren_teamleden` | Teamleden |
| `mt_uren_buckets` | Kanban buckets |
| `mt_uren_sjablonen` | Taaksjablonen |
| `mt_uren_vrije_dagen` | Geblokte dagen |
| `mt_uren_werktijden` | Werkschema |
| `mt_projecten` | Gedeeld met index-v4.html |

## Data modellen

### Taak object (nieuw — platte array)
```js
{
  id: uid(),
  project_code: 'CN-PRINS-GARDEROBE',
  naam: 'Werkvoorbereiding',
  status: 'todo',          // 'todo'|'in_progress'|'blocked'|'review'|'backlog'|'done'
  bucket_id: 'todo',
  prioriteit: null,        // null|'low'|'medium'|'high'
  tags: [],
  estimate_h: null,
  assignees: [],           // ['Bart','Maarten']
  from_date: null,         // 'YYYY-MM-DD'
  to_date: null,
  billable: false,
  omschrijving: '',
  subtaken: [{ id: uid(), naam: '', gedaan: false, assignee: null }],
  notities: '',
  sjabloon_id: null,
  aangemaakt: ISO,
  gewijzigd: ISO
}
```

### DEFAULT_BUCKETS
```js
[
  { id: 'todo',        naam: 'Todo',               kleur: '#6B6455', volgorde: 0 },
  { id: 'in_progress', naam: 'In Progress',         kleur: '#1a3a8b', volgorde: 1 },
  { id: 'blocked',     naam: 'Blocked',             kleur: '#8B1A1A', volgorde: 2 },
  { id: 'review',      naam: 'Klaar voor levering', kleur: '#B8962E', volgorde: 3 },
  { id: 'backlog',     naam: 'Backlog',             kleur: '#5a3a8b', volgorde: 4 },
  { id: 'done',        naam: 'Done',                kleur: '#2A4A38', volgorde: 5 }
]
```

### STD_WERKTIJDEN
```js
{ start:'07:15', pauze_1:'10:00', werkoverleg:'10:15', lunch_start:'13:00', lunch_eind:'13:30', einde:'17:00', meldingen_actief:true }
```

### Teamlid object (uitbreiding t.o.v. oud)
```js
{ /* bestaande velden */ beschikbaar_h_week: 40, rol: 'werkplaats', meldingen_aan: true }
```

## Timer-flows

### Flow 1 — Maarten (start → selecteer)
1. Start timer (grote knop, geen taak geselecteerd)
2. Terwijl timer loopt: selecteer project + taak
3. Stop timer na afronding

### Flow 2 — Arjan (achteraf invullen)
1. Werk gewoon
2. ~10:00 pauze: "Uren toevoegen" modal → datum + begin/eindtijd + project + taak
3. ~13:00 en einde dag: herhalen
Beide flows moeten even snel/intuïtief werken.

## Pauze-meldingen
Zachte toast op: 10:00, 13:00 (instelbaar). Tekst: "☕ Pauze! Vergeet je uren niet."
Per persoon aan/uit te zetten in instellingen.

## Werkplaats-muurscherm (cruciale requirement)
- Groot touchscreen, dagelijks aan
- Iedereen ziet elkaars uren en taken
- Zichtbaar als iemand uitloopt → bijspringen mogelijk
- "Muur"-tab = fullscreen view hiervoor (was "Bord"-tab)

## Navigatiepatroon (universeel)
| Klik | Resultaat |
|---|---|
| Taaknaam / kaartje | Taak-modal |
| Projectcode / naam | Project-detail panel (slide-in rechts) |
| Persoon-chip | Filter actieve view |
| Lege dagcel (timeline) | Plan toevoegen modal |
| ▶ op taak | Start timer direct |

## Standaard taaksjabloon
```
Werkvoorbereiding  — 8h   — tags: Admin
Inkoop materiaal   — 2h   — tags: Inkoop
Productie          — 40h  — tags: Productie  (subtaken uit Vectorworks CSV)
Afwerking          — 8h   — tags: Productie
Montage            — 8h   — tags: Montage
Oplevering         — 2h   — tags: Admin
```

## Toekomstige features (bewust uitgesteld)
- Outlook agenda sync (stap na 12)
- PWA installeerbaar (manifest.json) — stap 12
- Drag-to-create timeline — stap 6
- SharePoint Graph API sync voor cross-device uren-sync (wacht op token)

## Screenshots referentie
`.claude/screenshots/README.md` — 6 Toggl Focus screenshots beschreven als design referentie.
