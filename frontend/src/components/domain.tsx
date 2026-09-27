import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, Download, ExternalLink, FileText, Images, Link as LinkIcon, Paperclip, Play, Plus, Video, X } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { CONTINUITY_ROLES, MANAGER_ROLES } from "@/state/auth";
import { fmtDateTime, humanize, tone } from "@/lib/format";
import type { Actor, Costume, Photo, Role, TimelineEvent } from "@/api/types";
import { Badge, Dot, Empty, ErrorBox, Field, Input, Modal, SearchBox, Select, Spinner, Textarea, initials, useToast } from "./ui";
import { ActorModal } from "./ActorModal";

/* ---------- QR Scanner (camera) ---------- */
export function QRScanner({ onScan, active }: { onScan: (text: string) => void; active: boolean }) {
  const ref = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`qr-${Math.random().toString(36).slice(2)}`);
  const lastRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const scanner = new Html5Qrcode(idRef.current, { verbose: false });
    ref.current = scanner;
    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.7, height: Math.min(w, h) * 0.7 }) },
        (text) => {
          const now = Date.now();
          if (lastRef.current.text === text && now - lastRef.current.at < 2500) return;
          lastRef.current = { text, at: now };
          onScan(text);
        },
        () => undefined,
      )
      .catch((e) => !stopped && setError(e?.message || String(e)));
    return () => {
      stopped = true;
      const s = ref.current;
      ref.current = null;
      if (!s) return;
      try {
        // html5-qrcode throws synchronously if the camera never started (e.g. permission denied / StrictMode remount)
        if (s.isScanning) s.stop().then(() => s.clear()).catch(() => undefined);
        else s.clear();
      } catch {
        /* ignore */
      }
    };
  }, [active, onScan]);

  if (!active) return null;
  return (
    <div>
      <div id={idRef.current} className="qr-frame" style={{ width: "100%", minHeight: 240 }} />
      {error && <div className="notice mt-2">Camera unavailable ({error}). Type the asset number below instead.</div>}
    </div>
  );
}

/* ---------- Photos ---------- */
/** Human size for an attached file. */
const fileSize = (bytes?: number | null) => {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
};
const isMedia = (ph: Photo) => (ph.mediaType ? ph.mediaType === "IMAGE" || ph.mediaType === "VIDEO" : true);
/** The server caps an upload at 250 MB; saying so before sending saves a long wait on set. */
const MAX_UPLOAD = 250 * 1024 * 1024;

/** A photo or video as a square tile; a video shows its first frame under a play mark. */
export function MediaThumb({ ph, alt }: { ph: Pick<Photo, "url" | "mediaType">; alt?: string }) {
  if (ph.mediaType !== "VIDEO") return <img src={ph.url} alt={alt || ""} loading="lazy" />;
  return (
    <>
      <video src={`${ph.url}#t=0.1`} muted playsInline preload="metadata" />
      <span className="play" aria-hidden><Play size={16} fill="currentColor" /></span>
    </>
  );
}

/** A photo or video at full size, for the preview modal. */
export function MediaView({ ph, alt }: { ph: Pick<Photo, "url" | "mediaType">; alt?: string }) {
  return ph.mediaType === "VIDEO"
    ? <video src={ph.url} controls autoPlay playsInline style={{ width: "100%", maxHeight: "75vh", borderRadius: 10, background: "#000" }} />
    : <img src={ph.url} alt={alt || ""} style={{ width: "100%", borderRadius: 10 }} />;
}

/**
 * Photos and videos picked while a record is still being filled in — a report or a piece that has no id yet,
 * so nothing can be uploaded until it is saved. The camera buttons carry `capture`, which on a phone opens
 * the camera straight away; Gallery leaves it off so the library is offered instead.
 */
