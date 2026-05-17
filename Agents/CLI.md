# MT CLI - token-efficiënt werken

## Waarom een CLI

Als Claude Code iets moet weten of doen, zijn er twee manieren:

1. **Via een MCP-server** — die injecteert bij elk gesprek een heel schema met
   alle beschikbare tools. Dat kost veel tokens, elke sessie opnieuw.
2. **Via een CLI** — Claude roept één kort commando aan en krijgt kale tekst
   terug. Geen schema, geen overhead. Veel goedkoper.

Voor terugkerende, simpele M&T-lookups is een CLI dus de zuinige keuze. Dit is
het nabouw-voorstel "token-efficiënte CLI-tools", als prototype.

## Het `mt`-commando

```
python Agents/mt_cli.py status              huidige stand van zaken (STATUS.md)
python Agents/mt_cli.py taken               openstaande taken (TASKS.md)
python Agents/mt_cli.py agent               laatste agent-run + tellingen
python Agents/mt_cli.py opdracht "<tekst>"  opdracht in de agent-inbox leggen
python Agents/mt_cli.py zoek <term>         zoek in kennisbank + context
```

Stdlib-only — geen installatie. Leest bestaande bestanden, schrijft alleen bij
`opdracht` (één bestand in `opdrachten/inbox/`).

## Hoe Claude het gebruikt

In plaats van meerdere bestanden te lezen om de stand van zaken te kennen, draait
Claude `python Agents/mt_cli.py status` en krijgt het antwoord in één korte
uitvoer. Idem voor `taken`, `agent`, `zoek`.

## Uitbreiden

Nieuw subcommando = een functie `cmd_<naam>` + een regel in `COMMANDOS` in
`mt_cli.py`. Houd de uitvoer kort en kaal — dat is het hele punt.

## Optioneel: korter aanroepen

Een `mt.bat` in de Agents-map maakt `mt status` mogelijk i.p.v. het volledige
`python ...`-pad. Klein, kan later.
