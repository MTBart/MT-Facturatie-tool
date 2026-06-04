# Architectuur — Mortise & Tenon digitale tools

> Laatst bijgewerkt: 2026-05-14

## CRM / Inbox

### Smart Inbox (in ontwikkeling)
Het CRM Kanban-dashboard (`crm_dashboard_archief.html`) is gearchiveerd en vervangen door een nieuw concept: **Smart Inbox**.

**Aanpak:**
- Mail-gebaseerd: haalt berichten op via Microsoft Graph API
- Bijlage-opslag: relevante documenten (offertes, tekeningen, facturen) worden opgeslagen in SharePoint/NAS
- Toggl-koppeling: taken en tijdregistratie direct vanuit de inbox starten
- Vervangt het handmatig bijhouden van klantstatus in een Kanban-bord

**Bestand:** `CRM/crm_dashboard.html` (placeholder — ontwerp nog in uitwerking)

**Motivatie:** Kanban werd niet actief bijgehouden. De inbox is de feitelijke werkplek; daar de intelligentie toevoegen werkt beter dan een apart bord.

---

## Outlook / Mail-mappen

Mappen in Bart@mortiseandtenon.nl:

| Map | Doel |
|-----|------|
| `_Opruimen` | Tijdelijke opvang voor niet-relevante mails (bulk-archief) |
| `Uitbesteding` | Communicatie met externe partijen (bijv. RUBEX Interiors / Ruben Ploeg) |
| `Verwijderde items` | Standaard prullenbak |

---

## Graph API toegang

- **App:** MT-Outlook-Agent
- **Client ID:** `6793c34f-5e7a-4a55-914e-1863f0e30c23`
- **Auth:** Delegated (device code flow, MSAL, token cached in `CRM/token_cache.json`)
- **Scopes:** Mail.ReadWrite, Mail.Send, Calendars.ReadWrite, Contacts.ReadWrite, Files.ReadWrite.All, Tasks.ReadWrite

Scripts in `CRM/`:
- `outlook_agent.py` — algemene Outlook-agent (Claude-aangestuurd)
- `inbox_acties.py` — eenmalige opruimacties
- `inbox_opruimen.py` — bulk inbox opruimen

---

## Overige tools

Zie `Claude-context/tooling.md` voor de volledige tool-inventaris.
