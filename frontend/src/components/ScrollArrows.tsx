import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Every table in the app scrolls sideways inside one of these. */
const SELECTOR = ".table-wrap, .table-scroll";
const SIZE = 36;
const GAP = 8;

type Arrow = { key: string; el: HTMLElement; dir: -1 | 1; x: number; y: number };

/**
 * ◀ ▶ buttons on any table that is wider than its box, mounted once for the whole app so no page has to opt in.
 * They float over the scroller's visible middle, show only in a direction there is more to see, and hide when
 * something (a modal, the sticky header, a dropdown) covers the spot they would sit on.
 */
export function ScrollArrows() {
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const layer = useRef<HTMLDivElement>(null);
  const last = useRef("");

  useEffect(() => {
    let raf = 0;
    let next = 0;
    const ids = new WeakMap<HTMLElement, number>();
    const ours = (n: Node | null) => !!n && !!layer.current?.contains(n);
    const clearAt = (el: HTMLElement, x: number, y: number) => {
      const hit = document.elementsFromPoint(x + SIZE / 2, y).find((n) => !ours(n));
      return !!hit && el.contains(hit);
    };

    const measure = () => {
      raf = 0;
      const out: Arrow[] = [];
      document.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
        const max = el.scrollWidth - el.clientWidth;
        if (max < 4) return;
        const r = el.getBoundingClientRect();
        const top = Math.max(r.top, 0);
        const bottom = Math.min(r.bottom, window.innerHeight);
        if (!r.width || bottom - top < SIZE + 12) return;
        const y = (top + bottom) / 2;
        if (!ids.has(el)) ids.set(el, next++);
        const id = ids.get(el)!;
        if (el.scrollLeft > 2 && clearAt(el, r.left + GAP, y)) out.push({ key: `${id}-l`, el, dir: -1, x: r.left + GAP, y });
        if (el.scrollLeft < max - 2 && clearAt(el, r.right - GAP - SIZE, y)) out.push({ key: `${id}-r`, el, dir: 1, x: r.right - GAP - SIZE, y });
      });
      // Only re-render when something moved, so our own buttons appearing never loops back through the observer.
      const sig = out.map((a) => `${a.key}:${Math.round(a.x)},${Math.round(a.y)}`).join("|");
      if (sig !== last.current) { last.current = sig; setArrows(out); }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };

    const mo = new MutationObserver((records) => { if (records.some((m) => !ours(m.target))) schedule(); });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("scroll", schedule, true); // capture: catches every scroller, not just the page
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      mo.disconnect();
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return createPortal(
    <div ref={layer} className="scroll-arrows">
      <style>{"@media print { .scroll-arrows { display: none; } }"}</style>
      {arrows.map((a) => (
        <button key={a.key} type="button" aria-label={a.dir < 0 ? "Scroll left" : "Scroll right"} title={a.dir < 0 ? "Scroll left" : "Scroll right"}
          onClick={() => a.el.scrollBy({ left: a.dir * Math.max(120, a.el.clientWidth * 0.7), behavior: "smooth" })}
          style={{ position: "fixed", left: a.x, top: a.y - SIZE / 2, width: SIZE, height: SIZE, zIndex: 40, borderRadius: 999, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", boxShadow: "0 2px 10px rgba(0,0,0,0.14)", display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}>
          {a.dir < 0 ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>
      ))}
    </div>,
    document.body,
  );
}
