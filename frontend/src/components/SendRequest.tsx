import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Mail, Plus, Send, Share2, Users } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { humanize } from "@/lib/format";
import type { Vendor } from "@/api/types";
import { ErrorBox, Field, Input, Modal, SearchBox, Textarea, useToast } from "@/components/ui";

export interface ExternalContact { id: string; name: string; company?: string | null; role?: string | null; email?: string | null; phone?: string | null }
interface Member { userId: string; role: string; user: { id: string; name: string; email: string } }
interface SendResult { notified: number; skippedSelf?: boolean; offApp: { kind: "VENDOR" | "CONTACT"; id: string; name: string; email?: string | null; phone?: string | null }[] }

type Group = "crew" | "vendors" | "contacts";
const GROUPS: { key: Group; label: string }[] = [
  { key: "crew", label: "Crew" },
  { key: "vendors", label: "Vendors" },
  { key: "contacts", label: "External" },
];

/** A row of tick boxes, one per possible recipient, filtered by the search above it. */
function Rows({ items, picked, onPick }: { items: { id: string; name: string; sub?: string }[]; picked: Set<string>; onPick: (id: string) => void }) {
  if (!items.length) return <div className="subtle" style={{ padding: "8px 2px" }}>Nobody here yet.</div>;
  return (
    <div className="list card flat pad-0" style={{ maxHeight: 220, overflowY: "auto" }}>
      {items.map((i) => (
        <label key={i.id} className="item" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={picked.has(i.id)} onChange={() => onPick(i.id)} aria-label={`Send to ${i.name}`} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="title small">{i.name}</div>
            {i.sub && <div className="meta">{i.sub}</div>}
          </div>
        </label>
      ))}
    </div>
  );
}

/** Name and reach somebody the production deals with but who never signs in. */
function NewContactModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: ExternalContact) => void }) {
  const { projectId } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: "", company: "", role: "", email: "", phone: "" });
  const create = useMutation({
    mutationFn: () => api<ExternalContact>(p(projectId, "/contacts"), { body: { name: f.name.trim(), company: f.company.trim() || null, role: f.role.trim() || null, email: f.email.trim() || null, phone: f.phone.trim() || null } }),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ["contacts", projectId] }); toast.push(`${c.name} added`, "ok"); onCreated(c); setF({ name: "", company: "", role: "", email: "", phone: "" }); onClose(); },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  return (
    <Modal open={open} onClose={onClose} title="New contact"
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!f.name.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Adding…" : "Add"}</button></>}>
      <div className="form-grid">
        <Field label="Name" span2><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ramesh Tailor" autoFocus /></Field>
        <Field label="Company"><Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} placeholder="Raj Tailors" /></Field>
        <Field label="What they do"><Input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="Tailor" /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91…" /></Field>
      </div>
      <ErrorBox error={create.error} />
    </Modal>
  );
}

