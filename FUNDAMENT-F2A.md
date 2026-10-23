# FUNDAMENT F2a: afhankelijkheden op MS Project-niveau, deel 1

Branch `planning-f2a` (op `planning-b12`). Dit document beschrijft het ontwerp, zodat een reviewer weet wat bedoeld is. Maatstaf: minimaal MS Project, Wrike en Smartsheet (keuzeplan, markt-radar 01-planning §A).

## Wat het doet
- Alle vier de typen: EB (einde-naar-begin, `FS`), BB (begin-naar-begin, `SS`), EE (einde-naar-einde, `FF`) en BE (begin-naar-einde, `SF`).
- Lead: een negatieve wachttijd (voorsprong), alleen bij procestijd.
- Twee soorten wachttijd: *procestijd* in werkdagen (standaard) en *levertijd* in kalenderdagen (bijvoorbeeld de levertijd van materiaal; niet negatief).
- Een eigen veilige schrijfroute voor afhankelijkheden (toevoegen, wijzigen, verwijderen, kringcontrole, Ongedaan maken, conflictmelding).
- Het taakpaneel kiest type, wachttijd en soort; de Tijdlijn tekent de lijnen per type met de afkorting bij de pijl; de projecttabel kiest ook type en soort.

## Gegevensmodel
- Een afhankelijkheid: `{ id, project_id, van_taak, naar_taak, type, lag_dagen, lag_soort, status }`. Nieuw is alleen `lag_soort` ('levertijd'; bij procestijd ontbreekt het veld, zodat een gewone EB-koppeling gelijk blijft aan die van vroeger). `DEP_VELDEN` kent het veld: gestempeld per veld, samenvoegen met `afhSamen` (twee apparaten die type en wachttijd van dezelfde koppeling wijzigen: beide blijven).
- Een onbekend type of onleesbare lag valt terug op EB en een veilige wachttijd. `lag_dagen` ligt tussen -365 en 365 (`P.depSpec`).
- Schema 10; `mt_project_afhank` zit nu in de schemasleutels, zodat een oudere app de afhankelijkheden niet meer schrijft zodra de drempel op 10 staat. Een v2.21/v2.22-app die niet weet van de drempel (operationele voorwaarde: iedereen herlaadt, daarna `schema_uitgerold=10`) schrijft alleen EB en zou `lag_soort` negeren.

## Rekenregels (`mt-planning.js`)
Alle rekenregels gebruiken twee hulpfuncties, `startEis` (de vroegste start van de opvolger) en `eindEis` (het laatste eind van de voorganger). Met duur dN van de opvolger en dV van de voorganger, es/ef = begin/eind van de voorganger, L = wachttijd:
- EB: opvolger start op `ef + 1 werkdag + L` (een mijlpaal als opvolger: `ef + L`). Dit is precies de oude regel.
- BB: `es + L`. EE: eind van de opvolger `>= ef + L`, dus start `>= (ef + L) - (dN - 1)`. BE: eind van de opvolger `>= es + L`.
- Levertijd telt kalenderdagen vanaf de referentiedag en schuift daarna naar de eerstvolgende werkdag; bij EB is het minimum 1 dag (0 = de dag erna, zoals procestijd 0).
- Het terugrekenen (`ls/lf` vanaf de leverdatum) is het spiegelbeeld per type; slack en kritiek pad volgen.
- `wachtOverzicht`: EB en BB houden de opvolger tegen bij het starten (BB: tot de voorganger is begonnen, daarna de wachttijd na zijn geplande begin); EE en BE begrenzen alleen het einde en staan in `eindOp` ("kan pas klaar na het einde van X"). De wachttekst noemt "levertijd N dagen" en "moet eerst beginnen".
- `planConflicten`, `verschuifVoorstel` en `P.depToets` (voor het taakpaneel) volgen het type; bij EE en BE staat het vroegste eind erbij.
- Kringen tellen over alle typen heen.

