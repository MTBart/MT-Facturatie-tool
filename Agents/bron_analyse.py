#!/usr/bin/env python3
"""
bron_analyse.py - MT Night Agent, content-extractie (fase 1b)
===============================================================
Leest de ECHTE inhoud van de best scorende bronnen - YouTube-transcripts en
artikelen - en reverse-engineert het beschreven systeem zodat M&T het kan
nabouwen i.p.v. de cursus van de maker te kopen.

VOLLEDIG LOKAAL. Een video-transcript van een uur is een grote file; die hoort
niet naar Claude. Daarom: lange transcripts worden lokaal met Ollama in stukken
(chunks) samengevat (map), daarna gedistilleerd (reduce). Claude krijgt later
alleen het kleine eindresultaat te zien.

Draait na fase1. Verrijkt fase1_resultaat.json met 'analyse_diep', bouwt een
kennisbank in Agents/kennis/kennis.md en zet sterke vondsten als nabouw-
voorstel in Agents/voorstellen/.

Gebruik:  python bron_analyse.py
"""

import json
import re
import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

AGENTS_DIR    = Path(__file__).parent
FASE1_JSON    = AGENTS_DIR / "fase1_resultaat.json"
KENNIS_DIR    = AGENTS_DIR / "kennis"
KENNIS_MD     = KENNIS_DIR / "kennis.md"
VOORSTEL_DIR  = AGENTS_DIR / "voorstellen"
CONFIG_PATH   = AGENTS_DIR / "agent_config.json"

OLLAMA_URL = "http://localhost:11434/api/generate"
HEADERS    = {"User-Agent": "Mozilla/5.0 (compatible; MT-Night-Agent/1.0)"}
VANDAAG    = datetime.date.today().isoformat()

# Tekens per Ollama-call - past ruim binnen num_ctx 8192 (~4 tekens/token).
CHUNK_GROOTTE  = 14000
# Hoeveel topbronnen per nacht diep analyseren (begrenst de looptijd).
MAX_DIEP_ITEMS = 6


def _config() -> dict:
    cfg = {"ollama_model": "qwen2.5:14b", "score_drempel_ddg": 7,
           "ollama_context": 8192}
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            pass
    return cfg


CONFIG = _config()


def ollama(prompt: str, max_tokens: int = 500) -> str:
    try:
        r = requests.post(OLLAMA_URL, json={
            "model": CONFIG["ollama_model"], "prompt": prompt, "stream": False,
            "options": {"num_predict": max_tokens,
                        "num_ctx": CONFIG.get("ollama_context", 8192)},
        }, timeout=300)
        r.raise_for_status()
        return r.json().get("response", "").strip()
    except Exception as e:
        print(f"  [Ollama fout] {e}")
        return ""


# ── Content ophalen ──────────────────────────────────────────────────────────
def youtube_id(url: str) -> str:
    m = re.search(r'(?:v=|youtu\.be/|/watch\?v=)([A-Za-z0-9_-]{11})', url)
    return m.group(1) if m else ""


def haal_youtube_transcript(video_id: str) -> str:
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        segs = YouTubeTranscriptApi().fetch(video_id)
        return " ".join(s.text for s in segs)
    except Exception as e:
        print(f"    [transcript fout] {e}")
        return ""


def haal_artikel_tekst(url: str) -> str:
    try:
        r = requests.get(url, headers=HEADERS, timeout=20)
        soup = BeautifulSoup(r.text, "html.parser")
        for tag in soup(["script", "style", "nav", "header", "footer", "aside"]):
            tag.decompose()
        hoofd = soup.find("article") or soup.find("main") or soup.body or soup
        return re.sub(r'\s+', ' ', hoofd.get_text(separator=" ", strip=True))
    except Exception as e:
        print(f"    [artikel fout] {e}")
        return ""


