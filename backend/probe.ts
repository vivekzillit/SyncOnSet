import fs from "fs";
const pdfjs = require("./node_modules/pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
interface It { x: number; y: number; w: number; h: number; s: string }
(async () => {
  const data = new Uint8Array(fs.readFileSync(process.argv[2]));
  const doc = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent({ normalizeWhitespace: true });
    const items: It[] = content.items.map((it: any) => ({ x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[0]) || it.height || 10, s: it.str }));
    const rows = new Map<number, It[]>();
    for (const it of items) { if (!it.s.trim()) continue; const key = Math.round(it.y / 2) * 2; (rows.get(key) || rows.set(key, []).get(key)!).push(it); }
    for (const [, its] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      its.sort((a, b) => a.x - b.x);
      let line = "";
      for (let i = 0; i < its.length; i++) {
        const cur = its[i];
        if (i > 0) {
          const prev = its[i - 1];
          const gap = cur.x - (prev.x + prev.w);
          const em = Math.max(prev.h, 6);
          line += gap < 0.25 * em ? "" : gap < 1.6 * em ? " " : "   ";
        }
        line += cur.s;
      }
      const t = line.replace(/\s+$/, "");
      if (t.trim()) out.push(t);
    }
  }
  const lines = out;
  const want = process.argv[3];
  lines.forEach((l, i) => { if (!want || new RegExp(want, "i").test(l)) console.log(String(i).padStart(3), JSON.stringify(l.slice(0, 190))); });
})();
