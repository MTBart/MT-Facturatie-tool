# ROUTES.md — de wegen-kaart van de M&T-tool (cockpit + app + Worker)

> **Doel:** één plek waar permanent staat hoe alles aan elkaar hangt — front-ends,
> Worker-routes, SharePoint-databestanden, auth en deploy. Vindbaar op beide PC's
> (SharePoint-sync) én voor Claude-sessies. Geen secrets hier — repo is **PUBLIC**.
>
> Laatst geverifieerd: 2026-07-03.

## De front-ends (wat is wat)

| Bestand | Naam (afspraak Bart 12-6) | Wat |
|---|---|---|
| `v2.html` | **de cockpit** | PC-tool waar Bart non-stop mee werkt: projecten, facturen/MB, inbox, agenda/planning, admin, nacalculatie. Actieve ontwikkeling gebeurt hier. |
| `mobiel.html` | **de app** | Telefoon-PWA (manifest `manifest-mobiel.json`) voor het veld: timer, capture/foto's, taken, agenda, Rapportage (opname- + opleverrapport), feedback. |
| `index.html` | redirect naar de cockpit | Sinds 15-6 alleen nog een doorstuurpagina naar `v2.html` (query/hash blijven behouden). De oude v4-bedrijfstool staat sinds 11-10-2026 niet meer in de repo (lokaal in `_uit-repo-2026-10-11/`). |
| `uren.html` | M&T Uren | Urenregistratie (ouder). |

Nóg oudere front-ends staan gearchiveerd in `_archief/oude-tool-2026-06-04/`
(gitignored, niet live).

### Gevendorde libraries (`vendor/`, sinds 2-7)

Geen runtime-CDN-afhankelijkheden meer; alles same-origin (en dus door `sw.js`
mee-gecachet voor offline):

| Bestand | Versie | Gebruikt door |
|---|---|---|
| `vendor/msal-browser.min.js` | 2.39.0 (sha256 in comment bij de script-tag) | cockpit + app (login) |
| `vendor/xlsx.full.min.js` | SheetJS (bestond al) | cockpit (import, `defer`) |
| `vendor/jspdf.umd.min.js` | 4.2.1 (Vex-akkoord 1-7) | cockpit (PDF-export, `defer`) |

Nieuwe versie = bestand vervangen + `?v=`-cachebuster in de script-tag bumpen.

### Gedeelde kernlaag (`mt-core.js`, sinds 2-7)

Eén bestand met de laag die cockpit én app allebei nodig hebben — voorheen
tweemaal inline gedupliceerd. Geladen als gewone (niet-`defer`) script-tag ná
`vendor/msal-browser` en vóór de inline-app-code, in beide front-ends:
`<script src="mt-core.js?v=<datum>"></script>`. Zet alles expliciet op `window`,
zodat de losse script-blokken elkaar zien.

| Export | Wat |
|---|---|
| `window.esc(s)` | canonieke HTML-escaper (`& < > "`) |
| `window._encPath(p)` | Graph-padencodering (`encodeURI` + `#`/`?` escapen) |
| `window.authHeader()` | `{X-Auth-Token}`-header uit het huidige ID-token |
| `window.getAuthToken()` | silent ID-token (null bij fail) |
| `window.getGraphToken()` | Graph-access-token: silent → popup → `onTokenFail`-hook |
| `MTCore.installAuth(cfg)` | zet de token-helpers op `window`; `cfg` = `{graphScopes, onTokenOk, onTokenFail}` |
| `MTCore.makeSP(cfg)` | bouwt de `_SP`-synckern (site-resolve, faalveilig `read`, `write` + S1 ETag/412-merge; een bestand dat bewezen nog niet bestaat (read/prefetch gaf 404) wordt aangemaakt met `If-None-Match: *`, een 412 daarbij is een gewoon conflict: lezen, samenvoegen, begrensd herschrijven); `cfg` = `{toast, onSyncStatus, trackLastSync, etagKeys}` |

Page-specifieke verschillen zitten in de config, niet in geforkte code:
- **cockpit:** 7 Graph-scopes (Files/Sites/Mail/Calendars/Tasks), Q7-sessiebanner
  via `onTokenFail`, `trackLastSync:true` + `onSyncStatus` (statusbalk), `_SP`
  uitgebreid met `KEYS`/`schedule`/`PROJ_DRIVE` via `Object.assign`.
- **app:** 2 scopes (Files/Sites), géén banner (leunt op `_RQ`-queue),
  géén `lastSync`/statusbalk; `_SP` = kale synckern met `showToast` als toast.

`window._msal` (i.p.v. een lokale `let`) zodat `mt-core.js` dezelfde MSAL-instance
gebruikt als de inline init. `sw.js` is network-first zonder precache-manifest →
`mt-core.js` wordt vanzelf same-origin mee-gecachet, geen aparte vermelding nodig.

### Dialog-laag (`mt-dialog.js`, sinds 3-7)

Herbruikbare, Promise-gebaseerde `<dialog>`-flows als vervanger voor de
blokkerende `prompt()`/`confirm()` (audit-actie S6). Eigen bestand (mt-core is de
data/auth-laag), zelfde `<script src="mt-dialog.js?v=<datum>">`-patroon ná mt-core.
Cockpit-tokens (`--green`/`--gold`, Segoe UI) — **interne** tool, niet de
website-huisstijl. Alles op `window.mtDialog`:

| Aanroep | Retour | Voor |
|---|---|---|
| `mtDialog.confirm(opts)` | `Promise<boolean>` (`false` = annuleren) | ja/nee-bevestiging, `danger:true` = rode knop |
| `mtDialog.prompt(opts)` | `Promise<string\|null>` (`null` = annuleren) | tekst-invoer (`multiline:true` = textarea) |
| `mtDialog.choose(opts)` | `Promise<number\|null>` (gekozen index) | kies-uit-lijst (`choices:[{label,sublabel}]`) |
| `mtDialog.alert(opts)` | `Promise<void>` | melding met alleen OK |

`opts` mag een string zijn (= `{message}`). Velden: `title`, `message` (platte
tekst, wordt ge-escaped + `\n`→`<br>`), `html` (vertrouwde HTML-body, bv.
mail-preview), `okLabel`, `cancelLabel`, `danger`, `defaultValue`, `placeholder`,
`multiline`, `choices`. **Escape / backdrop-klik / systeem-cancel = afwijzen** (net
als een geannuleerde `prompt`). Gedrag identiek aan de vervangen dialoog; alleen de
UI-laag verschilt. Omgezet tot nu toe: mail-koppelen in de offerte-calc + de
verwijder-/ontkoppel-confirms van projecten/taken/bijlagen. De rest blijft
voorlopig `prompt`/`confirm` (S6 is doorlopend, per flow).

### Zoekbalk (`mt-zoekbalk.js` + `mt-zoek.js`, sinds 11-10)

Het altijd zichtbare zoekveld bovenin cockpit (`#zb-veld` in de topbalk, uitklaplijst) en app (zoekicoon in de kop → zoeklaag over het hele scherm met eigen invoerveld; `inline:true`).
Twee bestanden, in deze volgorde geladen (na `mt-contacten.js`): `mt-zoek.js` vóór `mt-zoekbalk.js`.

