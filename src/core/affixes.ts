// Prefix/suffix + tier inference from RePoE mod data (MIT). A plain tooltip photo has no affix markers, so the
// affix is inferred from (line text, rolled values, item base tags, item level). Inferred, not read: shown as such.
import { skeletonOf } from "./normalize.js";

/** public/data/affixes.json. Compact on purpose; see scripts/build-repoe.ts. */
export interface AffixData {
  v: 1;
  tags: string[];
  /** RePoE mod "type" (a tier family, e.g. "LocalBaseArmourAndEvasionRating"). */
  types: string[];
  /** [gen 0=prefix 1=suffix, typeIdx, requiredLevel, name, spawnWeights [tagIdx, weight][] (ordered), per-line slot ranges] */
  mods: Array<[0 | 1, number, number, string, Array<[number, number]>, Array<Array<[number, number]>>]>;
  /** line skeleton -> [modIdx, lineIdx][] */
  bySkel: Record<string, Array<[number, number]>>;
  /** base type name -> [classIdx, tagIdx[]] */
  bases: Record<string, [number, number[]]>;
  classNames?: string[];
  /** RePoE item class -> distinct tag sets of its bases */
  classes: Record<string, number[][]>;
}

const RANGE_OR_NUM = /[+-]?\(\s*(-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)\s*\)|[+-]?\d+(?:\.\d+)?/g;

/** Skeleton of a RePoE mod line plus the [lo, hi] of each numeric slot ("(5-8)" -> [5,8], literal 25 -> [25,25]). */
export function affixSkeleton(line: string): { skeleton: string; slots: Array<[number, number]> } {
  const slots: Array<[number, number]> = [];
  const replaced = line.replace(RANGE_OR_NUM, (m, lo?: string, hi?: string) => {
    if (lo !== undefined && hi !== undefined) {
      const a = Math.abs(Number(lo)), b = Math.abs(Number(hi));
      slots.push([Math.min(a, b), Math.max(a, b)]);
    } else {
      const v = Math.abs(Number(m));
      slots.push([v, v]);
    }
    return "#";
  });
  return { skeleton: skeletonOf(replaced), slots };
}

export interface AffixInfo {
  affix: "prefix" | "suffix";
  /** Best (lowest) tier number consistent with the roll; tierMax is the worst. Equal when the roll is unambiguous. */
  tier?: number;
  tierMax?: number;
  /** Tier names ("Supple") of the candidate tiers, best first. */
  names: string[];
  /** Roll ranges of the matched tier(s) for each numeric slot of the line. */
  slots?: Array<[number, number]>;
  /** [min, max] across all tiers that can spawn on this base, first slot. Feeds 100/maxRoll weights. */
  span?: [number, number];
  /** True when the rolled values matched no tier; the affix is a guess from text and base only. */
  approx: boolean;
  /** Mod family id. Lines of one hybrid affix resolve to the same family, so they count as one prefix/suffix. */
  family: number;
}

export interface BaseInfo { base: string; className: string; classIdx: number; tags: number[] }

/** RePoE item class -> this app's Item Class names (modIndex.ITEM_CLASSES). */
export const REPOE_CLASS_TO_APP: Record<string, string> = {
  "Body Armour": "Body Armours", Helmet: "Helmets", Gloves: "Gloves", Boots: "Boots", Shield: "Shields", Buckler: "Bucklers",
  Focus: "Foci", "One Hand Mace": "One Hand Maces", "Two Hand Mace": "Two Hand Maces", Warstaff: "Quarterstaves", Staff: "Staves",
  Spear: "Spears", Bow: "Bows", Crossbow: "Crossbows", Talisman: "Talismans", Ring: "Rings", Amulet: "Amulets",
  "One Hand Sword": "One Hand Swords", "Two Hand Sword": "Two Hand Swords", "One Hand Axe": "One Hand Axes", "Two Hand Axe": "Two Hand Axes",
  Dagger: "Daggers", Flail: "Flails", Belt: "Belts", Wand: "Wands", Sceptre: "Sceptres", Claw: "Claws", Quiver: "Quivers",
};
const APP_TO_REPOE = Object.fromEntries(Object.entries(REPOE_CLASS_TO_APP).map(([k, v]) => [v.toLowerCase(), k]));

