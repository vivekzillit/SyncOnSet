import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { api, authedUrl, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth } from "@/state/auth";
import { humanize } from "@/lib/format";
import type { Character, Costume } from "@/api/types";
import { Card, PageHead, SearchBox, Select, Spinner } from "@/components/ui";

export default function Labels() {
  const { projectId } = useProject();
  const { meta } = useAuth();
  const [sp] = useSearchParams();
  const [q, setQ] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set((sp.get("ids") || "").split(",").filter(Boolean)));
  const { data: characters } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")) });
  const { data, isLoading } = useQuery({ queryKey: ["costumes", projectId, "labels", q, characterId, status], queryFn: () => api<{ items: Costume[] }>(p(projectId, `/costumes?pageSize=200&q=${encodeURIComponent(q)}&characterId=${characterId}&status=${status}&includeRetired=true`)) });
  const items = data?.items || [];
  const chosen = useMemo(() => items.filter((c) => selected.has(c.id)), [items, selected]);
  const { data: preselected } = useQuery({ queryKey: ["costumes", projectId, "labels-pre", sp.get("ids")], queryFn: () => api<{ items: Costume[] }>(p(projectId, "/costumes?pageSize=200&includeRetired=true")), enabled: !!sp.get("ids") });
  const printable = useMemo(() => {
    const map = new Map<string, Costume>();
    [...items, ...(preselected?.items || [])].forEach((c) => selected.has(c.id) && map.set(c.id, c));
    return [...map.values()];
  }, [items, preselected, selected]);
  useEffect(() => { if (sp.get("ids") && printable.length && sp.get("print") === "1") setTimeout(() => window.print(), 300); }, [sp, printable.length]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div>
      <div className="no-print">
        <PageHead title="QR labels" sub="Print garment tags and wrap box labels. Each label carries the asset number, description, source and character." actions={<button className="btn btn-primary" disabled={!printable.length} onClick={() => window.print()}><Printer size={16} /> Print {printable.length} label{printable.length === 1 ? "" : "s"}</button>} />
        <div className="filters">
          <SearchBox value={q} onChange={setQ} />
          <Select value={characterId} onChange={(e) => setCharacterId(e.target.value)} options={(characters || []).map((c) => ({ value: c.id, label: c.name }))} placeholder="Any character" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} options={meta?.costumeStatuses || []} placeholder="Any status" />
          <button className="btn btn-sm" onClick={() => setSelected(new Set([...selected, ...items.map((c) => c.id)]))}>Select all ({items.length})</button>
          <button className="btn btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
        <Card pad0 className="mb-2">
          {isLoading ? <Spinner /> : (
            <div className="list" style={{ maxHeight: 320, overflowY: "auto" }}>
              {items.map((c) => (
                <label key={c.id} className="item link check" style={{ gap: 12 }}>
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                  <span className="mono bold">{c.assetNumber}</span><span className="grow truncate">{c.name}</span><span className="subtle">{c.character?.name}</span>
                </label>
              ))}
            </div>
          )}
        </Card>
        <h3 className="mb-2">Preview ({printable.length})</h3>
      </div>
      <div className="label-sheet">
        {printable.map((c) => (
          <div key={c.id} className="qr-label">
            <img src={authedUrl(`/projects/${projectId}/costumes/${c.id}/qr.png?size=200`)} alt={c.assetNumber} />
            <div>
              <div className="l-asset">{c.assetNumber}</div>
              <div className="l-name">{c.name}{c.quantity > 1 ? ` ×${c.quantity}` : ""}</div>
              <div className="l-meta">{[c.type, c.color, c.size ? `Size ${c.size}` : null].filter(Boolean).join(" · ")}</div>
              <div className="l-meta">{c.character?.name ? `${c.character.name} · ` : ""}{humanize(c.source)}{c.vendor?.name ? ` (${c.vendor.name})` : ""}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
