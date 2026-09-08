import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Printer } from "lucide-react";
import { api, authedUrl, p } from "@/api/client";
import { useProject } from "@/state/project";
import { FINANCE_ROLES, OPS_ROLES } from "@/state/auth";
import { fmtDate, fmtDateTime, fmtMoney, humanize } from "@/lib/format";
import type { Alteration, CleaningRequest, Costume, DamageReport, MissingItem, Photo, Rental, TimelineEvent } from "@/api/types";
import { Badge, Card, PageHead, Spinner } from "@/components/ui";
import { PhotoGrid, Timeline } from "@/components/domain";
import { CostumeActions, CostumeFormModal } from "@/components/costume";

type Detail = Costume & {
  changeItems: { id: string; wearNotes?: string | null; change: { id: string; changeNumber: number; name: string; character: { id: string; name: string }; sceneCharacters: { scene: { id: string; number: string; name?: string | null; shootDate?: string | null } }[] } }[];
  cleaning: CleaningRequest[]; alterations: Alteration[]; damages: DamageReport[]; missing: MissingItem[]; rentals: Rental[]; timeline: TimelineEvent[]; photos: Photo[];
  fittingItems: { id: string; status: string; notes?: string | null; fitting: { id: string; scheduledAt: string; status: string } }[];
};

