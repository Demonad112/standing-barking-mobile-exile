import type { ModKind } from "./types.js";

const NUM = /(?<![\w.])[+-]?\d+(?:\.\d+)?/g;
// "45(40-55)": rolled value followed by its tier range (advanced copy format)
const ROLL_RANGE = /(\d+(?:\.\d+)?)\(\s*-?\d+(?:\.\d+)?\s*-\s*-?\d+(?:\.\d+)?\s*\)/g;
const TAG = /\s*\((implicit|rune|fractured|desecrated|crafted|enchant|augment)\)\s*$/i;

export interface Normalized {
  skeleton: string;
  values: number[];
  kind?: ModKind;
}

/** Strip a trailing "(implicit)"-style tag, returning the kind it implies. */
export function stripTag(line: string): { text: string; kind?: ModKind } {
  const m = TAG.exec(line);
  if (!m) return { text: line.trim() };
  const t = m[1]!.toLowerCase();
  const kind: ModKind = t === "augment" ? "rune" : (t as ModKind);
  return { text: line.slice(0, m.index).trim(), kind };
}

/** Replace every number with "#" (sign dropped), lower-case, collapse whitespace. */
export function skeletonOf(text: string): string {
  return text.replace(NUM, "#").replace(/\s+/g, " ").trim().toLowerCase();
}

export function normalizeLine(line: string): Normalized {
  const { text, kind } = stripTag(line);
  const noRange = text.replace(ROLL_RANGE, "$1");
  const values = [...noRange.matchAll(NUM)].map((m) => Number(m[0]));
  return { skeleton: skeletonOf(noRange), values, kind };
}

/** Slots of a trade template: "#" or a literal number ("per 25 Strength"), in order. */
export function templateSlots(text: string): Array<number | "#"> {
  return [...text.matchAll(/#|\d+(?:\.\d+)?/g)].map((m) => (m[0] === "#" ? "#" : Number(m[0])));
}
