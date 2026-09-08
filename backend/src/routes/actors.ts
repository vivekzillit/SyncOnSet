import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound } from "../lib/errors";
import { parse, zOptionalString, parseJson } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { MANAGER_ROLES } from "../lib/constants";
import { audit } from "../services/audit";

export const actorsRouter = Router({ mergeParams: true });

const schema = z.object({
  name: z.string().min(1),
  phone: zOptionalString,
  email: zOptionalString,
  agency: zOptionalString,
  measurements: z.record(z.union([z.string(), z.number()])).optional().nullable(),
  notes: zOptionalString,
});

const shape = <T extends { measurements: string | null }>(a: T) => ({ ...a, measurements: parseJson<Record<string, string | number>>(a.measurements, {}) });

actorsRouter.get(
  "/",
  wrap(async (req, res) => {
    const actors = await prisma.actor.findMany({ where: { projectId: req.projectId }, include: { characters: { select: { id: true, name: true, type: true } } }, orderBy: { name: "asc" } });
    res.json(actors.map(shape));
  }),
);

actorsRouter.post(
  "/",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const data = parse(schema, req.body);
    const actor = await prisma.actor.create({ data: { ...data, projectId: req.projectId!, measurements: data.measurements ? JSON.stringify(data.measurements) : null } });
    await audit(req.user, req.projectId!, "ACTOR_CREATE", "ACTOR", actor.id);
    res.status(201).json(shape(actor));
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
    const data = parse(schema.partial(), req.body);
    const existing = await prisma.actor.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Actor");
    const actor = await prisma.actor.update({
      where: { id: existing.id },
      data: { ...data, measurements: data.measurements === undefined ? undefined : data.measurements ? JSON.stringify(data.measurements) : null },
    });
    await audit(req.user, req.projectId!, "ACTOR_UPDATE", "ACTOR", actor.id);
    res.json(shape(actor));
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
