/**
 * Chat routes (ported from /chat/new, /chat/{id}, /bible/ask, /general/ask).
 */
import { Hono } from "hono";
import type { Env, Variables, RagMode } from "../types";
import { optionalUser } from "../auth/middleware";
import { DEFAULT_TOP_K } from "../config";
import { ask, type AskParams } from "../rag/service";
import { initializeSession, getSessionByIdAndUser } from "../db/sessions";
import { nowIso } from "../utils/time";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

interface AskBody {
  query?: string;
  model?: string;
  mode?: RagMode;
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

async function collectResponse(c: any, params: AskParams) {
  const env = c.env as Env;
  const waitUntil = (p: Promise<unknown>) => c.executionCtx.waitUntil(p);
  let response = "";
  for await (const token of ask(env, { ...params, stream: false }, waitUntil)) {
    response += token;
  }
  return c.json({
    conversation_id: params.conversationId,
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
  await initializeSession(c.env, conversationId, userId);

  const params: AskParams = {
    query: body.query,
    conversationId,
    userId,
    topK,
    stream,
    model: body.model,
    mode: body.mode ?? "auto",
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
  if (!session) return c.json({ detail: "Conversation not found." }, 404);

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
  await initializeSession(c.env, conversationId, userId);
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
  await initializeSession(c.env, conversationId, userId);
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
