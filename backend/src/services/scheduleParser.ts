import pdfParse from "pdf-parse";
import { badRequest } from "../lib/errors";

/**
 * Deterministic reader for shooting schedules and call sheets (PDF text, CSV or plain text).
 * It finds shoot dates and the scene numbers that belong to each, so scenes can be given a shoot date.
 * No AI: the same document always reads the same way, and the user reviews every date before it is applied.
 */
export type DocKind = "SCHEDULE" | "CALLSHEET";
export interface ParsedDay { date: string | null; dayNumber: number | null; label: string; scenes: string[] }
export interface ParsedSchedule {
  kind: DocKind;
  date: string | null; // call sheet shoot date, or the first shoot day of a schedule
  dayNumber: number | null; // "Day 5 of 30" on a call sheet
  days: ParsedDay[];
  warnings: string[];
  stats: { lines: number; dateLines: number; sceneLines: number; format: "csv" | "text" };
}
export interface DateHit { iso: string; index: number; assumedYear: boolean; ambiguous: boolean; text: string }
export interface ParseOptions { kind: DocKind; defaultYear: number; csv?: boolean; monthFirst?: boolean }

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAY_RE = /\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b/i;
const NUM = String.raw`\d{1,4}[A-Za-z]{0,2}`;
const LIST_RE = new RegExp(String.raw`\b(?:scenes?|scs?)\.?\s*(?:#|no\.?|number)?\s*:?\s*(${NUM}\b(?:\s*(?:,|&|\/|\+|\band\b)\s*${NUM}\b)*)`, "gi");
const STRIP_RE = new RegExp(String.raw`^\s*(${NUM})\b\s*[-–:.]?\s*(?:INT|EXT|I\/E|E\/I|INT\/EXT|EXT\/INT|EST)\b`, "i");
const SPLIT_RE = /\s*(?:,|&|\/|\+|\band\b)\s*/i;
const DAY_RES = [/\bshoot(?:ing)?\s*day\s*#?\s*(\d{1,3})\b/i, /\bday\s*#?\s*(\d{1,3})\s*(?:of|\/)\s*\d{1,3}\b/i, /^\s*(?:end\s+(?:of\s+)?)?day\s*#?\s*(\d{1,3})\b/i];
const END_RE = /\bend\s+(?:of\s+)?(?:shoot(?:ing)?\s+)?day\b/i;
// Lines whose date is not a shoot date (revision stamps, print dates, birthdays).
const META_RE = /\b(?:rev(?:ised|ision)?|version|printed|generated|updated|created|issued|dob|born|expires?)\b/i;
const TOTAL_RE = /\btotal\b/i;

const pad = (n: number) => String(n).padStart(2, "0");
function iso(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
/** Two-digit years are only accepted for the 2020s and 2030s, so "1.2.3"-style version numbers never become dates. */
function year(raw: string | undefined, fallback: number): { y: number; assumed: boolean } | null {
  if (!raw) return { y: fallback, assumed: true };
  const n = Number(raw);
  if (raw.length === 2) return n >= 20 && n <= 39 ? { y: 2000 + n, assumed: false } : null;
  return { y: n, assumed: false };
}
const unique = <T,>(xs: T[]) => Array.from(new Set(xs));
export const normalizeNumber = (n: string) => n.trim().toUpperCase().replace(/^0+(?=\d)/, "");

/** Every date written in a line as yyyy-mm-dd. Numeric dates read as day/month (Indian and UK convention) unless the day slot is over 12. */
export function findDates(line: string, defaultYear: number, monthFirst = false): DateHit[] {
  const hits: DateHit[] = [];
  const push = (isoDate: string | null, index: number, text: string, assumedYear: boolean, ambiguous: boolean) => {
    if (!isoDate) return;
    if (hits.some((h) => index < h.index + h.text.length && h.index < index + text.length)) return; // overlaps an earlier hit
    hits.push({ iso: isoDate, index, text, assumedYear, ambiguous });
  };
  for (const m of line.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) push(iso(+m[1], +m[2], +m[3]), m.index!, m[0], false, false);
  const re1 = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?[\s\-.]{0,2}${MONTH}\.?(?:[\s\-.,]{1,2}(\d{4}|\d{2}))?\b`, "gi");
  for (const m of line.matchAll(re1)) {
    const y = year(m[3], defaultYear); if (!y) continue;
    push(iso(y.y, MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]), m.index!, m[0], y.assumed, false);
  }
  const re2 = new RegExp(String.raw`\b${MONTH}\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b,?(?:\s+(\d{4}))?`, "gi");
  for (const m of line.matchAll(re2)) {
    const y = year(m[3], defaultYear); if (!y) continue;
    push(iso(y.y, MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]), m.index!, m[0], y.assumed, false);
  }
  for (const m of line.matchAll(/(?<![\d\-\/.])(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})(?![\d\/.\-])/g)) {
    const a = +m[1], b = +m[2]; const y = year(m[3], defaultYear); if (!y) continue;
    let day = a, month = b, ambiguous = false;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { day = b; month = a; }
    else { ambiguous = a !== b; if (monthFirst) { day = b; month = a; } }
    push(iso(y.y, month, day), m.index!, m[0], false, ambiguous);
  }
  return hits.sort((x, y) => x.index - y.index);
}

/** Scene numbers named on a line: "Sc 12", "Scenes 12, 13A & 14", or a strip that starts with the number and INT./EXT. */
export function scenesOf(line: string): string[] {
  const out: string[] = [];
  const strip = STRIP_RE.exec(line);
  if (strip) out.push(strip[1]);
  for (const m of line.matchAll(LIST_RE)) for (const n of m[1].split(SPLIT_RE)) if (n.trim()) out.push(n.trim());
  return unique(out.map(normalizeNumber));
}
export function dayNumberOf(line: string): number | null {
  for (const re of DAY_RES) { const m = re.exec(line); if (m) return Number(m[1]); }
  return null;
}

/** Call sheets: the shoot date is the header date that looks most like one (weekday, "day", "date"), never a revision stamp. */
function pickSheetDate(lines: string[], opts: ParseOptions): string | null {
  let best: { iso: string; score: number } | null = null;
  let seen = 0;
  for (const raw of lines) {
    const line = raw.trim(); if (!line) continue;
    if (++seen > 60) break;
    if (META_RE.test(line)) continue;
    const hit = findDates(line, opts.defaultYear, opts.monthFirst)[0]; if (!hit) continue;
    const score = (WEEKDAY_RE.test(line) ? 3 : 0) + (/\b(?:shoot|day)\b/i.test(line) ? 2 : 0) + (/\bdate\b/i.test(line) ? 1 : 0);
    if (!best || score > best.score) best = { iso: hit.iso, score };
  }
  return best?.iso ?? null;
}

function splitCsv(line: string, sep: string): string[] {
  const cells: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}
function looksLikeCsv(lines: string[]): boolean {
  const head = lines.find((l) => l.trim()); if (!head) return false;
  const cells = splitCsv(head, head.includes("\t") ? "\t" : ",");
  return cells.length >= 2 && cells.some((c) => /scene|^scs?\.?$/i.test(c));
}
/** A spreadsheet export with Scene and Date columns (a blank date continues the day above, as one-row-per-scene exports do). */
function parseCsv(lines: string[], opts: ParseOptions, warnings: string[]): ParsedSchedule | null {
  const headIdx = lines.findIndex((l) => l.trim());
  const sep = lines[headIdx].includes("\t") ? "\t" : ",";
  const header = splitCsv(lines[headIdx], sep).map((h) => h.toLowerCase());
  const sceneCol = header.findIndex((h) => /^(?:scs?|scenes?)\.?(?:\s*(?:#|no\.?|number))?$/.test(h) || h.includes("scene"));
  if (sceneCol < 0) return null;
  const dateCol = header.findIndex((h) => h.includes("date"));
  const dayCol = header.findIndex((h) => /^(?:shoot(?:ing)?\s*)?day(?:\s*(?:#|no\.?|number))?$/.test(h));
  if (dateCol < 0) warnings.push("The file has no Date column, so the scenes could not be given a shoot date.");
  const groups = new Map<string, ParsedDay>();
  let currentDate: string | null = null; let currentDay: number | null = null;
  let sceneLines = 0, dateLines = 0, ambiguous = 0, assumedYear = 0;
  for (const raw of lines.slice(headIdx + 1)) {
    if (!raw.trim()) continue;
    const cells = splitCsv(raw, sep);
    const dateCell = dateCol >= 0 ? cells[dateCol] || "" : "";
    if (dateCell) {
      const hit = findDates(dateCell, opts.defaultYear, opts.monthFirst)[0];
      if (hit) { currentDate = hit.iso; dateLines++; if (hit.ambiguous) ambiguous++; if (hit.assumedYear) assumedYear++; }
      else { currentDate = null; warnings.push(`Could not read the date "${dateCell}".`); }
    }
    if (dayCol >= 0 && cells[dayCol]) { const n = parseInt(cells[dayCol], 10); if (!Number.isNaN(n)) currentDay = n; }
    const scenes = (cells[sceneCol] || "").split(SPLIT_RE).map(normalizeNumber).filter((n) => /^\d{1,4}[A-Z]{0,2}$/.test(n));
    if (!scenes.length) continue;
    sceneLines++;
    const key = currentDate || "";
    let g = groups.get(key);
    if (!g) { g = { date: currentDate, dayNumber: currentDay, label: dateCell || raw.trim(), scenes: [] }; groups.set(key, g); }
    g.scenes = unique([...g.scenes, ...scenes]);
  }
  const days = Array.from(groups.values());
  finishWarnings(days, warnings, { ambiguous, assumedYear, defaultYear: opts.defaultYear, kind: opts.kind });
  return { kind: opts.kind, date: days.find((d) => d.date)?.date ?? null, dayNumber: days[0]?.dayNumber ?? null, days, warnings, stats: { lines: lines.length, dateLines, sceneLines, format: "csv" } };
}

function finishWarnings(days: ParsedDay[], warnings: string[], n: { ambiguous: number; assumedYear: number; defaultYear: number; kind: DocKind }) {
  const undated = days.filter((d) => !d.date).reduce((s, d) => s + d.scenes.length, 0);
  if (!days.length) warnings.push(`No scene numbers were found. The reader looks for "Sc 12", "Scene 12A", "Scs. 12, 13" or lines that start with the scene number and INT./EXT.`);
  else if (undated) warnings.push(`${undated} scene${undated === 1 ? "" : "s"} had no shoot date next to them; fill in the date below or they stay unscheduled.`);
  if (n.ambiguous) warnings.push(`${n.ambiguous} date${n.ambiguous === 1 ? "" : "s"} like 03/04/2026 could be day/month or month/day; they were read as day/month. Check them before applying.`);
  if (n.assumedYear) warnings.push(`${n.assumedYear} date${n.assumedYear === 1 ? "" : "s"} had no year; ${n.defaultYear} was assumed.`);
}

/** Same-date groups merge (a day split across pages), scene lists dedupe, empty groups drop; document order is kept. */
function mergeDays(days: ParsedDay[]): ParsedDay[] {
  const out: ParsedDay[] = [];
  for (const d of days) {
    if (!d.scenes.length) continue;
    const same = d.date ? out.find((x) => x.date === d.date) : undefined;
    if (same) { same.scenes = unique([...same.scenes, ...d.scenes]); if (same.dayNumber == null) same.dayNumber = d.dayNumber; }
    else out.push({ ...d, scenes: unique(d.scenes) });
  }
  return out;
}

export function parseScheduleText(text: string, opts: ParseOptions): ParsedSchedule {
  const warnings: string[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  if (opts.csv || looksLikeCsv(lines)) { const r = parseCsv(lines, opts, warnings); if (r) return r; }

  const days: ParsedDay[] = [];
  let current: ParsedDay | null = null;
  let pending: string[] = [];
  let dateLines = 0, sceneLines = 0, ambiguous = 0, assumedYear = 0;
  const sheetDate = opts.kind === "CALLSHEET" ? pickSheetDate(lines, opts) : null;
  const newDay = (date: string | null, dayNumber: number | null, label: string) => { const d: ParsedDay = { date, dayNumber, label, scenes: [] }; days.push(d); return d; };
  const flushPending = (date: string | null, dayNumber: number | null, label: string) => { if (!pending.length) return; newDay(date, dayNumber, label).scenes.push(...pending); pending = []; };

  for (const raw of lines) {
    const line = raw.trim(); if (!line) continue;
    const scenes = TOTAL_RE.test(line) ? [] : scenesOf(line);
    const dates = findDates(line, opts.defaultYear, opts.monthFirst);
    const dayNo = dayNumberOf(line);
    const meta = META_RE.test(line);
    if (dates.length && !scenes.length) {
      if (meta) continue;
      dateLines++;
      const hit = dates[0]; if (hit.ambiguous) ambiguous++; if (hit.assumedYear) assumedYear++;
      if (END_RE.test(line)) {
        // Movie Magic one-liners: "End of Day 1 -- Mon, Oct 12, 2026" closes the strips printed above it.
        if (current && !current.date) { current.date = hit.iso; current.label = line; if (current.dayNumber == null) current.dayNumber = dayNo; }
        else flushPending(hit.iso, dayNo, line);
        current = null;
      } else if (current && !current.date && current.scenes.length === 0) {
        // "Day 3" on one line, its date on the next.
        current.date = hit.iso; current.label = `${current.label} · ${line}`; if (dayNo != null) current.dayNumber = dayNo;
      } else {
        flushPending(null, null, "before the first date");
        current = newDay(hit.iso, dayNo, line);
      }
      continue;
    }
    if (dayNo != null && !scenes.length) {
      if (END_RE.test(line)) { current = null; continue; }
      if (current && current.date && current.scenes.length === 0) { current.dayNumber = dayNo; current.label = `${current.label} · ${line}`; continue; }
      flushPending(null, null, "before the first date");
      current = newDay(null, dayNo, line);
      continue;
    }
    if (!scenes.length) continue;
    sceneLines++;
    if (dates.length === 1 && !meta) {
      // A row that carries its own date (a table exported as text).
      const d = days.find((x) => x.date === dates[0].iso) || newDay(dates[0].iso, dayNo, line);
      d.scenes.push(...scenes);
      continue;
    }
    if (current) current.scenes.push(...scenes); else pending.push(...scenes);
  }
  if (pending.length) flushPending(sheetDate, null, sheetDate ? "call sheet date" : "no date found");
  if (sheetDate) for (const d of days) if (!d.date) d.date = sheetDate;

  const merged = mergeDays(days);
  finishWarnings(merged, warnings, { ambiguous, assumedYear, defaultYear: opts.defaultYear, kind: opts.kind });
  const dayNumber = opts.kind === "CALLSHEET" ? merged.find((d) => d.date === sheetDate && d.dayNumber != null)?.dayNumber ?? merged.find((d) => d.dayNumber != null)?.dayNumber ?? null : merged[0]?.dayNumber ?? null;
  return { kind: opts.kind, date: sheetDate ?? merged.find((d) => d.date)?.date ?? null, dayNumber, days: merged, warnings, stats: { lines: lines.length, dateLines, sceneLines, format: "text" } };
}

/** Text of an uploaded schedule / call sheet: PDF (text layer), CSV/TSV or plain text. Spreadsheets and Word files must be exported first. */
export async function extractDocumentText(buffer: Buffer, name: string, mimetype: string): Promise<{ text: string; format: "pdf" | "csv" | "text" }> {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf" || /pdf/i.test(mimetype) || buffer.subarray(0, 5).toString() === "%PDF-") {
    const pdf = await pdfParse(buffer);
    const text = pdf.text || "";
    if (!text.trim()) throw badRequest("No text could be extracted from this PDF. If it is a scan or a photo, run OCR first, or export the schedule as CSV.");
    return { text, format: "pdf" };
  }
  if (["xls", "xlsx", "numbers", "doc", "docx", "pages"].includes(ext)) throw badRequest(`.${ext} files are not read yet. Export the ${["doc", "docx", "pages"].includes(ext) ? "document" : "sheet"} as PDF or CSV and upload that.`);
  return { text: buffer.toString("utf8"), format: ext === "csv" || ext === "tsv" ? "csv" : "text" };
}
