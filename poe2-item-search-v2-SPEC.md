# poe2-item-search v2: Photo/Text → Regex + Weighted-Sum Trade Search (no AI)

**One-line:** Upload a photo (or paste text) of a PoE2 item, review the parsed mods, then get (a) a stash/vendor **regex** and (b) a **weighted-sum trade search** that ranks listings by value-per-price. Installable PWA, no LLM, no AI calls. New GitHub repo.

Supersedes `poe2-item-to-search-SPEC.md`. That spec's pipeline (parse, match, review) is kept. This version adds weighted-sum search and in-app results.

---

## 1. Status of prior work (read first)

| Item | Status |
|---|---|
| `poe2-crafting-terminal.html` | **Not AI-free.** It still contains the Anthropic API call, web_search and photo code. It is not a regex tool and never was. Do not use it as a base or reference for this build. |
| Any earlier working photo → regex tool | **Does not exist.** Nothing built in this conversation generates regex. This repo is the first implementation. |
| Regex engine | Reuse poe.re (`Demonad112/poe.re`, monorepo, `poe2/` + `shared/`). License not visible and README clone URLs point at `veiset/poe.re`: **check upstream license before reuse or redistribution**. |

---

## 2. How weighted-sum search works (researched)

### 2.1 Trade site mechanic
The official trade site supports a stat group of type **Weighted Sum** (`"type": "weight"`). Each stat in the group has a **weight**. For every listing the site computes `score = Σ (weight_i × value_i)` over matched mods, filters on a group-level **minimum score**, and can **sort by that score**. So a listing with two mid rolls can outrank one with a single perfect roll, depending on weights.

### 2.2 How Path of Building (PoB2) uses it (from `PathOfBuildingCommunity/PathOfBuilding-PoE2`, MIT)

| Piece | Detail |
|---|---|
| Files | `src/Classes/TradeQuery.lua` (UI, currency conversion, results), `TradeQueryGenerator.lua` (mod weights and query JSON), `TradeQueryRequests.lua` (HTTP, rate limits), `src/Data/QueryMods.lua` (mod → trade stat id table, generated on first run) |
| Weight derivation | For each candidate mod: build a blank rare for the slot, take baseline build output, apply the mod at a mid-range value, re-run the build calc with the item swapped in, take the output delta (Full DPS weight 1.0, Total EHP weight 0.5 by default), **normalize per unit of the mod value**. That gives a per-unit weight in "build improvement per point of stat". |
| Filter cap | Trade API allows **35 filters** per query. PoB reserves slots for type/rarity, mirrored, max price, max level, sockets, then fills the rest with the **highest-weighted mods**. |
| Adaptive threshold | If results exceed the **10,000** cap, raise the minimum weight and retry. If `total` is under the fetch target, lower it and retry. |
| Sort modes | `StatValue` (weighted score), `StatValuePrice` (score per price, **the "best value" view**), `Price`, `Weight` (API default order). First three are computed **client-side** after fetch. |
| Price handling | Normalize listings to one currency using a rates table, then rank. |
| Endpoints | `POST pathofexile.com/api/trade2/search/{realm}/{league}`, `GET .../api/trade2/fetch/{ids}?query={id}`, `GET .../api/trade2/data/static`, rates from poe.ninja |
| Rate limits | Policy-based, parsed from response headers. HTTP 429 → exponential backoff `2^attempts` s, cap 60 s. |
| Sessions | With POESESSID: in-app search, private leagues. Without: only **generate a URL** to open in the browser, public leagues. |

### 2.3 Other tools
| Tool | Approach |
|---|---|
| `Panger9/poe2-trade-extension` | Auto-fills weights as **100 ÷ max roll** per stat so ranges of different scale contribute comparably. Max rolls come from trade stats data joined with PoB/RePoE mod exports at build time. Unmatched stats are skipped, never guessed. License not stated. |
| `xanthics/PoE_Weighted_Search` | Weights come from measured DPS per stat point in PoB, then `gensearchparams` emits a trade search. Formula not documented on the repo page. |

