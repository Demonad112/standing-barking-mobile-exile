// Renders synthetic PoE2-style tooltip images (clean + "TV photo" degraded) for OCR tests. NOT real game screenshots:
// layout follows the PoE2 tooltip order (name/base, item level + requirements, implicit, explicit) as best known.
// Usage: tsx scripts/make-sample-tooltip.ts <outDir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const out = process.argv[2] ?? "tests/fixtures/photos";
mkdirSync(out, { recursive: true });

interface Sample { id: string; name: string; base: string; props: string[]; implicit: string[]; mods: string[] }
export const SAMPLES: Sample[] = [
  { id: "ring", name: "Dread Loop", base: "Sapphire Ring", props: ["Item Level: 81", "Requires: Level 45"],
    implicit: ["+22% to Lightning Resistance"], mods: ["+45 to maximum Life", "+32% to Fire Resistance", "+27% to Cold Resistance", "+7 to Strength"] },
  { id: "boots", name: "Gale Stride", base: "Rawhide Boots", props: ["Item Level: 82", "Requires: Level 60"],
    implicit: [], mods: ["25% increased Movement Speed", "+58 to maximum Life", "+31% to Cold Resistance", "+22 to Dexterity"] },
];

const box = (color: string, rows: string[], extra = "") =>
  `<div style="font:22px 'DejaVu Serif',serif;text-align:center;color:${color};padding:14px 0;line-height:1.6;border-top:1px solid #5a4a2a;${extra}">${rows.join("<br>")}</div>`;
const html = (s: Sample, glare: boolean) => `<!doctype html><body style="margin:0;background:#0b0a09">
<div style="padding:40px;background:radial-gradient(#1d1814,#0b0a09);width:560px">
 <div style="font:bold 30px 'DejaVu Serif',serif;color:#ffe86b;text-align:center;border:2px solid #7a6a3a;padding:6px;background:#2a2218">${s.name}<br>${s.base}</div>
 ${box("#8c8c8c", s.props, "border-top:none")}
 ${s.implicit.length ? box("#8888ff", s.implicit) : ""}
 ${box("#8888ff", s.mods)}
</div>${glare ? `<div style="position:fixed;inset:0;background:linear-gradient(115deg,rgba(255,255,255,0) 30%,rgba(255,255,255,.18) 48%,rgba(255,255,255,0) 62%)"></div>` : ""}</body>`;

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 640, height: 600 } });
for (const s of SAMPLES) {
  await p.setViewportSize({ width: 640, height: 600 });
  await p.setContent(html(s, false));
  const el = await p.$("div");
  writeFileSync(join(out, `tooltip-${s.id}-clean.png`), (await el!.screenshot()));
  // Degraded: glare band, downscale (camera far from TV), blur, grain, 2 degree tilt.
  await p.setContent(html(s, true));
  const clean = (await p.screenshot()).toString("base64");
  await p.setViewportSize({ width: 900, height: 900 });
  await p.setContent(`<body style="margin:0;background:#050505"><svg width="900" height="900"><defs><filter id="f"><feGaussianBlur stdDeviation="0.9"/><feTurbulence baseFrequency="0.9" numOctaves="1" seed="3" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .25 0" result="g"/><feComposite in="g" in2="SourceGraphic" operator="over"/></filter></defs>
<g transform="translate(120 100) rotate(2) scale(0.62)" filter="url(#f)"><image href="data:image/png;base64,${clean}" width="640" height="600"/></g></svg></body>`);
  writeFileSync(join(out, `tooltip-${s.id}-tv.png`), await p.screenshot());
}
await b.close();
console.log("wrote", out);
