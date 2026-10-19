import { useMemo, useRef, useState } from "react";
import type { IndexedText, ModIndex } from "../core/modIndex.js";

/** Substring search over all trade stat texts; every typed word must appear. */
export function searchMods(index: ModIndex, q: string, limit = 12): IndexedText[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: IndexedText[] = [];
  for (const e of index.all) {
    const t = e.text.toLowerCase();
    if (words.every((w) => t.includes(w))) {
      out.push(e);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function ModSearch({ index, onPick, placeholder = "Search a mod, e.g. fire resistance" }: { index: ModIndex; onPick: (e: IndexedText) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => searchMods(index, q), [index, q]);
  return (
    <div>
      <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Search mods" />
      {hits.map((h) => (
        <button key={h.text} style={{ display: "block", width: "100%", textAlign: "left", marginTop: 4 }} onClick={() => { onPick(h); setQ(""); }}>{h.text}</button>
      ))}
    </div>
  );
}

export function InputScreen({ index, onText, onPhoto, onMod }: {
  index: ModIndex; onText: (t: string) => void; onPhoto: (f: File) => void; onMod: (e: IndexedText) => void;
}) {
  const [text, setText] = useState("");
  const cam = useRef<HTMLInputElement>(null);
  const gal = useRef<HTMLInputElement>(null);
  return (
    <>
      <h1>Input</h1>
      <div className="card">
        <h2>Photo</h2>
        <div className="row">
          <button className="primary" onClick={() => cam.current?.click()}>Camera</button>
          <button onClick={() => gal.current?.click()}>Gallery</button>
        </div>
        <input ref={cam} hidden type="file" accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ""; }} />
        <input ref={gal} hidden type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ""; }} />
        <p className="muted">Runs on this device. Nothing is uploaded. You review every line before use.</p>
      </div>
      <div className="card">
        <h2>Paste item text</h2>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Ctrl+C (or Ctrl+Alt+C for advanced) on an item in game, then paste here" aria-label="Item text" />
        <button className="primary" disabled={!text.trim()} onClick={() => onText(text)}>Parse</button>
      </div>
      <div className="card">
        <h2>Search a mod</h2>
        <ModSearch index={index} onPick={onMod} />
      </div>
    </>
  );
}
