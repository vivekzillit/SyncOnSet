import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import type { Character, Costume, Scene } from "@/api/types";
import { Badge } from "./ui";

/** Header search across scenes, characters and costumes; Enter opens the first hit. */
export function GlobalSearch() {
  const { projectId } = useProject();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t); }, [q]);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const { data: scenes } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")), enabled: open });
  const { data: characters } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")), enabled: open });
  const { data: costumes } = useQuery({ queryKey: ["costumes", projectId, "search", debounced], queryFn: () => api<{ items: Costume[] }>(p(projectId, `/costumes?pageSize=8&q=${encodeURIComponent(debounced)}`)), enabled: open && debounced.length >= 2 });
  const base = `/p/${projectId}`;
  const hits = useMemo(() => {
    const s = debounced.toLowerCase();
    if (s.length < 1) return [] as { key: string; label: string; sub?: string; to: string; kind: string }[];
    const out: { key: string; label: string; sub?: string; to: string; kind: string }[] = [];
    (scenes || []).filter((sc) => sc.number.toLowerCase() === s || sc.number.toLowerCase().startsWith(s) || (sc.name || "").toLowerCase().includes(s) || (sc.location || "").toLowerCase().includes(s)).slice(0, 5).forEach((sc) => out.push({ key: `s${sc.id}`, label: `Sc ${sc.number}${sc.name ? ` · ${sc.name}` : ""}`, sub: [sc.intExt, sc.location].filter(Boolean).join(". "), to: `${base}/scenes/${sc.id}`, kind: "Scene" }));
    (characters || []).filter((c) => c.name.toLowerCase().includes(s) || (c.castNumber != null && String(c.castNumber) === s)).slice(0, 5).forEach((c) => out.push({ key: `c${c.id}`, label: `${c.castNumber != null ? `${c.castNumber}. ` : ""}${c.name}`, sub: c.actor?.name || undefined, to: `${base}/characters/${c.id}`, kind: "Character" }));
    (costumes?.items || []).slice(0, 6).forEach((c) => out.push({ key: `k${c.id}`, label: `${c.assetNumber} ${c.name}`, sub: [c.character?.name, c.status].filter(Boolean).join(" · "), to: `${base}/costumes/${c.id}`, kind: "Costume" }));
    return out;
  }, [debounced, scenes, characters, costumes, base]);
  return (
    <div ref={ref} className="gsearch">
      <div className="search" style={{ minWidth: 0 }}>
        <Search size={15} color="var(--text-3)" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search scenes, characters, costumes" onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) { nav(hits[0].to); setOpen(false); setQ(""); } if (e.key === "Escape") setOpen(false); }} />
      </div>
      {open && debounced && (
        <div className="gsearch-menu card">
          {hits.length === 0 ? <div className="subtle small" style={{ padding: 8 }}>No matches</div> : hits.map((h) => (
            <button key={h.key} type="button" className="gsearch-item" onClick={() => { nav(h.to); setOpen(false); setQ(""); }}>
              <span className="grow truncate"><span className="bold">{h.label}</span>{h.sub && <span className="subtle"> · {h.sub}</span>}</span><Badge status="MUTED">{h.kind}</Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
