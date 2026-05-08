# Productieflow

Lees dit als een vraag gaat over: Vectorworks, Holzher, NCR, PGMX, HHA, zaagmachine, optimalisatie, stickers/QR, plaattelling, CNC.

## Flow
1. **Vectorworks** → CSV + PGMX bestanden → map: `Vectorworks Export`
2. **Holzher optimalisatiesoftware** ← CSV inladen
3. **Holzher** → HHA + NCR bestanden → map: `Holzher Optimalisatie/data`
4. **Zaagmachine** + tablet + stickerprinter
5. Stickers met **QR code** → verwijzing naar PGMX bij CNC machine

## NCR-bestanden lezen
- **Plaattellingen:** via **P-parameter** in A0-regels — hoogste P = aantal platen
- **Plaatafmetingen:** via M1-regel — L en B in 1/10mm
- **NIET** A0-regels tellen — dat zijn snijbewegingen

## Vectorworks-koppeling (wens)
Zie uren-tool.md — stap 11. Optie: eigen Vectorworks-plugin (mogelijk via Vectorworks SDK / VectorScript / Python) die direct uploadt naar uren.html of de tool, naar voorbeeld van InteriorCAD (Duitse versie) die gekoppeld is aan een ERP met materialen + prijzen. Zelf bouwen is op tafel.

## Bestandsformaten
| Extensie | Wat |
|---|---|
| `.csv` | Vectorworks export (input voor Holzher) |
| `.pgmx` | Vectorworks bewerkingsbestand (per onderdeel, bij CNC) |
| `.hha` | Holzher output |
| `.ncr` | Holzher output (bevat plaattelling P-parameter) |
| `.dwg` `.max` `.3ds` `.fbx` | CAD bestanden in oude projectmappen |
