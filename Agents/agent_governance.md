# Agent-governance — audit MT Autonomy

Prototype uit het nabouw-voorstel "The Architecture Mistakes That Kill AI Agents
in Production". Het artikel noemt 7 valkuilen voor productie-agents. Hieronder
per valkuil: hoe MT Autonomy er nu voor staat en wat er nog mist.

| # | Les uit het artikel | Stand bij MT Autonomy | Gat |
|---|---|---|---|
| 1 | Expliciete tool-contracten | Deels — `claude_review.md` beschrijft wat de review mag; lokale agent heeft losse fases | Geen formeel contract per fase/tool |
| 2 | Blast-radius limieten | ✅ — harde grenzen in `claude_review.md`: geen push, geen secrets, schrijven alleen binnen `Agents/`+context, alles via git | OK |
| 3 | Tracing / audittrail | ✅ — `run_historie.json` + git-historie + digests | Geen trace per opdracht (welke stap deed wat) |
| 4 | Composable tools | Deels — `mt_cli.py` is een begin | Fases zijn nog monolithische scripts |
| 5 | Gescheiden geheugen-tiers | Deels — `.claude/memory/` (lang) vs STATUS.md (werk) | Geen expliciete scheiding kort/lang voor de agent zelf |
| 6 | Human gates voor risicovolle acties | ✅ — voorstellen-map + Claude-review + `voorstellen_auto_toepassen: false` | OK |
| 7 | Economische governance (kostenlimiet per taak/agent/sessie) | ❌ — geen limiet; `max_ollama_seconden` begrenst tijd, niet API-kosten | **Belangrijkste gat** |

## Conclusie

De veiligheidskant (blast-radius, human gates, audittrail) is goed geregeld —
dat is precies waar het voorstellen + review + git-vangnet voor zit.

Het echte gat is **economische governance**: er is geen harde grens op wat een
Claude-review of opdracht-afhandeling aan API-tokens mag kosten. Bij een
ontsporende sessie (loop, te grote context) is er nu geen rem.

## Aanbeveling voor Bart

Een lichte kostenrem toevoegen, bijvoorbeeld:
- een veld `max_review_minuten` in `agent_config.json` als zachte grens;
- of de Anthropic-usage achteraf loggen per review-run in `run_historie.json`,
  zodat uitschieters zichtbaar worden.

Dit raakt het gedrag van de agent zelf — daarom blijft het een aanbeveling, niet
iets dat deze review autonoom doorvoert.
