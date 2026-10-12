# githooks: privacy- en secret-controle (publieke repo)

Activeren (eenmalig per clone of worktree; een worktree deelt `.git/config` met de hoofdclone, dan is het al gedaan):

    git config core.hooksPath githooks

Werkt in Git Bash op Windows. Vereist `node` (zonder node blokkeren de hooks: fail closed).

## Wat draait wanneer

| Hook | Scant | Script |
|---|---|---|
| `pre-commit` | toegevoegde regels en bestandsnamen in de index, daarna de sink-guard en de CHANGELOG-stap | `privacy-scan.js --staged` |
| `commit-msg` | het commitbericht (regels die met `#` beginnen tellen niet mee) | `privacy-scan.js --bericht` |
| `pre-push` | alle nieuwe commits van de push (diff, bestandsnamen, berichten); vangnet voor `--no-verify` | `privacy-scan.js --pre-push` |

Handmatig: `node githooks/privacy-scan.js --tree HEAD` (hele boom), `--range a..b`, `--uitzonderingen`.

## Wat wordt geblokkeerd

IBAN (NL en andere landen, met of zonder spaties, met modulo-97-controle), 32- en 64-hex bij het woord token/key/secret/sleutel (SRI-hashes uitgezonderd), `Bearer <token>`, Anthropic/Toggl/GitHub/AWS/Slack-sleutels, Cloudflare-tokens, Azure-client-secrets, `client_secret`- en wachtwoordtoewijzingen, JWT, PEM-blokken (de BEGIN-regel), e-mailadressen buiten `@mortiseandtenon.nl`, NL-telefoonnummers, BSN-achtige reeksen (11-proef), verboden paden (o.a. `_backup/`, `.claude/memory/`, `toggl-preview/`, `*.bak`, databases) en elke naam uit de lokale namenlijst, ook in bestandsnamen en commitberichten.
Toegestaan: `@mortiseandtenon.nl`, `noreply@anthropic.com`, GitHub-noreply en `example.com/org/net/nl`. De lijst staat bovenaan `privacy-scan.js` (`MAIL_DOMEIN_OK`, `MAIL_ADRES_OK`). Voor `vendor/`, `backup/` en `node_modules/` gelden de regels voor e-mail, telefoon en BSN niet.
De uitvoer noemt type en plek (`bestand:regel`), nooit de gevonden waarde of naam.

## Lokale namenlijst (klanten)

De lijst staat NIET in de repo. Standaard: `.git/info/verboden-namen.txt` (gedeeld door alle worktrees van de clone). Ander pad: `git config mt.verbodenNamenPad <pad>` of de omgevingsvariabele `MT_VERBODEN_NAMEN`.
Vullen uit een bron die de regie aanwijst (alleen lezen, nooit kopieren; de uitvoer toont alleen aantallen):

    node githooks/vul-verboden-namen.js --bron <klanten.json> --bron <termen.txt> [--toevoegen] [--min 5]

JSON-bron: `{klanten:[{naam, aliassen[], locaties[{naam}]}]}`; tekstbron: een term per regel. Termen korter dan `--min` (standaard 5) worden overgeslagen, zodat klantcodes niet blokkeren.
Ontbreekt de lijst, dan waarschuwen de hooks luid maar blokkeren niet. Wil je fail closed: `git config mt.privacyNamenVerplicht true`.

## Uitzonderingen

Alleen per regel, met een reden, in een commentaar op die regel:

    // privacy-ok: <reden>        <!-- privacy-ok: <reden> -->        # privacy-ok: <reden>

Een markering zonder reden blokkeert zelf. Overzicht van alle uitzonderingen in de gevolgde bestanden: `node githooks/privacy-scan.js --uitzonderingen`. Gemarkeerde regels worden bij elke scan ook gemeld.

## Tests

    node githooks/test-privacy.js            # positieve en negatieve gevallen, tijdelijke repo voor commit-msg en pre-push, en de HEAD-controle
    node githooks/test-privacy.js --geen-head

Alle testwaarden zijn fictief en uit stukken opgebouwd (documentatie-IBAN's, nep-tokens).

## Overslaan

`git commit --no-verify` bestaat, maar de pre-push vangt het alsnog. De bestaande `MT_CHANGELOG_OVERSLAAN=1` en `MT_SINKS_OVERSLAAN=1` blijven gelden voor hun eigen stap en slaan de privacy-scan niet over.
