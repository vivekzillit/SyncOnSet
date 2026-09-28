import writeXlsxFile from "write-excel-file/node";
import type { Cell, Row } from "write-excel-file/node";

/**
 * The blank budget sheet offered on the upload dialog. Its headers are exactly the ones budgetSheet.ts looks for, the
 * rows say "Example:" so a forgotten one is plain to see (and untick) in the preview, and Amount is a live
 * Qty × X × Rate formula, pre-filled on blank rows so new lines total themselves as they are typed.
 */
const HEAD = ["Account", "Description", "Category", "Date", "Scene", "Character", "Vendor", "Qty", "Unit", "X", "Rate", "Amount"];
const WIDTHS = [10, 40, 14, 12, 8, 20, 20, 7, 8, 5, 11, 13];
const EXAMPLES: [string, string, string, Date | null, string, string, string, number, string, number, number][] = [
  ["30-090", "Example: Police uniforms (khaki)", "Purchase", new Date(Date.UTC(2026, 8, 21)), "24", "Inspector Pandey", "Raj Textiles", 4, "Each", 1, 3000],
  ["30-090", "Example: Wig hire", "Rental", new Date(Date.UTC(2026, 8, 22)), "32", "Raj", "", 3, "Days", 1, 1500],
  ["30-040", "Example: Saree dry cleaning", "Laundry", new Date(Date.UTC(2026, 8, 23)), "", "Priya", "", 2, "Each", 1, 900],
  ["30-004", "Example: Costume standby", "Other", null, "", "", "", 5, "Days", 1, 2500],
];
const BLANK_ROWS = 60;
const MONEY = "#,##0.00";

const amount = (r: number, onlyWhenFilled: boolean): Cell => ({
  type: "Formula",
  value: onlyWhenFilled ? `IF(OR(H${r}="",K${r}=""),"",H${r}*IF(J${r}="",1,J${r})*K${r})` : `H${r}*J${r}*K${r}`,
  format: MONEY,
});

export async function budgetTemplateXlsx(): Promise<Buffer> {
  const head: Row = HEAD.map((h) => ({ value: h, fontWeight: "bold", backgroundColor: "#F1EFEA", align: h === "Amount" || h === "Rate" ? "right" : undefined }));
  const examples: Row[] = EXAMPLES.map(([code, desc, cat, date, scene, char, vendor, qty, unit, x, rate], i) => [
    code, desc, cat,
    date ? { value: date, type: Date, format: "dd/mm/yyyy" } : null,
    scene || null, char || null, vendor || null,
    qty, unit, x,
    { value: rate, type: Number, format: MONEY },
    amount(i + 2, false),
  ]);
  const blanks: Row[] = Array.from({ length: BLANK_ROWS }, (_, i) => [...Array(HEAD.length - 1).fill(null), amount(EXAMPLES.length + i + 2, true)]);
  return writeXlsxFile([head, ...examples, ...blanks], {
    sheet: "Budget",
    columns: WIDTHS.map((width) => ({ width })),
    stickyRowsCount: 1,
    dateFormat: "dd/mm/yyyy",
  }).toBuffer();
}
