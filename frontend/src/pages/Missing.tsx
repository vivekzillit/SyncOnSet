import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, MapPin, Megaphone } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { OPS_ROLES, REQUEST_ROLES } from "@/state/auth";
import { fmtDateTime, matches } from "@/lib/format";
import type { Costume, MissingItem } from "@/api/types";
import { Badge, Card, Chips, ConfirmButton, Empty, ErrorBox, Field, Input, Modal, PageHead, SearchBox, Spinner, Textarea, useToast } from "@/components/ui";
import { RecordActions } from "@/components/Discussion";
import { SendRequestModal, chaseBody } from "@/components/SendRequest";
import { CostumePicker, CostumeRow, MediaPicker, PhotoGrid, attachMedia } from "@/components/domain";

export default function Missing() {
  const { projectId, can, project } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const [filter, setFilter] = useState<"OPEN" | "all" | "">("OPEN");
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["missing", projectId], queryFn: () => api<MissingItem[]>(p(projectId, "/missing")) });
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(false);
  /** The message a search starts from, taken when the button is pressed so nothing rewrites it mid-sentence. */
  const [chase, setChase] = useState<{ title: string; body: string; entityId?: string } | null>(null);
  const [f, setF] = useState<{ costume: Costume | null; lastSeenLocation: string; lastAssignedTo: string; notes: string }>({ costume: null, lastSeenLocation: "", lastAssignedTo: "", notes: "" });
  const [found, setFound] = useState<{ id: string; location: string } | null>(null);
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
      if (!createdId.current) createdId.current = (await api<{ id: string }>(p(projectId, "/missing"), { body: { costumeId: f.costume!.id, lastSeenLocation: f.lastSeenLocation || null, lastAssignedTo: f.lastAssignedTo || null, notes: f.notes || null } })).id;
      await attachMedia({ projectId, entityType: "MISSING", entityId: createdId.current, files: media, kind: "REFERENCE", keep: setMedia, savedNote: "The report is saved — press Report again to attach what is left." });
      return createdId.current;
    },
    onSuccess: (id) => { createdId.current = null; if (sendAfter.current && id) setChase({ title: `Missing · ${f.costume!.assetNumber} ${f.costume!.name}`.slice(0, 160), body: `${f.costume!.assetNumber} ${f.costume!.name} is missing.${f.lastSeenLocation ? `\nLast seen: ${f.lastSeenLocation}` : ""}${f.lastAssignedTo ? `\nLast with: ${f.lastAssignedTo}` : ""}${f.notes ? `\n${f.notes}` : ""}\n\nPlease check and say if you have seen it.`, entityId: id }); sendAfter.current = false; qc.invalidateQueries(); closeForm(); setF({ costume: null, lastSeenLocation: "", lastAssignedTo: "", notes: "" }); toast.push("Reported missing", "ok"); },
  });
  const resolve = useMutation({ mutationFn: (v: { id: string; status: string; foundLocation?: string }) => api(p(projectId, `/missing/${v.id}`), { method: "PATCH", body: v }), onSuccess: () => { qc.invalidateQueries(); setFound(null); toast.push("Updated", "ok"); }, onError: (e: Error) => toast.push(e.message, "danger") });

  if (isLoading || !data) return <Spinner />;
  // The search party covers everything still missing, not what the search box happens to be showing.
  const stillMissing = data.filter((m) => m.status === "OPEN");
  const putOutSearch = () => setChase({
    title: `Missing from wardrobe · ${project?.name || "Production"}`.slice(0, 160),
    body: chaseBody({
      lead: `${stillMissing.length} ${stillMissing.length === 1 ? "piece is" : "pieces are"} missing:`,
      lines: stillMissing.map((m) => `${m.costume.assetNumber} ${m.costume.name}${m.costume.character ? ` (${m.costume.character.name})` : ""} — last seen ${m.lastSeenLocation || "nobody knows where"}${m.lastAssignedTo ? ` · with ${m.lastAssignedTo}` : ""}`),
      empty: "Nothing is missing right now.",
      ask: "Please check your bags, trucks and rooms and say if you have seen any of these.",
    }),
  });
  const items = data.filter((m) => (filter !== "OPEN" || m.status === "OPEN")
    && matches(q, m.costume.assetNumber, m.costume.name, m.costume.character?.name, m.lastSeenLocation, m.lastAssignedTo, m.notes));
  return (
    <div>
      <PageHead title="Missing items" sub="Every open search, with last known location and custodian." actions={<>
        {can(REQUEST_ROLES) && <button className="btn" onClick={putOutSearch}><Megaphone size={16} /> Send reminder request</button>}
        {can(OPS_ROLES) && <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Report missing</button>}
      </>} />
      <div className="filters"><SearchBox value={q} onChange={setQ} placeholder="Search costume, character, last seen, custodian…" /><Chips options={[{ key: "OPEN", label: "Open" }, { key: "all", label: "All" }]} value={filter} onChange={(v) => setFilter(v || "all")} /></div>
      {items.length === 0 ? <Card>{q ? <Empty icon="🔎" title="No missing items match" /> : <Empty icon="🔎" title="Nothing missing" hint="Great — every piece is accounted for." />}</Card> : (
        <div className="col gap-2">
          {items.map((m) => (
            <Card key={m.id}>
              <div className="row between top wrap gap-2">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row gap-1 wrap"><Link to={`${base}/costumes/${m.costume.id}`} className="bold"><span className="mono">{m.costume.assetNumber}</span> {m.costume.name}</Link><Badge status={m.status} />{m.costume.character && <span className="subtle">{m.costume.character.name}</span>}</div>
                  <dl className="kv mt-1" style={{ gridTemplateColumns: "120px 1fr" }}>
                    <dt>Last seen</dt><dd>{m.lastSeenLocation || "—"}</dd>
                    <dt>Last assigned</dt><dd>{m.lastAssignedTo || "—"}</dd>
                    <dt>Last scan</dt><dd>{fmtDateTime(m.lastScanAt)}</dd>
                    <dt>Reported</dt><dd>{fmtDateTime(m.createdAt)}</dd>
                    {m.resolvedAt && <><dt>Resolved</dt><dd>{fmtDateTime(m.resolvedAt)}</dd></>}
                  </dl>
                  {m.notes && <div className="subtle mt-1">{m.notes}</div>}
                  <div className="mt-2"><PhotoGrid photos={m.photos || []} entityType="MISSING" entityId={m.id} kinds={["REFERENCE", "OTHER"]} compact attachments={false} /></div>
                </div>
                <RecordActions entityType="MISSING" entityId={m.id} title={`${m.costume.assetNumber} ${m.costume.name}`} path={`${base}/missing`}
                  summary={`Missing: ${m.costume.assetNumber} ${m.costume.name}\nLast seen: ${m.lastSeenLocation || "—"} · last assigned: ${m.lastAssignedTo || "—"}\nReported ${fmtDateTime(m.createdAt)}`} />
                {can(OPS_ROLES) && m.status === "OPEN" && (
                  <div className="col gap-1">
                    {found?.id === m.id ? (
                      <div className="row gap-1"><Input value={found.location} onChange={(e) => setFound({ ...found, location: e.target.value })} placeholder="Found at…" /><button className="btn btn-primary btn-sm" onClick={() => resolve.mutate({ id: m.id, status: "FOUND", foundLocation: found.location || "Wardrobe Truck" })}>Save</button></div>
                    ) : (
                      <button className="btn btn-primary btn-sm" onClick={() => setFound({ id: m.id, location: "Wardrobe Truck" })}><MapPin size={14} /> Found</button>
                    )}
                    <ConfirmButton className="btn btn-ghost btn-sm" confirmText="Write off?" onConfirm={() => resolve.mutate({ id: m.id, status: "WRITTEN_OFF" })}>Write off</ConfirmButton>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={open} onClose={closeForm} title="Report missing" footer={<><button className="btn" onClick={closeForm}>Cancel</button>{can(REQUEST_ROLES) && <button className="btn" disabled={!f.costume || create.isPending} onClick={() => { sendAfter.current = true; create.mutate(); }} title="Save it, then send a request about it"><Megaphone size={15} /> Report & send</button>}<button className="btn btn-danger" disabled={!f.costume || create.isPending} onClick={() => { sendAfter.current = false; create.mutate(); }}>Report</button></>}>
        <div className="col">
          <Field label="Costume">{f.costume ? <div className="list card flat pad-0"><CostumeRow c={f.costume} onClick={() => setPick(true)} end={<span className="subtle">change</span>} /></div> : <button type="button" className="btn" onClick={() => setPick(true)}>Choose costume…</button>}</Field>
          <Field label="Last seen location"><Input value={f.lastSeenLocation} onChange={(e) => setF({ ...f, lastSeenLocation: e.target.value })} /></Field>
          <Field label="Last assigned to"><Input value={f.lastAssignedTo} onChange={(e) => setF({ ...f, lastAssignedTo: e.target.value })} /></Field>
          <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <Field label="Photos & video" help="Shoot it now, or pick from the gallery"><MediaPicker files={media} onChange={setMedia} disabled={create.isPending} /></Field>
        </div>
        <ErrorBox error={create.error} />
      </Modal>
      <CostumePicker open={pick} onClose={() => setPick(false)} onPick={(c) => { setF({ ...f, costume: c, lastSeenLocation: c.location }); }} filter={(c) => c.status !== "MISSING"} />
      <SendRequestModal open={!!chase} onClose={() => setChase(null)} title="Send a reminder request · missing"
        defaultTitle={chase?.title || ""} defaultBody={chase?.body || ""} entityType="MISSING" entityId={chase?.entityId} />
    </div>
  );
}
