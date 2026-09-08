import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, MoreVertical } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, MANAGER_ROLES } from "@/state/auth";
import { fmtDate, fmtDateTime, humanize } from "@/lib/format";
import { Card, ConfirmButton, Empty, PageHead, SearchBox, Spinner, useToast } from "@/components/ui";
import { ActorModal, charLabel, type ActorRow } from "@/components/ActorModal";

/** SyncOnSet-style Actors page: table + Create Actor form. */
export default function Actors() {
  const { projectId, can } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["actors", projectId], queryFn: () => api<ActorRow[]>(p(projectId, "/actors")) });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ActorRow | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const canEdit = can(MANAGER_ROLES);

  const openCreate = () => { setEditing(null); setOpen(true); };
  const openEdit = (a: ActorRow) => { setEditing(a); setOpen(true); };
  const del = useMutation({ mutationFn: (id: string) => api(p(projectId, `/actors/${id}`), { method: "DELETE" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["actors", projectId] }); qc.invalidateQueries({ queryKey: ["characters", projectId] }); toast.push("Actor deleted", "ok"); } });

  const list = useMemo(() => (data || []).filter((a) => !q || `${a.name} ${a.characters.map((c) => c.name).join(" ")} ${a.notes || ""}`.toLowerCase().includes(q.toLowerCase())), [data, q]);

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

      <ActorModal open={open} onClose={() => setOpen(false)} editing={editing} />
    </div>
  );
}
