-- migrations/0002_kijklog.sql
-- Kijklog van de rol "meekijker" (externe coach): wat heeft die persoon opgevraagd, wanneer.
-- Server-side vastgelegd door de Worker (niet door de client te vervalsen). NOOIT in de publieke repo gedumpt.
-- Data-minimalisme: geen bodies, geen queryparameters, geen antwoorden, geen bedragen of namen.
-- Alleen verzoeken van een meekijker worden gelogd; voor het eigen team wordt hier niets in gezet.
-- Bewaartermijn 180 dagen: de Worker ruimt dagelijks op (cron) en af en toe bij schrijven.
--
-- Toepassen (Bart, VOOR het deployen van de Worker met kijklog; zonder deze tabel slaat de Worker de logregel stil over):
--   wrangler d1 execute mt-tracking --file=migrations/0002_kijklog.sql --remote
-- Controle:
--   wrangler d1 execute mt-tracking --command "SELECT COUNT(*) FROM kijklog" --remote
--
-- Idempotent: alles is IF NOT EXISTS, dus opnieuw draaien is veilig. Gebruikt dezelfde D1-database als migrations/0001_events.sql (binding TRACK_DB).

CREATE TABLE IF NOT EXISTS kijklog (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,   -- epoch ms, server-tijd
  oid     TEXT    NOT NULL,   -- Entra-object-id van de meekijker (geen e-mail)
  user    TEXT,               -- adres uit het token (koppelt aan events.user voor tab/project-gebeurtenissen)
  methode TEXT,               -- GET/POST/...
  route   TEXT,               -- alleen het pad, bv. /geld/tijdlijn of / (proxy)
  target  TEXT,               -- ?target= bij de proxy (toggl_focus, moneybird, ...)
  actie   TEXT,               -- resourcetype zonder ids, bv. "GET moneybird:sales_invoices"
  status  INTEGER,            -- HTTP-status van het antwoord (403 = geweigerde poging)
  ua      TEXT                -- user-agent (afgekapt)
);

CREATE INDEX IF NOT EXISTS idx_kijklog_oid_ts ON kijklog (oid, ts);
CREATE INDEX IF NOT EXISTS idx_kijklog_ts     ON kijklog (ts);
