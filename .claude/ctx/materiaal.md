# Materiaal & Productie — detail context

> Laden bij werk aan materiaallogica, NCR-bestanden, voorraad, bestellijst.

## NCR bestanden (Holzher output)
- **Plaattelling:** via **P-parameter** in A0-regels — neem de hoogste P-waarde = aantal platen
- **Platenmaat:** via M1-regel — L en B staan in 1/10mm (deelen door 10 voor mm)
- **NOOIT** de A0-regels tellen — dat zijn snijbewegingen, niet platen
- Bestanden staan in: `Holzher Optimalisatie/data/`

## Platenlogica
- Platen altijd in **stuks** (nooit m²) — aantallen uit NCR
- Herkenning platen op naam: egger, spaan, mdf, hpl, multiplex, berken, eiken + afmetingspatroon
- Kantenband: alleen herkennen als "kantenband" expliciet in de materiaalnaam staat

## m² berekening (alleen voor lak/spuit toeslag)
- Lak: €50/m²
- Spuit: €80/m²
- Trigger: "lak", "gelakt", "spuit", "fineer" in materiaalnaam

## Altijd bestellen (nooit op voorraad houden)
legrabox, blumotion, sensys, tip-on, varianta, keku, axilo, kastophanger, hettich, grass, blum, häfele

## Vectorworks CSV → materiaallijst
- CSV export uit Vectorworks bevat materiaalgroepen met aantallen
- In index-v4.html (Projecten-tab) CSV uploaden → bestellijst + taken genereren
- Materiaalgroepen worden subtaken onder "Productie" in uren.html
- Functie: `genereerUrenTaken(projectCode, csvData)` aanroepen na bestellijst-render

## Productieflow (stap voor stap)
1. Vectorworks → CSV + PGMX bestanden exporteren → map: `Vectorworks Export`
2. CSV inladen in Holzher optimalisatiesoftware
3. Holzher → HHA + NCR bestanden → map: `Holzher Optimalisatie/data`
4. Zaagmachine + tablet + stickerprinter
5. Stickers met QR-code → verwijzing naar PGMX bij CNC machine

## Platenmaat berekening voorbeeld
M1-regel voorbeeld: `M1;L=18000;B=27000` → 1800mm × 2700mm (standaard spaanplaat)
