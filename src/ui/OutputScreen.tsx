import { useEffect, useMemo, useRef, useState } from "react";
import { generateRegex, type RegexSelection } from "../core/regex.js";
import type { ModIndex } from "../core/modIndex.js";
import { tradeUrl, tradeUrlPob, listingBody } from "../core/tradeQuery.js";
import { scoreListing, searchAdaptive, sortListings, statHash, type Listing, type RawListing, type SearchOutcome, type SortKey, type Status, type Transport } from "../core/tradeClient.js";
import { exaltedPerDivine, type RatesTable } from "../core/rates.js";
import type { ValueMode } from "../core/scoring.js";
import { chosen, queryFor, rollOfRow, weightOf, type ItemMeta, type Row } from "../model.js";
import type { Settings } from "../settings.js";
import { load, remove, save } from "../store.js";
import { Chip, CopyButton, Note, Seg, num } from "./common.js";

type Tab = "regex" | "trade" | "ranked";

export function OutputScreen({ index, rows, meta, settings, setSettings, rates, setRates, onSave }: {
  index: ModIndex; rows: Row[]; meta: ItemMeta; settings: Settings; setSettings: (s: Settings) => void;
  rates: RatesTable | undefined; setRates: (r: RatesTable | undefined) => void; onSave: () => void;
}) {
  const [tab, setTab] = useState<Tab>("regex");
  return (
    <>
      <h1>Output</h1>
      <div className="row" style={{ marginBottom: 8 }}>
        <Seg<Tab> value={tab} options={[["regex", "Regex"], ["trade", "Trade link"], ["ranked", "Ranked results"]]} onChange={setTab} />
        <button className="fixed" onClick={onSave}>Save search</button>
      </div>
      {tab === "regex" && <RegexTab index={index} rows={rows} meta={meta} settings={settings} setSettings={setSettings} />}
      {tab === "trade" && <TradeTab rows={rows} meta={meta} settings={settings} />}
      {tab === "ranked" && <RankedTab index={index} rows={rows} meta={meta} settings={settings} setSettings={setSettings} rates={rates} setRates={setRates} />}
    </>
  );
}

function RegexTab({ index, rows, meta, settings, setSettings }: { index: ModIndex; rows: Row[]; meta: ItemMeta; settings: Settings; setSettings: (s: Settings) => void }) {
  const sels = useMemo<RegexSelection[]>(() => rows.filter((r) => r.confirmed && r.level !== "off" && chosen(r)).flatMap((r) => {
    const entry = index.all.find((e) => e.text === chosen(r)!.text);
    if (!entry) return [];
    const min = settings.useMinInRegex ? (r.minRoll ?? (r.level === "must" ? Math.floor(rollOfRow(r)) : undefined)) : undefined;
    return [{ entry, ...(min ? { minRoll: min } : {}), weight: r.level === "must" ? Number.MAX_SAFE_INTEGER : weightOf(r, meta.itemClass, settings.role || undefined)?.value ?? 0 }];
  }), [rows, index, meta.itemClass, settings.role, settings.useMinInRegex]);
  const out = useMemo(() => generateRegex(sels, index, meta.itemClass, { mode: settings.mode, limit: settings.limit, overflow: settings.overflow }), [sels, index, meta.itemClass, settings.mode, settings.limit, settings.overflow]);

  return (
    <>
      <div className="card">
        <div className="row">
          <Seg value={settings.mode} options={[["all", "Match all"], ["any", "Match any"]]} onChange={(m) => setSettings({ ...settings, mode: m })} />
          <label className="fixed" style={{ margin: 0 }}><input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={settings.useMinInRegex} onChange={(e) => setSettings({ ...settings, useMinInRegex: e.target.checked })} /> use min rolls</label>
        </div>
        <label htmlFor="lim">Character limit (250 unverified in game)</label>
        <input id="lim" type="number" inputMode="numeric" value={settings.limit} onChange={(e) => setSettings({ ...settings, limit: num(e.target.value) ?? 250 })} />
      </div>
      {out.strings.length === 0 && <p className="muted">Nothing selected.</p>}
      {out.strings.map((s, i) => (
        <div className="out" key={i}>
          <div className="mono">{s}</div>
          <div className="row" style={{ marginTop: 6 }}>
            <Chip kind={s.length > settings.limit ? "bad" : "ok"}>{s.length}/{settings.limit}</Chip>
            <CopyButton text={s} />
          </div>
        </div>
      ))}
      {out.overLimit && settings.overflow === "none" && (
        <div className="card">
          <p className="bad">Over the limit. Choose how to fit it (nothing changes until you pick):</p>
          <div className="row">
            <button onClick={() => setSettings({ ...settings, overflow: "drop" })}>Drop lowest-weight mods</button>
            <button onClick={() => setSettings({ ...settings, overflow: "split" })}>Split into several strings</button>
          </div>
        </div>
      )}
      {settings.overflow !== "none" && <button onClick={() => setSettings({ ...settings, overflow: "none" })}>Undo fit ({settings.overflow})</button>}
      {out.dropped.length > 0 && <Note>Dropped: {out.dropped.map((d) => d.entry.text).join("; ")}</Note>}
      {out.warnings.map((w) => <Note key={w}>{w}</Note>)}
      <p className="muted">Vendor and Relic pages are not supported. This regex was never run against the real game search: verify it in game first.</p>
    </>
  );
}