### 2.4 Not verified (Claude Code must confirm, do not assume)
- Exact trade2 query JSON for `weight` groups, including where the group minimum lives and how sort is expressed.
- Whether `https://www.pathofexile.com/trade2/search/poe2/<league>?q=<json>` deep-links with a weight group.
- Current rate-limit header names for trade2.
- Whether the browser can call trade2 directly (assume **no**: CORS and cookie rules).

---

## 3. Our weight model (no PoB required for v1)

The user is a console player and will not run PoB. So weights must come from something simple, transparent and editable.

| Source | Phase | How |
|---|---|---|
| **Normalized default** | 1 | `weight = 100 / maxRoll(mod)` (Panger9 method). Needs per-mod max roll from the poe.re generated data. Skipped if unknown. |
| **Preset profiles** | 1 | User picks a role (Attack, Spell, Minion, Tank, Speed) and slot. A small hand-curated table sets **relative importance multipliers** per mod group (e.g. life ×1.0, resists ×0.6, movement speed on boots ×2.0). Multiplied onto the normalized default. Stored in `data/profiles.json`, editable, versioned. |
| **Manual** | 1 | Per-mod weight slider/number field. |
| **PoB2 export import** | 3 | Paste a PoB2 build code or exported stat weights → import weights. Optional. Do not reimplement PoB's calc engine. |

Each weight is shown with its source label (normalized / profile / manual) so the user can trust or override it.

**Score definition (shown in UI):** `score = Σ weight_i × roll_i` for mods present. **Value** = `score ÷ priceInExalted`. Rank by value, with a toggle for raw score and for price.

---

## 4. Core pipeline

```
photo / paste ─► OCR (local) ─► normalize ─► match to mods ─► REVIEW ─► pick mods + weights ─┬─► Regex (poe.re engine)
                                                                                              └─► Trade query
                                                                                                    ├─ Mode A: open on trade site (URL)
                                                                                                    └─ Mode B: in-app results ranked by value (proxy)
```

### 4.1 Input and parsing
Same as prior spec: text paste (plain and Ctrl+Alt+C advanced format), photo via local Tesseract.js (bundled, offline), mandatory editable review screen, low-confidence flags, never invent item level or tiers. Normalize `+45 to maximum Life` → template `+# to maximum Life` plus values. Flags: implicit, fractured, crafted, desecrated, rune. Validate ≤3 prefixes and ≤3 suffixes on rares.

### 4.2 Data
Build-time scripts (no runtime fetch, because `data.poe.re` CORS only allows poe.re, poe2.re and localhost):
- `data:update` pulls `history.json` → latest poe2 patch → `public/data/<patch>/`.
- `data:trade-stats` pulls the official trade2 stats list at build time (User-Agent set, low rate) → `public/data/trade-stats.json`, then joins template → stat id. Unmapped mods are listed and excluded with a warning.
- Version banner on every screen: patch + build date.

### 4.3 Regex output
Adapter over the poe.re generator (Items, Vendor, Waystone, Tablet, Relic). Enforce the verified character limit (config; 250 only if unverified). Over limit → split into several strings or drop lowest-weight mods, with user confirmation. In-game verification note shown.

### 4.4 Trade output

**Mode A: link (default, no proxy, no login).**
Build the trade2 query JSON with one `weight` stat group (or `and` group for must-have mods plus a `weight` group for nice-to-haves), base type, category, ilvl, price cap, then produce: Open-on-trade link, copy JSON, copy URL. Respect the 35-filter cap: keep the highest-weighted mods and tell the user which were dropped.

**Mode B: in-app ranked results (optional).**
Browser cannot call the trade API directly. Use a small **Cloudflare Worker proxy** that: forwards search and fetch, sets a proper User-Agent, enforces a token-bucket per the response rate-limit headers, backs off on 429, and caches. Client then:
1. Search → get ids (≤ 100 per fetch batch as the API allows; verify).
2. Fetch listings, compute `score` locally from returned mod values with our weights.
3. Convert prices to Exalted using rates (poe2scout primary, poe.ninja fallback, shown with timestamp).
4. Sort by value, score or price. Show top N with "Whisper" copy and "Open listing".
5. Adaptive threshold like PoB (raise on >10k, lower on too few), capped retries.

POESESSID: **not required**. If the user supplies one for private leagues, keep it in local storage only, never log it, never send it anywhere except the proxy request header, and warn about the risk. Default flow never asks for it.

---

