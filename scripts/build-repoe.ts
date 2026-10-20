// Build-time only. Derives public/data/affixes.json (+ merges extra trade stat ids) from:
//   RePoE fork PoE2 export (MIT, (c) 2016 brather1ng): mods.min.json, base_items.min.json
//   Sidekick data/poe2/en/trade-stats.json (MIT, (c) 2020 Dominique Alexandre)
// Game data (c) Grinding Gear Games.
// Usage: pnpm data:repoe [--repoe <dir-or-url>] [--sidekick <path-to-trade-stats.json|url>]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stripGGG } from "../src/core/normalize.js";
import { affixSkeleton, type AffixData } from "../src/core/affixes.js";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1]! : d; };
const REPOE = arg("--repoe", "https://repoe-fork.github.io/poe2");
const SIDEKICK = arg("--sidekick", "https://raw.githubusercontent.com/Sidekick-Poe/Sidekick/main/data/poe2/en/trade-stats.json");
const outDir = resolve("public/data");
mkdirSync(outDir, { recursive: true });

async function load<T>(src: string): Promise<T> {
  if (/^https?:/.test(src)) {
    const r = await fetch(src, { headers: { "User-Agent": "poe2-item-search build script" } });
    if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
    return (await r.json()) as T;
  }
  return JSON.parse(readFileSync(src, "utf8")) as T;
}
const repoeFile = (f: string) => (/^https?:/.test(REPOE) ? `${REPOE}/${f}` : join(REPOE, f));

interface RMod {
  domain: string; generation_type: string; groups: string[]; name: string; required_level: number; type: string;
  spawn_weights: Array<{ tag: string; weight: number }>; text?: string; is_essence_only: boolean;
}
interface RBase { domain: string; item_class: string; name: string; release_state: string; tags: string[] }

const mods = await load<Record<string, RMod>>(repoeFile("mods.min.json"));
const bases = await load<Record<string, RBase>>(repoeFile("base_items.min.json"));

const tags: string[] = [];
const tagIdx = new Map<string, number>();
const tag = (t: string) => { let i = tagIdx.get(t); if (i === undefined) { i = tags.length; tags.push(t); tagIdx.set(t, i); } return i; };
const types: string[] = [];
const typeIdx = new Map<string, number>();
const type = (t: string) => { let i = typeIdx.get(t); if (i === undefined) { i = types.length; types.push(t); typeIdx.set(t, i); } return i; };

const out: AffixData = { v: 1, tags, types, mods: [], bySkel: {}, bases: {}, classes: {} };

for (const m of Object.values(mods)) {
  if (m.domain !== "item" || (m.generation_type !== "prefix" && m.generation_type !== "suffix") || !m.text) continue;
  // Skip placeholder rows ("TBD") with zero ranges.
  if (m.name === "TBD") continue;
  const lines = stripGGG(m.text).split("\n");
  const ranges: Array<Array<[number, number]>> = [];
  const skels: string[] = [];
  for (const l of lines) {
    const { skeleton, slots } = affixSkeleton(l);
    skels.push(skeleton);
    ranges.push(slots);
  }
  const idx = out.mods.length;
  out.mods.push([
    m.generation_type === "prefix" ? 0 : 1, type(m.type), m.required_level, m.name,
    m.spawn_weights.map((w) => [tag(w.tag), w.weight] as [number, number]), ranges,
  ]);
  skels.forEach((s, li) => { (out.bySkel[s] ??= []).push([idx, li]); });
}

// Base types: name -> [classIdx, tagIdx[]]
const classNames: string[] = [];
const classIdx = new Map<string, number>();
for (const b of Object.values(bases)) {
  if (b.domain !== "item" || b.release_state !== "released" || b.item_class === "HiddenItem" || b.item_class === "TrapTool") continue;
  let ci = classIdx.get(b.item_class);
  if (ci === undefined) { ci = classNames.length; classNames.push(b.item_class); classIdx.set(b.item_class, ci); }
  out.bases[b.name] = [ci, b.tags.map(tag)];
}
out.classNames = classNames;

// Distinct tag sets per class (for "class known, base unknown").
for (const [name, [ci, ts]] of Object.entries(out.bases)) {
  void name;
  const key = JSON.stringify([...ts].sort((a, b) => a - b));
  const list = (out.classes[classNames[ci]!] ??= []);
  if (!list.some((x) => JSON.stringify([...x].sort((a, b) => a - b)) === key)) list.push(ts);
}

// Extra trade stat ids from Sidekick's copy of the official trade2 stats list; merge into stats.json (additive only).
const sk = await load<Array<{ id: string; text: string }>>(SIDEKICK);
const statsPath = join(outDir, "stats.json");
const stats = JSON.parse(readFileSync(statsPath, "utf8")) as Record<string, Record<string, string>>;
const norm = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();
let added = 0, newTexts = 0;
for (const e of sk) {
  const [prefix] = e.id.split(".");
  if (!prefix || prefix === "pseudo" || prefix === "skill" || prefix === "sanctum") continue;
  const t = norm(e.text);
  const type = prefix === "rune" ? "augment" : prefix;
  const row = (stats[t] ??= (newTexts++, {}));
  if (!row[type]) { row[type] = e.id; added++; }
}
writeFileSync(statsPath, JSON.stringify(stats));
writeFileSync(join(outDir, "affixes.json"), JSON.stringify(out));

const meta = JSON.parse(readFileSync(join(outDir, "meta.json"), "utf8")) as Record<string, unknown>;
meta["affixes"] = {
  source: "RePoE fork PoE2 mods/base_items (MIT) + Sidekick trade-stats (MIT). Game data (c) Grinding Gear Games.",
  builtAt: new Date().toISOString(), mods: out.mods.length, skeletons: Object.keys(out.bySkel).length, bases: Object.keys(out.bases).length,
  tradeIdsAdded: added, newStatTexts: newTexts,
};
writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
console.log(meta["affixes"]);
