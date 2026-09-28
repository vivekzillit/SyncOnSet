import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Film, Tv, Upload, FileText } from "lucide-react";
import { api, p } from "@/api/client";
import { useAuth } from "@/state/auth";
import { ErrorBox, Field, Input, useUnsavedGuard } from "@/components/ui";
import { buildCharacterImport, initialRows, type ConfirmRow, type DetectedCharacter, type ExistingCharacter } from "@/components/CharacterConfirmation";

const STEPS = 3;

interface ParsedScene { number: string; name: string | null; location: string | null; intExt: string | null; timeOfDay: string | null; scriptDay?: string | null; synopsis: string | null; status?: string; characters: string[]; text?: string; pages?: string | null }
interface ParseResult { format: string; file: string; scenes: ParsedScene[]; characters: DetectedCharacter[]; existingCharacters: ExistingCharacter[]; warnings: string[] }
type DateKey = "prepStartDate" | "prepEndDate" | "prepWrapDate" | "startDate" | "endDate" | "wrapDate";

/** SyncOnSet-style production setup: type → prep & shoot dates → script upload (optional), then straight in. */
export default function ProductionWizard() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ type: "", name: "", prepStartDate: "", prepEndDate: "", prepWrapDate: "", startDate: "", endDate: "", wrapDate: "", revision: "White" });
  const [withPrep, setWithPrep] = useState(false);
  const [withWrap, setWithWrap] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  // Read straight after they are set, in the same tick parseFile hands over to finish, where state has not landed yet.
  const projectIdRef = useRef<string | null>(null);
  const nameRef = useRef("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [rows, setRows] = useState<ConfirmRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const kind = f.type === "EPISODIC" ? "series" : "feature";

  /** No title step: the production is named after its script (or "Untitled …") and can be renamed later. */
  const nameFor = (file?: File) => f.name.trim() || (file ? file.name.replace(/\.[^.]+$/, "").trim() : "") || `Untitled ${kind === "series" ? "Series" : "Feature"}`;
  const code = (name: string) => (name.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "PROD") + String(Math.floor(Math.random() * 900) + 100);
  const projectBody = (name: string) => ({ name, type: f.type || "FEATURE", prepStartDate: f.prepStartDate || null, prepEndDate: f.prepEndDate || null, prepWrapDate: f.prepWrapDate || null, startDate: f.startDate || null, endDate: f.endDate || null, wrapDate: f.wrapDate || null });

  /** The project is created the first time a script is read (the parser needs a project); later steps reuse it. */
  async function ensureProject(name: string): Promise<string> {
    if (projectIdRef.current) return projectIdRef.current;
    setF((prev) => ({ ...prev, name }));
    nameRef.current = name;
    const pr = await api<{ id: string }>("/projects", { body: { ...projectBody(name), code: code(name), status: "PREP" } });
    projectIdRef.current = pr.id;
    setProjectId(pr.id);
    await refresh();
    return pr.id;
  }

  async function parseFile(file: File) {
    setBusy(true); setError(null);
    try {
      const id = await ensureProject(nameFor(file));
      const fd = new FormData(); fd.append("file", file);
      const r = await api<ParseResult>(p(id, "/scenes/parse-script"), { formData: fd });
      const detected = initialRows(r.characters, r.existingCharacters);
      setParsed(r); setRows(detected);
      // The characters the reader found are taken as they come; the Characters page is where they are tidied.
      await finish({ parsed: r, rows: detected });
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  /** Create/update the production, import the breakdown if a script was read, and open the production. */
  async function finish(from?: { parsed: ParseResult; rows: ConfirmRow[] }) {
    // parseFile calls this in the same tick it reads the script, before its own state has landed.
    const script = from?.parsed ?? parsed;
    const cast = from?.rows ?? rows;
    setBusy(true); setError(null);
    try {
      const existed = !!projectIdRef.current;
      // A production named after its script keeps that name: the later save must not rename it "Untitled".
      const name = nameRef.current || nameFor();
      const id = await ensureProject(name);
      // Dates edited after going Back are saved before the import.
      if (existed) await api(`/projects/${id}`, { method: "PATCH", body: projectBody(name) });
      if (script) {
        const { characterMap, castNumbers } = buildCharacterImport(cast, script.existingCharacters);
        const scenes = script.scenes.map((s) => ({ number: s.number, name: s.name, location: s.location, intExt: s.intExt, timeOfDay: s.timeOfDay, scriptDay: s.scriptDay || null, synopsis: s.synopsis, status: s.status, pages: s.pages || null, characters: s.characters, scriptText: s.text || null }));
        await api(p(id, "/scenes/import"), { body: { scenes, revision: f.revision || null, characterMap, castNumbers } });
      }
      qc.invalidateQueries();
      nav(`/p/${id}`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  // Anything picked or typed so far counts: Cancel asks before throwing the setup away.
  const started = !!f.type || !!parsed || [f.prepStartDate, f.prepEndDate, f.prepWrapDate, f.startDate, f.endDate, f.wrapDate].some(Boolean);
  // Cancel, the browser's Back and closing the tab all go through this guard, which asks before leaving.
  useUnsavedGuard(started && !busy, "Leave production setup? What you have entered so far will be lost.");
  const cancel = () => nav("/projects");

  // Plain render helpers (not nested components): a component type created per render would remount its inputs on every keystroke.
  const backAndCancel = (
    <div className="row gap-2">
      {step > 0 && <button type="button" className="btn" onClick={() => setStep((s) => s - 1)} disabled={busy}>Back</button>}
      <button type="button" className="btn btn-ghost" onClick={cancel}>Cancel</button>
    </div>
  );
  const navRow = (next: () => void, canNext = true, skip?: () => void) => (
    <div className="row between mt-3">
      {backAndCancel}
      <div className="row gap-2">
        {skip && <button type="button" className="btn btn-ghost" onClick={skip} disabled={busy}>Skip</button>}
        <button type="button" className="btn btn-primary" onClick={next} disabled={!canNext || busy}>{busy ? "Working…" : "Continue"}</button>
      </div>
    </div>
  );
  const dateField = (label: string, key: DateKey, min?: string) => (
    <Field label={label}><Input type="date" value={f[key]} min={min || undefined} onChange={(e) => setF({ ...f, [key]: e.target.value })} /></Field>
  );
  /** Every one of these is optional — a production is often set up before the calendar is settled. */
  const dateRange = (title: string, start: DateKey, end: DateKey) => (
    <div>
      <div className="bold" style={{ marginBottom: 6 }}>{title}</div>
      <div className="grid grid-2 keep">
        {dateField("Start date", start)}
        {dateField("End date", end, f[start])}
      </div>
    </div>
  );
  /** Turning a section off clears its dates, so nothing hidden is saved. */
  const toggleDates = (on: boolean, keys: DateKey[], set: (v: boolean) => void) => {
    set(on);
    if (!on) setF((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, ""])) }));
  };

  return (
    <div className="login" style={{ alignItems: "start", paddingTop: 48 }}>
      <div className="card" style={{ width: "100%", maxWidth: step >= 3 ? 900 : 560, padding: 28 }}>
        <div className="row gap-2 mb-2"><div className="brand-mark">C&amp;S</div><div className="subtle">Create a production · step {Math.min(step + 1, STEPS)} of {STEPS}</div></div>
        {step === 0 && (<>
          <h2 className="center">Select</h2>
          <div className="grid grid-2 keep mt-3">
            {[["FEATURE", "Feature", <Film key="f" size={40} />], ["EPISODIC", "TV Series", <Tv key="t" size={40} />]].map(([v, label, icon]) => (
              <button key={v as string} type="button" className="card flat" style={{ padding: 22, textAlign: "center", cursor: "pointer", borderColor: f.type === v ? "var(--ink)" : undefined, borderWidth: f.type === v ? 2 : 1 }} onClick={() => setF({ ...f, type: v as string })}>
                <div style={{ color: "var(--text-2)" }}>{icon}</div><div className="bold mt-1">{label}</div>
              </button>
            ))}
          </div>
          {navRow(() => setStep(1), !!f.type)}
        </>)}
        {step === 1 && (<>
          <h2 className="center">What are the estimated shoot dates?</h2>
          <div className="col mt-3" style={{ gap: 18 }}>
            {dateRange("Shoot dates", "startDate", "endDate")}
            <div className="row gap-3 wrap">
              <label className="check"><input type="checkbox" checked={withPrep} onChange={(e) => toggleDates(e.target.checked, ["prepStartDate", "prepEndDate", "prepWrapDate"], setWithPrep)} /> Add prep dates</label>
              <label className="check"><input type="checkbox" checked={withWrap} onChange={(e) => toggleDates(e.target.checked, ["wrapDate", "prepWrapDate"], setWithWrap)} /> Add wrap dates</label>
            </div>
            {withPrep && dateRange("Prep dates", "prepStartDate", "prepEndDate")}
            {withWrap && (
              <div>
                <div className="bold" style={{ marginBottom: 6 }}>Wrap dates</div>
                <div className="grid grid-2 keep">
                  {dateField("Shoot wrap", "wrapDate", f.startDate)}
                  {withPrep && dateField("Prep wrap", "prepWrapDate", f.prepStartDate)}
                </div>
              </div>
            )}
          </div>
          {/* Skip moves on with no dates at all, clearing any half-entered ones. */}
          {navRow(() => setStep(2), true, () => {
            setWithPrep(false); setWithWrap(false);
            setF((prev) => ({ ...prev, prepStartDate: "", prepEndDate: "", prepWrapDate: "", startDate: "", endDate: "", wrapDate: "" }));
            setStep(2);
          })}
        </>)}
        {step === 2 && (<>
          <h2 className="center row gap-1" style={{ justifyContent: "center" }}><FileText size={20} /> Upload script for breakdown</h2>
          <div className="col mt-3">
            <Input value={f.revision} onChange={(e) => setF({ ...f, revision: e.target.value })} placeholder="Draft (ex. Blue)" style={{ maxWidth: 260, alignSelf: "center" }} />
            <div className="card flat" style={{ borderStyle: "dashed", textAlign: "center", padding: 30, cursor: "pointer" }} onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) parseFile(file); }}>
              <Upload size={34} color="var(--info)" />
              <div className="bold mt-1">{busy ? "Reading the script…" : "Drag and Drop File"}</div>
              <div className="subtle">or click to browse · Final Draft, text, PDF</div>
              <input ref={fileRef} type="file" accept=".fdx,.txt,.pdf,application/pdf,text/plain" hidden onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])} />
            </div>
          </div>
          <ErrorBox error={error} />
          {/* The script is optional: reading one imports it and opens the production; Continue without one creates it as is. */}
          {navRow(() => finish())}
        </>)}
      </div>
    </div>
  );
}
