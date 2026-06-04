# Harvest-rapport — oude tool → nieuwe tool (2026-06-04)

> Doel: vastleggen wat er uit de **oude** tool is meegenomen vóór archivering,
> zodat aantoonbaar is dat er niets nuttigs verloren gaat. Aanleiding: er liepen
> twee tool-projecten door elkaar (oude `index-v4.html` + voorraad-FastAPI vs. de
> nieuwe `index.html`). Beslissing Bart: oude aan de kant, met de nieuwe verder.

## Welke is welke (bewezen)

- **NIEUW = `index.html`** (repo-root). Live op de root-URL
  `https://mtbart.github.io/MT-Facturatie-tool/`. Alle ontwikkeling van eind mei
  t/m 2-6 staat hierop (git: Fase A/B, #20 Excel-upload, #21 auto-mappenstructuur,
  De Verbouwer-fix, bijlagen-per-project). Bart heeft 2-6 met déze tool de
  projectmap *De Verbouwer/Lisse* aangemaakt → bevestigd de actieve tool.
- **OUD = `index-v4.html`** (bevroren 13-5), `index-v3.html`, `MT-presentatie.html`,
  `voorraad/` (oude FastAPI-opzet), `migration-*.js` + `MIGRATION_ANALYSIS.md`.

## Front-end harvest: index.html is een volledige superset van index-v4

Functie-voor-functie vergeleken (alle `function`/`window.*`-definities in beide).
**Elke functie uit v4 zit in index.html.** Extra in index.html (de nieuwe winst):

- Klant-resolve / registry: `klantByCode`, `_normNaam`, `klantVolByNaam`,
  `resolveMbContact`, `resolveKlantNaam`, `laadKlantRegistry`, `ruimTestProjectenOp`.
- Projectcode-generator KLANT-LOC-PROD: `_clean`, `afkortKlant`, `afkortLoc`,
  `afkortProduct`, `autoCode`.
- Project-bijlagen + links: `bijlagenHtml`, `uploadProjectBijlagen`,
  `ontkoppelBijlage`, `levLink`, `gaNaarLeverancier`, `bewerkProjectMbNr`,
  `projectTijdlijn`.
- SharePoint mappen + upload: `window.genereerProjectMappen`,
  `window.spUploadProjectBijlage`.

**Enige v4-functie die ontbreekt:** `genereerProjectSuggestie` — bewust
**vervangen** door de betere `autoCode`/`afkort*`-generator. Geen verlies.

→ **Conclusie:** front-end-harvest is feitelijk al gebeurd doordat `index.html`
uit `index-v4` is voortgekomen en verder is uitgebouwd. Niets te porteren.

## Niet-front-end: nuttige onderdelen om te bewaren

- **`email-bijlagen-systeem.md`** — afzender→projectmap-routingtabel (CompaNanny,
  Inter Projecten/HWC, OBS De Burght, KGHN; leveranciers Ostermann/Kisch/…).
  Bevat échte e-mailadressen = PII → **niet in de public repo**. Bruikbaar als
  routing-referentie voor de smart-inbox. Blijft lokaal in het archief.
- **`voorraad/_plan/`** — ontwerpdocs (o.a. `fase-b-project-detail.md`). Historische
  ontwerpwaarde; mee naar archief.
- **`migration-tool.js` / `migration-server.js` / `MIGRATION_ANALYSIS.md`** — oude
  Node-aanpak voor mappen-migratie (taak #19). De nieuwe tool doet mapgeneratie nu
  in-browser (`genereerProjectMappen`); migratie-logica kan als referentie dienen
  als #19 wordt opgepakt. Mee naar archief, blijft raadpleegbaar.

## Wat er gebeurt

1. Volledige backup-zip van de hele Claude-map →
   `Applicaties/_archief/Claude-volledig-backup-2026-06-04.zip`.
2. Oude bestanden → `_archief/oude-tool-2026-06-04/` (gitignored → uit de public
   deploy, blijft lokaal/SharePoint). Git-historie blijft via `git log` bewaard.
3. Alle docs/hooks/memory bijgewerkt: v4 → `index.html` (zie commit).
