import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth } from "@/state/auth";
import { fmtDate, fmtMoney, humanize, todayISO } from "@/lib/format";
import type { Character, Expense, Rental, Scene } from "@/api/types";
import { Card, Empty, ErrorBox, Field, Input, Modal, PageHead, Select, Spinner, Stat, useToast } from "@/components/ui";

interface BudgetReport { total: number; byCategory: Record<string, number>; byCharacter: Record<string, number>; byScene: Record<string, number>; inventoryValue: number; rentalCommitted: number; expenses: Expense[]; rentals: Rental[] }

export default function Budget() {
  const { projectId, currency } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["budget", projectId], queryFn: () => api<BudgetReport>(p(projectId, "/reports/budget")) });
  const { data: characters } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")) });
  const { data: scenes } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ category: "PURCHASE", amount: "", description: "", date: todayISO(), characterId: "", sceneId: "" });
  const create = useMutation({
    mutationFn: () => api(p(projectId, "/expenses"), { body: { ...f, amount: Number(f.amount), characterId: f.characterId || null, sceneId: f.sceneId || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budget", projectId] }); setOpen(false); setF({ ...f, amount: "", description: "" }); toast.push("Expense added", "ok"); },
  });
  const del = useMutation({ mutationFn: (id: string) => api(p(projectId, `/expenses/${id}`), { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["budget", projectId] }) });
  if (isLoading || !data) return <Spinner />;
  const m = (n: number) => fmtMoney(n, currency);
  const cats = meta?.expenseCategories || Object.keys(data.byCategory);
  return (
    <div>
      <PageHead title="Budget & expenses" sub="Money tracking per category, character and scene." actions={<button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Expense</button>} />
      <div className="grid grid-stats mb-2">
        <Stat label="Total spend" value={m(data.total)} />
        {cats.map((c) => <Stat key={c} label={humanize(c)} value={m(data.byCategory[c] || 0)} />)}
        <Stat label="Inventory value" value={m(data.inventoryValue)} hint="sum of purchase costs" />
        <Stat label="Rental committed" value={m(data.rentalCommitted)} hint="rate × booked days" />
      </div>
      <div className="grid grid-2 mb-2">
        <Card title="By character" pad0>
          <div className="table-wrap"><table className="table"><tbody>{Object.entries(data.byCharacter).sort((a, b) => b[1] - a[1]).map(([k, v]) => <tr key={k}><td>{k}</td><td className="right bold">{m(v)}</td></tr>)}</tbody></table></div>
        </Card>
        <Card title="By scene" pad0>
          {Object.keys(data.byScene).length === 0 ? <div className="subtle" style={{ padding: 14 }}>No scene-tagged expenses yet.</div> : <div className="table-wrap"><table className="table"><tbody>{Object.entries(data.byScene).sort((a, b) => b[1] - a[1]).map(([k, v]) => <tr key={k}><td>{k}</td><td className="right bold">{m(v)}</td></tr>)}</tbody></table></div>}
        </Card>
      </div>
      <Card title={`Expenses (${data.expenses.length})`} pad0>
        {data.expenses.length === 0 ? <Empty icon="💸" title="No expenses" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Character</th><th>Scene</th><th className="right">Amount</th><th></th></tr></thead>
            <tbody>{data.expenses.map((e) => <tr key={e.id}><td className="nowrap">{fmtDate(e.date)}</td><td>{humanize(e.category)}</td><td>{e.description}{e.costume ? <span className="subtle"> · {e.costume.assetNumber}</span> : ""}{e.vendor ? <span className="subtle"> · {e.vendor.name}</span> : ""}</td><td>{e.character?.name || "—"}</td><td>{e.scene ? `Sc ${e.scene.number}` : "—"}</td><td className="right bold nowrap">{m(e.amount)}</td><td><button className="btn btn-ghost btn-sm" onClick={() => del.mutate(e.id)}><Trash2 size={14} /></button></td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Add expense" footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!f.amount || !f.description || create.isPending} onClick={() => create.mutate()}>Add</button></>}>
        <div className="form-grid">
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={cats} /></Field>
          <Field label={`Amount (${currency})`}><Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Description" span2><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Character"><Select value={f.characterId} onChange={(e) => setF({ ...f, characterId: e.target.value })} options={(characters || []).map((c) => ({ value: c.id, label: c.name }))} placeholder="—" /></Field>
          <Field label="Scene"><Select value={f.sceneId} onChange={(e) => setF({ ...f, sceneId: e.target.value })} options={(scenes || []).map((s) => ({ value: s.id, label: `Sc ${s.number}` }))} placeholder="—" /></Field>
        </div>
        <ErrorBox error={create.error} />
      </Modal>
    </div>
  );
}
