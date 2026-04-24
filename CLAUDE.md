# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@.claude/STATUS.md

---

---

## Communicatiestijl
- Gewone taal, geen jargon tenzij uitgelegd
- Kort uitleggen wat je doet en waarom, beknopt
- Vriendelijk en informeel — Bart als slimme collega, niet als klant
- Bij twijfel over context: vragen, niet gissen
- Geef af en toe een korte technische uitleg zodat Bart langzaam bijleert
- **Waarschuw als je werkt met mogelijk verouderde info uit dit bestand**

## Pre-approvals (hoeft niet gevraagd te worden)
- Autonome git commits op de NAS repo
- File writes naar bestanden in deze map
- API calls via de Cloudflare Worker

## Over het bedrijf
Bart Witte en Mathijs Zwiers runnen **Mortise & Tenon**, een maatwerkmeubelbedrijf in Wormerveer.

**Team:**
- Bart Witte — eigenaar/vennoot
- Mathijs Zwiers — eigenaar/vennoot
- Lotte — medewerker (eigen computer thuis)
- Arjan Janssen — zelfstandig meubelmaker via zijn bedrijf **Inter Projecten**

**Vaste klanten:** CompaNanny (grootste, kinderopvangketen door heel NL), Inter Projecten, LGM Projecten, PT Bouw & Meubel, Aannemers Verkaik

## De tool
- **Live URL:** https://mtbart.github.io/MT-Facturatie-tool/index-v4.html
- **GitHub repo:** mtbart/MT-Facturatie-tool
- **Huidig bestand:** `index-v4.html` (in deze map, ~2500 regels, één groot HTML-bestand)
- **Cloudflare Worker (proxy):** mt-claude-proxy.bart-a12.workers.dev
- **Worker broncode:** `C:\Users\BartWitte\worker.js`

### Tabbladen
1. **Dashboard** — KPI's live uit Moneybird (omzet, debiteuren, crediteuren, winst)
2. **Nieuwe factuur** — PDF uploaden, Claude leest uit, boeken in Moneybird
3. **Factuur controle** — inkoopfacturen reviewen op project/grootboek
4. **Projecten** — projectbeheer, NCR upload, Vectorworks CSV import
5. **Klanten** — live uit Moneybird, grid/lijst toggle
6. **Voorraad** — platen/kantenband/overig, sorteerbaar, leverancier matching
7. **Bestellijst** — te bestellen items, handmatig toevoegen, exporteren
8. **Geschiedenis** — verwerkte facturen, klikbaar naar factuur controle
9. **Instellingen** — API tokens, leveranciers, toeslagen, altijd-bestellen lijst

### Werkwijze
- Aanpassingen via Edit tool (str_replace), **nooit het hele bestand herschrijven**
- Git push via:
  ```
  git -C "//B5-NAS/B5-Applicaties/Claude" add index-v4.html
  git -C "//B5-NAS/B5-Applicaties/Claude" commit -m "beschrijving"
  git -C "//B5-NAS/B5-Applicaties/Claude" push
  ```

## Moneybird
**Administratie ID:** `342968480452052559`

**BTW-tarieven:**
| Tarief | ID |
|---|---|
| 21% | `342968481360119428` |
| 9% | `342968481362216581` |
| 0% | `348668107652335594` |

**Bankrekening ING:** `343544076091524743`

**Grootboekrekeningen:**
| Categorie | ID |
|---|---|
| Inkoop materiaal | `351738073531286726` |
| Inkoop diensten | `351738642447730607` |
| Gas, water, elektriciteit | `351738264777918163` |
| Telefoon en internet | `351738264578688716` |
| Lunch | `351739212387583097` |
| Machines klein | `432299803558282794` |
| Personeel | `351148230758630548` |
| Reparatie machines | `360028029971334640` |
| Verzekeringen | `395517976421337081` |
| Reiskosten | `432376927951521570` |
| Containers/afval | `351739087727626209` |
| Huisvesting | `342968480722585190` |
| Auto | `345530103038478074` |
| Cursussen | `469151338989618681` |
| Algemeen | `342968480723633768` |

