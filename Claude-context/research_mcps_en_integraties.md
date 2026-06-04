# Research: MCPs & Integraties voor Mortise & Tenon
*Datum: 15 mei 2026 | Doel: directe waarde voor bestaande setup*

---

## 1. MCP voor Toggl Track

**Conclusie: er bestaan meerdere, één staat eruit.**

Er zijn minstens 8 community-MCPs voor Toggl Track op GitHub. De meest volwassen optie voor jullie gebruik:

**`verygoodplugins/mcp-toggl`** — aanbevolen
- Ondersteunt timer starten/stoppen, rapportages (dagelijks, wekelijks, custom), project analytics
- Intelligent caching: warmt bij opstart alvast workspaces/projecten/klanten op, daarna snelle responses met minder API-calls
- Multi-workspace support — relevant als jullie ooit gescheiden werkruimtes willen
- Actief onderhouden (releases zichtbaar op GitHub)

**`vontell/toggl-track-mcp`** — alternatief, gebouwd met Claude Code zelf
- Iets eenvoudiger, gebruikt Toggl API v9
- Goed startpunt als je snel iets wil zonder caching-overhead

**Praktisch:** installatie via NPX, API-key uit Toggl-profiel. Configuren in Claude Desktop `claude_desktop_config.json`. Na installatie kun je gewoon zeggen "start timer voor project X" of "geef me het urenrapport van deze week".

**GitHub:** https://github.com/verygoodplugins/mcp-toggl

---

## 2. MCP voor Moneybird

**Conclusie: bestaat, en is specifiek voor Moneybird gebouwd.**

**`vanderheijden86/moneybird-mcp-server`** — de enige serieuze optie, maar wel bruikbaar

Functionaliteit:
- Contactbeheer (ophalen, filteren, aanmaken, bijwerken)
- Factuurdata (verkoopfacturen, betalingen)
- Producten, projecten, tijdregistraties
- Custom API-requests naar Moneybird-endpoints

Setup: API-token + administratie-ID invullen in config. Let op: je hebt al een eigen Moneybird MCP draaien via de Cloudflare Worker. Bekijk eerst of die MCP hetzelfde dekt — zo ja, skip deze. Als jullie eigen MCP beperkt is in functionaliteit, kun je `vanderheijden86` ernaast zetten of als basis gebruiken voor uitbreiding.

**GitHub:** https://github.com/vanderheijden86/moneybird-mcp-server

---

## 3. Ollama + Claude integratie

**Conclusie: technisch mogelijk, maar er zitten echte valkuilen in.**

### Wat werkt:
Het concept "Claude denkt, lokaal model doet het zware werk" werkt in theorie goed. De MCP `aplaceforallmystuff/mcp-local-llm` is hiervoor specifiek gebouwd: Claude delegeert taken (samenvatten, classificeren, concept schrijven) via MCP aan Ollama, controleert het resultaat, en presenteert het aan jou.

Voor jullie setup met `qwen2.5:14b` is dit realistisch — dat model ondersteunt tool-calling, wat essentieel is.

### Bekende problemen (eerlijke beoordeling):

1. **Context-window is de bottleneck.** Ollama heeft default 4.096 tokens context. Claude-workflows hebben al snel 10-50K nodig. Oplossing: bij Ollama instellen op 32K of 64K (`num_ctx` parameter in Modelfile). Zonder dit: crashes of hallucinaties.

2. **Streaming werkt niet.** Lokale MCP-bridges wachten tot het model klaar is voor de tool aangeroepen wordt. Merkbaar langzamere responses dan bij Claude rechtstreeks.

3. **Claude Desktop praat altijd met Anthropic.** Claude Desktop is hardcoded naar de Anthropic API — je kunt het niet vervangen door Ollama. Wat wél werkt: Ollama als *hulpmodel naast* Claude, via MCP. Dus: Claude (Anthropic) + Ollama (lokaal) samen in één workflow.

### Praktisch gebruik voor M&T:
- Zinvol voor: grote tekstblokken samenvatten (offerteaanvragen, lange mails), classificeren van inkomende berichten, eerste concepten genereren
- Minder zinvol voor: complexe redenering, code, strategische beslissingen — dat blijft bij Claude

