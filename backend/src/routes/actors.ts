import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound } from "../lib/errors";
import { parse, zDate, zOptionalString, parseJson } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { GENDERS, MANAGER_ROLES } from "../lib/constants";
import { audit } from "../services/audit";

export const actorsRouter = Router({ mergeParams: true });

const schema = z.object({
  name: z.string().min(1),
  gender: z.enum(GENDERS).optional().nullable(),
  age: z.number().int().min(0).max(120).optional().nullable(),
  phone: zOptionalString,
  phone2: zOptionalString,
  email: zOptionalString,
  email2: zOptionalString,
  agency: zOptionalString,
  startWorkDate: zDate,
  nextFittingAt: zDate,
  fittingComment: zOptionalString,
  /** character ids to link to this actor (replaces existing links when provided) */
  characterIds: z.array(z.string()).optional(),
  measurements: z.record(z.union([z.string(), z.number()])).optional().nullable(),
  notes: zOptionalString,
});

const shape = <T extends { measurements: string | null }>(a: T) => ({ ...a, measurements: parseJson<Record<string, string | number>>(a.measurements, {}) });

actorsRouter.get(
  "/",
  wrap(async (req, res) => {
    const actors = await prisma.actor.findMany({
      where: { projectId: req.projectId },
      include: { characters: { select: { id: true, name: true, type: true, castNumber: true } }, fittings: { where: { status: { in: ["SCHEDULED", "IN_PROGRESS"] }, scheduledAt: { gte: new Date(Date.now() - 6 * 3600 * 1000) } }, orderBy: { scheduledAt: "asc" }, take: 1, select: { id: true, scheduledAt: true, location: true } } },
      orderBy: { name: "asc" },
    });
    res.json(actors.map((a) => ({ ...shape(a), nextFitting: a.nextFittingAt || a.fittings[0]?.scheduledAt || null, nextFittingId: a.fittings[0]?.id || null })));
  }),
);

actorsRouter.post(
  "/",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const { characterIds, ...data } = parse(schema, req.body);
    const actor = await prisma.actor.create({ data: { ...data, projectId: req.projectId!, measurements: data.measurements ? JSON.stringify(data.measurements) : null } });
    if (characterIds?.length) await prisma.character.updateMany({ where: { projectId: req.projectId, id: { in: characterIds } }, data: { actorId: actor.id } });
    await audit(req.user, req.projectId!, "ACTOR_CREATE", "ACTOR", actor.id);
    const full = await prisma.actor.findUnique({ where: { id: actor.id }, include: { characters: { select: { id: true, name: true, type: true, castNumber: true } } } });
    res.status(201).json(shape(full!));
  }),
);

actorsRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const actor = await prisma.actor.findFirst({
      where: { id: req.params.id, projectId: req.projectId },
      include: { characters: { include: { changes: { orderBy: { changeNumber: "asc" } } } }, fittings: { orderBy: { scheduledAt: "desc" }, include: { character: { select: { name: true } } } } },
    });
    if (!actor) throw notFound("Actor");
    res.json(shape(actor));
  }),
);

actorsRouter.patch(
  "/:id",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const { characterIds, ...data } = parse(schema.partial(), req.body);
    const existing = await prisma.actor.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Actor");
    const actor = await prisma.actor.update({
      where: { id: existing.id },
      data: { ...data, measurements: data.measurements === undefined ? undefined : data.measurements ? JSON.stringify(data.measurements) : null },
    });
    if (characterIds) {
      await prisma.character.updateMany({ where: { projectId: req.projectId, actorId: existing.id, id: { notIn: characterIds } }, data: { actorId: null } });
      if (characterIds.length) await prisma.character.updateMany({ where: { projectId: req.projectId, id: { in: characterIds } }, data: { actorId: existing.id } });
    }
    await audit(req.user, req.projectId!, "ACTOR_UPDATE", "ACTOR", actor.id);
    const full = await prisma.actor.findUnique({ where: { id: actor.id }, include: { characters: { select: { id: true, name: true, type: true, castNumber: true } } } });
    res.json(shape(full!));
  }),
);

actorsRouter.delete(
  "/:id",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const existing = await prisma.actor.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Actor");
    await prisma.actor.delete({ where: { id: existing.id } });
    await audit(req.user, req.projectId!, "ACTOR_DELETE", "ACTOR", existing.id);
    res.json({ ok: true });
  }),
);
