# API Setup — tokens instellen

> Laden als je tokens moet instellen, de Cloudflare Worker aanpast, of API-verbinding niet werkt.

---

## Moneybird API token
1. Ga naar: https://moneybird.com → Profiel → API → Nieuwe token aanmaken
2. Open index-v4.html → tab **Instellingen** → plak token in "Moneybird API token"
3. Token wordt opgeslagen in localStorage (`mt_instellingen`)
4. Cloudflare Worker pakt token uit localStorage via de app — je hoeft hem niet in de Worker te zetten

## Cloudflare Worker
- **URL:** `mt-claude-proxy.bart-a12.workers.dev`
- **Broncode:** `C:\Users\BartWitte\worker.js`
- **Beheer:** https://dash.cloudflare.com → Workers & Pages → mt-claude-proxy
- Worker is een proxy die CORS-headers toevoegt voor Moneybird API calls vanuit de browser

Worker aanpassen:
```
1. Edit worker.js lokaal
2. Cloudflare dashboard → Worker → Code editen → Deploy
   OF: wrangler CLI: cd map-met-worker && npx wrangler deploy
```

## GitHub token (voor git push)
- Alleen nodig als git push faalt met authenticatiefout
- Genereer op: https://github.com/settings/tokens → Personal access tokens → Generate new token
- Scope: repo (alleen)
- Gebruik: `git push` vraagt automatisch om credentials als token verloopt
- Token in Windows Credential Manager opgeslagen → hoeft maar één keer ingevoerd

## SharePoint Graph API token (toekomstig — nodig voor uren-sync)
- Nodig voor: `mt_uren_entries` + `mt_uren_planning` sync tussen apparaten
- Stap: Azure Portal → App registrations → MT-Facturatie-App → Certificates & secrets → New client secret
- Scopes nodig: `Files.ReadWrite`, `Sites.ReadWrite.All`
- **Status: nog niet opgezet** — wacht op Bart

## Bestandspaden
- **NAS (werk):** `//B5-NAS/B5-Applicaties/Claude/`
- **Thuis:** `C:\Users\BartWitte\Mortise & Tenon\Mortise & Tenon - On-Prem-Data\Applicaties\Claude\`
- Beide synchroniseren live via SharePoint ↔ NAS
