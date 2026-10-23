# Voortgang P1b: Planning vervangen (planblok bewerken, klik om te plannen)

Branch `capaciteit-p1b` (vanaf capaciteit-c3). Nog niet live; niet gepusht of gemerged. Keuzeplan A2, afgevinkt tegen `INVENTARIS-ROOSTER.md` (onderdeel A).

## Wat Bart ziet
- **Klik op een lege plek** in de uurweergave (dag, 3 dagen en alles daartussen) opent het formulier "Nieuw planblok", ingevuld met persoon, dag en starttijd (op het kwartier, of de halve rasterstap bij 3 dagen), een uur. Ook de knop "Planblok" in de balk (voor het toetsenbord). Kantoor: Inplannen; werkplaats: Voorstel indienen.
- **Het planblokpaneel is bewerkbaar** (voor kantoor): persoon, dag, starttijd, duur ("1u30", "90 min"), project, taak (de open taken van dat project), titel en notitie; kiezen of typen en wegklikken slaat op, met Ongedaan maken in de melding. Verwijderen vraagt eerst om bevestiging (een tombstone, niet weghalen).
- **Voorstellen**: kantoor ziet een open voorstel met Goedkeuren en Afwijzen (met reden); de indiener trekt zijn eigen voorstel in; de werkplaats en een kijker zien het paneel alleen-lezen.
- **De vijf prompt-vensters en het oude blokmenu zijn weg**: ook in de oude Planning-weergave opent "nieuw blok" en een klik op een blok het paneel.
- **📋 Planning** is verborgen; bereikbaar via `?oud-planning=1` (één release vangnet); een oude link met weergave=plan gaat naar de Capaciteit; de projecttijdlijn "naar de Agenda" opent de Capaciteit van die week.
- **Optionele vrije dag** (bv. een brugdag): de naam staat als gele laag in de week- en uurweergave (het blijft een gewone werkdag).

## Hoe het werkt
- Rekenwerk: `MTPlanVerplaats.blokBewerk` (mt-planverplaats.js, nieuw): soorten blokNieuw, blokWijzig, blokWeg, blokKeurGoed, blokWijsAf, blokTrekIn; rechten (kantoor wijzigt en beslist, werkplaats maakt een voorstel, de indiener trekt in), `V.blokVelden` (persoon, dag, tijd, duur 15 min tot 12 uur, niet over middernacht, project, taak, notitie), de vraag bij verlof, een verplichte vrije dag of "werkt niet" (`V.dagWaarschuwing`, dezelfde bron als slepen), `gezien` (een collega was eerder: niets overschrijven), en Ongedaan maken (`V.ongedaan` kent blokWijzig en blokNieuw).
- Schrijven: `capBlokDoe` (v2.html): vers lezen (`_capVers`), rekenwerk, dan de F1-writer (`agPlanSave`): veldstempels, ETag, een eerlijke melding bij een collega die tegelijk wijzigde.
- Paneel: `mt-planblokpaneel.js` (model, formulier, inline velden via de bouwstenen van het objectpaneel); Capaciteit: `N.legeKlik`, optionele vrije dag; v2.html: bedrading en de verborgen link.

