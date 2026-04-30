# Sessie samenvatting — 2026-04-30

> Bewaar dit bestand. Op de werk-computer: lees dit + `.claude/ctx/uren.md` en ga verder met stap 11.

---

## Wat er deze sessie gedaan is

Dit was een "nachtplan"-sessie: grote reeks verbeteringen aan `uren.html` in één keer doorgevoerd.

### Nachtplan A–G (commit `a582737`)
- **A — Timer project-picker**: `openTimerProjectPicker()` gebruikt niet meer `prompt()`. Vervangen door een echte popover met zoekbalk + lijst van actieve projecten (recent gebruikt bovenaan).
- **B — Nieuwe taak via prompt()**: `knbNieuwe()`, `tknNieuwe()` en vergelijkbare functies maken nu direct een lege taak aan via `maakLeegeTaak()` en openen de taak-modal. Geen browser-prompt meer.
- **C — Taken in Timeline**: Taken met `from_date`/`to_date` worden als lichte gekleurde banden getoond in de Timeline-rij van de toegewezen persoon. Klikbaar → opent taak-modal.
- **E — Toast-notificaties**: `showToast(tekst, type, duur)` systeem. Kleine balk rechtsonder, verdwijnt na 3s. Alle `alert()` calls vervangen.
- **F — Persoon-wisselen in sidebar**: Knop onderaan sidebar (`↕`) opent welkom-scherm opnieuw.
- **G — Milestones in project-detail panel**: `getMilestones().filter(m=>m.project_code===code)` getoond als lijst in het slide-in panel.

### Nachtplan D (commit `6485db5`)
- **D — Capaciteitsbalk per week**: De 14-daagse Timeline toonde één balk over beide weken samen (waardoor het leek alsof iedereen altijd onder capaciteit zat). Nu twee aparte mini-balken naast elkaar: **w1** (dagen 0–6) en **w2** (dagen 7–13), elk vergeleken met de weekcapaciteit (bijv. 40h). Groen/oranje/rood per balk.

### Stap 10 — Mobiele responsive (commit `e2935f0`)
- **Hamburger menu**: `☰` knop in een groene mobile-topbar (alleen zichtbaar `<768px`). Klik → sidebar schuift in via `transform:translateX`.
- **Sidebar overlay**: Donker vlak achter open sidebar. Klik erop → sluit sidebar.
- **Sluit-knop**: `✕` in sidebar-header op mobiel.
- **Auto-sluiten**: Bij het kiezen van een tab-item sluit de sidebar automatisch.
- **Tab-label**: De mobile-topbar toont de naam van de actieve tab.
- **Dag-view geforceerd**: `renderKalender()` en `showTab()` forceren `kalView='dag'` als `window.innerWidth<768`. De 3d/week-knoppen zijn verborgen via CSS `data-view` attribuut.
- **Kanban**: `flex-direction:column` op mobiel → één kolom.
- **Timeline**: `overflow-x:auto` → horizontaal scrollbaar.
- **Taak-modal**: Volledig scherm op mobiel (de modal had al een eigen `@media(max-width:700px)` voor de twee-kolom lay-out).
- **Touch targets**: `padding:0.9rem` op sidebar-items, `font-size:16px` op welkom-knoppen.

---

## Huidige staat van het project

### Bouwvolgorde (uren.html)
| Stap | Wat | Status |
|---|---|---|
| 1 | Data model migratie, Toggl-code verwijderd | ✅ |
| 1b | Sidebar-layout (Toggl-stijl) | ✅ |
| 2 | renderKalender() — dag/3d/week toggle, nu-lijn | ✅ |
| 3 | openTaakModal() — universeel, subtaken, auto-save | ✅ |
| 4 | Kanban — drag & drop, buckets, timer per kaart | ✅ |
| 5 | Taken-tab — tabel, filters, sorteren | ✅ |
| 6 | Timeline — capaciteitsbalk, vrije dagen, sticky | ✅ |
| 6b | Timeline dag-headers → Agenda-tab | ✅ |
| 6c | Agenda persoon-switcher (pill-knoppen) | ✅ |
| 6d | Locatie + reistijd op planblokken + milestones + dummy-data | ✅ |
| 7 | Project-detail slide-in panel | ✅ |
| 8 | Vrije dagen + eigen buckets beheer in Instellingen | ✅ |
| 9 | Weekafsluiting — rapport per project/persoon/week + export | ✅ |
| Nachtplan | A+B+C+D+E+F+G (zie boven) | ✅ |
| **10** | **Mobiele responsive** | ✅ |
| **11** | **Vectorworks koppeling** | ⬜ VOLGENDE |
| 12 | Pauze-meldingen (werktijden instelbaar) | ⬜ |

