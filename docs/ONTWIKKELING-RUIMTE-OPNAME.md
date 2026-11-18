# Ontwikkeldocument: ruimtelijke opname (MT-tool)

> **Wat dit is.** Het doorlopende ontwikkeldocument van de ruimte-opname: wat we bouwen, waarom, welke keuzes we maakten, welke input
> erin ging en wat er nog gepland staat. Elke wijziging komt in het [wijzigingslog](#9-wijzigingslog) en, als er een keuze achter zit,
> in het [beslislog](#4-beslislog-wat-en-waarom). Oude keuzes worden niet weggepoetst: een herziene keuze krijgt een nieuwe regel die
> naar de oude verwijst.
>
> **Voor een reviewer (bijv. GPT/Astra).** Lees eerst §1 en §3, daarna §4 en §6. De vragen waar we een tweede blik op willen staan in §8.
> De code staat in de publieke repo `mtbart/MT-Facturatie-tool` (zie §10 voor paden en links). Er staan in dit document en in de repo
> geen klantgegevens; proefdata is verzonnen of nagebootst.
>
> Laatst bijgewerkt: 18-11-2026 · Stand: branch `ccr-6aed2904-q3dzlo`, draft-PR #5 · Nog niet live.

---

## Inhoud
1. [Doel en uitgangspunten](#1-doel-en-uitgangspunten)
2. [Voorgeschiedenis en bronnen](#2-voorgeschiedenis-en-bronnen)
3. [Huidige stand](#3-huidige-stand-18-11-2026)
4. [Beslislog: wat en waarom](#4-beslislog-wat-en-waarom)
5. [Input en feedback van Bart](#5-input-en-feedback-van-bart)
6. [Plannen en voorstellen](#6-plannen-en-voorstellen)
7. [Risico's en aandachtspunten](#7-risicos-en-aandachtspunten)
8. [Open vragen (voor Bart en voor een reviewer)](#8-open-vragen)
9. [Wijzigingslog](#9-wijzigingslog)
10. [Bestanden, links en tests](#10-bestanden-links-en-tests)

---

## 1. Doel en uitgangspunten

**Doel.** Een bestaande ruimte bij de klant vastleggen met een gewone telefoon (Samsung Galaxy S24, later ook een LiDAR-iPhone), zodat:
- de opnemer (Bart) in één rondgang de vorm, de beelden en de belangrijke details met maat vastlegt, terwijl de latere invulling (welk meubel,
  welke gordijnen) nog open is;
- iemand op kantoor (Ilona), ook maanden later, vanuit het dossier kan rondkijken en precies ziet wáár, hóe en wánneer iets gemeten is;
- het dossier later bruikbaar is voor tekenwerk (Vectorworks, interiorcad) zonder de foto's opnieuw te moeten interpreteren.

**Harde uitgangspunten** (uit eerdere afspraken en het werkpakket van 18-11):
1. Werkt zonder LiDAR, op telefoon en tablet. LiDAR is een extra bron.
2. Maten met de hand moeten altijd kunnen; de DISTO X4 (als Bluetooth-toetsenbord) is een versneller.
3. **Nooit stil gegevensverlies.** Alles wordt tijdens de rondgang bewaard; fouten zijn zichtbaar en opnieuw te proberen.
4. Een camera-schatting is nooit een maat. Per waarde is zichtbaar: gemeten, geschat, afgeleid of onbekend.
5. Het beeld (panorama, foto's) en het maatmodel zijn onafhankelijk: aan het beeld schuiven verandert geen bouwmaat.
6. Repo is publiek: geen klantgegevens, geen secrets. Commit-hooks (secret-guard, privacy-scan, sink-guard) worden nooit overgeslagen.

---

## 2. Voorgeschiedenis en bronnen

| Wanneer | Wat | Waar |
|---|---|---|
| 1–2 nov | Opname-module (beta) in de app: rekenkern, draadmodel, fotoronde per wand, vorm uit foto's, vrijgave, export/terugzetten (brok 1 t/m 3e) | `VOORTGANG-OPNAME.md`, `mt-opname-*.js` |
| 13 nov | v2.36.0: herkenning uit foto's (AI-voorstel), DISTO als toetsenbord, breed scherm | idem |
| 17 nov | AR-proef op de S24 (WebXR): hoeken aantikken, plafondmodus, rechtzetten, panorama + kijker | `docs/opname-ar-proef.html`, `docs/opname-ar-kijk.html`; overdracht `OVERDRACHT-OPNAME-AR.md` (lokaal, SharePoint) |
| 18 nov | Werkpakket "Bouw de ruimtelijke opname" (START-HIER / `OPNAME-AR-START-HIER.md`) met reparatie-patch, opslagcontrole en achtergrond voor de VW-fase | SharePoint `Applicaties/Claude` (lokaal) |
| 18 nov | Deze bouwronde + feedback van Bart na de eerste echte proef | dit document |

**Prioriteit van Bart voor de eerste proef (18-11):** één kamer rondlopen met live contourlijnen en tijdens diezelfde rondgang de beelden
verzamelen waarmee op kantoor interactief rondgekeken kan worden.

---

## 3. Huidige stand (18-11-2026)

### 3.1 Wat er is

**Telefoon (S24, Chrome) — `docs/opname-ar-proef.html`**
- *Nieuwe ruimte → Start rondgang* (project en ruimte invullen). Eén druk start ook de beeldregistratie.
- **Draadmodel** groeit tijdens het tikken: groene vloerlijn, witte staanders, oranje plafondlijn zodra het plafond bekend is.
- **Vakjes op de wanden** kleuren groen waar al beeld is, oranje waar nog niet.
- **Plattegrondje** linksonder: jouw plek en kijkrichting, getikte wanden, standpunten met beeld, en een ring met de richtingen die al
  beeld hebben (plus ▲ omhoog / ▼ omlaag). Alleen bij stilstand én een echte leemte: *"Draai hier even naar links en omhoog"*.
- **Vlakken** (knop, standaard uit): de wandvlakken die ARCore zelf vindt, als blauwe lijnen. Altijd bewaard als ruw scanvoorstel.
- **Bij elke hoektik een scherpe foto** (volle camera-resolutie) met de camerastand en de plek van de tik op de foto.
  Richt je daarna omhoog boven die hoek, dan volgt vanzelf een **plafondfoto**.
- **Foto** (knop): een hele wand in één beeld; de app herkent welke wand en of hij helemaal in beeld is. Telt dubbel in het panorama.
- **Detail** (knop): punt op de wand onder het kruisje + scherpe foto; soort kiezen (leiding, stopcontact, raam, …), referentiehoek
  kiezen, maten invullen. Het oranje veld is waar de X4 zijn maat zet; leeg = open vraag; opmerking met datum en bron.
- **Na de rondgang**: wandmaten, plafondhoogte, controlemaat (diagonaal) met verwachte waarde, **hoeken nakijken op de foto**
  (echte hoek aantikken; de tik blijft bewaard), details bewerken, *Nog open vóór vertrek*, wanden aan elkaar plakken (panorama),
  pakket maken/delen (zip), aanvullen in een nieuwe rondgang (eerst uitlijnen op H1 en H2, anders *Apart*), ruimte afsluiten/heropenen.
- Alles wordt stapsgewijs bewaard (IndexedDB via `mt-opname-opslag.js`, met revisiecontrole). Pagina dicht → openen → verder.

**Kantoor — `docs/opname-ar-kijk.html`**
- Zip openen (ook oude panoramabestanden), of op de telefoon zelf de opname uit de opslag.
- Slepen = rondkijken, scrollen/knijpen/± = zoomen, pijltjes = lopen, *Van boven* = poppenhuis.
- Kijkpunten (rondjes in beeld, stippen op de plattegrond), hoekmarkeringen (H1…) met hoekfoto (rood = getikt, groen = gecorrigeerd),
  detailmarkeringen per groep met originele foto, maten (bron, status, tijd, ingevoerde tekst, historie), rode maatlijnen op de wand,
  open vragen. *Dossier*: lijnmodel in mm, controlematen, onderdelen per groep, opmerkingen, open vragen, rondgangen met tellers.

**Dossier — `mt-ruimte-dossier.js` (schema `mt-ruimte-dossier` 0.1.0)**
- Stabiele ID's: project, ruimte, sessie, hoek, wand, beeld, detail, meting, opmerking. Relaties via ID's.
- Metingen: waarde (mm), grootheid, betekenis, referentie, invoertekst, bron (`disto`/`hand`/`ar`), status (`gemeten`/`geschat`/`open`),
  tijd, sessie, `vervangt` (historie; nooit overschrijven).
- Groepen: bouwdeel, installatie, afwerking (met profiel-ID), meubilair, materiaal (kleur/textuur; code onbekend = *visuele benadering*), notitie.
- Lijnmodel: oorsprong in een binnenhoek op de afgewerkte vloer, X langs de eerste wand, Y de kamer in, Z omhoog, mm, rechtsdraaiend;
  punten en segmenten met status per waarde; sluitfout; controlematen.
- Pakket (zip): `dossier.json` (+ momentopname van lijnmodel, detailplekken, controlematen, open vragen), `beelden/<soort>/…`, `panorama/W*.jpg`;
  relatieve paden, sha256 per beeld.

### 3.2 Testlinks (per commit vastgezet)
- Telefoon: `https://raw.githack.com/MTBart/MT-Facturatie-tool/<commit>/docs/opname-ar-proef.html`
- Kantoor: `https://raw.githack.com/MTBart/MT-Facturatie-tool/<commit>/docs/opname-ar-kijk.html`
- Laatste commit staat in §9. Let op: opnames horen bij de site (`raw.githack.com`); open altijd via hetzelfde domein.

### 3.3 Wat is echt getest en wat niet
| Onderdeel | Op hardware (S24) | Alleen nagebootst |
|---|---|---|
| Hoeken tikken, draadmodel, plafondmodus, panorama (17-11) | ja | |
| Live lijnen van ARCore-vlakken | ja (18-11: "onrustig" → standaard uit) | |
| Pakket delen | deels (deelmenu geopend, tabblad per ongeluk gesloten) | |
| Detail met foto, X4 in het detailpaneel, hoekfoto, plafondfoto, knop Foto | | ja |
| Hoeken nakijken op de foto | | ja (72 mm fout → <2 mm na één tik) |
| Volle opslag, opnieuw proberen, heropenen, kijker met zip | | ja (headless Chromium) |
| Geweigerde cameratoestemming | | nee (alleen de foutmelding in code) |
| iPhone / RoomPlan / Nomad | | niet gebouwd |

---

## 4. Beslislog (wat en waarom)

Formaat: **B-nr · datum · besluit** — *waarom* — *alternatieven* — *gevolg/herzien wanneer*.

**B1 · 18-11 · Bouwen op de AR-proefpagina's in `docs/`, niet meteen in `mobiel.html`.**
*Waarom:* die pagina's zijn al op de S24 getest; `mobiel.html` is groot (480 kB) en een fout raakt de hele app. *Alternatief:* direct in de
opname-laag van de app. *Gevolg:* integratie in het Meer-menu volgt als de proef goed is (P6).

**B2 · 18-11 · Eigen dossierformaat `mt-ruimte-dossier` 0.1.0 naast `mt-opname` 0.4.**
*Waarom:* het nieuwe model draait om een AR-ruimte (hoeken met coördinaten, beelden met camerastand, sessies, uitlijning); het oude model
om losse wandfoto's en vrijgave. Samenvoegen zou de bestaande vrijgave/inhoudshash breken. *Gevolg:* ze delen wél de opslag
(`mt-opname-opslag.js`, records met `soort: 'ruimte'`); de beta-lijst slaat die over. Een oude opname omzetten kan later (zie §8).

**B3 · 18-11 · Assen: oorsprong in een binnenhoek, X langs de eerste wand, kamer altijd aan de +Y-kant, rechtsdraaiend.**
*Waarom:* herkenbaar ter plaatse en geschikt voor CAD (Z omhoog, mm). Omdat een rondgang met of tegen de klok kan lopen, wordt bij een
rondgang tegen de klok H2 de oorsprong en loopt X van H2 naar H1. *Gevolg:* de gekozen oorsprong staat altijd in `lijnmodel.oorsprong`.
*Herzien* als de VW-koppeling een vaste gevelhoek als oorsprong wil (zie referentie "R1" in de latere VW-fase).

**B4 · 18-11 · Maten worden nooit overschreven.** Een nieuwe waarde komt erbij met `vervangt`; de oorspronkelijke invoer (bijv. "84,5 cm")
blijft. *Waarom:* herkomst en controle achteraf; "nooit stil verlies".

**B5 · 18-11 · Een camera-schatting sluit geen open vraag** (behalve bij los meubilair, waar geschat mag). *Waarom:* anders lijkt iets
gemeten wat alleen geschat is.

**B6 · 18-11 · Draadmodel centraal; ARCore-vlakken standaard uit (knop *Vlakken*).** *Waarom:* feedback Bart na de proef: de vlaklijnen
maakten het onintuïtief, de vorige versie met het groeiende draadmodel was logischer. Vlakken worden wel bewaard als ruw scanvoorstel
(`sessie.scan_voorstellen`) en geteld als "automatisch gevonden". Vervangt de eerdere keuze (zelfde dag) om ze altijd te tonen.

**B7 · 18-11 · Draai-aanwijzing alleen bij stilstand (2,5 s binnen 30 cm) en een echte leemte.** *Waarom:* het werkpakket vraagt
"uitsluitend bij een echte leemte"; geen gezeur tijdens het lopen. Waar een aanwijzing nodig was, wordt vastgelegd (`draai_aanwijzingen`).

**B8 · 18-11 · Bij elke hoektik een scherpe foto; hoeken corrigeren op de foto; de tik blijft bewaard.**
*Waarom:* feedback Bart: tikken uit de hand is onnauwkeurig; met een echte foto per hoek kan de hoek later naar de echte positie worden
gecorrigeerd (door de opnemer, of later door herkenning). Techniek: kijkstraal door de aangewezen pixel (inverse van projectie×camera)
gesneden met vloer- of plafondvlak. *Gevolg:* `hoek.xr_ruw`, `hoek.correctie` (bron `foto`, later `ai`), archief; terugzetten kan.
Pakket wordt een paar MB groter (1–2 foto's per hoek op volle resolutie).

**B9 · 18-11 · Plafondfoto automatisch** zodra je na een hoektik omhoog richt, recht boven die hoek (binnen 25 cm, < 12 s). *Waarom:* Bart wil
de plafondpunten ongeveer meenemen zonder extra knop. Overslaan mag.

**B10 · 18-11 · Knop *Foto* voor een hele wand; telt dubbel in het panorama.** *Waarom:* feedback Bart: de vakjes werken goed; vanaf een
punt waar de hele wand in beeld is één goede foto maken. De app meldt of de hele wand erop staat.

**B11 · 18-11 · Aanvullen alleen na uitlijnen op twee bekende hoeken (rest ≤ 8 cm), anders *Apart*.** *Waarom:* werkpakket: een niet
uitgelijnde sessie apart houden; nooit stil samenvoegen.

**B12 · 18-11 · Pakket = zip zonder compressie, relatieve paden, sha256, plus een momentopname van het lijnmodel.** *Waarom:* hergebruik
van de bestaande zip-schrijver; foto's zijn al gecomprimeerd; een lezer zonder rekenkern (of Claude/Astra later) kan alles uitlezen.

**B13 · 18-11 · Testen via `raw.githack.com` per commit.** *Waarom:* live zetten pas na akkoord; een vaste commit voorkomt dat de browser
een oude versie toont. *Let op:* opslag hoort bij het domein.

**B14 · 18-11 · iPhone/RoomPlan niet in de webapp.** *Waarom:* Safari geeft geen toegang tot LiDAR en heeft geen WebXR-AR; RoomPlan vraagt een
eigen iOS-app. Eerst een echte Nomad-export bekijken (P8).

**B15 · 18-11 · Vectorworks-export valt buiten deze bouwronde** (werkpakket). Een bemaatde kameruitslag als PDF kan wél eerder, rechtstreeks uit
het dossier (P2). Zie §6.

**B16 · 18-11 · Na heropenen opnieuw kunnen plakken.** *Waarom:* bij de proef ging het tabblad per ongeluk dicht; de beelden stonden veilig,
maar plakken kon alleen direct na de rondgang. Nu komen de beelden terug uit de opslag.

**B17 · 18-11 · Getikte hoeken vastzetten met ARCore-ankers.** *Waarom:* proef 20:53: de vakjes op de wand schoven ten opzichte van de echte wand.
Oorzaken: tikken van ver (3–5 m), ARCore die zijn kaart onderweg bijstelt terwijl de getikte punten vast bleven, aangenomen hoogte 2,60 m zolang het plafond
niet gemeten is, en de schaalfout van 1–2 %. Met ankers (WebXR `anchors`, optioneel) schuiven de hoeken mee met de bijgestelde kaart; sprongen > 50 cm worden
genegeerd; de oorspronkelijke tik blijft (`xr_tik`). *Nog te toetsen op het toestel.* Zonder ankers werkt alles zoals voorheen.

**B18 · 18-11 · Groothoek niet in AR, wel per wand na de rondgang.** *Waarom:* Bart staat in kleine ruimtes te dicht op de wand. ARCore gebruikt altijd de
hoofdcamera en Chrome kan in een AR-sessie niet wisselen. Buiten AR: foto met de gewone camera-app op 0,6×, de opnemer tikt de 4 wandhoeken aan, de app trekt
de foto recht met een homografie (`AR.homografie`) tot een wandbeeld. Dat beeld gaat vóór het geplakte AR-panorama (`panorama[].bron = 'groothoek'`); de
originele foto en de aangetikte hoeken worden bewaard. Lensvertekening: de Samsung-camera corrigeert die standaard; een sterk vertekende foto geeft kromme lijnen.

**B19 · 18-11 · Knop Foto: een deel van de wand is ook goed.** De melding zegt niet meer "stap achteruit": het panorama voegt stukken samen; voor een
volledig wandbeeld in een kleine ruimte is er de groothoekfoto (B18).

**B20 · 18-11 · Herziet B17: ARCore-ankers alleen meeschrijven, niet meer verplaatsen.** *Waarom:* de eerste rondgang mét verplaatsende ankers (21:14)
gaf in dezelfde kamer een veel slechtere vorm dan de rondgang zonder (20:27: sluiting 7 mm). Niet bewezen dat de ankers de oorzaak zijn, maar de meting
mag er niet onder lijden. De ankerpositie wordt bewaard als `xr_anker` (met afstand tot de tik) en geteld als `anker_wijkt_af`, zodat we het kunnen
vergelijken. De tik is weer leidend; de vakjes kunnen dus weer iets schuiven.

**B21 · 18-11 · Hoek weghalen en waarschuwen bij een spie of dubbele hoek.** *Waarom:* 21:14 kwam een sluittik 0,9 m naast H1 terecht en werd een vijfde
hoek (binnenhoek ~2°). Waarschuwing bij een binnenhoek < 30° of > 330° en bij twee hoeken < 20 cm uit elkaar; *Hoek weghalen* voegt de twee wanden
samen (lengte weer open, details verhuizen zonder plek langs de wand, alles in het archief).

**B22 · 18-11 · Tekenen volgt het anker, de meting blijft de tik.** *Waarom:* na B20 schoven de wanden weer (Bart, 21:30). Draadmodel, vakjes, detailwanden en
de herkenning van de sluittik gebruiken nu de positie waar ARCore de hoek op dat moment ziet (anker); bewaard wordt de tik, met de ankerpositie ernaast
(`xr_anker`). Zo blijft het beeld op de echte wand zonder dat de meting verschuift, en wordt een sluittik op H1 ook herkend als de kaart onderweg is
bijgesteld (21:14: 0,9 m). Sluitafstand 20 → 25 cm. *Te toetsen op het toestel.*

**B23 · 18-11 · Een opgeslagen maat houdt haar eigen referentie (review GPT, fout hersteld).** *Was:* de plek langs de wand werd gerekend vanaf
`det.referentie_hoek`, de keuzelijst in het paneel. Die wisselen verschoof een bestaande maat (800 vanaf A werd 2200 vanaf A), en dezelfde waarde vanaf de
andere hoek werd als "ongewijzigd" overgeslagen. *Nu:* `D.maatLangsWand` gebruikt de referentiehoek en de wand (`meting.wand_id`, nieuw) van de meting
zelf; de keuzelijst geldt alleen voor de volgende invoer. Geen referentie (oude invoer) of een wand die niet meer klopt → plek *onzeker* met reden.
Een meting komt er alleen bij echte nieuwe invoer (Enter en change tellen één keer); dezelfde waarde met een andere hoek, bron of status is wél nieuw.
Getest in de dossierkern (reproductie van de review), in de browser en na heropenen.

**B24 · 18-11 · Maatlijnen in de kijker volgen de gemeten maat (review GPT).** Rood = gemeten (vanaf de hoek van de meting), oranje = camera of onzeker;
het paneel zegt waarop beide lijnen berusten en geeft de camera-aanwijzing apart. Het label in beeld blijft op de camera-plek, zodat foto-aanwijzing
en gemeten eindpunt afzonderlijk terug te vinden zijn.

**B25 · 18-11 · Modellengte naast het gemeten label (review GPT).** Per wandsegment `lengte_model_mm` en `verschil_model_mm`: sluit de kamer niet,
dan ziet de tekenaar het verschil expliciet (ook in het dossierpaneel van de kijker).

**B26 · 18-11 · Besluiten uit de review bij de open vragen.**
- *Schaalcorrectie (P10):* nog niet toepassen. Eerst ruwe tegenover rechtgezette lengtes, beide diagonalen en per richting een tussenliggend detail
  onafhankelijk meten; fout voor en na correctie op een tussenmaat vergelijken. Een gecorrigeerde schatting naast de ongewijzigde bron bewaren.
- *Hoekfoto:* één scherpe foto waar hoek en vloerpeil goed zichtbaar zijn; een tweede aanzicht vragen bij een afgedekte hoek, plint of twijfel over het peil.
  De < 2 mm uit de simulatie is geen toestelmeting; toetsen tegen echte onafhankelijke maten.
- *Kameruitslag (P2):* eerst als leescontrole door kantoor. Per wand referentiehoek en kijkrichting; horizontaal bematen vanaf die afgewerkte hoek,
  verticaal vanaf de afgewerkte vloer; maatbetekenis en bron per waarde; dagkant, kozijnzijde en hart apart herkenbaar; wanddikte of negge *onbekend*
  als niet gemeten; voor leidingen ook het verloop in de ruimte.
- *Gordijnen (P1):* geen startstap. Vrije vooropname blijft; gordijnmaten optioneel aanbieden zodra de opnemer een raam kiest.
- *Overdracht:* onderbreken en teruglezen op de kantoor-pc testen voordat de telefoon de enige kopie opgeeft. Echte woningbeelden blijven binnen het
  project met de bestaande toegangsrechten; openbare testlinks alleen met fictieve beelden.

**B27 · 18-11 · Ankerposities echt bewaren en vergelijken; plafond uit de plafondfoto.** Bij Klaar gaat per hoek de laatste ankerpositie mee (`xr_anker`),
en het lijnmodel geeft per wand ook de lengte volgens de ankers (`anker_camera_mm`) naast tik en rechtgezet. Volgende proef met handmaten beslist welke
het dichtst bij de werkelijkheid ligt. Een automatische plafondfoto (omhoog boven een hoek) zet nu ook de plafondhoogte als die nog onbekend was
(camera-schatting), zodat draadmodel en vakjes niet op 2,60 m blijven staan. Tips in de startinstructie: eerst 10–15 s rustig rondkijken voor het eerste
tikken, goed licht, rustig lopen, sluiten met Klaar.

**B28 · 18-11 · Sneller opslaan en wegschrijven bij sluiten.** De browsertest liet zien dat een meting die vlak vóór het sluiten van de pagina werd
ingevoerd verloren kon gaan (opslaan wachtte 1,2 s). Nu 0,4 s, en bij `visibilitychange` (naar de achtergrond) en `pagehide` wordt wat nog wacht
meteen weggeschreven. Een tabblad dat binnen een fractie van een seconde na de invoer wordt gesloten blijft een (kleine) restkans; daarom toont de pagina
"Veilig bewaard".

**B29 · 18-11 · Twee fases in één AR-sessie: eerst de plattegrond, dan scannen.** *Waarom:* Bart: "het lijnen trekken gaat het best als je in een vloeiende
beweging van onder alle punten pakt, terwijl de tekst steeds zegt kijk opzij en omhoog". Fase 1 (plattegrond): alleen hoeken tikken, met stil een hoekfoto
per tik; geen vakjes, geen draai-aanwijzing, geen plafondtip. *Klaar* (of de sluittik) zet de hoeken in het dossier en gaat in dezelfde sessie door naar
fase 2 (scannen): de kamer is gesloten, vakjes op alle wanden, aanwijzingen aan, plafondfoto bij elke hoek waar je omhoog richt (zet ook de plafondhoogte),
duimknop = Detail. *Klaar* sluit af. Geen nieuwe uitlijning nodig, omdat het dezelfde AR-sessie is. Vervangt het eerdere plafondtip-na-elke-tik (B9).

**B30 · 18-11 · Haaksheid controleren met een driehoeksmeting, niet met een diagonaal.** *Waarom:* Bart: "die diagonale meting is onbetrouwbaar, je kan
met die lasermeter niet strak in de hoeken meten" (plinten, meubels, 6,5 m lang). Herziet het advies uit B26/§5.1 om beide diagonalen te meten.
Nu: per hoek a mm langs de wand ervoor en b mm langs de wand erna een merkteken (standaard 1000/1000 op ±1 m hoogte) en de schuine maat c;
`D.hoekUitDriehoek` (cosinusregel), `D.voegDriehoekToe` (met gevoeligheid: op 1000/1000 is 1 mm ≈ 0,08°), `D.controleHoeken` (gemeten naast het model;
> 0,5° verschil = open vraag "niet haaks"). De diagonaal blijft mogelijk, maar alleen "als het vrij en strak te meten is". Alternatieven voor later:
controlemaat tussen twee wandpunten met afstand tot de hoek, of DISTO met DST 360 (P2P).

**B31 · 18-11 · Controlemaat tussen twee merktekens op de wanden (Barts keuze "optie 2"), hoek meten optioneel.** Per tape: wand, vanaf welke hoek,
afstand tot die hoek; daarnaast de afstand tape tot tape (op gelijke hoogte). `D.puntOpWand`, `D.voegControleToe`, `D.controleMaten` (soort `wandpunten`)
rekenen de verwachte afstand uit het lijnmodel; > 15 mm verschil = open vraag. Op het telefoonscherm staat dit blok vóór de driehoeksmeting (die
optioneel blijft, "voor nu zijn hoeken nog niet zo van belang") en vóór de diagonaal. Werkt pas zinvol met ingevulde wandmaten (anders vergelijkt het
met het camera-model; de app zegt dat erbij).
*P2P (Bart vroeg):* DISTO X3/X4 → adapter **DST 360**; DISTO X6 → **DST 360-X** (o.a. in het X6 P2P-pakket). Niet uitwisselbaar; bij de leverancier
navragen. Met P2P is een controlemaat tussen twee willekeurige punten vanaf één standplaats mogelijk.

**B32 · 18-11 · Wandaanzicht: lijntekening per wand om kozijnen (en deur, radiator, stopcontact) te bematen.** *Waarom:* Bart wil na de rondgang de
kozijnen bematen in een lijntekening van de wand. `D.wandAanzicht` geeft de wand zoals vanuit de kamer gezien (welke hoek links/rechts, met `AR.aLinks`),
lengte en hoogte uit het lijnmodel met hun status, en de details als rechthoek of punt in mm vanaf de linkerhoek en de vloer; `D.maatketen` maakt
de ketens (restmaat *afgeleid* als alle andere delen en het totaal hard zijn, anders *geschat*). Nieuw detailsoort **kozijn** met buitenmaat breedte/hoogte,
onderkant boven vloer, afstand tot de hoek, en optioneel dagmaat en bovenkant-tot-plafond (optionele maten geven geen open vraag). Op de telefoon: SVG met
het wandbeeld (panorama of groothoekfoto) licht eronder, maatketens onder de wand en naast het kozijn, kleuren per status, live voorbeeld tijdens het typen
(oranje = nog niet bewaard), X4-invoer en referentiehoek zoals in het detailpaneel (B23). Foto per kozijn vanuit hetzelfde scherm. Een kozijn waarvan de
plek uit de maten volgt, krijgt geen melding "alleen op foto". Vervolg: dezelfde tekening in de kijker en als PDF (P2).

**Waarneming (geen besluit):** met vier gemeten wandlengtes en haakse hoeken maakt de kaartdrift voor het lijnmodel weinig uit (de richtingen worden
rechtgezet, de lengtes komen uit de maten). De drift raakt vooral de aansluiting tussen beelden en wanden in het panorama en de camera-plek van details.

---

## 5. Input en feedback van Bart

| Datum | Input | Wat ermee gedaan |
|---|---|---|
| 18-11 | Opdracht: opname op de S24, op kantoor met de muis rondkijken, detailfoto's + X4/handmaten op de juiste plek, lijnmodel bewaren voor VW. Eerst een werkende testversie voor S24 en kantoor-pc. | Gebouwd (§3). |
| 18-11 | Eerste proef = één kamer met live contourlijnen en tijdens dezelfde rondgang beelden voor interactief rondkijken. | Plattegrondje, richtingsring, draai-aanwijzing, ARCore-vlakken; daarna B6. |
| 18-11 | "Lijntjes in beeld, maar super onintuïtief; de vorige versie met het draadmodel in de ruimte was veel logischer." | B6. |
| 18-11 | Per ongeluk op het kruisje gedrukt na *Delen*. | B16; gegevens waren veilig. |
| 18-11 | Vakjes op de muur zijn goed. Knop voor een losse foto vanaf een plek waar de hele wand in beeld is. Plafondpunten ook ongeveer meenemen. Bij een hoektik meteen een echte foto, zodat de getikte punten gecorrigeerd kunnen worden naar de echte hoek (via AI of in de app). | B8, B9, B10. AI-herkenning gepland (P4). |
| 18-11 | Test: gordijnen inmeten in deze ruimte → goede foto's van de kozijnen en de maatvoering ervan. Via VW een presentatielaag-PDF: "Europese projectie" van de kamer met de wanden eromheen, volledig bemaat? | Voorstel P1 (gordijnenprofiel) en P2 (kameruitslag-PDF), P3 (VW-route). |
| 18-11 20:27 | Echte proef, rechthoekige kamer ~2,9 × 5,8 m (zie §5.1). | Waarneming schaalfout camera → voorstel P10; diagonaal gevraagd. |
| 18-11 20:53 | Screenshots: "de velden verschuiven ten opzichte van de wanden"; "kan ik mijn groothoekcamera gebruiken? Ik sta zo dicht op de wanden dat ik geen volledig beeld krijg". | B17, B18, B19. |
| 18-11 21:14 | Tweede proef met ankers: 5 hoeken, vorm scheef (zie §5.1). | B20, B21; pakket gevraagd voor diagnose. |
| 18-11 21:30 | "Weer verschuiven de wanden." | B22. |
| 18-11 21:45 | Review van GPT (`OPNAME-AR-REVIEW-2026-11-18.md`, op stand `ddeedbf`). | B23–B26; acceptatieproef §6 P0. |
| 18-11 21:50 | Pakket van de proef van 21:26 gedeeld (`ruimte-Test-8-Joe-…zip`), niet in de repo bewaard. | Analyse §5.1, B27. |
| 18-11 22:00 | "Lijnen trekken gaat het best in één vloeiende beweging langs de vloer; de tekst zegt steeds kijk opzij en omhoog. Eerst een rondje plattegrond, daarna scannen. Kunnen we groothoekfoto's vanuit de app halen als het een echte app wordt?" | B29; P11. |
| 18-11 22:10 | "Die diagonale meting is onbetrouwbaar: met de lasermeter kom je niet strak in de hoeken." | B30. |
| 18-11 22:20 | "Optie 2 (controlemaat tussen twee punten op de wanden) voor nu; hoek meten kan ook, hoeken nog niet zo van belang. Is de P2P-adapter dezelfde als voor de DISTO X6?" | B31. |
| 18-11 22:30 | Proef 21:52 met twee fases: camera binnen ±13 mm van de handmaten. | §5.1. |
| 18-11 22:45 | "De ruimte staat ±; ik heb bij een ruimte de exacte maten achteraf ingevuld. Wil nu mijn kozijnen bematen: kan er een lijntekening van de wand komen waarin ik het kozijn kan bematen?" | B32. |
| 18-11 | Ontwikkeldocument waarin alles staat, zodat terug te zien is wat waarom veranderde; Astra moet er licht op kunnen laten schijnen. | Dit document. |

### 5.1 Meetresultaten echte proeven

**18-11-2026 20:27 · S24 · rechthoekige kamer · 4 hoeken getikt · telefoon op 1,58 m**

| Wand | Camera (rechtgezet) | Zelf gemeten | Verschil | Hoek gemeten → gezet |
|---|---|---|---|---|
| W1 | 2934 | 2900 | +34 (+1,2 %) | H1 89,8° → 90° |
| W2 | 5886 | 5774 | +112 (+1,9 %) | H2 90,6° → 90° |
| W3 | 2934 | 2902 | +32 (+1,1 %) | H3 89,4° → 90° |
| W4 | 5886 | 5781 | +105 (+1,8 %) | H4 90,2° → 90° |

Sluiting met eigen maten 7 mm (zonder rechtzetten 33 mm). Punten (m, AR): -0.092;-1.748 2.558;-0.528 0.148;4.843 -2.533;3.607.

*Waarnemingen:* hoeken tikken ruim binnen 1° van haaks; rechtzetten verbetert de sluiting van 33 naar 7 mm. De camera schat **systematisch 1–2 % te lang**
(schaal, geen ruis). De resterende 7 mm zit in de eigen maten (lange wanden 5774/5781, korte 2900/2902): kamer licht scheef of een maat net anders genomen.
Verwachte diagonaal bij een haakse kamer ≈ 6465 mm; beide diagonalen meten beslist het.

**18-11-2026 21:14 · S24 · vermoedelijk dezelfde kamer · versie met verplaatsende ARCore-ankers (B17)**

| Wand | Camera | Hoek gemeten → gezet |
|---|---|---|
| W1 | 2965 | H1 266,9° → 270° |
| W2 | 5154 | H2 91,0° → 90° |
| W3 | 3248 (schuin) | H3 71,4° → 77,9° |
| W4 | 5270 | H4 99,0° → 99,8° |
| W5 | 790 | H5 11,8° → 2,3° |

Punten (m): -1.214;-2.928 1.380;-3.107 1.844;2.254 -1.758;1.379 -1.329;-3.847. Geen eigen maten ingevuld.

*Waarnemingen:* vijf hoeken voor een rechthoekige kamer; H5 ligt 0,9 m naast H1 (sluittik niet herkend → spie). Ook zonder H5 is de vorm scheef
(korte wanden 2,6 en 3,7 m, lange 5,4 en 5,2 m) tegen 2,93/5,89 om 20:27. Mogelijke oorzaken: tracking-drift tijdens deze rondgang, of de nieuwe
verplaatsende ankers. Gevolg: B20 en B21. Voor de diagnose is het pakket (zip) van deze rondgang nodig: daarin staan per hoek de tik, de ankerpositie,
de camerastanden van alle beelden (looppad) en hoe vaak de tracking kwijt was.

**18-11-2026 21:26 · S24 · dezelfde kamer (±2900 × 5778) · versie met tik leidend en ankers meeschrijvend (B20) · pakket ontvangen (3,7 MB, 117 beelden)**

| Wand | Ruw camera | Rechtgezet | Echt (handmaten 20:27) |
|---|---|---|---|
| W1 | 3087 | 3282 | ±2900 |
| W2 | 6008 | 5958 | ±5778 |
| W3 | 3480 | 3282 | ±2900 |
| W4 | 5915 | 5958 | ±5778 |

*Uit het pakket:* 4 hoeken netjes getikt (op de hoekfoto's ligt het getikte punt bij H1, H3, H4 en de plafondhoek van H1 precies op de hoek; H2 zat achter
een plaat). 68 overzichtsbeelden, tracking 1× kwijt, 7× iets automatisch gevonden (vloer, wandvlakken). **De ARCore-ankers weken binnen 10 s 74 mm en na
±50 s 291 mm af van de tik**: de kaart dreef tijdens de rondgang van 80 s fors (avond, effen groene wanden). Elke hoek is dus in een iets andere versie van
de kaart getikt; dat verklaart de scheve vorm, niet de tik zelf en niet de ankers (die stonden in deze versie stil). Plafond niet vastgelegd (plafondfoto
wel). Tweede rondgang (aanvullen) bewaard als *niet uitgelijnd*. Geen maten ingevuld.
**18-11-2026 21:52 · S24 · dezelfde kamer · versie met twee fases (B29: eerst plattegrond in één beweging, dan scannen)**

| Wand | Rechtgezet | Ruw camera | Handmaat (20:27) | Verschil rechtgezet |
|---|---|---|---|---|
| W1 | 2893 | 2882 | 2900 | −7 |
| W2 | 5787 | 5794 | 5774 | +13 |
| W3 | 2893 | 2902 | 2902 | −9 |
| W4 | 5787 | 5780 | 5781 | +6 |

Hoeken gemeten 90,1 / 90,1 / 89,6 / 90,2° → gezet 90°. Telefoon op 1,44 m. Punten (m): -2.132;-4.454 0.639;-5.248 2.247;0.318 -0.547;1.104.
*Waarnemingen:* camera binnen ±0,3 % van de handmaten (eerder +1–2 % om 20:27 en tot +20 % om 21:26), hoeken binnen 0,4° van haaks. De systematische
schaalfout van 20:27 is hier niet zichtbaar; P10 (schaalcorrectie) blijft daarom terecht uitgesteld. Waarschijnlijke oorzaken van de verbetering: de
plattegrond in één vloeiende beweging langs de vloer (B29), eerst rondkijken, en/of beter licht. Nog te bevestigen met het pakket (ankerposities) en
een controlemaat tape tot tape.

*Fout gevonden:* de ankerposities kwamen niet in het pakket (`xr_anker` ontbrak; Klaar gaf de verkeerde veldnaam door). Hersteld (B27).

---

## 6. Plannen en voorstellen

Volgorde = voorgestelde prioriteit. Status: **voorstel** (nog niet gebouwd) tenzij anders vermeld.

### P0 · Eerste acceptatie op echte toestellen (uit de review, eerst doen)
Eén S24-rondgang met een raam en een radiator of leiding ervoor, vloer en plafond. Beelden bij de deur én schuin bij het raam. Een X4-maat met twee
duidelijke referenties en één open vraag. Telefoonpagina sluiten, heropenen, pakket maken; Ilona opent het op haar eigen pc. Kan zij zonder uitleg
langs de wanden slepen, beide gezichtspunten herkennen, de originele foto en de werkelijke maat aanwijzen? Noteren: MB, tijd tot eerste beeld,
ontbrekende kijkrichtingen. Uitkomst bepaalt of per kijkpunt een apart panorama nodig is (radiator vóór raam).

### P1 · Gordijnen-proef: meetprofiel voor kozijnen
**Waarom:** concrete klus; laat zien of foto + maat per kozijn genoeg is om gordijnen (rail, roede, stof) te bestellen.

**Voorstel (aangepast na review, B26):** geen keuze bij de start. Kies je bij een detail *Raam*, dan biedt de app de gordijnmaten optioneel aan
(knop *Gordijnmaten erbij*). Per raam (detail soort *raam*, op een wand):

| Maat | Betekenis (vastleggen!) | Waarom voor gordijnen |
|---|---|---|
| Afstand tot de hoek (links) | tot buitenkant kozijn | positie rail/roede, stapelruimte |
| Kozijn buitenmaat breedte | buitenkant tot buitenkant | breedte rail = kozijn + overlap |
| Kozijn buitenmaat hoogte | onderkant tot bovenkant kozijn | stofhoogte |
| Dagmaat breedte en hoogte | binnenkant (glas/dag) | inbouw (vitrage in de dag), lamellen |
| Borstwering | vloer → onderkant dag | vallengte tot vensterbank |
| Bovenkant kozijn → plafond | vrije hoogte boven het kozijn | rail op plafond of wand, ophanghoogte |
| Vrije wand links en rechts | kozijn → hoek of obstakel | stapelruimte gordijn |
| Vensterbank: uitsteek, lengte, dikte | vanaf het afgewerkte wandvlak | gordijn vóór of boven de bank |
| Radiator onder het raam: uitsteek, hoogte | vanaf wandvlak | gordijn moet vrij hangen |
| Raamkruk / draairichting | uitsteek bij openen | vrije ruimte rail |
| Plafond- of wandtype | opmerking (beton, gips, verlaagd) | bevestiging |

**Foto's per raam:** één recht ervoor (hele kozijn, knop *Foto* of Detail), één detail van de bovenkant (railplek), eventueel de zijkanten.
De meetvelden komen in het bestaande detailpaneel (X4/hand, open vragen).
**Klaar als:** in een echte kamer alle ramen met deze maten en foto's in het pakket staan en Ilona ze op kantoor kan uitlezen.

### P2 · Bemaatde kameruitslag als PDF, rechtstreeks uit het dossier
**Wat:** een A3- of A4-PDF met de plattegrond in het midden en de wanden eromheen "opengeklapt" (elke wand als aanzicht vanuit de kamer,
met de vloerlijn tegen de rand van de plattegrond). Bart noemt dit *Europese projectie*; het is een kameruitslag / opengeklapte kamer.

**Inhoud per wandaanzicht:** totale wandlengte en hoogte; kozijnen, deuren, nissen, radiator, leidingen, stopcontacten op hun plek;
maatketens vanaf de hoeken (positie, breedte), hoogtematen (borstwering, bovenkant kozijn, kozijn → plafond); optioneel de geplakte wandfoto
licht als onderlaag. **Statuszichtbaarheid:** gemeten = zwart, geschat = grijs met "~", open = rood "?". Titelblok: project, ruimte,
datum, opnemer, schaal, oorsprong en assen.

**Hoe:** in de kijker (kantoor) een knop *PDF kameruitslag*; tekenen met `vendor/jspdf.umd.min.js` (staat al in de repo, wordt al gebruikt
in de cockpit). Alles komt uit het lijnmodel en de detailmaten; geen Vectorworks-licentie nodig.
**Voordeel:** snel, werkt op elke pc, direct bruikbaar voor gordijnen en offertes. **Nadeel:** geen bewerkbare CAD-tekening.
**Klaar als:** uit het proefpakket een PDF komt waarin alle gemeten kozijnmaten staan en geschatte/open maten herkenbaar zijn.

### P3 · Vectorworks-route met presentatielaag
**Wat:** het dossier → `mt-ruimte` 0.1.0 (schema uit de VW-verkenning) → bestaande converter op de VW-werkplek bouwt wanden, vloer, deuren en
ramen → een VW-script maakt per wand een aanzicht (viewport), zet ze opengeklapt rond de plattegrond op een presentatielaag en bemaat ze → PDF-export.
**Waarom later:** het werkpakket zet export/converter buiten deze ronde; eerst moet het lijnmodel in echte kamers kloppen. Automatisch
bematen in VW-viewports is bewerkelijk (maatketens, overlap) en vraagt de licentie op de werkplek.
**Voorstel:** P2 eerst; dezelfde maatregels (wat wordt bemaat, statuskleuren) daarna in VW overnemen. Achtergrond: `OPNAME-AR-REFERENTIE-LATER.md`
en `opname-ar-controle-vw-export.py` (SharePoint), o.a. ijkpunt R1 (`offset_hart` 2020 mm) en de controle op gastwand/50 mm-fout.

### P4 · Automatische hoekherkenning op de hoekfoto's (AI)
**Aanpak:** uitsnede rond de getikte plek (`punt_in_beeld`) → model geeft de pixel van de hoek (vloer of plafond) + zekerheid → terugrekenen
met `AR.hoekUitFoto` → **voorstel** (`correctie.bron = 'ai'`, status voorstel) dat de opnemer bevestigt. Nooit stil overnemen.
Kan via de bestaande worker (`?target=claude`, zoals `mt-opname-ai.js`). **Eerst** kijken of handmatig nakijken in de praktijk volstaat.

### P5 · Detailfoto's en details beter
Onscherp beeld herkennen en laten vervangen; tussenpunten voor een bolle of geknikte wand (afstand langs referentielijn, zijdelingse afwijking,
meethoogte); meethoogte bij vrije-breedtematen; leidingtraject met knikpunten in 3D aanwijzen in AR.

### P6 · Integratie in de app en publicatie
Knop in het Meer-menu van `mobiel.html` (rol beheer, zoals Opname-beta), daarna de release-route (`RELEASE.md`). Alleen met akkoord van Bart.

### P7 · Opslag buiten de telefoon (SharePoint)
Stap 2 uit het oorspronkelijke opnameplan: pakket of dossier automatisch naar de projectmap. Wacht op akkoord; datamodel en uploadroute eerst
langs een tweede review.

### P8 · iPhone
1) Een echte Nomad-export bekijken (inhoud, ID's, assen, eenheden, foto's) en een import naar het dossier bouwen; 2) eventueel een native
iOS-onderdeel met RoomPlan (vraagt Mac + Xcode, Apple-ontwikkelaarsaccount, iPhone Pro met LiDAR).

### P10 · Schaalcorrectie van camera-schattingen per gemeten wand
**Waarom:** de proef van 18-11 laat een vaste schaalfout van de camera zien (1–2 % te lang). Een detailplek die alleen met de camera is bepaald
(bijv. een stopcontact op 0,82 m van de hoek) erft die fout.
**Voorstel:** zodra een wand gemeten is, schaal de camera-afstanden langs die wand met `gemeten / camera` (bijv. 2900/2934). Het resultaat blijft
status *geschat* (bron `ar`, met `schaal_gecorrigeerd: true` en de bronmaat), en een echte meting gaat altijd voor. Ook als hint in het detailpaneel tonen.
**Te toetsen:** in meer kamers kijken of de factor per wand of per sessie stabiel is. **Na review (B26): nog niet toepassen**; eerst onafhankelijke tussenmaten en beide diagonalen.

### P11 · Groothoekfoto rechtstreeks vanuit een eigen app
**Vraag Bart (18-11):** kunnen we de groothoekfoto's vanuit de app erbij halen als we er echt een app van maken? **Ja, met een kanttekening.**
- In de **webapp** (nu) gaat het via de camera-app van de telefoon (0,6× kiezen) en vier hoeken aantikken (B18). Chrome kan in een webpagina niet zelf
  de groothoeklens kiezen terwijl AR loopt.
- In een **eigen Android-app** (ARCore + CameraX/Camera2) kan één knop *Groothoekfoto* de groothoeklens direct openen en de foto meteen aan de wand
  koppelen. Ook daar kan de groothoeklens niet tegelijk met de AR-tracking draaien: ARCore volgt met de hoofdcamera. De app pauzeert de AR-sessie, maakt de
  foto en hervat; daarna moet de tracking zich herpakken. Op de iPhone (ARKit) geldt hetzelfde.
- De camerastand van zo'n foto is te berekenen uit de vier aangetikte wandhoeken en de bekende 3D-hoeken (PnP, met de brandpuntsafstand uit de EXIF).
  Dan telt de groothoekfoto ook mee voor *Foto hier* en het panorama. Dat kan al in de webapp en is een logische volgende stap.
- *Afweging eigen app:* installatie via Play Store of los APK-bestand, Android Studio, onderhoud naast de webtool. Pas zinvol als de webroute op het toestel
  aantoonbaar tekortschiet.

### P9 · Kwaliteit panorama en prestaties
Perspectief-correct plakken (homografie per vak i.p.v. affien), automatisch extra kijkpunt bij een andere zichtlijn (radiator vóór raam),
`readPixels` asynchroon (PBO/OffscreenCanvas) als de AR gaat haperen, meten van geheugen bij lange rondgangen.

---

## 7. Risico's en aandachtspunten

| Risico | Gevolg | Maatregel |
|---|---|---|
| Opslag per domein | Opname "weg" als je via een ander adres opent | Altijd dezelfde site; later P7 |
| Volle telefoon | Beelden niet bewaard | Zichtbare melding + opnieuw proberen; pakket maken en wissen kan later |
| Grote pakketten | Delen via mail/WhatsApp lukt niet | MB per soort zichtbaar; detail- en hoekfoto's op volle resolutie, overzicht klein |
| Oorsprong wisselt (H1/H2) | Verwarring bij tekenen | Staat in het pakket; eventueel vaste oorsprong kiezen (B3) |
| Hand-tik onnauwkeurig | Vorm wijkt af | Hoekfoto + nakijken (B8), controlemaat (diagonaal) |
| AR-tracking kwijt | Beelden/hoeken verschoven | Geteld en zichtbaar per rondgang; aanvullen met uitlijnen |
| Publieke repo | Klantdata lekt | Alleen verzonnen proefdata; hooks; foto's van klanten nooit in de repo |
| Reviewer-toegang | Te veel inzicht in bedrijfsdata | Deel alleen dit document of een aparte map, **niet** `Applicaties/Claude` (bevat lokale repo met o.a. Moneybird- en klantbestanden) |

---

## 8. Open vragen

**Voor Bart**
1. Gordijnen: welke maten gebruik je nu echt (tabel P1 aanvullen/schrappen)? Rail op plafond of wand meestal?
2. Kameruitslag: A3 of A4, en wil je de wandfoto als lichte onderlaag?
3. Oorsprong: liever altijd de hoek bij de toegangsdeur of een gevelhoek?
4. Een oude Opname-beta (2-11, "Kantoor", 6 wanden, zonder maten) omzetten of opnieuw rondlopen? (Advies: opnieuw rondlopen.)

**Voor een reviewer (Astra)**
1. Klopt de keuze om het beeld (panorama) en het maatmodel strikt te scheiden, of mist er een koppeling die later nodig is voor CAD?
2. Is het datamodel (§3.1, `mt-ruimte-dossier.js`) compleet genoeg om in Vectorworks een kameruitslag te maken zonder foto-interpretatie?
   Wat ontbreekt (bijv. wanddikte, kozijndiepte, vaste oorsprong)?
3. Hoekcorrectie via foto: genoeg nauwkeurig met één foto per hoek, of zijn twee foto's vanuit verschillende posities (triangulatie) beter?
4. Kameruitslag (P2): welke bemaatregels zijn gebruikelijk voor gordijnen- en interieurwerk (maatketens vanaf hoek, hoogtes vanaf afgewerkte vloer)?
5. Is P2 (PDF uit de app) een goede tussenstap naar P3 (Vectorworks), of beter direct P3?
6. Ziet u risico's in de privacy (foto's van woningen) en de opslag op de telefoon?

---

## 9. Wijzigingslog

| Datum | Commit | Wat | Waarom |
|---|---|---|---|
| 17-11 | `ddbdd9e`…`1a8bace` | AR-proef, AR-check, plafondmodus, duimknop, panorama en kijker | eerste proef op de S24 |
| 18-11 | `6c26a39` | Reparatie uit het werkpakket; `mt-ruimte-dossier.js`; rondgang met contouren, details met foto en maat, pakket, kantoorkijker | werkpakket 18-11 |
| 18-11 | `9fb5f92` | Draadmodel centraal, vlakken via knop | B6, feedback proef |
| 18-11 | `97b5a6e` | Na heropenen opnieuw plakken | B16, tabblad per ongeluk dicht |
| 18-11 | `5ba09b4` | Hoekfoto, plafondfoto, knop Foto, hoeken nakijken | B8–B10, feedback |
| 18-11 | `ba0f17e` | Ontwikkeldocument | verzoek Bart |
| 18-11 | `ddeedbf` | Meetresultaat echte proef 20:27, voorstel P10 | proef Bart |
| 18-11 | `efae8d2` | ARCore-ankers, groothoekfoto per wand rechtgetrokken, melding Foto | B17–B19 |
| 18-11 | `19b578c` | Ankers alleen meeschrijven, hoek weghalen, spie-waarschuwing | B20, B21 |
| 18-11 | `66b01d8` | Tekenen volgt het anker, meting blijft de tik | B22 |
| 18-11 | `8556c20` | Review GPT verwerkt: referentie per meting, maatlijnen op de meting, modellengte | B23–B25 |
| 18-11 | `4ea9756` | Ankerposities bewaren en vergelijken, plafond uit plafondfoto | B27 |
| 18-11 | `33f5f0c` | Sneller opslaan, wegschrijven bij sluiten | B28 |
| 18-11 | `483a1fb` | Twee fases: plattegrond tikken, dan scannen | B29, P11 |
| 18-11 | `13e9dae` | Driehoeksmeting voor haaksheid i.p.v. diagonaal | B30 |
| 18-11 | `b8bdb4a` | Controlemaat tape tot tape tussen twee wanden | B31 |
| 18-11 | `62d3d14` | Meetresultaat 21:52 | proef Bart |
| 18-11 | (volgende) | Wandaanzicht met kozijn bematen | B32 |

Meer detail per brok: `VOORTGANG-OPNAME.md`. Volledige diff: draft-PR #5.

---

## 10. Bestanden, links en tests

**Code (branch `ccr-6aed2904-q3dzlo`, repo `mtbart/MT-Facturatie-tool`)**
- `docs/opname-ar-proef.html` — rondgang op de telefoon; rekenkern tussen `/*KERN-BEGIN*/` en `/*KERN-EINDE*/`
- `docs/opname-ar-kijk.html` — kantoorkijker
- `mt-ruimte-dossier.js` — dossier, lijnmodel, pakket
- `mt-opname-opslag.js`, `mt-opname-export.js` — bestaande opslag en zip (hergebruikt)
- `docs/OPNAME-RONDGANG-START.md` — startinstructie
- `VOORTGANG-OPNAME.md` — voortgang per brok

**Tests**
- `node test/opname-ar-proef.test.js` — rekenkern (74)
- `node test/ruimte-dossier.test.js` — dossier en pakket (60)
- `node test/ruimte-e2e.js <map>` — browser, nagebootste kamer (28); vereist `python3 -m http.server 8123` in de repo
- Opslagcontrole uit het werkpakket (5 scenario's); `node tools/check-sinks.js`, `node tools/check-verwijzingen.js`
- Vast proefpakket: `test/fixtures/ruimte-proefpakket.zip` (nagebootste kamer, geen echte beelden)

**Buiten de repo (SharePoint, lokaal)**: `OVERDRACHT-OPNAME-AR.md`, `OPNAME-AR-START-HIER.md`, `OPNAME-AR-REFERENTIE-LATER.md`,
`opname-ar-controle-vw-export.py`, `opname-ar-controle-opslag.cjs`, `opname-ar.patch`.
