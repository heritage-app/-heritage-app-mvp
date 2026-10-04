/**
 * heritage-admin — standalone admin console.
 *
 * Serves the admin/auth static UI via Workers Assets and forwards /api/*
 * to the heritage-rag API worker through a service binding (worker-to-worker,
 * no public network). Because the browser only talks to this origin, the
 * HttpOnly session cookie is set on this subdomain and works unchanged.
 */

// Service binding surface — matches @cloudflare/workers-types `Fetcher`.
interface ServiceBinding {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  API: ServiceBinding;
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

    // Root → admin console (the page itself gates on /auth/me and bounces to /auth).
    if (url.pathname === "/") {
      return Response.redirect(url.origin + "/admin.html", 302);
    }

    // Anything that isn't a served asset isn't part of this app.
    return new Response("Not found", { status: 404 });
  },
};
