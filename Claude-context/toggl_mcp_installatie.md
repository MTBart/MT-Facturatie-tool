# Toggl MCP — Installatiegids voor Cowork op Windows

**Tijdsinschatting:** ~15 minuten  
**Moeilijkheidsgraad:** Laag (kopiëren en plakken)  
**GitHub repo:** https://github.com/verygoodplugins/mcp-toggl

---

## Wat je nodig hebt

- Node.js (al geïnstalleerd ✅)
- Je Toggl API key (zie hieronder)
- Je Toggl Workspace ID (optioneel, maar handig)

### Toggl API key ophalen

1. Ga naar https://track.toggl.com/profile
2. Scroll helemaal naar beneden naar de sectie **"API Token"**
3. Klik op **"Click to reveal"**
4. Kopieer de sleutel — bewaar hem even in Kladblok

> ⚠️ Behandel deze key als een wachtwoord. Deel hem niet via mail of chat.

### Toggl Workspace ID ophalen (optioneel)

1. Ga naar https://track.toggl.com
2. Klik linksboven op je workspace-naam
3. Ga naar **Settings**
4. Je ziet het Workspace ID in de URL: `https://track.toggl.com/[WORKSPACE_ID]/settings`

---

## Installatie in Cowork (Claude Desktop)

Cowork gebruikt een configuratiebestand om MCP-servers te laden. Je hoeft niets te downloaden of te bouwen — `npx` doet dat automatisch.

### Stap 1: Open het configuratiebestand

Druk op `Win + R`, typ het volgende en druk op Enter:

```
%APPDATA%\Claude
```

Open het bestand `claude_desktop_config.json` in Kladblok of Notepad++.

> Als het bestand nog niet bestaat: maak een nieuw tekstbestand aan en sla het op als `claude_desktop_config.json` in die map.

### Stap 2: Voeg de Toggl MCP toe

Plak dit in het bestand (of voeg het toe aan het bestaande `mcpServers`-blok als je al andere servers hebt):

```json
{
  "mcpServers": {
    "mcp-toggl": {
      "command": "npx",
      "args": ["-y", "@verygoodplugins/mcp-toggl@latest"],
      "env": {
        "TOGGL_API_KEY": "PLAK_HIER_JE_API_KEY",
        "TOGGL_DEFAULT_WORKSPACE_ID": "PLAK_HIER_JE_WORKSPACE_ID"
      }
    }
  }
}
```

Vervang `PLAK_HIER_JE_API_KEY` met je echte API key.  
`TOGGL_DEFAULT_WORKSPACE_ID` is optioneel — als je maar één workspace hebt, kan je die regel weglaten.

### Stap 3: Sla op en herstart Cowork

Sla het bestand op en herstart de Claude desktop app volledig (sluit af via de systeembalk, niet alleen het venster).

---

## Testen of het werkt

Open Cowork en typ één van de volgende vragen:

```
Welke timer loopt er nu in Toggl?
```
```
Geef me een overzicht van mijn uren van vandaag.
```
```
Geef een weekoverzicht van mijn Toggl-uren.
```

Als Toggl reageert met data, werkt de MCP. Als je een foutmelding krijgt, zie de sectie Problemen hieronder.

---

## Wat je ermee kunt doen

### Timers beheren
- **Timer starten:** "Start een timer voor [projectnaam]"
- **Timer stoppen:** "Stop de huidige timer"
- **Huidige timer bekijken:** "Welke timer loopt er?"

### Urenoverzichten
- **Vandaag:** "Hoeveel uur heb ik vandaag gewerkt en waaraan?"
- **Deze week:** "Geef een weekoverzicht van mijn uren"
- **Vorige week:** "Wat heb ik vorige week geregistreerd?"
- **Per project:** "Hoeveel uur heb ik deze maand aan [project] besteed?"

### Projecten en werkplekken
- "Welke projecten heb ik actief in Toggl?"
- "Laat alle werkplekken zien"

### Rapportages
- "Maak een dagrapport voor gisteren"
- "Geef een projectsamenvatting voor deze maand"

---

## Problemen oplossen

**Foutmelding: 401 of 403**  
→ Je API key klopt niet. Ga naar https://track.toggl.com/profile, genereer een nieuwe key, en update het configuratiebestand.

**MCP verschijnt niet in Cowork**  
→ Controleer of het JSON-bestand geldig is (geen ontbrekende komma's of haakjes). Gebruik https://jsonlint.com om te checken.

**Verouderde data**  
→ Typ: "Wis de Toggl cache" — de MCP laadt dan verse data op.

---

## Moneybird MCP — bevinding

Er bestaat een publieke Moneybird MCP server: **`vanderheijden86/moneybird-mcp-server`**  
GitHub: https://github.com/vanderheijden86/moneybird-mcp-server  
NPM: `moneybird-mcp-server`

**Mogelijkheden:** contacten beheren, facturen inzien/aanmaken, financiële rekeningen, producten, projecten en tijdregistraties — alles via Claude in gewone taal.

**Advies voor Mortise & Tenon:**  
De bestaande Cloudflare Worker werkt en is specifiek afgestemd op jullie workflow. De Moneybird MCP van vanderheijden86 is een generieke community-oplossing (24 stars, 12 forks, actief onderhouden). 

- **Voordeel MCP:** directe integratie zonder omweg via Worker, meer mogelijkheden (ook schrijven naar Moneybird)
- **Risico:** minder maatwerk dan de huidige Worker; testen vereist
- **Aanbeveling:** installeer als tweede optie naast de Worker en test of het jullie workflow verbetert. Als het beter werkt → Worker uitfaseren.

Installatie Moneybird MCP werkt hetzelfde als Toggl: voeg toe aan `claude_desktop_config.json` met je `MONEYBIRD_API_TOKEN` en `MONEYBIRD_ADMINISTRATION_ID` (te vinden in de URL op https://moneybird.com).

---

*Laatste update: mei 2026*
