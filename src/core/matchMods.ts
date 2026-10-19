import { categoryFor, slotKeysFor, tradeTypeFor, type IndexedText, type ModIndex } from "./modIndex.js";
import type { Confidence, LineMatch, MatchCandidate, ParsedItem, ParsedLine } from "./types.js";

const EXACT_MIN = 1;
const FUZZY_MIN = 0.55;

function rangeFor(e: IndexedText, line: ParsedLine, slotKeys: string[]): [number, number] | undefined {
  const cat = e.ranges[categoryFor(line.kind)] ?? e.ranges["Explicit"];
  if (!cat) return undefined;
  let out: [number, number] | undefined;
  for (const k of slotKeys) {
    const r = cat[k];
    if (r) out = out ? [Math.min(out[0], r[0]), Math.max(out[1], r[1])] : r;
  }
  return out;
}

/** Align item values to a template: literal numbers must equal the item's, "#" slots yield rolls. */
function align(e: IndexedText, values: number[]): number[] | undefined {
  if (e.slots.length !== values.length) return undefined;
  const rolls: number[] = [];
  for (let i = 0; i < e.slots.length; i++) {
    const s = e.slots[i]!;
    const v = values[i]!;
    if (s === "#") rolls.push(v);
    else if (Math.abs(s - Math.abs(v)) > 1e-9) return undefined;
  }
  return rolls;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return (2 * n) / (a.size + b.size);
}

function candidate(e: IndexedText, line: ParsedLine, slotKeys: string[], score: number, exact: boolean, rolls: number[]): MatchCandidate {
  const range = rangeFor(e, line, slotKeys);
  return {
    text: e.text, score, exact, rolls,
    ...(e.ids[tradeTypeFor(line.kind)] ? { tradeId: e.ids[tradeTypeFor(line.kind)]! } : {}),
    ...(range ? { range } : {}),
    slotKnown: range !== undefined,
  };
}

/** Exact skeleton match first; otherwise top-3 fuzzy by token overlap. Never auto-accepts fuzzy results. */
export function matchLine(line: ParsedLine, itemClass: string | undefined, index: ModIndex): LineMatch {
  const slotKeys = slotKeysFor(itemClass);
  const exact: MatchCandidate[] = [];
  for (const e of index.bySkeleton.get(line.skeleton) ?? []) {
    const rolls = align(e, line.values);
    if (rolls) exact.push(candidate(e, line, slotKeys, EXACT_MIN, true, rolls));
  }
  if (exact.length) {
    // Prefer candidates with a stat id for this kind and a known range for the item's slot.
    exact.sort((a, b) => Number(!!b.tradeId) - Number(!!a.tradeId) || Number(b.slotKnown) - Number(a.slotKnown));
    const top = exact[0]!;
    const confidence: Confidence = exact.length === 1 && top.tradeId ? "high" : "medium";
    return { line, candidates: exact.slice(0, 3), confidence };
  }
  const toks = new Set(line.skeleton.split(/[^a-z]+/).filter((t) => t.length > 2));
  const scored: MatchCandidate[] = [];
  for (const e of index.all) {
    const s = dice(toks, e.tokens);
    if (s >= FUZZY_MIN) scored.push(candidate(e, line, slotKeys, s, false, line.values));
  }
  scored.sort((a, b) => b.score - a.score || Number(b.slotKnown) - Number(a.slotKnown));
  const top3 = scored.slice(0, 3);
  return { line, candidates: top3, confidence: top3.length ? "low" : "none" };
}

export function matchItem(item: ParsedItem, index: ModIndex): LineMatch[] {
  return item.lines.map((l) => matchLine(l, item.itemClass, index));
}
