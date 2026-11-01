# Opname-JSON v0.3

Datamodel van de nieuwe opname-module (alleen de rekenkern: `mt-opname-kern.js`, tests in `test/opname-kern.test.js`). Het bouwt voort op "Voorstel opname-JSON v0.2" (OPTIES §7.4), de besluiten van 31-10 en de review van 1-11 (Bart en ChatGPT, GESPREK 035). De kern heeft geen DOM en geen netwerk; opslag en scherm komen in latere brokken. Alle telefoons zijn Android: de DISTO via Web Bluetooth komt later, nu bestaat alleen `bron: "disto"` in het model.

## Uitgangspunten

- **Gemeten maten zijn leidend.** Een schatting uit de foto is een grijs `voorstel` naast de maat en telt nooit als meting.
- **Geen rechthoek veronderstellen.** De vorm volgt uit vier zijden en één diagonaal; de tweede diagonaal is de controle. Een scheve kamer met juiste metingen is geen fout.
- **Niets wordt gecorrigeerd of haaks geforceerd.** Elke wand houdt zijn eigen gemeten lengte; de controles melden alleen.
- **Nooit stil verlies.** Een nieuwe meting zet de vorige in `historie`; onbekende velden blijven bij het lezen behouden.
- **Niets stil als "volledig gemeten".** De vrijgave geeft scope en uitzonderingen terug.
- Eenheden: lengtes in mm. Tijdstippen in ISO 8601.

## Opbouw

```
opname
  schema "mt-opname", versie "0.3", opname_id, project {code}, status (concept | opgeslagen | vrijgegeven), aangemaakt, bijgewerkt
  vrijgave?         { hash, tijd, door, scope, uitzonderingen, volledig_gemeten }       alleen na K.vrijgeven
  fotos[]           { id, bestand, ruimte, wand|null, tijd }                            alleen een verwijzing; de ruimte staat bij de foto zelf
  ruimtes[]
    id, naam, meubeltype (kast | keuken | badmeubel), werkzone [N|O|Z|W, meerdere mag], toegangsdeur? (id van een opening)
    wanden[]          { id N|O|Z|W, van, naar, maten.{lengte, lengte_onder, lengte_boven, plafond_links, plafond_midden, plafond_rechts, bevestiging} }
    plafondpunten[]   { id, plaats, wand?, maten.hoogte }
    diagonalen[]      { id A|B, van, naar, maten.lengte }
    openingen[]       { id, soort raam|deur, wand, definitie, positie_vanaf?, positie_x?, maten.{breedte, hoogte, positie, borstwering, positie_rechts} }
    objecten[]        { id, type, wand, hoek?, naam?, opening?, gezien?, eigen?, herkomst?, positie_x?, maten.{...} }
    bijzonderheden[]  { id, soort, wand, notitie, maten.maat? }
    rondje            { "<wand>|<categorie>": { waarde aanwezig|afwezig|later, tijd } }
```

**Wanden** lopen rond de klok: N van NW naar NO, O van NO naar ZO, Z van ZO naar ZW, W van ZW naar NW. Kijkend naar de wand is `van` de linkerhoek. `positie` van een opening is altijd de afstand vanaf die linkerhoek tot de dagkant; `positie_rechts` is de afstand tot de rechterhoek. Is `positie_vanaf` een opening-id (bijvoorbeeld een penant tussen twee ramen), dan wordt vanaf de dagkant van die opening gemeten. Diagonaal A loopt NW naar ZO, B loopt NO naar ZW. `positie_x` (optioneel, mm vanaf de linkerhoek) is een hulpgetal voor de volgorde links naar rechts voordat er iets gemeten is.

**Definitie van een opening** (`definitie`): `muursparing`, `dagmaat` of `kozijn-buiten`. Zonder definitie is een breedte of hoogte dubbelzinnig (de meetproef verloor daardoor tot 55 mm): bij een opening in de werkzone blokkeert dat het vrijgeven, daarbuiten geeft de kern een waarschuwing. De referentie (hoek, vloerpeil, zijkanten, boven-onder, opening, object of wand) hoort bij de vraag en wordt door de kern afgeleid.

