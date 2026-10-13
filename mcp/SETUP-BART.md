# MT MCP-proef: setup voor Bart

Wat dit is: een aparte Worker `mt-mcp` naast `mt-claude-proxy`, met één tool, `whoami` ("wie ben ik"). Er gaat geen
bedrijfsdata doorheen. Het doel is te bewijzen dat inloggen, toestemming, intrekken en de rolcontrole werken, eerst in
Claude, dan in ChatGPT Business, en dat het op je telefoon met Voice werkt.

Hoe het werkt, in één alinea: Claude of ChatGPT stuurt je naar `mt-mcp`. Die stuurt je door naar de Microsoft-login
(alleen onze tenant). Daarna kijkt `mt-mcp` je rol na in `MT_ROLLEN` (alleen lezen) en vraagt hij eenmalig toestemming
voor die app. Dan geeft `mt-mcp` een **eigen** token uit: 10 minuten geldig, met een refresh-token dat bij elk gebruik
wordt vervangen. Microsoft-tokens blijven in de Worker, worden niet bewaard en nooit doorgegeven. Bij elke toolaanroep
wordt je rol opnieuw gelezen: ben je gedeactiveerd, dan krijg je direct een weigering en wordt al je toegang ingetrokken.

Alle commando's hieronder in **Git Bash**, in de map `mcp/` van de repo. Gebruik voor secrets nooit een PowerShell-pipe
(die zet er een BOM voor).

---

## 0. Vooraf (eenmalig)

```bash
cd mcp
npm ci
npm test          # moet eindigen met: 128 OK, 0 FOUT
```

## 1. Entra: nieuwe app-registratie "MT MCP"

Een **aparte** registratie, niet die van de MT tool zelf. Zo kunnen tool-tokens en MCP-logins elkaar niet vervangen.

1. Entra-beheercentrum, **App registrations**, **New registration**.
   - Naam: `MT MCP`
   - Supported account types: **Accounts in this organizational directory only** (single tenant).
   - Redirect URI: platform **Web** (niet SPA), adres `https://mt-mcp.bart-a12.workers.dev/callback`
2. Op de pagina **Overview**: kopieer de **Application (client) ID**. Die is niet geheim.
3. **Certificates & secrets**, **New client secret**. Kies 6 maanden en zet een herinnering in je agenda om hem te
   vervangen. Kopieer de **Value** (niet de Secret ID). Die zie je maar één keer.
4. **API permissions**: alleen de OpenID Connect-scopes `openid` en `profile`. Dat zijn geen Graph-rechten: ze zorgen
   alleen dat Microsoft een id-token met je naam en oid teruggeeft. Haal `User.Read` (dat Entra standaard toevoegt) weg
   met **Remove permission**. Er zijn geen andere rechten nodig, ook geen app-permissions.
5. Token configuration: niets nodig. Het id-token bevat `oid`, `tid` en `name` al.
6. **Verplicht tijdens de proef:** **Enterprise applications**, `MT MCP`, **Properties**: zet *Assignment required* op
   **Yes**. Wijs onder *Users and groups* alleen **jezelf** toe. Collega's kunnen dan niet inloggen, ook als ze een rol
   in de MT tool hebben. Pas na de proef (en na de review) voeg je anderen toe.

## 2. Cloudflare: opslag aanmaken en invullen

```bash
wrangler kv namespace create OAUTH_KV
wrangler kv namespace create MCP_DATA
```

Zet de twee `id`'s die dit teruggeeft in `wrangler.toml`, op de plekken met `VUL_IN` bij `OAUTH_KV` en `MCP_DATA`. Zet de
Application (client) ID uit stap 1.2 bij `ENTRA_CLIENT_ID`. `MT_ROLLEN` staat al goed (dezelfde namespace als de
hoofdworker; deze Worker leest er alleen uit).

Controleer of `MCP_BASIS` klopt: `https://mt-mcp.bart-a12.workers.dev`, zonder `/` aan het eind. Laat `CLAUDE_CIMD` voor
nu leeg; die vul je in stap 5.

Er is ook een Durable Object `RefreshSlot` (binding `MCP_REFRESH`). Die hoef je niet zelf aan te maken: `wrangler deploy`
doet dat via de migratie in `wrangler.toml`. Hij zorgt dat een refresh-token maar één keer kan worden gebruikt, ook als
er twee verzoeken tegelijk binnenkomen.

