# STATUS.md — Huidige sessie-context

> Dit bestand bijwerken na elke sessie. Bevat wat er nu speelt, niet de stabiele projectinfo (die staat in CLAUDE.md).

## Laatste sessie: 2026-04-24 (nacht)

### Gedaan
- End-to-end automation platform plan uitgewerkt (zie `.claude/plans/`)
- Memory-systeem gestart (user profile Bart opgeslagen)
- Naamconventie definitief vastgesteld: `KLANT-VESTIGING-PRODUCT`
- Pre-approvals gegeven: autonome git commits, file writes, API calls

### Mapstructuur opgeruimd (2026-04-24 ochtend)
- `_archief/` aangemaakt, oude files verplaatst (index-v3, presentaties, sessiesammenvattingen)
- `CLAUDE.md` volledig bijgewerkt en aangescherpt
- `STATUS.md` aangemaakt (dit bestand)

## Nu te doen (prioriteit)

### ~~1. MSAL login fix~~ ✅ Al gedaan
Alle drie wijzigingen staan al in `index-v4.html`. Plan was al uitgevoerd voor deze sessie.

### 1. Data sync voor localStorage
- Voorraad, bestellijst etc. opslaan buiten browser
- SharePoint ↔ NAS sync werkt al, maar tool slaat nog op in localStorage

### 3. Toggl koppeling
- Uren per project tonen in de tool
- Toggl API token nodig

### 4. Mappenstructuur script
- PowerShell of Power Automate
- Automatisch projectmappen aanmaken

### 5. Overig
- Export/import JSON als tussenoplossing voor data sync
- Dashboard visueel verbeteren
- Bestellijst webshop links

## Blockers
- Toggl API token — nodig voor Toggl koppeling
- SharePoint Graph API — nodig voor folder creation
