# MT-paneel voor Outlook (spike)

Een taakvenster rechts naast een geopende mail: **de mail (het hele gesprek) aan een project koppelen** en **het projectdossier openen**.
Dit is de spike (brok 5) met de eerste MVP-onderdelen erbovenop. Het paneel kan nu:
- **koppelen:** het hele gesprek aan een project (voorstel of zoeken); projectgegevens (nummer, fase, contact, adres met navigatielink) en "Open dossier";
- **bijlagen** per bijlage naar de projectmap, met een submapvoorstel dat je kunt wijzigen;
- **"Maak lead van deze mail"**: opent de tool op `#lead/nieuw?mbx=…&mail=…`; het formulier "+ Lead" (nummer uit de teller, verplichte volgende actie) staat dan voorgevuld met de afzender en het onderwerp, en het hele gesprek wordt na het aanmaken gekoppeld;
- **"Pak op"** / afhandelen (met reden), **alleen voor gesprekken in info@** (een vaste lijst met toegestane postbussen in `mt-mailactie.js`; in je eigen of een andere gedeelde postbus bestaat de functie niet): staat in het gedeelde register `mt_mail_oppak.json`, zichtbaar in het overzicht **Binnenkomend** in de tool (Projecten) en als Outlook-categorie "Opgepakt: naam";
- **"Antwoord als info@"**: een antwoordconcept met Van = info@ en de projecttag `[26xxxx]` in het onderwerp (zie "Antwoorden vanuit info@" hieronder);
- in een **opstelvenster**: laat zien of info@ in de cc staat (knop om hem erbij te zetten); automatisch kan alleen met het testmanifest (zie "Automatisch info@ in de cc").

**Ondersteund in deze spike:** Outlook op het web, nieuwe Outlook voor Windows, klassiek Outlook voor Windows en Outlook voor Mac (leesmodus, bureaubladweergave).
**Niet ondersteund: Outlook voor iOS en Android.** Het manifest heeft geen `MobileFormFactor`; de knop verschijnt op de telefoon dus niet. Mobiel komt (misschien) later.

Wat erin zit:

| Bestand | Wat |
|---|---|
| `manifest.xml` | Add-in-only XML-manifest (Mail, leesmodus, `ReadItem`, Mailbox 1.5, vastpinnen en gedeelde postbus aan) |
| `pane.html`, `pane.js` | Het taakvenster; Office.js + msal-browser 3.30 (NAA) + de gedeelde modules `mt-core.js`, `mt-koppel.js`, `mt-zoek.js` |
| `maak-manifest.js` | Maakt hetzelfde manifest voor een ander basisadres (zie onderaan) |
| `icons/` | De iconen (16 t/m 128 px) |
| `../vendor/msal-browser-3.30.0.min.js` | De nieuwe MSAL, naast de oude 2.39 van de cockpit (die blijft zoals hij is) |

Het paneel praat **rechtstreeks met Graph** (niet met de worker: een ID-token onder NAA is onbetrouwbaar). De koppelingen komen in dezelfde privé
SharePoint-bestanden als die van de cockpit (`mt_mail_links.json`, `mt_koppel_journaal.json`); `mt_projecten.json` wordt alleen gelezen. Er staat niets in de repo.

## Wat jij moet doen (Bart, ca. 25 minuten)

### 1. Azure: een extra redirect-adres en (voor info@) een extra machtiging
1. Ga naar het Azure-portaal (Entra) → **App-registraties** → de bestaande app van de tool (client-id `a091db96-24ed-4b64-8b9d-7c55bc86cfdb`).
2. **Verificatie** (Authentication) → **Een platform toevoegen** → **Toepassing met één pagina** (Single-page application).
3. Redirect-URI invullen, precies zo (alleen de herkomst, geen pad, geen slash achteraan):
   `brk-multihub://mtbart.github.io`
   Na de verhuizing naar het nieuwe adres komt er **ook** `brk-multihub://tool.mortiseandtenon.nl` bij (de oude mag blijven staan).
