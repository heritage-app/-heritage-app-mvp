/**
 * Interaction (message turn) repository.
 * Ported from app/storage/repositories/messages.py. One row = one turn (query + response).
 */
import type { Env, InteractionRow } from "../types";
import { nowIso } from "../utils/time";

function isGuest(userId: string | null | undefined): boolean {
  return !!userId && userId.startsWith("guest_");
}

export async function getByConversation(
  env: Env,
  conversationId: string,
  limit?: number
): Promise<InteractionRow[]> {
  let sql =
    "SELECT * FROM interactions WHERE conversation_id = ? ORDER BY created_at ASC";
  const binds: unknown[] = [conversationId];
  if (limit) {
    sql += " LIMIT ?";
    binds.push(limit);
  }
  const res = await env.DB.prepare(sql)
    .bind(...binds)
    .all<InteractionRow>();
  return res.results ?? [];
}

export async function saveInteraction(
  env: Env,
  conversationId: string,
  query: string,
  response: string,
  userId: string | null
): Promise<InteractionRow> {
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const guestFlag = isGuest(userId) ? 1 : 0;

  await env.DB.prepare(
    `INSERT INTO interactions (id, conversation_id, user_id, is_guest, query, response, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, conversationId, userId ?? null, guestFlag, query, response, "{}", createdAt)
    .run();

  return {
    id,
    conversation_id: conversationId,
    user_id: userId ?? null,
    is_guest: guestFlag,
    query,
    response,
    metadata: "{}",
    created_at: createdAt,
  };
}

export async function deleteByConversation(env: Env, conversationId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM interactions WHERE conversation_id = ?")
    .bind(conversationId)
    .run();
}
