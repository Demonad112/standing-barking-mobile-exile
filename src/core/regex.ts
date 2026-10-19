// Own regex generator for the in-game stash/vendor search. Idea credit: poe.re (no code or data reused).
// Regex features used (\d, [], (|), ., ^/$, quoted AND terms) are the ones poe.re ships in production;
// that the game's search accepts every output here is UNVERIFIED until checked in game.
import { slotKeysFor, type IndexedText, type ModIndex } from "./modIndex.js";

export const DEFAULT_CHAR_LIMIT = 250; // poe.re's constant; the game's real cap is UNVERIFIED

const SPECIAL = /[\\^$.*+?()[\]{}|]/g;
export const escapeRegex = (s: string) => s.replace(SPECIAL, "\\$&");

/** Regex matching a whole non-negative integer >= min (up to 3+ digits). Empty string for min <= 0. */
export function atLeast(min: number): string {
  min = Math.floor(min);
  if (!(min > 0)) return "";
  const s = String(min);
  const L = s.length;
  const alts: string[] = [];
  for (let i = L - 1; i >= 0; i--) {
    const d = Number(s[i]);
    const prefix = s.slice(0, i);
    const rest = "\\d".repeat(L - i - 1);
    if (i === L - 1) alts.push(`${prefix}${d === 9 ? "9" : `[${d}-9]`}`);
    else if (d < 9) alts.push(`${prefix}${d + 1 === 9 ? "9" : `[${d + 1}-9]`}${rest}`);
  }
  alts.push("\\d".repeat(L + 1) + "\\d*");
  return alts.length === 1 ? alts[0]! : `(${alts.join("|")})`;
}

/** Universe of texts a fragment must not collide with, for an item class. */
export function universeFor(index: ModIndex, target: IndexedText, itemClass: string | undefined): IndexedText[] {
  const keys = slotKeysFor(itemClass);
  const hasRange = (e: IndexedText) => Object.values(e.ranges).some((c) => Object.keys(c).length > 0);
  const inClass = (e: IndexedText) => Object.values(e.ranges).some((c) => keys.some((k) => c[k]));
  const u = keys.length ? index.all.filter(inClass) : index.all.filter((e) => !hasRange(e));
  return u.includes(target) ? u : [...u, target];
}

export interface ModRegex {
  text: string;
  /** Fragment only, e.g. "increased attack speed$". */
  fragment: string;
  /** Fragment with the optional min-roll number pattern in front. */
  regex: string;
  unique: boolean;
}

interface Cand { frag: string; anchored: boolean }

function* candidates(text: string): Generator<Cand> {
  const t = text.toLowerCase();
  const segs = t.split("#");
  const out: Cand[] = [];
  segs.forEach((seg, si) => {
    const last = si === segs.length - 1;
    for (let a = 0; a < seg.length; a++) {
      if (seg[a] === " ") continue;
      for (let b = a + 1; b <= seg.length; b++) {
        if (seg[b - 1] === " ") continue;
        out.push({ frag: seg.slice(a, b), anchored: false });
        if (last && b === seg.length) out.push({ frag: seg.slice(a, b), anchored: true });
      }
    }
  });
  out.sort((x, y) => x.frag.length + (x.anchored ? 1 : 0) - (y.frag.length + (y.anchored ? 1 : 0)));
  yield* out;
}

function collides(c: Cand, e: IndexedText): boolean {
  const segs = e.text.toLowerCase().split("#");
  if (c.anchored) return segs[segs.length - 1]!.endsWith(c.frag);
  return segs.some((s) => s.includes(c.frag));
}

