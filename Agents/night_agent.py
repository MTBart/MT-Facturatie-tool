#!/usr/bin/env python3
"""
Night Agent — Mortise & Tenon
Volledig via Ollama (localhost:11434, qwen2.5:14b). Nul Anthropic tokens.

Gebruik:
  python nachtelijke_agent.py fase1   # RSS ophalen + scoren + DuckDuckGo
  python nachtelijke_agent.py fase2   # GitHub scanner
  python nachtelijke_agent.py fase3   # Eigen data analyse
  python nachtelijke_agent.py fase4   # Digest samenstellen
  python nachtelijke_agent.py fase5   # Zelf verbeteren
"""

import sys
import json
import os
import re
import time
import datetime
import textwrap
import requests
from pathlib import Path
from bs4 import BeautifulSoup
from dotenv import load_dotenv

# .env laden vanuit CRM-map (zit één niveau boven Agents/)
_ENV_PATH = Path(__file__).parent.parent / "CRM" / ".env"
load_dotenv(_ENV_PATH, encoding="utf-8-sig")

# ── Paden ──────────────────────────────────────────────────────────────────────
AGENTS_DIR = Path(__file__).parent
BASE_DIR = AGENTS_DIR.parent

STATUS_PATH   = BASE_DIR / "Claude-context" / "STATUS.md"
CRM_PATH      = BASE_DIR / "CRM" / "crm_dashboard.html"
HANDOFF_PATH  = BASE_DIR / "HANDOFF.md"
BRONNEN_PATH  = AGENTS_DIR / "bronnen.json"
REPOS_PATH    = AGENTS_DIR / "interessante_repos.md"
ANALYSE_PATH      = AGENTS_DIR / "dagelijkse_analyse.md"
SMART_INBOX_PATH  = AGENTS_DIR / "smart_inbox_research.md"

VANDAAG      = datetime.date.today().isoformat()
DIGEST_PATH  = AGENTS_DIR / f"digest_{VANDAAG}.md"

# Tussenbestanden (fase 1-3 schrijven, fase 4 leest)
FASE1_JSON    = AGENTS_DIR / "fase1_resultaat.json"
FASE2_JSON    = AGENTS_DIR / "fase2_resultaat.json"
FASE3_JSON    = AGENTS_DIR / "fase3_resultaat.json"
SEEN_URLS_PATH = AGENTS_DIR / "seen_urls.json"

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL      = "qwen2.5:14b"
HEADERS    = {"User-Agent": "Mozilla/5.0 (compatible; MT-Night-Agent/1.0; +https://mortiseandtenon.nl)"}


# ── Ollama helper ──────────────────────────────────────────────────────────────
def ollama(prompt: str, max_tokens: int = 500) -> str:
    payload = {
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"num_predict": max_tokens},
    }
    try:
        r = requests.post(OLLAMA_URL, json=payload, timeout=120)
        r.raise_for_status()
        return r.json().get("response", "").strip()
    except Exception as e:
        print(f"  [Ollama fout] {e}")
        return ""


def laad_bronnen() -> list:
    if not BRONNEN_PATH.exists():
        print(f"  bronnen.json niet gevonden op {BRONNEN_PATH}")
        return []
    with open(BRONNEN_PATH, encoding="utf-8") as f:
        return json.load(f).get("feeds", [])


