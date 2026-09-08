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
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|heic|heif|gif)$/i.test(file.mimetype)) return cb(badRequest("Only image uploads are allowed"));
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

/** multipart/form-data: file, entityType, entityId, kind?, caption? */
photosRouter.post(
  "/",
  requireRole(CONTINUITY_ROLES),
  upload.single("file"),
  wrap(async (req, res) => {
    if (!req.file) throw badRequest("file is required");
    const meta = parse(z.object({ entityType: z.enum(PHOTO_ENTITY_TYPES), entityId: z.string(), kind: z.enum(PHOTO_KINDS).optional(), caption: z.string().optional() }), req.body);
    const photo = await prisma.photo.create({
      data: { projectId: req.projectId!, entityType: meta.entityType, entityId: meta.entityId, kind: meta.kind || "OTHER", caption: meta.caption || null, url: `/uploads/${req.file.filename}` },
    });
    res.status(201).json(photo);
  }),
);

photosRouter.delete(
  "/:id",
  requireRole(CONTINUITY_ROLES),
  wrap(async (req, res) => {
    const photo = await prisma.photo.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!photo) throw notFound("Photo");
    await prisma.photo.delete({ where: { id: photo.id } });
    const file = path.join(config.uploadDir, path.basename(photo.url));
    fs.promises.unlink(file).catch(() => undefined);
    res.json({ ok: true });
  }),
);
