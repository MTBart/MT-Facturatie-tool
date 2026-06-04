# Bouwplan — Toggl Agenda/Timeline-tab in index.html

> Bart, 2026-06-04: "timeline agenda-view op een tabblad, filteren op projecten
> en/of personen, in de agenda zien hoeveel uur er aan welk project gewerkt is,
> data uit Toggl." Keuzes (bevestigd): **in index.html**, **week-kalender
> (tijdblokken)** Outlook-stijl, **live browser-sync** (bestaande uitbreiden).
> Daarbovenop: **álle medewerkers/projecten terugkijken** + later **Focus 1-op-1
> aansturen** + **autonoom**. Volledige functie-context: `toggl-functie-inventaris.md`.

## Architectuur-principes
- **Additief, breekt de live factuur-flow niet.** Nieuwe tab + nieuw script-blok,
  geen wijziging aan bestaande functies.
- **index.html deelt origin met uren.html** → leest dezelfde localStorage:
  `mt_uren_entries` (geïmporteerde Toggl-entries), `mt_projecten`,
  `mt_teamleden`, `mt_toggl_token`, `mt_toggl_project_map`, `mt_toggl_user_map`.
- **index.html = ~3700 regels, alleen Edit (str_replace), nooit volledig herschrijven.**
- **Tokens nooit in repo.** Track-token zit al in browser-localStorage (door uren.html).
  Focus-Bearer blijft server-side via Cloudflare Worker.

## Datamodel (bestaand, hergebruiken)
`mt_uren_entries` record (uit `syncTogglEntries`):
```
{ id, toggl_id, teamlid, project_code, taak_naam, omschrijving,
  start (ISO), stop (ISO), duur (sec), datum (YYYY-MM-DD) }
```
Dit is genoeg voor de week-kalender: `start`+`duur` → blok-positie, `teamlid` +
`project_code` → filter + kleur.

## Fasering

### Fase 1 — Agenda-tab op bestaande data (NU bouwen)
1. Nav-knop `📅 Agenda` + `<div id="tab-agenda">`.
2. `showTab('agenda')` → `renderAgenda()`.
3. **Week-kalender**: 7 dag-kolommen (ma–zo), verticale tijd-as (bv. 06:00–22:00).
   Elke entry uit `mt_uren_entries` wordt een blok op start-tijd, hoogte ∝ duur,
   kleur = project- of persoon-kleur. Overlap = naast elkaar.
4. **Week-navigatie**: ◀ vorige / vandaag / volgende ▶.
5. **Filters**: multiselect project(en) + multiselect perso(o)n(en); leeg = alles.
6. **Toggle kleur-op**: per project óf per persoon.
7. **Totalen-balk**: som uren in zicht, uitgesplitst per project en per persoon.
8. Klik op blok → detail (omschrijving, taak, duur, teamlid, project).
9. Knop **⬇ Sync nu** → roept de bestaande Track-sync aan (zie Fase 2 voor de
   index.html-eigen kopie) en hertekent.

### Fase 2 — Eigen sync in index.html + álle medewerkers
- Kopieer de minimale Track-helpers naar index.html (`togglFetch` Basic, token uit
  gedeelde localStorage) zodat index.html zelfstandig kan syncen (niet afhankelijk
  van het openen van uren.html).
- **Reports API v3 `search/time_entries`** (admin-token) → entries van **álle**
  workspace-gebruikers, niet alleen Bart. Mappen naar hetzelfde record-formaat en
  in `mt_uren_entries` mergen (dedup op `toggl_id`). CORS faalt? → via Worker proxy.
- Filter-body server-side: `project_ids[]`, `user_ids[]`, `start_date/end_date`.

### Fase 3 — Focus 1-op-1 aansturen vanuit de tab
- Worker-route `/toggl/focus/*` die Bearer toevoegt (token = Worker-secret
  `TOGGL_FOCUS_KEY`). Knoppen: planblok maken (`time-blocks`), taak Done/Todo,
  entry maken/slepen/verwijderen. POST→PATCH-task_id-patroon ingebakken.
- Drag-to-create op de kalender → maakt direct een Focus-entry/planblok.

### Fase 4 — Autonoom / nachtrun
- Aggregatie-snapshots wegschrijven (per week JSON) zodat de cockpit ook offline
  totalen toont. Nachtrun (`toggl_cli.py`/`toggl.py`) vult + verifieert.
- Optioneel Webhooks i.p.v. pollen voor realtime.

## Veiligheid / grenzen
- Fase 1 is **read-only** op reeds-geïmporteerde lokale data → nul risico.
- Schrijf-acties (Fase 3) = mutaties op de live Toggl → eerst op één entry testen,
  undo bieden, geen bulk zonder OK (zelfde discipline als mail-moves).
- Geen push naar de PUBLIC repo zonder Bart-OK; geen secrets/PII in commits.

## Verificatie
- Fase 1: open index.html → tab Agenda → toont de uren die uren.html importeerde,
  week-navigatie + filters werken, totalen kloppen met de Rapport-tab in uren.html.
