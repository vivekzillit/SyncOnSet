import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, MANAGER_ROLES } from "@/state/auth";
import type { Actor, Character, Costume, Photo } from "@/api/types";
import { ErrorBox, Field, Input, Modal, Select, Spinner, useToast } from "@/components/ui";
import { ActorSelect, CostumePicker, CostumeRow, PhotoGrid } from "@/components/domain";
import { ActorModal, type ActorRow } from "@/components/ActorModal";

/** The option that stands for "this person is not on the list yet" wherever characters are picked. */
export const NEW_CHARACTER = "__new_character__";

/** Just enough to put a missing character on the list: the rest is filled in on their own page. */
export function NewCharacterModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: Character) => void }) {
  const { projectId } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: "", type: "SUPPORTING", castNumber: "" });
  const create = useMutation({
    mutationFn: () => api<Character>(p(projectId, "/characters"), { body: { name: f.name.trim(), type: f.type, castNumber: f.castNumber.trim() ? Number(f.castNumber.trim()) : null } }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["characters", projectId] });
      toast.push(`${c.name} added`, "ok");
      onCreated(c);
      setF({ name: "", type: "SUPPORTING", castNumber: "" });
      onClose();
    },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  const bad = !!f.castNumber.trim() && !/^\d+$/.test(f.castNumber.trim());
  return (
    <Modal open={open} onClose={onClose} title="New character"
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!f.name.trim() || bad || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Adding…" : "Add"}</button></>}>
      <div className="form-grid">
        <Field label="Name" span2><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Inspector Pandey" autoFocus /></Field>
        <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={meta?.characterTypes || []} /></Field>
        <Field label="Cast number" help="As on call sheets and sides"><Input value={f.castNumber} onChange={(e) => setF({ ...f, castNumber: e.target.value })} inputMode="numeric" className="mono" aria-invalid={bad} /></Field>
      </div>
      <ErrorBox error={create.error} />
    </Modal>
  );
}

type Detail = Character & { actor?: Actor | null; costumes: Costume[]; photos: Photo[] };

/**
 * The character's own things — who is cast, their references, the pieces tagged to them — brought into a form
 * that is about them, so nobody has to leave what they are filling in to go and set them on the character page.
 */
export function CharacterQuickPanel({ characterId }: { characterId: string }) {
  const { projectId, can } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const [actorOpen, setActorOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const canEdit = can(MANAGER_ROLES);
  const { data: ch, isLoading } = useQuery({ queryKey: ["character", characterId], queryFn: () => api<Detail>(p(projectId, `/characters/${characterId}`)), enabled: !!characterId });
  // The full actor record (characters, measurements, rep) comes from the actors list the dropdown already loads.
  const { data: actors } = useQuery({ queryKey: ["actors", projectId], queryFn: () => api<ActorRow[]>(p(projectId, "/actors")), enabled: !!characterId });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["character", characterId] }); qc.invalidateQueries({ queryKey: ["characters", projectId] }); };
  const setActor = useMutation({
    mutationFn: (actorId: string | null) => api(p(projectId, `/characters/${characterId}`), { method: "PATCH", body: { actorId } }),
    onSuccess: refresh,
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  const tagPiece = useMutation({
    mutationFn: (costumeId: string) => api(p(projectId, `/costumes/${costumeId}`), { method: "PATCH", body: { characterId } }),
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["costumes", projectId] }); toast.push("Piece tagged to this character", "ok"); },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });

  if (!characterId) return <div className="subtle">Pick a character first.</div>;
  const currentActor = ch?.actor ? (actors || []).find((a) => a.id === ch.actor!.id) || null : null;
  if (isLoading || !ch) return <Spinner />;
  return (
    <div className="col gap-2">
      <Field label="Actor & measurements">
        <div className="row gap-1 wrap">
          <div style={{ minWidth: 200, flex: 1 }}><ActorSelect value={ch.actor?.id || ""} onChange={(id) => setActor.mutate(id || null)} label={`Actor for ${ch.name}`} /></div>
          {/* Nobody cast: add one. Somebody cast: edit them, with their details already filled in. */}
          {canEdit && (ch.actor
            ? <button type="button" className="btn btn-sm" disabled={!currentActor} onClick={() => setEditOpen(true)}><Pencil size={14} /> Edit</button>
            : <button type="button" className="btn btn-sm" onClick={() => setActorOpen(true)}><Plus size={14} /> Add actor</button>)}
        </div>
      </Field>
      <Field label="References">
        <PhotoGrid photos={ch.photos || []} entityType="CHARACTER" entityId={ch.id} kinds={["REFERENCE", "FRONT", "SIDE", "BACK", "DETAIL", "DOCUMENT", "OTHER"]} compact />
      </Field>
      <Field label={`Pieces (${ch.costumes?.length ?? 0})`} help="Tagged to the character, so they follow them into every scene">
        {ch.costumes?.length ? <div className="list card flat pad-0">{ch.costumes.map((c) => <CostumeRow key={c.id} c={c} noStatus />)}</div> : <div className="subtle">No pieces tagged yet.</div>}
        {canEdit && <button type="button" className="btn btn-sm mt-1" onClick={() => setPickOpen(true)}><Plus size={14} /> Add piece</button>}
      </Field>

      <ActorModal open={actorOpen} onClose={() => setActorOpen(false)} onSaved={(a) => setActor.mutate(a.id)} allowAddAnother={false} saveLabel="Create & cast" forCharacter={ch} />
      <ActorModal open={editOpen} onClose={() => setEditOpen(false)} editing={currentActor} onSaved={refresh} />
      <CostumePicker open={pickOpen} onClose={() => setPickOpen(false)} title={`Pick a piece for ${ch.name}`} filter={(c) => c.characterId !== ch.id} onPick={(c) => tagPiece.mutate(c.id)} />
    </div>
  );
}

/** Characters for a picker, with "+ New character" at the top so a missing one can be added where it is needed. */
export function characterOptions(characters: Character[] | undefined) {
  return [
    { value: NEW_CHARACTER, label: "+ New character" },
    ...(characters || []).map((c) => ({ value: c.id, label: `${c.castNumber != null ? `${c.castNumber}. ` : ""}${c.name}${c.actor ? ` (${c.actor.name})` : ""}` })),
  ];
}
