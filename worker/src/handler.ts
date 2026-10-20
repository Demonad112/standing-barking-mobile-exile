// Proxy for the official trade2 API. Pure request handler: network, clock, sleep and cache are injected so it can be
// tested without Cloudflare. Upstream paths and behaviour follow PoB2 (MIT) and are UNVERIFIED against the live API.
import { RateLimiter, backoffMs } from "../../src/core/rateLimit.js";

export interface Env {
  /** Exact origin allowed by CORS, e.g. https://poe2-item-search.pages.dev */
  ALLOWED_ORIGIN: string;
  /** Identifying User-Agent sent upstream (GGG asks for contact info). */
  USER_AGENT: string;
}

export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
}

export interface Deps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  limiter: RateLimiter;
  cache?: CacheLike;
}

const UPSTREAM = "https://www.pathofexile.com/api/trade2";
const MAX_WAIT_MS = 8_000;
const MAX_UPSTREAM_ATTEMPTS = 3;
const MAX_BODY = 64 * 1024;
const CACHE_TTL_S = 3600;
const EXPOSED = "retry-after, x-rate-limit-policy, x-rate-limit-rules, x-rate-limit-ip, x-rate-limit-ip-state, x-rate-limit-account, x-rate-limit-account-state, x-proxy-wait";

const SAFE = /^[A-Za-z0-9 _.'()-]{1,64}$/;
const HEX_IDS = /^[0-9a-f]{32,64}(,[0-9a-f]{32,64}){0,9}$/; // length UNVERIFIED for trade2
const QUERY_ID = /^[A-Za-z0-9_-]{1,32}$/;

function cors(env: Env, origin: string | null): Record<string, string> {
  return origin === env.ALLOWED_ORIGIN
    ? { "access-control-allow-origin": origin, "access-control-expose-headers": EXPOSED, vary: "Origin",
        "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, x-poesessid" }
    : {};
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });

const lower = (h: Headers) => { const o: Record<string, string> = {}; h.forEach((v, k) => { o[k.toLowerCase()] = v; }); return o; };

export async function handle(req: Request, env: Env, d: Deps): Promise<Response> {
  const origin = req.headers.get("origin");
  const c = cors(env, origin);
  const reply = (status: number, body: unknown, extra: Record<string, string> = {}) => {
    const r = json(status, body, { ...c, ...extra });
    return r;
  };
  if (origin !== env.ALLOWED_ORIGIN) return json(403, { error: { message: "Origin not allowed" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: c });

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  let upstreamUrl: string, init: RequestInit, policy: string, cacheable = false;

  const headers: Record<string, string> = { "user-agent": env.USER_AGENT, accept: "application/json" };
  const sess = req.headers.get("x-poesessid");
  if (sess) {
    if (!/^[A-Za-z0-9]{8,64}$/.test(sess)) return reply(400, { error: { message: "Bad session id" } });
    headers["cookie"] = `POESESSID=${sess}`; // forwarded only; never logged or stored
  }

  if (req.method === "POST" && parts[0] === "search" && parts.length === 3) {
    const [, realm, league] = parts as [string, string, string];
    if (!/^[a-z0-9]{2,16}$/.test(realm) || !SAFE.test(league)) return reply(400, { error: { message: "Bad realm or league" } });
    const text = await req.text();
    if (text.length > MAX_BODY) return reply(413, { error: { message: "Body too large" } });
    try { JSON.parse(text); } catch { return reply(400, { error: { message: "Body is not JSON" } }); }
    upstreamUrl = `${UPSTREAM}/search/${realm}/${encodeURIComponent(league)}`;
    init = { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: text };
    policy = "trade-search-request-limit";
  } else if (req.method === "GET" && parts[0] === "fetch" && parts.length === 2) {
    const q = url.searchParams.get("query") ?? "";
    if (!HEX_IDS.test(parts[1]!) || !QUERY_ID.test(q)) return reply(400, { error: { message: "Bad ids or query id" } });
    upstreamUrl = `${UPSTREAM}/fetch/${parts[1]}?query=${encodeURIComponent(q)}`;
    init = { method: "GET", headers };
    policy = "trade-fetch-request-limit";
  } else if (req.method === "GET" && ["leagues", "stats", "static"].includes(parts[0] ?? "") && parts.length === 1) {
    upstreamUrl = `${UPSTREAM}/data/${parts[0]}`;
    init = { method: "GET", headers };
    policy = "trade-data-request-limit";
    cacheable = true;
  } else return reply(404, { error: { message: "Not found" } });

  // Static data: serve from cache (never cached when a session cookie is involved).
  const cacheKey = `https://cache.invalid/${parts[0]}`;
  if (cacheable && !sess && d.cache) {
    const hit = await d.cache.match(cacheKey);
    if (hit) return new Response(hit.body, { status: hit.status, headers: { "content-type": "application/json", ...c, "x-proxy-cache": "hit" } });
  }

  for (let attempt = 1; ; attempt++) {
    const wait = d.limiter.waitMs(policy);
    if (wait > MAX_WAIT_MS) {
      return reply(429, { error: { message: "Proxy rate limit; retry later" } }, { "retry-after": String(Math.ceil(wait / 1000)), "x-proxy-wait": String(wait) });
    }
    if (wait > 0) await d.sleep(wait);
    d.limiter.record(policy);
    const up = await d.fetch(upstreamUrl, init);
    const uh = lower(up.headers);
    d.limiter.update(policy, uh);

    if (up.status === 429) {
      const ms = backoffMs(attempt, Number(uh["retry-after"] ?? 0));
      if (attempt >= MAX_UPSTREAM_ATTEMPTS || ms > MAX_WAIT_MS) {
        return reply(429, { error: { message: "Upstream rate limit" } }, { "retry-after": String(Math.ceil(ms / 1000)) });
      }
      await d.sleep(ms);
      continue;
    }
    const pass: Record<string, string> = {};
    for (const k of Object.keys(uh)) if (k.startsWith("x-rate-limit") || k === "retry-after") pass[k] = uh[k]!;
    const bodyText = await up.text();
    if (cacheable && !sess && d.cache && up.ok) {
      await d.cache.put(cacheKey, new Response(bodyText, { status: 200, headers: { "content-type": "application/json", "cache-control": `public, max-age=${CACHE_TTL_S}` } }));
    }
    return new Response(bodyText, { status: up.status, headers: { "content-type": "application/json", ...c, ...pass } });
  }
}
