// Mode B client: search -> fetch -> score locally -> rank. Talks to our Worker proxy through an injectable transport.
// Adaptive min-score and backoff follow PoB2 (MIT) TradeQueryRequests.lua. Live API behaviour is UNVERIFIED.
import { matchLine } from "./matchMods.js";
import type { ModIndex } from "./modIndex.js";
import { normalizeLine, stripGGG } from "./normalize.js";
import { RateLimiter, backoffMs } from "./rateLimit.js";
import { toExalted, exaltedPerDivine, type RatesTable } from "./rates.js";
import { rollOf, value as valueOf, type ValueMode } from "./scoring.js";
import type { ParsedLine, ModKind } from "./types.js";

export interface TransportResponse { status: number; headers: Record<string, string>; json: any }
export type Transport = (req: { method: "GET" | "POST"; path: string; body?: unknown }) => Promise<TransportResponse>;

export type Status =
  | { type: "request"; what: "search" | "fetch"; attempt: number }
  | { type: "wait"; ms: number; reason: "rate-limit" | "429" }
  | { type: "adapt"; direction: "raise" | "lower"; minScore: number; total: number };

export interface ClientDeps {
  transport: Transport;
  sleep: (ms: number) => Promise<void>;
  limiter?: RateLimiter;
  onStatus?: (s: Status) => void;
}

export class TradeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const POLICY = { search: "trade-search-request-limit", fetch: "trade-fetch-request-limit" } as const;
export const SEARCH_CAP = 10_000;
export const FETCH_BATCH = 10;

async function call(d: ClientDeps, what: "search" | "fetch", req: Parameters<Transport>[0], maxAttempts = 6): Promise<any> {
  const limiter = d.limiter ?? (d.limiter = new RateLimiter());
  const policy = POLICY[what];
  for (let attempt = 1; ; attempt++) {
    const w = limiter.waitMs(policy);
    if (w > 0) { d.onStatus?.({ type: "wait", ms: w, reason: "rate-limit" }); await d.sleep(w); }
    d.onStatus?.({ type: "request", what, attempt });
    limiter.record(policy);
    const res = await d.transport(req);
    limiter.update(policy, res.headers);
    if (res.status === 429) {
      if (attempt >= maxAttempts) throw new TradeError(429, "Rate limited; gave up after retries.");
      const ms = backoffMs(attempt, Number(res.headers["retry-after"] ?? 0));
      d.onStatus?.({ type: "wait", ms, reason: "429" });
      await d.sleep(ms);
      continue;
    }
    if (res.status >= 400) {
      const msg = res.json?.error?.message ?? `HTTP ${res.status}`;
      throw new TradeError(res.status, String(msg));
    }
    return res.json;
  }
}

export interface RawListing {
  id: string;
  listing: { price?: { amount: number; currency: string; type?: string }; whisper?: string; account?: { name?: string } };
  item: {
    name?: string; typeLine?: string; rarity?: string; ilvl?: number;
    explicitMods?: string[]; implicitMods?: string[]; runeMods?: string[]; enchantMods?: string[]; pseudoMods?: string[];
  };
}

export interface BreakdownRow { text: string; roll: number; weight: number; contribution: number }
export interface Listing {
  id: string;
  name: string;
  typeLine: string;
  account?: string;
  whisper?: string;
  price?: { amount: number; currency: string };
  priceExalted?: number;
  /** Locally computed: sum(weight * roll). */
  score: number;
  /** The site's own "Sum: x" from pseudoMods, when present (rounded by the site). */
  serverScore?: number;
  value?: number;
  breakdown: BreakdownRow[];
  unmatched: string[];
}

/** hash used to key weights: "explicit.stat_123" and "fractured.stat_123" share "stat_123". */
export const statHash = (id: string) => id.slice(id.indexOf(".") + 1);

const KIND_FIELDS: Array<[keyof RawListing["item"], ModKind]> = [
  ["explicitMods", "explicit"], ["implicitMods", "implicit"], ["runeMods", "rune"], ["enchantMods", "enchant"],
];

export function scoreListing(
  raw: RawListing, weightsByHash: ReadonlyMap<string, number>, index: ModIndex, itemClass: string | undefined,
  rates?: RatesTable, mode: ValueMode = "ratio",
): Listing {
  const breakdown: BreakdownRow[] = [];
  const unmatched: string[] = [];
  for (const [field, kind] of KIND_FIELDS) {
    for (const rawLine of (raw.item[field] as string[] | undefined) ?? []) {
      const text = stripGGG(rawLine);
      for (const part of text.split("\n")) {
        const n = normalizeLine(part);
        const line: ParsedLine = { raw: part, kind, values: n.values, skeleton: n.skeleton };
        const m = matchLine(line, itemClass, index);
        const top = m.candidates[0];
        if (!top?.exact) { unmatched.push(part); continue; }
        const id = top.tradeId ?? Object.values(index.all.find((e) => e.text === top.text)?.ids ?? {})[0];
        const w = id ? weightsByHash.get(statHash(id)) : undefined;
        if (w === undefined) continue;
        const roll = rollOf(top.rolls);
        breakdown.push({ text: part, roll, weight: w, contribution: w * roll });
      }
    }
  }
  const score = breakdown.reduce((a, b) => a + b.contribution, 0);
  const sum = raw.item.pseudoMods?.map((p) => /Sum:\s*([-\d.]+)/.exec(p)?.[1]).find(Boolean);
  const price = raw.listing.price ? { amount: raw.listing.price.amount, currency: raw.listing.price.currency } : undefined;
  const priceExalted = toExalted(price, rates);
  const v = valueOf(score, priceExalted, mode, exaltedPerDivine(rates));
  return {
    id: raw.id,
    name: raw.item.name ?? "",
    typeLine: raw.item.typeLine ?? "",
    ...(raw.listing.account?.name ? { account: raw.listing.account.name } : {}),
    ...(raw.listing.whisper ? { whisper: raw.listing.whisper } : {}),
    ...(price ? { price } : {}),
    ...(priceExalted !== undefined ? { priceExalted } : {}),
    score,
    ...(sum ? { serverScore: Number(sum) } : {}),
    ...(v !== undefined ? { value: v } : {}),
    breakdown, unmatched,
  };
}