**API endpoints** (base: `https://moneybird.com/api/v2/342968480452052559`):
- Inkoopfacturen: `/documents/purchase_invoices`
- Verkoopfacturen: `/sales_invoices`
- Projecten: `/projects` — Inter Projecten ID: `387471524102145459`
- Grootboekrekeningen: `/ledger_accounts`
- Contacten: `/contacts`

**Bekende leveranciers → categorie:**
- Gas: Vattenfall
- Telefoon: KPN, Odido, Delta Fiber
- Reiskosten: Easypark
- Verzekeringen: Nationale-Nederlanden
- Administratie: Moneybird, Mollie
- Materiaal: Drimensa, Ostermann, PontMeyer, Van Laere, J. Kisch, VKF Renzel, Beemer Glas, IKEA, Beltraco, Dozon
- Diensten: Inter Projecten, Merlijn Meubel, Transportbedrijf Van Rooyen, Interpaint
- Machines: Memax, HGB-Trading, De Groot Bewerkingsmachines
- Reparatie: Becker, Technisch Bureau De Breuk
- Containers: Roele De Vries, Union Container, Renewi
- Personeel: Person Plus, Stichting Sociaal Fonds, BPF Meubel
- Lunches: Picnic, Bakkerswinkel, Albert Heijn

## Toggl
- **Workspace:** `21258443`
- Bart, Arjan en Maarten registreren uren via Toggl Track

## Projectnaamgeving
- **Formaat:** `KLANT-VESTIGING-PRODUCT` (geen datum, zo uitgebreid mogelijk)
- **Zaaglijst-code:** max 20 tekens (bijv. `CN-PRINSENGRACHT-GAR`)
- **Voorbeelden:** `CN-PRINSENGRACHT-GARDEROBE`, `LGM-OOSTERPARK-PANTRY-GROOT`
- **Klantcodes:** CN, LGM, MOS, STY, HWC, EZ, GBK, DV, JAN
- HWC en GBK lopen via Inter Projecten

## Productieflow
1. Vectorworks → CSV + PGMX bestanden → map: Vectorworks Export
2. CSV inladen in Holzher optimalisatiesoftware
3. Holzher → HHA + NCR bestanden → map: Holzher Optimalisatie/data
4. Zaagmachine + tablet + stickerprinter
5. Stickers met QR code → verwijzing naar PGMX bij CNC machine

**NCR bestanden:** plaattellingen via **P-parameter** in A0-regels (hoogste P = aantal platen). Platenmaat via M1-regel (L en B in 1/10mm). Nooit de A0-regels tellen — dat zijn snijbewegingen.

## Materiaallogica
- Platen altijd in **stuks** (nooit m²) — aantallen uit NCR
- m² alleen voor lak/spuit toeslagberekening: lak €50/m², spuit €80/m²
- Herkenning: "lak", "gelakt", "spuit", "fineer" in materiaalnaam
- Kantenband: alleen als "kantenband" expliciet in naam staat
- Platen: egger, spaan, mdf, hpl, multiplex, berken, eiken + afmetingspatroon
- **Altijd bestellen (nooit op voorraad):** legrabox, blumotion, sensys, tip-on, varianta, keku, axilo, kastophanger, hettich, grass, blum, häfele

## Data & opslag
- Alles in **localStorage** van de browser
- Bestandssync: SharePoint ↔ NAS werkt al
- Python bulk-update script: `Moneybird/moneybird_update.py` (API token zelf invullen)

## Bestandspaden
- **NAS (werk):** `//B5-NAS/B5-Applicaties/Claude/`
- **Thuis:** `C:\Users\BartWitte\Mortise & Tenon\Mortise & Tenon - On-Prem-Data\Applicaties\Claude\`
- Beide locaties synchroniseren live via SharePoint ↔ NAS
