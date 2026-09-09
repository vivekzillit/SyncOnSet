import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ClipboardList, FileText, Upload } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { dateKey, fmtDate, humanize } from "@/lib/format";
import { Badge, ErrorBox, Input, Modal, useToast } from "./ui";

export type DocKind = "SCHEDULE" | "CALLSHEET";
interface SceneFields { intExt: string | null; location: string | null; timeOfDay: string | null; name: string | null; pages: string | null; scriptDay: string | null; description?: string | null }
interface PreviewScene {
  number: string; id: string | null; exists: boolean; status: string | null; currentShootDate: string | null;
  current: SceneFields | null; read: SceneFields; fills: string[];
  cast: { castNumber: number; id: string | null; name: string | null }[];
  date: string | null; dayNumber: number | null;
}
interface ParseResult { kind: DocKind; file: string; format: string; date: string | null; dayNumber: number | null; days: number; scenes: PreviewScene[]; warnings: string[]; breakdownEmpty: boolean; knownCastNumbers: number }

const LABEL: Record<DocKind, string> = { SCHEDULE: "schedule", CALLSHEET: "callsheet" };
/** yyyy-mm-dd from a date input → ISO at local midnight, the same convention as the scene editor. */
const localMidnightISO = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, m - 1, d).toISOString(); };
const slug = (f: SceneFields | null) => (f ? [f.intExt, f.location].filter(Boolean).join(". ") || f.name || "" : "");

