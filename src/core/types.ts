/** Where a mod line sits on the item. Drives which trade stat id prefix is used. */
export type ModKind = "explicit" | "implicit" | "rune" | "fractured" | "desecrated" | "crafted" | "enchant";
export type Affix = "prefix" | "suffix";

/** One entry of public/data/mods.json (derived from PoB2 QueryMods.lua, MIT). */
export interface ModDef {
  id: string;
  text: string;
  type: string;
  category: string;
  sign?: true;
  /** slot name -> [min, max] roll (mean of both numbers for "Adds # to #" mods). */
  slots: Record<string, [number, number]>;
}

/** public/data/stats.json: trade template text -> { trade type -> stat id }. */
export type StatTable = Record<string, Record<string, string>>;

export interface ParsedLine {
  raw: string;
  kind: ModKind;
  affix?: Affix;
  tier?: number;
  /** Group id for lines belonging to one hybrid affix (advanced format only). */
  group?: number;
  /** Numbers found in the line, in order. Roll ranges "45(40-55)" yield 45. */
  values: number[];
  /** Line with numbers replaced by "#", sign and roll-range notation removed. */
  skeleton: string;
}

export interface ParsedItem {
  itemClass?: string;
  rarity?: string;
  name?: string;
  baseType?: string;
  itemLevel?: number;
  waystoneTier?: number;
  advanced: boolean;
  corrupted: boolean;
  lines: ParsedLine[];
  warnings: string[];
}

export interface MatchCandidate {
  text: string;
  /** 0..1. 1 = exact skeleton match. */
  score: number;
  exact: boolean;
  /** Trade stat id for the line's kind, if the stat table has one. */
  tradeId?: string;
  /** Values aligned to the "#" slots of the matched template. */
  rolls: number[];
  /** Roll range for the item's slot, if known. */
  range?: [number, number];
  /** True when a range exists for the item class slot. */
  slotKnown: boolean;
}

export type Confidence = "high" | "medium" | "low" | "none";

export interface LineMatch {
  line: ParsedLine;
  candidates: MatchCandidate[];
  confidence: Confidence;
}
