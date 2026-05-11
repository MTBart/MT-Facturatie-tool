# HANDOFF — Cowork ↔ Claude Code

Dit bestand is het communicatiekanaal tussen Cowork (desktop) en Claude Code (terminal).
Beide omgevingen lezen en schrijven hier naartoe.

---

## Status
`idle` — geen lopende overdracht

---

## Hoe het werkt

### Cowork → Claude Code
1. Cowork schrijft de taak hieronder onder `[TAAK]`
2. Cowork opent Windows Terminal via computer-use en voert `cowork-to-code.bat` uit
3. Claude Code pakt de taak op, voert hem uit, schrijft resultaat onder `[RESULTAAT]`
4. Claude Code zet status op `klaar-voor-cowork`

### Claude Code → Cowork
1. Claude Code schrijft resultaat + samenvatting onder `[RESULTAAT]`
2. Claude Code zet status op `klaar-voor-cowork`
3. Cowork leest `HANDOFF.md` aan het begin van de volgende taak en verwerkt het resultaat
4. Cowork zet status terug op `idle`

### Wanneer Claude Code beter is
- Directe toegang tot Windows-bestanden buiten SharePoint
- Git push naar GitHub (authenticatie op Windows)
- PowerShell-scripts uitvoeren op de echte machine
- Grote lokale installaties of systeemtaken
- Iets wat in de Cowork-sandbox vastloopt

### Wanneer Cowork beter is
- Moneybird (eigen MCP)
- Microsoft 365 — mail, agenda, SharePoint, OneDrive
- Documenten maken (Word, Excel, PDF, presentaties)
- Onderzoek, offertes, planning, geheugen
- Alles waarbij context uit eerdere sessies belangrijk is

---

## [TAAK]

*(leeg)*

---

## [RESULTAAT]

*(leeg)*

---

## Log

| Datum | Van | Naar | Taak | Status |
|-------|-----|------|------|--------|
| — | — | — | — | — |
