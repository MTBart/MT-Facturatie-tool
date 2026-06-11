# cockpit-VERSLAG — Admin-tab + planning-laag + uren-lock

**Gebouwd door:** cockpit-admin (subagent)  
**Datum:** 2026-06-12  
**Bestand:** `C:\MT\v2.html`

---

## Statistieken

| | Voor | Na |
|---|---|---|
| Regels | 6 474 | 7 278 |
| Bytes | 431 929 | 480 111 |
| Script-blokken | 6 | 8 |
| Syntaxfouten | — | **0** |

---

## Gebouwde onderdelen

### Tab-balk (regel ~506)
- Nieuwe knop `<button id="tab-btn-admin" style="display:none">⚙ Admin</button>` — standaard verborgen, zichtbaar na `admInitKnop()` als `mtIsAdmin()` true.
- `showTab()` uitgebreid met `if(name==='admin') adminOpen()` (regel ~1597).

### Deel A — Admin-tab HTML (regels ~1036–1234)
- `<div id="tab-admin">` met vijf subtabs (patroon identiek aan `tg-subtabs`/`tg-subcontent`):
  - `adm-sub-logboek` — tabel uit `mt_auditlog.json`, filter op persoon + zoekveld
  - `adm-sub-team` — werkuren/week per teamlid + lock-drempel input
  - `adm-sub-verlof` — jaarbudgetten-grid, verlof boeken, saldo-tabel, verloflijst
  - `adm-sub-vrijdagen` — invoerformulier + gesorteerde lijst
  - `adm-sub-notificaties` — verstuur-formulier + overzicht verzonden
- Styling in inline `<style>` blok met `.adm-*` classes (walnut/goud/groen palet).

### Deel A — Admin JS (nieuw `<script>` blok, regels ~6457–6850)
- `MT_TEAM` const — 4 teamleden met email, naam, slug, admin-vlag.
- `mtMijEmail()` / `mtIsAdmin()` — login-gebaseerd, veilig bij geen login.
- SP-cache helpers voor alle 6 bestanden:
  - `_admConfig` / `admLoadConfig()` / `admSaveConfig()` / `admCfg()`
  - `_admVerlof` / `admLoadVerlof()` / `admSaveVerlof()` (read-merge-write op id)
  - `_admVrijdagen` / `admLoadVrijdagen()` / `admSaveVrijdagen()`
  - `_admAudit` / `admLoadAudit()` — append-only
  - `_admNotifs` / `admLoadNotifs()` — append-only met unshift
  - `_planblokken` — zie Deel B
- Globale `auditLog(actie,doel,oud,nieuw,reden)` — fire-and-forget, `window.auditLog`.
- `adminOpen()` — laadt alles parallel, rendert subtabs.
- `admSub()` — subtab-wissel (identiek patroon als `tgSub`).
- A1 `admRenderLog()` / `admLaadLog()`
- A2 `admRenderTeam()` / `admSlaWerkurenOp()` / `admSlaLockOp()`
- A3 `admRenderBudgetten()` / `admSlaBudgettenOp()` / `admBoekVerlof()` / `admRenderVerlofLijst()` / `admVerwijderVerlof()` / `admRenderSaldo()`
- A4 `admVoegVrijeDagToe()` / `admRenderVrijdagenLijst()` / `admVerwijderVrijeDag()`
- A5 `admVerstuurNotificatie()` / `admRenderNotifLijst()`
- `admInitKnop()` — toont/verbergt tab-knop na login (aangeroepen vanuit `toonApp()`).
- `admWerkdagen(van,tm)` — werkdagen ma–vr tellen voor verlofregistratie.

### Deel B — Planning-laag in Agenda-tab

**HTML-wijzigingen:**
- Derde view-knop `📋 Planning` in de view-toggle (regel ~1003).
- `<div id="agenda-plan-toolbar">` met "toon geklokt"-checkbox (verborgen tenzij plan-view).
- `<div id="agenda-cap-balk">` voor capaciteitsbalken (verborgen tenzij plan-view).

**JS-wijzigingen in `renderAgenda()`:**
- Plan-knop `btn-gold`/`btn-secondary` toggle.
- Toolbar en cap-balk tonen/verbergen op basis van view.
- `if(_agenda.view==='plan') agPlanRender()` branch.

