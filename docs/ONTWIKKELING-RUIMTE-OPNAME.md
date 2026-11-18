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
11. [Tekenstandaarden: wat is gebruikelijk en wat doen wij](#11-tekenstandaarden-wat-is-gebruikelijk-en-wat-doen-wij)
12. [Denkstuk: objecten in de werktekening, leidingwerk, plinten en sierlijsten](#12-denkstuk-objecten-in-de-werktekening-leidingwerk-plinten-en-sierlijsten)

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

**B33 · 18-11 · Haaksheid van hoeken voorlopig niet; later meer aandacht.** Bart: "die haaksheid van de hoek etc komt later wel, voor nu is dat niet belangrijk".
De driehoeksmeting (B30) en de controlemaat tussen hoeken staan ingeklapt onder *Later* op het telefoonscherm; ze werken nog en blijven in het datamodel.
De controlemaat tape tot tape (B31) blijft gewoon zichtbaar. Opnieuw oppakken als de vorm van de kamer voor een project kritisch wordt (inbouwkast
wand-tot-wand, keuken).

**B34 · 18-11 · Kozijn = opening met opbouw, en een raam met vakken.** *Waarom:* Barts drie kozijnen in de proefkamer:
R1 aftimmering op de wand (12 mm panelen, 5 mm voor de muur, binnenwerks 2440 × 1084, 310 mm tot het kozijn; vakken draai naar buiten / vast / draai naar buiten),
R2 nis zonder aftimmering (535 × 1352, 115 mm tot het kozijn; vast), R3 nis met aftimmering erin links/rechts/boven (1218 × 1200, 120 mm tot de aftimmering,
dan 80 mm tot het kozijn; draai-kiep naar binnen). Positie: vanaf de hoek tot de buitenkant van aftimmering of nis, onderkant tot de vloer, bovenkant tot het
plafond (afgeleid of gemeten).
*Datamodel:* `det.opening = { type: 'aftimmering-op-wand' | 'nis' | 'nis-met-aftimmering', zijden: [...] }`, `det.raam = { vakken: [{ functie }] }` (functies in
`D.RAAM_FUNCTIES`), maten als metingen: `opening_breedte`, `opening_hoogte` (binnenwerks aftimmering of nismaat), `aftimmer_dikte`, `aftimmer_uitsteek`,
`nis_diepte_tot_aftimmering`, `diepte_tot_kozijn` (betekenis per soort: vanaf voorkant aftimmering, wandvlak of aftimmering; staat bij elke meting in
`betekenis`). `D.kozijnVelden` bepaalt per soort wat verplicht en optioneel is; `D.kozijnLabel` de namen. Buitenmaat op de wand = binnenwerks + paneeldikte aan
de zijden met een kader (afgeleid; 12 mm aangenomen = geschat zolang de dikte niet gemeten is). Restmaten tellen een afgeleid deel als hard mee.
*Scherm:* soort opening kiezen, zijden aanvinken, maten met de juiste namen, vakken van links naar rechts, dieptelijn (wand → aftimmering → kozijn) en in de
tekening de binnenmaat (stippel) en de vakken. Kijker: opening en vakken in het detailpaneel.
*Open vraag aan Bart:* is de 310 mm bij R1 gemeten vanaf de voorkant van de aftimmering (zo nu vastgelegd: 305 mm in de muur) of vanaf de muur?

**B35 · 18-11 · Eén tekenmodule voor telefoon, kantoor en PDF (`mt-ruimte-tekening.js`).** *Waarom:* de wandtekening stond alleen in de telefoonpagina;
kantoor had geen tekening en een PDF bestond niet. Nu maakt één module het wandaanzicht, de doorsnede van een opening, de kameruitslag en de
wandafwikkeling. De kantoorpagina heeft een knop **Tekeningen**: kameruitslag, wandafwikkeling, een pagina per wand met onderdelenlijst en kozijnenlijst,
en **Afdrukken / PDF** (liggend A4). Het lijnmodel komt uit het pakket; op kantoor is geen rekenkern van de telefoon nodig (`D.wandAanzicht` accepteert
een kant-en-klaar lijnmodel; links/rechts volgt uit de draairichting van het lijnmodel, getoetst tegen de AR-kern).
*Veiligheid:* de module levert een boom van gewone objecten; de pagina maakt daar SVG-elementen van (geen HTML als tekst). Een naam of opmerking uit het
dossier kan dus nooit als opmaak worden gelezen. De controle `tools/check-sinks.js` keurde de eerste opzet (tekst aan elkaar plakken) terecht af.
*Uitslag:* elke wand klapt om zijn vloerlijn naar buiten, zonder spiegelen (getest: determinant +1); tekst die op zijn kop zou staan wordt rechtgezet.

**B36 · 18-11 · De tekening is de invoer: tik de maat aan.** *Aanleiding:* Barts pakket "Test 10" en zijn oordeel "dit werkt echt nog super omslachtig; op
jouw screenshots staat het veel duidelijker". In het pakket: één kozijn kostte elf velden en ruim twee minuten, de soort opening was verkeerd gekozen
(nis met aftimmering in plaats van aftimmering op de wand), de 5 mm uitsteek kwam in het verkeerde veld en de buitenmaat 2464 was met de hand uitgerekend.
*Wat is veranderd:*
- De tekening staat bovenaan vast in beeld. Een maat van het gekozen onderdeel is een tikbaar vlakje; een oranje **?** betekent: nog meten.
- Eén invoerbalk onder de tekening. Getal + Enter bewaart en springt naar de volgende open maat: met de X4 meet je een heel kozijn zonder één veld aan te tikken.
- De soort opening kies je met drie plaatjes (van boven gezien): kale nis, kader op de wand, kader in de nis. De dieptematen tik je in de doorsnede aan.
- De buitenmaat van het kozijn wordt niet meer gevraagd: die volgt uit binnenwerks + paneeldikte. De keten laat de panelen als eigen stukje zien
  (334 – 12 – 2440 – 12 – rest), zodat de gemeten binnenmaat in de keten staat en de keten toch sluit.
- Onder de tekening: de maten als knoppen (oranje = open), opmerking, naam, foto, weghalen (twee keer tikken; het onderdeel blijft in het archief).
- Elk soort onderdeel is toe te voegen; vensterbank, plint en sierlijst met begin en eind; knik als verticale lijn; balk tot het plafond.
- In het dossier staat de kamer opengeklapt: tik een wand aan om hem te bematen; in het wandscherm ga je met ‹ › naar de vorige of volgende wand.
- Lange wanden worden breder getekend dan het scherm (opzij schuiven), zodat de maten leesbaar blijven; het gekozen onderdeel komt vanzelf in beeld.
*Niet getest op een echt toestel:* of de invoerbalk met het schermtoetsenbord open altijd in beeld blijft, en of de tikvlakjes groot genoeg zijn.

**B37 · 18-11 · Objecten automatisch in de werktekening, met varianten; symbolen naar de gangbare normen.** *Aanleiding:* Bart: "in de tweede fase per detail
een soort automatisch object in je werktekening invoegen; daarna in de wandtekening het object aanklikken, veranderen van enkel/dubbel/drievoudig en bematen."
- **Snelkeuze in fase 2:** de knop Detail maakt de foto en vraagt alleen "Wat is dit?" (grote knoppen). Eén tik en het onderdeel staat op de plek van het
  kruisje in de werktekening van die wand, als schatting (grijs, ~). Bematen doe je daarna in het wandscherm. "Nu meteen bematen" kan nog steeds.
- **Varianten** (`det.variant`, `D.VARIANTEN`): stopcontact enkel/dubbel/drievoudig/viervoudig/dubbel staand/krachtstroom/data; schakelaar; radiator;
  deur (draairichting en scharnierkant, schuifdeur, open doorgang); leiding (cv, water, gas, afvoer, elektra). Wisselen verandert geen meting; de wijziging
  staat in het archief.
- **Op schaal:** een stopcontact of schakelaar staat als afdekplaat op schaal in het aanzicht (enkel 81 × 81 mm, elk extra vak + 71 mm), met het hart als maatpunt.
- **Draairichting:** driehoek in raam of deur; de punt wijst naar de scharnierkant, getrokken = draait de kamer in, gestreept = naar buiten. Per vak is de
  scharnierkant te kiezen. De afspraak staat in de legenda van elke tekening (zie §11: hij verschilt per land).
- **Camera-plek:** bij een vlak onderdeel (kozijn, radiator) is de camera-schatting het midden van het onderdeel, niet de zijkant.
- **Kamers met meer vormen:** bij een inspringende hoek (L-vorm, nis) vallen opengeklapte wanden over elkaar. Dan toont pagina 1 alleen de plattegrond met
  wandlengtes; de **wandafwikkeling** (alle wanden naast elkaar, met de klok mee) werkt voor elke vorm en staat er altijd bij.
- De voorbeeldkamer voor tests en de voorbeeld-PDF staat op Barts echte maten: R1 334 vanaf links en R2 40 vanaf rechts op W2 (H2–H3), R3 780 vanaf rechts
  op W3 (H3–H4), onderkanten 945 / 750 / 930.

**B38 · 19-11 · Rustiger op de telefoon, scharnierblokjes, tekens op schaal, PDF vanaf de telefoon.** *Aanleiding:* Bart: "de mobiele versie gaat wat door
elkaar lopen; misschien de maten per onderdeel pas actief maken als je dat object aanklikt", "de draairichting van R1 moet andersom, de scharnieren zitten
aan de buitenkant", "ook (standaard) voor stopcontacten, waterleidingen etc." en "kan je direct vanuit de opnametool een pdf downloaden?".
- **Telefoon:** zonder gekozen onderdeel staan alleen de wandlengte en de hoogte in de tekening. Tik je een onderdeel aan, dan worden zijn maten actief en
  treden de andere onderdelen terug (lichter getekend). De doorlopende ketens staan alleen op de afdruk.
- **Draairichting:** in de voorbeeldtekening stonden de scharnieren van R1 al aan de buitenkant (de punt van de driehoek wijst naar het scharnier), maar die
  afspraak is blijkbaar niet vanzelfsprekend: Bart las hem andersom. Daarom staan er nu ook twee zwarte **scharnierblokjes** op de scharnierkant van elk
  draaiend vak en van een deur. Dat is zonder legenda te lezen. De driehoek blijft (punt naar het scharnier, zoals in het grootste deel van Europa).
  *Open:* gebruikt MT zelf de omgekeerde afspraak (punt naar de kruk)? Dan kan de driehoek met één instelling worden omgedraaid; de blokjes blijven kloppen.
- **Stopcontacten en schakelaars:** op de afdekplaat (op schaal) staat nu wat je ziet: per contact een rondje met twee gaatjes, per schakelaar een wip,
  een dimmer of thermostaat als rondje, data als rechthoekje. **Leidingen:** de doorsnede op schaal (buitendiameter) in de kleur van het medium, met de
  code KW (koud water), WW (warm water), CV, GAS, AFV (afvoer) of E (elektra) en de diameter in de naam.
  De officiële schemasymbolen (NEN 5152 voor elektra) horen op een plattegrond en zijn niet nagelezen; in een aanzicht tekenen we wat er hangt.
- **PDF vanaf de telefoon:** knop **Tekeningen / PDF** in het dossier op de telefoon. Zelfde pagina's als op kantoor (`TK.rapport`, één bron). Afdrukken →
  "Opslaan als pdf". Een download met één tik, zonder afdrukvenster, vraagt een pdf-bibliotheek in de app; dat is een bewuste vervolgstap (zie P2).

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
| 18-11 23:00 | "Haaksheid van de hoek etc komt later wel; nu niet belangrijk, op een later punt wel." | B33. |
| 18-11 23:10 | Foto's en maten van drie kozijnen (R1 aftimmering op de wand, R2 nis, R3 nis met aftimmering; draairichtingen). | B34. |
| 18-11 23:40 | "Kan ik op dat wandaanzicht een object invoegen (radiator, raam, stopcontact) en dat een maat geven en bematen, plus een opmerking? Ga door tot dit een werkend concept is." | B35, B36. |
| 19-11 00:20 | Pakket "Test 10" + "dit werkt echt nog super omslachtig; op jouw screenshots staat het veel duidelijker". | B36 (analyse van het pakket in de beslissing). |
| 19-11 01:00 | Echte plek van de kozijnen (R1 334 vanaf links en R2 40 vanaf rechts op wand H2–H3, onderkant R2 750; R3 op wand H3–H4, 780 vanaf rechts, onderkant 930; deur en R3 stonden op de verkeerde wand). "Zo helder moet de bemating eruitzien." Objecten automatisch invoegen in fase 2, daarna aanklikken en variant kiezen. Goede manier bedenken voor leidingwerk, plinten en sierlijsten. Industriestandaard voor symbolen en maatvoering? Uitslag wordt ingewikkelder bij meer vormen. | B37, §11, §12. Aanname: R3 op W3 en de deur op de wand waar R3 stond (W4); corrigeer als dat anders is. |
| 19-11 02:00 | Standaardtekens ook voor stopcontacten en waterleidingen; draairichting R1 andersom (scharnieren buiten); de mobiele versie loopt door elkaar: maten pas actief bij aanklikken; PDF direct vanuit de opnametool? | B38. |
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

*Stand 19-11:* het kozijn met opbouw, vakken, draairichting en doorsnede is gebouwd (B34, B36, B37). Nog niet: gordijn-specifieke maten (rail, overlap, stapelruimte).
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

*Stand 19-11:* als concept gebouwd (B35, B37, B38): knop Tekeningen op kantoor én op de telefoon, kameruitslag, wandafwikkeling, wandpagina's, Afdrukken / PDF. Nog niet: schaal 1:20/1:50 met schaalstok, onderhoek, A3, en een pdf-download met één tik (vraagt een pdf-bibliotheek zoals jsPDF met svg2pdf in `vendor/`; afweging: ± 400 kB extra tegenover één tik minder).
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
5. R1: is de 310 mm gemeten vanaf de voorkant van de aftimmering (zo vastgelegd) of vanaf de muur?
6. Staat R3 op W3 (H3–H4) en de deur op W4 (H4–H1)? Zo staat het nu in de voorbeeldkamer.
7. Vensterbank: als eigenschap van het kozijn (voorstel §12.3) of los blijven?
8. Leidingen: is een "vrij te houden zone" (rechthoek + uitsteek) meestal genoeg, of wil je het tracé zien (§12.2)?

**Voor een reviewer (Astra)**
1. Klopt de keuze om het beeld (panorama) en het maatmodel strikt te scheiden, of mist er een koppeling die later nodig is voor CAD?
2. Is het datamodel (§3.1, `mt-ruimte-dossier.js`) compleet genoeg om in Vectorworks een kameruitslag te maken zonder foto-interpretatie?
   Wat ontbreekt (bijv. wanddikte, kozijndiepte, vaste oorsprong)?
3. Hoekcorrectie via foto: genoeg nauwkeurig met één foto per hoek, of zijn twee foto's vanuit verschillende posities (triangulatie) beter?
4. Kameruitslag (P2): welke bemaatregels zijn gebruikelijk voor gordijnen- en interieurwerk (maatketens vanaf hoek, hoogtes vanaf afgewerkte vloer)?
5. Is P2 (PDF uit de app) een goede tussenstap naar P3 (Vectorworks), of beter direct P3?
6. Ziet u risico's in de privacy (foto's van woningen) en de opslag op de telefoon?
7. §12: welke aanpak voor leidingwerk, plinten en sierlijsten is in de praktijk het snelst zonder maatfouten? Mist er een categorie?
8. §11: kent u de precieze tekst van NEN-EN-ISO 7519 (draairichting ramen en deuren in aanzicht) en NEN 5152 (stopcontact/schakelaar)? Klopt onze keuze?
9. Is de wandafwikkeling de juiste standaardweergave voor kamers met inspringende hoeken, of werkt u liever met losse aanzichten met aanzichtmarkeringen op de plattegrond (zoals de interior elevation viewports van Vectorworks)?

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
| 18-11 | `4809f62` | Wandaanzicht met kozijn bematen | B32 |
| 18-11 | `f5e9e8c` | Haaksheid ingeklapt onder Later | B33 |
| 18-11 | `d6a0124` | Kozijn als opening met opbouw en vakken | B34 |
| 19-11 | `b4e2c6b` | Tekenmodule, tekening als invoer, snelkeuze en varianten, kameruitslag/wandafwikkeling/PDF op kantoor, tekenstandaarden, denkstuk §12 | B35–B37 |
| 19-11 | (deze commit) | Maten alleen bij het gekozen onderdeel, scharnierblokjes, tekens op afdekplaat en leiding, Tekeningen / PDF op de telefoon | B38 |

Meer detail per brok: `VOORTGANG-OPNAME.md`. Volledige diff: draft-PR #5.

---

## 10. Bestanden, links en tests

**Code (branch `ccr-6aed2904-q3dzlo`, repo `mtbart/MT-Facturatie-tool`)**
- `docs/opname-ar-proef.html` — rondgang op de telefoon; rekenkern tussen `/*KERN-BEGIN*/` en `/*KERN-EINDE*/`
- `docs/opname-ar-kijk.html` — kantoorkijker
- `mt-ruimte-dossier.js` — dossier, lijnmodel, wandaanzicht, maatketens, pakket
- `mt-ruimte-tekening.js` — wandaanzicht, doorsnede, kameruitslag, wandafwikkeling (telefoon, kantoor en PDF)
- `mt-opname-opslag.js`, `mt-opname-export.js` — bestaande opslag en zip (hergebruikt)
- `docs/OPNAME-RONDGANG-START.md` — startinstructie
- `VOORTGANG-OPNAME.md` — voortgang per brok

**Tests**
- `node test/opname-ar-proef.test.js` — rekenkern (77)
- `node test/ruimte-dossier.test.js` — dossier en pakket (105)
- `node test/ruimte-tekening.test.js` — tekenmodule met de voorbeeldkamer `test/ruimte-voorbeeldkamer.js` (25)
- `node test/ruimte-e2e.js <map>` — browser, nagebootste kamer (59); vereist `python3 -m http.server 8123` in de repo
- Opslagcontrole uit het werkpakket (5 scenario's); `node tools/check-sinks.js`, `node tools/check-verwijzingen.js`
- Vast proefpakket: `test/fixtures/ruimte-proefpakket.zip` (nagebootste kamer, geen echte beelden)

**Buiten de repo (SharePoint, lokaal)**: `OVERDRACHT-OPNAME-AR.md`, `OPNAME-AR-START-HIER.md`, `OPNAME-AR-REFERENTIE-LATER.md`,
`opname-ar-controle-vw-export.py`, `opname-ar-controle-opslag.cjs`, `opname-ar.patch`.

---

## 11. Tekenstandaarden: wat is gebruikelijk en wat doen wij

Bart vroeg of de aanzichten en de uitslag met een industriestandaard kunnen werken voor symbolen en maatvoering. Opgezocht op 19-11-2026. **Let op:** de
normteksten zelf zijn betaald en niet geraadpleegd; hieronder staat wat uit openbare bronnen blijkt en wat gangbare praktijk is. Wat niet bevestigd is, staat erbij.

| Onderwerp | Norm / praktijk | Wat wij doen | Zekerheid |
|---|---|---|---|
| Algemene weergave bouwtekeningen (lijndiktes, vereenvoudigde ramen en deuren) | NEN-EN-ISO 7519 (editie 2024 vervangt 1996) | Zichtbare contouren dik, maat- en hulplijnen dun, onderdelen vereenvoudigd als rechthoek met draairichting | Norm bestaat en gaat hierover; details niet nagelezen |
| Maatvoering | NEN-ISO 129-1 (2018/2019), bouwkundige toleranties ISO 6284 | Maatlijn met schuine streepjes, maatgetal boven de lijn, staande maten leesbaar van rechts, kettingmaten die sluiten op de totaalmaat, alles in mm | Gangbare bouwkundige praktijk; normtekst niet nagelezen |
| Draairichting raam/deur in aanzicht | Driehoek met de punt naar de scharnierkant; getrokken = naar de kijker toe, gestreept = van de kijker af | Zo getekend, gezien vanuit de kamer; **altijd met legenda** | De punt-naar-scharnier-afspraak geldt in het grootste deel van Europa en de VS, maar is in o.a. het VK en Australië omgekeerd; getrokken/gestreept wordt niet overal gelijk gebruikt. Bronnen raden daarom een legenda aan |
| Elektra-symbolen | NEN 5152 (elektrotechnische symbolen voor installatietekeningen, afgeleid van IEC 60617) | **Niet** de schemasymbolen, maar de afdekplaat op schaal met het hart als maatpunt en de uitvoering in tekst (1×, 2×, 3×) | Bewuste keuze: voor een meubelmaker telt waar de plaat zit en hoe groot hij is. De precieze NEN 5152-tekens zijn niet gevonden; als ze gewenst zijn, kunnen ze in de plaat getekend worden |
| Binnenaanzichten van een kamer | Per wand een aanzicht, met aanzichtmarkeringen op de plattegrond (Vectorworks: *interior elevation viewports*; ArchiCAD: *interior elevations*). Voor interieurwerk ook de afwikkeling: alle wanden naast elkaar | Per wand een pagina (W1…), de wandnaam staat in de plattegrond; kameruitslag bij eenvoudige kamers; wandafwikkeling altijd | Gangbare praktijk in CAD-pakketten |
| "Europese projectie" | Eerste-hoekprojectie (ISO 5456-2 / ISO 128): aanzichten liggen om het hoofdaanzicht heen | De kameruitslag volgt dat idee voor een kamer van binnenuit: elke wand klapt om zijn vloerlijn naar buiten | Onze uitslag is een afgeleide vorm, geen genormeerde projectie |

**Nog niet gedaan (voorstel):** schaal op de tekening (1:20 wand, 1:50 uitslag) met schaalstok; een onderhoek met project, ruimte, datum, opnemer en
versie (NEN 2574 / ISO 7200); peilmaten ten opzichte van de afgewerkte vloer (P = 0) als alternatief voor hoogteketens; hartlijnen (streep-punt) bij
stopcontacten en leidingen; lijndiktes volgens de norm.

**Voor Vectorworks (P3):** dezelfde gegevens kunnen daar als interior elevation viewports met de eigen maatvoeringsstandaard van het bureau worden getekend.
Onze PDF is dan de snelle werktekening uit de opname; de presentatietekening komt uit Vectorworks.

Bronnen: [EN ISO 7519:2024](https://genorma.com/en/standards/en-iso-7519-2024) · [EN ISO 129-1:2019](https://genorma.com/en/standards/en-iso-129-1-2019) ·
[draairichting-symbolen op aanzichten](https://cadblockdwg.com/blog/window-opening-symbols-on-elevations) ·
[verschil per land, VisualARQ-forum](https://discourse.mcneel.com/t/opening-elevation-styles/178200) ·
[NEN 5152](https://wiert.me/2025/06/24/nen-5152-wikipedia-technische-tekeningen-elektrotechnische-symbolen/) ·
[Vectorworks interior elevation viewports](https://app-help.vectorworks.net/2024/eng/VW2024_Guide/Viewports1/Creating_interior_elevation_viewports.htm) ·
[wandaanzichten in interieurprojecten](https://planoplan.com/en/blog/instructions/wall-elevations-in-interior-design-projects/)

---

## 12. Denkstuk: objecten in de werktekening, leidingwerk, plinten en sierlijsten

Doel: alles wat een maatwerkmeubel in de weg kan zitten of waar het op moet aansluiten, staat na één rondgang op de goede plek in de werktekening, en
het bematen kost zo min mogelijk handelingen. Dit hoofdstuk is bedoeld om op te reageren (Bart, Astra).

### 12.1 Vier soorten dingen, elk met een eigen manier van vastleggen

| Vorm | Voorbeelden | Vastleggen in fase 2 | Bematen in de wandtekening | Stand |
|---|---|---|---|---|
| **Punt** | stopcontact, schakelaar, thermostaat, doorvoer van een leiding | kruisje erop, Detail, één tik op de soort | hart vanaf de hoek + hoogte hart; uitvoering kiezen | gebouwd (B37) |
| **Vlak** | kozijn, deur, radiator, nis, ventilatierooster, meterkast | kruisje op het midden, Detail, soort | vanaf hoek, breedte, hoogte, onderkant (+ opbouw bij een kozijn) | gebouwd (B34–B37) |
| **Lijn langs de wand** | plint, sierlijst, plafondlijst, vensterbank, leiding langs de wand, koof | zie 12.2 en 12.3 | begin, eind, hoogte, uitsteek | deels: begin/eind per wand werkt, maar is omslachtig |
| **Vorm van de wand zelf** | knik, kolom, balk, schuin dak, verlaagd plafond | knik/kolom/balk als onderdeel | afstand, breedte, diepte | knik/kolom/balk gebouwd; schuin dak nog niet |

### 12.2 Leidingwerk: drie opties

Een leiding is geen punt maar een route, en voor een meubel telt vooral: **waar moet ik vrij blijven en hoeveel**.

1. **Vrij te houden zone (aanbevolen als standaard).** Een rechthoek op de wand (vanaf hoek, breedte, onderkant, hoogte) met één dieptemaat: de grootste
   uitsteek inclusief beugels en isolatie. In de tekening een gearceerd vlak met "vrij 45". Snel (zelfde invoer als een radiator), en precies wat de
   werkplaats nodig heeft om een uitsparing of een terugliggende rug te tekenen. Nadeel: je ziet niet hoe de leiding loopt.
2. **Tracé met knikpunten.** In de rondgang tik je begin, elke bocht en het eind van de leiding aan (zoals de hoeken van de kamer). In de wandtekening een
   lijn op het hart, met maten naar het hart bij begin, bocht en eind, plus diameter en uitsteek. Goed voor zichtbaar leidingwerk dat je wilt omkasten.
   Nadeel: meer tikken, en de camera-plek van elk punt is een schatting die je moet nameten.
3. **Doorvoerpunt (bestaat nu).** Alleen waar de leiding uit vloer, wand of plafond komt: hart, hoogte, diameter, uitsteek. Goed voor een cv-leiding
   onder een radiator. Onvoldoende voor een leiding die een meter langs de wand loopt.

Voorstel: 1 en 3 naast elkaar aanbieden ("Leiding: punt" en "Leiding: zone"), 2 pas bouwen als een echte klus erom vraagt. Altijd een foto erbij.

### 12.3 Plinten, sierlijsten, plafondlijsten en vensterbanken

Het probleem met de huidige aanpak (per wand begin en eind invullen): een plint loopt bijna altijd de hele kamer rond en stopt bij deuren. Dat per wand
invoeren is dubbel werk en levert niets op.

- **Plint, sierlijst en plafondlijst als eigenschap van de kamer.** Eén keer vastleggen: hoogte, dikte (uitsteek uit de wand), een foto van het profiel
  en eventueel de afwerking. Standaard loopt hij over alle wanden; de app onderbreekt hem zelf bij deuren en bij nissen tot de vloer. Per wand kun je hem
  uitzetten of een stuk uitzonderen (bijvoorbeeld achter een bestaande kast). In elk wandaanzicht wordt hij dan vanzelf getekend.
  Wat de werkplaats nodig heeft: hoogte en dikte (kast over de plint heen, plint weghalen of uitsparen), en bij een plafondlijst de hoogte en uitsteek
  (kast tot het plafond: lijst doorzetten of onderbreken).
- **Het profiel zelf.** Voor het doorzetten van een bestaande sierlijst is de vorm nodig. Drie manieren: (a) foto recht van opzij met een maatlat erin,
  (b) een profielkam (contourmal) fotograferen op ruitjespapier, (c) kiezen uit een lijst standaardprofielen. Voorstel: (a) nu, (c) later.
- **Vensterbank als deel van het kozijn.** Bart beschrijft de onderkant van R2 en R3 als "bovenkant vensterbank": de vensterbank hoort bij het kozijn.
  Voorstel: bij het kozijn een vinkje "vensterbank" met dikte, uitsteek uit de wand en overstek links en rechts; de bovenkant is de onderkant van de
  opening. Dat scheelt een los onderdeel met vijf maten. De losse vensterbank blijft bestaan voor een doorlopend blad onder meerdere ramen.

### 12.4 Automatisch object in de werktekening: hoe ver kan dat gaan

- **Nu (B37):** jij wijst aan en kiest de soort; de plek komt van de camera (schatting), de maat van jou.
- **Stap 2, herkennen op de foto (AI):** de detailfoto gaat naar een beeldmodel dat de soort en uitvoering voorstelt ("dubbel stopcontact", "paneelradiator
  type 22") en bij een stopcontact of radiator ook de omtrek. Jij bevestigt met één tik. De maat blijft van de X4 of de duimstok; een camera-maat blijft grijs.
  Aandachtspunt: foto's van een woning naar een dienst sturen vraagt een bewuste keuze (privacy) en werkt niet zonder internet.
- **Stap 3, afmeting uit de foto:** met de bekende plek van de wand en de camerastand is uit de detailfoto een breedte en hoogte te schatten (zoals de
  hoekcorrectie nu werkt). Bruikbaar als controle op een getypte maat (waarschuwen bij een verschil > 5 %), niet als maat.
- **Wat de telefoon zelf al kan:** ARCore herkent vlakken, geen stopcontacten. Een iPhone met LiDAR (RoomPlan) herkent wel ramen, deuren en openingen
  met een grove maat; dat vraagt een eigen iOS-app (P8).

### 12.5 Wat nog ontbreekt voor een maatwerkkast

- **Schuin dak en verlaagd plafond:** een wand die niet rechthoekig is (kniehoogte, dakhelling, koof). Het aanzicht moet een veelhoek kunnen zijn.
- **Vloer en plafond:** hoogteverschil in de vloer (waterpas), plafond dat afloopt, spots, rookmelder, verdeler van de vloerverwarming. Voorstel: een
  plafond- en een vlooraanzicht met dezelfde invoer.
- **Wand niet vlak of niet te lood:** bol/hol en uit het lood per wand (drie hoogtes meten), belangrijk voor een kast die strak tegen de wand moet.
- **Diepte in de kamer:** hoe ver steekt de radiator of vensterbank uit; staat nu als "uitsteek" bij het onderdeel, maar is niet te zien in een tekening.
  Voorstel: een bovenaanzicht per wand (strook van 300 mm) met de uitsteek van elk onderdeel.

### 12.6 Vragen om over mee te denken

1. Leidingen: is de vrij te houden zone in de praktijk genoeg, of leidt dat tot te ruime uitsparingen?
2. Plint/lijst als kamereigenschap: zijn er situaties waarin dat fout gaat (verschillende plinten per wand, plint die om een schouw loopt)?
3. Welke uitvoeringen ontbreken in de lijsten (§B37)? Bijvoorbeeld opbouw tegenover inbouw bij stopcontacten: opbouw steekt uit en heeft een andere maat.
4. Is "hart" altijd het juiste maatpunt voor een stopcontact, of wil de werkplaats de zijkanten van de plaat?
5. Hoe leg je het snelst vast wat achter een toekomstige kast bereikbaar moet blijven (stopcontact, afsluiter, luik)?
6. Volgorde: eerst alle objecten aanwijzen en dan per wand bematen (nu), of per wand afmaken? Wat geeft de minste fouten?
