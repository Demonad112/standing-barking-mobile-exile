// End-to-end smoke test in real Chromium against `vite preview`. Usage: pnpm build && tsx scripts/smoke.ts <shots-dir>
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const shots = process.argv[2] ?? "/tmp";
const port = 4173;
const server = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { stdio: "ignore" });
const base = `http://localhost:${port}/`;
const fail = (m: string): never => { throw new Error(`SMOKE FAIL: ${m}`); };

async function waitUp() {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) return; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 200)); }
  fail("preview server did not start");
}

try {
  await waitUp();
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const nets: string[] = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.origin !== base.slice(0, -1)) nets.push(r.url()); });

  await page.goto(base);
  await page.getByText("Paste item text").waitFor();
  await page.screenshot({ path: `${shots}/1-input.png` });

  await page.getByLabel("Item text").fill(readFileSync("tests/fixtures/ring-rare.txt", "utf8"));
  await page.getByRole("button", { name: "Parse" }).click();
  await page.getByRole("heading", { name: "Review" }).waitFor();
  const lineCount = await page.getByLabel("Line text").count();
  if (lineCount !== 6) fail(`expected 6 review lines, got ${lineCount}`);
  await page.screenshot({ path: `${shots}/2-review.png`, fullPage: true });

  await page.getByRole("button", { name: /Continue with 6 confirmed/ }).click();
  await page.getByRole("heading", { name: "Mods and weights" }).waitFor();
  await page.screenshot({ path: `${shots}/3-mods.png`, fullPage: true });
  await page.getByRole("button", { name: "Generate outputs" }).click();
  await page.getByRole("heading", { name: "Output" }).waitFor();
  const regex = await page.locator(".out .mono").first().innerText();
  if (!regex.startsWith('"')) fail(`regex output not quoted: ${regex}`);
  await page.screenshot({ path: `${shots}/4-regex.png`, fullPage: true });

  await page.getByRole("button", { name: "Trade link" }).click();
  await page.getByText("Open on trade site").waitFor();
  const href = await page.getByRole("link").filter({ hasText: "Open on trade site" }).getAttribute("href");
  if (!href?.includes("trade2/search/poe2/Standard?q=")) fail(`bad trade href: ${href}`);
  await page.screenshot({ path: `${shots}/5-trade.png`, fullPage: true });
  await page.getByRole("button", { name: "Ranked results" }).click();
  await page.screenshot({ path: `${shots}/6-ranked.png`, fullPage: true });

  // Offline: wait for the service worker to control the page, then reload with the network cut.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  await ctx.setOffline(true);
  await page.goto(base);
  await page.getByText("Paste item text").waitFor({ timeout: 10000 });
  await page.getByLabel("Item text").fill(readFileSync("tests/fixtures/boots-rare.txt", "utf8"));
  await page.getByRole("button", { name: "Parse" }).click();
  await page.getByRole("button", { name: /Continue with/ }).click();
  await page.getByRole("button", { name: "Generate outputs" }).click();
  const offlineRegex = await page.locator(".out .mono").first().innerText();
  if (!offlineRegex.startsWith('"')) fail("offline regex failed");
  await page.screenshot({ path: `${shots}/7-offline-regex.png`, fullPage: true });

  if (nets.length) fail(`unexpected cross-origin requests: ${nets.join(", ")}`);
  const real = errors.filter((e) => !/Failed to load resource|net::ERR/.test(e));
  if (real.length) fail(`console errors: ${real.join(" | ")}`);
  console.log("SMOKE OK", { regex, offlineRegex });
  await browser.close();
} finally {
  server.kill();
}
