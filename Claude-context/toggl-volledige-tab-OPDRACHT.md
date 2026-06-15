# NACHT-OPDRACHT (02:30, /effort ultra) — Volledig Toggl-tabblad in de cockpit

> Geschreven 2026-06-04 door Larry voor de autonome 02:30-sessie van 2026-06-05.
> **Draai op /effort ultra (denkwerk) + bouw op je eigen oordeel (4.7 mag).**
> **Werk autonoom door, stop NIET voor input. Bouw zo ver je komt. Laat exact ÉÉN
> akkoord-gate over voor Bart als hij wakker is (= de go-live push).**

## 1. Wat Bart écht wil (zijn woorden, 2026-06-04)

Een volwaardig **Toggl-tabblad** in de online cockpit (`index.html`) dat **álle
functionaliteit van Toggl Track én Toggl Focus 1-op-1 nabouwt**: alle knoppen,
buttons, sliders, de manieren om taken en projecten in te vullen, en de hele
opbouw van Toggl gekopieerd. De functies **1-op-1 gelinkt** aan de Toggl-API,
zodat we **vanuit de tool-omgeving Toggl 1-op-1 kunnen aansturen**. In een later
stadium moet hetzelfde tabblad ook **los van Toggl** kunnen draaien (eigen
data-laag, Toggl wordt dan optionele sync i.p.v. bron).

Dit is dus véél breder dan de huidige agenda-viewer + Focus-modal. Het is de
complete Toggl-vervanger-UI.

## 2. Wat er AL staat (geverifieerd, niet aannemen — check regelnrs vóór bouw)

In `index.html` (live, GitHub Pages → `main`):
- **Agenda-tab (Fase 1-3, LIVE):** week-kalender op `mt_uren_entries`, filters,
  totalen, kleur per project/persoon, overlap side-by-side. Functies rond
  regel 1024-1340: `agEntries`, `renderAgenda`, `agRenderGrid`, `agBlokkenHtml`,
  `agendaNav/Vandaag/ZetKleur`, `agToggle`.
- **Sync (Fase 2, zelfvoorzienend):** `agendaSyncNu` → `agSyncAlleMedewerkers`
  (Track Reports v3 via Worker `target=toggl_reports`) + `agSyncEigen` (fallback).
  `agNamen()` haalt projecten + workspace_users zélf bij Toggl (Worker
  `target=toggl`) en cachet id→naam → geen handmatige mapping nodig.
- **Focus-modal (Fase 3, LIVE):** `focusFetch/focusOpen/focusLaadTaken/
  focusZetStatus/focusMaakEntry` (regio ~1255+). Status zetten, entry op taak
  aanmaken. Alle writes confirm-gated, entry-aanmaak heeft undo.
- **Maps/helpers:** `agMaps`, `agMergeEntry`, `AG_WS=21258443`,
  `AG_TBASE`, `FOCUS_ORG=21259253`, `FOCUS_WS=21258443`, `WORKER` const (857),
  `authHeader()` (956), `getAuthToken`/`getGraphToken`.

In de Worker (`worker.js`, mt-claude-proxy, LIVE — versie db3a2c3d, 2026-06-04):
- `target=toggl` → Track v9, Basic auth, server-side admin-token `TOGGL_KEY`.
- `target=toggl_focus` → Focus API, Bearer `TOGGL_FOCUS_KEY`.
- `target=toggl_reports` → Track Reports v3, Basic, admin-token.
- Alle drie aggregeren over ALLE workspace-users (admin-token). Browser hoeft
  geen Toggl-token; MS-login (`X-Auth-Token`) volstaat. CORS alleen mtbart.github.io.

## 3. Bron-documenten (LEES DEZE EERST — alles staat al uitgezocht)

