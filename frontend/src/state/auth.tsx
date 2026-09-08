import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "@/api/client";
import type { Meta, ProjectSummary, Role, User } from "@/api/types";

interface AuthState {
  user: User | null;
  projects: ProjectSummary[];
  meta: Meta | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setProjects([]);
      setLoading(false);
      return;
    }
    try {
      const [me, m] = await Promise.all([api<{ user: User; projects: ProjectSummary[] }>("/auth/me"), meta ? Promise.resolve(meta) : api<Meta>("/meta")]);
      setUser(me.user);
      setProjects(me.projects);
      setMeta(m);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [meta]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string; user: User; projects: ProjectSummary[] }>("/auth/login", { body: { email, password } });
    setToken(res.token);
    setUser(res.user);
    setProjects(res.projects);
    if (!meta) setMeta(await api<Meta>("/meta"));
  }, [meta]);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setProjects([]);
  }, []);

  const value = useMemo(() => ({ user, projects, meta, loading, login, logout, refresh }), [user, projects, meta, loading, login, logout, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

/** Role helpers mirroring backend constants. */
export const MANAGER_ROLES: Role[] = ["ADMIN", "PRODUCTION_MANAGER", "COSTUME_DESIGNER", "COSTUME_SUPERVISOR"];
export const FINANCE_ROLES: Role[] = MANAGER_ROLES;
export const OPS_ROLES: Role[] = [...MANAGER_ROLES, "COSTUME_ASSISTANT", "WARDROBE_ASSISTANT", "DRESSER"];
export const CLEANING_ROLES: Role[] = [...OPS_ROLES, "LAUNDRY"];
export const TAILOR_ROLES: Role[] = [...OPS_ROLES, "TAILOR"];
export const CONTINUITY_ROLES: Role[] = [...OPS_ROLES, "CONTINUITY"];
