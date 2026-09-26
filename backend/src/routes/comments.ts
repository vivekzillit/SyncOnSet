import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound, forbidden } from "../lib/errors";
import { parse } from "../lib/validate";
import { notify } from "../services/notify";

/** Team chat on a single record. Anyone on the production can read and post; only the author deletes. */
export const commentsRouter = Router({ mergeParams: true });

export const CHAT_ENTITIES = ["EXPENSE", "ALTERATION", "DAMAGE", "MISSING", "FITTING"] as const;
type ChatEntity = (typeof CHAT_ENTITIES)[number];

/** The record's one-line name for notifications, or null when it is not in this production. */
async function recordLabel(projectId: string, type: ChatEntity, id: string): Promise<string | null> {
  const where = { id, projectId };
  switch (type) {
    case "EXPENSE": { const e = await prisma.expense.findFirst({ where, select: { description: true } }); return e && `Expense · ${e.description}`; }
    case "ALTERATION": { const a = await prisma.alterationRequest.findFirst({ where, select: { costume: { select: { assetNumber: true, name: true } } } }); return a && `Alteration · ${a.costume.assetNumber} ${a.costume.name}`; }
    case "DAMAGE": { const d = await prisma.damageReport.findFirst({ where, select: { costume: { select: { assetNumber: true, name: true } } } }); return d && `Damage · ${d.costume.assetNumber} ${d.costume.name}`; }
    case "MISSING": { const m = await prisma.missingItem.findFirst({ where, select: { costume: { select: { assetNumber: true, name: true } } } }); return m && `Missing · ${m.costume.assetNumber} ${m.costume.name}`; }
    case "FITTING": { const f = await prisma.fitting.findFirst({ where, select: { character: { select: { name: true } } } }); return f && `Fitting · ${f.character.name}`; }
  }
}

const zEntity = z.enum(CHAT_ENTITIES);

commentsRouter.get(
  "/",
  wrap(async (req, res) => {
    const q = parse(z.object({ entityType: zEntity, entityId: z.string().min(1) }), req.query);
    const items = await prisma.comment.findMany({ where: { projectId: req.projectId, entityType: q.entityType, entityId: q.entityId }, orderBy: { createdAt: "asc" }, take: 500 });
    res.json(items);
  }),
);

/** Message counts per record of one type, for the chat buttons on a list. */
commentsRouter.get(
  "/counts",
  wrap(async (req, res) => {
    const q = parse(z.object({ entityType: zEntity }), req.query);
    const rows = await prisma.comment.groupBy({ by: ["entityId"], where: { projectId: req.projectId, entityType: q.entityType }, _count: { _all: true } });
    res.json(Object.fromEntries(rows.map((r) => [r.entityId, r._count._all])));
  }),
);

commentsRouter.post(
  "/",
  wrap(async (req, res) => {
    const b = parse(z.object({ entityType: zEntity, entityId: z.string().min(1), body: z.string().trim().min(1).max(4000) }), req.body);
    const label = await recordLabel(req.projectId!, b.entityType, b.entityId);
    if (!label) throw notFound("Record");
    const user = req.user!;
    const comment = await prisma.comment.create({ data: { projectId: req.projectId!, entityType: b.entityType, entityId: b.entityId, userId: user.id, userName: user.name, body: b.body } });
    // Everyone on the production hears about it, except the person who wrote it.
    await notify({ projectId: req.projectId!, type: "CHAT", title: `${user.name} on ${label}`, body: b.body.length > 160 ? `${b.body.slice(0, 157)}…` : b.body, entityType: b.entityType, entityId: b.entityId, excludeUserIds: [user.id] });
    res.status(201).json(comment);
  }),
);

commentsRouter.delete(
  "/:id",
  wrap(async (req, res) => {
    const c = await prisma.comment.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!c) throw notFound("Message");
    if (c.userId !== req.user!.id) throw forbidden("Only the author can delete a message");
    await prisma.comment.delete({ where: { id: c.id } });
    res.json({ ok: true });
  }),
);
