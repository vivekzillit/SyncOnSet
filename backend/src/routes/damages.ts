import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound } from "../lib/errors";
import { parse, zMoney, zOptionalString } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { DAMAGE_RESPONSIBLE, DAMAGE_STATUSES, OPS_ROLES, MANAGER_ROLES } from "../lib/constants";
import { applyCostumeAction } from "../services/costume";
import { notify } from "../services/notify";

export const damagesRouter = Router({ mergeParams: true });
const include = { costume: { select: { id: true, assetNumber: true, name: true, status: true } }, scene: { select: { id: true, number: true } } };

const schema = z.object({
  costumeId: z.string(),
  sceneId: z.string().optional().nullable(),
  takeNumber: z.number().int().optional().nullable(),
  description: z.string().min(1),
  estimatedRepairCost: zMoney,
  responsible: z.enum(DAMAGE_RESPONSIBLE).optional().nullable(),
  notes: zOptionalString,
});

damagesRouter.get(
  "/",
  wrap(async (req, res) => {
    const where: Record<string, unknown> = { projectId: req.projectId };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.open === "true") where.status = { in: ["OPEN", "REPAIRING"] };
    const items = await prisma.damageReport.findMany({ where, include, orderBy: { createdAt: "desc" } });
    const photos = await prisma.photo.findMany({ where: { entityType: "DAMAGE", entityId: { in: items.map((i) => i.id) } } });
    res.json(items.map((i) => ({ ...i, photos: photos.filter((p) => p.entityId === i.id) })));
  }),
);

damagesRouter.post(
  "/",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const data = parse(schema, req.body);
    const costume = await prisma.costume.findFirst({ where: { id: data.costumeId, projectId: req.projectId } });
    if (!costume) throw notFound("Costume");
    const report = await prisma.damageReport.create({ data: { ...data, projectId: req.projectId! }, include });
    await applyCostumeAction(costume.id, { action: "MARK_DAMAGED", sceneId: data.sceneId, takeNumber: data.takeNumber, note: data.description }, req.user);
    await notify({ projectId: req.projectId!, type: "DAMAGE", severity: "WARNING", title: "Costume damaged", body: `${costume.assetNumber} ${costume.name}: ${data.description}`, entityType: "DAMAGE", entityId: report.id, roles: MANAGER_ROLES });
    res.status(201).json(report);
  }),
);

damagesRouter.patch(
  "/:id",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const data = parse(schema.partial().omit({ costumeId: true }).extend({ status: z.enum(DAMAGE_STATUSES).optional() }), req.body);
    const existing = await prisma.damageReport.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Damage report");
    const report = await prisma.damageReport.update({ where: { id: existing.id }, data, include });
    if (data.status === "REPAIRED") {
      await applyCostumeAction(existing.costumeId, { action: "REPAIRED", note: "Damage repaired" }, req.user);
      if (existing.estimatedRepairCost) {
        await prisma.expense.create({ data: { projectId: req.projectId!, category: "DAMAGE", amount: existing.estimatedRepairCost, description: `Repair ${report.costume.assetNumber}: ${existing.description}`, costumeId: existing.costumeId } });
      }
    } else if (data.status === "WRITTEN_OFF") {
      await applyCostumeAction(existing.costumeId, { action: "RETIRE", note: "Written off after damage" }, req.user);
    }
    res.json(report);
  }),
);
