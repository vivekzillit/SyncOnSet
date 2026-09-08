export const TOKEN_KEY = "sos_token";

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

interface Options {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  formData?: FormData;
  raw?: boolean;
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api${path}`, {
    method: opts.method || (opts.body !== undefined || opts.formData ? "POST" : "GET"),
    headers,
    body: opts.formData ? opts.formData : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    setToken(null);
    if (!location.pathname.startsWith("/login")) location.assign("/login");
    throw new ApiError(401, "Session expired");
  }
  if (opts.raw) return res as unknown as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || res.statusText, data?.details);
  return data as T;
}

export const p = (projectId: string, path: string) => `/projects/${projectId}${path}`;

/** URL for an <img> that needs auth (QR codes). */
export function authedUrl(path: string) {
  const token = getToken();
  return `/api${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token || "")}`;
}
