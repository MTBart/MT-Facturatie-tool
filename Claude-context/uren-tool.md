# uren.html — interne urenregistratie/planning tool

Lees dit als een vraag gaat over: uren, planning, kanban, timeline, taken, Vectorworks-import (stap 11), milestones, urenrapport, weekafsluiting, agenda.

## Basis
- **Bestand:** `uren.html` (~4700 regels, single file, geen bundler)
- **Live URL:** https://mtbart.github.io/MT-Facturatie-tool/uren.html
- **Branch:** `claude/hardcore-shaw-73041c`
- **Worktree:** `.claude/worktrees/hardcore-shaw-73041c/`

## Werkwijze
- **Altijd Edit (str_replace), nooit volledig herschrijven** — file is te groot
- Commit per stap: `feat(uren): stap X — omschrijving`
- Push naar `claude/hardcore-shaw-73041c`

## Tabs/views
Projecten · Timer · Dag (kalender) · Timeline · Projecten-rapport · Bord (muurscherm)
Plus: Taken-tab, Kanban, Agenda, Weekafsluiting, Instellingen.

## Datamodellen
```js
// Taak
{ id, project_code, naam, status, bucket_id,
  prioriteit, tags, estimate_h, assignees,
  from_date, to_date, billable, omschrijving,
  subtaken: [{id, naam, gedaan, assignee}],
  aangemaakt, gewijzigd }

// Planning blok
{ id, datum, teamlid, project_code, taak_id,
  uren_gepland, locatie, reistijd_voor_min, reistijd_na_min }

// Milestone
{ id, naam, project_code, datum, type }
// type: 'deadline'|'oplevering'|'plaatsing'|'revisie'|'overig'
```

## localStorage keys (NIET hernoemen)
`mt_uren_taken` · `mt_uren_entries` · `mt_uren_planning` · `mt_uren_teamleden` ·
`mt_uren_buckets` · `mt_uren_sjablonen` · `mt_uren_vrije_dagen` · `mt_uren_werktijden` ·
`mt_uren_milestones` · `mt_projecten`

## Bouwvolgorde
| Stap | Wat | Status |
|---|---|---|
| 1–10 | Datamodel, sidebar, kalender, modal, kanban, taken, timeline, agenda, panel, instellingen, weekafsluiting, nachtplan A–G, mobile responsive | OK |
| **11** | **Vectorworks koppeling** | Open — zie STATUS.md |
| 12 | Pauze-meldingen (werktijden instelbaar) | Open |

## Open punten
- **Cloud sync** — alles staat nu in localStorage. Bij browser cache wissen → data weg. SharePoint Graph token ontbreekt nog. Risico! Backup via Cowork-scheduled-task is in onderzoek.
- **Reistijd in capaciteitsbalk** — `reistijd_voor_min`/`reistijd_na_min` zitten op planblokken maar tellen nog niet mee in de balk.
- **Reistijd in nacalculatie** — aparte kolom in rapport, na werkbaar model.
- **Vectorworks-import** — stap 11. Voorkeur: directe upload vanuit Vectorworks zelf (plugin), zoals InteriorCAD doet. Anders handmatig CSV via taak-modal.

## Case-insensitive
Teamlid-namen zijn lowercase in `STD_TEAMLEDEN` (bijv. `bart`) maar kunnen hoofdletters hebben in entries/planning. Altijd `.toLowerCase()` bij vergelijken.
