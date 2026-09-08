import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload, FileUp, Sparkles } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, MANAGER_ROLES } from "@/state/auth";
import { dateKey, fmtDate, humanize, todayISO } from "@/lib/format";
import type { Scene } from "@/api/types";
import { Badge, Card, Chips, Dot, Empty, ErrorBox, Field, Input, Modal, PageHead, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { ScriptUploadModal } from "@/components/ScriptUpload";
import { AiCuesModal } from "@/components/AiCues";

const emptyForm = { number: "", name: "", location: "", intExt: "INT", timeOfDay: "DAY", scriptDay: "", pages: "", shootDate: "", status: "PLANNED", synopsis: "" };

export default function Scenes() {
  const { projectId, can } = useProject();
  const { meta } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [when, setWhen] = useState<"today" | "upcoming" | "all" | "">("today");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm, shootDate: todayISO() });
  const [importText, setImportText] = useState("24 | Restaurant - the dinner | Restaurant Set | INT | NIGHT | Day 3 | Raj, Priya, Waiter\n25 | Parking lot | Backlot | EXT | NIGHT | Day 3 | Raj, Priya");

  const { data, isLoading } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });
  const create = useMutation({
    mutationFn: () => api<Scene>(p(projectId, "/scenes"), { body: { ...form, shootDate: form.shootDate || null, intExt: form.intExt || null, timeOfDay: form.timeOfDay || null } }),
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ["scenes", projectId] }); setOpen(false); toast.push("Scene created", "ok"); nav(`/p/${projectId}/scenes/${s.id}`); },
  });
  const importM = useMutation({
    mutationFn: () => {
      const scenes = importText.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
        const [number, name, location, intExt, timeOfDay, scriptDay, chars] = line.split("|").map((s) => s.trim());
        return { number, name: name || null, location: location || null, intExt: intExt || null, timeOfDay: timeOfDay || null, scriptDay: scriptDay || null, characters: chars ? chars.split(",").map((c) => c.trim()).filter(Boolean) : [] };
      });
      return api<{ scenes: number; charactersCreated: number }>(p(projectId, "/scenes/import"), { body: { scenes } });
    },
    onSuccess: (r) => { qc.invalidateQueries(); setImportOpen(false); toast.push(`Imported ${r.scenes} scenes, ${r.charactersCreated} new characters`, "ok"); },
  });

  const today = todayISO();
  const list = useMemo(() => {
    let items = data || [];
    if (when === "today") items = items.filter((s) => dateKey(s.shootDate) === today);
    if (when === "upcoming") items = items.filter((s) => s.shootDate && dateKey(s.shootDate) >= today);
    if (status) items = items.filter((s) => s.status === status);
    return items;
  }, [data, when, status, today]);

  return (
    <div>
      <PageHead title="Scenes" sub="Script breakdown & costume readiness per scene" actions={<>{can(MANAGER_ROLES) && (<><button className="btn btn-accent" onClick={() => setScriptOpen(true)}><FileUp size={16} /> Upload script</button><button className="btn" onClick={() => setImportOpen(true)}><Upload size={16} /> Import breakdown</button><button className="btn" onClick={() => setAiOpen(true)} title="Read the script for costume cues (garments, condition, changes, continuity)"><Sparkles size={16} /> Script cues</button><button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Scene</button></>)}</>} />
      <div className="filters">
        <Chips options={[{ key: "today", label: "Today" }, { key: "upcoming", label: "Upcoming" }, { key: "all", label: "All" }]} value={when} onChange={(v) => setWhen(v || "all")} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} options={meta?.sceneStatuses || []} placeholder="Any status" />
      </div>
      <Card pad0>
        {isLoading ? <Spinner /> : list.length === 0 ? <Empty icon="🎬" title={when === "today" ? "No scenes scheduled today" : "No scenes"} hint="Upload the script to build the breakdown automatically, paste a breakdown, or add scenes manually." /> : (
          <div className="list">
            {list.map((s) => (
              <Link key={s.id} to={`/p/${projectId}/scenes/${s.id}`} className="item link">
                <Dot status={s.readiness} pulse={s.readiness === "MISSING"} />
                <div className="avatar">{s.number}</div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="title truncate">{s.name || `Scene ${s.number}`}</div>
                  <div className="meta truncate">{[s.intExt, s.location, s.timeOfDay, s.scriptDay].filter(Boolean).join(" · ")} · {s.characters.map((c) => c.character.name).join(", ") || "no characters"}</div>
                </div>
                <div className="end">
                  <span className="subtle nowrap">{s.shootDate ? fmtDate(s.shootDate) : "unscheduled"}</span>
                  <Badge status={s.readiness}>{s.readiness === "READY" ? "Ready" : humanize(s.readiness)}</Badge>
                  <Badge status={s.status} className="hide-mobile" />
                  {s.revision && <span className="subtle tiny hide-mobile" title="Script revision">{s.revision}</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New scene" footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!form.number || create.isPending} onClick={() => create.mutate()}>Create</button></>}>
        <div className="form-grid">
          <Field label="Scene number"><Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="24A" /></Field>
          <Field label="Slugline / name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Location"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label="Script day"><Input value={form.scriptDay} onChange={(e) => setForm({ ...form, scriptDay: e.target.value })} placeholder="Day 3" /></Field>
          <Field label="INT / EXT"><Select value={form.intExt} onChange={(e) => setForm({ ...form, intExt: e.target.value })} options={meta?.intExt || []} placeholder="—" humanizeLabels={false} /></Field>
          <Field label="Time of day"><Select value={form.timeOfDay} onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })} options={meta?.timesOfDay || []} placeholder="—" /></Field>
          <Field label="Shoot date"><Input type="date" value={form.shootDate} onChange={(e) => setForm({ ...form, shootDate: e.target.value })} /></Field>
          <Field label="Status"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={meta?.sceneStatuses || []} /></Field>
          <Field label="Pages"><Input value={form.pages} onChange={(e) => setForm({ ...form, pages: e.target.value })} placeholder="2 3/8" /></Field>
          <Field label="Synopsis" span2><Textarea value={form.synopsis} onChange={(e) => setForm({ ...form, synopsis: e.target.value })} /></Field>
        </div>
        <ErrorBox error={create.error} />
      </Modal>

      <ScriptUploadModal open={scriptOpen} onClose={() => setScriptOpen(false)} onImported={() => setWhen("all")} />
      <AiCuesModal open={aiOpen} onClose={() => setAiOpen(false)} scenes={data || []} />
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import script breakdown" footer={<><button className="btn" onClick={() => setImportOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={importM.isPending} onClick={() => importM.mutate()}>Import</button></>}>
        <div className="notice info mb-2">One scene per line: <span className="mono">number | name | location | INT/EXT | DAY/NIGHT | script day | characters (comma separated)</span>. Unknown characters are created automatically. Existing scene numbers are updated.</div>
        <Textarea rows={10} value={importText} onChange={(e) => setImportText(e.target.value)} className="mono" />
        <ErrorBox error={importM.error} />
      </Modal>
    </div>
  );
}
