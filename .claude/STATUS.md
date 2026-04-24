# STATUS.md — Huidige sessie-context

> Dit bestand bijwerken na elke sessie. Bevat wat er nu speelt, niet de stabiele projectinfo (die staat in CLAUDE.md).

## Gedaan deze sessie (2026-04-24)
- Mapstructuur opgeruimd: `_archief/`, `.claude/` aangemaakt
- CLAUDE.md volledig herschreven, STATUS.md importeert automatisch bij Code CLI start
- Memory-bestanden aangemaakt (lokaal + NAS)
- Claude Desktop MCP-koppeling naar NAS werkend (nas-claude, nas-applicaties)
- Ollama geïnstalleerd, Qwen2.5:14b model wordt gedownload
- Permissions ingesteld in `.claude/settings.json` (geen prompts voor lezen/schrijven/git)
- Desktop Project Instructions bijgewerkt met NAS-leesroutine

## Roadmap (prioriteit volgorde)
1. **Voorraad-icoon in factuurlijst** — icoon/tag in controle-lijst als factuur voorraadregels heeft
2. **Historische facturen opschonen** — 218 inkoopfacturen 2026 doorlopen via factuur controle tabblad
3. **Nacalculatie tabblad** — uren (Toggl) + inkoop + verkoop per project combineren, marge per project
4. **Toggl koppeling** — uren ophalen via Toggl API via Cloudflare Worker
5. **Email integratie** — Outlook facturen automatisch verwerken
6. **Voorraadbeheer uitbreiden** — koppeling Vectorworks exports, af/opboeken per project
7. **Uurtarief berekening** — kostprijs per uur via INT-ADMIN/INT-OVERIG overhead
8. **SEPA verzendlijst** — batch betaalbestand via Moneybird API

## Blockers
- Toggl API token — nodig voor item 4
- SharePoint Graph API — nodig voor mappenstructuur script

## Volgende stap
Item 1: voorraad-icoon in factuurlijst. Klein, concreet, direct waarde.
