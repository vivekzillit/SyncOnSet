import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ChevronRight, Megaphone } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, TAILOR_ROLES, REQUEST_ROLES } from "@/state/auth";
import { fmtDateTime, humanize, matches } from "@/lib/format";
import type { Alteration, Costume } from "@/api/types";
import { Badge, Card, Chips, ConfirmButton, Empty, ErrorBox, Field, Input, Modal, PageHead, SearchBox, Select, Spinner, useToast } from "@/components/ui";
import { RecordActions } from "@/components/Discussion";
import { SendRequestModal, chaseBody } from "@/components/SendRequest";
import { CostumePicker, CostumeRow, MediaPicker, PhotoGrid, Pipeline, attachMedia } from "@/components/domain";

export default function Alterations() {
  const { projectId, can, project } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const [filter, setFilter] = useState<"open" | "all" | "">("open");
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["alterations", projectId], queryFn: () => api<{ pipeline: string[]; items: Alteration[] }>(p(projectId, "/alterations")) });
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(false);
  /** The message a chase starts from, taken when the button is pressed so nothing rewrites it mid-sentence. */
  const [chase, setChase] = useState<{ title: string; body: string } | null>(null);
  const [f, setF] = useState<{ costume: Costume | null; issue: string; required: string; tailorName: string; priority: string; deadline: string }>({ costume: null, issue: "", required: "", tailorName: "", priority: "NORMAL", deadline: "" });
  const [media, setMedia] = useState<File[]>([]);
  const createdId = useRef<string | null>(null);
  /** Closing drops what was picked, so it can never ride along to the next record. */
  const closeForm = () => { setOpen(false); setMedia([]); createdId.current = null; };
  const create = useMutation({
    // The record is created once — a failed upload can be retried from the same open form without filing
    // a second one — and whatever did not attach stays in the picker rather than being thrown away.
    mutationFn: async () => {
      if (!createdId.current) createdId.current = (await api<{ id: string }>(p(projectId, "/alterations"), { body: { costumeId: f.costume!.id, issue: f.issue, required: f.required, tailorName: f.tailorName || null, priority: f.priority, deadline: f.deadline || null } })).id;
      await attachMedia({ projectId, entityType: "ALTERATION", entityId: createdId.current, files: media, kind: "DETAIL", keep: setMedia, savedNote: "The request is saved — press Request again to attach what is left." });
    },
    onSuccess: () => { createdId.current = null; qc.invalidateQueries(); closeForm(); setF({ costume: null, issue: "", required: "", tailorName: "", priority: "NORMAL", deadline: "" }); toast.push("Alteration requested", "ok"); },
  });
  const advance = useMutation({ mutationFn: (v: { id: string; toStatus?: string }) => api(p(projectId, `/alterations/${v.id}/advance`), { body: { toStatus: v.toStatus } }), onSuccess: () => { qc.invalidateQueries(); toast.push("Updated", "ok"); }, onError: (e: Error) => toast.push(e.message, "danger") });

  if (isLoading || !data) return <Spinner />;
  // The chase covers every alteration still outstanding, not what the search happens to be showing.
  const outstanding = data.items.filter((i) => !["COMPLETED", "CANCELLED"].includes(i.status));
  const chaseTailors = () => setChase({
    title: `Alterations outstanding · ${project?.name || "Production"}`.slice(0, 160),
    body: chaseBody({
      lead: `${outstanding.length} ${outstanding.length === 1 ? "alteration is" : "alterations are"} still open:`,
      lines: outstanding.map((a) => `${a.costume.assetNumber} ${a.costume.name}${a.character ? ` (${a.character.name})` : ""} — ${a.issue} → ${a.required} · ${humanize(a.status)}${a.tailorName ? ` · with ${a.tailorName}` : ""}${a.deadline ? ` · due ${fmtDateTime(a.deadline)}` : ""}`),
      empty: "Nothing is outstanding with the tailors right now.",
      ask: "Please confirm what you have and when each piece will be ready.",
    }),
  });
  const items = data.items.filter((i) => (filter !== "open" || !["COMPLETED", "CANCELLED"].includes(i.status))
    && matches(q, i.costume.assetNumber, i.costume.name, i.issue, i.required, i.tailorName, i.character?.name, i.character?.actor?.name, humanize(i.status), humanize(i.priority)));
  return (
    <div>
      <PageHead title="Alterations & tailoring" sub="Track every alteration from request to quality check." actions={<>
        {can(REQUEST_ROLES) && <button className="btn" onClick={chaseTailors}><Megaphone size={16} /> Send request</button>}
        {can(TAILOR_ROLES) && <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Alteration</button>}
      </>} />
      <div className="filters"><SearchBox value={q} onChange={setQ} placeholder="Search costume, issue, tailor, character…" /><Chips options={[{ key: "open", label: "Open" }, { key: "all", label: "All" }]} value={filter} onChange={(v) => setFilter(v || "all")} /></div>
      {items.length === 0 ? <Card><Empty icon="✂️" title={q ? "No alterations match" : "No alterations"} /></Card> : (
        <div className="col gap-2">
          {items.map((a) => {
            const idx = data.pipeline.indexOf(a.status);
            const next = idx >= 0 && idx < data.pipeline.length - 1 ? data.pipeline[idx + 1] : null;
            const overdue = a.deadline && new Date(a.deadline).getTime() < Date.now() && !["COMPLETED", "CANCELLED"].includes(a.status);
            return (
              <Card key={a.id}>
                <div className="row between top wrap gap-2">
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row gap-1 wrap"><Link to={`${base}/costumes/${a.costume.id}`} className="bold"><span className="mono">{a.costume.assetNumber}</span> {a.costume.name}</Link><Badge status={a.priority} /><Badge status={a.status} />{overdue && <Badge status="OVERDUE">Overdue</Badge>}</div>
                    <div className="mt-1"><b>{a.issue}</b> → {a.required}</div>
                    <div className="subtle">{a.character ? `${a.character.name}${a.character.actor ? ` (${a.character.actor.name})` : ""} · ` : ""}{a.tailorName ? `Tailor: ${a.tailorName} · ` : ""}{a.deadline ? `Due ${fmtDateTime(a.deadline)}` : "No deadline"}</div>
                    {a.notes && <div className="subtle mt-1" style={{ whiteSpace: "pre-line" }}>{a.notes}</div>}
                  </div>
                  <RecordActions entityType="ALTERATION" entityId={a.id} title={`${a.costume.assetNumber} ${a.costume.name}`} path={`${base}/alterations`}
                    summary={`Alteration: ${a.costume.assetNumber} ${a.costume.name}\n${a.issue} → ${a.required}\nStatus: ${humanize(a.status)}${a.deadline ? ` · Due ${fmtDateTime(a.deadline)}` : ""}`} />
                  {can(TAILOR_ROLES) && next && (
                    <div className="row gap-1 wrap">
                      <button className="btn btn-primary btn-sm" disabled={advance.isPending} onClick={() => advance.mutate({ id: a.id })}>{humanize(next)} <ChevronRight size={14} /></button>
                      <ConfirmButton className="btn btn-ghost btn-sm" confirmText="Cancel?" onConfirm={() => advance.mutate({ id: a.id, toStatus: "CANCELLED" })}>Cancel</ConfirmButton>
                    </div>
                  )}
                </div>
                {!["COMPLETED", "CANCELLED"].includes(a.status) && <div className="mt-2"><Pipeline steps={data.pipeline} current={a.status} /></div>}
                <div className="mt-2"><PhotoGrid photos={a.photos || []} entityType="ALTERATION" entityId={a.id} kinds={["DETAIL", "FRONT", "BACK", "SIDE", "OTHER"]} compact attachments={false} editRoles={TAILOR_ROLES} /></div>
              </Card>
            );
          })}
        </div>
      )}
      <Modal open={open} onClose={closeForm} title="Alteration request" footer={<><button className="btn" onClick={closeForm}>Cancel</button><button className="btn btn-primary" disabled={!f.costume || !f.issue || !f.required || create.isPending} onClick={() => create.mutate()}>Request</button></>}>
        <div className="form-grid">
          <Field label="Costume" span2>{f.costume ? <div className="list card flat pad-0"><CostumeRow c={f.costume} onClick={() => setPick(true)} end={<span className="subtle">change</span>} /></div> : <button type="button" className="btn" onClick={() => setPick(true)}>Choose costume…</button>}</Field>
          <Field label="Issue" span2><Input value={f.issue} onChange={(e) => setF({ ...f, issue: e.target.value })} /></Field>
          <Field label="Required" span2><Input value={f.required} onChange={(e) => setF({ ...f, required: e.target.value })} /></Field>
          <Field label="Tailor"><Input value={f.tailorName} onChange={(e) => setF({ ...f, tailorName: e.target.value })} /></Field>
          <Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={meta?.priorities || []} /></Field>
          <Field label="Deadline" span2><Input type="datetime-local" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
          <Field label="Photos & video" span2 help="Shoot it now, or pick from the gallery"><MediaPicker files={media} onChange={setMedia} disabled={create.isPending} /></Field>
        </div>
        <ErrorBox error={create.error} />
      </Modal>
      <CostumePicker open={pick} onClose={() => setPick(false)} onPick={(c) => setF({ ...f, costume: c })} filter={(c) => !["ALTERATION", "CLEANING", "MISSING"].includes(c.status)} />
      <SendRequestModal open={!!chase} onClose={() => setChase(null)} title="Send a request · alterations"
        defaultTitle={chase?.title || ""} defaultBody={chase?.body || ""} entityType="ALTERATION" />
    </div>
  );
}
