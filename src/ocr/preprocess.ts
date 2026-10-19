// Pixel helpers for tooltip photos. Pure functions on typed arrays so they run (and are tested) without a canvas.

export const MAX_SIDE = 1600;

export interface Crop { x: number; y: number; w: number; h: number } // fractions 0..1

export function fitSize(w: number, h: number, max = MAX_SIDE): { w: number; h: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

export function clampCrop(c: Crop): Crop {
  const x = Math.min(Math.max(c.x, 0), 0.98), y = Math.min(Math.max(c.y, 0), 0.98);
  return { x, y, w: Math.min(Math.max(c.w, 0.02), 1 - x), h: Math.min(Math.max(c.h, 0.02), 1 - y) };
}

/** Rec. 601 luma from RGBA. */
export function toGray(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length / 4);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
  return out;
}

export function meanLuma(gray: Uint8ClampedArray): number {
  let s = 0;
  for (const v of gray) s += v;
  return gray.length ? s / gray.length : 0;
}

/** Linear stretch between the lo/hi percentiles to the full 0-255 range. Returns a new array. */
export function stretch(gray: Uint8ClampedArray, lo = 0.02, hi = 0.98): Uint8ClampedArray {
  const hist = new Uint32Array(256);
  for (const v of gray) hist[v]!++;
  const pick = (p: number, strict: boolean) => { let acc = 0; const t = p * gray.length; for (let i = 0; i < 256; i++) { acc += hist[i]!; if (strict ? acc > t : acc >= t) return i; } return 255; };
  const a = pick(lo, true), b = pick(hi, false);
  const out = new Uint8ClampedArray(gray.length);
  if (b <= a) { out.set(gray); return out; }
  const k = 255 / (b - a);
  for (let i = 0; i < gray.length; i++) out[i] = (gray[i]! - a) * k;
  return out;
}

export function invert(gray: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = 255 - gray[i]!;
  return out;
}

/** Otsu's method: threshold maximising between-class variance. */
export function otsu(gray: Uint8ClampedArray): number {
  const hist = new Uint32Array(256);
  for (const v of gray) hist[v]!++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let wB = 0, sumB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t]!;
    const d = sumB / wB - (sum - sumB) / wF;
    const v = wB * wF * d * d;
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

export function binarize(gray: Uint8ClampedArray, t: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i]! > t ? 255 : 0;
  return out;
}

export interface PrepOptions { threshold?: boolean }

/**
 * Grayscale -> auto-invert (Tesseract wants dark text on light; game tooltips are the opposite) -> contrast stretch
 * -> optional Otsu threshold. Returns a gray plane.
 */
export function prepare(rgba: Uint8ClampedArray, o: PrepOptions = {}): Uint8ClampedArray {
  let g = toGray(rgba);
  if (meanLuma(g) < 128) g = invert(g);
  g = stretch(g);
  return o.threshold ? binarize(g, otsu(g)) : g;
}

export function grayToRgba(gray: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) { out[j] = out[j + 1] = out[j + 2] = gray[i]!; out[j + 3] = 255; }
  return out;
}
