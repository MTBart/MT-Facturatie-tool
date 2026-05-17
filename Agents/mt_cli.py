#!/usr/bin/env python3
"""
mt_cli.py - token-efficiente CLI voor Mortise & Tenon
=======================================================
Een `mt`-commando dat veelgebruikte M&T-lookups bundelt als subcommando's.

WAAROM: een CLI is token-goedkoop. Claude Code roept een commando aan en krijgt
korte, kale tekst terug - geen dik MCP-schema, geen lang gesprek. Zie CLI.md.

Stdlib-only - geen installatie nodig.

Gebruik:
  python mt_cli.py status              huidige stand van zaken
  python mt_cli.py taken               openstaande taken
  python mt_cli.py agent               laatste agent-run + tellingen
  python mt_cli.py opdracht "<tekst>"  opdracht in de agent-inbox leggen
  python mt_cli.py zoek <term>         zoek in kennisbank + context
"""

import sys
import json
import datetime
from pathlib import Path

AGENTS_DIR = Path(__file__).parent
BASE_DIR   = AGENTS_DIR.parent
STATUS     = BASE_DIR / "Claude-context" / "STATUS.md"
TASKS      = BASE_DIR / "TASKS.md"
RUNLOG     = AGENTS_DIR / "run_historie.json"
HISTORIE   = AGENTS_DIR / "opdrachten" / "historie.json"
INBOX      = AGENTS_DIR / "opdrachten" / "inbox"
KENNIS     = AGENTS_DIR / "kennis"
CONTEXT    = BASE_DIR / "Claude-context"


def _kop(tekst: str) -> str:
    """Eerste alinea/sectie van een markdown-bestand, bondig."""
    regels, geteld = [], 0
    for r in tekst.splitlines():
        regels.append(r)
        if r.strip():
            geteld += 1
        if geteld >= 25:
            break
    return "\n".join(regels)


def cmd_status() -> None:
    if not STATUS.exists():
        print("STATUS.md niet gevonden."); return
    tekst = STATUS.read_text(encoding="utf-8")
    # Toon 'Waar staan we nu' t/m de eerste open-punten.
    print(_kop(tekst))


def cmd_taken() -> None:
    if not TASKS.exists():
        print("TASKS.md niet gevonden."); return
    in_actief = False
    for r in TASKS.read_text(encoding="utf-8").splitlines():
        if r.startswith("## "):
            in_actief = r.lower().startswith(("## active", "## waiting"))
        if in_actief:
            print(r)


def cmd_agent() -> None:
    if RUNLOG.exists():
        try:
            runs = json.loads(RUNLOG.read_text(encoding="utf-8-sig"))
            if runs:
                laatste = runs[-1]
                print(f"Laatste run : {laatste.get('tijd','?')} - "
                      f"{laatste.get('status','?')}")
                print(f"  {laatste.get('samenvatting','')}")
        except (json.JSONDecodeError, OSError):
            print("run_historie.json onleesbaar.")
    else:
        print("Nog geen run-historie.")
    if HISTORIE.exists():
        try:
            h = json.loads(HISTORIE.read_text(encoding="utf-8"))
            wacht = sum(1 for o in h if "wacht" in (o.get("status") or ""))
            print(f"Opdrachten  : {len(h)} totaal, {wacht} wacht op Claude")
        except (json.JSONDecodeError, OSError):
            pass


def cmd_opdracht(tekst: str) -> None:
    if not tekst.strip():
        print('Geef een opdracht: python mt_cli.py opdracht "<tekst>"'); return
    INBOX.mkdir(parents=True, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    pad = INBOX / f"cli_{ts}.txt"
    pad.write_text(tekst.strip() + "\n", encoding="utf-8")
    print(f"Opdracht in de inbox gelegd: {pad.name}")
    print("De agent pikt 'm op bij de volgende cyclus (binnen 20 min).")


def cmd_zoek(term: str) -> None:
    if not term.strip():
        print("Geef een zoekterm: python mt_cli.py zoek <term>"); return
    term_l = term.lower()
    treffers = 0
    for map_ in (KENNIS, CONTEXT):
        if not map_.exists():
            continue
        for f in sorted(map_.rglob("*.md")):
            try:
                for n, r in enumerate(f.read_text(encoding="utf-8",
                                                  errors="replace").splitlines(), 1):
                    if term_l in r.lower():
                        print(f"{f.name}:{n}: {r.strip()[:100]}")
                        treffers += 1
                        if treffers >= 40:
                            print("... (meer treffers - verfijn de term)")
                            return
            except OSError:
                pass
    if treffers == 0:
        print(f"Geen treffers voor '{term}'.")


COMMANDOS = {
    "status":   lambda a: cmd_status(),
    "taken":    lambda a: cmd_taken(),
    "agent":    lambda a: cmd_agent(),
    "opdracht": lambda a: cmd_opdracht(" ".join(a)),
    "zoek":     lambda a: cmd_zoek(" ".join(a)),
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDOS:
        print("Gebruik: python mt_cli.py <commando> [argument]")
        print(f"Commando's: {', '.join(COMMANDOS)}")
        sys.exit(1)
    COMMANDOS[sys.argv[1]](sys.argv[2:])
