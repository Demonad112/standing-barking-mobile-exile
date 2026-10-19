# Phase 0 findings

Date: 2026-10-19. Sources read locally: `vendor/poe.re` (Demonad112 fork, HEAD `948fa12`), `vendor/pob2` (Demonad112 fork of PathOfBuilding-PoE2). Status labels: **VERIFIED** = read in source this session. **UNVERIFIED** = inferred, or could not be checked against the live site.

## 0. Stop conditions hit

| Condition (from prompt) | Result |
|---|---|
| Weight-group JSON cannot be verified | **HIT.** `www.pathofexile.com` is blocked by this session's egress proxy (403 on CONNECT). The shape below is read from PoB2 source only, never checked against the live site. |
| poe.re generator cannot be extracted | **PARTLY HIT.** The generator is not a pure function. Per-mod regexes are precomputed by a private tool (`poe-item-gen`) and served from `data.poe.re`, which is also blocked here and CORS-restricted at runtime. Only the glue code is in the repo. |
| A license blocks reuse | **HIT.** poe.re has no license (see section 1). |

## 1. Licenses

| Project | License | Consequence |
|---|---|---|
| `Demonad112/poe.re` (fork) and upstream `veiset/poe.re` | **None found.** No LICENSE file in either; `package.json` has no `license` field; README has none. All rights reserved by default. | Do not copy or vendor code or data. Write own implementation; cite the idea only. `vendor/` stays gitignored. |
| `data.poe.re` generated data | Produced by private `poe-item-gen`, no terms found. | Do not redistribute or bundle. Not reachable from this session anyway. |
| PathOfBuilding-PoE2 | MIT (Path of Building Community, (c) 2016 David Gowor). `Data/QueryMods.lua` header: "Game data (c) Grinding Gear Games". | Code ideas and algorithms reusable with attribution. Game data stays GGG's. |
| `Panger9/poe2-trade-extension` | **None found** (no LICENSE file in repo root). | Idea only (100 / maxRoll). No code. |
| `xanthics/PoE_Weighted_Search` | MIT (c) 2018 Jeremy Parks. | Reusable with notice, but its method (PoB DPS per stat) is out of scope. |

## 2. poe.re internals (VERIFIED from source)

