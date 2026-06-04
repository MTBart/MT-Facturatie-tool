# Skill Learnings Protocol

> Wanneer en hoe `learnings.md` bijwerken in skill-mappen.

## Wat is een learnings.md?

Elke skill-map heeft (of zou moeten hebben) een `learnings.md` naast de `SKILL.md`. Het is geen documentatie — het is operationeel geheugen. Claude leest het bij het starten van de skill zodat bekende valkuilen en bewezen aanpakken direct beschikbaar zijn, ook in een nieuwe sessie.

## Wanneer bijwerken?

Schrijf een update als er iets **niet-voor-de-hand-liggends** is gebeurd:

| Situatie | Actie |
|---|---|
| Een aanpak werkte beter dan verwacht | Noteer onder "Wat werkt goed" |
| Er was een valkuil die je pas halverwege ontdekte | Noteer onder "Wat vermijden" |
| Een template of ID bleek verouderd | Noteer de correctie + datum |
| De gebruiker corrigeerde je aanpak | Noteer de regel + waarom |
| Er is een cross-skill afhankelijkheid ontdekt | Noteer onder "Cross-skill learnings" |

**Niet noteren:** dingen die al in SKILL.md staan, algemene best practices, eenmalige uitzonderingen zonder patroon.

## Hoe bijwerken?

1. Voeg de nieuwe learning toe aan de juiste sectie
2. Formuleer als een regel, niet als een observatie — toekomstige Claude handelt ernaar
3. Als je een bestaand punt vervangt (bijv. verouderd ID): overschrijf het, voeg geen duplicaat toe
4. Pas de datum onderaan aan: `*Bijgewerkt: JJJJ-MM-DD*`

## Structuur per learnings.md

Niet elke skill heeft dezelfde secties nodig, maar dit is het standaard startpunt:

```markdown
# Learnings — [skill-naam]

Lees dit ALTIJD voordat je begint. Voeg nieuwe inzichten toe na elke sessie.

## Wat werkt goed
## Wat vermijden
## [Domein-specifieke sectie, bijv. "Afwijkingen van templates"]
## Cross-skill learnings  ← alleen als relevant

*Bijgewerkt: JJJJ-MM-DD*
```

## Welke skills hebben een learnings.md?

| Skill | Pad |
|---|---|
| nieuw-project | `skills/nieuw-project/learnings.md` |
| skill-creator | `skills/skill-creator/learnings.md` |
| schedule | `skills/schedule/learnings.md` |

Voeg hier nieuwe skills toe zodra ze een learnings.md krijgen.

## Verschil met Claude-geheugen (memory/)

| | learnings.md | memory/ |
|---|---|---|
| Scope | Eén skill | Alle sessies breed |
| Lezer | Claude bij skill-start | Claude bij elke sessie |
| Inhoud | Skill-specifieke regels en valkuilen | Gebruikersprofiel, werkafspraken, projectcontext |
| Bijwerken | Na elke skill-sessie met nieuwe inzichten | Bij wijziging in werkwijze of projectcontext |
