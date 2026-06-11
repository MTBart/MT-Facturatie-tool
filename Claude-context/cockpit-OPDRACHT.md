# OPDRACHT — cockpit: Admin-tab + planning-laag + uren-lock (v2.html)

**Voor:** subagent "cockpit-admin" · **Van:** Larry · **Datum:** 2026-06-12
**Bestand:** `C:\MT\v2.html` (LIVE tool, ~6474 regels, 432 KB — werk zorgvuldig en incrementeel)
**Bron-eisen:** Bart, 12-6 (zie `Bart-PKA\Deliverables\2026-06-11-mt-mobiel-plan.md` blok
"Cockpit-admin eisen" + `2026-06-11-toggl-focus-ui-inventaris.md` §12/§13).

## Harde grenzen

- GEEN git-commando's (Larry commit).
- GEEN secrets/tokens in code; alle externe calls via bestaande helpers.
- Niet aan andere tabs komen behalve de hieronder genoemde aanhaakpunten.
- Huisstijl = bestaande v2-stijl (walnut/goud `#B8962E`, groen `#2A4A38`, cards,
  `btn btn-sm btn-gold/btn-secondary`, Nederlandse UI-teksten).
- Geen frameworks; vanilla JS in bestaande scriptblok-structuur.
- Na afloop: Node-syntaxcheck van ALLE inline scriptblokken (extract + `new Function`),
  0 fouten vereist. Rapporteer bytes/regels/resultaat.

## Bestaande infra (gebruik deze, bouw niets dubbel)

- **Tabs:** knoppenbalk regel ~496–505 (`<button class="tab-btn" onclick="showTab('x',this)">`),
  content-divs `<div id="tab-x" class="tab-content">` ; `showTab()` regel ~1580.
- **SharePoint-opslag:** `_SP.read('bestand.json')` / `_SP.write('bestand.json', data)`
  (regel ~5339; map `MT-Bedrijfstool/` op site MortiseTenon). 404 → `null`.
  Voor gedeelde bestanden ALTIJD read-merge-write op entry-`id` (twee-PC-veilig;
  zelfde patroon als `_LOG` chatlog regel ~6280).
- **Login/identiteit:** `_msal.getAllAccounts()[0].username` → e-mail (lowercase
  vergelijken). `_LOG.gebruiker()` bestaat ook (regel ~6307).
- **Worker/Toggl:** `tgTrack(path,method,body)` (Track v9), `focusFetch(path,...)`
  (Focus intern), `TG_WS`, agenda-actuals via `agSyncAlleMedewerkers` → bestaande cache.
- **Agenda-tab:** `#tab-agenda` regel ~931; state `_agenda` regel ~1740 (view
  'grid'|'lijst', filters `fProj`/`fPers` als Sets, `weekStart`); render via
  `renderAgenda()` / `agRenderGrid()` / `agRenderLijst()`; filters/dropdowns bestaan al.
- **Fase-planner:** `mt_planning[code]` met fases incl. `effort` (uren) en
  start/eind-datums (regel ~3649) — gebruik als bron voor "gepland werk per project".
- **Uren-edit:** `tgEditEntry(i)` regel ~2403 (PUT) en de delete-flow er vlak onder
  (regel ~2423, DELETE) — dit zijn de lock-aanhaakpunten.
- **TAB_HELP** regel ~6284 — entry voor 'admin' toevoegen, 'agenda'-entry bijwerken.

## Team (hardcode als const, bron van waarheid hier)

```js
const MT_TEAM=[
  {email:'bart@mortiseandtenon.nl',    naam:'Bart',    admin:true},
  {email:'mathijs@mortiseandtenon.nl', naam:'Mathijs', admin:true},
  {email:'arjan@mortiseandtenon.nl',   naam:'Arjan',   admin:false},
  {email:'maarten@mortiseandtenon.nl', naam:'Maarten', admin:false}
];
```
Helper `mtIsAdmin()` → admin o.b.v. ingelogde e-mail; bij geen login → géén admin.

## Datamodel (nieuwe SP-bestanden, alle via _SP + read-merge-write)

- `mt_adminconfig.json` — `{lockDagen:14, werkuren:{bart:40,mathijs:40,arjan:40,maarten:40}, budgetten:{"2026":{bart:25,mathijs:25,arjan:25,maarten:25}}}`
  (laatste-schrijver-wint is hier OK; klein config-object)
- `mt_verlof.json` — array `[{id,persoon,van:'YYYY-MM-DD',tm:'YYYY-MM-DD',dagen,opm,ts,door}]`
- `mt_vrijedagen.json` — array `[{id,datum:'YYYY-MM-DD',naam,type:'verplicht'|'optioneel',ts,door}]`
- `mt_auditlog.json` — append-only array `[{id,ts,wie,actie,doel,oud,nieuw,reden}]`
- `mt_planblokken.json` — array `[{id,persoon,project_code,taak,datum:'YYYY-MM-DD',start:'HH:MM',duurMin,notitie,ts,door}]`
- `mt_notificaties.json` — array `[{id,ts,van,aan:'allen'|email,titel,tekst,deeplink:{tab,item},gelezen:[]}]`
  (dit bestand pollt de mobiele app straks in F1 — formaat exact zo houden)

Cache elk bestand in een module-state + localStorage-spiegel; laad bij tab-open,
schrijf direct na elke mutatie (read-merge-write).

