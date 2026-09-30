import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, FileUp, CalendarDays, ChevronsDownUp, ChevronsUpDown, Eye, Pencil } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, MANAGER_ROLES } from "@/state/auth";
import { dateKey, fmtDate, hasEpisodes, humanize, todayISO } from "@/lib/format";
import type { Character, Scene, SceneCharacter } from "@/api/types";
import { Badge, Card, Chips, ConfirmButton, Dot, Empty, PageHead, SearchBox, Select, Spinner, confirmAction, discardIfDirty, useToast, useUnsavedGuard } from "@/components/ui";
import { ScriptUploadModal } from "@/components/ScriptUpload";
import { ScheduleUploadModal, type DocKind } from "@/components/ScheduleUpload";
import { DocumentViewer, useDocuments, type DocumentKind } from "@/components/DocumentViewer";
import { PrincipalsModal, sortByCast } from "@/components/PrincipalsModal";
import { BreakdownRowModal, readinessOf, type BreakdownTarget } from "@/components/BreakdownRowModal";
import { EditRow, LOCATION_LIST_ID, NEW, PersistError, castMembers, castNumbers, changesOf, characterNames, characterNamesOf, emptyDraft, persistDraft, planSaveOrder, scriptLoc, toDraft, truncate, type Draft } from "@/components/SceneEditRow";

const SHOOT_DATE = { day: "2-digit", month: "short", year: "numeric" } as const;
type View = "breakdown" | "scenes";
/** A breakdown row: one character as they appear in one scene (a scene nobody is in yet gets a single empty row). */
type BreakdownLine = { scene: Scene; sc: SceneCharacter | null };
type SaveAllResult = { ok: string[]; failed: { key: string; number: string; message: string; createdId?: string }[] };

/**
 * Scenes and the breakdown are one page: the same header, filters and editing, read either one row per
 * scene ("scenes", collapsed) or one row per character in each scene ("breakdown"). The view lives in the
 * query string, so switching keeps every filter and in-progress edit and never counts as leaving the page.
 */
