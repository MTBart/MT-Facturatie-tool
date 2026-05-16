#!/usr/bin/env python3
"""
run_log.py - voegt 1 run-record toe aan run_historie.json
============================================================
Aangeroepen door run_agent.ps1. Python schrijft de JSON betrouwbaar (UTF-8,
geen BOM, altijd een array) - PowerShell 5.1 doet dat niet goed.

Gebruik:  python run_log.py "<tijd>" "<status>" "<samenvatting>"
"""

import sys
import json
from pathlib import Path

PAD = Path(__file__).parent / "run_historie.json"

hist = []
if PAD.exists():
    try:
        hist = json.loads(PAD.read_text(encoding="utf-8-sig"))
    except Exception:
        hist = []
if not isinstance(hist, list):
    hist = []

hist.append({
    "tijd":         sys.argv[1] if len(sys.argv) > 1 else "",
    "status":       sys.argv[2] if len(sys.argv) > 2 else "",
    "samenvatting": sys.argv[3] if len(sys.argv) > 3 else "",
})

PAD.write_text(json.dumps(hist[-60:], ensure_ascii=False, indent=2), encoding="utf-8")
print(f"run_historie bijgewerkt ({len(hist)} runs)")
