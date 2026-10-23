# Inventaris: wat het oude Rooster kan (planning P1a)

Voorwaarde voor P1b (planblok bewerken, "oud Rooster weg"): elke regel hieronder is aangevinkt als de functie een nieuwe plek heeft, of als Bart schrijft dat ze mag vervallen.
Stand na P1a (23-10): niets is verwijderd. Wat nu al in het planblokpaneel of in de Capaciteit zit, is gemarkeerd; de rest is open.
Stand na G1 (23-10): de geklokte uren (deel B, C en D) zitten als laag **Geklokt** in de Capaciteit; ▦ Rooster en ≣ Lijst staan alleen nog achter `?oud-rooster=1` (één release als vangnet, alleen in de nieuwe stijl).

"Het oude Rooster" is in de code drie knoppen van Agenda: **▦ Rooster** (`agRenderGrid`, geklokte Toggl-uren per week), **≣ Lijst** (`agRenderLijst`, dezelfde uren als lijst) en
**📋 Planning** (`agPlanRender`, de planblokken per week). De plannotitie zegt "de vijf tekstvensters en het oude Rooster verdwijnen"; de vijf tekstvensters zitten in de Planning-weergave
(`agPlanNieuwFormulier`). Welke van de drie knoppen Bart bedoelt, is een vraag voor hem; deze lijst dekt ze alle drie, zodat er niets verloren gaat welke hij ook kiest.

Legenda: `[x]` heeft al een plek (zie kolom), `[ ]` nog niet, `[?]` vraag aan Bart.

## A. Planning-weergave (📋, planblokken in `mt_planblokken`)

