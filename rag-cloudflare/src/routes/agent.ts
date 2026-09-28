/**
 * POST /agent/ask — the agent, as a one-shot JSON endpoint.
 *
 * This is the same pipeline the chat routes run with mode "agent" (see
 * ask() in rag/service.ts and rag/agent.ts): deterministic engines first,
 * the tool-using model only when they find nothing, every Ga claim checked
 * against tool evidence. It exists for API clients; the web app uses
 * /chat/new and /chat/:id with mode "agent" so turns stream and persist.
 */
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { optionalUser } from "../auth/middleware";
import { isGuestId } from "../auth/jwt";
import { initializeSession } from "../db/sessions";
import { DEFAULT_TOP_K } from "../config";
import { collectResponse } from "./chat";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.post("/agent/ask", optionalUser, async (c) => {
  const body = await c.req
    .json<{ query?: string; context?: string; prev_query?: string }>()
    .catch(() => ({} as { query?: string; context?: string; prev_query?: string }));
  const query = body.query?.trim();
  if (!query) return c.json({ detail: "Query is required" }, 400);

  const userId = c.get("userId");
  if (!userId) return c.json({ detail: "User identification required." }, 401);

  const conversationId = crypto.randomUUID();
  if (!isGuestId(userId)) await initializeSession(c.env, conversationId, userId);

  return collectResponse(c, {
    query,
    conversationId,
    userId,
    topK: DEFAULT_TOP_K,
    stream: false,
    mode: "agent",
    context: body.context,
    prevQuery: body.prev_query,
  });
});

export default app;
