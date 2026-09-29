import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth } from "@/state/auth";
import type { Character, Scene, SceneCharacter } from "@/api/types";
import { ErrorBox, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { CharacterSelect, SceneSelect } from "@/components/QuickSelects";
import { ActorSelect } from "@/components/domain";
import { DAY_PREFIXES, INT_EXT_FALLBACK, LOCATION_LIST_ID, castNumberProblem, emptyDraft, persistDraft, toDraft, type Draft } from "@/components/SceneEditRow";

/** Worst costume status in the look the character wears, so a breakdown row reads like the scene readiness dot. */
export function readinessOf(sc: SceneCharacter) {
  if (!sc.change) return "NOT_ASSIGNED";
  const statuses = (sc.change.items || []).map((i) => i.costume.status);
  return ["MISSING", "DAMAGED", "ALTERATION", "CLEANING"].find((s) => statuses.includes(s)) || "READY";
}

/** The row being edited (scene and character fixed), or null to add a character to a scene. */
export type BreakdownTarget = { sceneId: string; characterId: string; changeId: string } | null;

/**
 * Add a character to a scene (the script reader misses people), or edit a breakdown row: every scene column the table
 * shows, plus the character's cast number and cast name. Cast belongs to the character, so it follows them into every scene.
 * The look worn is not set here, and saving leaves whatever change is already assigned untouched.
 */
export function BreakdownRowModal({ open, target, onClose, scenes, characters, episodes }: { open: boolean; target: BreakdownTarget; onClose: () => void; scenes: Scene[]; characters: Character[]; episodes: boolean }) {
  const { projectId } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const locked = !!target;
  const charById = useMemo(() => new Map(characters.map((ch) => [ch.id, ch])), [characters]);
  const sceneById = useMemo(() => new Map(scenes.map((s) => [s.id, s])), [scenes]);
  const castOf = (id: string) => { const ch = charById.get(id); return { castNumber: ch?.castNumber != null ? String(ch.castNumber) : "", actorId: ch?.actor?.id || "" }; };
  const [af, setAf] = useState({ sceneId: "", characterId: "", castNumber: "", actorId: "" });
  const [d, setD] = useState<Draft>(emptyDraft());
  useEffect(() => {
    if (!open) return;
    setAf({ sceneId: target?.sceneId || "", characterId: target?.characterId || "", ...castOf(target?.characterId || "") });
    const scene = target ? sceneById.get(target.sceneId) : undefined;
    setD(scene ? toDraft(scene) : emptyDraft());
    putRow.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  const scene = sceneById.get(af.sceneId);
  const castProblem = castNumberProblem(af.castNumber);
  // Always keep the scene's current INT/EXT selectable, even if it is not in the configured list (older / imported data).
  const intExtOptions = Array.from(new Set([...(meta?.intExt || INT_EXT_FALLBACK), ...(d.intExt ? [d.intExt] : [])]));

  const putRow = useMutation({
    mutationFn: async () => {
      if (castProblem) throw new Error(castProblem);
      const was = castOf(af.characterId);
      const cast: Draft["cast"][string] = {};
      if (af.castNumber.trim() !== was.castNumber) cast.castNumber = af.castNumber;
      if (af.actorId !== was.actorId) cast.actorId = af.actorId;
      if (locked && scene) {
        // Scene fields go through the same save as the inline editor: only what changed is sent.
        await persistDraft(projectId, scene.id, { ...d, cast: Object.keys(cast).length ? { [af.characterId]: cast } : {} }, scene);
      } else {
        await api(p(projectId, `/scenes/${af.sceneId}/characters/${af.characterId}`), { method: "PUT", body: {} });
        const body: { castNumber?: number | null; actorId?: string | null } = {};
        if (cast.castNumber !== undefined) body.castNumber = cast.castNumber.trim() === "" ? null : Number(cast.castNumber.trim());
        if (cast.actorId !== undefined) body.actorId = cast.actorId || null;
        if (Object.keys(body).length) await api(p(projectId, `/characters/${af.characterId}`), { method: "PATCH", body });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scenes", projectId] });
      qc.invalidateQueries({ queryKey: ["scene", af.sceneId] });
      qc.invalidateQueries({ queryKey: ["characters", projectId] });
      qc.invalidateQueries({ queryKey: ["actors", projectId] });
      onClose();
      toast.push(locked ? "Row saved" : "Added to the breakdown", "ok");
    },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });

  const character = charById.get(af.characterId);
  return (
    <Modal open={open} onClose={onClose} title={locked ? `Edit ${character?.name || "row"} · Sc ${scene?.number || ""}` : "Add to breakdown"} wide={locked}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!af.sceneId || !af.characterId || !!castProblem || putRow.isPending} onClick={() => putRow.mutate()}>{putRow.isPending ? "Saving…" : locked ? "Save" : "Add"}</button></>}>
      <div className="col">
        {locked ? (<>
          <div className="grid grid-2">
            {episodes && <Field label="Episode"><Input value={d.episode} onChange={(e) => set({ episode: e.target.value })} /></Field>}
            {/* A row edits the scene it sits in, never which scene that is: the number is shown, not changed, here. */}
            <Field label="Scene #"><Input value={d.number} readOnly disabled aria-readonly title="The scene number can't be changed from a breakdown row" /></Field>
            {/* Day/Night and its number each carry a label, so a filled-in number still says what it is. */}
            <div className="row gap-1" style={{ alignItems: "flex-start" }}>
              <div style={{ width: 110, flexShrink: 0 }}>
                <Field label="Script day"><Select value={d.dayPrefix} onChange={(e) => set({ dayPrefix: e.target.value })} options={DAY_PREFIXES} placeholder="—" humanizeLabels={false} /></Field>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Field label="Day number"><Input value={d.dayN} onChange={(e) => set({ dayN: e.target.value })} inputMode="numeric" aria-label="Script day number" /></Field>
              </div>
            </div>
            <Field label="Script location">
              <div className="row gap-1">
                <Select value={d.intExt} onChange={(e) => set({ intExt: e.target.value })} options={intExtOptions} placeholder="—" humanizeLabels={false} style={{ width: 110 }} />
                <Input list={LOCATION_LIST_ID} value={d.location} onChange={(e) => set({ location: e.target.value })} style={{ flex: 1 }} />
              </div>
            </Field>
            <Field label="Shoot date"><Input type="date" value={d.shootDate} onChange={(e) => set({ shootDate: e.target.value })} /></Field>
          </div>
          <Field label="Scene description"><Textarea value={d.synopsis} onChange={(e) => set({ synopsis: e.target.value })} rows={3} /></Field>
          {/* The row is this character in this scene: tapping the name opens their page for the scene, not a picker. */}
          <Field label="Character" help="Opens the character's page for this scene">
            <Link to={`/p/${projectId}/characters/${af.characterId}/scenes/${af.sceneId}`} className="btn btn-block" style={{ justifyContent: "space-between" }}>
              <span>{character ? (character.castNumber != null ? `${character.castNumber}. ${character.name}` : character.name) : "—"}</span>
              <ChevronRight size={16} />
            </Link>
          </Field>
        </>) : (<>
          <Field label="Scene" help="The scene the script reader left this character out of">
            <SceneSelect value={af.sceneId} onChange={(sceneId) => setAf({ ...af, sceneId })} placeholder="Select a scene" />
          </Field>
          <Field label="Character">
            <CharacterSelect value={af.characterId} onChange={(characterId) => setAf({ ...af, characterId, ...castOf(characterId) })} placeholder="Select a character" />
          </Field>
        </>)}
        {af.characterId && (
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            <div style={{ width: 140 }}>
              {/* Not type="number": that hands back "" for anything it cannot parse, which would read as "clear the number". */}
              <Field label="Cast number" help={castProblem || undefined}><Input value={af.castNumber} onChange={(e) => setAf({ ...af, castNumber: e.target.value })} inputMode="numeric" className="mono" /></Field>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Field label="Cast name" help="Both follow the character into every scene">
                <ActorSelect value={af.actorId} onChange={(actorId) => setAf({ ...af, actorId })} placeholder="No actor assigned" label="Cast name" quick />
              </Field>
            </div>
          </div>
        )}
      </div>
      <ErrorBox error={putRow.error} />
    </Modal>
  );
}