const EPS = 1e-6;
const inRange = (v: number, r: [number, number]) => { const a = Math.abs(v); return a >= r[0] - EPS && a <= r[1] + EPS; };

function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

export class AffixIndex {
  private readonly tagId = new Map<string, number>();
  private readonly byType = new Map<number, number[]>();
  private readonly baseNames: Array<{ name: string; low: string }>;
  private readonly baseByLow = new Map<string, string>();

  constructor(readonly data: AffixData) {
    data.tags.forEach((t, i) => this.tagId.set(t, i));
    data.mods.forEach((m, i) => { const l = this.byType.get(m[1]); if (l) l.push(i); else this.byType.set(m[1], [i]); });
    this.baseNames = Object.keys(data.bases).map((name) => ({ name, low: name.toLowerCase() })).sort((a, b) => b.low.length - a.low.length);
    for (const b of this.baseNames) this.baseByLow.set(b.low, b.name);
  }

  /** Does the mod's ordered spawn-weight list let it roll on an item with these tags? (first matching tag decides) */
  private spawns(mod: number, tags: Set<number>): boolean {
    for (const [t, w] of this.data.mods[mod]![4]) if (tags.has(t)) return w > 0;
    return false;
  }

  /** Tag sets to test against: the exact base if known, else every distinct set in the class, else none (no spawn filter). */
  tagSetsFor(base: string | undefined, itemClass: string | undefined): Array<Set<number>> {
    const b = base ? this.data.bases[base] : undefined;
    if (b) return [new Set(b[1])];
    const rc = itemClass ? APP_TO_REPOE[itemClass.toLowerCase()] ?? (this.data.classes[itemClass] ? itemClass : undefined) : undefined;
    return (rc && this.data.classes[rc] ? this.data.classes[rc]! : []).map((s) => new Set(s));
  }

