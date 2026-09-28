import readXlsxFile, { readSheetNames } from "read-excel-file/node";
import { badRequest } from "../lib/errors";
import { EXPENSE_CATEGORIES } from "../lib/constants";
import { pdfRows, type PdfItem } from "./pdfLayout";

type Category = (typeof EXPENSE_CATEGORIES)[number];
type Cell = string | number | boolean | Date | null | undefined;

/** One budget line as the sheet states it, before anything is matched to the production. */
export interface SheetLine {
  sheet: string;
  row: number; // 1-based, as the spreadsheet app shows it
  description: string;
  category: Category;
  categoryText: string | null;
  amount: number | null;
  date: string | null; // YYYY-MM-DD
  scene: string | null;
  character: string | null;
  vendor: string | null;
  costume: string | null;
  accountCode: string | null;
  quantity: number | null;
  unit: string | null;
  multiplier: number | null;
  rate: number | null;
  /** Read from a printed budget (PDF): the account's title, the "Name:" the line pays, its department and currency. */
  accountName?: string | null;
  payee?: string | null;
  department?: string | null;
  currency?: string | null;
  /** "Total", "Sub-total" … rows: shown, but not ticked, so a sheet's own sums are not counted twice. */
  isTotal: boolean;
}

type Field = "description" | "category" | "amount" | "qty" | "rate" | "date" | "scene" | "character" | "vendor" | "costume" | "code" | "unit" | "x";

/** Header words each column is recognised by (lower-case, punctuation stripped). First match wins, so order matters. */
const HEADERS: [Field, RegExp][] = [
  ["amount", /^(amount|total|total amount|total cost|cost|spend|spent|actual|actuals|budget|budget amount|value|price|net|net amount|amount inr|amount rs|inr|rs|rupees|₹)$/],
  ["qty", /^(qty|quantity|units|no of units|nos|amt)$/],
  ["unit", /^(unit|uom|per)$/],
  ["x", /^(x|mult|multiplier|times)$/],
  // Movie Magic's "Account" column holds the code (30-001); a sheet's category head goes by the words below instead.
  ["code", /^(account|acct|account no|account code|acct no|code|budget code|a c|ac code)$/], // not a bare "No": that is a serial-number column
  ["rate", /^(rate|unit cost|unit price|cost per unit|price per unit|per day|day rate|rate per day)$/],
  ["date", /^(date|bill date|invoice date|purchase date|expense date|dated)$/],
  ["scene", /^(scene|sc|scene no|scene number|scene #|sc no)$/],
  ["character", /^(character|char|character name|role|cast|artist|actor)$/],
  ["vendor", /^(vendor|supplier|shop|store|paid to|payee|party|merchant)$/],
  ["costume", /^(asset|asset no|asset number|costume|costume no|piece|item code|cst)$/],
  ["category", /^(category|type|head|budget head|account head|expense type|nature)$/],
  ["description", /^(description|item|items|particulars|details|detail|name|expense|line item|narration|remarks|particular|item description|notes)$/],
];

const CATEGORY_WORDS: [Category, RegExp][] = [
  ["RENTAL", /rent|hire|lease/],
  ["LAUNDRY", /laund|wash|dry ?clean|clean|iron|press/],
  ["TAILORING", /tailor|stitch|alter|sew|fitting|master/],
  ["ACCESSORIES", /accessor|jewel|shoe|footwear|bag|belt|hat|cap|wig|watch|glass|prop/],
  ["DAMAGE", /damage|repair|loss|lost|missing/],
  ["PURCHASE", /purchas|buy|bought|fabric|material|cloth|dress|shirt|saree|sari/],
];

const norm = (v: Cell) => String(v ?? "").toLowerCase().replace(/[^a-z0-9₹# ]+/g, " ").replace(/\s+/g, " ").trim();
const text = (v: Cell): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s ? s : null;
};

/** "₹ 1,20,000.50", "Rs. 500/-", "(1,200)" and 1200 all read as numbers; anything else is not an amount. */
export function toAmount(v: Cell): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = text(v);
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  const cleaned = s.replace(/^\(|\)$/g, "").replace(/rs\.?|inr|₹|\/-|,|\s/gi, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return neg ? -n : n;
}

/** Excel dates arrive as Date objects; typed ones as "28/09/2026", "28-Sep-2026" or "2026-09-28" (day-first, Indian style). */
function toDate(v: Cell): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = text(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  // "22-Sep-2026", "22 September 2026", "Sep 22, 2026": read by hand, since Date.parse would shift them a day in IST.
  const mon = (w: string) => MONTHS.findIndex((x) => w.toLowerCase().startsWith(x)) + 1;
  m = s.match(/^(\d{1,2})[-/ .]([A-Za-z]{3,9})[-/ .,]*(\d{2,4})$/);
  if (m && mon(m[2])) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], mon(m[2]), +m[1]);
  m = s.match(/^([A-Za-z]{3,9})[-/ .]+(\d{1,2})[, ]+(\d{4})$/);
  if (m && mon(m[1])) return iso(+m[3], mon(m[1]), +m[2]);
  return null;
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (y: number, mo: number, d: number) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null);

export function toCategory(v: string | null, fallback: string): Category {
  const s = norm(v);
  const exact = EXPENSE_CATEGORIES.find((c) => c.toLowerCase() === s);
  if (exact) return exact;
  for (const hay of [s, norm(fallback)]) for (const [c, re] of CATEGORY_WORDS) if (hay && re.test(hay)) return c;
  return "OTHER";
}

/** The first row (of the first 15) that names at least an amount and one other known column is the header. */
function findHeader(rows: Cell[][]): { at: number; cols: Partial<Record<Field, number>> } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cols: Partial<Record<Field, number>> = {};
    rows[i].forEach((cell, c) => {
      const h = norm(cell);
      if (!h) return;
      const hit = HEADERS.find(([f, re]) => cols[f] === undefined && re.test(h));
      if (hit) cols[hit[0]] = c;
    });
    const known = Object.keys(cols).length;
    if ((cols.amount !== undefined || (cols.qty !== undefined && cols.rate !== undefined)) && known >= 2) return { at: i, cols };
  }
  return null;
}

