-- Site traffic: one row per page view or tracked action on speakga.org and app.speakga.org.
-- No cookies, no names, no IP addresses. `visitor` is a hash of IP + browser + day with a
-- secret salt, so the same person counts once per day and cannot be followed across days.
--   wrangler d1 execute heritage-db --remote --file=./src/db/schema-traffic.sql
CREATE TABLE IF NOT EXISTS site_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  day TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
  host TEXT NOT NULL,         -- site | app | other
  path TEXT NOT NULL,         -- path plus #section, no query string
  event TEXT NOT NULL,        -- pageview | start | support | give | install | signup
  ref_host TEXT,              -- referring site, external only
  country TEXT,               -- two-letter code from Cloudflare
  device TEXT,                -- phone | tablet | desktop
  visitor TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_events_day ON site_events(day);
CREATE INDEX IF NOT EXISTS idx_site_events_event_day ON site_events(event, day);
