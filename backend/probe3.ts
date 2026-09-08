import fs from "fs";
import { pdfLayoutText } from "./src/services/pdfLayout";
(async () => {
  const text = await pdfLayoutText(fs.readFileSync(process.argv[2]));
  if (!text) { console.log("pdf.js could not read it"); return; }
  const lines = text.split("\n");
  console.log("lines:", lines.length);
  lines.forEach((l, i) => { if (/^Sc /.test(l) || /january|callsheet|shoot day/i.test(l)) console.log(String(i).padStart(3), JSON.stringify(l.slice(0, 170))); });
})();
