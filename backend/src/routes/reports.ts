import { Router } from "express";
import { prisma } from "../lib/prisma";
import { wrap } from "../lib/errors";
import { requireRole, effectiveRole } from "../middleware/auth";
import { FINANCE_ROLES } from "../lib/constants";
import { dailyReport, budgetReport } from "../services/reports";

export const reportsRouter = Router({ mergeParams: true });

function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

reportsRouter.get("/daily", wrap(async (req, res) => res.json(await dailyReport(req.projectId!, req.query.date as string | undefined))));

reportsRouter.get(
  "/daily.csv",
  wrap(async (req, res) => {
    const r = await dailyReport(req.projectId!, req.query.date as string | undefined);
    const rows = r.movements.map((m) => ({ time: m.createdAt, asset: m.costume.assetNumber, costume: m.costume.name, action: m.action, from: m.fromLocation, to: m.toLocation, status: m.toStatus, by: m.byUserName, note: m.note }));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="wardrobe-daily-${r.date.toISOString().slice(0, 10)}.csv"`);
    res.send(csv(rows));
  }),
);

reportsRouter.get("/budget", requireRole(FINANCE_ROLES), wrap(async (req, res) => res.json(await budgetReport(req.projectId!))));

/** Inventory / asset report (also used for wrap box labels). */
reportsRouter.get(
  "/inventory",
  wrap(async (req, res) => {
    const finance = FINANCE_ROLES.includes(effectiveRole(req));
    const costumes = await prisma.costume.findMany({ where: { projectId: req.projectId }, include: { character: { select: { name: true } }, vendor: { select: { name: true } } }, orderBy: { assetNumber: "asc" } });
    const rows = costumes.map((c) => ({
      asset: c.assetNumber,
      name: c.name,
      category: c.category,
      type: c.type,
      color: c.color,
      brand: c.brand,
      size: c.size,
      quantity: c.quantity,
      character: c.character?.name,
      source: c.source,
      vendor: c.vendor?.name,
      purchaseCost: finance ? c.purchaseCost : undefined,
      status: c.status,
      location: c.location,
    }));
    if (req.query.format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="inventory.csv"');
      return res.send(csv(rows));
    }
    res.json(rows);
  }),
);

/** Wrap report: what goes back where (rented → vendor, purchased → storage box), grouped by source. */
reportsRouter.get(
  "/wrap",
  wrap(async (req, res) => {
    const costumes = await prisma.costume.findMany({ where: { projectId: req.projectId, isRetired: false }, include: { character: { select: { name: true } }, vendor: { select: { name: true } }, rentals: true }, orderBy: [{ source: "asc" }, { assetNumber: "asc" }] });
    const groups: Record<string, typeof costumes> = {};
    for (const c of costumes) (groups[c.source] ||= []).push(c);
    res.json({ total: costumes.length, groups });
  }),
);
