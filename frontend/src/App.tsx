import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/state/auth";
import { Spinner } from "@/components/ui";
import { ProjectShell } from "@/components/Layout";
import Login from "@/pages/Login";
import Projects from "@/pages/Projects";
import Dashboard from "@/pages/Dashboard";
import Scenes from "@/pages/Scenes";
import SceneDetail from "@/pages/SceneDetail";
import Characters from "@/pages/Characters";
import CharacterDetail from "@/pages/CharacterDetail";
import ChangeDetail from "@/pages/ChangeDetail";
import Costumes from "@/pages/Costumes";
import CostumeDetail from "@/pages/CostumeDetail";
import Scan from "@/pages/Scan";
import Cleaning from "@/pages/Cleaning";
import CleaningDetail from "@/pages/CleaningDetail";
import Fittings from "@/pages/Fittings";
import FittingDetail from "@/pages/FittingDetail";
import ContinuityOnSet, { ContinuityBook } from "@/pages/Continuity";
import Alterations from "@/pages/Alterations";
import Damages from "@/pages/Damages";
import Missing from "@/pages/Missing";
import Vendors from "@/pages/Vendors";
import Budget from "@/pages/Budget";
import Reports from "@/pages/Reports";
import Labels from "@/pages/Labels";
import Notifications from "@/pages/Notifications";
import Team from "@/pages/Team";
import ProjectSettings from "@/pages/ProjectSettings";
import More from "@/pages/More";
import Sides from "@/pages/Sides";
import Actors from "@/pages/Actors";
import Gallery from "@/pages/Gallery";
import ProductionWizard from "@/pages/ProductionWizard";

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/projects" element={<RequireAuth><Projects /></RequireAuth>} />
      <Route path="/projects/new" element={<RequireAuth><ProductionWizard /></RequireAuth>} />
      <Route path="/p/:projectId" element={<RequireAuth><ProjectShell /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="scan" element={<Scan />} />
        <Route path="scenes" element={<Scenes />} />
        <Route path="scenes/:id" element={<SceneDetail />} />
        <Route path="sides" element={<Sides />} />
        <Route path="characters" element={<Characters />} />
        <Route path="characters/:id" element={<CharacterDetail />} />
        <Route path="actors" element={<Actors />} />
        <Route path="gallery" element={<Gallery />} />
        <Route path="changes/:id" element={<ChangeDetail />} />
        <Route path="costumes" element={<Costumes />} />
        <Route path="costumes/:id" element={<CostumeDetail />} />
        <Route path="cleaning" element={<Cleaning />} />
        <Route path="cleaning/:id" element={<CleaningDetail />} />
        <Route path="fittings" element={<Fittings />} />
        <Route path="fittings/:id" element={<FittingDetail />} />
        <Route path="continuity" element={<ContinuityOnSet />} />
        <Route path="continuity/book" element={<ContinuityBook />} />
        <Route path="alterations" element={<Alterations />} />
        <Route path="damages" element={<Damages />} />
        <Route path="missing" element={<Missing />} />
        <Route path="vendors" element={<Vendors />} />
        <Route path="budget" element={<Budget />} />
        <Route path="reports" element={<Reports />} />
        <Route path="labels" element={<Labels />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="team" element={<Team />} />
        <Route path="settings" element={<ProjectSettings />} />
        <Route path="more" element={<More />} />
      </Route>
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
