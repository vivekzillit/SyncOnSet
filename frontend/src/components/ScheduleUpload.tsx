import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ClipboardList, FileText, Upload } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { dateKey, fmtDate } from "@/lib/format";
import { Badge, ErrorBox, Input, Modal, useToast } from "./ui";

export type DocKind = "SCHEDULE" | "CALLSHEET";
interface PreviewScene { number: string; id: string | null; exists: boolean; name: string | null; location: string | null; intExt: string | null; status: string | null; currentShootDate: string | null; date: string | null; dayNumber: number | null }
interface ParseResult { kind: DocKind; file: string; format: string; date: string | null; dayNumber: number | null; days: number; scenes: PreviewScene[]; warnings: string[]; breakdownEmpty: boolean }

const LABEL: Record<DocKind, string> = { SCHEDULE: "schedule", CALLSHEET: "callsheet" };
/** yyyy-mm-dd from a date input → ISO at local midnight, the same convention as the scene editor. */
const localMidnightISO = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, m - 1, d).toISOString(); };

/** Upload a schedule or call sheet, review the shoot date each scene gets, then apply. Nothing is saved until Apply. */
export function ScheduleUploadModal({ open, kind, onClose, onApplied }: { open: boolean; kind: DocKind; onClose: () => void; onApplied?: () => void }) {
  const { projectId } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const parse = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append("file", f); fd.append("kind", kind); return api<ParseResult>(p(projectId, "/schedule/parse"), { formData: fd }); },
    onSuccess: (r) => {
      setResult(r);
      setDates(Object.fromEntries(r.scenes.map((s) => [s.number, s.date || ""])));
      // Scenes the document names but the breakdown does not have cannot be scheduled, so they start unticked.
      setExcluded(new Set(r.scenes.filter((s) => !s.exists).map((s) => s.number)));
    },
  });
  const included = useMemo(() => (result?.scenes || []).filter((s) => s.exists && s.id && !excluded.has(s.number) && dates[s.number]), [result, excluded, dates]);
  const apply = useMutation({
    mutationFn: () => api<{ updated: number }>(p(projectId, "/schedule/apply"), { body: { assignments: included.map((s) => ({ sceneId: s.id as string, date: localMidnightISO(dates[s.number]) })) } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["scenes", projectId] });
      toast.push(`${r.updated} scene${r.updated === 1 ? "" : "s"} scheduled from the ${LABEL[kind]}`, "ok");
      onApplied?.(); reset(); onClose();
    },
  });
  const reset = () => { setFile(null); setResult(null); setDates({}); setExcluded(new Set()); if (fileRef.current) fileRef.current.value = ""; };
  const pick = (f: File | null) => { if (!f) return; setFile(f); parse.mutate(f); };
  const toggle = (n: string) => setExcluded((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });
  const unmatched = (result?.scenes || []).filter((s) => !s.exists).length;
  const changed = included.filter((s) => dateKey(s.currentShootDate) !== dates[s.number]).length;
  const title = kind === "CALLSHEET" ? "Upload callsheet" : "Upload schedule";
  const Icon = kind === "CALLSHEET" ? ClipboardList : CalendarDays;

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title={<span className="row gap-1"><Icon size={18} /> {title}</span>} wide
      footer={<><button className="btn" onClick={() => { reset(); onClose(); }}>Cancel</button>{result && <button className="btn btn-primary" disabled={!included.length || apply.isPending} onClick={() => apply.mutate()}>{apply.isPending ? "Applying…" : `Apply to ${included.length} scene${included.length === 1 ? "" : "s"}`}</button>}</>}>
      {!result ? (
        <div className="col gap-2">
          <div className="notice info">
            {kind === "CALLSHEET"
              ? "Upload the callsheet and the shoot date is read straight from it: the date on the sheet and the scene numbers listed on it. Those scenes get that date and show under Today. You review everything before anything is saved."
              : "Upload the shooting schedule and the shoot dates are read straight from it: each shoot day and the scenes on it. Those scenes get their date and show under Upcoming. You review everything before anything is saved."}
          </div>
          <div className="card flat" style={{ borderStyle: "dashed", textAlign: "center", padding: 28, cursor: "pointer" }} onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0] || null); }}>
            <Upload size={28} color="var(--text-3)" />
            <div className="bold mt-1">{parse.isPending ? `Reading ${file?.name}…` : `Drop the ${LABEL[kind]} here or click to choose`}</div>
            <div className="subtle mt-1">PDF exported from Movie Magic, StudioBinder, Celtx or Excel · CSV · plain text</div>
            <input ref={fileRef} type="file" accept=".pdf,.csv,.tsv,.txt,application/pdf,text/csv,text/plain" hidden onChange={(e) => pick(e.target.files?.[0] || null)} />
          </div>
          <div className="subtle">Only the shoot dates change. Scene numbers that are not in the breakdown are listed and skipped.</div>
          <ErrorBox error={parse.error} />
        </div>
      ) : (
        <div className="col gap-2">
          <div className="row gap-2 wrap">
            <FileText size={16} /><span className="bold">{result.file}</span><Badge status="INFO">{result.format.toUpperCase()}</Badge>
            <span className="subtle">{result.scenes.length} scene{result.scenes.length === 1 ? "" : "s"} · {result.days} shoot day{result.days === 1 ? "" : "s"}{result.dayNumber != null ? ` · Day ${result.dayNumber}` : ""}</span>
            <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={reset}>Choose another file</button>
          </div>
          {result.breakdownEmpty && <div className="notice">There are no scenes in this production yet, so nothing can be scheduled. Upload the script first, then this {LABEL[kind]}.</div>}
          {result.warnings.map((w, i) => <div key={i} className="notice">{w}</div>)}
          <div className="notice ok">{included.length} scene{included.length === 1 ? "" : "s"} will be scheduled{changed ? `, ${changed} with a new date` : ""}{unmatched ? `; ${unmatched} scene number${unmatched === 1 ? "" : "s"} not in the breakdown` : ""}. Only the shoot date changes; nothing is deleted.</div>
          <div className="table-wrap card flat pad-0" style={{ maxHeight: "46vh", overflowY: "auto" }}>
            <table className="table">
              <thead><tr><th></th><th>Sc</th><th>Slugline</th><th>Shoot date</th><th className="hide-mobile">Currently</th><th>Status</th></tr></thead>
              <tbody>
                {result.scenes.map((s) => (
                  <tr key={s.number} style={{ opacity: s.exists && !excluded.has(s.number) ? 1 : 0.45 }}>
                    <td><input type="checkbox" checked={s.exists && !excluded.has(s.number)} disabled={!s.exists} onChange={() => toggle(s.number)} aria-label={`Schedule scene ${s.number}`} /></td>
                    <td className="mono bold nowrap">{s.number}</td>
                    <td><div className="bold">{[s.intExt, s.location].filter(Boolean).join(". ") || s.name || (s.exists ? "" : "—")}</div>{s.dayNumber != null && <div className="subtle tiny">Day {s.dayNumber}</div>}</td>
                    <td><Input type="date" value={dates[s.number] || ""} disabled={!s.exists} onChange={(e) => setDates((d) => ({ ...d, [s.number]: e.target.value }))} style={{ minWidth: 150 }} aria-label={`Shoot date for scene ${s.number}`} /></td>
                    <td className="hide-mobile nowrap subtle">{s.currentShootDate ? fmtDate(s.currentShootDate) : "—"}</td>
                    <td>{!s.exists ? <Badge status="MUTED">Not in breakdown</Badge> : !dates[s.number] ? <Badge status="WARNING">No date</Badge> : dateKey(s.currentShootDate) === dates[s.number] ? <Badge status="MUTED">Unchanged</Badge> : s.currentShootDate ? <Badge status="WARNING">Date changes</Badge> : <Badge status="READY">Scheduled</Badge>}</td>
                  </tr>
                ))}
                {result.scenes.length === 0 && <tr><td colSpan={6} className="subtle">No scene numbers were found in this file.</td></tr>}
              </tbody>
            </table>
          </div>
          <ErrorBox error={apply.error} />
        </div>
      )}
    </Modal>
  );
}
