# Smart Inbox — Technisch Ontwerp
> Mortise & Tenon | Laatste update: 2026-05-14
> Status: **Ontwerp klaar — bouwen kan starten**

---

## 1. Concept & Motivatie

Het CRM kanban-dashboard werd niet actief bijgehouden omdat de werkelijke werkplek de inbox is. De **Smart Inbox** brengt de intelligentie naar waar het werk daadwerkelijk gebeurt: rechtstreeks in de mailstroom.

**Kernprincipe:** Elke mail = potentiële actie. Bij het openen van een mail verschijnt direct alle relevante context (klanthistorie, lopend Toggl-project, bijlagen in SharePoint) + one-click knoppen voor de meest logische vervolgstap.

---

## 2. Bestandsstructuur

```
CRM/
├── smart_inbox.html          ← Hoofdapplicatie (single-file, vanilla JS)
├── smart_inbox_api.js        ← Graph API + Toggl API wrapper (fase 2)
├── smart_inbox_matcher.js    ← Fuzzy matching engine mail → project
├── outlook_agent.py          ← Bestaand (backend voor Claude-gestuurde acties)
├── token_cache.json          ← MSAL token cache (bestaand)
└── .env                      ← CLIENT_ID, TENANT_ID (bestaand)
```

**Waarom single-file voor de UI?** Geen build-tooling nodig, werkt lokaal via `file://`, makkelijk te openen vanuit de SharePoint-map op elke machine.

---

## 3. Component Breakdown

### 3.1 Layout (twee-panelen)

```
┌─────────────────────────────────────────────────────────────────┐
│  TOPBAR: Logo | Zoekbalk | Filter-pills | Sync-knop | Status    │
├──────────────────────┬──────────────────────────────────────────┤
│  MAIL-LIJST (links)  │  DETAIL-PANEEL (rechts)                  │
│  ─────────────────── │  ──────────────────────────────────────  │
│  [Filter tabs]       │  [Mail header + afzender]                │
│  Inbox | Verzonden   │  [Actie-balk: Beantwoord/Archief/...]    │
│  Uitbesteding        │  ──────────────────────────────────────  │
│  ─────────────────── │  [CONTEXT KAART]                         │
│  Mail rij            │   └ Klant: CompaNanny                    │
│    ● Afzender        │   └ Project: CN-WEZEP-KEUKEN             │
│    ● Onderwerp       │   └ Toggl status: In Progress 🚧          │
│    ● Preview snippet │   └ Uren: 14.5u / ±40u geschat           │
│    ● Datum + badges  │   └ Fase: Productie                      │
│  ─────────────────── │  ──────────────────────────────────────  │
│  Mail rij (ongelezen)│  [MAIL BODY]                             │
│  Mail rij...         │  ──────────────────────────────────────  │
│                      │  [BIJLAGEN]  📄 Tekening_v2.pdf          │
│                      │  ──────────────────────────────────────  │
│                      │  [QUICK ACTIES]                          │
│                      │   [🆕 Maak project] [⏱ Start uren]       │
│                      │   [📋 Kopieer naar Toggl-taak]           │
│                      │   [📧 Stuur offerte-template]            │
└──────────────────────┴──────────────────────────────────────────┘
```

### 3.2 Componenten (JS modules / functies)

| Component | Verantwoordelijkheid |
|-----------|---------------------|
| `MailList` | Rendert gefilterde/gesorteerde maillijst, afhandelt klik-events |
| `MailDetail` | Toont mailinhoud + actie-knoppen op basis van geselecteerde mail |
| `ContextCard` | Toont gekoppeld Toggl-project, urenstatus, klantinfo |
| `QuickActions` | Rendert contextuele knoppen afhankelijk van match-resultaat |
| `MatchEngine` | Fuzzy koppeling mail → Toggl-project (zie §4) |
| `GraphClient` | Wrapper om Graph API calls (token refresh, paginering) |
| `TogglClient` | Wrapper om Toggl API v9 calls |
| `ToastManager` | Undo/feedback-meldingen onderaan scherm |
| `FilterBar` | Tabs + zoekveld + filter-chips bovenaan maillijst |

---

## 4. Data Flow: Mail → Toggl Project Matching

### 4.1 Matching-strategie (gelaagd, volgorde van zekerheid)

