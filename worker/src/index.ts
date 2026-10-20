import { RateLimiter } from "../../src/core/rateLimit.js";
import { handle, type Env } from "./handler.js";

// One limiter per isolate. Cloudflare may run several isolates, so limits are advisory; upstream 429s still apply.
const limiter = new RateLimiter();

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cache = (globalThis as unknown as { caches: { default: Cache } }).caches.default;
    return handle(req, env, {
      fetch: (url, init) => fetch(url, init),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      limiter,
      cache: {
        match: async (k) => (await cache.match(new Request(k))) ?? undefined,
        put: (k, res) => cache.put(new Request(k), res),
      },
    });
  },
};
