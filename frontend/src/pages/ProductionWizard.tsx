import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Film, Tv, Upload, FileText } from "lucide-react";
import { api, p } from "@/api/client";
import { useAuth } from "@/state/auth";
import { ErrorBox, Field, Input, Select } from "@/components/ui";
import { CharacterConfirmation, buildCharacterImport, initialRows, type ConfirmRow, type DetectedCharacter, type ExistingCharacter } from "@/components/CharacterConfirmation";

const BUDGETS: [string, string][] = [["UNDER_2M", "Under 2M"], ["2_5M", "2 - 5M"], ["5_10M", "5 - 10M"], ["10_20M", "10 - 20M"], ["20_80M", "20 - 80M"], ["80M_PLUS", "80+M"]];
const STUDIOS = ["Yash Raj Films", "Dharma Productions", "Excel Entertainment", "Red Chillies Entertainment", "T-Series", "Eros International", "Netflix", "Amazon Studios", "Disney+ Hotstar", "Sony Pictures", "Warner Bros.", "Universal", "Paramount", "BBC", "Independent", "Other"];
const COUNTRIES = ["India", "United Kingdom", "United States", "United Arab Emirates", "Australia", "Canada", "France", "Germany", "Italy", "Spain", "Sri Lanka", "Nepal", "Bangladesh", "Singapore", "Thailand", "South Africa", "New Zealand", "Other"];

interface ParsedScene { number: string; name: string | null; location: string | null; intExt: string | null; timeOfDay: string | null; synopsis: string | null; status?: string; characters: string[]; text?: string; pages?: string | null }
interface ParseResult { format: string; file: string; scenes: ParsedScene[]; characters: DetectedCharacter[]; existingCharacters: ExistingCharacter[]; warnings: string[] }

