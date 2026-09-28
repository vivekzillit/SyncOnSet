import { api, p } from "@/api/client";
import { dateKey } from "@/lib/format";
import type { Character, Meta, Scene, SceneCharacter } from "@/api/types";
import { Input, Select, initials } from "@/components/ui";
import { ActorSelect } from "@/components/domain";
import { castLabel, sortByCast } from "@/components/PrincipalsModal";

/* ---------- Inline row drafts ---------- */
/** `cast` holds only what the user typed into the cast columns: a cast number and the actor playing them, per character. */
export interface CastEdit { castNumber?: string; actorId?: string }
export interface Draft { number: string; episode: string; dayPrefix: string; dayN: string; intExt: string; location: string; synopsis: string; shootDate: string; principals: string[]; cast: Record<string, CastEdit> }
export const NEW = "new";
export const LOCATION_LIST_ID = "scene-locations";
export const DAY_PREFIXES = ["Day", "Night"];
export const INT_EXT_FALLBACK = ["INT", "EXT", "INT/EXT"];

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

export const emptyDraft = (): Draft => ({ number: "", episode: "", dayPrefix: "Day", dayN: "", intExt: "INT", location: "", synopsis: "", shootDate: "", principals: [], cast: {} });
export const toDraft = (s: Scene): Draft => ({ number: s.number, episode: s.episode || "", ...parseScriptDay(s.scriptDay), intExt: s.intExt || "", location: s.location || "", synopsis: s.synopsis || "", shootDate: dateKey(s.shootDate), principals: s.characters.map((c) => c.characterId), cast: {} });
type Body = { number: string; episode: string | null; scriptDay: string | null; intExt: string | null; location: string | null; name: string | null; synopsis: string | null; shootDate: string | null };
/** The parser names a scene "Location - Time", so an edited slugline renames it the same way rather than keeping the writer's. */
const sceneName = (d: Draft, original?: Scene) => {
  const loc = d.location.trim();
  if (!loc) return original?.name?.trim() || null;
  const time = original?.timeOfDay ? original.timeOfDay.charAt(0) + original.timeOfDay.slice(1).toLowerCase() : null;
  return [loc, time].filter(Boolean).join(" - ");
};
const toBody = (d: Draft, original?: Scene): Body => ({ number: d.number.trim(), episode: d.episode.trim() || null, scriptDay: joinScriptDay(d) || null, intExt: d.intExt || null, location: d.location.trim() || null, name: sceneName(d, original), synopsis: d.synopsis.trim() || null, shootDate: d.shootDate ? localDateISO(d.shootDate) : null });
/** Keys of `next` whose value differs from `prev` — so a PATCH only touches what the user changed. */
function diffBody(next: Body, prev: Body): Partial<Body> {
  const out: Partial<Body> = {};
  (Object.keys(next) as (keyof Body)[]).forEach((k) => { if (next[k] !== prev[k]) (out as Record<string, unknown>)[k] = next[k]; });
  return out;
}

