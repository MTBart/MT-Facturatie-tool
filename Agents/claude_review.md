# Dagelijkse Claude-review — instructie

Dit bestand wordt elke ochtend gelezen door een headless Claude Code-sessie
op **Opus 4.7** (scheduled task `MT_Claude_Review`). Het is de **strategische
laag** boven de lokale Night Agent: de agent doet 's nachts het lokale werk,
Claude stuurt bij en handelt af wat een lokaal model niet kan.

**Coderings- en strategische vragen** die Bart via de Outlook-map `MT-Agent`
(of via dispatch) instuurt, worden door de lokale agent als `wacht-op-claude`
in de wachtrij gezet. Stap 2 hieronder handelt ze af — met Opus 4.7, voor de
beste resultaten.

Werkmap: `C:\Users\BartWitte\Mortise & Tenon\Mortise & Tenon - On-Prem-Data\Applicaties\Claude\`

## Voer deze stappen uit, in volgorde

### 1. Lees de stand van zaken
- `Agents/run_historie.json` — draaide de agent vannacht? Fouten?
- Laatste `Agents/digest_*.md` — wat is er gevonden?
- `Agents/dagelijkse_analyse.md` — de bedrijfsanalyse.

### 2. Handel de opdracht-wachtrij af
Voor elk bestand in `Agents/opdrachten/voor_claude/` met status `wacht-op-claude`:
- Voer de opdracht uit (dit zijn opdrachten die de lokale agent niet zelf kon).
- Schrijf het resultaat onder `## Resultaat` in datzelfde bestand.
- Zet de status bovenin op `klaar`.
- Verplaats het bestand daarna naar `Agents/opdrachten/verwerkt/`.

### 3. Beoordeel de zelf-verbeter-voorstellen
Voor elk bestand in `Agents/voorstellen/` met status `open`:
- Lees het voorstel. Is het zinnig, veilig en omkeerbaar?
- **Toepassen** → voer de wijziging door, zet status op `toegepast`, leg kort uit waarom.
- **Afwijzen** → zet status op `afgewezen` met een reden.
- Bij twijfel of grote impact → status `voor-bart`, laat het voor Bart liggen.

### 4. Tune de agent indien nodig
- Als de digest structureel te weinig óf te veel items doorlaat, pas
  `Agents/agent_config.json` aan (`score_drempel_digest` / `score_drempel_ddg`),
  maar blijf binnen `score_drempel_grenzen`.

### 5. Werk de administratie bij
- Vat de review samen in `Claude-context/STATUS.md` (changelog-blok bovenaan).
- Commit alle wijzigingen in de git-repo van de Claude-map met een nette message.

### 6. Informeer Bart
- Stuur Bart een korte mail met de uitkomst: wat de agent vond, wat is afgehandeld,
  wat open staat. Gebruik de Graph-scripts in `CRM/` (token in `CRM/token_cache.json`).
- Hou het kort: 5-8 regels, Nederlands, jij/je.

## Harde grenzen — NIET doen zonder Bart
- **Geen** `git push` naar GitHub (klantzichtbare code).
- **Geen** secrets roteren, API-tokens wijzigen, of `.env`-bestanden aanpassen.
- **Geen** bestanden permanent verwijderen.
- **Geen** wijzigingen in `index-v4.html`, `uren.html` of Moneybird-data.
- Alle autonome schrijfacties blijven binnen `Agents/`, `Claude-context/`,
  `HANDOFF.md` en `STATUS.md`. Alles loopt via git, dus alles is omkeerbaar.
- Twijfel je? Schrijf het als TODO in `HANDOFF.md` en laat het voor Bart.
