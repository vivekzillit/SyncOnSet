import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound, badRequest } from "../lib/errors";
import { parse } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { CONTINUITY_ROLES, PHOTO_ENTITY_TYPES, PHOTO_KINDS } from "../lib/constants";
import { audit } from "../services/audit";
import { config } from "../config";

export const photosRouter = Router({ mergeParams: true });

fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
export const IMAGE_RE = /^image\/(jpeg|png|webp|heic|heif|gif|avif)$/i;
/** Anything that a browser could execute in this origin is refused: an upload is served from the app's own domain. */
const BLOCKED_RE = /\.(html?|xhtml|svg|js|mjs|jsx|php|phtml|asp|aspx|jsp|sh|bash|command|exe|bat|cmd|msi|scr|jar|app|dmg|pkg|deb|rpm|py|rb|pl|vbs|ps1|hta|wsf|cgi)$/i;
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname || "";
    if (BLOCKED_RE.test(name)) return cb(badRequest(`${path.extname(name)} files cannot be attached. Export it as PDF, or share it as a link.`));
    if (/^(?:text\/html|image\/svg|application\/(?:x-)?(?:javascript|x-msdownload|x-sh))/i.test(file.mimetype)) return cb(badRequest("That file type cannot be attached. Export it as PDF, or share it as a link."));
    cb(null, true);
  },
});

photosRouter.get(
  "/",
  wrap(async (req, res) => {
    const where: Record<string, unknown> = { projectId: req.projectId };
    if (req.query.entityType) where.entityType = String(req.query.entityType);
    if (req.query.entityId) where.entityId = String(req.query.entityId);
    res.json(await prisma.photo.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 }));
  }),
);

/** Gallery: every photo in the production with a label for what it shows. ?entityType=&characterId=&sceneId=&q= */
photosRouter.get(
  "/gallery",
  wrap(async (req, res) => {
    const where: Record<string, unknown> = { projectId: req.projectId };
    if (req.query.entityType) where.entityType = String(req.query.entityType);
    // The gallery is for pictures; files and links live on the record they belong to.
    const photos = await prisma.photo.findMany({ where: { ...where, mediaType: "IMAGE" }, orderBy: { createdAt: "desc" }, take: 2000 });
    const ids = (t: string) => photos.filter((ph) => ph.entityType === t).map((ph) => ph.entityId);
    const [costumes, characters, changes, fittings, continuity, cleaning, damages, actors] = await Promise.all([
      prisma.costume.findMany({ where: { id: { in: ids("COSTUME") } }, select: { id: true, assetNumber: true, name: true, characterId: true, character: { select: { name: true } } } }),
      prisma.character.findMany({ where: { id: { in: ids("CHARACTER") } }, select: { id: true, name: true } }),
      prisma.costumeChange.findMany({ where: { id: { in: ids("CHANGE") } }, select: { id: true, changeNumber: true, name: true, characterId: true, character: { select: { name: true } } } }),
      prisma.fitting.findMany({ where: { id: { in: ids("FITTING") } }, select: { id: true, scheduledAt: true, characterId: true, character: { select: { name: true } } } }),
      prisma.continuityRecord.findMany({ where: { id: { in: ids("CONTINUITY") } }, select: { id: true, takeNumber: true, sceneId: true, characterId: true, scene: { select: { number: true } }, character: { select: { name: true } } } }),
      prisma.cleaningRequest.findMany({ where: { id: { in: ids("CLEANING") } }, select: { id: true, sceneId: true, costume: { select: { assetNumber: true, name: true, characterId: true } } } }),
      prisma.damageReport.findMany({ where: { id: { in: ids("DAMAGE") } }, select: { id: true, sceneId: true, costume: { select: { assetNumber: true, name: true, characterId: true } } } }),
      prisma.actor.findMany({ where: { id: { in: ids("ACTOR") } }, select: { id: true, name: true } }),
    ]);
    const label = new Map<string, { label: string; characterId?: string | null; sceneId?: string | null; link: string }>();
    costumes.forEach((c) => label.set(`COSTUME:${c.id}`, { label: `${c.assetNumber} ${c.name}${c.character ? ` · ${c.character.name}` : ""}`, characterId: c.characterId, link: `costumes/${c.id}` }));
    characters.forEach((c) => label.set(`CHARACTER:${c.id}`, { label: c.name, characterId: c.id, link: `characters/${c.id}` }));
    changes.forEach((c) => label.set(`CHANGE:${c.id}`, { label: `${c.character?.name || ""} · Change #${c.changeNumber} ${c.name}`, characterId: c.characterId, link: `changes/${c.id}` }));
    fittings.forEach((f) => label.set(`FITTING:${f.id}`, { label: `Fitting · ${f.character?.name || ""} · ${f.scheduledAt.toDateString()}`, characterId: f.characterId, link: `fittings/${f.id}` }));
    continuity.forEach((r) => label.set(`CONTINUITY:${r.id}`, { label: `Sc ${r.scene?.number} Take ${r.takeNumber} · ${r.character?.name || ""}`, characterId: r.characterId, sceneId: r.sceneId, link: `continuity?sceneId=${r.sceneId}&characterId=${r.characterId}` }));
    cleaning.forEach((c) => label.set(`CLEANING:${c.id}`, { label: `Cleaning · ${c.costume.assetNumber} ${c.costume.name}`, characterId: c.costume.characterId, sceneId: c.sceneId, link: `cleaning/${c.id}` }));
    damages.forEach((d) => label.set(`DAMAGE:${d.id}`, { label: `Damage · ${d.costume.assetNumber} ${d.costume.name}`, characterId: d.costume.characterId, sceneId: d.sceneId, link: `damages` }));
    actors.forEach((a) => label.set(`ACTOR:${a.id}`, { label: a.name, link: `actors` }));
    const q = String(req.query.q || "").trim().toLowerCase();
    const characterId = req.query.characterId ? String(req.query.characterId) : null;
    const sceneId = req.query.sceneId ? String(req.query.sceneId) : null;
    const items = photos
      .map((ph) => ({ ...ph, ...(label.get(`${ph.entityType}:${ph.entityId}`) || { label: ph.entityType, link: "" }) }))
      .filter((ph) => (!characterId || ph.characterId === characterId) && (!sceneId || ph.sceneId === sceneId) && (!q || `${ph.label} ${ph.caption || ""} ${ph.kind}`.toLowerCase().includes(q)));
    res.json({ items, total: items.length });
  }),
);

