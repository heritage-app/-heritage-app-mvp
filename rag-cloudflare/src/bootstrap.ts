/**
 * Idempotent super-admin provisioning (mirrors the Python startup behaviour).
 * Runs once per isolate; safe to call on every request.
 */
import type { Env } from "./types";
import { getUserByEmail, createUser, updateUserRole } from "./db/users";

let bootstrapped = false;

export async function bootstrapSuperAdmin(env: Env): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  const email = env.SUPER_ADMIN_EMAIL?.trim();
  const password = env.SUPER_ADMIN_PASSWORD?.trim();
  if (!email || !password) return;

  try {
    const existing = await getUserByEmail(env, email);
    if (existing) {
      if (existing.role !== "admin") await updateUserRole(env, existing.id, "admin");
      return;
    }
    await createUser(env, email, password, "admin", "Super Admin");
  } catch (e) {
    console.error("Super admin bootstrap failed:", e);
  }
}
