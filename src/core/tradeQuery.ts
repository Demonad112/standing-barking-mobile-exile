// Builds trade2 search JSON. Shapes follow PoB2 (MIT) TradeQueryGenerator.lua and poe.re's TradeUrlBuilder;
// neither was verified against the live site (see docs/FINDINGS.md sections 3 and 5).

export interface StatSelection {
  id: string;
  weight?: number;
  /** Must-have: goes in the "and" group with value.min. */
  min?: number;
}

export interface QueryOptions {
  league: string;
  /** trade2 category option, e.g. "accessory.ring". Mutually usable with baseType. */
  category?: string;
  baseType?: string;
  rarity?: "nonunique" | "rare" | "magic" | "normal";
  minItemLevel?: number;
  /** Max price in exalted. */
  maxPriceExalted?: number;
  /** Minimum weighted score (group value.min). */
  minScore?: number;
  status?: "securable" | "available" | "onlineleague" | "online" | "any";
}

export const COMPLEXITY_LIMIT = 200;
const WEIGHT_GROUP_BASE = 54;   // PoB: baseline cost of a weight group
const TYPE_FILTER_COST = 4;     // PoB: rarity + category
const AND_GROUP_COST = 4;
const MUST_COST = 4;
const WEIGHT_COST = 4;
const EXTRA_FILTER_COST = 3;    // price / item level (PoB's value for comparable filters)
const MIN_BUDGET_TO_ADD = 8;

export interface BuiltQuery {
  body: { query: Record<string, unknown>; sort: Record<string, string> };
  used: number;
  limit: number;
  keptWeighted: StatSelection[];
  droppedWeighted: StatSelection[];
  droppedMust: StatSelection[];
  warnings: string[];
}

export function buildQuery(stats: StatSelection[], o: QueryOptions): BuiltQuery {
  const warnings: string[] = [];
  const must = stats.filter((s) => s.min !== undefined);
  const nice = stats.filter((s) => s.min === undefined && s.weight !== undefined && s.weight !== 0)
    .sort((a, b) => Math.abs(b.weight!) - Math.abs(a.weight!));

  let budget = COMPLEXITY_LIMIT - WEIGHT_GROUP_BASE - TYPE_FILTER_COST - AND_GROUP_COST;
  const filters: Record<string, unknown> = {};
  if (o.category || o.rarity) {
    filters["type_filters"] = { filters: {
      ...(o.category ? { category: { option: o.category } } : {}),
      ...(o.rarity ? { rarity: { option: o.rarity } } : {}),
    } };
  }
  if (o.minItemLevel) { budget -= EXTRA_FILTER_COST; filters["misc_filters"] = { disabled: false, filters: { ilvl: { min: o.minItemLevel } } }; }
  if (o.maxPriceExalted) { budget -= EXTRA_FILTER_COST; filters["trade_filters"] = { filters: { price: { option: "exalted", max: o.maxPriceExalted } } }; }

  const keptMust: StatSelection[] = [], droppedMust: StatSelection[] = [];
  for (const m of must) {
    if (budget < MIN_BUDGET_TO_ADD) droppedMust.push(m);
    else { budget -= MUST_COST; keptMust.push(m); }
  }
  const kept: StatSelection[] = [], dropped: StatSelection[] = [];
  for (const n of nice) {
    if (budget < MIN_BUDGET_TO_ADD) dropped.push(n);
    else { budget -= WEIGHT_COST; kept.push(n); }
  }
  if (droppedMust.length) warnings.push(`${droppedMust.length} must-have mod(s) dropped: complexity limit reached.`);
  if (dropped.length) warnings.push(`${dropped.length} lowest-weight mod(s) dropped: complexity limit reached.`);

  const groups: unknown[] = [];
  if (kept.length) {
    groups.push({
      type: "weight",
      ...(o.minScore !== undefined ? { value: { min: o.minScore } } : {}),
      filters: kept.map((k) => ({ id: k.id, value: { weight: k.weight } })),
    });
  }
  if (keptMust.length) groups.push({ type: "and", filters: keptMust.map((k) => ({ id: k.id, value: { min: k.min } })) });

  const query: Record<string, unknown> = {
    status: { option: o.status ?? "securable" },
    ...(o.baseType ? { type: o.baseType } : {}),
    stats: groups,
    filters,
  };
  // Weight group, when present, is stats[0] ("statgroup.0"); otherwise sort by price.
  const sort: Record<string, string> = kept.length ? { "statgroup.0": "desc" } : { price: "asc" };
  return {
    body: { query, sort },
    used: COMPLEXITY_LIMIT - budget,
    limit: COMPLEXITY_LIMIT,
    keptWeighted: kept, droppedWeighted: dropped, droppedMust, warnings,
  };
}

/** poe.re-style link. UNVERIFIED with weight groups. */
export function tradeUrl(body: object, league: string): string {
  return `https://www.pathofexile.com/trade2/search/poe2/${encodeURIComponent(league)}?q=${encodeURIComponent(JSON.stringify(body))}`;
}

/** PoB-style link: path segment is base64url(gzip(query object)). UNVERIFIED (gzip vs zlib wrapper, site acceptance). */
export async function tradeUrlPob(body: { query: object }, league: string): Promise<string> {
  const stream = new Blob([JSON.stringify(body.query)]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_");
  return `https://www.pathofexile.com/trade2/search/${encodeURIComponent(league)}/${b64}`;
}

/** Item class -> trade2 type_filters category option (PoB TradeHelpers.getTradeCategory; waystone from poe.re). */
export const CATEGORY_BY_CLASS: Record<string, string> = {
  rings: "accessory.ring", amulets: "accessory.amulet", belts: "accessory.belt",
  "body armours": "armour.chest", helmets: "armour.helmet", gloves: "armour.gloves", boots: "armour.boots",
  shields: "armour.shield", bucklers: "armour.buckler", foci: "armour.focus", quivers: "armour.quiver",
  bows: "weapon.bow", crossbows: "weapon.crossbow", wands: "weapon.wand", sceptres: "weapon.sceptre",
  staves: "weapon.staff", quarterstaves: "weapon.warstaff", spears: "weapon.spear", flails: "weapon.flail",
  claws: "weapon.claw", daggers: "weapon.dagger", talismans: "weapon.talisman",
  "one hand swords": "weapon.onesword", "two hand swords": "weapon.twosword",
  "one hand axes": "weapon.oneaxe", "two hand axes": "weapon.twoaxe",
  "one hand maces": "weapon.onemace", "two hand maces": "weapon.twomace",
  jewels: "jewel", "life flasks": "flask.life", "mana flasks": "flask.mana",
  waystones: "map.waystone",
};
export const categoryFor = (itemClass: string | undefined) => (itemClass ? CATEGORY_BY_CLASS[itemClass.toLowerCase()] : undefined);
