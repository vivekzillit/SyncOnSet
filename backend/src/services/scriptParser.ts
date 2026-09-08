/**
 * Deterministic screenplay parser (tier 1, no AI).
 * Accepts Final Draft (.fdx), Fountain (.fountain), plain text and PDF (text extracted upstream),
 * normalises everything into a stream of elements, then folds the stream into scenes.
 */

export type ScriptFormat = "fdx" | "fountain" | "text" | "pdf";

export interface ParsedScene {
  number: string;
  name: string | null;
  location: string | null;
  intExt: string | null;
  timeOfDay: string | null;
  synopsis: string | null;
  status?: string;
  characters: string[];
  dialogueLines: number;
  /** Scene text (action + dialogue) for downstream AI cue extraction. */
  text: string;
}
export interface ParsedCharacter { name: string; scenes: number; lines: number }
export interface ParseResult {
  format: ScriptFormat;
  scenes: ParsedScene[];
  characters: ParsedCharacter[];
  warnings: string[];
  stats: { elements: number; headings: number; cues: number };
}

type ElementType = "heading" | "character" | "dialogue" | "action" | "other";
interface Element { type: ElementType; text: string; number?: string | null }

const SLUG_RE = /^\s*(?:(\d+[A-Z]?)\s*[.)]?\s+)?(INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)(?=[\s.\-/])\s*[.\-/]?\s*(.*?)\s*$/i;
const TRAILING_NUM_RE = /\s+(?:#(\d+[A-Z]?)#|(\d+[A-Z]?))\s*$/;
const TIME_WORDS: Record<string, string> = {
  DAY: "DAY", MORNING: "DAY", AFTERNOON: "DAY", NOON: "DAY", MIDDAY: "DAY",
  NIGHT: "NIGHT", EVENING: "NIGHT", MIDNIGHT: "NIGHT", "LATE NIGHT": "NIGHT",
  DAWN: "DAWN", SUNRISE: "DAWN", "EARLY MORNING": "DAWN",
  DUSK: "DUSK", SUNSET: "DUSK", TWILIGHT: "DUSK", "MAGIC HOUR": "DUSK",
  CONTINUOUS: "CONTINUOUS", LATER: "CONTINUOUS", SAME: "CONTINUOUS", "SAME TIME": "CONTINUOUS", "MOMENTS LATER": "CONTINUOUS",
};
const NOT_A_NAME = new Set(["CUT TO", "FADE IN", "FADE OUT", "FADE TO BLACK", "DISSOLVE TO", "SMASH CUT TO", "MATCH CUT TO", "THE END", "END", "CONTINUED", "MORE", "BACK TO SCENE", "INTERCUT", "TITLE", "SUPER", "MONTAGE", "END MONTAGE", "END OF MONTAGE", "OMITTED", "INSERT", "BACK TO", "LATER", "FLASHBACK", "END FLASHBACK", "BEAT", "PAUSE", "SILENCE", "ANGLE ON", "CLOSE ON", "POV", "TITLE CARD", "SERIES OF SHOTS"]);

/* ---------------- Final Draft ---------------- */
function decodeEntities(s: string) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
}
export function fdxToElements(xml: string): Element[] {
  const out: Element[] = [];
  const paraRe = /<Paragraph\b([^>]*)>([\s\S]*?)<\/Paragraph>/gi;
  let m: RegExpExecArray | null;
  while ((m = paraRe.exec(xml))) {
    const attrs = m[1];
    const type = (/Type="([^"]*)"/i.exec(attrs)?.[1] || "").toLowerCase();
    const number = /Number="([^"]*)"/i.exec(attrs)?.[1] || null;
    const text = decodeEntities([...m[2].matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/gi)].map((t) => t[1]).join("")).replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (type === "scene heading") out.push({ type: "heading", text, number });
    else if (type === "character") out.push({ type: "character", text });
    else if (type === "dialogue") out.push({ type: "dialogue", text });
    else if (type === "action" || type === "general" || type === "shot") out.push({ type: "action", text });
    else out.push({ type: "other", text });
  }
  return out;
}

