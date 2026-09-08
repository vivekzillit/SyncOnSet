import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound } from "../lib/errors";
import { parse, parseJson, zOptionalString } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { CHARACTER_TYPES, MANAGER_ROLES } from "../lib/constants";
import { audit } from "../services/audit";

export const charactersRouter = Router({ mergeParams: true });

const schema = z.object({
  name: z.string().min(1),
  type: z.enum(CHARACTER_TYPES).optional(),
  castNumber: z.number().int().min(0).optional().nullable(),
  actorId: z.string().optional().nullable(),
  age: z.number().int().min(0).max(150).optional().nullable(),
  description: zOptionalString,
  notes: zOptionalString,
});

charactersRouter.get(
  "/",
  wrap(async (req, res) => {
    const characters = await prisma.character.findMany({
      where: { projectId: req.projectId },
      include: {
        actor: { select: { id: true, name: true } },
        _count: { select: { scenes: true, changes: true, costumes: true } },
      },
      orderBy: [{ castNumber: "asc" }, { type: "asc" }, { name: "asc" }],
    });
    res.json(characters);
  }),
);

charactersRouter.post(
  "/",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const data = parse(schema, req.body);
    const character = await prisma.character.create({ data: { ...data, projectId: req.projectId! } });
    await audit(req.user, req.projectId!, "CHARACTER_CREATE", "CHARACTER", character.id);
    res.status(201).json(character);
  }),
);

charactersRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const character = await prisma.character.findFirst({
      where: { id: req.params.id, projectId: req.projectId },
      include: {
        actor: true,
        scenes: { include: { scene: { select: { id: true, number: true, name: true, shootDate: true, status: true, sortOrder: true, intExt: true, location: true, timeOfDay: true, scriptDay: true, pages: true, synopsis: true } }, change: { select: { id: true, changeNumber: true, name: true } } } },
        changes: { orderBy: { changeNumber: "asc" }, include: { items: { include: { costume: true } }, _count: { select: { sceneCharacters: true } } } },
        costumes: { orderBy: { assetNumber: "asc" } },
        fittings: { orderBy: { scheduledAt: "desc" }, include: { items: true } },
      },
    });
    if (!character) throw notFound("Character");
    const photos = await prisma.photo.findMany({ where: { entityType: "CHARACTER", entityId: character.id }, orderBy: { createdAt: "desc" } });
    character.scenes.sort((a, b) => a.scene.sortOrder - b.scene.sortOrder);
    res.json({ ...character, actor: character.actor ? { ...character.actor, measurements: parseJson(character.actor.measurements, {}) } : null, photos });
  }),
);

charactersRouter.patch(
  "/:id",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const data = parse(schema.partial(), req.body);
    const existing = await prisma.character.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Character");
    const character = await prisma.character.update({ where: { id: existing.id }, data });
    await audit(req.user, req.projectId!, "CHARACTER_UPDATE", "CHARACTER", character.id);
    res.json(character);
  }),
);

charactersRouter.delete(
  "/:id",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const existing = await prisma.character.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Character");
    await prisma.character.delete({ where: { id: existing.id } });
    await audit(req.user, req.projectId!, "CHARACTER_DELETE", "CHARACTER", existing.id);
    res.json({ ok: true });
  }),
);
