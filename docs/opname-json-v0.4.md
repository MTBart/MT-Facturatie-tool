# Opname-JSON v0.4

Datamodel van de opname-module na brok 3 (rekenkern `mt-opname-kern.js`, tests in `test/opname-kern.test.js` en `test/opname-vorm.test.js`). Het bouwt voort op v0.3 (`docs/opname-json-v0.3.md`, dat blijft de beschrijving van alles wat hier niet verandert: maten, staten, vragenlijst, route, rondje, vrijgave en hash). Dit document beschrijft alleen wat v0.4 toevoegt of anders doet.

## Waarom v0.4

Bart (1-11-2026): "Als je kamer een vorm heeft of een uitstekend stukje wand oid dan moet hij dat wel mee modeleren in de app om een duidelijke plattegrond te krijgen", en: "Nee de vorm moet aanpassen aan de hand van de foto's en dan verduidelijken in verhouding naarmate er meer informatie is." Dus **geen sjabloon (rechthoek of L) bij de start**. De vorm ontstaat uit de foto's en wordt steeds nauwkeuriger:

1. **Fotoronde zonder vast aantal wanden.** Vanaf de toegangsdeur met de klok mee, een foto per wand, tot de gebruiker "kamer rond" kiest (terug bij de eerste wand).
2. **Per wandfoto de vorm aanwijzen.** Op de vloerlijn tik je de knikken; elk stuk tussen twee knikken is recht (standaard), naar voren (uitsprong: schoorsteen, pilaster, koker) of naar achteren (nis, inham).
3. **Schattingen en metingen blijven gescheiden.** Wat uit de foto komt is een `foto-voorstel` (de verhouding op de wand, een standaarddiepte van 300 mm, een geschatte hoek) en telt nooit als meting. Zodra een maat gemeten is, schalen de geschatte delen mee.

## Wat verandert

```
opname.versie "0.4"            (v0.3 wordt bij het lezen additief aangevuld, zie Migratie)
ruimte
  wanden[]                     geordende lijst, met de klok mee; de eerste wand is de wand van de toegangsdeur
    id (W1, W2, ... of de vaste N/O/Z/W van v0.3), van, naar (hoek-id's: H1, H2, ... of NW/NO/ZO/ZW)
    hoek_naar_volgende?        { graden, bron aanname | foto-voorstel | gemeten, tijd, historie? }       binnenhoek aan het eind van deze wand
    foto_vorm?                 { foto, knikken[{ x, y, u }], tussenstukken["recht" | "voor" | "achter"], tijd }
    maten                      zoals in v0.3
  uitsprongen[]?               { id (U1, ...), wand, soort voor | achter, stuk, verhouding{van, tot, bron}, foto{links, rechts}, maten.{breedte, positie, diepte, hoogte} }
  rond?                        false zolang de fotoronde loopt; ontbreekt bij een ruimte met vaste wanden (v0.3) of een gesloten ring
  verwijderd?[]                archief (wanden, uitsprongen, openingen, objecten, bijzonderheden), append-only
```

### Wanden en hoeken

- De lijst `wanden` is de **geordende segmentenlijst**: wand 1, 2, ... met de klok mee. Een ruimte uit de foto's begint zonder wanden (`nieuweRuimte({ wanden: [] })`, `rond: false`); `K.voegWandToe` voegt per foto een wand toe (`W1`, `W2`, ...). Een id wordt nooit hergebruikt, ook niet na `K.verwijderLaatsteWand`.
- Hoeken heten `H1`, `H2`, ...: de hoek aan het begin (`van`) van wand n. De eindhoek van de laatste wand is `H(n+1)` zolang de ronde open is; `K.maakRond` zet die op `H1`. Een ruimte met vaste wanden houdt NW/NO/ZO/ZW.
- **`hoek_naar_volgende`** is de binnenhoek aan het eind van de wand in graden: 90 (standaard, een aanname), 270 (inspringende hoek, bijvoorbeeld een L-vorm) of elke andere waarde (schuin). `K.zetHoek` zet hem; de bron is `aanname` voor 90 en 270, `foto-voorstel` voor een eigen schatting en `gemeten` als je hem gemeten hebt. De vorige stand blijft in `historie`. Ontbreekt het veld, dan is de hoek 90 en een aanname.
- **Kompaslabels** (noord, oost, ...) horen alleen bij de vaste wanden van v0.3. Nieuwe wanden heten "Wand 1", "Wand 2", ...

