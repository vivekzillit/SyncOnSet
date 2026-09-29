import { Fragment, type ReactNode } from "react";
import { humanize } from "@/lib/format";
import { sumByCurrency } from "@/lib/budgetAccounts";
import type { Expense } from "@/api/types";

export interface SheetGroup { key: string; title: string; lines: Expense[] }

const byCode = (a: string, b: string) => (!a ? 1 : !b ? -1 : a.localeCompare(b, undefined, { numeric: true }));
/** Lines of one group, by account code (uncoded last, under their category), then by the "Name:" they are paid to. */
function accountsOf(lines: Expense[]) {
  const acc = new Map<string, { code: string; name: string; lines: Expense[] }>();
  for (const l of lines) {
    const code = (l.accountCode || "").trim();
    const k = code || `cat:${l.category}`;
    const a = acc.get(k) || { code, name: l.accountName || (code ? "" : humanize(l.category)), lines: [] };
    if (!a.name && l.accountName) a.name = l.accountName;
    a.lines.push(l);
    acc.set(k, a);
  }
  return [...acc.values()].sort((a, b) => byCode(a.code, b.code) || a.name.localeCompare(b.name));
}
/** Lines read in the order they were entered (Prep, Shoot, Wrap…), as the sheet lists them. */
const entered = (a: Expense, b: Expense) => (a.createdAt || a.date).localeCompare(b.createdAt || b.date);
function payeesOf(lines: Expense[]) {
  const out = new Map<string, Expense[]>();
  for (const l of [...lines].sort(entered)) { const k = (l.payee || "").trim(); out.set(k, [...(out.get(k) || []), l]); }
  return [...out.entries()].sort(([a], [b]) => (!a ? -1 : !b ? 1 : 0));
}
const num = (n?: number | null) => (n == null ? "" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n));

/**
 * The budget read the way a production budget prints (Movie Magic): a header per scene or character, a block per account
 * code with its title, "Name:" rows for who is paid, then Amt · Unit · X · Rate · Subtotal lines and a Total per account.
 */
export function BudgetSheet({ groups, currency, fmt, onEdit, empty, lineActions, plain }: { groups: SheetGroup[]; currency: string; fmt: (n: number, currency: string) => string; onEdit?: (e: Expense) => void; empty?: ReactNode; lineActions?: (e: Expense) => ReactNode; plain?: boolean }) {
  const total = (lines: Expense[]) => sumByCurrency(lines, currency, fmt);
  // An actions column (share, discuss, delete) sits after Subtotal when the page asks for one.
  const cols = lineActions ? 8 : 7;
  const pad = lineActions ? <td /> : null;
  const all = groups.flatMap((g) => g.lines);
  if (!groups.length) return <>{empty}</>;
  const codeCell = (text: string, first: boolean) => (
    <td className="bs-code" style={first ? undefined : { borderTopColor: "transparent" }}>{first && text ? <span className="bs-code-mark">{text}</span> : null}</td>
  );
  return (
    // `plain` drops the scroll box: a printed budget runs down the page instead of inside a window.
    <div className={plain ? undefined : "table-wrap table-scroll"}>
      <table className="table budget-sheet">
        <thead><tr><th style={{ width: 96 }}>Account</th><th>Description</th><th className="right" style={{ width: 70 }}>Amt</th><th style={{ width: 80 }}>Unit</th><th className="right" style={{ width: 50 }}>X</th><th className="right" style={{ width: 100 }}>Rate</th><th className="right" style={{ width: 120 }}>Subtotal</th>{lineActions && <th style={{ width: 130 }}><span className="sr-only">Actions</span></th>}</tr></thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.key}>
              <tr className="bs-group"><td colSpan={cols}>{g.title}</td></tr>
              {accountsOf(g.lines).map((a) => (
                <Fragment key={a.code || a.name}>
                  <tr className="bs-account">{codeCell(a.code, true)}<td colSpan={cols - 1}>{a.name || <span className="subtle">No account name</span>}</td></tr>
                  {payeesOf(a.lines).map(([payee, lines]) => (
                    <Fragment key={payee}>
                      {payee && <tr className="bs-name">{codeCell("", false)}<td colSpan={cols - 1}>Name: {payee}</td></tr>}
                      {lines.map((l) => (
                        <tr key={l.id} className={onEdit ? "bs-line row-link" : "bs-line"} onClick={onEdit ? () => onEdit(l) : undefined} title={onEdit ? "Edit this line" : undefined}>
                          {codeCell("", false)}
                          <td>{l.description?.trim() ? l.description : <span className="subtle">{l.accountName || l.payee || "—"}</span>}</td>
                          <td className="right mono">{num(l.quantity)}</td>
                          <td>{l.unit || ""}</td>
                          <td className="right mono">{l.quantity != null ? num(l.multiplier ?? 1) : ""}</td>
                          <td className="right mono">{num(l.rate)}</td>
                          <td className="right mono nowrap">{fmt(l.amount, l.currency || currency)}</td>
                          {lineActions && <td className="right nowrap" onClick={(e) => e.stopPropagation()}>{lineActions(l)}</td>}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                  <tr className="bs-total">{codeCell("", false)}<td colSpan={5}>Total</td><td className="right nowrap">{total(a.lines)}</td>{pad}</tr>
                </Fragment>
              ))}
              <tr className="bs-group-total"><td /><td colSpan={5}>Total · {g.title}</td><td className="right nowrap">{total(g.lines)}</td>{pad}</tr>
            </Fragment>
          ))}
          {groups.length > 1 && <tr className="bs-grand"><td /><td colSpan={5}>Grand Total</td><td className="right nowrap">{total(all)}</td>{pad}</tr>}
        </tbody>
      </table>
    </div>
  );
}
