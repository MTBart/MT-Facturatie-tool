# VOORTGANG P7b: banen, rollen zonder naam, heatmap, botsing en beschikbaarheid

Tak `capaciteit-p7b`, vanaf `capaciteit-d0`. **Let op de basis:** `capaciteit-d0` bevatte P3b (`mt_planinrichting`) nog niet. P3b zit wel in `integratie-v2230`, die al mijn C1 t/m D1 bevat. Daarom is `integratie-v2230` eerst in deze tak gemerged (versieparameters uit de integratie overgenomen, conflicten alleen in `v2.html` en `mobiel.html`) en pas daarna is P7b gebouwd. D0 (agenda-fundament) zit er ook in.

## Wat Bart ziet
- **Banen** onder de personen: **CNC**, **Afwerken** en **Montageploeg**, met de markering "baan · 8 u per dag". Eerst alleen afgeleid: welke taken (sleutel `cnc`, een woord in de naam, het station uit P3b of een activiteit) op welke dag op die baan lopen, met hun uren tegenover de capaciteit van de baan. Afwerken hoort bij het station `spuiten` (K4: Afwerken is het label). De getallen zijn de optelsom van de items van de personen (niets dubbel, niets erbij) en staan in dezelfde belastingsbadge ("u te veel", "u over") als bij personen. Een baan is alleen kijken: de blokken zijn niet te slepen en je kunt niets op een baan loslaten.
- **Admin ▸ Planning inrichten** heeft twee nieuwe secties: **Banen** (uren per dag, bij welke stations of activiteiten een baan hoort, woorden in de taaknaam, onderhoud en vrije dagen met reden) en **Rollen zonder naam**.
- **Heatmap**: knop **Bezetting** (naast Geklokt, bij Sync nu). Eén schaal van licht naar donker groen voor 0 tot 100% (niets, tot 25%, 50%, 75%, 100%) en rood met arcering voor overboekt (dus niet alleen kleur), met legenda; voor personen, rollen en banen, in week, maand, kwartaal en (als streepje bovenaan elke dag) in de uurweergave. Dezelfde getallen als de belasting uit C2. Onthouden en in de link (`hm=1`).
- **Placeholder**: een rol zonder naam (bv. "Inhuur monteur", eigen uren per dag) is een eigen rij tussen de personen en de banen, met de markering "rol zonder naam" en een knop **Zet om…**. Taken toewijzen kan met slepen (dezelfde veilige route). Omzetten naar een echte persoon verplaatst alle taken (via de taakroute, met controle op wat een ander intussen wijzigde) en alle planblokken (planblokroute) en meldt wat niet lukte; verwijderen van de rol kan pas als er niets (meer) aan hangt.
- **Botsing**: sleep je (of kies je via het menu) iets naar een overboekte persoon of rol, dan krijg je een keuze: **Toch boeken**, **Later** (eerstvolgende dag met genoeg ruimte), **Ander moment kiezen…** (het bestaande keuzemenu) of **Op de wachtlijst** (status Wacht met reden, met Ongedaan maken; verschijnt in de takenbak Wacht). Wegklikken doet niets. Geen stille blokkade en geen stille overboeking.
- **Beschikbaarheidsbalk**: tijdens het slepen staat bij de muis "Naam · dag", een vulbalk en de vrije uren van het doel (of "te veel", rood), inclusief wat dit erbij zet.

## Gegevens en veiligheid
- `mt_planinrichting` kreeg de soorten `baan` en `rol` met de gestempelde velden `uren`, `stations`, `activiteiten`, `sleutels`, `vrij` (per veld een stempel, samenvoegen per record, tombstone bij verwijderen; onzinwaarden vallen terug op de standaard). Standaardbanen gelden zolang er geen eigen baanrecords zijn.
- **Schemadrempel:** `P.SCHEMA` en `PROJ_SCHEMA` van 11 naar **12**, en `mt_planinrichting` zit nu in `_PROJ_SCHEMA_SLEUTELS`: een oudere app schrijft het bestand niet meer zodra `schema_min` op 12 staat. Operationele voorwaarde zoals bij F1 en P5: iedereen herlaadt, daarna `schema_uitgerold = 12`.
- Een rol is voor de Capaciteit een pseudo-teamlid (`capTeam()`, `capWerkuren()`), ook in de controle van de planroutes (`_capCtx`, `_capTaakCtx`). Een oudere app (zonder deze versie) kent `rol-<k>` niet: een taak van een rol komt daar in "Niet toegewezen".
- Niets nieuws schrijft rechtstreeks: de wachtlijst en het omzetten gaan via `tpWijzig`, blokken via de bestaande planblokroute.

## Tests
`b-p7b-harness.js` (rekenwerk: banen, rollen, opslag per veld, schaal), `rook-p7b.js` (browser), plus de volledige regressie `alles-p7b.ps1`, `check-sinks` en de laadtest.

## Codex-review (verplicht) en wat ermee gedaan is
Acht bevindingen. Overgenomen en met een test vastgelegd: (2) "Zet om" schreef bij meerdere personen op een taak een lijst in het veld `toegewezen`: zo'n taak wordt nu niet omgezet maar gemeld ("pas de personen in het taakpaneel aan"); (3) de omzetting houdt één vergrendeling (`S.bulk`) over taken én blokken, geen andere sleepactie ertussen; (4) de wachtlijst bestaat alleen voor een taak zonder dagen (uit Ongepland): een al ingeplande taak zou anders blijven meetellen terwijl hij "wacht"; die krijgt drie keuzes; (5) een baan kan nu ook op sleutels van de standaardketen ingericht worden; (6) rollen tonen nu hun naam in het taakpaneel, het Bord, de Tijdlijn en het planblokpaneel (die kregen `capTeam()`); (7) "Later" zoekt alleen in beeld; (8) vaste volgorde van de criteria voor een baan (sleutel, activiteit, station, en pas dan een woord in de naam) en een woord telt als heel woord. Ook gevonden bij het nalopen: een rol met planblokken telt nu als "in gebruik" bij verwijderen.
Niet overgenomen: **(1) "een taak met meerdere personen telt dubbel op de baan"**. De uren van de taak zijn al over de personen verdeeld (de aandelen in `taakVerdeling`); de baan telt de som van die aandelen en dus de taak één keer. Dat staat nu met een echte test met twee personen (8 u op de baan, niet 16 u).
Bekend en bewust open: rollen tonen in Mijn werk, Vandaag, Uren, de tv en de telefoon nog hun technische slug (`rol-…`), omdat die lezers alleen `MT_TEAM` kennen; een app zonder deze versie kent de rol ook niet (de taak staat daar in "Niet toegewezen").

## Gewijzigde bestaande tests (met reden)
`rook-c2` (telt alleen de personenrijen, de banen zijn er nu ook), `rook-c3` (sleept naar een volle Maarten: kiest eerst "Toch boeken" in de nieuwe vraag), `b-pi-harness` (vijf lijsten in plaats van drie) en de legacy-vergelijking (zonder baanrijen). `rook-p4a` (tijdlijn-melding) faalt ook zonder P7b op de gemergde basis.

## Open punten
- De baancapaciteit is een aanname van 8 u per dag voor alle drie (geen verzonnen ploeggrootte); Bart stelt hem in bij Planning inrichten.
- Banen zijn bewust alleen afgeleid (geen eigen blokken, geen doel om op los te laten). Plannen op een baan is een volgende keuze.
- De botsing-inschatting (`N.toevoeging`) is een raming: een taak telt als zijn raming gedeeld over zijn dagen (op de eerste dag hoogstens de dagcapaciteit).
