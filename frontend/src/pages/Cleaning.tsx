import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Siren, LayoutGrid, List } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, CLEANING_ROLES } from "@/state/auth";
import { fmtTime, humanize, relativeTime } from "@/lib/format";
import type { CleaningRequest, Costume, Scene } from "@/api/types";
import { Badge, Card, Dot, Empty, ErrorBox, Field, Input, Modal, PageHead, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { CostumePicker, CostumeRow } from "@/components/domain";

export default function Cleaning() {
  const { projectId, can } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const [view, setView] = useState<"board" | "list">(window.innerWidth < 900 ? "list" : "board");
  const { data, isLoading } = useQuery({ queryKey: ["cleaning", projectId], queryFn: () => api<{ pipeline: string[]; items: CleaningRequest[] }>(p(projectId, "/cleaning")), refetchInterval: 20000 });
  const { data: scenes } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(false);
  const [f, setF] = useState<{ costume: Costume | null; problem: string; cleaningType: string; priority: string; sceneId: string; takeNumber: string; expectedReadyAt: string; notes: string }>({ costume: null, problem: "", cleaningType: "SPOT_CLEANING", priority: "NORMAL", sceneId: "", takeNumber: "", expectedReadyAt: "", notes: "" });
  const create = useMutation({
    mutationFn: () => api<CleaningRequest>(p(projectId, "/cleaning"), { body: { costumeId: f.costume!.id, problem: f.problem, cleaningType: f.cleaningType, priority: f.priority, sceneId: f.sceneId || null, takeNumber: f.takeNumber ? Number(f.takeNumber) : null, expectedReadyAt: f.expectedReadyAt || null, notes: f.notes || null } }),
    onSuccess: () => { qc.invalidateQueries(); setOpen(false); setF({ ...f, costume: null, problem: "" }); toast.push("Cleaning requested", "ok"); },
  });

  if (isLoading || !data) return <Spinner />;
  const open_ = data.items.filter((i) => !["READY", "CANCELLED"].includes(i.status));
  const today = new Date().toDateString();
  const readyToday = data.items.filter((i) => i.status === "READY" && new Date(i.completedAt || i.createdAt).toDateString() === today);

  const card = (i: CleaningRequest) => (
    <Link key={i.id} to={`${base}/cleaning/${i.id}`} className={`kcard ${i.isEmergency ? "emergency" : ""}`} style={{ display: "block" }}>
      <div className="row between gap-1">
        <span className="kc-title"><span className="mono">{i.costume.assetNumber}</span></span>
        <Badge status={i.isEmergency ? "URGENT" : i.priority}>{i.isEmergency ? "🚨 Emergency" : humanize(i.priority)}</Badge>
      </div>
      <div className="kc-title truncate">{i.costume.name}</div>
      <div className="kc-meta">{i.problem} · {humanize(i.cleaningType)}</div>
      <div className="kc-meta">{i.scene ? `Sc ${i.scene.number}${i.takeNumber ? ` T${i.takeNumber}` : ""} · ` : ""}{i.costume.character?.name || ""}</div>
      <div className="kc-meta row between mt-1"><span>{i.assignedToName ? `👤 ${i.assignedToName}` : "unassigned"}</span><span>{i.status === "READY" ? `done ${fmtTime(i.completedAt)}` : i.expectedReadyAt ? `ETA ${fmtTime(i.expectedReadyAt)}` : relativeTime(i.createdAt)}</span></div>
    </Link>
  );

  return (
    <div>
      <PageHead title="Sink / Cleaning" sub={`${open_.length} open · ${readyToday.length} completed today`} actions={<>
        <div className="row gap-0 hide-mobile" style={{ gap: 2 }}><button className={`btn btn-sm ${view === "board" ? "btn-primary" : ""}`} onClick={() => setView("board")}><LayoutGrid size={14} /></button><button className={`btn btn-sm ${view === "list" ? "btn-primary" : ""}`} onClick={() => setView("list")}><List size={14} /></button></div>
        <Link to={`${base}/scan?emergency=1`} className="btn btn-emergency"><Siren size={16} /> Emergency</Link>
        {can(CLEANING_ROLES) && <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Request</button>}
      </>} />

      {view === "board" ? (
        <div className="kanban">
          {data.pipeline.map((stage) => {
            const items = stage === "READY" ? readyToday : open_.filter((i) => i.status === stage);
            return (
              <div key={stage} className="kanban-col">
                <h4><span>{humanize(stage)}</span><span>{items.length}</span></h4>
                {items.map(card)}
              </div>
            );
          })}
        </div>
      ) : (
        <Card pad0>
          {data.items.length === 0 ? <Empty icon="🧼" title="No cleaning requests" /> : (
            <div className="list">
              {[...open_, ...data.items.filter((i) => i.status === "READY" || i.status === "CANCELLED")].map((i) => (
                <Link key={i.id} to={`${base}/cleaning/${i.id}`} className="item link">
                  <Dot status={i.isEmergency ? "URGENT" : i.priority} pulse={i.isEmergency && i.status !== "READY"} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="title truncate"><span className="mono">{i.costume.assetNumber}</span> {i.costume.name}</div>
                    <div className="meta truncate">{i.problem} · {humanize(i.cleaningType)}{i.scene ? ` · Sc ${i.scene.number}` : ""}{i.assignedToName ? ` · ${i.assignedToName}` : ""}</div>
                  </div>
                  <div className="end"><span className="subtle hide-mobile">{i.status === "READY" ? fmtTime(i.completedAt) : i.expectedReadyAt ? `ETA ${fmtTime(i.expectedReadyAt)}` : ""}</span><Badge status={i.status} /></div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Request cleaning" footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!f.costume || !f.problem || create.isPending} onClick={() => create.mutate()}>Request</button></>}>
        <div className="form-grid">
          <Field label="Costume" span2>
            {f.costume ? <div className="list card flat pad-0"><CostumeRow c={f.costume} onClick={() => setPick(true)} end={<span className="subtle">change</span>} /></div> : <button type="button" className="btn" onClick={() => setPick(true)}>Choose costume…</button>}
          </Field>
          <Field label="Problem" span2><Input value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} placeholder="Sweat marks, mud on hem…" /></Field>
          <Field label="Cleaning type"><Select value={f.cleaningType} onChange={(e) => setF({ ...f, cleaningType: e.target.value })} options={meta?.cleaningTypes || []} /></Field>
          <Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={meta?.priorities || []} /></Field>
          <Field label="Scene"><Select value={f.sceneId} onChange={(e) => setF({ ...f, sceneId: e.target.value })} options={(scenes || []).map((s) => ({ value: s.id, label: `Sc ${s.number}${s.name ? ` · ${s.name}` : ""}` }))} placeholder="—" /></Field>
          <Field label="Take"><Input type="number" value={f.takeNumber} onChange={(e) => setF({ ...f, takeNumber: e.target.value })} /></Field>
          <Field label="Needed by" span2><Input type="datetime-local" value={f.expectedReadyAt} onChange={(e) => setF({ ...f, expectedReadyAt: e.target.value })} /></Field>
          <Field label="Notes" span2><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <ErrorBox error={create.error} />
      </Modal>
      <CostumePicker open={pick} onClose={() => setPick(false)} onPick={(c) => setF({ ...f, costume: c })} filter={(c) => c.status !== "CLEANING"} />
    </div>
  );
}
