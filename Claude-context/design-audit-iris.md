# M&T Cockpit — Layout/UX/Ruimtelijkheids-audit (Iris)

Datum: 2026-06-05
Scope: `C:\MT\index.html` (één HTML-SPA, ~330KB). Dit is een **structuur/UX/ruimtelijkheids**-audit in Toggl/Jortt-geest. Visuele afwerking (kleur-finish, iconen, illustratie) loopt parallel bij Pixel. Index.html is NIET aangepast — dit document is review + token-voorstel.

Referentie-DNA: Toggl (rustige timer/agenda, veel witruimte, zachte borders, duidelijke hiërarchie) + Jortt (strakke formulieren, kalme tabellen, ademruimte).

Regelnummers verwijzen naar `index.html` zoals gelezen op 2026-06-05.

---

## 1. Top-bevindingen (geprioriteerd)

### B1 — Dropdown-tekst onleesbaar (ACTIEF gebruikersprobleem) — KRITIEK
- Globale regel (regel 97): `input,select,textarea{... background:var(--bg) ...}` → `--bg` = `#F7F5F0` (zeer licht). Er is **geen** globale `select option{color:...}`-regel.
- De enige plek waar de optielijst-kleur expliciet gezet is, is regel 807: `#tab-toggl .tg-timerbar select option{color:#222}`. Dat bevestigt dat het probleem overal elders bestaat — iemand heeft het lokaal in de Toggl-timer gepatcht maar nergens anders.
- Op een donkere timerbalk (regel 806: `select` met `color:#fff`) erft een `<option>` zonder eigen `color` wit-op-wit in het uitklappaneel op meerdere browsers/OS → onzichtbaar. Dit is exact Barts klacht.
- **Fix-richting:** één globale `select option{color:var(--text);background:var(--surface)}` + `select optgroup` idem. Op donkere selects (Toggl-timer) `option` expliciet donker laten (al gebeurd).

### B2 — Geen spacing-schaal: pixels + rem + em door elkaar — HOOG
- Spacing is volledig ad-hoc. Voorbeelden binnen tientallen regels van elkaar: `padding:1.5rem` (card, r84), `padding:14px 18px` (tab-btn, r76), `padding:9px 11px` (input, r97), `padding:9px 18px` (btn, r106), `padding:8px 16px` (vtab, r179), `padding:0.6rem 1rem` (status-bar, r89), `gap:0.75rem` / `gap:5px` / `gap:12px` / `gap:1.25rem` willekeurig door elkaar.
- Resultaat: geen verticaal ritme. Secties "zweven" op inconsistente afstanden, wat de tool druk laat ogen ondanks dat er op zich ruimte is.
- Er is GEEN `--space-*` token in `:root` (r12-37). Wel kleur/radius/shadow-tokens, maar spacing ontbreekt volledig.

### B3 — Informatiedichtheid te hoog in tabellen/regelrijen — HOOG
- Factuurregel-grid (r145): `grid-template-columns:2fr 1.3fr 60px 85px 55px 1.1fr 80px 32px 28px; gap:5px`. Negen kolommen met 5px gap en 32/28px micro-knoppen → zeer dicht, klik-targets onder de 40px-norm (remove-btn 28×36, r148).
- Tabellen `td` padding 7-8px (r186, r206, r848) is krap voor Jortt-gevoel; Jortt/Toggl gebruiken eerder 12-14px verticale celpadding met meer regelhoogte.
- Font-sizes dalen tot 9-10px op labels/badges (r51, r85 card-title 10px, r227 kpi-label 9px, r834 tg-prio 9.5px). Onder 11px wordt het moe-makend en oogt het "tooltool".

### B4 — Te veel knop-varianten + inconsistente hoogtes — MIDDEN
- Knop-varianten: `btn-primary, btn-gold, btn-secondary, btn-danger, btn-info, btn-purple` (r107-116) + maten `btn-sm, btn-xs` (r117-118). Zes kleur-varianten is veel; `info`/`purple` voegen weinig semantiek toe en verhogen visuele ruis.
- Hoogtes lopen uiteen: btn padding 9px (r106) ≈ 36px hoog, input 9px (r97) ≈ 36px, maar zoek-input 8px (r171), periode-input 6px (r174), filter-btn 3px (r166). Geen gedeelde control-hoogte → velden en knoppen op één rij lijnen niet uit.

