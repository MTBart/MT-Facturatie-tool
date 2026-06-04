# NAS/VPN & n8n — Beknopte Samenvatting
*Datum: 15 mei 2026 | Max 1 A4*

---

## Tailscale vs Synology VPN Server

**Hoofdconclusie: gebruik Tailscale. Geen twijfel.**

| | Tailscale | Synology VPN Server |
|---|---|---|
| Setup | 15 minuten | Uren + router config |
| Onderhoud | Vrijwel nul | Periodiek updaten, cert-beheer |
| Betrouwbaarheid | Hoog (mesh, auto-reconnect) | Matig (NAT/firewall issues) |
| Site-to-site | ✅ Werkt via subnet routing | ✅ Werkt maar complex |
| Kosten | Gratis t/m 3 gebruikers / 100 devices | Gratis (maar je tijdkosten tellen) |
| DSM7 gotcha | Vereist TUN-script via Task Scheduler voor outbound access van andere apps | n.v.t. |

**Voor M&T:** installeer Tailscale op de NAS + op Bart's thuispc. Één keer een TUN-script instellen in DSM7 Task Scheduler (staat op SynoForum uitgelegd). Daarna heb je veilige toegang tot de NAS vanaf elke locatie zonder poorten open te zetten.

---

## n8n op Synology NAS

**Hoofdconclusie: werkt prima via Docker/Container Manager, maar plan even 1-2 uur voor de initiële setup.**

- Installatie via **Container Manager** (DSM7 ingebouwd) of Portainer
- **SQLite** is prima voor M&T-schaal; PostgreSQL pas nodig bij zware load
- **Webhook-config** is de meest genoemde struikelblok: je moet de correcte externe URL instellen, anders werken inkomende triggers niet
- Eenmaal draaiend: stabiel, updates duren 5 minuten

**Waarvoor n8n zinvol is voor M&T:**
- Attachment auto-save (Outlook → SharePoint) — kant-en-klare templates beschikbaar
- Periodieke rapportjes (Toggl uren → overzicht)
- Koppeling Moneybird-events → notificaties

**Niet doen:** n8n als vervanging van Power Automate voor alles. Power Automate zit al in je M365-licentie en is eenvoudiger voor puur Office-365-workflows. n8n schittert als je apps wil koppelen die *buiten* het Microsoft-ecosysteem vallen.

---

## Aanbevolen volgorde

1. **Tailscale installeren op NAS** — 30 min, direct resultaat
2. **TUN-script instellen in DSM7** — 15 min, nodig voor volledige toegang
3. **n8n draaien via Container Manager** — 1-2 uur, dan heb je automatiseringsplatform klaar
4. **Eerste n8n-flow: Outlook bijlagen → SharePoint** — 30 min met template

---
*Bronnen: SynoForum.com, Tailscale docs, n8n community forums, mariushosting.com*
