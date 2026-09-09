import { api, p } from "@/api/client";
import { dateKey } from "@/lib/format";
import type { Character, Meta, Scene, SceneCharacter } from "@/api/types";
import { Input, Select, initials } from "@/components/ui";
import { castLabel, sortByCast } from "@/components/PrincipalsModal";

/* ---------- Inline row drafts ---------- */
export interface Draft { number: string; episode: string; dayPrefix: string; dayN: string; intExt: string; location: string; synopsis: string; shootDate: string; principals: string[] }
export const NEW = "new";
export const LOCATION_LIST_ID = "scene-locations";
const DAY_PREFIXES = ["Day", "Night"];
const INT_EXT_FALLBACK = ["INT", "EXT", "INT/EXT"];

/** "Day 3" / "D3" / "N12" → { dayPrefix, dayN }; anything else is kept verbatim in dayN. */
export function parseScriptDay(s?: string | null): { dayPrefix: string; dayN: string } {
  const raw = (s || "").trim();
  const word = raw.match(/^(day|night)\s*[-.:]?\s*(.*)$/i);
  if (word) return { dayPrefix: /^d/i.test(word[1]) ? "Day" : "Night", dayN: word[2].trim() };
  const short = raw.match(/^([dn])\s*(\d+[a-z]?)$/i);
  if (short) return { dayPrefix: /^d/i.test(short[1]) ? "Day" : "Night", dayN: short[2] };
  return { dayPrefix: "", dayN: raw };
}
const joinScriptDay = (d: Draft) => (d.dayN.trim() ? [d.dayPrefix, d.dayN.trim()].filter(Boolean).join(" ") : "");
/** A date-only input ("YYYY-MM-DD") is sent as the viewer's local midnight so it round-trips to the same calendar day in every timezone. */
const localDateISO = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, m - 1, d).toISOString(); };

export const emptyDraft = (): Draft => ({ number: "", episode: "", dayPrefix: "Day", dayN: "", intExt: "INT", location: "", synopsis: "", shootDate: "", principals: [] });
export const toDraft = (s: Scene): Draft => ({ number: s.number, episode: s.episode || "", ...parseScriptDay(s.scriptDay), intExt: s.intExt || "", location: s.location || "", synopsis: s.synopsis || "", shootDate: dateKey(s.shootDate), principals: s.characters.map((c) => c.characterId) });
type Body = { number: string; episode: string | null; scriptDay: string | null; intExt: string | null; location: string | null; synopsis: string | null; shootDate: string | null };
const toBody = (d: Draft): Body => ({ number: d.number.trim(), episode: d.episode.trim() || null, scriptDay: joinScriptDay(d) || null, intExt: d.intExt || null, location: d.location.trim() || null, synopsis: d.synopsis.trim() || null, shootDate: d.shootDate ? localDateISO(d.shootDate) : null });
/** Keys of `next` whose value differs from `prev` — so a PATCH only touches what the user changed. */
function diffBody(next: Body, prev: Body): Partial<Body> {
  const out: Partial<Body> = {};
  (Object.keys(next) as (keyof Body)[]).forEach((k) => { if (next[k] !== prev[k]) (out as Record<string, unknown>)[k] = next[k]; });
  return out;
}

/** Thrown by persistDraft when a brand-new scene was created but a follow-up step failed: `createdId` lets a retry become an update instead of a duplicate POST. */
export class PersistError extends Error {
  createdId?: string;
  constructor(message: string, createdId?: string) { super(message); this.createdId = createdId; }
}

/** Create (id null) or update a scene, then reconcile its principals. Updates send only changed fields (and skip the PATCH when nothing changed). A new scene is filed under `revision` (the draft being viewed) when given. */
export async function persistDraft(projectId: string, id: string | null, d: Draft, original?: Scene, revision?: string) {
  let sceneId = id;
  let created = false;
  if (!sceneId) {
    sceneId = (await api<Scene>(p(projectId, "/scenes"), { body: { ...toBody(d), status: "PLANNED", timeOfDay: null, revision: revision || null } })).id;
    created = true;
  } else {
    const body = original ? diffBody(toBody(d), toBody(toDraft(original))) : toBody(d);
    if (Object.keys(body).length) await api(p(projectId, `/scenes/${sceneId}`), { method: "PATCH", body });
  }
  const originalIds = original?.characters.map((c) => c.characterId) || [];
  try {
    for (const cid of d.principals.filter((x) => !originalIds.includes(x))) await api(p(projectId, `/scenes/${sceneId}/characters/${cid}`), { method: "PUT", body: {} });
    for (const cid of originalIds.filter((x) => !d.principals.includes(x))) await api(p(projectId, `/scenes/${sceneId}/characters/${cid}`), { method: "DELETE" });
  } catch (e) {
    throw new PersistError((e as Error).message || "Could not update principals", created ? sceneId : undefined);
  }
  return sceneId;
}

