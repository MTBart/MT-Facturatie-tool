# Visuele-afwerking audit — M&T cockpit (Pixel)

> Scope: kleur, oppervlakken, diepte, type-styling, component-look. Layout/structuur = Iris (parallel).
> Status: **review-only**. `C:\MT\index.html` is NIET aangepast. Repo is public → geen klant/secret-waarden hierin.
> Bron van waarheid is hier de **CSS in `index.html`** (`:root` regel 12-37 + 4 style-blokken). GL-003 is leeg (alle placeholders) — zie gap onderaan.

---

## 0. Belangrijke gap vooraf

`GL-003-design-system.md` staat **volledig op placeholders** (`<#hex>`, `<your brand name>`). Het echte M&T-palet leeft alleen in de code. Deze audit werkt daarom in geflagde **neutral-style fallback-modus**, verankerd op de bestaande code-tokens (groen `#2A4A38`, goud `#B8962E`, warm-papier neutrals). **Aanbeveling: Iris laat het hieronder voorgestelde token-systeem als GL-003 §2 + §3 vastleggen zodra Bart het goedkeurt**, zodat code en design-system synchroon lopen.

---

## 1. Toggl/Jortt-principes die we overnemen

Gedestilleerd uit Toggl Track en Jortt (NL boekhoud-SaaS), 6 concrete principes:

1. **Eén rustig canvas, veel witruimte.** Toggl/Jortt laten oppervlakken "ademen": grote padding, weinig randen, content drijft op een egale lichte achtergrond. Onze UI heeft nu op bijna elk blok een `border + shadow + radius` tegelijk → te veel "dozen in dozen".
2. **Diepte via zachte schaduw OF lichte rand — niet beide.** Toggl-kaarten hebben een hairline-rand en nagenoeg geen schaduw; verheffing komt van een minimale shadow op hover. Wij stapelen `border:1px + box-shadow` standaard op elke `.card`.
3. **Eén accentkleur, spaarzaam ingezet.** Toggl = rustig grijs/wit met één accent (paars/roze) voor de actieve staat en primaire actie. Wij hebben nu **6 accent-families** los rondslingeren (gold, green, red, blue, purple, orange) als knop- en badge-varianten → druk en willekeurig.
4. **Status = betekeniskleur, niet decoratie.** Jortt gebruikt kleur alleen voor betekenis (groen=betaald, rood=open). Onze blue/purple/orange-knoppen zijn decoratief; die horen semantisch (info/secondary) te zijn, niet als merk-accent.
5. **Strakke, leesbare tabellen.** Toggl/Jortt: horizontale hairlines, rustige header (geen zware 2px-borders), zebra optioneel maar subtiel, getallen rechts uitgelijnd met tabular-nums. Wij hebben `border-bottom:2px` headers + hover-tint die per tabel verschilt (`gold-light` vs `green-light`).
6. **Zichtbare maar zachte focus-states.** Beide producten geven inputs een duidelijke focus-ring in de accentkleur. Wij hebben dit globaal goed (regel 98) maar inconsistent in tab-specifieke selects (sommige hebben alleen `border-color`, geen ring) — en de **option-tekstkleur is nergens globaal gezet** → bron van de onzichtbare-dropdown-bug.

---

## 2. Voorgesteld kleur-token-systeem

Respecteert de bestaande M&T-merkkleuren (groen + goud + warm papier), maar:
- maakt **één** semantisch laag (accent / neutrals 50-900 / status / surfaces / borders / shadow),
- vervangt de losse `blue/purple/orange` merk-hexes door **status-rollen** (die knoppen blijven werken, maar krijgen betekenis),
- voegt de ontbrekende ladder-stappen toe zodat alles uit tokens komt i.p.v. ad-hoc hex (`#1e3829`, `#7a6010`, `#faf9f6`, `#f0ede4` enz. staan nu hardcoded verspreid).

