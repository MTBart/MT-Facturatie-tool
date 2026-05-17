#!/usr/bin/env python3
"""
qr_generator.py - QR-codes voor Mortise & Tenon
================================================
Maakt een M&T-gestylede QR-code (PNG) voor een URL of tekst. Bruikbaar op
offertes en facturen: "scan voor productinfo / 3D-rondleiding / contact".

Prototype - gebouwd uit het nabouw-voorstel "QR code generator".

Vereist eenmalig:  pip install "qrcode[pil]"

Gebruik:
  python qr_generator.py "<tekst-of-url>" [uitvoer.png]

Voorbeeld:
  python qr_generator.py "https://mortiseandtenon.nl" offerte-qr.png
"""

import sys
from pathlib import Path

try:
    import qrcode
    from qrcode.constants import ERROR_CORRECT_M
except ImportError:
    print('Module "qrcode" ontbreekt. Installeer eenmalig:')
    print('  pip install "qrcode[pil]"')
    sys.exit(1)

# M&T-huisstijl: donkergroen op wit.
MT_GROEN = "#23402f"


def maak_qr(tekst: str, uitvoer: str) -> None:
    qr = qrcode.QRCode(
        error_correction=ERROR_CORRECT_M,  # ~15% foutcorrectie
        box_size=10,
        border=4,
    )
    qr.add_data(tekst)
    qr.make(fit=True)
    img = qr.make_image(fill_color=MT_GROEN, back_color="white")
    img.save(uitvoer)
    print(f"QR-code opgeslagen: {uitvoer}")
    print(f"  inhoud: {tekst}")


if __name__ == "__main__":
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        print('Gebruik: python qr_generator.py "<tekst-of-url>" [uitvoer.png]')
        sys.exit(1)
    tekst = sys.argv[1]
    uitvoer = sys.argv[2] if len(sys.argv) > 2 else "qr.png"
    if not uitvoer.lower().endswith(".png"):
        uitvoer += ".png"
    maak_qr(tekst, str(Path(uitvoer)))
