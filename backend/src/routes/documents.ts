import { Router } from "express";
import { prisma } from "../lib/prisma";
import { wrap } from "../lib/errors";

export const documentsRouter = Router({ mergeParams: true });

/** The scripts, schedules and call sheets kept for this production, newest first (?kind=SCRIPT|SCHEDULE|CALLSHEET). */
documentsRouter.get(
  "/",
  wrap(async (req, res) => {
    const kind = typeof req.query.kind === "string" && ["SCRIPT", "SCHEDULE", "CALLSHEET"].includes(req.query.kind) ? req.query.kind : undefined;
    res.json(await prisma.projectDocument.findMany({ where: { projectId: req.projectId, ...(kind ? { kind } : {}) }, orderBy: { uploadedAt: "desc" }, take: 50 }));
  }),
);