| Bestand | Wat |
|---|---|
| `mt-zoek.js` | **Zoeklogica, DOM-vrij** (`window.MTZoek`). `bronVan(data, h)` zet projecten, klantenregistry, taken en contacten om naar bron-items; `index(items)` normaliseert één keer; `zoek(index, q, opts)` geeft `{groepen:[{soort,label,items,totaal,meer}]}`. Ook bruikbaar vanuit het Outlook-paneel: dat geeft zijn eigen gegevens/hulpfuncties mee. |
| `mt-zoekbalk.js` | **UI-component** (`window.MTZoekbalk.init({veld, zoek, open, vraag?, vraagMag?, isVraag?})`): ARIA-combobox + listbox, pijltjes/Enter/Esc/Tab, delegatie (geen inline handlers), alles via `esc()`. |

Rangorde (vast, per soort): 0 exacte code/alias · 1 begint met · 2 klant (zoekterm zit in de klantnaam/organisatie) ·
3 recente activiteit (≤ 30 dagen) · 4 overige; binnen een rang eerst woordbegin-treffers, dan meest recent, dan op naam.
Treffers op code (project-, werk-, offertecode, oude codes; ook zonder streepjes), naam, alias, klantnaam en extra zoektekst
(locatie, functie, telefoon). Soorten en rechten: Projecten/Klanten/Locaties/Contacten = recht `projecten`, Taken = `taken`
(`MTZoek.magUitRollen()`); onderaan "Vraag dit aan Larry: “…”" = recht `ai`, alleen in de cockpit; roept `tbChatSend(q)` aan. Het chatpaneel heeft een eigen invoerveld (`#tbchat-in`), zodat zoekveld en chat nooit hetzelfde veld delen; typen in het zoekveld sluit het chatpaneel.
Een treffer opent via `mtRoute.go` (project `#projecten/<CODE>`, klant `#klant/<KL>[/<LOC>]`, taak = project-sectie
planning) of `MTContactenUI.detail`. De pagina bouwt de index hooguit elke 3 s opnieuw (`zbIndex`/`zbIndexM`).
De lijst-zoekvelden (`zoekProjecten`, `zoekKlanten`, `zoekInLijst`, `zoekGeschiedenis`) zijn ongewijzigd.
**Externe bronnen (brok 3, `mt-zoek-extern.js`, DOM-vrij):** na minimaal 3 tekens en 400 ms pauze komen er groepen **E-mail**, **Moneybird**
(facturen, inkoopfacturen en offertes) en **SharePoint** (mappen en bestanden) bij, na de lokale groepen. Een nieuwe toetsaanslag breekt
lopende aanvragen af (AbortController); een verouderd antwoord wordt genegeerd. Per bron een status: laden, leeg (groep verdwijnt),
fout, of 429 met Retry-After (die bron wordt dan niet opnieuw gevraagd tot de tijd om is; de andere bron loopt door).
Getoond wordt alleen titel, klant, datum en soort; openen gebeurt in Moneybird/SharePoint zelf (nieuw tabblad,
`MTZoekExtern.openUrl` → `veiligeUrl` met hosts `moneybird.com` resp. de `veiligeLink`-hosts).
- **E-mail** (alleen cockpit, recht `inbox`): Graph `$search` met het Graph-token van de gebruiker in de eigen postbus (`/me`) en in de gedeelde postbus
  info@ (`/users/<info@>`); toegang tot info@ wordt niet aangenomen: een 403/404 van die postbus wordt stil overgeslagen en in die sessie niet
  opnieuw geprobeerd (een 403 op de eigen postbus is wel een fout). Alleen onderwerp, afzender, datum en soort worden getoond (`$select` zonder
  body); dezelfde mail in beide postbussen telt één keer. Klik: is de mail al aan een project gekoppeld (`MTKoppel.mailProjecten`) dan opent het dossier
  (`#projecten/<CODE>`, sectie dossier), anders de webLink in Outlook (nieuw tabblad, hosts office.com/office365.com/outlook.com/microsoft.com).
  De zoekfrase is voorspelbaar gemaakt (`kqlVeilig`): `"`, `\`, `:` en haakjes weg, alles kleine letters (KQL-operatoren werken alleen in hoofdletters),
  hooguit 100 tekens; "from:naam OR to:klant" is dus gewoon "from naam or to klant". Een **429 geldt per postbus**: alleen die postbus wordt tot het Retry-After-moment
  overgeslagen; de andere levert gewoon en de groep meldt "info@ even niet beschikbaar" (zo ook bij een serverfout op één postbus). Zijn alle postbussen geblokkeerd,
  dan is het een limiet met de langste resterende wachttijd. Afbreken (AbortController) en debounce zoals bij de andere bronnen. De app (mobiel) heeft geen Mail-scope en dus geen mailgroep.
- **Moneybird:** worker-route `GET /zoek/moneybird?q=&max=` (alleen lezen). Het recht `moneybird` geldt ALTIJD, ook in ROLLEN_MODUS=log/uit:
  geen rol of geen recht = 403. De route leest uitsluitend een compacte zoekindex in KV (`zoek:mb:index:v1`: nummer, referentie, contactnaam,
  datum; nooit bedragen) van dit en vorig jaar (`period:this_year` en `period:prev_year`; `last_year` bestaat niet). Ontbreekt de index of is hij
  ouder dan 15 min (onvolledig: 2 min), dan **start** het verzoek de opbouw en antwoordt meteen met `opbouwen` of de oude index (`verouderd:true`).
  **De opbouw is hervatbaar en atomair:** de Durable Object `MT_ZOEKINDEX` (`MtZoekIndex`, migratie v5) verwerkt per alarm-run hooguit 8 pagina's /
  15 s (een AbortController breekt elke Moneybird-fetch op die deadline af: een hangende fetch kan de run niet blokkeren), bewaart de cursor (lijst, pagina) en de ruwe pagina's in zijn eigen opslag en plant het volgende alarm; een gestorven isolate of een
  afgebroken run hervat bij de cursor (geen dubbele pagina's). Tijdelijke fouten (netwerk, 5xx) worden per pagina drie keer geprobeerd, een 4xx
  niet; elke overgeslagen lijst maakt de index onvolledig. Pas na de laatste pagina gaat de index naar KV: `compleet:true` alleen zonder enige
  waarschuwing, en een complete index wordt alleen door een complete vervangen (anders blijft hij staan en volgt 120 s pauze). Een nieuwe start
  neemt een opbouw zonder voortgang van 5 min over. Zonder DO-binding (oude deploy) valt de worker terug op één opbouw per verzoek-taak met een KV-slot.
  **Een Moneybird-429 is terminaal:** geen retries, geen verdere pagina's, de DO-opslag wordt leeggemaakt, en de **echte Retry-After** (seconden óf
  HTTP-datum; onleesbaar of verleden = 60 s; productplafond **24 uur**) wordt de pauze (`zoek:mb:pauze`, reden 429). De bestaande index blijft onaangetast
  en in gebruik; zonder index antwoordt de route 429 met `Retry-After` (andere pauze-redenen: 503 `moneybird-onbereikbaar`). De zoekbalk toont lange
  wachttijden leesbaar ("over 2 uur").
- **SharePoint:** Graph drive-search (`/drives/<PROJ_DRIVE>/root:/Nieuwe mappenstructuur:/search(q='…')`) met het Graph-token van de gebruiker;
  alleen treffers waarvan de webUrl in `Nieuwe mappenstructuur` ligt; de klant komt uit de webUrl (de drive-search geeft geen parentReference.path).
Volgorde in de lijst: lokale groepen, E-mail, Moneybird, SharePoint.

### Event-delegatie voor NIEUWE code (S7-conventie, sinds 3-7)

Nieuwe interactieve elementen krijgen **geen inline `onclick`** meer, maar een
`data-action`-attribuut dat één gedelegeerde listener afhandelt. Reden: het
CSP-pad (inline handlers verbieden) blijft zo open, en handlers zijn testbaar/
buiten de HTML-string te houden. Bestaande inline-`onclick`'s worden **niet**
massaal omgezet — alleen meegenomen in code die je voor een andere reden (bv. S6)
toch aanraakt. Patroon:

```html
<button data-action="verwijder-project" data-code="INT-KANTOOR-KEUKEN">×</button>
```
```js
// één keer, per tab-container of document:
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'verwijder-project': verwijderProject(el.dataset.code); break;
    // …
  }
});
```

Waarden reizen via `data-*` (geen string-interpolatie in `onclick`, dus geen
`.replace(/'/g,"\\'")`-ontsnapping meer nodig — vgl. audit-bevinding Q5).

## Repo & paden

| Wat | Pad / waarde |
|---|---|
| Werkkopie (lokaal, SharePoint-sync) | `C:\Users\<naam>\Mortise & Tenon\Mortise & Tenon - On-Prem-Data\Applicaties\Claude\` |
| Junction zonder spaties/`&` | **`C:\MT`** → dezelfde map (gebruik dit voor scripts/scheduled tasks) |
| Git remote | `https://github.com/MTBart/MT-Facturatie-tool.git` (**PUBLIC**) |
| Push-branch | `main` (push alleen met Bart-akkoord per actie) |
| Live site | `https://mtbart.github.io/MT-Facturatie-tool/` (+ `/v2.html`, `/mobiel.html`, …) |
| Worker | `mt-claude-proxy` → `https://mt-claude-proxy.bart-a12.workers.dev` (bron: `worker.js`) |

> Commits **altijd via deze SharePoint-repo**, nooit via een losse kloon. Beide
> PC's zien hetzelfde pad. Syntaxcheck vóór commit:
> `node "C:\MT\Claude-context\_syntaxcheck.js" "C:\MT\<bestand>.html"`.

## PC-namen

- **thuis-PC = `DESKTOP-LA2A33H`** — Claude Code-terminal, `.mt-secret`,
  Bart-PKA-vault, email-forward-scripts, gesyncte repo.
- **werk-PC = `KANTOOR`** — waar Bart overdag zit, zelfde SharePoint-sync.
  Gelijktijdige edits → `-DESKTOP-LA2A33H`-conflictkopieën (niet mergen; één
  bron tegelijk bewerken).

## Architectuur — drie wegen vanuit de browser

```
cockpit / app (browser, MSAL-login @mortiseandtenon.nl)
 ├─ 1. Cloudflare Worker  → Moneybird / Toggl / Claude   (secrets blijven server-side)
 ├─ 2. Microsoft Graph    → SharePoint-data + projectmappen + mail (direct, met MSAL-token)
 └─ 3. localStorage       → cache, concepten, offline retry-queue
```

### Weg 1 — de Worker (`worker.js`)

Auth per request: **`X-Auth-Token`** (MSAL-ID-token; Worker controleert
handtekening RS256/kid, exp, nbf, tid, iss (v2, tenant `15b652c3…`), aud
(client `a091db96…`) en oid). De `X-Claude-Key`-bypass is weg (F1b, geen
gebruiker gevonden). CORS exact voor `https://mtbart.github.io`, `https://tool.mortiseandtenon.nl` en
`https://mt-tool.pages.dev`; een onbekende of ontbrekende `Origin` krijgt **geen** `Access-Control-*`-headers
(alleen `Vary: Origin`), dus de oude origin wordt niet meer gespiegeld.

**Koersmeter-ochtendrun (A+A2, blok G) — Cron Trigger + `GET /geld/koers/meldingen` + `POST /geld/koers/gelezen` + `GET /geld/koers/cron`.**
- **Venster (het werk begint om 07:00; de melding moet dan klaar zijn):** `scheduled()` draait elke 30 minuten van 03:00 tot 05:30 UTC (`[triggers]`: `*/30 3-5 * * *`). De code kijkt naar de
  lokale tijd in Europe/Amsterdam (zomer- en wintertijd kloppen vanzelf):
  - **04:00 tot 05:30 lokaal: voorverversing** (`koersVoor`): alleen de caches vullen (de volledige tijdlijn van vandaag in KV en de maandcijfers), binnen één run van 45 subrequests.
    Geen claim, geen dagfoto, geen melding, de 3 pogingen blijven onaangeroerd. Zomer is dat één trigger (05:00), winter drie (04:00, 04:30, 05:00).
  - **05:30 tot 07:00 lokaal: de run.** Poging 1 om 05:30, poging 2 om 06:00, poging 3 (reserve) om 06:30 (zomer 03:30/04:00/04:30 UTC, winter 04:30/05:00/05:30 UTC), als de dag nog niet klaar is
    en er minder dan 3 pogingen zijn gedaan. Vanaf 07:00 lokaal doet geen trigger meer mee.
  - Normale dag (de cijfers van eerdere maanden staan in KV): voorverversing 05:00 en de run om 05:30 is klaar bij poging 1 (±13 subrequests). Koude cache (bv. de eerste dag na de uitrol): de run is
    klaar uiterlijk bij poging 2 (winter, getest) of 3 (zomer); lukt het dan nog niet, dan sluit poging 3 af met een oordeel "onbetrouwbaar", nog steeds vóór 07:00.
- **Dagclaim (atomair):** Durable Object `MT_KOERSDAG` (class `MtKoersDag`, migratie `v4-mt-koersdag`), één instantie `koers`, per datum `{ status: bezig | klaar | mislukt,
  pogingen, token, ts, fout, kleur, gemeld }`. `claim` geeft de run aan hooguit één trigger tegelijk (een `bezig` van < 20 min wordt nooit overgenomen; een afgebroken run
  telt als poging), `afrond` mag alleen de claim-eigenaar (token). Dagfoto en melding schrijft alleen de claim-eigenaar. Zonder de binding doet de cron niets (`geen-dagclaim`).
- **Retry:** mislukt of onvolledig (Moneybird-hapering in de tijdlijn, cijfers onvolledig, budget op) en er is nog een poging over: niets bewaren of melden, claim op `mislukt` met de
  fout; de volgende trigger probeert opnieuw. De laatste poging (3) sluit altijd af, met een oordeel dat dan zo nodig "onbetrouwbaar" is. De status per dag staat in `GET /geld/koers/cron?dagen=7`
  (recht `geld`; geen tokens of bedragen) en in de logregel `koerscron`.
- **Subrequest-budget:** gratis plan = 50 per invocation, KV + Moneybird + Durable Object tellen allemaal. Eén gedeeld budget per run (`koersBudget`): harde limiet 45, waarvan 5 gereserveerd voor
  afronden (dagfoto, melding, claim). KV-binding en Moneybird-`fetch` (`geldMb`) tellen mee via `env.__sub`; de lokale budgetten van tijdlijn en cijfers volgen het restant (`geldBudget`).
  Budget op = die aanvraag wordt geweigerd, het oordeel wordt "onbetrouwbaar" (nooit groen), nooit een crash.
- **Cache vóór Moneybird:** de maandcijfers komen uit de KV-cache; alleen wat ontbreekt wordt aangehaald met het restant (één ronde, geen vervolgrondes). De volledige tijdlijn van vandaag
  wordt door de voorverversing (of poging 1) bewaard (`geld:koers:tijdlijn:<datum>`, 6 uur) zodat de volgende run het budget aan de cijfers besteedt. Een tijdlijn met een Moneybird-hapering wordt nooit bewaard.
  Koude cache (alle maanden ontbreken): ontbrekende maanden worden over de voorverversingen en pogingen aangevuld; lukt het niet in 3 pogingen dan is het oordeel die dag onbetrouwbaar.
- De run roept `/geld/tijdlijn` (vers), `/geld/config` en `/geld/cijfers` intern aan als eigenaar en rekent met dezelfde `mt-geld.js`/`mt-koers.js`
  als het scherm (dynamische import; `K.invoer` → `K.oordeel` → `K.dagfotoOpslag`, `K.moetMelden`, `K.actie`): geen tweede rekenlogica.
- G7 (besteedbaar budget): de kasruimte rekent op `G.kasLijn` = de lijn van het besteedbaar budget (lopend − (btw_verschuldigd − dekking); btw uit de aangifte-events `bron:'btw'`, schatting ±10%; dekking = alleen wat de worker als `:terug`-event
  (terugboeking van de BTW-pot, `btw.modus:'apart'` + `terugboeking_van`) aan de aangifte koppelt, dus zonder terugboeking 0), zonder noodbuffer
  (het vinkje "Noodbuffer meenemen" in Geld werkt niet door in de Koersmeter). Onderkant = de gele lijn (fictieve buffer: een eigen bedrag in `cfg.fictieve_buffer`, anders het berekende advies — `G.effCfg`); zonder beide de eigen ondergrens `buffer_lopend`, anders 0.
  Het streefniveau van lopend en de streefomvang van de noodbuffer volgen eveneens standaard het advies; een eigen bedrag wint, leeg = weer het advies. `cfg.streef_herkomst` (afgeleid door de worker) legt per bedrag vast of het `advies` of `handmatig` is, met datum en naam van de laatste wijziging;
  de Koersmeter en de kaarten tonen "(volgt advies)" of "(eigen bedrag)".
  `POST /geld/config` accepteert `fictieve_buffer` (getal ≥ 0 of null). Het bedrag staat nergens in Geld behalve in Instellingen, en ook niet in de dagfoto of ochtendmelding.
- KV: de dagfoto `geld:koers:dag:<datum>` (met `via:'cron'`), bij verslechtering `geld:koers:melding:<datum>` (hooguit één per dag, nooit overschreven),
  `geld:koers:gelezen:<oid>` (per gebruiker tot en met welke datum afgevinkt). Meldregel: `K.moetMelden` (slechtere kleur, nieuwe onvolledige bron, kasruimte ≥ € 5k lager).
  Onvolledige bronnen: nooit groen ("Oordeel onbetrouwbaar"), met een melding alleen als het oordeel gisteren betrouwbaar was.
- Rechten: alleen met recht `geld` (eigenaar en administratie) lezen; afvinken mag ook de administratie (eigen markering). Het scherm toont de ongelezen
  meldingen bovenaan Geld; mobiel een badge op de €-knop (`geldBadgeLaad`).
- Een mislukte run gooit niet (logt `koerscron`).

**Potstand (`GET /geld/tijdlijn`, `saldo.potten.<id>`).** Potstand = ijkpunt + wat er sinds de ijkdag echt tussen lopend en de pot is overgeboekt (inleg: lopend → pot, opname: pot → lopend);
een mutatie van op of vóór de ijkdag telt niet. Geldt voor alle potten (BTW, buffer, winst, vakantie). Herkenning van een overboeking, in volgorde: (1) alle boekingen op het pot-grootboek;
(2) de EXACTE tegenrekening van de pot (`herkenning.tegenrekening`; een IBAN, geen losse letter), of, als de bank GEEN tegenrekening meegeeft (overboekingen tussen eigen rekeningen), de letter in de naam van de tegenpartij "Zakelijke oranje spaarrekening <letter>" (regex `/spaarrekening\s+([A-Z])(\d{6,})?\s*$/i`: de letter, met of zonder het rekeningnummer van de spaarrekening erachter, bv. "…spaarrekening Z12345678"; staat dat nummer, met of zonder letter, als `tegenrekening` bij een pot, dan herkent het die pot ook) die bij één pot hoort: `herkenning.letter`, anders de letter waarmee de naam, de omschrijving of het id van de pot eindigt ("BTW Z"); een letter bij twee potten is onzeker, een letter bij geen pot is "niet herkend" (onvolledig, met de naam erbij), ook als de mutatie geboekt is, ook als de mutatie elders is geboekt (`geboekt_elders`) en ook als het IBAN alleen in de omschrijving staat (bij een lege
tegenrekening); een mutatie die aan een factuur hangt is nooit stil intern (pot onzeker). Per pot staat in `beweging` waar de stand vandaan komt: `{ sinds, start, inleg, n_inleg, opname, n_opname,
mutaties[≤30, nieuwste eerst] }`; de Geld-kaart "Nu" toont dat als "BTW-pot € 7.533 (ijkpunt 7 okt € 24.542 − opname 8 okt € 23.500 + inleg 9 okt € 6.338)" met een tik naar de mutaties.
Niet herkend maar lijkt een overboeking tussen eigen rekeningen (geen boeking, geen factuur; naam met spaar/online bankieren/eigen rekening/interne overboeking, of een tegenrekening zonder naam) of
de tegenrekening hoort bij een inactieve pot: `intern_vermoed` + een waarschuwing met `onvolledig: true` (met de IBAN's en het netto bedrag), de pot en het totaal worden `onzeker` (met reden) en de
Koersmeter krijgt een onvolledige bron (kas-meter onbekend, oordeel nooit groen). Is de stand van de BTW-pot onbekend, dan zegt de kaart "Nu (alleen lopend, BTW-pot onbekend)".
Verwachte inleg (weekinleg, BTW-sparen 21/121 van openstaande facturen en prognose) wordt alleen voor vandaag en later ingepland, en niet voor een week waarin al is ingelegd.

**Klantenlijst — `GET|POST /klanten` (F5).** Bron = KV `klanten:registry` (niet meer een bestand in de repo).
- `GET`: iedereen met een rol (modus `afdwingen`: zonder rol 403 `geen-toegang`). In modus `log` mag een
  **rolloze** GET nog wel, maar wordt apart geteld/gelogd als `klanten.zonder_rol` (alleen oid-hash, geen naam of
  token; zichtbaar in `/beheer/log`). Antwoord `{klanten, bijgewerkt, rev}`; nog geen lijst → 404 `geen-klantenlijst` met `rev: 0`.
- `POST` (alleen beheer): body `{klanten:[…], rev}`. `rev` = het getal uit de laatste GET en is verplicht; is hij
  verouderd, dan **409** `verouderd` (met de huidige `rev`) en blijft alles bewaard. Streng: onbekende velden
  (ook op het hoogste niveau van de body) → 400; `code`, `naam` en `mb_contact_id` moeten tekst zijn (`mb_contact_id`
  ook `null`) — een getal geeft 400, want een 18-cijferig id rondt in JSON af. Opgeslagen wordt de canonieke vorm
  (getrimde teksten). Elke vorige stand gaat naar `klanten:registry:historie:*`; auditlog zonder namen.
  Schrijven loopt via de Durable Object `MT_KLANTEN` (class `MtKlanten`, migratie `v3-mt-klanten` in wrangler.toml): één object
  serialiseert alle writes en doet het compare-and-set op `rev` (KV heeft geen CAS). Gelijktijdig, zelfde `rev`: precies één wint,
  de rest krijgt 409. De `rev` van het object is leidend, maar een hogere `rev` die in KV is gezet (release-stap) wordt meegenomen
  (max van beide). Zonder binding geeft POST 503 `geen-klanten-opslag` (GET blijft werken uit KV); een KV-schrijffout geeft 503 en de rev schuift niet op.

**Rollen (F1):** rol per oid in KV `MT_ROLLEN` (Eigenaar / Beheerder / Kantoor /
Werkplaats / Alleen lezen), `requirePermission` per target. Modus `ROLLEN_MODUS`:
`uit` | `log` (alles door, "zou geweigerd" loggen + dagteller) | `afdwingen` (403).
Extra routes: `GET /me` (rol + rechten), `POST /toegang` (toegang aanvragen),
`/beheer/*` (gebruikers, uitnodigen, rol, (de)activeren, audit, log) — beheer en
`/track/online|usage` zijn in elke modus alleen voor Eigenaar/Beheerder.
**F1e:** `GET|POST|DELETE /mijn/toggl` — eigen Toggl-sleutel koppelen (live gevalideerd, AES-GCM
versleuteld per oid met `SLEUTEL_KEK`, nooit terug naar de browser); Toggl-sleutel per verzoek:
eigen → `TOGGL_*_<NAAM>` → gedeeld. `GET /aanwezig` (alle rollen, altijd met rol) — lopende timer
per teamlid (projectnaam, taak, sinds; geen duur of omschrijving), 60 s cache.

**F2 — proxy-contract.** `PROXY_CONTRACT` in worker.js is de allowlist van wat de UI echt doet
(inventaris van alle 130 aanroepen in v2, mobiel, toggl2 en mt-*.js): per target methode +
padpatroon + toegestane query-sleutels + max body. Moneybird alleen eigen administratie; Toggl
alleen eigen werkruimte/organisatie; geen volledige URL's; DELETE alleen waar de UI hem gebruikt
(MB inkoopfactuur, Toggl clients/tags/time_entries, Focus tasks/time-entries); claude alleen
haiku/sonnet, max_tokens ≤ 4096, geen tools. `PROXY_MODUS`: `log` (standaard: afwijking loggen +
tellen, zichtbaar in `/beheer/log`) | `afdwingen` (403 `buiten-contract`) | `uit`.
Nieuwe UI-aanroep = eerst een regel in `PROXY_CONTRACT` (anders in `afdwingen` geweigerd).

**F3 — bevestiging.** Elke Moneybird-schrijfactie vraagt in de UI eerst bevestiging (wie / wat /
contact / bedrag) en draagt dan `X-MT-Bevestiging: <id>`; zonder header → afwijking `geen-bevestiging`.
Let op: dit is een UI-/auditmarkering, géén beveiligingsgrens (een aanroeper kan zo'n id verzinnen);
de grenzen zijn de rolmatrix, het contract en de concept-only-regels.

**F4 — idempotentie.** `X-MT-Actie: <id>` op een Moneybird-schrijfactie: de worker voert hem per
gebruiker maar één keer uit (Durable Object `MT_ACTIES`, atomair; zonder binding KV `actie:{oid}:{id}`, 24 u;
zelfde id met andere inhoud = 409 `actie-andere-inhoud`). Herhaling = hetzelfde antwoord
(`X-MT-Herhaald: 1`); time-out/5xx = `actie-onzeker` (409) → de UI zoekt het concept op (contact +
referentie, laatste 24 u) en toont "controleer concept" i.p.v. opnieuw te posten.

| `?target=` | Doet | Token |
|---|---|---|
| `claude` | Anthropic `/v1/messages` (SSE-stream) voor in-app chat | `CLAUDE_KEY` |
| `moneybird` | MB API v2, pad via `?path=` (GET/POST/PATCH) | `MONEYBIRD_KEY` |
| `moneybird_upload` | MB multipart-upload (bijlages) | `MONEYBIRD_KEY` |
| `moneybird_download` | factuur-bijlage → base64 | `MONEYBIRD_KEY` |
| `toggl` | Track API v9 | **per-user** `TOGGL_KEY_<NAAM>`, fallback `TOGGL_KEY` |
| `toggl_focus` | Toggl 2.0 (Focus) API | **per-user** `TOGGL_FOCUS_KEY_<NAAM>`, fallback `TOGGL_FOCUS_KEY` |
| `toggl_admin_projects` | volledige workspace-projectenlijst; **GET-only + pad-whitelist** (alleen `workspaces/<id>/projects`) — gewone tokens zien privé-projecten zonder lidmaatschap niet | admin `TOGGL_KEY` |
| `toggl_reports` | Reports API v3 (aggregeert over álle gebruikers) | admin `TOGGL_KEY` |

**Toggl-capaciteit voor de projecttijdlijn (alleen lezen, `GET O/capacities/users`).** Wat bewezen is en wat niet:
- *Bewezen* (3-4 okt, met een sleutel die ver vooruit mocht kijken; vastgelegd in Deliverables/2026-10-03-toggl-planner-capaciteit-api.md): het endpoint bestaat, `unit=day` werkt en het antwoord is `[{id, type:'user', computations:[{date, working_minutes, estimated_minutes, time_off_minutes, …}], task_estimates}]`. Beschikbaar = `working_minutes` (al netto van feestdagen en verlof), vrij = `working_minutes − estimated_minutes`.
- *Niet bewezen*: (1) dat de sleutel waarmee de worker NU aanroept (per gebruiker `TOGGL_FOCUS_KEY_<NAAM>`, anders `TOGGL_FOCUS_KEY`) het mag. Het endpoint is afgeschermd: 402 bij een plan zonder de functie, 403 zonder rechten; of een gewone gebruiker de uren van collega's ziet is niet vastgesteld (sleutel- en rolafhankelijk). (2) Een kommalijst in `user_id`; de app vraagt daarom per persoon één `user_id` op (parallel, hooguit zes aanroepen per sessie en periode, uitkomst gecachet; een mislukte persoon wordt 5 minuten niet opnieuw geprobeerd).
- *Gedrag in de app*: per persoon Toggl als alle werkdagen (ma-vr) van die week binnenkomen, anders de capaciteit uit Beheer (werkuren − verlof − vrije dagen). De legenda van de projecttijdlijn zegt welke bron gebruikt is en waarom Toggl niet (`402: jullie Toggl-abonnement heeft capaciteit niet`, `403: geen rechten`, `onverwacht antwoord`, `HTTP …`). **De eerste keer dat iemand met een echte sleutel een projecttijdlijn opent is dus het bewijs**: staat er "capaciteit: Toggl", dan werkt het voor die gebruiker; staat er "— Toggl: 403 …", dan niet en blijft de Beheer-terugval gewoon staan. Er is geen aparte knop en niets dat schrijft.
- *Worker*: geen wijziging nodig; het contract kent `O/capacities/users` al met de queryparameters `user_id`, `unit`, `start_date`, `end_date` (dubbele sleutels worden geweigerd).

#### Tracking-routes (pad-gebaseerd, niet `?target=`)

Usage-/presence-tracking. Auth = zelfde Worker-auth (MSAL-token of server-key).
Server bepaalt de `user` uit het MSAL-token (client kan niet als iemand anders
loggen). Schema + privacy-grens: zie `TRACKING.md`. Opslag: **D1** (`TRACK_DB`,
tabel `events`) + **KV** (`TRACK_KV`, presence met 90s TTL) — server-side,
nooit in de repo.

| Route | Methode | Doet | Wie |
|---|---|---|---|
| `/track` | POST | batch events → D1 (`{events:[{sessionId,event,action,detail,ok,ms,ts,appVersion}]}`) | alle ingelogde gebruikers |
| `/track/heartbeat` | POST | presence in KV (`presence:<user>`, TTL 90s, laatste tab) | alle ingelogde gebruikers |
| `/track/online` | GET | wie nu online is (KV-scan) | **admin-only** (Bart) |
| `/track/usage?range=today\|7d\|30d` | GET | aggregaties uit D1 (per functie/gebruiker/dag, sessies, mislukt-%) | **admin-only** (Bart) |

Admin-gate = e-mailclaim `bart@mortiseandtenon.nl` (`TRACK_ADMIN` in `worker.js`).
Front-end: `track.js` (batcht + heartbeat) + Activiteit-tab in de cockpit
(alleen voor Bart zichtbaar).

Per-user mapping (`userKey()`): e-mailprefix uit het MSAL-token →
`TOGGL_KEY_MATHIJS` enz. Zo klokt iedereen op eigen naam; geen token client-side.

### Weg 2 — Microsoft Graph (direct vanuit de browser)

- **Gedeelde tool-data:** `_SP`-laag (synckern uit `mt-core.js`, zie boven) → site
  `mortisetenon.sharepoint.com/sites/MortiseTenon`,
  default drive (Documenten), map **`MT-Bedrijfstool/`**. Patroon: read-merge-write
  JSON-bestanden (zie tabel hieronder), dedup op `id`. Sinds 2-7 faalveilig:
  alleen HTTP 404 telt als "bestaat nog niet"; elke andere leesfout blokkeert
  migratie én auto-sync voor die key (anti-clobber) en de cockpit re-hydrateert
  na >10 min verborgen tab.
- **ETag-concurrency (S1, proef op `mt_planning`):** `_SP.read` bewaart per
  bestand de `ETag` (`_SP._etags`), `_SP.write` stuurt `If-Match` mee voor keys in
  `_SP.etagKeys` (nu alleen `mt_planning`). Bij **HTTP 412** (andere PC schreef
  ertussenin): re-read → merge → herschrijf met verse ETag; bij gelijke sleutel
  wint **lokaal**. Merge is vorm-bewust: array-van-`{id}` per id, plain object/map
  per sleutel (`mt_planning[code]`). Niet-mergebare vorm → géén blinde overwrite:
  toast "sync-conflict, herladen" + write vervalt tot de volgende schedule na
  re-hydrate. Gespiegeld in v2.html én mobiel.html; 412 gaat op mobiel **niet**
  terug in `_RQ` (geen retry-loop). Alle overige keys: ongewijzigd last-write-wins.
  Uitrol naar meer keys volgt.
- **Projectmappen:** drive **On-Prem-Data** (`_SPProj.DRIVE = b!lTex…yoejLeBe`,
  "Nieuwe mappenstructuur"). `findProjectFolder(code)` zoekt drive-bewust:
  eerst On-Prem-drive, fallback site-default drive; gevonden `driveId` wordt
  per projectcode onthouden (`_projDriveMap`) en alle vervolg-calls gebruiken
  die (`_projDrive(code)`). Paden via `_encPath()` (encodeert ook `#`/`?`).
  Foto-uploads → `<projectmap>/06_Fotos/` met prefix (`opname_`/`aangetroffen_`/
  `opgeleverd_`), conflictBehavior=rename, dedupe op naam+grootte.

### Weg 3 — localStorage + offline retry

- Retry-queue `_RQ` (key `mt_retry_queue`), flush bij login/online/voorgrond/60s.
  Types: `feedback`→fbUpload, `oplevering`→oplUpload, `notitie`→noteUpload,
  `opname`→opnUpload. Toggl-writes bewust uitgesloten (geen dubbele klok-entries).
- Timer-state (`togglEntryId` e.d.) overleeft app-herstart; server-vangnet via
  `me/time_entries/current`.
- Rapport-concepten: `mt_rapdraft_<code>` lokaal + gespiegeld op SP.

## SharePoint-databestanden (`MT-Bedrijfstool/`)

| Bestand | Schrijver | Lezer | Inhoud |
|---|---|---|---|
| `mt_user_projects.json` | app | app/cockpit | in de tool aangemaakte projecten |
| `mt_proj_adressen.json` | app | app | adres-overlay per projectcode |
| `mt_app_taken.json` | app | app/cockpit | taken (gesynct met Toggl 2.0; Toggl wint) |
| `mt_notities.json` | app | app (cockpit-weergave = backlog) | veldnotities + foto-refs |
| `mt_opnames.json` | app | cockpit (consumer = backlog) | opnamerapporten (inmeten) |
| `mt_opleveringen.json` | app | cockpit/nacalc | opleverrapport-log + foto-namen |
| `mt_rapport_concepten.json` | app | app | tussentijds opgeslagen oplever-concepten |
| `mt_notificaties.json` | cockpit | app (poll 90s, per-user `voor`-filter) | admin-notificaties + deep-link |
| `mt_feedback.json` | app | uitleeslus = backlog | feedback-tab input |
| `mt_projecten.json` | cockpit | cockpit | projectenregister cockpit |
| `mt_adminconfig.json` | cockpit | cockpit | admin-instellingen |
| `mt_verlof.json` / `mt_vrijedagen.json` | cockpit | cockpit | planning-laag |
| `mt_planblokken.json` | cockpit | cockpit | planning-blokken |
| `mt_auditlog.json` | cockpit | cockpit | admin-audit |
| `mt_klant_codes` (SP-synced store) | cockpit | cockpit | zelflerende KLANT-code-overrides |

## Verhuisknop (`mt-verhuis.js`, F5 stap 2) — uit tot het domein gekoppeld is

Zet de lokale gegevens van één apparaat over van het oude naar het nieuwe adres (browseropslag is per adres). Alleen aan met de
proefvlag `localStorage.mt_verhuis_proef = '1'`. Het oude adres wordt nooit leeggemaakt.
- **Pakket:** een expliciete lijst localStorage-sleutels (`V.SLEUTELS` = 60 sleutels, `V.PREFIXEN` = 10 prefixen, `V.UITGESLOTEN` = bewust niet; alles daarbuiten is "onbekend" en wordt in het paneel bij naam genoemd; geen tokens, caches of timers; een sleutel met een
  JWT of kale base64-waarde gaat nooit mee) + IndexedDB `mt-rapporten` (fotos, drafts) en `mt-app` (drafts), checksums per onderdeel en per foto.
  Een nieuwe localStorage-sleutel in de code moet in die lijst of bewust in de uitsluitingen van `b-verhuis-harness.js` (de test faalt anders).
- **SharePoint:** `MT-Bedrijfstool/_verhuizing/<Entra oid>/<apparaat>-<tijd>-<uuid>/` — eerst `blobs/*`, als laatste `pakket.json`
  (`conflictBehavior: fail`; dat bestand = "compleet"). Grote bestanden via een uploadsessie in brokken van 5 MiB, elk brok 3 pogingen met `nextExpectedRanges`.
  De lijst op het nieuwe adres toont alleen pakketten met een manifest waarvan alle foto's bestaan en dat bij de ingelogde oid hoort.
- **Importeren:** alleen een pakket van dezelfde oid; alles of niets (journaal van wat deze run toevoegde, bij een fout precies dat terug;
  het journaal staat ook in localStorage `mt_verhuis_journaal`, vastgelegd VÓÓR elke schrijfactie: localStorage = sleutel + vingerafdruk; IndexedDB = per store eerst de kandidaat-records (alleen keys die er nog niet waren, met een vingerafdruk van de inhoud), dan de add-transactie, dan de bevestiging. Na een tab-crash draait de volgende import eerst terug wat het journaal kent; zelfs bij een crash tussen "transactie klaar" en "bevestigd" ruimt het herstel alleen kandidaten op die er nu staan met exact dezelfde inhoud);
  IndexedDB `add()` in één transactie per store (ConstraintError = "al aanwezig"), localStorage met hercontrole. Herstel én import draaien binnen `navigator.locks.request('mt-verhuis-import', exclusief)`: twee tabbladen kunnen nooit tegelijk schrijven, het slot verdwijnt met een gesloten tab (dus een gecrashte import is direct te herstellen). Zonder `navigator.locks` wordt er NIET geïmporteerd (melding, geen terugval).
- **Schema:** `MTFotoStore.SCHEMAS` (mt-fotostore.js) is de ene definitie; de verhuizer verhoogt nooit een databaseversie en stopt met een melding als er een store ontbreekt.
- **Grootte:** het paneel toont de totale grootte; het download-vangnet is op een telefoon uit boven 150 MB.
- **Oud adres na verhuizen:** alleen-lezen-balk met de eerlijke tekst en de knop "Nieuw pakket maken".

## Projecten & toewijzing (sinds 12-6)

App-projectenlijst = **admin-route** (`toggl_admin_projects`, alle projecten,
ook privé) + **`me/projects`** met eigen token (= écht toegewezen).
`assigned` stuurt: picker-groepering, Projecten-tab-filter
(Alle / Toegewezen / Niet toegewezen), sortering toegewezen-eerst + A-Z.
Admin-route niet beschikbaar → fallback naar per-user `workspaces/<id>/projects`
(dan ziet je alleen je eigen zicht — het oude gedrag/Mathijs-bug).
Projectcode zit als `[CODE]`-suffix in de Toggl-projectnaam.

## Deployen

- **Front-end:** `git push origin main` → GitHub Pages herbouwt ~5 min.
  **Push alleen met expliciet Bart-akkoord per actie** (commits lokaal mogen).
- **Worker:** `wrangler deploy` vanuit `C:\MT` (wrangler 4.x op thuis-PC).
  **Ook deploy en `wrangler secret put` alleen met expliciet Bart-akkoord.**
  Secrets nooit in de repo; zetten via `wrangler secret put <NAAM>`.

## Veiligheid (repo is PUBLIC)

- Twee sloten: geharde `.gitignore` + version-controlled `githooks/pre-commit`
  (secret-guard; `git config core.hooksPath githooks` na re-clone). De hook
  maakt ook backups en werkt `CHANGELOG.md` bij.
- Echte secrets **uitsluitend** in `C:\Users\BartWitte\.mt-secret\` — buiten de
  repo én buiten OneDrive/SharePoint. Nooit tokens in chat/markdown/commits.
- Nooit PII committen. Audit-commando: zie `REPO-VEILIGHEID.md`.
- In-app chat (Larry in de tool) mag niets aan de tool/mappen wijzigen —
  hooguit helpen een project aan te maken; al het chatgebruik wordt gelogd
  (feedback-/leerlus).

- BTW-kwartalen (G7, Codex): `geldBtwAangifte` bouwt alle kwartalen van vorig en dit jaar op die niet aantoonbaar betaald zijn. Automatisch betaald ALLEEN bij een negatieve mutatie aan een tegenpartij met "Belastingdienst" in de naam, waarvan de HELE omschrijving (message, verankerd) "Btw aangifte Kwartaal N JJJJ" is, voor precies dat kwartaal (dezelfde zin in de tegenpartijnaam of midden in een langere omschrijving telt niet) (het kwartaal komt uit de tekst, niet uit de betaaldatum; de betaling ligt na het kwartaaleinde).
  Geen betalingskenmerken, geen btw-document-koppeling, geen bedrags- of venstergok: dat liet een schuld wegvallen door een willekeurige mutatie. Volledig betaald = het betaalde bedrag ≥ de aangifte − € 1 (geen procentuele marge); anders blijft het exacte restant open met `onvolledig_reden:'deels betaald'`.
  Al het andere is open + `onvolledig:true` (`'betaling niet gevonden'`, waarschuwing `bron:'btw-schuld'`: permanent, geen zinloze nieuwe cron-pogingen; het oordeel is onbetrouwbaar) tot de eigenaar het kwartaal als betaald markeert (`btw.betaald_kwartalen`, JJJJ-K1..K4, max 12; knop in de uitleg van Besteedbaar). Teruggaven (positief) tellen nooit als betaling.
  Moneybird-verzoeken: lopend en vorig kwartaal altijd, van de oudere hooguit twee per aanroep (nieuwste eerst; afgesloten bedragen 7 dagen in KV `geld:btw:kwartalen`, het vorige kwartaal 1 uur); gemarkeerde kwartalen kosten geen verzoek.
  `buffer_lopend` en `fictieve_buffer` zijn één instelling: één genormaliseerde waarde (≥ 0) in beide velden (dual-write, één release); een negatieve `buffer_lopend` wordt geweigerd (400), een negatieve oude waarde in de opslag telt niet.
  Het front-end-advies (fictieve buffer, streef noodbuffer, streef lopend) wordt per dag onthouden met een revisie van de brondata en de config; verandert die, dan wordt het opnieuw berekend.

**Ontvangsten in de tijdlijn (▲).** Een open VERKOOPfactuur zonder factuurdatum of zonder factuurnummer (concept, nooit verstuurd, of een inkoopfactuur die per ongeluk als verkoop is aangemaakt) telt niet als verwachte ontvangst: het event blijft zichtbaar (`telt_niet.soort='concept'`, `delta` 0) met een waarschuwing "verkoopfactuur zonder datum/nummer: controleer in Moneybird" en de link. Een INKOOP-creditnota (negatieve inkoopfactuur) wordt verrekend met de open inkoopfacturen van DEZELFDE leverancier (`contact_id`, vroegste vervaldag eerst; nooit met verkoopfacturen) en geeft dan geen ▲; wat overblijft is "tegoed bij leverancier" (`tegoed`, `telt_niet.soort='tegoed'`, `delta` 0). `POST /geld/override {soort:'inkoop', type:'tegoed'}` laat dat tegoed per creditnota wél als ontvangst meetellen (vinkje in het detail; `wissen` zet het terug). `GET /geld/audit/ontvangsten` (alleen eigenaar, alleen lezen) levert alle ▲-posten met bron, contact, bedrag, datum, de classificerende regel en vlaggen (`contact_ook_leverancier`, `zonder_datum_of_nummer`, `negatieve_inkoop`, `telt_niet`); de tijdlijn geeft de verrekeningen in `verrekend`.
Zonder stabiele leverancier-id (`contact_id`) kan een inkoop-creditnota nooit verrekend worden en telt hij nooit als ontvangst (`tegoed` + `tegoed_onbekend`, `delta` 0, ook niet met het vinkje) en de bron wordt onvolledig gemeld. Een factuur in vreemde valuta zonder geldig bedrag in euro (de `*_base`-velden; verkoop ook het open bedrag, inkoop ook de betalingen) valt buiten de cashflow én buiten de verrekening (`telt_niet.soort='valuta'`, `valuta_onzeker`) en meldt de bron onvolledig. In de compacte mobiele Geld-weergave staat ook de kaart "Ruimte op laagste punt" (alleen lezen).

**F6, AI-limieten (`?target=claude`).** Eén serversleutel (`CLAUDE_KEY`); per verzoek toetst de worker een limiet per gebruiker via de teller-DO (`MT_TELLER`, eigen instantie `ai`, geen aparte migratie): tokens per dag (invoer geschat, uitvoer = `max_tokens`, achteraf bijgesteld met het werkelijke gebruik uit de stream), verzoeken per minuut en gelijktijdige verzoeken, plus een dagplafond voor de hele tool. Weigering = 429 met `Retry-After` en `{type:'error', error:{type:'mt_ai_limiet', reden:'dag'|'minuut'|'gelijktijdig'|'totaal', message}}` (het formaat dat de app al leest). Een fout bij Anthropic geeft de reservering terug; een claim die nooit wordt afgerond vervalt na 5 minuten. Is de teller zelf kapot dan 503 (afdwingen) of doorlaten (log). Modus: wrangler-var `AI_LIMIET_MODUS` (`afdwingen` standaard, `log`, `uit`). Het logboek (300 regels, tellers 45 dagen) bevat nooit de inhoud: alleen tijd, gebruiker-hash, naam, rol, model, aantallen tokens, status en http. `GET /beheer/ai?dagen=7` (eigenaar en beheerder) toont gebruik, logboek en de geldende limieten; `POST /beheer/ai-limieten` (alleen eigenaar; `{totaal_dag?, rollen:{<rol>:{dag?,minuut?,gelijktijdig?}}}` of `{standaard:true}`; ongeldig of onbekend = 400) past ze aan (KV `instelling:ai_limieten`, audit zonder waarden). Standaard per dag: eigenaar 1,5 mln tokens, beheerder 1 mln, kantoor 600k, werkplaats 150k (beperkt), tool 4 mln; per minuut 30/20/20/10; gelijktijdig 4/3/3/2.

**G6, "Kan ik dit uitgeven?" en het maandagbericht.** In Geld (desktop en de compacte mobiele laag, dezelfde `mt-geld.js`) staat een kaart met een bedrag en een datum. `G.kanUitgeven(data, cfg, bedrag, datum, {nood})` rekent op de lijn van het besteedbaar budget (`G.kasLijn`), behoudend zonder prognose: de uitgave verlaagt de lijn vanaf de datum en het laagste punt daarna (eerste dag bij gelijke stand) bepaalt het antwoord: ja (boven de gele lijn of nul), onder-buffer, noodbuffer, krediet of nee, met het maximum op die datum, de vroegste dag waarop het wel past, een voetnoot als de prognose het antwoord verandert, en een waarschuwing na de laatste bekende ontvangst of bij onvolledige bronnen. Er wordt niets opgeslagen of ingepland. Het maandagbericht: de ochtendrun (`koersCron`) schrijft op maandag (lokale tijd) één bericht in KV `geld:koers:week:<datum>` (90 dagen; `K.weekbericht`: oordeel, besteedbaar, laagste punt over 8 weken, de grootste ontvangsten en betalingen van de komende 7 dagen zonder prognose, aandachtspunten en één actie), nooit overschreven, en alleen met een leesbare tijdlijn, config en oordeel. Past het schrijven niet meer in het subrequest-budget dan telt dat als een mislukte poging (volgende trigger). `GET /geld/koers/meldingen` geeft ze samen met de ochtendmeldingen (`soort: 'week'`; één list, hooguit 5 berichten binnen het venster gelezen); afvinken (`POST /geld/koers/gelezen`) geldt voor beide en voor de badge op de €-knop. Het bericht staat alleen in de app: er is geen route naar mail of derden.

F6, aanvullingen (Codex): een afgebroken stream (annuleren door de gebruiker, of een fout van de bron) wordt meteen afgerekend op wat al binnen was (invoer uit `message_start`, anders de schatting; uitvoer = het grootste van de gemelde usage en ±1 token per 3 getelde tekens) en de rest van de reservering gaat terug; een claim die nooit wordt afgerond vervalt na 5 minuten en boekt dan minstens de ongebruikte output-reservering terug (de invoerschatting blijft). Documenten worden naar bytes geschat (base64: 3 bytes per 4 tekens; tekstbron: per teken) en tellen als bovengrens mee met 1 token per 3 bytes (de oude schatting bytes/12 was te laag). Vooraf geweigerd met 413 (`mt_ai_te_groot`) in `afdwingen`, in `log` alleen gelogd: alle documenten samen boven de harde bytegrens van 400 kB (`AI_DOC_BYTES`, ±136.500 tokens; `AI_DOC_MAX` 150.000 tokens is de reservegrens) en documenten waarvan de grootte vooraf onbekend is (url-bron). **Opruimen zonder volgend verzoek:** een DO-alarm in `MtTeller` (instantie `ai`, `alarm()`) wordt bij een claim gepland op 5 minuten + 1 s (alleen als er nog geen alarm staat), rekent alle verlopen claims van alle gebruikers af (de ongebruikte output-reservering gaat terug, de invoerschatting blijft, logregel `verlopen` per gebruiker) en plant zichzelf op de eerstvolgende verloopdatum zolang er claims openstaan. De opruiming bij een nieuw verzoek (`aiRuimVerlopen`) blijft als tweede vangnet. Zonder teller-binding (`MT_TELLER`) geeft `afdwingen` een 503 en laat alleen `log` door (met een waarschuwing in het log). Het logboek en de tellers bevatten alleen de gebruiker-hash en de rol; `GET /beheer/ai` zoekt namen bij het tonen op en geeft ze alleen aan de eigenaar. Het plafond van 4096 tokens uitvoer (`max_tokens`) geldt alleen in `afdwingen`; in `log` en `uit` wordt niets ingekort en alleen gelogd wat begrensd zou worden (`ai: zou-begrenzen`).

**CSP.** (1) Afgedwongen, minimaal: elke pagina (`v2.html`, `mobiel.html`, `uren.html`, `index.html`) heeft als eerste element na de charset een meta-CSP `object-src 'none'; base-uri 'self'`. Dat blokkeert alleen `<object>`, `<embed>`, `<applet>` en een `<base>` naar een andere herkomst; er bestaat er geen in de app (getest), en de PDF-voorbeeldweergave (iframe met blob) werkt er in Chrome gewoon mee. Scripts, inline handlers, fetches en afbeeldingen blijven vrij. (2) `_headers` (alleen Cloudflare Pages; GitHub Pages negeert het): een Report-Only-beleid met alle hosts die de app echt gebruikt (worker, Graph, MS-login, SharePoint, Toggl Track, Google Fonts) plus `frame-ancestors 'none'`; het blokkeert niets en meldt overtredingen. Afdwingen pas na een paar weken zonder meldingen (`/beheer/log` → `cspTop`); `'unsafe-inline'` voor scripts blijft nodig tot F7 3b en Trusted Types. (3) `POST /csp-rapport` (zonder login, `OPTIONS` voor de preflight van de Reporting API; formaten `application/csp-report` en `application/reports+json`): bewaart ALLEEN de directive en het host van het geblokkeerde (of een vaste naam: inline, eval, data, blob, schema:<x>, leeg), nooit de pagina-url met pad of query, bronregel, broncode-sample, beleid of referrer. Grenzen: 16 kB per bericht (413), hooguit 10 meldingen per bericht, 120 per minuut per isolate, 200 verschillende sleutels per flush; altijd een lege 204. Tellers per dag in KV `stat:<dag>` (`csp`, `cspTotaal`), getoond in `GET /beheer/log`.
