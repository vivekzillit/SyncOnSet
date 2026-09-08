import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, MANAGER_ROLES } from "@/state/auth";
import { humanize } from "@/lib/format";
import type { Actor, Character } from "@/api/types";
import { Badge, Card, Empty, ErrorBox, Field, Input, Modal, PageHead, Select, Spinner, Tabs, Textarea, useToast } from "@/components/ui";
import { ActorSelect, Avatar } from "@/components/domain";
import { initials } from "@/components/ui";

const MEASURES = ["height", "chest", "bust", "waist", "hips", "inseam", "sleeve", "collar", "shoe", "head"];

export default function Characters() {
  const { projectId, can } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<"characters" | "actors">("characters");
  const { data: characters, isLoading } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")) });
  const { data: actors } = useQuery({ queryKey: ["actors", projectId], queryFn: () => api<Actor[]>(p(projectId, "/actors")) });
  const [charOpen, setCharOpen] = useState(false);
  const [actorOpen, setActorOpen] = useState(false);
  const [cf, setCf] = useState({ name: "", type: "SUPPORTING", actorId: "", age: "", description: "", castNumber: "" });
  const [af, setAf] = useState<{ name: string; phone: string; email: string; agency: string; notes: string; measurements: Record<string, string> }>({ name: "", phone: "", email: "", agency: "", notes: "", measurements: {} });

  const createChar = useMutation({
    mutationFn: () => api(p(projectId, "/characters"), { body: { name: cf.name, type: cf.type, actorId: cf.actorId || null, age: cf.age ? Number(cf.age) : null, description: cf.description || null, castNumber: cf.castNumber ? Number(cf.castNumber) : null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["characters", projectId] }); setCharOpen(false); setCf({ name: "", type: "SUPPORTING", actorId: "", age: "", description: "", castNumber: "" }); toast.push("Character created", "ok"); },
  });
  const createActor = useMutation({
    mutationFn: () => api(p(projectId, "/actors"), { body: { ...af, measurements: Object.fromEntries(Object.entries(af.measurements).filter(([, v]) => v)) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["actors", projectId] }); setActorOpen(false); setAf({ name: "", phone: "", email: "", agency: "", notes: "", measurements: {} }); toast.push("Actor added", "ok"); },
  });

  return (
    <div>
      <PageHead title="Characters" sub="Who wears what. Cast numbers appear on sides and call sheets." actions={<><Link to={`/p/${projectId}/actors`} className="btn">★ Actors</Link>{can(MANAGER_ROLES) && (tab === "characters" ? <button className="btn btn-primary" onClick={() => setCharOpen(true)}><Plus size={16} /> Character</button> : <button className="btn btn-primary" onClick={() => setActorOpen(true)}><Plus size={16} /> Actor</button>)}</>} />
      <Tabs tabs={[{ key: "characters", label: `Characters (${characters?.length ?? 0})` }, { key: "actors", label: `Actors (${actors?.length ?? 0})` }]} value={tab} onChange={setTab} />
      {tab === "characters" ? (
        <Card pad0>
          {isLoading ? <Spinner /> : !characters?.length ? <Empty icon="🧍" title="No characters yet" /> : (
            <div className="list">
              {characters.map((c) => (
                <Link key={c.id} to={`/p/${projectId}/characters/${c.id}`} className="item link">
                  <div className="avatar">{c.castNumber != null ? c.castNumber : initials(c.name)}</div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row gap-1"><span className="title">{c.name}</span><Badge status={c.type}>{humanize(c.type)}</Badge></div>
                    <div className="meta">{c.actor?.name || "No actor assigned"}{c.age ? ` · age ${c.age}` : ""}</div>
                  </div>
                  <div className="end subtle hide-mobile">{c._count?.scenes} scenes · {c._count?.changes} changes · {c._count?.costumes} pieces</div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      ) : (
        <Card pad0>
          {!actors ? <Spinner /> : actors.length === 0 ? <Empty icon="🎭" title="No actors yet" /> : (
            <div className="list">
              {actors.map((a) => (
                <div key={a.id} className="item">
                  <Avatar name={a.name} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="title">{a.name}</div>
                    <div className="meta">{(a.characters || []).map((c) => c.name).join(", ") || "No character"}{a.phone ? ` · ${a.phone}` : ""}</div>
                    <div className="subtle truncate">{Object.entries(a.measurements || {}).map(([k, v]) => `${k} ${v}`).join(" · ")}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Modal open={charOpen} onClose={() => setCharOpen(false)} title="New character" footer={<><button className="btn" onClick={() => setCharOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!cf.name || createChar.isPending} onClick={() => createChar.mutate()}>Create</button></>}>
        <div className="form-grid">
          <Field label="Name" span2><Input value={cf.name} onChange={(e) => setCf({ ...cf, name: e.target.value })} /></Field>
          <Field label="Type"><Select value={cf.type} onChange={(e) => setCf({ ...cf, type: e.target.value })} options={meta?.characterTypes || []} /></Field>
          <Field label="Age"><Input type="number" value={cf.age} onChange={(e) => setCf({ ...cf, age: e.target.value })} /></Field>
          <Field label="Cast number" help="As on call sheets and sides"><Input type="number" value={cf.castNumber} onChange={(e) => setCf({ ...cf, castNumber: e.target.value })} /></Field>
          <Field label="Actor" span2><ActorSelect value={cf.actorId} onChange={(actorId) => setCf({ ...cf, actorId })} /></Field>
          <Field label="Description" span2><Textarea value={cf.description} onChange={(e) => setCf({ ...cf, description: e.target.value })} placeholder="Look, palette, references…" /></Field>
        </div>
        <ErrorBox error={createChar.error} />
      </Modal>
      <Modal open={actorOpen} onClose={() => setActorOpen(false)} title="New actor" footer={<><button className="btn" onClick={() => setActorOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!af.name || createActor.isPending} onClick={() => createActor.mutate()}>Add</button></>}>
        <div className="form-grid">
          <Field label="Name" span2><Input value={af.name} onChange={(e) => setAf({ ...af, name: e.target.value })} /></Field>
          <Field label="Phone"><Input value={af.phone} onChange={(e) => setAf({ ...af, phone: e.target.value })} /></Field>
          <Field label="Email"><Input value={af.email} onChange={(e) => setAf({ ...af, email: e.target.value })} /></Field>
          <Field label="Agency" span2><Input value={af.agency} onChange={(e) => setAf({ ...af, agency: e.target.value })} /></Field>
          <div className="span-2 bold small">Measurements</div>
          {MEASURES.map((m) => (
            <Field key={m} label={humanize(m)}><Input value={af.measurements[m] || ""} onChange={(e) => setAf({ ...af, measurements: { ...af.measurements, [m]: e.target.value } })} /></Field>
          ))}
          <Field label="Notes" span2><Textarea value={af.notes} onChange={(e) => setAf({ ...af, notes: e.target.value })} placeholder="Allergies, preferences…" /></Field>
        </div>
        <ErrorBox error={createActor.error} />
      </Modal>
    </div>
  );
}
