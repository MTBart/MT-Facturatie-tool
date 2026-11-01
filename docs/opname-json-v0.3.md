# Opname-JSON v0.3

Datamodel van de nieuwe opname-module (brok 1, alleen de rekenkern: `mt-opname-kern.js`, tests in `test/opname-kern.test.js`). Het bouwt voort op "Voorstel opname-JSON v0.2" (OPTIES §7.4) en de besluiten van 31-10. De kern heeft geen DOM en geen netwerk; opslag en scherm komen in latere brokken.

## Uitgangspunten

- **Gemeten maten zijn leidend.** Een schatting uit de foto is een grijs `voorstel` naast de maat en telt nooit als meting.
- **Niets wordt gecorrigeerd of haaks geforceerd.** Elke wand houdt zijn eigen gemeten lengte; de sluitcontrole meldt alleen.
- **Nooit stil verlies.** Een nieuwe meting komt in `historie` van de maat te staan als er al iets was; onbekende velden blijven bij het lezen behouden.
- Eenheden: lengtes in mm. Tijdstippen in ISO 8601.

## Opbouw

```
opname
  schema "mt-opname", versie "0.3", opname_id, project {code}, status (concept | opgeslagen | vrijgegeven), aangemaakt, bijgewerkt
  fotos[]           { id, bestand, ruimte, wand|null, tijd }       alleen een verwijzing; de ruimte staat bij de foto zelf
  ruimtes[]
    id, naam, meubeltype (kast | keuken | badmeubel), werkzone [N|O|Z|W, meerdere mag]
    wanden[]          { id N|O|Z|W, van, naar, maten.lengte }
    plafondpunten[]   { id, plaats, wand?, maten.hoogte }
    diagonalen[]      { id A|B, van, naar, maten.lengte }
    openingen[]       { id, soort raam|deur, wand, definitie, positie_vanaf?, maten.{breedte, hoogte, positie, borstwering, positie_rechts} }
    objecten[]        { id, type, wand, hoek?, naam?, opening?, gezien?, eigen?, herkomst?, maten.{...} }
    bijzonderheden[]  { id, soort, wand, notitie, maten.maat? }
    rondje            { "<wand>|<categorie>": { waarde aanwezig|afwezig|later, tijd } }
```

**Wanden** lopen rond de klok: N van NW naar NO, O van NO naar ZO, Z van ZO naar ZW, W van ZW naar NW. Kijkend naar de wand is `van` de linkerhoek. `positie` van een opening is altijd de afstand vanaf die linkerhoek tot de dagkant; `positie_rechts` is de afstand tot de rechterhoek. Is `positie_vanaf` een opening-id (bijvoorbeeld een penant tussen twee ramen), dan wordt vanaf de dagkant van die opening gemeten. Diagonaal A loopt NW naar ZO, B loopt NO naar ZW.

**Definitie van een opening** (`definitie`): `muursparing`, `dagmaat` of `kozijn-buiten`. Zonder definitie is een breedte of hoogte dubbelzinnig (de meetproef verloor daardoor tot 55 mm); de kern geeft dan een waarschuwing. De referentie (hoek, vloerpeil, zijkanten, boven-onder, opening of object) hoort bij de vraag en wordt door de kern afgeleid.

**Objecttypes:** stopcontact, schakelaar (hoogte, afstand tot hoek, afdekraam), leiding (afstand, diameter, kraanhoogte), radiator (breedte, hoogte, onderkant), vensterbank (diepte, dikte, overstek; zonder gekoppelde `opening` ook hoogte), plint (hoogte, dikte, keuze `blijft` of `gaat-weg`) en overig. Een object buiten de werkzone krijgt alleen vragen als `gezien` op `toch-meten` staat of de opnemer het zelf toevoegde (`eigen`). `gezien` is `klopt`, `niet-aanwezig` of `toch-meten`.

**Bijzonderheden:** stootplint, balk, koof, nis, uit-het-lood, leiding-in-zicht, kabelgoot, anders. Noemen volstaat; geef je er een `maten.maat` bij, dan hoort die bij de extra punten.

## Een maat (punt)

```
{ staat: gemeten | nvt | later | open, waarde: mm | null, keuze?: tekst, bron: disto | hand | null, tijd: ISO | null,
  notitie?, voorstel?: { waarde, bron: "foto-voorstel", pm?, tijd }, historie?: [eerdere standen] }
```

