/**
 * Cloudflare Pages Function - Generic proxy for /api/* to an upstream backend.
 *
 * Usage on Cloudflare Pages:
 * - Create an environment variable: UPSTREAM_API_BASE
 *   Example value:
 *     - Quick Tunnel (backend local via cloudflared): https://abc123.trycloudflare.com
 *     - Any external HTTPS backend: https://api.example.com
 *
 * Requests pattern:
 *   /api/flight   -> ${UPSTREAM_API_BASE}/flight
 *   /api/reservar -> ${UPSTREAM_API_BASE}/reservar
 *   /api/...      -> ${UPSTREAM_API_BASE}/...
 *
 * The function preserves method, headers, body, and query string.
 */
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const upstreamBase = env.UPSTREAM_API_BASE;
  if (!upstreamBase) {
    return new Response(JSON.stringify({
      error: "Missing UPSTREAM_API_BASE environment variable",
      hint: "Set it in Cloudflare Pages -> Settings -> Environment Variables. Example: https://abc123.trycloudflare.com"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Strip the /api prefix and join with upstream base
  const upstreamPath = url.pathname.replace(/^\/api/, "");
  const base = upstreamBase.replace(/\/+$/, "");
  const upstreamUrl = new URL(base + upstreamPath);
  upstreamUrl.search = url.search;

  // Clone headers and drop host (Cloudflare/Worker will set it)
  const headers = new Headers(request.headers);
  headers.delete("host");

  // Build fetch init preserving method/body
  const init = {
    method: request.method,
    headers,
    redirect: "follow",
  };

  // Forward body only for methods that may carry a payload
  if (!["GET", "HEAD"].includes(request.method)) {
    init.body = request.body;
  }

  try {
    const res = await fetch(upstreamUrl.toString(), init);

    // Return upstream response as-is (streaming)
    return new Response(res.body, {
      status: res.status,
      headers: res.headers,
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: "UPSTREAM_FETCH_ERROR",
      upstream: upstreamUrl.toString(),
      details: String(err && err.message ? err.message : err),
    }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