4. Opslaan. De bestaande redirect-URI's van de cockpit en de app blijven staan; die raak je niet aan.
5. **Alleen voor de gedeelde postbus info@:** **API-machtigingen** (API permissions) → **Een machtiging toevoegen** → **Microsoft Graph** → **Gedelegeerde machtigingen** →
   **`Mail.Read.Shared`** toevoegen. Vraagt Azure om **beheerderstoestemming** (admin consent), geef die dan namens de organisatie.
   Zonder deze machtiging werkt het paneel voor je eigen postbus gewoon; alleen een mail in info@ geeft dan een toestemmingsfout.
6. **Alleen voor "Pak op" (categorie) en "Antwoord als info@" (concept):** voeg ook **`Mail.ReadWrite`** en **`Mail.ReadWrite.Shared`** toe (gedelegeerd, met beheerderstoestemming).
   De cockpit heeft `Mail.ReadWrite` al; het paneel vraagt ze pas op het moment van de klik. Zonder deze machtigingen blijft koppelen, bijlagen en "Pak op" in de tool werken;
   alleen de Outlook-categorie en het concept falen met een duidelijke melding.

> Waarom: NAA (nested app authentication) geeft het paneel een Graph-token op naam van onze eigen app, zonder tweede inlogscherm. Daarvoor moet Azure
> dit `brk-multihub://…`-adres kennen. Het paneel vraagt **bij het openen alleen leesrechten** (`Sites.Read.All` voor de koppelbestanden op de SharePoint-site, `Mail.Read`). Schrijfrechten komen pas op het moment van de actie die ze nodig heeft
> (zie de tabel "Rechten per actie" hieronder); `Files.ReadWrite` wordt niet meer gevraagd. Voeg daarom ook **`Sites.Read.All`** (gedelegeerd, met beheerderstoestemming) toe als hij nog niet in de app-registratie staat. De scopes die de cockpit al gebruikt zijn al
> toegestemd voor de cockpit; `Mail.Read.Shared` wordt alleen gevraagd zodra je een mail uit een gedeelde postbus opent.
>
> **Bekende brede scope:** `Sites.ReadWrite.All` (alleen bij het opslaan) is breder dan nodig, maar de koppelbestanden staan op de SharePoint-site en de cockpit gebruikt hem al.
> Een aparte app-registratie met smallere scopes (bijvoorbeeld `Sites.Selected`) is een vervolg.

**Rechten per actie** (alles via Graph met het NAA-token van de eigen app; het paneel gebruikt geen Exchange-callbacktokens):

| Wanneer | Graph-scopes | Waarom |
|---|---|---|
| Paneel openen, voorstel, zoeken | `Sites.Read.All`, `Mail.Read` | projecten en koppelingen lezen; onderwerp, afzender en id's van de mail |
| Mail in info@ openen | + `Mail.Read.Shared` | lezen in een gedeelde postbus |
| Koppelen, "Pak op" (register), bijlage-index, bijlagen in de projectmap | + `Sites.ReadWrite.All` | schrijven van `mt_mail_links`, `mt_koppel_journaal`, `mt_mail_oppak`, `mt_bijlage_index` en bestanden in de projectmap |
| Categorie "Opgepakt: naam", antwoordconcept | `Mail.ReadWrite` (+ `Mail.ReadWrite.Shared` in info@) | alleen de categorie en een concept; er wordt nooit iets verstuurd (`Mail.Send` wordt niet gevraagd) |

**Manifest-machtiging** (Exchange, niet Graph): `manifest.xml` vraagt **ReadItem**: het paneel leest alleen eigenschappen van het geopende bericht (item-id, gespreks-id, onderwerp, afzender). `ReadWriteMailbox` is niet nodig (dat geeft toegang tot EWS en callbacktokens, die niet meer worden gebruikt) en
`ReadWriteItem` ook niet in het gewone manifest. Het testmanifest `manifest-gebeurtenissen.xml` vraagt **ReadWriteItem**, alleen omdat `item.cc.addAsync` (info@ in de cc zetten) dat minimaal eist. Gedeelde postbussen vragen geen hogere machtiging maar `SupportsSharedFolders`.
*Niet getest in een echte Outlook:* werkt een gedeelde postbus of een categorie niet, probeer dan eerst `ReadWriteItem` en meld het terug; ga pas als laatste naar `ReadWriteMailbox`.

