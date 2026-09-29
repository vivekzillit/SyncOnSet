import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Siren, LayoutGrid, List, Megaphone } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, CLEANING_ROLES, REQUEST_ROLES } from "@/state/auth";
import { fmtTime, humanize, matches, relativeTime } from "@/lib/format";
import type { CleaningRequest, Costume } from "@/api/types";
import { Badge, Card, Dot, Empty, ErrorBox, Field, Input, Modal, PageHead, SearchBox, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { SceneSelect } from "@/components/QuickSelects";
import { CostumePicker, CostumeRow, MediaPicker, attachMedia } from "@/components/domain";
import { SendRequestModal, chaseBody } from "@/components/SendRequest";

export default function Cleaning() {
  const { projectId, can, project } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const [view, setView] = useState<"board" | "list">(window.innerWidth < 900 ? "list" : "board");
  const { data, isLoading } = useQuery({ queryKey: ["cleaning", projectId], queryFn: () => api<{ pipeline: string[]; items: CleaningRequest[] }>(p(projectId, "/cleaning")), refetchInterval: 20000 });
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(false);
  /** The message a chase starts from, taken at the moment the button is pressed: the sink refetches every
   *  20 seconds, and a ticket moving on behind the dialog must not rewrite what is being typed. */
  const [chase, setChase] = useState<{ title: string; body: string; id?: string } | null>(null);
  const [f, setF] = useState<{ costume: Costume | null; problem: string; cleaningType: string; priority: string; sceneId: string; takeNumber: string; expectedReadyAt: string; notes: string }>({ costume: null, problem: "", cleaningType: "SPOT_CLEANING", priority: "NORMAL", sceneId: "", takeNumber: "", expectedReadyAt: "", notes: "" });
  const [media, setMedia] = useState<File[]>([]);
  const createdId = useRef<string | null>(null);
  /** Closing drops what was picked, so it can never ride along to the next request. */
  const closeForm = () => { setOpen(false); setMedia([]); createdId.current = null; };
  const create = useMutation({
    // The request is filed once — a failed upload can be retried from the same open form without a second ticket —
    // and whatever did not attach stays in the picker rather than being thrown away.
    mutationFn: async () => {
      if (!createdId.current) createdId.current = (await api<CleaningRequest>(p(projectId, "/cleaning"), { body: { costumeId: f.costume!.id, problem: f.problem, cleaningType: f.cleaningType, priority: f.priority, sceneId: f.sceneId || null, takeNumber: f.takeNumber ? Number(f.takeNumber) : null, expectedReadyAt: f.expectedReadyAt || null, notes: f.notes || null } })).id;
      await attachMedia({ projectId, entityType: "CLEANING", entityId: createdId.current, files: media, kind: "STAIN", keep: setMedia, savedNote: "The request is saved — press Request again to attach what is left." });
    },
    onSuccess: () => { createdId.current = null; qc.invalidateQueries(); closeForm(); setF({ ...f, costume: null, problem: "" }); toast.push("Cleaning requested", "ok"); },
  });

  if (isLoading || !data) return <Spinner />;
  const shown = data.items.filter((i) => matches(q, i.costume.assetNumber, i.costume.name, i.costume.character?.name, i.problem, humanize(i.cleaningType), i.scene?.number, i.assignedToName));
  const open_ = shown.filter((i) => !["READY", "CANCELLED"].includes(i.status));
  const today = new Date().toDateString();
  const isReadyToday = (i: CleaningRequest) => i.status === "READY" && new Date(i.completedAt || i.createdAt).toDateString() === today;
  const readyToday = shown.filter(isReadyToday);
  // The header counts the whole sink, not just what the search is showing.
  const stillOpen = data.items.filter((i) => !["READY", "CANCELLED"].includes(i.status));
  const openCount = stillOpen.length;
  const readyTodayCount = data.items.filter(isReadyToday).length;
  // A chase covers the whole sink for the same reason, emergencies first.
  const chaseSink = () => {
    const tickets = [...stillOpen].sort((a, b) => Number(b.isEmergency) - Number(a.isEmergency));
    setChase({
      id: tickets[0]?.id,
      title: `Cleaning still open · ${project?.name || "Production"}`.slice(0, 160),
      body: chaseBody({
        lead: `${tickets.length} ${tickets.length === 1 ? "piece is" : "pieces are"} still in the sink:`,
        lines: tickets.map((i) => `${i.isEmergency ? "🚨 " : ""}${i.costume.assetNumber} ${i.costume.name} — ${i.problem} · ${humanize(i.status)}${i.expectedReadyAt ? ` · needed by ${fmtTime(i.expectedReadyAt)}` : ""}`),
        empty: "Nothing is in the sink right now.",
        ask: "Please say where each piece is and when it will be back.",
      }),
    });
  };

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
      <PageHead title="Sink / Cleaning" sub={`${openCount} open · ${readyTodayCount} completed today`} actions={<>
        <div className="row gap-0 hide-mobile" style={{ gap: 2 }}><button className={`btn btn-sm ${view === "board" ? "btn-primary" : ""}`} onClick={() => setView("board")}><LayoutGrid size={14} /></button><button className={`btn btn-sm ${view === "list" ? "btn-primary" : ""}`} onClick={() => setView("list")}><List size={14} /></button></div>
        <Link to={`${base}/scan?emergency=1`} className="btn btn-emergency"><Siren size={16} /> Emergency</Link>
        {can(REQUEST_ROLES) && <button className="btn" onClick={chaseSink}><Megaphone size={16} /> Send request</button>}
        {can(CLEANING_ROLES) && <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Request</button>}
      </>} />

      <div className="filters"><SearchBox value={q} onChange={setQ} placeholder="Search costume, problem, scene, assignee…" /></div>

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
          {shown.length === 0 ? <Empty icon="🧼" title={q ? "No cleaning requests match" : "No cleaning requests"} /> : (
            <div className="list">
              {[...open_, ...shown.filter((i) => i.status === "READY" || i.status === "CANCELLED")].map((i) => (
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

      <Modal open={open} onClose={closeForm} title="Request cleaning" footer={<><button className="btn" onClick={closeForm}>Cancel</button><button className="btn btn-primary" disabled={!f.costume || !f.problem || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Saving…" : "Request"}</button></>}>
        <div className="form-grid">
          <Field label="Costume" span2>
            {f.costume ? <div className="list card flat pad-0"><CostumeRow c={f.costume} onClick={() => setPick(true)} end={<span className="subtle">change</span>} /></div> : <button type="button" className="btn" onClick={() => setPick(true)}>Choose costume…</button>}
          </Field>
          <Field label="Problem" span2><Input value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} placeholder="Sweat marks, mud on hem…" /></Field>
          <Field label="Cleaning type"><Select value={f.cleaningType} onChange={(e) => setF({ ...f, cleaningType: e.target.value })} options={meta?.cleaningTypes || []} /></Field>
          <Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={meta?.priorities || []} /></Field>
          <Field label="Scene"><SceneSelect value={f.sceneId} onChange={(sceneId) => setF({ ...f, sceneId })} /></Field>
          <Field label="Take"><Input type="number" value={f.takeNumber} onChange={(e) => setF({ ...f, takeNumber: e.target.value })} /></Field>
          <Field label="Needed by" span2><Input type="datetime-local" value={f.expectedReadyAt} onChange={(e) => setF({ ...f, expectedReadyAt: e.target.value })} /></Field>
          <Field label="Photos & video" span2 help="Shoot the stain now, pick from the gallery, or scan a note"><MediaPicker files={media} onChange={setMedia} disabled={create.isPending} /></Field>
          <Field label="Notes" span2><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <ErrorBox error={create.error} />
      </Modal>
      <CostumePicker open={pick} onClose={() => setPick(false)} onPick={(c) => setF({ ...f, costume: c })} filter={(c) => c.status !== "CLEANING"} />
      <SendRequestModal open={!!chase} onClose={() => setChase(null)} title="Send a request · cleaning"
        defaultTitle={chase?.title || ""} defaultBody={chase?.body || ""} entityType="CLEANING" entityId={chase?.id} />
    </div>
  );
}
