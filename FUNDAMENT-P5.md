# FUNDAMENT P5: materiaal als voorwaarde

Branch `planning-p5` (op `planning-f1`). Dit document beschrijft het ontwerp, zodat een reviewer weet wat bedoeld is.

## Wat het doet
- Een bestelregel kan aan een taak hangen (`taak_id`) en heeft een verwachte leverdatum (`verwacht_op`, ymd) met bron (`verwacht_bron`, nu alleen `hand`).
- Verwacht is rood als de datum na de geplande start van de taak ligt en de regel nog niet geleverd is.
- Een taak toont "wacht op N regel(s)" zolang er open materiaal is (status nodig of besteld).
- Een taak met open materiaal gaat niet stil naar Bezig of Klaar: eerst een bevestiging ("Toch starten?").
- Zichtbaar in: taakpaneel (sectie Materiaal), bestellijst "Per regel" en project "Te bestellen" (kolommen Taak en Verwacht), bord en tijdlijn (icoon).

## Gegevensmodel
- `P.BESTEL_NIEUW_VELDEN = ['taak_id','verwacht_op','verwacht_bron']`, toegevoegd aan `P.BESTEL_VELDEN`. De basisvelden blijven gelijk, zodat migratiehashes stabiel blijven.
- Velden krijgen per veld een stempel (`_vs`), zoals de andere bestelvelden, via `bestelVeldStempel` en `_blWijzig`.
- Schemadrempel: `P.SCHEMA` en `PROJ_SCHEMA` zijn 7; `mt_bestellijst_v2` zit in `_PROJ_SCHEMA_SLEUTELS`. Apps met schema lager dan 7 mogen de bestellijst niet meer schrijven zodra de teller 7 is. Oude v2.21-apps kennen de poort niet: operationele voorwaarde (iedereen herlaadt, dan `schema_uitgerold`), net als bij F1.

## Samenvoegen met oude apps ("ongemoeid")
`bestelSamen` krijgt `ongemoeid = nieuwe velden`. Een nieuw veld zonder stempel in een record dat wel stempels heeft telt als "niet aangeraakt" en wint nooit van een gestempelde waarde. Zo kan een oude app (die de velden niet kent en alleen oude velden stempelt) een koppeling of datum niet terugzetten of wissen.

## Telefoon
`P.bestelNieuwSchrijf` (mt-vandaag.js `V.melden`) gebruikt dezelfde velden. `meldingBestel` accepteert `taak_id`. De route kreeg `voorWrite` met dezelfde schemacontrole als de takenroute. Op de telefoon vraagt Bezig/Klaar met open materiaal een bevestiging, op basis van een verse lezing van `mt_bestellijst_v2.json`.

## Functies in mt-planning.js
`bestelHoortBij`, `bestelVanTaak`, `bestelVerwacht`, `bestelIndexTaak`, `bestelVanTaakIdx`, `taakMateriaal` (telt open, laat, verlopen, zonder datum; `tekst`), `materiaalBevestigTekst`, `materiaalVraagBevestiging` (alleen van todo/wacht naar bezig/klaar met open > 0).

## Randgevallen
- Taak verwijderd of project gewijzigd: de koppeling wijst nergens heen; `bestelHoortBij` controleert project en taak, en de regel blijft gewoon op de lijst.
- Geleverde regel: nooit rood, telt niet als open.
- Datum in het verleden en niet geleverd: `verlopen`, aparte teller.
- Koppelen kan alleen aan een taak van hetzelfde project (`bestelTaakZet` controleert), datum alleen geldig ymd (`bestelVerwachtZet`).
- Rol: `ROL_BESTEL_ALLES` voor koppelen en datum; anderen zien alleen.
- Bundelweergave van de bestellijst blijft ongewijzigd (telt regels op); kolommen staan in "Per regel".

## Tests
`b-p5-harness.js` (node), `rook-p5.js` (browser), plus de volledige suite, check-sinks en de laadtest.
