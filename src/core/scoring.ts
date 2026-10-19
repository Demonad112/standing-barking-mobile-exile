/** Roll of a mod line: the value itself, or the mean for multi-number mods ("Adds # to #"). */
export function rollOf(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export interface ScoredMod { id: string; roll: number }

/** score = sum(weight * roll) over mods present in the weight table. */
export function score(mods: ScoredMod[], weights: ReadonlyMap<string, number>): number {
  let s = 0;
  for (const m of mods) {
    const w = weights.get(m.id);
    if (w !== undefined) s += w * m.roll;
  }
  return s;
}

export type ValueMode = "ratio" | "pob";

/**
 * "ratio": score / price (spec default; favours cheap items strongly).
 * "pob":   score - 0.1 * log10(price in divine), PoB's "Stat Value / Price" (only slightly punishes price).
 * Returns undefined when the price is unknown or not positive.
 */
export function value(scoreValue: number, priceExalted: number | undefined, mode: ValueMode, exaltedPerDivine?: number): number | undefined {
  if (priceExalted === undefined || !(priceExalted > 0)) return undefined;
  if (mode === "ratio") return scoreValue / priceExalted;
  if (!exaltedPerDivine || !(exaltedPerDivine > 0)) return undefined;
  return scoreValue - 0.1 * Math.log10(priceExalted / exaltedPerDivine);
}
