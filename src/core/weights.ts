import profiles from "../../data/profiles.json";

export type WeightSource = "normalized" | "profile" | "manual";
export interface Weight { value: number; source: WeightSource; note?: string }

export interface ProfileRule { id: string; match: string; slots?: string[]; multiplier: Record<string, number> }
export interface Profiles { version: number; note: string; roles: Record<string, string>; rules: ProfileRule[] }
export const PROFILES = profiles as unknown as Profiles;

/** Panger9-style normalization: every mod contributes up to 100 points at its max roll. */
export function normalizedWeight(range: [number, number] | undefined): number | undefined {
  if (!range) return undefined;
  const max = Math.max(Math.abs(range[0]), Math.abs(range[1]));
  return max > 0 ? 100 / max : undefined;
}

export interface WeightInput {
  /** Skeleton of the mod text (lower-case, numbers as "#"). */
  skeleton: string;
  range: [number, number] | undefined;
  /** PoB-style slot keys for the item, e.g. ["Boots"]. */
  slotKeys: string[];
  role?: string;
  manual?: number;
}

/** Weight resolution order: manual override > profile-adjusted normalized > normalized. Undefined when no range is known. */
export function resolveWeight(i: WeightInput, profs: Profiles = PROFILES): Weight | undefined {
  if (i.manual !== undefined && Number.isFinite(i.manual)) return { value: i.manual, source: "manual" };
  const base = normalizedWeight(i.range);
  if (base === undefined) return undefined;
  if (i.role) {
    for (const rule of profs.rules) {
      if (!new RegExp(rule.match).test(i.skeleton)) continue;
      if (rule.slots && !rule.slots.some((s) => i.slotKeys.includes(s))) continue;
      const mult = rule.multiplier[i.role] ?? rule.multiplier["default"] ?? 1;
      return { value: base * mult, source: "profile", note: `${rule.id} x${mult}` };
    }
  }
  return { value: base, source: "normalized", note: `100 / ${Math.max(Math.abs(i.range![0]), Math.abs(i.range![1]))}` };
}
