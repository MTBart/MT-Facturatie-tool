# CHANGELOG — Mortise & Tenon Claude Tools

Automatisch bijgehouden via git. Elke commit verschijnt hier.
Grote bestanden (index.html, uren.html) worden gebackupt in `_backups/` bij elke commit.

---

## 2026-10-12 — Projectnummers A1: veld projectnummer en samenvoegen van mt_projecten op project_id
- Commit: `4b89547` | Auteur: Bart Witte

## 2026-10-12 — gitignore: lokale back-upmappen
- Commit: `40e5e6c` | Auteur: Bart Witte

## 2026-10-12 — F6: grafstenen ook zonder nieuwe verlopen claim opruimen en het verlopen/afronden van claims in een atomaire transactie
- Commit: `9ec54dc` | Auteur: Bart Witte

## 2026-10-12 — Release v2.13.3: Toggl-capaciteit op de projecttijdlijn, AI-limieten met exacte telling, CSP-meldingen in de teller-DO; backup = v2.13.2
- Commit: `25d6b93` | Auteur: Bart Witte

## 2026-10-12 — Codex over v2.13.3: geen hartslag in log, tools in de terugval, CSP stopt na een vol budget, Toggl-legenda voor personen buiten het team
- Commit: `27335b5` | Auteur: Bart Witte

## 2026-10-12 — F6: invoer exact tellen, hartslag tegen het alarm, late afronding; Toggl-capaciteit "deels Toggl, deels Beheer" (Codex-punten)
- Commit: `be4e50f` | Auteur: Bart Witte

## 2026-10-12 — CSP-rapporten tellen in de teller-DO in plaats van in KV (Codex-punt)
- Commit: `8b21363` | Auteur: Bart Witte

## 2026-10-12 — Toggl-capaciteit voor de projecttijdlijn: echte antwoordvorm lezen, per persoon, met zichtbare reden bij terugval
- Commit: `c515826` | Auteur: Bart Witte

## 2026-10-12 — F6-rest: veilige bovengrens voor documenten en een DO-alarm voor verlopen claims
- Commit: `b9fd47a` | Auteur: Bart Witte

## 2026-10-12 — CSP: afgedwongen minimale meta-CSP, Report-Only-beleid in _headers (Cloudflare Pages) en de worker-route /csp-rapport
- Commit: `f975c86` | Auteur: Bart Witte

## 2026-10-12 — Release v2.13.2: "Kan ik dit uitgeven?" en het maandagbericht in Geld, AI-limieten (eerst in log-modus); backup = v2.13.1
- Commit: `305023d` | Auteur: Bart Witte

## 2026-10-12 — G6 Codex cf91ab0: een onvolledige bron geeft nooit "ja" (uitkomst onbekend), en alle bedragen in gehele centen
- Commit: `b7f76a7` | Auteur: Bart Witte

## 2026-10-12 — F6 Codex a4b31cb: afgebroken streams, documenten, ontbrekende binding, logboek zonder namen, max_tokens alleen begrenzen in afdwingen
- Commit: `d8a0aaf` | Auteur: Bart Witte

## 2026-10-11 — G6: "Kan ik € X uitgeven op datum Y?" in Geld (desktop en mobiele laag) en het maandagbericht als melding in de app
- Commit: `cf91ab0` | Auteur: Bart Witte

## 2026-10-11 — F6: AI-limieten de eerste week in log-modus (AI_LIMIET_MODUS = "log")
- Commit: `954e3c9` | Auteur: Bart Witte

## 2026-10-11 — F6: AI-limieten in de worker (één serversleutel, limiet per gebruiker, logboek zonder inhoud)
- Commit: `a4b31cb` | Auteur: Bart Witte

## 2026-10-11 — Release v2.13.1: Geld op je telefoon, geen leveranciersposten meer als ontvangst, offertenummer automatisch uit Moneybird; backup = v2.13.0
- Commit: `09e1031` | Auteur: Bart Witte

## 2026-10-11 — Geld Codex b5b069a/c4107e8: creditnota zonder contact-id en vreemde valuta zonder EUR-bedrag tellen nooit mee; kaart Ruimte ook op mobiel
- Commit: `c10870e` | Auteur: Bart Witte

## 2026-10-11 — P3b Codex 3bcf037: offertenummer alleen automatisch bij hetzelfde contact + eigen koppeling, persistente throttle, rechten, write-ahead + ongedaan maken, centrale werkcode-validatie
- Commit: `f20ae19` | Auteur: Bart Witte

## 2026-10-11 — Geld op mobiel: de €-knop opent een Geld-laag binnen mobiel.html (geen v2.html meer), met mt-geld.js in compacte weergave
- Commit: `c4107e8` | Auteur: Bart Witte

## 2026-10-11 — Geld: leveranciersposten niet meer als groen pijltje (concept-verkoop telt niet, inkoop-creditnota wordt verrekend of is tegoed)
- Commit: `b5b069a` | Auteur: Bart Witte

## 2026-10-11 — P3b: generator uit, offertenummer overnemen bij versturen, meerwerk-offertes, mapnaam "Volledige naam [code]" voor nieuwe projecten
- Commit: `3bcf037` | Auteur: Bart Witte

## 2026-10-11 — G7 Codex 94e4ced: btw-tekst verankerd in de omschrijving, tegenpartij moet Belastingdienst zijn
- Commit: `ed6b8be` | Auteur: Bart Witte

## 2026-10-11 — Release v2.13.0: zoekbalk bovenin, Besteedbaar budget in Geld (noodbuffer, gele lijn, adviezen als standaard, alle onbetaalde btw-kwartalen); backup = v2.12.4
- Commit: `3e0ccb9` | Auteur: Bart Witte

## 2026-10-11 — G7 Codex c76a4bd: alleen de expliciete tekst betaalt een btw-kwartaal; geen marges; één genormaliseerde buffer-waarde; advies-cache met revisie
- Commit: `94e4ced` | Auteur: Bart Witte

## 2026-10-11 — G7 Codex 8ae58d5: strikte herkenning van btw-betalingen, cache voor oudere kwartalen, dual-write buffer_lopend
- Commit: `c76a4bd` | Auteur: Bart Witte

## 2026-10-11 — Gedeeld: SharePoint-bestand aanmaken met If-None-Match en samenvoeger met mailbox-identiteit (cockpit en Outlook-paneel)
- Commit: `db2ba39` | Auteur: Bart Witte

## 2026-10-11 — Zoekbalk: Codex-eindreview — voorspelbare KQL-zoekfrase, 429 per postbus, hard begrensde alarm-run
- Commit: `422e175` | Auteur: Bart Witte

## 2026-10-11 — Zoekbalk: hervatbare opbouw van de Moneybird-zoekindex (DO-alarm) en Retry-After als seconden of HTTP-datum
- Commit: `8bb4b8c` | Auteur: Bart Witte

## 2026-10-11 — Zoekbalk brok 4: e-mail als zoekbron (Graph-search in eigen postbus en info@)
- Commit: `e09491d` | Auteur: Bart Witte

## 2026-10-11 — Zoekbalk: Moneybird-zoekroute — recht altijd, atomaire opbouw via Durable Object, complete index, 429 terminaal
- Commit: `01c89c2` | Auteur: Bart Witte

## 2026-10-11 — Zoekbalk: sink-baseline voor de twee fetch-URL's in mt-zoek-extern.js
- Commit: `6465b43` | Auteur: Bart Witte

## 2026-10-11 — Zoekbalk: Codex-fixes (rechten-race, Enter-contract, index, afgeronde taken, Android-terug)
- Commit: `a8b8f29` | Auteur: Bart Witte

## 2026-10-11 — Zoekbalk: Moneybird-index gebruikt period:prev_year (last_year bestaat niet in Moneybird)
- Commit: `76ad68d` | Auteur: Bart Witte

## 2026-10-11 — Zoekbalk brok 3: externe bronnen Moneybird (facturen, offertes) en SharePoint (mappen, bestanden)
- Commit: `9cbd18d` | Auteur: Bart Witte

## 2026-10-11 — Zoekbalk verfijning: Larry-regel, eigen chatveld, mobiele zoeklaag
- Commit: `19c78a8` | Auteur: Bart Witte

## 2026-10-11 — Zoekbalk brok 2: gedeelde zoekbron mt-zoek.js
- Commit: `6992172` | Auteur: Bart Witte

## 2026-10-11 — Zoekbalk brok 1: het zoekbalk-kader bovenin v2 en mobiel
- Commit: `5a52171` | Auteur: Bart Witte

## 2026-10-11 — G7 Codex 2× HOOG: alle onbetaalde btw-kwartalen, dekking gelijk aan de worker; advies als basis voor de oude adviezen; buffer_lopend samengevoegd
- Commit: `8ae58d5` | Auteur: Bart Witte

## 2026-10-11 — G7 aanvulling: streefbedragen volgen standaard het advies; een eigen bedrag wint, leeg = weer het advies
- Commit: `b93e786` | Auteur: Bart Witte

## 2026-10-11 — G7 Besteedbaar budget in Geld: hoofdgetal, noodbuffer met vinkje, fictieve buffer als gele lijn, lijnen en adviezen
- Commit: `5f13848` | Auteur: Bart Witte

## 2026-10-11 — Release v2.12.4: tekstbeveiliging ook in Geld, Koersmeter, rapporten, cijfers, schulden, verhuisknop, aanwezigheid en dialogen (F7 3b groep 6, 3b af); backup = v2.12.3
- Commit: `35773f5` | Auteur: Bart Witte

## 2026-10-11 — Codex fa47ed9: potnaam niet dubbel escapen, hook controleert de index, recursieve bronnen, houd-lijsten met vingerafdruk
- Commit: `a0b3632` | Auteur: Bart Witte

## 2026-10-11 — F7 3b groep 6: tekstsinks in mt-geld, mt-cijfers, mt-schulden, mt-verhuis, mt-rapport, mt-aanwezig, mt-dialog en mt-koers (3b af)
- Commit: `fa47ed9` | Auteur: Bart Witte

## 2026-10-11 — tools/check-sinks.js: alle sink-baselines in de repo, in de pre-commit-hook en verplicht bij elke release
- Commit: `54ad162` | Auteur: Bart Witte

## 2026-10-11 — Release v2.12.3: tekstbeveiliging in alle schermen (F7 3b groepen 1-5), ruimtenaam-fix, spaarpot-herkenning met rekeningnummer; backup = v2.12.2
- Commit: `cde3c78` | Auteur: Bart Witte

## 2026-10-11 — HOOG (Codex 121e465): ruimtenaam in een inline onclick van mobiel.html; handler-baseline
- Commit: `e5bedd9` | Auteur: Bart Witte

## 2026-10-11 — F7 3b groep 5: tekstsinks in uren.html en mt-toggl.js
- Commit: `07f152d` | Auteur: Bart Witte

## 2026-10-11 — Codex a7fcc3f: Attentie escapet één keer; links uit data via veiligeLink; baselines voor plakwerk en url-sinks
- Commit: `3a74f4b` | Auteur: Bart Witte

## 2026-10-11 — F7 3b groep 4: tekstsinks in mobiel.html
- Commit: `121e465` | Auteur: Bart Witte

## 2026-10-11 — F7 3b groep 3: tekstsinks in de rest van v2.html (voorraad, planning, projecten, nacalculatie, attentie, agenda, admin)
- Commit: `a7fcc3f` | Auteur: Bart Witte

