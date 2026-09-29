import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, MANAGER_ROLES } from "@/state/auth";
import type { Character, CostumeChange, Scene, Vendor } from "@/api/types";
import { ErrorBox, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { NEW_CHARACTER, NewCharacterModal } from "@/components/CharacterQuick";

/**
 * Dropdowns that pick a scene, character, vendor or change, each opening with "+ New …" so a missing one is
 * created on the spot and selected, without leaving the form that needed it. Only managers see the option.
 */
const NEW = "__new__";
type Opt = { value: string; label: string };
type Common = { value: string; onChange: (id: string) => void; placeholder?: string; disabled?: boolean; label?: string; style?: React.CSSProperties };

const sceneLabel = (s: Pick<Scene, "number" | "name">) => `Sc ${s.number}${s.name ? ` · ${s.name}` : ""}`;

export function SceneSelect({ value, onChange, placeholder = "—", disabled, label = "Scene", style, filter }: Common & { filter?: (s: Scene) => boolean }) {
  const { projectId, can } = useProject();
  const [open, setOpen] = useState(false);
  const { data: scenes } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });
  const options: Opt[] = [...(can(MANAGER_ROLES) ? [{ value: NEW, label: "+ New scene" }] : []), ...(scenes || []).filter(filter || (() => true)).map((s) => ({ value: s.id, label: sceneLabel(s) }))];
  return (
    <>
      <Select value={value} onChange={(e) => (e.target.value === NEW ? setOpen(true) : onChange(e.target.value))} options={options} placeholder={placeholder} humanizeLabels={false} disabled={disabled} aria-label={label} style={style} />
      <NewSceneModal open={open} onClose={() => setOpen(false)} onCreated={(s) => onChange(s.id)} />
    </>
  );
}

export function NewSceneModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (s: Scene) => void }) {
  const { projectId } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const blank = { number: "", intExt: "", location: "", timeOfDay: "", synopsis: "" };
  const [f, setF] = useState(blank);
  const create = useMutation({
    mutationFn: () => api<Scene>(p(projectId, "/scenes"), { body: { number: f.number.trim(), intExt: f.intExt || null, location: f.location.trim() || null, timeOfDay: f.timeOfDay || null, synopsis: f.synopsis.trim() || null } }),
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ["scenes", projectId] }); toast.push(`Scene ${s.number} added`, "ok"); onCreated(s); setF(blank); onClose(); },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  return (
    <Modal open={open} onClose={onClose} title="New scene"
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!f.number.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Adding…" : "Add"}</button></>}>
      <div className="form-grid">
        <Field label="Scene #"><Input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} autoFocus /></Field>
        <Field label="INT / EXT"><Select value={f.intExt} onChange={(e) => setF({ ...f, intExt: e.target.value })} options={meta?.intExt || ["INT", "EXT", "INT/EXT"]} placeholder="—" humanizeLabels={false} /></Field>
        <Field label="Location"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="Time of day"><Select value={f.timeOfDay} onChange={(e) => setF({ ...f, timeOfDay: e.target.value })} options={meta?.timesOfDay || []} placeholder="—" /></Field>
        <Field label="Description" span2><Textarea value={f.synopsis} onChange={(e) => setF({ ...f, synopsis: e.target.value })} rows={2} /></Field>
      </div>
      <ErrorBox error={create.error} />
    </Modal>
  );
}

export function CharacterSelect({ value, onChange, placeholder = "—", disabled, label = "Character", style, filter }: Common & { filter?: (c: Character) => boolean }) {
  const { projectId, can } = useProject();
  const [open, setOpen] = useState(false);
  const { data: characters } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")) });
  const options: Opt[] = [...(can(MANAGER_ROLES) ? [{ value: NEW_CHARACTER, label: "+ New character" }] : []), ...(characters || []).filter(filter || (() => true)).map((c) => ({ value: c.id, label: `${c.castNumber != null ? `${c.castNumber}. ` : ""}${c.name}` }))];
  return (
    <>
      <Select value={value} onChange={(e) => (e.target.value === NEW_CHARACTER ? setOpen(true) : onChange(e.target.value))} options={options} placeholder={placeholder} humanizeLabels={false} disabled={disabled} aria-label={label} style={style} />
      <NewCharacterModal open={open} onClose={() => setOpen(false)} onCreated={(c) => onChange(c.id)} />
    </>
  );
}