/* ---------------- Fountain / plain text / PDF text ---------------- */
function isTransition(line: string) {
  const t = line.trim();
  return /^[A-Z][A-Z\s'.]*TO:$/.test(t) || /^>/.test(t) || /^(FADE IN|FADE OUT|FADE TO BLACK|CUT TO BLACK)[:.]?$/i.test(t);
}
function looksLikeCue(line: string) {
  const t = line.trim().replace(/\s*\^$/, "");
  if (t.length < 2 || t.length > 45) return false;
  if (/[!?]$/.test(t)) return false;
  const base = t.replace(/\s*\([^)]*\)\s*$/g, "").trim(); // strip (V.O.) (CONT'D)
  if (!base || base !== base.toUpperCase()) return false;
  if (!/[A-Z]/.test(base)) return false;
  if (NOT_A_NAME.has(base.replace(/[.:]$/, ""))) return false;
  if (base.split(/\s+/).length > 5) return false;
  if (/^[\d\s.]+$/.test(base)) return false;
  if (/^(INT|EXT|I\/E|EST)\b/.test(base)) return false;
  return /^@?[A-Z0-9][A-Z0-9 .'\-#&]*$/.test(base.replace(/^@/, ""));
}
function isNoise(line: string) {
  const t = line.trim();
  return !t || /^\(?(CONTINUED|MORE)\)?:?$/i.test(t) || /^\d+\.?$/.test(t) || /^page\s+\d+/i.test(t) || /^\f$/.test(t);
}
export function textToElements(raw: string): Element[] {
  const lines = raw.replace(/\r\n?/g, "\n").replace(/\f/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));
  const out: Element[] = [];
  let i = 0;
  let inDialogue = false;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push({ type: "action", text: paragraph.join(" ").replace(/\s+/g, " ").trim() });
    paragraph = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (isNoise(line)) { flush(); inDialogue = false; i++; continue; }
    // forced heading (.SLUG) or standard slugline
    const forced = /^\.(?!\.)(.+)$/.exec(t);
    const slug = forced ? null : SLUG_RE.exec(t);
    if (forced || slug) {
      flush();
      inDialogue = false;
      let text = forced ? forced[1].trim() : t;
      let number: string | null = slug?.[1] || null;
      const trail = TRAILING_NUM_RE.exec(text);
      if (trail) { number = number || trail[1] || trail[2]; text = text.replace(TRAILING_NUM_RE, ""); }
      text = text.replace(/^\s*\d+[A-Z]?\s*[.)]?\s+(?=(INT|EXT|I\/E|EST))/i, "");
      out.push({ type: "heading", text: text.trim(), number });
      i++;
      continue;
    }
    if (isTransition(t)) { flush(); inDialogue = false; out.push({ type: "other", text: t }); i++; continue; }
    const next = lines[i + 1]?.trim() || "";
    if (looksLikeCue(t) && next && !SLUG_RE.test(next) && !isTransition(next)) {
      flush();
      out.push({ type: "character", text: t.replace(/^@/, "") });
      inDialogue = true;
      i++;
      continue;
    }
    if (inDialogue) {
      if (/^\(.*\)$/.test(t)) { out.push({ type: "other", text: t }); i++; continue; }
      out.push({ type: "dialogue", text: t });
      // dialogue continues until a blank line (fountain) - PDF text without blanks falls back to one line
      if (!lines[i + 1] || !lines[i + 1].trim()) inDialogue = false;
      i++;
      continue;
    }
    paragraph.push(t);
    i++;
  }
  flush();
  return out;
}