export function MediaPicker({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [urls, setUrls] = useState<string[]>([]);
  // Object URLs are revoked when the picked files change, so a long-lived form does not leak them.
  useEffect(() => {
    const made = files.map((f) => URL.createObjectURL(f));
    setUrls(made);
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  const add = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = ""; // so the same file can be picked twice
    if (picked.length) onChange([...files, ...picked]);
  };
  return (
    <div className="col gap-1">
      <div className="row gap-1 wrap">
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => photoRef.current?.click()} title="Take a photo with the camera"><Camera size={15} /> Photo</button>
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => videoRef.current?.click()} title="Record a video with the camera"><Video size={15} /> Video</button>
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => galleryRef.current?.click()} title="Choose photos or videos from the gallery"><Images size={15} /> Gallery</button>
        <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={add} />
        <input ref={videoRef} type="file" accept="video/*" capture="environment" hidden onChange={add} />
        <input ref={galleryRef} type="file" accept="image/*,video/*" multiple hidden onChange={add} />
      </div>
      {files.length === 0 ? <div className="subtle tiny">Attached once this is saved.</div> : (
        <div className="photos" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}>
          {files.map((file, i) => (
            <div key={`${file.name}-${i}`} className="photo" title={file.name}>
              {file.type.startsWith("video/")
                ? <><video src={urls[i]} muted playsInline preload="metadata" /><span className="play" aria-hidden><Play size={16} fill="currentColor" /></span></>
                : <img src={urls[i]} alt={file.name} />}
              <button type="button" className="del" disabled={disabled} onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={`Remove ${file.name}`}><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Attach what MediaPicker collected, once the record it belongs to exists. */
export async function uploadMedia(projectId: string, entityType: string, entityId: string, files: File[], kind: string) {
  const tooBig = files.find((f) => f.size > MAX_UPLOAD);
  if (tooBig) throw new Error(`${tooBig.name || "That file"} is over 250 MB. Trim the clip, or share it as a link.`);
  for (const file of files) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("entityType", entityType);
    fd.append("entityId", entityId);
    fd.append("kind", kind);
    await api(p(projectId, "/photos"), { formData: fd });
  }
}

/**
 * References attached to a record: photos shown as thumbnails, any other file listed for download,
 * and links out to a drive or a mood board. Used by characters, looks, fittings, continuity, cleaning and damage.
 */
export function PhotoGrid({ photos, entityType, entityId, kinds, compact, attachments = true, editRoles = CONTINUITY_ROLES }: { photos: Photo[]; entityType: string; entityId: string; kinds?: string[]; compact?: boolean; attachments?: boolean; editRoles?: Role[] }) {
  const { projectId, can } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState((kinds || ["FRONT", "SIDE", "BACK", "CLOSEUP", "DETAIL", "STAIN", "REFERENCE", "DOCUMENT", "OTHER"])[0]);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Photo | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState({ url: "", title: "" });
  const editable = can(editRoles);

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const tooBig = files.find((f) => f.size > MAX_UPLOAD);
      if (tooBig) throw new Error(`${tooBig.name || "That file"} is over 250 MB. Trim the clip, or share it as a link.`);
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("entityType", entityType);
        fd.append("entityId", entityId);
        fd.append("kind", kind);
        await api(p(projectId, "/photos"), { formData: fd });
      }
    },
    onSuccess: (_r, files) => { qc.invalidateQueries(); toast.push(`${files.length} file${files.length === 1 ? "" : "s"} attached`, "ok"); },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  const addLink = useMutation({
    mutationFn: () => api(p(projectId, "/photos/link"), { body: { entityType, entityId, kind, url: link.url.trim(), title: link.title.trim() || undefined } }),
    onSuccess: () => { qc.invalidateQueries(); setLinkOpen(false); setLink({ url: "", title: "" }); toast.push("Link added", "ok"); },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  const del = useMutation({ mutationFn: (id: string) => api(p(projectId, `/photos/${id}`), { method: "DELETE" }), onSuccess: () => qc.invalidateQueries() });

  const images = photos.filter(isMedia);
  const others = photos.filter((ph) => !isMedia(ph));
  // Reset the input so picking the same file twice still uploads it.
  const pickFiles = (e: ChangeEvent<HTMLInputElement>) => { const files = Array.from(e.target.files || []); e.target.value = ""; if (files.length) upload.mutate(files); };

  return (
    <div>
      {editable && (
        <div className="row gap-2 mb-2 wrap">
          <Select value={kind} onChange={(e) => setKind(e.target.value)} options={kinds || ["FRONT", "SIDE", "BACK", "CLOSEUP", "DETAIL", "STAIN", "REFERENCE", "DOCUMENT", "OTHER"]} style={{ width: "auto" }} />
          <button type="button" className="btn btn-sm" onClick={() => photoRef.current?.click()} disabled={upload.isPending} title="Take a photo with the camera">
            <Camera size={15} /> {upload.isPending ? "Uploading…" : "Photo"}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => videoRef.current?.click()} disabled={upload.isPending} title="Record a video with the camera"><Video size={15} /> Video</button>
          <button type="button" className="btn btn-sm" onClick={() => galleryRef.current?.click()} disabled={upload.isPending} title="Choose photos or videos from the gallery"><Images size={15} /> Gallery</button>
          {attachments && <>
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={upload.isPending}><Paperclip size={15} /> Add file</button>
            <button type="button" className="btn btn-sm" onClick={() => setLinkOpen(true)}><LinkIcon size={15} /> Add link</button>
          </>}
          {/* On a phone `capture` opens the camera straight away; the gallery input leaves it off so the library is offered. */}
          <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={pickFiles} />
          <input ref={videoRef} type="file" accept="video/*" capture="environment" hidden onChange={pickFiles} />
          <input ref={galleryRef} type="file" accept="image/*,video/*" multiple hidden onChange={pickFiles} />
          <input ref={fileRef} type="file" multiple hidden onChange={pickFiles} />
        </div>
      )}
      {images.length === 0 && others.length === 0 ? (
        <div className="subtle">{attachments ? "Nothing attached yet." : "No photos or videos yet."}</div>
      ) : (
        <>
          {images.length > 0 && (
            <div className="photos" style={compact ? { gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))" } : undefined}>
              {images.map((ph) => (
                <div key={ph.id} className="photo" onClick={() => setPreview(ph)}>
                  <MediaThumb ph={ph} alt={ph.caption || ph.kind} />
                  <span className="kind">{ph.kind}</span>
                  {editable && (
                    <button type="button" className="del" onClick={(e) => { e.stopPropagation(); del.mutate(ph.id); }} aria-label={ph.mediaType === "VIDEO" ? "Delete video" : "Delete photo"}><X size={12} /></button>
                  )}
                </div>
              ))}
            </div>
          )}
          {others.length > 0 && (
            <div className="list mt-2">
              {others.map((ph) => (
                <a key={ph.id} className="item link" href={ph.url} target="_blank" rel="noreferrer">
                  {ph.mediaType === "LINK" ? <LinkIcon size={16} color="var(--text-3)" /> : <FileText size={16} color="var(--text-3)" />}
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="title small truncate">{ph.title || ph.url}</div>
                    <div className="meta">{[humanize(ph.kind), ph.mediaType === "LINK" ? "Link" : fileSize(ph.size), ph.caption].filter(Boolean).join(" · ")}</div>
                  </div>
                  {ph.mediaType === "LINK" ? <ExternalLink size={14} color="var(--text-3)" /> : <Download size={14} color="var(--text-3)" />}
                  {editable && <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.preventDefault(); del.mutate(ph.id); }} aria-label="Remove"><X size={14} /></button>}
                </a>
              ))}
            </div>
          )}
        </>
      )}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview ? `${humanize(preview.kind)} · ${fmtDateTime(preview.createdAt)}` : ""} wide>
        {preview && <MediaView ph={preview} />}
      </Modal>
      <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title="Add a link"
        footer={<><button className="btn" onClick={() => setLinkOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!link.url.trim() || addLink.isPending} onClick={() => addLink.mutate()}>{addLink.isPending ? "Adding…" : "Add link"}</button></>}>
        <div className="col">
          <Field label="Address" help="A shared drive folder, a mood board, a supplier page."><Input value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="https://drive.google.com/…" autoFocus /></Field>
          <Field label="Title" help="Optional; the site name is used if you leave it blank."><Input value={link.title} onChange={(e) => setLink({ ...link, title: e.target.value })} placeholder="Reference board" /></Field>
        </div>
      </Modal>
    </div>
  );
}

