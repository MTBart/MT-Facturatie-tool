# FUNDAMENT-F1: de veilige planblokwriter (voor de Codex-review)

Branch `planning-f1` (vanaf `planning-p4a`). Fundament-brok: raakt bestaande productiedata (`mt_planblokken.json`, nu 3 blokken van PROEF-01 en de echte planning). Niets nieuws te zien voor de gebruiker.

## Waarom
Codex-bevinding 1, 2 en 4 uit het planningsplan: taken schrijven veilig (`takenSchrijf`: vers lezen, ETag, veldstempels, tombstones), planblokken niet. `agPlanSave` voegde per **record** samen
(het nieuwste record wint als geheel): twee mensen die tegelijk verschillende velden van hetzelfde blok wijzigen, verliezen er één, zonder melding. Een bewerkbaar planblokpaneel (P1b) mag
daar niet op landen. Bovendien kende alleen de takenlijst een schemadrempel.

## Het ontwerp
Alles zit in `mt-planning.js` (rekenwerk, geen DOM; testbaar) en wordt aangeroepen door de cockpit (`agPlanSave`, v2.html) en de telefoon (`_pvSchrijf`, mobiel.html: voorstellen).

| Onderdeel | Wat |
|---|---|
| `P.BLOK_VELDEN` | de gestempelde velden: persoon, project_code, taak, taak_id, datum, start, duurMin, notitie, status, voorstel. `ts`, `door`, `_door` reizen mee met een wijziging, zonder stempel. |
| Stempel per veld | `_vs[veld] = { t, dev, rev, door, basis }`, dezelfde vorm als bij taken; `_gewijzigd` = het hoogste stempel (getal). |
| `P.blokSamen(lokaal, remote)` | samenvoegen per id, per veld. Strikt: een andere vorm dan een lijst is een fout (de `_SP` blokkeert de sleutel, nooit stil leeg). Volgorde van het bestand blijft; gelijke records blijven byte voor byte gelijk. Hergebruikt `recSamen` (taken en bestelregels) met vier schakelaars: `rt` (eigen recordtijd: `_gewijzigd`, anders `ts`), `staleBoven`, `geenConflict` (geen `_veldconflict` voor blokken: er is geen scherm om ze op te lossen), `verwijderWint`. |
| `P.blokPatches(basis, nieuw)` | het verschil tussen wat dit apparaat eerder zag (`_planBasis`) en wat het nu heeft: alleen de velden die dit apparaat wijzigde, een nieuw blok, of een tombstone. De aanroepers wijzigen `_planblokken` zoals voorheen; de writer leidt de wijziging zelf af. |
| `P.blokSchrijf(sp, o)` | vers lezen (ETag) → vorm- en schemacontrole → `blokSamen(lokaal, vers)` → patches toepassen (stempel alleen op de gewijzigde velden) → `voorWrite` (schema, recht) → `sp.write` met `blokSamen` als 412-oplosser → uitkomst `{ ok, reden, data, blokken, overgeslagen, afwijkend }`. Maakt het bestand zo nodig aan (lege lijst). Gooit een fout of een time-out: `reden: 'schrijven'`, de stand mét wijziging staat in `data` en wordt later gedeeld (`P.blokPush`). |
| Controle achteraf | `P.blokAfwijkend(data, patches)`: staat er na het schrijven een andere waarde dan bedoeld (een collega met een nieuwer stempel), of is het blok verwijderd? Dan een eerlijke melding met de naam van de collega: "Mathijs wijzigde de dag van dit planblok tegelijk; jouw wijziging is daarvoor niet overgenomen." |
| Time-out | `agPlanSave` zet 15 s op het schrijven; daarna `P.blokVerifieer` (vers lezen): opgeslagen / niet / tegelijk / onbekend, elk met een eigen melding. |
| Slot | één schrijfactie tegelijk per tab (een promise-keten in `agPlanSave`), en een slot per blok (`agPlanBlokBezig(id)`) voor wie een tweede actie op hetzelfde blok wil starten. De bestaande `_agDropBezig` blijft. |
| Ongedaan maken | blijft de bestaande `MTPlanVerplaats.ongedaan`/`capHerstel` (vergelijkt `_gewijzigd`). De writer zet het stempel op de tijd die de aanroeper zelf al op het record zette (`_spStempel`), zodat die vergelijking blijft kloppen. |
| Schemadrempel (R1) | (a) `PROJ_SCHEMA` en `P.SCHEMA` 5 → 6 en `mt_planblokken` + `mt_bestellijst_v2` in `_PROJ_SCHEMA_SLEUTELS`: zodra de teller `schema_min` op 6 staat, schrijft een app met een lagere versie die bestanden niet meer. (b) per bestand: een record `{ id: '__schema', schema_min: N }` in `mt_planblokken.json` (`P.blokSchemaZet`, alleen omhoog; `P.blokSchrijf` weigert met "herlaad de tool" als N hoger is dan de eigen versie). F1 zelf schrijft dit record NIET: het is de voorziening voor P5/P6. |