- Monorepo: `poe/`, `poe2/`, `shared/`, `workers/`. Item page: `poe2/src/pages/item/Item.tsx`. Regex assembly: `shared/core/item/ItemOutput.ts` (`generateRareItemRegex`, `generateMagicItemRegex`). Number-range regex helper: `shared/core/regex/GenerateNumberRegex.ts` (`generateBoundedValueRegex`, `generateNumberRangeRegex`; handles only 0-99).
- Input model is UI state (`ItemCraftingSettings`: `itembase`, `selectedRareMods` keyed by `<basetype>...`, per-mod value strings, match flags), not a plain function argument. `generateRareItemRegex(affixMap, settings)` is exported and pure, but needs `affixMap` built from the generated data.
- **The hard part is the data.** Each affix entry already carries its shortest unique `regex` (e.g. `"\\d+ fire damage$"`, `"d mel"`), plus `start/end`, `before/on/after` number indices, `affixtype`, `stats[{id,min,max,numberIndex,hasRange}]`, `affixes[{name,desc}]`. Shortening is done by the private generator, not in this repo.
- Data URL scheme: `https://data.poe.re/history.json` → `current.poe2.{patch,commit}`; files at `https://data.poe.re/generated/poe2/<patch>/<path>?v=<commit>`; `SHA256SUMS` lists the files. Item files: `item/Generated.Item.<LANG>.min.json`, `item/Generated.Basetypes.Item.<LANG>.min.json`. Also `tablet/`, `waystone/`, `relic/`, `trade-ids/Generated.TradeIds.{Waystone,Tablet}.min.json`.
- Local fallback copies exist (`poe2/generated/item/Generated.Item.ENGLISH.json`, 5 MB) but the repo's own AGENTS.md calls them "older copies" for fallback and fixtures. They are covered by the no-license finding.
- Char limit: **250**, hard-coded default in `RegexResultBox` (`maxLength ?? 250`) and `MAX_FAVORITE_GROUP_REGEX_LENGTH = 250`. Whether the game truly caps at 250 is **UNVERIFIED** (needs in-game test).
- Search semantics documented in AGENTS.md (VERIFIED as claims by upstream, not by me): a leading space in a quoted term is dropped (use `\s`); search matches all item text, so a regex must not hit other lines.
- Regex output shapes: AND = `"a" "b"`; OR = `"a|b"`; prefix/suffix split `"p1|p2" "s1|s2"`; anchors `^` (prefix) and `$` (suffix) per mod.
- Trade URL (poe.re): `https://www.pathofexile.com/trade2/search/poe2/<league>?q=<encodeURIComponent(JSON)>`; body `{query:{status:{option:"securable"},type?,stats?,filters:{...}},sort:{price:"asc"}}`. Price filter `filters.trade_filters.filters.price = {option:"exalted"|"divine", min, max}`. **Live behavior UNVERIFIED.**
- League list comes from `economyUrl("poe2-leagues.txt")` (poe.re's own endpoint).

## 3. PoB2 trade internals (VERIFIED from source, MIT)

Files: `src/Classes/TradeQuery.lua`, `TradeQueryGenerator.lua`, `TradeQueryRequests.lua`, `TradeQueryRateLimiter.lua`, `TradeHelpers.lua`, `src/Data/QueryMods.lua`.

### 3.1 Weighted-sum query JSON (`TradeQueryGenerator.lua` ~L968-1125)

```json
{
  "query": {
    "status": { "option": "securable" },
    "filters": {
      "type_filters": { "filters": { "category": { "option": "<category>" }, "rarity": { "option": "nonunique" } } },
      "misc_filters": { "disabled": false, "filters": { "mirrored": false } },
      "trade_filters": { "filters": { "price": { "option": "<currency>", "max": 10 } } },
      "req_filters": { "disabled": false, "filters": { "lvl": { "max": 80 } } }
    },
    "stats": [
      { "type": "weight", "value": { "min": 123.4 }, "filters": [ { "id": "explicit.stat_123", "value": { "weight": 1.5 } } ] },
      { "type": "and", "filters": [ { "id": "explicit.stat_456", "value": { "min": 70 } } ] },
      { "type": "not", "filters": [] }
    ]
  },
  "sort": { "statgroup.0": "desc" }
}
```

- Group minimum score: `stats[i].value.min` on the `weight` group. Per-mod weight: `filters[].value.weight`; negative weight for inverted mods.
- Weight group must be `stats[1]` ("Purchase links expect the weighted group first").
- Sort: `{"statgroup.0": "desc"}` when a weight group exists, else `{"price":"asc"}` (`TradeQueryRequests.lua` L469-511).
- `status.option` values: `securable`, `available`, `onlineleague`, `online`, `any`.
- Pseudo stats disabled for PoE2 (trade site counts augment mods in them).

### 3.2 Complexity cap (the "35 filters")

PoB does **not** count 35. It budgets a trade-site complexity of **200**: `200 - 54 (weight group) - 4 (rarity+category) - 4 (and group)`, then −4 per required/blocked mod, −3 per mirrored/price/account/level/socket filter, −4 per weighted mod, stopping when budget < 8. That works out to roughly 35 weighted filters at default settings, which matches the spec's number, but the real limit is complexity. **The spec's flat 35 is an approximation; implement the budget.** Exact cost per filter type remains **UNVERIFIED** against the live API.

### 3.3 Adaptive min score (`SearchWithQueryWeightAdjusted`)

Max recursion 5. If `total >= 10000` (clipped): fetch first 10 results, set `stats[1].value.min = (highestWeight + currentMin) / 2`, repeat. If `total < maxFetchPerSearch` (10): lower the weight and retry, fall back to previous search items to fill. Stop when `maxFetch < total < 10000`.

### 3.4 Requests and rate limits

- Search `POST https://www.pathofexile.com/api/trade2/search/<realm?>/<league>` (realm omitted for `pc`; league URL-encoded, spaces as `+`). Fetch `GET .../api/trade2/fetch/<id,id,...>?query=<searchId>`; **PoB uses 10 ids per fetch block** (`max_block_size = 10`) and `maxFetchPerSearch = 10`. Spec says ≤100: **wrong/UNVERIFIED, use 10** unless the live API says otherwise.
- Other endpoints: `GET /api/trade2/data/stats`, `/data/static`, `/data/leagues`.
- Rate-limit headers: `X-Rate-Limit-Policy`, `X-Rate-Limit-Rules` (comma list), per rule `X-Rate-Limit-<rule>` and `X-Rate-Limit-<rule>-State`, each `requests:window:timeout[,...]` (e.g. `8:10:60,15:60:120,60:300:1800`), plus `Retry-After`. Policy names: `trade-search-request-limit`, `trade-fetch-request-limit`.
- 429 backoff: `max(min(2^attempts, 60), Retry-After)` seconds, request re-queued at the head.
- Limiter keeps a margin of 1 request under each limit.

### 3.5 Sort modes (`TradeQuery.lua` ~L1040-1085)

- `Weight`: API order. `StatValue`: highest score. `Price`: ascending, converted to divines.
- `StatValuePrice`: **not** score ÷ price. It is `score − 0.1 × log10(priceInDivine)`, chosen so cheap junk does not dominate. The spec's `value = score / priceExalted` will overrate cheap, bad items; **decision needed** (see section 6).
- Currency rates: PoB fetches `https://web.poecdn.com/api/currency-exchange` and normalizes to divine. It does not use poe.ninja or poe2scout.

### 3.6 Deep-link format

PoB builds `https://www.pathofexile.com/trade2/search/<league>/<base64url(gzip(JSON of query object))>`, where the encoded JSON is the inner `query` object. This differs from poe.re's `?q=<json>` form. `B64GzipEncode`: deflate, standard Base64, then `+`→`-`, `/`→`_`. Whether `Deflate(str, true)` emits a gzip or zlib wrapper is **UNVERIFIED**. **Neither form is verified live.** The spec's `?q=` + weight group combination is untested by either upstream.

## 4. Trade stats endpoint

`GET https://www.pathofexile.com/api/trade2/data/stats` returns `{result:[{id,label,entries:[{id,text,type}]}]}`; PoB sorts entries by text then id and keys mods by the `stat_<hash>` suffix of `id` (e.g. `explicit.stat_1247628870`). Required headers/constraints (User-Agent policy, rate limit): **UNVERIFIED**. GGG's API terms require an identifying User-Agent; confirm before the first fetch.

## 5. Not verifiable here

- Anything on `pathofexile.com` or `data.poe.re` (network policy). No live weighted search URL, no real stats list, no real mod data.
- In-game regex behavior (250 limit, search semantics).
- poe2scout API (not researched; no network).

## 6. Decisions needed from you

1. **Mod data source.** poe.re data/regex are unlicensed and blocked. Options, recommended first:
   a. Build own mod dataset from the official trade2 stats list (`/data/stats`) plus PoB2's MIT `QueryMods.lua`/mod exports (max rolls, item-class applicability), and write our own regex generator (shortest-unique substring + anchors + number ranges). Heavy but clean.
   b. Ask `veiset` for permission or a license for poe.re code and data.
   c. Use poe.re only as a user-run reference, no reuse (regex tab reduced to simple mod-text regex).
2. **Network.** Allow `www.pathofexile.com` and `data.poe.re` (if b) in the environment's Network access, or paste me one real weighted-sum search URL/JSON and a `/data/stats` sample.
3. **Value metric.** Keep spec `score / priceExalted`, or adopt PoB's `score − 0.1·log10(price)`; or offer both as a toggle (recommended).
4. **Spec corrections.** Fetch batch 10 not 100; 35-filter cap → complexity budget.