export type SortKey = "value" | "score" | "price";
export function sortListings(list: Listing[], key: SortKey): Listing[] {
  const cmp = (a: Listing, b: Listing): number => {
    if (key === "score") return b.score - a.score;
    if (key === "price") return (a.priceExalted ?? Infinity) - (b.priceExalted ?? Infinity);
    return (b.value ?? -Infinity) - (a.value ?? -Infinity);
  };
  return [...list].sort((a, b) => cmp(a, b) || b.score - a.score);
}

export interface RankOptions {
  league: string;
  realm?: string;
  buildBody: (minScore: number) => object;
  initialMinScore: number;
  /** Listings to fetch and rank. */
  target?: number;
  maxRecursion?: number;
  /** Result cap above which the search counts as clipped (site: 10,000). Overridable for tests. */
  cap?: number;
}

export interface SearchOutcome {
  raw: RawListing[];
  total: number;
  finalMinScore: number;
  queryId?: string;
  attempts: number;
  warnings: string[];
}

const sumOf = (r: RawListing) => Number(r.item.pseudoMods?.map((p) => /Sum:\s*([-\d.]+)/.exec(p)?.[1]).find(Boolean) ?? NaN);

async function fetchIds(d: ClientDeps, ids: string[], queryId: string): Promise<RawListing[]> {
  const out: RawListing[] = [];
  for (let i = 0; i < ids.length; i += FETCH_BATCH) {
    const batch = ids.slice(i, i + FETCH_BATCH);
    const json = await call(d, "fetch", { method: "GET", path: `/fetch/${batch.join(",")}?query=${encodeURIComponent(queryId)}` });
    out.push(...((json?.result ?? []) as RawListing[]));
  }
  return out;
}

/** Search with adaptive min score (PoB2): raise when clipped at 10k results, halve when too few. */
export async function searchAdaptive(d: ClientDeps, o: RankOptions): Promise<SearchOutcome> {
  const realm = o.realm ?? "poe2";
  const target = o.target ?? 20;
  const maxRec = o.maxRecursion ?? 5;
  const cap = o.cap ?? SEARCH_CAP;
  const warnings: string[] = [];
  let min = o.initialMinScore;
  let prev: { id: string; ids: string[] } | undefined;
  let last: { id: string; ids: string[]; total: number } | undefined;

  let attempts = 0;
  for (; attempts < maxRec; ) {
    attempts++;
    const json = await call(d, "search", { method: "POST", path: `/search/${realm}/${encodeURIComponent(o.league)}`, body: o.buildBody(min) });
    const ids: string[] = json?.result ?? [];
    const total: number = json?.total ?? ids.length;
    last = { id: json?.id, ids, total };
    if (total >= cap && attempts < maxRec) {
      const head = await fetchIds(d, ids.slice(0, FETCH_BATCH), json.id);
      const top = head.length ? sumOf(head[0]!) : NaN;
      if (!Number.isFinite(top)) { warnings.push("Search clipped at 10,000 results and no weight sum was returned; showing the best available."); break; }
      const next = (top + min) / 2;
      min = next > min ? next : min * 1.5 + 1;
      d.onStatus?.({ type: "adapt", direction: "raise", minScore: min, total });
      prev = { id: json.id, ids };
      continue;
    }
    if (total < target && attempts < maxRec && min > 0.5) {
      prev = { id: json.id, ids };
      min = min / 2;
      d.onStatus?.({ type: "adapt", direction: "lower", minScore: min, total });
      continue;
    }
    break;
  }
  if (!last) throw new TradeError(0, "No search was performed.");
  if (last.total >= cap) warnings.push("Still more than the result cap after the retry cap; ranking the top of an incomplete set.");
  if (last.total === 0 && !prev) return { raw: [], total: 0, finalMinScore: min, attempts, warnings: [...warnings, "No matching listings."] };

  const ids = last.ids.slice(0, target);
  const raw = ids.length ? await fetchIds(d, ids, last.id) : [];
  if (raw.length < target && prev && prev.id !== last.id) {
    const have = new Set(raw.map((r) => r.id));
    const fill = prev.ids.filter((i) => !have.has(i)).slice(0, target - raw.length);
    raw.push(...(await fetchIds(d, fill, prev.id)));
  }
  if (!raw.length) warnings.push("No matching listings.");
  return { raw, total: last.total, finalMinScore: min, queryId: last.id, attempts, warnings };
}
