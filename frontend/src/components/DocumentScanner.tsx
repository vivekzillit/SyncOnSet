import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera, ScanLine, X } from "lucide-react";
import { ErrorBox, Modal } from "./ui";

type Mode = "DOCUMENT" | "COLOR";
interface Page { blob: Blob; url: string }

/** How a page looks before it is cleaned up for real on Attach, so the preview matches the file. */
const PREVIEW_FILTER: Record<Mode, string> = { DOCUMENT: "grayscale(1) contrast(1.6) brightness(1.1)", COLOR: "contrast(1.2) saturate(1.1)" };

/**
 * Stretch the page's levels so paper reads white and ink reads black: the darkest and lightest 2% are clipped,
 * the rest spread across the full range. Document mode also drops the colour, the way a flatbed scan would.
 */
function enhance(ctx: CanvasRenderingContext2D, w: number, h: number, mode: Mode) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++;
  const total = w * h;
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255 && (acc += hist[lo]) < total * 0.02; lo++);
  acc = 0;
  for (; hi > 0 && (acc += hist[hi]) < total * 0.02; hi--);
  const range = Math.max(1, hi - lo);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = ((v - lo) * 255) / range;
  for (let i = 0; i < d.length; i += 4) {
    if (mode === "DOCUMENT") {
      const g = lut[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0];
      d[i] = d[i + 1] = d[i + 2] = g;
    } else {
      d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
    }
  }
  ctx.putImageData(img, 0, 0);
}

async function toScanFile(blob: Blob, mode: Mode, name: string): Promise<File> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  enhance(ctx, canvas.width, canvas.height, mode);
  const out = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not save the scan"))), "image/jpeg", 0.9));
  return new File([out], name, { type: "image/jpeg", lastModified: Date.now() });
}

/**
 * Scan paper — a receipt, a care label, a sketch, a call sheet — straight into the record, one or more pages at a time.
 * The camera runs inside the page; where it can't (no permission, an older browser) the phone's own camera is offered.
 */
export function ScanModal({ open, onClose, onScans }: { open: boolean; onClose: () => void; onScans: (files: File[]) => void | Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [mode, setMode] = useState<Mode>("DOCUMENT");
  const [camError, setCamError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCamError(null); setReady(false); setError(null);
    if (!navigator.mediaDevices?.getUserMedia) { setCamError("This browser can't run the camera here."); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); }
      })
      .catch((e: Error) => !cancelled && setCamError(e.name === "NotAllowedError" ? "Camera access was turned down." : "No camera could be opened."));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  // Pages are thrown away with the dialog; their preview URLs go with them.
  useEffect(() => { if (!open) setPages((prev) => { prev.forEach((pg) => URL.revokeObjectURL(pg.url)); return []; }); }, [open]);

  const addBlob = (blob: Blob) => setPages((prev) => [...prev, { blob, url: URL.createObjectURL(blob) }]);

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => b && addBlob(b), "image/jpeg", 0.95);
    setFlash(true); setTimeout(() => setFlash(false), 120);
  };
  const pickFallback = (e: ChangeEvent<HTMLInputElement>) => { Array.from(e.target.files || []).forEach(addBlob); e.target.value = ""; };
  const remove = (i: number) => setPages((prev) => { URL.revokeObjectURL(prev[i].url); return prev.filter((_, j) => j !== i); });

  const attach = async () => {
    setBusy(true); setError(null);
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");
      const files = await Promise.all(pages.map((pg, i) => toScanFile(pg.blob, mode, `Scan ${stamp}${pages.length > 1 ? ` p${i + 1}` : ""}.jpg`)));
      await onScans(files);
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={<span className="row gap-1"><ScanLine size={18} /> Scan document</span>} wide
      footer={<>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={attach} disabled={!pages.length || busy}>{busy ? "Saving…" : `Attach ${pages.length || ""} page${pages.length === 1 ? "" : "s"}`}</button>
      </>}>
      <div className="col gap-2">
        {camError ? (
          <div className="card flat center" style={{ padding: 24 }}>
            <div className="subtle mb-2">{camError}</div>
            <button type="button" className="btn" onClick={() => fallbackRef.current?.click()}><Camera size={15} /> Use the phone camera</button>
          </div>
        ) : (
          <div style={{ position: "relative", background: "#000", borderRadius: 10, overflow: "hidden" }}>
            <video ref={videoRef} playsInline muted onLoadedMetadata={() => setReady(true)} style={{ width: "100%", maxHeight: "55vh", display: "block", objectFit: "contain", filter: PREVIEW_FILTER[mode] }} />
            {/* A page-shaped guide so the paper is framed square-on and fills the shot. */}
            <div aria-hidden style={{ position: "absolute", inset: "6% 12%", border: "2px dashed rgba(255,255,255,.7)", borderRadius: 8, pointerEvents: "none" }} />
            {flash && <div aria-hidden style={{ position: "absolute", inset: 0, background: "#fff", opacity: 0.7 }} />}
            <button type="button" className="btn btn-primary" onClick={capture} disabled={!ready} style={{ position: "absolute", left: "50%", bottom: 14, transform: "translateX(-50%)" }}>
              <ScanLine size={15} /> {ready ? "Capture page" : "Starting camera…"}
            </button>
          </div>
        )}
        <input ref={fallbackRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={pickFallback} />
        <div className="row between wrap gap-2">
          <div className="row gap-1">
            {(["DOCUMENT", "COLOR"] as Mode[]).map((m) => (
              <button key={m} type="button" className={`btn btn-sm ${mode === m ? "btn-primary" : ""}`} onClick={() => setMode(m)}>{m === "DOCUMENT" ? "Black & white" : "Colour"}</button>
            ))}
          </div>
          <div className="subtle tiny">{pages.length ? `${pages.length} page${pages.length === 1 ? "" : "s"} scanned` : "Hold the page flat inside the frame"}</div>
        </div>
        <ErrorBox error={error} />
        {pages.length > 0 && (
          <div className="photos" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))" }}>
            {pages.map((pg, i) => (
              <div key={pg.url} className="photo" title={`Page ${i + 1}`}>
                <img src={pg.url} alt={`Page ${i + 1}`} style={{ filter: PREVIEW_FILTER[mode] }} />
                <span className="kind">p{i + 1}</span>
                <button type="button" className="del" disabled={busy} onClick={() => remove(i)} aria-label={`Remove page ${i + 1}`}><X size={12} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** The Scan button that sits beside Photo / Video / Gallery wherever media can be attached. */
export function ScanButton({ onScans, disabled, iconSize = 15 }: { onScans: (files: File[]) => void | Promise<void>; disabled?: boolean; iconSize?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => setOpen(true)} title="Scan a document with the camera"><ScanLine size={iconSize} /> Scan</button>
      <ScanModal open={open} onClose={() => setOpen(false)} onScans={onScans} />
    </>
  );
}
