# Voortgang C3: de takenbak

Branch `capaciteit-c3` (vanaf capaciteit-c2). Nog niet live; niet gepusht of gemerged.

## Wat Bart ziet (rechterkolom van Planning > Capaciteit)
- **Kop met keuze**: Ongepland (standaard, precies de lijst van voorheen), Alles open, Te laat, Wacht, Deze week. Daarnaast het aantal en de uren, de knop "Filter (n)" en inklappen (zoals voorheen).
- **Filters** (standaard ingeklapt achter "Filter"): klant, project, fase (nu het fase-label van de taak; vervangbaar door fase_id), activiteit, persoon (met "niemand"), zoeken op tekst, groeperen per project, klant, fase of activiteit met inklapbare groepen (aantal en uren per groep) en "Wis filters". De keuzelijsten bevatten alleen wat in de gekozen lijst voorkomt.
- **Koppeling met de bovenste filterbalk**: project en persoon bovenin gelden voor elke lijst; de bak heeft er eigen filters bovenop.
- **Kaarten**: dezelfde kaart als in Ongepland, met in de andere lijsten een regel met datums, wie, wacht en te laat. Slepen naar een persoon of dag werkt vanuit elke lijst via de bestaande taakroute (een geplande taak slepen = verplaatsen, met de vraag over de opvolgers en Ongedaan maken); een klik opent het taakpaneel; de knop "Inplannen..." blijft voor het toetsenbord.
- **Link en onthouden**: `&bak=<lijst>&bf=<filters en groepering>` in de link (twee nieuwe sleutels in de gedeelde filterstand), en in de browser onthouden; een link wint van het onthouden.
- **Telefoon (390 px)**: de bak is een schuiflade onderaan (dicht: alleen de kop); bediening minstens 44 px.
- Het getal "x u vrij" onder de naam in de week- en uurweergave is vervangen door de belasting boven de naam (C2): één getal in plaats van twee verschillende.

## Hoe het werkt
- `mt-takenbak.js` (nieuw, alleen rekenwerk): `items` (open taken als kaarten), `inModus`, `filter`, `opties`, `groepeer`, `sorteer`, `codeer/decodeer` (de stand in de link). Ongepland blijft de lijst van `ongeplandVoor` in de Capaciteit.
- `mt-capaciteit-nieuw.js`: `zijkolom` en `N.bakTeken` (alleen de kolom wordt vervangen als je een filter wijzigt; een tekstveld houdt de cursor).
- `mt-planfilter.js`: sleutels `bak` en `bf`; `v2.html`: de router kent ze, het scripttag, de klantnaam in de projectinfo.
- Geen nieuwe schrijfroutes: alles loopt via de bestaande sleeproute (`D.verplaats` > `plaatsTaak`). Daarom geen Codex-ronde voor deze brok.

## Tests (scratchpad)
- `stap2-suite/b-takenbak-harness.js` (31): kaarten, lijsten, filters (EN), opties, groepen, sorteren, link (codeer/decodeer, planfilter).
- `c1/rook-c3.js` (32): lijst kiezen, filteren, zoeken met cursor, wissen, bovenste balk, groeperen en inklappen, slepen uit Alles open met opvolgers en Ongedaan maken, klik, link en onthouden, 390 px lade.
- Bestaande tests onveranderd groen (rook-c1, rook-c2, P0, P1a, P4a, F1, taakpaneel, harnassen).
