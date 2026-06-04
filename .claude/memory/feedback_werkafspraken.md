---
name: Feedback — werkafspraken
description: Wat wel/niet werkt in de samenwerking met Bart
type: feedback
originSessionId: defd1734-9f80-4ab6-b833-011932614a97
---
Gewoon doen zonder toestemming vragen, behalve bij grote wijzigingen (bestanden verwijderen, grote structuurwijzigingen, pushes naar GitHub).

**Why:** Bart heeft ADHD en vindt het vervelend om steeds te moeten goedkeuren. Kleine dingen gewoon regelen.
**How to apply:** Default = doen. Alleen vragen bij: destructieve acties, grote refactors, wijzigingen zichtbaar voor klanten.

---

Geen samenvattingen aan het einde van een antwoord als dat niet nodig is — Bart kan de output zelf lezen.

**Why:** Vervelend en overbodig.
**How to apply:** Eindig met de volgende stap of een gerichte vraag, niet met een samenvatting van wat je net deed.

---

index.html (de live tool) aanpassen via Edit tool (str_replace), nooit het hele bestand herschrijven.

**Why:** Het bestand is ~3700 regels en volledig herschrijven kost veel tokens en introduceert fouten.
**How to apply:** Altijd targeted edits, nooit Write() op het hele HTML-bestand.
