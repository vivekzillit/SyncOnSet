import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/state/auth";
import { ErrorBox, Field, Input } from "@/components/ui";

const DEMO = [
  ["Admin", "admin@sinkonset.app"], ["Production Mgr", "pm@sinkonset.app"], ["Costume Designer", "designer@sinkonset.app"], ["Supervisor", "supervisor@sinkonset.app"],
  ["Wardrobe Asst", "wardrobe@sinkonset.app"], ["Dresser", "dresser@sinkonset.app"], ["Tailor", "tailor@sinkonset.app"], ["Laundry", "laundry@sinkonset.app"],
  ["Continuity", "continuity@sinkonset.app"], ["Actor", "actor@sinkonset.app"],
];

export default function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState("admin@sinkonset.app");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);


  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      nav(loc.state?.from || "/projects", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (user) return <Navigate to={loc.state?.from || "/projects"} replace />;

  return (
    <div className="login">
      <div className="card login-card">
        <div className="row gap-2 mb-2">
          <div className="brand-mark">SoS</div>
          <div>
            <h1 style={{ fontSize: 20 }}>Sink on Set</h1>
            <div className="subtle">Digital wardrobe & costume management</div>
          </div>
        </div>
        <form onSubmit={submit} className="col mt-3">
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></Field>
          <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
          <ErrorBox error={error} />
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        <div className="mt-3">
          <div className="subtle mb-2">Demo accounts (password: <span className="mono">password123</span>)</div>
          <div className="demo-users">
            {DEMO.map(([label, em]) => (
              <button key={em} type="button" onClick={() => { setEmail(em); setPassword("password123"); }}><b>{label}</b><br /><span className="subtle">{em}</span></button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
