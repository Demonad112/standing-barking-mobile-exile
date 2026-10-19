import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/core/rateLimit.js";
import { handle, type CacheLike, type Deps, type Env } from "../worker/src/handler.js";

const env: Env = { ALLOWED_ORIGIN: "https://app.example", USER_AGENT: "test-agent/1.0" };
const ID = "a".repeat(64);

function setup(responses: Array<() => Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const sleeps: number[] = [];
  const store = new Map<string, Response>();
  const cache: CacheLike = { match: async (k) => store.get(k)?.clone(), put: async (k, r) => { store.set(k, r.clone()); } };
  const deps: Deps = {
    fetch: async (url, init) => { calls.push({ url, init }); return (responses.shift() ?? (() => new Response("{}")))(); },
    sleep: async (ms) => { sleeps.push(ms); },
    limiter: new RateLimiter(),
    cache,
  };
  return { deps, calls, sleeps };
}
const req = (path: string, init: RequestInit & { origin?: string } = {}) =>
  new Request(`https://proxy.example${path}`, { ...init, headers: { origin: init.origin ?? "https://app.example", ...(init.headers as object) } });

describe("worker proxy", () => {
  it("rejects other origins and answers preflight for ours", async () => {
    const s = setup([]);
    expect((await handle(req("/leagues", { origin: "https://evil.example" }), env, s.deps)).status).toBe(403);
    const pre = await handle(req("/search/poe2/Standard", { method: "OPTIONS" }), env, s.deps);
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(s.calls).toHaveLength(0);
  });
  it("forwards search with User-Agent and no cookie by default", async () => {
    const s = setup([() => new Response(JSON.stringify({ id: "q", total: 1, result: [ID] }))]);
    const r = await handle(req("/search/poe2/Rise%20of%20the%20Abyssal", { method: "POST", body: JSON.stringify({ query: {} }) }), env, s.deps);
    expect(r.status).toBe(200);
    expect(s.calls[0]!.url).toBe("https://www.pathofexile.com/api/trade2/search/poe2/Rise%20of%20the%20Abyssal");
    const h = s.calls[0]!.init.headers as Record<string, string>;
    expect(h["user-agent"]).toBe("test-agent/1.0");
    expect(h["cookie"]).toBeUndefined();
  });
  it("forwards a session cookie only when supplied", async () => {
    const s = setup([() => new Response("{}")]);
    await handle(req("/search/poe2/Standard", { method: "POST", body: "{}", headers: { "x-poesessid": "abcdef0123456789" } }), env, s.deps);
    expect((s.calls[0]!.init.headers as Record<string, string>)["cookie"]).toBe("POESESSID=abcdef0123456789");
  });
  it("validates inputs", async () => {
    const s = setup([]);
    expect((await handle(req("/fetch/zzz?query=abc"), env, s.deps)).status).toBe(400);
    expect((await handle(req(`/fetch/${ID}?query=../x`), env, s.deps)).status).toBe(400);
    expect((await handle(req("/search/poe2/Standard", { method: "POST", body: "not json" }), env, s.deps)).status).toBe(400);
    expect((await handle(req("/nope"), env, s.deps)).status).toBe(404);
    expect(s.calls).toHaveLength(0);
  });
  it("passes rate-limit headers through", async () => {
    const s = setup([() => new Response("{}", { headers: { "x-rate-limit-rules": "ip", "x-rate-limit-ip": "8:10:60" } })]);
    const r = await handle(req(`/fetch/${ID}?query=abc`), env, s.deps);
    expect(r.headers.get("x-rate-limit-ip")).toBe("8:10:60");
  });
  it("retries upstream 429 with 2^n backoff then succeeds", async () => {
    const s = setup([() => new Response("{}", { status: 429 }), () => new Response("{}", { status: 429 }), () => new Response('{"ok":1}')]);
    const r = await handle(req(`/fetch/${ID}?query=abc`), env, s.deps);
    expect(r.status).toBe(200);
    expect(s.sleeps).toEqual([2000, 4000]);
  });
  it("passes a long Retry-After back to the client instead of sleeping", async () => {
    const s = setup([() => new Response("{}", { status: 429, headers: { "retry-after": "30" } })]);
    const r = await handle(req(`/fetch/${ID}?query=abc`), env, s.deps);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("30");
    expect(s.sleeps).toEqual([]);
  });
  it("returns 429 when the local limiter needs a long wait", async () => {
    const s = setup([() => new Response("{}", { headers: { "x-rate-limit-rules": "ip", "x-rate-limit-ip": "2:60:60" } })]);
    await handle(req(`/fetch/${ID}?query=abc`), env, s.deps);
    const r = await handle(req(`/fetch/${ID}?query=abc`), env, s.deps);
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(8);
  });
  it("caches static data", async () => {
    const s = setup([() => new Response('{"result":[1]}')]);
    const a = await handle(req("/leagues"), env, s.deps);
    const b = await handle(req("/leagues"), env, s.deps);
    expect(await a.json()).toEqual({ result: [1] });
    expect(b.headers.get("x-proxy-cache")).toBe("hit");
    expect(s.calls).toHaveLength(1);
  });
});
