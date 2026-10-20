// Browser-only wrapper: crop + rescale a photo, preprocess, run Tesseract in its own Web Worker.
// Worker script, WASM core and eng.traineddata are served from /ocr (copied by scripts/copy-ocr-assets.ts), no CDN.
import { BASE_BONUS, bestPass, blobSize, HEADER_PASSES, headerStripBottom, PASSES, type OcrLine, type Pass } from "./passes.js";
import { clampCrop, grayToRgba, prepareImage, targetSize, type Crop, type PrepImageOptions } from "./preprocess.js";

export type { OcrLine } from "./passes.js";

/** Crop, rescale (up for small crops: Tesseract wants ~30px text) and preprocess into a canvas. */
export async function preprocessToCanvas(src: ImageBitmap | HTMLImageElement, crop: Crop, o: PrepImageOptions): Promise<HTMLCanvasElement> {
  const sw = "naturalWidth" in src ? src.naturalWidth : src.width;
  const sh = "naturalHeight" in src ? src.naturalHeight : src.height;
  const c = clampCrop(crop);
  const sx = Math.round(c.x * sw), sy = Math.round(c.y * sh), cw = Math.max(1, Math.round(c.w * sw)), ch = Math.max(1, Math.round(c.h * sh));
  const { w, h } = targetSize(cw, ch);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, cw, ch, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const prep = o.minBlob === -1 ? { ...o, minBlob: blobSize(w, h) } : o;
  img.data.set(grayToRgba(prepareImage(img.data, w, h, prep)));
  ctx.putImageData(img, 0, 0);
  return canvas;
}

async function createOcrWorker(onProgress: (p: number, status: string) => void) {
  const { createWorker } = await import("tesseract.js");
  const base = import.meta.env.BASE_URL;
  const worker = await createWorker("eng", 1, {
    workerPath: `${base}ocr/worker.min.js`,
    corePath: `${base}ocr/core`,
    langPath: `${base}ocr/lang`,
    workerBlobURL: false,
    logger: (m: { progress: number; status: string }) => onProgress(m.progress, m.status),
  });
  return worker;
}

export const toLines = (data: { lines?: Array<{ text: string; confidence: number; bbox?: { y0: number; y1: number } }> }): OcrLine[] =>
  (data.lines ?? [])
    .map((l) => ({ text: l.text.trim(), confidence: Math.round(l.confidence), ...(l.bbox ? { y0: l.bbox.y0, y1: l.bbox.y1 } : {}) }))
    .filter((l) => l.text.length > 0);

/**
 * Read an item photo. Tries preprocessing recipes (see passes.ts) on one shared worker and returns the lines of the
 * recipe that matched the most known mods, plus which recipes ran.
 */
export async function recognizePhoto(
  src: ImageBitmap | HTMLImageElement, crop: Crop, known: (skeleton: string) => boolean,
  onProgress: (p: number, status: string) => void, hasBase?: (lines: OcrLine[]) => boolean, passes: Pass[] = PASSES,
): Promise<{ lines: OcrLine[]; pass: string; tried: Array<{ name: string; score: number }> }> {
  const worker = await createOcrWorker((p, s) => onProgress(p, s));
  const read = async (pass: Pass, c: Crop) => {
    const canvas = await preprocessToCanvas(src, c, pass.prep);
    await worker.setParameters({ tessedit_pageseg_mode: pass.psm as never });
    const { data } = await worker.recognize(canvas);
    const lines = toLines(data);
    // Kept for diagnosing bad reads on a device (open the console and read window.__ocrDebug).
    ((window as unknown as { __ocrDebug?: unknown[] }).__ocrDebug ??= []).push({ pass: pass.name, size: [canvas.width, canvas.height], lines: lines.map((l) => `${l.confidence}% ${l.text}`) });
    return { lines, height: canvas.height };
  };
  try {
    let height = 1;
    const r = await bestPass(async (pass, i) => {
      onProgress(0, `pass ${i + 1}/${passes.length}: ${pass.name}`);
      const out = await read(pass, crop);
      height = out.height;
      return out.lines;
    }, known, passes, hasBase);

    let lines = r.lines;
    // The framed name/base header is the part most often lost to glare. Re-read only that strip with other settings.
    const bottom = hasBase && !r.baseFound ? headerStripBottom(lines, known) : undefined;
    if (bottom !== undefined) {
      const c = clampCrop(crop);
      const strip: Crop = { ...c, h: c.h * (bottom / height) };
      for (let i = 0; i < HEADER_PASSES.length; i++) {
        onProgress(0, `reading header ${i + 1}/${HEADER_PASSES.length}`);
        const head = (await read(HEADER_PASSES[i]!, strip)).lines.map((l) => ({ text: l.text, confidence: l.confidence }));
        if (hasBase!(head)) { lines = [...head, ...lines]; r.tried.push({ name: HEADER_PASSES[i]!.name, score: BASE_BONUS }); break; }
      }
    }
    return { lines, pass: r.pass.name, tried: r.tried };
  } finally {
    await worker.terminate();
  }
}