**Objecttypes:** stopcontact, schakelaar (hoogte, afstand tot hoek, afdekraam), leiding (afstand, diameter, kraanhoogte), radiator (buitencontour inclusief kraan en leiding: breedte, hoogte, onderkant; verder uitsteek en bereikbaarheid `vrij|beperkt|geblokkeerd`), vensterbank (diepte, dikte, overstek; zonder gekoppelde `opening` ook hoogte), plint (hoogte, dikte, keuze `blijft` of `gaat-weg`) en overig. Een object buiten de werkzone krijgt alleen vragen als `gezien` op `toch-meten` staat of de opnemer het zelf toevoegde (`eigen`). `gezien` is `klopt`, `niet-aanwezig` of `toch-meten`.

**Wandbevestiging:** voor elke wand buiten de werkzone is er één punt `maten.bevestiging`: "gehele wand bekeken, geen relevante obstakels" (`staat gemeten`, `keuze bekeken`), of bewust `nvt` met `keuze afgedekt` of `niet-beoordeeld`. Zo verdwijnt niets stil dat de app niet herkende.

**Bijzonderheden:** stootplint, balk, koof, nis, uit-het-lood, leiding-in-zicht, kabelgoot, anders. Noemen volstaat; geef je er een `maten.maat` bij, dan hoort die bij de extra punten.

## Een maat (punt)

```
{ staat: gemeten | nvt | later | open, waarde: mm | null, keuze?: tekst, bron: disto | hand | null, tijd: ISO | null,
  notitie?, voorstel?: { schatting_mm, onzekerheid_mm?, bron: "foto-voorstel", tijd }, historie?: [eerdere standen] }
```

| staat | betekenis |
|---|---|
| gemeten | een echte meting met `bron` `disto` of `hand` en een waarde groter dan 0 (of een geldige `keuze`). Een foto-voorstel is geen meting; staat het toch als bron bij `gemeten`, dan telt het punt als open en volgt een waarschuwing |
| nvt | bewust weggeklikt: voor dit project niet maatvast nodig. Wordt vastgelegd, telt als afgehandeld en staat in de uitzonderingen van de vrijgave |
| later | wordt een taak "Nameten: ..." en telt niet als compleet |
| open | nog niets |

Het voorstel heeft `schatting_mm` (de schatting) en apart `onzekerheid_mm` (alleen als onderbouwd), niet "±2460".

## Wat de kern berekent

