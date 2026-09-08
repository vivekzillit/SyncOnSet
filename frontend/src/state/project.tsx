import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { Project, Role } from "@/api/types";
import { useAuth } from "./auth";

interface ProjectState {
  projectId: string;
  project: Project | null;
  role: Role;
  can: (roles: Role[]) => boolean;
  currency: string;
  isLoading: boolean;
}

const Ctx = createContext<ProjectState | null>(null);

export function ProjectProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ["project", projectId], queryFn: () => api<Project>(`/projects/${projectId}`), enabled: !!projectId });
  const value = useMemo<ProjectState>(() => {
    const role = (user?.role === "ADMIN" ? "ADMIN" : data?.myRole || user?.role || "ACTOR") as Role;
    return { projectId, project: data || null, role, can: (roles) => roles.includes(role), currency: data?.currency || "INR", isLoading };
  }, [projectId, data, user, isLoading]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProject() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProject outside ProjectProvider");
  return v;
}
