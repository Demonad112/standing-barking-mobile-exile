// Pixel helpers for tooltip photos. Pure functions on typed arrays so they run (and are tested) without a canvas.

export const MAX_SIDE = 1600;

export interface Crop { x: number; y: number; w: number; h: number } // fractions 0..1

export function fitSize(w: number, h: number, max = MAX_SIDE): { w: number; h: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** Size to run OCR at: crops shorter than 900px on the long side are upscaled (up to 3x), long ones capped at MAX_SIDE. */
export function targetSize(w: number, h: number, minLong = 900, max = MAX_SIDE): { w: number; h: number } {
  const long = Math.max(w, h);
  const s = long < minLong ? Math.min(3, minLong / long) : Math.min(1, max / long);
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

/** Box blur (separable, edge-clamped) to suppress sensor grain and TV pixel patterns before thresholding. */
export function boxBlur(gray: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  if (r <= 0) return gray;
  const tmp = new Float32Array(gray.length);
  const out = new Uint8ClampedArray(gray.length);
  const k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += gray[row + Math.min(w - 1, Math.max(0, i))]!;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / k;
      acc += gray[row + Math.min(w - 1, x + r + 1)]! - gray[row + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += tmp[Math.min(h - 1, Math.max(0, i)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / k;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return out;
}

/**
 * Bradley-Roth adaptive threshold via an integral image: a pixel is background (255) unless it is darker than
 * `(1 - t)` x its local mean. Handles glare gradients and uneven TV brightness that defeat a single global threshold.
 */
export function adaptiveThreshold(gray: Uint8ClampedArray, w: number, h: number, window = Math.max(15, Math.round(w / 8)), t = 0.12): Uint8ClampedArray {
  const W = w + 1;
  const ii = new Float64Array(W * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) { row += gray[(y - 1) * w + (x - 1)]!; ii[y * W + x] = ii[(y - 1) * W + x]! + row; }
  }
  const half = window >> 1;
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half), y1 = Math.min(h - 1, y + half);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(w - 1, x + half);
      const n = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = ii[(y1 + 1) * W + x1 + 1]! - ii[y0 * W + x1 + 1]! - ii[(y1 + 1) * W + x0]! + ii[y0 * W + x0]!;
      out[y * w + x] = gray[y * w + x]! * n < sum * (1 - t) ? 0 : 255;
    }
  }
  return out;
}

/** Remove ink (0) blobs smaller than `minArea` pixels from a binary plane (4-connected). Kills grain left by thresholding. */
export function despeckle(bin: Uint8ClampedArray, w: number, h: number, minArea: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(bin);
  const seen = new Uint8Array(bin.length);
  const stack: number[] = [];
  for (let start = 0; start < bin.length; start++) {
    if (bin[start] !== 0 || seen[start]) continue;
    const comp: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      const x = p % w, y = (p - x) / w;
      if (x > 0 && bin[p - 1] === 0 && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && bin[p + 1] === 0 && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && bin[p - w] === 0 && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && bin[p + w] === 0 && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
    if (comp.length < minArea) for (const p of comp) out[p] = 255;
  }
  return out;
}

export interface PrepImageOptions { blur?: number; adaptive?: boolean; window?: number; t?: number; minBlob?: number }

/** Full pipeline for a photo: auto-invert, stretch, denoise, local threshold. Needs the image size, unlike `prepare`. */
export function prepareImage(rgba: Uint8ClampedArray, w: number, h: number, o: PrepImageOptions = {}): Uint8ClampedArray {
  let g = toGray(rgba);
  if (meanLuma(g) < 128) g = invert(g);
  g = stretch(g);
  g = boxBlur(g, w, h, o.blur ?? 0);
  if (!o.adaptive) return g;
  const bin = adaptiveThreshold(g, w, h, o.window, o.t);
  return o.minBlob ? despeckle(bin, w, h, o.minBlob) : bin;
}
