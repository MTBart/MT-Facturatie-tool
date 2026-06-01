# Fase B — Project-detailpagina + eerste bidirectionele links

**Status:** in opbouw (gestart 2026-06-01)
**Plan op:** Opus 4.8 · **bouw op:** 4.7
**Bron-visie:** `visie-ops-cockpit.md` (Fase B = project-detail + voorraad-item-detail + bidirectionele links overal)

## Uitgangspunt (Bart, vast)
- Bouw **alleen met data die we echt hebben**. Geen nep "coming soon"-placeholders
  voor mappen/mensen/Toggl — die komen pas wanneer de data er is (Fase C/D + taak #19 mappenmigratie).
- Auto, geen review-stap: dingen áf, niet als werklijstje terug.
- Geen live MB-write/POST. Detail-links naar Moneybird zijn read-only deeplinks (gewone hyperlinks).

## Wat er al staat (Fase A)
- Codegenerator `KLANT-LOC-PROD` live; `data/klanten.json` = single source of truth voor klant-registry.
- `renderProjectDetail(proj)` (index.html ~1567): code-badge, naam, KPI-grid
  (Materiaalinkoop / Materiaalregels / Klant), VW-CSV upload, NCR-import,
  materiaaltabel uit `mt_voorraad` (kolom Leverancier = platte tekst).
- Project-object: `{code,naam,klant,klant_naam,loc,loc_naam,product,product_naam,mb_nr,created}`.
- Klanten-tab: `laadKlanten()` haalt MB-contacten (auth), `openKlantDetail(id)`, `alleKlanten[]`.
- Leveranciers: globaal `leveranciers[]` (`mt_leveranciers`), `toonLeverancierInfo(naam)` (alert),
  `renderLeveranciersBeheer()` op Leveranciers-tab.

## Increment 1 — klant-registry laden + project-detail verrijken  ← NU
1. Globale `KLANTEN` map laden uit `data/klanten.json` op `window.onload`
   (async fetch, met hardcoded fallback = KLANT_REGISTRY-niveau zodat offline werkt).
   Helper `klantByCode(code)` → registry-record (naam, mb_contact_id, aliassen).
2. Klant-KPI in `renderProjectDetail` wordt **klikbare chip**:
   - resolve volledige klantnaam via registry (val terug op `proj.klant_naam || proj.klant`);
   - als registry een `mb_contact_id` heeft → deeplink `moneybird.com/{admin}/contacts/{id}` (nieuw tabblad);
   - anders → spring naar Klanten-tab (`showTab('klanten')`).
3. `mb_nr` (Moneybird factuur/projectnr) **inline bewerkbaar** + deeplink als gezet.
4. Leverancier-cel in materiaaltabel wordt **link** → springt naar Leveranciers-tab
   en opent `bewerkLeverancier`/info als de naam in `leveranciers[]` matcht
   (anders platte tekst, geen dode link).

## Increment 2 — projecttijdlijn uit echte data
- Afleidbare events: `created` (projectaanmaak), factuur-/inkoopdatums uit `mt_voorraad`
  (per `v.datum`), NCR-upload-momenten, CSV-upload. Chronologisch, compacte lijst.
- Geen verzonnen mijlpalen.

## Increment 3 — voorraad-item-detail + terug-links
- Voorraad-item klikbaar → toont: prijsverloop (mouseover/hist), gekoppelde bestellingen,
  projecten waarin gebruikt, leverancier + bestellink. (Spiegelt project→materiaal.)
- Bidirectioneel: vanuit materiaalregel in project → naar voorraad-item-detail.

## Bewust NIET nu
- Mappen/attachments-sectie (wacht op taak #19 mappenmigratie — voorspelbare structuur eerst).
- Mensen/capaciteit/Toggl (Fase C).
- Mobiel/issues (Fase D), Jortt-styling (Fase E).
