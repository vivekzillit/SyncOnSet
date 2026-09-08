/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Layout-aware PDF text for schedules and call sheets.
 *
 * pdf-parse returns one flat stream of text runs, which scrambles a call sheet: table columns arrive in
 * the order they were drawn, and a superscript ("16th January") is split across three lines. Reading the
 * same page through pdf.js with the position of every run lets us rebuild the visual rows, and, where the
 * page holds a scene table, read that table by its columns — which is what a call sheet actually is.
 */

// pdf-parse ships pdf.js; use the same copy rather than adding a dependency.
const pdfjs = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");

export interface PdfItem { page: number; x: number; y: number; w: number; em: number; s: string }
export interface PdfRow { page: number; y: number; text: string; items: PdfItem[] }
/** Marks the synopsis that follows a scene on a rebuilt table line; never appears in a real document. */
export const DESC_MARK = " :: ";

/** Every text run of the PDF, grouped into the visual rows a reader would see. */
export async function pdfRows(buffer: Buffer): Promise<PdfRow[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise;
  const rows: PdfRow[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent({ normalizeWhitespace: true });
    const items: PdfItem[] = content.items
      .map((it: any) => ({ page: p, x: it.transform[4], y: it.transform[5], w: it.width, em: Math.abs(it.transform[0]) || it.height || 10, s: it.str }))
      .filter((it: PdfItem) => it.s && it.s.trim() !== "");
    const byY = new Map<number, PdfItem[]>();
    for (const it of items) {
      const key = Math.round(it.y / 2) * 2;
      const bucket = byY.get(key);
      if (bucket) bucket.push(it); else byY.set(key, [it]);
    }
    for (const [y, its] of [...byY.entries()].sort((a, b) => b[0] - a[0])) {
      its.sort((a, b) => a.x - b.x);
      rows.push({ page: p, y, text: joinItems(its), items: its });
    }
  }
  return rows;
}

/** Join runs on one row: no space inside a word, one space between words, a wide gap between columns. */
function joinItems(items: PdfItem[]): string {
  let out = "";
  for (let i = 0; i < items.length; i++) {
    if (i > 0) {
      const prev = items[i - 1];
      const gap = items[i].x - (prev.x + prev.w);
      const em = Math.max(prev.em, 6);
      out += gap < 0.25 * em ? "" : gap < 1.6 * em ? " " : "   ";
    }
    out += items[i].s;
  }
  return out.replace(/\s+$/, "");
}

/* ------------------------------------------------------------------ scene table */

