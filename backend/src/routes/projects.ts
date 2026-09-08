import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound } from "../lib/errors";
import { parse, zDate, zOptionalString } from "../lib/validate";
import { requireAuth, requireProject, requireRole } from "../middleware/auth";
import { BUDGET_BANDS, MANAGER_ROLES, PROJECT_STATUSES, PROJECT_TYPES, ROLES } from "../lib/constants";
import { audit } from "../services/audit";
import { dashboard } from "../services/reports";

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

projectsRouter.get(
  "/",
  wrap(async (req, res) => {
    const user = req.user!;
    const where = user.role === "ADMIN" ? {} : { members: { some: { userId: user.id } } };
    const projects = await prisma.project.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { characters: true, costumes: true, scenes: true, members: true } }, members: { where: { userId: user.id }, select: { role: true } } },
    });
    res.json(projects.map((p) => ({ ...p, myRole: user.role === "ADMIN" ? "ADMIN" : p.members[0]?.role, members: undefined })));
  }),
);

const projectSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(2).max(20).regex(/^[A-Za-z0-9_-]+$/),
  status: z.enum(PROJECT_STATUSES).optional(),
  type: z.enum(PROJECT_TYPES).optional(),
  studio: zOptionalString,
  budgetBand: z.enum(BUDGET_BANDS).optional().nullable(),
  country: zOptionalString,
  city: zOptionalString,
  shootingDay: z.number().int().min(0).optional(),
  currentLocation: zOptionalString,
  currency: z.string().length(3).optional(),
  startDate: zDate,
  endDate: zDate,
  notes: zOptionalString,
});

projectsRouter.post(
  "/",
  requireRole(["ADMIN", "PRODUCTION_MANAGER", "COSTUME_DESIGNER"]),
  wrap(async (req, res) => {
    const data = parse(projectSchema, req.body);
    const project = await prisma.project.create({
      data: { ...data, code: data.code.toUpperCase(), members: { create: { userId: req.user!.id, role: req.user!.role === "ADMIN" ? "ADMIN" : req.user!.role } } },
    });
    await audit(req.user, project.id, "PROJECT_CREATE", "PROJECT", project.id);
    res.status(201).json(project);
  }),
);

projectsRouter.get(
  "/:projectId",
  requireProject,
  wrap(async (req, res) => {
    const project = await prisma.project.findUnique({
      where: { id: req.projectId },
      include: { _count: { select: { characters: true, costumes: true, scenes: true, members: true, actors: true } } },
    });
    if (!project) throw notFound("Project");
    res.json({ ...project, myRole: req.user!.projectRole });
  }),
);

projectsRouter.patch(
  "/:projectId",
  requireProject,
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const data = parse(projectSchema.partial(), req.body);
    const project = await prisma.project.update({ where: { id: req.projectId }, data: { ...data, code: data.code?.toUpperCase() } });
    await audit(req.user, project.id, "PROJECT_UPDATE", "PROJECT", project.id, data as Record<string, unknown>);
    res.json(project);
  }),
);

projectsRouter.get(
  "/:projectId/dashboard",
  requireProject,
  wrap(async (req, res) => {
    res.json(await dashboard(req.projectId!, req.query.date as string | undefined));
  }),
);

projectsRouter.get(
  "/:projectId/members",
  requireProject,
  wrap(async (req, res) => {
    const members = await prisma.projectMember.findMany({
      where: { projectId: req.projectId },
      include: { user: { select: { id: true, name: true, email: true, role: true, phone: true, isActive: true } } },
      orderBy: { createdAt: "asc" },
    });
    res.json(members);
  }),
);

projectsRouter.post(
  "/:projectId/members",
  requireProject,
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const { userId, role } = parse(z.object({ userId: z.string(), role: z.enum(ROLES) }), req.body);
    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: req.projectId!, userId } },
      create: { projectId: req.projectId!, userId, role },
      update: { role },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
    await audit(req.user, req.projectId!, "MEMBER_UPSERT", "PROJECT_MEMBER", member.id, { userId, role });
    res.status(201).json(member);
  }),
);

projectsRouter.delete(
  "/:projectId/members/:userId",
  requireProject,
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    await prisma.projectMember.delete({ where: { projectId_userId: { projectId: req.projectId!, userId: req.params.userId } } });
    await audit(req.user, req.projectId!, "MEMBER_REMOVE", "PROJECT_MEMBER", req.params.userId);
    res.json({ ok: true });
  }),
);

projectsRouter.get(
  "/:projectId/audit",
  requireProject,
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const logs = await prisma.auditLog.findMany({ where: { projectId: req.projectId }, orderBy: { createdAt: "desc" }, take: Math.min(500, Number(req.query.limit || 200)) });
    res.json(logs.map((l) => ({ ...l, meta: l.meta ? JSON.parse(l.meta) : null })));
  }),
);
