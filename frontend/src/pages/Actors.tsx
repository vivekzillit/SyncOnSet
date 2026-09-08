import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, MoreVertical } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, MANAGER_ROLES } from "@/state/auth";
import { fmtDate, fmtDateTime, humanize, toLocalInput } from "@/lib/format";
import type { Character } from "@/api/types";
import { Card, ConfirmButton, Empty, ErrorBox, Field, Input, Modal, PageHead, SearchBox, Select, Spinner, Textarea, useToast } from "@/components/ui";

interface ActorRow { id: string; name: string; gender?: string | null; age?: number | null; phone?: string | null; phone2?: string | null; email?: string | null; email2?: string | null; agency?: string | null; startWorkDate?: string | null; nextFittingAt?: string | null; nextFitting?: string | null; nextFittingId?: string | null; fittingComment?: string | null; notes?: string | null; measurements: Record<string, string | number>; characters: { id: string; name: string; castNumber?: number | null }[] }
const MEASURES = ["height", "chest", "bust", "waist", "hips", "inseam", "sleeve", "collar", "shoe", "head"];
const blank = { first: "", last: "", gender: "", age: "", characterIds: [] as string[], notes: "", nextFittingAt: "", fittingComment: "", phone: "", phone2: "", email: "", email2: "", startWorkDate: "", agency: "", measurements: {} as Record<string, string> };

