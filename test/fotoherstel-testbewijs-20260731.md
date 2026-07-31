# Testbewijs — fotoherstel (job 20260731-064845)

- **Datum:** 2026-07-31
- **Harness:** `test/fotoherstel-test.html` (zelf-draaiend, testdata only — geen SharePoint/login/echte foto's)
- **Uitvoering:** headless Chrome via CDP (`--headless=new`), pagina geserveerd via lokale `http.server` op 127.0.0.1:8123
- **Resultaat:** `RESULTAAT: 17 geslaagd, 0 mislukt` — document.title `PASS — Fotoherstel-test`

## Console-output (letterlijk)

```
PASS: MTFotoStore geladen
PASS: S1: foto-record hersteld uit IndexedDB
PASS: S1: blob-inhoud intact na herstel
PASS: S1: blob → File herbouwd (naam+type)
PASS: S1: metadata compleet (hoofdstuk/opmerking/soort)
PASS: S2: status → fout na mislukte upload
PASS: S2: retry-bestandsnaam identiek (idempotent, PUT overschrijft)
PASS: S2: blob blijft bewaard na uploadfout
PASS: S2: status → sync na geslaagde retry
PASS: S2: geen duplicaat-records ontstaan
PASS: S3: cleanup verwijdert alleen sync-foto
PASS: S3: fout-foto blijft bewaard (foutveilig)
PASS: S3: draft blijft zolang er lokale foto's zijn
PASS: S3: na laatste sync-foto ook draft weg
PASS: S4: twee gelijknamige projecten = twee losse drafts
PASS: S4: herstel matcht op exacte code, niet op naam
PASS: S5: putFoto zonder blob wordt geweigerd (foto telt niet als opgeslagen)
RESULTAAT: 17 geslaagd, 0 mislukt
```

## Dekking t.o.v. acceptatie-eisen

| Eis | Scenario |
|---|---|
| Offline foto bevestigen → reload → herstellen | S1 |
| Uploadfout → retry zonder duplicaat | S2 |
| Originelen nooit impliciet weg; alleen sync ná afronding | S3 + S5 |
| Bajeskwartier-duplicaten (TG-219730795 vs TG-219870094) blijven apart | S4 |
| App-achtergrond → herstellen | zelfde IndexedDB-pad als S1; autosave op `visibilitychange`/`pagehide` zit in mobiel.html-glue (handmatig na te spelen op toestel) |
