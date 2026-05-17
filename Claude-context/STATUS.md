# STATUS — huidige stand van zaken

> Dit bestand wordt door Claude bijgewerkt zodra er iets belangrijks verandert.
> Laatst gewijzigd: 2026-05-16 (Claude Code — MT Autonomy agent-systeem live)

## Waar staan we nu

Cowork volledig ingericht als standaard Claude-werkomgeving. Beide werkplekken werken. Cloudflare Worker gedeployd. Toggl Focus integratie volledig werkend. Skill `nieuw-project` gebouwd en geïnstalleerd. Templates en Toggl-analyse gedocumenteerd op NAS.

**Nieuw (2026-05-15):** Smart Inbox volledig uitgewerkt (ontwerp + HTML prototype + live API koppeling). Night Agent mailnotificaties ingebouwd. SETUP.bat opnieuw aangemaakt — Bart moet vanavond dubbelklikken. Azure CLIENT_SECRET blootgesteld in chathistory — **roteren vanavond!**

**Eerder (2026-05-13):** 3 nieuwe Toggl-features geïmplementeerd in uren.html (ronde 2): factuurstatus per project, "Mijn taken" sectie in Timer tab, deadline urgentie op project cards. Nog niet gepusht naar GitHub — zie HANDOFF.md.

**Eerder (2026-05-12):** 3 verbeteringen ronde 1: daggrafiek rapport, uren in projectlijst, recente entries snelstart. Full rebuild plan gestart: `uren-v2.html` combineert tijdregistratie + projectbeheer + facturatie. Claude Design prototype klaar.

### Machines
- **Thuis-pc:** Claude Code ✅, cowork-to-code.bat ✅, dispatch instellen zodra Bart thuis is 🎯
- **Werkplaats-pc:** Claude Code 2.1.121 ✅, werkplaats-starter.bat ✅ (UNC-safe via pushd), dispatch ❌ (Mathijs deelt account)

### Toggl Focus integratie
- Worker.js uitgebreid met `toggl_focus` target ✅
- Secrets in Cloudflare gezet: `TOGGL_FOCUS_KEY` + `CLAUDE_SECRET` ✅
- Git push gedaan ✅
- `wrangler deploy` uitgevoerd ✅ — worker live op `https://mt-claude-proxy.bart-a12.workers.dev`
- Taken aanmaken via Cowork + Chrome browser tool getest ✅ (Mathijs-project aangemaakt)

### Skill `nieuw-project`
- Skill geïnstalleerd ✅
- Template-database aangemaakt: `Claude-context/toggl-templates.md` ✅
- Toggl-analyse voor eigen tool: `Claude-context/eigen-tool-toggl-analyse.md` ✅
- **Volgende stap: echte test met een project** 🎯

## Open punten — in volgorde van prioriteit

### Vanavond doen (15 mei 2026)
1. ~~SETUP.bat dubbelklikken~~ ✅ — `MT_Agent` task bestaat al; SETUP.bat is kapot (`&`-bug) en overbodig. Night Agent draait nu (digest 15-5 gemaakt + gemaild). SETUP.bat mag weg.
2. **start_inbox.bat dubbelklikken** 🔴 — CRM-map, Smart Inbox testen met echte mail (localhost:8765)
3. **Azure CLIENT_SECRET roteren** 🔴 — portal.azure.com → MT-Outlook-Agent → secret vernieuwen. Was blootgesteld in chathistory!
4. **TeamViewer instellen op werkplaats-pc** — remote access van thuis, tussenoplossing tot VPN er is
5. **Agents-map opruimen** — dode dubbele bestanden weg (zie HANDOFF.md [RESULTAAT] 15-5). Claude vraagt eerst.

