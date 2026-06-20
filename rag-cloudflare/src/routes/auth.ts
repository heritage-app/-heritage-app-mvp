/**
 * Auth routes (ported from app/api/routers/auth.py): signup, login, logout, me.
 */
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { getUserByEmail, createUser } from "../db/users";
import { verifyPassword } from "../auth/password";
import { createAccessToken, buildAuthCookie, clearAuthCookie } from "../auth/jwt";
import { requireUser } from "../auth/middleware";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function publicUser(u: { id: string; email: string; role: string; display_name: string | null }) {
  return { id: u.id, email: u.email, role: u.role, display_name: u.display_name };
}

type Credentials = { email?: string; password?: string };

app.post("/signup", async (c) => {
  const body = await c.req.json<Credentials>().catch(() => ({} as Credentials));
  if (!body.email || !body.password) {
    return c.json({ detail: "Email and password are required" }, 400);
  }
  const existing = await getUserByEmail(c.env, body.email);
  if (existing) return c.json({ detail: "User with this email already exists" }, 400);

  const user = await createUser(c.env, body.email, body.password);
  const token = await createAccessToken(c.env, user.id, user.role);
  c.header("Set-Cookie", buildAuthCookie(c.env, token));
  return c.json({ access_token: token, token_type: "bearer", user: publicUser(user) });
});

app.post("/login", async (c) => {
  const body = await c.req.json<Credentials>().catch(() => ({} as Credentials));
  if (!body.email || !body.password) return c.json({ detail: "Invalid credentials" }, 401);

  const user = await getUserByEmail(c.env, body.email);
  if (!user) return c.json({ detail: "Invalid credentials" }, 401);

  const ok = await verifyPassword(body.password, user.hashed_password);
  if (!ok) return c.json({ detail: "Invalid credentials" }, 401);

  const token = await createAccessToken(c.env, user.id, user.role);
  c.header("Set-Cookie", buildAuthCookie(c.env, token));
  return c.json({ access_token: token, token_type: "bearer", user: publicUser(user) });
});

app.post("/logout", (c) => {
  c.header("Set-Cookie", clearAuthCookie());
  return c.json({ status: "success", message: "Logged out" });
});

app.get("/me", requireUser, (c) => {
  const u = c.get("user")!;
  return c.json(publicUser(u));
});

export default app;
