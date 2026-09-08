import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload, FileUp, CalendarDays, ClipboardList, MoreVertical, MoreHorizontal } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, MANAGER_ROLES } from "@/state/auth";
import { dateKey, fmtDate, humanize, todayISO } from "@/lib/format";
import type { Character, Scene } from "@/api/types";
import { Badge, Card, Chips, ConfirmButton, Dot, Empty, ErrorBox, Modal, PageHead, SearchBox, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { ScriptUploadModal } from "@/components/ScriptUpload";
import { ScheduleUploadModal, type DocKind } from "@/components/ScheduleUpload";
import { PrincipalsModal } from "@/components/PrincipalsModal";
import { FixedMenu } from "@/components/FixedMenu";
import { EditRow, LOCATION_LIST_ID, NEW, PersistError, emptyDraft, persistDraft, planSaveOrder, principalsOf, principalsText, scriptLoc, toDraft, truncate, type Draft } from "@/components/SceneEditRow";

const MENU_H = 188; // approx height of a 5-item menu, used to flip it upward near the bottom of the viewport
const MENU_W = 176;
const ITEM = "btn btn-ghost btn-sm btn-block";
const ITEM_STYLE = { justifyContent: "flex-start" } as const;
const SHOOT_DATE = { day: "2-digit", month: "short", year: "numeric" } as const;
type MenuPos = { top: number; left: number; anchor: HTMLElement };
type SaveAllResult = { ok: string[]; failed: { key: string; number: string; message: string; createdId?: string }[] };

/** Where a fixed menu opens for its trigger button: below it, or above when it would overflow the viewport. */
function menuPosition(el: HTMLElement): MenuPos {
  const r = el.getBoundingClientRect();
  const below = r.bottom + 4 + MENU_H <= window.innerHeight;
  return { top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - MENU_H), left: Math.max(8, r.right - MENU_W), anchor: el };
}

