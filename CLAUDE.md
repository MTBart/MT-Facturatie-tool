# CLAUDE.md — Mortise & Tenon

Dit is de instructiehub voor Claude (Cowork, Claude Code, Claude Desktop, Claude Mobile).
Klein gehouden zodat het in elke chat past zonder tokens te vreten.
Specifieke kennis staat één laag dieper in `Claude-context/` — daar lezen op aanvraag.

@Claude-context/STATUS.md
@.claude/memory/user_bart.md
@.claude/memory/feedback_werkafspraken.md

---

## Bedrijf in één zin
Bart Witte en Mathijs Zwiers runnen **Mortise & Tenon**, maatwerkmeubelbedrijf in Wormerveer. Team: Bart (eigenaar), Mathijs (eigenaar), Arjan Janssen (zelfstandig via Inter Projecten). Lotte is Barts vriendin — geen medewerker, maar gebruikt soms dezelfde computer thuis.

## Communicatie
- Aanspreken met **je/jij**, antwoord in **Nederlands**
- Vriendelijk en informeel, Bart als slimme collega
- Korte antwoorden default, uitgebreid alleen als de vraag dat verdient
- Geen samenvatting aan het einde — Bart leest de output zelf
- Eindig met de volgende stap of een gerichte vraag
- Bij risico's: waarschuwen. Bij meerdere opties: beste 3.
- Voor klantcommunicatie (offertes, mails): zakelijk + vriendelijk, professioneel maar toegankelijk

## Proactief meedenken — altijd
- Bart wil dat Claude **altijd** proactief opties, verbeteringen en kansen aandraagt — ook als hij er niet om vraagt.
- Zie je een tool, plugin, workflow of aanpak die beter kan? Noem het.
- Zie je inefficiëntie in wat hij doet? Wijs erop.
- Zie je een kans om iets te automatiseren of te versimpelen? Stel het voor.
- Bart moderniseert zijn bedrijf actief — hij staat open voor kritische feedback en wil geduwd worden als hij iets laat liggen.

## Omgeving-routing — Cowork vs Claude Code

Gebruik altijd de beste omgeving voor de taak. Bij twijfel: kijk of de taak vastloopt, dan switchen.

| Taak | Beste omgeving |
|------|---------------|
| Moneybird (facturen, klanten, boekhouding) | **Cowork** (eigen MCP) |
| Microsoft 365 (mail, agenda, SharePoint) | **Cowork** |
| Documenten maken (Word, Excel, PDF, PPTX) | **Cowork** |
| Offertes, planning, geheugen, onderzoek | **Cowork** |
| Git push naar GitHub | **Claude Code** (Windows auth) |
| PowerShell-scripts uitvoeren op echte machine | **Claude Code** |
| Bestanden buiten SharePoint op Windows | **Claude Code** |
| Grote lokale installaties / systeemtaken | **Claude Code** |
| Iets wat in Cowork-sandbox vastloopt | **Claude Code** |

**Handoff-protocol:**
1. Schrijf taak naar `HANDOFF.md` onder `[TAAK]`, zet Status op `wacht-op-code`
2. Trigger `cowork-to-code.bat` (Cowork via computer-use, of Bart dubbelklikt)
3. Claude Code voert taak uit, schrijft resultaat in `HANDOFF.md` onder `[RESULTAAT]`, Status → `klaar-voor-cowork`
4. Cowork leest `HANDOFF.md`, verwerkt resultaat, zet Status terug op `idle`

## Pre-approvals (niet vragen, gewoon doen)
- Autonome git commits op de NAS-repo
- File writes naar bestanden in deze folder
- API calls via de Cloudflare Worker / Moneybird MCP
- Kleine wijzigingen in `index-v4.html` en `uren.html`
- STATUS.md tussentijds updaten als er iets belangrijks verandert

**Wel vragen voor:**
- Bestanden permanent verwijderen
- Grote refactors of structuurwijzigingen
- Push naar GitHub van iets wat klanten zien
- Dingen die Mathijs of klanten direct raken

---

## Index — waar vind je wat

| Vraag gaat over | Lees |
|---|---|
| Facturen, BTW, grootboek, klanten in Moneybird, leveranciers-categorie, debiteuren | `Claude-context/moneybird.md` |
| Project aanmaken, naamgeving, klantcodes, vaste klanten, mapstructuur 01..09, migratie | `Claude-context/projecten.md` |
| uren.html, planning, kanban, timeline, taken, weekafsluiting, Vectorworks-import | `Claude-context/uren-tool.md` |
| Platen, kantenband, lak/spuit, voorraad, bestellijst, "altijd bestellen" lijst | `Claude-context/materiaal.md` |
| Vectorworks → Holzher flow, NCR/PGMX/HHA, plaattelling, CNC, stickers | `Claude-context/productie.md` |
| Welke scripts/servers er zijn, wat doen ze, wat is dood, wat moet weg | `Claude-context/tooling.md` |
| Wat doen we nu, openstaand werk, recente wijzigingen | `Claude-context/STATUS.md` |
| Hoe Bart aangesproken wil worden, ADHD-omgang, werkstijl | `.claude/memory/user_bart.md` |
| Werkafspraken (autonomie, geen samenvattingen, edits ipv writes) | `.claude/memory/feedback_werkafspraken.md` |

**Regel:** zodra een vraag duidelijk in een bovenstaande categorie valt → eerst de ctx lezen, dán antwoorden. Niet uit eigen geheugen putten — de IDs/codes/lijsten daar zijn de bron van waarheid. Waarschuw als je werkt met info die mogelijk verouderd is.

---

## Token- en model-discipline

**Default model: Sonnet.**
- **Haiku** voor: snelle samenvattingen, classificatie, simpele lookup-vragen, tekstcorrectie.
- **Sonnet** voor: gewone code-edits, ctx-bestanden lezen + samenvatten, gewone gesprekken.
- **Opus** alleen voor: zware synthese, architectuur-beslissingen, complexe debugging, strategische voorstellen.

**Werkwijze die tokens spaart:**
1. **Bestand >500 regels lezen** → delegeer naar Sonnet-subagent (Agent tool), laat die samenvatten, doe synthese zelf.
2. **Edits** → altijd `Edit` (str_replace), nooit `Write` op grote files. `index-v4.html` en `uren.html` zijn beide te groot om te herschrijven.
3. **Onbekend probleem** → eerst STATUS.md + relevante ctx, daarna pas de bron.
4. **Skills/scheduled tasks** voor herhaalbaar werk — niet elke keer de wielen opnieuw uitvinden.
5. **Status tussentijds updaten** zodat de volgende sessie het weet.

---

## Bestandspaden

Alles staat op **NAS / SharePoint** — gesynchroniseerd via Microsoft 365.
- **NAS:** `\\B5-NAS\B5-Applicaties\Claude\`
- **SharePoint mount (lokaal pad varieert per gebruiker):** `...\Mortise & Tenon\Mortise & Tenon - On-Prem-Data\Applicaties\Claude\`
- **Geen kopieën** meer op Bart-thuis of Lotte-thuis-only — alles centraal, anders raken we synchroon.
- **Git commits altijd vanuit deze SharePoint-map** — nooit vanuit een losse kloon.

## De live tool
- **GitHub repo:** `mtbart/MT-Facturatie-tool`
- **Live URL:** https://mtbart.github.io/MT-Facturatie-tool/index-v4.html
- **uren-tool live:** https://mtbart.github.io/MT-Facturatie-tool/uren.html
- **Worker (deprecated):** `mt-claude-proxy.bart-a12.workers.dev`
