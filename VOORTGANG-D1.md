# VOORTGANG D1: Outlook-afspraken als "bezet" in de Capaciteit

Tak `capaciteit-d1`, gestapeld op `capaciteit-g1`. Keuzeplan `Deliverables\2026-10-23-keuzeplan-planner-agenda-koppeling.md`, brok D1.

## Wat Bart ziet
- In de uurweergave (dag en 3 dagen) heeft elke persoon een knop **Agenda**; **Agenda's aan** in de hoek zet ze allemaal open. Onder de persoon komt een strook met zijn Outlook-afspraken als grijze blokken op dezelfde tijdas (overlap onder elkaar, hoogstens 3 banen en "+N"; hele dagen bovenaan; afwezig licht rood, voorlopig gearceerd, privé zonder onderwerp).
- Eigen agenda: met onderwerp en plaats. Collega's: bezet/vrij; het onderwerp staat er alleen als de collega dat in Outlook deelt.
- Is een agenda niet te lezen, dan staat er in de strook wat er aan de hand is: "agenda van X niet zichtbaar" (met wat de eigenaar kan delen), 403 (met wat Bart in Azure kan controleren), "Microsoft vraagt om rustiger aan te doen", "log opnieuw in", of "te veel afspraken voor bezet/vrij". Nooit een lege strook die voor "vrij" kan doorgaan.
- Niets wordt afgetrokken van de beschikbare uren (de getallen bij de namen blijven gelijk). Niets wordt geschreven en niets bewaard (alleen welke strook open staat).

## Hoe het werkt
- Nieuwe module `mt-capagenda.js` (rekenwerk zonder netwerk plus een kleine client). Aansluiting: `MTCapAgenda.init` in `v2.html` met `ibFetch` (de bestaande Graph-login, Calendars.ReadWrite; scopes en Azure ongewijzigd).
- Eigen agenda: `GET /me/calendarView` (hoogstens 5 pagina's, een dag marge). Collega's: `POST /me/calendar/getSchedule` in groepen van 20 (leesopdracht; per Microsoft Learn volstaat Calendars.ReadBasic, Calendars.Read of Calendars.ReadWrite).
- Venster 2 tot 6 weken (hele weken met een week marge), 5 minuten in het geheugen, hoogstens twee aanroepen tegelijk, bladeren gedempt (450 ms), 429 en Retry-After worden aangehouden (`ibFetch` geeft Retry-After nu mee), een oud antwoord overschrijft een nieuwer nooit, `wis()` maakt lopende aanvragen ongeldig.
- Tijd: Europe/Amsterdam (`Prefer: outlook.timezone="W. Europe Standard Time"`); antwoorden in UTC of met een verschuiving worden zelf omgerekend; een onbekende tijdzone wordt niet geraden maar gemeld als overgeslagen. Losse en herhalende afspraken zoals calendarView ze teruggeeft.
- Codex-review verwerkt (zie rapport): 6 van 8 punten overgenomen; collega-onderwerpen blijven zichtbaar als de collega ze deelt (afspraak Bart: "onderwerp alleen als Outlook het geeft").

## Wat Bart zou moeten aanzetten als het niet werkt (wij wijzigen niets)
- Collega's: de eigenaar deelt zijn agenda in Outlook ▸ Agenda ▸ Delen (minstens "Kan beschikbaarheid zien"; voor onderwerpen "Kan titels en locaties zien").
- 403 voor iedereen: in Azure ▸ App-registraties ▸ de MT-app ▸ API-machtigingen controleren dat Calendars.ReadWrite (gedelegeerd) er staat met toestemming voor de organisatie (Calendars.ReadBasic volstaat ook voor bezet/vrij).

## Tests
- `b-cap-agenda-harness.js` (71 controles met nagebootste Graph), `rook-d1.js` (32 controles, nagebootste `ibFetch`, geen echte agenda-aanroepen), regressie `alles-d1.ps1`.

## Open punten
- D5 (afspraken optioneel aftrekken) en alle schrijf-brokken (D0, D2, D3, D4) zijn niet gebouwd.
- Week-, maand- en kwartaalweergave tonen de strook niet (alleen dag en 3 dagen, zoals afgesproken).
- De eerste echte aanroep gebeurt pas als iemand een strook opent; de echte rechten van het team zijn dus nog niet in productie gezien.
