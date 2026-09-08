import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Siren, Droplets, ArrowRightLeft, PackageCheck, PackageOpen, Clapperboard, Scissors, AlertTriangle, SearchX, MapPin, Archive, Undo2 } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, CLEANING_ROLES, FINANCE_ROLES, MANAGER_ROLES, OPS_ROLES, TAILOR_ROLES } from "@/state/auth";
import { humanize } from "@/lib/format";
import type { Character, CleaningRequest, Costume, Scene, Vendor } from "@/api/types";
import { Badge, ErrorBox, Field, Input, Modal, Select, Textarea, useToast } from "./ui";
import { CostumeRow } from "./domain";

type ModalKind = null | "action" | "cleaning" | "emergency" | "emergencyResult" | "damage" | "alteration" | "missing";

interface Props {
  costume: Pick<Costume, "id" | "assetNumber" | "name" | "status" | "location" | "characterId">;
  sceneId?: string | null;
  takeNumber?: number | null;
  onChanged?: () => void;
  emphasizeEmergency?: boolean;
  openCleaningId?: string | null;
  openAlterationId?: string | null;
}

/** Contextual action bar for a costume: issue / return / move / clean / emergency / damage / missing… */
export function CostumeActions({ costume, sceneId, takeNumber, onChanged, emphasizeEmergency, openCleaningId, openAlterationId }: Props) {
  const { projectId, can } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const base = `/p/${projectId}`;
  const [modal, setModal] = useState<ModalKind>(null);
  const [action, setAction] = useState("ISSUE");
  const [af, setAf] = useState({ toLocation: "", sceneId: sceneId || "", takeNumber: takeNumber ? String(takeNumber) : "", note: "" });
  const [cf, setCf] = useState({ problem: "", cleaningType: "SPOT_CLEANING", priority: "NORMAL", sceneId: sceneId || "", takeNumber: takeNumber ? String(takeNumber) : "", autoAssignReplacement: true });
  const [df, setDf] = useState({ description: "", estimatedRepairCost: "", responsible: "PRODUCTION", sceneId: sceneId || "", takeNumber: takeNumber ? String(takeNumber) : "" });
  const [alf, setAlf] = useState({ issue: "", required: "", tailorName: "", priority: "HIGH", deadline: "" });
  const [mf, setMf] = useState({ lastSeenLocation: costume.location, notes: "" });
  const [result, setResult] = useState<{ request: CleaningRequest; alternatives: Costume[]; replacement: Costume | null } | null>(null);
  const { data: scenes } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });

  useEffect(() => { setCf((c) => ({ ...c, sceneId: sceneId || c.sceneId })); setAf((a) => ({ ...a, sceneId: sceneId || a.sceneId })); }, [sceneId]);

  const done = (msg: string) => { qc.invalidateQueries(); onChanged?.(); setModal(null); toast.push(msg, "ok"); };
  const fail = (e: Error) => toast.push(e.message, "danger");
  const num = (s: string) => (s ? Number(s) : null);

  const act = useMutation({
    mutationFn: () => api(p(projectId, `/costumes/${costume.id}/actions`), { body: { action, toLocation: af.toLocation || null, sceneId: af.sceneId || null, takeNumber: num(af.takeNumber), note: af.note || null } }),
    onSuccess: () => done(`${humanize(action)} recorded`), onError: fail,
  });
  const clean = useMutation({
    mutationFn: () => api<CleaningRequest>(p(projectId, "/cleaning"), { body: { costumeId: costume.id, problem: cf.problem, cleaningType: cf.cleaningType, priority: cf.priority, sceneId: cf.sceneId || null, takeNumber: num(cf.takeNumber) } }),
    onSuccess: (r) => { done("Cleaning requested"); nav(`${base}/cleaning/${r.id}`); }, onError: fail,
  });
  const emergency = useMutation({
    mutationFn: () => api<{ request: CleaningRequest; alternatives: Costume[]; replacement: Costume | null }>(p(projectId, "/cleaning/emergency"), { body: { costumeId: costume.id, problem: cf.problem, cleaningType: cf.cleaningType, sceneId: cf.sceneId || null, takeNumber: num(cf.takeNumber), autoAssignReplacement: cf.autoAssignReplacement } }),
    onSuccess: (r) => { qc.invalidateQueries(); onChanged?.(); setResult(r); setModal("emergencyResult"); toast.push("🚨 Emergency ticket raised", "ok"); }, onError: fail,
  });
  const assignRepl = useMutation({
    mutationFn: (v: { requestId: string; costumeId: string }) => api<Costume>(p(projectId, `/cleaning/${v.requestId}/replacement`), { body: { costumeId: v.costumeId } }),
    onSuccess: (c) => { qc.invalidateQueries(); setResult((r) => (r ? { ...r, replacement: c } : r)); toast.push(`${c.assetNumber} assigned as replacement`, "ok"); }, onError: fail,
  });
  const damage = useMutation({
    mutationFn: () => api(p(projectId, "/damages"), { body: { costumeId: costume.id, description: df.description, estimatedRepairCost: num(df.estimatedRepairCost), responsible: df.responsible || null, sceneId: df.sceneId || null, takeNumber: num(df.takeNumber) } }),
    onSuccess: () => done("Damage reported"), onError: fail,
  });
  const alteration = useMutation({
    mutationFn: () => api(p(projectId, "/alterations"), { body: { costumeId: costume.id, issue: alf.issue, required: alf.required, tailorName: alf.tailorName || null, priority: alf.priority, deadline: alf.deadline || null } }),
    onSuccess: () => done("Alteration requested"), onError: fail,
  });
  const missing = useMutation({
    mutationFn: () => api(p(projectId, "/missing"), { body: { costumeId: costume.id, lastSeenLocation: mf.lastSeenLocation || null, notes: mf.notes || null } }),
    onSuccess: () => done("Marked missing"), onError: fail,
  });

  const openAction = (a: string, loc = "") => { setAction(a); setAf({ ...af, toLocation: loc, note: "" }); setModal("action"); };
  const s = costume.status;
  const ops = can(OPS_ROLES);
  const btn = (label: string, icon: React.ReactNode, onClick: () => void, cls = "btn") => <button key={label} type="button" className={cls} onClick={onClick}>{icon} {label}</button>;

  const buttons: React.ReactNode[] = [];
  if (ops) {
    if (s === "AVAILABLE") buttons.push(btn("Issue to actor", <PackageOpen size={16} />, () => openAction("ISSUE", "Actor"), "btn btn-primary"), btn("Send to set", <Clapperboard size={16} />, () => openAction("TO_SET", "Set")));
    if (s === "ISSUED") buttons.push(btn("On set", <Clapperboard size={16} />, () => openAction("TO_SET", "Set"), "btn btn-primary"), btn("Return", <PackageCheck size={16} />, () => openAction("RETURN", "Wardrobe Truck")));
    if (s === "ON_SET") buttons.push(btn("Return to wardrobe", <PackageCheck size={16} />, () => openAction("RETURN", "Wardrobe Truck"), "btn btn-primary"));
    if (["AVAILABLE", "ISSUED", "ON_SET"].includes(s)) {
      buttons.push(btn("Emergency clean", <Siren size={16} />, () => { setCf({ ...cf, problem: "", cleaningType: "SPOT_CLEANING" }); setModal("emergency"); }, emphasizeEmergency ? "btn btn-emergency btn-lg" : "btn btn-emergency"));
      buttons.push(btn("Move", <ArrowRightLeft size={16} />, () => openAction("MOVE", "")));
    }
    if (["AVAILABLE", "ISSUED", "ON_SET", "DAMAGED"].includes(s)) buttons.push(btn("Report damage", <AlertTriangle size={16} />, () => setModal("damage")));
    if (s !== "MISSING" && s !== "RETIRED") buttons.push(btn("Mark missing", <SearchX size={16} />, () => setModal("missing")));
    if (s === "MISSING") buttons.push(btn("Found", <MapPin size={16} />, () => openAction("FOUND", "Wardrobe Truck"), "btn btn-primary"));
    if (s === "DAMAGED") buttons.push(btn("Repaired", <Undo2 size={16} />, () => openAction("REPAIRED", "Wardrobe Truck"), "btn btn-primary"));
    if (s === "RETURNED_TO_VENDOR" || s === "RETIRED") buttons.push(btn("Receive back", <PackageCheck size={16} />, () => openAction("RECEIVED", "Warehouse"), "btn btn-primary"));
  }
  if (can(CLEANING_ROLES) && ["AVAILABLE", "ISSUED", "ON_SET"].includes(s)) buttons.push(btn("Request cleaning", <Droplets size={16} />, () => { setCf({ ...cf, problem: "", priority: "NORMAL" }); setModal("cleaning"); }));
  if (can(TAILOR_ROLES) && ["AVAILABLE", "ISSUED", "ON_SET"].includes(s)) buttons.push(btn("Alteration", <Scissors size={16} />, () => setModal("alteration")));
  if (can(MANAGER_ROLES) && ["AVAILABLE", "DAMAGED"].includes(s)) buttons.push(btn("Retire", <Archive size={16} />, () => openAction("RETIRE")));

  const sceneOpts = (scenes || []).map((sc) => ({ value: sc.id, label: `Sc ${sc.number}${sc.name ? ` · ${sc.name}` : ""}` }));
  const locOpts = [...(meta?.standardLocations || []), ...(af.toLocation && !(meta?.standardLocations as string[] | undefined)?.includes(af.toLocation) ? [af.toLocation] : [])];

  return (
    <>
      <div className="row wrap gap-1">
        {s === "CLEANING" && <Link to={openCleaningId ? `${base}/cleaning/${openCleaningId}` : `${base}/cleaning`} className="btn btn-primary"><Droplets size={16} /> In cleaning · view ticket</Link>}
        {s === "ALTERATION" && <Link to={`${base}/alterations${openAlterationId ? `#${openAlterationId}` : ""}`} className="btn btn-primary"><Scissors size={16} /> With tailor · view</Link>}
        {buttons}
      </div>

      <Modal open={modal === "action"} onClose={() => setModal(null)} title={`${humanize(action)} · ${costume.assetNumber}`} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" disabled={act.isPending || (action === "MOVE" && !af.toLocation)} onClick={() => act.mutate()}>Confirm</button></>}>
        <div className="form-grid">
          {action !== "RETIRE" && (
            <Field label="To location" span2>
              <Select value={af.toLocation} onChange={(e) => setAf({ ...af, toLocation: e.target.value })} options={locOpts} placeholder="— choose —" humanizeLabels={false} />
              <Input className="mt-1" value={af.toLocation} onChange={(e) => setAf({ ...af, toLocation: e.target.value })} placeholder="or type a location (e.g. Vanity Van 2)" />
            </Field>
          )}
          {["ISSUE", "TO_SET", "RETURN"].includes(action) && (<>
            <Field label="Scene"><Select value={af.sceneId} onChange={(e) => setAf({ ...af, sceneId: e.target.value })} options={sceneOpts} placeholder="—" /></Field>
            <Field label="Take"><Input type="number" value={af.takeNumber} onChange={(e) => setAf({ ...af, takeNumber: e.target.value })} /></Field>
          </>)}
          <Field label="Note" span2><Input value={af.note} onChange={(e) => setAf({ ...af, note: e.target.value })} /></Field>
        </div>
        <ErrorBox error={act.error} />
      </Modal>

      <Modal open={modal === "cleaning" || modal === "emergency"} onClose={() => setModal(null)} title={modal === "emergency" ? <span className="row gap-1"><Siren size={18} color="var(--danger)" /> Emergency cleaning · {costume.assetNumber}</span> : `Request cleaning · ${costume.assetNumber}`}
        footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button>{modal === "emergency" ? <button className="btn btn-emergency" disabled={!cf.problem || emergency.isPending} onClick={() => emergency.mutate()}>{emergency.isPending ? "Raising…" : "Raise emergency"}</button> : <button className="btn btn-primary" disabled={!cf.problem || clean.isPending} onClick={() => clean.mutate()}>Request</button>}</>}>
        {modal === "emergency" && <div className="notice mb-2">This marks the costume unavailable, alerts laundry and the supervisor, and finds a replacement instantly.</div>}
        <div className="form-grid">
          <Field label="Problem" span2><Input value={cf.problem} onChange={(e) => setCf({ ...cf, problem: e.target.value })} placeholder="e.g. Coffee spill on chest" autoFocus /></Field>
          <Field label="Cleaning type"><Select value={cf.cleaningType} onChange={(e) => setCf({ ...cf, cleaningType: e.target.value })} options={meta?.cleaningTypes || []} /></Field>
          {modal === "cleaning" ? <Field label="Priority"><Select value={cf.priority} onChange={(e) => setCf({ ...cf, priority: e.target.value })} options={meta?.priorities || []} /></Field> : <Field label="Priority"><Badge status="URGENT" lg>Urgent</Badge></Field>}
          <Field label="Scene"><Select value={cf.sceneId} onChange={(e) => setCf({ ...cf, sceneId: e.target.value })} options={sceneOpts} placeholder="—" /></Field>
          <Field label="Take"><Input type="number" value={cf.takeNumber} onChange={(e) => setCf({ ...cf, takeNumber: e.target.value })} /></Field>
          {modal === "emergency" && <label className="check span-2"><input type="checkbox" checked={cf.autoAssignReplacement} onChange={(e) => setCf({ ...cf, autoAssignReplacement: e.target.checked })} /> Auto-assign the best available replacement</label>}
        </div>
        <ErrorBox error={clean.error || emergency.error} />
      </Modal>

      <Modal open={modal === "emergencyResult"} onClose={() => setModal(null)} title="Emergency ticket raised" footer={<><button className="btn" onClick={() => setModal(null)}>Close</button>{result && <Link to={`${base}/cleaning/${result.request.id}`} className="btn btn-primary">Open ticket</Link>}</>}>
        {result && (
          <div className="col gap-2">
            <div className="notice ok"><b>{costume.assetNumber}</b> is now <b>in cleaning</b> (URGENT). Laundry and the costume supervisor have been notified.</div>
            {result.replacement ? (
              <div className="notice info">Replacement <b className="mono">{result.replacement.assetNumber}</b> {result.replacement.name} has been issued to the actor.</div>
            ) : result.alternatives.length === 0 ? (
              <div className="notice">No matching replacement is available. Consider a spare or wait for cleaning (est. {result.request.expectedReadyAt ? new Date(result.request.expectedReadyAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}).</div>
            ) : null}
            {result.alternatives.length > 0 && (
              <div>
                <div className="bold small mb-2">Available alternatives</div>
                <div className="list card flat pad-0">
                  {result.alternatives.map((a) => (
                    <CostumeRow key={a.id} c={a} extra={<span> · match {a.matchScore}</span>} onClick={() => undefined} end={result.replacement?.id === a.id ? <Badge status="READY">Assigned</Badge> : <button className="btn btn-sm btn-primary" disabled={assignRepl.isPending || !!result.replacement} onClick={(e) => { e.stopPropagation(); assignRepl.mutate({ requestId: result.request.id, costumeId: a.id }); }}>Assign</button>} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={modal === "damage"} onClose={() => setModal(null)} title={`Report damage · ${costume.assetNumber}`} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-danger" disabled={!df.description || damage.isPending} onClick={() => damage.mutate()}>Report</button></>}>
        <div className="form-grid">
          <Field label="Damage" span2><Input value={df.description} onChange={(e) => setDf({ ...df, description: e.target.value })} placeholder="e.g. Torn sleeve" autoFocus /></Field>
          <Field label="Scene"><Select value={df.sceneId} onChange={(e) => setDf({ ...df, sceneId: e.target.value })} options={sceneOpts} placeholder="—" /></Field>
          <Field label="Take"><Input type="number" value={df.takeNumber} onChange={(e) => setDf({ ...df, takeNumber: e.target.value })} /></Field>
          {can(FINANCE_ROLES) && <Field label="Estimated repair cost"><Input type="number" value={df.estimatedRepairCost} onChange={(e) => setDf({ ...df, estimatedRepairCost: e.target.value })} /></Field>}
          <Field label="Responsible"><Select value={df.responsible} onChange={(e) => setDf({ ...df, responsible: e.target.value })} options={meta?.damageResponsible || []} /></Field>
        </div>
        <ErrorBox error={damage.error} />
      </Modal>

      <Modal open={modal === "alteration"} onClose={() => setModal(null)} title={`Alteration · ${costume.assetNumber}`} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" disabled={!alf.issue || !alf.required || alteration.isPending} onClick={() => alteration.mutate()}>Request</button></>}>
        <div className="form-grid">
          <Field label="Issue" span2><Input value={alf.issue} onChange={(e) => setAlf({ ...alf, issue: e.target.value })} placeholder="Sleeves too long" autoFocus /></Field>
          <Field label="Required" span2><Input value={alf.required} onChange={(e) => setAlf({ ...alf, required: e.target.value })} placeholder="Reduce 1.5 inch" /></Field>
          <Field label="Tailor"><Input value={alf.tailorName} onChange={(e) => setAlf({ ...alf, tailorName: e.target.value })} /></Field>
          <Field label="Priority"><Select value={alf.priority} onChange={(e) => setAlf({ ...alf, priority: e.target.value })} options={meta?.priorities || []} /></Field>
          <Field label="Deadline" span2><Input type="datetime-local" value={alf.deadline} onChange={(e) => setAlf({ ...alf, deadline: e.target.value })} /></Field>
        </div>
        <ErrorBox error={alteration.error} />
      </Modal>

      <Modal open={modal === "missing"} onClose={() => setModal(null)} title={`Mark missing · ${costume.assetNumber}`} footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-danger" disabled={missing.isPending} onClick={() => missing.mutate()}>Mark missing</button></>}>
        <div className="col">
          <Field label="Last seen location"><Input value={mf.lastSeenLocation} onChange={(e) => setMf({ ...mf, lastSeenLocation: e.target.value })} /></Field>
          <Field label="Notes"><Textarea value={mf.notes} onChange={(e) => setMf({ ...mf, notes: e.target.value })} /></Field>
        </div>
        <ErrorBox error={missing.error} />
      </Modal>
    </>
  );
}

/* ---------- Create / edit costume ---------- */
const blank = { assetNumber: "", name: "", category: "CLOTHING", type: "", color: "", brand: "", size: "", fabric: "", quantity: "1", source: "PURCHASED", purchaseCost: "", rentalCostPerDay: "", vendorId: "", characterId: "", location: "Warehouse", careInstructions: "", notes: "" };
export type CostumeFormState = typeof blank;

export function CostumeFormModal({ open, onClose, initial, onSaved, defaultCharacterId }: { open: boolean; onClose: () => void; initial?: Costume | null; onSaved?: (c: Costume) => void; defaultCharacterId?: string | null }) {
  const { projectId, can, currency } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<CostumeFormState>(blank);
  const { data: characters } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")), enabled: open });
  const { data: vendors } = useQuery({ queryKey: ["vendors", projectId], queryFn: () => api<Vendor[]>(p(projectId, "/vendors")), enabled: open });
  useEffect(() => {
    if (!open) return;
    if (initial) setF({ assetNumber: initial.assetNumber, name: initial.name, category: initial.category, type: initial.type || "", color: initial.color || "", brand: initial.brand || "", size: initial.size || "", fabric: initial.fabric || "", quantity: String(initial.quantity || 1), source: initial.source, purchaseCost: initial.purchaseCost != null ? String(initial.purchaseCost) : "", rentalCostPerDay: initial.rentalCostPerDay != null ? String(initial.rentalCostPerDay) : "", vendorId: initial.vendorId || "", characterId: initial.characterId || "", location: initial.location, careInstructions: initial.careInstructions || "", notes: initial.notes || "" });
    else setF({ ...blank, characterId: defaultCharacterId || "" });
  }, [open, initial, defaultCharacterId]);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { ...f, assetNumber: f.assetNumber || undefined, quantity: Number(f.quantity) || 1, purchaseCost: f.purchaseCost ? Number(f.purchaseCost) : null, rentalCostPerDay: f.rentalCostPerDay ? Number(f.rentalCostPerDay) : null, vendorId: f.vendorId || null, characterId: f.characterId || null, type: f.type || null, color: f.color || null, brand: f.brand || null, size: f.size || null, fabric: f.fabric || null, careInstructions: f.careInstructions || null, notes: f.notes || null };
      if (!can(FINANCE_ROLES)) { delete body.purchaseCost; delete body.rentalCostPerDay; }
      return initial ? api<Costume>(p(projectId, `/costumes/${initial.id}`), { method: "PATCH", body }) : api<Costume>(p(projectId, "/costumes"), { body });
    },
    onSuccess: (c) => { qc.invalidateQueries(); toast.push(initial ? "Costume updated" : `${c.assetNumber} added`, "ok"); onSaved?.(c); onClose(); },
  });
  const types = meta?.costumeTypes?.[f.category] || [];
  return (
    <Modal open={open} onClose={onClose} title={initial ? `Edit ${initial.assetNumber}` : "New costume piece"} wide footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!f.name || save.isPending} onClick={() => save.mutate()}>{initial ? "Save" : "Add to inventory"}</button></>}>
      <div className="form-grid">
        <Field label="Asset number" help={initial ? undefined : "Leave blank to auto-generate (CST-000123)"}><Input value={f.assetNumber} onChange={(e) => setF({ ...f, assetNumber: e.target.value.toUpperCase() })} placeholder="auto" className="mono" /></Field>
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="White Formal Shirt" autoFocus /></Field>
        <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, type: "" })} options={meta?.costumeCategories || []} /></Field>
        <Field label="Type"><Select value={types.includes(f.type) ? f.type : f.type ? "__custom" : ""} onChange={(e) => setF({ ...f, type: e.target.value === "__custom" ? f.type : e.target.value })} options={[...types.map((t) => ({ value: t, label: t })), ...(f.type && !types.includes(f.type) ? [{ value: "__custom", label: f.type }] : [])]} placeholder="—" /><Input className="mt-1" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} placeholder="or type…" /></Field>
        <Field label="Colour"><Input value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></Field>
        <Field label="Size"><Input value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} /></Field>
        <Field label="Brand"><Input value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} /></Field>
        <Field label="Fabric"><Input value={f.fabric} onChange={(e) => setF({ ...f, fabric: e.target.value })} /></Field>
        <Field label="Character"><Select value={f.characterId} onChange={(e) => setF({ ...f, characterId: e.target.value })} options={(characters || []).map((c) => ({ value: c.id, label: c.name }))} placeholder="— unassigned —" /></Field>
        <Field label="Location"><Select value={(meta?.standardLocations as string[] | undefined)?.includes(f.location) ? f.location : "__custom"} onChange={(e) => e.target.value !== "__custom" && setF({ ...f, location: e.target.value })} options={[...(meta?.standardLocations || []), ...((meta?.standardLocations as string[] | undefined)?.includes(f.location) ? [] : [{ value: "__custom", label: f.location || "Custom" }])]} humanizeLabels={false} /><Input className="mt-1" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="Source"><Select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} options={meta?.costumeSources || []} /></Field>
        <Field label="Vendor"><Select value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })} options={(vendors || []).map((v) => ({ value: v.id, label: v.name }))} placeholder="—" /></Field>
        {can(FINANCE_ROLES) && <Field label={`Purchase cost (${currency})`}><Input type="number" value={f.purchaseCost} onChange={(e) => setF({ ...f, purchaseCost: e.target.value })} /></Field>}
        {can(FINANCE_ROLES) && <Field label={`Rental / day (${currency})`}><Input type="number" value={f.rentalCostPerDay} onChange={(e) => setF({ ...f, rentalCostPerDay: e.target.value })} /></Field>}
        <Field label="Quantity"><Input type="number" min={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
        <Field label="Care instructions"><Input value={f.careInstructions} onChange={(e) => setF({ ...f, careInstructions: e.target.value })} placeholder="Cold wash, no bleach" /></Field>
        <Field label="Notes" span2><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
