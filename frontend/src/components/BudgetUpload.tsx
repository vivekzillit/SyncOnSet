import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet } from "lucide-react";
import { api, p } from "@/api/client";
import { useAuth } from "@/state/auth";
import { fmtDate, fmtMoney } from "@/lib/format";
import { ErrorBox, Input, Modal, Select, useToast } from "@/components/ui";

/** One line of the uploaded sheet, as the server read and matched it. Nothing is stored until Import. */
interface Line {
  sheet: string; row: number; description: string; category: string; categoryText: string | null; amount: number | null; date: string | null;
  scene: string | null; character: string | null; vendor: string | null; costume: string | null; isTotal: boolean;
  accountCode: string | null; quantity: number | null; unit: string | null; multiplier: number | null; rate: number | null;
  accountName?: string | null; payee?: string | null; department?: string | null; currency?: string | null;
  sceneId: string | null; characterId: string | null; vendorId: string | null; costumeId: string | null;
}
interface Preview { fileName: string; sheets: string[]; skippedSheets: string[]; lines: Line[] }
type Row = Line & { pick: boolean; note: string | null };

/** Why a line starts unticked; the user can still tick it once it is fixed. */
/**
 * A blank budget sheet whose headers are exactly the ones the reader looks for. CSV so it opens straight in Excel,
 * Numbers or Google Sheets; Amount is a formula (Qty × X × Rate), and the reader also works it out when left blank.
 * The rows say "Example:" so a forgotten one is plain to see, and untick, in the preview.
 */
