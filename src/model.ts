import { candidateFromEntry, matchItem, matchLine } from "./core/matchMods.js";
import { slotKeysFor, type IndexedText, type ModIndex } from "./core/modIndex.js";
import { lineFromText } from "./core/parseItem.js";
import { skeletonOf } from "./core/normalize.js";
import { rollOf } from "./core/scoring.js";
import { buildQuery, categoryFor, type BuiltQuery, type StatSelection } from "./core/tradeQuery.js";
import type { Settings } from "./settings.js";
import type { Affix, LineMatch, MatchCandidate, ModKind, ParsedItem } from "./core/types.js";
import { resolveWeight, type Weight } from "./core/weights.js";

export type Level = "off" | "nice" | "must";

export interface Row {
  id: number;
  raw: string;
  kind: ModKind;
  affix?: Affix;
  tier?: number;
  group?: number;
  values: number[];
  skeleton: string;
  /** Tesseract line confidence 0-100, photo input only. */
  ocrConf?: number;
  match: LineMatch;
  /** Index into match.candidates the user/auto picked. */
  pick?: number;
  /** Picked by hand from the full list; overrides pick. */
  manual?: MatchCandidate;
  confirmed: boolean;
  level: Level;
  /** Manual weight override. */
  weight?: number;
  /** Must-have minimum, also used as the regex minimum roll. */
  minRoll?: number;
}

export interface ItemMeta {
  itemClass?: string;
  rarity?: string;
  name?: string;
  baseType?: string;
  itemLevel?: number;
}

/** Below this OCR confidence a line is never pre-accepted. */
export const OCR_ACCEPT = 80;

export const chosen = (r: Row): MatchCandidate | undefined => r.manual ?? (r.pick !== undefined ? r.match.candidates[r.pick] : undefined);

let nextId = 1;

export function rowsFromItem(item: ParsedItem, index: ModIndex, ocrConf?: (number | undefined)[]): Row[] {
  const matches = matchItem(item, index);
  return matches.map((m, i) => {
    const l = m.line;
    const conf = ocrConf?.[i];
    const sure = m.confidence === "high" && (conf === undefined || conf >= OCR_ACCEPT);
    return {
      id: nextId++, raw: l.raw, kind: l.kind, ...(l.affix ? { affix: l.affix } : {}), ...(l.tier ? { tier: l.tier } : {}),
      ...(l.group !== undefined ? { group: l.group } : {}), values: l.values, skeleton: l.skeleton,
      ...(conf !== undefined ? { ocrConf: conf } : {}),
      match: m,
      ...(m.candidates.length && m.confidence !== "low" ? { pick: 0 } : {}),
      confirmed: sure,
      level: sure ? "nice" : "off",
    } satisfies Row;
  });
}

/** Re-match after the user edits the text. Resets confirmation: an edited line must be re-confirmed. */
export function rematch(r: Row, raw: string, index: ModIndex, itemClass: string | undefined): Row {
  const l = lineFromText(raw, r.kind);
  const m = matchLine({ ...l, ...(r.affix ? { affix: r.affix } : {}) }, itemClass, index);
  const { manual: _m, pick: _p, ...rest } = r;
  void _m; void _p;
  return { ...rest, raw, kind: l.kind, values: l.values, skeleton: l.skeleton, match: m,
    ...(m.candidates.length && m.confidence !== "low" ? { pick: 0 } : {}), confirmed: false, level: "off" };
}

export function pickManual(r: Row, e: IndexedText, itemClass: string | undefined): Row {
  const line = { raw: r.raw, kind: r.kind, values: r.values, skeleton: r.skeleton };
  const { pick: _p, ...rest } = r;
  void _p;
  return { ...rest, manual: candidateFromEntry(e, line, itemClass), confirmed: true, level: r.level === "off" ? "nice" : r.level };
}

/** Row for the "search a mod" input: no item values, user supplies minimums. */
export function rowFromEntry(e: IndexedText, itemClass: string | undefined): Row {
  const line = { raw: e.text, kind: "explicit" as const, values: [] as number[], skeleton: e.skeleton };
  const cand = candidateFromEntry(e, line, itemClass);
  return {
    id: nextId++, raw: e.text, kind: "explicit", values: [], skeleton: e.skeleton,
    match: { line, candidates: [cand], confidence: "high" }, manual: cand, confirmed: true, level: "nice",
  };
}

export function weightOf(r: Row, itemClass: string | undefined, role: string | undefined): Weight | undefined {
  const c = chosen(r);
  if (!c) return undefined;
  return resolveWeight({
    skeleton: skeletonOf(c.text),
    range: c.range, slotKeys: slotKeysFor(itemClass), ...(role ? { role } : {}), ...(r.weight !== undefined ? { manual: r.weight } : {}),
  });
}