export default function CostumeDetail() {
  const { id = "" } = useParams();
  const { projectId, can, currency } = useProject();
  const base = `/p/${projectId}`;
  const { data: c, isLoading, refetch } = useQuery({ queryKey: ["costume", id], queryFn: () => api<Detail>(p(projectId, `/costumes/${id}`)) });
  const [edit, setEdit] = useState(false);
  if (isLoading || !c) return <Spinner />;
  const openCleaning = c.cleaning.find((x) => !["READY", "CANCELLED"].includes(x.status));
  const openAlteration = c.alterations.find((x) => !["COMPLETED", "CANCELLED"].includes(x.status));
  const scenes = new Map<string, { id: string; number: string; shootDate?: string | null }>();
  c.changeItems.forEach((ci) => ci.change.sceneCharacters.forEach((sc) => scenes.set(sc.scene.id, sc.scene)));

  return (
    <div>
      <PageHead
        crumbs={<><Link to={`${base}/costumes`}>Costumes</Link> / {c.assetNumber}</>}
        title={<span className="row gap-2 wrap"><span className="mono">{c.assetNumber}</span><span>{c.name}</span><Badge status={c.status} lg /></span>}
        sub={<>{[c.category && humanize(c.category), c.type, c.color, c.size ? `Size ${c.size}` : null, c.brand].filter(Boolean).join(" · ")} · at <b>{c.location}</b>{c.character ? <> · for <Link to={`${base}/characters/${c.character.id}`}><b>{c.character.name}</b></Link></> : null}</>}
        actions={<>{can(OPS_ROLES) && <button className="btn" onClick={() => setEdit(true)}><Pencil size={16} /> Edit</button>}<Link to={`${base}/labels?ids=${c.id}`} className="btn"><Printer size={16} /> Label</Link></>}
      />
      <Card className="mb-2"><CostumeActions costume={c} onChanged={() => refetch()} openCleaningId={openCleaning?.id} openAlterationId={openAlteration?.id} /></Card>
      {openCleaning && <div className="notice info mb-2">In cleaning: <b>{openCleaning.problem}</b> · {humanize(openCleaning.status)} · expected ready {fmtDateTime(openCleaning.expectedReadyAt)} · <Link to={`${base}/cleaning/${openCleaning.id}`}><u>open ticket</u></Link></div>}
      {openAlteration && <div className="notice mb-2">With tailor: <b>{openAlteration.issue}</b> → {openAlteration.required} · {humanize(openAlteration.status)}{openAlteration.deadline ? ` · due ${fmtDateTime(openAlteration.deadline)}` : ""}</div>}

      <div className="grid grid-2" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)" }}>
        <div className="col gap-2">
          <Card title="Details">
            <div className="row top gap-3">
              <img src={authedUrl(`/projects/${projectId}/costumes/${c.id}/qr.png?size=160`)} alt="QR" width={110} height={110} style={{ borderRadius: 8, border: "1px solid var(--border)" }} />
              <dl className="kv grow">
                <dt>Source</dt><dd>{humanize(c.source)}{c.vendor ? ` · ${c.vendor.name}` : ""}</dd>
                {can(FINANCE_ROLES) && c.purchaseCost != null && <><dt>Purchase cost</dt><dd>{fmtMoney(c.purchaseCost, currency)}</dd></>}
                {can(FINANCE_ROLES) && c.rentalCostPerDay != null && <><dt>Rental / day</dt><dd>{fmtMoney(c.rentalCostPerDay, currency)}</dd></>}
                <dt>Quantity</dt><dd>{c.quantity}</dd>
                {c.fabric && <><dt>Fabric</dt><dd>{c.fabric}</dd></>}
                {c.careInstructions && <><dt>Care</dt><dd>{c.careInstructions}</dd></>}
                <dt>Added</dt><dd>{fmtDate(c.createdAt)}</dd>
              </dl>
            </div>
            {c.notes && <div className="notice mt-2">{c.notes}</div>}
          </Card>
          <Card title="Used in">
            {c.changeItems.length === 0 ? <div className="subtle">Not attached to any change yet.</div> : (
              <div className="col gap-1">
                {c.changeItems.map((ci) => (
                  <div key={ci.id} className="small">
                    <Link to={`${base}/changes/${ci.change.id}`} className="bold">{ci.change.character.name} · Change #{ci.change.changeNumber} {ci.change.name}</Link>
                    {ci.wearNotes && <div className="subtle">✎ {ci.wearNotes}</div>}
                  </div>
                ))}
                {scenes.size > 0 && <div className="chips mt-1">{[...scenes.values()].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })).map((s) => <Link key={s.id} to={`${base}/scenes/${s.id}`} className="chip">Sc {s.number}{s.shootDate ? ` · ${fmtDate(s.shootDate)}` : ""}</Link>)}</div>}
              </div>
            )}
          </Card>
          <Card title="Photos & documents"><PhotoGrid photos={c.photos} entityType="COSTUME" entityId={c.id} kinds={["FRONT", "SIDE", "BACK", "CLOSEUP", "DETAIL", "DOCUMENT", "OTHER"]} /></Card>
          {(c.damages.length > 0 || c.missing.length > 0 || c.rentals.length > 0 || c.fittingItems.length > 0) && (
            <Card title="Records">
              <div className="col gap-1 small">
                {c.rentals.map((r) => <div key={r.id}>🏷 Rental from <b>{r.vendor.name}</b> {fmtDate(r.pickupDate)} → {fmtDate(r.returnDate)} <Badge status={r.status} /></div>)}
                {c.damages.map((d) => <div key={d.id}>⚠️ {fmtDate(d.createdAt)} {d.description} <Badge status={d.status} /></div>)}
                {c.missing.map((m) => <div key={m.id}>🔎 Missing since {fmtDateTime(m.createdAt)} · last seen {m.lastSeenLocation} <Badge status={m.status} /></div>)}
                {c.fittingItems.map((f) => <div key={f.id}>📏 <Link to={`${base}/fittings/${f.fitting.id}`}>Fitting {fmtDate(f.fitting.scheduledAt)}</Link> <Badge status={f.status} />{f.notes ? ` · ${f.notes}` : ""}</div>)}
              </div>
            </Card>
          )}
        </div>
        <Card title="Timeline"><Timeline events={c.timeline} /></Card>
      </div>
      <CostumeFormModal open={edit} onClose={() => setEdit(false)} initial={c} onSaved={() => refetch()} />
    </div>
  );
}
