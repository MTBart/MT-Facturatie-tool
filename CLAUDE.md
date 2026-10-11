# CLAUDE.md — MT-bedrijfstool

Dit is de instructiehub voor Claude (Cowork, Claude Code, Claude Desktop, Claude Mobile).
Klein gehouden zodat het in elke chat past zonder tokens te vreten.
Specifieke kennis staat één laag dieper in `Claude-context/` — daar lezen op aanvraag. Die map staat **alleen lokaal**
(niet in git: bevat klant- en persoonsgegevens); in een verse clone ontbreekt hij.

**Privé-deel (bedrijf, team, communicatie, werkafspraken, paden):** `CLAUDE.local.md` — alleen lokaal, staat in
`.gitignore`, hoort nooit in de repo (die is nog publiek).

@CLAUDE.local.md

> **Routes (repo-paden, push, Worker-deploy):** zie [`ROUTES.md`](ROUTES.md). Releases: [`RELEASE.md`](RELEASE.md).
> Wat nooit in de repo mag: [`REPO-VEILIGHEID.md`](REPO-VEILIGHEID.md).

---

## Index — waar vind je wat

| Vraag gaat over | Lees |
|---|---|
| Facturen, BTW, grootboek, klanten in Moneybird, leveranciers-categorie, debiteuren | `Claude-context/moneybird.md` |
| Project aanmaken, naamgeving, klantcodes, vaste klanten, mapstructuur 01..09, migratie | `Claude-context/projecten.md` |
| uren.html, planning, kanban, timeline, taken, weekafsluiting, Vectorworks-import | `Claude-context/uren-tool.md` |
| Platen, kantenband, lak/spuit, voorraad, bestellijst, "altijd bestellen" lijst | `Claude-context/materiaal.md` |
| Vectorworks → Holzher flow, NCR/PGMX/HHA, plaattelling, CNC, stickers | `Claude-context/productie.md` |
| Welke scripts/servers er zijn, wat doen ze, wat is dood, wat moet weg | `Claude-context/tooling.md` |
| Wat doen we nu, openstaand werk, recente wijzigingen | `Claude-context/STATUS.md` |

**Regel:** zodra een vraag duidelijk in een bovenstaande categorie valt → eerst de ctx lezen, dán antwoorden. Niet uit eigen geheugen putten — de IDs/codes/lijsten daar zijn de bron van waarheid. Waarschuw als je werkt met info die mogelijk verouderd is.

---

## Token- en model-discipline

**Default model: Sonnet.**
- **Haiku** voor: snelle samenvattingen, classificatie, simpele lookup-vragen, tekstcorrectie.
- **Sonnet** voor: gewone code-edits, ctx-bestanden lezen + samenvatten, gewone gesprekken.
- **Opus** alleen voor: zware synthese, architectuur-beslissingen, complexe debugging, strategische voorstellen.

**Werkwijze die tokens spaart:**
1. **Bestand >500 regels lezen** → delegeer naar Sonnet-subagent (Agent tool), laat die samenvatten, doe synthese zelf.
2. **Edits** → altijd `Edit` (str_replace), nooit `Write` op grote files. `v2.html`, `mobiel.html` en `uren.html` zijn te groot om te herschrijven.
3. **Onbekend probleem** → eerst STATUS.md + relevante ctx, daarna pas de bron.
4. **Skills/scheduled tasks** voor herhaalbaar werk — niet elke keer de wielen opnieuw uitvinden.
5. **Status tussentijds updaten** zodat de volgende sessie het weet.

---

## De live tool
- **GitHub repo:** `mtbart/MT-Facturatie-tool` (wordt privé na de verhuizing, zie het F5-plan)
- **Live URL:** https://mtbart.github.io/MT-Facturatie-tool/ (cockpit `v2.html`, mobiel `mobiel.html`)
- **Nieuw adres (F5, nog niet actief):** https://tool.mortiseandtenon.nl (Cloudflare Pages-project `mt-tool`)
- **uren-tool live:** https://mtbart.github.io/MT-Facturatie-tool/uren.html
- **Worker:** `mt-claude-proxy.bart-a12.workers.dev` (bron: `worker.js`; deploy via wrangler, zie ROUTES.md)
- **Klantenlijst:** na login via de worker (`/klanten`), niet meer als bestand in de repo.
