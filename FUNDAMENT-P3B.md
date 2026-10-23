# FUNDAMENT P3b: borden zelf inrichten (stations, fases, activiteiten)

Branch `planning-p3b` (op `planning-p5`). Dit document beschrijft het ontwerp, zodat een reviewer weet wat bedoeld is.

## Wat het doet
- Stations (Stroom), fases en activiteiten hebben een vast id (`k`) en een label. De beheerder maakt ze aan, hernoemt ze, ordent ze en verwijdert ze. Een hernoeming verandert alleen het label.
- Per activiteit kies je het station, de soort uren (kantoor of werkplaats) en optioneel de uursoort van de calculatie. Dat vervangt de vaste `stationVan`-mapping; de sleutels van de standaardketen blijven als terugval.
- Het standaardstation "spuiten" heet "Afwerken" (K4); alleen het label, het id blijft.
- Een klik op een vakje in Bord > Stroom toont de taken van dat station voor dat project (elke taak opent het taakpaneel).
- Beheer: Admin > Planning inrichten (alleen Bart en beheer/eigenaar). Op het bord kan alleen die beheerder een kolomkop hernoemen, "+ kolom" kiezen, kolommen slepen en verwijderen; voor anderen tekent de component gewone tekst.

## Gegevensmodel: `mt_planinrichting`
- Eén lijst records `{ id: 'station:montage', type, k, label, volgorde, [station, soort, uursoort] (activiteit), [namen] (fase) }`.
- Per veld een stempel (`_vs`) zoals bij de taken (`stempelMet`), samenvoegen per record (`lijstSamenMet`), verwijderen = tombstone en terugzetten kan (het nieuwste record beslist; geen `verwijderWint`).
- Zonder bestand, of zonder records van een soort, geldt de standaard (`P.inrichtStandaard`): dezelfde stations, fases en activiteiten als voor P3b.
- Strikt lezen: een verkeerde vorm of kapotte JSON is een fout, nooit stil een lege lijst.
- Opslag in v2 (`planInrichtOpslaan`): lokaal schrijven, daarna `_SP.write` met ETag en samenvoeger; "opgeslagen" alleen als SharePoint het bevestigt, anders melding en lokaal bewaard. Ongedaan maken zet alleen de records terug die die actie raakte; wat een ander intussen wijzigde blijft staan.
- Rechten: `planInrichtMag()` = `admMagActiviteit()` (Bart, beheer/eigenaar). Controle in de app; SharePoint kent geen rechten per bestand.

## Fases: naam blijft, id erbij
- Taken bewaarden hun fase als NAAM (`taak.fase`). Nieuw: `taak.fase_id` (gestempeld taakveld, zonder conflictmelding). `fase` blijft de naam voor oude apps.
- `P.faseVan(taak)`: het id als dat nog bij de naam past; wijzigt een oude app alleen de naam, dan wint de naam; anders de naam via het label of een eerdere naam. Een hernoeming zet de oude naam in `namen` (alias), zodat taken met alleen die naam bij dezelfde fase blijven.
- Schrijven gaat via `P.faseVelden(naam)` (naam + id) in de bestaande routes: `zetVeld` in mt-planverplaats.js (taakpaneel, bord, tabel), `bordNieuweTaak`, `sjabloonToepassen`.
- Een eigen fase van een project (niet in de inrichting) blijft een naam zonder id.
- Migratie: `P.faseMigratiePlan` is een dry-run; `planFaseMigratieUitvoer` schrijft taak voor taak via `tpWijzig` (vers lezen, ETag, stempels) en leest achteraf terug. Alleen op verzoek (knop in Admin), nooit automatisch.

## Activiteiten
- Taken verwijzen al naar een stabiele sleutel (`taak.activiteit`); `P.ACTIVITEITEN` wordt ter plekke bijgewerkt uit de inrichting, zodat alle bestaande lezers (projectmeter, sjablonen, taakpaneel) dezelfde verwijzing houden.
- Koppelingen die zijn nagelopen: de projectmeter en sjabloonbudgetten gebruiken `soort` (kantoor of wp); de calculatie koppelt uursoorten via `activiteitUitUursoort` (nu eerst de uursoort die bij een activiteit is ingesteld, dan de vaste koppeling, alleen naar een activiteit die bestaat); tarieven zijn per persoon, niet per activiteit; Toggl, kleuren, de tv en Mijn werk zijn niet aan activiteiten gekoppeld.
- Nog niet gedekt: de naamherkenning (`SLEUTELWOORDEN`) stelt alleen de standaardactiviteiten voor; een nieuwe activiteit krijgt geen voorstel uit de taaknaam.

## Verwijderen
- Alleen als er niets meer aan hangt. Hangt er wel iets aan: kiezen waar het heen gaat (ook "Geen fase" of "Niet ingedeeld"), bevestigen, dan eerst de taken verplaatsen (per taak via `tpWijzig`), daarna het record verwijderen. Mislukt een taak, dan worden de al verplaatste taken teruggezet en wordt er niets verwijderd. Na het verplaatsen wordt de gezamenlijke stand opnieuw gelezen en gecontroleerd (hooguit drie rondes) voordat het record een tombstone krijgt. Een station: de activiteiten krijgen het gekozen station in dezelfde schrijfactie.
- Een activiteit of fase die nog in een opgeslagen projectsjabloon staat kan niet verwijderd worden; de melding noemt het sjabloon.
- Ongedaan maken zet het record terug en daarna de taken (`tpWijzigHerstel`, alleen als niemand ze intussen wijzigde).

## Oude clients en schema
- `P.SCHEMA` en `PROJ_SCHEMA` zijn 8; `mt_project_taken_v2` blijft in de schemasleutels: een oudere app schrijft de takenlijst niet meer zodra de drempel op 8 staat. v2.21-apps kennen de poort niet: operationele voorwaarde (iedereen herlaadt, daarna `schema_uitgerold=8`), zoals bij F1 en P5.
- Een oude app leest `mt_planinrichting` niet: hij toont de standaardnamen ("Spuiten") en schrijft taken zonder `fase_id`; de naam-regel hierboven vangt dat op.
- De tv leest `mt_planinrichting.json` (alleen lezen) en toont de namen; onleesbaar = de vorige of de standaardinrichting.

## Tests
`b-pi-harness.js` (node, jsdom voor de component), `rook-p3b.js` (browser), plus de volledige suite, check-sinks en de laadtest.
