import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound, badRequest } from "../lib/errors";
import { parse, zDate } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { EXPENSE_CATEGORIES, FINANCE_ROLES } from "../lib/constants";
import { budgetReport } from "../services/reports";
import { audit } from "../services/audit";
import { readBudgetSheet } from "../services/budgetSheet";
import { budgetTemplateXlsx } from "../services/budgetTemplate";
import { normalizeNumber } from "../services/scheduleParser";

export const expensesRouter = Router({ mergeParams: true });
expensesRouter.use(requireRole(FINANCE_ROLES));

const text = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
// Every field of a line is optional: a line added by hand can be just an account code, a name, or an amount.
const schema = z.object({
  category: z.enum(EXPENSE_CATEGORIES).default("OTHER"),
  amount: z.number().min(0).default(0),
  description: z.string().trim().max(500).default(""),
  date: zDate,
  costumeId: z.string().optional().nullable(),
  characterId: z.string().optional().nullable(),
  sceneId: z.string().optional().nullable(),
  vendorId: z.string().optional().nullable(),
  // The budget sheet's own columns: account 30-001 COSTUME DESIGNER, "Name:", Amt × X × Rate, and the currency.
  accountCode: text(20),
  accountName: text(120),
  payee: text(120),
  quantity: z.number().min(0).optional().nullable(),
  unit: text(30),
  multiplier: z.number().min(0).optional().nullable(),
  rate: z.number().min(0).optional().nullable(),
  currency: z.union([z.string().length(3).transform((v) => v.toUpperCase()), z.literal("")]).optional(),
});
/** Amt × X × Rate is the line's subtotal whenever Amt and Rate are given (X defaults to 1), so the stored amount always agrees with the sheet. */
function withSubtotal<T extends { amount?: number; quantity?: number | null; multiplier?: number | null; rate?: number | null }>(d: T): T {
  if (d.quantity == null || d.rate == null) return d;
  return { ...d, amount: Math.round(d.quantity * (d.multiplier ?? 1) * d.rate * 100) / 100 };
}
const include = { costume: { select: { assetNumber: true, name: true } }, character: { select: { name: true } }, scene: { select: { number: true } }, vendor: { select: { name: true } } };

expensesRouter.get("/", wrap(async (req, res) => res.json(await prisma.expense.findMany({ where: { projectId: req.projectId }, include, orderBy: { date: "desc" } }))));
expensesRouter.get("/budget", wrap(async (req, res) => res.json(await budgetReport(req.projectId!))));
/**
 * Budget sheet upload, the same shape as the script and schedule uploads: preview reads the file and matches each line
 * to this production's scenes, characters, vendors and costumes, storing nothing; import writes only the ticked lines.
 */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const key = (s: string | null | undefined) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
