import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Layers, Plus, Printer, Trash2 } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth } from "@/state/auth";
import { fmtDate, fmtMoney, humanize, matches, todayISO, inCurrency } from "@/lib/format";
import type { Character, Expense, Rental, Scene, Vendor } from "@/api/types";
import { Card, ConfirmButton, Empty, ErrorBox, Field, Input, Modal, PageHead, SearchBox, Select, Spinner, Stat, Tabs, useToast } from "@/components/ui";
import { CharacterSelect, SceneSelect, VendorSelect } from "@/components/QuickSelects";
import { RecordActions } from "@/components/Discussion";
import { BudgetUpload } from "@/components/BudgetUpload";
import { BudgetSheet, type SheetGroup } from "@/components/BudgetSheet";
import { BudgetDocument, topSheetText } from "@/components/BudgetDocument";
import { BUDGET_UNITS, CURRENCIES, WARDROBE_ACCOUNTS, departmentOf, sumByCurrency } from "@/lib/budgetAccounts";

interface BudgetReport { total: number; byCategory: Record<string, number>; byCharacter: Record<string, number>; byScene: Record<string, number>; inventoryValue: number; rentalCommitted: number; expenses: Expense[]; rentals: Rental[] }
type TabKey = "all" | "scenes" | "characters" | "accounts" | "full";
/** Filter value for expenses not tagged to any scene / character. */
const NONE = "__none__";
const ACCOUNT_LIST_ID = "budget-accounts";
const UNIT_LIST_ID = "budget-units";

/** The add / edit form: numbers stay strings while typed, so a half-typed "6." is not lost. */
type Form = { category: string; amount: string; description: string; date: string; characterId: string; sceneId: string; vendorId: string; accountCode: string; accountName: string; payee: string; quantity: string; unit: string; multiplier: string; rate: string; currency: string };
/** A line's name for lists and sharing: its description, or failing that its account, payee or category (every field is optional). */
export const lineTitle = (e: Pick<Expense, "description" | "accountName" | "accountCode" | "payee" | "category">) =>
  e.description?.trim() || e.accountName || e.payee || e.accountCode || humanize(e.category) || "Budget line";
