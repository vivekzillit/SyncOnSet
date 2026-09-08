import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound } from "../lib/errors";
import { parse, zDate, zOptionalString } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { MISSING_STATUSES, OPS_ROLES } from "../lib/constants";
import { applyCostumeAction } from "../services/costume";

export const missingRouter = Router({ mergeParams: true });
const include = { costume: { select: { id: true, assetNumber: true, name: true, status: true, location: true, character: { select: { name: true } } } } };

missingRouter.get(
  "/",
  wrap(async (req, res) => {
    const where: Record<string, unknown> = { projectId: req.projectId };
    if (req.query.status) where.status = String(req.query.status);
    res.json(await prisma.missingItem.findMany({ where, include, orderBy: { createdAt: "desc" } }));
  }),
);

missingRouter.post(
  "/",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const data = parse(z.object({ costumeId: z.string(), lastSeenLocation: zOptionalString, lastAssignedTo: zOptionalString, lastScanAt: zDate, notes: zOptionalString }), req.body);
    const costume = await prisma.costume.findFirst({ where: { id: data.costumeId, projectId: req.projectId } });
    if (!costume) throw notFound("Costume");
    // applyCostumeAction(MARK_MISSING) creates the MissingItem + notification
    await applyCostumeAction(costume.id, { action: "MARK_MISSING", note: data.notes }, req.user);
    const item = await prisma.missingItem.findFirst({ where: { costumeId: costume.id, status: "OPEN" }, orderBy: { createdAt: "desc" } });
    const updated = await prisma.missingItem.update({ where: { id: item!.id }, data: { lastSeenLocation: data.lastSeenLocation || costume.location, lastAssignedTo: data.lastAssignedTo || undefined, lastScanAt: data.lastScanAt || undefined }, include });
    res.status(201).json(updated);
  }),
);

missingRouter.patch(
  "/:id",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const data = parse(z.object({ status: z.enum(MISSING_STATUSES).optional(), notes: zOptionalString, foundLocation: zOptionalString }), req.body);
    const existing = await prisma.missingItem.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Missing item");
    const item = await prisma.missingItem.update({ where: { id: existing.id }, data: { status: data.status, notes: data.notes === undefined ? undefined : data.notes, resolvedAt: data.status && data.status !== "OPEN" ? new Date() : undefined }, include });
    if (data.status === "FOUND") await applyCostumeAction(existing.costumeId, { action: "FOUND", toLocation: data.foundLocation || "Wardrobe Truck" }, req.user);
    if (data.status === "WRITTEN_OFF") await applyCostumeAction(existing.costumeId, { action: "RETIRE", note: "Written off (lost)" }, req.user);
    res.json(item);
  }),
);
