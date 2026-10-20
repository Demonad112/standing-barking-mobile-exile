import { describe, expect, it } from "vitest";
import { affixSkeleton, tierLabel } from "../src/core/affixes.js";
import { normalizeLine } from "../src/core/normalize.js";
import { affixes } from "./helpers.js";

const look = (text: string, base: string | undefined, cls: string | undefined, ilvl?: number) => {
  const n = normalizeLine(text);
  return affixes.lookup(n.skeleton, n.values, affixes.tagSetsFor(base, cls), ilvl);
};

describe("affixSkeleton", () => {
  it("turns ranges and literals into # slots with their bounds", () => {
    expect(affixSkeleton("+(5-8) to Strength")).toEqual({ skeleton: "# to strength", slots: [[5, 8]] });
    expect(affixSkeleton("Adds (3-5) to (8-10) Cold Damage")).toEqual({ skeleton: "adds # to # cold damage", slots: [[3, 5], [8, 10]] });
    expect(affixSkeleton("(10-15)% increased Rarity")).toEqual({ skeleton: "#% increased rarity", slots: [[10, 15]] });
  });
});

describe("AffixIndex.lookup", () => {
  it("infers prefix vs suffix from text, base and roll", () => {
    expect(look("+45 to maximum Life", "Sapphire Ring", undefined)).toMatchObject({ affix: "prefix", approx: false });
    expect(look("+7 to Strength", "Sapphire Ring", undefined)).toMatchObject({ affix: "suffix", approx: false });
    expect(look("+32% to Fire Resistance", undefined, "Boots")).toMatchObject({ affix: "suffix" });
    expect(look("25% increased Movement Speed", undefined, "Boots")).toMatchObject({ affix: "prefix", names: ["Gazelle's"] });
  });
  it("reports tiers, T1 = highest required level, and the matching tier's range", () => {
    const life = look("+45 to maximum Life", "Sapphire Ring", undefined)!;
    expect(tierLabel(life)).toBe("T5");
    expect(life.names).toEqual(["Stalwart"]);
    expect(life.slots).toEqual([[40, 59]]);
    expect(look("35% increased Movement Speed", undefined, "Boots")).toMatchObject({ tier: 1, names: ["Hellion's"] });
  });
  it("marks a roll outside every tier as a guess (approx) with no tier", () => {
    const r = look("12% increased Movement Speed", undefined, "Boots")!;
    expect(r.approx).toBe(true);
    expect(r.tier).toBeUndefined();
    expect(r.affix).toBe("prefix");
  });
  it("uses item level to exclude tiers the item could not roll", () => {
    // Hellion's (35% MS) needs level 82; at ilvl 40 the line cannot be a real roll of any allowed tier.
    expect(look("35% increased Movement Speed", undefined, "Boots", 40)).toMatchObject({ approx: true });
    expect(look("35% increased Movement Speed", undefined, "Boots", 82)).toMatchObject({ approx: false, tier: 1 });
  });
  it("returns undefined for text that is not a prefix/suffix mod, or cannot spawn on the base", () => {
    expect(look("Adds 5 to 9 Fire damage", undefined, "Rings")).toBeUndefined();
    expect(look("25% increased Movement Speed", "Sapphire Ring", undefined)).toBeUndefined();
    expect(look("not a real mod line", undefined, "Rings")).toBeUndefined();
  });
  it("gives the roll span of the mod family on that base (feeds 100/maxRoll weights)", () => {
    expect(look("+45 to maximum Life", "Sapphire Ring", undefined)!.span).toEqual([10, 119]);
  });
  it("prefers the single-line family when a hybrid shares a line's text, and counts hybrid lines as one family", () => {
    const armour = look("+39 to Armour", undefined, "Body Armours")!;
    expect(armour.names).toEqual(["Studded"]);
    const hybrid = affixes.data.mods.findIndex((m) => m[5].length === 2);
    expect(hybrid).toBeGreaterThan(-1);
  });
});

describe("AffixIndex base detection", () => {
  it("finds a base exactly, inside a magic/rare name line, and with OCR typos", () => {
    expect(affixes.detectBase(["Dread Loop", "Sapphire Ring", "Item Level: 81"])?.base).toBe("Sapphire Ring");
    expect(affixes.detectBase(["Sapphlre Rlng"])?.base).toBe("Sapphire Ring");
    expect(affixes.detectBase(["Rawhide Boots of the Whale"])?.base).toBe("Rawhide Boots");
    expect(affixes.detectBase(["5 7 Md nero Ay", "totally unrelated words"])).toBeUndefined();
  });
  it("searches bases for the manual picker and maps the class to the app's names", () => {
    expect(affixes.searchBases("sapphire ri")).toEqual([{ name: "Sapphire Ring", className: "Ring", appClass: "Rings" }]);
  });
});
