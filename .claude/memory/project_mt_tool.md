---
name: Mortise & Tenon — project
description: Bedrijfscontext, de MT Facturatie Tool, lopende prioriteiten
type: project
originSessionId: defd1734-9f80-4ab6-b833-011932614a97
---
Mortise & Tenon facturatie- en bedrijfstool. Volledig gedocumenteerd in `CLAUDE.md` + `ROUTES.md` in de repo-root.

**Why:** Lees altijd `C:\MT\CLAUDE.md` (= repo-root) voor volledige context, `C:\MT\ROUTES.md` voor paden/deploy en `C:\MT\Claude-context\STATUS.md` voor huidige prioriteiten. (Oude `\\B5-NAS\...`-paden zijn dood; alles staat nu in de SharePoint-repo `C:\MT`.)

**How to apply:** Dit project heeft zijn eigen CLAUDE.md — die is leidend boven deze memory.

**Kernpunten:**
- Tool is **`index.html`** (~3700 regels), repo-root, één groot HTML-bestand. De actuele cockpit.
- Live: https://mtbart.github.io/MT-Facturatie-tool/ (Pages serveert index.html standaard)
- ⚠️ Oude versies (`index-v4.html` 13-5, `index-v3.html`, `MT-presentatie.html`, voorraad-FastAPI) → gearchiveerd in `_archief/oude-tool-2026-06-04/` sinds 4-6-2026. Niet meer bewerken.
- Backend: Cloudflare Worker op mt-claude-proxy.bart-a12.workers.dev
- Moneybird (boekhouding) + Toggl (uren) + Anthropic API (PDF lezen)
- Data in localStorage browser — data sync is prioriteit

**Technische architectuur:**
- `mbGet/mbPost/mbPatch/mbDelete` gaan allemaal via Cloudflare Worker (`mt-claude-proxy.bart-a12.workers.dev`)
- Worker valideert Microsoft-token (`X-Auth-Token`) — tool is alleen toegankelijk na inloggen met `@mortiseandtenon.nl` account
- MSAL v2 via jsdelivr CDN — `initMsal()` aanroepen in apart script-blok onderaan de pagina
- `worker.js` staat nu in de repo + SharePoint (was alleen lokaal op Bart's machine)
- Auth-afhankelijke functies (`loadLedgers`, `laadDashboard`, `updateApiStatus`) draaien in `toonApp()` na login

**Werkplek voor Claude Code:**
- SharePoint (thuis/werk): `C:\Users\<naam>\Mortise & Tenon\Mortise & Tenon - On-Prem-Data\Applicaties\Claude\`
- Git commits altijd via de SharePoint repo — niet via losse klonen

**Lopende prioriteit (2026-05-06):**
1. Restylen naar Claude-design (nog niet gestart, scope nog te bepalen)
2. localStorage data sync → SharePoint/NAS
3. Nacalculatie tabblad (uren + inkoop + verkoop per project)

**Why:** Zie STATUS.md voor actuele stand.
**How to apply:** Check STATUS.md aan het begin van elke sessie.
