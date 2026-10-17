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
import type { Context } from "hono";
import type { Env, Variables } from "../types";
import { requireAdmin } from "../auth/middleware";
import { hostKind } from "./seo";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const EVENTS = new Set(["pageview", "start", "support", "give", "install", "install_click", "uninstall", "signup", "first_visit"]);
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|whatsapp\/|curl|wget|python|httpclient/i;
const OWN_HOSTS = /(^|\.)speakga\.(org|com)$|workers\.dev$|^localhost$|^127\./;

function deviceOf(ua: string): string {
  if (/ipad|tablet|kindle|silk|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android/i.test(ua)) return "phone";
  return "desktop";
}

function browserOf(ua: string): string {
  if (/edg(e|a|ios)?\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/samsungbrowser/i.test(ua)) return "Samsung Internet";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/chrome|crios|chromium/i.test(ua)) return "Chrome";
  if (/safari/i.test(ua)) return "Safari";
  return "Other";
}

function osOf(ua: string): string {
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/windows/i.test(ua)) return "Windows";
  if (/mac os|macintosh/i.test(ua)) return "macOS";
  if (/linux|ubuntu|fedora|debian/i.test(ua)) return "Linux";
  if (/cros/i.test(ua)) return "ChromeOS";
  return "Other";
}

/** utm_source/medium/campaign from the page's query string — "src / med / cmp". */
function utmOf(raw: string): string | null {
  try {
    const q = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
    const parts = ["utm_source", "utm_medium", "utm_campaign"]
      .map((k) => (q.get(k) || "").replace(/[^\w .-]/g, "").slice(0, 60))
      .filter(Boolean);
    return parts.length ? parts.join(" / ").slice(0, 180) : null;
  } catch { return null; }
}

type CfMeta = { country?: string; city?: string };

/** Shared insert for /e beacons AND server-side hits (the .com redirect). */
async function insertEvent(
  c: Context,
  fields: { host: string; path: string; event: string; refHost?: string | null; query?: string }
): Promise<void> {
  const ua = c.req.header("User-Agent") || "";
  if (!ua || BOT.test(ua)) return;
  const cf = (c.req.raw as unknown as { cf?: CfMeta }).cf ?? {};
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const ip = c.req.header("CF-Connecting-IP") || "";
  const lang = (c.req.header("Accept-Language") || "").split(",")[0].trim().slice(0, 16) || null;
  const visitor = await visitorId(c.env.JWT_SECRET, day, ip, ua);
  await c.env.DB.prepare(
    "INSERT INTO site_events (ts, day, host, path, event, ref_host, country, city, lang, device, browser, os, utm, visitor) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(
    now.toISOString(), day, fields.host, fields.path, fields.event, fields.refHost ?? null,
    (cf.country || "").slice(0, 2) || null, (cf.city || "").slice(0, 80) || null, lang,
    deviceOf(ua), browserOf(ua), osOf(ua), utmOf(fields.query ?? ""), visitor
  ).run();
}

/**
 * speakga.com (and www.) redirect to speakga.org at Cloudflare's edge — but only
 * once the domain routes here. This worker logs the hit (host 'com' so the
 * report can split it) then 301s, replacing the redirect rule.
 */
export function redirectFromCom(c: Context): Response | null {
  const url = new URL(c.req.url);
  const h = url.hostname;
  if (h !== "speakga.com" && h !== "www.speakga.com") return null;
  let refHost: string | null = null;
  try {
    const rh = c.req.header("Referer");
    const hn = rh ? new URL(rh).hostname.replace(/^www\./, "") : "";
    if (hn && !OWN_HOSTS.test(hn) && hn !== "speakga.com") refHost = hn.slice(0, 80);
  } catch { /* not a URL */ }
  c.executionCtx.waitUntil(
    insertEvent(c, {
      host: "com",
      path: url.pathname.slice(0, 120) || "/",
      event: "pageview",
      refHost,
      query: url.search,
    }).catch(() => {})
  );
  return Response.redirect(`https://speakga.org${url.pathname}${url.search}`, 301);
}

