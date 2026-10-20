import { REPOE_CLASS_TO_APP, type AffixIndex, type BaseInfo } from "../core/affixes.js";
import { normalizeLine } from "../core/normalize.js";
import { parseItem } from "../core/parseItem.js";
import type { ParsedItem } from "../core/types.js";

/** One recognised line. y0/y1 are the line box top/bottom in the OCR image; they reveal tooltip section breaks. */
export interface OcrLineIn { text: string; confidence: number; y0?: number; y1?: number }

export interface OcrCtx {
  /** Base-type names + mod data: used to find the item base in the header lines. */
  affixes?: AffixIndex;
  /** True when a line skeleton is a known mod text. Used to re-join wrapped mod lines and to tell mod sections from properties. */
  known?: (skeleton: string) => boolean;
}

const RULE = /^[\s\-—–_=~.·•|]{4,}$/;
const RULE_LINE = "--------";
const LOOKALIKE: Record<string, string> = { O: "0", o: "0", l: "1", I: "1", "|": "1", S: "5", s: "5", B: "8" };

/** Fix digit look-alikes inside numeric tokens: "+4S" -> "+45", "l0%" -> "10%". Tokens with no real digit are left alone. */
export function fixDigits(text: string): string {
  return text.replace(/(?<![A-Za-z])[+\-]?[0-9OolI|SsB]{1,5}(?:\.[0-9OolI|SsB]{1,2})?%?(?![A-Za-z])/g, (tok) =>
    /\d/.test(tok) ? tok.replace(/[OolI|SsB]/g, (c) => LOOKALIKE[c]!) : tok);
}

const LABELS = /^(item level|requires?|quality|armour|evasion rating|energy shield|ward|block chance|physical damage|elemental damage|critical hit chance|attacks per second|reload time|waystone tier|stack size|spirit|area level|rune sockets?)\b/i;

/**
 * Clean one OCR line: drop border/glare junk at the ends, collapse spaces, repair digit look-alikes, and restore the colon
 * OCR often loses after property labels ("Item Level 81" -> "Item Level: 81"). Returns "" for noise.
 */
export function cleanLine(raw: string): string {
  let t = raw.replace(/[|]/g, "I").replace(/\s+/g, " ").trim();
  if (RULE.test(t)) return t;
  t = t.replace(/^[^A-Za-z0-9+\-(]+/, "").replace(/^[-+]\s+/, "").replace(/^(?:[A-Za-z]\s+)+(?=[A-Za-z]{2})/, "").replace(/[^A-Za-z0-9%)]+$/, "");
  if (!/[A-Za-z]{3}/.test(t) && !/\d/.test(t)) return "";
  t = fixDigits(t);
  const m = LABELS.exec(t);
  if (m && !/^[^:]*:/.test(t)) t = `${m[1]}: ${t.slice(m[0].length).replace(/^[\s:.,;]+/, "")}`;
  return t;
}

/** Re-join a mod line the tooltip wrapped onto two or three lines when only the joined text is a known mod. */
function joinWrapped(lines: OcrLineIn[], known: (skeleton: string) => boolean): OcrLineIn[] {
  const sk = (t: string) => normalizeLine(t).skeleton;
  const out: OcrLineIn[] = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i]!;
    if (RULE.test(a.text) || known(sk(a.text))) { out.push(a); continue; }
    let merged: OcrLineIn | undefined;
    for (const n of [1, 2]) {
      const parts = lines.slice(i, i + 1 + n);
      if (parts.length < 1 + n || parts.some((p) => RULE.test(p.text))) break;
      const text = parts.map((p) => p.text).join(" ");
      if (known(sk(text))) {
        const last = parts[parts.length - 1]!;
        merged = { text, confidence: Math.min(...parts.map((p) => p.confidence)), ...(a.y0 !== undefined ? { y0: a.y0 } : {}), ...(last.y1 !== undefined ? { y1: last.y1 } : {}) };
        i += n;
        break;
      }
    }
    out.push(merged ?? a);
  }
  return out;
}

