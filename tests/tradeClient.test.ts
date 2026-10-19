import { describe, expect, it } from "vitest";
import { buildQuery } from "../src/core/tradeQuery.js";
import { RateLimiter, backoffMs, parseRateHeaders } from "../src/core/rateLimit.js";
import { mergeRates, toExalted, type RatesTable } from "../src/core/rates.js";
import { scoreListing, searchAdaptive, sortListings, statHash, TradeError, type ClientDeps } from "../src/core/tradeClient.js";
import { index } from "./helpers.js";
import { mockTrade, type MockListing } from "./mockTrade.js";

const stat = (text: string) => { const id = index.all.find((e) => e.text === text)!.ids["explicit"]!; return id; };
const ids = { life: stat("# to maximum Life"), fire: stat("#% to Fire Resistance"), cold: stat("#% to Cold Resistance") };

const weights = new Map([[ids.life, 0.84], [ids.fire, 2.2], [ids.cold, 2.2]]);
const mk = (n: number): MockListing[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `L${i}`,
    price: { amount: 1 + (i % 7), currency: i % 5 === 0 ? "divine" : "exalted" },
    mods: [
      { id: ids.life, roll: 20 + (i * 7) % 100, text: (r) => `+${r} to maximum Life` },
      { id: ids.fire, roll: 5 + (i * 3) % 40, text: (r) => `+${r}% to Fire Resistance` },
      ...(i % 2 ? [{ id: ids.cold, roll: 5 + (i * 11) % 40, text: (r: number) => `+${r}% to Cold Resistance` }] : []),
    ],
  }));

const body = (min: number) => buildQuery([...weights].map(([id, weight]) => ({ id, weight })), { league: "Test", category: "accessory.ring", minScore: min }).body;
const deps = (transport: ClientDeps["transport"], sleeps: number[] = []): ClientDeps => ({ transport, sleep: async (ms) => { sleeps.push(ms); } });
const wmap = new Map([...weights].map(([id, w]) => [statHash(id), w]));
const rates: RatesTable = { rates: { divine: 100 }, asOf: 1_700_000_000_000, source: "test" };

describe("score recomputation", () => {
  it("listing score equals sum(weight * roll) computed independently from the displayed text", async () => {
    const m = mockTrade({ market: mk(60) });
    const out = await searchAdaptive(deps(m.transport), { league: "Test", buildBody: body, initialMinScore: 100, target: 20 });
    expect(out.raw.length).toBe(20);
    const textWeights: Array<[RegExp, number]> = [[/to maximum Life/, 0.84], [/Fire Resistance/, 2.2], [/Cold Resistance/, 2.2]];
    for (const r of out.raw) {
      const l = scoreListing(r, wmap, index, "Rings", rates, "ratio");
      let expected = 0;
      for (const line of r.item.explicitMods!) {
        const num = Number(/(\d+)/.exec(line)![1]);
        expected += textWeights.find(([re]) => re.test(line))![1] * num;
      }
      expect(l.score).toBeCloseTo(expected, 9);
      expect(l.breakdown.reduce((a, b) => a + b.contribution, 0)).toBeCloseTo(l.score, 9);
      expect(l.serverScore).toBeDefined();
      expect(Math.abs(l.serverScore! - l.score)).toBeLessThanOrEqual(0.1);
    }
  });
});

describe("429 handling", () => {
  it("backs off 2s, 4s then succeeds", async () => {
    const sleeps: number[] = [];
    const m = mockTrade({ market: mk(30), failFirst: [{ status: 429 }, { status: 429 }] });
    const out = await searchAdaptive(deps(m.transport, sleeps), { league: "Test", buildBody: body, initialMinScore: 50, target: 5 });
    expect(out.raw.length).toBe(5);
    expect(sleeps.slice(0, 2)).toEqual([2000, 4000]);
  });
  it("honours Retry-After above the backoff and caps backoff at 60s", () => {
    expect(backoffMs(1, 30)).toBe(30_000);
    expect(backoffMs(10)).toBe(60_000);
  });
  it("gives up after repeated 429s with a TradeError", async () => {
    const m = mockTrade({ market: mk(5), failFirst: Array.from({ length: 10 }, () => ({ status: 429 })) });
    await expect(searchAdaptive(deps(m.transport), { league: "Test", buildBody: body, initialMinScore: 1 })).rejects.toBeInstanceOf(TradeError);
  });
});

describe("adaptive threshold", () => {
  it("raises min score when results exceed the cap", async () => {
    const m = mockTrade({ market: mk(300) });
    const out = await searchAdaptive(deps(m.transport), { league: "Test", buildBody: body, initialMinScore: 0, cap: 100, target: 10 });
    expect(out.attempts).toBeGreaterThan(1);
    expect(out.finalMinScore).toBeGreaterThan(0);
    expect(out.total).toBeLessThan(100);
    const mins = m.log.filter((l) => l.method === "POST").map((l) => l.min!);
    expect(mins[mins.length - 1]).toBeGreaterThan(mins[0]!);
  });
  it("lowers min score when too few results", async () => {
    const m = mockTrade({ market: mk(300) });
    const out = await searchAdaptive(deps(m.transport), { league: "Test", buildBody: body, initialMinScore: 1000, target: 10 });
    expect(out.finalMinScore).toBeLessThan(1000);
    expect(out.raw.length).toBeGreaterThan(0);
  });
  it("stops at the recursion cap and reports no matches", async () => {
    const m = mockTrade({ market: mk(10) });
    const out = await searchAdaptive(deps(m.transport), { league: "Test", buildBody: body, initialMinScore: 1e9, target: 10, maxRecursion: 3 });
    expect(out.attempts).toBe(3);
    expect(out.raw).toEqual([]);
    expect(out.warnings.join()).toMatch(/No matching/);
  });
});

