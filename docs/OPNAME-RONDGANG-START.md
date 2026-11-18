# Ruimte-opname: zo begin je (proefversie 18-11-2026)

Eén kamer rondlopen met de S24: tijdens dezelfde rondgang komen de contourlijnen in beeld, worden de beelden voor het rondkijken
verzameld en zet je details met foto en maat op hun plek. Op kantoor open je het pakket (zip) en kijk je met de muis rond.

Pagina's (na publicatie): `docs/opname-ar-proef.html` (telefoon) en `docs/opname-ar-kijk.html` (kantoor). Tot die tijd staan ze
alleen op de werkbranch.

## Samsung S24 (Chrome)

1. Open de telefoonpagina in Chrome. Vul **Project** en **Ruimte** in en tik **Nieuwe ruimte: start rondgang**. Geef de camera toestemming.
2. Beweeg rustig over een vrij stuk vloer tot de vloer gevonden is.
3. Loop de kamer rond en tik elke hoek aan met de ronde duimknop **Hoek**. Wat je in beeld ziet:
   - **het draadmodel** (groene vloerlijn, witte staanders, oranje plafondlijn zodra het plafond bekend is): de wanden die jij hebt bevestigd door de hoeken te tikken;
   - **Vlakken** (knop bovenin, standaard uit): toont ook de vlakken die de telefoon zelf herkent als blauwe lijnen. Ze worden altijd als ruw scanvoorstel bewaard;
   - **plattegrondje linksonder**: rode stip = jij, de ring eromheen = richtingen waar al beeld van is (groen) of nog niet (grijs), ▲ ▼ = omhoog en omlaag.
4. **Bij elke hoek gaat er vanzelf een scherpe foto.** Richt daarna even omhoog, recht boven die hoek: dan gaat er ook een foto van de plafondhoek
   (je voelt een korte tril). Overslaan mag: tik gewoon de volgende hoek.
5. **Foto** (knop rechts van de duimknop): ga zo staan dat een hele wand in beeld is en druk. Je ziet of de hele wand erop stond; die foto gaat in het
   panorama voor. De vakjes op de muur kleuren groen waar beeld is.
6. De beelden voor het rondkijken worden vanzelf verzameld. Sta je even stil en ontbreekt er rond die plek echt een richting, dan
   verschijnt bijvoorbeeld *"Draai hier even naar links en omhoog"*. Geen aparte panoramaronde nodig.
7. **Detail** (knop links van de duimknop): richt het kruisje op het onderdeel (bijv. het hart van een cv-leiding) en druk. De telefoon
   maakt een scherpe foto en koppelt het detail aan de wand en hoogte onder het kruisje. Kies de soort, kies vanaf welke binnenhoek je meet,
   en vul de maten in. Het **oranje veld** is waar de DISTO X4 (als toetsenbord) zijn maat neerzet; Enter gaat naar het volgende veld.
   Een veld leeg laten = open vraag. Tik **Klaar**.
8. Tik **Klaar** bovenin als de kamer rond is. Vul daarna de wandmaten, de plafondhoogte en een controlemaat (diagonaal) in.
   Onder **Nog open vóór vertrek** staat wat nog ontbreekt.
9. **Hoeken nakijken**: open per hoek de foto en tik de echte hoek aan (rood = waar je tikte). De app rekent de plek om; de tik blijft bewaard en
   kan terug. Daarna opnieuw **Wanden aan elkaar plakken**.
10. **Wanden aan elkaar plakken** maakt de wandbeelden; **Pakket maken (zip)** of **Pakket delen** levert het bestand voor kantoor.

Alles wordt tijdens de rondgang al op de telefoon bewaard (je ziet "Veilig bewaard: …"). Gaat er iets mis met opslaan, dan verschijnt
een rode melding met **Opnieuw proberen**. Pagina dicht of telefoon uit: open de pagina opnieuw, kies de ruimte onder
**Opnames op deze telefoon** en ga verder. **Aanvullen: nieuwe rondgang** vraagt eerst om H1 en H2 opnieuw aan te tikken (uitlijnen);
lukt dat niet, kies **Apart**: die rondgang wordt dan apart bewaard en niet samengevoegd.

## Kantoor-pc (Chrome of Edge)

1. Open de kantoorpagina en kies **Bestand kiezen** → het zip-pakket.
2. **Slepen** = rondkijken, **scrollen** (of + en −) = zoomen, **pijltjes/WASD** = lopen, **Van boven** = poppenhuis.
3. **Witte rondjes** in beeld en **blauwe stippen** op de plattegrond zijn kijkpunten: klik om daar te gaan staan.
4. **Groene labels H1, H2, …** zijn de hoeken: klik voor de hoekfoto met de getikte (rood) en gecorrigeerde (groen) plek.
5. **Gekleurde labels** zijn details (rood = installatie, blauw = bouwdeel, bruin = afwerking, grijs = meubel, paars = kleur/textuur;
   een vraagteken = er staat nog iets open). Klik voor de originele foto, de maten met bron (DISTO X4, handmaat, camera), status en tijd,
   de rode maatlijnen op de wand en de open vragen. Sluiten laat de kijkrichting staan.
6. **Dossier** toont het lijnmodel in mm (oorsprong, assen, wandlengtes met status), de controlematen, alle onderdelen per groep,
   opmerkingen, open vragen en de rondgangen (toestel, beelden, hoe vaak getikt en hoe vaak de camera iets zelf vond, trackingverlies).
   Op stukken wand zonder beeld staat een oranje arcering: dat is een gat, geen kleur van de muur.

## LiDAR-iPhone

Nog **niet gebouwd** in de MT-app. Safari geeft een webpagina geen toegang tot de LiDAR en kent geen AR-sessie zoals Chrome op Android.
De live contourlijnen van Apple (RoomPlan) zijn alleen bereikbaar vanuit een eigen iOS-app. Voor nu:

- Gebruik **Nomad** als referentie in dezelfde kamer en vergelijk hoe wanden, deur/raam en een korte nis op hun plek blijven.
- Stuur een echte **Nomad-export** (alle bestanden die Nomad maakt) mee: dan kan ik toetsen wat erin zit (onderdelen, ID's, assen,
  eenheden, foto's) en een import naar dit dossier bouwen. Een import geeft geen live scan in de MT-app.
- Een eigen iOS-onderdeel met RoomPlan is een mogelijke vervolgstap. Dat vraagt een Mac met Xcode, een Apple-ontwikkelaarsaccount
  en een iPhone Pro met LiDAR als testtoestel.
