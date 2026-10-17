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

/**
 * Send the invite link through Resend (REST, not the npm package — a fetch is
 * all the API needs and keeps the Worker dependency-free). Returns an error
 * string, or null on success / when no key is configured.
 */
async function sendInviteEmail(
  env: Env,
  email: string,
  role: string,
  url: string,
  inviterName: string
): Promise<string | null> {
  if (!env.RESEND_API_KEY) return "Resend isn't configured yet — share the link yourself.";
  const from = env.INVITE_EMAIL_FROM || "SpeakGa <invite@mail.speakga.org>";
  const isAdmin = role === "admin";
  const subject = isAdmin ? "You're invited to the SpeakGa admin team" : "You're invited to SpeakGa";
  const what = isAdmin ? "the SpeakGa admin team" : "SpeakGa";
  const where = isAdmin
    ? "It takes you to the admin console's sign-in page — set your password there and you're in."
    : "It takes you to the SpeakGa sign-up page — set your password there and you're in.";
  const text = `${inviterName} invited you to ${what}. Open this link within 7 days: ${url}`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#FBF7F1;font-family:'Plus Jakarta Sans',Inter,system-ui,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF7F1;padding:40px 16px"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#FFFFFF;border:1px solid #E9DFD0;border-radius:18px;overflow:hidden">
  <tr><td style="background:#16130F;padding:22px 28px">
    <span style="font:800 13px system-ui,sans-serif;letter-spacing:.14em;color:#F2B33D;text-transform:uppercase">SpeakGa</span>
  </td></tr>
  <tr><td style="padding:32px 28px 28px">
    <h1 style="margin:0 0 12px;font:800 26px/1.2 system-ui,sans-serif;color:#16130F;letter-spacing:-.02em">You're invited.</h1>
    <p style="margin:0 0 6px;font:500 15px/1.6 system-ui,sans-serif;color:#52493D"><b>${inviterName}</b> invited you to <b>${what}</b>${isAdmin ? " — as an <b>admin</b>" : ""}.</p>
    <p style="margin:0 0 26px;font:500 15px/1.6 system-ui,sans-serif;color:#52493D">${where}</p>
    <p style="margin:0 0 26px;text-align:center">
      <a href="${url}" style="display:inline-block;background:#16130F;color:#FBF7F1;text-decoration:none;font:700 15px system-ui,sans-serif;padding:14px 34px;border-radius:999px">Accept the invite</a>
    </p>
    <p style="margin:0;font:500 13px/1.6 system-ui,sans-serif;color:#8A7F70">The link works once and expires in 7 days. If the button doesn't open, paste this into your browser:<br>
      <a href="${url}" style="color:#7A5200;word-break:break-all">${url}</a>
    </p>
  </td></tr>
  <tr><td style="padding:16px 28px;border-top:1px solid #E9DFD0">
    <p style="margin:0;font:500 12px system-ui,sans-serif;color:#A99D8B">SpeakGa · Codetrain Foundation · Learn Ga, translate English, preserve heritage.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject, html, text }),
    });
    if (res.ok) return null;
    const d = (await res.json().catch(() => ({}))) as { message?: string };
    return d.message || `Resend returned ${res.status}`;
  } catch (e) {
    return String(e).slice(0, 200);
  }
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

  // An emailed invite is still usable if the send fails — the link just needs
  // sharing by hand. Report both so the console can say which it was.
  const adminUser = c.get("user");
  const inviterName = adminUser?.first_name || adminUser?.display_name || adminUser?.email?.split("@")[0] || "Someone";
  const url = inviteUrl(role, token);
  const emailError = email ? await sendInviteEmail(c.env, email, role, url, inviterName) : null;
  return c.json({
    status: "ok",
    token,
    url,
    role,
    email,
    expires_at: expires,
    emailed: !!(email && !emailError),
    email_error: emailError,
  });
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
