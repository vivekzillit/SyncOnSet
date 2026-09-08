import { useMemo } from "react";
import { Input } from "./ui";

export interface DetectedCharacter { name: string; scenes: number; lines: number; exists: boolean }
export interface ExistingCharacter { id: string; name: string; castNumber?: number | null }
export interface ConfirmRow { name: string; castNumber: string; deleted: boolean }

/**
 * Build the import payload from confirmation rows, SyncOnSet style:
 * - a deleted row is not a character (characterMap[name] = null);
 * - rows that share a number merge: into the existing character with that cast number if there is one,
 *   otherwise into an existing character among those rows, otherwise into the first row carrying that number;
 * - a row whose number matches an existing character's cast number merges into that character.
 */
export function buildCharacterImport(rows: ConfirmRow[], existing: ExistingCharacter[]) {
  const characterMap: Record<string, string | null> = {};
  const castNumbers: Record<string, number> = {};
  const existingByNumber = new Map<number, ExistingCharacter>();
  existing.forEach((e) => { if (e.castNumber != null) existingByNumber.set(e.castNumber, e); });
  const existingByName = new Map(existing.map((e) => [e.name.toLowerCase(), e]));
  const firstByNumber = new Map<number, string>();
  // Rows that match an existing character claim their number first, so a new name never becomes the merge target of an existing one.
  const isExisting = (r: ConfirmRow) => existingByName.has(r.name.toLowerCase());
  const ordered = [...rows.filter(isExisting), ...rows.filter((r) => !isExisting(r))];
  for (const r of ordered) {
    if (r.deleted) { characterMap[r.name] = null; continue; }
    // Only a non-negative integer counts as a cast number (the API rejects decimals); anything else = no number.
    const t = r.castNumber.trim();
    const n = /^\d+$/.test(t) ? Number.parseInt(t, 10) : null;
    const ex = existingByName.get(r.name.toLowerCase());
    if (n === null) { characterMap[r.name] = ex ? ex.name : r.name; continue; }
    const byNum = existingByNumber.get(n);
    if (byNum) { characterMap[r.name] = byNum.name; continue; }
    const first = firstByNumber.get(n);
    if (first && first.toLowerCase() !== r.name.toLowerCase()) { characterMap[r.name] = first; continue; }
    firstByNumber.set(n, ex ? ex.name : r.name);
    characterMap[r.name] = ex ? ex.name : r.name;
    castNumbers[ex ? ex.name : r.name] = n;
  }
  return { characterMap, castNumbers };
}

export function initialRows(detected: DetectedCharacter[], existing: ExistingCharacter[]): ConfirmRow[] {
  const byName = new Map(existing.map((e) => [e.name.toLowerCase(), e]));
  return detected.map((d) => ({ name: d.name, castNumber: byName.get(d.name.toLowerCase())?.castNumber?.toString() ?? "", deleted: false }));
}

/** SyncOnSet-style "Character Confirmation" table: Char # per row, Delete, Delete All. */
export function CharacterConfirmation({ rows, onChange, detected, existing }: { rows: ConfirmRow[]; onChange: (rows: ConfirmRow[]) => void; detected: DetectedCharacter[]; existing: ExistingCharacter[] }) {
  const stats = useMemo(() => new Map(detected.map((d) => [d.name, d])), [detected]);
  const existingByName = useMemo(() => new Map(existing.map((e) => [e.name.toLowerCase(), e])), [existing]);
  const merges = useMemo(() => {
    const { characterMap } = buildCharacterImport(rows, existing);
    return characterMap;
  }, [rows, existing]);
  const set = (i: number, patch: Partial<ConfirmRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const alive = rows.filter((r) => !r.deleted);
  return (
    <div className="col gap-2">
      <div>
        <div className="bold">Below is a list of characters found in this script:</div>
        <ul className="small muted" style={{ margin: "4px 0 0 18px" }}>
          <li>To merge two characters together, give them the same number.</li>
          <li>Delete anything that is not a character (a sound, a sign, a crowd). Non-speaking roles can be added to scenes later.</li>
        </ul>
      </div>
      <div className="table-wrap card flat pad-0" style={{ maxHeight: "48vh", overflowY: "auto" }}>
        <table className="table">
          <thead><tr><th style={{ width: 110 }}>Char #</th><th>Name</th><th className="hide-mobile">Scenes</th><th className="hide-mobile">Lines</th><th></th><th className="right"><button type="button" className="btn btn-danger btn-sm" onClick={() => onChange(rows.map((r) => ({ ...r, deleted: true })))} disabled={!alive.length}>Delete All</button></th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const d = stats.get(r.name);
              const ex = existingByName.get(r.name.toLowerCase());
              const target = merges[r.name];
              const mergedInto = target && target.toLowerCase() !== r.name.toLowerCase() ? target : null;
              return (
                <tr key={r.name} style={{ opacity: r.deleted ? 0.45 : 1 }}>
                  <td>{r.deleted ? <span className="subtle">—</span> : <Input type="number" min={0} step={1} placeholder="CHAR #" value={r.castNumber} onChange={(e) => set(i, { castNumber: e.target.value })} style={{ width: 92, minHeight: 34, padding: "4px 8px" }} className="mono" />}</td>
                  <td><span className="bold" style={{ textDecoration: r.deleted ? "line-through" : undefined }}>{r.name.toUpperCase()}</span>{ex && !r.deleted && <span className="subtle tiny"> · existing{ex.castNumber != null ? ` #${ex.castNumber}` : ""}</span>}{mergedInto && !r.deleted && <div className="tiny" style={{ color: "var(--info)" }}>→ merges into {mergedInto}</div>}</td>
                  <td className="hide-mobile num">{d?.scenes ?? ""}</td>
                  <td className="hide-mobile num">{d?.lines ?? ""}</td>
                  <td></td>
                  <td className="right">{r.deleted ? <button type="button" className="btn btn-sm" onClick={() => set(i, { deleted: false })}>Restore</button> : <button type="button" className="btn btn-danger btn-sm" onClick={() => set(i, { deleted: true })}>Delete</button>}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="subtle">No speaking characters were found in this script.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