| | Functie | Waar nu | Nieuwe plek |
|---|---|---|---|
| [x] | Planblokken per dag en uur zien (persoon, tijd, duur, project, taaknaam, kleur per project) | `agPlanRender` | Capaciteit (week, 3 dagen, dag) |
| [x] | Een planblok openen en alle gegevens zien | klik opende een prompt-menu | **P1a:** planblokpaneel `#planblok/<id>` (alleen lezen), vanuit Planning, Capaciteit en Mijn werk |
| [x] | Van een planblok naar persoon, dag, taak en project | niet mogelijk | **P1a:** links in het planblokpaneel |
| [x] | Een blok naar een andere dag of tijd slepen | `agPlanDragStart`, `agPlanDrop` | Capaciteit (slepen, "Verplaats naar…" voor het toetsenbord): dezelfde controles en dezelfde schrijfroute |
| [x] | Waarschuwing bij verlof, verplichte vrije dag of een dag waarop iemand niet werkt, met "Toch inplannen" of "Annuleren" | `capWaarschuwing` in `agPlanDrop` | Capaciteit: `MTPlanVerplaats.waarschuwing` (één bron, ook in de oude route) |
| [x] | Vers lezen vóór verplaatsen, één drop tegelijk, tweede bevestiging na wachten, melding "iemand anders verplaatste dit blok" | `agPlanDrop` | Capaciteit via `capVerplaats` |
| [ ] | Een nieuw planblok maken door op een lege plek te klikken (persoon, project, taak, starttijd, duur: vijf `prompt()`-vensters) | `agPlanDagKlik`, `agPlanNieuwFormulier` | **P1b** (formulier in het paneel). Nu alleen in de oude Planning-weergave; in de Capaciteit maak je een blok via Ongepland |
| [ ] | Starttijd uit de klikpositie (kwartier nauwkeurig) | `agPlanDagKlik` | P1b |
| [ ] | Verlofcontrole bij een nieuw blok ("X heeft verlof op dag") | `agPlanNieuwFormulier` | P1b (zelfde `waarschuwing`) |
| [ ] | Een planblok verwijderen (tombstone, niet weghalen) | `agPlanBlokMenu` keuze 1 | P1b. Tot dan: knop "Verwijderen of voorstel beslissen…" in het planblokpaneel (roept het bestaande menu aan) |
| [ ] | Notitie van een blok (veld bestaat, geen scherm om hem te wijzigen) | `notitie` in het blok | P1b: tonen is al in het paneel (alleen lezen), bewerken P1b |
| [x] | Verplichte vrije dag blokkeert plannen (slotje) | `agPlanDagKlik`, overlay | Capaciteit toont vrije dag/verlof; blokkeren zit in `waarschuwing` |
| [ ] | Optionele vrije dag als gele overlay met naam | `agPlanRender` | Controleren of de Capaciteit "optioneel" toont; zo niet, in P1b |
| [ ] | Capaciteitsbalk per persoon boven de week (gepland / beschikbaar, rood bij te veel, klik = filter op die persoon) | `agPlanCapBalk` | Capaciteit toont per persoon en dag "gepland / beschikbaar"; de klik-om-te-filteren is er nu de balk (Wie) |
| [ ] | Persoonsfilter via de capaciteitsbalk (`agTogglPersFilter`) | oude Planning | Gedeelde filterbalk (P0) |
| [x] | Filter op project en persoon (meervoudig, zoeken in de lijst) | `ag-drop` Projecten/Personen | Gedeelde filterbalk (P0): één project en één persoon. **Verschil:** meervoudig kiezen bestaat in de nieuwe balk niet |
| [x] | Toon geklokt (semi-transparant) naast de planblokken, uit Toggl | `agenda-plan-actuals` | **G1:** laag Geklokt in de Capaciteit (knop "Geklokt"): dunne strook onder de blokken in de uurweergave, "geklokt … / gepland …" in week, maand en kwartaal |
| [x] | Voorstellen van de werkplaats: gestippeld blok met label "Voorstel" | `pv-voorstel` | Capaciteit (gestippeld, chip "voorstel") |
| [ ] | Voorstel **goedkeuren** of **afwijzen** (met reden) door kantoor | `agPlanBlokMenu` (`PV.keurGoed`, `PV.wijsAf`) | P1b. Tot dan via de knop in het planblokpaneel. (Voor taakvoorstellen bestaat Overnemen/Afwijzen al in Mijn werk en het taakpaneel) |
| [ ] | Eigen voorstel **intrekken** | `agPlanBlokMenu` (`PV.trekIn`) | P1b (zelfde knop in het paneel) |
| [ ] | Werkplaats dient een **voorstel** in door op een lege plek te klikken | `agPlanNieuwFormulier` (`pvMoetVoorstel`) | P1b |
| [ ] | Melding "Je voorstel is goedgekeurd / afgewezen" met OK, en "N voorstellen wachten op goedkeuring" | `pvTeken` | Controleren of Vandaag/Mijn werk dit tonen; zo niet, in P1b |
| [ ] | Rolregels: werkplaats mag niet slepen of wijzigen, alleen voorstellen | `capMagSlepen`, `pvMoetVoorstel` | Blijft zo; het paneel (P1a) is voor iedereen alleen-lezen |
| [x] | Planblokken tellen mee in de raming van een taak (aftrek) en in de Capaciteit | `MTPlanning.taakBlokkenVan` | Ongewijzigd |
| [ ] | Planblokken op de projecttijdlijn (project en klant) | `projPlanTijdlijn` (`planBlokkenFilter`) | Niet onderdeel van het Rooster, maar leest hetzelfde filter: `planBlokkenFilter` mag dus niet weg zonder vervanger |

## B. Rooster-weergave (▦, geklokte uren per week)

