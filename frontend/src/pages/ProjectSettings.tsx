import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth } from "@/state/auth";
import { toLocalInput } from "@/lib/format";
import { Card, ErrorBox, Field, Input, PageHead, Select, Spinner, Textarea, useToast } from "@/components/ui";

export default function ProjectSettings() {
  const { projectId, project } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: "", code: "", status: "PREP", shootingDay: "0", currentLocation: "", currency: "INR", prepStartDate: "", prepEndDate: "", startDate: "", endDate: "", notes: "" });
  useEffect(() => { if (project) setF({ name: project.name, code: project.code, status: project.status, shootingDay: String(project.shootingDay ?? 0), currentLocation: project.currentLocation || "", currency: project.currency, prepStartDate: project.prepStartDate ? toLocalInput(project.prepStartDate).slice(0, 10) : "", prepEndDate: project.prepEndDate ? toLocalInput(project.prepEndDate).slice(0, 10) : "", startDate: project.startDate ? toLocalInput(project.startDate).slice(0, 10) : "", endDate: project.endDate ? toLocalInput(project.endDate).slice(0, 10) : "", notes: project.notes || "" }); }, [project]);
  const save = useMutation({
    mutationFn: () => api(`/projects/${projectId}`, { method: "PATCH", body: { ...f, shootingDay: Number(f.shootingDay), prepStartDate: f.prepStartDate || null, prepEndDate: f.prepEndDate || null, startDate: f.startDate || null, endDate: f.endDate || null } }),
    onSuccess: () => { qc.invalidateQueries(); toast.push("Project saved", "ok"); },
  });
  if (!project) return <Spinner />;
  return (
    <div>
      <PageHead title="Project settings" sub={<span className="mono">{project.code} · {project.id}</span>} actions={<button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>} />
      <Card>
        <div className="form-grid">
          <Field label="Title" span2><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={meta?.projectStatuses || []} /></Field>
          <Field label="Shooting day" help="Increment each shoot day; shown on the dashboard and reports."><Input type="number" value={f.shootingDay} onChange={(e) => setF({ ...f, shootingDay: e.target.value })} /></Field>
          <Field label="Current location"><Input value={f.currentLocation} onChange={(e) => setF({ ...f, currentLocation: e.target.value })} /></Field>
          <Field label="Currency"><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} options={["INR", "USD", "GBP", "EUR", "AED"]} humanizeLabels={false} /></Field>
          <div />
          <Field label="Pre-production start"><Input type="date" value={f.prepStartDate} onChange={(e) => setF({ ...f, prepStartDate: e.target.value })} /></Field>
          <Field label="Pre-production end"><Input type="date" value={f.prepEndDate} min={f.prepStartDate || undefined} onChange={(e) => setF({ ...f, prepEndDate: e.target.value })} /></Field>
          <Field label="Shoot start"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Shoot end"><Input type="date" value={f.endDate} min={f.startDate || undefined} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          <Field label="Notes" span2><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <ErrorBox error={save.error} />
      </Card>
    </div>
  );
}
