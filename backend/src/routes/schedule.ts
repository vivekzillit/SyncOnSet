import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, badRequest } from "../lib/errors";
import { parse, zDate } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { MANAGER_ROLES } from "../lib/constants";
import { audit } from "../services/audit";
import { extractDocumentText, normalizeNumber, parseScheduleText, type DocKind } from "../services/scheduleParser";

/** Shooting schedules and call sheets: upload → preview of shoot dates per scene → apply. Same shape as the script upload. */
export const scheduleRouter = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/**
 * Read a schedule or call sheet (PDF, CSV or text) and return the shoot date it gives each scene.
 * Nothing is written; the client confirms with POST /apply.
 */
scheduleRouter.post(
  "/parse",
  requireRole(MANAGER_ROLES),
  upload.single("file"),
  wrap(async (req, res) => {
    if (!req.file) throw badRequest("file is required (PDF, CSV or text)");
    const kind: DocKind = req.body?.kind === "CALLSHEET" ? "CALLSHEET" : "SCHEDULE";
    const { text, format } = await extractDocumentText(req.file.buffer, req.file.originalname || "", req.file.mimetype || "");
    const project = await prisma.project.findUnique({ where: { id: req.projectId }, select: { startDate: true, prepStartDate: true } });
    const defaultYear = (project?.startDate || project?.prepStartDate || new Date()).getFullYear();
    const parsed = parseScheduleText(text, { kind, defaultYear, csv: format === "csv" });

    const stored = await prisma.scene.findMany({ where: { projectId: req.projectId }, select: { id: true, number: true, name: true, location: true, intExt: true, shootDate: true, status: true, sortOrder: true } });
    const byNumber = new Map(stored.map((s) => [normalizeNumber(s.number), s]));
    // One row per scene named in the document, in scene order, exactly like the script upload's preview.
    const seen = new Set<string>();
    const scenes = parsed.days.flatMap((day) =>
      day.scenes.filter((n) => !seen.has(normalizeNumber(n)) && seen.add(normalizeNumber(n)) !== undefined).map((n) => {
        const sc = byNumber.get(normalizeNumber(n));
        return {
          number: n,
          id: sc?.id ?? null,
          exists: !!sc,
          name: sc?.name ?? null,
          location: sc?.location ?? null,
          intExt: sc?.intExt ?? null,
          status: sc?.status ?? null,
          currentShootDate: sc?.shootDate ?? null,
          date: day.date,
          dayNumber: day.dayNumber,
          sortOrder: sc?.sortOrder ?? Number.MAX_SAFE_INTEGER,
        };
      }),
    ).sort((a, b) => a.sortOrder - b.sortOrder);
    const matched = scenes.filter((s) => s.exists).length;
    await audit(req.user, req.projectId!, "SCHEDULE_PARSE", "SCENE", "preview", { kind, file: req.file.originalname, format, days: parsed.days.length, scenes: scenes.length, matched });
    res.json({
      kind, file: req.file.originalname, format,
      date: parsed.date, dayNumber: parsed.dayNumber,
      days: parsed.days.length,
      scenes,
      warnings: parsed.warnings,
      breakdownEmpty: stored.length === 0,
    });
  }),
);

const applySchema = z.object({ assignments: z.array(z.object({ sceneId: z.string(), date: zDate })).max(5000) });

/** Give the confirmed scenes their shoot date; PLANNED scenes become SCHEDULED. Nothing else changes. */
scheduleRouter.post(
  "/apply",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const body = parse(applySchema, req.body);
    const own = await prisma.scene.findMany({ where: { projectId: req.projectId, id: { in: body.assignments.map((a) => a.sceneId) } }, select: { id: true, status: true } });
    const byId = new Map(own.map((s) => [s.id, s]));
    let updated = 0, missing = 0;
    for (const a of body.assignments) {
      const sc = byId.get(a.sceneId);
      if (!sc) { missing++; continue; }
      if (a.date === undefined) continue;
      await prisma.scene.update({ where: { id: sc.id }, data: { shootDate: a.date, ...(a.date && sc.status === "PLANNED" ? { status: "SCHEDULED" } : {}) } });
      updated++;
    }
    await audit(req.user, req.projectId!, "SCHEDULE_APPLY", "SCENE", "bulk", { updated, missing });
    res.json({ updated, missing });
  }),
);
