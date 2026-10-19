import { describe, expect, it } from "vitest";
import { normalizeLine } from "../src/core/normalize.js";
import { matchItem, matchLine } from "../src/core/matchMods.js";
import { parseItem, validateAffixes } from "../src/core/parseItem.js";
import { fixture, fixtures, index } from "./helpers.js";

describe("normalizeLine", () => {
  it("drops sign and keeps values", () => {
    expect(normalizeLine("+45 to maximum Life")).toMatchObject({ skeleton: "# to maximum life", values: [45] });
  });
  it("handles two-number mods", () => {
    expect(normalizeLine("Adds 12 to 31 Physical Damage")).toMatchObject({ skeleton: "adds # to # physical damage", values: [12, 31] });
  });
  it("handles advanced roll ranges and tags", () => {
    const n = normalizeLine("+8(6-10)% to all Elemental Resistances (implicit)");
    expect(n).toMatchObject({ skeleton: "#% to all elemental resistances", values: [8], kind: "implicit" });
  });
  it("keeps negative values", () => {
    expect(normalizeLine("-10% to Fire Resistance").values).toEqual([-10]);
  });
});

describe("fixtures", () => {
  it("has at least 10 fixtures", () => expect(fixtures.length).toBeGreaterThanOrEqual(10));
  for (const name of fixtures) {
    it(`${name}: every mod line exact-matches the dataset`, () => {
      const item = parseItem(fixture(name));
      expect(item.lines.length).toBeGreaterThan(0);
      for (const m of matchItem(item, index)) {
        expect(m.candidates[0]?.exact, `no exact match: ${m.line.raw}`).toBe(true);
        expect(m.candidates[0]?.tradeId, `no trade id: ${m.line.raw}`).toBeTruthy();
      }
    });
  }
});

describe("parseItem", () => {
  it("reads header fields", () => {
    const i = parseItem(fixture("bow-rare"));
    expect(i).toMatchObject({ itemClass: "Bows", rarity: "Rare", name: "Gale Song", baseType: "Recurve Bow", itemLevel: 78 });
    expect(i.lines).toHaveLength(6);
  });
  it("does not treat properties as mods", () => {
    const i = parseItem(fixture("bow-rare"));
    expect(i.lines.some((l) => /attacks per second|requires/i.test(l.raw))).toBe(false);
  });
  it("reads waystone tier and implicit tag", () => {
    expect(parseItem(fixture("waystone-rare")).waystoneTier).toBe(15);
    expect(parseItem(fixture("ring-rare")).lines[0]).toMatchObject({ kind: "implicit" });
  });
  it("reads advanced headers", () => {
    const i = parseItem(fixture("ring-advanced"));
    expect(i.advanced).toBe(true);
    expect(i.lines.map((l) => [l.kind, l.affix, l.tier])).toEqual([
      ["implicit", undefined, undefined], ["explicit", "prefix", 3], ["explicit", "suffix", 2], ["explicit", "suffix", 3],
    ]);
    expect(i.lines[1]!.values).toEqual([86]);
  });
  it("warns on missing item level", () => {
    expect(parseItem("Item Class: Rings\nRarity: Rare\nA\nB\n--------\n+5 to maximum Life").warnings.join()).toMatch(/item level/i);
  });
});

describe("validateAffixes", () => {
  it("passes a legal rare", () => expect(validateAffixes(parseItem(fixture("ring-advanced")))).toEqual([]));
  it("fires on 4 prefixes", () => {
    expect(validateAffixes(parseItem(fixture("ring-bad-affixes")))).toEqual(["Too many prefixes: 4 (max 3)."]);
  });
  it("counts a hybrid affix once", () => {
    const lines = [1, 1, 2, 3].map((g) => ({ affix: "prefix" as const, group: g })) as never;
    expect(validateAffixes({ rarity: "Rare", lines })).toEqual([]);
  });
});

describe("matchLine", () => {
  const line = (s: string) => parseItem(`Item Class: Rings\nRarity: Rare\nA\nB\n--------\nItem Level: 80\n--------\n${s}`).lines[0]!;

  it("returns roll ranges for the item's slot", () => {
    const m = matchLine(line("+86 to maximum Life"), "Rings", index);
    expect(m.confidence).toMatch(/high|medium/);
    expect(m.candidates[0]).toMatchObject({ text: "# to maximum Life", rolls: [86], range: [10, 119], slotKnown: true });
    expect(m.candidates[0]!.tradeId).toBe("explicit.stat_3299347043");
  });
  it("uses implicit/augment stat ids for tagged lines", () => {
    const m = matchLine(line("+30 to maximum Life (rune)"), "Rings", index);
    expect(m.candidates[0]!.tradeId).toBe("rune.stat_3299347043");
  });
  it("aligns literal numbers in templates", () => {
    const m = matchLine(line("5 to 9 Added Attack Fire Damage per 25 Strength"), "Rings", index);
    expect(m.candidates[0]).toMatchObject({ exact: true, text: "# to # Added Attack Fire Damage per 25 Strength" });
    const bad = matchLine(line("5 to 9 Added Attack Fire Damage per 26 Strength"), "Rings", index);
    expect(bad.candidates[0]?.exact).not.toBe(true);
  });
  it("falls back to low-confidence fuzzy candidates, never exact", () => {
    const m = matchLine(line("+12 to maximum Lfe"), "Rings", index);
    expect(m.confidence === "low" || m.confidence === "none").toBe(true);
    expect(m.candidates.length).toBeLessThanOrEqual(3);
    expect(m.candidates.every((c) => !c.exact)).toBe(true);
  });
  it("returns none for unrelated text", () => {
    expect(matchLine(line("+5 to zzzz qqqq"), "Rings", index).confidence).toBe("none");
  });
});
