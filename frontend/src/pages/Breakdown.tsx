import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { MANAGER_ROLES } from "@/state/auth";
import { fmtDate, hasEpisodes, humanize } from "@/lib/format";
import type { Character, CostumeChange, Scene, SceneCharacter } from "@/api/types";
import { Card, Chips, ConfirmButton, Dot, Empty, ErrorBox, Field, Modal, PageHead, SearchBox, Select, Spinner, useToast } from "@/components/ui";
import { scriptLoc } from "@/components/SceneEditRow";
import { sortByCast } from "@/components/PrincipalsModal";

const SHOOT_DATE = { day: "2-digit", month: "short" } as const;

/** One breakdown row: a character as they appear in a single scene. */
type Row = { scene: Scene; sc: SceneCharacter; readiness: string };

/** Worst costume status in the look the character wears, so a row reads like the Scenes readiness dot. */
function readinessOf(sc: SceneCharacter) {
  if (!sc.change) return "NOT_ASSIGNED";
  const statuses = (sc.change.items || []).map((i) => i.costume.status);
  return ["MISSING", "DAMAGED", "ALTERATION", "CLEANING"].find((s) => statuses.includes(s)) || "READY";
}

export default function Breakdown() {
  const { projectId, can, project } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const canEdit = can(MANAGER_ROLES);
  const episodes = hasEpisodes(project?.type);
  const [q, setQ] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [ep, setEp] = useState("");
  const [when, setWhen] = useState<"all" | "scheduled">("all");
  const { data: scenes, isLoading } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });

  // Adding a row: the script reader misses people, so a character can be put into a scene from here.
  const [addOpen, setAddOpen] = useState(false);
  const [locked, setLocked] = useState(false); // editing an existing row: scene and character are fixed, only the change moves
  const [af, setAf] = useState({ sceneId: "", characterId: "", changeId: "" });
  const { data: allCharacters } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")) });
  const charById = useMemo(() => new Map((allCharacters || []).map((ch) => [ch.id, ch])), [allCharacters]);
  const { data: afChanges } = useQuery({ queryKey: ["changes", projectId, af.characterId], queryFn: () => api<CostumeChange[]>(p(projectId, `/changes?characterId=${af.characterId}`)), enabled: addOpen && !!af.characterId });
  const putRow = useMutation({
    mutationFn: () => api(p(projectId, `/scenes/${af.sceneId}/characters/${af.characterId}`), { method: "PUT", body: { changeId: af.changeId || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["scenes", projectId] }); setAddOpen(false); toast.push(locked ? "Change updated" : "Added to the breakdown", "ok"); },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  const dropRow = useMutation({
    mutationFn: (v: { sceneId: string; characterId: string }) => api(p(projectId, `/scenes/${v.sceneId}/characters/${v.characterId}`), { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["scenes", projectId] }); toast.push("Removed from the breakdown", "ok"); },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  const openAdd = (row?: Row) => {
    setLocked(!!row);
    setAf({ sceneId: row?.scene.id || "", characterId: row?.sc.characterId || "", changeId: row?.sc.change?.id || "" });
    putRow.reset();
    setAddOpen(true);
  };

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const scene of scenes || []) {
      const cast = sortByCast(scene.characters.map((sc) => ({ ...sc, name: sc.character.name, castNumber: sc.character.castNumber ?? null })));
      for (const sc of cast) out.push({ scene, sc, readiness: readinessOf(sc) });
    }
    return out;
  }, [scenes]);

  const characters = useMemo(() => {
    const byId = new Map<string, { value: string; label: string }>();
    for (const r of rows) if (!byId.has(r.sc.characterId)) byId.set(r.sc.characterId, { value: r.sc.characterId, label: r.sc.character.name });
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const episodeList = useMemo(() => Array.from(new Set((scenes || []).map((s) => (s.episode || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [scenes]);

  const needle = q.trim().toLowerCase();
  const list = rows.filter((r) => {
    if (characterId && r.sc.characterId !== characterId) return false;
    if (ep && (r.scene.episode || "").trim() !== ep) return false;
    if (when === "scheduled" && !r.scene.shootDate) return false;
    if (!needle) return true;
    const full = charById.get(r.sc.characterId);
    return [r.scene.number, r.scene.episode, r.scene.name, r.scene.location, r.scene.scriptDay, r.scene.intExt, r.sc.character.name, full?.actor?.name, String(r.sc.character.castNumber ?? full?.castNumber ?? ""), r.sc.change?.name].some((v) => (v || "").toLowerCase().includes(needle));
  });

  if (isLoading || !scenes) return <Spinner />;
  const label = characterId ? characters.find((c) => c.value === characterId)?.label : null;

  return (
    <div>
      <PageHead title="Breakdown" sub={label ? `${label}, scene by scene — the look worn in each and whether it is ready.` : "Every scene against the characters in it, with the look each one wears."}
        actions={canEdit && <button className="btn btn-primary" onClick={() => openAdd()}><Plus size={16} /> Add to breakdown</button>} />
      <div className="filters">
        <SearchBox value={q} onChange={setQ} placeholder="Scene, location, story day, character, change…" />
        <Select value={characterId} onChange={(e) => setCharacterId(e.target.value)} options={characters} placeholder="All characters" humanizeLabels={false} />
        {episodes && episodeList.length > 0 && <Select value={ep} onChange={(e) => setEp(e.target.value)} options={episodeList.map((n) => ({ value: n, label: `Episode ${n}` }))} placeholder="All episodes" humanizeLabels={false} aria-label="Episode" style={{ width: "auto", minWidth: 150 }} />}
        <Chips options={[{ key: "all", label: "All scenes" }, { key: "scheduled", label: "Scheduled" }]} value={when} onChange={(v) => setWhen((v || "all") as "all" | "scheduled")} />
      </div>
      <Card pad0>
        {list.length === 0 ? (
          <Empty icon="📋" title="Nothing to break down" hint={rows.length ? "No scene matches these filters." : "Upload a script, or press Add to breakdown to put a character into a scene by hand."} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 28 }}><span className="sr-only">Readiness</span></th>{episodes && <th>Ep</th>}<th>Sc</th><th>Script Loc.</th><th>D/N</th><th>Story Day</th><th>Pgs</th><th>Character Name</th><th>Cast number</th><th>Cast Name</th><th>Change</th><th>Shoot Date</th>{canEdit && <th style={{ width: 78 }}><span className="sr-only">Actions</span></th>}</tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.sc.id} style={r.scene.status === "OMITTED" ? { opacity: 0.55 } : undefined}>
                    <td><span title={humanize(r.readiness)} aria-label={humanize(r.readiness)} role="img"><Dot status={r.readiness} pulse={r.readiness === "MISSING"} /></span></td>
                    {episodes && <td className="nowrap">{r.scene.episode || ""}</td>}
                    <td className="nowrap"><Link to={`${base}/scenes/${r.scene.id}`} className="bold" title={r.scene.name || `Scene ${r.scene.number}`}>{r.scene.number}</Link></td>
                    <td className="nowrap">{scriptLoc(r.scene) || r.scene.name || ""}</td>
                    <td className="nowrap">{r.scene.timeOfDay || ""}</td>
                    <td className="nowrap">{r.scene.scriptDay || ""}</td>
                    <td className="nowrap">{r.scene.pages || ""}</td>
                    <td className="nowrap"><Link to={`${base}/characters/${r.sc.characterId}/scenes/${r.scene.id}`}>{r.sc.character.name}</Link></td>
                    <td className="subtle mono nowrap">{r.sc.character.castNumber ?? charById.get(r.sc.characterId)?.castNumber ?? "—"}</td>
                    <td className="subtle nowrap">{charById.get(r.sc.characterId)?.actor?.name || "—"}</td>
                    <td className="nowrap">{r.sc.change ? <Link to={`${base}/changes/${r.sc.change.id}`}>#{r.sc.change.changeNumber} {r.sc.change.name}</Link> : <span className="subtle">No change assigned</span>}</td>
                    <td className="nowrap">{r.scene.shootDate ? fmtDate(r.scene.shootDate, SHOOT_DATE) : ""}</td>
                    {canEdit && (
                      <td className="right nowrap">
                        <button className="btn btn-ghost btn-sm" aria-label={`Edit ${r.sc.character.name} in scene ${r.scene.number}`} onClick={() => openAdd(r)}><Pencil size={14} /></button>
                        <ConfirmButton className="btn btn-ghost btn-sm" confirmText="Remove?" aria-label={`Remove ${r.sc.character.name} from scene ${r.scene.number}`} onConfirm={() => dropRow.mutate({ sceneId: r.scene.id, characterId: r.sc.characterId })}>&times;</ConfirmButton>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={locked ? "Change worn in this scene" : "Add to breakdown"}
        footer={<><button className="btn" onClick={() => setAddOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!af.sceneId || !af.characterId || putRow.isPending} onClick={() => putRow.mutate()}>{locked ? "Save" : "Add"}</button></>}>
        <div className="col">
          <Field label="Scene" help={locked ? undefined : "The scene the script reader left this character out of"}>
            <Select value={af.sceneId} onChange={(e) => setAf({ ...af, sceneId: e.target.value })} disabled={locked}
              options={(scenes || []).map((sc) => ({ value: sc.id, label: [episodes && sc.episode ? `Ep ${sc.episode}` : null, `Sc ${sc.number}`, sc.name || sc.location].filter(Boolean).join(" · ") }))} placeholder="Select a scene" humanizeLabels={false} />
          </Field>
          <Field label="Character">
            <Select value={af.characterId} onChange={(e) => setAf({ ...af, characterId: e.target.value, changeId: "" })} disabled={locked}
              options={(allCharacters || []).map((c) => ({ value: c.id, label: c.castNumber != null ? `${c.castNumber}. ${c.name}` : c.name }))} placeholder="Select a character" humanizeLabels={false} />
          </Field>
          <Field label="Change" help="Optional — leave it unassigned and the row shows as not ready">
            <Select value={af.changeId} onChange={(e) => setAf({ ...af, changeId: e.target.value })} disabled={!af.characterId}
              options={(afChanges || []).map((c) => ({ value: c.id, label: `#${c.changeNumber} ${c.name}` }))} placeholder="No change assigned" humanizeLabels={false} />
          </Field>
        </div>
        <ErrorBox error={putRow.error} />
      </Modal>
    </div>
  );
}
