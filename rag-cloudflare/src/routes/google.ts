/**
 * Google sign-in (OAuth 2.0 authorization code flow), mounted at /api/v1/auth/google.
 *
 *   GET /           → redirect to Google's consent screen (state kept in a short cookie)
 *   GET /callback   → swap the code for an ID token, find or create the user,
 *                     set the usual auth cookie, and go back to the app
 *
 * One button covers sign-in and sign-up: a new Google address gets a member
 * account on first use. Errors return to /auth?error=<code> for the page to explain.
 * Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET; without them the routes say
 * so and /auth/providers reports Google as off, which hides the button.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, Variables } from "../types";
import { getUserByEmail, createUser } from "../db/users";
import { createAccessToken, buildAuthCookie } from "../auth/jwt";
import { isConsoleRole } from "../auth/middleware";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const STATE_COOKIE = "g_state";
const STATE_PATH = "/api/v1/auth/google";

export function googleEnabled(env: Env): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/** The callback lives on whichever host started the sign-in (app.speakga.org, workers.dev, localhost). */
function callbackUrl(reqUrl: string): string {
  const u = new URL(reqUrl);
  return `${u.origin}${STATE_PATH}/callback`;
}

function back(c: Context, error?: string): Response {
  return c.redirect(error ? `/auth?error=${encodeURIComponent(error)}` : "/", 302);
}

app.get("/", (c) => {
  if (!googleEnabled(c.env)) return back(c, "google_unavailable");
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID!,
    redirect_uri: callbackUrl(c.req.url),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  c.header("Set-Cookie", `${STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=${STATE_PATH}; Max-Age=600`);
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
});

type GoogleClaims = {
  iss?: string; aud?: string; exp?: number;
  email?: string; email_verified?: boolean | string; name?: string; given_name?: string;
};

/** Decode the ID token's claims. It came straight from Google's token endpoint over TLS,
 *  so per OpenID Connect the signature check can be skipped; the claims are still validated. */
function readIdToken(idToken: string): GoogleClaims | null {
  try {
    const part = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(Uint8Array.from(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "=")), (ch) => ch.charCodeAt(0)));
    return JSON.parse(json) as GoogleClaims;
  } catch {
    return null;
  }
}

app.get("/callback", async (c) => {
  // The state cookie is single-use: clear it whatever happens next.
  c.header("Set-Cookie", `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=${STATE_PATH}; Max-Age=0`);
  if (!googleEnabled(c.env)) return back(c, "google_unavailable");

  const url = new URL(c.req.url);
  if (url.searchParams.get("error")) return back(c, "google_cancelled"); // e.g. the person closed the consent screen
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = (c.req.header("Cookie") || "").match(new RegExp(`${STATE_COOKIE}=([^;]+)`))?.[1];
  if (!code || !state || !cookieState || state !== cookieState) return back(c, "google_state");

  let claims: GoogleClaims | null = null;
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: c.env.GOOGLE_CLIENT_ID!,
        client_secret: c.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: callbackUrl(c.req.url),
        grant_type: "authorization_code",
      }),
    });
    const d = await r.json<{ id_token?: string; error?: string }>();
    if (!r.ok || !d.id_token) {
      console.error("Google token exchange failed:", r.status, d.error);
      return back(c, "google_failed");
    }
    claims = readIdToken(d.id_token);
  } catch (e) {
    console.error("Google token exchange error:", e);
    return back(c, "google_failed");
  }

  const verified = claims?.email_verified === true || claims?.email_verified === "true";
  if (
    !claims || !claims.email || !verified ||
    claims.aud !== c.env.GOOGLE_CLIENT_ID ||
    !["https://accounts.google.com", "accounts.google.com"].includes(claims.iss || "") ||
    !claims.exp || claims.exp * 1000 < Date.now()
  ) {
    return back(c, "google_failed");
  }

  let user = await getUserByEmail(c.env, claims.email);
  // Admins sign in to the admin console, same rule as the password sign-in.
  if (user && isConsoleRole(user.role)) return back(c, "admin_console");
  if (!user) {
    // No password is ever shown or needed: a long random one fills the required column.
    const unusable = crypto.randomUUID() + crypto.randomUUID();
    const name = (claims.given_name || claims.name || "").trim();
    user = await createUser(c.env, claims.email, unusable, "member", name);
  }

  const token = await createAccessToken(c.env, user.id, user.role);
  // Set-Cookie for the session goes alongside the state-clearing one.
  c.header("Set-Cookie", buildAuthCookie(c.env, token), { append: true });
  return back(c);
});

export default app;