| staat | betekenis |
|---|---|
| gemeten | een echte meting met `bron` `disto` of `hand` en een waarde groter dan 0 (of een geldige `keuze`). Een foto-voorstel is geen meting; staat het toch als bron bij `gemeten`, dan telt het punt als open en volgt een waarschuwing |
| nvt | bewust weggeklikt: voor dit project niet maatvast nodig. Wordt vastgelegd en telt als afgehandeld |
| later | wordt een taak "Nameten: ..." en telt niet als compleet |
| open | nog niets |

## Wat de kern berekent

- **Vragenlijst** (`vragen`): uit de ruimte en de werkzone. Basis: 4 wandlengtes, plafond op één punt, diagonaal A, per opening breedte, hoogte en positie (bij een raam ook borstwering). Werkzone: de positie tot de rechterhoek van de openingen op de werkzone-wanden en alle maten van de objecten op die wanden. Optioneel: diagonaal B. Extra: wat de opnemer toch wil meten of zelf toevoegt, verdere plafondpunten en bijzonderheden met een maat.
- **Tellers** (`tellers`): per emmer `n`, `gemeten`, `nvt`, `later`, `open`, `conflict`, `beantwoord` (gemeten + nvt + later, de teller "x van n") en `compleet` (gemeten + nvt).
- **Sluitcontrole** (`sluitcontrole`): tegenoverliggende wanden maximaal 5 mm verschil; een diagonaal maximaal 10 mm van de verwachte waarde (uit de gemiddelde tegenoverliggende wanden); twee diagonalen onderling maximaal 6 mm. Het resultaat is een lijst controles en conflicten met uitleg, nooit een correctie.
- **Rondje controle** (`rondje`, `zetRondje`): alleen voor de werkzone-wanden, per categorie (deuren en ramen, elektra, water/afvoer/leidingen, verwarming, plinten, afwijkingen) aanwezig, afwezig of later. Niet gekozen is "nog niet bekeken", nooit afwezig.
- **Vrijgeven voor maatwerk** (`vrijgeefCheck`): pas als de werkzone gekozen is, basis, werkzone en extra compleet zijn (later telt niet, nvt wel), er geen conflicten zijn en het rondje gedaan is (een categorie op later blokkeert ook). Opslaan kan altijd (`samenvatting`).
- **Takenlijst** (`takenlijst`): elk later-punt wordt "Nameten: Kamer Joe, Noord: R1 hoogte", met een stabiele sleutel zodat opnieuw opslaan geen dubbele taken geeft. Een categorie van het rondje op later wordt ook een taak.
- **Lezen en migreren** (`lees`): `versie "0.3"` wordt additief aangevuld. Een oudere vorm (v0.2) of een onbekende vorm wordt een nieuwe opname met het volledige origineel onder `_oud`. Een nieuwere versie komt ongewijzigd terug met `alleenLezen: true`. Onbekende staten, bronnen, waarden en werkzone-waarden blijven bewaard in `_staat_oud`, `_bron_oud`, `_waarde_oud` en `_onbekend`.

## Voorbeeld: kamer Joe

Fictieve projectcode, werkzone Oost, deels gemeten. Basis 11 van 21 beantwoord, werkzone 3 van 16. Vrijgeven kan nog niet: er staan punten open en op later, en het rondje is niet af.

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
            "lengte": { "staat": "gemeten", "waarde": 5760, "bron": "disto", "tijd": "2026-11-01T09:30:00.000Z" }
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
            "lengte": { "staat": "gemeten", "waarde": 2903, "bron": "disto", "tijd": "2026-11-01T09:30:00.000Z" }
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
              "voorstel": { "waarde": 780, "bron": "foto-voorstel", "tijd": "2026-11-01T09:30:00.000Z", "pm": 30 }
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
      }
    }
  ],
  "fotos": [
    { "bestand": "kamer-joe-oost-01.jpg", "ruimte": "R1", "wand": "O", "tijd": "2026-11-01T09:30:00.000Z", "id": "F1" },
    { "bestand": "kamer-joe-overzicht.jpg", "ruimte": "R1", "tijd": "2026-11-01T09:30:00.000Z", "id": "F2", "wand": null }
  ]
}
```
