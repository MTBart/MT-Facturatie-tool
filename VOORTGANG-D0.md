# VOORTGANG D0: fundament om naar de agenda te schrijven (vlag UIT)

Tak `capaciteit-d0`, gestapeld op `capaciteit-d1`. Keuzeplan `Deliverables\2026-10-23-keuzeplan-planner-agenda-koppeling.md` (D0 en de Codex-tabel).
**Bart ziet niets nieuws.** Er is niets aan gekoppeld en de vlag staat uit (`const AGENDA_SCHRIJVEN=false` in `v2.html`). D2 en D3 schakelen hem later in, na Barts antwoorden.

## Wat er ligt
1. **Het veld `agenda` op het planblok** (`mt-planning.js`): drie aparte, elk gestempelde velden `agenda_instelling`, `agenda_koppeling`, `agenda_gezien` in `P.BLOK_VELDEN`, via de F1-writer (stempel per veld, 412-samenvoegen, tombstones). Een veld met een verkeerde vorm wordt niet geschreven en gemeld als overgeslagen (`ongeldig`). Schemadrempel: ze rijden mee op `P.SCHEMA = 6` van F1 (die is nog niet uitgerold: één release, dus één drempel). Wie het planblokbestand daarna wil beschermen zet het bestaande `__schema`-record (`P.blokSchemaZet`) bij het eerste echte gebruik (D3).
2. **Een echte uitgaande wachtrij** (`mt-agenda-uit.js`, bestand `mt_agenda_outbox.json`, nog niet geregistreerd in de cockpit):
   - vast opdracht-id per opdracht (create en delete: per blok en eigenaar; update: per versie van het blok), op elk apparaat gelijk; twee apparaten die dezelfde opdracht maken geven één record;
   - samenvoegen dat nooit een stap terugzet (stand alleen omhoog, `rev` voor gelijke stand), met een claim per opdracht (oudste wint, `claimVrij` voor vrijgegeven claims);
   - **één opdracht tegelijk per agenda**: een korte claim, na het schrijven teruggelezen;
   - **bij twijfel nooit blind posten**: eerst terugzoeken op de markering, bij time-out of onbekende uitkomst of een verlopen claim alleen terugzoeken (hoogstens 3 keer), daarna "mislukt" zonder tweede POST.
3. **Tool-markering**: extended property `mtId = planblok:<id>` en `mtOp = <opdracht-id>`, plus `transactionId = opdracht-id`.
4. **Terugleescontrole** na elke schrijfactie; wijkt Outlook af of is de afspraak intussen in Outlook gewijzigd (changeKey, If-Match) dan **conflict**, nooit overschrijven. Update en delete tegen een afspraak die al weg is of een wijziging die zonder antwoord aankwam zijn afgevangen.
5. **Collega's bevestigen zelf**: een opdracht voor een ander wordt `wacht-bevestiging`; alleen de eigenaar bevestigt of wijst af (`U.bevestig`, `U.wijsAf`), de maker kan intrekken. Nooit automatisch. De maker ziet "wacht op bevestiging van X" (`wachtOpAnderen`, na 3 dagen "blijft liggen"); de opdracht verdwijnt nooit stil. Alleen de eigenaar voert uit en alleen in `/me`.
6. **Controles vóór aanmaken en vóór uitvoeren**: eigenaar en maker zijn teamleden, bestaand planblok, duur hoogstens 10 uur, niet over middernacht, hoogstens ~6 maanden vooruit en niet in het verleden, id klopt met inhoud, markering klopt met het blok.
7. **De vlag**: zonder vlag doet `verwerk()` niets: geen lezen, geen schrijven, geen aanroep naar Microsoft.

## Tests
- `b-agenda-uit-harness.js` (nagebootste Graph en SharePoint met ETag/412; twee apparaten tegelijk, time-outs, verlopen claim, 429, update/delete-conflicten, vlag uit, statische controles dat niets is aangesloten), plus de bestaande `b-bw-harness.js` (F1) en de volledige regressie `alles-d0.ps1`.

## Codex-review (verplicht) en wat ermee gedaan is
Negen bevindingen. Overgenomen en met een test vastgelegd: (1) twee apparaten met een andere inhoud voor dezelfde opdracht: de nieuwste bedoeling wint, niet een willekeurige; (2) eindstanden onderling: conflict wint van gelinkt, gelinkt van mislukt, de koppeling blijft bewaard; (3) de claim duurt 5 minuten, elke Graph-aanroep hoogstens 30 s en een schrijfactie begint niet meer als de claim bijna verloopt; (4) verwijderen: alleen een 404 bij de controle bewijst "weg", een andere leesfout is "onzeker"; (6) terugleescontrole en aanpassen/verwijderen controleren de markering (mtId, bij aanmaken ook mtOp): een afspraak zonder markering van de tool wordt nooit aangeraakt; (7) "vandaag" voor de datumgrens rekent in Amsterdam; (8) alleen de vlag van `init()` telt, niet een vlag die een aanroeper meegeeft.
Bewust niet opgelost: **(5) de bevestiging door de eigenaar is te vervalsen** door wie het SharePoint-bestand kan schrijven (`bevestigd` + `bevestigdDoor` zijn gewone velden en het id-hash is geen geheim). Zonder een server- of identiteitsgebonden laag is dat geen beveiligingsgrens maar een gebruikersregel. De schade is begrensd (een afspraak van hoogstens 10 uur, binnen ~6 maanden, in de eigen agenda van de eigenaar, zichtbaar en te verwijderen; geen gegevens naar buiten). Als Bart dat te los vindt, hoort de bevestiging via de worker te lopen (aparte keuze voor D2). (9) Privacy van de inhoud hangt af van wat D2 en D3 meegeven (`extra`); vóór D2 hoort er een vaste whitelist van velden en een besluit over wat er in de outbox en in de afspraak mag staan.
Ook opgelost bij het vastleggen: `check-sinks` (plakwerk) keurde twee regels niet goed: HTML en de filter-URL worden nu met `join` opgebouwd, de baselines zijn niet aangepast.

## Open punten voor D2 en D3
- Het bestand `mt_agenda_outbox.json` moet nog als SharePoint-sleutel worden geregistreerd (en in de back-up) voordat de vlag aan kan.
- Wat de bescherming echt is: iedereen die het SharePoint-bestand kan schrijven kan een opdracht smeden; de controle van het opdracht-id is een foutvanger, geen beveiliging. De echte bescherming is dat Microsoft alleen schrijven in de eigen agenda toestaat (`/me`) en dat de eigenaar zelf bevestigt.
- De inhoud van de afspraak (onderwerp, klant, locatie, tekst) bouwt D2/D3 (`U.payloadVoor` neemt `extra`).
