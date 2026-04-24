---
name: Mortise & Tenon — project
description: Bedrijfscontext, de MT Facturatie Tool, lopende prioriteiten
type: project
originSessionId: defd1734-9f80-4ab6-b833-011932614a97
---
Mortise & Tenon facturatie- en bedrijfstool. Volledig gedocumenteerd in CLAUDE.md op de NAS.

**Why:** Lees altijd `\\B5-NAS\B5-Applicaties\Claude\CLAUDE.md` voor volledige context en `\\B5-NAS\B5-Applicaties\Claude\.claude\STATUS.md` voor huidige prioriteiten.

**How to apply:** Dit project heeft zijn eigen CLAUDE.md — die is leidend boven deze memory.

**Kernpunten:**
- Tool is `index-v4.html` (~2500 regels), één groot HTML-bestand
- Live: https://mtbart.github.io/MT-Facturatie-tool/index-v4.html
- Backend: Cloudflare Worker op mt-claude-proxy.bart-a12.workers.dev
- Moneybird (boekhouding) + Toggl (uren) + Anthropic API (PDF lezen)
- Data in localStorage browser — data sync is prioriteit

**Lopende prioriteit (2026-04-24):**
1. localStorage data sync → SharePoint/NAS
2. Toggl koppeling (wacht op API token)
3. Mappenstructuur script

**Why:** Zie STATUS.md voor actuele stand.
**How to apply:** Check STATUS.md aan het begin van elke sessie.
