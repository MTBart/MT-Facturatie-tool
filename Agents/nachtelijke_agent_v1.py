#!/usr/bin/env python3
"""
Nachtelijke agent v1 — simpele versie (backup)
Bewaard als referentie. Gebruik nachtelijke_agent.py voor de volledige versie.
"""

import json
import datetime
import requests
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
AGENTS_DIR = Path(__file__).parent
BRONNEN_PATH = AGENTS_DIR / "bronnen.json"
OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "qwen2.5:14b"
VANDAAG = datetime.date.today().isoformat()


def ollama(prompt: str) -> str:
    r = requests.post(OLLAMA_URL, json={"model": MODEL, "prompt": prompt, "stream": False}, timeout=60)
    return r.json().get("response", "").strip()


def haal_rss_op(url: str) -> list:
    from bs4 import BeautifulSoup
    r = requests.get(url, timeout=10)
    soup = BeautifulSoup(r.content, "xml")
    items = []
    for item in (soup.find_all("item") or soup.find_all("entry"))[:5]:
        titel = item.find("title")
        items.append(titel.get_text(strip=True) if titel else "")
    return items


def main():
    if not BRONNEN_PATH.exists():
        print("bronnen.json niet gevonden")
        return

    with open(BRONNEN_PATH, encoding="utf-8") as f:
        bronnen = json.load(f).get("feeds", [])

    digest = f"# Digest {VANDAAG}\n\n"
    for bron in bronnen[:3]:
        print(f"Ophalen: {bron['naam']}")
        try:
            items = haal_rss_op(bron["url"])
            digest += f"## {bron['naam']}\n"
            for titel in items:
                prompt = f"Score 1-10 relevantie voor maatwerkmeubelbedrijf met AI: '{titel}'. Antwoord alleen een getal."
                score = ollama(prompt).strip()
                digest += f"- [{score}] {titel}\n"
            digest += "\n"
        except Exception as e:
            print(f"  Fout: {e}")

    output = AGENTS_DIR / f"digest_{VANDAAG}_v1.md"
    output.write_text(digest, encoding="utf-8")
    print(f"Klaar: {output}")


if __name__ == "__main__":
    main()
