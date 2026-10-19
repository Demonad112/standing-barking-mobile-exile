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
