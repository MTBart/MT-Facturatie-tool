# Vectorworks & CNC — detail context

> Laden bij werk aan productieflow, CSV-import, NCR-bestanden of CNC-koppeling.

## Productieflow (stap voor stap)

```
Vectorworks (tekenprogramma)
  ↓ Exporteer: CSV + PGMX bestanden
  → map: Vectorworks Export/

Holzher optimalisatiesoftware
  ↓ CSV inladen → nestplan berekenen
  → Exporteer: HHA + NCR bestanden
  → map: Holzher Optimalisatie/data/

Zaagmachine (werkplaats)
  ↓ NCR bestanden inladen
  ↓ Tablet + stickerprinter gekoppeld
  → Stickers met QR-code → verwijzing naar PGMX bij CNC machine
```

## CSV-formaat (Vectorworks export)
- Bevat materiaalgroepen met aantallen en afmetingen
- Wordt gebruikt voor:
  1. Bestellijst genereren in index-v4.html
  2. Taken genereren in uren.html (subtaken onder "Productie")

## NCR bestanden (Holzher output)
- **Plaattelling:** P-parameter in A0-regels (hoogste P = aantal platen)
- **Platenmaat:** M1-regel, L en B in 1/10mm
- NOOIT A0-regels tellen — dat zijn snijbewegingen

## PGMX bestanden
- CNC programmabestanden voor Holzher frees
- QR-code op sticker verwijst naar het juiste PGMX-bestand bij de CNC machine
- Werkplaats tablet scant QR → laadt correct programma

## Koppeling met uren.html (geplande feature — stap 11)
Na CSV upload in index-v4.html:
1. Bestellijst blijft intact (bestaand)
2. Knop "Taken genereren" verschijnt
3. Klik → leest materiaalgroepen uit CSV
4. Maakt standaard taken aan voor project (als nog geen taken)
5. Subtaak per materiaalgroep onder "Productie": "18mm Spaanplaat — 12 platen"
6. Schrijft naar `mt_uren_taken` → direct zichtbaar in uren.html

**Functie:** `genereerUrenTaken(projectCode, csvData)` — aanroepen na bestellijst-render in index-v4.html

## Wie doet wat
- **Bart:** Vectorworks tekenwerk, CSV export, CNC programmering
- **Maarten:** Zaagmachine, CNC, werkplaatsproductie
- **Arjan:** Werkplaatsproductie
