import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useParams, Link } from "react-router-dom";
import { ErrorBoundary } from "./ErrorBoundary";
import { ChangePasswordModal } from "./Account";
import { useQuery } from "@tanstack/react-query";
import { Bell, KeyRound, FileText, LayoutDashboard, Clapperboard, Users, Shirt, ScanLine, Droplets, Ruler, BookOpen, Scissors, AlertTriangle, SearchX, Store, Wallet, FileBarChart, Tag, UserCog, Settings, MoreHorizontal, LogOut, ChevronsUpDown } from "lucide-react";
import { api, p } from "@/api/client";
import { useAuth, FINANCE_ROLES, MANAGER_ROLES } from "@/state/auth";
import { ProjectProvider, useProject } from "@/state/project";
import { humanize } from "@/lib/format";
import type { Dashboard } from "@/api/types";

export function ProjectShell() {
  const { projectId = "" } = useParams();
  return (
    <ProjectProvider projectId={projectId}>
      <Shell />
    </ProjectProvider>
  );
}

function Shell() {
  const { projectId, project, can } = useProject();
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [pwOpen, setPwOpen] = useState(false);
  const { data: notif } = useQuery({ queryKey: ["notifications", projectId, "unread"], queryFn: () => api<{ unread: number }>(p(projectId, "/notifications?unread=true")), refetchInterval: 30000 });
  const { data: dash } = useQuery({ queryKey: ["dashboard", projectId], queryFn: () => api<Dashboard>(p(projectId, "/dashboard")), refetchInterval: 60000 });
  const c = dash?.counts;
  const base = `/p/${projectId}`;
  const link = (to: string, icon: React.ReactNode, label: string, count?: number, danger?: boolean, end?: boolean) => (
    <NavLink to={to} end={end}>
      {icon}
      <span>{label}</span>
      {count ? <span className={`count ${danger ? "danger" : ""}`}>{count}</span> : null}
    </NavLink>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">C&amp;S</div>
          <div>
            <div className="brand-name">Costumes &amp; Set</div>
            <div className="brand-sub">Wardrobe & costume ops</div>
          </div>
        </div>
        <div className="project-chip" onClick={() => nav("/projects")} title="Switch project">
          <div className="grow truncate">
            <b className="truncate">{project?.name || "…"}</b>
            <span>{project ? `Day ${project.shootingDay} · ${project.currentLocation || humanize(project.status)}` : ""}</span>
          </div>
          <ChevronsUpDown size={16} color="#9a9da6" />
        </div>
        <nav className="nav">
          {link(base, <LayoutDashboard size={17} />, "Dashboard", undefined, false, true)}
          {link(`${base}/scan`, <ScanLine size={17} />, "Scan QR")}
          <div className="nav-group">Breakdown</div>
          {link(`${base}/scenes`, <Clapperboard size={17} />, "Scenes", c?.todaysScenes)}
          {link(`${base}/characters`, <Users size={17} />, "Characters & Actors")}
          {link(`${base}/sides`, <FileText size={17} />, "Sides")}
          {link(`${base}/continuity`, <BookOpen size={17} />, "Continuity book")}
          <div className="nav-group">Wardrobe</div>
          {link(`${base}/costumes`, <Shirt size={17} />, "Costumes", c?.costumes)}
          {link(`${base}/cleaning`, <Droplets size={17} />, "Sink / Cleaning", c?.cleaning)}
          {link(`${base}/fittings`, <Ruler size={17} />, "Fittings", c?.fittingsToday)}
          {link(`${base}/alterations`, <Scissors size={17} />, "Alterations", c?.alteration)}
          {link(`${base}/damages`, <AlertTriangle size={17} />, "Damage", c?.damaged, true)}
          {link(`${base}/missing`, <SearchX size={17} />, "Missing", c?.missing, true)}
          <div className="nav-group">Production</div>
          {link(`${base}/vendors`, <Store size={17} />, "Vendors & Rentals", c?.rentalsDue, true)}
          {can(FINANCE_ROLES) && link(`${base}/budget`, <Wallet size={17} />, "Budget & Expenses")}
          {link(`${base}/reports`, <FileBarChart size={17} />, "Reports")}
          {link(`${base}/labels`, <Tag size={17} />, "QR Labels")}
          {can(MANAGER_ROLES) && link(`${base}/team`, <UserCog size={17} />, "Team & Roles")}
          {can(MANAGER_ROLES) && link(`${base}/settings`, <Settings size={17} />, "Project settings")}
        </nav>
        <div className="sidebar-foot">
          <div className="row between">
            <div className="grow truncate">
              <div className="bold truncate">{user?.name}</div>
              <div className="tiny" style={{ color: "#9a9da6" }}>{humanize(user?.role)}</div>
            </div>
            <button className="btn btn-ghost btn-sm" style={{ color: "#c9cbd2" }} onClick={() => setPwOpen(true)} title="Change password"><KeyRound size={15} /></button>
            <button className="btn btn-ghost btn-sm" style={{ color: "#c9cbd2" }} onClick={() => { logout(); nav("/login"); }} title="Sign out"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <Link to="/projects" className="show-mobile row gap-1" style={{ minWidth: 0 }}>
            <div className="brand-mark" style={{ width: 30, height: 30, fontSize: 11 }}>C&amp;S</div>
            <div className="truncate bold small">{project?.name}</div>
          </Link>
          <div className="grow hide-mobile subtle">
            {project ? <>Shooting day <b>{project.shootingDay}</b> · {project.currentLocation || humanize(project.status)}</> : null}
          </div>
          <div className="grow show-mobile" />
          <Link to={`${base}/notifications`} className="iconbtn" aria-label="Notifications">
            <Bell size={18} />
            {notif?.unread ? <span className="pip">{notif.unread > 99 ? "99+" : notif.unread}</span> : null}
          </Link>
        </header>
        <main className="content">
          <ErrorBoundary resetKey={loc.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />

      <nav className="bottom-nav">
        <NavLink to={base} end><LayoutDashboard size={20} /><span>Home</span></NavLink>
        <NavLink to={`${base}/scenes`}><Clapperboard size={20} /><span>Scenes</span></NavLink>
        <NavLink to={`${base}/costumes`}><Shirt size={20} /><span>Costumes</span></NavLink>
        <NavLink to={`${base}/scan`} className="scan"><div className="scan-bubble"><ScanLine size={22} /></div><span>Scan</span></NavLink>
        <NavLink to={`${base}/cleaning`}><Droplets size={20} /><span>Sink</span></NavLink>
        <NavLink to={`${base}/more`}><MoreHorizontal size={20} /><span>More</span></NavLink>
      </nav>
    </div>
  );
}
