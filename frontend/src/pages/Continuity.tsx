import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, AlertTriangle, Camera, CameraOff, ClipboardList, Keyboard, Printer } from "lucide-react";
import { api, ApiError, p } from "@/api/client";
import { useProject } from "@/state/project";
import { CONTINUITY_ROLES } from "@/state/auth";
import { dateKey, fmtDate, fmtDateTime, todayISO } from "@/lib/format";
import { characterReadiness, itemLevel } from "@/lib/readiness";
import type { Character, ContinuityRecord, Costume, Scene } from "@/api/types";
import { Badge, Card, Dot, Empty, ErrorBox, Field, Input, PageHead, Select, Spinner, Tabs, Textarea, useToast } from "@/components/ui";
import { PhotoGrid, QRScanner } from "@/components/domain";
import { ScheduleUploadModal } from "@/components/ScheduleUpload";

const DEFAULT_DETAILS = ["Shirt", "Sleeves", "Collar", "Trousers", "Hair", "Accessories"];
type Draft = { takeNumber: string; details: { k: string; v: string }[]; accessories: { name: string; present: boolean }[]; notes: string };

/**
 * The scene in hand, who is in it, the change in play and the takes already recorded.
 * Nothing is chosen until a scene is clicked; the character then follows from the scene.
 */
function useContinuity() {
  const { projectId } = useProject();
  const [sp, setSp] = useSearchParams();
  const { data: scenes } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });
  const sceneId = sp.get("sceneId") || "";
  const characterId = sp.get("characterId") || "";
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k === "sceneId") n.delete("characterId"); setSp(n, { replace: true }); };
  /** Jump straight to one character in one scene — setting the scene alone would clear the character. */
  const goTo = (scene: string, character: string) => { const n = new URLSearchParams(sp); n.set("sceneId", scene); n.set("characterId", character); setSp(n, { replace: true }); };

  const { data: scene } = useQuery({ queryKey: ["scene", sceneId], queryFn: () => api<Scene>(p(projectId, `/scenes/${sceneId}`)), enabled: !!sceneId });
  useEffect(() => {
    if (scene && !characterId && scene.characters.length) set("characterId", scene.characters[0].characterId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, characterId]);

  const { data: cmp, isLoading } = useQuery({
    queryKey: ["continuity", projectId, sceneId, characterId],
    queryFn: () => api<{ records: ContinuityRecord[]; flags: { take: number; message: string }[] }>(p(projectId, `/continuity/compare?sceneId=${sceneId}&characterId=${characterId}`)),
    enabled: !!sceneId && !!characterId,
  });
  const sc = scene?.characters.find((c) => c.characterId === characterId);
  const records = cmp?.records || [];
  return { projectId, scenes, scene, sceneId, characterId, set, goTo, sc, records, flags: cmp?.flags || [], isLoading, last: records[records.length - 1] };
}

/**
 * The shooting day as wardrobe sees it: the scenes a call sheet put on this date, who is in them, and
 * whether their pieces are actually ready. Tapping a character arms the take form below for them.
 */
