import { PROFILES } from "../core/weights.js";
import { COMPLEXITY_LIMIT } from "../core/tradeQuery.js";
import { chosen, queryFor, rollOfRow, weightOf, type ItemMeta, type Level, type Row } from "../model.js";
import type { Settings } from "../settings.js";
import { Chip, Note, Seg, num } from "./common.js";

const sourceKind = (s: string) => (s === "manual" ? "warn" : s === "profile" ? "ok" : undefined);

export function ModsScreen({ rows, setRows, meta, settings, setSettings, onNext }: {
  rows: Row[]; setRows: (r: Row[]) => void; meta: ItemMeta; settings: Settings; setSettings: (s: Settings) => void; onNext: () => void;
}) {
  const shown = rows.filter((r) => r.confirmed && chosen(r));
  const update = (id: number, f: (r: Row) => Row) => setRows(rows.map((r) => (r.id === id ? f(r) : r)));
  const set = <K extends keyof Settings>(k: K, v: Settings[K] | undefined) => {
    const next = { ...settings } as Record<string, unknown>;
    if (v === undefined) delete next[k as string]; else next[k as string] = v;
    setSettings(next as unknown as Settings);
  };
  const plan = queryFor(rows, meta, settings);
  const used = shown.filter((r) => r.level !== "off");
  const count = (a: "prefix" | "suffix") => new Set(used.filter((r) => r.affix === a).map((r) => r.group ?? `r${r.id}`)).size;
  const weighted = plan.built.keptWeighted.length + plan.built.droppedWeighted.length;
  const dropped = plan.built.droppedWeighted.length + plan.built.droppedMust.length;

  return (
    <>
      <h1>Mods and weights</h1>
      <div className="card">
        <div className="row">
          <Chip kind={count("prefix") > 3 ? "bad" : undefined}>prefixes {count("prefix")}/3</Chip>
          <Chip kind={count("suffix") > 3 ? "bad" : undefined}>suffixes {count("suffix")}/3</Chip>
          <Chip kind={dropped ? "bad" : undefined}>trade complexity {plan.built.used}/{COMPLEXITY_LIMIT}</Chip>
          <Chip>{plan.built.keptWeighted.length}/{weighted} weighted mods kept</Chip>
        </div>
        {plan.built.warnings.map((w) => <Note key={w}>{w}</Note>)}
      </div>

      <div className="card">
        <div className="grid2">
          <div><label htmlFor="league">League</label><input id="league" type="text" value={settings.league} onChange={(e) => set("league", e.target.value)} /></div>
          <div><label htmlFor="role">Role preset</label>
            <select id="role" value={settings.role} onChange={(e) => set("role", e.target.value)}>
              <option value="">None (normalized weights only)</option>
              {Object.entries(PROFILES.roles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div><label htmlFor="cap">Price cap (Exalted)</label><input id="cap" type="number" inputMode="decimal" value={settings.priceCap ?? ""} onChange={(e) => set("priceCap", num(e.target.value))} /></div>
          <div><label htmlFor="ilvl">Min item level</label><input id="ilvl" type="number" inputMode="numeric" value={settings.minIlvl ?? ""} onChange={(e) => set("minIlvl", num(e.target.value))} /></div>
          <div><label htmlFor="min">Min weighted score (auto: {plan.minScore})</label><input id="min" type="number" inputMode="decimal" value={settings.minScore ?? ""} placeholder={String(plan.minScore)} onChange={(e) => set("minScore", num(e.target.value))} /></div>
        </div>
        <p className="muted">Score = Σ weight × roll. Default weight = 100 ÷ max roll. Role presets multiply it (data/profiles.json, editable, starting points only).</p>
      </div>

      {shown.length === 0 && <p className="muted">No confirmed lines. Go back to Review and confirm some.</p>}
      {shown.map((r) => {
        const c = chosen(r)!;
        const w = weightOf(r, meta.itemClass, settings.role || undefined);
        return (
          <div className="card" key={r.id}>
            <strong>{c.text}</strong>
            <div className="muted">
              roll {Math.round(rollOfRow(r) * 100) / 100}{c.range ? ` · range ${c.range[0]}–${c.range[1]} for this item class` : " · no range known"}{r.affix ? ` · ${r.affix}` : ""}
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <Seg<Level> value={r.level} options={[["off", "Off"], ["nice", "Nice"], ["must", "Must"]]} onChange={(l) => update(r.id, (x) => ({ ...x, level: l }))} />
            </div>
            <div className="grid2">
              <div>
                <label htmlFor={`w${r.id}`}>Weight {w ? <Chip kind={sourceKind(w.source)}>{w.source}{w.note ? ` · ${w.note}` : ""}</Chip> : <Chip kind="bad">needs manual weight</Chip>}</label>
                <input id={`w${r.id}`} type="number" inputMode="decimal" value={r.weight ?? ""} placeholder={w ? String(Math.round(w.value * 1000) / 1000) : "enter weight"}
                  onChange={(e) => update(r.id, (x) => { const v = num(e.target.value); const { weight: _w, ...rest } = x; void _w; return v === undefined ? rest : { ...rest, weight: v }; })} />
              </div>
              <div>
                <label htmlFor={`m${r.id}`}>Min roll (must-have + regex)</label>
                <input id={`m${r.id}`} type="number" inputMode="decimal" value={r.minRoll ?? ""} placeholder={String(Math.floor(rollOfRow(r)))}
                  onChange={(e) => update(r.id, (x) => { const v = num(e.target.value); const { minRoll: _m, ...rest } = x; void _m; return v === undefined ? rest : { ...rest, minRoll: v }; })} />
              </div>
            </div>
          </div>
        );
      })}
      {plan.sel.skipped.map((s) => <Note key={s.row.id}>Skipped in trade search: "{s.row.raw}": {s.reason}.</Note>)}
      {plan.built.droppedWeighted.length > 0 && <Note>Dropped (lowest weights): {plan.built.droppedWeighted.map((d) => d.id).join(", ")}</Note>}
      <button className="primary" disabled={used.length === 0} onClick={onNext}>Generate outputs</button>
    </>
  );
}
