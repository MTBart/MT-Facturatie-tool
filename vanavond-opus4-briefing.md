# Briefing voor Opus 4 — vanavond in de terminal

Datum: 2026-05-19  
Door: Bart (myPKA / Mortise & Tenon)  
Model: gebruik claude-opus-4-7 of hoger  
Vault: `C:\Users\BartWitte\OneDrive - Mortise & Tenon\Bart-PKA\`

---

## Taak 1 — myPKA kennissysteem upgraden

### Context

myPKA is een Obsidian-vault met een agents-structuur (Larry + specialisten zoals Penn, Pax, Nolan etc.). De architectuur staat in `AGENTS.md` en `CLAUDE.md` in de vault-root. Dit is de bestaande structuur — **niet vervangen, uitbreiden**.

De upgrade is geïnspireerd op Karpathy's LLM Wiki (v1 + v2) maar blijft volledig via de agents-structuur werken. Geen externe tools toevoegen buiten wat al aanwezig is (Obsidian, Graphify, Claude Code).

### Wat uitgewerkt moet worden

**1. log.md per sectie**
- Voeg `log.md` toe aan `Team Knowledge/` en de relevante Mortise & Tenon-submappen
- Format: append-only, elke entry heeft prefix `## [YYYY-MM-DD] <actie> | <titel>`
- Parseerbaar met `grep "^## \[" log.md | tail -10`
- Larry schrijft hier na elke ingest/sessie een entry in

**2. Supersessie-conventie**
- Definieer in `AGENTS.md` hoe een feit wordt opgevolgd door een nieuwer feit
- Oud bestand blijft staan, krijgt bovenaan: `> ⚠️ Superseded by [[nieuw-bestand]] — YYYY-MM-DD`
- Nooit automatisch verwijderen. Supersessie is expliciet, niet via decay.

**3. Stale-status in frontmatter**
- Voeg `stale: false` toe aan het frontmatter-schema in `GL-002-frontmatter-conventions.md`
- Wordt handmatig gezet na een lint-ronde, nooit automatisch
- Lifecycle: `draft → reviewed → verified → stale → archived` (archived = verplaatst naar `_archive/` submap)

**4. Memory-lagen formaliseren in AGENTS.md**
Leg de volgende vier lagen vast als concept, met promotie-regels:

| Laag | Wat | Waar in vault | Promotie-trigger |
|---|---|---|---|
| Working memory | Ruwe aantekeningen, inbox | `Team Inbox/` of `PKM/Inbox/` | Handmatig door Larry na sessie |
| Episodic memory | Sessie-samenvattingen | `Team Knowledge/session-logs/` | Automatisch — Larry schrijft na elke sessie |
| Semantic memory | Wiki-pagina's, gekurateerde kennis | `Team Knowledge/` of `Mortise & Tenon/` | Na 2+ bevestigingen vanuit verschillende bronnen |
| Procedural memory | SOPs, workflows, patronen | `Team Knowledge/SOPs/` of `Workstreams/` | Wanneer een patroon ≥3x herhaald is in session-logs |

**5. Graphify integreren in AGENTS.md**
- Graphify is al actief (`Team Knowledge/graphify-out/`)
- Rol vastleggen: Graphify = navigatielaag (wie verwijst naar wie), wiki-pagina's = leeslaag
- Lint-instructie voor Nolan (of relevante specialist): na elke ingest checken of graph-node al bestaat, zo nee — aanmaken, zo ja — cross-links bijwerken
- Graphify wordt gedraaid vanuit terminal, niet vanuit agents zelf

**6. Crystallisatie-afspraak**
- Larry vraagt aan het einde van een productieve sessie: "Is er iets uit dit gesprek dat de vault in moet?"
- Format voor teruggeschreven antwoorden: korte pagina met frontmatter `source: conversation`, datum, max 3 bullets + conclusie
- Bestandsnaam: `YYYY-MM-DD-<slug>.md` in de relevante map

### Deliverable Taak 1
- Bijgewerkte `AGENTS.md` met bovenstaande conventies
- Nieuw `GL-003-memory-lifecycle.md` in `Team Knowledge/Guidelines/`
- Lege `log.md` bestanden aangemaakt op de juiste plekken
- Kort testscenario: "hoe zou Larry een nieuw geleerd feit door de lagen heen promoveren?"

---

## Taak 2 — Lokale factuurverwerking naar Moneybird

### Context

Moneybird scant PDF-facturen zelf maar maakt regelmatig fouten (verkeerde categorie, leverancier, BTW-veld). Bart wil een tussenlaag die:
- Lokaal draait (Ollama, geen Anthropic-tokens)
- Zelflerend is per leverancier
- Afwijkingen controleert en bij twijfel om bevestiging vraagt
- Uiteindelijk via de Moneybird API de boeking aanmaakt

Dit is **geen myPKA-project** — het is een standalone workflow, los van de vault.

### Stack

- **PDF uitlezen:** Ollama + Llama 3.2 Vision (of Granite Vision 3.3 2b voor documenten)
- **Workflow-lijm:** n8n self-hosted (of Python-script als n8n te zwaar is)
- **Leergeheugen:** één JSON-bestand per leverancier in een lokale map (`/factuur-brain/leveranciers/<naam>.json`)
- **Output:** Moneybird API — `POST /external_sales_invoices` + PDF als bijlage

### Wat uitgewerkt moet worden