type ColKey = "number" | "set" | "dn" | "pages" | "cast" | "other";
interface Column { key: ColKey; from: number; to: number }
const HEADER_KEYS: { key: ColKey; re: RegExp }[] = [
  { key: "number", re: /^(?:sc|scs|scn|scene)s?\.?\s*(?:#|no\.?|number)?$/i },
  { key: "set", re: /(?:set|scene)?\s*\/?\s*(?:synopsis|description|slugline)|^set$|^location$/i },
  { key: "dn", re: /^d\s*\/\s*n$|^day\s*\/\s*night$/i },
  { key: "pages", re: /^pages?$|^pgs?\.?$|^page\s*count$/i },
  { key: "cast", re: /^cast\s*#?$|^cast\s*nos?\.?$/i },
];
/** A row that ends the scene table: the cast call sheet, the page-count summary, or another table's header. */
const TABLE_END_RE = /^\s*(?:page\s*count|total\b|cast\s+travel|advance|id\b|unit\b|crowd\b|stunts?\b|standins?\b|vehicles?\b|props?\b)/i;
const NUMBER_CELL_RE = /^\d{1,4}\s*[A-Za-z]{0,3}$/;

/**
 * Read a scene table from the rebuilt rows and return one clean line per scene, in document order,
 * so the ordinary schedule reader sees "Sc 107pt   INT HANGAR - NIGHT   3/8 pgs   Cast: 3, 5 :: synopsis".
 * Rows that are not part of a scene table are returned unchanged.
 */
export function rowsToText(rows: PdfRow[]): string {
  const out: string[] = [];
  const byPage = new Map<number, PdfRow[]>();
  for (const r of rows) { const b = byPage.get(r.page); if (b) b.push(r); else byPage.set(r.page, [r]); }
  for (const [, pageRows] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    let i = 0;
    while (i < pageRows.length) {
      const cols = headerColumns(pageRows[i]);
      if (!cols) { out.push(pageRows[i].text); i += 1; continue; }
      const end = pageRows.findIndex((r, j) => j > i && TABLE_END_RE.test(r.text));
      const last = end < 0 ? pageRows.length : end;
      out.push(...tableLines(pageRows.slice(i + 1, last), cols));
      i = last;
    }
  }
  return out.join("\n");
}

/** Runs of items on a row, split where the gap is wide enough to be a column break. */
function runsOf(row: PdfRow): { text: string; x: number }[] {
  const runs: { text: string; x: number }[] = [];
  for (let i = 0; i < row.items.length; i++) {
    const it = row.items[i];
    const prev = row.items[i - 1];
    const wide = !prev || it.x - (prev.x + prev.w) >= 1.6 * Math.max(prev.em, 6);
    if (wide) runs.push({ text: it.s.trim(), x: it.x });
    else runs[runs.length - 1].text = `${runs[runs.length - 1].text}${it.x - (prev.x + prev.w) < 0.25 * Math.max(prev.em, 6) ? "" : " "}${it.s.trim()}`;
  }
  return runs.map((r) => ({ ...r, text: r.text.replace(/\s+/g, " ").trim() })).filter((r) => r.text);
}

/** Column boundaries from a header row, when that row really is a scene table's header. */
function headerColumns(row: PdfRow): Column[] | null {
  const cells: { key: ColKey; x: number }[] = [];
  for (const run of runsOf(row)) {
    const hit = HEADER_KEYS.find((h) => h.re.test(run.text));
    cells.push({ key: hit ? hit.key : "other", x: run.x });
  }
  if (!cells.some((c) => c.key === "number") || !cells.some((c) => c.key === "set")) return null;
  cells.sort((a, b) => a.x - b.x);
  return cells.map((c, i) => ({ key: c.key, from: i === 0 ? -Infinity : c.x - 4, to: i === cells.length - 1 ? Infinity : cells[i + 1].x - 4 }));
}

/**
 * Group the rows under a header into scenes. A scene block is anchored on its slugline row (the one whose
 * SET cell starts with INT/EXT); every other row joins the block whose slugline is nearest, because a call
 * sheet centres the scene number against a multi-line cell, so it can sit above or below the slugline.
 */
function tableLines(rows: PdfRow[], cols: Column[]): string[] {
  const colOf = (x: number) => cols.find((c) => x >= c.from && x < c.to)?.key ?? "other";
  const cellsOf = (row: PdfRow) => {
    const cells = new Map<ColKey, string>();
    const parts = new Map<ColKey, string[]>();
    for (const it of row.items) {
      const key = colOf(it.x);
      const b = parts.get(key);
      if (b) b.push(it.s); else parts.set(key, [it.s]);
    }
    for (const [k, v] of parts) cells.set(k, v.join(" ").replace(/\s+/g, " ").trim());
    return cells;
  };
  const SLUG_START = /^(?:INT|EXT|EST|I\/E|E\/I)\b|^(?:INT|EXT)\.?\s*\/\s*(?:EXT|INT)/i;
  interface Block { y: number; slug: string; number: string; dn: string[]; pages: string[]; cast: string[]; desc: string[] }
  const parsed = rows.map((r) => ({ row: r, cells: cellsOf(r) }));
  // A scene is anchored on its slugline, or on its number when the row carries no slugline at all.
  const anchors: { y: number; slug: string }[] = [];
  for (const { row, cells } of parsed) {
    const set = cells.get("set") || "";
    const num = (cells.get("number") || "").replace(/\s+/g, "");
    const isSlug = SLUG_START.test(set);
    if (!isSlug && !NUMBER_CELL_RE.test(num)) continue;
    const near = anchors.find((a) => Math.abs(a.y - row.y) <= 14);
    if (near) { if (isSlug && !near.slug) near.slug = set; continue; }
    anchors.push({ y: row.y, slug: isSlug ? set : "" });
  }
  const blocks: Block[] = anchors.map((a) => ({ y: a.y, slug: a.slug, number: "", dn: [], pages: [], cast: [], desc: [] }));
  if (!blocks.length) return rows.map((r) => r.text);
  const nearest = (y: number) => blocks.reduce((best, b) => (Math.abs(b.y - y) < Math.abs(best.y - y) ? b : best), blocks[0]);
  for (const { row, cells } of parsed) {
    const b = nearest(row.y);
    const set = cells.get("set") || "";
    if (set && !(SLUG_START.test(set) && set === b.slug)) b.desc.push(set);
    const num = (cells.get("number") || "").replace(/\s+/g, "");
    if (!b.number && NUMBER_CELL_RE.test(num)) b.number = num;
    const dn = cells.get("dn"); if (dn) b.dn.push(dn);
    const pages = cells.get("pages"); if (pages) b.pages.push(pages);
    const cast = cells.get("cast"); if (cast) b.cast.push(cast);
  }
  const TIME_CELL_RE = /\b(DAY|NIGHT|DAWN|DUSK|MORNING|EVENING|AFTERNOON|CONTINUOUS|SUNRISE|SUNSET)\b/i;
  const PAGE_CELL_RE = /\b(\d{1,2}\s+\d{1,2}\/\d|\d{1,2}\/\d)\b/;
  return blocks.filter((b) => b.number || b.slug).map((b) => {
    const dn = TIME_CELL_RE.exec(b.dn.join(" "))?.[1] ?? "";
    const pages = PAGE_CELL_RE.exec(b.pages.join(" "))?.[1] ?? "";
    // Only plain numbers are cast numbers; a stunt or crowd id such as "5X" is not.
    const cast = b.cast.join(",").split(/[,&+]/).map((t) => t.trim()).filter((t) => /^\d{1,3}$/.test(t));
    const parts = [`Sc ${b.number || "?"}`];
    if (b.slug) parts.push(dn ? `${b.slug} - ${dn}` : b.slug);
    else if (dn) parts.push(dn);
    if (pages) parts.push(`${pages} pgs`);
    if (cast.length) parts.push(`Cast: ${[...new Set(cast)].join(", ")}`);
    const line = parts.join("   ");
    const description = b.desc.join(" ").replace(/\s+/g, " ").trim();
    return b.number ? (description ? `${line}${DESC_MARK}${description}` : line) : "";
  }).filter(Boolean);
}

/** Layout-aware text for a PDF, or null when pdf.js cannot read it (the caller falls back to pdf-parse). */
export async function pdfLayoutText(buffer: Buffer): Promise<string | null> {
  try {
    const rows = await pdfRows(buffer);
    if (!rows.length) return null;
    const text = rowsToText(rows);
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}
