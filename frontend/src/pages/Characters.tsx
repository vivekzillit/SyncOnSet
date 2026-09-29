import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hash, Plus } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, MANAGER_ROLES } from "@/state/auth";
import { humanize, matches } from "@/lib/format";
import type { Actor, Character } from "@/api/types";
import { Card, Empty, ErrorBox, Field, Input, Modal, PageHead, SearchBox, Select, Spinner, Tabs, Textarea, useToast } from "@/components/ui";
import { ActorSelect, Avatar } from "@/components/domain";
import { initials } from "@/components/ui";

const MEASURES = ["height", "chest", "bust", "waist", "hips", "inseam", "sleeve", "collar", "shoe", "head"];

export default function Characters() {
  const { projectId, can } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<"characters" | "actors">("characters");
  const { data: characters, isLoading } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")) });
  const { data: actors } = useQuery({ queryKey: ["actors", projectId], queryFn: () => api<Actor[]>(p(projectId, "/actors")) });
  const [charOpen, setCharOpen] = useState(false);
  const [actorOpen, setActorOpen] = useState(false);
  const [cf, setCf] = useState({ name: "", type: "SUPPORTING", actorId: "", age: "", description: "", castNumber: "" });
  const [numbering, setNumbering] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const needle = q.trim();
  const shownChars = useMemo(() => (characters || []).filter((c) => matches(needle, c.name, c.actor?.name, humanize(c.type), c.castNumber, c.description)), [characters, needle]);
  const shownActors = useMemo(() => (actors || []).filter((a) => matches(needle, a.name, a.agency, a.phone, a.email, ...(a.characters || []).map((c) => c.name))), [actors, needle]);
  const unnumbered = (characters || []).filter((c) => c.castNumber == null).length;
  const [af, setAf] = useState<{ name: string; phone: string; email: string; agency: string; notes: string; measurements: Record<string, string> }>({ name: "", phone: "", email: "", agency: "", notes: "", measurements: {} });

  const createChar = useMutation({
    mutationFn: () => api(p(projectId, "/characters"), { body: { name: cf.name, type: cf.type, actorId: cf.actorId || null, age: cf.age ? Number(cf.age) : null, description: cf.description || null, castNumber: cf.castNumber ? Number(cf.castNumber) : null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["characters", projectId] }); setCharOpen(false); setCf({ name: "", type: "SUPPORTING", actorId: "", age: "", description: "", castNumber: "" }); toast.push("Character created", "ok"); },
  });
  /** Cast numbers are set from the list itself: with 100+ characters, one modal each is no way to do it. */
  const setCast = useMutation({
    mutationFn: ({ id, castNumber }: { id: string; castNumber: number | null }) => api(p(projectId, `/characters/${id}`), { method: "PATCH", body: { castNumber } }),
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  /** What a box holds, or nothing at all. Throws on anything that is not a whole number. */
  const typedCast = (c: Character) => {
    const raw = (draft[c.id] ?? "").trim();
    const next = raw === "" ? null : Number(raw);
    if (next != null && (!Number.isInteger(next) || next < 0)) throw new Error("A cast number is a whole number");
    return next === (c.castNumber ?? null) ? undefined : next;
  };
  const commitCast = (c: Character) => {
    try {
      const next = typedCast(c);
      if (next !== undefined) setCast.mutate({ id: c.id, castNumber: next });
    } catch (e) { toast.push((e as Error).message, "danger"); }
  };
  /**
   * Save takes whatever is still in the boxes with it — a number typed and not tabbed out of is still a number
   * somebody typed. Rows are left where they are while numbering, and re-sorted once every one of them is in.
   */
  const saveNumbering = async () => {
    try {
      await Promise.all((characters || []).filter((c) => draft[c.id] !== undefined).map((c) => {
        const next = typedCast(c);
        return next === undefined ? null : setCast.mutateAsync({ id: c.id, castNumber: next });
      }));
    } catch (e) { toast.push((e as Error).message, "danger"); return; }
    setNumbering(false);
    setDraft({});
    qc.invalidateQueries({ queryKey: ["characters", projectId] });
    toast.push("Cast numbers saved", "ok");
  };

  const createActor = useMutation({
    mutationFn: () => api(p(projectId, "/actors"), { body: { ...af, measurements: Object.fromEntries(Object.entries(af.measurements).filter(([, v]) => v)) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["actors", projectId] }); setActorOpen(false); setAf({ name: "", phone: "", email: "", agency: "", notes: "", measurements: {} }); toast.push("Actor added", "ok"); },
  });

  return (
    <div>
      <PageHead title="List of Characters" sub={<>Who wears what. Cast numbers appear on sides and call sheets.<div style={{ color: "var(--danger)", marginTop: 4 }}>Default opening by a cast numbers if no cast number listed alphabetically</div></>} actions={<><Link to={`/p/${projectId}/actors`} className="btn">★ Actors</Link>{can(MANAGER_ROLES) && tab === "characters" && (numbering ? <button className="btn" disabled={setCast.isPending} onClick={saveNumbering}>{setCast.isPending ? "Saving…" : "Save"}</button> : <button className="btn" onClick={() => setNumbering(true)}><Hash size={16} /> Cast numbers</button>)}{can(MANAGER_ROLES) && (tab === "characters" ? <button className="btn btn-primary" onClick={() => setCharOpen(true)}><Plus size={16} /> Character</button> : <button className="btn btn-primary" onClick={() => setActorOpen(true)}><Plus size={16} /> Actor</button>)}</>} />
      <Tabs tabs={[{ key: "characters", label: `Characters (${characters?.length ?? 0})` }, { key: "actors", label: `Actors (${actors?.length ?? 0})` }]} value={tab} onChange={setTab} />
      {(tab === "characters" ? !!characters?.length : !!actors?.length) && (
        <div className="filters">
          <SearchBox value={q} onChange={setQ} placeholder={tab === "characters" ? "Search character, actor, cast number, type…" : "Search actor, character, agency, phone…"} />
        </div>
      )}
      {tab === "characters" && !!characters?.length && !needle && (
        <div className="subtle mb-2">In cast-number order{unnumbered > 0 ? <> · <b>{unnumbered}</b> of {characters.length} still have no cast number{numbering ? ", type it beside the name" : ""}</> : null}</div>
      )}
      {tab === "characters" ? (
        <Card pad0>
          {isLoading ? <Spinner /> : !characters?.length ? <Empty icon="🧍" title="No characters yet" /> : !shownChars.length ? <Empty icon="🔍" title="No characters match" hint="Try a different name or cast number." /> : (
            <div className="list">
              {shownChars.map((c) => {
                const body = (
                  <>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <span className="title">{c.name}</span>
                      <div className="meta">{c.actor?.name || "No actor assigned"}{c.age ? ` · age ${c.age}` : ""}</div>
                    </div>
                    <div className="end subtle hide-mobile">{c._count?.scenes} scenes · {c._count?.changes} changes · {c._count?.costumes} pieces</div>
                  </>
                );
                return numbering ? (
                  <div key={c.id} className="item">
                    <Input type="number" min={0} step={1} className="mono" style={{ width: 78 }} placeholder="#" aria-label={`Cast number for ${c.name}`}
                      value={draft[c.id] ?? (c.castNumber != null ? String(c.castNumber) : "")}
                      onChange={(e) => setDraft({ ...draft, [c.id]: e.target.value })}
                      onBlur={() => commitCast(c)}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                    {body}
                  </div>
                ) : (
                  <Link key={c.id} to={`/p/${projectId}/characters/${c.id}`} className="item link">
                    <div className="avatar">{c.castNumber != null ? c.castNumber : <span className="subtle">—</span>}</div>
                    {body}
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      ) : (
        <Card pad0>
          {!actors ? <Spinner /> : actors.length === 0 ? <Empty icon="🎭" title="No actors yet" /> : !shownActors.length ? <Empty icon="🔍" title="No actors match" hint="Try a different name." /> : (
            <div className="list">
              {shownActors.map((a) => (
                <div key={a.id} className="item">
                  <Avatar name={a.name} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="title">{a.name}</div>
                    <div className="meta">{(a.characters || []).map((c) => c.name).join(", ") || "No character"}{a.phone ? ` · ${a.phone}` : ""}</div>
                    <div className="subtle truncate">{Object.entries(a.measurements || {}).map(([k, v]) => `${k} ${v}`).join(" · ")}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Modal open={charOpen} onClose={() => setCharOpen(false)} title="New character" footer={<><button className="btn" onClick={() => setCharOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!cf.name || createChar.isPending} onClick={() => createChar.mutate()}>Create</button></>}>
        <div className="form-grid">
          <Field label="Name" span2><Input value={cf.name} onChange={(e) => setCf({ ...cf, name: e.target.value })} /></Field>
          <Field label="Type"><Select value={cf.type} onChange={(e) => setCf({ ...cf, type: e.target.value })} options={meta?.characterTypes || []} /></Field>
          <Field label="Age"><Input type="number" value={cf.age} onChange={(e) => setCf({ ...cf, age: e.target.value })} /></Field>
          <Field label="Cast number" help="As on call sheets and sides"><Input type="number" value={cf.castNumber} onChange={(e) => setCf({ ...cf, castNumber: e.target.value })} /></Field>
          <Field label="Actor" span2><ActorSelect value={cf.actorId} onChange={(actorId) => setCf({ ...cf, actorId })} /></Field>
          <Field label="Description" span2><Textarea value={cf.description} onChange={(e) => setCf({ ...cf, description: e.target.value })} placeholder="Look, palette, references…" /></Field>
        </div>
        <ErrorBox error={createChar.error} />
      </Modal>
      <Modal open={actorOpen} onClose={() => setActorOpen(false)} title="New actor" footer={<><button className="btn" onClick={() => setActorOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!af.name || createActor.isPending} onClick={() => createActor.mutate()}>Add</button></>}>
        <div className="form-grid">
          <Field label="Name" span2><Input value={af.name} onChange={(e) => setAf({ ...af, name: e.target.value })} /></Field>
          <Field label="Phone"><Input value={af.phone} onChange={(e) => setAf({ ...af, phone: e.target.value })} /></Field>
          <Field label="Email"><Input value={af.email} onChange={(e) => setAf({ ...af, email: e.target.value })} /></Field>
          <Field label="Agency" span2><Input value={af.agency} onChange={(e) => setAf({ ...af, agency: e.target.value })} /></Field>
          <div className="span-2 bold small">Measurements</div>
          {MEASURES.map((m) => (
            <Field key={m} label={humanize(m)}><Input value={af.measurements[m] || ""} onChange={(e) => setAf({ ...af, measurements: { ...af.measurements, [m]: e.target.value } })} /></Field>
          ))}
          <Field label="Notes" span2><Textarea value={af.notes} onChange={(e) => setAf({ ...af, notes: e.target.value })} placeholder="Allergies, preferences…" /></Field>
        </div>
        <ErrorBox error={createActor.error} />
      </Modal>
    </div>
  );
}
