# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@.claude/STATUS.md

---

## Communicatiestijl
- Gewone taal, geen jargon tenzij uitgelegd — Bart als slimme collega, niet als klant
- Kort uitleggen wat je doet en waarom, beknopt
- Bij twijfel over context: vragen, niet gissen
- Af en toe korte technische uitleg zodat Bart langzaam bijleert
- **Waarschuw als je werkt met mogelijk verouderde info uit dit bestand**

## Pre-approvals (hoeft niet gevraagd te worden)
- Autonome git commits op de NAS repo
- File writes naar bestanden in deze map
- API calls via de Cloudflare Worker

## Over het bedrijf
Bart Witte en Mathijs Zwiers runnen **Mortise & Tenon**, een maatwerkmeubelbedrijf in Wormerveer.

**Team:** Bart Witte (eigenaar) · Mathijs Zwiers (eigenaar) · Lotte (medewerker, thuis) · Maarten (werkplaats fulltime) · Arjan Janssen (ZZP via Inter Projecten, werkplaats fulltime)

**Vaste klanten:** CompaNanny (kinderopvangketen, grootste klant), Inter Projecten, LGM Projecten, PT Bouw & Meubel, Aannemers Verkaik

## De tools
| Tool | URL / locatie |
|---|---|
| Facturatie (index-v4.html) | https://mtbart.github.io/MT-Facturatie-tool/index-v4.html |
| Uren app (uren.html) | https://mtbart.github.io/MT-Facturatie-tool/uren.html |
| GitHub repo | mtbart/MT-Facturatie-tool |
| Cloudflare Worker | mt-claude-proxy.bart-a12.workers.dev |
| Worker broncode | `C:\Users\BartWitte\worker.js` |

## Moneybird (meest gebruikte IDs)
**Admin ID:** `342968480452052559` | **Bankrekening ING:** `343544076091524743`

| BTW | ID |
|---|---|
| 21% | `342968481360119428` |
| 9% | `342968481362216581` |
| 0% | `348668107652335594` |

## Projectnaamgeving
- **Formaat:** `KLANT-VESTIGING-PRODUCT` (geen datum, zo beschrijvend mogelijk)
- **Zaaglijst-code:** max 20 tekens — bijv. `CN-PRINSENGRACHT-GAR`
- **Klantcodes:** CN, LGM, MOS, STY, HWC, EZ, GBK, DV, JAN
- HWC en GBK lopen via Inter Projecten

## Bestandspaden
- **NAS (werk):** `//B5-NAS/B5-Applicaties/Claude/`
- **Thuis:** `C:\Users\BartWitte\Mortise & Tenon\Mortise & Tenon - On-Prem-Data\Applicaties\Claude\`
- Beide synchroniseren live via SharePoint ↔ NAS

## Werkwijze
- Aanpassingen via Edit tool (str_replace), **nooit het hele bestand herschrijven**
- Git push: `git -C "//B5-NAS/B5-Applicaties/Claude" add [bestand] && git -C "//B5-NAS/B5-Applicaties/Claude" commit -m "msg" && git -C "//B5-NAS/B5-Applicaties/Claude" push`
- Alles in **localStorage** van de browser (geen backend)

---

## Context laden — lees dit als het werk dat vraagt

| Wanneer | Bestand |
|---|---|
| Werk aan uren.html | `.claude/ctx/uren.md` |
| Werk aan index-v4.html (tabbladen, werkwijze) | `.claude/ctx/tool.md` |
| Grootboek IDs, leveranciers, API endpoints | `.claude/ctx/moneybird.md` |
| Materiaal, NCR-bestanden, platen/kantenband | `.claude/ctx/materiaal.md` |
| Vectorworks, CSV, CNC-flow | `.claude/ctx/vectorworks.md` |
| Klant-specifieke details (CompaNanny, codes) | `.claude/ctx/klanten.md` |
| Waarom iets zo gebouwd is (anti-herhaling) | `.claude/ctx/beslissingen.md` |
| Bekende bugs/beperkingen/uitgesteld | `.claude/ctx/bekende_problemen.md` |
| API tokens instellen, Worker aanpassen | `.claude/ctx/api_setup.md` |