## 2026-10-11 — Geld: pot herkennen ook als de naam letter + rekeningnummer heeft ("spaarrekening Z96824563")
- Commit: `0d52c40` | Auteur: Bart Witte

## 2026-10-11 — Release v2.12.2: spaarpotjes volgen de echte overboekingen, melding vóór 07:00, veiliger; backup = v2.12.1
- Commit: `a5e3e2c` | Auteur: Bart Witte

## 2026-10-11 — Geld: potten herkennen aan de letter in de naam ("Zakelijke oranje spaarrekening Z")
- Commit: `9991dc7` | Auteur: Bart Witte

## 2026-10-11 — Geld: potstand volgt de werkelijke overboekingen; niet-herkende overboekingen zijn nooit stil
- Commit: `78ba980` | Auteur: Bart Witte

## 2026-10-11 — Koersmeter-cron: klaar vóór 07:00 (run vanaf 05:30 lokaal, voorverversing van de caches)
- Commit: `6e019b4` | Auteur: Bart Witte

## 2026-10-11 — F7 3b groep 2: tekstsinks in mt-inbox.js (mail, To Do, mappen, bijlagen)
- Commit: `e9af7bc` | Auteur: Bart Witte

## 2026-10-11 — Release v2.12.1: Koersmeter meldt 's ochtends, veiliger; backup = v2.12.0
- Commit: `369ade0` | Auteur: Bart Witte

## 2026-10-11 — Blok G (Codex op 8ef0deb + 08abc05): SHA-256-vingerafdruk verhuizer, cron-budget en dagclaim
- Commit: `48fc0cd` | Auteur: Bart Witte

## 2026-10-11 — F7 3b groep 1: tekstsinks v2 Moneybird/mail/SharePoint door esc()
- Commit: `28fe44c` | Auteur: Bart Witte

## 2026-10-11 — Koersmeter A+A2: ochtendrun via Cron Trigger, melding in KV, getoond bovenaan Geld en als badge op mobiel
- Commit: `08abc05` | Auteur: Bart Witte

## 2026-10-11 — Verhuizer: IDB-kandidaten vóór de write (crashvenster dicht) en exclusief slot via navigator.locks
- Commit: `8ef0deb` | Auteur: Bart Witte

## 2026-10-11 — Release v2.12.0: veiligheid, klantenlijst via de server, Koersmeter vergelijkt met gisteren, verhuisknop voorbereid; backup = v2.11.10
- Commit: `77dc642` | Auteur: Bart Witte

## 2026-10-11 — Tooling-fixes na Codex F: changelog-seed uit de volledige geschiedenis, pre-commit fail closed, atomaire back-up-rotatie
- Commit: `44fd23b` | Auteur: Bart Witte

## 2026-10-11 — Codex-verificatie A+B: F1-F5 (klanten-writes via Durable Object, fail-closed back-up en changelog, persistent importjournaal)
- Commit: `8f12d5b` | Auteur: Bart Witte

## 2026-10-11 — Koersmeter: Codex-bevindingen E1-E2 (onbevestigde koppelingen zijn onvolledig, geen dubbele ontvangst)
- Commit: `b340eee` | Auteur: Bart Witte

## 2026-10-11 — F7 release 2: Codex-bevindingen C1-C6 (ruwe waarden in innerHTML, bijlage-link, vertrouwde HTML in een private WeakSet)
- Commit: `b41141b` | Auteur: Bart Witte

## 2026-10-11 — F5 stap 2: Codex-bevindingen B1-B8 (verhuisknop: alles of niets, per gebruiker, geen versie-bump)
- Commit: `859108b` | Auteur: Bart Witte

## 2026-10-11 — F5 stap 1: CHANGELOG.md zonder klantnamen (hook neutraliseert via tools/changelog.js)
- Commit: `56ca7f2` | Auteur: Bart Witte

## 2026-10-11 — F5 stap 1: Codex-bevindingen A1-A8 (back-up en Claude-context uit het publieke deel, /klanten met revisie en types)
- Commit: `e6609f9` | Auteur: Bart Witte

## 2026-10-11 — F7 release 3a: één veilige renderlaag + alle dynamische handler-argumenten veilig
- Commit: `399ac97` | Auteur: Bart Witte

## 2026-10-11 — Koersmeter: worker-vlag onvolledig + Koersmeter C (sinds gisteren, één actie, dagfoto's)
- Commit: `597d114` | Auteur: Bart Witte

## 2026-10-11 — F7 release 2: uren.html, koppel-popovers, mobiel-handlers, mt-dialog html alleen bewust
- Commit: `4ba1baa` | Auteur: Bart Witte

## 2026-10-11 — F5 stap 2: verhuisknop (uit tot het domein gekoppeld is)
- Commit: `19c99e3` | Auteur: Bart Witte

## 2026-10-11 — F5 stap 1b: ook de back-upkopie van de klantenlijst uit de repo
- Commit: `6d21e01` | Auteur: Bart Witte

## 2026-10-11 — F5 stap 1b: data/klanten.json uit de repo (lokaal bewaard)
- Commit: `3bea3d9` | Auteur: Bart Witte

## 2026-10-11 — F5 stap 1: CORS oud+nieuw, klantenlijst via de worker, opruimen, privé-notities uit git
- Commit: `4ffd483` | Auteur: Bart Witte

## 2026-10-10 — Release v2.11.10: Schulden en aflossen in Geld; backup = v2.11.9
- Commit: `21a25ec` | Auteur: Bart Witte

## 2026-10-10 — Schulden: potstand in centen afronden i.p.v. afkappen (Codex)
- Commit: `079d74c` | Auteur: Bart Witte

## 2026-10-10 — Schulden: terugboeken begrensd op de potstand; reserve-zin voorwaardelijk (Codex)
- Commit: `4021b77` | Auteur: Bart Witte

## 2026-10-10 — Schulden: startdatum in de berekening; onbekende velden geweigerd (Codex)
- Commit: `07422a1` | Auteur: Bart Witte

## 2026-10-10 — Schulden: sleutel rekening-courant botst nooit met een lening-id
- Commit: `e65a541` | Auteur: Bart Witte

## 2026-10-10 — Schulden: rekening-courant (rood staan) i.p.v. een tweede lening
- Commit: `4bd7086` | Auteur: Bart Witte

## 2026-10-10 — Schulden in Geld: aflosschema en rekenhulp extra aflossen, met kas-effect
- Commit: `aad0b73` | Auteur: Bart Witte

## 2026-10-09 — Release v2.11.9: Koersmeter bovenaan Geld; backup = v2.11.8
- Commit: `17907f1` | Auteur: Bart Witte

## 2026-10-09 — Koersmeter: Moneybird-afkap als onvolledig; branchelabel (Codex)
- Commit: `5e5b8e5` | Auteur: Bart Witte

## 2026-10-09 — Koersmeter (variant A) bovenaan Geld
- Commit: `71b09fa` | Auteur: Bart Witte

## 2026-10-09 — Release v2.11.8: startpagina per rol + rollen ook bij traag inloggen; backup = v2.11.7
- Commit: `ca56195` | Auteur: Bart Witte

## 2026-10-09 — Updates 2.11.8: item voor wie geen Geld-recht heeft
- Commit: `036e14a` | Auteur: Bart Witte

## 2026-10-09 — Startpagina: #tab=dashboard telt niet als deeplink; Personen-label (Codex)
- Commit: `f77d469` | Auteur: Bart Witte

## 2026-10-09 — Startpagina per rol: zonder Geld-recht de eigen planning in Agenda
- Commit: `7405d04` | Auteur: Bart Witte

## 2026-10-09 — Geld als startpagina voor wie Geld mag
- Commit: `cb61614` | Auteur: Bart Witte

## 2026-10-09 — Hotfix rollen: begrensd budget bij een blijvende /me-fout (Codex)
- Commit: `e3ae1d6` | Auteur: Bart Witte

## 2026-10-09 — Hotfix: rollen opnieuw laden als het token bij de eerste laad nog niet klaar is
- Commit: `5d317de` | Auteur: Bart Witte

## 2026-10-09 — Release v2.11.7: veiligheid (XSS release 1); backup = v2.11.6
- Commit: `08fdf89` | Auteur: Bart Witte

## 2026-10-09 — F7 XSS release 1: escaping, URL-allowlist en geen waarden meer in inline handlers
- Commit: `fdbeb4f` | Auteur: Bart Witte

## 2026-10-09 — Release v2.11.6: prognose alleen met genoeg historie; backup = v2.11.5
- Commit: `4e3ed93` | Auteur: Bart Witte

## 2026-10-09 — Rapporten: prognose alleen met genoeg historie
- Commit: `c895cae` | Auteur: Bart Witte

## 2026-10-09 — Release v2.11.5: lonen via inkoopfacturen, eerlijkere prognose; backup = v2.11.4
- Commit: `73f8986` | Auteur: Bart Witte

## 2026-10-09 — Rapporten: lonen via inkoopfacturen; eerlijkere prognose in de grafiek
- Commit: `a4d0fe1` | Auteur: Bart Witte

## 2026-10-09 — Release v2.11.4: lonen ook via een tussenrekening; backup = v2.11.3
- Commit: `3889f8c` | Auteur: Bart Witte

## 2026-10-09 — Rapporten: lonen ook via een tussenrekening (activa)
- Commit: `c0a673c` | Auteur: Bart Witte

## 2026-10-09 — Release v2.11.3: lonen via balansgrootboeken in het eerlijke beeld; backup = v2.11.2
- Commit: `93a02f6` | Auteur: Bart Witte

## 2026-10-09 — Rapporten: lonen via balansgrootboeken in het eerlijke beeld
- Commit: `a0baeb7` | Auteur: Bart Witte

## 2026-10-09 — Release v2.11.2: eerlijk beeld te controleren en bij te stellen; backup = v2.11.1
- Commit: `4c0c1ae` | Auteur: Bart Witte

## 2026-10-09 — Rapporten: eerlijk beeld te controleren en bij te stellen
- Commit: `ff432a7` | Auteur: Bart Witte

## 2026-10-09 — Release v2.11.1: eerlijk beeld zonder opnames van de eigenaren; backup = v2.11
- Commit: `0169cb0` | Auteur: Bart Witte

## 2026-10-09 — Rapporten: eerlijk beeld zonder opnames van de eigenaren (hotfix)
- Commit: `d34da53` | Auteur: Bart Witte

## 2026-10-09 — Release v2.11: interactieve cijfers en grafieken bij de rapporten; backup = v2.10
- Commit: `29675e4` | Auteur: Bart Witte

## 2026-10-09 — Rapporten (G9): interactieve cijfers en grafieken bij de rapporten
- Commit: `e9e2e8b` | Auteur: Bart Witte

## 2026-10-08 — Release v2.10: tabblad Rapporten voor de CEO-avond; backup = v2.9.9
- Commit: `77776e2` | Auteur: Bart Witte

## 2026-10-08 — Rapporten (G8): tabblad voor de CEO-avond, vragen en acties, schrijfroute met sleutel
- Commit: `a64cbfb` | Auteur: Bart Witte

## 2026-10-08 — Release v2.9.9: wat roodstaan kost en wat zelf bufferen oplevert, advies naast het doel (geld); backup = v2.9.8
- Commit: `56ab460` | Auteur: Bart Witte

## 2026-10-08 — Geld: kaart roodstaan (kosten en besparing), advies naast het doel
- Commit: `424b8a9` | Auteur: Bart Witte

