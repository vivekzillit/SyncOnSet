import { Router } from "express";
import { prisma } from "../lib/prisma";
import { wrap } from "../lib/errors";

export const notificationsRouter = Router({ mergeParams: true });

notificationsRouter.get(
  "/",
  wrap(async (req, res) => {
    const where: Record<string, unknown> = { projectId: req.projectId, userId: req.user!.id };
    if (req.query.unread === "true") where.read = false;
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.notification.count({ where: { projectId: req.projectId, userId: req.user!.id, read: false } }),
    ]);
    res.json({ items, unread });
  }),
);

notificationsRouter.post(
  "/read",
  wrap(async (req, res) => {
    const ids: string[] | undefined = Array.isArray(req.body?.ids) ? req.body.ids : undefined;
    await prisma.notification.updateMany({ where: { projectId: req.projectId, userId: req.user!.id, ...(ids ? { id: { in: ids } } : {}) }, data: { read: true } });
    res.json({ ok: true });
  }),
);