function ShootDay({ c, day, onDay, detail }: { c: ReturnType<typeof useContinuity>; day: string; onDay: (d: string) => void; detail?: ReactNode }) {
  const { project } = useProject();
  const scenes = useMemo(() => (c.scenes || []).filter((s) => dateKey(s.shootDate) === day && s.status !== "OMITTED"), [c.scenes, day]);
  const rows = scenes.flatMap((s) => s.characters.map((sc) => ({ scene: s, sc, r: characterReadiness(sc) })));
  const notReady = rows.filter((x) => x.r.level !== "READY");
  const locations = Array.from(new Set(scenes.map((s) => (s.location || "").trim()).filter(Boolean)));

  return (
    <Card
      title={<span className="row gap-2">On set · {fmtDate(day, { weekday: "short", day: "2-digit", month: "short" })}{project?.shootingDay ? <span className="subtle">Day {project.shootingDay}</span> : null}</span>}
      actions={<Input type="date" value={day} onChange={(e) => onDay(e.target.value || todayISO())} style={{ width: "auto" }} aria-label="Shooting day" />}
      className="mb-2"
    >
      {scenes.length === 0 ? (
        <Empty icon="📋" title="Nothing scheduled for this day" hint="Upload the call sheet and its scenes land here with the date on them." />
      ) : (
        <>
          <div className="row gap-2 wrap mb-2 subtle">
            <span><b>{scenes.length}</b> scene{scenes.length === 1 ? "" : "s"}</span>
            <span><b>{rows.length}</b> character{rows.length === 1 ? "" : "s"}</span>
            <span><b>{rows.length - notReady.length}</b> ready</span>
            {notReady.length > 0 && <span className="row gap-1" style={{ color: "var(--danger)" }}><AlertTriangle size={14} /> {notReady.length} not ready</span>}
            {locations.length > 0 && <span>{locations.join(" · ")}</span>}
          </div>
          <div className="col gap-2">
            {scenes.map((s) => (
              <div key={s.id} className="card flat" style={{ padding: 12, borderColor: c.sceneId === s.id ? "var(--ink)" : undefined }}>
                <div className="row between wrap gap-2">
                  <button type="button" className="btn btn-ghost btn-sm bold" style={{ padding: "2px 6px", marginLeft: -6 }} onClick={() => c.goTo(s.id, s.characters[0]?.characterId || "")} title="Open the take form for this scene">
                    Sc {s.number}{s.name ? ` · ${s.name}` : ""}
                  </button>
                  <span className="subtle">{[s.intExt, s.location, s.timeOfDay].filter(Boolean).join(" · ")}</span>
                </div>
                {s.characters.length === 0 ? <div className="subtle mt-1">No characters tagged to this scene.</div> : (
                  <div className="chips mt-2">
                    {s.characters.map((sc) => {
                      const r = characterReadiness(sc);
                      const on = c.sceneId === s.id && c.characterId === sc.characterId;
                      return (
                        <button key={sc.id} type="button" className={`chip ${on ? "active" : ""}`} title={r.blockers.join("\n") || "Every piece ready"} onClick={() => c.goTo(s.id, sc.characterId)}>
                          <Dot status={r.level} pulse={r.level === "MISSING"} /> {sc.character.name}
                          <span className="subtle" style={{ marginLeft: 6 }}>{r.total ? `${r.ready}/${r.total}` : "no change"}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {detail && c.sceneId === s.id && (
                  <div className="mt-2">
                    <SelectedScene c={c} />
                    {detail}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

/** What the chosen character is wearing in the chosen scene, shown once a scene has been clicked. */
function SelectedScene({ c }: { c: ReturnType<typeof useContinuity> }) {
  const { projectId } = useProject();
  const base = `/p/${projectId}`;
  if (!c.scene || !c.sc) return null;
  return (
    <>
      <div className="notice info mb-2">
        <b>{c.sc.character.name}</b> in Sc {c.scene.number}: {c.sc.change ? <Link to={`${base}/changes/${c.sc.change.id}`}><u>Change #{c.sc.change.changeNumber} {c.sc.change.name}</u></Link> : "no change assigned"}
        {c.sc.change?.items?.length ? <> — {c.sc.change.items.map((i) => `${i.costume.name}${i.wearNotes ? ` (${i.wearNotes})` : ""}`).join(", ")}</> : null}
      </div>
      {c.flags.length > 0 && (
        <div className="notice mb-2"><div className="row gap-1 bold"><AlertTriangle size={16} /> Continuity flags</div><ul style={{ margin: "6px 0 0 18px" }}>{c.flags.map((fl, i) => <li key={i}>Take {fl.take}: {fl.message}</li>)}</ul></div>
      )}
    </>
  );
}

/** A scene nobody is tagged to yet: pick who is in it, which both tags them and opens the take form. */
function TagSomeone({ c }: { c: ReturnType<typeof useContinuity> }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pick, setPick] = useState("");
  const { data: characters } = useQuery({ queryKey: ["characters", c.projectId], queryFn: () => api<Character[]>(p(c.projectId, "/characters")) });
  const add = useMutation({
    mutationFn: (characterId: string) => api(p(c.projectId, `/scenes/${c.sceneId}/characters/${characterId}`), { method: "PUT", body: {} }),
    onSuccess: async (_r, characterId) => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["scene", c.sceneId] }), qc.invalidateQueries({ queryKey: ["scenes", c.projectId] })]);
      c.goTo(c.sceneId, characterId);
      toast.push("Added to the scene", "ok");
    },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  return (
    <Card title={`Sc ${c.scene?.number || ""} · nobody is tagged to this scene yet`}>
      <div className="col gap-2">
        <div className="subtle">A take is recorded against a character. Pick who is in this scene and the form opens; they are added to the scene at the same time.</div>
        <div className="row gap-2 wrap">
          <Select value={pick} onChange={(e) => setPick(e.target.value)} options={(characters || []).map((ch) => ({ value: ch.id, label: `${ch.castNumber != null ? `${ch.castNumber}. ` : ""}${ch.name}` }))} placeholder="Choose a character" style={{ minWidth: 240 }} />
          <button className="btn btn-primary" disabled={!pick || add.isPending} onClick={() => add.mutate(pick)}>{add.isPending ? "Adding…" : "Add to scene"}</button>
          <Link to={`/p/${c.projectId}/scenes/${c.sceneId}`} className="btn btn-ghost">Open the scene</Link>
        </div>
        {!characters?.length && <div className="notice">This production has no characters yet. Upload the script, or add them on the Characters page.</div>}
      </div>
    </Card>
  );
}

/** On set: the day board, with the record-take form under whichever scene is open. */
export default function ContinuityOnSet() {
  const c = useContinuity();
  const { can } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const mayRecord = can(CONTINUITY_ROLES);
  const [f, setF] = useState<Draft>({ takeNumber: "1", details: [], accessories: [], notes: "" });
  const [camera, setCamera] = useState(false);
  const [asset, setAsset] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [callsheetOpen, setCallsheetOpen] = useState(false);
  const [day, setDay] = useState(todayISO());

  // The book and the scene pages link straight to a scene, which may sit on another day. The form lives
  // inside that scene's card on the day board, so the board has to follow the link in or nothing opens.
  useEffect(() => {
    const d = dateKey(c.scene?.shootDate);
    if (d) setDay(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.scene?.id]);

  // The form starts on the next take, pre-filled from the last one, until the user edits it.
  const fill = useMemo(() => {
    const details = c.last ? Object.entries(c.last.details).map(([k, v]) => ({ k, v })) : DEFAULT_DETAILS.map((k) => ({ k, v: "" }));
    const accessories = c.last ? c.last.accessories.map((a) => ({ ...a })) : (c.sc?.change?.items || []).filter((i) => ["ACCESSORY", "JEWELLERY"].includes(i.costume.category)).map((i) => ({ name: i.costume.name, present: true }));
    return { takeNumber: String((c.last?.takeNumber || 0) + 1), details, accessories, notes: "" };
  }, [c.last, c.sc]);
  useEffect(() => { if (!touched) setF(fill); }, [fill, touched]);
  useEffect(() => { setTouched(false); }, [c.sceneId, c.characterId]);
  const edit = (patch: Partial<Draft>) => { setTouched(true); setF((prev) => ({ ...prev, ...patch })); };

  /** A scanned label adds that piece to the take, so what the actor is wearing is recorded by scanning it. */
  const addScanned = async (raw: string) => {
    const number = raw.trim().toUpperCase();
    if (!number) return;
    setScanError(null);
    try {
      const costume = await api<Costume>(p(c.projectId, `/costumes/lookup/${encodeURIComponent(number)}`));
      setAsset("");
      if (navigator.vibrate) navigator.vibrate(60);
      if (f.accessories.some((a) => a.name.toLowerCase() === costume.name.toLowerCase())) { toast.push(`${costume.name} is already on this take`, "ok"); return; }
      edit({ accessories: [...f.accessories, { name: costume.name, present: true }] });
      toast.push(`Added ${costume.assetNumber} · ${costume.name}`, "ok");
    } catch (e) {
      setScanError(e instanceof ApiError ? e.message : "That label could not be found");
    }
  };

  const create = useMutation({
    mutationFn: () => api<ContinuityRecord>(p(c.projectId, "/continuity"), { body: { sceneId: c.sceneId, characterId: c.characterId, changeId: c.sc?.changeId || null, takeNumber: Number(f.takeNumber), notes: f.notes || null, details: Object.fromEntries(f.details.filter((d) => d.k.trim()).map((d) => [d.k.trim(), d.v])), accessories: f.accessories.filter((a) => a.name.trim()) } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["continuity"] });
      qc.invalidateQueries({ queryKey: ["continuity-photos"] });
      qc.invalidateQueries({ queryKey: ["scene", c.sceneId] });
      setTouched(false);
      toast.push("Take recorded — the form is ready for the next one", "ok");
    },
  });

  const onBoard = !!c.scene && dateKey(c.scene.shootDate) === day && c.scene.status !== "OMITTED";
  const detail = !c.sceneId ? null : !c.characterId ? <TagSomeone c={c} /> : !mayRecord ? <Card><Empty icon="🎬" title="You can view the continuity book" hint="Recording takes is for the continuity and costume team." /></Card> : (
        <div className="grid grid-2" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)" }}>
          <Card title={`Record take · ${c.sc?.character.name || ""} · Sc ${c.scene?.number || ""}`}
            actions={<button className="btn btn-primary" disabled={!f.takeNumber || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Saving…" : "Save take"}</button>}>
            <div className="col">
              <Field label="Take number"><Input type="number" min={1} value={f.takeNumber} onChange={(e) => edit({ takeNumber: e.target.value })} style={{ maxWidth: 140 }} /></Field>
              <Field label="Wear details" help={c.last ? `Pre-filled from take ${c.last.takeNumber}` : undefined}>
                <div className="col gap-1">
                  {f.details.map((d, i) => (
                    <div key={i} className="row gap-1">
                      <Input value={d.k} onChange={(e) => edit({ details: f.details.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)) })} placeholder="Sleeves" style={{ maxWidth: 140 }} />
                      <Input value={d.v} onChange={(e) => edit({ details: f.details.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)) })} placeholder="Rolled twice" />
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit({ details: f.details.filter((_, j) => j !== i) })} aria-label="Remove detail"><Trash2 size={14} /></button>
                    </div>
                  ))}
                  <button type="button" className="btn btn-sm" onClick={() => edit({ details: [...f.details, { k: "", v: "" }] })}><Plus size={14} /> Detail</button>
                </div>
              </Field>
              <Field label="Pieces & accessories" help="Scan a label to add the piece the actor is wearing.">
                <div className="col gap-1">
                  {f.accessories.map((a, i) => (
                    <div key={i} className="row gap-1">
                      <label className="check"><input type="checkbox" checked={a.present} onChange={(e) => edit({ accessories: f.accessories.map((x, j) => (j === i ? { ...x, present: e.target.checked } : x)) })} /></label>
                      <Input value={a.name} onChange={(e) => edit({ accessories: f.accessories.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="Watch" />
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit({ accessories: f.accessories.filter((_, j) => j !== i) })} aria-label="Remove accessory"><Trash2 size={14} /></button>
                    </div>
                  ))}
                  <div className="row gap-1">
                    <button type="button" className="btn btn-sm" onClick={() => edit({ accessories: [...f.accessories, { name: "", present: true }] })}><Plus size={14} /> Accessory</button>
                    <button type="button" className="btn btn-sm" onClick={() => setCamera((v) => !v)}>{camera ? <><CameraOff size={14} /> Stop camera</> : <><Camera size={14} /> Scan</>}</button>
                  </div>
                </div>
              </Field>
              <Field label="Notes"><Textarea value={f.notes} onChange={(e) => edit({ notes: e.target.value })} placeholder="Coffee spill at end of take…" /></Field>
            </div>
            <ErrorBox error={create.error} />
          </Card>

          <div className="col gap-2">
            <Card title="Scan a label">
              <QRScanner active={camera} onScan={addScanned} />
              <form className="row gap-1 mt-2" onSubmit={(e) => { e.preventDefault(); addScanned(asset); }}>
                <Keyboard size={18} color="var(--text-3)" />
                <Input value={asset} onChange={(e) => setAsset(e.target.value)} placeholder="CST-000245" className="mono" />
                <button className="btn btn-primary" disabled={!asset}>Add</button>
              </form>
              {scanError && <div className="errorbox mt-2">{scanError}</div>}
              {!camera && <div className="subtle mt-2">Press <b>Scan</b> to use the camera, or type the asset number.</div>}
            </Card>
            <Card title={`Takes so far (${c.records.length})`} pad0>
              {c.isLoading ? <Spinner /> : c.records.length === 0 ? <Empty icon="📖" title="No takes yet" hint="Save take 1 and the next take is pre-filled from it." /> : (
                <div className="list">
                  {[...c.records].reverse().map((r) => (
                    <Link key={r.id} to={`/p/${c.projectId}/continuity/book?tab=shot&day=${dateKey(c.scene?.shootDate) || day}`} className="item link">
                      <span className="bold">Take {r.takeNumber}</span>
                      <span className="grow truncate subtle">{Object.entries(r.details).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"}</span>
                      {c.flags.some((fl) => fl.take === r.takeNumber) && <Badge status="WARNING">flagged</Badge>}
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      );

  return (
    <div>
      <PageHead title="On set" sub="Record what the actor is wearing, take by take."
        actions={<>{mayRecord && <button className="btn" onClick={() => setCallsheetOpen(true)}><ClipboardList size={16} /> Upload callsheet</button>}<Link to={`/p/${c.projectId}/continuity/book`} className="btn">Continuity book →</Link></>} />
      <ScheduleUploadModal open={callsheetOpen} kind="CALLSHEET" onClose={() => setCallsheetOpen(false)} onApplied={(d) => d && setDay(d)} />
      <div className="mb-2" style={{ color: "var(--danger)", fontWeight: 600 }}>Click on scene number to add details on set</div>
      <ShootDay c={c} day={day} onDay={setDay} detail={detail} />
      {!c.sceneId && <Card><Empty icon="🎬" title="Click a scene number above" hint="The take form fills in as soon as you pick the scene and who is in it." /></Card>}
      {/* A scene with no shoot date never appears on a day board, so its form opens on its own. */}
      {c.sceneId && !onBoard && <div className="col gap-2"><SelectedScene c={c} />{detail}</div>}
    </div>
  );
}

/**
 * The printable book for one shooting day: every scene shot that day, each character in it, and every take
 * recorded against them. Hidden on screen, laid out for paper — "Print / PDF" is the export, as on Reports and Sides.
 */
function BookExport({ day, records, scenes, project }: { day: string; records: ContinuityRecord[]; scenes: Scene[]; project: { name?: string; shootingDay?: number } | null }) {
  const dayScenes = scenes.filter((s) => dateKey(s.shootDate) === day && s.status !== "OMITTED");
  const forScene = (sceneId: string) => records.filter((r) => r.sceneId === sceneId);

  return (
    <div className="print-only">
      <div className="book-cover">
        <div className="book-title">Continuity book</div>
        <h1>{project?.name || "Production"}</h1>
        <div className="subtle">{project?.shootingDay ? `Production day ${project.shootingDay} · ` : ""}{fmtDate(day, { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</div>
        <div className="subtle mt-1">{dayScenes.length} scene{dayScenes.length === 1 ? "" : "s"} · {records.filter((r) => dayScenes.some((s) => s.id === r.sceneId)).length} take{records.filter((r) => dayScenes.some((s) => s.id === r.sceneId)).length === 1 ? "" : "s"}</div>
      </div>
      {dayScenes.length === 0 && <div className="subtle">No scenes were scheduled for this day.</div>}
      {dayScenes.map((s) => {
        const rows = forScene(s.id);
        const byCharacter = Array.from(new Set(rows.map((r) => r.characterId)));
        return (
          <section key={s.id} className="book-scene">
            <h2>Scene {s.number}{s.name ? ` · ${s.name}` : ""}</h2>
            <div className="subtle">{[s.intExt, s.location, s.timeOfDay, s.scriptDay, s.pages ? `${s.pages} pgs` : null].filter(Boolean).join(" · ") || "—"}</div>
            {byCharacter.length === 0 && <div className="subtle mt-1">No takes recorded for this scene.</div>}
            {byCharacter.map((cid) => {
              const takes = rows.filter((r) => r.characterId === cid).sort((a, b) => a.takeNumber - b.takeNumber);
              const first = takes[0];
              return (
                <div key={cid} className="book-char">
                  <div className="bold">{first.character?.name || "Character"}{first.character?.actor?.name ? ` — ${first.character.actor.name}` : ""}</div>
                  <div className="subtle">{first.change ? `Change #${first.change.changeNumber} ${first.change.name}` : "No change assigned"}</div>
                  {takes.map((r) => (
                    <div key={r.id} className="book-take">
                      <div className="bold small">Take {r.takeNumber} <span className="subtle">{fmtDateTime(r.createdAt)}{r.recordedByName ? ` · ${r.recordedByName}` : ""}</span></div>
                      <dl className="kv" style={{ gridTemplateColumns: "110px 1fr" }}>
                        {Object.entries(r.details).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v || "—"}</dd></Fragment>)}
                      </dl>
                      {r.accessories.length > 0 && <div className="small">{r.accessories.map((a) => `${a.present ? "\u2713" : "\u2717"} ${a.name}`).join(" · ")}</div>}
                      {r.notes && <div className="small mt-1"><i>{r.notes}</i></div>}
                      {(r.photos || []).filter((ph) => !ph.mediaType || ph.mediaType === "IMAGE").length > 0 && (
                        <div className="book-photos">
                          {(r.photos || []).filter((ph) => !ph.mediaType || ph.mediaType === "IMAGE").map((ph) => <img key={ph.id} src={ph.url} alt={ph.caption || ph.kind} />)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

/**
 * The prep sheet for a day, laid out for paper: every scene, who is in it, the change they wear and
 * anything standing between that change and the floor.
 */
function PrepExport({ day, scenes, project }: { day: string; scenes: Scene[]; project: { name?: string; shootingDay?: number } | null }) {
  const dayScenes = scenes.filter((s) => dateKey(s.shootDate) === day && s.status !== "OMITTED");
  const characters = dayScenes.reduce((n, s) => n + s.characters.length, 0);
  return (
    <div className="print-only">
      <div className="book-cover">
        <div className="book-title">Continuity prep</div>
        <h1>{project?.name || "Production"}</h1>
        <div className="subtle">{project?.shootingDay ? `Production day ${project.shootingDay} · ` : ""}{fmtDate(day, { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</div>
        <div className="subtle mt-1">{dayScenes.length} scene{dayScenes.length === 1 ? "" : "s"} · {characters} character{characters === 1 ? "" : "s"}</div>
      </div>
      {dayScenes.length === 0 && <div className="subtle">Nothing is scheduled for this day.</div>}
      {dayScenes.map((s) => (
        <section key={s.id} className="book-scene">
          <h2>Scene {s.number}{s.name ? ` · ${s.name}` : ""}</h2>
          <div className="subtle">{[s.intExt, s.location, s.timeOfDay, s.scriptDay, s.pages ? `${s.pages} pgs` : null].filter(Boolean).join(" · ") || "—"}</div>
          {s.characters.length === 0 && <div className="subtle mt-1">Nobody is tagged to this scene.</div>}
          {s.characters.map((sc) => {
            const r = characterReadiness(sc);
            return (
              <div key={sc.id} className="book-char">
                <div className="bold">{sc.character.name}{sc.character.actor?.name ? ` — ${sc.character.actor.name}` : ""}</div>
                <div className="subtle">{sc.change ? `Change #${sc.change.changeNumber} ${sc.change.name}` : "No change assigned"}</div>
                {(sc.change?.items || []).length > 0 && <div className="small">{(sc.change?.items || []).map((i) => `${i.costume.name}${i.wearNotes ? ` (${i.wearNotes})` : ""}`).join(" · ")}</div>}
                {sc.change && r.blockers.length > 0 && <div className="small"><b>Not ready:</b> {r.blockers.join(" · ")}</div>}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/**
 * Continuity prep: the day in hand as the book sees it — every scene the schedule put on it, who is in
 * them, the change they wear and what is still standing in the way. Recording happens on the On set page.
 */
function PrepDay({ projectId, scenes, records, day, onDay }: { projectId: string; scenes: Scene[]; records: ContinuityRecord[]; day: string; onDay: (d: string) => void }) {
  const dayScenes = useMemo(() => scenes.filter((s) => dateKey(s.shootDate) === day && s.status !== "OMITTED"), [scenes, day]);
  const rows = dayScenes.flatMap((s) => s.characters.map((sc) => ({ sc, r: characterReadiness(sc) })));
  const notReady = rows.filter((x) => x.r.level !== "READY");
  const locations = Array.from(new Set(dayScenes.map((s) => (s.location || "").trim()).filter(Boolean)));
  const takesOn = (sceneId: string, characterId: string) => records.filter((r) => r.sceneId === sceneId && r.characterId === characterId).length;

  return (
    <Card
      title={<span className="row gap-2">Prep · {fmtDate(day, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</span>}
      actions={<Input type="date" value={day} onChange={(e) => onDay(e.target.value || todayISO())} style={{ width: "auto" }} aria-label="Day to prepare" />}
    >
      {dayScenes.length === 0 ? (
        <Empty icon="📋" title="Nothing scheduled for this day" hint="Upload the schedule or the call sheet and its scenes land here with the date on them." />
      ) : (
        <>
          <div className="row gap-2 wrap mb-2 subtle">
            <span><b>{dayScenes.length}</b> scene{dayScenes.length === 1 ? "" : "s"}</span>
            <span><b>{rows.length}</b> character{rows.length === 1 ? "" : "s"}</span>
            <span><b>{rows.length - notReady.length}</b> ready</span>
            {notReady.length > 0 && <span className="row gap-1" style={{ color: "var(--danger)" }}><AlertTriangle size={14} /> {notReady.length} not ready</span>}
            {locations.length > 0 && <span>{locations.join(" · ")}</span>}
          </div>
          <div className="col gap-2">
            {dayScenes.map((s) => (
              <div key={s.id} className="card flat" style={{ padding: 12 }}>
                <div className="row between wrap gap-2">
                  <Link to={`/p/${projectId}/scenes/${s.id}`} className="bold"><u>Sc {s.number}{s.name ? ` · ${s.name}` : ""}</u></Link>
                  <span className="subtle">{[s.intExt, s.location, s.timeOfDay, s.scriptDay, s.pages ? `${s.pages} pgs` : null].filter(Boolean).join(" · ")}</span>
                </div>
                {s.characters.length === 0 ? <div className="subtle mt-1">Nobody is tagged to this scene yet.</div> : (
                  <div className="col gap-1 mt-2">
                    {s.characters.map((sc) => {
                      const r = characterReadiness(sc);
                      const taken = takesOn(s.id, sc.characterId);
                      return (
                        <div key={sc.id} className="card flat" style={{ padding: 10 }}>
                          <div className="row between wrap gap-2">
                            <span className="row gap-2 wrap">
                              <Dot status={r.level} pulse={r.level === "MISSING"} />
                              <b>{sc.character.name}</b>
                              {sc.character.actor?.name && <span className="subtle">{sc.character.actor.name}</span>}
                              {sc.change
                                ? <Link to={`/p/${projectId}/changes/${sc.change.id}`}><span className="badge tone-info">Change #{sc.change.changeNumber} {sc.change.name}</span></Link>
                                : <span className="badge tone-warn">No change assigned</span>}
                              <span className="subtle">{r.total ? `${r.ready}/${r.total} pieces ready` : ""}</span>
                              {taken > 0 && <Badge status="OK">{taken} take{taken === 1 ? "" : "s"}</Badge>}
                            </span>
                            <Link to={`/p/${projectId}/continuity?sceneId=${s.id}&characterId=${sc.characterId}`} className="btn btn-sm">Record take</Link>
                          </div>
                          {(sc.change?.items || []).length > 0 && (
                            <div className="chips mt-1">
                              {(sc.change?.items || []).map((i) => (
                                <span key={i.id} className="chip" style={{ cursor: "default" }}>
                                  <Dot status={itemLevel(i.costume.status)} /> {i.costume.name}{i.wearNotes ? <span className="subtle"> · {i.wearNotes}</span> : null}
                                </span>
                              ))}
                            </div>
                          )}
                          {sc.change && r.blockers.length > 0 && <div className="mt-1 small" style={{ color: "var(--danger)" }}>{r.blockers.join(" · ")}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * Continuity shot: the days already in the can. The list of days comes from the schedule — every scene
 * shoot date that has passed, plus any day a take was recorded on — and each day opens the takes on it.
 */
function ShotDays({ projectId, records, day, onDay, days }: { projectId: string; records: ContinuityRecord[]; day: string; onDay: (d: string) => void; days: { day: string; scenes: Scene[]; takes: number }[] }) {
  const { can } = useProject();
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (id: string) => api(p(projectId, `/continuity/${id}`), { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["continuity"] }); qc.invalidateQueries({ queryKey: ["continuity-photos"] }); },
  });
  const selected = days.find((d) => d.day === day);
  const forScene = (sceneId: string) => records.filter((r) => r.sceneId === sceneId).sort((a, b) => a.takeNumber - b.takeNumber);

  if (days.length === 0) return <Card><Empty icon="🎞️" title="No shoot days behind us yet" hint="A day lands here once the schedule puts a date on its scenes and that date has passed — takes recorded today show up straight away." /></Card>;

  return (
    <div className="grid grid-split">
      <Card title={`Shoot days (${days.length})`} pad0>
        <div className="list">
          {days.map((d) => (
            <button key={d.day} type="button" className="item link" aria-current={d.day === day ? "true" : undefined} style={{ width: "100%", background: d.day === day ? "var(--surface-2)" : "none", border: "none", borderLeft: `3px solid ${d.day === day ? "var(--ink)" : "transparent"}`, textAlign: "left" }} onClick={() => onDay(d.day)}>
              <div className="grow">
                <div className="title small">{fmtDate(d.day, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</div>
                <div className="meta">{d.scenes.length} scene{d.scenes.length === 1 ? "" : "s"} · {d.takes} take{d.takes === 1 ? "" : "s"}</div>
              </div>
              {d.takes === 0 && <Badge status="MUTED">no takes</Badge>}
            </button>
          ))}
        </div>
      </Card>

      <div className="col gap-2">
        {(selected?.scenes || []).map((s) => {
          const rows = forScene(s.id);
          const characters = Array.from(new Set(rows.map((r) => r.characterId)));
          return (
            <Card key={s.id} title={`Sc ${s.number}${s.name ? ` · ${s.name}` : ""}`} actions={<Link to={`/p/${projectId}/scenes/${s.id}`} className="btn btn-sm">Open scene</Link>}>
              <div className="subtle">{[s.intExt, s.location, s.timeOfDay, s.scriptDay, s.pages ? `${s.pages} pgs` : null].filter(Boolean).join(" · ") || "—"}</div>
              {characters.length === 0 ? (
                <Empty icon="📖" title="No takes recorded" hint="Nothing was logged on set against this scene." />
              ) : characters.map((cid) => {
                const takes = rows.filter((r) => r.characterId === cid);
                const first = takes[0];
                return (
                  <div key={cid} className="mt-2">
                    <div className="row gap-2 wrap">
                      <b>{first.character?.name || "Character"}</b>
                      {first.character?.actor?.name && <span className="subtle">{first.character.actor.name}</span>}
                      {first.change && <Link to={`/p/${projectId}/changes/${first.change.id}`}><span className="badge tone-info">Change #{first.change.changeNumber} {first.change.name}</span></Link>}
                    </div>
                    <div className="grid grid-auto mt-1">
                      {takes.map((r) => (
                        <Card key={r.id} className="flat" title={`Take ${r.takeNumber}`} actions={can(CONTINUITY_ROLES) ? <button className="btn btn-ghost btn-sm" onClick={() => del.mutate(r.id)} title="Delete this take"><Trash2 size={14} /></button> : undefined}>
                          <div className="subtle mb-2">{fmtDateTime(r.createdAt)}{r.recordedByName ? ` · ${r.recordedByName}` : ""}</div>
                          <PhotoGrid photos={r.photos || []} entityType="CONTINUITY" entityId={r.id} kinds={["FRONT", "SIDE", "BACK", "CLOSEUP"]} compact attachments={false} />
                          <dl className="kv mt-2" style={{ gridTemplateColumns: "100px 1fr" }}>
                            {Object.entries(r.details).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v || "—"}</dd></Fragment>)}
                          </dl>
                          {r.accessories.length > 0 && <div className="chips mt-2">{r.accessories.map((a) => <span key={a.name} className={`badge tone-${a.present ? "ok" : "danger"}`}>{a.present ? "✓" : "✗"} {a.name}</span>)}</div>}
                          {r.notes && <div className="notice mt-2">{r.notes}</div>}
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The continuity book: the day being prepared and the days already shot, both driven by the schedule.
 * Print / PDF exports whichever of the two is open, for the day it is showing.
 */
export function ContinuityBook() {
  const { projectId, project } = useProject();
  const { pathname } = useLocation();
  const [sp, setSp] = useSearchParams();
  const asked = sp.get("tab");
  const tab: "prep" | "shot" = asked === "shot" || asked === "prep" ? asked : pathname.endsWith("/shot") ? "shot" : "prep";
  const setTab = (t: "prep" | "shot") => { const n = new URLSearchParams(sp); n.set("tab", t); setSp(n, { replace: true }); };
  const setShotDay = (d: string) => { const n = new URLSearchParams(sp); n.set("day", d); setSp(n, { replace: true }); };
  const [pickedPrepDay, setPrepDay] = useState("");

  const { data: scenes, isLoading: loadingScenes } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });
  const { data: records, isLoading: loadingRecords } = useQuery({ queryKey: ["continuity", projectId, "all"], queryFn: () => api<ContinuityRecord[]>(p(projectId, "/continuity")) });

  /** One entry per shoot day the schedule has put behind us, newest first, with what was shot on it. */
  const days = useMemo(() => {
    const today = todayISO();
    const dayOfScene = new Map((scenes || []).map((s) => [s.id, dateKey(s.shootDate)] as const));
    const takes = new Map<string, number>();
    for (const r of records || []) { const d = dayOfScene.get(r.sceneId); if (d) takes.set(d, (takes.get(d) || 0) + 1); }
    const byDay = new Map<string, { day: string; scenes: Scene[]; takes: number }>();
    for (const s of scenes || []) {
      const d = dayOfScene.get(s.id);
      if (!d || s.status === "OMITTED") continue;
      if (d >= today && !takes.has(d)) continue; // still ahead of us, and nothing shot on it yet
      const e = byDay.get(d) || { day: d, scenes: [], takes: takes.get(d) || 0 };
      e.scenes.push(s);
      byDay.set(d, e);
    }
    return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
  }, [scenes, records]);

  /** Prep opens on today, or — when nothing is scheduled today — on the next day the schedule does hold. */
  const nextPrepDay = useMemo(() => {
    const today = todayISO();
    const dates = (scenes || []).filter((s) => s.status !== "OMITTED").map((s) => dateKey(s.shootDate)).filter(Boolean).sort();
    return dates.includes(today) ? today : dates.find((d) => d > today) || today;
  }, [scenes]);
  const prepDay = pickedPrepDay || nextPrepDay;

  const askedDay = sp.get("day") || "";
  const shotDay = (days.find((d) => d.day === askedDay) || days[0])?.day || askedDay || todayISO();
  const day = tab === "prep" ? prepDay : shotDay;
  const loading = loadingScenes || loadingRecords;

  return (
    <div>
      {tab === "prep"
        ? <PrepExport day={prepDay} scenes={scenes || []} project={project} />
        : <BookExport day={shotDay} records={records || []} scenes={scenes || []} project={project} />}
      <div className="no-print">
        <PageHead title="Continuity book" sub="The day being prepared, and the days already in the can."
          actions={<><button className="btn" onClick={() => window.print()} title={`Print the ${tab === "prep" ? "prep sheet" : "book"} for ${day}`}><Printer size={16} /> Print / PDF</button><Link to={`/p/${projectId}/continuity`} className="btn btn-primary"><Plus size={16} /> Record take</Link></>} />
        <Tabs tabs={[{ key: "prep", label: "Continuity Prep" }, { key: "shot", label: "Continuity Shot" }]} value={tab} onChange={setTab} />
        {loading ? <Spinner /> : tab === "prep"
          ? <PrepDay projectId={projectId} scenes={scenes || []} records={records || []} day={prepDay} onDay={setPrepDay} />
          : <ShotDays projectId={projectId} records={records || []} day={shotDay} onDay={setShotDay} days={days} />}
      </div>
    </div>
  );
}