## 5. Screens (mobile-first)

1. **Input:** Camera / Gallery / Paste / Search-a-mod.
2. **Review:** crop, OCR lines editable, confidence chips, manual mod picker.
3. **Mods and weights:** checklist with must-have vs nice-to-have, weight field with source label, prefix/suffix counters, role preset, price cap, league.
4. **Output:** tabs **Regex | Trade link | Ranked results**. Char counter on Regex, filter-cap indicator (e.g. 18/35) on Trade.
5. **Saved:** recent/starred searches, shareable URL hash.

---

## 6. Tech and repo

| Layer | Choice |
|---|---|
| Frontend | pnpm, Vite, TypeScript strict, React, vite-plugin-pwa, Vitest |
| OCR | tesseract.js (worker, core, eng traineddata bundled) |
| Proxy (Mode B) | Cloudflare Worker (TypeScript), KV or Cache API for rates and static data |
| Host | Cloudflare Pages (app) + Worker (proxy) |
| Repo | New GitHub repo `poe2-item-search`. Keep `vendor/poe.re` as read-only reference, not committed if license unclear |

Layout: `src/core` (normalize, parse, match, weights, tradeQuery, regexAdapter, scoring), `src/ui`, `scripts`, `worker`, `public/data`, `docs/FINDINGS.md`, `docs/DECISIONS.md`, `tests/fixtures`.

---

## 7. Failure points

| Risk | Handling |
|---|---|
| Weight group JSON shape wrong | Phase 0 verifies against a live browser-built weighted search URL before any code depends on it |
| OCR misreads | Mandatory review screen, confidence flags, manual picker |
| 35-filter cap | Keep highest weights, show dropped mods |
| Over 10k results | Raise min score and retry (capped) |
| Rate limiting / 429 | Token bucket from headers, exponential backoff, visible status |
| Stale data | Version banner, unmatched mods listed |
| Bad weights mislead ranking | Show weight source, allow edit, show score breakdown per listing |
| Rates stale or missing | Show rate timestamp, fall back to raw price if no rate |
| Trade API terms / abuse | Low rate, User-Agent, caching, no scraping beyond official API, no auto-buy |
| License unclear (poe.re, Panger9) | Check before reusing code or data; write own code where unclear |
| POESESSID leak | Optional, local only, not logged, default off |

---

## 8. Acceptance criteria

- [ ] Photo of a tooltip → editable review list in ~5 s on a mid-range Android.
- [ ] Prefix/suffix ≤3 validation fires on bad matches.
- [ ] Regex for 5 sample items works in the in-game stash search (**manual**).
- [ ] Mode A link opens a weighted-sum search on the trade site that matches the on-screen weights (**manual**, 5 samples).
- [ ] Mode B returns ranked listings; displayed score equals Σ weight × roll recomputed independently in a test.
- [ ] Filter count never exceeds 35; dropped mods are shown.
- [ ] 429 handling demonstrated with a mock server.
- [ ] Works offline for Input → Review → Regex. Only trade/Mode B needs network.
- [ ] No LLM/AI references in source or build output.

## 9. Phases

| Phase | Deliverable |
|---|---|
| 0 | `docs/FINDINGS.md`: poe.re internals, trade2 weight JSON verified, license check |
| 1 | Data scripts, normalize/parse/match, tests |
| 2 | Review UI, weights model, Mode A trade link |
| 3 | Regex adapter |
| 4 | Photo OCR flow |
| 5 | Worker proxy + Mode B ranked results |
| 6 | PWA/offline, saved searches, PoB2 weight import (optional) |

## 10. Out of scope
AI/LLM, crafting advice, auto-buy, price-checking by AI, reimplementing PoB's calculation engine.

## Sources
- [PoB2 Trade System (DeepWiki)](https://deepwiki.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/5.1-trade-system)
- [Demonad112/PathOfBuilding-PoE2 (fork, MIT)](https://github.com/Demonad112/PathOfBuilding-PoE2)
- [Panger9/poe2-trade-extension](https://github.com/Panger9/poe2-trade-extension)
- [xanthics/PoE_Weighted_Search](https://github.com/xanthics/PoE_Weighted_Search)
- [Demonad112/poe.re](https://github.com/Demonad112/poe.re)
