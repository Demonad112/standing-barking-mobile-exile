import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AffixIndex, type AffixData } from "../src/core/affixes.js";
import { buildIndex } from "../src/core/modIndex.js";
import type { ModDef, StatTable } from "../src/core/types.js";

const data = (f: string) => JSON.parse(readFileSync(join(__dirname, "../public/data", f), "utf8"));
export const index = buildIndex(data("mods.json") as ModDef[], data("stats.json") as StatTable);
export const fixtureDir = join(__dirname, "fixtures");
export const fixtures = readdirSync(fixtureDir).filter((f) => f.endsWith(".txt")).map((f) => f.replace(/\.txt$/, ""));
export const fixture = (name: string) => readFileSync(join(fixtureDir, `${name}.txt`), "utf8");
export const affixes = new AffixIndex(data("affixes.json") as AffixData);
