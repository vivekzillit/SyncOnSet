import { useMemo } from "react";
import { Plus } from "lucide-react";
import { Input } from "./ui";

export interface DetectedCharacter { name: string; scenes: number; lines: number; exists: boolean }
export interface ExistingCharacter { id: string; name: string; castNumber?: number | null }
/** `manual` marks a row typed in by hand rather than read out of the script; its name stays editable. */
export interface ConfirmRow { name: string; castNumber: string; deleted: boolean; manual?: boolean }

/** Only a whole non-negative number counts as a cast number (the API rejects anything else); blank means none. */
function castNumberOf(r: ConfirmRow): number | null {
  const t = r.castNumber.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

/**
 * Build the import payload from confirmation rows:
 * - a deleted row is not a character (characterMap[name] = null);
 * - a row whose name matches an existing character (case-insensitive) merges into it;
 * - any other row becomes a new character, carrying the cast number typed beside it.
 */
export function buildCharacterImport(rows: ConfirmRow[], existing: ExistingCharacter[]) {
  const characterMap: Record<string, string | null> = {};
  const castNumbers: Record<string, number> = {};
  const existingByName = new Map(existing.map((e) => [e.name.toLowerCase(), e]));
  for (const r of rows) {
    const name = r.name.trim();
    if (!name) continue;
    if (r.deleted) { characterMap[name] = null; continue; }
    const ex = existingByName.get(name.toLowerCase());
    const target = ex ? ex.name : name;
    characterMap[name] = target;
    const n = castNumberOf(r);
    if (n != null) castNumbers[target] = n;
  }
  return { characterMap, castNumbers };
}

/**
 * Characters typed in by hand that no scene mentions. The breakdown import only creates the names it finds in
 * scenes, so these are created on their own; anything already detected or already in the production is left alone.
 */
export function manualCharacters(rows: ConfirmRow[], existing: ExistingCharacter[], detected: DetectedCharacter[]) {
  const known = new Set([...existing.map((e) => e.name.toLowerCase()), ...detected.map((d) => d.name.toLowerCase())]);
  const out: { name: string; castNumber: number | null }[] = [];
  for (const r of rows) {
    const name = r.name.trim();
    if (!r.manual || r.deleted || !name) continue;
    const key = name.toLowerCase();
    if (known.has(key)) continue;
    known.add(key);
    out.push({ name, castNumber: castNumberOf(r) });
  }
  return out;
}

export function initialRows(detected: DetectedCharacter[], existing: ExistingCharacter[] = []): ConfirmRow[] {
  const byName = new Map(existing.map((e) => [e.name.toLowerCase(), e]));
  return detected.map((d) => ({ name: d.name, castNumber: byName.get(d.name.toLowerCase())?.castNumber?.toString() ?? "", deleted: false }));
}

/**
 * SyncOnSet-style character list: every speaking role the script named, with its cast number, scene and line counts,
 * Delete per row and Delete All — plus a row you can type in for anyone the script never speaks (extras, doubles).
 */
export function CharacterConfirmation({ rows, onChange, detected, existing }: { rows: ConfirmRow[]; onChange: (rows: ConfirmRow[]) => void; detected: DetectedCharacter[]; existing: ExistingCharacter[] }) {
  const stats = useMemo(() => new Map(detected.map((d) => [d.name, d])), [detected]);
  const existingByName = useMemo(() => new Map(existing.map((e) => [e.name.toLowerCase(), e])), [existing]);
  const set = (i: number, patch: Partial<ConfirmRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const alive = rows.filter((r) => !r.deleted);
  const numStyle = { width: 84, minHeight: 34, padding: "4px 8px" };
  return (
    <>
      <div className="row between wrap gap-2 mb-2">
        <button type="button" className="btn btn-sm" onClick={() => onChange([...rows, { name: "", castNumber: "", deleted: false, manual: true }])}><Plus size={14} /> Add character</button>
        <span className="subtle tiny">{alive.length} character{alive.length === 1 ? "" : "s"} will be created</span>
      </div>
      <div className="table-wrap card flat pad-0" style={{ maxHeight: "48vh", overflowY: "auto" }}>
        <table className="table">
          <thead><tr><th style={{ width: 100 }}>Char #</th><th>Name</th><th className="hide-mobile">Scenes</th><th className="hide-mobile">Lines</th><th className="right"><button type="button" className="btn btn-danger btn-sm" onClick={() => onChange(rows.map((r) => ({ ...r, deleted: true })))} disabled={!alive.length}>Delete All</button></th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const d = stats.get(r.name);
              const ex = existingByName.get(r.name.trim().toLowerCase());
              return (
                // Rows are only ever appended, and deleting flags rather than removes, so the index is a stable key.
                <tr key={i} style={{ opacity: r.deleted ? 0.45 : 1 }}>
                  <td>{r.deleted ? <span className="subtle">—</span> : <Input type="number" min={0} step={1} placeholder="#" value={r.castNumber} onChange={(e) => set(i, { castNumber: e.target.value })} style={numStyle} className="mono" />}</td>
                  <td>
                    {r.manual && !r.deleted
                      ? <Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Character name" style={{ minHeight: 34, padding: "4px 8px" }} autoFocus />
                      : <span className="bold" style={{ textDecoration: r.deleted ? "line-through" : undefined }}>{r.name.toUpperCase() || "—"}</span>}
                    {ex && !r.deleted && <span className="subtle tiny"> · existing{ex.castNumber != null ? ` #${ex.castNumber}` : ""}</span>}
                  </td>
                  <td className="hide-mobile num">{d?.scenes ?? ""}</td>
                  <td className="hide-mobile num">{d?.lines ?? ""}</td>
                  <td className="right">{r.deleted ? <button type="button" className="btn btn-sm" onClick={() => set(i, { deleted: false })}>Restore</button> : <button type="button" className="btn btn-danger btn-sm" onClick={() => set(i, { deleted: true })}>Delete</button>}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={5} className="subtle">No speaking characters were found in this script. Add anyone you need with the button above.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
