import { describe, expect, it } from "vitest";
import { binarize, clampCrop, fitSize, grayToRgba, invert, meanLuma, otsu, prepare, stretch, toGray } from "../src/ocr/preprocess.js";

const rgba = (vals: number[]) => new Uint8ClampedArray(vals.flatMap((v) => [v, v, v, 255]));

describe("preprocess", () => {
  it("downscales to at most 1600px, never up", () => {
    expect(fitSize(4000, 3000)).toEqual({ w: 1600, h: 1200 });
    expect(fitSize(800, 600)).toEqual({ w: 800, h: 600 });
  });
  it("clamps the crop box inside the image", () => {
    expect(clampCrop({ x: -1, y: 0.9, w: 5, h: 5 })).toEqual({ x: 0, y: 0.9, w: 1, h: expect.closeTo(0.1, 9) });
  });
  it("grayscale uses luma weights", () => {
    expect(toGray(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]))).toEqual(new Uint8ClampedArray([76, 150, 29]));
  });
  it("stretch maps percentiles to the full range", () => {
    const g = new Uint8ClampedArray(100).map((_, i) => 100 + (i % 50));
    const s = stretch(g, 0, 1);
    expect(Math.min(...s)).toBe(0);
    expect(Math.max(...s)).toBe(255);
  });
  it("otsu separates a bimodal image", () => {
    const g = new Uint8ClampedArray(200).map((_, i) => (i < 100 ? 20 : 220));
    const t = otsu(g);
    expect(t).toBeGreaterThanOrEqual(20);
    expect(t).toBeLessThan(220);
    expect([...binarize(g, t)].every((v, i) => v === (i < 100 ? 0 : 255))).toBe(true);
  });
  it("auto-inverts light-on-dark tooltips so text ends up dark", () => {
    const dark = rgba([10, 10, 10, 10, 10, 10, 10, 240]); // dark background, one bright glyph pixel
    const out = prepare(dark);
    expect(meanLuma(out)).toBeGreaterThan(128);
    expect(out[out.length - 1]).toBeLessThan(out[0]!);
  });
  it("leaves dark-on-light images un-inverted", () => {
    const light = rgba([240, 240, 240, 240, 240, 240, 240, 10]);
    const out = prepare(light);
    expect(out[out.length - 1]).toBeLessThan(out[0]!);
  });
  it("invert and grayToRgba are exact", () => {
    expect(invert(new Uint8ClampedArray([0, 255, 10]))).toEqual(new Uint8ClampedArray([255, 0, 245]));
    expect(grayToRgba(new Uint8ClampedArray([7]))).toEqual(new Uint8ClampedArray([7, 7, 7, 255]));
  });
  it("optional threshold gives a binary image", () => {
    const out = prepare(rgba([10, 60, 120, 200, 250, 30]), { threshold: true });
    expect([...out].every((v) => v === 0 || v === 255)).toBe(true);
  });
});

import { adaptiveThreshold, boxBlur, despeckle, prepareImage, targetSize } from "../src/ocr/preprocess.js";
import { bestPass, ENOUGH, PASSES, scoreLines } from "../src/ocr/passes.js";

