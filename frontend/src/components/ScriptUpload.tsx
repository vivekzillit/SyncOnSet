import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { humanize } from "@/lib/format";
import { Badge, ErrorBox, Input, Modal, Select, useToast } from "./ui";
import { useAuth } from "@/state/auth";
import { CueProgress, engineLabel, useCueExtraction } from "./AiCues";
import type { Scene } from "@/api/types";
import { CharacterConfirmation, buildCharacterImport, initialRows, type ConfirmRow, type DetectedCharacter, type ExistingCharacter } from "./CharacterConfirmation";

/** The fields the reviewer can compare and correct; what the scene is now, and what the script would make it. */
interface SceneFields { name: string | null; location: string | null; intExt: string | null; timeOfDay: string | null; scriptDay: string | null; synopsis: string | null; pages?: string | null }
interface ParsedScene extends SceneFields { number: string; scriptDaySource?: "script" | "derived"; status?: string; characters: string[]; dialogueLines: number; text?: string; lines?: number; exists: boolean; change: "new" | "updated" | "unchanged"; previousRevision?: string | null; previous?: SceneFields | null }
/** What to do with one scene in the preview: take the script's version, leave the scene alone, or fix it by hand. */
type SceneAction = "replace" | "keep" | "edit";
const FIELD_LABELS: { key: keyof SceneFields; label: string }[] = [
  { key: "intExt", label: "INT/EXT" },
  { key: "location", label: "Location" },
  { key: "scriptDay", label: "Script day" },
  { key: "timeOfDay", label: "Time" },
  { key: "pages", label: "Pages" },
  { key: "synopsis", label: "Synopsis" },
];
const same = (a: unknown, b: unknown) => String(a ?? "").replace(/\s+/g, " ").trim().toLowerCase() === String(b ?? "").replace(/\s+/g, " ").trim().toLowerCase();
/** Which of the compared fields the script would change — empty when only the scene text moved. */
function changedFields(s: ParsedScene, edited?: SceneFields) {
  if (!s.previous) return [];
  const next = edited || s;
  return FIELD_LABELS.filter((f) => !same(s.previous![f.key], next[f.key]));
}
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
  const [actions, setActions] = useState<Record<string, SceneAction>>({});
  const [edits, setEdits] = useState<Record<string, SceneFields>>({});
  const [file, setFile] = useState<File | null>(null);
  // A production that already has a script is asked the moment a new one is chosen, before it is even read.
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const { data: existing } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")), enabled: open });
  const existingScenes = existing?.length ?? 0;

  const parse = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append("file", f); return api<ParseResult>(p(projectId, "/scenes/parse-script"), { formData: fd }); },
    onSuccess: (r) => {
      setResult(r);
      setActions({});
      setEdits({});
      setRevision(r.firstUpload ? "White" : `Revision ${new Date().toISOString().slice(0, 10)}`);
      setRows(initialRows(r.characters));
      setTab(r.characters.some((c) => !c.exists) ? "characters" : "scenes");
    },
  });
  const importM = useMutation({
    mutationFn: (replace: boolean) => {
      const scenes = (result?.scenes || []).filter((s) => actionOf(s) !== "keep").map((s) => {
        const edited = actionOf(s) === "edit";
        const v = edited ? { ...s, ...(edits[s.number] || {}) } : s;
        // `force` matters when the scene text has not moved: without it the server leaves the scene alone.
        return { number: s.number, name: v.name, location: v.location, intExt: v.intExt, timeOfDay: v.timeOfDay, scriptDay: v.scriptDay, synopsis: v.synopsis, status: s.status, pages: v.pages || null, characters: s.characters, scriptText: s.text || null, ...(edited ? { force: true } : {}) };
      });
      const { characterMap, castNumbers } = buildCharacterImport(rows, result?.existingCharacters || []);
      return api<{ scenes: number; created: number; updated: number; unchanged: number; removed: number; charactersCreated: number }>(p(projectId, "/scenes/import"), { body: { scenes, revision: revision || null, characterMap, castNumbers, replace } });
    },
    onSuccess: async (r) => {
      qc.invalidateQueries();
      setConfirmReplace(false);
      toast.push(r.removed ? `${r.removed} old scene${r.removed === 1 ? "" : "s"} replaced by ${r.created}; ${r.charactersCreated} new character${r.charactersCreated === 1 ? "" : "s"}` : `${r.created} new, ${r.updated} updated, ${r.unchanged} unchanged scene${r.scenes === 1 ? "" : "s"}; ${r.charactersCreated} new character${r.charactersCreated === 1 ? "" : "s"}`, "ok");
      onImported?.();
      if (withAi && result) {
        const numbers = new Set(result.scenes.filter((s) => actionOf(s) !== "keep").map((s) => s.number));
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
  const reset = () => { setResult(null); setFile(null); setActions({}); setEdits({}); setPhase("pick"); setRows([]); setTab("scenes"); setConfirmReplace(false); setReplacing(false); if (fileRef.current) fileRef.current.value = ""; };
  /** Choosing a file over an existing breakdown asks first; nothing is read until that is answered. */
  const pick = (f: File | null) => {
    if (!f) return;
    setFile(f);
    if (existingScenes > 0 && !replacing) { setConfirmReplace(true); return; }
    parse.mutate(f);
  };
  const keepCurrent = () => { setConfirmReplace(false); setFile(null); if (fileRef.current) fileRef.current.value = ""; };
  const goAhead = () => { setConfirmReplace(false); setReplacing(true); if (file) parse.mutate(file); };
  /** Every scene starts on Replace — the same as the old "all ticked" — until the reviewer says otherwise. */
  const actionOf = (s: ParsedScene): SceneAction => actions[s.number] || "replace";
  const setAction = (s: ParsedScene, a: SceneAction) => {
    setActions((prev) => ({ ...prev, [s.number]: a }));
    // Editing starts from what the script says, so a correction is a tweak rather than a retype.
    if (a === "edit") setEdits((prev) => (prev[s.number] ? prev : { ...prev, [s.number]: { name: s.name, location: s.location, intExt: s.intExt, timeOfDay: s.timeOfDay, scriptDay: s.scriptDay, synopsis: s.synopsis, pages: s.pages ?? null } }));
  };
  const editField = (n: string, patch: Partial<SceneFields>) => setEdits((prev) => ({ ...prev, [n]: { ...prev[n], ...patch } }));
  const included = (result?.scenes || []).filter((s) => actionOf(s) !== "keep");
  const kept = (result?.scenes || []).length - included.length;
  const editedCount = (result?.scenes || []).filter((s) => actionOf(s) === "edit").length;
  /** Wiping the old breakdown would take the kept scenes with it, so keeping any scene turns this into a merge. */
  const wipes = replacing && kept === 0;
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
          ? <><button className="btn" onClick={keepCurrent}>Keep the current script</button><button className="btn btn-danger" onClick={goAhead}>Replace Script</button></>
          : <><button className="btn" onClick={() => { reset(); onClose(); }}>Cancel</button>{result && <button className={`btn ${wipes ? "btn-danger" : "btn-primary"}`} disabled={!included.length || importM.isPending} onClick={() => importM.mutate(wipes)}>{importM.isPending ? (wipes ? "Replacing…" : "Importing…") : wipes ? `Replace with ${included.length} scene${included.length === 1 ? "" : "s"}` : `Import ${included.length} scene${included.length === 1 ? "" : "s"}${withAi ? " + cues" : ""}`}</button>}</>}>
      {confirmReplace ? (
        <div className="col gap-2">
          <div className="notice">This production already has a script. Reading <b>{file?.name}</b> and importing it removes the {existingScenes} scene{existingScenes === 1 ? "" : "s"} it holds now, along with the continuity takes and costume cues recorded against them, and puts that breakdown in their place.</div>
          <div className="subtle">Characters, costumes, looks and fittings are kept. Keeping the current breakdown leaves everything exactly as it is, and nothing is written until you confirm the import on the next screen.</div>
        </div>
      ) : phase === "cues" ? (
        <div className="col gap-2">
          <div className="notice ok">Scenes imported. Now reading each scene for costume cues…</div>
          <CueProgress progress={progress} />
          {!progress.running && !progress.error && <div className="subtle">Open any scene to review the suggestions under <b>Costume cues from script</b>.</div>}
        </div>
      ) : !result ? (
        <div className="col gap-2">
          {/* A first upload keeps the intro short; replacing an existing script spells out the synopsis and the review step. */}
          <div className="notice info">Upload the screenplay and the breakdown is read straight from it: scene numbers, INT/EXT, location, time of day, the characters who speak in each scene{existingScenes > 0 ? ", and a one-line synopsis. You review everything before anything is saved." : "."}</div>
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
          {replacing && (wipes
            ? <div className="notice">Importing this replaces the {existingScenes} scene{existingScenes === 1 ? "" : "s"} already in this production.</div>
            : <div className="notice">{kept} scene{kept === 1 ? " is" : "s are"} set to keep, so nothing is wiped: the rest are matched by number and updated in place.</div>)}
          {result.warnings.map((w, i) => <div key={i} className="notice">{w}</div>)}
          <div className="row gap-2 wrap">
            <div className="field" style={{ minWidth: 260 }}><label>Revision name</label><Input value={revision} onChange={(e) => setRevision(e.target.value)} placeholder='e.g. "Blue 2026-09-08"' /><span className="help">Stamped on new and changed scenes. Use the colour and script date so the team can tell drafts apart.</span></div>
            <div className="notice ok grow" style={{ alignSelf: "stretch" }}>{newScenes} new · {updates} updated · {unchanged} unchanged scene{included.length === 1 ? "" : "s"}{kept ? ` · ${kept} kept as they are` : ""}{editedCount ? ` · ${editedCount} corrected by hand` : ""}. Characters: {newChars.length} new{ignored ? `, ${ignored} ignored` : ""}. Nothing is ever deleted by an upload.</div>
          </div>
          <div className="tabs" style={{ marginBottom: 4 }}>
            <button type="button" className={tab === "scenes" ? "active" : ""} onClick={() => setTab("scenes")}>Scenes ({result.scenes.length})</button>
            <button type="button" className={tab === "characters" ? "active" : ""} onClick={() => setTab("characters")}>Characters ({result.characters.length}){newChars.length ? <span className="badge tone-warn" style={{ marginLeft: 6 }}>{newChars.length} new</span> : null}</button>
          </div>
          {tab === "scenes" ? (
            <div className="table-wrap card flat pad-0" style={{ maxHeight: "46vh", overflowY: "auto" }}>
              <table className="table script-review">
                <thead><tr><th>Sc</th><th>Script Day</th><th>Slugline</th><th>Pages</th><th>Characters</th><th>Status</th><th>This scene</th></tr></thead>
                <tbody>
                  {result.scenes.map((s) => {
                    const action = actionOf(s);
                    const edit = edits[s.number];
                    const diff = changedFields(s, action === "edit" ? { ...s, ...edit } : undefined);
                    const changedKey = (...keys: (keyof SceneFields)[]) => keys.some((k) => diff.some((d) => d.key === k));
                    const v = action === "edit" && edit ? { ...s, ...edit } : s;
                    const slug = (x: SceneFields) => [x.intExt, x.location].filter(Boolean).join(". ");
                    /** Shows what this draft makes of the field, with what the scene says now struck through below. */
                    const diffCell = (changed: boolean, now: string, before: string) => {
                      const show = changed && action !== "keep"; // a kept scene is not changing, so nothing is marked
                      return (
                        <>
                          <span className={show ? "diff-new" : undefined}>{(action === "keep" && s.previous ? before : now) || "—"}</span>
                          {show && <div className="diff-old tiny">was {before || "—"}</div>}
                        </>
                      );
                    };
                    return (
                      <tr key={s.number} className={action === "keep" ? "row-kept" : undefined}>
                        <td className="mono bold nowrap">{s.number}</td>
                        <td className="nowrap">
                          {diffCell(changedKey("scriptDay"), v.scriptDay || "", s.previous?.scriptDay || "")}
                          <div className="subtle tiny">{diffCell(changedKey("timeOfDay"), humanize(v.timeOfDay), humanize(s.previous?.timeOfDay))}</div>
                        </td>
                        <td>
                          <div className="bold">{diffCell(changedKey("intExt", "location"), slug(v) || v.name || "", s.previous ? slug(s.previous) : "")}</div>
                          <div className="subtle">
                            {s.status === "OMITTED" && <span>Omitted · </span>}
                            {diffCell(changedKey("synopsis"), v.synopsis || "", s.previous?.synopsis || "")}
                          </div>
                          {action === "edit" && edit && (
                            <div className="col gap-1 mt-1" style={{ maxWidth: 420 }}>
                              <div className="row gap-1">
                                {/* The server takes these two as fixed lists, so they are chosen rather than typed. */}
                                <Select value={edit.intExt || ""} onChange={(e) => editField(s.number, { intExt: e.target.value || null })} options={meta?.intExt || ["INT", "EXT", "INT/EXT"]} placeholder="—" humanizeLabels={false} style={{ width: 110 }} aria-label={`INT/EXT for scene ${s.number}`} />
                                <Input value={edit.location || ""} onChange={(e) => editField(s.number, { location: e.target.value })} placeholder="Location" aria-label={`Location for scene ${s.number}`} />
                                <Select value={edit.timeOfDay || ""} onChange={(e) => editField(s.number, { timeOfDay: e.target.value || null })} options={meta?.timesOfDay || []} placeholder="—" style={{ width: 130 }} aria-label={`Time of day for scene ${s.number}`} />
                              </div>
                              <div className="row gap-1">
                                <Input value={edit.scriptDay || ""} onChange={(e) => editField(s.number, { scriptDay: e.target.value })} placeholder="Day 1" style={{ width: 90 }} aria-label={`Script day for scene ${s.number}`} />
                                <Input value={edit.pages || ""} onChange={(e) => editField(s.number, { pages: e.target.value })} placeholder="1/8" style={{ width: 80 }} className="mono" aria-label={`Pages for scene ${s.number}`} />
                              </div>
                              <Input value={edit.synopsis || ""} onChange={(e) => editField(s.number, { synopsis: e.target.value })} placeholder="Synopsis" aria-label={`Synopsis for scene ${s.number}`} />
                            </div>
                          )}
                        </td>
                        <td className="nowrap mono">{diffCell(changedKey("pages"), v.pages || "", s.previous?.pages || "")}</td>
                        <td><div className="chips">{s.characters.map((c) => <span key={c} className="chip" style={{ padding: "2px 8px", fontSize: 12, opacity: charPlan[c] === null ? 0.4 : 1 }}>{displayName(c)}</span>)}{!s.characters.length && <span className="subtle">—</span>}</div></td>
                        <td>
                          {s.status === "OMITTED" ? <Badge status="MUTED">Omitted</Badge> : s.change === "new" ? <Badge status="READY">New</Badge> : s.change === "updated" ? <Badge status="WARNING">Updated</Badge> : <Badge status="MUTED">Unchanged</Badge>}
                          {s.previousRevision && <div className="subtle tiny">was {s.previousRevision}</div>}
                          {/* The headings can match while the dialogue underneath has moved; say so rather than show nothing. */}
                          {s.change === "updated" && diff.length === 0 && <div className="subtle tiny">the scene text changed</div>}
                        </td>
                        <td className="nowrap">
                          <div className="chips" style={{ flexWrap: "nowrap" }}>
                            {(["replace", "keep", "edit"] as SceneAction[]).map((a) => (
                              <button key={a} type="button" aria-pressed={action === a} className={`chip ${action === a ? "active" : ""}`} onClick={() => setAction(s, a)} title={a === "replace" ? "Take the script's version" : a === "keep" ? "Leave this scene as it is" : "Correct it by hand before importing"}>
                                {a === "replace" ? (s.change === "new" ? "Add" : "Replace") : a === "keep" ? "Keep" : "Edit"}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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