/** Upload a schedule or call sheet, review what it says about each scene, then apply. Nothing is saved until Apply. */
export function ScheduleUploadModal({ open, kind, onClose, onApplied }: { open: boolean; kind: DocKind; onClose: () => void; onApplied?: (shootDate?: string | null) => void }) {
  const { projectId } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [createMissing, setCreateMissing] = useState(true);
  const [fillBlanks, setFillBlanks] = useState(true);

  const parse = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append("file", f); fd.append("kind", kind); return api<ParseResult>(p(projectId, "/schedule/parse"), { formData: fd }); },
    onSuccess: (r) => {
      setResult(r);
      setDates(Object.fromEntries(r.scenes.map((s) => [s.number, s.date || ""])));
      setExcluded(new Set());
      setCreateMissing(r.scenes.some((s) => !s.exists));
    },
  });
  const rows = result?.scenes || [];
  const included = useMemo(() => rows.filter((s) => !excluded.has(s.number) && (s.exists || createMissing)), [rows, excluded, createMissing]);
  const newScenes = included.filter((s) => !s.exists).length;
  const scheduled = included.filter((s) => s.exists && dates[s.number]).length;
  const fills = fillBlanks ? included.filter((s) => s.exists).reduce((n, s) => n + s.fills.length, 0) : 0;
  const links = included.reduce((n, s) => n + s.cast.filter((c) => c.id).length, 0);
  const skipped = rows.filter((s) => !s.exists && !createMissing).length;

  const apply = useMutation({
    mutationFn: () => api<{ updated: number; created: number; filled: number; linked: number }>(p(projectId, "/schedule/apply"), {
      body: {
        assignments: included.map((s) => ({
          sceneId: s.id, number: s.number,
          date: dates[s.number] ? localMidnightISO(dates[s.number]) : null,
          create: !s.exists && createMissing,
          // A new scene always takes what the file says; an existing one only where "fill in blanks" is ticked.
          fields: fillBlanks || !s.exists ? { name: s.read.name, location: s.read.location, intExt: s.read.intExt, timeOfDay: s.read.timeOfDay, pages: s.read.pages, scriptDay: s.read.scriptDay } : undefined,
          cast: s.cast.filter((c) => c.id).map((c) => c.castNumber),
        })),
      },
    }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["scenes", projectId] });
      qc.invalidateQueries({ queryKey: ["characters", projectId] });
      const bits = [r.created ? `${r.created} scene${r.created === 1 ? "" : "s"} added` : "", r.updated ? `${r.updated} updated` : "", r.filled ? `${r.filled} detail${r.filled === 1 ? "" : "s"} filled in` : "", r.linked ? `${r.linked} cast link${r.linked === 1 ? "" : "s"}` : ""].filter(Boolean);
      toast.push(`${bits.join(", ") || "Nothing to change"} from the ${LABEL[kind]}`, "ok");
      const applied = included.map((sc) => dates[sc.number]).filter(Boolean).sort()[0] || result?.date || null;
      onApplied?.(applied); reset(); onClose();
    },
  });
  const reset = () => { setFile(null); setResult(null); setDates({}); setExcluded(new Set()); if (fileRef.current) fileRef.current.value = ""; };
  const pick = (f: File | null) => { if (!f) return; setFile(f); parse.mutate(f); };
  const toggle = (n: string) => setExcluded((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });
  const title = kind === "CALLSHEET" ? "Upload callsheet" : "Upload schedule";
  const Icon = kind === "CALLSHEET" ? ClipboardList : CalendarDays;

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title={<span className="row gap-1"><Icon size={18} /> {title}</span>} wide
      footer={<><button className="btn" onClick={() => { reset(); onClose(); }}>Cancel</button>{result && <button className="btn btn-primary" disabled={!included.length || apply.isPending} onClick={() => apply.mutate()}>{apply.isPending ? "Applying…" : `Apply to ${included.length} scene${included.length === 1 ? "" : "s"}`}</button>}</>}>
      {!result ? (
        <div className="col gap-2">
          <div className="notice info">
            Upload the {LABEL[kind]} and the breakdown is read straight from it, the same way as a script: the shoot {kind === "CALLSHEET" ? "date" : "dates"}, and for every scene the set, INT/EXT, day or night, page count and cast numbers. You review everything before anything is saved.
          </div>
          <div className="card flat" style={{ borderStyle: "dashed", textAlign: "center", padding: 28, cursor: "pointer" }} onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0] || null); }}>
            <Upload size={28} color="var(--text-3)" />
            <div className="bold mt-1">{parse.isPending ? `Reading ${file?.name}…` : `Drop the ${LABEL[kind]} here or click to choose`}</div>
            <div className="subtle mt-1">PDF from Movie Magic, StudioBinder, Celtx, Word or Excel · CSV · plain text</div>
            <input ref={fileRef} type="file" accept=".pdf,.csv,.tsv,.txt,application/pdf,text/csv,text/plain" hidden onChange={(e) => pick(e.target.files?.[0] || null)} />
          </div>
          <div className="subtle">Scenes already in the breakdown keep what they have; only blanks are filled in. Nothing is ever deleted.</div>
          <ErrorBox error={parse.error} />
        </div>
      ) : (
        <div className="col gap-2">
          <div className="row gap-2 wrap">
            <FileText size={16} /><span className="bold">{result.file}</span><Badge status="INFO">{result.format.toUpperCase()}</Badge>
            <span className="subtle">{rows.length} scene{rows.length === 1 ? "" : "s"} · {result.days} shoot day{result.days === 1 ? "" : "s"}{result.dayNumber != null ? ` · Day ${result.dayNumber}` : ""}</span>
            <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={reset}>Choose another file</button>
          </div>
          {result.warnings.map((w, i) => <div key={i} className="notice">{w}</div>)}
          <div className="notice ok">
            {[newScenes ? `${newScenes} scene${newScenes === 1 ? "" : "s"} will be added` : "", scheduled ? `${scheduled} scheduled` : "", fills ? `${fills} blank detail${fills === 1 ? "" : "s"} filled in` : "", links ? `${links} cast link${links === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ") || "Nothing to change"}
            {skipped ? `; ${skipped} scene${skipped === 1 ? "" : "s"} not in the breakdown will be skipped` : ""}. Existing details are kept; nothing is deleted.
          </div>
          <div className="row gap-3 wrap">
            <label className="check"><input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} /> Add scenes that are not in the breakdown yet</label>
            <label className="check"><input type="checkbox" checked={fillBlanks} onChange={(e) => setFillBlanks(e.target.checked)} /> Fill in blank details on existing scenes</label>
          </div>
          <div className="table-wrap card flat pad-0" style={{ maxHeight: "44vh", overflowY: "auto" }}>
            <table className="table">
              <thead><tr><th></th><th>Sc</th><th>Slugline</th><th>Shoot date</th><th className="hide-mobile">From the file</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((s) => {
                  const on = !excluded.has(s.number) && (s.exists || createMissing);
                  const line = slug(s.read) || slug(s.current);
                  const extras = [s.read.pages, s.cast.length ? `cast ${s.cast.map((c) => c.castNumber).join(", ")}` : "", s.read.scriptDay].filter(Boolean) as string[];
                  return (
                    <tr key={s.number} style={{ opacity: on ? 1 : 0.45 }}>
                      <td><input type="checkbox" checked={on} disabled={!s.exists && !createMissing} onChange={() => toggle(s.number)} aria-label={`Include scene ${s.number}`} /></td>
                      <td className="mono bold nowrap">{s.number}</td>
                      <td><div className="bold">{line || "—"}</div>{s.read.timeOfDay && <span className="subtle tiny">{humanize(s.read.timeOfDay)}</span>}{s.read.description && <div className="subtle tiny truncate" style={{ maxWidth: 320 }} title={s.read.description}>{s.read.description}</div>}</td>
                      <td><Input type="date" value={dates[s.number] || ""} disabled={!on} onChange={(e) => setDates((d) => ({ ...d, [s.number]: e.target.value }))} style={{ minWidth: 150 }} aria-label={`Shoot date for scene ${s.number}`} /></td>
                      <td className="hide-mobile"><div className="chips">{extras.map((x) => <span key={x} className="chip" style={{ padding: "2px 8px", fontSize: 12 }}>{x}</span>)}{!extras.length && <span className="subtle">—</span>}</div></td>
                      <td>
                        {!s.exists ? (createMissing ? <Badge status="READY">New scene</Badge> : <Badge status="MUTED">Not in breakdown</Badge>)
                          : !dates[s.number] && !(fillBlanks && s.fills.length) ? <Badge status="MUTED">No change</Badge>
                          : dateKey(s.currentShootDate) && dateKey(s.currentShootDate) !== dates[s.number] ? <Badge status="WARNING">Date changes</Badge>
                          : <Badge status="READY">{fillBlanks && s.fills.length ? `Fills ${s.fills.length}` : "Scheduled"}</Badge>}
                        {s.exists && s.currentShootDate && <div className="subtle tiny">was {fmtDate(s.currentShootDate)}</div>}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={6} className="subtle">No scene numbers were found in this file.</td></tr>}
              </tbody>
            </table>
          </div>
          {result.breakdownEmpty && <div className="subtle">This production has no scenes yet, so every scene here will be added.</div>}
          {!result.knownCastNumbers && rows.some((s) => s.cast.length) && <div className="subtle">Cast numbers were found but no character has a cast number yet, so they cannot be linked. Set cast numbers on the Characters page first.</div>}
          <ErrorBox error={apply.error} />
        </div>
      )}
    </Modal>
  );
}
