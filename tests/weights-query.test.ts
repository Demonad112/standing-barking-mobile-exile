import { describe, expect, it } from "vitest";
import { buildQuery, categoryFor, tradeUrl, tradeUrlPob, COMPLEXITY_LIMIT } from "../src/core/tradeQuery.js";
import { rollOf, score, value } from "../src/core/scoring.js";
import { normalizedWeight, resolveWeight } from "../src/core/weights.js";

describe("weights", () => {
  it("normalizes to 100 / maxRoll", () => expect(normalizedWeight([10, 119])).toBeCloseTo(100 / 119));
  it("is undefined without a range", () => expect(normalizedWeight(undefined)).toBeUndefined());
  it("labels sources", () => {
    const base = { skeleton: "# to maximum life", range: [10, 119] as [number, number], slotKeys: ["Ring"] };
    expect(resolveWeight(base)).toMatchObject({ source: "normalized" });
    expect(resolveWeight({ ...base, role: "tank" })).toMatchObject({ source: "profile", value: (100 / 119) * 1.5 });
    expect(resolveWeight({ ...base, role: "tank", manual: 3 })).toEqual({ value: 3, source: "manual" });
    expect(resolveWeight({ ...base, range: undefined })).toBeUndefined();
  });
  it("applies slot-restricted rules only on that slot", () => {
    const b = { skeleton: "#% increased movement speed", range: [10, 35] as [number, number], role: "attack" };
    expect(resolveWeight({ ...b, slotKeys: ["Boots"] })).toMatchObject({ source: "profile", value: (100 / 35) * 2 });
    expect(resolveWeight({ ...b, slotKeys: ["Ring"] })?.source).toBe("normalized");
  });
});

describe("scoring", () => {
  it("is sum(weight * roll) over weighted mods only", () => {
    const w = new Map([["a", 2], ["b", 0.5]]);
    expect(score([{ id: "a", roll: 10 }, { id: "b", roll: 40 }, { id: "zz", roll: 99 }], w)).toBe(40);
  });
  it("rolls multi-number mods by mean", () => expect(rollOf([12, 31])).toBe(21.5));
  it("value modes", () => {
    expect(value(100, 10, "ratio")).toBe(10);
    expect(value(100, 10, "pob", 100)).toBeCloseTo(100 - 0.1 * Math.log10(0.1));
    expect(value(100, undefined, "ratio")).toBeUndefined();
    expect(value(100, 0, "ratio")).toBeUndefined();
    expect(value(100, 10, "pob")).toBeUndefined();
  });
});

describe("buildQuery", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `explicit.stat_${i}`, weight: 100 - i }));
  it("puts the weight group first with min and sorts by statgroup.0", () => {
    const q = buildQuery([...mk(2), { id: "explicit.stat_x", min: 70 }], { league: "L", category: "accessory.ring", minScore: 500 });
    const stats = q.body.query["stats"] as Array<{ type: string; value?: { min: number }; filters: unknown[] }>;
    expect(stats[0]).toMatchObject({ type: "weight", value: { min: 500 } });
    expect(stats[1]).toMatchObject({ type: "and", filters: [{ id: "explicit.stat_x", value: { min: 70 } }] });
    expect(q.body.sort).toEqual({ "statgroup.0": "desc" });
  });
  it("falls back to price sort with no weighted mods", () => {
    expect(buildQuery([{ id: "a", min: 1 }], { league: "L" }).body.sort).toEqual({ price: "asc" });
  });
  it("never exceeds the complexity limit and drops the lowest weights", () => {
    const q = buildQuery(mk(60), { league: "L", maxPriceExalted: 50, minItemLevel: 75 });
    expect(q.used).toBeLessThanOrEqual(COMPLEXITY_LIMIT);
    expect(q.keptWeighted.length + q.droppedWeighted.length).toBe(60);
    expect(Math.min(...q.keptWeighted.map((k) => k.weight!))).toBeGreaterThan(Math.max(...q.droppedWeighted.map((k) => k.weight!)));
    expect(q.warnings.join()).toMatch(/dropped/);
  });
  it("skips zero-weight mods", () => {
    const q = buildQuery([{ id: "a", weight: 0 }, { id: "b", weight: 1 }], { league: "L" });
    expect(q.keptWeighted.map((k) => k.id)).toEqual(["b"]);
  });
  it("maps item classes to categories", () => {
    expect(categoryFor("Rings")).toBe("accessory.ring");
    expect(categoryFor("Waystones")).toBe("map.waystone");
    expect(categoryFor("Nope")).toBeUndefined();
  });
  it("encodes links", async () => {
    const q = buildQuery(mk(1), { league: "Standard", category: "accessory.ring" });
    const u = tradeUrl(q.body, "Rise of the Abyssal");
    expect(u.startsWith("https://www.pathofexile.com/trade2/search/poe2/Rise%20of%20the%20Abyssal?q=")).toBe(true);
    expect(JSON.parse(decodeURIComponent(u.split("?q=")[1]!))).toEqual(q.body);
    const p = await tradeUrlPob(q.body, "Standard");
    expect(p).toMatch(/^https:\/\/www\.pathofexile\.com\/trade2\/search\/Standard\/[A-Za-z0-9_-]+$/);
  });
});
