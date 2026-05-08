# STATUS — huidige stand van zaken

> Dit bestand wordt door Claude bijgewerkt zodra er iets belangrijks verandert.
> Laatst gewijzigd: 2026-05-08

## Waar staan we nu

Bart richt Cowork in als standaard Claude-werkomgeving. Eerste prioriteit afgerond: token-efficiente kennisstructuur (laag 1 = `CLAUDE.md`, laag 2 = `Claude-context/`, laag 3 = dit bestand). Daarna pas nieuwe features.

## Open punten — in volgorde van prioriteit

### Eerstvolgend (na groen licht van Bart op de structuur)
1. **Moneybird MCP onderzoek** — bestaat er al een geschikte? Anders eigen MCP bouwen op basis van bestaande API-kennis. Doel: directe MCP-toegang vanuit elke Cowork-chat ipv via Express-proxy of Cloudflare Worker.
2. **Opruimen** — `index-v3.html` weg; `MT-presentatie.html` beslissen (afmaken/weg); `worker.js` afsluiten zodra MCP staat; worktree `wizardly-euler-a54429` checken.
3. **Skill `nieuw-project`** — vervangt `create-project-structure.ps1` + handmatige Moneybird-stappen. Eén commando: KvK-naam → Moneybird klant aanmaken/zoeken → mapstructuur 01..09 + `PROJECT_INFO.txt`.
4. **Hardcoded paden weghalen** uit `migration-server.js` en `create-project-structure.ps1` — alles via SharePoint/NAS, geen `BartWitte`/`lotte`-paden meer. Bart wil GEEN data op thuis-pc's, alles centraal.

### Daarna
5. **uren.html cloud sync** — SharePoint Graph token regelen of via Cowork-MCP. localStorage als cache, NAS/SharePoint als bron van waarheid. Risico nu: data kwijt bij browser cache wissen.
6. **Vectorworks plugin onderzoek** — kan een eigen Vectorworks-plugin direct in onze tool uploaden? (Voorbeeld: InteriorCAD met ERP-koppeling.) Tot dan: handmatige CSV-import in `uren.html` als stap 11.
7. **Skill `weekafsluiting`** — vrijdagmiddag uren samenvatten per project/persoon → concept-factuurregels Moneybird.
8. **Scheduled task `Moneybird-check`** — dagelijks ongecategoriseerde inkoopfacturen melden.
9. **Live Cowork artifacts** — Project-pipeline / Open facturen / Wekelijks urenrapport.

## Wijzigingen op de structuur (changelog)

### 2026-05-08
- Eerste opzet kennisstructuur: 6 ctx-bestanden + STATUS.md + afgeslankte CLAUDE.md.
- Token-discipline regels expliciet vastgelegd in CLAUDE.md.
- ctx-bestanden in `Claude-context/` (zichtbare folder; `.claude/ctx/` was niet schrijfbaar in Cowork-sessie).
- Bart wil GEEN kopieën meer op thuis-pc's — alles via NAS/SharePoint sync.

## Risico's die nog open staan
- `config.json` met Moneybird-token leeft als platte tekst in projectfolder. Als folder ooit per ongeluk gedeeld wordt, ligt token op straat. → Beveiligen via Cowork env vars zodra mogelijk.
- `uren.html` data is alleen localStorage. Browser cache wissen = data weg. → Cloud sync hoogste prio na opruimen.
- Worktree `wizardly-euler-a54429` — onbekende status, kan stale werk bevatten.
