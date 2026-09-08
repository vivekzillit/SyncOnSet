import { useState } from "react";
import { api } from "@/api/client";
import { ErrorBox, Field, Input, Modal, useToast } from "./ui";

/** Self-service password change (POST /auth/change-password). */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (f.next !== f.confirm) return setError(new Error("New passwords do not match"));
    setBusy(true);
    setError(null);
    try {
      await api("/auth/change-password", { body: { currentPassword: f.current, newPassword: f.next } });
      toast.push("Password changed", "ok");
      setF({ current: "", next: "", confirm: "" });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Change password" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !f.current || f.next.length < 8} onClick={submit}>Change password</button></>}>
      <form className="col" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoFocus /></Field>
        <Field label="New password" help="At least 8 characters"><Input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
        <Field label="Confirm new password"><Input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
        <ErrorBox error={error} />
      </form>
    </Modal>
  );
}

/** Admin / PM: set a new password for another user (PATCH /users/:id). */
export function ResetPasswordModal({ user, onClose }: { user: { id: string; name: string } | null; onClose: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/users/${user.id}`, { method: "PATCH", body: { password: pw } });
      toast.push(`Password reset for ${user.name}`, "ok");
      setPw("");
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!user} onClose={onClose} title={user ? `Reset password · ${user.name}` : ""} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || pw.length < 8} onClick={submit}>Set password</button></>}>
      <Field label="New temporary password" help="At least 8 characters. Share it with the person privately and ask them to change it after signing in."><Input type="text" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></Field>
      <ErrorBox error={error} />
    </Modal>
  );
}
