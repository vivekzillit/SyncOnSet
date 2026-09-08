import { useMemo } from "react";

export interface DetectedCharacter { name: string; scenes: number; lines: number; exists: boolean }
export interface ExistingCharacter { id: string; name: string; castNumber?: number | null }
export interface ConfirmRow { name: string; deleted: boolean }

/**
 * Build the import payload from confirmation rows:
 * - a deleted row is not a character (characterMap[name] = null);
 * - a row whose name matches an existing character (case-insensitive) merges into it;
 * - any other row becomes a new character.
 * Cast numbers are not collected here (they are set on the character page); `castNumbers` stays in the payload shape for the API.
 */
export function buildCharacterImport(rows: ConfirmRow[], existing: ExistingCharacter[]) {
  const characterMap: Record<string, string | null> = {};
  const castNumbers: Record<string, number> = {};
  const existingByName = new Map(existing.map((e) => [e.name.toLowerCase(), e]));
  for (const r of rows) {
    if (r.deleted) { characterMap[r.name] = null; continue; }
    const ex = existingByName.get(r.name.toLowerCase());
    characterMap[r.name] = ex ? ex.name : r.name;
  }
  return { characterMap, castNumbers };
}

export function initialRows(detected: DetectedCharacter[]): ConfirmRow[] {
  return detected.map((d) => ({ name: d.name, deleted: false }));
}

/** SyncOnSet-style "Character Confirmation" table: every speaking role with scene/line counts, Delete per row, Delete All. */
export function CharacterConfirmation({ rows, onChange, detected, existing }: { rows: ConfirmRow[]; onChange: (rows: ConfirmRow[]) => void; detected: DetectedCharacter[]; existing: ExistingCharacter[] }) {
  const stats = useMemo(() => new Map(detected.map((d) => [d.name, d])), [detected]);
  const existingByName = useMemo(() => new Map(existing.map((e) => [e.name.toLowerCase(), e])), [existing]);
  const set = (i: number, patch: Partial<ConfirmRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const alive = rows.filter((r) => !r.deleted);
  return (
    <div className="table-wrap card flat pad-0" style={{ maxHeight: "48vh", overflowY: "auto" }}>
      <table className="table">
        <thead><tr><th>Name</th><th className="hide-mobile">Scenes</th><th className="hide-mobile">Lines</th><th className="right"><button type="button" className="btn btn-danger btn-sm" onClick={() => onChange(rows.map((r) => ({ ...r, deleted: true })))} disabled={!alive.length}>Delete All</button></th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const d = stats.get(r.name);
            const ex = existingByName.get(r.name.toLowerCase());
            return (
              <tr key={r.name} style={{ opacity: r.deleted ? 0.45 : 1 }}>
                <td><span className="bold" style={{ textDecoration: r.deleted ? "line-through" : undefined }}>{r.name.toUpperCase()}</span>{ex && !r.deleted && <span className="subtle tiny"> · existing{ex.castNumber != null ? ` #${ex.castNumber}` : ""}</span>}</td>
                <td className="hide-mobile num">{d?.scenes ?? ""}</td>
                <td className="hide-mobile num">{d?.lines ?? ""}</td>
                <td className="right">{r.deleted ? <button type="button" className="btn btn-sm" onClick={() => set(i, { deleted: false })}>Restore</button> : <button type="button" className="btn btn-danger btn-sm" onClick={() => set(i, { deleted: true })}>Delete</button>}</td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={4} className="subtle">No speaking characters were found in this script.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
