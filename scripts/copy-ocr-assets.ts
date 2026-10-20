// Copies the Tesseract worker, WASM core and English model into public/ocr so OCR runs offline with no CDN.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const req = createRequire(import.meta.url);
const tess = dirname(req.resolve("tesseract.js/package.json"));
const core = dirname(createRequire(join(tess, "package.json")).resolve("tesseract.js-core/package.json"));
const lang = dirname(req.resolve("@tesseract.js-data/eng/package.json"));

const out = "public/ocr";
mkdirSync(join(out, "core"), { recursive: true });
mkdirSync(join(out, "lang"), { recursive: true });
copyFileSync(join(tess, "dist/worker.min.js"), join(out, "worker.min.js"));
// tesseract.js picks the SIMD or plain build at runtime; ship both LSTM builds.
for (const f of ["tesseract-core-simd-lstm.wasm.js", "tesseract-core-lstm.wasm.js"]) copyFileSync(join(core, f), join(out, "core", f));
copyFileSync(join(lang, "4.0.0_best_int/eng.traineddata.gz"), join(out, "lang/eng.traineddata.gz"));
console.log("OCR assets copied to", out);
