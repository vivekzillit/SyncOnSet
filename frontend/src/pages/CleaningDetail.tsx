import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, UserCheck, ChevronRight } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, CLEANING_ROLES, OPS_ROLES } from "@/state/auth";
import { fmtDateTime, humanize } from "@/lib/format";
import type { CleaningRequest } from "@/api/types";
import { Badge, Card, ConfirmButton, Field, Input, PageHead, Spinner, useToast } from "@/components/ui";
import { CostumeRow, PhotoGrid, Pipeline, Timeline } from "@/components/domain";

export default function CleaningDetail() {
  const { id = "" } = useParams();
  const { projectId, can } = useProject();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const { data: r, isLoading } = useQuery({ queryKey: ["cleaning", projectId, id], queryFn: () => api<CleaningRequest>(p(projectId, `/cleaning/${id}`)), refetchInterval: 15000 });
  const [note, setNote] = useState("");
  const inv = () => { qc.invalidateQueries({ queryKey: ["cleaning"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["costume"] }); };
  const advance = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<CleaningRequest>(p(projectId, `/cleaning/${id}/advance`), { body }),
    onSuccess: (x) => { inv(); setNote(""); toast.push(`Now: ${humanize(x.status)}`, "ok"); }, onError: (e: Error) => toast.push(e.message, "danger"),
  });
  const assignMe = useMutation({ mutationFn: () => api(p(projectId, `/cleaning/${id}`), { method: "PATCH", body: { assignedToId: user!.id } }), onSuccess: () => { inv(); toast.push("Assigned to you", "ok"); } });
  const replacement = useMutation({ mutationFn: (costumeId: string) => api(p(projectId, `/cleaning/${id}/replacement`), { body: { costumeId } }), onSuccess: () => { inv(); toast.push("Replacement assigned", "ok"); }, onError: (e: Error) => toast.push(e.message, "danger") });

  if (isLoading || !r) return <Spinner />;
  const pipeline = r.pipeline || ["REQUESTED", "RECEIVED", "CLEANING", "DRYING", "IRONING", "QUALITY_CHECK", "READY"];
  const idx = pipeline.indexOf(r.status);
  const next = idx >= 0 && idx < pipeline.length - 1 ? pipeline[idx + 1] : null;
  const closed = r.status === "READY" || r.status === "CANCELLED";
  const logs = r.logs.map((l) => ({ at: l.createdAt, kind: "CLEANING", title: humanize(l.toStatus), detail: l.note, by: l.byUserName }));

  return (
    <div>
      <PageHead
        crumbs={<><Link to={`${base}/cleaning`}>Cleaning</Link> / Ticket</>}
        title={<span className="row gap-2 wrap">{r.isEmergency && <Badge status="URGENT" lg>🚨 Emergency</Badge>}<span>{r.problem}</span><Badge status={r.status} lg /></span>}
        sub={<><Link to={`${base}/costumes/${r.costume.id}`}><b className="mono">{r.costume.assetNumber}</b> {r.costume.name}</Link>{r.costume.character ? ` · ${r.costume.character.name}` : ""}{r.scene ? ` · Sc ${r.scene.number}${r.takeNumber ? ` Take ${r.takeNumber}` : ""}` : ""}</>}
      />
      <Card className="mb-2"><Pipeline steps={pipeline} current={r.status === "CANCELLED" ? "" : r.status} />{r.status === "CANCELLED" && <div className="notice mt-2">This request was cancelled.</div>}</Card>

      <div className="grid grid-2" style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)" }}>
        <div className="col gap-2">
          {can(CLEANING_ROLES) && !closed && (
            <Card title="Work the ticket">
              <div className="col gap-2">
                {!r.assignedToId && <button className="btn" onClick={() => assignMe.mutate()}><UserCheck size={16} /> Assign to me</button>}
                <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Pre-treated with stain remover" /></Field>
                {r.status === "QUALITY_CHECK" ? (
                  <div className="row gap-1 wrap">
                    <button className="btn btn-primary" disabled={advance.isPending} onClick={() => advance.mutate({ qcResult: "PASS", qcNotes: note || null })}><CheckCircle2 size={16} /> QC pass → Ready</button>
                    <button className="btn btn-danger" disabled={advance.isPending} onClick={() => advance.mutate({ qcResult: "FAIL", qcNotes: note || "QC failed" })}><XCircle size={16} /> QC fail → back to cleaning</button>
                  </div>
                ) : next ? (
                  <div className="row gap-1 wrap">
                    <button className="btn btn-primary btn-lg" disabled={advance.isPending} onClick={() => advance.mutate({ note: note || null })}>Advance to {humanize(next)} <ChevronRight size={16} /></button>
                    {next !== "READY" && <button className="btn" disabled={advance.isPending} onClick={() => advance.mutate({ toStatus: "READY", note: note || "Fast-tracked", qcResult: "PASS" })}>Mark ready now</button>}
                  </div>
                ) : null}
                <ConfirmButton className="btn btn-ghost" confirmText="Cancel this request?" onConfirm={() => advance.mutate({ toStatus: "CANCELLED", note: note || "Cancelled" })}>Cancel request</ConfirmButton>
              </div>
            </Card>
          )}
          <Card title="Details">
            <dl className="kv">
              <dt>Cleaning type</dt><dd>{humanize(r.cleaningType)}</dd>
              <dt>Priority</dt><dd><Badge status={r.priority} /></dd>
              <dt>Requested</dt><dd>{fmtDateTime(r.createdAt)}{r.requestedByName ? ` by ${r.requestedByName}` : ""}</dd>
              <dt>Assigned to</dt><dd>{r.assignedToName || "—"}</dd>
              <dt>Expected ready</dt><dd>{fmtDateTime(r.expectedReadyAt)}</dd>
              <dt>Started</dt><dd>{fmtDateTime(r.startedAt)}</dd>
              <dt>Completed</dt><dd>{fmtDateTime(r.completedAt)}</dd>
              {r.qcResult && <><dt>Quality check</dt><dd><Badge status={r.qcResult} />{r.qcNotes ? ` ${r.qcNotes}` : ""}</dd></>}
              {r.notes && <><dt>Notes</dt><dd>{r.notes}</dd></>}
            </dl>
          </Card>
          <Card title="Stain / condition photos"><PhotoGrid photos={r.photos || []} entityType="CLEANING" entityId={r.id} kinds={["STAIN", "DETAIL", "OTHER"]} /></Card>
        </div>
        <div className="col gap-2">
          <Card title="Replacement on set">
            {r.replacement ? (
              <div className="notice ok"><b className="mono">{r.replacement.assetNumber}</b> {r.replacement.name} is covering while this piece is cleaned. <Link to={`${base}/costumes/${r.replacement.id}`}><u>View</u></Link></div>
            ) : closed ? <div className="subtle">No replacement was needed.</div> : (r.alternatives || []).length === 0 ? <div className="subtle">No matching alternatives available right now.</div> : (
              <div className="list card flat pad-0">
                {(r.alternatives || []).map((a) => <CostumeRow key={a.id} c={a} extra={<span> · match {a.matchScore}</span>} onClick={() => undefined} end={can(OPS_ROLES) ? <button className="btn btn-sm btn-primary" disabled={replacement.isPending} onClick={(e) => { e.stopPropagation(); replacement.mutate(a.id); }}>Assign</button> : undefined} />)}
              </div>
            )}
          </Card>
          <Card title="History"><Timeline events={logs.slice().reverse()} /></Card>
        </div>
      </div>
    </div>
  );
}