## Deel A — nieuwe tab "Admin"

Tab-knop alleen tonen als `mtIsAdmin()` (knop default `style="display:none"`,
zichtbaar maken na login-check). Sub-secties (subtabs zoals `tg-subtabs`-patroon):

1. **📒 Logboek** — tabel nieuwste-eerst uit `mt_auditlog.json`: tijd, wie, actie,
   doel, oud → nieuw, reden. Filter: persoon-select + zoekveld. Globale helper
   `auditLog(actie,doel,oud,nieuw,reden)` (fire-and-forget, faalt stil).
2. **⚙️ Team & lock** — per teamlid werkuren/week (input, opslaan in adminconfig);
   uren-lock-dagen instelbaar (default 14) met uitleg "geklokte uren ouder dan N
   dagen zijn vergrendeld voor niet-admins".
3. **🏖 Verlof & saldo** — (a) jaarbudgetten-grid per persoon per jaar (invulbaar,
   adminconfig.budgetten); (b) verlof boeken: persoon, van, t/m, dagen (auto =
   werkdagen ma–vr in periode, overschrijfbaar), opmerking → `mt_verlof.json`;
   lijst met verwijderknop; (c) **saldo-tabel** per persoon voor gekozen jaar:
   budget − opgenomen (t/m vandaag) − ingepland (na vandaag) = open. Negatief → rood.
4. **📅 Vrije dagen** — invoer datum+naam+type (verplicht/optioneel) →
   `mt_vrijedagen.json`; lijst gesorteerd op datum met verwijderknop.
   Verplicht = wordt in agenda afgeblokt; optioneel = semi-transparant getoond.
5. **🔔 Notificatie sturen** — formulier: aan (allen / per persoon), titel, tekst,
   deep-link (select met tabs van de mobiele app: timer|projecten|agenda|capture|
   oplevering + vrij item-veld) → append aan `mt_notificaties.json`. Lijst met
   verzonden notificaties eronder (nieuwste eerst). Dit is de admin-kant van de
   mobiele app (F1 pollt dit bestand).

Elke mutatie in 2–5 → ook `auditLog(...)`.

## Deel B — planning-laag in de Agenda-tab

Derde view-knop "📋 Planning" naast Rooster/Lijst (`_agenda.view='plan'`).

- **Week-grid** zoals het bestaande rooster (zelfde kolommen/gutter), maar met
  **planblokken** uit `mt_planblokken.json`. Bestaande persoon/project-filters
  werken er ook op; kleur volgt "Kleur op".
- **Aanmaken:** klik op lege plek in een dagkolom → klein formulier (modal of
  inline-sheet): persoon (select MT_TEAM), project (select uit PROJECT_CODES of
  vrije tekst), taak/omschrijving, starttijd (kwartier-raster), duur. Opslaan →
  SP + render.
- **Drag** (verplaatsen naar andere dag/tijd) en **resize** (onderrand, per
  kwartier). Na drop/resize → opslaan + auditLog niet nodig (planning ≠ geklokte
  uren), wel `ts`/`door` bijwerken.
- **Actuals ernaast:** toggle "✓ toon geklokt": de bestaande actuals-entries
  (zelfde week, zelfde filters) semi-transparant als smalle blokken in dezelfde
  kolommen (bv. rechterhelft van de kolom plan / linkerhelft actual, of
  outline-stijl) zodat plan vs werkelijk per dag te zien is.
- **Vrije dagen:** verplichte vrije dag → hele dagkolom grijs gearceerd
  ("🔒 <naam>"), klik om te plannen geblokkeerd met toast; optionele vrije dag →
  lichte semi-transparante overlay + label, plannen blijft mogelijk.
  Verlof-boekingen → blok over de werkuren van die persoon (alleen zichtbaar als
  die persoon in filter zit), niet-planbaar voor die persoon (toast).
- **Capaciteitsbalk per persoon** boven het grid: per teamlid in de getoonde week:
  capaciteit = werkuren/wk − (verplichte vrije dagen × dagdeel) − verlofuren;
  gepland = som planblokken; balk groen <90%, goud 90–100%, **rood >100% met
  "⚠ overboekt +X u"**. Klik op naam = persoon-filter aan/uit.

## Deel C — uren-lock wiring (Uren-tab)

Helper `urenLock(startIso)` → `{locked:bool, dagen:N}` o.b.v. adminconfig.lockDagen.
In `tgEditEntry` en de entry-delete:

- entry-start ouder dan lockDagen én `!mtIsAdmin()` → blokkeer:
  `alert('🔒 Vergrendeld: entries ouder dan N dagen kunnen alleen door een admin
  worden aangepast.')` + return; poging loggen via auditLog('edit-geweigerd',…).
- admin + vergrendelde entry → `prompt('Reden voor wijziging van vergrendelde uren:')`,
  lege reden = annuleren; door met wijziging en `auditLog('unlock-edit'|'unlock-delete',
  doel, oud, nieuw, reden)`.
- ALLE geslaagde entry-edits/deletes (ook recente) → auditLog('uren-edit'|'uren-delete',
  beschrijving, oud, nieuw, '').

## Oplevering

1. Werkende code in `C:\MT\v2.html`, syntaxcheck 0 fouten.
2. Kort verslag in `C:\MT\Claude-context\cockpit-VERSLAG.md`: wat gebouwd, waar
   (regelnummers), welke SP-bestanden, wat mock/extra, open punten.
