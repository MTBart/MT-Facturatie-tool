# VOORTGANG opname-module

Branch `opname` (vanaf main v2.31.0), worktree `C:\Users\BartWitte\mt-worktrees\opname`. Niet gepusht, niet gemerged, geen release.

## Brok 1: rekenkern en datamodel (1-11-2026)

**Gedaan**
- `mt-opname-kern.js`: pure functies, globaal `MTOpnameKern` en `module.exports`, zelfde patroon als `mt-forecast-light.js`. Vragenlijst (`vragen`), tellers, sluitcontrole, rondje controle, vrijgeef-check, takenlijst, wijzigen met historie (`zetMaat`, `zetVoorstel`, `zetRondje`, `voegFotoToe`) en veilig lezen/migreren (`lees`).
- `test/opname-kern.test.js`: 34 tests. Controleert onder meer dat kamer Joe met werkzone Oost 21 basis en 16 werkzone geeft, dat de documentatie-voorbeeld-JSON leesbaar en ongewijzigd blijft, en dat invoer nooit wordt aangepast. Vijf bewust ingebrachte fouten in de kern werden door de tests gevangen.
- `docs/opname-json-v0.3.md`: het datamodel met een voorbeeld van kamer Joe (fictieve projectcode TEST-001).

**Uitkomst Joe:** basis 21, werkzone (Oost) 16, optioneel 1 (tweede diagonaal), extra 0. Gelijk aan het prototype. Basis: 4 wanden + plafond + diagonaal A + 3 ramen x 4 + 1 deur x 3. Werkzone: positie R3 tot rechterhoek + SC1 3 + SC2 3 + RAD2 3 + VB3 3 + PLO 3.

**Keuzes die ik zelf maakte (ter bevestiging)**
1. **Rondje op "later" blokkeert het vrijgeven** (code `rondje-later`), al telt het als bekeken. Het prototype liet dat wel door. Reden: later is nergens compleet. Eén constante omzetten: `K.RONDJE_LATER_BLOKKEERT`.
2. **Extra punten tellen mee voor het vrijgeven** (zoals in het prototype), ook al noemde de opdracht alleen basis en werkzone. Een punt dat de opnemer zelf koos te meten moet af of op n.v.t.
3. **Een ontbrekende definitie (muursparing/dagmaat/kozijn-buiten) is een waarschuwing, geen blokkade.** De meetproef zegt "afdwingen"; strenger maken is een kleine wijziging in `vrijgeefCheckRuimte`.
4. **Positie van een opening** is altijd vanaf de linkerhoek (kijkend naar de wand); de afstand tot de rechterhoek (`positie_rechts`) is een werkzonevraag. Zo komt het getal 16 uit. `positie_vanaf` laat een penant vanaf een andere opening meten (zoals R2 bij Joe).
5. **Teller x van n** telt later mee (zoals het prototype); daarnaast staat `compleet` (zonder later) voor het vrijgeven.
6. **Maat met staat gemeten maar bron foto-voorstel** (of zonder waarde) telt als open met een waarschuwing, en `zetMaat` weigert het. Het foto-voorstel zelf staat apart in `voorstel`.
7. **Geschiedenis append-only:** elke nieuwe stand van een maat bewaart de vorige in `historie` (OPTIES C10). Ook het weghalen van een rondjekeuze laat een spoor in `rondje_historie`.
8. **Object wordt bij `gezien: toch-meten` of `eigen` een extra punt**; een zelf toegevoegd object op een werkzone-wand telt als werkzone (prototype). `gezien` heeft de waarden `klopt`, `niet-aanwezig`, `toch-meten`.
9. **Migratie:** v0.2 en onbekende vormen worden niet omgezet maar volledig bewaard onder `_oud` (de wandletters A/B/C/D van v0.2 passen niet op N/O/Z/W). Nieuwere versie: alleen lezen. Onbekende staat/bron/waarde/werkzone blijven in `_staat_oud`, `_bron_oud`, `_waarde_oud`, `_onbekend`.
10. **Waarschuwingen (niet blokkerend):** meting-ongeldig, definitie-ontbreekt, onwaarschijnlijk (wand buiten 300 tot 15000 mm, plafond buiten 2000 tot 5000 mm), rondje-tegenspraak (afwezig terwijl er iets is vastgelegd), foto-zonder-ruimte.

**Bewust niet gedaan**
- Geen UI, geen wijziging in `mobiel.html`, `v2.html`, `sw.js`, `worker.js`; de module wordt nergens geladen.
- Geen opslag (SharePoint/IndexedDB), geen taken echt aanmaken (de kern levert alleen de lijst), geen DISTO-koppeling, geen foto-voorstellen berekenen.
- Geen plattegrond-oplossing (hoekpunten, sluitfout over de rondgang uit OPTIES C1), geen controle dat een opening in de wand past (C5), geen plafondspreiding (C8). Alleen de sluitcontrole van het prototype.
- Alleen vier wanden N/O/Z/W (rechthoekige topologie). L-vormen en nissen als aparte ruimte komen later.
- Geen Codex-ronde (datamodel en endpoints: één bundelronde aan het eind, volgens de werkafspraak).

**Open vragen**
- Kastwand: de meetproef wil de wandlengte op 3 hoogtes (boven plint, 1000 mm, onder plafond). FLOW-V3 vraagt één hoogte; ik volg FLOW-V3. Moet de werkzone-wand er twee extra lengtes bij krijgen?
- Hoeveel plafondpunten wil Bart bij een werkzone (meetproef: 4 hoeken + midden)? Nu één punt in de basis, de rest extra.
- Mag Mathijs (of Bart) een vrijgegeven opname weer openen, en moet dat in de historie staan? De kern kent alleen `status`; de overgangen komen met de UI.
- `bron: hand` dekt rolmaat en getypte DISTO-waarde. Is een apart onderscheid rolmaat/disto-getypt nodig?
