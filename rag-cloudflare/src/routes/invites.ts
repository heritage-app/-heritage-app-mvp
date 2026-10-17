/**
 * Invite links (mounted at /api/v1/admin/invites and /api/v1/invites):
 *
 *   POST   /           admin mints a link { role, email? } → { url }
 *   GET    /           pending invites for the console's Users page
 *   DELETE /:token     revoke an unused link
 *   GET    /:token     public: validates a link for the signup pages
 *   POST   /:token/accept  public: creates the account with the invited role
 *
 * Admin-role links point at the console's auth page; member/moderator/user
 * links point at the app's — the same split logins already enforce.
 */
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { requireAdmin } from "../auth/middleware";
import { createAccessToken, buildAuthCookie } from "../auth/jwt";
import { getUserByEmail, createUser } from "../db/users";
import { nowIso } from "../utils/time";

const INVITE_ROLES = new Set(["admin", "member", "moderator", "user"]);
const CONSOLE_AUTH_URL = "https://admin.speakga.org/auth";
const APP_AUTH_URL = "https://app.speakga.org/auth";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // a week

export const invitesAdmin = new Hono<{ Bindings: Env; Variables: Variables }>();
export const invitesPublic = new Hono<{ Bindings: Env; Variables: Variables }>();

invitesAdmin.use("*", requireAdmin);

type InviteRow = {
  token: string;
  role: string;
  email: string | null;
  invited_by: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
};

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function inviteUrl(role: string, token: string): string {
  return `${role === "admin" ? CONSOLE_AUTH_URL : APP_AUTH_URL}?invite=${token}`;
}

async function logAction(env: Env, adminId: string, action: string, ref: string, detail: string) {
  try {
    await env.DB.prepare(
      "INSERT INTO admin_actions (at, admin_id, action, ref_kind, ref_id, detail) VALUES (?,?,?,?,?,?)"
    ).bind(nowIso(), adminId, action, "invite", ref, detail.slice(0, 300)).run();
  } catch { /* logging is best-effort */ }
}

async function loadInvite(env: Env, token: string): Promise<InviteRow | null> {
  const inv = await env.DB.prepare("SELECT * FROM invites WHERE token = ?").bind(token).first<InviteRow>();
  if (!inv || inv.used_at) return null;
  if (Date.parse(inv.expires_at) < Date.now()) return null;
  return inv;
}

// --- Admin side: mint, list, revoke -------------------------------------

invitesAdmin.post("/", async (c) => {
  const body = await c.req.json<{ role?: string; email?: string }>().catch(() => ({} as { role?: string; email?: string }));
  const role = INVITE_ROLES.has(body.role ?? "") ? body.role! : "member";
  const email = (body.email ?? "").trim().toLowerCase() || null;
  if (email) {
    if (!/^\S+@\S+\.\S+$/.test(email)) return c.json({ detail: "That email isn't valid." }, 400);
    const existing = await getUserByEmail(c.env, email);
    if (existing) return c.json({ detail: `${email} already has an account — change their role on the Users list instead.` }, 400);
  }

  const token = newToken();
  const expires = new Date(Date.now() + TTL_MS).toISOString();
  await c.env.DB.prepare(
    "INSERT INTO invites (token, role, email, invited_by, created_at, expires_at) VALUES (?,?,?,?,?,?)"
  ).bind(token, role, email, c.get("adminId")!, nowIso(), expires).run();
  await logAction(c.env, c.get("adminId")!, "invite_created", token, `${role} invite${email ? ` for ${email}` : ""}`);
  return c.json({ status: "ok", token, url: inviteUrl(role, token), role, email, expires_at: expires });
});

invitesAdmin.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT i.*, COALESCE(u.display_name, u.email, 'admin') AS who
     FROM invites i LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.used_at IS NULL
     ORDER BY i.created_at DESC LIMIT 100`
  ).all<InviteRow & { who: string }>();
  const now = Date.now();
  return c.json({
    invites: (rows.results ?? []).map((r) => ({
      token: r.token,
      role: r.role,
      email: r.email,
      invited_by: r.who,
      created_at: r.created_at,
      expires_at: r.expires_at,
      expired: Date.parse(r.expires_at) < now,
      url: inviteUrl(r.role, r.token),
    })),
  });
});

invitesAdmin.delete("/:token", async (c) => {
  const token = c.req.param("token");
  const r = await c.env.DB.prepare("DELETE FROM invites WHERE token = ? AND used_at IS NULL").bind(token).run();
  if (!r.meta.changes) return c.json({ detail: "Invite not found or already used." }, 404);
  await logAction(c.env, c.get("adminId")!, "invite_revoked", token, "");
  return c.json({ status: "ok" });
});

// --- Public side: the signup pages --------------------------------------

invitesPublic.get("/:token", async (c) => {
  const inv = await loadInvite(c.env, c.req.param("token"));
  if (!inv) return c.json({ detail: "That invite link is already used or expired. Ask for a fresh one." }, 410);
  let who = "the team";
  if (inv.invited_by) {
    const u = await c.env.DB.prepare("SELECT first_name, display_name, email FROM users WHERE id = ?")
      .bind(inv.invited_by)
      .first<{ first_name: string | null; display_name: string | null; email: string }>();
    who = u?.first_name || u?.display_name || u?.email?.split("@")[0] || "the team";
  }
  return c.json({ status: "ok", role: inv.role, email: inv.email, invited_by: who, expires_at: inv.expires_at });
});

invitesPublic.post("/:token/accept", async (c) => {
  const inv = await loadInvite(c.env, c.req.param("token"));
  if (!inv) return c.json({ detail: "That invite link is already used or expired. Ask for a fresh one." }, 410);

  const body = await c.req.json<{ email?: string; password?: string; name?: string }>().catch(
    () => ({} as { email?: string; password?: string; name?: string })
  );
  const email = (body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!/^\S+@\S+\.\S+$/.test(email)) return c.json({ detail: "Enter a valid email address." }, 400);
  if (inv.email && email !== inv.email)
    return c.json({ detail: `This invite is for ${inv.email} — sign up with that address.` }, 400);
  if (password.length < 8) return c.json({ detail: "Choose a password of at least 8 characters." }, 400);

  const existing = await getUserByEmail(c.env, email);
  if (existing) return c.json({ detail: "That email already has an account — sign in instead." }, 400);

  // Claim the link before the account row goes in, so a double-click or a
  // shared tab can't create two accounts off one invite.
  const claimed = await c.env.DB.prepare("UPDATE invites SET used_at = ? WHERE token = ? AND used_at IS NULL")
    .bind(nowIso(), inv.token)
    .run();
  if (!claimed.meta.changes) return c.json({ detail: "That invite was just used. Ask for a fresh one." }, 410);

  let user;
  try {
    user = await createUser(c.env, email, password, inv.role, String(body.name ?? "").trim());
  } catch (e) {
    // Something raced us (e.g. the email registered mid-request): hand the
    // link back so it isn't silently burned.
    await c.env.DB.prepare("UPDATE invites SET used_at = NULL WHERE token = ?").bind(inv.token).run().catch(() => {});
    throw e;
  }
  await c.env.DB.prepare("UPDATE invites SET used_by = ? WHERE token = ?").bind(user.id, inv.token).run().catch(() => {});

  const token = await createAccessToken(c.env, user.id, user.role);
  c.header("Set-Cookie", buildAuthCookie(c.env, token));
  return c.json({
    access_token: token,
    token_type: "bearer",
    user: { id: user.id, email: user.email, role: user.role, display_name: user.display_name },
  });
});