/** Name a hire company the production rents from. */
function NewVendorModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (v: Vendor) => void }) {
  const { projectId } = useProject();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: "", contactName: "", email: "", phone: "" });
  const create = useMutation({
    mutationFn: () => api<Vendor>(p(projectId, "/vendors"), { body: { name: f.name.trim(), contactName: f.contactName.trim() || null, email: f.email.trim() || null, phone: f.phone.trim() || null } }),
    onSuccess: (v) => { qc.invalidateQueries({ queryKey: ["vendors", projectId] }); toast.push(`${v.name} added`, "ok"); onCreated(v); setF({ name: "", contactName: "", email: "", phone: "" }); onClose(); },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  return (
    <Modal open={open} onClose={onClose} title="New vendor"
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!f.name.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Adding…" : "Add"}</button></>}>
      <div className="form-grid">
        <Field label="Name" span2><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="XYZ Costumes" autoFocus /></Field>
        <Field label="Contact"><Input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email" span2><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      </div>
      <ErrorBox error={create.error} />
    </Modal>
  );
}

/**
 * Sending a request to whoever it concerns, the same way everywhere: crew on this production, the vendors it
 * rents from, and the outside people it deals with — each list with a way to add somebody who is not on it yet.
 * Crew are told inside the app; for everyone else the written message comes back to be passed on.
 */
export function SendRequestModal({ open, onClose, title, defaultTitle, defaultBody, entityType, entityId }: {
  open: boolean; onClose: () => void; title: string; defaultTitle: string; defaultBody: string; entityType?: string; entityId?: string;
}) {
  const { projectId } = useProject();
  const toast = useToast();
  const [group, setGroup] = useState<Group>("crew");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<Group, Set<string>>>({ crew: new Set(), vendors: new Set(), contacts: new Set() });
  const [subject, setSubject] = useState(defaultTitle);
  const [message, setMessage] = useState(defaultBody);
  const [newVendor, setNewVendor] = useState(false);
  const [newContact, setNewContact] = useState(false);
  const [sent, setSent] = useState<SendResult | null>(null);

  const { data: members } = useQuery({ queryKey: ["members", projectId], queryFn: () => api<Member[]>(p(projectId, "/members")), enabled: open });
  const { data: vendors } = useQuery({ queryKey: ["vendors", projectId], queryFn: () => api<Vendor[]>(p(projectId, "/vendors")), enabled: open });
  const { data: contacts } = useQuery({ queryKey: ["contacts", projectId], queryFn: () => api<ExternalContact[]>(p(projectId, "/contacts")), enabled: open });

  // Re-opened for another record: the message it was opened with is the message it starts from.
  useEffect(() => { if (open) { setSubject(defaultTitle); setMessage(defaultBody); setSent(null); } }, [open, defaultTitle, defaultBody]);

  const toggle = (g: Group, id: string) => setPicked((prev) => {
    const next = new Set(prev[g]);
    next.has(id) ? next.delete(id) : next.add(id);
    return { ...prev, [g]: next };
  });
  const needle = q.trim().toLowerCase();
  const match = (...parts: (string | null | undefined)[]) => !needle || parts.some((x) => (x || "").toLowerCase().includes(needle));
  const rows = useMemo(() => {
    if (group === "crew") return (members || []).filter((m) => match(m.user.name, m.user.email, m.role)).map((m) => ({ id: m.userId, name: m.user.name, sub: `${humanize(m.role)} · ${m.user.email}` }));
    if (group === "vendors") return (vendors || []).filter((v) => match(v.name, v.contactName, v.email, v.phone)).map((v) => ({ id: v.id, name: v.name, sub: [v.contactName, v.phone, v.email].filter(Boolean).join(" · ") || "No contact details" }));
    return (contacts || []).filter((c) => match(c.name, c.company, c.role, c.email, c.phone)).map((c) => ({ id: c.id, name: c.name, sub: [c.role, c.company, c.phone, c.email].filter(Boolean).join(" · ") || "No contact details" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, members, vendors, contacts, needle]);
  const count = picked.crew.size + picked.vendors.size + picked.contacts.size;

  const send = useMutation({
    mutationFn: () => api<SendResult>(p(projectId, "/requests"), { body: { title: subject.trim(), body: message.trim(), entityType, entityId, crewUserIds: [...picked.crew], vendorIds: [...picked.vendors], contactIds: [...picked.contacts] } }),
    onSuccess: (r) => {
      setSent(r);
      toast.push(r.notified ? `Sent to ${r.notified} on the crew` : "Request recorded", "ok");
      if (!r.offApp.length) { reset(); onClose(); }
    },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  const reset = () => { setPicked({ crew: new Set(), vendors: new Set(), contacts: new Set() }); setQ(""); setGroup("crew"); setSent(null); };
  const close = () => { reset(); onClose(); };

  const text = `${subject.trim()}\n\n${message.trim()}`;
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast.push("Copied", "ok"); } catch { toast.push("Could not copy", "danger"); } };

  return (
    <>
      <Modal open={open} onClose={close} title={title} wide
        footer={sent
          ? <button className="btn btn-primary" onClick={close}>Done</button>
          : <><button className="btn" onClick={close}>Cancel</button><button className="btn btn-primary" disabled={!count || !subject.trim() || !message.trim() || send.isPending} onClick={() => send.mutate()}><Send size={15} /> {send.isPending ? "Sending…" : `Send to ${count || "…"}`}</button></>}>
        {sent ? (
          <div className="col gap-2">
            <div className="notice ok">
              {sent.notified
                ? `${sent.notified} on the crew ${sent.notified === 1 ? "has" : "have"} been notified in the app.`
                : sent.skippedSelf ? "You were the only crew member picked, so there was nobody to notify."
                : "Nobody on the crew was picked."}
            </div>
            {sent.offApp.length > 0 && (
              <>
                <div className="subtle">These do not sign in to the app — send it to them from here:</div>
                {sent.offApp.map((r) => (
                  <div key={`${r.kind}-${r.id}`} className="card flat row between wrap gap-2" style={{ padding: 10 }}>
                    <div><div className="bold">{r.name}</div><div className="subtle small">{[r.phone, r.email].filter(Boolean).join(" · ") || "No contact details on file"}</div></div>
                    <div className="row gap-1">
                      {r.phone && <a className="btn btn-sm" href={`https://wa.me/${r.phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">WhatsApp</a>}
                      {r.email && <a className="btn btn-sm" href={`mailto:${r.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`}><Mail size={14} /> Email</a>}
                      <button type="button" className="btn btn-sm" onClick={copy}><Copy size={14} /> Copy</button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        ) : (
          <div className="col gap-2">
            <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
            <Field label="Message"><Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
            <Field label={`Send to${count ? ` (${count})` : ""}`} help="Crew are told in the app; vendors and outside contacts get the message to pass on">
              <div className="tabs" style={{ marginBottom: 6 }}>
                {GROUPS.map((g) => (
                  <button key={g.key} type="button" className={group === g.key ? "active" : ""} onClick={() => { setGroup(g.key); setQ(""); }}>
                    {g.label}{picked[g.key].size > 0 ? ` (${picked[g.key].size})` : ""}
                  </button>
                ))}
              </div>
              <div className="row gap-1 mb-2 wrap">
                <div className="grow" style={{ minWidth: 200 }}><SearchBox value={q} onChange={setQ} placeholder={group === "crew" ? "Search crew…" : group === "vendors" ? "Search vendors…" : "Search contacts…"} /></div>
                {group === "vendors" && <button type="button" className="btn btn-sm" onClick={() => setNewVendor(true)}><Plus size={14} /> New vendor</button>}
                {group === "contacts" && <button type="button" className="btn btn-sm" onClick={() => setNewContact(true)}><Plus size={14} /> New contact</button>}
                {group === "crew" && <span className="subtle small row gap-1"><Users size={14} /> everyone on this production</span>}
              </div>
              <Rows items={rows} picked={picked[group]} onPick={(id) => toggle(group, id)} />
            </Field>
            <ErrorBox error={send.error} />
          </div>
        )}
      </Modal>
      <NewVendorModal open={newVendor} onClose={() => setNewVendor(false)} onCreated={(v) => { setGroup("vendors"); toggle("vendors", v.id); }} />
      <NewContactModal open={newContact} onClose={() => setNewContact(false)} onCreated={(c) => { setGroup("contacts"); toggle("contacts", c.id); }} />
    </>
  );
}

/** The share sheet's own icon, for a button that opens this dialog. */
export const SendRequestIcon = Share2;
