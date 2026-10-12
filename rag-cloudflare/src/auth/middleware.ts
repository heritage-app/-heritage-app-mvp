/**
 * Auth middleware (ported from app/api/deps.py).
 * - requireUser:  401 unless a valid JWT cookie resolves to a real user.
 * - optionalUser: resolves user id from JWT, else falls back to X-Anonymous-ID guest id.
 * - requireAdmin: requireUser + role === 'admin'.
 */
import type { Context, MiddlewareHandler } from "hono";
import type { Env, Variables } from "../types";
import { getTokenFromRequest, verifyAccessToken } from "./jwt";
import { getUserById } from "../db/users";

type AppEnv = { Bindings: Env; Variables: Variables };

export const ADMIN_CONSOLE_URL = "https://admin.speakga.org";

/** The admin console is its own site; it reaches this worker through a
 *  service binding and its requests keep the console's host name
 *  (heritage-admin…, or <version>-heritage-admin… for previews). */
export function fromAdminConsole(c: Context): boolean {
  // admin.speakga.org, or the console's workers.dev address.
  try {
    const host = new URL(c.req.url).hostname;
    return host === "admin.speakga.org" || /(^|[.-])heritage-admin\./.test(host);
  } catch { return false; }
}

/** Admin accounts belong to the console, not the app. A browser session
 *  (the cookie) for an admin is not honoured on the app's side. Scripts
 *  using a Bearer token are not browsers and are left alone. */
export function adminBlockedHere(c: Context, role: string): boolean {
  if (role !== "admin" || fromAdminConsole(c)) return false;
  return /(?:^|;\s*)access_token=/.test(c.req.header("Cookie") || "") && !c.req.header("Authorization");
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getTokenFromRequest(c);
  if (!token) return c.json({ detail: "Authentication token is missing" }, 401);

  const payload = await verifyAccessToken(c.env, token);
  if (!payload) return c.json({ detail: "Authentication failed or token expired" }, 401);

  const user = await getUserById(c.env, payload.sub);
  if (!user) return c.json({ detail: "User not found" }, 401);
  if (adminBlockedHere(c, user.role)) {
    return c.json({ detail: "Admin accounts sign in to the admin console, not the app." }, 401);
  }

  c.set("user", user);
  c.set("userId", user.id);
  await next();
};

export const optionalUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getTokenFromRequest(c);
  if (token) {
    const payload = await verifyAccessToken(c.env, token);
    if (payload) {
      const user = await getUserById(c.env, payload.sub);
      // An admin's app-side session counts as signed out: they get the guest experience.
      if (user && !adminBlockedHere(c, user.role)) {
        c.set("user", user);
        c.set("userId", user.id);
        await next();
        return;
      }
    }
  }

  const anon = c.req.header("X-Anonymous-ID");
  if (anon) {
    c.set("userId", anon.startsWith("guest_") ? anon : `guest_${anon}`);
  } else {
    c.set("userId", null);
  }
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getTokenFromRequest(c);
  if (!token) return c.json({ detail: "Authentication token is missing" }, 401);

  const payload = await verifyAccessToken(c.env, token);
  if (!payload) return c.json({ detail: "Authentication failed or token expired" }, 401);

  const user = await getUserById(c.env, payload.sub);
  if (!user) return c.json({ detail: "User not found" }, 401);
  if (user.role !== "admin") {
    return c.json({ detail: "Forbidden: User does not have administrative privileges." }, 403);
  }

  c.set("user", user);
  c.set("userId", user.id);
  c.set("adminId", user.id);
  await next();
};
