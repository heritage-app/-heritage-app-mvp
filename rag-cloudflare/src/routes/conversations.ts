/**
 * Conversation listing + messages (ported from app/api/routes.py).
 */
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { optionalUser } from "../auth/middleware";
import { getRecentSessionsWithLastMessage, getSessionByIdAndUser, deleteSession } from "../db/sessions";
import { getByConversation, deleteByConversation } from "../db/messages";
import { humanizeTimestamp } from "../utils/time";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// List recent conversations for the current user.
app.get("/conversations", optionalUser, async (c) => {
  const userId = c.get("userId");
  if (!userId || userId.startsWith("guest_")) {
    return c.json({ conversations: [], total: "0 conversations" });
  }
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1), 100);
  const sessions = await getRecentSessionsWithLastMessage(c.env, userId, limit);

  const items = sessions.map((s) => {
    const rawMsg = s.last_message ?? null;
    const lastMessage = rawMsg && rawMsg.length > 100 ? rawMsg.slice(0, 100) + "..." : rawMsg;
    return {
      conversation_id: s.id,
      title: s.title,
      last_message: lastMessage,
      last_activity: humanizeTimestamp(s.updated_at),
      message_count: "Recent session",
    };
  });
  return c.json({ conversations: items, total: `${items.length} conversations` });
});

// Get all messages for a conversation.
app.get("/conversations/:conversation_id/messages", optionalUser, async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ detail: "User identification required." }, 401);

  const conversationId = c.req.param("conversation_id");
  const session = await getSessionByIdAndUser(c.env, conversationId, userId);
  if (!session) return c.json({ detail: "Conversation not found" }, 404);

  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 1, 1), 100) : undefined;
  const turns = await getByConversation(c.env, conversationId, limit);

  const messages = [];
  for (const t of turns) {
    const sentAt = humanizeTimestamp(t.created_at);
    messages.push({
      id: `${t.id}_q`,
      conversation_id: conversationId,
      role: "user",
      content: t.query ?? "",
      sent_at: sentAt,
      created_at: t.created_at,
    });
    if (t.response) {
      messages.push({
        id: `${t.id}_a`,
        conversation_id: conversationId,
        role: "assistant",
        content: t.response,
        sent_at: sentAt,
        created_at: t.created_at,
      });
    }
  }

  return c.json({
    conversation_id: conversationId,
    title: session.title,
    messages,
    total: `${messages.length} messages`,
    last_activity: humanizeTimestamp(session.updated_at),
  });
});

// Delete a conversation (session + its message turns) — owner only.
app.delete("/conversations/:conversation_id", optionalUser, async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ detail: "User identification required." }, 401);

  const conversationId = c.req.param("conversation_id");
  const session = await getSessionByIdAndUser(c.env, conversationId, userId);
  if (!session) return c.json({ detail: "Conversation not found" }, 404);

  await deleteByConversation(c.env, conversationId);
  await deleteSession(c.env, conversationId);
  return c.json({ status: "success", message: "Conversation deleted." });
});

export default app;
