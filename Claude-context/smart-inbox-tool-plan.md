# Bouwplan (grondig) — Smart-inbox + mail↔project in de online M&T-tool

> Status: ONTWERP — wacht op Bart-OK (zie §8 Beslis-/risicopunten).
> Plan op Opus 4.8 (2026-06-04, gecorrigeerd na de archivering). Bouwen mag op 4.7.
> **Live tool = `index.html`** (repo-root `C:\MT`, GitHub Pages → `main`). Deploy = `ROUTES.md`.
> De oude `index-v4.html` is gearchiveerd (`_archief/oude-tool-2026-06-04/`) — niet meer relevant.
> **Hoofdthema: bestandsveiligheid.** Live tool, gedeelde mailbox info@, en
> SharePoint-projectmappen zijn allemaal productie. Niets mag stuk of weg.

---

## 1. Wat er nú al is (geverifieerd in `index.html`, niet aangenomen)

> ⚠️ Eerdere versie van dit plan ging uit van de omgekeerde aanname (v4 = live,
> porten uit index.html). Dat is gecorrigeerd: **`index.html` ís de live tool en
> heeft de mapstructuur-/bijlagen-functies al.** Onderdeel B is dus grotendeels
> *wire + harden + UI*, niet porteren. Verifieer exacte regelnummers vóór je bouwt.

**Aanwezig in `index.html` (de live tool):**
- Mail lezen + verplaatsen via Graph direct uit de browser (`getMailFolderId`,
  `/messages/{id}/move`, maillijst met bijlagen, bijlage-content download). MSAL met
  scopes `Mail.Read/Send`, `Files.ReadWrite`, `Sites.ReadWrite.All`.
- `window.getGraphToken()` — directe Graph-calls. Worker (`WORKER`) alleen voor
  Moneybird + Claude (`?target=claude`).
- **Mapstructuur + bijlagen (al gebouwd, Fase A/B):** `_SP.PROJ_DRIVE`
  (On-Prem-Data drive-id), `listChildren`/`rename`/`ensureFolder`,
  `window.genereerProjectMappen(proj)` (idempotente mkdir-p klant → [locatie] →
  `code - naam` → submappen, `conflictBehavior:fail` + 409-afhandeling),
  `window.spUploadProjectBijlage(proj, file)`, `uploadProjectBijlagen(files, code)`,
  `bijlagenHtml`, `ontkoppelBijlage`.
- **Klant-registry + projectcode:** `klantByCode`, `resolveKlantNaam`,
  `laadKlantRegistry`, `autoCode`/`afkortKlant`/`afkortLoc`/`afkortProduct`
  (KLANT-LOC-PROD), `levLink`, `gaNaarLeverancier`, `projectTijdlijn`.
