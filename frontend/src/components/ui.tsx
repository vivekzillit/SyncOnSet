import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useBlocker, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, X, Search } from "lucide-react";
import { humanize, tone } from "@/lib/format";

/* ---------- Badges & dots ---------- */
export function Badge({ status, children, lg, className = "" }: { status?: string | null; children?: ReactNode; lg?: boolean; className?: string }) {
  return <span className={`badge tone-${tone(status)} ${lg ? "lg" : ""} ${className}`}>{children ?? humanize(status)}</span>;
}
export function Dot({ status, pulse }: { status?: string | null; pulse?: boolean }) {
  return <span className={`dot tone-${tone(status)} ${pulse ? "pulse" : ""}`} />;
}

/* ---------- Page chrome ---------- */
/**
 * Back to wherever you came from. Opened straight from a link or a refresh there is no history to step
 * back through, so it falls back to the production's dashboard, or the productions list outside one.
 */
export function BackButton() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const inProject = /^\/p\/[^/]+/.exec(pathname);
  const isRoot = pathname === (inProject ? inProject[0] : "/projects");
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) nav(-1);
    else nav(inProject ? inProject[0] : "/projects");
  };
  return (
    <button type="button" className="iconbtn back" onClick={goBack} aria-label={isRoot ? "Back to productions" : "Go back"} title={isRoot ? "Back to productions" : "Back"}>
      <ArrowLeft size={18} />
    </button>
  );
}

