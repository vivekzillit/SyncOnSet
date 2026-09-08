import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Camera, CameraOff, Keyboard } from "lucide-react";
import { api, ApiError, p } from "@/api/client";
import { useProject } from "@/state/project";
import { dateKey, fmtDate, humanize, todayISO } from "@/lib/format";
import type { Alteration, CleaningRequest, Costume, Scene } from "@/api/types";
import { Badge, Card, Input, PageHead } from "@/components/ui";
import { QRScanner } from "@/components/domain";
import { CostumeActions } from "@/components/costume";

type Lookup = Costume & { scenes: { id: string; number: string; shootDate?: string | null }[]; cleaning: CleaningRequest[]; alterations: Alteration[]; changeItems: { change: { id: string; changeNumber: number; name: string } }[] };

export default function Scan() {
  const { projectId } = useProject();
  const [sp] = useSearchParams();
  const base = `/p/${projectId}`;
  const [camera, setCamera] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costume, setCostume] = useState<Lookup | null>(null);
  const [recent, setRecent] = useState<Lookup[]>([]);
  const { data: scenes } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });
  const [sceneId, setSceneId] = useState("");
  const [take, setTake] = useState("");
  useEffect(() => {
    if (!sceneId && scenes) {
      const shooting = scenes.find((s) => s.status === "SHOOTING") || scenes.find((s) => dateKey(s.shootDate) === todayISO());
      if (shooting) setSceneId(shooting.id);
    }
  }, [scenes, sceneId]);

  const lookup = useCallback(async (raw: string) => {
    const asset = raw.trim().toUpperCase();
    if (!asset) return;
    setBusy(true);
    setError(null);
    try {
      const c = await api<Lookup>(p(projectId, `/costumes/lookup/${encodeURIComponent(asset)}`));
      setCostume(c);
      setRecent((r) => [c, ...r.filter((x) => x.id !== c.id)].slice(0, 8));
      setInput("");
      if (navigator.vibrate) navigator.vibrate(60);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Lookup failed");
      setCostume(null);
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  const refetch = useCallback(() => { if (costume) lookup(costume.assetNumber); }, [costume, lookup]);
  const openCleaning = costume?.cleaning?.[0];
  const openAlteration = costume?.alterations?.[0];

  return (
    <div>
      <PageHead title="Scan costume" sub="Point the camera at a QR label, or type the asset number." actions={<button className="btn" onClick={() => setCamera((v) => !v)}>{camera ? <><CameraOff size={16} /> Stop camera</> : <><Camera size={16} /> Camera</>}</button>} />
      <div className="grid grid-2" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.3fr)" }}>
        <div className="col gap-2">
          <Card>
            <QRScanner active={camera} onScan={lookup} />
            <form className="row gap-1 mt-2" onSubmit={(e) => { e.preventDefault(); lookup(input); }}>
              <Keyboard size={18} color="var(--text-3)" />
              <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="CST-000245" className="mono" autoFocus={!camera} />
              <button className="btn btn-primary" disabled={busy || !input}>Find</button>
            </form>
            {error && <div className="errorbox mt-2">{error}</div>}
          </Card>
          <Card title="Context for actions">
            <div className="form-grid">
              <div className="field"><label>Scene</label><select className="select" value={sceneId} onChange={(e) => setSceneId(e.target.value)}><option value="">—</option>{(scenes || []).map((s) => <option key={s.id} value={s.id}>Sc {s.number}{s.name ? ` · ${s.name}` : ""}</option>)}</select></div>
              <div className="field"><label>Take</label><Input type="number" value={take} onChange={(e) => setTake(e.target.value)} placeholder="3" /></div>
            </div>
          </Card>
          {recent.length > 0 && (
            <Card title="Recent scans" pad0>
              <div className="list">{recent.map((r) => <div key={r.id} className="item link" onClick={() => setCostume(r)}><span className="mono bold">{r.assetNumber}</span><span className="grow truncate">{r.name}</span><Badge status={r.status} /></div>)}</div>
            </Card>
          )}
        </div>
        <div>
          {costume ? (
            <Card>
              <div className="row between top wrap">
                <div>
                  <div className="big-asset">{costume.assetNumber}</div>
                  <h2 style={{ fontSize: 20 }}>{costume.name}</h2>
                  <div className="muted">{[costume.type, costume.color, costume.size ? `Size ${costume.size}` : null, costume.brand].filter(Boolean).join(" · ")}</div>
                </div>
                <Badge status={costume.status} lg />
              </div>
              <dl className="kv mt-2">
                <dt>Location</dt><dd><b>{costume.location}</b></dd>
                <dt>Character</dt><dd>{costume.character ? <Link to={`${base}/characters/${costume.character.id}`}>{costume.character.name}</Link> : "—"}</dd>
                <dt>Changes</dt><dd>{costume.changeItems.length ? costume.changeItems.map((ci) => <Link key={ci.change.id} to={`${base}/changes/${ci.change.id}`} className="chip" style={{ marginRight: 4 }}>#{ci.change.changeNumber} {ci.change.name}</Link>) : "—"}</dd>
                <dt>Scenes</dt><dd>{costume.scenes.length ? costume.scenes.map((s) => <Link key={s.id} to={`${base}/scenes/${s.id}`} className="chip" style={{ marginRight: 4 }}>Sc {s.number}{s.shootDate ? ` · ${fmtDate(s.shootDate)}` : ""}</Link>) : "—"}</dd>
                {openCleaning && <><dt>Cleaning</dt><dd><Link to={`${base}/cleaning/${openCleaning.id}`}>{openCleaning.problem} · {humanize(openCleaning.status)}</Link></dd></>}
                {openAlteration && <><dt>Alteration</dt><dd>{openAlteration.issue} → {openAlteration.required} · {humanize(openAlteration.status)}</dd></>}
              </dl>
              <div className="mt-3">
                <CostumeActions costume={costume} sceneId={sceneId || null} takeNumber={take ? Number(take) : null} onChanged={refetch} emphasizeEmergency openCleaningId={openCleaning?.id} openAlterationId={openAlteration?.id} />
              </div>
              <div className="mt-2"><Link to={`${base}/costumes/${costume.id}`} className="btn btn-ghost btn-sm">Full details & timeline →</Link></div>
            </Card>
          ) : (
            <Card>
              <div className="empty">
                <div className="icon">📷</div>
                <div className="bold">Scan a label to see status, location and actions</div>
                <div className="subtle mt-1">Issue · Return · Move · 🚨 Emergency cleaning · Damage · Missing</div>
                {sp.get("emergency") && <div className="notice mt-2">Emergency mode: scan the stained costume and hit <b>Emergency clean</b>.</div>}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
