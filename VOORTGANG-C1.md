# Voortgang C1: Capaciteit vloeiend

Branch `capaciteit-c1` (basis planning-f1, a4b1f67). Nog niet live; niet gepusht of gemerged.

## Wat Bart ziet (Planning ▸ Capaciteit)
- **Traploos zoomen** van kwartaal tot één dag op één doorlopende schaal (pixels per werkdag). Wiel boven de tijdas = zoomen rond de muis; Ctrl+wiel of knijpen op een trackpad overal; knijpen op touch. Het gewone wiel boven de rijen scrolt de lijst gewoon verder.
- **Traploos schuiven**: de tijdas of de lege achtergrond van een rij slepen (elke afstand: een uur, een halve dag, een halve week); Shift+wiel en horizontaal trackpad-scrollen; pijl links/rechts op de as; op touch één vinger op de tijdas, met uitrollen. Vorige/volgende schuiven één eenheid van het niveau (week 5 werkdagen, maand 20, kwartaal 65, 3 dagen 3, dag 1), ook vanaf een halve dag.
- De knoppen (kwartaal, maand, week, 3 dagen, dag, min en plus) blijven en springen naar de snelkeuze-schaal.
- **Meer detail bij inzoomen**: kwartaal = projectbalken per week (met maandnamen), maand = belasting per dag (met uren bij meer ruimte), week = dagdeelraster, vanaf ongeveer 1 à 3 dagen een uurraster (hele, halve en kwartieren, naarmate er ruimte is) met planblokken op hun echte begintijd en duur (met tijden op het blok) en per medewerker de werktijden: buiten de werktijd gedimd. De as wordt ruimer dan 07:00-17:00 als iemand eerder of later werkt.
- **Op urenniveau plannen**: een planblok slepen rastert op 15 minuten (dagweergave) of 30 minuten (3 dagen), de linker- en rechterrand uittrekken wijzigt begin en duur, of met het toetsenbord (pijl = een rasterstap, Shift+pijl = het eind). Alles via de bestaande schrijfroute voor planblokken (`start` en `duurMin`, geen nieuwe velden), met Ongedaan maken. Week blijft dagdeel.
- **Agenda-strook**: bij 3 dagen en dag een knop "Agenda" per persoon die een lege strook uitklapt met "Outlook-afspraken komen hier (in aanbouw)". Niet gekoppeld.
- **Link en onthouden**: `&schaal=<px per uur>&tijd=<uu:mm>` komen bij een vrije zoom achter `van` en `zoom` in de link; de laatst gebruikte vrije schaal wordt onthouden (de plek niet: die is vandaag). Een link met alleen een snelkeuze werkt als voorheen.
- Telefoon (390 px): persoonskolom smal, knoppen 44 px, tijdas met één of twee vingers.

## Hoe het werkt (voor de review)
- `mt-capaciteit-nieuw.js`: werkdag-index `wi` (0 = maandag 5-1-1970, weekend telt niet); `S.ppd` (px per werkdag) en `S.pos` (wi aan de linkerrand, met breuk) zijn de waarheid zodra `S.vrij`; `S.zoom` (etiket) en `S.anker` (datum linkerrand) blijven voor de snelkeuze, de link en de tests. Niveaus uit `N.modus(ppd, Wv)` met grenzen die op een brede kolom meeschuiven (`KF`).
- Elke rij = persoonskolom + tijdkolom (`.cn-lane`, overflow hidden) met één strook (`.cn-strip`); schuiven binnen een dag is alleen een transform, een nieuwe dag in beeld bouwt de stroken opnieuw (zonder opnieuw te rekenen: stukken van 6 weken staan op een vast raster in een cache die `N.teken()` wist).
- `mt-planfilter.js`: twee sleutels erbij (`schaal`, `tijd`), achteraan in de volgorde van de link.
- `mt-planverplaats.js`: `spec.duurMin` bij `verplaats` (15 min t/m 12 uur); `voor`/`na` bevatten de duur alleen als hij verandert; Ongedaan maken zet hem terug.
- `v2.html`: `r.planfilter` kent `schaal` en `tijd` (anders wist de router ze), versie-parameters.
- `mt-stijl-nieuw.css`: blok "C1".

## Bewust niet gedaan / open
- Agendapunten zijn alleen voorbereid (lege strook, geen Outlook/Graph).
- Het weekend bestaat niet op de as (de bestaande keuze); "Naar de dag" op een weekenddag toont die ene dag nog als losse kolom.
- De `wacht`-berekening van afhankelijke taken gebruikt de maandag van het begin van het stuk van 6 weken als "vandaag" (zoals voorheen het begin van het venster): gedrag bij wachttijden kan per venster iets afwijken.

## Tests (alles in scratchpad, niet in de repo)
- `stap2-suite/b-cap-zoom-harness.js`: schaal en omrekening, zoomen rond een punt, schuiven per niveau, rasteren, uittrekken, venster van het model, werktijden, link, planblok-duur.
- Bestaand `cap-harness.js` (model van de snelkeuzes, 22 controles) tegen deze boom: gelijk.
- `c1/rook-c1.js` (echte browser, eigen server en poort): wiel-zoom, slepen-schuiven, blok slepen op 15 min, uittrekken, toetsenbord, Ongedaan maken, agenda-strook, link, werktijden, prestatie (8 personen × 3 maanden), 390 px.
- Bestaande rooktests via `c1/run-rook.js`: P0, P1a, P3, P4a, F1, taakpaneel 1/2/2a/4/5.
