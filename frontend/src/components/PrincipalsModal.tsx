import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { Character } from "@/api/types";
import { humanize } from "@/lib/format";
import { Modal, SearchBox, initials } from "@/components/ui";

type CastLike = { name: string; castNumber?: number | null };

/** "3. Priya" when the character has a cast number, otherwise just the name. */
export const castLabel = (c: CastLike) => (c.castNumber != null ? `${c.castNumber}. ${c.name}` : c.name);

/** Cast-number order (unnumbered characters last, alphabetical). */
export function sortByCast<T extends CastLike>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.castNumber ?? Number.MAX_SAFE_INTEGER) - (b.castNumber ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));
}

/**
 * "Add & Remove Principals": tag-style multi-select of characters for a scene.
 * `value` is the list of selected character ids; `onChange` receives the new list when Save is pressed.
 */
export function PrincipalsModal({ open, onClose, characters, value, onChange }: { open: boolean; onClose: () => void; characters: Character[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(value);
  const [q, setQ] = useState("");

  // Reset the working selection every time the modal opens — and only then. The latest `value` is read
  // through a ref so a parent re-render (or background refetch) that passes a new array identity while
  // the modal is open does not wipe the user's in-progress chips.
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    if (open) {
      setSel(valueRef.current);
      setQ("");
    }
  }, [open]);

  const byId = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters]);
  const selected = useMemo(() => sortByCast(sel.map((id) => byId.get(id)).filter((c): c is Character => !!c)), [sel, byId]);
  const available = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sortByCast(characters.filter((c) => !sel.includes(c.id) && (!needle || castLabel(c).toLowerCase().includes(needle) || (c.actor?.name || "").toLowerCase().includes(needle))));
  }, [characters, sel, q]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add & Remove Principals"
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" onClick={() => { onChange(sel); onClose(); }}>Save</button></>}
    >
      <div className="field">
        <label>Principals in this scene</label>
        <div className="chips" style={{ minHeight: 44, padding: 6, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-2)" }}>
          {selected.length === 0 && <span className="subtle" style={{ padding: "5px 6px" }}>No principals yet — pick characters from the list below.</span>}
          {selected.map((c) => (
            <span key={c.id} className="chip active" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {castLabel(c)}
              <button type="button" onClick={() => setSel(sel.filter((x) => x !== c.id))} aria-label={`Remove ${c.name}`} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, display: "inline-flex" }}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-2"><SearchBox value={q} onChange={setQ} placeholder="Search characters by name, number or actor…" autoFocus /></div>

      <div className="list card flat pad-0 mt-2" style={{ maxHeight: "40vh", overflowY: "auto" }}>
        {available.length === 0 ? (
          <div className="subtle" style={{ padding: 12 }}>{characters.length === 0 ? "No characters in this project yet. Add them on the Characters page first." : q ? "No characters match." : "Every character is already in this scene."}</div>
        ) : (
          available.map((c) => (
            <button key={c.id} type="button" className="item link" style={{ width: "100%", background: "none", border: "none", textAlign: "left" }} onClick={() => setSel([...sel, c.id])}>
              <div className="avatar">{c.castNumber ?? initials(c.name)}</div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="title truncate">{castLabel(c)}</div>
                <div className="meta truncate">{humanize(c.type)}{c.actor ? ` · ${c.actor.name}` : ""}</div>
              </div>
              <Plus size={16} color="var(--text-3)" />
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
