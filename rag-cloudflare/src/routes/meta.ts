/**
 * Root + health (ported from / and /health in app/api/routes.py).
 */
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { nowIso } from "../utils/time";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get("/", (c) =>
  c.json({
    message: "Heritage RAG System API (Cloudflare Workers)",
    description: "Public chat enabled with Admin-protected document management.",
    version: "1.2.0",
    endpoints: {
      public_chat: "/api/v1/chat/new",
      admin_upload: "/api/v1/admin/upload",
      admin_list_documents: "/api/v1/admin/documents",
      admin_delete: "/api/v1/admin/documents/{id}",
      admin_users: "/api/v1/admin/users",
      admin_stats: "/api/v1/admin/stats",
    },
  })
);

app.get("/health", async (c) => {
  const dependencies: Record<string, string> = {};

  try {
    await c.env.DB.prepare("SELECT 1").first();
    dependencies.d1 = "connected";
  } catch {
    dependencies.d1 = "disconnected";
  }

  try {
    await c.env.VECTORIZE.describe();
    dependencies.vectorize = "connected";
  } catch {
    dependencies.vectorize = "degraded";
  }

  const status = Object.values(dependencies).every((v) => v !== "disconnected") ? "healthy" : "degraded";
  return c.json({ status, message: "Service is running", timestamp: nowIso(), dependencies });
});

export default app;