```css
:root{
  /* ── MERK-ACCENTEN ── */
  --green:#2A4A38;        /* primair merk — primaire actie, actieve staat, headings-accent */
  --green-700:#1E3829;    /* hover/donker (verving losse #1e3829) */
  --green-900:#162D20;    /* header-gradient eind */
  --green-mid:#4A7A5C;    /* secundair groen, subtiele iconen */
  --green-50:#E6EFE9;     /* groen-tint vlak (was --green-light) */
  --green-100:#D3E4DA;    /* groen rand op tint-vlakken (verving #c0d8c8 / #b8d4c8) */

  --gold:#B8962E;         /* enige decoratieve accent — actieve onderstreping, focus, highlight */
  --gold-700:#9A7D24;     /* gold hover */
  --gold-mid:#E8D48A;     /* gold rand */
  --gold-50:#FBF5E0;      /* gold-tint vlak (was --gold-light) */
  --gold-text:#7A6010;    /* leesbare goud-tekst op gold-50 (verving losse #7a6010/#7a6a2e) */

  /* ── NEUTRALS (warm-papier ladder 50→900) ── */
  --n-0:#FFFFFF;          /* puur wit — inputs, reader-paneel */
  --n-50:#FDFCF9;         /* surface (was --surface) */
  --n-100:#F7F5F0;        /* page bg (was --bg) */
  --n-150:#F2EFE8;        /* surface-2 / zebra / gedempt vlak (was --surface2) */
  --n-200:#E8E4DC;        /* lichte hairline binnen tabellen (verving #f0f0f0/#f1f0ec/#eee mix) */
  --n-300:#E2DDD4;        /* standaard border (was --border) */
  --n-400:#C8C0B0;        /* sterke border / dashed (was --border-strong) */
  --n-500:#A8A090;        /* faint text / placeholder (was --text-faint) */
  --n-600:#6B6455;        /* dim/secundaire text (was --text-dim) */
  --n-800:#3A352B;        /* sub-headings */
  --n-900:#1C1A16;        /* body/heading high-contrast (was --text) */

  /* ── STATUS (betekenis, niet decoratie) ── */
  --success:#2F6B45;      /* betaald/ok — iets levendiger dan merkgroen voor onderscheid */
  --success-50:#E6EFE9;
  --warning:#B8762E;      /* let-op — warm oranje-goud, los van merk-gold */
  --warning-50:#FBF0E0;
  --error:#8B1A1A;        /* fout/open (was --red) */
  --error-50:#FDE8E8;     /* (was --red-light) */
  --info:#1A3A8B;         /* neutrale info (was --blue) */
  --info-50:#E8EDFB;      /* (was --blue-light) */

  /* ── SURFACES & DIEPTE ── */
  --surface:var(--n-50);          /* default kaart */
  --surface-sunken:var(--n-150);  /* ingezonken vlak (filters, code, stat-bar) */
  --surface-overlay:var(--n-0);   /* modals, dropdowns, reader */
  --border:var(--n-300);
  --border-hair:var(--n-200);     /* binnen-tabel hairlines */
  --border-strong:var(--n-400);
  --focus-ring:0 0 0 3px rgba(42,74,56,.14);   /* groen, iets zichtbaarder dan nu .08 */
  --focus-ring-gold:0 0 0 3px rgba(184,150,46,.22);

  /* schaduw-ladder: rust = bijna geen shadow; verheffing alleen bij overlay/hover */
  --shadow-none:none;
  --shadow-sm:0 1px 2px rgba(44,40,28,.05);
  --shadow-card:0 1px 3px rgba(44,40,28,.06);   /* veel zachter dan huidige 0 2px 16px */
  --shadow-pop:0 8px 28px rgba(44,40,28,.12);   /* modals/dropdowns */

  --radius-sm:6px;
  --radius:8px;        /* iets strakker dan huidige 10px */
  --radius-lg:12px;    /* modals */

  --mono:'DM Mono',monospace;
  --serif:'Fraunces',serif;
  --sans:'Figtree',sans-serif;
}
```

**Belangrijkste wijzigingen t.o.v. nu:**
- `--purple/--orange` als merk-accent **vervallen** → de twee knoppen die ze gebruiken (`.btn-purple`, en `--orange` in `.badge-warn`) gaan naar `--info` / `--warning`. Minder kleuren, meer betekenis.
- Alle losse hardcoded grijzen (`#faf9f6`, `#f0f0f0`, `#f1f0ec`, `#eee`, `#fafafa`, `#f0ede4`) → één ladder (`--n-150/200`). Dit alleen al haalt veel "ruis" weg.
- `--shadow` van `0 2px 16px / .08` → `--shadow-card 0 1px 3px / .06`. Dit is dé grootste rust-winst: kaarten worden plat en strak i.p.v. zwevend.