export type SaveStep = { key: string; tempNumber?: string };
/**
 * Order Save all so renumbering never trips the unique (projectId, number) constraint: a row whose new number is still held
 * by another edited row is saved after that row. A cycle (swap 5 <-> 6) is broken by first moving one row to a temporary number.
 */
export function planSaveOrder(keys: string[], drafts: Record<string, Draft>, sceneById: Map<string, Scene>): SaveStep[] {
  const pending = new Set(keys);
  const holder = new Map<string, string>(); // current DB number -> draft key
  keys.forEach((k) => { const s = sceneById.get(k); if (s) holder.set(s.number, k); });
  const blockedBy = (k: string) => { const h = holder.get(drafts[k].number.trim()); return h && h !== k && pending.has(h) ? h : undefined; };
  const steps: SaveStep[] = [];
  while (pending.size) {
    const ready = [...pending].filter((k) => !blockedBy(k));
    if (ready.length) { ready.forEach((k) => { pending.delete(k); holder.delete(sceneById.get(k)?.number ?? ""); steps.push({ key: k }); }); continue; }
    // Every pending row waits on another pending row: free one number with a temporary value, then keep going.
    const k = [...pending][0];
    const current = sceneById.get(k)!.number;
    holder.delete(current);
    steps.push({ key: k, tempNumber: `${current}~tmp${k.slice(0, 6)}` });
  }
  return steps;
}

