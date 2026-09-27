import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth } from "@/state/auth";
import { fmtDate, fmtMoney, humanize, matches, todayISO } from "@/lib/format";
import type { Character, Expense, Rental, Scene } from "@/api/types";
import { Card, ConfirmButton, Empty, ErrorBox, Field, Input, Modal, PageHead, SearchBox, Select, Spinner, Stat, Tabs, useToast } from "@/components/ui";
import { RecordActions } from "@/components/Discussion";

interface BudgetReport { total: number; byCategory: Record<string, number>; byCharacter: Record<string, number>; byScene: Record<string, number>; inventoryValue: number; rentalCommitted: number; expenses: Expense[]; rentals: Rental[] }
type TabKey = "all" | "scenes" | "characters";
/** Filter value for expenses not tagged to any scene / character. */
const NONE = "__none__";

/** Totals per key (scene or character id; untagged under NONE). */
function rollup(expenses: Expense[], key: (e: Expense) => string | null | undefined) {
  const out = new Map<string, { total: number; count: number; cats: Set<string> }>();
  for (const e of expenses) {
    const k = key(e) || NONE;
    const r = out.get(k) || { total: 0, count: 0, cats: new Set<string>() };
    r.total += e.amount; r.count += 1; r.cats.add(e.category);
    out.set(k, r);
  }
  return out;
}