- **Vragenlijst** (`vragen`) uit de ruimte en de werkzone. Basis: 4 wandlengtes, plafond op één punt, diagonaal A, per opening breedte en positie, en per wand buiten de werkzone de bevestiging. Werkzone: per werkzone-wand de wandlengte ook net boven de plint en net onder het plafond (`lengte_onder`, `lengte_boven`; samen met de lengte op 1000 mm drie hoogtes) en het plafond op drie punten (`plafond_links`, `plafond_midden`, `plafond_rechts`); bij openingen op die wanden ook hoogte, borstwering en de positie tot de rechterhoek; plus alle maten van de objecten op die wanden. De basis houdt één plafondpunt. Optioneel (grijs voorstel): diagonaal B en hoogte en borstwering van openingen buiten de werkzone. Extra: wat de opnemer toch wil meten of zelf toevoegt, verdere plafondpunten en bijzonderheden met een maat. Alleen `kast` heeft een echte vragenset; voor keuken en badmeubel bestaat een hook (`K.MEUBELSETS.<type>.extraSlots`) en kan niet worden vrijgegeven.
- **Tellers** (`tellers`): per emmer `n`, `gemeten`, `nvt`, `later`, `open`, `conflict`, `beantwoord` (gemeten + nvt + later, de teller "x van n") en `compleet` (gemeten + nvt). Kamer Joe met werkzone Oost: 17 basis, 25 werkzone, 6 optioneel.
- **Route** (`route`, `volgendeOpen`, `vorige`, `stap`): de vragen punt voor punt, geen totaaloverzicht. Zie hieronder.
- **Vorm en sluitcontrole** (`vorm`, `sluitcontrole`): de vierhoek uit 4 zijden + 1 diagonaal (twee driehoeken), de andere diagonaal als controle met 10 mm tolerantie. Uitkomst `vorm.status`: `onvoldoende-bepaald` (schematisch), `onverifieerd` (bepaald, nog niet gecontroleerd), `consistent` of `inconsistent`. `vorm.afwijkend` meldt dat de kamer niet rechthoekig is (hoek meer dan 0,3 graad van 90 of tegenoverliggende wanden meer dan 5 mm verschil): dat is informatie, geen fout. Alleen `inconsistent` (de vierhoek sluit niet) is een conflict en blokkeert het vrijgeven. Met de uitkomst komen de hoeken en de hoekpunten in mm (noordwesthoek in de oorsprong, noordoosthoek op de x-as); dat is schematisch zolang de status niet `consistent` is.
- **Rondje controle** (`rondje`, `zetRondje`): alleen voor de werkzone-wanden, per categorie (deuren en ramen, elektra, water/afvoer/leidingen, verwarming, plinten, afwijkingen) aanwezig, afwezig of later. Niet gekozen is "nog niet bekeken", nooit afwezig. Een categorie op later is een open taak en blokkeert het vrijgeven (`K.RONDJE_LATER_BLOKKEERT`, standaard aan).
- **Vrijgeven voor maatwerk** (`vrijgeefCheck`, `vrijgeven`): pas als het meubeltype een echte set heeft (kast), de werkzone gekozen is, elke opening in de werkzone een definitie heeft (daarbuiten alleen een waarschuwing), basis, werkzone en extra compleet zijn (later telt niet, nvt wel), er geen conflicten zijn, een ingevulde optionele maat niet op later staat (en een conflict op de optionele tweede diagonaal telt mee) en het rondje gedaan is. Opslaan kan altijd (`slaOp`, `samenvatting`). De uitkomst bevat `scope` en `uitzonderingen` (n.v.t.-punten, wanden afgedekt of niet beoordeeld, bijzonderheden genoemd maar niet bemeten, rondjekeuzes niet aanwezig, een vorm die niet gecontroleerd is) en `volledig_gemeten`.
- **Vrijgave gekoppeld aan de inhoud** (`inhoudsHash`, `isVrijgaveGeldig`, `effectieveStatus`): de vrijgave bewaart de hash van de inhoud (maten, staten, bronnen, notities, meubeltype, werkzone, punten, bijzonderheden, rondje). Tijdstippen, historie, grijze voorstellen, foto's en status tellen niet mee. Elke inhoudelijke wijziging maakt de vrijgave dus ongeldig (`vrijgave-vervallen`), ook als een app de status niet terugzet.
- **Takenlijst** (`takenlijst`): elk later-punt wordt "Nameten: Kamer Joe, Noord: R1 hoogte", met een stabiele sleutel zodat opnieuw opslaan geen dubbele taken geeft. Een categorie van het rondje op later wordt ook een taak.
- **Lezen en migreren** (`lees`): `versie "0.3"` wordt additief aangevuld. Een oudere vorm (v0.2) of een onbekende vorm wordt een nieuwe opname met het volledige origineel onder `_oud`. Een nieuwere versie komt ongewijzigd terug met `alleenLezen: true`. Onbekende staten, bronnen, waarden en werkzone-waarden blijven bewaard in `_staat_oud`, `_bron_oud`, `_waarde_oud` en `_onbekend`. Een voorstel met de oude namen (`waarde`, `pm`) krijgt `schatting_mm` en `onzekerheid_mm` erbij.

## De route

`K.route(ruimte, { volgorde, fotos })` geeft `{ volgorde, toegangswand, foto_wanden, maten_wanden, start_wand, stappen, samenvatting }`. Elke stap heeft `nr`, `totaal`, `stap` ("stap 5 van 53"), `wand`, `wand_nr` en `wanden_totaal` ("wand 1 van 4"), `groep` (basis, werkzone, extra, optie, foto, rondje), `label`, `vraag`, `definitie`, `referentie`, `uitleg`, `pad`, `staat`, `afgehandeld` en `optioneel`. `K.routeVanOpname(opname, ruimteId, opties)` geeft de foto's van de opname mee.

Standaardvolgorde `fotos-dan-rondloop`:

