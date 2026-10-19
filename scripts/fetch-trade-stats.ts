// Build-time only. Fetches the official trade2 stats list and rewrites public/data/stats.json.
// Mod roll ranges (mods.json) still come from PoB2 via `pnpm data:update`.
// Low rate (one request), identifying User-Agent, fails loudly. Set CONTACT to your contact info.
import { writeFileSync } from "node:fs";
import { statsFromApi, type ApiStats } from "./lib/tradeStats.js";

const URL = "https://www.pathofexile.com/api/trade2/data/stats";
const contact = process.env["CONTACT"];
if (!contact) {
  console.error("Set CONTACT (email or URL) so the User-Agent identifies you, e.g. CONTACT=you@example.com pnpm data:trade-stats");
  process.exit(1);
}
const res = await fetch(URL, { headers: { "user-agent": `poe2-item-search-build/0.1 (contact: ${contact})`, accept: "application/json" } });
if (!res.ok) {
  console.error(`GET ${URL} -> HTTP ${res.status}. Rate-limit headers: ${res.headers.get("x-rate-limit-policy") ?? "n/a"}`);
  process.exit(1);
}
const table = statsFromApi((await res.json()) as ApiStats);
writeFileSync("public/data/stats.json", JSON.stringify(table));
console.log(`Wrote public/data/stats.json (${Object.keys(table).length} stat texts) at ${new Date().toISOString()}`);
