import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Megaphone } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, FINANCE_ROLES, OPS_ROLES, REQUEST_ROLES } from "@/state/auth";
import { fmtDateTime, fmtMoney, humanize, matches, inCurrency } from "@/lib/format";
import type { Costume, DamageReport } from "@/api/types";
import { Badge, Card, Chips, Empty, ErrorBox, Field, Input, Modal, PageHead, SearchBox, Select, Spinner, useToast } from "@/components/ui";
import { SceneSelect } from "@/components/QuickSelects";
import { RecordActions } from "@/components/Discussion";
import { SendRequestModal, chaseBody } from "@/components/SendRequest";
import { CostumePicker, CostumeRow, MediaPicker, PhotoGrid, attachMedia } from "@/components/domain";

export default function Damages() {
  const { projectId, can, currency, project } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const [filter, setFilter] = useState<"open" | "all" | "">("open");
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["damages", projectId], queryFn: () => api<DamageReport[]>(p(projectId, "/damages")) });
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(false);
  /** The message a chase starts from, taken when the button is pressed so nothing rewrites it mid-sentence. */
  const [chase, setChase] = useState<{ title: string; body: string; entityId?: string } | null>(null);
  const [f, setF] = useState<{ costume: Costume | null; description: string; sceneId: string; takeNumber: string; estimatedRepairCost: string; responsible: string }>({ costume: null, description: "", sceneId: "", takeNumber: "", estimatedRepairCost: "", responsible: "PRODUCTION" });
  const [media, setMedia] = useState<File[]>([]);
  const createdId = useRef<string | null>(null);
  /** Set by the form's "… & send" button: once the record is saved, the Send request dialog opens about it. */
  const sendAfter = useRef(false);
  /** Closing drops what was picked, so it can never ride along to the next record. */
  const closeForm = () => { setOpen(false); setMedia([]); createdId.current = null; };
  const create = useMutation({
    // The record is created once — a failed upload can be retried from the same open form without filing
    // a second one — and whatever did not attach stays in the picker rather than being thrown away.
    mutationFn: async () => {
      if (!createdId.current) createdId.current = (await api<{ id: string }>(p(projectId, "/damages"), { body: { costumeId: f.costume!.id, description: f.description, sceneId: f.sceneId || null, takeNumber: f.takeNumber ? Number(f.takeNumber) : null, estimatedRepairCost: f.estimatedRepairCost ? Number(f.estimatedRepairCost) : null, responsible: f.responsible || null } })).id;
      await attachMedia({ projectId, entityType: "DAMAGE", entityId: createdId.current, files: media, kind: "DETAIL", keep: setMedia, savedNote: "The report is saved — press Report again to attach what is left." });
      return createdId.current;
    },
    onSuccess: (id) => { createdId.current = null; if (sendAfter.current && id) setChase({ title: `Damage · ${f.costume!.assetNumber} ${f.costume!.name}`.slice(0, 160), body: `${f.costume!.assetNumber} ${f.costume!.name} is damaged: ${f.description}${f.estimatedRepairCost ? `\nEstimated repair: ${f.estimatedRepairCost}` : ""}\n\nPlease say when it can be repaired.`, entityId: id }); sendAfter.current = false; qc.invalidateQueries(); closeForm(); setF({ costume: null, description: "", sceneId: "", takeNumber: "", estimatedRepairCost: "", responsible: "PRODUCTION" }); toast.push("Damage reported", "ok"); },
  });
  const setStatus = useMutation({ mutationFn: (v: { id: string; status: string }) => api(p(projectId, `/damages/${v.id}`), { method: "PATCH", body: { status: v.status } }), onSuccess: () => { qc.invalidateQueries(); toast.push("Updated", "ok"); }, onError: (e: Error) => toast.push(e.message, "danger") });

  if (isLoading || !data) return <Spinner />;
  // The chase covers every report still to be dealt with, not what the search happens to be showing.
  const unrepaired = data.filter((d) => ["OPEN", "REPAIRING"].includes(d.status));
  const chaseRepairs = () => setChase({
    title: `Repairs needed · ${project?.name || "Production"}`.slice(0, 160),
    body: chaseBody({
      lead: `${unrepaired.length} ${unrepaired.length === 1 ? "piece needs" : "pieces need"} repair:`,
      lines: unrepaired.map((d) => `${d.costume.assetNumber} ${d.costume.name} — ${d.description} · ${humanize(d.status)}${d.scene ? ` · Sc ${d.scene.number}` : ""}`),
      empty: "Nothing is waiting to be repaired right now.",
      ask: "Please say what you can take and by when.",
    }),
  });
  const items = data.filter((d) => (filter !== "open" || ["OPEN", "REPAIRING"].includes(d.status))
    && matches(q, d.costume.assetNumber, d.costume.name, d.description, d.scene?.number, humanize(d.responsible), humanize(d.status)));
  return (
    <div>
      <PageHead title="Damage reports" actions={<>
        {can(REQUEST_ROLES) && <button className="btn" onClick={chaseRepairs}><Megaphone size={16} /> Send request</button>}
        {can(OPS_ROLES) && <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Report damage</button>}
      </>} />
      <div className="filters"><SearchBox value={q} onChange={setQ} placeholder="Search costume, damage, scene…" /><Chips options={[{ key: "open", label: "Open" }, { key: "all", label: "All" }]} value={filter} onChange={(v) => setFilter(v || "all")} /></div>
      {items.length === 0 ? <Card><Empty icon="🧵" title={q ? "No damage reports match" : "No damage reports"} /></Card> : (
        <div className="col gap-2">
          {items.map((d) => (
            <Card key={d.id}>
              <div className="row between top wrap gap-2">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row gap-1 wrap"><Link to={`${base}/costumes/${d.costume.id}`} className="bold"><span className="mono">{d.costume.assetNumber}</span> {d.costume.name}</Link><Badge status={d.status} /></div>
                  <div className="mt-1"><b>{d.description}</b></div>
                  <div className="subtle">{fmtDateTime(d.createdAt)}{d.scene ? ` · Sc ${d.scene.number}${d.takeNumber ? ` T${d.takeNumber}` : ""}` : ""}{d.responsible ? ` · Responsible: ${humanize(d.responsible)}` : ""}{can(FINANCE_ROLES) && d.estimatedRepairCost != null ? ` · Est. repair ${fmtMoney(d.estimatedRepairCost, currency)}` : ""}</div>
                </div>
                <RecordActions entityType="DAMAGE" entityId={d.id} title={`${d.costume.assetNumber} ${d.costume.name}`} path={`${base}/damages`}
                  summary={`Damage: ${d.costume.assetNumber} ${d.costume.name}\n${d.description}\nStatus: ${humanize(d.status)} · reported ${fmtDateTime(d.createdAt)}`} />
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
      <Modal open={open} onClose={closeForm} title="Report damage" footer={<><button className="btn" onClick={closeForm}>Cancel</button>{can(REQUEST_ROLES) && <button className="btn" disabled={!f.costume || !f.description || create.isPending} onClick={() => { sendAfter.current = true; create.mutate(); }} title="Save it, then send a request about it"><Megaphone size={15} /> Report & send</button>}<button className="btn btn-danger" disabled={!f.costume || !f.description || create.isPending} onClick={() => { sendAfter.current = false; create.mutate(); }}>Report</button></>}>
        <div className="form-grid">
          <Field label="Costume" span2>{f.costume ? <div className="list card flat pad-0"><CostumeRow c={f.costume} onClick={() => setPick(true)} end={<span className="subtle">change</span>} /></div> : <button type="button" className="btn" onClick={() => setPick(true)}>Choose costume…</button>}</Field>
          <Field label="Damage" span2><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Scene"><SceneSelect value={f.sceneId} onChange={(sceneId) => setF({ ...f, sceneId })} /></Field>
          <Field label="Take"><Input type="number" value={f.takeNumber} onChange={(e) => setF({ ...f, takeNumber: e.target.value })} /></Field>
          {can(FINANCE_ROLES) && <Field label={`Estimated repair${inCurrency(currency)}`}><Input type="number" value={f.estimatedRepairCost} onChange={(e) => setF({ ...f, estimatedRepairCost: e.target.value })} /></Field>}
          <Field label="Responsible"><Select value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })} options={meta?.damageResponsible || []} /></Field>
          <Field label="Photos & video" span2 help="Shoot it now, or pick from the gallery"><MediaPicker files={media} onChange={setMedia} disabled={create.isPending} /></Field>
        </div>
        <ErrorBox error={create.error} />
      </Modal>
      <CostumePicker open={pick} onClose={() => setPick(false)} onPick={(c) => setF({ ...f, costume: c })} />
      <SendRequestModal open={!!chase} onClose={() => setChase(null)} title="Send a request · damage"
        defaultTitle={chase?.title || ""} defaultBody={chase?.body || ""} entityType="DAMAGE" entityId={chase?.entityId} />
    </div>
  );
}