1. **Fotoronde:** een foto per wand, met de klok mee vanaf de wand van de toegangsdeur (`ruimte.toegangsdeur`, anders de eerste deur, anders noord). Klaar zodra er een foto van die wand bij de ruimte staat.
2. **Maten-rondloop:** start bij de eerste werkzone-wand (in de volgorde van de fotoronde) en gaat met de klok mee. Per wand: wandlengte (in de werkzone ook onder en boven, plus het plafond links, midden en rechts); openingen van links naar rechts (breedte, hoogte, positie vanaf de linkerhoek, borstwering); in de werkzone daarna de objecten van links naar rechts, dan de plint en "bijzonderheden op deze wand?"; buiten de werkzone de bevestiging "gehele wand bekeken". Links naar rechts volgt de gemeten positie of `positie_x`; zonder die getallen blijft de invoervolgorde staan.
3. **Ruimtebreed:** plafondhoogte, diagonaal A en B (B is optioneel).
4. **Rondje controle** per werkzone-wand en categorie. Afwijkingen komen niet dubbel: die staan al bij "bijzonderheden op deze wand?" en delen hetzelfde antwoord.

Alternatieven: `rondloop` (start bij de toegangsdeur, de foto is de eerste stap van elke wand) en `per-soort` (eerst alle wandlengtes, dan alle openingen, enzovoort). Een punt zonder bekende wand valt nooit uit de route.

`K.volgendeOpen(route, na, { wrap })` geeft de eerstvolgende stap na `na` (nr of id) die echt open staat. **Later en n.v.t. houden de route niet op**, optionele stappen worden overgeslagen. `K.vorige(route, na)` geeft de stap ervoor. De route wordt na elke wijziging opnieuw berekend; de ids (`maat:<pad>`, `foto:<wand>`, `bijz:<wand>`, `rondje:<wand>|<categorie>`) zijn stabiel.

## Voorbeeld: kamer Joe

Fictieve projectcode, werkzone Oost, deels gemeten. Basis 10 van 17 beantwoord, werkzone 5 van 25. Vrijgeven kan nog niet: er staan punten open en op later, en het rondje is niet af.

