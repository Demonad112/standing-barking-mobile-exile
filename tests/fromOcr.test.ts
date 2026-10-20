import { describe, expect, it } from "vitest";
import { parseOcrLines } from "../src/ocr/fromOcr.js";
import { rowsFromItem } from "../src/model.js";
import { index } from "./helpers.js";

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
});
