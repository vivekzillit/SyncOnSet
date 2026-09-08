import fs from "fs";
const pdfjs = require("./node_modules/pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
(async () => {
  const data = new Uint8Array(fs.readFileSync(process.argv[2]));
  const doc = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const page = await doc.getPage(1);
  const c = await page.getTextContent({ normalizeWhitespace: true });
  const items = c.items.map((it: any) => ({ x: Math.round(it.transform[4]), y: Math.round(it.transform[5]), w: Math.round(it.width), s: it.str })).filter((i: any) => i.s.trim());
  const inBand = items.filter((i: any) => i.y < 300 && i.y > 150);
  const byY = new Map<number, any[]>();
  for (const it of inBand) { const k = Math.round(it.y / 2) * 2; (byY.get(k) || byY.set(k, []).get(k)!).push(it); }
  [...byY.entries()].sort((a, b) => b[0] - a[0]).slice(0, 22).forEach(([y, its]) => {
    console.log(String(y).padStart(4), its.sort((a: any, b: any) => a.x - b.x).map((i: any) => `x${i.x}:${JSON.stringify(i.s)}`).join(" "));
  });
})();