/** SyncOnSet-style Actors page: table + Create Actor form. */
export default function Actors() {
  const { projectId, can } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["actors", projectId], queryFn: () => api<ActorRow[]>(p(projectId, "/actors")) });
  const { data: characters } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")) });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ActorRow | null>(null);
  const [f, setF] = useState(blank);
  const [addAnother, setAddAnother] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const canEdit = can(MANAGER_ROLES);

  const openCreate = () => { setEditing(null); setF(blank); setOpen(true); };
  const openEdit = (a: ActorRow) => {
    const [first, ...rest] = a.name.split(" ");
    setEditing(a);
    setF({ first, last: rest.join(" "), gender: a.gender || "", age: a.age != null ? String(a.age) : "", characterIds: a.characters.map((c) => c.id), notes: a.notes || "", nextFittingAt: toLocalInput(a.nextFittingAt), fittingComment: a.fittingComment || "", phone: a.phone || "", phone2: a.phone2 || "", email: a.email || "", email2: a.email2 || "", startWorkDate: a.startWorkDate ? toLocalInput(a.startWorkDate).slice(0, 10) : "", agency: a.agency || "", measurements: Object.fromEntries(Object.entries(a.measurements || {}).map(([k, v]) => [k, String(v)])) });
    setOpen(true);
  };
  const body = () => ({ name: `${f.first.trim()} ${f.last.trim()}`.trim(), gender: f.gender || null, age: f.age ? Number(f.age) : null, characterIds: f.characterIds, notes: f.notes || null, nextFittingAt: f.nextFittingAt || null, fittingComment: f.fittingComment || null, phone: f.phone || null, phone2: f.phone2 || null, email: f.email || null, email2: f.email2 || null, startWorkDate: f.startWorkDate || null, agency: f.agency || null, measurements: Object.fromEntries(Object.entries(f.measurements).filter(([, v]) => v)) });
  const save = useMutation({
    mutationFn: () => (editing ? api(p(projectId, `/actors/${editing.id}`), { method: "PATCH", body: body() }) : api(p(projectId, "/actors"), { body: body() })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["actors", projectId] }); qc.invalidateQueries({ queryKey: ["characters", projectId] }); toast.push(editing ? "Actor updated" : "Actor created", "ok"); if (addAnother && !editing) { setF(blank); } else { setOpen(false); } setAddAnother(false); },
  });
  const del = useMutation({ mutationFn: (id: string) => api(p(projectId, `/actors/${id}`), { method: "DELETE" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["actors", projectId] }); qc.invalidateQueries({ queryKey: ["characters", projectId] }); toast.push("Actor deleted", "ok"); } });

  const list = useMemo(() => (data || []).filter((a) => !q || `${a.name} ${a.characters.map((c) => c.name).join(" ")} ${a.notes || ""}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const charLabel = (c: { name: string; castNumber?: number | null }) => `${c.castNumber != null ? `(${c.castNumber}) ` : ""}${c.name}`;

  return (
    <div onClick={() => menu && setMenu(null)}>
      <PageHead title={<span className="row gap-2"><span style={{ color: "var(--accent)" }}>★</span> Actors</span>} sub="Cast, their characters, contact details and next fitting." crumbs={<><Link to={`${base}/characters`}>Characters</Link> / Actors</>} />
      <Card>
        <div className="row between wrap gap-2 mb-2">
          <h2>All Actors</h2>
          {canEdit && <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> Add</button>}
        </div>
        <div style={{ maxWidth: 320 }} className="mb-2"><SearchBox value={q} onChange={setQ} placeholder="Search" /></div>
        {isLoading ? <Spinner /> : list.length === 0 ? <Empty icon="★" title="There is nothing to display" hint={canEdit ? "Press Add to create the first actor." : undefined} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Character(s)</th><th>Gender</th><th>Age</th><th>Next Fitting</th><th>Start Work</th><th>Notes</th><th></th></tr></thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id}>
                    <td><a href="#" className="bold" onClick={(e) => { e.preventDefault(); if (canEdit) openEdit(a); }}>{a.name}</a></td>
                    <td>{a.characters.length ? a.characters.map((c) => <Link key={c.id} to={`${base}/characters/${c.id}`} style={{ marginRight: 8 }}>{charLabel(c)}</Link>) : <span className="subtle">—</span>}</td>
                    <td>{a.gender ? humanize(a.gender) : ""}</td>
                    <td className="num">{a.age ?? ""}</td>
                    <td className="nowrap">{a.nextFitting ? (a.nextFittingId ? <Link to={`${base}/fittings/${a.nextFittingId}`}>{fmtDateTime(a.nextFitting)}</Link> : fmtDateTime(a.nextFitting)) : ""}</td>
                    <td className="nowrap">{a.startWorkDate ? fmtDate(a.startWorkDate, { day: "2-digit", month: "2-digit", year: "numeric" }) : ""}</td>
                    <td className="subtle truncate" style={{ maxWidth: 240 }}>{a.notes}</td>
                    <td className="right" style={{ position: "relative" }}>
                      {canEdit && <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setMenu(menu === a.id ? null : a.id); }}><MoreVertical size={16} /></button>}
                      {menu === a.id && (
                        <div className="card" style={{ position: "absolute", right: 8, top: 34, zIndex: 5, padding: 6, minWidth: 140 }} onClick={(e) => e.stopPropagation()}>
                          <button className="btn btn-ghost btn-sm btn-block" style={{ justifyContent: "flex-start" }} onClick={() => { setMenu(null); openEdit(a); }}>Edit</button>
                          <ConfirmButton className="btn btn-ghost btn-sm btn-block" confirmText="Delete?" onConfirm={() => { setMenu(null); del.mutate(a.id); }}>Delete</ConfirmButton>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="center subtle mt-2"><a href="#top" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Back to Top</a></div>
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit Actor" : "Create Actor"} wide
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button>{!editing && <button className="btn" disabled={!f.first.trim() || save.isPending} onClick={() => { setAddAnother(true); save.mutate(); }} title="Create and add another">Create +</button>}<button className="btn btn-primary" disabled={!f.first.trim() || save.isPending} onClick={() => { setAddAnother(false); save.mutate(); }}>{editing ? "Save" : "Create"}</button></>}>
        <div className="form-grid">
          <Field label="Name"><div className="row gap-1"><Input value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} placeholder="First Name" autoFocus /><Input value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} placeholder="Last Name" /></div></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Phone" /></Field>
          <Field label="Gender / Age"><div className="row gap-1"><Select value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })} options={(meta as unknown as { genders?: string[] } | null)?.genders || ["FEMALE", "MALE", "NON_BINARY", "OTHER"]} placeholder="Select" /><Input type="number" value={f.age} onChange={(e) => setF({ ...f, age: e.target.value })} placeholder="Age" style={{ width: 90 }} /></div></Field>
          <Field label="Phone 2"><Input value={f.phone2} onChange={(e) => setF({ ...f, phone2: e.target.value })} placeholder="Phone 2" /></Field>
          <Field label="Characters" help="Tick every character this actor plays">
            <div className="card flat pad-0" style={{ maxHeight: 140, overflowY: "auto", padding: 6 }}>
              {(characters || []).length === 0 && <div className="subtle small" style={{ padding: 6 }}>No characters yet.</div>}
              {(characters || []).map((c) => <label key={c.id} className="check" style={{ padding: "3px 4px" }}><input type="checkbox" checked={f.characterIds.includes(c.id)} onChange={(e) => setF({ ...f, characterIds: e.target.checked ? [...f.characterIds, c.id] : f.characterIds.filter((x) => x !== c.id) })} /> {charLabel(c)}{c.actor && c.actor.id !== editing?.id ? <span className="subtle tiny"> · currently {c.actor.name}</span> : null}</label>)}
            </div>
          </Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Email" /></Field>
          <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Notes" rows={3} /></Field>
          <Field label="Email 2"><Input type="email" value={f.email2} onChange={(e) => setF({ ...f, email2: e.target.value })} placeholder="Email 2" /></Field>
          <Field label="Next Costume Fitting"><Input type="datetime-local" value={f.nextFittingAt} onChange={(e) => setF({ ...f, nextFittingAt: e.target.value })} /></Field>
          <Field label="Start Work Date"><Input type="date" value={f.startWorkDate} onChange={(e) => setF({ ...f, startWorkDate: e.target.value })} /></Field>
          <Field label="Comment"><Input value={f.fittingComment} onChange={(e) => setF({ ...f, fittingComment: e.target.value })} placeholder="Fitting Comment" /></Field>
          <Field label="Agency"><Input value={f.agency} onChange={(e) => setF({ ...f, agency: e.target.value })} placeholder="Agency" /></Field>
          <div className="span-2 bold small">Measurements</div>
          {MEASURES.map((m) => <Field key={m} label={humanize(m)}><Input value={f.measurements[m] || ""} onChange={(e) => setF({ ...f, measurements: { ...f.measurements, [m]: e.target.value } })} /></Field>)}
        </div>
        <ErrorBox error={save.error} />
      </Modal>
    </div>
  );
}
