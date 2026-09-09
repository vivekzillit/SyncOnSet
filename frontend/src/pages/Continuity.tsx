import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, AlertTriangle, Camera, CameraOff, ClipboardList, Keyboard, Printer } from "lucide-react";
import { api, ApiError, p } from "@/api/client";
import { useProject } from "@/state/project";
import { CONTINUITY_ROLES } from "@/state/auth";
import { dateKey, fmtDate, fmtDateTime, todayISO } from "@/lib/format";
import { characterReadiness } from "@/lib/readiness";
import type { Character, ContinuityRecord, Costume, Scene } from "@/api/types";
import { Badge, Card, Chips, Dot, Empty, ErrorBox, Field, Input, PageHead, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { PhotoGrid, QRScanner } from "@/components/domain";
import { ScheduleUploadModal } from "@/components/ScheduleUpload";

const DEFAULT_DETAILS = ["Shirt", "Sleeves", "Collar", "Trousers", "Hair", "Accessories"];
type Draft = { takeNumber: string; details: { k: string; v: string }[]; accessories: { name: string; present: boolean }[]; notes: string };

/**
 * Scene and character pickers, the change in play, and the takes already recorded: shared by both continuity views.
 * `autoSelect` opens on a sensible scene, which suits the book; on set nothing is chosen until a scene is clicked.
 */
function useContinuity({ autoSelect = true }: { autoSelect?: boolean } = {}) {
  const { projectId } = useProject();
  const [sp, setSp] = useSearchParams();
  const { data: scenes } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });
  const sceneId = sp.get("sceneId") || "";
  const characterId = sp.get("characterId") || "";
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k === "sceneId") n.delete("characterId"); setSp(n, { replace: true }); };
  /** Jump straight to one character in one scene — setting the scene alone would clear the character. */
  const goTo = (scene: string, character: string) => { const n = new URLSearchParams(sp); n.set("sceneId", scene); n.set("characterId", character); setSp(n, { replace: true }); };

  useEffect(() => {
    if (autoSelect && !sceneId && scenes?.length) {
      const today = todayISO();
      const pick = scenes.find((s) => s.status === "SHOOTING") || scenes.find((s) => dateKey(s.shootDate) === today) || scenes[0];
      set("sceneId", pick.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, sceneId]);

  const { data: scene } = useQuery({ queryKey: ["scene", sceneId], queryFn: () => api<Scene>(p(projectId, `/scenes/${sceneId}`)), enabled: !!sceneId });
  useEffect(() => {
    if (autoSelect && scene && !characterId && scene.characters.length) set("characterId", scene.characters[0].characterId);
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

function Pickers({ c }: { c: ReturnType<typeof useContinuity> }) {
  const { projectId } = useProject();
  const base = `/p/${projectId}`;
  return (
    <>
      <div className="filters">
        <Select value={c.sceneId} onChange={(e) => c.set("sceneId", e.target.value)} options={(c.scenes || []).map((s) => ({ value: s.id, label: `Sc ${s.number}${s.name ? ` · ${s.name}` : ""}` }))} placeholder="Select scene" style={{ minWidth: 240 }} />
        {c.scene && <Chips options={c.scene.characters.map((x) => ({ key: x.characterId, label: x.character.name }))} value={c.characterId} onChange={(v) => c.set("characterId", v)} />}
      </div>
      {c.scene && c.sc && (
        <div className="notice info mb-2">
          <b>{c.sc.character.name}</b> in Sc {c.scene.number}: {c.sc.change ? <Link to={`${base}/changes/${c.sc.change.id}`}><u>Change #{c.sc.change.changeNumber} {c.sc.change.name}</u></Link> : "no change assigned"}
          {c.sc.change?.items?.length ? <> — {c.sc.change.items.map((i) => `${i.costume.name}${i.wearNotes ? ` (${i.wearNotes})` : ""}`).join(", ")}</> : null}
        </div>
      )}
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

/** On Set: the record-take form itself, ready to fill, with the QR scanner to hand. */
export default function ContinuityOnSet() {
  const c = useContinuity({ autoSelect: false });
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
                    <Link key={r.id} to={`/p/${c.projectId}/continuity/book?sceneId=${c.sceneId}&characterId=${c.characterId}`} className="item link">
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

/** Book: every take recorded for this scene and character, with photos and flags. */
export function ContinuityBook() {
  const c = useContinuity();
  const { can } = useProject();
  const qc = useQueryClient();
  const [day, setDay] = useState(todayISO());
  const { project } = useProject();
  // The export covers the whole day, not just the pair on screen, so it fetches the project's records once.
  const { data: dayRecords } = useQuery({ queryKey: ["continuity", c.projectId, "all"], queryFn: () => api<ContinuityRecord[]>(p(c.projectId, "/continuity")) });
  const { data: photosAll } = useQuery({ queryKey: ["continuity-photos", c.projectId, c.sceneId, c.characterId], queryFn: () => api<ContinuityRecord[]>(p(c.projectId, `/continuity?sceneId=${c.sceneId}&characterId=${c.characterId}`)), enabled: !!c.sceneId && !!c.characterId });
  const photosByRecord = useMemo(() => new Map((photosAll || []).map((r) => [r.id, r.photos || []])), [photosAll]);
  const del = useMutation({ mutationFn: (id: string) => api(p(c.projectId, `/continuity/${id}`), { method: "DELETE" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["continuity"] }); qc.invalidateQueries({ queryKey: ["continuity-photos"] }); } });

  return (
    <div>
      <BookExport day={day} records={dayRecords || []} scenes={c.scenes || []} project={project} />
      <div className="no-print">
      <PageHead title="Continuity book" sub="Per scene, per character, per take: what they wore and how."
        actions={<><button className="btn" onClick={() => window.print()} title={`Print the book for ${day}`}><Printer size={16} /> Print / PDF</button><Link to={`/p/${c.projectId}/continuity`} className="btn btn-primary"><Plus size={16} /> Record take</Link></>} />
      <ShootDay c={c} day={day} onDay={setDay} />
      <Pickers c={c} />
      {!c.sceneId || !c.characterId ? <Empty icon="📖" title="Pick a scene and character" /> : c.isLoading ? <Spinner /> : c.records.length === 0 ? <Card><Empty icon="📖" title="No takes recorded yet" hint="Record take 1 on the On set tab; later takes are pre-filled and compared automatically." /></Card> : (
        <div className="grid grid-auto">
          {c.records.map((r) => (
            <Card key={r.id} title={`Take ${r.takeNumber}`} actions={<div className="row gap-1">{c.flags.some((fl) => fl.take === r.takeNumber) && <Badge status="WARNING">flagged</Badge>}{can(CONTINUITY_ROLES) && <button className="btn btn-ghost btn-sm" onClick={() => del.mutate(r.id)} title="Delete"><Trash2 size={14} /></button>}</div>}>
              <div className="subtle mb-2">{fmtDateTime(r.createdAt)}{r.recordedByName ? ` · ${r.recordedByName}` : ""}</div>
              <PhotoGrid photos={photosByRecord.get(r.id) || []} entityType="CONTINUITY" entityId={r.id} kinds={["FRONT", "SIDE", "BACK", "CLOSEUP"]} compact attachments={false} />
              <dl className="kv mt-2" style={{ gridTemplateColumns: "100px 1fr" }}>
                {Object.entries(r.details).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v || "—"}</dd></Fragment>)}
              </dl>
              {r.accessories.length > 0 && <div className="chips mt-2">{r.accessories.map((a) => <span key={a.name} className={`badge tone-${a.present ? "ok" : "danger"}`}>{a.present ? "✓" : "✗"} {a.name}</span>)}</div>}
              {r.notes && <div className="notice mt-2">{r.notes}</div>}
            </Card>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
