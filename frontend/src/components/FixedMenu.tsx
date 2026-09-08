import { useEffect, useRef, type ReactNode } from "react";

const ITEMS = '[role="menuitem"]:not([disabled])';

/**
 * A position:fixed popup menu (so it escapes table overflow clipping). Closes on outside click, scroll or Escape;
 * focuses its first item on open, ArrowUp/ArrowDown/Home/End move between items, and focus returns to `anchor` on close.
 * Mount it with a `key` per subject (e.g. the scene id) so item state such as an armed ConfirmButton never carries over.
 */
export function FixedMenu({ top, left, width = 160, label, anchor, onClose, children }: { top: number; left: number; width?: number; label: string; anchor?: HTMLElement | null; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const openedAt = Date.now();
    const close = () => closeRef.current();
    const onScroll = () => { if (Date.now() - openedAt > 300) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    ref.current?.querySelector<HTMLElement>(ITEMS)?.focus();
    const back = anchor;
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      if (back?.isConnected) back.focus();
    };
    // Runs once per mount: the caller re-keys the menu when its subject changes.
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEMS) || []);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length].focus(); };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
  };

  return (
    <div ref={ref} className="card" role="menu" aria-label={label} style={{ position: "fixed", top, left, zIndex: 45, padding: 6, width }} onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