- `maakProjectAan()` — projectaanmaak. **Te checken:** roept dit al
  `genereerProjectMappen` aan (taak #21 = completed → waarschijnlijk ja). Zo niet,
  dat is de enige resterende wiring voor B2.

**Nog te bouwen (kern van dit plan):** de **Inbox-tab zelf** (mappenboom, maillijst,
leespaneel, verplaats-met-undo, Larry-chat) bestaat nog niet, plus de
**koppeling mail↔project** (linken, drag-drop bijlage→project, "maak project van
deze mail").

---

## 2. Architectuur — 2-weg-sync is gratis bij live Graph

De inbox-tab werkt op de **live mailbox** (geen lokale kopie) → één bron van waarheid:
- verplaatsen in de tool → Graph-move → **direct in Outlook**;
- verplaatsen in Outlook → tool toont live bij volgende fetch → **direct in de tool**.

De thuis-PC `triage_sort.py` blijft een **suggestie-/leer-overlay** (stelt doelmap
voor, leert van correcties via `_info-feedback-queue.json`), nooit de databron.

Mailbox = **info@** (shared) → `/users/info@mortiseandtenon.nl/...` i.p.v. `/me/`.
Bart heeft delegated toegang (forward-pipeline draait erop). Later: mailbox-switcher.

---

## 3. Onderdeel A — Inbox-tab (live, 2-weg) — BOUWEN WE EERST

Nieuwe tab `Inbox` (positie 1). 3-pane: mappenboom | maillijst | leespaneel + chat.

- **A1** Nav-tab + 3-pane skeleton (puur additief, eigen CSS-namespace `inbox-`).
- **A2** Mappenboom: `/users/info@.../mailFolders` (+ childFolders), read-only.
- **A3** Maillijst: `/mailFolders/{id}/messages?$select=...&$top=50`, gepagineerd.
- **A4** Leespaneel: body live (HTML→gesanitized), bijlage-chips (naam/grootte),
  `webLink` naar Outlook.
- **A5** **Verplaatsen (mutatie):** drag mail → map, of snelknop → `/messages/{id}/move`.
  Met **undo-stack** (onthoud bron-folder-id) + toast "Ongedaan maken". Eén mail
  per keer; **geen bulk** in v1; **nooit verwijderen**, alleen verplaatsen.
- **A6** Suggestie-overlay: match op `internetMessageId` tegen het sorteer-rapport
  (van SharePoint/thuis-PC, **niet** hardcoded — zie §6 PII). Toon "voorgestelde
  map + reden"; akkoord = move + feedback-queue-entry (leerlus).
- **A7** Larry-chat per mail via Worker `?target=claude`; feedback →
  `_info-feedback-queue.json` (omkeerbaar).

Acceptatie A: mappen+mail zichtbaar; een test-mail verplaatsen verschijnt in
Outlook én andersom; undo werkt; chat antwoordt.

---

## 4. Onderdeel B — Project-koppeling + bijlagen (wire + harden + UI) — DAARNA

> De mapstructuur-/bijlagen-functies bestaan al in `index.html`. B = ze inzetten
> vanuit de inbox + UI eromheen + harden, niet opnieuw bouwen.

- **B1** ~~Porteren~~ — vervalt: `genereerProjectMappen`, `spUploadProjectBijlage`,
  `ensureFolder` etc. staan al in `index.html`. Alleen verifiëren dat ze actueel zijn.
- **B2** Verifieer/borg dat `maakProjectAan` `genereerProjectMappen` aanroept (taak
  #21 = completed). Klant komt uit de **registry-dropdown** (geen vrije tekst → geen
  verdwaalde klantmappen). Rename-convergentie: zie §8-risico (default rename=false).
- **B3** Harden `spUploadProjectBijlage`: (a) **submap-parameter** met picker
  (default `07_Administratie`; opties `05_Aangeleverd`, `06_Fotos`, etc. — jij koos
  "alleen nog vragen welke map"); (b) **niet overschrijven**: PUT met
  `@microsoft.graph.conflictBehavior:rename` of pre-check op bestaande naam.
- **B4** "Koppel aan project" in het leespaneel → kies bestaand project, óf "nieuw"
  (opent de projecten-aanmaker, **voor-ingevuld**: klant geraden uit afzender-domein
  via registry). Link opgeslagen in `mt_project_mails` (zie §6: toevoegen aan
  `_SP.KEYS` zodat het naar SharePoint persisteert).
- **B5** **Drag-drop:** sleep een bijlage-chip (uit de mail) óf een bestand van
  schijf naar de project-detail-dropzone → `spUploadProjectBijlage(proj, file, submap)`.
  Vraagt de submap. Bijlage blijft op SharePoint; tool bewaart enkel een verwijzing.
- **B6** **"Maak project van deze mail"** starter-knop in de inbox → opent de
  aanmaker voor-ingevuld (klant uit afzender, onderwerp als producthint).
- **B7** Project-detail: secties "Gekoppelde mails" (deeplinks naar Outlook) +
  "Bijlagen" (lijst met webUrl).

Acceptatie B: nieuw project → mappen verschijnen op SharePoint; bijlage uit mail
naar gekozen submap zonder overschrijven; mail-link zichtbaar in projectdetail +
overleeft herladen (SharePoint-persist).

---

## 5. Bestandsveiligheid — SharePoint-schrijfacties

1. **Altijd On-Prem-Data drive-by-id** (`PROJ_DRIVE`), nooit de default
   `/drive/root` (dat is Documenten — verkeerde library). Valkuil staat in
   [[reference_sharepoint_drives]].
2. **Idempotent, niet-clobberend:** `ensureFolder` gebruikt `conflictBehavior:fail`
   + 409-hergebruik → maakt nooit dubbele mappen, overschrijft niets.
3. **Bijlage-PUT mag NIET overschrijven.** Harden naar `conflictBehavior:rename` of
   expliciete bestaat-check → tweede bestand met gelijke naam wordt `naam (2).pdf`,
   geen dataverlies.
4. **Klant uit registry, niet vrije tekst** → geen verkeerd-gespelde klantmappen.
5. **Geen verwijder-/verplaats-acties op bestaande SharePoint-bestanden** in dit
   plan; alleen toevoegen.

## 5b. Bestandsveiligheid — de mailbox (gedeeld info@)

1. **Alleen verplaatsen, nooit verwijderen.** Move is omkeerbaar (undo-stack).
2. **Eén mail per keer**, geen bulk in v1. Toast met "ongedaan maken".
3. Test eerst op een **wegwerp-test-mail** vóór echte mail.
4. `Mail.ReadWrite`-scope nodig voor move in shared mailbox → re-consent (§8).

## 5c. Bestandsveiligheid — de live HTML zelf

1. **Backup vóór elke edit:** de pre-commit hook backupt `index.html` automatisch
   naar `_backups/` bij elke commit. Voor losse tussenstappen mag ook handmatig
   `Claude-context/backups/index.YYYYMMDD-HHMM.html` (lokaal/SharePoint, geen secrets).
2. **Lokaal testen vóór push:** open het bestand in de browser, login, klik de
   nieuwe tab door. GitHub Pages serveert `main` → een kapotte push = kapotte tool
   voor iedereen. Pas pushen als het lokaal werkt.
3. **Additief bouwen:** nieuwe tab + functies in eigen blok; de factuur-flow
   (`mbGet/mbPost`, controle, dashboard) niet aanraken.
4. **Eén feature = één commit** → schone revert. Rollback: `git revert <sha>` +
   push (zie ROUTES.md).

---

## 6. PUBLIC repo / PII — kritiek

`index.html` staat in een **PUBLIC** repo. Daarom:
- **Geen klant-/persoonsgegevens hardcoden** in de HTML. De afzender→klant-tabel
  uit `email-bijlagen-systeem.md` (echte e-mailadressen, klantnamen; nu gearchiveerd
  in `_archief/oude-tool-2026-06-04/`, gitignored) mag **NIET** in de HTML — die
  routering/suggestie komt uit het sorteer-rapport/overlay op SharePoint (privé),
  runtime geladen.
- Mail wordt **alleen runtime in de browser** gelezen; niets van mailinhoud,
  `mt_project_mails`, of klantlijsten wordt naar de repo geschreven.
- `mt_project_mails` (onderwerpen/afzenders = PII) → localStorage + **SharePoint**
  via `_SP` (privé), nooit gecommit. Voeg de key toe aan `_SP.KEYS` anders leeft
  het alleen in één browser en gaat verloren bij cache-clear.
- Tokens: nergens in HTML. MSAL houdt tokens in browsergeheugen; Worker houdt de
  MB/Claude-secrets ([[reference_repo_veiligheid_guard]]).

---

## 7. Volgorde & gates

0. **Veiligheidsprep:** bevestig git-revert-pad; check Mail.ReadWrite-consent.
1. **Fase A** (inbox + 2-weg) → lokaal testen → push → live verifiëren.
2. **Fase B** (wire + link + drag-drop + starter) → lokaal testen → push → verifiëren.
Elke fase eindigt met de acceptatie-checks hierboven. Tussen fases: kort verslag.

---

## 8. Beslis-/risicopunten (Bart bevestigen)

1. **Rename-convergentie aan/uit in de tool.** `ensureFolder(rename=true)` op
   klant-niveau **hernoemt** bestaande live klantmappen naar de canonieke naam
   (bv. `Styles Concepts` → `Styles Concepts B.V.`). Dat zijn nog niet-bevestigde
   renames (memory). **Voorstel: in de tool default `rename=false`** (alleen
   aanmaken/hergebruiken, nooit stilletjes hernoemen). Akkoord?
2. **`Mail.ReadWrite`-scope toevoegen** (nodig om te verplaatsen) → eenmalige
   herbevestiging bij login. Akkoord?
3. **Default bijlage-submap** = `07_Administratie` (zoals de oude doc), met picker
   voor de rest. Akkoord, of liever `05_Aangeleverd` als default?
4. **Deploy-stijl:** lokaal testen → direct naar `index.html` pushen (voorstel),
   óf eerst op een aparte `index-test.html` live zetten en pas swappen als jij 'm
   goedkeurt (veiliger, iets trager). Welke?
