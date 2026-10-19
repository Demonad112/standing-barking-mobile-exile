import { normalizeLine, stripTag } from "./normalize.js";
import type { Affix, ModKind, ParsedItem, ParsedLine } from "./types.js";

const SEP = /^-{4,}\s*$/;
const PROPERTY = /^(item class|rarity|item level|requires?|quality|sockets?|armour|evasion rating|energy shield|ward|block chance|physical damage|elemental damage|fire damage|cold damage|lightning damage|chaos damage|critical hit chance|attacks per second|reload time|waystone tier|limited to|stack size|charges|spirit|area level|grants skill|level|rune sockets?|base defence percentile|critical strike chance|recovery per second)\b.*:/i;
const IGNORE = /^(corrupted|twice corrupted|mirrored|unidentified|fractured item|split|unmodifiable|note:|place into|right click|can be|travel to|this item |this waystone)/i;
const ADV_HEADER = /^\{\s*(.*?)\s*\}$/;

function headerKind(h: string): { kind: ModKind; affix?: Affix; tier?: number } {
  const low = h.toLowerCase();
  const tier = /\(tier:\s*(\d+)\)/i.exec(h);
  const affix: Affix | undefined = /prefix/.test(low) ? "prefix" : /suffix/.test(low) ? "suffix" : undefined;
  const kind: ModKind = /implicit/.test(low) ? "implicit"
    : /desecrated/.test(low) ? "desecrated"
    : /fractured/.test(low) ? "fractured"
    : /crafted/.test(low) ? "crafted"
    : /rune|augment/.test(low) ? "rune"
    : /enchant/.test(low) ? "enchant"
    : "explicit";
  return { kind, affix, ...(tier ? { tier: Number(tier[1]) } : {}) };
}

/**
 * Parse copied item text (Ctrl+C plain, or Ctrl+Alt+C advanced with "{ ... }" mod headers).
 * Format details are UNVERIFIED against live game output; see docs/FINDINGS.md.
 */
export function parseItem(text: string): ParsedItem {
  const rows = text.replace(/\r/g, "").split("\n").map((l) => l.trim());
  const sections: string[][] = [[]];
  for (const r of rows) {
    if (SEP.test(r)) sections.push([]);
    else if (r) sections[sections.length - 1]!.push(r);
  }
  const advanced = rows.some((r) => ADV_HEADER.test(r));
  const item: ParsedItem = { advanced, corrupted: false, lines: [], warnings: [] };

  const head = sections[0] ?? [];
  const rest: string[] = [];
  for (const l of head) {
    const m = /^(item class|rarity):\s*(.+)$/i.exec(l);
    if (m) (m[1]!.toLowerCase() === "rarity" ? (item.rarity = m[2]) : (item.itemClass = m[2]));
    else rest.push(l);
  }
  item.name = rest[0];
  item.baseType = rest[1] ?? rest[0];
  if (!item.rarity) item.warnings.push("Rarity not found; paste the full item text.");

  let group = 0;
  for (const sec of sections.slice(1)) {
    let cur: { kind: ModKind; affix?: Affix; tier?: number; group: number } | undefined;
    for (const l of sec) {
      let m = /^item level:\s*(\d+)/i.exec(l);
      if (m) { item.itemLevel = Number(m[1]); continue; }
      m = /^waystone tier:\s*(\d+)/i.exec(l);
      if (m) { item.waystoneTier = Number(m[1]); continue; }
      if (/^corrupted$/i.test(l)) { item.corrupted = true; continue; }
      const h = ADV_HEADER.exec(l);
      if (h) { cur = { ...headerKind(h[1]!), group: ++group }; continue; }
      if (PROPERTY.test(l) || IGNORE.test(l)) continue;
      const tag = stripTag(l);
      const n = normalizeLine(l);
      if (n.values.length === 0 && !cur && !tag.kind) continue; // flavour text / labels
      const parsed: ParsedLine = {
        raw: l,
        kind: cur?.kind ?? tag.kind ?? "explicit",
        ...(cur?.affix ? { affix: cur.affix } : {}),
        ...(cur?.tier ? { tier: cur.tier } : {}),
        ...(cur ? { group: cur.group } : {}),
        values: n.values,
        skeleton: n.skeleton,
      };
      item.lines.push(parsed);
    }
  }
  if (!item.itemLevel) item.warnings.push("Item level not found; ask the user.");
  return item;
}

/** Parse one mod line typed or edited by the user. */
export function lineFromText(raw: string, kind: ModKind = "explicit"): ParsedLine {
  const n = normalizeLine(raw);
  return { raw, kind: n.kind ?? kind, values: n.values, skeleton: n.skeleton };
}

/** Prefix/suffix limits. Only lines with a known affix are counted (advanced format or manual tagging). */
export function validateAffixes(item: Pick<ParsedItem, "rarity" | "lines">): string[] {
  // A hybrid affix spans several lines but is one affix: count each group once.
  const seen = new Set<number>();
  const count = { prefix: 0, suffix: 0 };
  for (const l of item.lines) {
    if (!l.affix) continue;
    if (l.group !== undefined) {
      if (seen.has(l.group)) continue;
      seen.add(l.group);
    }
    count[l.affix]++;
  }
  const max = /magic/i.test(item.rarity ?? "") ? 1 : 3;
  const out: string[] = [];
  if (count.prefix > max) out.push(`Too many prefixes: ${count.prefix} (max ${max}).`);
  if (count.suffix > max) out.push(`Too many suffixes: ${count.suffix} (max ${max}).`);
  return out;
}
