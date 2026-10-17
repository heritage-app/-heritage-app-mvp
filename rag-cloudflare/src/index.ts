/**
 * Heritage RAG — Cloudflare Workers entrypoint (Hono).
 *
 * Port of the FastAPI Heritage RAG system:
 *   FastAPI -> Hono | Qdrant -> Vectorize | HuggingFace -> Workers AI (bge-base)
 *   OpenRouter/Gemini -> Workers AI (Llama) | Supabase Storage -> R2 | Mongo/PG -> D1
 *
 * All app routes live under /api/v1 (matching the original API surface).
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, Variables } from "./types";
import { bootstrapSuperAdmin } from "./bootstrap";

import meta from "./routes/meta";
import auth from "./routes/auth";
import seo, { hostKind } from "./routes/seo";
import pages from "./routes/pages";
import user from "./routes/user";
import chat from "./routes/chat";
import conversations from "./routes/conversations";
import admin from "./routes/admin";
import { invitesAdmin, invitesPublic } from "./routes/invites";
import { requireAdmin, requireUser, API_HOST } from "./auth/middleware";
import { handleGetAttachment } from "./routes/attachments";
import { handleSuggestions } from "./routes/suggestions";
import { handleLearningInsights, handleUserContribution, handleAdminInsights } from "./routes/learning";
import { handleFeedback, handleFeedbackStats } from "./routes/feedback";
import { detectConflicts, resolveConflict, getConflictStats } from "./routes/conflicts";
import { getLearningProgress, getLearningCycles, getSystemHealth } from "./routes/analytics";
import { handleContribute, handleListContributions } from "./routes/contribute";
import quiz from "./routes/quiz";
import agent from "./routes/agent";
import bible from "./routes/bible";
import traffic, { redirectFromCom } from "./routes/traffic";
import adminConsole from "./routes/console";
import archiveStatsRoute from "./rag/archive-stats";
import voicesRoute from "./routes/voices";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// CORS with credentials (cookies). Origins come from CORS_ORIGINS (comma-separated).
app.use("*", async (c, next) => {
  const allowed = (c.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : allowed[0] ?? null),
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "X-Anonymous-ID"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["X-Conversation-Id", "X-Interaction-Id"],
  })(c, next);
});

// api.speakga.org is the API alone — for scripts, a future mobile app and
// partners, using Bearer tokens. The app and the admin console keep calling
// /api on their own address (same-origin cookies, no preflight). Anything that
// isn't the API on this host goes to the app.
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (url.hostname === API_HOST && !url.pathname.startsWith("/api/") && url.pathname !== "/robots.txt") {
    return c.redirect(`https://app.speakga.org${url.pathname === "/" ? "/" : url.pathname}${url.search}`, 301);
  }
  // speakga.com bounces to .org — counted first, so .com visits show in traffic.
  const com = redirectFromCom(c);
  if (com) return com;
  await next();
});

// Provision the super admin once per isolate (no-op unless configured).
app.use("*", async (c, next) => {
  await bootstrapSuperAdmin(c.env);
  await next();
});

const api = new Hono<{ Bindings: Env; Variables: Variables }>();
// API responses are data, not pages: keep them out of search results.
api.use("*", async (c, next) => {
  await next();
  try { c.res.headers.set("X-Robots-Tag", "noindex"); } catch { /* immutable (proxied) response */ }
});
api.route("/", meta);
api.route("/auth", auth);
api.route("/user", user);
api.route("/", chat);
api.route("/", conversations);
api.route("/admin/console", adminConsole);
api.route("/admin/invites", invitesAdmin);
api.route("/invites", invitesPublic);
api.route("/admin", admin);

// Admin-only gates for the raw (Request, Env) handlers below — these bypass
// the sub-router middleware chains, so the gate must be applied explicitly.
// NOTE: GET /contributions stays public — it powers the community review
// queue in public/index.html (the "+1 vote" mechanism). It returns pending
// content only, no user identifiers.
const adminGatedPaths = [
  "/learning/insights",
  "/feedback/stats",
  "/conflicts/detect",
  "/conflicts/resolve",
  "/conflicts/stats",
  "/analytics/progress",
  "/analytics/cycles",
  "/analytics/health",
  "/admin/insights",
];
for (const p of adminGatedPaths) {
  api.use(p, requireAdmin);
}

