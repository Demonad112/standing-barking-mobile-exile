// Node-side mirror of src/ocr/ocr.ts (same preprocessing + passes) so real Tesseract runs in tests without a browser.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { createWorker } from "tesseract.js";
import { toLines } from "../src/ocr/ocr.js";
import { bestPass, blobSize, PASSES, type OcrLine } from "../src/ocr/passes.js";
import { clampCrop, grayToRgba, prepareImage, targetSize, type Crop } from "../src/ocr/preprocess.js";

interface Img { w: number; h: number; data: Uint8ClampedArray }

function cropResize(src: Img, crop: Crop): Img {
  const c = clampCrop(crop);
  const sx = Math.round(c.x * src.w), sy = Math.round(c.y * src.h), cw = Math.max(1, Math.round(c.w * src.w)), ch = Math.max(1, Math.round(c.h * src.h));
  const { w, h } = targetSize(cw, ch);
  const out = new Uint8ClampedArray(w * h * 4);
  const kx = cw / w, ky = ch / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = Math.min(cw - 1.001, x * kx), fy = Math.min(ch - 1.001, y * ky);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    for (let k = 0; k < 4; k++) {
      const g = (xx: number, yy: number) => src.data[((sy + yy) * src.w + sx + xx) * 4 + k]!;
      out[(y * w + x) * 4 + k] = g(x0, y0) * (1 - ax) * (1 - ay) + g(x0 + 1, y0) * ax * (1 - ay) + g(x0, y0 + 1) * (1 - ax) * ay + g(x0 + 1, y0 + 1) * ax * ay;
    }
  }
  return { w, h, data: out };
}

export async function readPhoto(file: string, crop: Crop, known: (skeleton: string) => boolean, hasBase?: (lines: OcrLine[]) => boolean) {
  const png = PNG.sync.read(readFileSync(join(__dirname, "fixtures/photos", file)));
  const src: Img = { w: png.width, h: png.height, data: new Uint8ClampedArray(png.data) };
  const worker = await createWorker("eng", 1, { langPath: join(__dirname, "../public/ocr/lang"), gzip: true, cacheMethod: "none" } as never);
  try {
    return await bestPass(async (pass) => {
      const im = cropResize(src, crop);
      const prep = pass.prep.minBlob === -1 ? { ...pass.prep, minBlob: blobSize(im.w, im.h) } : pass.prep;
      const gray = prepareImage(im.data, im.w, im.h, prep);
      const out = new PNG({ width: im.w, height: im.h });
      out.data = Buffer.from(grayToRgba(gray));
      await worker.setParameters({ tessedit_pageseg_mode: pass.psm as never });
      const { data } = await worker.recognize(PNG.sync.write(out));
      return toLines(data) as OcrLine[];
    }, known, PASSES, hasBase);
  } finally {
    await worker.terminate();
  }
}
