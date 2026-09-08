import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound } from "../lib/errors";
import { parse, zDate, zOptionalString } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { MANAGER_ROLES, OPS_ROLES, RENTAL_STATUSES } from "../lib/constants";
import { notify } from "../services/notify";
import { applyCostumeAction } from "../services/costume";

export const vendorsRouter = Router({ mergeParams: true });
export const rentalsRouter = Router({ mergeParams: true });

const vendorSchema = z.object({ name: z.string().min(1), contactName: zOptionalString, phone: zOptionalString, email: zOptionalString, address: zOptionalString, notes: zOptionalString });

vendorsRouter.get("/", wrap(async (req, res) => res.json(await prisma.vendor.findMany({ where: { projectId: req.projectId }, include: { _count: { select: { costumes: true, rentals: true } } }, orderBy: { name: "asc" } }))));
vendorsRouter.post(
  "/",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const data = parse(vendorSchema, req.body);
    res.status(201).json(await prisma.vendor.create({ data: { ...data, projectId: req.projectId! } }));
  }),
);
vendorsRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const v = await prisma.vendor.findFirst({ where: { id: req.params.id, projectId: req.projectId }, include: { costumes: true, rentals: { include: { costume: { select: { assetNumber: true, name: true } } } } } });
    if (!v) throw notFound("Vendor");
    res.json(v);
  }),
);
vendorsRouter.patch(
  "/:id",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const data = parse(vendorSchema.partial(), req.body);
    const existing = await prisma.vendor.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Vendor");
    res.json(await prisma.vendor.update({ where: { id: existing.id }, data }));
  }),
);
vendorsRouter.delete(
  "/:id",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const existing = await prisma.vendor.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Vendor");
    await prisma.vendor.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  }),
);

const rentalSchema = z.object({ costumeId: z.string(), vendorId: z.string(), ratePerDay: z.number().min(0), pickupDate: zDate, returnDate: zDate, status: z.enum(RENTAL_STATUSES).optional(), notes: zOptionalString });
const rentalInclude = { costume: { select: { id: true, assetNumber: true, name: true, status: true } }, vendor: { select: { id: true, name: true, phone: true } } };

rentalsRouter.get(
  "/",
  wrap(async (req, res) => {
    const rentals = await prisma.rental.findMany({ where: { projectId: req.projectId }, include: rentalInclude, orderBy: { returnDate: "asc" } });
    const now = Date.now();
    res.json(rentals.map((r) => ({ ...r, isOverdue: r.status !== "RETURNED" && r.returnDate.getTime() < now, dueSoon: r.status !== "RETURNED" && r.returnDate.getTime() - now < 2 * 86400000 })));
  }),
);
rentalsRouter.post(
  "/",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const data = parse(rentalSchema, req.body);
    if (!data.pickupDate || !data.returnDate) throw notFound("pickupDate and returnDate are required");
    const rental = await prisma.rental.create({ data: { ...data, pickupDate: data.pickupDate, returnDate: data.returnDate, projectId: req.projectId! }, include: rentalInclude });
    await prisma.costume.update({ where: { id: data.costumeId }, data: { source: "RENTED", vendorId: data.vendorId, rentalCostPerDay: data.ratePerDay } });
    res.status(201).json(rental);
  }),
);
rentalsRouter.patch(
  "/:id",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const data = parse(rentalSchema.partial().omit({ costumeId: true }), req.body);
    const existing = await prisma.rental.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Rental");
    const rental = await prisma.rental.update({ where: { id: existing.id }, data: { ...data, pickupDate: data.pickupDate || undefined, returnDate: data.returnDate || undefined }, include: rentalInclude });
    if (data.status === "RETURNED") {
      await applyCostumeAction(existing.costumeId, { action: "RETURN_TO_VENDOR", note: `Returned to ${rental.vendor.name}` }, req.user);
      const days = Math.max(1, Math.ceil((rental.returnDate.getTime() - rental.pickupDate.getTime()) / 86400000));
      await prisma.expense.create({ data: { projectId: req.projectId!, category: "RENTAL", amount: days * rental.ratePerDay, description: `Rental ${rental.costume.assetNumber} ${rental.costume.name} (${days} days)`, costumeId: existing.costumeId, vendorId: existing.vendorId } });
    }
    res.json(rental);
  }),
);

/** Called by the scheduler/cron (or manually) to raise reminders for rentals due within 24h. */
rentalsRouter.post(
  "/remind",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const soon = new Date(Date.now() + 86400000);
    const due = await prisma.rental.findMany({ where: { projectId: req.projectId, status: { in: ["BOOKED", "PICKED_UP"] }, returnDate: { lte: soon } }, include: rentalInclude });
    for (const r of due) {
      await notify({ projectId: req.projectId!, type: "RENTAL", severity: r.returnDate.getTime() < Date.now() ? "CRITICAL" : "WARNING", title: r.returnDate.getTime() < Date.now() ? "Rental overdue" : "Rental return due", body: `${r.costume.assetNumber} ${r.costume.name} (${r.vendor.name}) due ${r.returnDate.toDateString()}.`, entityType: "RENTAL", entityId: r.id, roles: OPS_ROLES });
      if (r.returnDate.getTime() < Date.now() && r.status !== "OVERDUE") await prisma.rental.update({ where: { id: r.id }, data: { status: "OVERDUE" } });
    }
    res.json({ reminded: due.length });
  }),
);