const render = (text: string, n: number) => text.replace(/#/g, String(n));

/**
 * Shortest fragment of the mod's literal text that matches no other text in the universe.
 * Fallback for texts that start with a number (so a plain fragment can collide with "Minions have #% ..."):
 * a line-start anchored pattern "^\D?\d+<text after the number>", checked by rendering the universe and testing it.
 * `^` as a line anchor in the game's search is UNVERIFIED.
 */
export function modFragment(target: IndexedText, universe: IndexedText[]): { fragment: string; unique: boolean } {
  const others = universe.filter((e) => e !== target);
  for (const c of candidates(target.text)) {
    if (!others.some((e) => collides(c, e))) return { fragment: escapeRegex(c.frag) + (c.anchored ? "$" : ""), unique: true };
  }
  const lower = target.text.toLowerCase();
  if (lower.startsWith("#")) {
    const seg = lower.split("#")[1] ?? "";
    for (let n = 1; n <= seg.length; n++) {
      if (seg[n - 1] === " " && n < seg.length) { /* allow inner spaces */ }
      for (const end of [false, true]) {
        const tail = seg.slice(0, n);
        if (end && n !== seg.length) continue;
        const frag = `^\\D?\\d+${escapeRegex(tail)}${end ? "$" : ""}`;
        const re = new RegExp(frag, "i");
        const hit = others.some((e) => [render(e.text, 12), "+" + render(e.text, 12)].some((r) => re.test(r)));
        if (!hit) return { fragment: frag, unique: true };
      }
    }
  }
  const fallback = lower.split("#").sort((a, b) => b.length - a.length)[0]!.trim();
  return { fragment: escapeRegex(fallback), unique: false };
}

export interface RegexSelection {
  entry: IndexedText;
  /** Minimum roll for the first "#" slot; omitted = any value. */
  minRoll?: number;
  /** Used to drop the least important mods first when over the limit. */
  weight?: number;
}

/**
 * One term per mod. The min-roll pattern is placed directly before the text that follows the first "#",
 * so the fragment is widened to start at that segment's beginning.
 */
export function modRegex(sel: RegexSelection, universe: IndexedText[]): ModRegex {
  const { fragment, unique } = modFragment(sel.entry, universe);
  const num = sel.minRoll ? atLeast(sel.minRoll) : "";
  if (!num) return { text: sel.entry.text, fragment, regex: fragment, unique };
  if (fragment.startsWith("^\\D?\\d+")) return { text: sel.entry.text, fragment, regex: fragment.replace("\\d+", num), unique };
  // Anchor the number to the literal text that follows it: take the segment after the first "#".
  const segs = sel.entry.text.toLowerCase().split("#");
  const after = (segs[1] ?? "").replace(/^\s+/, "");
  const lead = segs[0]!;
  if (lead.trim() !== "" || after === "") {
    // Number not leading, or nothing follows it: cannot attach safely.
    return { text: sel.entry.text, fragment, regex: fragment, unique: false };
  }
  // Use as much of the following literal text as needed for uniqueness, via the fragment when it lies in that segment.
  const fragRaw = fragment.replace(/\\(.)/g, "$1").replace(/\$$/, "");
  const inAfter = after.includes(fragRaw);
  const tail = inAfter ? after.slice(0, after.indexOf(fragRaw) + fragRaw.length) : after;
  const anch = fragment.endsWith("$") && inAfter && after.endsWith(fragRaw) ? "$" : "";
  return { text: sel.entry.text, fragment, regex: `${num}\\D?${escapeRegex(tail)}${anch}`.replace("\\D?", "\\D*?"), unique };
}

export type Combine = "all" | "any";
export interface RegexOutput {
  strings: string[];
  terms: ModRegex[];
  dropped: RegexSelection[];
  overLimit: boolean;
  warnings: string[];
}

const join = (terms: string[], mode: Combine) => (mode === "any" ? (terms.length ? `"${terms.join("|")}"` : "") : terms.map((t) => `"${t}"`).join(" "));

/**
 * Build the search string(s). Over the limit: `drop` removes the lowest-weight mods until it fits;
 * `split` packs terms into several strings, each within the limit. Caller confirms with the user.
 */
export function generateRegex(
  sels: RegexSelection[], index: ModIndex, itemClass: string | undefined,
  opts: { mode?: Combine; limit?: number; overflow?: "drop" | "split" | "none" } = {},
): RegexOutput {
  const mode = opts.mode ?? "all", limit = opts.limit ?? DEFAULT_CHAR_LIMIT, overflow = opts.overflow ?? "none";
  const warnings: string[] = ["Verify in game: paste into the stash search and check the highlighted items."];
  const built = sels.map((s) => ({ s, r: modRegex(s, universeFor(index, s.entry, itemClass)) }));
  for (const b of built) if (!b.r.unique) warnings.push(`"${b.r.text}": no unique fragment found; may match other mods.`);
  let kept = built, dropped: RegexSelection[] = [];
  const fits = (list: typeof built) => join(list.map((b) => b.r.regex), mode).length <= limit;

  if (!fits(built) && overflow === "drop") {
    const byWeight = [...built].sort((a, b) => (b.s.weight ?? 0) - (a.s.weight ?? 0));
    kept = [];
    for (const b of byWeight) {
      const next = [...kept, b];
      if (fits(next)) kept = next; else dropped.push(b.s);
    }
    kept = built.filter((b) => kept.includes(b));
  }
  let strings: string[];
  if (!fits(built) && overflow === "split") {
    strings = [];
    let cur: string[] = [];
    for (const b of built) {
      const next = [...cur, b.r.regex];
      if (cur.length && join(next, mode).length > limit) { strings.push(join(cur, mode)); cur = [b.r.regex]; }
      else cur = next;
    }
    if (cur.length) strings.push(join(cur, mode));
  } else strings = [join(kept.map((b) => b.r.regex), mode)].filter(Boolean);
  const overLimit = strings.some((s) => s.length > limit);
  if (overLimit) warnings.push(`Over the ${limit}-character limit (${strings.map((s) => s.length).join(", ")}).`);
  if (dropped.length) warnings.push(`${dropped.length} lowest-weight mod(s) dropped to fit ${limit} characters.`);
  return { strings, terms: kept.map((b) => b.r), dropped, overLimit, warnings };
}