### 2. Entra: Conditional Access controleren
NAA werkt niet met de oude regel **"Goedgekeurde client-app vereisen"** (approved client app).
1. Entra → **Beveiliging** → **Voorwaardelijke toegang** (Conditional Access) → **Beleidsregels**.
2. Kijk of er een regel is die **"Goedgekeurde client-app vereisen"** (*Require approved client app*) aan heeft staan en voor Office 365 / Exchange Online of alle apps geldt.
3. **Staat die uit (of bestaat hij niet): klaar.** Staat hij aan: sluit de gebruiker "Bart" voor de test uit óf vervang de regel door "Conforme apparaten vereisen" en meld dat terug.
   De bijbehorende foutmelding in het paneel is "Aanmelden mislukt … Conditional Access".

### 3. Het manifest uploaden (eerst alleen voor jou)
1. Microsoft 365-beheercentrum (admin.microsoft.com) → **Instellingen** → **Geïntegreerde apps** (Integrated apps) → **Aangepaste apps uploaden** (Upload custom apps).
2. Apptype **Office-invoegtoepassing** (Office Add-in) → **Bestand uploaden** → kies `outlook/manifest.xml` uit deze map.
3. **Gebruikers toewijzen:** kies **Alleen ik** (*Just me*). Later, na de test, een groep "MT-paneel" met collega's.
4. Controleer de machtigingen en **Implementeren**. Het manifest vraagt alleen **ReadItem** (zie "Manifest-machtiging" in stap 1). Het paneel zelf schrijft niets in je mail zonder dat je op een knop klikt; het leest onderwerp, afzender, datum en id's (zie Veiligheid en privacy).
5. Het kan een paar uur tot een dag duren voor de knop op het lint staat. Outlook helemaal afsluiten en weer openen. Open een mail → op het lint (of onder "..."/Apps) staat **MT-paneel** (groep M&T).

**Sneller testen zonder beheercentrum (alleen voor jezelf):** Outlook op het web → een mail openen → **Apps** (of "…" → *Get Add-ins*) → **Mijn invoegtoepassingen** →
**Aangepaste invoegtoepassingen** → **Uit bestand toevoegen** → `outlook/manifest.xml`. Werkt direct; het verdwijnt als je het weghaalt.

### 4. Testen (de spike moet dit bewijzen)
Open een **testmail** van een project waar je zeker van bent (bij voorkeur het project `ZZ-TEST` — maak het eerst aan in de cockpit).
Klap onderaan **Diagnose (spike)** open en zet de uitkomst in je terugmelding.

| # | Stap | Verwacht | Wat het bewijst |
|---|---|---|---|
| 1 | Paneel openen | Melding "Aanmelden…", daarna onderwerp en afzender van de mail; bij de eerste keer een Microsoft-popup | NAA werkt (anders: zie foutmeldingen hieronder) |
| 2 | Diagnose bekijken | `naa: true`, `mailbox18: true`; `restId.omgezet: true` (desktop); `graphId.lengte` > 0; `immutableHeader` toont `IdType="ImmutableId"` | itemId → REST-id → Graph; **of Graph echt een immutable id teruggeeft** (zo niet: noteer wat er staat) |
| 3 | Voorstel bekijken | Staat de projectcode of het offertenummer in het onderwerp, dan komt dat project als voorstel met "Waarom: …" | Voorstel via `mt-koppel.js` |
| 4 | In "Ander project zoeken" typen | Dezelfde volgorde als de zoekbalk in de cockpit (exacte code eerst) | Dezelfde zoeker (`mt-zoek.js`) |
| 5 | **Koppel hele gesprek** → "Ja, koppel" | "✓ N mails gekoppeld aan …"; onder "Gekoppeld aan" verschijnt het project met **Open dossier** | Koppelen via `mt-koppel.js` en schrijven naar SharePoint |
| 6 | In de cockpit: Projecten → dat project → Dossier | De gekoppelde mails staan daar | Paneel en cockpit delen dezelfde bestanden |
| 7 | Terug in het paneel op dezelfde mail | Staat nu onder "Gekoppeld aan" | Lezen van bestaande koppelingen |
| 8 | **Vastpinnen** (het speldje) en door de inbox klikken | Het paneel volgt de geselecteerde mail (`ItemChanged`) | Vastgepind paneel |
| 9 | Een mail in de gedeelde postbus **info@** openen (als je die op jouw postbus hebt staan; vereist stap 1.5 en **Mailbox 1.13**) | Diagnose: `postbus: "info@…"`; koppelen werkt met die postbus. Op een oudere client: de melding "gedeelde postbus … Mailbox 1.13" | Gedeelde postbus (`SupportsSharedFolders`, `Mail.Read.Shared`) |
| 10 | Op **Outlook voor Mac / klassiek / web** hetzelfde proberen (als beschikbaar) | Zelfde gedrag | Welke clients werken (telefoon: niet ondersteund, zie boven) |

