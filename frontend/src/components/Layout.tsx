import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell, ChevronDown, ChevronsUpDown, Settings, LayoutDashboard, Clapperboard, Shirt, ScanLine, Droplets, MoreHorizontal, LogOut, KeyRound, UserCog, Images } from "lucide-react";
import { api, p } from "@/api/client";
import { useAuth, FINANCE_ROLES, MANAGER_ROLES } from "@/state/auth";
import { ProjectProvider, useProject } from "@/state/project";
import { humanize, projectTypeLabel } from "@/lib/format";
import type { Dashboard } from "@/api/types";
import { ErrorBoundary } from "./ErrorBoundary";
import { ChangePasswordModal } from "./Account";
import { GlobalSearch } from "./GlobalSearch";

export function ProjectShell() {
  const { projectId = "" } = useParams();
  return (
    <ProjectProvider projectId={projectId}>
      <Shell />
    </ProjectProvider>
  );
}

interface MenuItem { to: string; label: string; count?: number; danger?: boolean; end?: boolean }
interface Tab { key: string; label: string; to?: string; items?: MenuItem[]; end?: boolean }

function TabMenu({ tab, activePath }: { tab: Tab; activePath: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, []);
  const active = tab.items!.some((i) => (i.end ? activePath === i.to : activePath.startsWith(i.to)));
  const total = tab.items!.reduce((n, i) => n + (i.count || 0), 0);
  return (
    <div ref={ref} className={`tab has-menu ${active ? "active" : ""}`}>
      <button type="button" onClick={() => setOpen((v) => !v)}>{tab.label} {total ? <span className={`count ${tab.items!.some((i) => i.danger && i.count) ? "danger" : ""}`}>{total}</span> : null}<ChevronDown size={14} /></button>
      {open && (
        <div className="tab-menu card">
          {tab.items!.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} onClick={() => setOpen(false)} className={({ isActive }) => (isActive ? "active" : "")}>
              <span className="grow">{i.label}</span>{i.count ? <span className={`count ${i.danger ? "danger" : ""}`}>{i.count}</span> : null}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { projectId, project, can } = useProject();
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [pwOpen, setPwOpen] = useState(false);
  const [gear, setGear] = useState(false);
  const gearRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (gearRef.current && !gearRef.current.contains(e.target as Node)) setGear(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setGear(false); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, []);
  const { data: notif } = useQuery({ queryKey: ["notifications", projectId, "unread"], queryFn: () => api<{ unread: number }>(p(projectId, "/notifications?unread=true")), refetchInterval: 30000 });
  const { data: dash } = useQuery({ queryKey: ["dashboard", projectId], queryFn: () => api<Dashboard>(p(projectId, "/dashboard")), refetchInterval: 60000 });
  const c = dash?.counts;
  const base = `/p/${projectId}`;

  const tabs: Tab[] = [
    { key: "dash", label: "Dashboard", to: base, end: true },
    { key: "scenes", label: "Scenes", to: `${base}/scenes` },
    { key: "characters", label: "Characters", items: [{ to: `${base}/characters`, label: "Characters", end: true }, { to: `${base}/actors`, label: "Actors" }] },
    { key: "costumes", label: "Costumes", items: [{ to: `${base}/costumes`, label: "Costumes", count: c?.costumes }, { to: `${base}/scan`, label: "Scan QR" }, { to: `${base}/cleaning`, label: "Sink / Cleaning", count: c?.cleaning }, { to: `${base}/fittings`, label: "Fittings", count: c?.fittingsToday }, { to: `${base}/alterations`, label: "Alterations", count: c?.alteration }, { to: `${base}/damages`, label: "Damage", count: c?.damaged, danger: true }, { to: `${base}/missing`, label: "Missing", count: c?.missing, danger: true }, { to: `${base}/labels`, label: "QR Labels" }, { to: `${base}/vendors`, label: "Vendors & Rentals", count: c?.rentalsDue, danger: true }] },
    { key: "continuity", label: "Continuity", items: [{ to: `${base}/continuity`, label: "On Set", end: true }, { to: `${base}/continuity/book`, label: "Book" }] },
    { key: "reports", label: "Reports", items: [{ to: `${base}/reports`, label: "Reports" }, ...(can(FINANCE_ROLES) ? [{ to: `${base}/budget`, label: "Budget & Expenses" }] : [])] },
    { key: "gallery", label: "Gallery", to: `${base}/gallery` },
  ];

  return (
    <div className="shell-top">
      <header className="topnav">
        <div className="topnav-row1">
          <Link to="/projects" className="row gap-2" style={{ minWidth: 0 }} title="Switch production">
            <div className="brand-mark">C&amp;S</div>
            <div className="truncate hide-mobile">
              <div className="bold truncate" style={{ lineHeight: 1.1 }}>{project?.name || "…"}</div>
              <div className="tiny subtle">{project ? `${projectTypeLabel(project.type)} · Day ${project.shootingDay}${project.currentLocation ? ` · ${project.currentLocation}` : ""}` : ""}</div>
            </div>
            <div className="truncate bold small show-mobile">{project?.name}</div>
            <ChevronsUpDown size={14} color="var(--text-3)" className="hide-mobile" />
          </Link>
          <div className="grow hide-mobile" style={{ maxWidth: 420 }}><GlobalSearch /></div>
          <div className="grow show-mobile" />
          <Link to={`${base}/notifications`} className="iconbtn" aria-label="Notifications"><Bell size={18} />{notif?.unread ? <span className="pip">{notif.unread > 99 ? "99+" : notif.unread}</span> : null}</Link>
          <div ref={gearRef} className="hide-mobile" style={{ position: "relative" }}>
            <button type="button" className="iconbtn" aria-label="Settings" onClick={() => setGear((v) => !v)}><Settings size={18} /></button>
            {gear && (
              <div className="tab-menu card" style={{ right: 0, left: "auto" }}>
                <div className="subtle tiny" style={{ padding: "4px 10px" }}>{user?.name} · {humanize(user?.role)}</div>
                {can(MANAGER_ROLES) && <Link to={`${base}/team`} onClick={() => setGear(false)}><UserCog size={15} /> Team & roles</Link>}
                {can(MANAGER_ROLES) && <Link to={`${base}/settings`} onClick={() => setGear(false)}><Settings size={15} /> Project settings</Link>}
                <button type="button" onClick={() => { setGear(false); setPwOpen(true); }}><KeyRound size={15} /> Change password</button>
                <button type="button" onClick={() => { logout(); nav("/login"); }}><LogOut size={15} /> Sign out</button>
              </div>
            )}
          </div>
        </div>
        <div className="topnav-row2 hide-mobile">
          <span className="dept-chip"><span className="dot tone-accent" /> Costumes</span>
          {tabs.map((t) => t.items ? <TabMenu key={t.key} tab={t} activePath={loc.pathname} /> : (
            <NavLink key={t.key} to={t.to!} end={t.end} className={({ isActive }) => `tab ${isActive ? "active" : ""}`}>{t.label}</NavLink>
          ))}
        </div>
      </header>

      <main className="content content-top">
        <ErrorBoundary resetKey={loc.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />

      <nav className="bottom-nav">
        <NavLink to={base} end><LayoutDashboard size={20} /><span>Home</span></NavLink>
        <NavLink to={`${base}/scenes`}><Clapperboard size={20} /><span>Scenes</span></NavLink>
        <NavLink to={`${base}/costumes`}><Shirt size={20} /><span>Costumes</span></NavLink>
        <NavLink to={`${base}/scan`} className="scan"><div className="scan-bubble"><ScanLine size={22} /></div><span>Scan</span></NavLink>
        <NavLink to={`${base}/cleaning`}><Droplets size={20} /><span>Sink</span></NavLink>
        <NavLink to={`${base}/more`}><MoreHorizontal size={20} /><span>More</span></NavLink>
      </nav>
      <span hidden><Images size={1} /></span>
    </div>
  );
}