function TradeTab({ rows, meta, settings }: { rows: Row[]; meta: ItemMeta; settings: Settings }) {
  const plan = useMemo(() => queryFor(rows, meta, settings), [rows, meta, settings]);
  const json = JSON.stringify(plan.built.body, null, 2);
  const url = tradeUrl(plan.built.body, settings.league);
  const [pob, setPob] = useState("");
  useEffect(() => { let live = true; tradeUrlPob(plan.built.body, settings.league).then((u) => live && setPob(u)).catch(() => live && setPob("")); return () => { live = false; }; }, [plan, settings.league]);
  return (
    <>
      <div className="card">
        <div className="row">
          <Chip kind={plan.built.droppedWeighted.length ? "bad" : undefined}>complexity {plan.built.used}/{plan.built.limit}</Chip>
          <Chip>{plan.built.keptWeighted.length} weighted</Chip>
          <Chip>min score {plan.minScore}</Chip>
        </div>
        {plan.built.warnings.map((w) => <Note key={w}>{w}</Note>)}
        {plan.built.droppedWeighted.length > 0 && <Note>Dropped: {plan.built.droppedWeighted.map((d) => d.id).join(", ")}</Note>}
        {plan.sel.skipped.map((s) => <Note key={s.row.id}>Skipped: "{s.row.raw}": {s.reason}.</Note>)}
        <div className="row" style={{ marginTop: 8 }}>
          <a href={url} target="_blank" rel="noopener noreferrer"><button className="primary">Open on trade site</button></a>
          <CopyButton text={json} label="Copy JSON" />
          <CopyButton text={url} label="Copy URL" />
          <CopyButton text={pob} label="Copy PoB-style URL" disabled={!pob} />
        </div>
        <Note>Link format is unverified against the live site (weight groups via ?q=). If it doesn't open a weighted search, try the PoB-style URL, or paste the JSON into the site's search.</Note>
      </div>
      <details><summary>Query JSON</summary><pre className="mono">{json}</pre></details>
    </>
  );
}

