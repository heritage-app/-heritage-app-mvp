/**
 * Guests can contribute everything signed-in people can, including files and
 * voice recordings. Those uploads are capped per connection per day so an
 * open door doesn't fill R2. The connection is kept only as a salted hash.
 */
import type { Env } from "../types";

export const GUEST_DAILY = { voice: 10, files: 5 } as const;
export type GuestKind = keyof typeof GUEST_DAILY;

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Salted hash of the caller's connection (Cloudflare's client IP header). */
export async function connectionHash(request: Request, env: Env): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  return sha256(`${env.JWT_SECRET || "speakga"}:guest:${ip}`);
}

/** True when this guest connection may upload another `kind` today; records the upload when it may. */
export async function takeGuestAllowance(request: Request, env: Env, kind: GuestKind): Promise<boolean> {
  const h = await connectionHash(request, env);
  const since = new Date(Date.now() - 86400000).toISOString();
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM guest_limits WHERE ip_hash = ? AND kind = ? AND at > ?")
    .bind(h, kind, since).first<{ n: number }>().catch(() => ({ n: 0 }));
  if ((row?.n ?? 0) >= GUEST_DAILY[kind]) return false;
  await env.DB.prepare("INSERT INTO guest_limits (ip_hash, kind, at) VALUES (?, ?, ?)").bind(h, kind, new Date().toISOString()).run().catch(() => {});
  return true;
}

/** A private key for something a guest made, and the hash we store for it. */
export async function ownerToken(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { token, hash: await sha256(token) };
}
export const tokenHash = (token: string) => sha256(String(token || ""));
