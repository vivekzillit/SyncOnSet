import { Router } from "express";
import multer from "multer";
import pdfParse from "pdf-parse";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound, badRequest } from "../lib/errors";
import { parse, zDate, zOptionalString } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { INT_EXT, MANAGER_ROLES, SCENE_STATUSES, TIMES_OF_DAY } from "../lib/constants";
import { audit } from "../services/audit";
import { sceneReadiness } from "../services/readiness";
import { detectFormat, parseScript } from "../services/scriptParser";

export const scenesRouter = Router({ mergeParams: true });

const schema = z.object({
  number: z.string().min(1),
  sortOrder: z.number().int().optional(),
  name: zOptionalString,
  location: zOptionalString,
  intExt: z.enum(INT_EXT).optional().nullable(),
  timeOfDay: z.enum(TIMES_OF_DAY).optional().nullable(),
  scriptDay: zOptionalString,
  synopsis: zOptionalString,
  pages: zOptionalString,
  shootDate: zDate,
  status: z.enum(SCENE_STATUSES).optional(),
});

function sceneSort(n: string) {
  const m = n.match(/^(\d+)([A-Za-z]*)$/);
  return m ? Number(m[1]) * 100 + (m[2] ? m[2].toUpperCase().charCodeAt(0) - 64 : 0) : 999999;
}

scenesRouter.get(
  "/",
  wrap(async (req, res) => {
    const where: Record<string, unknown> = { projectId: req.projectId };
    if (req.query.date) {
      const d = new Date(String(req.query.date));
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      where.shootDate = { gte: start, lt: new Date(start.getTime() + 86400000) };
    }
    if (req.query.status) where.status = String(req.query.status);
    const scenes = await prisma.scene.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }],
      include: { characters: { include: { character: { select: { id: true, name: true } }, change: { select: { id: true, changeNumber: true, name: true, items: { select: { costume: { select: { status: true } } } } } } } } },
    });
    const withReadiness = scenes.map((s) => {
      const statuses = s.characters.flatMap((sc) => sc.change?.items.map((i) => i.costume.status) || []);
      const unassigned = s.characters.some((sc) => !sc.change);
      let level = "READY";
      if (statuses.includes("MISSING")) level = "MISSING";
      else if (statuses.includes("DAMAGED")) level = "DAMAGED";
      else if (statuses.includes("ALTERATION")) level = "ALTERATION";
      else if (statuses.includes("CLEANING")) level = "CLEANING";
      else if (unassigned || s.characters.length === 0) level = "NOT_ASSIGNED";
      return { ...s, readiness: level };
    });
    res.json(withReadiness);
  }),
);

scenesRouter.post(
  "/",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const data = parse(schema, req.body);
    const scene = await prisma.scene.create({ data: { ...data, projectId: req.projectId!, sortOrder: data.sortOrder ?? sceneSort(data.number) } });
    await audit(req.user, req.projectId!, "SCENE_CREATE", "SCENE", scene.id);
    res.status(201).json(scene);
  }),
);

/** Bulk import scenes (script breakdown). Body: { scenes: [{number, name, location, intExt, timeOfDay, scriptDay, synopsis, characters: ["Raj","Priya"]}] } */
scenesRouter.post(
  "/import",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const body = parse(z.object({ scenes: z.array(schema.extend({ characters: z.array(z.string()).optional() })).min(1) }), req.body);
    const projectId = req.projectId!;
    let created = 0;
    let charactersCreated = 0;
    const known = new Map((await prisma.character.findMany({ where: { projectId }, select: { id: true, name: true } })).map((c) => [c.name.trim().toLowerCase(), c]));
    for (const s of body.scenes) {
      const { characters = [], ...sceneData } = s;
      const scene = await prisma.scene.upsert({
        where: { projectId_number: { projectId, number: sceneData.number } },
        create: { ...sceneData, projectId, sortOrder: sceneData.sortOrder ?? sceneSort(sceneData.number) },
        update: { ...sceneData },
      });
      created += 1;
      for (const rawName of characters) {
        const name = rawName.trim();
        if (!name) continue;
        let ch = known.get(name.toLowerCase());
        if (!ch) {
          ch = await prisma.character.create({ data: { projectId, name, type: "SUPPORTING" } });
          known.set(name.toLowerCase(), ch);
          charactersCreated += 1;
        }
        await prisma.sceneCharacter.upsert({ where: { sceneId_characterId: { sceneId: scene.id, characterId: ch.id } }, create: { sceneId: scene.id, characterId: ch.id }, update: {} });
      }
    }
    await audit(req.user, projectId, "SCENE_IMPORT", "SCENE", "bulk", { scenes: created, charactersCreated });
    res.status(201).json({ scenes: created, charactersCreated });
  }),
);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/**
 * Upload a screenplay (.fdx, .fountain, .txt, .pdf) and get a breakdown preview: scenes with slugline data,
 * speaking characters and a synopsis. Nothing is written; confirm with POST /import.
 */
