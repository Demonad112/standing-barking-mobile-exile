import type { Combine } from "./core/regex.js";
import { DEFAULT_CHAR_LIMIT } from "./core/regex.js";
import type { SortKey } from "./core/tradeClient.js";
import type { ValueMode } from "./core/scoring.js";

export interface Settings {
  league: string;
  /** Profile role key, or "" for plain normalized weights. */
  role: string;
  /** Max price in exalted; undefined = no cap. */
  priceCap?: number;
  /** Min item level filter; undefined = none. */
  minIlvl?: number;
  /** Weighted-sum group minimum; undefined = auto (90% of the scanned item's score). */
  minScore?: number;
  valueMode: ValueMode;
  sortKey: SortKey;
  mode: Combine;
  limit: number;
  overflow: "none" | "drop" | "split";
  useMinInRegex: boolean;
  /** Listings to fetch in Mode B. */
  target: number;
}

export const DEFAULT_SETTINGS: Settings = {
  league: "Standard", role: "", valueMode: "ratio", sortKey: "value", mode: "all",
  limit: DEFAULT_CHAR_LIMIT, overflow: "none", useMinInRegex: true, target: 20,
};
