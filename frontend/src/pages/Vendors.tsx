import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, BellRing } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, FINANCE_ROLES, OPS_ROLES } from "@/state/auth";
import { fmtDate, fmtMoney } from "@/lib/format";
import type { Costume, Rental, Vendor } from "@/api/types";
import { Badge, Card, Empty, ErrorBox, Field, Input, Modal, PageHead, Select, Spinner, Tabs, Textarea, useToast } from "@/components/ui";
import { CostumePicker, CostumeRow } from "@/components/domain";

export default function Vendors() {
  const { projectId, can, currency } = useProject();
  const { meta } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const base = `/p/${projectId}`;
  const [tab, setTab] = useState<"rentals" | "vendors">("rentals");
  const { data: vendors, isLoading } = useQuery({ queryKey: ["vendors", projectId], queryFn: () => api<Vendor[]>(p(projectId, "/vendors")) });
  const { data: rentals } = useQuery({ queryKey: ["rentals", projectId], queryFn: () => api<Rental[]>(p(projectId, "/rentals")) });
  const [vOpen, setVOpen] = useState(false);
  const [vf, setVf] = useState({ name: "", contactName: "", phone: "", email: "", address: "", notes: "" });
  const [rOpen, setROpen] = useState(false);
  const [pick, setPick] = useState(false);
  const [rf, setRf] = useState<{ costume: Costume | null; vendorId: string; ratePerDay: string; pickupDate: string; returnDate: string; notes: string }>({ costume: null, vendorId: "", ratePerDay: "", pickupDate: "", returnDate: "", notes: "" });
  const createVendor = useMutation({ mutationFn: () => api(p(projectId, "/vendors"), { body: vf }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["vendors", projectId] }); setVOpen(false); setVf({ name: "", contactName: "", phone: "", email: "", address: "", notes: "" }); toast.push("Vendor added", "ok"); } });
  const createRental = useMutation({
    mutationFn: () => api(p(projectId, "/rentals"), { body: { costumeId: rf.costume!.id, vendorId: rf.vendorId, ratePerDay: Number(rf.ratePerDay || 0), pickupDate: rf.pickupDate, returnDate: rf.returnDate, notes: rf.notes || null } }),
    onSuccess: () => { qc.invalidateQueries(); setROpen(false); setRf({ costume: null, vendorId: "", ratePerDay: "", pickupDate: "", returnDate: "", notes: "" }); toast.push("Rental recorded", "ok"); },
  });
  const setStatus = useMutation({ mutationFn: (v: { id: string; status: string }) => api(p(projectId, `/rentals/${v.id}`), { method: "PATCH", body: { status: v.status } }), onSuccess: () => { qc.invalidateQueries(); toast.push("Updated", "ok"); }, onError: (e: Error) => toast.push(e.message, "danger") });
  const remind = useMutation({ mutationFn: () => api<{ reminded: number }>(p(projectId, "/rentals/remind"), { body: {} }), onSuccess: (r) => toast.push(`${r.reminded} reminder${r.reminded === 1 ? "" : "s"} sent`, "ok") });

  if (isLoading) return <Spinner />;
  return (
    <div>
      <PageHead title="Vendors & Rentals" sub="Who we rent from, what is due back, and when." actions={can(OPS_ROLES) && (tab === "rentals" ? <><button className="btn" onClick={() => remind.mutate()}><BellRing size={16} /> Send return reminders</button><button className="btn btn-primary" onClick={() => setROpen(true)}><Plus size={16} /> Rental</button></> : <button className="btn btn-primary" onClick={() => setVOpen(true)}><Plus size={16} /> Vendor</button>)} />
      <Tabs tabs={[{ key: "rentals", label: `Rentals (${rentals?.length ?? 0})` }, { key: "vendors", label: `Vendors (${vendors?.length ?? 0})` }]} value={tab} onChange={setTab} />
      {tab === "rentals" ? (
        <Card pad0>
          {!rentals?.length ? <Empty icon="🏷" title="No rentals" /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Costume</th><th>Vendor</th><th>Pickup</th><th>Return</th>{can(FINANCE_ROLES) && <th>Rate/day</th>}<th>Status</th><th></th></tr></thead>
              <tbody>
                {rentals.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`${base}/costumes/${r.costume.id}`}><span className="mono bold">{r.costume.assetNumber}</span> {r.costume.name}</Link></td>
                    <td>{r.vendor.name}</td>
                    <td className="nowrap">{fmtDate(r.pickupDate)}</td>
                    <td className="nowrap">{fmtDate(r.returnDate)} {r.isOverdue ? <Badge status="OVERDUE">overdue</Badge> : r.dueSoon ? <Badge status="DUE">due soon</Badge> : null}</td>
                    {can(FINANCE_ROLES) && <td>{fmtMoney(r.ratePerDay, currency)}</td>}
                    <td><Badge status={r.status} /></td>
                    <td className="nowrap">{can(OPS_ROLES) && r.status !== "RETURNED" && <>{r.status === "BOOKED" && <button className="btn btn-sm" onClick={() => setStatus.mutate({ id: r.id, status: "PICKED_UP" })}>Picked up</button>} <button className="btn btn-sm btn-primary" onClick={() => setStatus.mutate({ id: r.id, status: "RETURNED" })}>Returned</button></>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
      ) : (
        <div className="grid grid-auto">
          {!vendors?.length ? <Card><Empty icon="🏬" title="No vendors" /></Card> : vendors.map((v) => (
            <Card key={v.id} title={v.name}>
              <dl className="kv" style={{ gridTemplateColumns: "90px 1fr" }}>
                {v.contactName && <><dt>Contact</dt><dd>{v.contactName}</dd></>}
                {v.phone && <><dt>Phone</dt><dd>{v.phone}</dd></>}
                {v.email && <><dt>Email</dt><dd>{v.email}</dd></>}
                {v.address && <><dt>Address</dt><dd>{v.address}</dd></>}
                <dt>Items</dt><dd>{v._count?.costumes ?? 0} costumes · {v._count?.rentals ?? 0} rentals</dd>
              </dl>
              {v.notes && <div className="subtle mt-1">{v.notes}</div>}
            </Card>
          ))}
        </div>
      )}
      <Modal open={vOpen} onClose={() => setVOpen(false)} title="New vendor" footer={<><button className="btn" onClick={() => setVOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!vf.name || createVendor.isPending} onClick={() => createVendor.mutate()}>Add</button></>}>
        <div className="form-grid">
          <Field label="Name" span2><Input value={vf.name} onChange={(e) => setVf({ ...vf, name: e.target.value })} /></Field>
          <Field label="Contact person"><Input value={vf.contactName} onChange={(e) => setVf({ ...vf, contactName: e.target.value })} /></Field>
          <Field label="Phone"><Input value={vf.phone} onChange={(e) => setVf({ ...vf, phone: e.target.value })} /></Field>
          <Field label="Email"><Input value={vf.email} onChange={(e) => setVf({ ...vf, email: e.target.value })} /></Field>
          <Field label="Address"><Input value={vf.address} onChange={(e) => setVf({ ...vf, address: e.target.value })} /></Field>
          <Field label="Notes" span2><Textarea value={vf.notes} onChange={(e) => setVf({ ...vf, notes: e.target.value })} /></Field>
        </div>
        <ErrorBox error={createVendor.error} />
      </Modal>
      <Modal open={rOpen} onClose={() => setROpen(false)} title="Record rental" footer={<><button className="btn" onClick={() => setROpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!rf.costume || !rf.vendorId || !rf.pickupDate || !rf.returnDate || createRental.isPending} onClick={() => createRental.mutate()}>Save</button></>}>
        <div className="form-grid">
          <Field label="Costume" span2>{rf.costume ? <div className="list card flat pad-0"><CostumeRow c={rf.costume} onClick={() => setPick(true)} end={<span className="subtle">change</span>} /></div> : <button type="button" className="btn" onClick={() => setPick(true)}>Choose costume…</button>}</Field>
          <Field label="Vendor"><Select value={rf.vendorId} onChange={(e) => setRf({ ...rf, vendorId: e.target.value })} options={(vendors || []).map((v) => ({ value: v.id, label: v.name }))} placeholder="Select…" /></Field>
          <Field label={`Rate per day (${currency})`}><Input type="number" value={rf.ratePerDay} onChange={(e) => setRf({ ...rf, ratePerDay: e.target.value })} /></Field>
          <Field label="Pickup"><Input type="date" value={rf.pickupDate} onChange={(e) => setRf({ ...rf, pickupDate: e.target.value })} /></Field>
          <Field label="Return by"><Input type="date" value={rf.returnDate} onChange={(e) => setRf({ ...rf, returnDate: e.target.value })} /></Field>
          <Field label="Notes" span2><Textarea value={rf.notes} onChange={(e) => setRf({ ...rf, notes: e.target.value })} /></Field>
          {meta && null}
        </div>
        <ErrorBox error={createRental.error} />
      </Modal>
      <CostumePicker open={pick} onClose={() => setPick(false)} onPick={(c) => setRf({ ...rf, costume: c, vendorId: c.vendorId || rf.vendorId, ratePerDay: c.rentalCostPerDay ? String(c.rentalCostPerDay) : rf.ratePerDay })} />
    </div>
  );
}
