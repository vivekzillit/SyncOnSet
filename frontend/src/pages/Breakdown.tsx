import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { fmtDate, humanize } from "@/lib/format";
import type { Scene, SceneCharacter } from "@/api/types";
import { Card, Chips, Dot, Empty, PageHead, SearchBox, Select, Spinner } from "@/components/ui";
import { scriptLoc } from "@/components/SceneEditRow";
import { sortByCast } from "@/components/PrincipalsModal";

const SHOOT_DATE = { day: "2-digit", month: "short" } as const;

/** One breakdown row: a character as they appear in a single scene. */
type Row = { scene: Scene; sc: SceneCharacter; readiness: string };

/** Worst costume status in the look the character wears, so a row reads like the Scenes readiness dot. */
function readinessOf(sc: SceneCharacter) {
  if (!sc.change) return "NOT_ASSIGNED";
  const statuses = (sc.change.items || []).map((i) => i.costume.status);
  return ["MISSING", "DAMAGED", "ALTERATION", "CLEANING"].find((s) => statuses.includes(s)) || "READY";
}

export default function Breakdown() {
  const { projectId } = useProject();
  const base = `/p/${projectId}`;
  const [q, setQ] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [when, setWhen] = useState<"all" | "scheduled">("all");
  const { data: scenes, isLoading } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const scene of scenes || []) {
      const cast = sortByCast(scene.characters.map((sc) => ({ ...sc, name: sc.character.name, castNumber: sc.character.castNumber ?? null })));
      for (const sc of cast) out.push({ scene, sc, readiness: readinessOf(sc) });
    }
    return out;
  }, [scenes]);

  const characters = useMemo(() => {
    const byId = new Map<string, { value: string; label: string }>();
    for (const r of rows) if (!byId.has(r.sc.characterId)) byId.set(r.sc.characterId, { value: r.sc.characterId, label: r.sc.character.name });
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const needle = q.trim().toLowerCase();
  const list = rows.filter((r) => {
    if (characterId && r.sc.characterId !== characterId) return false;
    if (when === "scheduled" && !r.scene.shootDate) return false;
    if (!needle) return true;
    return [r.scene.number, r.scene.name, r.scene.location, r.scene.scriptDay, r.scene.intExt, r.sc.character.name, r.sc.change?.name].some((v) => (v || "").toLowerCase().includes(needle));
  });

  if (isLoading || !scenes) return <Spinner />;
  const label = characterId ? characters.find((c) => c.value === characterId)?.label : null;

  return (
    <div>
      <PageHead title="Breakdown" sub={label ? `${label}, scene by scene — the look worn in each and whether it is ready.` : "Every scene against the characters in it, with the look each one wears."} />
      <div className="filters">
        <SearchBox value={q} onChange={setQ} placeholder="Scene, location, story day, character, change…" />
        <Select value={characterId} onChange={(e) => setCharacterId(e.target.value)} options={characters} placeholder="All characters" humanizeLabels={false} />
        <Chips options={[{ key: "all", label: "All scenes" }, { key: "scheduled", label: "Scheduled" }]} value={when} onChange={(v) => setWhen((v || "all") as "all" | "scheduled")} />
      </div>
      <Card pad0>
        {list.length === 0 ? (
          <Empty icon="📋" title="Nothing to break down" hint={rows.length ? "No scene matches these filters." : "Add scenes and tag the characters in them — or upload a script — and the breakdown fills in."} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 28 }}><span className="sr-only">Readiness</span></th><th>Sc</th><th>Script Loc.</th><th>D/N</th><th>Story Day</th><th>Pgs</th><th>Character</th><th>Change</th><th>Shoot Date</th></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.sc.id} style={r.scene.status === "OMITTED" ? { opacity: 0.55 } : undefined}>
                    <td><span title={humanize(r.readiness)} aria-label={humanize(r.readiness)} role="img"><Dot status={r.readiness} pulse={r.readiness === "MISSING"} /></span></td>
                    <td className="nowrap"><Link to={`${base}/scenes/${r.scene.id}`} className="bold" title={r.scene.name || `Scene ${r.scene.number}`}>{r.scene.number}</Link></td>
                    <td className="nowrap">{scriptLoc(r.scene) || r.scene.name || ""}</td>
                    <td className="nowrap">{r.scene.timeOfDay || ""}</td>
                    <td className="nowrap">{r.scene.scriptDay || ""}</td>
                    <td className="nowrap">{r.scene.pages || ""}</td>
                    <td className="nowrap"><Link to={`${base}/characters/${r.sc.characterId}`}>{r.sc.character.castNumber != null && <span className="mono muted">{r.sc.character.castNumber}. </span>}{r.sc.character.name}</Link></td>
                    <td>{r.sc.change ? <Link to={`${base}/changes/${r.sc.change.id}`}>#{r.sc.change.changeNumber} {r.sc.change.name}</Link> : <span className="subtle">No change assigned</span>}</td>
                    <td className="nowrap">{r.scene.shootDate ? fmtDate(r.scene.shootDate, SHOOT_DATE) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
