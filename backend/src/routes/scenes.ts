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
import { aiEnabled, extractAndStoreCues } from "../services/costumeCues";

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
  scriptText: z.string().max(60000).optional().nullable(),
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
      include: { characters: { include: { character: { select: { id: true, name: true, castNumber: true } }, change: { select: { id: true, changeNumber: true, name: true, items: { select: { costume: { select: { status: true } } } } } } } } },
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
      const { scriptText, ...rest } = s;
      return { ...rest, hasScript: !!scriptText, readiness: level };
    });
    res.json(withReadiness);
  }),
);

scenesRouter.post(
  "/",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    // `revision` lets the inline Add row file a new scene under the draft currently being viewed.
    const { revision, ...data } = parse(schema.extend({ revision: z.string().trim().max(80).optional().nullable() }), req.body);
    const scene = await prisma.scene.create({ data: { ...data, projectId: req.projectId!, sortOrder: data.sortOrder ?? sceneSort(data.number), revision: revision || null, revisedAt: revision ? new Date() : null } });
    await audit(req.user, req.projectId!, "SCENE_CREATE", "SCENE", scene.id);
    res.status(201).json(scene);
  }),
);

/** Bulk import scenes (script breakdown). Body: { scenes: [{number, name, location, intExt, timeOfDay, scriptDay, synopsis, characters: ["Raj","Priya"]}] } */
scenesRouter.post(
  "/import",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const body = parse(
      z.object({
        scenes: z.array(schema.extend({ characters: z.array(z.string()).optional() })).min(1),
        revision: z.string().trim().max(80).optional().nullable(),
        /** detected name → target character name, or null to ignore (not a character) */
        characterMap: z.record(z.string().nullable()).optional(),
        /** character name → cast number for characters created by this import */
        castNumbers: z.record(z.number().int().min(0)).optional(),
      }),
      req.body,
    );
    const projectId = req.projectId!;
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let charactersCreated = 0;
    const norm = (t: string | null | undefined) => (t || "").replace(/\s+/g, " ").trim().toLowerCase();
    const known = new Map((await prisma.character.findMany({ where: { projectId }, select: { id: true, name: true, castNumber: true } })).map((c) => [c.name.trim().toLowerCase(), c]));
    const mapName = (raw: string) => {
      const key = raw.trim();
      if (body.characterMap && key in body.characterMap) return body.characterMap[key];
      const ci = body.characterMap ? Object.keys(body.characterMap).find((k) => k.toLowerCase() === key.toLowerCase()) : undefined;
      return ci !== undefined ? body.characterMap![ci] : key;
    };
    for (const s of body.scenes) {
      const { characters = [], ...sceneData } = s;
      const prev = await prisma.scene.findUnique({ where: { projectId_number: { projectId, number: sceneData.number } } });
      const textChanged = !prev || norm(prev.scriptText) !== norm(sceneData.scriptText);
      let scene;
      if (!prev) {
        scene = await prisma.scene.create({ data: { ...sceneData, projectId, sortOrder: sceneData.sortOrder ?? sceneSort(sceneData.number), revision: body.revision || null, revisedAt: body.revision ? new Date() : null } });
        created += 1;
      } else if (textChanged || !sceneData.scriptText) {
        // revised (or manual breakdown without text): update slugline data, never remove anything
        scene = await prisma.scene.update({ where: { id: prev.id }, data: { ...sceneData, revision: body.revision || prev.revision, revisedAt: body.revision ? new Date() : prev.revisedAt } });
        updated += 1;
      } else {
        scene = prev; // unchanged text: keep manual edits to name, dates, notes
        unchanged += 1;
      }
      for (const rawName of characters) {
        const mapped = mapName(rawName);
        if (!mapped) continue; // ignored (not a character)
        const name = mapped.trim();
        if (!name) continue;
        let ch = known.get(name.toLowerCase());
        if (!ch) {
          const castNumber = body.castNumbers?.[name] ?? body.castNumbers?.[rawName.trim()] ?? null;
          ch = await prisma.character.create({ data: { projectId, name, type: "SUPPORTING", castNumber } });
          known.set(name.toLowerCase(), ch);
          charactersCreated += 1;
        } else if (ch.castNumber == null && (body.castNumbers?.[name] ?? body.castNumbers?.[rawName.trim()]) != null) {
          const castNumber = body.castNumbers?.[name] ?? body.castNumbers?.[rawName.trim()] ?? null;
          await prisma.character.update({ where: { id: ch.id }, data: { castNumber } });
          ch = { ...ch, castNumber };
        }
        await prisma.sceneCharacter.upsert({ where: { sceneId_characterId: { sceneId: scene.id, characterId: ch.id } }, create: { sceneId: scene.id, characterId: ch.id }, update: {} });
      }
    }
    await audit(req.user, projectId, "SCENE_IMPORT", "SCENE", "bulk", { created, updated, unchanged, charactersCreated, revision: body.revision || null });
    res.status(201).json({ scenes: created + updated + unchanged, created, updated, unchanged, charactersCreated, revision: body.revision || null });
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
    const stored = new Map((await prisma.scene.findMany({ where: { projectId: req.projectId }, select: { number: true, scriptText: true, revision: true } })).map((sc) => [sc.number, sc]));
    const norm = (t: string | null | undefined) => (t || "").replace(/\s+/g, " ").trim().toLowerCase();
    await audit(req.user, req.projectId!, "SCRIPT_PARSE", "SCENE", "preview", { file: req.file.originalname, format, scenes: result.scenes.length });
    const existingList = await prisma.character.findMany({ where: { projectId: req.projectId }, select: { id: true, name: true, castNumber: true }, orderBy: { name: "asc" } });
    res.json({
      ...result,
      file: req.file.originalname,
      firstUpload: stored.size === 0,
      existingCharacters: existingList,
      characters: result.characters.map((c) => ({ ...c, exists: existingNames.has(c.name.toLowerCase()) })),
      scenes: result.scenes.map((sc) => {
        const prev = stored.get(sc.number);
        const change = !prev ? "new" : norm(prev.scriptText) === norm(sc.text) ? "unchanged" : "updated";
        return { ...sc, exists: !!prev, change, previousRevision: prev?.revision || null };
      }),
    });
  }),
);

