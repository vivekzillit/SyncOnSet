/** User-facing label for Project.type: the stored value stays FEATURE | EPISODIC, the UI says Feature / Feature TV series. */
export const projectTypeLabel = (t?: string | null) => (t === "EPISODIC" ? "Feature TV series" : "Feature");
export const humanize = (s?: string | null) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/(^|\s)\S/g, (t) => t.toUpperCase()) : "");

export function fmtDate(d?: string | Date | null, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" }) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(undefined, opts);
}
export const fmtDateLong = (d?: string | Date | null) => fmtDate(d, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
export function fmtTime(d?: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
export const fmtDateTime = (d?: string | Date | null) => (d ? `${fmtDate(d)} ${fmtTime(d)}` : "—");

export function fmtMoney(n?: number | null, currency = "INR") {
  if (n === null || n === undefined) return "—";
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}

export function relativeTime(d: string | Date) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.round(diff / 60000);
  if (Math.abs(m) < 1) return "just now";
  if (Math.abs(m) < 60) return m > 0 ? `${m}m ago` : `in ${-m}m`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return h > 0 ? `${h}h ago` : `in ${-h}h`;
  const dd = Math.round(h / 24);
  return dd > 0 ? `${dd}d ago` : `in ${-dd}d`;
}

/** Local calendar date key (YYYY-MM-DD) for a date/ISO string, in the viewer's timezone. */
export const dateKey = (d: string | Date | null | undefined) => {
  if (!d) return "";
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
export const todayISO = () => dateKey(new Date());
export const toLocalInput = (d?: string | null) => {
  if (!d) return "";
  const x = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
};

/** Status → semantic tone used by Badge / dots. */
export function tone(status?: string | null): "ok" | "info" | "warn" | "danger" | "muted" | "accent" {
  switch (status) {
    case "AVAILABLE": case "READY": case "COMPLETED": case "FITTED": case "PASS": case "SHOT": case "FOUND": case "REPAIRED": case "RETURNED": case "OK":
      return "ok";
    case "ISSUED": case "ON_SET": case "CLEANING": case "RECEIVED": case "DRYING": case "IRONING": case "IN_PROGRESS": case "SHOOTING": case "PICKED_UP": case "INFO": case "SCHEDULED":
      return "info";
    case "ALTERATION": case "ALTERATION_REQUIRED": case "QUALITY_CHECK": case "HIGH": case "WARNING": case "REPAIRING": case "PENDING": case "BOOKED": case "REQUESTED": case "ASSIGNED": case "DUE":
      return "warn";
    case "MISSING": case "DAMAGED": case "URGENT": case "CRITICAL": case "FAIL": case "REJECTED": case "OVERDUE": case "OPEN": case "WRITTEN_OFF":
      return "danger";
    case "LEAD":
      return "accent";
    default:
      return "muted";
  }
}