/** SQLite's integer column, so anything larger is rejected before it reaches Prisma. */
const CAST_NUMBER_MAX = 2147483647;
/** Why a typed cast number cannot be saved, or null when it is fine (blank clears the number). */
export function castNumberProblem(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return "A cast number is a whole number";
  if (Number(t) > CAST_NUMBER_MAX) return "That cast number is too big";
  return null;
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
    const body = original ? diffBody(toBody(d, original), toBody(toDraft(original), original)) : toBody(d);
    if (Object.keys(body).length) await api(p(projectId, `/scenes/${sceneId}`), { method: "PATCH", body });
  }
  const originalIds = original?.characters.map((c) => c.characterId) || [];
  try {
    for (const cid of d.principals.filter((x) => !originalIds.includes(x))) await api(p(projectId, `/scenes/${sceneId}/characters/${cid}`), { method: "PUT", body: {} });
    for (const cid of originalIds.filter((x) => !d.principals.includes(x))) await api(p(projectId, `/scenes/${sceneId}/characters/${cid}`), { method: "DELETE" });
  } catch (e) {
    throw new PersistError((e as Error).message || "Could not update principals", created ? sceneId : undefined);
  }
  // A cast number and the actor playing a part belong to the character, not the scene, so they are saved
  // against the character — only for the people still in the scene, and only where the user typed something.
  try {
    for (const [characterId, edit] of Object.entries(d.cast)) {
      if (!d.principals.includes(characterId)) continue;
      const body: { castNumber?: number | null; actorId?: string | null } = {};
      if (edit.castNumber !== undefined) {
        const raw = edit.castNumber.trim();
        const problem = castNumberProblem(raw);
        if (problem) throw new Error(problem);
        body.castNumber = raw === "" ? null : Number(raw);
      }
      if (edit.actorId !== undefined) body.actorId = edit.actorId || null;
      if (Object.keys(body).length) await api(p(projectId, `/characters/${characterId}`), { method: "PATCH", body });
    }
  } catch (e) {
    throw new PersistError((e as Error).message || "Could not save the cast", created ? sceneId : undefined);
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

/** Their cast numbers, in the same order. A character without one is left out. */
export function castNumbers(chars: Pick<SceneCharacter, "characterId" | "character">[], byId: Map<string, Character>) {
  const sorted = sortByCast(chars.map((c) => ({ name: c.character.name, castNumber: c.character.castNumber ?? byId.get(c.characterId)?.castNumber ?? null })));
  const numbered = sorted.filter((c) => c.castNumber != null);
  return { text: numbered.map((c) => c.castNumber).join(", "), title: numbered.map(castLabel).join("\n"), missing: sorted.length - numbered.length };
}

/** The change each one wears, in the same order ("#13, #8"). A character with no change yet is left out. */
export function changesOf(chars: Pick<SceneCharacter, "characterId" | "character" | "change">[], byId: Map<string, Character>) {
  const sorted = sortByCast(chars.map((c) => ({ name: c.character.name, castNumber: c.character.castNumber ?? byId.get(c.characterId)?.castNumber ?? null, change: c.change })));
  const worn = sorted.filter((c) => c.change);
  return { text: worn.map((c) => `#${c.change!.changeNumber}`).join(", "), title: worn.map((c) => `${c.name} · #${c.change!.changeNumber} ${c.change!.name}`).join("\n") };
}

/** The actors playing them, in the same order. A character with nobody cast yet is left out. */
export function castMembers(chars: Pick<SceneCharacter, "characterId" | "character">[], byId: Map<string, Character>) {
  const sorted = sortByCast(chars.map((c) => {
    const full = byId.get(c.characterId);
    return { name: c.character.name, castNumber: c.character.castNumber ?? full?.castNumber ?? null, actor: full?.actor?.name || null };
  }));
  const cast = sorted.filter((c) => c.actor);
  return { text: cast.map((c) => c.actor).join(", "), title: cast.map((c) => `${c.actor} · ${c.name}`).join("\n"), missing: sorted.length - cast.length };
}

/* ---------- Inline edit row (add + edit share it) ---------- */
/**
 * `split` is the breakdown (expanded) view: one row per character, as the list reads when not editing. The scene's
 * own fields span those rows once, and each row carries that character's cast number, actor and change.
 */
export function EditRow({ d, onChange, meta, isNew, onSave, onCancel, busy, onPrincipals, principals, people = [], error, episodes, changes, split, changeOf }: { d: Draft; onChange: (d: Draft) => void; meta: Meta | null; isNew?: boolean; onSave?: () => void; onCancel?: () => void; busy?: boolean; onPrincipals: () => void; principals: { text: string; title: string }; people?: Character[]; error?: string; episodes?: boolean; changes?: { text: string; title: string }; split?: boolean; changeOf?: (characterId: string) => string }) {
  const set = (patch: Partial<Draft>) => onChange({ ...d, ...patch });
  const castNumberOf = (c: Character) => d.cast[c.id]?.castNumber ?? (c.castNumber != null ? String(c.castNumber) : "");
  const actorOf = (c: Character) => d.cast[c.id]?.actorId ?? c.actorId ?? "";
  /**
   * Cast edits are per character, so each one is merged into the draft's map rather than replacing it —
   * and a value typed back to what the character already has stops being an edit, so the row does not
   * stay dirty and no pointless write is sent.
   */
  const setCast = (c: Character, patch: CastEdit) => {
    const next: CastEdit = { ...d.cast[c.id], ...patch };
    if (next.castNumber !== undefined && next.castNumber.trim() === (c.castNumber != null ? String(c.castNumber) : "")) delete next.castNumber;
    if (next.actorId !== undefined && (next.actorId || "") === (c.actorId || "")) delete next.actorId;
    const cast = { ...d.cast };
    if (Object.keys(next).length) cast[c.id] = next; else delete cast[c.id];
    set({ cast });
  };
  const castProblem = people.map((c) => castNumberProblem(castNumberOf(c))).find(Boolean) || undefined;
  const canSave = !!d.number.trim() && !error && !castProblem && !busy;
  // Enter saves / Escape cancels only from a text or date input: a focused button (Cancel, Add/Remove) must not also trigger Save.
  const onKey = (e: React.KeyboardEvent) => {
    if (!(e.target instanceof HTMLInputElement)) return;
    // The new-actor dialog opens inside this row, so its typing must not reach the row's Save / Cancel.
    if (e.target.closest(".modal-bg")) return;
    if (e.key === "Enter" && onSave && canSave) { e.preventDefault(); onSave(); }
    else if (e.key === "Escape" && onCancel && !busy) { e.preventDefault(); onCancel(); }
  };
  // Always keep the row's current INT/EXT value selectable, even if it is not in the configured list (older / imported data).
  const intExtOptions = Array.from(new Set([...(meta?.intExt || INT_EXT_FALLBACK), ...(d.intExt ? [d.intExt] : [])]));
  // Inputs are disabled while the row is saving so keystrokes cannot land in a draft that is about to be replaced by the server row.
  const rowStyle = { background: "var(--surface-2)" };
  const castInput = (c: Character) => {
    const problem = castNumberProblem(castNumberOf(c));
    // Deliberately not type="number": that hands back an empty string for anything it cannot parse,
    // which would read as "clear this cast number", and a stray scroll wheel would retype it.
    return <Input value={castNumberOf(c)} onChange={(e) => setCast(c, { castNumber: e.target.value })} disabled={busy} inputMode="numeric" pattern="[0-9]*" className="mono" placeholder="#" aria-label={`Cast number for ${c.name}`} aria-invalid={!!problem} title={problem || undefined} style={{ width: 72, borderColor: problem ? "var(--danger)" : undefined }} />;
  };
  const actorInput = (c: Character) => <ActorSelect value={actorOf(c)} onChange={(actorId) => setCast(c, { actorId })} disabled={busy} label={`Actor for ${c.name}`} quick />;
  const castProblemNote = castProblem && <div className="tiny" style={{ color: "var(--danger)", marginTop: 2 }}>{castProblem}</div>;
  const addRemove = <button type="button" className="btn btn-sm" disabled={busy} onClick={onPrincipals}>Add/Remove</button>;

  // The scene's own fields; in the split view they span every character row of the scene.
  const span = split && people.length > 1 ? people.length : undefined;
  // Spanned cells sit at the top of their group, level with the first character, rather than floating mid-way.
  const top = span ? { verticalAlign: "top" as const } : undefined;
  const sceneCells = (
    <>
      <td rowSpan={span} style={top} />
      {episodes && <td rowSpan={span} style={top}><Input value={d.episode} onChange={(e) => set({ episode: e.target.value })} placeholder="Ep" disabled={busy} style={{ minWidth: 64, maxWidth: 84 }} /></td>}
      <td rowSpan={span} style={top}>
        {/* A scene keeps its number: it is what the script, schedule and call sheets match on. Only a new scene takes one here. */}
        {isNew
          ? <Input value={d.number} onChange={(e) => set({ number: e.target.value })} placeholder="Scene #" autoFocus disabled={busy} aria-invalid={!!error} title={error} style={{ minWidth: 84, maxWidth: 110, borderColor: error ? "var(--danger)" : undefined }} />
          : <span className="bold mono" style={{ display: "inline-block", minWidth: 48, padding: "8px 0" }} title="The scene number cannot be changed">{d.number}</span>}
        {error && <div className="tiny" style={{ color: "var(--danger)", marginTop: 2 }}>{error}</div>}
      </td>
      <td rowSpan={span} style={top}>
        <div className="row gap-1" style={{ minWidth: 168 }}>
          <Select value={d.dayPrefix} onChange={(e) => set({ dayPrefix: e.target.value })} options={DAY_PREFIXES} placeholder="—" humanizeLabels={false} disabled={busy} style={{ width: 96 }} />
          <Input value={d.dayN} onChange={(e) => set({ dayN: e.target.value })} placeholder="No." title="Script day number" aria-label="Script day number" inputMode="numeric" pattern="[0-9A-Za-z]*" disabled={busy} style={{ width: 66 }} />
        </div>
      </td>
      <td rowSpan={span} style={top}>
        <div className="row gap-1" style={{ minWidth: 250 }}>
          <Select value={d.intExt} onChange={(e) => set({ intExt: e.target.value })} options={intExtOptions} placeholder="—" humanizeLabels={false} disabled={busy} style={{ width: 104 }} />
          <Input list={LOCATION_LIST_ID} value={d.location} onChange={(e) => set({ location: e.target.value })} placeholder="Location" disabled={busy} style={{ minWidth: 140 }} />
        </div>
      </td>
      <td rowSpan={span} style={top}><Input value={d.synopsis} onChange={(e) => set({ synopsis: e.target.value })} placeholder="Scene description" disabled={busy} style={{ minWidth: 220 }} /></td>
    </>
  );
  const tailCells = (
    <>
      <td rowSpan={span} style={top}><Input type="date" value={d.shootDate} onChange={(e) => set({ shootDate: e.target.value })} disabled={busy} style={{ minWidth: 150 }} /></td>
      <td rowSpan={span} className="right nowrap" style={top}>
        {onSave && <button type="button" className="btn btn-sm" style={{ background: "var(--ok)", color: "#fff", borderColor: "var(--ok)" }} disabled={!canSave} onClick={onSave}>{busy ? "Saving…" : "Save"}</button>}
        {onCancel && <button type="button" className="btn btn-sm btn-ghost" style={{ marginLeft: 4 }} disabled={busy} onClick={onCancel}>Cancel</button>}
      </td>
    </>
  );

  if (split && people.length > 1) {
    return (
      <>
        {people.map((c, i) => (
          <tr key={c.id} style={rowStyle} onKeyDown={onKey} aria-busy={busy || undefined}>
            {i === 0 && sceneCells}
            <td>
              <div className="row gap-1 wrap" style={{ minWidth: 190 }}>
                <span className="small">{c.name}</span>
                {/* Adding or removing people is for the scene as a whole, so it sits on its first row only. */}
                {i === 0 && addRemove}
              </div>
            </td>
            <td title="A cast number belongs to the character — changing it here changes it in every scene they are in">
              {castInput(c)}
              {i === people.length - 1 && castProblemNote}
            </td>
            <td title="Who is cast in the part — the same actor shows on every scene the character is in"><div style={{ minWidth: 180 }}>{actorInput(c)}</div></td>
            <td className="subtle nowrap">{changeOf?.(c.id) || "—"}</td>
            {i === 0 && tailCells}
          </tr>
        ))}
      </>
    );
  }

  return (
    <tr style={rowStyle} onKeyDown={onKey} aria-busy={busy || undefined}>
      {sceneCells}
      <td>
        <div className="row gap-1 wrap" style={{ minWidth: 190 }}>
          {principals.text ? <span className="small" title={principals.title}>{principals.text}</span> : <span className="subtle">None</span>}
          {addRemove}
        </div>
      </td>
      {/* A cast number and the actor belong to the character, so a change here follows them into every scene.
          Both cells stack the same per-person block, so the Nth number always sits beside the Nth actor. */}
      <td title="A cast number belongs to the character — changing it here changes it in every scene they are in">
        {people.length === 0 ? <span className="subtle">—</span> : (
          <div className="col gap-1" style={{ minWidth: 92 }}>
            {people.map((c) => (
              <div key={c.id} className="col" style={{ gap: 1 }}>
                {people.length > 1 && <span className="subtle tiny truncate" style={{ maxWidth: 88 }} title={c.name}>{c.name}</span>}
                {castInput(c)}
              </div>
            ))}
          </div>
        )}
        {castProblemNote}
      </td>
      <td title="Who is cast in the part — the same actor shows on every scene the character is in">
        {people.length === 0 ? <span className="subtle">—</span> : (
          <div className="col gap-1" style={{ minWidth: 180 }}>
            {people.map((c) => (
              <div key={c.id} className="col" style={{ gap: 1 }}>
                {people.length > 1 && <span className="subtle tiny truncate" style={{ maxWidth: 170 }} title={c.name}>{c.name}</span>}
                {actorInput(c)}
              </div>
            ))}
          </div>
        )}
      </td>
      {/* The look each character wears is set per row in the breakdown view, not in the scene editor. */}
      <td className="subtle" title={changes?.title || undefined}>{split && people.length === 1 ? changeOf?.(people[0].id) || "—" : changes?.text || "—"}</td>
      {tailCells}
    </tr>
  );
}
