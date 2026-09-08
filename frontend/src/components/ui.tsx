import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { X, Search } from "lucide-react";
import { humanize, tone } from "@/lib/format";

/* ---------- Badges & dots ---------- */
export function Badge({ status, children, lg, className = "" }: { status?: string | null; children?: ReactNode; lg?: boolean; className?: string }) {
  return <span className={`badge tone-${tone(status)} ${lg ? "lg" : ""} ${className}`}>{children ?? humanize(status)}</span>;
}
export function Dot({ status, pulse }: { status?: string | null; pulse?: boolean }) {
  return <span className={`dot tone-${tone(status)} ${pulse ? "pulse" : ""}`} />;
}

/* ---------- Page chrome ---------- */
export function PageHead({ title, sub, actions, crumbs }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; crumbs?: ReactNode }) {
  return (
    <div className="page-head">
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

/* ---------- Modal ---------- */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
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