Ontkoppelen kan in de cockpit (dossier van het project).

### 5. Antwoorden vanuit info@ ("Verzenden als"-rechten)
Bart wil antwoorden het liefst vanuit info@. De knop **Antwoord als info@** maakt een antwoordconcept met Van = info@. Outlook laat dat alleen verzenden als de afzender
het recht **Verzenden als** (Send As) op info@ heeft. Zonder dat recht weigert Outlook het verzenden (het concept zelf wordt wel gemaakt).
1. Exchange-beheercentrum (admin.exchange.microsoft.com) → **Ontvangers** → **Gedeelde postvakken** → **info@** → **Delegeren** (Delegation) → **Verzenden als** (Send as) →
   **Bewerken** → voeg **Mathijs** en **Ilona** toe (en jezelf, als je dat nog niet hebt). Opslaan. Het kan tot een uur duren voor Outlook het merkt.
2. Of met PowerShell (Exchange Online): `Add-RecipientPermission -Identity <info-adres> -Trustee <naam@mortiseandtenon.nl> -AccessRights SendAs -Confirm:$false`
   (eenmaal per persoon; controleren met `Get-RecipientPermission -Identity <info-adres>`).
3. Het paneel zelf heeft daarnaast **Volledige toegang** (Full Access) op info@ nodig om het concept in de gedeelde postbus te maken en de categorie "Opgepakt: naam" te zetten.
   Mathijs en Ilona hebben die al als ze info@ in hun Outlook hebben staan. Staat info@ ook als "Verzonden items"-kopie ingesteld? Zet in het beheercentrum
   **Verzonden items kopiëren naar het gedeelde postvak** (`MessageCopyForSentAsEnabled`) aan, anders landt een antwoord "als info@" alleen in de Verzonden items van de afzender
   en ziet het overzicht Binnenkomend het antwoord niet (de aanduiding "beantwoord" ontbreekt dan).