export default function Scenes({ initialView = "scenes" }: { initialView?: View }) {
  const { projectId, can, project } = useProject();
  const { meta } = useAuth();
  const episodes = hasEpisodes(project?.type);
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = can(MANAGER_ROLES);

  const [when, setWhen] = useState<"today" | "upcoming" | "scheduled" | "all" | "">("all");
  const [rev, setRev] = useState("");
  const [ep, setEp] = useState("");
  const [q, setQ] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "scenes" ? "scenes" : params.get("view") === "breakdown" ? "breakdown" : initialView;
  const [rowModal, setRowModal] = useState<{ open: boolean; target: BreakdownTarget }>({ open: false, target: null });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [editAll, setEditAll] = useState(false);
  const [principalsFor, setPrincipalsFor] = useState<string | null>(null);
  // "Edit single" mode: pick one row, then act on it from the toolbar (null = mode off, "" = on but nothing picked yet).
  const [single, setSingle] = useState<string | null>(null);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [docOpen, setDocOpen] = useState<DocKind | null>(null);
  const [viewDoc, setViewDoc] = useState<DocumentKind | null>(null);
  const { data: scriptDocs } = useDocuments("SCRIPT");
  const { data: scheduleDocs } = useDocuments("SCHEDULE");

  const { data, isLoading } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });
  const { data: characters } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")) });
  const charById = useMemo(() => new Map((characters || []).map((c) => [c.id, c])), [characters]);
  const sceneById = useMemo(() => new Map((data || []).map((s) => [s.id, s])), [data]);
  const locations = useMemo(() => Array.from(new Set((data || []).map((s) => (s.location || "").trim()).filter(Boolean))).sort(), [data]);
  const revisions = useMemo(() => Array.from(new Set((data || []).map((s) => s.revision || "").filter(Boolean))).sort(), [data]);
  const episodeList = useMemo(() => Array.from(new Set((data || []).map((s) => (s.episode || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [data]);
  const latestRevision = useMemo(() => (data || []).filter((s) => s.revision).sort((a, b) => (b.revisedAt || "").localeCompare(a.revisedAt || ""))[0]?.revision || "", [data]);

  const today = todayISO();
  const list = useMemo(() => {
    // A row being edited stays visible whatever the filters say, so an edit can never be hidden (and silently lost) by a filter change.
    const pinned = (s: Scene) => !!drafts[s.id];
    let items = data || [];
    if (rev) items = items.filter((s) => pinned(s) || (s.revision || "") === rev);
    if (ep) items = items.filter((s) => pinned(s) || (s.episode || "").trim() === ep);
    if (when === "today") items = items.filter((s) => pinned(s) || dateKey(s.shootDate) === today);
    if (when === "upcoming") items = items.filter((s) => pinned(s) || (s.shootDate && dateKey(s.shootDate) >= today));
    // "Scheduled" means the scene has a shoot date at all, past or future — the same rule the Breakdown page uses.
    if (when === "scheduled") items = items.filter((s) => pinned(s) || !!s.shootDate);
    if (characterId) items = items.filter((s) => pinned(s) || s.characters.some((c) => c.characterId === characterId));
    const needle = q.trim().toLowerCase();
    if (needle) items = items.filter((s) => pinned(s) || [s.number, s.episode, s.name, s.location, s.synopsis, s.scriptDay, s.intExt, ...s.characters.flatMap((c) => [c.character.name, String(c.character.castNumber ?? charById.get(c.characterId)?.castNumber ?? ""), charById.get(c.characterId)?.actor?.name, c.change?.name])].some((v) => (v || "").toLowerCase().includes(needle)));
    return items;
  }, [data, drafts, rev, ep, when, q, today, charById, characterId]);

  /** The breakdown view: each listed scene opened out into its characters, in cast order (only the filtered one when a character is picked). */
  const lines = useMemo<BreakdownLine[]>(() => list.flatMap((scene): BreakdownLine[] => {
    const cast = sortByCast(scene.characters.map((sc) => ({ ...sc, name: sc.character.name, castNumber: sc.character.castNumber ?? charById.get(sc.characterId)?.castNumber ?? null })))
      .filter((sc) => !characterId || sc.characterId === characterId);
    return cast.length ? cast.map((sc) => ({ scene, sc })) : [{ scene, sc: null }];
  }), [list, charById, characterId]);
  const linesByScene = useMemo(() => { const m = new Map<string, BreakdownLine[]>(); for (const l of lines) m.set(l.scene.id, [...(m.get(l.scene.id) || []), l]); return m; }, [lines]);
  /** Every character that is in at least one scene, for the character filter. */
  const castOptions = useMemo(() => {
    const byId = new Map<string, { value: string; label: string }>();
    for (const s of data || []) for (const c of s.characters) if (!byId.has(c.characterId)) byId.set(c.characterId, { value: c.characterId, label: c.character.name });
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);

  // Every draft (the add row first, then edited rows in table order); drafts of scenes deleted elsewhere drop out.
  const draftKeys = useMemo(() => [...(drafts[NEW] ? [NEW] : []), ...list.filter((s) => drafts[s.id]).map((s) => s.id)], [drafts, list]);
  // Pre-validation: a scene number is required and must be unique (against other drafts and against scenes not being edited).
  const problems = useMemo(() => {
    const taken = new Set((data || []).filter((s) => !drafts[s.id]).map((s) => s.number));
    const seen = new Set<string>();
    const out: Record<string, string> = {};
    for (const key of draftKeys) {
      const n = drafts[key].number.trim();
      if (!n) { out[key] = "Scene # is required"; continue; }
      if (taken.has(n) || seen.has(n)) out[key] = `Scene # ${n} is already used`;
      seen.add(n);
    }
    return out;
  }, [data, drafts, draftKeys]);
  const firstProblem = Object.values(problems)[0];

  /** Refresh the list (+ character scene counts) and, for the given scene ids, the detail page queries. */
  const invalidate = (...ids: string[]) => Promise.all([
    qc.invalidateQueries({ queryKey: ["scenes", projectId] }),
    qc.invalidateQueries({ queryKey: ["characters", projectId] }),
    ...ids.flatMap((id) => [qc.invalidateQueries({ queryKey: ["scene", id] }), qc.invalidateQueries({ queryKey: ["readiness", id] })]),
  ]);
  const fail = (e: Error) => toast.push(e.message || "Something went wrong", "danger");
  /** The characters a draft row holds, in cast order — the cast number and actor cells edit these directly. */
  const peopleIn = (d: Draft) => sortByCast(d.principals.map((id) => charById.get(id)).filter((c): c is Character => !!c));
  const setDraft = (key: string, d: Draft) => setDrafts((all) => ({ ...all, [key]: d }));
  const dropDraft = (key: string) => setDrafts((all) => { const n = { ...all }; delete n[key]; return n; });
  /** A new-row save that created the scene but failed afterwards: keep the draft under the new id so a retry updates instead of re-creating. */
  const rekeyCreated = (all: Record<string, Draft>, key: string, createdId?: string) => { if (key !== NEW || !createdId || !all[NEW]) return all; const n = { ...all, [createdId]: all[NEW] }; delete n[NEW]; return n; };

  const saveOne = useMutation({
    mutationFn: (key: string) => persistDraft(projectId, key === NEW ? null : key, drafts[key], sceneById.get(key), rev),
    // Refetch before dropping the draft so the row never flashes the pre-edit values.
    onSuccess: async (id, key) => { await invalidate(id); dropDraft(key); toast.push(key === NEW ? "Scene added" : "Scene saved", "ok"); },
    onError: async (e: Error, key) => { const createdId = e instanceof PersistError ? e.createdId : undefined; if (createdId) { await invalidate(createdId); setDrafts((all) => rekeyCreated(all, key, createdId)); } fail(e); },
  });
  const saveAll = useMutation({
    mutationFn: async (): Promise<SaveAllResult> => {
      const r: SaveAllResult = { ok: [], failed: [] };
      // Dependency-ordered so renumbering (5→6 while 6→7, or a 5↔6 swap) never hits the unique scene-number constraint.
      for (const step of planSaveOrder(draftKeys, drafts, sceneById)) {
        const d = drafts[step.key];
        if (r.failed.some((f) => f.key === step.key)) continue;
        try {
          if (step.tempNumber) await api(p(projectId, `/scenes/${step.key}`), { method: "PATCH", body: { number: step.tempNumber } });
          else { await persistDraft(projectId, step.key === NEW ? null : step.key, d, sceneById.get(step.key), rev); r.ok.push(step.key); }
        } catch (e) { r.failed.push({ key: step.key, number: d.number.trim() || "(blank)", message: (e as Error).message || "Something went wrong", createdId: e instanceof PersistError ? e.createdId : undefined }); }
      }
      return r;
    },
    onSuccess: async ({ ok, failed }) => {
      await invalidate(...ok.filter((k) => k !== NEW), ...failed.map((f) => f.createdId || f.key).filter((k) => k !== NEW));
      // Keep only the rows that failed (re-keyed if the scene was created), so the user sees exactly what still needs saving.
      setDrafts((all) => Object.fromEntries(failed.map((f) => [f.key === NEW && f.createdId ? f.createdId : f.key, all[f.key]])));
      if (failed.length === 0) { setEditAll(false); toast.push(`${ok.length} scene${ok.length === 1 ? "" : "s"} saved`, "ok"); }
      else toast.push(`Saved ${ok.length}, could not save scene ${failed.map((f) => f.number).join(", ")}: ${failed[0].message}`, "danger");
    },
    onError: (e: Error) => { invalidate(); fail(e); },
  });
  const dropLine = useMutation({
    mutationFn: (v: { sceneId: string; characterId: string }) => api(p(projectId, `/scenes/${v.sceneId}/characters/${v.characterId}`), { method: "DELETE" }),
    onSuccess: (_r, v) => { invalidate(v.sceneId); toast.push("Removed from the scene", "ok"); },
    onError: fail,
  });
  const del = useMutation({ mutationFn: (id: string) => api(p(projectId, `/scenes/${id}`), { method: "DELETE" }), onSuccess: () => { qc.invalidateQueries(); toast.push("Scene deleted", "ok"); }, onError: fail });

  const startEdit = (s: Scene) => setDraft(s.id, toDraft(s));
  // Rows already being edited keep their in-progress values; only untouched rows get a fresh snapshot.
  const startEditAll = () => { setDrafts((all) => ({ ...Object.fromEntries(list.map((s) => [s.id, toDraft(s)])), ...all })); setEditAll(true); };
  /** A draft only counts as unsaved once it differs from the scene it was opened on (or from a blank row). */
  const changed = (key: string) => {
    const d = drafts[key];
    if (!d) return false;
    const scene = key === NEW ? undefined : sceneById.get(key);
    const base = key === NEW ? emptyDraft() : scene ? toDraft(scene) : null;
    return !base || JSON.stringify(d) !== JSON.stringify(base);
  };
  const cancelOne = async (key: string) => { if (await discardIfDirty(changed(key))) dropDraft(key); };
  const cancelAll = async () => {
    const edited = Object.keys(drafts).filter(changed).length;
    const ok = await confirmAction(edited
      ? { title: "Discard changes?", message: `You have unsaved changes in ${edited} scene${edited === 1 ? "" : "s"}. Cancel and lose them?`, confirm: "Discard", cancel: "Keep editing", danger: true }
      : { title: "Stop editing?", message: "Nothing has been changed. Leave Edit All?", confirm: "Stop editing", cancel: "Keep editing" });
    if (ok) { setDrafts({}); setEditAll(false); }
  };
  useUnsavedGuard(Object.keys(drafts).some(changed));
  const busy = saveOne.isPending || saveAll.isPending;
  const principalsDraft = principalsFor ? drafts[principalsFor] : undefined;
  const picking = single !== null;
  const picked = single ? sceneById.get(single) : undefined;
  const endSingle = () => setSingle(null);
  const lineKey = (l: BreakdownLine) => l.sc ? l.sc.id : `scene:${l.scene.id}`;
  const setView = (v: View) => { setSingle(null); setParams((prev) => { const n = new URLSearchParams(prev); n.set("view", v); return n; }, { replace: true }); };
  // The row being edited lives in the address too (?row=<scene>.<character>), so opening the character's page from it
  // and coming Back lands on the same edit form rather than a closed one.
  const rowParam = params.get("row");
  const setRowParam = (v: string | null) => setParams((prev) => { const n = new URLSearchParams(prev); if (v) n.set("row", v); else n.delete("row"); return n; }, { replace: true });
  const openLine = (target: BreakdownTarget) => { setRowModal({ open: true, target }); if (target) setRowParam(`${target.sceneId}.${target.characterId}`); };
  const closeLine = () => { setRowModal((m) => ({ ...m, open: false })); if (rowParam) setRowParam(null); };
  useEffect(() => {
    if (!rowParam || rowModal.open || !data) return;
    const [sceneId, characterId] = rowParam.split(".");
    const sc = data.find((x) => x.id === sceneId)?.characters.find((c) => c.characterId === characterId);
    if (!sc) { setRowParam(null); return; } // the row has gone (removed elsewhere): nothing to reopen
    setRowModal({ open: true, target: { sceneId, characterId, changeId: sc.change?.id || "" } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowParam, data]);
  const addRow = () => setDraft(NEW, emptyDraft());

  const emptyTitle = when === "today" ? "No scenes scheduled today" : when === "upcoming" ? "No upcoming scenes" : q || rev ? "No scenes match" : "No scenes yet";
  const emptyHint = when === "today" ? "Once a schedule and callsheet is uploaded it will appear here." : when === "upcoming" ? "Once a schedule is uploaded it will appear here." : "Upload the script to build the breakdown automatically, or add scenes one by one.";
  const draftCount = `${revisions.length} draft${revisions.length === 1 ? "" : "s"}`;
  // The header reads like the reference: the selected draft, or the only draft when there is just one.
  const draftTitle = rev || (revisions.length === 1 ? revisions[0] : revisions.length ? "All drafts" : "Scenes");

  return (
    <div>
      <PageHead
        title={draftTitle}
        sub={revisions.length ? (rev ? `Script draft · ${draftCount}` : `${draftCount} · latest ${latestRevision}`) : view === "breakdown" ? "Every scene against the characters in it, with the look each one wears." : "Script breakdown & costume readiness per scene"}
        actions={(revisions.length > 0 || (canEdit && !editAll && !picking)) && (
          <>
            {revisions.length > 0 && <Select value={rev} onChange={(e) => setRev(e.target.value)} options={revisions} placeholder="All drafts" humanizeLabels={false} title="Script draft / revision" aria-label="Script draft" style={{ width: "auto", minWidth: 140 }} />}
            {/* Editing (all or a single scene) keeps the bar to the job in hand: no uploads or date filters until it is put down. */}
            {canEdit && !editAll && !picking && <>
              {view === "breakdown"
                ? <button className="btn" onClick={() => setView("scenes")} title="One row per scene"><ChevronsDownUp size={16} /> Collapse Scene Number</button>
                : <button className="btn" onClick={() => setView("breakdown")} title="One row per character in each scene"><ChevronsUpDown size={16} /> Expand Scene Number</button>}
              {/* Once a script / schedule has been applied its file is kept, so it can be opened beside the scenes it produced. */}
              <div className="col" style={{ gap: 2 }}>
                <button className="btn btn-accent" onClick={() => setScriptOpen(true)}><FileUp size={16} /> Upload script</button>
                {scriptDocs?.length ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setViewDoc("SCRIPT")}><Eye size={14} /> View uploaded script</button> : null}
              </div>
              <div className="col" style={{ gap: 2 }}>
                <button className="btn" onClick={() => setDocOpen("SCHEDULE")}><CalendarDays size={16} /> Upload schedule</button>
                <span className="tiny" style={{ color: "var(--danger)" }}>Upload schedule to add characters and shoot date</span>
                {scheduleDocs?.length ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setViewDoc("SCHEDULE")}><Eye size={14} /> View uploaded schedule</button> : null}
              </div>
              <button className="btn" onClick={() => openLine(null)}><Plus size={16} /> Add to breakdown</button>
            </>}
          </>
        )}
      />

      <div className="filters">
        <SearchBox value={q} onChange={setQ} placeholder="Search scene, location, description, character…" />
        {episodes && episodeList.length > 0 && <Select value={ep} onChange={(e) => setEp(e.target.value)} options={episodeList.map((n) => ({ value: n, label: `Episode ${n}` }))} placeholder="All episodes" humanizeLabels={false} aria-label="Episode" style={{ width: "auto", minWidth: 150 }} />}
        {castOptions.length > 0 && <Select value={characterId} onChange={(e) => setCharacterId(e.target.value)} options={castOptions} placeholder="All characters" humanizeLabels={false} aria-label="Character" style={{ width: "auto", minWidth: 160 }} />}
        {!editAll && !picking && <Chips options={[{ key: "today", label: "Today" }, { key: "upcoming", label: "Upcoming" }, { key: "scheduled", label: "Scheduled" }, { key: "all", label: "All scenes" }]} value={when} onChange={(v) => setWhen((v || "all") as "today" | "upcoming" | "scheduled" | "all")} />}
        {canEdit && (
          <div className="row gap-1" style={{ marginLeft: "auto" }}>
            {editAll ? (
              <><button className="btn btn-blue" disabled={busy || draftKeys.length === 0 || !!firstProblem} title={firstProblem} onClick={() => saveAll.mutate()}>{saveAll.isPending ? "Saving…" : `Save all (${draftKeys.length})`}</button><button className="btn" disabled={busy} onClick={cancelAll}>Cancel</button></>
            ) : picking ? (
              <>
                {picked ? <>
                  <span className="small subtle nowrap">Scene {picked.number}</span>
                  <button className="btn btn-blue" onClick={() => { startEdit(picked); endSingle(); }}>Edit</button>
                  {/* Keyed by scene so an armed Delete confirmation never carries over to another row. */}
                  <ConfirmButton key={`del-${picked.id}`} confirmText="Delete scene?" onConfirm={() => { del.mutate(picked.id); endSingle(); }}>Delete</ConfirmButton>
                </> : <span className="small subtle nowrap">Select a scene</span>}
                <button className="btn" onClick={endSingle}>Cancel</button>
              </>
            ) : (
              <>
                {/* The expanded view is one row per character, edited row by row with its pencil, so Edit All lives only in the collapsed view. */}
                {view === "scenes" && <button className="btn" disabled={list.length === 0 || busy} onClick={startEditAll}>Edit All</button>}
                {/* Breakdown rows carry their own edit / remove buttons, so picking a row is only needed for scenes. */}
                {view === "scenes" && <button className="btn" disabled={list.length === 0 || busy} onClick={() => setSingle("")}>Edit Single</button>}
                <button className="btn btn-blue" disabled={!!drafts[NEW] || busy} onClick={addRow}><Plus size={16} /> Add</button>
              </>
            )}
          </div>
        )}
      </div>

      <datalist id={LOCATION_LIST_ID}>{locations.map((l) => <option key={l} value={l} />)}</datalist>

      <Card pad0>
        {isLoading ? <Spinner /> : list.length === 0 && !drafts[NEW] ? (
          <Empty icon="🎬" title={emptyTitle} hint={emptyHint} action={canEdit && when === "all" && !q && !rev ? <button className="btn btn-blue" onClick={addRow}><Plus size={16} /> Add scene</button> : undefined} />
        ) : (
          <div className="table-wrap table-scroll">
            <table className="table">
              <thead><tr>{view === "breakdown" && <th style={{ width: 84 }}><span className="sr-only">Actions</span></th>}<th style={{ width: 28 }}><span className="sr-only">Readiness</span></th>{episodes && <th>Ep</th>}<th>Scene #</th><th>Script Day</th><th>Script Loc.</th><th>Scene Description</th><th>Character Name</th><th>Cast number</th><th>Cast Name</th><th>Change</th><th>Shoot Date</th><th style={{ width: 48 }}><span className="sr-only">{view === "breakdown" ? "Select" : "Actions"}</span></th></tr></thead>
              <tbody>
                {drafts[NEW] && <EditRow episodes={episodes} d={drafts[NEW]} onChange={(d) => setDraft(NEW, d)} meta={meta} isNew principals={characterNamesOf(drafts[NEW].principals, charById)} people={peopleIn(drafts[NEW])} split={view === "breakdown"} onPrincipals={() => setPrincipalsFor(NEW)} onSave={editAll ? undefined : () => saveOne.mutate(NEW)} onCancel={editAll ? undefined : () => cancelOne(NEW)} busy={busy && (saveAll.isPending || saveOne.variables === NEW)} error={problems[NEW]} />}
                {list.map((s) => {
                  const d = drafts[s.id];
                  // A scene being edited is one editor row in either view: the scene fields belong to the scene, not to each character.
                  if (d) return <EditRow episodes={episodes} key={s.id} d={d} onChange={(nd) => setDraft(s.id, nd)} meta={meta} principals={characterNamesOf(d.principals, charById)} people={peopleIn(d)} changes={changesOf(s.characters, charById)} split={view === "breakdown"} changeOf={(cid) => { const ch = s.characters.find((c) => c.characterId === cid)?.change; return ch ? `#${ch.changeNumber} ${ch.name}` : ""; }} onPrincipals={() => setPrincipalsFor(s.id)} onSave={editAll ? undefined : () => saveOne.mutate(s.id)} onCancel={editAll ? undefined : () => cancelOne(s.id)} busy={busy && (saveAll.isPending || saveOne.variables === s.id)} error={problems[s.id]} />;
                  const sceneCells = (
                    <>
                      {episodes && <td className="nowrap">{s.episode || ""}</td>}
                      <td className="nowrap"><Link to={`/p/${projectId}/scenes/${s.id}`} className="bold" title={s.name || `Scene ${s.number}`}>{s.number}</Link>{s.status !== "PLANNED" && <span className="hide-mobile" style={{ marginLeft: 8 }}><Badge status={s.status} /></span>}</td>
                      {/* Day or Night only — the story day ("Day 3") is still edited here and shown on scene detail. */}
                      <td className="nowrap">{humanize(s.timeOfDay) || ""}</td>
                      <td className="nowrap">{scriptLoc(s)}</td>
                      <td title={s.synopsis || undefined}><div className="truncate" style={{ maxWidth: 340 }}>{truncate(s.synopsis)}</div></td>
                    </>
                  );
                  const shootCell = <td className="nowrap">{s.shootDate ? fmtDate(s.shootDate, SHOOT_DATE) : ""}</td>;
                  const pickCell = (key: string, label: string) => <td className="right">{picking && <input type="radio" name="scene-pick" aria-label={`Select ${label}`} checked={single === key} onChange={() => setSingle(key)} />}</td>;
                  const rowProps = (key: string) => ({ className: picking ? `row-pick${single === key ? " is-picked" : ""}` : undefined, style: s.status === "OMITTED" ? { opacity: 0.55 } : undefined, onClick: picking ? () => setSingle(key) : undefined });

                  if (view === "breakdown") {
                    return (linesByScene.get(s.id) || []).map((l) => {
                      const key = lineKey(l);
                      if (!l.sc) {
                        return (
                          <tr key={key} {...rowProps(key)}>
                            <td />
                            <td><span title="Nobody in this scene yet" aria-label="Nobody in this scene yet" role="img"><Dot status="NOT_ASSIGNED" /></span></td>
                            {sceneCells}
                            <td className="subtle">Nobody yet</td><td className="subtle">—</td><td className="subtle">—</td><td className="subtle">—</td>
                            {shootCell}
                            {pickCell(key, `scene ${s.number}`)}
                          </tr>
                        );
                      }
                      const sc = l.sc;
                      const full = charById.get(sc.characterId);
                      const readiness = readinessOf(sc);
                      return (
                        <tr key={key} {...rowProps(key)}>
                          {/* A wide table scrolls; the row's own buttons stay at the edge you start from. */}
                          <td className="nowrap">
                            {canEdit && <>
                              <button className="btn btn-ghost btn-sm" aria-label={`Edit ${sc.character.name} in scene ${s.number}`} onClick={() => openLine({ sceneId: s.id, characterId: sc.characterId, changeId: sc.change?.id || "" })}><Pencil size={14} /></button>
                              <ConfirmButton className="btn btn-ghost btn-sm" confirmText="Remove?" aria-label={`Remove ${sc.character.name} from scene ${s.number}`} onConfirm={() => dropLine.mutate({ sceneId: s.id, characterId: sc.characterId })}>&times;</ConfirmButton>
                            </>}
                          </td>
                          <td><span title={humanize(readiness)} aria-label={humanize(readiness)} role="img"><Dot status={readiness} pulse={readiness === "MISSING"} /></span></td>
                          {sceneCells}
                          <td className="nowrap">{sc.character.name}</td>
                          <td className="subtle mono nowrap">{sc.character.castNumber ?? full?.castNumber ?? "—"}</td>
                          <td className="subtle nowrap">{full?.actor?.name || "—"}</td>
                          <td className="nowrap">{sc.change ? `#${sc.change.changeNumber} ${sc.change.name}` : <span className="subtle">No change assigned</span>}</td>
                          {shootCell}
                          {pickCell(key, `${sc.character.name} in scene ${s.number}`)}
                        </tr>
                      );
                    });
                  }

                  const names = characterNames(s.characters, charById);
                  const numbers = castNumbers(s.characters, charById);
                  const cast = castMembers(s.characters, charById);
                  const worn = changesOf(s.characters, charById);
                  const readiness = humanize(s.readiness);
                  return (
                    <tr key={s.id} {...rowProps(s.id)}>
                      <td><span title={readiness} aria-label={readiness} role="img"><Dot status={s.readiness} pulse={s.readiness === "MISSING"} /></span></td>
                      {sceneCells}
                      <td title={names.title || undefined}>{names.text}</td>
                      <td className="subtle mono nowrap" title={numbers.title || undefined}>{numbers.text || "—"}</td>
                      <td className="subtle" title={cast.title || undefined}>{cast.text || "—"}</td>
                      <td className="subtle nowrap" title={worn.title || undefined}>{worn.text || "—"}</td>
                      {shootCell}
                      {pickCell(s.id, `scene ${s.number}`)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <BreakdownRowModal open={rowModal.open} target={rowModal.target} onClose={closeLine} scenes={data || []} characters={characters || []} episodes={episodes} />
      <PrincipalsModal open={!!principalsDraft} onClose={() => setPrincipalsFor(null)} characters={characters || []} value={principalsDraft?.principals || []} onChange={(ids) => principalsFor && drafts[principalsFor] && setDraft(principalsFor, { ...drafts[principalsFor], principals: ids })} />

      <ScriptUploadModal open={scriptOpen} onClose={() => setScriptOpen(false)} onImported={() => { setWhen("all"); setRev(""); }} />
      <DocumentViewer open={!!viewDoc} kind={viewDoc || "SCRIPT"} onClose={() => setViewDoc(null)} scenes={data || []} />
      <ScheduleUploadModal open={!!docOpen} kind={docOpen || "SCHEDULE"} onClose={() => setDocOpen(null)} onApplied={() => { setWhen(docOpen === "CALLSHEET" ? "today" : "upcoming"); setRev(""); }} />
    </div>
  );
}
