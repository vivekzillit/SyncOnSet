import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound } from "../lib/errors";
import { parse, zDate, zOptionalString } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { CLEANING_ROLES, CLEANING_STATUSES, CLEANING_TYPES, OPS_ROLES, PRIORITIES, CLEANING_PIPELINE } from "../lib/constants";
import { advanceCleaning, assignReplacement, createCleaningRequest, emergencyCleaning } from "../services/cleaning";
import { findAlternatives } from "../services/costume";

export const cleaningRouter = Router({ mergeParams: true });

const include = {
  costume: { select: { id: true, assetNumber: true, name: true, category: true, type: true, color: true, size: true, status: true, location: true, character: { select: { id: true, name: true } } } },
  replacement: { select: { id: true, assetNumber: true, name: true } },
  scene: { select: { id: true, number: true, name: true } },
  logs: { orderBy: { createdAt: "asc" as const } },
};

cleaningRouter.get(
  "/",
  wrap(async (req, res) => {
    const where: Record<string, unknown> = { projectId: req.projectId };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.open === "true") where.status = { notIn: ["READY", "CANCELLED"] };
    if (req.query.costumeId) where.costumeId = String(req.query.costumeId);
    const items = await prisma.cleaningRequest.findMany({ where, include, orderBy: [{ isEmergency: "desc" }, { createdAt: "desc" }], take: 500 });
    const priorityRank: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
    items.sort((a, b) => (a.status === "READY") === (b.status === "READY") ? priorityRank[a.priority] - priorityRank[b.priority] || b.createdAt.getTime() - a.createdAt.getTime() : a.status === "READY" ? 1 : -1);
    res.json({ pipeline: CLEANING_PIPELINE, items });
  }),
);

const createSchema = z.object({
  costumeId: z.string(),
  sceneId: z.string().optional().nullable(),
  takeNumber: z.number().int().optional().nullable(),
  problem: z.string().min(1),
  cleaningType: z.enum(CLEANING_TYPES),
  priority: z.enum(PRIORITIES).optional(),
  isEmergency: z.boolean().optional(),
  expectedReadyAt: zDate,
  assignedToId: z.string().optional().nullable(),
  notes: zOptionalString,
});

cleaningRouter.post(
  "/",
  requireRole(CLEANING_ROLES),
  wrap(async (req, res) => {
    const data = parse(createSchema, req.body);
    const request = await createCleaningRequest({ ...data, projectId: req.projectId! }, req.user);
    const full = await prisma.cleaningRequest.findUnique({ where: { id: request.id }, include });
    res.status(201).json(full);
  }),
);

/** 🚨 Emergency on-set cleaning: accepts costumeId OR assetNumber (from scan). */
cleaningRouter.post(
  "/emergency",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const data = parse(
      z.object({
        costumeId: z.string().optional(),
        assetNumber: z.string().optional(),
        sceneId: z.string().optional().nullable(),
        takeNumber: z.number().int().optional().nullable(),
        problem: z.string().min(1),
        cleaningType: z.enum(CLEANING_TYPES).optional(),
        autoAssignReplacement: z.boolean().optional(),
      }),
      req.body,
    );
    let costumeId = data.costumeId;
    if (!costumeId && data.assetNumber) {
      const c = await prisma.costume.findFirst({ where: { projectId: req.projectId, assetNumber: data.assetNumber.trim().toUpperCase() } });
      if (!c) throw notFound(`Costume ${data.assetNumber}`);
      costumeId = c.id;
    }
    if (!costumeId) throw notFound("Costume");
    const result = await emergencyCleaning({ ...data, costumeId, projectId: req.projectId! }, req.user);
    const full = await prisma.cleaningRequest.findUnique({ where: { id: result.request.id }, include });
    res.status(201).json({ ...result, request: full });
  }),
);

cleaningRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const item = await prisma.cleaningRequest.findFirst({ where: { id: req.params.id, projectId: req.projectId }, include });
    if (!item) throw notFound("Cleaning request");
    const [alternatives, photos] = await Promise.all([
      item.status === "READY" || item.status === "CANCELLED" ? Promise.resolve([]) : findAlternatives(item.costumeId, 5),
      prisma.photo.findMany({ where: { entityType: "CLEANING", entityId: item.id }, orderBy: { createdAt: "desc" } }),
    ]);
    res.json({ ...item, alternatives, photos, pipeline: CLEANING_PIPELINE });
  }),
);

cleaningRouter.patch(
  "/:id",
  requireRole(CLEANING_ROLES),
  wrap(async (req, res) => {
    const data = parse(createSchema.partial().omit({ costumeId: true }), req.body);
    const existing = await prisma.cleaningRequest.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Cleaning request");
    let assignedToName: string | undefined;
    if (data.assignedToId) assignedToName = (await prisma.user.findUnique({ where: { id: data.assignedToId } }))?.name;
    const item = await prisma.cleaningRequest.update({ where: { id: existing.id }, data: { ...data, assignedToName }, include });
    res.json(item);
  }),
);

/** Advance to next stage (or a specific one). Body: { toStatus?, note?, qcResult?, qcNotes?, returnLocation? } */
cleaningRouter.post(
  "/:id/advance",
  requireRole(CLEANING_ROLES),
  wrap(async (req, res) => {
    const body = parse(
      z.object({ toStatus: z.enum(CLEANING_STATUSES).optional(), note: zOptionalString, qcResult: z.enum(["PASS", "FAIL"]).optional(), qcNotes: zOptionalString, returnLocation: zOptionalString }),
      req.body,
    );
    const existing = await prisma.cleaningRequest.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Cleaning request");
    const item = await advanceCleaning(existing.id, req.user, body);
    res.json(item);
  }),
);

cleaningRouter.post(
  "/:id/replacement",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const { costumeId } = parse(z.object({ costumeId: z.string() }), req.body);
    const existing = await prisma.cleaningRequest.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Cleaning request");
    const repl = await assignReplacement(existing.id, costumeId, req.user);
    res.json(repl);
  }),
);
