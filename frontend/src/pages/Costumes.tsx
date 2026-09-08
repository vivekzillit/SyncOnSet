import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, OPS_ROLES } from "@/state/auth";
import type { Character, Costume } from "@/api/types";
import { Card, Empty, PageHead, SearchBox, Select, Spinner } from "@/components/ui";
import { CostumeRow } from "@/components/domain";
import { CostumeFormModal } from "@/components/costume";

export default function Costumes() {
  const { projectId, can } = useProject();
  const { meta } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get("q") || "");
  const [debounced, setDebounced] = useState(q);
  const status = sp.get("status") || "";
  const category = sp.get("category") || "";
  const characterId = sp.get("characterId") || "";
  const source = sp.get("source") || "";
  const page = Number(sp.get("page") || 1);
  const [open, setOpen] = useState(sp.get("new") === "1");
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== "page") n.delete("page"); setSp(n, { replace: true }); };

  const { data: characters } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")) });
  const qs = new URLSearchParams({ q: debounced, status, category, characterId, source, page: String(page), pageSize: "50" });
  const { data, isLoading } = useQuery({ queryKey: ["costumes", projectId, qs.toString()], queryFn: () => api<{ items: Costume[]; total: number; page: number; pageSize: number }>(p(projectId, `/costumes?${qs}`)) });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <PageHead title="Costumes" sub={data ? `${data.total} pieces in inventory` : "Inventory"} actions={can(OPS_ROLES) && <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Costume</button>} />
      <div className="filters">
        <SearchBox value={q} onChange={setQ} placeholder="Asset no, name, colour, size, character…" />
        <Select value={status} onChange={(e) => set("status", e.target.value)} options={meta?.costumeStatuses || []} placeholder="Any status" />
        <Select value={category} onChange={(e) => set("category", e.target.value)} options={meta?.costumeCategories || []} placeholder="Any category" />
        <Select value={characterId} onChange={(e) => set("characterId", e.target.value)} options={(characters || []).map((c) => ({ value: c.id, label: c.name }))} placeholder="Any character" />
        <Select value={source} onChange={(e) => set("source", e.target.value)} options={meta?.costumeSources || []} placeholder="Any source" />
      </div>
      <Card pad0>
        {isLoading ? <Spinner /> : !data?.items.length ? <Empty title="No costumes match" hint="Try clearing filters, or add a new piece." /> : (
          <div className="list">{data.items.map((c) => <CostumeRow key={c.id} c={c} />)}</div>
        )}
        {data && pages > 1 && (
          <div className="row between" style={{ padding: 12 }}>
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => set("page", String(page - 1))}>Previous</button>
            <span className="subtle">Page {page} of {pages}</span>
            <button className="btn btn-sm" disabled={page >= pages} onClick={() => set("page", String(page + 1))}>Next</button>
          </div>
        )}
      </Card>
      <CostumeFormModal open={open} onClose={() => { setOpen(false); if (sp.get("new")) set("new", ""); }} defaultCharacterId={characterId} />
    </div>
  );
}
