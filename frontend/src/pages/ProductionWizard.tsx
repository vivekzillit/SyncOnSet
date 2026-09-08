import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Film, Tv, Upload, FileText } from "lucide-react";
import { api, p } from "@/api/client";
import { useAuth } from "@/state/auth";
import { ErrorBox, Field, Input, Select } from "@/components/ui";
import { CharacterConfirmation, buildCharacterImport, initialRows, type ConfirmRow, type DetectedCharacter, type ExistingCharacter } from "@/components/CharacterConfirmation";

const STUDIOS = ["Yash Raj Films", "Dharma Productions", "Excel Entertainment", "Red Chillies Entertainment", "T-Series", "Eros International", "Netflix", "Amazon Studios", "Disney+ Hotstar", "Sony Pictures", "Warner Bros.", "Universal", "Paramount", "BBC", "Independent", "Other"];
const STEPS = 6;

interface ParsedScene { number: string; name: string | null; location: string | null; intExt: string | null; timeOfDay: string | null; synopsis: string | null; status?: string; characters: string[]; text?: string; pages?: string | null }
interface ParseResult { format: string; file: string; scenes: ParsedScene[]; characters: DetectedCharacter[]; existingCharacters: ExistingCharacter[]; warnings: string[] }
type DateKey = "prepStartDate" | "prepEndDate" | "startDate" | "endDate";

