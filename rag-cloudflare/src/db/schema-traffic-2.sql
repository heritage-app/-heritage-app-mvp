-- Site traffic round two: which browser and OS each event came from, and the
-- UTM campaign tag that brought the visit (source / medium / campaign, joined).
--   wrangler d1 execute heritage-db --remote --file=./src/db/schema-traffic-2.sql
ALTER TABLE site_events ADD COLUMN browser TEXT;
ALTER TABLE site_events ADD COLUMN os TEXT;
ALTER TABLE site_events ADD COLUMN utm TEXT;
