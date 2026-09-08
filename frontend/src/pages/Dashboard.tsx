import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ScanLine, Siren, Plus, ChevronRight } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { fmtDateLong, humanize } from "@/lib/format";
import type { Dashboard as Dash } from "@/api/types";
import { Badge, Card, Dot, Empty, PageHead, Spinner, Stat } from "@/components/ui";
import { ReadinessLine } from "@/components/domain";

export default function Dashboard() {
  const { projectId, project } = useProject();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["dashboard", projectId], queryFn: () => api<Dash>(p(projectId, "/dashboard")), refetchInterval: 30000 });
  if (isLoading || !data) return <Spinner />;
  const c = data.counts;
  const base = `/p/${projectId}`;

  return (
    <div>
      <PageHead
        title={project?.name}
        sub={<>Shooting day {project?.shootingDay} · {project?.currentLocation || humanize(project?.status)} · {fmtDateLong(data.date)}</>}
        actions={
          <>
            <Link to={`${base}/scan`} className="btn btn-primary"><ScanLine size={16} /> Scan</Link>
            <Link to={`${base}/scan?emergency=1`} className="btn btn-emergency"><Siren size={16} /> Emergency</Link>
            <Link to={`${base}/costumes?new=1`} className="btn hide-mobile"><Plus size={16} /> Costume</Link>
          </>
        }
      />

      <div className="grid grid-stats mb-2">
        <Stat label="Characters" value={c.characters} onClick={() => nav(`${base}/characters`)} />
        <Stat label="Costumes" value={c.costumes} onClick={() => nav(`${base}/costumes`)} />
        <Stat label="Today's scenes" value={c.todaysScenes} onClick={() => nav(`${base}/scenes`)} />
        <Stat label="Today's costumes" value={c.todaysCostumes} hint="across today's changes" />
        <Stat label="Issued today" value={c.issuedToday} tone="info" />
        <Stat label="Returned today" value={c.returnedToday} tone="ok" />
        <Stat label="In cleaning" value={c.cleaning} tone={c.cleaning ? "info" : undefined} onClick={() => nav(`${base}/cleaning`)} />
        <Stat label="Alteration" value={c.alteration} tone={c.alteration ? "warn" : undefined} onClick={() => nav(`${base}/alterations`)} />
        <Stat label="Missing" value={c.missing} tone={c.missing ? "danger" : undefined} onClick={() => nav(`${base}/missing`)} />
        <Stat label="Damaged" value={c.damaged} tone={c.damaged ? "danger" : undefined} onClick={() => nav(`${base}/damages`)} />
      </div>

      <div className="grid grid-2" style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)" }}>
        <Card title="Today's scenes" actions={<Link to={`${base}/scenes`} className="btn btn-ghost btn-sm">All scenes <ChevronRight size={14} /></Link>}>
          {data.todaysScenes.length === 0 ? <Empty icon="🎬" title="Nothing scheduled today" hint="Set a shoot date on scenes to see costume readiness here." /> : (
            <div className="col gap-2">
              {data.todaysScenes.map((s) => (
                <Link key={s.id} to={`${base}/scenes/${s.id}`} className="card flat" style={{ padding: 12 }}>
                  <div className="row between">
                    <div className="row gap-2">
                      <Dot status={s.level} pulse={s.level === "MISSING"} />
                      <div>
                        <div className="bold">Sc {s.number} · {s.name}</div>
                        <div className="subtle">{[s.location, s.timeOfDay].filter(Boolean).join(" · ")}</div>
                      </div>
                    </div>
                    <Badge status={s.status} />
                  </div>
                  <div className="mt-2">
                    {s.characters.map((ch) => <ReadinessLine key={ch.characterId} level={ch.level} name={ch.name} sub={ch.change || "No change assigned"} />)}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
        <div className="col gap-2">
          <Card title="Today's priorities">
            {data.priorities.length === 0 ? <div className="subtle">All clear. 🎉</div> : (
              <div className="list">
                {data.priorities.map((pr, i) => (
                  <Link key={i} to={`${base}/${pr.link}`} className="item link" style={{ padding: "9px 4px" }}>
                    <Dot status={pr.severity} pulse={pr.severity === "CRITICAL"} />
                    <span className="grow">{pr.text}</span>
                    <ChevronRight size={15} color="var(--text-3)" />
                  </Link>
                ))}
              </div>
            )}
          </Card>
          <Card title="Inventory by status">
            <div className="chips">
              {Object.entries(c.byStatus).sort((a, b) => b[1] - a[1]).map(([st, n]) => (
                <Link key={st} to={`${base}/costumes?status=${st}`}><Badge status={st} lg>{humanize(st)} · {n}</Badge></Link>
              ))}
            </div>
          </Card>
          <Card title="Today at a glance">
            <dl className="kv">
              <dt>Emergencies</dt><dd>{c.emergenciesToday}</dd>
              <dt>Fittings</dt><dd>{c.fittingsToday}</dd>
              <dt>Rentals due</dt><dd>{c.rentalsDue}</dd>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
