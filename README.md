# PoE2 Item Search

Mobile-first, offline-capable PWA. Photo or pasted text of a Path of Exile 2 item → reviewed mod list → (a) in-game stash regex, (b) weighted-sum trade2 search link, (c) optional in-app listings ranked by score and value. No AI or LLM calls anywhere.

> Status: working prototype. Live trade site and in-game behaviour are **unverified** (see [docs/FINDINGS.md](docs/FINDINGS.md)). Test the regex in game and the trade link on the site before trusting them.

## Setup

```sh
pnpm install
pnpm ocr:assets    # copies Tesseract worker, WASM core, eng model into public/ocr (also runs before dev/build)
pnpm dev           # http://localhost:5173
pnpm test          # 100+ unit tests
pnpm typecheck
pnpm build         # dist/, includes the service worker (precache ≈ 12 MB incl. OCR)
```

Smoke test in real Chromium (shell → review → regex → trade link → offline reload):

```sh
pnpm build && npx tsx scripts/smoke.ts /tmp/shots
```

## Data

`public/data/*.json` is committed and built from PoB2's MIT data (a checkout at `vendor/pob2`, gitignored):

```sh
git clone --depth 1 https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2 vendor/pob2
pnpm data:update                    # rebuild mods.json, stats.json, meta.json
CONTACT=you@example.com pnpm data:trade-stats   # optional: refresh trade stat ids from the official API (build time only)
```

The banner on every screen shows the data snapshot date. Items whose mods are not in the snapshot show as unmatched on the Review screen.

## Using it

1. **Input**: camera, gallery, paste (Ctrl+C or Ctrl+Alt+C text), or search a mod.
2. **Review**: every line is editable. Fuzzy matches and low-confidence OCR lines are never pre-accepted. Pick the item class and level if missing.
3. **Mods and weights**: mark each mod Off / Nice / Must. Weight source is shown (normalized `100/maxRoll`, role profile, or manual).
4. **Output**: Regex, Trade link, Ranked results. Saved searches and share links (URL hash) live under Saved.

## Ranked results (Mode B): deploy the proxy

The browser cannot call the trade API directly, so Mode B goes through a Cloudflare Worker (`worker/`).

```sh
cd worker
# edit wrangler.toml: ALLOWED_ORIGIN (your Pages origin) and USER_AGENT (with contact info)
npx wrangler deploy
```

Then paste the Worker URL into the Ranked tab (or set `VITE_PROXY_URL` at build time). The Worker sets a User-Agent, rate-limits from response headers, backs off on 429 (`2^n` s, cap 60 s), caches static data, and only answers your origin. POESESSID is optional, off by default, stored only in your browser, and forwarded only to your Worker.

## Deploy the app (Cloudflare Pages)

Build command `pnpm build`, output directory `dist`. No server-side code is needed for Input → Review → Regex.

## Not included

Vendor and Relic regex pages, PoB2 weight import, automatic price-rate providers (manual rates only). See [docs/DECISIONS.md](docs/DECISIONS.md).

## Layout

`src/core` (parse, match, weights, scoring, regex, tradeQuery, tradeClient, rateLimit) · `src/ocr` · `src/ui` · `worker/` · `scripts/` · `data/profiles.json` (editable role multipliers) · `tests/` (fixtures are synthetic, see `tests/fixtures/README.md`).
