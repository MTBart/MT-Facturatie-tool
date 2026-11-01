# VOORTGANG opname-module

Branch `opname` (vanaf main v2.31.0), worktree `C:\Users\BartWitte\mt-worktrees\opname`. Niet gepusht, niet gemerged, geen release.

## Brok 1: rekenkern en datamodel (1-11-2026)

**Gedaan (eerste oplevering, commit 6fb1566)**
- `mt-opname-kern.js`: pure functies, globaal `MTOpnameKern` en `module.exports`, zelfde patroon als `mt-forecast-light.js`.
- `test/opname-kern.test.js`, `docs/opname-json-v0.3.md` (datamodel met voorbeeld van kamer Joe, fictieve projectcode TEST-001).

**Gedaan (aanvulling 1-11 na Bart en ChatGPT-review 035)**
- **Route** (`K.route`, `routeVanOpname`, `volgendeOpen`, `vorige`, `stap`): geordende stappen met `nr`, "stap x van y", "wand n van m", groep, label, definitie, referentie. Standaard `fotos-dan-rondloop` (fotoronde vanaf de toegangsdeur, rondloop vanaf de eerste werkzone-wand met de klok mee, dan plafond en diagonalen, dan rondje); alternatieven `rondloop` en `per-soort`. Later en n.v.t. houden de route niet op.
- **A** Vorm uit 4 zijden + 1 diagonaal (twee driehoeken), tweede diagonaal als controle (10 mm). Geen gemiddelden, geen "haaks" uit gelijke diagonalen. `afwijkend` is informatie, alleen `inconsistent` is een conflict. Zonder diagonaal: onvoldoende bepaald (schematisch).
- **C** Rondje op later = open taak en blokkeert (de schakelaar `RONDJE_LATER_BLOKKEERT` is weg: het is nu altijd zo).
- **D** Een ingevulde optionele maat telt mee (een conflict op diagonaal B blokkeert; een optionele maat op later blokkeert ook).
- **E** `inhoudsHash`, `isVrijgaveGeldig`, `effectieveStatus`, `vrijgeven`, `slaOp`: elke inhoudelijke wijziging maakt een vrijgave ongeldig.
- **F** De vrijgave-uitkomst bevat `scope`, `uitzonderingen` en `volledig_gemeten`.
- **H** Voorstel: `schatting_mm` en apart `onzekerheid_mm` (optioneel). Oude velden `waarde`/`pm` worden bij het lezen aangevuld.
- **I** Alleen `kast` is een echte set; keuken en badmeubel zijn een hook (`K.MEUBELSETS`) en blokkeren het vrijgeven.
- Openingen buiten de werkzone: alleen breedte en positie verplicht, hoogte en borstwering optioneel (grijs). Radiator: buitencontour inclusief kraan en leiding, uitsteek en bereikbaarheid. Per wand buiten de werkzone één bevestiging (bekeken / afgedekt / niet beoordeeld).

**Brok 1c (antwoorden van de regie, 1-11):** de constante `K.RONDJE_LATER_BLOKKEERT` staat er weer (standaard aan); een ontbrekende definitie bij een opening IN de werkzone blokkeert (reden `definitie`), daarbuiten blijft het een waarschuwing; een werkzone-wand vraagt de wandlengte ook net boven de plint en net onder het plafond (`lengte_onder`, `lengte_boven`) en het plafond op 3 punten (`plafond_links`, `plafond_midden`, `plafond_rechts`). De basis houdt één plafondpunt en de lengte op 1000 mm is de middelste van de drie hoogtes.

**Uitkomst Joe, werkzone Oost (was 21 en 16):** basis **17**, werkzone **25**, optioneel **6**, extra 0.
Basis: 4 wandlengtes + plafond + diagonaal A (6) + breedte en positie van 4 openingen (8) + bevestiging van de wanden N, Z en W (3). Werkzone: lengte onder en boven (2) + plafond links, midden en rechts (3) + R3 hoogte, borstwering en tot rechterhoek (3) + SC1 3 + SC2 3 + RAD2 5 + VB3 3 + PLO 3. Optioneel: diagonaal B + hoogte en borstwering van R1 en R2 + hoogte van D1. Route: 58 stappen, waarvan 52 vereist.

