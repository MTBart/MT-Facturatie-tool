# Release v2.24.0 (met v2.22.0 en v2.23.0): checklist voor de releasesessie

Branch `integratie-v2240` (worktree `C:\Users\BartWitte\mt-worktrees\integratie-v2240`), vanaf `integratie-v2230` (`6a8d002`, v2.23.0), dat vanaf main `a208a4e` (v2.21.0) is gebouwd.
Deze release zet v2.22.0, v2.23.0 en v2.24.0 IN EEN KEER live: v2.22 en v2.23 hebben nooit apart gedraaid. Er is geen tussenstap nodig.
Details van de eerdere delen: `RELEASE-v2220.md` (planblokwriter F1, materiaal P5, Planning inrichten P3b, taken bewerken P2p, telefoon S0, Capaciteit C1/C2/C3, calc K7) en `RELEASE-v2230.md` (P6 checklist/poorten, B1/B2, F2a/F2b afhankelijkheden, P1b/G1/D1, S1/S2/S4/S5/S7, PL1/PL2, R1). De stappen hieronder zijn compleet; die documenten zijn alleen voor de onderdelen.

Inhoud v2.24.0 bovenop v2.23:
- Samenhang: S3 tabblad "Uren & budget" (meter, facturatie verwacht, prognose, nacalculatie, materiaalinkoop; Budget staat niet meer in Planning), S7-rest (snelkeuzes Open/Lopend/Leads/Te nacalculeren/Afgerond, projectenoverzicht rechts zonder project).
- Capaciteit: P7b (heatmap, rollen zonder naam, botsing, beschikbaarheidsbalk), P7c (inzetbaarheid per persoon, totaalrijen Werkplaats/Kantoor; de banen zijn eruit), D0 (fundament om naar Outlook te schrijven; vlag `AGENDA_SCHRIJVEN=false`, niets aangesloten). Schema 12 (`mt_planinrichting` erbij).
- Planning: P4b tijdlijn bewerken (verslepen, rekken, koppelen; alleen met de rechten van plannen/taken:alles; Ongedaan maken).
- Stijl: R2/R3 `mt-iconen.js` (lijn-iconen i.p.v. emoji buiten projectscherm en planning, statuschips, tekstpas, overloop Voorraad/Opleveringen op de telefoon). Alleen in de nieuwe stijl; `stijl=oud` ongewijzigd.
- Poorten: aanbetalingspoort uit Moneybird (#72), alleen lezen, nooit stil groen (een klik, vers lezen).
Geen workerwijziging (`worker.js` ongewijzigd t.o.v. main; geen wrangler-deploy). Alleen uitvoeren na akkoord van Bart; nooit `--no-verify` of OVERSLAAN-variabelen.

## Stand van de integratiebranch (bovenop 6a8d002, alle merges --no-ff)
| Commit | Wat |
|---|---|
| 0af45c2 | merge samenhang-s3 (8f5e6e1), geen conflicten |
| 1060500 | merge capaciteit-p7b (71bc295: bevat integratie-v2230, D0, P7b, P7c), geen conflicten |
| 0e9bf84 | merge planning-p4b (408c439). Conflicten: v2.html (scripttags; Capaciteit-init: `naHerstel` tekent ook de tijdlijn), mt-tijdlijn.js (noot van P4b) |
| 3cf86cb | merge rust-r2 (fca6956). Conflicten alleen cache-versies (v2.html, mobiel.html) |
| fe70a4a | versielabel v2.24.0, updates-item, cache-versies `2026-10-24z` voor elk bestand dat sinds 6a8d002 wijzigde |
| 4f1a228, 1705f58 | merge poort-mb (5e10508) + cache-versies, updates-punt |
| c268a9c | integratiefixes: (1) in de P7b-init van `MTPlanInrichting` stonden `verplaats`/`verplaatsHerstel` per ongeluk in een commentaar: een fase/station/activiteit met taken verwijderen deed niets (rook-p3b ving het); (2) Codex: `planInrichtOpslaan` leest eerst vers de schemadrempel |
Schema: `PROJ_SCHEMA` (v2.html) en `P.SCHEMA` (mt-planning.js) beide **12**; `mobiel.html`, `tv.html`, `mt-vandaag.js` gebruiken `P.SCHEMA`. `_PROJ_SCHEMA_SLEUTELS` = `mt_projecten`, `mt_project_taken_v2`, `mt_planblokken`, `mt_bestellijst_v2`, `mt_project_afhank`, `mt_planinrichting`.
Sinks: niets verruimd; alleen de vingerafdruk van het ICOON-houdregel in `tools/sinks-groep-projfilter.json` is bijgewerkt (S3 wijzigde de vaste SVG-tekst in mt-projfilter.js; geen data). `check-sinks` exit 0, `check-verwijzingen` exit 0 (94 verwijzingen, 5 pagina's), `bouw-rust-css --controle` klopt.
De `.btn-xs` 44 px op de telefoon (fix van v2.23 in mt-telefoon.css / mt-taaktabel.js) is niet teruggebracht door rust-r2: rust-r2 raakt alleen `.ui-ico` en overloopregels in mt-rust.css (rook-s0-meet8/na: 44/0, geen horizontale scroll op 390/430/1440).

## Tests op de eindstand c268a9c (lokaal, nagebootst SharePoint/Moneybird, geen echte writes of API-aanroepen)
- Suite (`suite-int.js`): ok=8319, fout=20. Dat is de baseline (b-f1 1, b-geld 1, b-pl3a 1, b-s2a 9, b-sv 1, b-u1 1 = 14; plus b-f5 3 in een verse worktree) plus `b-cap-zoom` 3, die vandaag ook op 6a8d002 faalt omdat 24-10 een zaterdag is ("weekend: plannen kan niet"; datumafhankelijk, geen code). `b-tl`, `b-rust-r1` en `b-rust-r2` zijn nu groen. Alle nieuwe harnassen groen, o.a. b-p7b, b-agenda-uit, b-poort-mb 64/0, b-pi 94/0, b-p3b 74/0, b-pl2d/2f/2g/9b (zie noot), b-bw, b-f2a/b, b-p6.
  - Noot: poort-mb voegde `projAanbetaling` e.d. toe in v2.html die b-pl2d/2f/2g/9b niet uitsneden; in de gedeelde harnassen een stub toegevoegd (alleen testcode). Daarna 49/59/53/115 groen.
- Browser-rooktests (eigen headless Chrome, eigen poort): c1 53/0, c3 31/1*, d1 32/0, g1 45/0, p1a-p1b 23/0, p1b 60/0, p7b 50/0, P0 38/0, P3 40/0, P4a 25/0, P4b 32/0, F1 22/0, P5 22/0, P6 35/0, F2a 23/0, F2b 24/0, P2p 26/0, vg 40/0, S1 28/0, S2 37/0, S3 12/0, S5 14/0, S7 12/0, S7b 11/0, taakpaneel rook1 17/0, rook2 29/0, rook2a 7/0, rook4 9/0, rook5 14/0, S0 overloop 390/430/1440 (meet8 44/0, na 44/0).
  Bekend of verouderd, geen regressie (vergeleken met 6a8d002 op dezelfde dag):
  - `rook-c2` 34/1: popover onder stilstaande muis (testartefact, ook in v2.23).
  - `rook-p1a` 11/4: oud P1a-script (alleen-lezen paneel; P1b maakte het bewerkbaar); vervangen door p1a-p1b en p1b.
  - `rook-c3` 31/1 en `rook-p7` 20/3: "Te laat/Deze week" met vaste testdata; falen vandaag (24-10) ook op 6a8d002. Datumafhankelijk.
  - `rook-s4` 13/3: verwacht Budget in het Planning-tabblad; S3 verplaatste Budget naar "Uren & budget" (rook-s3 dekt dat). Verouderde verwachting.
  - `rook-p3b` 47/1: verwacht drie lijsten in Planning inrichten; P7b voegde "Rollen zonder naam" en "Inzetbaarheid" toe. Verouderde verwachting (b-pi is al op vijf lijsten).
- Laadtest lokaal (v2.html, `?stijl=oud`, mobiel, uren, tv): 0 EXC; EVAL toont steeds de echte inlog-/startpagina. Alleen 404 op `data/klanten.json` en `favicon.ico` (lokaal niet aanwezig) en CORS op de track-aanroep (lokaal).
- Niet geautomatiseerd: S0 INFO uit v2.23 blijft (13 tikvlakken < 44 px in Capaciteit op 390 px: belastingsbadge en "Zet ..."-knoppen).

## 0. Vooraf (op de pc van de releasesessie)
- [ ] Werkstop aankondigen voor planning, bestellingen, voorraad/inkoop, nacalculatie en projecten. Alle open v2.21-tabs (en v2.22/v2.23 als die bestaan) sluiten of hard herladen: Codex bevestigt dat een oude tab na schema 12 nog planblokken (en `mt_planinrichting`) kan schrijven; dit is een harde voorwaarde, geen advies.
- [ ] `C:\MT` schoon (`git -C C:\MT status` toont alleen de bekende lokale bestanden; anders eerst parkeren, RELEASE.md stap 1).
- [ ] `git -C C:\MT fetch`; controleer dat `origin/main` nog `a208a4e` is. Is main verder: eerst die commits in de integratiebranch mergen en stap 3 opnieuw draaien.
- [ ] Besluit met Bart: de oudere RELEASE-bestanden mogen genegeerd; alles uit 2.22/2.23/2.24 gaat mee.

## 1. Backup en tag (vanuit `C:\MT`, op main)
- [ ] `git tag v2.21.0 a208a4e` (controleer met `git tag -l v2.21.0`).
- [ ] Back-up roteren: `python tools/backup-roteer.py v2.21.0 <datum>`; uitkomst "resten: geen", anders STOP.
- [ ] Backup committen (alleen `backup/`): "Backup = v2.21.0" (`git commit -F <bestand>`, zonder BOM).

## 2. Merge
- [ ] `git -C C:\MT merge --no-ff --no-commit integratie-v2240` (verwacht: geen conflicten; de branch is vanaf a208a4e) en `git commit -F <bestand>`, bv. "Release v2.24.0 (met v2.22.0 en v2.23.0): ...; backup = v2.21.0".
- [ ] `CHANGELOG.md` bijwerken zoals de hook op main eist (op de integratiebranch meldt de hook "alleen op main").
- [ ] Datum van de updates-items (`data/updates.json`, 2.24.0, 2.23.0, 2.22.0) gelijk zetten aan de echte releasedatum als dat niet 2026-10-23 is.

## 3. Controleren vóór de push (in `C:\MT`)
- [ ] `node tools/check-sinks.js` exit 0; `node tools/check-verwijzingen.js` exit 0.
- [ ] Suite: baseline (zie boven; b-f5 alleen in een verse worktree). Nieuwe fouten buiten de datumafhankelijke b-cap-zoom = blokkade.
- [ ] Laadtest lokaal (`python -m http.server 8765`): `node tools/laadtest.mjs http://localhost:8765/v2.html`, ook `?stijl=oud`, `mobiel.html`, `uren.html`, `tv.html`. Elke `EXC` = blokkade. Label v2.24.0.
- [ ] Push-diff bevat geen secrets, persoonsgegevens, bedragen of klantnamen (privacy-scan in de hook).

## 4. Push en live controleren
- [ ] `git push origin main` en `git push origin v2.21.0`; wachten tot GitHub Pages bijgewerkt is; live label v2.24.0.
- [ ] Laadtest live: `node tools/laadtest.mjs https://mtbart.github.io/MT-Facturatie-tool/v2.html` (ook `?stijl=oud`, `mobiel.html`, `uren.html`, `tv.html`): geen `EXC`.

## 5. Iedereen herladen (VOORWAARDE vóór er aan planning gewerkt wordt)
- [ ] Bericht: "Herlaad de tool één keer op elk apparaat (pc's, laptop, telefoon, tv), ook als hij al openstaat. Werk pas aan planning, bestellingen, voorraad, nacalculatie en projecten na het herladen."
- [ ] Controle: elk apparaat toont v2.24.0 (tv: scherm herladen; mobiel: hard herladen). Open oude tabs moeten dicht.

## 5b. Daarna pas `schema_uitgerold` verhogen naar 12
- [ ] Pas als stap 5 bevestigd is. Alleen in een herladen tab (v2.24.0), als eigenaar (Bart): Beheer > Projectcode-instelling > "App-versie vastleggen..." (`beheerSchemaVastleggen`): `POST /teller/schema {uitgerold: 12, min: 12, bevestig: 'schema'}`. De knop zet de waarde van `PROJ_SCHEMA` van de draaiende build (12). Rechtstreeks 5 -> 12 is toegestaan door de worker; tussenstappen zijn niet nodig.
- [ ] Controle: `GET /teller/status` toont `schema_min: 12` en `schema_uitgerold: 12`.
- [ ] Controle met echte data op een TESTPROJECT (nooit een echt project): taak wijzigen, planblok verplaatsen, tijdlijn-balk verslepen, poort/afhankelijkheid zetten, Planning inrichten (rol of fase hernoemen). Een nog open oude tab meldt "herlaad de pagina" bij projecten/taken/bestellijst/afhankelijkheden; planblokken en offertekeuze/voorraad zijn niet technisch af te dwingen: daarom is de werkstop in stap 0 en 5 verplicht.
- [ ] Let op: de worker accepteert ook een verlaging van `schema_min`/`schema_uitgerold`; een nog open oude eigenaars-tab kan de drempel dus terugzetten. Geen oude tab open; klik niet op de knop in een niet-herladen tab. Verlagen is tegelijk het terugdraaiplan.

## 6. Controleren met echte data (Bart of Mathijs, ingelogd, TESTPROJECT)
Voor v2.22 en v2.23 zie `RELEASE-v2220.md` en `RELEASE-v2230.md` (stap 6). Aanvullend voor v2.24.0:
- [ ] Project > Uren & budget: meter, facturatie, prognose, nacalculatie en materiaalinkoop zichtbaar; bedragen alleen met het geld-recht; route `#projecten/<code>/uren-budget` werkt. Projectenlijst: snelkeuzes en het overzicht rechts zonder project.
- [ ] Tijdlijn > Bewerken aan: verleg een balk, rek een rand, koppel twee balken; Ongedaan maken in de melding; zonder rechten (of Bewerken uit) kan het niet.
- [ ] Capaciteit: heatmap/belasting, rol zonder naam (Admin > Planning inrichten > Rollen) en "Zet om" naar een persoon, botsingsmelding, beschikbaarheidsbalk, totaalrijen Werkplaats/Kantoor; Admin > Planning inrichten > Inzetbaarheid per persoon.
- [ ] Planning inrichten: een fase met taken verwijderen vraagt eerst waar de taken heen gaan, verplaatst ze en verwijdert dan; Ongedaan maken zet alles terug.
- [ ] Aanbetalingspoort: op een testproject met poort "Aanbetaling binnen" en een betaalde testfactuur in Moneybird (alleen lezen): de poort stelt groen zetten voor met factuurnummer en betaaldatum; er verandert niets zonder klik; zonder geld-recht staat er geen bedrag.
- [ ] Nieuwe stijl: lijn-iconen i.p.v. emoji, statuschips; `?stijl=oud` ziet er hetzelfde uit als in v2.21 (emoji terug). Telefoon 390/430 px: Voorraad en Opleveringen scrollen niet zijwaarts; iOS en Android testen.
- [ ] D0: niets zichtbaar; er mag nergens een Outlook-schrijfactie plaatsvinden.

## Terugdraaiplan
- Kleine fout in één onderdeel: hotfix v2.24.1 vanuit main (eerst lokaal testen, laadtest).
- Groot probleem (pagina laadt niet, taken/planblokken/offertes verdwijnen):
  1. `git -C C:\MT revert -m 1 <merge-commit van v2.24.0>` en pushen (code terug naar v2.21.0; de backup-map blijft).
  2. `schema_min` en `schema_uitgerold` verlagen naar 5 via dezelfde route, daarna iedereen laten herladen.
  3. Data: v2.21 negeert onbekende velden en bestanden. Nieuw t.o.v. v2.21 (naast wat in RELEASE-v2220/2230 staat): `mt_planinrichting.json` met records `rol` (uren, vrij) en `inzet` (soorten, voorkeur, activiteiten); taakvelden `poort_bewijs_tekst`, `poort_bron`; `mt_planblokken` met rollen zonder naam (persoon `rol-<k>`: een v2.21-app toont ze niet als persoon). D0/P4b/R2/S3 schrijven niets nieuws.
  4. Niets verwijderen uit SharePoint; versiegeschiedenis is het vangnet.

## Bekende beperkingen (niet blokkerend)
Overgenomen uit RELEASE-v2220/v2230 (F1, P5, P3b, K7, C2, S0, F2a/F2b, P6, P1b, G1, D1, S4/S7, R1), aangevuld met:
- Oude tabs: kunnen na schema 12 nog planblokken en `mt_planinrichting` schrijven (Codex): werkstop en herladen zijn een harde voorwaarde.
- De drempel is te verlagen door een oude eigenaars-tab (zie 5b); worker-aanpassing is een mogelijk vervolg (vraagt een deploy).
- P4b: de tijdlijn schrijft alleen datums en koppelingen via het taakpaneel-pad; beperkingen (F2b) en vaste datums blijven gelden.
- D0: de vlag staat uit; D2/D3 schakelen hem later in na Barts antwoorden.
- Aanbetalingspoort: bepaalt alleen of de factuur duidelijk een aanbetaling is; bij twijfel (creditnota, eindfactuur, betaald zonder datum) geen voorstel.
- Testharnassen hebben vandaag datumafhankelijke fouten (b-cap-zoom, rook-c3, rook-p7); op werkdagen groen.
- Capaciteit op 390 px: 13 knoppen van 22 px hoog (bedienbaar).

## Codex-review (read-only, ruwe uitvoer: `CODEX-v2240.txt`)
Codex: "no-go tenzij twee punten afgedekt", daarna "go met beide fixes/uitrolvoorwaarden".
| Bevinding | Oordeel | Verwerking |
|---|---|---|
| Blokkade: oude v2.21-tab kan `mt_planblokken` blijven schrijven na schema 12 | Terecht, al bekend en gedocumenteerd | Harde uitrolvoorwaarde (stap 0/5/5b); technisch afdwingen vraagt een workerwijziging |
| Moet: `mt_planinrichting` niet afdoende beschermd tegen een open v2.23-tab | Deels: client kan een geladen oude tab niet patchen | `planInrichtOpslaan` leest vers de schemadrempel (c268a9c); verder de werkstop |
| Bevestigd: D0 vlag uit en niets aangesloten; P4b via `drop`/`tpWijzig`/`afhWijzig` met `gezien`; P7b/P7c tellen dezelfde cellen en Outlook niet als werk; aanbetalingspoort alleen `mbGet`, nooit stil groen, geen bedragen op taken; mt-iconen.js zonder innerHTML, emoji terug in oude stijl, `.btn-xs` 26px alleen in de nieuwe stijl; scripts/cache-versies consistent | Bevestigd | - |
Door de integratie zelf gevonden: de `verplaats`-commentaarfout in de P7b-init (zie c268a9c), opgelost en door rook-p3b gedekt.