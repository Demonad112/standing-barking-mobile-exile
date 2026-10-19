import { describe, expect, it } from "vitest";
import { parseItem } from "../src/core/parseItem.js";
import { chosen, decodeShared, encodeShared, fromShared, pickManual, rematch, rowFromEntry, rowsFromItem, selectionFor, toShared, weightOf } from "../src/model.js";
import { fixture, index } from "./helpers.js";

const ring = () => { const it = parseItem(fixture("ring-rare")); return { it, rows: rowsFromItem(it, index) }; };

describe("rows", () => {
  it("pre-accepts only sure exact matches", () => {
    const { rows } = ring();
    expect(rows.length).toBe(6);
    for (const r of rows) expect(r.confirmed).toBe(r.match.confidence === "high");
  });
  it("never pre-accepts low OCR confidence", () => {
    const it = parseItem(fixture("ring-rare"));
    const rows = rowsFromItem(it, index, it.lines.map((_, i) => (i === 1 ? 40 : 95)));
    expect(rows[1]!.confirmed).toBe(false);
    expect(rows[1]!.level).toBe("off");
    expect(rows[2]!.confirmed).toBe(true);
  });
  it("editing a line resets confirmation and re-matches", () => {
    const { rows } = ring();
    const r = rematch(rows[1]!, "+90 to maximum Life", index, "Rings");
    expect(r.confirmed).toBe(false);
    expect(chosen(r)?.text).toBe("# to maximum Life");
    expect(chosen(r)?.rolls).toEqual([90]);
  });
  it("manual pick confirms the row", () => {
    const { rows } = ring();
    const e = index.all.find((x) => x.text === "#% to Cold Resistance")!;
    const r = pickManual({ ...rows[1]!, confirmed: false, level: "off" }, e, "Rings");
    expect(r.confirmed).toBe(true);
    expect(r.level).toBe("nice");
    expect(chosen(r)?.text).toBe("#% to Cold Resistance");
  });
});

describe("selection", () => {
  it("builds weights from ranges and reports mods that need manual weights", () => {
    const { rows } = ring();
    const sel = selectionFor(rows, "Rings", "tank");
    expect(sel.stats.every((s) => s.weight && s.weight > 0)).toBe(true);
    const life = rows.find((r) => chosen(r)?.text === "# to maximum Life")!;
    expect(weightOf(life, "Rings", "tank")).toMatchObject({ source: "profile" });
    expect(sel.itemScore).toBeGreaterThan(0);
    const way = parseItem(fixture("waystone-rare"));
    const wsel = selectionFor(rowsFromItem(way, index), "Waystones", undefined);
    expect(wsel.stats).toEqual([]);
    expect(wsel.skipped.length).toBe(3);
    expect(wsel.skipped[0]!.reason).toMatch(/weight/);
  });
  it("manual weight overrides and must-haves use min", () => {
    const { rows } = ring();
    const life = rows.find((r) => chosen(r)?.text === "# to maximum Life")!;
    const sel = selectionFor([{ ...life, weight: 5 }, { ...rows.find((r) => chosen(r)?.text === "#% to Cold Resistance")!, level: "must", minRoll: 25 }], "Rings", undefined);
    expect(sel.stats).toEqual([{ id: "explicit.stat_3299347043", weight: 5 }, { id: expect.stringMatching(/^explicit\.stat_/), min: 25 }]);
  });
  it("search-a-mod rows are usable immediately", () => {
    const r = rowFromEntry(index.all.find((x) => x.text === "#% increased Movement Speed")!, "Boots");
    const sel = selectionFor([r], "Boots", "speed");
    expect(sel.stats).toHaveLength(1);
    expect(sel.stats[0]!.weight).toBeCloseTo((100 / 35) * 2);
  });
});

describe("share state", () => {
  it("round-trips through the hash", () => {
    const { rows } = ring();
    const sh = toShared(rows, { league: "Standard", role: "tank", cls: "Rings", cap: 50 });
    const dec = decodeShared(encodeShared(sh))!;
    expect(dec).toEqual(sh);
    const back = fromShared(dec, index);
    expect(back.missing).toEqual([]);
    expect(selectionFor(back.rows, "Rings", "tank").stats).toEqual(selectionFor(rows, "Rings", "tank").stats);
  });
  it("rejects junk", () => {
    expect(decodeShared("%%%")).toBeUndefined();
    expect(decodeShared(btoa(JSON.stringify({ v: 2 })))).toBeUndefined();
  });
});