**Keuzes die ik zelf maakte (ter bevestiging)**
1. **Rondje op "later" blokkeert het vrijgeven** (nu vastgelegd door Bart/ChatGPT punt C).
2. **Extra punten tellen mee voor het vrijgeven**, zoals in het prototype.
3. **Een ontbrekende definitie** blokkeert in de werkzone en is daarbuiten een waarschuwing (besluit regie).
4. **Een ontbrekende foto van een werkzone-wand blokkeert** (reden `foto`), van de andere wanden is het een waarschuwing (`foto-ontbreekt`). Foto's tellen niet mee in de inhoudshash: een foto verwijderen maakt een vrijgave dus niet ongeldig.
5. **Een optionele maat op later blokkeert** (het is een bewust uitgestelde taak). Optioneel en leeg mag.
6. **De wandbevestiging telt mee in de basis** (x van n) en moet gekozen zijn voor het vrijgeven. "Afgedekt" en "niet beoordeeld" mogen, maar staan in de uitzonderingen.
7. **Rondje afwijkingen = de stap "bijzonderheden op deze wand?"**: dezelfde keuze, de route vraagt hem niet twee keer. Het rondje blijft zes categorieën per wand.
8. **Vorm "afwijkend":** een hoek meer dan 0,3 graad van 90 of tegenoverliggende wanden meer dan 5 mm verschil. Informatie, nooit een blokkade. Een vorm die niet met de tweede diagonaal is gecontroleerd staat als uitzondering bij de vrijgave. Dit gaat uit van een bolle vierhoek (geen L-vorm).
9. **Hash:** niet cryptografisch (cyrb53), bedoeld om een wijziging te zien. Foto's, tijdstippen, historie en grijze voorstellen tellen niet mee; notities en bronnen wel.
10. **Een conflict wijst alle betrokken maten aan** (4 wanden + diagonalen): de kern kan niet weten welke maat fout is.
11. **Route-nummering telt optionele stappen mee**; `volgendeOpen` slaat ze over en `samenvatting.nog_relevant` telt alleen de vereiste open stappen.
12. **Velden erbij:** `ruimte.toegangsdeur` (id van een opening; anders de eerste deur, anders noord) en `positie_x` (optioneel, voor links naar rechts vóór er gemeten is). Zonder die getallen blijft de invoervolgorde staan.
13. Overig uit de eerste oplevering: positie vanaf de linkerhoek (kijkend naar de wand), `positie_rechts` in de werkzone, `compleet` naast `beantwoord`, een foto-voorstel is nooit een meting, historie is append-only, v0.2 blijft onder `_oud`.

**Bewust niet gedaan**
- Geen UI, geen wijziging in `mobiel.html`, `v2.html`, `sw.js`, `worker.js`; de module wordt nergens geladen.
- Geen opslag, geen echte taken, geen DISTO-koppeling, geen foto-voorstellen berekenen.
- Geen keuken- of badmeubelvragen (alleen de hook). Geen plattegrondoplossing over de rondgang (OPTIES C1), geen "opening past in wand" (C5), geen plafondspreiding (C8).
- Alleen vier wanden N/O/Z/W en een bolle vierhoek. Geen Codex-ronde (één bundelronde aan het eind).

**Open vragen**
- Plafond op 3 punten langs een werkzone-wand: links en rechts zijn een stukje uit de hoek; moet er een vaste afstand in mm bij (bijvoorbeeld 300 mm)?
- Moeten de drie wandlengtes onderling vergeleken worden (een kast tegen een wand die onderaan 15 mm korter is)? Nu alleen vastgelegd, geen controle.
- Mag een vrijgegeven opname weer open, en wie? De kern kent nu alleen `status` en de hash.
- Moet de bereikbaarheid van een radiator buiten de werkzone ook gevraagd worden? Nu alleen "gezien".

## Regie (Claude Opus, 1-11-2026) — mee naar de volgende brok
- **Foto in de inhoudshash:** een werkzone-foto blokkeert vrijgave, dus het verwijderen van zo'n foto moet een vrijgave ook ongeldig maken. Neem de foto-verwijzingen van werkzone-wanden mee in de hash (niet de beelden zelf).
- **Plafond links/rechts:** vaste afstand van 300 mm uit de hoek, in de vraagtekst.
- **Drie wandlengtes:** onderling vergelijken. Een verschil groter dan 5 mm geeft een melding "wand niet te lood/scheef" (informatie, geen blokkade).

## Brok 2: schermen in de telefoon-app (1-11-2026)

**Gedaan: de drie kern-aanpassingen van de regie (eigen commit)**
- Foto-verwijzingen (ruimte, wand, bestandsnaam) van de werkzone-wanden zitten nu in `inhoudsHash`; foto-verwijzingen van andere wanden, tijden en beelden niet. Een foto verwijderen of vervangen maakt een vrijgave ongeldig.
- Plafond links en rechts: `K.PLAFOND_UIT_HOEK = 300`, staat in vraag en uitleg.
- Drie wandlengtes vergelijken: meer dan 5 mm verschil (`K.TOLERANTIE.wand_scheef`) geeft waarschuwing `wand-scheef` ("wand niet te lood of scheef"), geen blokkade.
- Tests: 66 groen (drie nieuwe; twee bestaande aangepast omdat een foto bij een werkzone-wand nu in de hash zit).
- Kern-uitbreiding voor de schermen: `K.zetRuimte`, `K.voegOpeningToe`, `K.voegObjectToe`, `K.voegBijzonderheidToe`, `K.zetDefinitie`, `K.verwijderItem` (archief in `ruimte.verwijderd`) en `K.verwijderFoto` (archief in `opname.fotos_verwijderd`). De route vraagt alleen naar wat bestaat, dus de app moet per wand kunnen vastleggen wat er zit. 72 tests groen.