function linesOf(sheet: string, rows: Cell[][]): SheetLine[] {
  const head = findHeader(rows);
  if (!head) return [];
  const { cols } = head;
  const at = (r: Cell[], f: Field) => (cols[f] === undefined ? undefined : r[cols[f]!]);
  const out: SheetLine[] = [];
  for (let i = head.at + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => text(c) == null)) continue;
    let amount = toAmount(at(r, "amount"));
    const q = toAmount(at(r, "qty"));
    const rate = toAmount(at(r, "rate"));
    const x = toAmount(at(r, "x"));
    if (amount == null && q != null && rate != null) amount = Math.round(q * (x ?? 1) * rate * 100) / 100;
    // With no description column, the first text cell that is not some other known column describes the line.
    const used = new Set(Object.values(cols));
    const description = text(at(r, "description")) || r.map((c, j) => (used.has(j) || typeof c === "number" ? null : text(c))).find(Boolean) || null;
    if (amount == null && !description) continue;
    const categoryText = text(at(r, "category"));
    const label = `${description || ""} ${categoryText || ""}`.toLowerCase();
    out.push({
      sheet,
      row: i + 1,
      description: description || categoryText || `Row ${i + 1}`,
      category: toCategory(categoryText, `${description || ""} ${sheet}`),
      categoryText,
      amount,
      date: toDate(at(r, "date")),
      scene: text(at(r, "scene"))?.replace(/^(sc(ene)?\.?\s*)/i, "") || null,
      character: text(at(r, "character")),
      vendor: text(at(r, "vendor")),
      costume: text(at(r, "costume")),
      accountCode: text(at(r, "code")),
      quantity: q,
      unit: text(at(r, "unit")),
      multiplier: x,
      rate,
      isTotal: /\b(grand )?(sub ?)?totals?\b/.test(label),
    });
  }
  return out;
}

