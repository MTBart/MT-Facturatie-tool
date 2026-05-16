#!/usr/bin/env python3
"""
Opdracht-verwerker — MT Night Agent, fase 0
=============================================
Dit is het dispatch-kanaal. Bart kan op afstand opdrachten geven; deze module
pikt ze op, classificeert ze, en voert ze lokaal uit of zet ze in de wachtrij
voor Claude.

Drie manieren om een opdracht te geven (zie MT_AUTONOMY.md):
  1. LOKALE MAP   — leg een .md/.txt bestand in  Agents/opdrachten/inbox/
  2. E-MAIL       — stuur/verplaats een mail naar de Outlook-map "MT-Agent"
  3. DISPATCH     — een Claude Code dispatch-sessie schrijft een bestand in inbox/

Elke opdracht wordt geclassificeerd:
  - "lokaal"  -> direct uitgevoerd met Ollama (research, samenvatting, analyse)
  - "claude"  -> in de wachtrij gezet voor de dagelijkse Claude-review

Alles wordt gelogd in  opdrachten/historie.json  (voedt het dashboard).

Gebruik:  python opdracht_verwerker.py
"""

import sys
import json
import os
import datetime
import traceback
from pathlib import Path

import requests
from dotenv import load_dotenv

# ── Paden ────────────────────────────────────────────────────────────────────
AGENTS_DIR  = Path(__file__).parent
BASE_DIR    = AGENTS_DIR.parent
OPDR_DIR    = AGENTS_DIR / "opdrachten"
INBOX_DIR   = OPDR_DIR / "inbox"
VERWERKT    = OPDR_DIR / "verwerkt"
VOOR_CLAUDE = OPDR_DIR / "voor_claude"
HISTORIE    = OPDR_DIR / "historie.json"
HANDOFF     = BASE_DIR / "HANDOFF.md"

for d in (INBOX_DIR, VERWERKT, VOOR_CLAUDE):
    d.mkdir(parents=True, exist_ok=True)

load_dotenv(BASE_DIR / "CRM" / ".env", encoding="utf-8-sig")

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL      = "qwen2.5:14b"

_TOKEN_CACHE = BASE_DIR / "CRM" / "token_cache.json"
_GRAPH       = "https://graph.microsoft.com/v1.0"
_MAILBOX     = os.getenv("OUTLOOK_USER", "Bart@mortiseandtenon.nl")
_OPDRACHT_MAP = "MT-Agent"          # Outlook-map die als opdracht-inbox dient
_VERWERKT_MAP = "MT-Agent-Verwerkt" # mails komen hier na verwerking

# Harde signalen: zinsdelen die vrijwel altijd code/externe acties betekenen.
# Twijfelgevallen gaan naar de Ollama-classificatie (zie classificeer()).
_CLAUDE_TREFWOORDEN = [
    "git push", "git commit", "push naar github", "deploy", "wrangler",
    "npm install", "pip install", "installeer ", "verwijder het bestand",
]


# ── Ollama helper ────────────────────────────────────────────────────────────
def ollama(prompt: str, max_tokens: int = 600) -> str:
    try:
        r = requests.post(OLLAMA_URL, json={
            "model": MODEL, "prompt": prompt, "stream": False,
            # num_ctx beperkt het context-venster zodat het model volledig op
            # de GPU past (16GB VRAM) i.p.v. deels naar systeem-RAM te spillen.
            "options": {"num_predict": max_tokens, "num_ctx": 8192},
        }, timeout=180)
        r.raise_for_status()
        return r.json().get("response", "").strip()
    except Exception as e:
        return f"[Ollama fout: {e}]"