  /** Substring search over base type names for the manual picker. */
  searchBases(q: string, limit = 6): Array<{ name: string; className: string; appClass?: string }> {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out: Array<{ name: string; className: string; appClass?: string }> = [];
    for (const b of this.baseNames) {
      if (!words.every((w) => b.low.includes(w))) continue;
      const className = this.data.classNames?.[this.data.bases[b.name]![0]] ?? "";
      const appClass = REPOE_CLASS_TO_APP[className];
      out.push({ name: b.name, className, ...(appClass ? { appClass } : {}) });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Find a known base type name in header lines (exact, contained in a magic/rare name, or within 2 typos). */
  detectBase(lines: string[]): BaseInfo | undefined {
    const cands = lines.map((l) => l.trim()).filter((l) => l.length >= 3 && l.length <= 60 && !/\d{2,}/.test(l)).slice(0, 12);
    const make = (name: string): BaseInfo => {
      const [ci, tags] = this.data.bases[name]!;
      return { base: name, className: this.data.classNames?.[ci] ?? "", classIdx: ci, tags };
    };
    for (const l of cands) { const n = this.baseByLow.get(l.toLowerCase()); if (n) return make(n); }
    for (const l of cands) {
      const low = l.toLowerCase();
      for (const b of this.baseNames) if (b.low.length >= 4 && low.includes(b.low)) return make(b.name);
    }
    for (const l of cands) {
      const low = l.toLowerCase();
      let best: { name: string; d: number } | undefined;
      for (const b of this.baseNames) {
        if (b.low.length < 5) continue;
        const d = lev(low, b.low, 2);
        if (d <= 2 && (!best || d < best.d)) best = { name: b.name, d };
      }
      if (best) return make(best.name);
    }
    return undefined;
  }

  /**
   * Resolve one mod line. `values` are the numbers on the line in order (as normalizeLine yields them).
   * Returns undefined when no prefix/suffix mod has this text, or prefix and suffix both fit and nothing separates them.
   */
  lookup(skeleton: string, values: number[], tagSets: Array<Set<number>>, itemLevel?: number): AffixInfo | undefined {
    const entries = this.data.bySkel[skeleton];
    if (!entries) return undefined;
    const ok = (mod: number) => (tagSets.length === 0 || tagSets.some((t) => this.spawns(mod, t))) && (itemLevel === undefined || this.data.mods[mod]![2] <= itemLevel);
    // An item level the mod's lowest tier exceeds still yields a guess, so ilvl is a soft filter.
    let pool = entries.filter(([m]) => ok(m));
    if (!pool.length) pool = entries.filter(([m]) => tagSets.length === 0 || tagSets.some((t) => this.spawns(m, t)));
    if (!pool.length) return undefined;

    const fits = (m: number, li: number) => {
      const slots = this.data.mods[m]![5][li]!;
      return slots.length === values.length && slots.every((r, i) => inRange(values[i]!, r));
    };
    let hit = pool.filter(([m, li]) => fits(m, li));
    const approx = hit.length === 0;
    if (approx) hit = pool;

    const gens = new Set(hit.map(([m]) => this.data.mods[m]![0]));
    if (gens.size !== 1) return undefined;
    const affix = [...gens][0] === 0 ? "prefix" : "suffix";

    // Several mod families can share a line's text (a pure "+# to Armour" and the Armour half of an Armour/Evasion hybrid).
    // Prefer a single-line family, then the one with most matching tiers, and read the tier from that family only.
    const byType = new Map<number, Array<[number, number]>>();
    for (const h of hit) { const t = this.data.mods[h[0]]![1]; const l = byType.get(t); if (l) l.push(h); else byType.set(t, [h]); }
    const [chosenType, chosenHits] = [...byType.entries()].sort((x, y) => {
      const pure = (e: Array<[number, number]>) => (this.data.mods[e[0]![0]]![5].length === 1 ? 0 : 1);
      return pure(x[1]) - pure(y[1]) || y[1].length - x[1].length;
    })[0]!;

    // Tier = rank by required level within the family among mods that can spawn on this base (T1 = highest level).
    const same = (this.byType.get(chosenType) ?? []).filter((x) => tagSets.length === 0 || tagSets.some((t) => this.spawns(x, t)));
    const levels = [...new Set(same.map((x) => this.data.mods[x]![2]))].sort((a, b) => b - a);
    const tiers = chosenHits.map(([m]) => levels.indexOf(this.data.mods[m]![2]) + 1).filter((t) => t > 0);
    const sorted = [...chosenHits].sort((a, b) => this.data.mods[b[0]]![2] - this.data.mods[a[0]]![2]);
    const names = [...new Set(sorted.map(([m]) => this.data.mods[m]![3]))];

    const span = (() => {
      const lo: number[] = [], hi: number[] = [];
      for (const [m, li] of pool) {
        if (this.data.mods[m]![1] !== chosenType) continue;
        const r = this.data.mods[m]![5][li]![0];
        if (r) { lo.push(r[0]); hi.push(r[1]); }
      }
      return lo.length ? ([Math.min(...lo), Math.max(...hi)] as [number, number]) : undefined;
    })();
    const best = sorted[0]!;
    return {
      affix, names, approx, family: chosenType,
      ...(tiers.length && !approx ? { tier: Math.min(...tiers), tierMax: Math.max(...tiers) } : {}),
      ...(!approx ? { slots: this.data.mods[best[0]]![5][best[1]]! } : {}),
      ...(span ? { span } : {}),
    };
  }
}

/** "T2" or "T2–3" */
export const tierLabel = (i: Pick<AffixInfo, "tier" | "tierMax">): string | undefined =>
  i.tier === undefined ? undefined : i.tierMax !== undefined && i.tierMax !== i.tier ? `T${i.tier}–${i.tierMax}` : `T${i.tier}`;