const TEMPLATE_HEAD = ["Account", "Description", "Category", "Date", "Scene", "Character", "Vendor", "Qty", "Unit", "X", "Rate", "Amount"];
const TEMPLATE_ROWS = [
  ["30-090", "Example: Police uniforms (khaki)", "Purchase", "21/09/2026", "24", "Inspector Pandey", "Raj Textiles", "4", "Each", "1", "3000"],
  ["30-090", "Example: Wig hire", "Rental", "22/09/2026", "32", "Raj", "", "3", "Days", "1", "1500"],
  ["30-040", "Example: Saree dry cleaning", "Laundry", "23/09/2026", "", "Priya", "", "2", "Each", "1", "900"],
  ["30-004", "Example: Costume standby", "Other", "", "", "", "", "5", "Days", "1", "2500"],
];
function downloadTemplate() {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [TEMPLATE_HEAD, ...TEMPLATE_ROWS.map((r, i) => [...r, `=H${i + 2}*J${i + 2}*K${i + 2}`])].map((r) => r.map(cell).join(","));
  const url = URL.createObjectURL(new Blob(["\uFEFF" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "Budget sheet template.csv" });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const noteOf = (l: Line) => (l.isTotal ? "Looks like a total row" : l.amount == null ? "No amount" : l.amount < 0 ? "Negative amount (a credit or refund)" : null);

/**
 * Upload a whole budget sheet (.xlsx or .csv): every line is previewed with a tick box, matched to this production's
 * scenes, characters and vendors by name, and only the ticked lines are written — the same principle as the script upload.
 */
export function BudgetUpload({ open, onClose, projectId, currency }: { open: boolean; onClose: () => void; projectId: string; currency?: string | null }) {
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const cats = meta?.expenseCategories || ["PURCHASE", "RENTAL", "LAUNDRY", "TAILORING", "ACCESSORIES", "DAMAGE", "OTHER"];
  /** A printed budget covers every department; only the chosen one is shown and imported ("" = all). */
  const [dept, setDept] = useState("");
  const isPdf = !!preview?.fileName.toLowerCase().endsWith(".pdf");
  const departments = [...new Set(rows.map((r) => r.department).filter((d): d is string => !!d))];

  const read = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append("file", f); return api<Preview>(p(projectId, "/expenses/import/preview"), { formData: fd }); },
    onSuccess: (res) => {
      setPreview(res);
      setRows(res.lines.map((l) => ({ ...l, pick: !noteOf(l), note: noteOf(l) })));
      // Costume & wardrobe teams mostly want their own department out of a whole-production budget.
      setDept(res.lines.find((l) => l.department && /wardrobe|costume/i.test(l.department))?.department || "");
    },
  });
  const inDept = (r: Row) => !dept || r.department === dept;
  const picked = rows.filter((r) => r.pick && inDept(r));
  const bad = picked.find((r) => r.amount == null || r.amount < 0 || !r.description.trim());
  const total = picked.reduce((n, r) => n + (r.amount || 0), 0);
  const lineCurrency = picked.find((r) => r.currency)?.currency || currency || undefined;
  const save = useMutation({
    mutationFn: () => api<{ count: number }>(p(projectId, "/expenses/import"), {
      body: { lines: picked.map((r) => ({ category: r.category, amount: r.amount, description: r.description.trim(), date: r.date, sceneId: r.sceneId, characterId: r.characterId, vendorId: r.vendorId, costumeId: r.costumeId, accountCode: r.accountCode, accountName: r.accountName || null, payee: r.payee || null, quantity: r.quantity, unit: r.unit, multiplier: r.multiplier, rate: r.rate, currency: r.currency || currency || "" })) },
    }),
    onSuccess: ({ count }) => { qc.invalidateQueries({ queryKey: ["budget", projectId] }); toast.push(`${count} budget line${count === 1 ? "" : "s"} imported`, "ok"); onClose(); },
  });

  // A fresh start every time the dialog opens.
  useEffect(() => { if (open) { setPreview(null); setRows([]); setDept(""); read.reset(); save.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => inDept(r));
  const allOn = shown.length > 0 && shown.every(({ r }) => r.pick);
  const m = (n: number, c?: string | null) => fmtMoney(n, c || lineCurrency);
  const matched = (text: string | null, id: string | null) => (!text ? <span className="subtle">—</span> : id ? text : <span className="subtle" title="Not found in this production, so it will not be linked">{text} · not found</span>);

  return (
    <Modal open={open} onClose={onClose} title="Upload budget sheet" wide
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        {preview && <button className="btn" onClick={() => fileRef.current?.click()} disabled={read.isPending}>Choose another file</button>}
        {preview && <button className="btn btn-primary" disabled={!picked.length || !!bad || save.isPending} title={bad ? `Row ${bad.row}: ${bad.note || "needs a description and an amount"}` : undefined} onClick={() => save.mutate()}>
          {save.isPending ? "Importing…" : `Import ${picked.length} line${picked.length === 1 ? "" : "s"} · ${m(total)}`}
        </button>}
      </>}>
      <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) read.mutate(f); }} />
      {!preview ? (
        <div className="col" style={{ alignItems: "center", textAlign: "center", padding: "24px 8px", gap: 10 }}>
          <FileSpreadsheet size={36} color="var(--text-3)" />
          <div className="bold">Excel (.xlsx), CSV or a budget PDF</div>
          <div className="subtle small" style={{ maxWidth: 520 }}>
            One line per row, under a header row. Amount is the only column it must have (or Qty and Rate). It also reads Description or Particulars, Category or Head, Date, Scene, Character and Vendor. Every sheet in the workbook is read. A budget PDF printed from Movie Magic or similar is read page by page: account code, Name, Amt, Unit, X, Rate and Subtotal. Nothing is saved until you press Import.
          </div>
          <div className="row gap-1 mt-1" style={{ flexWrap: "wrap", justifyContent: "center" }}>
            <button className="btn" onClick={downloadTemplate} title="A blank sheet with the right column headers and a few example rows"><Download size={16} /> Download template</button>
            <button className="btn btn-primary" disabled={read.isPending} onClick={() => fileRef.current?.click()}>{read.isPending ? "Reading…" : "Choose file"}</button>
          </div>
          <ErrorBox error={read.error} />
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {isPdf && departments.length > 1 && (
            <div className="row gap-2 wrap" style={{ alignItems: "center" }}>
              <span className="small bold">Department</span>
              <Select value={dept} onChange={(e) => setDept(e.target.value)} options={departments} placeholder={`All departments (${rows.length} lines)`} humanizeLabels={false} style={{ width: "auto", minWidth: 260 }} aria-label="Department" />
              <span className="subtle small">{shown.length} line{shown.length === 1 ? "" : "s"} · {m(shown.reduce((n, { r }) => n + (r.amount || 0), 0))}</span>
            </div>
          )}
          <div className="subtle small">
            <b>{preview.fileName}</b> · {rows.length} line{rows.length === 1 ? "" : "s"} found{isPdf ? ` across ${departments.length} department${departments.length === 1 ? "" : "s"}` : preview.sheets.length > 1 ? ` in ${preview.sheets.length - preview.skippedSheets.length} sheet${preview.sheets.length - preview.skippedSheets.length === 1 ? "" : "s"}` : ""}
            {preview.skippedSheets.length > 0 && preview.sheets.length > 1 ? ` · skipped ${preview.skippedSheets.join(", ")} (no header row with an amount)` : ""}. Untick anything you don't want, and fix a category or description before importing.
          </div>
          <div className="table-wrap" style={{ maxHeight: "55vh", overflowY: "auto" }}>
            <table className="table">
              <thead><tr>
                <th style={{ width: 28 }}><input type="checkbox" aria-label="Tick all" checked={allOn} onChange={(e) => setRows((prev) => prev.map((r) => (inDept(r) ? { ...r, pick: e.target.checked } : r)))} /></th>
                <th>{isPdf ? "Page" : "Row"}</th><th>Account</th>{isPdf && <th>Name</th>}<th>Description</th><th>Category</th><th className="right">Amount</th><th>Date</th><th>Scene</th><th>Character</th><th>Vendor</th>
              </tr></thead>
              <tbody>
                {shown.map(({ r, i }) => (
                  <tr key={`${r.sheet}-${r.row}-${i}`} style={r.pick ? undefined : { opacity: 0.55 }}>
                    <td><input type="checkbox" aria-label={`Import row ${r.row}`} checked={r.pick} onChange={(e) => set(i, { pick: e.target.checked })} /></td>
                    <td className="subtle small nowrap">{!isPdf && preview.sheets.length > 1 ? `${r.sheet} · ` : ""}{r.row}{r.note && <div className="tiny" style={{ color: "var(--warn)" }}>{r.note}</div>}</td>
                    <td className="small nowrap" title={r.accountName || undefined}><span className="mono">{r.accountCode || <span className="subtle">—</span>}</span>{r.accountName && <div className="tiny subtle truncate" style={{ maxWidth: 180 }}>{r.accountName}</div>}</td>
                    {isPdf && <td className="small nowrap">{r.payee || <span className="subtle">—</span>}</td>}
                    <td style={{ minWidth: 220 }}><Input value={r.description} onChange={(e) => set(i, { description: e.target.value })} aria-label={`Description, row ${r.row}`} /></td>
                    <td style={{ minWidth: 140 }}><Select value={r.category} onChange={(e) => set(i, { category: e.target.value })} options={cats} aria-label={`Category, row ${r.row}`} title={r.categoryText ? `Sheet says “${r.categoryText}”` : undefined} /></td>
                    <td className="right nowrap bold" title={r.quantity != null && r.rate != null ? `${r.quantity} ${r.unit || ""} × ${r.multiplier ?? 1} × ${r.rate}` : undefined}>{r.amount == null ? <span className="subtle">—</span> : m(r.amount, r.currency)}</td>
                    <td className="nowrap">{r.date ? fmtDate(r.date) : <span className="subtle" title="Saved with today's date">Today</span>}</td>
                    <td className="nowrap">{matched(r.scene, r.sceneId)}</td>
                    <td className="nowrap">{matched(r.character, r.characterId)}</td>
                    <td className="nowrap">{matched(r.vendor, r.vendorId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ErrorBox error={read.error || save.error} />
        </div>
      )}
    </Modal>
  );
}