/** SyncOnSet-style production setup: type → title → studio → prep & shoot dates → script upload (required) → character confirmation. */
export default function ProductionWizard() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user, refresh } = useAuth();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ type: "", name: "", studio: "", studioOther: "", prepStartDate: "", prepEndDate: "", startDate: "", endDate: "", revision: "White" });
  const [projectId, setProjectId] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [rows, setRows] = useState<ConfirmRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const firstName = (user?.name || "").split(" ")[0];
  const kind = f.type === "EPISODIC" ? "series" : "feature";

  const code = () => (f.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "PROD") + String(Math.floor(Math.random() * 900) + 100);
  const projectBody = () => ({ name: f.name.trim(), type: f.type || "FEATURE", studio: f.studio === "Other" ? f.studioOther || null : f.studio || null, prepStartDate: f.prepStartDate || null, prepEndDate: f.prepEndDate || null, startDate: f.startDate || null, endDate: f.endDate || null });

  /** The project is created the first time a script is read (the parser needs a project); later steps reuse it. */
  async function ensureProject(): Promise<string> {
    if (projectId) return projectId;
    const pr = await api<{ id: string }>("/projects", { body: { ...projectBody(), code: code(), status: "PREP" } });
    setProjectId(pr.id);
    await refresh();
    return pr.id;
  }

  async function parseFile(file: File) {
    setBusy(true); setError(null);
    try {
      const id = await ensureProject();
      const fd = new FormData(); fd.append("file", file);
      const r = await api<ParseResult>(p(id, "/scenes/parse-script"), { formData: fd });
      setParsed(r); setRows(initialRows(r.characters)); setStep(5);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function useDemo() {
    const res = await fetch("/demo-script.fountain"); const text = await res.text();
    await parseFile(new File([text], "demo-script.fountain", { type: "text/plain" }));
  }
  /** Import the confirmed breakdown (scenes + characters) and open the Scenes list. */
  async function finish() {
    setBusy(true); setError(null);
    try {
      const existed = !!projectId;
      const id = await ensureProject();
      // Anything edited after going Back (title, studio, dates) is saved before the import.
      if (existed) await api(`/projects/${id}`, { method: "PATCH", body: projectBody() });
      if (parsed) {
        const { characterMap, castNumbers } = buildCharacterImport(rows, parsed.existingCharacters);
        const scenes = parsed.scenes.map((s) => ({ number: s.number, name: s.name, location: s.location, intExt: s.intExt, timeOfDay: s.timeOfDay, synopsis: s.synopsis, status: s.status, pages: s.pages || null, characters: s.characters, scriptText: s.text || null }));
        await api(p(id, "/scenes/import"), { body: { scenes, revision: f.revision || null, characterMap, castNumbers } });
      }
      qc.invalidateQueries();
      nav(`/p/${id}/scenes`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  // Plain render helpers (not nested components): a component type created per render would remount its inputs on every keystroke.
  const backAndCancel = (
    <div className="row gap-2">
      {step > 0 && <button type="button" className="btn" onClick={() => setStep((s) => s - 1)} disabled={busy}>Back</button>}
      <Link to="/projects" className="btn btn-ghost">Cancel</Link>
    </div>
  );
  const navRow = (next: () => void, canNext = true) => (
    <div className="row between mt-3">
      {backAndCancel}
      <button type="button" className="btn btn-primary" onClick={next} disabled={!canNext || busy}>{busy ? "Working…" : "Continue"}</button>
    </div>
  );
  const dateRange = (title: string, start: DateKey, end: DateKey) => (
    <div>
      <div className="bold" style={{ marginBottom: 6 }}>{title}</div>
      <div className="grid grid-2 keep">
        <Field label="Start date"><Input type="date" value={f[start]} onChange={(e) => setF({ ...f, [start]: e.target.value })} /></Field>
        <Field label="End date"><Input type="date" value={f[end]} min={f[start] || undefined} onChange={(e) => setF({ ...f, [end]: e.target.value })} /></Field>
      </div>
    </div>
  );

  return (
    <div className="login" style={{ alignItems: "start", paddingTop: 48 }}>
      <div className="card" style={{ width: "100%", maxWidth: step >= 5 ? 900 : 560, padding: 28 }}>
        <div className="row gap-2 mb-2"><div className="brand-mark">C&amp;S</div><div className="subtle">Create a production · step {Math.min(step + 1, STEPS)} of {STEPS}</div></div>
        {step === 0 && (<>
          <h2 className="center">What are you working on{firstName ? `, ${firstName}` : ""}?</h2>
          <div className="grid grid-2 keep mt-3">
            {[["FEATURE", "Feature", <Film key="f" size={40} />], ["EPISODIC", "Feature TV series", <Tv key="t" size={40} />]].map(([v, label, icon]) => (
              <button key={v as string} type="button" className="card flat" style={{ padding: 22, textAlign: "center", cursor: "pointer", borderColor: f.type === v ? "var(--ink)" : undefined, borderWidth: f.type === v ? 2 : 1 }} onClick={() => setF({ ...f, type: v as string })}>
                <div style={{ color: "var(--text-2)" }}>{icon}</div><div className="bold mt-1">{label}</div>
              </button>
            ))}
          </div>
          {navRow(() => setStep(1), !!f.type)}
        </>)}
        {step === 1 && (<>
          <h2 className="center">What is the title of your {kind}?</h2>
          <div className="mt-3"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Production Title" autoFocus onKeyDown={(e) => e.key === "Enter" && f.name.trim() && setStep(2)} /></div>
          {navRow(() => setStep(2), !!f.name.trim())}
        </>)}
        {step === 2 && (<>
          <h2 className="center">Which studio are you working with?</h2>
          <div className="col mt-3">
            <Select value={f.studio} onChange={(e) => setF({ ...f, studio: e.target.value })} options={STUDIOS} placeholder="Select a studio" humanizeLabels={false} />
            {f.studio === "Other" && <Input value={f.studioOther} onChange={(e) => setF({ ...f, studioOther: e.target.value })} placeholder="Other Studio" autoFocus />}
          </div>
          {navRow(() => setStep(3))}
        </>)}
        {step === 3 && (<>
          <h2 className="center">What are the estimated shoot dates?</h2>
          <div className="col mt-3" style={{ gap: 18 }}>
            {dateRange("Pre-production dates", "prepStartDate", "prepEndDate")}
            {dateRange("Shoot dates", "startDate", "endDate")}
          </div>
          {navRow(() => setStep(4))}
        </>)}
        {step === 4 && (<>
          <h2 className="center row gap-1" style={{ justifyContent: "center" }}><FileText size={20} /> Upload script for breakdown</h2>
          <div className="col mt-3">
            <Input value={f.revision} onChange={(e) => setF({ ...f, revision: e.target.value })} placeholder="Draft (ex. Blue)" style={{ maxWidth: 260, alignSelf: "center" }} />
            <div className="card flat" style={{ borderStyle: "dashed", textAlign: "center", padding: 30, cursor: "pointer" }} onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) parseFile(file); }}>
              <Upload size={34} color="var(--info)" />
              <div className="bold mt-1">{busy ? "Reading the script…" : "Drag and Drop File"}</div>
              <div className="subtle">or click to browse · Final Draft, Fountain, text, PDF</div>
              <input ref={fileRef} type="file" accept=".fdx,.fountain,.txt,.pdf,application/pdf,text/plain" hidden onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])} />
            </div>
            <button type="button" className="btn btn-sm" style={{ alignSelf: "center" }} onClick={useDemo} disabled={busy}>Try our demo script</button>
          </div>
          <ErrorBox error={error} />
          {/* A script is required: Continue only unlocks once one has been read (uploading moves on by itself). */}
          {navRow(() => setStep(5), !!parsed)}
        </>)}
        {step === 5 && parsed && (<>
          <div className="row between wrap gap-2">
            <h2>🎭 Character Confirmation</h2>
            <div className="row gap-2"><button type="button" className="btn btn-ghost" onClick={finish} disabled={busy}>Skip</button><button type="button" className="btn btn-primary" onClick={finish} disabled={busy}>{busy ? "Importing…" : "Continue"}</button></div>
          </div>
          <div className="subtle mb-2">{parsed.file} · {parsed.scenes.length} scenes · draft "{f.revision || "—"}"</div>
          {parsed.warnings.map((w, i) => <div key={i} className="notice mb-2">{w}</div>)}
          <CharacterConfirmation rows={rows} onChange={setRows} detected={parsed.characters} existing={parsed.existingCharacters} />
          <ErrorBox error={error} />
          <div className="row between mt-3">{backAndCancel}<div className="row gap-2"><button type="button" className="btn btn-ghost" onClick={finish} disabled={busy}>Skip</button><button type="button" className="btn btn-primary" onClick={finish} disabled={busy}>{busy ? "Importing…" : "Continue"}</button></div></div>
        </>)}
      </div>
    </div>
  );
}
