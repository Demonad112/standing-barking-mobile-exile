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

`public/data/*.json` is committed. Two build-time steps, in this order:

```sh
git clone --depth 1 https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2 vendor/pob2
pnpm data:update                    # PoB2 (MIT): mods.json (roll ranges per slot), stats.json (trade stat ids), meta.json
pnpm data:repoe                     # RePoE PoE2 export (MIT) -> affixes.json; Sidekick trade-stats (MIT) merged into stats.json
                                    # flags: --repoe <dir|url>  --sidekick <file|url>
CONTACT=you@example.com pnpm data:trade-stats   # optional: refresh trade stat ids from the official API (build time only)
```

The banner on every screen shows the data snapshot date. Items whose mods are not in the snapshot show as unmatched on the Review screen.

## Using it

1. **Input**: camera, gallery, paste (Ctrl+C or Ctrl+Alt+C text), or search a mod.
2. **Review**: every line is editable. Fuzzy matches and low-confidence OCR lines are never pre-accepted. Base type, item class and level come from the photo when readable; otherwise set them (base picker, class list).
   - **Prefix/suffix and tier are inferred**, not read: a plain tooltip photo has no affix markers, so each line is looked up in the RePoE mod data by text, rolled value, base-type tags and item level. Chips show `prefix T3 (auto)` plus the tier name; `(guess)` means the roll fit no tier. The A/P/S switch overrides it. The first mod section above a divider is tagged *implicit* (not counted as prefix/suffix); the kind dropdown changes it.
   - Photo reading tries several image clean-ups (local threshold, different Tesseract layout modes) and keeps the one that matches the most known mods, then re-reads just the header if the base type was missed. Crop tight around the tooltip for best results. `window.__ocrDebug` in the browser console lists what each pass read.
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

## Deploy the app

**GitHub Pages (workflow included, `.github/workflows/pages.yml`):**

1. Repo → Settings → Pages → Source: **GitHub Actions**.
2. Merge to `main` (or run the workflow manually). Site: `https://<user>.github.io/<repo>/`.
3. The build uses a relative base (`./`), so the repo sub-path works. PRs run typecheck, tests and build only.

**Android app:** open the Pages URL in Chrome → menu → *Install app* / *Add to Home screen*. It runs standalone and offline for Input → Review → Regex (service worker precaches shell, mod data and OCR assets after the first load).

**Cloudflare Pages (alternative):** build command `pnpm build`, output directory `dist`.

No server-side code is needed for Input → Review → Regex or the trade link. The trade link is a plain URL to pathofexile.com that you tap; nothing is sent from the app. Only Ranked results needs the Worker.

## Not included

Vendor and Relic regex pages, PoB2 weight import, automatic price-rate providers (manual rates only). See [docs/DECISIONS.md](docs/DECISIONS.md).

## Layout

`src/core` (parse, match, weights, scoring, regex, tradeQuery, tradeClient, rateLimit) · `src/ocr` · `src/ui` · `worker/` · `scripts/` · `data/profiles.json` (editable role multipliers) · `tests/` (fixtures are synthetic, see `tests/fixtures/README.md`).