```
Mail binnenkomt
    │
    ▼
[1] Exact e-mailadres match
    → Zoek in lokale klant-cache op from.emailAddress.address
    → Match? → directe koppeling aan klant-ID
    │
    ▼ (geen match)
[2] Domein-match
    → @compananny.nl → CompaNanny
    → @lgm-projecten.nl → LGM Projecten
    → Onderhouden in config-object KNOWN_DOMAINS
    │
    ▼ (geen match)
[3] Onderwerp fuzzy match op Toggl-projectnamen
    → Strip stopwoorden (re:, fwd:, ?, !, offerte, aanvraag)
    → Levenshtein-afstand of token-overlap > 0.6 → match
    → Bijv. "Keuken Wezep" → "CN-WEZEP-KEUKEN"
    │
    ▼ (geen match)
[4] Afzendernaam tokenisatie
    → Splits voornaam/achternaam, zoek in Toggl-projectnamen
    │
    ▼ (geen match)
[5] Geen match → toon "Onbekende afzender" + [Maak project]-knop
```

### 4.2 Match-score weergave

Elke mail krijgt een `matchConfidence`: `high` / `medium` / `low` / `none`.
- **High** (groen puntje): 1 duidelijk project gevonden
- **Medium** (oranje puntje): meerdere kandidaten, gebruiker kiest
- **Low** (grijs puntje): zwakke match, aangeduid als suggestie
- **None** (geen puntje): onbekend, [+ Nieuw project] prominent zichtbaar

### 4.3 Caching

Toggl-projectenlijst wordt bij opstart opgehaald en in memory gecached (geen localStorage). Refresh elke 5 minuten of bij handmatige sync.

---

## 5. Graph API Endpoints

### Fase 1 (MVP)

| Doel | Endpoint | Methode |
|------|----------|---------|
| Inbox ophalen | `/me/mailFolders/inbox/messages?$top=50&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview` | GET |
| Mail detail + body | `/me/messages/{id}?$select=id,subject,from,toRecipients,body,receivedDateTime,hasAttachments` | GET |
| Bijlagen ophalen | `/me/messages/{id}/attachments` | GET |
| Mail markeren gelezen | `/me/messages/{id}` `{"isRead": true}` | PATCH |
| Mail archiveren | `/me/messages/{id}/move` `{"destinationId": "archive"}` | POST |
| Mail beantwoorden | `/me/messages/{id}/reply` | POST |
| Map lijst ophalen | `/me/mailFolders?$top=20` | GET |
| Uitbesteding-map | `/me/mailFolders/Uitbesteding/messages` | GET |

### Fase 2 (uitbreidingen)

| Doel | Endpoint |
|------|----------|
| Mail versturen | `POST /me/sendMail` |
| Contacten ophalen | `GET /me/contacts?$search="naam"` |
| Kalender afspraken | `GET /me/calendarView` |
| SharePoint bijlagen opslaan | `PUT /drives/{drive-id}/items/{path}:/content` |
| Teams-bericht sturen | `POST /teams/{id}/channels/{id}/messages` |

### Auth flow (bestaand hergebruiken)

```javascript
// Token ophalen via Python backend (outlook_agent.py) OF
// Direct in JS via MSAL.js browser library
// token_cache.json wordt bijgehouden door Python scripts
// Voor browser-gebruik: MSAL.js publicClientApplication
```

> **Aanbeveling voor fase 1:** Gebruik MSAL.js (browser) zodat smart_inbox.html standalone werkt zonder Python. De bestaande Python scripts blijven voor Claude-gestuurde acties.

---

## 6. Toggl API Endpoints (v9)

| Doel | Endpoint | Methode |
|------|----------|---------|
| Projecten ophalen | `GET /api/v9/workspaces/21258443/projects` | GET |
| Project aanmaken | `POST /api/v9/workspaces/21258443/projects` | POST |
| Taken ophalen voor project | `GET /api/v9/workspaces/21258443/projects/{id}/tasks` | GET |
| Timer starten | `POST /api/v9/time_entries` | POST |
| Lopende timer | `GET /api/v9/me/time_entries/current` | GET |
| Uren per project | `POST /api/v9/workspaces/21258443/reports/summary` | POST |

**Auth:** HTTP Basic met API-token in `.env` als `TOGGL_API_TOKEN`.

---

## 7. UI Stijl & Design Tokens

Gebaseerd op het CRM-dashboard (zelfde variabelen, uitgebreid voor inbox-context):

```css
:root {
  /* Bestaand (ongewijzigd van CRM) */
  --bg: #f9f9f7;
  --surface: #ffffff;
  --surface2: #f4f4f2;
  --border: #e4e4e0;
  --accent: #2d7a4f;        /* Groen — M&T primair */
  --accent2: #b5860d;       /* Messing/goud — M&T secundair */
  --text: #1a1a1a;
  --text2: #6b6b6b;
  --text3: #9e9e99;

  /* Nieuw voor Smart Inbox */
  --inbox-unread-bg: #fffdf7;   /* Licht goud tint voor ongelezen mails */
  --inbox-unread-border: #e8d5a3;
  --match-high: #2d7a4f;        /* Groen = zekere match */
  --match-medium: #e67e22;      /* Oranje = meerdere kandidaten */
  --match-low: #9e9e99;         /* Grijs = zwakke match */
  --panel-border: #e4e4e0;
  --topbar-height: 54px;
  --maillist-width: 360px;
}
```