# ── Historie ─────────────────────────────────────────────────────────────────
def laad_historie() -> list:
    if HISTORIE.exists():
        try:
            return json.loads(HISTORIE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
    return []


def sla_historie_op(historie: list) -> None:
    HISTORIE.write_text(
        json.dumps(historie[-200:], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ── Microsoft Graph (e-mail kanaal) ──────────────────────────────────────────
def _graph_token() -> str | None:
    """Haal een Graph-token op via de gecachte MSAL-token. None bij falen."""
    try:
        import msal
        tenant = os.getenv("TENANT_ID", "")
        client = os.getenv("CLIENT_ID", "")
        if not tenant or not client or not _TOKEN_CACHE.exists():
            return None
        cache = msal.SerializableTokenCache()
        cache.deserialize(_TOKEN_CACHE.read_text(encoding="utf-8"))
        app = msal.PublicClientApplication(
            client_id=client,
            authority=f"https://login.microsoftonline.com/{tenant}",
            token_cache=cache,
        )
        accounts = app.get_accounts()
        if not accounts:
            return None
        scopes = ["https://graph.microsoft.com/Mail.ReadWrite"]
        res = app.acquire_token_silent(scopes, account=accounts[0])
        if cache.has_state_changed:
            _TOKEN_CACHE.write_text(cache.serialize(), encoding="utf-8")
        return res.get("access_token") if res else None
    except Exception as e:
        print(f"  [Graph] token mislukt: {e}")
        return None


def _graph(method: str, pad: str, token: str, **kw):
    return requests.request(
        method, f"{_GRAPH}{pad}",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
        timeout=30, **kw,
    )


def _vind_of_maak_map(token: str, naam: str) -> str | None:
    """Geef de id van een mailmap; maak hem aan als hij niet bestaat."""
    r = _graph("GET", "/me/mailFolders?$top=100", token)
    if r.status_code == 200:
        for m in r.json().get("value", []):
            if m.get("displayName", "").lower() == naam.lower():
                return m["id"]
    r = _graph("POST", "/me/mailFolders", token, json={"displayName": naam})
    return r.json().get("id") if r.status_code in (200, 201) else None


def lees_email_opdrachten() -> list:
    """Lees ongelezen mails uit de Outlook-map 'MT-Agent'. Geeft opdrachten terug."""
    token = _graph_token()
    if not token:
        print("  [E-mail] geen Graph-token — e-mailkanaal overgeslagen")
        return []

    map_id = _vind_of_maak_map(token, _OPDRACHT_MAP)
    _vind_of_maak_map(token, _VERWERKT_MAP)  # zorg dat verwerkt-map bestaat
    if not map_id:
        return []

    r = _graph("GET",
               f"/me/mailFolders/{map_id}/messages?$top=25&$select=id,subject,bodyPreview,from,receivedDateTime",
               token)
    if r.status_code != 200:
        print(f"  [E-mail] ophalen mislukt: {r.status_code}")
        return []

    opdrachten = []
    for m in r.json().get("value", []):
        opdrachten.append({
            "bron": "email",
            "mail_id": m["id"],
            "ontvangen": m.get("receivedDateTime", ""),
            "tekst": f"{m.get('subject','')}\n\n{m.get('bodyPreview','')}".strip(),
        })
    print(f"  [E-mail] {len(opdrachten)} opdracht(en) in Outlook-map '{_OPDRACHT_MAP}'")
    return opdrachten


def email_antwoord(token: str, mail_id: str, resultaat: str) -> None:
    """Beantwoord de opdracht-mail met het resultaat en verplaats hem naar Verwerkt."""
    try:
        _graph("POST", f"/me/messages/{mail_id}/reply", token,
               json={"comment": resultaat[:6000]})
        verwerkt_id = _vind_of_maak_map(token, _VERWERKT_MAP)
        if verwerkt_id:
            _graph("POST", f"/me/messages/{mail_id}/move", token,
                   json={"destinationId": verwerkt_id})
    except Exception as e:
        print(f"  [E-mail] antwoord/verplaatsen mislukt: {e}")


def lees_map_opdrachten() -> list:
    """Lees opdrachtbestanden uit de lokale map opdrachten/inbox/."""
    opdrachten = []
    for f in sorted(INBOX_DIR.glob("*")):
        if f.name.lower().startswith(("readme", "_")):
            continue  # uitleg-bestanden zijn geen opdracht
        if f.suffix.lower() in (".md", ".txt") and f.is_file():
            opdrachten.append({
                "bron": "map",
                "bestand": str(f),
                "ontvangen": datetime.datetime.fromtimestamp(
                    f.stat().st_mtime).isoformat(timespec="seconds"),
                "tekst": f.read_text(encoding="utf-8", errors="replace").strip(),
            })
    if opdrachten:
        print(f"  [Map] {len(opdrachten)} opdracht(en) in inbox/")
    return opdrachten


# ── Classificatie + uitvoering ───────────────────────────────────────────────
def classificeer(tekst: str) -> str:
    """Bepaal of een opdracht lokaal kan of Claude nodig heeft."""
    laag = tekst.lower()
    if any(tw in laag for tw in _CLAUDE_TREFWOORDEN):
        return "claude"
    # Twijfelgeval -> vraag Ollama
    vraag = (
        "Classificeer deze opdracht voor de juiste uitvoerder.\n\n"
        "LOKAAL = een lokaal taalmodel kan dit puur met tekst afhandelen: "
        "samenvatten, analyseren, adviseren, brainstormen, uitleggen, concept schrijven.\n"
        "CLAUDE = vereist code/bestanden wijzigen, internet of API's, git, "
        "of een zakelijke beslissing met gevolgen.\n\n"
        "Voorbeelden:\n"
        '"Vat dit nieuws samen" -> LOKAAL\n'
        '"Geef 3 ideeen voor automatisering" -> LOKAAL\n'
        '"Analyseer onze projectstatus" -> LOKAAL\n'
        '"Pas index-v4.html aan" -> CLAUDE\n'
        '"Maak een factuur in Moneybird" -> CLAUDE\n\n'
        f"Opdracht: {tekst[:500]}\n\n"
        "Antwoord met alleen het woord LOKAAL of CLAUDE."
    )
    antwoord = ollama(vraag, max_tokens=10).upper()
    return "lokaal" if "LOKAAL" in antwoord else "claude"


def voer_lokaal_uit(tekst: str) -> str:
    """Voer een opdracht uit met de lokale Ollama."""
    status = ""
    status_pad = BASE_DIR / "Claude-context" / "STATUS.md"
    if status_pad.exists():
        status = status_pad.read_text(encoding="utf-8")[:2000]
    prompt = (
        "Je bent de lokale AI-assistent van Mortise & Tenon, een maatwerkmeubel-"
        "bedrijf in Wormerveer (eigenaar: Bart). Voer de opdracht hieronder zo "
        "concreet en bruikbaar mogelijk uit. Antwoord in het Nederlands.\n\n"
        f"## Bedrijfscontext (STATUS.md, ingekort)\n{status}\n\n"
        f"## Opdracht van Bart\n{tekst}\n\n"
        "## Jouw uitwerking"
    )
    return ollama(prompt, max_tokens=1200)


def zet_in_claude_wachtrij(opdracht: dict, reden: str) -> str:
    """Schrijf een opdracht weg voor de dagelijkse Claude-review."""
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    pad = VOOR_CLAUDE / f"opdracht_{ts}.md"
    pad.write_text(
        f"# Opdracht voor Claude — {ts}\n\n"
        f"**Bron:** {opdracht['bron']}\n"
        f"**Ontvangen:** {opdracht.get('ontvangen','?')}\n"
        f"**Reden lokaal niet mogelijk:** {reden}\n\n"
        f"## Opdracht\n\n{opdracht['tekst']}\n\n"
        f"## Resultaat\n\n_(in te vullen door Claude)_\n",
        encoding="utf-8",
    )
    # Ook melden in HANDOFF.md zodat een Claude Code-sessie het ziet
    if HANDOFF.exists():
        kop = f"\n\n## [OPDRACHT VIA AGENT — {ts}]\nStatus: wacht-op-claude\n\n"
        HANDOFF.write_text(
            HANDOFF.read_text(encoding="utf-8") + kop +
            f"Bron: {opdracht['bron']}\n\n{opdracht['tekst'][:1000]}\n\n"
            f"Wachtrij-bestand: `Agents/opdrachten/voor_claude/{pad.name}`\n",
            encoding="utf-8",
        )
    return str(pad)


# ── Hoofdroutine ─────────────────────────────────────────────────────────────
def verwerk() -> None:
    print("=== FASE 0: Opdracht-verwerker ===")
    historie = laad_historie()
    token = _graph_token()

    opdrachten = lees_map_opdrachten() + lees_email_opdrachten()
    if not opdrachten:
        print("  Geen nieuwe opdrachten.")
        return

    for opdr in opdrachten:
        tekst = opdr["tekst"]
        if not tekst:
            continue
        print(f"\n  Opdracht ({opdr['bron']}): {tekst[:70]}...")

        # E-mail-opdrachten gaan ALTIJD naar Claude (Opus 4.7). De lokale Ollama
        # is prima voor research en scoring, maar niet voor het beantwoorden van
        # Barts echte vragen - die verdienen het sterkste model. Alleen de lokale
        # inbox-map gebruikt nog de lokaal/Claude-classificatie.
        soort = "claude" if opdr["bron"] == "email" else classificeer(tekst)
        record = {
            "id": datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3],
            "bron": opdr["bron"],
            "ontvangen": opdr.get("ontvangen", ""),
            "verwerkt": datetime.datetime.now().isoformat(timespec="seconds"),
            "opdracht": tekst[:1000],
            "classificatie": soort,
        }

        if soort == "lokaal":
            print("  -> lokaal uitvoeren met Ollama...")
            resultaat = voer_lokaal_uit(tekst)
            ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            res_pad = VERWERKT / f"resultaat_{ts}.md"
            res_pad.write_text(
                f"# Resultaat — {ts}\n\n## Opdracht\n{tekst}\n\n"
                f"## Uitwerking (lokaal, Ollama)\n\n{resultaat}\n",
                encoding="utf-8",
            )
            record["status"] = "klaar-lokaal"
            record["resultaat"] = resultaat[:2000]
            record["resultaat_pad"] = str(res_pad)
            if opdr["bron"] == "email" and token:
                email_antwoord(token, opdr["mail_id"],
                               f"<b>Lokaal verwerkt door de MT Night Agent:</b><br><br>"
                               f"{resultaat[:5000]}")
        else:
            print("  -> Claude nodig, in wachtrij gezet.")
            wachtrij = zet_in_claude_wachtrij(opdr, "code/extern/beslissing vereist")
            record["status"] = "wacht-op-claude"
            record["wachtrij_pad"] = wachtrij
            if opdr["bron"] == "email" and token:
                email_antwoord(token, opdr["mail_id"],
                               "<b>Ontvangen.</b><br>Je vraag wordt door Claude "
                               "(Opus 4.7) beantwoord in de eerstvolgende review. "
                               "Je krijgt het antwoord per mail.")

        # Lokaal bestand naar verwerkt/ verplaatsen
        if opdr["bron"] == "map":
            try:
                Path(opdr["bestand"]).rename(
                    VERWERKT / f"{record['id']}_{Path(opdr['bestand']).name}")
            except OSError as e:
                print(f"  [Map] verplaatsen mislukt: {e}")

        historie.append(record)

    sla_historie_op(historie)
    print(f"\n  Fase 0 klaar — {len(opdrachten)} opdracht(en) verwerkt.")


if __name__ == "__main__":
    try:
        verwerk()
    except Exception:
        print(f"\n[FOUT in opdracht_verwerker]\n{traceback.format_exc()}")
        sys.exit(1)