---

## 3. Component-styling-spec (nu → voorgesteld)

### 3.1 Kaarten (`.card`, `.kpi-card`, `.project-kaart`, `.grafiek-wrap`, `.tg-card`)
**Nu** (regel 84): `border:1px + box-shadow:0 2px 16px + radius:10px` op élke kaart → dubbele diepte.
**Voorgesteld** — rand óf schaduw, niet beide; verheffing op hover:
```css
.card{
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:var(--radius);
  padding:1.5rem;margin-bottom:1.25rem;
  box-shadow:var(--shadow-none);            /* plat in rust */
  transition:box-shadow .15s,border-color .15s;
}
.card:hover{box-shadow:var(--shadow-card)}  /* optioneel; weglaten voor statische kaarten */
.kpi-card{box-shadow:var(--shadow-card)}    /* KPI's mogen lichte lift houden */
```
`.project-kaart:hover` gebruikt nu `box-shadow:0 4px 20px rgba(184,150,46,.12)` (goud-glow) → vervang door `border-color:var(--gold);box-shadow:var(--shadow-card)` — subtieler, Toggl-achtig.

### 3.2 Knoppen (`.btn` + varianten, regel 106-118)
**Nu:** 7 varianten, elk met eigen kleur + losse shadow; geen focus-state.
**Voorgesteld** — 3 hoofdvarianten (primary/secondary/ghost) + status-varianten alleen waar semantisch; overal een zichtbare focus-ring:
```css
.btn{display:inline-flex;align-items:center;gap:6px;padding:9px 16px;
  border-radius:var(--radius-sm);border:1px solid transparent;cursor:pointer;
  font:600 13px/1 var(--sans);letter-spacing:.01em;transition:all .15s}
.btn:focus-visible{outline:none;box-shadow:var(--focus-ring)}

.btn-primary{background:var(--green);color:var(--n-100);box-shadow:var(--shadow-sm)}
.btn-primary:hover{background:var(--green-700)}

.btn-secondary{background:var(--surface);border-color:var(--border-strong);color:var(--n-900)}
.btn-secondary:hover{background:var(--surface-sunken)}

.btn-ghost{background:transparent;color:var(--n-600)}        /* nieuw: voor icoon/nav-knoppen */
.btn-ghost:hover{background:var(--surface-sunken);color:var(--n-900)}

.btn-gold{background:var(--gold);color:var(--n-900);box-shadow:var(--shadow-sm)}
.btn-gold:hover{background:var(--gold-700)}
.btn-gold:focus-visible{box-shadow:var(--focus-ring-gold)}

/* status-knoppen: alleen voor echte acties met betekenis */
.btn-danger{background:var(--error-50);color:var(--error);border-color:#F5C5C5}
.btn-info{background:var(--info-50);color:var(--info);border-color:#B5C5F5}
/* .btn-purple → migreren naar .btn-info of .btn-ghost */
```
Reductie van 7 → effectief 4 visuele gewichten. Goud blijft de "speciale" actie (sync/AI), groen de primaire.

### 3.3 Inputs & selects — incl. dropdown-fix
**Nu** (regel 97-98): globaal `input,select,textarea{color:var(--text);background:var(--bg)}` met groene focus-ring. **Maar `option`-elementen krijgen nergens globaal een kleur**, en dark-context selects (toggl-timerbar regel 806: witte tekst op translucent vlak) laten hun `option` óf wit-op-wit zien (alleen regel 807 patcht dit lokaal). Dáár zat de onzichtbare-dropdown-tekst.
**Voorgesteld** — globale, expliciete option-kleur + zichtbare focus-ring + custom chevron zodat selects niet "leeg" ogen:
```css
input,select,textarea{
  width:100%;padding:9px 11px;
  border:1px solid var(--border);border-radius:var(--radius-sm);
  background:var(--n-0);color:var(--n-900);          /* wit vlak ipv --bg → meer contrast */
  font:400 13px var(--sans);outline:none;
  transition:border-color .15s,box-shadow .15s}
input:focus,select:focus,textarea:focus{
  border-color:var(--green);box-shadow:var(--focus-ring)}
input::placeholder,textarea::placeholder{color:var(--n-500)}

/* DROPDOWN-FIX: opties altijd leesbaar, ongeacht context */
select option,select optgroup{color:var(--n-900);background:var(--n-0)}

/* custom chevron zodat selects herkenbaar/strak zijn (Toggl/Jortt-look) */
select{
  appearance:none;-webkit-appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6455' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 10px center;padding-right:30px}
```
Voor de dark toggl-timerbar select: laat het vlak/de tekst wit, maar dwing **altijd** `option{color:var(--n-900);background:#fff}` (nu globaal gedekt door bovenstaande regel — de losse patch op 807 mag blijven of vervallen).