## 2026-10-08 — Release v2.9.8: doelen groeien voorzichtiger mee, eerlijker beeld van de bank (geld); backup = v2.9.7
- Commit: `a66b373` | Auteur: Bart Witte

## 2026-10-08 — Geld: meegroeien voorzichtig, lopend-advies op vaste lasten, eerlijke bankweergave
- Commit: `64d87b0` | Auteur: Bart Witte

## 2026-10-08 — Release v2.9.7: eigen reserve als nullijn en meegroeiende doelen (geld); backup = v2.9.6
- Commit: `d732e59` | Auteur: Bart Witte

## 2026-10-08 — Geld: eigen reserve (fictieve nullijn), meegroeiende doelen
- Commit: `b3e91dc` | Auteur: Bart Witte

## 2026-10-08 — Release v2.9.6: inlog op tijd vernieuwd (geen stille 401s na een uur); backup = v2.9.5
- Commit: `fa87180` | Auteur: Bart Witte

## 2026-10-08 — Inlog: verlopen ID-token op tijd vernieuwen, 401 een keer opnieuw
- Commit: `2615b2d` | Auteur: Bart Witte

## 2026-10-08 — Release v2.9.5: eerlijkere limietwaarschuwing en grafiek verder in de tijd; backup = v2.9.4
- Commit: `87d7c64` | Auteur: Bart Witte

## 2026-10-08 — Geld: limietwaarschuwing alleen over de BTW-terugboeking; zone "alleen vaste lasten bekend"
- Commit: `0d244a9` | Auteur: Bart Witte

## 2026-10-08 — Release v2.9.4: achterstallige verkoop realistischer, limietwaarschuwing; backup = v2.9.3
- Commit: `3baf382` | Auteur: Bart Witte

## 2026-10-08 — Geld: achterstallige verkoop (optie C), limietwaarschuwing alleen-lopend, net opgeslagen sleutels
- Commit: `a81790f` | Auteur: Bart Witte

## 2026-10-08 — Release v2.9.3: verse stand direct na een wijziging; backup = v2.9.2
- Commit: `a1b2419` | Auteur: Bart Witte

## 2026-10-08 — Geld: verse stand direct na een wijziging (cacheversie in het antwoord)
- Commit: `ced8bd9` | Auteur: Bart Witte

## 2026-10-08 — Release v2.9.2: BTW-rekening hoort bij de lopende rekening; backup = v2.9.1
- Commit: `e4da576` | Auteur: Bart Witte

## 2026-10-08 — Geld: BTW-rekening telt mee als lopende rekening, potjes zijn echt weg (rekenregels Bart)
- Commit: `0e4bf0e` | Auteur: Bart Witte

## 2026-10-08 — Release v2.9.1: geldscherm met duidelijkere meldingen; backup = v2.9
- Commit: `d73eacd` | Auteur: Bart Witte

## 2026-10-08 — Hotfix geld (worker): Moneybird 429 en de 10-jaarsgrens
- Commit: `6465d7a` | Auteur: Bart Witte

## 2026-10-08 — Release v2.9: geldtijdlijn (tabblad Geld) + "Wat is er verbeterd"; backup = v2.8
- Commit: `4b02568` | Auteur: Bart Witte

## 2026-10-08 — Geldtijdlijn: bankdagen, rooktest G5 en Codex-eindreview verwerkt
- Commit: `f164e2e` | Auteur: Bart Witte

## 2026-10-08 — G5 geldtijdlijn: prognose, factuurmoment-hulp en G4-rooktestpunten
- Commit: `63364b9` | Auteur: Bart Witte

## 2026-10-08 — G4 geldscherm: tabblad Geld (mt-geld.js) met kaarten, lijn, 14 dagen, potjes en doelen
- Commit: `c1155ec` | Auteur: Bart Witte

## 2026-10-08 — G3 geldtijdlijn: vaste patronen, potjes-weekinleg, BTW-sparen en BTW-aangifte (worker)
- Commit: `52b1266` | Auteur: Bart Witte

## 2026-10-08 — G2 geldtijdlijn: betaaldag-logica, betaalprofiel, klantgroepen en per-factuur overrides (worker)
- Commit: `61a056c` | Auteur: Bart Witte

## 2026-10-07 — U1 "Wat is er verbeterd": data/updates.json + kaart in Beheer + eenmalig "nieuw"-stipje
- Commit: `98bdf59` | Auteur: Bart Witte

## 2026-10-07 — Release v2.8: Controlelijst projecten in Beheer; backup = v2.7
- Commit: `66b3004` | Auteur: Bart Witte

## 2026-10-07 — magGeld: terugval voor een worker zonder recht geld (veilig vóór de worker-deploy)
- Commit: `d6a5b6c` | Auteur: Bart Witte

## 2026-10-07 — G1-aanvulling: spaarpotjes-model, kredietlimiet, BTW-config; recht geld + rol administratie
- Commit: `7ac3d92` | Auteur: Bart Witte

## 2026-10-07 — G1 geldtijdlijn: fundament /geld/* in de worker (eigenaar-only, niets stil weg)
- Commit: `d12ba88` | Auteur: Bart Witte

## 2026-10-07 — P3a polijst (rooktest): voorstel-soort zichtbaar, intern zonder offertezoeken, klant invullen
- Commit: `5e5548b` | Auteur: Bart Witte

## 2026-10-07 — P3a: Controlelijst projecten in Beheer (voorstellen + data zonder project)
- Commit: `021f412` | Auteur: Bart Witte

## 2026-10-07 — Release v2.7: project_id onder elk project, werkcode via worker-teller, instelling projectcode; backup = v2.6.1
- Commit: `f08cb5a` | Auteur: Bart Witte

## 2026-10-07 — Projectenlijst: klantnaam als gewone tekst, chipje alleen voor een echt nummer
- Commit: `482cb74` | Auteur: Bart Witte

## 2026-10-07 — Merge release v2.6.1 (origin/main) in main
- Commit: `166e677` | Auteur: Bart Witte

## 2026-10-07 — Projectnummering: werkcode via worker-teller + instelling "Projectcode tonen als"
- Commit: `c39a32f` | Auteur: Bart Witte

## 2026-10-07 — Release v2.6.1: geen generator-code meer zichtbaar; backup = v2.6
- Commit: `7e23163` | Auteur: Bart Witte

## 2026-10-07 — Merge v2.6.1-weergave (geen generator-code zichtbaar) in main met P2
- Commit: `c5da69b` | Auteur: Bart Witte

## 2026-10-07 — v2.6.1 weergave: geen generator-code meer zichtbaar (besluit Bart)
- Commit: `15c9366` | Auteur: Bart Witte

## 2026-10-07 — Projectnummering P2: project_id + dual-read via projVind
- Commit: `3065fa8` | Auteur: Bart Witte

## 2026-10-07 — Release v2.6: Moneybird-bevestiging + geen dubbele acties, contactenregister, namen zonder gokken; backup = v2.5
- Commit: `0363cb4` | Auteur: Bart Witte

## 2026-10-07 — Namen zo compleet mogelijk, onbekend = leeg + "+ invullen" (besluit Bart)
- Commit: `3efbdc0` | Auteur: Bart Witte

## 2026-10-07 — Na merge contacten: locatie ook in keuzelijst, klantkop en contactkaart nooit als kale code
- Commit: `bc3e3cc` | Auteur: Bart Witte

## 2026-10-07 — Samenvoegen: contactenregister (branch contacten)
- Commit: `8eb25ea` | Auteur: Bart Witte

## 2026-10-07 — UX: locatie nooit als kale code, betere afgeleide projectstatus, projectenlijst blijft in beeld
- Commit: `655844b` | Auteur: Bart Witte

## 2026-10-07 — Contactenregister: Codex-ronde verwerkt (geen stille overschrijvingen, merger-lijsten, modale overlays, handtekening na klik)
- Commit: `47a4969` | Auteur: Bart Witte

## 2026-10-07 — F2–F4: bevestiging bij elke Moneybird-schrijfactie, concepten hooguit één keer (UI + Codex-ronde)
- Commit: `a77504e` | Auteur: Bart Witte

## 2026-10-07 — Contactenregister: UI (klantpagina, projectkaart, zoeker, droogloop), haakjes in v2/mobiel/inbox
- Commit: `b0f7471` | Auteur: Bart Witte

## 2026-10-07 — Contactenregister: kern (model, ontdubbeling, aanvullen met voorstellen, merger, bronnen, handtekening)
- Commit: `b10a30a` | Auteur: Bart Witte

## 2026-10-07 — Worker F2–F4: proxy-contract (allowlist), bevestiging bij Moneybird-writes, idempotente acties
- Commit: `b224406` | Auteur: Bart Witte

## 2026-10-07 — Release v2.5: Toggl zelf koppelen + planvoorstellen; backup = v2.4.1
- Commit: `cb14727` | Auteur: Bart Witte

## 2026-10-07 — Aanwezigheidskaart achter feature-flag (komt later als laag in het Planbord)
- Commit: `7e3deed` | Auteur: Bart Witte

## 2026-10-07 — wrangler.toml: SLEUTEL_KEK roteren via SLEUTEL_KEK_VORIG
- Commit: `f187232` | Auteur: Bart Witte

## 2026-10-07 — App F1e: Koppel je Toggl, planvoorstellen en Vandaag aanwezig (v2 + mobiel)
- Commit: `12eb26f` | Auteur: Bart Witte

## 2026-10-07 — Worker F1e: KEK-rotatie, server-sleutels nooit koppelen, aanwezig altijd met rol (Codex-ronde)
- Commit: `da511a0` | Auteur: Bart Witte

## 2026-10-07 — Worker F1e: eigen Toggl-sleutel (versleuteld per gebruiker) en aanwezigheidsbord
- Commit: `4822006` | Auteur: Bart Witte

## 2026-10-07 — Release v2.4.1: Beheer/Activiteit laden ook bij directe link; backup = v2.4
- Commit: `6677f46` | Auteur: Bart Witte

## 2026-10-07 — Beheer-auditlog: koppeling van een uitrol-uitnodiging toont "uitrol" als door
- Commit: `4ecd2fb` | Auteur: Bart Witte

## 2026-10-07 — Beheer bleef op "Laden…" bij openen via #tab=instellingen (deeplink vóór /me)
- Commit: `8b80c5b` | Auteur: Bart Witte

## 2026-10-07 — Release v2.4: rollen (Beheer-scherm, meekijkstand); backup = v2.3
- Commit: `46fcd56` | Auteur: Bart Witte

## 2026-10-07 — Rollen: meerdere vaste eigenaren (OWNER_OIDS + OWNER_EMAILS), eigenaar kan eigenaar maken
- Commit: `924207f` | Auteur: Bart Witte

## 2026-10-07 — Rollen: besluiten Bart — Werkplaats taakstatus en nieuwe taak, MB-verwijderen alleen Eigenaar
- Commit: `fd5b71e` | Auteur: Bart Witte

## 2026-10-07 — Rollen in de app (F1c): Instellingen → Beheer, /me en verbergen volgens de rol
- Commit: `4d370ce` | Auteur: Bart Witte

## 2026-10-07 — Rollen in de worker (F1a/F1b): strengere tokencontrole, rol per gebruiker, eerst alleen loggen
- Commit: `02caa93` | Auteur: Bart Witte

