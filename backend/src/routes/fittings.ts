import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound } from "../lib/errors";
import { parse, parseJson, zDate, zOptionalString } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { FITTING_ITEM_STATUSES, FITTING_STATUSES, OPS_ROLES, MANAGER_ROLES } from "../lib/constants";
import { audit } from "../services/audit";
import { notify } from "../services/notify";

export const fittingsRouter = Router({ mergeParams: true });

const schema = z.object({
  characterId: z.string(),
  actorId: z.string().optional().nullable(),
  scheduledAt: zDate,
  location: zOptionalString,
  status: z.enum(FITTING_STATUSES).optional(),
  notes: zOptionalString,
  costumeIds: z.array(z.string()).optional(),
});

const include = {
  character: { select: { id: true, name: true } },
  actor: { select: { id: true, name: true } },
  items: { include: { costume: { select: { id: true, assetNumber: true, name: true, size: true, status: true } } } },
};

fittingsRouter.get(
  "/",
  wrap(async (req, res) => {
    const where: Record<string, unknown> = { projectId: req.projectId };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.characterId) where.characterId = String(req.query.characterId);
    const fittings = await prisma.fitting.findMany({ where, include, orderBy: { scheduledAt: "desc" } });
    res.json(fittings);
  }),
);

fittingsRouter.post(
  "/",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const data = parse(schema, req.body);
    const character = await prisma.character.findFirst({ where: { id: data.characterId, projectId: req.projectId } });
    if (!character) throw notFound("Character");
    const fitting = await prisma.fitting.create({
      data: {
        projectId: req.projectId!,
        characterId: character.id,
        actorId: data.actorId ?? character.actorId,
        scheduledAt: data.scheduledAt || new Date(),
        location: data.location || null,
        status: data.status || "SCHEDULED",
        notes: data.notes || null,
        items: data.costumeIds ? { create: data.costumeIds.map((costumeId) => ({ costumeId })) } : undefined,
      },
      include,
    });
    await audit(req.user, req.projectId!, "FITTING_CREATE", "FITTING", fitting.id);
    await notify({ projectId: req.projectId!, type: "FITTING", title: "Fitting scheduled", body: `${character.name}: ${fitting.scheduledAt.toLocaleString()}${fitting.location ? ` at ${fitting.location}` : ""}`, entityType: "FITTING", entityId: fitting.id, roles: OPS_ROLES });
    res.status(201).json(fitting);
  }),
);

fittingsRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const fitting = await prisma.fitting.findFirst({ where: { id: req.params.id, projectId: req.projectId }, include: { ...include, character: { include: { actor: true } } } });
    if (!fitting) throw notFound("Fitting");
    const photos = await prisma.photo.findMany({ where: { entityType: "FITTING", entityId: fitting.id }, orderBy: { createdAt: "desc" } });
    const actor = fitting.character.actor ? { ...fitting.character.actor, measurements: parseJson(fitting.character.actor.measurements, {}) } : null;
    res.json({ ...fitting, character: { ...fitting.character, actor }, photos });
  }),
);

fittingsRouter.patch(
  "/:id",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const data = parse(schema.partial().omit({ costumeIds: true, characterId: true }), req.body);
    const existing = await prisma.fitting.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Fitting");
    const fitting = await prisma.fitting.update({ where: { id: existing.id }, data: { ...data, scheduledAt: data.scheduledAt || undefined }, include });
    await audit(req.user, req.projectId!, "FITTING_UPDATE", "FITTING", fitting.id);
    res.json(fitting);
  }),
);

fittingsRouter.delete(
  "/:id",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const existing = await prisma.fitting.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Fitting");
    await prisma.fitting.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  }),
);

fittingsRouter.post(
  "/:id/items",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const { costumeId, status, notes } = parse(z.object({ costumeId: z.string(), status: z.enum(FITTING_ITEM_STATUSES).optional(), notes: zOptionalString }), req.body);
    const fitting = await prisma.fitting.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!fitting) throw notFound("Fitting");
    const item = await prisma.fittingItem.upsert({
      where: { fittingId_costumeId: { fittingId: fitting.id, costumeId } },
      create: { fittingId: fitting.id, costumeId, status: status || "PENDING", notes: notes || null },
      update: { status, notes: notes === undefined ? undefined : notes || null },
      include: { costume: { select: { id: true, assetNumber: true, name: true, size: true, status: true } } },
    });
    res.status(201).json(item);
  }),
);

/** Update one checklist item (fitted / alteration required...). Creates an alteration request automatically when needed. */
fittingsRouter.patch(
  "/:id/items/:costumeId",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const { status, notes, alteration } = parse(
      z.object({ status: z.enum(FITTING_ITEM_STATUSES).optional(), notes: zOptionalString, alteration: z.object({ issue: z.string(), required: z.string(), deadline: zDate }).optional() }),
      req.body,
    );
    const fitting = await prisma.fitting.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!fitting) throw notFound("Fitting");
    const item = await prisma.fittingItem.update({
      where: { fittingId_costumeId: { fittingId: fitting.id, costumeId: req.params.costumeId } },
      data: { status, notes: notes === undefined ? undefined : notes || null },
      include: { costume: { select: { id: true, assetNumber: true, name: true, size: true, status: true } } },
    });
    let alterationRequest = null;
    if (status === "ALTERATION_REQUIRED") {
      alterationRequest = await prisma.alterationRequest.create({
        data: {
          projectId: req.projectId!,
          costumeId: req.params.costumeId,
          characterId: fitting.characterId,
          issue: alteration?.issue || notes || "Alteration required from fitting",
          required: alteration?.required || notes || "See fitting notes",
          deadline: alteration?.deadline || null,
          priority: "HIGH",
        },
      });
      await prisma.costume.update({ where: { id: req.params.costumeId }, data: { status: "ALTERATION", location: "Tailor" } });
      await prisma.costumeMovement.create({ data: { costumeId: req.params.costumeId, action: "ALTERATION_REQUESTED", toLocation: "Tailor", toStatus: "ALTERATION", note: alterationRequest.issue, byUserId: req.user!.id, byUserName: req.user!.name } });
      await notify({ projectId: req.projectId!, type: "ALTERATION", severity: "WARNING", title: "Alteration required", body: `${item.costume.assetNumber} ${item.costume.name}: ${alterationRequest.issue}`, entityType: "ALTERATION", entityId: alterationRequest.id, roles: ["TAILOR", ...MANAGER_ROLES] });
    }
    res.json({ item, alterationRequest });
  }),
);

fittingsRouter.delete(
  "/:id/items/:costumeId",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const fitting = await prisma.fitting.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!fitting) throw notFound("Fitting");
    await prisma.fittingItem.delete({ where: { fittingId_costumeId: { fittingId: fitting.id, costumeId: req.params.costumeId } } });
    res.json({ ok: true });
  }),
);