### 3.4 Tabellen (`.v-table`, `.materiaal-lijst`, `.tg-row`, agenda-lijst)
**Nu:** headers met `border-bottom:2px solid var(--border)` + hover-tint die per tabel verschilt (`gold-light` in v-table, `green-light` op actief).
**Voorgesteld** — rustige header, hairline-rijen, één hover-tint, getallen tabular:
```css
.v-table th,.materiaal-lijst th{
  text-align:left;padding:9px 10px;
  font:500 10px var(--mono);text-transform:uppercase;letter-spacing:.06em;
  color:var(--n-500);
  background:var(--surface-sunken);
  border-bottom:1px solid var(--border)}     /* 2px → 1px */
.v-table td{padding:9px 10px;border-bottom:1px solid var(--border-hair)}
.v-table tbody tr:hover td{background:var(--n-150)}   /* neutraal, niet goud */
.v-table tr.actief td{background:var(--green-50)}
.v-table td.num{text-align:right;font-variant-numeric:tabular-nums}
```
Zebra optioneel: `.v-table tbody tr:nth-child(even) td{background:rgba(0,0,0,.012)}` — héél subtiel, Toggl-stijl.

### 3.5 Tab-nav (`.tab-btn`, `.tg-subtab`, `.vtab-btn`)
**Nu** (regel 76-78): al dicht bij Toggl (onderstreping in goud, actief in groen). Goed. Kleine verfijning — meer ademruimte + duidelijker inactief:
```css
.tab-btn{padding:14px 18px;font:500 13px var(--sans);color:var(--n-500);
  border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s,border-color .15s}
.tab-btn:hover{color:var(--n-800)}
.tab-btn.active{color:var(--green);border-bottom-color:var(--gold);font-weight:600}
```
De drie subtab-systemen (`.tab-btn`, `.tg-subtab`, `.vtab-btn`) zijn nu near-duplicaten met losse `#ddd/#e2e2e2`-borders → laat ze allemaal `var(--border)` + `var(--n-500/green/gold)` delen.

### 3.6 Modals (`.modal`, regel 212)
**Nu:** `radius:14px + shadow-lg (0 8px 40px /.14)`.
**Voorgesteld:** `border-radius:var(--radius-lg)` + `box-shadow:var(--shadow-pop)` + overlay-dim. Iets minder zware schaduw, strakkere radius. Voeg een rustige backdrop toe (`background:rgba(28,26,22,.35)` op `.modal-overlay`) als die nog niet bestaat.

### 3.7 Chips / badges (`.badge-*`, `.lev-chip`, `.tg-pill`, `.ag-chip`, `.filter-btn`)
**Nu:** badge-familie volgt de 6 kleuren; chips gebruiken losse `#f0ede4`/`#f3f0e8`-vlakken.
**Voorgesteld** — chips op één gedempt vlak, badges op status-tokens:
```css
.badge{font:500 10px var(--mono);padding:2px 8px;border-radius:20px;letter-spacing:.03em}
.badge-ok{background:var(--success-50);color:var(--success)}
.badge-gold{background:var(--gold-50);color:var(--gold-text);border:1px solid var(--gold-mid)}
.badge-warn{background:var(--warning-50);color:var(--warning)}
.badge-danger{background:var(--error-50);color:var(--error)}
.badge-info{background:var(--info-50);color:var(--info)}
.lev-chip,.tg-pill{background:var(--surface-sunken);border:1px solid var(--border);color:var(--n-600)}
.filter-btn.active{background:var(--green);color:var(--n-100);border-color:var(--green)}
```