### Uitsprongen en nissen

- `foto_vorm.knikken` zijn de op de vloerlijn aangetikte punten van de wandfoto: `x`, `y` als fractie van de foto (0 tot 1) en `u` = waar op de wand (0 tot 1, volgens de homografie van de vier wandhoeken). Minstens twee, van links naar rechts, binnen de wand. Elk **stuk tussen twee knikken** heeft een vorm in `tussenstukken`: `recht`, `voor` of `achter`.
- Een stuk `voor` of `achter` is een **uitsprong** (`soort: voor`) of **nis** (`soort: achter`) in `ruimte.uitsprongen`. `stuk` is de plek in `tussenstukken`; `verhouding` is `{ van, tot }` als fractie van de wandlengte (bron `foto-voorstel`); `foto` bewaart de twee knikken in fotocoördinaten.
- Een uitsprong **in de hoek** is geen tussenstuk. Maak er een eigen wand van met een hoek van 90 of 270 graden: de plattegrond is dan gewoon een veelhoek met meer hoeken.
- **Vragen.** Breedte, positie (vanaf de linkerhoek, kijkend naar de wand) en diepte (haaks op de wand) zijn basis; de hoogte hoort bij de werkzone-wanden. De route vraagt ze van links naar rechts, na de wandlengte en voor de openingen.
- **Voorstel.** De kern rekent het voorstel bij het lezen uit: breedte en positie uit de verhouding maal de **gemeten** wandlengte (zolang de wandlengte niet gemeten is, is er geen voorstel in mm, alleen de verhouding), en de diepte als standaardschatting van 300 mm (`K.UITSPRONG_DIEPTE_STANDAARD`). Alles heeft `bron: "foto-voorstel"`. Het voorstel staat niet in het bestand en telt niet mee in de hash; een gemeten maat is altijd leidend.
- `K.zetWandVorm` houdt de uitsprongen in de pas met de knikken. Verschuift een knik, dan blijft de uitsprong (en zijn maten) bij hetzelfde stuk staan. Wordt een stuk recht, dan gaat de uitsprong met zijn maten naar `ruimte.verwijderd`.

### De plattegrond (`K.plattegrond`)

Afgeleid, niet opgeslagen. Geeft de hoekpunten in mm (x naar rechts, y omlaag, eerste wand langs de x-as, de ruimte rechts van de looprichting), per wand de lengte en of die gemeten is, de uitsprongen met hun vier hoekpunten, de contour (wanden, zijkanten en voorkanten van uitsprongen) en `schatting`.

- Gemeten wandlengtes zijn vast. Een onbekende lengte wordt een **schatting (grijs)**: de standaard, de tegenoverliggende wand of het gemiddelde, en bij een ruimte met alleen haakse hoeken zo gekozen dat de rondgang sluit. De kern schrijft zo'n schatting nooit als maat weg.
- Een uitsprong die alleen als verhouding bekend is, volgt de wandlengte: eerst de geschatte lengte uit de tekening, na de meting de gemeten lengte. Een gemeten breedte, positie of diepte is leidend; de rest blijft een verhouding.
- Een ronde die nog niet gesloten is, wordt als open lijn getekend.

### Sluitcontrole met N wanden (`K.vorm`, `K.sluitcontrole`)

Drie gescheiden uitkomsten in `vorm.bepaling` (brok 3b, ChatGPT-review 043; een lengte bewijst geen richting en één diagonaal bewijst niet alle aangenomen hoeken):

| bepaling | betekenis | `vorm.status` | tekening |
|---|---|---|---|
| `getekend` | de wanden sluiten onder aangenomen hoeken (of er is nog te weinig): een schatting | `onvoldoende-bepaald` of `onverifieerd` | gestippeld |
| `bepaald` | geometrisch bepaald: alle hoeken gemeten/bevestigd (90 of 270 met winkelhaak of driehoek) met alle lengtes, óf N-3 onafhankelijke interne diagonalen (een triangulatie) | `onverifieerd` | vast |
| `gecontroleerd` | bepaald én een extra controlemaat klopt | `consistent` | vast |

