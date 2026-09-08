import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth } from "@/state/auth";
import type { Scene } from "@/api/types";
import { Badge, ErrorBox, Modal } from "./ui";

interface ExtractResult { scenesProcessed: number; scenesSkipped: number; cuesCreated: number; usage: { input: number; output: number }; model: string }

/** Runs AI cue extraction over a list of scene ids in chunks, reporting progress. */
export function useCueExtraction() {
  const { projectId } = useProject();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<{ done: number; total: number; cues: number; running: boolean; error: unknown; model?: string }>({ done: 0, total: 0, cues: 0, running: false, error: null });
  const run = useCallback(async (sceneIds: string[]) => {
    setProgress({ done: 0, total: sceneIds.length, cues: 0, running: true, error: null });
    let done = 0;
    let cues = 0;
    let model: string | undefined;
    try {
      for (let i = 0; i < sceneIds.length; i += 6) {
        const chunk = sceneIds.slice(i, i + 6);
        const r = await api<ExtractResult>(p(projectId, "/scenes/extract-cues"), { body: { sceneIds: chunk } });
        done += chunk.length;
        cues += r.cuesCreated;
        model = r.model;
        setProgress({ done, total: sceneIds.length, cues, running: true, error: null, model });
      }
      setProgress({ done, total: sceneIds.length, cues, running: false, error: null, model });
    } catch (e) {
      setProgress({ done, total: sceneIds.length, cues, running: false, error: e, model });
    } finally {
      qc.invalidateQueries({ queryKey: ["scene"] });
      qc.invalidateQueries({ queryKey: ["scenes", projectId] });
      qc.invalidateQueries({ queryKey: ["cues"] });
    }
  }, [projectId, qc]);
  return { progress, run };
}

export function CueProgress({ progress }: { progress: ReturnType<typeof useCueExtraction>["progress"] }) {
  if (!progress.total && !progress.error) return null;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="col gap-1">
      <div className="row between small"><span>{progress.running ? "Reading scenes with AI…" : progress.error ? "Stopped" : "Done"}</span><span className="subtle">{progress.done}/{progress.total} scenes · {progress.cues} cues{progress.model ? ` · ${progress.model}` : ""}</span></div>
      <div style={{ height: 8, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: progress.error ? "var(--danger)" : "var(--accent)", transition: "width 0.3s" }} /></div>
      <ErrorBox error={progress.error} />
    </div>
  );
}

/** Modal: pick scenes with script text and run extraction. */
export function AiCuesModal({ open, onClose, scenes }: { open: boolean; onClose: () => void; scenes: Scene[] }) {
  const { meta } = useAuth();
  const { progress, run } = useCueExtraction();
  const withScript = scenes.filter((s) => s.hasScript);
  const [scope, setScope] = useState<"all" | "today">("all");
  const today = new Date().toDateString();
  const targets = scope === "today" ? withScript.filter((s) => s.shootDate && new Date(s.shootDate).toDateString() === today) : withScript;
  return (
    <Modal open={open} onClose={onClose} title={<span className="row gap-1"><Sparkles size={18} color="var(--accent)" /> AI costume cues</span>}
      footer={<><button className="btn" onClick={onClose}>{progress.total && !progress.running ? "Close" : "Cancel"}</button><button className="btn btn-primary" disabled={!meta?.aiEnabled || !targets.length || progress.running} onClick={() => run(targets.map((s) => s.id))}><Sparkles size={16} /> {progress.running ? "Working…" : `Extract from ${targets.length} scene${targets.length === 1 ? "" : "s"}`}</button></>}>
      <div className="col gap-2">
        {!meta?.aiEnabled && <div className="notice">AI extraction is not configured on this server. Ask whoever runs the deployment to set <code>ANTHROPIC_API_KEY</code>.</div>}
        <div className="notice info">The AI reads each scene's script text and lists wardrobe-relevant facts: garments and accessories, condition (wet, torn, bloodied), costume changes, continuity links and things to prepare for (fights, rain, food). Every cue is a <b>suggestion</b> shown on the scene until someone accepts or dismisses it. Nothing else is changed.</div>
        <div className="row gap-2 wrap">
          <label className="check"><input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} /> All scenes with script text ({withScript.length})</label>
          <label className="check"><input type="radio" name="scope" checked={scope === "today"} onChange={() => setScope("today")} /> Today's scenes only ({withScript.filter((s) => s.shootDate && new Date(s.shootDate).toDateString() === today).length})</label>
        </div>
        {withScript.length === 0 && <div className="subtle">No scenes have script text yet. Use <b>Upload script</b> first; scenes created by hand have no text to read.</div>}
        {withScript.length > 0 && scenes.length > withScript.length && <div className="subtle">{scenes.length - withScript.length} scene{scenes.length - withScript.length === 1 ? "" : "s"} without script text will be skipped.</div>}
        <CueProgress progress={progress} />
        {!progress.running && progress.total > 0 && !progress.error && <div className="notice ok">{progress.cues} cue{progress.cues === 1 ? "" : "s"} suggested across {progress.done} scene{progress.done === 1 ? "" : "s"}. Open a scene to review them.</div>}
        {meta?.aiEnabled && <div className="subtle">Model: {meta.aiModel}. Cost is a few cents per script. Existing accepted or dismissed cues are kept; earlier suggestions are replaced.</div>}
        <div className="row gap-1 wrap">{["GARMENT", "ACCESSORY", "CONDITION", "CHANGE", "CONTINUITY", "NOTE"].map((k) => <Badge key={k} status={k === "CONDITION" ? "WARNING" : k === "CONTINUITY" ? "INFO" : "MUTED"}>{k.toLowerCase()}</Badge>)}</div>
      </div>
    </Modal>
  );
}