## 3. Secrets (via printf, niet via PowerShell)

Typ of plak een geheim nooit letterlijk in een opdracht: dan komt het in je Bash-geschiedenis. Lees het verborgen in
een variabele, geef het door en wis de variabele daarna:

```bash
read -rs -p 'Plak de secret Value uit stap 1.3 en druk Enter: ' GEHEIM; echo
printf '%s' "$GEHEIM" | wrangler secret put ENTRA_CLIENT_SECRET
unset GEHEIM

read -rs -p 'Plak OWNER_OIDS (oids, met een komma ertussen) en druk Enter: ' GEHEIM; echo
printf '%s' "$GEHEIM" | wrangler secret put OWNER_OIDS
unset GEHEIM
```

Leeg daarna je klembord: `printf ' ' | clip`. Staat de klembordgeschiedenis van Windows aan (Win+V), verwijder het item
daar ook.

`OWNER_OIDS` krijgt dezelfde waarde als bij `mt-claude-proxy`: de vaste eigenaren, gescheiden door komma's. Alleen een
eigenaar mag "alles intrekken" doen (stap 8). Let op: staat er voor een eigenaar wél een record in de rollen en is dat
record gedeactiveerd, dan wordt hij ook hier geweigerd. Heeft een eigenaar geen record, dan blijft hij eigenaar.

De Worker bestaat bij de eerste `secret put` misschien nog niet. Wrangler vraagt dan of hij hem moet aanmaken: antwoord
ja, of doe eerst stap 4 en daarna de secrets.

## 4. Deploy en rooktest

```bash
npm test && wrangler deploy
```

Rooktest, zonder in te loggen:

```bash
B=https://mt-mcp.bart-a12.workers.dev
curl -s $B/.well-known/oauth-authorization-server | head -c 600; echo
curl -s $B/.well-known/oauth-protected-resource/mcp; echo
curl -si -X POST $B/mcp -H 'Content-Type: application/json' -d '{}' | head -5
```

Verwacht: de eerste toont `issuer` = `$B`, **geen** `registration_endpoint` en `code_challenge_methods_supported`
`["S256"]`. De tweede toont `resource` = `$B/mcp`. De derde geeft `401` met een `WWW-Authenticate`-regel met
`resource_metadata`.

Logboek meekijken tijdens de volgende stappen (in een tweede venster):

```bash
wrangler tail mt-mcp
```

## 5. Connector in Claude (eerst)

**Claude web, desktop en mobiel**

Claude meldt zich aan met een eigen client-adres (een "client-metadata-document" op claude.ai). Dat adres staat niet in
de documentatie van Anthropic. Daarom laat de server Claude web/mobiel pas toe als jij dat exacte adres hebt ingevuld.
De eerste poging mislukt dus bewust; die levert het adres op.

1. Zorg dat `wrangler tail mt-mcp` in een tweede venster draait (stap 4).
2. claude.ai, **Settings**, **Connectors**, **Add custom connector**. Naam `MT tool (proef)`, URL
   `https://mt-mcp.bart-a12.workers.dev/mcp`. Laat de geavanceerde velden (OAuth client ID en secret) **leeg**.
3. **Connect**. Je krijgt de melding "Deze app staat niet op de lijst van toegestane apps". Dat is de bedoeling.
4. In het tail-venster staat een regel als
   `{"mcp_client_geweigerd":"https://claude.ai/…","redirect":"https://claude.ai/api/mcp/auth_callback"}`.
   Controleer twee dingen: het adres begint met `https://claude.ai/`, en de redirect is precies
   `https://claude.ai/api/mcp/auth_callback`. Klopt een van beide niet, stop dan en meld het.