---

## 4. Quick wins (5 — hoogste impact, laagste risico)

| # | Fix | Waar | Impact |
|---|---|---|---|
| 1 | **Dropdown-fix**: voeg `select option{color:#1C1A16;background:#fff}` globaal toe | na regel 98 | Lost de onzichtbare dropdown-tekst overal in één keer op. Nul risico, puur additief. |
| 2 | **Kaart-schaduw verzachten**: `--shadow:0 2px 16px rgba(44,40,28,.08)` → `0 1px 3px rgba(44,40,28,.06)` | regel 35 | Hele UI oogt direct rustiger/strakker; alle `.card/.kpi-card/.project-kaart/.grafiek-wrap` erven dit. |
| 3 | **Zichtbare knop-focus**: voeg `.btn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(42,74,56,.14)}` toe | na regel 106 | Toetsenbord-toegankelijkheid + professionele afwerking. |
| 4 | **Tabel-headers verzachten**: `border-bottom:2px` → `1px` in `.v-table th` en `.materiaal-lijst th` | regel 185, 205 | Tabellen worden meteen lichter/Jortt-achtig. |
| 5 | **Eén hover-tint in tabellen**: `.v-table tr:hover td{background:var(--gold-light)}` → `var(--surface2)` | regel 187 | Haalt de drukke goud-flits weg; consistent met de rest. |

Alle vijf zijn additief of een 1-regel-waardewijziging — niets aan structuur/JS.

---

## 5. Implementatie-volgorde voor Larry (additief, niets breken)

**Fase A — Quick wins (los, omkeerbaar):** de 5 fixes hierboven. Elk afzonderlijk deploybaar, geen afhankelijkheden. Begin hier; visueel meteen merkbaar.

**Fase B — Token-laag uitbreiden (additief):** voeg de **nieuwe** tokens uit §2 toe aan `:root` (n-ladder, status, surfaces, shadow-ladder, focus-ring) **naast** de bestaande. Niets verwijderen — bestaande `--bg/--surface/--border` blijven werken. Zet de oude tokens als alias: `--bg:var(--n-100); --surface:var(--n-50); --border:var(--n-300);` enz. Hierdoor verandert er visueel niets, maar alles wijst voortaan naar de ladder.

**Fase C — Componenten herbedraden:** per component-groep uit §3 de regels overzetten naar de nieuwe tokens. Volgorde op risico: knoppen → inputs/selects → kaarten → tabellen → tab-nav → modals → chips. Eén groep per commit, visueel verifiëren in elke tab (let op `#tab-toggl` dark-context).

**Fase D — Opruimen:** losse hardcoded hexes (`#faf9f6`, `#f0f0f0`, `#1e3829`, `#7a6010`, `#f0ede4`…) vervangen door tokens; `--purple/--orange` merk-hexes en `.btn-purple` migreren naar `--info`. Pas hier verwijder je oude waarden — als laatste, als alles aantoonbaar via aliassen loopt.

**Fase E — GL-003 synchroniseren:** Larry routeert naar **Iris** om het §2-tokensysteem + §3-typografie (Fraunces serif / Figtree sans / DM Mono) als officieel design-system vast te leggen, zodat code en GL-003 niet meer uiteenlopen.

---

## Geflagde GL-003-gap
GL-003 §2 (kleur) en §3 (typografie) staan op placeholders. Deze audit draaide in **neutral-style fallback** verankerd op de code-tokens. Revisit zodra Iris het bovenstaande systeem in GL-003 vastlegt.

## Bronnen
- [Toggl Track UI/UX patterns — SaaSUI](https://www.saasui.design/application/toggl-track)
- [Color System for Toggl Track — Uxcel](https://app.uxcel.com/showcase/color-system-for-toggl-track-853)
- [Jortt — factuur-uiterlijk/huisstijl](https://www.jortt.nl/factuur-maken/factuur-maken-uitleg/factuur-uiterlijk/)
- [Jortt boekhoudprogramma](https://www.jortt.nl/boekhoudprogramma/)
