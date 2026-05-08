# Moneybird

Lees dit als een vraag gaat over: facturen, klanten in Moneybird, BTW, grootboek, projecten in Moneybird, leveranciers, boekhouding, debiteuren, crediteuren, omzet.

## Administratie
- **Administratie ID:** `342968480452052559`
- **API base URL:** `https://moneybird.com/api/v2/342968480452052559`
- **Bankrekening ING:** `343544076091524743`

## BTW-tarieven
| Tarief | ID |
|---|---|
| 21% | `342968481360119428` |
| 9% | `342968481362216581` |
| 0% | `348668107652335594` |

## Grootboekrekeningen
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

## Endpoints (relatief op API base)
- Inkoopfacturen: `/documents/purchase_invoices`
- Verkoopfacturen: `/sales_invoices`
- Projecten: `/projects` — Inter Projecten ID: `387471524102145459`
- Grootboekrekeningen: `/ledger_accounts`
- Contacten: `/contacts`

## Leveranciers → categorie
| Leverancier(s) | Categorie |
|---|---|
| Vattenfall | Gas |
| KPN, Odido, Delta Fiber | Telefoon |
| Easypark | Reiskosten |
| Nationale-Nederlanden | Verzekeringen |
| Moneybird, Mollie | Administratie (Algemeen) |
| Drimensa, Ostermann, PontMeyer, Van Laere, J. Kisch, VKF Renzel, Beemer Glas, IKEA, Beltraco, Dozon | Materiaal |
| Inter Projecten, Merlijn Meubel, Transportbedrijf Van Rooyen, Interpaint | Diensten |
| Memax, HGB-Trading, De Groot Bewerkingsmachines | Machines |
| Becker, Technisch Bureau De Breuk | Reparatie |
| Roele De Vries, Union Container, Renewi | Containers |
| Person Plus, Stichting Sociaal Fonds, BPF Meubel | Personeel |
| Picnic, Bakkerswinkel, Albert Heijn | Lunches |

## Toegang
- **Token:** in `config.json` (gitignored, alleen lokaal/SharePoint)
- **Cloudflare Worker proxy (oud):** `mt-claude-proxy.bart-a12.workers.dev` — wordt vervangen door directe MCP/API
- **MCP-koppeling:** in onderzoek (zie STATUS.md)

## Bekende scripts
- `Moneybird/moneybird_update.py` — Python bulk-update inkoopfacturen (token zelf invullen)
- `migration-server.js` — Express proxy met Moneybird endpoints
- `create-project-structure.ps1` — PowerShell, leest klant uit Moneybird en maakt mapstructuur
