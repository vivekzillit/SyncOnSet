import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Film, Tv, Upload, FileText } from "lucide-react";
import { api, p } from "@/api/client";
import { useAuth } from "@/state/auth";
import { ErrorBox, Field, Input } from "@/components/ui";
import { CharacterConfirmation, buildCharacterImport, initialRows, manualCharacters, type ConfirmRow, type DetectedCharacter, type ExistingCharacter } from "@/components/CharacterConfirmation";

const STEPS = 5;

interface ParsedScene { number: string; name: string | null; location: string | null; intExt: string | null; timeOfDay: string | null; scriptDay?: string | null; synopsis: string | null; status?: string; characters: string[]; text?: string; pages?: string | null }
interface ParseResult { format: string; file: string; scenes: ParsedScene[]; characters: DetectedCharacter[]; existingCharacters: ExistingCharacter[]; warnings: string[] }
type DateKey = "prepStartDate" | "prepEndDate" | "prepWrapDate" | "startDate" | "endDate" | "wrapDate";

/** SyncOnSet-style production setup: type → title → prep & shoot dates → script upload (optional) → character confirmation. */
export default function ProductionWizard() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user, refresh } = useAuth();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ type: "", name: "", prepStartDate: "", prepEndDate: "", prepWrapDate: "", startDate: "", endDate: "", wrapDate: "", revision: "White" });
  const [withPrep, setWithPrep] = useState(false);
  const [withWrap, setWithWrap] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [rows, setRows] = useState<ConfirmRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const firstName = (user?.name || "").split(" ")[0];
  const kind = f.type === "EPISODIC" ? "series" : "feature";

  const code = () => (f.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "PROD") + String(Math.floor(Math.random() * 900) + 100);
  const projectBody = () => ({ name: f.name.trim(), type: f.type || "FEATURE", prepStartDate: f.prepStartDate || null, prepEndDate: f.prepEndDate || null, prepWrapDate: f.prepWrapDate || null, startDate: f.startDate || null, endDate: f.endDate || null, wrapDate: f.wrapDate || null });

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
      setParsed(r); setRows(initialRows(r.characters, r.existingCharacters)); setStep(4);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  /** Create/update the production, import the confirmed breakdown if a script was read, and open the Scenes list. */
  async function finish() {
    setBusy(true); setError(null);
    try {
      const existed = !!projectId;
      const id = await ensureProject();
      // Anything edited after going Back (title, dates) is saved before the import.
      if (existed) await api(`/projects/${id}`, { method: "PATCH", body: projectBody() });
      if (parsed) {
        const { characterMap, castNumbers } = buildCharacterImport(rows, parsed.existingCharacters);
        const scenes = parsed.scenes.map((s) => ({ number: s.number, name: s.name, location: s.location, intExt: s.intExt, timeOfDay: s.timeOfDay, scriptDay: s.scriptDay || null, synopsis: s.synopsis, status: s.status, pages: s.pages || null, characters: s.characters, scriptText: s.text || null }));
        await api(p(id, "/scenes/import"), { body: { scenes, revision: f.revision || null, characterMap, castNumbers } });
        for (const c of manualCharacters(rows, parsed.existingCharacters, parsed.characters)) {
          await api(p(id, "/characters"), { body: { name: c.name, type: "SUPPORTING", castNumber: c.castNumber } });
        }
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
      <div className="card" style={{ width: "100%", maxWidth: step >= 4 ? 900 : 560, padding: 28 }}>
        <div className="row gap-2 mb-2"><div className="brand-mark">C&amp;S</div><div className="subtle">Create a production · step {Math.min(step + 1, STEPS)} of {STEPS}</div></div>
        {step === 0 && (<>
          <h2 className="center">What are you working on{firstName ? `, ${firstName}` : ""}?</h2>
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
          <h2 className="center">What is the title of your {kind}?</h2>
          <div className="mt-3"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Production Title" autoFocus onKeyDown={(e) => e.key === "Enter" && f.name.trim() && setStep(2)} /></div>
          {navRow(() => setStep(2), !!f.name.trim())}
        </>)}
        {step === 2 && (<>
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
          {navRow(() => setStep(3))}
        </>)}
        {step === 3 && (<>
          <h2 className="center row gap-1" style={{ justifyContent: "center" }}><FileText size={20} /> Upload script for breakdown</h2>
          <div className="col mt-3">
            <Input value={f.revision} onChange={(e) => setF({ ...f, revision: e.target.value })} placeholder="Draft (ex. Blue)" style={{ maxWidth: 260, alignSelf: "center" }} />
            <div className="card flat" style={{ borderStyle: "dashed", textAlign: "center", padding: 30, cursor: "pointer" }} onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) parseFile(file); }}>
              <Upload size={34} color="var(--info)" />
              <div className="bold mt-1">{busy ? "Reading the script…" : "Drag and Drop File"}</div>
              <div className="subtle">or click to browse · Final Draft, Fountain, text, PDF</div>
              <input ref={fileRef} type="file" accept=".fdx,.fountain,.txt,.pdf,application/pdf,text/plain" hidden onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])} />
            </div>
          </div>
          <ErrorBox error={error} />
          {/* The script is optional: with one read, Continue goes to Character Confirmation; without, it creates the production as is. */}
          {navRow(() => (parsed ? setStep(4) : finish()))}
        </>)}
        {step === 4 && parsed && (<>
          <div className="row between wrap gap-2">
            <h2>🎭 List of Character</h2>
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
