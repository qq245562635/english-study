// Cloudflare Worker：提供网页文件，并在 /api/progress 保存学习记录（存在 KV 里）。
import "../merge.js";

const merge = globalThis.mergeProgress;
const KEY = "progress";
const MAX_BYTES = 2_000_000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return new Uint8Array(buf);
}

// 比较密码时用哈希后的等长比较，避免通过响应时间猜密码
async function authorized(request, env) {
  const got = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!got || !env.SYNC_TOKEN) return false;
  const [a, b] = await Promise.all([sha256(got), sha256(env.SYNC_TOKEN)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function handleApi(request, env, path) {
  if (path === "/api/ping") {
    return json({ ok: true, configured: !!env.SYNC_TOKEN && !!env.PROGRESS });
  }
  if (path !== "/api/progress") return json({ error: "not_found" }, 404);
  if (!env.SYNC_TOKEN || !env.PROGRESS) return json({ error: "not_configured" }, 503);
  if (!(await authorized(request, env))) return json({ error: "unauthorized" }, 401);

  if (request.method === "GET") {
    const stored = await env.PROGRESS.get(KEY, "json");
    return json(stored || {});
  }
  if (request.method === "PUT") {
    const text = await request.text();
    if (text.length > MAX_BYTES) return json({ error: "too_large" }, 413);
    let incoming;
    try { incoming = JSON.parse(text); } catch { return json({ error: "bad_json" }, 400); }
    const stored = (await env.PROGRESS.get(KEY, "json")) || {};
    const merged = merge(stored, incoming);
    merged.updatedAt = Date.now();
    await env.PROGRESS.put(KEY, JSON.stringify(merged));
    return json(merged);
  }
  if (request.method === "DELETE") {
    await env.PROGRESS.delete(KEY);
    return json({ ok: true });
  }
  return json({ error: "method_not_allowed" }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url.pathname);
    return env.ASSETS.fetch(request);
  },
};