## 2026-10-07 — Release v2.3: koppel-badges; vorige versie v2.2 als vaste backup
- Commit: `7626571` | Auteur: Bart Witte

## 2026-10-07 — Koppel-badge: altijd lichte pillen, namen in plaats van ids, projectmap eerst popover
- Commit: `91cc7ee` | Auteur: Bart Witte

## 2026-10-07 — Koppel-badge in Moneybird-stijl: overal hetzelfde open/gekoppeld-icoon met voorstellen en details
- Commit: `e88ac5b` | Auteur: Bart Witte

## 2026-10-07 — Backupmap van de vorige live-versie (6 okt) + versie v2.2
- Commit: `f09b055` | Auteur: Bart Witte

## 2026-10-06 — Projecttijdlijn en klant-roll-up: gepland, gewerkt en vrije capaciteit per persoon per week
- Commit: `e4b28c5` | Auteur: Bart Witte

## 2026-10-06 — Koppelvoorstellen en inboxfilters: snel de juiste mail bij het juiste project, nooit automatisch
- Commit: `bf9619b` | Auteur: Bart Witte

## 2026-10-06 — Rooktest-punten: contextbalk-knoppen breken niet meer af, geen dubbele projectkop op Overzicht
- Commit: `abd8d69` | Auteur: Bart Witte

## 2026-10-06 — Klant- en locatiepagina: alle projecten, het klantdossier, bestanden en geld op een plek
- Commit: `ffb032c` | Auteur: Bart Witte

## 2026-10-06 — Projectscherm in secties + dossier: alles van een project op een vaste plek, met filters
- Commit: `adfc3fd` | Auteur: Bart Witte

## 2026-10-06 — Projectmap: een mapzoeker (projMap) voor lezen en schrijven, Mappen herstellen met droogloop
- Commit: `44f93b3` | Auteur: Bart Witte

## 2026-10-06 — Immutable mail-id's: koppelingen en chips blijven na verplaatsen, terugval die echt werkt
- Commit: `a90feed` | Auteur: Bart Witte

## 2026-10-06 — Mail koppelen via mt-koppel.js: meerdere projecten per mail, journaal, nette dialogen
- Commit: `f0e5077` | Auteur: Bart Witte

## 2026-10-06 — Router: links naar project en klant, terug/vooruit, kopieer link en projectwisselaar
- Commit: `ac65d8a` | Auteur: Bart Witte

## 2026-10-06 — Samenvoegers projecten, planning en planblokken: niets meer kwijt bij gelijktijdig werken
- Commit: `588d30d` | Auteur: Bart Witte

## 2026-10-06 — Projecten: nieuw project direct open, dubbelklik-slot, contextbalk, nieuwste eerst
- Commit: `9d0761d` | Auteur: Bart Witte

## 2026-10-03 — Codex-review bestellijst verwerkt: kapotte opslag, journaal verplicht, escaping, NCR-race
- Commit: `f7a30cc` | Auteur: Bart Witte

## 2026-10-03 — Bestellijst: nooit meer hard wissen, journaal, eigen samenvoeger, geen stille overschrijving
- Commit: `f83609e` | Auteur: Bart Witte

## 2026-10-03 — To Do-proef: Toggl-taken op jouw naam naar MS To Do (één richting, droogloop eerst)
- Commit: `ab44ba4` | Auteur: Bart Witte

## 2026-10-03 — Codex-review T2 verwerkt: geen stille ontkoppeling, strengere idempotentie
- Commit: `d8bfef2` | Auteur: Bart Witte

## 2026-10-03 — Projecttaken: status-id met terugval als de Toggl-laag ontbreekt
- Commit: `768acbd` | Auteur: Bart Witte

## 2026-10-03 — Toggl 2.0: projecten en taken via één laag, koppelen op id, offertenummer toekennen
- Commit: `c3ad291` | Auteur: Bart Witte

## 2026-10-03 — Bijlagen naar de projectmap: per bijlage een submap-voorstel, bevestigen, index
- Commit: `1ba1c86` | Auteur: Bart Witte

## 2026-10-03 — Projectdossier (alleen lezen): mails, offerte, bijlagen en projectmap in één tijdlijn
- Commit: `febb791` | Auteur: Bart Witte

## 2026-10-03 — Codex-review brok L verwerkt: Opslaan-knop, live calculatie, projectbijlagen
- Commit: `d1161a0` | Auteur: Bart Witte

## 2026-10-03 — Offerte-bestanden: JSON eerst, pas "huidig" na beide, losse kopie blijft
- Commit: `70b58e7` | Auteur: Bart Witte

## 2026-10-03 — Projecttaken: Toggl-fouten niet meer negeren + journaal vóór wijzigen
- Commit: `ef531c7` | Auteur: Bart Witte

## 2026-10-03 — Mail-koppelingen: ontkoppelen is een tombstone + eigen samenvoeger
- Commit: `7f0bf7e` | Auteur: Bart Witte

## 2026-10-03 — Mappen: niet meer automatisch hernoemen, leesfout is geen lege map
- Commit: `e6885f2` | Auteur: Bart Witte

## 2026-10-03 — Bijlagen: nooit meer stil overschrijven bij mail koppelen
- Commit: `c80c1fe` | Auteur: Bart Witte

## 2026-10-03 — Docs: bewezen Toggl 2.0 API-contract (spikes 3 okt)
- Commit: `0a13c52` | Auteur: Bart Witte

## 2026-10-03 — Offertes: niet meer dagelijks alles opnieuw naar de map schrijven
- Commit: `2b7d6ec` | Auteur: Bart Witte

## 2026-10-03 — Offertes: nacalculatie + elke bewerking krijgt een tijdstempel
- Commit: `3e0965b` | Auteur: Bart Witte

## 2026-10-03 — Opdrachtverwerker: volledige mailbody i.p.v. afgekapte preview
- Commit: `643c6e5` | Auteur: Bart Witte

## 2026-10-03 — Mobiel: geen stil verlies meer bij opname, taken, projecten en opleveringen
- Commit: `bc5e226` | Auteur: Bart Witte

## 2026-09-08 — Offertes automatisch als Excel + JSON naar de map
- Commit: `dbee567` | Auteur: Bart Witte

## 2026-09-08 — Offertes: sync werkte niet omdat _SP niet op window staat
- Commit: `d18b6e0` | Auteur: Bart Witte

## 2026-09-08 — Offertes: einde aan stil gegevensverlies in de calculatiemodule
- Commit: `ea8a389` | Auteur: Bart Witte

## 2026-08-12 — Fix: dubbele agenda-DOM-ids, sortbug attentie-lijst, verkoopfacturen bij klanten, dode migratie-knop, [klant] gearchiveerd
- Commit: `f0fbaa0` | Auteur: Bart Witte

## 2026-08-12 — fix(uren): Toggl-fouten blokkeren, timer-race-guard, cache-cleanup bij sync
- Commit: `c8c4c43` | Auteur: Bart Witte

## 2026-08-12 — Sync-betrouwbaarheid: ETag-bescherming uitbreiden, geen lege writes, geschiedenis-archief
- Commit: `11071e6` | Auteur: Bart Witte

## 2026-08-12 — Fix factuurketen: stille fouten, duplicaatcheck en dubbele verwijderfunctie
- Commit: `847a6c6` | Auteur: Bart Witte

## 2026-07-31 — Losse opname: ruimte-tabbladen + verder werken aan geuploade opnames
- Commit: `a1be762` | Auteur: Bart Witte

## 2026-07-31 — Ruimte-tabbladen, tussentijds opslaan + verder werken, autosave bij app-sluiten (opname)
- Commit: `c49aef0` | Auteur: Bart Witte

## 2026-07-31 — Merge fotoherstel-20260731: IndexedDB-fotoherstel mobiel + concepten-overzicht cockpit
- Commit: `37a17eb` | Auteur: Bart Witte

## 2026-07-31 — Fotoherstel: IndexedDB-herstellaag mobiel + concepten-overzicht cockpit (job 20260731-064845)
- Commit: `ee3967d` | Auteur: Bart Witte

## 2026-07-06 — Verbeterpunten-tab in cockpit: spar met Larry + mail belangrijk punt naar Bart
- Commit: `ef7686d` | Auteur: Bart Witte

## 2026-07-04 — Add website-preview (v3+v4) voor interne review door Mathijs
- Commit: `1c032ec` | Auteur: Bart Witte

## 2026-07-03 — S6: cachebuster-bump mt-dialog na centreer-fix
- Commit: `ff7f66a` | Auteur: Bart Witte

## 2026-07-03 — S6: dialog centreren — cockpit-reset platste UA margin:auto
- Commit: `4c0dd14` | Auteur: Bart Witte

## 2026-07-03 — S7: event-delegatie-conventie + mtDialog-laag in ROUTES.md
- Commit: `f690590` | Auteur: Bart Witte

## 2026-07-03 — S6: mail-koppelen-flow + 5 verwijder-confirms via mtDialog
- Commit: `d742d79` | Auteur: Bart Witte

## 2026-07-03 — S6: herbruikbare <dialog>-helper (mtDialog) i.p.v. prompt/confirm
- Commit: `7690fde` | Auteur: Bart Witte

## 2026-07-03 — S3: Smart-inbox-tab afgesplitst naar mt-inbox.js
- Commit: `c1d7b1c` | Auteur: Bart Witte

## 2026-07-03 — S3: Toggl-/uren-tab afgesplitst naar mt-toggl.js
- Commit: `1f6a834` | Auteur: Bart Witte

## 2026-07-02 — S5: snellere login/initStorage — één SP-listing i.p.v. ~17 losse Graph-GETs
- Commit: `397f312` | Auteur: Bart Witte

## 2026-07-02 — S2: gedeelde kernlaag mt-core.js — esc/_encPath/auth/_SP ontdubbeld uit v2 + mobiel
- Commit: `892ae5d` | Auteur: Bart Witte

## 2026-07-02 — S1: ETag-concurrency (If-Match) — proef op mt_planning
- Commit: `597611e` | Auteur: Bart Witte

## 2026-07-02 — Q7: sessie-verlopen-banner i.p.v. stil null bij mislukte token-verversing
- Commit: `f6c4372` | Auteur: Bart Witte

## 2026-07-02 — Q6: ROUTES.md bijgewerkt — root-redirect, vendor/-tabel, faalveilige SP-laag
- Commit: `3ed39b7` | Auteur: Bart Witte

## 2026-07-02 — Q5: één canonieke esc() — 8 verspreide HTML-escapers gededupliceerd
- Commit: `a70a4c5` | Auteur: Bart Witte

## 2026-07-02 — Q4: msal-browser 2.39.0 lokaal gevendord (was jsdelivr @2-tag)
- Commit: `c7e96ee` | Auteur: Bart Witte

## 2026-07-02 — Q3: xlsx/jspdf defer + Google Fonts via <link> met preconnect
- Commit: `a2fa9d2` | Auteur: Bart Witte

## 2026-07-02 — Q2: re-hydrate uit SharePoint wanneer de tab >10 min verborgen was
- Commit: `3d55917` | Auteur: Bart Witte

## 2026-07-02 — Q1: SP-read faalveilig — alleen 404 = leeg, fouten blokkeren migratie en auto-sync
- Commit: `15c3962` | Auteur: Bart Witte

## 2026-07-02 — Opleverlijst Fase 1 + materialen-tab (gestaged werk vorige sessies)
- Commit: `e721a25` | Auteur: Bart Witte

