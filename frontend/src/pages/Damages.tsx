import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, FINANCE_ROLES, OPS_ROLES } from "@/state/auth";
import { fmtDateTime, fmtMoney, humanize } from "@/lib/format";
import type { Costume, DamageReport, Scene } from "@/api/types";
import { Badge, Card, Chips, Empty, ErrorBox, Field, Input, Modal, PageHead, Select, Spinner, useToast } from "@/components/ui";
import { CostumePicker, CostumeRow, PhotoGrid } from "@/components/domain";

export default function Damages() {
  const { projectId, can, currency } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const [filter, setFilter] = useState<"open" | "all" | "">("open");
  const { data, isLoading } = useQuery({ queryKey: ["damages", projectId], queryFn: () => api<DamageReport[]>(p(projectId, "/damages")) });
  const { data: scenes } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(false);
  const [f, setF] = useState<{ costume: Costume | null; description: string; sceneId: string; takeNumber: string; estimatedRepairCost: string; responsible: string }>({ costume: null, description: "", sceneId: "", takeNumber: "", estimatedRepairCost: "", responsible: "PRODUCTION" });
  const create = useMutation({
    mutationFn: () => api(p(projectId, "/damages"), { body: { costumeId: f.costume!.id, description: f.description, sceneId: f.sceneId || null, takeNumber: f.takeNumber ? Number(f.takeNumber) : null, estimatedRepairCost: f.estimatedRepairCost ? Number(f.estimatedRepairCost) : null, responsible: f.responsible || null } }),
    onSuccess: () => { qc.invalidateQueries(); setOpen(false); setF({ costume: null, description: "", sceneId: "", takeNumber: "", estimatedRepairCost: "", responsible: "PRODUCTION" }); toast.push("Damage reported", "ok"); },
  });
  const setStatus = useMutation({ mutationFn: (v: { id: string; status: string }) => api(p(projectId, `/damages/${v.id}`), { method: "PATCH", body: { status: v.status } }), onSuccess: () => { qc.invalidateQueries(); toast.push("Updated", "ok"); }, onError: (e: Error) => toast.push(e.message, "danger") });

  if (isLoading || !data) return <Spinner />;
  const items = data.filter((d) => filter !== "open" || ["OPEN", "REPAIRING"].includes(d.status));
  return (
    <div>
      <PageHead title="Damage reports" actions={can(OPS_ROLES) && <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Report damage</button>} />
      <div className="filters"><Chips options={[{ key: "open", label: "Open" }, { key: "all", label: "All" }]} value={filter} onChange={(v) => setFilter(v || "all")} /></div>
      {items.length === 0 ? <Card><Empty icon="🧵" title="No damage reports" /></Card> : (
        <div className="col gap-2">
          {items.map((d) => (
            <Card key={d.id}>
              <div className="row between top wrap gap-2">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row gap-1 wrap"><Link to={`${base}/costumes/${d.costume.id}`} className="bold"><span className="mono">{d.costume.assetNumber}</span> {d.costume.name}</Link><Badge status={d.status} /></div>
                  <div className="mt-1"><b>{d.description}</b></div>
                  <div className="subtle">{fmtDateTime(d.createdAt)}{d.scene ? ` · Sc ${d.scene.number}${d.takeNumber ? ` T${d.takeNumber}` : ""}` : ""}{d.responsible ? ` · Responsible: ${humanize(d.responsible)}` : ""}{can(FINANCE_ROLES) && d.estimatedRepairCost != null ? ` · Est. repair ${fmtMoney(d.estimatedRepairCost, currency)}` : ""}</div>
                </div>
                {can(OPS_ROLES) && ["OPEN", "REPAIRING"].includes(d.status) && (
                  <div className="row gap-1 wrap">
                    {d.status === "OPEN" && <button className="btn btn-sm" onClick={() => setStatus.mutate({ id: d.id, status: "REPAIRING" })}>Repairing</button>}
                    <button className="btn btn-primary btn-sm" onClick={() => setStatus.mutate({ id: d.id, status: "REPAIRED" })}>Repaired</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setStatus.mutate({ id: d.id, status: "WRITTEN_OFF" })}>Write off</button>
                  </div>
                )}
              </div>
              <div className="mt-2"><PhotoGrid photos={d.photos || []} entityType="DAMAGE" entityId={d.id} kinds={["DETAIL", "OTHER"]} compact /></div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Report damage" footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-danger" disabled={!f.costume || !f.description || create.isPending} onClick={() => create.mutate()}>Report</button></>}>
        <div className="form-grid">
          <Field label="Costume" span2>{f.costume ? <div className="list card flat pad-0"><CostumeRow c={f.costume} onClick={() => setPick(true)} end={<span className="subtle">change</span>} /></div> : <button type="button" className="btn" onClick={() => setPick(true)}>Choose costume…</button>}</Field>
          <Field label="Damage" span2><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Torn sleeve" /></Field>
          <Field label="Scene"><Select value={f.sceneId} onChange={(e) => setF({ ...f, sceneId: e.target.value })} options={(scenes || []).map((s) => ({ value: s.id, label: `Sc ${s.number}` }))} placeholder="—" /></Field>
          <Field label="Take"><Input type="number" value={f.takeNumber} onChange={(e) => setF({ ...f, takeNumber: e.target.value })} /></Field>
          {can(FINANCE_ROLES) && <Field label={`Estimated repair (${currency})`}><Input type="number" value={f.estimatedRepairCost} onChange={(e) => setF({ ...f, estimatedRepairCost: e.target.value })} /></Field>}
          <Field label="Responsible"><Select value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })} options={meta?.damageResponsible || []} /></Field>
        </div>
        <ErrorBox error={create.error} />
      </Modal>
      <CostumePicker open={pick} onClose={() => setPick(false)} onPick={(c) => setF({ ...f, costume: c })} />
    </div>
  );
}
