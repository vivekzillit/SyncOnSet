import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { relativeTime } from "@/lib/format";
import type { Notification } from "@/api/types";
import { Card, Dot, Empty, PageHead, Spinner } from "@/components/ui";

export default function Notifications() {
  const { projectId } = useProject();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["notifications", projectId], queryFn: () => api<{ items: Notification[]; unread: number }>(p(projectId, "/notifications")) });
  const markRead = useMutation({ mutationFn: (ids?: string[]) => api(p(projectId, "/notifications/read"), { body: { ids } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", projectId] }) });
  const base = `/p/${projectId}`;
  const open = (n: Notification) => {
    if (!n.read) markRead.mutate([n.id]);
    const map: Record<string, string> = { COSTUME: "costumes", CLEANING: "cleaning", ALTERATION: "alterations", DAMAGE: "damages", FITTING: "fittings", RENTAL: "vendors" };
    if (n.entityType && n.entityId && (n.entityType === "COSTUME" || n.entityType === "CLEANING" || n.entityType === "FITTING")) nav(`${base}/${map[n.entityType]}/${n.entityId}`);
    else if (n.entityType && map[n.entityType]) nav(`${base}/${map[n.entityType]}`);
  };
  return (
    <div>
      <PageHead title="Notifications" sub={data ? `${data.unread} unread` : ""} actions={<button className="btn btn-sm" onClick={() => markRead.mutate(undefined)} disabled={!data?.unread}>Mark all read</button>} />
      <Card pad0>
        {isLoading ? <Spinner /> : !data?.items.length ? <Empty icon="🔔" title="No notifications" /> : (
          <div className="list">
            {data.items.map((n) => (
              <div key={n.id} className="item link" onClick={() => open(n)} style={{ background: n.read ? undefined : "#fffbf0" }}>
                <Dot status={n.severity} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="title">{n.title}</div>
                  <div className="meta">{n.body}</div>
                </div>
                <div className="end subtle">{relativeTime(n.createdAt)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
