import { Fragment } from "react";
import { fmtDate, humanize, projectTypeLabel } from "@/lib/format";
import { DEPARTMENTS, sumByCurrency } from "@/lib/budgetAccounts";
import { BudgetSheet, type SheetGroup } from "@/components/BudgetSheet";
import type { Expense, Project } from "@/api/types";

/**
 * The sections a feature budget's top sheet is read in, by the head of the account code — above the line,
 * the shooting period, post, and the costs that sit outside all three. Anything from 70 up (residuals, fees,
 * contingency) is listed line by line under them, as a printed budget does.
 */
const SECTIONS: { title: string; from: number; to: number; atl?: boolean }[] = [
  { title: "TOTAL ABOVE THE LINE", from: 11, to: 19, atl: true },
  { title: "TOTAL PRODUCTION", from: 20, to: 49 },
  { title: "TOTAL POST PRODUCTION", from: 50, to: 63 },
  { title: "TOTAL OTHER COSTS", from: 64, to: 69 },
];

export interface TopRow { key: string; code: string; title: string; lines: Expense[] }

/** One row per department, in chart order, the way a top sheet lists them; uncoded spend comes last. */
export function topSheetRows(expenses: Expense[]): TopRow[] {
  const by = new Map<string, TopRow>();
  for (const e of expenses) {
    const head = (e.accountCode || "").trim().split(/[-.\s]/)[0];
    const key = head || `cat:${e.category}`;
    const row = by.get(key) || {
      key,
      code: head ? `${head}-000` : "",
      title: head ? DEPARTMENTS[head] || "OTHER" : humanize(e.category).toUpperCase(),
      lines: [],
    };
    row.lines.push(e);
    by.set(key, row);
  }
  return [...by.values()].sort((a, b) => (!a.code ? 1 : !b.code ? -1 : a.code.localeCompare(b.code, undefined, { numeric: true })));
}
const headOf = (row: TopRow) => Number(row.code.split("-")[0]) || 0;
const inSection = (row: TopRow, s: { from: number; to: number }) => { const n = headOf(row); return !!row.code && n >= s.from && n <= s.to; };

/** The top sheet as plain text, for a message: the same rows, in the same order, that the document prints. */
export function topSheetText(project: Project | null, expenses: Expense[], currency: string, fmt: (n: number, c: string) => string) {
  const rows = topSheetRows(expenses);
  const line = (label: string, lines: Expense[]) => `${label}  ${sumByCurrency(lines, currency, fmt)}`;
  const out = [`${(project?.name || "Production").toUpperCase()} · BUDGET`, ""];
  for (const s of SECTIONS) {
    const inS = rows.filter((r) => inSection(r, s));
    if (!inS.length) continue;
    for (const r of inS) out.push(line(`${r.code} ${r.title}`, r.lines));
    out.push(line(s.title, inS.flatMap((r) => r.lines)));
    out.push("");
  }
  const rest = rows.filter((r) => !SECTIONS.some((s) => inSection(r, s)));
  for (const r of rest) out.push(line(r.code ? `${r.code} ${r.title}` : r.title, r.lines));
  out.push("", line("GRAND TOTAL", expenses));
  return out.join("\n");
}

/**
 * The whole budget laid out the way a production budget prints: a top sheet of departments with their section
 * totals and a grand total, then the detail pages account by account. Shown only when the page is printed —
 * on screen the same numbers are read through the Full budget view.
 */
export function BudgetDocument({ project, expenses, groups, currency, fmt }: { project: Project | null; expenses: Expense[]; groups: SheetGroup[]; currency: string; fmt: (n: number, c: string) => string }) {
  const rows = topSheetRows(expenses);
  const total = (lines: Expense[]) => sumByCurrency(lines, currency, fmt);
  const atl = rows.filter((r) => SECTIONS.filter((s) => s.atl).some((s) => inSection(r, s))).flatMap((r) => r.lines);
  const btl = expenses.filter((e) => !atl.includes(e));
  const rest = rows.filter((r) => !SECTIONS.some((s) => inSection(r, s)));
  const shootDays = project?.startDate && project?.endDate
    ? Math.round((new Date(project.endDate).getTime() - new Date(project.startDate).getTime()) / 86400000) + 1
    : null;

  return (
    <div className="print-only budget-doc">
      <div className="bd-cover">
        <h1>{project?.name || "Production"}</h1>
        <div className="bd-sub">BUDGET · {fmtDate(new Date(), { day: "2-digit", month: "long", year: "numeric" })}</div>
        <div className="bd-meta">
          <div>
            {project?.type && <div>{projectTypeLabel(project.type)}</div>}
            {project?.studio && <div>{project.studio}</div>}
            {[project?.city, project?.country].filter(Boolean).length > 0 && <div>{[project?.city, project?.country].filter(Boolean).join(", ")}</div>}
          </div>
          <div className="right">
            {project?.prepStartDate && <div>Prep from {fmtDate(project.prepStartDate, { day: "2-digit", month: "short", year: "numeric" })}</div>}
            {project?.startDate && <div>Shoot from {fmtDate(project.startDate, { day: "2-digit", month: "short", year: "numeric" })}{shootDays ? ` · ${shootDays} days` : ""}</div>}
            {project?.wrapDate && <div>Wrap {fmtDate(project.wrapDate, { day: "2-digit", month: "short", year: "numeric" })}</div>}
            {currency && <div>All figures in {currency}</div>}
          </div>
        </div>
      </div>

      <table className="table bd-top">
        <thead><tr><th style={{ width: 90 }}>Account</th><th>Description</th><th className="right" style={{ width: 140 }}>Total</th></tr></thead>
        <tbody>
          {SECTIONS.map((s) => {
            const inS = rows.filter((r) => inSection(r, s));
            if (!inS.length) return null;
            return (
              <Fragment key={s.title}>
                {inS.map((r) => (
                  <tr key={r.key}><td className="mono">{r.code}</td><td>{r.title}</td><td className="right nowrap">{total(r.lines)}</td></tr>
                ))}
                <tr className="bd-section"><td /><td>{s.title}</td><td className="right nowrap">{total(inS.flatMap((r) => r.lines))}</td></tr>
              </Fragment>
            );
          })}
          {rest.map((r) => (
            <tr key={r.key}><td className="mono">{r.code}</td><td>{r.title}</td><td className="right nowrap">{total(r.lines)}</td></tr>
          ))}
          <tr className="bd-section"><td /><td>Total Above-The-Line</td><td className="right nowrap">{total(atl)}</td></tr>
          <tr className="bd-section"><td /><td>Total Below-The-Line</td><td className="right nowrap">{total(btl)}</td></tr>
          <tr className="bd-grand"><td /><td>Grand Total</td><td className="right nowrap">{total(expenses)}</td></tr>
        </tbody>
      </table>

      <div className="bd-details">
        <div className="bd-label">Details</div>
        <BudgetSheet groups={groups} currency={currency} fmt={fmt} plain />
      </div>

      <div className="bd-foot">{project?.name || "Production"}</div>
    </div>
  );
}
