import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, X } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { OPS_ROLES, MANAGER_ROLES } from "@/state/auth";
import { fmtDate } from "@/lib/format";
import type { Costume, CostumeChange } from "@/api/types";
import { Badge, Card, Empty, ErrorBox, Field, Input, Modal, PageHead, Spinner, Textarea, useToast } from "@/components/ui";
import { CostumePicker, PhotoGrid } from "@/components/domain";

export default function ChangeDetail() {
  const { id = "" } = useParams();
  const { projectId, can } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const { data: ch, isLoading } = useQuery({ queryKey: ["change", id], queryFn: () => api<CostumeChange>(p(projectId, `/changes/${id}`)) });
  const [pick, setPick] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [ef, setEf] = useState({ name: "", description: "", notes: "" });
  const [wear, setWear] = useState<{ costumeId: string; text: string } | null>(null);
  const inv = () => { qc.invalidateQueries({ queryKey: ["change", id] }); qc.invalidateQueries({ queryKey: ["character"] }); };
  const addItem = useMutation({ mutationFn: (c: Costume) => api(p(projectId, `/changes/${id}/items`), { body: { costumeId: c.id } }), onSuccess: () => { inv(); toast.push("Piece added", "ok"); }, onError: (e: Error) => toast.push(e.message, "danger") });
  const setWearNotes = useMutation({ mutationFn: (v: { costumeId: string; text: string }) => api(p(projectId, `/changes/${id}/items`), { body: { costumeId: v.costumeId, wearNotes: v.text } }), onSuccess: () => { inv(); setWear(null); } });
  const removeItem = useMutation({ mutationFn: (costumeId: string) => api(p(projectId, `/changes/${id}/items/${costumeId}`), { method: "DELETE" }), onSuccess: inv });
  const update = useMutation({ mutationFn: () => api(p(projectId, `/changes/${id}`), { method: "PATCH", body: ef }), onSuccess: () => { inv(); setEditOpen(false); toast.push("Saved", "ok"); } });

  if (isLoading || !ch) return <Spinner />;
  return (
    <div>
      <PageHead
        crumbs={<><Link to={`${base}/characters`}>Characters</Link> / <Link to={`${base}/characters/${ch.characterId}`}>{ch.character?.name}</Link> / Change #{ch.changeNumber}</>}
        title={`Change #${ch.changeNumber} · ${ch.name}`}
        sub={<>{ch.character?.name}{ch.character?.actor ? ` (${ch.character.actor.name})` : ""}{ch.description ? ` · ${ch.description}` : ""}</>}
        actions={can(MANAGER_ROLES) && <button className="btn" onClick={() => { setEf({ name: ch.name, description: ch.description || "", notes: ch.notes || "" }); setEditOpen(true); }}><Pencil size={16} /> Edit</button>}
      />
      <div className="grid grid-2" style={{ gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)" }}>
        <Card title={`Pieces (${ch.items.length})`} actions={can(OPS_ROLES) && <button className="btn btn-sm" onClick={() => setPick(true)}><Plus size={14} /> Add piece</button>}>
          {ch.items.length === 0 ? <Empty title="No pieces yet" hint="Attach shirts, trousers, shoes, accessories… each with wear notes for continuity." /> : (
            <div className="list">
              {ch.items.map((it) => (
                <div key={it.id} className="item" style={{ padding: "10px 0" }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <Link to={`${base}/costumes/${it.costume.id}`} className="title"><span className="mono">{it.costume.assetNumber}</span> {it.costume.name}</Link>
                    <div className="meta">{[it.costume.type, it.costume.color, it.costume.size ? `Size ${it.costume.size}` : null, it.costume.location].filter(Boolean).join(" · ")}</div>
                    {wear?.costumeId === it.costumeId ? (
                      <div className="row gap-1 mt-1"><Input value={wear.text} onChange={(e) => setWear({ ...wear, text: e.target.value })} placeholder="Wear notes: sleeves rolled, top button open…" /><button className="btn btn-sm btn-primary" onClick={() => setWearNotes.mutate(wear)}>Save</button><button className="btn btn-sm" onClick={() => setWear(null)}>Cancel</button></div>
                    ) : (
                      <div className="subtle" onClick={() => can(OPS_ROLES) && setWear({ costumeId: it.costumeId, text: it.wearNotes || "" })} style={{ cursor: can(OPS_ROLES) ? "text" : undefined }}>{it.wearNotes ? `✎ ${it.wearNotes}` : can(OPS_ROLES) ? "+ add wear notes" : ""}</div>
                    )}
                  </div>
                  <div className="end"><Badge status={it.costume.status} />{can(OPS_ROLES) && <button className="btn btn-ghost btn-sm" onClick={() => removeItem.mutate(it.costumeId)} title="Remove"><X size={14} /></button>}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <div className="col gap-2">
          <Card title="Look photos & references"><PhotoGrid photos={ch.photos || []} entityType="CHANGE" entityId={ch.id} kinds={["FRONT", "SIDE", "BACK", "CLOSEUP", "DETAIL", "REFERENCE", "DOCUMENT"]} /></Card>
          <Card title="Used in scenes" pad0>
            {!ch.sceneCharacters?.length ? <div className="subtle" style={{ padding: 14 }}>Not assigned to any scene yet.</div> : (
              <div className="list">{ch.sceneCharacters.map((sc) => <Link key={sc.scene.id} to={`${base}/scenes/${sc.scene.id}`} className="item link"><div className="avatar">{sc.scene.number}</div><div className="grow"><div className="title small">{sc.scene.name || `Scene ${sc.scene.number}`}</div></div><span className="subtle">{sc.scene.shootDate ? fmtDate(sc.scene.shootDate) : ""}</span></Link>)}</div>
            )}
          </Card>
          {ch.notes && <Card title="Notes"><div className="small">{ch.notes}</div></Card>}
        </div>
      </div>
      <CostumePicker open={pick} onClose={() => setPick(false)} onPick={(c) => addItem.mutate(c)} characterId={ch.characterId} filter={(c) => !ch.items.some((i) => i.costumeId === c.id)} />
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit change" footer={<><button className="btn" onClick={() => setEditOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={update.isPending} onClick={() => update.mutate()}>Save</button></>}>
        <div className="col">
          <Field label="Name"><Input value={ef.name} onChange={(e) => setEf({ ...ef, name: e.target.value })} /></Field>
          <Field label="Description"><Textarea value={ef.description} onChange={(e) => setEf({ ...ef, description: e.target.value })} /></Field>
          <Field label="Notes"><Textarea value={ef.notes} onChange={(e) => setEf({ ...ef, notes: e.target.value })} /></Field>
        </div>
        <ErrorBox error={update.error} />
      </Modal>
    </div>
  );
}
