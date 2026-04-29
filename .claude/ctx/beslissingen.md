# Architectuurbeslissingen — anti-herhaling log

> Dit bestand voorkomt dat we in nieuwe sessies dezelfde discussie opnieuw voeren.
> Voeg hier elke significante keuze toe met redenering.

---

## 2026-04-28: Sidebar-layout i.p.v. horizontal tabs (uren.html)
**Keuze:** Linker sidebar ~210px (Toggl-stijl) + full-height content rechts
**Reden:** Volledig scherm benut voor content. Toggl Focus screenshots toonden dat dit veel duidelijker werkt voor een uren-app. Meer navigatie-items passen in de sidebar dan in een tab-balk.
**Trade-off:** Grotere layout-refactor nodig (header + tabs-wrap verborgen, nieuwe aside aangemaakt)
**Status:** Geïmplementeerd

---

## 2026-04-28: Taken als platte array i.p.v. object per project
**Keuze:** `mt_uren_taken` = platte array `[{id, project_code, naam, ...}]`
**Reden:** Makkelijker filteren, sorteren, bucket_id en assignees toevoegen. Kanban en Taken-tab werken direct op de array zonder per-project loops.
**Trade-off:** Migratiefunctie `migreerTaken()` nodig voor bestaande data. Compatibiliteitslaag `getTakenPerProject()` aangemaakt voor bestaande renderfuncties.
**Status:** Geïmplementeerd

---

## 2026-04-28: Toggl volledig verwijderd (geen sync meer)
**Keuze:** Alle Toggl-code eruit, `mt_toggl_*` keys leeggmaakt bij eerste load
**Reden:** Toggl doet "net niet precies wat we willen". Eigen app geeft volledige controle.
**Trade-off:** Geen historische Toggl-data beschikbaar (was al niet gebruikt)
**Status:** Geïmplementeerd

---

## 2026-04-28: Eén groot HTML-bestand (geen bundler/framework)
**Keuze:** Alles in één HTML-bestand (index-v4.html ~2500r, uren.html)
**Reden:** Werkt zonder build-stap, deployen via git push naar GitHub Pages. Eenvoudig te editen via str_replace. Geen afhankelijkheden te beheren.
**Trade-off:** Bestand wordt groot, minder modulair. Bewust geaccepteerd.
**Status:** Permanent

---

## 2026-04-28: localStorage als enige datastore
**Keuze:** Geen backend, alles in browser localStorage
**Reden:** Geen server nodig, werkt offline, simpel te implementeren. GitHub Pages heeft geen backend.
**Trade-off:** Geen sync tussen apparaten (workaround: SharePoint monkey-patch voor index-v4.html). Uren-sync wacht op SharePoint Graph API token.
**Status:** Permanent, sync later

---

## 2026-04-28: Twee tabs op zelfde GitHub Pages origin (gedeelde localStorage)
**Keuze:** index-v4.html en uren.html delen `mt_projecten` via localStorage
**Reden:** Zelfde origin = zelfde localStorage. Projecten hoeven maar op één plek ingevoerd te worden.
**Trade-off:** Beide apps moeten op dezelfde GitHub Pages URL staan (wat ze al doen)
**Status:** Geïmplementeerd

---

## Template voor nieuwe beslissingen
```markdown
## YYYY-MM-DD: [Titel]
**Keuze:** [Wat is gekozen]
**Reden:** [Waarom]
**Trade-off:** [Wat je ervoor inlevert]
**Status:** Geïmplementeerd | In progress | Permanent
```
