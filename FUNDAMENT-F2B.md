# FUNDAMENT F2b: beperkingen per taak en afhankelijkheden tussen projecten

Branch `planning-f2b` (op `planning-f2a`). Dit document beschrijft het ontwerp, zodat een reviewer weet wat bedoeld is. Maatstaf: minimaal MS Project, Wrike en Smartsheet (markt-radar 01-planning, deel A).

## Wat het doet
- Een beperking per taak: **zo snel mogelijk** (standaard, het gedrag van vroeger), **niet vóór** een datum, **uiterlijk op** een datum (deadline) of **vast op** een datum (afspraak met de klant).
- Een voorganger uit een **ander project** (bijvoorbeeld dezelfde montageploeg of een CNC-order): eerst het project kiezen, dan de taak. Rooster, wachten, conflicten en verschuiven rekenen ermee.
- Een beperking die niet klopt met de planning is een **melding, nooit een blokkade**: er wordt niets vanzelf verschoven en niets geweigerd.
- Projecten zonder beperkingen of koppelingen tussen projecten rekenen **byte-gelijk** aan `planning-f2a` (bewezen in `b-f2b-harness.js` op 400 willekeurige projecten en in de bestaande suites).

## Gegevensmodel
- Twee taakvelden: `beperking` ('' | `niet_voor` | `uiterlijk` | `vast_op`) en `beperking_datum` (ymd). Beide staan in `TAAK_VELDEN` en `ZONDER_CONFLICT` (gestempeld per veld, merge per veld, geen conflictmelding bij gelijktijdig wijzigen). Een onbekende soort of onleesbare datum telt als "zo snel mogelijk" (`P.beperkingVan` geeft dan `null`).
- Een koppeling met een ander project is een gewone afhankelijkheid met één extra veld: `van_project` (de code van het project van de voorganger). Het record staat in het bestand van het project van de **opvolger** (`mt_project_afhank[code_opvolger]`), met `van_taak` = id in het andere project. `van_project` valt onder dezelfde stempels en `afhSamen`.
- Schema 11 (`P.SCHEMA` = `PROJ_SCHEMA`): een oudere app die `beperking` of `van_project` niet kent zou ze stil negeren. Operationele voorwaarde zoals bij F2a: iedereen herlaadt, daarna `schema_uitgerold=11`.

## Rekenregels (`mt-planning.js`)
- `niet_voor`: de vroegste start wordt `max(start, datum)` (naar de eerstvolgende werkdag). `vast_op`: de start is de datum; zijn de voorgangers daar niet op tijd klaar, dan staat er een conflict `{vroegst, dagen}` in `beperkingConflicten` en de taak blijft staan.
- `uiterlijk`: verschuift niets. Het werkt in het terugrekenen (de laatste start/eind wordt `min(l, datum)`), dus de speling wordt negatief en de taak komt op het kritieke pad; een overschrijding staat in `beperkingConflicten` met de dagen te laat. `uiterlijk` houdt een taak nooit tegen in `wachtOverzicht`.
- `wachtOverzicht`: een taak (niet klaar) met `niet_voor` of `vast_op` wacht tot de datum, met de reden in de tekst ("niet vóór …", "vaste start op …").
- `verschuifVoorstel`: opvolgers met `niet_voor` komen niet eerder dan hun datum; opvolgers met `vast_op` blijven staan en staan in `vastgezet` (met de datum waarop ze zouden moeten).
- `P.beperkingConflicten(taken, {vrij})`: op de geplande datums gerekend (niet vóór: start te vroeg; vast op: start ≠ datum; uiterlijk: eind te laat, alleen open taken). `P.beperkingTekst` voor de weergave.
- Alle nieuwe sleutels in de uitkomst staan er alleen als er een beperking of koppeling is; daarom is de rest byte-gelijk.

## Tussen projecten
- `P.metExtern(taken, deps, alle, code)`: een voorganger uit een ander project wordt als vaste **schaduwtaak** (het id begint met het onzichtbare teken U+0001, zodat het nooit botst met een echt taak-id; `_extern`) in de lijst gezet, met de status, de datums en de duur uit het andere project en `vast_op` zijn eigen start. Zo rekenen rooster, wachten, conflicten en verschuiven er ongewijzigd mee. De schaduwtaak telt niet mee in de einddatum, de speling, het kritieke pad of de conflicten van dit project, komt niet in het resultaat van `wachtOverzicht` en niet in de wijzigingen van `verschuifVoorstel`. Een voorganger die niet meer bestaat: de koppeling doet niet mee (geen fout).
- Aanroepers geven `alle` (de taken per project) en `code` mee in `rooster`, `wachtOverzicht`, `planConflicten`, `verschuifVoorstel`, `taakWacht`: taakpaneel, projecttabel, Tijdlijn, Bord, Mijn werk, projectstroom en letOp. De tv en andere plekken zonder `alle` negeren koppelingen tussen projecten (bewuste beperking). Zonder `alle` botst een koppeling nooit met een lokale taak met hetzelfde id.
- Bekende beperking: een taak van dit project als voorganger van een taak in een ander project beïnvloedt de late datums (terugrekenen) van dit project niet; het andere project ziet het wel.
- Kring over projecten heen: `P.depKringenGlobaal` (knopen `project|taak`) en `P.depControleKruis` (bestaat, niet binnen één project, niet dubbel, geen nieuwe kring, met de namen in de melding). De veilige route (`P.afhSchrijf`, `V.afhWijzig`) controleert vóór het schrijven op de verse stand en na het schrijven op de samengevoegde stand; legt een collega tegelijk de tegengestelde koppeling, dan wordt de mijne teruggedraaid met een eerlijke melding. Ongedaan maken (herstel) controleert opnieuw.
- Rechten: dezelfde als voor afhankelijkheden (`taken:alles`). Er bestaan geen rechten per project; wie koppelingen mag leggen, mag ze naar elk project leggen.

## Bediening
- Taakpaneel: rij **Beperking** (keuze + datum, beide velden samen met `gezien`, Ongedaan maken; leegmaken wist ook de datum); onder de keuze staat de uitleg en, als het niet klopt, een waarschuwing met de dagen. Onder Afhankelijkheden: "+ Voorganger uit een ander project" (project, daarna taak; kringen uitgeschakeld en benoemd), de lijst toont "Project: taak · ander project". Een opvolger in een ander project is alleen te lezen met een verwijzing naar zijn eigen taak (daar staat het record).
- Projecttabel: chips voor voorgangers uit andere projecten, de beperking onder de taaknaam, meldingen voor beperkingen die niet kloppen.
- Tijdlijn: een gestippelde lijn voor een koppeling tussen projecten (alleen als beide projecten uitgeklapt zijn en de datums hebben); een streepje op de datum van de beperking (dubbel = uiterlijk, gestippeld = vast, enkel = niet vóór; rood als het niet klopt) met de tekst in titel en label.
