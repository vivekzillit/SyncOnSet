import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { humanize } from "@/lib/format";
import { Badge, ErrorBox, Modal, useToast } from "./ui";
import { useAuth } from "@/state/auth";
import { CueProgress, useCueExtraction } from "./AiCues";
import type { Scene } from "@/api/types";

interface ParsedScene { number: string; name: string | null; location: string | null; intExt: string | null; timeOfDay: string | null; synopsis: string | null; status?: string; characters: string[]; dialogueLines: number; text?: string; exists: boolean }
interface ParsedCharacter { name: string; scenes: number; lines: number; exists: boolean }
interface ParseResult { format: string; file: string; scenes: ParsedScene[]; characters: ParsedCharacter[]; warnings: string[]; stats: { elements: number; headings: number; cues: number } }

/** Upload a screenplay, preview the breakdown, then import scenes + characters. */
export function ScriptUploadModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported?: () => void }) {
  const { projectId } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { progress, run: runCues } = useCueExtraction();
  const [withAi, setWithAi] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<File | null>(null);

  const parse = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append("file", f); return api<ParseResult>(p(projectId, "/scenes/parse-script"), { formData: fd }); },
    onSuccess: (r) => { setResult(r); setExcluded(new Set()); },
  });
  const importM = useMutation({
    mutationFn: () => {
      const scenes = (result?.scenes || []).filter((s) => !excluded.has(s.number)).map((s) => ({ number: s.number, name: s.name, location: s.location, intExt: s.intExt, timeOfDay: s.timeOfDay, synopsis: s.synopsis, status: s.status, characters: s.characters, scriptText: s.text || null }));
      return api<{ scenes: number; charactersCreated: number }>(p(projectId, "/scenes/import"), { body: { scenes } });
    },
    onSuccess: async (r) => {
      qc.invalidateQueries();
      toast.push(`Imported ${r.scenes} scenes, ${r.charactersCreated} new characters`, "ok");
      onImported?.();
      if (withAi && meta?.aiEnabled && result) {
        const numbers = new Set(result.scenes.filter((s) => !excluded.has(s.number)).map((s) => s.number));
        const all = await api<Scene[]>(p(projectId, "/scenes"));
        const ids = all.filter((s) => numbers.has(s.number) && s.hasScript).map((s) => s.id);
        setPhase("cues");
        await runCues(ids);
        return;
      }
      reset();
      onClose();
    },
  });
  const [phase, setPhase] = useState<"pick" | "preview" | "cues">("pick");
  const reset = () => { setResult(null); setFile(null); setExcluded(new Set()); setPhase("pick"); if (fileRef.current) fileRef.current.value = ""; };
  const pick = (f: File | null) => { if (!f) return; setFile(f); parse.mutate(f); };
  const toggle = (n: string) => setExcluded((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });
  const included = (result?.scenes || []).filter((s) => !excluded.has(s.number));
  const newChars = (result?.characters || []).filter((c) => !c.exists);
  const updates = included.filter((s) => s.exists).length;

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Upload script" wide
      footer={phase === "cues" ? <button className="btn btn-primary" disabled={progress.running} onClick={() => { reset(); onClose(); }}>{progress.running ? "Working…" : "Done"}</button> : <><button className="btn" onClick={() => { reset(); onClose(); }}>Cancel</button>{result && <button className="btn btn-primary" disabled={!included.length || importM.isPending} onClick={() => importM.mutate()}>{importM.isPending ? "Importing…" : `Import ${included.length} scene${included.length === 1 ? "" : "s"}${withAi && meta?.aiEnabled ? " + AI cues" : ""}`}</button>}</>}>
      {phase === "cues" ? (
        <div className="col gap-2">
          <div className="notice ok">Scenes imported. Now reading each scene for costume cues…</div>
          <CueProgress progress={progress} />
          {!progress.running && !progress.error && <div className="subtle">Open any scene to review the suggestions under <b>Costume cues from script</b>.</div>}
        </div>
      ) : !result ? (
        <div className="col gap-2">
          <div className="notice info">Upload the screenplay and the breakdown is read straight from it: scene numbers, INT/EXT, location, time of day, the characters who speak in each scene, and a one-line synopsis. You review everything before anything is saved.</div>
          <div className="card flat" style={{ borderStyle: "dashed", textAlign: "center", padding: 28, cursor: "pointer" }} onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0] || null); }}>
            <Upload size={28} color="var(--text-3)" />
            <div className="bold mt-1">{parse.isPending ? `Reading ${file?.name}…` : "Drop the script here or click to choose"}</div>
            <div className="subtle mt-1">Final Draft (.fdx) · Fountain (.fountain) · plain text (.txt) · PDF exported from your writing software</div>
            <input ref={fileRef} type="file" accept=".fdx,.fountain,.txt,.pdf,application/pdf,text/plain" hidden onChange={(e) => pick(e.target.files?.[0] || null)} />
          </div>
          <div className="subtle">Re-uploading a revised draft updates scenes by number and adds new characters; it never deletes anything.</div>
          <ErrorBox error={parse.error} />
        </div>
      ) : (
        <div className="col gap-2">
          <div className="row gap-2 wrap">
            <FileText size={16} /><span className="bold">{result.file}</span><Badge status="INFO">{result.format.toUpperCase()}</Badge>
            <span className="subtle">{result.scenes.length} scenes · {result.characters.length} characters · {result.stats.cues} dialogue cues</span>
            <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={reset}>Choose another file</button>
          </div>
          {result.warnings.map((w, i) => <div key={i} className="notice">{w}</div>)}
          <div className="notice ok">{included.length - updates} new scene{included.length - updates === 1 ? "" : "s"}, {updates} existing scene{updates === 1 ? "" : "s"} will be updated, {newChars.length} new character{newChars.length === 1 ? "" : "s"} will be created{newChars.length ? `: ${newChars.map((c) => c.name).join(", ")}` : ""}.</div>
          <div className="table-wrap card flat pad-0" style={{ maxHeight: "50vh", overflowY: "auto" }}>
            <table className="table">
              <thead><tr><th></th><th>Sc</th><th>Slugline</th><th>Characters</th><th className="hide-mobile">Synopsis</th></tr></thead>
              <tbody>
                {result.scenes.map((s) => (
                  <tr key={s.number} style={{ opacity: excluded.has(s.number) ? 0.45 : 1 }}>
                    <td><input type="checkbox" checked={!excluded.has(s.number)} onChange={() => toggle(s.number)} /></td>
                    <td className="mono bold nowrap">{s.number}{s.exists && <span className="subtle" title="Scene number already exists; it will be updated"> ↻</span>}</td>
                    <td><div className="bold">{[s.intExt, s.location].filter(Boolean).join(". ") || s.name}</div><div className="subtle">{[s.timeOfDay ? humanize(s.timeOfDay) : null, s.status === "OMITTED" ? "Omitted" : null, `${s.dialogueLines} lines`].filter(Boolean).join(" · ")}</div></td>
                    <td><div className="chips">{s.characters.map((c) => <span key={c} className="chip" style={{ padding: "2px 8px", fontSize: 12 }}>{c}</span>)}{!s.characters.length && <span className="subtle">—</span>}</div></td>
                    <td className="hide-mobile subtle" style={{ maxWidth: 320 }}>{s.synopsis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {meta?.aiEnabled && <label className="check"><input type="checkbox" checked={withAi} onChange={(e) => setWithAi(e.target.checked)} /> Also extract costume cues with AI after import ({meta.aiModel}; a few cents per script)</label>}
          <ErrorBox error={importM.error} />
        </div>
      )}
    </Modal>
  );
}