### Eerstvolgend
5. **Git push uren.html** 🎯 — ronde 2 (factuurstatus, mijn taken, deadline urgentie) + ronde 1 (daggrafiek, uren in projectlijst, recente entries). Via HANDOFF.md → Claude Code
6. **uren-v2.html bouwen** — full rebuild: timer + projecten + facturen in één app. Claude Design prototype **KLAAR**: `https://claude.ai/design/p/019e1e21-0096-771a-9625-9d43a1981592?file=M%26T+Uren+v2.html`
7. **Synology NAS site-to-site VPN** — thuis + werkplaats koppelen, n8n als centrale coördinator. Research gedaan (2026-05-15), nog niet uitgevoerd.
8. **Concept factuur Lotte Tromp** — wacht op maten van Bart, dan aanmaken via Moneybird (contact ID 439631671228106663)
9. **Diependaalselaan duplicaat samenvoegen** — Bart handmatig in Moneybird UI (klant 161 + 171 samenvoegen)
10. **5 placeholder contacten adres invullen** — Marienberg, Mussenbroek, Prinsenhof, Schoterbos, Statenkwartier
11. **Vectorworks-starter script** — neemt projectnaam, maakt zaagcode (max 20 chars), maakt .vwx in 03_Vectorworks
12. **Skill `nieuw-project` testen** — zeg "nieuw project voor [klant], [type]" en loop de checklist af
13. **Projectnummerstrategie kiezen** — opties: `26-001`, `2601`, of `CN-047` (Bart kiest nog)
14. **Moneybird MCP installeren** — config klaar (zie hieronder), wacht op bevestiging Bart

### Daarna
9. **Offerteproces via spraak** — voice → Moneybird offerte direct aanmaken
7. **SharePoint sync** — localStorage → cloud (uren.html data risico)
8. **Mathijs eigen Cowork account** — los van Bart (nu deelt hij account)
9. **CLOUDFLARE_API_TOKEN als env var** — voor automatische wrangler deploy zonder handmatig OAuth
10. **Skill `weekafsluiting`** — vrijdagmiddag uren samenvatten → concept-factuurregels Moneybird
11. **Scheduled task `Moneybird-check`** — dagelijks ongecategoriseerde inkoopfacturen melden

## Moneybird MCP config (klaar om in te voeren)
```json
{
  "mcpServers": {
    "moneybird": {
      "command": "npx",
      "args": ["-y", "moneybird-mcp-server"],
      "env": {
        "MONEYBIRD_API_TOKEN": "<token uit config.json>",
        "MONEYBIRD_ADMINISTRATION_ID": "342968480452052559"
      }
    }
  }
}
```

## Wijzigingen (changelog)

### 2026-05-17 (Claude-review — Opus 4.7)
- **Opdracht-wachtrij:** leeg, geen codeervragen open.
- **19 voorstellen beoordeeld** (alle `open`): 13× afgewezen, 2× voor-bart, 4× toegepast.
  - `voor-bart`: Hermes Agent VPS (kost een betaalde server), Stoic AgentOS 5/5
    (grote SDK/API-scope) — Bart beslist.
  - `toegepast`: QR-generator (`Agents/qr_generator.py`, bestond al) en CLI-tooling
    (`Agents/mt_cli.py` + `CLI.md`, bestond al) geverifieerd; nieuw gebouwd:
    prompt-bibliotheek (`Agents/prompts/mt_prompts.md`) en agent-governance-audit
    (`Agents/agent_governance.md`).
  - Afgewezen: vooral geheugen-/agent-OS-voorstellen die MT Autonomy al dekt, plus
    voorstellen die niet bij een meubelbedrijf passen (datahandel, productsuites).
- **agent_governance.md** signaleert het belangrijkste gat: geen kostenlimiet per
  agent-run (economische governance) — aanbeveling staat erin voor Bart.
- **agent_config.json** ongewijzigd — digest laat een gezonde hoeveelheid door.

- Night Agent 2026-05-17: RSS gescand, GitHub doorzocht, bedrijfsanalyse + digest (`Agents/digest_2026-05-17.md`).

- Night Agent 2026-05-16: RSS gescand, GitHub doorzocht, bedrijfsanalyse + digest (`Agents/digest_2026-05-16.md`).

### 2026-05-16 (Claude Code — MT Autonomy)
- **Night Agent gefixt:** `MT_Agent`-task draaide nog de oude kapotte `cmd.exe`-actie
  (`&`-bug). Vervangen door PowerShell-tasks. Scoring-prompt herschreven — Ollama
  scoort nu 0-10 i.p.v. alles ≤3.