async function visitorId(secret: string, day: string, ip: string, ua: string): Promise<string> {
  const data = new TextEncoder().encode(`${secret}|${day}|${ip}|${ua}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

app.post("/e", async (c) => {
  const ua = c.req.header("User-Agent") || "";
  if (!ua || BOT.test(ua)) return c.body(null, 204);
  let body: { e?: string; p?: string; r?: string; u?: string } = {};
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

  c.executionCtx.waitUntil(
    insertEvent(c, { host: kind, path, event, refHost, query: String(body.u || "") }).catch(() => {})
  );
  return c.body(null, 204);
});

app.get("/analytics/traffic", requireAdmin, async (c) => {
  const days = Math.min(365, Math.max(1, parseInt(c.req.query("days") || "7", 10) || 7));
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const db = c.env.DB;
  const all = <T>(sql: string) => db.prepare(sql).bind(since).all<T>().then((r) => r.results || []);
  const PV = "event='pageview' AND day >= ? AND host != 'other'";

  const [totals, daily, pages, refs, countries, devices, events, funnel, browsers, oses, campaigns, hourly, bounce, comVisits, landing, cities, langs, installDev] = await Promise.all([
    all<{ visitors: number; views: number }>(`SELECT COUNT(DISTINCT visitor||day) visitors, COUNT(*) views FROM site_events WHERE ${PV}`),
    all<{ day: string; visitors: number; views: number }>(`SELECT day, COUNT(DISTINCT visitor) visitors, COUNT(*) views FROM site_events WHERE ${PV} GROUP BY day ORDER BY day`),
    all<{ host: string; path: string; views: number }>(
      `SELECT host, CASE WHEN host='app' THEN path
                        WHEN instr(path,'#')>0 THEN substr(path,1,instr(path,'#')-1)
                        ELSE path END path, COUNT(*) views
         FROM site_events WHERE ${PV} GROUP BY host, 2 ORDER BY views DESC LIMIT 8`),
    all<{ ref: string; visitors: number }>(`SELECT COALESCE(ref_host,'Direct') ref, COUNT(DISTINCT visitor||day) visitors FROM site_events WHERE ${PV} GROUP BY ref ORDER BY visitors DESC LIMIT 8`),
    all<{ country: string; visitors: number }>(`SELECT COALESCE(country,'??') country, COUNT(DISTINCT visitor||day) visitors FROM site_events WHERE ${PV} GROUP BY country ORDER BY visitors DESC LIMIT 8`),
    all<{ device: string; visitors: number }>(`SELECT device, COUNT(DISTINCT visitor||day) visitors FROM site_events WHERE ${PV} GROUP BY device ORDER BY visitors DESC`),
    all<{ event: string; n: number }>(`SELECT event, COUNT(DISTINCT visitor||day) n FROM site_events WHERE event != 'pageview' AND day >= ? GROUP BY event`),
    all<{ site: number; app: number }>(`SELECT
        COUNT(DISTINCT CASE WHEN host IN ('site','com') THEN visitor||day END) site,
        COUNT(DISTINCT CASE WHEN host='app' THEN visitor||day END) app
      FROM site_events WHERE ${PV}`),
    all<{ browser: string; visitors: number }>(`SELECT COALESCE(browser,'Other') browser, COUNT(DISTINCT visitor||day) visitors FROM site_events WHERE ${PV} GROUP BY browser ORDER BY visitors DESC LIMIT 8`),
    all<{ os: string; visitors: number }>(`SELECT COALESCE(os,'Other') os, COUNT(DISTINCT visitor||day) visitors FROM site_events WHERE ${PV} GROUP BY os ORDER BY visitors DESC LIMIT 8`),
    all<{ utm: string; visitors: number }>(`SELECT utm, COUNT(DISTINCT visitor||day) visitors FROM site_events WHERE ${PV} AND utm IS NOT NULL AND utm != '' GROUP BY utm ORDER BY visitors DESC LIMIT 8`),
    all<{ hh: string; visitors: number }>(`SELECT substr(ts,12,2) hh, COUNT(DISTINCT visitor||day) visitors FROM site_events WHERE ${PV} GROUP BY hh ORDER BY hh`),
    all<{ bounced: number }>(`SELECT COUNT(*) bounced FROM (SELECT visitor||day v, SUM(event='pageview') n FROM site_events WHERE day >= ? AND host != 'other' GROUP BY v) WHERE n = 1`),
    all<{ com: number }>(`SELECT COUNT(DISTINCT visitor||day) com FROM site_events WHERE host = 'com' AND day >= ?`),
    all<{ path: string; visitors: number }>(
      `SELECT CASE WHEN instr(path,'#')>0 THEN substr(path,1,instr(path,'#')-1) ELSE path END path, COUNT(*) visitors FROM (
         SELECT visitor||day vd, path, ROW_NUMBER() OVER (PARTITION BY visitor||day ORDER BY ts) rn
         FROM site_events WHERE event='pageview' AND day >= ? AND host IN ('site','com')
       ) WHERE rn = 1 GROUP BY 1 ORDER BY visitors DESC LIMIT 8`
    ),
    all<{ city: string; visitors: number }>(`SELECT COALESCE(city,'Unknown') city, COUNT(DISTINCT visitor||day) visitors FROM site_events WHERE ${PV} GROUP BY city ORDER BY visitors DESC LIMIT 8`),
    all<{ lang: string; visitors: number }>(`SELECT COALESCE(lang,'Unknown') lang, COUNT(DISTINCT visitor||day) visitors FROM site_events WHERE ${PV} GROUP BY lang ORDER BY visitors DESC LIMIT 8`),
    all<{ event: string; os: string; browser: string; device: string; n: number }>(
      `SELECT event, COALESCE(os,'?') os, COALESCE(browser,'?') browser, device, COUNT(*) n
       FROM site_events WHERE event IN ('install','install_click','uninstall') AND day >= ?
       GROUP BY event, os, browser, device ORDER BY event, n DESC`
    ),
  ]);
  // No `?` in this one — it can't go through `all` (which always binds `since`).
  const activeNow = await db.prepare("SELECT COUNT(DISTINCT visitor) n FROM site_events WHERE ts >= datetime('now','-15 minutes')").first<{ n: number }>().catch(() => null);

  // The later steps come from the app's own tables, so they count real questions and contributions.
  const [asked, contributed, signups] = await Promise.all([
    db.prepare("SELECT COUNT(DISTINCT user_id) n FROM interactions WHERE date(created_at) >= ?").bind(since).first<{ n: number }>().catch(() => null),
    db.prepare("SELECT COUNT(DISTINCT COALESCE(contributor_id, id)) n FROM user_contributions WHERE date(timestamp) >= ?").bind(since).first<{ n: number }>().catch(() => null),
    db.prepare("SELECT COUNT(*) n FROM users WHERE role NOT IN ('admin','super_admin') AND date(created_at) >= ?").bind(since).first<{ n: number }>().catch(() => null),
  ]);

  const ev = Object.fromEntries(events.map((e) => [e.event, e.n]));
  // Acquisition channels — GA-style grouping of the referrer hosts.
  const channelOf = (ref: string): string => {
    if (ref === "Direct") return "Direct";
    if (/google|bing|yahoo|duckduckgo|baidu|yandex|ecosia|ask\.com|aol/.test(ref)) return "Search";
    if (/facebook|instagram|t\.co$|x\.com|twitter|linkedin|whatsapp|telegram|tiktok|youtube|reddit|pinterest|snapchat|threads/.test(ref)) return "Social";
    if (/mail\.|outlook|protonmail|yahoomail|newsletter/.test(ref)) return "Email";
    return "Referral";
  };
  const chanMap = new Map<string, number>();
  for (const r of refs) chanMap.set(channelOf(r.ref), (chanMap.get(channelOf(r.ref)) ?? 0) + r.visitors);
  const channels = [...chanMap.entries()].map(([channel, visitors]) => ({ channel, visitors })).sort((a, b) => b.visitors - a.visitors);

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
    browsers,
    oses,
    campaigns,
    channels,
    landing_pages: landing,
    cities,
    langs,
    com_visitors: comVisits[0]?.com ?? 0,
    install_devices: installDev,
    hourly,
    bounced: bounce[0]?.bounced ?? 0,
    active_now: activeNow?.n ?? 0,
    first_visit: ev.first_visit ?? 0,
    actions: { start: ev.start ?? 0, support: ev.support ?? 0, give: ev.give ?? 0, install: ev.install ?? 0, install_click: ev.install_click ?? 0, signup: ev.signup ?? 0 },
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