**Nieuw `<script>` blok (Planning module, regels ~6853–7060):**
- `_planblokken` state + localStorage-spiegel.
- `agPlanLoad()` / `agPlanSave()` — read-merge-write op id.
- `agPlanRender()` — week-grid identiek aan bestaand rooster:
  - Dag-kolommen met planblokken als `.ag-blok` divs (positie uit start+duur).
  - Actuals-overlay (semi-transparant, rechterhelft kolom) als checkbox aan.
  - Verplichte vrije dag → grijze overlay + 🔒 label, klik geblokkeerd (planToast).
  - Optionele vrije dag → gele semi-transparante overlay + label, plannen toegestaan.
  - Verlof-blokken ingebakken in vrije-dag-check van `agPlanDagKlik`.
  - Drop-zone receptors per dagkolom.
- `agPlanCapBalk()` — per teamlid: capaciteit = werkuren/wk − vrije-dag-uren − verlofuren; gepland = som blokken; balk groen/goud/rood + overboekt-melding.
- `agTogglPersFilter()` — klik op naam in capaciteitsbalk schakelt persoon-filter.
- `agPlanDagKlik()` — klik op lege cel → starttijd uit klik-positie, verlof-check, `agPlanNieuwFormulier()`.
- `agPlanNieuwFormulier()` — reeks prompt()-dialogen (persoon, project, taak, start, duur) → SP-opslag.
- `agPlanBlokMenu()` — klik op bestaand blok → verwijderen.
- `agPlanDragStart/End/Drop()` — drag naar andere dag, snap op kwartier-raster, verlof/vrije-dag-check.

### Deel C — Uren-lock wiring (Uren-tab, regels ~2587–2665)

- `urenLock(startIso)` — vergelijkt entry-datum met `admCfg().lockDagen`, retourneert `{locked, dagen, diffDagen}`.
- `tgEditEntry()` volledig herschreven:
  - Vergrendeld + niet-admin → `alert(…)` + `auditLog('edit-geweigerd',…)` + return.
  - Vergrendeld + admin → `prompt('Reden…')`, lege reden = cancel, daarna normale PUT + `auditLog('unlock-edit',…)`.
  - Niet-vergrendeld → normaal flow + `auditLog('uren-edit',…)`.
- `tgDelEntry()` analoog:
  - Vergrendeld + niet-admin → geblokkeerd.
  - Vergrendeld + admin → reden vereist + `auditLog('unlock-delete',…)`.
  - Niet-vergrendeld → normaal flow + `auditLog('uren-delete',…)`.

### TAB_HELP-entries
- `agenda` — uitleg bijgewerkt met planning-view en capaciteitsbalken.
- `admin` — nieuw entry toegevoegd.

---

## SharePoint-bestanden (nieuw)

Alle via `_SP.read()`/`_SP.write()` op `MT-Bedrijfstool/` folder:

| Bestand | Inhoud |
|---|---|
| `mt_adminconfig.json` | `{lockDagen, werkuren, budgetten}` |
| `mt_verlof.json` | Array verlof-boekingen |
| `mt_vrijedagen.json` | Array vrije dagen |
| `mt_auditlog.json` | Append-only audit-entries |
| `mt_planblokken.json` | Array planning-blokken |
| `mt_notificaties.json` | Array notificaties (F1-polling formaat) |

---

## Open punten / niet gebouwd

1. **Drag-resize** (onderrand planblok per kwartier) — niet gebouwd. Prompt-based bewerking als tijdelijke vervanger; resize via drag-handle vereist meer DOM-event-code dan in scope past.
2. **Verlof-blok in planning-grid** als zichtbaar gekleurd blok per persoon — de check is gebouwd (plannen geblokkeerd via toast), maar het visuele verlof-blok in de dag-kolom (aparte kleur voor de verlofperiode) is niet gerenderd.
3. **Responsief/mobiel** — grid is horizontaal scrollbaar zoals bestaand rooster; mobiele touch-events voor drag niet geïmplementeerd.
4. **`mt_planblokken` in `_SP.KEYS`** — niet toegevoegd (KEYS is een Set op regel ~5345 voor auto-hydrate; planblokken worden via expliciete load/save beheerd en hebben geen conflict met die hydrate).
5. **Budgetten-jaar dynamisch** — alleen 2025/2026/2027 hardgecodeerd; kan later worden uitgebreid.
