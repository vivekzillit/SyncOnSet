import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, BookOpen, Sparkles, Check, X } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, MANAGER_ROLES } from "@/state/auth";
import { fmtDateLong, humanize, toLocalInput } from "@/lib/format";
import type { Character, CostumeChange, Readiness, Scene } from "@/api/types";
import { Badge, Card, Dot, Empty, ErrorBox, Field, Input, Modal, PageHead, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { ReadinessLine } from "@/components/domain";
import { CueProgress, useCueExtraction } from "@/components/AiCues";
import { OPS_ROLES } from "@/state/auth";

export default function SceneDetail() {
  const { id = "" } = useParams();
  const { projectId, can } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const { data: scene, isLoading } = useQuery({ queryKey: ["scene", id], queryFn: () => api<Scene>(p(projectId, `/scenes/${id}`)) });
  const { data: readiness } = useQuery({ queryKey: ["readiness", id], queryFn: () => api<Readiness>(p(projectId, `/scenes/${id}/readiness`)), refetchInterval: 30000 });
  const { data: characters } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")) });
  const [addOpen, setAddOpen] = useState(false);
  const [addChar, setAddChar] = useState("");
  const [addChange, setAddChange] = useState("");
  const { data: charChanges } = useQuery({ queryKey: ["changes", projectId, addChar], queryFn: () => api<CostumeChange[]>(p(projectId, `/changes?characterId=${addChar}`)), enabled: !!addChar });
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [showDismissed, setShowDismissed] = useState(false);
  const { progress: cueProgress, run: runCues } = useCueExtraction();
  const setCue = useMutation({
    mutationFn: (v: { id: string; status: string }) => api(p(projectId, `/cues/${v.id}`), { method: "PATCH", body: { status: v.status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scene", id] }),
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  const bulkCues = useMutation({
    mutationFn: (v: { ids: string[]; status: string }) => api(p(projectId, "/cues/bulk"), { body: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["scene", id] }); toast.push("Updated", "ok"); },
  });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["scene", id] }); qc.invalidateQueries({ queryKey: ["readiness", id] }); qc.invalidateQueries({ queryKey: ["scenes", projectId] }); };
  const setChar = useMutation({
    mutationFn: (v: { characterId: string; changeId: string | null }) => api(p(projectId, `/scenes/${id}/characters/${v.characterId}`), { method: "PUT", body: { changeId: v.changeId } }),
    onSuccess: () => { invalidate(); setAddOpen(false); toast.push("Updated", "ok"); },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  const removeChar = useMutation({ mutationFn: (characterId: string) => api(p(projectId, `/scenes/${id}/characters/${characterId}`), { method: "DELETE" }), onSuccess: invalidate });
  const update = useMutation({
    mutationFn: () => api(p(projectId, `/scenes/${id}`), { method: "PATCH", body: { ...form, shootDate: form.shootDate || null, intExt: form.intExt || null, timeOfDay: form.timeOfDay || null } }),
    onSuccess: () => { invalidate(); setEditOpen(false); toast.push("Scene updated", "ok"); },
  });

  if (isLoading || !scene) return <Spinner />;
  const openEdit = () => {
    setForm({ number: scene.number, name: scene.name || "", location: scene.location || "", intExt: scene.intExt || "", timeOfDay: scene.timeOfDay || "", scriptDay: scene.scriptDay || "", pages: scene.pages || "", shootDate: scene.shootDate ? toLocalInput(scene.shootDate).slice(0, 10) : "", status: scene.status, synopsis: scene.synopsis || "" });
    setEditOpen(true);
  };
  const continuityByChar = new Map<string, NonNullable<Scene["continuity"]>>();
  (scene.continuity || []).forEach((r) => continuityByChar.set(r.characterId, [...(continuityByChar.get(r.characterId) || []), r]));

  return (
    <div>
      <PageHead
        crumbs={<><Link to={`${base}/scenes`}>Scenes</Link> / Sc {scene.number}</>}
        title={<span className="row gap-2 wrap"><span>Sc {scene.number}{scene.name ? ` · ${scene.name}` : ""}</span>{readiness && <Badge status={readiness.overall} lg>{readiness.overall === "READY" ? "Costume ready" : humanize(readiness.overall)}</Badge>}</span>}
        sub={[scene.intExt, scene.location, scene.timeOfDay, scene.scriptDay, scene.pages ? `${scene.pages} pgs` : null, scene.revision ? `Rev. ${scene.revision}` : null, scene.shootDate ? fmtDateLong(scene.shootDate) : "Unscheduled"].filter(Boolean).join(" · ")}
        actions={<><Link to={`${base}/continuity?sceneId=${scene.id}`} className="btn"><BookOpen size={16} /> Continuity</Link>{can(MANAGER_ROLES) && <button className="btn" onClick={openEdit}><Pencil size={16} /> Edit</button>}</>}
      />
      {scene.synopsis && <div className="notice info mb-2">{scene.synopsis}</div>}

      <div className="grid grid-2" style={{ gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)" }}>
        <Card title="Costume readiness" actions={can(MANAGER_ROLES) && <button className="btn btn-sm" onClick={() => { setAddChar(""); setAddChange(""); setAddOpen(true); }}><Plus size={14} /> Character</button>}>
          {!readiness || readiness.characters.length === 0 ? <Empty icon="🧍" title="No characters in this scene" /> : (
            <div className="col gap-2">
              {readiness.characters.map((r) => {
                const sc = scene.characters.find((x) => x.characterId === r.character.id);
                return (
                  <div key={r.sceneCharacterId} className="card flat" style={{ padding: 12 }}>
                    <div className="row between top">
                      <div className="grow">
                        <Link to={`${base}/characters/${r.character.id}`} className="bold">{r.character.name}</Link>
                        <div className="subtle">{r.character.actor?.name || "No actor"}</div>
                      </div>
                      <div className="row gap-1">
                        <Badge status={r.level}>{r.level === "READY" ? "Ready" : humanize(r.level)}</Badge>
                        {can(MANAGER_ROLES) && <button className="btn btn-ghost btn-sm" onClick={() => removeChar.mutate(r.character.id)} title="Remove from scene"><Trash2 size={14} /></button>}
                      </div>
                    </div>
                    <div className="mt-2 row gap-2 wrap">
                      <span className="subtle">Change:</span>
                      {can(MANAGER_ROLES) ? (
                        <Select style={{ width: "auto", minHeight: 32, padding: "4px 30px 4px 10px" }} value={sc?.changeId || ""} onChange={(e) => setChar.mutate({ characterId: r.character.id, changeId: e.target.value || null })} options={(sc?.character.changes || []).map((c) => ({ value: c.id, label: `#${c.changeNumber} ${c.name}` }))} placeholder="— not assigned —" />
                      ) : (
                        <span>{r.change ? <Link to={`${base}/changes/${r.change.id}`}>#{r.change.changeNumber} {r.change.name}</Link> : "not assigned"}</span>
                      )}
                      {r.change && <Link to={`${base}/changes/${r.change.id}`} className="btn btn-ghost btn-sm">Open look</Link>}
                    </div>
                    {r.items.length > 0 && (
                      <div className="mt-1">
                        {r.items.map((it) => <ReadinessLine key={it.costumeId} level={it.level} name={<Link to={`${base}/costumes/${it.costumeId}`}><span className="mono">{it.assetNumber}</span> {it.name}</Link>} sub={[it.location, it.wearNotes].filter(Boolean).join(" · ")} />)}
                      </div>
                    )}
                    {r.blockers.length > 0 && r.items.length === 0 && <div className="subtle mt-1">{r.blockers.join("; ")}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <div className="col gap-2">
          <Card title="Continuity (takes)" actions={<Link to={`${base}/continuity?sceneId=${scene.id}`} className="btn btn-sm">Record take</Link>}>
            {continuityByChar.size === 0 ? <div className="subtle">No takes recorded yet.</div> : (
              <div className="col gap-2">
                {[...continuityByChar.entries()].map(([cid, recs]) => (
                  <div key={cid}>
                    <div className="bold small">{recs[0].character?.name}</div>
                    <div className="chips mt-1">{recs.map((r) => <Link key={r.id} to={`${base}/continuity?sceneId=${scene.id}&characterId=${cid}`}><span className="chip">Take {r.takeNumber}{r.notes ? " ✎" : ""}</span></Link>)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title={<span className="row gap-1"><Sparkles size={16} color="var(--accent)" /> Costume cues from script</span>} actions={can(MANAGER_ROLES) && scene.hasScript && <button className="btn btn-sm" disabled={cueProgress.running} onClick={() => runCues([scene.id])}>{cueProgress.running ? "Reading…" : (scene.cues || []).length ? "Re-extract" : "Extract"}</button>}>
            {(() => {
              const cues = scene.cues || [];
              const suggested = cues.filter((c) => c.status === "SUGGESTED");
              const accepted = cues.filter((c) => c.status === "ACCEPTED");
              const dismissed = cues.filter((c) => c.status === "DISMISSED");
              const visible = [...suggested, ...accepted, ...(showDismissed ? dismissed : [])];
              const tone = (k: string) => (k === "CONDITION" || k === "NOTE" ? "WARNING" : k === "CONTINUITY" || k === "CHANGE" ? "INFO" : "MUTED");
              return (
                <div className="col gap-2">
                  <CueProgress progress={cueProgress} />
                  {cues.length === 0 && !cueProgress.running && (
                    <div className="subtle">{scene.hasScript ? "Press Extract to read this scene." : "No script text on this scene. Upload the screenplay to enable cues."}</div>
                  )}
                  {suggested.length > 0 && can(OPS_ROLES) && (
                    <div className="row gap-1 wrap small"><span className="subtle">{suggested.length} suggestion{suggested.length === 1 ? "" : "s"} to review</span><button className="btn btn-sm" onClick={() => bulkCues.mutate({ ids: suggested.map((c) => c.id), status: "ACCEPTED" })}><Check size={14} /> Accept all</button><button className="btn btn-ghost btn-sm" onClick={() => bulkCues.mutate({ ids: suggested.map((c) => c.id), status: "DISMISSED" })}>Dismiss all</button></div>
                  )}
                  {visible.map((c) => (
                    <div key={c.id} className="card flat" style={{ padding: "8px 10px", opacity: c.status === "DISMISSED" ? 0.55 : 1, borderStyle: c.status === "SUGGESTED" ? "dashed" : "solid" }}>
                      <div className="row between top gap-2">
                        <div className="grow" style={{ minWidth: 0 }}>
                          <div className="row gap-1 wrap"><Badge status={tone(c.kind)}>{humanize(c.kind)}</Badge>{c.character ? <Link to={`${base}/characters/${c.character.id}`} className="bold small">{c.character.name}</Link> : c.characterName ? <span className="bold small">{c.characterName}</span> : <span className="subtle small">Scene</span>}{c.status === "ACCEPTED" && <Badge status="READY">Accepted</Badge>}{c.status === "DISMISSED" && <Badge status="MUTED">Dismissed</Badge>}{c.confidence === "LOW" && <span className="subtle tiny">low confidence</span>}<Badge status="MUTED">{c.source === "AI" ? "AI" : "Reader"}</Badge></div>
                          <div className="small mt-1">{c.text}</div>
                          {c.quote && <div className="subtle tiny" style={{ fontStyle: "italic" }}>“{c.quote}”</div>}
                        </div>
                        {can(OPS_ROLES) && (
                          <div className="row gap-1">
                            {c.status !== "ACCEPTED" && <button className="btn btn-sm" title="Accept" onClick={() => setCue.mutate({ id: c.id, status: "ACCEPTED" })}><Check size={14} /></button>}
                            {c.status !== "DISMISSED" && <button className="btn btn-ghost btn-sm" title="Dismiss" onClick={() => setCue.mutate({ id: c.id, status: "DISMISSED" })}><X size={14} /></button>}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {dismissed.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setShowDismissed((v) => !v)}>{showDismissed ? "Hide" : "Show"} {dismissed.length} dismissed</button>}
                  {cues.length > 0 && <div className="subtle tiny">Suggested from the script text. Accept what the department agrees with; nothing else changes by itself.</div>}
                </div>
              );
            })()}
          </Card>
          <Card title="Open cleaning tickets">
            {!scene.cleaning?.length ? <div className="subtle">None.</div> : (
              <div className="list">
                {scene.cleaning.map((c) => (
                  <Link key={c.id} to={`${base}/cleaning/${c.id}`} className="item link" style={{ padding: "8px 0" }}>
                    <Dot status={c.isEmergency ? "URGENT" : c.priority} pulse={c.isEmergency} />
                    <div className="grow"><div className="title small"><span className="mono">{c.costume.assetNumber}</span> {c.costume.name}</div><div className="meta">{c.problem}</div></div>
                    <Badge status={c.status} />
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add character to scene" footer={<><button className="btn" onClick={() => setAddOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!addChar || setChar.isPending} onClick={() => setChar.mutate({ characterId: addChar, changeId: addChange || null })}>Add</button></>}>
        <div className="col">
          <Field label="Character"><Select value={addChar} onChange={(e) => { setAddChar(e.target.value); setAddChange(""); }} options={(characters || []).filter((c) => !scene.characters.some((sc) => sc.characterId === c.id)).map((c) => ({ value: c.id, label: c.name }))} placeholder="Select…" /></Field>
          <Field label="Change (look)"><Select value={addChange} onChange={(e) => setAddChange(e.target.value)} options={(charChanges || []).map((c) => ({ value: c.id, label: `#${c.changeNumber} ${c.name}` }))} placeholder="— assign later —" /></Field>
        </div>
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit scene" footer={<><button className="btn" onClick={() => setEditOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={update.isPending} onClick={() => update.mutate()}>Save</button></>}>
        <div className="form-grid">
          <Field label="Scene number"><Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></Field>
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Location"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label="Script day"><Input value={form.scriptDay} onChange={(e) => setForm({ ...form, scriptDay: e.target.value })} /></Field>
          <Field label="INT / EXT"><Select value={form.intExt} onChange={(e) => setForm({ ...form, intExt: e.target.value })} options={meta?.intExt || []} placeholder="—" humanizeLabels={false} /></Field>
          <Field label="Time of day"><Select value={form.timeOfDay} onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })} options={meta?.timesOfDay || []} placeholder="—" /></Field>
          <Field label="Shoot date"><Input type="date" value={form.shootDate} onChange={(e) => setForm({ ...form, shootDate: e.target.value })} /></Field>
          <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={meta?.sceneStatuses || []} /></Field>
          <Field label="Pages"><Input value={form.pages} onChange={(e) => setForm({ ...form, pages: e.target.value })} /></Field>
          <Field label="Synopsis" span2><Textarea value={form.synopsis} onChange={(e) => setForm({ ...form, synopsis: e.target.value })} /></Field>
        </div>
        <ErrorBox error={update.error} />
      </Modal>
    </div>
  );
}