- **Vier wanden zonder inspringende hoek**: vier zijden en één diagonaal leggen de vierhoek vast (`bepaald`); de tweede diagonaal (10 mm) controleert (`gecontroleerd`). Zonder diagonaal `getekend`.
- **Andere vormen** (drie, vijf, zes, ... wanden, of een inspringende hoek): een rondgang langs de wanden met de binnenhoeken. Getoetst wordt:
  - **richtingssluiting**: de binnenhoeken tellen op tot (n-2) x 180 graden (`vorm.hoeksom`); anders `inconsistent`. Is een hoek aangenomen, dan staat er: sluit niet bij de aangenomen hoeken, meet een controlehoek; er wordt niet beweerd dat een wandlengte fout is;
  - **positiesluiting**: de vectorsom (`vorm.sluitfout`) is hoogstens 10 mm;
  - **topologie**: geen kruising, geen hoekpunt op een andere wand, geen wanden over elkaar (collineair) of teruggevouwen (marge 1 mm);
  - **gereconstrueerde hoeken** (`vorm.hoeken_gereconstrueerd`) tegen de ingevoerde hoeken.
- **Diagonalen**: alleen tussen niet-aangrenzende hoeken. Een diagonaal die een wand is (ook uit een import) telt niet (`vorm.genegeerd`, waarschuwing `diagonaal-is-wand`, melding bij `K.lees`); een herhaling van dezelfde twee hoeken telt niet; een diagonaal die door de buitenruimte loopt (concave vorm) wordt wel vergeleken maar bepaalt de vorm niet (`controles[].binnen`, `telt`). `bepaald` vraagt N-3 diagonalen die elkaar niet kruisen.
- **De volgende maat** (`vorm.volgende`, `{ soort, van, naar, tekst }`): telkens één: een diagonaal binnen de ruimte die de gekozen diagonalen niet kruist, een controlemaat of een controlehoek.
- **Haaksheid**: `K.hoekUitDriehoek(a, b, c)` en `K.zetHoekDriehoek` (meet a en b vanaf de hoek langs de wanden en c ertussen; haaks binnen 0,5 graad wordt 90 of 270 graden met bron `gemeten`; de drie maten staan bij de hoek in `hoek_naar_volgende.driehoek`). `K.haaksheidsVoorstel` geeft de nog aangenomen hoeken aan de uiteinden van de werkzone-wanden.
- **Schuin**: een hoek die niet 90 of 270 is en niet `gemeten` is, maakt de vorm **onvoldoende bepaald**. Bij vier wanden bepaalt een gemeten diagonaal de hoeken zelf.
- Zolang `rond: false` is de vorm altijd `onvoldoende-bepaald`.
- **Diagonalen A en B** bestaan alleen bij precies vier wanden. Komt er een wand bij, dan verdwijnt een A of B zonder meting uit de vragen; een gemeten diagonaal blijft als optionele controle staan. Een leeg restant van A of B wordt bij `K.voegDiagonaalToe` vervangen.
- `K.vormLabel(vorm)` geeft de tekst voor elk scherm, bijvoorbeeld "Lengtes gemeten; model onder hoekaanname; controle C klopt".

### Bronnen van een uitsprong of nis (brok 3b)

Drie gescheiden bronnen per maat (`K.WAARDE_BRONNEN`, `uitsprongWaarden`, `plattegrond().uitsprongen[].bron`): `gemeten` wint altijd; `foto-interpretatie` (breedte en positie uit de verhouding op de wand maal de gemeten wandlengte; parallax-gevoelig, want de voorkant van een uitsprong ligt buiten het wandvlak van de homografie); `bronstandaard` (diepte 300 mm). Alleen gemeten telt als maat. Een nieuwe kalibratie van de wandhoeken verandert alleen de foto-interpretatie.

### Foto's (brok 3b)

`foto.soort`: ontbreekt (hoofdfoto van een wand), `closeup` (bij een onderdeel, `wand: null`) of `extra` (nog een foto van hetzelfde vlak; hoort bij een wand die al een hoofdfoto heeft en maakt nooit een wand: `K.wandFoto`, `K.extraFotos`).

### Vrijgave en kern (brok 3b)

`vrijgave.kern` bewaart de kernversie waarmee is vrijgegeven. Een vrijgave uit v0.3 (zonder dat veld) blijft geldig, maar `K.vrijgaveKern` meldt dan "Gevalideerd met oude kern (v0.3)".

### Export en terugzetten (brok 3b, `mt-opname-export.js`)

