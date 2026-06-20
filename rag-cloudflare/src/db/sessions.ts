/**
 * Chat session repository (ported from app/storage/repositories/chat_sessions.py).
 */
import type { Env, SessionRow } from "../types";
import { nowIso } from "../utils/time";

export async function getRecentSessions(
  env: Env,
  userId: string,
  limit = 50
): Promise<SessionRow[]> {
  const res = await env.DB.prepare(
    "SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?"
  )
    .bind(userId, limit)
    .all<SessionRow>();
  return res.results ?? [];
}

export async function initializeSession(
  env: Env,
  sessionId: string,
  userId: string,
  title = "New Chat"
): Promise<SessionRow> {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO chat_sessions (id, user_id, title, summary, status, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'active', ?, ?)`
  )
    .bind(sessionId, userId, title, now, now)
    .run();
  return {
    id: sessionId,
    user_id: userId,
    title,
    summary: null,
    status: "active",
    created_at: now,
    updated_at: now,
  };
}

export async function getSessionByIdAndUser(
  env: Env,
  sessionId: string,
  userId: string
): Promise<SessionRow | null> {
  return env.DB.prepare("SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?")
    .bind(sessionId, userId)
    .first<SessionRow>();
}

export async function updateTitle(env: Env, sessionId: string, title: string): Promise<void> {
  await env.DB.prepare("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?")
    .bind(title, nowIso(), sessionId)
    .run();
}

export async function updateSummary(env: Env, sessionId: string, summary: string): Promise<void> {
  await env.DB.prepare("UPDATE chat_sessions SET summary = ?, updated_at = ? WHERE id = ?")
    .bind(summary, nowIso(), sessionId)
    .run();
}

export async function updateActivity(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?")
    .bind(nowIso(), sessionId)
    .run();
}

export async function countSessions(env: Env, guest: boolean): Promise<number> {
  const sql = guest
    ? "SELECT COUNT(*) AS c FROM chat_sessions WHERE user_id LIKE 'guest_%'"
    : "SELECT COUNT(*) AS c FROM chat_sessions WHERE user_id NOT LIKE 'guest_%'";
  const row = await env.DB.prepare(sql).first<{ c: number }>();
  return row?.c ?? 0;
}
