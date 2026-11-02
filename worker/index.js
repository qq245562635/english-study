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

// ---------- AI：中译英 / 检查英文 / 朗读 ----------
const CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MT_MODEL = "@cf/meta/m2m100-1.2b";
const TTS_MODEL = "@cf/myshell-ai/melotts";
const MAX_INPUT = 500;

const SCHEMA = {
  type: "object",
  properties: {
    english: { type: "string" },
    alternatives: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "object", properties: { en: { type: "string" }, zh: { type: "string" } }, required: ["en", "zh"] } },
    corrected: { type: "string" },
    feedback: { type: "string" },
  },
};

const PROMPTS = {
  zh2en: `You help a Chinese adult who is learning English to work in the United States. Their level is beginner to lower-intermediate.
Translate the user's Chinese into natural, everyday American English, the way a friendly coworker in the U.S. would say or write it. Keep it simple and clear, and keep the same meaning and tone. If the text looks like part of an email or chat message, write it in that style.
Reply with JSON only:
{"english": "the best translation",
 "alternatives": ["1 or 2 other natural ways to say it (shorter, more casual, or more formal)"],
 "notes": [{"en": "a useful word or phrase from your translation", "zh": "its Chinese meaning and a short tip in Simplified Chinese"}]}
Give 2 to 4 notes. Write every "zh" value in Simplified Chinese.`,
  check: `You are a patient English teacher for a Chinese adult who is learning English to work in the United States. Their level is beginner to lower-intermediate.
The user wrote some English, and may add the Chinese meaning they intended after "意思:". Correct it so it is grammatical and sounds natural in American English, changing as little as needed.
Reply with JSON only:
{"corrected": "the corrected sentence(s); same as the input if it is already good",
 "feedback": "in Simplified Chinese, 1 to 3 short sentences: what was wrong and why, or praise if it was already good",
 "alternatives": ["0 to 2 other natural ways to say it"],
 "notes": [{"en": "a word or phrase that was fixed or is useful", "zh": "explanation in Simplified Chinese"}]}`,
};

function parseModelJson(out) {
  const r = out && out.response !== undefined ? out.response : out;
  if (r && typeof r === "object") return r;
  const text = String(r || "");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no_json");
  return JSON.parse(m[0]);
}

function clean(d, mode) {
  const str = (x) => (typeof x === "string" ? x.trim() : "");
  const arr = (x) => (Array.isArray(x) ? x : []);
  const res = {
    alternatives: arr(d.alternatives).map(str).filter(Boolean).slice(0, 3),
    notes: arr(d.notes).filter((n) => n && str(n.en)).map((n) => ({ en: str(n.en), zh: str(n.zh) })).slice(0, 5),
  };
  if (mode === "zh2en") {
    res.english = str(d.english);
    if (!res.english) throw new Error("empty");
  } else {
    res.corrected = str(d.corrected);
    res.feedback = str(d.feedback);
    if (!res.corrected) throw new Error("empty");
  }
  return res;
}

async function handleAi(request, env, path) {
  if (!env.AI) return json({ error: "ai_not_configured" }, 503);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  const text = String(body.text || "").trim();
  if (!text) return json({ error: "empty" }, 400);
  if (text.length > MAX_INPUT) return json({ error: "too_long", max: MAX_INPUT }, 413);

  if (path === "/api/tts") {
    try {
      const out = await env.AI.run(TTS_MODEL, { prompt: text, lang: "en" });
      const b64 = out && out.audio;
      if (!b64) throw new Error("no_audio");
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return new Response(bin, { headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=86400" } });
    } catch (e) {
      return json({ error: "tts_failed" }, 502);
    }
  }

  const mode = body.mode === "check" ? "check" : "zh2en";
  const user = mode === "check" && body.meaning ? `${text}\n意思: ${String(body.meaning).slice(0, MAX_INPUT)}` : text;
  try {
    const out = await env.AI.run(CHAT_MODEL, {
      messages: [{ role: "system", content: PROMPTS[mode] }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: SCHEMA },
      max_tokens: 800,
      temperature: 0.3,
    });
    return json(clean(parseModelJson(out), mode));
  } catch (e) {
    // 大模型出错时，中译英退回到专门的翻译模型，至少给出一个译文
    if (mode === "zh2en") {
      try {
        const mt = await env.AI.run(MT_MODEL, { text, source_lang: "chinese", target_lang: "english" });
        if (mt && mt.translated_text) return json({ english: mt.translated_text, alternatives: [], notes: [], fallback: true });
      } catch { /* 继续往下 */ }
    }
    return json({ error: "ai_failed" }, 502);
  }
}

async function handleApi(request, env, path) {
  if (path === "/api/ping") {
    return json({ ok: true, configured: !!env.SYNC_TOKEN && !!env.PROGRESS, ai: !!env.AI });
  }
  if (path === "/api/translate" || path === "/api/tts") {
    // 用同步密码保护，避免别人用掉你的免费 AI 额度
    if (!env.SYNC_TOKEN) return json({ error: "not_configured" }, 503);
    if (!(await authorized(request, env))) return json({ error: "unauthorized" }, 401);
    return handleAi(request, env, path);
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
