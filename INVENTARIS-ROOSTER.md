# Inventaris: wat het oude Rooster kan (planning P1a)

Voorwaarde voor P1b (planblok bewerken, "oud Rooster weg"): elke regel hieronder is aangevinkt als de functie een nieuwe plek heeft, of als Bart schrijft dat ze mag vervallen.
Stand na P1a (23-10): niets is verwijderd. Wat nu al in het planblokpaneel of in de Capaciteit zit, is gemarkeerd; de rest is open.

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
| [ ] | Toon geklokt (semi-transparant) naast de planblokken, uit Toggl | `agenda-plan-actuals` | Nog niet (plan tegenover werkelijk komt in P13) |
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
| [ ] | Weekraster met geklokte Toggl-uren per dag, blokken naast elkaar bij overlap, kleur op project of persoon | `agRenderGrid`, `agBlokkenHtml` | Nog geen vervanger (Uren-tab toont de eigen dag; een team-weekoverzicht van geklokte uren niet) |
| [ ] | Klik op een geklokt blok: persoon, project, taak, omschrijving, tijd, duur | `agBlokDetail` (`alert`) | Nog niet |
| [ ] | Kleur op project of persoon | `agenda-kleurop` | Nog niet |
| [ ] | Totalen per project en persoon (deze week en alle weken, met huidige filters) | `agRenderTotalen` | Nog niet |
| [ ] | Bladeren per week met oplichtende pijl als er uren vóór of na staan | `agendaNav`, `agenda-prev/next` | Capaciteit blaadert zelf, zonder die aanwijzing |
| [ ] | Statusregel "N entries in beeld · laatste sync" | `agenda-status` | Nog niet |

## C. Lijst-weergave (≣, timer-lijst)

| | Functie | Waar nu | Nieuwe plek |
|---|---|---|---|
| [ ] | Geklokte entries per dag met project, omschrijving, collega, tijd en duur, dagtotaal | `agRenderLijst` | Nog niet |
| [ ] | Klik op een rij: detail | `agBlokDetail` | Nog niet |

## D. Gedeeld in de Agenda-balk

| | Functie | Waar nu | Nieuwe plek |
|---|---|---|---|
| [ ] | ⬇ Sync nu (Toggl-entries ophalen, ook automatisch bij openen en na bladeren) | `agendaSyncNu`, `agAutoSync`, `agAutoSyncPlan` | Moet blijven zolang Rooster, Lijst of "toon geklokt" bestaan; de Uren-tab heeft eigen sync |
| [ ] | 🎯 Focus (Toggl Focus aansturen) | `focusOpen()` | Blijft in de balk; hoort niet bij het Rooster |
| [ ] | Aanwezigheidskaart bovenaan de Agenda | `aw-inhoud` | Niet onderdeel van het Rooster; blijft |
| [x] | Mijn werk, Capaciteit | nieuwe weergaven | Blijven |

## Open vragen voor Bart (voor P1b)

1. Welke knoppen verdwijnen: alleen **📋 Planning** (de planblokweergave met de vijf vensters), of ook **▦ Rooster** en **≣ Lijst** (geklokte uren)? Voor de geklokte uren is nog geen vervanger.
2. Is meervoudig filteren (meerdere projecten of personen tegelijk) nog nodig, of is één project en één persoon genoeg?
3. Mag "toon geklokt naast de planning" wachten tot P13 (plan tegenover werkelijk)?
