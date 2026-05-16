# MT Autonomy — het zelfsturende agent-systeem van Mortise & Tenon

> Dit document is de **basis** van het zelflerende, zelf-verbeterende proces.
> Het vervangt `NIGHT_AGENT_FIX.md` (dat was een eenmalige reparatie-opdracht).
> Laatst bijgewerkt: 2026-05-16.

---

## 1. Wat dit is — in één alinea

Mortise & Tenon heeft een agent-systeem dat **lokaal en grotendeels autonoom**
draait. 's Nachts doet een lokaal AI-model (Ollama) research, analyseert de
bedrijfsdata en maakt een digest. Overdag pikt het opdrachten op die Bart op
afstand geeft. Eén keer per dag stuurt **Claude** het geheel bij: de wachtrij
afhandelen, voorstellen beoordelen, de agent fijnregelen. Alles komt samen in
één **dashboard**. De lokale laag is gratis en privé; Claude wordt alleen
ingezet waar echt verstand of code nodig is.

---

## 2. De twee lagen

| Laag | Wie | Wanneer | Kosten | Doet |
|------|-----|---------|--------|------|
| **Lokaal** | Ollama (`qwen2.5:14b`) op de PC | elke 20 min + 04:00 | gratis | research, scoren, analyseren, simpele opdrachten, dashboard |
| **Strategisch** | Claude Code headless (Opus 4.7) | dagelijks 05:00 | abonnement | wachtrij afhandelen, voorstellen beoordelen, agent bijsturen, Bart informeren |

Het idee: **zoveel mogelijk lokaal**, Claude alleen als hefboom. De lokale agent
draait door ook als er geen internet of Claude-tegoed is.

---

## 3. Hoe geef je de agent een opdracht? (dispatch — 4 manieren)

Je wilde manieren in kaart om op afstand opdrachten te geven. Dit zijn ze, van
simpel naar krachtig:

### A. E-mail — beste voor onderweg
Stuur of versleep een mail naar de Outlook-map **`MT-Agent`** (de agent maakt
die map zelf aan). Werkt vanaf je telefoon, overal. De agent leest de map elke
20 minuten, voert de opdracht uit en **mailt je het antwoord terug**. Verwerkte
mails gaan naar `MT-Agent-Verwerkt`.

### B. Lokale map — simpel
Leg een `.md`/`.txt`-bestand in `Agents/opdrachten/inbox/`. Via SharePoint-sync
kan dat ook vanaf je telefoon of een andere pc. Resultaat komt in
`Agents/opdrachten/verwerkt/`.

### C. Claude Code dispatch (remote) — krachtigst
Start op afstand een Claude Code-sessie (dispatch). Die kan óf de taak meteen
zelf doen, óf een opdrachtbestand in `inbox/` schrijven zodat de lokale agent
het oppakt. Gebruik dit voor opdrachten die code/beslissingen vereisen.

### D. HANDOFF.md — voor grote klussen tussen Cowork en Claude Code
De bestaande brug blijft werken voor expliciete handoffs (zie `CLAUDE.md`).

**Classificatie.** Elke opdracht wordt automatisch ingedeeld:
- *Lokaal* — samenvatten, analyseren, adviseren, brainstormen → Ollama doet het meteen.
- *Claude* — code, git, Moneybird, externe API's, beslissingen → wachtrij
  `opdrachten/voor_claude/`, opgepakt in de dagelijkse review.

---

## 4. Componenten

Alles staat in `Agents/`:

| Bestand | Rol |
|---|---|
| `nachtelijke_agent.py` | fase 1-5: research, GitHub, analyse, digest, zelf-verbeteren |
| `opdracht_verwerker.py` | fase 0: opdrachten ophalen (map + e-mail), classificeren, uitvoeren |
| `bron_analyse.py` | fase 1b: leest video-transcripts/artikelen, distilleert nabouw-plannen |
| `dashboard_generator.py` | fase 6: bouwt `agent_dashboard.html` |
| `run_agent.ps1` | orchestrator nachtrun — alle 8 fases |
| `run_opdrachten.ps1` | snelle cyclus — alleen fase 0 + dashboard |
| `run_claude_review.ps1` | start de headless Claude-review |
| `claude_review.md` | instructie die de Claude-review uitvoert |
| `agent_config.json` | tunable instellingen (drempels, model) |
| `bronnen.json` | RSS-feeds + trefwoorden |
| `agent_dashboard.html` | **het dashboard — dubbelklik om te openen** |

Mappen: `opdrachten/inbox` · `opdrachten/verwerkt` · `opdrachten/voor_claude`
· `voorstellen/` (zelf-verbeteringen).

