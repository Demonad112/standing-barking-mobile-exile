// Build-time only. Converts Path of Building (PoE2) Lua data (MIT) into the JSON the app ships.
// Usage: pnpm data:build [path-to-pob2-checkout]   (default: vendor/pob2)
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseLuaTable, type LuaTable } from "./lib/luaTable.js";

const root = resolve(process.argv[2] ?? "vendor/pob2");
const outDir = resolve("public/data");
mkdirSync(outDir, { recursive: true });

const load = (f: string) => parseLuaTable(readFileSync(join(root, "src/Data", f), "utf8")) as LuaTable;

// --- trade stats: text -> { tradeType -> id } -------------------------------
const tradeStats = load("TradeSiteStats.lua");
const groups = (tradeStats.__array ?? []) as LuaTable[];
const stats: Record<string, Record<string, string>> = {};
for (const g of groups) {
  for (const e of (g.entries as LuaTable).__array as LuaTable[]) {
    const type = String(e.type);
    if (type === "pseudo") continue;
    (stats[String(e.text)] ??= {})[type] = String(e.id);
  }
}

// --- QueryMods: per-slot roll ranges ---------------------------------------
const query = load("QueryMods.lua");
interface Mod { id: string; text: string; type: string; category: string; sign?: true; slots: Record<string, [number, number]> }
const mods: Mod[] = [];
for (const [category, byHash] of Object.entries(query)) {
  if (category === "__array") continue;
  for (const entry of Object.values(byHash as LuaTable) as LuaTable[]) {
    const tm = entry.tradeMod as LuaTable | undefined;
    if (!tm) continue;
    const slots: Record<string, [number, number]> = {};
    for (const [k, v] of Object.entries(entry)) {
      if (k === "tradeMod" || k === "specialCaseData" || k === "usePositiveSign") continue;
      const r = v as LuaTable;
      if (typeof r.min === "number" && typeof r.max === "number") slots[k] = [r.min, r.max];
    }
    mods.push({
      id: String(tm.id), text: String(tm.text), type: String(tm.type), category,
      ...(entry.usePositiveSign ? { sign: true as const } : {}), slots,
    });
  }
}
mods.sort((a, b) => a.id.localeCompare(b.id) || a.category.localeCompare(b.category));

let commit = "unknown", date = "unknown";
try {
  commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"]).toString().trim();
  date = execFileSync("git", ["-C", root, "log", "-1", "--format=%cI"]).toString().trim();
} catch { /* not a git checkout */ }

const meta = {
  source: "PathOfBuilding-PoE2 src/Data/{QueryMods,TradeSiteStats}.lua (MIT). Game data (c) Grinding Gear Games.",
  pob2Commit: commit, pob2CommitDate: date, builtAt: new Date().toISOString(),
  counts: { mods: mods.length, statTexts: Object.keys(stats).length },
};
writeFileSync(join(outDir, "mods.json"), JSON.stringify(mods));
writeFileSync(join(outDir, "stats.json"), JSON.stringify(stats));
writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
console.log(meta);