## 2026-06-30 — App-camera: sluiterknop altijd in beeld (flexbox min-height fix)
- Commit: `ec54d14` | Auteur: Bart Witte

## 2026-06-30 — App: maatlijn op punten + album-foto's + foto-editor overal
- Commit: `6006d89` | Auteur: Bart Witte

## 2026-06-30 — App: maatlijn = 1 sleep + lopende losse opnames blijven in de tab
- Commit: `7a807cb` | Auteur: Bart Witte

## 2026-06-30 — App: crash-bestendige losse opname (IndexedDB) — nooit meer foto's kwijt
- Commit: `3a33c76` | Auteur: Bart Witte

## 2026-06-30 — App: camera-wisselknop + auto-achtercamera op tablet
- Commit: `ec6d782` | Auteur: Bart Witte

## 2026-06-30 — App: Voor-opname — losse opname onderweg, later in cockpit splitsen
- Commit: `d6d9c83` | Auteur: Bart Witte

## 2026-06-30 — App: service worker (network-first) — einde cache-gedoe op Android
- Commit: `42c01a4` | Auteur: Bart Witte

## 2026-06-30 — App: camera-review krijgt 3 keuzes (akkoord / verlaten / opnieuw)
- Commit: `c4cdf7d` | Auteur: Bart Witte

## 2026-06-30 — App: één foto per camerasessie — opslaan keert terug naar verslag
- Commit: `555b8e7` | Auteur: Bart Witte

## 2026-06-30 — App: maatlijn met verankerde punten + verschuifbare offset (CAD-stijl)
- Commit: `7467d19` | Auteur: Bart Witte

## 2026-06-30 — App: maatlijn-tool in de foto-bewerker
- Commit: `8abd83f` | Auteur: Bart Witte

## 2026-06-30 — App: WhatsApp-foto-flow + gedeelde foto-bewerker met teken- en tekst-tool
- Commit: `c66d8d6` | Auteur: Bart Witte

## 2026-06-28 — offerte-calc: Van Hoecke vervangt Blum in leverancier-keuze
- Commit: `687c6ca` | Auteur: Bart Witte

## 2026-06-28 — Offerte-calc Fase 1: zelflerende leverancier-prijslaag
- Commit: `8af5a0e` | Auteur: Bart Witte

## 2026-06-28 — Offerte-calc: echte prijslookup, VW-import, mail-paneel, bewerkbare MB-preview + factuur-stap
- Commit: `309c2c4` | Auteur: Bart Witte

## 2026-06-28 — Inbox: knop "Maak offerte" naast "Maak project"
- Commit: `9d4229c` | Auteur: Bart Witte

## 2026-06-28 — Offerte-calc: artikelnr-kolom weg, uitlijning, randafwerking-voorstel + MB-offerte met preview/chat
- Commit: `c3db091` | Auteur: Bart Witte

## 2026-06-28 — feat(offerte-calc): echte materiaal-dropdown (voorraad + catalogus)
- Commit: `96e1ab4` | Auteur: Bart Witte

## 2026-06-28 — fix(offerte-calc): +materiaal/+uur-regel niet opgegeten door re-render
- Commit: `7765da3` | Auteur: Bart Witte

## 2026-06-28 — Voorraad: parser voor rommelige materiaalregels + per-regel factuur/chat
- Commit: `77a1aaf` | Auteur: Bart Witte

## 2026-06-28 — Voorraad: importeer materialen uit inkoopfacturen (aantal 0)
- Commit: `aad952d` | Auteur: Bart Witte

## 2026-06-28 — Offerte-calc rebuild: licht thema, Google-Doc-aanzicht, vrije materiaalregels
- Commit: `0f93a8e` | Auteur: Bart Witte

## 2026-06-28 — Offerte-calculator fase 1: UI in Projecten-tab (voorcalculatie)
- Commit: `aadde6c` | Auteur: Bart Witte

## 2026-06-28 — Offerte-calculator fase 0: reken-engine (coach-sheet → cockpit)
- Commit: `4e98352` | Auteur: Bart Witte

## 2026-06-24 — Worker-overbelasting structureel fixen: heartbeat + polls visibility-gated, error-storm afgevangen
- Commit: `f5de3b5` | Auteur: Bart Witte

## 2026-06-23 — Mobiel→cockpit: volledige mappenstructuur + nieuw-project-melding
- Commit: `beb6d0a` | Auteur: Bart Witte

## 2026-06-23 — Mobiel: fix HTTP 400 bij mappen aanmaken met # in projectnaam
- Commit: `762b0da` | Auteur: Bart Witte

## 2026-06-23 — @ Mobiel: in-app camera (getUserMedia) op Capture + Opname/Oplevering
- Commit: `a4257c0` | Auteur: Bart Witte

## 2026-06-19 — @ Toggl-2.0 skin preview-galerij naast de live tool
- Commit: `3e80d67` | Auteur: Bart Witte

## 2026-06-19 — Vereist-aandacht: reactie-tekstveld per open item
- Commit: `345be11` | Auteur: Bart Witte

## 2026-06-19 — Vereist-aandacht: splits akkoord-actie in twee knoppen
- Commit: `b18e3c1` | Auteur: Bart Witte

## 2026-06-19 — Cockpit: Vereist-aandacht-tab — review-wachtrij gesorteerd op prioriteit
- Commit: `becc4cd` | Auteur: Bart Witte

## 2026-06-19 — Voorraad: Gereedschap/Verbruik-categorieën + beveiligde app-telling
- Commit: `9aaa4b2` | Auteur: Bart Witte

## 2026-06-18 — feat(nacalc): client-side CSV + PDF export per project
- Commit: `ba7e3c6` | Auteur: Bart Witte

## 2026-06-18 — chore(cleanup): veilige losse eindjes opruimen (cockpit + app)
- Commit: `7f4b39e` | Auteur: Bart Witte

## 2026-06-18 — feat(inbox): conversation-threading in smart-inbox (read-only)
- Commit: `7e49729` | Auteur: Bart Witte

## 2026-06-18 — Projecten-koppeling cockpit<->app tolerant maken (geen migratie)
- Commit: `1bac7f2` | Auteur: Bart Witte

## 2026-06-15 — @ fix(toggl): projectnaam = de projectcode; client = de klant
- Commit: `bdf988d` | Auteur: Bart Witte

## 2026-06-15 — @ fix(toggl): projectnaam zonder klant-prefix — klant blijft Toggl-client
- Commit: `59717ea` | Auteur: Bart Witte

## 2026-06-15 — @ Cashflow-dashboard: grafiek bovenaan + filterbare vaste lasten doorgepland
- Commit: `7176791` | Auteur: Bart Witte

## 2026-06-15 — fix(toggl): Focus-taken aanmaken met minimale body {name, project_id}
- Commit: `7bd39b1` | Auteur: Bart Witte

## 2026-06-15 — @ planNaarToggl: toon de échte Focus-foutmelding bij mislukte taken
- Commit: `7f43537` | Auteur: Bart Witte

## 2026-06-15 — @ Planning ⇄ taken: unify, cross-link en "tijdlijn bijwerken"-knop
- Commit: `8a31b19` | Auteur: Bart Witte

## 2026-06-15 — Taken: AI niet auto-naar-Toggl, project-create robuust, Toggl-delete sync, checkbox-multidelete
- Commit: `2372d66` | Auteur: Bart Witte

## 2026-06-15 — Toggl-mirror: project één keer aanmaken (met klant), taken in één keer, AI maakt ook planning
- Commit: `4a6f18d` | Auteur: Bart Witte

## 2026-06-15 — @ Cockpit: taak-uren bewerkbaar (− / + / vrij typen) + plan-sync
- Commit: `11ab941` | Auteur: Bart Witte

## 2026-06-15 — @ Cockpit: taken→planning-brug, tasks-blok bij plan, multi-monitor
- Commit: `e7555b5` | Auteur: Bart Witte

## 2026-06-15 — Fix: AI-voorstel SSE-parse + bijlagen-upload naar projectmap robuust
- Commit: `543bb76` | Auteur: Bart Witte

## 2026-06-15 — inbox: mail↔project zichtbaar + doorklik + bijlagen-automatiek
- Commit: `4a7a395` | Auteur: Bart Witte

## 2026-06-15 — Cockpit wordt dé tool: v4 gearchiveerd, root->v2, Timeline in Uren-tab
- Commit: `218d8fd` | Auteur: Bart Witte

## 2026-06-14 — Usage-logging op taken- en Toggl-symbiose-functies
- Commit: `d130923` | Auteur: Bart Witte

## 2026-06-14 — Uren-tab symbiose: AI-taken met afhankelijkheid + gespiegeld naar Toggl-project
- Commit: `68a3c13` | Auteur: Bart Witte

## 2026-06-14 — Cockpit: cashflow-/liquiditeitsdashboard op Dashboard-tab. Worker: 7 nieuwe /dashboard/* routes (cashflow, vrij-te-besteden, btw-pot, te-factureren, onderhanden, config, anker, doelen), KV-cache 1u, MB-mutations in blokken van max 12d. v2.html: tijdlijn (canvas, geen externe dep), vrij-te-besteden-chip, KPI-strip, pijplijn, instellingen anker+doelen, track()-haakjes op alle acties. seed_vaste_lasten.js: eenmalig seed naar TRACK_KV. Additief - geen bestaande functie aangeraakt. Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
- Commit: `06dabd6` | Auteur: Bart Witte

## 2026-06-14 — Usage-/presence-tracking: Worker-routes + D1/KV + front-end haakjes
- Commit: `b54cb6e` | Auteur: Bart Witte

## 2026-06-12 — Fix: NAS-404 deel 2 — drive-search geeft geen parentReference.path
- Commit: `a0baefb` | Auteur: Bart Witte

## 2026-06-12 — Docs: ROUTES.md ververst — wegen-kaart cockpit + app + Worker + SP-data
- Commit: `b47fcbd` | Auteur: Bart Witte

## 2026-06-12 — App+Worker: alle projecten zichtbaar voor iedereen + filter toegewezen/niet + A-Z
- Commit: `548a5bb` | Auteur: Bart Witte

## 2026-06-12 — App: Oplevering wordt Rapportage — opnamerapport, oplever-foto's, tussentijds concept, NAS-404-fix
- Commit: `1c9e1b2` | Auteur: Bart Witte

## 2026-06-12 — App: notitie wordt afvinkbare taak + bronmap-link, timer-uitval gefixt
- Commit: `75c5094` | Auteur: Bart Witte

## 2026-06-12 — App-icoon: M&T op een regel, M/T wit en & goud (zoals het app-logo)
- Commit: `b130a01` | Auteur: Bart Witte

## 2026-06-12 — App: notities naar SP + bijschrift bij foto's, project-sheet uitgebreid, upload-bevestiging + dedupe
- Commit: `4666634` | Auteur: Bart Witte

## 2026-06-12 — Cockpit: nacalculatie-tabel + maak-factuur-knop in projectvenster
- Commit: `a859feb` | Auteur: Bart Witte

## 2026-06-12 — Mobiel: project aanmaken vanuit oplevertab + oplever-log met ingevuld-door
- Commit: `b45d17c` | Auteur: Bart Witte

## 2026-06-12 — F1: per-user Toggl-tokens (Worker) + echte notificatie-poll + feedback-tab + offline-queue
- Commit: `15fb84c` | Auteur: Bart Witte