## Migratie en wat een oude client doet
- **Bestaande blokken blijven exact gelijk.** Zolang niemand een blok wijzigt, verandert er geen byte; samenvoegen van een bestand met zichzelf is de identiteit. Alleen het gewijzigde blok krijgt `_vs`
  en een nieuw `_gewijzigd`. Test: dry-run (`P.blokMigratieRapport`: aantallen, "gelijk na samenvoegen", lijst van wijzigingen) en terugleescontrole (wat er staat leest hetzelfde terug) op een
  productiegelijkend bestand met de drie PROEF-01-blokken (onder andere een blok met alleen `ts`, een met alleen `_gewijzigd`).
- **Ongestempeld is oud**: een veld zonder stempel in een record zonder `_vs` telt als geheel met de tijd van het record (`_gewijzigd`, anders `ts`); in een wel gestempeld record telt het als
  ongemoeid sinds de migratie (tijd 1: wint van niets, nooit van een stempel).
- **Oude client (v2.21 zonder F1)** stempelt alleen het record (`_spStempel`: `_gewijzigd` omhoog, `_vs` blijft ongemoeid) en voegt per record samen (nieuwste wint). Herkenning: een record dat nieuwer is
  dan al zijn stempels (`staleBoven`). Zijn velden tellen dan met de tijd van dat record (met een nieuw stempel erbij); de nieuwe kant wint voor velden met een nieuwer stempel. Uitkomst in de tests:
  (1) een oude client wist geen stempels (hij schrijft het record als geheel); (2) zijn wijziging aan een ander veld blijft staan naast een nieuw stempel; (3) een nieuwere nieuwe wijziging wint voor zijn
  veld. **Bekende beperking**: de *oude* merger kiest per record het nieuwste geheel; wijzigt een oude client een blok dat een nieuwe client net in een ander veld wijzigde zonder die te hebben gelezen, dan
  wint bij de oude client zijn record als geheel. Dat is het gedrag van vóór F1 en verdwijnt zodra de drempel op 6 staat en iedereen herladen heeft (een te oude app schrijft dan niet meer; zie hierboven).
- **Tombstones**: `_vervallen` (oude vorm `{tijd, door, reden}` of nieuw `true` + `_ts`) wint altijd (`verwijderWint`); een oude kopie zet een verwijderd blok niet terug. Een voorstel dat besloten is
  (goedgekeurd of afgewezen) wint van een nog open versie (late intrekking, oude kopie).

## Randgevallen waar de tests op letten
Twee apparaten (zelfde veld: nieuwste stempel wint én de verliezer krijgt een melding met naam; ander veld: beide blijven); een collega verwijdert terwijl ik wijzig (niet teruggezet, eerlijk
overgeslagen); nieuw blok met een bestaand id (overgeslagen); gelijke stempels (deterministisch op inhoud, in beide volgorden dezelfde stand); lezen mislukt (niets geschreven); offline halverwege
(niets op SharePoint, stand lokaal, later gedeeld); time-out waarbij de write wel aankwam; bestand geen lijst (nooit overschreven); bestand ontbreekt (aangemaakt); schemadrempel hoger dan de app;
`voorWrite` die weigert; voorstel goedkeuren/afwijzen/intrekken via de bestaande `MTPlanVoorstel`-functies; de rooktest in een echte browser met de nagebootste SharePoint (412-pad, foutinjectie).

## Wat bewust niet is gedaan
- Geen workerwijziging (de drempel is de bestaande `schema_min` plus het bestandsrecord); geen afdwinging aan serverkant voor een app die de drempel niet kent.
- Geen `_veldconflict` voor blokken (er is geen oplossscherm; de collega-melding vervangt dat).
- De bestellijst krijgt in F1 alleen de schemadrempel (de bestelregels hadden al veldstempels via `bestelSamen`); `taak_id`/`verwacht_op` komen met P5.
- Releasevolgorde: pas na de release `schema_uitgerold` op 6 zetten (POST `/teller/schema`) en daarna eventueel `min`; eerder heeft het ophogen van de versie geen effect.

## Waar kijken
`mt-planning.js` (sectie "F1: de veilige planblokwriter", en `recSamen`: de schakelaars `rt`, `staleBoven`, `geenConflict`), `v2.html` (`agPlanLoad`, `agPlanSave`, `_agPlanSaveEen`, `_capVers`, de merger `mt_planblokken`),
`mobiel.html` (`_pvSchrijf`, `_pvLees`). Tests: `b-bw-harness.js` (52 controles), de rooktest `rook-f1.js`.
