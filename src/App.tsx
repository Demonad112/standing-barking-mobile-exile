import { useEffect, useMemo, useState } from "react";
import { canonicalClass } from "./core/modIndex.js";
import { parseItem } from "./core/parseItem.js";
import type { RatesTable } from "./core/rates.js";
import { loadData, type DataBundle } from "./data.js";
import { decodeShared, encodeShared, fromShared, rowFromEntry, rowsFromItem, toShared, type ItemMeta, type Row } from "./model.js";
import { parseOcrLines } from "./ocr/fromOcr.js";
import { DEFAULT_SETTINGS, type Settings } from "./settings.js";
import { load, loadSaved, save, saveSaved, type SavedSearch } from "./store.js";
import { Banner, Note } from "./ui/common.js";
import { InputScreen } from "./ui/InputScreen.js";
import { ModsScreen } from "./ui/ModsScreen.js";
import { OutputScreen } from "./ui/OutputScreen.js";
import { ReviewScreen, type PhotoState } from "./ui/ReviewScreen.js";
import { SavedScreen } from "./ui/SavedScreen.js";

type Screen = "input" | "review" | "mods" | "output" | "saved";
const STEPS: Array<[Screen, string]> = [["input", "Input"], ["review", "Review"], ["mods", "Mods"], ["output", "Output"], ["saved", "Saved"]];

export function App() {
  const [data, setData] = useState<DataBundle>();
  const [loadErr, setLoadErr] = useState<string>();
  const [screen, setScreen] = useState<Screen>("input");
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<ItemMeta>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [photo, setPhoto] = useState<PhotoState>();
  const [settings, setSettingsState] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...load<Partial<Settings>>("settings", {}) }));
  const [rates, setRatesState] = useState<RatesTable | undefined>(() => load<RatesTable | undefined>("rates", undefined));
  const [saved, setSavedState] = useState<SavedSearch[]>(loadSaved);

  const setSettings = (s: Settings) => { setSettingsState(s); save("settings", s); };
  const setRates = (r: RatesTable | undefined) => { setRatesState(r); save("rates", r); };
  const setSaved = (s: SavedSearch[]) => { setSavedState(s); saveSaved(s); };

  useEffect(() => { loadData().then(setData).catch((e) => setLoadErr(String(e))); }, []);

  const fromHash = (h: string, d: DataBundle): boolean => {
    const sh = decodeShared(h);
    if (!sh) return false;
    const { rows: rs, missing } = fromShared(sh, d.index);
    setRows(rs);
    setMeta(sh.cls ? { itemClass: sh.cls } : {});
    setSettings({ ...settings, league: sh.league, role: sh.role ?? "", ...(sh.cap ? { priceCap: sh.cap } : {}), ...(sh.minScore ? { minScore: sh.minScore } : {}) });
    setWarnings(missing.length ? [`${missing.length} shared mod(s) are not in this data version: ${missing.join("; ")}`] : []);
    setScreen("mods");
    return true;
  };

  useEffect(() => {
    if (!data) return;
    const m = /^#s=(.+)$/.exec(location.hash);
    if (m) fromHash(m[1]!, data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const loadItem = (item: ReturnType<typeof parseItem>, conf?: Array<number | undefined>) => {
    if (!data) return;
    const cls = canonicalClass(item.itemClass) ?? meta.itemClass;
    setMeta({ ...(cls ? { itemClass: cls } : {}), ...(item.rarity ? { rarity: item.rarity } : {}), ...(item.name ? { name: item.name } : {}), ...(item.baseType ? { baseType: item.baseType } : {}), ...(item.itemLevel ? { itemLevel: item.itemLevel } : {}) });
    setRows(rowsFromItem(item, data.index, conf));
    setWarnings(item.warnings);
    setScreen("review");
  };

  const shared = useMemo(() => toShared(rows, { league: settings.league, ...(settings.role ? { role: settings.role } : {}), ...(meta.itemClass ? { cls: meta.itemClass } : {}), ...(settings.priceCap ? { cap: settings.priceCap } : {}), ...(settings.minScore ? { minScore: settings.minScore } : {}) }), [rows, settings, meta.itemClass]);

  const saveSearch = () => {
    const name = prompt("Name this search", meta.name ?? meta.baseType ?? "Search");
    if (!name) return;
    setSaved([...saved, { id: String(Date.now()), name, starred: false, hash: encodeShared(shared), at: Date.now() }]);
  };

  return (
    <>
      <Banner meta={data?.meta} />
      <nav className="steps" aria-label="Steps">
        {STEPS.map(([k, label]) => <button key={k} className={screen === k ? "active" : ""} onClick={() => setScreen(k)} aria-current={screen === k}>{label}</button>)}
      </nav>
      {loadErr && <Note><span className="bad">Could not load mod data: {loadErr}</span></Note>}
      {!data && !loadErr && <p className="muted">Loading mod data…</p>}
      {data && screen === "input" && (
        <InputScreen index={data.index}
          onText={(t) => { setPhoto(undefined); loadItem(parseItem(t)); }}
          onPhoto={(f) => { setPhoto({ url: URL.createObjectURL(f), file: f }); setRows([]); setMeta({}); setWarnings([]); setScreen("review"); }}
          onMod={(e) => { setPhoto(undefined); setRows([...rows, rowFromEntry(e, meta.itemClass)]); setScreen("review"); }} />
      )}
      {data && screen === "review" && (
        <ReviewScreen index={data.index} meta={meta} setMeta={setMeta} rows={rows} setRows={setRows} photo={photo} warnings={warnings}
          onOcr={(lines) => { const { item, conf } = parseOcrLines(lines); setMeta({ ...meta, ...(item.itemLevel ? { itemLevel: item.itemLevel } : {}) }); setRows(rowsFromItem(item, data.index, conf)); setWarnings(item.warnings.filter((w) => !/item level/i.test(w) || !item.itemLevel)); }}
          onNext={() => setScreen("mods")} />
      )}
      {data && screen === "mods" && <ModsScreen rows={rows} setRows={setRows} meta={meta} settings={settings} setSettings={setSettings} onNext={() => setScreen("output")} />}
      {data && screen === "output" && <OutputScreen index={data.index} rows={rows} meta={meta} settings={settings} setSettings={setSettings} rates={rates} setRates={setRates} onSave={saveSearch} />}
      {data && screen === "saved" && <SavedScreen saved={saved} setSaved={setSaved} onLoad={(h) => fromHash(h, data)} />}
    </>
  );
}