export function PageHead({ title, sub, actions, crumbs, back = true }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; crumbs?: ReactNode; back?: boolean }) {
  return (
    <div className="page-head">
      {back && <BackButton />}
      <div className="grow">
        {crumbs && <div className="crumbs">{crumbs}</div>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", pad0 }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad0?: boolean }) {
  return (
    <section className={`card ${pad0 ? "pad-0" : ""} ${className}`}>
      {(title || actions) && (
        <div className="card-head" style={pad0 ? { padding: "14px 14px 0" } : undefined}>
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone: t, onClick }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string; onClick?: () => void }) {
  return (
    <div className={`stat ${t ? `tone-${t}` : ""} ${onClick ? "clickable" : ""}`} onClick={onClick}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Empty({ icon = "👗", title, hint, action }: { icon?: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon">{icon}</div>
      <div className="bold">{title}</div>
      {hint && <div className="subtle mt-1">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
export const Spinner = () => <div className="spinner" />;
export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as { message?: string; details?: { fieldErrors?: Record<string, string[]> } };
  const fields = e.details?.fieldErrors ? Object.entries(e.details.fieldErrors).map(([k, v]) => `${k}: ${v.join(", ")}`).join(" · ") : "";
  return <div className="errorbox">{e.message || "Something went wrong"}{fields ? ` — ${fields}` : ""}</div>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.key} className={value === t.key ? "active" : ""} onClick={() => onChange(t.key)} type="button">
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ options, value, onChange, all }: { options: { key: T; label: ReactNode }[]; value: T | ""; onChange: (k: T | "") => void; all?: string }) {
  return (
    <div className="chips">
      {all !== undefined && <button type="button" className={`chip ${value === "" ? "active" : ""}`} onClick={() => onChange("")}>{all}</button>}
      {options.map((o) => (
        <button key={o.key} type="button" className={`chip ${value === o.key ? "active" : ""}`} onClick={() => onChange(o.key)}>{o.label}</button>
      ))}
    </div>
  );
}

/* ---------- Forms ---------- */
export function Field({ label, help, children, span2 }: { label?: string; help?: string; children: ReactNode; span2?: boolean }) {
  return (
    <div className={`field ${span2 ? "span-2" : ""}`}>
      {label && <label>{label}</label>}
      {children}
      {help && <span className="help">{help}</span>}
    </div>
  );
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className || ""}`} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`textarea ${props.className || ""}`} />;
}
export function Select({ options, placeholder, humanizeLabels = true, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: (string | { value: string; label: string })[]; placeholder?: string; humanizeLabels?: boolean }) {
  return (
    <select {...props} className={`select ${props.className || ""}`}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? (humanizeLabels ? humanize(o) : o) : o.label;
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>
  );
}
export function SearchBox({ value, onChange, placeholder = "Search…", autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div className="search">
      <Search size={16} color="var(--text-3)" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
      {value && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange("")}><X size={14} /></button>}
    </div>
  );
}

/* ---------- Discard confirmation ---------- */
/**
 * One "Discard changes?" dialog for the whole app. Anything that throws away unsaved input (a modal's
 * Cancel / ✕ / Esc / backdrop, an inline row's Cancel, leaving the production wizard) asks through this.
 */
type DiscardAsk = { title: string; message: string; confirm: string; resolve: (ok: boolean) => void };
let showDiscard: ((ask: DiscardAsk) => void) | null = null;
let discardOpen = false;
export function confirmDiscard(message = "You have unsaved changes. Discard them?", title = "Discard changes?", confirm = "Discard"): Promise<boolean> {
  if (!showDiscard) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => showDiscard!({ title, message, confirm, resolve }));
}
/** Every Cancel asks before closing a form: "Discard changes?" once something was changed, otherwise "Close without saving?". */
export const discardIfDirty = (dirty: boolean, message?: string) => (dirty ? confirmDiscard(message) : confirmDiscard("Nothing will be saved.", "Close without saving?", "Close"));

/**
 * Pages and modals holding unsaved input register here while they do. One <LeaveGuard> then asks before any
 * in-app navigation (links, tabs, Back) leaves the page, and closing or reloading the tab gets the browser's own prompt.
 */
const unsaved = new Map<symbol, string | undefined>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => { if (unsaved.size) { e.preventDefault(); e.returnValue = ""; } });
}
export function useUnsavedGuard(dirty: boolean, message?: string) {
  useEffect(() => {
    if (!dirty) return;
    const key = Symbol("unsaved");
    unsaved.set(key, message);
    return () => { unsaved.delete(key); };
  }, [dirty, message]);
}
/** Rendered once inside the router. Only a change of page counts; filters kept in the query string never ask. */
export function LeaveGuard() {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => unsaved.size > 0 && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const message = [...unsaved.values()].find(Boolean) ?? "You have unsaved changes. Leave this page and discard them?";
    confirmDiscard(message).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker]);
  return null;
}

function DiscardHost() {
  const [ask, setAsk] = useState<DiscardAsk | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { showDiscard = setAsk; return () => { showDiscard = null; }; }, []);
  const answer = useCallback((ok: boolean) => { setAsk((a) => { a?.resolve(ok); return null; }); }, []);
  useEffect(() => {
    discardOpen = !!ask;
    if (!ask) return;
    keepRef.current?.focus();
    // Capture phase so Esc answers this dialog and never also closes the modal underneath.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); answer(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ask, answer]);
  if (!ask) return null;
  return (
    <div className="modal-bg discard-bg" onMouseDown={(e) => e.target === e.currentTarget && answer(false)}>
      <div className="modal discard" role="alertdialog" aria-modal aria-labelledby="discard-title">
        <h2 id="discard-title">{ask.title}</h2>
        <p className="subtle mt-1">{ask.message}</p>
        <div className="modal-foot">
          <button ref={keepRef} type="button" className="btn" onClick={() => answer(false)}>Keep editing</button>
          <button type="button" className="btn btn-danger" onClick={() => answer(true)}>{ask.confirm}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Modal ---------- */
/**
 * A modal holding a form always asks before closing without saving — "Discard changes?" once anything was
 * typed, picked or ticked, "Close without saving?" otherwise. The ✕, Esc, a backdrop click and the footer's
 * Cancel button all go through it. A modal with no fields just closes. Saving closes it through the caller's
 * own state, which never asks. Pass `dirty` to override the change detection.
 */
export function Modal({ open, onClose, title, children, footer, wide, dirty }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; dirty?: boolean }) {
  const [touched, setTouched] = useState(false);
  const bypass = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const hasFields = () => !!bodyRef.current?.querySelector("input:not([type=hidden]):not([hidden]), select, textarea");
  useEffect(() => { if (!open) setTouched(false); }, [open]);
  const isDirty = () => dirty ?? touched;
  useUnsavedGuard(open && isDirty());
  const requestClose = useCallback(async () => {
    if (!hasFields() || await discardIfDirty(dirty ?? touched)) onClose();
  }, [dirty, touched, onClose]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !discardOpen && requestClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, requestClose]);
  if (!open) return null;
  const markTouched = () => { if (!touched) setTouched(true); };
  /** A footer Cancel keeps its own handler (some reset state first); it is only held back until the discard is confirmed. */
  const guardCancel = (e: React.MouseEvent) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn || bypass.current || !hasFields() || !(btn.dataset.dismiss != null || btn.textContent?.trim() === "Cancel")) return;
    e.preventDefault(); e.stopPropagation();
    discardIfDirty(isDirty()).then((ok) => { if (!ok) return; bypass.current = true; btn.click(); bypass.current = false; });
  };
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="iconbtn" onClick={requestClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div ref={bodyRef} className="modal-body" onInput={markTouched} onChange={markTouched}>{children}</div>
        {footer && <div className="modal-foot" onClickCapture={guardCancel}>{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Toasts ---------- */
interface Toast { id: number; text: string; kind?: "ok" | "danger" | "default" }
const ToastCtx = createContext<{ push: (text: string, kind?: Toast["kind"]) => void } | null>(null);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "default") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <DiscardHost />
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind || ""}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error("useToast outside ToastProvider");
  return v;
}

/** Button that asks for confirmation on first click. */
export function ConfirmButton({ onConfirm, children, className = "btn", confirmText = "Confirm?", ...rest }: { onConfirm: () => void; children: ReactNode; className?: string; confirmText?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "className" | "children" | "type">) {
  const [arm, setArm] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(false), 3000);
    return () => clearTimeout(t);
  }, [arm]);
  return (
    <button type="button" {...rest} className={`${className} ${arm ? "btn-danger" : ""}`} onClick={() => (arm ? (setArm(false), onConfirm()) : setArm(true))}>
      {arm ? confirmText : children}
    </button>
  );
}

export const initials = (name?: string | null) => (name || "?").split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
