import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import type { Character, CostumeChange, Scene, SceneCharacter } from "@/api/types";
import { ErrorBox, Field, Input, Modal, Select, useToast } from "@/components/ui";
import { ActorSelect } from "@/components/domain";

/** Worst costume status in the look the character wears, so a breakdown row reads like the scene readiness dot. */
export function readinessOf(sc: SceneCharacter) {
  if (!sc.change) return "NOT_ASSIGNED";
  const statuses = (sc.change.items || []).map((i) => i.costume.status);
  return ["MISSING", "DAMAGED", "ALTERATION", "CLEANING"].find((s) => statuses.includes(s)) || "READY";
}

/** The row being edited (scene and character fixed, only the change / cast move), or null to add a character to a scene. */
export type BreakdownTarget = { sceneId: string; characterId: string; changeId: string } | null;

/**
 * Add a character to a scene (the script reader misses people), or change the look one wears in it.
 * Cast number and cast name belong to the character, so they can be set here without a trip to Characters.
 */
export function BreakdownRowModal({ open, target, onClose, scenes, characters, episodes }: { open: boolean; target: BreakdownTarget; onClose: () => void; scenes: Scene[]; characters: Character[]; episodes: boolean }) {
  const { projectId } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const locked = !!target;
  const charById = useMemo(() => new Map(characters.map((ch) => [ch.id, ch])), [characters]);
  const castOf = (id: string) => { const ch = charById.get(id); return { castNumber: ch?.castNumber != null ? String(ch.castNumber) : "", actorId: ch?.actor?.id || "" }; };
  const [af, setAf] = useState({ sceneId: "", characterId: "", changeId: "", castNumber: "", actorId: "" });
  useEffect(() => {
    if (!open) return;
    setAf({ sceneId: target?.sceneId || "", characterId: target?.characterId || "", changeId: target?.changeId || "", ...castOf(target?.characterId || "") });
    putRow.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);
  const { data: afChanges } = useQuery({ queryKey: ["changes", projectId, af.characterId], queryFn: () => api<CostumeChange[]>(p(projectId, `/changes?characterId=${af.characterId}`)), enabled: open && !!af.characterId });
  const putRow = useMutation({
    mutationFn: async () => {
      const raw = af.castNumber.trim();
      const castNumber = raw === "" ? null : Number(raw);
      if (castNumber != null && (!Number.isInteger(castNumber) || castNumber < 0)) throw new Error("A cast number is a whole number");
      const was = castOf(af.characterId);
      const body: { castNumber?: number | null; actorId?: string | null } = {};
      if (raw !== was.castNumber) body.castNumber = castNumber;
      if (af.actorId !== was.actorId) body.actorId = af.actorId || null;
      if (Object.keys(body).length) await api(p(projectId, `/characters/${af.characterId}`), { method: "PATCH", body });
      await api(p(projectId, `/scenes/${af.sceneId}/characters/${af.characterId}`), { method: "PUT", body: { changeId: af.changeId || null } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["scenes", projectId] }); qc.invalidateQueries({ queryKey: ["characters", projectId] }); qc.invalidateQueries({ queryKey: ["actors", projectId] }); onClose(); toast.push(locked ? "Change updated" : "Added to the breakdown", "ok"); },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });

  return (
    <Modal open={open} onClose={onClose} title={locked ? "Change worn in this scene" : "Add to breakdown"}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!af.sceneId || !af.characterId || putRow.isPending} onClick={() => putRow.mutate()}>{locked ? "Save" : "Add"}</button></>}>
      <div className="col">
        <Field label="Scene" help={locked ? undefined : "The scene the script reader left this character out of"}>
          <Select value={af.sceneId} onChange={(e) => setAf({ ...af, sceneId: e.target.value })} disabled={locked}
            options={scenes.map((sc) => ({ value: sc.id, label: [episodes && sc.episode ? `Ep ${sc.episode}` : null, `Sc ${sc.number}`, sc.name || sc.location].filter(Boolean).join(" · ") }))} placeholder="Select a scene" humanizeLabels={false} />
        </Field>
        <Field label="Character">
          <Select value={af.characterId} onChange={(e) => setAf({ ...af, characterId: e.target.value, changeId: "", ...castOf(e.target.value) })} disabled={locked}
            options={characters.map((c) => ({ value: c.id, label: c.castNumber != null ? `${c.castNumber}. ${c.name}` : c.name }))} placeholder="Select a character" humanizeLabels={false} />
        </Field>
        {af.characterId && (
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            <div style={{ width: 140 }}>
              <Field label="Cast number"><Input type="number" min={0} value={af.castNumber} onChange={(e) => setAf({ ...af, castNumber: e.target.value })} placeholder="—" /></Field>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Field label="Cast name" help="Both follow the character into every scene">
                <ActorSelect value={af.actorId} onChange={(actorId) => setAf({ ...af, actorId })} placeholder="No actor assigned" label="Cast name" />
              </Field>
            </div>
          </div>
        )}
        <Field label="Change" help="Optional — leave it unassigned and the row shows as not ready">
          <Select value={af.changeId} onChange={(e) => setAf({ ...af, changeId: e.target.value })} disabled={!af.characterId}
            options={(afChanges || []).map((c) => ({ value: c.id, label: `#${c.changeNumber} ${c.name}` }))} placeholder="No change assigned" humanizeLabels={false} />
        </Field>
      </div>
      <ErrorBox error={putRow.error} />
    </Modal>
  );
}
