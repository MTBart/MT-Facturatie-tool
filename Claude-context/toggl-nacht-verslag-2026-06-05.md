AKKOORD NODIG: `git push origin main` om 4 commits live te zetten.

# Toggl-nacht-verslag — 2026-06-05 (autonome run, /effort ultra)

> Geschreven door Larry. Alles staat **lokaal gecommit, NIET gepusht**. Eén gate
> voor jou: de push hierboven. Daarna staat het volledige Toggl-tabblad + de
> agenda-lijstview live op GitHub Pages (~5 min rebuild).

## TL;DR
Een volwaardig **Toggl-tabblad** is gebouwd in `index.html` dat Track + Focus
1-op-1 aanstuurt via de Worker, plus een **timer-lijst-view** in de agenda.
Additief, eigen `tg-`-namespace, factuur-/agenda-/Focus-flow ongemoeid. Syntax
schoon (`scripts:4 bad:0`). Niets live gemuteerd (zie "test" hieronder — kon niet
veilig lokaal, hoort in-browser).

## De 4 commits (ongepusht, op `main`)
1. `f6a87ad` — UX-batch (inbox-layout, topbalk, agenda-dropdown) — stond al klaar.
2. `0bdad77` — Agenda all-time-totalen + bladerpijlen + 365d-window + Reports-paginatie — stond al klaar.
3. `06137e6` — **Toggl-tab** (Timer/Projecten/Taken/Board/Reports/Clients+Tags).
4. `f6f9591` — **Agenda timer-lijst-view** (grid/lijst-toggle).

(1 en 2 waren al lokaal gecommit van eerdere sessies; ze gaan in dezelfde push mee.)

## Wat het Toggl-tabblad doet (commit 06137e6)
Nieuw tabblad **⏱️ Toggl** met sticky timerbar + 6 subsecties:

| Subsectie | Bron | Functies | Schrijfacties (confirm-gated) |
|---|---|---|---|
| **Timer** (Track) | `me/time_entries/current`, `/me/time_entries` | lopende timer met live tikkende klok, recente eigen entries (14d), "hervat" | start (POST duration:-1), stop (PATCH /stop) |
| **Projecten** (Focus) | `{FBASE}/projects` | kaarten met tracked-totaal-balken, raming, tags | nieuw project (Track POST) |
| **Taken** (Focus) | `{FBASE}/tasks` | lijst + status-dropdown + duur | status zetten (PATCH), nieuwe taak (POST) |
| **Board** (Focus) | tasks per status | kanban 6 kolommen, drag-drop | status zetten bij drop (PATCH) |
| **Reports** (Reports v3) | `workspace/{ws}/search/time_entries` | per project/persoon/dag, alle medewerkers, balken + totaal | — (read-only) |
| **Clients & Tags** (Track) | `workspaces/{ws}/clients`,`/tags` | lijsten | client/tag aanmaken (POST) |

**Data-laag `tgStore`** (STAP 4): backend-switch `toggl` (nu, volledig) vs
`lokaal` (stub met TODO's voor latere standalone-modus via SharePoint/localStorage).
Standalone wordt zo later een config-switch, geen herbouw.

Alle transports lopen via de Worker (`target=toggl` / `toggl_focus` /
`toggl_reports`) — geen Toggl-token in de browser, MS-login volstaat.
Alle writes zitten achter een `confirm()`. Niets hardcoded behalve de generieke
workspace/org/status/-IDs die al in de tool stonden.

## Wat de agenda-lijstview doet (commit f6f9591) — §6b punt 2
Toggle **▦ Rooster / ≣ Lijst** in de agenda-toolbar. De lijst spiegelt de
Toggl-timer-view: per dag entries met project-kleur, omschrijving, start–stop,
duur rechts — **plus een collega-kolom** zodat je ieders tijd ziet, niet alleen
je eigen. Deelt week-window, filters, totalen en bladerpijlen met de grid; grid
blijft default. §6b punt 3 (filters werkend in nieuwe view) = klaar (deelt
`agZichtbaar`).

## Getest
- **Syntax:** `new Function`-check over alle 4 inline scripts → `bad:0` (na de
  Toggl-tab én na de lijstview).
- **Focus-response-vormen:** vorige sessie live READ-ONLY bevestigd (zie
  `toggl-capability-matrix.md`).
- **Worker-routes:** `target=toggl` (GET) + `toggl_reports` (POST) zijn al
  bewezen-live via de agenda (`agNamen`/`agSyncAlleMedewerkers`). De Worker
  forwardt method+body identiek, dus het POST/PATCH/DELETE-pad volgt.

## Niet getest (eerlijk) — hoort bij jouw in-browser controle
- **Eén live test-entry kon ik níét lokaal doen.** De Track-admin-token zit
  alléén in de Worker; de lokale `toggl.json` heeft alleen de Focus-token en die
  gaf vannacht **401 (invalid_session)** — verlopen sinds vorige sessie. Ik kon
  dus geen schone create→delete vanaf de PC draaien zonder secrets te misbruiken,
  dus heb ik dat **niet** gedaan (geen valse "getest"-claim).
  → **Actie voor jou na de push:** open ⏱️ Toggl, start een test-timer en stop +
  verwijder 'm; maak één testtaak op het board en sleep 'm; check of de
  confirm-dialogen kloppen. Alles is undo-baar (stop/delete-knoppen).
- **§6b punt 1 — bank-joris-discrepantie verifiëren:** vereist een live Reports-
  call met de admin-token (Worker-only) → kon ik om dezelfde reden niet vanaf de
  PC doen. Doe dit in-browser: open de Reports-subsectie, groepeer per project,
  vergelijk "bank joris" met de ~81u39m uit Focus. Wijkt het af, dan zit een deel
  van de uren alleen in Focus (taak-entries) en niet in Track Reports — dat
  documenteren we dan en halen we er via `target=toggl_focus` bij.

## Veiligheid / hygiëne
- Alleen `index.html` expliciet gecommit (nooit `git add -A`). De
  `Claude-context/`-docs zijn tracked in de PUBLIC repo, dus die laat ik als
  working-tree-wijziging staan — **niet** mee-committen. ⚠️ Let op: `git status`
  toont `toggl-volledige-tab-OPDRACHT.md` + `toggl-capability-matrix.md` als
  wijziging; die horen NIET in een commit (kunnen klantdetails bevatten).
- Secret-guard gaf bij beide commits "schoon". Backups gemaakt door de hook.
- Worker **niet** opnieuw gedeployed (niet nodig — routes bestonden al).
- Geen PII/secrets in `index.html`.

## Open / vervolg
- In-browser rooktest van de schrijfacties (zie boven).
- bank-joris-verificatie (zie boven).
- `tgLokaal`-backend echt invullen (standalone-modus) — nu nog stub.
- Optioneel later: entry bewerken/verwijderen-UI in de Timer-subsectie,
  project-kleur/archiveren-edit, subtaken, prioriteit/assignee op taken
  (endpoints staan in de capability-matrix, UI nog niet gebouwd).