### Brok 2c: het draadmodel en de wandfoto met lijnenoverlay (1-11-2026, Sonnet)

**Wat er staat** (alles achter de beta-schakelaar, alleen beheer; de oude Opname, Capture en Rapportage zijn niet aangeraakt)
- `mt-opname-geo.js` (pure rekenfuncties, 16 tests): homografie van de vier getikte wandhoeken, 3D-projectie van het draadmodel (eigen SVG, geen bibliotheek), de kamergeometrie uit de kern (`K.vorm`; zonder maten een duidelijk gelabelde schatting) en per wand de maatlijnen die bij de vragen van de kern horen. Een lijn bestaat alleen als de kern ernaar vraagt (test).
- `mt-opname-opslag.js`: eigen IndexedDB `mt-opname` (opnames, fotos). **Keuze:** niet `mt-fotostore.js`. Die is van de bestaande Capture/Rapportage (database `mt-rapporten`) en heeft een opruimfunctie voor gesynchroniseerde foto's; hier mag nooit iets stil verdwijnen en de oude opslag blijft onaangeroerd. Er is geen wis-functie; een foto die uit de opname gaat blijft als beeld bewaard (de kern archiveert de verwijzing). Het beeld wordt eerst bewaard, pas daarna komt de verwijzing in de opname. Een opslagfout staat als rode balk met "Opnieuw proberen" boven elk scherm.
- `mt-opname.js`: lijst, start, fotoronde, rondje controle, afronden. `mt-opname-model.js`: draadmodel en wandscherm. `mt-opname.css`. Alleen DOM-methoden (`textContent`), geen `innerHTML`: geen nieuwe sink, `check-sinks` groen, geen baseline aangepast.
- `mobiel.html` (minimaal): laag `#opnameLaag`, twee items in Meer (schakelaar "Nieuwe opname testen" en "Opname (beta)", alleen voor `MTRol.isBeheer()`), lazy loader met `?v=2026-11-01a` volgens het patroon van de Forecast-laag, Android-terugknop gaat eerst een stap terug in de module.
- Het record in IndexedDB is `{ id, opname, layout, instellingen }`: de kern-opname (datamodel v0.3) is onveranderd; wat alleen de schermen nodig hebben (waar de wandhoeken op de foto zitten, waar een kozijn getekend staat, de plinthoogte van de kamer) staat in `layout` en `instellingen`. De inhoudshash en het datamodel zijn dus gelijk gebleven.

**Hoe het werkt (zoals Bart vroeg)**
- Start: project (de projectenlijst van de app, met zoeken), ruimtenaam, meubeltype (alleen kast actief), werkzone N/O/Z/W (meerdere), toegangsdeur-wand (maakt deur D1 en bepaalt waar de fotoronde begint).
- Fotoronde: native camera (`<input type=file accept=image/* capture=environment>`), de originele file blijft ongemoeid (volle resolutie, EXIF, niet via `camSnap`), een foto per wand met de klok mee vanaf de toegangsdeur; opnieuw fotograferen kan, een foto overslaan ook (vrijgeven blokkeert dan bij een werkzone-wand).
- Hoofdscherm: draadmodel, draaibaar met een vinger, wandlabels zijn de tikdoelen (44 px) en de twee achterwanden zijn ook als vlak aan te tikken. Rood = nog te meten, zwart = gemeten, oranje = later, groen accent = werkzone, gestippeld = schatting (met een uitlegregel waarom). Knop "Verder meten" volgt de route van de kern; plafond en diagonalen staan als chips onder het model.
- Wandscherm: foto met lijnenoverlay. Eerste keer tik je de vier hoeken van de wand (daarna te slepen en later aan te passen). De actieve maatlijn is rood met label, gemeten lijnen zwart met hun maat, de rest fijn grijs; elke lijn is aantikbaar. Groot invulveld (30 px) en rode pijl "volgende"; Enter werkt ook. Niet van toepassing, Later meten (wordt Nameten) en Vorige staan eronder. Zonder foto precies hetzelfde op een schematisch wandaanzicht.
- Toevoegen: "+ Toevoegen" (kozijn/raam, deur, stopcontact, schakelaar, radiator, leiding, vensterbank, plint van deze wand, bijzonderheid, anders). Kozijn, deur en radiator: twee hoeken tikken; punten: één tik. De definitie (muursparing, dagmaat, kozijn buiten) wordt bij het toevoegen gevraagd en staat anders in het paneel van de eerste maat van een opening.
- Optioneel in de wandfoto: het labeltje (R1, SC1, ...) van een onderdeel aantikken geeft de extra maten, de definitie, een close-up-foto (niet verplicht, als foto met `soort: closeup` en `wand: null`, zodat het niet als wandfoto telt) en Verwijderen (archief, niets verdwijnt).
- Plint: één keer per kamer (hoogte, dikte, blijft of gaat weg) voor alle werkzone-wanden; bij een wand komt "Zelfde als de hele kamer: 80 mm, Klopt, verder" met een knop "Wijzigen voor deze wand". Wijkt een wand al af, dan overschrijft een nieuwe kamerwaarde die niet.
- Bijzonderheden per wand: bovenaan "Niets bijzonders" (één tik), pas bij "Er zit iets" komen de soorten.
- Afronden: tegels basis, werkzone, rondje, optioneel; "Nog nodig om vrij te geven" met tikbare regels die naar het juiste scherm springen; waarschuwingen; de lijst Nameten (alleen een lijst, geen taken); wat de vrijgave zegt (scope en uitzonderingen); Rondje controle; Opslaan altijd; Vrijgeven alleen als `K.vrijgeefCheck.kan`, met een bevestiging en de scope; JSON-kopie bewaren. Na een wijziging staat de status op "Vrijgave vervallen".