Een zip met `opname.json` (schema `mt-opname-export`, formaat 1: de opname, layout, instellingen, per foto `id`, `pad`, `sha256`, afmetingen en of hij nog in de opname staat), `fotos/...` (alle foto's, ook de gearchiveerde en losse beelden) en `LEESMIJ.txt`. Terugzetten controleert de zip en elke sha256 voordat er iets wordt geschreven. Bestaat de `opname_id` al met een andere inhoud, dan komt de opname als kopie (`<id>-hersteld-...`, met `_hersteld_van`); met dezelfde inhoud gebeurt er niets.

### Onwaarschijnlijk, onmogelijk en bevestigd

- Er is geen vaste ondergrens voor een maat (een voeg of plintdikte kan klein zijn). Onwaarschijnlijke maar mogelijke maten (wandlengte buiten 300 tot 15000 mm, plafond buiten 2000 tot 5000 mm, een wand waarvan de lengte onder, midden en boven meer dan 100 mm verschilt) staan in `K.waarschuwingen` met code `onwaarschijnlijk` en blokkeren het vrijgeven tot ze bevestigd zijn: `K.bevestigOnwaarschijnlijk` zet `ruimte.bevestigingen[pad] = { waarde, tijd }`. De bevestiging geldt voor precies die waarde.
- Geometrisch onmogelijke combinaties (een opening of uitsprong buiten de wand, overlappende uitsprongen) blokkeren zonder bevestiging (reden `onmogelijk`).

### Vrijgeven, hash en scope

Alles uit v0.3 blijft gelden. Nieuw: vrijgeven kan pas als de ronde rond is en er minstens drie wanden zijn (`ronde`, `wanden`). De scope noemt `aantal_wanden`, `uitsprongen` en `veelhoek`. De hash bestrijkt de nieuwe velden (hoeken, knikken, uitsprongen) zoals alle inhoud; tijdstippen, historie en voorstellen tellen niet mee.

## Migratie v0.3 naar v0.4

Additief en zonder verlies (`K.lees`):

- `versie` wordt `0.4`; de oude waarde staat in `_versie_oud`. De hash behandelt een opname met `_versie_oud` als de oorspronkelijke versie, zodat **een bestaande vrijgave geldig blijft** (getest met een echte vrijgave uit de v0.3-kern: `test/fixtures/opname-v03-vrijgegeven.json`).
- De vier vaste wanden N/O/Z/W blijven staan met hun hoeken NW/NO/ZO/ZW; er komen geen velden bij. `hoek_naar_volgende` ontbreekt (90, aanname), `uitsprongen` ontbreekt, `rond` ontbreekt (een gesloten ring).
- Alles wat v0.3 vroeg, vraagt v0.4 ook (17 basis, 25 werkzone voor kamer Joe met werkzone Oost). De 72 oorspronkelijke kerntests zijn ongewijzigd groen, op de drie tests die de versie zelf controleren na.
- Versies ouder dan 0.3 blijven volledig bewaard onder `_oud` (zoals voorheen); een nieuwere versie dan 0.4 wordt alleen gelezen.
- Een opname die in de app is opgeslagen heeft naast de kern-opname nog `layout` (waar de wandhoeken op de foto zitten, waar onderdelen getekend staan) en `instellingen` (plint). Dat is app-gegevens, geen kern, en onveranderd.

## Voorbeeld: een L-vormige kamer uit zes foto's

Fictieve projectcode. Zes wanden, wand 3 eindigt in een inspringende hoek (270 graden), werkzone is wand 6, op wand 6 zit een uitsprong (U1) met een gemeten diepte; wand 6 is nog niet gemeten, dus de plattegrond schat die en blijft grijs.

```json
{
  "schema": "mt-opname",
  "versie": "0.4",
  "opname_id": "OPN-TEST-004",
  "project": {
    "code": "TEST-001"
  },
  "status": "concept",
  "aangemaakt": "2026-11-01T10:00:00.000Z",
  "bijgewerkt": "2026-11-01T10:00:00.000Z",
  "ruimtes": [
    {
      "id": "R1",
      "naam": "Testkamer L-vorm",
      "meubeltype": "kast",
      "werkzone": [
        "W6"
      ],
      "wanden": [
        {
          "id": "W1",
          "van": "H1",
          "naar": "H2",
          "maten": {
            "lengte": {
              "staat": "gemeten",
              "waarde": 6000,
              "bron": "disto",
              "tijd": "2026-11-01T10:00:00.000Z"
            }
          }
        },
        {
          "id": "W2",
          "van": "H2",
          "naar": "H3",
          "maten": {
            "lengte": {
              "staat": "gemeten",
              "waarde": 2000,
              "bron": "disto",
              "tijd": "2026-11-01T10:00:00.000Z"
            }
          }
        },
        {
          "id": "W3",
          "van": "H3",
          "naar": "H4",
          "maten": {
            "lengte": {
              "staat": "gemeten",
              "waarde": 3000,
              "bron": "disto",
              "tijd": "2026-11-01T10:00:00.000Z"
            }
          },
          "hoek_naar_volgende": {
            "graden": 270,
            "bron": "aanname",
            "tijd": "2026-11-01T10:00:00.000Z"
          }
        },
        {
          "id": "W4",
          "van": "H4",
          "naar": "H5",
          "maten": {
            "lengte": {
              "staat": "gemeten",
              "waarde": 2000,
              "bron": "disto",
              "tijd": "2026-11-01T10:00:00.000Z"
            }
          }
        },
        {
          "id": "W5",
          "van": "H5",
          "naar": "H6",
          "maten": {
            "lengte": {
              "staat": "gemeten",
              "waarde": 3000,
              "bron": "disto",
              "tijd": "2026-11-01T10:00:00.000Z"
            }
          }
        },
        {
          "id": "W6",
          "van": "H6",
          "naar": "H1",
          "maten": {},
          "foto_vorm": {
            "foto": "F6",
            "knikken": [
              {
                "x": 0.3,
                "y": 0.88,
                "u": 0.3
              },
              {
                "x": 0.5,
                "y": 0.87,
                "u": 0.5
              }
            ],
            "tussenstukken": [
              "voor"
            ],
            "tijd": "2026-11-01T10:00:00.000Z"
          }
        }
      ],
      "plafondpunten": [
        {
          "id": "P1",
          "plaats": "midden",
          "maten": {}
        }
      ],
      "diagonalen": [
        {
          "id": "A",
          "van": "H1",
          "naar": "H3",
          "maten": {}
        },
        {
          "id": "B",
          "van": "H2",
          "naar": "H4",
          "maten": {}
        }
      ],
      "openingen": [
        {
          "id": "D1",
          "soort": "deur",
          "wand": "W1",
          "maten": {},
          "definitie": "muursparing",
          "naam": "toegangsdeur"
        }
      ],
      "objecten": [],
      "bijzonderheden": [],
      "rondje": {},
      "rond": true,
      "toegangsdeur": "D1",
      "uitsprongen": [
        {
          "id": "U1",
          "wand": "W6",
          "soort": "voor",
          "maten": {
            "diepte": {
              "staat": "gemeten",
              "waarde": 420,
              "bron": "hand",
              "tijd": "2026-11-01T10:00:00.000Z"
            },
            "hoogte": {
              "staat": "later",
              "waarde": null,
              "bron": null,
              "tijd": "2026-11-01T10:00:00.000Z",
              "notitie": "Ladder nodig"
            }
          },
          "stuk": 0,
          "verhouding": {
            "van": 0.3,
            "tot": 0.5,
            "bron": "foto-voorstel"
          },
          "foto": {
            "links": {
              "x": 0.3,
              "y": 0.88
            },
            "rechts": {
              "x": 0.5,
              "y": 0.87
            }
          },
          "tijd": "2026-11-01T10:00:00.000Z"
        }
      ]
    }
  ],
  "fotos": [
    {
      "bestand": "testkamer-wand-1.jpg",
      "ruimte": "R1",
      "wand": "W1",
      "tijd": "2026-11-01T10:00:00.000Z",
      "id": "F1"
    },
    {
      "bestand": "testkamer-wand-2.jpg",
      "ruimte": "R1",
      "wand": "W2",
      "tijd": "2026-11-01T10:00:00.000Z",
      "id": "F2"
    },
    {
      "bestand": "testkamer-wand-3.jpg",
      "ruimte": "R1",
      "wand": "W3",
      "tijd": "2026-11-01T10:00:00.000Z",
      "id": "F3"
    },
    {
      "bestand": "testkamer-wand-4.jpg",
      "ruimte": "R1",
      "wand": "W4",
      "tijd": "2026-11-01T10:00:00.000Z",
      "id": "F4"
    },
    {
      "bestand": "testkamer-wand-5.jpg",
      "ruimte": "R1",
      "wand": "W5",
      "tijd": "2026-11-01T10:00:00.000Z",
      "id": "F5"
    },
    {
      "bestand": "testkamer-wand-6.jpg",
      "ruimte": "R1",
      "wand": "W6",
      "tijd": "2026-11-01T10:00:00.000Z",
      "id": "F6"
    }
  ]
}
```
