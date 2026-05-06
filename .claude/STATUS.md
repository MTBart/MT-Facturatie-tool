# STATUS.md — Huidige sessie-context

> Dit bestand bijwerken na elke sessie. Bevat wat er nu speelt, niet de stabiele projectinfo (die staat in CLAUDE.md).

## Gedaan (2026-05-06) — sessie vanuit Lotte's computer (Oostenrijk)
- **Alle API errors opgelost** — tool werkt weer volledig online na inloggen met MS-account
  - `mbGet` (regel ~790) belde `localhost:3456` → nu via Cloudflare Worker (zoals POST/PATCH/DELETE al deden)
  - MSAL was uitgeschakeld voor testing (`initMsal()` commented out, script tag verwijderd)
  - MSAL script tag teruggezet: `cdn.jsdelivr.net/npm/@azure/msal-browser@2/lib/msal-browser.min.js`
  - `loadLedgers()` + `laadDashboard()` verplaatst naar `toonApp()` — draaien nu pas ná login
  - Migratietab verborgen op GitHub Pages (werkt alleen lokaal met Node server)
- `worker.js` opgeslagen in SharePoint + GitHub repo (stond alleen lokaal op Bart's machine)
- Werkplek voor Claude Code = SharePoint: `C:\Users\<naam>\Mortise & Tenon\Mortise & Tenon - On-Prem-Data\Applicaties\Claude\`
- Git commits altijd via de SharePoint repo, niet via een losse kloon

## Volgende stap (gepland, niet gestart)
- **Restylen naar Claude-design** — Lotte wil de tool een nieuwe look geven geïnspireerd op claude.ai. Nog niet besproken welke variant (volledig of alleen kleuren/fonts).

## Gedaan (2026-04-28)
- `uren.html` gebouwd, herbouwd en live — standalone M&T tijdsregistratie app (geen Toggl nodig)
- **Timer tab:** projectkaartjes → taakkeuze-modal → subtaak → start. Live klok in banner.
- **Dag tab:** overzicht per teamlid, admin ziet iedereen, entries toevoegen/bewerken/verwijderen
- **Planning/Timeline tab:** toggle per persoon / per project, klik op cel = planblok aanmaken
- **Uren tab:** rapport per project met periodefilter en breakdown per persoon
- **Bord tab:** fullscreen muurscherm voor werkplaats, live timers per kaart, week-timeline klikbaar, projectrijen klikbaar om timer te starten
- **☰ Taken beheer:** Project > Taak > Subtaak hiërarchie, volledig CRUD
- **⚙ Instellingen:** teamleden beheren (naam, kleur, rol), CSV export
- Leest `mt_projecten` uit gedeelde localStorage met index-v4.html (zelfde GitHub Pages origin)
- Memory gesynchroniseerd (Desktop + C--Users-BartWitte)
- `.claude/settings.json` uitgebreid met find/grep/dir permissies

## Volgende stappen uren.html
1. **Sync tussen apparaten** — `mt_uren_entries` + `mt_uren_planning` via SharePoint (zelfde monkey-patch als index-v4.html)
2. **PWA installeerbaar** — manifest.json zodat app als echt icoontje op telefoon staat
3. **Drag-to-create** op timeline — sleep over meerdere dagen voor multi-dag planblok
4. **Capaciteitsbalken** — per persoon tonen of ze over/onderbezet zijn die week
5. **Bord auto-refresh polling** — nu elke 30s, verbeteren met storage event voor direct sync

## Roadmap index-v4.html
1. **Voorraad-icoon in factuurlijst** — tag als factuur voorraadregels heeft
2. **Historische facturen opschonen** — 218 inkoopfacturen 2026
3. **Nacalculatie tabblad** — uren (eigen app) + inkoop + verkoop per project, marge
4. **Email integratie** — Outlook facturen automatisch verwerken
5. **SEPA verzendlijst** — batch betaalbestand via Moneybird API

## Live URLs
- Bedrijfstool: https://mtbart.github.io/MT-Facturatie-tool/index-v4.html
- Uren app: https://mtbart.github.io/MT-Facturatie-tool/uren.html

## Blocker
- SharePoint Graph API token — nodig voor uren-sync tussen apparaten
