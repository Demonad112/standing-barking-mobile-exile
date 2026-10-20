// localStorage wrappers. Every access is guarded: storage can be blocked, full, or absent (private windows, previews).
export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch { return fallback; }
}
export function save(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}
export function remove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export interface SavedSearch { id: string; name: string; starred: boolean; hash: string; at: number }
export const loadSaved = () => load<SavedSearch[]>("saved", []);
export const saveSaved = (s: SavedSearch[]) => save("saved", s);

export async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
