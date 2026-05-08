# Tooling — wat is er, wat doet het, status

Lees dit als een vraag gaat over: scripts, servers, workers, migratie, welke tool waarvoor, of iets nog gebruikt wordt.

## Live tools

### `index-v4.html` — ACTIEF
- **Live:** https://mtbart.github.io/MT-Facturatie-tool/index-v4.html
- **Repo:** mtbart/MT-Facturatie-tool
- ~2500 regels, single HTML, Microsoft MSAL (Azure SSO)
- **Tabs:** Dashboard · Nieuwe factuur · Factuur controle · Projecten · Klanten · Voorraad · Bestellijst · Geschiedenis · Instellingen
- **Aanpassen:** alleen via Edit (str_replace), nooit volledig herschrijven
- **Push:** `git -C "//B5-NAS/B5-Applicaties/Claude" add ... && commit && push`

### `uren.html` — ACTIEF (zie uren-tool.md)
- ~4700 regels, op branch `claude/hardcore-shaw-73041c`
- localStorage-only — cloud sync nog niet werkend (open punt)

## Scripts

### `migration-server.js` — HALF AF
- Express server, port 3456
- Endpoints: `/api/projects`, `/api/scan-project/:id`, `/api/migrate`, `/api/all-contacts`, `/api/moneybird/:endpoint`
- Hardcoded paden naar `C:\Users\BartWitte\...` (werkt niet voor Lotte)
- Geen DB-persistentie, alles JSON

### `migration-tool.js` — HALF AF
- Client-side 5-staps wizard: folder pick → klant → projectnamen → folder-mapping → execute
- Cached Moneybird-contacten in localStorage (24h TTL)
- **TODO regel 369:** "API call om nieuwe klant aan te maken in Moneybird"

### `create-project-structure.ps1` — WERKT (prototype)
- PowerShell, zoekt klant in Moneybird, maakt mapstructuur 01..09, schrijft `PROJECT_INFO.txt`
- Hardcoded paden naar `BartWitte` — wordt vervangen door Cowork-skill

### `Moneybird/moneybird_update.py` — WERKEND
- Python bulk-update inkoopfacturen, token zelf invullen
- Op Bart's pc lokaal; niet draagbaar

### `start-server.bat` — WERKT
- Dubbelklik-starter: `npm install` + `node migration-server.js` op port 3456

## Cloudflare

### `worker.js` — DEPRECATED
- Cloudflare Worker proxy: `mt-claude-proxy.bart-a12.workers.dev`
- Targets: claude, moneybird, moneybird_download, moneybird_upload, toggl
- Hardcoded CORS origin `https://mtbart.github.io`
- Vervangen door directe MCP/API — kandidaat voor afsluiten

## Dood / weg te gooien

| Bestand | Reden |
|---|---|
| `index-v3.html` | Vervangen door v4, niet meer in gebruik |
| `MT-presentatie.html` | Half af pitchdeck — afmaken óf weg |
| `worker.js` (Cloudflare) | Deprecated zodra MCP koppeling staat |
| `.git/worktrees/hardcore-shaw-73041c` | Behouden — actieve uren-branch |
| `.git/worktrees/wizardly-euler-a54429` | Status onbekend — checken |

## Documentatie
- `MIGRATION_ANALYSIS.md` — analyse van 129 oude projecten + nieuwe structuur
- `_archief/projectinstructies_claude.md` — bedrijfsachtergrond, oudere instructies
- `package.json` — Node deps (express, cors, fs-extra)

## Excel/PDF (root)
- `MT-Projectsysteem.xlsx`
- `mathijs_zwiers_contacts.xlsx`
- `tool profit mode/Financieel plan Mortise and Tenon.xlsx`
- `_archief/presentatie pdf.pdf`
