import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { fmtDateTime, humanize } from "@/lib/format";
import type { Character, Scene } from "@/api/types";
import { Card, Empty, Modal, PageHead, SearchBox, Select, Spinner } from "@/components/ui";

interface GalleryPhoto { id: string; entityType: string; entityId: string; kind: string; url: string; caption?: string | null; createdAt: string; label: string; link: string; characterId?: string | null; sceneId?: string | null }
const TYPES = ["COSTUME", "CHANGE", "CHARACTER", "ACTOR", "FITTING", "CONTINUITY", "CLEANING", "DAMAGE"];

/** Every photo in the production, filterable by what it shows. */
export default function Gallery() {
  const { projectId } = useProject();
  const base = `/p/${projectId}`;
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [preview, setPreview] = useState<GalleryPhoto | null>(null);
  const { data: characters } = useQuery({ queryKey: ["characters", projectId], queryFn: () => api<Character[]>(p(projectId, "/characters")) });
  const { data: scenes } = useQuery({ queryKey: ["scenes", projectId], queryFn: () => api<Scene[]>(p(projectId, "/scenes")) });
  const qs = new URLSearchParams({ q, entityType: type, characterId, sceneId });
  const { data, isLoading } = useQuery({ queryKey: ["gallery", projectId, qs.toString()], queryFn: () => api<{ items: GalleryPhoto[]; total: number }>(p(projectId, `/photos/gallery?${qs}`)) });
  return (
    <div>
      <PageHead title="Gallery" sub={data ? `${data.total} photo${data.total === 1 ? "" : "s"} across looks, fittings, continuity, cleaning and damage` : "All photos in this production"} />
      <div className="filters">
        <SearchBox value={q} onChange={setQ} placeholder="Search labels and captions" />
        <Select value={type} onChange={(e) => setType(e.target.value)} options={TYPES} placeholder="Any type" />
        <Select value={characterId} onChange={(e) => setCharacterId(e.target.value)} options={(characters || []).map((c) => ({ value: c.id, label: c.name }))} placeholder="Any character" />
        <Select value={sceneId} onChange={(e) => setSceneId(e.target.value)} options={(scenes || []).map((s) => ({ value: s.id, label: `Sc ${s.number}` }))} placeholder="Any scene" />
      </div>
      <Card>
        {isLoading ? <Spinner /> : !data?.items.length ? <Empty icon="🖼" title="No photos yet" hint="Photos added to looks, fittings, continuity takes, cleaning tickets and damage reports appear here." /> : (
          <div className="photos" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
            {data.items.map((ph) => (
              <div key={ph.id} className="photo" style={{ aspectRatio: "1" }} onClick={() => setPreview(ph)} title={ph.label}>
                <img src={ph.url} alt={ph.label} loading="lazy" />
                <span className="kind">{ph.kind}</span>
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "18px 8px 6px", background: "linear-gradient(transparent, rgba(20,21,26,0.75))", color: "#fff", fontSize: 11, fontWeight: 600 }} className="truncate">{ph.label}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview ? preview.label : ""} wide footer={preview?.link ? <Link to={`${base}/${preview.link}`} className="btn btn-primary" onClick={() => setPreview(null)}>Open</Link> : undefined}>
        {preview && (<div className="col gap-1"><img src={preview.url} alt={preview.label} style={{ width: "100%", borderRadius: 10 }} /><div className="subtle small">{humanize(preview.entityType)} · {humanize(preview.kind)} · {fmtDateTime(preview.createdAt)}{preview.caption ? ` · ${preview.caption}` : ""}</div></div>)}
      </Modal>
    </div>
  );
}
