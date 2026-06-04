# ROUTES.md — waar staat de M&T-tool en hoe deploy je 'm

> **Doel:** één plek waar de routes van de M&T-tool permanent staan, vindbaar op
> beide PC's (dit bestand synct via SharePoint) én voor Claude-sessies. Geen
> secrets in dit bestand — de repo is **PUBLIC**.
>
> Laatst geverifieerd: 2026-06-04.

## Wat is "de tool"

De online **M&T Bedrijfstool** — de cockpit waar Bart non-stop mee werkt.
Niet de lokale voorraad-FastAPI.

- **Front-end (SPA):** **`index.html`** (repo-root, ~3700 regels, één
  HTML-bestand) = de actuele tool, live op de root-URL. Ook aanwezig: `uren.html`
  (urenregistratie).
- ⚠️ De oude front-ends (`index-v4.html` (bevroren 13-5), `index-v3.html`,
  `MT-presentatie.html`) en de oude voorraad-FastAPI staan sinds 4-6-2026
  gearchiveerd in `_archief/oude-tool-2026-06-04/` (gitignored, niet live). Niet
  meer bewerken — alle ontwikkeling gebeurt in `index.html`.
- **Backend:** Cloudflare Worker `mt-claude-proxy` (`worker.js`) — serverless,
  géén pure-static site. Houdt de Moneybird-token veilig, doet de MB-calls en de
  factuur-PDF-verwerking via Claude.

## Repo & paden

| Wat | Pad / waarde |
|---|---|
| Werkkopie (lokaal, SharePoint-sync) | `C:\Users\<naam>\Mortise & Tenon\Mortise & Tenon - On-Prem-Data\Applicaties\Claude\` |
| Junction zonder spaties/`&` | **`C:\MT`** → dezelfde map (gebruik dit voor scripts/scheduled tasks) |
| Git remote | `https://github.com/MTBart/MT-Facturatie-tool.git` (**PUBLIC**) |
| Push-branch | `main` |
| Live site (= index.html) | `https://mtbart.github.io/MT-Facturatie-tool/` |
| Worker-bron | `worker.js` (repo-root) |
| Worker-naam | `mt-claude-proxy` |
| Worker-URL | `https://mt-claude-proxy.bart-a12.workers.dev` |

> Commits **altijd via deze SharePoint-repo**, nooit via een losse kloon ergens
> anders. De library is op thuis- én werk-PC op hetzelfde pad gesynct.

## PC-namen (einde verwarring)

- **thuis-PC = `DESKTOP-LA2A33H`** — hier draait de Claude Code-terminal. Heeft
  `.mt-secret`, de Bart-PKA-vault, de voorraad-FastAPI, de email-forward-scripts
  en de gesyncte SharePoint-repo. Bart stuurt deze via remote control aan.
- **werk-PC = `KANTOOR`** — fysiek waar Bart overdag zit; ziet
  dezelfde SharePoint-repo via sync. Bij gelijktijdige edits op beide PC's ontstaan
  `-DESKTOP-LA2A33H`-conflictkopieën (niet mergen; één bron tegelijk bewerken).

## Front-end deployen (GitHub Pages)

```powershell
cd C:\MT
git add index.html                 # of welke bestanden je wijzigde
git commit -m "<wat je deed>"
git push origin main
```

GitHub Pages herbouwt automatisch ~5 min na de push. Daarna live op de URL's
hierboven. (Hard refresh / cache-bust als je je wijziging niet ziet.)

> **Git-auth (te bevestigen vóór een autonome push):** op de thuis-PC is `gh`
> NIET geïnstalleerd en de globale git-identiteit is niet gezet. Eerdere pushes
> slaagden wél (zie `HANDOFF.md`), waarschijnlijk via Windows Credential Manager
> of repo-lokale config. Controleer bij twijfel:
> `git config --get remote.origin.url` en `git credential-manager --version`
> (of doe een kleine test-push) vóór je op autonome pushes vertrouwt.

## Backend deployen (Cloudflare Worker)

```powershell
cd C:\MT
wrangler deploy                    # wrangler 4.90.0 staat op de thuis-PC
```

Secrets zet je los (nooit in de repo):

```powershell
wrangler secret put TOGGL_FOCUS_KEY
wrangler secret put CLAUDE_SECRET
```

De Worker valideert per request een MS-token (`X-Auth-Token`, alleen
`@mortiseandtenon.nl`) + `X-Claude-Key`. Alle `mbGet/mbPost/mbPatch/mbDelete`
lopen via de Worker — dit is óók de route waarlangs nieuwe dynamische features
(zoals een smart-inbox-backend) inpluggen. Dus nooit "kan niet, want static".

## Veiligheid (repo is PUBLIC)

- Twee sloten: `.gitignore` + version-controlled `githooks/pre-commit`
  (`git config core.hooksPath githooks` na een re-clone).
- Echte secrets **uitsluitend** in `C:\Users\BartWitte\.mt-secret\` — buiten de
  repo én buiten OneDrive/SharePoint.
- Nooit PII committen (zie de gitignore-lijst). Audit-commando staat in
  `REPO-VEILIGHEID.md`. Draai die check vóór een commit als je twijfelt.
