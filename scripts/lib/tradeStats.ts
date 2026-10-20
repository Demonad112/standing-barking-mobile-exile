// Converts the official `GET /api/trade2/data/stats` payload into public/data/stats.json.
// Payload shape taken from PoB2's saved copy (TradeSiteStats.lua): result[{id,label,entries[{id,text,type}]}].
export interface ApiStats { result: Array<{ id?: string; label?: string; entries: Array<{ id: string; text: string; type: string }> }> }
export type StatTable = Record<string, Record<string, string>>;

export function statsFromApi(payload: ApiStats): StatTable {
  if (!payload || !Array.isArray(payload.result)) throw new Error("Unexpected trade stats payload: missing result[]");
  const out: StatTable = {};
  for (const g of payload.result) {
    for (const e of g.entries ?? []) {
      if (e.type === "pseudo") continue;
      (out[e.text] ??= {})[e.type] = e.id;
    }
  }
  if (!Object.keys(out).length) throw new Error("Trade stats payload contained no entries");
  return out;
}