## Inventaris onderdeel A: alles groen
| Regel | Plek | Test |
|---|---|---|
| Planblokken per dag en uur zien | Capaciteit | rook-c1, rook-p1b |
| Een planblok openen en alles zien | paneel | rook-p1a-p1b |
| Van een planblok naar persoon, dag, taak, project | links in het paneel | rook-p1a-p1b |
| Blok slepen naar andere dag of tijd | Capaciteit | rook-p1a, rook-c1 |
| Waarschuwing verlof / vrije dag / werkt niet | `dagWaarschuwing` bij slepen, nieuw en wijzigen | b-planblok-bewerk, rook-p1b |
| Vers lezen, één drop tegelijk, collega-melding | `capBlokDoe`, `capVerplaats` | rook-p1b (twee apparaten) |
| Nieuw blok door op een lege plek te klikken | formulier in het paneel | rook-p1b |
| Starttijd uit de klikpositie (kwartier) | `N.legeKlik` | rook-p1b (14:15) |
| Verlofcontrole bij een nieuw blok | idem | rook-p1b |
| Verwijderen (tombstone) | paneel, met bevestiging | rook-p1b, harness |
| Notitie wijzigen | paneel | rook-p1b |
| Optionele vrije dag met naam | gele laag | rook-p1b |
| Capaciteitsbalk per persoon (gepland, beschikbaar, rood) | belasting boven de naam (C2) | rook-c2 |
| Persoonsfilter via de capaciteitsbalk | gedeelde filterbalk (P0) | rook-p0 |
| Meervoudig filteren | **vervalt** (één project en één persoon): besluit van Bart nodig | n.v.t. |
| Toon geklokt naast de planning | **niet in P1b** (P13 / laag "Geklokt") | n.v.t. |
| Voorstel van de werkplaats: gestippeld blok | Capaciteit | rook-p1b |
| Voorstel goedkeuren, afwijzen met reden, intrekken | paneel | rook-p1b, harness |
| Werkplaats dient een voorstel in door te klikken | formulier | rook-p1b |
| Meldingen "goedgekeurd/afgewezen" en "N wachten" | `pvTeken` in de Agenda | rook-p1b |
| Rolregels (kantoor, werkplaats, kijker/tv) | `capBlokDoe` + rekenwerk + paneel | rook-p1b (per rol), harness |
| Planblokken op de projecttijdlijn (`planBlokkenFilter`) | ongewijzigd | rook-p1b |
| Sync nu, Focus, aanwezigheidskaart | ongewijzigd | n.v.t. |

De rol "tv" is een aparte pagina (tv.html) zonder dit paneel; in de cockpit is de kijker een rol die niet geladen is (fail-closed): geen formulier, geen knop, alleen-lezen paneel, en `capBlokDoe` weigert ook rechtstreeks.

## Open
- Meervoudig filteren (vraag 2) en "Toon geklokt" blijven bij Bart / P13, zoals in de inventaris.
- Go/no-go voor het definitief weghalen van de oude code (de release na dit vangnet): ook iedereen laten herladen (schemadrempel F1) en een controle op twee apparaten in de praktijk.

## Codex-review (alleen gelezen, ruwe uitvoer in scratchpad) en wat ermee gedaan is
| # | Bevinding | Ernst | Verwerkt |
|---|---|---|---|
| 1 | Een onzekere save van een nieuw blok kon bij "opnieuw" een dubbel blok maken (elke poging een nieuw nummer). | kritiek | Ja: één nummer per formulier (`B.pendingId`); hetzelfde blok onder dat nummer = al gedaan (noop), iets anders = geweigerd; staat het blok alleen lokaal, dan wordt het geopend met een eerlijke melding (geen tweede poging nodig). |
| 2 | Een dubbelklik op Inplannen maakte twee blokken. | kritiek | Ja: slot (`B.bezig`) en knop tijdens het opslaan uit; rooktest met dubbelklik. |
| 3 | Een id-conflict bij een nieuw blok (F1 sloeg het over) werd als gelukt gemeld. | belangrijk | Ja: `capBlokDoe` vertaalt "bestaat" naar niet gelukt (collega was eerder), het formulier blijft staan. |
| 4 | Kantoor kon via blokTrekIn een eigen open voorstel intrekken. | belangrijk | Ja: intrekken alleen in de werkplaats-rol (ctx.voorstel) en alleen het eigen voorstel; kantoor keurt goed of wijst af (harness en paneel). |
Bevestigd door Codex: Ongedaan maken stopt veilig als iemand anders het blok wijzigde; de klik op een lege plek sluit blokken, knoppen, popovers en de dagbalk uit; alles wordt met DOM-calls getekend (geen XSS-route); de periodieke verversing beschermt actieve invoer.