5. Zet dat adres in `wrangler.toml` bij `CLAUDE_CIMD = "…"` en deploy opnieuw (`npm test && wrangler deploy`).
6. **Connect** opnieuw. Nu zie je de Microsoft-login en daarna de toestemmingspagina van de MT tool ("Claude vraagt
   toegang…"). Kies **Toestaan**.
7. Nieuwe chat, zet de connector aan en vraag: *"Wie ben ik in de MT tool?"* Verwacht ongeveer:
   *"Je bent Bart, met de rol eigenaar, verbonden via Claude."*
8. Op je telefoon: open de Claude-app. De connector komt mee van je account. Vraag hetzelfde, ook met de stemfunctie.

Maak je `CLAUDE_CIMD` later weer leeg, dan werken bestaande Claude-koppelingen direct niet meer.

**Claude Code (op je pc)**
```bash
claude mcp add --transport http mt-mcp https://mt-mcp.bart-a12.workers.dev/mcp
```
Daarna in Claude Code `/mcp`, kies `mt-mcp`, **Authenticate**. De browser opent; na de login vraagt de MT tool apart
toestemming voor "Claude Code", met een gele waarschuwing dat de toegang naar een programma op je eigen computer gaat.
Dat klopt: toestemming geldt per persoon én per app.

## 6. Connector in ChatGPT Business (daarna)

1. Als werkruimte-beheerder: **Workspace settings**, onderdeel apps/plugins (heette eerder "connectors"). Sta eigen
   (custom) MCP-apps toe, en zet zo nodig **Developer mode** aan voor jezelf. De precieze menunamen verschuiven nogal
   bij OpenAI; zoek op "custom app", "MCP" of "developer mode".
2. In ChatGPT: **Settings**, **Apps** (of Plugins), **Create** of **Add custom app**.
   - Naam `MT tool (proef)`, MCP-server-URL `https://mt-mcp.bart-a12.workers.dev/mcp`, authenticatie **OAuth**.
   - Laat client ID en secret leeg als ChatGPT dat toestaat (hij gebruikt dan zijn eigen client-metadata-document).
3. **Connect**, Microsoft-login, toestemmingspagina ("ChatGPT vraagt toegang…"), **Toestaan**.
4. Nieuwe chat, app aan: *"Wie ben ik in de MT tool?"* Verwacht: *"Je bent Bart, met de rol eigenaar, verbonden via ChatGPT."*

Advies uit het keuzeplan: gebruik voor MT-chats een chat of project met **alleen** deze app aan, zonder mail-, web- of
opslag-apps ernaast (tegen promptinjectie).

## 7. Acceptatietest Voice op de telefoon

1. ChatGPT-app op je telefoon, met hetzelfde Business-account. Controleer dat de app `MT tool (proef)` beschikbaar is.
2. Start **Voice**. Zeg: *"Vraag aan de MT tool wie ik ben."*
3. Verwacht: ChatGPT roept `whoami` aan (zonder om bevestiging te vragen, want de tool is alleen-lezen) en zegt één korte
   zin: naam, rol en "verbonden via ChatGPT".
4. Doe hetzelfde in de Claude-app met de stemfunctie.
5. Noteer per app: werkte het, hoe lang duurde het, werd er om bevestiging gevraagd, en klonk het antwoord natuurlijk.

## 8. Intrekken en deactiveren testen (offboarding)

**A. Deactiveren.** Zet een testgebruiker (niet jezelf) die een verbinding heeft in de MT tool bij Rollen op
gedeactiveerd. Bij zijn volgende vraag krijgt hij direct een weigering, en al zijn MCP-tokens worden ingetrokken.
Opnieuw activeren is niet genoeg om de oude koppeling terug te krijgen: hij moet opnieuw inloggen en opnieuw toestemming
geven.

**B. Alles intrekken voor één persoon (alleen eigenaar).** Dit gebruikt je gewone login van de MT tool, niet een
MCP-token.
1. Open de MT tool in de browser en log in. Open de console (F12) en typ: `copy(await getAuthToken())`. Je token staat
   nu op het klembord. Het is ongeveer een uur geldig; deel het met niemand.
2. In Git Bash. Het token wordt verborgen ingelezen en via stdin aan curl gegeven, zodat het niet in je geschiedenis of
   in de proceslijst komt. Vul alleen de oid van de persoon in (die is niet geheim):
   ```bash
   read -rs -p 'Plak het token en druk Enter: ' TOKEN; echo
   printf 'X-Auth-Token: %s\n' "$TOKEN" | curl -s -X POST https://mt-mcp.bart-a12.workers.dev/beheer/intrekken \
     -H @- -H 'Content-Type: application/json' \
     -d '{"oid":"OID-VAN-DE-PERSOON"}'; echo
   unset TOKEN
   ```
3. Leeg daarna je klembord: `printf ' ' | clip` (en het item in Win+V, als de klembordgeschiedenis aan staat).
4. Verwacht: `{"ok":true,"ingetrokken":{"grants":N,"toestemmingen":M},...}`. Bij die persoon werkt de connector daarna
   niet meer tot hij opnieuw inlogt én toestemming geeft.

Een eigenaar met een gedeactiveerd record krijgt hier `403`: ook voor eigenaren telt deactiveren.

## 9. Wat er bewaard wordt

- `OAUTH_KV`: de grants en tokens van de OAuth-library. Tokens alleen als hash.
- Durable Object `RefreshSlot`: per koppeling de hashes van gebruikte refresh-tokens (geen tokens zelf), na 31 dagen
  automatisch opgeruimd.
- `MCP_DATA`: per persoon en per app een toestemming (scopes, wanneer gegeven, verloopt na 30 dagen), en een audit
  zonder inhoud: wie (oid), via welke app, welke tool of gebeurtenis, tijd en resultaat. Bewaard 400 dagen.
- Er worden geen Microsoft-tokens, geen vragen en geen antwoorden bewaard.

Audit bekijken (nieuwste eerst):
```bash
wrangler kv key list --binding MCP_DATA --prefix audit: --remote | head -40
```

## 10. Als het niet werkt

| Wat je ziet | Waarschijnlijke oorzaak | Wat te doen |
|---|---|---|
| "Deze app staat niet op de lijst van toegestane apps" | Bij Claude web/mobiel: `CLAUDE_CIMD` is nog leeg of klopt niet (zie stap 5). Anders: Claude Code of ChatGPT gebruikt een ander client-adres of een andere redirect dan in de allowlist | In `wrangler tail` staat een regel `mcp_client_geweigerd`. Die toont van het client-adres en de redirect alleen schema, host en pad: geen query, fragment of inloggegevens. Voor Claude web/mobiel: zet het adres in `CLAUDE_CIMD` (stap 5). Voor de rest: geef de regel door aan Claude, dan wordt de allowlist in `src/gedeeld.js` (met test) aangepast. Bekend alternatief bij ChatGPT: `https://chatgpt.com/connector/oauth/{id}`. |
| "Deze app kon niet worden gecontroleerd" | Het client-metadata-document van de app was niet op te halen | Later opnieuw proberen; blijft het, `wrangler tail` bekijken. |
| De connector vraagt om een client ID en secret | De app wil dynamische registratie (DCR), en die staat bewust uit | Melden; niet zelf DCR aanzetten. |
| "Nog niet ingericht" of `niet_ingericht` | `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, een KV-id of de Durable Object-binding ontbreekt | Stap 2 en 3 nalopen; daarna opnieuw `wrangler deploy`. |
| Microsoft meldt AADSTS50011 (redirect mismatch) | Redirect in Entra wijkt af | Moet exact `https://mt-mcp.bart-a12.workers.dev/callback` zijn, platform **Web**. |
| Microsoft meldt AADSTS7000215 (invalid client secret) | De Value verkeerd gekopieerd, of de Secret ID gebruikt | Nieuwe secret maken en stap 3 opnieuw doen. |
| "Geen toegang: je account heeft geen actieve rol" | Geen of een gedeactiveerde rol in `MT_ROLLEN` | Rol geven in de MT tool (of je oid in `OWNER_OIDS`). |
| Na een tijdje moet je opnieuw inloggen | Bewust: na 30 dagen, of als een refresh-token twee keer wordt gebruikt (mogelijk gelekt), vervalt de hele koppeling | Opnieuw verbinden. |

## Open punten vóór dit verder gaat dan de proef

- Het client-adres van Claude Code komt uit de documentatie van Anthropic. Dat van Claude web/mobiel vul je zelf in
  (stap 5). Dat van ChatGPT (`https://chatgpt.com/oauth/client.json`) is nog niet live getest. Stap 5 en 6 testen de
  allowlist dus meteen mee.
- Laat Codex de OAuth-laag reviewen voordat collega's toegang krijgen (keuzeplan, punt 10 van het onderzoek).
- De volgende fase (leestools) komt pas na deze proef en krijgt eigen scopes, zoals `mt.read.search`.