## 2026-06-12 — feat(timer): starttijd lopende timer aanpassen + handmatige entry
- Commit: `17cc955` | Auteur: Bart Witte

## 2026-06-12 — fix(timer): lopende Toggl-entry overleeft app-herstart
- Commit: `58bf3b5` | Auteur: Bart Witte

## 2026-06-12 — fix(agenda): RFC3339Z-datums voor Focus stream-endpoints (lege agenda)
- Commit: `b1f011c` | Auteur: Bart Witte

## 2026-06-12 — mobiel: agenda-toolbar compact + pills schakelen mee per view (dag/3dg/week)
- Commit: `448d32f` | Auteur: Bart Witte

## 2026-06-12 — ﻿mobiel: agenda-strip fix — pills passen op schermbreedte, actieve datum centraal
- Commit: `e6d4e86` | Auteur: Bart Witte

## 2026-06-12 — toggl2: Toggl 2.0-kloon slice 1 (Timer/Tasks/Projects/Members) - aparte UI voor Mathijs, Toggl-look, M&T edition-badge
- Commit: `6949135` | Auteur: Bart Witte

## 2026-06-12 — mobiel: agenda echt (Toggl 2.0 logged+planned), pijl-navigatie + datumkiezer, projecten-zoekbalk, taken-fix, NAS-foto-upload met mappenstructuur-popup
- Commit: `63d98fc` | Auteur: Bart Witte

## 2026-06-11 — PWA: manifest + M&T-app-icoon voor mobiel.html (startscherm-snelkoppeling opent fullscreen)
- Commit: `886f0bc` | Auteur: Bart Witte

## 2026-06-11 — mobiel: login-fix block_nested_popups — stale msal-vensternaam wissen + redirect-fallback
- Commit: `e4bdd4f` | Auteur: Bart Witte

## 2026-06-11 — mobiel: F1-slice live — MSAL-login, echte projecten + taken direct naar Toggl 2.0, echte timer
- Commit: `1fc5d15` | Auteur: Bart Witte

## 2026-06-11 — v2: Admin-tab (logboek/team-lock/verlof-saldo/vrije dagen/notificaties) + planning-laag in Agenda + uren-lock
- Commit: `69ba526` | Auteur: Bart Witte

## 2026-06-11 — mobiel: F0.5 dry-test-uitbreidingen (mock/localStorage)
- Commit: `0095c24` | Auteur: Bart Witte

## 2026-06-11 — mobiel: F0-prototype Android-app (mock) — timer+projectkiezer, projecten, agenda, capture, oplevering+aftekenen
- Commit: `ba51abe` | Auteur: Bart Witte

## 2026-06-11 — v2: per-tab help-knop + Larry feedback-chat (read-only guardrails) + gebruiks-log naar SharePoint
- Commit: `6be434e` | Auteur: Bart Witte

## 2026-06-11 — v2: MSAL redirect-URI naar kale map-URL (geregistreerde vorm zonder index.html)
- Commit: `72ac86a` | Auteur: Bart Witte

## 2026-06-11 — v2: volle schermbreedte (container-max weg) + basislettertype Figtree -> Manrope
- Commit: `91cb349` | Auteur: Bart Witte

## 2026-06-11 — v2: MSAL redirect-URI naar geregistreerde index.html-URL (fix AADSTS50011 bij login op v2.html)
- Commit: `0055863` | Auteur: Bart Witte

## 2026-06-11 — v1-header: 'v2 beta' knop naar v2.html (side-by-side test)
- Commit: `23e02a8` | Auteur: Bart Witte

## 2026-06-11 — v2: login-scherm toont 'v2 beta' i.p.v. geerfd 'v4' - onderscheid met v1 voor login
- Commit: `09b78bf` | Auteur: Bart Witte

## 2026-06-10 — Facturatie tool v2 (v2.html): fris/modern restyle, workflow-tabvolgorde, voorraad-interiorcad koppeling - naast v1 voor side-by-side test
- Commit: `b4b3fdf` | Auteur: Bart Witte

## 2026-06-10 — R2: componentenbibliotheek (data-table, toolbar, split-view, chip, mt-row, detail-pane, empty-state, modal-head, status-dot)
- Commit: `72f95b4` | Auteur: Bart Witte

## 2026-06-09 — Zelflerende klant-code-override: eigen KLANT-code blijft per klant onthouden
- Commit: `6409cef` | Auteur: Bart Witte

## 2026-06-09 — @ Inbox "Maak project" vult de project-modal nu voor uit de mail
- Commit: `e5a9a97` | Auteur: Bart Witte

## 2026-06-09 — @ feat: globale klik-feedback op alle knoppen (:active indruk-animatie)
- Commit: `c8830e4` | Auteur: Bart Witte

## 2026-06-09 — @ fix: hernoem inbox-agenda _agenda naar _ibAg (dubbele let-declaratie)
- Commit: `d545788` | Auteur: Bart Witte

## 2026-06-06 — fix(toggl): dropdown-opties witte achtergrond in donkere timerbar
- Commit: `b8330c4` | Auteur: Bart Witte

## 2026-06-05 — Planning→Toggl-brug: maak Toggl-project + Focus-taak per fase
- Commit: `43f8672` | Auteur: Bart Witte

## 2026-06-05 — Projectplanning-engine: schuifbare Gantt-light in Projecten-tab
- Commit: `f545786` | Auteur: Bart Witte

## 2026-06-05 — Inbox Taken-tab: Microsoft To Do live + 1-op-1 Toggl-taak
- Commit: `a3de335` | Auteur: Bart Witte

## 2026-06-05 — Inbox: sub-tabs Mail/Agenda/Taken + werkende Agenda (Outlook-kalender via Graph)
- Commit: `358bacc` | Auteur: Bart Witte

## 2026-06-05 — Inbox: zoeken doorzoekt hele postbus (Outlook-spiegel) + mail-koppelingen syncen over alle PC's
- Commit: `32f531d` | Auteur: Bart Witte

## 2026-06-05 — feat(inbox): koppel-knop toont link-status + ontkoppelen met waarschuwing
- Commit: `ba4abb1` | Auteur: Bart Witte

## 2026-06-05 — fix(sync): SharePoint-I/O via site-id i.p.v. colon-path (HTTP 400 weg)
- Commit: `6737870` | Auteur: Bart Witte

## 2026-06-05 — cleanup: legacy inbox-sorter.ps1 naar _archief (vervangen door email-forward pijplijn)
- Commit: `fb2eaf3` | Auteur: Bart Witte

## 2026-06-05 — security: platte secrets uit HANDOFF.md + SKILL.md halen (redact)
- Commit: `1c2f580` | Auteur: Bart Witte

## 2026-06-05 — Mail koppelen aan project: projectkiezer + gekoppelde-mails in projectview met terug-naar-inbox
- Commit: `88426fe` | Auteur: Bart Witte

## 2026-06-05 — Inbox: zoekregel + oneindig doorscrollen (Graph search + nextLink-paginatie)
- Commit: `bfd583b` | Auteur: Bart Witte

## 2026-06-05 — redesign: groen/goud kleur-drift opruimen (Iris B6)
- Commit: `a299108` | Auteur: Bart Witte

## 2026-06-05 — redesign: tab-nav sticky + modals/status-bars/drop-zone op tokens
- Commit: `c13a975` | Auteur: Bart Witte

## 2026-06-05 — redesign: token-ladder + globale dropdown-fix, knoppen, kaarten, tabellen
- Commit: `d476eba` | Auteur: Bart Witte

## 2026-06-05 — Inbox: leesvenster toont mail-body weer (iframe-hoogte fix)
- Commit: `bd6ac02` | Auteur: Bart Witte

## 2026-06-05 — Agenda: los persoon-id naar naam op via Track /users (uid-veld)
- Commit: `f6518c8` | Auteur: Bart Witte

## 2026-06-05 — Agenda-filter dropdown: breed genoeg voor volledige namen
- Commit: `b784389` | Auteur: Bart Witte

## 2026-06-05 — Toggl-tab: board-kaarten tonen prioriteit+assignee; Beheer client/tag verwijderen
- Commit: `dc0b6c2` | Auteur: Bart Witte

## 2026-06-05 — Toggl-tab Taken: prioriteit, assignee, subtaak, hernoemen, verwijderen
- Commit: `eae0acd` | Auteur: Bart Witte

## 2026-06-05 — Toggl-tab Beheer: clients en tags hernoemen (Track PUT)
- Commit: `b606630` | Auteur: Bart Witte

## 2026-06-05 — Toggl-tab Projecten: project bewerken (naam+kleur) en archiveren
- Commit: `0f16b1e` | Auteur: Bart Witte

## 2026-06-05 — Toggl-tab Timer: entry bewerken/verwijderen + handmatige entry toevoegen
- Commit: `5835aba` | Auteur: Bart Witte

## 2026-06-05 — Agenda: timer-lijst-view (zoals Toggl) naast week-rooster — grid/lijst-toggle
- Commit: `f6f9591` | Auteur: Bart Witte

## 2026-06-05 — Toggl-tab: volledig tabblad — Timer/Projecten/Taken/Board/Reports/Clients+Tags
- Commit: `06137e6` | Auteur: Bart Witte

## 2026-06-05 — Agenda: all-time projecttotalen + bladerpijlen die oplichten + 365d-window + Reports-paginatie
- Commit: `0bdad77` | Auteur: Bart Witte

## 2026-06-05 — UX-batch: inbox-layout (groter leesvenster, 1 chat-input auto-grow, actie-knoppen), topbalk wit zoekveld, agenda-dropdown zoekbalk+uitlijning+hover
- Commit: `f6a87ad` | Auteur: Bart Witte

## 2026-06-04 — Topbalk: centrale uitklapbare Larry-chat (vragen + acties uitvoeren in de tool)
- Commit: `71c3fad` | Auteur: Bart Witte

## 2026-06-04 — Smart-inbox Fase A: live 2-weg info@-inbox tab (folders/lijst/reader/move+undo/Larry-chat)
- Commit: `4e746a7` | Auteur: Bart Witte

## 2026-06-04 — agenda: filters als multi-select dropdowns (project + persoon) + namen i.p.v. ID-stubs
- Commit: `353f672` | Auteur: Bart Witte

## 2026-06-04 — Agenda zelfvoorzienend: namen-fallback ipv entries droppen
- Commit: `61b0e02` | Auteur: Bart Witte

## 2026-06-04 — wrangler.toml: minimale config voor mt-claude-proxy deploy
- Commit: `2d7847b` | Auteur: Bart Witte

## 2026-06-04 — Toggl Focus Fase 3: 1-op-1 aansturing vanuit agenda-tab (NIET gepusht)
- Commit: `910248d` | Auteur: Bart Witte

## 2026-06-04 — Toggl agenda Fase 2 + secret-guard: toggl_sk_
- Commit: `9b72564` | Auteur: Bart Witte

## 2026-06-04 — Agenda-tab: Toggl week-kalender (tijdblokken) in index.html
- Commit: `abd5e0f` | Auteur: Bart Witte

## 2026-06-04 — Archiveer oude tool (index-v4/v3, migratie, voorraad-FastAPI) -> index.html is canoniek
- Commit: `2d161bf` | Auteur: Bart Witte

## 2026-06-02 — @ Bijlagen per project: opslaan in projectmap op SharePoint, tool linkt alleen
- Commit: `1e09848` | Auteur: Bart Witte

