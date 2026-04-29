# Moneybird — detail context

> Laden als je met Moneybird API werkt, facturen boekt of grootboek-IDs nodig hebt.

## Administratie
- **ID:** `342968480452052559`
- **Bankrekening ING:** `343544076091524743`
- **Inter Projecten project-ID:** `387471524102145459`

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

## API endpoints
Base: `https://moneybird.com/api/v2/342968480452052559`

| Resource | Path |
|---|---|
| Inkoopfacturen | `/documents/purchase_invoices` |
| Verkoopfacturen | `/sales_invoices` |
| Projecten | `/projects` |
| Grootboekrekeningen | `/ledger_accounts` |
| Contacten | `/contacts` |

Proxy via Cloudflare Worker: `mt-claude-proxy.bart-a12.workers.dev`

## Bekende leveranciers → categorie
| Categorie | Leveranciers |
|---|---|
| Gas | Vattenfall |
| Telefoon | KPN, Odido, Delta Fiber |
| Reiskosten | Easypark |
| Verzekeringen | Nationale-Nederlanden |
| Administratie | Moneybird, Mollie |
| Materiaal | Drimensa, Ostermann, PontMeyer, Van Laere, J. Kisch, VKF Renzel, Beemer Glas, IKEA, Beltraco, Dozon |
| Diensten | Inter Projecten, Merlijn Meubel, Transportbedrijf Van Rooyen, Interpaint |
| Machines | Memax, HGB-Trading, De Groot Bewerkingsmachines |
| Reparatie | Becker, Technisch Bureau De Breuk |
| Containers | Roele De Vries, Union Container, Renewi |
| Personeel | Person Plus, Stichting Sociaal Fonds, BPF Meubel |
| Lunches | Picnic, Bakkerswinkel, Albert Heijn |

## Python bulk-update script
`Moneybird/moneybird_update.py` — API token zelf invullen voor gebruik.