**Typografie:** Segoe UI (zelfde als CRM), geen externe fonts.

**Geen frameworks:** Vanilla HTML/CSS/JS. Optioneel MSAL.js via CDN voor auth in fase 2.

---

## 8. Fasering

### Fase 1 — MVP (morgen bouwen)

**Doel:** Werkende UI met mock data + Graph API verbinding

- [x] HTML prototype shell met twee-panelen layout (mock data)
- [ ] Graph API verbinding via MSAL.js (device code of interactieve login)
- [ ] Inbox-mails ophalen en renderen in maillijst
- [ ] Klik op mail → mailbody weergeven in detail-paneel
- [ ] Statische klant-config: KNOWN_DOMAINS object met bekende domeinen
- [ ] Toggl API verbinding + projectenlijst ophalen
- [ ] Basis matching (domein + exacte e-mail)
- [ ] Context-kaart vullen met Toggl-project data
- [ ] Bijlagen tonen (namen, download-links)
- [ ] "Maak project" → opent nieuw-project flow (of modal)
- [ ] Mail markeren als gelezen bij openen
- [ ] Mail archiveren (verplaatsen naar `_Opruimen`)

**Deliverable:** `smart_inbox.html` die je lokaal kunt openen en die echte mail toont.

### Fase 2 — Slimme matching (week 2)

- [ ] Fuzzy matching op onderwerp + afzendernaam (Levenshtein)
- [ ] Multi-kandidaat weergave bij `medium` confidence
- [ ] Uren-samenvatting per project uit Toggl
- [ ] Timer starten vanuit inbox
- [ ] Reply-template: offerte, planning, bevestiging
- [ ] Filter op periode, afzender, project-status

### Fase 3 — Integraties (maand 2)

- [ ] Bijlagen opslaan in SharePoint (juiste projectmap)
- [ ] Kalender-afspraken koppelen aan mail-thread
- [ ] Moneybird: factuur aanmaken vanuit mail
- [ ] PWA manifest zodat het op homescreen zet
- [ ] Mathijs-toegang (multi-user, inbox-selectie)
- [ ] Teams-integratie voor interne notificaties

---

## 9. Quick Acties — Logica per Situatie

| Situatie | Primaire actie | Secundaire acties |
|----------|---------------|-------------------|
| Match = high, project actief | ⏱ Start uren | 📋 Taak toevoegen, 📧 Beantwoord |
| Match = high, project afgerond | 💰 Maak factuur | 📧 Beantwoord |
| Match = medium (meerdere) | ❓ Kies project | 🆕 Nieuw project, 📧 Beantwoord |
| Match = none, klant bekend | 🆕 Maak project | 📧 Beantwoord, 🗂 Archiveer |
| Match = none, onbekend | 👤 Nieuwe klant + project | 📧 Beantwoord |
| Bijlage aanwezig | 📁 Sla op in SharePoint | (contextueel) |

---

## 10. Bekende Risico's & Keuzes

| Risico | Mitigatie |
|--------|-----------|
| MSAL in browser vereist redirect URI | Gebruik `http://localhost` als redirect, of device code flow via Python backend |
| Token verloopt na 1u | Silent refresh via MSAL.js, of refresh via Python outlook_agent.py |
| Toggl-projectnamen matchen slecht | Begin met KNOWN_DOMAINS config, voeg fuzzy matching toe in fase 2 |
| Grote inbox (>500 mails) → traag | Pagineer op 50 mails, laad meer on-demand |
| Bijlagen kunnen groot zijn | Toon alleen naam + grootte, download op aanvraag |
| Single-file groeit groot | Splits in fase 2 naar losse JS-modules (smart_inbox_api.js, smart_inbox_matcher.js) |

---

## 11. Volgende Stap (morgen)

1. Open `smart_inbox.html` in browser → bekijk mock UI
2. Maak `CRM/.env` met `CLIENT_ID=6793c34f-5e7a-4a55-914e-1863f0e30c23` en `TENANT_ID`
3. Voeg MSAL.js toe aan de HTML (CDN) + Graph API auth flow implementeren
4. Vervang mock-data door echte `/me/mailFolders/inbox/messages` call
5. Voeg KNOWN_DOMAINS config toe met CompaNanny, LGM, Inter Projecten domeinen
6. Test met echte mail → Toggl match

> **Tip:** Werk fase 1 stap voor stap af. De HTML shell staat al klaar als startpunt.