## 2026-06-02 — @ Fix [klant]-bug + SharePoint-canonieke klantregistry
- Commit: `b3b519f` | Auteur: Bart Witte

## 2026-06-02 — #20: Excel-upload (.xlsx/.xls) naast CSV bij VW-kostenimport
- Commit: `56d064a` | Auteur: Bart Witte

## 2026-06-02 — Tooling: VW-Excel vendor (SheetJS), nieuw-project skill, inbox/VW-sorter scripts + config-template
- Commit: `e07c13b` | Auteur: Bart Witte

## 2026-06-02 — Security: geharde .gitignore + pre-commit secret-guard + REPO-VEILIGHEID overzicht
- Commit: `5e4e673` | Auteur: Bart Witte

## 2026-06-02 — @ #21: auto-mappenstructuur + echte klantnamen bij project-aanmaak
- Commit: `d46b2bf` | Auteur: Bart Witte

## 2026-06-01 — Fase B: auto-match Moneybird-contact op project-detail
- Commit: `2a8e6ee` | Auteur: Bart Witte

## 2026-06-01 — Fase B increment 2: projecttijdlijn uit echte data
- Commit: `aaa0407` | Auteur: Bart Witte

## 2026-06-01 — Test-projecten opgeruimd: lege start voor echte KLANT-LOC-PROD-projecten
- Commit: `58feb63` | Auteur: Bart Witte

## 2026-06-01 — Repo-hygiene: negeer .claude/worktrees + .wrangler cache
- Commit: `7699109` | Auteur: Bart Witte

## 2026-06-01 — Fase B increment 1: project-detail bidirectionele links
- Commit: `22fbae0` | Auteur: Bart Witte

## 2026-06-01 — Klant-registry: [klant] + [klant] toegevoegd
- Commit: `9e3997b` | Auteur: Bart Witte

## 2026-06-01 — Fase A fix: klant-registry tegen Moneybird gecorrigeerd
- Commit: `d439614` | Auteur: Bart Witte

## 2026-06-01 — Fase A: projectcode-generator KLANT-LOC-PROD
- Commit: `c2f8647` | Auteur: Bart Witte

## 2026-06-01 — feat: nieuwe versie op root index.html — gebruikt zelfde MSAL redirect als oude tool
- Commit: `428b93f` | Auteur: Bart Witte

## 2026-06-01 — feat(voorraad): kopie van index-v4 naar voorraad/ als basis voor online tool
- Commit: `596f3d9` | Auteur: Bart Witte

## 2026-05-17 — feat(agents): QR + CLI + video-analyse tools, digest-mail weer aan
- Commit: `f6a20f7` | Auteur: Bart Witte

## 2026-05-17 — review(agents): dagelijkse Claude-review 2026-05-17
- Commit: `a32abfd` | Auteur: Bart Witte

## 2026-05-16 — fix(agents): e-mailvragen door Opus laten beantwoorden ipv lokale Ollama
- Commit: `7ee5408` | Auteur: Bart Witte

## 2026-05-16 — feat(agents): fase 1b - bronnen echt lezen en nabouwen
- Commit: `2ae6a47` | Auteur: Bart Witte

## 2026-05-16 — feat(agents): duiding per digest-item
- Commit: `35bfb3b` | Auteur: Bart Witte

## 2026-05-16 — fix(agents): ASCII-only ps1, GPU-context, fase5 zonder dubbele blokken
- Commit: `1910019` | Auteur: Bart Witte

## 2026-05-16 — feat(agents): Brave Search + één dagstatusmail om ~05:30
- Commit: `263033e` | Auteur: Bart Witte

## 2026-05-16 — chore(agents): dode bestanden weg + Claude-review op Opus 4.7
- Commit: `f3d285a` | Auteur: Bart Witte

## 2026-05-16 — feat(agents): MT Autonomy — zelfsturend agent-systeem
- Commit: `d20ae03` | Auteur: Bart Witte

## 2026-05-13 — docs: HANDOFF.md bijgewerkt — uren.html commit gemaakt, merge conflict rapportage
- Commit: `1af9fd5` | Auteur: Bart Witte

## 2026-05-13 — feat(uren): 6 Toggl-features — factuurstatus, mijn taken, deadline urgentie, daggrafiek, uren in projectlijst, recente entries
- Commit: `0fbc4a6` | Auteur: Bart Witte

## 2026-05-11 — feat: Toggl Focus endpoint + X-Claude-Key server auth
- Commit: `8c487f8` | Auteur: Bart Witte

## 2026-05-11 — docs: CHANGELOG.md toegevoegd + pre-commit hook voor auto-backup grote bestanden
- Commit: `20c3fef` | Auteur: Bart Witte

## 2026-05-08 — structuur: kennisbestanden naar Claude-context/, CLAUDE.md afgeslankt
- Commit: `413ba4e` | Auteur: MTBart

## 2026-05-06 — docs: sessie 2026-05-06 gedocumenteerd — API fixes, worker.js, [klant] pad
- Commit: `a3744bd` | Auteur: MTBart

## 2026-05-06 — docs: STATUS.md bijgewerkt na fix sessie 2026-05-06
- Commit: `42f3d2a` | Auteur: MTBart

## 2026-05-06 — Fix: MSAL v2 CDN, betere null-check in msLogin
- Commit: `75dc225` | Auteur: MTBart

## 2026-05-06 — Fix: correcte MSAL CDN URL (jsdelivr ipv alcdn)
- Commit: `d96840c` | Auteur: MTBart

## 2026-05-06 — Fix: MSAL library script tag teruggezet
- Commit: `df0ffe2` | Auteur: MTBart

## 2026-05-06 — Fix: MSAL login re-enabled, API calls na login, worker.js toegevoegd aan repo
- Commit: `01bcc57` | Auteur: MTBart

## 2026-05-06 — Fix: mbGet via Worker ipv localhost, dashboard en api-status re-enabled, migratie tab verborgen online
- Commit: `cf67aa0` | Auteur: MTBart

## 2026-04-30 — docs: sessie-samenvatting 2026-04-30 — nachtplan + stap 10 klaar, stap 11 next
- Commit: `973fa70` | Auteur: Bart Witte

## 2026-04-28 — feat(uren): stap 1 — data model migratie
- Commit: `d210da1` | Auteur: Bart Witte

## 2026-04-28 — uren: volledige breedte + compactere padding standaard
- Commit: `c177dd7` | Auteur: Bart Witte

## 2026-04-28 — uren.html: projectstatus, taken met estimate+toewijzing, werkdruk, beeldvullend alle tabs, project detail modal
- Commit: `105be4b` | Auteur: Bart Witte

## 2026-04-28 — Vaste timerbalk, projecten tab, inline aanmaken project/taak
- Commit: `25660ae` | Auteur: Bart Witte

## 2026-04-28 — Update STATUS.md na uren-app sessie
- Commit: `ea9a8db` | Auteur: Bart Witte

## 2026-04-28 — Herbouw uren app — taken/subtaken, verbeterde timeline, bord klikbaar
- Commit: `c1a9c8f` | Auteur: Bart Witte

## 2026-04-28 — Voeg Bord-tab toe aan uren app — timeline muurscherm
- Commit: `f953de8` | Auteur: Bart Witte

## 2026-04-28 — Voeg M&T Uren app toe — standalone tijdsregistratie zonder Toggl
- Commit: `bb196d1` | Auteur: Bart Witte

## 2026-04-27 — Fix: enable contact cache (24h) + fix project count UI update
- Commit: `cab0485` | Auteur: Bart Witte

## 2026-04-27 — Implement full migration workflow: folder indexing + copying with smart mapping
- Commit: `570c302` | Auteur: Bart Witte

## 2026-04-27 — Migration tool v2: complete workflow with folder picker, smart mapping, all 625 klanten
- Commit: `881ecc0` | Auteur: Bart Witte

## 2026-04-27 — WIP: migration tool refactor - cache contacts locally
- Commit: `1935e5d` | Auteur: Bart Witte

## 2026-04-26 — Use project path as stable ID instead of timestamp
- Commit: `ee53baa` | Auteur: Bart Witte

## 2026-04-26 — Fix scan-project endpoint: auto-scan if needed
- Commit: `d35b201` | Auteur: Bart Witte

## 2026-04-26 — Implement smart folder copying with mapping
- Commit: `1b08666` | Auteur: Bart Witte

## 2026-04-26 — Add visual mapping UI for folder structure
- Commit: `3c93234` | Auteur: Bart Witte

## 2026-04-26 — Add smart-scan endpoint for folder mapping
- Commit: `b4dcb51` | Auteur: Bart Witte

## 2026-04-26 — Improve document selection UI
- Commit: `9885bfb` | Auteur: Bart Witte

## 2026-04-26 — Use 'reference' field for estimate/invoice numbers
- Commit: `3441f04` | Auteur: Bart Witte

## 2026-04-26 — Log full Moneybird object structure
- Commit: `1b83268` | Auteur: Bart Witte

## 2026-04-26 — Log Moneybird field names to diagnose undefined issue
- Commit: `c388902` | Auteur: Bart Witte

## 2026-04-26 — Add debug logging for Moneybird data
- Commit: `a732d51` | Auteur: Bart Witte

## 2026-04-26 — Fix migration tab rendering
- Commit: `89b650b` | Auteur: Bart Witte

## 2026-04-26 — Disable dashboard/API status for migration test
- Commit: `d26cb0d` | Auteur: Bart Witte

## 2026-04-26 — Fix mbGet() query parameter handling
- Commit: `95dcfc7` | Auteur: Bart Witte

## 2026-04-26 — Fix query parameter handling in Moneybird proxy
- Commit: `2d7510a` | Auteur: Bart Witte

## 2026-04-26 — Update mbGet to use Node proxy instead of Cloudflare
- Commit: `56b309e` | Auteur: Bart Witte

## 2026-04-26 — Fix CORS: proxy Moneybird API through Node server
- Commit: `d7c426a` | Auteur: Bart Witte

## 2026-04-26 — Disable Azure AD (MSAL) for testing - auto-show app
- Commit: `f9b97ce` | Auteur: Bart Witte

## 2026-04-26 — Add start-server.bat for easy server launch
- Commit: `ff0fa13` | Auteur: Bart Witte

## 2026-04-26 — Serve index-v4.html from migration server
- Commit: `61f5218` | Auteur: Bart Witte

## 2026-04-26 — Add test mode: limit=5 projects + token from config.json
- Commit: `67703dc` | Auteur: Bart Witte

## 2026-04-26 — Add Node.js backend + update migration-tool for file copy
- Commit: `6b06b4c` | Auteur: Bart Witte

## 2026-04-26 — Add migration tool: Tab 10 in index-v4.html
- Commit: `27d999a` | Auteur: Bart Witte

## 2026-04-25 — Add 09_Werktekeningen folder + migration analysis
- Commit: `90e2e55` | Auteur: Bart Witte

## 2026-04-25 — Fix: Use customer_id instead of internal contact ID
- Commit: `8da87ff` | Auteur: Bart Witte

## 2026-04-25 — Fix: Use placeholder project name instead of interactive input
- Commit: `484fde9` | Auteur: Bart Witte

## 2026-04-25 — Feat: PowerShell script with Moneybird API integration
- Commit: `ce82a3e` | Auteur: Bart Witte

## 2026-04-25 — Fix: PowerShell script character encoding for folder creation
- Commit: `dd3891a` | Auteur: Bart Witte