**1. PDF-extractie module**
- Python-script dat een PDF pakt en via Ollama (lokaal) de volgende velden extraheert als JSON:
  - `leverancier`, `factuurnummer`, `datum`, `vervaldatum`, `bedrag_excl`, `btw_percentage`, `btw_bedrag`, `bedrag_incl`, `iban`, `omschrijving`
- Fallback: als een veld niet gevonden wordt → `null` (niet raden)
- Prompt geoptimaliseerd voor Nederlandse facturen

**2. Leergeheugen per leverancier**
- Na elke bevestigde boeking wordt het patroon opgeslagen in `leveranciers/<naam>.json`:
  ```json
  {
    "naam": "Topdek BV",
    "standaard_categorie": "Inkoopkosten materialen",
    "btw_percentage": 21,
    "grootboekrekening": "4000",
    "betrouwbaarheid": 0.95,
    "gezien": 12
  }
  ```
- Bij volgende factuur van dezelfde leverancier: patroon wordt voorgesteld, niet automatisch toegepast
- Betrouwbaarheid stijgt per bevestiging, daalt bij correctie

**3. Controle- en goedkeuringslaag**
- Systeem vergelijkt eigen extractie met wat Moneybird zelf al heeft ingevuld (via Moneybird API ophalen)
- Bij afwijking > drempelwaarde (bijv. bedrag verschilt > €1): vraag om bevestiging
- Bij bekende leverancier + hoge betrouwbaarheid: automatisch verwerken (met log)
- Eenvoudige UI: terminal-prompt of een simpele webpagina via n8n

**4. Moneybird API-koppeling**
- Auth: OAuth2 Bearer token (uit env var)
- Stap 1: zoek contact op bij Moneybird op naam (`GET /contacts?query=<naam>`)
- Stap 2: maak externe verkoopfactuur aan (`POST /external_sales_invoices`)
- Stap 3: voeg PDF toe als bijlage (`POST /external_sales_invoices/:id/attachments`)
- Documentatie: https://developer.moneybird.com/integration/importing-external-invoices

**5. Trigger**
- Optie A: watch-map — script monitort een map, elke PDF die erin valt wordt verwerkt
- Optie B: n8n workflow — email-trigger (factuur als bijlage) of handmatige knop
- Aanbeveling: begin met watch-map (simpeler, geen n8n-setup nodig voor MVP)

### Deliverable Taak 2
- `factuur_extractor.py` — PDF → JSON via Ollama
- `moneybird_client.py` — wrapper voor de Moneybird API-calls
- `leergeheugen.py` — lees/schrijf leverancier-patronen
- `main.py` — orkestreert de drie modules, inclusief bevestigingsflow
- `README.md` — hoe het te draaien, welke env vars nodig (MONEYBIRD_TOKEN, OLLAMA_URL)
- Sla alles op in: `C:\Users\BartWitte\Mortise & Tenon\Mortise & Tenon - On-Prem-Data\Applicaties\Factuurverwerking\`

---

---

## Taak 3 — Nieuwe specialist inhuren: Vigil (Security Reviewer)

### Context

Bart installeert regelmatig nieuwe tools, MCP-servers en plugins. Hij heeft toegang gegeven aan meerdere mappen op zijn computer. Er is momenteel geen specialist die security beoordeelt — dat is een gat.

Vigil is geen technische uitvoerder maar een beoordelaar. Hij kijkt mee voordat iets geïnstalleerd of gekoppeld wordt, en scant periodiek of de bestaande setup geen risico's heeft.

### Volg de standaardprocedure

Lees `Team Knowledge/SOPs/SOP-001-how-to-add-a-new-specialist.md` en volg die stap voor stap. Betrek Pax voor het onderzoek, Nolan voor het contract.

### Vigil's profiel (richting voor Pax/Nolan)

**Naam:** Vigil  
**Rol:** Security Reviewer  
**Wanneer Larry naar Vigil routed:**
- Gebruiker wil iets nieuws installeren (tool, plugin, MCP-server, npm-pakket)
- Een externe dienst wil toegang tot bestanden, API-tokens of netwerk
- Periodieke security-scan van bestaande koppelingen (maandelijks)
- Gebruiker vraagt "is dit veilig?" over iets

**Wat Vigil beoordeelt:**
- Reputatie van de maker (wie, hoe lang actief, hoeveel gebruikers)
- Permissies die de tool vraagt vs. wat het eigenlijk nodig heeft
- Open source? Zo ja — is er een audit of actieve community?
- Wat gebeurt er met data die de tool ziet?
- Alternatieven die veiliger zijn

**Wat Vigil niet doet:**
- Geen code schrijven of uitvoeren
- Geen valse geruststelling ("het ziet er wel goed uit") — liever een eerlijk "te pril, wacht"
- Geen eindoordeel over dingen buiten zijn domein

**Deliverable Taak 3:**
- `Team/Vigil - Security Reviewer/AGENTS.md` — volledig specialist-contract
- Vigil toegevoegd aan `Team/agent-index.md`
- Vigil vermeld in de routing-tabel in `AGENTS.md`
- Korte testcase: "Bart wil room-mcp installeren — wat doet Vigil?"

---

## Volgorde vanavond

1. Lees eerst `AGENTS.md` en `CLAUDE.md` in de vault voor context
2. Werk Taak 1 uit — vault-wijzigingen (kennissysteem upgrade)
3. Werk Taak 2 uit — standalone Python-project (factuurverwerking)
4. Werk Taak 3 uit — Vigil inhuren via SOP-001
5. Sla alle deliverables op de juiste plekken op

Vragen bij onduidelijkheden: stel ze voor je begint, niet halverwege.
