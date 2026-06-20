/**
 * Auth middleware (ported from app/api/deps.py).
 * - requireUser:  401 unless a valid JWT cookie resolves to a real user.
 * - optionalUser: resolves user id from JWT, else falls back to X-Anonymous-ID guest id.
 * - requireAdmin: requireUser + role === 'admin'.
 */
import type { MiddlewareHandler } from "hono";
import type { Env, Variables } from "../types";
import { getTokenFromRequest, verifyAccessToken } from "./jwt";
import { getUserById } from "../db/users";

type AppEnv = { Bindings: Env; Variables: Variables };

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getTokenFromRequest(c);
  if (!token) return c.json({ detail: "Authentication token is missing" }, 401);

  const payload = await verifyAccessToken(c.env, token);
  if (!payload) return c.json({ detail: "Authentication failed or token expired" }, 401);

  const user = await getUserById(c.env, payload.sub);
  if (!user) return c.json({ detail: "User not found" }, 401);

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
      if (user) {
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
