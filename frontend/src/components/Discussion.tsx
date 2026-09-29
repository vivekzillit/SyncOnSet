import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Mail, Megaphone, MessageCircle, Send, Share2, Trash2 } from "lucide-react";
import { api, p } from "@/api/client";
import { useProject } from "@/state/project";
import { useAuth, REQUEST_ROLES } from "@/state/auth";
import { relativeTime } from "@/lib/format";
import { ConfirmButton, Modal, Spinner, initials, useToast } from "@/components/ui";
import { SendRequestModal } from "@/components/SendRequest";
import "./discussion.css";

const ZILLIT_WEB = "https://web.zillit.com";

export type ChatEntity = "BUDGET" | "EXPENSE" | "ALTERATION" | "DAMAGE" | "MISSING" | "FITTING";
interface Comment { id: string; userId: string; userName: string; body: string; createdAt: string }

/**
 * Send a request, Share and Chat for one record (expense, alteration, damage, missing item, fitting).
 * `title` names the record and `summary` is the text a share carries — and the message a request starts from,
 * so every record is chased the same way, whoever it concerns. `path` is the page the record lives on:
 * a list page gets `#rec-<id>` so the link scrolls to that record, and `?chat=<id>` (used by chat notifications)
 * opens its chat.
 */
export function RecordActions({ entityType, entityId, title, summary, path }: { entityType: ChatEntity; entityId: string; title: string; summary: string; path: string }) {
  const { projectId, project, can } = useProject();
  const loc = useLocation();
  const nav = useNavigate();
  const anchor = useRef<HTMLSpanElement>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const { data: counts } = useQuery({ queryKey: ["comment-counts", projectId, entityType], queryFn: () => api<Record<string, number>>(p(projectId, `/comments/counts?entityType=${entityType}`)) });
  const count = counts?.[entityId] || 0;

  // Arriving from a shared link or a chat notification: bring this record into view, and open its chat if asked.
  useEffect(() => {
    const params = new URLSearchParams(loc.search);
    if (loc.hash === `#rec-${entityId}` || params.get("chat") === entityId) {
      const card = anchor.current?.closest(".card, .item") as HTMLElement | null;
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      card?.classList.add("rec-flash");
      setTimeout(() => card?.classList.remove("rec-flash"), 2200);
    }
    if (params.get("chat") === entityId) {
      setChatOpen(true);
      params.delete("chat");
      nav({ search: params.toString(), hash: loc.hash }, { replace: true });
    }
  }, [loc.search, loc.hash, entityId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rows can sit inside a link; these buttons must never also open it.
  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  const url = `${window.location.origin}${path}${path.includes(`/${entityId}`) ? "" : `#rec-${entityId}`}`;

  return (
    <span className="rec-actions" ref={anchor} onClick={(e) => e.stopPropagation()}>
      {can(REQUEST_ROLES) && <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { stop(e); setSendOpen(true); }} aria-label={`Send a request about ${title}`} title="Send a request"><Megaphone size={15} /></button>}
      <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { stop(e); setShareOpen(true); }} aria-label={`Share ${title}`} title="Share"><Share2 size={15} /></button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { stop(e); setChatOpen(true); }} aria-label={`Chat about ${title}${count ? ` (${count} messages)` : ""}`} title="Chat">
        <MessageCircle size={15} />{count > 0 && <span className="rec-count">{count}</span>}
      </button>
      <SendRequestModal open={sendOpen} onClose={() => setSendOpen(false)} title={`Send a request · ${title}`}
        defaultTitle={`${title}${project?.name ? ` · ${project.name}` : ""}`.slice(0, 160)}
        defaultBody={`${summary}\n${url}`} entityType={entityType} entityId={entityId} />
      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} title={title} summary={summary} url={url} />
      <ChatModal open={chatOpen} onClose={() => setChatOpen(false)} entityType={entityType} entityId={entityId} title={title} />
    </span>
  );
}

