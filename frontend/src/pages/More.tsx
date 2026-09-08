import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { KeyRound, Users, BookOpen, Ruler, Scissors, AlertTriangle, SearchX, Store, Wallet, FileBarChart, Tag, UserCog, Settings, Bell, LogOut, FolderKanban } from "lucide-react";
import { useProject } from "@/state/project";
import { useAuth, FINANCE_ROLES, MANAGER_ROLES } from "@/state/auth";
import { humanize } from "@/lib/format";
import { Card, PageHead } from "@/components/ui";
import { ChangePasswordModal } from "@/components/Account";

export default function More() {
  const { projectId, can, project } = useProject();
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [pwOpen, setPwOpen] = useState(false);
  const base = `/p/${projectId}`;
  const items = [
    [`${base}/characters`, <Users size={18} />, "Characters"],
    [`${base}/actors`, <Users size={18} />, "Actors"],
    [`${base}/gallery`, <Users size={18} />, "Gallery"],
    [`${base}/continuity`, <BookOpen size={18} />, "Continuity book"],
    [`${base}/fittings`, <Ruler size={18} />, "Fittings"],
    [`${base}/alterations`, <Scissors size={18} />, "Alterations"],
    [`${base}/damages`, <AlertTriangle size={18} />, "Damage reports"],
    [`${base}/missing`, <SearchX size={18} />, "Missing items"],
    [`${base}/vendors`, <Store size={18} />, "Vendors & Rentals"],
    ...(can(FINANCE_ROLES) ? [[`${base}/budget`, <Wallet size={18} />, "Budget & Expenses"]] : []),
    [`${base}/reports`, <FileBarChart size={18} />, "Reports"],
    [`${base}/labels`, <Tag size={18} />, "QR labels"],
    [`${base}/notifications`, <Bell size={18} />, "Notifications"],
    ...(can(MANAGER_ROLES) ? [[`${base}/team`, <UserCog size={18} />, "Team & roles"], [`${base}/settings`, <Settings size={18} />, "Project settings"]] : []),
    ["/projects", <FolderKanban size={18} />, "Switch project"],
  ] as [string, React.ReactNode, string][];
  return (
    <div>
      <PageHead title="More" sub={<>{project?.name} · {user?.name} ({humanize(user?.role)})</>} />
      <Card pad0>
        <div className="list">
          {items.map(([to, icon, label]) => (
            <Link key={to} to={to} className="item link">{icon}<span className="title grow">{label}</span></Link>
          ))}
          <div className="item link" onClick={() => setPwOpen(true)}><KeyRound size={18} /><span className="title">Change password</span></div>
          <div className="item link" onClick={() => { logout(); nav("/login"); }}><LogOut size={18} /><span className="title">Sign out</span></div>
        </div>
      </Card>
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
