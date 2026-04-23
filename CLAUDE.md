# Mortise & Tenon — MT Bedrijfstool

## Communicatiestijl
- Praat in gewone taal, geen technisch jargon tenzij uitgelegd
- Leg kort uit wat je doet en waarom, maar houd het beknopt
- Werk stap voor stap — niet alles tegelijk
- Geef af en toe een korte uitleg van een technisch begrip zodat Bart langzaam bijleert
- Als iets complex is: eerst de vraag "wil je weten waarom?" — niet automatisch uitleggen
- Vriendelijk en informeel, behandel Bart als slimme collega niet als klant
- Lees dit bestand altijd volledig bij het starten van een sessie
- **Update dit bestand actief tijdens de sessie** — niet alleen aan het einde:
  - Na elke nieuwe feature die gebouwd is
  - Als een prioriteit afgerond is
  - Als Bart nieuwe technische info geeft (API keys, bestandspaden, werkwijze)
  - Als iets niet werkt zoals verwacht en de aanpak verandert
- **Stel de update voor en vraag bevestiging** voordat je schrijft: "Ik ga CLAUDE.md bijwerken met X, akkoord?"
- Houd de "Openstaande prioriteiten" lijst actueel — vink af wat gedaan is, voeg toe wat nieuw is
- Schrijf aanpassingen beknopt en technisch zodat een volgende sessie direct verder kan
- Bij twijfel over context: vraag Bart, niet gissen
- **Waarschuw als je merkt dat je werkt met verouderde info** uit dit bestand

## Over het bedrijf
Bart en Mathijs runnen Mortise & Tenon, een maatwerkmeubelbedrijf in Wormerveer.
De tool is een nacalculatie- en bedrijfstool gebouwd als single-page HTML applicatie.

## Tool
- **Live URL:** https://mtbart.github.io/MT-Facturatie-tool/index-v4.html
- **GitHub repo:** mtbart/MT-Facturatie-tool
- **Huidig bestand:** index-v4.html (in deze map)
- **Cloudflare Worker (proxy):** mt-claude-proxy.bart-a12.workers.dev

## Moneybird
- **Administratie ID:** 342968480452052559
- **BTW 21%:** 342968481360119428
- **BTW 9%:** 342968481362216581
- **BTW 0%:** 348668107652335594
- **Bankrekening ING:** 343544076091524743

## Toggl
- **Workspace:** 21258443
- Bart, Arjan en Maarten gebruiken Toggl Track voor urenregistratie

## Projectnaamgeving
Format: `KLANT-LOCATIE-PRODUCT` (geen jaartal)
Voorbeelden: CN-BN-KEUKEN, LGM-OP-KAST, INT-WERKPLAATS

## Klantcodes
CN, LGM, MOS, STY, HWC, EZ, GBK, DV, JAN
- HWC en GBK lopen via Inter Projecten

## Productieflow
1. Vectorworks → CSV + PGMX bestanden → map: Vectorworks Export
2. CSV inladen in Holzher optimalisatiesoftware
3. Holzher → HHA + NCR bestanden → map: Holzher Optimalisatie/data
4. Zaagmachine + tablet + stickerprinter
5. Stickers met QR code → verwijzing naar PGMX bij CNC machine

## NCR bestanden (belangrijk!)
- Bevatten het exacte aantal platen na zaagoptimalisatie
- Plaattellingen via **P-parameter** in A0-regels (hoogste P = aantal platen)
- Platenmaat via M1-regel (L en B in 1/10mm)
- Niet de A0-regels tellen — dat zijn snijbewegingen, niet platen

## Tabbladen in de tool
1. **Dashboard** — KPI's live uit Moneybird (omzet, debiteuren, crediteuren, winst)
2. **Nieuwe factuur** — PDF uploaden, Claude leest uit, boeken in Moneybird
3. **Factuur controle** — inkoopfacturen reviewen op project/grootboek
4. **Projecten** — projectbeheer, NCR upload, Vectorworks CSV import
5. **Klanten** — live uit Moneybird, grid/lijst toggle
6. **Voorraad** — platen/kantenband/overig, sorteerbaar, leverancier matching
7. **Bestellijst** — te bestellen items, handmatig toevoegen, exporteren
8. **Geschiedenis** — verwerkte facturen, klikbaar naar factuur controle
9. **Instellingen** — API tokens, leveranciers, toeslagen, altijd-bestellen lijst

## Materiaallogica
- Platen altijd in **stuks** (nooit m²) — aantallen uit NCR
- m² alleen voor lak/spuit toeslag berekening
- **Lak toeslag:** €50/m² (standaard, aanpasbaar)
- **Spuitwerk toeslag:** €80/m² (standaard, aanpasbaar)
- Herkenning lak/spuit: "lak", "gelakt", "spuit", "fineer" in materiaalnaam
- Kantenband: alleen als "kantenband" expliciet in naam staat
- Platen: egger, spaan, mdf, hpl, multiplex, berken, eiken + afmetingspatroon

## Altijd bestellen (nooit op voorraad)
legrabox, blumotion, sensys, tip-on, varianta, keku, axilo, kastophanger, hettich, grass, blum, häfele

## Data opslag
- Alles in **localStorage** van de browser
- **Nog geen SharePoint sync** — dit is prioriteit voor volgende sessie
- Export/import JSON als tussenoplossing gewenst

## Openstaande prioriteiten
1. SharePoint sync voor data persistentie (localStorage is onbetrouwbaar)
2. Export/import JSON als tussenoplossing
3. Toggl koppeling (uren per project)
4. Mappenstructuur script (PowerShell/Power Automate)
5. Standaardproducten checklist per project
6. Bestellijst webshop links
7. Dashboard visueel verbeteren (meer zoals Jortt)

## Werkwijze
- Tool is één groot HTML bestand (~2500 regels)
- Aanpassingen via str_replace, niet het hele bestand herschrijven
- Na aanpassing direct opslaan in deze map
- GitHub push via: git add . && git commit -m "beschrijving" && git push