---

## 5. De planning (Windows Task Scheduler)

| Task | Wanneer | Doet |
|---|---|---|
| `MT_Agent_Opdrachten` | elke 20 min, 24/7 | opdrachten oppakken + dashboard verversen |
| `MT_Agent_Nacht` | dagelijks 04:00 | volledige keten — research, analyse, digest |
| `MT_Claude_Review` | dagelijks 05:00 | strategische review (Opus 4.7) + dagstatusmail rond 05:30 |

De agent slaat een run stil over als Ollama al bezig is, dus de PC wordt nooit
overbelast. Opnieuw instellen na een herinstallatie: draai elk `run_*.ps1` één
keer handmatig, of registreer de tasks opnieuw (zie git-historie 2026-05-16).

---

## 6. Het dashboard

`Agents/agent_dashboard.html` — self-contained, dubbelklikken, geen server nodig.
Wordt na elke cyclus ververst. Tabbladen:

- **Opdrachten** — wat je gevraagd hebt, de classificatie, status en het resultaat.
- **Nieuws & scans** — alle gescande RSS-items met score (0-10) en opvolging.
- **GitHub-tools** — gevonden tools die relevant kunnen zijn.
- **Analyse** — de dagelijkse bedrijfsanalyse.
- **Voorstellen** — zelf-verbeteringen die op review wachten.
- **Runs** — wanneer draaide de agent, met welk resultaat.

---

## 7. Zelf-lerend en zelf-bouwend — met grenzen

Je wilde een systeem dat zichzelf voedt en verbetert. Dat kan — veilig — zo:

**Wat de agent zelf mag (laag risico, omkeerbaar):**
- Nieuwe RSS-bronnen toevoegen aan `bronnen.json` (fase 5).
- `STATUS.md` bijwerken met wat het gevonden heeft.
- De score-drempels in `agent_config.json` bijstellen binnen vaste grenzen.
- Een geheugen opbouwen van wat het al gezien heeft (`seen_urls.json`).
- **Bronnen écht lezen** (fase 1b): video-transcripts en artikelen volledig
  lokaal verwerken, het beschreven systeem reverse-engineeren en de kennis
  opbouwen in `kennis/kennis.md`. Lange transcripts worden lokaal in chunks
  samengevat — nul Claude-tokens. Sterke vondsten worden een `nabouw_*`-voorstel.

**Wat via een voorstel + review gaat (hoger risico):**
- Eigen code of prompts wijzigen → de agent schrijft een **voorstel** in
  `voorstellen/`; de Claude-review beoordeelt en past het toe of wijst het af.

**Wat de agent NOOIT zelf doet:**
- Pushen naar GitHub, secrets roteren, `.env` aanraken, bestanden verwijderen,
  klantzichtbare bestanden (`index-v4.html`, `uren.html`, Moneybird) wijzigen.

**Waarom die grens?** Een onbewaakt model dat zichzelf vrij mag herschrijven kan
zichzelf slopen of schade aanrichten zonder dat iemand kijkt. Voorstel → review →
git maakt elke verbetering bewust en 100% terug te draaien. Zo wordt het systeem
elke dag een beetje beter zónder dat het ooit een gevaar wordt.

---

## 8. Hoe Claude (op afstand) blijft sturen

De `MT_Claude_Review`-task voert dagelijks `claude_review.md` uit. Dat is het
moment waarop de strategische laag:
1. de opdracht-wachtrij afhandelt;
2. de voorstellen van de agent beoordeelt;
3. de agent fijnregelt (drempels, bronnen, prompts);
4. `STATUS.md` bijwerkt en alles in git commit;
5. **jou een korte mail stuurt** met de uitkomst.

Wil je tussendoor sturen: geef een opdracht via kanaal A-D hierboven, of pas
`claude_review.md` aan — dat is de "vaste opdracht" van de strategische laag.

---

## 9. Bekende aandachtspunten

- **Vervolgonderzoek** draait op de Brave Search API. Werkt zodra er een
  `BRAVE_API_KEY` in `CRM/.env` staat (gratis sleutel: brave.com/search/api).
  Zonder sleutel slaat de agent die stap netjes over — geen fout.
- **GitHub-scan** werkt via HTML-scraping; kan wisselen. Een GitHub-token zou
  het stabieler maken.
- Eén **dagstatusmail** per dag, rond 05:30, verstuurd door de Claude-review.
  Codeervragen die je instuurt krijgen daarnaast een eigen antwoord-mail zodra
  ze af zijn. Vaker mailen = de oude bug; niet doen.