function RankedTab({ index, rows, meta, settings, setSettings, rates, setRates }: {
  index: ModIndex; rows: Row[]; meta: ItemMeta; settings: Settings; setSettings: (s: Settings) => void; rates: RatesTable | undefined; setRates: (r: RatesTable | undefined) => void;
}) {
  const [proxy, setProxy] = useState(() => load("proxy", import.meta.env.VITE_PROXY_URL ?? ""));
  const [useSess, setUseSess] = useState(() => load("sess", "") !== "");
  const [sess, setSess] = useState(() => load("sess", ""));
  const [status, setStatus] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [outcome, setOutcome] = useState<SearchOutcome>();
  const abort = useRef(false);

  const plan = useMemo(() => queryFor(rows, meta, settings), [rows, meta, settings]);
  const weights = useMemo(() => new Map(plan.sel.stats.filter((s) => s.weight !== undefined).map((s) => [statHash(s.id), s.weight!])), [plan]);
  const listings = useMemo<Listing[]>(() => outcome ? sortListings(outcome.raw.map((r: RawListing) => scoreListing(r, weights, index, meta.itemClass, rates, settings.valueMode)), settings.sortKey) : [], [outcome, weights, index, meta.itemClass, rates, settings.valueMode, settings.sortKey]);
  const missing = new Set(listings.filter((l) => l.price && l.priceExalted === undefined).map((l) => l.price!.currency));

  const transport: Transport = async ({ method, path, body }) => {
    const res = await fetch(proxy.replace(/\/$/, "") + path, {
      method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(useSess && sess ? { "x-poesessid": sess } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    let json: unknown = null;
    try { json = await res.json(); } catch { /* non-JSON body */ }
    return { status: res.status, headers, json };
  };

  const run = async () => {
    setBusy(true); setErr(undefined); setOutcome(undefined); setStatus([]); abort.current = false;
    save("proxy", proxy);
    try {
      const out = await searchAdaptive({
        transport, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        onStatus: (s: Status) => setStatus((p) => [...p.slice(-4), s.type === "wait" ? `waiting ${Math.ceil(s.ms / 1000)}s (${s.reason})` : s.type === "adapt" ? `${s.direction} min score to ${Math.round(s.minScore * 10) / 10} (${s.total} results)` : `${s.what} request`]),
      }, { league: settings.league, buildBody: (min) => queryFor(rows, meta, settings, min).built.body, initialMinScore: plan.minScore, target: settings.target });
      setOutcome(out);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const toggleSess = (on: boolean) => { setUseSess(on); if (!on) { setSess(""); remove("sess"); } };

  return (
    <>
      <div className="card">
        <label htmlFor="proxy">Proxy URL (your Cloudflare Worker)</label>
        <input id="proxy" type="text" value={proxy} placeholder="https://poe2-item-search-proxy.<you>.workers.dev" onChange={(e) => setProxy(e.target.value)} />
        <p className="muted">The browser can't call the trade API directly. Requests go through your proxy only. Search results are scored on this device.</p>
        <label><input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={useSess} onChange={(e) => toggleSess(e.target.checked)} /> Use my POESESSID (optional, off by default)</label>
        {useSess && (
          <>
            <Note>Risk: POESESSID grants access to your account. It stays in this browser's local storage and is sent only to your proxy as a header. Leave this off unless you need private leagues.</Note>
            <input type="password" autoComplete="off" value={sess} onChange={(e) => { setSess(e.target.value); save("sess", e.target.value); }} aria-label="POESESSID" />
          </>
        )}
      </div>

      <div className="card">
        <h2>Prices</h2>
        <div className="grid2">
          <div><label htmlFor="epd">Exalted per Divine</label>
            <input id="epd" type="number" inputMode="decimal" value={exaltedPerDivine(rates) ?? ""} onChange={(e) => { const v = num(e.target.value); setRates(v === undefined ? undefined : { rates: { ...(rates?.rates ?? {}), divine: v }, asOf: Date.now(), source: "manual" }); }} /></div>
          <div><label htmlFor="epc">Exalted per Chaos</label>
            <input id="epc" type="number" inputMode="decimal" value={rates?.rates["chaos"] ?? ""} onChange={(e) => { const v = num(e.target.value); setRates({ rates: { ...(rates?.rates ?? {}), ...(v !== undefined ? { chaos: v } : {}) }, asOf: Date.now(), source: "manual" }); }} /></div>
        </div>
        <p className="muted">{rates ? `Rates: ${rates.source}, entered ${new Date(rates.asOf).toLocaleString()}.` : "No rates set."} Automatic rate providers (poe2scout, poe.ninja) are not wired: their endpoints were not verified. Listings in a currency without a rate show the raw price and no value.</p>
        <div className="row">
          <Seg<ValueMode> value={settings.valueMode} options={[["ratio", "score ÷ price"], ["pob", "PoB: score − 0.1·log10(price)"]]} onChange={(v) => setSettings({ ...settings, valueMode: v })} />
        </div>
      </div>

      <div className="row">
        <button className="primary" disabled={busy || !proxy || plan.built.keptWeighted.length === 0} onClick={run}>{busy ? "Searching…" : "Search"}</button>
        <Seg<SortKey> value={settings.sortKey} options={[["value", "Value"], ["score", "Score"], ["price", "Price"]]} onChange={(k) => setSettings({ ...settings, sortKey: k })} />
      </div>
      {plan.built.keptWeighted.length === 0 && <Note>Ranked results need at least one "Nice" mod with a weight.</Note>}
      {status.length > 0 && <p className="muted" aria-live="polite">{status.join(" → ")}</p>}
      {err && <p className="bad">{err}</p>}
      {outcome?.warnings.map((w) => <Note key={w}>{w}</Note>)}
      {outcome && <p className="muted">{outcome.total} total matches · min score used {Math.round(outcome.finalMinScore * 10) / 10} · {outcome.attempts} search{outcome.attempts === 1 ? "" : "es"}</p>}
      {missing.size > 0 && <Note>No rate for: {[...missing].join(", ")}. Those listings have no value and sort last by value/price.</Note>}

      {listings.length > 0 && (
        <table>
          <thead><tr><th>#</th><th>Item</th><th>Score</th><th>Price</th><th>Value</th><th /></tr></thead>
          <tbody>
            {listings.map((l, i) => (
              <tr key={l.id}>
                <td>{i + 1}</td>
                <td>
                  <details><summary>{l.name || l.typeLine}</summary>
                    <ul className="muted">{l.breakdown.map((b, j) => <li key={j}>{b.text}: {b.weight.toFixed(3)} × {b.roll} = {b.contribution.toFixed(1)}</li>)}</ul>
                    {l.unmatched.length > 0 && <p className="muted">Unscored lines: {l.unmatched.join("; ")}</p>}
                    {l.serverScore !== undefined && <p className="muted">Site score: {l.serverScore}</p>}
                  </details>
                </td>
                <td>{l.score.toFixed(1)}</td>
                <td>{l.price ? `${l.price.amount} ${l.price.currency}` : "?"}</td>
                <td>{l.value !== undefined ? l.value.toFixed(2) : "–"}</td>
                <td>
                  <div className="row">
                    <CopyButton text={l.whisper ?? ""} label="Whisper" disabled={!l.whisper} />
                    {l.account && <a href={tradeUrl(listingBody(plan.built.body, l.account, l.serverScore), settings.league)} target="_blank" rel="noopener noreferrer"><button>Open</button></a>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
