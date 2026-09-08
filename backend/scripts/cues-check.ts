/**
 * Spec runner for the rule-based costume-cue extractor.
 *   cd backend && npx tsx scripts/cues-check.ts [--verbose] [--only <index>]
 * Loads scripts/cues-spec.json, runs extractSceneCues on each case and prints PASS/FAIL per case,
 * expected vs actual, and a final "passed X/Y" line. Exit code 1 when any case fails.
 */
import fs from "fs";
import path from "path";
import { extractSceneCues } from "../src/services/scriptCues";

interface Expected { character: string | null; kind: string; textContains: string }
interface Case { text: string; characters: string[]; expected: Expected[]; mustNotContain: string[] }
interface Spec { cases: Case[] }

const args = process.argv.slice(2);
const verbose = args.includes("--verbose") || args.includes("-v");
const onlyIdx = args.includes("--only") ? Number(args[args.indexOf("--only") + 1]) : null;

const specPath = path.join(__dirname, "cues-spec.json");
const spec = JSON.parse(fs.readFileSync(specPath, "utf8")) as Spec;

const lc = (s: string | null | undefined) => (s == null ? null : s.toLowerCase());
const fmt = (c: { character: string | null; kind: string; text: string }) => `${c.character ?? "-"} | ${c.kind} | ${c.text}`;

let passed = 0;
const total = onlyIdx == null ? spec.cases.length : 1;

spec.cases.forEach((tc, i) => {
  if (onlyIdx != null && i !== onlyIdx) return;
  const slug = tc.text.split("\n")[0].trim();
  let actual: ReturnType<typeof extractSceneCues> = [];
  let crashed: string | null = null;
  try {
    actual = extractSceneCues(tc.text, tc.characters);
  } catch (e) {
    crashed = e instanceof Error ? e.stack || e.message : String(e);
  }
  const missing: Expected[] = [];
  for (const exp of tc.expected) {
    const hit = actual.some((c) => c.kind === exp.kind && lc(c.character) === lc(exp.character) && c.text.toLowerCase().includes(exp.textContains.toLowerCase()));
    if (!hit) missing.push(exp);
  }
  const forbidden: { needle: string; cue: string }[] = [];
  for (const needle of tc.mustNotContain) {
    for (const c of actual) if (c.text.toLowerCase().includes(needle.toLowerCase())) forbidden.push({ needle, cue: fmt(c) });
  }
  const invalid = actual.filter((c) => c.character != null && !tc.characters.some((n) => n.toLowerCase() === c.character!.toLowerCase())).map(fmt);
  const ok = !crashed && !missing.length && !forbidden.length && !invalid.length;
  if (ok) passed++;
  console.log(`${ok ? "PASS" : "FAIL"} [${i}] ${slug} (${actual.length} cues)`);
  if (!ok || verbose) {
    if (crashed) console.log(`  CRASH: ${crashed}`);
    for (const m of missing) console.log(`  MISSING expected: ${m.character ?? "-"} | ${m.kind} | *${m.textContains}*`);
    for (const f of forbidden) console.log(`  FORBIDDEN "${f.needle}" in: ${f.cue}`);
    for (const inv of invalid) console.log(`  UNKNOWN CHARACTER: ${inv}`);
    console.log("  actual:");
    for (const c of actual) console.log(`    ${fmt(c)} [${c.confidence}]${verbose && c.quote ? `  <${c.quote}>` : ""}`);
  }
});

console.log(`passed ${passed}/${total}`);
if (passed < total) process.exit(1);
