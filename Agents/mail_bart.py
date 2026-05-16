#!/usr/bin/env python3
"""
mail_bart.py - stuur Bart een mail via Microsoft Graph
=======================================================
Herbruikbare hulptool. Gebruikt de gecachte MSAL-token (CRM/token_cache.json).

Gebruik:
  python mail_bart.py "Onderwerp" pad/naar/body.md
  python mail_bart.py "Onderwerp" -            # body van stdin
"""

import sys
import os
import re
import datetime
from pathlib import Path
import requests
from dotenv import load_dotenv

BASE_DIR     = Path(__file__).parent.parent
load_dotenv(BASE_DIR / "CRM" / ".env", encoding="utf-8-sig")
_TOKEN_CACHE = BASE_DIR / "CRM" / "token_cache.json"
_GRAPH       = "https://graph.microsoft.com/v1.0"
_ONTVANGER   = "Bart@mortiseandtenon.nl"


def _token() -> str:
    import msal
    tenant = os.getenv("TENANT_ID", "")
    client = os.getenv("CLIENT_ID", "")
    if not tenant or not client or not _TOKEN_CACHE.exists():
        raise RuntimeError("TENANT_ID/CLIENT_ID of token_cache.json ontbreekt")
    cache = msal.SerializableTokenCache()
    cache.deserialize(_TOKEN_CACHE.read_text(encoding="utf-8"))
    app = msal.PublicClientApplication(
        client_id=client,
        authority=f"https://login.microsoftonline.com/{tenant}",
        token_cache=cache,
    )
    accounts = app.get_accounts()
    if not accounts:
        raise RuntimeError("Geen account in token-cache - opnieuw inloggen nodig")
    res = app.acquire_token_silent(["https://graph.microsoft.com/Mail.Send"],
                                   account=accounts[0])
    if cache.has_state_changed:
        _TOKEN_CACHE.write_text(cache.serialize(), encoding="utf-8")
    if not res or "access_token" not in res:
        raise RuntimeError("Kon geen geldig token verkrijgen")
    return res["access_token"]


def md_naar_html(tekst: str) -> str:
    regels = []
    for r in tekst.splitlines():
        if r.startswith("## "):
            regels.append(f"<h3 style='color:#23402f'>{r[3:].strip()}</h3>")
        elif r.startswith("# "):
            regels.append(f"<h2 style='color:#23402f'>{r[2:].strip()}</h2>")
        elif r.startswith(("- ", "* ")):
            regels.append(f"<li>{r[2:].strip()}</li>")
        elif r.strip() == "":
            regels.append("<br>")
        else:
            r = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', r)
            regels.append(f"<p style='margin:.3em 0'>{r}</p>")
    inhoud = "\n".join(regels)
    return (f"<body style=\"font-family:Segoe UI,Arial,sans-serif;max-width:720px;"
            f"margin:0 auto;padding:20px;color:#22271f\">{inhoud}"
            f"<hr style='border:1px solid #eee;margin-top:2em'>"
            f"<p style='font-size:11px;color:#999'>Verstuurd door de MT Agent - "
            f"{datetime.date.today().isoformat()}</p></body>")


def stuur(onderwerp: str, body_md: str) -> None:
    token = _token()
    gebruiker = os.getenv("OUTLOOK_USER", _ONTVANGER)
    payload = {
        "message": {
            "subject": onderwerp,
            "body": {"contentType": "HTML", "content": md_naar_html(body_md)},
            "toRecipients": [{"emailAddress": {"address": _ONTVANGER}}],
        },
        "saveToSentItems": True,
    }
    r = requests.post(
        f"{_GRAPH}/users/{gebruiker}/sendMail",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
        json=payload, timeout=30,
    )
    if r.status_code == 202:
        print(f"Mail verstuurd naar {_ONTVANGER}: {onderwerp}")
    else:
        print(f"Graph-fout {r.status_code}: {r.text[:300]}")
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Gebruik: python mail_bart.py \"Onderwerp\" body.md")
        sys.exit(1)
    onderwerp = sys.argv[1]
    bron = sys.argv[2]
    body = sys.stdin.read() if bron == "-" else Path(bron).read_text(encoding="utf-8")
    stuur(onderwerp, body)
