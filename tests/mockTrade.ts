import type { Transport, TransportResponse } from "../src/core/tradeClient.js";

export interface MockMod { id: string; text: (roll: number) => string; roll: number }
export interface MockListing { id: string; mods: MockMod[]; price?: { amount: number; currency: string } }

export interface MockOptions {
  market: MockListing[];
  /** Responses forced before normal service, e.g. [429, 429]. */
  failFirst?: Array<{ status: number; headers?: Record<string, string> }>;
  headers?: Record<string, string>;
}

/** In-memory stand-in for the trade2 search/fetch API: weight group filter, statgroup.0 sort, Sum: pseudo mod. */
export function mockTrade(o: MockOptions) {
  const log: Array<{ path: string; method: string; min?: number }> = [];
  const searches = new Map<string, string[]>();
  const queue = [...(o.failFirst ?? [])];
  let seq = 0;
  const sum = (l: MockListing, w: Map<string, number>) => l.mods.reduce((a, m) => a + (w.get(m.id) ?? 0) * m.roll, 0);

  const transport: Transport = async ({ method, path, body }): Promise<TransportResponse> => {
    const base = { headers: { ...(o.headers ?? {}) } };
    const forced = queue.shift();
    if (forced) { log.push({ path, method }); return { status: forced.status, headers: { ...base.headers, ...(forced.headers ?? {}) }, json: {} }; }
    if (method === "POST") {
      const q = (body as any).query;
      const group = q.stats.find((g: any) => g.type === "weight");
      const w = new Map<string, number>(group.filters.map((f: any) => [f.id, f.value.weight]));
      const min: number = group.value?.min ?? 0;
      log.push({ path, method, min });
      const hits = o.market.map((l) => ({ l, s: Math.round(sum(l, w) * 10) / 10 })).filter((x) => x.s >= min).sort((a, b) => b.s - a.s);
      const id = `q${++seq}`;
      searches.set(id, hits.map((h) => h.l.id));
      return { status: 200, ...base, json: { id, total: hits.length, result: hits.slice(0, 100).map((h) => h.l.id) } };
    }
    log.push({ path, method });
    const m = /\/fetch\/([^?]+)\?query=(.+)$/.exec(path)!;
    const qid = decodeURIComponent(m[2]!);
    const group = [...searches.keys()].includes(qid);
    if (!group) return { status: 404, ...base, json: { error: { message: "unknown query" } } };
    const ids = m[1]!.split(",");
    const w = lastWeights.get(qid)!;
    void w;
    return {
      status: 200, ...base,
      json: { result: ids.map((id) => {
        const l = o.market.find((x) => x.id === id)!;
        return {
          id,
          listing: { price: l.price, whisper: `@seller hi ${id}`, account: { name: `acct-${id}` } },
          item: {
            name: `Item ${id}`, typeLine: "Ruby Ring", rarity: "Rare",
            explicitMods: l.mods.map((x) => x.text(x.roll)),
            pseudoMods: [`Sum: ${Math.round(sumFor(l, qid) * 10) / 10}`],
          },
        };
      }) },
    };
  };
  const lastWeights = new Map<string, Map<string, number>>();
  const sumFor = (l: MockListing, qid: string) => sum(l, lastWeights.get(qid) ?? new Map());
  // capture weights per query id
  const wrapped: Transport = async (req) => {
    const res = await transport(req);
    if (req.method === "POST" && res.status === 200) {
      const group = (req.body as any).query.stats.find((g: any) => g.type === "weight");
      lastWeights.set(res.json.id, new Map<string, number>(group.filters.map((f: any) => [f.id, f.value.weight])));
    }
    return res;
  };
  return { transport: wrapped, log };
}