## 2026-04-24 — Factuurlijst: 📦 icoon voor voorraadleveranciers
- Commit: `59bc079` | Auteur: Bart Witte

## 2026-04-24 — STATUS.md bijgewerkt met volledige roadmap
- Commit: `1517005` | Auteur: Bart Witte

## 2026-04-24 — Auto-import STATUS.md, permissions ingesteld
- Commit: `a92ca99` | Auteur: Bart Witte

## 2026-04-24 — Memory-bestanden aangemaakt, MCP filesystem config klaar
- Commit: `ab7bd82` | Auteur: Bart Witte

## 2026-04-24 — Mapstructuur opgeruimd, CLAUDE.md aangescherpt, STATUS.md aangemaakt
- Commit: `e7c7d19` | Auteur: Bart Witte

## 2026-04-23 — [klant]: log eerste factuur raw JSON voor debug
- Commit: `7fef897` | Auteur: Bart Witte

## 2026-04-23 — [klant]: vertraging toevoegen om rate limiting te voorkomen
- Commit: `9e5a3d0` | Auteur: Bart Witte

## 2026-04-23 — [klant]: more explicit console logging START/END
- Commit: `b522bff` | Auteur: Bart Witte

## 2026-04-23 — [klant]: verbose debug logging voor invoice structuur
- Commit: `635567f` | Auteur: Bart Witte

## 2026-04-23 — [klant]: wacht op auth token, auto-laad klanten indien nodig
- Commit: `df55230` | Auteur: Bart Witte

## 2026-04-23 — [klant]: debug log eerste factuur JSON structuur
- Commit: `c8866df` | Auteur: Bart Witte

## 2026-04-23 — [klant]: parallel fetchen in batches van 10 voor snelheid
- Commit: `691865d` | Auteur: Bart Witte

## 2026-04-23 — [klant]: individuele factuur details ophalen voor regelinfo
- Commit: `1f937c4` | Auteur: Bart Witte

## 2026-04-23 — [klant]: scan reference+notes+details ipv alleen details
- Commit: `f08d2ec` | Auteur: Bart Witte

## 2026-04-23 — [klant]: pantry detectie, deduplicatie op projectreferentie, referentie kolom
- Commit: `ea4af10` | Auteur: Bart Witte

## 2026-04-23 — [klant]: contacten client-side filteren ipv server query
- Commit: `5ca6709` | Auteur: Bart Witte

## 2026-04-23 — [klant]: zoekterm fix naar 'compan', tab hernoemd
- Commit: `7b1c60b` | Auteur: Bart Witte

## 2026-04-23 — CN Analyse: zoekterm vrij invulbaar ipv hardcoded
- Commit: `8436fbc` | Auteur: Bart Witte

## 2026-04-23 — Voeg CN Analyse tab toe — keukens & commodes per vestiging via Moneybird
- Commit: `351cc5b` | Auteur: Bart Witte

## 2026-04-23 — Mail: alleen Facturen map scannen, verplaatsen naar Verwerkt, verwijderknop in controle
- Commit: `172254f` | Auteur: Bart Witte

## 2026-04-23 — Fix: wissen werkt, e-mail rijen aanklikbaar (bekijken vs analyseren)
- Commit: `f3fee7c` | Auteur: Bart Witte

## 2026-04-23 — Factuur validatie: eenheidsprijs correct + totalen als leidend controlemiddel
- Commit: `6574c8b` | Auteur: Bart Witte

## 2026-04-23 — PDF viewer in tool + opslag op SharePoint/NAS
- Commit: `9664c42` | Auteur: Bart Witte

## 2026-04-23 — Fix: Graph mail query gesplitst, bijlagen apart ophalen
- Commit: `00994da` | Auteur: Bart Witte

## 2026-04-23 — Fix: Graph token met mail/calendar scopes + popup consent fallback
- Commit: `43adaf0` | Auteur: Bart Witte

## 2026-04-23 — E-mail factuur scan: auto-detectie PDF bijlagen uit inbox
- Commit: `e0fcb71` | Auteur: Bart Witte

## 2026-04-23 — SharePoint opslag + Moneybird caching (klanten 24u, facturen 15min)
- Commit: `b206c8b` | Auteur: Bart Witte

## 2026-04-23 — Beveiliging: MS-token validatie op alle Worker-aanroepen
- Commit: `6ad4c5d` | Auteur: Bart Witte

## 2026-04-23 — Fix: tenant-specifiek MSAL eindpunt
- Commit: `c17f5f3` | Auteur: Bart Witte

## 2026-04-23 — Fix: stale MSAL vlag wissen + fallback na loginPopup
- Commit: `249fc79` | Auteur: Bart Witte

## 2026-04-23 — Fix: loginPopup ipv loginRedirect, geen interaction_in_progress meer
- Commit: `74b4fb4` | Auteur: Bart Witte

## 2026-04-23 — Fix: loginscherm altijd zichtbaar, betere CDN, foutafhandeling MSAL
- Commit: `5fb5762` | Auteur: Bart Witte

## 2026-04-23 — Fix: MSAL als gewone functies ipv async IIFE
- Commit: `600a796` | Auteur: Bart Witte

## 2026-04-23 — Fix: MSAL in apart script-blok zodat TDZ fout verdwijnt
- Commit: `56ccb99` | Auteur: Bart Witte

## 2026-04-23 — Veilige API tokens via Cloudflare + MS365 login
- Commit: `a06adad` | Auteur: Bart Witte

## 2026-04-23 — Merge met GitHub-versie
- Commit: `31d1181` | Auteur: Bart Witte

## 2026-04-23 — NAS koppeling — lokale bestanden toevoegen aan git
- Commit: `bb0ac29` | Auteur: Bart Witte

## 2026-04-21 — Add files via upload
- Commit: `fd82b55` | Auteur: MTBart

## 2026-04-21 — Delete index-v4.html
- Commit: `70a93c1` | Auteur: MTBart

## 2026-04-21 — Add files via upload
- Commit: `3e2ca95` | Auteur: MTBart

## 2026-04-21 — Delete index-v4.html
- Commit: `735b7b1` | Auteur: MTBart

## 2026-04-21 — Add files via upload
- Commit: `87f05a9` | Auteur: MTBart

## 2026-04-21 — Delete index-v4.html
- Commit: `944a5ae` | Auteur: MTBart

## 2026-04-21 — Add files via upload
- Commit: `372bf1f` | Auteur: MTBart

## 2026-04-21 — Add files via upload
- Commit: `c8f7c42` | Auteur: MTBart

## 2026-04-21 — Delete index-v4.html
- Commit: `703ebeb` | Auteur: MTBart

## 2026-04-21 — Add files via upload
- Commit: `4532fa4` | Auteur: MTBart

## 2026-04-21 — Delete index-v4.html
- Commit: `aef6873` | Auteur: MTBart

## 2026-04-21 — Add files via upload
- Commit: `03ac78a` | Auteur: MTBart

## 2026-04-21 — Delete index-v4.html
- Commit: `9640b30` | Auteur: MTBart

## 2026-04-20 — Add files via upload
- Commit: `85700cb` | Auteur: MTBart

## 2026-04-20 — Delete index-v4.html
- Commit: `22589a6` | Auteur: MTBart

## 2026-04-20 — Add files via upload
- Commit: `1166317` | Auteur: MTBart

## 2026-04-20 — Delete index-v4.html
- Commit: `8777630` | Auteur: MTBart

## 2026-04-20 — Add files via upload
- Commit: `bf16edc` | Auteur: MTBart

## 2026-04-20 — Delete index-v4.html
- Commit: `549d346` | Auteur: MTBart

## 2026-04-20 — Add files via upload
- Commit: `d049359` | Auteur: MTBart

## 2026-04-20 — Delete index.html
- Commit: `84dcf5b` | Auteur: MTBart

## 2026-04-19 — Add files via upload
- Commit: `8e11024` | Auteur: MTBart

## 2026-04-19 — Delete index-v3.html
- Commit: `93d803e` | Auteur: MTBart

## 2026-04-19 — Add files via upload
- Commit: `b06983d` | Auteur: MTBart

## 2026-04-19 — Add files via upload
- Commit: `5f860f7` | Auteur: MTBart

## 2026-04-19 — Delete index.html
- Commit: `9ad0e16` | Auteur: MTBart

## 2026-04-19 — Add files via upload
- Commit: `dc5acef` | Auteur: MTBart

## 2026-04-19 — Delete index.html
- Commit: `af7ede1` | Auteur: MTBart

## 2026-04-19 — Add files via upload
- Commit: `7b7a479` | Auteur: MTBart

## 2026-04-19 — Delete index.html
- Commit: `bae2935` | Auteur: MTBart

## 2026-04-19 — Add files via upload
- Commit: `23ddf51` | Auteur: MTBart

## 2026-04-19 — Delete index.html
- Commit: `ea05bb1` | Auteur: MTBart

## 2026-04-19 — Add files via upload
- Commit: `e12c175` | Auteur: MTBart

## 2026-04-19 — Delete index.html
- Commit: `a03ee01` | Auteur: MTBart

## 2026-04-19 — Add files via upload
- Commit: `a24199d` | Auteur: MTBart

## 2026-04-19 — Delete index.html
- Commit: `79713e5` | Auteur: MTBart

## 2026-04-19 — Add files via upload
- Commit: `1e20fea` | Auteur: MTBart

## 2026-04-19 — Delete index.html
- Commit: `18fcd81` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `fcc6dae` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `b6fd57b` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `5a809c3` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `24b4a5d` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `e5249b8` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `f7c4931` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `f2a065c` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `95d811c` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `c040094` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `0dff777` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `69546b1` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `64746d1` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `f2f59cd` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `c893ea8` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `2cdeef6` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `471ad1f` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `7ddef1e` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `0c86015` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `3e3fb9b` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `872d30c` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `92747f3` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `9bfe954` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `9091627` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `42befb7` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `f8c7a88` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `6e5675a` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `c11692c` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `bb6ee14` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `d640005` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `7d3cc5f` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `211785b` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `ca3fe6d` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `1c082f8` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `e55a148` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `8f0c95f` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `8ffa733` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `295a124` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `a063f2e` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `e62cd22` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `1ffe990` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `7d58921` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `d482dda` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `ee1797c` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `4482d8c` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `699bb20` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `88bc460` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `79b7d3d` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `0932ed0` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `bbe0e60` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `bd41756` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `d7e02ad` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `a06aca5` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `cc60d00` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `7bad62d` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `49b1df2` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `cb3cf2a` | Auteur: MTBart

## 2026-04-18 — Add files via upload
- Commit: `ec79ae7` | Auteur: MTBart

## 2026-04-18 — Delete index.html
- Commit: `64b7c70` | Auteur: MTBart

## 2026-04-18 — Rename MT-Factuur-Tool.html to index.html
- Commit: `e31af07` | Auteur: MTBart

## 2026-04-17 — Rename MT-Factuur-Tool (2).html to MT-Factuur-Tool.html
- Commit: `bb3ed82` | Auteur: MTBart

## 2026-04-17 — Add files via upload
- Commit: `0314a5f` | Auteur: MTBart

## 2026-04-17 — Delete MT-Factuur-Tool.html
- Commit: `5155bb9` | Auteur: MTBart

## 2026-04-17 — Add files via upload
- Commit: `e024d13` | Auteur: MTBart

## 2026-04-17 — Initial commit
- Commit: `e4dfe8d` | Auteur: MTBart
