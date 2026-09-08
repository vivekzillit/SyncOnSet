import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound, badRequest } from "../lib/errors";
import { parse, zDate, zOptionalString } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { ALTERATION_PIPELINE, ALTERATION_STATUSES, MANAGER_ROLES, PRIORITIES, TAILOR_ROLES } from "../lib/constants";
import { audit } from "../services/audit";
import { notify } from "../services/notify";
import { applyCostumeAction } from "../services/costume";

export const alterationsRouter = Router({ mergeParams: true });

const include = {
  costume: { select: { id: true, assetNumber: true, name: true, size: true, status: true, location: true } },
  character: { select: { id: true, name: true, actor: { select: { name: true } } } },
};

const schema = z.object({
  costumeId: z.string(),
  characterId: z.string().optional().nullable(),
  issue: z.string().min(1),
  required: z.string().min(1),
  tailorName: zOptionalString,
  assignedToId: z.string().optional().nullable(),
  priority: z.enum(PRIORITIES).optional(),
  deadline: zDate,
  notes: zOptionalString,
});

alterationsRouter.get(
  "/",
  wrap(async (req, res) => {
    const where: Record<string, unknown> = { projectId: req.projectId };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.open === "true") where.status = { notIn: ["COMPLETED", "CANCELLED"] };
    const items = await prisma.alterationRequest.findMany({ where, include, orderBy: [{ deadline: "asc" }, { createdAt: "desc" }] });
    res.json({ pipeline: ALTERATION_PIPELINE, items });
  }),
);

alterationsRouter.post(
  "/",
  requireRole(TAILOR_ROLES),
  wrap(async (req, res) => {
    const data = parse(schema, req.body);
    const costume = await prisma.costume.findFirst({ where: { id: data.costumeId, projectId: req.projectId } });
    if (!costume) throw notFound("Costume");
    const item = await prisma.alterationRequest.create({ data: { ...data, projectId: req.projectId!, characterId: data.characterId ?? costume.characterId, status: data.assignedToId || data.tailorName ? "ASSIGNED" : "REQUESTED" }, include });
    await applyCostumeAction(costume.id, { action: "ALTERATION_REQUESTED", note: `${data.issue} → ${data.required}` }, req.user);
    await notify({ projectId: req.projectId!, type: "ALTERATION", severity: data.priority === "URGENT" ? "CRITICAL" : "WARNING", title: "Alteration requested", body: `${costume.assetNumber} ${costume.name}: ${data.issue}`, entityType: "ALTERATION", entityId: item.id, roles: ["TAILOR", ...MANAGER_ROLES] });
    res.status(201).json(item);
  }),
);

alterationsRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const item = await prisma.alterationRequest.findFirst({ where: { id: req.params.id, projectId: req.projectId }, include });
    if (!item) throw notFound("Alteration");
    res.json({ ...item, pipeline: ALTERATION_PIPELINE });
  }),
);

alterationsRouter.patch(
  "/:id",
  requireRole(TAILOR_ROLES),
  wrap(async (req, res) => {
    const data = parse(schema.partial().omit({ costumeId: true }), req.body);
    const existing = await prisma.alterationRequest.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Alteration");
    const item = await prisma.alterationRequest.update({ where: { id: existing.id }, data, include });
    res.json(item);
  }),
);

/** Advance status. Completing returns the costume to AVAILABLE. */
alterationsRouter.post(
  "/:id/advance",
  requireRole(TAILOR_ROLES),
  wrap(async (req, res) => {
    const { toStatus, note } = parse(z.object({ toStatus: z.enum(ALTERATION_STATUSES).optional(), note: zOptionalString }), req.body);
    const existing = await prisma.alterationRequest.findFirst({ where: { id: req.params.id, projectId: req.projectId }, include: { costume: true } });
    if (!existing) throw notFound("Alteration");
    if (existing.status === "COMPLETED" || existing.status === "CANCELLED") throw badRequest(`Already ${existing.status}`);
    const idx = ALTERATION_PIPELINE.indexOf(existing.status as (typeof ALTERATION_PIPELINE)[number]);
    const next = toStatus || ALTERATION_PIPELINE[Math.min(idx + 1, ALTERATION_PIPELINE.length - 1)];
    const item = await prisma.alterationRequest.update({ where: { id: existing.id }, data: { status: next, notes: note ? `${existing.notes ? existing.notes + "\n" : ""}${next}: ${note}` : undefined }, include });
    if (next === "COMPLETED" || next === "CANCELLED") {
      await applyCostumeAction(existing.costumeId, { action: "ALTERATION_COMPLETE", note: next === "COMPLETED" ? "Alteration completed" : "Alteration cancelled" }, req.user);
      if (next === "COMPLETED") {
        await notify({ projectId: req.projectId!, type: "ALTERATION", title: "Alteration completed", body: `${existing.costume.assetNumber} ${existing.costume.name} is ready for fitting.`, entityType: "ALTERATION", entityId: item.id, roles: TAILOR_ROLES });
      }
    }
    await audit(req.user, req.projectId!, "ALTERATION_ADVANCE", "ALTERATION", item.id, { from: existing.status, to: next });
    res.json(item);
  }),
);
