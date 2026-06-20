/**
 * User repository (ported from app/storage/repositories/users.py).
 */
import type { Env, UserRow } from "../types";
import { nowIso } from "../utils/time";
import { hashPassword } from "../auth/password";

export async function getUserByEmail(env: Env, email: string): Promise<UserRow | null> {
  return env.DB.prepare("SELECT * FROM users WHERE email = ?")
    .bind(email.toLowerCase())
    .first<UserRow>();
}

export async function getUserById(env: Env, id: string): Promise<UserRow | null> {
  return env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

export async function getAllUsers(env: Env, limit = 50, offset = 0): Promise<UserRow[]> {
  const res = await env.DB.prepare(
    "SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?"
  )
    .bind(limit, offset)
    .all<UserRow>();
  return res.results ?? [];
}

export async function countUsers(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM users").first<{ c: number }>();
  return row?.c ?? 0;
}

export async function createUser(
  env: Env,
  email: string,
  password: string,
  role = "member",
  displayName = ""
): Promise<UserRow> {
  const existing = await getUserByEmail(env, email);
  if (existing) throw new Error("Email already registered");

  const id = crypto.randomUUID();
  const hashed = await hashPassword(password);
  const display = displayName || email.split("@")[0];
  const createdAt = nowIso();

  await env.DB.prepare(
    `INSERT INTO users (id, email, hashed_password, role, display_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, email.toLowerCase(), hashed, role, display, createdAt)
    .run();

  return {
    id,
    email: email.toLowerCase(),
    hashed_password: hashed,
    role,
    display_name: display,
    first_name: null,
    last_name: null,
    dob: null,
    created_at: createdAt,
    updated_at: null,
  };
}

const PROFILE_FIELDS = ["first_name", "last_name", "dob", "display_name"] as const;

export async function updateUser(
  env: Env,
  id: string,
  data: Record<string, unknown>
): Promise<boolean> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of PROFILE_FIELDS) {
    if (key in data && data[key] !== undefined) {
      sets.push(`${key} = ?`);
      values.push(data[key]);
    }
  }
  if (sets.length === 0) return false;
  sets.push("updated_at = ?");
  values.push(nowIso());
  values.push(id);

  const res = await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function updateUserRole(env: Env, id: string, role: string): Promise<boolean> {
  const res = await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?")
    .bind(role, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}
