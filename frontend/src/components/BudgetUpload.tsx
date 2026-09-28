import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet } from "lucide-react";
import { api, p } from "@/api/client";
import { useAuth } from "@/state/auth";
import { fmtDate, fmtMoney } from "@/lib/format";
import { ErrorBox, Input, Modal, Select, useToast } from "@/components/ui";

/** One line of the uploaded sheet, as the server read and matched it. Nothing is stored until Import. */
interface Line {
  sheet: string; row: number; description: string; category: string; categoryText: string | null; amount: number | null; date: string | null;
  scene: string | null; character: string | null; vendor: string | null; costume: string | null; isTotal: boolean;
  accountCode: string | null; quantity: number | null; unit: string | null; multiplier: number | null; rate: number | null;
  sceneId: string | null; characterId: string | null; vendorId: string | null; costumeId: string | null;
}
interface Preview { fileName: string; sheets: string[]; skippedSheets: string[]; lines: Line[] }
type Row = Line & { pick: boolean; note: string | null };

/** Why a line starts unticked; the user can still tick it once it is fixed. */
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

  const read = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append("file", f); return api<Preview>(p(projectId, "/expenses/import/preview"), { formData: fd }); },
    onSuccess: (res) => { setPreview(res); setRows(res.lines.map((l) => ({ ...l, pick: !noteOf(l), note: noteOf(l) }))); },
  });
  const picked = rows.filter((r) => r.pick);
  const bad = picked.find((r) => r.amount == null || r.amount < 0 || !r.description.trim());
  const total = picked.reduce((n, r) => n + (r.amount || 0), 0);
  const save = useMutation({
    mutationFn: () => api<{ count: number }>(p(projectId, "/expenses/import"), {
      body: { lines: picked.map((r) => ({ category: r.category, amount: r.amount, description: r.description.trim(), date: r.date, sceneId: r.sceneId, characterId: r.characterId, vendorId: r.vendorId, costumeId: r.costumeId, accountCode: r.accountCode, quantity: r.quantity, unit: r.unit, multiplier: r.multiplier, rate: r.rate, currency: currency || "" })) },
    }),
    onSuccess: ({ count }) => { qc.invalidateQueries({ queryKey: ["budget", projectId] }); toast.push(`${count} budget line${count === 1 ? "" : "s"} imported`, "ok"); onClose(); },
  });

  // A fresh start every time the dialog opens.
  useEffect(() => { if (open) { setPreview(null); setRows([]); read.reset(); save.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const allOn = rows.length > 0 && rows.every((r) => r.pick);
  const m = (n: number) => fmtMoney(n, currency || undefined);
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
      <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) read.mutate(f); }} />
      {!preview ? (
        <div className="col" style={{ alignItems: "center", textAlign: "center", padding: "24px 8px", gap: 10 }}>
          <FileSpreadsheet size={36} color="var(--text-3)" />
          <div className="bold">Excel (.xlsx) or CSV</div>
          <div className="subtle small" style={{ maxWidth: 520 }}>
            One line per row, under a header row. Amount is the only column it must have (or Qty and Rate). It also reads Description or Particulars, Category or Head, Date, Scene, Character and Vendor. Every sheet in the workbook is read, and nothing is saved until you press Import.
          </div>
          <button className="btn btn-primary mt-1" disabled={read.isPending} onClick={() => fileRef.current?.click()}>{read.isPending ? "Reading…" : "Choose file"}</button>
          <ErrorBox error={read.error} />
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          <div className="subtle small">
            <b>{preview.fileName}</b> · {rows.length} line{rows.length === 1 ? "" : "s"} found{preview.sheets.length > 1 ? ` in ${preview.sheets.length - preview.skippedSheets.length} sheet${preview.sheets.length - preview.skippedSheets.length === 1 ? "" : "s"}` : ""}
            {preview.skippedSheets.length > 0 && preview.sheets.length > 1 ? ` · skipped ${preview.skippedSheets.join(", ")} (no header row with an amount)` : ""}. Untick anything you don't want, and fix a category or description before importing.
          </div>
          <div className="table-wrap" style={{ maxHeight: "55vh", overflowY: "auto" }}>
            <table className="table">
              <thead><tr>
                <th style={{ width: 28 }}><input type="checkbox" aria-label="Tick all" checked={allOn} onChange={(e) => setRows((prev) => prev.map((r) => ({ ...r, pick: e.target.checked })))} /></th>
                <th>Row</th><th>Account</th><th>Description</th><th>Category</th><th className="right">Amount</th><th>Date</th><th>Scene</th><th>Character</th><th>Vendor</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.sheet}-${r.row}`} style={r.pick ? undefined : { opacity: 0.55 }}>
                    <td><input type="checkbox" aria-label={`Import row ${r.row}`} checked={r.pick} onChange={(e) => set(i, { pick: e.target.checked })} /></td>
                    <td className="subtle small nowrap">{preview.sheets.length > 1 ? `${r.sheet} · ` : ""}{r.row}{r.note && <div className="tiny" style={{ color: "var(--warn)" }}>{r.note}</div>}</td>
                    <td className="mono small nowrap">{r.accountCode || <span className="subtle">—</span>}</td>
                    <td style={{ minWidth: 220 }}><Input value={r.description} onChange={(e) => set(i, { description: e.target.value })} aria-label={`Description, row ${r.row}`} /></td>
                    <td style={{ minWidth: 140 }}><Select value={r.category} onChange={(e) => set(i, { category: e.target.value })} options={cats} aria-label={`Category, row ${r.row}`} title={r.categoryText ? `Sheet says “${r.categoryText}”` : undefined} /></td>
                    <td className="right nowrap bold" title={r.quantity != null && r.rate != null ? `${r.quantity} ${r.unit || ""} × ${r.multiplier ?? 1} × ${r.rate}` : undefined}>{r.amount == null ? <span className="subtle">—</span> : m(r.amount)}</td>
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