export default function Budget() {
  const { projectId, currency } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["budget", projectId], queryFn: () => api<BudgetReport>(p(projectId, "/reports/budget")) });
  const { data: characters } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")) });
  const { data: scenes } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });
  const [tab, setTab] = useState<TabKey>("all");
  const [q, setQ] = useState("");
  const [sceneF, setSceneF] = useState("");
  const [charF, setCharF] = useState("");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ category: "PURCHASE", amount: "", description: "", date: todayISO(), characterId: "", sceneId: "" });
  const create = useMutation({
    mutationFn: () => api(p(projectId, "/expenses"), { body: { ...f, amount: Number(f.amount), characterId: f.characterId || null, sceneId: f.sceneId || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budget", projectId] }); setOpen(false); setF({ ...f, amount: "", description: "" }); toast.push("Expense added", "ok"); },
  });
  const del = useMutation({ mutationFn: (id: string) => api(p(projectId, `/expenses/${id}`), { method: "DELETE" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["budget", projectId] }); toast.push("Expense deleted", "ok"); }, onError: (e: Error) => toast.push(e.message, "danger") });

  const expenses = useMemo(() => data?.expenses || [], [data]);
  const byScene = useMemo(() => rollup(expenses, (e) => e.sceneId), [expenses]);
  const byChar = useMemo(() => rollup(expenses, (e) => e.characterId), [expenses]);
  const sceneById = useMemo(() => new Map((scenes || []).map((s) => [s.id, s])), [scenes]);
  const charById = useMemo(() => new Map((characters || []).map((c) => [c.id, c])), [characters]);
  const needle = q.trim();

  const shownExpenses = useMemo(() => expenses.filter((e) =>
    (!sceneF || (sceneF === NONE ? !e.sceneId : e.sceneId === sceneF)) &&
    (!charF || (charF === NONE ? !e.characterId : e.characterId === charF)) &&
    matches(needle, e.description, humanize(e.category), e.character?.name, e.scene?.number, e.costume?.assetNumber, e.costume?.name, e.vendor?.name)), [expenses, sceneF, charF, needle]);
  const shownTotal = shownExpenses.reduce((n, e) => n + e.amount, 0);
  // Every scene is listed, spend or not, so the breakdown reads scene by scene in script order.
  const shownScenes = useMemo(() => (scenes || []).filter((s) => matches(needle, s.number, s.name, s.location)), [scenes, needle]);
  const shownChars = useMemo(() => (characters || []).filter((c) => matches(needle, c.name, c.actor?.name, c.castNumber)), [characters, needle]);

  if (isLoading || !data) return <Spinner />;
  const m = (n: number) => fmtMoney(n, currency);
  const cats = meta?.expenseCategories || Object.keys(data.byCategory);
  const summary = (r?: { count: number; cats: Set<string> }) => r ? `${r.count} expense${r.count === 1 ? "" : "s"} · ${[...r.cats].map(humanize).join(", ")}` : "No spend yet";
  /** From a scene / character row, open the All tab filtered to it. */
  const drill = (scene: string, character: string) => { setSceneF(scene); setCharF(character); setQ(""); setTab("all"); };
  const openAdd = () => { setF({ ...f, sceneId: sceneF && sceneF !== NONE ? sceneF : "", characterId: charF && charF !== NONE ? charF : "" }); setOpen(true); };
  const untaggedScene = byScene.get(NONE);
  const untaggedChar = byChar.get(NONE);
  const sceneLabel = (id: string) => { const s = sceneById.get(id); return s ? `Sc ${s.number}${s.name ? ` · ${s.name}` : ""}` : "Scene"; };

  return (
    <div>
      <PageHead title="Budget & Expenses" sub="Spend for the whole production, scene by scene or by character." actions={<button className="btn btn-primary" onClick={openAdd}><Plus size={16} /> Expense</button>} />
      <div className="grid grid-stats mb-2">
        <Stat label="Total spend" value={m(data.total)} />
        {cats.map((c) => <Stat key={c} label={humanize(c)} value={m(data.byCategory[c] || 0)} />)}
        <Stat label="Inventory value" value={m(data.inventoryValue)} hint="sum of purchase costs" />
        <Stat label="Rental committed" value={m(data.rentalCommitted)} hint="rate × booked days" />
      </div>

      <Tabs tabs={[{ key: "all", label: `All (${expenses.length})` }, { key: "scenes", label: `Scene by scene (${scenes?.length ?? 0})` }, { key: "characters", label: `By character (${characters?.length ?? 0})` }]} value={tab} onChange={(t) => { setTab(t); setQ(""); }} />
      <div className="filters">
        <SearchBox value={q} onChange={setQ} placeholder={tab === "all" ? "Search description, category, vendor, piece…" : tab === "scenes" ? "Search scene number, name, location…" : "Search character, actor, cast number…"} />
        {tab === "all" && <>
          <Select value={sceneF} onChange={(e) => setSceneF(e.target.value)} options={[...(scenes || []).map((s) => ({ value: s.id, label: `Sc ${s.number}` })), { value: NONE, label: "No scene" }]} placeholder="All scenes" humanizeLabels={false} aria-label="Scene" style={{ width: "auto", minWidth: 140 }} />
          <Select value={charF} onChange={(e) => setCharF(e.target.value)} options={[...(characters || []).map((c) => ({ value: c.id, label: c.name })), { value: NONE, label: "No character" }]} placeholder="All characters" humanizeLabels={false} aria-label="Character" style={{ width: "auto", minWidth: 160 }} />
        </>}
      </div>

      {tab === "all" && (sceneF || charF || needle) && (
        <div className="subtle mb-2">
          {[sceneF && (sceneF === NONE ? "No scene" : sceneLabel(sceneF)), charF && (charF === NONE ? "No character" : charById.get(charF)?.name)].filter(Boolean).join(" · ") || "Matching"} · <b>{m(shownTotal)}</b> across {shownExpenses.length} expense{shownExpenses.length === 1 ? "" : "s"}
          {(sceneF || charF) && <> · <button className="btn btn-ghost btn-sm" onClick={() => { setSceneF(""); setCharF(""); }}>Show all</button></>}
        </div>
      )}

      <Card pad0>
        {tab === "all" ? (
          !expenses.length ? <Empty icon="💸" title="No expenses yet" hint="Add an expense and tag it to a scene or character to see spend broken down." /> : !shownExpenses.length ? <Empty icon="🔍" title="No expenses match" /> : (
            <div className="list">
              {shownExpenses.map((e) => (
                <div key={e.id} className="item">
                  <div className="avatar" title={e.scene ? `Scene ${e.scene.number}` : "No scene"}>{e.scene ? e.scene.number : <span className="subtle">—</span>}</div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <span className="title">{e.description}</span>
                    <div className="meta">{[fmtDate(e.date), humanize(e.category), e.character?.name, e.costume?.assetNumber, e.vendor?.name].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="end">
                    <span className="bold nowrap">{m(e.amount)}</span>
                    <RecordActions entityType="EXPENSE" entityId={e.id} title={e.description} path={`/p/${projectId}/budget`}
                      summary={`Expense: ${e.description} · ${m(e.amount)}\n${[fmtDate(e.date), humanize(e.category), e.scene ? `Sc ${e.scene.number}` : null, e.character?.name, e.vendor?.name].filter(Boolean).join(" · ")}`} />
                    <ConfirmButton className="btn btn-ghost btn-sm" confirmText="Delete?" aria-label={`Delete ${e.description}`} onConfirm={() => del.mutate(e.id)}><Trash2 size={14} /></ConfirmButton>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : tab === "scenes" ? (
          !scenes?.length ? <Empty icon="🎬" title="No scenes yet" /> : (
            <div className="list">
              {shownScenes.map((s) => {
                const r = byScene.get(s.id);
                return (
                  <button key={s.id} type="button" className="item link" onClick={() => drill(s.id, "")}>
                    <div className="avatar">{s.number}</div>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <span className="title">{s.name || `Scene ${s.number}`}</span>
                      <div className="meta">{summary(r)}</div>
                    </div>
                    <div className={`end nowrap ${r ? "bold" : "subtle"}`}>{m(r?.total || 0)}</div>
                  </button>
                );
              })}
              {untaggedScene && !needle && (
                <button type="button" className="item link" onClick={() => drill(NONE, "")}>
                  <div className="avatar"><span className="subtle">—</span></div>
                  <div className="grow" style={{ minWidth: 0 }}><span className="title">Not tagged to a scene</span><div className="meta">{summary(untaggedScene)}</div></div>
                  <div className="end nowrap bold">{m(untaggedScene.total)}</div>
                </button>
              )}
              {!shownScenes.length && needle && <Empty icon="🔍" title="No scenes match" />}
            </div>
          )
        ) : (
          !characters?.length ? <Empty icon="🧍" title="No characters yet" /> : (
            <div className="list">
              {shownChars.map((c) => {
                const r = byChar.get(c.id);
                return (
                  <button key={c.id} type="button" className="item link" onClick={() => drill("", c.id)}>
                    <div className="avatar">{c.castNumber != null ? c.castNumber : <span className="subtle">—</span>}</div>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <span className="title">{c.name}</span>
                      <div className="meta">{summary(r)}</div>
                    </div>
                    <div className={`end nowrap ${r ? "bold" : "subtle"}`}>{m(r?.total || 0)}</div>
                  </button>
                );
              })}
              {untaggedChar && !needle && (
                <button type="button" className="item link" onClick={() => drill("", NONE)}>
                  <div className="avatar"><span className="subtle">—</span></div>
                  <div className="grow" style={{ minWidth: 0 }}><span className="title">Not tagged to a character</span><div className="meta">{summary(untaggedChar)}</div></div>
                  <div className="end nowrap bold">{m(untaggedChar.total)}</div>
                </button>
              )}
              {!shownChars.length && needle && <Empty icon="🔍" title="No characters match" />}
            </div>
          )
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Add expense" footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!f.amount || !f.description || create.isPending} onClick={() => create.mutate()}>Add</button></>}>
        <div className="form-grid">
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={cats} /></Field>
          <Field label={`Amount (${currency})`}><Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Description" span2><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Character"><Select value={f.characterId} onChange={(e) => setF({ ...f, characterId: e.target.value })} options={(characters || []).map((c) => ({ value: c.id, label: c.name }))} placeholder="—" humanizeLabels={false} /></Field>
          <Field label="Scene"><Select value={f.sceneId} onChange={(e) => setF({ ...f, sceneId: e.target.value })} options={(scenes || []).map((s) => ({ value: s.id, label: `Sc ${s.number}${s.name ? ` · ${s.name}` : ""}` }))} placeholder="—" humanizeLabels={false} /></Field>
        </div>
        <ErrorBox error={create.error} />
      </Modal>
    </div>
  );
}
