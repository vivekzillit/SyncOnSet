import fs from "fs";
import { extractDocumentText, parseScheduleText } from "./src/services/scheduleParser";
(async () => {
  const buf = fs.readFileSync(process.argv[2]);
  const { text, format } = await extractDocumentText(buf, process.argv[2], "application/pdf");
  const r = parseScheduleText(text, { kind: (process.argv[3] as any) || "CALLSHEET", defaultYear: 2026 });
  console.log("format:", format, "| sheet date:", r.date, "| day:", r.dayNumber, "| days:", r.days.length);
  for (const d of r.days) {
    console.log(` ${d.date ?? "(no date)"}  Day ${d.dayNumber ?? "-"}`);
    for (const s of d.scenes) console.log(`   ${s.number.padEnd(7)} ${(s.intExt || "").padEnd(3)} ${(s.location || "").slice(0, 34).padEnd(34)} ${(s.timeOfDay || "").padEnd(5)} ${(s.pages || "").padEnd(5)} cast ${JSON.stringify(s.cast).padEnd(12)} ${(s.description || "").slice(0, 45)}`);
  }
  for (const w of r.warnings) console.log(" warn:", w);
})();
