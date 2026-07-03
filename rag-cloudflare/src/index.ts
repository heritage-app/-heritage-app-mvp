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
import user from "./routes/user";
import chat from "./routes/chat";
import conversations from "./routes/conversations";
import admin from "./routes/admin";
import { handleSuggestions } from "./routes/suggestions";
import { handleLearningInsights, handleUserContribution } from "./routes/learning";

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
    exposeHeaders: ["X-Conversation-Id"],
  })(c, next);
});

// Provision the super admin once per isolate (no-op unless configured).
app.use("*", async (c, next) => {
  await bootstrapSuperAdmin(c.env);
  await next();
});

const api = new Hono<{ Bindings: Env; Variables: Variables }>();
api.route("/", meta);
api.route("/auth", auth);
api.route("/user", user);
api.route("/", chat);
api.route("/", conversations);
api.route("/admin", admin);
// These handlers take a raw (Request, Env) pair — adapt from the Hono context.
api.post("/suggestions", (c) => handleSuggestions(c.req.raw, c.env));
api.get("/learning/insights", (c) => handleLearningInsights(c.req.raw, c.env));
api.post("/learning/contribute", (c) => handleUserContribution(c.req.raw, c.env));

app.route("/api/v1", api);

// Friendly root redirect to the API info.
app.get("/", (c) => c.redirect("/api/v1"));

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ detail: "Internal server error" }, 500);
});

app.notFound((c) => c.json({ detail: "Not found" }, 404));

export default app;
