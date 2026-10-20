import { skeletonOf, templateSlots } from "./normalize.js";
import type { ModDef, ModKind, StatTable } from "./types.js";

export interface IndexedText {
  text: string;
  skeleton: string;
  slots: Array<number | "#">;
  /** Roll ranges: category -> slot -> [min, max]. */
  ranges: Record<string, Record<string, [number, number]>>;
  /** trade type -> stat id */
  ids: Record<string, string>;
  tokens: Set<string>;
}

export interface ModIndex {
  bySkeleton: Map<string, IndexedText[]>;
  all: IndexedText[];
}

const tokensOf = (s: string) => new Set(s.split(/[^a-z]+/).filter((t) => t.length > 2));

export function buildIndex(mods: ModDef[], stats: StatTable): ModIndex {
  const byText = new Map<string, IndexedText>();
  const get = (text: string): IndexedText => {
    let e = byText.get(text);
    if (!e) {
      const skeleton = skeletonOf(text);
      e = { text, skeleton, slots: templateSlots(text), ranges: {}, ids: stats[text] ?? {}, tokens: tokensOf(skeleton) };
      byText.set(text, e);
    }
    return e;
  };
  for (const text of Object.keys(stats)) get(text);
  for (const m of mods) {
    const e = get(m.text);
    (e.ranges[m.category] ??= {});
    for (const [slot, r] of Object.entries(m.slots)) {
      const cur = e.ranges[m.category]![slot];
      e.ranges[m.category]![slot] = cur ? [Math.min(cur[0], r[0]), Math.max(cur[1], r[1])] : r;
    }
  }
  const all = [...byText.values()];
  const bySkeleton = new Map<string, IndexedText[]>();
  for (const e of all) {
    const list = bySkeleton.get(e.skeleton);
    if (list) list.push(e); else bySkeleton.set(e.skeleton, [e]);
  }
  return { bySkeleton, all };
}

/** Which PoB range category applies to a line kind. */
export function categoryFor(kind: ModKind): string {
  return kind === "implicit" ? "Implicit" : kind === "rune" ? "Rune" : kind === "enchant" ? "Corrupted" : "Explicit";
}

/** Trade id prefix for a line kind (the stats table keys). */
export function tradeTypeFor(kind: ModKind): string {
  return kind === "rune" ? "augment" : kind;
}

/** "Item Class" text -> candidate PoB slot keys, most specific first. */
const CLASS_SLOTS: Record<string, string[]> = {
  rings: ["Ring"], amulets: ["Amulet"], belts: ["Belt"], "body armours": ["Chest", "Body Armour"],
  helmets: ["Helmet", "Helmets"], gloves: ["Gloves"], boots: ["Boots"], shields: ["Shield"], bucklers: ["Shield"],
  foci: ["Focus"], quivers: ["Quiver"], bows: ["Bow"], crossbows: ["Crossbow"], wands: ["Wand"],
  staves: ["Staff"], quarterstaves: ["Quarterstaff"], sceptres: ["Sceptre"], spears: ["Spear"],
  flails: ["Flail"], claws: ["Claw"], daggers: ["Dagger"], talismans: ["Talisman"], charms: ["Charm"],
  jewels: ["AnyJewel", "BaseJewel"], "life flasks": ["LifeFlask"], "mana flasks": ["ManaFlask"],
  "one hand maces": ["One Hand Mace", "1HMace"], "two hand maces": ["Two Hand Mace", "2HMace"],
  "one hand swords": ["One Hand Sword"], "two hand swords": ["Two Hand Sword"],
  "one hand axes": ["One Hand Axe"], "two hand axes": ["Two Hand Axe"],
};

export function slotKeysFor(itemClass: string | undefined): string[] {
  return (itemClass && CLASS_SLOTS[itemClass.toLowerCase()]) || [];
}

export const ITEM_CLASSES = [
  "Rings", "Amulets", "Belts", "Body Armours", "Helmets", "Gloves", "Boots", "Shields", "Bucklers", "Foci", "Quivers",
  "Bows", "Crossbows", "Wands", "Staves", "Quarterstaves", "Sceptres", "Spears", "Flails", "Claws", "Daggers", "Talismans",
  "One Hand Maces", "Two Hand Maces", "One Hand Swords", "Two Hand Swords", "One Hand Axes", "Two Hand Axes",
  "Jewels", "Charms", "Life Flasks", "Mana Flasks", "Waystones", "Tablets",
] as const;

/** "Tablet" / "ring" / "Rings" -> canonical class name, or undefined. */
export function canonicalClass(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const k = s.trim().toLowerCase().replace(/s$/, "");
  return ITEM_CLASSES.find((c) => c.toLowerCase().replace(/s$/, "") === k);
}
