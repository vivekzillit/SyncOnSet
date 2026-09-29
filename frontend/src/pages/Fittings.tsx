import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Megaphone } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, OPS_ROLES, REQUEST_ROLES } from "@/state/auth";
import { fmtDate, fmtTime, matches } from "@/lib/format";
import type { Character, Costume, Fitting } from "@/api/types";
import { Badge, Card, Chips, Empty, ErrorBox, Field, Input, Modal, PageHead, SearchBox, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { RecordActions } from "@/components/Discussion";
import { SendRequestModal, chaseBody } from "@/components/SendRequest";
import { Avatar, CostumePicker, CostumeRow, MediaPicker, attachMedia } from "@/components/domain";
import { CharacterQuickPanel, NEW_CHARACTER, NewCharacterModal, characterOptions } from "@/components/CharacterQuick";

export default function Fittings() {
  const { projectId, can, project } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["fittings", projectId], queryFn: () => api<Fitting[]>(p(projectId, "/fittings")) });
  const { data: characters } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")) });
  const [open, setOpen] = useState(false);
  /** The message a call starts from, taken when the button is pressed so nothing rewrites it mid-sentence. */
  const [chase, setChase] = useState<{ title: string; body: string; entityId?: string } | null>(null);
  const [pick, setPick] = useState(false);
  const [f, setF] = useState<{ characterId: string; scheduledAt: string; location: string; notes: string; costumes: Costume[] }>({ characterId: "", scheduledAt: "", location: "", notes: "", costumes: [] });
  const [media, setMedia] = useState<File[]>([]);
  const [newChar, setNewChar] = useState(false);
  const [showChar, setShowChar] = useState(false);
  const createdId = useRef<string | null>(null);
  /** Set by "Schedule & send": once the fitting is booked, the Send request dialog opens about it. */
  const sendAfter = useRef(false);
  /** Closing drops what was picked, so it can never ride along to the next fitting. */
  const closeForm = () => { setOpen(false); setMedia([]); setShowChar(false); createdId.current = null; };
  const create = useMutation({
    // The fitting is created once — a failed upload can be retried from the same open form without booking
    // a second one — and whatever did not attach stays in the picker rather than being thrown away.
    mutationFn: async () => {
      if (!createdId.current) createdId.current = (await api<Fitting>(p(projectId, "/fittings"), { body: { characterId: f.characterId, scheduledAt: f.scheduledAt || new Date().toISOString(), location: f.location || null, notes: f.notes || null, costumeIds: f.costumes.map((c) => c.id) } })).id;
      await attachMedia({ projectId, entityType: "FITTING", entityId: createdId.current, files: media, kind: "REFERENCE", keep: setMedia, savedNote: "The fitting is saved — press Schedule again to attach what is left." });
      return createdId.current;
    },
    onSuccess: (id) => { createdId.current = null; if (sendAfter.current && id) { const ch = characters?.find((c) => c.id === f.characterId); const when = f.scheduledAt || new Date().toISOString(); setChase({ title: `Fitting · ${ch?.name || "Character"}`.slice(0, 160), body: `Fitting for ${ch?.name || "the character"}${ch?.actor ? ` (${ch.actor.name})` : ""} on ${fmtDate(when)} at ${fmtTime(when)}${f.location ? `, ${f.location}` : ""}.${f.costumes.length ? `\nPieces: ${f.costumes.map((c) => `${c.assetNumber} ${c.name}`).join(", ")}` : ""}${f.notes ? `\n${f.notes}` : ""}\n\nPlease confirm you can make it.`, entityId: id }); } sendAfter.current = false; qc.invalidateQueries({ queryKey: ["fittings", projectId] }); closeForm(); setF({ characterId: "", scheduledAt: "", location: "", notes: "", costumes: [] }); toast.push("Fitting scheduled", "ok"); },
  });
  const list = (data || []).filter((x) => (!status || x.status === status) && matches(q, x.character.name, x.actor?.name, x.location));
  // The call covers every fitting still open — not what the filters are showing. What is still to come leads,
  // because that is what people are being asked to confirm; a slot already gone by follows, marked as missed,
  // so that a long list loses the oldest no-shows rather than tomorrow's appointments.
  const fromToday = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const still = (data || []).filter((x) => ["SCHEDULED", "IN_PROGRESS"].includes(x.status)).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const soon = still.filter((x) => x.scheduledAt >= fromToday);
  const upcoming = [...soon, ...still.filter((x) => x.scheduledAt < fromToday)];
  const missed = still.length - soon.length;
  const callFittings = () => setChase({
    title: `Fittings coming up · ${project?.name || "Production"}`.slice(0, 160),
    body: chaseBody({
      lead: `${upcoming.length} ${upcoming.length === 1 ? "fitting is" : "fittings are"} booked${missed ? `, ${missed} of them already missed` : ""}:`,
      // The actor is who is being called in; the character is only which part they are being fitted for, and
      // their own number stays out of it — this can go to a hire company, and that is not theirs to have.
      lines: upcoming.map((x) => `${fmtDate(x.scheduledAt)} ${fmtTime(x.scheduledAt)} — ${x.actor?.name || x.character.actor?.name || "actor not cast yet"} as ${x.character.name}${x.location ? ` · ${x.location}` : ""}${x.scheduledAt < fromToday ? " · missed" : ""}`),
      empty: "Nothing is booked in at the moment.",
      ask: "Please confirm your slot — and if it says missed, tell us when you can come in.",
    }),
  });
  return (
    <div>
      <PageHead title="Fittings" sub="Schedule fittings, tick off each piece, raise alterations on the spot." actions={<>
        {can(REQUEST_ROLES) && <button className="btn" disabled={isLoading || !data} onClick={callFittings}><Megaphone size={16} /> Send reminder request</button>}
        {can(OPS_ROLES) && <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Fitting</button>}
      </>} />
      <div className="filters"><SearchBox value={q} onChange={setQ} placeholder="Search character, actor, location…" /><Chips all="All" options={(meta?.fittingStatuses || []).map((s) => ({ key: s, label: s.replace(/_/g, " ").toLowerCase() }))} value={status} onChange={setStatus} /></div>
      <Card pad0>
        {isLoading ? <Spinner /> : list.length === 0 ? <Empty icon="📏" title={q ? "No fittings match" : "No fittings"} /> : (
          <div className="list">
            {list.map((x) => (
              <Link key={x.id} to={`${base}/fittings/${x.id}`} className="item link">
                <Avatar name={x.character.name} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="title">{x.character.name}{x.actor ? ` · ${x.actor.name}` : ""}</div>
                  <div className="meta">{fmtDate(x.scheduledAt)} {fmtTime(x.scheduledAt)}{x.location ? ` · ${x.location}` : ""} · {x.items.filter((i) => i.status === "FITTED").length}/{x.items.length} fitted{x.items.some((i) => i.status === "ALTERATION_REQUIRED") ? " · alteration needed" : ""}</div>
                </div>
                <div className="end">
                  <RecordActions entityType="FITTING" entityId={x.id} title={`Fitting · ${x.character.name}`} path={`${base}/fittings/${x.id}`}
                    summary={`Fitting: ${x.character.name}${x.actor ? ` (${x.actor.name})` : ""}\n${fmtDate(x.scheduledAt)} ${fmtTime(x.scheduledAt)}${x.location ? ` · ${x.location}` : ""}`} />
                  <Badge status={x.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
      <Modal open={open} onClose={closeForm} title="Schedule fitting" footer={<><button className="btn" onClick={closeForm}>Cancel</button>{can(REQUEST_ROLES) && <button className="btn" disabled={!f.characterId || create.isPending} onClick={() => { sendAfter.current = true; create.mutate(); }} title="Book it, then send a request about it"><Megaphone size={15} /> Schedule & send</button>}<button className="btn btn-primary" disabled={!f.characterId || create.isPending} onClick={() => { sendAfter.current = false; create.mutate(); }}>Schedule</button></>}>
        <div className="form-grid">
          {/* Somebody the script reader missed can be added from here rather than on another page. */}
          <Field label="Character" span2>
            <Select value={f.characterId} onChange={(e) => (e.target.value === NEW_CHARACTER ? setNewChar(true) : setF({ ...f, characterId: e.target.value, costumes: [] }))} options={characterOptions(characters)} placeholder="Select…" humanizeLabels={false} />
          </Field>
          <Field label="When"><Input type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} /></Field>
          <Field label="Where"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
          <Field label="Pieces to try" span2>
            <div className="list card flat pad-0">{f.costumes.map((c) => <CostumeRow key={c.id} c={c} onClick={() => setF({ ...f, costumes: f.costumes.filter((x) => x.id !== c.id) })} end={<span className="subtle">remove</span>} />)}</div>
            <button type="button" className="btn btn-sm mt-1" onClick={() => setPick(true)}><Plus size={14} /> Add piece</button>
          </Field>
          <Field label="Notes" span2><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <Field label="Photos & video" span2 help="Shoot it now, or pick from the gallery"><MediaPicker files={media} onChange={setMedia} disabled={create.isPending} /></Field>
          {/* The character's own things — who is cast, their references, the pieces tagged to them — without leaving this form. */}
          <div className="span-2">
            <button type="button" className="btn btn-sm" onClick={() => setShowChar((v) => !v)} aria-expanded={showChar}>
              {showChar ? "Hide character details" : "Character details"}
            </button>
            {showChar && (
              <div className="card flat mt-2" style={{ padding: 12 }}>
                {/* It opens either way: a button that does nothing when nobody is picked reads as broken. */}
                {f.characterId ? <CharacterQuickPanel characterId={f.characterId} /> : <div className="subtle">Pick a character above and their actor, references and pieces open here.</div>}
              </div>
            )}
          </div>
        </div>
        <ErrorBox error={create.error} />
      </Modal>
      <NewCharacterModal open={newChar} onClose={() => setNewChar(false)} onCreated={(c) => setF({ ...f, characterId: c.id, costumes: [] })} />
      <CostumePicker open={pick} onClose={() => setPick(false)} onPick={(c) => setF({ ...f, costumes: f.costumes.some((x) => x.id === c.id) ? f.costumes : [...f.costumes, c] })} characterId={f.characterId || null} />
      <SendRequestModal open={!!chase} onClose={() => setChase(null)} title={chase?.entityId ? "Send a request · this fitting" : "Send a reminder request · fittings"}
        defaultTitle={chase?.title || ""} defaultBody={chase?.body || ""} entityType="FITTING" entityId={chase?.entityId} />
    </div>
  );
}
