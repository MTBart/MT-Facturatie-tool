-- migrations/0001_events.sql
-- D1-schema voor het usage-/presence-trackingsysteem van de M&T-cockpit.
-- Server-side opslag (Cloudflare D1). NOOIT in de publieke repo gedumpt.
-- Data-minimalisme: functienamen + ID's + status, GEEN klant-PII/factuurinhoud.
--
-- Toepassen (Bart, na `wrangler d1 create`):
--   wrangler d1 execute mt-tracking --file=migrations/0001_events.sql --remote
--
-- Idempotent: alles is IF NOT EXISTS, dus opnieuw draaien is veilig.

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,            -- epoch ms (client-ts), wanneer het event gebeurde
  recv_ts     INTEGER NOT NULL,            -- epoch ms (server-ts), wanneer de Worker het ontving
  session_id  TEXT    NOT NULL,            -- per page-load gegenereerd (sessieduur = max(ts)-min(ts))
  user        TEXT    NOT NULL,            -- ingelogde e-mail (uit MSAL-token), lowercased
  event       TEXT    NOT NULL,            -- categorie: 'tab','action','error','api','session','chat'
  action      TEXT,                        -- specifieke handeling: 'factuur_boeken','tab_dwell',...
  detail      TEXT,                        -- KLEIN, niet-gevoelig: id/code/tabnaam/statuscode. Geen inhoud.
  ok          INTEGER,                     -- 1 = gelukt, 0 = mislukt, NULL = n.v.t.
  ms          INTEGER,                     -- duur in ms (dwell-tijd / API-latency), NULL = n.v.t.
  app_version TEXT,                        -- commit/versie van de cockpit op moment van event
  ua          TEXT                         -- user-agent (afgekapt), voor browser/PC-onderscheid
);

CREATE INDEX IF NOT EXISTS idx_events_ts    ON events (ts);
CREATE INDEX IF NOT EXISTS idx_events_user  ON events (user);
CREATE INDEX IF NOT EXISTS idx_events_event ON events (event);
-- Samengestelde index voor de meest-gebruikte aggregatie (range + groepering).
CREATE INDEX IF NOT EXISTS idx_events_ts_event ON events (ts, event);
