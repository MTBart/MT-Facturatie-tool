# STATUS — 2026-04-29

## Gedaan in deze sessie
- Context-reorganisatie: CLAUDE.md compact, .claude/ctx/ aangemaakt (9 bestanden)
- renderKalender(): Toggl-stijl kalender-view, nu-lijn, dag/3d/week toggle, auto-scroll 07:00
- Concept-projecten flow: snel aanmaken, badge in sidebar, activeer-modal met code+MB+sjabloon
- Agenda-tab (was Timer), cross-link sidebar → index-v4.html

## Volgende stap — stap 3: Taak-modal
`openTaakModal(taakId)` — universeel aanroepbaar vanuit Agenda, Taken, Bord, Timeline.
Inhoud: taaknaam (editbaar), project, omschrijving, subtaken, timer-knop, status, assignees, estimate.
Zie `.claude/ctx/uren.md` voor volledig ontwerp.

Extra uit gesprek:
- Agenda-tab: Outlook-sync (Graph API token nodig — blocker), agenda-punten tonen als blokken
- Taak aanmaken: checkbox "Aanmaken als Outlook-afspraak" (achter feature-flag tot token beschikbaar)
- Timeline-tab: alle 4 agenda's in één overzicht (werkplaatsscherm)
- index-v4.html: cross-link "Ga naar Uren" toevoegen + concept-badge op Dashboard

## Blockers
- SharePoint/Outlook Graph API token ontbreekt (sync + agenda-koppeling)

## Live URLs
- Tool: https://mtbart.github.io/MT-Facturatie-tool/index-v4.html
- Uren: https://mtbart.github.io/MT-Facturatie-tool/uren.html

## Actieve context
`.claude/ctx/uren.md`, `.claude/ctx/bekende_problemen.md`