/** CSV with quoted fields ("a, b", "say ""hi""") — enough for what Excel and Sheets export. */
function parseCsv(src: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** Every budget line in the file, from every sheet that has a recognisable header row. Nothing is stored. */
export async function readBudgetSheet(file: { originalname: string; buffer: Buffer }): Promise<{ lines: SheetLine[]; sheets: string[]; skippedSheets: string[] }> {
  const ext = (file.originalname.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") {
    const lines = await readBudgetPdf(file.buffer);
    const departments = [...new Set(lines.map((l) => l.department || "Budget"))];
    return { lines, sheets: departments, skippedSheets: [] };
  }
  if (ext === "xls" || ext === "numbers" || ext === "ods") throw badRequest(`.${ext} files can't be read. Save the sheet as .xlsx (Excel Workbook) or .csv and upload that.`);
  if (ext === "csv" || ext === "txt") {
    const lines = linesOf("CSV", parseCsv(file.buffer.toString("utf8").replace(/^﻿/, "")));
    return { lines, sheets: ["CSV"], skippedSheets: lines.length ? [] : ["CSV"] };
  }
  if (ext !== "xlsx" && ext !== "xlsm") throw badRequest("Upload an Excel workbook (.xlsx), a .csv file or a budget PDF.");
  let names: string[];
  try { names = await readSheetNames(file.buffer); } catch { throw badRequest("That file could not be opened as an Excel workbook. Save it again as .xlsx and retry."); }
  const lines: SheetLine[] = [];
  const skippedSheets: string[] = [];
  for (const name of names) {
    const rows = (await readXlsxFile(file.buffer, { sheet: name })) as Cell[][];
    const got = linesOf(name, rows);
    if (got.length) lines.push(...got); else skippedSheets.push(name);
  }
  return { lines, sheets: names, skippedSheets };
}

/* ---------- Printed budget (Movie Magic style PDF) ---------- */

const CURRENCY_SIGNS: [RegExp, string][] = [[/£/, "GBP"], [/€/, "EUR"], [/₹|rs\.?/i, "INR"], [/\$/, "USD"]];
const DEPT_ROW = /^(\d{2,3}-0{2,3})\s*-\s*(.+)$/; // "30-000 - WARDROBE"
const ACCOUNT_CODE = /^\d{2,3}-\d{2,4}$/; // "30-001"

/**
 * A budget printed from Movie Magic (or anything laid out like it): per detail page a header row
 * Account · Description · Amt · Unit · X · Rate · Subtotal, then "30-000 - WARDROBE", "30-001 COSTUME DESIGNER",
 * "Name: …" rows and the costed lines. Each run is placed in a column by where it sits under that header, so
 * right-aligned numbers and truncated descriptions still land in the right cell. The topsheet (Account ·
 * Description · Total, no Amt or Rate) is not a detail page and is skipped, as are Subtotal / Total rows,
 * which the lines already add up to.
 */
export async function readBudgetPdf(buffer: Buffer): Promise<SheetLine[]> {
  let rows;
  try { rows = await pdfRows(buffer); } catch { throw badRequest("That PDF could not be read. If it is scanned, export the budget from the budgeting software as a PDF or Excel file instead."); }
  const out: SheetLine[] = [];
  type Cols = { desc: number; amt: number; unit: number; x: number; rate: number; sub: number };
  let cols: Cols | null = null;
  let page = 0;
  let department: string | null = null;
  let account: { code: string; name: string } | null = null;
  let payee: string | null = null;
  const colOf = (it: PdfItem, c: Cols) => {
    if (it.x < c.desc - 5) return "account";
    if (it.x < c.amt - 15) return "desc";
    if (it.x < c.unit - 2) return "amt";
    if (it.x < c.x - 15) return "unit";
    if (it.x < c.rate - 28) return "x";
    if (it.x < c.sub - 2) return "rate";
    return "sub";
  };
  for (const r of rows) {
    if (r.page !== page) { page = r.page; cols = null; }
    const words = r.items.map((i) => i.s.trim().toLowerCase());
    if (words.includes("account") && words.includes("amt") && words.includes("rate")) {
      const at = (w: string) => r.items[words.indexOf(w)].x;
      cols = { desc: at("description"), amt: at("amt"), unit: at("unit"), x: words.includes("x") ? at("x") : (at("unit") + at("rate")) / 2, rate: at("rate"), sub: words.includes("subtotal") ? at("subtotal") : at("rate") + 40 };
      continue;
    }
    if (!cols) continue; // page title, topsheet, or anything above the table header
    const cell: Record<string, string> = {};
    for (const it of r.items) { const k = colOf(it, cols); cell[k] = cell[k] ? `${cell[k]} ${it.s.trim()}` : it.s.trim(); }
    const acc = (cell.account || "").replace(/\s*cont\.*…?$/i, "").trim();
    const dept = (cell.account || r.text).match(DEPT_ROW);
    if (dept && !cell.sub) { department = `${dept[1]} ${dept[2].trim()}`; account = null; payee = null; continue; }
    if (ACCOUNT_CODE.test(acc) && !/cont/i.test(cell.account || "") && cell.desc && !cell.sub) { account = { code: acc, name: cell.desc }; payee = null; continue; }
    if (cell.account && !ACCOUNT_CODE.test(acc)) continue; // running footer: production title, "Page: 3"
    const desc = (cell.desc || "").trim();
    if (!desc) continue;
    const name = desc.match(/^name:\s*(.*)$/i);
    // "Name: TOMMY ROYAL" usually heads the lines below it, but can carry money itself (1 Week × 2,500): then it is a line too.
    if (name) { payee = name[1].trim() || null; if (!cell.sub) continue; }
    if (/^(sub ?)?total\b|^grand total\b/i.test(desc) || /^start:/i.test(desc) || /^-{2,}$/.test(desc)) continue;
    const amount = toAmount(cell.sub?.replace(/[£€$]/g, ""));
    if (amount == null) continue; // a heading inside the account ("01. PRINCIPAL COSTUME STANDBY"), no money on it
    const currency = CURRENCY_SIGNS.find(([re]) => re.test(cell.sub || ""))?.[1] || null;
    const unit = cell.unit?.trim() || null;
    out.push({
      sheet: department || "Budget",
      row: r.page,
      description: (name ? name[1] : desc).replace(/…$/, "").trim() || desc,
      category: toCategory(null, `${desc} ${account?.name || ""} ${department || ""}`),
      categoryText: account ? `${account.code} ${account.name}` : null,
      amount,
      date: null,
      scene: null, character: null, vendor: null, costume: null,
      accountCode: account?.code || null,
      accountName: account?.name || null,
      payee,
      department,
      currency,
      quantity: toAmount(cell.amt),
      unit: unit && !/^\d/.test(unit) ? unit : null,
      multiplier: toAmount(cell.x),
      rate: toAmount(cell.rate),
      isTotal: false,
    });
  }
  return out;
}
