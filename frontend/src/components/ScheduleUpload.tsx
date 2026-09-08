import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ClipboardList, FileText, Upload } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { fmtDate } from "@/lib/format";
import { Badge, ErrorBox, Input, Modal, useToast } from "./ui";
import type { ProductionDocument } from "@/api/types";

export type DocKind = "SCHEDULE" | "CALLSHEET";
interface PreviewScene { number: string; id: string | null; exists: boolean; currentShootDate: string | null; status: string | null }
interface PreviewDay { date: string | null; dayNumber: number | null; label: string; scenes: PreviewScene[] }
interface ParseResult { document: ProductionDocument; kind: DocKind; file: string; format: string; date: string | null; dayNumber: number | null; days: PreviewDay[]; matched: number; unmatched: string[]; warnings: string[]; breakdownEmpty: boolean }

export const DOC_LABEL: Record<DocKind, string> = { SCHEDULE: "schedule", CALLSHEET: "callsheet" };
/** yyyy-mm-dd from a date input → ISO at local midnight, the same convention as the scene editor. */
const localMidnightISO = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, m - 1, d).toISOString(); };

/** Upload a shooting schedule or a call sheet, review the shoot days it names, then give those scenes their shoot date. */
export function ScheduleUploadModal({ open, kind, onClose, onApplied }: { open: boolean; kind: DocKind; onClose: () => void; onApplied?: () => void }) {
  const { projectId } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [days, setDays] = useState<PreviewDay[]>([]);

  const parse = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append("file", f); fd.append("kind", kind); return api<ParseResult>(p(projectId, "/schedule/parse"), { formData: fd }); },
    onSuccess: (r) => { setResult(r); setDays(r.days); },
  });
  const assignments = days.flatMap((d) => (d.date ? d.scenes.filter((s) => s.exists && s.id).map((s) => ({ sceneId: s.id as string, date: localMidnightISO(d.date as string) })) : []));
  const apply = useMutation({
    mutationFn: () => api<{ updated: number }>(p(projectId, "/schedule/apply"), { body: { documentId: result?.document.id, assignments } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["scenes", projectId] });
      qc.invalidateQueries({ queryKey: ["schedule-docs", projectId] });
      toast.push(`${r.updated} scene${r.updated === 1 ? "" : "s"} scheduled from the ${DOC_LABEL[kind]}`, "ok");
      onApplied?.(); reset(); onClose();
    },
  });
  const reset = () => { setFile(null); setResult(null); setDays([]); if (fileRef.current) fileRef.current.value = ""; };
  const pick = (f: File | null) => { if (!f) return; setFile(f); parse.mutate(f); };
  const setDate = (i: number, date: string) => setDays((all) => all.map((d, j) => (j === i ? { ...d, date: date || null } : d)));
  const undated = days.filter((d) => !d.date).reduce((n, d) => n + d.scenes.filter((s) => s.exists).length, 0);
  const title = kind === "CALLSHEET" ? "Upload callsheet" : "Upload schedule";
  const Icon = kind === "CALLSHEET" ? ClipboardList : CalendarDays;

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title={<span className="row gap-1"><Icon size={18} /> {title}</span>} wide
      footer={<><button className="btn" onClick={() => { reset(); onClose(); }}>Cancel</button>{result && <button className="btn btn-primary" disabled={!assignments.length || apply.isPending} onClick={() => apply.mutate()}>{apply.isPending ? "Applying…" : `Apply to ${assignments.length} scene${assignments.length === 1 ? "" : "s"}`}</button>}</>}>
      {!result ? (
        <div className="col gap-2">
          <div className="notice info">
            {kind === "CALLSHEET"
              ? "Upload the callsheet as a PDF or text file. The shoot date and the scene numbers on it are read; those scenes get that date and appear under Today."
              : "Upload the shooting schedule as a PDF (the one-line schedule from Movie Magic, StudioBinder, Celtx…) or a CSV with Scene and Date columns. Each shoot day's scenes get that date and appear under Upcoming."}
          </div>
          <div className="card flat" style={{ borderStyle: "dashed", textAlign: "center", padding: 28, cursor: "pointer" }} onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0] || null); }}>
            <Upload size={28} color="var(--text-3)" />
            <div className="bold mt-1">{parse.isPending ? `Reading ${file?.name}…` : `Drop the ${DOC_LABEL[kind]} here or click to choose`}</div>
            <div className="subtle mt-1">PDF · CSV · plain text</div>
            <input ref={fileRef} type="file" accept=".pdf,.csv,.tsv,.txt,application/pdf,text/csv,text/plain" hidden onChange={(e) => pick(e.target.files?.[0] || null)} />
          </div>
          <div className="subtle">You review every date before anything is saved. Scene numbers that are not in the breakdown are listed and skipped.</div>
          <ErrorBox error={parse.error} />
        </div>
      ) : (
        <div className="col gap-2">
          <div className="row gap-2 wrap">
            <FileText size={16} /><span className="bold">{result.file}</span><Badge status="INFO">{result.format.toUpperCase()}</Badge>
            <span className="subtle">{days.length} shoot day{days.length === 1 ? "" : "s"} · {result.matched} scene{result.matched === 1 ? "" : "s"} matched{result.unmatched.length ? ` · ${result.unmatched.length} not in the breakdown` : ""}{result.dayNumber != null ? ` · Day ${result.dayNumber}` : ""}</span>
            <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={reset}>Choose another file</button>
          </div>
          {result.breakdownEmpty && <div className="notice">There are no scenes in this production yet, so nothing can be scheduled. Upload the script first, then this {DOC_LABEL[kind]}.</div>}
          {result.warnings.map((w, i) => <div key={i} className="notice">{w}</div>)}
          {undated > 0 && <div className="notice">{undated} matched scene{undated === 1 ? "" : "s"} have no date yet. Fill in the date to schedule them.</div>}
          <div className="table-wrap card flat pad-0" style={{ maxHeight: "46vh", overflowY: "auto" }}>
            <table className="table">
              <thead><tr><th style={{ width: 170 }}>Shoot date</th><th className="hide-mobile">Day</th><th>Scenes</th><th className="hide-mobile">Read from</th></tr></thead>
              <tbody>
                {days.map((d, i) => (
                  <tr key={i}>
                    <td><Input type="date" value={d.date || ""} onChange={(e) => setDate(i, e.target.value)} style={{ minWidth: 150 }} aria-label={`Shoot date for ${d.scenes.map((s) => s.number).join(", ")}`} /></td>
                    <td className="hide-mobile nowrap">{d.dayNumber != null ? `Day ${d.dayNumber}` : ""}</td>
                    <td><div className="chips">{d.scenes.map((s) => <span key={s.number} className="chip" title={s.exists ? (s.currentShootDate ? `Currently ${fmtDate(s.currentShootDate)}` : "In the breakdown") : "Not in the breakdown, skipped"} style={{ padding: "2px 8px", fontSize: 12, opacity: s.exists ? 1 : 0.4, textDecoration: s.exists ? undefined : "line-through" }}>{s.number}</span>)}</div></td>
                    <td className="hide-mobile subtle tiny" style={{ maxWidth: 260 }}><div className="truncate" title={d.label}>{d.label}</div></td>
                  </tr>
                ))}
                {days.length === 0 && <tr><td colSpan={4} className="subtle">No scene numbers were found in this file.</td></tr>}
              </tbody>
            </table>
          </div>
          {result.unmatched.length > 0 && <div className="subtle">Not in the breakdown (skipped): {result.unmatched.join(", ")}</div>}
          <ErrorBox error={apply.error} />
        </div>
      )}
    </Modal>
  );
}