def laad_seen_urls() -> dict:
    """Retourneer dict {url: datum_iso_str} uit seen_urls.json."""
    if not SEEN_URLS_PATH.exists():
        return {}
    try:
        with open(SEEN_URLS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def sla_seen_urls_op(seen: dict, nieuwe_urls: list) -> None:
    """Voeg nieuwe URLs toe en schoon entries ouder dan 30 dagen op."""
    grens = datetime.date.today() - datetime.timedelta(days=30)
    seen = {
        url: datum
        for url, datum in seen.items()
        if datetime.date.fromisoformat(datum) >= grens
    }
    vandaag_str = datetime.date.today().isoformat()
    for url in nieuwe_urls:
        if url and url not in seen:
            seen[url] = vandaag_str
    with open(SEEN_URLS_PATH, "w", encoding="utf-8") as f:
        json.dump(seen, f, ensure_ascii=False, indent=2)


def extract_json(tekst: str) -> dict:
    match = re.search(r'\{[^{}]*\}', tekst, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {}


# ── Fase 1: RSS + scoring + DuckDuckGo vervolgonderzoek ───────────────────────
def fase1():
    print("=== FASE 1: RSS ophalen en scoren ===")

    if not BRONNEN_PATH.exists():
        print(f"  bronnen.json niet gevonden op {BRONNEN_PATH}")
        return

    with open(BRONNEN_PATH, encoding="utf-8") as f:
        bronnen_data = json.load(f)

    bronnen    = bronnen_data.get("feeds", [])
    trefwoorden = [t.lower() for t in bronnen_data.get("trefwoorden", [])]

    if not bronnen:
        return

    # ── Stap 1: seen_urls laden ────────────────────────────────────────────────
    seen = laad_seen_urls()
    print(f"  {len(seen)} eerder geziene URLs geladen (deduplicatie)")

    # ── Stap 2: RSS ophalen met max_items per feed ─────────────────────────────
    alle_items = []
    for bron in bronnen:
        max_items = bron.get("max_items", 8)
        print(f"  Ophalen: {bron['naam']} (max {max_items})")
        try:
            r = requests.get(bron["url"], headers=HEADERS, timeout=15)
            soup = BeautifulSoup(r.content, "xml")
            entries = soup.find_all("item") or soup.find_all("entry")
            for entry in entries[:max_items]:
                titel = _text(entry, ["title"])
                link  = _link(entry)
                beschr = _beschrijving(entry)
                if titel:
                    alle_items.append({
                        "bron": bron["naam"],
                        "categorie": bron.get("categorie", ""),
                        "titel": titel,
                        "link": link,
                        "beschrijving": beschr,
                        "score": 0,
                        "kernterm": "",
                        "vervolg_links": [],
                    })
        except Exception as e:
            print(f"    Fout: {e}")

    print(f"  {len(alle_items)} items opgehaald")

    # ── Stap 3: deduplicatie via seen_urls ────────────────────────────────────
    voor_dedup = len(alle_items)
    alle_items = [i for i in alle_items if i["link"] not in seen]
    print(f"  Deduplicatie: {voor_dedup - len(alle_items)} eerder gezien, {len(alle_items)} nieuw")

    # ── Stap 4: trefwoord-voorfilter (vóór Ollama) ───────────────────────────
    if trefwoorden:
        voor_filter = len(alle_items)

        def heeft_trefwoord(item):
            tekst = (item["titel"] + " " + item["beschrijving"]).lower()
            return any(t in tekst for t in trefwoorden)

        alle_items = [i for i in alle_items if heeft_trefwoord(i)]
        gefilterd  = voor_filter - len(alle_items)
        print(f"  Trefwoordfilter: {gefilterd} items weg, {len(alle_items)} doorgestuurd naar Ollama")

    if not alle_items:
        print("  Geen nieuwe items na filteren — fase 1 klaar")
        FASE1_JSON.write_text(json.dumps([], ensure_ascii=False, indent=2), encoding="utf-8")
        sla_seen_urls_op(seen, [])
        return

    # ── Stap 5: scoren met Ollama ─────────────────────────────────────────────
    print(f"  Nu scoren met Ollama ({len(alle_items)} items)...")

    for item in alle_items:
        prompt = f"""Beoordeel dit nieuwsitem voor Mortise & Tenon — een maatwerkmeubelbedrijf dat AI/automatisering inzet.

Titel: {item['titel']}
Beschrijving: {item['beschrijving'][:200]}

Geef score 1-10. Relevant = AI-tools voor MKB, houtbewerking/CNC, Claude/MCP nieuws, bedrijfsautomatisering.
JSON-antwoord: {{"score": <getal>, "kernterm": "<zoekterm voor vervolgonderzoek>"}}
Alleen JSON, geen uitleg."""

        data = extract_json(ollama(prompt, max_tokens=80))
        item["score"]    = int(data.get("score", 0)) if data else 0
        item["kernterm"] = data.get("kernterm", "") if data else ""
        print(f"    {item['score']:2d}/10 — {item['titel'][:65]}")

    # ── Stap 6: DuckDuckGo voor items met score ≥ 7 ──────────────────────────
    hoog = [i for i in alle_items if i["score"] >= 7]
    print(f"\n  {len(hoog)} items ≥7 — vervolgonderzoek via DuckDuckGo...")

    for item in hoog:
        term = item["kernterm"] or item["titel"][:50]
        links = duckduckgo_zoek(term)
        item["vervolg_links"] = links[:3]
        print(f"    DDG '{term[:45]}' → {len(links)} links")
        time.sleep(2)

    FASE1_JSON.write_text(json.dumps(alle_items, ensure_ascii=False, indent=2), encoding="utf-8")

    # ── Stap 7: seen_urls bijwerken ───────────────────────────────────────────
    nieuwe_urls = [i["link"] for i in alle_items if i["link"]]
    sla_seen_urls_op(seen, nieuwe_urls)
    print(f"  {len(nieuwe_urls)} URLs opgeslagen in seen_urls.json")

    print(f"\n  Fase 1 klaar — {len(hoog)} interessante items, resultaat in {FASE1_JSON.name}")


def _text(tag, names: list) -> str:
    for n in names:
        t = tag.find(n)
        if t:
            return t.get_text(strip=True)
    return ""


def _link(tag) -> str:
    lt = tag.find("link")
    if not lt:
        return ""
    return lt.get("href") or lt.get_text(strip=True)


def _beschrijving(tag) -> str:
    for n in ["description", "summary", "content"]:
        t = tag.find(n)
        if t:
            raw = t.get_text()
            return BeautifulSoup(raw, "html.parser").get_text()[:300]
    return ""


def duckduckgo_zoek(query: str) -> list:
    url = f"https://html.duckduckgo.com/html/?q={requests.utils.quote(query)}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        soup = BeautifulSoup(r.text, "html.parser")
        links = []
        for a in soup.select("a.result__url"):
            href = a.get("href", "")
            if href.startswith("http"):
                links.append(href)
        if not links:
            for a in soup.select(".result__title a"):
                href = a.get("href", "")
                if href and "duckduckgo.com" not in href:
                    links.append(href)
        return links[:5]
    except Exception as e:
        print(f"    DDG fout: {e}")
        return []


# ── Fase 2: GitHub scanner ─────────────────────────────────────────────────────
def fase2():
    print("=== FASE 2: GitHub scanner ===")
    zoektermen = [
        "claude mcp",
        "claude agent",
        "anthropic tools",
        "ollama integration",
    ]

    alle_repos = []
    for term in zoektermen:
        print(f"  Zoeken: '{term}'")
        repos = github_zoek(term)
        print(f"    {len(repos)} repos")
        alle_repos.extend(repos)
        time.sleep(4)

    # Dedupliceren
    gezien = set()
    uniek = []
    for r in alle_repos:
        if r["url"] not in gezien:
            gezien.add(r["url"])
            uniek.append(r)

    print(f"  {len(uniek)} unieke repos — Ollama beoordeelt relevantie...")

    interessant = []
    for repo in uniek:
        prompt = f"""Beoordeel deze GitHub repo voor Mortise & Tenon (maatwerkmeubelbedrijf, zet Claude/AI in voor automatisering).

Repo: {repo['naam']}
Beschrijving: {repo['beschrijving'][:250]}
Sterren: {repo.get('sterren', '?')}

Relevant = bruikbaar voor MCP-integraties, Claude/Anthropic tools, Ollama lokale AI, of bedrijfsautomatisering MKB.

JSON: {{"relevant": true/false, "reden": "<max 1 zin>", "gebruik": "<hoe toe te passen, max 1 zin>"}}
Alleen JSON."""

        data = extract_json(ollama(prompt, max_tokens=120))
        if data.get("relevant"):
            repo["reden"]  = data.get("reden", "")
            repo["gebruik"] = data.get("gebruik", "")
            interessant.append(repo)
            print(f"    ✓ {repo['naam']}")
        else:
            print(f"    – {repo['naam']}")

    # Opslaan in Markdown
    with open(REPOS_PATH, "w", encoding="utf-8") as f:
        f.write(f"# Interessante GitHub repos — {VANDAAG}\n\n")
        if interessant:
            for repo in interessant:
                f.write(f"## [{repo['naam']}]({repo['url']})\n\n")
                if repo.get("beschrijving"):
                    f.write(f"{repo['beschrijving']}\n\n")
                f.write(f"**Waarom relevant:** {repo.get('reden', '')}\n\n")
                f.write(f"**Mogelijke toepassing:** {repo.get('gebruik', '')}\n\n")
                f.write(f"⭐ {repo.get('sterren', '?')} sterren\n\n---\n\n")
        else:
            f.write("_Geen relevante repos gevonden deze nacht._\n")

    FASE2_JSON.write_text(json.dumps(interessant, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n  Fase 2 klaar — {len(interessant)} interessante repos in {REPOS_PATH.name}")


def github_zoek(query: str) -> list:
    url = f"https://github.com/search?q={requests.utils.quote(query)}&type=repositories&sort=updated"
    try:
        r = requests.get(url, headers=HEADERS, timeout=20)
        soup = BeautifulSoup(r.text, "html.parser")
        repos = []

        # GitHub rendert resultaten in verschillende structuren afhankelijk van login-status
        for item in soup.select("li.repo-list-item, div[data-testid='results-list'] > div, article"):
            naam_tag = None
            for sel in ["h3 a", "a[data-hydro-click]", ".v-align-middle"]:
                naam_tag = item.select_one(sel)
                if naam_tag:
                    break
            if not naam_tag:
                continue

            href = naam_tag.get("href", "")
            if not re.match(r'^/[^/]+/[^/]+/?$', href):
                continue

            naam     = href.strip("/")
            url_repo = f"https://github.com{href.rstrip('/')}"

            beschrijving = ""
            for sel in ["p.mb-1", "p[itemprop='description']", ".col-9 p"]:
                t = item.select_one(sel)
                if t and len(t.get_text(strip=True)) > 5:
                    beschrijving = t.get_text(strip=True)[:300]
                    break

            sterren = ""
            for sel in ["a[href$='/stargazers'] strong", ".octicon-star + span", "a[href$='/stargazers']"]:
                t = item.select_one(sel)
                if t:
                    sterren = t.get_text(strip=True)
                    break

            repos.append({"naam": naam, "url": url_repo, "beschrijving": beschrijving, "sterren": sterren})

        return repos[:15]
    except Exception as e:
        print(f"    GitHub fout: {e}")
        return []


# ── Fase 3: Eigen data analyse ─────────────────────────────────────────────────
def fase3():
    print("=== FASE 3: Eigen data analyse ===")

    status_tekst = ""
    if STATUS_PATH.exists():
        status_tekst = STATUS_PATH.read_text(encoding="utf-8")
        print(f"  STATUS.md gelezen ({len(status_tekst)} tekens)")
    else:
        print(f"  STATUS.md niet gevonden op {STATUS_PATH}")

    crm_items = []
    if CRM_PATH.exists():
        crm_html  = CRM_PATH.read_text(encoding="utf-8")
        crm_items = extraheer_crm_data(crm_html)
        print(f"  CRM: {len(crm_items)} items gevonden")
    else:
        print(f"  CRM dashboard niet gevonden ({CRM_PATH}) — sla over")

    crm_json = json.dumps(crm_items[:25], ensure_ascii=False, indent=2) if crm_items else "Geen CRM-data beschikbaar."

    prompt = f"""Je bent een bedrijfsanalist voor Mortise & Tenon, maatwerkmeubelbedrijf in Wormerveer.
Eigenaar: Bart Witte. Team: Bart, Mathijs, Arjan (zelfstandig).

Analyseer de bedrijfsdata hieronder en geef concrete aanbevelingen in het Nederlands.

## STATUS.md — open taken en prioriteiten
{status_tekst[:2500]}

## CRM projectstatus
{crm_json}

Beantwoord:
1. Welke projecten staan al lang in dezelfde status? (mogelijke blokkades)
2. Wat zijn de 3 meest urgente acties voor morgen?
3. Zijn er risico's of trends die aandacht verdienen?

Bondig, zakelijk, max 400 woorden."""

    analyse = ollama(prompt, max_tokens=600)
    print(f"  Ollama analyse: {len(analyse)} tekens")

    ANALYSE_PATH.write_text(
        f"# Dagelijkse bedrijfsanalyse — {VANDAAG}\n\n{analyse}\n",
        encoding="utf-8"
    )
    FASE3_JSON.write_text(
        json.dumps({"analyse": analyse, "crm_items": len(crm_items)}, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    # ── Smart Mailbox onderzoek ────────────────────────────────────────────────
    print("  Smart Mailbox onderzoek starten...")
    rss_context = ""
    if FASE1_JSON.exists():
        try:
            fase1_items = json.loads(FASE1_JSON.read_text(encoding="utf-8"))
            relevante = [i for i in fase1_items if i.get("score", 0) >= 5]
            rss_context = "\n".join(f"- {i['titel']} ({i['bron']})" for i in relevante[:10])
        except Exception:
            pass

    smart_inbox_prompt = f"""Je bent een software-architect voor Mortise & Tenon, een maatwerkmeubelbedrijf.

Taak: formuleer een concreet voorstel voor de "Smart Inbox" van Mortise & Tenon.

Context:
- M&T werkt met klantmails, offertes, bijlagen (PDF, tekeningen), Moneybird facturen
- Ze willen een slim postvak: mail + documenten + klantdossier in één overzicht
- Open source voorkeur, lokaal te draaien (self-hosted)
- Gevonden RSS-nieuws vandaag (mogelijk relevant): {rss_context or 'geen'}

Beantwoord:
1. Wat moet de Smart Inbox kunnen? (max 5 punten)
2. Welke open source projecten of libraries zijn beschikbaar als basis? Geef naam + GitHub-link.
3. Welke aanpak past het beste bij M&T en waarom?

Wees concreet. Max 500 woorden. Nederlands."""

    smart_inbox_analyse = ollama(smart_inbox_prompt, max_tokens=800)
    print(f"  Smart Inbox analyse: {len(smart_inbox_analyse)} tekens")

    SMART_INBOX_PATH.write_text(
        f"# Smart Inbox onderzoek — {VANDAAG}\n\n{smart_inbox_analyse}\n",
        encoding="utf-8"
    )
    print(f"  Fase 3 klaar — analyse in {ANALYSE_PATH.name}, Smart Inbox in {SMART_INBOX_PATH.name}")


def extraheer_crm_data(html: str) -> list:
    soup = BeautifulSoup(html, "html.parser")
    projecten = []

    # Strategie 1: kaarten met data-* attributen
    for kaart in soup.select("[data-project], [data-id], .card, .project-card, .kanban-card, .task-card"):
        naam = (
            kaart.get("data-project") or
            kaart.get("data-name") or
            _text(kaart, ["h3", "h4", ".card-title", ".project-name"]) or ""
        )
        status = kaart.get("data-status") or _text(kaart, [".status", ".badge", "[data-status]"]) or ""
        datum  = kaart.get("data-date") or kaart.get("data-updated") or ""
        if naam:
            projecten.append({"naam": naam, "status": status, "datum": datum})

    # Strategie 2: JSON in <script>-tags (bijv. localStorage-init data)
    if not projecten:
        for script in soup.find_all("script"):
            tekst = script.get_text()
            for match in re.finditer(r'\{[^{}]{10,300}\}', tekst):
                try:
                    data = json.loads(match.group())
                    naam = (
                        data.get("naam") or data.get("name") or
                        data.get("project") or data.get("title") or ""
                    )
                    if naam:
                        projecten.append({
                            "naam": naam,
                            "status": data.get("status", ""),
                            "datum": data.get("date") or data.get("datum") or data.get("updated", ""),
                        })
                except (json.JSONDecodeError, TypeError):
                    pass

    return projecten


# ── Mail-notificaties via Microsoft Graph API ──────────────────────────────────

_TOKEN_CACHE_PATH = Path(__file__).parent.parent / "CRM" / "token_cache.json"
_GRAPH_BASE       = "https://graph.microsoft.com/v1.0"
_MAIL_ONTVANGER   = "Bart@mortiseandtenon.nl"
_SCOPES           = [
    "https://graph.microsoft.com/Mail.Send",
    "https://graph.microsoft.com/Mail.ReadWrite",
]


def _bouw_msal_app():
    """Bouw een MSAL PublicClientApplication met gecachte token."""
    import msal
    tenant_id = os.getenv("TENANT_ID", "")
    client_id = os.getenv("CLIENT_ID", "")
    if not tenant_id or not client_id:
        raise ValueError("TENANT_ID en CLIENT_ID ontbreken in .env")
    cache = msal.SerializableTokenCache()
    if _TOKEN_CACHE_PATH.exists():
        cache.deserialize(_TOKEN_CACHE_PATH.read_text(encoding="utf-8"))
    app = msal.PublicClientApplication(
        client_id=client_id,
        authority="https://login.microsoftonline.com/common",
        token_cache=cache,
    )
    return app, cache


def _sla_cache_op(cache) -> None:
    if cache.has_state_changed:
        _TOKEN_CACHE_PATH.write_text(cache.serialize(), encoding="utf-8")


def _haal_access_token() -> str:
    """Haal een geldig Graph API access token op (silent refresh via cache)."""
    app, cache = _bouw_msal_app()
    accounts = app.get_accounts()
    if accounts:
        result = app.acquire_token_silent(_SCOPES, account=accounts[0])
        if result and "access_token" in result:
            _sla_cache_op(cache)
            return result["access_token"]
    raise RuntimeError(
        "Geen geldig token in cache. Draai outlook_agent.py eenmalig interactief "
        "om opnieuw in te loggen via device code flow."
    )


def _markdown_naar_html(tekst: str) -> str:
    """Converteer Markdown-achtige digest naar nette HTML voor de mail."""
    html_regels = []
    for regel in tekst.splitlines():
        if regel.startswith("## "):
            html_regels.append(f"<h2 style='color:#2c3e50;margin-top:1.5em'>{regel[3:].strip()}</h2>")
        elif regel.startswith("### "):
            html_regels.append(f"<h3 style='color:#34495e;margin-top:1em'>{regel[4:].strip()}</h3>")
        elif regel.startswith("**") and regel.endswith("**"):
            html_regels.append(f"<p><strong>{regel[2:-2]}</strong></p>")
        elif regel.startswith("- ") or regel.startswith("* "):
            html_regels.append(f"<li>{regel[2:].strip()}</li>")
        elif re.match(r'^\d+\. ', regel):
            tekst_li = re.sub(r'^\d+\. ', '', regel)
            html_regels.append(f"<li>{tekst_li.strip()}</li>")
        elif regel.strip() == "---":
            html_regels.append("<hr style='border:1px solid #eee;margin:1em 0'>")
        elif regel.strip() == "":
            html_regels.append("<br>")
        else:
            # Inline bold (**...**)
            regel_html = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', regel)
            # Inline links [tekst](url)
            regel_html = re.sub(r'\[(.+?)\]\((https?://[^\)]+)\)', r'<a href="\2">\1</a>', regel_html)
            html_regels.append(f"<p style='margin:.3em 0'>{regel_html}</p>")
    inhoud = "\n".join(html_regels)
    return f"""<!DOCTYPE html>
<html lang="nl"><head><meta charset="utf-8"></head>
<body style="font-family:Segoe UI,Arial,sans-serif;max-width:720px;margin:0 auto;padding:20px;color:#333">
{inhoud}
<hr style="border:1px solid #eee;margin-top:2em">
<p style="font-size:11px;color:#999">Gegenereerd door de M&amp;T Night Agent — {datetime.date.today().isoformat()}</p>
</body></html>"""


def stuur_digest_mail(digest_tekst: str, datum: str) -> None:
    """Stuur de Night Agent digest als HTML-mail naar Bart. Crasht de agent NIET bij mislukking."""
    try:
        token = _haal_access_token()
        html_body = _markdown_naar_html(digest_tekst)
        gebruiker = os.getenv("OUTLOOK_USER", _MAIL_ONTVANGER)
        url = f"{_GRAPH_BASE}/users/{gebruiker}/sendMail"
        payload = {
            "message": {
                "subject": f"🌅 M&T Night Agent Digest — {datum}",
                "body": {"contentType": "HTML", "content": html_body},
                "toRecipients": [{"emailAddress": {"address": _MAIL_ONTVANGER}}],
            },
            "saveToSentItems": True,
        }
        r = requests.post(
            url,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
            timeout=30,
        )
        if r.status_code == 202:
            print(f"  ✉️  Digest-mail verstuurd naar {_MAIL_ONTVANGER}")
        else:
            print(f"  [Mail] Graph API fout {r.status_code}: {r.text[:200]}")
    except Exception as e:
        print(f"  [Mail] Digest-mail mislukt (agent loopt door): {e}")


def stuur_fout_mail(fase: str, fout: str) -> None:
    """Stuur een korte foutmelding als een fase crasht. Crasht de agent NIET bij mislukking."""
    try:
        token = _haal_access_token()
        gebruiker = os.getenv("OUTLOOK_USER", _MAIL_ONTVANGER)
        url = f"{_GRAPH_BASE}/users/{gebruiker}/sendMail"
        ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        html = f"""<html><body style="font-family:Arial,sans-serif;padding:20px">
<h2 style="color:#c0392b">⚠️ Night Agent — fout in {fase}</h2>
<p><strong>Tijdstip:</strong> {ts}</p>
<p><strong>Fout:</strong></p>
<pre style="background:#f8f8f8;padding:10px;border-left:4px solid #c0392b">{fout[:800]}</pre>
<p style="color:#666;font-size:12px">Controleer de logs voor meer details.</p>
</body></html>"""
        payload = {
            "message": {
                "subject": f"⚠️ M&T Night Agent fout — {fase} ({datetime.date.today().isoformat()})",
                "body": {"contentType": "HTML", "content": html},
                "toRecipients": [{"emailAddress": {"address": _MAIL_ONTVANGER}}],
            },
            "saveToSentItems": True,
        }
        r = requests.post(
            url,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
            timeout=30,
        )
        if r.status_code == 202:
            print(f"  ✉️  Foutmail verstuurd ({fase})")
        else:
            print(f"  [Mail] Foutmail Graph fout {r.status_code}: {r.text[:200]}")
    except Exception as e:
        print(f"  [Mail] Foutmail ook mislukt: {e}")


# ── Fase 4: Digest samenstellen ────────────────────────────────────────────────
def fase4():
    print("=== FASE 4: Digest samenstellen ===")

    rss_items = []
    if FASE1_JSON.exists():
        alle = json.loads(FASE1_JSON.read_text(encoding="utf-8"))
        rss_items = [i for i in alle if i.get("score", 0) >= 7]

    repos = []
    if FASE2_JSON.exists():
        repos = json.loads(FASE2_JSON.read_text(encoding="utf-8"))

    analyse = ""
    if FASE3_JSON.exists():
        analyse = json.loads(FASE3_JSON.read_text(encoding="utf-8")).get("analyse", "")

    acties = genereer_acties(rss_items, repos, analyse)

    with open(DIGEST_PATH, "w", encoding="utf-8") as f:
        ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
        f.write(f"# Night Agent digest — {VANDAAG}\n\n")
        f.write(f"_Gegenereerd: {ts}_\n\n---\n\n")

        # ── Sectie 1: Gevonden vandaag ─────────────────────────────────────
        f.write("## 🔍 Gevonden vandaag\n\n")

        if rss_items:
            f.write("### RSS-nieuws (score ≥7)\n\n")
            for item in sorted(rss_items, key=lambda x: -x.get("score", 0)):
                f.write(f"**[{item['titel']}]({item['link']})** — {item['score']}/10\n")
                f.write(f"_{item['bron']}_ — {item['beschrijving'][:140]}…\n\n")
                if item.get("vervolg_links"):
                    for link in item["vervolg_links"]:
                        f.write(f"  - {link}\n")
                    f.write("\n")
        else:
            f.write("_Geen nieuwsitems met score ≥7._\n\n")

        if repos:
            f.write("### GitHub — nieuwe tools\n\n")
            for repo in repos[:6]:
                f.write(f"**[{repo['naam']}]({repo['url']})**\n")
                reden = repo.get("reden") or repo.get("beschrijving", "")[:140]
                f.write(f"{reden}\n\n")
        else:
            f.write("_Geen relevante GitHub-repo