**Getest** (headless Chrome op 390 px, mobiel.html, rol geforceerd; eigen testfoto, geen klantfoto's): hele flow van start tot vrijgeven, schematisch zonder foto, herladen (opname bleef bewaard), terugknop, opslagfout zichtbaar en herstelbaar, lezer en beheer-zonder-beta zien niets. Schermen: `OPNAME-APP\BOUW\brok2-screens\` (28 bestanden). Node-tests: kern 72, geo 16, ui 5 (plus de bestaande Forecast-tests) groen; `check-sinks`, `check-verwijzingen`, UTF-8 en `laadtest` zonder EXC.

**Bewust niet gedaan**
- Geen automatische beeldherkenning, geen foto-voorstellen uit de foto berekenen (`K.zetVoorstel` wordt nog niet gebruikt), geen DISTO, geen upload, geen taken, geen worker, geen `sw.js` of `updates.json`, niet gepusht of gemerged.
- Alleen kast (keuken en badmeubel staan uitgeschakeld), alleen een vierhoekige kamer met vier wanden.
- Niet getest op een echte Android-telefoon of iOS; wel de native camera-input, maar de camera zelf is niet geprobeerd. Een opname uit een nieuwere kernversie wordt niet geopend (melding).
- Geen aparte bewerkscherm voor project, ruimtenaam of werkzone na de start (alleen via een nieuwe opname).
- De 3D-labels kunnen bij sommige draaihoeken over elkaar vallen; draaien lost dat op.

**Keuzes ter bevestiging door Bart**
1. Het hulpgetal `positie_x` (alleen voor de volgorde links naar rechts) zet de app zelf op een kopie van de opname, omdat de kern er geen functie voor heeft. Het wordt uit de getikte plek berekend, dus een schatting als de wandlengte nog niet gemeten is.
2. Op een wand buiten de werkzone worden de maten van wat je zelf toevoegt wel helemaal gevraagd (kern: `eigen`); het toevoegen-blad zegt dat.
3. Een maat onder 10 mm wordt geweigerd met de uitleg dat het geen millimeters lijkt (5,76 voor 5,76 m).
4. De plint van de hele kamer geldt alleen voor de werkzone-wanden (daar vraagt de kern erom); op andere wanden gebeurt niets.
5. Het record in IndexedDB bewaart de kern-opname en `layout` apart; een JSON-kopie bevat beide maar niet de foto's zelf.


## Brok 3: de vorm uit de foto's (1-11-2026, Sonnet)

Bart (1-11): "als je kamer een vorm heeft of een uitstekend stukje wand oid dan moet hij dat wel mee modeleren" en "de vorm moet aanpassen aan de hand van de fotos en dan verduidelijken in verhouding naarmate er meer informatie is". Dus geen sjabloon (rechthoek of L) bij de start: de vorm ontstaat uit de foto's en wordt steeds nauwkeuriger. Datamodel `docs/opname-json-v0.4.md`.

**Gedaan**
- **Fotoronde zonder vast aantal wanden.** De start vraagt alleen project, ruimtenaam en meubeltype (geen werkzone, geen toegangsdeur-wand). De eerste foto is de wand van de toegangsdeur (daar komt D1 op), dan met de klok mee tot "Kamer rond: ik ben terug bij wand 1" (minstens drie wanden). Geen N/O/Z/W meer voor nieuwe opnames: wanden heten Wand 1, Wand 2, ... De laatste wand weghalen kan (archief). De wand-tegels en de nummers op de plattegrond zijn tikbaar.
- **Hoek tussen de foto's:** standaard 90 graden (een aanname, ook zo genoemd), met een tik 270 (hoek springt naar binnen, L-vorm) of schuin (eigen waarde: "schatting" of "gemeten"). Staat in de fotoronde (één rij per hoek), in het wandscherm (knop Hoek) en als lijst in het model.
- **Vorm per wandfoto:** knop "Vorm van de wand": tik op de vloerlijn de knikken (minstens twee); elk stuk ertussen is recht (standaard), naar voren (uitsprong) of naar achteren (nis). Daaruit ontstaat een uitsprong/nis met breedte, positie en diepte (en hoogte in de werkzone). De positie op de wand volgt de homografie van de vier wandhoeken en wordt als verhouding opgeslagen (`foto-voorstel`); in mm pas zodra de wandlengte gemeten is. De diepte is een standaardschatting van 300 mm, ook als foto-voorstel. Alles blijft grijs tot het gemeten is; een gemeten maat is altijd leidend.
- **Plattegrond (K.plattegrond) en 3D groeien mee:** gestippeld grijs = schatting, vast = gemeten; uitsprongen en nissen in blauw; werkzone groen. Gemeten wandlengte schaalt de geschatte uitsprong mee (verhouding maal gemeten lengte). Onbekende wandlengtes sluiten als schatting bij een ruimte met alleen haakse hoeken; de kern schrijft zo'n schatting nooit als maat weg. Een inconsistente meting wordt niet mooi gemaakt: de sluitfout blijft zichtbaar.
- **Route en meten:** uitsprongen/nissen komen in de kern-route na de wandlengte en vóór de openingen, van links naar rechts (basis: breedte, positie, diepte; werkzone: ook hoogte). Een foto-voorstel staat als "Schatting uit de foto: 948 mm. Dit is geen meting." boven het invoerveld.
- **Werkzone kiezen:** na "kamer rond" kies je de wand(en) door ze aan te tikken in het 3D-model of op de plattegrond (meerdere mag). Later wijzigen kan op het modelscherm.
- **Sluitcontrole met N wanden:** vier wanden zonder inspringende hoek: de oude vierhoek-logica (4 zijden + 1 diagonaal, de tweede als controle). Andere vormen: rondgang met de binnenhoeken, sluitfout > 10 mm is "meetgegevens inconsistent" (blokkeert vrijgeven), daaronder "schematisch (hoeken aangenomen 90 of 270 graden)", nooit stil haaks; een diagonaal als controle is optioneel (`+ Diagonaal als controle`). Een schuine hoek die niet gemeten is maakt de vorm "onvoldoende bepaald". Afronden toont plattegrond, status, sluitfout en alle hoeken met hun herkomst.
- **Vrijgave, hash en scope** werken met N wanden (getest met een L-vorm van zes wanden en een uitsprong, ook "vrijgave vervallen" na een hoek- of knikwijziging). Nieuwe blokkades: fotoronde niet rond, minder dan drie wanden.
- **Migratie v0.3 naar v0.4, additief en zonder verlies.** De vaste wanden N/O/Z/W blijven met hun namen; er komen geen velden bij. De versie verschuift (oude waarde in `_versie_oud`) en de hash behandelt zo'n opname als de oorspronkelijke versie, zodat een bestaande vrijgave geldig blijft. Bewezen met een echte vrijgave uit de v0.3-kern (`test/fixtures/opname-v03-vrijgegeven.json`), en in de app: de oude opname opent in het model met "vrijgegeven".

**Getest**
- Node: kern 72 (de oude, ongewijzigd groen op drie versie-checks na), geo 22, vorm 30 (nieuw: wanden uit foto's, hoeken, knikken, uitsprong/nis, voorstel en meeschalen, plattegrond, sluitfout met N wanden, schuin, diagonaal, migratie, vrijgave met zes wanden), ui 6.
- Headless Chrome op 390 px (Playwright) over `mobiel.html`: de hele flow van start tot vrijgeven met een L-kamer van zes wanden en een uitsprong, plus het openen van een oude v0.3-opname. 0 console-fouten. 51 schermafdrukken in `OPNAME-APP\BOUW\brok3-screens\`.
- `check-sinks`, `check-verwijzingen`, UTF-8 en `laadtest` zonder EXC.

**Bewust niet gedaan**
- Geen beeldherkenning: knikken, hoeken en wandhoeken tikt de gebruiker. Geen diepteschatting uit de foto (de standaard is 300 mm, als schatting herkenbaar).
- Een uitsprong in de hoek is geen tussenstuk: die maak je als eigen wand (volgende foto, hoek 90 of 270). Een schuin stuk in een wand idem: een eigen wand met een schuine hoek.
- Schuine hoeken worden alleen bepaald bij vier wanden (de diagonaal legt de vierhoek vast) of als de hoek gemeten is. Bij meer wanden is een diagonaal alleen een controle, geen oplossing voor een geschatte hoek.
- Een wand tussen bestaande wanden invoegen kan niet (alleen de laatste wand weg of een wand erbij na "ronde weer openen").
- Niet getest op iOS (WebKit is hier niet geïnstalleerd) of op een echte Android-telefoon; wel op een Chrome-viewport van 390 px met aanraking. Knikken slepen kan niet, wel "laatste knik weg" en opnieuw.
- Geen Codex-ronde (de bundelronde aan het eind: datamodel v0.4 en migratie zijn de kandidaten).

**Keuzes ter bevestiging door Bart**
1. **Een uitsprong is een stuk tussen twee knikken, niet in een hoek.** In een hoek maak je een eigen wand. Klopt dat met hoe jij naar een schoorsteen of pilaster kijkt?
2. **De wanden van een nieuwe opname heten Wand 1, 2, ...** (geen kompas). De eerste wand is de wand van de toegangsdeur.
3. **De standaarddiepte van een uitsprong is 300 mm**, grijs en als schatting.
4. **Een geschatte hoek (schuin) maakt de vorm "onvoldoende bepaald"** bij elke vorm; dat blokkeert het vrijgeven niet maar staat bij de uitzonderingen.
5. **De werkzone kies je na de fotoronde in het model,** niet meer bij de start.
6. **Een inconsistente meting wordt in de tekening niet "mooi gemaakt"**: de sluitfout staat er als oranje streep. Kleine afwijkingen bij vier wanden zonder diagonaal (een paar mm) worden in de tekening wel gelijk verdeeld, zonder een maat te veranderen.


### Brok 3, vervolg: visuele review ChatGPT (GESPREK 038 en 040, 1-11-2026)

**Gedaan** (commits `59d0700` en `9ff8762`, plus de reviewset)
1. **Wandfoto rustiger** (`R1-k`, `R1-l`): in de meetstand valt alleen de actieve maatlijn op (rood, dik, met label). Alle andere lijnen zijn dun en rustig, zonder label en zonder eindpunten; een lijn aantikken maakt hem actief en toont zijn maat. De omtrek van de wand is vager.
2. **Hoeken met een loep** (`R1-d` tot `R1-i`): geen slepen meer. Tik ongeveer op een hoek, zet hem precies in een 6x uitvergrote uitsnede, "Ongedaan" en "Opnieuw" kunnen altijd, en een nummer aantikken zet die hoek opnieuw in de loep. Een hoek kan **onbekend** zijn (buiten beeld of achter een kast, bijvoorbeeld de kartonnen doos in `R2-a`): dan komt er geen homografie en geen fictieve hoek, maar een schematisch wandaanzicht met uitleg (`R2-d`); knikken en onderdelen plaatsen werken daarop ook. Het layout-veld `hoeken` mag `null` bevatten met `onbekend: true` (app-gegevens, niet de kern).
3. **Geen vaste minimale maat meer**: de grens van 10 mm is weg (plintdikte, voeg). In plaats daarvan blokkeren **onwaarschijnlijke maar mogelijke** maten het vrijgeven tot ze expliciet bevestigd zijn (`K.bevestigOnwaarschijnlijk`, `ruimte.bevestigingen[pad] = { waarde, tijd }`, geldt voor precies die waarde): een wandlengte buiten 300 tot 15000 mm, een plafond buiten 2000 tot 5000 mm, en een wand waarvan de lengte onder, midden en boven meer dan 100 mm verschilt. Afronden toont "Klopt, bevestigen" of "Opnieuw meten" (`R4-a`, `R4-b`). **Geometrisch onmogelijke** combinaties blokkeren zonder bevestiging: een opening of uitsprong die buiten de wand valt of over een andere uitsprong ligt, en alles wat de sluitcontrole al als inconsistent kende.
4. **Reviewset** in `brok3-screens\` met `INDEX.md` (bestandsnaam, afmeting, scenario, testdata, commit). Naast de getekende demowand: een **echte foto** (kamer Joe, oostwand, origineel JOE-03, privé: alleen gelezen via het bestandsveld, nooit in de repo), een afgedekte hoek, een scenario met het **toetsenbord open** (viewport 390 x 440: de foto blijft bovenin staan, het invoerveld, de pijl en de knoppen liggen binnen het beeld) en losse PNG's, geen montage. Origineel-ID, crop/overlay en schermafdruk hebben dezelfde ID (R1, R2, R3, R4).
- Het toetsenbord: de laag volgt `visualViewport` (hoogte en offset), zodat het zichtbare gebied klopt, het invoerveld in beeld scrolt en de werkbalk bij weinig hoogte verdwijnt.

**Niet getest:** een echt Android-toetsenbord (alleen een korte viewport en `visualViewport`); iOS.


## Brok 3b: P1-fixes uit de review van ChatGPT (GESPREK 043, 1-11-2026, Sonnet)

Alles op branch `opname`, niet gepusht. Elk punt heeft tests; ze staan in `test/opname-sluiting.test.js`, `test/opname-export.test.js` en `test/opname-opslag.test.js` (naast de bestaande).

1. **Laatste hoek genegeerd** (P1). `vormVeelhoek` toetst nu ook de richtingssluiting: de binnenhoeken tellen op tot (n-2) x 180, de gereconstrueerde hoeken komen terug tegen de invoer, en `wandBotsing` ziet naast kruisingen ook een hoekpunt op een andere wand, wanden over elkaar en terugvouwen. De repro van ChatGPT (zes wanden, laatste hoek 90 / 270 / 135) staat letterlijk als regressietest: 90 mag, 270 en 135 zijn `inconsistent`. Onder aangenomen hoeken staat er "sluit niet bij de aangenomen hoeken, meet een controlehoek", niet dat een wandmeting fout is.
2. **Een wand is geen diagonaal** (P1). `voegDiagonaalToe` weigert aangrenzende hoeken (ook H6-H1); uit een import of `K.lees` telt zo'n diagonaal niet (`genegeerd`, waarschuwing `diagonaal-is-wand`, melding). Een leeg restant van A of B bij zes wanden wordt vervangen in plaats van "bestaat al".
3. **Drie statussen** in `vorm.bepaling`: getekend / geometrisch bepaald / onafhankelijk gecontroleerd. Bepaald vraagt bevestigde hoeken plus alle lengtes, of N-3 onafhankelijke diagonalen die elkaar niet kruisen en binnen de ruimte liggen (geen blinde waaier door buitenruimte; herhalingen tellen niet); gecontroleerd een extra controlemaat. Eén diagonaal is niet meer globaal groen: "Lengtes gemeten; model onder hoekaanname; controle C klopt". `vorm.volgende` is telkens de volgende benodigde maat (knop "Meet hoek 1 naar hoek 5"). Haaksheid van de werkzone: lokale driehoeksmeting of winkelhaak per hoek (`K.zetHoekDriehoek`), met een voorstel voor de hoeken van de werkzone. Het model tekent vast zodra de vorm bepaald is.
4. **Uitsprong** met drie gescheiden bronnen: bronstandaard (diepte 300), foto-interpretatie (breedte, positie; parallax), gemeten. Gemeten blijft staan als de kalibratie wijzigt (test).
5. **Extra foto's** van hetzelfde vlak: soort `extra`, hoort bij een wand met hoofdfoto, maakt nooit een wand ("Extra foto van wand N (geen nieuwe wand)").
6. **Historische v0.3-vrijgave** blijft geldig en toont "Gevalideerd met oude kern (v0.3)" (`K.vrijgaveKern`, `vrijgave.kern` bij nieuwe vrijgaven).
7. **UI**: loepinstructie ("snijpunt vloer/wand; staat er iets voor: Hoek onbekend, niet gokken"), het rode label op het schema blijft binnen het beeld (390 px), de originele foto is bereikbaar als bewijs, "Alleen op dit toestel opgeslagen: nog geen synchronisatie" in lijst, model, afronden en de toast; de toast na Opslaan komt na `tx.oncomplete` (nagebootste IndexedDB als test; een afbreking of quotafout is een fout).
8. **Volledige export en terugzetten** (`mt-opname-export.js`): zip met de opname-JSON en alle foto's (ook gearchiveerde en losse), sha256 per foto; terugzetten controleert alles voor het schrijft en zet een bestaande opname met andere inhoud als kopie terug. In de browser getest met een tweede, leeg toestel.
9. **Reviewpakket** `OPNAME-APP\BOUW\brok3b-<commit>\` (zie REVIEW.md daar): beelden gemaakt op de bevroren commit, voorbeeld-JSON's en een node-script, een zelfstandig interactiepakket.

**Bewust niet gedaan**
- Geen echte Android-proef (camera, toetsenbord, terugknop, offline, heropenen, quotafout): dat moet Bart doen. De vroegere "R3-a" heet nu viewport-simulatie.
- Geen upload of synchronisatie, geen SharePoint, geen VW-export met meetstatus (die komen vóór DISTO).
- Geen compressie in de export-zip (foto's zijn al gecomprimeerd); een export van een opname met veel grote foto's kan veel geheugen vragen op een oude telefoon.
- Schuine hoeken blijven alleen bepaald via de diagonaal bij vier wanden of via een gemeten hoek.
- Geen Codex-ronde (die volgt als bundelronde aan het eind).

**Keuzes ter bevestiging door Bart**
1. Een hoek telt als "bevestigd" (bron `gemeten`) als je hem met een winkelhaak of een driehoeksmeting hebt gecontroleerd; zonder die controle blijft 90 graden een aanname, ook als alle lengtes sluiten.
2. Tolerantie voor de hoekensom 1 graad en voor raakpunten 1 mm; sluitfout blijft 10 mm (voorlopige projecttolerantie).
3. De vorm heet pas "onafhankelijk gecontroleerd" met één extra maat bovenop wat nodig is om hem te bepalen.


## Brok 3c: reviewronde 046 van ChatGPT (1-11-2026, Sonnet)

Alleen deze reviewronde afgemaakt, geen nieuwe functies. Alles op branch `opname`, niet gepusht. Code-commit `39af480`; het bevroren pakket staat in `OPNAME-APP\BOUW\brok3c-<eindcommit>\` (zie REVIEW.md daar).

1. **P1 vierhoek negeert tegenstrijdige gemeten hoek** (`vormVierhoek`). Elke hoek met bron `gemeten` (ook de eerste en de laatste, ook met één diagonaal) wordt getoetst tegen de hoek uit wandlengtes en diagonaal. Marge: 1 graad + `onzekerheid_graden` van die hoek + de hoek die 10 mm op de kortste aangrenzende wand geeft. Tegenstrijdig geeft `inconsistent` met `vorm.hoek_conflict`, het pad `wanden.<id>.hoek_naar_volgende` in `vorm.betrokken` en de hoek in de reden. De repro van ChatGPT (4000/3000/4000/3000, A en B 5000, hoek na wand 1 gemeten 100) staat letterlijk als test. Aangenomen hoeken en foto-voorstellen mogen afwijken. N-hoek-route: de gemeten hoeken zijn invoer van de rondgang; de marge van hoekensom en gereconstrueerde hoeken telt nu de onzekerheid van gemeten hoeken mee, en bij elk conflict staan alle gemeten hoeken in `betrokken`.
2. **P2 driehoeksmeting niet wegafronden** (`zetHoekDriehoek`). `graden` is de werkelijk gemeten hoek (89,6 blijft 89,6); bij de hoek staan `methode`, `onzekerheid_graden` en `driehoek { a, b, c, ruw_graden, gemeten_graden, onzekerheid_graden }`. "Ongeveer haaks" (0,5 graad) is alleen een classificatie (`hoekVan().haaks`, resultaat `haaks`). Gevolg: een gemeten 89,6 graden in een rondgang met verder aangenomen 90-graden-hoeken geeft ongeveer 42 mm sluitfout over 6000 mm en dus een conflict (zo bedoeld). `zetHoek` kreeg een optionele zevende parameter `{ methode, onzekerheid_graden }` (winkelhaak: methode `winkelhaak`).
3. **Teksten en docs**: "Vorm gecontroleerd met controlemaat C" in plaats van "Onafhankelijk gecontroleerd"; lokale haaksheid, obstakels en montage-/hoogtematen blijven apart open (`K.OPEN_NA_VORM`); de toleranties staan als rekenregels op de sluitkaart (`K.CRITERIA_TEKST`); restfouten (`K.restfouten`); winkelhaak en driehoek zijn lokale controles. `docs/opname-json-v0.4.md` heeft een tabel met de ondersteunde vormgevallen (N-3 vereist een geldige interne triangulatie; de code vergelijkt diagonalen met de uit invoerhoeken gebouwde vorm, geen vrije reconstructie).
4. **R1-k (visueel)**: de kalibratiepunten van de echte foto JOE-01 waren op drie van de vier hoeken ongeveer 25 tot 35 pixels (op 1536 breed) mis: linksonder lag op het witte voorwerp, rechtsonder op de radiator en rechtsboven op de rand plafond/zijwand. De hoeken zijn opnieuw bepaald op de uitvergrote originele foto (zie REVIEW.md in het pakket). De linkeronderhoek zelf is niet afgedekt (de blauwe afplaktape raakt de hoek zichtbaar), dus geen "onbekend".

**Getest**: node-tests 170 (7 export, 22 geo, 72 kern, 3 opslag, 27 sluiting, 6 ui, 33 vorm; 9 nieuwe voor 046), `check-sinks`, `check-verwijzingen`, UTF-8, laadtest zonder EXC. Beelden op 390 px headless Chrome; niet op een echte telefoon of iOS.

**Bewust niet gedaan**: geen vierhoek uit vier zijden en één hoek (zonder diagonaal blijft er niets om een hoek tegen te toetsen); geen vrije reconstructie uit diagonalen; geen Android-proef; geen Codex-ronde; geen upload.