scenesRouter.post(
  "/parse-script",
  requireRole(MANAGER_ROLES),
  upload.single("file"),
  wrap(async (req, res) => {
    if (!req.file) throw badRequest("file is required (.fdx, .fountain, .txt or .pdf)");
    const head = req.file.buffer.subarray(0, 512).toString("utf8");
    const format = detectFormat(req.file.originalname || "", req.file.mimetype || "", head);
    let content: string;
    if (format === "pdf") {
      const pdf = await pdfParse(req.file.buffer);
      content = pdf.text || "";
      if (!content.trim()) throw badRequest("No text could be extracted from this PDF. If it is a scanned script, run OCR first or export the screenplay as PDF from your writing software.");
    } else {
      content = req.file.buffer.toString("utf8");
    }
    const result = parseScript(format, content);
    const existing = await prisma.character.findMany({ where: { projectId: req.projectId }, select: { name: true } });
    const existingNames = new Set(existing.map((c) => c.name.trim().toLowerCase()));
    const existingScenes = new Set((await prisma.scene.findMany({ where: { projectId: req.projectId }, select: { number: true } })).map((sc) => sc.number));
    await audit(req.user, req.projectId!, "SCRIPT_PARSE", "SCENE", "preview", { file: req.file.originalname, format, scenes: result.scenes.length });
    res.json({
      ...result,
      file: req.file.originalname,
      characters: result.characters.map((c) => ({ ...c, exists: existingNames.has(c.name.toLowerCase()) })),
      scenes: result.scenes.map((sc) => ({ ...sc, exists: existingScenes.has(sc.number) })),
    });
  }),
);

scenesRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const scene = await prisma.scene.findFirst({
      where: { id: req.params.id, projectId: req.projectId },
      include: {
        characters: { include: { character: { include: { actor: { select: { id: true, name: true } }, changes: { orderBy: { changeNumber: "asc" }, select: { id: true, changeNumber: true, name: true } } } }, change: { include: { items: { include: { costume: true } } } } } },
        continuity: { orderBy: [{ takeNumber: "asc" }], include: { character: { select: { id: true, name: true } } } },
        cleaning: { where: { status: { notIn: ["READY", "CANCELLED"] } }, include: { costume: { select: { assetNumber: true, name: true } } } },
      },
    });
    if (!scene) throw notFound("Scene");
    res.json(scene);
  }),
);

scenesRouter.get(
  "/:id/readiness",
  wrap(async (req, res) => {
    const r = await sceneReadiness(req.params.id);
    if (!r) throw notFound("Scene");
    res.json(r);
  }),
);

scenesRouter.patch(
  "/:id",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const data = parse(schema.partial(), req.body);
    const existing = await prisma.scene.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Scene");
    const scene = await prisma.scene.update({ where: { id: existing.id }, data });
    await audit(req.user, req.projectId!, "SCENE_UPDATE", "SCENE", scene.id, data as Record<string, unknown>);
    res.json(scene);
  }),
);

scenesRouter.delete(
  "/:id",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const existing = await prisma.scene.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Scene");
    await prisma.scene.delete({ where: { id: existing.id } });
    await audit(req.user, req.projectId!, "SCENE_DELETE", "SCENE", existing.id);
    res.json({ ok: true });
  }),
);

/** Add / update a character requirement for a scene (which change they wear). */
scenesRouter.put(
  "/:id/characters/:characterId",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const { changeId, notes } = parse(z.object({ changeId: z.string().optional().nullable(), notes: zOptionalString }), req.body);
    const scene = await prisma.scene.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!scene) throw notFound("Scene");
    const character = await prisma.character.findFirst({ where: { id: req.params.characterId, projectId: req.projectId } });
    if (!character) throw notFound("Character");
    if (changeId) {
      const change = await prisma.costumeChange.findFirst({ where: { id: changeId, characterId: character.id } });
      if (!change) throw badRequest("Change does not belong to this character");
    }
    const sc = await prisma.sceneCharacter.upsert({
      where: { sceneId_characterId: { sceneId: scene.id, characterId: character.id } },
      create: { sceneId: scene.id, characterId: character.id, changeId: changeId || null, notes: notes || null },
      update: { changeId: changeId === undefined ? undefined : changeId || null, notes: notes === undefined ? undefined : notes || null },
      include: { character: true, change: true },
    });
    await audit(req.user, req.projectId!, "SCENE_CHARACTER_SET", "SCENE", scene.id, { characterId: character.id, changeId });
    res.json(sc);
  }),
);

scenesRouter.delete(
  "/:id/characters/:characterId",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const scene = await prisma.scene.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!scene) throw notFound("Scene");
    await prisma.sceneCharacter.delete({ where: { sceneId_characterId: { sceneId: scene.id, characterId: req.params.characterId } } });
    res.json({ ok: true });
  }),
);
