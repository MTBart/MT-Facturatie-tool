# 🔒 REPO-VEILIGHEID — in één oogopslag

> **Deze repo is PUBLIC.** `https://github.com/mtbart/MT-Facturatie-tool`
> Live (GitHub Pages): `https://mtbart.github.io/MT-Facturatie-tool/`
> Alles wat je commit is **wereldwijd zichtbaar en blijft in de git-historie**, ook na verwijderen.

Laatste audit: **2026-06-02** — status: ✅ **schoon**.

---

## De twee sloten (zo kan het nooit fout gaan)

| Slot | Bestand | Wat het doet |
|---|---|---|
| 1. Negeren | `.gitignore` | Houdt secret/PII-bestanden uit `git add` (ook bij `git add -A`). |
| 2. Blokkeren | `githooks/pre-commit` | Breekt de **commit** af als er tóch een verboden bestand of token-string gestaged staat. Version-controlled via `core.hooksPath=githooks`. |

**Na een re-clone één keer activeren:** `git config core.hooksPath githooks`

Bewust iets door slot 2 forceren kan alleen expliciet met `git commit --no-verify` — doe dat nooit zonder reden.

---

## Waar staat wat — en staat het goed?

| Categorie | Locatie | Staat | ✓ |
|---|---|---|---|
| **Echte secrets** (tokens, keys) | `C:\Users\BartWitte\.mt-secret\` (BUITEN de repo, buiten OneDrive) | nooit in git | ✅ |
| De tool zelf | `index.html` + `uren.html` (oude `index-v3/v4.html` gearchiveerd) | PUBLIC — bewust | ✅ |
| Klant-registry | worker `/klanten` (KV `klanten:registry`), na login — sinds F5 (11-10-2026) **niet meer** in de repo; `data/klanten.json` staat in `.gitignore` | privé | ✅ |
| Claude-context | `Claude-context/*` (STATUS.md, projecten.md, … met klant- en persoonsgegevens) — sinds F5 stap 1 niet meer in git; lokaal bewaard; alleen `toggl2-api-bewezen.md` (Toggl-contract) blijft getrackt; pre-commit blokkeert de rest | lokaal, genegeerd + geblokkeerd | ✅ |
| Klantnamen in scripts | `nieuw-project.ps1` / `create-project-structure.ps1` lezen de koppeling uit lokale `data/klant-zoektermen.json` of `data/klanten.json` (beide genegeerd); zonder die bestanden een neutraal voorbeeld | lokaal | ✅ |
| CHANGELOG.md | wordt door de pre-commit-hook opgebouwd via `tools/changelog.js` met lokale woordenlijsten (`data/klanten.json`, `data/klanten-historie.txt` = alles wat ooit in de lijst stond, `data/privacy-termen.txt`); fail closed: bij een fout of zonder lijst blijft de oude staan | lokaal, genegeerd | ✅ |
| Back-up van de live site | `backup/` — `tools/backup-roteer.py` neutraliseert de klantenregistry in de kopie | public, geneutraliseerd | ✅ |
| Privé-notities | `CLAUDE.local.md`, `.claude/memory/`, `.claude/STATUS.md`, `.claude/SESSIE_SAMENVATTING.md`, `HANDOFF.md` | lokaal, genegeerd + geblokkeerd in pre-commit | ✅ |
| Klant-PII | `moneybird-contacten.json/.md`, `CRM/`, `Moneybird/` | genegeerd, nooit gecommit | ✅ |
| Uren/Toggl-data | `Toggl/` | genegeerd | ✅ |
| Vergaderdata | `Vergaderingen/` | genegeerd | ✅ |
| Env/credentials | `*.env`, `*token*.json`, `*.key`, `*.pem`, `config.json` | genegeerd (breed patroon) | ✅ |
| Agent-config | `Agents/agent_config.json` | PUBLIC — gecheckt, **bevat geen secret** | ✅ |
| Runtime-rommel | `_backups/`, `Agents/*` logs, `.wrangler/` | genegeerd | ✅ |

**Echte secrets staan dus uitsluitend in `~/.mt-secret\`:** `google-token.json`, `google-client.json`, `moneybird.json`, `toggl.json`, `mt-outlook-user-token.json`. Die map zit buiten de repo én buiten OneDrive — kan niet meegesynct of meegecommit worden.

---

## Zelf controleren (1 commando)

Vanuit de repo-map:

```bash
git ls-files | grep -iE '\.env|secret|token|credential|moneybird-contacten|\.key$|\.pem$|(^|/)(CRM|Toggl|Vergaderingen|Moneybird)/' ; \
git grep -lE 'eyJ0eXAiOiJKV1Q|ghp_[A-Za-z0-9]{20}|sk-ant-|-----BEGIN [A-Z ]*PRIVATE KEY-----|"refresh_token"' -- '*.html' '*.js' '*.json' '*.md' '*.py'
```

**Geen output = schoon.** (Enige verwachte uitzondering: niets — `agent_config.json` matcht niet meer want we filteren op echte secret-namen.)

De guard test je met:
```bash
echo '{"refresh_token":"1.fake"}' > _t.json && git add -f _t.json && git commit -m x ; git restore --staged _t.json && rm _t.json
```
→ moet `🛑 COMMIT GEBLOKKEERD` tonen.

---

## Bij twijfel
Een nieuw bestand met een token, wachtwoord, klant-PII of een `.env`? → **niet committen.** De `.gitignore` vangt de bekende patronen; staat jouw geval er niet bij, voeg de regel toe vóór je commit. Vuistregel: *zou een vreemde dit op internet mogen zien?* Zo nee → het hoort in `~/.mt-secret\` of in de `.gitignore`.