- **MT Autonomy gebouwd** — zie `Agents/MT_AUTONOMY.md` (de nieuwe basis, vervangt
  `NIGHT_AGENT_FIX.md`):
  - `opdracht_verwerker.py` (fase 0) — opdrachten via map + Outlook-map `MT-Agent`,
    automatische classificatie lokaal vs Claude.
  - `dashboard_generator.py` (fase 6) — `Agents/agent_dashboard.html`.
  - 3 scheduled tasks: `MT_Agent_Opdrachten` (20 min), `MT_Agent_Nacht` (23:00),
    `MT_Claude_Review` (07:30, strategische review headless).
  - `voorstellen/`-map + git als vangnet voor veilig zelf-verbeteren.
- **`settings.local.json`** op `bypassPermissions` gezet — Claude werkt nu autonoom
  zonder permissie-prompts (op verzoek van Bart).

### 2026-05-15 (avondsessie — Claude Code)
- **Inbox opgeruimd** — 12 mappen, 62 mails gesorteerd (Mathijs 51, Info@ 8, Obsburght 1, DesignExpress 2), 33 rommel naar prullenbak
- **Night Agent digest 15-5 gemaakt + gemaild** — handmatig fase 1-4 gedraaid (23:00-run was gefaald)
- **5 bugs gefixt** (zie HANDOFF.md [RESULTAAT] voor volledige foutanalyse):
  1. `login.py` — `SerializableTokenCache` ontbrak, token werd nooit opgeslagen → gefixt
  2. `nachtelijke_agent.py` — authority `/common` ipv tenant-specifiek, mail-token werd niet gevonden → gefixt
  3. UTF-8: `PYTHONUTF8=1` + `PYTHONIOENCODING=utf-8` als User-env vars gezet + in `nacht.bat` → einde 'charmap'-fouten
- **Structurele preventie:** junction `C:\MT` → `...\Claude` aangemaakt (schoon pad zonder spaties/`&`)
- **Werkafspraak toegevoegd** — elk resultaat krijgt voortaan een "wat ging mis + preventie"-blok

### 2026-05-15 (dagsessie — Bart)
- **Night Agent gisteravond NIET gedraaid** — scheduled task bestond niet goed. SETUP.bat opnieuw aangemaakt.
- **SETUP.bat opnieuw aangemaakt** — Bart moet vanavond dubbelklikken om Night Agent in Task Scheduler te zetten
- **Mailnotificaties ingebouwd in Night Agent** — `stuur_digest_mail` + `stuur_fout_mail` via Graph API
- **Smart Inbox architectuur volledig uitgewerkt** — `CRM/smart_inbox_ontwerp.md` aangemaakt
- **Smart Inbox HTML prototype gebouwd** — `CRM/smart_inbox.html` (mock data, volledig werkende UI)
- **Smart Inbox live data koppeling gebouwd** — `CRM/smart_inbox_api.py` (Flask API op localhost:8765) + `CRM/start_inbox.bat`
- **Azure CLIENT_SECRET blootgesteld** in chathistory — Bart moet roteren in Azure portal (MT-Outlook-Agent). Nog niet gedaan!
- **Research gedaan** naar: Synology site-to-site VPN, n8n op Synology NAS, TeamViewer remote control
- **Plan besproken**: twee Synology NAS-sen (thuis + werkplaats) koppelen via VPN, n8n als centrale coördinator, TeamViewer als tussenoplossing voor remote access

### 2026-05-13 (nacht — scheduled task)
- **3 nieuwe verbeteringen in uren.html** (ronde 2, nog niet gepusht):
  1. **Factuurstatus per project** — pill badge (geen/concept/verzonden/betaald) in projectlijst + kiezer in project detail. Klikbaar in de lijst om status te cyclen. Unieke M&T feature.
  2. **Mijn taken sectie in Timer tab** — open taken toegewezen aan IK verschijnen direct onder "Recent" met ▶ startknop. Kleur per project, taak estimate getoond.
  3. **Deadline urgentie op project cards** — rode border + ⚠ badge als deadline overschreden, goud badge als ≤7 dagen. Ook zichtbaar in projectlijst-tab als kleine pill naast code.
- **toggl-feature-analyse.md uitgebreid** met nieuwe vergelijkingstabel (was al aangemaakt in vorige sessie)
- **HANDOFF.md** bijgewerkt met git push taak voor ronde 2