/** multipart/form-data: file (a photo or any other document), entityType, entityId, kind?, caption? */
photosRouter.post(
  "/",
  requireRole(CONTINUITY_ROLES),
  upload.single("file"),
  wrap(async (req, res) => {
    if (!req.file) throw badRequest("file is required");
    const meta = parse(z.object({ entityType: z.enum(PHOTO_ENTITY_TYPES), entityId: z.string(), kind: z.enum(PHOTO_KINDS).optional(), caption: z.string().optional() }), req.body);
    const isImage = IMAGE_RE.test(req.file.mimetype);
    const photo = await prisma.photo.create({
      data: {
        projectId: req.projectId!, entityType: meta.entityType, entityId: meta.entityId,
        kind: meta.kind || (isImage ? "OTHER" : "DOCUMENT"),
        mediaType: isImage ? "IMAGE" : "FILE",
        title: req.file.originalname || null,
        mimeType: req.file.mimetype || null,
        size: req.file.size,
        caption: meta.caption || null,
        url: `/uploads/${req.file.filename}`,
      },
    });
    res.status(201).json(photo);
  }),
);

/** Attach a link (a shared drive, a mood board, a supplier page) rather than a file. */
photosRouter.post(
  "/link",
  requireRole(CONTINUITY_ROLES),
  wrap(async (req, res) => {
    const body = parse(z.object({
      entityType: z.enum(PHOTO_ENTITY_TYPES),
      entityId: z.string(),
      url: z.string().trim().min(3).max(2000),
      title: z.string().trim().max(200).optional(),
      kind: z.enum(PHOTO_KINDS).optional(),
      caption: z.string().trim().max(500).optional(),
    }), req.body);
    const url = /^https?:\/\//i.test(body.url) ? body.url : `https://${body.url}`;
    let host: string;
    try { host = new URL(url).hostname; } catch { throw badRequest("That does not look like a web address"); }
    const photo = await prisma.photo.create({
      data: { projectId: req.projectId!, entityType: body.entityType, entityId: body.entityId, kind: body.kind || "REFERENCE", mediaType: "LINK", url, title: body.title || host, caption: body.caption || null },
    });
    await audit(req.user, req.projectId!, "REFERENCE_LINK", body.entityType, body.entityId, { url });
    res.status(201).json(photo);
  }),
);

photosRouter.delete(
  "/:id",
  requireRole(CONTINUITY_ROLES),
  wrap(async (req, res) => {
    const photo = await prisma.photo.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!photo) throw notFound("Reference");
    await prisma.photo.delete({ where: { id: photo.id } });
    // A link has no file of its own to remove.
    if (photo.mediaType !== "LINK") fs.promises.unlink(path.join(config.uploadDir, path.basename(photo.url))).catch(() => undefined);
    res.json({ ok: true });
  }),
);