/* ---------------- Common ---------------- */
export function normaliseName(raw: string): string {
  let s = raw.trim().replace(/\s*\^$/, "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/[.:]+$/, "").trim();
  if (!s) return "";
  return s.toLowerCase().replace(/(^|[\s\-/"(])([a-z])/g, (_, p, c) => p + c.toUpperCase()).replace(/\bMr\b/g, "Mr.").replace(/\bMrs\b/g, "Mrs.").replace(/\bDr\b/g, "Dr.");
}
export function parseSlug(text: string): { intExt: string | null; location: string | null; timeOfDay: string | null; name: string } {
  const m = SLUG_RE.exec(text);
  if (!m) return { intExt: null, location: null, timeOfDay: null, name: text.trim() };
  const prefix = m[2].toUpperCase().replace(/\s|\./g, "");
  const intExt = prefix === "INT" ? "INT" : prefix === "EXT" || prefix === "EST" ? "EXT" : "INT/EXT";
  let rest = m[3].trim();
  let timeOfDay: string | null = null;
  const parts = rest.split(/\s+[-–—]+\s+|\s+--\s+/);
  if (parts.length > 1) {
    const tail = parts[parts.length - 1].toUpperCase().replace(/[.,]+$/, "").trim();
    const key = Object.keys(TIME_WORDS).find((k) => tail === k || tail.startsWith(k + " ") || tail.endsWith(" " + k));
    if (key) { timeOfDay = TIME_WORDS[key]; parts.pop(); }
  }
  const location = parts.join(" - ").replace(/\s+/g, " ").trim() || null;
  const name = [location, timeOfDay ? timeOfDay.charAt(0) + timeOfDay.slice(1).toLowerCase() : null].filter(Boolean).join(" - ") || text.trim();
  return { intExt, location, timeOfDay, name: name.replace(/\b([A-Z])([A-Z']+)\b/g, (_, a, b) => a + b.toLowerCase()) };
}

export function buildScenes(elements: Element[], format: ScriptFormat): ParseResult {
  const scenes: (ParsedScene & { _chars: Set<string>; _lines: string[] })[] = [];
  const warnings: string[] = [];
  const charIndex = new Map<string, ParsedCharacter>();
  let current: (ParsedScene & { _chars: Set<string>; _lines: string[] }) | null = null;
  let headings = 0;
  let cues = 0;
  let missingNumbers = 0;
  let firstAction = false;
  for (const el of elements) {
    if (el.type === "heading") {
      headings += 1;
      const slug = parseSlug(el.text);
      const omitted = /\bOMITTED\b/i.test(el.text);
      let number = (el.number || "").trim();
      if (!number) { missingNumbers += 1; number = String(scenes.length + 1); }
      current = { number, name: omitted ? "Omitted" : slug.name, location: slug.location, intExt: slug.intExt, timeOfDay: slug.timeOfDay, synopsis: null, status: omitted ? "OMITTED" : undefined, characters: [], dialogueLines: 0, text: "", _chars: new Set(), _lines: [el.text] };
      scenes.push(current);
      firstAction = true;
      continue;
    }
    if (!current) continue;
    if (el.type === "character") {
      cues += 1;
      const name = normaliseName(el.text);
      if (!name) continue;
      current._lines.push(`${name.toUpperCase()}:`);
      const key = name.toLowerCase();
      if (!current._chars.has(key)) { current._chars.add(key); current.characters.push(name); }
      const c = charIndex.get(key) || { name, scenes: 0, lines: 0 };
      if (!charIndex.has(key)) charIndex.set(key, c);
      c.lines += 1;
      continue;
    }
    if (el.type === "dialogue") { current.dialogueLines += 1; current._lines.push(`  ${el.text}`); continue; }
    if (el.type === "action") current._lines.push(el.text);
    if (el.type === "action" && firstAction) {
      current.synopsis = el.text.length > 220 ? el.text.slice(0, 217).replace(/\s+\S*$/, "") + "…" : el.text;
      firstAction = false;
    }
  }
  for (const s of scenes) for (const c of s.characters) { const rec = charIndex.get(c.toLowerCase()); if (rec) rec.scenes += 1; }
  // duplicate scene numbers → suffix
  const seen = new Map<string, number>();
  for (const s of scenes) {
    const n = seen.get(s.number) || 0;
    if (n > 0) { warnings.push(`Duplicate scene number ${s.number}; renamed ${s.number}-${n + 1}`); s.number = `${s.number}-${n + 1}`; }
    seen.set(s.number.replace(/-\d+$/, ""), n + 1);
  }
  if (headings === 0) warnings.push("No scene headings found. Headings must start with INT., EXT., INT./EXT. or EST.");
  if (missingNumbers > 0 && missingNumbers === headings) warnings.push("The script has no scene numbers; scenes were numbered in order of appearance.");
  else if (missingNumbers > 0) warnings.push(`${missingNumbers} scene heading(s) had no number and were numbered by position.`);
  if (cues === 0 && headings > 0) warnings.push("No character cues detected; characters will not be attached to scenes.");
  const characters = [...charIndex.values()].sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));
  return { format, scenes: scenes.map(({ _chars, _lines, ...s }) => ({ ...s, text: _lines.join("\n").slice(0, 40000) })), characters, warnings, stats: { elements: elements.length, headings, cues } };
}

export function detectFormat(filename: string, mimetype: string, head: string): ScriptFormat {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (ext === "fdx" || /<FinalDraft/i.test(head)) return "fdx";
  if (ext === "pdf" || mimetype === "application/pdf" || head.startsWith("%PDF")) return "pdf";
  if (ext === "fountain") return "fountain";
  return "text";
}

export function parseScript(format: ScriptFormat, content: string): ParseResult {
  if (format === "fdx") return buildScenes(fdxToElements(content), format);
  // fountain files may carry a title page (key: value lines) before the first blank line — drop it
  let body = content;
  if (format === "fountain" && /^[A-Za-z ]+:\s*\S/.test(content.trimStart())) {
    const idx = content.search(/\n\s*\n/);
    if (idx > 0) body = content.slice(idx);
  }
  return buildScenes(textToElements(body), format);
}