**Byte-gelijk voor oude projecten:** de harness laadt de versie op `planning-b12` en vergelijkt voor 400 willekeurige projecten (alleen EB, wachttijd >= 0, mijlpalen, vrije dagen, oude koppelingen, uit-schakelaars) `depsEffectief`, `rooster`, `kritiekPad`, `plantTerug`, `plantVooruit`, `planConflicten`, `wachtOverzicht`, `depKringen`, `verschuifVoorstel`, de wachttekst, `depControle` en `depNieuw`: identiek. Eigenschappen die er nieuw bij komen (`lagSoort`, `eindOp`, `type` bij een conflict) verschijnen alleen bij een niet-standaard koppeling.

## De veilige schrijfroute
- `P.afhSchrijf` (mt-planning.js): leest `mt_project_afhank` en de taken vers, voegt de lokale kopie erbij, past de bewerkingen toe (`P.afhToepassen`: `nieuw`, `wijzig`, `weg`, `herstel`), weigert een NIEUWE kring, stempelt per veld (tombstone voor verwijderen), schrijft met ETag/412 en `afhSamen`, controleert het recht (`taken:alles`) na het lezen en vlak voor het schrijven. Bestaat het bestand nog niet, dan wordt het met de eerste koppeling aangemaakt; een verkeerde vorm wordt nooit overschreven.
- `MTPlanVerplaats.afhWijzig` (mt-planverplaats.js): slot per project, de tijdgrenzen van de taakroute, geen stil overschrijven (`gezien`: de waarden die de gebruiker zag; wijken ze af op de verse stand, dan wordt er niets geschreven en meldt de route dat een ander het wijzigde), een controle achteraf dat de wijziging er zo staat (anders de melding "iemand anders wijzigde dezelfde afhankelijkheid tegelijk"), en een kringcontrole op de samengevoegde stand: maakt een gelijktijdige wijziging van een ander (de tegengestelde koppeling) er samen met de mijne een kring van, dan wordt de mijne meteen teruggedraaid en dat gezegd.
- Ongedaan maken = de omgekeerde bewerkingen (`wijziging.tegen`), met `gezien` op wat deze actie zette: is de koppeling sindsdien door een ander gewijzigd, dan gebeurt er niets en staat dat in de melding. Een verwijderde koppeling komt terug met hetzelfde id en dezelfde waarden.
- Het taakpaneel stuurt `{ afhOps }` via `D.wijzig`; `taakWijzig` verwijst naar `afhWijzig`. Het resultaat bevat `afhData` (het hele afhankelijkhedenbestand), niet `data` (dat is van de taken).
- De projecttabel (toevoegen, type, wachttijd, soort, weghalen) gaat zodra de takenlijst klaar is ook via deze route (`projAfhRoute`: dialoog bij een fout, melding met Ongedaan maken); alleen als de takenlijst nog niet geladen of SharePoint niet klaar is geldt de lokale route met een stempel per veld, zoals voor F2a.
- Verwijderen en het terugdraaien van een toevoeging controleren ook `gezien`: heeft een ander de koppeling intussen gewijzigd, dan blijft hij staan (en zijn wijziging ook).
- Bij EE en BE loopt de wachttijd ook door nadat de voorganger klaar is (EE) of begon (BE): `eindOp` noemt dan de datum (`tot`).

## Bekend en bewust
- Sjablonen kennen alleen EB met wachttijd in werkdagen (zoals voorheen).
- BE/EE beperken alleen het einde: een taak kan nog wel op Klaar gezet worden; het paneel zegt waar het einde op wacht, maar blokkeert niet.
- De wachttijd bij BB telt vanaf de geplande start van de voorganger (er is geen echte starttijd).
- De bediening in het taakpaneel is voor kantoor (`taken:alles`); de werkplaats ziet het type als tekst.

## Tests
`b-f2a-harness.js` (node: de byte-gelijk-reeks, de rekenregels met de hand uitgerekend, wachten, conflicten, verschuiven, de schrijfroute met nagebootst SharePoint, samenvoegen) en `rook-f2a.js` (browser) staan, zoals de eerdere testbestanden, in de testmap buiten de repo; daarnaast de volledige suite, check-sinks en de laadtest.