/** Sides: scene text for a shoot day (?date=YYYY-MM-DD) or explicit scenes (?ids=a,b,c), for the printable sides view. */
scenesRouter.get(
  "/sides",
  wrap(async (req, res) => {
    const where: Record<string, unknown> = { projectId: req.projectId };
    if (req.query.ids) where.id = { in: String(req.query.ids).split(",").filter(Boolean) };
    else if (req.query.date) {
      const d = new Date(String(req.query.date));
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      where.shootDate = { gte: start, lt: new Date(start.getTime() + 86400000) };
    }
    const project = await prisma.project.findUnique({ where: { id: req.projectId }, select: { name: true, code: true, shootingDay: true } });
    const scenes = await prisma.scene.findMany({ where, orderBy: { sortOrder: "asc" }, include: { characters: { include: { character: { select: { id: true, name: true, castNumber: true } }, change: { select: { changeNumber: true, name: true } } } } } });
    res.json({
      project,
      generatedBy: req.user!.name,
      generatedAt: new Date(),
      scenes: scenes.map((sc) => ({ id: sc.id, number: sc.number, name: sc.name, location: sc.location, intExt: sc.intExt, timeOfDay: sc.timeOfDay, scriptDay: sc.scriptDay, pages: sc.pages, revision: sc.revision, status: sc.status, hasScript: !!sc.scriptText, text: sc.scriptText || "", characters: sc.characters.map((c) => ({ id: c.character.id, name: c.character.name, castNumber: c.character.castNumber, change: c.change ? `#${c.change.changeNumber} ${c.change.name}` : null })) })),
    });
  }),
);

/** AI: extract costume cues for up to 10 scenes per call (client chunks for progress). */
scenesRouter.post(
  "/extract-cues",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const { sceneIds, engine } = parse(z.object({ sceneIds: z.array(z.string()).min(1).max(10), engine: z.enum(["auto", "rules", "ai"]).optional() }), req.body);
    const result = await extractAndStoreCues(req.projectId!, sceneIds, { engine });
    await audit(req.user, req.projectId!, "AI_CUES_EXTRACT", "SCENE", "batch", { scenes: sceneIds.length, cues: result.cuesCreated, model: result.model, engine: result.engine });
    res.json(result);
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
        cues: { orderBy: [{ status: "asc" }, { characterName: "asc" }, { createdAt: "asc" }], include: { character: { select: { id: true, name: true } } } },
      },
    });
    if (!scene) throw notFound("Scene");
    res.json({ ...scene, hasScript: !!scene.scriptText, aiEnabled: aiEnabled() });
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

/** Clone a scene: same slugline data, number = original + "A" (next free letter), sortOrder + 1, status PLANNED, same characters. */
scenesRouter.post(
  "/:id/clone",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const projectId = req.projectId!;
    const original = await prisma.scene.findFirst({ where: { id: req.params.id, projectId }, include: { characters: true } });
    if (!original) throw notFound("Scene");
    const base = original.number.replace(/[A-Za-z]+$/, "") || original.number;
    const taken = new Set((await prisma.scene.findMany({ where: { projectId }, select: { number: true } })).map((s) => s.number.toUpperCase()));
    let number: string | null = null;
    for (let i = 0; i < 26; i += 1) {
      const candidate = `${base}${String.fromCharCode(65 + i)}`;
      if (!taken.has(candidate.toUpperCase())) {
        number = candidate;
        break;
      }
    }
    if (!number) throw badRequest(`No free scene number left for clones of scene ${original.number}`);
    const scene = await prisma.scene.create({
      data: {
        projectId,
        number,
        sortOrder: original.sortOrder + 1,
        name: original.name,
        location: original.location,
        intExt: original.intExt,
        timeOfDay: original.timeOfDay,
        scriptDay: original.scriptDay,
        synopsis: original.synopsis,
        pages: original.pages,
        scriptText: original.scriptText,
        revision: original.revision,
        status: "PLANNED",
        characters: { create: original.characters.map((sc) => ({ characterId: sc.characterId, changeId: sc.changeId, notes: sc.notes })) },
      },
      include: { characters: { include: { character: { select: { id: true, name: true, castNumber: true } }, change: { select: { id: true, changeNumber: true, name: true } } } } },
    });
    await audit(req.user, projectId, "SCENE_CLONE", "SCENE", scene.id, { from: original.id, fromNumber: original.number, number });
    res.status(201).json({ ...scene, hasScript: !!scene.scriptText });
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