### 2026-05-12 (nachtsessie — scheduled task)
- **Toggl Focus feature analyse gedocumenteerd** — `Claude-context/toggl-feature-analyse.md` aangemaakt met UX-patronen per view
- **3 verbeteringen geïmplementeerd in uren.html** (nog niet gepusht naar GitHub):
  1. Daggrafiek in Rapport-tab (staafjes per dag, goud=vandaag, rood=>10u)
  2. Uren per project zichtbaar in Projecten-tab (geregistreerd + voortgangsbalk)
  3. Recente entries snelstart in Timer-tab (laatste 5 combinaties, ▶ knop)
- **Claude Design prototype KLAAR** — `uren-v2.html` full rebuild compleet gegenereerd. Alle screens gebouwd: Dag, Planning, Uren, Projecten (+factuurstatus pills), Facturen (KPI strip + Moneybird hooks), Bord (dashboard), Team (capaciteitskaarten). Design: warm papier achtergrond, donkergroen timer bar, goud DM Mono project codes. Bekijk op: https://claude.ai/design/p/019e1e21-0096-771a-9625-9d43a1981592?file=M%26T+Uren+v2.html
- **Scope uitgebreid door Bart**: niet alleen Toggl nabouwen maar volledige nieuwe tool (uren + facturen in één)
- **Windows Task Scheduler** voor auto-dispatch Claude Code — nog in te stellen (Bart sliep, .bat handmatig)

### 2026-05-12 (avondsessie)
- **Compananny bestellijst verwerkt** — 24 concept facturen aangemaakt in Moneybird (één per vestiging)
  - BTW ID gefixed: sales_invoice gebruikt `342968481354876545` (niet de purchase variant)
  - Transport & montage als lege stelpost op elke factuur
  - PM items (Klimboomkast, Kantoorkast, Kapstok) als €0 met tekst
  - 5 ontbrekende vestigingen als placeholder contact aangemaakt (Marienberg, Mussenbroek, Prinsenhof, Schoterbos, Statenkwartier)
- **`compananny_prijslijst.json`** aangemaakt — actuele stuksprijzen incl. Whopper 4/8 namen
- **`compananny_contacten.json`** aangemaakt — 47 vestigingen met Moneybird contact IDs
- **Lotte Tromp project** aangemaakt: mappenstructuur in Nieuwe mappenstructuur, PROJECT_INFO.txt
  - Bestaand contact gevonden (klant 1145, ID 439631671228106663) — duplicaat verwijderd
  - Zaagcode: LT-GARDEROBE
- **Feedback werkafspraken** bijgewerkt: nooit auto-aanmaken Moneybird contact + altijd Toggl Focus nooit Toggl Track
- **Toggl Focus**: 2,5u gelogd onder Administratie (7-9:30 PM), timer gestart op CN Bajeskwartier werktekeningen
- **Volgende grote taak**: Toggl Focus features onderzoeken + nabouwen in uren.html (gepland als scheduled task)

### 2026-05-12 (ochtendsessie)
- Werkplaats-pc volledig ingericht: Claude Code 2.1.121, werkplaats-starter.bat (UNC-safe via pushd)
- Cloudflare Worker gedeployd via wrangler (7.48 KiB)
- Toggl Focus API volledig in kaart gebracht (org_id 21259253, workspace 21258443)
- Mathijs-project aangemaakt in Toggl Focus als test + Claude-setup taken
- Skill `nieuw-project` gebouwd en geïnstalleerd door Bart
- `Claude-context/toggl-templates.md` aangemaakt — alle IDs, users, statuses, tags, 4 projecttemplates
- `Claude-context/eigen-tool-toggl-analyse.md` aangemaakt — volledige analyse voor eigen tool replicatie
- HANDOFF.md werkend als Cowork ↔ Claude Code brug

### 2026-05-08
- Eerste opzet kennisstructuur: 6 ctx-bestanden + STATUS.md + afgeslankte CLAUDE.md
- Token-discipline regels vastgelegd
- Moneybird MCP onderzocht en config klaar

## Risico's die nog open staan
- **🔴 Azure CLIENT_SECRET blootgesteld** in chathistory — roteren in portal.azure.com → MT-Outlook-Agent. Vanavond doen!
- `config.json` met Moneybird-token als platte tekst — beveiligen via env vars zodra mogelijk
- `uren.html` data alleen in localStorage — browser cache wissen = data weg → cloud sync prio
- Dispatch op werkplaats-pc werkt niet (Mathijs deelt Bart's account) — Mathijs eigen account nodig
