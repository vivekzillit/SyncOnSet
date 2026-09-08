import { Fragment, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, MANAGER_ROLES } from "@/state/auth";
import { fmtDate, humanize } from "@/lib/format";
import type { Actor, Character, Costume, CostumeChange, Fitting, Photo } from "@/api/types";
import { Badge, Card, Empty, ErrorBox, Field, Input, Modal, PageHead, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { Avatar, CostumePicker, CostumeRow, PhotoGrid } from "@/components/domain";

type Detail = Character & { actor?: Actor | null; scenes: { scene: { id: string; number: string; name?: string | null; shootDate?: string | null; status: string }; change?: { id: string; changeNumber: number; name: string } | null }[]; changes: (CostumeChange & { _count: { sceneCharacters: number } })[]; costumes: Costume[]; fittings: Fitting[]; photos: Photo[] };

export default function CharacterDetail() {
  const { id = "" } = useParams();
  const { projectId, can } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const { data: ch, isLoading } = useQuery({ queryKey: ["character", id], queryFn: () => api<Detail>(p(projectId, `/characters/${id}`)) });
  const { data: actors } = useQuery({ queryKey: ["actors", projectId], queryFn: () => api<Actor[]>(p(projectId, "/actors")) });
  const [newOpen, setNewOpen] = useState(false);
  const [nf, setNf] = useState<{ name: string; description: string; costumes: Costume[] }>({ name: "", description: "", costumes: [] });
  const [pick, setPick] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [ef, setEf] = useState({ name: "", type: "", actorId: "", age: "", description: "", notes: "", castNumber: "" });

  const createChange = useMutation({
    mutationFn: () => api<CostumeChange>(p(projectId, "/changes"), { body: { characterId: id, name: nf.name, description: nf.description || null, costumeIds: nf.costumes.map((c) => c.id) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["character", id] }); setNewOpen(false); setNf({ name: "", description: "", costumes: [] }); toast.push("Change created", "ok"); },
  });
  const update = useMutation({
    mutationFn: () => api(p(projectId, `/characters/${id}`), { method: "PATCH", body: { name: ef.name, type: ef.type, actorId: ef.actorId || null, age: ef.age ? Number(ef.age) : null, description: ef.description || null, notes: ef.notes || null, castNumber: ef.castNumber ? Number(ef.castNumber) : null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["character", id] }); qc.invalidateQueries({ queryKey: ["characters", projectId] }); setEditOpen(false); toast.push("Saved", "ok"); },
  });

  if (isLoading || !ch) return <Spinner />;
  const raw = ch.actor?.measurements as unknown;
  const m: Record<string, string | number> = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : (raw as Record<string, string | number>) || {};

  return (
    <div>
      <PageHead
        crumbs={<><Link to={`${base}/characters`}>Characters</Link> / {ch.name}</>}
        title={<span className="row gap-2"><Avatar name={ch.name} lg /><span>{ch.castNumber != null && <span className="mono muted">{ch.castNumber}. </span>}{ch.name} <Badge status={ch.type}>{humanize(ch.type)}</Badge></span></span>}
        sub={<>{ch.actor ? <>Played by <b>{ch.actor.name}</b></> : "No actor assigned"}{ch.age ? ` · age ${ch.age}` : ""}{ch.description ? ` · ${ch.description}` : ""}</>}
        actions={can(MANAGER_ROLES) && <><button className="btn" onClick={() => { setEf({ name: ch.name, type: ch.type, actorId: ch.actorId || "", age: ch.age ? String(ch.age) : "", description: ch.description || "", notes: ch.notes || "", castNumber: ch.castNumber != null ? String(ch.castNumber) : "" }); setEditOpen(true); }}><Pencil size={16} /> Edit</button><button className="btn btn-primary" onClick={() => setNewOpen(true)}><Plus size={16} /> Change</button></>}
      />
      <div className="grid grid-2" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)" }}>
        <div className="col gap-2">
          <Card title={`Changes / looks (${ch.changes.length})`}>
            {ch.changes.length === 0 ? <Empty icon="👗" title="No changes yet" hint="A change is a numbered outfit for this character. Add one, then attach costume pieces." /> : (
              <div className="col gap-2">
                {ch.changes.map((c) => (
                  <Link key={c.id} to={`${base}/changes/${c.id}`} className="card flat" style={{ padding: 12 }}>
                    <div className="row between">
                      <div className="bold">Change #{c.changeNumber} · {c.name}</div>
                      <span className="subtle">{c._count.sceneCharacters} scene{c._count.sceneCharacters === 1 ? "" : "s"}</span>
                    </div>
                    {c.description && <div className="subtle mt-1">{c.description}</div>}
                    <div className="chips mt-2">
                      {c.items.map((it) => <Badge key={it.id} status={it.costume.status}><span className="mono">{it.costume.assetNumber}</span> {it.costume.name}</Badge>)}
                      {c.items.length === 0 && <span className="subtle">No pieces attached</span>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
          <Card title={`Scenes (${ch.scenes.length})`} pad0>
            {ch.scenes.length === 0 ? <Empty icon="🎬" title="Not in any scene yet" /> : (
              <div className="list">
                {ch.scenes.map((s) => (
                  <Link key={s.scene.id} to={`${base}/scenes/${s.scene.id}`} className="item link">
                    <div className="avatar">{s.scene.number}</div>
                    <div className="grow"><div className="title">{s.scene.name || `Scene ${s.scene.number}`}</div><div className="meta">{s.change ? `Change #${s.change.changeNumber} ${s.change.name}` : "No change assigned"}</div></div>
                    <div className="end subtle">{s.scene.shootDate ? fmtDate(s.scene.shootDate) : ""}<Badge status={s.scene.status} /></div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
          <Card title={`All pieces (${ch.costumes.length})`} pad0>
            {ch.costumes.length === 0 ? <Empty title="No costumes tagged to this character" /> : <div className="list">{ch.costumes.map((c) => <CostumeRow key={c.id} c={c} />)}</div>}
          </Card>
        </div>
        <div className="col gap-2">
          <Card title="Actor & measurements">
            {ch.actor ? (
              <>
                <div className="row gap-2 mb-2"><Avatar name={ch.actor.name} /><div><div className="bold">{ch.actor.name}</div><div className="subtle">{[ch.actor.phone, ch.actor.agency].filter(Boolean).join(" · ")}</div></div></div>
                {Object.keys(m).length ? <dl className="kv">{Object.entries(m).map(([k, v]) => <Fragment key={k}><dt>{humanize(k)}</dt><dd>{String(v)}</dd></Fragment>)}</dl> : <div className="subtle">No measurements recorded.</div>}
                {ch.actor.notes && <div className="notice mt-2">{ch.actor.notes}</div>}
              </>
            ) : <div className="subtle">No actor assigned.</div>}
          </Card>
          <Card title="Reference photos"><PhotoGrid photos={ch.photos} entityType="CHARACTER" entityId={ch.id} kinds={["FRONT", "SIDE", "BACK", "DETAIL", "OTHER"]} /></Card>
          <Card title="Fittings" pad0>
            {ch.fittings.length === 0 ? <div className="subtle" style={{ padding: 14 }}>No fittings.</div> : (
              <div className="list">{ch.fittings.map((f) => <Link key={f.id} to={`${base}/fittings/${f.id}`} className="item link"><div className="grow"><div className="title small">{fmtDate(f.scheduledAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div><div className="meta">{f.items.length} pieces{f.location ? ` · ${f.location}` : ""}</div></div><Badge status={f.status} /></Link>)}</div>
            )}
          </Card>
          {ch.notes && <Card title="Notes"><div className="small">{ch.notes}</div></Card>}
        </div>
      </div>

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title={`New change for ${ch.name}`} footer={<><button className="btn" onClick={() => setNewOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!nf.name || createChange.isPending} onClick={() => createChange.mutate()}>Create</button></>}>
        <div className="col">
          <Field label="Name" help="e.g. Restaurant - white shirt & jeans"><Input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} /></Field>
          <Field label="Description / wear notes"><Textarea value={nf.description} onChange={(e) => setNf({ ...nf, description: e.target.value })} /></Field>
          <Field label="Pieces">
            <div className="list card flat pad-0">{nf.costumes.map((c) => <CostumeRow key={c.id} c={c} onClick={() => setNf({ ...nf, costumes: nf.costumes.filter((x) => x.id !== c.id) })} end={<span className="subtle">remove</span>} />)}</div>
            <button type="button" className="btn btn-sm mt-1" onClick={() => setPick(true)}><Plus size={14} /> Add piece</button>
          </Field>
        </div>
        <ErrorBox error={createChange.error} />
      </Modal>
      <CostumePicker open={pick} onClose={() => setPick(false)} onPick={(c) => setNf({ ...nf, costumes: nf.costumes.some((x) => x.id === c.id) ? nf.costumes : [...nf.costumes, c] })} characterId={ch.id} />

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit character" footer={<><button className="btn" onClick={() => setEditOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={update.isPending} onClick={() => update.mutate()}>Save</button></>}>
        <div className="form-grid">
          <Field label="Name" span2><Input value={ef.name} onChange={(e) => setEf({ ...ef, name: e.target.value })} /></Field>
          <Field label="Type"><Select value={ef.type} onChange={(e) => setEf({ ...ef, type: e.target.value })} options={meta?.characterTypes || []} /></Field>
          <Field label="Age"><Input type="number" value={ef.age} onChange={(e) => setEf({ ...ef, age: e.target.value })} /></Field>
          <Field label="Cast number"><Input type="number" value={ef.castNumber} onChange={(e) => setEf({ ...ef, castNumber: e.target.value })} /></Field>
          <Field label="Actor" span2><Select value={ef.actorId} onChange={(e) => setEf({ ...ef, actorId: e.target.value })} options={(actors || []).map((a) => ({ value: a.id, label: a.name }))} placeholder="— unassigned —" /></Field>
          <Field label="Description" span2><Textarea value={ef.description} onChange={(e) => setEf({ ...ef, description: e.target.value })} /></Field>
          <Field label="Notes" span2><Textarea value={ef.notes} onChange={(e) => setEf({ ...ef, notes: e.target.value })} /></Field>
        </div>
        <ErrorBox error={update.error} />
      </Modal>
    </div>
  );
}
