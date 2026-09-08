import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound } from "../lib/errors";
import { parse, parseJson, zOptionalString } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { CONTINUITY_ROLES } from "../lib/constants";
import { audit } from "../services/audit";

/** Digital continuity book. */
export const continuityRouter = Router({ mergeParams: true });

const schema = z.object({
  sceneId: z.string(),
  characterId: z.string(),
  changeId: z.string().optional().nullable(),
  takeNumber: z.number().int().min(1),
  notes: zOptionalString,
  details: z.record(z.string()).optional().nullable(),
  accessories: z.array(z.object({ name: z.string(), present: z.boolean() })).optional().nullable(),
});

const include = {
  scene: { select: { id: true, number: true, name: true, shootDate: true } },
  character: { select: { id: true, name: true, actor: { select: { name: true } } } },
  change: { select: { id: true, changeNumber: true, name: true } },
};

const shape = <T extends { details: string | null; accessories: string | null }>(r: T) => ({
  ...r,
  details: parseJson<Record<string, string>>(r.details, {}),
  accessories: parseJson<{ name: string; present: boolean }[]>(r.accessories, []),
});

continuityRouter.get(
  "/",
  wrap(async (req, res) => {
    const where: Record<string, unknown> = { projectId: req.projectId };
    if (req.query.sceneId) where.sceneId = String(req.query.sceneId);
    if (req.query.characterId) where.characterId = String(req.query.characterId);
    const records = await prisma.continuityRecord.findMany({ where, include, orderBy: [{ scene: { sortOrder: "asc" } }, { characterId: "asc" }, { takeNumber: "asc" }] });
    const photos = await prisma.photo.findMany({ where: { entityType: "CONTINUITY", entityId: { in: records.map((r) => r.id) } } });
    res.json(records.map((r) => ({ ...shape(r), photos: photos.filter((p) => p.entityId === r.id) })));
  }),
);

/** Create or update (upsert on scene/character/take). Missing details are prefilled from the previous take. */
continuityRouter.post(
  "/",
  requireRole(CONTINUITY_ROLES),
  wrap(async (req, res) => {
    const data = parse(schema, req.body);
    const scene = await prisma.scene.findFirst({ where: { id: data.sceneId, projectId: req.projectId } });
    if (!scene) throw notFound("Scene");
    const previous = await prisma.continuityRecord.findFirst({ where: { sceneId: scene.id, characterId: data.characterId, takeNumber: { lt: data.takeNumber } }, orderBy: { takeNumber: "desc" } });
    const sc = await prisma.sceneCharacter.findUnique({ where: { sceneId_characterId: { sceneId: scene.id, characterId: data.characterId } } });
    const details = data.details ?? (previous ? parseJson(previous.details, {}) : {});
    const accessories = data.accessories ?? (previous ? parseJson(previous.accessories, []) : []);
    const record = await prisma.continuityRecord.upsert({
      where: { sceneId_characterId_takeNumber: { sceneId: scene.id, characterId: data.characterId, takeNumber: data.takeNumber } },
      create: {
        projectId: req.projectId!,
        sceneId: scene.id,
        characterId: data.characterId,
        changeId: data.changeId ?? sc?.changeId ?? previous?.changeId ?? null,
        takeNumber: data.takeNumber,
        notes: data.notes || null,
        details: JSON.stringify(details),
        accessories: JSON.stringify(accessories),
        recordedById: req.user!.id,
        recordedByName: req.user!.name,
      },
      update: {
        changeId: data.changeId === undefined ? undefined : data.changeId,
        notes: data.notes === undefined ? undefined : data.notes || null,
        details: data.details === undefined ? undefined : JSON.stringify(data.details || {}),
        accessories: data.accessories === undefined ? undefined : JSON.stringify(data.accessories || []),
      },
      include,
    });
    await audit(req.user, req.projectId!, "CONTINUITY_RECORD", "CONTINUITY", record.id, { scene: scene.number, take: data.takeNumber });
    res.status(201).json(shape(record));
  }),
);

/** Compare consecutive takes for a scene/character and flag differences. */
continuityRouter.get(
  "/compare",
  wrap(async (req, res) => {
    const sceneId = String(req.query.sceneId || "");
    const characterId = String(req.query.characterId || "");
    const records = await prisma.continuityRecord.findMany({ where: { projectId: req.projectId, sceneId, characterId }, orderBy: { takeNumber: "asc" } });
    const shaped = records.map(shape);
    const flags: { take: number; message: string }[] = [];
    for (let i = 1; i < shaped.length; i++) {
      const prev = shaped[i - 1];
      const cur = shaped[i];
      const keys = new Set([...Object.keys(prev.details), ...Object.keys(cur.details)]);
      for (const k of keys) {
        if ((prev.details[k] || "") !== (cur.details[k] || "")) flags.push({ take: cur.takeNumber, message: `${k}: "${prev.details[k] || "—"}" → "${cur.details[k] || "—"}"` });
      }
      const prevAcc = new Map(prev.accessories.map((a) => [a.name, a.present]));
      for (const a of cur.accessories) {
        if (prevAcc.has(a.name) && prevAcc.get(a.name) !== a.present) flags.push({ take: cur.takeNumber, message: `${a.name} ${a.present ? "appeared" : "missing"} in Take ${cur.takeNumber}` });
      }
      for (const [name] of prevAcc) if (!cur.accessories.find((a) => a.name === name)) flags.push({ take: cur.takeNumber, message: `${name} not recorded in Take ${cur.takeNumber}` });
      if (prev.changeId !== cur.changeId) flags.push({ take: cur.takeNumber, message: "Change (look) differs from previous take" });
    }
    res.json({ records: shaped, flags });
  }),
);

continuityRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const record = await prisma.continuityRecord.findFirst({ where: { id: req.params.id, projectId: req.projectId }, include });
    if (!record) throw notFound("Continuity record");
    const photos = await prisma.photo.findMany({ where: { entityType: "CONTINUITY", entityId: record.id }, orderBy: { createdAt: "asc" } });
    res.json({ ...shape(record), photos });
  }),
);

continuityRouter.delete(
  "/:id",
  requireRole(CONTINUITY_ROLES),
  wrap(async (req, res) => {
    const record = await prisma.continuityRecord.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!record) throw notFound("Continuity record");
    await prisma.continuityRecord.delete({ where: { id: record.id } });
    res.json({ ok: true });
  }),
);