---

## Volgende stap: Stap 11 — Vectorworks koppeling

**Doel**: Knop in `uren.html` (en/of `index-v4.html`) waarmee een Vectorworks CSV-export ingeladen kan worden en automatisch subtaken aanmaakt onder de Productie-taak van een project.

**Context**:
- Vectorworks exporteert een lijst van onderdelen/bewerkingen als CSV
- Deze moet worden omgezet naar subtaken op een bestaande taak (bijv. de "Productie"-taak)
- De knop + importfunctie moet in de taak-modal komen (of als aparte import-stap in het project-detail panel)
- Zie `.claude/ctx/vectorworks.md` voor de CSV-structuur en workflow

**Aanbevolen aanpak**:
1. Knop "📐 Vectorworks importeren" in taak-modal (rechterkolom, onderaan)
2. File input `<input type="file" accept=".csv">`
3. CSV parsen → subtaken aanmaken (naam = onderdeel/bewerking, gedaan: false)
4. Bestaande subtaken blijven staan, duplicaten overgeslagen op basis van naam

---

## Technische details om te weten

### Bestanden
| Bestand | Locatie |
|---|---|
| Hoofd-app | `uren.html` (4700+ regels) — single file, geen bundler |
| Branch | `claude/hardcore-shaw-73041c` |
| Worktree | `C:\...\Applicaties\Claude\.claude\worktrees\hardcore-shaw-73041c\` |
| Live URL | https://mtbart.github.io/MT-Facturatie-tool/uren.html |
| GitHub repo | mtbart/MT-Facturatie-tool |

### Werkwijze
- Altijd **Edit tool** (str_replace), nooit volledig herschrijven
- Git commit na elke stap: `feat(uren): stap X — omschrijving`
- Push: `git push origin claude/hardcore-shaw-73041c`

### Kerndata modellen
```js
// Taak object
{
  id, project_code, naam, status, bucket_id,
  prioriteit, tags, estimate_h, assignees,
  from_date, to_date, billable, omschrijving,
  subtaken: [{id, naam, gedaan, assignee}],
  aangemaakt, gewijzigd
}

// Planning blok
{ id, datum, teamlid, project_code, taak_id,
  uren_gepland, locatie, reistijd_voor_min, reistijd_na_min }

// Milestone
{ id, naam, project_code, datum, type }
// type: 'deadline'|'oplevering'|'plaatsing'|'revisie'|'overig'
```

### localStorage keys (nooit hernoemen!)
`mt_uren_taken` · `mt_uren_entries` · `mt_uren_planning` · `mt_uren_teamleden`
`mt_uren_buckets` · `mt_uren_sjablonen` · `mt_uren_vrije_dagen` · `mt_uren_werktijden`
`mt_uren_milestones` · `mt_projecten`

### Case-insensitive matching
Teamlid-namen zijn lowercase in `STD_TEAMLEDEN` (bijv. `bart`) maar kunnen hoofdletters hebben in entries/planning (bijv. `Bart`). Altijd `.toLowerCase()` gebruiken bij vergelijkingen.

---

## Bekende open punten
- **Reistijd in capaciteitsplanning**: Bewust uitgesteld. `reistijd_voor_min` + `reistijd_na_min` zitten al op planblokken. Later optellen bij capaciteitsbalk.
- **Reistijd in nacalculatie**: Aparte kolom in Rapport/nacalculatie, na volledig werkbaar model.
- **SharePoint Graph API token**: Ontbreekt voor cross-device sync. Wacht op Bart.

---

## Hoe verder op de werk-computer

1. Open terminal in `C:\...\Applicaties\Claude\.claude\worktrees\hardcore-shaw-73041c\`
2. `git pull` (of `git log --oneline -5` om te bevestigen dat je op de juiste commit zit)
3. Lees `.claude/ctx/uren.md` en `.claude/ctx/vectorworks.md`
4. Start preview server
5. Ga aan de slag met stap 11

De branch staat op GitHub: `claude/hardcore-shaw-73041c` — alles is gepusht.
