import { useState, type ReactNode } from "react";
import type { Meta } from "../data.js";
import { copy } from "../store.js";

export function Banner({ meta }: { meta: Meta | undefined }) {
  return (
    <div className="banner" role="status">
      <span>Data: {meta ? `PoB2 snapshot ${meta.pob2CommitDate.slice(0, 10)} (${meta.pob2Commit.slice(0, 7)})` : "loading…"}</span>
      {meta && <span>built {meta.builtAt.slice(0, 10)} · {meta.counts.mods} mods · {meta.counts.statTexts} trade stats</span>}
      <span>App 0.1.0</span>
    </div>
  );
}

export const Chip = ({ kind, children }: { kind?: "ok" | "warn" | "bad"; children: ReactNode }) => <span className={`chip ${kind ?? ""}`}>{children}</span>;

export const Note = ({ children }: { children: ReactNode }) => <div className="note">{children}</div>;

export function CopyButton({ text, label = "Copy", disabled }: { text: string; label?: string; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <button disabled={disabled} onClick={async () => { setState((await copy(text)) ? "ok" : "fail"); setTimeout(() => setState("idle"), 1500); }}>
      {state === "ok" ? "Copied" : state === "fail" ? "Copy failed" : label}
    </button>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <span className="seg" role="group">
      {options.map(([v, label]) => <button key={v} className={v === value ? "on" : ""} onClick={() => onChange(v)} aria-pressed={v === value}>{label}</button>)}
    </span>
  );
}

export const num = (v: string): number | undefined => (v.trim() === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));