export default function Scenes() {
  const { projectId, can } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = can(MANAGER_ROLES);

  const [when, setWhen] = useState<"today" | "upcoming" | "all" | "">("all");
  const [rev, setRev] = useState("");
  const [q, setQ] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [editAll, setEditAll] = useState(false);
  const [principalsFor, setPrincipalsFor] = useState<string | null>(null);
  const [menu, setMenu] = useState<(MenuPos & { id: string }) | null>(null);
  const [more, setMore] = useState<MenuPos | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [docOpen, setDocOpen] = useState<DocKind | null>(null);
  const [importText, setImportText] = useState("24 | Restaurant - the dinner | Restaurant Set | INT | NIGHT | Day 3 | Raj, Priya, Waiter\n25 | Parking lot | Backlot | EXT | NIGHT | Day 3 | Raj, Priya");

  const { data, isLoading } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });
  const { data: characters } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")) });
  const charById = useMemo(() => new Map((characters || []).map((c) => [c.id, c])), [characters]);
  const sceneById = useMemo(() => new Map((data || []).map((s) => [s.id, s])), [data]);
  const locations = useMemo(() => Array.from(new Set((data || []).map((s) => (s.location || "").trim()).filter(Boolean))).sort(), [data]);
  const revisions = useMemo(() => Array.from(new Set((data || []).map((s) => s.revision || "").filter(Boolean))).sort(), [data]);
  const latestRevision = useMemo(() => (data || []).filter((s) => s.revision).sort((a, b) => (b.revisedAt || "").localeCompare(a.revisedAt || ""))[0]?.revision || "", [data]);

  const today = todayISO();
  const list = useMemo(() => {
    // A row being edited stays visible whatever the filters say, so an edit can never be hidden (and silently lost) by a filter change.
    const pinned = (s: Scene) => !!drafts[s.id];
    let items = data || [];
    if (rev) items = items.filter((s) => pinned(s) || (s.revision || "") === rev);
    if (when === "today") items = items.filter((s) => pinned(s) || dateKey(s.shootDate) === today);
    if (when === "upcoming") items = items.filter((s) => pinned(s) || (s.shootDate && dateKey(s.shootDate) >= today));
    const needle = q.trim().toLowerCase();
    if (needle) items = items.filter((s) => pinned(s) || [s.number, s.name, s.location, s.synopsis, s.scriptDay, s.intExt, ...s.characters.flatMap((c) => [c.character.name, String(c.character.castNumber ?? charById.get(c.characterId)?.castNumber ?? "")])].some((v) => (v || "").toLowerCase().includes(needle)));
    return items;
  }, [data, drafts, rev, when, q, today, charById]);

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
  const clone = useMutation({ mutationFn: (id: string) => api<Scene>(p(projectId, `/scenes/${id}/clone`), { method: "POST" }), onSuccess: (s) => { invalidate(); toast.push(`Cloned as scene ${s.number}`, "ok"); }, onError: fail });
  const setStatusM = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => api(p(projectId, `/scenes/${id}`), { method: "PATCH", body: { status } }), onSuccess: (_r, v) => { invalidate(v.id); toast.push(v.status === "OMITTED" ? "Scene omitted" : "Scene restored", "ok"); }, onError: fail });
  const del = useMutation({ mutationFn: (id: string) => api(p(projectId, `/scenes/${id}`), { method: "DELETE" }), onSuccess: () => { qc.invalidateQueries(); toast.push("Scene deleted", "ok"); }, onError: fail });
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

  const startEdit = (s: Scene) => setDraft(s.id, toDraft(s));
  // Rows already being edited keep their in-progress values; only untouched rows get a fresh snapshot.
  const startEditAll = () => { setDrafts((all) => ({ ...Object.fromEntries(list.map((s) => [s.id, toDraft(s)])), ...all })); setEditAll(true); };
  const cancelAll = () => { setDrafts({}); setEditAll(false); };
  const busy = saveOne.isPending || saveAll.isPending;
  const principalsDraft = principalsFor ? drafts[principalsFor] : undefined;
  const menuScene = menu ? sceneById.get(menu.id) : undefined;
  const addRow = () => setDraft(NEW, emptyDraft());

  const emptyTitle = when === "today" ? "No scenes scheduled today" : when === "upcoming" ? "No upcoming scenes" : q || rev ? "No scenes match" : "No scenes yet";
  const emptyHint = when === "today" ? "Once a schedule and callsheet is uploaded it will appear here." : when === "upcoming" ? "Once a schedule is uploaded it will appear here." : "Upload the script to build the breakdown automatically, paste a breakdown, or add scenes one by one.";
  const draftCount = `${revisions.length} draft${revisions.length === 1 ? "" : "s"}`;
  // The header reads like the reference: the selected draft, or the only draft when there is just one.
  const draftTitle = rev || (revisions.length === 1 ? revisions[0] : revisions.length ? "All drafts" : "Scenes");

  return (
    <div>
      <PageHead
        title={draftTitle}
        sub={revisions.length ? (rev ? `Script draft · ${draftCount}` : `${draftCount} · latest ${latestRevision}`) : "Script breakdown & costume readiness per scene"}
        actions={(revisions.length > 0 || canEdit) && (
          <>
            {revisions.length > 0 && <Select value={rev} onChange={(e) => setRev(e.target.value)} options={revisions} placeholder="All drafts" humanizeLabels={false} title="Script draft / revision" aria-label="Script draft" style={{ width: "auto", minWidth: 140 }} />}
            {canEdit && <><button className="btn btn-accent" onClick={() => setScriptOpen(true)}><FileUp size={16} /> Upload script</button><button className="btn" onClick={() => setDocOpen("CALLSHEET")} title="Read a call sheet: its scenes get that shoot date"><ClipboardList size={16} /> Upload callsheet</button><button className="btn" onClick={() => setDocOpen("SCHEDULE")} title="Read a shooting schedule: every scene gets its shoot date"><CalendarDays size={16} /> Upload schedule</button><button className="btn" onClick={() => setImportOpen(true)}><Upload size={16} /> Import breakdown</button></>}
          </>
        )}
      />

      <div className="filters">
        <SearchBox value={q} onChange={setQ} placeholder="Search scene, location, description, character…" />
        <Chips options={[{ key: "today", label: "Today" }, { key: "upcoming", label: "Upcoming" }, { key: "all", label: "All" }]} value={when} onChange={(v) => setWhen(v || "all")} />
        {canEdit && (
          <div className="row gap-1" style={{ marginLeft: "auto" }}>
            {editAll ? (
              <><button className="btn btn-blue" disabled={busy || draftKeys.length === 0 || !!firstProblem} title={firstProblem} onClick={() => saveAll.mutate()}>{saveAll.isPending ? "Saving…" : `Save all (${draftKeys.length})`}</button><button className="btn" disabled={busy} onClick={cancelAll}>Cancel</button></>
            ) : (
              <button className="btn" disabled={list.length === 0 || busy} onClick={startEditAll}>Edit All</button>
            )}
            <button className="btn" aria-label="More actions" aria-haspopup="menu" aria-expanded={!!more} onClick={(e) => { e.stopPropagation(); setMenu(null); setMore(more ? null : menuPosition(e.currentTarget)); }}><MoreHorizontal size={16} /></button>
            <button className="btn btn-blue" disabled={!!drafts[NEW] || busy} onClick={addRow}><Plus size={16} /> Add</button>
          </div>
        )}
      </div>

      <datalist id={LOCATION_LIST_ID}>{locations.map((l) => <option key={l} value={l} />)}</datalist>

      <Card pad0>
        {isLoading ? <Spinner /> : list.length === 0 && !drafts[NEW] ? (
          <Empty icon="🎬" title={emptyTitle} hint={emptyHint} action={canEdit && when === "all" && !q && !rev ? <button className="btn btn-blue" onClick={addRow}><Plus size={16} /> Add scene</button> : undefined} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 28 }}><span className="sr-only">Readiness</span></th><th>Scene #</th><th>Script Day</th><th>Script Loc.</th><th>Scene Description</th><th>Principals</th><th>Shoot Date</th><th style={{ width: 48 }}><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {drafts[NEW] && <EditRow d={drafts[NEW]} onChange={(d) => setDraft(NEW, d)} meta={meta} isNew principals={principalsText(drafts[NEW].principals, charById)} onPrincipals={() => setPrincipalsFor(NEW)} onSave={editAll ? undefined : () => saveOne.mutate(NEW)} onCancel={editAll ? undefined : () => dropDraft(NEW)} busy={busy && (saveAll.isPending || saveOne.variables === NEW)} error={problems[NEW]} />}
                {list.map((s) => {
                  const d = drafts[s.id];
                  if (d) return <EditRow key={s.id} d={d} onChange={(nd) => setDraft(s.id, nd)} meta={meta} principals={principalsText(d.principals, charById)} onPrincipals={() => setPrincipalsFor(s.id)} onSave={editAll ? undefined : () => saveOne.mutate(s.id)} onCancel={editAll ? undefined : () => dropDraft(s.id)} busy={busy && (saveAll.isPending || saveOne.variables === s.id)} error={problems[s.id]} />;
                  const pr = principalsOf(s.characters, charById);
                  const readiness = humanize(s.readiness);
                  return (
                    <tr key={s.id} style={s.status === "OMITTED" ? { opacity: 0.55 } : undefined}>
                      <td><span title={readiness} aria-label={readiness} role="img"><Dot status={s.readiness} pulse={s.readiness === "MISSING"} /></span></td>
                      <td className="nowrap"><Link to={`/p/${projectId}/scenes/${s.id}`} className="bold" title={s.name || `Scene ${s.number}`}>{s.number}</Link>{s.status !== "PLANNED" && <span className="hide-mobile" style={{ marginLeft: 8 }}><Badge status={s.status} /></span>}</td>
                      <td className="nowrap">{s.scriptDay || ""}</td>
                      <td className="nowrap">{scriptLoc(s)}</td>
                      <td title={s.synopsis || undefined}><div className="truncate" style={{ maxWidth: 340 }}>{truncate(s.synopsis)}</div></td>
                      <td title={pr.title || undefined}>{pr.text}</td>
                      <td className="nowrap">{s.shootDate ? fmtDate(s.shootDate, SHOOT_DATE) : ""}</td>
                      <td className="right">
                        {canEdit && <button className="btn btn-ghost btn-sm" aria-label="Scene actions" aria-haspopup="menu" aria-expanded={menu?.id === s.id} onClick={(e) => { e.stopPropagation(); setMore(null); setMenu(menu?.id === s.id ? null : { id: s.id, ...menuPosition(e.currentTarget) }); }}><MoreVertical size={16} /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Keyed by scene so an armed Omit/Delete confirmation never carries over to another row. */}
      {menu && menuScene && (
        <FixedMenu key={menu.id} top={menu.top} left={menu.left} width={MENU_W} anchor={menu.anchor} label={`Scene ${menuScene.number} actions`} onClose={() => setMenu(null)}>
          <button role="menuitem" className={ITEM} style={ITEM_STYLE} onClick={() => { startEdit(menuScene); setMenu(null); }}>Edit</button>
          <button role="menuitem" className={ITEM} style={ITEM_STYLE} disabled={clone.isPending} onClick={() => { clone.mutate(menu.id); setMenu(null); }}>Clone</button>
          {menuScene.status === "OMITTED"
            ? <button role="menuitem" className={ITEM} style={ITEM_STYLE} disabled={setStatusM.isPending} onClick={() => { setStatusM.mutate({ id: menu.id, status: "PLANNED" }); setMenu(null); }}>Restore</button>
            : <ConfirmButton role="menuitem" className={ITEM} style={ITEM_STYLE} confirmText="Omit scene?" onConfirm={() => { setStatusM.mutate({ id: menu.id, status: "OMITTED" }); setMenu(null); }}>Omit</ConfirmButton>}
          <ConfirmButton role="menuitem" className={ITEM} style={ITEM_STYLE} confirmText="Delete scene?" onConfirm={() => { del.mutate(menu.id); setMenu(null); }}>Delete</ConfirmButton>
        </FixedMenu>
      )}
      {more && canEdit && (
        <FixedMenu top={more.top} left={more.left} width={MENU_W} anchor={more.anchor} label="More scene actions" onClose={() => setMore(null)}>
          <button role="menuitem" className={ITEM} style={ITEM_STYLE} onClick={() => { setScriptOpen(true); setMore(null); }}><FileUp size={14} /> Upload script</button>
          <button role="menuitem" className={ITEM} style={ITEM_STYLE} onClick={() => { setDocOpen("CALLSHEET"); setMore(null); }}><ClipboardList size={14} /> Upload callsheet</button>
          <button role="menuitem" className={ITEM} style={ITEM_STYLE} onClick={() => { setDocOpen("SCHEDULE"); setMore(null); }}><CalendarDays size={14} /> Upload schedule</button>
          <button role="menuitem" className={ITEM} style={ITEM_STYLE} onClick={() => { setImportOpen(true); setMore(null); }}><Upload size={14} /> Import breakdown</button>
        </FixedMenu>
      )}

      <PrincipalsModal open={!!principalsDraft} onClose={() => setPrincipalsFor(null)} characters={characters || []} value={principalsDraft?.principals || []} onChange={(ids) => principalsFor && drafts[principalsFor] && setDraft(principalsFor, { ...drafts[principalsFor], principals: ids })} />

      <ScriptUploadModal open={scriptOpen} onClose={() => setScriptOpen(false)} onImported={() => { setWhen("all"); setRev(""); }} />
      <ScheduleUploadModal open={!!docOpen} kind={docOpen || "SCHEDULE"} onClose={() => setDocOpen(null)} onApplied={() => { setWhen(docOpen === "CALLSHEET" ? "today" : "upcoming"); setRev(""); }} />
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import script breakdown" footer={<><button className="btn" onClick={() => setImportOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={importM.isPending} onClick={() => importM.mutate()}>Import</button></>}>
        <div className="notice info mb-2">One scene per line: <span className="mono">number | name | location | INT/EXT | DAY/NIGHT | script day | characters (comma separated)</span>. Unknown characters are created automatically. Existing scene numbers are updated.</div>
        <Textarea rows={10} value={importText} onChange={(e) => setImportText(e.target.value)} className="mono" />
        <ErrorBox error={importM.error} />
      </Modal>
    </div>
  );
}
