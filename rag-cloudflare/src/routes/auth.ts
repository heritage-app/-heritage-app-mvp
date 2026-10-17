/**
 * Auth routes (ported from app/api/routers/auth.py): signup, login, logout, me.
 */
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { getUserByEmail, createUser } from "../db/users";
import { verifyPassword } from "../auth/password";
import { createAccessToken, buildAuthCookie, clearAuthCookie } from "../auth/jwt";
import { requireUser, optionalUser, fromAdminConsole, fromApiHost, isConsoleRole, ADMIN_CONSOLE_URL } from "../auth/middleware";
import { getTokenFromRequest } from "../auth/jwt";
import google, { googleEnabled } from "./google";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Google sign-in / sign-up, and which providers the sign-in page should offer.
app.route("/google", google);
app.get("/providers", (c) => c.json({ google: googleEnabled(c.env) }));

function publicUser(u: { id: string; email: string; role: string; display_name: string | null }) {
  return { id: u.id, email: u.email, role: u.role, display_name: u.display_name };
}

type Credentials = { email?: string; password?: string };

app.post("/signup", async (c) => {
  const body = await c.req.json<Credentials>().catch(() => ({} as Credentials));
  if (!body.email || !body.password) {
    return c.json({ detail: "Email and password are required" }, 400);
  }
  if (body.password.length < 8) return c.json({ detail: "Choose a password of at least 8 characters." }, 400);
  if (!/^\S+@\S+\.\S+$/.test(body.email.trim())) return c.json({ detail: "Enter a valid email address." }, 400);
  // Accounts are made in the app; the console only signs admins in.
  if (fromAdminConsole(c)) return c.json({ detail: "Accounts are created in the SpeakGa app." }, 403);
  const existing = await getUserByEmail(c.env, body.email);
  if (existing && isConsoleRole(existing.role)) {
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
  if (user.status === "suspended") return c.json({ detail: "Your account has been suspended. Contact the SpeakGa team." }, 403);

  // Admins use the console; everyone else uses the app. Checked after the
  // password so the answer reveals nothing about an address to a stranger.
  const console_ = fromAdminConsole(c);
  // api.speakga.org is for token clients (scripts), not the app: admins may sign in there.
  if (isConsoleRole(user.role) && !console_ && !fromApiHost(c)) {
    return c.json({ detail: "Admin accounts sign in to the admin console.", admin_console: `${ADMIN_CONSOLE_URL}/auth` }, 403);
  }
  if (!isConsoleRole(user.role) && console_) {
    return c.json({ detail: "This account isn't an admin.", app: "https://app.speakga.org/" }, 403);
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
