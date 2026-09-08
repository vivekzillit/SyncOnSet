/**
 * Regression suite for the schedule / call sheet reader.
 *   cd backend && npx tsx scripts/schedule-check.ts
 * Each case gives a document text and the shoot days + scene numbers expected from it.
 */
import fs from "fs";
import path from "path";
import { parseScheduleText, type DocKind } from "../src/services/scheduleParser";

interface Case { name: string; kind: DocKind; text: string; csv?: boolean; defaultYear?: number; expect: { days: Record<string, string[]>; dayNumbers?: Record<string, number>; date?: string; dayNumber?: number; warningsInclude?: string[]; detail?: Record<string, Record<string, unknown>> } }
const cases: Case[] = JSON.parse(fs.readFileSync(path.join(__dirname, "schedule-spec.json"), "utf8"));
const only = process.argv[2];
let passed = 0, total = 0;
for (const c of cases) {
  if (only && !c.name.toLowerCase().includes(only.toLowerCase())) continue;
  total++;
  const r = parseScheduleText(c.text, { kind: c.kind, defaultYear: c.defaultYear ?? 2026, csv: c.csv });
  const got: Record<string, string[]> = {};
  for (const d of r.days) got[d.date || ""] = d.scenes.map((s) => s.number).sort();
  const want: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(c.expect.days)) want[k] = [...v].sort();
  const problems: string[] = [];
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`days: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  for (const [k, n] of Object.entries(c.expect.dayNumbers || {})) { const d = r.days.find((x) => (x.date || "") === k); if (d?.dayNumber !== n) problems.push(`dayNumber for ${k}: got ${d?.dayNumber} want ${n}`); }
  if (c.expect.date !== undefined && r.date !== c.expect.date) problems.push(`date: got ${r.date} want ${c.expect.date}`);
  if (c.expect.dayNumber !== undefined && r.dayNumber !== c.expect.dayNumber) problems.push(`dayNumber: got ${r.dayNumber} want ${c.expect.dayNumber}`);
  for (const w of c.expect.warningsInclude || []) if (!r.warnings.some((x) => x.includes(w))) problems.push(`warning containing "${w}" missing; warnings=${JSON.stringify(r.warnings)}`);
  // What the file says about a scene beyond its number (set, INT/EXT, day/night, pages, story day, cast).
  for (const [number, want] of Object.entries(c.expect.detail || {})) {
    const ref = r.days.flatMap((d) => d.scenes).find((s) => s.number.toUpperCase() === number.toUpperCase());
    if (!ref) { problems.push(`detail for scene ${number}: scene not found`); continue; }
    for (const [k, v] of Object.entries(want)) {
      const got = (ref as unknown as Record<string, unknown>)[k];
      if (JSON.stringify(got) !== JSON.stringify(v)) problems.push(`scene ${number}.${k}: got ${JSON.stringify(got)} want ${JSON.stringify(v)}`);
    }
  }
  if (problems.length) console.log(`FAIL [${c.name}]\n   ${problems.join("\n   ")}`);
  else { passed++; console.log(`PASS [${c.name}]`); }
}
console.log(`passed ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