describe("rates and sorting", () => {
  it("converts prices and leaves value undefined without a rate", async () => {
    const m = mockTrade({ market: mk(40) });
    const out = await searchAdaptive(deps(m.transport), { league: "Test", buildBody: body, initialMinScore: 50, target: 20 });
    const withRates = out.raw.map((r) => scoreListing(r, wmap, index, "Rings", rates, "ratio"));
    const without = out.raw.map((r) => scoreListing(r, wmap, index, "Rings", undefined, "ratio"));
    expect(withRates.every((l) => l.value !== undefined)).toBe(true);
    const div = without.filter((l) => l.price?.currency === "divine");
    expect(div.length).toBeGreaterThan(0);
    expect(div.every((l) => l.value === undefined && l.priceExalted === undefined)).toBe(true);
    const sorted = sortListings(without, "value");
    const firstMissing = sorted.findIndex((l) => l.value === undefined);
    expect(sorted.slice(firstMissing).every((l) => l.value === undefined)).toBe(true);
    const byPrice = sortListings(without, "price");
    expect(byPrice[byPrice.length - 1]!.priceExalted).toBeUndefined();
  });
  it("sorts by value, score and price", async () => {
    const m = mockTrade({ market: mk(40) });
    const out = await searchAdaptive(deps(m.transport), { league: "Test", buildBody: body, initialMinScore: 50, target: 20 });
    const ls = out.raw.map((r) => scoreListing(r, wmap, index, "Rings", rates, "ratio"));
    const v = sortListings(ls, "value").map((l) => l.value!);
    expect(v).toEqual([...v].sort((a, b) => b - a));
    const s = sortListings(ls, "score").map((l) => l.score);
    expect(s).toEqual([...s].sort((a, b) => b - a));
    const p = sortListings(ls, "price").map((l) => l.priceExalted!);
    expect(p).toEqual([...p].sort((a, b) => a - b));
  });
  it("pob mode needs a divine rate", () => {
    const raw = { id: "x", listing: { price: { amount: 5, currency: "exalted" } }, item: { explicitMods: ["+50 to maximum Life"] } };
    expect(scoreListing(raw, wmap, index, "Rings", { rates: {}, asOf: 0, source: "t" }, "pob").value).toBeUndefined();
    expect(scoreListing(raw, wmap, index, "Rings", rates, "pob").value).toBeCloseTo(0.84 * 50 - 0.1 * Math.log10(5 / 100));
  });
  it("merges providers by priority and stamps the oldest time", () => {
    const m = mergeRates([{ rates: { divine: 90 }, asOf: 5, source: "a" }, { rates: { divine: 100, chaos: 0.5 }, asOf: 3, source: "b" }]);
    expect(m).toEqual({ rates: { divine: 90, chaos: 0.5 }, asOf: 3, source: "a + b" });
    expect(toExalted({ amount: 2, currency: "divine" }, m)).toBe(180);
  });
});

describe("rate limiter", () => {
  it("parses PoB-style headers", () => {
    const p = parseRateHeaders({ "x-rate-limit-policy": "trade-search-request-limit", "x-rate-limit-rules": "Ip,Account", "x-rate-limit-ip": "8:10:60,15:60:120", "x-rate-limit-ip-state": "1:10:0", "x-rate-limit-account": "3:5:60", "retry-after": "7" });
    expect(p.name).toBe("trade-search-request-limit");
    expect(p.rules["ip"]!.limits).toEqual([{ requests: 8, window: 10, timeout: 60 }, { requests: 15, window: 60, timeout: 120 }]);
    expect(p.rules["account"]!.limits[0]).toEqual({ requests: 3, window: 5, timeout: 60 });
    expect(p.retryAfter).toBe(7);
  });
  it("waits once the window is full, keeping one request of headroom", () => {
    let t = 0;
    const l = new RateLimiter(1, () => t);
    l.update("p", { "x-rate-limit-rules": "ip", "x-rate-limit-ip": "3:10:60" });
    expect(l.waitMs("p")).toBe(0);
    l.record("p"); t = 1000; l.record("p");
    expect(l.waitMs("p")).toBe(9000); // cap = 2; oldest request leaves the 10s window at t=10000
    t = 10_001;
    expect(l.waitMs("p")).toBe(0);
  });
  it("adopts higher server-side usage from the state header", () => {
    let t = 0;
    const l = new RateLimiter(1, () => t);
    l.update("p", { "x-rate-limit-rules": "ip", "x-rate-limit-ip": "3:10:60", "x-rate-limit-ip-state": "2:10:0" });
    expect(l.waitMs("p")).toBe(10_000);
  });
  it("client sleeps for the limiter before the next call", async () => {
    const sleeps: number[] = [];
    const m = mockTrade({ market: mk(30), headers: { "x-rate-limit-rules": "ip", "x-rate-limit-ip": "2:10:60" } });
    let t = 0;
    const d: ClientDeps = { transport: m.transport, sleep: async (ms) => { sleeps.push(ms); t += ms; }, limiter: new RateLimiter(1, () => t) };
    await searchAdaptive(d, { league: "Test", buildBody: body, initialMinScore: 1000, target: 10 });
    expect(sleeps.some((s) => s > 0)).toBe(true);
  });
});