/** A blank budget sheet (.xlsx) with the headers the upload reads, a few example rows and a live Amount formula. */
expensesRouter.get(
  "/import/template",
  wrap(async (_req, res) => {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="Budget sheet template.xlsx"');
    res.send(await budgetTemplateXlsx());
  }),
);
expensesRouter.post(
  "/import/preview",
  upload.single("file"),
  wrap(async (req, res) => {
    if (!req.file) throw badRequest("Choose a budget sheet to upload.");
    const { lines, sheets, skippedSheets } = await readBudgetSheet(req.file);
    if (!lines.length) throw badRequest("No budget lines found. The sheet needs a header row with an Amount (or Qty and Rate) column and at least one other column, such as Description, Category or Date.");
    const where = { projectId: req.projectId };
    const [scenes, characters, vendors, costumes] = await Promise.all([
      prisma.scene.findMany({ where, select: { id: true, number: true } }),
      prisma.character.findMany({ where, select: { id: true, name: true } }),
      prisma.vendor.findMany({ where, select: { id: true, name: true } }),
      prisma.costume.findMany({ where, select: { id: true, assetNumber: true } }),
    ]);
    const sceneBy = new Map(scenes.map((s) => [normalizeNumber(s.number), s.id]));
    const charBy = new Map(characters.map((c) => [key(c.name), c.id]));
    const vendorBy = new Map(vendors.map((v) => [key(v.name), v.id]));
    const costumeBy = new Map(costumes.map((c) => [key(c.assetNumber), c.id]));
    res.json({
      fileName: req.file.originalname,
      sheets,
      skippedSheets,
      lines: lines.map((l) => ({
        ...l,
        sceneId: l.scene ? sceneBy.get(normalizeNumber(l.scene)) || null : null,
        characterId: l.character ? charBy.get(key(l.character)) || null : null,
        vendorId: l.vendor ? vendorBy.get(key(l.vendor)) || null : null,
        costumeId: l.costume ? costumeBy.get(key(l.costume)) || null : null,
      })),
    });
  }),
);
const importSchema = z.object({
  lines: z.array(schema.extend({ amount: z.number().min(0), description: z.string().trim().min(1).max(500) })).min(1).max(5000),
});
expensesRouter.post(
  "/import",
  wrap(async (req, res) => {
    const { lines } = parse(importSchema, req.body);
    const where = { projectId: req.projectId };
    // Only ids that belong to this production are kept, whatever the client sent.
    const ids = <T extends { id: string }>(rows: T[]) => new Set(rows.map((r) => r.id));
    const [scenes, characters, vendors, costumes] = await Promise.all([
      prisma.scene.findMany({ where, select: { id: true } }).then(ids),
      prisma.character.findMany({ where, select: { id: true } }).then(ids),
      prisma.vendor.findMany({ where, select: { id: true } }).then(ids),
      prisma.costume.findMany({ where, select: { id: true } }).then(ids),
    ]);
    const own = (set: Set<string>, id?: string | null) => (id && set.has(id) ? id : null);
    const now = new Date();
    const { count } = await prisma.expense.createMany({
      data: lines.map((l) => ({
        projectId: req.projectId!,
        category: l.category,
        amount: l.amount,
        description: l.description,
        date: l.date || now,
        sceneId: own(scenes, l.sceneId),
        characterId: own(characters, l.characterId),
        vendorId: own(vendors, l.vendorId),
        costumeId: own(costumes, l.costumeId),
        accountCode: l.accountCode ?? null,
        accountName: l.accountName ?? null,
        payee: l.payee ?? null,
        quantity: l.quantity ?? null,
        unit: l.unit ?? null,
        multiplier: l.multiplier ?? null,
        rate: l.rate ?? null,
        currency: l.currency ?? "",
      })),
    });
    await audit(req.user, req.projectId!, "BUDGET_IMPORT", "EXPENSE", req.projectId!, { lines: count, total: lines.reduce((n, l) => n + l.amount, 0) });
    res.status(201).json({ count });
  }),
);

expensesRouter.post(
  "/",
  wrap(async (req, res) => {
    const data = withSubtotal(parse(schema, req.body));
    res.status(201).json(await prisma.expense.create({ data: { ...data, date: data.date || new Date(), projectId: req.projectId! }, include }));
  }),
);
expensesRouter.patch(
  "/:id",
  wrap(async (req, res) => {
    const patch = parse(schema.partial(), req.body);
    const existing = await prisma.expense.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Expense");
    // A change to Amt, X or Rate recomputes the subtotal from the merged line.
    const merged = withSubtotal({ quantity: existing.quantity, multiplier: existing.multiplier, rate: existing.rate, ...patch });
    const data = { ...patch, ...(merged.amount !== undefined && (patch.quantity !== undefined || patch.multiplier !== undefined || patch.rate !== undefined) ? { amount: merged.amount } : {}) };
    res.json(await prisma.expense.update({ where: { id: existing.id }, data: { ...data, date: data.date || undefined }, include }));
  }),
);
expensesRouter.delete(
  "/:id",
  wrap(async (req, res) => {
    const existing = await prisma.expense.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Expense");
    await prisma.expense.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  }),
);
