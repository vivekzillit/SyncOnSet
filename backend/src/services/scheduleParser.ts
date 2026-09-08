import pdfParse from "pdf-parse";
import { badRequest } from "../lib/errors";
import { TIME_WORDS, parseSlug } from "./scriptParser";
import { DESC_MARK, pdfLayoutText } from "./pdfLayout";

/**
 * Deterministic reader for shooting schedules and call sheets (PDF text, CSV or plain text).
 * It finds shoot dates and the scene numbers that belong to each, so scenes can be given a shoot date.
 * No AI: the same document always reads the same way, and the user reviews every date before it is applied.
 */
export type DocKind = "SCHEDULE" | "CALLSHEET";
/** What a strip or call-sheet row says about a scene, beyond its number. Every field is null when the document does not say. */
export interface SceneDetail {
  intExt: string | null;      // INT | EXT | INT/EXT
  location: string | null;    // the set, e.g. RAJ'S OFFICE
  timeOfDay: string | null;   // DAY | NIGHT | DAWN | DUSK | CONTINUOUS
  name: string | null;        // "Raj's Office - Day"
  pages: string | null;       // eighths, e.g. "1 3/8"
  scriptDay: string | null;   // story day, e.g. "Day 1" from a D1 column
  cast: number[];             // cast numbers listed for the scene
  description: string | null; // only where a column says so
}
export interface ParsedSceneRef extends SceneDetail { number: string }
export interface ParsedDay { date: string | null; dayNumber: number | null; label: string; scenes: ParsedSceneRef[] }
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
const RANGE = String.raw`${NUM}(?:(?:-|–|—)${NUM}|\s+(?:to|thru|through)\s+${NUM})?`;
const LIST_RE = new RegExp(String.raw`\b(?:scenes?|scs?|scn)(?:[.\s:#\-–]+)(?:(?:no\.?|number|#)[.\s:]*)?(${RANGE}(?:\s*(?:,|&|\/|\+|\band\b)\s*${RANGE})*)`, "gi");
const STRIP_RE = new RegExp(String.raw`^\s*(\d{1,4}[A-Za-z]{0,2}?)\s*[-–:.)]?\s*(?:INT\/EXT|EXT\/INT|INT|EXT|I\/E|E\/I|EST)(?:\b|(?=[A-Z]))`, "i");
const SPLIT_RE = /\s*(?:,|&|\/|\+|\band\b)\s*/i;
const RANGE_RE = /^(\d{1,4})(?:(?:-|–|—)|\s+(?:to|thru|through)\s+)(\d{1,4})$/i;
const DAY_RES = [
  /\bshoot(?:ing)?\s*day\s*(?:no\.?|number|#)?\s*[:\-–]?\s*(\d{1,3})\b(?![\/.\-]\d)/i,
  /\bday\s*(?:no\.?|number|#)?\s*[:\-–]?\s*(\d{1,3})\s*(?:of|\/)\s*\d{1,3}\b(?![\/.\-]\d)/i, // "Day 5 of 30", "Day 5/30" — but not the date in "Shoot Day 12/10/2026"
  /^\s*(?:end\s+(?:of\s+)?)?day\s*(?:no\.?|number|#)?\s*[:\-–]?\s*(\d{1,3})\b(?![\/.\-]\d)/i,
  /\bday\s*(?:no\.?|number|#)\s*[:\-–]?\s*(\d{1,3})\b(?![\/.\-]\d)/i,
];
const END_RE = /\bend\s+(?:of\s+)?(?:shoot(?:ing)?\s+)?day\b/i;
// Tomorrow's work, printed at the foot of nearly every call sheet: its scenes are NOT today's.
const ADVANCE_RE = /\b(?:advance(?:\s+(?:schedule|shooting|call))?|for\s+tomorrow|tomorrow'?s?(?:\s+(?:schedule|scenes|call))?|tomorrow|next\s+day|day\s+after)\b/i;
// Continuity and costume notes name other scenes by number; those scenes are not shot on this day.
const NOTE_RE = /\b(?:continuity|cont'?d\.?|continued|same(?:\s+\w+){0,2}\s+as|as\s+(?:in|per)|refer(?:ence)?\s+to|see|match(?:es|ing)|carr(?:y|ied|ies)\s*[- ]?over|picks?\s*up\s+from|flashback\s+to)\b[^.;]{0,24}?\b(?:scs?|scn|scenes?)\.?\s*#?\s*\d/i;
// Lines whose date is not a shoot date (revision stamps, print dates, birthdays).
const META_RE = /\b(?:rev(?:ised|ision)?|version|printed|generated|updated|created|issued|dob|born|expires?)\b/i;
const TOTAL_RE = /\btotal\b/i;
// A numeric day/month with no year is only trusted where the line says it is a date.
const NOYEAR_CONTEXT_RE = /\b(?:tomorrow|day\s+after|advance|date)\b/i;
// "12/10/26, 9:47 pm - Priyanka AD: " — a WhatsApp export prefix, whose timestamp is not a shoot date.
const CHAT_PREFIX_RE = /^\[?\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4},?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s?m\.?)?\]?\s*(?:-|–)?\s*(?:[^:]{1,40}:)?\s*/i;

const pad = (n: number) => String(n).padStart(2, "0");
function iso(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
/**
 * A two-digit year written next to a month name ("16 January '17") is unmistakable, so any year reads.
 * In a bare numeric date, where "1.2.3" could be a version number, only the 2020s and 2030s are accepted.
 */
function year(raw: string | undefined, fallback: number, strict = false): { y: number; assumed: boolean } | null {
  if (!raw) return { y: fallback, assumed: true };
  const n = Number(raw);
  if (raw.length === 2) {
    if (strict) return n >= 20 && n <= 39 ? { y: 2000 + n, assumed: false } : null;
    return { y: n <= 79 ? 2000 + n : 1900 + n, assumed: false };
  }
  return { y: n, assumed: false };
}
const unique = <T,>(xs: T[]) => Array.from(new Set(xs));
export const normalizeNumber = (n: string) => n.trim().toUpperCase().replace(/^0+(?=\d)/, "");
export const nextDay = (isoDate: string) => { const [y, m, d] = isoDate.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d + 1)); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; };
/** Normalise one line: strip a chat-export prefix, non-breaking and zero-width spaces. */
export const cleanLine = (raw: string) => raw.replace(/[   ]/g, " ").replace(/[​-‍﻿]/g, "").replace(/[\u2018\u2019]/g, "'").replace(CHAT_PREFIX_RE, "").trim();

/** Every date written in a line as yyyy-mm-dd. Numeric dates read as day/month (Indian and UK convention) unless the day slot is over 12. */
export function findDates(line: string, defaultYear: number, monthFirst = false): DateHit[] {
  const hits: DateHit[] = [];
  const push = (isoDate: string | null, index: number, text: string, assumedYear: boolean, ambiguous: boolean) => {
    if (!isoDate) return;
    if (hits.some((h) => index < h.index + h.text.length && h.index < index + text.length)) return; // overlaps an earlier hit
    hits.push({ iso: isoDate, index, text, assumedYear, ambiguous });
  };
  for (const m of line.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) push(iso(+m[1], +m[2], +m[3]), m.index!, m[0], false, false);
  const re1 = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?[\s\-.]{0,2}${MONTH}\.?(?:[\s\-.,'’]{1,2}(\d{4}|\d{2}))?\b`, "gi");
  for (const m of line.matchAll(re1)) {
    const y = year(m[3], defaultYear); if (!y) continue;
    push(iso(y.y, MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]), m.index!, m[0], y.assumed, false);
  }
  const re2 = new RegExp(String.raw`\b${MONTH}\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b,?(?:[\s'’]{1,2}(\d{4}|\d{2}))?`, "gi");
  for (const m of line.matchAll(re2)) {
    const y = year(m[3], defaultYear); if (!y) continue;
    push(iso(y.y, MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]), m.index!, m[0], y.assumed, false);
  }
  const numeric = (a: number, b: number) => {
    let day = a, month = b, ambiguous = false;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { day = b; month = a; }
    else { ambiguous = a !== b; if (monthFirst) { day = b; month = a; } }
    return { day, month, ambiguous };
  };
  for (const m of line.matchAll(/(?<![\d\-\/.])(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})(?![\d\/.\-])/g)) {
    const y = year(m[3], defaultYear, true); if (!y) continue;
    const { day, month, ambiguous } = numeric(+m[1], +m[2]);
    push(iso(y.y, month, day), m.index!, m[0], false, ambiguous);
  }
  // A bare 13/10 is a date only where the line says so ("Tomorrow 13/10"), never a page count like "3 3/8".
  if (NOYEAR_CONTEXT_RE.test(line)) {
    for (const m of line.matchAll(/(?<![\d\-\/.])(\d{1,2})[\/.\-](\d{1,2})(?![\d\/.\-])/g)) {
      const before = line.slice(Math.max(0, m.index! - 3), m.index!);
      if (/\d\s$/.test(before)) continue; // "1 3/8 pgs"
      if (/^\s*(?:pgs?|pages?|hrs?|min)\b/i.test(line.slice(m.index! + m[0].length))) continue;
      const { day, month, ambiguous } = numeric(+m[1], +m[2]);
      push(iso(defaultYear, month, day), m.index!, m[0], true, ambiguous);
    }
  }
  return hits.sort((x, y) => x.index - y.index);
}

/** "55-57", "55 to 57" → 55, 56, 57. Anything else is left as written. */
function expandRange(token: string): string[] {
  const m = RANGE_RE.exec(token.trim());
  if (!m) return [token.trim()];
  const from = Number(m[1]), to = Number(m[2]);
  if (to <= from || to - from > 60) return [m[1]];
  return Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
}
const splitScenes = (text: string) => text.split(SPLIT_RE).flatMap(expandRange).map((n) => n.trim()).filter(Boolean);

/** Scene numbers named on a line: "Sc 12", "Scenes 12, 13A & 14", "Sc 55-57", or a strip that starts with the number and INT./EXT. */
export function scenesOf(line: string): string[] {
  const out: string[] = [];
  const strip = STRIP_RE.exec(line);
  if (strip) out.push(strip[1]);
  for (const m of line.matchAll(LIST_RE)) out.push(...splitScenes(m[1]));
  return unique(out.map(normalizeNumber));
}

export const emptyDetail = (): SceneDetail => ({ intExt: null, location: null, timeOfDay: null, name: null, pages: null, scriptDay: null, cast: [], description: null });

const INTEXT_RE = /\b(INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\/E|E\/I|INT|EXT|EST)(?:\b|(?=[A-Z]))\.?/i;
const PAGES_RE = /\b(\d{1,2}\s+\d{1,2}\/\d|\d{1,2}\/\d)\s*(?:pgs?\.?|pages?)?(?=[\s(]|$|[A-Za-z])/i;
const STORY_DAY_RE = /\b([DN])\s?(\d{1,3})\b(?!\/)/;
const CAST_RE = /\bcast\s*(?:#|nos?\.?|numbers?)?\s*:?\s*((?:\d{1,3})(?:\s*(?:,|&|\+|and)\s*\d{1,3})*)/i;
const EST_TIME_RE = /\b\d{1,2}\s*h(?:\s*\d{1,2}\s*m)?\b|\b\d{1,3}\s*mins?\b|\b\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?\b/gi;
const TIME_TAIL_RE = new RegExp(String.raw`[\s\-–—.,]+(${Object.keys(TIME_WORDS).map((w) => w.replace(/ /g, "\\s+")).sort((a, b) => b.length - a.length).join("|")})\s*$`, "i");

/**
 * What a strip or call-sheet row says about the scene(s) it names: INT/EXT, the set, day or night,
 * page count, story day and cast numbers. Anything the line does not clearly state stays null —
 * a wrong guess would silently overwrite the breakdown.
 */
export function readSceneDetail(rawLine: string): SceneDetail {
  const d = emptyDetail();
  // A rebuilt call-sheet table puts the synopsis after a marker so it never lands in the slugline.
  const marked = rawLine.indexOf(DESC_MARK);
  const line = marked < 0 ? rawLine : rawLine.slice(0, marked);
  if (marked >= 0) d.description = rawLine.slice(marked + DESC_MARK.length).trim() || null;
  const cast = CAST_RE.exec(line);
  if (cast) d.cast = unique(cast[1].split(/\s*(?:,|&|\+|and)\s*/i).map((n) => parseInt(n, 10)).filter((n) => !Number.isNaN(n)));
  // Everything from INT/EXT up to the first column that is plainly not part of the slugline.
  // pdf-parse glues table columns ("12AINTKITCHENDAY1 2/8"), so drop a leading scene number stuck to INT/EXT.
  const glued = /^\s*\d{1,4}[A-Za-z]{0,2}?(?=INT|EXT|EST|I\/E|E\/I)/i.exec(line);
  const searchIn = glued ? line.slice(glued[0].length) : line;
  const ie = INTEXT_RE.exec(searchIn);
  if (!ie) return d;
  let rest = searchIn.slice(ie.index + ie[0].length);
  const cut = [PAGES_RE.exec(rest)?.index, STORY_DAY_RE.exec(rest)?.index, CAST_RE.exec(rest)?.index, /\bcast\b/i.exec(rest)?.index]
    .filter((i): i is number => typeof i === "number");
  const pages = PAGES_RE.exec(rest);
  if (pages) d.pages = pages[1].replace(/\s+/g, " ").trim();
  const story = STORY_DAY_RE.exec(rest);
  if (story) d.scriptDay = `${story[1].toUpperCase() === "N" ? "Night" : "Day"} ${Number(story[2])}`;
  if (cut.length) rest = rest.slice(0, Math.min(...cut));
  rest = rest.replace(EST_TIME_RE, " ").replace(/[\s\-–—.,:;|]+$/, "").replace(/^[\s\-–—.,:;|/]+/, "").replace(/\s{2,}/g, " ").trim();
  if (!rest) return d;
  // A slugline may separate the time with a dash ("OFFICE - DAY") or just a gap ("OFFICE  DAY").
  let timeOfDay: string | null = null;
  const tail = TIME_TAIL_RE.exec(rest);
  if (tail) { timeOfDay = TIME_WORDS[tail[1].toUpperCase().replace(/\s+/g, " ")] ?? null; rest = rest.slice(0, tail.index).trim(); }
  else if (!/\s/.test(rest)) {
    // A glued column run ("KITCHENDAY") ends with the time word; only safe where there is no space to separate them.
    const g = /(DAY|NIGHT|DAWN|DUSK|CONTINUOUS|MORNING|EVENING|AFTERNOON|MIDNIGHT|SUNRISE|SUNSET)$/i.exec(rest);
    if (g && rest.length > g[1].length) { timeOfDay = TIME_WORDS[g[1].toUpperCase()] ?? null; rest = rest.slice(0, g.index).trim(); }
  }
  const slug = parseSlug(`${ie[0].replace(/\s/g, "")} ${rest}`);
  d.intExt = slug.intExt;
  d.location = slug.location;
  d.timeOfDay = timeOfDay ?? slug.timeOfDay;
  d.name = d.location ? parseSlug(`${slug.intExt || "INT"}. ${d.location}${d.timeOfDay ? ` - ${d.timeOfDay}` : ""}`).name : null;
  return d;
}

/** Merge two readings of the same scene: the first thing the document says about a field wins. */
export function mergeDetail(a: SceneDetail, b: SceneDetail): SceneDetail {
  return {
    intExt: a.intExt ?? b.intExt, location: a.location ?? b.location, timeOfDay: a.timeOfDay ?? b.timeOfDay,
    name: a.name ?? b.name, pages: a.pages ?? b.pages, scriptDay: a.scriptDay ?? b.scriptDay,
    cast: a.cast.length ? a.cast : b.cast, description: a.description ?? b.description,
  };
}
/** The scenes a line names, each carrying what that line says about it. */
export function sceneRefsOf(line: string): ParsedSceneRef[] {
  const numbers = scenesOf(line);
  if (!numbers.length) return [];
  const detail = readSceneDetail(line);
  return numbers.map((number) => ({ number, ...detail }));
}
export function dayNumberOf(line: string): number | null {
  for (const re of DAY_RES) { const m = re.exec(line); if (m) return Number(m[1]); }
  return null;
}

/** Call sheets: the shoot date is the header date that looks most like one, never a revision stamp or the advance block. */
function pickSheetDate(lines: string[], opts: ParseOptions): string | null {
  let best: { iso: string; score: number } | null = null;
  let seen = 0;
  for (const raw of lines) {
    const line = cleanLine(raw); if (!line) continue;
    if (++seen > 60) break;
    if (META_RE.test(line) || ADVANCE_RE.test(line)) continue;
    const hit = findDates(line, opts.defaultYear, opts.monthFirst)[0]; if (!hit) continue;
    const score = (/\bdate\b/i.test(line) ? 3 : 0) + (WEEKDAY_RE.test(line) ? 2 : 0) + (/\b(?:shoot|day)\b/i.test(line) ? 2 : 0);
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
const sepOf = (line: string) => (line.includes("\t") ? "\t" : ",");
const COLUMNS: { key: keyof SceneDetail | "number" | "date" | "day"; re: RegExp }[] = [
  { key: "date", re: /date/i },
  { key: "day", re: /^(?:shoot(?:ing)?\s*)?day(?:\s*(?:#|no\.?|number))?$/i },
  { key: "intExt", re: /^(?:i\/?e|int\/?ext|int\.?\s*\/\s*ext)$/i },
  { key: "timeOfDay", re: /^(?:d\/?n|day\/?night|time(?:\s*of\s*day)?)$/i },
  { key: "location", re: /^(?:set|location|scene\s*loc\.?|loc\.?)$/i },
  { key: "pages", re: /^(?:pgs?\.?|pages?|page\s*count)$/i },
  { key: "scriptDay", re: /^(?:script|story)\s*day$/i },
  { key: "cast", re: /^(?:cast|cast\s*(?:#|nos?\.?|numbers?)|characters?)$/i },
  { key: "description", re: /^(?:description|synopsis|scene\s*description|action)$/i },
];
const isSceneHeader = (h: string) => /^(?:scs?|scn|scenes?)\.?(?:\s*(?:#|no\.?|number|\(s\)))?$/i.test(h.trim()) || /^[a-z .#()\/_-]*scene[a-z .#()\/_-]*$/i.test(h.trim());
/** The header row of a sheet export, which is often below title and "prepared by" rows. */
function findHeaderRow(lines: string[]): number {
  for (let i = 0; i < lines.length && i < 40; i++) {
    const l = lines[i]; if (!l.trim()) continue;
    const cells = splitCsv(l, sepOf(l));
    if (cells.length >= 2 && cells.some(isSceneHeader)) return i;
  }
  return -1;
}
function looksLikeCsv(lines: string[]): boolean {
  return findHeaderRow(lines) >= 0;
}
/** A spreadsheet export with Scene and Date columns (a blank date continues the day above, as one-row-per-scene exports do). */
function parseCsv(lines: string[], opts: ParseOptions, warnings: string[]): ParsedSchedule | null {
  const headIdx = findHeaderRow(lines);
  if (headIdx < 0) return null;
  const sep = sepOf(lines[headIdx]);
  const header = splitCsv(lines[headIdx], sep);
  const sceneCol = header.findIndex(isSceneHeader);
  if (sceneCol < 0) return null;
  const col: Partial<Record<string, number>> = {};
  for (const c of COLUMNS) { const i = header.findIndex((h, j) => j !== sceneCol && c.re.test(h.trim())); if (i >= 0 && col[c.key] === undefined) col[c.key] = i; }
  const dateCol = col.date ?? -1;
  const dayCol = col.day ?? -1;
  const cell = (cells: string[], key: string) => { const i = col[key]; return i === undefined || i < 0 ? "" : (cells[i] || "").trim(); };
  const detailOf = (cells: string[]): SceneDetail => {
    const d = emptyDetail();
    const ie = cell(cells, "intExt"); if (ie) d.intExt = /int\s*\/\s*ext|i\/e|e\/i/i.test(ie) ? "INT/EXT" : /^ext/i.test(ie) ? "EXT" : /^int|^est/i.test(ie) ? "INT" : null;
    const t = cell(cells, "timeOfDay").toUpperCase().replace(/[^A-Z ]/g, "").trim();
    if (t) d.timeOfDay = TIME_WORDS[t] ?? (t === "D" ? "DAY" : t === "N" ? "NIGHT" : null);
    d.location = cell(cells, "location") || null;
    d.pages = cell(cells, "pages") || null;
    d.scriptDay = cell(cells, "scriptDay") || null;
    d.description = cell(cells, "description") || null;
    const cast = cell(cells, "cast");
    if (cast) d.cast = unique(cast.split(/\s*(?:,|&|\+|and)\s*/i).map((n) => parseInt(n, 10)).filter((n) => !Number.isNaN(n)));
    if (d.location) d.name = parseSlug(`${d.intExt || "INT"}. ${d.location}${d.timeOfDay ? ` - ${d.timeOfDay}` : ""}`).name;
    return d;
  };
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
    const numbers = splitScenes(cells[sceneCol] || "").map(normalizeNumber).filter((n) => /^\d{1,4}[A-Z]{0,2}$/.test(n));
    if (!numbers.length) continue;
    sceneLines++;
    const detail = detailOf(cells);
    const key = currentDate || "";
    let g = groups.get(key);
    if (!g) { g = { date: currentDate, dayNumber: currentDay, label: dateCell || raw.trim(), scenes: [] }; groups.set(key, g); }
    g.scenes = mergeScenes(g.scenes, numbers.map((number) => ({ number, ...detail })));
  }
  const days = Array.from(groups.values());
  finishWarnings(days, warnings, { ambiguous, assumedYear, defaultYear: opts.defaultYear });
  return { kind: opts.kind, date: days.find((d) => d.date)?.date ?? null, dayNumber: days[0]?.dayNumber ?? null, days, warnings, stats: { lines: lines.length, dateLines, sceneLines, format: "csv" } };
}

/** Add scenes to a day, merging repeats of the same number instead of listing it twice. */
function mergeScenes(into: ParsedSceneRef[], more: ParsedSceneRef[]): ParsedSceneRef[] {
  const out = [...into];
  for (const ref of more) {
    const i = out.findIndex((x) => normalizeNumber(x.number) === normalizeNumber(ref.number));
    if (i < 0) out.push(ref);
    else out[i] = { ...out[i], ...mergeDetail(out[i], ref) };
  }
  return out;
}

/** A scene written twice (a strip, a props note, tomorrow's advance) is one scene: complete each mention from the others. */
function shareDetailByNumber(days: ParsedDay[]): ParsedDay[] {
  const best = new Map<string, SceneDetail>();
  for (const d of days) for (const s of d.scenes) {
    const key = normalizeNumber(s.number);
    const have = best.get(key);
    best.set(key, have ? mergeDetail(have, s) : { ...s });
  }
  return days.map((d) => ({ ...d, scenes: d.scenes.map((s) => ({ ...s, ...mergeDetail(s, best.get(normalizeNumber(s.number)) || s) })) }));
}

function finishWarnings(days: ParsedDay[], warnings: string[], n: { ambiguous: number; assumedYear: number; defaultYear: number }) {
  const undated = days.filter((d) => !d.date).reduce((s, d) => s + d.scenes.length, 0);
  if (!days.length) warnings.push(`No scene numbers were found. The reader looks for "Sc 12", "Scene 12A", "Scs. 12, 13", "Sc 55-57" or lines that start with the scene number and INT./EXT.`);
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
    if (same) { same.scenes = mergeScenes(same.scenes, d.scenes); if (same.dayNumber == null) same.dayNumber = d.dayNumber; }
    else out.push({ ...d, scenes: mergeScenes([], d.scenes) });
  }
  return out;
}

export function parseScheduleText(text: string, options: ParseOptions): ParsedSchedule {
  const warnings: string[] = [];
  const rawLines = text.replace(/^﻿/, "").replace(/\r/g, "").split("\n");
  // A document that states a year once ("16 January '17") sets the year for its dates that omit one.
  const stated = rawLines.slice(0, 400).map(cleanLine).filter(Boolean)
    .flatMap((l) => (META_RE.test(l) ? [] : findDates(l, options.defaultYear, options.monthFirst)))
    .find((h) => !h.assumedYear);
  const opts: ParseOptions = stated ? { ...options, defaultYear: Number(stated.iso.slice(0, 4)) } : options;
  if (opts.csv || looksLikeCsv(rawLines)) { const r = parseCsv(rawLines, opts, warnings); if (r) return r; }

  const days: ParsedDay[] = [];
  let current: ParsedDay | null = null;
  let pending: ParsedSceneRef[] = [];
  let dateLines = 0, sceneLines = 0, ambiguous = 0, assumedYear = 0, advanceAssumed = 0, notesSkipped = 0;
  const sheetDate = opts.kind === "CALLSHEET" ? pickSheetDate(rawLines, opts) : null;
  const count = (hit: DateHit) => { if (hit.ambiguous) ambiguous++; if (hit.assumedYear) assumedYear++; };
  const newDay = (date: string | null, dayNumber: number | null, label: string) => { const d: ParsedDay = { date, dayNumber, label, scenes: [] }; days.push(d); return d; };
  const flushPending = (date: string | null, dayNumber: number | null, label: string) => { if (!pending.length) return; const d = newDay(date, dayNumber, label); d.scenes = mergeScenes(d.scenes, pending); pending = []; };

  for (const raw of rawLines) {
    const line = cleanLine(raw); if (!line) continue;
    const isNote = NOTE_RE.test(line);
    const scenes = TOTAL_RE.test(line) ? [] : sceneRefsOf(line);
    if (isNote && scenes.length) { notesSkipped++; continue; } // continuity / costume notes name scenes shot on other days
    const dates = findDates(line, opts.defaultYear, opts.monthFirst);
    const dayNo = dayNumberOf(line);
    const meta = META_RE.test(line);
    const advance = ADVANCE_RE.exec(line);

    if (advance && !meta) {
      // "Advance for Tomorrow: Sc 30, 31" — tomorrow's work, on its own date or the day after the call sheet.
      const hit = dates.find((d) => d.index > advance.index) ?? dates[0];
      if (hit) count(hit);
      let date = hit?.iso ?? null;
      if (!date && sheetDate) { date = nextDay(sheetDate); advanceAssumed++; }
      if (scenes.length) { const d = newDay(date, dayNo, line); d.scenes = mergeScenes(d.scenes, scenes); current = d; sceneLines++; }
      else { flushPending(sheetDate, null, "call sheet date"); current = newDay(date, dayNo, line); if (hit) dateLines++; }
      continue;
    }
    if (dates.length && !scenes.length) {
      if (meta) continue;
      dateLines++;
      const hit = dates[0]; count(hit);
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
      count(dates[0]);
      const d = days.find((x) => x.date === dates[0].iso) || newDay(dates[0].iso, dayNo, line);
      d.scenes = mergeScenes(d.scenes, scenes);
      continue;
    }
    if (current) current.scenes = mergeScenes(current.scenes, scenes); else pending = mergeScenes(pending, scenes);
  }
  if (pending.length) flushPending(sheetDate, null, sheetDate ? "call sheet date" : "no date found");
  if (sheetDate) for (const d of days) if (!d.date && !ADVANCE_RE.test(d.label)) d.date = sheetDate;

  const merged = shareDetailByNumber(mergeDays(days));
  finishWarnings(merged, warnings, { ambiguous, assumedYear, defaultYear: opts.defaultYear });
  if (advanceAssumed) warnings.push("Tomorrow's advance scenes were dated the day after the call sheet. Check that date before applying.");
  if (notesSkipped) warnings.push(`${notesSkipped} continuity or costume note${notesSkipped === 1 ? "" : "s"} mentioning other scenes ${notesSkipped === 1 ? "was" : "were"} not treated as scheduled work.`);
  const dayNumber = opts.kind === "CALLSHEET" ? merged.find((d) => d.date === sheetDate && d.dayNumber != null)?.dayNumber ?? merged.find((d) => d.dayNumber != null)?.dayNumber ?? null : merged[0]?.dayNumber ?? null;
  return { kind: opts.kind, date: sheetDate ?? merged.find((d) => d.date)?.date ?? null, dayNumber, days: merged, warnings, stats: { lines: rawLines.length, dateLines, sceneLines, format: "text" } };
}

/** PDF text, with a damaged or image-only file reported as a plain 400 rather than an internal error. */
export async function readPdf(buffer: Buffer, what: "script" | "schedule"): Promise<string> {
  const asCsv = what === "schedule" ? ", or export it as CSV" : "";
  // Schedules and call sheets are tables: read them with their layout so the columns survive. pdf-parse is the fallback.
  if (what === "schedule") { const layout = await pdfLayoutText(buffer); if (layout && layout.trim()) return layout; }
  let parsed;
  try {
    parsed = await pdfParse(buffer);
  } catch {
    throw badRequest(`This PDF could not be read. Open it and re-export or print it to PDF${asCsv}, then upload it again.`);
  }
  const text = parsed.text || "";
  if (!text.trim()) throw badRequest(`No text could be extracted from this PDF. If it is a scan or a photo, run OCR first${asCsv || ", or export the screenplay as PDF from your writing software"}.`);
  return text;
}

/** Text of an uploaded schedule / call sheet: PDF (text layer), CSV/TSV or plain text. Spreadsheets and Word files must be exported first. */
export async function extractDocumentText(buffer: Buffer, name: string, mimetype: string): Promise<{ text: string; format: "pdf" | "csv" | "text" }> {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf" || /pdf/i.test(mimetype) || buffer.subarray(0, 5).toString() === "%PDF-") {
    return { text: await readPdf(buffer, "schedule"), format: "pdf" };
  }
  if (["xls", "xlsx", "numbers", "doc", "docx", "pages"].includes(ext)) throw badRequest(`.${ext} files are not read yet. Export the ${["doc", "docx", "pages"].includes(ext) ? "document" : "sheet"} as PDF or CSV and upload that.`);
  return { text: buffer.toString("utf8"), format: ext === "csv" || ext === "tsv" ? "csv" : "text" };
}