export function VendorSelect({ value, onChange, placeholder = "—", disabled, label = "Vendor", style }: Common) {
  const { projectId, can } = useProject();
  const [open, setOpen] = useState(false);
  const { data: vendors } = useQuery({ queryKey: ["vendors", projectId], queryFn: () => api<Vendor[]>(p(projectId, "/vendors")) });
  const options: Opt[] = [...(can(MANAGER_ROLES) ? [{ value: NEW, label: "+ New vendor" }] : []), ...(vendors || []).map((v) => ({ value: v.id, label: v.name }))];
  return (
    <>
      <Select value={value} onChange={(e) => (e.target.value === NEW ? setOpen(true) : onChange(e.target.value))} options={options} placeholder={placeholder} humanizeLabels={false} disabled={disabled} aria-label={label} style={style} />
      <NewVendorModal open={open} onClose={() => setOpen(false)} onCreated={(v) => onChange(v.id)} />
    </>
  );
}

export function NewVendorModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (v: Vendor) => void }) {
  const { projectId } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const blank = { name: "", contactName: "", phone: "", email: "" };
  const [f, setF] = useState(blank);
  const create = useMutation({
    mutationFn: () => api<Vendor>(p(projectId, "/vendors"), { body: { name: f.name.trim(), contactName: f.contactName.trim() || null, phone: f.phone.trim() || null, email: f.email.trim() || null } }),
    onSuccess: (v) => { qc.invalidateQueries({ queryKey: ["vendors", projectId] }); toast.push(`${v.name} added`, "ok"); onCreated(v); setF(blank); onClose(); },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  return (
    <Modal open={open} onClose={onClose} title="New vendor"
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!f.name.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Adding…" : "Add"}</button></>}>
      <div className="form-grid">
        <Field label="Name" span2><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Contact"><Input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email" span2><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      </div>
      <ErrorBox error={create.error} />
    </Modal>
  );
}

/** A character's changes (looks), with "+ New change" for that character. `changes` is the list already loaded for them. */
export function ChangeSelect({ value, onChange, characterId, changes, placeholder = "— none —", disabled, label = "Change", style, onCreated }: Common & { characterId: string; changes: Pick<CostumeChange, "id" | "changeNumber" | "name">[]; onCreated?: (c: CostumeChange) => void }) {
  const { projectId, can } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api<CostumeChange>(p(projectId, "/changes"), { body: { characterId, name: name.trim() } }),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ["character", characterId] }); qc.invalidateQueries({ queryKey: ["changes"] }); toast.push(`Change #${c.changeNumber} added`, "ok"); onCreated?.(c); onChange(c.id); setName(""); setOpen(false); },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  const options: Opt[] = [...(can(MANAGER_ROLES) && characterId ? [{ value: NEW, label: "+ New change" }] : []), ...changes.map((c) => ({ value: c.id, label: `#${c.changeNumber} ${c.name}` }))];
  return (
    <>
      <Select value={value} onChange={(e) => (e.target.value === NEW ? setOpen(true) : onChange(e.target.value))} options={options} placeholder={placeholder} humanizeLabels={false} disabled={disabled} aria-label={label} style={style} />
      <Modal open={open} onClose={() => setOpen(false)} title="New change"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Adding…" : "Add"}</button></>}>
        <Field label="Name" help="e.g. Restaurant - white shirt & jeans"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <ErrorBox error={create.error} />
      </Modal>
    </>
  );
}
