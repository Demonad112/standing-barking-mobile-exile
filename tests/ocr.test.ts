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
