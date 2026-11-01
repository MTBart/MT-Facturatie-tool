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
4. **Een ontbrekende wandfoto is een waarschuwing** (`foto-ontbreekt`), geen blokkade. Besluit 1 zegt "maat + foto verplicht"; zeg het als de foto het vrijgeven moet blokkeren.
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
