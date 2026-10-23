# FUNDAMENT P6: checklist in een taak (P6a) en poorten (P6b)

Branch `planning-p6` (op `planning-p3b`). Dit document beschrijft het ontwerp, zodat een reviewer weet wat bedoeld is.

## P6a: checklist
- `taak.checklist = [{ id, tekst, tekst_t, vol, klaar, klaar_t, door, op, weg, weg_t }]`. Een gestempeld taakveld (zoals `fase_id`), zonder conflictmelding.
- Samenvoegen per punt en per onderdeel (`P.checklistSamen`, ingehaakt in `recSamen` voor taken): tekst, klaar (met door en op) en weg hebben elk een eigen tijd (`*_t`); de nieuwste wint, bij gelijke tijd beslist de inhoud (onafhankelijk van de volgorde). Twee mensen die tegelijk verschillende punten afvinken, bewaren allebei het hunne. Verwijderen is een tombstone (`weg`), terugzetten kan.
- Schrijven: `MTPlanVerplaats.taakChecklist` past bewerkingen toe (`nieuw`, `vink`, `hernoem`, `weg`, `herstel`) op de VERSE stand binnen dezelfde schrijfkern als `taakWijzig` (vers lezen, ETag, 412-samenvoegen, slot per taak, tijdgrenzen). Het taakpaneel stuurt `{ ops }` via `D.wijzig`; `taakWijzig` verwijst daarheen. Ongedaan maken = de omgekeerde bewerkingen (`wijziging.tegen`), ook op de verse stand.
- Rechten: afvinken mag wie een status mag zetten (de werkplaats): voor `takenRechtNodig` telt een wijziging van de checklist als "status of nieuw". Het paneel toont het toevoegen, hernoemen en verwijderen alleen aan kantoor (`taken:alles`); met leesrecht staan de vinkjes uit.
- Weergave: sectie Checklist in het taakpaneel (teller n/m, per punt "✓ door Mathijs · 22-10" met dezelfde opmaak als bij een afgevinkte taak in `project-taken`: `P.checklistKlaarTekst`), en een badge op de bordkaart. Het component van `project-taken` (`TT.afgevinkt`, afgeleid uit het journaal) is niet opnieuw gebouwd; bij de integratie kan `P.checklistKlaarTekst` er tekstueel mee samenvallen.
- Sjabloon: `P.CHECKLIST_WVB` (negen voorgestelde punten voor de werkvoorbereiding, aan te passen; verbeterpunt 13) via de knop "Werkvoorbereiding-checklist toevoegen" (voegt alleen toe wat er nog niet in staat), en een sjabloontaak kan `checklist: [teksten]` meegeven (stabiele id's per project). Het standaardsjabloon is ongewijzigd.

## P6b: poorten
- Een poort is een mijlpaal van een eigen soort: `taak.soort === 'mijlpaal'` met `taak.poort` (`tekening_akkoord`, `aanbetaling_binnen`, `maten_definitief`, `materiaal_binnen`, `oplevering_getekend`), `poort_eigenaar` (team-slug), `poort_bewijs` (alleen http(s)-link) en `poort_bron` (`hand`; `moneybird` en `bestelling` zijn al benoemd voor idee #72, nu niet gebouwd). Groen = status klaar.
- Toevoegen: "+ Poort" in het project (kiezen welke poort, daarna kiezen welke taak erop wacht via de bestaande afhankelijkheden). Instellen in het taakpaneel (sectie Poort, alleen voor een mijlpaal): soort, eigenaar, bewijs-link, bron, status en wie erop wacht. Alles via `taakWijzig` (stempels, Ongedaan maken).
- Opvolgers wachten met de reden "wacht op poort X": `wachtOverzicht` geeft bij een voorganger met een poort `poort: label` mee en `wachtOpTekst` toont "poort Tekening akkoord"; zonder poort is de uitkomst byte-gelijk aan die van voor P6. Telefoon, bord en paneel gebruiken dezelfde functie.
- Materiaal binnen als voorstel (nooit stil): `P.poortVoorstel` kijkt naar de bestelregels die aan de poort gekoppeld zijn (P5; anders alle regels van het project). Zijn ze allemaal geleverd, dan staat er in het paneel "Poort op groen zetten?" (één klik, via het gewone statuspad) en in "Te bestellen" van het project komt het voorstel in de bestaande voorstellen ("Op klaar zetten").

## Oude clients en schema
- `P.SCHEMA` en `PROJ_SCHEMA` zijn 9: een oudere app schrijft de takenlijst niet meer zodra de drempel op 9 staat. Een oude app die een taak met checklist als geheel herschrijft zou gelijktijdige vinkjes kunnen verliezen; v2.21/v2.22-apps kennen de poort niet: operationele voorwaarde (iedereen herlaadt, daarna `schema_uitgerold=9`), zoals bij F1, P5 en P3b.
- Een oude app laat de velden staan (onbekende velden blijven in het record); hij toont ze niet.

## Bekend en bewust
- De telefoon toont de checklist nog niet (alleen het statuspad en de wachttekst "poort X").
- Poorten krijgen geen eigen planning-icoon op de tijdlijn (een mijlpaal wordt al getekend).
- De bron `moneybird` voor de aanbetaling is een veld zonder koppeling; dat komt met idee #72.

## Tests
`b-p6-harness.js` (node: samenvoegen, bewerkingen, schrijfroute met nagebootst SharePoint, poorten, wachttekst, voorstel, sjabloon), `rook-p6.js` (browser), plus de volledige suite, check-sinks en de laadtest.
