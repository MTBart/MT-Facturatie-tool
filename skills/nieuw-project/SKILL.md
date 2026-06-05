---
name: nieuw-project
description: >
  Gebruik deze skill ALTIJD wanneer Bart of Mathijs een nieuw project wil aanmaken,
  een klus wil registreren, een offerte wil starten, of vraagt om taken aan te maken
  voor een klant of opdracht. Triggers: "nieuw project", "klus voor [klant]",
  "project aanmaken", "taken aanmaken voor", "offerte starten", "keuken voor",
  "kast voor", "tafel voor", "badkamer voor", "registreer project", "zet project klaar".
  Ook triggeren bij spraakberichten met klantnamen + projecttype combinaties.
  Deze skill loopt een slim interview af, laadt de juiste template, maakt het volledige
  project aan in Toggl Focus (met status, prioriteit, tags, tijdschattingen en toewijzingen),
  en leert van afwijkingen zodat templates steeds beter worden.
---

# Skill: Nieuw Project Aanmaken

Je maakt een volledig Toggl Focus project aan via een slim interview-proces.
Je laadt de templates, stelt de juiste vragen, maakt alles aan in Toggl via de browser,
en leert van afwijkingen zodat de volgende keer nog soepeler gaat.

## Stap 1 — Laad de templates en Toggl-gegevens

Lees ALTIJD eerst:
`\\B5-NAS\B5-Applicaties\Claude\Claude-context\toggl-templates.md`

Dit bestand bevat alle vaste Toggl-IDs, users, statuses, tags en de projecttemplates.
Werk NOOIT vanuit geheugen — de bron van waarheid is dit bestand.

## Stap 2 — Interview (conversationeel, niet als formulier)

Loop de volgende punten af in natuurlijke gesprekstaal. Stel niet alle vragen tegelijk.
Verwerk antwoorden die de gebruiker al heeft gegeven in zijn bericht (haal er uit wat erin zit).

### Verplichte vragen (altijd stellen als niet bekend):
1. **Klantnaam** — wie is de klant?
2. **Projecttype** — keuken / kast / tafel / badkamer / custom / anders?
3. **Bijzonderheden** — afmetingen, materialen, speciale wensen die de standaard template raken?
4. **Opleverdatum** — wanneer moet het klaar zijn? (bepaalt einddatum project)
5. **Urgentie** — hoe urgent? Gebruik dit voor prioriteit: urgent/high/medium/low/none
6. **Uitvoerder(s)** — Bart, Mathijs, Arjan, of een combinatie?

### Optioneel (stel alleen als relevant):
- Billable? (default: ja — vraag alleen bij intern werk, garantie of correctie)
- Startdatum ontwerp/offerte? (default: vandaag)
- Taken die NIET in de standaard template zitten?

### Slim omgaan met de input:
- Als iemand zegt "keuken voor Van der Berg, spoed, Arjan voert uit, oplevering eind juni" → haal alles eruit, vraag alleen wat ontbreekt
- Als het type onduidelijk is, stel één gerichte vraag
- Gebruik humor en korte zinnen — dit is een collega, geen klant

## Stap 3 — Template kiezen en aanpassen

Laad de juiste template uit `toggl-templates.md` op basis van het projecttype.

**Pas de template aan op basis van het interview:**
- Vervang standaard uitvoerders door de genoemde persoon/personen
- Pas geschatte tijden aan als de klant bijzondere wensen heeft (grotere keuken → meer productietijd)
- Voeg niet-standaard taken toe die de gebruiker noemde
- Stel de juiste prioriteit in op basis van urgentie
- Bereken start/einddatums op basis van opleverdatum en projecttype (keuken = 8-12 weken terug, kast = 4-6 weken, tafel = 2-3 weken)

**Laat de gebruiker bevestigen voor je aanmaakt:**
Geef een compacte samenvatting:
```
Project: [naam klant] — [type]
Klant in Toggl: [bestaand/nieuw]
Taken: [X hoofdtaken, Y subtaken]
Totaal geschat: [X uur]
Prioriteit: [prioriteit]
Uitvoerder(s): [namen]
Looptijd: [van] → [tot]
Afwijkingen van standaard: [lijst of "geen"]

Aanmaken?
```

## Stap 4 — Aanmaken in Toggl Focus via browser

Gebruik de Chrome browser tool (mcp__Claude_in_Chrome__javascript_tool) op focus.toggl.com.
De tab met Toggl Focus is al open — gebruik die.