def haal_inhoud(item: dict) -> tuple:
    """Geeft (soort, volledige_tekst) terug. soort = 'video' | 'artikel' | ''."""
    link = item.get("link", "")
    vid = youtube_id(link)
    if vid:
        return "video", haal_youtube_transcript(vid)
    if link.startswith("http"):
        return "artikel", haal_artikel_tekst(link)
    return "", ""


# ── Map-reduce: lange content lokaal verkleinen ──────────────────────────────
def _chunks(tekst: str, grootte: int) -> list:
    return [tekst[i:i + grootte] for i in range(0, len(tekst), grootte)]


def vat_chunk_samen(chunk: str, deel: int, totaal: int) -> str:
    """MAP-stap: haal de technische kern uit één stuk transcript/artikel."""
    prompt = f"""Dit is deel {deel}/{totaal} van een transcript of artikel over AI-systemen.
Vat de belangrijkste TECHNISCHE punten samen: welke tools, agents, stappen,
skill chains of token-trucs worden beschreven? Bondige bullets, geen reclame.

{chunk}

Alleen de bullets."""
    return ollama(prompt, max_tokens=400)


def verklein_indien_lang(soort: str, inhoud: str) -> tuple:
    """Geeft (tekst_voor_distillatie, aantal_ollama_calls) terug.
    Korte content: ongewijzigd. Lange content: lokaal in chunks samengevat."""
    if len(inhoud) <= CHUNK_GROOTTE:
        return inhoud, 0
    delen = _chunks(inhoud, CHUNK_GROOTTE)
    print(f"     lang ({len(inhoud)} tekens) - lokaal samenvatten in {len(delen)} chunks")
    samenvattingen = []
    for n, deel in enumerate(delen, 1):
        samenvattingen.append(vat_chunk_samen(deel, n, len(delen)))
    return "SAMENVATTING PER DEEL:\n" + "\n".join(samenvattingen), len(delen)


# ── Reduce: distilleren naar een nabouw-analyse ──────────────────────────────
def distilleer(titel: str, soort: str, inhoud: str) -> str:
    """REDUCE-stap: reverse-engineer het systeem zodat M&T het kan nabouwen."""
    prompt = f"""Hieronder de inhoud (of samenvatting) van een {soort or 'bron'}.
Makers leggen vaak uit hoe ze een AI-systeem bouwden - en verkopen daarna hun
cursus of template. Mortise & Tenon wil zulke systemen niet kopen maar nabouwen.

Mortise & Tenon = maatwerkmeubelbedrijf dat kantoorwerk automatiseert met AI-agents
(offertes, planning, mail, productie). Interesse: kleine agents, skill chains,
token-vriendelijk werken.

Titel: {titel}
Inhoud:
{inhoud[:CHUNK_GROOTTE]}

Reverse-engineer wat hier beschreven wordt. Antwoord exact in dit format:
KERN: <welk systeem of aanpak beschrijven ze - 2 zinnen>
ONDERDELEN: <de bouwstenen: tools, agents, stappen - bondig>
NABOUW VOOR M&T: <hoe zou M&T dit zelf bouwen - 2 tot 4 concrete stappen>
WAARDE: <cijfer 1-5, hoe de moeite waard om voor M&T na te bouwen>
Staat er niets bruikbaars in: antwoord alleen "WAARDE: 0".
Nederlands, bondig, geen extra uitleg."""
    return ollama(prompt, max_tokens=500)


def _waarde(analyse: str) -> int:
    m = re.search(r'WAARDE:\s*(\d)', analyse or "")
    return int(m.group(1)) if m else 0


