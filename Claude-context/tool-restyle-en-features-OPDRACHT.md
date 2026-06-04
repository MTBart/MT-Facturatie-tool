# OPDRACHT — Restyle + Smart-inbox/Project/Offerte features

> Vastgelegd 2026-06-04 door Larry uit Barts wensenlijst. Bedoeld voor de
> ultra-vervolgsessie (na de 02:30 Toggl-nachtrun). **Functionaliteit eerst,
> styling daarna.** Bart gaat zelf oefenen met "Claude design" voor de look.
> Bouw additief, lokaal committen per feature, NIET pushen zonder Bart-OK.

## A. STYLING (denkwerk nu, uitvoer later — Bart komt erop terug)

- Hele tool opnieuw stylen. Huidige look is niet professioneel/fris genoeg.
- **Gele/crème basiskleur moet eraf** → helderder/witter, frisser.
- **Groen en goud blijven** (merkkleuren).
- **Lettertypes anders** — huidige zijn niet overzichtelijk genoeg.
- Referenties die Bart noemde: **Toggl**, **Jortt** (strak, wit, helder, veel
  ruimte). Bart denkt aan een aanpak via "Claude design" (kent het nog niet,
  gaat oefenen). → Larry: denk na over een design-systeem (tokens: kleuren,
  type-schaal, spacing, radius, shadow) dat in één centrale `:root` zit zodat
  restylen = tokens omzetten, niet overal zoeken. Mogelijk GL-003 design-system
  + Iris/Charta inzetten. NU niet groots uitrollen — eerst functionaliteit.

## B. SMART-INBOX — layout & UX fixes (NU/eerst)

Huidige toestand (Barts feedback):
1. **Mail-leesvenster is te klein** → moet veel groter/dominanter.
2. **Dikke balk onderin beeld** neemt onnodig ruimte → weg / dunner.
3. **Dubbele chat-prompt:** er staat een regel "vraag me iets over deze mail"
   ÉN daaronder een invoerbalk die óók "vraag iets" zegt. → Houd alléén de
   onderste (de invoer). De begroetingsregel weg of als placeholder.
4. **Invoerveld** mag **meegroeien/uitklappen** als je typt en het past niet
   (auto-resize textarea).
5. **Knoppenrij ontbreekt** — ruimte maken voor de acties die het pas een
   "smart" inbox maken (zie C).

## C. SMART-INBOX — functionaliteit (groter, ná layout-fix)

Kernprincipe dat Bart expliciet maakte: **niet de mail in Outlook verplaatsen**,
maar in de tool een **eigen tag / projecttoewijzing** aan mails geven. De
Outlook-move blijft optioneel bestaan, maar de hoofd-workflow is taggen-in-tool.

1. **Mail → project koppelen (tag in de tool):** meerdere mails kunnen aan
   hetzelfde project gekoppeld worden. Koppeling leeft in de tool-data
   (SharePoint privé, NIET in de PUBLIC repo), gekoppeld via `internetMessageId`
   (move-bestendig). Niet de Outlook-folder muteren.
2. **"Maak project aan"-knop in de mail-reader:** springt naar een verder
   tabblad (Projecten) en start de **namen-generator**, gelinkt aan de **DB met
   volledige klantnamen** (klanten.json / MB-registry). Van daaruit wordt een
   **map in de "Nieuwe mappenstructuur"** gegenereerd (On-Prem-Data drive,
   drive-by-id, additief, conflictBehavior geen overwrite). Zie projectcode-
   systeem KLANT-LOC-PROD.
3. **Bijlagen → juiste klantmap:** vanuit de mail makkelijk bijlagen downloaden/
   opslaan naar de juiste klant/projectmap (als het een project wordt).
4. **Andersom — projectmap → tool:** bestanden die in de klant/projectmap zitten
   moeten in één oogopslag zichtbaar zijn in het **Projecten-tabblad** in de tool
   (bestandslijst per project, via Graph drive-listing van de projectmap).

## D. PROJECT-TAB — offerte-helper (nieuw, groot)

Vanuit het Projecten-tabblad een **offerte-helper** kunnen starten. Nu gebeurt
offerte-calculatie in een **Google Docs calculatie-sheet**; we bekijken wat
handiger is. Wensen:
- Wij vullen een **offerte-calculatie** in (de invoer die we nu in de Google-
  sheet doen).
- Calculatie wordt **bewaard in de projectmap én in de DB**.
- Van daaruit **direct een offerte in Moneybird genereren** (sales invoice /
  estimate), al dan niet **automatisch vooringevuld**.
- ⚠️ MB-write = onder Barts naam → **voorstel → bevestiging → schrijven**, nooit
  auto (vaste regel). Eerst de calculatie-UI + opslag; MB-generatie als laatste
  stap achter een knop met confirm.
- Onderzoek: huidige Google-sheet-structuur ophalen als referentie voor de
  velden/rekenregels (nacalculatie-methode staat al in memory:
  reference_nacalculatie_inkoop_methode).

## E. AGENDA — dropdown-filters verfijnen (NU/eerst)

- Dropdowns zijn **niet mooi uitgelijnd** → netjes uitlijnen.
- "Selecteer alles / niets" bovenin = **prima, houden**.
- **Zoekbalk bovenin de dropdown** toevoegen (zoals Toggl) om opties te filteren.
  De namen-data komt uit de nachtrun-fetch (Toggl projecten + users).
- **Onderkant: lijst klapt uit bij hover** met de muis (hover-expand).

## F. TOPBALK-CHAT — frissere vorm (NU/eerst)

- De centrale chat-trigger mag gewoon een **wit invoerveld** zijn met
  placeholder **"stel me een vraag?"** (i.p.v. de huidige knop). Bij focus/typen
  klapt het chatvenster eronder open. Past in de "witter/frisser"-richting.

## Volgorde-advies
1. NU (zolang tokens): B (inbox-layout), E (agenda-dropdown), F (topbalk-veld).
2. Ultra na 02:30: C (mail→project tag + map-gen + bijlagen), D (offerte-helper),
   bestandslijst projectmap→tool.
3. Later met Bart: A (volledige restyle / design-systeem).

## Vaste randvoorwaarden (niet onderhandelbaar)
- Additief bouwen, factuur/agenda/Focus-flows niet breken, eigen CSS-namespace.
- PUBLIC repo: geen PII/secrets in index.html; mail/koppel-data runtime of
  SharePoint-privé. Tags/koppelingen NIET in de repo committen.
- Mail-moves (indien gebruikt): test-op-1, undo, geen bulk, nooit verwijderen.
- SharePoint-writes additief, drive-by-id, geen overwrite.
- MB-/onder-Barts-naam-writes: voorstel→bevestiging→schrijven.
- Lokaal committen per feature; push alleen met expliciete Bart-OK.
