import { Fragment, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, MANAGER_ROLES, OPS_ROLES } from "@/state/auth";
import { fmtDate, humanize } from "@/lib/format";
import type { Actor, Character, Costume, CostumeChange, Fitting, Photo } from "@/api/types";
import { Badge, Card, ConfirmButton, Empty, ErrorBox, Field, Input, Modal, PageHead, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { ActorSelect, Avatar, CostumePicker, CostumeRow, PhotoGrid } from "@/components/domain";

type CharacterDetailRow = { label: string; value: string };
type Detail = Character & { actor?: Actor | null; details?: CharacterDetailRow[]; scenes: { scene: { id: string; number: string; name?: string | null; shootDate?: string | null; status: string }; change?: { id: string; changeNumber: number; name: string } | null }[]; changes: (CostumeChange & { _count: { sceneCharacters: number } })[]; costumes: Costume[]; fittings: Fitting[]; photos: Photo[] };

export default function CharacterDetail() {
  const { id = "", sceneId = "" } = useParams();
  const { pathname } = useLocation();
  const { projectId, can } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const { data: ch, isLoading } = useQuery({ queryKey: ["character", id], queryFn: () => api<Detail>(p(projectId, `/characters/${id}`)) });
  const [newOpen, setNewOpen] = useState(false);
  const [nf, setNf] = useState<{ name: string; description: string; costumes: Costume[] }>({ name: "", description: "", costumes: [] });
  const [pick, setPick] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [ef, setEf] = useState({ name: "", type: "", actorId: "", age: "", description: "", notes: "", castNumber: "" });
  const [fitOpen, setFitOpen] = useState(false);
  const [fitPick, setFitPick] = useState(false);
  const [ff, setFf] = useState<{ scheduledAt: string; location: string; notes: string; costumes: Costume[] }>({ scheduledAt: "", location: "Wardrobe Truck", notes: "", costumes: [] });
  // -1 while adding a row, the row's index while editing one, null when the dialog is closed.
  const [detailAt, setDetailAt] = useState<number | null>(null);
  const [df, setDf] = useState<CharacterDetailRow>({ label: "", value: "" });

  const createChange = useMutation({
    mutationFn: () => api<CostumeChange>(p(projectId, "/changes"), { body: { characterId: id, name: nf.name, description: nf.description || null, costumeIds: nf.costumes.map((c) => c.id) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["character", id] }); setNewOpen(false); setNf({ name: "", description: "", costumes: [] }); toast.push("Change created", "ok"); },
  });
  const createFitting = useMutation({
    mutationFn: () => api<Fitting>(p(projectId, "/fittings"), { body: { characterId: id, scheduledAt: ff.scheduledAt || new Date().toISOString(), location: ff.location || null, notes: ff.notes || null, costumeIds: ff.costumes.map((c) => c.id) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["character", id] }); qc.invalidateQueries({ queryKey: ["fittings", projectId] }); setFitOpen(false); setFf({ scheduledAt: "", location: "Wardrobe Truck", notes: "", costumes: [] }); toast.push("Fitting scheduled", "ok"); },
  });
  /** The whole list travels with each save, so add, edit and delete are one code path. */
  const saveDetails = useMutation({
    mutationFn: (details: CharacterDetailRow[]) => api(p(projectId, `/characters/${id}`), { method: "PATCH", body: { details } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["character", id] }); setDetailAt(null); },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  const update = useMutation({
    mutationFn: () => api(p(projectId, `/characters/${id}`), { method: "PATCH", body: { name: ef.name, type: ef.type, actorId: ef.actorId || null, age: ef.age ? Number(ef.age) : null, description: ef.description || null, notes: ef.notes || null, castNumber: ef.castNumber ? Number(ef.castNumber) : null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["character", id] }); qc.invalidateQueries({ queryKey: ["characters", projectId] }); setEditOpen(false); toast.push("Saved", "ok"); },
  });

  if (isLoading || !ch) return <Spinner />;
  const raw = ch.actor?.measurements as unknown;
  const m: Record<string, string | number> = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : (raw as Record<string, string | number>) || {};

  const canEdit = can(MANAGER_ROLES);
  const canFit = can(OPS_ROLES);
  const viaScene = ch.scenes.find((s) => s.scene.id === sceneId);
  // With one scene there is nothing to choose, so the character opens straight onto their details.
  // "…/all" is the way past the picker for anyone who wants the whole character rather than one scene.
  const pickScene = !sceneId && !pathname.endsWith("/all") && ch.scenes.length > 1;
  const details = ch.details || [];
  const openDetail = (at: number) => { setDf(at < 0 ? { label: "", value: "" } : details[at]); setDetailAt(at); };
  const commitDetail = () => {
    const row = { label: df.label.trim(), value: df.value.trim() };
    saveDetails.mutate(detailAt === -1 ? [...details, row] : details.map((d, i) => (i === detailAt ? row : d)));
  };

  const head = (
    <span className="row gap-2"><Avatar name={ch.name} lg /><span>{ch.castNumber != null && <span className="mono muted">{ch.castNumber}. </span>}{ch.name} <Badge status={ch.type}>{humanize(ch.type)}</Badge></span></span>
  );
  const played = <>{ch.actor ? <>Played by <b>{ch.actor.name}</b></> : "No actor assigned"}{ch.age ? ` · age ${ch.age}` : ""}</>;

  // Step one for a character in several scenes: which scene are you dressing?
  if (pickScene) {
    return (
      <div>
        <PageHead crumbs={<><Link to={`${base}/characters`}>Characters</Link> / {ch.name}</>} title={head}
          sub={<>{played} · in {ch.scenes.length} scenes</>}
          actions={<Link to={`${base}/characters/${id}/all`} className="btn">Skip to full character</Link>} />
        <Card title="Pick a scene" pad0>
          <div className="list">
            {ch.scenes.map((sc) => (
              <Link key={sc.scene.id} to={`${base}/characters/${id}/scenes/${sc.scene.id}`} className="item link">
                <div className="avatar">{sc.scene.number}</div>
                <div className="grow"><div className="title">{sc.scene.name || `Scene ${sc.scene.number}`}</div><div className="meta">{sc.change ? `Change #${sc.change.changeNumber} ${sc.change.name}` : "No change assigned"}</div></div>
                <div className="end subtle">{sc.scene.shootDate ? fmtDate(sc.scene.shootDate) : ""}<Badge status={sc.scene.status} /></div>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHead
        crumbs={<><Link to={`${base}/characters`}>Characters</Link> / {ch.scenes.length > 1 ? <><Link to={`${base}/characters/${id}`}>{ch.name}</Link> / {viaScene ? `Sc ${viaScene.scene.number}` : "All scenes"}</> : ch.name}</>}
        title={<span className="row gap-2"><Avatar name={ch.name} lg /><span>{ch.castNumber != null && <span className="mono muted">{ch.castNumber}. </span>}{ch.name} <Badge status={ch.type}>{humanize(ch.type)}</Badge></span></span>}
        sub={<>{ch.actor ? <>Played by <b>{ch.actor.name}</b></> : "No actor assigned"}{ch.age ? ` · age ${ch.age}` : ""}{ch.description ? ` · ${ch.description}` : ""}</>}
        actions={can(MANAGER_ROLES) && <><button className="btn" onClick={() => { setEf({ name: ch.name, type: ch.type, actorId: ch.actorId || "", age: ch.age ? String(ch.age) : "", description: ch.description || "", notes: ch.notes || "", castNumber: ch.castNumber != null ? String(ch.castNumber) : "" }); setEditOpen(true); }}><Pencil size={16} /> Edit</button><button className="btn btn-primary" onClick={() => setNewOpen(true)}><Plus size={16} /> Change</button></>}
      />
      {viaScene && (
        <Card className="mb-2">
          <div className="row between wrap gap-2">
            <div><div className="bold">Scene {viaScene.scene.number} · {viaScene.scene.name || "Untitled"}</div><div className="subtle">{viaScene.change ? `Wears change #${viaScene.change.changeNumber} ${viaScene.change.name}` : "No change assigned for this scene"}</div></div>
            <Link to={`${base}/scenes/${viaScene.scene.id}`} className="btn btn-sm">Open scene</Link>
          </div>
        </Card>
      )}
      <div className="grid grid-2" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)" }}>
        <div className="col gap-2">
          <Card title="List of Scenes" pad0>
            {ch.scenes.length === 0 ? <Empty icon="🎬" title="Not in any scene yet" /> : (
              <div className="list">
                {ch.scenes.map((s) => (
                  <Link key={s.scene.id} to={`${base}/characters/${id}/scenes/${s.scene.id}`} className="item link" style={s.scene.id === sceneId ? { background: "var(--surface-2)" } : undefined}>
                    <div className="avatar">{s.scene.number}</div>
                    <div className="grow"><div className="title">{s.scene.name || `Scene ${s.scene.number}`}</div><div className="meta">{s.change ? `Change #${s.change.changeNumber} ${s.change.name}` : "No change assigned"}</div></div>
                    <div className="end subtle">{s.scene.shootDate ? fmtDate(s.scene.shootDate) : ""}<Badge status={s.scene.status} /></div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
          <Card title={`Costume Changes (${ch.changes.length})`}>
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
          <Card title="References"><PhotoGrid photos={ch.photos} entityType="CHARACTER" entityId={ch.id} kinds={["REFERENCE", "FRONT", "SIDE", "BACK", "DETAIL", "DOCUMENT", "OTHER"]} /></Card>
          <Card title="Fittings" pad0>
            {ch.fittings.length === 0 ? (
              <div style={{ padding: 14 }}>
                <div className="subtle">No fittings.</div>
                {canFit && <button className="btn btn-sm mt-2" onClick={() => setFitOpen(true)}><Plus size={14} /> Schedule fitting</button>}
              </div>
            ) : (
              <div className="list">{ch.fittings.map((f) => <Link key={f.id} to={`${base}/fittings/${f.id}`} className="item link"><div className="grow"><div className="title small">{fmtDate(f.scheduledAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div><div className="meta">{f.items.length} piece{f.items.length === 1 ? "" : "s"}{f.location ? ` · ${f.location}` : ""}</div></div><Badge status={f.status} /></Link>)}</div>
            )}
          </Card>
          <Card title="More details" actions={canEdit && <button className="btn btn-sm" onClick={() => openDetail(-1)}><Plus size={14} /> Add more</button>} pad0>
            {details.length === 0 ? <div className="subtle" style={{ padding: 14 }}>Nothing yet. Add any detail this production tracks — wig, tattoo cover, prop watch, dresser.</div> : (
              <div className="list">
                {details.map((d, i) => (
                  <div key={`${d.label}-${i}`} className="item">
                    <div className="grow" style={{ minWidth: 0 }}><div className="title small">{d.label}</div><div className="meta" style={{ whiteSpace: "pre-wrap" }}>{d.value}</div></div>
                    {canEdit && (
                      <div className="row gap-1">
                        <button className="btn btn-ghost btn-sm" aria-label={`Edit ${d.label}`} onClick={() => openDetail(i)}><Pencil size={14} /></button>
                        <ConfirmButton className="btn btn-ghost btn-sm" confirmText="Delete?" onConfirm={() => saveDetails.mutate(details.filter((_, x) => x !== i))}><Trash2 size={14} /></ConfirmButton>
                      </div>
                    )}
                  </div>
                ))}
              </div>
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

      <Modal open={detailAt !== null} onClose={() => setDetailAt(null)} title={detailAt === -1 ? "Add detail" : "Edit detail"}
        footer={<><button className="btn" onClick={() => setDetailAt(null)}>Cancel</button><button className="btn btn-primary" disabled={!df.label.trim() || !df.value.trim() || saveDetails.isPending} onClick={commitDetail}>Save</button></>}>
        <div className="col">
          <Field label="Title" help="Name the field yourself — anything the department needs to remember"><Input value={df.label} onChange={(e) => setDf({ ...df, label: e.target.value })} placeholder="e.g. Wig, Tattoo cover, Dresser" autoFocus /></Field>
          <Field label="Description"><Textarea value={df.value} onChange={(e) => setDf({ ...df, value: e.target.value })} placeholder="e.g. Short crop, hired from Anand Wigs" /></Field>
        </div>
        <ErrorBox error={saveDetails.error} />
      </Modal>

      <Modal open={fitOpen} onClose={() => setFitOpen(false)} title={`Schedule fitting for ${ch.name}`} footer={<><button className="btn" onClick={() => setFitOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={createFitting.isPending} onClick={() => createFitting.mutate()}>Schedule</button></>}>
        <div className="form-grid">
          <Field label="When" help="Leave empty to book it for now"><Input type="datetime-local" value={ff.scheduledAt} onChange={(e) => setFf({ ...ff, scheduledAt: e.target.value })} /></Field>
          <Field label="Where"><Input value={ff.location} onChange={(e) => setFf({ ...ff, location: e.target.value })} /></Field>
          <Field label="Pieces to try" span2>
            <div className="list card flat pad-0">{ff.costumes.map((c) => <CostumeRow key={c.id} c={c} onClick={() => setFf({ ...ff, costumes: ff.costumes.filter((x) => x.id !== c.id) })} end={<span className="subtle">remove</span>} />)}</div>
            <button type="button" className="btn btn-sm mt-1" onClick={() => setFitPick(true)}><Plus size={14} /> Add piece</button>
          </Field>
          <Field label="Notes" span2><Textarea value={ff.notes} onChange={(e) => setFf({ ...ff, notes: e.target.value })} /></Field>
        </div>
        <ErrorBox error={createFitting.error} />
      </Modal>
      <CostumePicker open={fitPick} onClose={() => setFitPick(false)} onPick={(c) => setFf({ ...ff, costumes: ff.costumes.some((x) => x.id === c.id) ? ff.costumes : [...ff.costumes, c] })} characterId={ch.id} />

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit character" footer={<><button className="btn" onClick={() => setEditOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={update.isPending} onClick={() => update.mutate()}>Save</button></>}>
        <div className="form-grid">
          <Field label="Name" span2><Input value={ef.name} onChange={(e) => setEf({ ...ef, name: e.target.value })} /></Field>
          <Field label="Type"><Select value={ef.type} onChange={(e) => setEf({ ...ef, type: e.target.value })} options={meta?.characterTypes || []} /></Field>
          <Field label="Age"><Input type="number" value={ef.age} onChange={(e) => setEf({ ...ef, age: e.target.value })} /></Field>
          <Field label="Cast number"><Input type="number" value={ef.castNumber} onChange={(e) => setEf({ ...ef, castNumber: e.target.value })} /></Field>
          <Field label="Actor" span2><ActorSelect value={ef.actorId} onChange={(actorId) => setEf({ ...ef, actorId })} /></Field>
          <Field label="Description" span2><Textarea value={ef.description} onChange={(e) => setEf({ ...ef, description: e.target.value })} /></Field>
          <Field label="Notes" span2><Textarea value={ef.notes} onChange={(e) => setEf({ ...ef, notes: e.target.value })} /></Field>
        </div>
        <ErrorBox error={update.error} />
      </Modal>
    </div>
  );
}