describe("preprocess: denoise + local threshold", () => {
  it("targetSize upscales small crops (max 3x) and still caps large ones", () => {
    expect(targetSize(450, 405)).toEqual({ w: 900, h: 810 });
    expect(targetSize(100, 100)).toEqual({ w: 300, h: 300 });
    expect(targetSize(4000, 3000)).toEqual({ w: 1600, h: 1200 });
    expect(targetSize(1200, 800)).toEqual({ w: 1200, h: 800 });
  });
  it("boxBlur averages neighbours and r=0 is a no-op", () => {
    const g = new Uint8ClampedArray([0, 0, 0, 0, 90, 0, 0, 0, 0]);
    expect(boxBlur(g, 3, 3, 1)[4]).toBe(10);
    expect(boxBlur(g, 3, 3, 0)).toBe(g);
  });
  it("adaptiveThreshold keeps dark text on a brightness gradient that a global threshold would lose", () => {
    const w = 40, h = 10, g = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = 100 + x * 3; // gradient 100..217
    g[5 * w + 4] = 40;   // ink in the dark part
    g[5 * w + 35] = 150; // ink in the bright part (still lighter than the dark side's background)
    const out = adaptiveThreshold(g, w, h, 15, 0.12);
    expect(out[5 * w + 4]).toBe(0);
    expect(out[5 * w + 35]).toBe(0);
    expect(out[2 * w + 20]).toBe(255);
  });
  it("despeckle removes small ink blobs and keeps big ones", () => {
    const w = 12, h = 6, b = new Uint8ClampedArray(w * h).fill(255);
    b[1 * w + 1] = 0; // 1px speck
    for (let y = 1; y < 5; y++) for (let x = 6; x < 10; x++) b[y * w + x] = 0; // 16px blob
    const out = despeckle(b, w, h, 5);
    expect(out[1 * w + 1]).toBe(255);
    expect(out[2 * w + 7]).toBe(0);
  });
  it("prepareImage inverts light-on-dark and yields a binary plane when adaptive", () => {
    const w = 8, h = 8, rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { const v = i === 27 ? 240 : 12; rgba.set([v, v, v, 255], i * 4); }
    const out = prepareImage(rgba, w, h, { adaptive: true, window: 7 });
    expect(new Set(out)).toEqual(new Set([0, 255]));
    expect(out[27]).toBe(0);
  });
});

describe("multi-pass selection", () => {
  const known = (sk: string) => sk === "# to maximum life" || sk === "#% to fire resistance";
  const L = (t: string, c = 90) => ({ text: t, confidence: c });
  it("scores only lines that are known mods after cleanup", () => {
    expect(Math.floor(scoreLines([L("+45 to maximum Life"), L("junk"), L("’ +32% to Fire Resistance ,")], known))).toBe(2);
  });
  it("stops at the first pass with enough mods and a base; otherwise keeps the best", async () => {
    const good = Array.from({ length: ENOUGH }, () => L("+45 to maximum Life"));
    const runs: string[] = [];
    const r1 = await bestPass(async (p) => { runs.push(p.name); return good; }, known);
    expect(runs).toHaveLength(1);
    expect(r1.baseFound).toBe(true);
    // Mods fine but base missing -> exactly one more pass, then stop.
    runs.length = 0;
    await bestPass(async (p) => { runs.push(p.name); return good; }, known, PASSES, () => false);
    expect(runs).toHaveLength(2);
    // Weak everywhere -> all passes run; the best one wins.
    const results = [[L("junk")], [L("+45 to maximum Life")], [L("junk")], [L("junk")]];
    const r2 = await bestPass(async (_p, i) => results[i]!, known, PASSES, () => false);
    expect(r2.pass).toBe(PASSES[1]);
    expect(r2.tried).toHaveLength(PASSES.length);
  });
  it("prefers the pass that also reads the base type", async () => {
    const withBase = [L("+45 to maximum Life")], without = [L("+45 to maximum Life"), L("+32% to Fire Resistance")];
    const r = await bestPass(async (_p, i) => (i === 0 ? without : withBase), known, PASSES.slice(0, 2), (ls) => ls === withBase);
    expect(r.lines).toBe(withBase); // 1 mod + base (3) beats 2 mods without a base (2)
  });
});

import { headerStripBottom } from "../src/ocr/passes.js";
describe("headerStripBottom", () => {
  const known = (sk: string) => sk === "# to maximum life";
  const L = (text: string, y0?: number) => ({ text, confidence: 90, ...(y0 !== undefined ? { y0, y1: (y0 ?? 0) + 20 } : {}) });
  it("ends just above the first property or known mod line", () => {
    expect(headerStripBottom([L("junk", 5), L("Item Level 81", 250), L("+45 to maximum Life", 440)], known)).toBe(246);
    expect(headerStripBottom([L("+45 to maximum Life", 300), L("Requires Level 45", 200)], known)).toBe(196);
  });
  it("is undefined without positions or when the strip is too small to hold a name", () => {
    expect(headerStripBottom([L("+45 to maximum Life")], known)).toBeUndefined();
    expect(headerStripBottom([L("+45 to maximum Life", 30)], known)).toBeUndefined();
  });
});
