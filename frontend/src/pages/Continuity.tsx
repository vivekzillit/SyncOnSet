import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { CONTINUITY_ROLES } from "@/state/auth";
import { dateKey, fmtDateTime, todayISO } from "@/lib/format";
import type { ContinuityRecord, Scene } from "@/api/types";
import { Badge, Card, Chips, Empty, ErrorBox, Field, Input, Modal, PageHead, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { PhotoGrid } from "@/components/domain";

const DEFAULT_DETAILS = ["Shirt", "Sleeves", "Collar", "Trousers", "Hair", "Accessories"];

export default function Continuity() {
  const { projectId, can } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const [sp, setSp] = useSearchParams();
  const { data: scenes } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });
  const sceneId = sp.get("sceneId") || "";
  const characterId = sp.get("characterId") || "";
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k === "sceneId") n.delete("characterId"); setSp(n, { replace: true }); };

  useEffect(() => {
    if (!sceneId && scenes?.length) {
      const today = todayISO();
      const pick = scenes.find((s) => s.status === "SHOOTING") || scenes.find((s) => dateKey(s.shootDate) === today) || scenes[0];
      set("sceneId", pick.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, sceneId]);

  const { data: scene } = useQuery({ queryKey: ["scene", sceneId], queryFn: () => api<Scene>(p(projectId, `/scenes/${sceneId}`)), enabled: !!sceneId });
  useEffect(() => {
    if (scene && !characterId && scene.characters.length) set("characterId", scene.characters[0].characterId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, characterId]);

  const { data: cmp, isLoading } = useQuery({
    queryKey: ["continuity", projectId, sceneId, characterId],
    queryFn: () => api<{ records: ContinuityRecord[]; flags: { take: number; message: string }[] }>(p(projectId, `/continuity/compare?sceneId=${sceneId}&characterId=${characterId}`)),
    enabled: !!sceneId && !!characterId,
  });
  const { data: photosAll } = useQuery({ queryKey: ["continuity-photos", projectId, sceneId, characterId], queryFn: () => api<ContinuityRecord[]>(p(projectId, `/continuity?sceneId=${sceneId}&characterId=${characterId}`)), enabled: !!sceneId && !!characterId });
  const photosByRecord = useMemo(() => new Map((photosAll || []).map((r) => [r.id, r.photos || []])), [photosAll]);

  const sc = scene?.characters.find((c) => c.characterId === characterId);
  const records = cmp?.records || [];
  const last = records[records.length - 1];

  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ takeNumber: string; details: { k: string; v: string }[]; accessories: { name: string; present: boolean }[]; notes: string }>({ takeNumber: "1", details: [], accessories: [], notes: "" });
  const openNew = () => {
    const details = last ? Object.entries(last.details).map(([k, v]) => ({ k, v })) : DEFAULT_DETAILS.map((k) => ({ k, v: "" }));
    const accessories = last ? last.accessories.map((a) => ({ ...a })) : (sc?.change?.items || []).filter((i) => ["ACCESSORY", "JEWELLERY"].includes(i.costume.category)).map((i) => ({ name: i.costume.name, present: true }));
    setF({ takeNumber: String((last?.takeNumber || 0) + 1), details, accessories, notes: "" });
    setOpen(true);
  };
  const create = useMutation({
    mutationFn: () => api<ContinuityRecord>(p(projectId, "/continuity"), { body: { sceneId, characterId, changeId: sc?.changeId || null, takeNumber: Number(f.takeNumber), notes: f.notes || null, details: Object.fromEntries(f.details.filter((d) => d.k.trim()).map((d) => [d.k.trim(), d.v])), accessories: f.accessories.filter((a) => a.name.trim()) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["continuity"] }); qc.invalidateQueries({ queryKey: ["continuity-photos"] }); qc.invalidateQueries({ queryKey: ["scene", sceneId] }); setOpen(false); toast.push("Take recorded — add photos below", "ok"); },
  });
  const del = useMutation({ mutationFn: (id: string) => api(p(projectId, `/continuity/${id}`), { method: "DELETE" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["continuity"] }); qc.invalidateQueries({ queryKey: ["continuity-photos"] }); } });

  return (
    <div>
      <PageHead title="Continuity book" sub="Per scene, per character, per take: what they wore and how." actions={can(CONTINUITY_ROLES) && sceneId && characterId && <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Record take</button>} />
      <div className="filters">
        <Select value={sceneId} onChange={(e) => set("sceneId", e.target.value)} options={(scenes || []).map((s) => ({ value: s.id, label: `Sc ${s.number}${s.name ? ` · ${s.name}` : ""}` }))} placeholder="Select scene" style={{ minWidth: 240 }} />
        {scene && <Chips options={scene.characters.map((c) => ({ key: c.characterId, label: c.character.name }))} value={characterId} onChange={(v) => set("characterId", v)} />}
      </div>
      {scene && sc && (
        <div className="notice info mb-2">
          <b>{sc.character.name}</b> in Sc {scene.number}: {sc.change ? <Link to={`${base}/changes/${sc.change.id}`}><u>Change #{sc.change.changeNumber} {sc.change.name}</u></Link> : "no change assigned"}
          {sc.change?.items?.length ? <> — {sc.change.items.map((i) => `${i.costume.name}${i.wearNotes ? ` (${i.wearNotes})` : ""}`).join(", ")}</> : null}
        </div>
      )}
      {cmp?.flags.length ? (
        <div className="notice mb-2"><div className="row gap-1 bold"><AlertTriangle size={16} /> Continuity flags</div><ul style={{ margin: "6px 0 0 18px" }}>{cmp.flags.map((fl, i) => <li key={i}>Take {fl.take}: {fl.message}</li>)}</ul></div>
      ) : null}
      {!sceneId || !characterId ? <Empty icon="📖" title="Pick a scene and character" /> : isLoading ? <Spinner /> : records.length === 0 ? <Card><Empty icon="📖" title="No takes recorded yet" hint="Record Take 1 with wear details and accessories; later takes are pre-filled and compared automatically." /></Card> : (
        <div className="grid grid-auto">
          {records.map((r) => (
            <Card key={r.id} title={`Take ${r.takeNumber}`} actions={<div className="row gap-1">{cmp?.flags.some((fl) => fl.take === r.takeNumber) && <Badge status="WARNING">flagged</Badge>}{can(CONTINUITY_ROLES) && <button className="btn btn-ghost btn-sm" onClick={() => del.mutate(r.id)} title="Delete"><Trash2 size={14} /></button>}</div>}>
              <div className="subtle mb-2">{fmtDateTime(r.createdAt)}{r.recordedByName ? ` · ${r.recordedByName}` : ""}</div>
              <PhotoGrid photos={photosByRecord.get(r.id) || []} entityType="CONTINUITY" entityId={r.id} kinds={["FRONT", "SIDE", "BACK", "CLOSEUP"]} compact />
              <dl className="kv mt-2" style={{ gridTemplateColumns: "100px 1fr" }}>
                {Object.entries(r.details).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v || "—"}</dd></Fragment>)}
              </dl>
              {r.accessories.length > 0 && <div className="chips mt-2">{r.accessories.map((a) => <span key={a.name} className={`badge tone-${a.present ? "ok" : "danger"}`}>{a.present ? "✓" : "✗"} {a.name}</span>)}</div>}
              {r.notes && <div className="notice mt-2">{r.notes}</div>}
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={`Record take · ${sc?.character.name || ""} · Sc ${scene?.number || ""}`} footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!f.takeNumber || create.isPending} onClick={() => create.mutate()}>Save take</button></>}>
        <div className="col">
          <Field label="Take number"><Input type="number" min={1} value={f.takeNumber} onChange={(e) => setF({ ...f, takeNumber: e.target.value })} /></Field>
          <Field label="Wear details" help={last ? `Pre-filled from Take ${last.takeNumber}` : undefined}>
            <div className="col gap-1">
              {f.details.map((d, i) => (
                <div key={i} className="row gap-1"><Input value={d.k} onChange={(e) => setF({ ...f, details: f.details.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)) })} placeholder="Sleeves" style={{ maxWidth: 140 }} /><Input value={d.v} onChange={(e) => setF({ ...f, details: f.details.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)) })} placeholder="Rolled twice" /><button type="button" className="btn btn-ghost btn-sm" onClick={() => setF({ ...f, details: f.details.filter((_, j) => j !== i) })}><Trash2 size={14} /></button></div>
              ))}
              <button type="button" className="btn btn-sm" onClick={() => setF({ ...f, details: [...f.details, { k: "", v: "" }] })}><Plus size={14} /> Detail</button>
            </div>
          </Field>
          <Field label="Accessories">
            <div className="col gap-1">
              {f.accessories.map((a, i) => (
                <div key={i} className="row gap-1"><label className="check"><input type="checkbox" checked={a.present} onChange={(e) => setF({ ...f, accessories: f.accessories.map((x, j) => (j === i ? { ...x, present: e.target.checked } : x)) })} /></label><Input value={a.name} onChange={(e) => setF({ ...f, accessories: f.accessories.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="Watch" /><button type="button" className="btn btn-ghost btn-sm" onClick={() => setF({ ...f, accessories: f.accessories.filter((_, j) => j !== i) })}><Trash2 size={14} /></button></div>
              ))}
              <button type="button" className="btn btn-sm" onClick={() => setF({ ...f, accessories: [...f.accessories, { name: "", present: true }] })}><Plus size={14} /> Accessory</button>
            </div>
          </Field>
          <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Coffee spill at end of take…" /></Field>
        </div>
        <ErrorBox error={create.error} />
      </Modal>
    </div>
  );
}
