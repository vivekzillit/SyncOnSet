import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import { api, authedUrl, p } from "@/api/client";
import { useProject } from "@/state/project";
import { FINANCE_ROLES } from "@/state/auth";
import { fmtDateLong, fmtMoney, fmtTime, humanize, todayISO } from "@/lib/format";
import type { CleaningRequest, Costume } from "@/api/types";
import { Badge, Card, Input, PageHead, Spinner, Stat, Tabs } from "@/components/ui";

interface Daily { project: { name: string; shootingDay: number }; date: string; summary: Record<string, number>; scenes: { id: string; number: string; name?: string | null; location?: string | null; status: string; characters: { name: string; change: string }[] }[]; movements: { id: string; createdAt: string; action: string; fromLocation?: string | null; toLocation?: string | null; byUserName?: string | null; note?: string | null; costume: { assetNumber: string; name: string } }[]; cleaning: CleaningRequest[]; alterations: { id: string; issue: string; required: string; status: string; costume: { assetNumber: string; name: string } }[]; missing: { id: string; costume: { assetNumber: string; name: string }; lastSeenLocation?: string | null }[] }
interface InvRow { asset: string; name: string; category: string; type?: string | null; color?: string | null; size?: string | null; quantity: number; character?: string | null; source: string; vendor?: string | null; purchaseCost?: number | null; status: string; location: string }
interface Wrap { total: number; groups: Record<string, (Costume & { character?: { name: string } | null; vendor?: { name: string } | null })[]> }

