/**
 * Search engine plumbing for the two public domains served by this Worker.
 *
 *   speakga.org      landing page (www and speakga.com redirect here)
 *   app.speakga.org  the app
 *   anything else    heritage-rag.heritage-app.workers.dev, previews: kept out of search
 *
 * robots.txt and sitemap.xml differ per domain, so they're generated here rather
 * than shipped as static files. The landing page has one address, speakga.org/;
 * /landing on any public host redirects there.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, Variables } from "../types";

export const SITE = "https://speakga.org";
export const APP = "https://app.speakga.org";
/** Last meaningful content change, for the sitemaps. Bump it when a page changes. */
const LASTMOD = "2026-10-11";

export type HostKind = "site" | "app" | "local" | "other";
export function hostKind(reqUrl: string): HostKind {
  const h = new URL(reqUrl).hostname;
  if (h === "speakga.org" || h === "www.speakga.org") return "site";
  if (h === "app.speakga.org") return "app";
  if (h === "localhost" || h === "127.0.0.1") return "local";
  return "other";
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const HOUR = { "Cache-Control": "public, max-age=3600" };

app.get("/robots.txt", (c) => {
  const kind = hostKind(c.req.url);
  const body = kind === "site" || kind === "app"
    ? `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${kind === "site" ? SITE : APP}/sitemap.xml\n`
    : "# SpeakGa's public addresses are https://speakga.org and https://app.speakga.org\nUser-agent: *\nDisallow: /\n";
  return c.text(body, 200, HOUR);
});

app.get("/sitemap.xml", (c) => {
  const kind = hostKind(c.req.url);
  if (kind !== "site" && kind !== "app") return c.text("Not found", 404);
  const base = kind === "site" ? SITE : APP;
  const images = [`${base}/img/og/speakga-share.png`, `${base}/img/hero.webp`];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${base}/</loc>
    <lastmod>${LASTMOD}</lastmod>
${images.map((u) => `    <image:image><image:loc>${u}</image:loc></image:image>`).join("\n")}
  </url>
</urlset>
`;
  return c.body(xml, 200, { "Content-Type": "application/xml; charset=utf-8", ...HOUR });
});

// One address for the landing page. Local development still serves the file.
const toLanding = (c: Context<{ Bindings: Env; Variables: Variables }>) =>
  hostKind(c.req.url) === "local"
    ? c.env.ASSETS.fetch(new Request(new URL("/landing", c.req.url), c.req.raw))
    : c.redirect(`${SITE}/`, 301);
app.get("/landing", toLanding);
app.get("/landing.html", toLanding);

export default app;
