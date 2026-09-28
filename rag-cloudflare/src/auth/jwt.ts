/**
 * JWT sign/verify (HS256) + auth cookie helpers.
 * Mirrors app/api/routers/auth.py (HttpOnly `access_token` cookie).
 */
import { sign, verify } from "hono/jwt";
import type { Context } from "hono";
import type { Env } from "../types";

export const COOKIE_NAME = "access_token";

export interface JwtPayload {
  sub: string;
  role: string;
  exp: number;
}

export async function createAccessToken(
  env: Env,
  subject: string,
  role: string
): Promise<string> {
  const minutes = parseInt(env.ACCESS_TOKEN_EXPIRE_MINUTES || "1440", 10);
  const exp = Math.floor(Date.now() / 1000) + minutes * 60;
  return sign({ sub: subject, role, exp }, env.JWT_SECRET, "HS256");
}

export async function verifyAccessToken(env: Env, token: string): Promise<JwtPayload | null> {
  try {
    const payload = (await verify(token, env.JWT_SECRET, "HS256")) as unknown as JwtPayload;
    if (!payload?.sub) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Read the auth token from cookie or `Authorization: Bearer` header. */
export function getTokenFromRequest(c: Context): string | null {
  const cookie = c.req.header("Cookie") || "";
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (match) {
    const v = decodeURIComponent(match[1]);
    if (v && v !== "null" && v !== "undefined") return v;
  }
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

export function buildAuthCookie(env: Env, token: string): string {
  const minutes = parseInt(env.ACCESS_TOKEN_EXPIRE_MINUTES || "1440", 10);
  return (
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; ` +
    `SameSite=Lax; Path=/; Max-Age=${minutes * 60}`
  );
}

export function clearAuthCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/**
 * Resolve a user identity for unauthenticated-facing endpoints (feedback,
 * contributions). Verifies Bearer JWT properly — NEVER stores the raw token
 * as a user id. Falls back to the guest id header, then "anonymous".
 */
export async function resolveUserId(request: Request, env: Env): Promise<string> {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const payload = await verifyAccessToken(env, auth.slice(7));
    if (payload?.sub) return payload.sub;
  }
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookieMatch = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (cookieMatch) {
    const v = decodeURIComponent(cookieMatch[1]);
    if (v && v !== "null" && v !== "undefined") {
      const payload = await verifyAccessToken(env, v);
      if (payload?.sub) return payload.sub;
    }
  }
  const anon = request.headers.get("X-Anonymous-ID");
  if (anon) return anon.startsWith("guest_") ? anon : `guest_${anon}`;
  return "anonymous";
}

/**
 * True for ephemeral identities (X-Anonymous-ID guests / no identity).
 * Guest conversations are never persisted — no session, message or
 * activity rows. Contributions and feedback DO still write (that data
 * is the point of the learning loop).
 */
export function isGuestId(userId: string | null | undefined): boolean {
  return !userId || userId === "anonymous" || userId.startsWith("guest_");
}