function ShareModal({ open, onClose, title, summary, url }: { open: boolean; onClose: () => void; title: string; summary: string; url: string }) {
  const toast = useToast();
  const text = `${summary}\n${url}`;
  const canNative = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.push("Copied", "ok"); onClose(); } catch { toast.push("Could not copy", "danger"); }
  };
  const native = async () => {
    try { await navigator.share({ title, text: summary, url }); onClose(); } catch { /* the share sheet was dismissed */ }
  };
  /**
   * Zillit takes shared text through its phone app's share extension, so on a phone this opens the share sheet
   * (pick Zillit there). Zillit has no web address that accepts a message, so on a computer the message is
   * copied and Zillit web opens in a new tab to paste it into a chat.
   */
  const zillit = async () => {
    const ua = navigator.userAgent;
    const phone = /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (phone && canNative) return native();
    // Copy before opening: once the new tab has focus, the browser can refuse the clipboard.
    let copied = true;
    try { await navigator.clipboard.writeText(text); } catch { copied = false; }
    window.open(ZILLIT_WEB, "_blank", "noopener");
    if (!copied) return toast.push("Opened Zillit. Copy the message above to paste it there", "default");
    toast.push("Copied. Paste it into a Zillit chat", "ok");
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={`Share · ${title}`}>
      <pre className="share-preview">{text}</pre>
      <div className="share-grid">
        {canNative && <button type="button" className="btn" onClick={native}><Share2 size={16} /> Share…</button>}
        <button type="button" className="btn" onClick={zillit}><span className="zillit-mark" aria-hidden>Z</span> Zillit</button>
        <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" onClick={onClose}>WhatsApp</a>
        <a className="btn" href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`} onClick={onClose}><Mail size={16} /> Email</a>
        <button type="button" className="btn" onClick={copy}><Copy size={16} /> Copy</button>
      </div>
      <div className="subtle small mt-2">The link opens this record for anyone signed in to the production.</div>
    </Modal>
  );
}

function ChatModal({ open, onClose, entityType, entityId, title }: { open: boolean; onClose: () => void; entityType: ChatEntity; entityId: string; title: string }) {
  const { projectId } = useProject();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const key = ["comments", projectId, entityType, entityId];
  // Polled while open so a conversation reads live without a socket.
  const { data: messages, isLoading } = useQuery({ queryKey: key, queryFn: () => api<Comment[]>(p(projectId, `/comments?entityType=${entityType}&entityId=${entityId}`)), enabled: open, refetchInterval: open ? 8000 : false });
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["comment-counts", projectId, entityType] }); };
  const send = useMutation({
    mutationFn: () => api<Comment>(p(projectId, "/comments"), { body: { entityType, entityId, body: text.trim() } }),
    onSuccess: () => { setText(""); refresh(); },
    onError: (e: Error) => toast.push(e.message, "danger"),
  });
  const del = useMutation({ mutationFn: (id: string) => api(p(projectId, `/comments/${id}`), { method: "DELETE" }), onSuccess: refresh, onError: (e: Error) => toast.push(e.message, "danger") });
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages?.length, open]);
  const canSend = !!text.trim() && !send.isPending;

  return (
    // Only an unsent message counts as unsaved: once sent, closing never asks.
    <Modal open={open} onClose={onClose} title={`Chat · ${title}`} dirty={!!text.trim()}>
      <div className="chat-thread">
        {isLoading ? <Spinner /> : !messages?.length ? <div className="subtle center" style={{ padding: 24 }}>No messages yet. Start the conversation — everyone on the production is notified.</div> : messages.map((m) => {
          const mine = m.userId === user?.id;
          return (
            <div key={m.id} className={`chat-msg ${mine ? "mine" : ""}`}>
              {!mine && <div className="avatar sm" title={m.userName}>{initials(m.userName)}</div>}
              <div className="chat-bubble">
                <div className="chat-meta"><b>{mine ? "You" : m.userName}</b> · {relativeTime(m.createdAt)}
                  {mine && <ConfirmButton className="btn btn-ghost btn-sm chat-del" confirmText="Delete?" aria-label="Delete message" onConfirm={() => del.mutate(m.id)}><Trash2 size={12} /></ConfirmButton>}
                </div>
                <div className="chat-body">{m.body}</div>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <div className="chat-compose">
        <textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message… (Enter to send, Shift+Enter for a new line)" autoFocus
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (canSend) send.mutate(); } }} />
        <button type="button" className="btn btn-primary" disabled={!canSend} onClick={() => send.mutate()} aria-label="Send"><Send size={16} /></button>
      </div>
    </Modal>
  );
}
