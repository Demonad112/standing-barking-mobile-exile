// Multi-pass OCR: photos vary (glare, grain, TV pixel grid), so try a few preprocessing recipes and keep the one whose
// text matches the most known mods. Pure logic, no browser APIs: the engine is injected so it is testable.
import { normalizeLine } from "../core/normalize.js";
import type { PrepImageOptions } from "./preprocess.js";
import { cleanLine } from "./fromOcr.js";

export interface OcrLine { text: string; confidence: number; y0?: number; y1?: number }

/** psm: Tesseract page segmentation mode. 3 = automatic layout, 6 = one uniform block, 11 = sparse text. */
export interface Pass { name: string; prep: PrepImageOptions; psm: "3" | "6" | "11" }

/** Ordered by how often they worked best on tooltip-on-screen photos. `minBlob` is filled from the image size by `blobSize`. */
export const PASSES: Pass[] = [
  { name: "local threshold, auto layout", prep: { blur: 1, adaptive: true, t: 0.25, minBlob: -1 }, psm: "3" },
  { name: "local threshold, block", prep: { blur: 1, adaptive: true, t: 0.25, minBlob: -1 }, psm: "6" },
  { name: "soft threshold, sparse", prep: { blur: 1, adaptive: true, t: 0.15, minBlob: -1 }, psm: "11" },
  { name: "grayscale, block", prep: { blur: 0 }, psm: "6" },
];

/** Speckle size scales with the image area; text dots (i, %) stay well above it. */
export const blobSize = (w: number, h: number) => Math.min(60, Math.max(8, Math.round((w * h) / 30000)));

export function scoreLines(lines: OcrLine[], known: (skeleton: string) => boolean): number {
  let hits = 0, conf = 0;
  for (const l of lines) {
    if (known(normalizeLine(cleanLine(l.text)).skeleton)) { hits++; conf += l.confidence; }
  }
  return hits + (hits ? conf / hits / 1000 : 0); // confidence only breaks ties
}

export const ENOUGH = 4;
/** Reading the header (base type) is worth about two mod lines when ranking passes. */
export const BASE_BONUS = 2;

/**
 * Run passes until one finds ENOUGH known mod lines and the base type (or, with mods good but no base, until the 2nd pass)
 * and return the best. `hasBase` says whether the lines contain a recognisable base type.
 */
export async function bestPass(
  run: (p: Pass, i: number) => Promise<OcrLine[]>, known: (skeleton: string) => boolean, passes: Pass[] = PASSES,
  hasBase: (lines: OcrLine[]) => boolean = () => true,
): Promise<{ lines: OcrLine[]; pass: Pass; score: number; baseFound: boolean; tried: Array<{ name: string; score: number }> }> {
  let best: { lines: OcrLine[]; pass: Pass; score: number; baseFound: boolean } | undefined;
  const tried: Array<{ name: string; score: number }> = [];
  for (let i = 0; i < passes.length; i++) {
    const lines = await run(passes[i]!, i);
    const mods = scoreLines(lines, known);
    const baseFound = hasBase(lines);
    const score = mods + (baseFound ? BASE_BONUS : 0);
    tried.push({ name: passes[i]!.name, score: Math.round(score * 10) / 10 });
    if (!best || score > best.score) best = { lines, pass: passes[i]!, score, baseFound };
    if (mods >= ENOUGH && (baseFound || i >= 1)) break;
  }
  return { ...best!, tried };
}

/** Passes tried on just the header strip (name + base type) when the full read missed it. Order: most different from the main passes first. */
export const HEADER_PASSES: Pass[] = [
  { name: "header: grayscale", prep: { blur: 0 }, psm: "6" },
  { name: "header: soft threshold", prep: { blur: 1, adaptive: true, t: 0.15, minBlob: -1 }, psm: "6" },
  { name: "header: grayscale, sparse", prep: { blur: 0 }, psm: "11" },
  { name: "header: threshold, single line", prep: { blur: 1, adaptive: true, t: 0.25, minBlob: -1 }, psm: "6" },
];

/**
 * Bottom edge (in OCR-image pixels) of the header strip: just above the first line that is a property or a known mod.
 * Undefined when no such line has a position or the strip would be too small to hold a name.
 */
export function headerStripBottom(lines: OcrLine[], known: (skeleton: string) => boolean, minHeight = 40): number | undefined {
  let top: number | undefined;
  for (const l of lines) {
    if (l.y0 === undefined) continue;
    const t = cleanLine(l.text);
    if (/^(item level|requires?)\b/i.test(t) || known(normalizeLine(t).skeleton)) top = top === undefined ? l.y0 : Math.min(top, l.y0);
  }
  return top !== undefined && top - 4 >= minHeight ? top - 4 : undefined;
}