### Vaste aanpak:
```javascript
function api(method, path, body) {
  const xhr = new XMLHttpRequest();
  xhr.open(method, path, false);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'Bearer <TOGGL_FOCUS_KEY>'); // nooit hardcoden — uit ~/.mt-secret
  xhr.send(body ? JSON.stringify(body) : null);
  try { return JSON.parse(xhr.responseText || '{}'); }
  catch(e) { return { error: xhr.responseText }; }
}
```

### Volgorde van aanmaken:
1. **Client zoeken of aanmaken**
   - Zoek eerst: `GET /api/workspaces/21258443/clients?name=[klantnaam]`
   - Als niet gevonden: `POST /api/workspaces/21258443/clients` met `{ name: klantnaam }`

2. **Project aanmaken**
   - `POST /api/organizations/21259253/workspaces/21258443/projects`
   - Velden: `name`, `client_id`, `color`, `estimated_mins`, `start_date`, `end_date`
   - Color tip: keuken=#0057FF, kast=#8B5CF6, tafel=#10B981, badkamer=#F59E0B, custom=#6B7280

3. **Hoofdtaken aanmaken** (één voor één, sla task IDs op voor subtaken)
   - `POST /api/organizations/21259253/workspaces/21258443/tasks`
   - Velden: `name`, `project_id`, `estimated_mins`, `assignee_user_ids`, `status_id`, `tag_ids`, `priority`, `billable`, `start_date`, `end_date`, `description`

4. **Subtaken aanmaken** (gebruik `parent_task_id`)
   - Zelfde endpoint, met `parent_task_id` ingevuld

⚠️ **BELANGRIJK bij PUT (bijwerken van bestaande taken):**
   - Stuur altijd `project_id` mee — weglaten koppelt taken los van het project!
   - Stuur altijd `name` mee — is verplicht veld bij PUT.

### Taken ophalen per project (voor updates):
Gebruik de **stream** endpoint — de gewone /tasks endpoint negeert de project_ids filter:
```
GET /api/organizations/21259253/workspaces/21258443/tasks/stream?project_id={id}&archived=false&include_project_completed=true&source=focus
```
Returns: JSON array direct (geen paginering, geen SSE-parsing nodig).

### Billable instelling:
- Klantproject: `billable: true`
- Intern / garantie / correctie: `billable: false`

### Status bij aanmaken:
- Eerste taak (ontwerp/offerte): `status_id: 300785` (Todo)
- Alle andere taken: `status_id: 314194` (Backlog) — ze moeten nog ingepland worden

### Navigeer na aanmaken naar het project:
```javascript
window.location.href = '/21259253/workspaces/21258443/projects/' + projectId + '/tasks';
```

## Stap 5 — Bevestig en rapporteer

Geef een korte samenvatting:
```
✅ Project aangemaakt: [naam] voor [klant]
📋 [X] taken + [Y] subtaken
⏱ Totaal: [uur] uur
🔗 Geopend in Toggl Focus
```

## Stap 6 — Leren van afwijkingen

**Na elke aanmaak, vraag:**
> "Zijn er taken bij die ik nog niet in de standaard template heb zitten? Dan onthoud ik ze voor de volgende keer."

Als de gebruiker afwijkingen noemt:
1. Schrijf ze naar `\\B5-NAS\B5-Applicaties\Claude\Claude-context\toggl-templates.md` onder "Geleerde Afwijkingen"
2. Houd bij hoe vaak elke afwijking voorkomt
3. Als een afwijking **2 of meer keer** voorkomt → stel proactief voor om het aan de standaard template toe te voegen
4. Na bevestiging: update de template in `toggl-templates.md`

**Proactief patroonherkenning:**
- Vergelijk altijd de afwijkingen van dit project met eerder geleerde afwijkingen
- Meld het actief als je iets herkent: "Dit lijkt op wat je bij [vorig project] ook deed — wil ik dat nu standaard maken?"

## Foutafhandeling

- **Klant al bestaat:** gebruik de bestaande client_id, maak geen duplicaat
- **API-fout:** log de fout, probeer de specifieke taak opnieuw, sla de rest niet over
- **Toggl Focus niet open in browser:** navigeer eerst naar `https://focus.toggl.com` voor je API calls doet
- **Tab niet gevonden:** gebruik `mcp__Claude_in_Chrome__tabs_context_mcp` om de juiste tab te pakken

## Langetermijnvisie

Deze skill is de basis voor de eigen tool van Mortise & Tenon.
Noteer in `\\B5-NAS\B5-Applicaties\Claude\Claude-context\toggl-templates.md` alle inzichten
die ook in de eigen tool moeten komen: welke velden het meest gebruikt worden,
welke flows het soepelst lopen, welke templates het meest kloppen.
Zo bouwen we kennis op voor de toekomstige migratie naar de eigen tool.
