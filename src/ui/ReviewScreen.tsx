import { useEffect, useRef, useState } from "react";
import { tierLabel } from "../core/affixes.js";
import { ITEM_CLASSES, type ModIndex } from "../core/modIndex.js";
import { validateAffixes } from "../core/parseItem.js";
import type { Affix, ModKind } from "../core/types.js";
import { cleanLine } from "../ocr/fromOcr.js";
import { recognizePhoto, type OcrLine } from "../ocr/ocr.js";
import type { Crop } from "../ocr/preprocess.js";
import { affixOf, annotateRow, chosen, pickManual, rematch, type AnnotateCtx, type ItemMeta, type Row } from "../model.js";
import { Chip, Note, num } from "./common.js";
import { ModSearch } from "./InputScreen.js";

export interface PhotoState { url: string; file: File }

/** Set the base type by hand: gives the item class and the exact spawn tags for tier maths (e.g. Str/Dex armour). */
function BasePicker({ ctx, meta, setMeta }: { ctx: AnnotateCtx; meta: ItemMeta; setMeta: (m: ItemMeta) => void }) {
  const [q, setQ] = useState("");
  const hits = q.trim().length >= 2 ? ctx.affixes.searchBases(q, 6) : [];
  return (
    <div style={{ marginTop: 8 }}>
      <label htmlFor="base">Base type {meta.baseType ? <Chip kind="ok">{meta.baseType}</Chip> : <Chip kind="warn">not found</Chip>}</label>
      <input id="base" type="text" value={q} placeholder="Type to set, e.g. Sapphire Ring" onChange={(e) => setQ(e.target.value)} />
      {hits.map((h) => (
        <button key={h.name} style={{ display: "block", width: "100%", textAlign: "left", marginTop: 4 }}
          onClick={() => { setMeta({ ...meta, baseType: h.name, ...(h.appClass ? { itemClass: h.appClass } : {}) }); setQ(""); }}>
          {h.name} <span className="muted">{h.appClass ?? h.className}</span>
        </button>
      ))}
    </div>
  );
}

const confKind = (c: string) => (c === "high" ? "ok" : c === "medium" ? "warn" : "bad");

export function ReviewScreen({ index, meta, setMeta, annotateCtx, rows, setRows, photo, onOcr, warnings, onNext }: {
  index: ModIndex; meta: ItemMeta; setMeta: (m: ItemMeta) => void; annotateCtx: AnnotateCtx; rows: Row[]; setRows: (r: Row[]) => void;
  photo?: PhotoState; onOcr: (lines: OcrLine[]) => void; warnings: string[]; onNext: () => void;
}) {
  const [crop, setCrop] = useState<Crop>({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
  const [passInfo, setPassInfo] = useState<string>();
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
      const r = await recognizePhoto(img, crop, (sk) => index.bySkeleton.has(sk), (p, st) => setProgress({ p, s: st }), (ls) => !!annotateCtx.affixes.detectBase(ls.map((l) => cleanLine(l.text))));
      const lines = r.lines;
      setPassInfo(`Used "${r.pass}" (${r.tried.map((t) => `${t.name}: ${t.score}`).join("; ")})`);
      onOcr(lines);
    } catch (e) {
      setErr(`OCR failed: ${e instanceof Error ? e.message : String(e)}. You can still paste the item text.`);
    } finally { setProgress(undefined); }
  };

  const affixWarn = validateAffixes({ ...(meta.rarity ? { rarity: meta.rarity } : {}), lines: rows.filter((r) => r.confirmed).map((r) => ({ raw: r.raw, kind: r.kind, values: r.values, skeleton: r.skeleton, ...(affixOf(r) ? { affix: affixOf(r)! } : {}), ...(r.group !== undefined ? { group: r.group } : r.inf ? { group: 1000 + r.inf.family } : {}) })) });
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
        <BasePicker ctx={annotateCtx} meta={meta} setMeta={setMeta} />
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
          <p className="muted">Crop tight around the item tooltip (name down to item level). Reading tries several image clean-ups and keeps the best.</p>
          <button className="primary" onClick={runOcr} disabled={!!progress}>Read text</button>
          {progress && <div><progress value={progress.p} max={1} /> <span className="muted">{progress.s}</span></div>}
          {err && <p className="bad">{err}</p>}
          {passInfo && <p className="muted">{passInfo}</p>}
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
                onBlur={(e) => { if (e.target.value !== r.match.line.raw) update(r.id, (x) => annotateRow(rematch(x, e.target.value, index, meta.itemClass), annotateCtx)); }} />
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <Chip kind={confKind(r.match.confidence)}>match: {r.match.confidence}</Chip>
              {r.ocrConf !== undefined && <Chip kind={r.ocrConf >= 80 ? "ok" : "bad"}>OCR {r.ocrConf}%</Chip>}
              <select aria-label="Mod kind" value={r.kind} style={{ width: "auto", minHeight: 0 }}
                onChange={(e) => update(r.id, (x) => annotateRow(rematch({ ...x, kind: e.target.value as ModKind }, x.raw, index, meta.itemClass), annotateCtx))}>
                {(["explicit", "implicit", "rune", "fractured", "desecrated", "crafted", "enchant"] as ModKind[]).map((k) => <option key={k}>{k}</option>)}
              </select>
              {r.tier && <Chip>tier {r.tier}</Chip>}
              {!r.affix && r.inf && <Chip kind={r.inf.approx ? "warn" : "ok"}>{r.inf.affix}{tierLabel(r.inf) ? ` ${tierLabel(r.inf)}` : ""}{r.inf.approx ? " (guess)" : " (auto)"}</Chip>}
              {r.inf && !r.inf.approx && r.inf.names[0] && <Chip>{r.inf.names.slice(0, 2).join(" / ")}</Chip>}
              <span className="seg" role="group" aria-label="Affix">
                {([undefined, "prefix", "suffix"] as Array<Affix | undefined>).map((a) => (
                  <button key={a ?? "auto"} className={r.affix === a ? "on" : ""} title={a ? `Force ${a}` : "Auto (inferred from mod data)"} onClick={() => update(r.id, (x) => { const { affix: _a, ...rest } = x; void _a; return a ? { ...rest, affix: a } : rest; })}>{a ? a[0]!.toUpperCase() : "A"}</button>
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
            {c && !c.slotKnown && !r.inf?.span && <p className="muted">No roll range known for this item class, so no automatic weight.</p>}
            {c && !c.slotKnown && r.inf?.span && <p className="muted">Roll range {r.inf.span[0]}–{r.inf.span[1]} from mod data (all tiers for this base).</p>}
            <button style={{ marginTop: 6 }} onClick={() => setPicking(picking === r.id ? undefined : r.id)}>{picking === r.id ? "Close picker" : "Pick another mod…"}</button>
            {picking === r.id && <ModSearch index={index} onPick={(e) => { update(r.id, (x) => pickManual(x, e, meta.itemClass)); setPicking(undefined); }} />}
          </div>
        );
      })}

      <button className="primary" disabled={confirmed === 0} onClick={onNext}>Continue with {confirmed} confirmed line{confirmed === 1 ? "" : "s"}</button>
    </>
  );
}
