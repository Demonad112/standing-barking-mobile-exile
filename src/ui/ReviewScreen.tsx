import { useEffect, useRef, useState } from "react";
import { ITEM_CLASSES, type ModIndex } from "../core/modIndex.js";
import { validateAffixes } from "../core/parseItem.js";
import type { Affix } from "../core/types.js";
import { preprocessToCanvas, recognize, type OcrLine } from "../ocr/ocr.js";
import type { Crop } from "../ocr/preprocess.js";
import { chosen, pickManual, rematch, type ItemMeta, type Row } from "../model.js";
import { Chip, Note, num } from "./common.js";
import { ModSearch } from "./InputScreen.js";

export interface PhotoState { url: string; file: File }

const confKind = (c: string) => (c === "high" ? "ok" : c === "medium" ? "warn" : "bad");

export function ReviewScreen({ index, meta, setMeta, rows, setRows, photo, onOcr, warnings, onNext }: {
  index: ModIndex; meta: ItemMeta; setMeta: (m: ItemMeta) => void; rows: Row[]; setRows: (r: Row[]) => void;
  photo?: PhotoState; onOcr: (lines: OcrLine[]) => void; warnings: string[]; onNext: () => void;
}) {
  const [crop, setCrop] = useState<Crop>({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
  const [thr, setThr] = useState(false);
  const [progress, setProgress] = useState<{ p: number; s: string } | undefined>();
  const [err, setErr] = useState<string>();
  const [picking, setPicking] = useState<number>();
  const imgRef = useRef<HTMLImageElement>(null);
  const update = (id: number, f: (r: Row) => Row) => setRows(rows.map((r) => (r.id === id ? f(r) : r)));

  useEffect(() => { setErr(undefined); }, [photo]);

  const runOcr = async () => {
    const img = imgRef.current;
    if (!img) return;
    setErr(undefined);
    setProgress({ p: 0, s: "preparing" });
    try {
      const canvas = await preprocessToCanvas(img, crop, { threshold: thr });
      const lines = await recognize(canvas, (p, s) => setProgress({ p, s }));
      onOcr(lines);
    } catch (e) {
      setErr(`OCR failed: ${e instanceof Error ? e.message : String(e)}. You can still paste the item text.`);
    } finally { setProgress(undefined); }
  };

  const affixWarn = validateAffixes({ ...(meta.rarity ? { rarity: meta.rarity } : {}), lines: rows.filter((r) => r.confirmed).map((r) => ({ raw: r.raw, kind: r.kind, values: r.values, skeleton: r.skeleton, ...(r.affix ? { affix: r.affix } : {}), ...(r.group !== undefined ? { group: r.group } : {}) })) });
  const confirmed = rows.filter((r) => r.confirmed && chosen(r)).length;

  return (
    <>
      <h1>Review</h1>
      <div className="card">
        <div className="grid2">
          <div>
            <label htmlFor="cls">Item class</label>
            <select id="cls" value={meta.itemClass ?? ""} onChange={(e) => setMeta({ ...meta, ...(e.target.value ? { itemClass: e.target.value } : {}) })}>
              <option value="">(unknown: ranges and weights unavailable)</option>
              {ITEM_CLASSES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ilvl">Item level {meta.itemLevel ? "" : "(not found, enter it)"}</label>
            <input id="ilvl" type="number" inputMode="numeric" value={meta.itemLevel ?? ""} onChange={(e) => { const v = num(e.target.value); setMeta({ ...meta, ...(v !== undefined ? { itemLevel: v } : {}) }); }} />
          </div>
        </div>
        {meta.baseType && <p className="muted">Base: {meta.baseType}{meta.rarity ? ` · ${meta.rarity}` : ""}</p>}
      </div>

      {photo && (
        <div className="card">
          <h2>Photo</h2>
          <div className="imgwrap">
            <img ref={imgRef} src={photo.url} alt="Item tooltip" />
            <div className="cropbox" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }} />
          </div>
          <div className="grid2">
            {(["x", "y", "w", "h"] as const).map((k) => (
              <div key={k}>
                <label htmlFor={`c${k}`}>Crop {({ x: "left", y: "top", w: "width", h: "height" })[k]}</label>
                <input id={`c${k}`} type="range" min={0} max={1} step={0.01} value={crop[k]} onChange={(e) => setCrop({ ...crop, [k]: Number(e.target.value) })} />
              </div>
            ))}
          </div>
          <label><input type="checkbox" checked={thr} onChange={(e) => setThr(e.target.checked)} style={{ width: "auto", minHeight: 0 }} /> Black-and-white threshold (try if text is faint)</label>
          <button className="primary" onClick={runOcr} disabled={!!progress}>Read text</button>
          {progress && <div><progress value={progress.p} max={1} /> <span className="muted">{progress.s}</span></div>}
          {err && <p className="bad">{err}</p>}
        </div>
      )}

      {warnings.map((w) => <Note key={w}>{w}</Note>)}
      {affixWarn.map((w) => <Note key={w}><span className="bad">{w}</span> Check the prefix/suffix tags below.</Note>)}

      {rows.length === 0 && <p className="muted">No mod lines yet. {photo ? "Crop to the mod area and press Read text." : "Go back and paste an item."}</p>}

      {rows.map((r) => {
        const c = chosen(r);
        return (
          <div className="card" key={r.id}>
            <div className="row">
              <label className="fixed" style={{ margin: 0 }}>
                <input type="checkbox" checked={r.confirmed} disabled={!c} aria-label={`Confirm line ${r.raw}`}
                  onChange={(e) => update(r.id, (x) => ({ ...x, confirmed: e.target.checked, level: e.target.checked && x.level === "off" ? "nice" : x.level }))}
                  style={{ width: 22, height: 22, minHeight: 0 }} />
              </label>
              <input type="text" value={r.raw} aria-label="Line text" onChange={(e) => update(r.id, (x) => ({ ...x, raw: e.target.value }))}
                onBlur={(e) => { if (e.target.value !== r.match.line.raw) update(r.id, (x) => rematch(x, e.target.value, index, meta.itemClass)); }} />
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <Chip kind={confKind(r.match.confidence)}>match: {r.match.confidence}</Chip>
              {r.ocrConf !== undefined && <Chip kind={r.ocrConf >= 80 ? "ok" : "bad"}>OCR {r.ocrConf}%</Chip>}
              <Chip>{r.kind}</Chip>
              {r.tier && <Chip>tier {r.tier}</Chip>}
              <span className="seg" role="group" aria-label="Affix">
                {([undefined, "prefix", "suffix"] as Array<Affix | undefined>).map((a) => (
                  <button key={a ?? "none"} className={r.affix === a ? "on" : ""} onClick={() => update(r.id, (x) => { const { affix: _a, ...rest } = x; void _a; return a ? { ...rest, affix: a } : rest; })}>{a ? a[0]!.toUpperCase() : "–"}</button>
                ))}
              </span>
            </div>
            {r.match.candidates.length > 0 && (
              <select aria-label="Matched mod" value={r.manual ? "manual" : r.pick ?? ""} onChange={(e) => update(r.id, (x) => { const { manual: _m, ...rest } = x; void _m; return e.target.value === "" ? { ...rest, confirmed: false } : { ...rest, pick: Number(e.target.value), confirmed: false }; })} style={{ marginTop: 6 }}>
                <option value="">(none of these)</option>
                {r.match.candidates.map((cand, i) => <option key={cand.text} value={i}>{cand.text} · {Math.round(cand.score * 100)}%{cand.exact ? "" : " (fuzzy)"}</option>)}
                {r.manual && <option value="manual">{r.manual.text} (picked)</option>}
              </select>
            )}
            {c && !c.tradeId && <p className="warn muted">No trade stat id for "{c.text}" as {r.kind}; it can't be used in a trade search.</p>}
            {c && !c.slotKnown && <p className="muted">No roll range known for this item class, so no automatic weight.</p>}
            <button style={{ marginTop: 6 }} onClick={() => setPicking(picking === r.id ? undefined : r.id)}>{picking === r.id ? "Close picker" : "Pick another mod…"}</button>
            {picking === r.id && <ModSearch index={index} onPick={(e) => { update(r.id, (x) => pickManual(x, e, meta.itemClass)); setPicking(undefined); }} />}
          </div>
        );
      })}

      <button className="primary" disabled={confirmed === 0} onClick={onNext}>Continue with {confirmed} confirmed line{confirmed === 1 ? "" : "s"}</button>
    </>
  );
}
