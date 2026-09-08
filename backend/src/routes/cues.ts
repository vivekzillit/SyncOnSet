import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound } from "../lib/errors";
import { parse } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { OPS_ROLES } from "../lib/constants";
import { audit } from "../services/audit";

/** AI costume cues: list and accept / dismiss. */
export const cuesRouter = Router({ mergeParams: true });

cuesRouter.get(
  "/",
  wrap(async (req, res) => {
    const where: Record<string, unknown> = { projectId: req.projectId };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.characterId) where.characterId = String(req.query.characterId);
    if (req.query.sceneId) where.sceneId = String(req.query.sceneId);
    const items = await prisma.scriptCue.findMany({ where, include: { scene: { select: { id: true, number: true, name: true, sortOrder: true } }, character: { select: { id: true, name: true } } }, orderBy: [{ scene: { sortOrder: "asc" } }, { createdAt: "asc" }], take: 1000 });
    res.json(items);
  }),
);

cuesRouter.patch(
  "/:id",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const { status, text, characterId } = parse(z.object({ status: z.enum(["SUGGESTED", "ACCEPTED", "DISMISSED"]).optional(), text: z.string().min(1).max(500).optional(), characterId: z.string().optional().nullable() }), req.body);
    const existing = await prisma.scriptCue.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Cue");
    const cue = await prisma.scriptCue.update({ where: { id: existing.id }, data: { status, text, characterId: characterId === undefined ? undefined : characterId }, include: { character: { select: { id: true, name: true } } } });
    await audit(req.user, req.projectId!, "CUE_UPDATE", "CUE", cue.id, { status, text });
    res.json(cue);
  }),
);

/** Bulk accept / dismiss. */
cuesRouter.post(
  "/bulk",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const { ids, status } = parse(z.object({ ids: z.array(z.string()).min(1).max(500), status: z.enum(["SUGGESTED", "ACCEPTED", "DISMISSED"]) }), req.body);
    const r = await prisma.scriptCue.updateMany({ where: { projectId: req.projectId, id: { in: ids } }, data: { status } });
    res.json({ updated: r.count });
  }),
);
