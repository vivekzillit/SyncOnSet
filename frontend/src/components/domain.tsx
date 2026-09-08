import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, Plus, X } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { CONTINUITY_ROLES } from "@/state/auth";
import { fmtDateTime, humanize, tone } from "@/lib/format";
import type { Costume, Photo, TimelineEvent } from "@/api/types";
import { Badge, Dot, Empty, Modal, SearchBox, Select, Spinner, initials, useToast } from "./ui";

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
export function PhotoGrid({ photos, entityType, entityId, kinds, compact }: { photos: Photo[]; entityType: string; entityId: string; kinds?: string[]; compact?: boolean }) {
  const { projectId, can, } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState((kinds || ["FRONT", "SIDE", "BACK", "CLOSEUP", "DETAIL", "STAIN", "OTHER"])[0]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Photo | null>(null);
  const editable = can(CONTINUITY_ROLES);

  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("entityType", entityType);
        fd.append("entityId", entityId);
        fd.append("kind", kind);
        await api(p(projectId, "/photos"), { formData: fd });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.push("Photo uploaded", "ok");
    },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  const del = useMutation({ mutationFn: (id: string) => api(p(projectId, `/photos/${id}`), { method: "DELETE" }), onSuccess: () => qc.invalidateQueries() });

  return (
    <div>
      {editable && (
        <div className="row gap-2 mb-2 wrap">
          <Select value={kind} onChange={(e) => setKind(e.target.value)} options={kinds || ["FRONT", "SIDE", "BACK", "CLOSEUP", "DETAIL", "STAIN", "OTHER"]} style={{ width: "auto" }} />
          <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
            <Camera size={15} /> {upload.isPending ? "Uploading…" : "Add photo"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => e.target.files?.length && upload.mutate(e.target.files)} />
        </div>
      )}
      {photos.length === 0 ? (
        <div className="subtle">No photos yet.</div>
      ) : (
        <div className="photos" style={compact ? { gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))" } : undefined}>
          {photos.map((ph) => (
            <div key={ph.id} className="photo" onClick={() => setPreview(ph)}>
              <img src={ph.url} alt={ph.caption || ph.kind} loading="lazy" />
              <span className="kind">{ph.kind}</span>
              {editable && (
                <button type="button" className="del" onClick={(e) => { e.stopPropagation(); del.mutate(ph.id); }} aria-label="Delete photo"><X size={12} /></button>
              )}
            </div>
          ))}
        </div>
      )}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview ? `${humanize(preview.kind)} · ${fmtDateTime(preview.createdAt)}` : ""} wide>
        {preview && <img src={preview.url} alt="" style={{ width: "100%", borderRadius: 10 }} />}
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
export function CostumeRow({ c, extra, onClick, end }: { c: Costume; extra?: ReactNode; onClick?: () => void; end?: ReactNode }) {
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
        <Badge status={c.status} />
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

export function Avatar({ name, lg }: { name?: string | null; lg?: boolean }) {
  return <div className={`avatar ${lg ? "lg" : ""}`}>{initials(name)}</div>;
}

export { tone };
