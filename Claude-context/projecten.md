# Projecten

Lees dit als een vraag gaat over: project aanmaken, projectnaam, klantcode, vestiging, mapstructuur, vaste klanten, Inter Projecten flow.

## Naamgeving
- **Formaat:** `KLANT-VESTIGING-PRODUCT` (geen datum, zo uitgebreid mogelijk)
- **Zaaglijst-code:** max 20 tekens (bijv. `CN-PRINSENGRACHT-GAR`)
- **Voorbeelden:** `CN-PRINSENGRACHT-GARDEROBE`, `LGM-OOSTERPARK-PANTRY-GROOT`

## Klantcodes
| Code | Klant |
|---|---|
| CN | CompaNanny |
| LGM | LGM Projecten |
| MOS | (Mos) |
| STY | (Sty) |
| HWC | Herman Wesselink College *(loopt via Inter Projecten)* |
| EZ | (Ez) |
| GBK | (Gbk) *(loopt via Inter Projecten)* |
| DV | (Dv) |
| JAN | (Jan) |

## Vaste klanten
- **CompaNanny** — grootste, kinderopvangketen door heel NL
- **Inter Projecten** — Arjan Janssen, zelfstandig meubelmaker
- **LGM Projecten**
- **PT Bouw & Meubel**
- **Aannemers Verkaik**

HWC en GBK lopen via Inter Projecten.

## Mapstructuur (nieuwe standaard)
```
[Volledige KvK naam] - [Klant-ID]/
  [KLANT-VESTIGING-Projectnaam]/
    01_Offerte/
    02_Ontwerp/
    03_Vectorworks/
    04_Holzher/
    05_Aangeleverd/
    06_Fotos/
    07_Administratie/
    08_Archief/
    09_Werktekeningen/
```

## Migratie van oude projecten
- 129 projecten in oude inconsistente structuur (88 in `1_Projecten NAS` + 41 in `2_Compananny NAS`)
- Niet automatisch te migreren — namen niet gekoppeld aan Moneybird klant-ID
- **Tool:** `migration-server.js` + `migration-tool.js` (zie tooling.md)
- **Open punt:** "Nieuwe klant aanmaken in Moneybird" zit nog als TODO in migration-tool.js (regel 369)

## Project aanmaken (nu)
- PowerShell: `create-project-structure.ps1` — zoekt klant in Moneybird, maakt mapstructuur, schrijft `PROJECT_INFO.txt`
- **Wens:** dit wordt een Cowork-skill `nieuw-project` (zie STATUS.md)

## Toggl
- **Workspace:** `21258443`
- Bart, Arjan en Maarten registreren uren via Toggl Track
- (Wordt op termijn vervangen door uren.html)
