// End to end on synthetic tooltip photos: real Tesseract -> parse -> match -> inferred prefix/suffix/tier.
// The images are rendered by scripts/make-sample-tooltip.ts (not game screenshots). Real photos still need a manual check.
import { describe, expect, it } from "vitest";
import { affixOf, rowsFromItem, type Row } from "../src/model.js";
import { parseOcrLines } from "../src/ocr/fromOcr.js";
import { affixes, index } from "./helpers.js";
import { cleanLine } from "../src/ocr/fromOcr.js";
import { readPhoto } from "./ocrNode.js";

const known = (sk: string) => index.bySkeleton.has(sk);
const FULL = { x: 0, y: 0, w: 1, h: 1 };
const TV = { x: 0.1, y: 0.08, w: 0.5, h: 0.5 };

async function scan(file: string, crop: typeof FULL) {
  const r = await readPhoto(file, crop, known, (ls) => !!affixes.detectBase(ls.map((l) => cleanLine(l.text))));
  const { item, conf, base } = parseOcrLines(r.lines, { affixes, known });
  const rows = rowsFromItem(item, index, conf, { affixes, baseType: item.baseType, itemClass: undefined, itemLevel: item.itemLevel });
  return { r, item, rows, base };
}
const by = (rows: Row[], text: RegExp) => rows.find((x) => text.test(x.raw));

describe.each([
  ["ring", "clean", FULL], ["ring", "tv", TV], ["boots", "clean", FULL], ["boots", "tv", TV],
] as const)("photo %s (%s)", (id, kind, crop) => {
  it("reads base, item level and the mods; infers prefix/suffix", async () => {
    const { item, rows, base } = await scan(`tooltip-${id}-${kind}.png`, crop);
    if (id === "ring") {
      expect(base?.base).toBe("Sapphire Ring");
      expect(item.itemClass).toBe("Rings");
      expect(item.itemLevel).toBe(81);
      const life = by(rows, /maximum Life/)!, fire = by(rows, /Fire Res/)!, cold = by(rows, /Cold Res/)!, str = by(rows, /Strength/)!, lit = by(rows, /Lightning/)!;
      expect([life, fire, cold, str, lit].every(Boolean)).toBe(true);
      expect(life.values).toEqual([45]);
      expect(lit.kind).toBe("implicit");
      expect(affixOf(life)).toBe("prefix");
      expect([fire, cold, str].map(affixOf)).toEqual(["suffix", "suffix", "suffix"]);
      // The implicit must not count towards the suffix limit.
      expect(rows.filter((x) => affixOf(x) === "suffix")).toHaveLength(3);
    } else {
      expect(base?.base).toBe("Rawhide Boots");
      expect(item.itemClass).toBe("Boots");
      expect(item.itemLevel).toBe(82);
      expect(affixOf(by(rows, /Movement Speed/)!)).toBe("prefix");
      expect(affixOf(by(rows, /maximum Life/)!)).toBe("prefix");
      expect(affixOf(by(rows, /Cold Res/)!)).toBe("suffix");
      expect(affixOf(by(rows, /Dexterity/)!)).toBe("suffix");
    }
  }, 120_000);
});