/* ---------- Timeline ---------- */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <div className="subtle">No history yet.</div>;
  return (
    <div className="timeline">
      {events.map((e, i) => (
        <div key={i} className={`tl kind-${e.kind}`}>
          <span className="tl-dot" />
          <div className="tl-time">{fmtDateTime(e.at)}{e.by ? ` · ${e.by}` : ""}</div>
          <div className="tl-title">{e.title}</div>
          {e.detail && <div className="tl-detail">{e.detail}</div>}
        </div>
      ))}
    </div>
  );
}

/* ---------- Pipeline stepper ---------- */
export function Pipeline({ steps, current }: { steps: readonly string[]; current: string }) {
  const idx = steps.indexOf(current);
  return (
    <div className="pipeline">
      {steps.map((s, i) => (
        <div key={s} className={`step ${i < idx ? "done" : ""} ${i === idx ? "current" : ""}`}>
          <div className="node">{i < idx ? "✓" : i + 1}</div>
          <span>{humanize(s)}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Costume list row ---------- */
/** `noStatus` drops the status tag, for lists that only need to say which pieces there are. */
export function CostumeRow({ c, extra, onClick, end, noStatus }: { c: Costume; extra?: ReactNode; onClick?: () => void; end?: ReactNode; noStatus?: boolean }) {
  const { projectId } = useProject();
  const inner = (
    <>
      <div className="avatar">{c.category === "FOOTWEAR" ? "👞" : c.category === "ACCESSORY" ? "⌚" : c.category === "JEWELLERY" ? "💍" : "👕"}</div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row gap-1" style={{ minWidth: 0 }}>
          <span className="mono bold">{c.assetNumber}</span>
          <span className="title truncate">{c.name}</span>
        </div>
        <div className="meta truncate">
          {[c.type, c.color, c.size ? `Size ${c.size}` : null, c.character?.name ? `for ${c.character.name}` : null].filter(Boolean).join(" · ")}
          {extra}
        </div>
      </div>
      <div className="end">
        <span className="subtle hide-mobile">{c.location}</span>
        {!noStatus && <Badge status={c.status} />}
        {end}
      </div>
    </>
  );
  if (onClick) return <div className="item link" onClick={onClick}>{inner}</div>;
  return <Link to={`/p/${projectId}/costumes/${c.id}`} className="item link">{inner}</Link>;
}

/* ---------- Costume picker (search + choose) ---------- */
export function CostumePicker({ open, onClose, onPick, title = "Pick a costume", filter, characterId }: { open: boolean; onClose: () => void; onPick: (c: Costume) => void; title?: string; filter?: (c: Costume) => boolean; characterId?: string | null }) {
  const { projectId } = useProject();
  const [q, setQ] = useState("");
  const [onlyChar, setOnlyChar] = useState(!!characterId);
  const { data, isLoading } = useQuery({
    queryKey: ["costumes", projectId, "picker", q, onlyChar ? characterId : ""],
    queryFn: () => api<{ items: Costume[] }>(p(projectId, `/costumes?pageSize=100&q=${encodeURIComponent(q)}${onlyChar && characterId ? `&characterId=${characterId}` : ""}`)),
    enabled: open,
  });
  const items = (data?.items || []).filter(filter || (() => true));
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="row gap-2 mb-2 wrap">
        <SearchBox value={q} onChange={setQ} placeholder="Asset no, name, colour, size…" autoFocus />
        {characterId && (
          <label className="check"><input type="checkbox" checked={onlyChar} onChange={(e) => setOnlyChar(e.target.checked)} /> This character only</label>
        )}
      </div>
      {isLoading ? <Spinner /> : items.length === 0 ? <Empty title="No costumes match" /> : (
        <div className="list card flat pad-0" style={{ maxHeight: "55vh", overflowY: "auto" }}>
          {items.map((c) => <CostumeRow key={c.id} c={c} onClick={() => { onPick(c); onClose(); }} end={<Plus size={16} />} />)}
        </div>
      )}
    </Modal>
  );
}

/* ---------- Readiness ---------- */
export function ReadinessLine({ level, name, sub }: { level: string; name: ReactNode; sub?: ReactNode }) {
  return (
    <div className="readiness-row">
      <Dot status={level} pulse={level === "MISSING"} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="bold truncate">{name}</div>
        {sub && <div className="subtle truncate">{sub}</div>}
      </div>
      <Badge status={level}>{level === "READY" ? "Ready" : humanize(level)}</Badge>
    </div>
  );
}

/* ---------- Actor picker ---------- */
const NEW_ACTOR = "__new_actor__";

/** Actor dropdown that also offers "+ New actor", opening the same Create Actor form the Actors page uses. */
export function ActorSelect({ value, onChange, disabled, label, placeholder = "— unassigned —" }: { value: string; onChange: (actorId: string) => void; disabled?: boolean; label?: string; placeholder?: string }) {
  const { projectId, can } = useProject();
  const [open, setOpen] = useState(false);
  const { data: actors } = useQuery({ queryKey: ["actors", projectId], queryFn: () => api<Actor[]>(p(projectId, "/actors")) });
  const canAdd = can(MANAGER_ROLES);
  const options = [...(actors || []).map((a) => ({ value: a.id, label: a.name })), ...(canAdd ? [{ value: NEW_ACTOR, label: "+ New actor" }] : [])];

  return (
    <>
      <Select value={value} onChange={(e) => (e.target.value === NEW_ACTOR ? setOpen(true) : onChange(e.target.value))} options={options} placeholder={placeholder} disabled={disabled} aria-label={label} />
      {/* Created from a character, so the new actor is assigned straight back to it — no "Create +". */}
      <ActorModal open={open} onClose={() => setOpen(false)} onSaved={(a) => onChange(a.id)} allowAddAnother={false} saveLabel="Create & assign" />
    </>
  );
}

export function Avatar({ name, lg }: { name?: string | null; lg?: boolean }) {
  return <div className={`avatar ${lg ? "lg" : ""}`}>{initials(name)}</div>;
}

export { tone };
