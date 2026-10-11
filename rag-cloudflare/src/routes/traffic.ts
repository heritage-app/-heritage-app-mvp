/**
 * Site traffic — first-party, cookie-free analytics for speakga.org and app.speakga.org.
 *
 *   POST /api/v1/e                 a page view or action (public; sent with navigator.sendBeacon)
 *   GET  /api/v1/analytics/traffic  the admin report (?days=7|30|90)
 *
 * Nothing that identifies a person is stored: the visitor id is a salted hash of
 * IP + browser + day, so it changes every day. Bots are dropped.
 */
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { requireAdmin } from "../auth/middleware";
import { hostKind } from "./seo";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const EVENTS = new Set(["pageview", "start", "support", "give", "install", "signup"]);
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|whatsapp\/|curl|wget|python|httpclient/i;
const OWN_HOSTS = /(^|\.)speakga\.(org|com)$|workers\.dev$|^localhost$|^127\./;

function deviceOf(ua: string): string {
  if (/ipad|tablet|kindle|silk|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android/i.test(ua)) return "phone";
  return "desktop";
}

async function visitorId(secret: string, day: string, ip: string, ua: string): Promise<string> {
  const data = new TextEncoder().encode(`${secret}|${day}|${ip}|${ua}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

app.post("/e", async (c) => {
  const ua = c.req.header("User-Agent") || "";
  if (!ua || BOT.test(ua)) return c.body(null, 204);
  let body: { e?: string; p?: string; r?: string } = {};
  try { body = JSON.parse(await c.req.text()); } catch { return c.body(null, 204); }
  const event = String(body.e || "pageview");
  if (!EVENTS.has(event)) return c.body(null, 204);

  const host = hostKind(c.req.url);
  const kind = host === "site" || host === "app" ? host : "other";
  const path = String(body.p || "/").split("?")[0].slice(0, 120) || "/";
  let refHost: string | null = null;
  try {
    const h = body.r ? new URL(body.r).hostname.replace(/^www\./, "") : "";
    if (h && !OWN_HOSTS.test(h)) refHost = h.slice(0, 80);
  } catch { /* not a URL */ }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const ip = c.req.header("CF-Connecting-IP") || "";
  const country = ((c.req.raw as unknown as { cf?: { country?: string } }).cf?.country || "").slice(0, 2) || null;
  const visitor = await visitorId(c.env.JWT_SECRET, day, ip, ua);

  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      "INSERT INTO site_events (ts, day, host, path, event, ref_host, country, device, visitor) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(now.toISOString(), day, kind, path, event, refHost, country, deviceOf(ua), visitor).run().catch(() => {})
  );
  return c.body(null, 204);
});

app.get("/analytics/traffic", requireAdmin, async (c) => {
  const days = Math.min(365, Math.max(1, parseInt(c.req.query("days") || "7", 10) || 7));
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const db = c.env.DB;
  const all = <T>(sql: string) => db.prepare(sql).bind(since).all<T>().then((r) => r.results || []);
  const PV = "event='pageview' AND day >= ? AND host != 'other'";

  const [totals, daily, pages, refs, countries, devices, events, funnel] = await Promise.all([
    all<{ visitors: number; views: number }>(`SELECT COUNT(DISTINCT visitor||day) visitors, COUNT(*) views FROM site_events WHERE ${PV}`),
    all<{ day: string; visitors: number; views: number }>(`SELECT day, COUNT(DISTINCT visitor) visitors, COUNT(*) views FROM site_events WHERE ${PV} GROUP BY day ORDER BY day`),
    all<{ host: string; path: string; views: number }>(`SELECT host, path, COUNT(*) views FROM site_events WHERE ${PV} GROUP BY host, path ORDER BY views DESC LIMIT 8`),
    all<{ ref: string; visitors: number }>(`SELECT COALESCE(ref_host,'Direct') ref, COUNT(DISTINCT visitor||day) visitors FROM site_events WHERE ${PV} GROUP BY ref ORDER BY visitors DESC LIMIT 8`),
    all<{ country: string; visitors: number }>(`SELECT COALESCE(country,'??') country, COUNT(DISTINCT visitor||day) visitors FROM site_events WHERE ${PV} GROUP BY country ORDER BY visitors DESC LIMIT 8`),
    all<{ device: string; visitors: number }>(`SELECT device, COUNT(DISTINCT visitor||day) visitors FROM site_events WHERE ${PV} GROUP BY device ORDER BY visitors DESC`),
    all<{ event: string; n: number }>(`SELECT event, COUNT(DISTINCT visitor||day) n FROM site_events WHERE event != 'pageview' AND day >= ? GROUP BY event`),
    all<{ site: number; app: number }>(`SELECT
        COUNT(DISTINCT CASE WHEN host='site' THEN visitor||day END) site,
        COUNT(DISTINCT CASE WHEN host='app' THEN visitor||day END) app
      FROM site_events WHERE ${PV}`),
  ]);

  // The later steps come from the app's own tables, so they count real questions and contributions.
  const [asked, contributed, signups] = await Promise.all([
    db.prepare("SELECT COUNT(DISTINCT user_id) n FROM interactions WHERE date(created_at) >= ?").bind(since).first<{ n: number }>().catch(() => null),
    db.prepare("SELECT COUNT(DISTINCT COALESCE(contributor_id, id)) n FROM user_contributions WHERE date(timestamp) >= ?").bind(since).first<{ n: number }>().catch(() => null),
    db.prepare("SELECT COUNT(*) n FROM users WHERE role != 'admin' AND date(created_at) >= ?").bind(since).first<{ n: number }>().catch(() => null),
  ]);

  const ev = Object.fromEntries(events.map((e) => [e.event, e.n]));
  return c.json({
    days,
    since,
    visitors: totals[0]?.visitors ?? 0,
    views: totals[0]?.views ?? 0,
    daily,
    pages,
    referrers: refs,
    countries,
    devices,
    actions: { start: ev.start ?? 0, support: ev.support ?? 0, give: ev.give ?? 0, install: ev.install ?? 0, signup: ev.signup ?? 0 },
    funnel: {
      site_visitors: funnel[0]?.site ?? 0,
      app_visitors: funnel[0]?.app ?? 0,
      asked: asked?.n ?? 0,
      signed_up: signups?.n ?? 0,
      contributed: contributed?.n ?? 0,
    },
  });
});

export default app;