export default function Reports() {
  const { projectId, can, currency } = useProject();
  const [tab, setTab] = useState<"daily" | "inventory" | "wrap">("daily");
  const [date, setDate] = useState(todayISO());
  const { data: daily, isLoading } = useQuery({ queryKey: ["report-daily", projectId, date], queryFn: () => api<Daily>(p(projectId, `/reports/daily?date=${date}`)), enabled: tab === "daily" });
  const { data: inv } = useQuery({ queryKey: ["report-inventory", projectId], queryFn: () => api<InvRow[]>(p(projectId, "/reports/inventory")), enabled: tab === "inventory" });
  const { data: wrap } = useQuery({ queryKey: ["report-wrap", projectId], queryFn: () => api<Wrap>(p(projectId, "/reports/wrap")), enabled: tab === "wrap" });

  return (
    <div>
      <PageHead title="Reports" sub="Wardrobe daily report, asset inventory and wrap." actions={<button className="btn no-print" onClick={() => window.print()}><Printer size={16} /> Print / PDF</button>} />
      <div className="no-print"><Tabs tabs={[{ key: "daily", label: "Daily report" }, { key: "inventory", label: "Inventory / assets" }, { key: "wrap", label: "Wrap" }]} value={tab} onChange={setTab} /></div>

      {tab === "daily" && (
        <div>
          <div className="filters no-print"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "auto" }} /><a className="btn" href={authedUrl(`/projects/${projectId}/reports/daily.csv?date=${date}`)} download><Download size={16} /> CSV</a></div>
          {isLoading || !daily ? <Spinner /> : (
            <div className="col gap-2">
              <Card>
                <h2>Wardrobe daily report · {daily.project.name}</h2>
                <div className="subtle">{fmtDateLong(daily.date)} · Shooting day {daily.project.shootingDay}</div>
                <div className="grid grid-stats mt-2">
                  <Stat label="Scenes" value={daily.summary.scenes} />
                  <Stat label="Costumes used" value={daily.summary.costumesUsed} />
                  <Stat label="Issued" value={daily.summary.issued} />
                  <Stat label="Returned" value={daily.summary.returned} />
                  <Stat label="Cleaning" value={daily.summary.cleaning} hint={`${daily.summary.cleaningCompleted} completed`} />
                  <Stat label="Emergencies" value={daily.summary.emergencyRequests} tone={daily.summary.emergencyRequests ? "danger" : undefined} />
                  <Stat label="Alteration" value={daily.summary.alteration} />
                  <Stat label="Damaged" value={daily.summary.damaged} />
                  <Stat label="Missing" value={daily.summary.missing} tone={daily.summary.missing ? "danger" : undefined} />
                  {can(FINANCE_ROLES) && <Stat label="Spend today" value={fmtMoney(daily.summary.spend, currency)} />}
                </div>
              </Card>
              <Card title="Scenes shot / scheduled" pad0>
                {daily.scenes.length === 0 ? <div className="subtle" style={{ padding: 14 }}>No scenes on this date.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Sc</th><th>Name</th><th>Location</th><th>Status</th><th>Characters / changes</th></tr></thead><tbody>{daily.scenes.map((s) => <tr key={s.id}><td className="bold">{s.number}</td><td>{s.name}</td><td>{s.location}</td><td><Badge status={s.status} /></td><td>{s.characters.map((c) => `${c.name}: ${c.change}`).join(" · ")}</td></tr>)}</tbody></table></div>}
              </Card>
              <Card title={`Costume movements (${daily.movements.length})`} pad0>
                {daily.movements.length === 0 ? <div className="subtle" style={{ padding: 14 }}>No movements recorded.</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Time</th><th>Asset</th><th>Action</th><th>From → To</th><th>By</th><th>Note</th></tr></thead><tbody>{daily.movements.map((mv) => <tr key={mv.id}><td className="nowrap mono">{fmtTime(mv.createdAt)}</td><td><span className="mono bold">{mv.costume.assetNumber}</span> {mv.costume.name}</td><td>{humanize(mv.action)}</td><td>{[mv.fromLocation, mv.toLocation].filter(Boolean).join(" → ")}</td><td>{mv.byUserName}</td><td className="subtle">{mv.note}</td></tr>)}</tbody></table></div>}
              </Card>
              <div className="grid grid-2">
                <Card title="Cleaning requests" pad0>{daily.cleaning.length === 0 ? <div className="subtle" style={{ padding: 14 }}>None.</div> : <div className="list">{daily.cleaning.map((c) => <div key={c.id} className="item"><div className="grow"><div className="title small"><span className="mono">{c.costume.assetNumber}</span> {c.costume.name}{c.isEmergency ? " 🚨" : ""}</div><div className="meta">{c.problem} · {humanize(c.cleaningType)}</div></div><Badge status={c.status} /></div>)}</div>}</Card>
                <Card title="Alterations & missing" pad0>
                  <div className="list">
                    {daily.alterations.map((a) => <div key={a.id} className="item"><div className="grow"><div className="title small">✂️ <span className="mono">{a.costume.assetNumber}</span> {a.costume.name}</div><div className="meta">{a.issue} → {a.required}</div></div><Badge status={a.status} /></div>)}
                    {daily.missing.map((mi) => <div key={mi.id} className="item"><div className="grow"><div className="title small">🔎 <span className="mono">{mi.costume.assetNumber}</span> {mi.costume.name}</div><div className="meta">Last seen {mi.lastSeenLocation || "—"}</div></div><Badge status="MISSING" /></div>)}
                    {daily.alterations.length + daily.missing.length === 0 && <div className="subtle" style={{ padding: 14 }}>None.</div>}
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "inventory" && (
        <div>
          <div className="filters no-print"><a className="btn" href={authedUrl(`/projects/${projectId}/reports/inventory?format=csv`)} download><Download size={16} /> CSV</a><span className="subtle">{inv?.length ?? 0} assets</span></div>
          <Card pad0>
            {!inv ? <Spinner /> : <div className="table-wrap"><table className="table"><thead><tr><th>Asset</th><th>Description</th><th>Category</th><th>Size</th><th>Character</th><th>Source</th><th>Vendor</th>{can(FINANCE_ROLES) && <th className="right">Cost</th>}<th>Status</th><th>Location</th></tr></thead><tbody>{inv.map((r) => <tr key={r.asset}><td className="mono bold">{r.asset}</td><td>{r.name}{r.quantity > 1 ? ` ×${r.quantity}` : ""}</td><td>{humanize(r.category)}{r.type ? ` / ${r.type}` : ""}</td><td>{r.size}</td><td>{r.character}</td><td>{humanize(r.source)}</td><td>{r.vendor}</td>{can(FINANCE_ROLES) && <td className="right">{r.purchaseCost != null ? fmtMoney(r.purchaseCost, currency) : ""}</td>}<td><Badge status={r.status} /></td><td>{r.location}</td></tr>)}</tbody></table></div>}
          </Card>
        </div>
      )}

      {tab === "wrap" && (
        <div className="col gap-2">
          <div className="notice info no-print">Wrap report groups every active asset by source so the team knows what returns to vendors, what goes to storage, and what belongs to actors. Use <b>QR labels</b> to print wrap box labels.</div>
          {!wrap ? <Spinner /> : Object.entries(wrap.groups).map(([source, items]) => (
            <Card key={source} title={`${humanize(source)} (${items.length})`} pad0>
              <div className="table-wrap"><table className="table"><thead><tr><th>Asset</th><th>Description</th><th>Character</th><th>Vendor</th><th>Status</th><th>Location</th></tr></thead><tbody>{items.map((c) => <tr key={c.id}><td className="mono bold">{c.assetNumber}</td><td>{c.name}{c.quantity > 1 ? ` ×${c.quantity}` : ""}</td><td>{c.character?.name}</td><td>{c.vendor?.name}</td><td><Badge status={c.status} /></td><td>{c.location}</td></tr>)}</tbody></table></div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
