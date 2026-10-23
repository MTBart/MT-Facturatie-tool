# VOORTGANG G1: de laag "Geklokt" in de Capaciteit

Tak `capaciteit-g1`, gestapeld op `capaciteit-p1b`. Keuzeplan B uit `Deliverables\2026-10-23-keuzeplan-planning-opruimen.md`.

## Wat Bart ziet
- Nieuwe knop **Geklokt** in de balk van Planning ▸ Capaciteit (uit totdat je hem aanzet; de keuze wordt onthouden en staat in de link als `gk=1`).
- **Dag en 3 dagen:** onder de blokken van elke persoon een dunne strook met de geklokte uren op hun echte tijd (Amsterdam), in de kleur van het project. Klik (of Enter) op een blok: project (met knop naar het project), taak, omschrijving, tijd en duur.
- **Week:** in elke dag een regel "geklokt 2u30 / gepland 8u" (op smalle schermen "gekl. 2u30"); klik toont de blokken van die dag met het totaal.
- **Maand:** een streepje onderin de dag (breedte = geklokt tegenover beschikbaar), bij ruimte het getal. **Kwartaal:** uren per week.
- Onder de naam van elke persoon: "geklokt X / gepland Y" voor dezelfde periode als het getal in het belastingbadge.
- Onder de Capaciteit: bron (Toggl), laatste sync, aantal regels in beeld.
- ▦ Rooster en ≣ Lijst zijn weg uit de balk (alleen in de nieuwe stijl). Een oude link ernaar gaat naar de Capaciteit met de laag aan. Met `?oud-rooster=1` komen ze één release terug als vangnet.

## Hoe het werkt
- Bron: `mt_uren_entries` in de browser, dezelfde uren als het oude Rooster (`agEntries`). **Geen nieuwe aanroep, niets geschreven.**
- `N.lokaal` zet een tijd om naar datum en minuten in Europe/Amsterdam met `Intl` (onafhankelijk van de tijdzone van de computer; zonder tijdzone in de tekst geldt de tekst zelf).
- `N.gkVoorbereid` (eenmaal per keer tekenen) en `N.gkKies` (bij elk nieuw venster): regels per persoon en dag. Een lopende timer (negatieve duur), een onbekende persoon en nul tellen niet mee.
- De klik op de strook maakt geen planblok (`_gkTop`); de rest van het tijdvlak werkt zoals in P1b.
- `gk` is een sleutel van de gedeelde filterstand (`mt-planfilter.js`) en staat in `agendaRoute`.

## Tests
- `b-cap-geklokt-harness.js` (33 controles, gedraaid onder 4 tijdzones van de computer), `rook-g1.js` (45), regressie `alles-g1.ps1`.

## Open punten
- Per-project totalen (het oude "Totalen") horen bij P9a/P13.
- Het automatisch bijwerken uit Toggl volgt het bladeren niet mee (nieuwe aanroep per week); oudere weken staan er na één keer Sync nu.
- Bart beslist of de Lijst per dag voor het hele team nog nodig is (INVENTARIS-ROOSTER vraag 4).