const blankForm = (currency: string): Form => ({ category: "PURCHASE", amount: "", description: "", date: todayISO(), characterId: "", sceneId: "", vendorId: "", accountCode: "", accountName: "", payee: "", quantity: "", unit: "", multiplier: "1", rate: "", currency });
const toForm = (e: Expense, currency: string): Form => ({ category: e.category, amount: String(e.amount), description: e.description, date: (e.date || "").slice(0, 10), characterId: e.characterId || "", sceneId: e.sceneId || "", vendorId: e.vendorId || "", accountCode: e.accountCode || "", accountName: e.accountName || "", payee: e.payee || "", quantity: e.quantity != null ? String(e.quantity) : "", unit: e.unit || "", multiplier: e.multiplier != null ? String(e.multiplier) : "1", rate: e.rate != null ? String(e.rate) : "", currency: e.currency || currency });
const numOrNull = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));
/** Amt × X × Rate, once Amt and Rate are both filled in (X defaults to 1); otherwise the amount is typed directly. */
const subtotalOf = (f: Form) => { const q = numOrNull(f.quantity); const r = numOrNull(f.rate); return q == null || r == null ? null : Math.round(q * (numOrNull(f.multiplier) ?? 1) * r * 100) / 100; };

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
  const { projectId, currency, project } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["budget", projectId], queryFn: () => api<BudgetReport>(p(projectId, "/reports/budget")) });
  const { data: characters } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")) });
  const { data: scenes } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });
  const { data: vendors } = useQuery({ queryKey: ["vendors", projectId], queryFn: () => api<Vendor[]>(p(projectId, "/vendors")) });
  const [tab, setTab] = useState<TabKey>("all");
  /** A tapped spend tile: every tab below then shows only that category ("" = everything). */
  const [cat, setCat] = useState("");
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [f, setF] = useState<Form>(() => blankForm(currency));
  const [editing, setEditing] = useState<string | null>(null);
  const subtotal = subtotalOf(f);
  const amount = subtotal ?? numOrNull(f.amount);
  const create = useMutation({
    mutationFn: () => {
      const body = {
        category: f.category, amount: amount ?? 0, description: f.description.trim(), date: f.date || null,
        characterId: f.characterId || null, sceneId: f.sceneId || null, vendorId: f.vendorId || null,
        accountCode: f.accountCode, accountName: f.accountName, payee: f.payee, unit: f.unit,
        quantity: numOrNull(f.quantity), multiplier: numOrNull(f.quantity) != null ? numOrNull(f.multiplier) ?? 1 : null, rate: numOrNull(f.rate),
        currency: f.currency === currency ? "" : f.currency,
      };
      return editing ? api(p(projectId, `/expenses/${editing}`), { method: "PATCH", body }) : api(p(projectId, "/expenses"), { body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget", projectId] });
      setOpen(false);
      toast.push(editing ? "Budget line saved" : "Budget line added", "ok");
      // The next line usually sits in the same account, for the same person: keep those, clear the rest.
      if (!editing) setF({ ...blankForm(currency), accountCode: f.accountCode, accountName: f.accountName, payee: f.payee, sceneId: f.sceneId, characterId: f.characterId, category: f.category, currency: f.currency });
    },
  });
  const del = useMutation({ mutationFn: (id: string) => api(p(projectId, `/expenses/${id}`), { method: "DELETE" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["budget", projectId] }); toast.push("Expense deleted", "ok"); }, onError: (e: Error) => toast.push(e.message, "danger") });

  const allExpenses = useMemo(() => data?.expenses || [], [data]);
  const expenses = useMemo(() => (cat ? allExpenses.filter((e) => e.category === cat) : allExpenses), [allExpenses, cat]);
  const byScene = useMemo(() => rollup(expenses, (e) => e.sceneId), [expenses]);
  const byChar = useMemo(() => rollup(expenses, (e) => e.characterId), [expenses]);
  const sceneById = useMemo(() => new Map((scenes || []).map((s) => [s.id, s])), [scenes]);
  const needle = q.trim();

  const shownExpenses = useMemo(() => expenses.filter((e) =>
    matches(needle, e.description, humanize(e.category), e.accountCode, e.accountName, e.payee, e.character?.name, e.scene?.number, e.costume?.assetNumber, e.costume?.name, e.vendor?.name)), [expenses, needle]);
  /** Every account code used on this production, in chart order, for the account filter. */
  const accountOptions = useMemo(() => {
    const by = new Map<string, string>();
    for (const e of expenses) if (e.accountCode && !by.has(e.accountCode)) by.set(e.accountCode, e.accountName || "");
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([code, name]) => ({ value: code, label: name ? `${code} ${name}` : code }));
  }, [expenses]);
  // Every scene is listed, spend or not, so the breakdown reads scene by scene in script order.
  const shownScenes = useMemo(() => (scenes || []).filter((s) => matches(needle, s.number, s.name, s.location)), [scenes, needle]);
  const shownChars = useMemo(() => (characters || []).filter((c) => matches(needle, c.name, c.actor?.name, c.castNumber)), [characters, needle]);

  if (isLoading || !data) return <Spinner />;
  const m = (n: number) => fmtMoney(n, currency);
  const cats = meta?.expenseCategories || Object.keys(data.byCategory);
  const untaggedScene = byScene.get(NONE);
  const untaggedChar = byChar.get(NONE);
  const openAdd = () => { setEditing(null); create.reset(); setF({ ...f, amount: "", description: "", quantity: "", rate: "", multiplier: "1", currency: f.currency || currency }); setOpen(true); };
  const openEdit = (e: Expense) => { setEditing(e.id); create.reset(); setF(toForm(e, currency)); setOpen(true); };
  /** Picking a known code fills its account name (only when the name is blank or still the old code's name). */
  const knownAccounts = [...WARDROBE_ACCOUNTS, ...allExpenses.filter((e) => e.accountCode && e.accountName).map((e) => ({ code: e.accountCode!, name: e.accountName! }))];
  const setCode = (code: string) => {
    const hit = knownAccounts.find((a) => a.code === code.trim());
    const oldName = knownAccounts.find((a) => a.code === f.accountCode.trim())?.name;
    setF({ ...f, accountCode: code, accountName: hit && (!f.accountName || f.accountName === oldName) ? hit.name : f.accountName });
  };
  const money = (n: number, c: string) => fmtMoney(n, c);
  const sceneTitle = (s: Scene) => [`Sc ${s.number}`, s.name || s.location].filter(Boolean).join(" - ");
  const sceneGroups: SheetGroup[] = [
    ...shownScenes.map((s) => ({ key: s.id, title: sceneTitle(s), lines: expenses.filter((e) => e.sceneId === s.id) })).filter((g) => g.lines.length),
    ...(!needle && untaggedScene ? [{ key: NONE, title: "Not tagged to a scene", lines: expenses.filter((e) => !e.sceneId) }] : []),
  ];
  const charGroups: SheetGroup[] = [
    ...shownChars.map((c) => ({ key: c.id, title: c.castNumber != null ? `${c.castNumber}. ${c.name}` : c.name, lines: expenses.filter((e) => e.characterId === c.id) })).filter((g) => g.lines.length),
    ...(!needle && untaggedChar ? [{ key: NONE, title: "Not tagged to a character", lines: expenses.filter((e) => !e.characterId) }] : []),
  ];
  const idleScenes = shownScenes.filter((s) => !byScene.get(s.id)).length;
  const idleChars = shownChars.filter((c) => !byChar.get(c.id)).length;
  // By account code: department by department (30-000 - WARDROBE), each account's block inside it, as the printed budget reads.
  const accountLines = expenses.filter((e) => matches(needle, e.accountCode, e.accountName, e.description, e.payee, humanize(e.category)));
  const deptGroups: SheetGroup[] = (() => {
    const by = new Map<string, SheetGroup>();
    for (const e of accountLines) {
      const d = departmentOf(e.accountCode);
      const k = d?.key ?? NONE;
      const g = by.get(k) || { key: k, title: d?.title ?? "No account code", lines: [] };
      g.lines.push(e);
      by.set(k, g);
    }
    return [...by.values()].sort((a, b) => (a.key === NONE ? 1 : b.key === NONE ? -1 : a.key.localeCompare(b.key, undefined, { numeric: true })));
  })();
  const lineActions = (e: Expense) => (
    <>
      <RecordActions entityType="EXPENSE" entityId={e.id} title={lineTitle(e)} path={`/p/${projectId}/budget`}
        summary={`Expense: ${lineTitle(e)} · ${fmtMoney(e.amount, e.currency || currency)}\n${[e.accountCode, fmtDate(e.date), humanize(e.category), e.scene ? `Sc ${e.scene.number}` : null, e.character?.name, e.vendor?.name].filter(Boolean).join(" · ")}`} />
      <ConfirmButton className="btn btn-ghost btn-sm" confirmText="Delete?" aria-label={`Delete ${lineTitle(e)}`} onConfirm={() => del.mutate(e.id)}><Trash2 size={14} /></ConfirmButton>
    </>
  );

  return (
    <div>
      <div className={tab === "full" ? "no-print" : undefined}>
      <PageHead title="Budget" sub="Spend for the whole production, scene by scene or by character."
        actions={<><button className={`btn ${tab === "full" ? "btn-blue" : ""}`} onClick={() => { setTab("full"); setQ(""); }}><Layers size={16} /> Full budget</button><button className="btn" onClick={() => setUploadOpen(true)}><FileSpreadsheet size={16} /> Upload budget sheet</button><button className="btn btn-primary" onClick={openAdd}><Plus size={16} /> Budget</button></>} />
      <div className="grid grid-stats mb-2">
        {/* Summed per currency, so a line in pounds is never added into a rupee total. */}
        {/* Tap a category to see only its lines below, in every tab; tap it again (or Total spend) for everything. */}
        <Stat label="Total spend" value={sumByCurrency(allExpenses, currency, fmtMoney)} active={!cat} onClick={() => setCat("")} />
        {cats.map((c) => <Stat key={c} label={humanize(c)} value={sumByCurrency(allExpenses.filter((e) => e.category === c), currency, fmtMoney)} active={cat === c} onClick={() => setCat(cat === c ? "" : c)} />)}
        <Stat label="Inventory value" value={m(data.inventoryValue)} hint="sum of purchase costs" onClick={() => nav(`/p/${projectId}/costumes`)} />
        <Stat label="Rental committed" value={m(data.rentalCommitted)} hint="rate × booked days" onClick={() => nav(`/p/${projectId}/vendors`)} />
      </div>

      <Tabs tabs={[{ key: "all", label: `All (${expenses.length})` }, { key: "scenes", label: `Scene by scene (${scenes?.length ?? 0})` }, { key: "characters", label: `By character (${characters?.length ?? 0})` }, { key: "accounts", label: `By account code (${accountOptions.length})` }, { key: "full", label: "Full budget" }]} value={tab} onChange={(t) => { setTab(t); setQ(""); }} />
      {tab !== "full" && <div className="filters">
        <SearchBox value={q} onChange={setQ} placeholder={tab === "all" ? "Search description, account, name, vendor, piece…" : tab === "scenes" ? "Search scene number, name, location…" : tab === "accounts" ? "Search account code, account name, description…" : "Search character, actor, cast number…"} />
      </div>}

      {cat && (
        <div className="row gap-1 mb-2 wrap">
          <span className="subtle">Showing <b>{humanize(cat)}</b> only · {sumByCurrency(expenses, currency, fmtMoney)} across {expenses.length} line{expenses.length === 1 ? "" : "s"}</span>
          <button type="button" className="btn btn-sm" onClick={() => setCat("")}>Show all categories</button>
        </div>
      )}
      </div>

      {tab === "all" && needle && (
        <div className="subtle mb-2">
          Matching · <b>{sumByCurrency(shownExpenses, currency, fmtMoney)}</b> across {shownExpenses.length} expense{shownExpenses.length === 1 ? "" : "s"}
        </div>
      )}

      {tab === "full" ? (
        <div className="col gap-2 no-print">
          <Card>
            <div className="row between wrap gap-2">
              <div>
                <div className="bold" style={{ fontSize: 18 }}>{sumByCurrency(expenses, currency, fmtMoney)}</div>
                <div className="subtle">{expenses.length} budget line{expenses.length === 1 ? "" : "s"} · {sceneGroups.length} scene{sceneGroups.length === 1 ? "" : "s"} · {charGroups.length} character{charGroups.length === 1 ? "" : "s"} · {deptGroups.length} account group{deptGroups.length === 1 ? "" : "s"}</div>
              </div>
              {/* Chat and share are about the budget as a whole here, not one line of it. */}
              <div className="row gap-1">
                {/* Shared as the top sheet reads on paper, account by account, rather than a line of totals. */}
                <RecordActions entityType="BUDGET" entityId={projectId} title={`${project?.name || "Production"} · budget`} path={`/p/${projectId}/budget?tab=full`}
                  summary={topSheetText(project, expenses, currency, money)} />
                <button className="btn btn-sm" onClick={() => window.print()}><Printer size={15} /> Print / PDF</button>
              </div>
            </div>
          </Card>
          {!expenses.length ? <Card pad0><Empty icon="💸" title="No budget lines yet" hint="Add a budget line or upload a budget sheet." /></Card> : <>
            <Card title="All budget lines" pad0><BudgetSheet groups={[{ key: "all", title: "All budget lines", lines: expenses }]} currency={currency} fmt={money} onEdit={openEdit} lineActions={lineActions} /></Card>
            {sceneGroups.length > 0 && <Card title="Scene by scene" pad0><BudgetSheet groups={sceneGroups} currency={currency} fmt={money} onEdit={openEdit} /></Card>}
            {charGroups.length > 0 && <Card title="By character" pad0><BudgetSheet groups={charGroups} currency={currency} fmt={money} onEdit={openEdit} /></Card>}
            {deptGroups.length > 0 && <Card title="By account code" pad0><BudgetSheet groups={deptGroups} currency={currency} fmt={money} onEdit={openEdit} /></Card>}
          </>}
        </div>
      ) : (
      <Card pad0>
        {tab === "all" ? (
          !expenses.length ? <Empty icon="💸" title="No budget lines yet" hint="Add a budget line or upload a budget, and tag lines to a scene or character to see spend broken down." /> : !shownExpenses.length ? <Empty icon="🔍" title="No budget lines match" /> : (
            <BudgetSheet groups={[{ key: "all", title: "All budget lines", lines: shownExpenses }]} currency={currency} fmt={money} onEdit={openEdit} lineActions={lineActions} />
          )
        ) : tab === "scenes" ? (
          !scenes?.length ? <Empty icon="🎬" title="No scenes yet" /> : (
            <>
              <BudgetSheet groups={sceneGroups} currency={currency} fmt={money} onEdit={openEdit} empty={<Empty icon={needle ? "🔍" : "💸"} title={needle ? "No scenes match" : "No spend tagged to a scene yet"} hint="Tag a budget line to a scene to see it here." />} />
              {idleScenes > 0 && <div className="subtle small" style={{ padding: "10px 14px" }}>{idleScenes} scene{idleScenes === 1 ? "" : "s"} with no spend yet.</div>}
            </>
          )
        ) : tab === "accounts" ? (
          <BudgetSheet groups={deptGroups} currency={currency} fmt={money} onEdit={openEdit} empty={<Empty icon={needle ? "🔍" : "💸"} title={needle ? "No accounts match" : "No budget lines yet"} hint="Give a line an account code (e.g. 30-001) to see it under its department." />} />
        ) : (
          !characters?.length ? <Empty icon="🧍" title="No characters yet" /> : (
            <>
              <BudgetSheet groups={charGroups} currency={currency} fmt={money} onEdit={openEdit} empty={<Empty icon={needle ? "🔍" : "💸"} title={needle ? "No characters match" : "No spend tagged to a character yet"} hint="Tag a budget line to a character to see it here." />} />
              {idleChars > 0 && <div className="subtle small" style={{ padding: "10px 14px" }}>{idleChars} character{idleChars === 1 ? "" : "s"} with no spend yet.</div>}
            </>
          )
        )}
      </Card>
      )}

      {tab === "full" && <BudgetDocument project={project} expenses={expenses} groups={deptGroups.length ? deptGroups : [{ key: "all", title: "All budget lines", lines: expenses }]} currency={currency} fmt={money} />}

      <BudgetUpload open={uploadOpen} onClose={() => setUploadOpen(false)} projectId={projectId} currency={currency} />
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit budget line" : "Add budget line"} wide
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={(amount != null && amount < 0) || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Saving…" : editing ? "Save" : "Add"}</button></>}>
        <datalist id={ACCOUNT_LIST_ID}>{[...new Map(knownAccounts.map((a) => [a.code, a])).values()].map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</datalist>
        <datalist id={UNIT_LIST_ID}>{BUDGET_UNITS.map((u) => <option key={u} value={u} />)}</datalist>
        <div className="form-grid">
          <Field label="Account code" help="Picking a known code fills the name"><Input list={ACCOUNT_LIST_ID} value={f.accountCode} onChange={(e) => setCode(e.target.value)} className="mono" /></Field>
          <Field label="Account name"><Input value={f.accountName} onChange={(e) => setF({ ...f, accountName: e.target.value })} /></Field>
          <Field label="Description" span2><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Name" help="Who the line pays: a crew member or supplier"><Input value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} /></Field>
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={cats} /></Field>
          <div className="span-2">
            <div className="row gap-1 wrap" style={{ alignItems: "flex-end" }}>
              <div style={{ width: 90 }}><Field label="Amt"><Input value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} inputMode="decimal" className="mono" /></Field></div>
              <div style={{ width: 110 }}><Field label="Unit"><Input list={UNIT_LIST_ID} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field></div>
              <div style={{ width: 70 }}><Field label="X"><Input value={f.multiplier} onChange={(e) => setF({ ...f, multiplier: e.target.value })} inputMode="decimal" className="mono" /></Field></div>
              <div style={{ width: 120 }}><Field label="Rate"><Input value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} inputMode="decimal" className="mono" /></Field></div>
              <div style={{ width: 110 }}><Field label="Currency"><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} options={[...new Set([...(currency ? [currency] : []), ...CURRENCIES, ...(f.currency ? [f.currency] : [])])]} placeholder="None" humanizeLabels={false} /></Field></div>
              <div style={{ flex: 1, minWidth: 140 }}>
                {subtotal != null
                  ? <Field label="Subtotal" help="Amt × X × Rate"><div className="bold mono" style={{ padding: "9px 0" }}>{fmtMoney(subtotal, f.currency)}</div></Field>
                  : <Field label={`Amount${inCurrency(f.currency)}`} help="Or fill in Amt and Rate"><Input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>}
              </div>
            </div>
          </div>
          <Field label="Scene"><SceneSelect value={f.sceneId} onChange={(sceneId) => setF({ ...f, sceneId })} /></Field>
          <Field label="Character"><CharacterSelect value={f.characterId} onChange={(characterId) => setF({ ...f, characterId })} /></Field>
          <Field label="Vendor"><VendorSelect value={f.vendorId} onChange={(vendorId) => setF({ ...f, vendorId })} /></Field>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        </div>
        <ErrorBox error={create.error} />
      </Modal>
    </div>
  );
}
