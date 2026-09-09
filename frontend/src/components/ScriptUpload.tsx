import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { humanize } from "@/lib/format";
import { Badge, ErrorBox, Input, Modal, useToast } from "./ui";
import { useAuth } from "@/state/auth";
import { CueProgress, engineLabel, useCueExtraction } from "./AiCues";
import type { Scene } from "@/api/types";
import { CharacterConfirmation, buildCharacterImport, initialRows, type ConfirmRow, type DetectedCharacter, type ExistingCharacter } from "./CharacterConfirmation";

interface ParsedScene { number: string; name: string | null; location: string | null; intExt: string | null; timeOfDay: string | null; scriptDay: string | null; scriptDaySource?: "script" | "derived"; synopsis: string | null; status?: string; characters: string[]; dialogueLines: number; text?: string; pages?: string | null; lines?: number; exists: boolean; change: "new" | "updated" | "unchanged"; previousRevision?: string | null }
type ParsedCharacter = DetectedCharacter;
interface ParseResult { format: string; file: string; firstUpload: boolean; existingScenes: number; existingCharacters: ExistingCharacter[]; scenes: ParsedScene[]; characters: ParsedCharacter[]; warnings: string[]; stats: { elements: number; headings: number; cues: number } }

/** Upload a screenplay, preview the breakdown, then import scenes + characters. */
export function ScriptUploadModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported?: () => void }) {
  const { projectId } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const { progress, run: runCues } = useCueExtraction();
  const [withAi, setWithAi] = useState(false);
  const [revision, setRevision] = useState("");
  const [rows, setRows] = useState<ConfirmRow[]>([]);
  const [tab, setTab] = useState<"scenes" | "characters">("scenes");
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  // A production that already has a script is asked before its breakdown is thrown away.
  const [confirmReplace, setConfirmReplace] = useState(false);

  const parse = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append("file", f); return api<ParseResult>(p(projectId, "/scenes/parse-script"), { formData: fd }); },
    onSuccess: (r) => {
      setResult(r);
      setExcluded(new Set());
      setRevision(r.firstUpload ? "White" : `Revision ${new Date().toISOString().slice(0, 10)}`);
      setRows(initialRows(r.characters));
      setTab(r.characters.some((c) => !c.exists) ? "characters" : "scenes");
    },
  });
  const importM = useMutation({
    mutationFn: (replace: boolean) => {
      const scenes = (result?.scenes || []).filter((s) => !excluded.has(s.number)).map((s) => ({ number: s.number, name: s.name, location: s.location, intExt: s.intExt, timeOfDay: s.timeOfDay, scriptDay: s.scriptDay, synopsis: s.synopsis, status: s.status, pages: s.pages || null, characters: s.characters, scriptText: s.text || null }));
      const { characterMap, castNumbers } = buildCharacterImport(rows, result?.existingCharacters || []);
      return api<{ scenes: number; created: number; updated: number; unchanged: number; removed: number; charactersCreated: number }>(p(projectId, "/scenes/import"), { body: { scenes, revision: revision || null, characterMap, castNumbers, replace } });
    },
    onSuccess: async (r) => {
      qc.invalidateQueries();
      setConfirmReplace(false);
      toast.push(r.removed ? `${r.removed} old scene${r.removed === 1 ? "" : "s"} replaced by ${r.created}; ${r.charactersCreated} new character${r.charactersCreated === 1 ? "" : "s"}` : `${r.created} new, ${r.updated} updated, ${r.unchanged} unchanged scene${r.scenes === 1 ? "" : "s"}; ${r.charactersCreated} new character${r.charactersCreated === 1 ? "" : "s"}`, "ok");
      onImported?.();
      if (withAi && result) {
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
  const reset = () => { setResult(null); setFile(null); setExcluded(new Set()); setPhase("pick"); setRows([]); setTab("scenes"); setConfirmReplace(false); if (fileRef.current) fileRef.current.value = ""; };
  const pick = (f: File | null) => { if (!f) return; setFile(f); parse.mutate(f); };
  const toggle = (n: string) => setExcluded((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });
  const included = (result?.scenes || []).filter((s) => !excluded.has(s.number));
  // Character summary, derived the same way the import will resolve it.
  const charPlan = buildCharacterImport(rows, result?.existingCharacters || []).characterMap;
  const existingNames = new Set((result?.existingCharacters || []).map((e) => e.name.toLowerCase()));
  const ignored = rows.filter((r) => r.deleted).length;
  const newChars = rows.filter((r) => !r.deleted && charPlan[r.name]?.toLowerCase() === r.name.toLowerCase() && !existingNames.has(r.name.toLowerCase()));
  const displayName = (c: string) => charPlan[c] ?? c;
  const updates = included.filter((s) => s.change === "updated").length;
  const unchanged = included.filter((s) => s.change === "unchanged").length;
  const newScenes = included.filter((s) => s.change === "new").length;

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title={confirmReplace ? "Replace the breakdown?" : "Upload script"} wide
      footer={phase === "cues"
        ? <button className="btn btn-primary" disabled={progress.running} onClick={() => { reset(); onClose(); }}>{progress.running ? "Working…" : "Done"}</button>
        : confirmReplace
          ? <><button className="btn" onClick={() => setConfirmReplace(false)}>Keep the current breakdown</button><button className="btn btn-danger" disabled={importM.isPending} onClick={() => importM.mutate(true)}>{importM.isPending ? "Replacing…" : `Replace ${result?.existingScenes ?? 0} scene${result?.existingScenes === 1 ? "" : "s"}`}</button></>
          : <><button className="btn" onClick={() => { reset(); onClose(); }}>Cancel</button>{result && <button className="btn btn-primary" disabled={!included.length || importM.isPending} onClick={() => (result.firstUpload ? importM.mutate(false) : setConfirmReplace(true))}>{importM.isPending ? "Importing…" : `Import ${included.length} scene${included.length === 1 ? "" : "s"}${withAi ? " + cues" : ""}`}</button>}</>}>
      {confirmReplace ? (
        <div className="col gap-2">
          <div className="notice">This production already has a script. Importing <b>{result?.file}</b> removes the {result?.existingScenes ?? 0} scene{result?.existingScenes === 1 ? "" : "s"} it holds now, along with the continuity takes and costume cues recorded against them, and puts this breakdown in their place.</div>
          <div className="subtle">Characters, costumes, looks and fittings are kept. Keeping the current breakdown leaves everything exactly as it is; a revised draft can be imported over it instead.</div>
        </div>
      ) : phase === "cues" ? (
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
          <div className="row gap-2 wrap">
            <div className="field" style={{ minWidth: 260 }}><label>Revision name</label><Input value={revision} onChange={(e) => setRevision(e.target.value)} placeholder='e.g. "Blue 2026-09-08"' /><span className="help">Stamped on new and changed scenes. Use the colour and script date so the team can tell drafts apart.</span></div>
            <div className="notice ok grow" style={{ alignSelf: "stretch" }}>{newScenes} new · {updates} updated · {unchanged} unchanged scene{included.length === 1 ? "" : "s"}. Characters: {newChars.length} new{ignored ? `, ${ignored} ignored` : ""}. Nothing is ever deleted by an upload.</div>
          </div>
          <div className="tabs" style={{ marginBottom: 4 }}>
            <button type="button" className={tab === "scenes" ? "active" : ""} onClick={() => setTab("scenes")}>Scenes ({result.scenes.length})</button>
            <button type="button" className={tab === "characters" ? "active" : ""} onClick={() => setTab("characters")}>Characters ({result.characters.length}){newChars.length ? <span className="badge tone-warn" style={{ marginLeft: 6 }}>{newChars.length} new</span> : null}</button>
          </div>
          {tab === "scenes" ? (
            <div className="table-wrap card flat pad-0" style={{ maxHeight: "46vh", overflowY: "auto" }}>
              <table className="table">
                <thead><tr><th></th><th>Sc</th><th>Script Day</th><th>Slugline</th><th>Pages</th><th>Characters</th><th>Status</th></tr></thead>
                <tbody>
                  {result.scenes.map((s) => (
                    <tr key={s.number} style={{ opacity: excluded.has(s.number) ? 0.45 : 1 }}>
                      <td><input type="checkbox" checked={!excluded.has(s.number)} onChange={() => toggle(s.number)} /></td>
                      <td className="mono bold nowrap">{s.number}</td>
                      <td className="nowrap">{s.scriptDay || "—"}{s.timeOfDay && <div className="subtle tiny">{humanize(s.timeOfDay)}</div>}</td>
                      <td><div className="bold">{[s.intExt, s.location].filter(Boolean).join(". ") || s.name}</div><div className="subtle">{[s.timeOfDay ? humanize(s.timeOfDay) : null, s.status === "OMITTED" ? "Omitted" : null, s.synopsis].filter(Boolean).join(" · ")}</div></td>
                      <td className="nowrap mono">{s.pages || "—"}</td>
                      <td><div className="chips">{s.characters.map((c) => <span key={c} className="chip" style={{ padding: "2px 8px", fontSize: 12, opacity: charPlan[c] === null ? 0.4 : 1 }}>{displayName(c)}</span>)}{!s.characters.length && <span className="subtle">—</span>}</div></td>
                      <td>{s.status === "OMITTED" ? <Badge status="MUTED">Omitted</Badge> : s.change === "new" ? <Badge status="READY">New</Badge> : s.change === "updated" ? <Badge status="WARNING">Updated</Badge> : <Badge status="MUTED">Unchanged</Badge>}{s.previousRevision && <div className="subtle tiny">was {s.previousRevision}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <CharacterConfirmation rows={rows} onChange={setRows} detected={result.characters} existing={result.existingCharacters} />
          )}
          <label className="check"><input type="checkbox" checked={withAi} onChange={(e) => setWithAi(e.target.checked)} /> Also extract costume cues after import <span className="subtle">({engineLabel(meta)}{meta?.aiEnabled ? "; a few cents per script" : ""})</span></label>
          <ErrorBox error={importM.error} />
        </div>
      )}
    </Modal>
  );
}
