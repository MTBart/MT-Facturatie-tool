#!/usr/bin/env python3
"""
video_analyse.py - analyseer een YouTube-video LOKAAL
======================================================
Haalt het transcript op en distilleert het met Ollama (lokaal, nul Claude-
tokens). Voor lange video's wordt het transcript lokaal in chunks samengevat.
Hergebruikt de helpers uit bron_analyse.py.

Gebruik:  python video_analyse.py <youtube-url-of-id>
"""

import sys
from bron_analyse import (youtube_id, haal_youtube_transcript,
                          verklein_indien_lang, distilleer)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Gebruik: python video_analyse.py <youtube-url-of-id>")
        sys.exit(1)

    arg = sys.argv[1]
    vid = youtube_id(arg) or arg
    print(f"Transcript ophalen voor {vid}...")
    inhoud = haal_youtube_transcript(vid)
    if len(inhoud) < 300:
        print(f"Geen bruikbaar transcript ({len(inhoud)} tekens).")
        sys.exit(1)

    print(f"{len(inhoud)} tekens opgehaald. Lokaal distilleren met Ollama...")
    verkleind, calls = verklein_indien_lang("video", inhoud)
    if calls:
        print(f"  (lang transcript - in {calls} chunks lokaal samengevat)")
    analyse = distilleer(f"YouTube-video {vid}", "video", verkleind)

    print("\n" + "=" * 60)
    print("  LOKALE ANALYSE (Ollama)")
    print("=" * 60 + "\n")
    print(analyse)