// These handlers take a raw (Request, Env) pair — adapt from the Hono context.
api.post("/suggestions", (c) => handleSuggestions(c.req.raw, c.env));
api.get("/learning/insights", (c) => handleLearningInsights(c.req.raw, c.env));
api.post("/learning/contribute", (c) => handleUserContribution(c.req.raw, c.env));
api.post("/feedback", (c) => handleFeedback(c.req.raw, c.env));
api.get("/feedback/stats", (c) => handleFeedbackStats(c.req.raw, c.env));
api.post("/conflicts/detect", (c) => detectConflicts(c.req.raw, c.env));
api.post("/conflicts/resolve", (c) => resolveConflict(c.req.raw, c.env));
api.get("/conflicts/stats", (c) => getConflictStats(c.req.raw, c.env));
api.get("/analytics/progress", (c) => getLearningProgress(c.req.raw, c.env));
api.get("/analytics/cycles", (c) => getLearningCycles(c.req.raw, c.env));
api.get("/analytics/health", (c) => getSystemHealth(c.req.raw, c.env));
api.get("/admin/insights", (c) => handleAdminInsights(c.req.raw, c.env));
api.post("/contribute", (c) => handleContribute(c.req.raw, c.env));
api.get("/contributions", (c) => handleListContributions(c.req.raw, c.env));
// Evidence bytes — signed-in reviewers only (guests are refused inside).
api.get("/contributions/:id/attachments/:index", requireUser, (c) =>
  handleGetAttachment(
    c.req.raw,
    c.env,
    c.req.param("id"),
    parseInt(c.req.param("index"), 10) || 0
  )
);
// Ga voices — dataset recordings plus approved community recordings (src/routes/voices.ts).
api.route("/", voicesRoute);

// Public media — images referenced by archive records (Ga samai symbols etc.).
// Keys are confined to the media/ prefix in the bucket; anything else 404s.
api.get("/media/*", async (c) => {
  const key = new URL(c.req.url).pathname.split("/media/")[1] ?? "";
  if (!key || key.includes("..")) return c.json({ detail: "Not found" }, 404);
  const obj = await c.env.DOCS_BUCKET.get(`media/${key}`);
  if (!obj) return c.json({ detail: "Not found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=86400");
  return new Response(obj.body, { headers });
});

api.route("/quiz", quiz);
api.route("/", agent);
api.route("/", bible);
api.route("/", traffic);
api.route("/", archiveStatsRoute);

app.route("/api/v1", api);

// The admin console moved to its own worker (heritage-admin). Old links and
// bookmarks to /admin here go there instead of a 404.
const ADMIN_CONSOLE = "https://admin.speakga.org";
app.get("/admin", (c) => c.redirect(`${ADMIN_CONSOLE}/admin.html`, 302));
app.get("/admin.html", (c) => c.redirect(`${ADMIN_CONSOLE}/admin.html`, 302));

// robots.txt, sitemap.xml and the /landing redirect, per domain (src/routes/seo.ts).
app.route("/", seo);
// Learn Ga, Ga samai, About and Support pages on speakga.org (src/routes/pages.ts).
app.route("/", pages);

// The root page depends on the domain (wrangler.toml runs the Worker first for "/"):
// speakga.org is the landing page, www.speakga.org goes to it, and every other host
// (app.speakga.org, workers.dev, localhost) gets the app. The query string is kept,
// since the app reads ?q= from landing-page links. Copies on non-public hosts
// (workers.dev) are marked noindex so search only shows the real addresses.
app.get("/", async (c) => {
  const url = new URL(c.req.url);
  if (url.hostname === "www.speakga.org") return c.redirect(`https://speakga.org/${url.search}`, 301);
  const page = new URL(url);
  page.pathname = url.hostname === "speakga.org" ? "/landing" : "/";
  const res = await c.env.ASSETS.fetch(new Request(page, c.req.raw));
  if (hostKind(c.req.url) !== "other") return res;
  const marked = new Response(res.body, res);
  marked.headers.set("X-Robots-Tag", "noindex");
  return marked;
});

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ detail: "Internal server error" }, 500);
});

app.notFound((c) => c.json({ detail: "Not found" }, 404));

export default app;
