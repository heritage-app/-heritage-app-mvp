/**
 * Chat routes (ported from /chat/new, /chat/{id}, /bible/ask, /general/ask).
 */
import { Hono } from "hono";
import type { Env, Variables, RagMode } from "../types";
import { optionalUser } from "../auth/middleware";
import { DEFAULT_TOP_K } from "../config";
import { ask, type AskParams } from "../rag/service";
import { initializeSession, getSessionByIdAndUser } from "../db/sessions";
import { isGuestId } from "../auth/jwt";
import { nowIso } from "../utils/time";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

interface AskBody {
  query?: string;
  model?: string;
  mode?: RagMode;
  // Guests persist no history; the client resends the last assistant message
  // so follow-ups like "continue" / "another story" stay stateless but aware.
  context?: string;
  // ...and the question that produced it, so a guest's "that's wrong" knows
  // what it is wrong about.
  prev_query?: string;
}

function clampTopK(raw: string | undefined): number {
  const v = parseInt(raw ?? String(DEFAULT_TOP_K), 10);
  if (isNaN(v)) return DEFAULT_TOP_K;
  return Math.min(Math.max(v, 1), 20);
}

/** Turn the ask() generator into a streaming text/plain Response. */
function streamResponse(c: any, params: AskParams): Response {
  const encoder = new TextEncoder();
  const env = c.env as Env;
  const waitUntil = (p: Promise<unknown>) => c.executionCtx.waitUntil(p);

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const token of ask(env, params, waitUntil)) {
          controller.enqueue(encoder.encode(token));
        }
      } catch (e) {
        controller.enqueue(encoder.encode("\n[stream error]"));
        console.error(e);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Conversation-Id": params.conversationId ?? "",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function collectResponse(c: any, params: AskParams) {
  const env = c.env as Env;
  const waitUntil = (p: Promise<unknown>) => c.executionCtx.waitUntil(p);
  let response = "";
  for await (const token of ask(env, { ...params, stream: false }, waitUntil)) {
    response += token;
  }
  // Strip the internal __META__ trailer — it's a stream-side signal, not
  // response text. Surface the interaction id as a proper JSON field so
  // non-streaming clients can still attach feedback to it.
  let interactionId: string | undefined;
  let flag: unknown;
  let trace: unknown;
  const metaMatch = response.match(/\n__META__:(\{[^\n]*\})\n?/);
  if (metaMatch) {
    try {
      const meta = JSON.parse(metaMatch[1]);
      interactionId = meta.interactionId;
      // The turn was flagged (wrong answer, or nothing in the archive) — the
      // client renders the contribution card from this.
      flag = meta.flag;
      trace = meta.trace;
    } catch {}
    response = response.replace(/\n__META__:\{[^\n]*\}\n?/g, "");
  }
  return c.json({
    conversation_id: params.conversationId,
    interaction_id: interactionId,
    flag,
    trace,
    response,
    query: params.query,
    timestamp: nowIso(),
  });
}

// Start a new conversation.
app.post("/chat/new", optionalUser, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<AskBody>().catch(() => ({} as AskBody));
  if (!body.query) return c.json({ detail: "Query is required" }, 400);
  if (!userId) return c.json({ detail: "User identification required." }, 401);

  const topK = clampTopK(c.req.query("top_k"));
  const stream = c.req.query("stream") === "true";

  const conversationId = crypto.randomUUID();
  // Guests get an ephemeral id — no session row, their chats aren't saved.
  if (!isGuestId(userId)) await initializeSession(c.env, conversationId, userId);

  const params: AskParams = {
    query: body.query,
    conversationId,
    userId,
    topK,
    stream,
    model: body.model,
    mode: body.mode ?? "auto",
    context: body.context,
    prevQuery: body.prev_query,
  };
  return stream ? streamResponse(c, params) : collectResponse(c, params);
});

// Continue an existing conversation.
app.post("/chat/:conversation_id", optionalUser, async (c) => {
  const userId = c.get("userId");
  const conversationId = c.req.param("conversation_id");
  const body = await c.req.json<AskBody>().catch(() => ({} as AskBody));
  if (!body.query) return c.json({ detail: "Query is required" }, 400);
  if (!userId) return c.json({ detail: "User identification required." }, 401);

  const session = await getSessionByIdAndUser(c.env, conversationId, userId);
  // Guests own no sessions — continue statelessly instead of 404ing, since
  // their conversation ids were never persisted in the first place.
  if (!session && !isGuestId(userId)) return c.json({ detail: "Conversation not found." }, 404);

  const topK = clampTopK(c.req.query("top_k"));
  const stream = c.req.query("stream") === "true";
  const params: AskParams = {
    query: body.query,
    conversationId,
    userId,
    topK,
    stream,
    model: body.model,
    mode: body.mode ?? "auto",
    context: body.context,
    prevQuery: body.prev_query,
  };
  return stream ? streamResponse(c, params) : collectResponse(c, params);
});

// Explicit Bible / General entrypoints (non-streaming, new conversation).
app.post("/bible/ask", optionalUser, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<AskBody>().catch(() => ({} as AskBody));
  if (!body.query) return c.json({ detail: "Query is required" }, 400);
  if (!userId) return c.json({ detail: "User identification required." }, 401);

  const conversationId = crypto.randomUUID();
  if (!isGuestId(userId)) await initializeSession(c.env, conversationId, userId);
  return collectResponse(c, {
    query: body.query,
    conversationId,
    userId,
    topK: DEFAULT_TOP_K,
    stream: false,
    model: body.model,
    mode: "bible",
  });
});

app.post("/general/ask", optionalUser, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<AskBody>().catch(() => ({} as AskBody));
  if (!body.query) return c.json({ detail: "Query is required" }, 400);
  if (!userId) return c.json({ detail: "User identification required." }, 401);

  const conversationId = crypto.randomUUID();
  if (!isGuestId(userId)) await initializeSession(c.env, conversationId, userId);
  return collectResponse(c, {
    query: body.query,
    conversationId,
    userId,
    topK: DEFAULT_TOP_K,
    stream: false,
    model: body.model,
    mode: "general",
  });
});

export default app;