### B5 — Geen container-max-width / leesbreedte-grens — MIDDEN
- `.main{padding:1.75rem 2rem;max-width:100%}` (r83). Op brede schermen rekken dashboard-grids, tabellen en formulieren full-width uit. Toggl/Jortt hanteren een rustige max-content-breedte (±1200-1400px) gecentreerd. Sommige tabs hebben ad-hoc `max-width:900px` (CN-tab, r637/652/659) maar dit is niet systematisch.

### B6 — Hardgecodeerde kleuren naast tokens in per-tab CSS — MIDDEN
- De per-tab blokken (agenda r698+, toggl r802+, inbox r926+) gebruiken overal `var(--x, #fallback)` met afwijkende fallbacks EN losse hexes: `#faf9f6`, `#f5f5f5`, `#f0ece0`, `#FBF5E0`, `#f6f5f1`, `#f0ede4`, `#2A4A38` hardcoded (r803), `#c0392b` (r811), `#23402e` (r962). Deze wijken af van de canonieke tokens (`--green` = `#2A4A38`, maar inbox gebruikt `#23402e`). Dit is drift — dezelfde "groen" heeft drie waarden.

### B7 — Tab-balk: 14 tabs, platte lijst, geen groepering — MIDDEN
- `.tabs-wrap` (r75, r299-314) is één horizontale scroll-rij van 14 knoppen, gemengd met/zonder emoji, gemengde naamgeving ("Nieuwe factuur" vs "Factuur controle" vs "controle"-id). Op een laptop scrollt dit horizontaal; geen visuele groepering (Financieel / Productie / Tijd / Beheer). Cognitieve last hoog.

### B8 — Inline-style markup ondermijnt het systeem — MIDDEN
- Veel layout zit in `style="..."` attributen i.p.v. klassen: dashboard-grids (r324, r346, r358), CN-tabellen (r665-692 met herhaalde `padding:8px 10px;color:var(--text-dim);font-size:11px;text-transform:uppercase` per `<th>`), project-grid (r480). Dit maakt het systeem niet-afdwingbaar: elke nieuwe sectie kiest opnieuw zijn eigen spacing. De CN-tabel-`<th>` is letterlijk 6× dezelfde inline-regel die een `.data-table th`-klasse zou moeten zijn.

---

## 2. Voorgesteld spacing / typografie / layout-spec (tokens)

Toevoegen aan `:root` (r12-37). Alles additief — bestaande tokens blijven.

### Spacing-schaal — base 4px (8px-ritme als default-stap)
4px gekozen voor fijne controle bij dichte tabellen; de meeste paddings landen op 8/12/16/24.

```
--space-1: 4px;    /* hairline: icon-naar-tekst, badge-padding-y */
--space-2: 8px;    /* dense list-item, gap in toolbars */
--space-3: 12px;   /* input padding-y-equiv, compacte card-rijen */
--space-4: 16px;   /* standaard card-padding-y, veld-marge */
--space-5: 20px;   /* card-padding ruim */
--space-6: 24px;   /* sectie-afstand binnen een tab */
--space-8: 32px;   /* tussen grote blokken */
--space-12: 48px;  /* pagina-ritme, top/bottom van .main */
```
Mapping naar de bestaande GL-003-template-namen: `xs=4, sm=8, md=16, lg=24, xl=32, 2xl=48`.

### Typografie-schaal (line-heights erbij — nu ontbreken die op de meeste plekken)
Behoud de families (`--serif` Fraunces display/italic, `--sans` Figtree body, `--mono` DM Mono numeriek). Leg de schaal vast:

```
--text-display: 26px / 1.15   /* KPI-waarde, login-logo (nu 26/38px ad-hoc) */
--text-h1:      22px / 1.2    /* tab-paginatitel (nu 22px italic, r375) */
--text-h2:      17px / 1.3    /* card-subtitle (nu 17px, r86) */
--text-h3:      14px / 1.35   /* card h4 / sectiekop */
--text-body:    14px / 1.55   /* body — al body-default r38, vastleggen */
--text-sm:      13px / 1.5    /* inputs, knoppen, tabel-cel */
--text-label:   11px / 1.4    /* labels, card-title-caps (NIET lager) */
```
Regel: **niets onder 11px.** Vervang de 9-10px labels (r51 header-version 10px is ok als mono-meta; r227 kpi-label 9px → 11px; r834 tg-prio 9.5px → 10px max, alleen mono-badge).

### Layout / container
```
--container-max: 1400px;   /* .main krijgt max-width + margin-inline:auto */
--container-narrow: 920px; /* formulier-zware tabs (instellingen, CN, nieuwe factuur-form) */
```
`.main{max-width:var(--container-max);margin-inline:auto;padding:var(--space-8) var(--space-6)}`.

### Control-hoogtes (uniform — lost B4 op)
```
--control-h:    38px;  /* standaard input/select/btn hoogte */
--control-h-sm: 30px;  /* compacte filter/zoek/periode-controls */
--radius-sm: 6px;  (bestaat impliciet)
--radius:    10px; (bestaat, r34)
--radius-lg: 14px; (modal, bestaat impliciet r212)
```
Alle inputs/selects/knoppen op één rij delen `--control-h` zodat ze uitlijnen.

### Tabel-ritme (Jortt-gevoel)
```
--cell-py: 12px;  /* nu 7-8px → ruimer */
--cell-px: 12px;
--row-min-h: 44px; /* klik-target-norm */
```

---

## 3. Per-component aanbevelingen (nu → voorgesteld)

### Inputs (r97-99)
- Nu: `padding:9px 11px; background:var(--bg); font-size:13px`. Hoogte impliciet ~36px, geen vaste hoogte, focus-ring is goed (r98, 3px groen).
- Voorgesteld: `height:var(--control-h); padding:0 var(--space-3); background:var(--surface)` (lichter-dan-canvas oogt rustiger dan `--bg`). Focus-ring behouden — dat is al Toggl-waardig. `font-size:var(--text-sm)`.

### Dropdowns / select (KRITIEK — B1)
- Nu: erft input-stijl; **geen** `option`-kleur globaal; donkere Toggl-select heeft wit-op-onzichtbaar in de optielijst.
- Voorgesteld, één keer globaal toevoegen:
  ```
  select option, select optgroup{color:var(--text);background:var(--surface)}
  ```
  En de donkere Toggl-timer-select (r806) houdt `option{color:#222;background:#fff}` (r807 bestaat al — uitbreiden met `background`). Overweeg een custom chevron-icoon zodat de selects op alle browsers gelijk ogen.

### Knoppen (r106-118)
- Nu: 6 kleur-varianten + 2 maten, wisselende hoogtes.
- Voorgesteld: kern-set = `btn-primary` (groen, hoofdactie), `btn-gold` (creatie/positief accent), `btn-secondary` (neutraal), `btn-danger` (destructief). `btn-info`/`btn-purple` uitfaseren naar `btn-secondary` tenzij ze een echte semantiek dragen (dan documenteren in GL-003). Alle knoppen `height:var(--control-h)`, `btn-sm` → `--control-h-sm`. Houd `letter-spacing` en gewicht.

### Kaarten (r84-86)
- Nu: `padding:1.5rem; margin-bottom:1.25rem; radius 10; shadow`. Op zich goed, maar mengt met `padding:1rem`-varianten (r483) en `padding:3rem`-leegstaten.
- Voorgesteld: standaard `.card{padding:var(--space-5)}`, dichte variant `.card--tight{padding:var(--space-4)}`, lege/empty-state `.card--empty{padding:var(--space-12);text-align:center}`. Card-title (caps mono 10px → 11px) en card-subtitle (Fraunces italic 17px) behouden — dat is mooie hiërarchie, alleen size-token toepassen.