### 6. Optioneel: een mailstroomregel als vangnet (projecttag → info@ in bcc)
Vergeet iemand info@ in de cc te zetten, dan vangt deze regel het op: elk uitgaand bericht met een projecttag `[26xxxx]` in het onderwerp krijgt info@ in de bcc.
Dat is het vangnet; het paneel (knop of proef-vlag) is de nette weg. Alleen instellen na overleg (de regel geldt voor het hele bedrijf).
1. Exchange-beheercentrum → **Mailstroom** → **Regels** → **Een regel toevoegen** → **Nieuwe regel maken**.
2. **Naam:** `Projecttag naar info@ (bcc)`. **Regel toepassen als:** *Het onderwerp of de hoofdtekst* → *onderwerp komt overeen met deze tekstpatronen* → `\[\s*\d{6}\s*\]`.
3. **Voeg een voorwaarde toe:** *De afzender* → *bevindt zich* → *binnen de organisatie* (anders bcc't de regel ook inkomende mail van klanten).
4. **Doe het volgende:** *Ontvangers toevoegen aan het vak Bcc* → het adres van info@.
5. **Behalve als:** *De afzender is* info@ **en** *Een ontvanger is* info@ (voorkomt een lus en een dubbele kopie als info@ al in Aan, Cc of Bcc staat).
6. **Modus:** eerst *Testen zonder beleidstips afdwingen*, na een week *Afdwingen*. Prioriteit laag laten staan. Opslaan en **inschakelen**.
Gevolg: de kopie in de inbox van info@ heeft dezelfde `conversationId`; het overzicht Binnenkomend behandelt hem als onderdeel van het gesprek (geen extra rij).
De projectnummers tellen door vanaf 260801 en beginnen niet elk jaar opnieuw. Het patroon met zes cijfers (`\d{6}`) blijft daardoor geldig, ook na de jaarwisseling. Pas het niet aan naar een jaartal.

### 7. Het testmanifest met gebeurtenissen laden (proef: automatisch info@ in de cc)
`manifest-gebeurtenissen.xml` is een **apart** testmanifest (eigen Id) met de knop in het opstelvenster en de gebeurtenis `OnNewMessageCompose` (zie "Automatisch info@ in de cc").
1. Laad het **in plaats van** het gewone manifest, niet ernaast, anders staan er twee MT-knoppen: Outlook op het web → Apps → **Mijn invoegtoepassingen** → **Aangepaste invoegtoepassingen** →
   **Uit bestand toevoegen** → `outlook/manifest-gebeurtenissen.xml`. (Via het beheercentrum kan ook; zelfde stappen als stap 3, eerst **Alleen ik**.)
2. Open een antwoord op een gekoppeld gesprek (onderwerp met `[26xxxx]`) → klik **MT-paneel** in het opstelvenster → vink **Automatisch info@ in de cc** aan. Dat zet de instelling `mt_auto_cc`
   in je Outlook-instellingen (roamingSettings); zonder vinkje doet de gebeurtenis niets.
3. Maak een nieuw antwoord op zo'n gesprek: info@ moet zelf in de cc verschijnen. Lukt dat niet, dan werkt alleen de knop "Zet info@ in de cc" in het paneel; meld het terug met de client erbij.

### Foutmeldingen en wat ze betekenen
| Melding in het paneel | Oorzaak | Oplossing |
|---|---|---|
| "Aanmelden in Outlook (NAA) wordt … niet ondersteund" | Te oude Outlook | Bijwerken, of koppelen via de cockpit |
| "Aanmelden mislukt … redirect / AADSTS50011" | Stap 1 niet gedaan of typefout in `brk-multihub://…` | Redirect controleren (geen slash, geen pad) |
| "Aanmelden mislukt … Conditional Access" | Stap 2: regel "Goedgekeurde client-app" | Regel aanpassen |
| "Geen toegang … (403)" | Toestemming ontbreekt voor deze gebruiker (bij info@: `Mail.Read.Shared`, stap 1.5) | Beheerder: toestemming namens de organisatie geven (Enterprise applications → Permissions) |
| "Deze mail staat in een gedeelde postbus … Mailbox 1.13" | Oudere Outlook-client | Outlook bijwerken of via de cockpit koppelen |
| "Deze mail is in Graph niet gevonden (404)" | Mail uit een andere postbus dan je eigen | Diagnose bekijken en terugmelden |
| "De projecten en koppelingen konden niet worden gelezen" | SharePoint-lezen faalde; er wordt bewust niets gewijzigd | Opnieuw proberen; blijft het fout: terugmelden |
| "… gekoppeld … Het journaal is nog niet opgeslagen" | De koppeling staat er, het journaal (apart bestand) lukte niet | Niets doen: het wordt bij de volgende actie of na herladen opnieuw geprobeerd |

## Basisadres wijzigen (na de verhuizing naar tool.mortiseandtenon.nl)
```
node outlook/maak-manifest.js https://tool.mortiseandtenon.nl/ outlook/manifest.xml
```
Daarna `<Version>` in het manifest ophogen en uploaden als **Update** in het beheercentrum. Voeg ook de redirect `brk-multihub://tool.mortiseandtenon.nl` toe (stap 1).
Het paneel zelf (HTML/JS) verandert direct mee met de site; alleen een manifestwijziging vraagt een nieuwe upload.

## Veiligheid en privacy
**Wat het paneel bij Graph ophaalt** (alleen in het geheugen van het taakvenster): van de geopende mail en van de mails in hetzelfde gesprek het **onderwerp, de afzender
(naam en adres), de ontvangstdatum, de `webLink`, de id's (`id`, `internetMessageId`, `conversationId`) en of er bijlagen zijn**. Het paneel haalt **geen mailtekst, geen preview, geen
ontvangers (Aan/Cc) en geen bijlagen** op. Er is geen worker- of AI-aanroep; niets gaat naar derden.

**Wat er wordt bewaard** (alleen na "Ja, koppel", in dezelfde privé SharePoint-bestanden als de cockpit):
- `mt_mail_links.json`: per gekoppelde mail onderwerp, afzender (naam en adres), datum, `webLink`, id's, gespreks-id, bijlage-ja/nee, postbus, wie en wanneer;
- `mt_koppel_journaal.json`: per actie de projectcode, de mailsleutel, het onderwerp, wie en de bron ("paneel").
- Mislukt het journaal, dan blijven die regels tijdelijk in **sessionStorage** van het taakvenster (sleutel `mt_paneel_journaal_wacht`) tot ze zijn weggeschreven. Verder gebruikt
  het paneel geen localStorage of sessionStorage; msal houdt zijn eigen tokens bij.

**Overig**
- Alles wat het paneel toont wordt als tekst ingevoegd (geen HTML uit mails); links gaan door `veiligeUrl` (https en dezelfde host als de tool).
- Schrijven gebeurt alleen na een expliciete bevestiging ("Ja, koppel") en met ETag/samenvoegen (`If-Match`; bestaat het bestand nog niet, dan `If-None-Match: *` en bij een
  gelijktijdige aanmaak worden beide kanten samengevoegd). Alleen bekijken schrijft niets.
- De manifest-machtiging is `ReadItem` (zie stap 1); de Graph-scopes bij het openen zijn `Sites.Read.All` en `Mail.Read` en, alleen voor
  een gedeelde postbus, `Mail.Read.Shared`; `Sites.ReadWrite.All` en `Mail.ReadWrite` komen pas bij de actie (zie de tabel in stap 1). Pas op het moment van de klik (categorie "Opgepakt: naam", antwoordconcept) komen `Mail.ReadWrite` (en `.Shared`) erbij. `Mail.Send` en agenda worden niet gevraagd:
  het paneel verstuurt zelf nooit iets.
- `mt_mail_oppak.json` (het register "Pak op") bewaart per gesprek alleen: postbus, gespreks-id, status, wie (e-mail en naam), wanneer, reden en de gekoppelde projectcodes. **Geen onderwerp, afzender of mailtekst.**
  Het overzicht Binnenkomend in de tool leest onderwerp en afzender wel (via Graph, alleen in het geheugen van de pagina) en toont ze; er wordt niets van bewaard.

## Binnenkomend: wie pakt wat op uit info@
In de tool: **Projecten** → links, onder "Vandaag", staat de kaart **Binnenkomend** (alleen zichtbaar met het recht `inbox`). Ze toont de gesprekken in de inbox van info@ van de laatste 30 dagen met de status
**Nieuw → Opgepakt door X → Lead/project gekoppeld → Afgehandeld (met reden)**. "Open" (standaard) toont alleen Nieuw en Opgepakt; "Alles" ook de rest.
- *Nieuw* = nog niet gekoppeld en niemand pakte het op. Staat een gesprek langer dan 24 uur op Nieuw (en is het niet beantwoord), dan krijgt het het label "te lang open" en komt er een waarschuwing boven de lijst.
- *Opgepakt* komt uit het register `mt_mail_oppak.json` (knop **Pak op** in het paneel of in de kaart) of uit een met de hand gezette Outlook-categorie "Opgepakt: …".
- *Lead/project gekoppeld* zodra een mail uit het gesprek aan een project hangt (`mt_mail_links.json`); wie het eerst oppakte blijft zichtbaar.
- *Afgehandeld* vraagt een reden (beantwoord, geen actie nodig, doorgestuurd, leverancier of administratie, reclame of spam, anders). Komt er daarna een nieuwe mail van buiten het bedrijf in hetzelfde gesprek, dan staat het weer op Nieuw.
- *Beantwoord* wordt afgeleid uit de verzonden items van info@ (zelfde gesprek, later dan de laatste inkomende mail).
- **Maak lead** opent het lead-formulier voor de nieuwste mail van het gesprek (dezelfde route als de paneelknop); **Open dossier** gaat naar het gekoppelde project.
Het register wordt per gesprek samengevoegd (nooit het hele bestand overschreven): pakken twee mensen verschillende gesprekken op, dan blijven beide staan; pakken ze hetzelfde gesprek tegelijk op, dan wint de laatste.

## "Pak op": rechten, allowlist en gelijktijdig oppakken
- **Alleen info@:** `MTMail.OPPAK_POSTBUSSEN` is de lijst met toegestane postbussen. Buiten die lijst is de registersleutel leeg: het paneel toont de sectie niet, Binnenkomend toont de knoppen niet en `oppakRecord` weigert te schrijven.
- **Recht in de tool:** de knoppen in Binnenkomend (Pak op, Afhandelen, Vrijgeven, Weer oppakken) en het schrijven in `mt_mail_oppak` vragen het bestaande recht `inbox` met niveau **alles** of **verwerken** (`RECHTEN` in `worker.js`); alleen kijken kan met elk inbox-recht.
- **Open punt:** het Outlook-paneel praat rechtstreeks met Graph en kent de rol uit de worker niet; daar is het alleen de allowlist en wat de gebruiker in Outlook en SharePoint mag. Iedereen die het paneel en schrijfrechten op de SharePoint-site heeft, kan dus oppakken. Wil je dat ook in het paneel beperken, dan is een worker-aanroep (`/me`) met een NAA-token nodig of een lijst met gebruikers in de app-instellingen.
- **Gelijktijdig oppakken:** het paneel leest eerst de actuele stand; staat het gesprek al op iemand anders, dan meldt het "Al opgepakt door X" en bied het "Overnemen" aan. Na het schrijven wordt de stand teruggelezen; de winnaar is de nieuwste `gewijzigd`, bij gelijke tijd de hoogste actor-id (`door`), in elke browser hetzelfde (`MTMail.oppakWint`). De Outlook-categorie wordt alleen gezet als jouw eigen record heeft gewonnen; anders meldt het paneel wie het wél is en wijzigt het niets in Outlook.

## Lead maken uit een mail
De knop **Maak lead van deze mail** opent `…/v2.html#lead/nieuw?mbx=<postbus>&mail=<mail-id>` in een nieuw tabblad. De tool leest die mail en het gesprek via Graph, vult het formulier "+ Lead" voor (afzender als klant, het onderwerp
zonder "RE:" en tags als titel, bron Mail), en vraagt zoals altijd de volgende actie met datum. Pas bij "Aanmaken" ontstaat de lead (nummer uit de teller); dan wordt het gesprek aan de lead gekoppeld. Onder de velden staat een **zichtbaar vinkje** (standaard aan): "Koppel alle N mails van dit gesprek"; uitgevinkt wordt alleen de mail waarvan je kwam gekoppeld. Lukt het koppelen van een deel niet, dan meldt de tool dat met de keuze **Opnieuw proberen**.
- Er gebeurt niets automatisch: zonder klik op "Aanmaken" wordt niets bewaard. Is het gesprek al aan een project gekoppeld, dan stelt de tool voor dat dossier te openen in plaats van een tweede lead te maken.
- Het recht `projecten:wijzigen` is nodig (zoals voor de knop "+ Lead"); zonder dat recht of zonder rol blijft de route stil of toont ze een melding. De URL wordt direct een gewone Projecten-URL, dus vernieuwen opent het formulier niet opnieuw.
- Het kost een regel Graph-lezing; de URL bevat alleen de postbus en het mail-id (geen onderwerp of namen).

## Automatisch info@ in de cc (proef, standaard uit)
**Doel:** bij een antwoord op een gekoppeld gesprek (onderwerp met `[26xxxx]`) zet het paneel info@ vanzelf in de cc, zodat de tool het gesprek ziet.
**Het gesprek moet echt gekoppeld zijn:** een tag in het onderwerp alleen is niet genoeg. Het paneel onthoudt van elk gekoppeld gesprek (zodra je het opent of koppelt) een korte hash van het gespreks-id in je Outlook-instellingen (`mt_gekoppeld`, hooguit 300, geen onderwerp of namen); de handler kijkt daarin. Een gesprek dat een collega of een ander apparaat koppelde, kent deze handler nog niet: dan gebeurt er niets.
**Gekozen aanpak:** event-based activation. `manifest-gebeurtenissen.xml` registreert `OnNewMessageCompose` (Mailbox 1.10) en wijst naar `launchevent.html` (web, nieuwe Outlook, Mac) en `launchevent.js`
(klassiek Windows laadt alleen dat JavaScript-bestand). De handler doet niets tenzij `mt_auto_cc` aan staat; dan voegt hij info@ toe aan de cc als: het een antwoord is (er is een gespreks-id), het onderwerp een projecttag heeft,
info@ nog niet in Aan, Cc of Bcc staat en je niet zelf als info@ schrijft. Dezelfde regel als `MTMail.ccInfoNodig` (de tests vergelijken ze).
**Terugval zonder gebeurtenissen:** met het gewone manifest (of als de gebeurtenis niet afgaat) toont het paneel in het opstelvenster de melding "info@ staat nog niet in de cc" met de knop **Zet info@ in de cc**.

**Beperkingen (niet getest in een echte Outlook; alleen met nagebootste Office.js):**
- Het manifest is niet gevalideerd door Microsoft. Valideer het eerst (`npx office-addin-manifest validate outlook/manifest-gebeurtenissen.xml`) of laat het beheercentrum het controleren.
- Gebeurtenissen werken niet in Outlook voor iOS en Android en niet in klassiek Outlook voor Windows zonder de juiste update; in een gedeelde postbus (info@ zelf, delegate) is de ondersteuning wisselend. Wordt de handler niet aangeroepen, dan blijft alleen de knop over.
- `OnNewMessageCompose` gaat af bij het openen van het opstelvenster. Heb je daarna het onderwerp of de ontvangers aangepast, dan wordt dat niet opnieuw bekeken (er is geen `OnMessageRecipientsChanged` ingebouwd).
- De handler heeft **geen netwerk of aanmelding** (de runtime is kortlevend) en kan dus niet in SharePoint zien of het gesprek echt gekoppeld is: hij gaat uit van de tag in het onderwerp. Antwoorden via "Antwoord als info@" en de mailstroomregel zetten die tag.
- Outlook mag de handler afbreken (limiet van een paar minuten, en bij het sluiten van het venster); mislukt het toevoegen, dan merk je dat niet. De handler roept altijd `event.completed()` aan en blokkeert het opstellen nooit.
- In een nieuw bericht (geen antwoord) of een doorgestuurd bericht zonder gespreks-id gebeurt niets.
- `roamingSettings` (het vinkje) staat per gebruiker in Exchange; de handler leest de waarde bij elk opstelvenster.
- Een reservekopie (bcc) via de mailstroomregel (stap 6) blijft nodig als vangnet.
- Of het gespreks-id dat Office.js in het opstelvenster geeft hetzelfde is als dat in het leesvenster is niet bewezen (beide worden genormaliseerd: base64url = base64, zonder `=`); komt het niet overeen, dan blijft de automatische cc uit en werkt alleen de knop.
- `clientId` en tenant-id staan al publiek in de cockpit; er zijn geen geheimen in deze map.

## Bekende grenzen van de spike
- Offerte starten en taak maken ontbreken (MVP-vervolg); bijlagen, lead, "Pak op" en "Antwoord als info@" zijn er wel (nog niet live getest).
- Geen automatisch voorstel zonder vastgepind paneel (Outlook heeft geen "mail geopend"-event).
- **Outlook voor iOS/Android wordt in deze spike niet ondersteund** (geen `MobileFormFactor` in het manifest).
- Een gedeelde postbus (info@) vraagt Mailbox 1.13 en `Mail.Read.Shared`; het gedrag verschilt per client (web, nieuw, klassiek, Mac).
- Nog niet live getest: dat moet na stap 1 t/m 3. De geautomatiseerde tests gebruiken nagebootste Office.js, MSAL en Graph; echte Outlook-clients zijn niet getest.
