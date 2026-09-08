import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound, badRequest } from "../lib/errors";
import { parse, zOptionalString } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { MANAGER_ROLES, OPS_ROLES } from "../lib/constants";
import { audit } from "../services/audit";

/** Costume changes ("looks") per character. */
export const changesRouter = Router({ mergeParams: true });

const schema = z.object({
  characterId: z.string(),
  changeNumber: z.number().int().min(1).optional(),
  name: z.string().min(1),
  description: zOptionalString,
  notes: zOptionalString,
  costumeIds: z.array(z.string()).optional(),
});

const include = {
  character: { select: { id: true, name: true, actor: { select: { id: true, name: true } } } },
  items: { include: { costume: true } },
  sceneCharacters: { include: { scene: { select: { id: true, number: true, name: true, shootDate: true } } } },
};

changesRouter.get(
  "/",
  wrap(async (req, res) => {
    const where: Record<string, unknown> = { projectId: req.projectId };
    if (req.query.characterId) where.characterId = String(req.query.characterId);
    const changes = await prisma.costumeChange.findMany({ where, include, orderBy: [{ characterId: "asc" }, { changeNumber: "asc" }] });
    const photos = await prisma.photo.findMany({ where: { entityType: "CHANGE", entityId: { in: changes.map((c) => c.id) } } });
    res.json(changes.map((c) => ({ ...c, photos: photos.filter((p) => p.entityId === c.id) })));
  }),
);

changesRouter.post(
  "/",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const data = parse(schema, req.body);
    const character = await prisma.character.findFirst({ where: { id: data.characterId, projectId: req.projectId } });
    if (!character) throw notFound("Character");
    let changeNumber = data.changeNumber;
    if (!changeNumber) {
      const last = await prisma.costumeChange.findFirst({ where: { characterId: character.id }, orderBy: { changeNumber: "desc" } });
      changeNumber = (last?.changeNumber || 0) + 1;
    }
    const change = await prisma.costumeChange.create({
      data: {
        projectId: req.projectId!,
        characterId: character.id,
        changeNumber,
        name: data.name,
        description: data.description || null,
        notes: data.notes || null,
        items: data.costumeIds ? { create: data.costumeIds.map((costumeId) => ({ costumeId })) } : undefined,
      },
      include,
    });
    await audit(req.user, req.projectId!, "CHANGE_CREATE", "CHANGE", change.id);
    res.status(201).json(change);
  }),
);

changesRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const change = await prisma.costumeChange.findFirst({ where: { id: req.params.id, projectId: req.projectId }, include });
    if (!change) throw notFound("Change");
    const photos = await prisma.photo.findMany({ where: { entityType: "CHANGE", entityId: change.id }, orderBy: { createdAt: "desc" } });
    res.json({ ...change, photos });
  }),
);

changesRouter.patch(
  "/:id",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const data = parse(schema.partial().omit({ characterId: true, costumeIds: true }), req.body);
    const existing = await prisma.costumeChange.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Change");
    const change = await prisma.costumeChange.update({ where: { id: existing.id }, data, include });
    await audit(req.user, req.projectId!, "CHANGE_UPDATE", "CHANGE", change.id);
    res.json(change);
  }),
);

changesRouter.delete(
  "/:id",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const existing = await prisma.costumeChange.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Change");
    await prisma.costumeChange.delete({ where: { id: existing.id } });
    await audit(req.user, req.projectId!, "CHANGE_DELETE", "CHANGE", existing.id);
    res.json({ ok: true });
  }),
);

/** Add a costume to a change. */
changesRouter.post(
  "/:id/items",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const { costumeId, wearNotes } = parse(z.object({ costumeId: z.string(), wearNotes: zOptionalString }), req.body);
    const change = await prisma.costumeChange.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!change) throw notFound("Change");
    const costume = await prisma.costume.findFirst({ where: { id: costumeId, projectId: req.projectId } });
    if (!costume) throw badRequest("Costume not in this project");
    const item = await prisma.costumeChangeItem.upsert({
      where: { changeId_costumeId: { changeId: change.id, costumeId } },
      create: { changeId: change.id, costumeId, wearNotes: wearNotes || null },
      update: { wearNotes: wearNotes === undefined ? undefined : wearNotes || null },
      include: { costume: true },
    });
    // Tag the costume to the character if it isn't assigned yet
    if (!costume.characterId) await prisma.costume.update({ where: { id: costumeId }, data: { characterId: change.characterId } });
    await audit(req.user, req.projectId!, "CHANGE_ITEM_ADD", "CHANGE", change.id, { costumeId });
    res.status(201).json(item);
  }),
);

changesRouter.delete(
  "/:id/items/:costumeId",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const change = await prisma.costumeChange.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!change) throw notFound("Change");
    await prisma.costumeChangeItem.delete({ where: { changeId_costumeId: { changeId: change.id, costumeId: req.params.costumeId } } });
    await audit(req.user, req.projectId!, "CHANGE_ITEM_REMOVE", "CHANGE", change.id, { costumeId: req.params.costumeId });
    res.json({ ok: true });
  }),
);
