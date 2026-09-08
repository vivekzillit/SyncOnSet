import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, LogOut } from "lucide-react";
import { api } from "@/api/client";
import { useAuth } from "@/state/auth";
import { humanize } from "@/lib/format";
import type { ProjectSummary } from "@/api/types";
import { Badge, ErrorBox, Field, Input, Modal, Select, Spinner, Empty, useToast } from "@/components/ui";

export default function Projects() {
  const { user, logout, meta } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["projects"], queryFn: () => api<ProjectSummary[]>("/projects") });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", status: "PREP", currentLocation: "", currency: "INR" });
  const create = useMutation({
    mutationFn: () => api<ProjectSummary>("/projects", { body: form }),
    onSuccess: (pr) => { qc.invalidateQueries({ queryKey: ["projects"] }); toast.push("Project created", "ok"); nav(`/p/${pr.id}`); },
  });
  const canCreate = ["ADMIN", "PRODUCTION_MANAGER", "COSTUME_DESIGNER"].includes(user?.role || "");

  return (
    <div className="login" style={{ alignItems: "start", paddingTop: 40 }}>
      <div style={{ width: "100%", maxWidth: 760 }}>
        <div className="row between mb-2" style={{ color: "#e8e6e1" }}>
          <div className="row gap-2">
            <div className="brand-mark">C&amp;S</div>
            <div>
              <div className="bold">Costumes &amp; Set</div>
              <div className="tiny" style={{ color: "#9a9da6" }}>{user?.name} · {humanize(user?.role)}</div>
            </div>
          </div>
          <div className="row gap-1">
            {canCreate && <Link to="/projects/new" className="btn btn-accent btn-sm"><Plus size={15} /> Create a Production</Link>}
            <button className="btn btn-sm" onClick={() => { logout(); nav("/login"); }}><LogOut size={15} /> Sign out</button>
          </div>
        </div>
        <div className="card">
          <h2 className="mb-2">Your productions</h2>
          {isLoading ? <Spinner /> : !data?.length ? <Empty icon="🎬" title="Welcome" hint={canCreate ? "Let's get started." : "Ask a production manager to add you to a project."} action={canCreate ? <Link to="/projects/new" className="btn btn-primary">Create a Production</Link> : undefined} /> : (
            <div className="grid grid-2">
              {data.map((pr) => (
                <Link key={pr.id} to={`/p/${pr.id}`} className="card flat" style={{ display: "block" }}>
                  <div className="row between">
                    <div>
                      <div className="bold" style={{ fontSize: 17 }}>{pr.name}</div>
                      <div className="subtle mono">{pr.code}</div>
                    </div>
                    <Badge status={pr.status} />
                  </div>
                  <div className="row gap-3 mt-2 small muted wrap">
                    <span>Day <b>{pr.shootingDay}</b></span>
                    <span>{pr._count?.scenes ?? 0} scenes</span>
                    <span>{pr._count?.characters ?? 0} characters</span>
                    <span>{pr._count?.costumes ?? 0} costumes</span>
                  </div>
                  <div className="subtle mt-1">Your role: {humanize(pr.myRole)}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="New production" footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={create.isPending || !form.name || !form.code} onClick={() => create.mutate()}>Create</button></>}>
        <div className="form-grid">
          <Field label="Title" span2><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Movie ABC" /></Field>
          <Field label="Code" help="Short code used in reports"><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="ABC" /></Field>
          <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={meta?.projectStatuses || ["PREP"]} /></Field>
          <Field label="Current location"><Input value={form.currentLocation} onChange={(e) => setForm({ ...form, currentLocation: e.target.value })} /></Field>
          <Field label="Currency"><Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} options={["INR", "USD", "GBP", "EUR", "AED"]} humanizeLabels={false} /></Field>
        </div>
        <ErrorBox error={create.error} />
      </Modal>
    </div>
  );
}