/** Insert rule lines where the vertical gap is clearly bigger than the usual line spacing (the tooltip's divider bars). */
export function addSectionBreaks(lines: OcrLineIn[]): OcrLineIn[] {
  const withY = lines.filter((l) => l.y0 !== undefined && l.y1 !== undefined && !RULE.test(l.text));
  if (withY.length < 4) return lines;
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i - 1]!, c = lines[i]!;
    if (p.y1 !== undefined && c.y0 !== undefined) gaps.push(c.y0 - p.y1);
  }
  // Baseline = a low percentile of the gaps (normal line spacing), robust to a few big section gaps among few lines.
  const sorted = [...gaps].sort((a, b) => a - b);
  const base = sorted[Math.floor(sorted.length * 0.3)] ?? 0;
  const limit = Math.max(base * 1.8, base + 6);
  const out: OcrLineIn[] = [];
  for (let i = 0; i < lines.length; i++) {
    const p = lines[i - 1], c = lines[i]!;
    if (p && p.y1 !== undefined && c.y0 !== undefined && !RULE.test(p.text) && !RULE.test(c.text) && c.y0 - p.y1 > limit) out.push({ text: RULE_LINE, confidence: 100 });
    out.push(c);
  }
  return out;
}

/**
 * Turn OCR lines into a ParsedItem. The base type is looked up in the header lines (so the item class comes from the photo);
 * if it is not found the user picks the class on the Review screen. Divider gaps become section separators, and when two
 * sections hold mods the first one is tagged implicit (it is not a prefix/suffix).
 * Returns per-parsed-line OCR confidence, looked up by the line text.
 */
export function parseOcrLines(lines: OcrLineIn[], ctx: OcrCtx = {}): { item: ParsedItem; conf: Array<number | undefined>; base?: BaseInfo } {
  let ls = lines.map((l) => ({ ...l, text: cleanLine(l.text) })).filter((l) => l.text);
  if (ctx.known) ls = joinWrapped(ls, ctx.known);
  ls = addSectionBreaks(ls);

  // Header = the first lines (rule lines skipped: stray junk above the name can trigger a section break).
  const head = ls.filter((l) => !RULE.test(l.text)).slice(0, 10).map((l) => l.text);
  const base = ctx.affixes?.detectBase(head);
  const cls = base ? REPOE_CLASS_TO_APP[base.className] : undefined;
  let name = "?";
  if (base) {
    const at = head.findIndex((h) => h.toLowerCase().includes(base.base.toLowerCase()));
    name = at > 0 ? head[at - 1]! : base.base;
  }

  // Which sections hold mods? With two or more, the first is the implicit section.
  const known = ctx.known;
  const isMod = (l: OcrLineIn) => !!known && !RULE.test(l.text) && known(normalizeLine(l.text).skeleton);
  const sections: OcrLineIn[][] = [[]];
  for (const l of ls) { if (RULE.test(l.text)) sections.push([]); else sections[sections.length - 1]!.push(l); }
  const modSections = sections.filter((s) => s.some(isMod));
  // Implicits are one or two lines; a longer first section is more likely a false break inside the explicit mods.
  const implicitSection = modSections.length >= 2 && modSections[0]!.filter(isMod).length <= 2 ? modSections[0] : undefined;

  const body = ls.map((l) => (RULE.test(l.text) ? RULE_LINE : implicitSection?.includes(l) && isMod(l) ? `${l.text} (implicit)` : l.text));
  const text = [...(cls ? [`Item Class: ${cls}`] : []), "Rarity: Rare", name, base?.base ?? "?", RULE_LINE, ...body].join("\n");
  const item = parseItem(text);
  item.warnings = item.warnings.filter((w) => !/rarity/i.test(w));
  if (!base) item.baseType = undefined;
  const byText = new Map(ls.map((l) => [l.text.trim(), l.confidence]));
  return { item, conf: item.lines.map((l) => byText.get(l.raw.replace(/\s*\(implicit\)$/i, "")) ?? byText.get(l.raw)), ...(base ? { base } : {}) };
}