```json
{
  "schema": "mt-opname",
  "versie": "0.3",
  "opname_id": "OPN-TEST-001",
  "project": { "code": "TEST-001" },
  "status": "concept",
  "aangemaakt": "2026-11-01T09:30:00.000Z",
  "bijgewerkt": "2026-11-01T09:45:00.000Z",
  "ruimtes": [
    {
      "id": "R1",
      "naam": "Kamer Joe",
      "meubeltype": "kast",
      "werkzone": [ "O" ],
      "wanden": [
        {
          "id": "N",
          "van": "NW",
          "naar": "NO",
          "maten": {
            "lengte": { "staat": "gemeten", "waarde": 5760, "bron": "disto", "tijd": "2026-11-01T09:30:00.000Z" },
            "bevestiging": { "staat": "nvt", "waarde": null, "bron": null, "tijd": "2026-11-01T09:30:00.000Z", "keuze": "afgedekt", "notitie": "Kast voor de wand" }
          }
        },
        {
          "id": "O",
          "van": "NO",
          "naar": "ZO",
          "maten": {
            "lengte": { "staat": "gemeten", "waarde": 2900, "bron": "disto", "tijd": "2026-11-01T09:30:00.000Z" }
          }
        },
        {
          "id": "Z",
          "van": "ZO",
          "naar": "ZW",
          "maten": {
            "lengte": { "staat": "gemeten", "waarde": 5762, "bron": "disto", "tijd": "2026-11-01T09:30:00.000Z" }
          }
        },
        {
          "id": "W",
          "van": "ZW",
          "naar": "NW",
          "maten": {
            "lengte": { "staat": "gemeten", "waarde": 2903, "bron": "disto", "tijd": "2026-11-01T09:30:00.000Z" },
            "bevestiging": { "staat": "gemeten", "waarde": null, "bron": "hand", "tijd": "2026-11-01T09:30:00.000Z", "keuze": "bekeken" }
          }
        }
      ],
      "plafondpunten": [
        {
          "id": "P1",
          "plaats": "midden",
          "maten": {
            "hoogte": { "staat": "gemeten", "waarde": 2447, "bron": "disto", "tijd": "2026-11-01T09:30:00.000Z" }
          }
        }
      ],
      "diagonalen": [
        {
          "id": "A",
          "van": "NW",
          "naar": "ZO",
          "maten": {
            "lengte": { "staat": "gemeten", "waarde": 6452, "bron": "disto", "tijd": "2026-11-01T09:30:00.000Z" }
          }
        },
        {
          "id": "B",
          "van": "NO",
          "naar": "ZW",
          "maten": {}
        }
      ],
      "openingen": [
        {
          "id": "R1",
          "soort": "raam",
          "wand": "N",
          "definitie": "muursparing",
          "maten": {
            "hoogte": { "staat": "later", "waarde": null, "bron": null, "tijd": "2026-11-01T09:30:00.000Z", "notitie": "Ladder nodig, meubels in de weg" }
          }
        },
        {
          "id": "R2",
          "soort": "raam",
          "wand": "N",
          "definitie": "muursparing",
          "positie_vanaf": "R1",
          "maten": {}
        },
        {
          "id": "R3",
          "soort": "raam",
          "wand": "O",
          "definitie": "muursparing",
          "maten": {
            "breedte": { "staat": "gemeten", "waarde": 1221, "bron": "disto", "tijd": "2026-11-01T09:30:00.000Z" },
            "hoogte": { "staat": "gemeten", "waarde": 1219, "bron": "disto", "tijd": "2026-11-01T09:30:00.000Z" },
            "positie": { "staat": "gemeten", "waarde": 903, "bron": "hand", "tijd": "2026-11-01T09:30:00.000Z" },
            "borstwering": { "staat": "gemeten", "waarde": 910, "bron": "disto", "tijd": "2026-11-01T09:30:00.000Z" },
            "positie_rechts": {
              "staat": "open",
              "waarde": null,
              "bron": null,
              "tijd": null,
              "voorstel": { "schatting_mm": 780, "bron": "foto-voorstel", "tijd": "2026-11-01T09:30:00.000Z", "onzekerheid_mm": 30 }
            }
          }
        },
        {
          "id": "D1",
          "soort": "deur",
          "wand": "Z",
          "definitie": "muursparing",
          "maten": {}
        }
      ],
      "objecten": [
        {
          "id": "SC1",
          "type": "stopcontact",
          "wand": "O",
          "hoek": "ZO",
          "naam": "Stopcontact SC1 (rechts)",
          "herkomst": "foto-voorstel",
          "maten": {
            "hoogte": {
              "staat": "gemeten",
              "waarde": 1000,
              "bron": "disto",
              "tijd": "2026-11-01T09:45:00.000Z",
              "historie": [
                { "staat": "gemeten", "waarde": 1001, "bron": "disto", "tijd": "2026-11-01T09:30:00.000Z" }
              ]
            },
            "afstand": { "staat": "gemeten", "waarde": 298, "bron": "disto", "tijd": "2026-11-01T09:30:00.000Z" }
          }
        },
        {
          "id": "SC2",
          "type": "stopcontact",
          "wand": "O",
          "hoek": "NO",
          "naam": "Stopcontact SC2 (links)",
          "maten": {}
        },
        {
          "id": "RAD2",
          "type": "radiator",
          "wand": "O",
          "maten": {}
        },
        {
          "id": "VB3",
          "type": "vensterbank",
          "wand": "O",
          "opening": "R3",
          "maten": {}
        },
        {
          "id": "PLO",
          "type": "plint",
          "wand": "O",
          "maten": {
            "dikte": { "staat": "nvt", "waarde": null, "bron": null, "tijd": "2026-11-01T09:30:00.000Z", "notitie": "Plint zit achter de kast, niet maatvast nodig" }
          }
        },
        {
          "id": "SC3",
          "type": "stopcontact",
          "wand": "W",
          "hoek": "NW",
          "gezien": "klopt",
          "maten": {}
        }
      ],
      "bijzonderheden": [
        {
          "id": "B1",
          "soort": "kabelgoot",
          "wand": "O",
          "notitie": "Kabelgoot in de noordoosthoek, de hoek zit erachter",
          "maten": {}
        }
      ],
      "rondje": {
        "O|elektra": { "waarde": "aanwezig", "tijd": "2026-11-01T09:30:00.000Z" },
        "O|kozijn": { "waarde": "later", "tijd": "2026-11-01T09:30:00.000Z" }
      },
      "toegangsdeur": "D1"
    }
  ],
  "fotos": [
    { "bestand": "kamer-joe-oost-01.jpg", "ruimte": "R1", "wand": "O", "tijd": "2026-11-01T09:30:00.000Z", "id": "F1" },
    { "bestand": "kamer-joe-overzicht.jpg", "ruimte": "R1", "tijd": "2026-11-01T09:30:00.000Z", "id": "F2", "wand": null }
  ]
}
```
