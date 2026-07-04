# Mortise & Tenon — 3D-website-prototype (v4 — schetsstijl)

> **v4 — geschetste exploded view / stift-arcering / handwerk-props.**
> Deze map is versie 4 van het 3D-intro-prototype. **v2 staat in
> `../prototype-3d/` en v3 in `../prototype-3d-v3/` ter vergelijking**
> (niet aankomen — Bart vergelijkt de versies element-voor-element).
> Kern van v4, op Barts richting ("geschetst en gestift is mooier en
> echter dan net-niet-computer-renders; luxe handwerk-vibes met
> schaafkrullen, zaagmeel en gepatineerd messing"): dezelfde geometrie en
> hetzelfde einde als v3, maar getekend als **hand-schets** — donker
> "papier" met crème stift-arcering en licht trillende crème contourlijnen
> (de beeldtaal van het lijn-logo), een **exploded view** als openingsbeeld
> (paneel gelift, gestreepte hulplijnen zoals in een technische schets),
> en werkplaats-props: een blokschaaf met gepatineerd-messing details,
> schaafkrullen en een hoopje zaagmeel.

Prototype voor de nieuwe publieke bedrijfswebsite: een cinematische intro
(een geschetste exploded view van de shakerdeur-hoek die zich soepel sluit
en overgaat in een dwarsdoorsnede) die overvloeit in een donkere,
Nederlandstalige one-page site in de officiële M&T-huisstijl.

## Huisstijl

Gebaseerd op het officiële huisstijl-document
(`../assets/mortise-tenon-logo-huisstijl.pdf`, PNG-versie ernaast):

- **Beeldmerk** — minimalistische lijn-doorsnede van de pen-en-gat-verbinding:
  dun omlijnd vierkant, verticaal gedeeld, met een rechthoekige verspringing
  van de deellijn halverwege (links het gat, rechts de pen). In dit prototype
  exact nagebouwd als inline SVG (intro, header én favicon — geen losse
  logobestanden nodig). Net als in v3 valt het eindframe van de 3D-doorsnede
  geometrisch samen met dit vierkant + de getrapte deellijn; in v4 is
  bovendien de héle scène in dezelfde beeldtaal getekend (crème lijnen op
  donker vlak).
- **Wordmark** — lowercase "mortise" boven en "& tenon" onder het vierkant,
  ruim gespatieerd.
- **Merkkleur** — `#3d2b2e` (PMS Pantone 5 / CMYK C58 M70 Y53 K67). Site-breed
  vertaald naar een donkere ladder op warm bruinzwart (`#14100f` …), gebroken
  warm wit (`#ece5e0`) voor tekst en logo-lijnen, en warm eiken
  (`#A0764A`/`#C9A87C`, dezelfde toon als het hout in de 3D-scène) als enige
  accent. De cockpit-kleuren (groen `#2A4A38`, goud `#B8962E`/`#E8D48A`)
  worden hier nooit gebruikt — dat is de interne tool.
- **Letterfont** — de huisstijl schrijft "New Order" voor (teksten in het logo:
  medium). Dat font is commercieel; als web-vervanger gebruikt de site **Jost**
  (Google Fonts) met een geometrische fallback-stack (Century Gothic / Futura).
  Lopende tekst blijft in de Segoe UI-stack.

## Openen

Dubbelklik op `index.html` — meer is niet nodig. Er is geen build-stap en
geen server vereist; alles draait direct vanaf schijf (`file://`).

Enige voorwaarde: een internetverbinding bij het openen, want Three.js en
het kopletter-font (Jost) komen van een CDN. Zonder internet valt de intro
automatisch terug op een nette logo-variant zonder 3D en gebruikt de site de
lokale geometrische fallback als kopletter — de site zelf blijft volledig
werken.

## Bestanden

| Bestand | Rol |
|---|---|
| `index.html` | Structuur: intro-sectie + de hele site (hero, over ons, werkwijze, projecten, contact) |
| `style.css` | Alle vormgeving, incl. design-tokens (kleuren/fonts) bovenin in `:root` |
| `main.js` | De 3D-intro (Three.js) + site-gedrag (scroll-reveals, menu) |

## De intro-sequentie (~12,5 seconden)

1. **Exploded view & assemblage (v4)** — in een ronde vignette staat de
   **shakerdeur-hoek als geschetste exploded view**: de verticale **stijl**
   met **gat (mortise)** en **paneelgroef**, de horizontale **regel (rail)**
   met **haunched pen** op afstand vóór het gat, en het **paneel gelift
   boven de groef**. Gestreepte crème hulplijnen (as pen→gat, val-lijn van
   het paneel) markeren de assemblage zoals in een technische schets.
   Daarnaast op de werkbank: een **blokschaaf** met gepatineerd-messing
   knop en beitel, **schaafkrullen** en een hoopje **zaagmeel**. Dan sluit
   de exploded view zich **soepel**: het paneel zakt in de railgroef, de
   rail glijdt de stijl in (glide-easing, géén tikken), de hulplijnen
   vervagen. Hooguit een dun stofsliertje als de schouder zacht aanzet.
2. **Roteren naar de doorsnede** — de camera zwenkt soepel naar
   recht-van-voren (face-on) en zoomt in op de verbinding.
3. **Dwarsdoorsnede** — een Three.js **clipping plane**
   (`renderer.localClippingEnabled` + `clippingPlanes` op de hout-materialen)
   veegt het front weg en toont de dwarsdoorsnede; een donker cap-vlak maskeert
   de open mesh-caps zodat het als een getekende doorsnede leest.
4. **Orthografisch uitlijnen op het logo** — de camera trekt verder terug en
   knijpt de FOV dicht (bijna-orthografisch), zodat het y-z-profiel van de
   doorsnede samenvalt met de logo-geometrie: het vierkant + de getrapte
   deellijn (het trapje = de haunch-verspringing).
5. **Logo** — crossfade naar het officiële merk: het lijn-vierkant tekent
   zichzelf (stroke-animatie), daarna faden "mortise" / "& tenon" en de
   tagline "maatwerk interieurbouw" in.
6. **Reveal** — de ronde vignette opent zich (iris-effect) en de site
   eronder komt tevoorschijn.

Bediening:
- **Overslaan-knop** rechtsonder, of de **Escape-toets**.
- Bezoekers met `prefers-reduced-motion` krijgen de intro helemaal niet:
  zij landen direct op de site.
- JS-API: `window.playIntro()` en `window.skipIntro()`.
- Alle timings staan in het `TL`-object bovenin `main.js`
  (`glideStart`/`glideEnd`, `rotateStart`/`rotateEnd`, `clipStart`/`clipEnd`,
  `orthoStart`/`orthoEnd`, `logoIn`, `revealStart`/`revealEnd`).

## 3D later vervangen door echte video

De intro is bewust zo gebouwd dat de 3D-scène 1-op-1 vervangen kan worden
door een echte filmopname (bv. een meubelmaker die een verbinding in elkaar
schuift). In `index.html` staat boven `#intro` een commentaarblok met de
exacte instructie; kort samengevat:

1. Zet in `#intro-stage` een `<video autoplay muted playsinline
   src="intro.mp4">` in plaats van het canvas.
2. Laat vignette, logo-crossfade en iris-reveal ongemoeid — die zijn
   HTML/CSS en werken hetzelfde over video als over 3D.
3. Stem in `main.js` de tijdstippen in het `TL`-object af op de montage
   van de clip (wanneer logo-fade en reveal starten).

## Gemaakte keuzes (v4 — bovenop v3)

- **Schetsstijl i.p.v. fotorealisme** — Barts richting: "alles moet luxe en
  passie ademen en ik vind geschetst en gestift veel mooier en echter dan
  net niet computer renders." Geen houttextuur meer maar donker "papier"
  (`paperTexture`: zachte lichtvlekken + diagonale stift-arcering + korrel,
  alles in crème `#ece5e0` op warm bruinzwart) met `MeshLambertMaterial`.
- **Trillende contourlijnen** — elke vorm krijgt via `sketchEdges()` twee
  crème `EdgesGeometry`-passes met licht verschoven hoekpunten
  (`jitterEdges`) — één vol, één zacht. Dubbel omdat `linewidth` op Windows
  genegeerd wordt; de jitter maakt het handgetekend. De lijnmaterialen
  zitten mee in `jointMats` zodat ze met de doorsnede-clip meegeveegd worden.
- **Exploded view als openingsbeeld** — het paneel start `PANEL_LIFT` boven
  de railgroef en zakt in de eerste ~1,2 s van de glide op zijn plek;
  gestreepte `LineDashedMaterial`-hulplijnen (as pen→gat, val-lijn paneel)
  vervagen zodra de assemblage loopt. Zo is fig-1-uit-de-schetsreferentie
  het eerste dat je ziet.
- **Werkplaats-props** — blokschaaf (romp/zool hout, knop + beitel in
  gepatineerd messing `#6e6650` — bewust GEEN cockpit-goud), drie
  schaafkrullen (`TubeGeometry` op een spiraal-`CatmullRomCurve3` + crème
  schetslijn) en zaagmeel (`Points` in eiken `#c9a87c`). Ze staan buiten
  het clip-kader en zitten dus niet in `jointMats`.
- **Licht vlakker** — ambient omhoog, spot omlaag: een schets heeft geen
  hard filmisch licht nodig; de arcering doet de schaduwwerking.
- **Zelfde geometrie + einde als v3** — de exact-tegelende verbinding
  (gat/groef/haunch), de clip-doorsnede en de ortho-uitlijning op het logo
  zijn ongewijzigd; alleen de huid is anders.

## Gemaakte keuzes (v3 — geërfd)

- **Shakerdeur-hoek i.p.v. balken** — de stijl en de regel hebben
  meubel-proporties; de stijl heeft naast het gat een echte paneelgroef en
  een stukje vlak paneel, zodat het als deurhoek leest en niet als grove
  balkverbinding. Zo sluit het aan op "dit is meer houtbouw / interieur".
- **Haunched (getrapte) pen** — naast de volle pen zit een korter, verlaagd
  stukje (de haunch) dat het open groefeind opvult. Het trapje in de pen is
  precies de verspringing in het logo en versterkt de doorsnede-morph.
- **Soepele beweging** — de rail schuift met glide-easing (`easeInOutSine`)
  soepel dicht; géén drie tikken, géén terugvering, géén camera-schok en géén
  stofwolk-bursts. Hooguit één dun stofsliertje als de schouder zacht aanzet.
  Geen hamer meer op de bank.
- **Werkplaats-sfeer** — één warme bovenlichtbundel (in v4 zachter),
  zwevende stofdeeltjes (dust motes, in v4 crème hertint), en enkele vage
  werkbank-silhouetten (in v4 donker vlak + vage crème contour) die via
  dichtere fog in het duister wegvallen.
- **Einde via clipping plane + ortho-uitlijning** — na het samenschuiven
  roteert de camera face-on, een clipping plane veegt de dwarsdoorsnede open
  (donker cap-vlak maskeert de open caps), en het frame lijnt orthografisch
  uit op de logo-geometrie vóór de crossfade.
- **Three.js r128 als globaal script** (geen ES-modules): de enige variant
  die betrouwbaar werkt vanaf `file://` zonder server én met `node --check`
  te controleren is. `renderer.localClippingEnabled = true` voor de
  dwarsdoorsnede.
- **Procedurele texturen** via canvas (in v4: papier + stift-arcering
  i.p.v. eikennerf) — geen externe afbeeldingen nodig, laadt altijd.
- **Geen secrets, geen API-calls, geen externe data** — puur statisch.
- Projectkaarten zijn placeholders met CSS-houttinten; bedoeld om later
  door echte projectfoto's vervangen te worden.

## Copy (v3)

De teksten leggen de nadruk op **passie en handwerk**, ondersteund door de
**nauwkeurigheid en precisie van de (CNC-)machine** — vakmanschap voorop, de
machine als precisie-ondersteuning, niet andersom (hero, over-ons,
werkwijze/productie en de feiten-blokken). Dit is een eerste voorzet;
definitieve redactie + echte projectfoto's volgen.

## Nog in te vullen (placeholders)

- **Adres**: "Ambachtsweg 12" in het contactblok is verzonnen — vervangen
  door het echte werkplaatsadres.
- **Projectfoto's**: de zes kaarten onder Projecten wachten op echt werk.
- **Copy**: alle teksten zijn een eerste voorzet in de nieuwe toon (5f),
  nog niet definitief.
