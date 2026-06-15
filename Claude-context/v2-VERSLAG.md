# VERSLAG — Facturatie tool v2 (`v2.html`)

> Uitvoeringsverslag bouwagent. 2026-06-10. Alleen `v2.html` aangeraakt; `index.html` onaangeroerd.

## Wat is gedaan

### §2 — Tab-herstructurering
- Knoppenbalk teruggebracht naar **10 knoppen** in de workflow-volgorde (regel ~479-488):
  Dashboard → Inbox → Projecten → Agenda → **Uren** (label, functie blijft Toggl) →
  Voorraad → Bestellijst → Klanten → Geschiedenis → Instellingen.
- Emoji uit alle tab-labels.
- Uit de balk gehaald: `cn`, `verwerk`, `controle`, `materialen`, `migratie`.
  **Alle content-divs blijven in de DOM** — geen dataverlies, JS verwijst er nog naar.
- Instellingen → kaart **"Gearchiveerde schermen"** (regel ~835-846) met vier
  `btn-secondary`-knoppen die `showTab('verwerk'/'controle'/'cn'/'migratie')` aanroepen.
  `id="btn-migratie"` behouden, dus de bestaande conditionele hide-logica (regel ~1556)
  blijft werken.

### §3 — Voorraad ↔ interiorcad
- Vierde sub-tab **"interiorcad"** in de voorraad-vtab-balk (regel ~695), lege pane
  `#vtab-interiorcad` (regel ~711).
- Nieuwe presentatie-helper `openVoorraadIC()` **verplaatst de bestaande
  `#tab-materialen .card` op runtime** naar de voorraad-pane — géén markup-duplicatie,
  dus IDs (`mat-zoek`, `mat-tabel`, …) blijven uniek. `showMtab` en `laadMaterialen`
  zijn locatie-onafhankelijk gemaakt (`#mat-subtabs` / `#mat-tabel`).
- Per voorraad-rij een **"→ interiorcad"**-knop → `gotoInteriorcad(naam)` springt naar
  de sub-tab en vult `mat-zoek` voor met de materiaalnaam + triggert `renderMaterialen()`.

### §4 — Restyle (koel/fris, KOERSWIJZIGING Bart verwerkt)
- Neutral-ladder in `:root` **gekalibreerd naar koel/fris** (n-0 #FFFFFF … n-900 #172521,
  lichte groene ondertoon), géén warm papier. Tokennamen onveranderd → niets downstream breekt.
- `--container-max:1400px` gecentreerd.
- Body: subtiele groene radial-gradient als sfeer.
- Header: lichte balk (n-0→n-50 gradient), groene h1, groen→goud accentlijn,
  `header-badge` "v2 bèta" + `header-v1link` "← naar v1" (regel ~457/468).
- Kaarten: rand óf zachte schaduw + hover-lift; knoppen 4 gewichten met
  gradient + focus-rings; staggered laad-reveal (`mtRise`, respecteert
  `prefers-reduced-motion`).
- **§4.8 hardcoded warm hexes vervangen door koele tokens** in de per-tab style-blokken:
  agenda (`#faf9f6`/`#f1f0ec`/`#fbf9f2`/`#f0ede4`), toggl (`#f0ede4`/`#7a6a2e`/`#faf9f6`/
  `#f6f5f1`/`#ececec`), inbox (`#faf9f6`/`#f0ece0`/`#f3f0e8`/`#e6e0d0`/`#f0f0f0`/`#fafafa`),
  plan-editor + één inline (`#faf9f6` regel ~3817) en de drie `#F7F5F0`-foregrounds
  (tbchat/filter-btn) → `var(--n-0)`. Doelgericht, geen big-bang over alle inline styles.

## Verificatie (uitgevoerd)
- **`node --check`** op alle 5 geëxtraheerde `<script>`-blokken → **alle OK**, geen syntax errors.
- **showTab-doelen:** alle 14 targets (incl. gearchiveerde cn/controle/verwerk/migratie)
  hebben nog een bestaand `tab-`-element → **0 missend**.
- **Functie-diff index↔v2:** 0 functies verwijderd; alleen `openVoorraadIC` + `gotoInteriorcad`
  toegevoegd (presentatie-helpers).
- **PII/secrets-scan:** geen nieuwe tokens/sleutels/bedragen. De enige treffers
  (`info@mortiseandtenon.nl`, 2×) bestaan **identiek in `index.html`** — pre-existing,
  niet door mij toegevoegd.
- Warm-papier-paletsweep: geen surface-hexes meer; resterende `#1E3829`/`#7A6010`
  zijn token-definities in `:root` (bedoeld).

## Twijfelpunten / open risico's
1. **interiorcad runtime-verplaatsing:** `openVoorraadIC` haalt de materialen-`.card`
   fysiek uit `#tab-materialen` naar de voorraad-pane. Zolang niemand de materialen-tab
   óók direct opent verwacht ik geen conflict (knop is uit de balk), maar als de
   gearchiveerde route ooit teruggezet wordt: de card is dan "verhuisd". Visueel niet
   getest in browser — alleen statisch geverifieerd.
2. **Staggered reveal `nth-child`-delays:** kosmetisch; bij tabs met veel directe
   kinderen krijgen alleen de eerste ~5 een delay, rest verschijnt direct. Bedoeld.
3. **Niet in een echte browser gerenderd** — verificatie is statisch (parse + targets +
   diff + PII). Aanrader: Bart opent v2.html lokaal en klikt elke tab + de
   "→ interiorcad"-knop één keer door.
4. Geen git-operaties uitgevoerd (conform opdracht). Commit/push doet Larry na review.

## Niet gedaan (bewust, buiten scope §2/§3)
- Geen nieuwe features (geen timerbar, geen unified-agenda-uitbreiding).
- Geen wijziging aan Worker-calls / API-endpoints / `_SP`-sync / MSAL.
- Geen content-divs of JS-functies verwijderd.
