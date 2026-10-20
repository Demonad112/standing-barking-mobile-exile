import { describe, expect, it } from "vitest";
import { addSectionBreaks, cleanLine, fixDigits, parseOcrLines } from "../src/ocr/fromOcr.js";
import { affixOf, rowsFromItem } from "../src/model.js";
import { affixes, index } from "./helpers.js";

const known = (sk: string) => index.bySkeleton.has(sk);

describe("fixDigits / cleanLine", () => {
  it("repairs digit look-alikes only inside numeric tokens", () => {
    expect(fixDigits("+4S to maximum Life")).toBe("+45 to maximum Life");
    expect(fixDigits("l0% increased Rarity")).toBe("10% increased Rarity");
    expect(fixDigits("Solar Orb")).toBe("Solar Orb");
    expect(fixDigits("Item Level: 8l")).toBe("Item Level: 81");
  });
  it("strips edge junk, repairs the label colon, and drops noise", () => {
    expect(cleanLine("’   +7 to Strength   ,")).toBe("+7 to Strength");
    expect(cleanLine("N     Item Level. 81  “")).toBe("Item Level: 81");
    expect(cleanLine("- Requires Level 45")).toBe("Requires: Level 45");
    expect(cleanLine("Item Level, 81 .")).toBe("Item Level: 81");
    expect(cleanLine("-5% to Fire Resistance")).toBe("-5% to Fire Resistance");
    expect(cleanLine("~ , ")).toBe("");
    expect(cleanLine("Pa")).toBe("");
  });
});

describe("parseOcrLines", () => {
  const lines = [
    { text: "Item Level: 82", confidence: 96 },
    { text: "--------", confidence: 90 },
    { text: "+86 to maximum Life", confidence: 95 },
    { text: "+31% to Cold Resistance", confidence: 55 },
    { text: "+27% to Lightning Resistanse", confidence: 91 },
    { text: "Requires: Level 40", confidence: 93 },
  ];
  it("extracts item level and mod lines, skipping properties", () => {
    const { item, conf } = parseOcrLines(lines);
    expect(item.itemLevel).toBe(82);
    expect(item.lines.map((l) => l.raw)).toEqual(["+86 to maximum Life", "+31% to Cold Resistance", "+27% to Lightning Resistanse"]);
    expect(conf).toEqual([95, 55, 91]);
  });
  it("never pre-accepts low-confidence or misspelled lines", () => {
    const { item, conf } = parseOcrLines(lines);
    const rows = rowsFromItem(item, index, conf);
    expect(rows.map((r) => r.confirmed)).toEqual([true, false, false]);
    expect(rows[2]!.match.confidence).toMatch(/low|none/);
  });
  it("reads the base type from the header and sets the item class", () => {
    const { item, base } = parseOcrLines([{ text: "Dread Loop", confidence: 90 }, { text: "Sapphire Ring", confidence: 90 }, ...lines], { affixes, known });
    expect(base?.base).toBe("Sapphire Ring");
    expect(item.itemClass).toBe("Rings");
    expect(item.baseType).toBe("Sapphire Ring");
    expect(item.name).toBe("Dread Loop");
  });
  it("re-joins a mod line the tooltip wrapped, only when the joined text is a known mod", () => {
    const wrapped = [
      { text: "Sapphire Ring", confidence: 90 },
      { text: "+45 to maximum", confidence: 90 }, { text: "Life", confidence: 90 },
      { text: "+32% to Fire Resistance", confidence: 90 },
    ];
    const { item } = parseOcrLines(wrapped, { affixes, known });
    expect(item.lines.map((l) => l.raw)).toEqual(["+45 to maximum Life", "+32% to Fire Resistance"]);
  });
  it("tags the first mod section implicit when two sections hold mods, so it never counts as prefix/suffix", () => {
    const withGaps = [
      { text: "Sapphire Ring", confidence: 90, y0: 0, y1: 40 },
      { text: "Item Level: 81", confidence: 90, y0: 80, y1: 110 },
      { text: "+22% to Lightning Resistance", confidence: 90, y0: 160, y1: 190 },
      { text: "+45 to maximum Life", confidence: 90, y0: 240, y1: 270 },
      { text: "+32% to Fire Resistance", confidence: 90, y0: 280, y1: 310 },
      { text: "+7 to Strength", confidence: 90, y0: 320, y1: 350 },
    ];
    const { item } = parseOcrLines(withGaps, { affixes, known });
    expect(item.lines.map((l) => l.kind)).toEqual(["implicit", "explicit", "explicit", "explicit"]);
    const rows = rowsFromItem(item, index, undefined, { affixes, baseType: item.baseType, itemClass: undefined, itemLevel: item.itemLevel });
    expect(rows.map(affixOf)).toEqual([undefined, "prefix", "suffix", "suffix"]);
  });
});

describe("addSectionBreaks", () => {
  it("inserts a rule only where the gap is clearly larger than the usual line spacing", () => {
    const mk = (y0: number) => ({ text: `line ${y0}`, confidence: 90, y0, y1: y0 + 20 });
    const out = addSectionBreaks([mk(0), mk(30), mk(60), mk(150), mk(180)]);
    expect(out.map((l) => l.text)).toEqual(["line 0", "line 30", "line 60", "--------", "line 150", "line 180"]);
  });
  it("leaves lines alone when there is no position data", () => {
    const ls = [{ text: "a", confidence: 1 }, { text: "b", confidence: 1 }, { text: "c", confidence: 1 }, { text: "d", confidence: 1 }];
    expect(addSectionBreaks(ls)).toEqual(ls);
  });
});
