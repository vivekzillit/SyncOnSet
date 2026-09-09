import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, MANAGER_ROLES } from "@/state/auth";
import { humanize, toLocalInput } from "@/lib/format";
import type { Character } from "@/api/types";
import { Plus } from "lucide-react";
import { ErrorBox, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";

export interface ActorRow { id: string; name: string; gender?: string | null; age?: number | null; phone?: string | null; phone2?: string | null; email?: string | null; email2?: string | null; agency?: string | null; startWorkDate?: string | null; nextFittingAt?: string | null; nextFitting?: string | null; nextFittingId?: string | null; fittingComment?: string | null; notes?: string | null; measurements: Record<string, string | number>; characters: { id: string; name: string; castNumber?: number | null }[] }

const MEASURES = ["height", "chest", "bust", "waist", "hips", "inseam", "sleeve", "collar", "shoe", "head"];
const blankCharacter = { name: "", type: "SUPPORTING", age: "", castNumber: "", description: "" };
const blank = { first: "", last: "", gender: "", age: "", characterIds: [] as string[], notes: "", nextFittingAt: "", fittingComment: "", phone: "", phone2: "", email: "", email2: "", startWorkDate: "", agency: "", measurements: {} as Record<string, string> };

export const charLabel = (c: { name: string; castNumber?: number | null }) => `${c.castNumber != null ? `(${c.castNumber}) ` : ""}${c.name}`;

/**
 * The one Create / Edit Actor form, with every field the Actors page collects.
 * Shared so adding an actor from a character's dropdown asks for exactly the same details.
 */
export function ActorModal({ open, onClose, editing, onSaved, allowAddAnother = true, saveLabel }: { open: boolean; onClose: () => void; editing?: ActorRow | null; onSaved?: (actor: ActorRow) => void; allowAddAnother?: boolean; saveLabel?: string }) {
  const { projectId, can } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState(blank);
  const [addAnother, setAddAnother] = useState(false);
  const [charOpen, setCharOpen] = useState(false);
  const [cf, setCf] = useState(blankCharacter);
  const { data: characters } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")), enabled: open });

  const body = () => ({ name: `${f.first.trim()} ${f.last.trim()}`.trim(), gender: f.gender || null, age: f.age ? Number(f.age) : null, characterIds: f.characterIds, notes: f.notes || null, nextFittingAt: f.nextFittingAt || null, fittingComment: f.fittingComment || null, phone: f.phone || null, phone2: f.phone2 || null, email: f.email || null, email2: f.email2 || null, startWorkDate: f.startWorkDate || null, agency: f.agency || null, measurements: Object.fromEntries(Object.entries(f.measurements).filter(([, v]) => v)) });
  const save = useMutation({
    mutationFn: () => (editing ? api<ActorRow>(p(projectId, `/actors/${editing.id}`), { method: "PATCH", body: body() }) : api<ActorRow>(p(projectId, "/actors"), { body: body() })),
    onSuccess: (actor) => {
      qc.invalidateQueries({ queryKey: ["actors", projectId] });
      qc.invalidateQueries({ queryKey: ["characters", projectId] });
      toast.push(editing ? "Actor updated" : "Actor created", "ok");
      onSaved?.(actor);
      if (addAnother && !editing) setF(blank); else onClose();
      setAddAnother(false);
    },
  });

  /** A character added here is ticked straight away: it exists because this actor plays it. */
  const createCharacter = useMutation({
    mutationFn: () => api<Character>(p(projectId, "/characters"), { body: { name: cf.name.trim(), type: cf.type, age: cf.age ? Number(cf.age) : null, castNumber: cf.castNumber ? Number(cf.castNumber) : null, description: cf.description || null } }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["characters", projectId] });
      setF((prev) => ({ ...prev, characterIds: [...prev.characterIds, c.id] }));
      closeCharacter();
      toast.push("Character added", "ok");
    },
  });
  const closeCharacter = () => { setCharOpen(false); setCf(blankCharacter); createCharacter.reset(); };

  // Seed the form each time the dialog opens, so a cancelled draft never leaks into the next one.
  useEffect(() => {
    if (!open) return;
    setAddAnother(false);
    save.reset();
    if (!editing) return setF(blank);
    const [first, ...rest] = editing.name.split(" ");
    setF({ first, last: rest.join(" "), gender: editing.gender || "", age: editing.age != null ? String(editing.age) : "", characterIds: editing.characters.map((c) => c.id), notes: editing.notes || "", nextFittingAt: toLocalInput(editing.nextFittingAt), fittingComment: editing.fittingComment || "", phone: editing.phone || "", phone2: editing.phone2 || "", email: editing.email || "", email2: editing.email2 || "", startWorkDate: editing.startWorkDate ? toLocalInput(editing.startWorkDate).slice(0, 10) : "", agency: editing.agency || "", measurements: Object.fromEntries(Object.entries(editing.measurements || {}).map(([k, v]) => [k, String(v)])) });
  }, [open, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit Actor" : "Create Actor"} wide
      footer={<><button className="btn" onClick={onClose}>Cancel</button>{!editing && allowAddAnother && <button className="btn" disabled={!f.first.trim() || save.isPending} onClick={() => { setAddAnother(true); save.mutate(); }} title="Create and add another">Create +</button>}<button className="btn btn-primary" disabled={!f.first.trim() || save.isPending} onClick={() => { setAddAnother(false); save.mutate(); }}>{editing ? "Save" : saveLabel || "Create"}</button></>}>
      <div className="form-grid">
        <Field label="Name"><div className="row gap-1"><Input value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} placeholder="First Name" autoFocus /><Input value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} placeholder="Last Name" /></div></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Phone" /></Field>
        <Field label="Gender / Age"><div className="row gap-1"><Select value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })} options={meta?.genders || ["FEMALE", "MALE", "NON_BINARY", "OTHER"]} placeholder="Select" /><Input type="number" value={f.age} onChange={(e) => setF({ ...f, age: e.target.value })} placeholder="Age" style={{ width: 90 }} /></div></Field>
        <Field label="Phone 2"><Input value={f.phone2} onChange={(e) => setF({ ...f, phone2: e.target.value })} placeholder="Phone 2" /></Field>
        <Field label="Characters" help="Tick every character this actor plays">
          <div className="card flat pad-0" style={{ maxHeight: 140, overflowY: "auto", padding: 6 }}>
            {(characters || []).length === 0 && <div className="subtle small" style={{ padding: 6 }}>No characters yet.</div>}
            {(characters || []).map((c) => <label key={c.id} className="check" style={{ padding: "3px 4px" }}><input type="checkbox" checked={f.characterIds.includes(c.id)} onChange={(e) => setF({ ...f, characterIds: e.target.checked ? [...f.characterIds, c.id] : f.characterIds.filter((x) => x !== c.id) })} /> {charLabel(c)}{c.actor && c.actor.id !== editing?.id ? <span className="subtle tiny"> · currently {c.actor.name}</span> : null}</label>)}
          </div>
          {can(MANAGER_ROLES) && <button type="button" className="btn btn-sm mt-1" onClick={() => setCharOpen(true)}><Plus size={14} /> Add character</button>}
        </Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Email" /></Field>
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Notes" rows={3} /></Field>
        <Field label="Email 2"><Input type="email" value={f.email2} onChange={(e) => setF({ ...f, email2: e.target.value })} placeholder="Email 2" /></Field>
        <Field label="Next Costume Fitting"><Input type="datetime-local" value={f.nextFittingAt} onChange={(e) => setF({ ...f, nextFittingAt: e.target.value })} /></Field>
        <Field label="Start Work Date"><Input type="date" value={f.startWorkDate} onChange={(e) => setF({ ...f, startWorkDate: e.target.value })} /></Field>
        <Field label="Comment"><Input value={f.fittingComment} onChange={(e) => setF({ ...f, fittingComment: e.target.value })} placeholder="Fitting Comment" /></Field>
        <Field label="Agency"><Input value={f.agency} onChange={(e) => setF({ ...f, agency: e.target.value })} placeholder="Agency" /></Field>
        <div className="span-2 bold small">Measurements</div>
        {MEASURES.map((m) => <Field key={m} label={humanize(m)}><Input value={f.measurements[m] || ""} onChange={(e) => setF({ ...f, measurements: { ...f.measurements, [m]: e.target.value } })} /></Field>)}
      </div>
      <ErrorBox error={save.error} />
      <Modal open={charOpen} onClose={closeCharacter} title="New character" footer={<><button className="btn" onClick={closeCharacter}>Cancel</button><button className="btn btn-primary" disabled={!cf.name.trim() || createCharacter.isPending} onClick={() => createCharacter.mutate()}>Add & tick</button></>}>
        <div className="form-grid">
          <Field label="Name" span2><Input value={cf.name} onChange={(e) => setCf({ ...cf, name: e.target.value })} autoFocus /></Field>
          <Field label="Type"><Select value={cf.type} onChange={(e) => setCf({ ...cf, type: e.target.value })} options={meta?.characterTypes || []} /></Field>
          <Field label="Age"><Input type="number" value={cf.age} onChange={(e) => setCf({ ...cf, age: e.target.value })} /></Field>
          <Field label="Cast number" span2 help="As on call sheets and sides"><Input type="number" value={cf.castNumber} onChange={(e) => setCf({ ...cf, castNumber: e.target.value })} /></Field>
          <Field label="Description" span2><Textarea value={cf.description} onChange={(e) => setCf({ ...cf, description: e.target.value })} placeholder="Look, palette, references…" /></Field>
        </div>
        <ErrorBox error={createCharacter.error} />
      </Modal>
    </Modal>
  );
}