/* ---------- Display helpers ---------- */
export const scriptLoc = (s: Scene) => [s.intExt ? `${s.intExt}.` : "", (s.location || "").toUpperCase()].filter(Boolean).join(" ");
export const truncate = (s: string | null | undefined, n = 60) => (!s ? "" : s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** Cast numbers joined by ", " (initials when a character has no number) + a tooltip with names. Falls back to the characters query for older list payloads without castNumber. */
export function principalsOf(chars: Pick<SceneCharacter, "characterId" | "character">[], byId: Map<string, Character>) {
  const sorted = sortByCast(chars.map((c) => ({ name: c.character.name, castNumber: c.character.castNumber ?? byId.get(c.characterId)?.castNumber ?? null })));
  return { text: sorted.map((c) => (c.castNumber != null ? String(c.castNumber) : initials(c.name))).join(", "), title: sorted.map(castLabel).join("\n") };
}
export const principalsText = (ids: string[], byId: Map<string, Character>) => principalsOf(ids.map((id) => byId.get(id)).filter((c): c is Character => !!c).map((c) => ({ characterId: c.id, character: c })), byId);

/** The characters in a scene by name, in cast order. */
export function characterNames(chars: Pick<SceneCharacter, "characterId" | "character">[], byId: Map<string, Character>) {
  const sorted = sortByCast(chars.map((c) => ({ name: c.character.name, castNumber: c.character.castNumber ?? byId.get(c.characterId)?.castNumber ?? null })));
  return { text: sorted.map((c) => c.name).join(", "), title: sorted.map(castLabel).join("\n") };
}
export const characterNamesOf = (ids: string[], byId: Map<string, Character>) => characterNames(ids.map((id) => byId.get(id)).filter((c): c is Character => !!c).map((c) => ({ characterId: c.id, character: c })), byId);

/** The actors playing them, in the same order. A character with nobody cast yet is left out. */
export function castMembers(chars: Pick<SceneCharacter, "characterId" | "character">[], byId: Map<string, Character>) {
  const sorted = sortByCast(chars.map((c) => {
    const full = byId.get(c.characterId);
    return { name: c.character.name, castNumber: c.character.castNumber ?? full?.castNumber ?? null, actor: full?.actor?.name || null };
  }));
  const cast = sorted.filter((c) => c.actor);
  return { text: cast.map((c) => c.actor).join(", "), title: cast.map((c) => `${c.actor} · ${c.name}`).join("\n"), missing: sorted.length - cast.length };
}
export const castMembersOf = (ids: string[], byId: Map<string, Character>) => castMembers(ids.map((id) => byId.get(id)).filter((c): c is Character => !!c).map((c) => ({ characterId: c.id, character: c })), byId);

/* ---------- Inline edit row (add + edit share it) ---------- */
export function EditRow({ d, onChange, meta, isNew, onSave, onCancel, busy, onPrincipals, principals, cast, error, episodes }: { d: Draft; onChange: (d: Draft) => void; meta: Meta | null; isNew?: boolean; onSave?: () => void; onCancel?: () => void; busy?: boolean; onPrincipals: () => void; principals: { text: string; title: string }; cast?: { text: string; title: string }; error?: string; episodes?: boolean }) {
  const set = (patch: Partial<Draft>) => onChange({ ...d, ...patch });
  const canSave = !!d.number.trim() && !error && !busy;
  // Enter saves / Escape cancels only from a text or date input: a focused button (Cancel, Add/Remove) must not also trigger Save.
  const onKey = (e: React.KeyboardEvent) => {
    if (!(e.target instanceof HTMLInputElement)) return;
    if (e.key === "Enter" && onSave && canSave) { e.preventDefault(); onSave(); }
    else if (e.key === "Escape" && onCancel && !busy) { e.preventDefault(); onCancel(); }
  };
  // Always keep the row's current INT/EXT value selectable, even if it is not in the configured list (older / imported data).
  const intExtOptions = Array.from(new Set([...(meta?.intExt || INT_EXT_FALLBACK), ...(d.intExt ? [d.intExt] : [])]));
  // Inputs are disabled while the row is saving so keystrokes cannot land in a draft that is about to be replaced by the server row.
  return (
    <tr style={{ background: "var(--surface-2)" }} onKeyDown={onKey} aria-busy={busy || undefined}>
      <td />
      {episodes && <td><Input value={d.episode} onChange={(e) => set({ episode: e.target.value })} placeholder="Ep" disabled={busy} style={{ minWidth: 64, maxWidth: 84 }} /></td>}
      <td>
        <Input value={d.number} onChange={(e) => set({ number: e.target.value })} placeholder="Scene #" autoFocus={isNew} disabled={busy} aria-invalid={!!error} title={error} style={{ minWidth: 84, maxWidth: 110, borderColor: error ? "var(--danger)" : undefined }} />
        {error && <div className="tiny" style={{ color: "var(--danger)", marginTop: 2 }}>{error}</div>}
      </td>
      <td>
        <div className="row gap-1" style={{ minWidth: 168 }}>
          <Select value={d.dayPrefix} onChange={(e) => set({ dayPrefix: e.target.value })} options={DAY_PREFIXES} placeholder="—" humanizeLabels={false} disabled={busy} style={{ width: 96 }} />
          <Input value={d.dayN} onChange={(e) => set({ dayN: e.target.value })} placeholder="3" inputMode="numeric" pattern="[0-9A-Za-z]*" disabled={busy} style={{ width: 66 }} />
        </div>
      </td>
      <td>
        <div className="row gap-1" style={{ minWidth: 250 }}>
          <Select value={d.intExt} onChange={(e) => set({ intExt: e.target.value })} options={intExtOptions} placeholder="—" humanizeLabels={false} disabled={busy} style={{ width: 104 }} />
          <Input list={LOCATION_LIST_ID} value={d.location} onChange={(e) => set({ location: e.target.value })} placeholder="Location" disabled={busy} style={{ minWidth: 140 }} />
        </div>
      </td>
      <td><Input value={d.synopsis} onChange={(e) => set({ synopsis: e.target.value })} placeholder="Scene description" disabled={busy} style={{ minWidth: 220 }} /></td>
      <td>
        <div className="row gap-1 wrap" style={{ minWidth: 190 }}>
          {principals.text ? <span className="small" title={principals.title}>{principals.text}</span> : <span className="subtle">None</span>}
          <button type="button" className="btn btn-sm" disabled={busy} onClick={onPrincipals}>Add/Remove</button>
        </div>
      </td>
      <td className="small subtle" title={cast?.title}>{cast?.text || "—"}</td>
      <td><Input type="date" value={d.shootDate} onChange={(e) => set({ shootDate: e.target.value })} disabled={busy} style={{ minWidth: 150 }} /></td>
      <td className="right nowrap">
        {onSave && <button type="button" className="btn btn-sm" style={{ background: "var(--ok)", color: "#fff", borderColor: "var(--ok)" }} disabled={!canSave} onClick={onSave}>{busy ? "Saving…" : "Save"}</button>}
        {onCancel && <button type="button" className="btn btn-sm btn-ghost" style={{ marginLeft: 4 }} disabled={busy} onClick={onCancel}>Cancel</button>}
      </td>
    </tr>
  );
}