### Tabellen (v-table r184-188, materiaal-lijst r204-206, tg-tbl r846-848, CN inline r665+)
- Nu: 3 verschillende tabel-implementaties + 1 volledig inline-gestylede (CN). Celpadding 6-8px, hover-kleuren wisselen (`--gold-light` vs `#faf9f6`).
- Voorgesteld: één `.data-table` klasse: `th` mono-caps 11px op `--surface2`, `td` padding `var(--cell-py) var(--cell-px)`, rij min-hoogte 44px, één hover-token (`--surface2`), tabular-nums op getalkolommen. Vervang de inline CN-`<th>`-regels door `.data-table th`. Sticky `thead` voor lange lijsten.

### Modals (r211-214)
- Nu: `width:460px; padding:2rem; radius 14`. Goed startpunt.
- Voorgesteld: `max-width:480px; width:calc(100vw - var(--space-8)); padding:var(--space-6)`. Voeg een vaste header-rij toe (titel + ✕, nu zit ✕ los in markup r4048). Body-scroll bij lange modals. Behoud de backdrop-blur (mooi, rustig).

### Tab-nav (r75-80, r299-314) — B7
- Nu: 14 platte knoppen, horizontale scroll, gemengde emoji/naamgeving.
- Voorgesteld (laag-risico, additief): visuele groepering met subtiele scheiders/labels in dezelfde balk — **Financieel** (Dashboard, Inbox, Nieuwe factuur, Factuur controle, Geschiedenis) · **Productie** (Projecten, Klanten, Voorraad, Bestellijst, CompaNanny) · **Tijd** (Agenda, Toggl) · **Beheer** (Instellingen, Migratie). Uniformeer naamgeving (consistent wel/niet emoji; "Nieuwe factuur" / "Factuur controle" zijn ok, maar de `id`'s `verwerk`/`controle` blijven intern). Verklein `padding:14px 18px` → token, en zet `position:sticky` op de balk onder de header voor permanente navigatie.

### KPI-cards (r225-231)
- Nu: `kpi-label` 9px (te klein), `kpi-waarde` Fraunces 26px (mooi). Dashboard-rij is een inline `repeat(4,1fr)` (r324).
- Voorgesteld: label → 11px token; behoud de 26px display-waarde; vervang inline grid door `.kpi-grid` (bestaat al r225 met `auto-fill minmax(160px,1fr)` — gebruik die i.p.v. de harde `repeat(4,1fr)` voor responsive gedrag).

### Status-bars / badges (r88-92, r120-127)
- Consistent en semantisch — dit is goed werk. Alleen: badge font 10px → 10-11px, en de status-kleuren vastleggen als `--color-success/warning/error/info` tokens in GL-003 (nu los: `--green`, `--gold`, `--red`, `--blue`).

---

## 4. GL-003-gaten (wat moet bijgeschreven)

GL-003 staat op dit moment **volledig leeg** — alle zes secties tonen nog `<placeholder>`-waarden. De cockpit draait dus al maanden op een de-facto design-system dat nergens is vastgelegd. De waarden bestaan (in `:root`, r12-37); ze zijn alleen niet gecodificeerd.

Per sectie:

1. **Identity** — leeg. Brand: "Mortise & Tenon" (canoniek met spaties rond `&`, zie r263/278). Voice/audience nog niet gepind. → **vraag Bart**.
2. **Color palette** — leeg in GL-003, maar volledig aanwezig in `:root`. Kandidaat-tokens: `--green #2A4A38` (primary), `--gold #B8962E` (accent/CTA), neutrals-ramp `--bg #F7F5F0 → --text #1C1A16`, status `--green/--gold/--red #8B1A1A/--blue #1a3a8b`. → **kan ik documenteren zodra Bart de intenties bevestigt** (welke is "primary" vs "accent"). Let op drift B6: `#23402e` (inbox) vs `#2A4A38` (canoniek) moet één waarde worden.
3. **Typography** — leeg. Aanwezig: Fraunces (display/italic), Figtree (body), DM Mono (numeriek/meta). Schaal ontbreekt overal → voorstel in §2. → **kan ik documenteren**.
4. **Spacing scale** — leeg én ontbreekt volledig in de code. Dit is het grootste gat: er IS geen schaal. → **§2-voorstel invullen na Bart-OK op base-unit (4px advies)**.
5. **Imagery style** — leeg. App gebruikt emoji als iconen (📊📥⏱️ etc.), geen icoon-familie. → **aanbeveling: kies één line-icon-familie (Lucide/Tabler) i.p.v. emoji voor rust/consistentie; Pixel-terrein, maar familie-keuze hoort in GL-003**.
6. **Voice samples** — leeg. UI-microcopy is NL, informeel-zakelijk ("stel me een vraag?", "Sleep een factuur PDF hier naartoe"). → **vraag Bart om 3 voice-samples**.

**Belangrijk procespunt:** ik mag GL-003 niet unilateraal vullen — elke waarde komt van Bart (asks → Bart picks → Iris writes). De code-waarden zijn sterke kandidaten, maar de *intenties* (welke kleur is "de brass-moment", wat is de voice) moeten van Bart komen. Voorstel: korte guided sessie (SOP-009) waarin we de bestaande `:root`-waarden formaliseren + de spacing-schaal nieuw vastleggen. Dat is 15 min en sluit de drift.

---

## 5. Implementatie-volgorde voor Larry (impact × risico)

Alles additief; factuur-flow (verwerk/controle/boeken) mag NIET breken. Volgorde van grootste impact/laagste risico naar specifieker:

**Stap 1 — Dropdown-fix (B1).** Eén globale regel `select option,select optgroup{color:var(--text);background:var(--surface)}` + `background:#fff` op de Toggl-timer-option. Lost Barts actieve klacht op. Nul layout-risico. **Doe dit eerst, los, vandaag.**

**Stap 2 — Spacing- + control-hoogte-tokens in `:root` (B2/B4).** Voeg `--space-*`, `--control-h`, `--text-*`, `--container-max` toe aan `:root` (r12-37). Puur additief — niets verandert tot je ze toepast. Hierna kun je per component vervangen.

**Stap 3 — Container-breedte + .main-ritme (B5).** `.main{max-width:var(--container-max);margin-inline:auto}`. Eén regel, grote ruimtelijke winst, laag risico (grids passen zich aan).

**Stap 4 — Inputs/selects/knoppen op `--control-h` (B4).** Uniformeer hoogtes globaal (r97, r106, r166, r171, r174). Test de periode-bar en filter-bars visueel. Midden-risico (rij-uitlijning).

**Stap 5 — Tabel-ritme + één `.data-table`-klasse (B3/B8).** Verhoog celpadding naar 12px, rij-min 44px. Refactor de inline CN-tabel-`<th>` naar de klasse. Raakt veel tabs visueel — doe na 1-4, test per tab.

**Stap 6 — Tab-nav groepering + sticky (B7).** Visuele groepering + sticky balk. Cosmetisch, geen logica. Laag risico.

**Stap 7 — Knop-varianten uitdunnen (B4) + per-tab kleur-drift opruimen (B6).** Map `btn-info/btn-purple` → `secondary`; vervang hardcoded hexes door tokens in agenda/toggl/inbox-blokken. Laatste omdat het cosmetisch fijnslijpen is.

**Parallel/los van bovenstaande:** GL-003 guided sessie met Bart (§4) — codificeert de tokens zodat Charta/Pixel en toekomstige wijzigingen één bron hebben. Doe vóór of tegelijk met stap 2 zodat de nieuwe spacing-schaal meteen in GL-003 landt.

---

## Downstream-impact
- GL-003 §Color/§Typography/§Spacing: nog leeg → zodra gevuld zijn er (nu) geen Charta/Pixel-deliverables in flight die ge-re-rendert moeten worden; de impact is dat tóékomstige creative output meteen consistent is met de cockpit.
- De cockpit zelf (`index.html`) is geen Charta/Pixel-deliverable maar Larry's bouwwerk; de tokens hierboven zijn de brug zodat code en GL-003 niet verder uit elkaar lopen.

## Wat NIET aangeraakt is
- `index.html` is ongewijzigd (review-only, conform opdracht).
- Geen klantnamen/secrets in dit document (repo is public).
- Visuele finish (definitieve kleur-tweaks, icoon-set-implementatie) ligt bij Pixel.
