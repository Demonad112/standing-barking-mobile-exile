import { describe, expect, it } from "vitest";
import { atLeast, generateRegex, MIN_FRAGMENT, modRegex, universeFor } from "../src/core/regex.js";
import { index } from "./helpers.js";

const entry = (t: string) => { const e = index.all.find((x) => x.text === t); if (!e) throw new Error(t); return e; };
const render = (text: string, n = 42) => text.replace(/#/g, String(n));

describe("atLeast", () => {
  it("matches exactly the integers >= min (whole-number match)", () => {
    for (let min = 1; min <= 130; min++) {
      const re = new RegExp(`^${atLeast(min)}$`);
      for (let v = 0; v <= 1200; v++) expect(re.test(String(v)), `min=${min} v=${v}`).toBe(v >= min);
    }
  });
  it("is empty for min <= 0", () => expect(atLeast(0)).toBe(""));
});

describe("fragments", () => {
  const cls = "Rings";
  it("each selected mod's regex matches itself and no other mod in the item-class universe", () => {
    const texts = ["# to maximum Life", "#% to Fire Resistance", "#% to Cold Resistance", "#% increased Rarity of Items found", "# to Accuracy Rating", "#% increased Critical Hit Chance", "# Life Regeneration per second", "# to all Attributes"];
    for (const t of texts) {
      const e = entry(t);
      const u = universeFor(index, e, cls);
      const r = modRegex({ entry: e }, u);
      expect(r.unique, t).toBe(true);
      const re = new RegExp(r.regex, "i");
      expect(re.test("+" + render(t)), `self ${t}`).toBe(true);
      for (const o of u) if (o !== e) expect(re.test(render(o.text)), `${r.regex} must not match ${o.text}`).toBe(false);
    }
  });
  it("never emits fragments shorter than the minimum, nor ones found in item labels", () => {
    for (const t of ["# to maximum Life", "# to Accuracy Rating", "#% increased Rarity of Items found", "#% to Chaos Resistance"]) {
      const e = entry(t);
      const r = modRegex({ entry: e }, universeFor(index, e, "Rings"));
      const bare = r.fragment.replace(/\\./g, ".").replace(/\$$/, "");
      expect(bare.length, t).toBeGreaterThanOrEqual(MIN_FRAGMENT);
      expect(["armour", "level", "evasion rating", "energy shield", "requires", "item level"].some((l) => l.includes(bare)), t).toBe(false);
    }
  });
  it("fragments are short", () => {
    const e = entry("# to maximum Life");
    expect(modRegex({ entry: e }, universeFor(index, e, "Rings")).regex.length).toBeLessThan(25);
  });
  it("works for waystone mods (no slot ranges)", () => {
    const e = entry("#% increased Rarity of Items found in Map");
    const u = universeFor(index, e, "Waystones");
    const r = modRegex({ entry: e }, u);
    expect(r.unique).toBe(true);
    for (const o of u) if (o !== e) expect(new RegExp(r.regex, "i").test(render(o.text))).toBe(false);
  });
  it("min-roll pattern accepts >= min and rejects lower", () => {
    const e = entry("# to maximum Life");
    const r = modRegex({ entry: e, minRoll: 80 }, universeFor(index, e, "Rings"));
    const re = new RegExp(r.regex, "i");
    for (const v of [80, 86, 99, 100, 149]) expect(re.test(`+${v} to maximum Life`), String(v)).toBe(true);
    for (const v of [10, 45, 79]) expect(re.test(`+${v} to maximum Life`), String(v)).toBe(false);
  });
});

describe("anchored fallback", () => {
  it("separates 'Critical Hit Chance' from 'Minions have # ...' and honours a min roll", () => {
    const e = entry("#% increased Critical Hit Chance");
    const u = universeFor(index, e, "Rings");
    const plain = modRegex({ entry: e }, u);
    expect(plain.unique).toBe(true);
    expect(new RegExp(plain.regex, "i").test("Minions have 12% increased Critical Hit Chance")).toBe(false);
    expect(new RegExp(plain.regex, "i").test("28% increased Critical Hit Chance")).toBe(true);
    const min = new RegExp(modRegex({ entry: e, minRoll: 20 }, u).regex, "i");
    expect(min.test("28% increased Critical Hit Chance")).toBe(true);
    expect(min.test("12% increased Critical Hit Chance")).toBe(false);
    expect(min.test("Minions have 28% increased Critical Hit Chance")).toBe(false);
  });
});

describe("generateRegex", () => {
  const sels = ["# to maximum Life", "#% to Fire Resistance", "#% to Cold Resistance"].map((t, i) => ({ entry: entry(t), weight: 10 - i }));
  it("AND mode quotes each term; ANY mode alternates in one quoted term", () => {
    const all = generateRegex(sels, index, "Rings", { mode: "all" });
    expect(all.strings[0]!.match(/"/g)).toHaveLength(6);
    const any = generateRegex(sels, index, "Rings", { mode: "any" });
    expect(any.strings[0]!.match(/"/g)).toHaveLength(2);
    expect(any.strings[0]).toContain("|");
  });
  it("drop mode removes lowest weights to fit", () => {
    const full = generateRegex(sels, index, "Rings").strings[0]!.length;
    const out = generateRegex(sels, index, "Rings", { limit: full - 1, overflow: "drop" });
    expect(out.strings[0]!.length).toBeLessThanOrEqual(full - 1);
    expect(out.dropped.map((d) => d.entry.text)).toEqual(["#% to Cold Resistance"]);
    expect(out.overLimit).toBe(false);
  });
  it("split mode keeps every string within the limit", () => {
    const full = generateRegex(sels, index, "Rings").strings[0]!.length;
    const limit = full - 1;
    const out = generateRegex(sels, index, "Rings", { limit, overflow: "split" });
    expect(out.strings.length).toBeGreaterThan(1);
    for (const s of out.strings) expect(s.length).toBeLessThanOrEqual(limit);
  });
  it("flags over-limit when no overflow policy is chosen", () => {
    const out = generateRegex(sels, index, "Rings", { limit: 10 });
    expect(out.overLimit).toBe(true);
    expect(out.warnings.join()).toMatch(/Over the 10-character limit/);
  });
});
