# Decisions

Answers to the open questions from `FINDINGS.md` section 6, made without live access to pathofexile.com or data.poe.re. Each is reversible.

| # | Decision | Why | Revisit when |
|---|---|---|---|
| 1 | **Own dataset and regex generator.** Mod text, stat ids and per-slot roll ranges come from PoB2's MIT `QueryMods.lua` and `TradeSiteStats.lua`, converted at build time (`pnpm data:update`). No poe.re code or data. | poe.re and its data are unlicensed and unreachable here. | `veiset` grants a license, or live data access allows `pnpm data:trade-stats`. |
| 2 | **`pnpm data:update` rebuilds from a PoB2 checkout** (`vendor/pob2`), not from data.poe.re. `pnpm data:trade-stats` (live trade2 stats, needs `CONTACT=`) is written but untested, and only replaces the id table. | Prompt's `fetch-data.ts` targeted poe.re. | Network access is allowed. |
| 3 | **Value metric is a toggle** between `score / price` (spec) and PoB's `score − 0.1·log10(price in divine)`. Default is the spec's ratio. | Ratio overrates cheap junk; PoB's formula needs a Divine rate. | After using both on real listings. |
| 4 | **Complexity budget instead of a flat 35.** Costs copied from PoB2 (200 total, 54 weight-group baseline, 4 per filter). About 33 weighted mods at defaults. | PoB's limit is complexity, not count (FINDINGS 3.2). | Live API shows different costs. |
| 5 | **Fetch batch is 10**, not 100. | PoB uses 10; spec's 100 is unverified. | Live API verified. |
| 6 | **Default link is `?q=<json>`** (poe.re production form), plus a PoB-style base64-gzip link as an alternative. | Both unverified with weight groups; `?q=` is proven in production for plain searches. | A real weighted URL is checked. |
| 7 | **Auto min score = 90% of the scanned item's own score**, editable. Adaptive raise/halve follows PoB. | Finds comparable-or-better items by default. | Real use. |
| 8 | **Price rates are manual entry only.** poe2scout / poe.ninja are not wired. | Their endpoints were not verified; inventing URLs breaks hard rule 2. `rates.ts` has the merge/convert logic ready. | Endpoints verified. |
| 9 | **Regex fragments**: shortest unique within the item class's mod universe, minimum 4 characters, word-aligned preferred, rejected if inside known property labels; line-anchored fallback `^\D?\d+…` for number-first mods. Defaults to the 250-char limit, configurable. | Tiny fragments risk false hits on bases/names (poe.re's AGENTS.md warns of this). | In-game testing. |
| 10 | **Vendor and Relic regex pages are not implemented.** Item (all classes), Waystone and Tablet work through the same generator. | Vendor/Relic rules are poe.re-specific; no data source. | Real need. |
| 11 | **PoB2 weight import (optional Phase 6) is not implemented.** | Optional; out of scope without PoB export samples. | Requested. |
| 12 | **Pushes happen only on request;** earlier push was explicitly approved. | Hard rule 6. | — |

## Affix inference from RePoE (2026-10-20)

- **Problem:** photos (and plain Ctrl+C text) carry no prefix/suffix info, so affix counts and tiers were empty.
- **Choice:** build `affixes.json` from RePoE `mods`/`base_items` (MIT). Lookup key = line skeleton; filter by the base's spawn tags (first matching tag in the mod's ordered spawn list decides, weight > 0), item level >= required level (soft), and all rolled values inside a tier's range. Tier = rank of required level within the mod family among mods that can spawn on that base (T1 highest). Inferred affix is shown as `(auto)`, or `(guess)` when no tier's range contains the roll.
- **Ambiguity:** a line shared by a pure mod and a hybrid half prefers the single-line family. Prefix-and-suffix both fitting returns nothing (user picks). Hybrid lines of one family count once toward the 3/3 limit.
- **Why not trust RePoE blindly:** the export is a game-data dump for one patch; tier numbering here is our rank, not necessarily the in-game "Tier" label. Treat T-numbers as approximate until compared with the game.
- **Implicit detection for photos:** line boxes from Tesseract give vertical gaps; a gap clearly larger than normal spacing is a section break. With two mod sections and a short (<= 2 lines) first one, it is tagged implicit. Wrong guesses are fixable with the kind dropdown.
- **OCR:** multi-pass (adaptive threshold + despeckle, layout modes 3/6/11), scored by known-mod lines and base type; header-only rescue pass. Tuned on synthetic tooltip renders (`scripts/make-sample-tooltip.ts`), NOT on real game photos. Real photos are the open risk.
