# Releaseprocedure (cockpit v2 + mobiel)

Alleen na akkoord van Bart. De worker (Cloudflare) wordt apart uitgerold; een front-end-release mag
worker-code meenemen die nog niet gedeployd is, mits de front-end ook met de oude worker werkt.

1. **Werk parkeren** — alles gecommit of `git stash` met een duidelijke naam; niets half meesturen.
2. **Controleren** — alle harnesses groen; de push-diff bevat geen secrets, persoonsgegevens, bedragen of klantnamen.
3. **Back-up roteren** — `backup/` vullen met de huidige live-versie via `git archive origin/main`
   (v2.html, mobiel.html, uren.html, index.html, calc-engine.js, mt-*.js, track.js, sw.js,
   manifest-mobiel.json, data/klanten.json, icons, vendor). In de html's alleen: `noindex`, titel
   "BACKUP vX —" en de rode balk. Per bestand een hash-check (gelijk aan live, op die drie invoegingen na).
4. **Versielabel** — `<span class="header-version">` in v2.html naar de nieuwe versie.
5. **"Wat is er verbeterd"** — bovenaan `data/updates.json` een item toevoegen:
   `{versie, datum (JJJJ-MM-DD), titel, voor: 'iedereen' | 'beheer', punten: [...]}`.
   Gewone taal, kort, zonder jargon, klantnamen, persoonsgegevens of bedragen. `voor: 'beheer'` voor wat
   alleen eigenaar/beheerder ziet; de rest krijgt eenmalig het "nieuw"-stipje.
6. **Commit** — bericht zonder BOM (`git commit -F bestand`), bv. "Release v2.9: …; backup = v2.8".
7. **Tag** — de vorige live-commit taggen met de vorige versie (als die tag er nog niet is).
8. **Push** — `git push origin main` + de tag; wachten tot GitHub Pages de nieuwe versie toont
   (versielabel live controleren) en melden met de commit-hash.
