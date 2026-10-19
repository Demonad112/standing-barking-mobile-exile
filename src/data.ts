import { buildIndex, type ModIndex } from "./core/modIndex.js";
import type { ModDef, StatTable } from "./core/types.js";

export interface Meta { source: string; pob2Commit: string; pob2CommitDate: string; builtAt: string; counts: { mods: number; statTexts: number } }
export interface DataBundle { index: ModIndex; meta: Meta }

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to load ${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** Static JSON shipped with the app (precached by the service worker). No runtime network beyond our own origin. */
export async function loadData(): Promise<DataBundle> {
  const base = `${import.meta.env.BASE_URL}data/`;
  const [mods, stats, meta] = await Promise.all([getJson<ModDef[]>(`${base}mods.json`), getJson<StatTable>(`${base}stats.json`), getJson<Meta>(`${base}meta.json`)]);
  return { index: buildIndex(mods, stats), meta };
}
