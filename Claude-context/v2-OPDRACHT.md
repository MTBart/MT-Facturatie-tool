# OPDRACHT — Facturatie tool v2 (`v2.html`)

> Bouwbrief voor de uitvoerende agent. Geschreven door Larry, 2026-06-10 (nachtrun).
> Opdrachtgever: Bart Witte (M&T meubelmakerij). Citaat: "ik wil van die knullige
> zelfbouw-door-AI look af … kan je de frisse nieuwe tool als facturatie tool v2
> er naast zetten? zodat ik goed de verschillen kan testen?"

## 0. Wat je bouwt

`C:\MT\v2.html` — een **volledige, zelfstandige v2** van de M&T-cockpit, naast
`index.html` (v1 blijft 100% onaangeraakt). v2.html staat al klaar als exacte
kopie van index.html; jij verbouwt die kopie. Zelfde origin (GitHub Pages) =
zelfde localStorage + SharePoint-sync → Bart test v1 en v2 met dezelfde data
naast elkaar.

## 1. IJzeren regels (overtreding = mislukt)

1. **`index.html` NIET aanraken.** Alleen `v2.html` bewerken.
2. **Repo is PUBLIC.** Geen klantnamen, bedragen, tokens, e-mailadressen of
   andere PII hardcoden. Data komt runtime uit localStorage/SharePoint, zo
   blijft dat.
3. **Geen JS-logica verwijderen of hernoemen.** Alle functies, fetch-flows,
   `_SP`-sync, MSAL-login, Worker-calls blijven intact. Je verbouwt CSS,
   markup-volgorde en kleine presentatie-JS (tab-volgorde, labels). Content-divs
   van tabs die uit de navigatie gaan blijven in de DOM staan (display:none) —
   JS verwijst ernaar.
4. **Single file blijft single file.** Geen externe CSS/JS-bestanden erbij
   (Google Fonts-links die er al staan mogen blijven).
5. Werk in **kleine, controleerbare stappen** en houd v2.html na elke stap
   parsebaar/werkend (geen half-afgemaakte tags achterlaten).

## 2. Tab-herstructurering (Bart-besluiten, letterlijk uitvoeren)

Huidige knoppenbalk (regel ~455-469): dashboard, inbox, verwerk, controle,
projecten, klanten, voorraad, materialen, bestelling, historie, agenda, toggl,
instellingen, cn, migratie.

**Nieuwe volgorde = workflow van links naar rechts** (binnenkomend werk → plannen
→ uitvoeren → inkopen → terugkijken → beheer):

| # | Tab | Label v2 | Opmerking |
|---|-----|----------|-----------|
| 1 | dashboard | Dashboard | startpunt |
| 2 | inbox | Inbox | mail in |
| 3 | projecten | Projecten | werk |
| 4 | agenda | Agenda | plannen |
| 5 | toggl | Uren | hernoem label "Toggl" → "Uren" (functie blijft Toggl) |
| 6 | voorraad | Voorraad | zie §3 — interiorcad-koppeling |
| 7 | bestelling | Bestellijst | inkoop |
| 8 | klanten | Klanten | relaties |
| 9 | historie | Geschiedenis | terugkijken |
| 10 | instellingen | Instellingen | beheer; migratie-knop hieronder onderbrengen |

**Vervalt uit de balk:**
- `cn` (CompaNanny) — knop weg. Content-div mag blijven (hidden).
- `verwerk` (Nieuwe factuur) + `controle` (Factuur controle) — **gearchiveerd**:
  knoppen uit de hoofdbalk; maak in Instellingen een blokje "Gearchiveerde
  schermen" met twee links die `showTab('verwerk')`/`showTab('controle')` nog
  aanroepen (vangnet, geen dataverlies).
- `materialen` — knop uit de hoofdbalk; bereikbaar vanuit Voorraad (§3).
- `migratie` (knop had al `id="btn-migratie"`, vermoedelijk conditioneel) —
  verplaats de ingang naar Instellingen.

## 3. Voorraad ↔ interiorcad-materialen (Bart: "voorraad is belangrijk")

In de **Voorraad-tab**:
- Voeg in de bestaande vtab-balk (platen/kantenband/overig) een vierde sub-tab
  **"interiorcad"** toe die de bestaande materialen-tab-content toont (hergebruik
  de bestaande markup/JS van `#tab-materialen` — verplaats die content-div in de
  voorraad-tab of toon hem via de bestaande `showMtab`-logica; kies de kleinste
  veilige ingreep).
- Plus per voorraad-rij/sectie een knop **"→ interiorcad"** die naar die sub-tab
  springt met het zoekfilter voorgevuld op de materiaalnaam (simpele JS: zet
  input-waarde + trigger bestaande filterfunctie).

## 4. Restyle — weg van de "AI-zelfbouw look"

Stijl-DNA (Bart): **Outlook** (inbox: lijst + leespaneel), **Toggl** (uren:
rustig, één accent, week-grid), **Jortt** (financieel: strakke NL-SaaS-tabellen).

