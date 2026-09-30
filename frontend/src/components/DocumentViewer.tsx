import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { dateKey, fmtDate, fmtDateTime } from "@/lib/format";
import type { Scene } from "@/api/types";
import { Empty, Modal, Select, Spinner } from "./ui";

export type DocumentKind = "SCRIPT" | "SCHEDULE" | "CALLSHEET";
export interface ProjectDocument { id: string; kind: DocumentKind; fileName: string; url: string; mimeType?: string | null; size?: number | null; revision?: string | null; sheetDate?: string | null; uploadedAt: string }

const NOUN: Record<DocumentKind, string> = { SCRIPT: "script", SCHEDULE: "schedule", CALLSHEET: "call sheet" };
const TEXT_EXT = /\.(fountain|txt|text|csv|tsv|fdx)$/i;

/** A Final Draft file is XML: read it as the script reads — one line per paragraph, scene headings in capitals. */
function fdxText(xml: string) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const paras = [...doc.getElementsByTagName("Paragraph")];
  if (!paras.length) return xml;
  return paras.map((p) => {
    const t = [...p.getElementsByTagName("Text")].map((n) => n.textContent || "").join("").trim();
    const type = p.getAttribute("Type") || "";
    return type === "Scene Heading" ? `\n${t.toUpperCase()}` : type === "Character" ? `\n            ${t.toUpperCase()}` : type === "Dialogue" || type === "Parenthetical" ? `      ${t}` : t;
  }).join("\n").trim();
}

/** The kept scripts / schedules / call sheets of one kind, newest first — shared so a button can hide until there is one. */
export function useDocuments(kind: DocumentKind) {
  const { projectId } = useProject();
  return useQuery({ queryKey: ["documents", projectId, kind], queryFn: () => api<ProjectDocument[]>(p(projectId, `/documents?kind=${kind}`)) });
}

/**
 * The uploaded file beside the scenes the app holds for it, so a scene the reader missed (or picked up twice) shows at once.
 * Script: every scene in the breakdown. Schedule: every scene with a shoot date, by day. Call sheet: the scenes on its day.
 * Each row can be ticked off while reading down the file; the ticks are only for this look and are not saved.
 */
export function DocumentViewer({ open, onClose, kind, scenes }: { open: boolean; onClose: () => void; kind: DocumentKind; scenes: Scene[] }) {
  const { data: docs, isLoading } = useDocuments(kind);
  const [docId, setDocId] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  useEffect(() => { if (open) { setDocId(""); setTicked(new Set()); } }, [open]);
  const doc = docs?.find((d) => d.id === docId) || docs?.[0];
  const isPdf = !!doc && (doc.mimeType === "application/pdf" || /\.pdf$/i.test(doc.url));
  // Scripts in Final Draft / Fountain and CSV schedules are text: shown as text so they can be read beside the scenes too.
  const isText = !!doc && !isPdf && TEXT_EXT.test(doc.url);
  const { data: text, isLoading: textLoading } = useQuery({
    queryKey: ["document-text", doc?.url],
    queryFn: async () => { const raw = await (await fetch(doc!.url)).text(); return /\.fdx$/i.test(doc!.url) ? fdxText(raw) : raw; },
    enabled: open && isText,
    staleTime: Infinity,
  });

  const rows = useMemo(() => {
    const live = scenes.filter((s) => s.status !== "OMITTED");
    if (kind === "SCRIPT") return live.map((s) => ({ s, note: [s.intExt, s.location].filter(Boolean).join(". ") || s.name || "" }));
    if (kind === "SCHEDULE") return live.filter((s) => s.shootDate).sort((a, b) => dateKey(a.shootDate).localeCompare(dateKey(b.shootDate)) || a.sortOrder - b.sortOrder).map((s) => ({ s, note: fmtDate(s.shootDate, { weekday: "short", day: "2-digit", month: "short" }) }));
    const day = dateKey(doc?.sheetDate);
    return live.filter((s) => day && dateKey(s.shootDate) === day).map((s) => ({ s, note: [s.intExt, s.location].filter(Boolean).join(". ") || s.name || "" }));
  }, [scenes, kind, doc?.sheetDate]);
  const undated = kind === "SCHEDULE" ? scenes.filter((s) => s.status !== "OMITTED" && !s.shootDate).length : 0;
  const toggle = (id: string) => setTicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const listTitle = kind === "SCRIPT" ? "Scenes in the breakdown" : kind === "SCHEDULE" ? "Scenes with a shoot date" : `Scenes on ${doc?.sheetDate ? fmtDate(doc.sheetDate, { weekday: "short", day: "2-digit", month: "short" }) : "the call sheet day"}`;

  return (
    <Modal open={open} onClose={onClose} wide title={<span className="row gap-1"><FileText size={18} /> Uploaded {NOUN[kind]}</span>}
      footer={<button className="btn" onClick={onClose}>Close</button>}>
      {isLoading ? <Spinner /> : !doc ? (
        <Empty icon="📄" title={`No ${NOUN[kind]} kept yet`} hint={`Upload the ${NOUN[kind]} and apply it; the file is kept here so you can compare it with the scenes.`} />
      ) : (
        <div className="col gap-2">
          <div className="row gap-2 wrap" style={{ alignItems: "center" }}>
            {docs && docs.length > 1
              ? <Select value={doc.id} onChange={(e) => setDocId(e.target.value)} humanizeLabels={false} aria-label="Version" style={{ width: "auto", minWidth: 280 }}
                  options={docs.map((d, i) => ({ value: d.id, label: `${i === 0 ? "Latest · " : ""}${d.fileName}${d.revision ? ` · ${d.revision}` : ""} · ${fmtDateTime(d.uploadedAt)}` }))} />
              : <span className="bold">{doc.fileName}</span>}
            <span className="subtle small">{doc.revision ? `${doc.revision} · ` : ""}uploaded {fmtDateTime(doc.uploadedAt)}</span>
            <a className="btn btn-sm" href={doc.url} target="_blank" rel="noreferrer" style={{ marginLeft: "auto" }}><ExternalLink size={14} /> Open in new tab</a>
          </div>
          <div className="doc-compare">
            <div className="doc-file">
              {isPdf
                ? <iframe title={doc.fileName} src={doc.url} />
                : isText
                  ? (textLoading ? <Spinner /> : <pre className="doc-text">{text || ""}</pre>)
                  : <div className="center subtle" style={{ padding: 40 }}>This file type can't be shown here. Use <b>Open in new tab</b> to read it.</div>}
            </div>
            <div className="doc-scenes">
              <div className="row between mb-1"><span className="bold small">{listTitle}</span><span className="subtle tiny">{ticked.size}/{rows.length} ticked</span></div>
              <div className="subtle tiny mb-1">Tick each scene as you find it in the file — anything left unticked is missing from one side.</div>
              {rows.length === 0 ? <div className="subtle small">None yet.</div> : (
                <div className="col" style={{ gap: 2 }}>
                  {rows.map(({ s, note }) => (
                    <label key={s.id} className="check doc-scene-row">
                      <input type="checkbox" checked={ticked.has(s.id)} onChange={() => toggle(s.id)} />
                      <span className="bold mono" style={{ minWidth: 38 }}>{s.number}</span>
                      <span className="subtle small truncate">{note}</span>
                    </label>
                  ))}
                </div>
              )}
              {undated > 0 && <div className="subtle tiny mt-1">{undated} scene{undated === 1 ? "" : "s"} in the breakdown have no shoot date.</div>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
