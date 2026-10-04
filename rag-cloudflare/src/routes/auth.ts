/**
 * Auth routes (ported from app/api/routers/auth.py): signup, login, logout, me.
 */
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { getUserByEmail, createUser } from "../db/users";
import { verifyPassword } from "../auth/password";
import { createAccessToken, buildAuthCookie, clearAuthCookie } from "../auth/jwt";
import { requireUser, optionalUser, fromAdminConsole, ADMIN_CONSOLE_URL } from "../auth/middleware";
import { getTokenFromRequest } from "../auth/jwt";

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
  // Accounts are made in the app; the console only signs admins in.
  if (fromAdminConsole(c)) return c.json({ detail: "Accounts are created in the Heritage app." }, 403);
  const existing = await getUserByEmail(c.env, body.email);
  if (existing?.role === "admin") {
    return c.json({ detail: "This email belongs to an admin account. Use a different email for the app." }, 400);
  }
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

  // Admins use the console; everyone else uses the app. Checked after the
  // password so the answer reveals nothing about an address to a stranger.
  const console_ = fromAdminConsole(c);
  if (user.role === "admin" && !console_) {
    return c.json({ detail: "Admin accounts sign in to the admin console.", admin_console: `${ADMIN_CONSOLE_URL}/auth` }, 403);
  }
  if (user.role !== "admin" && console_) {
    return c.json({ detail: "This account isn't an admin.", app: "https://heritage-rag.heritage-app.workers.dev/" }, 403);
  }

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

// Session probe for guest-aware pages: always 200 so an unsigned visitor
// doesn't log a failed request. { user: {...} | null }
app.get("/session", optionalUser, (c) => {
  const u = c.get("user");
  // A session the app no longer honours (an admin's) is cleared, not kept around.
  if (!u && getTokenFromRequest(c) && !c.req.header("Authorization")) c.header("Set-Cookie", clearAuthCookie());
  return c.json({ user: u ? publicUser(u) : null });
});

export default app;
