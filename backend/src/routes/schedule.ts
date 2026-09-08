import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { config } from "../config";
import { wrap, badRequest, notFound } from "../lib/errors";
import { parse, zDate } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { MANAGER_ROLES } from "../lib/constants";
import { audit } from "../services/audit";
import { extractDocumentText, normalizeNumber, parseScheduleText, type DocKind } from "../services/scheduleParser";

/** Shooting schedules and call sheets: upload → preview of shoot days and scene numbers → apply shoot dates to scenes. */
export const scheduleRouter = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
fs.mkdirSync(config.uploadDir, { recursive: true });

const docSelect = { id: true, kind: true, fileName: true, url: true, date: true, dayNumber: true, scenes: true, appliedAt: true, uploadedBy: true, createdAt: true };
/** yyyy-mm-dd → midnight on the server's calendar, the same way the scene editor stores shoot dates. */
const localDate = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, m - 1, d); };

scheduleRouter.get(
  "/documents",
  wrap(async (req, res) => {
    res.json(await prisma.productionDocument.findMany({ where: { projectId: req.projectId }, orderBy: { createdAt: "desc" }, select: docSelect }));
  }),
);

/** Read a schedule or call sheet. The file is kept (linked from the Scenes page); nothing else changes until POST /apply. */
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

    const ext = path.extname(req.file.originalname || "").toLowerCase() || (format === "pdf" ? ".pdf" : ".txt");
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    fs.writeFileSync(path.join(config.uploadDir, filename), req.file.buffer);
    const doc = await prisma.productionDocument.create({
      data: { projectId: req.projectId!, kind, fileName: req.file.originalname || filename, url: `/uploads/${filename}`, date: parsed.date ? localDate(parsed.date) : null, dayNumber: parsed.dayNumber, uploadedBy: req.user!.name },
      select: docSelect,
    });

    const scenes = await prisma.scene.findMany({ where: { projectId: req.projectId }, select: { id: true, number: true, shootDate: true, status: true } });
    const byNumber = new Map(scenes.map((s) => [normalizeNumber(s.number), s]));
    const days = parsed.days.map((d) => ({
      ...d,
      scenes: d.scenes.map((n) => { const s = byNumber.get(normalizeNumber(n)); return { number: n, id: s?.id ?? null, exists: !!s, currentShootDate: s?.shootDate ?? null, status: s?.status ?? null }; }),
    }));
    const all = days.flatMap((d) => d.scenes);
    const matched = all.filter((s) => s.exists).length;
    const unmatched = Array.from(new Set(all.filter((s) => !s.exists).map((s) => s.number)));
    await audit(req.user, req.projectId!, "SCHEDULE_PARSE", "DOCUMENT", doc.id, { kind, file: doc.fileName, format, days: days.length, matched, unmatched: unmatched.length });
    res.json({ document: doc, kind, file: doc.fileName, format, date: parsed.date, dayNumber: parsed.dayNumber, days, matched, unmatched, warnings: parsed.warnings, stats: parsed.stats, breakdownEmpty: scenes.length === 0 });
  }),
);

const applySchema = z.object({
  documentId: z.string().optional(),
  assignments: z.array(z.object({ sceneId: z.string(), date: zDate })).max(5000),
});

/** Give scenes their shoot date (PLANNED scenes become SCHEDULED); the document records when it was applied. */
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
    if (body.documentId) await prisma.productionDocument.updateMany({ where: { id: body.documentId, projectId: req.projectId }, data: { appliedAt: new Date(), scenes: updated } });
    await audit(req.user, req.projectId!, "SCHEDULE_APPLY", "DOCUMENT", body.documentId || "none", { updated, missing });
    res.json({ updated, missing });
  }),
);

scheduleRouter.delete(
  "/documents/:docId",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const doc = await prisma.productionDocument.findFirst({ where: { id: req.params.docId, projectId: req.projectId } });
    if (!doc) throw notFound("Document");
    await prisma.productionDocument.delete({ where: { id: doc.id } });
    try { fs.unlinkSync(path.join(config.uploadDir, path.basename(doc.url))); } catch { /* the file is already gone */ }
    await audit(req.user, req.projectId!, "DOCUMENT_DELETE", "DOCUMENT", doc.id, { kind: doc.kind, file: doc.fileName });
    res.json({ ok: true });
  }),
);
