import { parseItem } from "../core/parseItem.js";
import type { ParsedItem } from "../core/types.js";

export interface OcrLineIn { text: string; confidence: number }

const RULE = /^[\s\-—–_=~.·•|]{4,}$/;

/**
 * Turn OCR lines into a ParsedItem. Tooltip photos rarely include the "Item Class" line, so a neutral header is
 * prepended; the user picks the class on the Review screen. Rule lines (----) become section separators.
 * Returns per-parsed-line OCR confidence, looked up by the line text.
 */
export function parseOcrLines(lines: OcrLineIn[]): { item: ParsedItem; conf: Array<number | undefined> } {
  const text = ["Rarity: Rare", "?", "?", "--------", ...lines.map((l) => (RULE.test(l.text) ? "--------" : l.text.replace(/[|]/g, "I")))].join("\n");
  const item = parseItem(text);
  item.warnings = item.warnings.filter((w) => !/rarity/i.test(w));
  const byText = new Map(lines.map((l) => [l.text.replace(/[|]/g, "I").trim(), l.confidence]));
  return { item, conf: item.lines.map((l) => byText.get(l.raw)) };
}
