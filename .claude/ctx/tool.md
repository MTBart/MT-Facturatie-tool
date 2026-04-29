# index-v4.html — detail context

> Laden bij werk aan de facturatie/bedrijfstool (index-v4.html).

## Technische details
- **Bestand:** `index-v4.html` (~2500 regels, één groot HTML-bestand)
- **Live URL:** https://mtbart.github.io/MT-Facturatie-tool/index-v4.html
- **GitHub repo:** mtbart/MT-Facturatie-tool
- **Cloudflare Worker (proxy):** mt-claude-proxy.bart-a12.workers.dev
- **Worker broncode:** `C:\Users\BartWitte\worker.js`

## Tabbladen (volledig)

| Tab | Inhoud |
|---|---|
| 1. Dashboard | KPI's live uit Moneybird: omzet, debiteuren, crediteuren, winst |
| 2. Nieuwe factuur | PDF uploaden → Claude leest uit → boeken in Moneybird |
| 3. Factuur controle | Inkoopfacturen reviewen op project/grootboek, klikbaar naar detail |
| 4. Projecten | Projectbeheer, NCR upload, Vectorworks CSV import, bestellijst genereren |
| 5. Klanten | Live uit Moneybird, grid/lijst toggle, zoekbaar |
| 6. Voorraad | Platen/kantenband/overig, sorteerbaar, leverancier matching |
| 7. Bestellijst | Te bestellen items, handmatig toevoegen, exporteren naar CSV |
| 8. Geschiedenis | Verwerkte facturen, klikbaar naar factuur controle |
| 9. Instellingen | API tokens, leveranciers, toeslagen, altijd-bestellen lijst |

## Werkwijze
- Aanpassingen via Edit tool (str_replace), **nooit het hele bestand herschrijven**
- Git push via:
  ```
  git -C "//B5-NAS/B5-Applicaties/Claude" add index-v4.html
  git -C "//B5-NAS/B5-Applicaties/Claude" commit -m "beschrijving"
  git -C "//B5-NAS/B5-Applicaties/Claude" push
  ```

## localStorage keys (index-v4.html)
| Key | Inhoud |
|---|---|
| `mt_projecten` | Projecten (gedeeld met uren.html) |
| `mt_instellingen` | API tokens, leveranciersmapping, toeslagen |
| `mt_voorraad` | Voorraadregels |
| `mt_bestellijst` | Bestellijst items |
| `mt_geschiedenis` | Verwerkte facturen |

## Roadmap (open punten)
1. **Voorraad-icoon in factuurlijst** — tag als factuur voorraadregels heeft
2. **Historische facturen opschonen** — 218 inkoopfacturen 2026
3. **Nacalculatie tabblad** — uren (uren.html) + inkoop + verkoop per project, marge
4. **Email integratie** — Outlook facturen automatisch verwerken
5. **SEPA verzendlijst** — batch betaalbestand via Moneybird API

## Moneybird Python bulk-update script
`Moneybird/moneybird_update.py` — voor bulk-updates buiten de tool om. API token zelf invullen.
