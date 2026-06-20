/**
 * User profile routes (ported from /user/me in app/api/routes.py).
 */
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { requireUser } from "../auth/middleware";
import { updateUser, getUserById } from "../db/users";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get("/me", requireUser, (c) => {
  const u = c.get("user")!;
  const isComplete = !!(u.first_name && u.last_name && u.dob);
  return c.json({
    id: u.id,
    email: u.email,
    role: u.role || "member",
    display_name: u.display_name,
    first_name: u.first_name,
    last_name: u.last_name,
    dob: u.dob,
    is_complete: isComplete,
    created_at: u.created_at,
  });
});

app.patch("/me", requireUser, async (c) => {
  const u = c.get("user")!;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const data: Record<string, unknown> = {};
  for (const k of ["first_name", "last_name", "dob"]) {
    if (k in body && body[k] !== undefined) data[k] = body[k];
  }
  if (Object.keys(data).length === 0) {
    return c.json({ detail: "No fields provided for update." }, 400);
  }
  await updateUser(c.env, u.id, data);
  const updated = (await getUserById(c.env, u.id))!;
  return c.json({
    status: "success",
    profile: {
      id: updated.id,
      email: updated.email,
      display_name: updated.display_name,
      first_name: updated.first_name,
      last_name: updated.last_name,
      dob: updated.dob,
    },
  });
});

export default app;