**GitHub:** https://github.com/aplaceforallmystuff/mcp-local-llm
**Artikel met bekende issues:** https://dev.to/richardbaxter/making-a-local-llm-mcp-server-deterministic-model-routing-think-block-stripping-and-the-problems-5bmj

---

## 4. Mail → Project koppeling (Smart Inbox)

**Conclusie: zelf bouwen is de pragmatischste weg, maar er zijn goede bouwstenen.**

### Wat er bestaat:
- **`email-triage-plugin` (ericporres):** Claude-plugin met drie-tier classificatie (reply nodig / review / ruis), reply-concepten, archiefbeheer. Open source template op GitHub. Gebouwd voor Gmail maar aanpasbaar.
- **MailMCP (`mailmcp.io`):** Commerciële MCP die echte verzending ondersteunt (niet alleen drafts). Werkt met Outlook, Gmail. Relevant als je wil dat Claude zelf mails verstuurt.
- **Microsoft Graph MCP (jullie hebben al Graph toegang):** Jullie bestaande Graph-integratie kan al maildata ophalen. Ontbrekende schakel: de logica die mail + projectnaam koppelt.

### Wat bruikbaar is voor jullie Smart Inbox:

**Beste aanpak:** bouw voort op de Microsoft Graph-koppeling die je al hebt. Stappenplan:
1. Graph leest inkomende mail → Claude analyseert afzender + onderwerp
2. Claude vergelijkt met bestaande projecten/klanten in Moneybird of Toggl
3. Match → tag mail + sla op in juiste SharePoint-map
4. Geen match → gooit het in een "onbekend"-bak voor handmatige sortering

De email-triage-plugin geeft een goede blauwdruk voor de classificatielogica. De drie tiers (actie nodig / info / ruis) sluiten goed aan op hoe een maatwerkbedrijf mail verwerkt.

**GitHub:** https://github.com/ericporres/email-triage-plugin
**MailMCP:** https://mailmcp.io/en

---

## 5. Attachment auto-save

**Conclusie: niet zelf bouwen — dit bestaat al kant-en-klaar via Power Automate.**

### Beste optie: Power Automate (inbegrepen bij jullie Microsoft 365)

Jullie betalen er al voor. Concrete flow die je kunt bouwen:

1. **Trigger:** nieuwe mail in Outlook met bijlage
2. **Filter:** alleen bijlagen van bepaalde afzenders of met bepaalde onderwerpen
3. **Actie:** sla bijlage op in SharePoint — map bepaald op basis van afzender of onderwerp
4. **Optioneel:** tag het bestand met metadata (van wie, wanneer, onderwerp)

Dit werkt betrouwbaar, heeft geen extra tools of kosten nodig, en is via de Power Automate webinterface te bouwen zonder code.

### Slim maken met AI (stap 2):
Als je de mapkeuze wil automatiseren op basis van inhoud (niet alleen afzender), voeg dan een Claude of AI Builder stap toe die de bestandsnaam of onderwerpregel analyseert en de juiste projectmap kiest.

### n8n als alternatief:
n8n heeft kant-en-klare templates voor Outlook → OneDrive/SharePoint attachment-opslag. Zinnig als je n8n sowieso al draait op de NAS (zie VPN/NAS-rapport). Dan kun je alles in één tool beheren.

**Power Automate handleiding:** https://blog.admindroid.com/how-to-save-email-attachments-in-sharepoint-with-power-automate/
**n8n Outlook template:** https://n8n.io/workflows/6938-automatically-save-and-organize-outlook-email-attachments-in-onedrive-folders/

---

## Prioriteitenlijst voor M&T

| Prioriteit | Actie | Moeite | Waarde |
|---|---|---|---|
| 1 | Toggl MCP installeren (`verygoodplugins`) | Laag (1 uur) | Hoog |
| 2 | Power Automate flow voor bijlagen naar SharePoint | Laag (2 uur) | Hoog |
| 3 | Moneybird MCP vergelijken met bestaande eigen MCP | Laag (30 min lezen) | Middel |
| 4 | Smart Inbox prototype op basis van Graph + email-triage-plugin | Middel (dagwerk) | Hoog |
| 5 | Ollama MCP voor bulk-taken (samenvatten, classificeren) | Middel (context-window instellen) | Middel |

---
*Bronnen: GitHub repositories, DEV.to praktijkervaringen, n8n workflow templates, SynoForum community*