export const rollOfRow = (r: Row): number => {
  const c = chosen(r);
  return rollOf(c && c.rolls.length ? c.rolls : r.values);
};

export interface Selection {
  stats: StatSelection[];
  /** Included rows with no stat id or no weight; shown to the user, not silently dropped. */
  skipped: Array<{ row: Row; reason: string }>;
  /** Score of the scanned item under the current weights. */
  itemScore: number;
}

export function selectionFor(rows: Row[], itemClass: string | undefined, role: string | undefined): Selection {
  const stats: StatSelection[] = [];
  const skipped: Selection["skipped"] = [];
  let itemScore = 0;
  for (const r of rows) {
    if (!r.confirmed || r.level === "off") continue;
    const c = chosen(r);
    if (!c) { skipped.push({ row: r, reason: "no mod chosen" }); continue; }
    if (!c.tradeId) { skipped.push({ row: r, reason: "no trade stat id for this mod type" }); continue; }
    if (r.level === "must") {
      stats.push({ id: c.tradeId, min: r.minRoll ?? Math.floor(rollOfRow(r)) });
      continue;
    }
    const w = weightOf(r, itemClass, role);
    if (!w) { skipped.push({ row: r, reason: "no roll range known; set a weight manually" }); continue; }
    stats.push({ id: c.tradeId, weight: w.value });
    itemScore += w.value * rollOfRow(r);
  }
  return { stats, skipped, itemScore };
}

/** Shareable state (URL hash). Stores template text and rolls, not raw OCR lines. */
export interface Shared {
  v: 1;
  league: string;
  role?: string;
  cls?: string;
  cap?: number;
  minScore?: number;
  rows: Array<{ t: string; k: ModKind; r: number[]; l: Level; w?: number; m?: number; a?: Affix }>;
}

export function toShared(rows: Row[], s: Omit<Shared, "v" | "rows">): Shared {
  return {
    v: 1, ...s,
    rows: rows.filter((r) => r.confirmed && chosen(r)).map((r) => ({
      t: chosen(r)!.text, k: r.kind, r: chosen(r)!.rolls, l: r.level,
      ...(r.weight !== undefined ? { w: r.weight } : {}), ...(r.minRoll !== undefined ? { m: r.minRoll } : {}), ...(r.affix ? { a: r.affix } : {}),
    })),
  };
}

export function fromShared(s: Shared, index: ModIndex): { rows: Row[]; missing: string[] } {
  const rows: Row[] = [];
  const missing: string[] = [];
  for (const x of s.rows) {
    const e = index.all.find((i) => i.text === x.t);
    if (!e) { missing.push(x.t); continue; }
    const rendered = e.slots.reduce<{ out: string; k: number }>((acc, sl) => sl === "#" ? { out: acc.out.replace("#", String(x.r[acc.k] ?? "")), k: acc.k + 1 } : acc, { out: x.t, k: 0 }).out;
    const line = { raw: rendered, kind: x.k, values: x.r, skeleton: e.skeleton };
    const cand = candidateFromEntry(e, line, s.cls);
    rows.push({
      id: nextId++, raw: rendered, kind: x.k, values: x.r, skeleton: e.skeleton,
      match: { line, candidates: [cand], confidence: "high" }, manual: cand, confirmed: true, level: x.l,
      ...(x.w !== undefined ? { weight: x.w } : {}), ...(x.m !== undefined ? { minRoll: x.m } : {}), ...(x.a ? { affix: x.a } : {}),
    });
  }
  return { rows, missing };
}

export const encodeShared = (s: Shared) => btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function decodeShared(h: string): Shared | undefined {
  try {
    const j = JSON.parse(decodeURIComponent(escape(atob(h.replace(/-/g, "+").replace(/_/g, "/")))));
    return j?.v === 1 && Array.isArray(j.rows) && typeof j.league === "string" ? (j as Shared) : undefined;
  } catch { return undefined; }
}

export interface QueryPlan { sel: Selection; minScore: number; built: BuiltQuery }

/** Auto min score: 90% of the scanned item's own score, so the search finds comparable-or-better items. */
export function queryFor(rows: Row[], meta: ItemMeta, s: Settings, minOverride?: number): QueryPlan {
  const sel = selectionFor(rows, meta.itemClass, s.role || undefined);
  const minScore = minOverride ?? s.minScore ?? Math.round(sel.itemScore * 0.9 * 10) / 10;
  const cat = categoryFor(meta.itemClass);
  const built = buildQuery(sel.stats, {
    league: s.league, ...(cat ? { category: cat, rarity: "nonunique" as const } : {}),
    ...(s.minIlvl ? { minItemLevel: s.minIlvl } : {}), ...(s.priceCap ? { maxPriceExalted: s.priceCap } : {}), minScore,
  });
  return { sel, minScore, built };
}
