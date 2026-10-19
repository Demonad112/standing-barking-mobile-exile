import { CopyButton } from "./common.js";
import type { SavedSearch } from "../store.js";

export function SavedScreen({ saved, setSaved, onLoad }: { saved: SavedSearch[]; setSaved: (s: SavedSearch[]) => void; onLoad: (hash: string) => void }) {
  const link = (h: string) => `${location.origin}${location.pathname}#s=${h}`;
  const sorted = [...saved].sort((a, b) => Number(b.starred) - Number(a.starred) || b.at - a.at);
  return (
    <>
      <h1>Saved</h1>
      {sorted.length === 0 && <p className="muted">Nothing saved yet. Use "Save search" on the Output screen.</p>}
      {sorted.map((s) => (
        <div className="card" key={s.id}>
          <strong>{s.name}</strong> <span className="muted">{new Date(s.at).toLocaleString()}</span>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="primary" onClick={() => onLoad(s.hash)}>Open</button>
            <button onClick={() => setSaved(saved.map((x) => (x.id === s.id ? { ...x, starred: !x.starred } : x)))} aria-pressed={s.starred}>{s.starred ? "★ Starred" : "☆ Star"}</button>
            <CopyButton text={link(s.hash)} label="Copy share link" />
            <button onClick={() => setSaved(saved.filter((x) => x.id !== s.id))}>Delete</button>
          </div>
        </div>
      ))}
    </>
  );
}
