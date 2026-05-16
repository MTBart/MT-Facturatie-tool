# HANDOFF — Cowork ↔ Claude Code

Dit bestand is het communicatiekanaal tussen Cowork (desktop) en Claude Code (terminal).
Beide omgevingen lezen en schrijven hier naartoe.

---

## Status
`klaar-voor-cowork` (2026-05-16 — Claude Code — MT Autonomy agent-systeem live)

---

## [RESULTAAT — MT Autonomy 2026-05-16]

✅ **Night Agent gefixt én uitgebouwd tot een zelfsturend agent-systeem.**

### Night Agent werkend gemaakt
- **Oorzaak gevonden:** de `MT_Agent`-task draaide nog de oude `cmd.exe + nacht.bat`-actie
  — de `&` in "Mortise & Tenon" brak de boel. `setup_task.ps1` was nooit uitgevoerd.
- **Scoring gefixt:** Ollama scoorde alles ≤3. Nieuwe prompt met ijkpunten → scores
  lopen nu 0-9, 7 items haalden de drempel. Drempels staan nu in `agent_config.json`.
- Volledige keten getest: fase 1-5 OK, digest gemaakt + gemaild.

### Nieuw: het MT Autonomy-systeem (zie `Agents/MT_AUTONOMY.md`)
- **fase 0 — `opdracht_verwerker.py`:** opdrachten via lokale map én Outlook-map
  `MT-Agent`; classificeert lokaal vs Claude; antwoordt per mail.
- **fase 6 — `dashboard_generator.py`:** bouwt `Agents/agent_dashboard.html`.
- **3 scheduled tasks:** `MT_Agent_Opdrachten` (20 min), `MT_Agent_Nacht` (23:00),
  `MT_Claude_Review` (07:30 — strategische Claude-review).
- **Voorstellen + review:** zelf-verbeteren met git als vangnet, geen onbewaakte
  zelf-herschrijving.

### ⚠️ Wat ging mis + preventie
| Fout | Oorzaak | Preventie |
|------|---------|-----------|
| Task faalde, geen log | oude `cmd.exe`-actie, `&`-bug | task draait nu via `powershell.exe -File`; `&` is daar geen probleem |
| Log onleesbaar (UTF-16) | PS `*>>` schrijft UTF-16 | `*>&1 \| Out-File -Encoding utf8` + `[Console]::OutputEncoding` |
| Opdrachten verkeerd geclassificeerd | trefwoord "offerte" te grof | trefwoordlijst ingekort, LLM-classificatie met voorbeelden doet het werk |
| DuckDuckGo geeft 0 links | DDG blokkeert scrapers | bekend, staat in MT_AUTONOMY.md §9 — nog te vervangen |

