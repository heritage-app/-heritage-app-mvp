/**
 * heritage-admin — standalone admin console.
 *
 * Serves the admin/auth static UI via Workers Assets and forwards /api/*
 * to the heritage-rag API worker through a service binding (worker-to-worker,
 * no public network). Because the browser only talks to this origin, the
 * HttpOnly session cookie is set on this subdomain and works unchanged.
 *
 * The console page is gated here, not in the page's script: a visitor without
 * an admin session is redirected to the sign-in before the console HTML is
 * ever served. The sign-in page does the reverse — a signed-in admin goes
 * straight to the console.
 */

// Service binding surface — matches @cloudflare/workers-types `Fetcher`.
interface ServiceBinding {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  API: ServiceBinding;
  ASSETS: ServiceBinding;
}

interface SessionUser {
  role?: string;
}

/** Ask the API who this cookie belongs to. Null = signed out or check failed. */
async function whoami(request: Request, env: Env, origin: string): Promise<SessionUser | null> {
  try {
    const res = await env.API.fetch(new Request(new URL("/api/v1/auth/session", origin), request));
    if (!res.ok) return null;
    const j = (await res.json()) as { user?: SessionUser };
    return j?.user ?? null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Worker-to-worker forward for all API traffic — path, method, body,
    // cookies and auth headers all pass through untouched.
    if (url.pathname.startsWith("/api/")) {
      try {
        return await env.API.fetch(request);
      } catch (e) {
        return new Response(JSON.stringify({ detail: "API upstream unreachable" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // The console itself: admins only. Everyone else gets the sign-in —
    // they should see it, not the console chrome.
    if (url.pathname === "/" || url.pathname === "/admin" || url.pathname === "/admin.html") {
      const me = await whoami(request, env, url.origin);
      if (!me) return Response.redirect(url.origin + "/auth", 302);
      if (me.role !== "admin") return Response.redirect(url.origin + "/auth?denied=1", 302);
      if (url.pathname === "/") return Response.redirect(url.origin + "/admin", 302);
      // Fetch the canonical pretty path — the binding 307s *.html → /admin,
      // which would loop back through this gate.
      return env.ASSETS.fetch(new Request(url.origin + "/admin", request));
    }

    // The sign-in page: a signed-in admin has no business here.
    if (url.pathname === "/auth" || url.pathname === "/auth.html") {
      const me = await whoami(request, env, url.origin);
      if (me?.role === "admin") return Response.redirect(url.origin + "/admin", 302);
      return env.ASSETS.fetch(new Request(url.origin + "/auth", request));
    }

    // Anything else: let the assets binding try it (images, favicons, etc.).
    return env.ASSETS.fetch(request);
  },
};
