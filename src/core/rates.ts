/** Currency ids as used in trade listings ("exalted", "divine", "chaos", ...) -> value in Exalted. */
export interface RatesTable {
  /** Exalted per 1 unit of each currency; "exalted" is implicitly 1. */
  rates: Record<string, number>;
  /** Epoch ms the rates were fetched or entered. */
  asOf: number;
  source: string;
}

export interface Price { amount: number; currency: string }

export function toExalted(p: Price | undefined, t: RatesTable | undefined): number | undefined {
  if (!p || !(p.amount >= 0)) return undefined;
  if (p.currency === "exalted") return p.amount;
  const r = t?.rates[p.currency];
  return r !== undefined && r > 0 ? p.amount * r : undefined;
}

export const exaltedPerDivine = (t: RatesTable | undefined) => t?.rates["divine"];

/** Merge providers in priority order; the first table that has a currency wins. Result is stamped with the oldest asOf. */
export function mergeRates(tables: Array<RatesTable | undefined>): RatesTable | undefined {
  const ok = tables.filter((t): t is RatesTable => !!t);
  if (!ok.length) return undefined;
  const rates: Record<string, number> = {};
  for (const t of [...ok].reverse()) Object.assign(rates, t.rates);
  return { rates, asOf: Math.min(...ok.map((t) => t.asOf)), source: ok.map((t) => t.source).join(" + ") };
}