**⚠ KOERSWIJZIGING BART (6-10, 23:xx — overschrijft alles hieronder dat
"warm papier" zegt):** GEEN warm-papier-look. Bart letterlijk: "ik wil juist
lekker fris en modern, groen en goud elementen mogen er wel in opzich, maar ik
wil wat moois en lekker werkbaars met een professionele uitstraling maar waar
je graag naar kijkt, het mag best wel een beetje fancy tool worden."
Vertaling:
- Basis = fris, licht, modern SaaS-canvas: koel wit/near-white (#FFFFFF /
  #F8FAF9-richting), géén beige/crème/papier-tinten als paginakleur.
- M&T-groen `#2A4A38` (of een frissere afgeleide) blijft het primaire accent,
  goud `#B8962E` het speciale accent — maar als accenten op een fris canvas,
  niet als warme schil.
- "Een beetje fancy" mag: subtiele gradients/glassmorphism-achtige panelen,
  een mooi georkestreerde laad-animatie, micro-interacties, levendige
  hover-states — zolang het professioneel en werkbaar blijft (Toggl/Linear/
  moderne SaaS-vibe, geen kermis).
- De Pixel-tokenladder (§2 van de audit) blijft structureel het model
  (n-ladder, status-rollen, shadow-ladder), maar **herkalibreer de
  neutral-waarden naar koel/fris** i.p.v. warm papier. Typografie
  (Fraunces/Figtree/DM Mono) blijft; Fraunces inzetten als karaktervol
  display-accent werkt juist goed op een fris canvas.

Twee audits zijn leidend, beide in `C:\MT\Claude-context\`:
- `design-audit-iris.md` — structuur (B1-B8)
- `design-audit-pixel.md` — kleur/oppervlak/componenten (§2 token-systeem, §3
  component-spec, §4 quick-wins)

Plus de officiële Anthropic **frontend-design skill** (geïnstalleerd, lees hem):
`C:\Users\BartWitte\.claude\plugins\cache\claude-plugins-official\frontend-design\unknown\skills\frontend-design\SKILL.md`
Pas die craft-principes toe **binnen de M&T-schil**: de aesthetic direction is
hier al gekozen — *refined/editorial werkplaats-luxe*: warm papier, diep groen,
goud-accent, Fraunces display / Figtree body / DM Mono cijfers. Dus géén nieuwe
fonts of willekeurig thema kiezen; wél de skill-principes (intentionaliteit,
dominante kleur + scherp accent, één goed georkestreerd laad-moment met
staggered reveals, micro-interacties op hover/focus, subtiele textuur/diepte
in de header, meticuleuze spacing) gebruiken om de "generic AI"-look te slopen.

**Verplichte ingrepen** (samenvatting, details in de audits):
1. Pixel §2-tokenladder integraal in `:root` van v2 (neutrals n-0…n-900,
   status-rollen, shadow-ladder, focus-rings). Oude tokens als alias laten
   wijzen naar de ladder.
2. Dropdown-fix globaal: `select option{color:#1C1A16;background:#fff}` (Iris B1
   / Pixel quick-win 1).
3. Schaduwen plat: kaarten rand óf schaduw, niet beide; `--shadow-card 0 1px 3px`.
4. Knoppen terug naar 4 gewichten: primary (groen) / secondary / ghost / gold;
   status-knoppen semantisch (danger/info). `.btn-purple` → info. Eén
   `--control-h:38px` hoogte. Focus-ring overal (`:focus-visible`).
5. Informatiedichtheid: niets onder 11px; tabelcellen 12-13px; rij-hoogte min
   40-44px; `--container-max:1400px` gecentreerd (Iris B3/B5).
6. Tabellen Jortt-stijl: 1px headers, hairline-rijen, neutrale hover, getallen
   rechts `tabular-nums`, subtiele zebra optioneel (Pixel §3.4).
7. Eén tab-nav-stijl: actief = groen + gouden onderstreping; de drie
   subtab-systemen (`.tab-btn`/`.tg-subtab`/`.vtab-btn`) delen dezelfde tokens.
8. Hardcoded hexes (#faf9f6, #f0f0f0, #1e3829, #7a6010, #f0ede4, #23402e …)
   vervangen door tokens (Iris B6). Inline styles waar je toch markup aanraakt
   omzetten naar classes; geen aparte big-bang.
9. Header/topbar: rustiger — Toggl-achtig: lichte balk, logo + tabs + rechts
   login-status. Geen zware gradient-banner als die er nu zit.
10. Emoji in tab-labels weg (📊📥🧱📅⏱️📦) — clean tekstlabels; status-emoji's
    elders in de UI mogen blijven waar functioneel.
11. Voeg in de header een klein badge-element "v2 bèta" + link "← naar v1"
    (`index.html`) zodat Bart makkelijk wisselt.

**R2-componentclasses** (`.data-table`, `.toolbar`, `.filterbar`, `.chip`,
`.mt-row`, `.detail-pane`, `.split-view`, `.empty-state`, `.modal-head`,
`.card--tight/--empty`, `.status-dot`) staan al in het bestand (regel ~213+) —
gebruik die, bouw geen parallel systeem.

## 5. Werkwijze & verificatie

1. Lees eerst beide audits volledig.
2. Werk in deze volgorde: tokens (§4.1-2) → tab-balk herstructureren (§2) →
   componenten (§4.3-8) → voorraad/interiorcad (§3) → header + details (§4.9-11).
3. Verifieer na afloop minimaal:
   - `node -e "..."` of een Python-check dat het bestand wel-gevormde
     `<script>`-blokken heeft (geen syntax errors; bv. `node --check` op
     geëxtraheerde scripts of een simpele tag-balans-check).
   - Alle `showTab('…')`-doelen bestaan nog als element.
   - Geen verwijzingen naar verwijderde knoppen die JS-errors geven bij load.
   - `grep`-check: geen nieuwe hardcoded PII/secrets.
4. **Niet committen/pushen** — dat doet Larry na review.
5. Schrijf een kort verslag van wat je deed + twijfelpunten naar
   `C:\MT\Claude-context\v2-VERSLAG.md`.

## 6. Wat je NIET doet

- Geen nieuwe features buiten §2/§3 (geen Toggl-T2-timerbar, geen unified
  agenda-uitbreiding — dat zijn aparte masterplan-stappen).
- Geen wijzigingen aan de Cloudflare-Worker-aanroepen of API-endpoints.
- Geen verwijdering van content-divs of JS-functies.
- Geen `git`-operaties.
