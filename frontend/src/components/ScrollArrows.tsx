import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

/** Tables get the big round buttons over their middle as well; every other scroller just gets the end ones. */
const ROUND = ".table-wrap, .table-scroll";
/** Anything that could be a scroller. Scanned rather than opted into, so a new page needs no wiring. */
const CANDIDATES = "div,section,main,aside,nav,form,ul,ol,table,pre,tbody";
const SIZE = 36;
const GAP = 8;
/** The small buttons sit in the 18px the stylesheet leaves free at each end of a scrollbar. */
const MINI = 18;
/** Below this the browser is drawing a thin overlay bar (a Mac with "show scroll bars" on automatic), which
 *  reserves no room; the buttons then tuck against the scroller's own edge instead of sitting on a bar. */
const REAL_BAR = 8;

type Axis = "x" | "y";
type Arrow = {
  key: string;
  el: HTMLElement;
  axis: Axis;
  dir: -1 | 1;
  x: number;
  y: number;
  /** Set for the small buttons at the ends of a bar: how thick the bar is, and whether this end is reached. */
  mini?: { size: number; off: boolean; over: boolean };
};

/**
 * Arrow buttons on anything that scrolls, mounted once for the whole app so no page has to opt in.
 * Two kinds: small ones at the two ends of a scrollbar — sideways and up/down alike, like a classic Windows
 * bar, always there and dimmed at the end — and, on tables, round ones floating over the middle in whichever
 * direction there is more to see. Both hide when something (a modal, a sticky header, a dropdown) covers the
 * spot they would sit on.
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
    /** True when the point belongs to this scroller rather than to whatever is stacked on top of it. */
    const clearAt = (el: HTMLElement, x: number, y: number) => {
      const hit = document.elementsFromPoint(x, y).find((n) => !ours(n));
      return !!hit && el.contains(hit);
    };
    const scrolls = (overflow: string) => overflow === "auto" || overflow === "scroll";
    /** A finger flicks; only a pointer needs a button to nudge with, so touch screens get none drawn over content. */
    const fine = !window.matchMedia?.("(pointer: coarse)").matches;

    const measure = () => {
      raf = 0;
      const out: Arrow[] = [];
      const seen = new Set<HTMLElement>();
      const add = (el: HTMLElement, round: boolean) => {
        if (seen.has(el) || ours(el)) return;
        seen.add(el);
        const overX = el.scrollWidth - el.clientWidth;
        const overY = el.scrollHeight - el.clientHeight;
        if (overX < 4 && overY < 4) return;
        const style = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        if (!ids.has(el)) ids.set(el, next++);
        const id = ids.get(el)!;

        // Sideways: the bar runs along the bottom inside edge.
        const barH = el.offsetHeight - el.clientHeight - el.clientTop * 2;
        if (overX >= 4 && scrolls(style.overflowX)) {
          if (round) {
            const top = Math.max(r.top, 0);
            const bottom = Math.min(r.bottom, window.innerHeight);
            const y = (top + bottom) / 2;
            if (bottom - top >= SIZE + 12) {
              if (el.scrollLeft > 2 && clearAt(el, r.left + GAP + SIZE / 2, y)) out.push({ key: `${id}-l`, el, axis: "x", dir: -1, x: r.left + GAP, y });
              if (el.scrollLeft < overX - 2 && clearAt(el, r.right - GAP - SIZE / 2, y)) out.push({ key: `${id}-r`, el, axis: "x", dir: 1, x: r.right - GAP - SIZE, y });
            }
          }
          const thick = barH >= REAL_BAR ? barH : fine ? MINI : 0;
          const barTop = barH >= REAL_BAR ? r.top + el.clientTop + el.clientHeight : r.top + el.clientTop + el.clientHeight - thick;
          if (thick && barTop >= 0 && barTop + thick <= window.innerHeight) {
            const barY = barTop + thick / 2;
            const lx = r.left + el.clientLeft;
            const rx = lx + el.clientWidth - MINI;
            const over = barH < REAL_BAR;
            if (clearAt(el, lx + MINI / 2, barY)) out.push({ key: `${id}-ml`, el, axis: "x", dir: -1, x: lx, y: barTop, mini: { size: thick, off: el.scrollLeft <= 2, over } });
            if (clearAt(el, rx + MINI / 2, barY)) out.push({ key: `${id}-mr`, el, axis: "x", dir: 1, x: rx, y: barTop, mini: { size: thick, off: el.scrollLeft >= overX - 2, over } });
          }
        }

        // Up and down: the bar runs along the right inside edge.
        const barW = el.offsetWidth - el.clientWidth - el.clientLeft * 2;
        if (overY >= 4 && scrolls(style.overflowY)) {
          const thick = barW >= REAL_BAR ? barW : fine ? MINI : 0;
          const barLeft = barW >= REAL_BAR ? r.left + el.clientLeft + el.clientWidth : r.left + el.clientLeft + el.clientWidth - thick;
          if (thick && barLeft >= 0 && barLeft + thick <= window.innerWidth) {
            const barX = barLeft + thick / 2;
            const ty = r.top + el.clientTop;
            const by = ty + el.clientHeight - MINI;
            const over = barW < REAL_BAR;
            if (ty >= 0 && clearAt(el, barX, ty + MINI / 2)) out.push({ key: `${id}-mu`, el, axis: "y", dir: -1, x: barLeft, y: ty, mini: { size: thick, off: el.scrollTop <= 2, over } });
            if (by + MINI <= window.innerHeight && clearAt(el, barX, by + MINI / 2)) out.push({ key: `${id}-md`, el, axis: "y", dir: 1, x: barLeft, y: by, mini: { size: thick, off: el.scrollTop >= overY - 2, over } });
          }
        }
      };

      document.querySelectorAll<HTMLElement>(ROUND).forEach((el) => add(el, true));
      document.querySelectorAll<HTMLElement>(CANDIDATES).forEach((el) => add(el, false));

      // The page's own bar is the window's, so it is measured against the viewport rather than a box.
      const root = (document.scrollingElement as HTMLElement) || document.documentElement;
      const pageOver = root.scrollHeight - root.clientHeight;
      const pageBar = window.innerWidth - document.documentElement.clientWidth;
      if (pageOver >= 4 && (pageBar >= REAL_BAR || fine)) {
        const over = pageBar < REAL_BAR;
        const thick = over ? MINI : pageBar;
        const x = over ? window.innerWidth - thick : document.documentElement.clientWidth;
        out.push({ key: "page-u", el: root, axis: "y", dir: -1, x, y: 0, mini: { size: thick, off: root.scrollTop <= 2, over } });
        out.push({ key: "page-d", el: root, axis: "y", dir: 1, x, y: window.innerHeight - MINI, mini: { size: thick, off: root.scrollTop >= pageOver - 2, over } });
      }

      // Only re-render when something moved, so our own buttons appearing never loops back through the observer.
      const sig = out.map((a) => `${a.key}:${Math.round(a.x)},${Math.round(a.y)},${a.mini?.off ?? ""}`).join("|");
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

  const nudge = (a: Arrow, far: boolean) => {
    const step = far ? Math.max(120, (a.axis === "x" ? a.el.clientWidth : a.el.clientHeight) * 0.7) : 80;
    a.el.scrollBy({ [a.axis === "x" ? "left" : "top"]: a.dir * step, behavior: "smooth" } as ScrollToOptions);
  };
  const label = (a: Arrow) => (a.axis === "x" ? (a.dir < 0 ? "Scroll left" : "Scroll right") : a.dir < 0 ? "Scroll up" : "Scroll down");
  const Icon = (a: Arrow, size: number) => {
    const props = { size, strokeWidth: a.mini ? 3 : 2 };
    if (a.axis === "x") return a.dir < 0 ? <ChevronLeft {...props} /> : <ChevronRight {...props} />;
    return a.dir < 0 ? <ChevronUp {...props} /> : <ChevronDown {...props} />;
  };

  return createPortal(
    <div ref={layer} className="scroll-arrows">
      <style>{"@media print { .scroll-arrows { display: none; } }"}</style>
      {arrows.map((a) => a.mini ? (
        <button key={a.key} type="button" aria-label={label(a)} disabled={a.mini.off} onClick={() => nudge(a, false)}
          style={{ position: "fixed", left: a.x, top: a.y, width: a.axis === "x" ? MINI : a.mini.size, height: a.axis === "x" ? a.mini.size : MINI, zIndex: 40, border: a.mini.over ? "1px solid var(--border)" : "none", borderRadius: a.mini.over ? 6 : 3, background: "var(--surface-2)", color: "var(--text-2)", display: "grid", placeItems: "center", cursor: a.mini.off ? "default" : "pointer", padding: 0, opacity: a.mini.off ? 0.35 : a.mini.over ? 0.85 : 1, boxShadow: a.mini.over ? "0 1px 4px rgba(0,0,0,0.12)" : undefined }}>
          {Icon(a, Math.min(14, a.mini.size + 2))}
        </button>
      ) : (
        <button key={a.key} type="button" aria-label={label(a)} title={label(a)} onClick={() => nudge(a, true)}
          style={{ position: "fixed", left: a.x, top: a.y - SIZE / 2, width: SIZE, height: SIZE, zIndex: 40, borderRadius: 999, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", boxShadow: "0 2px 10px rgba(0,0,0,0.14)", display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}>
          {Icon(a, 20)}
        </button>
      ))}
    </div>,
    document.body,
  );
}
