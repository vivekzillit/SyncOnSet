import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound } from "../lib/errors";
import { parse } from "../lib/validate";
import { requireAuth, requireRole } from "../middleware/auth";
import { ROLES, MANAGER_ROLES } from "../lib/constants";
import { audit } from "../services/audit";

export const usersRouter = Router();
usersRouter.use(requireAuth);

const select = { id: true, name: true, email: true, role: true, phone: true, isActive: true, createdAt: true };

usersRouter.get(
  "/",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const q = String(req.query.q || "").trim();
    const users = await prisma.user.findMany({
      where: q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : undefined,
      select: { ...select, memberships: { select: { projectId: true, role: true } } },
      orderBy: { name: "asc" },
    });
    res.json(users);
  }),
);

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(ROLES),
  phone: z.string().optional().nullable(),
});

usersRouter.post(
  "/",
  requireRole(["ADMIN", "PRODUCTION_MANAGER"]),
  wrap(async (req, res) => {
    const data = parse(createSchema, req.body);
    const user = await prisma.user.create({
      data: { name: data.name, email: data.email.toLowerCase(), role: data.role, phone: data.phone || null, passwordHash: await bcrypt.hash(data.password, 10) },
      select,
    });
    await audit(req.user, null, "USER_CREATE", "USER", user.id, { role: user.role });
    res.status(201).json(user);
  }),
);

usersRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { ...select, memberships: { include: { project: { select: { id: true, name: true, code: true } } } } } });
    if (!user) throw notFound("User");
    res.json(user);
  }),
);

usersRouter.patch(
  "/:id",
  requireRole(["ADMIN", "PRODUCTION_MANAGER"]),
  wrap(async (req, res) => {
    const data = parse(createSchema.partial().extend({ isActive: z.boolean().optional() }), req.body);
    const update: Record<string, unknown> = { ...data };
    if (data.password) update.passwordHash = await bcrypt.hash(data.password, 10);
    delete update.password;
    if (data.email) update.email = data.email.toLowerCase();
    const user = await prisma.user.update({ where: { id: req.params.id }, data: update, select });
    await audit(req.user, null, "USER_UPDATE", "USER", user.id, data as Record<string, unknown>);
    res.json(user);
  }),
);