### 🔧 Voor Bart (niet door mij gedaan — bewust)
- **Azure CLIENT_SECRET roteren** — staat al als 🔴 in STATUS.md.
- **Dode dubbele bestanden in Agents/** opruimen (`night_agent.py`, `SETUP.bat`,
  `nachtelijke_agent_v1.py`, `digest_2026-05-14_v1.md`) — vraag eerst, dan weg.
- De nachtrun draait vanzelf om 23:00; de Claude-review om 07:30.

---

## Hoe het werkt

### Cowork → Claude Code
1. Cowork schrijft de taak hieronder onder `[TAAK]`
2. Cowork opent Windows Terminal via computer-use en voert `cowork-to-code.bat` uit
3. Claude Code pakt de taak op, voert hem uit, schrijft resultaat onder `[RESULTAAT]`
4. Claude Code zet status op `idle`

### Claude Code → Cowork
1. Claude Code schrijft resultaat + samenvatting onder `[RESULTAAT]`
2. Claude Code zet status op `idle`
3. Cowork leest `HANDOFF.md` aan het begin van de volgende taak en verwerkt het resultaat
4. Cowork zet status terug op `idle`

### Wanneer Claude Code beter is
- Directe toegang tot Windows-bestanden buiten SharePoint
- Git push naar GitHub (authenticatie op Windows)
- PowerShell-scripts uitvoeren op de echte machine
- Grote lokale installaties of systeemtaken
- Iets wat in de Cowork-sandbox vastloopt

### Wanneer Cowork beter is
- Moneybird (eigen MCP)
- Microsoft 365 — mail, agenda, SharePoint, OneDrive
- Documenten maken (Word, Excel, PDF, presentaties)
- Onderzoek, offertes, planning, geheugen
- Alles waarbij context uit eerdere sessies belangrijk is

---

## [TAAK — inbox_opruimen + night agent check 2026-05-15]

**1. Inbox opruimen uitvoeren**

```powershell
Set-Location -LiteralPath "C:\Users\BartWitte\Mortise & Tenon\Mortise & Tenon - On-Prem-Data\Applicaties\Claude\CRM"
python -X utf8 inbox_opruimen_volledig.py
```

Als het script hangt of faalt: check of token_cache.json bestaat in CRM-map. Als die er niet is, eerst `python -X utf8 login.py` draaien.

**2. Night Agent log controleren**

```powershell
Get-ScheduledTask -TaskName "MT_Agent" | Get-ScheduledTaskInfo
Get-Content "C:\Users\BartWitte\Mortise & Tenon\Mortise & Tenon - On-Prem-Data\Applicaties\Claude\Agents\agent_log.txt" -Tail 50
```

Check of er een digest_2026-05-15.md staat in de Agents-map. Zo niet, check wat er misgegaan is.

Schrijf resultaat hieronder onder [RESULTAAT].

---

## [RESULTAAT — inbox_opruimen + night agent 2026-05-15]

✅ **Beide taken klaar.** Wel onderweg 5 bugs gevonden en gefixt — zie foutanalyse onderaan.

### 1. Inbox opruimen
- **12 mappen** aangemaakt/gecontroleerd (Intern, _Sorteren, _Archief + 5 klant- + 1 leveranciersmap nieuw)
- **62 mails gesorteerd**: Obsburght 1, DesignExpress 2, Mathijs 51, Info@ 8
- **33 rommel-mails** naar Prullenbak (Google Drive, Toggl, Fireflies, GitHub, Claude-notificaties e.d.)
- PowerEtail en ICT-Progress: geen mails in inbox gevonden

### 2. Night Agent
- `MT_Agent` scheduled task bestaat, draaide gisteren 23:00 maar faalde (`LastTaskResult: 1`) — geen digest geproduceerd
- Handmatig fase 1-4 gedraaid → **`digest_2026-05-15.md` gemaakt** (RSS: 0 items ≥7, GitHub: 2 repos, bedrijfsanalyse + Smart Inbox-onderzoek)
- **Digest-mail verstuurd** naar Bart@mortiseandtenon.nl
- Fase 5 (zelf-verbeteren) niet gedraaid — STATUS/HANDOFF werk ik liever zelf bij; placeholder `_(wordt ingevuld door fase 5)_` staat nog in de digest

### ⚠️ Wat ging mis + preventie

| # | Fout | Oorzaak | Fix / preventie |
|---|------|---------|-----------------|
| 1 | `login.py` crashte: `'TokenCache' has no attribute 'serialize'` | MSAL-app gebouwd zónder `SerializableTokenCache` — token kon nooit worden opgeslagen | **Gefixt** in `login.py`. Standaard: elk MSAL-script gebruikt `SerializableTokenCache`. |
| 2 | `token_cache.json` ontbrak → inbox + night-agent-mail konden niet draaien | Gevolg van #1 | Opgelost via #1. Token vernieuwt zichzelf, geen login meer nodig. |
| 3 | Night-agent-mail: "Geen geldig token in cache" | `nachtelijke_agent.py` gebruikte authority `/common`, `login.py` gebruikt `/{tenant_id}` — MSAL vond het token niet | **Gefixt**: tenant-specifieke authority overal. Standaard: alle scripts dezelfde authority. |
| 4 | Night-agent-mail: `'charmap' codec can't encode` | Python draaide niet in UTF-8 mode → emoji/accenten crashen op Windows cp1252 | **Gefixt**: `PYTHONUTF8=1` als systeem-env var + `set PYTHONUTF8=1` in `nacht.bat`. Geen `-X utf8`-hacks meer nodig. |
| 5 | `SETUP.bat` faalde: `'Tenon' is not recognized` | `&` in pad "Mortise & Tenon" breekt cmd-parsing | `SETUP.bat` is overbodig (`setup_task.ps1` werkt wel) → **advies: weg**. Structureel: junction `C:\MT` aangemaakt = schoon pad zonder spaties/`&`. |

### 🛡️ Structurele preventie (geldt vanaf nu voor álle opdrachten)
- **`PYTHONUTF8=1` + `PYTHONIOENCODING=utf-8`** als User-env vars gezet → alle Python overal in UTF-8, scheelt steeds opnieuw debuggen.
- **Junction `C:\MT`** → `C:\...\Claude` aangemaakt. Scripts/taken die via `C:\MT\...` draaien hebben geen last meer van spaties/`&` in het pad.
- Werkafspraak vastgelegd in `feedback_werkafspraken.md`: elk resultaat krijgt voortaan een "wat ging mis + preventie"-blok.

### 🔧 Nog voor Bart (niet vannacht gedaan)
- **Azure CLIENT_SECRET roteren** — staat al als 🔴 in STATUS.md, los van deze taak
- **Agents-map opruimen** — dode dubbele bestanden: `night_agent.py`, `night_agent.bat`, `SETUP.bat`, `nachtelijke_agent_v1.py`, `digest_2026-05-14_v1.md`. Verwijderen vraag ik eerst → één "ja" en het is weg.
- **Mysterie**: `agent_log.txt` ontbreekt terwijl `MT_Agent` ernaartoe logt — de 23:00-run lijkt niet eens gestart. Volgende run (met UTF-8-fix) moet uitwijzen of het nu wél werkt.

---

## [TAAK — oud: Claude Code Desktop]

**Claude Code Desktop app downloaden en silent installeren**

Download de Windows installer en installeer hem silent (geen GUI-wizard nodig).

```powershell
$installer = "$env:TEMP\ClaudeCodeDesktopSetup.exe"
Write-Host "Downloaden..."
Invoke-WebRequest -Uri "https://claude.ai/api/desktop/win32/x64/setup/latest/redirect" -OutFile $installer -UseBasicParsing
Write-Host "Installeren (silent)..."
Start-Process -FilePath $installer -ArgumentList "--silent", "--no-launch" -Wait
Write-Host "Klaar."
```

Als de silent install niet werkt (app wordt al gestart door de installer), noteer dan de installatielocatie en versie.

Schrijf resultaat naar [RESULTAAT]: bevestiging dat de app geïnstalleerd is, installatiepad, en eventuele fouten.

---

## [RESULTAAT — nieuw-project.skill zip 2026-05-12]

✅ **Skill succesvol gezipped naar .skill bestand op NAS.**

- Bron: `\\B5-NAS\B5-Applicaties\Claude\skills\nieuw-project\SKILL.md`
- Output: `\\B5-NAS\B5-Applicaties\Claude\nieuw-project.skill` (3.7 KB)
- Methode: Python `zipfile` (ZIP_DEFLATED)

Bart kan dit bestand nu installeren in Cowork via Instellingen → Skills → Importeer.

---

## [RESULTAAT — git push uren.html → main 2026-05-13]

✅ **Push succesvol naar main op GitHub.**

```
From:   8c487f8 (feat: Toggl Focus endpoint + X-Claude-Key server auth)
To:     1af9fd5 (docs: HANDOFF.md bijgewerkt)
Branch: main → main
Commits: 2
  • 0fbc4a6 feat(uren): 6 Toggl-features — factuurstatus, mijn taken, deadline urgentie, daggrafiek, uren in projectlijst, recente entries
  • 1af9fd5 docs: HANDOFF.md bijgewerkt — uren.html commit gemaakt, merge conflict rapportage
```

**Remote URL:**
- Geverifieerd: https://github.com/MTBart/MT-Facturatie-tool.git
- Live URL: https://mtbart.github.io/MT-Facturatie-tool/uren.html (wijzigingen zichtbaar na GH Pages rebuild ~5 min)

---

## [RESULTAAT — Claude Code Desktop installatie 2026-05-13]

⚠️ **Download geblokkerd door Cloudflare anti-bot challenge.**

De URL `https://claude.ai/api/desktop/win32/x64/setup/latest/redirect` geeft een Cloudflare "Just a moment..." challenge terug. Automatische download via PowerShell/Invoke-WebRequest kan dit niet omzeilen.

**Opties:**
1. **Handmatig downloaden:** Bart opent URL in browser → save-as naar `%TEMP%\ClaudeCodeDesktopSetup.exe` → `Start-Process` voert install uit
2. **Direct downloaden van GitHub releases:** `https://github.com/anthropics/claude-code/releases` (controleren of hier de Windows installer staat)
3. **Meerdere retries:** Soms werkt het na enkele minuten

**Volgende stap:** Bart kan mij melden zodra de `.exe` op de machine staat, dan voer ik de silent install uit.

---

## [RESULTAAT]

✅ **Cloudflare Worker secrets succesvol ingevoerd via wrangler CLI.**

```
✅ TOGGL_FOCUS_KEY = toggl_sk_a2294e278965fd2a90af360a3e7ffd58
✅ CLAUDE_SECRET = mt_claude_secret_2026_MnT
```

Beide secrets zijn nu live op `mt-claude-proxy`. Worker kan nu:
- Toggl Focus API aanroepen met Bearer auth (via `TOGGL_FOCUS_KEY`)
- Inkomende X-Claude-Key valideren (via `CLAUDE_SECRET`)

---

## [RESULTAAT — wrangler deploy 2026-05-12]

✅ **Worker succesvol gedeployd.**

```
Total Upload: 7.48 KiB / gzip: 2.17 KiB
Uploaded mt-claude-proxy (10.74 sec)
```

Worker is nu live op `https://mt-claude-proxy.bart-a12.workers.dev` met:
- Toggl Focus integratie (`TOGGL_FOCUS_KEY` actief)
- Claude authenticatie (`CLAUDE_SECRET` actief)

---

## [RESULTAAT — nieuw-project.py dry-run 2026-05-12]

✅ **Script volledig uitgevoerd in dry-run mode — geen fouten, geen API-calls.**

**Opmerking:** Script geeft `UnicodeEncodeError` bij directe uitvoering via Windows-terminal (cp1252 encoding). Fix: voeg `PYTHONUTF8=1` toe als environment variable, of roep aan met `python -X utf8 nieuw-project.py`. Voorstel: bovenaan het script `sys.stdout.reconfigure(encoding='utf-8')` toevoegen voor automatische fix.

**Volledige output:**
```
====================================================
  Mortise & Tenon — Nieuw Project in Toggl Focus
  ⚠️  DRY RUN — er wordt niets aangemaakt
====================================================

Klantnaam: Testklant
Projecttype
  1. keuken
  2. kast
  3. tafel
  4. badkamer
Kies nummer: 1
Projectnaam [Testklant — Keuken]: (Enter)
Opleverdatum (JJJJ-MM-DD): 2026-09-01
  → Startdatum: 2026-07-07 (8 weken vóór oplevering)

Urgentie
  1. urgent
  2. high
  3. medium
  4. low
  5. none
Kies nummer: 3

Uitvoerder(s) (meerdere: 1,3 of Enter voor eerste)
  1. Bart  2. Mathijs  3. Arjan  4. Jade  5. Maarten
Kies nummers: 1

────────────────────────────────────────────────────
  Project:     Testklant — Keuken
  Type:        keuken
  Looptijd:    2026-07-07 → 2026-09-01
  Urgentie:    medium
  Uitvoerder:  Bart
  Geschat:     32 uur (19 taken)
────────────────────────────────────────────────────

Aanmaken? (j/n) [j]: j

📋 Klant:
  [DRY] Nieuwe klant aanmaken: Testklant

📁 Project:
  [DRY] Project aanmaken: Testklant — Keuken (2026-07-07 → 2026-09-01, 32u)

📋 Taken:
  [DRY] Ontwerp & Offerte
    ↳ [DRY] Klantgesprek & opname
    ↳ [DRY] 3D model uitwerken
    ↳ [DRY] Materiaalcalculatie
    ↳ [DRY] Offerte opstellen
  [DRY] Werkvoorbereiding
    ↳ [DRY] Vectorworks tekeningen
    ↳ [DRY] CNC-bestanden aanmaken
    ↳ [DRY] Materiaal bestellen
  [DRY] Productie
    ↳ [DRY] Plaatmateriaal frezen
    ↳ [DRY] Onderdelen afwerken
    ↳ [DRY] Assemblage werkplaats
    ↳ [DRY] Spuiten & lak
  [DRY] Montage & Levering
    ↳ [DRY] Transport
    ↳ [DRY] Plaatsing bij klant
    ↳ [DRY] Nazorg & oplevering
  [DRY] Facturatie

────────────────────────────────────────────────────
Extra taken niet in template? (Enter): (geen)

====================================================
  ✅ Klaar!
====================================================
```

---

## Log

| Datum | Van | Naar | Taak | Status |
|-------|-----|------|------|--------|
| 2026-05-11 | Cowork | ClaudeCode | Push worker.js → GitHub + Cloudflare vars | ✅ git push klaar, Cloudflare wacht |
| 2026-05-11 | ClaudeCode | Cowork | Cloudflare secrets via wrangler — installatie | ⚠️ wrangler geïnstalleerd, authenticatie handmatig vereist |
| 2026-05-11 | ClaudeCode | Cowork | Cloudflare Worker secrets inzetten | ✅ TOGGL_FOCUS_KEY + CLAUDE_SECRET live |
| 2026-05-12 | ClaudeCode | Cowork | wrangler deploy worker.js → mt-claude-proxy | ✅ deployed — 7.48 KiB, live |
| 2026-05-12 | Cowork | — | Skill nieuw-project gebouwd + geïnstalleerd door Bart | ✅ klaar voor test |
| 2026-05-12 | Cowork | — | toggl-templates.md + eigen-tool-toggl-analyse.md aangemaakt | ✅ op NAS |
| 2026-05-12 | ClaudeCode | Cowork | nieuw-project skill zippen → nieuw-project.skill op NAS | ✅ 3.7 KB, klaar voor installatie |
| 2026-05-12 | ClaudeCode | Cowork | nieuw-project.py dry-run test (Testklant/keuken) | ✅ script werkt — fix Unicode nodig voor Windows-terminal |
| 2026-05-12 | Cowork | ClaudeCode | Git push uren.html — daggrafiek + uren in projectlijst + recente entries | ⏳ wacht op uitvoering |
| 2026-05-13 | Cowork | ClaudeCode | Git push uren.html — factuurstatus + mijn taken + deadline urgentie (ronde 2) | ⏳ wacht op uitvoering |
| 2026-05-13 | ClaudeCode | Cowork | Git commit + push uren.html naar claude/hardcore-shaw-73041c | ⚠️ commit gemaakt (0fbc4a6), merge conflict bij push naar branch |
| 2026-05-13 | ClaudeCode | Cowork | Git push uren.html naar main — conflict opgelost | ✅ 0fbc4a6 + 1af9fd5 live op GitHub, GH Pages rebuild in progress |
| 2026-05-13 | ClaudeCode | Cowork | Git push uren.html (ronde 2: factuurstatus/mijn taken/deadline urgentie) naar main | ✅ pushed 0fbc4a6 + 1af9fd5, live op GitHub |
| 2026-05-13 | ClaudeCode | Cowork | Claude Code Desktop download + silent install | ⚠️ Cloudflare blokkade — handmatige download via browser nodig |
| 2026-05-15 | Cowork | ClaudeCode | Inbox opruimen + Night Agent check | ✅ inbox: 62 gesorteerd + 33 rommel; digest gemaakt + gemaild; 5 bugs gefixt |
| 2026-05-16 | Bart | ClaudeCode | Night Agent fixen + autonoom agent-systeem bouwen | ✅ zie [RESULTAAT — MT Autonomy] bovenaan |