| | Functie | Waar nu | Nieuwe plek |
|---|---|---|---|
| [x] | Weekraster met geklokte Toggl-uren per dag (per persoon, de hele week naast het geplande) | `agRenderGrid`, `agBlokkenHtml` | **G1:** laag Geklokt. Dag en 3 dagen: een dunne strook per persoon op de echte tijd (tijd in Amsterdam). Week: regel "geklokt … / gepland …" in elke dag. Maand: streepje (+ getal bij ruimte). Kwartaal: uren per week. **Verschil:** blokken die overlappen liggen over elkaar (niet naast elkaar); het detail toont ze allemaal |
| [x] | Klik op een geklokt blok: persoon, project, taak, omschrijving, tijd, duur | `agBlokDetail` (`alert`) | **G1:** een klein detailvenster (geen `alert`) met project (knop naar het project), taak, omschrijving, tijd en duur; ook met het toetsenbord. Klik op de dagregel in de week of de maand toont alle blokken van die dag met het totaal |
| [x] | Kleur op project of persoon | `agenda-kleurop` | **G1:** kleur van het project; "persoon" is de rij zelf. De keuze "Kleur op" geldt nog alleen voor de oude weergaven |
| [~] | Totalen per project en persoon (deze week en alle weken, met huidige filters) | `agRenderTotalen` | Per **persoon**: de regel onder de naam ("geklokt 32u / gepland 40u", week in het midden van beeld, dezelfde periode als het belastingbadge). Per **project**: nog niet; hoort bij de projectenlijst en het plan-tegenover-werkelijk (P9a/P13) |
| [x] | Bladeren per week met oplichtende pijl als er uren vóór of na staan | `agendaNav`, `agenda-prev/next` | Vervalt: de Capaciteit heeft een doorlopende tijdas (geen weken). Wie weken zonder uren zoekt, ziet het aan de lege strook |
| [x] | Statusregel "N entries in beeld · laatste sync" | `agenda-status` | **G1:** onder de Capaciteit: bron (Toggl), laatste sync, aantal regels in beeld, en de hint dat een week die nog niet gesynct is leeg kan lijken (dan Sync nu) |

## C. Lijst-weergave (≣, timer-lijst)

| | Functie | Waar nu | Nieuwe plek |
|---|---|---|---|
| [~] | Geklokte entries per dag met project, omschrijving, collega, tijd en duur, dagtotaal | `agRenderLijst` | **G1:** per persoon en dag via de dagregel (week, maand) of het blok (dag): tijd, duur, project, taak, omschrijving en het totaal. **Verschil:** niet alle collega's van één dag onder elkaar als tekstlijst (vraag 4) |
| [x] | Klik op een rij: detail | `agBlokDetail` | **G1:** het detailvenster (zie B) |

## D. Gedeeld in de Agenda-balk

| | Functie | Waar nu | Nieuwe plek |
|---|---|---|---|
| [x] | ⬇ Sync nu (Toggl-entries ophalen, ook automatisch bij openen en na bladeren) | `agendaSyncNu`, `agAutoSync`, `agAutoSyncPlan` | Blijft in de balk van de Agenda en werkt voor de laag Geklokt (na een sync tekent de Capaciteit opnieuw). Het automatisch bijwerken bij het openen van de Agenda blijft; **bladeren** in de Capaciteit haalt niets op (G1 maakt geen nieuwe aanroep): oudere weken staan er na één keer Sync nu (12 maanden) |
| [ ] | 🎯 Focus (Toggl Focus aansturen) | `focusOpen()` | Blijft in de balk; hoort niet bij het Rooster |
| [ ] | Aanwezigheidskaart bovenaan de Agenda | `aw-inhoud` | Niet onderdeel van het Rooster; blijft |
| [x] | Mijn werk, Capaciteit | nieuwe weergaven | Blijven |

## Open vragen voor Bart (voor P1b)

1. Welke knoppen verdwijnen: alleen **📋 Planning** (de planblokweergave met de vijf vensters), of ook **▦ Rooster** en **≣ Lijst** (geklokte uren)? Voor de geklokte uren is nog geen vervanger.
2. Is meervoudig filteren (meerdere projecten of personen tegelijk) nog nodig, of is één project en één persoon genoeg?
3. Mag "toon geklokt naast de planning" wachten tot P13 (plan tegenover werkelijk)? **Beantwoord door G1:** de laag Geklokt staat er nu, per persoon naast het geplande; P13 (analyse per project en afwijking) blijft.
4. (G1) Is de collega-lijst per dag in tekst ("Lijst per dag, het hele team") nog nodig, of volstaat het detail per persoon en dag? Zonder bezwaar vervalt de Lijst na deze release samen met het Rooster.
5. (G1) Moet het automatisch bijwerken uit Toggl ook meebladeren in de Capaciteit (nu alleen bij het openen en met Sync nu)? Dat is een nieuwe aanroep per week en dus een aparte keuze.
