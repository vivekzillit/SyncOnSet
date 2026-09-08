import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound } from "../lib/errors";
import { parse, zDate } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { EXPENSE_CATEGORIES, FINANCE_ROLES } from "../lib/constants";
import { budgetReport } from "../services/reports";

export const expensesRouter = Router({ mergeParams: true });
expensesRouter.use(requireRole(FINANCE_ROLES));

const schema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.number().min(0),
  description: z.string().min(1),
  date: zDate,
  costumeId: z.string().optional().nullable(),
  characterId: z.string().optional().nullable(),
  sceneId: z.string().optional().nullable(),
  vendorId: z.string().optional().nullable(),
});
const include = { costume: { select: { assetNumber: true, name: true } }, character: { select: { name: true } }, scene: { select: { number: true } }, vendor: { select: { name: true } } };

expensesRouter.get("/", wrap(async (req, res) => res.json(await prisma.expense.findMany({ where: { projectId: req.projectId }, include, orderBy: { date: "desc" } }))));
expensesRouter.get("/budget", wrap(async (req, res) => res.json(await budgetReport(req.projectId!))));
expensesRouter.post(
  "/",
  wrap(async (req, res) => {
    const data = parse(schema, req.body);
    res.status(201).json(await prisma.expense.create({ data: { ...data, date: data.date || new Date(), projectId: req.projectId! }, include }));
  }),
);
expensesRouter.patch(
  "/:id",
  wrap(async (req, res) => {
    const data = parse(schema.partial(), req.body);
    const existing = await prisma.expense.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Expense");
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
