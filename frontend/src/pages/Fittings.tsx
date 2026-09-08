import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, OPS_ROLES } from "@/state/auth";
import { fmtDate, fmtTime } from "@/lib/format";
import type { Character, Costume, Fitting } from "@/api/types";
import { Badge, Card, Chips, Empty, ErrorBox, Field, Input, Modal, PageHead, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { Avatar, CostumePicker, CostumeRow } from "@/components/domain";

export default function Fittings() {
  const { projectId, can } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const [status, setStatus] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["fittings", projectId], queryFn: () => api<Fitting[]>(p(projectId, "/fittings")) });
  const { data: characters } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")) });
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(false);
  const [f, setF] = useState<{ characterId: string; scheduledAt: string; location: string; notes: string; costumes: Costume[] }>({ characterId: "", scheduledAt: "", location: "Wardrobe Truck", notes: "", costumes: [] });
  const create = useMutation({
    mutationFn: () => api<Fitting>(p(projectId, "/fittings"), { body: { characterId: f.characterId, scheduledAt: f.scheduledAt || new Date().toISOString(), location: f.location || null, notes: f.notes || null, costumeIds: f.costumes.map((c) => c.id) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fittings", projectId] }); setOpen(false); setF({ characterId: "", scheduledAt: "", location: "Wardrobe Truck", notes: "", costumes: [] }); toast.push("Fitting scheduled", "ok"); },
  });
  const list = (data || []).filter((x) => !status || x.status === status);
  return (
    <div>
      <PageHead title="Fittings" sub="Schedule fittings, tick off each piece, raise alterations on the spot." actions={can(OPS_ROLES) && <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Fitting</button>} />
      <div className="filters"><Chips all="All" options={(meta?.fittingStatuses || []).map((s) => ({ key: s, label: s.replace(/_/g, " ").toLowerCase() }))} value={status} onChange={setStatus} /></div>
      <Card pad0>
        {isLoading ? <Spinner /> : list.length === 0 ? <Empty icon="📏" title="No fittings" /> : (
          <div className="list">
            {list.map((x) => (
              <Link key={x.id} to={`${base}/fittings/${x.id}`} className="item link">
                <Avatar name={x.character.name} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="title">{x.character.name}{x.actor ? ` · ${x.actor.name}` : ""}</div>
                  <div className="meta">{fmtDate(x.scheduledAt)} {fmtTime(x.scheduledAt)}{x.location ? ` · ${x.location}` : ""} · {x.items.filter((i) => i.status === "FITTED").length}/{x.items.length} fitted{x.items.some((i) => i.status === "ALTERATION_REQUIRED") ? " · alteration needed" : ""}</div>
                </div>
                <div className="end"><Badge status={x.status} /></div>
              </Link>
            ))}
          </div>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Schedule fitting" footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!f.characterId || create.isPending} onClick={() => create.mutate()}>Schedule</button></>}>
        <div className="form-grid">
          <Field label="Character" span2><Select value={f.characterId} onChange={(e) => setF({ ...f, characterId: e.target.value, costumes: [] })} options={(characters || []).map((c) => ({ value: c.id, label: `${c.name}${c.actor ? ` (${c.actor.name})` : ""}` }))} placeholder="Select…" /></Field>
          <Field label="When"><Input type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} /></Field>
          <Field label="Where"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
          <Field label="Pieces to try" span2>
            <div className="list card flat pad-0">{f.costumes.map((c) => <CostumeRow key={c.id} c={c} onClick={() => setF({ ...f, costumes: f.costumes.filter((x) => x.id !== c.id) })} end={<span className="subtle">remove</span>} />)}</div>
            <button type="button" className="btn btn-sm mt-1" onClick={() => setPick(true)}><Plus size={14} /> Add piece</button>
          </Field>
          <Field label="Notes" span2><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <ErrorBox error={create.error} />
      </Modal>
      <CostumePicker open={pick} onClose={() => setPick(false)} onPick={(c) => setF({ ...f, costumes: f.costumes.some((x) => x.id === c.id) ? f.costumes : [...f.costumes, c] })} characterId={f.characterId || null} />
    </div>
  );
}