In `C:\MT\Claude-context\`:
- `toggl-functie-inventaris.md` — functie-inventaris + sectie 6 met concrete IDs
  (status-ids, tag-ids, user-ids, Worker-routes). GRONDWAARHEID voor IDs.
- `eigen-tool-toggl-analyse.md` — analyse Focus (board/plan/kalender, statussen).
- `toggl-feature-analyse.md` — feature-analyse.
- `toggl-templates.md` — templates.
- `toggl-agenda-tab-plan.md` — het oorspronkelijke agenda-plan.
Deze zijn untracked (blijven uit de PUBLIC repo). Vertrouw ze, maar verifieer IDs
tegen de live API als iets niet klopt.

Concrete IDs (uit inventaris §6): org `21259253`, workspace `21258443`,
users: Bart `7289555`, Mathijs `7289451`, Arjan `7334139`, Maarten `7331774`,
Jade `7381167`. Focus-statussen: Todo `300785`, Backlog `314194`,
In Progress `300788`, Blocked `300787`, Klaar voor levering `309790`, Done `300786`.

## 4. Stappenplan voor de nachtsessie (op ultra)

**STAP 1 — Volledige capability-inventaris (analyse op ultra).**
Enumereer ELKE functie van beide producten, elk gekoppeld aan een API-endpoint:
- *Track:* timer start/stop/edit, lopende timer, handmatige entry (start/stop/duur),
  bulk-edit, projecten CRUD, clients CRUD, tags CRUD, tasks CRUD, workspace-users,
  favorieten, billable, beschrijving, project-kleur, reports (summary/detailed/
  weekly), saved reports. Endpoints: `api/v9/...` via Worker `target=toggl`,
  reports via `target=toggl_reports`.
- *Focus:* boards/lists, taken CRUD, status zetten, assignee, planning/kalender,
  tijd-entries op taken, labels, prioriteit, subtaken. Endpoints:
  `organizations/{org}/workspaces/{ws}/...` via Worker `target=toggl_focus`.
Schrijf de inventaris naar `Claude-context/toggl-capability-matrix.md` (tabel:
feature | UI-control | endpoint | method | status gebouwd j/n). Dit is je bouwlijst.
Test elk onbekend endpoint READ-ONLY (GET) via de Worker met een echte call om de
response-vorm te bevestigen vóór je er UI op bouwt. (POST/PATCH/DELETE alleen
achter een knop met confirm — niet zelf live muteren tijdens de bouw.)

**STAP 2 — UI-architectuur.** Eén nieuw tabblad `Toggl` (additief, eigen CSS-
namespace `tg-`). Subsecties die de Toggl-opbouw spiegelen: Timer/Track |
Projecten | Clients | Tags | Taken (Focus) | Board (Focus) | Reports. Hergebruik
de bestaande agenda + Focus-modal als onderdelen (niet weggooien — integreren).
Bouw de controls 1-op-1: dezelfde knoppen/sliders/velden als Toggl.

**STAP 3 — Bouw incrementeel, per subsectie één commit.** Na elke subsectie:
syntax-check (de node `new Function`-check op de inline scripts), lokaal redeneren
over de flow. Commit lokaal met duidelijke boodschap. NIET pushen (zie §6).

**STAP 4 — Data-laag voorbereiden op "los van Toggl".** Abstraheer reads/writes
achter een kleine laag (bv. `tgStore`) met twee backends: `toggl` (nu) en
`lokaal` (localStorage/SharePoint later). Zo is de standalone-modus later een
config-switch, niet een herbouw. Bouw nu de Toggl-backend volledig; laat de
lokale-backend als duidelijke stub met TODO's.

**STAP 5 — Eindrapport + ÉÉN gate.** Schrijf een kort verslag naar
`Claude-context/toggl-nacht-verslag-2026-06-05.md`: wat af is, wat getest is, wat
nog open is, en de exacte commits. Laat alles **lokaal gecommit maar NIET gepusht**.
De enige actie die op Bart wacht = "push naar live" (één akkoord). Zet boven het
verslag één regel: "AKKOORD NODIG: `git push origin main` om X commits live te zetten."

## 5. Veiligheid (hard, niet onderhandelbaar)

- **Additief bouwen.** De factuur-flow (`mbGet/mbPost`, controle, dashboard) en de
  bestaande agenda/Focus NIET breken. Nieuwe code in eigen blok/namespace.
- **PUBLIC repo:** geen PII/secrets in `index.html`. Geen klantnamen/e-mails/tokens
  hardcoden. IDs (project/user) uit de API runtime, niet hardcoden behalve de
  generieke workspace/org/status-ids die al in de tool staan.
- **Live writes naar Toggl** (POST/PATCH/DELETE) alleen achter een knop, confirm-
  gated, en waar mogelijk met undo. Tijdens de bouw zelf NIETS live muteren behalve
  één bewuste test-entry die je daarna weer verwijdert (test-op-1, undo, geen bulk).
- **Backup:** pre-commit hook backupt `index.html` automatisch. Eén feature = één
  commit → schone revert.
- **NIET pushen** zonder Barts akkoord (live = zichtbaar voor Mathijs/team). Dat is
  bewust de enige gate. Committen lokaal mag volop.
- **Worker NIET opnieuw deployen** tenzij strikt nodig; als wel: `npx wrangler
  deploy` vanuit `C:\MT` (wrangler.toml staat er, secrets blijven). Eerst dry-run.

## 6. De enige gate voor Bart

Als Bart wakker is moet hij idealiter alleen hoeven te zeggen: "push maar" →
en dan staat het volledige Toggl-tabblad live. Alles daarvóór doe je autonoom:
analyse, bouw, lokaal testen, lokaal committen, verslag schrijven.

## 6b. Agenda timer-view (Barts wens 2026-06-04, deels al gedaan)

Bart wil de agenda eruit laten zien als de **Toggl-timer-view**, maar met de
toevoeging dat je niet alleen je eigen tijd maar ook die van collega's terugziet.
Dit hoort bij dit Toggl-tabblad (de agenda integreren als onderdeel, niet apart).

**AL GEDAAN vanavond (commit `0bdad77`, lokaal, niet gepusht):**
- Sync-window 30 → **365 dagen** (`agendaSyncNu`). Reden: "bank joris" stond op
  81u39m in Focus maar veel minder in de agenda → 30-daags venster kapte
  historische uren af.
- **Reports v3 paginatie** in `agSyncAlleMedewerkers` (`first_row_number`, max 20
  pagina's à 1000) — een vol jaar past niet in één page.
- **All-time projecttotalen**: `agRenderTotalen` toont nu "deze week" ÉN "totaal
  alle weken (huidige filters)" met per-project + per-persoon chips. Zo zie je de
  volledige opbouw van een project (bank joris → volledige ~81u).
- **Bladerpijlen ◀/▶** lichten op (`.heeft`, goud-glow) als er met de huidige
  filters uren vóór/na de zichtbare week bestaan.

**NOG TE DOEN vannacht:**
1. **Verifieer de bank-joris-discrepantie**: na een sync met 365d+paginatie moet
   het all-time projecttotaal van "bank joris" ~81u39m matchen met Toggl Focus.
   Doe een READ-ONLY Reports-call en tel de seconden per project_id; vergelijk.
   Als het nóg afwijkt: check of Focus-uren (taak-entries) wel in Track Reports
   zitten — mogelijk staan sommige uren alleen in Focus en moet je die er via
   `target=toggl_focus` bij halen. Documenteer de bevinding.
2. **Timer-view-look**: bouw de agenda/timeline zó dat hij de Toggl-timer-view
   spiegelt (lijst van entries per dag met start-stop, project-kleur, beschrijving,
   duur rechts) — maar met collega-kolom/-filter zodat je ieders tijd ziet. Mag
   de bestaande week-grid vervangen of als extra view-toggle (grid ↔ lijst).
3. Houd de filters (project/persoon, zoekbalk, alles/niets, hover-expand) werkend
   in de nieuwe view.

## 7. Pointers

- Routes/deploy: `ROUTES.md` in repo-root. Repo-veiligheid: `REPO-VEILIGHEID.md`.
- Memory: `project_toggl_agenda_tab.md` (stand agenda/Focus + wrangler-grondwaarheid).
- Smart-inbox is een APART spoor (`smart-inbox-tool-plan.md`, wacht op §8-OK) —
  vannacht NIET aanraken tenzij Toggl helemaal af is en er tijd over is.
