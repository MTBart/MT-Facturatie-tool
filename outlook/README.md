# MT-paneel voor Outlook (spike)

Een taakvenster rechts naast een geopende mail: **de mail (het hele gesprek) aan een project koppelen** en **het projectdossier openen**.
Dit is de spike (brok 5): hij bewijst aanmelden, id-omzetting, voorstel en koppelen. Bijlagen naar de projectmap, offerte en taak komen in de MVP.

**Ondersteund in deze spike:** Outlook op het web, nieuwe Outlook voor Windows, klassiek Outlook voor Windows en Outlook voor Mac (leesmodus, bureaubladweergave).
**Niet ondersteund: Outlook voor iOS en Android.** Het manifest heeft geen `MobileFormFactor`; de knop verschijnt op de telefoon dus niet. Mobiel komt (misschien) later.

Wat erin zit:

| Bestand | Wat |
|---|---|
| `manifest.xml` | Add-in-only XML-manifest (Mail, leesmodus, `ReadWriteMailbox`, Mailbox 1.5, vastpinnen en gedeelde postbus aan) |
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

> Waarom: NAA (nested app authentication) geeft het paneel een Graph-token op naam van onze eigen app, zonder tweede inlogscherm. Daarvoor moet Azure
> dit `brk-multihub://…`-adres kennen. De scopes die het paneel voor je eigen postbus vraagt (`Files.ReadWrite`, `Sites.ReadWrite.All`, `Mail.Read`) zijn al
> toegestemd voor de cockpit; `Mail.Read.Shared` wordt alleen gevraagd zodra je een mail uit een gedeelde postbus opent.
>
> **Bekende brede scope:** `Sites.ReadWrite.All` blijft staan omdat de cockpit hem al gebruikt (de koppelbestanden staan op de SharePoint-site). Dat is breder dan
> het paneel nodig heeft; een aparte app-registratie met smallere scopes is een MVP-vervolg.

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
4. Controleer de machtigingen en **Implementeren**. Het manifest vraagt de machtiging **ReadWriteMailbox**: Microsoft schrijft die voor als een add-in Graph
   gebruikt voor een gedeelde postbus. Het paneel zelf schrijft **niets** in je mail; het leest alleen onderwerp, afzender, datum en id's (zie Veiligheid en privacy).
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
- De manifest-machtiging is `ReadWriteMailbox` (zie stap 3); de Graph-scopes zijn `Files.ReadWrite`, `Sites.ReadWrite.All` (bekende brede scope, zie stap 1), `Mail.Read` en, alleen voor
  een gedeelde postbus, `Mail.Read.Shared`. `Mail.ReadWrite`, `Mail.Send` en agenda worden niet gevraagd.
- `clientId` en tenant-id staan al publiek in de cockpit; er zijn geen geheimen in deze map.

## Bekende grenzen van de spike
- Bijlagen naar de projectmap, offerte starten en taak maken ontbreken (MVP).
- Geen automatisch voorstel zonder vastgepind paneel (Outlook heeft geen "mail geopend"-event).
- **Outlook voor iOS/Android wordt in deze spike niet ondersteund** (geen `MobileFormFactor` in het manifest).
- Een gedeelde postbus (info@) vraagt Mailbox 1.13 en `Mail.Read.Shared`; het gedrag verschilt per client (web, nieuw, klassiek, Mac).
- Nog niet live getest: dat moet na stap 1 t/m 3. De geautomatiseerde tests gebruiken nagebootste Office.js, MSAL en Graph; echte Outlook-clients zijn niet getest.
