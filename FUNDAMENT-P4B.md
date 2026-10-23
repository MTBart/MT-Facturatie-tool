# FUNDAMENT P4b: de tijdlijn bewerken

Branch `planning-p4b` (op `planning-f2b`). Dit document beschrijft het ontwerp, zodat een reviewer weet wat bedoeld is.

## Wat het doet
- Een knop **Bewerken** in de Tijdlijn (alleen met het recht om te plannen of af te hangen). Standaard blijft de tijdlijn alleen-lezen: een klik opent de taak. In de stand Bewerken kiest een klik een taak (balk of naam), en verschijnt er een balk met `Open taak`, `Verplaatsen…`, `Koppelen…` en `Kies niets`.
- **Slepen** (niet op een smal scherm zoals een telefoon): het midden van een balk verplaatst, de randen rekken, het bolletje rechts van de balk trekt een afhankelijkheid naar de rij van een andere taak (ook in een ander project). Een afgeronde taak kan niet slepen (wel koppelen); een mijlpaal kan alleen verplaatsen.
- **Zonder slepen** (de enige weg op de telefoon, en voor toetsenbord en screenreader): `Verplaatsen…` (nieuwe start en eind) en `Koppelen…` (deze taak komt ná of vóór een andere taak, project en taak kiezen, type en wachttijd).
- **Voorbeeld tijdens het slepen:** de nieuwe datums staan bij de cursor, met het aantal opvolgers dat meeschuift (spookbalken op hun rij) en het aantal dat vast blijft. Dit is alleen kijken (`MTPlanning.verschuifVoorstel`, modus flexibel); Escape breekt af en er is niets geschreven.
- **Het type** van een getrokken koppeling kies je achteraf in een klein menu (EB, BB, EE, BE, Annuleren). Een kring of een dubbele koppeling wordt in dat menu uitgelegd (geen typeknoppen) en niet aan de route aangeboden.

## Opslaan: alleen bestaande veilige routes
- Datums (verplaatsen en rekken): `D.datums` = `MTCapaciteitNieuw.drop({ soort: 'taakdatums', … gezien })`, dezelfde planroute als het taakpaneel en de Capaciteit: vers lezen, `gezien`, de vraag of de opvolgers mee moeten, de controle op weekend en vrije dagen, melding met Ongedaan maken. De tijdlijn schrijft nooit zelf.
- Koppelingen: `D.wijzig` = `tpWijzig` met `afhOps` (F2a/F2b): het record staat bij het project van de opvolger (`code` = project van de opvolger; bij een voorganger uit een ander project `van_project`), kringcontrole over projecten heen, stempel per veld, Ongedaan maken via `D.wijzigHerstel`. De tijdlijn toetst vooraf (`Tl.koppelToets`) alleen om de gebruiker te informeren; de route toetst opnieuw op de verse stand.
- Rechten: `D.mag.plannen` (zoals slepen in de Capaciteit) voor datums, `D.mag.alles` voor koppelen. Zonder recht staat de knop Bewerken er niet.
- `mt-tijdlijn.js` heeft zelf geen opslag of netwerk (b-tl-harness bewaakt dat).

## Rekenregels van het slepen (`Tl.nieuweDatums`)
Delta in kalenderdagen (beeldpunten per dag volgen de zoom). Een nieuwe start of eind landt altijd op een werkdag (richting van het slepen; weekend en vrije dagen tellen niet). Verplaatsen behoudt de duur in **werkdagen** (`werkdagenTussen` / `addWerkdagen`). Rekken: het eind komt niet voor de start, de start niet na het eind; een rand die op zijn plaats blijft geeft niets.

## Bekende beperkingen
- Het voorbeeld rekent met de planning zoals de tijdlijn die kent; de uitkomst van de planroute (inclusief de vraag over de opvolgers) is bepalend.
- Slepen gebruikt pointer events en staat uit op een smal scherm (telefoon, tot 640 px); daar dienen de knoppen.
- Alleen taken met datums hebben een balk en dus een bolletje; als doel van een koppeling werkt elke taakrij.
