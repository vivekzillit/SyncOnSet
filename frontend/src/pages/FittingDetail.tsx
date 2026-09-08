import { Fragment, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Check, Scissors, X, Clock } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { OPS_ROLES } from "@/state/auth";
import { fmtDateLong, fmtTime, humanize } from "@/lib/format";
import type { Costume, Fitting } from "@/api/types";
import { Badge, Card, ErrorBox, Field, Input, Modal, PageHead, Spinner, useToast } from "@/components/ui";
import { Avatar, CostumePicker, PhotoGrid } from "@/components/domain";

export default function FittingDetail() {
  const { id = "" } = useParams();
  const { projectId, can } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const { data: f, isLoading } = useQuery({ queryKey: ["fitting", id], queryFn: () => api<Fitting>(p(projectId, `/fittings/${id}`)) });
  const [pick, setPick] = useState(false);
  const [alt, setAlt] = useState<{ costumeId: string; issue: string; required: string; deadline: string } | null>(null);
  const [noteEdit, setNoteEdit] = useState<{ costumeId: string; text: string } | null>(null);
  const inv = () => { qc.invalidateQueries({ queryKey: ["fitting", id] }); qc.invalidateQueries({ queryKey: ["fittings", projectId] }); };
  const setItem = useMutation({
    mutationFn: (v: { costumeId: string; status?: string; notes?: string; alteration?: { issue: string; required: string; deadline?: string | null } }) => api(p(projectId, `/fittings/${id}/items/${v.costumeId}`), { method: "PATCH", body: v }),
    onSuccess: () => { inv(); qc.invalidateQueries({ queryKey: ["alterations"] }); setAlt(null); setNoteEdit(null); }, onError: (e: Error) => toast.push(e.message, "danger"),
  });
  const addItem = useMutation({ mutationFn: (c: Costume) => api(p(projectId, `/fittings/${id}/items`), { body: { costumeId: c.id } }), onSuccess: inv });
  const removeItem = useMutation({ mutationFn: (costumeId: string) => api(p(projectId, `/fittings/${id}/items/${costumeId}`), { method: "DELETE" }), onSuccess: inv });
  const setStatus = useMutation({ mutationFn: (status: string) => api(p(projectId, `/fittings/${id}`), { method: "PATCH", body: { status } }), onSuccess: () => { inv(); toast.push("Fitting updated", "ok"); } });

  if (isLoading || !f) return <Spinner />;
  const raw = f.character.actor?.measurements as unknown;
  const m: Record<string, string | number> = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : (raw as Record<string, string | number>) || {};
  const ops = can(OPS_ROLES);
  const fitted = f.items.filter((i) => i.status === "FITTED").length;

  return (
    <div>
      <PageHead
        crumbs={<><Link to={`${base}/fittings`}>Fittings</Link> / {f.character.name}</>}
        title={<span className="row gap-2"><Avatar name={f.character.name} lg /><span>{f.character.name}{f.actor ? ` · ${f.actor.name}` : ""} <Badge status={f.status} lg /></span></span>}
        sub={<>{fmtDateLong(f.scheduledAt)} {fmtTime(f.scheduledAt)}{f.location ? ` · ${f.location}` : ""} · {fitted}/{f.items.length} fitted</>}
        actions={ops && <>
          {f.status === "SCHEDULED" && <button className="btn" onClick={() => setStatus.mutate("IN_PROGRESS")}>Start fitting</button>}
          {f.status !== "COMPLETED" && f.status !== "CANCELLED" && <button className="btn btn-primary" onClick={() => setStatus.mutate("COMPLETED")}><Check size={16} /> Complete</button>}
          {f.status !== "CANCELLED" && f.status !== "COMPLETED" && <button className="btn btn-ghost" onClick={() => setStatus.mutate("CANCELLED")}>Cancel</button>}
        </>}
      />
      {f.notes && <div className="notice info mb-2">{f.notes}</div>}
      <div className="grid grid-2" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)" }}>
        <Card title="Checklist" actions={ops && <button className="btn btn-sm" onClick={() => setPick(true)}><Plus size={14} /> Piece</button>}>
          {f.items.length === 0 ? <div className="subtle">No pieces on this fitting yet.</div> : (
            <div className="list">
              {f.items.map((it) => (
                <div key={it.id} className="item" style={{ padding: "10px 0", alignItems: "flex-start" }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row gap-1"><Link to={`${base}/costumes/${it.costume.id}`} className="title"><span className="mono">{it.costume.assetNumber}</span> {it.costume.name}</Link><Badge status={it.status} /></div>
                    <div className="meta">{it.costume.size ? `Size ${it.costume.size} · ` : ""}{humanize(it.costume.status)}</div>
                    {noteEdit?.costumeId === it.costumeId ? (
                      <div className="row gap-1 mt-1"><Input value={noteEdit.text} onChange={(e) => setNoteEdit({ ...noteEdit, text: e.target.value })} placeholder="Notes: half size big, insole added…" /><button className="btn btn-sm btn-primary" onClick={() => setItem.mutate({ costumeId: it.costumeId, notes: noteEdit.text })}>Save</button><button className="btn btn-sm" onClick={() => setNoteEdit(null)}>Cancel</button></div>
                    ) : (
                      <div className="subtle" onClick={() => ops && setNoteEdit({ costumeId: it.costumeId, text: it.notes || "" })} style={{ cursor: ops ? "text" : undefined }}>{it.notes ? `✎ ${it.notes}` : ops ? "+ notes" : ""}</div>
                    )}
                    {ops && (
                      <div className="row gap-1 wrap mt-1">
                        <button className={`btn btn-sm ${it.status === "FITTED" ? "btn-primary" : ""}`} onClick={() => setItem.mutate({ costumeId: it.costumeId, status: "FITTED" })}><Check size={14} /> Fitted</button>
                        <button className={`btn btn-sm ${it.status === "PENDING" ? "btn-primary" : ""}`} onClick={() => setItem.mutate({ costumeId: it.costumeId, status: "PENDING" })}><Clock size={14} /> Pending</button>
                        <button className="btn btn-sm" onClick={() => setAlt({ costumeId: it.costumeId, issue: "", required: "", deadline: "" })}><Scissors size={14} /> Alteration</button>
                        <button className={`btn btn-sm ${it.status === "REJECTED" ? "btn-danger" : ""}`} onClick={() => setItem.mutate({ costumeId: it.costumeId, status: "REJECTED" })}><X size={14} /> Reject</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => removeItem.mutate(it.costumeId)}>remove</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <div className="col gap-2">
          <Card title="Measurements">
            {Object.keys(m).length ? <dl className="kv">{Object.entries(m).map(([k, v]) => <Fragment key={k}><dt>{humanize(k)}</dt><dd>{String(v)}</dd></Fragment>)}</dl> : <div className="subtle">No measurements on file for {f.character.actor?.name || "this actor"}.</div>}
            {f.character.actor?.notes && <div className="notice mt-2">{f.character.actor.notes}</div>}
          </Card>
          <Card title="Fitting photos"><PhotoGrid photos={f.photos || []} entityType="FITTING" entityId={f.id} kinds={["FRONT", "SIDE", "BACK", "DETAIL"]} /></Card>
        </div>
      </div>
      <CostumePicker open={pick} onClose={() => setPick(false)} onPick={(c) => addItem.mutate(c)} characterId={f.characterId} filter={(c) => !f.items.some((i) => i.costumeId === c.id)} />
      <Modal open={!!alt} onClose={() => setAlt(null)} title="Alteration required" footer={<><button className="btn" onClick={() => setAlt(null)}>Cancel</button><button className="btn btn-primary" disabled={!alt?.issue || !alt?.required || setItem.isPending} onClick={() => alt && setItem.mutate({ costumeId: alt.costumeId, status: "ALTERATION_REQUIRED", notes: alt.issue, alteration: { issue: alt.issue, required: alt.required, deadline: alt.deadline || null } })}>Raise alteration</button></>}>
        {alt && (
          <div className="col">
            <Field label="Issue"><Input value={alt.issue} onChange={(e) => setAlt({ ...alt, issue: e.target.value })} placeholder="Sleeves too long" autoFocus /></Field>
            <Field label="Required"><Input value={alt.required} onChange={(e) => setAlt({ ...alt, required: e.target.value })} placeholder="Reduce 1.5 inch" /></Field>
            <Field label="Deadline"><Input type="datetime-local" value={alt.deadline} onChange={(e) => setAlt({ ...alt, deadline: e.target.value })} /></Field>
            <div className="subtle">The costume is sent to the tailor and marked unavailable until the alteration is complete.</div>
          </div>
        )}
        <ErrorBox error={setItem.error} />
      </Modal>
    </div>
  );
}