/** SyncOnSet-style production setup: type → title → studio → budget & dates → location → script → character confirmation. */
export default function ProductionWizard() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user, refresh } = useAuth();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ type: "", name: "", studio: "", studioOther: "", budgetBand: "", startDate: "", endDate: "", country: "India", city: "", revision: "White" });
  const [projectId, setProjectId] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [rows, setRows] = useState<ConfirmRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const firstName = (user?.name || "").split(" ")[0];

  const code = () => (f.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "PROD") + String(Math.floor(Math.random() * 900) + 100);

  async function ensureProject(): Promise<string> {
    if (projectId) return projectId;
    const pr = await api<{ id: string }>("/projects", { body: { name: f.name.trim(), code: code(), status: "PREP", type: f.type || "FEATURE", studio: f.studio === "Other" ? f.studioOther || null : f.studio || null, budgetBand: f.budgetBand || null, startDate: f.startDate || null, endDate: f.endDate || null, country: f.country || null, city: f.city || null, currentLocation: [f.city, f.country].filter(Boolean).join(", ") || null } });
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
      setParsed(r); setRows(initialRows(r.characters, r.existingCharacters)); setStep(6);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function useDemo() {
    const res = await fetch("/demo-script.fountain"); const text = await res.text();
    await parseFile(new File([text], "demo-script.fountain", { type: "text/plain" }));
  }
  async function finish(importScenes: boolean) {
    setBusy(true); setError(null);
    try {
      const id = await ensureProject();
      if (importScenes && parsed) {
        const { characterMap, castNumbers } = buildCharacterImport(rows, parsed.existingCharacters);
        const scenes = parsed.scenes.map((s) => ({ number: s.number, name: s.name, location: s.location, intExt: s.intExt, timeOfDay: s.timeOfDay, synopsis: s.synopsis, status: s.status, pages: s.pages || null, characters: s.characters, scriptText: s.text || null }));
        await api(p(id, "/scenes/import"), { body: { scenes, revision: f.revision || null, characterMap, castNumbers } });
      }
      qc.invalidateQueries();
      nav(`/p/${id}/scenes`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  const Nav = ({ next, canNext = true, nextLabel = "Continue", skip }: { next: () => void; canNext?: boolean; nextLabel?: string; skip?: () => void }) => (
    <div className="row between mt-3">
      {step > 0 ? <button type="button" className="btn" onClick={() => setStep((s) => s - 1)} disabled={busy}>Back</button> : <Link to="/projects" className="btn">Cancel</Link>}
      <div className="row gap-2">{skip && <button type="button" className="btn btn-ghost" onClick={skip} disabled={busy}>Skip</button>}<button type="button" className="btn btn-primary" onClick={next} disabled={!canNext || busy}>{busy ? "Working…" : nextLabel}</button></div>
    </div>
  );

  return (
    <div className="login" style={{ alignItems: "start", paddingTop: 48 }}>
      <div className="card" style={{ width: "100%", maxWidth: step >= 6 ? 900 : 560, padding: 28 }}>
        <div className="row gap-2 mb-2"><div className="brand-mark">C&amp;S</div><div className="subtle">Create a production · step {Math.min(step + 1, 7)} of 7</div></div>
        {step === 0 && (<>
          <h2 className="center">What are you working on{firstName ? `, ${firstName}` : ""}?</h2>
          <div className="grid grid-2 keep mt-3">
            {[["FEATURE", "Feature", <Film key="f" size={40} />], ["EPISODIC", "Episodic", <Tv key="t" size={40} />]].map(([v, label, icon]) => (
              <button key={v as string} type="button" className="card flat" style={{ padding: 22, textAlign: "center", cursor: "pointer", borderColor: f.type === v ? "var(--ink)" : undefined, borderWidth: f.type === v ? 2 : 1 }} onClick={() => setF({ ...f, type: v as string })}>
                <div style={{ color: "var(--text-2)" }}>{icon}</div><div className="bold mt-1">{label}</div>
              </button>
            ))}
          </div>
          <Nav next={() => setStep(1)} canNext={!!f.type} />
        </>)}
        {step === 1 && (<>
          <h2 className="center">What is the title of your {f.type === "EPISODIC" ? "series" : "feature"}?</h2>
          <div className="mt-3"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Production Title" autoFocus onKeyDown={(e) => e.key === "Enter" && f.name.trim() && setStep(2)} /></div>
          <Nav next={() => setStep(2)} canNext={!!f.name.trim()} />
        </>)}
        {step === 2 && (<>
          <h2 className="center">Which studio are you working with?</h2>
          <div className="col mt-3">
            <Select value={f.studio} onChange={(e) => setF({ ...f, studio: e.target.value })} options={STUDIOS} placeholder="Select a studio" humanizeLabels={false} />
            {f.studio === "Other" && <Input value={f.studioOther} onChange={(e) => setF({ ...f, studioOther: e.target.value })} placeholder="Other Studio" autoFocus />}
          </div>
          <Nav next={() => setStep(3)} />
        </>)}
        {step === 3 && (<>
          <h2 className="center">What is the total budget of the {f.type === "EPISODIC" ? "series" : "feature"}?</h2>
          <div className="row gap-1 wrap mt-2" style={{ justifyContent: "center" }}>{BUDGETS.map(([v, l]) => <button key={v} type="button" className={`chip ${f.budgetBand === v ? "active" : ""}`} onClick={() => setF({ ...f, budgetBand: v })}>{l}</button>)}</div>
          <h2 className="center mt-4">What are the estimated shoot dates?</h2>
          <div className="row gap-2 mt-2"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></div>
          <Nav next={() => setStep(4)} />
        </>)}
        {step === 4 && (<>
          <h2 className="center">What is the primary shooting location?</h2>
          <div className="col mt-3">
            <Select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} options={COUNTRIES} placeholder="Country" humanizeLabels={false} />
            <Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="City" autoFocus />
          </div>
          <Nav next={() => setStep(5)} />
        </>)}
        {step === 5 && (<>
          <h2 className="center row gap-1" style={{ justifyContent: "center" }}><FileText size={20} /> Have a file to break down?</h2>
          <div className="subtle center mt-1">If you'd like to enter your breakdown by hand, enter a draft name and press Skip.</div>
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
          <Nav next={() => finish(false)} nextLabel="Continue without a script" skip={() => finish(false)} />
        </>)}
        {step === 6 && parsed && (<>
          <div className="row between wrap gap-2">
            <h2>🎭 Character Confirmation</h2>
            <div className="row gap-2"><button type="button" className="btn btn-ghost" onClick={() => finish(true)} disabled={busy}>Skip</button><button type="button" className="btn btn-primary" onClick={() => finish(true)} disabled={busy}>{busy ? "Importing…" : "Continue"}</button></div>
          </div>
          <div className="subtle mb-2">{parsed.file} · {parsed.scenes.length} scenes · draft "{f.revision || "—"}"</div>
          {parsed.warnings.map((w, i) => <div key={i} className="notice mb-2">{w}</div>)}
          <CharacterConfirmation rows={rows} onChange={setRows} detected={parsed.characters} existing={parsed.existingCharacters} />
          <ErrorBox error={error} />
          <div className="row between mt-3"><button type="button" className="btn" onClick={() => setStep(5)} disabled={busy}>Back</button><div className="row gap-2"><button type="button" className="btn btn-ghost" onClick={() => finish(true)} disabled={busy}>Skip</button><button type="button" className="btn btn-primary" onClick={() => finish(true)} disabled={busy}>{busy ? "Importing…" : "Continue"}</button></div></div>
        </>)}
      </div>
    </div>
  );
}
