-- Site traffic round three: the visitor's city (from Cloudflare) and browser
-- language (Accept-Language), both public data sent with every request.
--   wrangler d1 execute heritage-db --remote --file=./src/db/schema-traffic-3.sql
ALTER TABLE site_events ADD COLUMN city TEXT;
ALTER TABLE site_events ADD COLUMN lang TEXT;
