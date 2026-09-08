import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, UserPlus, Trash2 } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth } from "@/state/auth";
import { humanize } from "@/lib/format";
import type { Member, Role, User } from "@/api/types";
import { Badge, Card, ConfirmButton, ErrorBox, Field, Input, Modal, PageHead, SearchBox, Select, Spinner, useToast } from "@/components/ui";
import { Avatar } from "@/components/domain";

export default function Team() {
  const { projectId, role } = useProject();
  const { meta, user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: members, isLoading } = useQuery({ queryKey: ["members", projectId], queryFn: () => api<Member[]>(p(projectId, "/members")) });
  const [addOpen, setAddOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data: users } = useQuery({ queryKey: ["users", q], queryFn: () => api<(User & { memberships: { projectId: string; role: string }[] })[]>(`/users?q=${encodeURIComponent(q)}`), enabled: addOpen });
  const [addRole, setAddRole] = useState<Role>("WARDROBE_ASSISTANT");
  const [createOpen, setCreateOpen] = useState(false);
  const [cf, setCf] = useState({ name: "", email: "", password: "", role: "WARDROBE_ASSISTANT", phone: "" });
  const upsert = useMutation({ mutationFn: (v: { userId: string; role: string }) => api(p(projectId, "/members"), { body: v }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["members", projectId] }); toast.push("Member updated", "ok"); }, onError: (e: Error) => toast.push(e.message, "danger") });
  const remove = useMutation({ mutationFn: (userId: string) => api(p(projectId, `/members/${userId}`), { method: "DELETE" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["members", projectId] }); toast.push("Removed", "ok"); } });
  const createUser = useMutation({
    mutationFn: async () => { const u = await api<User>("/users", { body: { ...cf, phone: cf.phone || null } }); await api(p(projectId, "/members"), { body: { userId: u.id, role: cf.role } }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["members", projectId] }); setCreateOpen(false); setCf({ name: "", email: "", password: "", role: "WARDROBE_ASSISTANT", phone: "" }); toast.push("User created and added", "ok"); },
  });
  const canCreateUsers = role === "ADMIN" || role === "PRODUCTION_MANAGER";
  return (
    <div>
      <PageHead title="Team & roles" sub="Project roles control what each person can see and do. Laundry and tailors never see budgets." actions={<>{canCreateUsers && <button className="btn" onClick={() => setCreateOpen(true)}><UserPlus size={16} /> New user</button>}<button className="btn btn-primary" onClick={() => setAddOpen(true)}><Plus size={16} /> Add member</button></>} />
      <Card pad0>
        {isLoading ? <Spinner /> : (
          <div className="list">
            {(members || []).map((m) => (
              <div key={m.id} className="item">
                <Avatar name={m.user.name} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row gap-1"><span className="title">{m.user.name}</span>{m.user.id === user?.id && <Badge status="INFO">you</Badge>}{!m.user.isActive && <Badge status="MUTED">inactive</Badge>}</div>
                  <div className="meta">{m.user.email}{m.user.phone ? ` · ${m.user.phone}` : ""}</div>
                </div>
                <div className="end">
                  <Select value={m.role} onChange={(e) => upsert.mutate({ userId: m.userId, role: e.target.value })} options={meta?.roles || []} style={{ width: "auto", minHeight: 34, padding: "4px 30px 4px 10px" }} />
                  <ConfirmButton className="btn btn-ghost btn-sm" confirmText="Remove?" onConfirm={() => remove.mutate(m.userId)}><Trash2 size={14} /></ConfirmButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Role guide" className="mt-2">
        <div className="grid grid-2 small">
          <div><b>Admin / Production Manager / Designer / Supervisor</b><div className="subtle">Full access: breakdown, budgets, team, all operations.</div></div>
          <div><b>Costume Assistant / Wardrobe Assistant / Dresser</b><div className="subtle">Day-to-day: scan, issue/return, cleaning, damage, continuity, fittings. No budgets.</div></div>
          <div><b>Laundry</b><div className="subtle">Work cleaning tickets through the pipeline.</div></div>
          <div><b>Tailor</b><div className="subtle">Work alteration tickets.</div></div>
          <div><b>Continuity</b><div className="subtle">Record takes and photos in the continuity book.</div></div>
          <div><b>Actor</b><div className="subtle">View their scenes, changes and fittings.</div></div>
        </div>
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add member">
        <div className="col">
          <SearchBox value={q} onChange={setQ} placeholder="Search by name or email" autoFocus />
          <Field label="Project role"><Select value={addRole} onChange={(e) => setAddRole(e.target.value as Role)} options={meta?.roles || []} /></Field>
          <div className="list card flat pad-0" style={{ maxHeight: 300, overflowY: "auto" }}>
            {(users || []).map((u) => {
              const isMember = u.memberships.some((m) => m.projectId === projectId);
              return <div key={u.id} className="item"><Avatar name={u.name} /><div className="grow"><div className="title small">{u.name}</div><div className="meta">{u.email} · {humanize(u.role)}</div></div><button className="btn btn-sm btn-primary" disabled={isMember || upsert.isPending} onClick={() => upsert.mutate({ userId: u.id, role: addRole })}>{isMember ? "Member" : "Add"}</button></div>;
            })}
          </div>
        </div>
      </Modal>
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create user" footer={<><button className="btn" onClick={() => setCreateOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!cf.name || !cf.email || cf.password.length < 8 || createUser.isPending} onClick={() => createUser.mutate()}>Create & add</button></>}>
        <div className="form-grid">
          <Field label="Name" span2><Input value={cf.name} onChange={(e) => setCf({ ...cf, name: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={cf.email} onChange={(e) => setCf({ ...cf, email: e.target.value })} /></Field>
          <Field label="Phone"><Input value={cf.phone} onChange={(e) => setCf({ ...cf, phone: e.target.value })} /></Field>
          <Field label="Temporary password" help="At least 8 characters"><Input type="text" value={cf.password} onChange={(e) => setCf({ ...cf, password: e.target.value })} /></Field>
          <Field label="Role"><Select value={cf.role} onChange={(e) => setCf({ ...cf, role: e.target.value })} options={meta?.roles || []} /></Field>
        </div>
        <ErrorBox error={createUser.error} />
      </Modal>
    </div>
  );
}