def schrijf_nabouw_voorstel(item: dict, analyse: str, waarde: int) -> None:
    """Zet een hoog scorende bron weg als nabouw-voorstel voor de Claude-review."""
    VOORSTEL_DIR.mkdir(exist_ok=True)
    veilig = re.sub(r'[^A-Za-z0-9]+', '_', item["titel"])[:40].strip("_")
    pad = VOORSTEL_DIR / f"nabouw_{VANDAAG}_{veilig}.md"
    pad.write_text(
        f"# Nabouw-kandidaat: {item['titel']}\n"
        f"status: open\n\n"
        f"Bron: {item.get('link','')} ({item.get('bron','')}, "
        f"score {item.get('score','?')}/10) - nabouw-waarde {waarde}/5\n\n"
        f"{analyse}\n\n"
        f"---\n"
        f"Voor de Claude-review: beoordeel of M&T dit nabouwt. Zo ja, bouw een "
        f"M&T-versie als prototype binnen `Agents/` (niet direct in productie) "
        f"en houd je aan de harde grenzen in `claude_review.md`.\n",
        encoding="utf-8")


# ── Kennisbank ───────────────────────────────────────────────────────────────
def voeg_toe_aan_kennis(records: list) -> None:
    KENNIS_DIR.mkdir(exist_ok=True)
    if not KENNIS_MD.exists():
        KENNIS_MD.write_text(
            "# Kennisbank - MT Night Agent\n\n"
            "Groeiend geheugen: systemen en technieken die de agent uit bronnen\n"
            "heeft gereverse-engineerd. De Claude-review gebruikt dit om M&T\n"
            "echt te verbeteren en nabouw-kandidaten te bouwen.\n",
            encoding="utf-8")
    blok = [f"\n## {VANDAAG}\n"]
    for r in records:
        blok.append(f"\n### {r['titel']}")
        blok.append(f"_{r['bron']} - score {r['score']}/10 - {r['link']}_\n")
        blok.append(r["analyse_diep"] + "\n")
    KENNIS_MD.write_text(KENNIS_MD.read_text(encoding="utf-8") + "\n".join(blok),
                         encoding="utf-8")


# ── Hoofdroutine ─────────────────────────────────────────────────────────────
def main() -> None:
    print("=== FASE 1b: Bron-analyse (content lezen, lokaal) ===")
    if not FASE1_JSON.exists():
        print("  fase1_resultaat.json ontbreekt - sla over")
        return

    items = json.loads(FASE1_JSON.read_text(encoding="utf-8"))
    drempel = CONFIG["score_drempel_ddg"]
    diep = sorted([i for i in items if i.get("score", 0) >= drempel],
                  key=lambda x: -x.get("score", 0))[:MAX_DIEP_ITEMS]

    if not diep:
        print(f"  Geen items >= {drempel} om diep te analyseren.")
        return

    print(f"  {len(diep)} bronnen worden echt gelezen en gereverse-engineerd...")
    verwerkt, voorstellen = [], 0
    for item in diep:
        print(f"  -> {item['titel'][:60]}")
        soort, inhoud = haal_inhoud(item)
        if len(inhoud) < 300:
            print(f"     te weinig content ({len(inhoud)} tekens) - overgeslagen")
            item["analyse_diep"] = ""
            continue

        verkleind, calls = verklein_indien_lang(soort, inhoud)
        print(f"     {soort}: {len(inhoud)} tekens gelezen "
              f"({calls} chunk-calls), distilleren...")
        analyse = distilleer(item["titel"], soort, verkleind)
        item["analyse_diep"] = analyse
        waarde = _waarde(analyse)
        item["nabouw_waarde"] = waarde

        if waarde >= 1:
            verwerkt.append(item)
        if waarde >= 4:
            schrijf_nabouw_voorstel(item, analyse, waarde)
            voorstellen += 1
            print(f"     WAARDE {waarde}/5 -> nabouw-voorstel geschreven")
        else:
            print(f"     WAARDE {waarde}/5")

    FASE1_JSON.write_text(json.dumps(items, ensure_ascii=False, indent=2),
                          encoding="utf-8")

    if verwerkt:
        voeg_toe_aan_kennis(verwerkt)
        print(f"  {len(verwerkt)} bronnen toegevoegd aan kennis/kennis.md")
    print(f"  Fase 1b klaar - {len(diep)} bronnen gelezen, "
          f"{voorstellen} nabouw-voorstel(len).")


if __name__ == "__main__":
    main()
