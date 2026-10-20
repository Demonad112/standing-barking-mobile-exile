// Browser-only wrapper: crop + downscale a photo, preprocess, run Tesseract in its own Web Worker.
// Worker script, WASM core and eng.traineddata are served from /ocr (copied by scripts/copy-ocr-assets.ts), no CDN.
import { clampCrop, fitSize, grayToRgba, prepare, type Crop, type PrepOptions } from "./preprocess.js";

export interface OcrLine { text: string; confidence: number }

export async function preprocessToCanvas(src: ImageBitmap | HTMLImageElement, crop: Crop, o: PrepOptions): Promise<HTMLCanvasElement> {
  const sw = "naturalWidth" in src ? src.naturalWidth : src.width;
  const sh = "naturalHeight" in src ? src.naturalHeight : src.height;
  const c = clampCrop(crop);
  const sx = Math.round(c.x * sw), sy = Math.round(c.y * sh), cw = Math.max(1, Math.round(c.w * sw)), ch = Math.max(1, Math.round(c.h * sh));
  const { w, h } = fitSize(cw, ch);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, sx, sy, cw, ch, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  img.data.set(grayToRgba(prepare(img.data, o)));
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export async function recognize(canvas: HTMLCanvasElement, onProgress: (p: number, status: string) => void): Promise<OcrLine[]> {
  const { createWorker } = await import("tesseract.js");
  const base = import.meta.env.BASE_URL;
  const worker = await createWorker("eng", 1, {
    workerPath: `${base}ocr/worker.min.js`,
    corePath: `${base}ocr/core`,
    langPath: `${base}ocr/lang`,
    workerBlobURL: false,
    logger: (m: { progress: number; status: string }) => onProgress(m.progress, m.status),
  });
  try {
    const { data } = await worker.recognize(canvas);
    return (data.lines ?? [])
      .map((l) => ({ text: l.text.trim(), confidence: Math.round(l.confidence) }))
      .filter((l) => l.text.length > 0);
  } finally {
    await worker.terminate();
  }
}
