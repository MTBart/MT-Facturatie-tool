# Voortgang C2: taken stapelen, randen slepen, belasting per persoon

Branch `capaciteit-c2` (vanaf capaciteit-c1, 48a3056). Nog niet live; niet gepusht of gemerged.

## Wat Bart ziet
- **Stapelen.** Taken die elkaar overlappen bij één persoon staan onder elkaar; er zijn er vier zichtbaar, daarna "+N meer" dat uitklapt ("minder" klapt weer in); de rij groeit mee.
  - Week: wat de hele dag beslaat (beide dagdelen) staat één keer bovenaan de cel ("hele dag"), de rest per dagdeel.
  - Uren (3 dagen, dag): taken zonder tijd staan als dagbalken in banen bovenaan de rij (een taak houdt dezelfde baan over de dagen); planblokken met een tijd staan eronder op hun echte tijd, ook in banen; beide met "+N meer".
- **Randen slepen.**
  - Week: de bestaande grepen (T5) op de eerste en laatste dag van de taakbalk.
  - Uren: dezelfde grepen op de dagbalk, in hele dagen; tijdens het slepen staat de nieuwe datum bij de rand. De einddatum is de dag waar je loslaat (weekend of verplichte vrije dag: de eerstvolgende of vorige werkdag, zoals altijd).
  - Alles via de bestaande taakroute (`taakrand` in `MTPlanVerplaats.plaatsTaak`, met de stempels van het taakpaneel), dus ook de vraag "Opvolgers verschuiven?" en de strikte modus.
  - Na elke wijziging en na Ongedaan maken verversen het taakpaneel en de projecttabel meteen (`naWijziging` in de bedrading).
  - Komt een taak daardoor eerder te staan dan haar voorgangers toelaten, dan zegt de melding dat eerlijk ("begint nu op …, maar kan pas vanaf … (na …)"); de datum is dan wel gewijzigd (zoals bij elke sleepactie) en Ongedaan maken zet alles terug, ook de opvolgers.
- **Belasting per persoon**, boven de naam: "8 u over", "0 u over" of "6 u te veel" (rood).
  - Periode: de week in het midden van beeld (kwartaal, maand, week) of de dag in het midden (3 dagen, dag).
  - Hover, focus of tik toont de opbouw: beschikbaar (per dag, uit de werktijden van die persoon, min verlof en vrije dagen), de taken met uren, gepland, en beschikbaar min gepland.

## Rekenregel (één basis)
Belasting = som van `cap_min` min som van `gepland_min` over de dagen van de periode, uit `MTPlanning.teamCapaciteit` / `weekRooster`:
de raming van elke taak verdeeld over de echte werkdagen van die persoon (`taakVerdeling`), planblokken zonder dubbeltelling met hun taak, een open voorstel telt niet. Geen afronding op dagdelen. De harness legt vast dat per persoon en dag dezelfde minuten uitkomen als Mijn werk (`weekBezetting`), ook met werktijden per medewerker. Barts voorbeeld (vier taken van 8 u in een week, werktijden 32 u) geeft "0 u over".

## Ook in C2
- **Wacht met de echte vandaag**: `weekRooster` kent `opt.wachtVandaag`; de Capaciteit geeft de echte vandaag mee (voorheen de maandag van het stuk van 6 weken). De harness bewijst het (faalt op de oude rekenwijze).
- **Niveaugrenzen op de breedte van de tijdkolom** (C1-verbetering): bij Ongepland open op een laptop (664 px) toonde "3 dagen" 2,2 dag. Nu: kwartaal/maand bij 40 dagen, maand/week bij 10, week/uren bij 3,5, met ondergrenzen.

## Tests (scratchpad)
- `stap2-suite/b-cap-belasting-harness.js`: Barts voorbeeld, te veel, verlof, taak deels buiten de periode, zonder raming, planblok en taak, open voorstel, gelijk aan Mijn werk (met en zonder werktijden), taakVerdeling, banen, wacht-vandaag.
- `c1/rook-c2.js`: 6 overlappende taken, +N meer, belasting en opbouw (hover, vast, Escape), rand slepen met opvolgers, tabel en paneel direct bijgewerkt, eerlijke melding, Ongedaan maken.
