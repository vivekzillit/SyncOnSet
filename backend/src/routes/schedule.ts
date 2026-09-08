import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, badRequest } from "../lib/errors";
import { parse, zDate, zOptionalString } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { INT_EXT, MANAGER_ROLES, TIMES_OF_DAY } from "../lib/constants";
import { audit } from "../services/audit";
import { extractDocumentText, normalizeNumber, parseScheduleText, type DocKind } from "../services/scheduleParser";

/** Shooting schedules and call sheets: upload → preview of what the file says about each scene → apply. Same shape as the script upload. */
export const scheduleRouter = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/** Scene numbers sort by their number then their letter suffix, as in the script upload. */
function sceneSort(n: string) {
  const m = n.match(/^(\d+)([A-Za-z]*)$/);
  return m ? Number(m[1]) * 100 + (m[2] ? m[2].toUpperCase().charCodeAt(0) - 64 : 0) : 999999;
}
const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * Read a schedule or call sheet (PDF, CSV or text) and return, for every scene it names, the shoot date
 * and everything else the file says about it. Nothing is written; the client confirms with POST /apply.
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

    const stored = await prisma.scene.findMany({
      where: { projectId: req.projectId },
      select: { id: true, number: true, name: true, location: true, intExt: true, timeOfDay: true, pages: true, scriptDay: true, shootDate: true, status: true, sortOrder: true },
    });
    const byNumber = new Map(stored.map((s) => [normalizeNumber(s.number), s]));
    const characters = await prisma.character.findMany({ where: { projectId: req.projectId, castNumber: { not: null } }, select: { id: true, name: true, castNumber: true } });
    const byCast = new Map(characters.map((c) => [c.castNumber!, c]));

    // One row per scene named in the document, in scene order, exactly like the script upload's preview.
    const seen = new Set<string>();
    const scenes = parsed.days.flatMap((day) =>
      day.scenes.filter((ref) => !seen.has(normalizeNumber(ref.number)) && seen.add(normalizeNumber(ref.number)) !== undefined).map((ref) => {
        const sc = byNumber.get(normalizeNumber(ref.number));
        const read = { intExt: ref.intExt, location: ref.location, timeOfDay: ref.timeOfDay, name: ref.name, pages: ref.pages, scriptDay: ref.scriptDay, description: ref.description };
        // Which of those the scene is missing today: those are what "fill in blanks" would write.
        const fills = sc ? (Object.keys(read) as (keyof typeof read)[]).filter((k) => !blank(read[k]) && k !== "description" && blank((sc as Record<string, unknown>)[k])) : (Object.keys(read) as (keyof typeof read)[]).filter((k) => !blank(read[k]));
        return {
          number: ref.number,
          id: sc?.id ?? null,
          exists: !!sc,
          status: sc?.status ?? null,
          currentShootDate: sc?.shootDate ?? null,
          current: sc ? { name: sc.name, location: sc.location, intExt: sc.intExt, timeOfDay: sc.timeOfDay, pages: sc.pages, scriptDay: sc.scriptDay } : null,
          read,
          fills,
          cast: ref.cast.map((n) => ({ castNumber: n, id: byCast.get(n)?.id ?? null, name: byCast.get(n)?.name ?? null })),
          date: day.date,
          dayNumber: day.dayNumber,
          sortOrder: sc?.sortOrder ?? sceneSort(ref.number),
        };
      }),
    ).sort((a, b) => a.sortOrder - b.sortOrder);
    await audit(req.user, req.projectId!, "SCHEDULE_PARSE", "SCENE", "preview", { kind, file: req.file.originalname, format, days: parsed.days.length, scenes: scenes.length, matched: scenes.filter((s) => s.exists).length });
    res.json({
      kind, file: req.file.originalname, format,
      date: parsed.date, dayNumber: parsed.dayNumber,
      days: parsed.days.length,
      scenes,
      warnings: parsed.warnings,
      breakdownEmpty: stored.length === 0,
      knownCastNumbers: characters.length,
    });
  }),
);

const fieldsSchema = z.object({
  name: zOptionalString,
  location: zOptionalString,
  intExt: z.enum(INT_EXT).optional().nullable(),
  timeOfDay: z.enum(TIMES_OF_DAY).optional().nullable(),
  pages: zOptionalString,
  scriptDay: zOptionalString,
});
const applySchema = z.object({
  assignments: z.array(z.object({
    sceneId: z.string().optional().nullable(),
    number: z.string().min(1),
    date: zDate,
    create: z.boolean().optional(),
    fields: fieldsSchema.optional(),
    cast: z.array(z.number().int().min(0)).max(200).optional(),
  })).max(2000),
  overwrite: z.boolean().optional(), // false (default): only fill in what is blank
});

/**
 * Write the confirmed rows: shoot dates (PLANNED becomes SCHEDULED), blank scene details filled from the file,
 * scenes the breakdown does not have yet created, and cast numbers linked to characters. Nothing is ever deleted.
 */
scheduleRouter.post(
  "/apply",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const body = parse(applySchema, req.body);
    const projectId = req.projectId!;
    const own = await prisma.scene.findMany({ where: { projectId }, select: { id: true, number: true, name: true, location: true, intExt: true, timeOfDay: true, pages: true, scriptDay: true, status: true } });
    const byId = new Map(own.map((s) => [s.id, s]));
    const byNumber = new Map(own.map((s) => [normalizeNumber(s.number), s]));
    const characters = await prisma.character.findMany({ where: { projectId, castNumber: { not: null } }, select: { id: true, castNumber: true } });
    const byCast = new Map(characters.map((c) => [c.castNumber!, c.id]));

    let updated = 0, created = 0, filled = 0, linked = 0, missing = 0;
    for (const a of body.assignments) {
      const existing = (a.sceneId ? byId.get(a.sceneId) : undefined) ?? byNumber.get(normalizeNumber(a.number));
      const f = a.fields || {};
      const wanted: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(f)) {
        if (blank(v)) continue;
        if (!existing) { wanted[k] = v; continue; }
        if (body.overwrite || blank((existing as Record<string, unknown>)[k])) wanted[k] = v;
      }
      let sceneId: string;
      if (existing) {
        const data: Record<string, unknown> = { ...wanted };
        if (a.date !== undefined) { data.shootDate = a.date; if (a.date && existing.status === "PLANNED") data.status = "SCHEDULED"; }
        if (!Object.keys(data).length) { continue; }
        const sc = await prisma.scene.update({ where: { id: existing.id }, data });
        sceneId = sc.id;
        updated += 1;
        filled += Object.keys(wanted).length;
      } else if (a.create) {
        const sc = await prisma.scene.create({
          data: { projectId, number: a.number, sortOrder: sceneSort(a.number), shootDate: a.date ?? null, status: a.date ? "SCHEDULED" : "PLANNED", ...wanted },
        });
        byNumber.set(normalizeNumber(sc.number), { ...sc, status: sc.status });
        sceneId = sc.id;
        created += 1;
      } else { missing += 1; continue; }

      for (const castNumber of a.cast || []) {
        const characterId = byCast.get(castNumber);
        if (!characterId) continue;
        const link = await prisma.sceneCharacter.findUnique({ where: { sceneId_characterId: { sceneId, characterId } } });
        if (link) continue;
        await prisma.sceneCharacter.create({ data: { sceneId, characterId } });
        linked += 1;
      }
    }
    await audit(req.user, projectId, "SCHEDULE_APPLY", "SCENE", "bulk", { updated, created, filled, linked, missing, overwrite: !!body.overwrite });
    res.json({ updated, created, filled, linked, missing });
  }),
);
